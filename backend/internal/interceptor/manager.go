package interceptor

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"time"

	"mailman/internal/models"
)

// Manager 拦截器管理器实现
type Manager struct {
	registry                *Registry
	advancedFilterEvaluator AdvancedFilterEvaluator
	diagnosticLogWriter     DiagnosticLogWriter
}

// NewManager 创建拦截器管理器
func NewManager() *Manager {
	return &Manager{
		registry: NewRegistry(),
	}
}

// SetAdvancedFilterEvaluator wires advanced expression filtering into the
// interceptor manager without coupling this package to the condition engine.
func (m *Manager) SetAdvancedFilterEvaluator(evaluator AdvancedFilterEvaluator) {
	m.advancedFilterEvaluator = evaluator
}

// SetDiagnosticLogWriter enables manager-level diagnostic persistence for
// filter decisions that skip plugin execution.
func (m *Manager) SetDiagnosticLogWriter(writer DiagnosticLogWriter) {
	m.diagnosticLogWriter = writer
}

// RegisterPlugin 注册拦截器插件
func (m *Manager) RegisterPlugin(plugin InterceptorPlugin) error {
	return m.registry.RegisterPlugin(plugin)
}

// UnregisterPlugin 注销拦截器插件
func (m *Manager) UnregisterPlugin(pluginID string) error {
	return m.registry.UnregisterPlugin(pluginID)
}

// GetPlugin 获取插件
func (m *Manager) GetPlugin(pluginID string) (InterceptorPlugin, error) {
	return m.registry.GetPlugin(pluginID)
}

// ListPlugins 列出所有插件信息
func (m *Manager) ListPlugins() ([]*models.InterceptorPluginInfo, error) {
	return m.registry.ListPlugins()
}

// GetSnapshot 获取配置快照
func (m *Manager) GetSnapshot() *InterceptorSnapshot {
	return m.registry.GetSnapshot()
}

// UpdateConfig 更新配置
func (m *Manager) UpdateConfig(config *InterceptorConfig) error {
	return m.registry.UpdateConfig(config)
}

// RemoveConfig 移除配置
func (m *Manager) RemoveConfig(id uint) error {
	return m.registry.RemoveConfig(id)
}

// ReloadConfigs 重新加载配置
func (m *Manager) ReloadConfigs() error {
	return m.registry.ReloadConfigs()
}

// LoadConfigs 加载配置列表
func (m *Manager) LoadConfigs(configs []*InterceptorConfig) error {
	return m.registry.LoadConfigs(configs)
}

// Subscribe 订阅配置变更
func (m *Manager) Subscribe(ch chan struct{}) {
	m.registry.Subscribe(ch)
}

// Unsubscribe 取消订阅
func (m *Manager) Unsubscribe(ch chan struct{}) {
	m.registry.Unsubscribe(ch)
}

// ExecuteBefore 执行前置拦截
func (m *Manager) ExecuteBefore(ctx *InterceptorContext) (*InterceptorResult, error) {
	return m.execute(ctx, PhaseBefore)
}

// ExecuteAfter 执行后置拦截
func (m *Manager) ExecuteAfter(ctx *InterceptorContext) (*InterceptorResult, error) {
	return m.execute(ctx, PhaseAfter)
}

