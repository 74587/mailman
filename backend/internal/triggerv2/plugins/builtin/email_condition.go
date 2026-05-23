package builtin

import (
	"fmt"
	"strings"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// EmailConditionPlugin 邮件条件插件
type EmailConditionPlugin struct {
	info   *plugins.PluginInfo
	config map[string]interface{}
}

// NewEmailConditionPlugin 创建邮件条件插件
func NewEmailConditionPlugin() *EmailConditionPlugin {
	return &EmailConditionPlugin{
		info: &plugins.PluginInfo{
			ID:          "builtin.email_condition",
			Name:        "邮件条件",
			Version:     "1.0.0",
			Description: "基于邮件属性的条件判断",
			Author:      "Mailman Team",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusActive,
		},
		config: make(map[string]interface{}),
	}
}

// GetInfo 获取插件信息
func (p *EmailConditionPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// GetUISchema 获取UI架构
func (p *EmailConditionPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "email.from",
				Label:       "发件人",
				Type:        plugins.UIFieldTypeDynamic,
				Description: "邮件发件人地址（留空表示不过滤）",
				Placeholder: "输入或选择邮箱地址",
				Required:    false,
				Width:       "full",
				OptionsAPI:  "/plugins/builtin.email_condition/callbacks/get-email-addresses",
			},
			{
				Name:        "email.to",
				Label:       "收件人",
				Type:        plugins.UIFieldTypeDynamic,
				Description: "邮件收件人地址（留空表示不过滤）",
				Placeholder: "输入或选择邮箱地址",
				Required:    false,
				Width:       "full",
				OptionsAPI:  "/plugins/builtin.email_condition/callbacks/get-email-addresses",
			},
			{
				Name:        "email.subject",
				Label:       "主题",
				Type:        plugins.UIFieldTypeText,
				Description: "邮件主题关键词（留空表示不过滤）",
				Placeholder: "输入邮件主题关键词",
				Required:    false,
				Width:       "full",
			},
			{
				Name:        "email.body",
				Label:       "正文",
				Type:        plugins.UIFieldTypeText,
				Description: "邮件正文内容关键词（留空表示不过滤）",
				Placeholder: "输入正文关键词",
				Required:    false,
				Width:       "full",
			},
			{
				Name:        "email.has_attachments",
				Label:       "附件过滤",
				Type:        plugins.UIFieldTypeSelect,
				Description: "根据是否包含附件进行过滤",
				Required:    false,
				Width:       "half",
				Options: []plugins.UIOption{
					{Value: "__no_filter__", Label: "不过滤", Icon: "filter-x"},
					{Value: "true", Label: "包含附件", Icon: "paperclip"},
					{Value: "false", Label: "不包含附件", Icon: "file"},
				},
			},
			{
				Name:        "email.attachment_type",
				Label:       "附件类型",
				Type:        plugins.UIFieldTypeSelect,
				Description: "附件文件类型",
				Required:    false,
				Width:       "half",
				Options: []plugins.UIOption{
					{Value: "pdf", Label: "PDF文档", Icon: "file-pdf"},
					{Value: "doc", Label: "Word文档", Icon: "file-word"},
					{Value: "xls", Label: "Excel表格", Icon: "file-excel"},
					{Value: "img", Label: "图片", Icon: "file-image"},
					{Value: "zip", Label: "压缩文件", Icon: "file-zip"},
				},
				ShowIf: map[string]interface{}{
					"email.has_attachments": "true",
				},
			},
			{
				Name:        "email.size",
				Label:       "邮件大小",
				Type:        plugins.UIFieldTypeNumber,
				Description: "邮件大小（KB），留空表示不过滤",
				Placeholder: "输入大小",
				Required:    false,
				Width:       "half",
				Min:         0,
				Max:         1048576, // 1GB
			},
			{
				Name:        "email.flags",
				Label:       "邮件标签",
				Type:        plugins.UIFieldTypeMultiSelect,
				Description: "根据邮件标签进行过滤，可多选（留空表示不过滤）",
				Required:    false,
				Width:       "half",
				Options: []plugins.UIOption{
					{Value: "UNREAD", Label: "未读", Icon: "mail", Color: "blue"},
					{Value: "FLAGGED", Label: "星标", Icon: "star", Color: "yellow"},
					{Value: "IMPORTANT", Label: "重要", Icon: "alert-circle", Color: "red"},
					{Value: "SPAM", Label: "垃圾邮件", Icon: "alert-triangle", Color: "orange"},
					{Value: "DRAFT", Label: "草稿", Icon: "edit", Color: "gray"},
					{Value: "SENT", Label: "已发送", Icon: "send", Color: "green"},
					{Value: "CATEGORY_PROMOTIONS", Label: "促销", Icon: "tag", Color: "purple"},
					{Value: "CATEGORY_SOCIAL", Label: "社交", Icon: "users", Color: "pink"},
					{Value: "CATEGORY_UPDATES", Label: "更新", Icon: "refresh-cw", Color: "cyan"},
				},
			},
		},
		Operators: []plugins.UIOperator{
			{Value: "equals", Label: "等于", ApplicableTo: []string{"text", "number", "select", "dynamic"}},
			{Value: "not_equals", Label: "不等于", ApplicableTo: []string{"text", "number", "select", "dynamic"}},
			{Value: "contains", Label: "包含", ApplicableTo: []string{"text", "dynamic"}},
			{Value: "not_contains", Label: "不包含", ApplicableTo: []string{"text", "dynamic"}},
			{Value: "starts_with", Label: "开头是", ApplicableTo: []string{"text", "dynamic"}},
			{Value: "ends_with", Label: "结尾是", ApplicableTo: []string{"text", "dynamic"}},
			{Value: "greater_than", Label: "大于", ApplicableTo: []string{"number"}},
			{Value: "less_than", Label: "小于", ApplicableTo: []string{"number"}},
			{Value: "in", Label: "在列表中", ApplicableTo: []string{"text", "select", "dynamic"}},
			{Value: "not_in", Label: "不在列表中", ApplicableTo: []string{"text", "select", "dynamic"}},
			{Value: "is_true", Label: "为真", ApplicableTo: []string{"boolean"}},
			{Value: "is_false", Label: "为假", ApplicableTo: []string{"boolean"}},
		},
		Layout:            "vertical",
		AllowCustomFields: true,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "配置邮件条件过滤规则。所有字段均为可选，留空的字段表示不进行该条件的过滤。",
		Examples: []plugins.UIExample{
			{
				Title:       "垃圾邮件过滤",
				Description: "过滤来自特定域名的邮件",
				Expression: map[string]interface{}{
					"field":    "email.from",
					"operator": "ends_with",
					"value":    "@spam.com",
				},
			},
			{
				Title:       "重要邮件过滤",
				Description: "过滤带有重要或星标标签的邮件",
				Expression: map[string]interface{}{
					"type":     "group",
					"operator": "and",
					"conditions": []map[string]interface{}{
						{
							"field":    "email.subject",
							"operator": "contains",
							"value":    "紧急",
						},
						{
							"field":    "email.flags",
							"operator": "in",
							"value":    []string{"IMPORTANT", "FLAGGED"},
						},
					},
				},
			},
		},
	}
}

