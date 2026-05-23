package builtin

import (
	"bytes"
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

// TransformRule 转换规则
type TransformRule struct {
	// 来源配置
	SourceType     string `json:"source_type"`     // "field" | "variable"
	SourceField    string `json:"source_field"`    // 邮件字段名（当 source_type = "field"）
	SourceVariable string `json:"source_variable"` // 变量名（当 source_type = "variable"）

	// 转换配置
	TransformType   string                 `json:"transform_type"`   // "template" | "javascript" | "regex" | "prefix" | "suffix" | "replace"
	TransformConfig map[string]interface{} `json:"transform_config"` // 转换类型对应的配置

	// 输出配置
	OutputMode     string `json:"output_mode"`     // "replace_field" | "set_variable"
	TargetField    string `json:"target_field"`    // 目标字段（当 output_mode = "replace_field"）
	TargetVariable string `json:"target_variable"` // 变量名（当 output_mode = "set_variable"）
}

// EmailTransformActionV2Plugin 邮件数据转换动作插件V2
// 支持多规则配置和变量读写
type EmailTransformActionV2Plugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
	rules  []TransformRule
}

// NewEmailTransformActionV2Plugin 创建邮件数据转换动作插件V2
func NewEmailTransformActionV2Plugin() plugins.ActionPlugin {
	return &EmailTransformActionV2Plugin{
		info: &plugins.PluginInfo{
			ID:          "email_transform_action_v2",
			Name:        "邮件数据转换 V2",
			Version:     "2.0.0",
			Description: "增强版邮件数据转换，支持多规则配置、变量读写和链式执行",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"rules": map[string]interface{}{
						"type":        "array",
						"description": "转换规则列表",
					},
					"on_variable_error": map[string]interface{}{
						"type":        "string",
						"description": "变量读取异常处理方式",
						"enum":        []string{"fail", "ignore"},
						"default":     "fail",
					},
				},
				"required": []string{"rules"},
			},
			DefaultConfig: map[string]interface{}{
				"rules":             []TransformRule{},
				"on_variable_error": "fail",
			},
		},
		config: make(map[string]interface{}),
		rules:  []TransformRule{},
	}
}

