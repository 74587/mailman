package models

import "time"

// EmailShareLink is an authenticated, organization-scoped deep link to an
// email. Only a SHA-256 digest is stored so a database read cannot reveal a
// usable share token.
type EmailShareLink struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	OrgID           uint       `gorm:"not null;index" json:"orgId"`
	EmailID         uint       `gorm:"not null;index" json:"emailId"`
	CreatedByUserID *uint      `gorm:"index" json:"createdByUserId,omitempty"`
	TokenHash       string     `gorm:"not null;uniqueIndex;type:char(64)" json:"-"`
	ExpiresAt       time.Time  `gorm:"not null;index" json:"expiresAt"`
	RevokedAt       *time.Time `gorm:"index" json:"revokedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

func (EmailShareLink) TableName() string {
	return "email_share_links"
}
