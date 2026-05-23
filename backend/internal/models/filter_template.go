package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// FilterTemplate 过滤器模板
type FilterTemplate struct {
	ID          uint               `gorm:"primaryKey" json:"id"`
	OrgID       uint               `gorm:"not null;index;default:1" json:"orgId"` // 所属组织
	Name        string             `gorm:"not null;type:varchar(255)" json:"name"`
	Description string             `gorm:"type:text" json:"description,omitempty"`
	Category    string             `gorm:"type:varchar(100)" json:"category,omitempty"` // 分类: 常用、邮件内容、发件人等
	Tags        StringArray        `gorm:"type:json" json:"tags,omitempty"`             // 标签
	Expressions TriggerExpressions `gorm:"type:json;not null" json:"expressions"`       // 过滤表达式
	UsageCount  int64              `gorm:"default:0" json:"usageCount"`                 // 使用次数
	IsBuiltin   bool               `gorm:"default:false" json:"isBuiltin"`              // 是否内置模板
	CreatedAt   time.Time          `json:"createdAt"`
	UpdatedAt   time.Time          `json:"updatedAt"`
	DeletedAt   DeletedAt          `gorm:"index" json:"deletedAt,omitempty"`
}

// StringArray 字符串数组类型
type StringArray []string

// Scan implements the sql.Scanner interface
func (sa *StringArray) Scan(value interface{}) error {
	if value == nil {
		*sa = []string{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return nil
	}
	return json.Unmarshal(bytes, sa)
}

// Value implements the driver.Valuer interface
func (sa StringArray) Value() (driver.Value, error) {
	if len(sa) == 0 {
		return "[]", nil
	}
	bytes, err := json.Marshal(sa)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// FilterTemplateListItem 过滤器模板列表项（简化版本）
type FilterTemplateListItem struct {
	ID          uint      `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Category    string    `json:"category,omitempty"`
	Tags        []string  `json:"tags,omitempty"`
	UsageCount  int64     `json:"usageCount"`
	IsBuiltin   bool      `json:"isBuiltin"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ToListItem 转换为列表项
func (ft *FilterTemplate) ToListItem() FilterTemplateListItem {
	return FilterTemplateListItem{
		ID:          ft.ID,
		Name:        ft.Name,
		Description: ft.Description,
		Category:    ft.Category,
		Tags:        ft.Tags,
		UsageCount:  ft.UsageCount,
		IsBuiltin:   ft.IsBuiltin,
		CreatedAt:   ft.CreatedAt,
	}
}
