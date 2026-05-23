package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"

	"golang.org/x/net/proxy"
)

// EmailAccountSetPlugin 邮箱账户集合筛选插件
type EmailAccountSetPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewEmailAccountSetPlugin 创建邮箱账户集合筛选插件
func NewEmailAccountSetPlugin() plugins.ConditionPlugin {
	return &EmailAccountSetPlugin{
		info: &plugins.PluginInfo{
			ID:          "email_account_set",
			Name:        "邮箱账户集合筛选",
			Version:     "1.0.0",
			Description: "筛选特定邮箱账户集合中的邮件",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"account_emails": map[string]interface{}{
						"type":        "array",
						"description": "邮箱账户列表",
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
					"api_endpoint": map[string]interface{}{
						"type":        "string",
						"description": "动态获取账户列表的API端点（可选）",
					},
					"api_headers": map[string]interface{}{
						"type":        "object",
						"description": "API请求头（可选）",
					},
				},
				"required": []string{"account_emails"},
			},
			DefaultConfig: map[string]interface{}{
				"account_emails": []string{},
				"match_type":     "from",
				"case_sensitive": false,
				"api_endpoint":   "",
				"api_headers":    map[string]interface{}{},
			},
			Dependencies: []string{},
			Permissions:  []string{plugins.PermissionRead, plugins.PermissionNetwork},
			Sandbox:      true,
			MinVersion:   "1.0.0",
			MaxVersion:   "",
		},
		config: make(map[string]interface{}),
	}
}

// GetInfo 获取插件信息
func (p *EmailAccountSetPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// GetUISchema 获取UI架构
func (p *EmailAccountSetPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:         "account_emails",
				Label:        "邮箱账户列表",
				Type:         plugins.UIFieldTypeMultiSelect,
				Description:  "要筛选的邮箱账户列表",
				Placeholder:  "输入邮箱地址",
				Tooltip:      "输入或从下拉列表选择要匹配的邮箱账户。支持手动输入任意邮箱地址。",
				Required:     true,
				Width:        "full",
				DefaultValue: []string{},
				OptionsAPI:   "/api/email-accounts",
			},
			{
				Name:         "match_type",
				Label:        "匹配类型",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "指定匹配邮件的发件人还是收件人",
				Tooltip:      "选择匹配邮件的发件人地址还是收件人地址。'发件人或收件人'表示任意一个匹配即可。",
				Required:     true,
				Width:        "half",
				DefaultValue: "to",
				Options: []plugins.UIOption{
					{Value: "from", Label: "发件人", Description: "匹配邮件发件人"},
					{Value: "to", Label: "收件人", Description: "匹配邮件收件人"},
					{Value: "both", Label: "发件人或收件人", Description: "匹配邮件发件人或收件人"},
				},
			},
			{
				Name:         "case_sensitive",
				Label:        "区分大小写",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否区分大小写进行匹配",
				Tooltip:      "开启后将严格区分邮箱地址的大小写。通常邮箱地址不区分大小写，建议保持关闭。",
				Required:     false,
				Width:        "half",
				DefaultValue: false,
			},
			{
				Name:        "api_endpoint",
				Label:       "外部API端点",
				Type:        plugins.UIFieldTypeText,
				Description: "从外部API动态获取账户列表（可选）",
				Placeholder: "例如：https://api.example.com/emails",
				Tooltip:     "配置外部API端点来动态获取邮箱账户列表。\n\nAPI要求：\n• 返回格式：JSON数组，例如 [\"email1@domain.com\", \"email2@domain.com\"]\n• 或者返回对象数组：[{\"email\": \"...\", \"name\": \"...\"}]\n• 支持 GET 请求\n\n如果同时配置了静态账户列表和API，两者的结果会合并。",
				Required:    false,
				Width:       "full",
			},
			{
				Name:        "api_proxy",
				Label:       "API代理",
				Type:        plugins.UIFieldTypeText,
				Description: "调用外部API时使用的代理（可选）",
				Placeholder: "例如：socks5://127.0.0.1:1080 或 http://proxy:8080",
				Tooltip:     "为保护服务器真实IP，可配置代理来调用外部API。\n\n支持的代理类型：\n• SOCKS5：socks5://host:port\n• SOCKS5认证：socks5://user:pass@host:port\n• HTTP代理：http://host:port\n• HTTPS代理：https://host:port",
				Required:    false,
				Width:       "full",
			},
			{
				Name:        "api_headers",
				Label:       "API请求头",
				Type:        plugins.UIFieldTypeJSON,
				Description: "调用外部API时附加的请求头（可选）",
				Placeholder: `{"Authorization": "Bearer token"}`,
				Tooltip:     "以JSON格式配置API请求头。常用于认证。\n\n示例：\n{\"Authorization\": \"Bearer your-token\", \"X-API-Key\": \"key\"}",
				Required:    false,
				Width:       "full",
			},
		},
		Operators: []plugins.UIOperator{
			{Value: "in", Label: "在列表中", ApplicableTo: []string{"multi_select"}},
			{Value: "not_in", Label: "不在列表中", ApplicableTo: []string{"multi_select"}},
		},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "根据邮箱账户集合筛选邮件。可以配置静态邮箱列表或从外部API动态获取。",
		Examples: []plugins.UIExample{
			{
				Title:       "筛选特定用户邮件",
				Description: "只显示发送给指定邮箱账户的邮件",
				Expression: map[string]interface{}{
					"account_emails": []string{"user1@example.com", "user2@example.com"},
					"match_type":     "to",
					"case_sensitive": false,
				},
			},
			{
				Title:       "从外部API获取账户列表",
				Description: "动态从API获取邮箱账户列表进行匹配",
				Expression: map[string]interface{}{
					"api_endpoint": "https://api.example.com/allowed-emails",
					"api_proxy":    "socks5://127.0.0.1:1080",
					"api_headers":  map[string]string{"Authorization": "Bearer token"},
					"match_type":   "to",
				},
			},
		},
	}
}

