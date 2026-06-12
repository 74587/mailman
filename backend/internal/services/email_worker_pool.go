package services

import (
	"fmt"
	"log"
	"sync"
	"time"

	"mailman/internal/models"
)

// WorkerPool 工作池
type WorkerPool struct {
	maxWorkers int
	workers    map[string]*MailboxWorker // key: realMailbox
	scheduler  *EmailFetchScheduler
	shutdownCh chan struct{}
	wg         sync.WaitGroup
	mu         sync.RWMutex
}

// MailboxWorker 邮箱工作器
type MailboxWorker struct {
	ID            string
	RealMailbox   string
	Account       *models.EmailAccount
	FetchTrigger  chan struct{}
	LastFetchTime time.Time
	Fetching      bool
	scheduler     *EmailFetchScheduler
	shutdownCh    chan struct{}
	mu            sync.Mutex
}

// NewWorkerPool 创建工作池
func NewWorkerPool(maxWorkers int, scheduler *EmailFetchScheduler) *WorkerPool {
	return &WorkerPool{
		maxWorkers: maxWorkers,
		workers:    make(map[string]*MailboxWorker),
		scheduler:  scheduler,
		shutdownCh: make(chan struct{}),
	}
}

// Start 启动工作池
func (p *WorkerPool) Start() {
	log.Printf("[WorkerPool] Started with max workers: %d", p.maxWorkers)
}

// Stop 停止工作池
func (p *WorkerPool) Stop() {
	close(p.shutdownCh)

	// 停止所有工作器
	p.mu.RLock()
	for _, worker := range p.workers {
		close(worker.shutdownCh)
	}
	p.mu.RUnlock()

	// 等待所有工作器退出
	p.wg.Wait()

	log.Println("[WorkerPool] Stopped")
}

// TriggerFetch 触发邮件获取
func (p *WorkerPool) TriggerFetch(realMailbox string) {
	p.mu.Lock()
	worker, exists := p.workers[realMailbox]
	if !exists {
		// 创建新的工作器
		worker = p.createWorker(realMailbox)
		p.workers[realMailbox] = worker

		// 启动工作器
		p.wg.Add(1)
		go worker.Run()
	}
	p.mu.Unlock()

	// 非阻塞发送触发信号
	select {
	case worker.FetchTrigger <- struct{}{}:
		log.Printf("[WorkerPool] Triggered fetch for %s", realMailbox)
	default:
		// 已经有待处理的触发信号
		log.Printf("[WorkerPool] Fetch already pending for %s", realMailbox)
	}
}

// createWorker 创建工作器
func (p *WorkerPool) createWorker(realMailbox string) *MailboxWorker {
	return &MailboxWorker{
		ID:           fmt.Sprintf("worker_%s_%d", realMailbox, time.Now().Unix()),
		RealMailbox:  realMailbox,
		FetchTrigger: make(chan struct{}, 1),
		scheduler:    p.scheduler,
		shutdownCh:   make(chan struct{}),
	}
}

// GetActiveWorkers 获取活跃工作器数量
func (p *WorkerPool) GetActiveWorkers() int {
	p.mu.RLock()
	defer p.mu.RUnlock()

	count := 0
	for _, worker := range p.workers {
		worker.mu.Lock()
		if worker.Fetching {
			count++
		}
		worker.mu.Unlock()
	}
	return count
}

// Run 运行工作器
func (w *MailboxWorker) Run() {
	defer w.scheduler.workerPool.wg.Done()

	log.Printf("[Worker %s] Started for mailbox %s", w.ID, w.RealMailbox)

	// 防抖动定时器
	debounceTimer := time.NewTimer(0)
	debounceTimer.Stop()

	for {
		select {
		case <-w.FetchTrigger:
			// 重置防抖动定时器
			debounceTimer.Stop()
			debounceTimer = time.NewTimer(w.scheduler.config.MinFetchInterval)

		case <-debounceTimer.C:
			// 执行获取
			w.performFetch()

		case <-w.shutdownCh:
			log.Printf("[Worker %s] Shutting down", w.ID)
			return

		case <-w.scheduler.shutdownCh:
			log.Printf("[Worker %s] Scheduler shutdown", w.ID)
			return
		}
	}
}

