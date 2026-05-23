package builtin

import (
	"fmt"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// EmailPrefixPlugin 邮箱前缀筛选插件
type EmailPrefixPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewEmailPrefixPlugin 创建邮箱前缀筛选插件
func NewEmailPrefixPlugin() plugins.ConditionPlugin {
	return &EmailPrefixPlugin{
		info: &plugins.PluginInfo{
			ID:          "email_prefix",
			Name:        "邮箱前缀筛选",
			Version:     "1.0.0",
			Description: "根据邮箱前缀筛选邮件",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"prefixes": map[string]interface{}{
						"type":        "array",
						"description": "邮箱前缀列表",
						"items": map[string]interface{}{
							"type": "string",
						},
					},
					"match_type": map[string]interface{}{
						"type":        "string",
						"description": "匹配类型: from（发件人）, to（收件人）, both（发件人或收件人）",
						"default":     "from",
						"enum":        []string{"from", "to", "both"},
					},
					"case_sensitive": map[string]interface{}{
						"type":        "boolean",
						"description": "是否区分大小写",
						"default":     false,
					},
					"match_mode": map[string]interface{}{
						"type":        "string",
						"description": "匹配模式: any（任一前缀匹配）, all（所有前缀匹配）",
						"default":     "any",
						"enum":        []string{"any", "all"},
					},
				},
				"required": []string{"prefixes"},
			},
			DefaultConfig: map[string]interface{}{
				"prefixes":       []string{},
				"match_type":     "from",
				"case_sensitive": false,
				"match_mode":     "any",
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
func (p *EmailPrefixPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// GetUISchema 获取UI架构
func (p *EmailPrefixPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:         "prefixes",
				Label:        "邮箱前缀列表",
				Type:         plugins.UIFieldTypeMultiSelect,
				Description:  "要匹配的邮箱前缀列表",
				Placeholder:  "输入邮箱前缀，如: user, admin",
				Required:     true,
				Width:        "full",
				DefaultValue: []string{},
			},
			{
				Name:         "match_type",
				Label:        "匹配类型",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "指定匹配邮件的发件人还是收件人",
				Required:     true,
				Width:        "half",
				DefaultValue: "from",
				Options: []plugins.UIOption{
					{Value: "from", Label: "发件人", Description: "匹配邮件发件人"},
					{Value: "to", Label: "收件人", Description: "匹配邮件收件人"},
					{Value: "both", Label: "发件人或收件人", Description: "匹配邮件发件人或收件人"},
				},
			},
			{
				Name:         "match_mode",
				Label:        "匹配模式",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "前缀匹配模式",
				Required:     true,
				Width:        "half",
				DefaultValue: "any",
				Options: []plugins.UIOption{
					{Value: "any", Label: "任一匹配", Description: "匹配任一前缀即可"},
					{Value: "all", Label: "全部匹配", Description: "必须匹配所有前缀"},
				},
			},
			{
				Name:         "case_sensitive",
				Label:        "区分大小写",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否区分大小写进行匹配",
				Required:     false,
				Width:        "half",
				DefaultValue: false,
			},
		},
		Operators: []plugins.UIOperator{
			{Value: "starts_with", Label: "以...开头", ApplicableTo: []string{"multi_select"}},
			{Value: "not_starts_with", Label: "不以...开头", ApplicableTo: []string{"multi_select"}},
		},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "根据邮箱前缀筛选邮件",
		Examples: []plugins.UIExample{
			{
				Title:       "筛选管理员邮件",
				Description: "只显示来自管理员账户的邮件",
				Expression: map[string]interface{}{
					"prefixes":       []string{"admin", "administrator"},
					"match_type":     "from",
					"match_mode":     "any",
					"case_sensitive": false,
				},
			},
		},
	}
}

// GetDynamicOptions 获取动态选项
func (p *EmailPrefixPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	switch field {
	case "prefixes":
		// 返回常见的邮箱前缀选项
		options := []plugins.UIOption{
			{Value: "admin", Label: "admin", Description: "管理员前缀"},
			{Value: "support", Label: "support", Description: "支持前缀"},
			{Value: "noreply", Label: "noreply", Description: "无回复前缀"},
			{Value: "info", Label: "info", Description: "信息前缀"},
			{Value: "sales", Label: "sales", Description: "销售前缀"},
			{Value: "marketing", Label: "marketing", Description: "市场前缀"},
		}

		// 如果有查询参数，进行过滤
		if query != "" {
			var filtered []plugins.UIOption
			for _, opt := range options {
				if strings.Contains(strings.ToLower(opt.Value.(string)), strings.ToLower(query)) ||
					strings.Contains(strings.ToLower(opt.Label), strings.ToLower(query)) {
					filtered = append(filtered, opt)
				}
			}
			return filtered, nil
		}

		return options, nil
	default:
		return nil, fmt.Errorf("unsupported field: %s", field)
	}
}

// ValidateFieldValue 验证字段值
func (p *EmailPrefixPlugin) ValidateFieldValue(field string, value interface{}) error {
	switch field {
	case "prefixes":
		if prefixes, ok := value.([]interface{}); ok {
			for _, prefix := range prefixes {
				if prefixStr, ok := prefix.(string); ok {
					if len(prefixStr) == 0 {
						return fmt.Errorf("prefix cannot be empty")
					}
					if strings.Contains(prefixStr, "@") {
						return fmt.Errorf("prefix should not contain @ symbol")
					}
				} else {
					return fmt.Errorf("prefix must be a string")
				}
			}
		} else {
			return fmt.Errorf("prefixes must be an array")
		}
	case "match_type":
		if matchType, ok := value.(string); ok {
			validTypes := []string{"from", "to", "both"}
			for _, validType := range validTypes {
				if matchType == validType {
					return nil
				}
			}
			return fmt.Errorf("invalid match_type: %s", matchType)
		} else {
			return fmt.Errorf("match_type must be a string")
		}
	case "match_mode":
		if matchMode, ok := value.(string); ok {
			validModes := []string{"any", "all"}
			for _, validMode := range validModes {
				if matchMode == validMode {
					return nil
				}
			}
			return fmt.Errorf("invalid match_mode: %s", matchMode)
		} else {
			return fmt.Errorf("match_mode must be a string")
		}
	case "case_sensitive":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("case_sensitive must be a boolean")
		}
	default:
		return fmt.Errorf("unsupported field: %s", field)
	}
	return nil
}

