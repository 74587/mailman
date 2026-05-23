package api

import (
	"encoding/json"
	"mailman/internal/services"
	"net/http"
)

// EmailSendHandlers handles email sending operations
type EmailSendHandlers struct {
	emailSender *services.EmailSenderService
}

// NewEmailSendHandlers creates a new EmailSendHandlers
func NewEmailSendHandlers(emailSender *services.EmailSenderService) *EmailSendHandlers {
	return &EmailSendHandlers{
		emailSender: emailSender,
	}
}

// SendEmailRequest represents the request to send an email
type SendEmailRequest struct {
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

// SendEmailResponse represents the response from sending an email
type SendEmailResponse struct {
	Success   bool   `json:"success"`
	MessageID string `json:"messageId,omitempty"`
	Error     string `json:"error,omitempty"`
}

// SendEmailHandler handles email sending requests
// @Summary Send an email
// @Description Send an email using the specified account
// @Tags emails
// @Accept json
// @Produce json
// @Param request body SendEmailRequest true "Email send request"
// @Success 200 {object} SendEmailResponse
// @Failure 400 {object} SendEmailResponse
// @Failure 500 {object} SendEmailResponse
// @Router /api/emails/send [post]
func (h *EmailSendHandlers) SendEmailHandler(w http.ResponseWriter, r *http.Request) {
	var req SendEmailRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SendEmailResponse{
			Success: false,
			Error:   "请求格式错误: " + err.Error(),
		})
		return
	}

	// Convert to service request
	serviceReq := &services.EmailSendRequest{
		AccountID:   req.AccountID,
		To:          req.To,
		Cc:          req.Cc,
		Bcc:         req.Bcc,
		Subject:     req.Subject,
		HtmlContent: req.HtmlContent,
		TextContent: req.TextContent,
	}

	// Convert attachments
	if len(req.Attachments) > 0 {
		serviceReq.Attachments = make([]services.EmailAttachment, len(req.Attachments))
		for i, att := range req.Attachments {
			serviceReq.Attachments[i] = services.EmailAttachment{
				Filename:    att.Filename,
				ContentType: att.ContentType,
				Content:     att.Content,
			}
		}
	}

	// Send email
	result, err := h.emailSender.SendEmail(serviceReq)

	w.Header().Set("Content-Type", "application/json")

	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(SendEmailResponse{
			Success: false,
			Error:   result.Error,
		})
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(SendEmailResponse{
		Success:   result.Success,
		MessageID: result.MessageID,
	})
}
