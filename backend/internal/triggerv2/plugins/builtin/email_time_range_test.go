package builtin

import (
	"encoding/json"
	"testing"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"

	"github.com/stretchr/testify/assert"
)

func TestEmailTimeRangePlugin_GetUISchema(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	schema := timeRangePlugin.GetUISchema()

	assert.NotNil(t, schema)
	assert.Len(t, schema.Fields, 8)

	// 验证第一个字段：start_time
	assert.Equal(t, "start_time", schema.Fields[0].Name)
	assert.Equal(t, "开始时间", schema.Fields[0].Label)
	assert.Equal(t, plugins.UIFieldTypeDate, schema.Fields[0].Type)
	assert.False(t, schema.Fields[0].Required)

	// 验证第二个字段：end_time
	assert.Equal(t, "end_time", schema.Fields[1].Name)
	assert.Equal(t, "结束时间", schema.Fields[1].Label)
	assert.Equal(t, plugins.UIFieldTypeDate, schema.Fields[1].Type)
	assert.False(t, schema.Fields[1].Required)

	// 验证第三个字段：time_field
	assert.Equal(t, "time_field", schema.Fields[2].Name)
	assert.Equal(t, "时间字段", schema.Fields[2].Label)
	assert.Equal(t, plugins.UIFieldTypeSelect, schema.Fields[2].Type)
	assert.True(t, schema.Fields[2].Required)
	assert.Len(t, schema.Fields[2].Options, 2)

	// 验证第四个字段：time_zone
	assert.Equal(t, "time_zone", schema.Fields[3].Name)
	assert.Equal(t, "时区", schema.Fields[3].Label)
	assert.Equal(t, plugins.UIFieldTypeSelect, schema.Fields[3].Type)
	assert.True(t, schema.Fields[3].Required)
	assert.Len(t, schema.Fields[3].Options, 4)

	// 验证第五个字段：relative_enabled
	assert.Equal(t, "relative_enabled", schema.Fields[4].Name)
	assert.Equal(t, "启用相对时间", schema.Fields[4].Label)
	assert.Equal(t, plugins.UIFieldTypeBoolean, schema.Fields[4].Type)
	assert.False(t, schema.Fields[4].Required)

	// 验证操作符
	assert.Len(t, schema.Operators, 3)
	assert.Equal(t, "between", schema.Operators[0].Value)
	assert.Equal(t, "before", schema.Operators[1].Value)
	assert.Equal(t, "after", schema.Operators[2].Value)
}

