package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"

	"gorm.io/gorm"
)

// PickupOverride 取件轮询临时同步覆盖（纯内存，不写数据库）
type PickupOverride struct {
	AccountID    uint      `json:"account_id"`
	SyncInterval int       `json:"sync_interval"` // 后端拉取邮件的间隔（秒）
	ExpiresAt    time.Time `json:"expires_at"`    // 过期时间
	CreatedAt    time.Time `json:"created_at"`
}

// PerAccountSyncManager 每账户独立goroutine的同步管理器
type PerAccountSyncManager struct {
	// 账户同步器映射
	accountSyncers map[uint]*AccountSyncer
	mu             sync.RWMutex

	// 取件轮询临时同步覆盖（纯内存）
	pickupOverrides   map[uint]*PickupOverride
	pickupOverridesMu sync.RWMutex

	// 配置监控
	configMonitor *FastConfigMonitor

	// 控制和生命周期
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	// 并发控制
	semaphore       chan struct{} // 控制后台/手动同步网络请求数量
	pickupSemaphore chan struct{} // 取件轮询专用并发位，避免被后台批量同步饿死

	// 服务依赖
	syncConfigRepo   *repository.SyncConfigRepository
	emailRepo        *repository.EmailRepository
	mailboxRepo      *repository.MailboxRepository
	emailAccountRepo *repository.EmailAccountRepository
	fetcherService   *FetcherService
	ingestService    *EmailIngestService
	activityLogger   *ActivityLogger
	businessLog      *BusinessLogPipeline
	logger           *utils.Logger

	// 通知系统
	notificationService *EmailNotificationService

	// 事件总线 - 用于触发器系统
	eventBus *EventBus

	// 监控统计
	stats PerAccountSyncStats
}

// AccountSyncer 单个账户的同步器
type AccountSyncer struct {
	AccountID    uint
	Config       models.EmailAccountSyncConfig
	LastSyncTime time.Time

	// 定时器
	timer   *time.Timer
	timerMu sync.Mutex

	// 控制
	ctx    context.Context
	cancel context.CancelFunc

	// 管理器引用
	manager *PerAccountSyncManager
	logger  *utils.Logger

	// 状态
	isRunning bool
	mu        sync.RWMutex
	syncMu    sync.Mutex

	// 统计
	syncCount     int64
	errorCount    int64
	lastError     error
	lastErrorTime time.Time
}

// PerAccountSyncStats 管理器统计信息
type PerAccountSyncStats struct {
	ActiveSyncers     int64     `json:"active_syncers"`
	TotalSyncers      int64     `json:"total_syncers"`
	TotalSyncs        int64     `json:"total_syncs"`
	TotalErrors       int64     `json:"total_errors"`
	ConcurrentLimit   int       `json:"concurrent_limit"`
	PickupLimit       int       `json:"pickup_limit"`
	CurrentConcurrent int64     `json:"current_concurrent"`
	CurrentPickup     int64     `json:"current_pickup"`
	StartTime         time.Time `json:"start_time"`
}

// NewPerAccountSyncManager 创建每账户同步管理器
func NewPerAccountSyncManager(
	syncConfigRepo *repository.SyncConfigRepository,
	emailRepo *repository.EmailRepository,
	mailboxRepo *repository.MailboxRepository,
	emailAccountRepo *repository.EmailAccountRepository,
	fetcherService *FetcherService,
	notificationService *EmailNotificationService,
	eventBus *EventBus,
	subscriptionManager *SubscriptionManager,
) *PerAccountSyncManager {
	ctx, cancel := context.WithCancel(context.Background())

	// 根据系统资源计算并发限制
	concurrentLimit := calculateConcurrentLimit()
	pickupLimit := calculatePickupConcurrentLimit(concurrentLimit)

	manager := &PerAccountSyncManager{
		accountSyncers:      make(map[uint]*AccountSyncer),
		pickupOverrides:     make(map[uint]*PickupOverride),
		ctx:                 ctx,
		cancel:              cancel,
		semaphore:           make(chan struct{}, concurrentLimit),
		pickupSemaphore:     make(chan struct{}, pickupLimit),
		syncConfigRepo:      syncConfigRepo,
		emailRepo:           emailRepo,
		mailboxRepo:         mailboxRepo,
		emailAccountRepo:    emailAccountRepo,
		fetcherService:      fetcherService,
		ingestService:       NewEmailIngestService(emailRepo, emailAccountRepo, notificationService, eventBus, subscriptionManager),
		activityLogger:      GetActivityLogger(),
		logger:              utils.NewLogger("PerAccountSyncManager"),
		notificationService: notificationService,
		eventBus:            eventBus,
		stats: PerAccountSyncStats{
			StartTime:       time.Now(),
			ConcurrentLimit: concurrentLimit,
			PickupLimit:     pickupLimit,
		},
	}

	// 创建配置监控器
	manager.configMonitor = NewFastConfigMonitor(syncConfigRepo, manager)

	return manager
}

// SetEmailIngestService replaces the default ingest pipeline with the app-wide instance.
func (m *PerAccountSyncManager) SetEmailIngestService(ingestService *EmailIngestService) {
	if ingestService != nil {
		m.ingestService = ingestService
	}
}

func (m *PerAccountSyncManager) SetBusinessLogPipeline(pipeline *BusinessLogPipeline) {
	m.businessLog = pipeline
}

// calculateConcurrentLimit 根据系统资源计算并发限制
func calculateConcurrentLimit() int {
	cpuCount := runtime.NumCPU()

	// 基础策略：每个CPU核心允许10个并发请求
	limit := cpuCount * 10

	// 最小20，最大200
	if limit < 20 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}

	log.Printf("[PerAccountSyncManager] Calculated concurrent limit: %d (CPU cores: %d)", limit, cpuCount)
	return limit
}

func calculatePickupConcurrentLimit(backgroundLimit int) int {
	limit := backgroundLimit / 4
	if limit < 5 {
		limit = 5
	}
	if limit > 20 {
		limit = 20
	}

	log.Printf("[PerAccountSyncManager] Reserved pickup concurrent limit: %d", limit)
	return limit
}

// Start 启动管理器
func (m *PerAccountSyncManager) Start() error {
	m.logger.Info("Starting per-account sync manager")

	// 启动配置监控器
	if err := m.configMonitor.Start(); err != nil {
		return fmt.Errorf("failed to start config monitor: %w", err)
	}

	// 启动配置变更处理器
	m.wg.Add(1)
	go m.handleConfigChanges()

	// 启动统计更新器
	m.wg.Add(1)
	go m.updateStatsRoutine()

	// 启动清理例程
	m.wg.Add(1)
	go m.cleanupRoutine()

	// 启动 pickup 覆盖清理例程。它只处理内存态覆盖，避免失败注册后的高频同步器
	// 等到通用 5 分钟清理周期才释放。
	m.wg.Add(1)
	go m.pickupOverrideCleanupRoutine()

	// 加载现有配置并启动AccountSyncer
	if err := m.loadExistingConfigs(); err != nil {
		m.logger.Error("Failed to load existing configs: %v", err)
		return err
	}

	m.logger.Info("Per-account sync manager started with %d active syncers", len(m.accountSyncers))
	return nil
}

// Stop 停止管理器
func (m *PerAccountSyncManager) Stop() {
	m.logger.Info("Stopping per-account sync manager")

	// 取消上下文
	m.cancel()

	// 停止配置监控器
	m.configMonitor.Stop()

	// 停止所有AccountSyncer
	m.mu.Lock()
	for accountID, syncer := range m.accountSyncers {
		m.logger.Debug("Stopping syncer for account %d", accountID)
		syncer.Stop()
	}
	m.accountSyncers = make(map[uint]*AccountSyncer) // 清空映射
	m.mu.Unlock()

	// 等待所有goroutine退出
	m.wg.Wait()

	m.logger.Info("Per-account sync manager stopped")
}

