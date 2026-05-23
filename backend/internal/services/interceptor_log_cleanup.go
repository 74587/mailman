package services

import (
	"log"
	"sync"
	"time"

	"mailman/internal/repository"

	"gorm.io/gorm"
)

// InterceptorLogCleanupService 日志清理服务
type InterceptorLogCleanupService struct {
	db            *gorm.DB
	repo          *repository.InterceptorRepository
	retentionDays int
	cleanupTicker *time.Ticker
	stopChan      chan struct{}
	wg            sync.WaitGroup
	started       bool
	mu            sync.Mutex
}

// NewInterceptorLogCleanupService 创建日志清理服务
func NewInterceptorLogCleanupService(db *gorm.DB, retentionDays int) *InterceptorLogCleanupService {
	if retentionDays <= 0 {
		retentionDays = 30 // 默认30天
	}
	return &InterceptorLogCleanupService{
		db:            db,
		repo:          repository.NewInterceptorRepository(db),
		retentionDays: retentionDays,
		stopChan:      make(chan struct{}),
	}
}

// Start 启动清理服务
func (s *InterceptorLogCleanupService) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.started {
		return
	}

	s.started = true
	s.cleanupTicker = time.NewTicker(1 * time.Hour)

	log.Printf("[InterceptorLogCleanup] Started with retention: %d days, cleanup interval: 1 hour", s.retentionDays)

	// 启动时执行一次清理
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()

		// 首次启动延迟10秒执行，避免与其他启动任务冲突
		time.Sleep(10 * time.Second)
		s.cleanup()

		for {
			select {
			case <-s.cleanupTicker.C:
				s.cleanup()
			case <-s.stopChan:
				return
			}
		}
	}()
}

// Stop 停止清理服务
func (s *InterceptorLogCleanupService) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.started {
		return
	}

	s.started = false
	if s.cleanupTicker != nil {
		s.cleanupTicker.Stop()
	}
	close(s.stopChan)
	s.wg.Wait()

	log.Printf("[InterceptorLogCleanup] Stopped")
}

// cleanup 执行清理
func (s *InterceptorLogCleanupService) cleanup() {
	deleted, err := s.repo.DeleteOldLogs(s.retentionDays)
	if err != nil {
		log.Printf("[InterceptorLogCleanup] Error deleting old logs: %v", err)
		return
	}

	if deleted > 0 {
		log.Printf("[InterceptorLogCleanup] Deleted %d logs older than %d days", deleted, s.retentionDays)
	}
}

// SetRetentionDays 更新保留天数
func (s *InterceptorLogCleanupService) SetRetentionDays(days int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if days > 0 {
		s.retentionDays = days
		log.Printf("[InterceptorLogCleanup] Retention days updated to: %d", days)
	}
}

// GetRetentionDays 获取当前保留天数
func (s *InterceptorLogCleanupService) GetRetentionDays() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.retentionDays
}
