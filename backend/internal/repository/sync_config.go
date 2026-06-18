package repository

import (
	"context"
	"mailman/internal/database"
	"mailman/internal/models"
	"time"

	"gorm.io/gorm"
)

type SyncConfigRepository struct {
	db *gorm.DB
}

func NewSyncConfigRepository(db *gorm.DB) *SyncConfigRepository {
	return &SyncConfigRepository{db: db}
}

// GetByAccountID retrieves sync config by account ID
func (r *SyncConfigRepository) GetByAccountID(accountID uint) (*models.EmailAccountSyncConfig, error) {
	return r.GetByAccountIDWithContext(context.Background(), accountID)
}

func (r *SyncConfigRepository) GetByAccountIDWithContext(ctx context.Context, accountID uint) (*models.EmailAccountSyncConfig, error) {
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	var config models.EmailAccountSyncConfig
	err := db.Where("account_id = ?", accountID).First(&config).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// Create creates a new sync config
func (r *SyncConfigRepository) Create(config *models.EmailAccountSyncConfig) error {
	return r.db.Create(config).Error
}

// Update updates an existing sync config
func (r *SyncConfigRepository) Update(config *models.EmailAccountSyncConfig) error {
	return r.db.Save(config).Error
}

// Delete deletes a sync config
func (r *SyncConfigRepository) Delete(id uint) error {
	return r.db.Delete(&models.EmailAccountSyncConfig{}, id).Error
}

// GetAll retrieves all sync configs
func (r *SyncConfigRepository) GetAll() ([]models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig
	err := r.db.Find(&configs).Error
	return configs, err
}

// GetEnabledConfigs retrieves all enabled sync configs
func (r *SyncConfigRepository) GetEnabledConfigs() ([]models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig
	err := r.db.Where("enable_auto_sync = ?", true).Find(&configs).Error
	return configs, err
}

// GetEnabledConfigsWithAccounts retrieves all enabled sync configs with account details
// Only returns configs for verified, non-deleted accounts
// GetEnabledConfigsWithAccounts retrieves all enabled sync configs with account details
// Also includes accounts that have active temporary sync configs (even if disabled in main config)
// Only returns configs for verified, non-deleted accounts
func (r *SyncConfigRepository) GetEnabledConfigsWithAccounts() ([]models.EmailAccountSyncConfig, error) {
	// 1. Get all relevant persistent configs:
	//    - Either explicitly enabled (enable_auto_sync = true)
	//    - OR has a valid temporary config
	var configs []models.EmailAccountSyncConfig
	err := r.db.Preload("Account").Preload("Account.MailProvider").
		Joins("JOIN email_accounts ON email_accounts.id = email_account_sync_configs.account_id").
		Where("email_accounts.is_verified = ?", true).
		Where("email_accounts.deleted_at IS NULL").
		Where("email_account_sync_configs.enable_auto_sync = ? OR email_account_sync_configs.account_id IN (SELECT account_id FROM temporary_sync_configs WHERE expires_at > ?)", true, time.Now()).
		Find(&configs).Error
	if err != nil {
		return nil, err
	}

	// 2. Get valid temporary configs to apply overrides
	var tempConfigs []models.TemporarySyncConfig
	err = r.db.Where("expires_at > ?", time.Now()).Find(&tempConfigs).Error
	if err != nil {
		return nil, err
	}

	// Create map for fast lookup
	tempMap := make(map[uint]models.TemporarySyncConfig)
	for _, t := range tempConfigs {
		tempMap[t.AccountID] = t
	}

	// 3. Apply overrides
	// Even though we fetched them, we need to ensure the in-memory struct reflects the temporary state
	for i := range configs {
		if temp, exists := tempMap[configs[i].AccountID]; exists {
			configs[i].EnableAutoSync = true // Force enable
			configs[i].SyncInterval = temp.SyncInterval
			configs[i].SyncFolders = temp.SyncFolders
			configs[i].AutoDisabled = false // Reset auto-disabled state for temporary run
			configs[i].DisableReason = ""
		}
	}

	return configs, err
}

// GetVerifiedAccountsWithoutSyncConfig retrieves all verified, non-deleted accounts without sync config
func (r *SyncConfigRepository) GetVerifiedAccountsWithoutSyncConfig() ([]models.EmailAccount, error) {
	var accounts []models.EmailAccount
	err := r.db.Preload("MailProvider").
		Where("is_verified = ?", true).
		Where("deleted_at IS NULL").
		Where("id NOT IN (SELECT account_id FROM email_account_sync_configs)").
		Find(&accounts).Error
	return accounts, err
}

// GetByID retrieves sync config by ID
func (r *SyncConfigRepository) GetByID(id uint) (*models.EmailAccountSyncConfig, error) {
	var config models.EmailAccountSyncConfig
	err := r.db.Preload("Account").Preload("Account.MailProvider").First(&config, id).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// UpdateSyncStatus updates the sync status and error message
func (r *SyncConfigRepository) UpdateSyncStatus(accountID uint, status string, errorMsg string) error {
	updates := map[string]interface{}{
		"sync_status": status,
	}
	if errorMsg != "" {
		updates["last_sync_error"] = errorMsg
	} else {
		updates["last_sync_error"] = gorm.Expr("NULL")
	}

	return r.db.Model(&models.EmailAccountSyncConfig{}).
		Where("account_id = ?", accountID).
		Updates(updates).Error
}

// UpdateLastSyncTime updates the last sync time
func (r *SyncConfigRepository) UpdateLastSyncTime(accountID uint) error {
	return r.db.Model(&models.EmailAccountSyncConfig{}).
		Where("account_id = ?", accountID).
		Update("last_sync_time", gorm.Expr("CURRENT_TIMESTAMP")).Error
}

// UpdateLastSyncMessageID updates the last synced message ID
func (r *SyncConfigRepository) UpdateLastSyncMessageID(accountID uint, messageID string) error {
	return r.db.Model(&models.EmailAccountSyncConfig{}).
		Where("account_id = ?", accountID).
		Update("last_sync_message_id", messageID).Error
}

// CreateDefaultConfigForAccount creates a default sync config for an account
func (r *SyncConfigRepository) CreateDefaultConfigForAccount(accountID uint) error {
	config := &models.EmailAccountSyncConfig{
		AccountID:      accountID,
		EnableAutoSync: true,
		SyncInterval:   300, // 5 minutes default
		SyncFolders:    []string{"INBOX"},
		SyncStatus:     "idle",
	}
	return r.db.Create(config).Error
}

// GetByAccountIDWithAccount retrieves sync config by account ID with account details
func (r *SyncConfigRepository) GetByAccountIDWithAccount(accountID uint) (*models.EmailAccountSyncConfig, error) {
	return r.GetByAccountIDWithAccountContext(context.Background(), accountID)
}

func (r *SyncConfigRepository) GetByAccountIDWithAccountContext(ctx context.Context, accountID uint) (*models.EmailAccountSyncConfig, error) {
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	var config models.EmailAccountSyncConfig
	err := db.Preload("Account").Preload("Account.MailProvider").Where("account_id = ?", accountID).First(&config).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// BulkUpdateSyncStatus updates sync status for multiple accounts
func (r *SyncConfigRepository) BulkUpdateSyncStatus(accountIDs []uint, status string) error {
	return r.db.Model(&models.EmailAccountSyncConfig{}).
		Where("account_id IN ?", accountIDs).
		Update("sync_status", status).Error
}

// GetSyncingConfigs retrieves all configs currently syncing
func (r *SyncConfigRepository) GetSyncingConfigs() ([]models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig
	err := r.db.Where("sync_status = ?", "syncing").Find(&configs).Error
	return configs, err
}

// ResetStuckSyncingStatus resets configs stuck in syncing status
func (r *SyncConfigRepository) ResetStuckSyncingStatus() error {
	return r.db.Model(&models.EmailAccountSyncConfig{}).
		Where("sync_status = ?", "syncing").
		Updates(map[string]interface{}{
			"sync_status":     "idle",
			"last_sync_error": "Sync was interrupted",
		}).Error
}

// GetConfigsNeedingSync retrieves configs that need syncing based on interval
func (r *SyncConfigRepository) GetConfigsNeedingSync() ([]models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig

	// Build driver-aware time comparison
	var timeCondition string
	switch database.GetDBDriver() {
	case "sqlite":
		timeCondition = "last_sync_time IS NULL OR last_sync_time < datetime('now', '-' || sync_interval || ' seconds')"
	case "postgres":
		timeCondition = "last_sync_time IS NULL OR last_sync_time < NOW() - (sync_interval || ' seconds')::interval"
	case "mysql":
		timeCondition = "last_sync_time IS NULL OR last_sync_time < DATE_SUB(NOW(), INTERVAL sync_interval SECOND)"
	default:
		timeCondition = "last_sync_time IS NULL"
	}

	err := r.db.
		Preload("Account").
		Preload("Account.MailProvider").
		Where("enable_auto_sync = ?", true).
		Where("sync_status = ?", "idle").
		Where(timeCondition).
		Find(&configs).Error
	return configs, err
}

// UpdateSyncInterval updates the sync interval for a config
func (r *SyncConfigRepository) UpdateSyncInterval(accountID uint, interval int) error {
	return r.db.Model(&models.EmailAccountSyncConfig{}).
		Where("account_id = ?", accountID).
		Update("sync_interval", interval).Error
}

// UpdateSyncFolders updates the sync folders for a config
func (r *SyncConfigRepository) UpdateSyncFolders(accountID uint, folders []string) error {
	return r.db.Model(&models.EmailAccountSyncConfig{}).
		Where("account_id = ?", accountID).
		Update("sync_folders", folders).Error
}

// ToggleAutoSync toggles the auto sync setting
func (r *SyncConfigRepository) ToggleAutoSync(accountID uint) error {
	return r.db.Model(&models.EmailAccountSyncConfig{}).
		Where("account_id = ?", accountID).
		Update("enable_auto_sync", gorm.Expr("NOT enable_auto_sync")).Error
}

// GetSyncStats retrieves sync statistics
func (r *SyncConfigRepository) GetSyncStats(orgID uint) (map[string]interface{}, error) {
	var totalConfigs, activeConfigs, syncingConfigs, errorConfigs, disabledConfigs int64

	// 构建基础过滤条件 (通过 JOIN email_accounts 按组织过滤)
	buildQuery := func() *gorm.DB {
		q := r.db.Model(&models.EmailAccountSyncConfig{}).
			Joins("JOIN email_accounts ON email_accounts.id = email_account_sync_configs.account_id")
		if orgID > 0 {
			q = q.Where("email_accounts.org_id = ?", orgID)
		}
		return q
	}

	// 总配置数
	buildQuery().Count(&totalConfigs)

	// 活跃配置：enable_auto_sync = true 且 auto_disabled = false
	buildQuery().
		Where("email_account_sync_configs.enable_auto_sync = ? AND (email_account_sync_configs.auto_disabled = ? OR email_account_sync_configs.auto_disabled IS NULL)", true, false).
		Count(&activeConfigs)

	// 正在同步
	buildQuery().
		Where("email_account_sync_configs.sync_status = ?", "syncing").
		Count(&syncingConfigs)

	// 异常配置：sync_status = 'error' 或 auto_disabled = true
	buildQuery().
		Where("email_account_sync_configs.sync_status = ? OR email_account_sync_configs.auto_disabled = ?", "error", true).
		Count(&errorConfigs)

	// 已禁用：enable_auto_sync = false
	buildQuery().
		Where("email_account_sync_configs.enable_auto_sync = ?", false).
		Count(&disabledConfigs)

	return map[string]interface{}{
		"total":    totalConfigs,
		"active":   activeConfigs,   // 启用且未被自动禁用
		"syncing":  syncingConfigs,  // 正在同步
		"errors":   errorConfigs,    // 异常（含自动禁用）
		"disabled": disabledConfigs, // 手动禁用
	}, nil
}

// GetAllWithPagination retrieves all sync configs with pagination, search, status and enabled filter
func (r *SyncConfigRepository) GetAllWithPagination(orgID uint, page, limit int, search, status, enabled string) (int, []models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig
	var totalCount int64

	// Base query for counting
	baseQuery := r.db.Model(&models.EmailAccountSyncConfig{}).
		Joins("JOIN email_accounts ON email_accounts.id = email_account_sync_configs.account_id")

	// 按组织过滤
	if orgID > 0 {
		baseQuery = baseQuery.Where("email_accounts.org_id = ?", orgID)
	}

	if search != "" {
		baseQuery = baseQuery.Where("email_accounts.email_address LIKE ?", "%"+search+"%")
	}

	// Apply status filter
	if status != "" && status != "all" {
		if status == "abnormal" {
			baseQuery = baseQuery.Where("email_account_sync_configs.sync_status = ? OR email_account_sync_configs.auto_disabled = ?", "error", true)
		} else {
			baseQuery = baseQuery.Where("email_account_sync_configs.sync_status = ?", status)
		}
	}

	// Apply enabled filter
	if enabled != "" && enabled != "all" {
		switch enabled {
		case "enabled":
			// 已启用：enable_auto_sync=true 且 auto_disabled=false
			baseQuery = baseQuery.Where("email_account_sync_configs.enable_auto_sync = ? AND (email_account_sync_configs.auto_disabled = ? OR email_account_sync_configs.auto_disabled IS NULL)", true, false)
		case "disabled":
			// 已禁用：enable_auto_sync=false
			baseQuery = baseQuery.Where("email_account_sync_configs.enable_auto_sync = ?", false)
		case "auto_disabled":
			// 自动禁用：auto_disabled=true
			baseQuery = baseQuery.Where("email_account_sync_configs.auto_disabled = ?", true)
		}
	}

	// Get total count
	if err := baseQuery.Count(&totalCount).Error; err != nil {
		return 0, nil, err
	}

	// Build query for fetching data
	offset := (page - 1) * limit
	query := r.db.Model(&models.EmailAccountSyncConfig{}).
		Preload("Account").
		Preload("Account.MailProvider").
		Joins("JOIN email_accounts ON email_accounts.id = email_account_sync_configs.account_id")

	// 按组织过滤
	if orgID > 0 {
		query = query.Where("email_accounts.org_id = ?", orgID)
	}

	// Apply search filter if provided
	if search != "" {
		query = query.Where("email_accounts.email_address LIKE ?", "%"+search+"%")
	}

	// Apply status filter
	if status != "" && status != "all" {
		if status == "abnormal" {
			query = query.Where("email_account_sync_configs.sync_status = ? OR email_account_sync_configs.auto_disabled = ?", "error", true)
		} else {
			query = query.Where("email_account_sync_configs.sync_status = ?", status)
		}
	}

	// Apply enabled filter
	if enabled != "" && enabled != "all" {
		switch enabled {
		case "enabled":
			query = query.Where("email_account_sync_configs.enable_auto_sync = ? AND (email_account_sync_configs.auto_disabled = ? OR email_account_sync_configs.auto_disabled IS NULL)", true, false)
		case "disabled":
			query = query.Where("email_account_sync_configs.enable_auto_sync = ?", false)
		case "auto_disabled":
			query = query.Where("email_account_sync_configs.auto_disabled = ?", true)
		}
	}

	// Apply pagination and ordering
	err := query.
		Offset(offset).
		Limit(limit).
		Order("email_account_sync_configs.updated_at DESC").
		Find(&configs).Error

	if err != nil {
		return 0, nil, err
	}

	return int(totalCount), configs, nil
}

// CreateOrUpdate creates or updates a sync config
func (r *SyncConfigRepository) CreateOrUpdate(config *models.EmailAccountSyncConfig) error {
	return r.CreateOrUpdateWithContext(context.Background(), config)
}

func (r *SyncConfigRepository) CreateOrUpdateWithContext(ctx context.Context, config *models.EmailAccountSyncConfig) error {
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	var existing models.EmailAccountSyncConfig
	err := db.Where("account_id = ?", config.AccountID).First(&existing).Error

	if err == gorm.ErrRecordNotFound {
		// Create new record
		return db.Create(config).Error
	}
	if err != nil {
		return err
	}

	// Update existing record
	config.ID = existing.ID
	return db.Save(config).Error
}

// CreateOrUpdateSettings writes user-facing sync settings without overwriting runtime checkpoint state.
func (r *SyncConfigRepository) CreateOrUpdateSettings(config *models.EmailAccountSyncConfig) error {
	if config == nil {
		return nil
	}

	var existing models.EmailAccountSyncConfig
	err := r.db.Where("account_id = ?", config.AccountID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		if config.SyncStatus == "" {
			config.SyncStatus = models.SyncStatusIdle
		}
		now := time.Now()
		return r.db.Model(&models.EmailAccountSyncConfig{}).Create(map[string]interface{}{
			"account_id":       config.AccountID,
			"enable_auto_sync": config.EnableAutoSync,
			"sync_interval":    config.SyncInterval,
			"sync_folders":     config.SyncFolders,
			"sync_status":      config.SyncStatus,
			"created_at":       now,
			"updated_at":       now,
		}).Error
	}
	if err != nil {
		return err
	}
	config.ID = existing.ID

	updates := map[string]interface{}{
		"enable_auto_sync": config.EnableAutoSync,
		"sync_interval":    config.SyncInterval,
		"sync_folders":     config.SyncFolders,
	}
	if config.SyncStatus != "" {
		updates["sync_status"] = config.SyncStatus
	}
	if config.EnableAutoSync && (!existing.EnableAutoSync || existing.AutoDisabled) {
		updates["auto_disabled"] = false
		updates["disable_reason"] = ""
		updates["consecutive_errors"] = 0
		updates["last_error_time"] = nil
		updates["last_sync_error"] = ""
	}

	return r.db.Model(&existing).Updates(updates).Error
}

// RecordSyncStatistics records sync statistics (placeholder for now)
func (r *SyncConfigRepository) RecordSyncStatistics(stats *models.SyncStatistics) error {
	// For now, just update the last sync time
	// In the future, this could store detailed statistics
	if stats != nil && stats.AccountID > 0 {
		return r.UpdateLastSyncTime(stats.AccountID)
	}
	return nil
}

// CreateSyncRun records the start of a sync execution.
func (r *SyncConfigRepository) CreateSyncRun(run *models.SyncRun) error {
	return r.CreateSyncRunWithContext(context.Background(), run)
}

func (r *SyncConfigRepository) CreateSyncRunWithContext(ctx context.Context, run *models.SyncRun) error {
	if run == nil {
		return nil
	}
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	if run.StartedAt.IsZero() {
		run.StartedAt = time.Now()
	}
	if run.Status == "" {
		run.Status = models.SyncRunStatusRunning
	}
	if run.Source == "" {
		run.Source = "unknown"
	}
	return db.Create(run).Error
}

// FinishSyncRun marks a sync execution as finished.
func (r *SyncConfigRepository) FinishSyncRun(runID uint, status string, emailsFetched int, newEmails int, err error) error {
	return r.FinishSyncRunWithContext(context.Background(), runID, status, emailsFetched, newEmails, err)
}

func (r *SyncConfigRepository) FinishSyncRunWithContext(ctx context.Context, runID uint, status string, emailsFetched int, newEmails int, err error) error {
	if runID == 0 {
		return nil
	}
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}
	if status == "" {
		status = models.SyncRunStatusSuccess
	}
	now := time.Now()
	var run models.SyncRun
	if err := db.First(&run, runID).Error; err != nil {
		return err
	}
	updates := map[string]interface{}{
		"status":         status,
		"finished_at":    &now,
		"duration_ms":    now.Sub(run.StartedAt).Milliseconds(),
		"emails_fetched": emailsFetched,
		"new_emails":     newEmails,
		"updated_at":     now,
	}
	if err != nil {
		updates["error_message"] = err.Error()
	}
	return db.Model(&models.SyncRun{}).Where("id = ?", runID).Updates(updates).Error
}

// GetRecentSyncRuns returns recent sync executions for one account.
func (r *SyncConfigRepository) GetRecentSyncRuns(accountID uint, limit int) ([]models.SyncRun, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var runs []models.SyncRun
	err := r.db.Where("account_id = ?", accountID).
		Order("started_at DESC").
		Limit(limit).
		Find(&runs).Error
	return runs, err
}

// GetSyncCursor retrieves a sync checkpoint cursor for one account/provider/mailbox.
func (r *SyncConfigRepository) GetSyncCursor(accountID uint, provider, mailboxName string) (*models.SyncCursor, error) {
	return r.GetSyncCursorWithContext(context.Background(), accountID, provider, mailboxName)
}

func (r *SyncConfigRepository) GetSyncCursorWithContext(ctx context.Context, accountID uint, provider, mailboxName string) (*models.SyncCursor, error) {
	provider = normalizeSyncCursorProvider(provider)
	mailboxName = normalizeSyncCursorMailbox(mailboxName)
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}

	var cursor models.SyncCursor
	err := db.Where("account_id = ? AND provider = ? AND mailbox_name = ?", accountID, provider, mailboxName).
		First(&cursor).Error
	if err != nil {
		return nil, err
	}
	return &cursor, nil
}

// GetAccountSyncCursor retrieves the account-level sync checkpoint cursor.
func (r *SyncConfigRepository) GetAccountSyncCursor(accountID uint, provider string) (*models.SyncCursor, error) {
	return r.GetSyncCursor(accountID, provider, models.SyncCursorMailboxAccount)
}

func (r *SyncConfigRepository) GetAccountSyncCursorWithContext(ctx context.Context, accountID uint, provider string) (*models.SyncCursor, error) {
	return r.GetSyncCursorWithContext(ctx, accountID, provider, models.SyncCursorMailboxAccount)
}

// UpsertAccountSyncCursorTimes stores account-level time checkpoints without touching provider tokens.
func (r *SyncConfigRepository) UpsertAccountSyncCursorTimes(accountID uint, provider string, lastSyncTime, lastSyncEndTime *time.Time) error {
	return r.UpsertAccountSyncCursorTimesWithContext(context.Background(), accountID, provider, lastSyncTime, lastSyncEndTime)
}

func (r *SyncConfigRepository) UpsertAccountSyncCursorTimesWithContext(ctx context.Context, accountID uint, provider string, lastSyncTime, lastSyncEndTime *time.Time) error {
	provider = normalizeSyncCursorProvider(provider)
	return r.upsertSyncCursorFieldsWithContext(ctx, accountID, provider, models.SyncCursorMailboxAccount, map[string]interface{}{
		"last_sync_time":     lastSyncTime,
		"last_sync_end_time": lastSyncEndTime,
	})
}

// UpsertAccountSyncCursorHistoryID stores Gmail History ID without touching time checkpoints.
func (r *SyncConfigRepository) UpsertAccountSyncCursorHistoryID(accountID uint, provider string, historyID string) error {
	provider = normalizeSyncCursorProvider(provider)
	return r.upsertSyncCursorFieldsWithContext(context.Background(), accountID, provider, models.SyncCursorMailboxAccount, map[string]interface{}{
		"last_history_id": historyID,
	})
}

func (r *SyncConfigRepository) upsertSyncCursorFields(accountID uint, provider, mailboxName string, updates map[string]interface{}) error {
	return r.upsertSyncCursorFieldsWithContext(context.Background(), accountID, provider, mailboxName, updates)
}

func (r *SyncConfigRepository) upsertSyncCursorFieldsWithContext(ctx context.Context, accountID uint, provider, mailboxName string, updates map[string]interface{}) error {
	provider = normalizeSyncCursorProvider(provider)
	mailboxName = normalizeSyncCursorMailbox(mailboxName)
	db := r.db
	if ctx != nil {
		db = db.WithContext(ctx)
	}

	var cursor models.SyncCursor
	err := db.Where("account_id = ? AND provider = ? AND mailbox_name = ?", accountID, provider, mailboxName).
		First(&cursor).Error
	if err == gorm.ErrRecordNotFound {
		cursor = models.SyncCursor{
			AccountID:   accountID,
			Provider:    provider,
			MailboxName: mailboxName,
		}
		for key, value := range updates {
			switch key {
			case "last_sync_time":
				if value == nil {
					cursor.LastSyncTime = nil
				} else if typed, ok := value.(*time.Time); ok {
					cursor.LastSyncTime = typed
				}
			case "last_sync_end_time":
				if value == nil {
					cursor.LastSyncEndTime = nil
				} else if typed, ok := value.(*time.Time); ok {
					cursor.LastSyncEndTime = typed
				}
			case "last_history_id":
				if typed, ok := value.(string); ok {
					cursor.LastHistoryID = typed
				}
			}
		}
		return db.Create(&cursor).Error
	}
	if err != nil {
		return err
	}
	return db.Model(&cursor).Updates(updates).Error
}

func normalizeSyncCursorProvider(provider string) string {
	if provider == "" {
		return models.SyncCursorProviderGeneric
	}
	return provider
}

func normalizeSyncCursorMailbox(mailboxName string) string {
	if mailboxName == "" {
		return models.SyncCursorMailboxAccount
	}
	return mailboxName
}

// GetGlobalConfig retrieves global sync configuration
func (r *SyncConfigRepository) GetGlobalConfig() (map[string]interface{}, error) {
	var config models.GlobalSyncConfig

	// Try to get the global config from database
	err := r.db.First(&config).Error
	if err != nil {
		// If not found, create default config
		if err == gorm.ErrRecordNotFound {
			config = models.GlobalSyncConfig{
				DefaultEnableSync:   true,
				DefaultSyncInterval: 300,
				DefaultSyncFolders:  models.StringSlice{"INBOX"},
				MaxSyncWorkers:      10,
				MaxEmailsPerSync:    100,
			}
			if createErr := r.db.Create(&config).Error; createErr != nil {
				// Return defaults if creation fails
				return map[string]interface{}{
					"default_enable_sync":   true,
					"default_sync_interval": 300,
					"default_sync_folders":  []string{"INBOX"},
					"max_sync_workers":      10,
					"max_emails_per_sync":   100,
				}, nil
			}
		} else {
			// Other error, return defaults
			return map[string]interface{}{
				"default_enable_sync":   true,
				"default_sync_interval": 300,
				"default_sync_folders":  []string{"INBOX"},
				"max_sync_workers":      10,
				"max_emails_per_sync":   100,
			}, nil
		}
	}

	// Convert to map for backward compatibility
	return map[string]interface{}{
		"default_enable_sync":   config.DefaultEnableSync,
		"default_sync_interval": config.DefaultSyncInterval,
		"default_sync_folders":  []string(config.DefaultSyncFolders),
		"max_sync_workers":      config.MaxSyncWorkers,
		"max_emails_per_sync":   config.MaxEmailsPerSync,
	}, nil
}

// UpdateGlobalConfig updates global sync configuration
func (r *SyncConfigRepository) UpdateGlobalConfig(configMap map[string]interface{}) error {
	var config models.GlobalSyncConfig

	// Try to get existing config
	err := r.db.First(&config).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			// Create new config
			config = models.GlobalSyncConfig{}
		} else {
			return err
		}
	}

	// Update fields from map
	if v, ok := configMap["default_enable_sync"].(bool); ok {
		config.DefaultEnableSync = v
	}
	if v, ok := configMap["default_sync_interval"].(int); ok {
		config.DefaultSyncInterval = v
	}
	if v, ok := configMap["default_sync_folders"].([]string); ok {
		config.DefaultSyncFolders = models.StringSlice(v)
	}
	if v, ok := configMap["max_sync_workers"].(int); ok {
		config.MaxSyncWorkers = v
	}
	if v, ok := configMap["max_emails_per_sync"].(int); ok {
		config.MaxEmailsPerSync = v
	}

	// Save to database
	return r.db.Save(&config).Error
}

