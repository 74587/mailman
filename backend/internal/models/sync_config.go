package models

import (
	"time"
)

// EmailAccountSyncConfig represents the sync configuration for an email account
type EmailAccountSyncConfig struct {
	ID                uint        `gorm:"primaryKey" json:"id"`
	AccountID         uint        `gorm:"uniqueIndex;not null" json:"account_id"`
	EnableAutoSync    bool        `gorm:"default:true" json:"enable_auto_sync"`
	SyncInterval      int         `gorm:"default:5" json:"sync_interval"` // seconds
	SyncFolders       StringSlice `gorm:"type:text" json:"sync_folders"`
	LastSyncTime      *time.Time  `json:"last_sync_time,omitempty"`     // 上次同步开始时间
	LastSyncEndTime   *time.Time  `json:"last_sync_end_time,omitempty"` // 上次同步结束时间
	LastSyncMessageID string      `json:"last_sync_message_id,omitempty"`
	LastSyncError     string      `json:"last_sync_error,omitempty"`
	SyncStatus        string      `gorm:"default:idle" json:"sync_status"` // idle, syncing, error
	LastHistoryID     string      `json:"last_history_id,omitempty"`       // Gmail API History ID for incremental sync

	// 自动禁用相关字段
	AutoDisabled      bool       `gorm:"default:false" json:"auto_disabled"`      // 是否因错误自动禁用同步
	DisableReason     string     `gorm:"type:varchar(255)" json:"disable_reason"` // 自动禁用原因
	ConsecutiveErrors int        `gorm:"default:0" json:"consecutive_errors"`     // 连续错误次数
	LastErrorTime     *time.Time `json:"last_error_time,omitempty"`               // 最后错误时间

	// 恢复相关字段
	RecoveryAttempts    int        `gorm:"default:0" json:"recovery_attempts"` // 恢复尝试次数
	LastRecoveryAttempt *time.Time `json:"last_recovery_attempt,omitempty"`    // 最后恢复尝试时间

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Associations
	Account EmailAccount `gorm:"foreignKey:AccountID;constraint:OnDelete:CASCADE" json:"account,omitempty"`
}

// SyncCursor stores mutable sync checkpoint state separately from sync settings.
type SyncCursor struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	AccountID       uint       `gorm:"not null;uniqueIndex:idx_sync_cursors_account_provider_mailbox" json:"account_id"`
	Provider        string     `gorm:"type:varchar(32);not null;uniqueIndex:idx_sync_cursors_account_provider_mailbox" json:"provider"`
	MailboxName     string     `gorm:"type:varchar(255);not null;uniqueIndex:idx_sync_cursors_account_provider_mailbox" json:"mailbox_name"`
	LastSyncTime    *time.Time `json:"last_sync_time,omitempty"`
	LastSyncEndTime *time.Time `json:"last_sync_end_time,omitempty"`
	LastHistoryID   string     `gorm:"type:varchar(255)" json:"last_history_id,omitempty"`
	LastMessageID   string     `gorm:"type:varchar(255)" json:"last_message_id,omitempty"`
	Metadata        JSONMap    `gorm:"type:json" json:"metadata,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`

	Account EmailAccount `gorm:"foreignKey:AccountID;constraint:OnDelete:CASCADE" json:"-"`
}

// TableName specifies the table name for sync cursors.
func (SyncCursor) TableName() string {
	return "sync_cursors"
}

// TemporarySyncConfig represents a temporary sync configuration with expiration
type TemporarySyncConfig struct {
	ID           uint        `gorm:"primaryKey" json:"id"`
	AccountID    uint        `gorm:"uniqueIndex;not null" json:"account_id"`
	SyncInterval int         `gorm:"default:5" json:"sync_interval"` // seconds
	SyncFolders  StringSlice `gorm:"type:text" json:"sync_folders"`
	ExpiresAt    time.Time   `json:"expires_at"`
	CreatedAt    time.Time   `json:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at"`

	// Associations
	Account EmailAccount `gorm:"foreignKey:AccountID;constraint:OnDelete:CASCADE" json:"account,omitempty"`
}

