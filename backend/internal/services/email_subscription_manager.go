package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"mailman/internal/models"
	"mailman/internal/utils"
)

// SubscriptionType 定义订阅类型
type SubscriptionType string

const (
	SubscriptionTypeRealtime  SubscriptionType = "realtime"  // 实时查询
	SubscriptionTypeScheduled SubscriptionType = "scheduled" // 定时任务
	SubscriptionTypeWebhook   SubscriptionType = "webhook"   // Webhook推送
	SubscriptionTypePolling   SubscriptionType = "polling"   // 轮询模式
)

// SubscriptionPriority 定义订阅优先级
type SubscriptionPriority int

const (
	PriorityLow    SubscriptionPriority = 0
	PriorityNormal SubscriptionPriority = 1
	PriorityHigh   SubscriptionPriority = 2
	PriorityUrgent SubscriptionPriority = 3
)

// EmailFilter 邮件过滤器
type EmailFilter struct {
	EmailAddress  string            // 原始请求的邮箱地址（可能是别名）
	RealMailbox   string            // 真实邮箱地址
	StartDate     *time.Time        // 开始日期
	EndDate       *time.Time        // 结束日期
	Subject       string            // 主题过滤
	From          string            // 发件人过滤
	To            string            // 收件人过滤
	HasAttachment *bool             // 是否有附件
	Unread        *bool             // 是否未读
	Labels        []string          // 标签过滤
	Folders       []string          // 文件夹列表
	CustomFilters map[string]string // 自定义过滤器
}

// Subscription 订阅对象
type Subscription struct {
	ID         string
	Type       SubscriptionType
	Priority   SubscriptionPriority
	Filter     EmailFilter
	CreatedAt  time.Time
	ExpiresAt  *time.Time
	Context    context.Context
	CancelFunc context.CancelFunc

	// 账户信息
	AccountID uint
	Mailbox   string

	// 回调和通道
	EmailChannel chan models.Email
	ErrorChannel chan error
	Callback     func(email models.Email) error

	// 定时任务相关
	Schedule  string // Cron表达式
	LastRunAt *time.Time
	NextRunAt *time.Time

	// 统计信息
	EmailsReceived int64
	ErrorsCount    int64
	LastEmailAt    *time.Time

	// 扩展字段
	Metadata map[string]interface{}
	mu       sync.RWMutex
}

// SubscriptionManager 订阅管理器
type SubscriptionManager struct {
	subscriptions map[string]*Subscription   // key: subscriptionID
	byRealMailbox map[string][]*Subscription // key: realMailbox
	byType        map[SubscriptionType][]*Subscription
	byFingerprint map[string]*Subscription // key: subscription fingerprint for deduplication

	// 扩展接口
	hooks   SubscriptionHooks
	metrics *SubscriptionMetrics
	logger  *utils.Logger

	// 配置选项
	defaultExpirationTime time.Duration // 默认过期时间
	cleanupInterval       time.Duration // 清理间隔
	maxSubscriptions      int           // 最大订阅数量限制

	mu         sync.RWMutex
	wg         sync.WaitGroup
	shutdownCh chan struct{}
}

// SubscriptionHooks 扩展钩子接口
type SubscriptionHooks struct {
	OnSubscribe   func(sub *Subscription) error
	OnUnsubscribe func(sub *Subscription) error
	OnEmailMatch  func(sub *Subscription, email models.Email) error
	OnError       func(sub *Subscription, err error)
	OnExpire      func(sub *Subscription)
}

// SubscriptionMetrics 订阅指标
type SubscriptionMetrics struct {
	TotalSubscriptions  int64
	ActiveSubscriptions int64
	EmailsDelivered     int64
	ErrorsEncountered   int64
	AverageDeliveryTime time.Duration
	mu                  sync.RWMutex
}

// NewSubscriptionManager 创建订阅管理器
func NewSubscriptionManager() *SubscriptionManager {
	mgr := &SubscriptionManager{
		subscriptions:         make(map[string]*Subscription),
		byRealMailbox:         make(map[string][]*Subscription),
		byType:                make(map[SubscriptionType][]*Subscription),
		byFingerprint:         make(map[string]*Subscription),
		metrics:               &SubscriptionMetrics{},
		logger:                utils.NewLogger("SubscriptionManager"),
		defaultExpirationTime: 24 * time.Hour,  // 默认24小时过期
		cleanupInterval:       5 * time.Minute, // 5分钟清理一次
		maxSubscriptions:      1000,            // 最大1000个订阅
		shutdownCh:            make(chan struct{}),
	}

	// 启动定期清理任务
	mgr.StartPeriodicCleanup()

	return mgr
}

