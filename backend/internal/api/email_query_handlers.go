package api

import (
	"encoding/json"
	"fmt"
	"mailman/internal/database"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

// processSingleMailbox handles the sync process for a single mailbox
func (h *APIHandler) processSingleMailbox(
	account models.EmailAccount,
	mailboxName string,
	syncMode string,
	defaultStartDate *time.Time,
	endDate *time.Time,
	maxEmails int,
	includeBody bool,
) MailboxSyncResult {
	syncStartTime := time.Now()

	result := MailboxSyncResult{
		MailboxName:   mailboxName,
		SyncStartTime: syncStartTime,
		SyncEndTime:   syncStartTime, // Will be updated at the end
	}

	// Determine sync date range
	var startDate *time.Time

	if syncMode == "incremental" {
		// Try to get previous sync record
		syncRecord, err := h.IncrementalSyncRepo.GetByAccountAndMailbox(account.ID, mailboxName)
		if err == nil {
			// Use previous sync end time as start time
			startDate = &syncRecord.LastSyncEndTime
			result.PreviousSyncEndTime = &syncRecord.LastSyncEndTime
		} else {
			// No previous sync record, use default start date
			startDate = defaultStartDate
			h.logger.Info("No previous sync record found for account %d mailbox %s, using default start date", account.ID, mailboxName)
		}
	} else {
		// Full sync mode - use default start date or nil for all emails
		startDate = defaultStartDate
	}

	// Prepare fetch options
	options := services.FetchEmailsOptions{
		Mailbox:         mailboxName,
		Limit:           maxEmails,
		Offset:          0,
		StartDate:       startDate,
		EndDate:         endDate,
		FetchFromServer: true,
		IncludeBody:     includeBody,
		SortBy:          "date_desc",
	}

	// Fetch emails from server
	emails, err := h.Fetcher.FetchEmailsWithOptions(account, options)
	if err != nil {
		result.Error = err.Error()
		result.SyncEndTime = time.Now()
		return result
	}

	result.EmailsProcessed = len(emails)

	var newEmails []models.Email
	if h.EmailIngestService != nil {
		newEmails, err = h.EmailIngestService.IngestEmails(emails, services.EmailIngestOptions{
			Source:       services.EmailIngestSourceManualSync,
			AccountEmail: account.EmailAddress,
			Metadata: map[string]interface{}{
				"entrypoint": "process_single_mailbox",
				"mailbox":    mailboxName,
				"sync_mode":  syncMode,
			},
		})
		if err != nil {
			result.Error = fmt.Sprintf("Failed to ingest emails: %v", err)
			result.SyncEndTime = time.Now()
			return result
		}
	} else {
		// Fallback for tests or legacy construction paths that do not provide the ingest service.
		for _, email := range emails {
			if email.MessageID != "" {
				exists, err := h.EmailRepo.CheckDuplicate(email.MessageID, account.ID)
				if err != nil {
					h.logger.Error("Error checking duplicate for message %s: %v", email.MessageID, err)
					continue
				}
				if exists {
					continue
				}
			}
			newEmails = append(newEmails, email)
		}
		if len(newEmails) > 0 {
			if err := h.EmailRepo.CreateBatch(newEmails); err != nil {
				result.Error = fmt.Sprintf("Failed to store emails: %v", err)
				result.SyncEndTime = time.Now()
				return result
			}
		}
	}

	result.NewEmails = len(newEmails)

	if len(newEmails) > 0 {
		h.logger.Info("Stored %d new emails for account %d mailbox %s", len(newEmails), account.ID, mailboxName)
	}

	result.SyncEndTime = time.Now()

	// Update or create incremental sync record
	if syncMode == "incremental" {
		syncRecord := &models.IncrementalSyncRecord{
			AccountID:         account.ID,
			MailboxName:       mailboxName,
			LastSyncStartTime: syncStartTime,
			LastSyncEndTime:   result.SyncEndTime,
			EmailsProcessed:   result.EmailsProcessed,
		}

		if err := h.IncrementalSyncRepo.CreateOrUpdate(syncRecord); err != nil {
			h.logger.Error("Failed to update incremental sync record: %v", err)
			// Don't fail the entire operation for this
		}
	}

	return result
}

// GetEmailsHandler retrieves emails for an account with advanced search capabilities
// @Summary Get emails for an account with advanced search
// @Description Get emails for an account with support for date range, text search, and keyword filtering
// @Tags account-emails
// @Accept json
// @Produce json
// @Param id path int true "Account ID"
// @Param limit query int false "Limit (default: 50, max: 100)"
// @Param offset query int false "Offset for pagination (default: 0)"
// @Param sort_by query string false "Sort order: date_desc, date_asc, subject_asc, subject_desc (default: date_desc)"
// @Param start_date query string false "Start date for filtering (RFC3339 format)"
// @Param end_date query string false "End date for filtering (RFC3339 format)"
// @Param from_query query string false "Search in From field (fuzzy match)"
// @Param to_query query string false "Search in To field (fuzzy match)"
// @Param cc_query query string false "Search in CC field (fuzzy match)"
// @Param subject_query query string false "Search in Subject field (fuzzy match)"
// @Param body_query query string false "Search in email body (fuzzy match)"
// @Param html_query query string false "Search in HTML body (fuzzy match)"
// @Param keyword query string false "Global keyword search across all text fields"
// @Param mailbox query string false "Filter by mailbox name"
// @Success 200 {object} map[string]interface{} "Response with emails array and pagination info"
// @Router /api/account-emails/list/{id} [get]
func (h *APIHandler) GetEmailsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	// 验证账户归属当前组织
	if orgID > 0 {
		account, err := h.EmailAccountRepo.GetByID(uint(id))
		if err != nil || account.OrgID != orgID {
			http.Error(w, "Account not found or access denied", http.StatusForbidden)
			return
		}
	}

	// Parse query parameters
	options := repository.EmailSearchOptions{
		AccountID: uint(id),
		Limit:     50,
		Offset:    0,
		SortBy:    "date DESC",
	}

	// Parse limit
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsedLimit, err := strconv.Atoi(l); err == nil && parsedLimit > 0 {
			if parsedLimit > 100 {
				parsedLimit = 100 // Cap at 100
			}
			options.Limit = parsedLimit
		}
	}

	// Parse offset
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsedOffset, err := strconv.Atoi(o); err == nil && parsedOffset >= 0 {
			options.Offset = parsedOffset
		}
	}

	// Parse sort order
	if sortBy := r.URL.Query().Get("sort_by"); sortBy != "" {
		validSortOptions := map[string]string{
			"date_desc":    "date DESC",
			"date_asc":     "date ASC",
			"subject_asc":  "subject ASC",
			"subject_desc": "subject DESC",
		}
		if validSort, exists := validSortOptions[sortBy]; exists {
			options.SortBy = validSort
		}
	}

	// Parse date range
	if startDate := r.URL.Query().Get("start_date"); startDate != "" {
		if parsed, err := time.Parse(time.RFC3339, startDate); err == nil {
			options.StartDate = &parsed
		}
	}
	if endDate := r.URL.Query().Get("end_date"); endDate != "" {
		if parsed, err := time.Parse(time.RFC3339, endDate); err == nil {
			options.EndDate = &parsed
		}
	}

	// Parse text search parameters
	options.FromQuery = r.URL.Query().Get("from_query")
	options.ToQuery = r.URL.Query().Get("to_query")
	options.CcQuery = r.URL.Query().Get("cc_query")
	options.SubjectQuery = r.URL.Query().Get("subject_query")
	options.BodyQuery = r.URL.Query().Get("body_query")
	options.HTMLQuery = r.URL.Query().Get("html_query")
	options.Keyword = r.URL.Query().Get("keyword")
	options.MailboxName = r.URL.Query().Get("mailbox")

	// 如果有to_query参数，先尝试立即同步对应账户的邮件
	if options.ToQuery != "" {
		if err := h.syncEmailsForToQuery(options.ToQuery); err != nil {
			// 记录错误但不阻止搜索，因为可能数据库中已有部分邮件
			// 使用标准log包记录错误
			h.logger.Warn("Failed to sync emails for to_query %s: %v", options.ToQuery, err)
		}
	}

	// Perform search
	emails, totalCount, err := h.EmailRepo.SearchEmails(options)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Calculate pagination info
	totalPages := int((totalCount + int64(options.Limit) - 1) / int64(options.Limit))
	currentPage := (options.Offset / options.Limit) + 1
	hasNext := options.Offset+options.Limit < int(totalCount)
	hasPrev := options.Offset > 0

	response := map[string]interface{}{
		"emails": emails,
		"pagination": map[string]interface{}{
			"total":        totalCount,
			"total_pages":  totalPages,
			"current_page": currentPage,
			"limit":        options.Limit,
			"offset":       options.Offset,
			"has_next":     hasNext,
			"has_prev":     hasPrev,
		},
		"search_criteria": map[string]interface{}{
			"account_id":    options.AccountID,
			"start_date":    options.StartDate,
			"end_date":      options.EndDate,
			"from_query":    options.FromQuery,
			"to_query":      options.ToQuery,
			"cc_query":      options.CcQuery,
			"subject_query": options.SubjectQuery,
			"body_query":    options.BodyQuery,
			"html_query":    options.HTMLQuery,
			"keyword":       options.Keyword,
			"mailbox":       options.MailboxName,
			"sort_by":       options.SortBy,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// SearchEmailsHandler searches emails with optional account filtering
// @Summary Search emails with optional account ID
// @Description Search emails with optional account filtering and to_query parameter
// @Tags emails
// @Accept json
// @Produce json
// @Param account_id query int false "Account ID (optional)"
// @Param to_query query string false "Filter by recipient email"
// @Param from_query query string false "Filter by sender email"
// @Param limit query int false "Limit results (default 50, max 100)"
// @Param offset query int false "Offset for pagination"
// @Param sort_by query string false "Sort order (date_desc, date_asc, etc.)"
// @Param start_date query string false "Start date (RFC3339 format)"
// @Param end_date query string false "End date (RFC3339 format)"
// @Param subject_query query string false "Filter by subject"
// @Param body_query query string false "Filter by email body"
// @Param html_query query string false "Filter by HTML body"
// @Param keyword query string false "Global search across all fields"
// @Param mailbox query string false "Filter by mailbox name"
// @Success 200 {object} map[string]interface{} "Response with emails array and pagination info"
// @Router /api/emails/search [get]
func (h *APIHandler) SearchEmailsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	// Create search options
	options := repository.EmailSearchOptions{
		OrgID:  orgID,
		Limit:  50,
		Offset: 0,
		SortBy: "date DESC",
	}

	// Try to get optional account ID from query parameters
	if accountID := r.URL.Query().Get("account_id"); accountID != "" {
		if id, err := strconv.ParseUint(accountID, 10, 32); err == nil {
			options.AccountID = uint(id)
		}
	}

	// Parse limit
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsedLimit, err := strconv.Atoi(l); err == nil && parsedLimit > 0 {
			if parsedLimit > 100 {
				parsedLimit = 100 // Cap at 100
			}
			options.Limit = parsedLimit
		}
	}

	// Parse offset
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsedOffset, err := strconv.Atoi(o); err == nil && parsedOffset >= 0 {
			options.Offset = parsedOffset
		}
	}

	// Parse sort order
	if sortBy := r.URL.Query().Get("sort_by"); sortBy != "" {
		validSortOptions := map[string]string{
			"date_desc":    "date DESC",
			"date_asc":     "date ASC",
			"subject_asc":  "subject ASC",
			"subject_desc": "subject DESC",
		}
		if validSort, exists := validSortOptions[sortBy]; exists {
			options.SortBy = validSort
		}
	}

	// Parse date range
	if startDate := r.URL.Query().Get("start_date"); startDate != "" {
		if parsed, err := time.Parse(time.RFC3339, startDate); err == nil {
			options.StartDate = &parsed
		}
	}
	if endDate := r.URL.Query().Get("end_date"); endDate != "" {
		if parsed, err := time.Parse(time.RFC3339, endDate); err == nil {
			options.EndDate = &parsed
		}
	}

	// Parse text search parameters
	options.FromQuery = r.URL.Query().Get("from_query")
	options.ToQuery = r.URL.Query().Get("to_query")
	options.CcQuery = r.URL.Query().Get("cc_query")
	options.SubjectQuery = r.URL.Query().Get("subject_query")
	options.BodyQuery = r.URL.Query().Get("body_query")
	options.HTMLQuery = r.URL.Query().Get("html_query")
	options.Keyword = r.URL.Query().Get("keyword")
	options.MailboxName = r.URL.Query().Get("mailbox")

	// Perform search
	emails, totalCount, err := h.EmailRepo.SearchEmails(options)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Calculate pagination info
	totalPages := int((totalCount + int64(options.Limit) - 1) / int64(options.Limit))
	currentPage := (options.Offset / options.Limit) + 1
	hasNext := options.Offset+options.Limit < int(totalCount)
	hasPrev := options.Offset > 0

	response := map[string]interface{}{
		"emails": emails,
		"pagination": map[string]interface{}{
			"total":        totalCount,
			"total_pages":  totalPages,
			"current_page": currentPage,
			"limit":        options.Limit,
			"offset":       options.Offset,
			"has_next":     hasNext,
			"has_prev":     hasPrev,
		},
		"search_criteria": map[string]interface{}{
			"account_id":    options.AccountID,
			"start_date":    options.StartDate,
			"end_date":      options.EndDate,
			"from_query":    options.FromQuery,
			"to_query":      options.ToQuery,
			"cc_query":      options.CcQuery,
			"subject_query": options.SubjectQuery,
			"body_query":    options.BodyQuery,
			"html_query":    options.HTMLQuery,
			"keyword":       options.Keyword,
			"mailbox":       options.MailboxName,
			"sort_by":       options.SortBy,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetEmailHandler retrieves a specific email
// @Summary Get an email by ID
// @Description Get an email by ID
// @Tags emails
// @Accept json
// @Produce json
// @Param id path int true "Email ID"
// @Success 200 {object} models.Email
// @Router /api/emails/{id} [get]
func (h *APIHandler) GetEmailHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid email ID", http.StatusBadRequest)
		return
	}

	email, err := h.EmailRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(email)
}

