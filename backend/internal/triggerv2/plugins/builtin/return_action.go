package builtin

import (
	"fmt"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// ReturnActionPlugin 中断流程动作插件
// 用于在动作链中提前中断执行，支持提供返回值
type ReturnActionPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewReturnActionPlugin 创建中断流程动作插件
func NewReturnActionPlugin() plugins.ActionPlugin {
	return &ReturnActionPlugin{
		info: &plugins.PluginInfo{
			ID:          "return_action",
			Name:        "中断流程",
			Version:     "1.0.0",
			Description: "中断后续动作的执行，可选择提供返回值",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"return_value": map[string]interface{}{
						"type":        "string",
						"description": "返回值（支持模板表达式）",
						"default":     "",
					},
					"return_type": map[string]interface{}{
						"type":        "string",
						"description": "返回值类型",
						"enum":        []string{"string", "json", "variable"},
						"default":     "string",
					},
					"message": map[string]interface{}{
						"type":        "string",
						"description": "中断原因/消息",
						"default":     "流程已中断",
					},
					"success": map[string]interface{}{
						"type":        "boolean",
						"description": "中断时标记为成功还是失败",
						"default":     true,
					},
				},
				"required": []string{},
			},
			DefaultConfig: map[string]interface{}{
				"return_value": "",
				"return_type":  "string",
				"message":      "流程已中断",
				"success":      true,
			},
			Dependencies: []string{},
			Permissions:  []string{plugins.PermissionRead},
			Sandbox:      true,
			MinVersion:   "1.0.0",
			MaxVersion:   "",
		},
		config: make(map[string]interface{}),
	}
}

// GetInfo 获取插件信息
func (p *ReturnActionPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize 初始化插件
func (p *ReturnActionPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = p.info.DefaultConfig
	return nil
}

// Cleanup 清理插件
func (p *ReturnActionPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *ReturnActionPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *ReturnActionPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *ReturnActionPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *ReturnActionPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *ReturnActionPlugin) GetDefaultConfig() map[string]interface{} {
	return p.info.DefaultConfig
}

// ValidateConfig 验证配置
func (p *ReturnActionPlugin) ValidateConfig(config map[string]interface{}) error {
	// 验证返回值类型
	if returnType, ok := config["return_type"]; ok {
		if typeStr, ok := returnType.(string); ok {
			validTypes := map[string]bool{
				"string":   true,
				"json":     true,
				"variable": true,
			}
			if !validTypes[typeStr] {
				return fmt.Errorf("无效的返回值类型: %s", typeStr)
			}
		}
	}

	return nil
}

// ApplyConfig 应用配置
func (p *ReturnActionPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}

	for key, value := range config {
		p.config[key] = value
	}

	return nil
}

// HealthCheck 健康检查
func (p *ReturnActionPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *ReturnActionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"executions": p.info.UsageCount,
		"last_used":  p.info.LastUsed,
		"status":     p.info.Status,
	}
}

// Execute 执行动作
func (p *ReturnActionPlugin) Execute(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	startTime := time.Now()

	// 更新使用统计
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	// 获取配置
	returnValue := p.getReturnValue()
	returnType := p.getReturnType()
	message := p.getMessage()
	success := p.getSuccess()

	// 处理返回值
	var processedValue interface{}
	switch returnType {
	case "json":
		// 尝试解析 JSON
		processedValue = returnValue
	case "variable":
		// 从变量中获取值
		if event != nil && event.Variables != nil {
			if val, ok := event.Variables[returnValue]; ok {
				processedValue = val
			} else {
				processedValue = returnValue
			}
		} else {
			processedValue = returnValue
		}
	default:
		// 默认作为字符串
		processedValue = returnValue
	}

	result := &plugins.PluginResult{
		Success:      success,
		StopPipeline: true, // 关键：设置中断标志
		Data: map[string]interface{}{
			"return_value": processedValue,
			"return_type":  returnType,
			"message":      message,
			"stopped":      true,
		},
		Error:         "",
		ExecutionTime: time.Since(startTime),
		Timestamp:     time.Now(),
	}

	// 如果标记为失败，设置错误信息
	if !success {
		result.Error = message
	}

	return result, nil
}

// GetDescription 获取描述
func (p *ReturnActionPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *ReturnActionPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(models.EventTypeEmailReceived),
		string(models.EventTypeEmailUpdated),
		string(models.EventTypeTriggerExecuted),
	}
}

// GetRequiredConfig 获取必需配置
func (p *ReturnActionPlugin) GetRequiredConfig() []string {
	return []string{}
}

// CanExecute 检查是否可以执行
func (p *ReturnActionPlugin) CanExecute(ctx *plugins.PluginContext, event *models.Event) bool {
	return true
}

// GetExecutionOrder 获取执行顺序
func (p *ReturnActionPlugin) GetExecutionOrder() int {
	return 0 // 高优先级
}

// 私有方法

// getReturnValue 获取返回值配置
func (p *ReturnActionPlugin) getReturnValue() string {
	if value, ok := p.config["return_value"]; ok {
		if str, ok := value.(string); ok {
			return str
		}
	}
	return ""
}

// getReturnType 获取返回值类型配置
func (p *ReturnActionPlugin) getReturnType() string {
	if returnType, ok := p.config["return_type"]; ok {
		if str, ok := returnType.(string); ok {
			return str
		}
	}
	return "string"
}

// getMessage 获取消息配置
func (p *ReturnActionPlugin) getMessage() string {
	if message, ok := p.config["message"]; ok {
		if str, ok := message.(string); ok {
			return str
		}
	}
	return "流程已中断"
}

// getSuccess 获取成功标志配置
func (p *ReturnActionPlugin) getSuccess() bool {
	if success, ok := p.config["success"]; ok {
		if b, ok := success.(bool); ok {
			return b
		}
	}
	return true
}