// Subscribe 创建订阅
func (m *SubscriptionManager) Subscribe(req SubscribeRequest) (*Subscription, error) {
	// 检查订阅数量限制
	m.mu.RLock()
	if len(m.subscriptions) >= m.maxSubscriptions {
		m.mu.RUnlock()
		return nil, fmt.Errorf("subscription limit reached: %d", m.maxSubscriptions)
	}
	m.mu.RUnlock()

	// 生成订阅指纹用于去重
	fingerprint := m.generateSubscriptionFingerprint(req)

	// 检查是否已存在相同的订阅
	m.mu.RLock()
	if existingSub, exists := m.byFingerprint[fingerprint]; exists {
		// 检查现有订阅是否仍然有效
		if m.isSubscriptionActive(existingSub) {
			m.mu.RUnlock()
			m.logger.Info("Reusing existing subscription %s for fingerprint %s",
				existingSub.ID, fingerprint)
			return existingSub, nil
		}
		// 如果现有订阅已失效，需要完全清理
		subscriptionID := existingSub.ID
		m.mu.RUnlock()

		// 完全清理失效的订阅
		m.logger.Info("Cleaning up inactive subscription %s for fingerprint %s",
			subscriptionID, fingerprint)
		if err := m.Unsubscribe(subscriptionID); err != nil {
			m.logger.Warn("Failed to cleanup inactive subscription %s: %v",
				subscriptionID, err)
		}
	} else {
		m.mu.RUnlock()
	}

	// 设置默认过期时间
	expiresAt := req.ExpiresAt
	if expiresAt == nil && m.defaultExpirationTime > 0 {
		expireTime := time.Now().Add(m.defaultExpirationTime)
		expiresAt = &expireTime
		m.logger.Debug("Setting default expiration time: %v", expireTime)
	}

	// 创建订阅上下文
	ctx, cancel := context.WithCancel(req.Context)
	if req.Timeout > 0 {
		ctx, cancel = context.WithTimeout(req.Context, req.Timeout)
	}

	subscription := &Subscription{
		ID:           generateSubscriptionID(),
		Type:         req.Type,
		Priority:     req.Priority,
		Filter:       req.Filter,
		CreatedAt:    time.Now(),
		ExpiresAt:    expiresAt,
		Context:      ctx,
		CancelFunc:   cancel,
		EmailChannel: make(chan models.Email, req.ChannelBuffer),
		ErrorChannel: make(chan error, 10),
		Callback:     req.Callback,
		Schedule:     req.Schedule,
		Metadata:     req.Metadata,
	}

	// 解析真实邮箱
	subscription.Filter.RealMailbox = m.resolveRealMailbox(req.Filter.EmailAddress)

	// 执行订阅钩子
	if m.hooks.OnSubscribe != nil {
		if err := m.hooks.OnSubscribe(subscription); err != nil {
			cancel()
			return nil, fmt.Errorf("subscription hook failed: %w", err)
		}
	}

	// 注册订阅
	m.mu.Lock()
	m.subscriptions[subscription.ID] = subscription
	m.byRealMailbox[subscription.Filter.RealMailbox] = append(
		m.byRealMailbox[subscription.Filter.RealMailbox],
		subscription,
	)
	m.byType[subscription.Type] = append(m.byType[subscription.Type], subscription)
	m.byFingerprint[fingerprint] = subscription // 添加指纹索引
	m.metrics.TotalSubscriptions++
	m.metrics.ActiveSubscriptions++
	m.mu.Unlock()

	// 启动订阅监控
	m.wg.Add(1)
	go m.monitorSubscription(subscription)

	m.logger.Info("Created subscription %s for %s (real: %s, fingerprint: %s, expires: %v)",
		subscription.ID, req.Filter.EmailAddress, subscription.Filter.RealMailbox, fingerprint, expiresAt)

	return subscription, nil
}