// performFetch 执行邮件获取
func (w *MailboxWorker) performFetch() {
	w.mu.Lock()
	if w.Fetching {
		w.mu.Unlock()
		return
	}
	w.Fetching = true
	w.mu.Unlock()

	defer func() {
		w.mu.Lock()
		w.Fetching = false
		w.LastFetchTime = time.Now()
		w.mu.Unlock()
	}()

	log.Printf("[Worker %s] Starting fetch for %s", w.ID, w.RealMailbox)

	// 获取该邮箱的所有订阅
	subscriptions := w.scheduler.subscriptionMgr.GetSubscriptionsByRealMailbox(w.RealMailbox)
	if len(subscriptions) == 0 {
		log.Printf("[Worker %s] No active subscriptions", w.ID)
		return
	}

	// 计算合并的获取策略
	strategy := w.calculateFetchStrategy(subscriptions)

	// 检查缓存
	cachedEmails, cacheHit := w.scheduler.cache.GetEmailsInRange(
		w.RealMailbox,
		strategy.EarliestDate,
		strategy.LatestDate,
	)

	// 如果缓存能满足所有需求，直接分发
	if cacheHit && w.canServeFromCache(strategy, cachedEmails) {
		log.Printf("[Worker %s] Serving %d emails from cache", w.ID, len(cachedEmails))
		w.distributeEmails(cachedEmails)
		return
	}

	// 获取账户信息
	if w.Account == nil {
		account, err := w.loadAccount()
		if err != nil {
			log.Printf("[Worker %s] Failed to load account: %v", w.ID, err)
			w.notifyError(fmt.Errorf("failed to load account: %w", err))
			return
		}
		w.Account = account
	}

	// 从服务器获取邮件
	options := FetchEmailsOptions{
		Mailbox:         "INBOX", // 这个字段在使用 FetchEmailsFromMultipleMailboxes 时会被忽略
		StartDate:       &strategy.EarliestDate,
		EndDate:         &strategy.LatestDate,
		FetchFromServer: true,
		IncludeBody:     true,
		Folders:         strategy.Folders, // 使用策略中的文件夹列表
		Source:          EmailIngestSourceAutoSync,
	}

	emails, err := w.scheduler.fetcherService.FetchEmailsFromMultipleMailboxes(*w.Account, options)
	if err != nil {
		log.Printf("[Worker %s] Failed to fetch emails: %v", w.ID, err)
		w.notifyError(err)
		return
	}

	log.Printf("[Worker %s] Fetched %d emails from server", w.ID, len(emails))

	// 转换为指针切片
	emailPtrs := make([]*models.Email, len(emails))
	for i := range emails {
		emailPtrs[i] = &emails[i]
	}

	// 更新缓存
	w.scheduler.cache.AddEmails(w.RealMailbox, emailPtrs)

	// 分发邮件
	w.distributeEmails(emailPtrs)
}

// calculateFetchStrategy 计算获取策略
func (w *MailboxWorker) calculateFetchStrategy(subscriptions []*Subscription) FetchStrategy {
	strategy := FetchStrategy{
		RealMailbox:  w.RealMailbox,
		EarliestDate: time.Now(),
		LatestDate:   time.Time{},
		Folders:      []string{},
	}

	// 使用 map 来去重文件夹
	foldersMap := make(map[string]bool)

	// 找出最早和最晚的时间，以及所有需要同步的文件夹
	for _, sub := range subscriptions {
		if sub.Filter.StartDate != nil && sub.Filter.StartDate.Before(strategy.EarliestDate) {
			strategy.EarliestDate = *sub.Filter.StartDate
		}
		if sub.Filter.EndDate != nil && sub.Filter.EndDate.After(strategy.LatestDate) {
			strategy.LatestDate = *sub.Filter.EndDate
		}

		// 收集文件夹
		for _, folder := range sub.Filter.Folders {
			foldersMap[folder] = true
		}
	}

	// 如果没有指定结束时间，使用当前时间
	if strategy.LatestDate.IsZero() {
		strategy.LatestDate = time.Now()
	}

	// 将文件夹 map 转换为切片
	for folder := range foldersMap {
		strategy.Folders = append(strategy.Folders, folder)
	}

	// 如果没有指定文件夹，默认使用 INBOX
	if len(strategy.Folders) == 0 {
		strategy.Folders = []string{"INBOX"}
	}

	return strategy
}

