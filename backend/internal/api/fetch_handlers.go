package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/services"
	"mailman/internal/utils"
	"math/big"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// FetchEmailsHandler godoc
// @Summary Fetch emails with enhanced filtering and smart email matching
// @Description Fetch emails for a given account with advanced filtering capabilities and intelligent email address matching. Supports Gmail aliases (dots, plus signs, googlemail.com), domain mail forwarding, content filtering, flag-based filtering, size filtering, date ranges, and more. When using email_address parameter, the system will automatically handle Gmail aliases and domain mail scenarios.
// @Tags emails
// @Accept json
// @Produce json
// @Param request body FetchEmailsRequest true "Enhanced email fetch request with multiple filtering options. Supports Gmail aliases (john.doe+work@gmail.com matches johndoe@gmail.com) and domain mail (any@company.com matches domain mail account for company.com)"
// @Success 200 {object} map[string]interface{} "Successful response with emails and metadata"
// @Failure 400 {string} string "Bad Request - Invalid parameters or missing required fields"
// @Failure 404 {string} string "Not Found - Account not found (after trying direct match, Gmail alias normalization, and domain matching)"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/fetch-emails [post]
func (h *APIHandler) FetchEmailsHandler(w http.ResponseWriter, r *http.Request) {
	var request FetchEmailsRequest

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Validate input
	if request.EmailAddress == "" && request.AccountID == 0 {
		http.Error(w, "Either email_address or account_id must be provided", http.StatusBadRequest)
		return
	}

	// Get account from database
	var account *models.EmailAccount
	var err error

	if request.AccountID != 0 {
		account, err = h.EmailAccountRepo.GetByID(request.AccountID)
	} else {
		account, err = h.EmailAccountRepo.GetByEmail(request.EmailAddress)
	}

	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// Parse and validate options
	options, err := h.parseRequestOptions(request)
	if err != nil {
		http.Error(w, fmt.Sprintf("Invalid request parameters: %v", err), http.StatusBadRequest)
		return
	}

	// Fetch emails using the account with options
	emails, err := h.Fetcher.FetchEmailsWithOptions(*account, options)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok",
		"count":  len(emails),
		"emails": emails,
		"options": map[string]interface{}{
			"mailbox":           options.Mailbox,
			"limit":             options.Limit,
			"offset":            options.Offset,
			"fetch_from_server": options.FetchFromServer,
			"include_body":      options.IncludeBody,
			"sort_by":           options.SortBy,
		},
	})
}

// parseRequestOptions converts FetchEmailsRequest to FetchEmailsOptions
func (h *APIHandler) parseRequestOptions(request FetchEmailsRequest) (services.FetchEmailsOptions, error) {
	options := services.FetchEmailsOptions{
		Mailbox:         "INBOX",
		Limit:           10,
		Offset:          0,
		FetchFromServer: false,
		IncludeBody:     false,
		SortBy:          "date_desc",
	}

	// Set mailbox
	if request.Mailbox != "" {
		options.Mailbox = request.Mailbox
	}

	// Set limit with validation
	if request.Limit > 0 {
		if request.Limit > 100 {
			return options, fmt.Errorf("limit cannot exceed 100")
		}
		options.Limit = request.Limit
	}

	// Set offset
	if request.Offset >= 0 {
		options.Offset = request.Offset
	}

	// Parse date range
	if request.StartDate != "" {
		startDate, err := time.Parse(time.RFC3339, request.StartDate)
		if err != nil {
			return options, fmt.Errorf("invalid start_date format, use RFC3339: %v", err)
		}
		options.StartDate = &startDate
	}

	if request.EndDate != "" {
		endDate, err := time.Parse(time.RFC3339, request.EndDate)
		if err != nil {
			return options, fmt.Errorf("invalid end_date format, use RFC3339: %v", err)
		}
		options.EndDate = &endDate
	}

	// Validate date range
	if options.StartDate != nil && options.EndDate != nil && options.StartDate.After(*options.EndDate) {
		return options, fmt.Errorf("start_date cannot be after end_date")
	}

	// Set search query
	if request.SearchQuery != "" {
		options.SearchQuery = request.SearchQuery
	}

	// Set fetch from server flag
	options.FetchFromServer = request.FetchFromServer

	// Set include body flag
	options.IncludeBody = request.IncludeBody

	// Validate and set sort order
	if request.SortBy != "" {
		validSortOptions := map[string]bool{
			"date_desc":    true,
			"date_asc":     true,
			"subject_asc":  true,
			"subject_desc": true,
		}
		if !validSortOptions[request.SortBy] {
			return options, fmt.Errorf("invalid sort_by option, valid options are: date_desc, date_asc, subject_asc, subject_desc")
		}
		options.SortBy = request.SortBy
	}

	return options, nil
}

