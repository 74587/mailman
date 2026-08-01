package services

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
)

// AccountRecoveryService 账户恢复服务
// 负责定期检查被自动禁用的账户，尝试重新验证和启用
type AccountRecoveryService struct {
	// 依赖服务
	syncConfigRepo   *repository.SyncConfigRepository
	emailAccountRepo *repository.EmailAccountRepository
	oauth2Service    *OAuth2Service
	syncManager      *PerAccountSyncManager
	logger           *utils.Logger

	// 控制和生命周期
	ctx     context.Context
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	checkMu sync.Mutex

	// 配置
	checkInterval    time.Duration // 检查间隔，默认30分钟
	recoveryAttempts int           // 最大恢复尝试次数，默认3次
}

// RecoveryStats 恢复统计
type RecoveryStats struct {
	TotalChecked       int64     `json:"total_checked"`
	RecoveryAttempts   int64     `json:"recovery_attempts"`
	SuccessfulRecovery int64     `json:"successful_recovery"`
	FailedRecovery     int64     `json:"failed_recovery"`
	LastCheckTime      time.Time `json:"last_check_time"`
	StartTime          time.Time `json:"start_time"`
}

// NewAccountRecoveryService 创建账户恢复服务
func NewAccountRecoveryService(
	syncConfigRepo *repository.SyncConfigRepository,
	emailAccountRepo *repository.EmailAccountRepository,
	oauth2Service *OAuth2Service,
	syncManager *PerAccountSyncManager,
) *AccountRecoveryService {
	ctx, cancel := context.WithCancel(context.Background())

	return &AccountRecoveryService{
		syncConfigRepo:   syncConfigRepo,
		emailAccountRepo: emailAccountRepo,
		oauth2Service:    oauth2Service,
		syncManager:      syncManager,
		logger:           utils.NewLogger("AccountRecoveryService"),
		ctx:              ctx,
		cancel:           cancel,
		checkInterval:    30 * time.Minute, // 每30分钟检查一次
		recoveryAttempts: 3,                // 最多尝试3次恢复
	}
}

// Start 启动恢复服务
func (s *AccountRecoveryService) Start() error {
	s.logger.Info("Starting account recovery service with check interval: %v", s.checkInterval)

	// 启动定期检查例程
	s.wg.Add(1)
	go s.recoveryRoutine()

	s.logger.Info("Account recovery service started")
	return nil
}

// Stop 停止恢复服务
func (s *AccountRecoveryService) Stop() {
	s.logger.Info("Stopping account recovery service")
	s.cancel()
	s.wg.Wait()
	s.logger.Info("Account recovery service stopped")
}

// recoveryRoutine 恢复例程
func (s *AccountRecoveryService) recoveryRoutine() {
	defer s.wg.Done()

	ticker := time.NewTicker(s.checkInterval)
	defer ticker.Stop()

	// 启动时立即执行一次检查
	s.performRecoveryCheck()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.performRecoveryCheck()
		}
	}
}

// performRecoveryCheck 执行恢复检查
func (s *AccountRecoveryService) performRecoveryCheck() {
	if !s.checkMu.TryLock() {
		s.logger.Debug("Skipping recovery check because another recovery batch is still running")
		return
	}
	defer s.checkMu.Unlock()

	s.logger.Info("Starting account recovery check")
	start := time.Now()

	// 获取所有被自动禁用的同步配置
	disabledConfigs, err := s.getAutoDisabledConfigs()
	if err != nil {
		s.logger.Error("Failed to get auto-disabled configs: %v", err)
		return
	}

	if len(disabledConfigs) == 0 {
		s.logger.Debug("No auto-disabled accounts found")
		return
	}

	s.logger.Info("Found %d auto-disabled accounts to check", len(disabledConfigs))

	successCount := 0
	for _, config := range disabledConfigs {
		if s.attemptAccountRecovery(config) {
			successCount++
		}

		// Keep Microsoft token traffic paced and allow shutdown during a large
		// production recovery batch.
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-s.ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}

	duration := time.Since(start)
	s.logger.Info("Recovery check completed: %d/%d accounts recovered, time: %v",
		successCount, len(disabledConfigs), duration)
}

