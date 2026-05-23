package services

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
)

// OptimizedIncrementalSyncManager 优化版增量同步管理器
// 使用中央轮询器模式替代为每个账户创建单独goroutine的方式
type OptimizedIncrementalSyncManager struct {
	scheduler      *EmailFetchScheduler
	syncConfigRepo *repository.SyncConfigRepository
	emailRepo      *repository.EmailRepository
	mailboxRepo    *repository.MailboxRepository
	fetcher        *FetcherService

	// 账户同步配置缓存 (accountID -> config)
	syncConfigs map[uint]models.EmailAccountSyncConfig

	// 账户最后同步时间记录 (accountID -> lastSync)
	lastSyncTimes map[uint]time.Time

	// 批处理队列
	syncQueue chan syncJob

	// 用于保护配置和状态的锁，注意尽量减少锁的持有时间
	configMu sync.RWMutex

	// 上下文用于控制所有goroutine的生命周期
	ctx    context.Context
	cancel context.CancelFunc

	// 其他组件
	logger         *utils.Logger
	wg             sync.WaitGroup
	activityLogger *ActivityLogger

	// 监控统计
	skippedSyncs int64 // 跳过的同步计数

	// 系统配置
	batchSize    int           // 批处理大小
	pollInterval time.Duration // 中央轮询间隔
	dbTimeout    time.Duration // 数据库操作超时
}

// syncJob 定义一个同步作业
type syncJob struct {
	accountID   uint
	config      models.EmailAccountSyncConfig
	triggerTime time.Time
}

// NewOptimizedIncrementalSyncManager 创建优化版增量同步管理器
func NewOptimizedIncrementalSyncManager(
	scheduler *EmailFetchScheduler,
	syncConfigRepo *repository.SyncConfigRepository,
	emailRepo *repository.EmailRepository,
	mailboxRepo *repository.MailboxRepository,
	fetcher *FetcherService,
) *OptimizedIncrementalSyncManager {
	ctx, cancel := context.WithCancel(context.Background())

	return &OptimizedIncrementalSyncManager{
		scheduler:      scheduler,
		syncConfigRepo: syncConfigRepo,
		emailRepo:      emailRepo,
		mailboxRepo:    mailboxRepo,
		fetcher:        fetcher,
		syncConfigs:    make(map[uint]models.EmailAccountSyncConfig),
		lastSyncTimes:  make(map[uint]time.Time),
		syncQueue:      make(chan syncJob, 1000), // 队列缓冲区扩容到1000
		ctx:            ctx,
		cancel:         cancel,
		logger:         utils.NewLogger("OptimizedSyncManager"),
		activityLogger: GetActivityLogger(),
		batchSize:      10,              // 每批处理10个账户
		pollInterval:   2 * time.Second, // 轮询间隔2秒，保证能够及时检查所有同步间隔
		dbTimeout:      5 * time.Second, // 数据库操作5秒超时
	}
}

// Start 启动优化版同步管理器
func (m *OptimizedIncrementalSyncManager) Start() error {
	m.logger.Info("Starting optimized incremental sync manager")

	// 加载所有启用的同步配置

	// 获取所有启用的同步配置
	configs, err := m.syncConfigRepo.GetEnabledConfigsWithAccounts()
	if err != nil {
		m.logger.ErrorWithStack(err, "Failed to load sync configs")
		return fmt.Errorf("failed to load sync configs: %w", err)
	}

	m.logger.Info("Loaded %d enabled sync configurations", len(configs))

	// 初始化配置缓存
	m.configMu.Lock()
	for _, config := range configs {
		m.syncConfigs[config.AccountID] = config
		// 记录最后同步时间，如果配置中没有则使用当前时间
		if config.LastSyncTime != nil {
			m.lastSyncTimes[config.AccountID] = *config.LastSyncTime
		} else {
			m.lastSyncTimes[config.AccountID] = time.Now()
		}
	}
	m.configMu.Unlock()

	// 启动工作线程处理同步队列
	for i := 0; i < 3; i++ { // 使用3个工作线程
		m.wg.Add(1)
		go m.syncWorker()
	}

	// 启动中央轮询器
	m.wg.Add(1)
	go m.centralPoller()

	// 启动配置变更监视器
	m.wg.Add(1)
	go m.configChangeMonitor()

	return nil
}

