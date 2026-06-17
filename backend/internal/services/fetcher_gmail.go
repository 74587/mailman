package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/gmail/v1"
	"google.golang.org/api/option"
	"gorm.io/gorm"
)

func (s *FetcherService) verifyGmailOAuth2Connection(account models.EmailAccount) error {
	s.logger.Info("Verifying Gmail OAuth2 connection for %s", account.EmailAddress)

	// Get OAuth2 configuration
	oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())

	var oauth2Config *models.OAuth2GlobalConfig
	var err error

	// First try to get config by OAuth2ProviderID if it exists
	if account.OAuth2ProviderID != nil {
		s.logger.Debug("Using OAuth2ProviderID %d to get config for Gmail verification", *account.OAuth2ProviderID)
		oauth2Config, err = oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
		if err != nil {
			s.logger.Warn("Failed to get config by OAuth2ProviderID %d: %v", *account.OAuth2ProviderID, err)
		}
	}

	// Fallback to provider type based lookup for backward compatibility
	if oauth2Config == nil {
		s.logger.Debug("Falling back to provider type based lookup for Gmail")
		oauth2Config, err = oauth2GlobalConfigRepo.GetByProviderType(models.ProviderTypeGmail)
		if err != nil {
			s.logger.Error("Failed to get OAuth2 config: %v", err)
			return fmt.Errorf("failed to get OAuth2 config: %w", err)
		}
	}

	if oauth2Config == nil {
		s.logger.Error("No OAuth2 config found")
		return fmt.Errorf("no OAuth2 config found")
	}

	s.logger.Debug("Using OAuth2 config: ID=%d, Name=%s", oauth2Config.ID, oauth2Config.Name)

	// Get tokens from CustomSettings
	if account.CustomSettings == nil {
		s.logger.Error("CustomSettings is nil for account %s", account.EmailAddress)
		return fmt.Errorf("OAuth2 tokens not found")
	}

	accessToken, ok := account.CustomSettings["access_token"]
	if !ok || accessToken == "" {
		s.logger.Error("access_token not found in CustomSettings")
		return fmt.Errorf("access_token not found")
	}

	refreshToken, ok := account.CustomSettings["refresh_token"]
	if !ok || refreshToken == "" {
		s.logger.Error("refresh_token not found in CustomSettings")
		return fmt.Errorf("refresh_token not found")
	}

	// Try to refresh token first to ensure it's valid - use cached method for better reliability
	s.logger.Debug("Refreshing OAuth2 access token for Gmail verification")
	newAccessToken, err := s.oauth2Service.RefreshAccessTokenWithCacheAndProxy(
		"gmail",
		oauth2Config.ClientID,
		oauth2Config.ClientSecret,
		refreshToken,
		account.ID,
		account.Proxy, // Pass proxy settings if available
	)
	if err != nil {
		s.logger.Error("Failed to refresh token: %v", err)
		return fmt.Errorf("failed to refresh token: %w", err)
	}

	// Use the refreshed token
	accessToken = newAccessToken
	s.logger.Debug("Token refreshed successfully")

	// Test connection by making a direct HTTP request to Gmail API
	s.logger.Debug("Testing Gmail API connection by getting labels list")
	req, err := http.NewRequest("GET", "https://gmail.googleapis.com/gmail/v1/users/me/labels", nil)
	if err != nil {
		s.logger.Error("Failed to create HTTP request: %v", err)
		return fmt.Errorf("failed to create HTTP request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		s.logger.Error("Failed to make HTTP request: %v", err)
		return fmt.Errorf("Gmail API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		s.logger.Error("Gmail API returned status %d: %s", resp.StatusCode, string(body))
		return fmt.Errorf("Gmail API verification failed with status %d", resp.StatusCode)
	}

	// Parse the response to get labels count
	var labelsResponse struct {
		Labels []struct {
			Id   string `json:"id"`
			Name string `json:"name"`
		} `json:"labels"`
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		s.logger.Error("Failed to read response body: %v", err)
		return fmt.Errorf("failed to read response body: %w", err)
	}

	err = json.Unmarshal(body, &labelsResponse)
	if err != nil {
		s.logger.Error("Failed to parse JSON response: %v", err)
		return fmt.Errorf("failed to parse JSON response: %w", err)
	}

	s.logger.Info("Gmail OAuth2 connection verified successfully for %s, found %d labels", account.EmailAddress, len(labelsResponse.Labels))
	return nil
}

// GetAllFolders retrieves all available folders/labels for an email account

func (s *FetcherService) getGmailFolders(account models.EmailAccount) ([]string, error) {
	s.logger.Debug("Getting Gmail folders using Gmail API for %s", account.EmailAddress)

	// 使用Gmail API获取标签
	mailboxes, err := s.getGmailMailboxes(account)
	if err != nil {
		s.logger.Error("Failed to get Gmail mailboxes: %v", err)
		return nil, fmt.Errorf("failed to get Gmail mailboxes: %w", err)
	}

	// 转换为文件夹名称列表
	var folders []string
	for _, mailbox := range mailboxes {
		folders = append(folders, mailbox.Name)
	}

	s.logger.Info("Retrieved %d Gmail labels for %s: %v", len(folders), account.EmailAddress, folders)
	return folders, nil
}

// getImapFolders retrieves IMAP folders using IMAP LIST command

func (s *FetcherService) shouldUseGmailAPI(account models.EmailAccount) bool {
	return account.AuthType == models.AuthTypeOAuth2 &&
		account.MailProvider != nil &&
		account.MailProvider.Type == models.ProviderTypeGmail
}

// fetchEmailsFromGmailAPI fetches emails using Gmail API

func (s *FetcherService) fetchEmailsFromGmailAPI(account models.EmailAccount, options FetchEmailsOptions) ([]models.Email, error) {
	s.logger.Debug("Fetching emails using Gmail API for account %s", account.EmailAddress)
	ctx := options.contextOrBackground()
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	// Create Gmail API service
	gmailService, err := s.createGmailService(ctx, account)
	if err != nil {
		s.logger.Error("Failed to create Gmail service: %v", err)
		return nil, fmt.Errorf("failed to create Gmail service: %w", err)
	}

	// Get sync config to check for History ID
	syncConfigRepo := repository.NewSyncConfigRepository(s.accountRepo.GetDB())
	syncConfig, err := syncConfigRepo.GetByAccountID(account.ID)
	if err != nil {
		s.logger.Warn("Failed to get sync config for account %d: %v", account.ID, err)
		// Continue with full sync if no config found
	}
	historyID := ""
	cursor, cursorErr := syncConfigRepo.GetAccountSyncCursor(account.ID, models.SyncCursorProviderGmail)
	if cursorErr == nil && cursor.LastHistoryID != "" {
		historyID = cursor.LastHistoryID
		s.logger.Debug("Using Gmail History ID from sync cursor: %s", historyID)
	} else if cursorErr != nil && cursorErr != gorm.ErrRecordNotFound {
		s.logger.Warn("Failed to get Gmail sync cursor for account %d: %v", account.ID, cursorErr)
	}
	if historyID == "" && syncConfig != nil && syncConfig.LastHistoryID != "" {
		historyID = syncConfig.LastHistoryID
		s.logger.Debug("Using Gmail History ID from legacy sync config: %s", historyID)
	}

	var emails []models.Email
	var newHistoryID string

	// Try incremental sync using History API if we have a previous History ID
	if historyID != "" {
		s.logger.Debug("Attempting Gmail unified incremental sync using History ID: %s", historyID)

		// Use unified Gmail API sync - gets ALL email changes in one call
		historyEmails, latestHistoryID, err := s.fetchGmailHistoryChangesUnified(gmailService, historyID, account.ID, options)
		if err != nil {
			s.logger.Warn("Gmail unified History API sync failed, falling back to full sync: %v", err)
			// Fall back to full sync
			messages, err := s.fetchGmailMessagesUnified(gmailService, options)
			if err != nil {
				return nil, fmt.Errorf("failed to fetch Gmail messages (unified): %w", err)
			}
			emails = s.convertGmailMessages(messages, account.ID)
		} else {
			emails = historyEmails
			newHistoryID = latestHistoryID
		}
	} else {
		s.logger.Debug("No previous History ID found, performing Gmail unified full sync")
		// Full sync for first time or when no history ID available
		messages, err := s.fetchGmailMessagesUnified(gmailService, options)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch Gmail messages (unified): %w", err)
		}
		emails = s.convertGmailMessages(messages, account.ID)
	}

	// Get current profile to update History ID
	if newHistoryID == "" {
		profile, err := gmailService.Users.GetProfile("me").Context(ctx).Do()
		if err != nil {
			s.logger.Warn("Failed to get user profile for History ID: %v", err)
		} else {
			newHistoryID = fmt.Sprintf("%d", profile.HistoryId)
		}
	}

	// Update sync config with new History ID
	if syncConfig != nil && newHistoryID != "" {
		syncConfig.LastHistoryID = newHistoryID
		if err := syncConfigRepo.Update(syncConfig); err != nil {
			s.logger.Warn("Failed to update History ID in sync config: %v", err)
		} else {
			s.logger.Debug("Updated History ID to: %s", newHistoryID)
		}
	}
	if newHistoryID != "" {
		if err := syncConfigRepo.UpsertAccountSyncCursorHistoryID(account.ID, models.SyncCursorProviderGmail, newHistoryID); err != nil {
			s.logger.Warn("Failed to update Gmail History ID in sync cursor: %v", err)
		}
	}

	// Update last sync time
	if err := s.accountRepo.UpdateLastSync(account.ID); err != nil {
		s.logger.Warn("Failed to update last sync time: %v", err)
	}

	s.logger.Debug("email: %s, historyId: %s, newEmails: %d", account.EmailAddress, newHistoryID, len(emails))
	return emails, nil
}

