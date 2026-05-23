package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"mailman/internal/models"
	"mailman/internal/services"
	"mailman/internal/utils"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins for development
		return true
	},
}

// WebSocketMessage represents a message sent over WebSocket
type WebSocketMessage struct {
	Type    string      `json:"type"`
	Data    interface{} `json:"data"`
	Error   string      `json:"error,omitempty"`
	Message string      `json:"message,omitempty"`
}

// SubscriptionWebSocketRequest represents the request for subscription-based email monitoring
type SubscriptionWebSocketRequest struct {
	Type           string `json:"type"` // "subscribe", "unsubscribe", "list"
	SubscriptionID string `json:"subscription_id,omitempty"`
}

// WaitEmailWebSocketRequest represents the request for WebSocket email waiting
type WaitEmailWebSocketRequest struct {
	AccountID *uint             `json:"accountId,omitempty"`
	Email     *string           `json:"email,omitempty"`
	Timeout   int               `json:"timeout"`
	Interval  int               `json:"interval"`
	StartTime *string           `json:"startTime,omitempty"`
	Extract   []ExtractorConfig `json:"extract,omitempty"`
}

// WaitEmailWebSocketHandler handles WebSocket connections for waiting for emails
func (h *APIHandler) WaitEmailWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	wsLogger := utils.NewLogger("WebSocket")
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		wsLogger.Error("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Read initial configuration
	var request WaitEmailWebSocketRequest
	if err := conn.ReadJSON(&request); err != nil {
		wsLogger.Error("Error reading WebSocket message: %v", err)
		conn.WriteJSON(WebSocketMessage{
			Type:  "error",
			Error: "Invalid request format",
		})
		return
	}

	// Validate input
	if (request.AccountID == nil && request.Email == nil) || (request.AccountID != nil && request.Email != nil) {
		conn.WriteJSON(WebSocketMessage{
			Type:  "error",
			Error: "Exactly one of accountId or email must be provided",
		})
		return
	}

	// Get account from database
	var account *models.EmailAccount
	if request.AccountID != nil {
		account, err = h.EmailAccountRepo.GetByID(*request.AccountID)
	} else {
		// Use GetByEmailOrAlias to handle aliases and domain emails
		account, err = h.EmailAccountRepo.GetByEmailOrAlias(*request.Email)
	}

	if err != nil {
		conn.WriteJSON(WebSocketMessage{
			Type:  "error",
			Error: "Account not found",
		})
		return
	}

	// Send initial connection success
	conn.WriteJSON(WebSocketMessage{
		Type:    "connected",
		Message: "Connected to email monitoring",
		Data: map[string]interface{}{
			"email":     account.EmailAddress,
			"accountId": account.ID,
		},
	})

	// Parse start time - support both RFC3339 string and Unix timestamp (milliseconds)
	var filterStartTime time.Time
	if request.StartTime != nil {
		// First try to parse as RFC3339
		if parsed, err := time.Parse(time.RFC3339, *request.StartTime); err == nil {
			filterStartTime = parsed.UTC() // 确保使用 UTC
		} else {
			// Try to parse as Unix timestamp in milliseconds
			if timestamp, err := time.Parse("2006-01-02T15:04:05.999Z07:00", *request.StartTime); err == nil {
				filterStartTime = timestamp.UTC()
			} else {
				// Try to parse as Unix milliseconds (e.g., "1703980800000")
				var unixMs int64
				if _, err := fmt.Sscanf(*request.StartTime, "%d", &unixMs); err == nil && unixMs > 0 {
					filterStartTime = time.Unix(unixMs/1000, (unixMs%1000)*1e6).UTC()
				} else {
					// Default to current time if parsing fails
					wsLogger.Warn("Failed to parse start time '%s', using current time", *request.StartTime)
					filterStartTime = time.Now().UTC()
				}
			}
		}
	} else {
		filterStartTime = time.Now().UTC()
	}

	// Log the parsed time for debugging
	wsLogger.Debug("Using filter start time: %s (UTC)", filterStartTime.Format(time.RFC3339))

	// Setup extractor service if needed
	var extractorService *services.ExtractorService
	var serviceExtractors []services.ExtractorConfig
	if len(request.Extract) > 0 {
		extractorService = services.NewExtractorService()
		for _, extractor := range request.Extract {
			serviceExtractors = append(serviceExtractors, services.ExtractorConfig{
				Field:   services.ExtractorField(extractor.Field),
				Type:    services.ExtractorType(extractor.Type),
				Match:   extractor.Match,
				Extract: extractor.Extract,
			})
		}
	}

	// Set default values
	if request.Interval <= 0 {
		request.Interval = 5 // Default 5 seconds
	}

	// Track processed email MessageIDs to avoid duplicates
	// 使用 MessageID 而不是数据库 ID，因为数据库 ID 可能会变化
	processedMessageIDs := make(map[string]bool)

	// Use fixed start time for fetching emails (not sliding window)
	// This ensures we don't miss emails between checks
	emailFetchStartTime := filterStartTime

	// Function to check and process emails
	checkAndProcessEmails := func() {
		currentCheckTime := time.Now()
		wsLogger.Debug("Checking emails for %s from %s to %s", account.EmailAddress, emailFetchStartTime.Format(time.RFC3339), currentCheckTime.Format(time.RFC3339))

		// Fetch recent emails from multiple mailboxes (including spam/junk)
		// Always use the initial start time to catch all emails since monitoring began
		options := services.FetchEmailsOptions{
			Mailbox:         "INBOX",
			Limit:           100, // 增加限制以获取更多邮件
			Offset:          0,
			StartDate:       &emailFetchStartTime,
			FetchFromServer: true,
			IncludeBody:     true, // 始终包含邮件内容，以便前端正确显示
			SortBy:          "date_desc",
		}

		// Log the fetch options for debugging
		wsLogger.Debug("Fetch options - StartDate: %s (Local: %s), Limit: %d, FetchFromServer: %v, IncludeBody: %v",
			emailFetchStartTime.Format(time.RFC3339), emailFetchStartTime.Local().Format("2006-01-02 15:04:05"),
			options.Limit, options.FetchFromServer, options.IncludeBody)
		wsLogger.Debug("Current time: %s (Local: %s)",
			currentCheckTime.Format(time.RFC3339), currentCheckTime.Local().Format("2006-01-02 15:04:05"))

		// Use the new method that fetches from multiple mailboxes including spam
		emails, err := h.Fetcher.FetchEmailsFromMultipleMailboxes(*account, options)
		if err != nil {
			wsLogger.Error("Error fetching emails during WebSocket wait: %v", err)
			conn.WriteJSON(WebSocketMessage{
				Type:    "error",
				Error:   "Error fetching emails",
				Message: err.Error(),
			})
			return
		}

		wsLogger.Debug("Fetched %d total emails for %s from server", len(emails), account.EmailAddress)

		// Log first few emails for debugging
		for i, email := range emails {
			if i < 5 { // 只记录前5封邮件
				wsLogger.Debug("Email %d - ID: %d, Subject: '%s', Date: %s (Local: %s), MessageID: %s",
					i+1, email.ID, email.Subject,
					email.Date.Format(time.RFC3339), email.Date.Local().Format("2006-01-02 15:04:05"),
					email.MessageID)
			}
		}

		// Process all emails that match our criteria
		emailsFound := 0
		for _, email := range emails {
			// Skip if already processed
			// 使用 MessageID 进行去重，如果没有 MessageID 则使用其他唯一标识
			messageKey := email.MessageID
			if messageKey == "" {
				// 使用邮件的多个属性组合作为唯一标识
				messageKey = fmt.Sprintf("%s_%s_%s_%d",
					email.Subject,
					email.From,
					email.Date.Format(time.RFC3339Nano),
					email.Size)
			}

			if processedMessageIDs[messageKey] {
				wsLogger.Debug("Skipping already processed email - MessageID: %s, Subject: '%s'",
					messageKey, email.Subject)
				continue
			}

			// Check if the email is within our monitoring time range
			// Only skip emails that are before our initial start time or in the future
			// 确保使用 UTC 进行比较
			emailDateUTC := email.Date.UTC()
			filterStartTimeUTC := filterStartTime.UTC()
			currentCheckTimeUTC := currentCheckTime.UTC()

			if emailDateUTC.Before(filterStartTimeUTC) || emailDateUTC.After(currentCheckTimeUTC) {
				wsLogger.Debug("Skipping email ID %d - Subject: '%s', From: %s, Date: %s (UTC) is outside monitoring window (started at %s UTC, current: %s UTC)",
					email.ID, email.Subject, email.From, emailDateUTC.Format(time.RFC3339),
					filterStartTimeUTC.Format(time.RFC3339), currentCheckTimeUTC.Format(time.RFC3339))
				continue
			}

			// Check if the email is addressed to the monitored email account
			if !isEmailAddressedToAccount(&email, account) {
				wsLogger.Debug("Skipping email ID %d - Subject: '%s', not addressed to %s (To: %v, Cc: %v, Bcc: %v)",
					email.ID, email.Subject, account.EmailAddress, email.To, email.Cc, email.Bcc)
				continue
			}

			// Mark as processed
			processedMessageIDs[messageKey] = true
			emailsFound++

			wsLogger.Info("Found matching email - MessageID: %s, ID: %d, Subject: '%s', From: %s, Date: %s, To: %v",
				messageKey, email.ID, email.Subject, email.From, email.Date.Format(time.RFC3339), email.To)

			// If no extractors, return the email
			if len(serviceExtractors) == 0 {
				conn.WriteJSON(WebSocketMessage{
					Type:    "email_found",
					Message: "Email found",
					Data: map[string]interface{}{
						"email": email,
					},
				})
				continue
			}

			// Check extractors
			result, err := extractorService.ExtractFromEmail(email, serviceExtractors)
			if err != nil {
				wsLogger.Error("Error extracting from email ID %d: %v", email.ID, err)
				continue
			}

			if result != nil && len(result.Matches) > 0 {
				conn.WriteJSON(WebSocketMessage{
					Type:    "email_found",
					Message: "Email found matching extraction criteria",
					Data: map[string]interface{}{
						"email":   email,
						"matches": result.Matches,
					},
				})
			}
		}

		wsLogger.Debug("Finished checking emails. Found %d matching emails out of %d total fetched", emailsFound, len(emails))
		// Note: We don't update the start time here - it remains fixed at filterStartTime
	}

	// First, check for existing emails immediately
	wsLogger.Info("Starting initial email check for %s", account.EmailAddress)
	checkAndProcessEmails()

	// Start monitoring for new emails
	interval := time.Duration(request.Interval) * time.Second
	checksPerformed := 0

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	startTime := time.Now()

	// Calculate timeout duration
	var timeoutDuration time.Duration
	if request.Timeout > 0 {
		timeoutDuration = time.Duration(request.Timeout) * time.Second
	} else {
		// Default to 24 hours if no timeout specified
		timeoutDuration = 24 * time.Hour
	}

	// Create a context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), timeoutDuration)
	defer cancel()

	// Monitor for client disconnect or stop message
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			default:
				var msg map[string]interface{}
				err := conn.ReadJSON(&msg)
				if err != nil {
					wsLogger.Info("Client disconnected for %s: %v", account.EmailAddress, err)
					cancel() // Cancel the context to stop all operations
					return
				}

				// Check if it's a stop message
				if msgType, ok := msg["type"].(string); ok && msgType == "stop" {
					wsLogger.Info("Received stop message for %s", account.EmailAddress)
					cancel() // Cancel the context to stop all operations
					return
				}
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			wsLogger.Info("Stopping email monitoring for %s - context cancelled", account.EmailAddress)
			// Send a final message to indicate monitoring has stopped
			conn.WriteJSON(WebSocketMessage{
				Type:    "stopped",
				Message: "Email monitoring stopped",
			})
			return
		case <-ticker.C:
			checksPerformed++

			// Send status update
			conn.WriteJSON(WebSocketMessage{
				Type:    "checking",
				Message: "Checking for new emails",
				Data: map[string]interface{}{
					"checksPerformed": checksPerformed,
					"elapsedTime":     time.Since(startTime).Seconds(),
				},
			})

			// Check if timeout has been reached
			if time.Since(startTime) >= timeoutDuration {
				wsLogger.Info("Timeout reached for %s after %v", account.EmailAddress, timeoutDuration)
				conn.WriteJSON(WebSocketMessage{
					Type:    "timeout",
					Message: "Monitoring timeout reached",
					Data: map[string]interface{}{
						"elapsedTime": time.Since(startTime).Seconds(),
						"timeout":     request.Timeout,
					},
				})
				cancel()
				return
			}

			// Check for emails
			checkAndProcessEmails()
		}
	}
}

