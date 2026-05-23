package services

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"log"
	"mailman/internal/models"
	"mailman/internal/repository"
	"net"
	"net/smtp"
	"strings"
	"time"

	"gorm.io/gorm"
)

// EmailSendRequest represents a request to send an email
type EmailSendRequest struct {
	AccountID   uint              `json:"accountId"`
	To          []string          `json:"to"`
	Cc          []string          `json:"cc"`
	Bcc         []string          `json:"bcc"`
	Subject     string            `json:"subject"`
	HtmlContent string            `json:"htmlContent"`
	TextContent string            `json:"textContent"`
	Attachments []EmailAttachment `json:"attachments"`
}

// EmailAttachment represents an email attachment
type EmailAttachment struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Content     string `json:"content"` // Base64 encoded
}

// EmailSendResponse represents the response from sending an email
type EmailSendResponse struct {
	Success   bool   `json:"success"`
	MessageID string `json:"messageId,omitempty"`
	Error     string `json:"error,omitempty"`
}

// EmailSenderService handles sending emails via SMTP
type EmailSenderService struct {
	db             *gorm.DB
	accountRepo    *repository.EmailAccountRepository
	oauth2Service  *OAuth2Service
	activityLogger *ActivityLogger
}

// NewEmailSenderService creates a new EmailSenderService
func NewEmailSenderService(
	db *gorm.DB,
	accountRepo *repository.EmailAccountRepository,
	oauth2Service *OAuth2Service,
	activityLogger *ActivityLogger,
) *EmailSenderService {
	return &EmailSenderService{
		db:             db,
		accountRepo:    accountRepo,
		oauth2Service:  oauth2Service,
		activityLogger: activityLogger,
	}
}

// SendEmail sends an email using the specified account
func (s *EmailSenderService) SendEmail(req *EmailSendRequest) (*EmailSendResponse, error) {
	// Validate request
	if err := s.validateRequest(req); err != nil {
		return &EmailSendResponse{Success: false, Error: err.Error()}, err
	}

	// Get account and provider info
	account, err := s.accountRepo.GetByID(req.AccountID)
	if err != nil {
		return &EmailSendResponse{Success: false, Error: "账户不存在"}, err
	}
	DecryptAccountCredentials(&account.Password, &account.Token)

	if account.MailProvider == nil {
		return &EmailSendResponse{Success: false, Error: "账户未关联邮件服务商"}, fmt.Errorf("no mail provider for account %d", req.AccountID)
	}

	provider := account.MailProvider
	smtpServer := provider.SMTPServer
	smtpPort := provider.SMTPPort

	if smtpServer == "" || smtpPort == 0 {
		return &EmailSendResponse{Success: false, Error: "邮件服务商未配置 SMTP 服务器"}, fmt.Errorf("SMTP not configured for provider %s", provider.Name)
	}

	// Build the email message
	messageID := s.generateMessageID(account.EmailAddress)
	message := s.buildMIMEMessage(req, account.EmailAddress, messageID)

	// Get all recipients
	allRecipients := append(append(req.To, req.Cc...), req.Bcc...)

	// Send based on auth type
	var sendErr error
	switch account.AuthType {
	case models.AuthTypeOAuth2:
		sendErr = s.sendWithOAuth2(account, provider, smtpServer, smtpPort, allRecipients, message)
	case models.AuthTypePassword:
		sendErr = s.sendWithPassword(account, smtpServer, smtpPort, allRecipients, message)
	default:
		sendErr = fmt.Errorf("unsupported auth type: %s", account.AuthType)
	}

	if sendErr != nil {
		// Log failure
		if s.activityLogger != nil {
			s.activityLogger.LogFailedActivity(
				models.ActivityEmailSent,
				"邮件发送失败",
				fmt.Sprintf("向 %v 发送邮件失败: %v", req.To, sendErr),
				nil,
				map[string]interface{}{
					"account_id": req.AccountID,
					"to":         req.To,
					"subject":    req.Subject,
					"error":      sendErr.Error(),
				},
			)
		}
		return &EmailSendResponse{Success: false, Error: sendErr.Error()}, sendErr
	}

	// Save sent email to database
	sentEmail := &models.Email{
		MessageID:    messageID,
		AccountID:    req.AccountID,
		Subject:      req.Subject,
		From:         models.StringSlice{account.EmailAddress},
		To:           models.StringSlice(req.To),
		Cc:           models.StringSlice(req.Cc),
		Bcc:          models.StringSlice(req.Bcc),
		FromAddress:  account.EmailAddress,
		ToAddresses:  models.StringSlice(req.To),
		CcAddresses:  models.StringSlice(req.Cc),
		BccAddresses: models.StringSlice(req.Bcc),
		Date:         time.Now(),
		ReceivedAt:   time.Now(),
		HTMLBody:     req.HtmlContent,
		TextBody:     req.TextContent,
		MailboxName:  "Sent",
		Direction:    models.EmailDirectionSent,
	}
	sentEmail.ExtractPureAddresses()
	if err := s.db.Create(sentEmail).Error; err != nil {
		// Log but don't fail the send
		log.Printf("[EmailSender] Failed to save sent email to database: %v", err)
	}

	// Log success
	if s.activityLogger != nil {
		s.activityLogger.LogActivity(
			models.ActivityEmailSent,
			"邮件发送成功",
			fmt.Sprintf("从 %s 向 %v 发送邮件", account.EmailAddress, req.To),
			nil,
			map[string]interface{}{
				"account_id": req.AccountID,
				"to":         req.To,
				"cc":         req.Cc,
				"subject":    req.Subject,
				"message_id": messageID,
			},
		)
	}

	return &EmailSendResponse{
		Success:   true,
		MessageID: messageID,
	}, nil
}

