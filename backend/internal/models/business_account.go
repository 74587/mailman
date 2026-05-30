package models

import (
	"strings"
	"time"
)

type BusinessAccountStatus string

const (
	BusinessAccountStatusActive   BusinessAccountStatus = "active"
	BusinessAccountStatusPending  BusinessAccountStatus = "pending"
	BusinessAccountStatusDisabled BusinessAccountStatus = "disabled"
	BusinessAccountStatusArchived BusinessAccountStatus = "archived"
)

type BusinessModule struct {
	ID            uint             `gorm:"primaryKey" json:"id"`
	OrgID         uint             `gorm:"not null;index;default:1" json:"orgId"`
	Name          string           `gorm:"type:varchar(255);not null;index" json:"name"`
	Website       string           `gorm:"type:varchar(512)" json:"website,omitempty"`
	LoginURL      string           `gorm:"type:varchar(512)" json:"loginUrl,omitempty"`
	Description   string           `gorm:"type:text" json:"description,omitempty"`
	Icon          string           `gorm:"type:varchar(128)" json:"icon,omitempty"`
	Logo          string           `gorm:"type:text" json:"logo,omitempty"`
	Color         string           `gorm:"type:varchar(32)" json:"color,omitempty"`
	FieldSchema   JSONMapInterface `gorm:"type:json" json:"fieldSchema,omitempty"`
	StatusOptions JSONMapInterface `gorm:"type:json" json:"statusOptions,omitempty"`
	SortOrder     int              `gorm:"default:0" json:"sortOrder"`
	CreatedAt     time.Time        `json:"createdAt"`
	UpdatedAt     time.Time        `json:"updatedAt"`
	DeletedAt     DeletedAt        `gorm:"index" json:"deletedAt,omitempty"`
}

type BusinessAccount struct {
	ID              uint                  `gorm:"primaryKey" json:"id"`
	OrgID           uint                  `gorm:"not null;index;default:1" json:"orgId"`
	EmailAccountID  *uint                 `gorm:"index" json:"emailAccountId,omitempty"`
	EmailAccount    *EmailAccount         `gorm:"foreignKey:EmailAccountID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"emailAccount,omitempty"`
	ModuleID        *uint                 `gorm:"index" json:"moduleId,omitempty"`
	Module          *BusinessModule       `gorm:"foreignKey:ModuleID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"module,omitempty"`
	ModuleName      string                `gorm:"type:varchar(255);index" json:"moduleName,omitempty"`
	DisplayName     string                `gorm:"type:varchar(255);index" json:"displayName,omitempty"`
	Website         string                `gorm:"type:varchar(512)" json:"website,omitempty"`
	LoginURL        string                `gorm:"type:varchar(512)" json:"loginUrl,omitempty"`
	Username        string                `gorm:"type:varchar(255);index" json:"username,omitempty"`
	Password        string                `gorm:"type:text" json:"password,omitempty"`
	TOTPSecret      string                `gorm:"type:text" json:"totpSecret,omitempty"`
	PhoneNumber     string                `gorm:"type:varchar(64)" json:"phoneNumber,omitempty"`
	RecoveryEmail   string                `gorm:"type:varchar(255)" json:"recoveryEmail,omitempty"`
	RecoveryCodes   StringSlice           `gorm:"type:json" json:"recoveryCodes,omitempty"`
	Status          BusinessAccountStatus `gorm:"type:varchar(64);not null;default:'active';index" json:"status"`
	Description     string                `gorm:"type:text" json:"description,omitempty"`
	Note            string                `gorm:"type:text" json:"note,omitempty"`
	NoteFormat      AccountNoteFormat     `gorm:"type:varchar(16);not null;default:'markdown'" json:"noteFormat"`
	Tags            StringSlice           `gorm:"type:json" json:"tags,omitempty"`
	CustomFields    JSONMapInterface      `gorm:"type:json" json:"customFields,omitempty"`
	ExtraData       JSONMapInterface      `gorm:"type:json" json:"extraData,omitempty"`
	RemoteCreatedAt *time.Time            `json:"remoteCreatedAt,omitempty"`
	LastLoginAt     *time.Time            `json:"lastLoginAt,omitempty"`
	CreatedAt       time.Time             `json:"createdAt"`
	UpdatedAt       time.Time             `json:"updatedAt"`
	DeletedAt       DeletedAt             `gorm:"index" json:"deletedAt,omitempty"`
}

func (BusinessModule) TableName() string {
	return "business_modules"
}

func (BusinessAccount) TableName() string {
	return "business_accounts"
}

func NormalizeBusinessAccountStatus(status BusinessAccountStatus) BusinessAccountStatus {
	trimmed := BusinessAccountStatus(strings.TrimSpace(string(status)))
	switch trimmed {
	case BusinessAccountStatusPending, BusinessAccountStatusDisabled, BusinessAccountStatusArchived:
		return trimmed
	case "":
		return BusinessAccountStatusActive
	default:
		return trimmed
	}
}