// createGmailService creates a Gmail API service client

func (s *FetcherService) createGmailService(ctx context.Context, account models.EmailAccount) (*gmail.Service, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	// Get OAuth2 configuration
	oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())

	var oauth2Config *models.OAuth2GlobalConfig
	var err error

	// Priority 1: Use OAuth2ProviderID if available
	if account.OAuth2ProviderID != nil && *account.OAuth2ProviderID > 0 {
		s.logger.Debug("Using OAuth2ProviderID %d for Gmail service", *account.OAuth2ProviderID)
		oauth2Config, err = oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
		if err != nil {
			s.logger.Warn("Failed to get config from OAuth2ProviderID %d: %v", *account.OAuth2ProviderID, err)
		}
	}

	// Priority 2: Fallback to provider type lookup
	if oauth2Config == nil {
		s.logger.Debug("Falling back to provider type lookup for Gmail")
		oauth2Config, err = oauth2GlobalConfigRepo.GetByProviderType(models.ProviderTypeGmail)
		if err != nil {
			return nil, fmt.Errorf("failed to get OAuth2 config: %w", err)
		}
	}

	if oauth2Config == nil {
		return nil, fmt.Errorf("no OAuth2 config found for Gmail")
	}

	// Get tokens from CustomSettings
	if account.CustomSettings == nil {
		return nil, fmt.Errorf("OAuth2 tokens not found in account settings")
	}

	accessToken, ok := account.CustomSettings["access_token"]
	if !ok || accessToken == "" {
		return nil, fmt.Errorf("access_token not found in account settings")
	}

	refreshToken, ok := account.CustomSettings["refresh_token"]
	if !ok || refreshToken == "" {
		return nil, fmt.Errorf("refresh_token not found in account settings")
	}

	// Parse token expiry
	var tokenExpiry time.Time
	if expiryStr, exists := account.CustomSettings["expires_at"]; exists && expiryStr != "" {
		if expiryInt, err := strconv.ParseInt(expiryStr, 10, 64); err == nil {
			tokenExpiry = time.Unix(expiryInt, 0)
		} else if expiryTime, err := time.Parse(time.RFC3339, expiryStr); err == nil {
			tokenExpiry = expiryTime
		}
	}

	// Check if token is expired and refresh if necessary (使用带缓存和并发控制的方法)
	if tokenExpiry.IsZero() || time.Now().After(tokenExpiry.Add(-5*time.Minute)) {
		s.logger.Debug("Access token is expired or about to expire, refreshing token for Gmail API")

		// 使用带缓存和并发控制的token刷新方法，并传递代理配置
		newAccessToken, err := s.oauth2Service.RefreshAccessTokenWithCacheAndProxy(
			string(models.ProviderTypeGmail),
			oauth2Config.ClientID,
			oauth2Config.ClientSecret,
			refreshToken,
			account.ID,
			account.Proxy, // 传递代理配置
		)
		if err != nil {
			s.logger.Error("Failed to refresh access token for Gmail API: %v", err)
			return nil, fmt.Errorf("failed to refresh access token: %w", err)
		}

		// Update access token in account - 并发安全更新
		newCustomSettings := make(models.JSONMap)
		if account.CustomSettings != nil {
			for k, v := range account.CustomSettings {
				newCustomSettings[k] = v
			}
		}
		newCustomSettings["access_token"] = newAccessToken
		newCustomSettings["expires_at"] = fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix())
		account.CustomSettings = newCustomSettings

		// Update the account with new access token
		if err := s.accountRepo.Update(&account); err != nil {
			s.logger.Warn("Failed to update access token in database: %v", err)
		} else {
			s.logger.Debug("Successfully updated access token in database")
		}

		// Use new access token
		accessToken = newAccessToken
		tokenExpiry = time.Now().Add(time.Hour)
	}

	// Create OAuth2 config
	config := &oauth2.Config{
		ClientID:     oauth2Config.ClientID,
		ClientSecret: oauth2Config.ClientSecret,
		Scopes:       oauth2Config.Scopes,
		Endpoint:     google.Endpoint,
	}

	// Create token
	token := &oauth2.Token{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		Expiry:       tokenExpiry,
		TokenType:    "Bearer",
	}

	// Create base HTTP client with proxy support if configured
	var baseClient *http.Client
	if account.Proxy != "" {
		s.logger.Debug("Creating HTTP client with proxy for Gmail API: %s", account.Proxy)
		baseClient, err = s.createHTTPClientWithProxy(account.Proxy)
		if err != nil {
			s.logger.Error("Failed to create HTTP client with proxy: %v", err)
			return nil, fmt.Errorf("failed to create HTTP client with proxy: %w", err)
		}
	} else {
		s.logger.Debug("Creating HTTP client without proxy for Gmail API")
		baseClient = &http.Client{
			Timeout: 30 * time.Second,
		}
	}

	// Create OAuth2 client using the base client
	oauth2Client := &http.Client{
		Transport: &oauth2.Transport{
			Source: config.TokenSource(ctx, token),
			Base:   baseClient.Transport,
		},
		Timeout: baseClient.Timeout,
	}

	// Create Gmail service
	service, err := gmail.NewService(ctx, option.WithHTTPClient(oauth2Client))
	if err != nil {
		return nil, fmt.Errorf("failed to create Gmail service: %w", err)
	}

	return service, nil
}