// Unsubscribe 取消订阅
func (m *SubscriptionManager) Unsubscribe(subscriptionID string) error {
	m.mu.Lock()
	subscription, exists := m.subscriptions[subscriptionID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("subscription %s not found", subscriptionID)
	}

	// 从索引中移除
	delete(m.subscriptions, subscriptionID)
	m.byRealMailbox[subscription.Filter.RealMailbox] = m.removeFromIndex(m.byRealMailbox[subscription.Filter.RealMailbox], subscription)
	m.byType[subscription.Type] = m.removeFromIndex(m.byType[subscription.Type], subscription)

	// 从指纹索引中移除
	fingerprint := m.generateSubscriptionFingerprintFromSub(subscription)
	delete(m.byFingerprint, fingerprint)

	m.metrics.ActiveSubscriptions--
	m.mu.Unlock()

	// 执行取消订阅钩子
	if m.hooks.OnUnsubscribe != nil {
		m.hooks.OnUnsubscribe(subscription)
	}

	// 取消上下文
	subscription.CancelFunc()

	// 关闭通道
	close(subscription.EmailChannel)
	close(subscription.ErrorChannel)

	m.logger.Info("Unsubscribed %s (fingerprint: %s)", subscriptionID, fingerprint)
	return nil
}

// GetSubscriptionsByRealMailbox 获取真实邮箱的所有订阅
func (m *SubscriptionManager) GetSubscriptionsByRealMailbox(realMailbox string) []*Subscription {
	m.mu.RLock()
	defer m.mu.RUnlock()

	subs := m.byRealMailbox[realMailbox]
	result := make([]*Subscription, len(subs))
	copy(result, subs)
	return result
}

// GetSubscriptionsByType 按类型获取订阅
func (m *SubscriptionManager) GetSubscriptionsByType(subType SubscriptionType) []*Subscription {
	m.mu.RLock()
	defer m.mu.RUnlock()

	subs := m.byType[subType]
	result := make([]*Subscription, len(subs))
	copy(result, subs)
	return result
}

// DistributeEmail 分发邮件给订阅者
func (m *SubscriptionManager) DistributeEmail(realMailbox string, email models.Email) {
	startTime := time.Now()

	m.mu.RLock()
	subscriptions := m.byRealMailbox[realMailbox]
	m.mu.RUnlock()

	var delivered int64
	for _, sub := range subscriptions {
		// 检查订阅是否有效
		if !m.isSubscriptionActive(sub) {
			continue
		}

		// 应用过滤器
		if !m.matchesFilter(email, sub.Filter) {
			continue
		}

		// 执行邮件匹配钩子
		if m.hooks.OnEmailMatch != nil {
			if err := m.hooks.OnEmailMatch(sub, email); err != nil {
				m.logger.Error("Email match hook failed: %v", err)
				continue
			}
		}

		// 分发邮件
		if err := m.deliverEmail(sub, email); err != nil {
			m.logger.Error("Failed to deliver email to %s: %v", sub.ID, err)
			m.sendError(sub, err)
		} else {
			delivered++
			sub.mu.Lock()
			sub.EmailsReceived++
			now := time.Now()
			sub.LastEmailAt = &now
			sub.mu.Unlock()
		}
	}

	// 更新指标
	m.metrics.mu.Lock()
	m.metrics.EmailsDelivered += delivered
	deliveryTime := time.Since(startTime)
	if m.metrics.AverageDeliveryTime == 0 {
		m.metrics.AverageDeliveryTime = deliveryTime
	} else {
		m.metrics.AverageDeliveryTime = (m.metrics.AverageDeliveryTime + deliveryTime) / 2
	}
	m.metrics.mu.Unlock()

	m.logger.Debug("Distributed email to %d/%d subscriptions for %s",
		delivered, len(subscriptions), realMailbox)
}

// deliverEmail 投递邮件给订阅者
func (m *SubscriptionManager) deliverEmail(sub *Subscription, email models.Email) error {
	// 优先使用回调
	if sub.Callback != nil {
		return sub.Callback(email)
	}

	// 使用通道
	select {
	case sub.EmailChannel <- email:
		return nil
	case <-time.After(100 * time.Millisecond):
		return fmt.Errorf("email channel blocked")
	case <-sub.Context.Done():
		return fmt.Errorf("subscription cancelled")
	}
}

