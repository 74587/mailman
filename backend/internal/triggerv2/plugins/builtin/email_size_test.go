package builtin

import (
	"encoding/json"
	"testing"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"

	"github.com/stretchr/testify/assert"
)

func TestEmailSizePlugin_GetUISchema(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	schema := sizePlugin.GetUISchema()

	assert.NotNil(t, schema)
	assert.Len(t, schema.Fields, 8)

	// 验证第一个字段：size_type
	assert.Equal(t, "size_type", schema.Fields[0].Name)
	assert.Equal(t, "大小类型", schema.Fields[0].Label)
	assert.Equal(t, plugins.UIFieldTypeSelect, schema.Fields[0].Type)
	assert.True(t, schema.Fields[0].Required)
	assert.Equal(t, "total", schema.Fields[0].DefaultValue)
	assert.Len(t, schema.Fields[0].Options, 3)

	// 验证第二个字段：unit
	assert.Equal(t, "unit", schema.Fields[1].Name)
	assert.Equal(t, "大小单位", schema.Fields[1].Label)
	assert.Equal(t, plugins.UIFieldTypeSelect, schema.Fields[1].Type)
	assert.True(t, schema.Fields[1].Required)
	assert.Equal(t, "MB", schema.Fields[1].DefaultValue)
	assert.Len(t, schema.Fields[1].Options, 4)

	// 验证第三个字段：min_size
	assert.Equal(t, "min_size", schema.Fields[2].Name)
	assert.Equal(t, "最小大小", schema.Fields[2].Label)
	assert.Equal(t, plugins.UIFieldTypeNumber, schema.Fields[2].Type)
	assert.False(t, schema.Fields[2].Required)
	assert.Equal(t, 0, schema.Fields[2].Min)

	// 验证第四个字段：max_size
	assert.Equal(t, "max_size", schema.Fields[3].Name)
	assert.Equal(t, "最大大小", schema.Fields[3].Label)
	assert.Equal(t, plugins.UIFieldTypeNumber, schema.Fields[3].Type)
	assert.False(t, schema.Fields[3].Required)
	assert.Equal(t, 0, schema.Fields[3].Min)

	// 验证第五个字段：include_attachments
	assert.Equal(t, "include_attachments", schema.Fields[4].Name)
	assert.Equal(t, "包含附件", schema.Fields[4].Label)
	assert.Equal(t, plugins.UIFieldTypeBoolean, schema.Fields[4].Type)
	assert.False(t, schema.Fields[4].Required)
	assert.Equal(t, true, schema.Fields[4].DefaultValue)

	// 验证操作符
	assert.Len(t, schema.Operators, 4)
	assert.Equal(t, "greater_than", schema.Operators[0].Value)
	assert.Equal(t, "less_than", schema.Operators[1].Value)
	assert.Equal(t, "between", schema.Operators[2].Value)
	assert.Equal(t, "equals", schema.Operators[3].Value)
}

