package repository

import (
	"context"
	"errors"
	"mailman/internal/models"
	"sync"
	"time"

	"gorm.io/gorm"
)

// UserRepository handles user-related database operations
type UserRepository struct {
	db *gorm.DB
	mu sync.RWMutex
}

// NewUserRepository creates a new user repository
func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{
		db: db,
	}
}

// Create creates a new user
func (r *UserRepository) Create(user *models.User) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.db.Create(user).Error
}

// GetByID retrieves a user by ID
func (r *UserRepository) GetByID(id uint) (*models.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var user models.User
	err := r.db.First(&user, id).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetByUsername retrieves a user by username
func (r *UserRepository) GetByUsername(username string) (*models.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var user models.User
	err := r.db.Where("username = ?", username).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetByEmail retrieves a user by email
func (r *UserRepository) GetByEmail(email string) (*models.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var user models.User
	err := r.db.Where("email = ?", email).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// Update updates a user
func (r *UserRepository) Update(user *models.User) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.db.Save(user).Error
}

// UpdateLastLogin updates the user's last login time
func (r *UserRepository) UpdateLastLogin(userID uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	return r.db.Model(&models.User{}).Where("id = ?", userID).Update("last_login_at", &now).Error
}

// Count returns the total number of users
func (r *UserRepository) Count() (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var count int64
	err := r.db.Model(&models.User{}).Count(&count).Error
	return count, err
}

// ListAll 分页获取所有用户
func (r *UserRepository) ListAll(limit, offset int) ([]models.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var users []models.User
	err := r.db.Order("id ASC").Limit(limit).Offset(offset).Find(&users).Error
	return users, err
}

// UserSessionRepository handles user session-related database operations
type UserSessionRepository struct {
	db *gorm.DB
	mu sync.RWMutex
}

// NewUserSessionRepository creates a new user session repository
func NewUserSessionRepository(db *gorm.DB) *UserSessionRepository {
	return &UserSessionRepository{
		db: db,
	}
}

// Create creates a new user session
func (r *UserSessionRepository) Create(session *models.UserSession) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.db.Create(session).Error
}

// GetByToken retrieves a session by token
func (r *UserSessionRepository) GetByToken(token string) (*models.UserSession, error) {
	return r.GetByTokenWithContext(context.Background(), token)
}

// GetByTokenWithContext retrieves a session by token with context
func (r *UserSessionRepository) GetByTokenWithContext(ctx context.Context, token string) (*models.UserSession, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var session models.UserSession

	// 使用带有上下文的查询
	err := r.db.WithContext(ctx).Preload("User").Where("token = ?", token).First(&session).Error
	if err != nil {
		return nil, err
	}

	// 验证会话有效性 - 这里可以考虑使用单独的goroutine清理过期会话
	// 以避免在读锁中执行写操作
	if !session.IsSessionValid() {
		// 不在持有锁的情况下执行删除
		go func(sessionID uint) {
			r.Delete(sessionID)
		}(session.ID)
		return nil, errors.New("session expired")
	}

	return &session, nil
}

// Delete deletes a session
func (r *UserSessionRepository) Delete(id uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.db.Delete(&models.UserSession{}, id).Error
}

// DeleteByUserID deletes all sessions for a user
func (r *UserSessionRepository) DeleteByUserID(userID uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.db.Where("user_id = ?", userID).Delete(&models.UserSession{}).Error
}

// DeleteExpired deletes all expired sessions
func (r *UserSessionRepository) DeleteExpired() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.db.Where("expires_at < ?", time.Now()).Delete(&models.UserSession{}).Error
}

// GetByUserID 获取用户的所有会话，支持分页
func (r *UserSessionRepository) GetByUserID(userID uint, page, limit int) ([]models.UserSession, int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var sessions []models.UserSession
	var total int64

	// 计算总数
	err := r.db.Model(&models.UserSession{}).Where("user_id = ?", userID).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	// 计算偏移量
	offset := (page - 1) * limit

	// 查询会话
	err = r.db.Where("user_id = ?", userID).
		Order("created_at DESC").
		Offset(offset).
		Limit(limit).
		Find(&sessions).Error

	if err != nil {
		return nil, 0, err
	}

	return sessions, total, nil
}

// GetByID 根据ID获取会话
func (r *UserSessionRepository) GetByID(id uint) (*models.UserSession, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var session models.UserSession
	err := r.db.First(&session, id).Error
	if err != nil {
		return nil, err
	}

	return &session, nil
}

// Update 更新会话
func (r *UserSessionRepository) Update(session *models.UserSession) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return r.db.Save(session).Error
}
