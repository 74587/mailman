package builtin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"text/template"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"

	"github.com/dop251/goja"
	"golang.org/x/net/proxy"
)

// TelegramBotActionPlugin Telegram Bot 动作插件
type TelegramBotActionPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// TelegramMessage Telegram 发送消息结构
type TelegramMessage struct {
	ChatID                   string `json:"chat_id"`
	Text                     string `json:"text"`
	ParseMode                string `json:"parse_mode,omitempty"`                  // HTML, Markdown, MarkdownV2
	DisableWebPagePreview    bool   `json:"disable_web_page_preview,omitempty"`    // 禁用链接预览
	DisableNotification      bool   `json:"disable_notification,omitempty"`        // 静默发送
	ProtectContent           bool   `json:"protect_content,omitempty"`             // 防止转发和保存
	ReplyToMessageID         int64  `json:"reply_to_message_id,omitempty"`         // 回复消息ID
	AllowSendingWithoutReply bool   `json:"allow_sending_without_reply,omitempty"` // 允许在回复消息不存在时发送
	MessageThreadID          int64  `json:"message_thread_id,omitempty"`           // 话题ID（群组专用）
}

// TelegramResponse Telegram API 响应结构
type TelegramResponse struct {
	OK          bool            `json:"ok"`
	Result      json.RawMessage `json:"result,omitempty"`
	ErrorCode   int             `json:"error_code,omitempty"`
	Description string          `json:"description,omitempty"`
}

// NewTelegramBotActionPlugin 创建 Telegram Bot 动作插件
func NewTelegramBotActionPlugin() plugins.ActionPlugin {
	return &TelegramBotActionPlugin{
		info: &plugins.PluginInfo{
			ID:          "telegram_bot_action",
			Name:        "Telegram Bot 通知",
			Version:     "1.0.0",
			Description: "通过 Telegram Bot 发送消息通知",
			Author:      "TriggerV2 Team",
			Website:     "https://core.telegram.org/bots/api",
			License:     "MIT",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"bot_token": map[string]interface{}{
						"type":        "string",
						"description": "Telegram Bot Token",
					},
					"chat_id": map[string]interface{}{
						"type":        "string",
						"description": "目标 Chat ID（用户/群组/频道）",
					},
					"message_template": map[string]interface{}{
						"type":        "string",
						"description": "消息模板（Go Template 格式）",
					},
					"parse_mode": map[string]interface{}{
						"type":        "string",
						"description": "消息格式: HTML, Markdown, MarkdownV2",
						"enum":        []string{"", "HTML", "Markdown", "MarkdownV2"},
					},
					"auto_escape": map[string]interface{}{
						"type":        "boolean",
						"description": "自动转义特殊字符，根据parse_mode格式化内容",
					},
					"preserve_formatting": map[string]interface{}{
						"type":        "boolean",
						"description": "保留TG支持的格式字符(*_~`||)，仅转义其他特殊字符",
					},
					"disable_preview": map[string]interface{}{
						"type":        "boolean",
						"description": "禁用链接预览",
					},
					"silent": map[string]interface{}{
						"type":        "boolean",
						"description": "静默发送（不产生通知）",
					},
					"protect_content": map[string]interface{}{
						"type":        "boolean",
						"description": "保护内容（禁止转发和保存）",
					},
					"thread_id": map[string]interface{}{
						"type":        "integer",
						"description": "话题 ID（群组专用）",
					},
					"proxy_enabled": map[string]interface{}{
						"type":        "boolean",
						"description": "启用代理",
					},
					"proxy_type": map[string]interface{}{
						"type":        "string",
						"description": "代理类型: http, socks5",
						"enum":        []string{"http", "socks5"},
					},
					"proxy_host": map[string]interface{}{
						"type":        "string",
						"description": "代理服务器地址",
					},
					"proxy_port": map[string]interface{}{
						"type":        "integer",
						"description": "代理服务器端口",
					},
					"proxy_username": map[string]interface{}{
						"type":        "string",
						"description": "代理用户名（可选）",
					},
					"proxy_password": map[string]interface{}{
						"type":        "string",
						"description": "代理密码（可选）",
					},
					"timeout": map[string]interface{}{
						"type":        "integer",
						"description": "请求超时时间（秒）",
						"default":     30,
					},
				},
				"required": []string{"bot_token", "chat_id"},
			},
			DefaultConfig: map[string]interface{}{
				"bot_token":           "",
				"chat_id":             "",
				"template_engine":     "javascript",
				"message_template":    `"📧 新邮件通知\n\n主题: " + Subject + "\n发件人: " + From + "\n收件人: " + To`,
				"parse_mode":          "none",
				"auto_escape":         true,
				"preserve_formatting": true,
				"disable_preview":     false,
				"silent":              false,
				"protect_content":     false,
				"thread_id":           0,
				"proxy_enabled":       false,
				"proxy_type":          "http",
				"proxy_host":          "",
				"proxy_port":          0,
				"proxy_username":      "",
				"proxy_password":      "",
				"timeout":             30,
			},
			Dependencies: []string{},
			Permissions:  []string{plugins.PermissionNetwork},
			Sandbox:      true,
			MinVersion:   "1.0.0",
			MaxVersion:   "",
		},
		config: make(map[string]interface{}),
	}
}

