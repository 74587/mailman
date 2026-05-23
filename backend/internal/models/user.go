package models

import (
	"time"

	"golang.org/x/crypto/bcrypt"
)

// User represents a system user
type User struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	Username     string     `gorm:"uniqueIndex;not null;type:varchar(255)" json:"username"`
	Email        string     `gorm:"uniqueIndex;not null;type:varchar(255)" json:"email"`
	PasswordHash string     `gorm:"not null" json:"-"`       // Never expose password hash in JSON
	Avatar       string     `gorm:"type:text" json:"avatar"` // Base64 encoded image
	IsSuperAdmin bool       `gorm:"default:false" json:"is_super_admin"` // 超级管理员
	CurrentOrgID *uint      `gorm:"index" json:"current_org_id,omitempty"` // 当前活跃组织
	IsActive     bool       `gorm:"default:true" json:"is_active"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	DeletedAt    DeletedAt  `gorm:"index" json:"deleted_at,omitempty"`
}

// UserSession represents an active user session
type UserSession struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index" json:"user_id"`
	User      User      `gorm:"foreignKey:UserID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Token     string    `gorm:"uniqueIndex;not null;type:varchar(255)" json:"token"`
	ExpiresAt time.Time `gorm:"not null;index" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// SetPassword hashes and sets the user's password
func (u *User) SetPassword(password string) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	u.PasswordHash = string(hashedPassword)
	return nil
}

// CheckPassword verifies if the provided password matches the user's password
func (u *User) CheckPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
	return err == nil
}

// IsSessionValid checks if the session is still valid
func (s *UserSession) IsSessionValid() bool {
	return time.Now().Before(s.ExpiresAt)
}
