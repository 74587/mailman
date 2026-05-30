package api

import (
	"encoding/json"
	"fmt"
	"io"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// CreateAccountHandler creates a new email account
// @Summary Create a new email account
// @Description Create a new email account
// @Tags accounts
// @Accept json
// @Produce json
// @Param account body CreateAccountRequest true "Email Account"
// @Success 201 {object} models.EmailAccount
// @Router /api/accounts [post]
func (h *APIHandler) CreateAccountHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	var request CreateAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Convert request to model
	account := models.EmailAccount{
		EmailAddress:         request.EmailAddress,
		AuthType:             request.AuthType,
		Password:             services.EncryptIfAvailable(request.Password),
		Token:                services.EncryptIfAvailable(request.Token),
		MailProviderID:       request.MailProviderID,
		OAuth2ProviderID:     request.OAuth2ProviderID,
		Proxy:                request.Proxy,
		ProxyMode:            models.NormalizeProxyAccountMode(request.ProxyMode),
		ProxyID:              request.ProxyID,
		ProxyFallbackMode:    models.NormalizeProxyFallbackMode(request.ProxyFallbackMode),
		ProxyFallbackProxyID: request.ProxyFallbackProxyID,
		ProxyFallbackProxy:   request.ProxyFallbackProxy,
		ProxyMatchGroupIDs:   request.ProxyMatchGroupIDs,
		ProxyMatchTagIDs:     request.ProxyMatchTagIDs,
		ProxyMatchTagMode:    models.NormalizeProxyTagFilterMode(request.ProxyMatchTagMode),
		IsDomainMail:         request.IsDomainMail,
		Domain:               request.Domain,
		ForwardedAddresses:   models.NormalizeEmailRoutingAddresses(request.ForwardedAddresses),
		Note:                 request.Note,
		NoteFormat:           models.NormalizeAccountNoteFormat(request.NoteFormat),
		CustomSettings:       request.CustomSettings,
	}

	account.OrgID = orgID

	if h.ProxyPoolService != nil {
		if err := h.ProxyPoolService.PrepareAccountProxy(&account); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	if err := h.EmailAccountRepo.Create(&account); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Log activity
	userID := getUserIDFromContext(r)
	h.activityLogger.LogAccountActivity(models.ActivityAccountAdded, &account, userID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(account)
}

// GetAccountsHandler retrieves all email accounts
// @Summary Get all email accounts
// @Description Get all email accounts
// @Tags accounts
// @Accept json
// @Produce json
// @Success 200 {array} models.EmailAccount
// @Router /api/accounts [get]
func (h *APIHandler) GetAccountsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	accounts, err := h.EmailAccountRepo.GetAll(orgID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accounts)
}

// GetAccountsPaginatedHandler retrieves email accounts with pagination
// @Summary Get email accounts with pagination
// @Description Get email accounts with pagination support and comprehensive filtering
// @Tags accounts
// @Accept json
// @Produce json
// @Param page query int false "Page number (default: 1)"
// @Param limit query int false "Items per page (default: 10)"
// @Param sort_by query string false "Sort field (default: created_at)"
// @Param sort_order query string false "Sort order: asc or desc (default: desc)"
// @Param search query string false "Search term for email address"
// @Param tag_ids query string false "Comma-separated tag IDs for filtering"
// @Param tag_filter_mode query string false "Tag filter mode: 'or' or 'and' (default: or)"
// @Param provider_id query int false "Filter by mail provider ID"
// @Param is_verified query string false "Filter by verification status: 'true' or 'false'"
// @Param error_status query string false "Filter by error status"
// @Param created_after query string false "Filter by creation time start (RFC3339)"
// @Param created_before query string false "Filter by creation time end (RFC3339)"
// @Param last_sync_after query string false "Filter by last sync time start (RFC3339)"
// @Param last_sync_before query string false "Filter by last sync time end (RFC3339)"
// @Success 200 {object} PaginatedAccountsResponse
// @Router /api/accounts/paginated [get]
func (h *APIHandler) GetAccountsPaginatedHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	// 解析基本分页参数
	page := 1
	limit := 10
	sortBy := "created_at"
	sortOrder := "desc"

	if p := r.URL.Query().Get("page"); p != "" {
		if val, err := strconv.Atoi(p); err == nil && val > 0 {
			page = val
		}
	}

	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 100 {
			limit = val
		}
	}

	if s := r.URL.Query().Get("sort_by"); s != "" {
		sortBy = s
	}

	if o := r.URL.Query().Get("sort_order"); o == "asc" || o == "desc" {
		sortOrder = o
	}

	// 构建过滤参数
	var filters repository.AccountFilterParams

	// 搜索参数
	filters.Search = r.URL.Query().Get("search")

	// 标签过滤
	if tagIDsStr := r.URL.Query().Get("tag_ids"); tagIDsStr != "" {
		tagParts := strings.Split(tagIDsStr, ",")
		for _, part := range tagParts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if id, err := strconv.ParseUint(part, 10, 32); err == nil {
				filters.TagIDs = append(filters.TagIDs, uint(id))
			}
		}
	}
	filters.TagFilterMode = r.URL.Query().Get("tag_filter_mode")

	// 供应商过滤
	if pidStr := r.URL.Query().Get("provider_id"); pidStr != "" {
		if pid, err := strconv.ParseUint(pidStr, 10, 32); err == nil {
			providerID := uint(pid)
			filters.ProviderID = &providerID
		}
	}

	// 验证状态过滤
	if ivStr := r.URL.Query().Get("is_verified"); ivStr != "" {
		if ivStr == "true" {
			verified := true
			filters.IsVerified = &verified
		} else if ivStr == "false" {
			verified := false
			filters.IsVerified = &verified
		}
	}

	// 错误状态过滤
	filters.ErrorStatus = r.URL.Query().Get("error_status")

	// 时间范围过滤
	if ca := r.URL.Query().Get("created_after"); ca != "" {
		if t, err := time.Parse(time.RFC3339, ca); err == nil {
			filters.CreatedAfter = &t
		}
	}
	if cb := r.URL.Query().Get("created_before"); cb != "" {
		if t, err := time.Parse(time.RFC3339, cb); err == nil {
			filters.CreatedBefore = &t
		}
	}
	if lsa := r.URL.Query().Get("last_sync_after"); lsa != "" {
		if t, err := time.Parse(time.RFC3339, lsa); err == nil {
			filters.LastSyncAfter = &t
		}
	}
	if lsb := r.URL.Query().Get("last_sync_before"); lsb != "" {
		if t, err := time.Parse(time.RFC3339, lsb); err == nil {
			filters.LastSyncBefore = &t
		}
	}

	h.logger.Debug("分页查询参数: search='%s', tag_ids=%v, provider_id=%v, is_verified=%v, error_status='%s'",
		filters.Search, filters.TagIDs, filters.ProviderID, filters.IsVerified, filters.ErrorStatus)

	// 使用支持完整过滤的分页查询
	accounts, total, err := h.EmailAccountRepo.GetAllPaginatedFiltered(orgID, page, limit, sortBy, sortOrder, filters)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 计算总页数
	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	// 构建响应
	response := PaginatedAccountsResponse{
		Data:       accounts,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// BatchVerifyAccountsRequest represents the request for batch account verification
type BatchVerifyAccountsRequest struct {
	AccountIDs []uint `json:"account_ids"`
}

// BatchVerifyAccountsResponse represents the response for batch account verification
type BatchVerifyAccountsResponse struct {
	SuccessCount int                        `json:"success_count"`
	ErrorCount   int                        `json:"error_count"`
	Results      []BatchVerifyAccountResult `json:"results"`
}

// BatchVerifyAccountResult represents the result for a single account verification
type BatchVerifyAccountResult struct {
	AccountID    uint   `json:"account_id"`
	EmailAddress string `json:"email_address"`
	Success      bool   `json:"success"`
	Message      string `json:"message,omitempty"`
	Error        string `json:"error,omitempty"`
}

// BatchVerifyAccountsHandler handles batch account verification
// @Summary Batch verify account connectivity
// @Description Verify connectivity for multiple email accounts in batch
// @Tags accounts
// @Accept json
// @Produce json
// @Param request body BatchVerifyAccountsRequest true "Batch account verification request"
// @Success 200 {object} BatchVerifyAccountsResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/batch-verify [post]
func (h *APIHandler) BatchVerifyAccountsHandler(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	var req BatchVerifyAccountsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.AccountIDs) == 0 {
		http.Error(w, "At least one account ID is required", http.StatusBadRequest)
		return
	}

	// Limit batch size to prevent timeout
	const maxBatchSize = 20
	if len(req.AccountIDs) > maxBatchSize {
		http.Error(w, fmt.Sprintf("Batch size cannot exceed %d accounts", maxBatchSize), http.StatusBadRequest)
		return
	}

	h.logger.Debug("Starting batch verification for %d accounts", len(req.AccountIDs))

	var response BatchVerifyAccountsResponse
	var results []BatchVerifyAccountResult

	// Process each account
	for _, accountID := range req.AccountIDs {
		result := h.verifyAccountByID(accountID)
		results = append(results, result)

		if result.Success {
			response.SuccessCount++
		} else {
			response.ErrorCount++
		}

		h.logger.Debug("Verified account %d (%s): success=%t",
			accountID, result.EmailAddress, result.Success)
	}

	response.Results = results

	h.logger.Debug("Batch verification completed: %d success, %d errors in %v",
		response.SuccessCount, response.ErrorCount, time.Since(start))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// verifyAccountByID verifies a single account by ID and updates verification status
func (h *APIHandler) verifyAccountByID(accountID uint) BatchVerifyAccountResult {
	// Get account from database
	account, err := h.EmailAccountRepo.GetByID(accountID)
	if err != nil {
		return BatchVerifyAccountResult{
			AccountID:    accountID,
			EmailAddress: fmt.Sprintf("account_%d", accountID),
			Success:      false,
			Error:        "Account not found: " + err.Error(),
		}
	}

	// Verify connection
	err = h.Fetcher.VerifyConnection(account)

	result := BatchVerifyAccountResult{
		AccountID:    accountID,
		EmailAddress: account.EmailAddress,
		Success:      err == nil,
	}

	if err != nil {
		result.Message = "Connection verification failed"
		result.Error = err.Error()
		h.logger.Error("Verification failed for account %d (%s): %v",
			accountID, account.EmailAddress, err)
	} else {
		// Update account verification status in database
		account.IsVerified = true
		account.VerifiedAt = timePtr(time.Now())

		if updateErr := h.EmailAccountRepo.Update(account); updateErr != nil {
			h.logger.Error("Failed to update verification status for account %d: %v",
				accountID, updateErr)
			result.Message = "Connection verified but failed to update database"
			result.Error = updateErr.Error()
		} else {
			result.Message = "Connection verified successfully"
			h.logger.Debug("Successfully verified and updated account %d (%s)",
				accountID, account.EmailAddress)
		}
	}

	return result
}

// timePtr returns a pointer to the given time
func timePtr(t time.Time) *time.Time {
	return &t
}

// syncEmailsForToQuery 根据to_query参数同步对应账户的邮件
func (h *APIHandler) syncEmailsForToQuery(toQuery string) error {
	// 使用EmailAccountRepository的GetByEmailOrAlias方法，它已经处理了别名和域名邮箱
	account, err := h.EmailAccountRepo.GetByEmailOrAlias(toQuery)
	if err != nil {
		return fmt.Errorf("failed to find account for email %s: %w", toQuery, err)
	}
	if account == nil {
		return fmt.Errorf("no account found for email %s", toQuery)
	}

	// 使用EmailScheduler触发立即同步，类似FetchNowHandler的实现
	if h.EmailScheduler != nil {
		// 获取该账户的所有订阅
		subscriptions := h.EmailScheduler.GetAccountSubscriptions(account.ID)
		if len(subscriptions) == 0 {
			// 如果没有订阅，记录日志但不报错，因为可能数据库中已有邮件
			return nil
		}

		// 对每个订阅触发立即同步
		var errors []string
		for _, sub := range subscriptions {
			_, err := h.EmailScheduler.FetchNow(sub.ID, false) // 不强制刷新
			if err != nil {
				errors = append(errors, fmt.Sprintf("Subscription %s: %v", sub.ID, err))
			}
		}

		// 如果有错误，返回合并的错误信息
		if len(errors) > 0 {
			return fmt.Errorf("sync errors for account %d: %s", account.ID, strings.Join(errors, "; "))
		}
	}

	return nil
}

// VerifyAccountRequest represents the request for verifying account connectivity
type VerifyAccountRequest struct {
	AccountID            *uint                     `json:"account_id,omitempty"`
	EmailAddress         string                    `json:"email_address,omitempty"`
	Password             string                    `json:"password,omitempty"`
	AuthType             string                    `json:"auth_type,omitempty"`
	MailProviderID       uint                      `json:"mail_provider_id,omitempty"`
	CustomSettings       map[string]string         `json:"custom_settings,omitempty"`
	Proxy                string                    `json:"proxy,omitempty"`
	ProxyMode            models.ProxyAccountMode   `json:"proxyMode,omitempty"`
	ProxyID              *uint                     `json:"proxyId,omitempty"`
	ProxyFallbackMode    models.ProxyFallbackMode  `json:"proxyFallbackMode,omitempty"`
	ProxyFallbackProxyID *uint                     `json:"proxyFallbackProxyId,omitempty"`
	ProxyFallbackProxy   string                    `json:"proxyFallbackProxy,omitempty"`
	ProxyMatchGroupIDs   models.UintSlice          `json:"proxyMatchGroupIds,omitempty"`
	ProxyMatchTagIDs     models.UintSlice          `json:"proxyMatchTagIds,omitempty"`
	ProxyMatchTagMode    models.ProxyTagFilterMode `json:"proxyMatchTagMode,omitempty"`
}

// VerifyAccountResponse represents the response for account verification
type VerifyAccountResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
}

