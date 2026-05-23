package builtin

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// EmailSizePlugin 邮件大小筛选插件
type EmailSizePlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewEmailSizePlugin 创建邮件大小筛选插件
func NewEmailSizePlugin() plugins.ConditionPlugin {
	return &EmailSizePlugin{
		info: &plugins.PluginInfo{
			ID:          "email_size",
			Name:        "邮件大小筛选",
			Version:     "1.0.0",
			Description: "根据邮件大小筛选邮件",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"min_size": map[string]interface{}{
						"type":        "string",
						"description": "最小大小（支持单位：B, KB, MB, GB）",
						"default":     "0B",
					},
					"max_size": map[string]interface{}{
						"type":        "string",
						"description": "最大大小（支持单位：B, KB, MB, GB）",
						"default":     "",
					},
					"size_field": map[string]interface{}{
						"type":        "string",
						"description": "大小字段: content（内容大小）, attachment（附件大小）, total（总大小）",
						"default":     "content",
						"enum":        []string{"content", "attachment", "total"},
					},
					"include_attachments": map[string]interface{}{
						"type":        "boolean",
						"description": "是否包含附件大小",
						"default":     true,
					},
					"attachment_filter": map[string]interface{}{
						"type":        "object",
						"description": "附件过滤配置",
						"properties": map[string]interface{}{
							"enabled": map[string]interface{}{
								"type":        "boolean",
								"description": "是否启用附件过滤",
								"default":     false,
							},
							"min_count": map[string]interface{}{
								"type":        "integer",
								"description": "最小附件数量",
								"default":     0,
								"minimum":     0,
							},
							"max_count": map[string]interface{}{
								"type":        "integer",
								"description": "最大附件数量",
								"default":     100,
								"minimum":     0,
							},
							"file_types": map[string]interface{}{
								"type":        "array",
								"description": "允许的文件类型（如：pdf, doc, jpg）",
								"items": map[string]interface{}{
									"type": "string",
								},
							},
						},
					},
				},
				"required": []string{"min_size"},
			},
			DefaultConfig: map[string]interface{}{
				"min_size":            "0B",
				"max_size":            "",
				"size_field":          "content",
				"include_attachments": true,
				"attachment_filter": map[string]interface{}{
					"enabled":    false,
					"min_count":  0,
					"max_count":  100,
					"file_types": []string{},
				},
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
func (p *EmailSizePlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// GetUISchema 获取UI架构
func (p *EmailSizePlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:         "size_type",
				Label:        "大小类型",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "指定邮件大小的类型",
				Required:     true,
				Width:        "half",
				DefaultValue: "total",
				Options: []plugins.UIOption{
					{Value: "total", Label: "总大小", Description: "邮件总大小"},
					{Value: "body", Label: "正文大小", Description: "邮件正文大小"},
					{Value: "attachments", Label: "附件大小", Description: "邮件附件大小"},
				},
			},
			{
				Name:         "unit",
				Label:        "大小单位",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "大小的单位",
				Required:     true,
				Width:        "half",
				DefaultValue: "MB",
				Options: []plugins.UIOption{
					{Value: "B", Label: "字节 (B)", Description: "字节"},
					{Value: "KB", Label: "千字节 (KB)", Description: "千字节"},
					{Value: "MB", Label: "兆字节 (MB)", Description: "兆字节"},
					{Value: "GB", Label: "吉字节 (GB)", Description: "吉字节"},
				},
			},
			{
				Name:        "min_size",
				Label:       "最小大小",
				Type:        plugins.UIFieldTypeNumber,
				Description: "最小邮件大小",
				Placeholder: "输入最小大小",
				Required:    false,
				Width:       "half",
				Min:         0,
			},
			{
				Name:        "max_size",
				Label:       "最大大小",
				Type:        plugins.UIFieldTypeNumber,
				Description: "最大邮件大小",
				Placeholder: "输入最大大小",
				Required:    false,
				Width:       "half",
				Min:         0,
			},
			{
				Name:         "include_attachments",
				Label:        "包含附件",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否包含附件大小",
				Required:     false,
				Width:        "half",
				DefaultValue: true,
			},
			{
				Name:         "attachment_filter_enabled",
				Label:        "启用附件筛选",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否启用附件筛选",
				Required:     false,
				Width:        "half",
				DefaultValue: false,
			},
			{
				Name:        "attachment_min_count",
				Label:       "最小附件数量",
				Type:        plugins.UIFieldTypeNumber,
				Description: "最小附件数量",
				Required:    false,
				Width:       "half",
				Min:         0,
				ShowIf:      map[string]interface{}{"attachment_filter_enabled": true},
			},
			{
				Name:        "attachment_max_count",
				Label:       "最大附件数量",
				Type:        plugins.UIFieldTypeNumber,
				Description: "最大附件数量",
				Required:    false,
				Width:       "half",
				Min:         0,
				ShowIf:      map[string]interface{}{"attachment_filter_enabled": true},
			},
		},
		Operators: []plugins.UIOperator{
			{Value: "greater_than", Label: "大于", ApplicableTo: []string{"number"}},
			{Value: "less_than", Label: "小于", ApplicableTo: []string{"number"}},
			{Value: "between", Label: "介于", ApplicableTo: []string{"number"}},
			{Value: "equals", Label: "等于", ApplicableTo: []string{"number"}},
		},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "根据邮件大小筛选邮件",
		Examples: []plugins.UIExample{
			{
				Title:       "筛选大邮件",
				Description: "只显示大于10MB的邮件",
				Expression: map[string]interface{}{
					"size_type":           "total",
					"unit":                "MB",
					"min_size":            10,
					"include_attachments": true,
				},
			},
			{
				Title:       "筛选有附件的邮件",
				Description: "只显示有附件的邮件",
				Expression: map[string]interface{}{
					"size_type":                 "attachments",
					"unit":                      "KB",
					"min_size":                  1,
					"attachment_filter_enabled": true,
					"attachment_min_count":      1,
				},
			},
		},
	}
}