// GetInfo 获取插件信息
func (p *TelegramBotActionPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize 初始化插件
func (p *TelegramBotActionPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = p.info.DefaultConfig
	return nil
}

// Cleanup 清理插件
func (p *TelegramBotActionPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *TelegramBotActionPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *TelegramBotActionPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *TelegramBotActionPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *TelegramBotActionPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *TelegramBotActionPlugin) GetDefaultConfig() map[string]interface{} {
	return p.info.DefaultConfig
}

// ValidateConfig 验证配置
func (p *TelegramBotActionPlugin) ValidateConfig(config map[string]interface{}) error {
	// 验证 Bot Token
	if token, ok := config["bot_token"]; ok {
		if str, ok := token.(string); ok {
			if str == "" {
				return fmt.Errorf("Bot Token 不能为空")
			}
			// 验证 Token 格式 (通常是数字:字母数字)
			if !strings.Contains(str, ":") {
				return fmt.Errorf("无效的 Bot Token 格式")
			}
		} else {
			return fmt.Errorf("Bot Token 必须是字符串")
		}
	} else {
		return fmt.Errorf("Bot Token 是必需的")
	}

	// 验证 Chat ID
	if chatID, ok := config["chat_id"]; ok {
		if str, ok := chatID.(string); ok {
			if str == "" {
				return fmt.Errorf("Chat ID 不能为空")
			}
		} else {
			return fmt.Errorf("Chat ID 必须是字符串")
		}
	} else {
		return fmt.Errorf("Chat ID 是必需的")
	}

	// 验证代理配置
	if proxyEnabled, ok := config["proxy_enabled"]; ok {
		if enabled, ok := proxyEnabled.(bool); ok && enabled {
			if proxyHost, ok := config["proxy_host"]; ok {
				if str, ok := proxyHost.(string); !ok || str == "" {
					return fmt.Errorf("启用代理时必须提供代理地址")
				}
			} else {
				return fmt.Errorf("启用代理时必须提供代理地址")
			}
			if proxyPort, ok := config["proxy_port"]; ok {
				switch v := proxyPort.(type) {
				case int:
					if v <= 0 || v > 65535 {
						return fmt.Errorf("代理端口必须在 1-65535 之间")
					}
				case float64:
					if v <= 0 || v > 65535 {
						return fmt.Errorf("代理端口必须在 1-65535 之间")
					}
				default:
					return fmt.Errorf("代理端口必须是数字")
				}
			} else {
				return fmt.Errorf("启用代理时必须提供代理端口")
			}
		}
	}

	return nil
}

// ApplyConfig 应用配置
func (p *TelegramBotActionPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}

	for key, value := range config {
		p.config[key] = value
	}

	return nil
}

// HealthCheck 健康检查
func (p *TelegramBotActionPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *TelegramBotActionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"executions": p.info.UsageCount,
		"last_used":  p.info.LastUsed,
		"status":     p.info.Status,
	}
}