// validateRequest validates the email send request
func (s *EmailSenderService) validateRequest(req *EmailSendRequest) error {
	if req.AccountID == 0 {
		return fmt.Errorf("请选择发件人账户")
	}
	if len(req.To) == 0 {
		return fmt.Errorf("请至少添加一个收件人")
	}
	if req.Subject == "" {
		return fmt.Errorf("请输入邮件主题")
	}
	if req.HtmlContent == "" && req.TextContent == "" {
		return fmt.Errorf("请输入邮件内容")
	}
	return nil
}

// generateMessageID generates a unique message ID
func (s *EmailSenderService) generateMessageID(fromEmail string) string {
	domain := "localhost"
	parts := strings.Split(fromEmail, "@")
	if len(parts) == 2 {
		domain = parts[1]
	}
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), strings.ReplaceAll(fromEmail, "@", "."), domain)
}

// buildMIMEMessage builds a MIME email message
func (s *EmailSenderService) buildMIMEMessage(req *EmailSendRequest, from, messageID string) string {
	var msg strings.Builder

	// Headers
	msg.WriteString(fmt.Sprintf("From: %s\r\n", from))
	msg.WriteString(fmt.Sprintf("To: %s\r\n", strings.Join(req.To, ", ")))
	if len(req.Cc) > 0 {
		msg.WriteString(fmt.Sprintf("Cc: %s\r\n", strings.Join(req.Cc, ", ")))
	}
	msg.WriteString(fmt.Sprintf("Subject: =?UTF-8?B?%s?=\r\n", base64.StdEncoding.EncodeToString([]byte(req.Subject))))
	msg.WriteString(fmt.Sprintf("Message-ID: %s\r\n", messageID))
	msg.WriteString(fmt.Sprintf("Date: %s\r\n", time.Now().Format(time.RFC1123Z)))
	msg.WriteString("MIME-Version: 1.0\r\n")

	// Determine structure:
	// Mixed (if attachments)
	//   -> Alternative (if text+html)
	//      -> Text
	//      -> Html
	//   -> Attachments
	// If no attachments, just Alternative/Text/Html at root level.

	mixedBoundary := fmt.Sprintf("----=_Part_Mixed_%d", time.Now().UnixNano())
	hasAttachments := len(req.Attachments) > 0

	// If we have attachments, the root is mixed
	if hasAttachments {
		msg.WriteString(fmt.Sprintf("Content-Type: multipart/mixed; boundary=\"%s\"\r\n", mixedBoundary))
		msg.WriteString("\r\n") // End of main headers
		// Start first part (body content)
		msg.WriteString(fmt.Sprintf("--%s\r\n", mixedBoundary))
	}

	// Body Content Logic
	// If mixed, this writes the body part. If not mixed, this writes the top-level body.
	if req.TextContent != "" && req.HtmlContent != "" {
		altBoundary := fmt.Sprintf("----=_Part_Alt_%d", time.Now().UnixNano())
		msg.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n", altBoundary))
		msg.WriteString("\r\n")

		// Text part
		msg.WriteString(fmt.Sprintf("--%s\r\n", altBoundary))
		msg.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
		msg.WriteString("Content-Transfer-Encoding: base64\r\n")
		msg.WriteString("\r\n")
		msg.WriteString(s.chunkBase64(base64.StdEncoding.EncodeToString([]byte(req.TextContent))))
		msg.WriteString("\r\n")

		// HTML part
		msg.WriteString(fmt.Sprintf("--%s\r\n", altBoundary))
		msg.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
		msg.WriteString("Content-Transfer-Encoding: base64\r\n")
		msg.WriteString("\r\n")
		msg.WriteString(s.chunkBase64(base64.StdEncoding.EncodeToString([]byte(req.HtmlContent))))
		msg.WriteString("\r\n")

		msg.WriteString(fmt.Sprintf("--%s--\r\n", altBoundary))
	} else if req.HtmlContent != "" {
		msg.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
		msg.WriteString("Content-Transfer-Encoding: base64\r\n")
		msg.WriteString("\r\n")
		msg.WriteString(s.chunkBase64(base64.StdEncoding.EncodeToString([]byte(req.HtmlContent))))
		msg.WriteString("\r\n")
	} else {
		msg.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
		msg.WriteString("Content-Transfer-Encoding: base64\r\n")
		msg.WriteString("\r\n")
		msg.WriteString(s.chunkBase64(base64.StdEncoding.EncodeToString([]byte(req.TextContent))))
		msg.WriteString("\r\n")
	}

	// Attachments
	if hasAttachments {
		for _, att := range req.Attachments {
			// Attachments are technically siblings to the main body part in the "mixed" multipart
			// The previous part (body) logic ended. We need a new boundary.

			// Note: If the body logic was a multipart/alternative, it ended with --boundary--\r\n
			// If it was a single part (text/html), it ended with the content + \r\n.

			// So we can safely start the next mixed boundary.
			msg.WriteString(fmt.Sprintf("--%s\r\n", mixedBoundary))

			// Handle filename encoding (basic fallback for now, ideally RFC 2231)
			// Using quoted-printable for filename in header is sometimes safer or just pure ASCII fallback
			// For now, we assume UTF-8 is handled by modern clients or just pass straightforwardly.
			// Ideally we should use =?UTF-8?B?...?= for the name parameter if strictly needed,
			// but 'filename' param in Content-Disposition is usually what clients use.

			contentType := att.ContentType
			if contentType == "" {
				contentType = "application/octet-stream"
			}

			msg.WriteString(fmt.Sprintf("Content-Type: %s; name=\"%s\"\r\n", contentType, att.Filename))
			msg.WriteString("Content-Transfer-Encoding: base64\r\n")
			msg.WriteString(fmt.Sprintf("Content-Disposition: attachment; filename=\"%s\"\r\n", att.Filename))
			msg.WriteString("\r\n")

			// content is already base64, but we should chunk it just in case it's not
			// Note: The frontend sends a clean base64 string.
			// Check if we need to re-encode or if it's already encoded.
			// The struct says "Base64 encoded".
			// But we need to line-wrap it.
			msg.WriteString(s.chunkBase64(att.Content))
			msg.WriteString("\r\n")
		}
		// End of mixed
		msg.WriteString(fmt.Sprintf("--%s--\r\n", mixedBoundary))
	}

	return msg.String()
}

