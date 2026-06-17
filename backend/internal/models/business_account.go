package models

import (
	"strings"
	"time"
)

type BusinessAccountStatus string
type BusinessEmailExclusionType string

const (
	BusinessAccountStatusActive   BusinessAccountStatus = "active"
	BusinessAccountStatusPending  BusinessAccountStatus = "pending"
	BusinessAccountStatusDisabled BusinessAccountStatus = "disabled"
	BusinessAccountStatusArchived BusinessAccountStatus = "archived"

	BusinessEmailExclusionTypeCooldown  BusinessEmailExclusionType = "cooldown"
	BusinessEmailExclusionTypeBlacklist BusinessEmailExclusionType = "blacklist"
)

type BusinessModule struct {
	ID               uint             `gorm:"primaryKey" json:"id"`
	OrgID            uint             `gorm:"not null;index;default:1" json:"orgId"`
	Name             string           `gorm:"type:varchar(255);not null;index" json:"name"`
	Website          string           `gorm:"type:varchar(512)" json:"website,omitempty"`
	LoginURL         string           `gorm:"type:varchar(512)" json:"loginUrl,omitempty"`
	Description      string           `gorm:"type:text" json:"description,omitempty"`
	Icon             string           `gorm:"type:varchar(128)" json:"icon,omitempty"`
	Logo             string           `gorm:"type:text" json:"logo,omitempty"`
	Color            string           `gorm:"type:varchar(32)" json:"color,omitempty"`
	FieldSchema      JSONMapInterface `gorm:"type:json" json:"fieldSchema,omitempty"`
	StatusOptions    JSONMapInterface `gorm:"type:json" json:"statusOptions,omitempty"`
	ClaimDefaults    JSONMapInterface `gorm:"type:json" json:"claimDefaults,omitempty"`
	EmailConstraints JSONMapInterface `gorm:"type:json" json:"emailConstraints,omitempty"`
	SortOrder        int              `gorm:"default:0" json:"sortOrder"`
	CreatedAt        time.Time        `json:"createdAt"`
	UpdatedAt        time.Time        `json:"updatedAt"`
	DeletedAt        DeletedAt        `gorm:"index" json:"deletedAt,omitempty"`
}

type BusinessScenario struct {
	ID              uint             `gorm:"primaryKey" json:"id"`
	OrgID           uint             `gorm:"not null;index;default:1;uniqueIndex:idx_business_scenario_key" json:"orgId"`
	ModuleID        uint             `gorm:"not null;index;uniqueIndex:idx_business_scenario_key" json:"moduleId"`
	Module          *BusinessModule  `gorm:"foreignKey:ModuleID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"module,omitempty"`
	Key             string           `gorm:"type:varchar(80);not null;uniqueIndex:idx_business_scenario_key" json:"key"`
	Name            string           `gorm:"type:varchar(255);not null" json:"name"`
	Description     string           `gorm:"type:text" json:"description,omitempty"`
	Enabled         bool             `gorm:"not null;default:true;index" json:"enabled"`
	PickupConfig    JSONMapInterface `gorm:"type:json" json:"pickupConfig,omitempty"`
	ExtractorConfig JSONMapInterface `gorm:"type:json" json:"extractorConfig,omitempty"`
	SortOrder       int              `gorm:"default:0" json:"sortOrder"`
	CreatedAt       time.Time        `json:"createdAt"`
	UpdatedAt       time.Time        `json:"updatedAt"`
	DeletedAt       DeletedAt        `gorm:"index" json:"deletedAt,omitempty"`
}

