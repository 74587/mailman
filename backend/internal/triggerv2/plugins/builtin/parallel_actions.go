package builtin

import (
	"context"
	"fmt"
	"sync"
	"time"

	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// ParallelAction 并行动作配置
type ParallelAction struct {
	PluginID string                 `json:"plugin_id"`
	Config   map[string]interface{} `json:"config"`
	Enabled  bool                   `json:"enabled"`
	Name     string                 `json:"name"` // 可选的动作名称
}

// ParallelActionsPlugin 并行组合动作插件
// 并行执行多个动作，无返回值处理
type ParallelActionsPlugin struct {
	info          *plugins.PluginInfo
	config        map[string]interface{}
	pluginManager plugins.PluginManager
}

// NewParallelActionsPlugin 创建并行组合动作插件
func NewParallelActionsPlugin() plugins.ActionPlugin {
	return &ParallelActionsPlugin{
		info: &plugins.PluginInfo{
			ID:          "parallel_actions",
			Name:        "并行动作",
			Version:     "1.0.0",
			Description: "并行执行多个动作，提高执行效率",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"actions": map[string]interface{}{
						"type":        "array",
						"description": "并行执行的动作列表",
					},
					"timeout_seconds": map[string]interface{}{
						"type":        "integer",
						"description": "超时时间（秒）",
						"default":     30,
					},
					"fail_fast": map[string]interface{}{
						"type":        "boolean",
						"description": "任一动作失败时立即停止",
						"default":     false,
					},
					"ignore_errors": map[string]interface{}{
						"type":        "boolean",
						"description": "忽略动作执行错误",
						"default":     true,
					},
				},
				"required": []string{"actions"},
			},
			DefaultConfig: map[string]interface{}{
				"actions":         []ParallelAction{},
				"timeout_seconds": 30,
				"fail_fast":       false,
				"ignore_errors":   true,
			},
		},
		config: make(map[string]interface{}),
	}
}