// ExtractEmailsHandler handles email content extraction with advanced filtering
// @Summary Extract content from emails with advanced filtering and processing
// @Description Extract specific content from emails using regex, JavaScript, or Go templates with comprehensive search and filtering capabilities. Supports both account-specific and global extraction.
// @Tags account-emails,emails
// @Accept json
// @Produce json
// @Param id path int false "Account ID (only for /account-emails/extract/{id} endpoint)"
// @Param request body ExtractEmailsRequest true "Extraction request with search criteria and extractors"
// @Success 200 {object} ExtractEmailsResponse "Extraction results with matches and statistics"
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 404 {object} map[string]string "Account not found"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /api/account-emails/extract/{id} [post]
// @Router /api/emails/extract [post]
func (h *APIHandler) ExtractEmailsHandler(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	// Parse account ID from URL (optional for global endpoint)
	vars := mux.Vars(r)
	var accountID uint
	if idStr, exists := vars["id"]; exists && idStr != "" {
		id, err := strconv.ParseUint(idStr, 10, 32)
		if err != nil {
			http.Error(w, "Invalid account ID", http.StatusBadRequest)
			return
		}
		accountID = uint(id)
	}

	// Parse request body
	var req ExtractEmailsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Get extractors from template if ExtractorID is provided
	var templateExtractors []ExtractorConfig
	if req.ExtractorID != nil {
		templateRepo := repository.NewExtractorTemplateRepository(database.GetDB())
		template, err := templateRepo.GetByID(*req.ExtractorID)
		if err != nil {
			http.Error(w, "Invalid extractor template ID: "+err.Error(), http.StatusBadRequest)
			return
		}

		// Convert template extractors to API extractors
		for _, extractor := range template.Extractors {
			templateExtractors = append(templateExtractors, ExtractorConfig{
				Field: extractor.Field,
				Type:  extractor.Type,
				Match: extractor.Match,

				Extract: extractor.Extract,
			})
		}
	}

	// Merge template extractors with request extractors
	allExtractors := append(templateExtractors, req.Extractors...)

	// Validate extractors
	if len(allExtractors) == 0 {
		http.Error(w, "At least one extractor must be provided (either directly or via template)", http.StatusBadRequest)
		return
	}

	// Validate extractor configurations
	for i, extractor := range allExtractors {
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
	}

	// Convert API request to repository search options
	options := repository.EmailSearchOptions{
		AccountID:    accountID, // Use the parsed account ID from URL path (0 for global search)
		Limit:        req.Limit,
		Offset:       req.Offset,
		SortBy:       req.SortBy,
		FromQuery:    req.FromQuery,
		ToQuery:      req.ToQuery,
		CcQuery:      req.CcQuery,
		SubjectQuery: req.SubjectQuery,
		BodyQuery:    req.BodyQuery,
		HTMLQuery:    req.HTMLQuery,
		Keyword:      req.Keyword,
		MailboxName:  req.MailboxName,
	}

	// Parse date filters
	if req.StartDate != nil {
		if parsed, err := time.Parse(time.RFC3339, *req.StartDate); err == nil {
			options.StartDate = &parsed
		}
	}
	if req.EndDate != nil {
		if parsed, err := time.Parse(time.RFC3339, *req.EndDate); err == nil {
			options.EndDate = &parsed
		}
	}

	// Set default batch size
	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = 50
	}

	// Create extractor service
	extractorService := services.NewExtractorService()

	// Convert API extractors to service extractors
	var serviceExtractors []services.ExtractorConfig
	for _, apiExtractor := range allExtractors {
		serviceExtractors = append(serviceExtractors, services.ExtractorConfig{
			Field: services.ExtractorField(apiExtractor.Field),
			Type:  services.ExtractorType(apiExtractor.Type),
			Match: apiExtractor.Match,

			Extract: apiExtractor.Extract,
		})
	}

	// Create cursor for streaming processing
	cursor := h.EmailRepo.NewEmailCursor(options, batchSize)
	defer cursor.Close()

	// Process emails in batches
	var results []ExtractorResult
	var totalProcessed int
	var totalMatched int
	var batchesProcessed int
	var extractorStats []ExtractorStats

	// Initialize extractor statistics
	for _, extractor := range allExtractors {
		extractorStats = append(extractorStats, ExtractorStats{
			Config:             extractor,
			MatchCount:         0,
			TotalMatches:       0,
			AvgMatchesPerEmail: 0,
		})
	}

	// Process emails in batches using cursor
	for {
		emails, err := cursor.Next()
		if err != nil {
			http.Error(w, "Error processing emails: "+err.Error(), http.StatusInternalServerError)
			return
		}

		if len(emails) == 0 {
			break // No more emails
		}

		batchesProcessed++
		totalProcessed += len(emails)

		// Process each email in the batch
		for _, email := range emails {
			result, err := extractorService.ExtractFromEmail(email, serviceExtractors)
			if err != nil {
				h.logger.Error("Error extracting from email ID %d: %v", email.ID, err)
				continue
			}

			if result != nil {
				results = append(results, ExtractorResult{
					Email:   result.Email,
					Matches: result.Matches,
				})
				totalMatched++

				// Update extractor statistics
				for i, extractor := range serviceExtractors {
					extractorResult, err := extractorService.ExtractFromEmail(email, []services.ExtractorConfig{extractor})
					if err == nil && extractorResult != nil && len(extractorResult.Matches) > 0 {
						extractorStats[i].MatchCount++
						extractorStats[i].TotalMatches += len(extractorResult.Matches)
					}
				}
			}
		}
	}

	// Calculate final statistics
	processingTime := time.Since(startTime)
	avgTimePerEmail := float64(processingTime.Nanoseconds()) / float64(totalProcessed) / 1000000 // Convert to milliseconds

	for i := range extractorStats {
		if extractorStats[i].MatchCount > 0 {
			extractorStats[i].AvgMatchesPerEmail = float64(extractorStats[i].TotalMatches) / float64(extractorStats[i].MatchCount)
		}
	}

	// Build response
	response := ExtractEmailsResponse{
		Results:        results,
		TotalProcessed: totalProcessed,
		TotalMatched:   totalMatched,
		Summary: ExtractSummary{
			ProcessingTimeMs: processingTime.Nanoseconds() / 1000000,
			BatchesProcessed: batchesProcessed,
			AvgTimePerEmail:  avgTimePerEmail,
			ExtractorStats:   extractorStats,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CheckEmailHandler checks for new emails once (for frontend polling)
// @Summary Check for new emails once
// @Description Check for new emails for a specific email address. Uses intelligent email resolution to handle Gmail aliases, domain emails, and real email addresses. Returns immediately without polling.
// @Tags emails
// @Accept json
// @Produce json
// @Param request body CheckEmailRequest true "Request body with email and optional extractors"
// @Success 200 {object} CheckEmailResponse "Email check result"
// @Failure 400 {string} string "Bad Request - Invalid parameters"
// @Failure 404 {string} string "Not Found - Email address cannot be resolved to any account"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/check-email [post]
func (h *APIHandler) CheckEmailHandler(w http.ResponseWriter, r *http.Request) {
	// Parse request body
	var request CheckEmailRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate input
	if request.Email == "" {
		http.Error(w, "Email address is required", http.StatusBadRequest)
		return
	}

	// Try to resolve email to account using intelligent resolution
	account, err := h.EmailAccountRepo.GetByEmailOrAlias(request.Email)
	if err != nil {
		// Return detailed error information
		response := CheckEmailResponse{
			Status:  "error",
			Found:   false,
			Error:   fmt.Sprintf("无法解析邮箱 %s 到任何已配置的账户。可能原因：1) 邮箱不存在于系统中 2) 需要配置域名邮箱 3) Gmail别名未正确配置", request.Email),
			Message: "Email address resolution failed",
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(response)
		return
	}

	// Parse start time
	var filterStartTime time.Time
	if request.StartTime != nil {
		if parsed, err := time.Parse(time.RFC3339, *request.StartTime); err == nil {
			filterStartTime = parsed
		} else {
			response := CheckEmailResponse{
				Status:  "error",
				Found:   false,
				Error:   fmt.Sprintf("Invalid start_time format: %v", err),
				Message: "Invalid start_time format",
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(response)
			return
		}
	} else {
		// Default to 1 hour ago to catch recent emails
		filterStartTime = time.Now().Add(-1 * time.Hour)
	}

	// Validate extractors if provided
	var extractorService *services.ExtractorService
	var serviceExtractors []services.ExtractorConfig
	if len(request.Extract) > 0 {
		extractorService = services.NewExtractorService()
		for i, extractor := range request.Extract {
			if extractor.Field == "" || extractor.Type == "" || extractor.Extract == "" {
				response := CheckEmailResponse{
					Status:  "error",
					Found:   false,
					Error:   fmt.Sprintf("Extractor %d is missing required fields", i),
					Message: "Invalid extractor configuration",
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(response)
				return
			}

			// Validate field values
			validFields := map[string]bool{
				"ALL": true, "from": true, "to": true, "cc": true,
				"subject": true, "body": true, "html_body": true, "headers": true,
			}
			if !validFields[extractor.Field] {
				response := CheckEmailResponse{
					Status:  "error",
					Found:   false,
					Error:   fmt.Sprintf("Invalid field '%s' in extractor %d", extractor.Field, i),
					Message: "Invalid extractor field",
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(response)
				return
			}

			// Validate type values
			validTypes := map[string]bool{"regex": true, "js": true, "gotemplate": true}
			if !validTypes[extractor.Type] {
				response := CheckEmailResponse{
					Status:  "error",
					Found:   false,
					Error:   fmt.Sprintf("Invalid type '%s' in extractor %d", extractor.Type, i),
					Message: "Invalid extractor type",
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(response)
				return
			}

			serviceExtractors = append(serviceExtractors, services.ExtractorConfig{
				Field:   services.ExtractorField(extractor.Field),
				Type:    services.ExtractorType(extractor.Type),
				Match:   extractor.Match,
				Extract: extractor.Extract,
			})
		}
	}

	// Check for new emails from database (single check, no polling)
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
		h.logger.Error("Error fetching emails during check: %v", err)
		response := CheckEmailResponse{
			Status:  "error",
			Found:   false,
			Error:   fmt.Sprintf("Failed to fetch emails: %v", err),
			Message: "Email fetch failed",
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(response)
		return
	}

	// Check if any email matches the criteria
	for _, email := range emails {
		// If no extractors, return the first email (already filtered by FetchEmailsWithOptions)
		if len(serviceExtractors) == 0 {
			response := CheckEmailResponse{
				Status:  "success",
				Found:   true,
				Email:   &email,
				Message: "Email found",
				ResolvedAccount: &AccountInfo{
					ID:           account.ID,
					EmailAddress: account.EmailAddress,
					IsDomainMail: account.IsDomainMail,
					Domain:       account.Domain,
				},
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
			response := CheckEmailResponse{
				Status:  "success",
				Found:   true,
				Email:   &email,
				Matches: result.Matches,
				Message: "Email found with matching extractors",
				ResolvedAccount: &AccountInfo{
					ID:           account.ID,
					EmailAddress: account.EmailAddress,
					IsDomainMail: account.IsDomainMail,
					Domain:       account.Domain,
				},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(response)
			return
		}
	}

	// No matching email found
	response := CheckEmailResponse{
		Status:  "success",
		Found:   false,
		Message: "No new emails found",
		ResolvedAccount: &AccountInfo{
			ID:           account.ID,
			EmailAddress: account.EmailAddress,
			IsDomainMail: account.IsDomainMail,
			Domain:       account.Domain,
		},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// EmailStatsResponse represents the response structure for email statistics
type EmailStatsResponse struct {
	// 账户统计
	TotalAccounts    int64 `json:"totalAccounts"`
	VerifiedAccounts int64 `json:"verifiedAccounts"`
	SyncingAccounts  int64 `json:"syncingAccounts"`
	ErrorAccounts    int64 `json:"errorAccounts"`
	// 邮件统计
	TotalEmails     int64   `json:"totalEmails"`
	UnreadEmails    int64   `json:"unreadEmails"`
	TodayEmails     int64   `json:"todayEmails"`
	TotalGrowthRate float64 `json:"totalGrowthRate"` // 总邮件增长率 (今日vs昨日24:00)
	TodayGrowthRate float64 `json:"todayGrowthRate"` // 今日邮件增长率 (今日vs昨日)
	// 触发器统计
	TotalTriggers   int64 `json:"totalTriggers"`
	EnabledTriggers int64 `json:"enabledTriggers"`
}

// GetEmailStatsHandler godoc
// @Summary Get email statistics for dashboard
// @Description Get comprehensive email statistics including accounts, emails, triggers and growth rates
// @Tags dashboard
// @Accept json
// @Produce json
// @Success 200 {object} EmailStatsResponse
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/dashboard/stats [get]
func (h *APIHandler) GetEmailStatsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	// === 账户统计 ===
	var totalAccounts, verifiedAccounts, syncingAccounts, errorAccounts int64
	accountStats, err := h.EmailAccountRepo.GetDashboardStats(orgID)
	if err == nil {
		totalAccounts = accountStats.TotalAccounts
		verifiedAccounts = accountStats.VerifiedAccounts
		errorAccounts = accountStats.ErrorAccounts
	}

	// 同步中的账户数：通过 PerAccountSyncManager 获取
	if h.perAccountSyncManager != nil {
		stats := h.perAccountSyncManager.GetStats()
		syncingAccounts = stats.ActiveSyncers
	}

	// === 邮件统计 ===
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	tomorrowStart := todayStart.AddDate(0, 0, 1)

	emailStats, err := h.EmailRepo.GetDashboardStats(orgID, todayStart, tomorrowStart)
	var totalEmails, unreadEmails, todayEmails, yesterdayEmails, emailsUntilYesterday int64
	if err == nil {
		totalEmails = emailStats.TotalEmails
		unreadEmails = emailStats.UnreadEmails
		todayEmails = emailStats.TodayEmails
		yesterdayEmails = emailStats.YesterdayEmails
		emailsUntilYesterday = emailStats.EmailsUntilYesterday
	}

	// 计算总邮件增长率
	var totalGrowthRate float64 = 0
	if emailsUntilYesterday > 0 {
		growth := totalEmails - emailsUntilYesterday
		totalGrowthRate = float64(growth) / float64(emailsUntilYesterday) * 100
	} else if totalEmails > 0 {
		totalGrowthRate = 100
	}

	// 计算今日邮件增长率
	var todayGrowthRate float64 = 0
	if yesterdayEmails > 0 {
		growth := todayEmails - yesterdayEmails
		todayGrowthRate = float64(growth) / float64(yesterdayEmails) * 100
	} else if todayEmails > 0 {
		todayGrowthRate = 100
	}

	// === 触发器统计 ===
	var totalTriggers, enabledTriggers int64
	db := database.GetDB()
	if db != nil {
		triggerQuery := db.Model(&models.EmailTriggerV2{})
		enabledQuery := db.Model(&models.EmailTriggerV2{}).Where("enabled = ?", true)
		if orgID > 0 {
			triggerQuery = triggerQuery.Where("org_id = ?", orgID)
			enabledQuery = enabledQuery.Where("org_id = ?", orgID)
		}
		triggerQuery.Count(&totalTriggers)
		enabledQuery.Count(&enabledTriggers)
	}

	response := EmailStatsResponse{
		TotalAccounts:    totalAccounts,
		VerifiedAccounts: verifiedAccounts,
		SyncingAccounts:  syncingAccounts,
		ErrorAccounts:    errorAccounts,
		TotalEmails:      totalEmails,
		UnreadEmails:     unreadEmails,
		TodayEmails:      todayEmails,
		TotalGrowthRate:  totalGrowthRate,
		TodayGrowthRate:  todayGrowthRate,
		TotalTriggers:    totalTriggers,
		EnabledTriggers:  enabledTriggers,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetAllEmailsHandler retrieves all emails from all accounts with advanced search capabilities
// @Summary Get all emails with advanced search
// @Description Get all emails across all accounts with support for date range, text search, and keyword filtering
// @Tags account-emails
// @Accept json
// @Produce json
// @Param limit query int false "Limit (default: 50, max: 100)"
// @Param offset query int false "Offset for pagination (default: 0)"
// @Param sort_by query string false "Sort order: date_desc, date_asc, subject_asc, subject_desc (default: date_desc)"
// @Param start_date query string false "Start date for filtering (RFC3339 format)"
// @Param end_date query string false "End date for filtering (RFC3339 format)"
// @Param from_query query string false "Search in From field (fuzzy match)"
// @Param to_query query string false "Search in To field (fuzzy match)"
// @Param cc_query query string false "Search in CC field (fuzzy match)"
// @Param subject_query query string false "Search in Subject field (fuzzy match)"
// @Param body_query query string false "Search in email body (fuzzy match)"
// @Param html_query query string false "Search in HTML body (fuzzy match)"
// @Param keyword query string false "Global keyword search across all text fields"
// @Param mailbox query string false "Filter by mailbox name (comma-separated for multiple)"
// @Success 200 {object} map[string]interface{} "Response with emails array and pagination info"
// @Router /api/account-emails/list/all [get]
func (h *APIHandler) GetAllEmailsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	// Parse query parameters
	options := repository.EmailSearchOptions{
		AccountID: 0, // 0 means all accounts
		OrgID:     orgID,
		Limit:     50,
		Offset:    0,
		SortBy:    "date DESC",
	}

	// Parse limit
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsedLimit, err := strconv.Atoi(l); err == nil && parsedLimit > 0 {
			if parsedLimit > 100 {
				parsedLimit = 100 // Cap at 100
			}
			options.Limit = parsedLimit
		}
	}

	// Parse offset
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsedOffset, err := strconv.Atoi(o); err == nil && parsedOffset >= 0 {
			options.Offset = parsedOffset
		}
	}

	// Parse sort order
	if sortBy := r.URL.Query().Get("sort_by"); sortBy != "" {
		validSortOptions := map[string]string{
			"date_desc":    "date DESC",
			"date_asc":     "date ASC",
			"subject_asc":  "subject ASC",
			"subject_desc": "subject DESC",
		}
		if validSort, exists := validSortOptions[sortBy]; exists {
			options.SortBy = validSort
		}
	}

	// Parse date range
	if startDate := r.URL.Query().Get("start_date"); startDate != "" {
		if parsed, err := time.Parse(time.RFC3339, startDate); err == nil {
			options.StartDate = &parsed
		}
	}
	if endDate := r.URL.Query().Get("end_date"); endDate != "" {
		if parsed, err := time.Parse(time.RFC3339, endDate); err == nil {
			options.EndDate = &parsed
		}
	}

	// Parse text search parameters
	options.FromQuery = r.URL.Query().Get("from_query")
	options.ToQuery = r.URL.Query().Get("to_query")
	options.CcQuery = r.URL.Query().Get("cc_query")
	options.SubjectQuery = r.URL.Query().Get("subject_query")
	options.BodyQuery = r.URL.Query().Get("body_query")
	options.HTMLQuery = r.URL.Query().Get("html_query")
	options.Keyword = r.URL.Query().Get("keyword")
	options.MailboxName = r.URL.Query().Get("mailbox")

	// Perform search
	emails, totalCount, err := h.EmailRepo.SearchEmails(options)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Calculate pagination info
	totalPages := int((totalCount + int64(options.Limit) - 1) / int64(options.Limit))
	currentPage := (options.Offset / options.Limit) + 1
	hasNext := options.Offset+options.Limit < int(totalCount)
	hasPrev := options.Offset > 0

	response := map[string]interface{}{
		"emails": emails,
		"pagination": map[string]interface{}{
			"total":        totalCount,
			"total_pages":  totalPages,
			"current_page": currentPage,
			"limit":        options.Limit,
			"offset":       options.Offset,
			"has_next":     hasNext,
			"has_prev":     hasPrev,
		},
		"search_criteria": map[string]interface{}{
			"account_id":    options.AccountID,
			"start_date":    options.StartDate,
			"end_date":      options.EndDate,
			"from_query":    options.FromQuery,
			"to_query":      options.ToQuery,
			"cc_query":      options.CcQuery,
			"subject_query": options.SubjectQuery,
			"body_query":    options.BodyQuery,
			"html_query":    options.HTMLQuery,
			"keyword":       options.Keyword,
			"mailbox":       options.MailboxName,
			"sort_by":       options.SortBy,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetEmailFoldersHandler retrieves all unique mailbox folders across all accounts
// @Summary Get all unique email folders
// @Description Get all unique mailbox folders (like INBOX, Sent, Drafts, etc.) across all accounts
// @Tags account-emails
// @Accept json
// @Produce json
// @Success 200 {object} map[string]interface{} "Response with folders array"
// @Router /api/account-emails/folders [get]
func (h *APIHandler) GetEmailFoldersHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	folders, err := h.EmailRepo.GetAllMailboxFolders(orgID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"folders": folders,
		"count":   len(folders),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