// matchesFilter 检查邮件是否匹配过滤器
func (m *SubscriptionManager) matchesFilter(email models.Email, filter EmailFilter) bool {
	// 获取邮件主题的前50个字符用于日志
	subjectPreview := email.Subject
	if len(subjectPreview) > 50 {
		subjectPreview = subjectPreview[:50] + "..."
	}

	m.logger.Debug("检查邮件: %s", subjectPreview)

	var filterResults []string
	allMatched := true

	// 检查时间范围
	if filter.StartDate != nil {
		if email.Date.Before(*filter.StartDate) {
			filterResults = append(filterResults, fmt.Sprintf("  ❌ 时间过滤失败: 邮件时间 %v 早于开始时间 %v", email.Date, *filter.StartDate))
			allMatched = false
		} else {
			filterResults = append(filterResults, fmt.Sprintf("  ✓ 时间过滤通过: 邮件时间 %v 晚于开始时间 %v", email.Date, *filter.StartDate))
		}
	}

	if filter.EndDate != nil {
		if email.Date.After(*filter.EndDate) {
			filterResults = append(filterResults, fmt.Sprintf("  ❌ 结束时间过滤失败: 邮件时间 %v 晚于结束时间 %v", email.Date, *filter.EndDate))
			allMatched = false
		} else {
			filterResults = append(filterResults, fmt.Sprintf("  ✓ 结束时间过滤通过: 邮件时间 %v 早于结束时间 %v", email.Date, *filter.EndDate))
		}
	}

	// 检查文件夹
	if len(filter.Folders) > 0 {
		if !contains(filter.Folders, email.MailboxName) {
			filterResults = append(filterResults, fmt.Sprintf("  ❌ 文件夹过滤失败: 邮件在 '%s'，但允许的文件夹为 %v", email.MailboxName, filter.Folders))
			allMatched = false
		} else {
			filterResults = append(filterResults, fmt.Sprintf("  ✓ 文件夹过滤通过: 邮件在允许的文件夹 '%s'", email.MailboxName))
		}
	}

	// 检查别名匹配
	if filter.EmailAddress != "" {
		if !m.matchesAlias(email, filter.EmailAddress) {
			filterResults = append(filterResults, fmt.Sprintf("  ❌ 别名匹配失败: 邮件收件人 %v 不包含 %s", email.To, filter.EmailAddress))
			allMatched = false
		} else {
			filterResults = append(filterResults, "  ✓ 别名匹配通过")
		}
	}

	// 检查主题
	if filter.Subject != "" {
		if !containsIgnoreCase(email.Subject, filter.Subject) {
			filterResults = append(filterResults, fmt.Sprintf("  ❌ 主题过滤失败: 邮件主题 '%s' 不包含 '%s'", subjectPreview, filter.Subject))
			allMatched = false
		} else {
			filterResults = append(filterResults, fmt.Sprintf("  ✓ 主题过滤通过: 邮件主题包含 '%s'", filter.Subject))
		}
	}

	// 检查发件人
	if filter.From != "" {
		if !m.matchesAddress(email.From, filter.From) {
			filterResults = append(filterResults, fmt.Sprintf("  ❌ 发件人过滤失败: 邮件发件人 '%v' 不匹配 '%s'", email.From, filter.From))
			allMatched = false
		} else {
			filterResults = append(filterResults, fmt.Sprintf("  ✓ 发件人过滤通过: 邮件发件人匹配 '%s'", filter.From))
		}
	}

	// 检查收件人
	if filter.To != "" {
		if !m.matchesAddress(email.To, filter.To) {
			filterResults = append(filterResults, fmt.Sprintf("  ❌ 收件人过滤失败: 邮件收件人 '%v' 不匹配 '%s'", email.To, filter.To))
			allMatched = false
		} else {
			filterResults = append(filterResults, fmt.Sprintf("  ✓ 收件人过滤通过: 邮件收件人匹配 '%s'", filter.To))
		}
	}

	// 检查附件
	if filter.HasAttachment != nil {
		hasAttachment := len(email.Attachments) > 0
		if *filter.HasAttachment != hasAttachment {
			filterResults = append(filterResults, fmt.Sprintf("  ❌ 附件过滤失败: 要求有附件=%v，实际有附件=%v", *filter.HasAttachment, hasAttachment))
			allMatched = false
		} else {
			filterResults = append(filterResults, fmt.Sprintf("  ✓ 附件过滤通过: 附件要求=%v", *filter.HasAttachment))
		}
	}

	// 自定义过滤器扩展点
	if len(filter.CustomFilters) > 0 {
		filterResults = append(filterResults, "  ⚠️  自定义过滤器待实现")
	}

	// 输出所有过滤结果
	for _, result := range filterResults {
		m.logger.Debug("%s", result)
	}

	// 输出最终结果
	if allMatched {
		m.logger.Debug("  ✅ 邮件通过所有过滤条件")
	} else {
		m.logger.Debug("  ❌ 邮件会被过滤掉")
	}

	return allMatched
}