// execute 执行拦截器链
func (m *Manager) execute(ctx *InterceptorContext, phase Phase) (*InterceptorResult, error) {
	ctx.Phase = phase
	ctx.StartTime = time.Now()

	// 获取配置快照
	snapshot := m.registry.GetSnapshot()

	// 获取适用的拦截器配置
	var configs []*InterceptorConfig
	if ctx.TriggerID > 0 {
		configs = snapshot.GetConfigsForTrigger(ctx.TriggerID, phase)
	} else {
		// 没有触发器ID时，只使用全局配置
		for _, cfg := range snapshot.GlobalConfigs {
			if snapshot.matchPhase(cfg, phase) {
				configs = append(configs, cfg)
			}
		}
	}

	if len(configs) == 0 {
		return &InterceptorResult{
			Decision: DecisionContinue,
			Success:  true,
		}, nil
	}

	// 按 order 排序
	sort.Slice(configs, func(i, j int) bool {
		return configs[i].Order < configs[j].Order
	})

	// 执行拦截器链
	var finalResult *InterceptorResult
	for _, config := range configs {
		result, err := m.executeOne(ctx, config, phase)
		if err != nil {
			log.Printf("[InterceptorManager] Interceptor %s execution error: %v", config.Name, err)
			// 根据错误策略处理
			result = m.handleError(config, phase, err)
		}

		finalResult = result

		// 根据决策决定是否继续
		switch result.Decision {
		case DecisionAbort:
			log.Printf("[InterceptorManager] Interceptor %s decided to abort", config.Name)
			return result, nil
		case DecisionSkipAction:
			log.Printf("[InterceptorManager] Interceptor %s decided to skip action", config.Name)
			return result, nil
		case DecisionContinue:
			// 继续执行下一个拦截器
			continue
		}
	}

	if finalResult == nil {
		finalResult = &InterceptorResult{
			Decision: DecisionContinue,
			Success:  true,
		}
	}

	return finalResult, nil
}

// executeOne 执行单个拦截器
func (m *Manager) executeOne(ctx *InterceptorContext, config *InterceptorConfig, phase Phase) (*InterceptorResult, error) {
	// 获取插件
	plugin, err := m.registry.GetPlugin(config.PluginID)
	if err != nil {
		return nil, fmt.Errorf("plugin not found: %s", config.PluginID)
	}

	// 检查是否可以拦截此动作
	filterDecision, err := m.shouldIntercept(config, ctx)
	if err != nil {
		return nil, err
	}
	if !filterDecision.Matched {
		m.logFilterSkip(ctx, config, phase, filterDecision)
		return &InterceptorResult{
			Decision: DecisionContinue,
			Success:  true,
			Data: map[string]interface{}{
				"skipped": true,
				"reason":  filterDecision.Reason,
			},
		}, nil
	}

	// 应用插件配置
	if err := plugin.ApplyConfig(config.PluginConfig); err != nil {
		return nil, fmt.Errorf("failed to apply config: %w", err)
	}

	// 设置当前拦截器信息到上下文
	ctx.InterceptorID = config.ID
	ctx.InterceptorName = config.Name

	// 执行拦截
	startTime := time.Now()
	var result *InterceptorResult

	switch phase {
	case PhaseBefore:
		result, err = plugin.BeforeAction(ctx)
	case PhaseAfter:
		result, err = plugin.AfterAction(ctx)
	default:
		return nil, fmt.Errorf("unknown phase: %s", phase)
	}

	if result != nil {
		result.ExecutionTime = time.Since(startTime)
	}

	return result, err
}

type filterDecision struct {
	Matched         bool
	Reason          string
	ActionMatched   bool
	AdvancedEnabled bool
	AdvancedMatched *bool
	Details         models.JSONMap
}

// shouldIntercept 检查是否应该拦截此动作
func (m *Manager) shouldIntercept(config *InterceptorConfig, ctx *InterceptorContext) (filterDecision, error) {
	action := ctx.Action
	matchesActionType := true
	if action == nil {
		matchesActionType = true
	} else {
		filter := config.Filter

		switch filter.Mode {
		case models.FilterModeAll:
			matchesActionType = true
		case models.FilterModeInclude:
			matchesActionType = false
			for _, t := range filter.ActionTypes {
				if t == action.PluginID {
					matchesActionType = true
					break
				}
			}
		case models.FilterModeExclude:
			matchesActionType = true
			for _, t := range filter.ActionTypes {
				if t == action.PluginID {
					matchesActionType = false
					break
				}
			}
		default:
			matchesActionType = true
		}
	}

	filter := config.Filter
	if !matchesActionType {
		return filterDecision{
			Matched:       false,
			Reason:        "action_type_not_matched",
			ActionMatched: false,
		}, nil
	}

	if !filter.UseAdvancedFilter || len(filter.Expressions) == 0 {
		return filterDecision{
			Matched:       true,
			Reason:        "matched",
			ActionMatched: true,
		}, nil
	}
	if m.advancedFilterEvaluator == nil {
		return filterDecision{}, fmt.Errorf("advanced interceptor filter is enabled but evaluator is not configured")
	}
	matched, details, err := m.advancedFilterEvaluator(filter, ctx)
	if err != nil {
		return filterDecision{}, err
	}
	return filterDecision{
		Matched:         matched,
		Reason:          map[bool]string{true: "matched", false: "advanced_filter_not_matched"}[matched],
		ActionMatched:   true,
		AdvancedEnabled: true,
		AdvancedMatched: &matched,
		Details:         details,
	}, nil
}

