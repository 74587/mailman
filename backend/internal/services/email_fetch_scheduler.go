package services

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
)

// EmailFetchScheduler 邮件获取调度器
type EmailFetchScheduler struct {
	subscriptionMgr *SubscriptionManager
	workerPool      *WorkerPool
	fetcherService  *FetcherService
	accountRepo     *repository.EmailAccountRepository
	cache           *EmailCache

	// 配置
	config SchedulerConfig

	// 运行状态
	running    bool
	shutdownCh chan struct{}
	wg         sync.WaitGroup
	mu         sync.RWMutex

	// 事件管理
	eventSubscribers map[string][]EventChannel
	eventMu          sync.RWMutex
}

// SchedulerConfig 调度器配置
type SchedulerConfig struct {
	MinFetchInterval time.Duration // 最小获取间隔
	MaxWorkers       int           // 最大工作线程数
	CacheDuration    time.Duration // 缓存持续时间
	CleanupInterval  time.Duration // 清理间隔
	EnablePrefetch   bool          // 是否启用预取
	PrefetchWindow   time.Duration // 预取窗口
}

// DefaultSchedulerConfig 默认配置
func DefaultSchedulerConfig() SchedulerConfig {
	return SchedulerConfig{
		MinFetchInterval: 5 * time.Second,
		MaxWorkers:       10,
		CacheDuration:    1 * time.Minute, // 缩短到1分钟
		CleanupInterval:  5 * time.Minute, // 调整清理间隔
		EnablePrefetch:   true,
		PrefetchWindow:   1 * time.Minute, // 调整预取窗口
	}
}

// NewEmailFetchScheduler 创建邮件获取调度器
func NewEmailFetchScheduler(
	fetcherService *FetcherService,
	accountRepo *repository.EmailAccountRepository,
	config SchedulerConfig,
) *EmailFetchScheduler {
	scheduler := &EmailFetchScheduler{
		subscriptionMgr:  NewSubscriptionManager(),
		fetcherService:   fetcherService,
		accountRepo:      accountRepo,
		cache:            NewEmailCache(config.CacheDuration),
		config:           config,
		shutdownCh:       make(chan struct{}),
		eventSubscribers: make(map[string][]EventChannel),
	}

	// 创建工作池
	scheduler.workerPool = NewWorkerPool(config.MaxWorkers, scheduler)

	// 设置订阅管理器的钩子
	scheduler.setupSubscriptionHooks()

	return scheduler
}

// Start 启动调度器
func (s *EmailFetchScheduler) Start() error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("scheduler already running")
	}
	s.running = true
	s.mu.Unlock()

	// 启动工作池
	s.workerPool.Start()

	// 启动清理任务
	s.wg.Add(1)
	go s.cleanupRoutine()

	// 启动预取任务
	if s.config.EnablePrefetch {
		s.wg.Add(1)
		go s.prefetchRoutine()
	}

	log.Println("[EmailFetchScheduler] Started")
	return nil
}

// Stop 停止调度器
func (s *EmailFetchScheduler) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	s.mu.Unlock()

	// 发送关闭信号
	close(s.shutdownCh)

	// 停止工作池
	s.workerPool.Stop()

	// 停止订阅管理器
	s.subscriptionMgr.Shutdown()

	// 等待所有协程退出
	s.wg.Wait()

	log.Println("[EmailFetchScheduler] Stopped")
}

// Subscribe 创建订阅（对外接口）
func (s *EmailFetchScheduler) Subscribe(ctx context.Context, req FetchRequest) (<-chan models.Email, error) {
	// 转换为订阅请求
	subReq := SubscribeRequest{
		Type:     req.Type,
		Priority: req.Priority,
		Filter: EmailFilter{
			EmailAddress: req.EmailAddress,
			StartDate:    req.StartDate,
			EndDate:      req.EndDate,
			Subject:      req.Subject,
			From:         req.From,
			Folders:      req.Folders,
		},
		Context:       ctx,
		Timeout:       req.Timeout,
		ChannelBuffer: 100,
		Metadata:      req.Metadata,
	}

	// 创建订阅
	subscription, err := s.subscriptionMgr.Subscribe(subReq)
	if err != nil {
		return nil, err
	}

	// 触发获取
	s.triggerFetch(subscription.Filter.RealMailbox)

	return subscription.EmailChannel, nil
}