// centralPoller 中央轮询器 - 代替为每个账户创建单独的goroutine
func (m *OptimizedIncrementalSyncManager) centralPoller() {
	defer m.wg.Done()

	ticker := time.NewTicker(m.pollInterval)
	defer ticker.Stop()

	m.logger.Info("Central poller started with interval %v", m.pollInterval)

	for {
		select {
		case <-m.ctx.Done():
			m.logger.Info("Central poller shutting down")
			return

		case <-ticker.C:
			// 检查所有配置，找出需要同步的账户
			m.checkAccountsForSync()
		}
	}
}

// checkAccountsForSync 检查哪些账户需要同步
func (m *OptimizedIncrementalSyncManager) checkAccountsForSync() {
	now := time.Now()
	var accountsToSync []uint

	// 使用读锁获取需要同步的账户ID列表
	m.configMu.RLock()
	for accountID, config := range m.syncConfigs {
		// 跳过禁用自动同步的账户
		if !config.EnableAutoSync {
			continue
		}

		// 获取最后同步时间
		lastSync, exists := m.lastSyncTimes[accountID]
		if !exists {
			lastSync = time.Time{} // 零值表示从未同步过
		}

		// 计算下次同步时间
		nextSyncTime := lastSync.Add(time.Duration(config.SyncInterval) * time.Second)

		// 如果现在已经过了下次同步时间，添加到待同步列表
		if now.After(nextSyncTime) {
			accountsToSync = append(accountsToSync, accountID)
		}
	}
	m.configMu.RUnlock()

	// 将需要同步的账户分批处理，避免一次处理太多账户
	if len(accountsToSync) > 0 {
		m.logger.Info("Found %d accounts that need syncing", len(accountsToSync))

		// 分批处理账户
		for i := 0; i < len(accountsToSync); i += m.batchSize {
			end := i + m.batchSize
			if end > len(accountsToSync) {
				end = len(accountsToSync)
			}

			// 为本批次创建一个上下文
			batchCtx, cancel := context.WithTimeout(m.ctx, 60*time.Second)

			// 处理当前批次
			m.processBatch(batchCtx, accountsToSync[i:end])

			// 批次处理完成后取消上下文
			cancel()
		}
	}
}

// processBatch 处理一批账户的同步
func (m *OptimizedIncrementalSyncManager) processBatch(ctx context.Context, accountIDs []uint) {
	for _, accountID := range accountIDs {
		// 再次检查账户是否需要同步（配置可能已更改）
		m.configMu.RLock()
		config, exists := m.syncConfigs[accountID]
		if !exists || !config.EnableAutoSync {
			m.configMu.RUnlock()
			continue
		}
		m.configMu.RUnlock()

		// 创建同步作业并放入队列
		job := syncJob{
			accountID:   accountID,
			config:      config,
			triggerTime: time.Now(),
		}

		// 放入队列，使用非阻塞发送避免死锁
		select {
		case m.syncQueue <- job:
			m.logger.Debug("Queued sync job for account %d", accountID)
		case <-ctx.Done():
			m.logger.Warn("Context canceled while queueing jobs")
			return
		default:
			// 队列已满，记录详细警告并继续
			queueUsage := float64(len(m.syncQueue)) / float64(cap(m.syncQueue)) * 100
			m.logger.Warn("Sync queue full (%.1f%%), skipping account %d - consider system scaling", queueUsage, accountID)
			// 增加跳过计数
			atomic.AddInt64(&m.skippedSyncs, 1)
		}
	}
}

// syncWorker 同步工作线程 - 从队列中取出作业并执行
func (m *OptimizedIncrementalSyncManager) syncWorker() {
	defer m.wg.Done()

	m.logger.Info("Sync worker started")

	for {
		select {
		case <-m.ctx.Done():
			m.logger.Info("Sync worker shutting down")
			return

		case job, ok := <-m.syncQueue:
			if !ok {
				// 队列已关闭
				return
			}

			// 处理同步作业
			m.processAccountSync(job)
		}
	}
}