// GetInfo 获取插件信息
func (p *ParallelActionsPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize 初始化插件
func (p *ParallelActionsPlugin) Initialize(ctx *plugins.PluginContext) error {
	return nil
}

// Cleanup 清理插件
func (p *ParallelActionsPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时触发
func (p *ParallelActionsPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时触发
func (p *ParallelActionsPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时触发
func (p *ParallelActionsPlugin) OnActivate() error {
	return nil
}

// OnDeactivate 停用时触发
func (p *ParallelActionsPlugin) OnDeactivate() error {
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *ParallelActionsPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{
		"actions":         []ParallelAction{},
		"timeout_seconds": 30,
		"fail_fast":       false,
		"ignore_errors":   true,
	}
}

// ValidateConfig 验证配置
func (p *ParallelActionsPlugin) ValidateConfig(config map[string]interface{}) error {
	actionsRaw, ok := config["actions"]
	if !ok {
		return fmt.Errorf("actions 为必填项")
	}

	actionsSlice, ok := actionsRaw.([]interface{})
	if !ok {
		return fmt.Errorf("actions 必须是数组")
	}

	if len(actionsSlice) == 0 {
		return fmt.Errorf("至少需要一个并行动作")
	}

	return nil
}

// ApplyConfig 应用配置
func (p *ParallelActionsPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}
	p.config = config
	return nil
}

// HealthCheck 健康检查
func (p *ParallelActionsPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *ParallelActionsPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"avg_execution_time": p.info.AvgExecutionTime,
		"usage_count":        p.info.UsageCount,
		"error_rate":         p.info.ErrorRate,
	}
}

// GetDescription 获取描述
func (p *ParallelActionsPlugin) GetDescription() string {
	return "并行执行多个动作以提高效率。所有动作同时开始执行，互不影响。适用于需要同时发送多个通知、执行多个独立操作等场景。"
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *ParallelActionsPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(triggerModels.EventTypeEmailReceived),
		string(triggerModels.EventTypeEmailUpdated),
	}
}

// GetRequiredConfig 获取必需的配置
func (p *ParallelActionsPlugin) GetRequiredConfig() []string {
	return []string{"actions"}
}

// CanExecute 检查是否可以执行
func (p *ParallelActionsPlugin) CanExecute(ctx *plugins.PluginContext, event *triggerModels.Event) bool {
	if event.Type != triggerModels.EventTypeEmailReceived && event.Type != triggerModels.EventTypeEmailUpdated {
		return false
	}
	return true
}

// GetExecutionOrder 获取执行顺序
func (p *ParallelActionsPlugin) GetExecutionOrder() int {
	return 100 // 中等优先级
}

// SetPluginManager 设置插件管理器
func (p *ParallelActionsPlugin) SetPluginManager(pm plugins.PluginManager) {
	p.pluginManager = pm
}

// ActionResult 动作执行结果
type ActionResult struct {
	Index    int                    `json:"index"`
	Name     string                 `json:"name"`
	PluginID string                 `json:"plugin_id"`
	Success  bool                   `json:"success"`
	Error    string                 `json:"error,omitempty"`
	Duration time.Duration          `json:"duration"`
	Data     map[string]interface{} `json:"data,omitempty"`
}

// Execute 执行动作
func (p *ParallelActionsPlugin) Execute(ctx *plugins.PluginContext, event *triggerModels.Event) (*plugins.PluginResult, error) {
	startTime := time.Now()

	// 更新使用统计
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	// 获取邮件对象（用于验证）
	var emailEventData triggerModels.EmailEventData
	if err := event.GetData(&emailEventData); err != nil || emailEventData.Email == nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         "无法获取邮件数据",
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 解析配置
	actions, err := p.parseActions(p.config)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("解析动作配置失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 获取配置选项
	timeoutSeconds := 30
	if v, ok := p.config["timeout_seconds"].(float64); ok {
		timeoutSeconds = int(v)
	} else if v, ok := p.config["timeout_seconds"].(int); ok {
		timeoutSeconds = v
	}

	failFast := false
	if v, ok := p.config["fail_fast"].(bool); ok {
		failFast = v
	}

	ignoreErrors := true
	if v, ok := p.config["ignore_errors"].(bool); ok {
		ignoreErrors = v
	}

	// 创建超时上下文
	execCtx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSeconds)*time.Second)
	defer cancel()

	// 并行执行动作
	results := make([]ActionResult, len(actions))
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstError error
	stopped := false

	for i, action := range actions {
		if !action.Enabled {
			results[i] = ActionResult{
				Index:    i,
				Name:     action.Name,
				PluginID: action.PluginID,
				Success:  true,
				Duration: 0,
				Data:     map[string]interface{}{"skipped": true, "reason": "disabled"},
			}
			continue
		}

		wg.Add(1)
		go func(index int, act ParallelAction) {
			defer wg.Done()

			// 检查是否已停止
			mu.Lock()
			if stopped {
				mu.Unlock()
				return
			}
			mu.Unlock()

			actionStart := time.Now()
			result := ActionResult{
				Index:    index,
				Name:     act.Name,
				PluginID: act.PluginID,
			}

			// 检查上下文是否已取消
			select {
			case <-execCtx.Done():
				result.Success = false
				result.Error = "执行超时"
				result.Duration = time.Since(actionStart)
				mu.Lock()
				results[index] = result
				mu.Unlock()
				return
			default:
			}

			// 执行动作
			actionResult, err := p.executeAction(act, event, ctx)
			result.Duration = time.Since(actionStart)

			if err != nil {
				result.Success = false
				result.Error = err.Error()

				if failFast && firstError == nil {
					mu.Lock()
					if !stopped {
						stopped = true
						firstError = err
					}
					mu.Unlock()
				}
			} else if actionResult != nil {
				result.Success = actionResult.Success
				if !actionResult.Success {
					result.Error = actionResult.Error
				}
				result.Data = actionResult.Data
			} else {
				result.Success = true
			}

			mu.Lock()
			results[index] = result
			mu.Unlock()
		}(i, action)
	}

	// 等待所有动作完成
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// 所有动作完成
	case <-execCtx.Done():
		// 超时
	}

	// 计算执行时间
	duration := time.Since(startTime)
	p.info.AvgExecutionTime = (p.info.AvgExecutionTime + duration) / 2

	// 统计结果
	successCount := 0
	failureCount := 0
	for _, r := range results {
		if r.Success {
			successCount++
		} else {
			failureCount++
		}
	}

	// 构建返回结果
	overallSuccess := true
	var overallError string
	if !ignoreErrors && failureCount > 0 {
		overallSuccess = false
		overallError = fmt.Sprintf("%d 个动作执行失败", failureCount)
	}

	return &plugins.PluginResult{
		Success:       overallSuccess,
		Error:         overallError,
		ExecutionTime: duration,
		Timestamp:     time.Now(),
		Data: map[string]interface{}{
			"total_actions":   len(actions),
			"success_count":   successCount,
			"failure_count":   failureCount,
			"action_results":  results,
			"timeout_seconds": timeoutSeconds,
		},
	}, nil
}