type BusinessAccount struct {
	ID                uint                  `gorm:"primaryKey" json:"id"`
	OrgID             uint                  `gorm:"not null;index;default:1;uniqueIndex:idx_business_registration_email" json:"orgId"`
	EmailAccountID    *uint                 `gorm:"index" json:"emailAccountId,omitempty"`
	EmailAccount      *EmailAccount         `gorm:"foreignKey:EmailAccountID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"emailAccount,omitempty"`
	ModuleID          *uint                 `gorm:"index;uniqueIndex:idx_business_registration_email" json:"moduleId,omitempty"`
	Module            *BusinessModule       `gorm:"foreignKey:ModuleID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"module,omitempty"`
	ModuleName        string                `gorm:"type:varchar(255);index" json:"moduleName,omitempty"`
	DisplayName       string                `gorm:"type:varchar(255);index" json:"displayName,omitempty"`
	RegistrationEmail *string               `gorm:"type:varchar(255);uniqueIndex:idx_business_registration_email" json:"registrationEmail,omitempty"`
	ClaimToken        string                `gorm:"type:varchar(255);index" json:"-"`
	ClaimExpiresAt    *time.Time            `json:"claimExpiresAt,omitempty"`
	ClaimedBy         string                `gorm:"type:varchar(255)" json:"claimedBy,omitempty"`
	Website           string                `gorm:"type:varchar(512)" json:"website,omitempty"`
	LoginURL          string                `gorm:"type:varchar(512)" json:"loginUrl,omitempty"`
	Username          string                `gorm:"type:varchar(255);index" json:"username,omitempty"`
	Password          string                `gorm:"type:text" json:"password,omitempty"`
	TOTPSecret        string                `gorm:"type:text" json:"totpSecret,omitempty"`
	PhoneNumber       string                `gorm:"type:varchar(64)" json:"phoneNumber,omitempty"`
	RecoveryEmail     string                `gorm:"type:varchar(255)" json:"recoveryEmail,omitempty"`
	RecoveryCodes     StringSlice           `gorm:"type:json" json:"recoveryCodes,omitempty"`
	Status            BusinessAccountStatus `gorm:"type:varchar(64);not null;default:'active';index" json:"status"`
	Description       string                `gorm:"type:text" json:"description,omitempty"`
	Note              string                `gorm:"type:text" json:"note,omitempty"`
	NoteFormat        AccountNoteFormat     `gorm:"type:varchar(16);not null;default:'markdown'" json:"noteFormat"`
	Tags              StringSlice           `gorm:"type:json" json:"tags,omitempty"`
	CustomFields      JSONMapInterface      `gorm:"type:json" json:"customFields,omitempty"`
	ExtraData         JSONMapInterface      `gorm:"type:json" json:"extraData,omitempty"`
	RemoteCreatedAt   *time.Time            `json:"remoteCreatedAt,omitempty"`
	LastLoginAt       *time.Time            `json:"lastLoginAt,omitempty"`
	CreatedAt         time.Time             `json:"createdAt"`
	UpdatedAt         time.Time             `json:"updatedAt"`
	DeletedAt         DeletedAt             `gorm:"index" json:"deletedAt,omitempty"`
}

type BusinessEmailExclusion struct {
	ID                      uint                       `gorm:"primaryKey" json:"id"`
	OrgID                   uint                       `gorm:"not null;index;default:1" json:"orgId"`
	ModuleID                *uint                      `gorm:"index" json:"moduleId,omitempty"`
	Module                  *BusinessModule            `gorm:"foreignKey:ModuleID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"module,omitempty"`
	EmailAccountID          *uint                      `gorm:"index" json:"emailAccountId,omitempty"`
	EmailAccount            *EmailAccount              `gorm:"foreignKey:EmailAccountID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"emailAccount,omitempty"`
	RegistrationEmail       string                     `gorm:"type:varchar(255);index" json:"registrationEmail,omitempty"`
	Type                    BusinessEmailExclusionType `gorm:"type:varchar(32);not null;default:'cooldown';index" json:"type"`
	Scope                   string                     `gorm:"type:varchar(32);not null;default:'module';index" json:"scope"`
	Target                  string                     `gorm:"type:varchar(64);not null;index" json:"target"`
	Reason                  string                     `gorm:"type:varchar(255)" json:"reason,omitempty"`
	Message                 string                     `gorm:"type:text" json:"message,omitempty"`
	SourceBusinessAccountID *uint                      `gorm:"index" json:"sourceBusinessAccountId,omitempty"`
	CreatedBy               string                     `gorm:"type:varchar(255)" json:"createdBy,omitempty"`
	ExpiresAt               *time.Time                 `gorm:"index" json:"expiresAt,omitempty"`
	CreatedAt               time.Time                  `json:"createdAt"`
	UpdatedAt               time.Time                  `json:"updatedAt"`
}

func (BusinessModule) TableName() string {
	return "business_modules"
}

func (BusinessScenario) TableName() string {
	return "business_scenarios"
}

func (BusinessAccount) TableName() string {
	return "business_accounts"
}

func (BusinessEmailExclusion) TableName() string {
	return "business_email_exclusions"
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

func NormalizeBusinessEmailExclusionType(value BusinessEmailExclusionType) BusinessEmailExclusionType {
	trimmed := BusinessEmailExclusionType(strings.ToLower(strings.TrimSpace(string(value))))
	switch trimmed {
	case BusinessEmailExclusionTypeBlacklist:
		return BusinessEmailExclusionTypeBlacklist
	default:
		return BusinessEmailExclusionTypeCooldown
	}
}