// monitorSubscription 监控订阅生命周期
func (m *SubscriptionManager) monitorSubscription(sub *Subscription) {
	defer m.wg.Done()

	// 使用配置的清理间隔，但不超过30秒
	interval := m.cleanupInterval
	if interval > 30*time.Second {
		interval = 30 * time.Second
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-sub.Context.Done():
			// 订阅被取消
			m.Unsubscribe(sub.ID)
			return

		case <-ticker.C:
			// 检查过期
			if sub.ExpiresAt != nil && time.Now().After(*sub.ExpiresAt) {
				m.logger.Info("Subscription %s expired at %v", sub.ID, *sub.ExpiresAt)
				if m.hooks.OnExpire != nil {
					m.hooks.OnExpire(sub)
				}
				m.Unsubscribe(sub.ID)
				return
			}

		case <-m.shutdownCh:
			// 管理器关闭
			return
		}
	}
}

// Shutdown 关闭订阅管理器
func (m *SubscriptionManager) Shutdown() {
	close(m.shutdownCh)

	// 取消所有订阅
	m.mu.Lock()
	for _, sub := range m.subscriptions {
		sub.CancelFunc()
	}
	m.mu.Unlock()

	// 等待所有监控协程退出
	m.wg.Wait()
}

// 辅助函数
func (m *SubscriptionManager) removeFromIndex(slice []*Subscription, sub *Subscription) []*Subscription {
	for i, s := range slice {
		if s.ID == sub.ID {
			// 使用正确的切片移除方法
			return append(slice[:i], slice[i+1:]...)
		}
	}
	return slice
}

func (m *SubscriptionManager) isSubscriptionActive(sub *Subscription) bool {
	select {
	case <-sub.Context.Done():
		return false
	default:
		return true
	}
}

func (m *SubscriptionManager) sendError(sub *Subscription, err error) {
	sub.mu.Lock()
	sub.ErrorsCount++
	sub.mu.Unlock()

	if m.hooks.OnError != nil {
		m.hooks.OnError(sub, err)
	}

	// 使用defer recover来处理向已关闭channel发送数据的panic
	func() {
		defer func() {
			if r := recover(); r != nil {
				// channel已关闭，忽略错误
				m.logger.Warn("Failed to send error to subscription %s: channel closed", sub.ID)
			}
		}()

		select {
		case sub.ErrorChannel <- err:
		default:
			// 错误通道已满
		}
	}()
}

// SubscribeRequest 订阅请求
type SubscribeRequest struct {
	Type          SubscriptionType
	Priority      SubscriptionPriority
	Filter        EmailFilter
	Context       context.Context
	Timeout       time.Duration
	ExpiresAt     *time.Time
	Callback      func(email models.Email) error
	ChannelBuffer int
	Schedule      string                 // Cron表达式（用于定时任务）
	Metadata      map[string]interface{} // 扩展元数据
}

// GetSubscription 获取单个订阅
func (m *SubscriptionManager) GetSubscription(subscriptionID string) *Subscription {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.subscriptions[subscriptionID]
}

// GetAllSubscriptions 获取所有订阅
func (m *SubscriptionManager) GetAllSubscriptions() []*Subscription {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*Subscription, 0, len(m.subscriptions))
	for _, sub := range m.subscriptions {
		result = append(result, sub)
	}
	return result
}