// SubscribeWithCallback 使用回调函数订阅
func (s *EmailFetchScheduler) SubscribeWithCallback(
	ctx context.Context,
	req FetchRequest,
	callback func(email models.Email) error,
) (string, error) {
	// 转换为订阅请求
	subReq := SubscribeRequest{
		Type:     req.Type,
		Priority: req.Priority,
		Filter: EmailFilter{
			EmailAddress: req.EmailAddress,
			StartDate:    req.StartDate,
			EndDate:      req.EndDate,
			Subject:      req.Subject,
			From:         req.From,
			Folders:      req.Folders,
		},
		Context:  ctx,
		Timeout:  req.Timeout,
		Callback: callback,
		Metadata: req.Metadata,
	}

	// 创建订阅
	subscription, err := s.subscriptionMgr.Subscribe(subReq)
	if err != nil {
		return "", err
	}

	// 触发获取
	s.triggerFetch(subscription.Filter.RealMailbox)

	return subscription.ID, nil
}

// Unsubscribe 取消订阅
func (s *EmailFetchScheduler) Unsubscribe(subscriptionID string) error {
	return s.subscriptionMgr.Unsubscribe(subscriptionID)
}

// triggerFetch 触发邮件获取
func (s *EmailFetchScheduler) triggerFetch(realMailbox string) {
	s.workerPool.TriggerFetch(realMailbox)
}

// GetFetcherService 获取获取器服务实例
func (s *EmailFetchScheduler) GetFetcherService() *FetcherService {
	return s.fetcherService
}

// GetSubscriptionManager 获取订阅管理器实例
// 用于让TriggerService与EmailFetchScheduler共享同一个订阅管理器
func (s *EmailFetchScheduler) GetSubscriptionManager() *SubscriptionManager {
	return s.subscriptionMgr
}

// setupSubscriptionHooks 设置订阅钩子
func (s *EmailFetchScheduler) setupSubscriptionHooks() {
	s.subscriptionMgr.hooks = SubscriptionHooks{
		OnSubscribe: func(sub *Subscription) error {
			log.Printf("[Scheduler] New subscription: %s for %s", sub.ID, sub.Filter.EmailAddress)
			return nil
		},
		OnUnsubscribe: func(sub *Subscription) error {
			log.Printf("[Scheduler] Subscription removed: %s", sub.ID)

			// 检查是否需要清理Worker
			go func() {
				// 延迟100ms执行，确保订阅已经从管理器中移除
				time.Sleep(100 * time.Millisecond)

				// 检查是否还有其他订阅使用同一个真实邮箱
				remainingSubs := s.subscriptionMgr.GetSubscriptionsByRealMailbox(sub.Filter.RealMailbox)
				if len(remainingSubs) == 0 {
					log.Printf("[Scheduler] No remaining subscriptions for %s, cleaning up worker", sub.Filter.RealMailbox)
					// 触发Worker清理
					s.cleanupWorkerForMailbox(sub.Filter.RealMailbox)
				}
			}()

			return nil
		},
		OnEmailMatch: func(sub *Subscription, email models.Email) error {
			// 可以在这里添加额外的处理逻辑
			return nil
		},
		OnError: func(sub *Subscription, err error) {
			log.Printf("[Scheduler] Subscription %s error: %v", sub.ID, err)
		},
		OnExpire: func(sub *Subscription) {
			log.Printf("[Scheduler] Subscription %s expired", sub.ID)
		},
	}
}

// cleanupRoutine 清理例程
func (s *EmailFetchScheduler) cleanupRoutine() {
	defer s.wg.Done()

	ticker := time.NewTicker(s.config.CleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			// 清理过期缓存
			s.cache.Cleanup()

			// 清理过期订阅
			s.cleanupExpiredSubscriptions()

		case <-s.shutdownCh:
			return
		}
	}
}

// cleanupExpiredSubscriptions 清理过期订阅
func (s *EmailFetchScheduler) cleanupExpiredSubscriptions() {
	// 获取所有订阅
	for _, subType := range []SubscriptionType{
		SubscriptionTypeRealtime,
		SubscriptionTypeScheduled,
		SubscriptionTypeWebhook,
		SubscriptionTypePolling,
	} {
		subs := s.subscriptionMgr.GetSubscriptionsByType(subType)
		for _, sub := range subs {
			// 检查是否过期
			if sub.ExpiresAt != nil && time.Now().After(*sub.ExpiresAt) {
				s.subscriptionMgr.Unsubscribe(sub.ID)
			}
		}
	}
}

// prefetchRoutine 预取例程
func (s *EmailFetchScheduler) prefetchRoutine() {
	defer s.wg.Done()

	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.performPrefetch()

		case <-s.shutdownCh:
			return
		}
	}
}

// performPrefetch 执行预取
func (s *EmailFetchScheduler) performPrefetch() {
	// 分析使用模式并预取可能需要的邮件
	// 这里可以根据历史访问模式来预测
	log.Println("[Scheduler] Performing prefetch analysis")

	// TODO: 实现智能预取逻辑
}

