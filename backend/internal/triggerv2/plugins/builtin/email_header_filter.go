package builtin

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

type EmailHeaderFilterPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

type headerFilterRule struct {
	Name     string
	Operator string
	Value    string
}

func NewEmailHeaderFilterPlugin() plugins.ConditionPlugin {
	return &EmailHeaderFilterPlugin{
		info: &plugins.PluginInfo{
			ID:          "email_header_filter",
			Name:        "邮件头过滤",
			Version:     "1.0.0",
			Description: "根据邮件头字段匹配邮件，适合 SPF/DKIM/DMARC、Message-ID、List-ID 等治理场景",
			Author:      "Mailman",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"rules": map[string]interface{}{
						"type":        "array",
						"description": "邮件头匹配规则列表",
					},
					"match_mode": map[string]interface{}{
						"type":        "string",
						"description": "匹配模式：all 表示全部规则命中，any 表示任一规则命中",
						"default":     "all",
						"enum":        []string{"all", "any"},
					},
					"case_sensitive": map[string]interface{}{
						"type":        "boolean",
						"description": "是否区分大小写",
						"default":     false,
					},
				},
			},
			DefaultConfig: map[string]interface{}{
				"rules":          []interface{}{},
				"match_mode":     "all",
				"case_sensitive": false,
			},
			Permissions: []string{plugins.PermissionRead},
			Sandbox:     true,
			MinVersion:  "1.0.0",
		},
		config: make(map[string]interface{}),
	}
}

func (p *EmailHeaderFilterPlugin) GetInfo() *plugins.PluginInfo { return p.info }

func (p *EmailHeaderFilterPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "rules",
				Label:       "邮件头规则",
				Type:        plugins.UIFieldTypeJSON,
				Description: "JSON 数组，例如 [{\"name\":\"Authentication-Results\",\"operator\":\"contains\",\"value\":\"dmarc=fail\"}]",
				Required:    true,
				Width:       "full",
			},
			{
				Name:         "match_mode",
				Label:        "匹配模式",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "多条规则之间的组合方式",
				Required:     true,
				Width:        "half",
				DefaultValue: "all",
				Options: []plugins.UIOption{
					{Value: "all", Label: "全部命中", Description: "所有邮件头规则都必须命中"},
					{Value: "any", Label: "任一命中", Description: "任意一条规则命中即可"},
				},
			},
			{
				Name:         "case_sensitive",
				Label:        "区分大小写",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否区分大小写比较邮件头值",
				Required:     false,
				Width:        "half",
				DefaultValue: false,
			},
		},
		Operators: []plugins.UIOperator{
			{Value: "exists", Label: "存在", ApplicableTo: []string{"text"}},
			{Value: "not_exists", Label: "不存在", ApplicableTo: []string{"text"}},
			{Value: "equals", Label: "等于", ApplicableTo: []string{"text"}},
			{Value: "contains", Label: "包含", ApplicableTo: []string{"text"}},
			{Value: "matches", Label: "匹配正则", ApplicableTo: []string{"text"}},
		},
		Layout:            "vertical",
		AllowCustomFields: true,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "用于基于邮件头做治理、审计或安全条件判断。",
	}
}

func (p *EmailHeaderFilterPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = cloneConfig(p.info.DefaultConfig)
	if ctx != nil && ctx.Config != nil && ctx.Config.Config != nil {
		return p.ApplyConfig(ctx.Config.Config)
	}
	return nil
}
func (p *EmailHeaderFilterPlugin) Cleanup() error  { return nil }
func (p *EmailHeaderFilterPlugin) OnLoad() error   { return nil }
func (p *EmailHeaderFilterPlugin) OnUnload() error { return nil }
func (p *EmailHeaderFilterPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}
func (p *EmailHeaderFilterPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}
func (p *EmailHeaderFilterPlugin) GetDefaultConfig() map[string]interface{} {
	return cloneConfig(p.info.DefaultConfig)
}

func (p *EmailHeaderFilterPlugin) ValidateConfig(config map[string]interface{}) error {
	if mode, ok := config["match_mode"].(string); ok && mode != "all" && mode != "any" {
		return fmt.Errorf("match_mode must be all or any")
	}
	if _, err := headerRulesFromConfig(config); err != nil {
		return err
	}
	return nil
}

func (p *EmailHeaderFilterPlugin) ApplyConfig(config map[string]interface{}) error {
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

func (p *EmailHeaderFilterPlugin) HealthCheck() error { return nil }
func (p *EmailHeaderFilterPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"evaluations": p.info.UsageCount,
		"last_used":   p.info.LastUsed,
		"status":      p.info.Status,
	}
}

