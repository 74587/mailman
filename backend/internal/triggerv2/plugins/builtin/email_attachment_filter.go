package builtin

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

type EmailAttachmentFilterPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

func NewEmailAttachmentFilterPlugin() plugins.ConditionPlugin {
	return &EmailAttachmentFilterPlugin{
		info: &plugins.PluginInfo{
			ID:          "email_attachment_filter",
			Name:        "附件过滤",
			Version:     "1.0.0",
			Description: "根据附件数量、扩展名、文件名和总大小筛选邮件",
			Author:      "Mailman",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"min_count":          map[string]interface{}{"type": "integer", "default": 1},
					"max_count":          map[string]interface{}{"type": "integer", "default": 0},
					"allowed_extensions": map[string]interface{}{"type": "array"},
					"blocked_extensions": map[string]interface{}{"type": "array"},
					"filename_contains":  map[string]interface{}{"type": "string"},
					"min_total_size":     map[string]interface{}{"type": "string"},
					"max_total_size":     map[string]interface{}{"type": "string"},
				},
			},
			DefaultConfig: map[string]interface{}{
				"min_count":          1,
				"max_count":          0,
				"allowed_extensions": []string{},
				"blocked_extensions": []string{},
				"filename_contains":  "",
				"min_total_size":     "",
				"max_total_size":     "",
			},
			Permissions: []string{plugins.PermissionRead},
			Sandbox:     true,
			MinVersion:  "1.0.0",
		},
		config: make(map[string]interface{}),
	}
}

func (p *EmailAttachmentFilterPlugin) GetInfo() *plugins.PluginInfo { return p.info }

func (p *EmailAttachmentFilterPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{Name: "min_count", Label: "最少附件数", Type: plugins.UIFieldTypeNumber, Description: "邮件至少包含多少个附件", Required: false, Width: "half", DefaultValue: 1, Min: 0},
			{Name: "max_count", Label: "最多附件数", Type: plugins.UIFieldTypeNumber, Description: "0 表示不限制", Required: false, Width: "half", DefaultValue: 0, Min: 0},
			{Name: "allowed_extensions", Label: "允许扩展名", Type: plugins.UIFieldTypeMultiSelect, Description: "只匹配这些扩展名，留空则不限制", Placeholder: "pdf, docx, xlsx", Required: false, Width: "full"},
			{Name: "blocked_extensions", Label: "阻止扩展名", Type: plugins.UIFieldTypeMultiSelect, Description: "命中这些扩展名则不匹配", Placeholder: "exe, js, vbs", Required: false, Width: "full"},
			{Name: "filename_contains", Label: "文件名包含", Type: plugins.UIFieldTypeText, Description: "附件文件名必须包含的文本", Required: false, Width: "full"},
			{Name: "min_total_size", Label: "最小总大小", Type: plugins.UIFieldTypeText, Description: "例如 10KB、5MB", Required: false, Width: "half"},
			{Name: "max_total_size", Label: "最大总大小", Type: plugins.UIFieldTypeText, Description: "例如 25MB", Required: false, Width: "half"},
		},
		Operators: []plugins.UIOperator{
			{Value: "greater_than", Label: "大于", ApplicableTo: []string{"number"}},
			{Value: "less_than", Label: "小于", ApplicableTo: []string{"number"}},
			{Value: "contains", Label: "包含", ApplicableTo: []string{"text", "multi_select"}},
		},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "用于附件审批、报价单/发票识别、阻断高风险附件等场景。",
	}
}

func (p *EmailAttachmentFilterPlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = cloneConfig(p.info.DefaultConfig)
	if ctx != nil && ctx.Config != nil && ctx.Config.Config != nil {
		return p.ApplyConfig(ctx.Config.Config)
	}
	return nil
}
func (p *EmailAttachmentFilterPlugin) Cleanup() error  { return nil }
func (p *EmailAttachmentFilterPlugin) OnLoad() error   { return nil }
func (p *EmailAttachmentFilterPlugin) OnUnload() error { return nil }
func (p *EmailAttachmentFilterPlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}
func (p *EmailAttachmentFilterPlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}
func (p *EmailAttachmentFilterPlugin) GetDefaultConfig() map[string]interface{} {
	return cloneConfig(p.info.DefaultConfig)
}

func (p *EmailAttachmentFilterPlugin) ValidateConfig(config map[string]interface{}) error {
	if min := int64FromAny(config["min_count"]); min < 0 {
		return fmt.Errorf("min_count must be >= 0")
	}
	if max := int64FromAny(config["max_count"]); max < 0 {
		return fmt.Errorf("max_count must be >= 0")
	}
	for _, key := range []string{"allowed_extensions", "blocked_extensions"} {
		if value, ok := config[key]; ok && value != nil {
			switch value.(type) {
			case []string, []interface{}, string:
			default:
				return fmt.Errorf("%s must be an array or string", key)
			}
		}
	}
	for _, key := range []string{"min_total_size", "max_total_size"} {
		if value := stringConfig(config, key, ""); value != "" {
			if _, err := parseByteSize(value); err != nil {
				return fmt.Errorf("%s is invalid: %w", key, err)
			}
		}
	}
	return nil
}