// getAutoDisabledConfigs 获取被自动禁用的同步配置
func (s *AccountRecoveryService) getAutoDisabledConfigs() ([]models.EmailAccountSyncConfig, error) {
	// Process a bounded batch on every pass. Old auto-disabled rows remain
	// eligible, which lets deployments repair legacy accounts gradually.
	configs, err := s.syncConfigRepo.GetRecoverableAutoDisabledConfigs(
		time.Now(),
		s.recoveryAttempts,
		250,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query auto-disabled configs: %w", err)
	}

	// 过滤出值得尝试恢复的配置
	var recoverableConfigs []models.EmailAccountSyncConfig
	for _, config := range configs {
		if s.shouldAttemptRecovery(&config) {
			recoverableConfigs = append(recoverableConfigs, config)
		}
	}

	return recoverableConfigs, nil
}

// shouldAttemptRecovery 判断是否应该尝试恢复
func (s *AccountRecoveryService) shouldAttemptRecovery(config *models.EmailAccountSyncConfig) bool {
	// 如果没有上次错误时间，跳过
	if config.LastErrorTime == nil {
		return false
	}

	// 如果最后错误时间太近（小于30分钟），等待更长时间
	if time.Since(*config.LastErrorTime) < 30*time.Minute {
		return false
	}

	// 如果恢复尝试次数超过限制，降低频率
	if config.RecoveryAttempts >= s.recoveryAttempts {
		// 超过最大尝试次数后，每24小时只尝试一次
		if config.LastRecoveryAttempt == nil ||
			time.Since(*config.LastRecoveryAttempt) < 24*time.Hour {
			return false
		}
	}

	// Only OAuth2 accounts can be recovered by refreshing a token.
	account, err := s.emailAccountRepo.GetByID(config.AccountID)
	if err != nil {
		return false
	}
	if account.AuthType != models.AuthTypeOAuth2 {
		return false
	}

	errorStatus := models.AccountErrorStatus(account.ErrorStatus)
	if errorStatus == models.ErrorStatusOAuthExpired || errorStatus == models.ErrorStatusAuthRevoked {
		return true
	}

	// Compatibility path for rows classified by older versions, where a
	// generic OAuth/401 failure was stored as server_error.
	if errorStatus == models.ErrorStatusServerError {
		message := strings.ToLower(account.ErrorMessage)
		return strings.Contains(message, "oauth") ||
			strings.Contains(message, "invalid_grant") ||
			strings.Contains(message, "aadsts") ||
			strings.Contains(message, "401")
	}
	return false
}

// attemptAccountRecovery 尝试账户恢复
func (s *AccountRecoveryService) attemptAccountRecovery(config models.EmailAccountSyncConfig) bool {
	s.logger.Info("Attempting to recover account %d (%s)",
		config.AccountID, config.Account.EmailAddress)

	// 获取账户详细信息
	account, err := s.emailAccountRepo.GetByID(config.AccountID)
	if err != nil {
		s.logger.Error("Failed to get account %d: %v", config.AccountID, err)
		return false
	}

	// 更新恢复尝试统计
	now := time.Now()
	config.RecoveryAttempts++
	config.LastRecoveryAttempt = &now

	// 尝试刷新OAuth2 token
	success := s.attemptTokenRefresh(account)

	if success {
		// 恢复成功：重新启用同步配置
		if s.enableSyncConfig(&config, account) {
			s.logger.Info("Successfully recovered account %d (%s)",
				config.AccountID, config.Account.EmailAddress)

			// 重置恢复统计
			config.RecoveryAttempts = 0
			config.LastRecoveryAttempt = nil

			return true
		}
	}

	// 恢复失败：更新尝试统计
	if err := s.syncConfigRepo.CreateOrUpdate(&config); err != nil {
		s.logger.Error("Failed to update recovery attempts for account %d: %v",
			config.AccountID, err)
	}

	s.logger.Warn("Failed to recover account %d (%s), attempts: %d",
		config.AccountID, config.Account.EmailAddress, config.RecoveryAttempts)

	return false
}