// Execute 执行动作
func (p *TelegramBotActionPlugin) Execute(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	startTime := time.Now()

	// 更新使用统计
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	// 解析邮件事件数据
	var emailData models.EmailEventData
	if err := event.GetData(&emailData); err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("解析邮件数据失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 获取配置
	botToken := p.getStringConfig("bot_token")
	chatID := p.getStringConfig("chat_id")
	templateEngine := p.getStringConfig("template_engine")
	if templateEngine == "" {
		templateEngine = "javascript" // 默认使用 JavaScript
	}
	messageTemplate := p.getStringConfig("message_template")
	parseMode := p.getStringConfig("parse_mode")
	parseModeForEscape := parseMode // 保存原始值用于转义
	// "none" 表示纯文本，需要转换为空字符串给 Telegram API
	if parseMode == "none" {
		parseMode = ""
	}
	autoEscape := p.getBoolConfig("auto_escape")
	disablePreview := p.getBoolConfig("disable_preview")
	silent := p.getBoolConfig("silent")
	protectContent := p.getBoolConfig("protect_content")
	threadID := p.getIntConfig("thread_id")
	timeout := p.getIntConfig("timeout")
	if timeout <= 0 {
		timeout = 30
	}

	// 渲染消息模板，传递 event 以支持变量
	message, err := p.renderTemplate(templateEngine, messageTemplate, emailData, event)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("渲染消息模板失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 如果启用了自动转义，根据 parse_mode 转义特殊字符
	if autoEscape && parseModeForEscape != "" && parseModeForEscape != "none" {
		preserveFormatting := p.getBoolConfig("preserve_formatting")
		if preserveFormatting && parseModeForEscape == "MarkdownV2" {
			message = escapeMarkdownV2PreserveFormatting(message)
			log.Printf("[TelegramBot] Auto-escaped message for %s mode (preserving formatting chars)", parseModeForEscape)
		} else {
			message = escapeForParseMode(message, parseModeForEscape)
			log.Printf("[TelegramBot] Auto-escaped message for %s mode", parseModeForEscape)
		}
	}

	// 构建 Telegram 消息
	telegramMsg := TelegramMessage{
		ChatID:                chatID,
		Text:                  message,
		ParseMode:             parseMode,
		DisableWebPagePreview: disablePreview,
		DisableNotification:   silent,
		ProtectContent:        protectContent,
	}
	if threadID > 0 {
		telegramMsg.MessageThreadID = int64(threadID)
	}

	// 创建 HTTP 客户端
	client, err := p.createHTTPClient(timeout)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("创建 HTTP 客户端失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 发送消息
	response, err := p.sendMessage(client, botToken, telegramMsg)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("发送 Telegram 消息失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	if !response.OK {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("Telegram API 错误 [%d]: %s", response.ErrorCode, response.Description),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	result := &plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"chat_id":        chatID,
			"message_length": len(message),
			"sent_at":        time.Now().Format(time.RFC3339),
			"parse_mode":     parseMode,
			"silent":         silent,
		},
		ExecutionTime: time.Since(startTime),
		Timestamp:     time.Now(),
	}

	return result, nil
}

// renderTemplate 渲染消息模板，支持 JavaScript 和 Go Template 两种引擎
func (p *TelegramBotActionPlugin) renderTemplate(engine string, tmplStr string, emailData models.EmailEventData, event *models.Event) (string, error) {
	if tmplStr == "" {
		// 默认模板
		if engine == "javascript" {
			tmplStr = `"📧 新邮件通知\n\n主题: " + Subject + "\n发件人: " + From + "\n收件人: " + To`
		} else {
			tmplStr = "📧 新邮件通知\n\n主题: {{.Subject}}\n发件人: {{.From}}\n收件人: {{.To}}"
		}
	}

	switch engine {
	case "javascript":
		return p.renderJavaScriptTemplate(tmplStr, emailData, event)
	case "gotemplate":
		return p.renderGoTemplate(tmplStr, emailData, event)
	default:
		// 默认使用 JavaScript
		return p.renderJavaScriptTemplate(tmplStr, emailData, event)
	}
}

// renderJavaScriptTemplate 使用 JavaScript 引擎渲染模板
func (p *TelegramBotActionPlugin) renderJavaScriptTemplate(script string, emailData models.EmailEventData, event *models.Event) (string, error) {
	vm := goja.New()

	// 调试：记录 event 变量情况
	if event != nil {
		vars := event.GetAllVariables()
		log.Printf("[TelegramBot] Event variables count: %d", len(vars))
		for k, v := range vars {
			vStr := fmt.Sprintf("%v", v)
			if len(vStr) > 100 {
				vStr = vStr[:100] + "..."
			}
			log.Printf("[TelegramBot] Variable $.%s = %s (type: %T)", k, vStr, v)
		}
		// 特别检查 ai_response
		if aiResp, exists := vars["ai_response"]; exists {
			aiRespStr := fmt.Sprintf("%v", aiResp)
			if len(aiRespStr) > 200 {
				aiRespStr = aiRespStr[:200] + "..."
			}
			log.Printf("[TelegramBot] Found ai_response: %s", aiRespStr)
		} else {
			log.Printf("[TelegramBot] WARNING: ai_response not found in variables!")
		}
	} else {
		log.Printf("[TelegramBot] Event is nil!")
	}

	// 设置超时保护（5秒）
	time.AfterFunc(5*time.Second, func() {
		vm.Interrupt("execution timeout")
	})

	// 设置邮件数据变量（直接变量名）
	vm.Set("Subject", emailData.Subject)
	vm.Set("From", emailData.From)
	vm.Set("To", emailData.To)
	vm.Set("EmailID", emailData.EmailID)
	vm.Set("AccountID", emailData.AccountID)
	vm.Set("MessageID", emailData.MessageID)
	vm.Set("ReceivedAt", emailData.ReceivedAt.Format("2006-01-02 15:04:05"))
	vm.Set("HasAttachment", emailData.HasAttachment)
	vm.Set("Labels", emailData.Labels)
	vm.Set("IsRead", emailData.IsRead)

	// 设置完整的 email 对象以便访问更多字段
	emailContext := map[string]interface{}{
		"Subject":       emailData.Subject,
		"From":          emailData.From,
		"To":            emailData.To,
		"EmailID":       emailData.EmailID,
		"AccountID":     emailData.AccountID,
		"MessageID":     emailData.MessageID,
		"ReceivedAt":    emailData.ReceivedAt.Format("2006-01-02 15:04:05"),
		"HasAttachment": emailData.HasAttachment,
		"Labels":        emailData.Labels,
		"IsRead":        emailData.IsRead,
	}
	if emailData.Email != nil {
		emailContext["Body"] = emailData.Email.Body
		emailContext["TextBody"] = emailData.Email.TextBody
		emailContext["HTMLBody"] = emailData.Email.HTMLBody
		emailContext["Cc"] = emailData.Email.Cc
		emailContext["Bcc"] = emailData.Email.Bcc
		emailContext["Size"] = emailData.Email.Size
		// 添加纯邮箱地址字段（用于模板中访问 $.ToAddresses 等）
		emailContext["FromAddress"] = emailData.Email.FromAddress
		emailContext["ToAddresses"] = emailData.Email.ToAddresses
		emailContext["CcAddresses"] = emailData.Email.CcAddresses
		emailContext["BccAddresses"] = emailData.Email.BccAddresses
		emailContext["Date"] = emailData.Email.Date.Format("2006-01-02 15:04:05")
		emailContext["MailboxName"] = emailData.Email.MailboxName
		emailContext["HasAttachments"] = emailData.Email.HasAttachments
	}

	// 将 Event 变量展开到 emailContext 中，支持 $.变量名 访问
	if event != nil {
		variables := event.GetAllVariables()
		for key, value := range variables {
			// 跳过特殊变量 "_" (上一个动作的输出)
			if key != "_" {
				emailContext[key] = value
			}
		}
	}

	vm.Set("email", emailContext)
	vm.Set("$", emailContext)

	// 设置 $var 对象（Event 变量池）- 支持链式动作传递的变量
	if event != nil {
		vm.Set("$var", event.GetAllVariables())
		// 设置 $_ 特殊变量（上一个动作的输出）
		if lastOutput, exists := event.GetVariable("_"); exists {
			vm.Set("$_", lastOutput)
		}
		// 设置 $step 变量（按索引访问步骤结果）
		if stepArray, exists := event.GetVariable("step"); exists {
			vm.Set("$step", stepArray)
		} else {
			vm.Set("$step", []interface{}{})
		}
	} else {
		vm.Set("$var", map[string]interface{}{})
		vm.Set("$step", []interface{}{})
	}

	// 设置辅助函数
	vm.Set("lower", func(s string) string { return strings.ToLower(s) })
	vm.Set("upper", func(s string) string { return strings.ToUpper(s) })
	vm.Set("trim", func(s string) string { return strings.TrimSpace(s) })
	vm.Set("contains", func(s, substr string) bool { return strings.Contains(s, substr) })
	vm.Set("hasPrefix", func(s, prefix string) bool { return strings.HasPrefix(s, prefix) })
	vm.Set("hasSuffix", func(s, suffix string) bool { return strings.HasSuffix(s, suffix) })
	vm.Set("replace", func(s, old, new string) string { return strings.ReplaceAll(s, old, new) })
	vm.Set("now", time.Now().Format("2006-01-02 15:04:05"))

	// 设置 console.log（用于调试，实际不输出）
	vm.Set("console", map[string]interface{}{
		"log": func(args ...interface{}) {},
	})

	// 执行脚本
	result, err := vm.RunString(script)
	if err != nil {
		if strings.Contains(err.Error(), "timeout") {
			return "", fmt.Errorf("执行超时")
		}
		return "", fmt.Errorf("执行失败: %v", err)
	}

	// 转换结果为字符串
	if result == nil || goja.IsUndefined(result) || goja.IsNull(result) {
		return "", nil
	}

	return result.String(), nil
}

// renderGoTemplate 使用 Go Template 引擎渲染模板
func (p *TelegramBotActionPlugin) renderGoTemplate(tmplStr string, emailData models.EmailEventData, event *models.Event) (string, error) {
	tmpl, err := template.New("message").Parse(tmplStr)
	if err != nil {
		return "", fmt.Errorf("解析模板失败: %v", err)
	}

	// 创建模板数据，包含邮件数据和变量
	templateData := map[string]interface{}{
		"Subject":       emailData.Subject,
		"From":          emailData.From,
		"To":            emailData.To,
		"EmailID":       emailData.EmailID,
		"AccountID":     emailData.AccountID,
		"MessageID":     emailData.MessageID,
		"ReceivedAt":    emailData.ReceivedAt.Format("2006-01-02 15:04:05"),
		"HasAttachment": emailData.HasAttachment,
		"Labels":        emailData.Labels,
		"IsRead":        emailData.IsRead,
	}
	if emailData.Email != nil {
		templateData["Body"] = emailData.Email.Body
		templateData["TextBody"] = emailData.Email.TextBody
		templateData["HTMLBody"] = emailData.Email.HTMLBody
	}
	// 添加 Event 变量
	if event != nil {
		for key, value := range event.GetAllVariables() {
			if key != "_" {
				templateData[key] = value
			}
		}
		templateData["Var"] = event.GetAllVariables()
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, templateData); err != nil {
		return "", fmt.Errorf("执行模板失败: %v", err)
	}

	return buf.String(), nil
}

// createHTTPClient 创建 HTTP 客户端（支持代理）
func (p *TelegramBotActionPlugin) createHTTPClient(timeout int) (*http.Client, error) {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   time.Duration(timeout) * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	proxyEnabled := p.getBoolConfig("proxy_enabled")
	if proxyEnabled {
		proxyType := p.getStringConfig("proxy_type")
		proxyHost := p.getStringConfig("proxy_host")
		proxyPort := p.getIntConfig("proxy_port")
		proxyUsername := p.getStringConfig("proxy_username")
		proxyPassword := p.getStringConfig("proxy_password")

		proxyAddr := fmt.Sprintf("%s:%d", proxyHost, proxyPort)

		switch proxyType {
		case "http", "https":
			proxyURL := &url.URL{
				Scheme: "http",
				Host:   proxyAddr,
			}
			if proxyUsername != "" {
				proxyURL.User = url.UserPassword(proxyUsername, proxyPassword)
			}
			transport.Proxy = http.ProxyURL(proxyURL)

		case "socks5":
			var auth *proxy.Auth
			if proxyUsername != "" {
				auth = &proxy.Auth{
					User:     proxyUsername,
					Password: proxyPassword,
				}
			}
			dialer, err := proxy.SOCKS5("tcp", proxyAddr, auth, proxy.Direct)
			if err != nil {
				return nil, fmt.Errorf("创建 SOCKS5 代理失败: %v", err)
			}
			transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
				return dialer.Dial(network, addr)
			}
		}
	}

	return &http.Client{
		Transport: transport,
		Timeout:   time.Duration(timeout) * time.Second,
	}, nil
}

// sendMessage 发送 Telegram 消息
func (p *TelegramBotActionPlugin) sendMessage(client *http.Client, botToken string, msg TelegramMessage) (*TelegramResponse, error) {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)

	jsonData, err := json.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("序列化消息失败: %v", err)
	}

	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	var telegramResp TelegramResponse
	if err := json.Unmarshal(body, &telegramResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %v", err)
	}

	return &telegramResp, nil
}