// fetchGmailMessages fetches messages from Gmail API

func (s *FetcherService) fetchGmailMessages(service *gmail.Service, options FetchEmailsOptions) ([]*gmail.Message, error) {
	ctx := options.contextOrBackground()
	// Build query based on options
	query := s.buildGmailQuery(service, options)

	// Set mailbox/label filter by dynamically getting Gmail label ID
	labelIDs := []string{}
	if options.Mailbox != "" && options.Mailbox != "INBOX" {
		// Use dynamic label ID lookup
		labelID, err := s.getGmailLabelID(ctx, service, options.Mailbox)
		if err != nil {
			s.logger.Warn("Failed to get Gmail label ID for mailbox '%s': %v", options.Mailbox, err)
			// Fall back to searching all messages if label not found
			s.logger.Debug("Falling back to search all messages without label filter")
		} else {
			labelIDs = append(labelIDs, labelID)
		}
	} else {
		labelIDs = append(labelIDs, "INBOX")
	}

	// List messages
	listCall := service.Users.Messages.List("me").Q(query)
	if len(labelIDs) > 0 {
		listCall = listCall.LabelIds(labelIDs...)
	}

	// Set limit
	limit := int64(options.Limit)
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	listCall = listCall.MaxResults(limit)

	s.logger.Debug("Fetching Gmail messages with query: %s, labels: %v, limit: %d", query, labelIDs, limit)

	listResp, err := listCall.Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to list Gmail messages: %w", err)
	}

	if len(listResp.Messages) == 0 {
		s.logger.Debug("No messages found for the query")
		return []*gmail.Message{}, nil
	}

	// Fetch full message details
	var messages []*gmail.Message
	for _, msgRef := range listResp.Messages {
		if err := ctx.Err(); err != nil {
			return messages, err
		}
		msg, err := service.Users.Messages.Get("me", msgRef.Id).Context(ctx).Do()
		if err != nil {
			s.logger.Warn("Failed to get message %s: %v", msgRef.Id, err)
			continue
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

// buildGmailQuery builds Gmail search query based on options

func (s *FetcherService) buildGmailQuery(service *gmail.Service, options FetchEmailsOptions) string {
	var queryParts []string

	// Add mailbox filter using Gmail search syntax
	if options.Mailbox != "" {
		// For Gmail API, we need to use the correct search syntax
		// Don't add label filters here as they cause issues with custom labels
		// Instead, we'll handle this in the message listing
		s.logger.Debug("Mailbox filter '%s' will be handled during message listing", options.Mailbox)
	}

	// Date filter
	if options.StartDate != nil {
		queryParts = append(queryParts, fmt.Sprintf("after:%s", options.StartDate.Format("2006/01/02")))
	}
	if options.EndDate != nil {
		queryParts = append(queryParts, fmt.Sprintf("before:%s", options.EndDate.Format("2006/01/02")))
	}

	// Search query
	if options.SearchQuery != "" {
		queryParts = append(queryParts, options.SearchQuery)
	}

	query := strings.Join(queryParts, " ")
	if query == "" {
		query = "in:inbox" // Default query
	}

	return query
}

// convertGmailMessage converts Gmail message to Email model

func (s *FetcherService) convertGmailMessage(gmailMsg *gmail.Message, accountID uint) (*models.Email, error) {
	email := &models.Email{
		MessageID: gmailMsg.Id, // Use Gmail message ID
		AccountID: accountID,
		Size:      int64(gmailMsg.SizeEstimate),
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
		Headers:   models.JSONMap{},
	}

	// Parse headers
	for _, header := range gmailMsg.Payload.Headers {
		if header.Name != "" && header.Value != "" {
			if existing := email.Headers[header.Name]; existing != "" {
				email.Headers[header.Name] = existing + "\n" + header.Value
			} else {
				email.Headers[header.Name] = header.Value
			}
		}

		switch header.Name {
		case "Message-ID":
			// Store original RFC Message-ID if available
			if header.Value != "" {
				email.MessageID = header.Value
			}
		case "Subject":
			email.Subject = header.Value
		case "From":
			email.From = models.StringSlice{header.Value}
		case "To":
			email.To = models.StringSlice{header.Value}
		case "Cc":
			email.Cc = models.StringSlice{header.Value}
		case "Bcc":
			email.Bcc = models.StringSlice{header.Value}
		case "Date":
			// Try multiple date formats to handle Gmail's various date formats
			dateFormats := []string{
				time.RFC1123Z,                          // "Mon, 02 Jan 2006 15:04:05 -0700"
				time.RFC1123,                           // "Mon, 02 Jan 2006 15:04:05 MST"
				"Mon, 2 Jan 2006 15:04:05 -0700",       // Gmail format without leading zero
				"Mon, 2 Jan 2006 15:04:05 MST",         // Gmail format without leading zero (MST)
				"Mon, 2 Jan 2006 15:04:05 +0000",       // Gmail format with +0000 timezone
				"Mon, 02 Jan 2006 15:04:05 +0000",      // Gmail format with leading zero and +0000
				"Mon, 2 Jan 2006 15:04:05 GMT",         // Gmail format with GMT
				"Mon, 02 Jan 2006 15:04:05 GMT",        // Gmail format with leading zero and GMT
				"2 Jan 2006 15:04:05 -0700",            // Without weekday
				"2 Jan 2006 15:04:05 +0000",            // Without weekday, +0000 timezone
				"02 Jan 2006 15:04:05 +0000",           // With leading zero, no weekday, +0000
				"2006-01-02 15:04:05 -0700",            // ISO-like format
				"2006-01-02 15:04:05 +0000",            // ISO-like format with +0000
				time.RFC3339,                           // "2006-01-02T15:04:05Z07:00"
				time.RFC822Z,                           // "02 Jan 06 15:04 -0700"
				time.RFC822,                            // "02 Jan 06 15:04 MST"
				"Mon, 2 Jan 2006 15:04:05 -0700 (MST)", // With timezone name in parentheses
				"Mon, 2 Jan 2006 15:04:05 +0000 (UTC)", // With UTC in parentheses
			}

			var parsedSuccessfully bool
			for i, format := range dateFormats {
				if parsedDate, err := time.Parse(format, header.Value); err == nil {
					email.Date = parsedDate
					email.ReceivedAt = parsedDate // Also set ReceivedAt
					parsedSuccessfully = true
					s.logger.Debug("Successfully parsed date '%s' using format %d (%s) for message %s",
						header.Value, i, format, gmailMsg.Id)
					break
				}
			}

			// Enhanced logging if date parsing fails
			if !parsedSuccessfully {
				s.logger.Error("Failed to parse date '%s' for message %s. Tried %d formats. Setting to zero time.",
					header.Value, gmailMsg.Id, len(dateFormats))
				// Set to zero time explicitly
				email.Date = time.Time{}
				email.ReceivedAt = time.Time{}
			}
		}
	}

	// Handle Gmail labels - store all labels in Flags, primary label in MailboxName
	if len(gmailMsg.LabelIds) > 0 {
		email.Flags = models.StringSlice(gmailMsg.LabelIds)
		email.MailboxName = s.getPrimaryMailboxFromLabels(gmailMsg.LabelIds)
	} else {
		email.MailboxName = "INBOX"
	}

	// Extract body content
	if gmailMsg.Payload != nil {
		email.Body, email.HTMLBody = s.extractGmailBody(gmailMsg.Payload)
		// Extract attachments (metadata only during normal sync, content downloaded separately via API)
		email.Attachments = s.extractGmailAttachments(gmailMsg.Payload, nil, "", false)
		email.HasAttachments = len(email.Attachments) > 0
	}

	// Use snippet if no body extracted
	if email.Body == "" && gmailMsg.Snippet != "" {
		email.Body = gmailMsg.Snippet
	}

	return email, nil
}

// getPrimaryMailboxFromLabels determines primary mailbox from Gmail labels

func (s *FetcherService) getPrimaryMailboxFromLabels(labels []string) string {
	// Priority mapping
	priority := map[string]int{
		"INBOX":     1,
		"SENT":      2,
		"DRAFT":     3,
		"SPAM":      4,
		"TRASH":     5,
		"IMPORTANT": 6,
		"STARRED":   7,
	}

	bestLabel := "INBOX" // Default
	bestPriority := 999

	for _, label := range labels {
		if p, exists := priority[label]; exists && p < bestPriority {
			bestLabel = label
			bestPriority = p
		}
	}

	return bestLabel
}

// extractGmailBody extracts text and HTML body from Gmail message payload

func (s *FetcherService) extractGmailBody(payload *gmail.MessagePart) (string, string) {
	var textBody, htmlBody string

	// Check if this part has body data
	if payload.Body != nil && payload.Body.Data != "" {
		decoded, err := base64.URLEncoding.DecodeString(payload.Body.Data)
		if err == nil {
			content := string(decoded)

			// Determine content type
			mimeType := "text/plain"
			for _, header := range payload.Headers {
				if header.Name == "Content-Type" {
					mimeType = header.Value
					break
				}
			}

			if strings.Contains(mimeType, "text/html") {
				htmlBody = content
			} else {
				textBody = content
			}
		}
	}

	// Recursively check parts
	for _, part := range payload.Parts {
		partText, partHTML := s.extractGmailBody(part)
		if partText != "" {
			textBody = partText
		}
		if partHTML != "" {
			htmlBody = partHTML
		}
	}

	return textBody, htmlBody
}

// extractGmailAttachments extracts attachment metadata from Gmail message payload
// If downloadContent is true and service/messageId are provided, it will also download attachment content

func (s *FetcherService) extractGmailAttachments(payload *gmail.MessagePart, service *gmail.Service, messageId string, downloadContent bool) []models.Attachment {
	var attachments []models.Attachment

	// Helper function to recursively extract attachments
	var extractFromPart func(part *gmail.MessagePart)
	extractFromPart = func(part *gmail.MessagePart) {
		if part == nil {
			return
		}

		// Check if this part is an attachment
		// Attachments have a filename and/or Content-Disposition: attachment
		if part.Filename != "" && part.Body != nil {
			attachment := models.Attachment{
				Filename: part.Filename,
				MIMEType: part.MimeType,
				Size:     int64(part.Body.Size),
			}

			// Download attachment content if requested and attachmentId is available
			if downloadContent && service != nil && part.Body.AttachmentId != "" {
				content, err := s.downloadGmailAttachmentContent(service, messageId, part.Body.AttachmentId)
				if err != nil {
					s.logger.Warn("Failed to download attachment %s: %v", part.Filename, err)
				} else {
					attachment.Content = content
					s.logger.Debug("Downloaded attachment: %s (%d bytes)", part.Filename, len(content))
				}
			}

			attachments = append(attachments, attachment)
		}

		// Recursively check nested parts
		for _, nestedPart := range part.Parts {
			extractFromPart(nestedPart)
		}
	}

	// Start extraction from the root payload
	extractFromPart(payload)

	return attachments
}

// downloadGmailAttachmentContent downloads attachment content from Gmail API

func (s *FetcherService) downloadGmailAttachmentContent(service *gmail.Service, messageId, attachmentId string) ([]byte, error) {
	attachment, err := service.Users.Messages.Attachments.Get("me", messageId, attachmentId).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to get attachment: %w", err)
	}

	// Gmail API returns attachment data as URL-safe base64 encoded
	data, err := base64.URLEncoding.DecodeString(attachment.Data)
	if err != nil {
		// Try standard base64 as fallback
		data, err = base64.StdEncoding.DecodeString(attachment.Data)
		if err != nil {
			return nil, fmt.Errorf("failed to decode attachment data: %w", err)
		}
	}

	return data, nil
}

// convertGmailMessages batch converts Gmail messages to Email models

func (s *FetcherService) convertGmailMessages(messages []*gmail.Message, accountID uint) []models.Email {
	var emails []models.Email
	for _, msg := range messages {
		email, err := s.convertGmailMessage(msg, accountID)
		if err != nil {
			s.logger.Warn("Failed to convert Gmail message %s: %v", msg.Id, err)
			continue
		}
		emails = append(emails, *email)
	}
	return emails
}

// fetchGmailHistoryChanges fetches email changes using Gmail History API

func (s *FetcherService) fetchGmailHistoryChanges(service *gmail.Service, startHistoryID string, accountID uint, options FetchEmailsOptions) ([]models.Email, string, error) {
	s.logger.Debug("Fetching Gmail history changes from History ID: %s", startHistoryID)
	ctx := options.contextOrBackground()

	// Parse start history ID
	historyID, err := strconv.ParseUint(startHistoryID, 10, 64)
	if err != nil {
		return nil, "", fmt.Errorf("invalid history ID: %w", err)
	}

	// Get Gmail label ID for the specified mailbox for later filtering
	var targetLabelID string
	if options.Mailbox != "" && options.Mailbox != "INBOX" {
		targetLabelID, err = s.getGmailLabelID(ctx, service, options.Mailbox)
		if err != nil {
			s.logger.Warn("Failed to get Gmail label ID for mailbox '%s': %v", options.Mailbox, err)
			// Continue without label filter
		}
	} else {
		targetLabelID = "INBOX"
	}

	// Call History API WITHOUT label filter to get all changes
	// This ensures we don't miss new emails that haven't been labeled yet
	historyCall := service.Users.History.List("me").StartHistoryId(historyID)
	// DO NOT set LabelId filter here - we want all changes

	s.logger.Debug("Calling History API without label filter to capture all changes")
	historyResp, err := historyCall.Context(ctx).Do()
	if err != nil {
		return nil, "", fmt.Errorf("failed to get history: %w", err)
	}

	if len(historyResp.History) == 0 {
		s.logger.Debug("No history changes found")
		return []models.Email{}, fmt.Sprintf("%d", historyResp.HistoryId), nil
	}

	// Collect unique message IDs from history changes
	messageIDSet := make(map[string]bool)
	for _, history := range historyResp.History {
		// Messages added
		for _, msgAdded := range history.MessagesAdded {
			if msgAdded.Message != nil {
				messageIDSet[msgAdded.Message.Id] = true
			}
		}
		// Messages deleted - we could handle this differently if needed
		for _, msgDeleted := range history.MessagesDeleted {
			if msgDeleted.Message != nil {
				// For now, we'll still fetch it to mark as deleted in our system
				messageIDSet[msgDeleted.Message.Id] = true
			}
		}
		// Label changes
		for _, labelAdded := range history.LabelsAdded {
			if labelAdded.Message != nil {
				messageIDSet[labelAdded.Message.Id] = true
			}
		}
		for _, labelRemoved := range history.LabelsRemoved {
			if labelRemoved.Message != nil {
				messageIDSet[labelRemoved.Message.Id] = true
			}
		}
	}

	s.logger.Debug("Found %d unique message IDs in history changes", len(messageIDSet))

	// Fetch full message details for changed messages
	var messages []*gmail.Message
	for messageID := range messageIDSet {
		if err := ctx.Err(); err != nil {
			return nil, "", err
		}
		msg, err := service.Users.Messages.Get("me", messageID).Context(ctx).Do()
		if err != nil {
			s.logger.Warn("Failed to get message %s: %v", messageID, err)
			continue
		}
		messages = append(messages, msg)
	}

	// Filter messages by target label if specified
	var filteredByLabel []*gmail.Message
	if targetLabelID != "" {
		for _, msg := range messages {
			// Check if message has the target label
			hasTargetLabel := false
			for _, labelID := range msg.LabelIds {
				if labelID == targetLabelID {
					hasTargetLabel = true
					break
				}
			}
			if hasTargetLabel {
				filteredByLabel = append(filteredByLabel, msg)
			}
		}
		s.logger.Debug("Filtered %d messages by label '%s' (target: %s)", len(filteredByLabel), options.Mailbox, targetLabelID)
	} else {
		filteredByLabel = messages
	}

	// Apply additional options filters (date, search query, etc.)
	filteredMessages := s.filterGmailMessages(filteredByLabel, options)

	s.logger.Info("Found %d changed messages in history, %d after label filtering, %d after all filters", len(messages), len(filteredByLabel), len(filteredMessages))

	// Convert to Email models
	emails := s.convertGmailMessages(filteredMessages, accountID)

	return emails, fmt.Sprintf("%d", historyResp.HistoryId), nil
}

// filterGmailMessages applies filtering options to Gmail messages

func (s *FetcherService) filterGmailMessages(messages []*gmail.Message, options FetchEmailsOptions) []*gmail.Message {
	var filtered []*gmail.Message

	for _, msg := range messages {
		// Apply date filter
		if options.StartDate != nil || options.EndDate != nil {
			msgDate := s.getGmailMessageDate(msg)
			if msgDate.IsZero() {
				continue // Skip messages without valid date
			}

			if options.StartDate != nil && msgDate.Before(*options.StartDate) {
				continue
			}
			if options.EndDate != nil && msgDate.After(*options.EndDate) {
				continue
			}
		}

		// Apply search query filter (basic implementation)
		if options.SearchQuery != "" {
			if !s.messageMatchesQuery(msg, options.SearchQuery) {
				continue
			}
		}

		filtered = append(filtered, msg)

		// Apply limit
		if options.Limit > 0 && len(filtered) >= options.Limit {
			break
		}
	}

	return filtered
}

// getGmailMessageDate extracts date from Gmail message headers

func (s *FetcherService) getGmailMessageDate(msg *gmail.Message) time.Time {
	if msg.Payload == nil {
		return time.Time{}
	}

	for _, header := range msg.Payload.Headers {
		if header.Name == "Date" {
			// Try multiple date formats to handle Gmail's various date formats
			dateFormats := []string{
				time.RFC1123Z,                    // "Mon, 02 Jan 2006 15:04:05 -0700"
				time.RFC1123,                     // "Mon, 02 Jan 2006 15:04:05 MST"
				"Mon, 2 Jan 2006 15:04:05 -0700", // Gmail format without leading zero
				"Mon, 2 Jan 2006 15:04:05 MST",   // Gmail format without leading zero (MST)
				"2 Jan 2006 15:04:05 -0700",      // Without weekday
				"2006-01-02 15:04:05 -0700",      // ISO-like format
				time.RFC3339,                     // "2006-01-02T15:04:05Z07:00"
			}

			for _, format := range dateFormats {
				if parsedDate, err := time.Parse(format, header.Value); err == nil {
					return parsedDate
				}
			}

			// Log if date parsing fails
			s.logger.Warn("Failed to parse date '%s' for message %s", header.Value, msg.Id)
		}
	}
	return time.Time{}
}

// messageMatchesQuery checks if a Gmail message matches the search query

func (s *FetcherService) messageMatchesQuery(msg *gmail.Message, query string) bool {
	query = strings.ToLower(query)

	// Check snippet
	if strings.Contains(strings.ToLower(msg.Snippet), query) {
		return true
	}

	// Check headers
	if msg.Payload != nil {
		for _, header := range msg.Payload.Headers {
			headerValue := strings.ToLower(header.Value)
			if strings.Contains(headerValue, query) {
				return true
			}
		}
	}

	return false
}

// getGmailLabelID dynamically gets the Gmail label ID for a given mailbox name

func (s *FetcherService) getGmailLabelID(ctx context.Context, service *gmail.Service, mailboxName string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	// Get all labels from Gmail
	labelList, err := service.Users.Labels.List("me").Context(ctx).Do()
	if err != nil {
		return "", fmt.Errorf("failed to get labels: %w", err)
	}

	// First, try to match by exact name
	for _, label := range labelList.Labels {
		if label.Name == mailboxName {
			return label.Id, nil
		}
	}

	// If no exact match, try to match common mappings
	// Map IMAP folder names to Gmail system labels
	systemLabelMap := map[string]string{
		"INBOX":     "INBOX",
		"SENT":      "SENT",
		"DRAFTS":    "DRAFT",
		"TRASH":     "TRASH",
		"SPAM":      "SPAM",
		"IMPORTANT": "IMPORTANT",
		"STARRED":   "STARRED",
	}

	// Check if it's a system label
	if labelID, exists := systemLabelMap[strings.ToUpper(mailboxName)]; exists {
		return labelID, nil
	}

	// Try to find by matching common Gmail folder patterns
	for _, label := range labelList.Labels {
		// Match patterns like [Gmail]/已发邮件 with SENT label
		if strings.Contains(mailboxName, "已发邮件") || strings.Contains(mailboxName, "Sent Mail") {
			if label.Id == "SENT" {
				return label.Id, nil
			}
		}
		if strings.Contains(mailboxName, "已加星标") || strings.Contains(mailboxName, "Starred") {
			if label.Id == "STARRED" {
				return label.Id, nil
			}
		}
	}

	return "", fmt.Errorf("label not found: %s", mailboxName)
}

// fetchGmailHistoryChangesUnified fetches ALL email changes using Gmail History API without label filtering

func (s *FetcherService) fetchGmailHistoryChangesUnified(service *gmail.Service, startHistoryID string, accountID uint, options FetchEmailsOptions) ([]models.Email, string, error) {
	s.logger.Debug("=== Gmail History API Debug ===")
	s.logger.Debug("Starting History ID: %s", startHistoryID)
	ctx := options.contextOrBackground()

	// Parse start history ID
	historyID, err := strconv.ParseUint(startHistoryID, 10, 64)
	if err != nil {
		return nil, "", fmt.Errorf("invalid history ID: %w", err)
	}

	// Call History API WITH pagination handling to get ALL changes
	s.logger.Debug("Calling Gmail History API with startHistoryId=%d", historyID)

	// Collect unique message IDs from ALL history changes across all pages
	messageIDSet := make(map[string]bool)
	var finalHistoryID uint64
	pageToken := ""
	pageCount := 0

	for {
		if err := ctx.Err(); err != nil {
			return nil, "", err
		}
		historyCall := service.Users.History.List("me").StartHistoryId(historyID)
		if pageToken != "" {
			historyCall = historyCall.PageToken(pageToken)
		}

		historyResp, err := historyCall.Context(ctx).Do()
		if err != nil {
			s.logger.Error("Gmail History API call failed on page %d: %v", pageCount+1, err)
			return nil, "", fmt.Errorf("failed to get history: %w", err)
		}

		pageCount++
		finalHistoryID = historyResp.HistoryId

		s.logger.Debug("Gmail History API Response (page %d):", pageCount)
		s.logger.Debug("  - Current History ID: %d", historyResp.HistoryId)
		s.logger.Debug("  - History entries count: %d", len(historyResp.History))
		s.logger.Debug("  - Next Page Token: %s", historyResp.NextPageToken)

		// Process current page's history changes
		for _, history := range historyResp.History {
			// Messages added
			for _, msgAdded := range history.MessagesAdded {
				if msgAdded.Message != nil {
					messageIDSet[msgAdded.Message.Id] = true
				}
			}
			// Messages deleted
			for _, msgDeleted := range history.MessagesDeleted {
				if msgDeleted.Message != nil {
					messageIDSet[msgDeleted.Message.Id] = true
				}
			}
			// Label changes
			for _, labelAdded := range history.LabelsAdded {
				if labelAdded.Message != nil {
					messageIDSet[labelAdded.Message.Id] = true
				}
			}
			for _, labelRemoved := range history.LabelsRemoved {
				if labelRemoved.Message != nil {
					messageIDSet[labelRemoved.Message.Id] = true
				}
			}
		}

		// Check if there are more pages
		if historyResp.NextPageToken == "" {
			break
		}
		pageToken = historyResp.NextPageToken

		// Safety check to prevent infinite loops
		if pageCount >= 100 {
			s.logger.Warn("Reached maximum page limit (100) for History API, stopping pagination")
			break
		}
	}

	s.logger.Debug("Processed %d pages from Gmail History API", pageCount)

	if len(messageIDSet) == 0 {
		return []models.Email{}, fmt.Sprintf("%d", finalHistoryID), nil
	}

	s.logger.Debug("Found %d unique message IDs in unified history changes", len(messageIDSet))

	// Fetch full message details for all changed messages
	var messages []*gmail.Message
	for messageID := range messageIDSet {
		if err := ctx.Err(); err != nil {
			return nil, "", err
		}
		msg, err := service.Users.Messages.Get("me", messageID).Context(ctx).Do()
		if err != nil {
			s.logger.Warn("Failed to get message %s: %v", messageID, err)
			continue
		}
		messages = append(messages, msg)
	}

	// For incremental sync via History API, we don't need date filtering
	// History API already provides incremental changes since last sync
	s.logger.Debug("Gmail unified incremental sync: found %d changed messages", len(messages))

	// Convert to Email models directly - Gmail labels are stored in LabelIds
	emails := s.convertGmailMessages(messages, accountID)

	return emails, fmt.Sprintf("%d", finalHistoryID), nil
}

// fetchGmailMessagesUnified fetches Gmail messages for full sync without label filtering with pagination

func (s *FetcherService) fetchGmailMessagesUnified(service *gmail.Service, options FetchEmailsOptions) ([]*gmail.Message, error) {
	s.logger.Debug("Fetching Gmail messages (unified full sync with pagination)")
	ctx := options.contextOrBackground()

	// Build query based on options (date, search) but NOT mailbox/labels
	query := s.buildGmailQueryUnified(options)

	// Set a higher limit per page for full sync with pagination support
	pageLimit := int64(500) // Increased from 100 to 500 per page
	totalLimit := int64(options.Limit)
	if totalLimit <= 0 {
		totalLimit = 1000 // Default total limit increased to 1000
	}

	s.logger.Debug("Fetching Gmail messages (unified) with query: %s, page_limit: %d, total_limit: %d", query, pageLimit, totalLimit)

	var allMessageRefs []*gmail.Message
	pageToken := ""
	pageCount := 0
	totalFetched := int64(0)

	// Paginate through all message lists
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		listCall := service.Users.Messages.List("me").Q(query).MaxResults(pageLimit)
		if pageToken != "" {
			listCall = listCall.PageToken(pageToken)
		}

		listResp, err := listCall.Context(ctx).Do()
		if err != nil {
			s.logger.Error("Failed to list Gmail messages on page %d: %v", pageCount+1, err)
			return nil, fmt.Errorf("failed to list Gmail messages: %w", err)
		}

		pageCount++
		s.logger.Debug("Gmail Messages List API Response (page %d):", pageCount)
		s.logger.Debug("  - Messages count: %d", len(listResp.Messages))
		s.logger.Debug("  - Next Page Token: %s", listResp.NextPageToken)

		if len(listResp.Messages) == 0 {
			break
		}

		// Add messages from this page
		for _, msgRef := range listResp.Messages {
			if totalFetched >= totalLimit {
				s.logger.Info("Reached total limit of %d messages", totalLimit)
				goto fetchDetails
			}
			allMessageRefs = append(allMessageRefs, &gmail.Message{Id: msgRef.Id})
			totalFetched++
		}

		// Check if there are more pages
		if listResp.NextPageToken == "" {
			break
		}
		pageToken = listResp.NextPageToken

		// Safety check to prevent infinite loops
		if pageCount >= 50 {
			s.logger.Warn("Reached maximum page limit (50) for Messages List API, stopping pagination")
			break
		}
	}

fetchDetails:
	s.logger.Debug("Processed %d pages from Gmail Messages List API, collected %d message IDs", pageCount, len(allMessageRefs))

	if len(allMessageRefs) == 0 {
		s.logger.Debug("No messages found in unified full sync")
		return []*gmail.Message{}, nil
	}

	// Fetch full message details for all collected messages
	var messages []*gmail.Message
	for i, msgRef := range allMessageRefs {
		if err := ctx.Err(); err != nil {
			return messages, err
		}
		msg, err := service.Users.Messages.Get("me", msgRef.Id).Context(ctx).Do()
		if err != nil {
			s.logger.Warn("Failed to get message %s: %v", msgRef.Id, err)
			continue
		}
		messages = append(messages, msg)

		// Log progress for large batches
		if i > 0 && i%100 == 0 {
			s.logger.Info("Fetched details for %d/%d messages...", i, len(allMessageRefs))
		}
	}

	s.logger.Debug("Gmail unified full sync: fetched %d messages across %d pages", len(messages), pageCount)
	return messages, nil
}

