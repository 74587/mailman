package services

import (
	"mailman/internal/models"
	"time"
)

// SyncManager 定义同步管理器接口，允许不同实现之间的互操作性
type SyncManager interface {
	// Start 启动同步管理器
	Start() error

	// Stop 停止同步管理器
	Stop()

	// SyncNow 立即同步指定账户
	SyncNow(accountID uint, opts SyncNowOptions) (*SyncResult, error)

	// UpdateSubscription 更新账户的同步订阅
	UpdateSubscription(accountID uint, config *models.EmailAccountSyncConfig) error
}

// SyncResult represents the result of a sync operation
type SyncResult struct {
	EmailsSynced int
	SyncedEmails []models.Email // The actual emails that were synced
	Duration     time.Duration
	Error        error
}

// 确保实现满足接口要求
var _ SyncManager = (*OptimizedIncrementalSyncManager)(nil)