// 配置获取辅助方法
func (p *TelegramBotActionPlugin) getStringConfig(key string) string {
	if val, ok := p.config[key]; ok {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

func (p *TelegramBotActionPlugin) getBoolConfig(key string) bool {
	if val, ok := p.config[key]; ok {
		if b, ok := val.(bool); ok {
			return b
		}
	}
	return false
}

func (p *TelegramBotActionPlugin) getIntConfig(key string) int {
	if val, ok := p.config[key]; ok {
		switch v := val.(type) {
		case int:
			return v
		case float64:
			return int(v)
		case int64:
			return int(v)
		}
	}
	return 0
}

// GetDescription 获取描述
func (p *TelegramBotActionPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *TelegramBotActionPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(models.EventTypeEmailReceived),
		string(models.EventTypeEmailUpdated),
	}
}

// GetRequiredConfig 获取必需配置
func (p *TelegramBotActionPlugin) GetRequiredConfig() []string {
	return []string{"bot_token", "chat_id"}
}

// CanExecute 检查是否可以执行
func (p *TelegramBotActionPlugin) CanExecute(ctx *plugins.PluginContext, event *models.Event) bool {
	supportedTypes := p.GetSupportedEventTypes()
	for _, supportedType := range supportedTypes {
		if string(event.Type) == supportedType {
			return true
		}
	}
	return false
}

// GetExecutionOrder 获取执行顺序
func (p *TelegramBotActionPlugin) GetExecutionOrder() int {
	return 300 // 较低优先级（通知类动作通常后执行）
}

// GetUISchema 获取UI架构
func (p *TelegramBotActionPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			// === Bot 配置组 ===
			{
				Name:        "bot_token",
				Label:       "Bot Token",
				Type:        plugins.UIFieldTypeText,
				Description: "Telegram Bot 的 Token，从 @BotFather 获取",
				Placeholder: "123456789:AABBccDDeeFFggHHiiJJkkLLmmNNooPPqq",
				Required:    true,
				Width:       "full",
			},
			{
				Name:        "chat_id",
				Label:       "Chat ID",
				Type:        plugins.UIFieldTypeText,
				Description: "目标 Chat ID，可以是用户、群组或频道 ID。使用 @username 格式发送到公开群组/频道",
				Placeholder: "123456789 或 @channel_name",
				Required:    true,
				Width:       "1/2",
			},
			{
				Name:         "thread_id",
				Label:        "话题 ID",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "群组话题的 ID（仅对开启话题的群组有效）",
				Placeholder:  "0",
				Required:     false,
				Width:        "1/2",
				DefaultValue: 0,
			},

			// === 消息配置组 ===
			{
				Name:         "template_engine",
				Label:        "模板引擎",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "选择消息模板的解析引擎",
				Required:     false,
				Width:        "1/3",
				DefaultValue: "javascript",
				Options: []plugins.UIOption{
					{Value: "javascript", Label: "JavaScript (推荐)"},
					{Value: "gotemplate", Label: "Go Template"},
				},
				Tooltip: "JavaScript 更易使用，Go Template 更适合复杂的条件逻辑",
			},
			{
				Name:         "message_template",
				Label:        "消息模板",
				Type:         plugins.UIFieldTypeJavaScript,
				Description:  "消息内容模板。JavaScript模式下可用变量: Subject, From, To, ReceivedAt, EmailID, HasAttachment 等",
				Placeholder:  `"📧 新邮件: " + Subject + "\n发件人: " + From`,
				Required:     false,
				Width:        "full",
				DefaultValue: `"📧 新邮件通知\n\n主题: " + Subject + "\n发件人: " + From + "\n收件人: " + To`,
				Tooltip:      "JavaScript: 使用 + 拼接字符串，直接使用变量名。Go Template: 使用 {{.Subject}} 格式",
			},
			{
				Name:         "parse_mode",
				Label:        "消息格式",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "消息解析模式，支持 HTML 和 Markdown 格式",
				Required:     false,
				Width:        "1/3",
				DefaultValue: "none",
				Options: []plugins.UIOption{
					{Value: "none", Label: "纯文本"},
					{Value: "HTML", Label: "HTML"},
					{Value: "Markdown", Label: "Markdown"},
					{Value: "MarkdownV2", Label: "Markdown V2"},
				},
			},
			{
				Name:         "auto_escape",
				Label:        "自动转义",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "自动转义特殊字符，避免格式解析错误",
				Required:     false,
				Width:        "1/3",
				DefaultValue: true,
				Tooltip:      "开启后，消息内容中的特殊字符（如 - * _ 等）会根据消息格式自动转义",
				ShowIf: map[string]interface{}{
					"parse_mode": []string{"HTML", "Markdown", "MarkdownV2"},
				},
			},
			{
				Name:         "preserve_formatting",
				Label:        "保留TG格式字符",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "保留 * _ ~ ` || 等格式字符，仅转义其他特殊字符",
				Required:     false,
				Width:        "1/3",
				DefaultValue: true,
				Tooltip:      "开启后，会保留用于格式化的字符（粗体/*、斜体/_、删除线/~等），同时转义其他特殊字符",
				ShowIf: map[string]interface{}{
					"auto_escape": true,
					"parse_mode":  []string{"MarkdownV2"},
				},
			},
			{

				Name:         "disable_preview",
				Label:        "禁用链接预览",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "禁用消息中链接的预览",
				Required:     false,
				Width:        "1/3",
				DefaultValue: false,
			},
			{
				Name:         "silent",
				Label:        "静默发送",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "发送时不触发通知提醒",
				Required:     false,
				Width:        "1/3",
				DefaultValue: false,
			},
			{
				Name:         "protect_content",
				Label:        "保护内容",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "禁止转发和保存消息内容",
				Required:     false,
				Width:        "1/2",
				DefaultValue: false,
			},

			// === 代理配置组 ===
			{
				Name:         "proxy_enabled",
				Label:        "启用代理",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否通过代理服务器连接 Telegram",
				Required:     false,
				Width:        "full",
				DefaultValue: false,
				Tooltip:      "开启后可通过 HTTP 或 SOCKS5 代理连接 Telegram API",
			},
			{
				Name:         "proxy_type",
				Label:        "代理类型",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "代理服务器类型",
				Required:     false,
				Width:        "1/3",
				DefaultValue: "http",
				Options: []plugins.UIOption{
					{Value: "http", Label: "HTTP/HTTPS"},
					{Value: "socks5", Label: "SOCKS5"},
				},
				ShowIf: map[string]interface{}{
					"proxy_enabled": true,
				},
			},
			{
				Name:        "proxy_host",
				Label:       "代理地址",
				Type:        plugins.UIFieldTypeText,
				Description: "代理服务器地址",
				Placeholder: "127.0.0.1 或 proxy.example.com",
				Required:    false,
				Width:       "1/3",
				ShowIf: map[string]interface{}{
					"proxy_enabled": true,
				},
			},
			{
				Name:        "proxy_port",
				Label:       "代理端口",
				Type:        plugins.UIFieldTypeNumber,
				Description: "代理服务器端口",
				Placeholder: "1080",
				Required:    false,
				Width:       "1/3",
				Min:         Float64Ptr(1),
				Max:         Float64Ptr(65535),
				ShowIf: map[string]interface{}{
					"proxy_enabled": true,
				},
			},
			{
				Name:        "proxy_username",
				Label:       "代理用户名",
				Type:        plugins.UIFieldTypeText,
				Description: "代理服务器用户名（可选）",
				Required:    false,
				Width:       "1/2",
				ShowIf: map[string]interface{}{
					"proxy_enabled": true,
				},
			},
			{
				Name:        "proxy_password",
				Label:       "代理密码",
				Type:        plugins.UIFieldTypeText,
				Description: "代理服务器密码（可选）",
				Required:    false,
				Width:       "1/2",
				ShowIf: map[string]interface{}{
					"proxy_enabled": true,
				},
			},

			// === 高级配置组 ===
			{
				Name:         "timeout",
				Label:        "超时时间",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "API 请求超时时间（秒）",
				Required:     false,
				Width:        "1/2",
				DefaultValue: 30,
				Min:          Float64Ptr(5),
				Max:          Float64Ptr(120),
			},
		},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      false,
		MaxNestingLevel:   0,
		HelpText:          "配置 Telegram Bot 发送消息通知。需要先通过 @BotFather 创建 Bot 并获取 Token。",
		Examples: []plugins.UIExample{
			{
				Title:       "基本通知",
				Description: "发送简单的邮件通知",
				Expression: map[string]interface{}{
					"bot_token":        "123456789:AABBccDDeeFFggHHiiJJkkLLmmNNooPPqq",
					"chat_id":          "123456789",
					"message_template": "📧 新邮件: {{.Subject}}\n发件人: {{.From}}",
				},
			},
			{
				Title:       "静默通知",
				Description: "发送不产生提醒的通知",
				Expression: map[string]interface{}{
					"bot_token": "123456789:AABBccDDeeFFggHHiiJJkkLLmmNNooPPqq",
					"chat_id":   "123456789",
					"silent":    true,
				},
			},
			{
				Title:       "使用代理",
				Description: "通过 SOCKS5 代理发送",
				Expression: map[string]interface{}{
					"bot_token":     "123456789:AABBccDDeeFFggHHiiJJkkLLmmNNooPPqq",
					"chat_id":       "123456789",
					"proxy_enabled": true,
					"proxy_type":    "socks5",
					"proxy_host":    "127.0.0.1",
					"proxy_port":    1080,
				},
			},
		},
	}
}