// processAccountSync 处理单个账户的同步
func (m *OptimizedIncrementalSyncManager) processAccountSync(job syncJob) {
	accountID := job.accountID

	// 创建带超时的上下文
	ctx, cancel := context.WithTimeout(m.ctx, 30*time.Second)
	defer cancel()

	// 验证账户状态
	configWithAccount, err := m.syncConfigRepo.GetByAccountIDWithAccount(accountID)
	if err != nil {
		m.logger.Error("Failed to get account details for %d: %v", accountID, err)
		return
	}

	// 检查账户是否仍然有效
	if configWithAccount.Account.ID == 0 || !configWithAccount.Account.IsVerified || configWithAccount.Account.DeletedAt.Valid {
		m.logger.Warn("Account %d is invalid for sync (verified: %v, deleted: %v)",
			accountID, configWithAccount.Account.IsVerified, configWithAccount.Account.DeletedAt.Valid)

		// 从缓存中移除无效账户
		m.configMu.Lock()
		delete(m.syncConfigs, accountID)
		delete(m.lastSyncTimes, accountID)
		m.configMu.Unlock()

		return
	}

	// 更新同步状态为正在同步
	err = m.syncConfigRepo.UpdateSyncStatus(accountID, models.SyncStatusSyncing, "")
	if err != nil {
		m.logger.Error("Failed to update sync status for account %d: %v", accountID, err)
		// 继续执行，不要因为状态更新失败而中断同步
	}

	// 记录同步开始活动
	m.activityLogger.LogSyncActivity(models.ActivitySyncStarted, configWithAccount.Account.EmailAddress, nil, nil)

	// 创建获取请求
	// 使用正确的时间窗口管理：基于上次同步结束时间，避免遗漏
	var startDate *time.Time
	var endDate time.Time = time.Now()

	if configWithAccount.LastSyncEndTime != nil {
		// 增量同步：使用上次同步结束时间减5分钟作为开始时间
		// 5分钟缓冲区确保不会因为邮件送达延迟而遗漏邮件
		lastEndMinus5Min := configWithAccount.LastSyncEndTime.Add(-5 * time.Minute)

		// 但不超过24小时前，避免处理过多历史邮件
		twentyFourHoursAgo := time.Now().Add(-24 * time.Hour)
		if lastEndMinus5Min.Before(twentyFourHoursAgo) {
			startDate = &twentyFourHoursAgo
			m.logger.Info("Using 24h fallback for account %d: last_sync_end_time too old (%v)",
				accountID, configWithAccount.LastSyncEndTime)
		} else {
			startDate = &lastEndMinus5Min
			m.logger.Info("Using 5-minute buffer for account %d: start from %v (end_time: %v)",
				accountID, lastEndMinus5Min, configWithAccount.LastSyncEndTime)
		}
	} else {
		// 首次同步，从24小时前开始
		twentyFourHoursAgo := time.Now().Add(-24 * time.Hour)
		startDate = &twentyFourHoursAgo
		m.logger.Info("First-time sync for account %d: using 24h lookback", accountID)
	}

	m.logger.Info("Fetching emails from %d folders since %v to %v",
		len([]string{}), startDate, endDate)

	fetchReq := FetchRequest{
		Type:         SubscriptionTypeRealtime,
		Priority:     PriorityHigh,
		EmailAddress: configWithAccount.Account.EmailAddress,
		StartDate:    startDate,        // 基于上次结束时间计算
		EndDate:      &endDate,         // 记录本次同步结束时间
		Folders:      []string{},       // 空数组表示同步所有文件夹
		Timeout:      20 * time.Second, // 设置合理的超时时间
	}

	// 获取邮件
	emails, err := m.fetchEmails(ctx, fetchReq)

	if err != nil {
		m.logger.Error("Error fetching emails for account %d: %v", accountID, err)
		// 更新同步状态为错误
		m.updateSyncStatus(accountID, models.SyncStatusError, err.Error())
		return
	}

	// 处理获取到的邮件
	emailsProcessed, hasNewEmails, err := m.handleSyncBatch(emails)

	// 更新最后同步时间（即使没有新邮件也更新）
	// 传入同步的结束时间，确保时间窗口准确
	m.processFetchComplete(accountID, len(emailsProcessed), hasNewEmails, endDate)

	// 更新内部缓存中的最后同步时间
	now := time.Now()
	m.configMu.Lock()
	m.lastSyncTimes[accountID] = now
	m.configMu.Unlock()

	m.logger.Info("Completed sync for account %d: processed %d emails, has new: %v",
		accountID, len(emailsProcessed), hasNewEmails)
}