// GetInfo 获取插件信息
func (p *EmailTransformActionV2Plugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize 初始化插件
func (p *EmailTransformActionV2Plugin) Initialize(ctx *plugins.PluginContext) error {
	return nil
}

// Cleanup 清理插件
func (p *EmailTransformActionV2Plugin) Cleanup() error {
	return nil
}

// OnLoad 加载时触发
func (p *EmailTransformActionV2Plugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时触发
func (p *EmailTransformActionV2Plugin) OnUnload() error {
	return nil
}

// OnActivate 激活时触发
func (p *EmailTransformActionV2Plugin) OnActivate() error {
	return nil
}

// OnDeactivate 停用时触发
func (p *EmailTransformActionV2Plugin) OnDeactivate() error {
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *EmailTransformActionV2Plugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{
		"rules":             []TransformRule{},
		"on_variable_error": "fail",
	}
}

// ValidateConfig 验证配置
func (p *EmailTransformActionV2Plugin) ValidateConfig(config map[string]interface{}) error {
	rules, err := p.parseRules(config)
	if err != nil {
		return err
	}

	for i, rule := range rules {
		if err := p.validateRule(rule, i); err != nil {
			return err
		}
	}

	return nil
}

// validateRule 验证单个规则
func (p *EmailTransformActionV2Plugin) validateRule(rule TransformRule, index int) error {
	// 验证来源类型
	if rule.SourceType != "field" && rule.SourceType != "variable" {
		return fmt.Errorf("规则 %d: source_type 必须是 'field' 或 'variable'", index+1)
	}

	// 验证来源字段/变量
	if rule.SourceType == "field" {
		validFields := []string{"subject", "from", "to", "cc", "bcc", "body", "text_body", "html_body", "message_id", "mailbox_name"}
		if !contains(validFields, rule.SourceField) {
			return fmt.Errorf("规则 %d: 不支持的来源字段 '%s'", index+1, rule.SourceField)
		}
	} else if rule.SourceVariable == "" {
		return fmt.Errorf("规则 %d: 来源变量名不能为空", index+1)
	}

	// 验证转换类型
	validTransformTypes := []string{"template", "javascript", "regex", "prefix", "suffix", "replace"}
	if !contains(validTransformTypes, rule.TransformType) {
		return fmt.Errorf("规则 %d: 不支持的转换类型 '%s'", index+1, rule.TransformType)
	}

	// 验证输出模式
	if rule.OutputMode != "replace_field" && rule.OutputMode != "set_variable" {
		return fmt.Errorf("规则 %d: output_mode 必须是 'replace_field' 或 'set_variable'", index+1)
	}

	// 验证目标字段/变量
	if rule.OutputMode == "replace_field" {
		validTargetFields := []string{"subject", "from", "to", "cc", "bcc", "body", "text_body", "html_body", "message_id", "mailbox_name"}
		if !contains(validTargetFields, rule.TargetField) {
			return fmt.Errorf("规则 %d: 不支持的目标字段 '%s'", index+1, rule.TargetField)
		}
	} else if rule.TargetVariable == "" {
		return fmt.Errorf("规则 %d: 目标变量名不能为空", index+1)
	} else if !isValidVariableName(rule.TargetVariable) {
		return fmt.Errorf("规则 %d: 变量名 '%s' 不符合命名规范（必须以字母或下划线开头，只能包含字母、数字和下划线）", index+1, rule.TargetVariable)
	}

	return nil
}

// isValidVariableName 验证变量名是否符合规范
func isValidVariableName(name string) bool {
	if name == "" {
		return false
	}
	// 变量名必须以字母或下划线开头，只能包含字母、数字和下划线
	pattern := regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
	return pattern.MatchString(name)
}

// contains 检查切片是否包含指定元素
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// parseRules 解析规则配置
func (p *EmailTransformActionV2Plugin) parseRules(config map[string]interface{}) ([]TransformRule, error) {
	rulesRaw, ok := config["rules"]
	if !ok {
		return []TransformRule{}, nil
	}

	rulesSlice, ok := rulesRaw.([]interface{})
	if !ok {
		// 尝试直接转换为 []TransformRule
		if rules, ok := rulesRaw.([]TransformRule); ok {
			return rules, nil
		}
		return nil, fmt.Errorf("rules 必须是数组")
	}

	rules := make([]TransformRule, 0, len(rulesSlice))
	for i, ruleRaw := range rulesSlice {
		ruleMap, ok := ruleRaw.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("规则 %d: 格式无效", i+1)
		}

		rule := TransformRule{
			SourceType:     getStringValue(ruleMap, "source_type", "field"),
			SourceField:    getStringValue(ruleMap, "source_field", ""),
			SourceVariable: getStringValue(ruleMap, "source_variable", ""),
			TransformType:  getStringValue(ruleMap, "transform_type", "template"),
			OutputMode:     getStringValue(ruleMap, "output_mode", "replace_field"),
			TargetField:    getStringValue(ruleMap, "target_field", ""),
			TargetVariable: getStringValue(ruleMap, "target_variable", ""),
		}

		// 解析转换配置
		if transformConfig, ok := ruleMap["transform_config"].(map[string]interface{}); ok {
			rule.TransformConfig = transformConfig
		} else {
			rule.TransformConfig = make(map[string]interface{})
		}

		rules = append(rules, rule)
	}

	return rules, nil
}

// getStringValue 从map中安全获取字符串值
func getStringValue(m map[string]interface{}, key string, defaultValue string) string {
	if value, ok := m[key]; ok {
		if str, ok := value.(string); ok {
			return str
		}
	}
	return defaultValue
}

// ApplyConfig 应用配置
func (p *EmailTransformActionV2Plugin) ApplyConfig(config map[string]interface{}) error {
	rules, err := p.parseRules(config)
	if err != nil {
		return err
	}

	if err := p.ValidateConfig(config); err != nil {
		return err
	}

	p.config = config
	p.rules = rules
	return nil
}

// HealthCheck 健康检查
func (p *EmailTransformActionV2Plugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *EmailTransformActionV2Plugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"avg_execution_time": p.info.AvgExecutionTime,
		"usage_count":        p.info.UsageCount,
		"error_rate":         p.info.ErrorRate,
	}
}

