package builtin

import (
	"encoding/json"
	"testing"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"

	"github.com/stretchr/testify/assert"
)

func TestEmailAccountSetPlugin_GetUISchema(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)
	schema := plugin.GetUISchema()

	assert.NotNil(t, schema)
	assert.Len(t, schema.Fields, 6) // account_emails, match_type, case_sensitive, api_endpoint, api_proxy, api_headers

	// 验证 account_emails 字段配置
	accountEmailsField := schema.Fields[0]
	assert.Equal(t, "account_emails", accountEmailsField.Name)
	assert.Equal(t, "邮箱账户列表", accountEmailsField.Label)
	assert.Equal(t, plugins.UIFieldTypeMultiSelect, accountEmailsField.Type)
	assert.True(t, accountEmailsField.Required)
	assert.Equal(t, "/api/email-accounts", accountEmailsField.OptionsAPI)

	// 验证 match_type 字段配置
	matchTypeField := schema.Fields[1]
	assert.Equal(t, "match_type", matchTypeField.Name)
	assert.Equal(t, "匹配类型", matchTypeField.Label)
	assert.Equal(t, plugins.UIFieldTypeSelect, matchTypeField.Type)
	assert.True(t, matchTypeField.Required)
	assert.Equal(t, "from", matchTypeField.DefaultValue)
	assert.Len(t, matchTypeField.Options, 3)

	// 验证 case_sensitive 字段配置
	caseSensitiveField := schema.Fields[2]
	assert.Equal(t, "case_sensitive", caseSensitiveField.Name)
	assert.Equal(t, "区分大小写", caseSensitiveField.Label)
	assert.Equal(t, plugins.UIFieldTypeBoolean, caseSensitiveField.Type)
	assert.False(t, caseSensitiveField.Required)

	// 验证 API 配置字段
	apiEndpointField := schema.Fields[3]
	assert.Equal(t, "api_endpoint", apiEndpointField.Name)
	assert.Equal(t, plugins.UIFieldTypeText, apiEndpointField.Type)
	assert.False(t, apiEndpointField.Required)

	apiProxyField := schema.Fields[4]
	assert.Equal(t, "api_proxy", apiProxyField.Name)
	assert.Equal(t, plugins.UIFieldTypeText, apiProxyField.Type)
	assert.False(t, apiProxyField.Required)

	apiHeadersField := schema.Fields[5]
	assert.Equal(t, "api_headers", apiHeadersField.Name)
	assert.Equal(t, plugins.UIFieldTypeJSON, apiHeadersField.Type)
	assert.False(t, apiHeadersField.Required)

	// 验证操作符
	assert.Len(t, schema.Operators, 2)
	assert.Equal(t, "in", schema.Operators[0].Value)
	assert.Equal(t, "not_in", schema.Operators[1].Value)

	// 验证布局
	assert.Equal(t, "vertical", schema.Layout)
	assert.True(t, schema.AllowNesting)
	assert.Equal(t, 3, schema.MaxNestingLevel)
}

func TestEmailAccountSetPlugin_GetDynamicOptions(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)

	// 测试 account_emails 字段
	options, err := plugin.GetDynamicOptions("account_emails", "")
	assert.NoError(t, err)
	assert.NotEmpty(t, options)

	// 验证选项格式
	for _, option := range options {
		assert.NotEmpty(t, option.Value)
		assert.NotEmpty(t, option.Label)
		assert.NotEmpty(t, option.Description)
	}

	// 测试带查询参数
	options, err = plugin.GetDynamicOptions("account_emails", "admin")
	assert.NoError(t, err)
	assert.NotEmpty(t, options)

	// 验证过滤结果
	found := false
	for _, option := range options {
		if option.Value == "admin@example.com" {
			found = true
			break
		}
	}
	assert.True(t, found)

	// 测试未知字段
	options, err = plugin.GetDynamicOptions("unknown_field", "")
	assert.Error(t, err)
	assert.Nil(t, options)
}