// Float64Ptr 辅助函数：创建 float64 指针
func Float64Ptr(v float64) *float64 {
	return &v
}

// GetDynamicOptions 获取动态选项
func (p *TelegramBotActionPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	switch field {
	case "parse_mode":
		return []plugins.UIOption{
			{Value: "none", Label: "纯文本"},
			{Value: "HTML", Label: "HTML"},
			{Value: "Markdown", Label: "Markdown"},
			{Value: "MarkdownV2", Label: "Markdown V2"},
		}, nil
	case "proxy_type":
		return []plugins.UIOption{
			{Value: "http", Label: "HTTP/HTTPS 代理"},
			{Value: "socks5", Label: "SOCKS5 代理"},
		}, nil
	default:
		return []plugins.UIOption{}, nil
	}
}

// ValidateFieldValue 验证字段值
func (p *TelegramBotActionPlugin) ValidateFieldValue(field string, value interface{}) error {
	switch field {
	case "bot_token":
		if str, ok := value.(string); ok {
			if str == "" {
				return fmt.Errorf("Bot Token 不能为空")
			}
			if !strings.Contains(str, ":") {
				return fmt.Errorf("Bot Token 格式不正确，应包含冒号")
			}
		} else {
			return fmt.Errorf("Bot Token 必须是字符串")
		}
	case "chat_id":
		if str, ok := value.(string); ok {
			if str == "" {
				return fmt.Errorf("Chat ID 不能为空")
			}
		} else {
			return fmt.Errorf("Chat ID 必须是字符串")
		}
	case "proxy_port":
		switch v := value.(type) {
		case int:
			if v < 1 || v > 65535 {
				return fmt.Errorf("代理端口必须在 1-65535 之间")
			}
		case float64:
			if v < 1 || v > 65535 {
				return fmt.Errorf("代理端口必须在 1-65535 之间")
			}
		}
	case "timeout":
		switch v := value.(type) {
		case int:
			if v < 5 || v > 120 {
				return fmt.Errorf("超时时间必须在 5-120 秒之间")
			}
		case float64:
			if v < 5 || v > 120 {
				return fmt.Errorf("超时时间必须在 5-120 秒之间")
			}
		}
	}
	return nil
}