// loadExistingConfigs 加载现有配置
func (m *PerAccountSyncManager) loadExistingConfigs() error {
	m.logger.Debug("Starting to load existing sync configurations from database")
	configs, err := m.syncConfigRepo.GetEnabledConfigsWithAccounts()
	if err != nil {
		m.logger.Error("Failed to query enabled configs from database: %v", err)
		return fmt.Errorf("failed to get enabled configs: %w", err)
	}

	m.logger.Debug("Found %d enabled sync configurations in database", len(configs))

	successCount := 0
	for _, config := range configs {
		m.logger.Debug("Processing config for account %d: email=%s, interval=%ds, enabled=%v",
			config.AccountID, config.Account.EmailAddress, config.SyncInterval, config.EnableAutoSync)

		if err := m.startAccountSyncer(&config); err != nil {
			m.logger.Error("Failed to start syncer for account %d (%s): %v",
				config.AccountID, config.Account.EmailAddress, err)
			// 继续处理其他账户
		} else {
			successCount++
			m.logger.Debug("Successfully started syncer for account %d (%s)",
				config.AccountID, config.Account.EmailAddress)
		}
	}

	m.logger.Info("Completed loading configs: %d/%d syncers started successfully", successCount, len(configs))
	return nil
}

// handleConfigChanges 处理配置变更
func (m *PerAccountSyncManager) handleConfigChanges() {
	defer m.wg.Done()

	for {
		select {
		case <-m.ctx.Done():
			return

		case event, ok := <-m.configMonitor.changes:
			if !ok {
				return
			}
			m.processConfigChange(event)
		}
	}
}

// processConfigChange 处理单个配置变更事件
func (m *PerAccountSyncManager) processConfigChange(event ConfigChangeEvent) {
	m.logger.Info("Processing config change: %s for account %d", event.Type, event.AccountID)

	switch event.Type {
	case ConfigAdded, ConfigEnabled:
		if event.NewConfig != nil {
			m.startAccountSyncer(event.NewConfig)
		}

	case ConfigDeleted, ConfigDisabled:
		m.stopAccountSyncer(event.AccountID)

	case ConfigUpdated:
		if event.NewConfig != nil {
			m.updateAccountSyncer(event.AccountID, event.NewConfig)
		}
	}
}

// startAccountSyncer 启动账户同步器
func (m *PerAccountSyncManager) startAccountSyncer(config *models.EmailAccountSyncConfig) error {
	m.logger.Debug("Starting AccountSyncer for account %d", config.AccountID)

	if !config.EnableAutoSync {
		// 检查是否有取件轮询覆盖
		m.pickupOverridesMu.RLock()
		_, hasPickupOverride := m.pickupOverrides[config.AccountID]
		m.pickupOverridesMu.RUnlock()

		if !hasPickupOverride {
			m.logger.Debug("Auto-sync disabled for account %d and no pickup override, skipping", config.AccountID)
			return nil
		}
		m.logger.Debug("Auto-sync disabled for account %d but pickup override exists, starting syncer", config.AccountID)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// 检查是否已存在
	if _, exists := m.accountSyncers[config.AccountID]; exists {
		m.logger.Debug("AccountSyncer already exists for account %d", config.AccountID)
		return nil
	}

	// 创建新的AccountSyncer
	ctx, cancel := context.WithCancel(m.ctx)
	syncer := &AccountSyncer{
		AccountID: config.AccountID,
		Config:    *config,
		ctx:       ctx,
		cancel:    cancel,
		manager:   m,
		logger:    utils.NewLogger(fmt.Sprintf("AccountSyncer-%d", config.AccountID)),
	}

	// 如果有上次同步时间，使用它；否则设置为较早时间触发立即同步
	if config.LastSyncTime != nil {
		syncer.LastSyncTime = *config.LastSyncTime
		m.logger.Debug("Using existing LastSyncTime for account %d: %v", config.AccountID, *config.LastSyncTime)
	} else {
		syncer.LastSyncTime = time.Now().Add(-24 * time.Hour)
		m.logger.Debug("No LastSyncTime for account %d, setting to 24 hours ago for immediate sync", config.AccountID)
	}

	m.accountSyncers[config.AccountID] = syncer

	// 启动goroutine
	m.wg.Add(1)
	go syncer.Run()

	atomic.AddInt64(&m.stats.TotalSyncers, 1)
	atomic.AddInt64(&m.stats.ActiveSyncers, 1)

	m.logger.Debug("Started AccountSyncer for account %d (email: %s, interval: %ds)",
		config.AccountID, config.Account.EmailAddress, config.SyncInterval)

	return nil
}

// stopAccountSyncer 停止账户同步器
func (m *PerAccountSyncManager) stopAccountSyncer(accountID uint) {
	m.mu.Lock()
	defer m.mu.Unlock()

	syncer, exists := m.accountSyncers[accountID]
	if !exists {
		return
	}

	// 停止同步器
	syncer.Stop()
	delete(m.accountSyncers, accountID)

	atomic.AddInt64(&m.stats.ActiveSyncers, -1)

	m.logger.Info("Stopped AccountSyncer for account %d", accountID)
}

// updateAccountSyncer 更新账户同步器
func (m *PerAccountSyncManager) updateAccountSyncer(accountID uint, newConfig *models.EmailAccountSyncConfig) {
	m.mu.RLock()
	syncer, exists := m.accountSyncers[accountID]
	m.mu.RUnlock()

	if !exists {
		// 如果不存在但配置启用了，创建新的
		if newConfig.EnableAutoSync {
			m.startAccountSyncer(newConfig)
		}
		return
	}

	// 更新现有同步器的配置
	syncer.UpdateConfig(*newConfig)
}

// updateStatsRoutine 更新统计信息
func (m *PerAccountSyncManager) updateStatsRoutine() {
	defer m.wg.Done()

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-m.ctx.Done():
			return

		case <-ticker.C:
			m.updateStats()
		}
	}
}

// updateStats 更新统计信息
func (m *PerAccountSyncManager) updateStats() {
	backgroundConcurrent := 0
	if m.semaphore != nil {
		backgroundConcurrent = len(m.semaphore)
	}
	pickupConcurrent := 0
	if m.pickupSemaphore != nil {
		pickupConcurrent = len(m.pickupSemaphore)
	}
	atomic.StoreInt64(&m.stats.CurrentConcurrent, int64(backgroundConcurrent+pickupConcurrent))
	atomic.StoreInt64(&m.stats.CurrentPickup, int64(pickupConcurrent))

	// 计算总同步次数和错误次数
	var totalSyncs, totalErrors int64
	m.mu.RLock()
	for _, syncer := range m.accountSyncers {
		syncer.mu.RLock()
		totalSyncs += atomic.LoadInt64(&syncer.syncCount)
		totalErrors += atomic.LoadInt64(&syncer.errorCount)
		syncer.mu.RUnlock()
	}
	m.mu.RUnlock()

	atomic.StoreInt64(&m.stats.TotalSyncs, totalSyncs)
	atomic.StoreInt64(&m.stats.TotalErrors, totalErrors)
}

// cleanupRoutine 清理例程
func (m *PerAccountSyncManager) cleanupRoutine() {
	defer m.wg.Done()

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-m.ctx.Done():
			return

		case <-ticker.C:
			// Cleanup inactive in-memory syncers
			m.cleanupInactiveSyncers()

			// Cleanup expired temporary configs from database
			affectedIDs, err := m.syncConfigRepo.DeleteExpiredTemporaryConfigs()
			if err != nil {
				m.logger.Error("Failed to delete expired temporary configs: %v", err)
			} else if len(affectedIDs) > 0 {
				m.logger.Info("Deleted expired temporary configs for %d accounts: %v", len(affectedIDs), affectedIDs)
				// Refresh subscriptions for affected accounts to revert to original config (or stop if disabled)
				for _, accountID := range affectedIDs {
					// Get effective config (will be original user/global config now)
					config, err := m.syncConfigRepo.GetEffectiveSyncConfig(accountID)
					if err != nil {
						m.logger.Error("Failed to get effective config for account %d after expiration: %v", accountID, err)
						continue
					}
					// Update subscription
					if err := m.UpdateSubscription(accountID, config); err != nil {
						m.logger.Error("Failed to update subscription for account %d after expiration: %v", accountID, err)
					}
				}
			}
		}
	}
}