// GetDynamicOptions 获取动态选项
func (p *EmailSizePlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	switch field {
	case "size_unit":
		return []plugins.UIOption{
			{Value: "B", Label: "字节 (B)", Description: "字节"},
			{Value: "KB", Label: "千字节 (KB)", Description: "千字节"},
			{Value: "MB", Label: "兆字节 (MB)", Description: "兆字节"},
			{Value: "GB", Label: "吉字节 (GB)", Description: "吉字节"},
		}, nil
	case "size_type":
		return []plugins.UIOption{
			{Value: "total", Label: "总大小", Description: "邮件总大小"},
			{Value: "attachments", Label: "附件大小", Description: "邮件附件大小"},
			{Value: "body", Label: "正文大小", Description: "邮件正文大小"},
		}, nil
	case "comparison":
		return []plugins.UIOption{
			{Value: "equal", Label: "等于", Description: "等于指定大小"},
			{Value: "greater", Label: "大于", Description: "大于指定大小"},
			{Value: "less", Label: "小于", Description: "小于指定大小"},
			{Value: "greater_equal", Label: "大于等于", Description: "大于等于指定大小"},
			{Value: "less_equal", Label: "小于等于", Description: "小于等于指定大小"},
			{Value: "between", Label: "介于", Description: "介于两个大小之间"},
		}, nil
	default:
		return nil, fmt.Errorf("unsupported field: %s", field)
	}
}

// ValidateFieldValue 验证字段值
func (p *EmailSizePlugin) ValidateFieldValue(field string, value interface{}) error {
	switch field {
	case "size_type":
		if sizeType, ok := value.(string); ok {
			validTypes := []string{"total", "attachments", "body"}
			for _, validType := range validTypes {
				if sizeType == validType {
					return nil
				}
			}
			return fmt.Errorf("invalid size_type: %s", sizeType)
		} else {
			return fmt.Errorf("size_type must be a string")
		}
	case "min_size", "max_size":
		if sizeValue, ok := value.(float64); ok {
			if sizeValue < 0 {
				return fmt.Errorf("%s must be non-negative", field)
			}
		} else {
			return fmt.Errorf("%s must be a number", field)
		}
	case "size_unit":
		if unit, ok := value.(string); ok {
			validUnits := []string{"B", "KB", "MB", "GB"}
			for _, validUnit := range validUnits {
				if unit == validUnit {
					return nil
				}
			}
			return fmt.Errorf("invalid size_unit: %s", unit)
		} else {
			return fmt.Errorf("size_unit must be a string")
		}
	case "comparison":
		if comparison, ok := value.(string); ok {
			validComparisons := []string{"equal", "greater", "less", "greater_equal", "less_equal", "between"}
			for _, validComparison := range validComparisons {
				if comparison == validComparison {
					return nil
				}
			}
			return fmt.Errorf("invalid comparison: %s", comparison)
		} else {
			return fmt.Errorf("comparison must be a string")
		}
	case "include_attachments":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("include_attachments must be a boolean")
		}
	default:
		return fmt.Errorf("unsupported field: %s", field)
	}
	return nil
}