// GetDynamicOptions 获取动态选项
func (p *EmailConditionPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	switch field {
	case "email.from", "email.to":
		// 这里应该从数据库获取邮箱地址
		// 模拟一些数据
		emails := []string{
			"admin@example.com",
			"support@example.com",
			"noreply@example.com",
			"user1@example.com",
			"user2@example.com",
		}

		var options []plugins.UIOption
		for _, email := range emails {
			if query == "" || strings.Contains(strings.ToLower(email), strings.ToLower(query)) {
				options = append(options, plugins.UIOption{
					Value: email,
					Label: email,
					Icon:  "mail",
				})
			}
		}
		return options, nil
	}
	return nil, fmt.Errorf("unsupported dynamic field: %s", field)
}

// ValidateFieldValue 验证字段值
func (p *EmailConditionPlugin) ValidateFieldValue(field string, value interface{}) error {
	switch field {
	case "email.from", "email.to":
		str, ok := value.(string)
		if !ok {
			return fmt.Errorf("邮箱地址必须是字符串")
		}
		if !strings.Contains(str, "@") {
			return fmt.Errorf("无效的邮箱地址格式")
		}
	case "email.size":
		num, ok := value.(float64)
		if !ok {
			return fmt.Errorf("邮件大小必须是数字")
		}
		if num < 0 {
			return fmt.Errorf("邮件大小不能为负数")
		}
	}
	return nil
}

