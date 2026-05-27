package models

import (
	"fmt"
	"time"
)

// OAuth2AuthSessionStatus 定义OAuth2授权会话状态
type OAuth2AuthSessionStatus string

const (
	OAuth2AuthSessionStatusPending   OAuth2AuthSessionStatus = "pending"   // 等待授权
	OAuth2AuthSessionStatusSuccess   OAuth2AuthSessionStatus = "success"   // 授权成功
	OAuth2AuthSessionStatusFailed    OAuth2AuthSessionStatus = "failed"    // 授权失败
	OAuth2AuthSessionStatusExpired   OAuth2AuthSessionStatus = "expired"   // 已过期
	OAuth2AuthSessionStatusCancelled OAuth2AuthSessionStatus = "cancelled" // 已取消
)

// OAuth2AuthSession 存储OAuth2授权会话信息
type OAuth2AuthSession struct {
	ID         uint                    `gorm:"primaryKey" json:"id"`
	State      string                  `gorm:"unique;not null;index" json:"state"`    // OAuth2 state参数
	ProviderID uint                    `gorm:"not null" json:"providerId"`            // OAuth2提供商ID
	Provider   OAuth2GlobalConfig      `gorm:"foreignKey:ProviderID" json:"provider"` // 关联的OAuth2提供商配置
	Status     OAuth2AuthSessionStatus `gorm:"default:'pending'" json:"status"`       // 授权状态
	ErrorMsg   string                  `json:"errorMsg,omitempty"`                    // 错误信息
	ExpiresAt  time.Time               `gorm:"not null" json:"expiresAt"`             // 会话过期时间

	// 授权成功后获取的账户信息
	EmailAddress   string `json:"emailAddress,omitempty"`   // 邮箱地址
	AccessToken    string `json:"accessToken,omitempty"`    // 访问令牌
	RefreshToken   string `json:"refreshToken,omitempty"`   // 刷新令牌
	TokenExpiresAt int64  `json:"tokenExpiresAt,omitempty"` // 令牌过期时间戳
	TokenType      string `json:"tokenType,omitempty"`      // 令牌类型

	// 从用户信息API获取的额外信息
	UserInfo JSONMap `json:"userInfo,omitempty"` // 用户信息(名称、头像等)

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	DeletedAt DeletedAt `gorm:"index" json:"deletedAt,omitempty"`
}

// IsExpired 检查会话是否已过期
func (s *OAuth2AuthSession) IsExpired() bool {
	return time.Now().After(s.ExpiresAt)
}

// GetCustomSettings 获取OAuth2配置格式的自定义设置
func (s *OAuth2AuthSession) GetCustomSettings() JSONMap {
	if s.Status != OAuth2AuthSessionStatusSuccess {
		return nil
	}

	settings := JSONMap{
		"access_token":  s.AccessToken,
		"refresh_token": s.RefreshToken,
		"token_type":    s.TokenType,
		"expires_at":    fmt.Sprintf("%d", s.TokenExpiresAt),
	}

	// 添加client_id和client_secret（从关联的全局配置获取）
	if s.Provider.ClientID != "" {
		settings["client_id"] = s.Provider.ClientID
	}
	if s.Provider.ClientSecret != "" {
		settings["client_secret"] = s.Provider.ClientSecret
	}

	return settings
}

// GetOAuth2ProviderID 获取OAuth2Provider的ID，用于邮箱账户关联
func (s *OAuth2AuthSession) GetOAuth2ProviderID() *uint {
	if s.Status != OAuth2AuthSessionStatusSuccess {
		return nil
	}
	return &s.ProviderID
}