// SetDefaultExpirationTime 设置默认过期时间
func (m *SubscriptionManager) SetDefaultExpirationTime(duration time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.defaultExpirationTime = duration
	m.logger.Info("Default expiration time set to %v", duration)
}

// SetCleanupInterval 设置清理间隔
func (m *SubscriptionManager) SetCleanupInterval(interval time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleanupInterval = interval
	m.logger.Info("Cleanup interval set to %v", interval)
}

// SetMaxSubscriptions 设置最大订阅数量
func (m *SubscriptionManager) SetMaxSubscriptions(max int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.maxSubscriptions = max
	m.logger.Info("Max subscriptions set to %d", max)
}

// CleanupExpiredSubscriptions 批量清理过期订阅
func (m *SubscriptionManager) CleanupExpiredSubscriptions() int {
	m.mu.RLock()
	var expiredIDs []string
	now := time.Now()

	for id, sub := range m.subscriptions {
		if sub.ExpiresAt != nil && now.After(*sub.ExpiresAt) {
			expiredIDs = append(expiredIDs, id)
		}
	}
	m.mu.RUnlock()

	// 批量删除过期订阅
	for _, id := range expiredIDs {
		if err := m.Unsubscribe(id); err != nil {
			m.logger.Error("Failed to cleanup expired subscription %s: %v", id, err)
		}
	}

	if len(expiredIDs) > 0 {
		m.logger.Info("Cleaned up %d expired subscriptions", len(expiredIDs))
	}

	return len(expiredIDs)
}

// CleanupInactiveSubscriptions 清理不活跃的订阅
func (m *SubscriptionManager) CleanupInactiveSubscriptions() int {
	m.mu.RLock()
	var inactiveIDs []string

	for id, sub := range m.subscriptions {
		if !m.isSubscriptionActive(sub) {
			inactiveIDs = append(inactiveIDs, id)
		}
	}
	m.mu.RUnlock()

	// 批量删除不活跃订阅
	for _, id := range inactiveIDs {
		if err := m.Unsubscribe(id); err != nil {
			m.logger.Error("Failed to cleanup inactive subscription %s: %v", id, err)
		}
	}

	if len(inactiveIDs) > 0 {
		m.logger.Info("Cleaned up %d inactive subscriptions", len(inactiveIDs))
	}

	return len(inactiveIDs)
}

// GetSubscriptionStats 获取订阅统计信息
func (m *SubscriptionManager) GetSubscriptionStats() map[string]interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()

	stats := map[string]interface{}{
		"total_subscriptions":   len(m.subscriptions),
		"active_subscriptions":  m.metrics.ActiveSubscriptions,
		"emails_delivered":      m.metrics.EmailsDelivered,
		"errors_encountered":    m.metrics.ErrorsEncountered,
		"average_delivery_time": m.metrics.AverageDeliveryTime.String(),
		"default_expiration":    m.defaultExpirationTime.String(),
		"cleanup_interval":      m.cleanupInterval.String(),
		"max_subscriptions":     m.maxSubscriptions,
	}

	// 按类型统计
	typeStats := make(map[string]int)
	for subType, subs := range m.byType {
		typeStats[string(subType)] = len(subs)
	}
	stats["by_type"] = typeStats

	// 按邮箱统计
	mailboxStats := make(map[string]int)
	for mailbox, subs := range m.byRealMailbox {
		mailboxStats[mailbox] = len(subs)
	}
	stats["by_mailbox"] = mailboxStats

	return stats
}

// StartPeriodicCleanup 启动定期清理任务
func (m *SubscriptionManager) StartPeriodicCleanup() {
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()

		ticker := time.NewTicker(m.cleanupInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				// 执行清理任务
				expiredCount := m.CleanupExpiredSubscriptions()
				inactiveCount := m.CleanupInactiveSubscriptions()

				if expiredCount > 0 || inactiveCount > 0 {
					m.logger.Info("Periodic cleanup: %d expired, %d inactive",
						expiredCount, inactiveCount)
				}

			case <-m.shutdownCh:
				m.logger.Info("Periodic cleanup stopped")
				return
			}
		}
	}()

	m.logger.Info("Started periodic cleanup with interval %v", m.cleanupInterval)
}
