package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// ExtractorTemplateV2Status 取件模板状态
type ExtractorTemplateV2Status string

const (
	ExtractorTemplateV2StatusEnabled  ExtractorTemplateV2Status = "enabled"
	ExtractorTemplateV2StatusDisabled ExtractorTemplateV2Status = "disabled"
)

// ExtractorOutputFormat 输出格式类型
type ExtractorOutputFormat string

const (
	ExtractorOutputFormatText   ExtractorOutputFormat = "text"   // 纯文本
	ExtractorOutputFormatJSON   ExtractorOutputFormat = "json"   // JSON对象
	ExtractorOutputFormatArray  ExtractorOutputFormat = "array"  // 数组
	ExtractorOutputFormatObject ExtractorOutputFormat = "object" // 结构化对象
)

// ExtractorOutputConfig 输出配置
type ExtractorOutputConfig struct {
	Format      ExtractorOutputFormat `json:"format"`                // 输出格式
	Field       string                `json:"field,omitempty"`       // 从动作链输出中提取的字段名
	Template    string                `json:"template,omitempty"`    // 输出模板（用于格式化）
	Description string                `json:"description,omitempty"` // 输出字段描述
}

// Scan implements the sql.Scanner interface
func (eoc *ExtractorOutputConfig) Scan(value interface{}) error {
	if value == nil {
		*eoc = ExtractorOutputConfig{Format: ExtractorOutputFormatText}
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
	return json.Unmarshal(bytes, eoc)
}

// Value implements the driver.Valuer interface
func (eoc ExtractorOutputConfig) Value() (driver.Value, error) {
	bytes, err := json.Marshal(eoc)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// ExtractorTemplateV2 取件模板V2
// 基于触发器系统设计，使用相同的表达式和动作系统
type ExtractorTemplateV2 struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	OrgID       uint   `gorm:"not null;index;default:1" json:"orgId"` // 所属组织
	Name        string `gorm:"not null;type:varchar(255);uniqueIndex" json:"name"`
	Description string `gorm:"type:text" json:"description,omitempty"`
	Enabled     bool   `gorm:"default:true" json:"enabled"`

	// 过滤条件（复用触发器的表达式系统）
	// 用于判断邮件是否匹配此取件模板
	Expressions TriggerExpressions `gorm:"type:json" json:"expressions"`

	// 提取动作链（复用触发器的动作系统）
	// 动作按顺序执行，每个动作可以使用上一个动作的输出
	Actions TriggerActions `gorm:"type:json;not null" json:"actions"`

	// 输出配置
	OutputConfig ExtractorOutputConfig `gorm:"type:json" json:"outputConfig"`

	// 分类和标签
	Category string      `gorm:"type:varchar(100)" json:"category,omitempty"` // 分类
	Tags     StringArray `gorm:"type:json" json:"tags,omitempty"`             // 标签

	// 统计字段
	TotalExtractions   int64      `gorm:"default:0" json:"totalExtractions"`
	SuccessExtractions int64      `gorm:"default:0" json:"successExtractions"`
	LastExtractedAt    *time.Time `json:"lastExtractedAt,omitempty"`
	LastError          string     `gorm:"type:text" json:"lastError,omitempty"`

	// 时间戳
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	DeletedAt DeletedAt `gorm:"index" json:"deletedAt,omitempty"`
}

// TableName 指定表名
func (ExtractorTemplateV2) TableName() string {
	return "extractor_templates_v2"
}

// ExtractionV2Status 提取执行状态
type ExtractionV2Status string

const (
	ExtractionV2StatusSuccess ExtractionV2Status = "success"  // 成功
	ExtractionV2StatusFailed  ExtractionV2Status = "failed"   // 失败
	ExtractionV2StatusNoMatch ExtractionV2Status = "no_match" // 过滤条件不匹配
	ExtractionV2StatusPartial ExtractionV2Status = "partial"  // 部分成功
	ExtractionV2StatusSkipped ExtractionV2Status = "skipped"  // 跳过（模板禁用等）
)

// ExtractionLogV2 提取执行日志
type ExtractionLogV2 struct {
	ID           uint               `gorm:"primaryKey" json:"id"`
	TemplateID   uint               `gorm:"not null;index" json:"templateId"`
	TemplateName string             `gorm:"type:varchar(255)" json:"templateName"`
	EmailID      uint               `gorm:"not null;index" json:"emailId"`
	Status       ExtractionV2Status `gorm:"not null;type:varchar(50)" json:"status"`

	// 执行时间
	StartTime time.Time `gorm:"not null" json:"startTime"`
	EndTime   time.Time `gorm:"not null" json:"endTime"`
	Duration  int64     `gorm:"not null" json:"duration"` // 毫秒

	// 过滤结果
	FilterMatched    bool   `json:"filterMatched"`
	FilterEvaluation string `gorm:"type:text" json:"filterEvaluation,omitempty"` // JSON格式的过滤评估详情

	// 提取结果
	ExtractedResult string                 `gorm:"type:text" json:"extractedResult,omitempty"`
	ActionResults   ActionExecutionResults `gorm:"type:json" json:"actionResults,omitempty"`

	// 错误信息
	Error string `gorm:"type:text" json:"error,omitempty"`

	// 执行追踪数据（用于调试）
	ExecutionTraceData string `gorm:"type:text" json:"executionTraceData,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
}

// TableName 指定表名
func (ExtractionLogV2) TableName() string {
	return "extraction_logs_v2"
}

// ExtractionResult 提取结果
type ExtractionResult struct {
	Success        bool                    `json:"success"`
	Status         ExtractionV2Status      `json:"status"`
	FilterMatched  bool                    `json:"filterMatched"`
	ExtractedValue interface{}             `json:"extractedValue,omitempty"`
	ActionResults  []ActionExecutionResult `json:"actionResults,omitempty"`
	ExecutionTrace *ExecutionTrace         `json:"executionTrace,omitempty"`
	Duration       int64                   `json:"duration"` // ms
	Error          string                  `json:"error,omitempty"`
}

// DebugExtractionResult 调试模式的提取结果
type DebugExtractionResult struct {
	ExtractionResult
	FilterEvaluation map[string]interface{} `json:"filterEvaluation,omitempty"`
	StepResults      []StepDebugResult      `json:"stepResults,omitempty"`
}

// StepDebugResult 单步调试结果
type StepDebugResult struct {
	StepIndex int                    `json:"stepIndex"`
	StepType  string                 `json:"stepType"` // "filter" | "action"
	StepName  string                 `json:"stepName"`
	Input     map[string]interface{} `json:"input,omitempty"`
	Output    map[string]interface{} `json:"output,omitempty"`
	Success   bool                   `json:"success"`
	Duration  int64                  `json:"duration"` // ms
	Error     string                 `json:"error,omitempty"`
}
