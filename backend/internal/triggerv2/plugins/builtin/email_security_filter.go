package builtin

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

type EmailSecurityFilterPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

func NewEmailSecurityFilterPlugin() plugins.ConditionPlugin {
	return &EmailSecurityFilterPlugin{
		info: &plugins.PluginInfo{
			ID:          "email_security_filter",
			Name:        "邮件安全风险过滤",
			Version:     "1.0.0",
			Description: "基于认证失败、可执行附件、可疑链接和紧急话术计算邮件风险分",
			Author:      "Mailman",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"risk_threshold":               map[string]interface{}{"type": "integer", "default": 50},
					"check_authentication":         map[string]interface{}{"type": "boolean", "default": true},
					"check_executable_attachments": map[string]interface{}{"type": "boolean", "default": true},
					"check_suspicious_links":       map[string]interface{}{"type": "boolean", "default": true},
					"check_urgent_language":        map[string]interface{}{"type": "boolean", "default": true},
				},
			},
			DefaultConfig: map[string]interface{}{
				"risk_threshold":               50,
				"check_authentication":         true,
				"check_executable_attachments": true,
				"check_suspicious_links":       true,
				"check_urgent_language":        true,
			},
			Permissions: []string{plugins.PermissionRead},
			Sandbox:     true,
			MinVersion:  "1.0.0",
		},
		config: make(map[string]interface{}),
	}
}

func (p *EmailSecurityFilterPlugin) GetInfo() *plugins.PluginInfo { return p.info }

func (p *EmailSecurityFilterPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{Name: "risk_threshold", Label: "风险阈值", Type: plugins.UIFieldTypeNumber, Description: "风险分达到该值时条件命中", Required: true, Width: "half", DefaultValue: 50, Min: 0, Max: 100},
			{Name: "check_authentication", Label: "检查认证失败", Type: plugins.UIFieldTypeBoolean, Description: "检查 SPF/DKIM/DMARC 失败邮件头", Required: false, Width: "half", DefaultValue: true},
			{Name: "check_executable_attachments", Label: "检查高危附件", Type: plugins.UIFieldTypeBoolean, Description: "检查 exe/js/vbs/ps1 等高危扩展名", Required: false, Width: "half", DefaultValue: true},
			{Name: "check_suspicious_links", Label: "检查可疑链接", Type: plugins.UIFieldTypeBoolean, Description: "检查 IP 链接、短链、punycode 和明文 HTTP", Required: false, Width: "half", DefaultValue: true},
			{Name: "check_urgent_language", Label: "检查紧急话术", Type: plugins.UIFieldTypeBoolean, Description: "检查常见钓鱼邮件中的紧急/密码/付款话术", Required: false, Width: "half", DefaultValue: true},
		},
		Operators: []plugins.UIOperator{
			{Value: "greater_than", Label: "风险分大于", ApplicableTo: []string{"number"}},
			{Value: "less_than", Label: "风险分小于", ApplicableTo: []string{"number"}},
		},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "用于安全自动化：隔离高风险邮件、打标签、通知安全负责人。",
	}
}

func (p *EmailSecurityFilterPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = cloneConfig(p.info.DefaultConfig)
	if ctx != nil && ctx.Config != nil && ctx.Config.Config != nil {
		return p.ApplyConfig(ctx.Config.Config)
	}
	return nil
}
func (p *EmailSecurityFilterPlugin) Cleanup() error  { return nil }
func (p *EmailSecurityFilterPlugin) OnLoad() error   { return nil }
func (p *EmailSecurityFilterPlugin) OnUnload() error { return nil }
func (p *EmailSecurityFilterPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}
func (p *EmailSecurityFilterPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}
func (p *EmailSecurityFilterPlugin) GetDefaultConfig() map[string]interface{} {
	return cloneConfig(p.info.DefaultConfig)
}

func (p *EmailSecurityFilterPlugin) ValidateConfig(config map[string]interface{}) error {
	threshold := int64FromAnyWithDefault(config["risk_threshold"], 50)
	if threshold < 0 || threshold > 100 {
		return fmt.Errorf("risk_threshold must be between 0 and 100")
	}
	return nil
}

func (p *EmailSecurityFilterPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}
	if p.config == nil {
		p.config = make(map[string]interface{})
	}
	for key, value := range config {
		p.config[key] = value
	}
	return nil
}

func (p *EmailSecurityFilterPlugin) HealthCheck() error { return nil }
func (p *EmailSecurityFilterPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{"evaluations": p.info.UsageCount, "last_used": p.info.LastUsed, "status": p.info.Status}
}