// VerifyAccountHandler handles account connectivity verification
// @Summary Verify account connectivity
// @Description Verify if an email account can connect successfully using IMAP or OAuth2
// @Tags accounts
// @Accept json
// @Produce json
// @Param request body VerifyAccountRequest true "Account verification request"
// @Success 200 {object} VerifyAccountResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/verify [post]
func (h *APIHandler) VerifyAccountHandler(w http.ResponseWriter, r *http.Request) {
	var req VerifyAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var account models.EmailAccount
	var existingAccount *models.EmailAccount
	var err error

	// If account ID is provided, fetch the account from database
	if req.AccountID != nil {
		existingAccount, err = h.EmailAccountRepo.GetByID(*req.AccountID)
		if err != nil {
			response := VerifyAccountResponse{
				Success: false,
				Message: "Failed to fetch account",
				Error:   err.Error(),
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(response)
			return
		}
		account = *existingAccount

		// Debug: Log the loaded CustomSettings
		h.logger.Debug("Loaded account CustomSettings: %+v", account.CustomSettings)
		if len(account.CustomSettings) == 0 {
			h.logger.Debug("CustomSettings is empty for account %d", account.ID)
		}
	} else {
		// Create a temporary account object from the provided details
		if req.EmailAddress == "" || req.MailProviderID == 0 {
			response := VerifyAccountResponse{
				Success: false,
				Message: "Email address and mail provider ID are required",
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(response)
			return
		}

		// Get mail provider
		provider, err := h.MailProviderRepo.GetByID(req.MailProviderID)
		if err != nil {
			response := VerifyAccountResponse{
				Success: false,
				Message: "Invalid mail provider",
				Error:   err.Error(),
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(response)
			return
		}

		var mailProviderID *uint
		if req.MailProviderID != 0 {
			mailProviderID = &req.MailProviderID
		}

		account = models.EmailAccount{
			OrgID:                GetCurrentOrgID(r),
			EmailAddress:         req.EmailAddress,
			Password:             req.Password,
			AuthType:             models.AuthType(req.AuthType),
			MailProviderID:       mailProviderID,
			MailProvider:         provider,
			CustomSettings:       models.JSONMap(req.CustomSettings),
			Proxy:                req.Proxy,
			ProxyMode:            models.NormalizeProxyAccountMode(req.ProxyMode),
			ProxyID:              req.ProxyID,
			ProxyFallbackMode:    models.NormalizeProxyFallbackMode(req.ProxyFallbackMode),
			ProxyFallbackProxyID: req.ProxyFallbackProxyID,
			ProxyFallbackProxy:   req.ProxyFallbackProxy,
			ProxyMatchGroupIDs:   req.ProxyMatchGroupIDs,
			ProxyMatchTagIDs:     req.ProxyMatchTagIDs,
			ProxyMatchTagMode:    models.NormalizeProxyTagFilterMode(req.ProxyMatchTagMode),
		}

		// Set default auth type if not provided
		if account.AuthType == "" {
			account.AuthType = models.AuthTypePassword
		}
	}

	// Verify the connection
	err = h.Fetcher.VerifyConnection(&account)

	response := VerifyAccountResponse{
		Success: err == nil,
	}

	if err != nil {
		response.Message = "Connection verification failed"
		response.Error = err.Error()
	} else {
		response.Message = "Connection verified successfully"

		// If account ID is provided and verification successful, update the account's verification status
		if req.AccountID != nil && err == nil {
			now := time.Now()
			existingAccount.IsVerified = true
			existingAccount.VerifiedAt = &now

			if updateErr := h.EmailAccountRepo.Update(existingAccount); updateErr != nil {
				h.logger.Error("Failed to update account verification status: %v", updateErr)
				// Don't fail the response, just log the error
			} else {
				// Log activity for successful verification
				userID := getUserIDFromContext(r)
				h.activityLogger.LogAccountActivity(models.ActivityAccountVerified, existingAccount, userID)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetAccountHandler retrieves a specific email account
// @Summary Get an email account by ID
// @Description Get an email account by ID
// @Tags accounts
// @Accept json
// @Produce json
// @Param id path int true "Account ID"
// @Success 200 {object} models.EmailAccount
// @Router /api/accounts/{id} [get]
func (h *APIHandler) GetAccountHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	account, err := h.EmailAccountRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// 验证账户归属当前组织
	if orgID > 0 && account.OrgID != orgID {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(account)
}

func (req AccountForwardedAddressesRequest) values() models.StringSlice {
	if len(req.ForwardedAddresses) > 0 {
		return req.ForwardedAddresses
	}
	if len(req.ForwardedAddressesSnake) > 0 {
		return req.ForwardedAddressesSnake
	}
	return req.Addresses
}

func (req AccountForwardedAddressRequest) value() string {
	if strings.TrimSpace(req.Address) != "" {
		return req.Address
	}
	if strings.TrimSpace(req.ForwardedAddress) != "" {
		return req.ForwardedAddress
	}
	return req.ForwardedAddressSnake
}

func accountForwardedAddressesResponse(account *models.EmailAccount, changed bool) AccountForwardedAddressesResponse {
	addresses := models.NormalizeEmailRoutingAddresses(account.ForwardedAddresses)
	return AccountForwardedAddressesResponse{
		AccountID:          account.ID,
		EmailAddress:       account.EmailAddress,
		ForwardedAddresses: addresses,
		Count:              len(addresses),
		Changed:            changed,
	}
}

func (h *APIHandler) resolveAccountConfigTarget(w http.ResponseWriter, r *http.Request) (*models.EmailAccount, bool) {
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)

	if rawID := strings.TrimSpace(vars["id"]); rawID != "" {
		id, err := strconv.ParseUint(rawID, 10, 32)
		if err != nil {
			http.Error(w, "Invalid account ID", http.StatusBadRequest)
			return nil, false
		}

		account, err := h.EmailAccountRepo.GetByID(uint(id))
		if err != nil {
			http.Error(w, "Account not found", http.StatusNotFound)
			return nil, false
		}
		if orgID > 0 && account.OrgID != orgID {
			http.Error(w, "Access denied", http.StatusForbidden)
			return nil, false
		}
		return account, true
	}

	email := strings.TrimSpace(vars["email"])
	if email == "" {
		query := r.URL.Query()
		email = strings.TrimSpace(query.Get("email"))
		if email == "" {
			email = strings.TrimSpace(query.Get("emailAddress"))
		}
		if email == "" {
			email = strings.TrimSpace(query.Get("email_address"))
		}
	}
	if email == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
		return nil, false
	}

	account, err := h.EmailAccountRepo.GetByEmail(email)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return nil, false
	}
	if orgID > 0 && account.OrgID != orgID {
		http.Error(w, "Access denied", http.StatusForbidden)
		return nil, false
	}

	return account, true
}

func (h *APIHandler) resolveForwardedAddressAccount(w http.ResponseWriter, r *http.Request) (*models.EmailAccount, bool) {
	return h.resolveAccountConfigTarget(w, r)
}

// ListAccountForwardedAddressesHandler lists forwarded recipient addresses for an account.
// @Summary List account forwarded recipient addresses
// @Description List forwarded recipient addresses by account ID, or by email through /api/accounts/forwarded-addresses?email=user@example.com.
// @Tags accounts
// @Produce json
// @Param id path int false "Account ID"
// @Param email query string false "Account email address"
// @Success 200 {object} AccountForwardedAddressesResponse
// @Router /api/accounts/{id}/forwarded-addresses [get]
// @Router /api/accounts/forwarded-addresses [get]
func (h *APIHandler) ListAccountForwardedAddressesHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveForwardedAddressAccount(w, r)
	if !ok {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountForwardedAddressesResponse(account, false))
}

// SetAccountForwardedAddressesHandler replaces forwarded recipient addresses for an account.
// @Summary Replace account forwarded recipient addresses
// @Description Replace the full forwarded recipient address list by account ID or by email.
// @Tags accounts
// @Accept json
// @Produce json
// @Param request body AccountForwardedAddressesRequest true "Forwarded recipient addresses"
// @Success 200 {object} AccountForwardedAddressesResponse
// @Router /api/accounts/{id}/forwarded-addresses [put]
// @Router /api/accounts/forwarded-addresses [put]
func (h *APIHandler) SetAccountForwardedAddressesHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveForwardedAddressAccount(w, r)
	if !ok {
		return
	}

	var req AccountForwardedAddressesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	previous := strings.Join(models.NormalizeEmailRoutingAddresses(account.ForwardedAddresses), "\n")
	account.ForwardedAddresses = models.NormalizeEmailRoutingAddresses(req.values())
	changed := previous != strings.Join(account.ForwardedAddresses, "\n")

	if err := h.EmailAccountRepo.Update(account); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	userID := getUserIDFromContext(r)
	h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, account, userID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountForwardedAddressesResponse(account, changed))
}

// AddAccountForwardedAddressHandler appends one forwarded recipient address for an account.
// @Summary Append one account forwarded recipient address
// @Description Append one forwarded recipient address by account ID or by email. Existing values are kept and duplicates are ignored.
// @Tags accounts
// @Accept json
// @Produce json
// @Param request body AccountForwardedAddressRequest true "Forwarded recipient address"
// @Success 200 {object} AccountForwardedAddressesResponse
// @Router /api/accounts/{id}/forwarded-addresses [post]
// @Router /api/accounts/forwarded-addresses [post]
func (h *APIHandler) AddAccountForwardedAddressHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveForwardedAddressAccount(w, r)
	if !ok {
		return
	}

	var req AccountForwardedAddressRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	address := req.value()
	if address == "" {
		address = r.URL.Query().Get("address")
	}
	normalized := models.NormalizeEmailRoutingAddress(address)
	if normalized == "" {
		http.Error(w, "address is required", http.StatusBadRequest)
		return
	}

	addresses := models.NormalizeEmailRoutingAddresses(account.ForwardedAddresses)
	changed := true
	for _, existing := range addresses {
		if existing == normalized {
			changed = false
			break
		}
	}
	if changed {
		addresses = append(addresses, normalized)
		account.ForwardedAddresses = addresses
		if err := h.EmailAccountRepo.Update(account); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		userID := getUserIDFromContext(r)
		h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, account, userID)
	} else {
		account.ForwardedAddresses = addresses
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountForwardedAddressesResponse(account, changed))
}

