package plugins

import (
	"context"
	"time"

	"mailman/internal/triggerv2/models"
)

// PluginType 插件类型
type PluginType string

const (
	// PluginTypeCondition 条件插件
	PluginTypeCondition PluginType = "condition"
	// PluginTypeAction 动作插件
	PluginTypeAction PluginType = "action"
	// PluginTypeTransform 转换插件
	PluginTypeTransform PluginType = "transform"
	// PluginTypeFilter 过滤插件
	PluginTypeFilter PluginType = "filter"
)

// PluginStatus 插件状态
type PluginStatus string

const (
	// PluginStatusLoaded 已加载
	PluginStatusLoaded PluginStatus = "loaded"
	// PluginStatusActive 活跃
	PluginStatusActive PluginStatus = "active"
	// PluginStatusInactive 非活跃
	PluginStatusInactive PluginStatus = "inactive"
	// PluginStatusError 错误
	PluginStatusError PluginStatus = "error"
	// PluginStatusUnloaded 已卸载
	PluginStatusUnloaded PluginStatus = "unloaded"
)

// PluginInfo 插件信息
type PluginInfo struct {
	// 基本信息
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Version     string     `json:"version"`
	Description string     `json:"description"`
	Author      string     `json:"author"`
	Website     string     `json:"website"`
	License     string     `json:"license"`
	Type        PluginType `json:"type"`

	// 状态信息
	Status     PluginStatus `json:"status"`
	LoadedAt   time.Time    `json:"loaded_at"`
	LastUsed   time.Time    `json:"last_used"`
	UsageCount int64        `json:"usage_count"`

	// 配置信息
	ConfigSchema  map[string]interface{} `json:"config_schema"`
	DefaultConfig map[string]interface{} `json:"default_config"`

	// 依赖和兼容性
	Dependencies []string `json:"dependencies"`
	MinVersion   string   `json:"min_version"`
	MaxVersion   string   `json:"max_version"`

	// 权限和安全
	Permissions []string `json:"permissions"`
	Sandbox     bool     `json:"sandbox"`

	// 性能信息
	AvgExecutionTime time.Duration `json:"avg_execution_time"`
	MaxExecutionTime time.Duration `json:"max_execution_time"`
	ErrorRate        float64       `json:"error_rate"`
}

// PluginConfig 插件配置
type PluginConfig struct {
	// 基本配置
	Enabled bool                   `json:"enabled"`
	Config  map[string]interface{} `json:"config"`

	// 执行配置
	Timeout    time.Duration `json:"timeout"`
	MaxRetries int           `json:"max_retries"`
	RetryDelay time.Duration `json:"retry_delay"`

	// 资源限制
	MaxMemory   int64         `json:"max_memory"`
	MaxCPU      int64         `json:"max_cpu"`
	MaxDuration time.Duration `json:"max_duration"`

	// 监控配置
	EnableMetrics bool `json:"enable_metrics"`
	EnableTracing bool `json:"enable_tracing"`
	EnableLogging bool `json:"enable_logging"`
}

// PluginResult 插件执行结果
type PluginResult struct {
	// 执行结果
	Success bool                   `json:"success"`
	Data    map[string]interface{} `json:"data"`
	Error   string                 `json:"error"`

	// 流程控制
	StopPipeline bool `json:"stop_pipeline"` // 是否中断后续流程

	// 元数据
	ExecutionTime time.Duration `json:"execution_time"`
	MemoryUsage   int64         `json:"memory_usage"`
	CPUUsage      int64         `json:"cpu_usage"`

	// 状态信息
	RetryCount int       `json:"retry_count"`
	Timestamp  time.Time `json:"timestamp"`
}

// PluginContext 插件执行上下文
type PluginContext struct {
	// 基本上下文
	Context context.Context

	// 插件信息
	PluginID string
	Config   *PluginConfig

	// 执行环境
	Event     *models.Event
	TriggerID uint

	// 资源管理
	Logger  Logger
	Metrics Metrics
	Storage Storage

	// 系统接口
	EventBus  EventBus
	Scheduler Scheduler
	Database  Database
}

// Plugin 插件基础接口
type Plugin interface {
	// 基本方法
	GetInfo() *PluginInfo
	Initialize(ctx *PluginContext) error
	Cleanup() error

	// 生命周期
	OnLoad() error
	OnUnload() error
	OnActivate() error
	OnDeactivate() error

	// 配置管理
	GetDefaultConfig() map[string]interface{}
	ValidateConfig(config map[string]interface{}) error
	ApplyConfig(config map[string]interface{}) error

	// 健康检查
	HealthCheck() error
	GetMetrics() map[string]interface{}
}

// ConditionPlugin 条件插件接口
type ConditionPlugin interface {
	Plugin

	// 条件评估
	Evaluate(ctx *PluginContext, event *models.Event) (*PluginResult, error)

	// 条件描述
	GetDescription() string
	GetSupportedEventTypes() []string
	GetRequiredFields() []string
}