func (m *Manager) logFilterSkip(ctx *InterceptorContext, config *InterceptorConfig, phase Phase, decision filterDecision) {
	if m.diagnosticLogWriter == nil || !config.SkipConfig.LogSkipped {
		return
	}

	start := time.Now()
	input := map[string]interface{}{
		"skip_reason":             decision.Reason,
		"action_filter_matched":   decision.ActionMatched,
		"advanced_filter_enabled": decision.AdvancedEnabled,
		"filter":                  config.Filter,
	}
	if decision.AdvancedMatched != nil {
		input["advanced_filter_matched"] = *decision.AdvancedMatched
	}
	if len(decision.Details) > 0 {
		input["advanced_filter_details"] = decision.Details
	}
	if ctx != nil && ctx.Action != nil {
		input["action"] = ctx.Action
	}

	logEntry := &models.InterceptorLog{
		InterceptorID:   config.ID,
		InterceptorName: config.Name,
		Phase:           string(phase),
		Success:         true,
		Duration:        time.Since(start).Milliseconds(),
		DecisionMade:    string(DecisionContinue),
		InputData:       marshalDiagnosticInput(input),
		CreatedAt:       time.Now(),
	}
	if ctx != nil {
		if ctx.Action != nil {
			logEntry.ActionID = ctx.Action.ID
			logEntry.ActionPluginID = ctx.Action.PluginID
		}
		if ctx.TriggerID > 0 {
			triggerID := ctx.TriggerID
			logEntry.TriggerID = &triggerID
		}
		if ctx.Email != nil && ctx.Email.ID > 0 {
			emailID := ctx.Email.ID
			logEntry.EmailID = &emailID
		}
	}

	if err := m.diagnosticLogWriter(logEntry); err != nil {
		log.Printf("[InterceptorManager] Failed to save filter skip log for interceptor %s: %v", config.Name, err)
	}
}

func marshalDiagnosticInput(input map[string]interface{}) string {
	bytes, err := json.Marshal(input)
	if err != nil {
		return fmt.Sprintf(`{"marshal_error":%q}`, err.Error())
	}
	if len(bytes) > 20000 {
		return string(bytes[:20000]) + "...[truncated]"
	}
	return string(bytes)
}

// handleError 处理拦截器执行错误
func (m *Manager) handleError(config *InterceptorConfig, phase Phase, err error) *InterceptorResult {
	var policy models.ErrorHandlingPolicy
	if phase == PhaseBefore {
		policy = config.ErrorHandling.BeforeErrorPolicy
	} else {
		policy = config.ErrorHandling.AfterErrorPolicy
	}

	switch policy {
	case models.ErrorPolicyAbort:
		return &InterceptorResult{
			Decision: DecisionAbort,
			Success:  false,
			Error:    err.Error(),
		}
	case models.ErrorPolicySkipAction:
		return &InterceptorResult{
			Decision: DecisionSkipAction,
			Success:  false,
			Error:    err.Error(),
		}
	case models.ErrorPolicyContinue:
		fallthrough
	default:
		return &InterceptorResult{
			Decision: DecisionContinue,
			Success:  false,
			Error:    err.Error(),
		}
	}
}

// GetRegistry 获取注册表（用于外部访问）
func (m *Manager) GetRegistry() *Registry {
	return m.registry
}