// GetDescription 获取描述
func (p *EmailTransformActionV2Plugin) GetDescription() string {
	return "增强版邮件数据转换，支持多规则配置、变量读写和链式执行。可配置多个转换规则，每个规则可选择从邮件字段或变量读取数据，执行转换后输出到邮件字段或设置为新变量。"
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *EmailTransformActionV2Plugin) GetSupportedEventTypes() []string {
	return []string{
		string(triggerModels.EventTypeEmailReceived),
		string(triggerModels.EventTypeEmailUpdated),
	}
}

// GetRequiredConfig 获取必需的配置
func (p *EmailTransformActionV2Plugin) GetRequiredConfig() []string {
	return []string{"rules"}
}

// CanExecute 检查是否可以执行
func (p *EmailTransformActionV2Plugin) CanExecute(ctx *plugins.PluginContext, event *triggerModels.Event) bool {
	if event.Type != triggerModels.EventTypeEmailReceived && event.Type != triggerModels.EventTypeEmailUpdated {
		return false
	}
	return len(p.rules) > 0
}

// GetExecutionOrder 获取执行顺序
func (p *EmailTransformActionV2Plugin) GetExecutionOrder() int {
	return 100 // 中等优先级
}

// Execute 执行动作
func (p *EmailTransformActionV2Plugin) Execute(ctx *plugins.PluginContext, event *triggerModels.Event) (*plugins.PluginResult, error) {
	startTime := time.Now()

	// 更新使用统计
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	// 获取变量异常处理配置
	onVariableError := getStringValue(p.config, "on_variable_error", "fail")

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

	// 执行结果记录
	ruleResults := make([]map[string]interface{}, 0, len(p.rules))

	// 依次执行每个规则
	for i, rule := range p.rules {
		ruleResult, err := p.executeRule(rule, email, event, onVariableError)
		if err != nil {
			// 根据变量异常处理配置决定是否继续
			if onVariableError == "fail" {
				return &plugins.PluginResult{
					Success:       false,
					Error:         fmt.Sprintf("规则 %d 执行失败: %v", i+1, err),
					ExecutionTime: time.Since(startTime),
					Timestamp:     time.Now(),
					Data: map[string]interface{}{
						"failed_rule_index": i,
						"rule_results":      ruleResults,
					},
				}, nil
			}
			// 忽略错误，记录并继续
			ruleResult = map[string]interface{}{
				"rule_index": i,
				"success":    false,
				"error":      err.Error(),
				"skipped":    true,
			}
		}
		ruleResults = append(ruleResults, ruleResult)
	}

	// 计算执行时间
	duration := time.Since(startTime)
	p.info.AvgExecutionTime = (p.info.AvgExecutionTime + duration) / 2

	return &plugins.PluginResult{
		Success:       true,
		ExecutionTime: duration,
		Timestamp:     time.Now(),
		Data: map[string]interface{}{
			"rules_executed": len(p.rules),
			"rule_results":   ruleResults,
			"variables":      event.GetAllVariables(),
		},
	}, nil
}

// executeRule 执行单个规则
func (p *EmailTransformActionV2Plugin) executeRule(rule TransformRule, email *models.Email, event *triggerModels.Event, onVariableError string) (map[string]interface{}, error) {
	result := map[string]interface{}{
		"source_type":    rule.SourceType,
		"transform_type": rule.TransformType,
		"output_mode":    rule.OutputMode,
	}

	// 1. 获取来源值
	sourceValue, err := p.getSourceValue(rule, email, event, onVariableError)
	if err != nil {
		return result, err
	}
	result["source_value"] = sourceValue

	// 2. 执行转换
	transformedValue, err := p.executeTransform(rule, sourceValue, email, event)
	if err != nil {
		return result, fmt.Errorf("转换失败: %v", err)
	}
	result["transformed_value"] = transformedValue

	// 3. 输出结果
	if err := p.outputResult(rule, transformedValue, email, event); err != nil {
		return result, fmt.Errorf("输出失败: %v", err)
	}
	result["success"] = true

	return result, nil
}