// SubscribeToEvents 订阅特定订阅的事件
func (s *EmailFetchScheduler) SubscribeToEvents(subscriptionID string, eventChan EventChannel) {
	s.eventMu.Lock()
	defer s.eventMu.Unlock()

	if _, exists := s.eventSubscribers[subscriptionID]; !exists {
		s.eventSubscribers[subscriptionID] = []EventChannel{}
	}
	s.eventSubscribers[subscriptionID] = append(s.eventSubscribers[subscriptionID], eventChan)
}

// UnsubscribeFromEvents 取消订阅事件
func (s *EmailFetchScheduler) UnsubscribeFromEvents(subscriptionID string, eventChan EventChannel) {
	s.eventMu.Lock()
	defer s.eventMu.Unlock()

	if channels, exists := s.eventSubscribers[subscriptionID]; exists {
		for i, ch := range channels {
			if ch == eventChan {
				// 从切片中移除
				s.eventSubscribers[subscriptionID] = append(channels[:i], channels[i+1:]...)
				break
			}
		}

		// 如果没有订阅者了，删除整个条目
		if len(s.eventSubscribers[subscriptionID]) == 0 {
			delete(s.eventSubscribers, subscriptionID)
		}
	}
}

// PublishEvent 发布事件到订阅者
func (s *EmailFetchScheduler) PublishEvent(subscriptionID string, event EmailEvent) {
	s.eventMu.RLock()
	defer s.eventMu.RUnlock()

	if channels, exists := s.eventSubscribers[subscriptionID]; exists {
		for _, ch := range channels {
			select {
			case ch <- event:
				// 成功发送
			default:
				// 通道满了，跳过
				log.Printf("[Scheduler] Event channel full for subscription %s, skipping event", subscriptionID)
			}
		}
	}
}

// NotifyNewEmail 通知新邮件
func (s *EmailFetchScheduler) NotifyNewEmail(subscriptionID string, email *models.Email) {
	event := EmailEvent{
		Type:           EventTypeNewEmail,
		SubscriptionID: subscriptionID,
		Timestamp:      time.Now(),
		Data:           email,
	}
	s.PublishEvent(subscriptionID, event)
}

// NotifyFetchStart 通知开始获取
func (s *EmailFetchScheduler) NotifyFetchStart(subscriptionID string) {
	event := EmailEvent{
		Type:           EventTypeFetchStart,
		SubscriptionID: subscriptionID,
		Timestamp:      time.Now(),
	}
	s.PublishEvent(subscriptionID, event)
}

// NotifyFetchComplete 通知获取完成
func (s *EmailFetchScheduler) NotifyFetchComplete(subscriptionID string, emailsFetched int) {
	event := EmailEvent{
		Type:           EventTypeFetchComplete,
		SubscriptionID: subscriptionID,
		Timestamp:      time.Now(),
		Data: map[string]interface{}{
			"emails_fetched": emailsFetched,
		},
	}
	s.PublishEvent(subscriptionID, event)
}

// NotifyFetchError 通知获取错误
func (s *EmailFetchScheduler) NotifyFetchError(subscriptionID string, err error) {
	event := EmailEvent{
		Type:           EventTypeFetchError,
		SubscriptionID: subscriptionID,
		Timestamp:      time.Now(),
		Error:          err,
	}
	s.PublishEvent(subscriptionID, event)
}

// GetMetrics 获取调度器指标
func (s *EmailFetchScheduler) GetMetrics() SchedulerMetrics {
	return SchedulerMetrics{
		ActiveSubscriptions: s.subscriptionMgr.metrics.ActiveSubscriptions,
		TotalSubscriptions:  s.subscriptionMgr.metrics.TotalSubscriptions,
		EmailsDelivered:     s.subscriptionMgr.metrics.EmailsDelivered,
		CacheHitRate:        s.cache.GetHitRate(),
		ActiveWorkers:       s.workerPool.GetActiveWorkers(),
	}
}

// SchedulerMetrics 调度器指标
type SchedulerMetrics struct {
	ActiveSubscriptions int64
	TotalSubscriptions  int64
	EmailsDelivered     int64
	CacheHitRate        float64
	ActiveWorkers       int
}

// FetchRequest 获取请求
type FetchRequest struct {
	Type         SubscriptionType
	Priority     SubscriptionPriority
	EmailAddress string
	StartDate    *time.Time
	EndDate      *time.Time
	Subject      string
	From         string
	Folders      []string
	Timeout      time.Duration
	Metadata     map[string]interface{}
}

