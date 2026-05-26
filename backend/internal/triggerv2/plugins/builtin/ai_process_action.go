package builtin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"text/template"
	"time"

	"mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"

	"github.com/dop251/goja"
)

// AIProcessActionPlugin AI 处理动作插件
type AIProcessActionPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewAIProcessActionPlugin 创建 AI 处理动作插件
func NewAIProcessActionPlugin() plugins.ActionPlugin {
	return &AIProcessActionPlugin{
		info: &plugins.PluginInfo{
			ID:          "ai_process_action",
			Name:        "AI 处理",
			Version:     "1.0.0",
			Description: "使用 AI 服务处理邮件内容，支持 OpenAI/Gemini/Claude",
			Author:      "Mailman",
			Website:     "",
			License:     "MIT",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"config_source":   map[string]interface{}{"type": "string", "description": "配置来源: existing/custom"},
					"ai_config_id":    map[string]interface{}{"type": "integer", "description": "已有配置ID"},
					"system_prompt":   map[string]interface{}{"type": "string", "description": "系统提示词"},
					"user_prompt":     map[string]interface{}{"type": "string", "description": "用户提示词"},
					"output_mode":     map[string]interface{}{"type": "string", "description": "输出模式"},
					"target_variable": map[string]interface{}{"type": "string", "description": "目标变量"},
				},
			},
		},
		config: make(map[string]interface{}),
	}
}

// ========== Plugin 基础接口实现 ==========