// getSourceValue 获取来源值
func (p *EmailTransformActionV2Plugin) getSourceValue(rule TransformRule, email *models.Email, event *triggerModels.Event, onVariableError string) (string, error) {
	if rule.SourceType == "field" {
		return p.getEmailFieldValue(email, rule.SourceField), nil
	}

	// 从变量获取
	varValue, exists := event.GetVariable(rule.SourceVariable)
	if !exists {
		if onVariableError == "fail" {
			return "", fmt.Errorf("变量 '%s' 不存在", rule.SourceVariable)
		}
		return "", nil // 忽略错误，返回空值
	}

	// 转换为字符串
	switch v := varValue.(type) {
	case string:
		return v, nil
	case fmt.Stringer:
		return v.String(), nil
	default:
		return fmt.Sprintf("%v", v), nil
	}
}

// executeTransform 执行转换
func (p *EmailTransformActionV2Plugin) executeTransform(rule TransformRule, sourceValue string, email *models.Email, event *triggerModels.Event) (string, error) {
	switch rule.TransformType {
	case "template":
		return p.executeGoTemplate(rule.TransformConfig, sourceValue, email, event)
	case "javascript":
		return p.executeJavaScript(rule.TransformConfig, sourceValue, email, event)
	case "regex":
		return p.executeRegex(rule.TransformConfig, sourceValue)
	case "prefix":
		prefix := getStringValue(rule.TransformConfig, "text", "")
		return prefix + sourceValue, nil
	case "suffix":
		suffix := getStringValue(rule.TransformConfig, "text", "")
		return sourceValue + suffix, nil
	case "replace":
		oldText := getStringValue(rule.TransformConfig, "old_text", "")
		newText := getStringValue(rule.TransformConfig, "new_text", "")
		return strings.ReplaceAll(sourceValue, oldText, newText), nil
	default:
		return "", fmt.Errorf("不支持的转换类型: %s", rule.TransformType)
	}
}