// SubscribeSimple 创建简单订阅（用于REST API）
func (s *EmailFetchScheduler) SubscribeSimple(
	accountID uint,
	emailAddress string,
	mailbox string,
	interval time.Duration,
	includeBody bool,
	filters interface{},
) (string, error) {
	// 创建订阅请求
	ctx := context.Background()
	req := FetchRequest{
		Type:         SubscriptionTypePolling,
		Priority:     PriorityNormal,
		EmailAddress: emailAddress, // 使用真实的邮箱地址
		Folders:      []string{mailbox},
		Timeout:      30 * time.Second,
		Metadata: map[string]interface{}{
			"accountID":   accountID,
			"includeBody": includeBody,
			"filters":     filters,
			"interval":    interval,
		},
	}

	// 使用回调方式订阅
	var subscriptionID string
	subscriptionID, err := s.SubscribeWithCallback(ctx, req, func(email models.Email) error {
		// 这里可以添加邮件处理逻辑，比如通过WebSocket推送
		log.Printf("[Subscription %s] New email: %s", subscriptionID, email.Subject)
		return nil
	})

	if err != nil {
		return "", err
	}

	return subscriptionID, nil
}

// GetSubscription 获取订阅信息
func (s *EmailFetchScheduler) GetSubscription(subscriptionID string) *Subscription {
	return s.subscriptionMgr.GetSubscription(subscriptionID)
}

// GetAllSubscriptions 获取所有订阅
func (s *EmailFetchScheduler) GetAllSubscriptions() []*Subscription {
	return s.subscriptionMgr.GetAllSubscriptions()
}

// GetAccountSubscriptions 获取账户的所有订阅
func (s *EmailFetchScheduler) GetAccountSubscriptions(accountID uint) []*Subscription {
	allSubs := s.subscriptionMgr.GetAllSubscriptions()
	var accountSubs []*Subscription

	for _, sub := range allSubs {
		if metadata, ok := sub.Metadata["accountID"].(uint); ok && metadata == accountID {
			accountSubs = append(accountSubs, sub)
		}
	}

	return accountSubs
}

// FetchNowResult 立即获取结果
type FetchNowResult struct {
	NewEmails       int
	ProcessedEmails int
	Error           error
}

// FetchNow 立即获取邮件
func (s *EmailFetchScheduler) FetchNow(subscriptionID string, forceRefresh bool) (*FetchNowResult, error) {
	sub := s.GetSubscription(subscriptionID)
	if sub == nil {
		return nil, fmt.Errorf("subscription not found")
	}

	// 触发获取
	s.triggerFetch(sub.Filter.RealMailbox)

	// 等待结果（这里简化处理，实际应该有更复杂的逻辑）
	result := &FetchNowResult{
		NewEmails:       0,
		ProcessedEmails: 0,
	}

	return result, nil
}

// GetCacheStats 获取缓存统计
func (s *EmailFetchScheduler) GetCacheStats() *CacheStats {
	stats := s.cache.GetStats()
	return &CacheStats{
		TotalMailboxes: stats.TotalMailboxes,
		TotalEmails:    stats.TotalEmails,
		HitRate:        stats.HitRate,
		Hits:           stats.Hits,
		Misses:         stats.Misses,
	}
}

// AccountCacheStats 账户缓存统计
type AccountCacheStats struct {
	EmailCount  int
	Size        int64
	OldestEmail *time.Time
	NewestEmail *time.Time
}

// GetAccountCacheStats 获取账户缓存统计
func (s *EmailFetchScheduler) GetAccountCacheStats(accountID uint) *AccountCacheStats {
	// 这里简化处理，实际应该从缓存中获取账户相关的统计
	return &AccountCacheStats{
		EmailCount: 0,
		Size:       0,
	}
}

// cleanupWorkerForMailbox 清理指定邮箱的Worker
func (s *EmailFetchScheduler) cleanupWorkerForMailbox(realMailbox string) {
	s.workerPool.mu.Lock()
	defer s.workerPool.mu.Unlock()

	if worker, exists := s.workerPool.workers[realMailbox]; exists {
		log.Printf("[Scheduler] Removing worker for %s", realMailbox)
		close(worker.shutdownCh)
		delete(s.workerPool.workers, realMailbox)
	}
}

// DispatchEmailEvent 手动分发邮件事件给所有匹配的订阅者
// 主要用于用户手动触发邮件事件以激活相关触发器
func (s *EmailFetchScheduler) DispatchEmailEvent(realMailbox string, email models.Email) {
	if s.subscriptionMgr == nil {
		log.Printf("[Scheduler] DispatchEmailEvent: subscriptionMgr is nil")
		return
	}
	log.Printf("[Scheduler] Dispatching email event for %s, email ID: %d, subject: %s",
		realMailbox, email.ID, email.Subject)
	s.subscriptionMgr.DistributeEmail(realMailbox, email)
}
