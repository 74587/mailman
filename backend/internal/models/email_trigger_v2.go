package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// EmailTriggerV2Status 触发器状态
type EmailTriggerV2Status string

const (
	EmailTriggerV2StatusEnabled  EmailTriggerV2Status = "enabled"
	EmailTriggerV2StatusDisabled EmailTriggerV2Status = "disabled"
)

// TriggerExpressionType 表达式类型
type TriggerExpressionType string

const (
	TriggerExpressionTypeGroup      TriggerExpressionType = "group"
	TriggerExpressionTypeCondition  TriggerExpressionType = "condition"
	TriggerExpressionTypePlugin     TriggerExpressionType = "plugin"
	TriggerExpressionTypeExpression TriggerExpressionType = "expression" // For custom expression languages (JS, CEL, Go-Template, JSONPath)
)

// TriggerOperator 操作符类型
type TriggerOperator string

const (
	TriggerOperatorAnd TriggerOperator = "and"
	TriggerOperatorOr  TriggerOperator = "or"
	TriggerOperatorNot TriggerOperator = "not"
)

// TriggerExpression 触发器表达式
type TriggerExpression struct {
	ID         string                `json:"id"`
	Type       TriggerExpressionType `json:"type"`
	Operator   *TriggerOperator      `json:"operator,omitempty"`
	Field      *string               `json:"field,omitempty"`
	Value      interface{}           `json:"value,omitempty"`
	Conditions []TriggerExpression   `json:"conditions,omitempty"`
	PluginID   *string               `json:"pluginId,omitempty"`
	Fields     JSONMapInterface      `json:"fields,omitempty"`
	Not        *bool                 `json:"not,omitempty"`
}

// TriggerExpressions 触发器表达式数组
type TriggerExpressions []TriggerExpression