// GetFieldSuggestions 获取字段建议
func (p *EmailSizePlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	switch field {
	case "size_unit":
		suggestions := []string{"B", "KB", "MB", "GB"}

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
	case "size_type":
		suggestions := []string{"total", "attachments", "body"}

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
	case "comparison":
		suggestions := []string{"equal", "greater", "less", "greater_equal", "less_equal", "between"}

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
func (p *EmailSizePlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = p.info.DefaultConfig
	return nil
}

// Cleanup 清理插件
func (p *EmailSizePlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *EmailSizePlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *EmailSizePlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *EmailSizePlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *EmailSizePlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *EmailSizePlugin) GetDefaultConfig() map[string]interface{} {
	return p.info.DefaultConfig
}

// ValidateConfig 验证配置
func (p *EmailSizePlugin) ValidateConfig(config map[string]interface{}) error {
	// 验证最小大小
	if minSize, ok := config["min_size"]; ok {
		if sizeStr, ok := minSize.(string); ok {
			if _, err := p.parseSize(sizeStr); err != nil {
				return fmt.Errorf("最小大小格式错误: %v", err)
			}
		} else {
			return fmt.Errorf("最小大小必须是字符串")
		}
	}

	// 验证最大大小
	if maxSize, ok := config["max_size"]; ok {
		if sizeStr, ok := maxSize.(string); ok && sizeStr != "" {
			if _, err := p.parseSize(sizeStr); err != nil {
				return fmt.Errorf("最大大小格式错误: %v", err)
			}
		}
	}

	// 验证大小字段
	if sizeField, ok := config["size_field"]; ok {
		if fieldStr, ok := sizeField.(string); ok {
			if fieldStr != "content" && fieldStr != "attachment" && fieldStr != "total" {
				return fmt.Errorf("大小字段必须是 'content', 'attachment', 或 'total'")
			}
		} else {
			return fmt.Errorf("大小字段必须是字符串")
		}
	}

	return nil
}

// ApplyConfig 应用配置
func (p *EmailSizePlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}

	for key, value := range config {
		p.config[key] = value
	}

	return nil
}

// HealthCheck 健康检查
func (p *EmailSizePlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *EmailSizePlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"evaluations": p.info.UsageCount,
		"last_used":   p.info.LastUsed,
		"status":      p.info.Status,
	}
}

