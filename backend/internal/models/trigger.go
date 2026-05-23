package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

// TriggerStatus 触发器状态
type TriggerStatus string

const (
	TriggerStatusEnabled  TriggerStatus = "enabled"
	TriggerStatusDisabled TriggerStatus = "disabled"
)

// TriggerActionType 触发动作类型
type TriggerActionType string

const (
	TriggerActionTypeModifyContent TriggerActionType = "modify_content" // 修改邮件内容
	TriggerActionTypeSMTP          TriggerActionType = "smtp"           // SMTP转发（未来扩展）
)

// TriggerConditionConfig 触发条件配置
type TriggerConditionConfig struct {
	Type    string `json:"type"`              // js, gotemplate
	Script  string `json:"script"`            // 脚本内容
	Timeout *int   `json:"timeout,omitempty"` // 超时时间（秒）
}

// Scan implements the sql.Scanner interface
func (tc *TriggerConditionConfig) Scan(value interface{}) error {
	if value == nil {
		*tc = TriggerConditionConfig{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return fmt.Errorf("cannot scan %T into TriggerConditionConfig", value)
	}
	return json.Unmarshal(bytes, tc)
}

// Value implements the driver.Valuer interface
func (tc TriggerConditionConfig) Value() (driver.Value, error) {
	bytes, err := json.Marshal(tc)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// TriggerActionConfig 触发动作配置
type TriggerActionConfig struct {
	Type        TriggerActionType `json:"type"`                  // 动作类型
	Name        string            `json:"name"`                  // 动作名称
	Description string            `json:"description,omitempty"` // 动作描述
	Config      string            `json:"config"`                // 动作配置（JSON字符串或模板）
	Enabled     bool              `json:"enabled"`               // 是否启用此动作
	Order       int               `json:"order"`                 // 执行顺序
}

// TriggerActionsV1 触发动作数组 (V1 API)
// NOTE: V2 API uses a different TriggerActions type in email_trigger_v2.go
type TriggerActionsV1 []TriggerActionConfig

// Scan implements the sql.Scanner interface
func (ta *TriggerActionsV1) Scan(value interface{}) error {
	if value == nil {
		*ta = []TriggerActionConfig{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return fmt.Errorf("cannot scan %T into TriggerActionsV1", value)
	}
	if len(bytes) == 0 {
		*ta = []TriggerActionConfig{}
		return nil
	}
	return json.Unmarshal(bytes, ta)
}

// Value implements the driver.Valuer interface
func (ta TriggerActionsV1) Value() (driver.Value, error) {
	if len(ta) == 0 {
		return "[]", nil
	}
	bytes, err := json.Marshal(ta)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// // Scan implements the sql.Scanner interface
// func (ta *TriggerActions) Scan(value interface{}) error {
// 	if value == nil {
// 		*ta = []TriggerActionConfig{}
// 		return nil
// 	}
// 	bytes, ok := value.([]byte)
// 	if !ok {
// 		return nil
// 	}
// 	return json.Unmarshal(bytes, ta)
// }

// // Value implements the driver.Valuer interface
// func (ta TriggerActions) Value() (driver.Value, error) {
// 	if len(ta) == 0 {
// 		return "[]", nil
// 	}
// 	return json.Marshal(ta)
// }

// EmailTrigger 邮件触发器
type EmailTrigger struct {
	ID          uint          `gorm:"primaryKey" json:"id"`
	Name        string        `gorm:"not null;type:varchar(255)" json:"name"`    // 触发器名称
	Description string        `json:"description,omitempty"`                     // 触发器描述
	Status      TriggerStatus `gorm:"not null;default:'disabled'" json:"status"` // 触发器状态

	// 检查配置
	CheckInterval int `gorm:"not null;default:30" json:"check_interval"` // 检查间隔（秒）

	// 过滤参数（复用EmailFilter结构）
	EmailAddress  string      `json:"email_address,omitempty"`                   // 邮箱地址过滤
	StartDate     *time.Time  `json:"start_date,omitempty"`                      // 开始日期
	EndDate       *time.Time  `json:"end_date,omitempty"`                        // 结束日期
	Subject       string      `json:"subject,omitempty"`                         // 主题过滤
	From          string      `json:"from,omitempty"`                            // 发件人过滤
	To            string      `json:"to,omitempty"`                              // 收件人过滤
	HasAttachment *bool       `json:"has_attachment,omitempty"`                  // 是否有附件
	Unread        *bool       `json:"unread,omitempty"`                          // 是否未读
	Labels        StringSlice `gorm:"type:json" json:"labels,omitempty"`         // 标签过滤
	Folders       StringSlice `gorm:"type:json" json:"folders,omitempty"`        // 文件夹列表
	CustomFilters JSONMap     `gorm:"type:json" json:"custom_filters,omitempty"` // 自定义过滤器

	// 触发条件和动作
	Condition TriggerConditionConfig `gorm:"type:json;not null" json:"condition"` // 触发条件
	Actions   TriggerActionsV1       `gorm:"type:json;not null" json:"actions"`   // 触发动作

	// 日志配置
	EnableLogging bool `gorm:"default:true" json:"enable_logging"` // 是否启用日志

	// 统计信息
	TotalExecutions   int64      `gorm:"default:0" json:"total_executions"`   // 总执行次数
	SuccessExecutions int64      `gorm:"default:0" json:"success_executions"` // 成功执行次数
	LastExecutedAt    *time.Time `json:"last_executed_at,omitempty"`          // 最后执行时间
	LastError         string     `json:"last_error,omitempty"`                // 最后错误信息

	// 时间戳
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	DeletedAt DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

// TriggerExecutionStatus 触发器执行状态
type TriggerExecutionStatus string

const (
	TriggerExecutionStatusSuccess TriggerExecutionStatus = "success"
	TriggerExecutionStatusFailed  TriggerExecutionStatus = "failed"
	TriggerExecutionStatusPartial TriggerExecutionStatus = "partial" // 部分成功
)

// TriggerActionResult 触发动作执行结果
type TriggerActionResult struct {
	ActionName  string      `json:"action_name"`
	ActionType  string      `json:"action_type"`
	Success     bool        `json:"success"`
	Error       string      `json:"error,omitempty"`
	InputData   interface{} `json:"input_data,omitempty"`
	OutputData  interface{} `json:"output_data,omitempty"`
	ExecutionMs int64       `json:"execution_ms"`
}

// TriggerActionResults 触发动作结果数组
type TriggerActionResults []TriggerActionResult

// Scan implements the sql.Scanner interface
func (tar *TriggerActionResults) Scan(value interface{}) error {
	if value == nil {
		*tar = []TriggerActionResult{}
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
	return json.Unmarshal(bytes, tar)
}

// Value implements the driver.Valuer interface
func (tar TriggerActionResults) Value() (driver.Value, error) {
	if len(tar) == 0 {
		return "[]", nil
	}
	bytes, err := json.Marshal(tar)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// TriggerExecutionLog 触发器执行日志
type TriggerExecutionLog struct {
	ID        uint         `gorm:"primaryKey" json:"id"`
	TriggerID uint         `gorm:"not null;index" json:"trigger_id"`
	Trigger   EmailTrigger `gorm:"foreignKey:TriggerID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"trigger,omitempty"`

	// 执行信息
	Status      TriggerExecutionStatus `gorm:"not null" json:"status"`
	StartTime   time.Time              `gorm:"not null" json:"start_time"`
	EndTime     time.Time              `gorm:"not null" json:"end_time"`
	ExecutionMs int64                  `gorm:"not null" json:"execution_ms"`

	// 输入参数
	EmailID     uint    `gorm:"not null;index" json:"email_id"`
	Email       Email   `gorm:"foreignKey:EmailID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"email,omitempty"`
	InputParams JSONMap `gorm:"type:json" json:"input_params,omitempty"` // 触发器入口参数

	// 条件校验结果
	ConditionResult bool   `gorm:"not null" json:"condition_result"`
	ConditionError  string `json:"condition_error,omitempty"`

	// 动作执行结果
	ActionResults TriggerActionResults `gorm:"type:json" json:"action_results"`

	// 错误信息
	ErrorMessage string `json:"error_message,omitempty"`

	// 时间戳
	CreatedAt time.Time `json:"created_at"`
}