// isEmailAddressedToAccount checks if the email is addressed to the given account
// It handles Gmail aliases (user+alias@gmail.com) and domain emails
func isEmailAddressedToAccount(email *models.Email, account *models.EmailAccount) bool {
	targetEmail := account.EmailAddress

	// Helper function to normalize Gmail addresses
	normalizeGmailAddress := func(email string) string {
		// Split email into local and domain parts
		parts := strings.Split(strings.ToLower(email), "@")
		if len(parts) != 2 {
			return strings.ToLower(email)
		}

		localPart := parts[0]
		domain := parts[1]

		// Only process Gmail addresses
		if domain == "gmail.com" || domain == "googlemail.com" {
			// Remove everything after '+' in the local part
			if plusIndex := strings.Index(localPart, "+"); plusIndex != -1 {
				localPart = localPart[:plusIndex]
			}
			// Remove dots from the local part (Gmail ignores dots)
			localPart = strings.ReplaceAll(localPart, ".", "")
			return localPart + "@gmail.com"
		}

		return strings.ToLower(email)
	}

	// Helper function to extract email from "Name <email>" format
	extractEmail := func(emailStr string) string {
		emailStr = strings.TrimSpace(emailStr)

		// Check if it's in "Name <email>" format
		if idx := strings.Index(emailStr, "<"); idx >= 0 {
			if endIdx := strings.Index(emailStr[idx:], ">"); endIdx >= 0 {
				return strings.TrimSpace(emailStr[idx+1 : idx+endIdx])
			}
		}

		// Otherwise, return as is
		return emailStr
	}

	// Helper function to check if an email matches the target
	emailMatches := func(emailToCheck string) bool {
		// Extract the actual email address first
		emailToCheck = extractEmail(emailToCheck)
		emailToCheck = strings.ToLower(strings.TrimSpace(emailToCheck))
		targetLower := strings.ToLower(targetEmail)

		// Direct match
		if emailToCheck == targetLower {
			return true
		}

		// For Gmail accounts, check normalized addresses
		if strings.Contains(targetLower, "@gmail.com") || strings.Contains(targetLower, "@googlemail.com") {
			if normalizeGmailAddress(emailToCheck) == normalizeGmailAddress(targetLower) {
				return true
			}
		}

		// For domain emails, check if the email belongs to the domain
		if account.IsDomainMail && account.Domain != "" {
			domain := "@" + strings.ToLower(account.Domain)
			if strings.HasSuffix(emailToCheck, domain) {
				return true
			}
		}

		return false
	}

	// Check To field
	for _, to := range email.To {
		if emailMatches(to) {
			return true
		}
	}

	// Check Cc field
	for _, cc := range email.Cc {
		if emailMatches(cc) {
			return true
		}
	}

	// Check Bcc field (if available)
	for _, bcc := range email.Bcc {
		if emailMatches(bcc) {
			return true
		}
	}

	return false
}