// GetFieldSuggestions 获取字段建议
func (p *EmailPrefixPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	switch field {
	case "prefixes":
		// 返回常见的邮箱前缀建议
		suggestions := []string{
			"admin",
			"support",
			"noreply",
			"info",
			"sales",
			"marketing",
			"hr",
			"finance",
			"tech",
			"customer",
		}

		// 如果有前缀，进行过滤
		if prefix != "" {
			var filtered []string
			for _, suggestion := range suggestions {
				if strings.HasPrefix(strings.ToLower(suggestion), strings.ToLower(prefix)) {
					filtered = append(filtered, suggestion)
				}
			}
			return filtered, nil
		}

		return suggestions, nil
	default:
		return nil, fmt.Errorf("unsupported field: %s", field)
	}
}

// Initialize 初始化插件
func (p *EmailPrefixPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = p.info.DefaultConfig
	return nil
}

// Cleanup 清理插件
func (p *EmailPrefixPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *EmailPrefixPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *EmailPrefixPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *EmailPrefixPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *EmailPrefixPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *EmailPrefixPlugin) GetDefaultConfig() map[string]interface{} {
	return p.info.DefaultConfig
}

// ValidateConfig 验证配置
func (p *EmailPrefixPlugin) ValidateConfig(config map[string]interface{}) error {
	// 验证前缀列表
	if prefixes, ok := config["prefixes"]; ok {
		if prefixList, ok := prefixes.([]interface{}); ok {
			for _, prefix := range prefixList {
				if _, ok := prefix.(string); !ok {
					return fmt.Errorf("前缀必须是字符串")
				}
			}
		} else {
			return fmt.Errorf("前缀必须是数组")
		}
	}

	// 验证匹配类型
	if matchType, ok := config["match_type"]; ok {
		if typeStr, ok := matchType.(string); ok {
			if typeStr != "from" && typeStr != "to" && typeStr != "both" {
				return fmt.Errorf("匹配类型必须是 'from', 'to', 或 'both'")
			}
		} else {
			return fmt.Errorf("匹配类型必须是字符串")
		}
	}

	// 验证匹配模式
	if mode, ok := config["match_mode"]; ok {
		if modeStr, ok := mode.(string); ok {
			if modeStr != "any" && modeStr != "all" {
				return fmt.Errorf("匹配模式必须是 'any' 或 'all'")
			}
		} else {
			return fmt.Errorf("匹配模式必须是字符串")
		}
	}

	return nil
}

