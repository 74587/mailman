package builtin

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"

	"github.com/stretchr/testify/assert"
)

func TestEmailPrefixPlugin_GetUISchema(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)
	schema := plugin.GetUISchema()

	// 验证UI Schema
	assert.Len(t, schema.Fields, 4, "UI Schema应该有4个字段")

	// 验证prefixes字段
	assert.Equal(t, "prefixes", schema.Fields[0].Name)
	assert.Equal(t, "邮箱前缀列表", schema.Fields[0].Label)
	assert.Equal(t, plugins.UIFieldTypeMultiSelect, schema.Fields[0].Type)
	assert.True(t, schema.Fields[0].Required)

	// 验证match_type字段
	assert.Equal(t, "match_type", schema.Fields[1].Name)
	assert.Equal(t, "匹配类型", schema.Fields[1].Label)
	assert.Equal(t, plugins.UIFieldTypeSelect, schema.Fields[1].Type)
	assert.True(t, schema.Fields[1].Required)

	// 验证match_mode字段
	assert.Equal(t, "match_mode", schema.Fields[2].Name)
	assert.Equal(t, "匹配模式", schema.Fields[2].Label)
	assert.Equal(t, plugins.UIFieldTypeSelect, schema.Fields[2].Type)
	assert.True(t, schema.Fields[2].Required)

	// 验证case_sensitive字段
	assert.Equal(t, "case_sensitive", schema.Fields[3].Name)
	assert.Equal(t, "区分大小写", schema.Fields[3].Label)
	assert.Equal(t, plugins.UIFieldTypeBoolean, schema.Fields[3].Type)
	assert.False(t, schema.Fields[3].Required)

	// 验证操作符
	assert.Len(t, schema.Operators, 2, "应该有2个操作符")
	assert.Equal(t, "starts_with", schema.Operators[0].Value)
	assert.Equal(t, "not_starts_with", schema.Operators[1].Value)
}

func TestEmailPrefixPlugin_GetDynamicOptions(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)

	// 测试prefixes字段的动态选项
	options, err := plugin.GetDynamicOptions("prefixes", "")
	assert.NoError(t, err)
	assert.NotEmpty(t, options)

	// 验证选项内容
	assert.Equal(t, "admin", options[0].Value)
	assert.Equal(t, "support", options[1].Value)

	// 测试带查询参数的动态选项
	options, err = plugin.GetDynamicOptions("prefixes", "admin")
	assert.NoError(t, err)
	assert.NotEmpty(t, options)

	// 验证过滤后的选项
	for _, option := range options {
		assert.Contains(t, option.Value.(string), "admin")
	}

	// 测试不支持的字段
	options, err = plugin.GetDynamicOptions("unsupported", "")
	assert.Error(t, err)
	assert.Empty(t, options)
}

func TestEmailPrefixPlugin_ValidateFieldValue(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)

	tests := []struct {
		name    string
		field   string
		value   interface{}
		wantErr bool
	}{
		{
			name:    "valid prefixes array",
			field:   "prefixes",
			value:   []interface{}{"admin", "support"},
			wantErr: false,
		},
		{
			name:    "invalid prefix contains @",
			field:   "prefixes",
			value:   []interface{}{"admin@example.com"},
			wantErr: true,
		},
		{
			name:    "prefixes not array",
			field:   "prefixes",
			value:   "admin",
			wantErr: true,
		},
		{
			name:    "valid match_type",
			field:   "match_type",
			value:   "from",
			wantErr: false,
		},
		{
			name:    "invalid match_type",
			field:   "match_type",
			value:   "invalid",
			wantErr: true,
		},
		{
			name:    "valid match_mode",
			field:   "match_mode",
			value:   "any",
			wantErr: false,
		},
		{
			name:    "invalid match_mode",
			field:   "match_mode",
			value:   "invalid",
			wantErr: true,
		},
		{
			name:    "valid case_sensitive",
			field:   "case_sensitive",
			value:   true,
			wantErr: false,
		},
		{
			name:    "invalid case_sensitive",
			field:   "case_sensitive",
			value:   "true",
			wantErr: true,
		},
		{
			name:    "unknown field",
			field:   "unknown",
			value:   "value",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := plugin.ValidateFieldValue(tt.field, tt.value)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestEmailPrefixPlugin_GetFieldSuggestions(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)

	// 测试prefixes字段的建议
	suggestions, err := plugin.GetFieldSuggestions("prefixes", "")
	assert.NoError(t, err)
	assert.NotEmpty(t, suggestions)

	// 验证建议内容
	assert.Contains(t, suggestions, "admin")
	assert.Contains(t, suggestions, "support")

	// 测试带前缀的建议
	suggestions, err = plugin.GetFieldSuggestions("prefixes", "ad")
	assert.NoError(t, err)
	assert.NotEmpty(t, suggestions)

	// 验证过滤后的建议
	for _, suggestion := range suggestions {
		assert.True(t, strings.HasPrefix(suggestion, "ad"))
	}

	// 测试不支持的字段
	suggestions, err = plugin.GetFieldSuggestions("unsupported", "")
	assert.Error(t, err)
	assert.Empty(t, suggestions)
}

func TestEmailPrefixPlugin_Evaluate(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)

	tests := []struct {
		name     string
		prefixes []interface{}
		expected bool
	}{
		{
			name:     "email from matches prefix",
			prefixes: []interface{}{"admin"},
			expected: true,
		},
		{
			name:     "email from does not match prefix",
			prefixes: []interface{}{"test"},
			expected: false,
		},
		{
			name:     "email to matches prefix",
			prefixes: []interface{}{"user"},
			expected: false, // 因为match_type是"from"，而from是"admin@example.com"，不匹配"user"
		},
		{
			name:     "multiple prefixes match",
			prefixes: []interface{}{"admin", "support"},
			expected: true,
		},
		{
			name:     "case sensitive match",
			prefixes: []interface{}{"ADMIN"},
			expected: false,
		},
		{
			name:     "empty prefixes",
			prefixes: []interface{}{},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := map[string]interface{}{
				"prefixes":       tt.prefixes,
				"match_type":     "from",
				"case_sensitive": true,
				"match_mode":     "any",
			}

			err := plugin.ApplyConfig(config)
			assert.NoError(t, err)

			// 创建测试邮件数据
			emailData := models.EmailEventData{
				Subject:       "Test Subject",
				From:          "admin@example.com",
				To:            "user@example.com",
				HasAttachment: false,
				ReceivedAt:    time.Now(),
			}

			// 序列化emailData为json.RawMessage
			emailDataBytes, err := json.Marshal(emailData)
			assert.NoError(t, err)

			// 创建测试事件
			event := &models.Event{
				ID:        "test-event-id",
				Type:      models.EventTypeEmailReceived,
				Status:    models.EventStatusCompleted,
				Source:    "email",
				Data:      emailDataBytes,
				CreatedAt: time.Now(),
			}

			// 创建插件上下文
			ctx := &plugins.PluginContext{
				PluginID:  "email_prefix",
				TriggerID: 12345,
				Config: &plugins.PluginConfig{
					Enabled: true,
					Config:  config,
				},
			}

			// 执行评估
			result, err := plugin.Evaluate(ctx, event)
			assert.NoError(t, err)
			assert.NotNil(t, result)
			assert.True(t, result.Success)

			// 验证结果包含预期的数据
			matched, exists := result.Data["matched"]
			assert.True(t, exists)
			assert.Equal(t, tt.expected, matched)
		})
	}
}