// buildGmailQueryUnified builds Gmail search query without label filters

func (s *FetcherService) buildGmailQueryUnified(options FetchEmailsOptions) string {
	var queryParts []string

	// Date filter
	if options.StartDate != nil {
		queryParts = append(queryParts, fmt.Sprintf("after:%s", options.StartDate.Format("2006/01/02")))
	}
	if options.EndDate != nil {
		queryParts = append(queryParts, fmt.Sprintf("before:%s", options.EndDate.Format("2006/01/02")))
	}

	// Search query
	if options.SearchQuery != "" {
		queryParts = append(queryParts, options.SearchQuery)
	}

	query := strings.Join(queryParts, " ")
	if query == "" {
		query = "in:anywhere" // Get everything
	}

	return query
}

// filterGmailMessagesUnified applies unified filtering (date, search, NOT labels)

func (s *FetcherService) filterGmailMessagesUnified(messages []*gmail.Message, options FetchEmailsOptions) []*gmail.Message {
	var filtered []*gmail.Message

	for _, msg := range messages {
		// Apply date filter
		if options.StartDate != nil || options.EndDate != nil {
			msgDate := s.getGmailMessageDate(msg)
			if msgDate.IsZero() {
				continue // Skip messages without valid date
			}

			if options.StartDate != nil && msgDate.Before(*options.StartDate) {
				continue
			}
			if options.EndDate != nil && msgDate.After(*options.EndDate) {
				continue
			}
		}

		// Apply search filter
		if options.SearchQuery != "" {
			if !s.messageMatchesQuery(msg, options.SearchQuery) {
				continue
			}
		}

		// No label filtering - we want all messages with their labels intact
		filtered = append(filtered, msg)
	}

	return filtered
}