// fetchEmails 从邮件服务器获取邮件 - 直接调用获取服务，无过滤
func (m *OptimizedIncrementalSyncManager) fetchEmails(ctx context.Context, req FetchRequest) ([]models.Email, error) {
	m.logger.Info("Starting direct email fetch for %s (bypass subscription filters)", req.EmailAddress)

	// 获取账户信息
	account, err := m.getAccountByEmail(req.EmailAddress)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	// 直接调用 FetcherService，绕过订阅管理器的过滤逻辑
	fetcherService := m.scheduler.GetFetcherService()
	if fetcherService == nil {
		return nil, fmt.Errorf("fetcher service not available")
	}

	// 确定要获取的文件夹
	folders := req.Folders
	if len(folders) == 0 {
		// 自动获取所有文件夹
		allFolders, err := fetcherService.GetAllFolders(*account)
		if err != nil {
			m.logger.Warn("Failed to get all folders, using common defaults: %v", err)
			// 使用常用文件夹作为后备
			allFolders = []string{"INBOX", "SENT", "DRAFTS"}
		}
		folders = allFolders
		m.logger.Info("Auto-discovered %d folders for %s: %v", len(folders), account.EmailAddress, folders)
	}

	// 创建 FetchEmailsOptions - 为Gmail账户特别处理
	options := FetchEmailsOptions{
		Folders:         folders,
		FetchFromServer: true, // 关键修复：从邮件服务器获取新邮件
		IncludeBody:     true, // 包含邮件正文
	}

	// 检查是否是Gmail账户
	isGmailAccount := account.AuthType == "oauth2" && (account.EmailAddress == "" ||
		strings.Contains(account.EmailAddress, "@gmail.com") ||
		strings.Contains(account.EmailAddress, "@googlemail.com"))

	if isGmailAccount {
		// Gmail账户：不传递日期过滤器，让Gmail History API自己处理增量同步
		m.logger.Info("Gmail account detected: using Gmail History API for incremental sync without date filters")
	} else {
		// 非Gmail账户：使用传统的日期过滤
		var startDate *time.Time
		if req.StartDate != nil {
			startDate = req.StartDate
		} else {
			// 默认获取最近7天的邮件
			defaultStart := time.Now().Add(-7 * 24 * time.Hour)
			startDate = &defaultStart
		}

		options.StartDate = startDate
		options.EndDate = req.EndDate

		m.logger.Info("Non-Gmail account: fetching emails from %d folders since %v", len(folders), startDate.Format("2006-01-02 15:04:05"))
	}

	emails, err := fetcherService.FetchEmailsFromMultipleMailboxes(*account, options)
	if err != nil {
		// For Gmail accounts, if incremental sync fails, try fallback to full sync with reset History ID
		if isGmailAccount {
			m.logger.Warn("Gmail incremental sync failed, attempting fallback to full sync: %v", err)

			// Reset History ID to force full sync
			syncConfig, getErr := m.syncConfigRepo.GetByAccountID(account.ID)
			if getErr == nil && syncConfig.LastHistoryID != "" {
				m.logger.Info("Resetting History ID '%s' to trigger full sync", syncConfig.LastHistoryID)
				syncConfig.LastHistoryID = ""
				if updateErr := m.syncConfigRepo.Update(syncConfig); updateErr != nil {
					m.logger.Error("Failed to reset History ID for fallback: %v", updateErr)
				}

				// Retry with cleared History ID
				retryEmails, retryErr := fetcherService.FetchEmailsFromMultipleMailboxes(*account, options)
				if retryErr == nil {
					m.logger.Info("Gmail fallback to full sync succeeded: %d emails", len(retryEmails))
					return retryEmails, nil
				} else {
					m.logger.Error("Gmail fallback to full sync also failed: %v", retryErr)
				}
			}
		}
		return nil, fmt.Errorf("failed to fetch emails: %w", err)
	}

	m.logger.Info("Successfully fetched %d emails from mailboxes (no filtering applied)", len(emails))
	return emails, nil
}