// ApplyConfig 应用配置
func (p *EmailPrefixPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}

	for key, value := range config {
		p.config[key] = value
	}

	return nil
}

// HealthCheck 健康检查
func (p *EmailPrefixPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *EmailPrefixPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"evaluations": p.info.UsageCount,
		"last_used":   p.info.LastUsed,
		"status":      p.info.Status,
	}
}

// Evaluate 评估条件
func (p *EmailPrefixPlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	startTime := time.Now()

	// 更新使用统计
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	// 解析邮件事件数据 - 支持多种格式：
	// 1. 直接的 EmailEventData 格式
	// 2. 嵌套的 {"email": {...}} 格式（来自 condition_engine）
	// 优先使用 FromAddress/ToAddresses 字段（纯邮箱地址）
	var fromEmail, toEmail string

	// 首先尝试解析为嵌套格式 {"email": {...}}，包含新的 FromAddress 字段
	var eventWrapperV2 struct {
		Email struct {
			FromAddress string   `json:"FromAddress"` // 纯邮箱地址
			ToAddresses []string `json:"ToAddresses"` // 纯邮箱地址列表
			From        []string `json:"From"`        // 旧格式（包含显示名）
			To          []string `json:"To"`          // 旧格式（包含显示名）
		} `json:"email"`
	}
	if err := event.GetData(&eventWrapperV2); err == nil {
		// 优先使用新的纯邮箱地址字段
		if eventWrapperV2.Email.FromAddress != "" {
			fromEmail = eventWrapperV2.Email.FromAddress
		} else if len(eventWrapperV2.Email.From) > 0 {
			// 回退到旧格式，需要手动提取
			fromEmail = extractPrefixEmailAddress(eventWrapperV2.Email.From[0])
		}

		if len(eventWrapperV2.Email.ToAddresses) > 0 {
			toEmail = eventWrapperV2.Email.ToAddresses[0]
		} else if len(eventWrapperV2.Email.To) > 0 {
			// 回退到旧格式，需要手动提取
			toEmail = extractPrefixEmailAddress(eventWrapperV2.Email.To[0])
		}
	}

	// 如果还没有获取到地址，尝试其他格式
	if fromEmail == "" {
		var emailData models.EmailEventData
		if err := event.GetData(&emailData); err == nil && emailData.From != "" {
			fromEmail = extractPrefixEmailAddress(emailData.From)
			toEmail = extractPrefixEmailAddress(emailData.To)
		}
	}

	// 从 ctx.Config.Config 获取用户配置的条件（优先）
	conditions := p.config
	if ctx.Config != nil && ctx.Config.Config != nil {
		conditions = ctx.Config.Config
	}

	// 获取配置
	prefixes := p.getPrefixesFromConfig(conditions)
	matchType := p.getMatchTypeFromConfig(conditions)
	caseSensitive := p.getCaseSensitiveFromConfig(conditions)
	matchMode := p.getMatchModeFromConfig(conditions)

	// 如果没有配置前缀，返回 true（表示不过滤）
	if len(prefixes) == 0 {
		return &plugins.PluginResult{
			Success:       true,
			Data:          map[string]interface{}{"matched": true, "reason": "未配置前缀，默认通过"},
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 检查匹配
	matches := []bool{}
	reasons := []string{}

	switch matchType {
	case "from":
		matched := p.checkPrefixMatch(fromEmail, prefixes, caseSensitive, matchMode)
		matches = append(matches, matched)
		if matched {
			reasons = append(reasons, fmt.Sprintf("发件人前缀匹配: %s", fromEmail))
		} else {
			reasons = append(reasons, fmt.Sprintf("发件人前缀不匹配: %s", fromEmail))
		}
	case "to":
		matched := p.checkPrefixMatch(toEmail, prefixes, caseSensitive, matchMode)
		matches = append(matches, matched)
		if matched {
			reasons = append(reasons, fmt.Sprintf("收件人前缀匹配: %s", toEmail))
		} else {
			reasons = append(reasons, fmt.Sprintf("收件人前缀不匹配: %s", toEmail))
		}
	case "both":
		fromMatched := p.checkPrefixMatch(fromEmail, prefixes, caseSensitive, matchMode)
		toMatched := p.checkPrefixMatch(toEmail, prefixes, caseSensitive, matchMode)
		matches = append(matches, fromMatched || toMatched)
		if fromMatched {
			reasons = append(reasons, fmt.Sprintf("发件人前缀匹配: %s", fromEmail))
		}
		if toMatched {
			reasons = append(reasons, fmt.Sprintf("收件人前缀匹配: %s", toEmail))
		}
		if !fromMatched && !toMatched {
			reasons = append(reasons, fmt.Sprintf("发件人(%s)和收件人(%s)前缀均不匹配", fromEmail, toEmail))
		}
	}

	// 最终结果
	finalResult := len(matches) > 0 && matches[0]

	result := &plugins.PluginResult{
		Success: finalResult, // Success 表示是否匹配
		Data: map[string]interface{}{
			"matched":        finalResult,
			"reasons":        reasons,
			"match_type":     matchType,
			"match_mode":     matchMode,
			"prefixes":       prefixes,
			"case_sensitive": caseSensitive,
			"from_email":     fromEmail,
			"to_email":       toEmail,
		},
		ExecutionTime: time.Since(startTime),
		Timestamp:     time.Now(),
	}

	return result, nil
}

// GetDescription 获取描述
func (p *EmailPrefixPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *EmailPrefixPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(models.EventTypeEmailReceived),
		string(models.EventTypeEmailUpdated),
	}
}

// GetRequiredFields 获取必需字段
func (p *EmailPrefixPlugin) GetRequiredFields() []string {
	return []string{"from", "to"}
}

// 私有方法

// getPrefixes 获取前缀配置
func (p *EmailPrefixPlugin) getPrefixes() []string {
	return p.getPrefixesFromConfig(p.config)
}

// getPrefixesFromConfig 从指定配置获取前缀
func (p *EmailPrefixPlugin) getPrefixesFromConfig(config map[string]interface{}) []string {
	if prefixes, ok := config["prefixes"]; ok {
		switch v := prefixes.(type) {
		case []interface{}:
			result := make([]string, 0, len(v))
			for _, prefix := range v {
				if str, ok := prefix.(string); ok {
					trimmed := strings.TrimSpace(str)
					if trimmed != "" {
						result = append(result, trimmed)
					}
				}
			}
			return result
		case []string:
			result := make([]string, 0, len(v))
			for _, str := range v {
				trimmed := strings.TrimSpace(str)
				if trimmed != "" {
					result = append(result, trimmed)
				}
			}
			return result
		case string:
			// 处理字符串类型的输入（可能是逗号分隔的多个前缀）
			if v == "" {
				return []string{}
			}
			// 支持逗号、分号、换行符分隔
			parts := strings.FieldsFunc(v, func(r rune) bool {
				return r == ',' || r == ';' || r == '\n'
			})
			result := make([]string, 0, len(parts))
			for _, part := range parts {
				trimmed := strings.TrimSpace(part)
				if trimmed != "" {
					result = append(result, trimmed)
				}
			}
			return result
		}
	}
	return []string{}
}

// getMatchType 获取匹配类型配置
func (p *EmailPrefixPlugin) getMatchType() string {
	return p.getMatchTypeFromConfig(p.config)
}

// getMatchTypeFromConfig 从指定配置获取匹配类型
func (p *EmailPrefixPlugin) getMatchTypeFromConfig(config map[string]interface{}) string {
	if matchType, ok := config["match_type"]; ok {
		if str, ok := matchType.(string); ok {
			return str
		}
	}
	return "to" // 默认匹配收件人
}

// getCaseSensitive 获取大小写敏感配置
func (p *EmailPrefixPlugin) getCaseSensitive() bool {
	return p.getCaseSensitiveFromConfig(p.config)
}

// getCaseSensitiveFromConfig 从指定配置获取大小写敏感配置
func (p *EmailPrefixPlugin) getCaseSensitiveFromConfig(config map[string]interface{}) bool {
	if caseSensitive, ok := config["case_sensitive"]; ok {
		if b, ok := caseSensitive.(bool); ok {
			return b
		}
	}
	return false
}

// getMatchMode 获取匹配模式配置
func (p *EmailPrefixPlugin) getMatchMode() string {
	return p.getMatchModeFromConfig(p.config)
}

// getMatchModeFromConfig 从指定配置获取匹配模式
func (p *EmailPrefixPlugin) getMatchModeFromConfig(config map[string]interface{}) string {
	if mode, ok := config["match_mode"]; ok {
		if str, ok := mode.(string); ok {
			return str
		}
	}
	return "any"
}

// checkPrefixMatch 检查前缀匹配
func (p *EmailPrefixPlugin) checkPrefixMatch(email string, prefixes []string, caseSensitive bool, matchMode string) bool {
	if email == "" {
		return false
	}

	// 提取邮箱的本地部分（@之前的部分）
	localPart := email
	if atIndex := strings.Index(email, "@"); atIndex != -1 {
		localPart = email[:atIndex]
	}

	checkEmail := localPart
	if !caseSensitive {
		checkEmail = strings.ToLower(localPart)
	}

	matches := make([]bool, len(prefixes))
	for i, prefix := range prefixes {
		checkPrefix := prefix
		if !caseSensitive {
			checkPrefix = strings.ToLower(prefix)
		}

		matches[i] = strings.HasPrefix(checkEmail, checkPrefix)
	}

	// 根据匹配模式决定结果
	if matchMode == "all" {
		return p.allTrue(matches)
	} else {
		return p.anyTrue(matches)
	}
}

// allTrue 检查所有值是否为真
func (p *EmailPrefixPlugin) allTrue(values []bool) bool {
	for _, value := range values {
		if !value {
			return false
		}
	}
	return len(values) > 0
}

// anyTrue 检查是否有任何值为真
func (p *EmailPrefixPlugin) anyTrue(values []bool) bool {
	for _, value := range values {
		if value {
			return true
		}
	}
	return false
}

// extractPrefixEmailAddress 从 "Name <email@domain.com>" 格式中提取纯邮箱地址
func extractPrefixEmailAddress(address string) string {
	address = strings.TrimSpace(address)
	if address == "" {
		return ""
	}

	// 尝试从 "Name <email@domain.com>" 格式中提取
	if start := strings.Index(address, "<"); start != -1 {
		if end := strings.Index(address, ">"); end != -1 && end > start {
			return strings.TrimSpace(address[start+1 : end])
		}
	}

	// 如果没有尖括号，返回整个地址（可能已经是纯邮箱）
	return address
}