// GetFieldSuggestions 获取字段建议
func (p *EmailConditionPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	suggestions := map[string][]string{
		"email.subject": {
			"订单",
			"发票",
			"通知",
			"提醒",
			"确认",
			"重要",
			"紧急",
		},
		"email.body": {
			"感谢您的订单",
			"您的订单已发货",
			"请确认",
			"附件",
			"详情请见",
		},
	}

	if fieldSuggestions, ok := suggestions[field]; ok {
		var filtered []string
		for _, s := range fieldSuggestions {
			if prefix == "" || strings.HasPrefix(s, prefix) {
				filtered = append(filtered, s)
			}
		}
		return filtered, nil
	}

	return nil, nil
}

// 实现其他必需的插件接口方法...
func (p *EmailConditionPlugin) Initialize(ctx *plugins.PluginContext) error {
	return nil
}

func (p *EmailConditionPlugin) Cleanup() error {
	return nil
}

func (p *EmailConditionPlugin) OnLoad() error {
	return nil
}

func (p *EmailConditionPlugin) OnUnload() error {
	return nil
}

func (p *EmailConditionPlugin) OnActivate() error {
	return nil
}

func (p *EmailConditionPlugin) OnDeactivate() error {
	return nil
}

func (p *EmailConditionPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{}
}

func (p *EmailConditionPlugin) ValidateConfig(config map[string]interface{}) error {
	return nil
}

func (p *EmailConditionPlugin) ApplyConfig(config map[string]interface{}) error {
	p.config = config
	return nil
}

func (p *EmailConditionPlugin) HealthCheck() error {
	return nil
}

func (p *EmailConditionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{}
}

