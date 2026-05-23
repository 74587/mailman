package api

import (
	"encoding/json"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"mailman/internal/utils"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

// SyncHandlers holds handlers for sync configuration management
type SyncHandlers struct {
	syncConfigRepo        *repository.SyncConfigRepository
	emailAccountRepo      *repository.EmailAccountRepository
	perAccountSyncManager *services.PerAccountSyncManager
	fetcherService        *services.FetcherService
	logger                *utils.Logger
}

// NewSyncHandlers creates a new SyncHandlers
func NewSyncHandlers(
	syncConfigRepo *repository.SyncConfigRepository,
	emailAccountRepo *repository.EmailAccountRepository,
	perAccountSyncManager *services.PerAccountSyncManager,
	fetcherService *services.FetcherService,
) *SyncHandlers {
	return &SyncHandlers{
		syncConfigRepo:        syncConfigRepo,
		emailAccountRepo:      emailAccountRepo,
		perAccountSyncManager: perAccountSyncManager,
		fetcherService:        fetcherService,
		logger:                utils.NewLogger("SyncHandlers"),
	}
}

// GetAllSyncConfigs gets all sync configurations with pagination
func (h *SyncHandlers) GetAllSyncConfigs(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	// Parse query parameters
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page <= 0 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	search := r.URL.Query().Get("search")
	status := r.URL.Query().Get("status")
	enabled := r.URL.Query().Get("enabled")

	// Get paginated configs from repository
	totalCount, configs, err := h.syncConfigRepo.GetAllWithPagination(orgID, page, limit, search, status, enabled)
	if err != nil {
		h.logger.Error("Failed to get sync configs: %v", err)
		http.Error(w, "Failed to get sync configs", http.StatusInternalServerError)
		return
	}

	// Get sync stats
	stats, err := h.syncConfigRepo.GetSyncStats(orgID)
	if err != nil {
		h.logger.Error("Failed to get sync stats: %v", err)
		stats = map[string]interface{}{
			"total": 0, "active": 0, "syncing": 0, "errors": 0, "disabled": 0,
		}
	}

	// Calculate pagination
	totalPages := (totalCount + limit - 1) / limit
	hasNext := page < totalPages
	hasPrevious := page > 1

	// Transform configs to include account info in expected format
	type configResponse struct {
		ID              uint                 `json:"id"`
		AccountID       uint                 `json:"account_id"`
		EnableAutoSync  bool                 `json:"enable_auto_sync"`
		SyncInterval    int                  `json:"sync_interval"`
		SyncFolders     models.StringSlice   `json:"sync_folders"`
		LastSyncTime    *string              `json:"last_sync_time"`
		LastSyncError   string               `json:"last_sync_error"`
		SyncStatus      string               `json:"sync_status"`
		CreatedAt       string               `json:"created_at"`
		UpdatedAt       string               `json:"updated_at"`
		AutoDisabled    bool                 `json:"auto_disabled"`
		DisableReason   string               `json:"disable_reason"`
		ConsecutiveErrs int                  `json:"consecutive_errors"`
		Account         map[string]interface{} `json:"account"`
	}

	responseConfigs := make([]configResponse, 0, len(configs))
	for _, cfg := range configs {
		var lastSyncTime *string
		if cfg.LastSyncTime != nil {
			t := cfg.LastSyncTime.Format("2006-01-02T15:04:05Z07:00")
			lastSyncTime = &t
		}

		accountInfo := map[string]interface{}{
			"id":           cfg.Account.ID,
			"emailAddress": cfg.Account.EmailAddress,
			"authType":     string(cfg.Account.AuthType),
		}
		if cfg.Account.MailProviderID != nil {
			accountInfo["mailProviderId"] = *cfg.Account.MailProviderID
		}
		if cfg.Account.MailProvider != nil {
			accountInfo["mailProvider"] = map[string]interface{}{
				"id":         cfg.Account.MailProvider.ID,
				"name":       cfg.Account.MailProvider.Name,
				"type":       string(cfg.Account.MailProvider.Type),
				"imapServer": cfg.Account.MailProvider.IMAPServer,
				"imapPort":   cfg.Account.MailProvider.IMAPPort,
			}
		}

		responseConfigs = append(responseConfigs, configResponse{
			ID:              cfg.ID,
			AccountID:       cfg.AccountID,
			EnableAutoSync:  cfg.EnableAutoSync,
			SyncInterval:    cfg.SyncInterval,
			SyncFolders:     cfg.SyncFolders,
			LastSyncTime:    lastSyncTime,
			LastSyncError:   cfg.LastSyncError,
			SyncStatus:      cfg.SyncStatus,
			CreatedAt:       cfg.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt:       cfg.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
			AutoDisabled:    cfg.AutoDisabled,
			DisableReason:   cfg.DisableReason,
			ConsecutiveErrs: cfg.ConsecutiveErrors,
			Account:         accountInfo,
		})
	}

	response := map[string]interface{}{
		"configs":      responseConfigs,
		"total_count":  totalCount,
		"page":         page,
		"limit":        limit,
		"total_pages":  totalPages,
		"has_next":     hasNext,
		"has_previous": hasPrevious,
		"stats":        stats,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetAccountSyncConfig gets sync config for a specific account
func (h *SyncHandlers) GetAccountSyncConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	config, err := h.syncConfigRepo.GetByAccountIDWithAccount(uint(id))
	if err != nil {
		http.Error(w, "Sync config not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// CreateAccountSyncConfig creates sync config for an account
func (h *SyncHandlers) CreateAccountSyncConfig(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	var req struct {
		EnableAutoSync bool     `json:"enable_auto_sync"`
		SyncInterval   int      `json:"sync_interval"`
		SyncFolders    []string `json:"sync_folders"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.SyncInterval <= 0 {
		req.SyncInterval = 300 // default 5 minutes
	}
	if len(req.SyncFolders) == 0 {
		req.SyncFolders = []string{"INBOX"}
	}

	config := &models.EmailAccountSyncConfig{
		AccountID:      uint(id),
		EnableAutoSync: req.EnableAutoSync,
		SyncInterval:   req.SyncInterval,
		SyncFolders:    req.SyncFolders,
		SyncStatus:     "idle",
	}

	if err := h.syncConfigRepo.CreateOrUpdate(config); err != nil {
		http.Error(w, "Failed to create sync config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(config)
}

// UpdateAccountSyncConfig updates sync config for an account
func (h *SyncHandlers) UpdateAccountSyncConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	config, err := h.syncConfigRepo.GetByAccountID(uint(id))
	if err != nil {
		http.Error(w, "Sync config not found", http.StatusNotFound)
		return
	}

	var req struct {
		EnableAutoSync *bool    `json:"enable_auto_sync"`
		SyncInterval   *int     `json:"sync_interval"`
		SyncFolders    []string `json:"sync_folders"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.EnableAutoSync != nil {
		config.EnableAutoSync = *req.EnableAutoSync
	}
	if req.SyncInterval != nil && *req.SyncInterval > 0 {
		config.SyncInterval = *req.SyncInterval
	}
	if len(req.SyncFolders) > 0 {
		config.SyncFolders = req.SyncFolders
	}

	if err := h.syncConfigRepo.Update(config); err != nil {
		http.Error(w, "Failed to update sync config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// DeleteAccountSyncConfig deletes sync config for an account
func (h *SyncHandlers) DeleteAccountSyncConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	config, err := h.syncConfigRepo.GetByAccountID(uint(id))
	if err != nil {
		http.Error(w, "Sync config not found", http.StatusNotFound)
		return
	}

	if err := h.syncConfigRepo.Delete(config.ID); err != nil {
		http.Error(w, "Failed to delete sync config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetEffectiveSyncConfig gets the effective sync config for an account
func (h *SyncHandlers) GetEffectiveSyncConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	config, err := h.syncConfigRepo.GetEffectiveSyncConfig(uint(id))
	if err != nil {
		http.Error(w, "Failed to get effective sync config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Check if temporary config exists
	tempConfig, tempErr := h.syncConfigRepo.GetTemporaryConfigByAccountID(uint(id))
	isTemporary := tempErr == nil && tempConfig != nil

	response := map[string]interface{}{
		"config":       config,
		"is_temporary": isTemporary,
	}
	if isTemporary {
		expiresAt := tempConfig.ExpiresAt.Format("2006-01-02T15:04:05Z07:00")
		response["expires_at"] = expiresAt
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CreateTemporarySyncConfig creates a temporary sync config override
func (h *SyncHandlers) CreateTemporarySyncConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	var req struct {
		SyncInterval    int      `json:"sync_interval"`
		SyncFolders     []string `json:"sync_folders"`
		DurationMinutes int      `json:"duration_minutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	tempConfig := &models.TemporarySyncConfig{
		AccountID:    uint(id),
		SyncInterval: req.SyncInterval,
		SyncFolders:  req.SyncFolders,
	}

	if err := h.syncConfigRepo.CreateTemporaryConfig(tempConfig); err != nil {
		http.Error(w, "Failed to create temporary config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(tempConfig)
}

// SyncNow triggers an immediate sync for an account
func (h *SyncHandlers) SyncNow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	accountID := uint(id)
	h.logger.Info("Triggering immediate sync for account %d", accountID)

	if h.perAccountSyncManager != nil {
		result, err := h.perAccountSyncManager.SyncNow(accountID, services.SyncNowOptions{
			CreateStrategy: "ensure",
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"error":   "Sync manager not available",
	})
}

// GetSyncStatistics gets sync statistics for an account
func (h *SyncHandlers) GetSyncStatistics(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	config, err := h.syncConfigRepo.GetByAccountID(uint(id))
	if err != nil {
		http.Error(w, "Sync config not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"account_id":      config.AccountID,
		"sync_status":     config.SyncStatus,
		"last_sync_time":  config.LastSyncTime,
		"last_sync_error": config.LastSyncError,
	})
}

// GetAccountMailboxes gets mailboxes for an account
func (h *SyncHandlers) GetAccountMailboxes(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}

	account, err := h.emailAccountRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	mailboxes, err := h.fetcherService.GetMailboxes(*account)
	if err != nil {
		http.Error(w, "Failed to get mailboxes: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mailboxes)
}

// GetGlobalSyncConfig gets the global sync configuration
func (h *SyncHandlers) GetGlobalSyncConfig(w http.ResponseWriter, r *http.Request) {
	config, err := h.syncConfigRepo.GetGlobalConfig()
	if err != nil {
		http.Error(w, "Failed to get global config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// UpdateGlobalSyncConfig updates the global sync configuration
func (h *SyncHandlers) UpdateGlobalSyncConfig(w http.ResponseWriter, r *http.Request) {
	var req map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.syncConfigRepo.UpdateGlobalConfig(req); err != nil {
		http.Error(w, "Failed to update global config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Return updated config
	config, _ := h.syncConfigRepo.GetGlobalConfig()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// BatchCreateOrUpdateAccountSyncConfig handles batch sync config operations
func (h *SyncHandlers) BatchCreateOrUpdateAccountSyncConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AccountIDs     []uint   `json:"account_ids"`
		EnableAutoSync bool     `json:"enable_auto_sync"`
		SyncInterval   int      `json:"sync_interval"`
		SyncFolders    []string `json:"sync_folders"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.SyncInterval <= 0 {
		req.SyncInterval = 300
	}
	if len(req.SyncFolders) == 0 {
		req.SyncFolders = []string{"INBOX"}
	}

	var configs []*models.EmailAccountSyncConfig
	for _, accountID := range req.AccountIDs {
		configs = append(configs, &models.EmailAccountSyncConfig{
			AccountID:      accountID,
			EnableAutoSync: req.EnableAutoSync,
			SyncInterval:   req.SyncInterval,
			SyncFolders:    req.SyncFolders,
			SyncStatus:     "idle",
		})
	}

	successCount := 0
	var errors []map[string]interface{}

	for _, config := range configs {
		if err := h.syncConfigRepo.CreateOrUpdate(config); err != nil {
			errors = append(errors, map[string]interface{}{
				"account_id": config.AccountID,
				"error":      err.Error(),
			})
		} else {
			successCount++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success_count": successCount,
		"error_count":   len(errors),
		"errors":        errors,
	})
}
