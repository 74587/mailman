package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"mailman/internal/models"
	"mailman/internal/repository"
	"sync"
	"time"
)

// AuthService handles authentication and authorization
type AuthService struct {
	userRepo    *repository.UserRepository
	sessionRepo *repository.UserSessionRepository
	mu          sync.RWMutex
}

// GetUserSessions 获取用户的所有会话
func (s *AuthService) GetUserSessions(userID uint, page, limit int) ([]models.UserSession, int64, error) {
	return s.sessionRepo.GetByUserID(userID, page, limit)
}

// CreateUserSession 为用户创建一个新会话
func (s *AuthService) CreateUserSession(userID uint, expiresIn time.Duration) (*models.UserSession, error) {
	// 创建会话
	session := &models.UserSession{
		UserID:    userID,
		Token:     generateToken(),
		ExpiresAt: time.Now().Add(expiresIn),
	}

	if err := s.sessionRepo.Create(session); err != nil {
		return nil, err
	}

	// 获取用户信息
	user, err := s.userRepo.GetByID(userID)
	if err != nil {
		return nil, err
	}

	session.User = *user
	return session, nil
}

// DeleteSession 删除用户会话
func (s *AuthService) DeleteSession(userID uint, sessionID uint) error {
	// 验证会话属于该用户
	session, err := s.sessionRepo.GetByID(sessionID)
	if err != nil {
		return err
	}

	if session.UserID != userID {
		return errors.New("会话不属于该用户")
	}

	return s.sessionRepo.Delete(sessionID)
}

// UpdateSessionExpiry 更新会话过期时间
func (s *AuthService) UpdateSessionExpiry(userID uint, sessionID uint, expiresIn time.Duration) (*models.UserSession, error) {
	// 验证会话属于该用户
	session, err := s.sessionRepo.GetByID(sessionID)
	if err != nil {
		return nil, err
	}

	if session.UserID != userID {
		return nil, errors.New("会话不属于该用户")
	}

	// 更新过期时间
	session.ExpiresAt = time.Now().Add(expiresIn)
	if err := s.sessionRepo.Update(session); err != nil {
		return nil, err
	}

	return session, nil
}

// NewAuthService creates a new auth service
func NewAuthService(userRepo *repository.UserRepository, sessionRepo *repository.UserSessionRepository) *AuthService {
	return &AuthService{
		userRepo:    userRepo,
		sessionRepo: sessionRepo,
	}
}

// Login authenticates a user and creates a session
func (s *AuthService) Login(username, password string) (*models.UserSession, error) {
	// Try to find user by username or email
	user, err := s.userRepo.GetByUsername(username)
	if err != nil {
		// Try email if username not found
		user, err = s.userRepo.GetByEmail(username)
		if err != nil {
			return nil, errors.New("invalid credentials")
		}
	}



	// Check if user is active
	if !user.IsActive {
		return nil, errors.New("user account is disabled")
	}

	// Verify password
	if !user.CheckPassword(password) {
		return nil, errors.New("invalid credentials")
	}

	// Update last login time
	if err := s.userRepo.UpdateLastLogin(user.ID); err != nil {
		// Log error but don't fail login
	}

	// Create session
	session := &models.UserSession{
		UserID:    user.ID,
		Token:     generateToken(),
		ExpiresAt: time.Now().Add(24 * time.Hour), // 24 hour session
	}

	if err := s.sessionRepo.Create(session); err != nil {
		return nil, errors.New("failed to create session")
	}

	session.User = *user
	return session, nil
}

// RegisterFirstUser handles the silent registration of the first user
// 第一个用户自动成为超级管理员，之后的用户只能由超级管理员创建
func (s *AuthService) RegisterFirstUser(username, email, password string) (*models.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if any users exist
	count, err := s.userRepo.Count()
	if err != nil {
		return nil, err
	}

	if count > 0 {
		return nil, errors.New("users already exist, new users must be created by super admin")
	}

	// Create the first user as super admin
	user := &models.User{
		Username:     username,
		Email:        email,
		IsActive:     true,
		IsSuperAdmin: true, // 第一个用户自动成为超级管理员
	}

	if err := user.SetPassword(password); err != nil {
		return nil, err
	}

	if err := s.userRepo.Create(user); err != nil {
		return nil, err
	}

	return user, nil
}

// ValidateSession validates a session token and returns the associated user
func (s *AuthService) ValidateSession(token string) (*models.User, error) {
	// 使用5秒超时的上下文
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	return s.ValidateSessionWithContext(ctx, token)
}

// ValidateSessionWithContext validates a session token with a context and returns the associated user
func (s *AuthService) ValidateSessionWithContext(ctx context.Context, token string) (*models.User, error) {
	// 使用带上下文的方法获取会话
	session, err := s.sessionRepo.GetByTokenWithContext(ctx, token)
	if err != nil {
		return nil, err
	}

	return &session.User, nil
}

// Logout invalidates a session
func (s *AuthService) Logout(token string) error {
	session, err := s.sessionRepo.GetByToken(token)
	if err != nil {
		return err
	}

	return s.sessionRepo.Delete(session.ID)
}

// LogoutAll invalidates all sessions for a user
func (s *AuthService) LogoutAll(userID uint) error {
	return s.sessionRepo.DeleteByUserID(userID)
}

// CleanupExpiredSessions removes expired sessions from the database
func (s *AuthService) CleanupExpiredSessions() error {
	return s.sessionRepo.DeleteExpired()
}

// generateToken generates a secure random token
func generateToken() string {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		// Fallback to timestamp-based token
		return hex.EncodeToString([]byte(time.Now().String()))
	}
	return hex.EncodeToString(bytes)
}