func (p *EmailConditionPlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	// 从 event 中获取邮件数据
	if event == nil || len(event.Data) == 0 {
		return &plugins.PluginResult{
			Success: false,
			Data:    map[string]interface{}{"error": "No event data provided"},
		}, nil
	}

	// 反序列化事件数据
	var eventData map[string]interface{}
	if err := event.GetData(&eventData); err != nil {
		return &plugins.PluginResult{
			Success: false,
			Data:    map[string]interface{}{"error": fmt.Sprintf("Failed to parse event data: %v", err)},
		}, nil
	}

	// 尝试获取邮件对象
	var emailData map[string]interface{}
	if email, ok := eventData["email"]; ok {
		if emailMap, ok := email.(map[string]interface{}); ok {
			emailData = emailMap
		}
	}

	// 如果没有专门的 email 字段，尝试从整个 eventData 获取
	if emailData == nil {
		emailData = eventData
	}

	// 从 config 获取条件字段（这些是用户在 UI 中配置的条件）
	var conditions map[string]interface{}
	if ctx.Config != nil {
		conditions = ctx.Config.Config
	}
	if conditions == nil {
		// 如果 config 为空，默认返回 true（无条件限制）
		return &plugins.PluginResult{
			Success: true,
			Data:    map[string]interface{}{"message": "No conditions specified, defaulting to true"},
		}, nil
	}

	// 评估每个条件字段
	allMatch := true
	matchDetails := make(map[string]interface{})

	// 检查发件人条件
	if fromCondition, ok := conditions["email.from"].(string); ok && fromCondition != "" {
		fromMatch := false
		if fromValue, ok := emailData["From"]; ok {
			fromMatch = matchEmailField(fromValue, fromCondition)
		}
		matchDetails["email.from"] = map[string]interface{}{
			"condition": fromCondition,
			"matched":   fromMatch,
		}
		if !fromMatch {
			allMatch = false
		}
	}

	// 检查收件人条件
	if toCondition, ok := conditions["email.to"].(string); ok && toCondition != "" {
		toMatch := false
		if toValue, ok := emailData["To"]; ok {
			toMatch = matchEmailField(toValue, toCondition)
		}
		matchDetails["email.to"] = map[string]interface{}{
			"condition": toCondition,
			"matched":   toMatch,
		}
		if !toMatch {
			allMatch = false
		}
	}

	// 检查主题条件
	if subjectCondition, ok := conditions["email.subject"].(string); ok && subjectCondition != "" {
		subjectMatch := false
		if subject, ok := emailData["Subject"].(string); ok {
			subjectMatch = strings.Contains(strings.ToLower(subject), strings.ToLower(subjectCondition))
		}
		matchDetails["email.subject"] = map[string]interface{}{
			"condition": subjectCondition,
			"matched":   subjectMatch,
		}
		if !subjectMatch {
			allMatch = false
		}
	}

	// 检查正文条件
	if bodyCondition, ok := conditions["email.body"].(string); ok && bodyCondition != "" {
		bodyMatch := false
		// 检查 Body 字段
		if body, ok := emailData["Body"].(string); ok {
			bodyMatch = strings.Contains(strings.ToLower(body), strings.ToLower(bodyCondition))
		}
		// 也检查 TextBody 和 HTMLBody
		if !bodyMatch {
			if textBody, ok := emailData["TextBody"].(string); ok {
				bodyMatch = strings.Contains(strings.ToLower(textBody), strings.ToLower(bodyCondition))
			}
		}
		if !bodyMatch {
			if htmlBody, ok := emailData["HTMLBody"].(string); ok {
				bodyMatch = strings.Contains(strings.ToLower(htmlBody), strings.ToLower(bodyCondition))
			}
		}
		matchDetails["email.body"] = map[string]interface{}{
			"condition": bodyCondition,
			"matched":   bodyMatch,
		}
		if !bodyMatch {
			allMatch = false
		}
	}

	// 检查附件条件
	if attachmentCondition, ok := conditions["email.has_attachments"].(string); ok && attachmentCondition != "" && attachmentCondition != "__no_filter__" {
		attachmentMatch := true
		hasAttachments := false
		if ha, ok := emailData["HasAttachments"].(bool); ok {
			hasAttachments = ha
		}

		if attachmentCondition == "true" {
			attachmentMatch = hasAttachments
		} else if attachmentCondition == "false" {
			attachmentMatch = !hasAttachments
		}
		// 如果是 "any"，表示不过滤（已在 if 条件中排除）

		matchDetails["email.has_attachments"] = map[string]interface{}{
			"condition":      attachmentCondition,
			"hasAttachments": hasAttachments,
			"matched":        attachmentMatch,
		}
		if !attachmentMatch {
			allMatch = false
		}
	}

	// 检查标签条件
	if flagsCondition := conditions["email.flags"]; flagsCondition != nil {
		var requiredFlags []string
		switch v := flagsCondition.(type) {
		case []string:
			requiredFlags = v
		case []interface{}:
			for _, item := range v {
				if s, ok := item.(string); ok {
					requiredFlags = append(requiredFlags, s)
				}
			}
		}

		if len(requiredFlags) > 0 {
			flagsMatch := false
			var emailFlags []string
			if flags, ok := emailData["Flags"]; ok {
				switch f := flags.(type) {
				case []string:
					emailFlags = f
				case []interface{}:
					for _, item := range f {
						if s, ok := item.(string); ok {
							emailFlags = append(emailFlags, s)
						}
					}
				}
			}

			// 检查邮件是否包含所有必需的标签
			for _, requiredFlag := range requiredFlags {
				for _, emailFlag := range emailFlags {
					if strings.EqualFold(emailFlag, requiredFlag) {
						flagsMatch = true
						break
					}
				}
				if flagsMatch {
					break // 只要匹配一个就算通过
				}
			}

			matchDetails["email.flags"] = map[string]interface{}{
				"condition":  requiredFlags,
				"emailFlags": emailFlags,
				"matched":    flagsMatch,
			}
			if !flagsMatch {
				allMatch = false
			}
		}
	}

	return &plugins.PluginResult{
		Success: allMatch,
		Data: map[string]interface{}{
			"result":  allMatch,
			"details": matchDetails,
		},
	}, nil
}

// matchEmailField 匹配邮件地址字段（可以是字符串或字符串数组）
func matchEmailField(fieldValue interface{}, condition string) bool {
	condition = strings.ToLower(condition)

	switch v := fieldValue.(type) {
	case string:
		return strings.Contains(strings.ToLower(v), condition)
	case []string:
		for _, addr := range v {
			if strings.Contains(strings.ToLower(addr), condition) {
				return true
			}
		}
	case []interface{}:
		for _, item := range v {
			if addr, ok := item.(string); ok {
				if strings.Contains(strings.ToLower(addr), condition) {
					return true
				}
			}
		}
	}
	return false
}

func (p *EmailConditionPlugin) GetDescription() string {
	return p.info.Description
}

func (p *EmailConditionPlugin) GetSupportedEventTypes() []string {
	return []string{"email.received", "email.sent"}
}

func (p *EmailConditionPlugin) GetRequiredFields() []string {
	return []string{}
}