// Scan implements the sql.Scanner interface
func (te *TriggerExpressions) Scan(value interface{}) error {
	if value == nil {
		*te = []TriggerExpression{}
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
	return json.Unmarshal(bytes, te)
}

// Value implements the driver.Valuer interface
func (te TriggerExpressions) Value() (driver.Value, error) {
	bytes, err := json.Marshal(te)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// TriggerAction 触发器动作
type TriggerAction struct {
	ID             string           `json:"id"`
	PluginID       string           `json:"pluginId"`
	PluginName     string           `json:"pluginName"`
	Config         JSONMapInterface `json:"config"`
	Enabled        bool             `json:"enabled"`
	ExecutionOrder int              `json:"executionOrder"`
}

// UnmarshalJSON implements custom JSON unmarshaling for TriggerAction
// This handles both V1 (config as string) and V2 (config as map) formats
func (ta *TriggerAction) UnmarshalJSON(data []byte) error {
	// Use an alias to avoid infinite recursion
	type TriggerActionAlias TriggerAction

	// First, try to unmarshal with a flexible config type
	var raw struct {
		TriggerActionAlias
		Config json.RawMessage `json:"config"`
	}

	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	// Copy the basic fields
	*ta = TriggerAction(raw.TriggerActionAlias)

	// Handle the Config field
	if len(raw.Config) > 0 {
		// Try to unmarshal as a map first
		var configMap map[string]interface{}
		if err := json.Unmarshal(raw.Config, &configMap); err == nil {
			ta.Config = configMap
		} else {
			// If that fails, try to unmarshal as a string
			var configStr string
			if err := json.Unmarshal(raw.Config, &configStr); err == nil {
				// Try to parse the string as JSON
				var parsedConfig map[string]interface{}
				if err := json.Unmarshal([]byte(configStr), &parsedConfig); err == nil {
					ta.Config = parsedConfig
				} else {
					// If parsing fails, store as raw config string
					ta.Config = map[string]interface{}{"raw": configStr}
				}
			}
		}
	}

	return nil
}

// TriggerActions 触发器动作数组
type TriggerActions []TriggerAction

// Scan implements the sql.Scanner interface
func (ta *TriggerActions) Scan(value interface{}) error {
	if value == nil {
		*ta = []TriggerAction{}
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
	return json.Unmarshal(bytes, ta)
}

// Value implements the driver.Valuer interface
func (ta TriggerActions) Value() (driver.Value, error) {
	bytes, err := json.Marshal(ta)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// EmailTriggerV2 邮件触发器V2
type EmailTriggerV2 struct {
	ID                uint               `gorm:"primaryKey" json:"id"`
	OrgID             uint               `gorm:"not null;index;default:1" json:"orgId"` // 所属组织
	Name              string             `gorm:"not null;type:varchar(255)" json:"name"`
	Description       string             `json:"description,omitempty"`
	Enabled           bool               `gorm:"not null;default:false" json:"enabled"`
	Expressions       TriggerExpressions `gorm:"type:json;not null" json:"expressions"`
	Actions           TriggerActions     `gorm:"type:json;not null" json:"actions"`
	TotalExecutions   int64              `gorm:"default:0" json:"totalExecutions"`
	SuccessExecutions int64              `gorm:"default:0" json:"successExecutions"`
	LastExecutedAt    *time.Time         `json:"lastExecutedAt,omitempty"`
	LastError         string             `json:"lastError,omitempty"`
	CreatedAt         time.Time          `json:"createdAt"`
	UpdatedAt         time.Time          `json:"updatedAt"`
	DeletedAt         DeletedAt          `gorm:"index" json:"deletedAt,omitempty"`
}

// TriggerExecutionV2Status 触发器执行状态
type TriggerExecutionV2Status string

const (
	TriggerExecutionV2StatusSuccess TriggerExecutionV2Status = "success"
	TriggerExecutionV2StatusFailed  TriggerExecutionV2Status = "failed"
	TriggerExecutionV2StatusPartial TriggerExecutionV2Status = "partial" // 部分成功
)

// ActionExecutionResult 动作执行结果
type ActionExecutionResult struct {
	ActionID     string                 `json:"actionId"`
	PluginID     string                 `json:"pluginId"`
	PluginName   string                 `json:"pluginName"`
	Success      bool                   `json:"success"`
	StopPipeline bool                   `json:"stopPipeline,omitempty"` // 是否中断后续流程
	StartTime    time.Time              `json:"startTime"`
	EndTime      time.Time              `json:"endTime"`
	Duration     int64                  `json:"duration"`
	Input        map[string]interface{} `json:"input,omitempty"`  // 输入参数
	Output       map[string]interface{} `json:"output,omitempty"` // 输出结果
	Result       interface{}            `json:"result,omitempty"`
	Error        string                 `json:"error,omitempty"`
}

// ActionExecutionResults 动作执行结果数组
type ActionExecutionResults []ActionExecutionResult

// Scan implements the sql.Scanner interface
func (aer *ActionExecutionResults) Scan(value interface{}) error {
	if value == nil {
		*aer = []ActionExecutionResult{}
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	return json.Unmarshal(bytes, aer)
}

// Value implements the driver.Valuer interface
func (aer ActionExecutionResults) Value() (driver.Value, error) {
	if len(aer) == 0 {
		return "[]", nil
	}
	bytes, err := json.Marshal(aer)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// ExecutionStepType 执行步骤类型
type ExecutionStepType string

const (
	ExecutionStepTypeFilter ExecutionStepType = "filter"
	ExecutionStepTypeAction ExecutionStepType = "action"
)

// ExecutionStep 执行追踪中的单个步骤
type ExecutionStep struct {
	ID        string                 `json:"id"`
	Type      ExecutionStepType      `json:"type"`     // "filter" 或 "action"
	Name      string                 `json:"name"`     // 人类可读的名称
	PluginID  string                 `json:"pluginId"` // 插件标识符
	StartTime time.Time              `json:"startTime"`
	EndTime   time.Time              `json:"endTime"`
	Duration  int64                  `json:"duration"` // 毫秒
	Success   bool                   `json:"success"`
	Input     map[string]interface{} `json:"input"`  // 输入参数
	Output    map[string]interface{} `json:"output"` // 输出/结果
	Error     string                 `json:"error,omitempty"`
}

// ExecutionTrace 完整的执行追踪
type ExecutionTrace struct {
	Steps      []ExecutionStep `json:"steps"`
	TotalSteps int             `json:"totalSteps"`
	StartTime  time.Time       `json:"startTime"`
	EndTime    time.Time       `json:"endTime"`
	TotalMs    int64           `json:"totalMs"`
}

// TriggerExecutionLogV2 触发器执行日志V2
type TriggerExecutionLogV2 struct {
	ID                 uint                     `gorm:"primaryKey" json:"id"`
	TriggerID          uint                     `gorm:"not null;index" json:"triggerId"`
	TriggerName        string                   `gorm:"not null;type:varchar(255)" json:"triggerName"`
	EmailID            uint                     `gorm:"not null;index" json:"emailId"`
	Status             TriggerExecutionV2Status `gorm:"not null" json:"status"`
	StartTime          time.Time                `gorm:"not null" json:"startTime"`
	EndTime            time.Time                `gorm:"not null" json:"endTime"`
	Duration           int64                    `gorm:"not null" json:"duration"` // 毫秒
	ConditionResult    bool                     `gorm:"not null" json:"conditionResult"`
	ConditionEval      JSONMap                  `gorm:"type:json" json:"conditionEvaluation"`
	ActionsExecuted    int                      `gorm:"not null" json:"actionsExecuted"`
	ActionsSucceeded   int                      `gorm:"not null" json:"actionsSucceeded"`
	Error              string                   `json:"error,omitempty"`
	ActionResults      ActionExecutionResults   `gorm:"type:json" json:"actionResults"`
	ExecutionTraceData string                   `gorm:"type:text" json:"executionTraceData,omitempty"` // Base64 编码的执行追踪 JSON
	CreatedAt          time.Time                `json:"createdAt"`
}