// RemoveAccountForwardedAddressHandler removes one forwarded recipient address for an account.
// @Summary Remove one account forwarded recipient address
// @Description Remove one forwarded recipient address by account ID or by email. Missing values are treated as no-op.
// @Tags accounts
// @Accept json
// @Produce json
// @Param request body AccountForwardedAddressRequest false "Forwarded recipient address"
// @Param address query string false "Forwarded recipient address"
// @Success 200 {object} AccountForwardedAddressesResponse
// @Router /api/accounts/{id}/forwarded-addresses [delete]
// @Router /api/accounts/forwarded-addresses [delete]
func (h *APIHandler) RemoveAccountForwardedAddressHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveForwardedAddressAccount(w, r)
	if !ok {
		return
	}

	var req AccountForwardedAddressRequest
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	address := req.value()
	if address == "" {
		address = r.URL.Query().Get("address")
	}
	normalized := models.NormalizeEmailRoutingAddress(address)
	if normalized == "" {
		http.Error(w, "address is required", http.StatusBadRequest)
		return
	}

	addresses := models.NormalizeEmailRoutingAddresses(account.ForwardedAddresses)
	next := make(models.StringSlice, 0, len(addresses))
	changed := false
	for _, existing := range addresses {
		if existing == normalized {
			changed = true
			continue
		}
		next = append(next, existing)
	}

	if changed {
		account.ForwardedAddresses = next
		if err := h.EmailAccountRepo.Update(account); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		userID := getUserIDFromContext(r)
		h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, account, userID)
	} else {
		account.ForwardedAddresses = addresses
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountForwardedAddressesResponse(account, changed))
}