// getAccountByEmail 根据邮箱地址获取账户信息
func (m *OptimizedIncrementalSyncManager) getAccountByEmail(emailAddress string) (*models.EmailAccount, error) {
	// 首先尝试从本地缓存获取
	m.configMu.RLock()
	for _, config := range m.syncConfigs {
		if config.Account.EmailAddress == emailAddress {
			m.configMu.RUnlock()
			return &config.Account, nil
		}
	}
	m.configMu.RUnlock()

	// 如果本地缓存没有找到，从数据库获取
	m.logger.Debug("Account not found in cache, querying database for: %s", emailAddress)

	// 通过 scheduler 获取 FetcherService
	fetcherService := m.scheduler.GetFetcherService()
	if fetcherService == nil {
		return nil, fmt.Errorf("fetcher service not available")
	}

	// 使用 FetcherService 从数据库获取账户
	account, err := fetcherService.GetAccountByEmail(emailAddress)
	if err != nil {
		return nil, fmt.Errorf("failed to get account from database: %w", err)
	}

	m.logger.Debug("Successfully retrieved account from database for: %s", emailAddress)
	return account, nil
}

// updateSyncStatus 更新同步状态
func (m *OptimizedIncrementalSyncManager) updateSyncStatus(accountID uint, status string, errorMsg string) {
	if err := m.syncConfigRepo.UpdateSyncStatus(accountID, status, errorMsg); err != nil {
		m.logger.Error("Failed to update sync status: %v", err)
	}
}

// configChangeMonitor 监控配置变更
func (m *OptimizedIncrementalSyncManager) configChangeMonitor() {
	defer m.wg.Done()

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	m.logger.Debug("Started monitoring for config changes")

	for {
		select {
		case <-m.ctx.Done():
			m.logger.Debug("Config monitor shutting down")
			return

		case <-ticker.C:
			m.checkConfigChanges()
		}
	}
}

// checkConfigChanges 检查配置变更并应用全局配置到新账户
func (m *OptimizedIncrementalSyncManager) checkConfigChanges() {
	configs, err := m.syncConfigRepo.GetEnabledConfigsWithAccounts()
	if err != nil {
		m.logger.Error("Failed to check config changes: %v", err)
		return
	}

	// 将从数据库获取的配置转换为Map便于查找
	newConfigs := make(map[uint]models.EmailAccountSyncConfig)
	for _, config := range configs {
		// 验证账户状态
		if config.Account.ID != 0 && (!config.Account.IsVerified || config.Account.DeletedAt.Valid) {
			m.logger.Info("Skipping invalid account %d (verified: %v, deleted: %v)",
				config.AccountID, config.Account.IsVerified, config.Account.DeletedAt.Valid)
			continue
		}
		newConfigs[config.AccountID] = config
	}

	// 更新配置缓存
	m.configMu.Lock()
	defer m.configMu.Unlock()

	// 清理无效账户的配置
	for accountID := range m.syncConfigs {
		if _, exists := newConfigs[accountID]; !exists {
			m.logger.Info("Removing config for account %d (no longer valid)", accountID)
			delete(m.syncConfigs, accountID)
			delete(m.lastSyncTimes, accountID)
		}
	}

	// 检查新增或更新的配置
	for accountID, config := range newConfigs {
		// 如果是新增配置或配置已更改
		existingConfig, exists := m.syncConfigs[accountID]
		if !exists || configChanged(existingConfig, config) {
			m.logger.Info("Found new or updated config for account %d", accountID)
			m.syncConfigs[accountID] = config

			// 只在新增配置时重置最后同步时间，更新配置时保持原有的同步时间
			if !exists && config.EnableAutoSync {
				// 新账户：设置较早的时间以触发首次同步
				m.lastSyncTimes[accountID] = time.Now().Add(-1 * time.Hour)
			}
		}
	}

	// 检查删除的配置
	for accountID := range m.syncConfigs {
		if _, exists := newConfigs[accountID]; !exists {
			m.logger.Info("Config removed for account %d", accountID)
			delete(m.syncConfigs, accountID)
			delete(m.lastSyncTimes, accountID)
		}
	}

	// 应用全局配置到未配置的已验证账户
	m.applyGlobalConfigToNewAccounts()
}

