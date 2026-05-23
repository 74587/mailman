package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"github.com/gorilla/mux"
	"gorm.io/gorm"
)

// SyncAttachmentsRequest represents the request body for syncing attachments
type SyncAttachmentsRequest struct {
	ForceDownload bool `json:"force_download"` // Force download even if system config is disabled
}

// SyncAttachmentsResponse represents the response for syncing attachments
type SyncAttachmentsResponse struct {
	Success          bool   `json:"success"`
	Message          string `json:"message"`
	AttachmentsCount int    `json:"attachments_count"`
}

// EmailAttachmentHandlers handles email attachment related API endpoints
type EmailAttachmentHandlers struct {
	db             *gorm.DB
	emailRepo      *repository.EmailRepository
	accountRepo    *repository.EmailAccountRepository
	fetcherService *services.FetcherService
}

// NewEmailAttachmentHandlers creates a new EmailAttachmentHandlers
func NewEmailAttachmentHandlers(db *gorm.DB) *EmailAttachmentHandlers {
	return &EmailAttachmentHandlers{
		db:             db,
		emailRepo:      repository.NewEmailRepository(db),
		accountRepo:    repository.NewEmailAccountRepository(db),
		fetcherService: services.NewFetcherService(repository.NewEmailAccountRepository(db), repository.NewEmailRepository(db), db),
	}
}

// SyncEmailAttachments syncs attachments for a specific email
// @Summary Sync email attachments
// @Description Re-fetch email from server and download attachment content
// @Tags Emails
// @Accept json
// @Produce json
// @Param id path int true "Email ID"
// @Param body body SyncAttachmentsRequest false "Sync options"
// @Success 200 {object} SyncAttachmentsResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /emails/{id}/sync-attachments [post]
func (h *EmailAttachmentHandlers) SyncEmailAttachments(w http.ResponseWriter, r *http.Request) {
	// Parse email ID from URL
	vars := mux.Vars(r)
	emailIDStr := vars["id"]
	emailID, err := strconv.ParseUint(emailIDStr, 10, 32)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Invalid email ID",
			Code:  http.StatusBadRequest,
		})
		return
	}

	// Parse request body (optional)
	var req SyncAttachmentsRequest
	_ = json.NewDecoder(r.Body).Decode(&req) // Ignore error, use defaults if not provided

	// Get email from database
	email, err := h.emailRepo.GetByID(uint(emailID))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error: "Email not found",
			Code:  http.StatusNotFound,
		})
		return
	}

	// Get associated account
	account, err := h.accountRepo.GetByID(email.AccountID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error:   "Failed to get email account",
			Code:    http.StatusInternalServerError,
			Details: err.Error(),
		})
		return
	}

	// Sync attachments based on account type
	var attachments []models.Attachment

	if h.isGmailAccount(account) {
		attachments, err = h.syncGmailAttachments(account, email, req.ForceDownload)
	} else {
		attachments, err = h.syncIMAPAttachments(account, email)
	}

	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{
			Error:   "Failed to sync attachments",
			Code:    http.StatusInternalServerError,
			Details: err.Error(),
		})
		return
	}

	// Delete existing attachments for this email and save new ones
	if err := h.db.Where("email_id = ?", email.ID).Delete(&models.Attachment{}).Error; err != nil {
		log.Printf("[EmailAttachment] Warning: Failed to delete old attachments: %v", err)
	}

	// Save new attachments
	for i := range attachments {
		attachments[i].EmailID = email.ID
		if err := h.db.Create(&attachments[i]).Error; err != nil {
			log.Printf("[EmailAttachment] Warning: Failed to save attachment %s: %v", attachments[i].Filename, err)
		}
	}

	// Update email HasAttachments flag
	email.HasAttachments = len(attachments) > 0
	if err := h.db.Model(&models.Email{}).Where("id = ?", email.ID).Update("has_attachments", email.HasAttachments).Error; err != nil {
		log.Printf("[EmailAttachment] Warning: Failed to update HasAttachments flag: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(SyncAttachmentsResponse{
		Success:          true,
		Message:          fmt.Sprintf("Successfully synced %d attachments", len(attachments)),
		AttachmentsCount: len(attachments),
	})
}

// isGmailAccount checks if the account is a Gmail OAuth2 account
func (h *EmailAttachmentHandlers) isGmailAccount(account *models.EmailAccount) bool {
	if account.AuthType != models.AuthTypeOAuth2 {
		return false
	}
	// Check provider type through OAuth2 provider
	if account.OAuth2ProviderID == nil {
		return false
	}
	// Try to determine if it's Gmail by checking the email domain
	return isGmailEmail(account.EmailAddress)
}

// isGmailEmail checks if an email address belongs to Gmail
func isGmailEmail(email string) bool {
	domains := []string{"@gmail.com", "@googlemail.com"}
	for _, domain := range domains {
		if len(email) > len(domain) && email[len(email)-len(domain):] == domain {
			return true
		}
	}
	return false
}

// syncGmailAttachments syncs attachments for a Gmail account email
func (h *EmailAttachmentHandlers) syncGmailAttachments(account *models.EmailAccount, email *models.Email, forceDownload bool) ([]models.Attachment, error) {
	// Use the fetcher service to sync Gmail attachments
	return h.fetcherService.SyncGmailEmailAttachments(*account, email.MessageID, forceDownload)
}

// syncIMAPAttachments syncs attachments for an IMAP account email
func (h *EmailAttachmentHandlers) syncIMAPAttachments(account *models.EmailAccount, email *models.Email) ([]models.Attachment, error) {
	// Use the fetcher service to re-fetch and parse the email
	return h.fetcherService.SyncIMAPEmailAttachments(*account, email.MessageID)
}
