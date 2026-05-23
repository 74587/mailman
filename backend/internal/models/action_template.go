package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// ActionTemplate 动作模板
type ActionTemplate struct {
	ID          uint        `gorm:"primaryKey" json:"id"`
	OrgID       uint        `gorm:"not null;index;default:1" json:"orgId"` // 所属组织
	Name        string      `gorm:"not null;type:varchar(255)" json:"name"`
	Description string      `gorm:"type:text" json:"description,omitempty"`
	Category    string      `gorm:"type:varchar(100)" json:"category,omitempty"` // 分类: 常用、邮件转发、通知等
	Tags        StringArray `gorm:"type:json" json:"tags,omitempty"`             // 标签
	Actions     JSONActions `gorm:"type:json;not null" json:"actions"`           // 动作配置数组
	UsageCount  int64       `gorm:"default:0" json:"usageCount"`                 // 使用次数
	IsBuiltin   bool        `gorm:"default:false" json:"isBuiltin"`              // 是否内置模板
	CreatedAt   time.Time   `json:"createdAt"`
	UpdatedAt   time.Time   `json:"updatedAt"`
	DeletedAt   DeletedAt   `gorm:"index" json:"deletedAt,omitempty"`
}

// JSONActions 动作配置 JSON 数组类型
type JSONActions []map[string]interface{}

// Scan implements the sql.Scanner interface
func (ja *JSONActions) Scan(value interface{}) error {
	if value == nil {
		*ja = []map[string]interface{}{}
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
	return json.Unmarshal(bytes, ja)
}

// Value implements the driver.Valuer interface
func (ja JSONActions) Value() (driver.Value, error) {
	if len(ja) == 0 {
		return "[]", nil
	}
	bytes, err := json.Marshal(ja)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// ActionTemplateListItem 动作模板列表项（简化版本）
type ActionTemplateListItem struct {
	ID          uint      `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	Category    string    `json:"category,omitempty"`
	Tags        []string  `json:"tags,omitempty"`
	ActionCount int       `json:"actionCount"` // 包含的动作数量
	UsageCount  int64     `json:"usageCount"`
	IsBuiltin   bool      `json:"isBuiltin"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ToListItem 转换为列表项
func (at *ActionTemplate) ToListItem() ActionTemplateListItem {
	return ActionTemplateListItem{
		ID:          at.ID,
		Name:        at.Name,
		Description: at.Description,
		Category:    at.Category,
		Tags:        at.Tags,
		ActionCount: len(at.Actions),
		UsageCount:  at.UsageCount,
		IsBuiltin:   at.IsBuiltin,
		CreatedAt:   at.CreatedAt,
	}
}