// ActionPlugin 动作插件接口
type ActionPlugin interface {
	Plugin

	// 动作执行
	Execute(ctx *PluginContext, event *models.Event) (*PluginResult, error)

	// 动作描述
	GetDescription() string
	GetSupportedEventTypes() []string
	GetRequiredConfig() []string

	// 执行控制
	CanExecute(ctx *PluginContext, event *models.Event) bool
	GetExecutionOrder() int
}

// TransformPlugin 转换插件接口
type TransformPlugin interface {
	Plugin

	// 数据转换
	Transform(ctx *PluginContext, event *models.Event) (*models.Event, error)

	// 转换描述
	GetDescription() string
	GetSupportedEventTypes() []string
	GetOutputEventType() string
}

// FilterPlugin 过滤插件接口
type FilterPlugin interface {
	Plugin

	// 事件过滤
	Filter(ctx *PluginContext, event *models.Event) (bool, error)

	// 过滤描述
	GetDescription() string
	GetSupportedEventTypes() []string
	GetFilterCriteria() []string
}

// PluginManager 插件管理器接口
type PluginManager interface {
	// 插件注册
	RegisterPlugin(plugin Plugin) error
	UnregisterPlugin(pluginID string) error

	// 插件查找
	GetPlugin(pluginID string) (Plugin, error)
	GetPluginsByType(pluginType PluginType) ([]Plugin, error)
	ListPlugins() ([]*PluginInfo, error)

	// 插件生命周期
	LoadPlugin(pluginID string) error
	UnloadPlugin(pluginID string) error
	ActivatePlugin(pluginID string) error
	DeactivatePlugin(pluginID string) error

	// 插件配置
	GetPluginConfig(pluginID string) (*PluginConfig, error)
	SetPluginConfig(pluginID string, config *PluginConfig) error

	// 插件执行
	ExecuteCondition(pluginID string, ctx *PluginContext, event *models.Event) (*PluginResult, error)
	ExecuteAction(pluginID string, ctx *PluginContext, event *models.Event) (*PluginResult, error)
	ExecuteTransform(pluginID string, ctx *PluginContext, event *models.Event) (*models.Event, error)
	ExecuteFilter(pluginID string, ctx *PluginContext, event *models.Event) (bool, error)

	// 监控和统计
	GetPluginStats(pluginID string) (*PluginStats, error)
	GetAllPluginStats() (map[string]*PluginStats, error)

	// 健康检查
	CheckPluginHealth(pluginID string) error
	CheckAllPluginsHealth() (map[string]error, error)
}

// PluginRegistry 插件注册表接口
type PluginRegistry interface {
	// 插件发现
	DiscoverPlugins(paths []string) ([]Plugin, error)

	// 插件加载
	LoadPluginFromFile(filePath string) (Plugin, error)
	LoadPluginFromBytes(data []byte) (Plugin, error)

	// 插件验证
	ValidatePlugin(plugin Plugin) error
	ValidatePluginFile(filePath string) error

	// 插件信息
	GetPluginInfo(filePath string) (*PluginInfo, error)
	GetAvailablePlugins() ([]*PluginInfo, error)
}

// PluginStats 插件统计信息
type PluginStats struct {
	// 基本信息
	PluginID    string       `json:"plugin_id"`
	Status      PluginStatus `json:"status"`
	LastUpdated time.Time    `json:"last_updated"`

	// 执行统计
	TotalExecutions   int64         `json:"total_executions"`
	SuccessExecutions int64         `json:"success_executions"`
	FailedExecutions  int64         `json:"failed_executions"`
	AvgExecutionTime  time.Duration `json:"avg_execution_time"`
	MaxExecutionTime  time.Duration `json:"max_execution_time"`
	MinExecutionTime  time.Duration `json:"min_execution_time"`

	// 资源使用
	TotalMemoryUsage int64 `json:"total_memory_usage"`
	PeakMemoryUsage  int64 `json:"peak_memory_usage"`
	TotalCPUUsage    int64 `json:"total_cpu_usage"`
	PeakCPUUsage     int64 `json:"peak_cpu_usage"`

	// 错误统计
	ErrorsByType map[string]int64 `json:"errors_by_type"`
	LastError    string           `json:"last_error"`
	LastErrorAt  time.Time        `json:"last_error_at"`

	// 性能指标
	ExecutionRate float64 `json:"execution_rate"`
	SuccessRate   float64 `json:"success_rate"`
	ErrorRate     float64 `json:"error_rate"`
}

// 辅助接口定义

// Logger 日志接口
type Logger interface {
	Debug(msg string, args ...interface{})
	Info(msg string, args ...interface{})
	Warn(msg string, args ...interface{})
	Error(msg string, args ...interface{})
	Fatal(msg string, args ...interface{})
}

// Metrics 指标接口
type Metrics interface {
	Counter(name string, value int64, tags map[string]string)
	Gauge(name string, value float64, tags map[string]string)
	Histogram(name string, value float64, tags map[string]string)
	Timer(name string, duration time.Duration, tags map[string]string)
}