// GetFieldSuggestions 获取字段建议
func (p *TelegramBotActionPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	switch field {
	case "message_template":
		return []string{
			"📧 新邮件: {{.Subject}}\n发件人: {{.From}}",
			"📬 收到来自 {{.From}} 的邮件\n主题: {{.Subject}}",
			"🔔 邮件通知\n━━━━━━━━━━━━━\n📝 {{.Subject}}\n👤 {{.From}}\n⏰ {{.ReceivedAt}}",
		}, nil
	case "parse_mode":
		return []string{"none", "HTML", "Markdown", "MarkdownV2"}, nil
	default:
		return []string{}, nil
	}
}

// escapeForParseMode 根据解析模式转义文本中的特殊字符
func escapeForParseMode(text string, parseMode string) string {
	switch parseMode {
	case "HTML":
		return escapeHTML(text)
	case "Markdown":
		return escapeMarkdown(text)
	case "MarkdownV2":
		return escapeMarkdownV2(text)
	default:
		return text // 纯文本不需要转义
	}
}

// escapeHTML 转义 HTML 特殊字符
// 需要转义: < > &
func escapeHTML(text string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
	)
	return replacer.Replace(text)
}

// escapeMarkdown 转义 Markdown 特殊字符
// 需要转义: _ * ` [
func escapeMarkdown(text string) string {
	replacer := strings.NewReplacer(
		"_", "\\_",
		"*", "\\*",
		"`", "\\`",
		"[", "\\[",
	)
	return replacer.Replace(text)
}

