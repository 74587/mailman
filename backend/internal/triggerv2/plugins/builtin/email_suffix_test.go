package builtin

import (
	"encoding/json"
	"testing"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"

	"github.com/stretchr/testify/assert"
)

func TestEmailSuffixPlugin_GetUISchema(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	schema := suffixPlugin.GetUISchema()

	assert.NotNil(t, schema)
	assert.Len(t, schema.Fields, 5)

	// 验证第一个字段：suffixes
	assert.Equal(t, "suffixes", schema.Fields[0].Name)
	assert.Equal(t, "邮箱后缀列表", schema.Fields[0].Label)
	assert.Equal(t, plugins.UIFieldTypeMultiSelect, schema.Fields[0].Type)
	assert.True(t, schema.Fields[0].Required)

	// 验证第二个字段：match_type
	assert.Equal(t, "match_type", schema.Fields[1].Name)
	assert.Equal(t, "匹配类型", schema.Fields[1].Label)
	assert.Equal(t, plugins.UIFieldTypeSelect, schema.Fields[1].Type)
	assert.True(t, schema.Fields[1].Required)
	assert.Len(t, schema.Fields[1].Options, 3)

	// 验证第三个字段：match_mode
	assert.Equal(t, "match_mode", schema.Fields[2].Name)
	assert.Equal(t, "匹配模式", schema.Fields[2].Label)
	assert.Equal(t, plugins.UIFieldTypeSelect, schema.Fields[2].Type)
	assert.True(t, schema.Fields[2].Required)

	// 验证第四个字段：exact_match
	assert.Equal(t, "exact_match", schema.Fields[3].Name)
	assert.Equal(t, "精确匹配", schema.Fields[3].Label)
	assert.Equal(t, plugins.UIFieldTypeBoolean, schema.Fields[3].Type)
	assert.False(t, schema.Fields[3].Required)

	// 验证第五个字段：case_sensitive
	assert.Equal(t, "case_sensitive", schema.Fields[4].Name)
	assert.Equal(t, "区分大小写", schema.Fields[4].Label)
	assert.Equal(t, plugins.UIFieldTypeBoolean, schema.Fields[4].Type)
	assert.False(t, schema.Fields[4].Required)
}