// Evaluate 评估条件
func (p *EmailSizePlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
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

	// 从 ctx.Config.Config 获取用户配置的条件（优先）
	conditions := p.config
	if ctx.Config != nil && ctx.Config.Config != nil {
		conditions = ctx.Config.Config
	}

	// 获取配置
	minSizeStr := p.getMinSizeFromConfig(conditions)
	maxSizeStr := p.getMaxSizeFromConfig(conditions)
	sizeField := p.getSizeFieldFromConfig(conditions)
	includeAttachments := p.getIncludeAttachmentsFromConfig(conditions)
	attachmentFilter := p.getAttachmentFilterFromConfig(conditions)

	// 解析大小限制
	minSize, err := p.parseSize(minSizeStr)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("解析最小大小失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	var maxSize int64 = -1
	if maxSizeStr != "" {
		maxSize, err = p.parseSize(maxSizeStr)
		if err != nil {
			return &plugins.PluginResult{
				Success:       false,
				Error:         fmt.Sprintf("解析最大大小失败: %v", err),
				ExecutionTime: time.Since(startTime),
				Timestamp:     time.Now(),
			}, nil
		}
	}

	// 计算邮件大小（由于EmailEventData中没有大小字段，这里需要模拟）
	var emailSize int64
	switch sizeField {
	case "content":
		emailSize = p.calculateContentSize(emailData)
	case "attachment":
		emailSize = p.calculateAttachmentSize(emailData)
	case "total":
		emailSize = p.calculateTotalSize(emailData)
	default:
		emailSize = p.calculateContentSize(emailData)
	}

	// 检查大小匹配
	matched := emailSize >= minSize
	if maxSize > 0 && emailSize > maxSize {
		matched = false
	}

	// 检查附件过滤
	attachmentMatch := true
	if attachmentFilter["enabled"].(bool) && emailData.HasAttachment {
		attachmentMatch = p.checkAttachmentFilter(emailData, attachmentFilter)
	}

	finalResult := matched && attachmentMatch

	reason := ""
	if !matched {
		if emailSize < minSize {
			reason = fmt.Sprintf("邮件大小 %s 小于最小限制 %s", p.formatSize(emailSize), minSizeStr)
		} else if maxSize > 0 && emailSize > maxSize {
			reason = fmt.Sprintf("邮件大小 %s 超过最大限制 %s", p.formatSize(emailSize), maxSizeStr)
		}
	} else if !attachmentMatch {
		reason = "附件不符合过滤条件"
	} else {
		reason = fmt.Sprintf("邮件大小 %s 符合条件", p.formatSize(emailSize))
	}

	result := &plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"matched":             finalResult,
			"reason":              reason,
			"email_size":          emailSize,
			"formatted_size":      p.formatSize(emailSize),
			"size_field":          sizeField,
			"min_size":            minSize,
			"max_size":            maxSize,
			"include_attachments": includeAttachments,
			"attachment_filter":   attachmentFilter,
		},
		ExecutionTime: time.Since(startTime),
		Timestamp:     time.Now(),
	}

	return result, nil
}

// GetDescription 获取描述
func (p *EmailSizePlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *EmailSizePlugin) GetSupportedEventTypes() []string {
	return []string{
		string(models.EventTypeEmailReceived),
		string(models.EventTypeEmailUpdated),
	}
}

// GetRequiredFields 获取必需字段
func (p *EmailSizePlugin) GetRequiredFields() []string {
	return []string{"subject", "has_attachment"}
}

// 私有方法

// getMinSize 获取最小大小配置
func (p *EmailSizePlugin) getMinSize() string {
	return p.getMinSizeFromConfig(p.config)
}

// getMinSizeFromConfig 从指定配置获取最小大小
func (p *EmailSizePlugin) getMinSizeFromConfig(config map[string]interface{}) string {
	if minSize, ok := config["min_size"]; ok {
		if str, ok := minSize.(string); ok {
			return str
		}
	}
	return "0B"
}

// getMaxSize 获取最大大小配置
func (p *EmailSizePlugin) getMaxSize() string {
	return p.getMaxSizeFromConfig(p.config)
}

// getMaxSizeFromConfig 从指定配置获取最大大小
func (p *EmailSizePlugin) getMaxSizeFromConfig(config map[string]interface{}) string {
	if maxSize, ok := config["max_size"]; ok {
		if str, ok := maxSize.(string); ok {
			return str
		}
	}
	return ""
}

// getSizeField 获取大小字段配置
func (p *EmailSizePlugin) getSizeField() string {
	return p.getSizeFieldFromConfig(p.config)
}

// getSizeFieldFromConfig 从指定配置获取大小字段
func (p *EmailSizePlugin) getSizeFieldFromConfig(config map[string]interface{}) string {
	if sizeField, ok := config["size_field"]; ok {
		if str, ok := sizeField.(string); ok {
			return str
		}
	}
	return "content"
}

// getIncludeAttachments 获取是否包含附件配置
func (p *EmailSizePlugin) getIncludeAttachments() bool {
	return p.getIncludeAttachmentsFromConfig(p.config)
}

// getIncludeAttachmentsFromConfig 从指定配置获取是否包含附件
func (p *EmailSizePlugin) getIncludeAttachmentsFromConfig(config map[string]interface{}) bool {
	if includeAttachments, ok := config["include_attachments"]; ok {
		if b, ok := includeAttachments.(bool); ok {
			return b
		}
	}
	return true
}