func normalizeAccountDomain(domain string) string {
	domain = strings.ToLower(strings.TrimSpace(domain))
	domain = strings.TrimPrefix(domain, "@")
	domain = strings.TrimPrefix(domain, "*.")
	return domain
}

func (req AccountDomainConfigRequest) enabled(current bool) bool {
	if req.Enabled != nil {
		return *req.Enabled
	}
	if req.IsDomainMail != nil {
		return *req.IsDomainMail
	}
	if req.IsDomainMailSnake != nil {
		return *req.IsDomainMailSnake
	}
	if strings.TrimSpace(req.Domain) != "" {
		return true
	}
	return current
}

func accountDomainConfigResponse(account *models.EmailAccount, changed bool) AccountDomainConfigResponse {
	return AccountDomainConfigResponse{
		AccountID:    account.ID,
		EmailAddress: account.EmailAddress,
		IsDomainMail: account.IsDomainMail,
		Domain:       account.Domain,
		Changed:      changed,
	}
}

// GetAccountDomainConfigHandler returns domain mail config for an account.
// @Summary Get account domain mail config
// @Description Get domain mail config by account ID or by email through /api/accounts/domain-config?email=user@example.com.
// @Tags accounts
// @Produce json
// @Param id path int false "Account ID"
// @Param email query string false "Account email address"
// @Success 200 {object} AccountDomainConfigResponse
// @Router /api/accounts/{id}/domain-config [get]
// @Router /api/accounts/domain-config [get]
func (h *APIHandler) GetAccountDomainConfigHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveAccountConfigTarget(w, r)
	if !ok {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountDomainConfigResponse(account, false))
}

