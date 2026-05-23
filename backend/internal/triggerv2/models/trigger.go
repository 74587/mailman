package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

// JSONMap is a custom type for storing map[string]string in database
type JSONMap map[string]string

// Scan implements the sql.Scanner interface
func (m *JSONMap) Scan(value interface{}) error {
	if value == nil {
		*m = make(map[string]string)
		return nil
	}

	bytes, ok := value.([]byte)
	if !ok {
		// Try string type as well
		if str, isString := value.(string); isString {
			bytes = []byte(str)
		} else {
			return fmt.Errorf("cannot convert value to bytes, got type %T", value)
		}
	}

	if len(bytes) == 0 {
		*m = make(map[string]string)
		return nil
	}

	if err := json.Unmarshal(bytes, m); err != nil {
		return err
	}
	return nil
}

// Value implements the driver.Valuer interface
func (m JSONMap) Value() (driver.Value, error) {
	if m == nil {
		return "{}", nil
	}
	bytes, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

// TriggerV2Status 触发器状态
type TriggerV2Status string

const (
	TriggerV2StatusActive   TriggerV2Status = "active"
	TriggerV2StatusInactive TriggerV2Status = "inactive"
	TriggerV2StatusError    TriggerV2Status = "error"
)

// TriggerV2Priority 触发器优先级
type TriggerV2Priority int

const (
	TriggerV2PriorityLow    TriggerV2Priority = 1
	TriggerV2PriorityNormal TriggerV2Priority = 5
	TriggerV2PriorityHigh   TriggerV2Priority = 10
)

// ConditionType 条件类型
type ConditionType string

const (
	ConditionTypeLogical ConditionType = "logical" // 逻辑组合条件
	ConditionTypePlugin  ConditionType = "plugin"  // 插件条件
)

// LogicalOperator 逻辑操作符
type LogicalOperator string

const (
	LogicalOperatorAnd LogicalOperator = "and"
	LogicalOperatorOr  LogicalOperator = "or"
	LogicalOperatorNot LogicalOperator = "not"
)

// ActionType 动作类型
type ActionType string

const (
	ActionTypePlugin ActionType = "plugin" // 插件动作
)

// ConditionConfig 条件配置
type ConditionConfig struct {
	Type     ConditionType          `json:"type"`
	Operator LogicalOperator        `json:"operator,omitempty"`
	Children []ConditionConfig      `json:"children,omitempty"`
	Plugin   string                 `json:"plugin,omitempty"`
	Config   map[string]interface{} `json:"config,omitempty"`
	Timeout  *int                   `json:"timeout,omitempty"`
	Cache    *ConditionCacheConfig  `json:"cache,omitempty"`
}

// ConditionCacheConfig 条件缓存配置
type ConditionCacheConfig struct {
	Enabled bool          `json:"enabled"`
	TTL     time.Duration `json:"ttl"`
	Key     string        `json:"key"`
}

// ActionConfig 动作配置
type ActionConfig struct {
	Type        ActionType             `json:"type"`
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Plugin      string                 `json:"plugin"`
	Config      map[string]interface{} `json:"config"`
	Enabled     bool                   `json:"enabled"`
	Order       int                    `json:"order"`
	Timeout     *int                   `json:"timeout,omitempty"`
	Retry       *ActionRetryConfig     `json:"retry,omitempty"`
}

// ActionRetryConfig 动作重试配置
type ActionRetryConfig struct {
	MaxAttempts int           `json:"max_attempts"`
	Delay       time.Duration `json:"delay"`
	Backoff     float64       `json:"backoff"`
}

// FilterConfig 过滤条件配置
type FilterConfig struct {
	EmailAddress  string            `json:"email_address,omitempty"`
	StartDate     *time.Time        `json:"start_date,omitempty"`
	EndDate       *time.Time        `json:"end_date,omitempty"`
	Subject       string            `json:"subject,omitempty"`
	From          string            `json:"from,omitempty"`
	To            string            `json:"to,omitempty"`
	HasAttachment *bool             `json:"has_attachment,omitempty"`
	Unread        *bool             `json:"unread,omitempty"`
	Labels        []string          `json:"labels,omitempty"`
	Folders       []string          `json:"folders,omitempty"`
	CustomFilters map[string]string `json:"custom_filters,omitempty"`
}

// TriggerV2 触发器V2模型
type TriggerV2 struct {
	ID          uint              `gorm:"primaryKey" json:"id"`
	Name        string            `gorm:"not null;type:varchar(255)" json:"name"`
	Description string            `gorm:"type:text" json:"description,omitempty"`
	Status      TriggerV2Status   `gorm:"not null;default:'inactive'" json:"status"`
	Priority    TriggerV2Priority `gorm:"not null;default:5" json:"priority"`

	// 过滤配置
	Filter FilterConfig `gorm:"type:json" json:"filter"`

	// 条件配置
	Condition ConditionConfig `gorm:"type:json;not null" json:"condition"`

	// 动作配置
	Actions []ActionConfig `gorm:"type:json;not null" json:"actions"`

	// 执行配置
	ExecutionConfig ExecutionConfig `gorm:"type:json" json:"execution_config"`

	// 监控配置
	MonitoringConfig MonitoringConfig `gorm:"type:json" json:"monitoring_config"`

	// 统计信息
	Stats TriggerV2Stats `gorm:"type:json" json:"stats"`

	// 元数据
	Metadata JSONMap `gorm:"type:json" json:"metadata,omitempty"`

	// 时间戳
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	DeletedAt DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

// ExecutionConfig 执行配置
type ExecutionConfig struct {
	Mode            ExecutionMode   `json:"mode"`
	BatchSize       int             `json:"batch_size"`
	ConcurrentLimit int             `json:"concurrent_limit"`
	Timeout         time.Duration   `json:"timeout"`
	RetryPolicy     RetryPolicy     `json:"retry_policy"`
	RateLimitConfig RateLimitConfig `json:"rate_limit"`
}

// ExecutionMode 执行模式
type ExecutionMode string

const (
	ExecutionModeImmediate ExecutionMode = "immediate" // 立即执行
	ExecutionModeBatch     ExecutionMode = "batch"     // 批量执行
	ExecutionModeScheduled ExecutionMode = "scheduled" // 定时执行
)

// RetryPolicy 重试策略
type RetryPolicy struct {
	MaxAttempts  int           `json:"max_attempts"`
	InitialDelay time.Duration `json:"initial_delay"`
	MaxDelay     time.Duration `json:"max_delay"`
	Backoff      float64       `json:"backoff"`
}

// RateLimitConfig 速率限制配置
type RateLimitConfig struct {
	Enabled bool          `json:"enabled"`
	Rate    int           `json:"rate"`
	Burst   int           `json:"burst"`
	Window  time.Duration `json:"window"`
}

// MonitoringConfig 监控配置
type MonitoringConfig struct {
	LoggingEnabled  bool            `json:"logging_enabled"`
	MetricsEnabled  bool            `json:"metrics_enabled"`
	AlertingEnabled bool            `json:"alerting_enabled"`
	RetentionPeriod time.Duration   `json:"retention_period"`
	AlertThresholds AlertThresholds `json:"alert_thresholds"`
}

// AlertThresholds 告警阈值
type AlertThresholds struct {
	ErrorRate     float64 `json:"error_rate"`
	ExecutionTime int64   `json:"execution_time"`
	QueueSize     int     `json:"queue_size"`
	MemoryUsage   int64   `json:"memory_usage"`
}

// TriggerV2Stats 触发器统计信息
type TriggerV2Stats struct {
	TotalExecutions      int64      `json:"total_executions"`
	SuccessfulExecutions int64      `json:"successful_executions"`
	FailedExecutions     int64      `json:"failed_executions"`
	AverageExecutionTime int64      `json:"average_execution_time"`
	LastExecutedAt       *time.Time `json:"last_executed_at"`
	LastError            string     `json:"last_error,omitempty"`
	CreatedAt            time.Time  `json:"created_at"`
}

// DeletedAt 软删除时间
type DeletedAt struct {
	Time  time.Time
	Valid bool
}

// Scan 实现 sql.Scanner 接口
func (dt *DeletedAt) Scan(value interface{}) error {
	if value == nil {
		dt.Valid = false
		return nil
	}

	switch v := value.(type) {
	case time.Time:
		dt.Time = v
		dt.Valid = true
	case []byte:
		if len(v) == 0 {
			dt.Valid = false
			return nil
		}
		t, err := time.Parse("2006-01-02 15:04:05", string(v))
		if err != nil {
			return err
		}
		dt.Time = t
		dt.Valid = true
	case string:
		if v == "" {
			dt.Valid = false
			return nil
		}
		t, err := time.Parse("2006-01-02 15:04:05", v)
		if err != nil {
			return err
		}
		dt.Time = t
		dt.Valid = true
	default:
		return fmt.Errorf("cannot scan %T into DeletedAt", value)
	}

	return nil
}

// Value 实现 driver.Valuer 接口
func (dt DeletedAt) Value() (driver.Value, error) {
	if !dt.Valid {
		return nil, nil
	}
	return dt.Time, nil
}

// NewTriggerV2 创建新的TriggerV2
func NewTriggerV2(name, description string) *TriggerV2 {
	now := time.Now()
	return &TriggerV2{
		Name:        name,
		Description: description,
		Status:      TriggerV2StatusInactive,
		Priority:    TriggerV2PriorityNormal,
		Filter:      FilterConfig{},
		Condition:   ConditionConfig{},
		Actions:     []ActionConfig{},
		ExecutionConfig: ExecutionConfig{
			Mode:            ExecutionModeImmediate,
			BatchSize:       10,
			ConcurrentLimit: 5,
			Timeout:         30 * time.Second,
			RetryPolicy: RetryPolicy{
				MaxAttempts:  3,
				InitialDelay: 1 * time.Second,
				MaxDelay:     60 * time.Second,
				Backoff:      2.0,
			},
			RateLimitConfig: RateLimitConfig{
				Enabled: false,
				Rate:    100,
				Burst:   10,
				Window:  time.Minute,
			},
		},
		MonitoringConfig: MonitoringConfig{
			LoggingEnabled:  true,
			MetricsEnabled:  true,
			AlertingEnabled: false,
			RetentionPeriod: 30 * 24 * time.Hour,
			AlertThresholds: AlertThresholds{
				ErrorRate:     0.1,
				ExecutionTime: 5000,
				QueueSize:     1000,
				MemoryUsage:   1024 * 1024 * 100,
			},
		},
		Stats: TriggerV2Stats{
			CreatedAt: now,
		},
		Metadata:  make(JSONMap),
		CreatedAt: now,
		UpdatedAt: now,
	}
}

// IsActive 检查触发器是否活跃
func (t *TriggerV2) IsActive() bool {
	return t.Status == TriggerV2StatusActive
}

// CanExecute 检查是否可以执行
func (t *TriggerV2) CanExecute() bool {
	return t.IsActive() && len(t.Actions) > 0
}

// IncrementStats 增加统计信息
func (t *TriggerV2) IncrementStats(success bool, executionTime int64) {
	oldTotal := t.Stats.TotalExecutions
	t.Stats.TotalExecutions++

	if success {
		t.Stats.SuccessfulExecutions++
	} else {
		t.Stats.FailedExecutions++
	}

	// 更新平均执行时间 - 使用增量平均算法
	if oldTotal == 0 {
		t.Stats.AverageExecutionTime = executionTime
	} else {
		// 增量平均公式: newAvg = oldAvg + (newValue - oldAvg) / newCount
		t.Stats.AverageExecutionTime = t.Stats.AverageExecutionTime +
			(executionTime-t.Stats.AverageExecutionTime)/int64(t.Stats.TotalExecutions)
	}

	now := time.Now()
	t.Stats.LastExecutedAt = &now
	t.UpdatedAt = now
}

// SetError 设置错误信息
func (t *TriggerV2) SetError(err error) {
	t.Status = TriggerV2StatusError
	t.Stats.LastError = err.Error()
	t.UpdatedAt = time.Now()
}

// ClearError 清除错误信息
func (t *TriggerV2) ClearError() {
	if t.Status == TriggerV2StatusError {
		t.Status = TriggerV2StatusInactive
	}
	t.Stats.LastError = ""
	t.UpdatedAt = time.Now()
}

// GetSuccessRate 获取成功率
func (t *TriggerV2) GetSuccessRate() float64 {
	if t.Stats.TotalExecutions == 0 {
		return 0.0
	}
	return float64(t.Stats.SuccessfulExecutions) / float64(t.Stats.TotalExecutions) * 100
}

// GetFailureRate 获取失败率
func (t *TriggerV2) GetFailureRate() float64 {
	if t.Stats.TotalExecutions == 0 {
		return 0.0
	}
	return float64(t.Stats.FailedExecutions) / float64(t.Stats.TotalExecutions) * 100
}

// Activate 激活触发器
func (t *TriggerV2) Activate() {
	t.Status = TriggerV2StatusActive
	t.UpdatedAt = time.Now()
}

// Deactivate 停用触发器
func (t *TriggerV2) Deactivate() {
	t.Status = TriggerV2StatusInactive
	t.UpdatedAt = time.Now()
}

// Validate 验证触发器配置
func (t *TriggerV2) Validate() error {
	if t.Name == "" {
		return fmt.Errorf("触发器名称不能为空")
	}

	if len(t.Actions) == 0 {
		return fmt.Errorf("触发器至少需要一个动作")
	}

	// 验证动作配置
	for i, action := range t.Actions {
		if action.Plugin == "" {
			return fmt.Errorf("动作 %d 的插件名称不能为空", i)
		}
		if action.Name == "" {
			return fmt.Errorf("动作 %d 的名称不能为空", i)
		}
	}

	return nil
}

// Clone 克隆触发器
func (t *TriggerV2) Clone() *TriggerV2 {
	clone := *t
	clone.ID = 0
	clone.Name = t.Name + " (副本)"
	clone.Status = TriggerV2StatusInactive
	clone.Stats = TriggerV2Stats{
		CreatedAt: time.Now(),
	}
	now := time.Now()
	clone.CreatedAt = now
	clone.UpdatedAt = now
	return &clone
}