// canServeFromCache 检查是否可以从缓存服务
func (w *MailboxWorker) canServeFromCache(strategy FetchStrategy, cachedEmails []*models.Email) bool {
	// 检查缓存是否过期
	if time.Since(w.LastFetchTime) >= w.scheduler.config.CacheDuration {
		return false
	}

	// 如果缓存为空，不能使用缓存
	if len(cachedEmails) == 0 {
		return false
	}

	// 检查缓存是否覆盖到当前时间
	// 找出缓存中最新的邮件时间
	var latestEmailTime time.Time
	for _, email := range cachedEmails {
		if email.Date.After(latestEmailTime) {
			latestEmailTime = email.Date
		}
	}

	// 如果最新邮件时间距离现在超过1分钟，可能有新邮件
	// 需要重新获取
	timeSinceLatest := time.Since(latestEmailTime)
	if timeSinceLatest > 1*time.Minute {
		log.Printf("[Worker %s] Cache might be stale, latest email is %v old", w.ID, timeSinceLatest)
		return false
	}

	return true
}

// distributeEmails 分发邮件
func (w *MailboxWorker) distributeEmails(emails []*models.Email) {
	for _, email := range emails {
		w.scheduler.subscriptionMgr.DistributeEmail(w.RealMailbox, *email)
	}
}

// notifyError 通知错误
func (w *MailboxWorker) notifyError(err error) {
	subscriptions := w.scheduler.subscriptionMgr.GetSubscriptionsByRealMailbox(w.RealMailbox)
	for _, sub := range subscriptions {
		// 使用defer recover来处理向已关闭channel发送数据的panic
		func() {
			defer func() {
				if r := recover(); r != nil {
					// channel已关闭，忽略错误
					log.Printf("[Worker %s] Failed to send error to subscription %s: channel closed", w.ID, sub.ID)
				}
			}()

			select {
			case sub.ErrorChannel <- err:
			default:
				// 错误通道已满
			}
		}()
	}
}

// loadAccount 加载账户信息
func (w *MailboxWorker) loadAccount() (*models.EmailAccount, error) {
	// 根据邮箱地址查找账户，需要预加载MailProvider信息
	account, err := w.scheduler.accountRepo.GetByEmailWithProvider(w.RealMailbox)
	if err != nil {
		return nil, fmt.Errorf("failed to load account for %s: %w", w.RealMailbox, err)
	}

	if account == nil {
		return nil, fmt.Errorf("account not found for %s", w.RealMailbox)
	}

	return account, nil
}

// removeWorker 从工作池中移除Worker
func (p *WorkerPool) removeWorker(realMailbox string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if worker, exists := p.workers[realMailbox]; exists {
		log.Printf("[WorkerPool] Removing worker for %s", realMailbox)
		close(worker.shutdownCh)
		delete(p.workers, realMailbox)
	}
}

// RemoveWorkerIfNoSubscriptions 如果没有订阅则移除Worker（供外部调用）
func (p *WorkerPool) RemoveWorkerIfNoSubscriptions(realMailbox string) {
	// 检查是否还有订阅
	subs := p.scheduler.subscriptionMgr.GetSubscriptionsByRealMailbox(realMailbox)
	if len(subs) == 0 {
		p.removeWorker(realMailbox)
	}
}

// FetchStrategy 获取策略
type FetchStrategy struct {
	RealMailbox  string
	EarliestDate time.Time
	LatestDate   time.Time
	Folders      []string // 要同步的文件夹列表
}