// GetDynamicOptions 获取动态选项
func (p *EmailAccountSetPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	switch field {
	case "account_emails":
		// 这里可以从API或数据库获取邮箱账户列表
		// 暂时返回示例数据
		options := []plugins.UIOption{
			{Value: "admin@example.com", Label: "管理员", Description: "系统管理员账户"},
			{Value: "support@example.com", Label: "支持", Description: "技术支持账户"},
			{Value: "noreply@example.com", Label: "无回复", Description: "系统通知账户"},
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
func (p *EmailAccountSetPlugin) ValidateFieldValue(field string, value interface{}) error {
	switch field {
	case "account_emails":
		if emails, ok := value.([]interface{}); ok {
			for _, email := range emails {
				if emailStr, ok := email.(string); ok {
					if !isValidEmail(emailStr) {
						return fmt.Errorf("invalid email format: %s", emailStr)
					}
				} else {
					return fmt.Errorf("email must be a string")
				}
			}
		} else {
			return fmt.Errorf("account_emails must be an array")
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
func (p *EmailAccountSetPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	switch field {
	case "account_emails":
		// 返回常见的邮箱账户建议
		suggestions := []string{
			"admin@example.com",
			"support@example.com",
			"noreply@example.com",
			"info@example.com",
			"sales@example.com",
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

// isValidEmail 验证邮箱格式
func isValidEmail(email string) bool {
	// 简单的邮箱格式验证
	if !strings.Contains(email, "@") {
		return false
	}
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return false
	}
	return len(parts[0]) > 0 && len(parts[1]) > 0 && strings.Contains(parts[1], ".")
}

// Initialize 初始化插件
func (p *EmailAccountSetPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = p.info.DefaultConfig
	return nil
}

// Cleanup 清理插件
func (p *EmailAccountSetPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *EmailAccountSetPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *EmailAccountSetPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *EmailAccountSetPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *EmailAccountSetPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *EmailAccountSetPlugin) GetDefaultConfig() map[string]interface{} {
	return p.info.DefaultConfig
}

// ValidateConfig 验证配置
func (p *EmailAccountSetPlugin) ValidateConfig(config map[string]interface{}) error {
	// 验证账户邮箱列表
	if emails, ok := config["account_emails"]; ok {
		if emailList, ok := emails.([]interface{}); ok {
			for _, email := range emailList {
				if _, ok := email.(string); !ok {
					return fmt.Errorf("邮箱账户必须是字符串")
				}
			}
		} else {
			return fmt.Errorf("邮箱账户必须是数组")
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

	return nil
}

// ApplyConfig 应用配置
func (p *EmailAccountSetPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}

	for key, value := range config {
		p.config[key] = value
	}

	return nil
}

// HealthCheck 健康检查
func (p *EmailAccountSetPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *EmailAccountSetPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"evaluations": p.info.UsageCount,
		"last_used":   p.info.LastUsed,
		"status":      p.info.Status,
	}
}

// Evaluate 评估条件
func (p *EmailAccountSetPlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	startTime := time.Now()

	// 更新使用统计
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	// 解析邮件事件数据 - 支持多种格式
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
			fromEmail = extractAccountSetEmail(eventWrapperV2.Email.From[0])
		}

		if len(eventWrapperV2.Email.ToAddresses) > 0 {
			toEmail = eventWrapperV2.Email.ToAddresses[0]
		} else if len(eventWrapperV2.Email.To) > 0 {
			toEmail = extractAccountSetEmail(eventWrapperV2.Email.To[0])
		}
	}

	// 如果还没有获取到地址，尝试其他格式
	if fromEmail == "" {
		var emailData models.EmailEventData
		if err := event.GetData(&emailData); err == nil && emailData.From != "" {
			fromEmail = extractAccountSetEmail(emailData.From)
			toEmail = extractAccountSetEmail(emailData.To)
		}
	}

	// 从 ctx.Config.Config 获取用户配置的条件（优先）
	conditions := p.config
	if ctx.Config != nil && ctx.Config.Config != nil {
		conditions = ctx.Config.Config
	}

	// 获取配置
	accountEmails := p.getAccountEmailsFromConfig(conditions)
	matchType := p.getMatchTypeFromConfig(conditions)
	caseSensitive := p.getCaseSensitiveFromConfig(conditions)

	// 从外部 API 获取邮箱列表（如果配置了）
	apiEndpoint := p.getAPIEndpoint(conditions)
	if apiEndpoint != "" {
		apiProxy := p.getAPIProxy(conditions)
		apiHeaders := p.getAPIHeaders(conditions)
		apiEmails, err := p.fetchEmailsFromAPI(apiEndpoint, apiProxy, apiHeaders)
		if err != nil {
			// API 调用失败，记录错误但继续使用静态列表
			// 可以考虑是否需要返回错误，这里选择继续
		} else if len(apiEmails) > 0 {
			// 合并 API 获取的邮箱和静态配置的邮箱
			accountEmails = append(accountEmails, apiEmails...)
		}
	}

	// 如果没有配置邮箱账户，返回 true（表示不过滤）
	if len(accountEmails) == 0 {
		return &plugins.PluginResult{
			Success:       true,
			Data:          map[string]interface{}{"matched": true, "reason": "未配置邮箱账户，默认通过"},
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 检查匹配
	matched := false
	reason := ""

	switch matchType {
	case "from":
		matched = p.checkEmailInSet(fromEmail, accountEmails, caseSensitive)
		if matched {
			reason = fmt.Sprintf("发件人 %s 在账户集合中", fromEmail)
		} else {
			reason = fmt.Sprintf("发件人 %s 不在账户集合中", fromEmail)
		}
	case "to":
		matched = p.checkEmailInSet(toEmail, accountEmails, caseSensitive)
		if matched {
			reason = fmt.Sprintf("收件人 %s 在账户集合中", toEmail)
		} else {
			reason = fmt.Sprintf("收件人 %s 不在账户集合中", toEmail)
		}
	case "both":
		fromMatched := p.checkEmailInSet(fromEmail, accountEmails, caseSensitive)
		toMatched := p.checkEmailInSet(toEmail, accountEmails, caseSensitive)
		matched = fromMatched || toMatched
		if fromMatched {
			reason = fmt.Sprintf("发件人 %s 在账户集合中", fromEmail)
		} else if toMatched {
			reason = fmt.Sprintf("收件人 %s 在账户集合中", toEmail)
		} else {
			reason = fmt.Sprintf("发件人 %s 和收件人 %s 都不在账户集合中", fromEmail, toEmail)
		}
	}

	result := &plugins.PluginResult{
		Success: matched, // Success 表示是否匹配
		Data: map[string]interface{}{
			"matched":        matched,
			"reason":         reason,
			"match_type":     matchType,
			"account_emails": accountEmails,
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
func (p *EmailAccountSetPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *EmailAccountSetPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(models.EventTypeEmailReceived),
		string(models.EventTypeEmailUpdated),
	}
}

// GetRequiredFields 获取必需字段
func (p *EmailAccountSetPlugin) GetRequiredFields() []string {
	return []string{"from", "to"}
}

// 私有方法

// getAccountEmails 获取账户邮箱配置
func (p *EmailAccountSetPlugin) getAccountEmails() []string {
	return p.getAccountEmailsFromConfig(p.config)
}

// getAccountEmailsFromConfig 从指定配置获取账户邮箱
func (p *EmailAccountSetPlugin) getAccountEmailsFromConfig(config map[string]interface{}) []string {
	if emails, ok := config["account_emails"]; ok {
		switch v := emails.(type) {
		case []interface{}:
			result := make([]string, 0, len(v))
			for _, email := range v {
				if str, ok := email.(string); ok {
					result = append(result, str)
				}
			}
			return result
		case []string:
			return v
		}
	}
	return []string{}
}

// getMatchType 获取匹配类型配置
func (p *EmailAccountSetPlugin) getMatchType() string {
	return p.getMatchTypeFromConfig(p.config)
}

// getMatchTypeFromConfig 从指定配置获取匹配类型
func (p *EmailAccountSetPlugin) getMatchTypeFromConfig(config map[string]interface{}) string {
	if matchType, ok := config["match_type"]; ok {
		if str, ok := matchType.(string); ok {
			return str
		}
	}
	return "to" // 默认匹配收件人
}

// getCaseSensitive 获取大小写敏感配置
func (p *EmailAccountSetPlugin) getCaseSensitive() bool {
	return p.getCaseSensitiveFromConfig(p.config)
}

// getCaseSensitiveFromConfig 从指定配置获取大小写敏感配置
func (p *EmailAccountSetPlugin) getCaseSensitiveFromConfig(config map[string]interface{}) bool {
	if caseSensitive, ok := config["case_sensitive"]; ok {
		if b, ok := caseSensitive.(bool); ok {
			return b
		}
	}
	return false
}

// checkEmailInSet 检查邮箱是否在集合中
func (p *EmailAccountSetPlugin) checkEmailInSet(email string, accountEmails []string, caseSensitive bool) bool {
	checkEmail := email
	if !caseSensitive {
		checkEmail = strings.ToLower(email)
	}

	for _, accountEmail := range accountEmails {
		compareEmail := accountEmail
		if !caseSensitive {
			compareEmail = strings.ToLower(accountEmail)
		}

		if checkEmail == compareEmail {
			return true
		}
	}

	return false
}

// extractAccountSetEmail 从 "Name <email@domain.com>" 格式中提取纯邮箱地址
func extractAccountSetEmail(address string) string {
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

// fetchEmailsFromAPI 从外部 API 获取邮箱列表，支持代理配置
func (p *EmailAccountSetPlugin) fetchEmailsFromAPI(endpoint, proxyURL string, headers map[string]interface{}) ([]string, error) {
	if endpoint == "" {
		return nil, nil
	}

	// 创建 HTTP 客户端
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 配置代理
	if proxyURL != "" {
		transport, err := createProxyTransport(proxyURL)
		if err != nil {
			return nil, fmt.Errorf("创建代理失败: %w", err)
		}
		client.Transport = transport
	}

	// 创建请求
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	// 添加请求头
	req.Header.Set("Accept", "application/json")
	for key, value := range headers {
		if strVal, ok := value.(string); ok {
			req.Header.Set(key, strVal)
		}
	}

	// 发送请求
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("API请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API返回错误状态码: %d", resp.StatusCode)
	}

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	// 解析响应 - 支持两种格式
	var emails []string

	// 尝试解析为字符串数组
	if err := json.Unmarshal(body, &emails); err == nil {
		return emails, nil
	}

	// 尝试解析为对象数组
	var emailObjects []map[string]interface{}
	if err := json.Unmarshal(body, &emailObjects); err == nil {
		for _, obj := range emailObjects {
			if email, ok := obj["email"].(string); ok {
				emails = append(emails, email)
			} else if email, ok := obj["address"].(string); ok {
				emails = append(emails, email)
			} else if email, ok := obj["value"].(string); ok {
				emails = append(emails, email)
			}
		}
		return emails, nil
	}

	return nil, fmt.Errorf("无法解析API响应")
}

// createProxyTransport 创建支持代理的 HTTP Transport
func createProxyTransport(proxyURL string) (*http.Transport, error) {
	parsedURL, err := url.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("解析代理URL失败: %w", err)
	}

	switch parsedURL.Scheme {
	case "socks5", "socks5h":
		// SOCKS5 代理
		auth := &proxy.Auth{}
		if parsedURL.User != nil {
			auth.User = parsedURL.User.Username()
			auth.Password, _ = parsedURL.User.Password()
		} else {
			auth = nil
		}

		dialer, err := proxy.SOCKS5("tcp", parsedURL.Host, auth, proxy.Direct)
		if err != nil {
			return nil, fmt.Errorf("创建SOCKS5代理失败: %w", err)
		}

		return &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.Dial(network, addr)
			},
		}, nil

	case "http", "https":
		// HTTP/HTTPS 代理
		return &http.Transport{
			Proxy: http.ProxyURL(parsedURL),
		}, nil

	default:
		return nil, fmt.Errorf("不支持的代理类型: %s", parsedURL.Scheme)
	}
}

// getAPIEndpoint 获取API端点配置
func (p *EmailAccountSetPlugin) getAPIEndpoint(config map[string]interface{}) string {
	if endpoint, ok := config["api_endpoint"]; ok {
		if str, ok := endpoint.(string); ok {
			return str
		}
	}
	return ""
}

// getAPIProxy 获取API代理配置
func (p *EmailAccountSetPlugin) getAPIProxy(config map[string]interface{}) string {
	if proxyURL, ok := config["api_proxy"]; ok {
		if str, ok := proxyURL.(string); ok {
			return str
		}
	}
	return ""
}

// getAPIHeaders 获取API请求头配置
func (p *EmailAccountSetPlugin) getAPIHeaders(config map[string]interface{}) map[string]interface{} {
	if headers, ok := config["api_headers"]; ok {
		if headersMap, ok := headers.(map[string]interface{}); ok {
			return headersMap
		}
	}
	return nil
}