// SetAccountDomainConfigHandler replaces domain mail config for an account.
// @Summary Replace account domain mail config
// @Description Enable, update, or disable the domain mail config by account ID or by email.
// @Tags accounts
// @Accept json
// @Produce json
// @Param request body AccountDomainConfigRequest true "Domain mail config"
// @Success 200 {object} AccountDomainConfigResponse
// @Router /api/accounts/{id}/domain-config [put]
// @Router /api/accounts/domain-config [put]
func (h *APIHandler) SetAccountDomainConfigHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveAccountConfigTarget(w, r)
	if !ok {
		return
	}

	var req AccountDomainConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	enabled := req.enabled(account.IsDomainMail)
	domain := normalizeAccountDomain(account.Domain)
	if strings.TrimSpace(req.Domain) != "" || !enabled {
		domain = normalizeAccountDomain(req.Domain)
	}

	if enabled && domain == "" {
		http.Error(w, "domain is required when domain mail is enabled", http.StatusBadRequest)
		return
	}

	previousEnabled := account.IsDomainMail
	previousDomain := normalizeAccountDomain(account.Domain)
	account.IsDomainMail = enabled
	if enabled {
		account.Domain = domain
	} else {
		account.Domain = ""
	}
	changed := previousEnabled != account.IsDomainMail || previousDomain != account.Domain

	if changed {
		if err := h.EmailAccountRepo.Update(account); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		userID := getUserIDFromContext(r)
		h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, account, userID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountDomainConfigResponse(account, changed))
}

