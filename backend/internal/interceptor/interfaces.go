package interceptor

import (
	"context"
	"time"

	"mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// Phase 拦截阶段
type Phase string

const (
	PhaseBefore Phase = "before" // 动作执行前
	PhaseAfter  Phase = "after"  // 动作执行后
)

// Type 拦截器类型
type Type string

const (
	// TypeBeforeOnly 仅前置拦截器 - 只在动作执行前工作，如权限验证、参数检查
	TypeBeforeOnly Type = "before_only"
	// TypeAfterOnly 仅后置拦截器 - 只在动作执行后工作，如发送通知
	TypeAfterOnly Type = "after_only"
	// TypeAround 环绕拦截器 - 需要前后配合工作，如日志记录、性能监控
	TypeAround Type = "around"
)

// Decision 拦截器决策结果
type Decision string

const (
	DecisionContinue   Decision = "continue"    // 继续执行
	DecisionAbort      Decision = "abort"       // 中断执行
	DecisionSkipAction Decision = "skip_action" // 跳过当前动作
)

// ActionInfo 动作信息（传递给拦截器）
type ActionInfo struct {
	ID             string                 `json:"id"`
	PluginID       string                 `json:"plugin_id"`
	PluginName     string                 `json:"plugin_name"`
	Config         map[string]interface{} `json:"config"`
	ExecutionOrder int                    `json:"execution_order"`
	Depth          int                    `json:"depth"` // 嵌套深度
	Enabled        bool                   `json:"enabled"`
}

// InterceptorContext 拦截器执行上下文
type InterceptorContext struct {
	Context         context.Context
	Phase           Phase                  // 当前执行阶段
	InterceptorID   uint                   // 当前拦截器配置ID
	InterceptorName string                 // 当前拦截器名称
	Action          *ActionInfo            // 当前动作信息
	Event           *triggerModels.Event   // 共享事件（包含变量等）
	TriggerID       uint                   // 触发器ID
	Email           *models.Email          // 邮件数据（可选）
	ActionResult    *ActionResult          // 动作执行结果（仅后置阶段）
	StartTime       time.Time              // 开始时间
	Metadata        map[string]interface{} // 扩展元数据
}

// ActionResult 动作执行结果（用于后置阶段）
type ActionResult struct {
	Success      bool          `json:"success"`
	Data         interface{}   `json:"data,omitempty"`
	Error        string        `json:"error,omitempty"`
	Duration     time.Duration `json:"duration"`
	StopPipeline bool          `json:"stop_pipeline"`
}

// InterceptorResult 拦截器执行结果
type InterceptorResult struct {
	Decision      Decision               `json:"decision"`                 // 决策结果
	Success       bool                   `json:"success"`                  // 是否执行成功
	Error         string                 `json:"error,omitempty"`          // 错误信息
	Data          map[string]interface{} `json:"data,omitempty"`           // 返回数据
	ModifiedEvent *triggerModels.Event   `json:"modified_event,omitempty"` // 修改后的事件（可选）
	ExecutionTime time.Duration          `json:"execution_time"`           // 执行耗时
}

// InterceptorPlugin 拦截器插件接口
type InterceptorPlugin interface {
	plugins.Plugin // 继承基础插件接口

	// GetType 获取拦截器类型
	// - before_only: 仅前置拦截，可单独工作
	// - after_only: 仅后置拦截，可单独工作
	// - around: 环绕拦截，前后必须同时启用
	GetType() Type

	// GetSupportedPhases 获取支持的执行阶段
	GetSupportedPhases() []Phase

	// BeforeAction 前置拦截（动作执行前调用）
	// 返回 nil 表示继续执行，返回 error 表示执行失败
	// InterceptorResult.Decision 决定后续行为
	BeforeAction(ctx *InterceptorContext) (*InterceptorResult, error)

	// AfterAction 后置拦截（动作执行后调用）
	// 此阶段无法阻止动作执行，但可以记录日志、发送通知等
	AfterAction(ctx *InterceptorContext) (*InterceptorResult, error)

	// CanIntercept 检查是否可以拦截此动作
	CanIntercept(action *ActionInfo, phase Phase) bool
}

// InterceptorConfig 拦截器实例配置（运行时使用）
type InterceptorConfig struct {
	// 基本信息
	ID          uint   `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	PluginID    string `json:"plugin_id"`
	Enabled     bool   `json:"enabled"`
	Order       int    `json:"order"`

	// 阶段配置
	Phases models.InterceptorPhases `json:"phases"`

	// 过滤配置
	Filter models.InterceptorFilter `json:"filter"`

	// 错误处理
	ErrorHandling models.InterceptorErrorConfig `json:"error_handling"`

	// 跳过配置
	SkipConfig models.InterceptorSkipConfig `json:"skip_config"`

	// 执行配置
	Execution models.InterceptorExecutionConfig `json:"execution"`

	// 插件配置
	PluginConfig map[string]interface{} `json:"plugin_config,omitempty"`

	// 作用域
	Scope       models.InterceptorScope `json:"scope"`
	TriggerID   *uint                   `json:"trigger_id,omitempty"`
	ExtractorID *uint                   `json:"extractor_id,omitempty"`
}

// InterceptorManager 拦截器管理器接口
type InterceptorManager interface {
	// 注册拦截器插件
	RegisterPlugin(plugin InterceptorPlugin) error
	UnregisterPlugin(pluginID string) error
	GetPlugin(pluginID string) (InterceptorPlugin, error)
	ListPlugins() ([]*models.InterceptorPluginInfo, error)

	// 获取配置快照（用于执行任务,保证执行过程中配置不变）
	GetSnapshot() *InterceptorSnapshot

	// 热更新配置
	UpdateConfig(config *InterceptorConfig) error
	RemoveConfig(id uint) error
	ReloadConfigs() error

	// 执行拦截
	ExecuteBefore(ctx *InterceptorContext) (*InterceptorResult, error)
	ExecuteAfter(ctx *InterceptorContext) (*InterceptorResult, error)

	// 订阅配置变更
	Subscribe(ch chan struct{})
	Unsubscribe(ch chan struct{})
}

// AdvancedFilterEvaluator evaluates interceptor advanced filter expressions.
// It is injected by the application layer to keep the interceptor package
// independent from the trigger condition engine implementation.
type AdvancedFilterEvaluator func(filter models.InterceptorFilter, ctx *InterceptorContext) (bool, models.JSONMap, error)

// DiagnosticLogWriter persists manager-level interceptor diagnostics, such as
// filter skips that happen before a plugin instance is executed.
type DiagnosticLogWriter func(logEntry *models.InterceptorLog) error

// InterceptorSnapshot 拦截器配置快照（不可变）
type InterceptorSnapshot struct {
	Version       int64                         `json:"version"`
	GlobalConfigs []*InterceptorConfig          `json:"global_configs"`
	LocalConfigs  map[uint][]*InterceptorConfig `json:"local_configs"` // key: triggerID 或 extractorID
	CreatedAt     time.Time                     `json:"created_at"`
}

// GetConfigsForTrigger 获取指定触发器的所有拦截器配置（全局+局部）
func (s *InterceptorSnapshot) GetConfigsForTrigger(triggerID uint, phase Phase) []*InterceptorConfig {
	var result []*InterceptorConfig

	// 添加全局配置
	for _, cfg := range s.GlobalConfigs {
		if s.matchPhase(cfg, phase) {
			result = append(result, cfg)
		}
	}

	// 添加局部配置
	if localConfigs, ok := s.LocalConfigs[triggerID]; ok {
		for _, cfg := range localConfigs {
			if s.matchPhase(cfg, phase) {
				result = append(result, cfg)
			}
		}
	}

	return result
}

// matchPhase 检查配置是否匹配指定阶段
func (s *InterceptorSnapshot) matchPhase(cfg *InterceptorConfig, phase Phase) bool {
	if !cfg.Enabled {
		return false
	}
	switch phase {
	case PhaseBefore:
		return cfg.Phases.Before
	case PhaseAfter:
		return cfg.Phases.After
	default:
		return false
	}
}
