package models

import (
	"database/sql/driver"
	"encoding/json"
	"time"
)

// InterceptorScope 拦截器作用域
type InterceptorScope string

const (
	InterceptorScopeGlobal InterceptorScope = "global" // 全局拦截器
	InterceptorScopeLocal  InterceptorScope = "local"  // 局部拦截器(绑定到触发器/提取器)
)

// ErrorHandlingPolicy 错误处理策略
type ErrorHandlingPolicy string

const (
	ErrorPolicyAbort      ErrorHandlingPolicy = "abort"       // 中断执行
	ErrorPolicyContinue   ErrorHandlingPolicy = "continue"    // 继续执行
	ErrorPolicySkipAction ErrorHandlingPolicy = "skip_action" // 跳过当前动作
)

// ExecutionMode 执行模式
type ExecutionMode string

const (
	ExecutionModeSync  ExecutionMode = "sync"  // 同步执行
	ExecutionModeAsync ExecutionMode = "async" // 异步执行
)

// SkipBehavior 跳过后的行为
type SkipBehavior string

const (
	SkipBehaviorContinue SkipBehavior = "continue" // 继续执行后续动作
	SkipBehaviorAbort    SkipBehavior = "abort"    // 中断整个动作链
)

// FilterMode 过滤模式
type FilterMode string

const (
	FilterModeAll     FilterMode = "all"     // 全部动作
	FilterModeInclude FilterMode = "include" // 仅指定动作类型
	FilterModeExclude FilterMode = "exclude" // 排除指定动作类型
)

// InterceptorPhases 拦截器执行阶段配置
type InterceptorPhases struct {
	Before bool `json:"before"` // 前置阶段
	After  bool `json:"after"`  // 后置阶段
}

