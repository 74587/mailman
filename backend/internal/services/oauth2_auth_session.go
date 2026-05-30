package services

import (
	"fmt"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
)

// OAuth2AuthSessionService 处理OAuth2授权会话业务逻辑
type OAuth2AuthSessionService struct {
	repo repository.OAuth2AuthSessionRepository
}

// NewOAuth2AuthSessionService 创建新的OAuth2AuthSessionService实例
func NewOAuth2AuthSessionService(repo repository.OAuth2AuthSessionRepository) *OAuth2AuthSessionService {
	return &OAuth2AuthSessionService{
		repo: repo,
	}
}

// CreateSession 创建新的OAuth2授权会话
func (s *OAuth2AuthSessionService) CreateSession(providerID uint, state string, expiryMinutes int) (*models.OAuth2AuthSession, error) {
	return s.CreateSessionWithPKCE(providerID, state, expiryMinutes, "", "")
}

// CreateSessionWithPKCE 创建新的OAuth2授权会话，并保存可选的PKCE verifier
func (s *OAuth2AuthSessionService) CreateSessionWithPKCE(providerID uint, state string, expiryMinutes int, codeVerifier string, codeChallengeMethod string) (*models.OAuth2AuthSession, error) {
	if state == "" {
		return nil, fmt.Errorf("state parameter cannot be empty")
	}

	if expiryMinutes <= 0 {
		expiryMinutes = 10 // 默认10分钟
	}

	session := &models.OAuth2AuthSession{
		State:               state,
		ProviderID:          providerID,
		Status:              models.OAuth2AuthSessionStatusPending,
		ExpiresAt:           time.Now().Add(time.Duration(expiryMinutes) * time.Minute),
		CodeVerifier:        codeVerifier,
		CodeChallengeMethod: codeChallengeMethod,
	}

	err := s.repo.Create(session)
	if err != nil {
		return nil, fmt.Errorf("failed to create OAuth2 auth session: %w", err)
	}

	// 重新获取以确保包含所有关联数据
	return s.repo.GetByState(state)
}

// GetSessionByState 根据state获取OAuth2授权会话
func (s *OAuth2AuthSessionService) GetSessionByState(state string) (*models.OAuth2AuthSession, error) {
	if state == "" {
		return nil, fmt.Errorf("state parameter cannot be empty")
	}

	session, err := s.repo.GetByState(state)
	if err != nil {
		return nil, fmt.Errorf("failed to get OAuth2 auth session: %w", err)
	}

	return session, nil
}

// UpdateStatus 更新OAuth2授权会话状态
func (s *OAuth2AuthSessionService) UpdateStatus(state string, status models.OAuth2AuthSessionStatus, errorMsg string) error {
	if state == "" {
		return fmt.Errorf("state parameter cannot be empty")
	}

	err := s.repo.UpdateStatus(state, status, errorMsg)
	if err != nil {
		return fmt.Errorf("failed to update OAuth2 auth session status: %w", err)
	}

	return nil
}

// UpdateWithAuthData 使用认证数据更新OAuth2授权会话
func (s *OAuth2AuthSessionService) UpdateWithAuthData(state string, authData *repository.OAuth2AuthData) error {
	if state == "" {
		return fmt.Errorf("state parameter cannot be empty")
	}

	if authData == nil {
		return fmt.Errorf("auth data cannot be nil")
	}

	err := s.repo.UpdateWithAuthData(state, authData)
	if err != nil {
		return fmt.Errorf("failed to update OAuth2 auth session with auth data: %w", err)
	}

	return nil
}

// CompleteAuthFlow 完成OAuth2授权流程，更新会话状态和认证数据
func (s *OAuth2AuthSessionService) CompleteAuthFlow(state string, emailAddress, accessToken, refreshToken, tokenType string, tokenExpiresAt int64, userInfo models.JSONMap) error {
	authData := &repository.OAuth2AuthData{
		EmailAddress:   emailAddress,
		AccessToken:    accessToken,
		RefreshToken:   refreshToken,
		TokenExpiresAt: tokenExpiresAt,
		TokenType:      tokenType,
		UserInfo:       userInfo,
	}

	return s.UpdateWithAuthData(state, authData)
}

// FailAuthFlow 标记OAuth2授权流程失败
func (s *OAuth2AuthSessionService) FailAuthFlow(state string, errorMsg string) error {
	return s.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, errorMsg)
}

// CancelAuthFlow 取消OAuth2授权流程
func (s *OAuth2AuthSessionService) CancelAuthFlow(state string) error {
	return s.UpdateStatus(state, models.OAuth2AuthSessionStatusCancelled, "user cancelled")
}

// CleanupExpiredSessions 清理过期的OAuth2授权会话
func (s *OAuth2AuthSessionService) CleanupExpiredSessions() error {
	err := s.repo.CleanupExpired()
	if err != nil {
		return fmt.Errorf("failed to cleanup expired OAuth2 auth sessions: %w", err)
	}

	return nil
}

// DeleteSession 删除OAuth2授权会话
func (s *OAuth2AuthSessionService) DeleteSession(state string) error {
	if state == "" {
		return fmt.Errorf("state parameter cannot be empty")
	}

	err := s.repo.DeleteByState(state)
	if err != nil {
		return fmt.Errorf("failed to delete OAuth2 auth session: %w", err)
	}

	return nil
}

// IsSessionValid 检查OAuth2授权会话是否有效
func (s *OAuth2AuthSessionService) IsSessionValid(state string) (bool, error) {
	session, err := s.GetSessionByState(state)
	if err != nil {
		return false, err
	}

	// 检查是否过期
	if session.IsExpired() {
		// 自动更新状态为过期
		s.UpdateStatus(state, models.OAuth2AuthSessionStatusExpired, "session expired")
		return false, nil
	}

	// 检查状态是否为pending
	return session.Status == models.OAuth2AuthSessionStatusPending, nil
}