// executeGoTemplate 执行 Go 模板转换
func (p *EmailTransformActionV2Plugin) executeGoTemplate(config map[string]interface{}, sourceValue string, email *models.Email, event *triggerModels.Event) (string, error) {
	templateContent := getStringValue(config, "template", "")
	if templateContent == "" {
		return sourceValue, nil
	}

	// 创建模板数据
	data := map[string]interface{}{
		"Value":     sourceValue,
		"Email":     email,
		"Variables": event.GetAllVariables(),
		"Subject":   email.Subject,
		"From":      strings.Join(email.From, ", "),
		"To":        strings.Join(email.To, ", "),
		"Body":      email.Body,
		"TextBody":  email.TextBody,
		"HTMLBody":  email.HTMLBody,
	}

	tmpl, err := template.New("transform").Parse(templateContent)
	if err != nil {
		return "", fmt.Errorf("模板解析失败: %v", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("模板执行失败: %v", err)
	}

	return buf.String(), nil
}

// executeJavaScript 执行 JavaScript 转换
func (p *EmailTransformActionV2Plugin) executeJavaScript(config map[string]interface{}, sourceValue string, email *models.Email, event *triggerModels.Event) (string, error) {
	script := getStringValue(config, "script", "")
	if script == "" {
		return sourceValue, nil
	}

	vm := goja.New()

	// 设置 $ 对象（邮件上下文）
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

	// 设置 $var 对象（变量池）
	vm.Set("$var", event.GetAllVariables())

	// 设置当前值
	vm.Set("value", sourceValue)

	// 执行脚本
	result, err := vm.RunString(script)
	if err != nil {
		return "", fmt.Errorf("JavaScript 执行失败: %v", err)
	}

	return result.String(), nil
}

// executeRegex 执行正则表达式转换
func (p *EmailTransformActionV2Plugin) executeRegex(config map[string]interface{}, sourceValue string) (string, error) {
	pattern := getStringValue(config, "pattern", "")
	replacement := getStringValue(config, "replacement", "")

	if pattern == "" {
		return sourceValue, nil
	}

	re, err := regexp.Compile(pattern)
	if err != nil {
		return "", fmt.Errorf("正则表达式编译失败: %v", err)
	}

	return re.ReplaceAllString(sourceValue, replacement), nil
}

// outputResult 输出结果
func (p *EmailTransformActionV2Plugin) outputResult(rule TransformRule, value string, email *models.Email, event *triggerModels.Event) error {
	if rule.OutputMode == "replace_field" {
		return p.setEmailFieldValue(email, rule.TargetField, value)
	}

	// 设置变量
	event.SetVariable(rule.TargetVariable, value)
	return nil
}

// getEmailFieldValue 获取邮件字段值
func (p *EmailTransformActionV2Plugin) getEmailFieldValue(email *models.Email, field string) string {
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

// setEmailFieldValue 设置邮件字段值
func (p *EmailTransformActionV2Plugin) setEmailFieldValue(email *models.Email, field string, value string) error {
	switch field {
	case "subject":
		email.Subject = value
	case "from":
		email.From = strings.Split(value, ", ")
	case "to":
		email.To = strings.Split(value, ", ")
	case "cc":
		email.Cc = strings.Split(value, ", ")
	case "bcc":
		email.Bcc = strings.Split(value, ", ")
	case "body":
		email.Body = value
	case "text_body":
		email.TextBody = value
	case "html_body":
		email.HTMLBody = value
	case "message_id":
		email.MessageID = value
	case "mailbox_name":
		email.MailboxName = value
	default:
		return fmt.Errorf("不支持的字段: %s", field)
	}
	return nil
}

// GetUISchema 获取UI架构
func (p *EmailTransformActionV2Plugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "rules",
				Label:       "转换规则",
				Type:        plugins.UIFieldTypeArray,
				Description: "可配置多个转换规则，按顺序执行。每个规则可以从邮件字段或变量读取数据，执行转换后输出到字段或设置为新变量。",
				Required:    true,
				Width:       "full",
				ItemSchema: &plugins.UISchema{
					Fields: []plugins.UIField{
						{
							Name:        "source_type",
							Label:       "来源类型",
							Type:        plugins.UIFieldTypeSelect,
							Description: "选择从邮件字段还是变量读取数据",
							Required:    true,
							Width:       "1/2",
							Options: []plugins.UIOption{
								{Value: "field", Label: "邮件字段", Description: "从邮件的指定字段读取"},
								{Value: "variable", Label: "变量", Description: "从之前设置的变量读取"},
							},
							DefaultValue: "field",
						},
						{
							Name:        "source_field",
							Label:       "来源字段",
							Type:        plugins.UIFieldTypeSelect,
							Description: "选择读取邮件的哪个字段",
							Required:    false,
							Width:       "1/2",
							ShowIf:      map[string]interface{}{"source_type": "field"},
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
							Label:       "来源变量",
							Type:        plugins.UIFieldTypeText,
							Description: "输入变量名（如：ai_result）",
							Required:    false,
							Width:       "1/2",
							ShowIf:      map[string]interface{}{"source_type": "variable"},
							Placeholder: "输入变量名",
						},
						{
							Name:        "transform_type",
							Label:       "转换类型",
							Type:        plugins.UIFieldTypeSelect,
							Description: "选择转换方式",
							Required:    true,
							Width:       "1/2",
							Options: []plugins.UIOption{
								{Value: "template", Label: "模板", Description: "使用 Go 模板语法"},
								{Value: "javascript", Label: "JavaScript", Description: "使用 JavaScript 代码"},
								{Value: "regex", Label: "正则表达式", Description: "使用正则表达式替换"},
								{Value: "prefix", Label: "添加前缀", Description: "在内容前添加文本"},
								{Value: "suffix", Label: "添加后缀", Description: "在内容后添加文本"},
								{Value: "replace", Label: "文本替换", Description: "替换指定文本"},
							},
							DefaultValue: "template",
						},
						{
							Name:        "transform_config.template",
							Label:       "模板内容",
							Type:        plugins.UIFieldTypeGoTemplate,
							Description: "Go 模板语法，使用 {{.Value}} 访问当前值，{{.Subject}} 等访问邮件字段",
							Tooltip:     "可用变量：{{.Value}} 当前值，{{.Email}} 邮件对象，{{.Variables}} 变量池，{{.Subject}} 主题等",
							Required:    false,
							Width:       "full",
							ShowIf:      map[string]interface{}{"transform_type": "template"},
							Placeholder: "{{.Value}} - 已处理",
						},
						{
							Name:        "transform_config.script",
							Label:       "JavaScript 代码",
							Type:        plugins.UIFieldTypeJavaScript,
							Description: "使用 $ 访问邮件上下文，$var 访问变量池，value 访问当前值",
							Tooltip:     "示例：$.Subject.toUpperCase() 或 value + ' - 已处理'",
							Required:    false,
							Width:       "full",
							ShowIf:      map[string]interface{}{"transform_type": "javascript"},
							Placeholder: "value.toUpperCase()",
						},
						{
							Name:        "transform_config.pattern",
							Label:       "正则表达式",
							Type:        plugins.UIFieldTypeRegex,
							Description: "用于匹配的正则表达式模式",
							Required:    false,
							Width:       "1/2",
							ShowIf:      map[string]interface{}{"transform_type": "regex"},
							Placeholder: "\\d+",
						},
						{
							Name:        "transform_config.replacement",
							Label:       "替换内容",
							Type:        plugins.UIFieldTypeText,
							Description: "替换匹配项的内容",
							Required:    false,
							Width:       "1/2",
							ShowIf:      map[string]interface{}{"transform_type": "regex"},
							Placeholder: "NUMBER",
						},
						{
							Name:        "transform_config.text",
							Label:       "文本内容",
							Type:        plugins.UIFieldTypeText,
							Description: "要添加的文本内容",
							Required:    false,
							Width:       "full",
							ShowIf:      map[string]interface{}{"transform_type": []string{"prefix", "suffix"}},
							Placeholder: "输入文本",
						},
						{
							Name:        "transform_config.old_text",
							Label:       "原始文本",
							Type:        plugins.UIFieldTypeText,
							Description: "要被替换的文本",
							Required:    false,
							Width:       "1/2",
							ShowIf:      map[string]interface{}{"transform_type": "replace"},
							Placeholder: "原始文本",
						},
						{
							Name:        "transform_config.new_text",
							Label:       "新文本",
							Type:        plugins.UIFieldTypeText,
							Description: "替换后的文本",
							Required:    false,
							Width:       "1/2",
							ShowIf:      map[string]interface{}{"transform_type": "replace"},
							Placeholder: "新文本",
						},
						{
							Name:        "output_mode",
							Label:       "输出模式",
							Type:        plugins.UIFieldTypeSelect,
							Description: "选择输出方式",
							Required:    true,
							Width:       "1/2",
							Options: []plugins.UIOption{
								{Value: "replace_field", Label: "替换邮件字段", Description: "将结果写入邮件字段"},
								{Value: "set_variable", Label: "设置变量", Description: "将结果设置为新变量"},
							},
							DefaultValue: "replace_field",
						},
						{
							Name:        "target_field",
							Label:       "目标字段",
							Type:        plugins.UIFieldTypeSelect,
							Description: "选择要写入的邮件字段",
							Required:    false,
							Width:       "1/2",
							ShowIf:      map[string]interface{}{"output_mode": "replace_field"},
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
							Name:        "target_variable",
							Label:       "变量名",
							Type:        plugins.UIFieldTypeText,
							Description: "输入变量名（必须以字母或下划线开头，只能包含字母、数字和下划线）",
							Required:    false,
							Width:       "1/2",
							ShowIf:      map[string]interface{}{"output_mode": "set_variable"},
							Placeholder: "输入变量名（如：processed_content）",
							Validation: &plugins.UIValidation{
								Pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$",
								Message: "变量名必须以字母或下划线开头，只能包含字母、数字和下划线",
							},
						},
						{
							Name:        "variable_type",
							Label:       "变量类型",
							Type:        plugins.UIFieldTypeSelect,
							Description: "指定变量的数据类型，用于前端展示",
							Required:    false,
							Width:       "1/2",
							ShowIf:      map[string]interface{}{"output_mode": "set_variable"},
							Options: []plugins.UIOption{
								{Value: "string", Label: "字符串", Description: "文本类型"},
								{Value: "number", Label: "数字", Description: "数值类型"},
								{Value: "boolean", Label: "布尔值", Description: "true/false"},
								{Value: "object", Label: "对象", Description: "JSON对象"},
								{Value: "array", Label: "数组", Description: "列表类型"},
							},
							DefaultValue: "string",
						},
						{
							Name:        "variable_description",
							Label:       "变量描述",
							Type:        plugins.UIFieldTypeText,
							Description: "描述该变量的用途，便于后续使用时参考",
							Required:    false,
							Width:       "full",
							ShowIf:      map[string]interface{}{"output_mode": "set_variable"},
							Placeholder: "例如：提取的订单号",
						},
						{
							Name:        "variable_example",
							Label:       "示例值",
							Type:        plugins.UIFieldTypeText,
							Description: "提供一个示例值，帮助理解变量的内容格式",
							Required:    false,
							Width:       "full",
							ShowIf:      map[string]interface{}{"output_mode": "set_variable"},
							Placeholder: "例如：\"ORD-12345\"",
						},
					},
				},
			},
			{
				Name:         "on_variable_error",
				Label:        "变量读取异常处理",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "当引用的变量不存在时的处理方式",
				Required:     false,
				Width:        "1/2",
				DefaultValue: "fail",
				Options: []plugins.UIOption{
					{Value: "fail", Label: "终止执行并报错", Description: "默认行为，变量不存在时立即报错"},
					{Value: "ignore", Label: "忽略错误，使用空值", Description: "变量不存在时使用空字符串继续执行"},
				},
			},
		},
		Examples: []plugins.UIExample{
			{
				Title:       "提取订单号到变量",
				Description: "从邮件主题中提取订单号并设置为变量",
				Expression: map[string]interface{}{
					"rules": []map[string]interface{}{
						{
							"source_type":    "field",
							"source_field":   "subject",
							"transform_type": "regex",
							"transform_config": map[string]interface{}{
								"pattern":     "订单号[：:](\\w+)",
								"replacement": "$1",
							},
							"output_mode":     "set_variable",
							"target_variable": "order_id",
						},
					},
					"on_variable_error": "fail",
				},
			},
			{
				Title:       "主题添加前缀 + 设置变量",
				Description: "为邮件主题添加前缀，同时将原始主题保存到变量",
				Expression: map[string]interface{}{
					"rules": []map[string]interface{}{
						{
							"source_type":      "field",
							"source_field":     "subject",
							"transform_type":   "prefix",
							"transform_config": map[string]interface{}{"text": ""},
							"output_mode":      "set_variable",
							"target_variable":  "original_subject",
						},
						{
							"source_type":      "field",
							"source_field":     "subject",
							"transform_type":   "prefix",
							"transform_config": map[string]interface{}{"text": "[重要] "},
							"output_mode":      "replace_field",
							"target_field":     "subject",
						},
					},
					"on_variable_error": "fail",
				},
			},
		},
	}
}

// GetDynamicOptions 获取动态选项
func (p *EmailTransformActionV2Plugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	return []plugins.UIOption{}, nil
}

// ValidateFieldValue 验证字段值
func (p *EmailTransformActionV2Plugin) ValidateFieldValue(field string, value interface{}) error {
	if field == "target_variable" || field == "source_variable" {
		if str, ok := value.(string); ok {
			if str != "" && !isValidVariableName(str) {
				return fmt.Errorf("变量名不符合命名规范")
			}
		}
	}
	return nil
}

// GetFieldSuggestions 获取字段建议
func (p *EmailTransformActionV2Plugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	if field == "target_variable" || field == "source_variable" {
		return []string{
			"result",
			"processed_content",
			"extracted_data",
			"order_id",
			"customer_name",
			"ai_response",
		}, nil
	}
	return []string{}, nil
}