// Scan implements the sql.Scanner interface
func (p *InterceptorPhases) Scan(value interface{}) error {
	if value == nil {
		*p = InterceptorPhases{}
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
	return json.Unmarshal(bytes, p)
}

// Value implements the driver.Valuer interface
func (p InterceptorPhases) Value() (driver.Value, error) {
	return json.Marshal(p)
}

// InterceptorFilter 拦截器过滤条件
type InterceptorFilter struct {
	Mode              FilterMode `json:"mode"`                          // 过滤模式
	ActionTypes       []string   `json:"action_types,omitempty"`        // 动作类型列表
	UseAdvancedFilter bool       `json:"use_advanced_filter,omitempty"` // 是否使用高级表达式过滤
	Expressions       []any      `json:"expressions,omitempty"`         // 表达式列表(复用触发器表达式格式)
}

// Scan implements the sql.Scanner interface
func (f *InterceptorFilter) Scan(value interface{}) error {
	if value == nil {
		*f = InterceptorFilter{Mode: FilterModeAll}
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
	return json.Unmarshal(bytes, f)
}

// Value implements the driver.Valuer interface
func (f InterceptorFilter) Value() (driver.Value, error) {
	return json.Marshal(f)
}

// InterceptorErrorConfig 错误处理配置
type InterceptorErrorConfig struct {
	BeforeErrorPolicy ErrorHandlingPolicy `json:"before_error_policy"`           // 前置阶段错误策略
	AfterErrorPolicy  ErrorHandlingPolicy `json:"after_error_policy"`            // 后置阶段错误策略
	MaxRetries        int                 `json:"max_retries,omitempty"`         // 最大重试次数
	RetryDelaySeconds int                 `json:"retry_delay_seconds,omitempty"` // 重试间隔(秒)
}

// Scan implements the sql.Scanner interface
func (c *InterceptorErrorConfig) Scan(value interface{}) error {
	if value == nil {
		*c = InterceptorErrorConfig{
			BeforeErrorPolicy: ErrorPolicyAbort,
			AfterErrorPolicy:  ErrorPolicyContinue,
		}
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
	return json.Unmarshal(bytes, c)
}

// Value implements the driver.Valuer interface
func (c InterceptorErrorConfig) Value() (driver.Value, error) {
	return json.Marshal(c)
}

// InterceptorSkipConfig 跳过行为配置
type InterceptorSkipConfig struct {
	SkipBehavior       SkipBehavior `json:"skip_behavior"`         // 跳过后行为
	ExecuteAfterOnSkip bool         `json:"execute_after_on_skip"` // 跳过后是否执行后置
	LogSkipped         bool         `json:"log_skipped"`           // 是否记录被跳过的动作
}

// Scan implements the sql.Scanner interface
func (c *InterceptorSkipConfig) Scan(value interface{}) error {
	if value == nil {
		*c = InterceptorSkipConfig{
			SkipBehavior:       SkipBehaviorContinue,
			ExecuteAfterOnSkip: true,
			LogSkipped:         true,
		}
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
	return json.Unmarshal(bytes, c)
}

// Value implements the driver.Valuer interface
func (c InterceptorSkipConfig) Value() (driver.Value, error) {
	return json.Marshal(c)
}

// InterceptorAsyncConfig 异步执行配置
type InterceptorAsyncConfig struct {
	QueueName      string `json:"queue_name,omitempty"`      // 队列名称
	TimeoutSeconds int    `json:"timeout_seconds,omitempty"` // 超时时间(秒)
	MaxConcurrency int    `json:"max_concurrency,omitempty"` // 最大并发数
	RetryOnError   bool   `json:"retry_on_error,omitempty"`  // 失败时是否重试
	MaxRetries     int    `json:"max_retries,omitempty"`     // 最大重试次数
}

// Scan implements the sql.Scanner interface
func (c *InterceptorAsyncConfig) Scan(value interface{}) error {
	if value == nil {
		*c = InterceptorAsyncConfig{
			TimeoutSeconds: 30,
			MaxConcurrency: 10,
		}
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
	return json.Unmarshal(bytes, c)
}

// Value implements the driver.Valuer interface
func (c InterceptorAsyncConfig) Value() (driver.Value, error) {
	return json.Marshal(c)
}

// InterceptorExecutionConfig 执行配置
type InterceptorExecutionConfig struct {
	AfterMode   ExecutionMode           `json:"after_mode"`             // 后置阶段执行模式
	AsyncConfig *InterceptorAsyncConfig `json:"async_config,omitempty"` // 异步配置
}

// Scan implements the sql.Scanner interface
func (c *InterceptorExecutionConfig) Scan(value interface{}) error {
	if value == nil {
		*c = InterceptorExecutionConfig{
			AfterMode: ExecutionModeSync,
		}
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
	return json.Unmarshal(bytes, c)
}

// Value implements the driver.Valuer interface
func (c InterceptorExecutionConfig) Value() (driver.Value, error) {
	return json.Marshal(c)
}

// Interceptor 拦截器数据模型
type Interceptor struct {
	ID            uint                       `gorm:"primaryKey" json:"id"`
	OrgID         uint                       `gorm:"not null;index;default:1" json:"orgId"`
	Name          string                     `gorm:"not null" json:"name"`
	Description   string                     `json:"description,omitempty"`
	PluginID      string                     `gorm:"not null;index" json:"plugin_id"`
	PluginConfig  JSONMapInterface           `gorm:"type:text" json:"plugin_config,omitempty"`
	Scope         InterceptorScope           `gorm:"not null;index;default:global" json:"scope"`
	TriggerID     *uint                      `gorm:"index" json:"trigger_id,omitempty"`   // 局部拦截器关联的触发器
	ExtractorID   *uint                      `gorm:"index" json:"extractor_id,omitempty"` // 局部拦截器关联的提取器
	Enabled       bool                       `gorm:"default:true" json:"enabled"`
	Order         int                        `gorm:"default:100" json:"order"`
	Phases        InterceptorPhases          `gorm:"type:text" json:"phases"`
	Filter        InterceptorFilter          `gorm:"type:text" json:"filter"`
	ErrorHandling InterceptorErrorConfig     `gorm:"type:text" json:"error_handling"`
	SkipConfig    InterceptorSkipConfig      `gorm:"type:text" json:"skip_config"`
	Execution     InterceptorExecutionConfig `gorm:"type:text" json:"execution"`
	CreatedAt     time.Time                  `json:"created_at"`
	UpdatedAt     time.Time                  `json:"updated_at"`
	DeletedAt     DeletedAt                  `gorm:"index" json:"deleted_at,omitempty"`
}

// TableName specifies the table name for Interceptor
func (Interceptor) TableName() string {
	return "interceptors"
}

// InterceptorLog 拦截器执行日志
type InterceptorLog struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	InterceptorID   uint      `gorm:"index" json:"interceptor_id"`
	InterceptorName string    `json:"interceptor_name"`
	ActionID        string    `json:"action_id"`
	ActionPluginID  string    `json:"action_plugin_id"`
	Phase           string    `json:"phase"` // before/after
	TriggerID       *uint     `gorm:"index" json:"trigger_id,omitempty"`
	EmailID         *uint     `gorm:"index" json:"email_id,omitempty"`
	Success         bool      `json:"success"`
	Error           string    `gorm:"type:text" json:"error,omitempty"`
	Duration        int64     `json:"duration"` // 毫秒
	InputData       string    `gorm:"type:text" json:"input_data,omitempty"`
	OutputData      string    `gorm:"type:text" json:"output_data,omitempty"`
	ActionResult    string    `gorm:"type:text" json:"action_result,omitempty"` // 仅后置阶段
	DecisionMade    string    `json:"decision_made,omitempty"`                  // skip/abort/continue
	CreatedAt       time.Time `json:"created_at"`
}

// TableName specifies the table name for InterceptorLog
func (InterceptorLog) TableName() string {
	return "interceptor_logs"
}

// CreateInterceptorRequest 创建拦截器请求
type CreateInterceptorRequest struct {
	Name          string                     `json:"name" validate:"required"`
	Description   string                     `json:"description,omitempty"`
	PluginID      string                     `json:"plugin_id" validate:"required"`
	PluginConfig  map[string]interface{}     `json:"plugin_config,omitempty"`
	Scope         InterceptorScope           `json:"scope" validate:"required,oneof=global local"`
	TriggerID     *uint                      `json:"trigger_id,omitempty"`
	ExtractorID   *uint                      `json:"extractor_id,omitempty"`
	Enabled       bool                       `json:"enabled"`
	Order         int                        `json:"order"`
	Phases        InterceptorPhases          `json:"phases" validate:"required"`
	Filter        InterceptorFilter          `json:"filter"`
	ErrorHandling InterceptorErrorConfig     `json:"error_handling"`
	SkipConfig    InterceptorSkipConfig      `json:"skip_config"`
	Execution     InterceptorExecutionConfig `json:"execution"`
}

// UpdateInterceptorRequest 更新拦截器请求
type UpdateInterceptorRequest struct {
	Name          *string                     `json:"name,omitempty"`
	Description   *string                     `json:"description,omitempty"`
	PluginID      *string                     `json:"plugin_id,omitempty"`
	PluginConfig  map[string]interface{}      `json:"plugin_config,omitempty"`
	Enabled       *bool                       `json:"enabled,omitempty"`
	Order         *int                        `json:"order,omitempty"`
	Phases        *InterceptorPhases          `json:"phases,omitempty"`
	Filter        *InterceptorFilter          `json:"filter,omitempty"`
	ErrorHandling *InterceptorErrorConfig     `json:"error_handling,omitempty"`
	SkipConfig    *InterceptorSkipConfig      `json:"skip_config,omitempty"`
	Execution     *InterceptorExecutionConfig `json:"execution,omitempty"`
}

// InterceptorPluginInfo 拦截器插件信息（用于API返回）
type InterceptorPluginInfo struct {
	ID             string                 `json:"id"`
	Name           string                 `json:"name"`
	Description    string                 `json:"description"`
	Version        string                 `json:"version"`
	Type           string                 `json:"type"` // 拦截器类型: before_only, after_only, around
	SupportsBefore bool                   `json:"supports_before"`
	SupportsAfter  bool                   `json:"supports_after"`
	ConfigSchema   map[string]interface{} `json:"config_schema"`
	DefaultConfig  map[string]interface{} `json:"default_config"`
}