// chunkBase64 splits a base64 string into lines of 76 characters maximum
func (s *EmailSenderService) chunkBase64(str string) string {
	var chunks []string
	length := len(str)
	for i := 0; i < length; i += 76 {
		end := i + 76
		if end > length {
			end = length
		}
		chunks = append(chunks, str[i:end])
	}
	return strings.Join(chunks, "\r\n")
}

// sendWithOAuth2 sends email using OAuth2 authentication (XOAUTH2)
func (s *EmailSenderService) sendWithOAuth2(account *models.EmailAccount, provider *models.MailProvider, smtpServer string, smtpPort int, recipients []string, message string) error {
	// Get OAuth2 credentials
	var clientID, clientSecret, refreshToken string
	providerType := string(provider.Type)

	// Get refresh token from CustomSettings
	refreshToken = account.CustomSettings["refresh_token"]
	if refreshToken == "" {
		return fmt.Errorf("OAuth2 refresh token not found for account")
	}

	// Priority 1: Try to get client credentials from CustomSettings first
	clientID = account.CustomSettings["client_id"]
	clientSecret = account.CustomSettings["client_secret"]

	// Priority 2: If not in CustomSettings, try OAuth2GlobalConfig via OAuth2ProviderID
	if clientSecret == "" {
		if account.OAuth2Provider != nil {
			if clientID == "" {
				clientID = account.OAuth2Provider.ClientID
			}
			clientSecret = account.OAuth2Provider.ClientSecret
		} else if account.OAuth2ProviderID != nil && *account.OAuth2ProviderID > 0 {
			// Try to load OAuth2Provider if not preloaded
			var oauth2Config models.OAuth2GlobalConfig
			if err := s.db.First(&oauth2Config, *account.OAuth2ProviderID).Error; err == nil {
				if clientID == "" {
					clientID = oauth2Config.ClientID
				}
				clientSecret = oauth2Config.ClientSecret
			}
		}
	}

	// Priority 3: Try global config by provider type as last resort
	if clientSecret == "" {
		var configs []models.OAuth2GlobalConfig
		if err := s.db.Where("provider_type = ? AND is_enabled = ?", providerType, true).Find(&configs).Error; err == nil && len(configs) > 0 {
			if clientID == "" {
				clientID = configs[0].ClientID
			}
			clientSecret = configs[0].ClientSecret
		}
	}

	if clientSecret == "" {
		return fmt.Errorf("无法获取 OAuth2 客户端密钥，请检查账户的 OAuth2 配置")
	}

	// Get fresh access token
	accessToken, err := s.oauth2Service.RefreshAccessTokenWithCache(providerType, clientID, clientSecret, refreshToken, account.ID)
	if err != nil {
		return fmt.Errorf("failed to get access token: %w", err)
	}

	// Connect to SMTP server
	addr := fmt.Sprintf("%s:%d", smtpServer, smtpPort)
	conn, err := net.DialTimeout("tcp", addr, 30*time.Second)
	if err != nil {
		return fmt.Errorf("failed to connect to SMTP server: %w", err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, smtpServer)
	if err != nil {
		return fmt.Errorf("failed to create SMTP client: %w", err)
	}
	defer client.Close()

	// STARTTLS
	if ok, _ := client.Extension("STARTTLS"); ok {
		config := &tls.Config{ServerName: smtpServer}
		if err := client.StartTLS(config); err != nil {
			return fmt.Errorf("STARTTLS failed: %w", err)
		}
	}

	// XOAUTH2 authentication
	auth := &xoauth2Auth{
		email:       account.EmailAddress,
		accessToken: accessToken,
	}
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("XOAUTH2 authentication failed: %w", err)
	}

	// Send email
	if err := client.Mail(account.EmailAddress); err != nil {
		return fmt.Errorf("MAIL FROM failed: %w", err)
	}

	for _, recipient := range recipients {
		if err := client.Rcpt(recipient); err != nil {
			return fmt.Errorf("RCPT TO failed for %s: %w", recipient, err)
		}
	}

	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA command failed: %w", err)
	}

	_, err = writer.Write([]byte(message))
	if err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	if err := writer.Close(); err != nil {
		return fmt.Errorf("failed to close data writer: %w", err)
	}

	return client.Quit()
}