func TestEmailAccountSetPlugin_ValidateFieldValue(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)

	testCases := []struct {
		name      string
		fieldName string
		value     interface{}
		wantErr   bool
	}{
		{
			name:      "valid account_emails array",
			fieldName: "account_emails",
			value:     []interface{}{"test@example.com", "admin@example.com"},
			wantErr:   false,
		},
		{
			name:      "invalid email format",
			fieldName: "account_emails",
			value:     []interface{}{"invalid-email"},
			wantErr:   true,
		},
		{
			name:      "account_emails not array",
			fieldName: "account_emails",
			value:     "not_an_array",
			wantErr:   true,
		},
		{
			name:      "valid match_type",
			fieldName: "match_type",
			value:     "from",
			wantErr:   false,
		},
		{
			name:      "invalid match_type",
			fieldName: "match_type",
			value:     "invalid_type",
			wantErr:   true,
		},
		{
			name:      "valid case_sensitive",
			fieldName: "case_sensitive",
			value:     true,
			wantErr:   false,
		},
		{
			name:      "invalid case_sensitive",
			fieldName: "case_sensitive",
			value:     "not_boolean",
			wantErr:   true,
		},
		{
			name:      "unknown field",
			fieldName: "unknown",
			value:     "any_value",
			wantErr:   true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := plugin.ValidateFieldValue(tc.fieldName, tc.value)
			if tc.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestEmailAccountSetPlugin_GetFieldSuggestions(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)

	// 测试 account_emails 字段
	suggestions, err := plugin.GetFieldSuggestions("account_emails", "")
	assert.NoError(t, err)
	assert.NotEmpty(t, suggestions)

	// 验证建议格式
	for _, suggestion := range suggestions {
		assert.NotEmpty(t, suggestion)
		assert.Contains(t, suggestion, "@")
	}

	// 测试带前缀
	suggestions, err = plugin.GetFieldSuggestions("account_emails", "admin")
	assert.NoError(t, err)
	assert.NotEmpty(t, suggestions)

	// 验证过滤结果
	found := false
	for _, suggestion := range suggestions {
		if suggestion == "admin@example.com" {
			found = true
			break
		}
	}
	assert.True(t, found)

	// 测试未知字段
	suggestions, err = plugin.GetFieldSuggestions("unknown", "query")
	assert.Error(t, err)
	assert.Nil(t, suggestions)
}

func TestEmailAccountSetPlugin_Evaluate(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)

	// 初始化插件
	ctx := &plugins.PluginContext{
		PluginID:  "email_account_set",
		TriggerID: uint(1),
		Config: &plugins.PluginConfig{
			Enabled: true,
			Config: map[string]interface{}{
				"account_emails": []interface{}{"sender@example.com", "admin@example.com"},
				"match_type":     "from",
				"case_sensitive": false,
			},
		},
	}
	err := plugin.Initialize(ctx)
	assert.NoError(t, err)

	// 应用配置
	err = plugin.ApplyConfig(map[string]interface{}{
		"account_emails": []interface{}{"sender@example.com", "admin@example.com"},
		"match_type":     "from",
		"case_sensitive": false,
	})
	assert.NoError(t, err)

	// 移除未使用的变量

	testCases := []struct {
		name       string
		config     map[string]interface{}
		emailData  models.EmailEventData
		wantResult bool
		wantErr    bool
	}{
		{
			name: "email from matches account set",
			config: map[string]interface{}{
				"account_emails": []interface{}{"sender@example.com", "admin@example.com"},
				"match_type":     "from",
				"case_sensitive": false,
			},
			emailData: models.EmailEventData{
				From: "sender@example.com",
				To:   "recipient@example.com",
			},
			wantResult: true,
			wantErr:    false,
		},
		{
			name: "email from does not match account set",
			config: map[string]interface{}{
				"account_emails": []interface{}{"other@example.com", "admin@example.com"},
				"match_type":     "from",
				"case_sensitive": false,
			},
			emailData: models.EmailEventData{
				From: "sender@example.com",
				To:   "recipient@example.com",
			},
			wantResult: false,
			wantErr:    false,
		},
		{
			name: "email to matches account set",
			config: map[string]interface{}{
				"account_emails": []interface{}{"recipient@example.com", "admin@example.com"},
				"match_type":     "to",
				"case_sensitive": false,
			},
			emailData: models.EmailEventData{
				From: "sender@example.com",
				To:   "recipient@example.com",
			},
			wantResult: true,
			wantErr:    false,
		},
		{
			name: "email both matches account set",
			config: map[string]interface{}{
				"account_emails": []interface{}{"sender@example.com", "admin@example.com"},
				"match_type":     "both",
				"case_sensitive": false,
			},
			emailData: models.EmailEventData{
				From: "sender@example.com",
				To:   "other@example.com",
			},
			wantResult: true,
			wantErr:    false,
		},
		{
			name: "case sensitive match",
			config: map[string]interface{}{
				"account_emails": []interface{}{"Sender@example.com"},
				"match_type":     "from",
				"case_sensitive": true,
			},
			emailData: models.EmailEventData{
				From: "sender@example.com",
				To:   "recipient@example.com",
			},
			wantResult: false,
			wantErr:    false,
		},
		{
			name: "empty account emails",
			config: map[string]interface{}{
				"account_emails": []interface{}{},
				"match_type":     "from",
				"case_sensitive": false,
			},
			emailData: models.EmailEventData{
				From: "sender@example.com",
				To:   "recipient@example.com",
			},
			wantResult: false,
			wantErr:    false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// 应用测试配置
			err := plugin.ApplyConfig(tc.config)
			assert.NoError(t, err)

			// 创建测试事件
			eventData, err := json.Marshal(tc.emailData)
			assert.NoError(t, err)

			event := &models.Event{
				ID:        "test-event",
				Type:      models.EventTypeEmailReceived,
				Status:    models.EventStatusPending,
				Source:    "test",
				Subject:   "Test Email",
				Data:      eventData,
				Priority:  1,
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}

			result, err := plugin.Evaluate(ctx, event)

			if tc.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, result)
				assert.True(t, result.Success)

				matched, exists := result.Data["matched"]
				assert.True(t, exists)
				assert.Equal(t, tc.wantResult, matched)
			}
		})
	}
}

