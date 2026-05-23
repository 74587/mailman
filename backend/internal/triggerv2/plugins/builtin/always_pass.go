package builtin

import (
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// AlwaysPassPlugin 始终通过插件 - 不进行任何过滤，恒定返回 true
type AlwaysPassPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewAlwaysPassPlugin 创建始终通过插件
func NewAlwaysPassPlugin() plugins.ConditionPlugin {
	return &AlwaysPassPlugin{
		info: &plugins.PluginInfo{
			ID:          "always_pass",
			Name:        "始终通过",
			Version:     "1.0.0",
			Description: "不进行任何过滤，所有邮件都会通过此条件",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
			DefaultConfig: map[string]interface{}{},
			Dependencies:  []string{},
			Permissions:   []string{plugins.PermissionRead},
			Sandbox:       true,
			MinVersion:    "1.0.0",
			MaxVersion:    "",
		},
		config: make(map[string]interface{}),
	}
}

// GetInfo 获取插件信息
func (p *AlwaysPassPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// GetUISchema 获取UI架构
func (p *AlwaysPassPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields:            []plugins.UIField{}, // 无需配置任何字段
		Operators:         []plugins.UIOperator{},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      false,
		MaxNestingLevel:   0,
		HelpText:          "此条件始终返回通过，适用于需要匹配所有邮件的场景。例如：记录所有邮件日志、无条件转发等。",
		Examples: []plugins.UIExample{
			{
				Title:       "匹配所有邮件",
				Description: "不设置任何过滤条件，所有邮件都会触发后续动作",
				Expression:  map[string]interface{}{},
			},
		},
	}
}

// GetDynamicOptions 获取动态选项
func (p *AlwaysPassPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	return nil, nil
}

// ValidateFieldValue 验证字段值
func (p *AlwaysPassPlugin) ValidateFieldValue(field string, value interface{}) error {
	return nil
}

// GetFieldSuggestions 获取字段建议
func (p *AlwaysPassPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	return nil, nil
}

// Initialize 初始化插件
func (p *AlwaysPassPlugin) Initialize(ctx *plugins.PluginContext) error {
	return nil
}

// Cleanup 清理插件
func (p *AlwaysPassPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *AlwaysPassPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *AlwaysPassPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *AlwaysPassPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *AlwaysPassPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *AlwaysPassPlugin) GetDefaultConfig() map[string]interface{} {
	return p.info.DefaultConfig
}

// ValidateConfig 验证配置
func (p *AlwaysPassPlugin) ValidateConfig(config map[string]interface{}) error {
	return nil // 不需要配置
}

// ApplyConfig 应用配置
func (p *AlwaysPassPlugin) ApplyConfig(config map[string]interface{}) error {
	return nil
}

// HealthCheck 健康检查
func (p *AlwaysPassPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *AlwaysPassPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"evaluations": p.info.UsageCount,
		"last_used":   p.info.LastUsed,
		"status":      p.info.Status,
	}
}

// Evaluate 评估条件 - 始终返回 true
func (p *AlwaysPassPlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	startTime := time.Now()

	// 更新使用统计
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	return &plugins.PluginResult{
		Success: true, // 始终通过
		Data: map[string]interface{}{
			"matched": true,
			"reason":  "始终通过 - 不进行任何过滤",
		},
		ExecutionTime: time.Since(startTime),
		Timestamp:     time.Now(),
	}, nil
}

// GetDescription 获取描述
func (p *AlwaysPassPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *AlwaysPassPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(models.EventTypeEmailReceived),
		string(models.EventTypeEmailUpdated),
	}
}

// GetRequiredFields 获取必需字段
func (p *AlwaysPassPlugin) GetRequiredFields() []string {
	return []string{} // 不需要任何字段
}