// SubscriptionWebSocketHandler handles WebSocket connections for subscription-based email monitoring
func (h *APIHandler) SubscriptionWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	wsLogger := utils.NewLogger("WebSocket")
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		wsLogger.Error("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Track active subscriptions for this connection
	activeSubscriptions := make(map[string]context.CancelFunc)
	defer func() {
		// Cancel all active subscriptions when connection closes
		for _, cancel := range activeSubscriptions {
			cancel()
		}
	}()

	// Send initial connection success
	conn.WriteJSON(WebSocketMessage{
		Type:    "connected",
		Message: "Connected to subscription monitoring",
	})

	// Handle incoming messages
	for {
		var request SubscriptionWebSocketRequest
		if err := conn.ReadJSON(&request); err != nil {
			wsLogger.Error("Error reading WebSocket message: %v", err)
			break
		}

		switch request.Type {
		case "subscribe":
			if request.SubscriptionID == "" {
				conn.WriteJSON(WebSocketMessage{
					Type:  "error",
					Error: "subscription_id is required",
				})
				continue
			}

			// Check if already subscribed
			if _, exists := activeSubscriptions[request.SubscriptionID]; exists {
				conn.WriteJSON(WebSocketMessage{
					Type:    "info",
					Message: "Already subscribed to this subscription",
					Data: map[string]interface{}{
						"subscription_id": request.SubscriptionID,
					},
				})
				continue
			}

			// Get subscription details
			subscription := h.EmailScheduler.GetSubscription(request.SubscriptionID)
			if subscription == nil {
				conn.WriteJSON(WebSocketMessage{
					Type:  "error",
					Error: "Subscription not found",
				})
				continue
			}

			// Create context for this subscription
			ctx, cancel := context.WithCancel(context.Background())
			activeSubscriptions[request.SubscriptionID] = cancel

			// Start monitoring this subscription
			go h.monitorSubscription(ctx, conn, subscription)

			conn.WriteJSON(WebSocketMessage{
				Type:    "subscribed",
				Message: "Successfully subscribed to email updates",
				Data: map[string]interface{}{
					"subscription_id": request.SubscriptionID,
					"account_id":      subscription.AccountID,
					"mailbox":         subscription.Mailbox,
				},
			})

		case "unsubscribe":
			if request.SubscriptionID == "" {
				conn.WriteJSON(WebSocketMessage{
					Type:  "error",
					Error: "subscription_id is required",
				})
				continue
			}

			if cancel, exists := activeSubscriptions[request.SubscriptionID]; exists {
				cancel()
				delete(activeSubscriptions, request.SubscriptionID)
				conn.WriteJSON(WebSocketMessage{
					Type:    "unsubscribed",
					Message: "Successfully unsubscribed",
					Data: map[string]interface{}{
						"subscription_id": request.SubscriptionID,
					},
				})
			} else {
				conn.WriteJSON(WebSocketMessage{
					Type:  "error",
					Error: "Not subscribed to this subscription",
				})
			}

		case "list":
			// List all active subscriptions for this connection
			var subscriptionIDs []string
			for id := range activeSubscriptions {
				subscriptionIDs = append(subscriptionIDs, id)
			}
			conn.WriteJSON(WebSocketMessage{
				Type: "subscriptions",
				Data: map[string]interface{}{
					"active_subscriptions": subscriptionIDs,
				},
			})

		default:
			conn.WriteJSON(WebSocketMessage{
				Type:  "error",
				Error: "Unknown message type",
			})
		}
	}
}