// getAttachmentFilter 获取附件过滤配置
func (p *EmailSizePlugin) getAttachmentFilter() map[string]interface{} {
	return p.getAttachmentFilterFromConfig(p.config)
}

// getAttachmentFilterFromConfig 从指定配置获取附件过滤配置
func (p *EmailSizePlugin) getAttachmentFilterFromConfig(config map[string]interface{}) map[string]interface{} {
	if attachmentFilter, ok := config["attachment_filter"]; ok {
		if afMap, ok := attachmentFilter.(map[string]interface{}); ok {
			return afMap
		}
	}
	return map[string]interface{}{
		"enabled":    false,
		"min_count":  0,
		"max_count":  100,
		"file_types": []string{},
	}
}

// parseSize 解析大小字符串
func (p *EmailSizePlugin) parseSize(sizeStr string) (int64, error) {
	if sizeStr == "" {
		return 0, nil
	}

	sizeStr = strings.TrimSpace(strings.ToUpper(sizeStr))

	// 提取数字部分和单位部分
	var numStr, unit string
	for i, char := range sizeStr {
		if char >= '0' && char <= '9' || char == '.' {
			numStr += string(char)
		} else {
			unit = sizeStr[i:]
			break
		}
	}

	if numStr == "" {
		return 0, fmt.Errorf("无效的大小格式: %s", sizeStr)
	}

	size, err := strconv.ParseFloat(numStr, 64)
	if err != nil {
		return 0, fmt.Errorf("无效的大小数值: %s", numStr)
	}

	// 转换单位
	switch unit {
	case "", "B":
		return int64(size), nil
	case "KB":
		return int64(size * 1024), nil
	case "MB":
		return int64(size * 1024 * 1024), nil
	case "GB":
		return int64(size * 1024 * 1024 * 1024), nil
	default:
		return 0, fmt.Errorf("不支持的单位: %s", unit)
	}
}

// formatSize 格式化大小
func (p *EmailSizePlugin) formatSize(size int64) string {
	if size < 1024 {
		return fmt.Sprintf("%dB", size)
	} else if size < 1024*1024 {
		return fmt.Sprintf("%.2fKB", float64(size)/1024)
	} else if size < 1024*1024*1024 {
		return fmt.Sprintf("%.2fMB", float64(size)/(1024*1024))
	} else {
		return fmt.Sprintf("%.2fGB", float64(size)/(1024*1024*1024))
	}
}

// calculateContentSize 计算内容大小（模拟）
func (p *EmailSizePlugin) calculateContentSize(emailData models.EmailEventData) int64 {
	// 由于EmailEventData中没有内容大小字段，这里根据主题长度估算
	baseSize := int64(len(emailData.Subject) * 100) // 主题长度 * 100 作为基础大小
	return baseSize + 1024                          // 加上固定的1KB作为邮件头部大小
}

// calculateAttachmentSize 计算附件大小（模拟）
func (p *EmailSizePlugin) calculateAttachmentSize(emailData models.EmailEventData) int64 {
	if !emailData.HasAttachment {
		return 0
	}
	// 模拟附件大小，如果有附件，假设为100KB
	return 100 * 1024
}

// calculateTotalSize 计算总大小
func (p *EmailSizePlugin) calculateTotalSize(emailData models.EmailEventData) int64 {
	contentSize := p.calculateContentSize(emailData)
	attachmentSize := p.calculateAttachmentSize(emailData)
	return contentSize + attachmentSize
}

// checkAttachmentFilter 检查附件过滤
func (p *EmailSizePlugin) checkAttachmentFilter(emailData models.EmailEventData, attachmentFilter map[string]interface{}) bool {
	if !emailData.HasAttachment {
		return false
	}

	// 由于EmailEventData中没有附件详细信息，这里简化处理
	// 实际实现中需要根据具体的附件信息进行过滤
	minCount := int(attachmentFilter["min_count"].(float64))
	maxCount := int(attachmentFilter["max_count"].(float64))

	// 假设有1个附件
	attachmentCount := 1
	if attachmentCount < minCount || attachmentCount > maxCount {
		return false
	}

	return true
}