func TestEmailSuffixPlugin_GetDynamicOptions(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	// 测试 suffixes 字段
	options, err := suffixPlugin.GetDynamicOptions("suffixes", "")
	assert.NoError(t, err)
	assert.NotEmpty(t, options)
	assert.True(t, len(options) >= 8)

	// 测试带查询的 suffixes 字段
	options, err = suffixPlugin.GetDynamicOptions("suffixes", "gmail")
	assert.NoError(t, err)
	assert.NotEmpty(t, options)

	// 测试不支持的字段
	options, err = suffixPlugin.GetDynamicOptions("match_type", "")
	assert.Error(t, err)
	assert.Empty(t, options)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailSuffixPlugin_ValidateFieldValue(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	tests := []struct {
		name      string
		field     string
		value     interface{}
		expectErr bool
	}{
		{
			name:      "valid suffixes",
			field:     "suffixes",
			value:     []interface{}{"gmail.com", "outlook.com"},
			expectErr: false,
		},
		{
			name:      "empty suffixes array",
			field:     "suffixes",
			value:     []interface{}{},
			expectErr: false,
		},
		{
			name:      "suffixes not array",
			field:     "suffixes",
			value:     "gmail.com",
			expectErr: true,
		},
		{
			name:      "valid match_type",
			field:     "match_type",
			value:     "from",
			expectErr: false,
		},
		{
			name:      "invalid match_type",
			field:     "match_type",
			value:     "invalid",
			expectErr: true,
		},
		{
			name:      "valid case_sensitive",
			field:     "case_sensitive",
			value:     true,
			expectErr: false,
		},
		{
			name:      "invalid case_sensitive",
			field:     "case_sensitive",
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
			err := suffixPlugin.ValidateFieldValue(tt.field, tt.value)
			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestEmailSuffixPlugin_GetFieldSuggestions(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	// 测试 suffixes 字段
	suggestions, err := suffixPlugin.GetFieldSuggestions("suffixes", "")
	assert.NoError(t, err)
	assert.NotEmpty(t, suggestions)
	assert.True(t, len(suggestions) >= 12)

	// 测试带前缀的 suffixes 字段
	suggestions, err = suffixPlugin.GetFieldSuggestions("suffixes", "gmail")
	assert.NoError(t, err)
	assert.NotEmpty(t, suggestions)

	// 测试不支持的字段
	suggestions, err = suffixPlugin.GetFieldSuggestions("match_type", "")
	assert.Error(t, err)
	assert.Empty(t, suggestions)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailSuffixPlugin_BasicInterface(t *testing.T) {
	plugin := NewEmailSuffixPlugin()

	// 测试类型断言
	assert.IsType(t, &EmailSuffixPlugin{}, plugin)

	// 测试插件信息
	info := plugin.GetInfo()
	assert.NotNil(t, info)
	assert.Equal(t, "email_suffix", info.ID)
	assert.Equal(t, "邮箱后缀筛选", info.Name)
	assert.Equal(t, "根据邮箱后缀（域名）筛选邮件", info.Description)
	assert.Equal(t, "1.0.0", info.Version)
	assert.Equal(t, plugins.PluginTypeCondition, info.Type)
	assert.Equal(t, plugins.PluginStatusLoaded, info.Status)
}

func TestEmailSuffixPlugin_Configuration(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	// 测试默认配置
	defaultConfig := suffixPlugin.GetDefaultConfig()
	assert.NotNil(t, defaultConfig)
	assert.Equal(t, []string{}, defaultConfig["suffixes"])
	assert.Equal(t, "from", defaultConfig["match_type"])
	assert.Equal(t, false, defaultConfig["case_sensitive"])
	assert.Equal(t, "any", defaultConfig["match_mode"])
	assert.Equal(t, true, defaultConfig["exact_match"])

	// 测试配置验证
	validConfig := map[string]interface{}{
		"suffixes":       []interface{}{"gmail.com", "outlook.com"},
		"match_type":     "from",
		"case_sensitive": false,
		"match_mode":     "any",
		"exact_match":    true,
	}
	err := suffixPlugin.ValidateConfig(validConfig)
	assert.NoError(t, err)

	// 测试应用配置
	err = suffixPlugin.ApplyConfig(validConfig)
	assert.NoError(t, err)
}

func TestEmailSuffixPlugin_HealthCheck(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	err := suffixPlugin.HealthCheck()
	assert.NoError(t, err)
}

func TestEmailSuffixPlugin_Metrics(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	metrics := suffixPlugin.GetMetrics()
	assert.NotNil(t, metrics)
	assert.Contains(t, metrics, "evaluations")
	assert.Contains(t, metrics, "last_used")
	assert.Contains(t, metrics, "status")
}

func TestEmailSuffixPlugin_SupportedEventTypes(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	eventTypes := suffixPlugin.GetSupportedEventTypes()
	assert.NotNil(t, eventTypes)
	assert.Contains(t, eventTypes, "email.received")
	assert.Contains(t, eventTypes, "email.updated")
}

func TestEmailSuffixPlugin_RequiredFields(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	requiredFields := suffixPlugin.GetRequiredFields()
	assert.NotNil(t, requiredFields)
	assert.Contains(t, requiredFields, "from")
	assert.Contains(t, requiredFields, "to")
}

func TestEmailSuffixPlugin_JSONSerialization(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
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

func TestEmailSuffixPlugin_UISchema(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	schema := suffixPlugin.GetUISchema()

	// 验证字段标签和描述
	assert.Equal(t, "邮箱后缀列表", schema.Fields[0].Label)
	assert.Equal(t, "要匹配的邮箱后缀（域名）列表", schema.Fields[0].Description)

	// 验证第二个字段
	assert.Equal(t, "匹配类型", schema.Fields[1].Label)
	assert.Equal(t, "指定匹配邮件的发件人还是收件人", schema.Fields[1].Description)

	// 验证第三个字段
	assert.Equal(t, "匹配模式", schema.Fields[2].Label)
	assert.Equal(t, "后缀匹配模式", schema.Fields[2].Description)

	// 验证第四个字段
	assert.Equal(t, "精确匹配", schema.Fields[3].Label)
	assert.Equal(t, "是否精确匹配域名（不匹配子域名）", schema.Fields[3].Description)
	assert.Equal(t, false, schema.Fields[3].DefaultValue)

	// 验证第五个字段
	assert.Equal(t, "区分大小写", schema.Fields[4].Label)
	assert.Equal(t, "是否区分大小写进行匹配", schema.Fields[4].Description)
	assert.Equal(t, false, schema.Fields[4].DefaultValue)

	// 验证操作符
	assert.Len(t, schema.Operators, 2)
	assert.Equal(t, "ends_with", schema.Operators[0].Value)
	assert.Equal(t, "not_ends_with", schema.Operators[1].Value)
}

func TestEmailSuffixPlugin_DynamicOptions(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	// 测试获取所有选项
	options, err := suffixPlugin.GetDynamicOptions("suffixes", "")
	assert.NoError(t, err)
	assert.GreaterOrEqual(t, len(options), 8)

	// 验证常见选项
	found := false
	for _, opt := range options {
		if opt.Value == "gmail.com" {
			found = true
			assert.Equal(t, "gmail.com", opt.Label)
			assert.Equal(t, "Gmail邮箱", opt.Description)
			break
		}
	}
	assert.True(t, found)

	// 测试不支持的字段
	_, err = suffixPlugin.GetDynamicOptions("match_type", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailSuffixPlugin_FieldValidation(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	// 测试有效的suffixes数组
	err := suffixPlugin.ValidateFieldValue("suffixes", []interface{}{"gmail.com", "outlook.com"})
	assert.NoError(t, err)

	// 测试无效的suffixes值
	err = suffixPlugin.ValidateFieldValue("suffixes", "gmail.com")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "suffixes must be an array")

	// 测试无效的suffixes数组内容
	err = suffixPlugin.ValidateFieldValue("suffixes", []interface{}{123})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "suffix must be a string")

	// 测试无效的match_type
	err = suffixPlugin.ValidateFieldValue("match_type", "invalid")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid match_type")

	// 测试无效的match_mode
	err = suffixPlugin.ValidateFieldValue("match_mode", "invalid")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid match_mode")

	// 测试无效的exact_match
	err = suffixPlugin.ValidateFieldValue("exact_match", "invalid")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "exact_match must be a boolean")

	// 测试未知字段
	err = suffixPlugin.ValidateFieldValue("nonexistent", "value")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailSuffixPlugin_FieldSuggestions(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	// 测试获取所有建议
	suggestions, err := suffixPlugin.GetFieldSuggestions("suffixes", "")
	assert.NoError(t, err)
	assert.True(t, len(suggestions) >= 12)

	// 验证常见建议
	assert.Contains(t, suggestions, "gmail.com")
	assert.Contains(t, suggestions, "outlook.com")
	assert.Contains(t, suggestions, "qq.com")

	// 测试带前缀的建议
	suggestions, err = suffixPlugin.GetFieldSuggestions("suffixes", "gmail")
	assert.NoError(t, err)
	assert.Contains(t, suggestions, "gmail.com")

	// 测试不支持的字段
	_, err = suffixPlugin.GetFieldSuggestions("match_type", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported field")
}

func TestEmailSuffixPlugin_Evaluate(t *testing.T) {
	plugin := NewEmailSuffixPlugin()
	suffixPlugin := plugin.(*EmailSuffixPlugin)

	// 初始化插件
	ctx := &plugins.PluginContext{
		PluginID:  "email_suffix",
		TriggerID: 1,
		Config:    &plugins.PluginConfig{},
	}
	err := suffixPlugin.Initialize(ctx)
	assert.NoError(t, err)

	// 应用配置
	config := map[string]interface{}{
		"suffixes":       []interface{}{"gmail.com", "outlook.com"},
		"match_type":     "from",
		"case_sensitive": false,
		"match_mode":     "any",
		"exact_match":    true,
	}
	err = suffixPlugin.ApplyConfig(config)
	assert.NoError(t, err)

	// 创建测试邮件事件
	emailData := models.EmailEventData{
		EmailID:   1,
		AccountID: 1,
		From:      "test@gmail.com",
		To:        "user@example.com",
		Subject:   "Test Email",
	}

	eventData, _ := json.Marshal(emailData)
	event := &models.Event{
		ID:     "test-event",
		Type:   "email",
		Status: "received",
		Data:   json.RawMessage(eventData),
	}

	// 测试匹配
	result, err := suffixPlugin.Evaluate(ctx, event)
	assert.NoError(t, err)
	assert.True(t, result.Success)

	assert.True(t, result.Data["matched"].(bool))

	// 测试不匹配
	emailData.From = "test@yahoo.com"
	eventData, _ = json.Marshal(emailData)
	event.Data = json.RawMessage(eventData)

	result, err = suffixPlugin.Evaluate(ctx, event)
	assert.NoError(t, err)
	assert.True(t, result.Success)

	assert.False(t, result.Data["matched"].(bool))

	// 测试 match_type = "to"
	config["match_type"] = "to"
	err = suffixPlugin.ApplyConfig(config)
	assert.NoError(t, err)

	emailData.To = "user@gmail.com"
	eventData, _ = json.Marshal(emailData)
	event.Data = json.RawMessage(eventData)

	result, err = suffixPlugin.Evaluate(ctx, event)
	assert.NoError(t, err)
	assert.True(t, result.Success)

	assert.True(t, result.Data["matched"].(bool))

	// 测试 match_type = "both"
	config["match_type"] = "both"
	err = suffixPlugin.ApplyConfig(config)
	assert.NoError(t, err)

	emailData.From = "test@yahoo.com"
	emailData.To = "user@outlook.com"
	eventData, _ = json.Marshal(emailData)
	event.Data = json.RawMessage(eventData)

	result, err = suffixPlugin.Evaluate(ctx, event)
	assert.NoError(t, err)
	assert.True(t, result.Success)

	assert.True(t, result.Data["matched"].(bool))
}