// applyGlobalConfigToNewAccounts 应用全局配置到验证账户
func (m *OptimizedIncrementalSyncManager) applyGlobalConfigToNewAccounts() {
	// 获取全局配置
	globalConfig, err := m.syncConfigRepo.GetGlobalConfig()
	if err != nil {
		m.logger.Debug("No global config found or error retrieving it: %v", err)
		return
	}

	// 检查是否启用了全局同步
	if !globalConfig["default_enable_sync"].(bool) {
		return
	}

	// 获取未配置的已验证账户
	accounts, err := m.syncConfigRepo.GetVerifiedAccountsWithoutSyncConfig()
	if err != nil {
		m.logger.Error("Failed to get accounts without sync config: %v", err)
		return
	}

	for _, account := range accounts {
		m.logger.Info("Applying global config to account %d", account.ID)

		// 创建基于全局设置的默认配置
		config := &models.EmailAccountSyncConfig{
			AccountID:      account.ID,
			EnableAutoSync: globalConfig["default_enable_sync"].(bool),
			SyncInterval:   globalConfig["default_sync_interval"].(int),
			SyncFolders:    models.StringSlice(globalConfig["default_sync_folders"].([]string)),
			SyncStatus:     models.SyncStatusIdle,
		}

		// 保存配置
		if err := m.syncConfigRepo.CreateOrUpdate(config); err != nil {
			m.logger.Error("Failed to create default sync config for account %d: %v", account.ID, err)
			continue
		}

		// 添加到内存缓存
		config.Account = account
		m.syncConfigs[account.ID] = *config
		// 设置较早的时间以触发立即同步
		m.lastSyncTimes[account.ID] = time.Now().Add(-24 * time.Hour)

		m.logger.Info("Successfully auto-configured account %d", account.ID)
	}
}

// configChanged 检查配置是否已更改
func configChanged(old, new models.EmailAccountSyncConfig) bool {
	// 检查关键字段是否变更
	if old.EnableAutoSync != new.EnableAutoSync ||
		old.SyncInterval != new.SyncInterval {
		return true
	}

	// 检查文件夹列表是否变更
	if len(old.SyncFolders) != len(new.SyncFolders) {
		return true
	}

	// 更详细地比较文件夹
	oldFolders := make(map[string]bool)
	for _, folder := range old.SyncFolders {
		oldFolders[folder] = true
	}

	for _, folder := range new.SyncFolders {
		if !oldFolders[folder] {
			return true
		}
	}

	return false
}

// Stop 停止同步管理器
func (m *OptimizedIncrementalSyncManager) Stop() {
	m.logger.Info("Stopping optimized incremental sync manager")

	// 取消上下文，通知所有goroutine停止
	m.cancel()

	// 等待所有goroutine退出
	m.logger.Debug("Waiting for all goroutines to finish...")
	m.wg.Wait()

	m.logger.Info("Optimized incremental sync manager stopped")
}

// UpdateSubscription 更新账户同步订阅配置
// 实现SyncManager接口以保持兼容性
func (m *OptimizedIncrementalSyncManager) UpdateSubscription(accountID uint, config *models.EmailAccountSyncConfig) error {
	m.logger.Info("更新账户 %d 的同步配置", accountID)

	// 获取配置的读写锁
	m.configMu.Lock()
	defer m.configMu.Unlock()

	// 更新内存中的配置
	if config != nil {
		m.syncConfigs[accountID] = *config

		// 如果启用了自动同步，设置最后同步时间为较早的时间，以触发下次轮询时立即同步
		if config.EnableAutoSync {
			m.lastSyncTimes[accountID] = time.Now().Add(-24 * time.Hour)
		}
	} else {
		// 如果配置为空，则删除
		delete(m.syncConfigs, accountID)
		delete(m.lastSyncTimes, accountID)
	}

	m.logger.Info("已更新账户 %d 的同步配置，自动同步: %v, 间隔: %d秒",
		accountID, config.EnableAutoSync, config.SyncInterval)

	return nil
}