// GetInfo 获取插件信息
func (p *AIProcessActionPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize 初始化插件
func (p *AIProcessActionPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// Cleanup 清理插件
func (p *AIProcessActionPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *AIProcessActionPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *AIProcessActionPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *AIProcessActionPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *AIProcessActionPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *AIProcessActionPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{
		"config_source":   "custom",
		"prompt_source":   "custom",
		"template_engine": "gotemplate",
		"max_tokens":      1000,
		"temperature":     0.7,
		"output_mode":     "set_variable",
	}
}

// ValidateConfig 验证配置
func (p *AIProcessActionPlugin) ValidateConfig(config map[string]interface{}) error {
	configSource, _ := config["config_source"].(string)
	if configSource == "custom" {
		if apiKey, ok := config["custom_api_key"].(string); !ok || apiKey == "" {
			// 允许稍后填写
		}
	}
	return nil
}

// ApplyConfig 应用配置
func (p *AIProcessActionPlugin) ApplyConfig(config map[string]interface{}) error {
	if config != nil {
		if p.config == nil {
			p.config = make(map[string]interface{})
		}
		for k, v := range config {
			p.config[k] = v
		}
	}
	return nil
}

// HealthCheck 健康检查
func (p *AIProcessActionPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *AIProcessActionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"plugin_id":   p.info.ID,
		"status":      p.info.Status,
		"usage_count": p.info.UsageCount,
	}
}

// ========== ActionPlugin 接口实现 ==========

// Execute 执行 AI 处理
func (p *AIProcessActionPlugin) Execute(ctx *plugins.PluginContext, event *triggerModels.Event) (*plugins.PluginResult, error) {
	log.Printf("[AIProcessAction] Starting AI processing")
	startTime := time.Now()

	config := p.resolveExecutionConfig(ctx)
	if event == nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         "事件为空",
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 获取邮件数据
	var emailData triggerModels.EmailEventData
	if err := json.Unmarshal(event.Data, &emailData); err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("解析邮件数据失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 获取 AI 配置
	aiConfig, err := p.getAIConfig(config)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("获取 AI 配置失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 获取提示词
	systemPrompt := p.getStringConfig(config, "system_prompt")
	userPrompt := p.getStringConfig(config, "user_prompt")

	// 格式化用户提示词
	templateEngine := p.getStringConfig(config, "template_engine")
	if templateEngine == "" {
		templateEngine = "gotemplate"
	}

	formattedUserPrompt, err := p.formatPrompt(templateEngine, userPrompt, &emailData, event)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("格式化提示词失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	log.Printf("[AIProcessAction] Calling AI, system=%d chars, user=%d chars", len(systemPrompt), len(formattedUserPrompt))

	// 获取参数
	maxTokens := 1000
	if v, ok := config["max_tokens"].(float64); ok {
		maxTokens = int(v)
	}
	temperature := 0.7
	if v, ok := config["temperature"].(float64); ok {
		temperature = v
	}

	// 调用 AI
	response, err := p.callAI(aiConfig, systemPrompt, formattedUserPrompt, maxTokens, temperature)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("调用 AI 失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	log.Printf("[AIProcessAction] AI response length: %d chars", len(response))

	// 处理输出
	outputMode := p.getStringConfig(config, "output_mode")
	if outputMode == "" {
		outputMode = "set_variable" // 默认输出模式
	}
	targetVariable := p.getStringConfig(config, "target_variable")

	log.Printf("[AIProcessAction] output_mode='%s', target_variable='%s'", outputMode, targetVariable)

	if outputMode == "set_variable" && targetVariable != "" {
		event.SetVariable(targetVariable, response)
		log.Printf("[AIProcessAction] Successfully set variable $.%s (length: %d)", targetVariable, len(response))
	} else {
		log.Printf("[AIProcessAction] WARNING: Variable not set! outputMode=%s (expected 'set_variable'), targetVariable='%s' (should not be empty)", outputMode, targetVariable)
	}

	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	return &plugins.PluginResult{
		Success:       true,
		ExecutionTime: time.Since(startTime),
		Timestamp:     time.Now(),
		Data: map[string]interface{}{
			"response":        response,
			"model":           aiConfig.Model,
			"channel_type":    aiConfig.ChannelType,
			"target_variable": targetVariable,
		},
	}, nil
}

// GetDescription 获取描述
func (p *AIProcessActionPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *AIProcessActionPlugin) GetSupportedEventTypes() []string {
	return []string{"email", "email.received"}
}

// GetRequiredConfig 获取必需配置
func (p *AIProcessActionPlugin) GetRequiredConfig() []string {
	return []string{"user_prompt"}
}

// CanExecute 检查是否可执行
func (p *AIProcessActionPlugin) CanExecute(ctx *plugins.PluginContext, event *triggerModels.Event) bool {
	return true
}

// GetExecutionOrder 获取执行顺序
func (p *AIProcessActionPlugin) GetExecutionOrder() int {
	return 0
}

// ========== 辅助方法 ==========

func (p *AIProcessActionPlugin) resolveExecutionConfig(ctx *plugins.PluginContext) map[string]interface{} {
	config := make(map[string]interface{})
	for k, v := range p.GetDefaultConfig() {
		config[k] = v
	}
	for k, v := range p.config {
		config[k] = v
	}
	if ctx != nil && ctx.Config != nil && ctx.Config.Config != nil {
		for k, v := range ctx.Config.Config {
			config[k] = v
		}
	}
	return config
}

// getStringConfig 获取字符串配置
func (p *AIProcessActionPlugin) getStringConfig(config map[string]interface{}, key string) string {
	if v, ok := config[key].(string); ok {
		return v
	}
	return ""
}

// getAIConfig 获取 AI 配置
func (p *AIProcessActionPlugin) getAIConfig(config map[string]interface{}) (*models.OpenAIConfig, error) {
	configSource := p.getStringConfig(config, "config_source")

	if configSource == "custom" || configSource == "" {
		channelType := p.getStringConfig(config, "custom_channel_type")
		if channelType == "" {
			channelType = "openai"
		}
		baseURL := p.getStringConfig(config, "custom_base_url")
		apiKey := p.getStringConfig(config, "custom_api_key")
		model := p.getStringConfig(config, "custom_model")
		if model == "" {
			model = "gpt-3.5-turbo"
		}

		if apiKey == "" {
			return nil, fmt.Errorf("请提供 API Key")
		}

		return &models.OpenAIConfig{
			ChannelType: models.AIChannelType(channelType),
			BaseURL:     baseURL,
			APIKey:      apiKey,
			Model:       model,
		}, nil
	}

	// existing 模式需要从 config 中取配置信息
	// 简化处理：这里也走 custom 逻辑
	return nil, fmt.Errorf("请选择有效的配置")
}

// formatPrompt 格式化提示词
func (p *AIProcessActionPlugin) formatPrompt(engine string, prompt string, emailData *triggerModels.EmailEventData, event *triggerModels.Event) (string, error) {
	if prompt == "" {
		return "", nil
	}

	// 构建上下文
	context := map[string]interface{}{
		"Subject":   emailData.Subject,
		"From":      emailData.From,
		"To":        emailData.To,
		"MessageID": emailData.MessageID,
	}

	// 从 Email 对象获取更多字段
	if emailData.Email != nil {
		context["Body"] = emailData.Email.Body
		context["TextBody"] = emailData.Email.TextBody
		context["HTMLBody"] = emailData.Email.HTMLBody
	}

	// 添加变量池
	if event != nil {
		for k, v := range event.GetAllVariables() {
			context[k] = v
		}
	}

	if engine == "javascript" {
		return p.formatWithJavaScript(prompt, context)
	}
	return p.formatWithGoTemplate(prompt, context)
}

// formatWithGoTemplate Go 模板格式化
func (p *AIProcessActionPlugin) formatWithGoTemplate(prompt string, context map[string]interface{}) (string, error) {
	tmpl, err := template.New("prompt").Parse(prompt)
	if err != nil {
		return "", fmt.Errorf("解析 Go 模板失败: %v", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, context); err != nil {
		return "", fmt.Errorf("执行 Go 模板失败: %v", err)
	}

	return buf.String(), nil
}

// formatWithJavaScript JavaScript 格式化
func (p *AIProcessActionPlugin) formatWithJavaScript(prompt string, context map[string]interface{}) (string, error) {
	vm := goja.New()

	vm.Set("$", context)
	for k, v := range context {
		vm.Set(k, v)
	}

	result, err := vm.RunString(prompt)
	if err != nil {
		return "", fmt.Errorf("执行 JavaScript 失败: %v", err)
	}

	return result.String(), nil
}

// callAI 调用 AI 服务
func (p *AIProcessActionPlugin) callAI(config *models.OpenAIConfig, systemPrompt, userPrompt string, maxTokens int, temperature float64) (string, error) {
	switch config.ChannelType {
	case models.AIChannelGemini:
		return p.callGemini(config, systemPrompt, userPrompt, maxTokens, temperature)
	case models.AIChannelClaude:
		return p.callClaude(config, systemPrompt, userPrompt, maxTokens, temperature)
	default:
		return p.callOpenAI(config, systemPrompt, userPrompt, maxTokens, temperature)
	}
}

// callOpenAI 调用 OpenAI 兼容 API
func (p *AIProcessActionPlugin) callOpenAI(config *models.OpenAIConfig, systemPrompt, userPrompt string, maxTokens int, temperature float64) (string, error) {
	messages := []map[string]string{}
	if systemPrompt != "" {
		messages = append(messages, map[string]string{"role": "system", "content": systemPrompt})
	}
	messages = append(messages, map[string]string{"role": "user", "content": userPrompt})

	reqBody := map[string]interface{}{
		"model":       config.Model,
		"messages":    messages,
		"max_tokens":  maxTokens,
		"temperature": temperature,
	}

	bodyBytes, _ := json.Marshal(reqBody)

	baseURL := config.BaseURL
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	// 智能处理 base_url，移除可能的路径后缀
	baseURL = strings.TrimSuffix(baseURL, "/")
	baseURL = strings.TrimSuffix(baseURL, "/v1/messages")
	baseURL = strings.TrimSuffix(baseURL, "/v1/chat/completions")
	baseURL = strings.TrimSuffix(baseURL, "/v1")
	url := baseURL + "/v1/chat/completions"

	log.Printf("[AIProcessAction] Calling OpenAI API: %s", url)

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+config.APIKey)

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	log.Printf("[AIProcessAction] OpenAI API response status=%d, body(first 500 chars)=%s", resp.StatusCode, truncate(string(respBody), 500))

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API 返回错误 %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &result); err == nil && len(result.Choices) > 0 {
		log.Printf("[AIProcessAction] Parsed as OpenAI format, choices=%d", len(result.Choices))
		return result.Choices[0].Message.Content, nil
	}

	// 尝试解析 Gemini 风格格式（可能被 proxy 包装）
	var geminiResult struct {
		Response struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		} `json:"response"`
		// 直接的 Gemini 格式
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(respBody, &geminiResult); err == nil {
		// 先检查 response.candidates
		if len(geminiResult.Response.Candidates) > 0 && len(geminiResult.Response.Candidates[0].Content.Parts) > 0 {
			log.Printf("[AIProcessAction] Parsed as Gemini wrapped format")
			return geminiResult.Response.Candidates[0].Content.Parts[0].Text, nil
		}
		// 再检查直接的 candidates
		if len(geminiResult.Candidates) > 0 && len(geminiResult.Candidates[0].Content.Parts) > 0 {
			log.Printf("[AIProcessAction] Parsed as direct Gemini format")
			return geminiResult.Candidates[0].Content.Parts[0].Text, nil
		}
	}

	return "", fmt.Errorf("无法解析 AI 响应: %s", truncate(string(respBody), 300))
}

// truncate 截断字符串
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// callGemini 调用 Gemini API
func (p *AIProcessActionPlugin) callGemini(config *models.OpenAIConfig, systemPrompt, userPrompt string, maxTokens int, temperature float64) (string, error) {
	combinedPrompt := userPrompt
	if systemPrompt != "" {
		combinedPrompt = systemPrompt + "\n\n" + userPrompt
	}

	reqBody := map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"role": "user",
				"parts": []map[string]interface{}{
					{"text": combinedPrompt},
				},
			},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     temperature,
			"maxOutputTokens": maxTokens,
		},
	}

	bodyBytes, _ := json.Marshal(reqBody)

	baseURL := config.BaseURL
	if baseURL == "" {
		baseURL = "https://generativelanguage.googleapis.com"
	}
	url := fmt.Sprintf("%s/v1beta/models/%s:generateContent?key=%s",
		strings.TrimSuffix(baseURL, "/"), config.Model, config.APIKey)

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("Gemini API 返回错误 %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", err
	}

	if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("Gemini 未返回结果")
	}

	return result.Candidates[0].Content.Parts[0].Text, nil
}