func (m *PerAccountSyncManager) pickupOverrideCleanupRoutine() {
	defer m.wg.Done()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-m.ctx.Done():
			return

		case <-ticker.C:
			m.cleanupExpiredPickupOverrides()
		}
	}
}

// cleanupInactiveSyncers 清理不活跃的同步器
func (m *PerAccountSyncManager) cleanupInactiveSyncers() {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	for accountID, syncer := range m.accountSyncers {
		syncer.mu.RLock()
		lastSync := syncer.LastSyncTime
		isRunning := syncer.isRunning
		syncer.mu.RUnlock()

		// 如果同步器超过1小时没有活动且不在运行，检查配置是否仍然有效
		if !isRunning && now.Sub(lastSync) > time.Hour {
			// 检查是否有活跃的取件轮询覆盖
			m.pickupOverridesMu.RLock()
			_, hasPickupOverride := m.pickupOverrides[accountID]
			m.pickupOverridesMu.RUnlock()

			if hasPickupOverride {
				continue // 有取件覆盖，不清理
			}

			// 检查数据库中的配置是否仍然启用
			config, err := m.syncConfigRepo.GetByAccountID(accountID)
			if err != nil || config == nil || !config.EnableAutoSync {
				m.logger.Info("Cleaning up inactive syncer for account %d", accountID)
				syncer.Stop()
				delete(m.accountSyncers, accountID)
				atomic.AddInt64(&m.stats.ActiveSyncers, -1)
			}
		}
	}
}

// GetStats 获取统计信息
func (m *PerAccountSyncManager) GetStats() PerAccountSyncStats {
	m.updateStats() // 强制更新一次
	return PerAccountSyncStats{
		ActiveSyncers:     atomic.LoadInt64(&m.stats.ActiveSyncers),
		TotalSyncers:      atomic.LoadInt64(&m.stats.TotalSyncers),
		TotalSyncs:        atomic.LoadInt64(&m.stats.TotalSyncs),
		TotalErrors:       atomic.LoadInt64(&m.stats.TotalErrors),
		ConcurrentLimit:   m.stats.ConcurrentLimit,
		PickupLimit:       m.stats.PickupLimit,
		CurrentConcurrent: atomic.LoadInt64(&m.stats.CurrentConcurrent),
		CurrentPickup:     atomic.LoadInt64(&m.stats.CurrentPickup),
		StartTime:         m.stats.StartTime,
	}
}

// SyncNowOptions 定义SyncNow的选项
type SyncNowOptions struct {
	CreateStrategy string // "none", "ensure", "force"
	SyncInterval   int    // 临时同步间隔（如果创建临时Sync需要用到）
	Source         EmailIngestSource
	Context        context.Context
}

// SyncNow 立即同步指定账户
func (m *PerAccountSyncManager) SyncNow(accountID uint, opts SyncNowOptions) (*SyncResult, error) {
	source := opts.Source
	if source == "" {
		source = EmailIngestSourceManualSync
	}

	m.mu.RLock()
	syncer, exists := m.accountSyncers[accountID]
	m.mu.RUnlock()

	// 1. 如果存在活跃的Syncer，且策略不是"force"，直接使用
	if exists && opts.CreateStrategy != "force" {
		m.logger.Debug("SyncNow: Using existing active syncer for account %d", accountID)
		return syncer.SyncNowWithContext(opts.Context, source)
	}

	// 2. 如果不存在，或者策略是"force"
	if !exists && (opts.CreateStrategy == "none" || opts.CreateStrategy == "") {
		return nil, fmt.Errorf("no active syncer for account %d", accountID)
	}

	if opts.CreateStrategy == "force" {
		m.logger.Info("SyncNow: Force creating ephemeral syncer for account %d (ignoring existing)", accountID)
	} else {
		m.logger.Info("SyncNow: Creating ephemeral syncer for account %d (Strategy: %s)", accountID, opts.CreateStrategy)
	}

	// 3. 创建临时Syncer
	// 获取账户配置
	config, err := m.syncConfigRepo.GetByAccountIDWithAccount(accountID)
	if err != nil {
		// 如果配置不存在，创建一个临时的默认配置对象
		if err == gorm.ErrRecordNotFound {
			m.logger.Warn("SyncNow: No config found for account %d, using default ephemeral config", accountID)
			// 获取账户信息
			account, err := m.emailAccountRepo.GetByID(accountID)
			if err != nil {
				return nil, fmt.Errorf("failed to get account %d: %w", accountID, err)
			}
			config = &models.EmailAccountSyncConfig{
				AccountID:      accountID,
				Account:        *account,
				EnableAutoSync: false,
				SyncInterval:   5, // Default
				SyncFolders:    models.StringSlice{"INBOX"},
			}
			if opts.SyncInterval > 0 {
				config.SyncInterval = opts.SyncInterval
			}
		} else {
			return nil, fmt.Errorf("failed to get sync config: %w", err)
		}
	}

	// 构造临时Syncer
	parentCtx := opts.Context
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	ctx, cancel := context.WithCancel(parentCtx)
	defer cancel() // 确保销毁

	ephemeralSyncer := &AccountSyncer{
		AccountID: accountID,
		Config:    *config,
		ctx:       ctx,
		cancel:    cancel,
		manager:   m,
		logger:    utils.NewLogger(fmt.Sprintf("EpheSyncer-%d", accountID)),
		isRunning: false, // 临时运行
	}

	// 设置临时参数
	if opts.SyncInterval > 0 {
		ephemeralSyncer.Config.SyncInterval = opts.SyncInterval
	}

	// 4. 执行同步
	// 直接调用SyncNow，它内部会调用doSync
	// 注意：doSync 不依赖 Run 循环，是安全的单次执行
	m.logger.Debug("SyncNow: Starting ephemeral sync execution")
	result, err := ephemeralSyncer.SyncNowWithContext(parentCtx, source)

	m.logger.Info("SyncNow: Ephemeral sync completed for account %d. Emails: %d, Error: %v",
		accountID, result.EmailsSynced, err)

	return result, err
}

// GetAccountSyncerStatus 获取账户同步器状态
func (m *PerAccountSyncManager) GetAccountSyncerStatus(accountID uint) (*AccountSyncerStatus, error) {
	m.mu.RLock()
	syncer, exists := m.accountSyncers[accountID]
	m.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("no active syncer for account %d", accountID)
	}

	return syncer.GetStatus(), nil
}

// GetAllAccountSyncerStatuses 获取所有账户同步器状态
func (m *PerAccountSyncManager) GetAllAccountSyncerStatuses() []AccountSyncerStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	statuses := make([]AccountSyncerStatus, 0, len(m.accountSyncers))
	for _, syncer := range m.accountSyncers {
		statuses = append(statuses, *syncer.GetStatus())
	}

	return statuses
}

// AccountSyncerStatus 账户同步器状态
type AccountSyncerStatus struct {
	AccountID     uint      `json:"account_id"`
	AccountEmail  string    `json:"account_email"`
	IsRunning     bool      `json:"is_running"`
	LastSyncTime  time.Time `json:"last_sync_time"`
	NextSyncTime  time.Time `json:"next_sync_time"`
	SyncInterval  int       `json:"sync_interval"`
	SyncCount     int64     `json:"sync_count"`
	ErrorCount    int64     `json:"error_count"`
	LastError     string    `json:"last_error,omitempty"`
	LastErrorTime time.Time `json:"last_error_time,omitempty"`
}