// processFetchComplete 处理获取完成后的逻辑，确保更新同步时间
func (m *OptimizedIncrementalSyncManager) processFetchComplete(accountID uint, emailsProcessed int, hasNewEmails bool, syncEndTime time.Time) error {
	// 获取当前配置
	config, err := m.syncConfigRepo.GetByAccountID(accountID)
	if err != nil {
		return fmt.Errorf("failed to get sync config: %w", err)
	}

	// 无论是否有新邮件，都更新最后同步时间和结束时间
	now := time.Now()
	config.LastSyncTime = &now
	config.LastSyncEndTime = &syncEndTime // 保存本次同步的结束时间，用于下次增量同步
	config.SyncStatus = models.SyncStatusIdle

	// 只有在没有新邮件时才需要强制更新，有新邮件时 handleSyncBatch 已经更新过了
	if !hasNewEmails {
		if err := m.syncConfigRepo.CreateOrUpdate(config); err != nil {
			return fmt.Errorf("failed to update sync time: %w", err)
		}
		m.logger.Info("Updated last sync time for account %d (no new emails), end_time: %v", accountID, syncEndTime)
	}

	// 记录统计信息
	stats := &models.SyncStatistics{
		AccountID:      accountID,
		SyncDate:       now,
		EmailsSynced:   emailsProcessed,
		SyncDurationMs: 0, // 由调度器计算
		ErrorsCount:    0,
	}
	if err := m.syncConfigRepo.RecordSyncStatistics(stats); err != nil {
		m.logger.Warn("Failed to record statistics: %v", err)
	}

	return nil
}

// handleSyncBatch 处理一批邮件
func (m *OptimizedIncrementalSyncManager) handleSyncBatch(emails []models.Email) ([]models.Email, bool, error) {
	var syncedEmails []models.Email
	hasNewEmails := false

	for _, email := range emails {
		// 检查邮件是否已存在
		exists, err := m.emailRepo.CheckDuplicate(email.MessageID, email.AccountID)
		if err != nil {
			m.logger.Error("Error checking duplicate for %s: %v", email.MessageID, err)
			continue
		}

		if exists {
			m.logger.Debug("Email already exists: %s", email.MessageID)
			continue
		}

		// 保存新邮件
		if err := m.emailRepo.Create(&email); err != nil {
			m.logger.Error("Failed to save email %s: %v", email.MessageID, err)
			continue
		}

		// 更新同步配置
		config, err := m.syncConfigRepo.GetByAccountID(email.AccountID)
		if err != nil {
			m.logger.Error("Failed to get config for account %d: %v", email.AccountID, err)
			continue
		}

		now := time.Now()
		config.LastSyncTime = &now
		config.LastSyncMessageID = email.MessageID
		config.SyncStatus = models.SyncStatusIdle

		if err := m.syncConfigRepo.CreateOrUpdate(config); err != nil {
			m.logger.Error("Failed to update sync status: %v", err)
			continue
		}

		syncedEmails = append(syncedEmails, email)
		hasNewEmails = true
		m.logger.Info("Synced new email %s for account %d", email.MessageID, email.AccountID)
	}

	return syncedEmails, hasNewEmails, nil
}

