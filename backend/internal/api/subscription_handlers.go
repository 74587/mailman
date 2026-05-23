package api

import (
	"encoding/json"
	"fmt"
	"mailman/internal/models"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

// CreateSubscriptionHandler creates a new email subscription
// @Summary Create email subscription
// @Description Create a new email subscription for real-time monitoring
// @Tags subscriptions
// @Accept json
// @Produce json
// @Param request body CreateSubscriptionRequest true "Subscription configuration"
// @Success 201 {object} SubscriptionResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/subscriptions [post]
func (h *APIHandler) CreateSubscriptionHandler(w http.ResponseWriter, r *http.Request) {
	var req CreateSubscriptionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate account exists
	account, err := h.EmailAccountRepo.GetByID(req.AccountID)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// Set defaults
	if req.Mailbox == "" {
		req.Mailbox = "INBOX"
	}
	if req.PollingInterval <= 0 {
		req.PollingInterval = 60
	} else if req.PollingInterval < 30 {
		req.PollingInterval = 30 // Minimum 30 seconds
	}

	// Create subscription
	subscriptionID, err := h.EmailScheduler.SubscribeSimple(
		account.ID,
		account.EmailAddress, // 传递真实的邮箱地址
		req.Mailbox,
		time.Duration(req.PollingInterval)*time.Second,
		req.IncludeBody,
		req.Filters,
	)
	if err != nil {
		http.Error(w, "Failed to create subscription: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Get subscription details
	subscription := h.EmailScheduler.GetSubscription(subscriptionID)
	if subscription == nil {
		http.Error(w, "Failed to retrieve created subscription", http.StatusInternalServerError)
		return
	}

	// Log activity
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivitySubscribed,
		"创建邮件订阅",
		fmt.Sprintf("为账户 %s 创建了邮件订阅，邮箱: %s，轮询间隔: %d秒", account.EmailAddress, req.Mailbox, req.PollingInterval),
		userID,
		map[string]interface{}{
			"subscription_id":  subscriptionID,
			"account_id":       account.ID,
			"mailbox":          req.Mailbox,
			"polling_interval": req.PollingInterval,
			"include_body":     req.IncludeBody,
		},
	)

	// Build response
	response := SubscriptionResponse{
		ID:              subscriptionID,
		AccountID:       account.ID,
		EmailAddress:    account.EmailAddress,
		Mailbox:         req.Mailbox,
		PollingInterval: req.PollingInterval,
		IncludeBody:     req.IncludeBody,
		Filters:         req.Filters,
		Status:          "active",
		CreatedAt:       time.Now(),
		NextCheckAt:     subscription.NextRunAt,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// GetSubscriptionsHandler retrieves all active subscriptions
// @Summary List email subscriptions
// @Description Get all active email subscriptions
// @Tags subscriptions
// @Accept json
// @Produce json
// @Param account_id query int false "Filter by account ID"
// @Success 200 {object} SubscriptionListResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/subscriptions [get]
func (h *APIHandler) GetSubscriptionsHandler(w http.ResponseWriter, r *http.Request) {
	// Parse optional account ID filter
	var accountID uint
	if accountIDStr := r.URL.Query().Get("account_id"); accountIDStr != "" {
		if id, err := strconv.ParseUint(accountIDStr, 10, 32); err == nil {
			accountID = uint(id)
		}
	}

	// Get all subscriptions
	allSubscriptions := h.EmailScheduler.GetAllSubscriptions()

	// Build response
	subscriptions := []SubscriptionResponse{} // Initialize as empty slice instead of nil
	for _, sub := range allSubscriptions {
		// Extract account ID from metadata
		var subAccountID uint
		if accountIDMeta, ok := sub.Metadata["accountID"].(uint); ok {
			subAccountID = accountIDMeta
		} else if accountIDMeta, ok := sub.Metadata["accountID"].(float64); ok {
			subAccountID = uint(accountIDMeta)
		}

		// Apply account filter if specified
		if accountID != 0 && subAccountID != accountID {
			continue
		}

		// Get account details
		account, err := h.EmailAccountRepo.GetByID(subAccountID)
		if err != nil {
			continue // Skip if account not found
		}

		// Extract other metadata
		mailbox := "INBOX"
		if len(sub.Filter.Folders) > 0 {
			mailbox = sub.Filter.Folders[0]
		}

		interval := 60
		if intervalMeta, ok := sub.Metadata["interval"].(time.Duration); ok {
			interval = int(intervalMeta.Seconds())
		}

		includeBody := false
		if includeBodyMeta, ok := sub.Metadata["includeBody"].(bool); ok {
			includeBody = includeBodyMeta
		}

		var filters *SubscriptionFilters
		if filtersMeta, ok := sub.Metadata["filters"].(*SubscriptionFilters); ok {
			filters = filtersMeta
		}

		status := "active"
		if sub.Context.Err() != nil {
			status = "cancelled"
		} else if sub.ExpiresAt != nil && time.Now().After(*sub.ExpiresAt) {
			status = "expired"
		}

		subscriptions = append(subscriptions, SubscriptionResponse{
			ID:              sub.ID,
			AccountID:       subAccountID,
			EmailAddress:    account.EmailAddress,
			Mailbox:         mailbox,
			PollingInterval: interval,
			IncludeBody:     includeBody,
			Filters:         filters,
			Status:          status,
			CreatedAt:       sub.CreatedAt,
			LastCheckedAt:   sub.LastEmailAt,
			NextCheckAt:     sub.NextRunAt,
		})
	}

	response := SubscriptionListResponse{
		Subscriptions: subscriptions,
		Total:         len(subscriptions),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteSubscriptionHandler cancels an email subscription
// @Summary Cancel email subscription
// @Description Cancel an active email subscription
// @Tags subscriptions
// @Accept json
// @Produce json
// @Param id path string true "Subscription ID"
// @Success 204 "No Content"
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/subscriptions/{id} [delete]
func (h *APIHandler) DeleteSubscriptionHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	subscriptionID := vars["id"]

	if subscriptionID == "" {
		http.Error(w, "Subscription ID is required", http.StatusBadRequest)
		return
	}

	// Check if subscription exists
	subscription := h.EmailScheduler.GetSubscription(subscriptionID)
	if subscription == nil {
		http.Error(w, "Subscription not found", http.StatusNotFound)
		return
	}

	// Get subscription metadata for logging
	var accountEmail string
	if accountIDMeta, ok := subscription.Metadata["accountID"].(uint); ok {
		if account, err := h.EmailAccountRepo.GetByID(accountIDMeta); err == nil {
			accountEmail = account.EmailAddress
		}
	}

	// Unsubscribe
	if err := h.EmailScheduler.Unsubscribe(subscriptionID); err != nil {
		http.Error(w, "Failed to cancel subscription: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log activity
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityUnsubscribed,
		"取消邮件订阅",
		fmt.Sprintf("取消了订阅 %s，账户: %s", subscriptionID, accountEmail),
		userID,
		map[string]interface{}{
			"subscription_id": subscriptionID,
			"account_email":   accountEmail,
		},
	)

	w.WriteHeader(http.StatusNoContent)
}