// Helper function to match Gmail labels with mailbox names

func (s *FetcherService) matchGmailLabelToMailbox(mailboxName string, labels []*gmail.Label) (string, error) {
	for _, label := range labels {
		if strings.Contains(mailboxName, "重要邮件") || strings.Contains(mailboxName, "Important") {
			if label.Id == "IMPORTANT" {
				return label.Id, nil
			}
		}
		if strings.Contains(mailboxName, "草稿") || strings.Contains(mailboxName, "Drafts") {
			if label.Id == "DRAFT" {
				return label.Id, nil
			}
		}
		if strings.Contains(mailboxName, "垃圾邮件") || strings.Contains(mailboxName, "Spam") {
			if label.Id == "SPAM" {
				return label.Id, nil
			}
		}
		if strings.Contains(mailboxName, "回收站") || strings.Contains(mailboxName, "Trash") {
			if label.Id == "TRASH" {
				return label.Id, nil
			}
		}
	}

	// If still no match, return empty string (no label filter)
	s.logger.Warn("Could not find Gmail label for mailbox: %s", mailboxName)
	return "", fmt.Errorf("label not found for mailbox: %s", mailboxName)
}

// getGmailMailboxes retrieves all Gmail labels as mailboxes using Gmail API

func (s *FetcherService) getGmailMailboxes(account models.EmailAccount) ([]models.Mailbox, error) {
	s.logger.Debug("Getting Gmail mailboxes using Gmail API for account %s", account.EmailAddress)

	// Create Gmail API service
	ctx := context.Background()
	gmailService, err := s.createGmailService(ctx, account)
	if err != nil {
		s.logger.Error("Failed to create Gmail service: %v", err)
		return nil, fmt.Errorf("failed to create Gmail service: %w", err)
	}

	// Get all labels from Gmail
	labelList, err := gmailService.Users.Labels.List("me").Context(ctx).Do()
	if err != nil {
		s.logger.Error("Failed to get Gmail labels: %v", err)
		return nil, fmt.Errorf("failed to get Gmail labels: %w", err)
	}

	var mailboxes []models.Mailbox
	for _, label := range labelList.Labels {
		mailbox := models.Mailbox{
			Name:      label.Name,
			AccountID: account.ID,
			Delimiter: "/", // Gmail uses forward slash as delimiter
		}

		// Convert label type to flags
		switch label.Type {
		case "system":
			mailbox.Flags = append(mailbox.Flags, "\\System")
		case "user":
			mailbox.Flags = append(mailbox.Flags, "\\User")
		}

		// Add visibility flags
		if label.LabelListVisibility == "labelShow" {
			mailbox.Flags = append(mailbox.Flags, "\\Visible")
		}
		if label.MessageListVisibility == "show" {
			mailbox.Flags = append(mailbox.Flags, "\\MessageShow")
		}

		mailboxes = append(mailboxes, mailbox)
	}

	s.logger.Info("Successfully retrieved %d Gmail labels as mailboxes for account %s", len(mailboxes), account.EmailAddress)
	return mailboxes, nil
}