// callClaude 调用 Claude API
func (p *AIProcessActionPlugin) callClaude(config *models.OpenAIConfig, systemPrompt, userPrompt string, maxTokens int, temperature float64) (string, error) {
	reqBody := map[string]interface{}{
		"model":       config.Model,
		"max_tokens":  maxTokens,
		"temperature": temperature,
		"messages": []map[string]string{
			{"role": "user", "content": userPrompt},
		},
	}
	if systemPrompt != "" {
		reqBody["system"] = systemPrompt
	}

	bodyBytes, _ := json.Marshal(reqBody)

	baseURL := config.BaseURL
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	url := strings.TrimSuffix(baseURL, "/") + "/v1/messages"

	req, err := http.NewRequest("POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", config.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("Claude API 返回错误 %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", err
	}

	if len(result.Content) == 0 {
		return "", fmt.Errorf("Claude 未返回结果")
	}

	return result.Content[0].Text, nil
}

// ========== UI Schema ==========

// GetUISchema 获取 UI Schema
func (p *AIProcessActionPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			// AI 配置
			{
				Name:        "custom_channel_type",
				Label:       "AI 服务类型",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择 AI 服务提供商",
				Required:    true,
				Width:       "1/2",
				Options: []plugins.UIOption{
					{Value: "openai", Label: "OpenAI / 兼容 API"},
					{Value: "gemini", Label: "Google Gemini"},
					{Value: "claude", Label: "Anthropic Claude"},
				},
				DefaultValue: "openai",
			},
			{
				Name:         "custom_model",
				Label:        "模型名称",
				Type:         plugins.UIFieldTypeText,
				Description:  "模型名称，如 gpt-4, gemini-pro, claude-3-sonnet-20240229",
				Required:     true,
				Width:        "1/2",
				Placeholder:  "gpt-3.5-turbo",
				DefaultValue: "gpt-3.5-turbo",
			},
			{
				Name:        "custom_base_url",
				Label:       "API 地址",
				Type:        plugins.UIFieldTypeText,
				Description: "API 基础 URL（可选，留空使用默认）",
				Required:    false,
				Width:       "full",
				Placeholder: "https://api.openai.com",
			},
			{
				Name:        "custom_api_key",
				Label:       "API Key",
				Type:        plugins.UIFieldTypeText,
				Description: "API 密钥",
				Required:    true,
				Width:       "full",
				Placeholder: "sk-...",
			},
			// 提示词
			{
				Name:        "system_prompt",
				Label:       "系统提示词",
				Type:        plugins.UIFieldTypeCode,
				Description: "定义 AI 的角色和行为（可选）",
				Required:    false,
				Width:       "full",
				Placeholder: "你是一个邮件处理助手...",
			},
			{
				Name:        "user_prompt",
				Label:       "用户提示词",
				Type:        plugins.UIFieldTypeGoTemplate,
				Description: "发送给 AI 的请求，支持变量如 {{.Subject}}, {{.Body}}",
				Required:    true,
				Width:       "full",
				Placeholder: "请总结以下邮件：\n\n主题：{{.Subject}}\n正文：{{.Body}}",
			},
			// 模板引擎
			{
				Name:        "template_engine",
				Label:       "变量格式化引擎",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择提示词中变量的格式化方式",
				Required:    false,
				Width:       "1/2",
				Options: []plugins.UIOption{
					{Value: "gotemplate", Label: "Go Template", Description: "使用 {{.Variable}} 语法"},
					{Value: "javascript", Label: "JavaScript", Description: "使用 JS 表达式"},
				},
				DefaultValue: "gotemplate",
			},
			// AI 参数
			{
				Name:         "max_tokens",
				Label:        "最大 Token",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "AI 回复的最大长度",
				Required:     false,
				Width:        "1/4",
				DefaultValue: 1000,
			},
			{
				Name:         "temperature",
				Label:        "温度",
				Type:         plugins.UIFieldTypeNumber,
				Description:  "创意程度 0-2",
				Required:     false,
				Width:        "1/4",
				DefaultValue: 0.7,
			},
			// 输出
			{
				Name:        "output_mode",
				Label:       "输出模式",
				Type:        plugins.UIFieldTypeSelect,
				Description: "如何使用 AI 回复",
				Required:    true,
				Width:       "1/2",
				Options: []plugins.UIOption{
					{Value: "set_variable", Label: "设置变量"},
				},
				DefaultValue: "set_variable",
			},
			{
				Name:        "target_variable",
				Label:       "目标变量名",
				Type:        plugins.UIFieldTypeText,
				Description: "保存 AI 回复的变量名，后续可通过 $.变量名 访问",
				Required:    true,
				Width:       "1/2",
				Placeholder: "ai_response",
				Validation: &plugins.UIValidation{
					Pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$",
					Message: "变量名必须以字母或下划线开头",
				},
			},
			// 变量元数据
			{
				Name:        "variable_description",
				Label:       "变量描述",
				Type:        plugins.UIFieldTypeText,
				Description: "描述该变量的用途",
				Required:    false,
				Width:       "full",
				Placeholder: "AI 生成的邮件摘要",
			},
		},
		HelpText: "使用 AI 服务（OpenAI/Gemini/Claude）处理邮件内容。可以用 Go Template 语法在提示词中引用邮件变量，结果保存为变量供后续动作使用。",
	}
}

