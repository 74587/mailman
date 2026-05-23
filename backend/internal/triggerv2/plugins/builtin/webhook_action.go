package builtin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"

	"github.com/dop251/goja"
	"golang.org/x/net/proxy"
)

// WebhookActionPlugin Webhook 动作插件
type WebhookActionPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// WebhookHeader 请求头结构
type WebhookHeader struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// WebhookResponse 响应结构
type WebhookResponse struct {
	StatusCode int               `json:"status_code"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	Duration   time.Duration     `json:"duration"`
}

// NewWebhookActionPlugin 创建 Webhook 动作插件
func NewWebhookActionPlugin() plugins.ActionPlugin {
	return &WebhookActionPlugin{
		info: &plugins.PluginInfo{
			ID:          "webhook_action",
			Name:        "Webhook 通知",
			Version:     "1.0.0",
			Description: "发送 HTTP 请求到指定 URL（支持模板、重试、代理）",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"url": map[string]interface{}{
						"type":        "string",
						"description": "目标 URL（支持模板参数）",
					},
					"method": map[string]interface{}{
						"type":        "string",
						"description": "HTTP 方法",
						"enum":        []string{"GET", "POST", "PUT", "PATCH", "DELETE"},
					},
					"headers": map[string]interface{}{
						"type":        "array",
						"description": "请求头列表",
					},
					"body": map[string]interface{}{
						"type":        "string",
						"description": "请求体（支持模板参数）",
					},
					"content_type": map[string]interface{}{
						"type":        "string",
						"description": "内容类型",
						"enum":        []string{"json", "form", "text", "xml"},
					},
					"timeout": map[string]interface{}{
						"type":        "integer",
						"description": "请求超时（秒）",
						"default":     30,
					},
					"retry_count": map[string]interface{}{
						"type":        "integer",
						"description": "重试次数",
						"default":     0,
					},
					"retry_interval": map[string]interface{}{
						"type":        "integer",
						"description": "重试间隔（毫秒）",
						"default":     1000,
					},
					"retry_backoff": map[string]interface{}{
						"type":        "string",
						"description": "重试策略",
						"enum":        []string{"fixed", "linear", "exponential"},
					},
					"success_condition": map[string]interface{}{
						"type":        "string",
						"description": "成功判断方式",
						"enum":        []string{"status_code", "body_contains", "body_regex", "expression"},
					},
					"expected_status_codes": map[string]interface{}{
						"type":        "array",
						"description": "期望的状态码列表",
					},
					"expected_body_contains": map[string]interface{}{
						"type":        "string",
						"description": "响应体应包含的内容",
					},
					"expected_body_regex": map[string]interface{}{
						"type":        "string",
						"description": "响应体匹配的正则",
					},
					"success_expression": map[string]interface{}{
						"type":        "string",
						"description": "JavaScript 表达式判断成功",
					},
				},
				"required": []string{"url", "method"},
			},
			DefaultConfig: map[string]interface{}{
				"url":                    "",
				"method":                 "POST",
				"headers":                []interface{}{},
				"body":                   "",
				"content_type":           "json",
				"timeout":                30,
				"retry_count":            0,
				"retry_interval":         1000,
				"retry_backoff":          "fixed",
				"retry_max_interval":     60000,
				"proxy_enabled":          false,
				"proxy_type":             "http",
				"proxy_host":             "",
				"proxy_port":             0,
				"proxy_username":         "",
				"proxy_password":         "",
				"success_condition":      "status_code",
				"expected_status_codes":  []interface{}{float64(200), float64(201), float64(202), float64(204)},
				"expected_body_contains": "",
				"expected_body_regex":    "",
				"success_expression":     "statusCode >= 200 && statusCode < 300",
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
func (p *WebhookActionPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize 初始化插件
func (p *WebhookActionPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = p.info.DefaultConfig
	return nil
}

// Cleanup 清理插件
func (p *WebhookActionPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *WebhookActionPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *WebhookActionPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *WebhookActionPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *WebhookActionPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *WebhookActionPlugin) GetDefaultConfig() map[string]interface{} {
	return p.info.DefaultConfig
}

// ValidateConfig 验证配置
func (p *WebhookActionPlugin) ValidateConfig(config map[string]interface{}) error {
	// 验证 URL
	if urlStr, ok := config["url"]; ok {
		if str, ok := urlStr.(string); ok {
			if str == "" {
				return fmt.Errorf("URL 不能为空")
			}
		} else {
			return fmt.Errorf("URL 必须是字符串")
		}
	} else {
		return fmt.Errorf("URL 是必需的")
	}

	// 验证 HTTP 方法
	if method, ok := config["method"]; ok {
		if str, ok := method.(string); ok {
			validMethods := map[string]bool{
				"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true,
			}
			if !validMethods[strings.ToUpper(str)] {
				return fmt.Errorf("无效的 HTTP 方法: %s", str)
			}
		} else {
			return fmt.Errorf("HTTP 方法必须是字符串")
		}
	} else {
		return fmt.Errorf("HTTP 方法是必需的")
	}

	// 验证超时
	if timeout, ok := config["timeout"]; ok {
		switch v := timeout.(type) {
		case int:
			if v <= 0 || v > 300 {
				return fmt.Errorf("超时时间必须在 1-300 秒之间")
			}
		case float64:
			if v <= 0 || v > 300 {
				return fmt.Errorf("超时时间必须在 1-300 秒之间")
			}
		}
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
		}
	}

	return nil
}

// ApplyConfig 应用配置
func (p *WebhookActionPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}

	for key, value := range config {
		p.config[key] = value
	}

	return nil
}

// HealthCheck 健康检查
func (p *WebhookActionPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *WebhookActionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"executions": p.info.UsageCount,
		"last_used":  p.info.LastUsed,
		"status":     p.info.Status,
	}
}

// Execute 执行动作
func (p *WebhookActionPlugin) Execute(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
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
	urlTemplate := p.getStringConfig("url")
	method := strings.ToUpper(p.getStringConfig("method"))
	bodyTemplate := p.getStringConfig("body")
	contentType := p.getStringConfig("content_type")
	timeout := p.getIntConfig("timeout")
	if timeout <= 0 {
		timeout = 30
	}

	retryCount := p.getIntConfig("retry_count")
	retryInterval := p.getIntConfig("retry_interval")
	if retryInterval <= 0 {
		retryInterval = 1000
	}
	retryBackoff := p.getStringConfig("retry_backoff")
	retryMaxInterval := p.getIntConfig("retry_max_interval")
	if retryMaxInterval <= 0 {
		retryMaxInterval = 60000
	}

	// 渲染 URL 模板，传递 event 以支持变量
	renderedURL, err := p.renderTemplate(urlTemplate, emailData, event)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("渲染 URL 模板失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 渲染请求体模板
	var renderedBody string
	if bodyTemplate != "" {
		renderedBody, err = p.renderTemplate(bodyTemplate, emailData, event)
		if err != nil {
			return &plugins.PluginResult{
				Success:       false,
				Error:         fmt.Sprintf("渲染请求体模板失败: %v", err),
				ExecutionTime: time.Since(startTime),
				Timestamp:     time.Now(),
			}, nil
		}
	}

	// 渲染请求头
	headers, err := p.renderHeaders(emailData)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("渲染请求头失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 设置 Content-Type
	if contentType != "" && method != "GET" {
		contentTypeHeader := p.getContentTypeHeader(contentType)
		if contentTypeHeader != "" {
			headers["Content-Type"] = contentTypeHeader
		}
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

	// 执行请求（带重试）
	var response *WebhookResponse
	var lastErr error
	attempts := retryCount + 1

	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			// 计算重试等待时间
			waitTime := p.calculateRetryWait(attempt, retryInterval, retryBackoff, retryMaxInterval)
			time.Sleep(time.Duration(waitTime) * time.Millisecond)
		}

		response, lastErr = p.executeRequest(client, method, renderedURL, renderedBody, headers)

		if lastErr == nil && p.isSuccessResponse(response) {
			break
		}
	}

	if lastErr != nil {
		return &plugins.PluginResult{
			Success: false,
			Error:   fmt.Sprintf("Webhook 请求失败: %v", lastErr),
			Data: map[string]interface{}{
				"url":      renderedURL,
				"method":   method,
				"attempts": attempts,
			},
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 检查响应是否成功
	if !p.isSuccessResponse(response) {
		return &plugins.PluginResult{
			Success: false,
			Error:   fmt.Sprintf("Webhook 响应不符合预期: 状态码 %d", response.StatusCode),
			Data: map[string]interface{}{
				"url":         renderedURL,
				"method":      method,
				"status_code": response.StatusCode,
				"body":        p.truncateBody(response.Body, 500),
				"attempts":    attempts,
			},
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 成功
	return &plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"url":         renderedURL,
			"method":      method,
			"status_code": response.StatusCode,
			"body":        p.truncateBody(response.Body, 500),
			"duration_ms": response.Duration.Milliseconds(),
			"attempts":    attempts - retryCount + 1, // 实际尝试次数
		},
		ExecutionTime: time.Since(startTime),
		Timestamp:     time.Now(),
	}, nil
}

// renderTemplate 渲染模板（使用 JavaScript 引擎）
func (p *WebhookActionPlugin) renderTemplate(tmplStr string, emailData models.EmailEventData, event *models.Event) (string, error) {
	if tmplStr == "" {
		return "", nil
	}

	// 如果模板不包含任何变量标记，直接返回
	if !strings.Contains(tmplStr, "{{") && !strings.ContainsAny(tmplStr, "$") {
		return tmplStr, nil
	}

	vm := goja.New()

	// 设置超时保护
	time.AfterFunc(5*time.Second, func() {
		vm.Interrupt("execution timeout")
	})

	// 设置邮件数据变量
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

	// 设置完整的 email 对象
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
	vm.Set("encodeURI", func(s string) string { return url.QueryEscape(s) })
	vm.Set("encodeURIComponent", func(s string) string { return url.QueryEscape(s) })
	vm.Set("JSON", map[string]interface{}{
		"stringify": func(v interface{}) string {
			b, _ := json.Marshal(v)
			return string(b)
		},
	})

	// 执行脚本
	result, err := vm.RunString(tmplStr)
	if err != nil {
		if strings.Contains(err.Error(), "timeout") {
			return "", fmt.Errorf("执行超时")
		}
		return "", fmt.Errorf("执行失败: %v", err)
	}

	if result == nil || goja.IsUndefined(result) || goja.IsNull(result) {
		return "", nil
	}

	return result.String(), nil
}

// renderHeaders 渲染请求头（支持多行文本格式）
func (p *WebhookActionPlugin) renderHeaders(emailData models.EmailEventData) (map[string]string, error) {
	result := make(map[string]string)

	headersConfig := p.config["headers"]
	if headersConfig == nil {
		return result, nil
	}

	// 支持多行文本格式: 每行一个请求头，格式 "Key: Value"
	if headersStr, ok := headersConfig.(string); ok {
		if headersStr == "" {
			return result, nil
		}
		lines := strings.Split(headersStr, "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			// 查找第一个冒号分隔符
			idx := strings.Index(line, ":")
			if idx <= 0 {
				continue
			}
			key := strings.TrimSpace(line[:idx])
			value := strings.TrimSpace(line[idx+1:])
			if key == "" {
				continue
			}
			// 渲染 value 模板（支持 {{Subject}} 等模板变量）
			if strings.Contains(value, "{{") {
				// 简单替换模板变量
				value = strings.ReplaceAll(value, "{{Subject}}", emailData.Subject)
				value = strings.ReplaceAll(value, "{{From}}", fmt.Sprintf("%v", emailData.From))
				value = strings.ReplaceAll(value, "{{To}}", fmt.Sprintf("%v", emailData.To))
				value = strings.ReplaceAll(value, "{{EmailID}}", fmt.Sprintf("%v", emailData.EmailID))
				value = strings.ReplaceAll(value, "{{MessageID}}", emailData.MessageID)
			}
			result[key] = value
		}
		return result, nil
	}

	// 兼容旧格式：数组形式
	headers, ok := headersConfig.([]interface{})
	if !ok {
		return result, nil
	}

	for _, h := range headers {
		headerMap, ok := h.(map[string]interface{})
		if !ok {
			continue
		}

		key, _ := headerMap["key"].(string)
		value, _ := headerMap["value"].(string)

		if key == "" {
			continue
		}

		// 渲染 value 模板
		renderedValue, err := p.renderTemplate(value, emailData, nil)
		if err != nil {
			return nil, fmt.Errorf("渲染请求头 %s 失败: %v", key, err)
		}

		result[key] = renderedValue
	}

	return result, nil
}

// getContentTypeHeader 获取 Content-Type 头（直接返回用户输入值）
func (p *WebhookActionPlugin) getContentTypeHeader(contentType string) string {
	if contentType == "" {
		return "application/json"
	}
	return contentType
}

// createHTTPClient 创建 HTTP 客户端
func (p *WebhookActionPlugin) createHTTPClient(timeout int) (*http.Client, error) {
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

		// 支持新格式 proxy_auth (username:password) 和旧格式 (proxy_username, proxy_password)
		var proxyUsername, proxyPassword string
		proxyAuth := p.getStringConfig("proxy_auth")
		if proxyAuth != "" {
			parts := strings.SplitN(proxyAuth, ":", 2)
			proxyUsername = parts[0]
			if len(parts) > 1 {
				proxyPassword = parts[1]
			}
		} else {
			proxyUsername = p.getStringConfig("proxy_username")
			proxyPassword = p.getStringConfig("proxy_password")
		}

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

// executeRequest 执行 HTTP 请求
func (p *WebhookActionPlugin) executeRequest(client *http.Client, method, urlStr, body string, headers map[string]string) (*WebhookResponse, error) {
	startTime := time.Now()

	var bodyReader io.Reader
	if body != "" {
		bodyReader = bytes.NewBufferString(body)
	}

	req, err := http.NewRequest(method, urlStr, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	// 设置请求头
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("发送请求失败: %v", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	// 获取响应头
	respHeaders := make(map[string]string)
	for key := range resp.Header {
		respHeaders[key] = resp.Header.Get(key)
	}

	return &WebhookResponse{
		StatusCode: resp.StatusCode,
		Headers:    respHeaders,
		Body:       string(respBody),
		Duration:   time.Since(startTime),
	}, nil
}

// calculateRetryWait 计算重试等待时间
func (p *WebhookActionPlugin) calculateRetryWait(attempt, baseInterval int, backoff string, maxInterval int) int {
	var wait int

	switch backoff {
	case "linear":
		wait = baseInterval * (attempt + 1)
	case "exponential":
		wait = int(float64(baseInterval) * math.Pow(2, float64(attempt)))
	default: // fixed
		wait = baseInterval
	}

	if wait > maxInterval {
		wait = maxInterval
	}

	return wait
}

// isSuccessResponse 判断响应是否成功
func (p *WebhookActionPlugin) isSuccessResponse(response *WebhookResponse) bool {
	if response == nil {
		return false
	}

	condition := p.getStringConfig("success_condition")

	switch condition {
	case "body_contains":
		expected := p.getStringConfig("expected_body_contains")
		return strings.Contains(response.Body, expected)

	case "body_regex":
		pattern := p.getStringConfig("expected_body_regex")
		if pattern == "" {
			return true
		}
		matched, err := regexp.MatchString(pattern, response.Body)
		return err == nil && matched

	case "expression":
		expression := p.getStringConfig("success_expression")
		return p.evaluateSuccessExpression(expression, response)

	default: // status_code
		expectedCodes := p.getIntSliceConfig("expected_status_codes")
		if len(expectedCodes) == 0 {
			// 默认 2xx 都成功
			return response.StatusCode >= 200 && response.StatusCode < 300
		}
		for _, code := range expectedCodes {
			if response.StatusCode == code {
				return true
			}
		}
		return false
	}
}

// evaluateSuccessExpression 评估 JavaScript 表达式
func (p *WebhookActionPlugin) evaluateSuccessExpression(expression string, response *WebhookResponse) bool {
	if expression == "" {
		return response.StatusCode >= 200 && response.StatusCode < 300
	}

	vm := goja.New()

	time.AfterFunc(3*time.Second, func() {
		vm.Interrupt("timeout")
	})

	vm.Set("statusCode", response.StatusCode)
	vm.Set("body", response.Body)
	vm.Set("headers", response.Headers)

	result, err := vm.RunString(expression)
	if err != nil {
		return false
	}

	return result.ToBoolean()
}

// truncateBody 截断响应体
func (p *WebhookActionPlugin) truncateBody(body string, maxLen int) string {
	if len(body) <= maxLen {
		return body
	}
	return body[:maxLen] + "..."
}

// 配置获取辅助方法
func (p *WebhookActionPlugin) getStringConfig(key string) string {
	if val, ok := p.config[key]; ok {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

func (p *WebhookActionPlugin) getBoolConfig(key string) bool {
	if val, ok := p.config[key]; ok {
		if b, ok := val.(bool); ok {
			return b
		}
	}
	return false
}

func (p *WebhookActionPlugin) getIntConfig(key string) int {
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

func (p *WebhookActionPlugin) getIntSliceConfig(key string) []int {
	if val, ok := p.config[key]; ok {
		if arr, ok := val.([]interface{}); ok {
			result := make([]int, 0, len(arr))
			for _, v := range arr {
				switch n := v.(type) {
				case int:
					result = append(result, n)
				case float64:
					result = append(result, int(n))
				case int64:
					result = append(result, int(n))
				}
			}
			return result
		}
	}
	return nil
}

// GetDescription 获取描述
func (p *WebhookActionPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *WebhookActionPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(models.EventTypeEmailReceived),
		string(models.EventTypeEmailUpdated),
	}
}

// GetRequiredConfig 获取必需配置
func (p *WebhookActionPlugin) GetRequiredConfig() []string {
	return []string{"url", "method"}
}

// CanExecute 检查是否可以执行
func (p *WebhookActionPlugin) CanExecute(ctx *plugins.PluginContext, event *models.Event) bool {
	supportedTypes := p.GetSupportedEventTypes()
	for _, supportedType := range supportedTypes {
		if string(event.Type) == supportedType {
			return true
		}
	}
	return false
}

// GetExecutionOrder 获取执行顺序
func (p *WebhookActionPlugin) GetExecutionOrder() int {
	return 200 // 中等优先级
}

// GetUISchema 获取 UI 架构
func (p *WebhookActionPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			// === 基本配置 ===
			{
				Name:        "url",
				Label:       "目标 URL",
				Type:        plugins.UIFieldTypeText,
				Description: "Webhook 目标地址。支持 JavaScript 模板，如: \"https://api.example.com/notify?subject=\" + encodeURI(Subject)",
				Placeholder: "https://api.example.com/webhook",
				Required:    true,
				Width:       "full",
			},
			{
				Name:         "method",
				Label:        "HTTP 方法",
				Type:         plugins.UIFieldTypeText,
				Description:  "常用方法: GET, POST, PUT, PATCH, DELETE。也支持自定义方法",
				Placeholder:  "POST",
				Required:     true,
				Width:        "1/4",
				DefaultValue: "POST",
			},
			{
				Name:         "content_type",
				Label:        "Content-Type",
				Type:         plugins.UIFieldTypeText,
				Description:  "常用: application/json, application/x-www-form-urlencoded, text/plain",
				Placeholder:  "application/json",
				Required:     false,
				Width:        "1/2",
				DefaultValue: "application/json",
			},
			{
				Name:         "timeout",
				Label:        "超时(秒)",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "请求超时时间",
				Required:     false,
				Width:        "1/4",
				DefaultValue: 30,
			},

			// === 请求头 ===
			{
				Name:        "headers",
				Label:       "请求头",
				Type:        plugins.UIFieldTypeText,
				Description: "每行一个请求头，格式: 名称: 值。支持 {{Subject}} 等模板变量",
				Placeholder: "Authorization: Bearer your-token\nX-Custom-Header: {{Subject}}",
				Required:    false,
				Width:       "full",
			},

			// === 请求体 ===
			{
				Name:        "body",
				Label:       "请求体",
				Type:        plugins.UIFieldTypeJavaScript,
				Description: "请求体内容。支持 JavaScript 表达式生成动态内容",
				Placeholder: `JSON.stringify({subject: Subject, from: From, to: To})`,
				Required:    false,
				Width:       "full",
				DefaultValue: `JSON.stringify({
  subject: Subject,
  from: From,
  to: To,
  received_at: ReceivedAt
})`,
				// Webhook 请求体生成专用示例和文档
				Examples: []plugins.CodeExample{
					{
						Title:       "基本 JSON 结构",
						Description: "发送邮件基本信息的 JSON",
						Code:        `JSON.stringify({\n  subject: Subject,\n  from: From,\n  to: To\n})`,
					},
					{
						Title:       "完整邮件数据",
						Description: "包含所有邮件字段的 JSON",
						Code:        `JSON.stringify({\n  subject: Subject,\n  from: From,\n  to: To,\n  body: Body,\n  received_at: ReceivedAt,\n  message_id: MessageID\n})`,
					},
					{
						Title:       "自定义格式",
						Description: "自定义 JSON 结构",
						Code:        `JSON.stringify({\n  event: "new_email",\n  data: {\n    title: Subject,\n    sender: From[0],\n    timestamp: new Date().toISOString()\n  }\n})`,
					},
					{
						Title:       "表单格式",
						Description: "URL 编码的表单数据",
						Code:        `"subject=" + encodeURIComponent(Subject) + "&from=" + encodeURIComponent(From[0])`,
					},
					{
						Title:       "纯文本消息",
						Description: "简单文本格式",
						Code:        "`新邮件: ${Subject}\\n发件人: ${From[0]}\\n时间: ${ReceivedAt}`",
					},
				},
				Documentation: []plugins.DocumentationSection{
					{
						Title:   "可用变量",
						Content: "以下变量可直接在表达式中使用（来自触发的邮件）",
						Examples: []plugins.DocExampleItem{
							{Code: "Subject", Description: "邮件主题 (string)"},
							{Code: "From", Description: "发件人列表 (string[])"},
							{Code: "To", Description: "收件人列表 (string[])"},
							{Code: "Body", Description: "邮件正文 (string)"},
							{Code: "ReceivedAt", Description: "接收时间 (string)"},
							{Code: "MessageID", Description: "消息ID (string)"},
						},
					},
					{
						Title:   "常用方法",
						Content: "JavaScript 常用方法",
						Examples: []plugins.DocExampleItem{
							{Code: "JSON.stringify(obj)", Description: "对象转 JSON 字符串"},
							{Code: "encodeURIComponent(str)", Description: "URL 编码"},
							{Code: "new Date().toISOString()", Description: "当前时间 ISO 格式"},
							{Code: "From[0]", Description: "获取第一个发件人"},
						},
					},
					{
						Title:   "返回值",
						Content: "表达式的返回值将作为请求体发送。返回字符串或对象（会自动转为 JSON）。",
					},
				},
			},

			// === 重试配置 ===
			{
				Name:         "retry_count",
				Label:        "重试次数",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "请求失败时的重试次数（0 表示不重试）",
				Required:     false,
				Width:        "1/4",
				DefaultValue: 0,
			},
			{
				Name:         "retry_interval",
				Label:        "重试间隔(ms)",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "重试之间的等待时间",
				Required:     false,
				Width:        "1/4",
				DefaultValue: 1000,
			},
			{
				Name:         "retry_backoff",
				Label:        "重试策略",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "重试间隔的计算方式",
				Required:     false,
				Width:        "1/4",
				DefaultValue: "fixed",
				Options: []plugins.UIOption{
					{Value: "fixed", Label: "固定间隔"},
					{Value: "linear", Label: "线性增长"},
					{Value: "exponential", Label: "指数回退"},
				},
			},
			{
				Name:         "retry_max_interval",
				Label:        "最大间隔(ms)",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "重试间隔的最大值",
				Required:     false,
				Width:        "1/4",
				DefaultValue: 60000,
			},

			// === 成功判断 ===
			{
				Name:         "success_condition",
				Label:        "成功判断方式",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "如何判断请求是否成功",
				Required:     false,
				Width:        "full",
				DefaultValue: "status_code",
				Options: []plugins.UIOption{
					{Value: "status_code", Label: "状态码匹配（默认 2xx 都成功）"},
					{Value: "body_contains", Label: "响应体包含指定内容"},
					{Value: "body_regex", Label: "响应体匹配正则表达式"},
					{Value: "expression", Label: "JavaScript 表达式"},
				},
			},
			{
				Name:         "expected_status_codes",
				Label:        "期望状态码",
				Type:         plugins.UIFieldTypeText,
				Description:  "期望的 HTTP 状态码，多个用逗号分隔。留空则默认 2xx 都成功",
				Placeholder:  "200, 201, 204",
				Required:     false,
				Width:        "full",
				DefaultValue: "",
				ShowIf: map[string]interface{}{
					"success_condition": []string{"status_code"},
				},
			},
			{
				Name:        "expected_body_contains",
				Label:       "期望响应包含",
				Type:        plugins.UIFieldTypeText,
				Description: "响应体应包含的内容",
				Placeholder: "success",
				Required:    false,
				Width:       "full",
				ShowIf: map[string]interface{}{
					"success_condition": []string{"body_contains"},
				},
			},
			{
				Name:        "expected_body_regex",
				Label:       "期望响应匹配正则",
				Type:        plugins.UIFieldTypeRegex,
				Description: "响应体应匹配的正则表达式",
				Placeholder: `"status":\s*"(ok|success)"`,
				Required:    false,
				Width:       "full",
				ShowIf: map[string]interface{}{
					"success_condition": []string{"body_regex"},
				},
			},
			{
				Name:         "success_expression",
				Label:        "成功判断表达式",
				Type:         plugins.UIFieldTypeJavaScript,
				Description:  "JavaScript 表达式。可用变量: statusCode, body, headers",
				Placeholder:  "statusCode === 200 && body.includes('success')",
				Required:     false,
				Width:        "full",
				DefaultValue: "statusCode >= 200 && statusCode < 300",
				ShowIf: map[string]interface{}{
					"success_condition": []string{"expression"},
				},
				// Webhook 成功判断专用示例和文档
				Examples: []plugins.CodeExample{
					{
						Title:       "检查状态码范围",
						Description: "判断状态码是否在 2xx 范围内",
						Code:        "statusCode >= 200 && statusCode < 300",
					},
					{
						Title:       "检查响应包含字段",
						Description: "验证 JSON 响应中包含特定字段",
						Code:        "statusCode === 200 && body.includes('\"success\":true')",
					},
					{
						Title:       "解析 JSON 响应",
						Description: "解析响应体并检查字段值",
						Code:        "(function() {\n  try {\n    const data = JSON.parse(body);\n    return data.code === 0 && data.status === 'ok';\n  } catch(e) {\n    return false;\n  }\n})()",
					},
					{
						Title:       "检查响应头",
						Description: "验证特定响应头存在",
						Code:        "statusCode === 200 && headers['content-type']?.includes('application/json')",
					},
				},
				Documentation: []plugins.DocumentationSection{
					{
						Title:   "可用变量",
						Content: "在表达式中可以使用以下变量来判断请求是否成功",
						Examples: []plugins.DocExampleItem{
							{Code: "statusCode", Description: "HTTP 状态码 (如 200, 404, 500)"},
							{Code: "body", Description: "响应体内容 (字符串)"},
							{Code: "headers", Description: "响应头对象 (键值对)"},
						},
					},
					{
						Title:   "常用判断方法",
						Content: "字符串和对象的常用方法",
						Examples: []plugins.DocExampleItem{
							{Code: "body.includes('text')", Description: "检查响应是否包含文本"},
							{Code: "JSON.parse(body)", Description: "将响应解析为 JSON 对象"},
							{Code: "headers['header-name']", Description: "获取特定响应头"},
						},
					},
					{
						Title:   "返回值",
						Content: "表达式必须返回布尔值: true 表示成功，false 表示失败",
					},
				},
			},

			// === 代理配置 ===
			{
				Name:         "proxy_enabled",
				Label:        "启用代理",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否通过代理服务器发送请求",
				Required:     false,
				Width:        "full",
				DefaultValue: false,
			},
			{
				Name:         "proxy_type",
				Label:        "代理类型",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "代理服务器类型",
				Required:     false,
				Width:        "1/4",
				DefaultValue: "http",
				Options: []plugins.UIOption{
					{Value: "http", Label: "HTTP"},
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
				Placeholder: "proxy.example.com",
				Required:    false,
				Width:       "1/4",
				ShowIf: map[string]interface{}{
					"proxy_enabled": true,
				},
			},
			{
				Name:         "proxy_port",
				Label:        "端口",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "代理服务器端口",
				Placeholder:  "8080",
				Required:     false,
				Width:        "1/4",
				DefaultValue: 8080,
				ShowIf: map[string]interface{}{
					"proxy_enabled": true,
				},
			},
			{
				Name:        "proxy_auth",
				Label:       "认证信息",
				Type:        plugins.UIFieldTypeText,
				Description: "格式: username:password（可选）",
				Placeholder: "user:pass",
				Required:    false,
				Width:       "1/4",
				ShowIf: map[string]interface{}{
					"proxy_enabled": true,
				},
			},
		},
	}
}

// GetDynamicOptions 获取动态选项（实现 ActionPluginWithUI 接口）
func (p *WebhookActionPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	// Webhook 插件不需要动态选项
	return []plugins.UIOption{}, nil
}

// ValidateFieldValue 验证字段值（实现 ActionPluginWithUI 接口）
func (p *WebhookActionPlugin) ValidateFieldValue(field string, value interface{}) error {
	switch field {
	case "url":
		if str, ok := value.(string); ok {
			if str == "" {
				return fmt.Errorf("URL 不能为空")
			}
		}
	case "method":
		if str, ok := value.(string); ok {
			validMethods := map[string]bool{
				"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true,
			}
			if !validMethods[strings.ToUpper(str)] {
				return fmt.Errorf("无效的 HTTP 方法: %s", str)
			}
		}
	}
	return nil
}

// GetFieldSuggestions 获取字段建议（实现 ActionPluginWithUI 接口）
func (p *WebhookActionPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	// Webhook 插件不需要字段建议
	return []string{}, nil
}