// GetSyncStatistics retrieves sync statistics
func (r *SyncConfigRepository) GetSyncStatistics(orgID uint) (map[string]interface{}, error) {
	// This is already implemented as GetSyncStats
	return r.GetSyncStats(orgID)
}

// TemporarySyncConfig operations

// GetTemporaryConfigByAccountID retrieves temporary sync config by account ID
func (r *SyncConfigRepository) GetTemporaryConfigByAccountID(accountID uint) (*models.TemporarySyncConfig, error) {
	var config models.TemporarySyncConfig
	err := r.db.Where("account_id = ? AND expires_at > ?", accountID, time.Now()).First(&config).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// CreateTemporaryConfig creates a new temporary sync config
func (r *SyncConfigRepository) CreateTemporaryConfig(config *models.TemporarySyncConfig) error {
	// Delete any existing temporary config for this account
	r.db.Where("account_id = ?", config.AccountID).Delete(&models.TemporarySyncConfig{})

	// Create new temporary config
	return r.db.Create(config).Error
}

// UpdateTemporaryConfig updates an existing temporary sync config
func (r *SyncConfigRepository) UpdateTemporaryConfig(config *models.TemporarySyncConfig) error {
	return r.db.Save(config).Error
}

// DeleteExpiredTemporaryConfigs deletes all expired temporary configs and returns affected account IDs
func (r *SyncConfigRepository) DeleteExpiredTemporaryConfigs() ([]uint, error) {
	var expiredConfigs []models.TemporarySyncConfig
	now := time.Now()

	// Find expired configs first
	if err := r.db.Where("expires_at < ?", now).Find(&expiredConfigs).Error; err != nil {
		return nil, err
	}

	if len(expiredConfigs) == 0 {
		return nil, nil
	}

	// Collect IDs
	var accountIDs []uint
	for _, config := range expiredConfigs {
		accountIDs = append(accountIDs, config.AccountID)
	}

	// Delete them
	if err := r.db.Where("expires_at < ?", now).Delete(&models.TemporarySyncConfig{}).Error; err != nil {
		return nil, err
	}

	return accountIDs, nil
}

// GetEffectiveSyncConfig returns the effective sync config for an account
// Priority: Temporary Config > User Config > Global Config
func (r *SyncConfigRepository) GetEffectiveSyncConfig(accountID uint) (*models.EmailAccountSyncConfig, error) {
	// First check for temporary config
	tempConfig, err := r.GetTemporaryConfigByAccountID(accountID)
	if err == nil && tempConfig != nil && !tempConfig.IsExpired() {
		// Convert temporary config to regular config format
		return &models.EmailAccountSyncConfig{
			AccountID:      accountID,
			EnableAutoSync: true,
			SyncInterval:   tempConfig.SyncInterval,
			SyncFolders:    tempConfig.SyncFolders,
			SyncStatus:     "idle",
		}, nil
	}

	// Then check for user config
	userConfig, err := r.GetByAccountID(accountID)
	if err == nil && userConfig != nil {
		return userConfig, nil
	}

	// Finally, return global config as EmailAccountSyncConfig
	globalConfig, _ := r.GetGlobalConfig()
	return &models.EmailAccountSyncConfig{
		AccountID:      accountID,
		EnableAutoSync: globalConfig["default_enable_sync"].(bool),
		SyncInterval:   globalConfig["default_sync_interval"].(int),
		SyncFolders:    models.StringSlice(globalConfig["default_sync_folders"].([]string)),
		SyncStatus:     "idle",
	}, nil
}

// GetRecentlyModifiedConfigs 获取最近修改的同步配置（用于配置监控）
func (r *SyncConfigRepository) GetRecentlyModifiedConfigs(since time.Time) ([]models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig

	err := r.db.Where("updated_at > ? AND enable_auto_sync = ?", since, true).
		Preload("Account").
		Select("id, account_id, enable_auto_sync, sync_interval, sync_folders, updated_at, last_sync_time, last_sync_end_time").
		Find(&configs).Error

	return configs, err
}

// GetAllConfigsWithAccounts 获取所有配置及其账户信息（用于配置监控初始化）
func (r *SyncConfigRepository) GetAllConfigsWithAccounts() ([]models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig

	err := r.db.Preload("Account").
		Where("enable_auto_sync = ?", true).
		Find(&configs).Error

	return configs, err
}

// GetConfigChecksumMap 获取配置校验和映射（用于快速变更检测）
func (r *SyncConfigRepository) GetConfigChecksumMap() (map[uint]string, error) {
	type ConfigChecksum struct {
		AccountID uint   `json:"account_id"`
		Checksum  string `json:"checksum"`
	}

	var checksums []ConfigChecksum

	// Build driver-aware checksum query
	var query string
	switch database.GetDBDriver() {
	case "postgres":
		query = `
			SELECT 
				account_id,
				MD5(CONCAT(
					COALESCE(enable_auto_sync::text, ''),
					COALESCE(sync_interval::text, ''),
					COALESCE(sync_folders::text, ''),
					COALESCE(updated_at::text, '')
				)) as checksum
			FROM email_account_sync_configs 
			WHERE enable_auto_sync = true
		`
	case "mysql":
		query = `
			SELECT 
				account_id,
				MD5(CONCAT(
					COALESCE(CAST(enable_auto_sync AS CHAR), ''),
					COALESCE(CAST(sync_interval AS CHAR), ''),
					COALESCE(CAST(sync_folders AS CHAR), ''),
					COALESCE(CAST(updated_at AS CHAR), '')
				)) as checksum
			FROM email_account_sync_configs 
			WHERE enable_auto_sync = true
		`
	default: // sqlite - no MD5 function, use simple concatenation
		query = `
			SELECT 
				account_id,
				(COALESCE(CAST(enable_auto_sync AS TEXT), '') || 
				 COALESCE(CAST(sync_interval AS TEXT), '') || 
				 COALESCE(CAST(sync_folders AS TEXT), '') || 
				 COALESCE(CAST(updated_at AS TEXT), '')) as checksum
			FROM email_account_sync_configs 
			WHERE enable_auto_sync = 1
		`
	}

	err := r.db.Raw(query).Scan(&checksums).Error
	if err != nil {
		return nil, err
	}

	result := make(map[uint]string)
	for _, cs := range checksums {
		result[cs.AccountID] = cs.Checksum
	}

	return result, nil
}

// BatchGetConfigsByIDs 批量获取指定ID的配置（优化性能）
func (r *SyncConfigRepository) BatchGetConfigsByIDs(accountIDs []uint) ([]models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig

	err := r.db.Where("account_id IN ? AND enable_auto_sync = ?", accountIDs, true).
		Preload("Account").
		Find(&configs).Error

	return configs, err
}

// BatchCreateOrUpdateConfigs 批量创建或更新配置（优化性能）
func (r *SyncConfigRepository) BatchCreateOrUpdateConfigs(configs []*models.EmailAccountSyncConfig) error {
	if len(configs) == 0 {
		return nil
	}

	// Use transaction for batch operations
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, config := range configs {
			if err := r.createOrUpdateSingle(tx, config); err != nil {
				return err
			}
		}
		return nil
	})
}

