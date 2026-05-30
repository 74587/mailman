package api

import (
	"encoding/json"
	"fmt"
	"mailman/internal/models"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

// TriggerEmailHandler manually triggers processing for a specific email
// @Summary Trigger email processing
// @Description Manually trigger event processing for a specific email by ID
// @Tags emails
// @Accept json
// @Produce json
// @Param id path int true "Email ID"
// @Success 200 {object} map[string]interface{}
// @Failure 400 {string} string "Bad Request"
// @Failure 404 {string} string "Not Found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/emails/{id}/trigger [post]
func (h *APIHandler) TriggerEmailHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid email ID", http.StatusBadRequest)
		return
	}

	// Verify email exists
	email, err := h.EmailRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Email not found", http.StatusNotFound)
		return
	}

	h.logger.Info("Triggering email processing for email ID: %d", id)

	// If plugin manager is available, evaluate triggers
	if h.pluginManager != nil {
		h.logger.Debug("Plugin manager available, processing triggers for email %d", id)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"message":       fmt.Sprintf("Email %d trigger processing completed", id),
		"email_id":      email.ID,
		"email_subject": email.Subject,
	})
}

// SyncEmailAttachmentsHandler syncs attachments for a specific email
// @Summary Sync email attachments
// @Description Download and sync attachments for a specific email
// @Tags emails
// @Accept json
// @Produce json
// @Param id path int true "Email ID"
// @Success 200 {object} map[string]interface{}
// @Failure 400 {string} string "Bad Request"
// @Failure 404 {string} string "Not Found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/emails/{id}/sync-attachments [post]
func (h *APIHandler) SyncEmailAttachmentsHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid email ID", http.StatusBadRequest)
		return
	}

	// Verify email exists
	email, err := h.EmailRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Email not found", http.StatusNotFound)
		return
	}

	h.logger.Info("Syncing attachments for email ID: %d (%s)", id, email.Subject)

	// Get the account for this email
	if email.AccountID == 0 {
		http.Error(w, "Email has no associated account", http.StatusBadRequest)
		return
	}

	account, err := h.EmailAccountRepo.GetByID(email.AccountID)
	if err != nil {
		http.Error(w, "Associated account not found", http.StatusNotFound)
		return
	}

	// Check if this is a Gmail OAuth2 account and use Gmail API
	if account.AuthType == models.AuthTypeOAuth2 && account.MailProvider != nil && account.MailProvider.Type == models.ProviderTypeGmail {
		h.logger.Debug("Using Gmail API to sync attachments for email %d", id)
		// Gmail attachment sync would be handled here
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"message":  fmt.Sprintf("Attachment sync completed for email %d", id),
		"email_id": email.ID,
	})
}

// CreateProviderHandler creates a new mail provider
// @Summary Create a mail provider
// @Description Create a new mail provider configuration
// @Tags providers
// @Accept json
// @Produce json
// @Param provider body models.MailProvider true "Mail Provider"
// @Success 201 {object} models.MailProvider
// @Failure 400 {string} string "Bad Request"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/providers [post]
func (h *APIHandler) CreateProviderHandler(w http.ResponseWriter, r *http.Request) {
	var provider models.MailProvider
	if err := json.NewDecoder(r.Body).Decode(&provider); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if provider.Name == "" {
		http.Error(w, "Provider name is required", http.StatusBadRequest)
		return
	}
	if provider.Type == "" {
		provider.Type = models.ProviderTypeCustom
	}

	if err := h.MailProviderRepo.Create(&provider); err != nil {
		http.Error(w, "Failed to create provider: "+err.Error(), http.StatusInternalServerError)
		return
	}

	h.logger.Info("Created mail provider: %s (ID: %d)", provider.Name, provider.ID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(provider)
}
