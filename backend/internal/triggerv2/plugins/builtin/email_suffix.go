package builtin

import (
	"fmt"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// EmailSuffixPlugin 邮箱后缀筛选插件
type EmailSuffixPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewEmailSuffixPlugin 创建邮箱后缀筛选插件
func NewEmailSuffixPlugin() plugins.ConditionPlugin {
	return &EmailSuffixPlugin{
		info: &plugins.PluginInfo{
			ID:          "email_suffix",
			Name:        "邮箱后缀筛选",
			Version:     "1.0.0",
			Description: "根据邮箱后缀（域名）筛选邮件",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"suffixes": map[string]interface{}{
						"type":        "array",
						"description": "邮箱后缀列表（如：gmail.com, outlook.com）",
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
						"description": "匹配模式: any（任一后缀匹配）, all（所有后缀匹配）",
						"default":     "any",
						"enum":        []string{"any", "all"},
					},
					"exact_match": map[string]interface{}{
						"type":        "boolean",
						"description": "是否精确匹配（true：完全匹配域名，false：支持子域名）",
						"default":     true,
					},
				},
				"required": []string{"suffixes"},
			},
			DefaultConfig: map[string]interface{}{
				"suffixes":       []string{},
				"match_type":     "from",
				"case_sensitive": false,
				"match_mode":     "any",
				"exact_match":    true,
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
func (p *EmailSuffixPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// GetUISchema 获取UI架构
func (p *EmailSuffixPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:         "suffixes",
				Label:        "邮箱后缀列表",
				Type:         plugins.UIFieldTypeMultiSelect,
				Description:  "要匹配的邮箱后缀（域名）列表",
				Placeholder:  "输入域名，如: example.com, company.org",
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
				Description:  "后缀匹配模式",
				Required:     true,
				Width:        "half",
				DefaultValue: "any",
				Options: []plugins.UIOption{
					{Value: "any", Label: "任一匹配", Description: "匹配任一后缀即可"},
					{Value: "all", Label: "全部匹配", Description: "必须匹配所有后缀"},
				},
			},
			{
				Name:         "exact_match",
				Label:        "精确匹配",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否精确匹配域名（不匹配子域名）",
				Required:     false,
				Width:        "half",
				DefaultValue: false,
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
			{Value: "ends_with", Label: "以...结尾", ApplicableTo: []string{"multi_select"}},
			{Value: "not_ends_with", Label: "不以...结尾", ApplicableTo: []string{"multi_select"}},
		},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "根据邮箱后缀（域名）筛选邮件",
		Examples: []plugins.UIExample{
			{
				Title:       "筛选内部邮件",
				Description: "只显示来自公司内部域名的邮件",
				Expression: map[string]interface{}{
					"suffixes":       []string{"company.com", "company.org"},
					"match_type":     "from",
					"match_mode":     "any",
					"exact_match":    false,
					"case_sensitive": false,
				},
			},
		},
	}
}

// GetDynamicOptions 获取动态选项
func (p *EmailSuffixPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	switch field {
	case "suffixes":
		// 返回常见的邮箱后缀选项
		options := []plugins.UIOption{
			{Value: "gmail.com", Label: "gmail.com", Description: "Gmail邮箱"},
			{Value: "outlook.com", Label: "outlook.com", Description: "Outlook邮箱"},
			{Value: "yahoo.com", Label: "yahoo.com", Description: "Yahoo邮箱"},
			{Value: "qq.com", Label: "qq.com", Description: "QQ邮箱"},
			{Value: "163.com", Label: "163.com", Description: "网易163邮箱"},
			{Value: "126.com", Label: "126.com", Description: "网易126邮箱"},
			{Value: "example.com", Label: "example.com", Description: "示例域名"},
			{Value: "company.com", Label: "company.com", Description: "公司域名"},
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
func (p *EmailSuffixPlugin) ValidateFieldValue(field string, value interface{}) error {
	switch field {
	case "suffixes":
		if suffixes, ok := value.([]interface{}); ok {
			for _, suffix := range suffixes {
				if suffixStr, ok := suffix.(string); ok {
					if len(suffixStr) == 0 {
						return fmt.Errorf("suffix cannot be empty")
					}
					if strings.Contains(suffixStr, "@") {
						return fmt.Errorf("suffix should not contain @ symbol")
					}
					if !strings.Contains(suffixStr, ".") {
						return fmt.Errorf("suffix should contain at least one dot")
					}
				} else {
					return fmt.Errorf("suffix must be a string")
				}
			}
		} else {
			return fmt.Errorf("suffixes must be an array")
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
	case "exact_match", "case_sensitive":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%s must be a boolean", field)
		}
	default:
		return fmt.Errorf("unsupported field: %s", field)
	}
	return nil
}

// GetFieldSuggestions 获取字段建议
func (p *EmailSuffixPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	switch field {
	case "suffixes":
		// 返回常见的邮箱后缀建议
		suggestions := []string{
			"gmail.com",
			"outlook.com",
			"yahoo.com",
			"qq.com",
			"163.com",
			"126.com",
			"hotmail.com",
			"sina.com",
			"sohu.com",
			"example.com",
			"company.com",
			"organization.org",
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
func (p *EmailSuffixPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = p.info.DefaultConfig
	return nil
}

// Cleanup 清理插件
func (p *EmailSuffixPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *EmailSuffixPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *EmailSuffixPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *EmailSuffixPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *EmailSuffixPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *EmailSuffixPlugin) GetDefaultConfig() map[string]interface{} {
	return p.info.DefaultConfig
}

// ValidateConfig 验证配置
func (p *EmailSuffixPlugin) ValidateConfig(config map[string]interface{}) error {
	// 验证后缀列表
	if suffixes, ok := config["suffixes"]; ok {
		if suffixList, ok := suffixes.([]interface{}); ok {
			for _, suffix := range suffixList {
				if _, ok := suffix.(string); !ok {
					return fmt.Errorf("后缀必须是字符串")
				}
			}
		} else {
			return fmt.Errorf("后缀必须是数组")
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
func (p *EmailSuffixPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}

	for key, value := range config {
		p.config[key] = value
	}

	return nil
}

// HealthCheck 健康检查
func (p *EmailSuffixPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *EmailSuffixPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"evaluations": p.info.UsageCount,
		"last_used":   p.info.LastUsed,
		"status":      p.info.Status,
	}
}

// Evaluate 评估条件
func (p *EmailSuffixPlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
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
			fromEmail = extractEmailAddress(eventWrapperV2.Email.From[0])
		}

		if len(eventWrapperV2.Email.ToAddresses) > 0 {
			toEmail = eventWrapperV2.Email.ToAddresses[0]
		} else if len(eventWrapperV2.Email.To) > 0 {
			// 回退到旧格式，需要手动提取
			toEmail = extractEmailAddress(eventWrapperV2.Email.To[0])
		}
	}

	// 如果还没有获取到地址，尝试其他格式
	if fromEmail == "" {
		var emailData models.EmailEventData
		if err := event.GetData(&emailData); err == nil && emailData.From != "" {
			fromEmail = extractEmailAddress(emailData.From)
			toEmail = extractEmailAddress(emailData.To)
		}
	}

	// 从 ctx.Config.Config 获取用户配置的条件（优先）
	conditions := p.config
	if ctx.Config != nil && ctx.Config.Config != nil {
		conditions = ctx.Config.Config
	}

	// 获取配置
	suffixes := p.getSuffixesFromConfig(conditions)
	matchType := p.getMatchTypeFromConfig(conditions)
	caseSensitive := p.getCaseSensitiveFromConfig(conditions)
	matchMode := p.getMatchModeFromConfig(conditions)
	exactMatch := p.getExactMatchFromConfig(conditions)

	// 如果没有配置后缀，返回 true（表示不过滤）
	if len(suffixes) == 0 {
		return &plugins.PluginResult{
			Success:       true,
			Data:          map[string]interface{}{"matched": true, "reason": "未配置后缀，默认通过"},
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 检查匹配
	matches := []bool{}
	reasons := []string{}

	switch matchType {
	case "from":
		matched := p.checkSuffixMatch(fromEmail, suffixes, caseSensitive, matchMode, exactMatch)
		matches = append(matches, matched)
		if matched {
			reasons = append(reasons, fmt.Sprintf("发件人后缀匹配: %s", fromEmail))
		} else {
			reasons = append(reasons, fmt.Sprintf("发件人后缀不匹配: %s", fromEmail))
		}
	case "to":
		matched := p.checkSuffixMatch(toEmail, suffixes, caseSensitive, matchMode, exactMatch)
		matches = append(matches, matched)
		if matched {
			reasons = append(reasons, fmt.Sprintf("收件人后缀匹配: %s", toEmail))
		} else {
			reasons = append(reasons, fmt.Sprintf("收件人后缀不匹配: %s", toEmail))
		}
	case "both":
		fromMatched := p.checkSuffixMatch(fromEmail, suffixes, caseSensitive, matchMode, exactMatch)
		toMatched := p.checkSuffixMatch(toEmail, suffixes, caseSensitive, matchMode, exactMatch)
		matches = append(matches, fromMatched || toMatched)
		if fromMatched {
			reasons = append(reasons, fmt.Sprintf("发件人后缀匹配: %s", fromEmail))
		}
		if toMatched {
			reasons = append(reasons, fmt.Sprintf("收件人后缀匹配: %s", toEmail))
		}
		if !fromMatched && !toMatched {
			reasons = append(reasons, fmt.Sprintf("发件人(%s)和收件人(%s)后缀均不匹配", fromEmail, toEmail))
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
			"suffixes":       suffixes,
			"case_sensitive": caseSensitive,
			"exact_match":    exactMatch,
			"from_email":     fromEmail,
			"to_email":       toEmail,
		},
		ExecutionTime: time.Since(startTime),
		Timestamp:     time.Now(),
	}

	return result, nil
}

// GetDescription 获取描述
func (p *EmailSuffixPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *EmailSuffixPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(models.EventTypeEmailReceived),
		string(models.EventTypeEmailUpdated),
	}
}

// GetRequiredFields 获取必需字段
func (p *EmailSuffixPlugin) GetRequiredFields() []string {
	return []string{"from", "to"}
}

// 私有方法

// getSuffixes 获取后缀配置
func (p *EmailSuffixPlugin) getSuffixes() []string {
	return p.getSuffixesFromConfig(p.config)
}

// getSuffixesFromConfig 从指定配置获取后缀
func (p *EmailSuffixPlugin) getSuffixesFromConfig(config map[string]interface{}) []string {
	if suffixes, ok := config["suffixes"]; ok {
		switch v := suffixes.(type) {
		case []interface{}:
			result := make([]string, 0, len(v))
			for _, suffix := range v {
				if str, ok := suffix.(string); ok {
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
			// 处理字符串类型的输入（可能是逗号分隔的多个后缀）
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
func (p *EmailSuffixPlugin) getMatchType() string {
	return p.getMatchTypeFromConfig(p.config)
}

// getMatchTypeFromConfig 从指定配置获取匹配类型
func (p *EmailSuffixPlugin) getMatchTypeFromConfig(config map[string]interface{}) string {
	if matchType, ok := config["match_type"]; ok {
		if str, ok := matchType.(string); ok {
			return str
		}
	}
	return "to" // 默认匹配收件人
}

// getCaseSensitive 获取大小写敏感配置
func (p *EmailSuffixPlugin) getCaseSensitive() bool {
	return p.getCaseSensitiveFromConfig(p.config)
}

// getCaseSensitiveFromConfig 从指定配置获取大小写敏感配置
func (p *EmailSuffixPlugin) getCaseSensitiveFromConfig(config map[string]interface{}) bool {
	if caseSensitive, ok := config["case_sensitive"]; ok {
		if b, ok := caseSensitive.(bool); ok {
			return b
		}
	}
	return false
}

// getMatchMode 获取匹配模式配置
func (p *EmailSuffixPlugin) getMatchMode() string {
	return p.getMatchModeFromConfig(p.config)
}

// getMatchModeFromConfig 从指定配置获取匹配模式
func (p *EmailSuffixPlugin) getMatchModeFromConfig(config map[string]interface{}) string {
	if mode, ok := config["match_mode"]; ok {
		if str, ok := mode.(string); ok {
			return str
		}
	}
	return "any"
}

// getExactMatch 获取精确匹配配置
func (p *EmailSuffixPlugin) getExactMatch() bool {
	return p.getExactMatchFromConfig(p.config)
}

// getExactMatchFromConfig 从指定配置获取精确匹配配置
func (p *EmailSuffixPlugin) getExactMatchFromConfig(config map[string]interface{}) bool {
	if exactMatch, ok := config["exact_match"]; ok {
		if b, ok := exactMatch.(bool); ok {
			return b
		}
	}
	return true
}

// checkSuffixMatch 检查后缀匹配
func (p *EmailSuffixPlugin) checkSuffixMatch(email string, suffixes []string, caseSensitive bool, matchMode string, exactMatch bool) bool {
	if email == "" {
		return false
	}

	// 提取邮箱的域名部分（@之后的部分）
	domain := ""
	if atIndex := strings.Index(email, "@"); atIndex != -1 && atIndex < len(email)-1 {
		domain = email[atIndex+1:]
	} else {
		return false
	}

	checkDomain := domain
	if !caseSensitive {
		checkDomain = strings.ToLower(domain)
	}

	matches := make([]bool, len(suffixes))
	for i, suffix := range suffixes {
		checkSuffix := suffix
		if !caseSensitive {
			checkSuffix = strings.ToLower(suffix)
		}

		if exactMatch {
			// 精确匹配域名
			matches[i] = checkDomain == checkSuffix
		} else {
			// 支持子域名匹配
			matches[i] = strings.HasSuffix(checkDomain, checkSuffix)
		}
	}

	// 根据匹配模式决定结果
	if matchMode == "all" {
		return p.allTrue(matches)
	} else {
		return p.anyTrue(matches)
	}
}

// allTrue 检查所有值是否为真
func (p *EmailSuffixPlugin) allTrue(values []bool) bool {
	for _, value := range values {
		if !value {
			return false
		}
	}
	return len(values) > 0
}

// anyTrue 检查是否有任何值为真
func (p *EmailSuffixPlugin) anyTrue(values []bool) bool {
	for _, value := range values {
		if value {
			return true
		}
	}
	return false
}

// extractEmailAddress 从 "Name <email@domain.com>" 格式中提取纯邮箱地址
func extractEmailAddress(address string) string {
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