// createOrUpdateSingle handles single config creation/update within transaction
func (r *SyncConfigRepository) createOrUpdateSingle(tx *gorm.DB, config *models.EmailAccountSyncConfig) error {
	var existing models.EmailAccountSyncConfig
	err := tx.Where("account_id = ?", config.AccountID).First(&existing).Error

	if err == gorm.ErrRecordNotFound {
		// Create new record
		return tx.Create(config).Error
	}

	// Update existing record
	config.ID = existing.ID
	return tx.Save(config).Error
}

// BatchUpdateSyncIntervals 批量更新同步间隔
func (r *SyncConfigRepository) BatchUpdateSyncIntervals(updates map[uint]int) error {
	if len(updates) == 0 {
		return nil
	}

	return r.db.Transaction(func(tx *gorm.DB) error {
		for accountID, interval := range updates {
			if err := tx.Model(&models.EmailAccountSyncConfig{}).
				Where("account_id = ?", accountID).
				Update("sync_interval", interval).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// BatchGetAccountsByIDs 批量获取账户信息
func (r *SyncConfigRepository) BatchGetAccountsByIDs(accountIDs []uint) (map[uint]*models.EmailAccount, error) {
	var accounts []models.EmailAccount
	err := r.db.Where("id IN ?", accountIDs).Find(&accounts).Error
	if err != nil {
		return nil, err
	}

	accountMap := make(map[uint]*models.EmailAccount)
	for i := range accounts {
		accountMap[accounts[i].ID] = &accounts[i]
	}
	return accountMap, nil
}

// BatchGetConfigsByAccountIDs 批量获取配置信息
func (r *SyncConfigRepository) BatchGetConfigsByAccountIDs(accountIDs []uint) (map[uint]*models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig
	err := r.db.Where("account_id IN ?", accountIDs).Find(&configs).Error
	if err != nil {
		return nil, err
	}

	configMap := make(map[uint]*models.EmailAccountSyncConfig)
	for i := range configs {
		configMap[configs[i].AccountID] = &configs[i]
	}
	return configMap, nil
}

// GetAutoDisabledConfigs 获取被自动禁用的同步配置
func (r *SyncConfigRepository) GetAutoDisabledConfigs(since time.Time) ([]models.EmailAccountSyncConfig, error) {
	var configs []models.EmailAccountSyncConfig
	err := r.db.Preload("Account").
		Where("auto_disabled = ? AND last_error_time > ?", true, since).
		Find(&configs).Error
	return configs, err
}