// GetAccountByEmail gets an email account by email address

func (s *FetcherService) SyncGmailEmailAttachments(account models.EmailAccount, messageID string, downloadContent bool) ([]models.Attachment, error) {
	s.logger.Debug("Syncing Gmail attachments for message %s, downloadContent: %v", messageID, downloadContent)

	// Create Gmail service
	ctx := context.Background()
	gmailService, err := s.createGmailService(ctx, account)
	if err != nil {
		return nil, fmt.Errorf("failed to create Gmail service: %w", err)
	}

	// The messageID stored in database is the RFC 5322 Message-ID (e.g., <CAOmLee...@mail.gmail.com>)
	// Gmail API requires its internal message ID, so we need to search by rfc822msgid
	var gmailMsgID string

	// Strip angle brackets if present for the search query
	searchID := strings.TrimPrefix(messageID, "<")
	searchID = strings.TrimSuffix(searchID, ">")

	// Search for the message using rfc822msgid
	query := fmt.Sprintf("rfc822msgid:%s", searchID)
	s.logger.Debug("Searching Gmail with query: %s", query)

	listResp, err := gmailService.Users.Messages.List("me").Q(query).MaxResults(1).Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to search for message: %w", err)
	}

	if len(listResp.Messages) == 0 {
		return nil, fmt.Errorf("message not found in Gmail with Message-ID: %s", messageID)
	}

	gmailMsgID = listResp.Messages[0].Id
	s.logger.Debug("Found Gmail message ID: %s for RFC Message-ID: %s", gmailMsgID, messageID)

	// Fetch the full message using Gmail's internal ID
	msg, err := gmailService.Users.Messages.Get("me", gmailMsgID).Context(ctx).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to get message: %w", err)
	}

	if msg.Payload == nil {
		return []models.Attachment{}, nil
	}

	// Extract attachments with content download
	attachments := s.extractGmailAttachments(msg.Payload, gmailService, gmailMsgID, downloadContent)

	s.logger.Debug("Synced %d attachments for message %s", len(attachments), messageID)
	return attachments, nil
}

// SyncIMAPEmailAttachments fetches and parses attachments for a specific IMAP email
