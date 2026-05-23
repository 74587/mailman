package builtin

import (
	"fmt"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// EmailTimeRangePlugin 邮件时间范围筛选插件
type EmailTimeRangePlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewEmailTimeRangePlugin 创建邮件时间范围筛选插件
func NewEmailTimeRangePlugin() plugins.ConditionPlugin {
	return &EmailTimeRangePlugin{
		info: &plugins.PluginInfo{
			ID:          "email_time_range",
			Name:        "邮件时间范围筛选",
			Version:     "1.0.0",
			Description: "根据邮件时间范围筛选邮件",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"start_time": map[string]interface{}{
						"type":        "string",
						"description": "开始时间（RFC3339格式，如：2024-01-01T00:00:00Z）",
						"format":      "date-time",
					},
					"end_time": map[string]interface{}{
						"type":        "string",
						"description": "结束时间（RFC3339格式，如：2024-12-31T23:59:59Z）",
						"format":      "date-time",
					},
					"time_field": map[string]interface{}{
						"type":        "string",
						"description": "时间字段: received（接收时间）, sent（发送时间）",
						"default":     "received",
						"enum":        []string{"received", "sent"},
					},
					"relative_time": map[string]interface{}{
						"type":        "object",
						"description": "相对时间配置",
						"properties": map[string]interface{}{
							"enabled": map[string]interface{}{
								"type":        "boolean",
								"description": "是否启用相对时间",
								"default":     false,
							},
							"duration": map[string]interface{}{
								"type":        "string",
								"description": "时间范围（如：1h, 24h, 7d, 30d）",
								"default":     "24h",
							},
							"direction": map[string]interface{}{
								"type":        "string",
								"description": "时间方向: past（过去），future（未来），both（双向）",
								"default":     "past",
								"enum":        []string{"past", "future", "both"},
							},
						},
					},
					"time_zone": map[string]interface{}{
						"type":        "string",
						"description": "时区（如：Asia/Shanghai, UTC）",
						"default":     "UTC",
					},
					"working_hours": map[string]interface{}{
						"type":        "object",
						"description": "工作时间配置",
						"properties": map[string]interface{}{
							"enabled": map[string]interface{}{
								"type":        "boolean",
								"description": "是否启用工作时间筛选",
								"default":     false,
							},
							"start_hour": map[string]interface{}{
								"type":        "integer",
								"description": "工作开始时间（小时，0-23）",
								"default":     9,
								"minimum":     0,
								"maximum":     23,
							},
							"end_hour": map[string]interface{}{
								"type":        "integer",
								"description": "工作结束时间（小时，0-23）",
								"default":     17,
								"minimum":     0,
								"maximum":     23,
							},
							"working_days": map[string]interface{}{
								"type":        "array",
								"description": "工作日（1-7，周一到周日）",
								"items": map[string]interface{}{
									"type":    "integer",
									"minimum": 1,
									"maximum": 7,
								},
								"default": []int{1, 2, 3, 4, 5},
							},
						},
					},
				},
			},
			DefaultConfig: map[string]interface{}{
				"start_time": "",
				"end_time":   "",
				"time_field": "received",
				"time_zone":  "UTC",
				"relative_time": map[string]interface{}{
					"enabled":   false,
					"duration":  "24h",
					"direction": "past",
				},
				"working_hours": map[string]interface{}{
					"enabled":      false,
					"start_hour":   9,
					"end_hour":     17,
					"working_days": []int{1, 2, 3, 4, 5},
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
func (p *EmailTimeRangePlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// GetUISchema 获取UI架构
func (p *EmailTimeRangePlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "start_time",
				Label:       "开始时间",
				Type:        plugins.UIFieldTypeDate,
				Description: "时间范围的开始时间",
				Placeholder: "选择开始时间",
				Required:    false,
				Width:       "half",
			},
			{
				Name:        "end_time",
				Label:       "结束时间",
				Type:        plugins.UIFieldTypeDate,
				Description: "时间范围的结束时间",
				Placeholder: "选择结束时间",
				Required:    false,
				Width:       "half",
			},
			{
				Name:         "time_field",
				Label:        "时间字段",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "用于时间筛选的字段",
				Required:     true,
				Width:        "half",
				DefaultValue: "received",
				Options: []plugins.UIOption{
					{Value: "sent", Label: "发送时间", Description: "基于邮件发送时间"},
					{Value: "received", Label: "接收时间", Description: "基于邮件接收时间"},
				},
			},
			{
				Name:         "time_zone",
				Label:        "时区",
				Type:         plugins.UIFieldTypeSelect,
				Description:  "时间筛选使用的时区",
				Required:     true,
				Width:        "half",
				DefaultValue: "UTC",
				Options: []plugins.UIOption{
					{Value: "UTC", Label: "UTC", Description: "协调世界时"},
					{Value: "Asia/Shanghai", Label: "Asia/Shanghai", Description: "中国标准时间"},
					{Value: "America/New_York", Label: "America/New_York", Description: "美国东部时间"},
					{Value: "Europe/London", Label: "Europe/London", Description: "英国时间"},
				},
			},
			{
				Name:         "relative_enabled",
				Label:        "启用相对时间",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否使用相对时间筛选",
				Required:     false,
				Width:        "half",
				DefaultValue: false,
			},
			{
				Name:        "relative_duration",
				Label:       "相对时间长度",
				Type:        plugins.UIFieldTypeText,
				Description: "相对时间长度（如：24h, 7d, 1w）",
				Placeholder: "例如：24h",
				Required:    false,
				Width:       "half",
				ShowIf:      map[string]interface{}{"relative_enabled": true},
			},
			{
				Name:        "relative_direction",
				Label:       "相对时间方向",
				Type:        plugins.UIFieldTypeSelect,
				Description: "相对时间的方向",
				Required:    false,
				Width:       "half",
				ShowIf:      map[string]interface{}{"relative_enabled": true},
				Options: []plugins.UIOption{
					{Value: "past", Label: "过去", Description: "过去的时间"},
					{Value: "future", Label: "未来", Description: "未来的时间"},
				},
			},
			{
				Name:         "working_hours_enabled",
				Label:        "启用工作时间",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否只筛选工作时间内的邮件",
				Required:     false,
				Width:        "half",
				DefaultValue: false,
			},
		},
		Operators: []plugins.UIOperator{
			{Value: "between", Label: "在...之间", ApplicableTo: []string{"date"}},
			{Value: "before", Label: "在...之前", ApplicableTo: []string{"date"}},
			{Value: "after", Label: "在...之后", ApplicableTo: []string{"date"}},
		},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "根据时间范围筛选邮件",
		Examples: []plugins.UIExample{
			{
				Title:       "筛选最近24小时的邮件",
				Description: "只显示最近24小时内的邮件",
				Expression: map[string]interface{}{
					"time_field":         "received",
					"time_zone":          "UTC",
					"relative_enabled":   true,
					"relative_duration":  "24h",
					"relative_direction": "past",
				},
			},
			{
				Title:       "筛选工作时间邮件",
				Description: "只显示工作时间内的邮件",
				Expression: map[string]interface{}{
					"time_field":            "received",
					"time_zone":             "Asia/Shanghai",
					"working_hours_enabled": true,
				},
			},
		},
	}
}

// GetDynamicOptions 获取动态选项
func (p *EmailTimeRangePlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	switch field {
	case "time_zone":
		// 返回常见的时区选项
		options := []plugins.UIOption{
			{Value: "UTC", Label: "UTC", Description: "协调世界时"},
			{Value: "Asia/Shanghai", Label: "Asia/Shanghai", Description: "中国标准时间"},
			{Value: "Asia/Tokyo", Label: "Asia/Tokyo", Description: "日本标准时间"},
			{Value: "America/New_York", Label: "America/New_York", Description: "美国东部时间"},
			{Value: "America/Los_Angeles", Label: "America/Los_Angeles", Description: "美国西部时间"},
			{Value: "Europe/London", Label: "Europe/London", Description: "英国时间"},
			{Value: "Europe/Paris", Label: "Europe/Paris", Description: "欧洲中部时间"},
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
	case "relative_direction":
		return []plugins.UIOption{
			{Value: "past", Label: "过去", Description: "过去的时间"},
			{Value: "future", Label: "未来", Description: "未来的时间"},
		}, nil
	default:
		return nil, fmt.Errorf("unsupported field: %s", field)
	}
}

// ValidateFieldValue 验证字段值
func (p *EmailTimeRangePlugin) ValidateFieldValue(field string, value interface{}) error {
	switch field {
	case "start_time", "end_time":
		if value != nil {
			if _, ok := value.(string); !ok {
				return fmt.Errorf("%s must be a string", field)
			}
			// 可以添加更具体的时间格式验证
		}
	case "time_field":
		if timeField, ok := value.(string); ok {
			validFields := []string{"sent", "received"}
			for _, validField := range validFields {
				if timeField == validField {
					return nil
				}
			}
			return fmt.Errorf("invalid time_field: %s", timeField)
		} else {
			return fmt.Errorf("time_field must be a string")
		}
	case "time_zone":
		if _, ok := value.(string); !ok {
			return fmt.Errorf("time_zone must be a string")
		}
	case "relative_enabled", "working_hours_enabled":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%s must be a boolean", field)
		}
	case "relative_duration":
		if duration, ok := value.(string); ok {
			if len(duration) == 0 {
				return fmt.Errorf("relative_duration cannot be empty")
			}
			// 验证时间格式 (如: 1h, 2d, 3w)
			if !strings.HasSuffix(duration, "h") && !strings.HasSuffix(duration, "d") &&
				!strings.HasSuffix(duration, "w") && !strings.HasSuffix(duration, "m") {
				return fmt.Errorf("relative_duration must end with h, d, w, or m")
			}
		} else {
			return fmt.Errorf("relative_duration must be a string")
		}
	case "relative_direction":
		if direction, ok := value.(string); ok {
			validDirections := []string{"past", "future"}
			for _, validDirection := range validDirections {
				if direction == validDirection {
					return nil
				}
			}
			return fmt.Errorf("invalid relative_direction: %s", direction)
		} else {
			return fmt.Errorf("relative_direction must be a string")
		}
	default:
		return fmt.Errorf("unsupported field: %s", field)
	}
	return nil
}

// GetFieldSuggestions 获取字段建议
func (p *EmailTimeRangePlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	switch field {
	case "time_zone":
		// 返回常见的时区建议
		suggestions := []string{
			"UTC",
			"Asia/Shanghai",
			"Asia/Tokyo",
			"America/New_York",
			"America/Los_Angeles",
			"Europe/London",
			"Europe/Paris",
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
	case "relative_duration":
		// 返回常见的时间长度建议
		suggestions := []string{
			"1h", "2h", "6h", "12h", "24h",
			"1d", "2d", "3d", "7d", "14d", "30d",
			"1w", "2w", "4w",
			"1m", "3m", "6m", "12m",
		}

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
func (p *EmailTimeRangePlugin) Initialize(ctx *plugins.PluginContext) error {
	p.config = p.info.DefaultConfig
	return nil
}

// Cleanup 清理插件
func (p *EmailTimeRangePlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时回调
func (p *EmailTimeRangePlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时回调
func (p *EmailTimeRangePlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时回调
func (p *EmailTimeRangePlugin) OnActivate() error {
	p.info.Status = plugins.PluginStatusActive
	return nil
}

// OnDeactivate 停用时回调
func (p *EmailTimeRangePlugin) OnDeactivate() error {
	p.info.Status = plugins.PluginStatusInactive
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *EmailTimeRangePlugin) GetDefaultConfig() map[string]interface{} {
	return p.info.DefaultConfig
}

// ValidateConfig 验证配置
func (p *EmailTimeRangePlugin) ValidateConfig(config map[string]interface{}) error {
	// 验证时间字段
	if timeField, ok := config["time_field"]; ok {
		if fieldStr, ok := timeField.(string); ok {
			if fieldStr != "received" && fieldStr != "sent" {
				return fmt.Errorf("时间字段必须是 'received' 或 'sent'")
			}
		} else {
			return fmt.Errorf("时间字段必须是字符串")
		}
	}

	// 验证开始时间
	if startTime, ok := config["start_time"]; ok {
		if startTimeStr, ok := startTime.(string); ok && startTimeStr != "" {
			if _, err := time.Parse(time.RFC3339, startTimeStr); err != nil {
				return fmt.Errorf("开始时间格式错误: %v", err)
			}
		}
	}

	// 验证结束时间
	if endTime, ok := config["end_time"]; ok {
		if endTimeStr, ok := endTime.(string); ok && endTimeStr != "" {
			if _, err := time.Parse(time.RFC3339, endTimeStr); err != nil {
				return fmt.Errorf("结束时间格式错误: %v", err)
			}
		}
	}

	// 验证时区
	if timeZone, ok := config["time_zone"]; ok {
		if timeZoneStr, ok := timeZone.(string); ok && timeZoneStr != "" {
			if _, err := time.LoadLocation(timeZoneStr); err != nil {
				return fmt.Errorf("时区格式错误: %v", err)
			}
		}
	}

	return nil
}

// ApplyConfig 应用配置
func (p *EmailTimeRangePlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}

	for key, value := range config {
		p.config[key] = value
	}

	return nil
}

// HealthCheck 健康检查
func (p *EmailTimeRangePlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *EmailTimeRangePlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"evaluations": p.info.UsageCount,
		"last_used":   p.info.LastUsed,
		"status":      p.info.Status,
	}
}

// Evaluate 评估条件
func (p *EmailTimeRangePlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
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
	timeField := p.getTimeFieldFromConfig(conditions)
	timeZone := p.getTimeZoneFromConfig(conditions)
	relativeTime := p.getRelativeTimeFromConfig(conditions)
	workingHours := p.getWorkingHoursFromConfig(conditions)

	// 获取邮件时间
	var emailTime time.Time
	if timeField == "sent" {
		// 如果没有发送时间，使用接收时间作为替代
		emailTime = emailData.ReceivedAt
	} else {
		emailTime = emailData.ReceivedAt
	}

	// 转换到指定时区
	loc, err := time.LoadLocation(timeZone)
	if err != nil {
		loc = time.UTC
	}
	emailTime = emailTime.In(loc)

	// 检查时间匹配
	matched := false
	reason := ""

	// 检查相对时间
	if relativeTime["enabled"].(bool) {
		if p.checkRelativeTime(emailTime, relativeTime) {
			matched = true
			reason = "相对时间匹配"
		}
	} else {
		// 检查绝对时间范围
		if p.checkAbsoluteTime(emailTime) {
			matched = true
			reason = "绝对时间匹配"
		}
	}

	// 检查工作时间
	if matched && workingHours["enabled"].(bool) {
		if !p.checkWorkingHours(emailTime, workingHours) {
			matched = false
			reason = "不在工作时间内"
		} else if reason == "" {
			reason = "工作时间匹配"
		}
	}

	result := &plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"matched":       matched,
			"reason":        reason,
			"time_field":    timeField,
			"email_time":    emailTime.Format(time.RFC3339),
			"time_zone":     timeZone,
			"relative_time": relativeTime,
			"working_hours": workingHours,
		},
		ExecutionTime: time.Since(startTime),
		Timestamp:     time.Now(),
	}

	return result, nil
}

// GetDescription 获取描述
func (p *EmailTimeRangePlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *EmailTimeRangePlugin) GetSupportedEventTypes() []string {
	return []string{
		string(models.EventTypeEmailReceived),
		string(models.EventTypeEmailUpdated),
	}
}

// GetRequiredFields 获取必需字段
func (p *EmailTimeRangePlugin) GetRequiredFields() []string {
	return []string{"received_at", "sent_at"}
}

// 私有方法

// getTimeField 获取时间字段配置
func (p *EmailTimeRangePlugin) getTimeField() string {
	return p.getTimeFieldFromConfig(p.config)
}

// getTimeFieldFromConfig 从指定配置获取时间字段
func (p *EmailTimeRangePlugin) getTimeFieldFromConfig(config map[string]interface{}) string {
	if timeField, ok := config["time_field"]; ok {
		if str, ok := timeField.(string); ok {
			return str
		}
	}
	return "received"
}

// getTimeZone 获取时区配置
func (p *EmailTimeRangePlugin) getTimeZone() string {
	return p.getTimeZoneFromConfig(p.config)
}

// getTimeZoneFromConfig 从指定配置获取时区
func (p *EmailTimeRangePlugin) getTimeZoneFromConfig(config map[string]interface{}) string {
	if timeZone, ok := config["time_zone"]; ok {
		if str, ok := timeZone.(string); ok {
			return str
		}
	}
	return "UTC"
}

// getRelativeTime 获取相对时间配置
func (p *EmailTimeRangePlugin) getRelativeTime() map[string]interface{} {
	return p.getRelativeTimeFromConfig(p.config)
}

// getRelativeTimeFromConfig 从指定配置获取相对时间配置
func (p *EmailTimeRangePlugin) getRelativeTimeFromConfig(config map[string]interface{}) map[string]interface{} {
	if relativeTime, ok := config["relative_time"]; ok {
		if rtMap, ok := relativeTime.(map[string]interface{}); ok {
			return rtMap
		}
	}
	return map[string]interface{}{
		"enabled":   false,
		"duration":  "24h",
		"direction": "past",
	}
}

// getWorkingHours 获取工作时间配置
func (p *EmailTimeRangePlugin) getWorkingHours() map[string]interface{} {
	return p.getWorkingHoursFromConfig(p.config)
}

// getWorkingHoursFromConfig 从指定配置获取工作时间配置
func (p *EmailTimeRangePlugin) getWorkingHoursFromConfig(config map[string]interface{}) map[string]interface{} {
	if workingHours, ok := config["working_hours"]; ok {
		if whMap, ok := workingHours.(map[string]interface{}); ok {
			return whMap
		}
	}
	return map[string]interface{}{
		"enabled":      false,
		"start_hour":   9,
		"end_hour":     17,
		"working_days": []int{1, 2, 3, 4, 5},
	}
}

// checkAbsoluteTime 检查绝对时间
func (p *EmailTimeRangePlugin) checkAbsoluteTime(emailTime time.Time) bool {
	startTimeStr := ""
	endTimeStr := ""

	if st, ok := p.config["start_time"]; ok {
		if str, ok := st.(string); ok {
			startTimeStr = str
		}
	}

	if et, ok := p.config["end_time"]; ok {
		if str, ok := et.(string); ok {
			endTimeStr = str
		}
	}

	// 如果没有配置时间范围，返回 true
	if startTimeStr == "" && endTimeStr == "" {
		return true
	}

	// 检查开始时间
	if startTimeStr != "" {
		if startTime, err := time.Parse(time.RFC3339, startTimeStr); err == nil {
			if emailTime.Before(startTime) {
				return false
			}
		}
	}

	// 检查结束时间
	if endTimeStr != "" {
		if endTime, err := time.Parse(time.RFC3339, endTimeStr); err == nil {
			if emailTime.After(endTime) {
				return false
			}
		}
	}

	return true
}

// checkRelativeTime 检查相对时间
func (p *EmailTimeRangePlugin) checkRelativeTime(emailTime time.Time, relativeTime map[string]interface{}) bool {
	durationStr := relativeTime["duration"].(string)
	direction := relativeTime["direction"].(string)

	duration, err := time.ParseDuration(durationStr)
	if err != nil {
		return false
	}

	now := time.Now()
	switch direction {
	case "past":
		return emailTime.After(now.Add(-duration)) && emailTime.Before(now)
	case "future":
		return emailTime.After(now) && emailTime.Before(now.Add(duration))
	case "both":
		return emailTime.After(now.Add(-duration)) && emailTime.Before(now.Add(duration))
	default:
		return false
	}
}

// checkWorkingHours 检查工作时间
func (p *EmailTimeRangePlugin) checkWorkingHours(emailTime time.Time, workingHours map[string]interface{}) bool {
	startHour := int(workingHours["start_hour"].(float64))
	endHour := int(workingHours["end_hour"].(float64))
	workingDays := workingHours["working_days"].([]interface{})

	// 检查是否在工作日
	weekday := int(emailTime.Weekday())
	if weekday == 0 { // 周日转换为 7
		weekday = 7
	}

	isWorkingDay := false
	for _, day := range workingDays {
		if int(day.(float64)) == weekday {
			isWorkingDay = true
			break
		}
	}

	if !isWorkingDay {
		return false
	}

	// 检查是否在工作时间内
	hour := emailTime.Hour()
	return hour >= startHour && hour < endHour
}