func (p *EmailAttachmentFilterPlugin) ApplyConfig(config map[string]interface{}) error {
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

func (p *EmailAttachmentFilterPlugin) HealthCheck() error { return nil }
func (p *EmailAttachmentFilterPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{"evaluations": p.info.UsageCount, "last_used": p.info.LastUsed, "status": p.info.Status}
}

func (p *EmailAttachmentFilterPlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	start := time.Now()
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	config := p.config
	if len(config) == 0 && ctx != nil && ctx.Config != nil && ctx.Config.Config != nil {
		config = ctx.Config.Config
	}

	attachments := eventEmailAttachments(event)
	totalSize := int64(0)
	extensions := make([]string, 0, len(attachments))
	names := make([]string, 0, len(attachments))
	for _, attachment := range attachments {
		totalSize += attachment.Size
		ext := normalizeExtension(filepath.Ext(attachment.Filename))
		if ext != "" {
			extensions = append(extensions, ext)
		}
		names = append(names, attachment.Filename)
	}

	minCount := int(int64FromAnyWithDefault(config["min_count"], 1))
	maxCount := int(int64FromAny(config["max_count"]))
	allowed := normalizeExtensions(stringListFromConfig(config["allowed_extensions"]))
	blocked := normalizeExtensions(stringListFromConfig(config["blocked_extensions"]))
	filenameContains := strings.ToLower(strings.TrimSpace(stringConfig(config, "filename_contains", "")))

	matched := true
	reasons := []string{}
	if len(attachments) < minCount {
		matched = false
		reasons = append(reasons, fmt.Sprintf("附件数量 %d 小于最少要求 %d", len(attachments), minCount))
	}
	if maxCount > 0 && len(attachments) > maxCount {
		matched = false
		reasons = append(reasons, fmt.Sprintf("附件数量 %d 超过最多限制 %d", len(attachments), maxCount))
	}
	if len(allowed) > 0 && !anyExtensionIn(extensions, allowed) {
		matched = false
		reasons = append(reasons, "附件扩展名不在允许列表中")
	}
	if len(blocked) > 0 && anyExtensionIn(extensions, blocked) {
		matched = false
		reasons = append(reasons, "附件扩展名命中阻止列表")
	}
	if filenameContains != "" && !anyFilenameContains(names, filenameContains) {
		matched = false
		reasons = append(reasons, "没有附件文件名包含指定文本")
	}
	if minSize, err := parseOptionalByteSize(config, "min_total_size"); err == nil && minSize > 0 && totalSize < minSize {
		matched = false
		reasons = append(reasons, "附件总大小小于最小限制")
	}
	if maxSize, err := parseOptionalByteSize(config, "max_total_size"); err == nil && maxSize > 0 && totalSize > maxSize {
		matched = false
		reasons = append(reasons, "附件总大小超过最大限制")
	}
	if matched {
		reasons = append(reasons, "附件条件匹配")
	}

	return &plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"matched":          matched,
			"reasons":          reasons,
			"attachment_count": len(attachments),
			"total_size":       totalSize,
			"extensions":       extensions,
			"filenames":        names,
		},
		ExecutionTime: time.Since(start),
		Timestamp:     time.Now(),
	}, nil
}

func (p *EmailAttachmentFilterPlugin) GetDescription() string { return p.info.Description }
func (p *EmailAttachmentFilterPlugin) GetSupportedEventTypes() []string {
	return []string{string(models.EventTypeEmailReceived), string(models.EventTypeEmailUpdated)}
}
func (p *EmailAttachmentFilterPlugin) GetRequiredFields() []string { return []string{"attachments"} }

func int64FromAnyWithDefault(value interface{}, fallback int64) int64 {
	if value == nil {
		return fallback
	}
	return int64FromAny(value)
}

func normalizeExtension(ext string) string {
	ext = strings.TrimSpace(strings.ToLower(ext))
	ext = strings.TrimPrefix(ext, ".")
	return ext
}

func normalizeExtensions(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if ext := normalizeExtension(value); ext != "" {
			result = append(result, ext)
		}
	}
	return result
}

func anyExtensionIn(have []string, expected []string) bool {
	set := make(map[string]struct{}, len(expected))
	for _, ext := range expected {
		set[ext] = struct{}{}
	}
	for _, ext := range have {
		if _, ok := set[ext]; ok {
			return true
		}
	}
	return false
}

func anyFilenameContains(names []string, needle string) bool {
	for _, name := range names {
		if strings.Contains(strings.ToLower(name), needle) {
			return true
		}
	}
	return false
}

func parseOptionalByteSize(config map[string]interface{}, key string) (int64, error) {
	value := strings.TrimSpace(stringConfig(config, key, ""))
	if value == "" {
		return 0, nil
	}
	return parseByteSize(value)
}

func parseByteSize(value string) (int64, error) {
	normalized := strings.TrimSpace(strings.ToUpper(value))
	if normalized == "" {
		return 0, nil
	}
	units := []struct {
		suffix     string
		multiplier int64
	}{
		{"GB", 1024 * 1024 * 1024},
		{"MB", 1024 * 1024},
		{"KB", 1024},
		{"B", 1},
	}
	for _, unit := range units {
		if strings.HasSuffix(normalized, unit.suffix) {
			number := strings.TrimSpace(strings.TrimSuffix(normalized, unit.suffix))
			if number == "" {
				return 0, fmt.Errorf("missing size number")
			}
			parsed, err := strconv.ParseFloat(number, 64)
			if err != nil {
				return 0, err
			}
			return int64(parsed * float64(unit.multiplier)), nil
		}
	}
	parsed, err := strconv.ParseFloat(normalized, 64)
	if err != nil {
		return 0, err
	}
	return int64(parsed), nil
}