// ========== ActionPluginWithUI 接口实现 ==========

// GetDynamicOptions 获取动态选项
func (p *AIProcessActionPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	// 目前不需要动态选项
	return []plugins.UIOption{}, nil
}

// ValidateFieldValue 验证字段值
func (p *AIProcessActionPlugin) ValidateFieldValue(field string, value interface{}) error {
	switch field {
	case "custom_api_key":
		if v, ok := value.(string); ok && v == "" {
			return fmt.Errorf("API Key 不能为空")
		}
	case "target_variable":
		if v, ok := value.(string); ok && v == "" {
			return fmt.Errorf("变量名不能为空")
		}
	}
	return nil
}

// GetFieldSuggestions 获取字段建议
func (p *AIProcessActionPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	switch field {
	case "custom_model":
		models := []string{
			"gpt-3.5-turbo", "gpt-4", "gpt-4-turbo",
			"gemini-pro", "gemini-1.5-pro",
			"claude-3-sonnet-20240229", "claude-3-haiku-20240307",
		}
		if prefix == "" {
			return models, nil
		}
		var filtered []string
		for _, m := range models {
			if strings.Contains(strings.ToLower(m), strings.ToLower(prefix)) {
				filtered = append(filtered, m)
			}
		}
		return filtered, nil
	}
	return []string{}, nil
}