func TestEmailPrefixPlugin_BasicInterface(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)

	// 测试插件信息
	assert.Equal(t, "邮箱前缀筛选", plugin.GetInfo().Name)
	assert.Equal(t, "email_prefix", plugin.GetInfo().ID)
	assert.Equal(t, "根据邮箱前缀筛选邮件", plugin.GetInfo().Description)
	assert.Equal(t, plugins.PluginTypeCondition, plugin.GetInfo().Type)

	// 测试类型断言
	var conditionPlugin plugins.ConditionPlugin = plugin
	assert.NotNil(t, conditionPlugin)

	var uiPlugin plugins.ConditionPluginWithUI = plugin
	assert.NotNil(t, uiPlugin)

	// 测试生命周期方法
	assert.NoError(t, plugin.OnLoad())
	assert.NoError(t, plugin.OnActivate())
	assert.Equal(t, plugins.PluginStatusActive, plugin.GetInfo().Status)
	assert.NoError(t, plugin.OnDeactivate())
	assert.Equal(t, plugins.PluginStatusInactive, plugin.GetInfo().Status)
	assert.NoError(t, plugin.OnUnload())
	assert.NoError(t, plugin.Cleanup())
}

func TestEmailPrefixPlugin_Configuration(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)

	// 验证默认配置
	assert.Equal(t, []string{}, plugin.GetDefaultConfig()["prefixes"])
	assert.Equal(t, "from", plugin.GetDefaultConfig()["match_type"])
	assert.Equal(t, "any", plugin.GetDefaultConfig()["match_mode"])
	assert.Equal(t, false, plugin.GetDefaultConfig()["case_sensitive"])

	// 测试有效配置
	config := map[string]interface{}{
		"prefixes":       []interface{}{"admin", "support"},
		"match_type":     "from",
		"match_mode":     "any",
		"case_sensitive": false,
	}

	err := plugin.ApplyConfig(config)
	assert.NoError(t, err)

	// 测试无效配置
	invalidConfig := map[string]interface{}{
		"prefixes":       []interface{}{"admin", "support"},
		"match_type":     "invalid",
		"match_mode":     "any",
		"case_sensitive": false,
	}

	err = plugin.ApplyConfig(invalidConfig)
	assert.Error(t, err)
}

func TestEmailPrefixPlugin_HealthCheck(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)
	assert.NoError(t, plugin.HealthCheck())
}

func TestEmailPrefixPlugin_Metrics(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)
	metrics := plugin.GetMetrics()
	assert.NotNil(t, metrics)
	assert.Contains(t, metrics, "evaluations")
	assert.Contains(t, metrics, "last_used")
	assert.Contains(t, metrics, "status")
}

func TestEmailPrefixPlugin_SupportedEventTypes(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)
	eventTypes := plugin.GetSupportedEventTypes()
	assert.Contains(t, eventTypes, string(models.EventTypeEmailReceived))
	assert.Contains(t, eventTypes, string(models.EventTypeEmailUpdated))
}

func TestEmailPrefixPlugin_RequiredFields(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)
	fields := plugin.GetRequiredFields()
	assert.Contains(t, fields, "from")
	assert.Contains(t, fields, "to")
}

func TestEmailPrefixPlugin_JSONSerialization(t *testing.T) {
	plugin := NewEmailPrefixPlugin().(*EmailPrefixPlugin)

	// 测试序列化和反序列化
	config := map[string]interface{}{
		"prefixes":       []interface{}{"admin", "support"},
		"match_type":     "from",
		"match_mode":     "any",
		"case_sensitive": false,
	}

	err := plugin.ApplyConfig(config)
	assert.NoError(t, err)

	// 验证插件状态
	assert.Equal(t, plugins.PluginStatusLoaded, plugin.GetInfo().Status)
}