// ============= AccountSyncer 实现 =============

// Run 运行账户同步器
func (as *AccountSyncer) Run() {
	defer as.manager.wg.Done()

	as.mu.Lock()
	as.isRunning = true
	as.mu.Unlock()

	defer func() {
		as.mu.Lock()
		as.isRunning = false
		as.mu.Unlock()
		as.logger.Info("AccountSyncer stopped")
	}()

	as.logger.Debug("AccountSyncer started, calculating first sync time")

	// 计算首次同步时间
	nextSyncTime := as.calculateNextSyncTime()
	as.resetTimer(nextSyncTime)
	as.logger.Debug("First sync scheduled for %v", nextSyncTime)

	for {
		select {
		case <-as.ctx.Done():
			as.logger.Info("Received shutdown signal")
			return

		case <-as.timer.C:
			as.logger.Debug("Timer triggered, starting sync")
			// 执行同步
			as.performSync()

			// 重新计算下次同步时间
			nextSyncTime := as.calculateNextSyncTime()
			as.resetTimer(nextSyncTime)
			as.logger.Debug("Next sync scheduled for %v", nextSyncTime)
		}
	}
}

// performSync 执行同步
func (as *AccountSyncer) performSync() {
	as.logger.Debug("Preparing to perform sync")
	start := time.Now()

	as.syncMu.Lock()
	defer as.syncMu.Unlock()

	as.mu.RLock()
	recentSync := !as.LastSyncTime.IsZero() && time.Since(as.LastSyncTime) < 2*time.Second
	as.mu.RUnlock()
	if recentSync {
		as.logger.Debug("Skipping timer sync because a sync just completed")
		return
	}

	releaseSlot, err := as.acquireSyncSlot(EmailIngestSourceAutoSync, 5*time.Second)
	if err != nil {
		as.logger.Warn("%v, skipping this cycle", err)
		return
	}
	defer releaseSlot()

	atomic.AddInt64(&as.syncCount, 1)
	atomic.AddInt64(&as.manager.stats.TotalSyncs, 1)

	as.logger.Debug("Starting sync cycle")

	// 执行实际同步
	_, err = as.doSync(start, EmailIngestSourceAutoSync)

	as.mu.Lock()
	as.LastSyncTime = time.Now()
	if err != nil {
		atomic.AddInt64(&as.errorCount, 1)
		atomic.AddInt64(&as.manager.stats.TotalErrors, 1)
		as.lastError = err
		as.lastErrorTime = time.Now()
		as.logger.Error("Sync cycle failed: %v", err)

		// 智能错误处理：分析错误类型并决定是否自动禁用
		as.handleSyncError(err)
	} else {
		as.lastError = nil
		// 同步成功，重置错误计数
		as.resetErrorStatus()
		// 日志已在doSync中输出
	}
	as.mu.Unlock()
}

// doSync 执行实际的邮件同步
func (as *AccountSyncer) doSync(startTime time.Time, source EmailIngestSource) (syncedEmails []models.Email, err error) {
	return as.doSyncWithContext(context.Background(), startTime, source)
}

func (as *AccountSyncer) doSyncWithContext(parentCtx context.Context, startTime time.Time, source EmailIngestSource) (syncedEmails []models.Email, err error) {
	as.logger.Debug("Executing doSync")
	source = normalizeEmailIngestSource(source)
	recordSync := RuntimeMetrics().BeginSync(source)
	activeSync := RuntimeMetrics().BeginActiveOperation("sync", source, "account_sync", as.AccountID, as.Config.Account.EmailAddress, "create_sync_run")
	syncRun := as.createSyncRun(startTime, source)
	emailsFetched := 0
	newEmailCount := 0
	accountEmail := as.Config.Account.EmailAddress
	defer func() {
		as.finishSyncRun(syncRun, emailsFetched, newEmailCount, err)
		recordSync(emailsFetched, newEmailCount, err)
		activeSync.Finish(err)
		as.recordSyncBusinessLog(startTime, source, syncRun, accountEmail, emailsFetched, newEmailCount, err)
	}()

	baseCtx, baseCancel := mergeSyncContexts(parentCtx, as.ctx)
	defer baseCancel()
	ctx, cancel := context.WithTimeout(baseCtx, 60*time.Second)
	defer cancel()

	// 获取账户信息
	activeSync.Stage("get_account")
	as.logger.Debug("Getting account details")
	account, err := as.getAccount()
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}
	accountEmail = account.EmailAddress
	as.logger.Debug("Account details obtained for: %s", account.EmailAddress)

	// 计算同步时间窗口
	activeSync.Stage("read_sync_cursor")
	var startDate *time.Time
	endDate := time.Now()

	lastSyncEndTime := as.Config.LastSyncEndTime
	cursor, cursorErr := as.manager.syncConfigRepo.GetAccountSyncCursor(as.AccountID, models.SyncCursorProviderGeneric)
	if cursorErr == nil && cursor.LastSyncEndTime != nil {
		lastSyncEndTime = cursor.LastSyncEndTime
		as.logger.Debug("Using SyncCursor LastSyncEndTime for account %d: %v", as.AccountID, *cursor.LastSyncEndTime)
	} else if cursorErr != nil && cursorErr != gorm.ErrRecordNotFound {
		as.logger.Warn("Failed to read sync cursor for account %d: %v", as.AccountID, cursorErr)
	}

	if lastSyncEndTime != nil {
		// 使用上次同步结束时间减5分钟作为开始时间
		bufferTime := lastSyncEndTime.Add(-5 * time.Minute)
		startDate = &bufferTime
		as.logger.Debug("Sync window started from LastSyncEndTime with buffer: %v", startDate)
	} else if as.LastSyncTime.After(time.Time{}) {
		// 使用上次同步时间减5分钟
		bufferTime := as.LastSyncTime.Add(-5 * time.Minute)
		startDate = &bufferTime
		as.logger.Debug("Sync window started from LastSyncTime with buffer: %v", startDate)
	} else {
		// 首次同步，获取最近24小时的邮件
		bufferTime := time.Now().Add(-24 * time.Hour)
		startDate = &bufferTime
		as.logger.Debug("First sync, window started from 24 hours ago: %v", startDate)
	}
	as.logger.Debug("Sync window ends now: %v", endDate)

	// 创建获取选项
	options := FetchEmailsOptions{
		Context:         ctx,
		Folders:         as.Config.SyncFolders,
		StartDate:       startDate,
		EndDate:         &endDate,
		FetchFromServer: true,
		IncludeBody:     true,
		Source:          source,
	}
	as.logger.Debug("Fetching emails with options: Folders=%v, StartDate=%v, EndDate=%v", options.Folders, options.StartDate, options.EndDate)

	// 获取邮件
	activeSync.Stage("fetch_from_server")
	emails, err := as.manager.fetcherService.FetchEmailsFromMultipleMailboxes(*account, options)
	if err != nil {
		as.logger.Error("Failed to fetch emails: %v", err)
		return nil, fmt.Errorf("failed to fetch emails: %w", err)
	}
	emailsFetched = len(emails)
	as.logger.Debug("Fetched %d emails from server", len(emails))

	// 处理邮件
	activeSync.Stage("process_emails")
	newEmails, err := as.processEmails(emails, source)
	if err != nil {
		as.logger.Error("Failed to process emails: %v", err)
		return nil, fmt.Errorf("failed to process emails: %w", err)
	}
	newEmailCount = len(newEmails)
	as.logger.Debug("Processed %d new emails", newEmailCount)

	// 更新同步配置
	activeSync.Stage("update_sync_cursor")
	if err := as.updateSyncConfig(endDate, newEmailCount > 0); err != nil {
		as.logger.Warn("Failed to update sync config: %v", err)
	}

	// 注意：每封邮件的通知已在 processEmails 中单独发送

	// 输出合并后的同步完成日志
	historyId := "unknown"
	if as.Config.LastHistoryID != "" {
		historyId = as.Config.LastHistoryID
	}
	duration := time.Since(startTime)
	as.logger.Info("email: %s, historyId: %s, newEmails: %d, time: %v",
		account.EmailAddress, historyId, newEmailCount, duration)

	return newEmails, nil
}