// parseActions 解析动作配置
func (p *ParallelActionsPlugin) parseActions(config map[string]interface{}) ([]ParallelAction, error) {
	actionsRaw, ok := config["actions"]
	if !ok {
		return []ParallelAction{}, nil
	}

	actionsSlice, ok := actionsRaw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("actions 必须是数组")
	}

	actions := make([]ParallelAction, 0, len(actionsSlice))
	for i, actionRaw := range actionsSlice {
		actionMap, ok := actionRaw.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("动作 %d: 格式无效", i+1)
		}

		pluginID := getStringValue(actionMap, "plugin_id", "")
		if pluginID == "" {
			pluginID = getStringValue(actionMap, "pluginId", "")
		}

		action := ParallelAction{
			PluginID: pluginID,
			Name:     getStringValue(actionMap, "name", fmt.Sprintf("动作 %d", i+1)),
			Enabled:  true,
		}

		if config, ok := actionMap["config"].(map[string]interface{}); ok {
			action.Config = config
		}

		if enabled, ok := actionMap["enabled"].(bool); ok {
			action.Enabled = enabled
		}

		if action.PluginID == "" {
			return nil, fmt.Errorf("动作 %d: plugin_id 不能为空", i+1)
		}

		actions = append(actions, action)
	}

	return actions, nil
}

// executeAction 执行单个动作
func (p *ParallelActionsPlugin) executeAction(action ParallelAction, event *triggerModels.Event, ctx *plugins.PluginContext) (*plugins.PluginResult, error) {
	if p.pluginManager == nil {
		return nil, fmt.Errorf("插件管理器未设置")
	}

	childCtx := childPluginContext(ctx, action.PluginID, action.Config)
	result, err := p.pluginManager.ExecuteAction(action.PluginID, childCtx, event)
	if err != nil {
		return nil, fmt.Errorf("执行插件 %s 失败: %v", action.PluginID, err)
	}

	return result, nil
}

// GetUISchema 获取UI架构
func (p *ParallelActionsPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "actions",
				Label:       "并行动作列表",
				Type:        plugins.UIFieldTypeArray,
				Description: "配置要并行执行的动作",
				Required:    true,
				Width:       "full",
				ItemSchema: &plugins.UISchema{
					Fields: []plugins.UIField{
						{
							Name:        "name",
							Label:       "动作名称",
							Type:        plugins.UIFieldTypeText,
							Description: "为动作命名以便识别",
							Required:    false,
							Width:       "1/2",
							Placeholder: "例如: 发送Telegram通知",
						},
						{
							Name:        "plugin_id",
							Label:       "动作类型",
							Type:        plugins.UIFieldTypeSelect,
							Description: "选择要执行的动作类型",
							Required:    true,
							Width:       "1/2",
							Options: []plugins.UIOption{
								{Value: "telegram_bot_action", Label: "Telegram通知"},
								{Value: "webhook_action", Label: "Webhook调用"},
								{Value: "email_forward_action", Label: "转发邮件"},
								{Value: "notification_action", Label: "系统通知"},
								{Value: "email_transform_action_v2", Label: "数据转换"},
								{Value: "variable_extract_action", Label: "变量提取"},
							},
						},
						{
							Name:        "config",
							Label:       "动作配置",
							Type:        plugins.UIFieldTypeJSON,
							Description: "动作的详细配置",
							Required:    true,
							Width:       "full",
						},
						{
							Name:         "enabled",
							Label:        "启用",
							Type:         plugins.UIFieldTypeBoolean,
							Description:  "是否启用此动作",
							Required:     false,
							Width:        "1/4",
							DefaultValue: true,
						},
					},
				},
			},
			{
				Name:         "timeout_seconds",
				Label:        "超时时间（秒）",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "所有动作必须在此时间内完成",
				Required:     false,
				Width:        "1/3",
				DefaultValue: 30,
			},
			{
				Name:         "fail_fast",
				Label:        "快速失败",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "开启后，任一动作失败时立即停止其他动作",
				Required:     false,
				Width:        "1/3",
				DefaultValue: false,
			},
			{
				Name:         "ignore_errors",
				Label:        "忽略错误",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "开启后，即使部分动作失败也返回成功",
				Required:     false,
				Width:        "1/3",
				DefaultValue: true,
			},
		},
		Layout: "vertical",
	}
}

// GetFieldSuggestions 获取字段建议
func (p *ParallelActionsPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	return nil, nil
}

// ValidateFieldValue 验证字段值
func (p *ParallelActionsPlugin) ValidateFieldValue(field string, value interface{}) error {
	return nil
}

// GetDynamicOptions 获取动态选项
func (p *ParallelActionsPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	return nil, nil
}