// DeleteAccountDomainConfigHandler disables domain mail config for an account.
// @Summary Disable account domain mail config
// @Description Disable and clear domain mail config by account ID or by email.
// @Tags accounts
// @Produce json
// @Success 200 {object} AccountDomainConfigResponse
// @Router /api/accounts/{id}/domain-config [delete]
// @Router /api/accounts/domain-config [delete]
func (h *APIHandler) DeleteAccountDomainConfigHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveAccountConfigTarget(w, r)
	if !ok {
		return
	}

	changed := account.IsDomainMail || strings.TrimSpace(account.Domain) != ""
	if changed {
		account.IsDomainMail = false
		account.Domain = ""
		if err := h.EmailAccountRepo.Update(account); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		userID := getUserIDFromContext(r)
		h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, account, userID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountDomainConfigResponse(account, changed))
}

func accountProxyConfigEnabled(account *models.EmailAccount) bool {
	return strings.TrimSpace(account.Proxy) != "" ||
		account.ProxyID != nil ||
		account.ProxyMode == models.ProxyAccountModeSelected ||
		account.ProxyMode == models.ProxyAccountModeAuto ||
		len(account.ProxyMatchGroupIDs) > 0 ||
		len(account.ProxyMatchTagIDs) > 0
}

func accountProxyConfigResponse(account *models.EmailAccount, changed bool) AccountProxyConfigResponse {
	return AccountProxyConfigResponse{
		AccountID:            account.ID,
		EmailAddress:         account.EmailAddress,
		Enabled:              accountProxyConfigEnabled(account),
		Proxy:                account.Proxy,
		ProxyMode:            models.NormalizeProxyAccountMode(account.ProxyMode),
		ProxyID:              account.ProxyID,
		ProxyFallbackMode:    models.NormalizeProxyFallbackMode(account.ProxyFallbackMode),
		ProxyFallbackProxyID: account.ProxyFallbackProxyID,
		ProxyFallbackProxy:   account.ProxyFallbackProxy,
		ProxyMatchGroupIDs:   account.ProxyMatchGroupIDs,
		ProxyMatchTagIDs:     account.ProxyMatchTagIDs,
		ProxyMatchTagMode:    models.NormalizeProxyTagFilterMode(account.ProxyMatchTagMode),
		Changed:              changed,
	}
}

func clearAccountProxyConfig(account *models.EmailAccount) {
	account.Proxy = ""
	account.ProxyMode = models.ProxyAccountModeManual
	account.ProxyID = nil
	account.ProxyFallbackMode = models.ProxyFallbackInterrupt
	account.ProxyFallbackProxyID = nil
	account.ProxyFallbackProxy = ""
	account.ProxyMatchGroupIDs = models.UintSlice{}
	account.ProxyMatchTagIDs = models.UintSlice{}
	account.ProxyMatchTagMode = models.ProxyTagFilterOR
}

func uintPtrFingerprint(ptr *uint) string {
	if ptr == nil {
		return ""
	}
	return strconv.FormatUint(uint64(*ptr), 10)
}

func uintSliceFingerprint(values models.UintSlice) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.FormatUint(uint64(value), 10))
	}
	return strings.Join(parts, ",")
}

func accountProxyFingerprint(account *models.EmailAccount) string {
	return strings.Join([]string{
		strconv.FormatBool(accountProxyConfigEnabled(account)),
		account.Proxy,
		string(models.NormalizeProxyAccountMode(account.ProxyMode)),
		uintPtrFingerprint(account.ProxyID),
		string(models.NormalizeProxyFallbackMode(account.ProxyFallbackMode)),
		uintPtrFingerprint(account.ProxyFallbackProxyID),
		account.ProxyFallbackProxy,
		uintSliceFingerprint(account.ProxyMatchGroupIDs),
		uintSliceFingerprint(account.ProxyMatchTagIDs),
		string(models.NormalizeProxyTagFilterMode(account.ProxyMatchTagMode)),
	}, "|")
}

func (req AccountProxyConfigRequest) enabled(current bool) bool {
	if req.Enabled != nil {
		return *req.Enabled
	}
	if req.UseProxy != nil {
		return *req.UseProxy
	}
	return current ||
		strings.TrimSpace(req.Proxy) != "" ||
		req.ProxyID != nil ||
		req.ProxyMode != "" ||
		len(req.ProxyMatchGroupIDs) > 0 ||
		len(req.ProxyMatchTagIDs) > 0
}

// GetAccountProxyConfigHandler returns proxy config for an account.
// @Summary Get account proxy config
// @Description Get proxy config by account ID or by email through /api/accounts/proxy-config?email=user@example.com.
// @Tags accounts
// @Produce json
// @Param id path int false "Account ID"
// @Param email query string false "Account email address"
// @Success 200 {object} AccountProxyConfigResponse
// @Router /api/accounts/{id}/proxy-config [get]
// @Router /api/accounts/proxy-config [get]
func (h *APIHandler) GetAccountProxyConfigHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveAccountConfigTarget(w, r)
	if !ok {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountProxyConfigResponse(account, false))
}

// SetAccountProxyConfigHandler replaces proxy config for an account.
// @Summary Replace account proxy config
// @Description Enable, update, or disable proxy config by account ID or by email.
// @Tags accounts
// @Accept json
// @Produce json
// @Param request body AccountProxyConfigRequest true "Proxy config"
// @Success 200 {object} AccountProxyConfigResponse
// @Router /api/accounts/{id}/proxy-config [put]
// @Router /api/accounts/proxy-config [put]
func (h *APIHandler) SetAccountProxyConfigHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveAccountConfigTarget(w, r)
	if !ok {
		return
	}

	var req AccountProxyConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err != io.EOF {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	previous := accountProxyFingerprint(account)
	if !req.enabled(accountProxyConfigEnabled(account)) {
		clearAccountProxyConfig(account)
	} else {
		account.Proxy = strings.TrimSpace(req.Proxy)
		account.ProxyMode = models.NormalizeProxyAccountMode(req.ProxyMode)
		account.ProxyID = req.ProxyID
		account.ProxyFallbackMode = models.NormalizeProxyFallbackMode(req.ProxyFallbackMode)
		account.ProxyFallbackProxyID = req.ProxyFallbackProxyID
		account.ProxyFallbackProxy = strings.TrimSpace(req.ProxyFallbackProxy)
		account.ProxyMatchGroupIDs = req.ProxyMatchGroupIDs
		account.ProxyMatchTagIDs = req.ProxyMatchTagIDs
		account.ProxyMatchTagMode = models.NormalizeProxyTagFilterMode(req.ProxyMatchTagMode)

		if h.ProxyPoolService != nil {
			if err := h.ProxyPoolService.PrepareAccountProxy(account); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
		}
	}

	changed := previous != accountProxyFingerprint(account)
	if changed {
		if err := h.EmailAccountRepo.Update(account); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		userID := getUserIDFromContext(r)
		h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, account, userID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountProxyConfigResponse(account, changed))
}

