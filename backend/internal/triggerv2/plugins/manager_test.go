package plugins

import (
	"context"
	"fmt"
	"testing"
	"time"

	"mailman/internal/triggerv2/models"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 测试用模拟插件

// TestConditionPlugin 测试条件插件
type TestConditionPlugin struct {
	info   *PluginInfo
	config map[string]interface{}
}

func NewTestConditionPlugin() ConditionPlugin {
	return &TestConditionPlugin{
		info: &PluginInfo{
			ID:          "email_filter",
			Name:        "邮件过滤器",
			Version:     "1.0.0",
			Description: "测试邮件过滤插件",
			Type:        PluginTypeCondition,
			Status:      PluginStatusLoaded,
			LoadedAt:    time.Now(),
			Permissions: []string{PermissionRead},
		},
		config: make(map[string]interface{}),
	}
}

func (p *TestConditionPlugin) GetInfo() *PluginInfo                { return p.info }
func (p *TestConditionPlugin) Initialize(ctx *PluginContext) error { return nil }
func (p *TestConditionPlugin) Cleanup() error                      { return nil }
func (p *TestConditionPlugin) OnLoad() error                       { return nil }
func (p *TestConditionPlugin) OnUnload() error                     { return nil }
func (p *TestConditionPlugin) OnActivate() error {
	p.info.Status = PluginStatusActive
	return nil
}
func (p *TestConditionPlugin) OnDeactivate() error {
	p.info.Status = PluginStatusInactive
	return nil
}
func (p *TestConditionPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{
		"keywords":       []string{},
		"case_sensitive": false,
	}
}
func (p *TestConditionPlugin) ValidateConfig(config map[string]interface{}) error {
	// 简单验证
	if keywords, ok := config["keywords"]; ok {
		if _, ok := keywords.([]interface{}); !ok {
			return fmt.Errorf("关键词必须是数组")
		}
	}
	return nil
}
func (p *TestConditionPlugin) ApplyConfig(config map[string]interface{}) error {
	p.config = config
	return nil
}
func (p *TestConditionPlugin) HealthCheck() error { return nil }
func (p *TestConditionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"status": p.info.Status,
	}
}

func (p *TestConditionPlugin) Evaluate(ctx *PluginContext, event *models.Event) (*PluginResult, error) {
	return &PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"matched": true,
			"reason":  "测试匹配",
		},
		ExecutionTime: time.Millisecond,
		Timestamp:     time.Now(),
	}, nil
}

func (p *TestConditionPlugin) GetDescription() string { return p.info.Description }
func (p *TestConditionPlugin) GetSupportedEventTypes() []string {
	return []string{string(models.EventTypeEmailReceived)}
}
func (p *TestConditionPlugin) GetRequiredFields() []string { return []string{"subject"} }

// TestActionPlugin 测试动作插件
type TestActionPlugin struct {
	info   *PluginInfo
	config map[string]interface{}
}

func NewTestActionPlugin() ActionPlugin {
	return &TestActionPlugin{
		info: &PluginInfo{
			ID:          "notification_action",
			Name:        "通知动作",
			Version:     "1.0.0",
			Description: "测试通知动作插件",
			Type:        PluginTypeAction,
			Status:      PluginStatusLoaded,
			LoadedAt:    time.Now(),
			Permissions: []string{PermissionWrite},
		},
		config: make(map[string]interface{}),
	}
}

func (p *TestActionPlugin) GetInfo() *PluginInfo                { return p.info }
func (p *TestActionPlugin) Initialize(ctx *PluginContext) error { return nil }
func (p *TestActionPlugin) Cleanup() error                      { return nil }
func (p *TestActionPlugin) OnLoad() error                       { return nil }
func (p *TestActionPlugin) OnUnload() error                     { return nil }
func (p *TestActionPlugin) OnActivate() error {
	p.info.Status = PluginStatusActive
	return nil
}
func (p *TestActionPlugin) OnDeactivate() error {
	p.info.Status = PluginStatusInactive
	return nil
}
func (p *TestActionPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{
		"title":   "邮件通知",
		"message": "新的重要邮件",
	}
}
func (p *TestActionPlugin) ValidateConfig(config map[string]interface{}) error { return nil }
func (p *TestActionPlugin) ApplyConfig(config map[string]interface{}) error {
	p.config = config
	return nil
}
func (p *TestActionPlugin) HealthCheck() error { return nil }
func (p *TestActionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"status": p.info.Status,
	}
}

func (p *TestActionPlugin) Execute(ctx *PluginContext, event *models.Event) (*PluginResult, error) {
	return &PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"title":   "邮件通知",
			"message": "新的重要邮件",
		},
		ExecutionTime: time.Millisecond,
		Timestamp:     time.Now(),
	}, nil
}

func (p *TestActionPlugin) GetDescription() string { return p.info.Description }
func (p *TestActionPlugin) GetSupportedEventTypes() []string {
	return []string{string(models.EventTypeEmailReceived)}
}
func (p *TestActionPlugin) GetRequiredConfig() []string { return []string{"subject"} }

func (p *TestActionPlugin) CanExecute(ctx *PluginContext, event *models.Event) bool {
	return true
}

func (p *TestActionPlugin) GetExecutionOrder() int {
	return 0
}

// TestUnsupportedPlugin 不支持的插件类型
type TestUnsupportedPlugin struct{}