// sendWithPassword sends email using password authentication
func (s *EmailSenderService) sendWithPassword(account *models.EmailAccount, smtpServer string, smtpPort int, recipients []string, message string) error {
	password := account.Password
	if password == "" {
		return fmt.Errorf("password not configured for account")
	}

	// Connect to SMTP server
	addr := fmt.Sprintf("%s:%d", smtpServer, smtpPort)
	conn, err := net.DialTimeout("tcp", addr, 30*time.Second)
	if err != nil {
		return fmt.Errorf("failed to connect to SMTP server: %w", err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, smtpServer)
	if err != nil {
		return fmt.Errorf("failed to create SMTP client: %w", err)
	}
	defer client.Close()

	// STARTTLS
	if ok, _ := client.Extension("STARTTLS"); ok {
		config := &tls.Config{ServerName: smtpServer}
		if err := client.StartTLS(config); err != nil {
			return fmt.Errorf("STARTTLS failed: %w", err)
		}
	}

	// Plain auth
	auth := smtp.PlainAuth("", account.EmailAddress, password, smtpServer)
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	// Send email
	if err := client.Mail(account.EmailAddress); err != nil {
		return fmt.Errorf("MAIL FROM failed: %w", err)
	}

	for _, recipient := range recipients {
		if err := client.Rcpt(recipient); err != nil {
			return fmt.Errorf("RCPT TO failed for %s: %w", recipient, err)
		}
	}

	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA command failed: %w", err)
	}

	_, err = writer.Write([]byte(message))
	if err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	if err := writer.Close(); err != nil {
		return fmt.Errorf("failed to close data writer: %w", err)
	}

	return client.Quit()
}

// xoauth2Auth implements smtp.Auth for XOAUTH2
type xoauth2Auth struct {
	email       string
	accessToken string
}

func (a *xoauth2Auth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	// XOAUTH2 initial response format: "user=" + email + "\x01auth=Bearer " + token + "\x01\x01"
	response := fmt.Sprintf("user=%s\x01auth=Bearer %s\x01\x01", a.email, a.accessToken)
	return "XOAUTH2", []byte(response), nil
}

func (a *xoauth2Auth) Next(fromServer []byte, more bool) ([]byte, error) {
	if more {
		// If the server sends a challenge, it usually means authentication failed
		return nil, fmt.Errorf("XOAUTH2 authentication failed: %s", string(fromServer))
	}
	return nil, nil
}