func mergeSyncContexts(parentCtx context.Context, syncerCtx context.Context) (context.Context, context.CancelFunc) {
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	if syncerCtx == nil {
		return context.WithCancel(parentCtx)
	}
	ctx, cancel := context.WithCancel(parentCtx)
	go func() {
		select {
		case <-syncerCtx.Done():
			cancel()
		case <-ctx.Done():
		}
	}()
	return ctx, cancel
}

func (as *AccountSyncer) recordSyncBusinessLog(startTime time.Time, source EmailIngestSource, run *models.SyncRun, accountEmail string, emailsFetched int, newEmailCount int, syncErr error) {
	if as.manager == nil || as.manager.businessLog == nil {
		return
	}
	finishedAt := time.Now()
	status := models.BusinessLogStatusSuccess
	result := "success"
	errorMessage := ""
	if syncErr != nil {
		status = models.BusinessLogStatusFailed
		result = "failed"
		errorMessage = syncErr.Error()
	}
	runID := ""
	if run != nil {
		runID = fmt.Sprintf("sync_run_%d", run.ID)
	}
	operationType := models.BusinessLogOperationAutomatic
	actorType := models.BusinessLogActorSystem
	if source == EmailIngestSourceAutoSync {
		operationType = models.BusinessLogOperationScheduled
		actorType = models.BusinessLogActorScheduler
	} else if source == EmailIngestSourceManualSync {
		operationType = models.BusinessLogOperationManual
	}
	event := BusinessLogEvent{
		OrgID:         as.Config.Account.OrgID,
		OperationType: operationType,
		ActorType:     actorType,
		ActorName:     string(source),
		Module:        "sync",
		Action:        string(source),
		EntityType:    "email_account",
		EntityID:      fmt.Sprintf("%d", as.AccountID),
		EntityName:    accountEmail,
		Title:         "邮箱同步",
		Summary:       fmt.Sprintf("账户 %s 同步完成，拉取 %d 封，新入库 %d 封", accountEmail, emailsFetched, newEmailCount),
		Status:        status,
		Result:        result,
		StartedAt:     startTime,
		FinishedAt:    &finishedAt,
		DurationMS:    finishedAt.Sub(startTime).Milliseconds(),
		RunID:         runID,
		ErrorMessage:  errorMessage,
		Details: map[string]interface{}{
			"account_id":     as.AccountID,
			"account_email":  accountEmail,
			"source":         string(source),
			"emails_fetched": emailsFetched,
			"new_emails":     newEmailCount,
			"sync_run_id":    runID,
		},
	}
	processBusinessLogAsync(as.manager.businessLog, as.logger, "sync run", event)
}

// getAccount 获取账户信息
func (as *AccountSyncer) getAccount() (*models.EmailAccount, error) {
	// Prefer the persisted sync config path for normal auto-sync accounts.
	config, err := as.manager.syncConfigRepo.GetByAccountIDWithAccount(as.AccountID)
	if err == nil {
		if config.Account.ID != 0 {
			as.mu.Lock()
			as.Config.Account = config.Account
			as.mu.Unlock()
			return &config.Account, nil
		}
		as.logger.Warn("Sync config for account %d has no preloaded account; falling back to email account lookup", as.AccountID)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	account, accountErr := as.manager.emailAccountRepo.GetByID(as.AccountID)
	if accountErr != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("sync config missing and failed to get account: %w", accountErr)
		}
		return nil, accountErr
	}

	as.mu.Lock()
	as.Config.Account = *account
	as.mu.Unlock()
	if errors.Is(err, gorm.ErrRecordNotFound) {
		as.logger.Warn("Sync config missing for account %d; using email account fallback for temporary sync", as.AccountID)
	}
	return account, nil
}

// processEmails 处理邮件
func (as *AccountSyncer) processEmails(emails []models.Email, source EmailIngestSource) ([]models.Email, error) {
	return as.manager.ingestService.IngestEmails(emails, EmailIngestOptions{
		Source:       source,
		AccountEmail: as.Config.Account.EmailAddress,
		Metadata: map[string]interface{}{
			"sync_manager": "per_account",
			"account_id":   as.AccountID,
		},
	})
}

func (as *AccountSyncer) createSyncRun(startTime time.Time, source EmailIngestSource) *models.SyncRun {
	if as.manager.syncConfigRepo == nil {
		return nil
	}
	run := &models.SyncRun{
		AccountID: as.AccountID,
		Source:    string(source),
		Status:    models.SyncRunStatusRunning,
		StartedAt: startTime,
		Metadata: models.JSONMap{
			"sync_manager": "per_account",
		},
	}
	if err := as.manager.syncConfigRepo.CreateSyncRun(run); err != nil {
		as.logger.Warn("Failed to create sync run: %v", err)
		return nil
	}
	return run
}

func (as *AccountSyncer) finishSyncRun(run *models.SyncRun, emailsFetched int, newEmails int, syncErr error) {
	if run == nil || as.manager.syncConfigRepo == nil {
		return
	}
	status := models.SyncRunStatusSuccess
	if syncErr != nil {
		status = models.SyncRunStatusFailed
	}
	if err := as.manager.syncConfigRepo.FinishSyncRun(run.ID, status, emailsFetched, newEmails, syncErr); err != nil {
		as.logger.Warn("Failed to finish sync run %d: %v", run.ID, err)
	}
}

// updateSyncConfig 更新同步配置
func (as *AccountSyncer) updateSyncConfig(endTime time.Time, hasNewEmails bool) error {
	// CRITICAL FIX: 重新获取config确保拿到最新的Gmail History ID
	config, err := as.manager.syncConfigRepo.GetByAccountID(as.AccountID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			now := time.Now()
			if err := as.manager.syncConfigRepo.UpsertAccountSyncCursorTimes(as.AccountID, models.SyncCursorProviderGeneric, &now, &endTime); err != nil {
				return fmt.Errorf("failed to update sync cursor without sync config: %w", err)
			}
			as.mu.Lock()
			as.Config.LastSyncTime = &now
			as.Config.LastSyncEndTime = &endTime
			as.Config.SyncStatus = models.SyncStatusIdle
			as.mu.Unlock()
			as.logger.Debug("Updated sync cursor for account %d without persistent sync config", as.AccountID)
			return nil
		}
		return err
	}

	now := time.Now()
	// 只更新同步时间和状态，不要覆盖LastHistoryID
	config.LastSyncTime = &now
	config.LastSyncEndTime = &endTime
	config.SyncStatus = models.SyncStatusIdle
	// 注意：故意不修改config.LastHistoryID，保持Gmail API的更新

	as.logger.Debug("Updating sync config - preserving History ID: %s", config.LastHistoryID)
	if err := as.manager.syncConfigRepo.CreateOrUpdate(config); err != nil {
		return err
	}
	if err := as.manager.syncConfigRepo.UpsertAccountSyncCursorTimes(as.AccountID, models.SyncCursorProviderGeneric, config.LastSyncTime, config.LastSyncEndTime); err != nil {
		return fmt.Errorf("failed to update sync cursor: %w", err)
	}

	as.mu.Lock()
	as.Config.LastSyncTime = config.LastSyncTime
	as.Config.LastSyncEndTime = config.LastSyncEndTime
	as.Config.SyncStatus = config.SyncStatus
	as.Config.LastHistoryID = config.LastHistoryID
	as.mu.Unlock()

	return nil
}