func TestEmailAccountSetPlugin_BasicInterface(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)

	// 测试插件信息
	info := plugin.GetInfo()
	assert.Equal(t, "email_account_set", info.ID)
	assert.Equal(t, "邮箱账户集合筛选", info.Name)
	assert.Equal(t, "1.0.0", info.Version)
	assert.Equal(t, "筛选特定邮箱账户集合中的邮件", info.Description)
	assert.Equal(t, plugins.PluginTypeCondition, info.Type)

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

func TestEmailAccountSetPlugin_Configuration(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)

	// 测试默认配置
	defaultConfig := plugin.GetDefaultConfig()
	assert.NotNil(t, defaultConfig)
	assert.Equal(t, []string{}, defaultConfig["account_emails"])
	assert.Equal(t, "from", defaultConfig["match_type"])
	assert.Equal(t, false, defaultConfig["case_sensitive"])

	// 测试配置验证
	validConfig := map[string]interface{}{
		"account_emails": []interface{}{"test@example.com"},
		"match_type":     "from",
		"case_sensitive": false,
	}
	assert.NoError(t, plugin.ValidateConfig(validConfig))

	// 测试无效配置
	invalidConfig := map[string]interface{}{
		"account_emails": "not_an_array",
		"match_type":     "invalid",
	}
	assert.Error(t, plugin.ValidateConfig(invalidConfig))

	// 测试应用配置
	assert.NoError(t, plugin.ApplyConfig(validConfig))
}

func TestEmailAccountSetPlugin_HealthCheck(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)
	assert.NoError(t, plugin.HealthCheck())
}

func TestEmailAccountSetPlugin_Metrics(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)
	metrics := plugin.GetMetrics()
	assert.NotNil(t, metrics)
	assert.Contains(t, metrics, "evaluations")
	assert.Contains(t, metrics, "last_used")
	assert.Contains(t, metrics, "status")
}

func TestEmailAccountSetPlugin_SupportedEventTypes(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)
	eventTypes := plugin.GetSupportedEventTypes()
	assert.Contains(t, eventTypes, string(models.EventTypeEmailReceived))
	assert.Contains(t, eventTypes, string(models.EventTypeEmailUpdated))
}

func TestEmailAccountSetPlugin_RequiredFields(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)
	fields := plugin.GetRequiredFields()
	assert.Contains(t, fields, "from")
	assert.Contains(t, fields, "to")
}

func TestEmailAccountSetPlugin_JSONSerialization(t *testing.T) {
	plugin := NewEmailAccountSetPlugin().(*EmailAccountSetPlugin)

	// 测试 UI Schema 的 JSON 序列化
	schema := plugin.GetUISchema()
	jsonData, err := json.Marshal(schema)
	assert.NoError(t, err)
	assert.NotEmpty(t, jsonData)

	// 验证可以反序列化
	var deserializedSchema plugins.UISchema
	err = json.Unmarshal(jsonData, &deserializedSchema)
	assert.NoError(t, err)
	assert.Equal(t, len(schema.Fields), len(deserializedSchema.Fields))
}