func (p *EmailSecurityFilterPlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	start := time.Now()
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	config := p.config
	if len(config) == 0 && ctx != nil && ctx.Config != nil && ctx.Config.Config != nil {
		config = ctx.Config.Config
	}

	score := 0
	reasons := []string{}
	headers := eventEmailHeaders(event)
	subject, body := eventEmailText(event)
	attachments := eventEmailAttachments(event)

	if boolConfig(config, "check_authentication", true) {
		if points, reason := authenticationRisk(headers); points > 0 {
			score += points
			reasons = append(reasons, reason)
		}
	}
	if boolConfig(config, "check_executable_attachments", true) {
		if points, reason := executableAttachmentRisk(attachments); points > 0 {
			score += points
			reasons = append(reasons, reason)
		}
	}
	if boolConfig(config, "check_suspicious_links", true) {
		if points, reason := suspiciousLinkRisk(body); points > 0 {
			score += points
			reasons = append(reasons, reason)
		}
	}
	if boolConfig(config, "check_urgent_language", true) {
		if points, reason := urgentLanguageRisk(subject + " " + body); points > 0 {
			score += points
			reasons = append(reasons, reason)
		}
	}
	if score > 100 {
		score = 100
	}

	threshold := int(int64FromAnyWithDefault(config["risk_threshold"], 50))
	matched := score >= threshold
	if len(reasons) == 0 {
		reasons = append(reasons, "未发现内置安全风险信号")
	}

	return &plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"matched":        matched,
			"risk_score":     score,
			"risk_threshold": threshold,
			"reasons":        reasons,
		},
		ExecutionTime: time.Since(start),
		Timestamp:     time.Now(),
	}, nil
}

func (p *EmailSecurityFilterPlugin) GetDescription() string { return p.info.Description }
func (p *EmailSecurityFilterPlugin) GetSupportedEventTypes() []string {
	return []string{string(models.EventTypeEmailReceived), string(models.EventTypeEmailUpdated)}
}
func (p *EmailSecurityFilterPlugin) GetRequiredFields() []string {
	return []string{"headers", "attachments", "body"}
}

func authenticationRisk(headers map[string]string) (int, string) {
	auth := strings.ToLower(headers["authentication-results"] + " " + headers["received-spf"])
	score := 0
	reasons := []string{}
	for token, points := range map[string]int{"spf=fail": 20, "dkim=fail": 20, "dmarc=fail": 30, "softfail": 10} {
		if strings.Contains(auth, token) {
			score += points
			reasons = append(reasons, token)
		}
	}
	if score == 0 {
		return 0, ""
	}
	return score, "认证失败信号: " + strings.Join(reasons, ", ")
}

func executableAttachmentRisk(attachments []emailAttachmentSummary) (int, string) {
	dangerous := map[string]bool{
		"exe": true, "scr": true, "bat": true, "cmd": true, "com": true,
		"js": true, "jse": true, "vbs": true, "vbe": true, "wsf": true,
		"ps1": true, "jar": true, "docm": true, "xlsm": true, "pptm": true,
	}
	hits := []string{}
	for _, attachment := range attachments {
		ext := normalizeExtension(filepath.Ext(attachment.Filename))
		if dangerous[ext] {
			hits = append(hits, attachment.Filename)
		}
	}
	if len(hits) == 0 {
		return 0, ""
	}
	return 40, "包含高危附件: " + strings.Join(hits, ", ")
}

func suspiciousLinkRisk(body string) (int, string) {
	text := strings.ToLower(body)
	score := 0
	reasons := []string{}
	if strings.Contains(text, "http://") {
		score += 10
		reasons = append(reasons, "明文 HTTP 链接")
	}
	if regexp.MustCompile(`https?://\d{1,3}(\.\d{1,3}){3}`).FindString(text) != "" {
		score += 25
		reasons = append(reasons, "IP 地址链接")
	}
	for _, host := range []string{"bit.ly", "tinyurl.com", "t.co/", "goo.gl", "ow.ly"} {
		if strings.Contains(text, host) {
			score += 15
			reasons = append(reasons, "短链接")
			break
		}
	}
	if strings.Contains(text, "xn--") {
		score += 20
		reasons = append(reasons, "punycode 域名")
	}
	if score == 0 {
		return 0, ""
	}
	return score, "可疑链接信号: " + strings.Join(reasons, ", ")
}

func urgentLanguageRisk(text string) (int, string) {
	lower := strings.ToLower(text)
	hits := []string{}
	keywords := []string{
		"urgent", "immediately", "verify your account", "password expires",
		"payment overdue", "wire transfer", "invoice attached", "账号异常",
		"立即验证", "密码过期", "付款失败", "紧急",
	}
	for _, keyword := range keywords {
		if strings.Contains(lower, strings.ToLower(keyword)) {
			hits = append(hits, keyword)
		}
	}
	if len(hits) == 0 {
		return 0, ""
	}
	return 15, "紧急或钓鱼话术: " + strings.Join(hits, ", ")
}