// notifyNewEmails 发送新邮件通知
func (as *AccountSyncer) notifyNewEmails(count int, emailAddress string) {
	notification := EmailNotification{
		Type:         "new_email",
		AccountID:    as.AccountID,
		AccountEmail: emailAddress,
		EmailCount:   count,
		Timestamp:    time.Now(),
	}

	as.manager.notificationService.BroadcastNotification(notification)
}

// calculateNextSyncTime 计算下次同步时间
func (as *AccountSyncer) calculateNextSyncTime() time.Time {
	as.mu.RLock()
	lastSync := as.LastSyncTime
	intervalSeconds := as.Config.SyncInterval
	as.mu.RUnlock()

	if intervalSeconds <= 0 {
		as.logger.Warn("Sync interval is %d, defaulting to 300 seconds", intervalSeconds)
		intervalSeconds = 300
	}
	interval := time.Duration(intervalSeconds) * time.Second

	// 添加随机抖动，避免雷群效应 (10% of interval)
	jitter := time.Duration(rand.Intn(int(interval / 10)))
	if jitter <= 0 {
		jitter = 1 * time.Second
	}

	nextSync := lastSync.Add(interval + jitter)
	as.logger.Debug("Calculated next sync: LastSync=%v, Interval=%v, Jitter=%v, NextSync=%v", lastSync, interval, jitter, nextSync)

	// 如果已经过期，稍后同步 (1-10秒内)
	if nextSync.Before(time.Now()) {
		immediateNext := time.Now().Add(time.Duration(rand.Intn(10)+1) * time.Second)
		as.logger.Debug("Scheduled next sync was in the past, rescheduling for immediate execution at %v", immediateNext)
		return immediateNext
	}

	return nextSync
}

// resetTimer 重置定时器
func (as *AccountSyncer) resetTimer(nextTime time.Time) {
	as.timerMu.Lock()
	defer as.timerMu.Unlock()

	if as.timer != nil {
		as.timer.Stop()
	}

	duration := time.Until(nextTime)
	if duration < 0 {
		as.logger.Warn("Calculated sync duration is negative (%v), defaulting to 1 second", duration)
		duration = 1 * time.Second
	}

	as.logger.Debug("Resetting sync timer to trigger in %v (at %v)", duration, nextTime)
	as.timer = time.NewTimer(duration)
}

// UpdateConfig 更新配置
func (as *AccountSyncer) UpdateConfig(newConfig models.EmailAccountSyncConfig) {
	as.mu.Lock()
	oldInterval := as.Config.SyncInterval
	as.Config = newConfig
	intervalChanged := oldInterval != newConfig.SyncInterval
	as.mu.Unlock()

	// 如果同步间隔改变，重置定时器
	if intervalChanged {
		nextSync := as.calculateNextSyncTime()
		as.resetTimer(nextSync)

		as.manager.logger.Info("Updated sync interval for account %d from %ds to %ds",
			as.AccountID, oldInterval, newConfig.SyncInterval)
	}
}

// ApplyPickupOverride applies a temporary pickup sync interval without persisting config changes.
func (as *AccountSyncer) ApplyPickupOverride(syncInterval int) {
	if syncInterval <= 0 {
		syncInterval = 5
	}

	as.mu.Lock()
	as.Config.EnableAutoSync = true
	as.Config.SyncInterval = syncInterval
	if len(as.Config.SyncFolders) == 0 {
		as.Config.SyncFolders = models.StringSlice{"INBOX"}
	}
	as.LastSyncTime = time.Now().Add(-time.Duration(syncInterval+1) * time.Second)
	as.mu.Unlock()

	as.resetTimer(time.Now().Add(1 * time.Second))
}

// Stop 停止同步器
func (as *AccountSyncer) Stop() {
	as.cancel()

	as.timerMu.Lock()
	if as.timer != nil {
		as.timer.Stop()
	}
	as.timerMu.Unlock()
}

func (as *AccountSyncer) acquireSyncSlot(source EmailIngestSource, timeout time.Duration) (func(), error) {
	return as.acquireSyncSlotWithContext(context.Background(), source, timeout)
}

func (as *AccountSyncer) acquireSyncSlotWithContext(ctx context.Context, source EmailIngestSource, timeout time.Duration) (func(), error) {
	source = normalizeEmailIngestSource(source)
	slotName := "sync semaphore"
	slot := as.manager.semaphore
	if source == EmailIngestSourcePickup && as.manager.pickupSemaphore != nil {
		slotName = "pickup semaphore"
		slot = as.manager.pickupSemaphore
	}
	if slot == nil {
		return nil, fmt.Errorf("%s is not initialized", slotName)
	}
	if ctx == nil {
		ctx = context.Background()
	}

	waitStart := time.Now()
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case slot <- struct{}{}:
		RuntimeMetrics().RecordSyncSlotWait(source, time.Since(waitStart), nil)
		as.logger.Debug("%s acquired", slotName)
		return func() {
			<-slot
			as.logger.Debug("%s released", slotName)
		}, nil
	case <-ctx.Done():
		err := fmt.Errorf("failed to acquire %s: %w", slotName, ctx.Err())
		RuntimeMetrics().RecordSyncSlotWait(source, time.Since(waitStart), err)
		return nil, err
	case <-timer.C:
		err := fmt.Errorf("failed to acquire %s", slotName)
		RuntimeMetrics().RecordSyncSlotWait(source, time.Since(waitStart), err)
		return nil, err
	}
}

// SyncNow 立即同步
func (as *AccountSyncer) SyncNow(source EmailIngestSource) (*SyncResult, error) {
	return as.SyncNowWithContext(context.Background(), source)
}

func (as *AccountSyncer) SyncNowWithContext(ctx context.Context, source EmailIngestSource) (*SyncResult, error) {
	start := time.Now()
	source = normalizeEmailIngestSource(source)
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return &SyncResult{
			Duration: time.Since(start),
			Error:    err,
		}, err
	}

	if source == EmailIngestSourcePickup {
		if !as.syncMu.TryLock() {
			err := fmt.Errorf("sync already running for account %d", as.AccountID)
			as.logger.Debug(err.Error())
			return &SyncResult{
				Duration: time.Since(start),
				Error:    err,
			}, err
		}
	} else {
		as.syncMu.Lock()
	}
	defer as.syncMu.Unlock()

	slotTimeout := 5 * time.Second
	if source == EmailIngestSourcePickup {
		slotTimeout = 10 * time.Second
	}
	releaseSlot, err := as.acquireSyncSlotWithContext(ctx, source, slotTimeout)
	if err != nil {
		as.logger.Warn(err.Error())
		return &SyncResult{
			Duration: time.Since(start),
			Error:    err,
		}, err
	}
	defer releaseSlot()

	atomic.AddInt64(&as.syncCount, 1)
	atomic.AddInt64(&as.manager.stats.TotalSyncs, 1)

	emails, err := as.doSyncWithContext(ctx, start, source)

	as.mu.Lock()
	as.LastSyncTime = time.Now()
	if err != nil {
		atomic.AddInt64(&as.errorCount, 1)
		atomic.AddInt64(&as.manager.stats.TotalErrors, 1)
		as.lastError = err
		as.lastErrorTime = time.Now()
		as.logger.Error("Immediate sync failed: %v", err)
		as.handleSyncError(err)
	} else {
		as.lastError = nil
		as.resetErrorStatus()
	}
	as.mu.Unlock()

	result := &SyncResult{
		EmailsSynced: len(emails),
		SyncedEmails: emails,
		Duration:     time.Since(start),
		Error:        err,
	}

	return result, nil
}