// SyncNow 立即同步指定账户
func (m *OptimizedIncrementalSyncManager) SyncNow(accountID uint, opts SyncNowOptions) (*SyncResult, error) {
	m.logger.Info("SyncNow triggered for account %d", accountID)

	// 获取账户配置
	m.configMu.RLock()
	config, exists := m.syncConfigs[accountID]
	m.configMu.RUnlock()

	if !exists {
		// 如果缓存中没有，尝试从数据库获取
		var err error
		configPtr, err := m.syncConfigRepo.GetByAccountID(accountID)
		if err != nil {
			return nil, fmt.Errorf("failed to get sync config: %w", err)
		}
		config = *configPtr
	}

	// 用于同步的配置信息（这里不需要创建作业，因为直接在当前goroutine处理）
	// 直接使用config变量，不需要创建额外的变量

	// 创建结果通道
	resultCh := make(chan *SyncResult, 1)
	errorCh := make(chan error, 1)

	// 在单独的goroutine中处理同步
	go func() {
		start := time.Now()

		// 处理同步
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()

		// 获取邮件 - 应用5分钟缓冲区逻辑
		endTime := time.Now()
		var startTime *time.Time

		if config.LastSyncEndTime != nil {
			// 使用上次同步结束时间减5分钟作为开始时间
			bufferTime := config.LastSyncEndTime.Add(-5 * time.Minute)
			startTime = &bufferTime
		} else if config.LastSyncTime != nil {
			// 兼容旧版本，如果没有LastSyncEndTime则使用LastSyncTime减5分钟
			bufferTime := config.LastSyncTime.Add(-5 * time.Minute)
			startTime = &bufferTime
		}

		fetchReq := FetchRequest{
			Type:         SubscriptionTypeRealtime,
			Priority:     PriorityHigh,
			EmailAddress: config.Account.EmailAddress,
			StartDate:    startTime,
			EndDate:      &endTime,
			Folders:      config.SyncFolders,
			Timeout:      30 * time.Second,
		}

		emails, err := m.fetchEmails(ctx, fetchReq)
		if err != nil {
			errorCh <- err
			return
		}

		// 处理邮件
		syncedEmails, hasNewEmails, err := m.handleSyncBatch(emails)
		if err != nil {
			errorCh <- err
			return
		}

		// 更新最后同步时间
		if err := m.processFetchComplete(accountID, len(syncedEmails), hasNewEmails, endTime); err != nil {
			errorCh <- err
			return
		}

		// 更新缓存中的最后同步时间
		now := time.Now()
		m.configMu.Lock()
		m.lastSyncTimes[accountID] = now
		m.configMu.Unlock()

		// 发送结果
		resultCh <- &SyncResult{
			EmailsSynced: len(syncedEmails),
			SyncedEmails: syncedEmails,
			Duration:     time.Since(start),
			Error:        nil,
		}
	}()

	// 等待结果或错误
	select {
	case result := <-resultCh:
		return result, nil
	case err := <-errorCh:
		return nil, err
	case <-time.After(3 * time.Minute): // 总超时
		return nil, fmt.Errorf("sync operation timed out")
	}
}

// QueueMetrics 队列监控指标
type QueueMetrics struct {
	QueueLength    int     `json:"queue_length"`
	QueueCapacity  int     `json:"queue_capacity"`
	UsageRate      float64 `json:"usage_rate"`
	SkippedSyncs   int64   `json:"skipped_syncs"`
	ActiveAccounts int     `json:"active_accounts"`
	WorkerCount    int     `json:"worker_count"`
}

// GetQueueMetrics 获取队列监控指标
func (m *OptimizedIncrementalSyncManager) GetQueueMetrics() QueueMetrics {
	m.configMu.RLock()
	defer m.configMu.RUnlock()

	queueLength := len(m.syncQueue)
	queueCapacity := cap(m.syncQueue)
	usageRate := float64(queueLength) / float64(queueCapacity) * 100

	return QueueMetrics{
		QueueLength:    queueLength,
		QueueCapacity:  queueCapacity,
		UsageRate:      usageRate,
		SkippedSyncs:   atomic.LoadInt64(&m.skippedSyncs),
		ActiveAccounts: len(m.syncConfigs),
		WorkerCount:    3, // 当前固定3个worker
	}
}

// ResetSkippedSyncs 重置跳过同步计数
func (m *OptimizedIncrementalSyncManager) ResetSkippedSyncs() {
	atomic.StoreInt64(&m.skippedSyncs, 0)
}