func TestEmailSizePlugin_GetDynamicOptions(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	// 测试 size_unit 字段
	options, err := sizePlugin.GetDynamicOptions("size_unit", "")
	assert.NoError(t, err)
	assert.Len(t, options, 4)

	// 验证单位选项
	expectedUnits := []string{"B", "KB", "MB", "GB"}
	for i, option := range options {
		assert.Equal(t, expectedUnits[i], option.Value)
	}

	// 测试 size_type 字段
	options, err = sizePlugin.GetDynamicOptions("size_type", "")
	assert.NoError(t, err)
	assert.Len(t, options, 3)

	// 验证大小类型选项
	expectedTypes := []string{"total", "attachments", "body"}
	for i, option := range options {
		assert.Equal(t, expectedTypes[i], option.Value)
	}

	// 测试 comparison 字段
	options, err = sizePlugin.GetDynamicOptions("comparison", "")
	assert.NoError(t, err)
	assert.Len(t, options, 6)

	// 验证比较操作选项
	expectedComparisons := []string{"equal", "greater", "less", "greater_equal", "less_equal", "between"}
	for i, option := range options {
		assert.Equal(t, expectedComparisons[i], option.Value)
	}

	// 测试不支持的字段
	options, err = sizePlugin.GetDynamicOptions("invalid_field", "")
	assert.Error(t, err)
	assert.Empty(t, options)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailSizePlugin_ValidateFieldValue(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	tests := []struct {
		name      string
		field     string
		value     interface{}
		expectErr bool
	}{
		{
			name:      "valid size_type",
			field:     "size_type",
			value:     "total",
			expectErr: false,
		},
		{
			name:      "invalid size_type",
			field:     "size_type",
			value:     "invalid",
			expectErr: true,
		},
		{
			name:      "invalid size_type type",
			field:     "size_type",
			value:     123,
			expectErr: true,
		},
		{
			name:      "valid min_size",
			field:     "min_size",
			value:     float64(10),
			expectErr: false,
		},
		{
			name:      "invalid min_size negative",
			field:     "min_size",
			value:     float64(-1),
			expectErr: true,
		},
		{
			name:      "invalid min_size type",
			field:     "min_size",
			value:     "invalid",
			expectErr: true,
		},
		{
			name:      "valid max_size",
			field:     "max_size",
			value:     float64(100),
			expectErr: false,
		},
		{
			name:      "invalid max_size negative",
			field:     "max_size",
			value:     float64(-1),
			expectErr: true,
		},
		{
			name:      "valid size_unit",
			field:     "size_unit",
			value:     "MB",
			expectErr: false,
		},
		{
			name:      "invalid size_unit",
			field:     "size_unit",
			value:     "TB",
			expectErr: true,
		},
		{
			name:      "invalid size_unit type",
			field:     "size_unit",
			value:     123,
			expectErr: true,
		},
		{
			name:      "valid comparison",
			field:     "comparison",
			value:     "greater",
			expectErr: false,
		},
		{
			name:      "invalid comparison",
			field:     "comparison",
			value:     "invalid",
			expectErr: true,
		},
		{
			name:      "invalid comparison type",
			field:     "comparison",
			value:     123,
			expectErr: true,
		},
		{
			name:      "valid include_attachments",
			field:     "include_attachments",
			value:     true,
			expectErr: false,
		},
		{
			name:      "invalid include_attachments type",
			field:     "include_attachments",
			value:     "true",
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
			err := sizePlugin.ValidateFieldValue(tt.field, tt.value)
			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestEmailSizePlugin_GetFieldSuggestions(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	// 测试 size_unit 字段
	suggestions, err := sizePlugin.GetFieldSuggestions("size_unit", "")
	assert.NoError(t, err)
	assert.Len(t, suggestions, 4)
	assert.Contains(t, suggestions, "B")
	assert.Contains(t, suggestions, "KB")
	assert.Contains(t, suggestions, "MB")
	assert.Contains(t, suggestions, "GB")

	// 测试带前缀的 size_unit 字段
	suggestions, err = sizePlugin.GetFieldSuggestions("size_unit", "M")
	assert.NoError(t, err)
	assert.Len(t, suggestions, 1)
	assert.Contains(t, suggestions, "MB")

	// 测试 size_type 字段
	suggestions, err = sizePlugin.GetFieldSuggestions("size_type", "")
	assert.NoError(t, err)
	assert.Len(t, suggestions, 3)
	assert.Contains(t, suggestions, "total")
	assert.Contains(t, suggestions, "attachments")
	assert.Contains(t, suggestions, "body")

	// 测试 comparison 字段
	suggestions, err = sizePlugin.GetFieldSuggestions("comparison", "")
	assert.NoError(t, err)
	assert.Len(t, suggestions, 6)
	assert.Contains(t, suggestions, "equal")
	assert.Contains(t, suggestions, "greater")
	assert.Contains(t, suggestions, "less")

	// 测试不支持的字段
	suggestions, err = sizePlugin.GetFieldSuggestions("invalid_field", "")
	assert.Error(t, err)
	assert.Empty(t, suggestions)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailSizePlugin_BasicInterface(t *testing.T) {
	plugin := NewEmailSizePlugin()

	// 测试类型断言
	assert.IsType(t, &EmailSizePlugin{}, plugin)

	// 测试插件信息
	info := plugin.GetInfo()
	assert.NotNil(t, info)
	assert.Equal(t, "email_size", info.ID)
	assert.Equal(t, "邮件大小筛选", info.Name)
	assert.Equal(t, "根据邮件大小筛选邮件", info.Description)
	assert.Equal(t, "1.0.0", info.Version)
	assert.Equal(t, plugins.PluginTypeCondition, info.Type)
	assert.Equal(t, plugins.PluginStatusLoaded, info.Status)
}

func TestEmailSizePlugin_Configuration(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	// 测试默认配置
	defaultConfig := sizePlugin.GetInfo().DefaultConfig
	assert.NotNil(t, defaultConfig)
	assert.Equal(t, "0B", defaultConfig["min_size"])
	assert.Equal(t, "", defaultConfig["max_size"])
	assert.Equal(t, "content", defaultConfig["size_field"])
	assert.Equal(t, true, defaultConfig["include_attachments"])

	// 验证attachment_filter配置
	attachmentFilter := defaultConfig["attachment_filter"].(map[string]interface{})
	assert.Equal(t, false, attachmentFilter["enabled"])
	assert.Equal(t, 0, attachmentFilter["min_count"])
	assert.Equal(t, 100, attachmentFilter["max_count"])
	assert.Equal(t, []string{}, attachmentFilter["file_types"])
}

func TestEmailSizePlugin_HealthCheck(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	err := sizePlugin.HealthCheck()
	assert.NoError(t, err)
}

func TestEmailSizePlugin_Metrics(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	metrics := sizePlugin.GetMetrics()
	assert.NotNil(t, metrics)
	assert.Contains(t, metrics, "evaluations")
	assert.Contains(t, metrics, "last_used")
	assert.Contains(t, metrics, "status")
}

func TestEmailSizePlugin_SupportedEventTypes(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	eventTypes := sizePlugin.GetSupportedEventTypes()
	assert.NotNil(t, eventTypes)
	assert.Contains(t, eventTypes, "email.received")
	assert.Contains(t, eventTypes, "email.updated")
}

func TestEmailSizePlugin_RequiredFields(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	requiredFields := sizePlugin.GetRequiredFields()
	assert.NotNil(t, requiredFields)
	assert.Contains(t, requiredFields, "subject")
	assert.Contains(t, requiredFields, "has_attachment")
}

func TestEmailSizePlugin_JSONSerialization(t *testing.T) {
	plugin := NewEmailSizePlugin()
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

func TestEmailSizePlugin_UISchema(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	schema := sizePlugin.GetUISchema()

	// 验证字段标签和描述
	assert.Equal(t, "大小类型", schema.Fields[0].Label)
	assert.Equal(t, "指定邮件大小的类型", schema.Fields[0].Description)

	assert.Equal(t, "大小单位", schema.Fields[1].Label)
	assert.Equal(t, "大小的单位", schema.Fields[1].Description)

	assert.Equal(t, "最小大小", schema.Fields[2].Label)
	assert.Equal(t, "最小邮件大小", schema.Fields[2].Description)

	assert.Equal(t, "最大大小", schema.Fields[3].Label)
	assert.Equal(t, "最大邮件大小", schema.Fields[3].Description)

	// 验证操作符
	assert.Len(t, schema.Operators, 4)
	assert.Equal(t, "greater_than", schema.Operators[0].Value)
	assert.Equal(t, "大于", schema.Operators[0].Label)
	assert.Equal(t, "less_than", schema.Operators[1].Value)
	assert.Equal(t, "小于", schema.Operators[1].Label)
	assert.Equal(t, "between", schema.Operators[2].Value)
	assert.Equal(t, "介于", schema.Operators[2].Label)
	assert.Equal(t, "equals", schema.Operators[3].Value)
	assert.Equal(t, "等于", schema.Operators[3].Label)
}

func TestEmailSizePlugin_DynamicOptions(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	// 测试获取单位选项
	options, err := sizePlugin.GetDynamicOptions("size_unit", "")
	assert.NoError(t, err)
	assert.Len(t, options, 4)

	// 验证单位选项
	found := false
	for _, opt := range options {
		if opt.Value == "MB" {
			found = true
			assert.Equal(t, "兆字节 (MB)", opt.Label)
			assert.Equal(t, "兆字节", opt.Description)
			break
		}
	}
	assert.True(t, found)

	// 测试大小类型选项
	options, err = sizePlugin.GetDynamicOptions("size_type", "")
	assert.NoError(t, err)
	assert.Len(t, options, 3)

	// 测试不支持的字段
	_, err = sizePlugin.GetDynamicOptions("invalid_field", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailSizePlugin_FieldValidation(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	// 测试有效的大小类型
	err := sizePlugin.ValidateFieldValue("size_type", "total")
	assert.NoError(t, err)

	err = sizePlugin.ValidateFieldValue("size_type", "attachments")
	assert.NoError(t, err)

	err = sizePlugin.ValidateFieldValue("size_type", "body")
	assert.NoError(t, err)

	// 测试无效的大小类型
	err = sizePlugin.ValidateFieldValue("size_type", "invalid")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid size_type")

	// 测试大小值验证
	err = sizePlugin.ValidateFieldValue("min_size", float64(10))
	assert.NoError(t, err)

	err = sizePlugin.ValidateFieldValue("min_size", float64(-1))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "min_size must be non-negative")

	// 测试单位验证
	err = sizePlugin.ValidateFieldValue("size_unit", "MB")
	assert.NoError(t, err)

	err = sizePlugin.ValidateFieldValue("size_unit", "TB")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid size_unit")

	// 测试比较操作验证
	err = sizePlugin.ValidateFieldValue("comparison", "greater")
	assert.NoError(t, err)

	err = sizePlugin.ValidateFieldValue("comparison", "invalid")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid comparison")
}

func TestEmailSizePlugin_FieldSuggestions(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	// 测试获取所有单位建议
	suggestions, err := sizePlugin.GetFieldSuggestions("size_unit", "")
	assert.NoError(t, err)
	assert.Len(t, suggestions, 4)

	// 验证常见建议
	assert.Contains(t, suggestions, "B")
	assert.Contains(t, suggestions, "KB")
	assert.Contains(t, suggestions, "MB")
	assert.Contains(t, suggestions, "GB")

	// 测试带前缀的建议
	suggestions, err = sizePlugin.GetFieldSuggestions("size_unit", "K")
	assert.NoError(t, err)
	assert.Len(t, suggestions, 1)
	assert.Contains(t, suggestions, "KB")

	// 测试不支持的字段
	_, err = sizePlugin.GetFieldSuggestions("invalid_field", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailSizePlugin_Evaluate(t *testing.T) {
	plugin := NewEmailSizePlugin()
	sizePlugin := plugin.(*EmailSizePlugin)

	// 初始化插件
	ctx := &plugins.PluginContext{
		PluginID:  "email_size",
		TriggerID: 1,
		Config:    &plugins.PluginConfig{},
	}
	err := sizePlugin.Initialize(ctx)
	assert.NoError(t, err)

	// 创建测试邮件事件
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
	}

	eventData, _ := json.Marshal(emailData)
	event := &models.Event{
		ID:     "test-event",
		Type:   "email.received",
		Status: "completed",
		Data:   json.RawMessage(eventData),
	}

	// 测试基本评估
	result, err := sizePlugin.Evaluate(ctx, event)
	assert.NoError(t, err)
	assert.True(t, result.Success)

	// 测试带配置的评估
	config := map[string]interface{}{
		"min_size":            "1KB",
		"max_size":            "100KB",
		"size_field":          "total",
		"include_attachments": true,
	}
	err = sizePlugin.ApplyConfig(config)
	assert.NoError(t, err)

	result, err = sizePlugin.Evaluate(ctx, event)
	assert.NoError(t, err)
	assert.True(t, result.Success)
	assert.True(t, result.Data["matched"].(bool))
}