// TableName specifies the table name for GORM
func (TemporarySyncConfig) TableName() string {
	return "temporary_sync_configs"
}

// IsExpired checks if the temporary config has expired
func (t *TemporarySyncConfig) IsExpired() bool {
	return time.Now().After(t.ExpiresAt)
}

// TableName specifies the table name for GORM
func (EmailAccountSyncConfig) TableName() string {
	return "email_account_sync_configs"
}

// GlobalSyncConfig represents the global sync configuration
type GlobalSyncConfig struct {
	ID                  uint        `gorm:"primaryKey" json:"id"`
	DefaultEnableSync   bool        `gorm:"default:true" json:"default_enable_sync"`
	DefaultSyncInterval int         `gorm:"default:5" json:"default_sync_interval"` // seconds
	DefaultSyncFolders  StringSlice `gorm:"type:text" json:"default_sync_folders"`
	MaxSyncWorkers      int         `gorm:"default:10" json:"max_sync_workers"`
	MaxEmailsPerSync    int         `gorm:"default:100" json:"max_emails_per_sync"`
	UpdatedAt           time.Time   `json:"updated_at"`
}

// TableName specifies the table name for GORM
func (GlobalSyncConfig) TableName() string {
	return "global_sync_configs"
}

// SyncStatistics represents sync operation statistics
type SyncStatistics struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	AccountID      uint      `gorm:"not null" json:"account_id"`
	SyncDate       time.Time `gorm:"type:date;not null" json:"sync_date"`
	EmailsSynced   int       `gorm:"default:0" json:"emails_synced"`
	SyncDurationMs int       `gorm:"default:0" json:"sync_duration_ms"`
	ErrorsCount    int       `gorm:"default:0" json:"errors_count"`
	CreatedAt      time.Time `json:"created_at"`

	// Associations
	Account EmailAccount `gorm:"foreignKey:AccountID;constraint:OnDelete:CASCADE" json:"-"`
}

// TableName specifies the table name for GORM
func (SyncStatistics) TableName() string {
	return "sync_statistics"
}

// SyncRun records a single sync execution for observability and debugging.
type SyncRun struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	AccountID     uint       `gorm:"not null;index" json:"account_id"`
	Source        string     `gorm:"type:varchar(32);not null;index" json:"source"` // auto_sync, manual_sync, pickup
	Status        string     `gorm:"type:varchar(32);not null;index" json:"status"` // running, success, failed
	StartedAt     time.Time  `gorm:"not null;index" json:"started_at"`
	FinishedAt    *time.Time `json:"finished_at,omitempty"`
	DurationMs    int64      `gorm:"default:0" json:"duration_ms"`
	EmailsFetched int        `gorm:"default:0" json:"emails_fetched"`
	NewEmails     int        `gorm:"default:0" json:"new_emails"`
	ErrorMessage  string     `gorm:"type:text" json:"error_message,omitempty"`
	Metadata      JSONMap    `gorm:"type:json" json:"metadata,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`

	Account EmailAccount `gorm:"foreignKey:AccountID;constraint:OnDelete:CASCADE" json:"-"`
}

// TableName specifies the table name for sync runs.
func (SyncRun) TableName() string {
	return "sync_runs"
}

// SyncStatus constants
const (
	SyncStatusIdle    = "idle"
	SyncStatusSyncing = "syncing"
	SyncStatusError   = "error"
)

// SyncRun status constants.
const (
	SyncRunStatusRunning = "running"
	SyncRunStatusSuccess = "success"
	SyncRunStatusFailed  = "failed"
)

// SyncCursor provider/mailbox constants.
const (
	SyncCursorProviderGeneric = "generic"
	SyncCursorProviderGmail   = "gmail"
	SyncCursorMailboxAccount  = "__account__"
)

// IsValidSyncStatus checks if the sync status is valid
func IsValidSyncStatus(status string) bool {
	switch status {
	case SyncStatusIdle, SyncStatusSyncing, SyncStatusError:
		return true
	default:
		return false
	}
}

// GetDefaultSyncFolders returns the default folders to sync
func GetDefaultSyncFolders() StringSlice {
	return StringSlice{"INBOX"}
}