// GetStatus 获取状态
func (as *AccountSyncer) GetStatus() *AccountSyncerStatus {
	as.mu.RLock()
	defer as.mu.RUnlock()

	var lastErrorStr string
	if as.lastError != nil {
		lastErrorStr = as.lastError.Error()
	}

	nextSyncTime := as.calculateNextSyncTime()

	return &AccountSyncerStatus{
		AccountID:     as.AccountID,
		AccountEmail:  as.Config.Account.EmailAddress,
		IsRunning:     as.isRunning,
		LastSyncTime:  as.LastSyncTime,
		NextSyncTime:  nextSyncTime,
		SyncInterval:  as.Config.SyncInterval,
		SyncCount:     atomic.LoadInt64(&as.syncCount),
		ErrorCount:    atomic.LoadInt64(&as.errorCount),
		LastError:     lastErrorStr,
		LastErrorTime: as.lastErrorTime,
	}
}

// handleSyncError 处理同步错误，智能分析并决定是否自动禁用
func (as *AccountSyncer) handleSyncError(err error) {
	errorMsg := err.Error()

	// 分析错误类型
	errorStatus := as.analyzeErrorType(errorMsg)

	// 更新同步配置的错误计数
	config, getErr := as.manager.syncConfigRepo.GetByAccountID(as.AccountID)
	if getErr != nil {
		as.manager.logger.Error("Failed to get sync config for error handling: %v", getErr)
		return
	}

	// 增加连续错误计数
	config.ConsecutiveErrors++
	now := time.Now()
	config.LastErrorTime = &now

	// 根据错误类型决定是否自动禁用
	shouldDisable, reason := as.shouldAutoDisable(errorStatus, config.ConsecutiveErrors)

	if shouldDisable {
		// 自动禁用同步
		config.EnableAutoSync = false
		config.AutoDisabled = true
		config.DisableReason = reason

		as.manager.logger.Warn("Auto-disabling sync for account %d: %s (consecutive errors: %d)",
			as.AccountID, reason, config.ConsecutiveErrors)

		// 更新账户错误状态
		as.updateAccountErrorStatus(errorStatus, errorMsg)

		// 发送禁用通知
		as.sendDisableNotification(reason)

		// 停止当前AccountSyncer
		go func() {
			time.Sleep(1 * time.Second) // 给日志记录时间
			as.Stop()
		}()
	}

	// 更新同步配置
	if updateErr := as.manager.syncConfigRepo.CreateOrUpdate(config); updateErr != nil {
		as.manager.logger.Error("Failed to update sync config after error: %v", updateErr)
	}
}

// analyzeErrorType 分析错误类型
func (as *AccountSyncer) analyzeErrorType(errorMsg string) models.AccountErrorStatus {
	errorMsg = strings.ToLower(errorMsg)

	// OAuth2认证相关错误
	if strings.Contains(errorMsg, "401") ||
		strings.Contains(errorMsg, "invalid credentials") ||
		strings.Contains(errorMsg, "unauthorized") {
		if strings.Contains(errorMsg, "token") {
			return models.ErrorStatusOAuthExpired
		}
		return models.ErrorStatusAuthRevoked
	}

	// API配额或权限问题
	if strings.Contains(errorMsg, "403") ||
		strings.Contains(errorMsg, "quota") ||
		strings.Contains(errorMsg, "rate limit") {
		return models.ErrorStatusQuotaExceeded
	}

	// API服务禁用
	if strings.Contains(errorMsg, "api disabled") ||
		strings.Contains(errorMsg, "service disabled") {
		return models.ErrorStatusAPIDisabled
	}

	// 网络相关错误
	if strings.Contains(errorMsg, "timeout") ||
		strings.Contains(errorMsg, "connection") ||
		strings.Contains(errorMsg, "network") {
		return models.ErrorStatusNetworkError
	}

	// 服务器错误
	if strings.Contains(errorMsg, "500") ||
		strings.Contains(errorMsg, "502") ||
		strings.Contains(errorMsg, "503") {
		return models.ErrorStatusServerError
	}

	return models.ErrorStatusServerError // 默认为服务器错误
}

// shouldAutoDisable 判断是否应该自动禁用
func (as *AccountSyncer) shouldAutoDisable(errorStatus models.AccountErrorStatus, consecutiveErrors int) (bool, string) {
	switch errorStatus {
	case models.ErrorStatusOAuthExpired:
		// OAuth过期：3次错误后禁用
		if consecutiveErrors >= 3 {
			return true, "OAuth2 Token已过期，需要重新授权"
		}

	case models.ErrorStatusAuthRevoked:
		// 授权撤销：立即禁用
		return true, "账户授权已被撤销，需要重新授权"

	case models.ErrorStatusAPIDisabled:
		// API禁用：立即禁用
		return true, "Gmail API服务已被禁用，请检查配置"

	case models.ErrorStatusQuotaExceeded:
		// 配额超限：5次错误后禁用
		if consecutiveErrors >= 5 {
			return true, "API配额已超限，请检查使用情况"
		}

	case models.ErrorStatusNetworkError:
		// 网络错误：10次错误后禁用
		if consecutiveErrors >= 10 {
			return true, "网络连接持续失败，请检查网络状况"
		}

	case models.ErrorStatusServerError:
		// 服务器错误：15次错误后禁用
		if consecutiveErrors >= 15 {
			return true, "邮件服务器持续异常，请联系服务提供商"
		}
	}

	return false, ""
}

// updateAccountErrorStatus 更新账户错误状态
func (as *AccountSyncer) updateAccountErrorStatus(errorStatus models.AccountErrorStatus, errorMsg string) {
	// 获取账户信息
	account, err := as.manager.emailAccountRepo.GetByID(as.AccountID)
	if err != nil {
		as.manager.logger.Error("Failed to get account for error status update: %v", err)
		return
	}

	// 更新错误状态
	now := time.Now()
	account.ErrorStatus = string(errorStatus)
	account.ErrorMessage = errorMsg
	account.ErrorTimestamp = &now
	account.ErrorCount++
	account.AutoDisabledAt = &now

	// 保存到数据库
	if err := as.manager.emailAccountRepo.Update(account); err != nil {
		as.manager.logger.Error("Failed to update account error status: %v", err)
	}
}

// resetErrorStatus 重置错误状态（同步成功时调用）
func (as *AccountSyncer) resetErrorStatus() {
	// 获取同步配置
	config, err := as.manager.syncConfigRepo.GetByAccountID(as.AccountID)
	if err != nil {
		return
	}

	// 检查是否需要重置状态
	needUpdate := false

	// 如果之前有连续错误，现在重置
	if config.ConsecutiveErrors > 0 {
		config.ConsecutiveErrors = 0
		config.LastErrorTime = nil
		needUpdate = true
	}

	// 如果之前是自动禁用状态，现在恢复
	if config.AutoDisabled {
		config.AutoDisabled = false
		config.DisableReason = ""
		needUpdate = true
		as.manager.logger.Info("Account %d auto_disabled flag reset to false after successful sync", as.AccountID)
	}

	if needUpdate {
		if updateErr := as.manager.syncConfigRepo.CreateOrUpdate(config); updateErr != nil {
			as.manager.logger.Error("Failed to reset error status: %v", updateErr)
		}

		// 如果账户之前有错误状态，也重置
		as.resetAccountErrorStatus()
	}
}

// resetAccountErrorStatus 重置账户错误状态
func (as *AccountSyncer) resetAccountErrorStatus() {
	account, err := as.manager.emailAccountRepo.GetByID(as.AccountID)
	if err != nil {
		return
	}

	// 如果账户状态异常，重置为正常
	if account.ErrorStatus != string(models.ErrorStatusNormal) {
		account.ErrorStatus = string(models.ErrorStatusNormal)
		account.ErrorMessage = ""
		account.ErrorTimestamp = nil
		// 不重置ErrorCount，保留历史统计

		if err := as.manager.emailAccountRepo.Update(account); err != nil {
			as.manager.logger.Error("Failed to reset account error status: %v", err)
		} else {
			as.manager.logger.Info("Account %d error status reset to normal", as.AccountID)
		}
	}
}