// attemptTokenRefresh 尝试刷新token
func (s *AccountRecoveryService) attemptTokenRefresh(account *models.EmailAccount) bool {
	// 检查账户是否有OAuth2配置
	if account.CustomSettings == nil {
		s.logger.Debug("Account %d has no custom settings", account.ID)
		return false
	}

	refreshToken, ok := account.CustomSettings["refresh_token"]
	if !ok || refreshToken == "" {
		s.logger.Debug("Account %d has no refresh token", account.ID)
		return false
	}

	// Resolve provider and client credentials. Per-account client IDs are
	// treated as public clients unless that account also stores its own secret.
	oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.emailAccountRepo.GetDB())
	var oauth2Config *models.OAuth2GlobalConfig
	var err error
	clientID := strings.TrimSpace(account.CustomSettings["client_id"])
	clientSecret := strings.TrimSpace(account.CustomSettings["client_secret"])
	providerType := models.ProviderTypeGmail
	if account.MailProvider != nil && account.MailProvider.Type != "" {
		providerType = account.MailProvider.Type
	} else if strings.Contains(account.EmailAddress, "@outlook.") ||
		strings.Contains(account.EmailAddress, "@hotmail.") ||
		strings.Contains(account.EmailAddress, "@live.") {
		providerType = models.ProviderTypeOutlook
	}

	if account.OAuth2ProviderID != nil && *account.OAuth2ProviderID > 0 {
		oauth2Config, err = oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
		if err != nil {
			s.logger.Debug("Failed to get OAuth2 config by provider ID: %v", err)
		}
	}

	if oauth2Config == nil && clientID == "" {
		oauth2Config, err = oauth2GlobalConfigRepo.GetByProviderType(providerType)
		if err != nil {
			s.logger.Error("Failed to get OAuth2 config: %v", err)
			return false
		}
	}

	if clientID == "" && oauth2Config != nil {
		clientID = oauth2Config.ClientID
		clientSecret = oauth2Config.ClientSecret
	}
	if clientID == "" {
		s.logger.Debug("Account %d has no OAuth2 client ID", account.ID)
		return false
	}

	// 尝试刷新token
	s.logger.Debug("Attempting to refresh token for account %d", account.ID)
	refreshResult, err := s.oauth2Service.RefreshAccessTokenWithCacheAndProxyResult(
		string(providerType),
		clientID,
		clientSecret,
		refreshToken,
		account.ID,
		account.Proxy,
		OAuth2RefreshOptions{},
	)

	if err != nil {
		s.logger.Debug("Token refresh failed for account %d: %v", account.ID, err)
		return false
	}

	// Keep the in-memory account consistent because enableSyncConfig persists
	// its status immediately after this method returns.
	account.CustomSettings["access_token"] = refreshResult.AccessToken
	account.CustomSettings["refresh_token"] = refreshResult.RefreshToken
	account.CustomSettings["expires_at"] = strconv.FormatInt(refreshResult.ExpiresAt.Unix(), 10)

	s.logger.Info("Successfully refreshed token for account %d", account.ID)
	return true
}

// enableSyncConfig 启用同步配置
func (s *AccountRecoveryService) enableSyncConfig(config *models.EmailAccountSyncConfig, account *models.EmailAccount) bool {
	// 重新启用同步配置
	config.EnableAutoSync = true
	config.AutoDisabled = false
	config.DisableReason = ""
	config.ConsecutiveErrors = 0
	config.LastErrorTime = nil

	// 更新同步配置
	if err := s.syncConfigRepo.CreateOrUpdate(config); err != nil {
		s.logger.Error("Failed to update sync config for account %d: %v",
			config.AccountID, err)
		return false
	}

	// 重置账户错误状态
	account.ErrorStatus = string(models.ErrorStatusNormal)
	account.ErrorMessage = ""
	account.ErrorTimestamp = nil
	// 不重置ErrorCount，保留历史统计

	if err := s.emailAccountRepo.Update(account); err != nil {
		s.logger.Error("Failed to reset account error status: %v", err)
		return false
	}

	// 通知同步管理器重新启动该账户的同步器
	if s.syncManager != nil {
		if err := s.syncManager.UpdateSubscription(config.AccountID, config); err != nil {
			s.logger.Error("Failed to restart syncer for account %d: %v",
				config.AccountID, err)
			return false
		}
	}

	return true
}

// SetCheckInterval 设置检查间隔
func (s *AccountRecoveryService) SetCheckInterval(interval time.Duration) {
	if interval < 5*time.Minute {
		interval = 5 * time.Minute // 最小5分钟
	}
	s.checkInterval = interval
	s.logger.Info("Check interval updated to: %v", interval)
}

// SetMaxRecoveryAttempts 设置最大恢复尝试次数
func (s *AccountRecoveryService) SetMaxRecoveryAttempts(attempts int) {
	if attempts < 1 {
		attempts = 1
	}
	s.recoveryAttempts = attempts
	s.logger.Info("Max recovery attempts updated to: %d", attempts)
}

// TriggerImmediateCheck 触发立即检查
func (s *AccountRecoveryService) TriggerImmediateCheck() {
	s.logger.Info("Triggering immediate recovery check")
	go s.performRecoveryCheck()
}
