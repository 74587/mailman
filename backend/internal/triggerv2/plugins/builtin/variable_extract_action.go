package builtin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"text/template"
	"time"

	"github.com/dop251/goja"

	"mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// VariableExtractActionPlugin 变量提取动作插件
// 用于从邮件数据中提取变量作为最终返回值
type VariableExtractActionPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewVariableExtractActionPlugin 创建变量提取动作插件
func NewVariableExtractActionPlugin() plugins.ActionPlugin {
	return &VariableExtractActionPlugin{
		info: &plugins.PluginInfo{
			ID:          "variable_extract_action",
			Name:        "变量提取",
			Version:     "1.0.0",
			Description: "从邮件数据中提取变量作为返回值，常用于取件模板的最终输出",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"source": map[string]interface{}{
						"type":        "string",
						"description": "数据来源",
						"enum":        []string{"email", "variable", "expression"},
						"default":     "email",
					},
					"source_field": map[string]interface{}{
						"type":        "string",
						"description": "邮件字段名（当 source = email）",
					},
					"source_variable": map[string]interface{}{
						"type":        "string",
						"description": "变量名（当 source = variable）",
					},
					"expression": map[string]interface{}{
						"type":        "string",
						"description": "提取表达式",
					},
					"expression_type": map[string]interface{}{
						"type":        "string",
						"description": "表达式类型",
						"enum":        []string{"javascript", "go_template", "regex", "jsonpath"},
						"default":     "javascript",
					},
					"output_name": map[string]interface{}{
						"type":        "string",
						"description": "输出变量名（可选）",
					},
					"return_type": map[string]interface{}{
						"type":        "string",
						"description": "返回类型",
						"enum":        []string{"string", "json", "auto"},
						"default":     "auto",
					},
				},
				"required": []string{"source"},
			},
			DefaultConfig: map[string]interface{}{
				"source":          "email",
				"expression_type": "javascript",
				"return_type":     "auto",
			},
		},
		config: make(map[string]interface{}),
	}
}