// sendDisableNotification 发送禁用通知
func (as *AccountSyncer) sendDisableNotification(reason string) {
	if as.manager.notificationService == nil {
		return
	}

	account, err := as.getAccount()
	if err != nil {
		return
	}

	notification := EmailNotification{
		Type:         "account_disabled",
		AccountID:    as.AccountID,
		AccountEmail: account.EmailAddress,
		EmailCount:   0,
		Subject:      "同步已自动禁用",
		From:         reason,
		Timestamp:    time.Now(),
	}

	as.manager.notificationService.BroadcastNotification(notification)
}

// UpdateSubscription 更新账户同步订阅配置（实现SyncManager接口）
func (m *PerAccountSyncManager) UpdateSubscription(accountID uint, config *models.EmailAccountSyncConfig) error {
	m.logger.Info("Updating subscription for account %d", accountID)

	if config == nil {
		// 移除账户同步器
		m.stopAccountSyncer(accountID)
		return nil
	}

	// 更新或创建账户同步器
	m.mu.RLock()
	syncer, exists := m.accountSyncers[accountID]
	m.mu.RUnlock()

	if exists {
		// 更新现有同步器
		syncer.UpdateConfig(*config)
	} else if config.EnableAutoSync {
		// 创建新的同步器
		m.startAccountSyncer(config)
	}

	return nil
}

// ============= Pickup Override 取件轮询覆盖 =============

// RegisterPickupOverride 注册/续期取件轮询临时同步覆盖（纯内存，零DB写入）
// 每次 pickup/poll 调用时触发，确保后端在 keepAliveSeconds 内持续同步该账户的邮件
func (m *PerAccountSyncManager) RegisterPickupOverride(accountID uint, syncInterval int, keepAliveSeconds int) {
	if syncInterval <= 0 {
		syncInterval = 5
	}
	if keepAliveSeconds <= 0 {
		keepAliveSeconds = 30
	}

	m.pickupOverridesMu.Lock()
	existing, exists := m.pickupOverrides[accountID]
	if exists {
		// 续期：只更新过期时间和同步间隔
		existing.ExpiresAt = time.Now().Add(time.Duration(keepAliveSeconds) * time.Second)
		existing.SyncInterval = syncInterval
		m.pickupOverridesMu.Unlock()
		m.logger.Debug("Renewed pickup override for account %d: interval=%ds, expires_in=%ds", accountID, syncInterval, keepAliveSeconds)
	} else {
		// 新建覆盖
		m.pickupOverrides[accountID] = &PickupOverride{
			AccountID:    accountID,
			SyncInterval: syncInterval,
			ExpiresAt:    time.Now().Add(time.Duration(keepAliveSeconds) * time.Second),
			CreatedAt:    time.Now(),
		}
		m.pickupOverridesMu.Unlock()
		m.logger.Info("Created pickup override for account %d: interval=%ds, expires_in=%ds", accountID, syncInterval, keepAliveSeconds)
	}

	// 每次续期都确保同步器正在运行，并临时应用 pickup 同步间隔。
	m.ensurePickupSyncer(accountID, syncInterval)
}

// RemovePickupOverride 移除取件轮询覆盖
func (m *PerAccountSyncManager) RemovePickupOverride(accountID uint) {
	m.pickupOverridesMu.Lock()
	_, exists := m.pickupOverrides[accountID]
	delete(m.pickupOverrides, accountID)
	m.pickupOverridesMu.Unlock()

	if exists {
		m.logger.Info("Removed pickup override for account %d", accountID)

		// 检查原始配置是否启用了自动同步，如果没有则停止同步器
		config, err := m.syncConfigRepo.GetByAccountID(accountID)
		if err != nil || config == nil || !config.EnableAutoSync {
			m.stopAccountSyncer(accountID)
			m.logger.Info("Stopped syncer for account %d (no auto-sync and pickup override removed)", accountID)
		}
	}
}

// GetPickupOverride 获取取件轮询覆盖状态
func (m *PerAccountSyncManager) GetPickupOverride(accountID uint) *PickupOverride {
	m.pickupOverridesMu.RLock()
	defer m.pickupOverridesMu.RUnlock()

	override, exists := m.pickupOverrides[accountID]
	if !exists || time.Now().After(override.ExpiresAt) {
		return nil
	}
	// 返回副本防止外部修改
	copy := *override
	return &copy
}

// GetAllPickupOverrides 获取所有活跃的取件轮询覆盖
func (m *PerAccountSyncManager) GetAllPickupOverrides() []*PickupOverride {
	m.pickupOverridesMu.RLock()
	defer m.pickupOverridesMu.RUnlock()

	now := time.Now()
	var overrides []*PickupOverride
	for _, override := range m.pickupOverrides {
		if now.Before(override.ExpiresAt) {
			copy := *override
			overrides = append(overrides, &copy)
		}
	}
	return overrides
}

// ensurePickupSyncer 确保取件轮询账户有同步器在运行
// 如果账户没有活跃的同步器，创建一个临时的
func (m *PerAccountSyncManager) ensurePickupSyncer(accountID uint, syncInterval int) {
	m.mu.RLock()
	syncer, exists := m.accountSyncers[accountID]
	m.mu.RUnlock()

	if exists {
		syncer.ApplyPickupOverride(syncInterval)
		m.logger.Debug("Syncer already exists for account %d, applied pickup override", accountID)
		return
	}

	// 需要创建一个临时同步器
	m.logger.Info("Creating pickup syncer for account %d", accountID)

	config, err := m.syncConfigRepo.GetByAccountIDWithAccount(accountID)
	if err != nil {
		// 配置不存在，创建一个最小化的临时配置
		account, accErr := m.emailAccountRepo.GetByID(accountID)
		if accErr != nil {
			m.logger.Error("Failed to get account %d for pickup syncer: %v", accountID, accErr)
			return
		}
		config = &models.EmailAccountSyncConfig{
			AccountID:      accountID,
			Account:        *account,
			EnableAutoSync: true, // 临时启用
			SyncInterval:   syncInterval,
			SyncFolders:    models.StringSlice{"INBOX"},
			SyncStatus:     models.SyncStatusIdle,
		}
	} else {
		// 有配置但可能未启用自动同步，临时覆盖
		config.EnableAutoSync = true
		config.SyncInterval = syncInterval
		pickupLastSync := time.Now().Add(-time.Duration(syncInterval+1) * time.Second)
		config.LastSyncTime = &pickupLastSync
	}

	if err := m.startAccountSyncer(config); err != nil {
		m.logger.Error("Failed to start pickup syncer for account %d: %v", accountID, err)
	}
}

// cleanupExpiredPickupOverrides 清理过期的取件轮询覆盖
func (m *PerAccountSyncManager) cleanupExpiredPickupOverrides() {
	now := time.Now()
	var expiredIDs []uint

	m.pickupOverridesMu.Lock()
	for accountID, override := range m.pickupOverrides {
		if now.After(override.ExpiresAt) {
			expiredIDs = append(expiredIDs, accountID)
			delete(m.pickupOverrides, accountID)
		}
	}
	m.pickupOverridesMu.Unlock()

	// 对过期的覆盖，检查是否需要停止同步器
	for _, accountID := range expiredIDs {
		m.logger.Info("Pickup override expired for account %d", accountID)
		config, err := m.syncConfigRepo.GetByAccountID(accountID)
		if err != nil || config == nil || !config.EnableAutoSync {
			m.stopAccountSyncer(accountID)
			m.logger.Info("Stopped syncer for account %d (pickup override expired, no auto-sync)", accountID)
		}
	}
}
