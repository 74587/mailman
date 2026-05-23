package models

import "time"

// 系统角色名常量
const (
	RoleSuperAdmin = "super_admin"
	RoleOrgOwner   = "org_owner"
	RoleOrgAdmin   = "org_admin"
	RoleMember     = "member"
	RoleViewer     = "viewer"
)

// 权限资源常量
const (
	ResourceOrganization = "organization"
	ResourceOrgMember    = "org_member"
	ResourceEmailAccount = "email_account"
	ResourceEmail        = "email"
	ResourceTrigger      = "trigger"
	ResourceTemplate     = "template"
	ResourceAIConfig     = "ai_config"
	ResourceSystemConfig = "system_config"
	ResourceSyncConfig   = "sync_config"
)

// 权限动作常量
const (
	ActionCreate = "create"
	ActionRead   = "read"
	ActionUpdate = "update"
	ActionDelete = "delete"
	ActionManage = "manage" // 包含所有 CRUD 操作
)

// Organization 组织/团队
type Organization struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"not null;type:varchar(255)" json:"name"`
	Slug        string    `gorm:"uniqueIndex;not null;type:varchar(255)" json:"slug"` // URL 友好标识符
	Description string    `gorm:"type:text" json:"description,omitempty"`
	IsActive    bool      `gorm:"default:true" json:"isActive"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	DeletedAt   DeletedAt `gorm:"index" json:"deletedAt,omitempty"`
}

// Role 角色（系统级或组织级）
type Role struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	OrgID       *uint     `gorm:"index" json:"orgId,omitempty"` // null 表示系统级角色
	Name        string    `gorm:"not null;type:varchar(100)" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	IsSystem    bool      `gorm:"default:false" json:"isSystem"` // 系统角色不可删除
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Permission 权限（资源 + 动作）
type Permission struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	Resource    string `gorm:"not null;type:varchar(100);uniqueIndex:idx_resource_action" json:"resource"`
	Action      string `gorm:"not null;type:varchar(50);uniqueIndex:idx_resource_action" json:"action"`
	Description string `gorm:"type:text" json:"description,omitempty"`
}

// RolePermission 角色-权限关联（多对多）
type RolePermission struct {
	RoleID       uint `gorm:"primaryKey;not null" json:"roleId"`
	PermissionID uint `gorm:"primaryKey;not null" json:"permissionId"`
}

// OrgMember 组织成员
type OrgMember struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	OrgID     uint      `gorm:"not null;index;uniqueIndex:idx_org_user" json:"orgId"`
	UserID    uint      `gorm:"not null;index;uniqueIndex:idx_org_user" json:"userId"`
	RoleID    uint      `gorm:"not null;index" json:"roleId"`
	JoinedAt  time.Time `json:"joinedAt"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// OrgMemberWithDetails 包含关联详情的组织成员（用于 API 响应）
type OrgMemberWithDetails struct {
	OrgMember
	User         *User         `json:"user,omitempty" gorm:"-"`
	Role         *Role         `json:"role,omitempty" gorm:"-"`
	Organization *Organization `json:"organization,omitempty" gorm:"-"`
}