func (p *EmailHeaderFilterPlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	start := time.Now()
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	config := p.config
	if len(config) == 0 && ctx != nil && ctx.Config != nil && ctx.Config.Config != nil {
		config = ctx.Config.Config
	}
	rules, err := headerRulesFromConfig(config)
	if err != nil {
		return &plugins.PluginResult{Success: false, Error: err.Error(), ExecutionTime: time.Since(start), Timestamp: time.Now()}, nil
	}
	if len(rules) == 0 {
		return &plugins.PluginResult{
			Success:       true,
			Data:          map[string]interface{}{"matched": false, "reason": "未配置邮件头规则"},
			ExecutionTime: time.Since(start),
			Timestamp:     time.Now(),
		}, nil
	}

	headers := eventEmailHeaders(event)
	mode := stringConfig(config, "match_mode", "all")
	caseSensitive := boolConfig(config, "case_sensitive", false)

	results := make([]map[string]interface{}, 0, len(rules))
	matchedCount := 0
	for _, rule := range rules {
		matched, headerValue, err := evaluateHeaderRule(headers, rule, caseSensitive)
		if err != nil {
			return &plugins.PluginResult{Success: false, Error: err.Error(), ExecutionTime: time.Since(start), Timestamp: time.Now()}, nil
		}
		if matched {
			matchedCount++
		}
		results = append(results, map[string]interface{}{
			"name":          rule.Name,
			"operator":      rule.Operator,
			"value":         rule.Value,
			"header_value":  headerValue,
			"matched":       matched,
			"header_exists": headerValue != "",
		})
	}

	final := matchedCount == len(rules)
	if mode == "any" {
		final = matchedCount > 0
	}

	return &plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"matched":       final,
			"match_mode":    mode,
			"matched_count": matchedCount,
			"total_rules":   len(rules),
			"results":       results,
		},
		ExecutionTime: time.Since(start),
		Timestamp:     time.Now(),
	}, nil
}

func (p *EmailHeaderFilterPlugin) GetDescription() string { return p.info.Description }
func (p *EmailHeaderFilterPlugin) GetSupportedEventTypes() []string {
	return []string{string(models.EventTypeEmailReceived), string(models.EventTypeEmailUpdated)}
}
func (p *EmailHeaderFilterPlugin) GetRequiredFields() []string { return []string{"headers"} }

func headerRulesFromConfig(config map[string]interface{}) ([]headerFilterRule, error) {
	raw, ok := config["rules"]
	if !ok || raw == nil {
		if name := stringConfig(config, "header_name", ""); name != "" {
			return []headerFilterRule{{
				Name:     name,
				Operator: stringConfig(config, "operator", "contains"),
				Value:    stringConfig(config, "value", ""),
			}}, nil
		}
		return nil, nil
	}

	items, ok := raw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("rules must be an array")
	}
	rules := make([]headerFilterRule, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("each header rule must be an object")
		}
		rule := headerFilterRule{
			Name:     strings.TrimSpace(firstString(m, "name", "header", "header_name")),
			Operator: strings.TrimSpace(firstString(m, "operator", "op")),
			Value:    firstString(m, "value"),
		}
		if rule.Operator == "" {
			rule.Operator = "contains"
		}
		if rule.Name == "" {
			return nil, fmt.Errorf("header rule name is required")
		}
		rules = append(rules, rule)
	}
	return rules, nil
}

func evaluateHeaderRule(headers map[string]string, rule headerFilterRule, caseSensitive bool) (bool, string, error) {
	headerValue := headers[strings.ToLower(rule.Name)]
	switch rule.Operator {
	case "exists":
		return headerValue != "", headerValue, nil
	case "not_exists":
		return headerValue == "", headerValue, nil
	}

	left := headerValue
	right := rule.Value
	if !caseSensitive {
		left = strings.ToLower(left)
		right = strings.ToLower(right)
	}

	switch rule.Operator {
	case "equals":
		return left == right, headerValue, nil
	case "contains":
		return strings.Contains(left, right), headerValue, nil
	case "starts_with":
		return strings.HasPrefix(left, right), headerValue, nil
	case "ends_with":
		return strings.HasSuffix(left, right), headerValue, nil
	case "matches":
		re, err := regexp.Compile(rule.Value)
		if err != nil {
			return false, headerValue, fmt.Errorf("invalid header regex for %s: %w", rule.Name, err)
		}
		return re.MatchString(headerValue), headerValue, nil
	default:
		return false, headerValue, fmt.Errorf("unsupported header operator: %s", rule.Operator)
	}
}

func cloneConfig(config map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{}, len(config))
	for key, value := range config {
		result[key] = value
	}
	return result
}

func stringConfig(config map[string]interface{}, key string, fallback string) string {
	if config == nil {
		return fallback
	}
	if value, ok := config[key].(string); ok {
		return value
	}
	return fallback
}

func boolConfig(config map[string]interface{}, key string, fallback bool) bool {
	if config == nil {
		return fallback
	}
	if value, ok := config[key].(bool); ok {
		return value
	}
	return fallback
}