func TestEmailTimeRangePlugin_GetDynamicOptions(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	// 测试 time_zone 字段
	options, err := timeRangePlugin.GetDynamicOptions("time_zone", "")
	assert.NoError(t, err)
	assert.NotEmpty(t, options)
	assert.True(t, len(options) >= 7)

	// 测试带查询的 time_zone 字段
	options, err = timeRangePlugin.GetDynamicOptions("time_zone", "Asia")
	assert.NoError(t, err)
	assert.NotEmpty(t, options)

	// 测试 relative_direction 字段
	options, err = timeRangePlugin.GetDynamicOptions("relative_direction", "")
	assert.NoError(t, err)
	assert.Len(t, options, 2)

	// 测试不支持的字段
	options, err = timeRangePlugin.GetDynamicOptions("invalid_field", "")
	assert.Error(t, err)
	assert.Empty(t, options)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailTimeRangePlugin_ValidateFieldValue(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	tests := []struct {
		name      string
		field     string
		value     interface{}
		expectErr bool
	}{
		{
			name:      "valid start_time",
			field:     "start_time",
			value:     "2024-01-01T00:00:00Z",
			expectErr: false,
		},
		{
			name:      "nil start_time",
			field:     "start_time",
			value:     nil,
			expectErr: false,
		},
		{
			name:      "invalid start_time type",
			field:     "start_time",
			value:     123,
			expectErr: true,
		},
		{
			name:      "valid time_field",
			field:     "time_field",
			value:     "received",
			expectErr: false,
		},
		{
			name:      "invalid time_field",
			field:     "time_field",
			value:     "invalid",
			expectErr: true,
		},
		{
			name:      "valid time_zone",
			field:     "time_zone",
			value:     "UTC",
			expectErr: false,
		},
		{
			name:      "invalid time_zone type",
			field:     "time_zone",
			value:     123,
			expectErr: true,
		},
		{
			name:      "valid relative_enabled",
			field:     "relative_enabled",
			value:     true,
			expectErr: false,
		},
		{
			name:      "invalid relative_enabled type",
			field:     "relative_enabled",
			value:     "true",
			expectErr: true,
		},
		{
			name:      "valid relative_duration",
			field:     "relative_duration",
			value:     "24h",
			expectErr: false,
		},
		{
			name:      "invalid relative_duration format",
			field:     "relative_duration",
			value:     "24x",
			expectErr: true,
		},
		{
			name:      "valid relative_direction",
			field:     "relative_direction",
			value:     "past",
			expectErr: false,
		},
		{
			name:      "invalid relative_direction",
			field:     "relative_direction",
			value:     "invalid",
			expectErr: true,
		},
		{
			name:      "unknown field",
			field:     "unknown",
			value:     "value",
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := timeRangePlugin.ValidateFieldValue(tt.field, tt.value)
			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestEmailTimeRangePlugin_GetFieldSuggestions(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	// 测试 time_zone 字段
	suggestions, err := timeRangePlugin.GetFieldSuggestions("time_zone", "")
	assert.NoError(t, err)
	assert.NotEmpty(t, suggestions)
	assert.True(t, len(suggestions) >= 7)

	// 测试带前缀的 time_zone 字段
	suggestions, err = timeRangePlugin.GetFieldSuggestions("time_zone", "Asia")
	assert.NoError(t, err)
	assert.NotEmpty(t, suggestions)

	// 测试不支持的字段
	suggestions, err = timeRangePlugin.GetFieldSuggestions("invalid_field", "")
	assert.Error(t, err)
	assert.Empty(t, suggestions)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailTimeRangePlugin_BasicInterface(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()

	// 测试类型断言
	assert.IsType(t, &EmailTimeRangePlugin{}, plugin)

	// 测试插件信息
	info := plugin.GetInfo()
	assert.NotNil(t, info)
	assert.Equal(t, "email_time_range", info.ID)
	assert.Equal(t, "邮件时间范围筛选", info.Name)
	assert.Equal(t, "根据邮件时间范围筛选邮件", info.Description)
	assert.Equal(t, "1.0.0", info.Version)
	assert.Equal(t, plugins.PluginTypeCondition, info.Type)
	assert.Equal(t, plugins.PluginStatusLoaded, info.Status)
}

func TestEmailTimeRangePlugin_Configuration(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	// 测试默认配置
	defaultConfig := timeRangePlugin.GetDefaultConfig()
	assert.NotNil(t, defaultConfig)
	assert.Equal(t, "", defaultConfig["start_time"])
	assert.Equal(t, "", defaultConfig["end_time"])
	assert.Equal(t, "received", defaultConfig["time_field"])
	assert.Equal(t, "UTC", defaultConfig["time_zone"])

	// 验证relative_time配置
	relativeTime := defaultConfig["relative_time"].(map[string]interface{})
	assert.Equal(t, false, relativeTime["enabled"])
	assert.Equal(t, "24h", relativeTime["duration"])
	assert.Equal(t, "past", relativeTime["direction"])

	// 验证working_hours配置
	workingHours := defaultConfig["working_hours"].(map[string]interface{})
	assert.Equal(t, false, workingHours["enabled"])
	assert.Equal(t, 9, workingHours["start_hour"])
	assert.Equal(t, 17, workingHours["end_hour"])
}

func TestEmailTimeRangePlugin_HealthCheck(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	err := timeRangePlugin.HealthCheck()
	assert.NoError(t, err)
}

func TestEmailTimeRangePlugin_Metrics(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	metrics := timeRangePlugin.GetMetrics()
	assert.NotNil(t, metrics)
	assert.Contains(t, metrics, "evaluations")
	assert.Contains(t, metrics, "last_used")
	assert.Contains(t, metrics, "status")
}

func TestEmailTimeRangePlugin_SupportedEventTypes(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	eventTypes := timeRangePlugin.GetSupportedEventTypes()
	assert.NotNil(t, eventTypes)
	assert.Contains(t, eventTypes, "email.received")
	assert.Contains(t, eventTypes, "email.updated")
}

func TestEmailTimeRangePlugin_RequiredFields(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	requiredFields := timeRangePlugin.GetRequiredFields()
	assert.NotNil(t, requiredFields)
	assert.Contains(t, requiredFields, "received_at")
}

func TestEmailTimeRangePlugin_JSONSerialization(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	info := plugin.GetInfo()

	// 测试序列化
	data, err := json.Marshal(info)
	assert.NoError(t, err)
	assert.NotEmpty(t, data)

	// 测试反序列化
	var deserializedInfo plugins.PluginInfo
	err = json.Unmarshal(data, &deserializedInfo)
	assert.NoError(t, err)
	assert.Equal(t, info.ID, deserializedInfo.ID)
}

func TestEmailTimeRangePlugin_UISchema(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	schema := timeRangePlugin.GetUISchema()

	// 验证字段标签和描述
	assert.Equal(t, "开始时间", schema.Fields[0].Label)
	assert.Equal(t, "时间范围的开始时间", schema.Fields[0].Description)

	assert.Equal(t, "结束时间", schema.Fields[1].Label)
	assert.Equal(t, "时间范围的结束时间", schema.Fields[1].Description)

	assert.Equal(t, "时间字段", schema.Fields[2].Label)
	assert.Equal(t, "用于时间筛选的字段", schema.Fields[2].Description)

	assert.Equal(t, "时区", schema.Fields[3].Label)
	assert.Equal(t, "时间筛选使用的时区", schema.Fields[3].Description)

	// 验证操作符
	assert.Len(t, schema.Operators, 3)
	assert.Equal(t, "between", schema.Operators[0].Value)
	assert.Equal(t, "在...之间", schema.Operators[0].Label)
	assert.Equal(t, "before", schema.Operators[1].Value)
	assert.Equal(t, "在...之前", schema.Operators[1].Label)
	assert.Equal(t, "after", schema.Operators[2].Value)
	assert.Equal(t, "在...之后", schema.Operators[2].Label)
}

func TestEmailTimeRangePlugin_DynamicOptions(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	// 测试获取时区选项
	options, err := timeRangePlugin.GetDynamicOptions("time_zone", "")
	assert.NoError(t, err)
	assert.GreaterOrEqual(t, len(options), 7)

	// 验证常见时区选项
	found := false
	for _, opt := range options {
		if opt.Value == "UTC" {
			found = true
			assert.Equal(t, "UTC", opt.Label)
			assert.Equal(t, "协调世界时", opt.Description)
			break
		}
	}
	assert.True(t, found)

	// 测试相对时间方向选项
	options, err = timeRangePlugin.GetDynamicOptions("relative_direction", "")
	assert.NoError(t, err)
	assert.Len(t, options, 2)

	// 测试不支持的字段
	_, err = timeRangePlugin.GetDynamicOptions("invalid_field", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailTimeRangePlugin_FieldValidation(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	// 测试有效的时间字段
	err := timeRangePlugin.ValidateFieldValue("time_field", "received")
	assert.NoError(t, err)

	err = timeRangePlugin.ValidateFieldValue("time_field", "sent")
	assert.NoError(t, err)

	// 测试无效的时间字段
	err = timeRangePlugin.ValidateFieldValue("time_field", "invalid")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid time_field")

	// 测试时区验证
	err = timeRangePlugin.ValidateFieldValue("time_zone", "UTC")
	assert.NoError(t, err)

	err = timeRangePlugin.ValidateFieldValue("time_zone", 123)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "time_zone must be a string")

	// 测试相对时间长度验证
	err = timeRangePlugin.ValidateFieldValue("relative_duration", "24h")
	assert.NoError(t, err)

	err = timeRangePlugin.ValidateFieldValue("relative_duration", "7d")
	assert.NoError(t, err)

	err = timeRangePlugin.ValidateFieldValue("relative_duration", "invalid_suffix")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "relative_duration must end with")

	// 测试相对时间方向验证
	err = timeRangePlugin.ValidateFieldValue("relative_direction", "past")
	assert.NoError(t, err)

	err = timeRangePlugin.ValidateFieldValue("relative_direction", "future")
	assert.NoError(t, err)

	err = timeRangePlugin.ValidateFieldValue("relative_direction", "invalid")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid relative_direction")
}

func TestEmailTimeRangePlugin_FieldSuggestions(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	// 测试获取所有时区建议
	suggestions, err := timeRangePlugin.GetFieldSuggestions("time_zone", "")
	assert.NoError(t, err)
	assert.True(t, len(suggestions) >= 7)

	// 验证常见建议
	assert.Contains(t, suggestions, "UTC")
	assert.Contains(t, suggestions, "Asia/Shanghai")
	assert.Contains(t, suggestions, "America/New_York")

	// 测试带前缀的建议
	suggestions, err = timeRangePlugin.GetFieldSuggestions("time_zone", "Asia")
	assert.NoError(t, err)
	assert.NotEmpty(t, suggestions)

	// 测试不支持的字段
	_, err = timeRangePlugin.GetFieldSuggestions("invalid_field", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailTimeRangePlugin_Evaluate(t *testing.T) {
	plugin := NewEmailTimeRangePlugin()
	timeRangePlugin := plugin.(*EmailTimeRangePlugin)

	// 初始化插件
	ctx := &plugins.PluginContext{
		PluginID:  "email_time_range",
		TriggerID: 1,
		Config:    &plugins.PluginConfig{},
	}
	err := timeRangePlugin.Initialize(ctx)
	assert.NoError(t, err)

	// 创建测试邮件事件
	now := time.Now()
	emailData := models.EmailEventData{
		EmailID:       1,
		AccountID:     1,
		MailboxID:     1,
		Subject:       "Test Email",
		From:          "test@example.com",
		To:            "user@example.com",
		MessageID:     "test-message-id",
		ThreadID:      "test-thread-id",
		IsRead:        false,
		HasAttachment: false,
		Labels:        []string{},
		ReceivedAt:    now,
	}

	eventData, _ := json.Marshal(emailData)
	event := &models.Event{
		ID:     "test-event",
		Type:   "email.received",
		Status: "completed",
		Data:   json.RawMessage(eventData),
	}

	// 测试基本评估（没有时间范围限制）
	result, err := timeRangePlugin.Evaluate(ctx, event)
	assert.NoError(t, err)
	assert.True(t, result.Success)

	// 测试带时间范围的评估
	config := map[string]interface{}{
		"start_time": now.Add(-2 * time.Hour).Format(time.RFC3339),
		"end_time":   now.Add(time.Hour).Format(time.RFC3339),
		"time_field": "received",
		"time_zone":  "UTC",
	}
	err = timeRangePlugin.ApplyConfig(config)
	assert.NoError(t, err)

	result, err = timeRangePlugin.Evaluate(ctx, event)
	assert.NoError(t, err)
	assert.True(t, result.Success)
	assert.True(t, result.Data["matched"].(bool))
}