// escapeMarkdownV2 转义 MarkdownV2 特殊字符
// 需要转义: _ * [ ] ( ) ~ ` > # + - = | { } . !
func escapeMarkdownV2(text string) string {
	replacer := strings.NewReplacer(
		"_", "\\_",
		"*", "\\*",
		"[", "\\[",
		"]", "\\]",
		"(", "\\(",
		")", "\\)",
		"~", "\\~",
		"`", "\\`",
		">", "\\>",
		"#", "\\#",
		"+", "\\+",
		"-", "\\-",
		"=", "\\=",
		"|", "\\|",
		"{", "\\{",
		"}", "\\}",
		".", "\\.",
		"!", "\\!",
	)
	return replacer.Replace(text)
}

// escapeMarkdownV2PreserveFormatting 智能转义 MarkdownV2 特殊字符
// 保留正确配对的格式标记: *粗体*, _斜体_, ~删除线~, `代码`, ||剧透||
// 转义所有未配对的特殊字符
func escapeMarkdownV2PreserveFormatting(text string) string {
	// 定义需要保留的配对格式模式
	// 使用正则匹配配对的格式标记
	patterns := []struct {
		regex       *regexp.Regexp
		placeholder string
		restore     func(s string) string
	}{
		// 粗体 *text* (非贪婪匹配，避免跨行)
		{
			regex:       regexp.MustCompile(`\*([^\*\n]+)\*`),
			placeholder: "\x00BOLD\x00",
			restore:     func(s string) string { return "*" + s + "*" },
		},
		// 斜体 _text_
		{
			regex:       regexp.MustCompile(`_([^_\n]+)_`),
			placeholder: "\x00ITALIC\x00",
			restore:     func(s string) string { return "_" + s + "_" },
		},
		// 删除线 ~text~
		{
			regex:       regexp.MustCompile(`~([^~\n]+)~`),
			placeholder: "\x00STRIKE\x00",
			restore:     func(s string) string { return "~" + s + "~" },
		},
		// 行内代码 `text`
		{
			regex:       regexp.MustCompile("`([^`\n]+)`"),
			placeholder: "\x00CODE\x00",
			restore:     func(s string) string { return "`" + s + "`" },
		},
		// 剧透 ||text||
		{
			regex:       regexp.MustCompile(`\|\|([^\|]+)\|\|`),
			placeholder: "\x00SPOILER\x00",
			restore:     func(s string) string { return "||" + s + "||" },
		},
	}

	// 存储匹配到的内容
	type match struct {
		placeholder string
		content     string
		restore     func(s string) string
	}
	var matches []match
	counter := 0

	result := text

	// 第一步：提取所有配对的格式标记，替换为占位符
	for _, p := range patterns {
		result = p.regex.ReplaceAllStringFunc(result, func(s string) string {
			// 提取内部内容
			submatch := p.regex.FindStringSubmatch(s)
			if len(submatch) > 1 {
				innerContent := submatch[1]
				placeholder := fmt.Sprintf("\x00%s_%d\x00", p.placeholder, counter)
				matches = append(matches, match{
					placeholder: placeholder,
					content:     innerContent,
					restore:     p.restore,
				})
				counter++
				return placeholder
			}
			return s
		})
	}

	// 第二步：转义所有剩余的特殊字符（包括未配对的格式字符）
	replacer := strings.NewReplacer(
		"_", "\\_",
		"*", "\\*",
		"[", "\\[",
		"]", "\\]",
		"(", "\\(",
		")", "\\)",
		"~", "\\~",
		"`", "\\`",
		">", "\\>",
		"#", "\\#",
		"+", "\\+",
		"-", "\\-",
		"=", "\\=",
		"|", "\\|",
		"{", "\\{",
		"}", "\\}",
		".", "\\.",
		"!", "\\!",
	)
	result = replacer.Replace(result)

	// 第三步：恢复配对的格式标记（内部内容也需要转义非格式字符）
	for _, m := range matches {
		// 对内部内容进行转义（但保留该层的格式字符）
		escapedInner := escapeMarkdownV2NonFormatChars(m.content)
		restored := m.restore(escapedInner)
		result = strings.Replace(result, m.placeholder, restored, 1)
	}

	return result
}

// escapeMarkdownV2NonFormatChars 转义非格式化字符
// 只转义: [ ] ( ) > # + - = { } . !
// 不转义格式字符: * _ ~ ` |
func escapeMarkdownV2NonFormatChars(text string) string {
	replacer := strings.NewReplacer(
		"[", "\\[",
		"]", "\\]",
		"(", "\\(",
		")", "\\)",
		">", "\\>",
		"#", "\\#",
		"+", "\\+",
		"-", "\\-",
		"=", "\\=",
		"{", "\\{",
		"}", "\\}",
		".", "\\.",
		"!", "\\!",
	)
	return replacer.Replace(text)
}
