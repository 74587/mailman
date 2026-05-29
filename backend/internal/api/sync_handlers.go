package api

import (
	"encoding/json"
	"mailman/internal/models"
	"mailman/internal/services"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

// GetIncrementalSyncRecordsHandler retrieves incremental sync records for an account
// @Summary Get incremental sync records for an account
// @Description Get all incremental sync records for a specific account, showing last sync times per mailbox
// @Tags accounts
// @Accept json
// @Produce json
// @Param id path int true "Account ID"
// @Success 200 {array} models.IncrementalSyncRecord "List of incremental sync records"
// @Failure 400 {string} string "Bad Request - Invalid account ID"
// @Failure 404 {string} string "Not Found - Account not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/accounts/{id}/sync-records [get]
func (h *APIHandler) GetIncrementalSyncRecordsHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}
	accountID := uint(id)

	// Verify account exists
	_, err = h.EmailAccountRepo.GetByID(accountID)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// Get sync records
	records, err := h.IncrementalSyncRepo.GetAllByAccount(accountID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(records)
}

// GetLastSyncRecordHandler retrieves the last sync record for an account
// @Summary Get the last sync record for an account
// @Description Get the most recent sync record for a specific account across all mailboxes
// @Tags accounts
// @Accept json
// @Produce json
// @Param id path int true "Account ID"
// @Success 200 {object} models.IncrementalSyncRecord "Last sync record"
// @Failure 400 {string} string "Bad Request - Invalid account ID"
// @Failure 404 {string} string "Not Found - Account not found or no sync records"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/accounts/{id}/last-sync-record [get]
func (h *APIHandler) GetLastSyncRecordHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}
	accountID := uint(id)

	// Verify account exists
	_, err = h.EmailAccountRepo.GetByID(accountID)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// Get all sync records for the account
	records, err := h.IncrementalSyncRepo.GetAllByAccount(accountID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if len(records) == 0 {
		http.Error(w, "No sync records found", http.StatusNotFound)
		return
	}

	// Find the most recent sync record
	var lastRecord *models.IncrementalSyncRecord
	for i := range records {
		if lastRecord == nil || records[i].LastSyncEndTime.After(lastRecord.LastSyncEndTime) {
			lastRecord = &records[i]
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(lastRecord)
}

// DeleteIncrementalSyncRecordHandler deletes an incremental sync record
// @Summary Delete an incremental sync record
// @Description Delete an incremental sync record for a specific account and mailbox (forces full sync on next fetch)
// @Tags accounts
// @Accept json
// @Produce json
// @Param id path int true "Account ID"
// @Param mailbox query string true "Mailbox name"
// @Success 204 "No Content - Record deleted successfully"
// @Failure 400 {string} string "Bad Request - Invalid account ID or missing mailbox parameter"
// @Failure 404 {string} string "Not Found - Account or sync record not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/accounts/{id}/sync-records [delete]
func (h *APIHandler) DeleteIncrementalSyncRecordHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}
	accountID := uint(id)

	mailboxName := r.URL.Query().Get("mailbox")
	if mailboxName == "" {
		http.Error(w, "Mailbox parameter is required", http.StatusBadRequest)
		return
	}

	// Verify account exists
	_, err = h.EmailAccountRepo.GetByID(accountID)
	if err != nil {
		http.Error(w, "Account not found", http.StatusNotFound)
		return
	}

	// Delete sync record
	err = h.IncrementalSyncRepo.Delete(accountID, mailboxName)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ================ 同步监控相关处理器 ================

// GetQueueMetricsHandler 获取队列监控指标
func (h *APIHandler) GetQueueMetricsHandler(w http.ResponseWriter, r *http.Request) {
	if h.optimizedSyncManager == nil {
		http.Error(w, "Optimized sync manager not available", http.StatusServiceUnavailable)
		return
	}

	metrics := h.optimizedSyncManager.GetQueueMetrics()

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success": true,
		"data":    metrics,
	}

	json.NewEncoder(w).Encode(response)
}

func (h *APIHandler) buildAccountSyncStatusPayload(account models.EmailAccount, runtimeStatus *services.AccountSyncerStatus) map[string]interface{} {
	payload := map[string]interface{}{
		"account_id":         account.ID,
		"account_email":      account.EmailAddress,
		"enable_auto_sync":   false,
		"sync_interval":      0,
		"sync_status":        "not_configured",
		"auto_disabled":      false,
		"consecutive_errors": 0,
		"is_running":         false,
	}

	if h.SyncConfigRepo != nil {
		if config, err := h.SyncConfigRepo.GetEffectiveSyncConfig(account.ID); err == nil && config != nil {
			payload["enable_auto_sync"] = config.EnableAutoSync
			payload["sync_interval"] = config.SyncInterval
			payload["sync_status"] = config.SyncStatus
			payload["sync_folders"] = config.SyncFolders
			payload["auto_disabled"] = config.AutoDisabled
			payload["disable_reason"] = config.DisableReason
			payload["consecutive_errors"] = config.ConsecutiveErrors
			payload["last_sync_error"] = config.LastSyncError
			payload["last_sync_time"] = config.LastSyncTime
			payload["last_sync_end_time"] = config.LastSyncEndTime
			payload["last_error_time"] = config.LastErrorTime
		}

		if tempConfig, err := h.SyncConfigRepo.GetTemporaryConfigByAccountID(account.ID); err == nil && tempConfig != nil {
			payload["is_temporary"] = true
			payload["temporary_expires_at"] = tempConfig.ExpiresAt
		} else {
			payload["is_temporary"] = false
		}
	}

	if runtimeStatus != nil {
		payload["is_running"] = runtimeStatus.IsRunning
		payload["sync_interval"] = runtimeStatus.SyncInterval
		payload["sync_count"] = runtimeStatus.SyncCount
		payload["error_count"] = runtimeStatus.ErrorCount
		payload["next_sync_time"] = runtimeStatus.NextSyncTime
		if !runtimeStatus.LastSyncTime.IsZero() {
			payload["last_sync_time"] = runtimeStatus.LastSyncTime
		}
		if runtimeStatus.LastError != "" {
			payload["last_sync_error"] = runtimeStatus.LastError
		}
		if !runtimeStatus.LastErrorTime.IsZero() {
			payload["last_error_time"] = runtimeStatus.LastErrorTime
		}
	}

	return payload
}

