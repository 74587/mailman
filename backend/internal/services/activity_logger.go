package services

import (
	"fmt"
	stdlog "log"
	"sync"

	"mailman/internal/models"
	"mailman/internal/repository"
)

// ActivityLogger 活动日志服务
type ActivityLogger struct {
	repo  *repository.ActivityLogRepository
	queue chan *models.ActivityLog
	wg    sync.WaitGroup
}

var (
	activityLoggerInstance *ActivityLogger
	activityLoggerOnce     sync.Once
)

// GetActivityLogger 获取活动日志服务单例
func GetActivityLogger() *ActivityLogger {
	activityLoggerOnce.Do(func() {
		activityLoggerInstance = &ActivityLogger{
			repo:  repository.NewActivityLogRepository(),
			queue: make(chan *models.ActivityLog, 1000),
		}
		activityLoggerInstance.Start()
	})
	return activityLoggerInstance
}

// Start 启动活动日志处理器
func (al *ActivityLogger) Start() {
	al.wg.Add(1)
	go al.processQueue()
}

// Stop 停止活动日志处理器
func (al *ActivityLogger) Stop() {
	close(al.queue)
	al.wg.Wait()
}

// processQueue 处理日志队列
func (al *ActivityLogger) processQueue() {
	defer al.wg.Done()

	for log := range al.queue {
		if err := al.repo.Create(log); err != nil {
			// 记录错误但不中断处理
			stdlog.Printf("[ActivityLogger] Failed to save activity log: %v", err)
		}
	}
}

// LogEmailActivity 记录邮件相关活动
func (al *ActivityLogger) LogEmailActivity(activityType models.ActivityType, email *models.Email, userID *uint) {
	title := ""
	description := ""

	switch activityType {
	case models.ActivityEmailReceived:
		title = "收到新邮件"
		description = fmt.Sprintf("来自 %s 的邮件", email.From)
	case models.ActivityEmailSent:
		title = "发送邮件"
		description = fmt.Sprintf("发送给 %s", email.To)
	case models.ActivityEmailDeleted:
		title = "删除邮件"
		description = fmt.Sprintf("删除了主题为 \"%s\" 的邮件", email.Subject)
	}

	log := &models.ActivityLog{
		Type:        activityType,
		Title:       title,
		Description: description,
		UserID:      userID,
		EmailID:     &email.ID,
		Status:      "success",
	}

	select {
	case al.queue <- log:
	default:
		// 队列满时直接保存
		go func() {
			_ = al.repo.Create(log)
		}()
	}
}

// LogAccountActivity 记录账户相关活动
func (al *ActivityLogger) LogAccountActivity(activityType models.ActivityType, account *models.EmailAccount, userID *uint) {
	title := ""
	description := ""

	switch activityType {
	case models.ActivityAccountAdded:
		title = "添加邮箱账户"
		description = fmt.Sprintf("添加了账户 %s", account.EmailAddress)
	case models.ActivityAccountUpdated:
		title = "更新邮箱账户"
		description = fmt.Sprintf("更新了账户 %s 的设置", account.EmailAddress)
	case models.ActivityAccountDeleted:
		title = "删除邮箱账户"
		description = fmt.Sprintf("删除了账户 %s", account.EmailAddress)
	case models.ActivityAccountVerified:
		title = "验证邮箱账户"
		description = fmt.Sprintf("成功验证了账户 %s", account.EmailAddress)
	case models.ActivityAccountSynced:
		title = "同步邮箱账户"
		description = fmt.Sprintf("完成了账户 %s 的同步", account.EmailAddress)
	}

	log := &models.ActivityLog{
		Type:        activityType,
		Title:       title,
		Description: description,
		UserID:      userID,
		AccountID:   &account.ID,
		Status:      "success",
	}

	select {
	case al.queue <- log:
	default:
		go func() {
			_ = al.repo.Create(log)
		}()
	}
}

// LogSyncActivity 记录同步相关活动
func (al *ActivityLogger) LogSyncActivity(activityType models.ActivityType, accountEmail string, userID *uint, metadata interface{}) {
	title := ""
	description := ""

	switch activityType {
	case models.ActivitySyncStarted:
		title = "开始同步"
		description = fmt.Sprintf("开始同步账户 %s", accountEmail)
	case models.ActivitySyncCompleted:
		title = "同步完成"
		description = fmt.Sprintf("账户 %s 同步完成", accountEmail)
	case models.ActivitySyncFailed:
		title = "同步失败"
		description = fmt.Sprintf("账户 %s 同步失败", accountEmail)
	}

	al.LogActivity(activityType, title, description, userID, metadata)
}

// LogActivity 记录通用活动
func (al *ActivityLogger) LogActivity(activityType models.ActivityType, title, description string, userID *uint, metadata interface{}) {
	_ = al.repo.LogActivity(activityType, title, description, userID, metadata)
}

// LogFailedActivity 记录失败的活动
func (al *ActivityLogger) LogFailedActivity(activityType models.ActivityType, title, description string, userID *uint, metadata interface{}) {
	_ = al.repo.LogFailedActivity(activityType, title, description, userID, metadata)
}

// LogUserActivity 记录用户相关活动
func (al *ActivityLogger) LogUserActivity(activityType models.ActivityType, user *models.User, ipAddress string) {
	title := ""
	description := ""

	switch activityType {
	case models.ActivityUserLogin:
		title = "用户登录"
		description = fmt.Sprintf("用户 %s 登录系统", user.Username)
	case models.ActivityUserLogout:
		title = "用户登出"
		description = fmt.Sprintf("用户 %s 退出系统", user.Username)
	}

	log := &models.ActivityLog{
		Type:        activityType,
		Title:       title,
		Description: description,
		UserID:      &user.ID,
		IPAddress:   ipAddress,
		Status:      "success",
	}

	select {
	case al.queue <- log:
	default:
		go func() {
			_ = al.repo.Create(log)
		}()
	}
}