// GetInfo 获取插件信息
func (p *VariableExtractActionPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize 初始化插件
func (p *VariableExtractActionPlugin) Initialize(ctx *plugins.PluginContext) error {
	return nil
}

// Cleanup 清理插件
func (p *VariableExtractActionPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时触发
func (p *VariableExtractActionPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时触发
func (p *VariableExtractActionPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时触发
func (p *VariableExtractActionPlugin) OnActivate() error {
	return nil
}

// OnDeactivate 停用时触发
func (p *VariableExtractActionPlugin) OnDeactivate() error {
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *VariableExtractActionPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{
		"source":          "email",
		"expression_type": "javascript",
		"return_type":     "auto",
	}
}

// ValidateConfig 验证配置
func (p *VariableExtractActionPlugin) ValidateConfig(config map[string]interface{}) error {
	source := getStringValue(config, "source", "email")

	switch source {
	case "email":
		// 邮件字段来源
		sourceField := getStringValue(config, "source_field", "")
		if sourceField == "" {
			return fmt.Errorf("source_field 为必填项（当 source = email）")
		}
	case "variable":
		// 变量来源
		sourceVar := getStringValue(config, "source_variable", "")
		if sourceVar == "" {
			return fmt.Errorf("source_variable 为必填项（当 source = variable）")
		}
	case "expression":
		// 表达式来源
		expr := getStringValue(config, "expression", "")
		if expr == "" {
			return fmt.Errorf("expression 为必填项（当 source = expression）")
		}
	default:
		return fmt.Errorf("不支持的 source 类型: %s", source)
	}

	return nil
}

// ApplyConfig 应用配置
func (p *VariableExtractActionPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}
	p.config = config
	return nil
}

// HealthCheck 健康检查
func (p *VariableExtractActionPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *VariableExtractActionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"avg_execution_time": p.info.AvgExecutionTime,
		"usage_count":        p.info.UsageCount,
		"error_rate":         p.info.ErrorRate,
	}
}

// GetDescription 获取描述
func (p *VariableExtractActionPlugin) GetDescription() string {
	return "从邮件数据中提取变量作为返回值。支持从邮件字段、变量池或自定义表达式中提取数据，常用于取件模板的最终输出。"
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *VariableExtractActionPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(triggerModels.EventTypeEmailReceived),
		string(triggerModels.EventTypeEmailUpdated),
	}
}

// GetRequiredConfig 获取必需的配置
func (p *VariableExtractActionPlugin) GetRequiredConfig() []string {
	return []string{"source"}
}

// CanExecute 检查是否可以执行
func (p *VariableExtractActionPlugin) CanExecute(ctx *plugins.PluginContext, event *triggerModels.Event) bool {
	if event.Type != triggerModels.EventTypeEmailReceived && event.Type != triggerModels.EventTypeEmailUpdated {
		return false
	}
	return true
}

// GetExecutionOrder 获取执行顺序
func (p *VariableExtractActionPlugin) GetExecutionOrder() int {
	return 200 // 通常在最后执行
}

// Execute 执行动作
func (p *VariableExtractActionPlugin) Execute(ctx *plugins.PluginContext, event *triggerModels.Event) (result *plugins.PluginResult, err error) {
	startTime := time.Now()
	defer func() {
		if recovered := recover(); recovered != nil {
			result = &plugins.PluginResult{
				Success:       false,
				Error:         fmt.Sprintf("提取失败: 插件执行异常: %v", recovered),
				ExecutionTime: time.Since(startTime),
				Timestamp:     time.Now(),
			}
			err = nil
		}
	}()

	// 更新使用统计
	if p.info != nil {
		p.info.UsageCount++
		p.info.LastUsed = time.Now()
	}

	if p.config == nil {
		p.config = p.GetDefaultConfig()
	}

	if event == nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         "事件为空",
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 获取邮件对象
	var email *models.Email
	var emailEventData triggerModels.EmailEventData
	if err := event.GetData(&emailEventData); err == nil && emailEventData.Email != nil {
		email = emailEventData.Email
	} else {
		return &plugins.PluginResult{
			Success:       false,
			Error:         "无法获取邮件数据",
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 获取配置
	source := getStringValue(p.config, "source", "email")
	returnType := getStringValue(p.config, "return_type", "auto")

	var extractedValue interface{}
	var extractErr error

	switch source {
	case "email":
		extractedValue, extractErr = p.extractFromEmail(email, event)
	case "variable":
		extractedValue, extractErr = p.extractFromVariable(event)
	case "expression":
		extractedValue, extractErr = p.extractFromExpression(email, event)
	default:
		extractErr = fmt.Errorf("不支持的 source 类型: %s", source)
	}

	if extractErr != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("提取失败: %v", extractErr),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 处理返回类型
	var finalValue interface{}
	switch returnType {
	case "string":
		finalValue = fmt.Sprintf("%v", extractedValue)
	case "json":
		jsonBytes, err := json.Marshal(extractedValue)
		if err != nil {
			finalValue = extractedValue
		} else {
			finalValue = string(jsonBytes)
		}
	default: // auto
		finalValue = extractedValue
	}

	// 设置输出变量（如果指定）
	outputName := getStringValue(p.config, "output_name", "")
	if outputName != "" {
		event.SetVariable(outputName, finalValue)
	}

	// 计算执行时间
	duration := time.Since(startTime)
	if p.info != nil {
		p.info.AvgExecutionTime = (p.info.AvgExecutionTime + duration) / 2
	}

	return &plugins.PluginResult{
		Success:       true,
		ExecutionTime: duration,
		Timestamp:     time.Now(),
		Data: map[string]interface{}{
			"extracted_value": finalValue,
			"source":          source,
			"return_type":     returnType,
			"output_name":     outputName,
		},
	}, nil
}

// extractFromEmail 从邮件字段提取
func (p *VariableExtractActionPlugin) extractFromEmail(email *models.Email, event *triggerModels.Event) (interface{}, error) {
	if email == nil {
		return nil, fmt.Errorf("邮件数据为空")
	}

	sourceField := getStringValue(p.config, "source_field", "")
	expression := getStringValue(p.config, "expression", "")
	expressionType := getStringValue(p.config, "expression_type", "javascript")

	// 先获取邮件字段值
	fieldValue := p.getEmailFieldValue(email, sourceField)

	// 如果有表达式，应用表达式进行转换/提取
	if expression != "" {
		return p.applyExpression(expressionType, expression, fieldValue, email, event)
	}

	return fieldValue, nil
}

// extractFromVariable 从变量提取
func (p *VariableExtractActionPlugin) extractFromVariable(event *triggerModels.Event) (interface{}, error) {
	if event == nil {
		return nil, fmt.Errorf("事件为空")
	}

	sourceVar := getStringValue(p.config, "source_variable", "")
	expression := getStringValue(p.config, "expression", "")
	expressionType := getStringValue(p.config, "expression_type", "javascript")

	// 获取变量值
	varValue, exists := event.GetVariable(sourceVar)
	if !exists {
		// 尝试从 $_ (上一步输出) 获取
		if sourceVar == "_" || sourceVar == "$_" {
			varValue, exists = event.GetVariable("_")
		}
		if !exists {
			return nil, fmt.Errorf("变量 '%s' 不存在", sourceVar)
		}
	}

	// 如果有表达式，应用表达式进行转换/提取
	if expression != "" {
		var stringValue string
		switch v := varValue.(type) {
		case string:
			stringValue = v
		default:
			jsonBytes, _ := json.Marshal(v)
			stringValue = string(jsonBytes)
		}
		return p.applyExpression(expressionType, expression, stringValue, nil, event)
	}

	return varValue, nil
}

// extractFromExpression 从表达式提取
func (p *VariableExtractActionPlugin) extractFromExpression(email *models.Email, event *triggerModels.Event) (interface{}, error) {
	expression := getStringValue(p.config, "expression", "")
	expressionType := getStringValue(p.config, "expression_type", "javascript")

	if expression == "" {
		return nil, fmt.Errorf("expression 不能为空")
	}

	return p.applyExpression(expressionType, expression, "", email, event)
}

// applyExpression 应用表达式
func (p *VariableExtractActionPlugin) applyExpression(exprType, expression, sourceValue string, email *models.Email, event *triggerModels.Event) (interface{}, error) {
	switch exprType {
	case "javascript":
		return p.executeJavaScript(expression, sourceValue, email, event)
	case "go_template":
		return p.executeGoTemplate(expression, sourceValue, email, event)
	case "regex":
		return p.executeRegex(expression, sourceValue)
	case "jsonpath":
		return p.executeJSONPath(expression, sourceValue)
	default:
		return nil, fmt.Errorf("不支持的表达式类型: %s", exprType)
	}
}

// executeJavaScript 执行 JavaScript 表达式
func (p *VariableExtractActionPlugin) executeJavaScript(script, sourceValue string, email *models.Email, event *triggerModels.Event) (interface{}, error) {
	vm := goja.New()

	// 设置 value
	vm.Set("value", sourceValue)

	// 设置 $ 对象（邮件上下文）
	if email != nil {
		emailContext := map[string]interface{}{
			"Subject":        email.Subject,
			"From":           email.From,
			"To":             email.To,
			"Cc":             email.Cc,
			"Bcc":            email.Bcc,
			"Body":           email.Body,
			"TextBody":       email.TextBody,
			"HTMLBody":       email.HTMLBody,
			"MessageID":      email.MessageID,
			"MailboxName":    email.MailboxName,
			"HasAttachments": email.HasAttachments,
		}
		vm.Set("$", emailContext)
	} else {
		vm.Set("$", map[string]interface{}{})
	}

	// 设置 $var 对象（变量池）
	if event != nil {
		vm.Set("$var", event.GetAllVariables())
		// 设置 $_ (上一步输出)
		if prevOutput, exists := event.GetVariable("_"); exists {
			vm.Set("$_", prevOutput)
		}
	} else {
		vm.Set("$var", map[string]interface{}{})
	}

	// 执行脚本
	result, err := vm.RunString(script)
	if err != nil {
		return nil, fmt.Errorf("JavaScript 执行失败: %v", err)
	}

	// 导出结果
	return result.Export(), nil
}

// executeGoTemplate 执行 Go 模板表达式
func (p *VariableExtractActionPlugin) executeGoTemplate(templateStr, sourceValue string, email *models.Email, event *triggerModels.Event) (interface{}, error) {
	// 创建模板数据
	data := map[string]interface{}{
		"Value": sourceValue,
	}

	if email != nil {
		data["Email"] = email
		data["Subject"] = email.Subject
		data["From"] = strings.Join(email.From, ", ")
		data["To"] = strings.Join(email.To, ", ")
		data["Body"] = email.Body
		data["TextBody"] = email.TextBody
		data["HTMLBody"] = email.HTMLBody
	}

	if event != nil {
		data["Variables"] = event.GetAllVariables()
	}

	tmpl, err := template.New("extract").Parse(templateStr)
	if err != nil {
		return nil, fmt.Errorf("模板解析失败: %v", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return nil, fmt.Errorf("模板执行失败: %v", err)
	}

	return buf.String(), nil
}

// executeRegex 执行正则表达式
func (p *VariableExtractActionPlugin) executeRegex(pattern, sourceValue string) (interface{}, error) {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("正则表达式编译失败: %v", err)
	}

	matches := re.FindStringSubmatch(sourceValue)
	if len(matches) == 0 {
		return "", nil
	}

	// 如果有捕获组，返回第一个捕获组
	if len(matches) > 1 {
		return matches[1], nil
	}

	return matches[0], nil
}

// executeJSONPath 执行 JSONPath 表达式
func (p *VariableExtractActionPlugin) executeJSONPath(jsonPath, sourceValue string) (interface{}, error) {
	// 简单的 JSONPath 实现（支持基本的 $.field.subfield 格式）
	var data interface{}
	if err := json.Unmarshal([]byte(sourceValue), &data); err != nil {
		// 如果不是 JSON，尝试简单的字段访问
		return nil, fmt.Errorf("JSONPath 需要 JSON 格式的输入: %v", err)
	}

	// 解析 JSONPath
	path := strings.TrimPrefix(jsonPath, "$")
	path = strings.TrimPrefix(path, ".")
	parts := strings.Split(path, ".")

	current := data
	for _, part := range parts {
		if part == "" {
			continue
		}

		switch v := current.(type) {
		case map[string]interface{}:
			if val, exists := v[part]; exists {
				current = val
			} else {
				return nil, fmt.Errorf("字段 '%s' 不存在", part)
			}
		default:
			return nil, fmt.Errorf("无法访问字段 '%s'", part)
		}
	}

	return current, nil
}

// getEmailFieldValue 获取邮件字段值
func (p *VariableExtractActionPlugin) getEmailFieldValue(email *models.Email, field string) string {
	switch field {
	case "subject":
		return email.Subject
	case "from":
		return strings.Join(email.From, ", ")
	case "to":
		return strings.Join(email.To, ", ")
	case "cc":
		return strings.Join(email.Cc, ", ")
	case "bcc":
		return strings.Join(email.Bcc, ", ")
	case "body":
		return email.Body
	case "text_body":
		return email.TextBody
	case "html_body":
		return email.HTMLBody
	case "message_id":
		return email.MessageID
	case "mailbox_name":
		return email.MailboxName
	default:
		return ""
	}
}

// GetUISchema 获取UI架构
func (p *VariableExtractActionPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "source",
				Label:       "数据来源",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择从哪里提取数据",
				Required:    true,
				Width:       "full",
				Options: []plugins.UIOption{
					{Value: "email", Label: "邮件字段", Description: "从邮件的指定字段提取"},
					{Value: "variable", Label: "变量", Description: "从变量池中提取"},
					{Value: "expression", Label: "表达式", Description: "使用表达式计算"},
				},
				DefaultValue: "email",
			},
			{
				Name:        "source_field",
				Label:       "邮件字段",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择要提取的邮件字段",
				Required:    false,
				Width:       "1/2",
				ShowIf:      map[string]interface{}{"source": "email"},
				Options: []plugins.UIOption{
					{Value: "subject", Label: "主题"},
					{Value: "from", Label: "发件人"},
					{Value: "to", Label: "收件人"},
					{Value: "cc", Label: "抄送"},
					{Value: "bcc", Label: "密送"},
					{Value: "body", Label: "正文"},
					{Value: "text_body", Label: "纯文本正文"},
					{Value: "html_body", Label: "HTML正文"},
					{Value: "message_id", Label: "消息ID"},
					{Value: "mailbox_name", Label: "邮箱名称"},
				},
				DefaultValue: "subject",
			},
			{
				Name:        "source_variable",
				Label:       "变量名",
				Type:        plugins.UIFieldTypeText,
				Description: "输入要提取的变量名（如：ai_result 或 _）",
				Required:    false,
				Width:       "1/2",
				ShowIf:      map[string]interface{}{"source": "variable"},
				Placeholder: "输入变量名",
			},
			{
				Name:        "expression_type",
				Label:       "表达式类型",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择表达式引擎",
				Required:    false,
				Width:       "1/2",
				Options: []plugins.UIOption{
					{Value: "javascript", Label: "JavaScript", Description: "使用 JavaScript 表达式"},
					{Value: "go_template", Label: "Go Template", Description: "使用 Go 模板语法"},
					{Value: "regex", Label: "正则表达式", Description: "使用正则表达式提取"},
					{Value: "jsonpath", Label: "JSONPath", Description: "使用 JSONPath 语法"},
				},
				DefaultValue: "javascript",
			},
			{
				Name:        "expression",
				Label:       "提取表达式",
				Type:        plugins.UIFieldTypeJavaScript,
				Description: "输入提取表达式。JavaScript: 使用 $、$var、value；Go Template: 使用 {{.Value}}；Regex: 输入正则模式；JSONPath: 使用 $.field 格式",
				Required:    false,
				Width:       "full",
				Placeholder: "例如: $.Subject 或 value.match(/\\d+/)[0]",
			},
			{
				Name:        "output_name",
				Label:       "输出变量名",
				Type:        plugins.UIFieldTypeText,
				Description: "可选。将提取结果同时保存到指定变量",
				Required:    false,
				Width:       "1/2",
				Placeholder: "可选，如：extracted_code",
			},
			{
				Name:        "return_type",
				Label:       "返回类型",
				Type:        plugins.UIFieldTypeSelect,
				Description: "指定返回值的格式",
				Required:    false,
				Width:       "1/2",
				Options: []plugins.UIOption{
					{Value: "auto", Label: "自动", Description: "根据提取结果自动确定类型"},
					{Value: "string", Label: "字符串", Description: "强制转换为字符串"},
					{Value: "json", Label: "JSON", Description: "转换为 JSON 字符串"},
				},
				DefaultValue: "auto",
			},
		},
		Layout: "vertical",
	}
}

// GetFieldSuggestions 获取字段建议
func (p *VariableExtractActionPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	return nil, nil
}

// ValidateFieldValue 验证字段值
func (p *VariableExtractActionPlugin) ValidateFieldValue(field string, value interface{}) error {
	return nil
}

// GetDynamicOptions 获取动态选项
func (p *VariableExtractActionPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	return nil, nil
}