func (p *TestUnsupportedPlugin) GetInfo() *PluginInfo {
	return &PluginInfo{
		ID:   "unsupported",
		Type: PluginType("unsupported"),
	}
}
func (p *TestUnsupportedPlugin) Initialize(ctx *PluginContext) error                { return nil }
func (p *TestUnsupportedPlugin) Cleanup() error                                     { return nil }
func (p *TestUnsupportedPlugin) OnLoad() error                                      { return nil }
func (p *TestUnsupportedPlugin) OnUnload() error                                    { return nil }
func (p *TestUnsupportedPlugin) OnActivate() error                                  { return nil }
func (p *TestUnsupportedPlugin) OnDeactivate() error                                { return nil }
func (p *TestUnsupportedPlugin) GetDefaultConfig() map[string]interface{}           { return nil }
func (p *TestUnsupportedPlugin) ValidateConfig(config map[string]interface{}) error { return nil }
func (p *TestUnsupportedPlugin) ApplyConfig(config map[string]interface{}) error    { return nil }
func (p *TestUnsupportedPlugin) HealthCheck() error                                 { return nil }
func (p *TestUnsupportedPlugin) GetMetrics() map[string]interface{}                 { return nil }

// TestNewTriggerV2PluginManager 测试创建插件管理器
func TestNewTriggerV2PluginManager(t *testing.T) {
	tests := []struct {
		name   string
		config *PluginManagerConfig
		want   *PluginManagerConfig
	}{
		{
			name:   "使用默认配置",
			config: nil,
			want:   DefaultPluginManagerConfig(),
		},
		{
			name: "使用自定义配置",
			config: &PluginManagerConfig{
				MaxPlugins:         50,
				DefaultTimeout:     15 * time.Second,
				MaxExecutionTime:   30 * time.Second,
				CleanupInterval:    10 * time.Minute,
				StatsInterval:      2 * time.Minute,
				DefaultMaxMemory:   200 * 1024 * 1024,
				DefaultMaxCPU:      60,
				DefaultMaxDuration: 20 * time.Second,
				EnableSandbox:      false,
				EnableMetrics:      true,
				EnableTracing:      false,
				EnableLogging:      true,
			},
			want: &PluginManagerConfig{
				MaxPlugins:         50,
				DefaultTimeout:     15 * time.Second,
				MaxExecutionTime:   30 * time.Second,
				CleanupInterval:    10 * time.Minute,
				StatsInterval:      2 * time.Minute,
				DefaultMaxMemory:   200 * 1024 * 1024,
				DefaultMaxCPU:      60,
				DefaultMaxDuration: 20 * time.Second,
				EnableSandbox:      false,
				EnableMetrics:      true,
				EnableTracing:      false,
				EnableLogging:      true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			manager := NewTriggerV2PluginManager(tt.config)
			assert.NotNil(t, manager)

			// 验证默认配置
			pluginManager := manager.(*TriggerV2PluginManager)
			if tt.config == nil {
				assert.Equal(t, tt.want.MaxPlugins, pluginManager.config.MaxPlugins)
				assert.Equal(t, tt.want.DefaultTimeout, pluginManager.config.DefaultTimeout)
			} else {
				assert.Equal(t, tt.want.MaxPlugins, pluginManager.config.MaxPlugins)
				assert.Equal(t, tt.want.DefaultTimeout, pluginManager.config.DefaultTimeout)
			}
		})
	}
}

// TestPluginRegistration 测试插件注册
func TestPluginRegistration(t *testing.T) {
	manager := NewTriggerV2PluginManager(nil)

	// 创建测试插件
	plugin := NewTestConditionPlugin()

	// 测试注册插件
	err := manager.RegisterPlugin(plugin)
	assert.NoError(t, err)

	// 验证插件存在
	retrievedPlugin, err := manager.GetPlugin("email_filter")
	assert.NoError(t, err)
	assert.Equal(t, plugin, retrievedPlugin)

	// 测试重复注册
	err = manager.RegisterPlugin(plugin)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "已经注册")

	// 测试注册空插件
	err = manager.RegisterPlugin(nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "插件不能为空")
}

// TestPluginUnregistration 测试插件注销
func TestPluginUnregistration(t *testing.T) {
	manager := NewTriggerV2PluginManager(nil)

	// 注册插件
	plugin := NewTestConditionPlugin()
	err := manager.RegisterPlugin(plugin)
	require.NoError(t, err)

	// 测试注销插件
	err = manager.UnregisterPlugin("email_filter")
	assert.NoError(t, err)

	// 验证插件不存在
	_, err = manager.GetPlugin("email_filter")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "不存在")

	// 测试注销不存在的插件
	err = manager.UnregisterPlugin("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "不存在")
}

// TestExecuteCondition 测试执行条件插件
func TestExecuteCondition(t *testing.T) {
	manager := NewTriggerV2PluginManager(nil)

	// 注册条件插件
	plugin := NewTestConditionPlugin()
	err := manager.RegisterPlugin(plugin)
	require.NoError(t, err)

	// 激活插件
	err = manager.ActivatePlugin("email_filter")
	require.NoError(t, err)

	// 创建测试事件
	emailData := models.EmailEventData{
		EmailID:    1,
		AccountID:  1,
		Subject:    "Test Subject",
		From:       "test@example.com",
		To:         "recipient@example.com",
		IsRead:     false,
		ReceivedAt: time.Now(),
	}

	event, err := models.NewEvent(models.EventTypeEmailReceived, "test", "Test Email", emailData)
	require.NoError(t, err)

	// 创建插件上下文
	ctx := &PluginContext{
		Context:   context.Background(),
		PluginID:  "email_filter",
		Event:     event,
		TriggerID: 1,
	}

	// 测试执行条件
	result, err := manager.ExecuteCondition("email_filter", ctx, event)
	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.True(t, result.Success)

	// 验证结果数据
	matched, ok := result.Data["matched"].(bool)
	assert.True(t, ok)
	assert.True(t, matched)

	// 测试执行不存在的插件
	_, err = manager.ExecuteCondition("nonexistent", ctx, event)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "不存在")
}