// GetCacheStatsHandler retrieves email cache statistics
// @Summary Get cache statistics
// @Description Get email cache statistics and performance metrics
// @Tags cache
// @Accept json
// @Produce json
// @Success 200 {object} CacheStatsResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/cache/stats [get]
func (h *APIHandler) GetCacheStatsHandler(w http.ResponseWriter, r *http.Request) {
	// Get cache stats from EmailScheduler
	stats := h.EmailScheduler.GetCacheStats()

	// Get account-specific stats
	var accountStats []AccountCacheStats
	accounts, err := h.EmailAccountRepo.GetAll(0) // System-level, no org filter
	if err == nil {
		for _, account := range accounts {
			accountStat := h.EmailScheduler.GetAccountCacheStats(account.ID)
			if accountStat != nil {
				accountStats = append(accountStats, AccountCacheStats{
					AccountID:    account.ID,
					EmailAddress: account.EmailAddress,
					EmailCount:   accountStat.EmailCount,
					CacheSize:    accountStat.Size,
					OldestEmail:  accountStat.OldestEmail,
					NewestEmail:  accountStat.NewestEmail,
				})
			}
		}
	}

	response := CacheStatsResponse{
		TotalEmails:  stats.TotalEmails,
		TotalSize:    0, // TODO: Calculate actual size
		AccountStats: accountStats,
		HitRate:      stats.HitRate,
		LastCleanup:  nil, // TODO: Track cleanup time
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// FetchNowHandler triggers immediate email fetch
// @Summary Fetch emails immediately
// @Description Trigger immediate email fetch for subscriptions
// @Tags emails
// @Accept json
// @Produce json
// @Param request body FetchNowRequest true "Fetch configuration"
// @Success 200 {object} FetchNowResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/emails/fetch-now [post]
func (h *APIHandler) FetchNowHandler(w http.ResponseWriter, r *http.Request) {
	var req FetchNowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	startTime := time.Now()
	var totalNew, totalProcessed int
	var errors []string

	// If subscription ID is provided, fetch for that subscription
	if req.SubscriptionID != "" {
		subscription := h.EmailScheduler.GetSubscription(req.SubscriptionID)
		if subscription == nil {
			http.Error(w, "Subscription not found", http.StatusNotFound)
			return
		}

		result, err := h.EmailScheduler.FetchNow(req.SubscriptionID, req.ForceRefresh)
		if err != nil {
			errors = append(errors, err.Error())
		} else {
			totalNew += result.NewEmails
			totalProcessed += result.ProcessedEmails
		}
	} else if req.AccountID != 0 {
		// Fetch for all subscriptions of an account
		subscriptions := h.EmailScheduler.GetAccountSubscriptions(req.AccountID)
		for _, sub := range subscriptions {
			result, err := h.EmailScheduler.FetchNow(sub.ID, req.ForceRefresh)
			if err != nil {
				errors = append(errors, fmt.Sprintf("Subscription %s: %v", sub.ID, err))
			} else {
				totalNew += result.NewEmails
				totalProcessed += result.ProcessedEmails
			}
		}
	} else {
		// Fetch for all subscriptions
		allSubscriptions := h.EmailScheduler.GetAllSubscriptions()
		for _, sub := range allSubscriptions {
			result, err := h.EmailScheduler.FetchNow(sub.ID, req.ForceRefresh)
			if err != nil {
				errors = append(errors, fmt.Sprintf("Subscription %s: %v", sub.ID, err))
			} else {
				totalNew += result.NewEmails
				totalProcessed += result.ProcessedEmails
			}
		}
	}

	processingTime := time.Since(startTime)

	response := FetchNowResponse{
		Status:           "success",
		NewEmails:        totalNew,
		TotalProcessed:   totalProcessed,
		ProcessingTimeMs: processingTime.Milliseconds(),
		Errors:           errors,
	}

	if len(errors) > 0 && totalProcessed == 0 {
		response.Status = "failed"
	} else if len(errors) > 0 {
		response.Status = "partial"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// FetchAndStoreEmailsHandler fetches and stores emails for an account with sync options
// @Summary Fetch and store emails for an account with incremental/full sync support
// @Description Fetch and store emails for an account with support for incremental sync, custom mailboxes, and date ranges. Supports both full sync and incremental sync modes. For incremental sync, maintains sync records to track last sync times per mailbox.
// @Tags account-emails
// @Accept json
// @Produce json
// @Param id path int true "Account ID"
// @Param request body FetchAndStoreRequest false "Sync options (optional - defaults to incremental sync of INBOX)"
// @Success 200 {object} FetchAndStoreResponse "Successful sync operation with detailed results"
// @Failure 400 {string} string "Bad Request - Invalid account ID or request parameters"
// @Failure 404 {string} string "Not Found - Account not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/account-emails/fetch/{id} [post]
func (h *APIHandler) FetchAndStoreEmailsHandler(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}
	accountID := uint(id)

	// Parse request body (optional)
	var request FetchAndStoreRequest
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			// If body is not valid JSON, use defaults
			h.logger.Warn("Failed to parse request body, using defaults: %v", err)
		}
	}

	// Set defaults
	if request.SyncMode == "" {
		request.SyncMode = "incremental"
	}
	if len(request.Mailboxes) == 0 {
		request.Mailboxes = []string{"INBOX"}
	}
	if request.MaxEmailsPerMailbox <= 0 {
		request.MaxEmailsPerMailbox = 1000
	}
	// IncludeBody defaults to true if not specified
	if request.IncludeBody == false && r.Body != nil {
		// Only set to true if body was provided but IncludeBody wasn't explicitly set
		request.IncludeBody = true
	} else if r.Body == nil {
		request.IncludeBody = true
	}

	// Validate account exists
	account, err := h.EmailAccountRepo.GetByID(accountID)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// Parse date parameters
	var defaultStartDate *time.Time
	var endDate *time.Time

	if request.DefaultStartDate != nil {
		if parsed, err := time.Parse(time.RFC3339, *request.DefaultStartDate); err == nil {
			defaultStartDate = &parsed
		} else {
			http.Error(w, fmt.Sprintf("Invalid default_start_date format: %v", err), http.StatusBadRequest)
			return
		}
	} else {
		// Default to 1 month ago
		oneMonthAgo := time.Now().AddDate(0, -1, 0)
		defaultStartDate = &oneMonthAgo
	}

	if request.EndDate != nil {
		if parsed, err := time.Parse(time.RFC3339, *request.EndDate); err == nil {
			endDate = &parsed
		} else {
			http.Error(w, fmt.Sprintf("Invalid end_date format: %v", err), http.StatusBadRequest)
			return
		}
	} else {
		// Default to now
		now := time.Now()
		endDate = &now
	}

	// Process each mailbox
	var mailboxResults []MailboxSyncResult
	var totalEmailsProcessed int
	var totalNewEmails int
	var messages []string

	for _, mailboxName := range request.Mailboxes {
		result := h.processSingleMailbox(
			*account,
			mailboxName,
			request.SyncMode,
			defaultStartDate,
			endDate,
			request.MaxEmailsPerMailbox,
			request.IncludeBody,
		)

		mailboxResults = append(mailboxResults, result)
		totalEmailsProcessed += result.EmailsProcessed
		totalNewEmails += result.NewEmails

		if result.Error != "" {
			messages = append(messages, fmt.Sprintf("Error in mailbox %s: %s", mailboxName, result.Error))
		}
	}

	processingTime := time.Since(startTime)

	// Log activity
	userID := getUserIDFromContext(r)
	if totalNewEmails > 0 {
		h.activityLogger.LogActivity(
			models.ActivityEmailReceived,
			fmt.Sprintf("收到 %d 封新邮件", totalNewEmails),
			fmt.Sprintf("账户 %s 同步了 %d 封新邮件", account.EmailAddress, totalNewEmails),
			userID,
			map[string]interface{}{
				"sync_mode":       request.SyncMode,
				"mailboxes":       request.Mailboxes,
				"total_processed": totalEmailsProcessed,
				"new_emails":      totalNewEmails,
				"processing_ms":   processingTime.Nanoseconds() / 1000000,
			},
		)
	}

	response := FetchAndStoreResponse{
		Status:               "success",
		SyncMode:             request.SyncMode,
		MailboxResults:       mailboxResults,
		TotalEmailsProcessed: totalEmailsProcessed,
		TotalNewEmails:       totalNewEmails,
		ProcessingTimeMs:     processingTime.Nanoseconds() / 1000000,
		Messages:             messages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// WaitEmailHandler waits for emails to arrive with optional filtering and extraction
// @Summary Wait for emails to arrive with filtering and extraction
// @Description Wait for new emails to arrive for a specific account or email address. Supports timeout, interval checking, and content extraction using the same extractors as the extract-emails endpoint. Only one of accountId or email parameters must be provided.
// @Tags emails
// @Accept json
// @Produce json
// @Param request body WaitEmailRequest true "Request body with account identification and optional extractors"
// @Success 200 {object} WaitEmailResponse "Email found or timeout reached"
// @Failure 400 {string} string "Bad Request - Invalid parameters"
// @Failure 404 {string} string "Not Found - Account not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/wait-email [post]
func (h *APIHandler) WaitEmailHandler(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	// Parse request body
	var request WaitEmailRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Set default values if not provided
	if request.Timeout <= 0 {
		request.Timeout = 30 // Default 30 seconds
	}
	if request.Interval <= 0 {
		request.Interval = 5 // Default 5 seconds
	}

	// Validate input - exactly one of accountId or email must be provided
	if (request.AccountID == nil && request.Email == nil) || (request.AccountID != nil && request.Email != nil) {
		http.Error(w, "Exactly one of accountId or email must be provided", http.StatusBadRequest)
		return
	}

	// Get account from database
	var account *models.EmailAccount
	var err error

	if request.AccountID != nil {
		account, err = h.EmailAccountRepo.GetByID(*request.AccountID)
	} else {
		// Use GetByEmailOrAlias to handle aliases and domain emails
		account, err = h.EmailAccountRepo.GetByEmailOrAlias(*request.Email)
	}

	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// Parse start time
	var filterStartTime time.Time
	if request.StartTime != nil {
		if parsed, err := time.Parse(time.RFC3339, *request.StartTime); err == nil {
			filterStartTime = parsed
		} else {
			http.Error(w, fmt.Sprintf("Invalid start_time format: %v", err), http.StatusBadRequest)
			return
		}
	} else {
		filterStartTime = time.Now() // Default to current time
	}

	// Validate extractors if provided
	var extractorService *services.ExtractorService
	var serviceExtractors []services.ExtractorConfig
	if len(request.Extract) > 0 {
		extractorService = services.NewExtractorService()
		for i, extractor := range request.Extract {
			if extractor.Field == "" || extractor.Type == "" || extractor.Extract == "" {
				http.Error(w, fmt.Sprintf("Extractor %d is missing required fields", i), http.StatusBadRequest)
				return
			}

			// Validate field values
			validFields := map[string]bool{
				"ALL": true, "from": true, "to": true, "cc": true,
				"subject": true, "body": true, "html_body": true, "headers": true,
			}
			if !validFields[extractor.Field] {
				http.Error(w, fmt.Sprintf("Invalid field '%s' in extractor %d", extractor.Field, i), http.StatusBadRequest)
				return
			}

			// Validate type values
			validTypes := map[string]bool{"regex": true, "js": true, "gotemplate": true}
			if !validTypes[extractor.Type] {
				http.Error(w, fmt.Sprintf("Invalid type '%s' in extractor %d", extractor.Type, i), http.StatusBadRequest)
				return
			}

			serviceExtractors = append(serviceExtractors, services.ExtractorConfig{
				Field: services.ExtractorField(extractor.Field),
				Type:  services.ExtractorType(extractor.Type),
				Match: extractor.Match,

				Extract: extractor.Extract,
			})
		}
	}

	// Start waiting for emails
	timeout := time.Duration(request.Timeout) * time.Second
	interval := time.Duration(request.Interval) * time.Second
	deadline := time.Now().Add(timeout)
	checksPerformed := 0

	for time.Now().Before(deadline) {
		checksPerformed++

		// Fetch recent emails from database (not directly from server)
		// This follows the subscription pattern where only the subscription system fetches from server
		options := services.FetchEmailsOptions{
			Mailbox:         "INBOX",
			Limit:           50, // Check recent emails
			Offset:          0,
			StartDate:       &filterStartTime,
			FetchFromServer: false,                    // Use database, not direct server access
			IncludeBody:     len(request.Extract) > 0, // Include body only if extractors are provided
			SortBy:          "date_desc",
		}

		emails, err := h.Fetcher.FetchEmailsWithOptions(*account, options)
		if err != nil {
			h.logger.Error("Error fetching emails during wait: %v", err)
		} else {
			// Check if any email matches the criteria
			for _, email := range emails {
				// Check if email is newer than start time
				if email.Date.After(filterStartTime) {
					// If no extractors, return the first new email
					if len(serviceExtractors) == 0 {
						elapsed := time.Since(startTime).Seconds()
						response := WaitEmailResponse{
							Status:          "success",
							Found:           true,
							Email:           &email,
							ElapsedTime:     elapsed,
							ChecksPerformed: checksPerformed,
							Message:         "Email found",
						}
						w.Header().Set("Content-Type", "application/json")
						json.NewEncoder(w).Encode(response)
						return
					}

					// If extractors are provided, check if email matches
					result, err := extractorService.ExtractFromEmail(email, serviceExtractors)
					if err != nil {
						h.logger.Error("Error extracting from email ID %d: %v", email.ID, err)
						continue
					}

					if result != nil && len(result.Matches) > 0 {
						elapsed := time.Since(startTime).Seconds()
						response := WaitEmailResponse{
							Status:          "success",
							Found:           true,
							Email:           &email,
							Matches:         result.Matches,
							ElapsedTime:     elapsed,
							ChecksPerformed: checksPerformed,
							Message:         "Email found matching extraction criteria",
						}
						w.Header().Set("Content-Type", "application/json")
						json.NewEncoder(w).Encode(response)
						return
					}
				}
			}
		}

		// Wait for the next check
		if time.Now().Add(interval).Before(deadline) {
			time.Sleep(interval)
		} else {
			break
		}
	}

	// Timeout reached
	elapsed := time.Since(startTime).Seconds()
	response := WaitEmailResponse{
		Status:          "timeout",
		Found:           false,
		ElapsedTime:     elapsed,
		ChecksPerformed: checksPerformed,
		Message:         "Timeout reached, no matching email found",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// PollEmailHandler godoc
// @Summary Poll for new emails with optional filtering and extraction (fallback for WebSocket)
// @Description Poll for new emails for a specific account. This is a fallback mechanism when WebSocket is not available.
// It checks for new emails using polling and supports filtering by start time and content extraction.
// @Tags emails
// @Accept json
// @Produce json
// @Param request body WaitEmailWebSocketRequest true "Request body with account identification and optional extractors"
// @Success 200 {object} PollEmailResponse "Response with email status and data"
// @Failure 400 {string} string "Bad Request - Invalid parameters"
// @Failure 404 {string} string "Not Found - Account not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/poll-email [post]
func (h *APIHandler) PollEmailHandler(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	// Parse request body
	var request WaitEmailWebSocketRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate input - exactly one of accountId or email must be provided
	if (request.AccountID == nil && request.Email == nil) || (request.AccountID != nil && request.Email != nil) {
		http.Error(w, "Exactly one of accountId or email must be provided", http.StatusBadRequest)
		return
	}

	// Get account from database
	var account *models.EmailAccount
	var err error

	if request.AccountID != nil {
		account, err = h.EmailAccountRepo.GetByID(*request.AccountID)
	} else {
		// Use GetByEmailOrAlias to handle aliases and domain emails
		account, err = h.EmailAccountRepo.GetByEmailOrAlias(*request.Email)
	}

	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// Set default values if not provided
	if request.Interval <= 0 {
		request.Interval = 5 // Default 5 seconds
	}

	// Parse start time - support both RFC3339 string and Unix timestamp (milliseconds)
	var filterStartTime time.Time
	if request.StartTime != nil {
		// First try to parse as RFC3339
		if parsed, err := time.Parse(time.RFC3339, *request.StartTime); err == nil {
			filterStartTime = parsed.UTC()
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
					h.logger.Warn("[PollEmail] Failed to parse start time '%s', using current time", *request.StartTime)
					filterStartTime = time.Now().UTC()
				}
			}
		}
	} else {
		filterStartTime = time.Now().UTC()
	}

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

	// Get "processedIds" from request header or cookie to maintain state between requests
	// This is used to avoid returning the same email multiple times in different poll requests
	processedIDsStr := r.Header.Get("X-Processed-Ids")
	processedMessageIDs := make(map[string]bool)

	if processedIDsStr != "" {
		// Parse comma-separated list of message IDs
		for _, id := range strings.Split(processedIDsStr, ",") {
			if trimmedID := strings.TrimSpace(id); trimmedID != "" {
				processedMessageIDs[trimmedID] = true
			}
		}
	}

	// Fetch emails from multiple mailboxes including spam
	options := services.FetchEmailsOptions{
		Mailbox:         "INBOX",
		Limit:           100,
		Offset:          0,
		StartDate:       &filterStartTime,
		FetchFromServer: true,
		IncludeBody:     true,
		SortBy:          "date_desc",
		Source:          services.EmailIngestSourcePickup,
	}

	h.logger.Debug("[PollEmail] Fetching emails for %s from %s", account.EmailAddress, filterStartTime.Format(time.RFC3339))

	// Use the method that fetches from multiple mailboxes including spam
	emails, err := h.Fetcher.FetchEmailsFromMultipleMailboxes(*account, options)
	if err != nil {
		h.logger.Error("[PollEmail] Error fetching emails: %v", err)
		http.Error(w, fmt.Sprintf("Error fetching emails: %v", err), http.StatusInternalServerError)
		return
	}

	h.logger.Debug("[PollEmail] Fetched %d total emails for %s from server", len(emails), account.EmailAddress)

	// Track new processed IDs for this request
	var newProcessedIDs []string
	currentTime := time.Now().UTC()

	// Process emails
	for _, email := range emails {
		// Skip if already processed
		messageKey := email.MessageID
		if messageKey == "" {
			// Use combination of properties as unique identifier
			messageKey = fmt.Sprintf("%s_%s_%s_%d",
				email.Subject,
				email.From,
				email.Date.Format(time.RFC3339Nano),
				email.Size)
		}

		if processedMessageIDs[messageKey] {
			continue
		}

		// Check email date
		emailDateUTC := email.Date.UTC()
		if emailDateUTC.Before(filterStartTime) || emailDateUTC.After(currentTime) {
			continue
		}

		// Check if the email is addressed to the monitored account
		if !isEmailAddressedToAccount(&email, account) {
			continue
		}

		// Add to processed IDs
		newProcessedIDs = append(newProcessedIDs, messageKey)
		processedMessageIDs[messageKey] = true

		// Found a matching email
		if len(serviceExtractors) == 0 {
			// No extractors, return the email
			response := PollEmailResponse{
				Status:       "success",
				Found:        true,
				Email:        &email,
				ProcessedIds: append(newProcessedIDs, getMapKeys(processedMessageIDs)...),
				ElapsedTime:  time.Since(startTime).Seconds(),
				Message:      "Email found",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(response)
			return
		}

		// Check extractors
		result, err := extractorService.ExtractFromEmail(email, serviceExtractors)
		if err != nil {
			h.logger.Error("[PollEmail] Error extracting from email ID %d: %v", email.ID, err)
			continue
		}

		if result != nil && len(result.Matches) > 0 {
			response := PollEmailResponse{
				Status:       "success",
				Found:        true,
				Email:        &email,
				Matches:      result.Matches,
				ProcessedIds: append(newProcessedIDs, getMapKeys(processedMessageIDs)...),
				ElapsedTime:  time.Since(startTime).Seconds(),
				Message:      "Email found matching extraction criteria",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(response)
			return
		}
	}

	// No matching email found
	response := PollEmailResponse{
		Status:       "not_found",
		Found:        false,
		ProcessedIds: append(newProcessedIDs, getMapKeys(processedMessageIDs)...),
		ElapsedTime:  time.Since(startTime).Seconds(),
		Message:      "No matching email found in this poll. Continue polling.",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Helper function to get map keys as slice
func getMapKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// RandomEmailHandler godoc
// @Summary Get a random email account
// @Description Get a random email account from existing accounts. Supports generating random Gmail aliases and selecting domain email accounts based on parameters.
// @Tags emails
// @Accept json
// @Produce json
// @Param alias query bool false "Allow random alias emails (Gmail aliases)"
// @Param domain query bool false "Allow domain emails"
// @Success 200 {object} RandomEmailResponse "Successful response with random email account"
// @Failure 404 {string} string "Not Found - No email accounts available"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/random-email [get]
func (h *APIHandler) RandomEmailHandler(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	aliasParam := r.URL.Query().Get("alias")
	domainParam := r.URL.Query().Get("domain")

	allowAlias := aliasParam == "true"
	allowDomain := domainParam == "true"
	strategy := parseEmailLocalPartStrategyFromValues(r.URL.Query())
	accountID, err := parseOptionalUintQueryValue(r.URL.Query(), "accountId", "account_id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	emailSuffix := normalizeEmailSuffix(firstQueryValue(r.URL.Query(), "emailSuffix", "email_suffix"))
	if strategy.IsSet() || accountID != nil || emailSuffix != "" {
		h.randomEmailWithOptions(w, r, allowAlias, allowDomain, strategy, accountID, emailSuffix)
		return
	}

	if allowAlias {
		// Check availability of different account types
		var err error
		allowAlias, err = h.EmailAccountRepo.HasGmailAccounts()
		if err != nil {
			http.Error(w, "Error checking Gmail accounts", http.StatusInternalServerError)
			return
		}
	}

	if allowDomain {
		var err error
		allowDomain, err = h.EmailAccountRepo.HasDomainAccounts()
		if err != nil {
			http.Error(w, "Error checking domain accounts", http.StatusInternalServerError)
			return
		}
	}

	// If neither alias nor domain is specified, return a random account
	if !allowAlias && !allowDomain {
		account, err := h.EmailAccountRepo.GetRandomAccount()
		if err != nil {
			http.Error(w, "No email accounts found", http.StatusNotFound)
			return
		}

		response := RandomEmailResponse{
			Status:    "success",
			EmailType: "regular",
			RawEmail:  account.EmailAddress,
			Email:     account.EmailAddress,
			AccountID: account.ID,
			Message:   "Random email account selected",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Determine what types are available and requested
	// Randomly choose between available options
	var useAlias bool
	if allowAlias && allowDomain {
		// Both options available, randomly choose
		choice, _ := rand.Int(rand.Reader, big.NewInt(2))
		useAlias = choice.Int64() == 0
	} else {
		// Only one option available
		useAlias = allowAlias
	}

	if useAlias {
		// Generate Gmail alias
		account, err := h.EmailAccountRepo.GetRandomGmailAccount()
		if err != nil {
			http.Error(w, "No Gmail accounts found", http.StatusNotFound)
			return
		}

		// Generate random alias
		generatedEmail, err := h.generateGmailAlias(account.EmailAddress)
		if err != nil {
			http.Error(w, "Error generating Gmail alias", http.StatusInternalServerError)
			return
		}

		response := RandomEmailResponse{
			Status:    "success",
			EmailType: "alias",
			RawEmail:  account.EmailAddress,
			Email:     generatedEmail,
			AccountID: account.ID,
			Message:   "Generated random Gmail alias",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	} else {
		// Use domain email
		account, err := h.EmailAccountRepo.GetRandomDomainAccount()
		if err != nil {
			http.Error(w, "No domain email accounts found", http.StatusNotFound)
			return
		}

		// Generate random domain email
		generatedEmail, err := h.generateDomainEmail(account.Domain)
		if err != nil {
			http.Error(w, "Error generating domain email", http.StatusInternalServerError)
			return
		}

		response := RandomEmailResponse{
			Status:    "success",
			EmailType: "domain",
			Email:     generatedEmail,
			RawEmail:  account.EmailAddress,
			AccountID: account.ID,
			Message:   "Generated random domain email",
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}
}

func (h *APIHandler) randomEmailWithOptions(w http.ResponseWriter, r *http.Request, allowAlias bool, allowDomain bool, strategy utils.EmailLocalPartStrategy, accountID *uint, emailSuffix string) {
	orgID := GetCurrentOrgID(r)
	accounts, err := h.EmailAccountRepo.GetAll(orgID)
	if err != nil {
		http.Error(w, "Error fetching accounts", http.StatusInternalServerError)
		return
	}

	regularCandidates := make([]models.EmailAccount, 0)
	aliasCandidates := make([]models.EmailAccount, 0)
	domainCandidates := make([]models.EmailAccount, 0)
	for _, account := range accounts {
		if accountID != nil && account.ID != *accountID {
			continue
		}
		if !accountMatchesEmailSuffix(account, emailSuffix) {
			continue
		}
		if !allowAlias && !allowDomain {
			if emailAddressMatchesSuffix(account.EmailAddress, emailSuffix) {
				regularCandidates = append(regularCandidates, account)
			}
			continue
		}
		if allowAlias && isBusinessGmailAddress(account.EmailAddress) && emailAddressMatchesSuffix(account.EmailAddress, emailSuffix) {
			aliasCandidates = append(aliasCandidates, account)
		}
		if allowDomain && account.IsDomainMail && strings.TrimSpace(account.Domain) != "" && domainMatchesEmailSuffix(account.Domain, emailSuffix) {
			domainCandidates = append(domainCandidates, account)
		}
	}

	if !allowAlias && !allowDomain {
		if strategy.IsSet() {
			http.Error(w, "prefix strategy requires alias=true or domain=true", http.StatusBadRequest)
			return
		}
		account, err := chooseRandomEmailAccount(regularCandidates)
		if err != nil {
			http.Error(w, "No email accounts found", http.StatusNotFound)
			return
		}
		response := RandomEmailResponse{
			Status:    "success",
			EmailType: "regular",
			RawEmail:  account.EmailAddress,
			Email:     account.EmailAddress,
			AccountID: account.ID,
			Message:   "Random email account selected",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	useAlias := false
	switch {
	case len(aliasCandidates) > 0 && len(domainCandidates) > 0:
		choice, err := rand.Int(rand.Reader, big.NewInt(2))
		if err != nil {
			http.Error(w, "Error selecting random account", http.StatusInternalServerError)
			return
		}
		useAlias = choice.Int64() == 0
	case len(aliasCandidates) > 0:
		useAlias = true
	case len(domainCandidates) > 0:
		useAlias = false
	default:
		http.Error(w, "No matching alias or domain email accounts found", http.StatusNotFound)
		return
	}

	if useAlias {
		account, err := chooseRandomEmailAccount(aliasCandidates)
		if err != nil {
			http.Error(w, "No Gmail accounts found", http.StatusNotFound)
			return
		}
		generatedEmail, err := h.generateGmailAliasWithStrategy(account.EmailAddress, strategy, *account)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		response := RandomEmailResponse{
			Status:    "success",
			EmailType: "alias",
			RawEmail:  account.EmailAddress,
			Email:     generatedEmail,
			AccountID: account.ID,
			Message:   "Generated Gmail alias",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	account, err := chooseRandomEmailAccount(domainCandidates)
	if err != nil {
		http.Error(w, "No domain email accounts found", http.StatusNotFound)
		return
	}
	generatedEmail, err := h.generateDomainEmailWithStrategy(account.Domain, strategy, *account)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	response := RandomEmailResponse{
		Status:    "success",
		EmailType: "domain",
		Email:     generatedEmail,
		RawEmail:  account.EmailAddress,
		AccountID: account.ID,
		Message:   "Generated domain email",
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (h *APIHandler) generateGmailAliasWithStrategy(originalEmail string, strategy utils.EmailLocalPartStrategy, account models.EmailAccount) (string, error) {
	if !strategy.IsSet() {
		return h.generateGmailAlias(originalEmail)
	}
	localPart, domain, ok := splitBusinessEmail(originalEmail)
	if !ok {
		return "", fmt.Errorf("invalid email format")
	}
	aliasPart, err := generateEmailLocalPartForAccount(strategy, account, "", "")
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s+%s@%s", localPart, aliasPart, domain), nil
}

func (h *APIHandler) generateDomainEmailWithStrategy(domain string, strategy utils.EmailLocalPartStrategy, account models.EmailAccount) (string, error) {
	if !strategy.IsSet() {
		return h.generateDomainEmail(domain)
	}
	localPart, err := generateEmailLocalPartForAccount(strategy, account, "", "")
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s@%s", localPart, strings.ToLower(strings.TrimSpace(domain))), nil
}

// generateGmailAlias generates a random Gmail alias
func (h *APIHandler) generateGmailAlias(originalEmail string) (string, error) {
	parts := strings.Split(originalEmail, "@")
	if len(parts) != 2 {
		return "", fmt.Errorf("invalid email format")
	}

	localPart := parts[0]
	domain := parts[1]

	// Generate a natural-looking alias suffix
	suffix, err := generateRandomSuffix()
	if err != nil {
		return "", err
	}

	alias := fmt.Sprintf("%s+%s@%s", localPart, suffix, domain)
	return alias, nil
}

// generateDomainEmail generates a random email for a domain
func (h *APIHandler) generateDomainEmail(domain string) (string, error) {
	localPart, err := generateRandomLocalPart()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s@%s", localPart, domain), nil
}

// generateRandomSuffix creates a natural-looking random suffix for email aliases
// e.g., "swift.fox.k7", "blue.wave.3m", "nova9x"
func generateRandomSuffix() (string, error) {
	adjectives := []string{
		"swift", "blue", "red", "green", "dark", "cool", "wild", "fast",
		"gold", "iron", "deep", "warm", "bold", "calm", "keen", "pure",
		"soft", "true", "wise", "free", "new", "old", "big", "hot",
		"bright", "crisp", "fresh", "grand", "happy", "lucky", "prime", "quick",
		"sharp", "slim", "smart", "snowy", "tidy", "vast", "vivid", "young",
		"amber", "coral", "cyan", "frost", "ivory", "lilac", "misty", "royal",
	}
	nouns := []string{
		"fox", "owl", "cat", "ray", "sky", "sun", "bay", "oak",
		"gem", "star", "wave", "lake", "pine", "hawk", "bear", "wolf",
		"rain", "wind", "moon", "fire", "ice", "sea", "elk", "bee",
		"leaf", "dove", "fern", "hill", "cove", "reef", "peak", "vale",
		"lynx", "hare", "wren", "lark", "bass", "crow", "moth", "orca",
		"cliff", "brook", "ridge", "marsh", "dusk", "dawn", "mist", "glow",
	}
	chars := "abcdefghijklmnopqrstuvwxyz0123456789"

	adjIdx, err := rand.Int(rand.Reader, big.NewInt(int64(len(adjectives))))
	if err != nil {
		return "", err
	}
	nounIdx, err := rand.Int(rand.Reader, big.NewInt(int64(len(nouns))))
	if err != nil {
		return "", err
	}

	// Generate 2-3 char alphanumeric tail
	tailLen, err := rand.Int(rand.Reader, big.NewInt(2))
	if err != nil {
		return "", err
	}
	tail := make([]byte, tailLen.Int64()+2)
	for i := range tail {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			return "", err
		}
		tail[i] = chars[idx.Int64()]
	}

	// Randomly pick format
	formatChoice, err := rand.Int(rand.Reader, big.NewInt(3))
	if err != nil {
		return "", err
	}

	switch formatChoice.Int64() {
	case 0:
		return fmt.Sprintf("%s.%s.%s", adjectives[adjIdx.Int64()], nouns[nounIdx.Int64()], string(tail)), nil
	case 1:
		return fmt.Sprintf("%s%s", nouns[nounIdx.Int64()], string(tail)), nil
	default:
		return fmt.Sprintf("%s.%s", adjectives[adjIdx.Int64()], string(tail)), nil
	}
}

// generateRandomLocalPart creates a natural-looking random local part for domain emails
// e.g., "swift.fox.k7", "alex.nova3m", "wave.pine.r2"
func generateRandomLocalPart() (string, error) {
	words := []string{
		"alex", "sam", "max", "leo", "jay", "ray", "kai", "nova",
		"luna", "aria", "milo", "zoe", "finn", "iris", "jade", "echo",
		"reed", "cole", "dean", "nora", "blake", "casey", "drew", "eden",
		"gray", "harper", "jordan", "lane", "quinn", "sage", "tyler", "wren",
	}
	chars := "abcdefghijklmnopqrstuvwxyz0123456789"

	word1Idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(words))))
	if err != nil {
		return "", err
	}
	word2Idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(words))))
	if err != nil {
		return "", err
	}

	// Generate 2-3 char alphanumeric tail
	tailLen, err := rand.Int(rand.Reader, big.NewInt(2))
	if err != nil {
		return "", err
	}
	tail := make([]byte, tailLen.Int64()+2) // 2-3 chars
	for i := range tail {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			return "", err
		}
		tail[i] = chars[idx.Int64()]
	}

	// Randomly pick format
	formatChoice, err := rand.Int(rand.Reader, big.NewInt(3))
	if err != nil {
		return "", err
	}

	switch formatChoice.Int64() {
	case 0:
		// "word1.word2.xx" e.g., "alex.nova.k7"
		return fmt.Sprintf("%s.%s.%s", words[word1Idx.Int64()], words[word2Idx.Int64()], string(tail)), nil
	case 1:
		// "word1.xx" e.g., "luna.3m"
		return fmt.Sprintf("%s.%s", words[word1Idx.Int64()], string(tail)), nil
	default:
		// "word1xx" e.g., "milo7k"
		return fmt.Sprintf("%s%s", words[word1Idx.Int64()], string(tail)), nil
	}
}

// GetEmailDomainsHandler returns all unique email domains from accounts
// @Summary Get all email domains
// @Description Get all unique email domains from registered email accounts
// @Tags emails
// @Accept json
// @Produce json
// @Success 200 {object} EmailDomainsResponse "List of email domains"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/email-domains [get]
func (h *APIHandler) GetEmailDomainsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	accounts, err := h.EmailAccountRepo.GetAll(orgID)
	if err != nil {
		http.Error(w, "Error fetching accounts", http.StatusInternalServerError)
		return
	}

	// Extract unique domains
	domainMap := make(map[string]bool)
	for _, account := range accounts {
		if account.Domain != "" {
			domainMap[account.Domain] = true
		} else {
			// Extract domain from email address
			parts := strings.Split(account.EmailAddress, "@")
			if len(parts) == 2 {
				domainMap[parts[1]] = true
			}
		}
	}

	// Convert map to slice
	domains := make([]string, 0, len(domainMap))
	for domain := range domainMap {
		domains = append(domains, domain)
	}

	// Sort domains
	sort.Strings(domains)

	response := EmailDomainsResponse{
		Status:  "success",
		Domains: domains,
		Count:   len(domains),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