// DeleteAccountProxyConfigHandler disables proxy config for an account.
// @Summary Disable account proxy config
// @Description Disable and clear proxy config by account ID or by email.
// @Tags accounts
// @Produce json
// @Success 200 {object} AccountProxyConfigResponse
// @Router /api/accounts/{id}/proxy-config [delete]
// @Router /api/accounts/proxy-config [delete]
func (h *APIHandler) DeleteAccountProxyConfigHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.resolveAccountConfigTarget(w, r)
	if !ok {
		return
	}

	previous := accountProxyFingerprint(account)
	clearAccountProxyConfig(account)
	changed := previous != accountProxyFingerprint(account)
	if changed {
		if err := h.EmailAccountRepo.Update(account); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		userID := getUserIDFromContext(r)
		h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, account, userID)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(accountProxyConfigResponse(account, changed))
}

// UpdateAccountHandler updates an email account
// @Summary Update an email account
// @Description Update an email account (supports partial updates)
// @Tags accounts
// @Accept json
// @Produce json
// @Param id path int true "Account ID"
// @Param account body UpdateAccountRequest true "Email Account Update"
// @Success 200 {object} models.EmailAccount
// @Router /api/accounts/{id} [put]
func (h *APIHandler) UpdateAccountHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	// Get existing account
	existingAccount, err := h.EmailAccountRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// 验证账户归属当前组织
	if orgID > 0 && existingAccount.OrgID != orgID {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var request UpdateAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Apply partial updates only for provided fields
	if request.EmailAddress != nil {
		existingAccount.EmailAddress = *request.EmailAddress
	}
	if request.AuthType != nil {
		existingAccount.AuthType = *request.AuthType
	}
	if request.Password != nil {
		encrypted := services.EncryptIfAvailable(*request.Password)
		existingAccount.Password = encrypted
	}
	if request.Token != nil {
		encrypted := services.EncryptIfAvailable(*request.Token)
		existingAccount.Token = encrypted
	}
	if request.MailProviderID != nil {
		existingAccount.MailProviderID = request.MailProviderID
	}
	if request.Proxy != nil {
		existingAccount.Proxy = *request.Proxy
	}
	proxyConfigChanged := false
	if request.ProxyMode != nil {
		existingAccount.ProxyMode = models.NormalizeProxyAccountMode(*request.ProxyMode)
		proxyConfigChanged = true
	}
	if request.ProxyID != nil {
		existingAccount.ProxyID = request.ProxyID
		proxyConfigChanged = true
	}
	if request.ProxyFallbackMode != nil {
		existingAccount.ProxyFallbackMode = models.NormalizeProxyFallbackMode(*request.ProxyFallbackMode)
		proxyConfigChanged = true
	}
	if request.ProxyFallbackProxyID != nil {
		existingAccount.ProxyFallbackProxyID = request.ProxyFallbackProxyID
		proxyConfigChanged = true
	}
	if request.ProxyFallbackProxy != nil {
		existingAccount.ProxyFallbackProxy = *request.ProxyFallbackProxy
		proxyConfigChanged = true
	}
	if request.ProxyMatchGroupIDs != nil {
		existingAccount.ProxyMatchGroupIDs = *request.ProxyMatchGroupIDs
		proxyConfigChanged = true
	}
	if request.ProxyMatchTagIDs != nil {
		existingAccount.ProxyMatchTagIDs = *request.ProxyMatchTagIDs
		proxyConfigChanged = true
	}
	if request.ProxyMatchTagMode != nil {
		existingAccount.ProxyMatchTagMode = models.NormalizeProxyTagFilterMode(*request.ProxyMatchTagMode)
		proxyConfigChanged = true
	}
	if request.IsDomainMail != nil {
		existingAccount.IsDomainMail = *request.IsDomainMail
	}
	if request.Domain != nil {
		existingAccount.Domain = *request.Domain
	}
	if request.ForwardedAddresses != nil {
		existingAccount.ForwardedAddresses = models.NormalizeEmailRoutingAddresses(*request.ForwardedAddresses)
	}
	if request.Note != nil {
		existingAccount.Note = *request.Note
	}
	if request.NoteFormat != nil {
		existingAccount.NoteFormat = models.NormalizeAccountNoteFormat(*request.NoteFormat)
	}
	if request.CustomSettings != nil {
		existingAccount.CustomSettings = *request.CustomSettings
	}
	if request.LastSyncAt != nil {
		existingAccount.LastSyncAt = request.LastSyncAt
	}

	if proxyConfigChanged && h.ProxyPoolService != nil {
		if err := h.ProxyPoolService.PrepareAccountProxy(existingAccount); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	if err := h.EmailAccountRepo.Update(existingAccount); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Log activity
	userID := getUserIDFromContext(r)
	h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, existingAccount, userID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(existingAccount)
}

// UpsertAccountHandler creates or updates an email account (Outlook Token flow)
// @Summary Create or update an email account
// @Description Create a new email account or update existing one based on email address
// @Tags accounts
// @Accept json
// @Produce json
// @Param account body CreateAccountRequest true "Email Account"
// @Success 200 {object} models.EmailAccount
// @Success 201 {object} models.EmailAccount
// @Failure 400 {object} ErrorResponse
// @Router /api/accounts/upsert [post]
func (h *APIHandler) UpsertAccountHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	var request CreateAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// First, try to find existing account by email address
	existingAccount, err := h.EmailAccountRepo.GetByEmail(request.EmailAddress)

	var account *models.EmailAccount
	var activityType models.ActivityType

	if err != nil {
		// Account doesn't exist, create new one
		activityType = models.ActivityAccountAdded

		account = &models.EmailAccount{
			EmailAddress:         request.EmailAddress,
			AuthType:             request.AuthType,
			Password:             services.EncryptIfAvailable(request.Password),
			Token:                services.EncryptIfAvailable(request.Token),
			MailProviderID:       request.MailProviderID,
			OAuth2ProviderID:     request.OAuth2ProviderID,
			Proxy:                request.Proxy,
			ProxyMode:            models.NormalizeProxyAccountMode(request.ProxyMode),
			ProxyID:              request.ProxyID,
			ProxyFallbackMode:    models.NormalizeProxyFallbackMode(request.ProxyFallbackMode),
			ProxyFallbackProxyID: request.ProxyFallbackProxyID,
			ProxyFallbackProxy:   request.ProxyFallbackProxy,
			ProxyMatchGroupIDs:   request.ProxyMatchGroupIDs,
			ProxyMatchTagIDs:     request.ProxyMatchTagIDs,
			ProxyMatchTagMode:    models.NormalizeProxyTagFilterMode(request.ProxyMatchTagMode),
			IsDomainMail:         request.IsDomainMail,
			Domain:               request.Domain,
			ForwardedAddresses:   models.NormalizeEmailRoutingAddresses(request.ForwardedAddresses),
			Note:                 request.Note,
			NoteFormat:           models.NormalizeAccountNoteFormat(request.NoteFormat),
			CustomSettings:       request.CustomSettings,
			OrgID:                orgID,
		}

		if h.ProxyPoolService != nil {
			if err := h.ProxyPoolService.PrepareAccountProxy(account); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
		}

		if err := h.EmailAccountRepo.Create(account); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
	} else {
		// Account exists, update it
		activityType = models.ActivityAccountUpdated
		account = existingAccount

		// Update fields if they are provided
		if request.AuthType != "" {
			account.AuthType = request.AuthType
		}
		if request.Password != "" {
			account.Password = services.EncryptIfAvailable(request.Password)
		}
		if request.Token != "" {
			account.Token = services.EncryptIfAvailable(request.Token)
		}
		if request.MailProviderID != nil {
			account.MailProviderID = request.MailProviderID
		}
		if request.OAuth2ProviderID != nil {
			account.OAuth2ProviderID = request.OAuth2ProviderID
		}
		if request.Proxy != "" {
			account.Proxy = request.Proxy
		}
		if request.ProxyMode != "" {
			account.ProxyMode = models.NormalizeProxyAccountMode(request.ProxyMode)
		}
		if request.ProxyID != nil {
			account.ProxyID = request.ProxyID
		}
		if request.ProxyFallbackMode != "" {
			account.ProxyFallbackMode = models.NormalizeProxyFallbackMode(request.ProxyFallbackMode)
		}
		if request.ProxyFallbackProxyID != nil {
			account.ProxyFallbackProxyID = request.ProxyFallbackProxyID
		}
		if request.ProxyFallbackProxy != "" {
			account.ProxyFallbackProxy = request.ProxyFallbackProxy
		}
		if len(request.ProxyMatchGroupIDs) > 0 {
			account.ProxyMatchGroupIDs = request.ProxyMatchGroupIDs
		}
		if len(request.ProxyMatchTagIDs) > 0 {
			account.ProxyMatchTagIDs = request.ProxyMatchTagIDs
		}
		if request.ProxyMatchTagMode != "" {
			account.ProxyMatchTagMode = models.NormalizeProxyTagFilterMode(request.ProxyMatchTagMode)
		}
		if request.CustomSettings != nil {
			account.CustomSettings = request.CustomSettings
		}
		if len(request.ForwardedAddresses) > 0 {
			account.ForwardedAddresses = models.NormalizeEmailRoutingAddresses(request.ForwardedAddresses)
		}
		if request.Note != "" {
			account.Note = request.Note
		}
		if request.NoteFormat != "" {
			account.NoteFormat = models.NormalizeAccountNoteFormat(request.NoteFormat)
		}

		if h.ProxyPoolService != nil {
			if err := h.ProxyPoolService.PrepareAccountProxy(account); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
		}

		if err := h.EmailAccountRepo.Update(account); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
	}

	// Log activity
	userID := getUserIDFromContext(r)
	h.activityLogger.LogAccountActivity(activityType, account, userID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(account)
}

// DeleteAccountHandler deletes an email account
// @Summary Delete an email account
// @Description Delete an email account
// @Tags accounts
// @Accept json
// @Produce json
// @Param id path int true "Account ID"
// @Success 204
// @Router /api/accounts/{id} [delete]
func (h *APIHandler) DeleteAccountHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	// Get account info before deletion for logging
	account, err := h.EmailAccountRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// 验证账户归属当前组织
	if orgID > 0 && account.OrgID != orgID {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	if err := h.EmailAccountRepo.Delete(uint(id)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Log activity
	userID := getUserIDFromContext(r)
	h.activityLogger.LogAccountActivity(models.ActivityAccountDeleted, account, userID)

	w.WriteHeader(http.StatusNoContent)
}

// GetProvidersHandler retrieves all mail providers
// @Summary Get all mail providers
// @Description Get all mail providers
// @Tags providers
// @Accept json
// @Produce json
// @Success 200 {array} models.MailProvider
// @Router /api/providers [get]
func (h *APIHandler) GetProvidersHandler(w http.ResponseWriter, r *http.Request) {
	_ = GetCurrentOrgID(r) // MailProvider is global, no org filtering needed

	providers, err := h.MailProviderRepo.GetAll()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(providers)
}