// GetAccountSyncStatusHandler 获取账户同步状态
func (h *APIHandler) GetAccountSyncStatusHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	if h.perAccountSyncManager == nil {
		http.Error(w, "Per-account sync manager not available", http.StatusServiceUnavailable)
		return
	}

	// 获取查询参数
	accountIDStr := r.URL.Query().Get("account_id")
	includeConfig := r.URL.Query().Get("include_config") == "true"

	if accountIDStr != "" {
		// 获取单个账户状态
		accountID, err := strconv.ParseUint(accountIDStr, 10, 32)
		if err != nil {
			http.Error(w, "Invalid account ID", http.StatusBadRequest)
			return
		}

		account, accountErr := h.EmailAccountRepo.GetByID(uint(accountID))
		if accountErr != nil {
			http.Error(w, "Account not found", http.StatusNotFound)
			return
		}

		// 验证账户归属当前组织
		if orgID > 0 && account.OrgID != orgID {
			http.Error(w, "Account not found or access denied", http.StatusForbidden)
			return
		}

		status, err := h.perAccountSyncManager.GetAccountSyncerStatus(uint(accountID))
		if err != nil && !includeConfig {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		var data interface{} = status
		if includeConfig {
			data = h.buildAccountSyncStatusPayload(*account, status)
		}

		w.Header().Set("Content-Type", "application/json")
		response := map[string]interface{}{
			"success": true,
			"data":    data,
		}
		json.NewEncoder(w).Encode(response)
	} else {
		// 获取所有账户状态，按组织过滤
		allStatuses := h.perAccountSyncManager.GetAllAccountSyncerStatuses()
		statusByAccountID := make(map[uint]*services.AccountSyncerStatus, len(allStatuses))
		for i := range allStatuses {
			statusByAccountID[allStatuses[i].AccountID] = &allStatuses[i]
		}

		var filteredStatuses []interface{}
		if includeConfig {
			accounts, _ := h.EmailAccountRepo.GetAll(orgID)
			filteredStatuses = make([]interface{}, 0, len(accounts))
			for _, account := range accounts {
				filteredStatuses = append(filteredStatuses, h.buildAccountSyncStatusPayload(account, statusByAccountID[account.ID]))
			}
		} else if orgID > 0 {
			// 获取当前组织的所有账户ID
			orgAccounts, _ := h.EmailAccountRepo.GetAll(orgID)
			orgAccountIDs := make(map[uint]bool)
			for _, acct := range orgAccounts {
				orgAccountIDs[acct.ID] = true
			}
			for _, status := range allStatuses {
				if orgAccountIDs[status.AccountID] {
					filteredStatuses = append(filteredStatuses, status)
				}
			}
		} else {
			for _, status := range allStatuses {
				filteredStatuses = append(filteredStatuses, status)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		response := map[string]interface{}{
			"success": true,
			"data":    filteredStatuses,
		}
		json.NewEncoder(w).Encode(response)
	}
}

// GetSyncManagerStatsHandler 获取同步管理器统计
func (h *APIHandler) GetSyncManagerStatsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	stats := make(map[string]interface{})

	// 获取优化同步管理器统计
	if h.optimizedSyncManager != nil {
		stats["optimized_manager"] = h.optimizedSyncManager.GetQueueMetrics()
	}

	// 获取每账户同步管理器统计
	if h.perAccountSyncManager != nil {
		if orgID > 0 {
			// 按组织过滤：计算仅属于当前组织的同步器统计
			orgAccounts, _ := h.EmailAccountRepo.GetAll(orgID)
			orgAccountIDs := make(map[uint]bool)
			for _, acct := range orgAccounts {
				orgAccountIDs[acct.ID] = true
			}

			allStatuses := h.perAccountSyncManager.GetAllAccountSyncerStatuses()
			var activeSyncers, totalSyncs, totalErrors int64
			for _, status := range allStatuses {
				if orgAccountIDs[status.AccountID] {
					activeSyncers++
					totalSyncs += status.SyncCount
					totalErrors += status.ErrorCount
				}
			}

			globalStats := h.perAccountSyncManager.GetStats()
			stats["per_account_manager"] = map[string]interface{}{
				"active_syncers":     activeSyncers,
				"total_syncers":      activeSyncers,
				"total_syncs":        totalSyncs,
				"total_errors":       totalErrors,
				"concurrent_limit":   globalStats.ConcurrentLimit,
				"current_concurrent": globalStats.CurrentConcurrent,
				"start_time":         globalStats.StartTime,
			}
		} else {
			stats["per_account_manager"] = h.perAccountSyncManager.GetStats()
		}
	}

	// 获取邮件调度器统计
	if h.EmailScheduler != nil {
		stats["email_scheduler"] = h.EmailScheduler.GetMetrics()
	}

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success": true,
		"data":    stats,
	}

	json.NewEncoder(w).Encode(response)
}
