package models

import (
	"time"
)

// TagGroupSelectionType 标签组选择类型
type TagGroupSelectionType string

const (
	TagGroupSelectionSingle   TagGroupSelectionType = "single"   // 单选（互斥）
	TagGroupSelectionMultiple TagGroupSelectionType = "multiple" // 多选
)

// TagGroup 标签组
type TagGroup struct {
	ID            uint                  `gorm:"primaryKey" json:"id"`
	Name          string                `gorm:"not null;uniqueIndex;type:varchar(100)" json:"name"`
	Description   string                `gorm:"type:text" json:"description,omitempty"`
	SelectionType TagGroupSelectionType `gorm:"not null;default:'multiple'" json:"selectionType"` // 选择类型: single 或 multiple
	Color         string                `gorm:"type:varchar(20)" json:"color,omitempty"`          // 标签组颜色
	SortOrder     int                   `gorm:"default:0" json:"sortOrder"`                       // 排序顺序
	Tags          []Tag                 `gorm:"foreignKey:GroupID" json:"tags,omitempty"`         // 关联的标签
	CreatedAt     time.Time             `json:"createdAt"`
	UpdatedAt     time.Time             `json:"updatedAt"`
	DeletedAt     DeletedAt             `gorm:"index" json:"deletedAt,omitempty"`
}

// Tag 标签
type Tag struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	GroupID   uint      `gorm:"not null;index" json:"groupId"`             // 所属标签组ID
	Group     *TagGroup `gorm:"foreignKey:GroupID" json:"group,omitempty"` // 关联的标签组
	Name      string    `gorm:"not null;type:varchar(100)" json:"name"`    // 标签名称
	Color     string    `gorm:"type:varchar(20)" json:"color,omitempty"`   // 标签颜色（可覆盖组颜色）
	SortOrder int       `gorm:"default:0" json:"sortOrder"`                // 排序顺序
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	DeletedAt DeletedAt `gorm:"index" json:"deletedAt,omitempty"`
}

// EmailAccountTag 账户-标签关联表
type EmailAccountTag struct {
	ID             uint         `gorm:"primaryKey" json:"id"`
	EmailAccountID uint         `gorm:"not null;uniqueIndex:idx_account_tag" json:"emailAccountId"` // 邮箱账户ID
	TagID          uint         `gorm:"not null;uniqueIndex:idx_account_tag" json:"tagId"`          // 标签ID
	EmailAccount   EmailAccount `gorm:"foreignKey:EmailAccountID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Tag            Tag          `gorm:"foreignKey:TagID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"tag,omitempty"`
	CreatedAt      time.Time    `json:"createdAt"`
}

// TableName specifies the table name for TagGroup
func (TagGroup) TableName() string {
	return "tag_groups"
}

// TableName specifies the table name for Tag
func (Tag) TableName() string {
	return "tags"
}

// TableName specifies the table name for EmailAccountTag
func (EmailAccountTag) TableName() string {
	return "email_account_tags"
}

// TagGroupWithTags 带标签的标签组（API响应）
type TagGroupWithTags struct {
	ID            uint                  `json:"id"`
	Name          string                `json:"name"`
	Description   string                `json:"description,omitempty"`
	SelectionType TagGroupSelectionType `json:"selectionType"`
	Color         string                `json:"color,omitempty"`
	SortOrder     int                   `json:"sortOrder"`
	Tags          []TagSimple           `json:"tags"`
	CreatedAt     time.Time             `json:"createdAt"`
	UpdatedAt     time.Time             `json:"updatedAt"`
}

// TagSimple 简化的标签信息（用于列表）
type TagSimple struct {
	ID        uint   `json:"id"`
	GroupID   uint   `json:"groupId"`
	Name      string `json:"name"`
	Color     string `json:"color,omitempty"`
	SortOrder int    `json:"sortOrder"`
}

// TagWithGroup 带标签组信息的标签
type TagWithGroup struct {
	ID        uint   `json:"id"`
	GroupID   uint   `json:"groupId"`
	GroupName string `json:"groupName"`
	Name      string `json:"name"`
	Color     string `json:"color,omitempty"`
}

// ToTagGroupWithTags 转换为带标签的标签组
func (tg *TagGroup) ToTagGroupWithTags() TagGroupWithTags {
	tags := make([]TagSimple, 0, len(tg.Tags))
	for _, t := range tg.Tags {
		tags = append(tags, TagSimple{
			ID:        t.ID,
			GroupID:   t.GroupID,
			Name:      t.Name,
			Color:     t.Color,
			SortOrder: t.SortOrder,
		})
	}
	return TagGroupWithTags{
		ID:            tg.ID,
		Name:          tg.Name,
		Description:   tg.Description,
		SelectionType: tg.SelectionType,
		Color:         tg.Color,
		SortOrder:     tg.SortOrder,
		Tags:          tags,
		CreatedAt:     tg.CreatedAt,
		UpdatedAt:     tg.UpdatedAt,
	}
}

// ToTagSimple 转换为简化标签
func (t *Tag) ToTagSimple() TagSimple {
	return TagSimple{
		ID:        t.ID,
		GroupID:   t.GroupID,
		Name:      t.Name,
		Color:     t.Color,
		SortOrder: t.SortOrder,
	}
}

// ToTagWithGroup 转换为带标签组信息的标签
func (t *Tag) ToTagWithGroup() TagWithGroup {
	groupName := ""
	if t.Group != nil {
		groupName = t.Group.Name
	}
	return TagWithGroup{
		ID:        t.ID,
		GroupID:   t.GroupID,
		GroupName: groupName,
		Name:      t.Name,
		Color:     t.Color,
	}
}