// Storage 存储接口
type Storage interface {
	Get(key string) ([]byte, error)
	Set(key string, value []byte) error
	Delete(key string) error
	List(prefix string) ([]string, error)
	Exists(key string) bool
}

// EventBus 事件总线接口
type EventBus interface {
	Publish(event *models.Event) error
	Subscribe(eventType string, handler func(*models.Event)) error
	Unsubscribe(eventType string, handler func(*models.Event)) error
}

// Scheduler 调度器接口
type Scheduler interface {
	ScheduleTask(task Task) error
	CancelTask(taskID string) error
	GetTaskStatus(taskID string) (TaskStatus, error)
}

// Database 数据库接口
type Database interface {
	Query(query string, args ...interface{}) ([]map[string]interface{}, error)
	Execute(query string, args ...interface{}) error
	Transaction(fn func(tx Database) error) error
}

// Task 任务接口
type Task interface {
	GetID() string
	GetType() string
	Execute(ctx context.Context) error
}

// TaskStatus 任务状态
type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusCompleted TaskStatus = "completed"
	TaskStatusFailed    TaskStatus = "failed"
	TaskStatusCancelled TaskStatus = "cancelled"
)

// 插件事件类型
const (
	// 插件生命周期事件
	EventPluginLoaded      = "plugin.loaded"
	EventPluginUnloaded    = "plugin.unloaded"
	EventPluginActivated   = "plugin.activated"
	EventPluginDeactivated = "plugin.deactivated"
	EventPluginError       = "plugin.error"

	// 插件执行事件
	EventPluginExecutionStarted   = "plugin.execution.started"
	EventPluginExecutionCompleted = "plugin.execution.completed"
	EventPluginExecutionFailed    = "plugin.execution.failed"
	EventPluginExecutionTimeout   = "plugin.execution.timeout"

	// 插件配置事件
	EventPluginConfigUpdated = "plugin.config.updated"
	EventPluginConfigError   = "plugin.config.error"
)

// 插件权限定义
const (
	// 基本权限
	PermissionRead  = "read"
	PermissionWrite = "write"
	PermissionAdmin = "admin"

	// 系统权限
	PermissionSystem     = "system"
	PermissionNetwork    = "network"
	PermissionFileSystem = "filesystem"
	PermissionDatabase   = "database"

	// 事件权限
	PermissionEventRead    = "event.read"
	PermissionEventWrite   = "event.write"
	PermissionEventPublish = "event.publish"

	// 配置权限
	PermissionConfigRead  = "config.read"
	PermissionConfigWrite = "config.write"
)

// 插件错误类型
const (
	ErrPluginNotFound         = "plugin_not_found"
	ErrPluginLoadFailed       = "plugin_load_failed"
	ErrPluginInitFailed       = "plugin_init_failed"
	ErrPluginExecFailed       = "plugin_exec_failed"
	ErrPluginTimeout          = "plugin_timeout"
	ErrPluginConfigError      = "plugin_config_error"
	ErrPluginPermissionDenied = "plugin_permission_denied"
	ErrPluginResourceLimit    = "plugin_resource_limit"
)

// 插件配置验证器
type ConfigValidator interface {
	ValidateConfig(config map[string]interface{}) error
	GetSchema() map[string]interface{}
}

// 插件执行器
type PluginExecutor interface {
	Execute(ctx *PluginContext, plugin Plugin, args ...interface{}) (*PluginResult, error)
	ExecuteWithTimeout(ctx *PluginContext, plugin Plugin, timeout time.Duration, args ...interface{}) (*PluginResult, error)
	GetExecutionStats(pluginID string) (*PluginStats, error)
}

// 插件安全管理器
type PluginSecurityManager interface {
	ValidatePermissions(pluginID string, permissions []string) error
	CheckPermission(pluginID string, permission string) bool
	CreateSandbox(pluginID string) (Sandbox, error)
	DestroySandbox(pluginID string) error
}

// 沙箱环境
type Sandbox interface {
	Execute(fn func() error) error
	SetResourceLimits(limits *ResourceLimits) error
	GetResourceUsage() (*ResourceUsage, error)
}

// 资源限制
type ResourceLimits struct {
	MaxMemory   int64         `json:"max_memory"`
	MaxCPU      int64         `json:"max_cpu"`
	MaxDuration time.Duration `json:"max_duration"`
	MaxFiles    int           `json:"max_files"`
	MaxNetwork  int64         `json:"max_network"`
}

// 资源使用情况
type ResourceUsage struct {
	MemoryUsage  int64         `json:"memory_usage"`
	CPUUsage     int64         `json:"cpu_usage"`
	Duration     time.Duration `json:"duration"`
	FilesOpened  int           `json:"files_opened"`
	NetworkBytes int64         `json:"network_bytes"`
	Timestamp    time.Time     `json:"timestamp"`
}