// monitorSubscription monitors a subscription and sends updates via WebSocket
func (h *APIHandler) monitorSubscription(ctx context.Context, conn *websocket.Conn, subscription *services.EmailSubscription) {
	wsLogger := utils.NewLogger("WebSocket")
	subscriptionID := subscription.ID
	wsLogger.Info("Starting monitoring for subscription %s", subscriptionID)

	// Subscribe to email events for this subscription
	eventChan := make(chan services.EmailEvent, 100)
	h.EmailScheduler.SubscribeToEvents(subscriptionID, eventChan)
	defer h.EmailScheduler.UnsubscribeFromEvents(subscriptionID, eventChan)

	for {
		select {
		case <-ctx.Done():
			wsLogger.Info("Stopping monitoring for subscription %s", subscriptionID)
			return

		case event := <-eventChan:
			// Convert event to WebSocket message
			var msgType string
			var data interface{}

			switch event.Type {
			case services.EventTypeNewEmail:
				msgType = "new_email"
				// Convert email data to JSON-friendly format
				if emailData, ok := event.Data.(*models.Email); ok {
					data = map[string]interface{}{
						"subscription_id": subscriptionID,
						"email":           emailData,
					}
				}

			case services.EventTypeFetchStart:
				msgType = "fetch_started"
				data = map[string]interface{}{
					"subscription_id": subscriptionID,
					"timestamp":       event.Timestamp,
				}

			case services.EventTypeFetchComplete:
				msgType = "fetch_completed"
				if fetchResult, ok := event.Data.(map[string]interface{}); ok {
					data = map[string]interface{}{
						"subscription_id": subscriptionID,
						"emails_fetched":  fetchResult["emails_fetched"],
						"timestamp":       event.Timestamp,
					}
				}

			case services.EventTypeFetchError:
				msgType = "fetch_error"
				data = map[string]interface{}{
					"subscription_id": subscriptionID,
					"error":           event.Error,
					"timestamp":       event.Timestamp,
				}

			default:
				continue
			}

			// Send message to client
			if err := conn.WriteJSON(WebSocketMessage{
				Type: msgType,
				Data: data,
			}); err != nil {
				wsLogger.Error("Error sending message for subscription %s: %v", subscriptionID, err)
				return
			}
		}
	}
}
