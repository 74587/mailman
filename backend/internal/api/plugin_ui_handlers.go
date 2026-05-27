package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"mailman/internal/triggerv2/plugins"
	"mailman/internal/triggerv2/plugins/builtin"
)

// GetPluginUISchemas 获取所有插件的UI架构
func (h *APIHandler) GetPluginUISchemas(w http.ResponseWriter, r *http.Request) {
	// 获取插件类型过滤
	pluginType := r.URL.Query().Get("type")
	pluginContext := r.URL.Query().Get("context")

	// 获取所有插件
	pluginInfos, err := h.pluginManager.ListPlugins()
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, "Failed to list plugins: "+err.Error())
		return
	}

	schemas := make(map[string]interface{})

	// 遍历插件，获取条件和动作插件的UI架构
	for _, info := range pluginInfos {
		if pluginType != "" && string(info.Type) != pluginType {
			continue
		}
		if !builtin.IsPluginAllowedInContext(info, pluginContext) {
			continue
		}

		plugin, err := h.pluginManager.GetPlugin(info.ID)
		if err != nil {
			continue
		}

		if info.Type == plugins.PluginTypeCondition {
			// 检查是否实现了条件插件UI接口
			if uiPlugin, ok := plugin.(plugins.ConditionPluginWithUI); ok {
				schemas[info.ID] = map[string]interface{}{
					"info":   info,
					"schema": uiPlugin.GetUISchema(),
				}
			}
		} else if info.Type == plugins.PluginTypeAction {
			// 检查是否实现了动作插件UI接口
			if uiPlugin, ok := plugin.(plugins.ActionPluginWithUI); ok {
				schemas[info.ID] = map[string]interface{}{
					"info":   info,
					"schema": uiPlugin.GetUISchema(),
				}
			}
		}
	}

	if pluginType == "" || pluginType == string(plugins.PluginTypeCondition) {
		// 添加通用字段匹配条件
		schemas["builtin"] = map[string]interface{}{
			"info": map[string]interface{}{
				"id":           "builtin",
				"name":         "字段匹配器",
				"description":  "基于字段值的通用条件匹配，支持所有邮件字段",
				"type":         string(plugins.PluginTypeCondition),
				"capabilities": []string{builtin.PluginCapabilityCondition, builtin.PluginCapabilityPure},
				"contexts":     []string{builtin.PluginContextTrigger, builtin.PluginContextPickup, builtin.PluginContextInterceptor},
			},
			"schema": getBuiltinUISchema(),
		}
	}

	RespondWithJSON(w, http.StatusOK, schemas)
}

// GetPluginUISchema 获取单个插件的UI架构
func (h *APIHandler) GetPluginUISchema(w http.ResponseWriter, r *http.Request) {
	pluginID := r.URL.Query().Get("id")
	pluginContext := r.URL.Query().Get("context")
	if pluginID == "" {
		RespondWithError(w, http.StatusBadRequest, "Missing plugin ID")
		return
	}

	// 特殊处理内置条件
	switch pluginID {
	case "builtin", "builtin.email_condition":
		RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"info": map[string]interface{}{
				"id":          pluginID,
				"name":        "邮件基础条件",
				"description": "系统内置的基础邮件条件",
			},
			"schema": getBuiltinUISchema(),
		})
		return

	case "builtin.email_sender":
		RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"info": map[string]interface{}{
				"id":          pluginID,
				"name":        "邮件发件人条件",
				"description": "基于邮件发件人的条件判断",
			},
			"schema": getEmailSenderUISchema(),
		})
		return

	case "builtin.email_subject":
		RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"info": map[string]interface{}{
				"id":          pluginID,
				"name":        "邮件主题条件",
				"description": "基于邮件主题的条件判断",
			},
			"schema": getEmailSubjectUISchema(),
		})
		return

	case "builtin.email_content":
		RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"info": map[string]interface{}{
				"id":          pluginID,
				"name":        "邮件内容条件",
				"description": "基于邮件内容的条件判断",
			},
			"schema": getEmailContentUISchema(),
		})
		return

	case "builtin.email_time":
		RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"info": map[string]interface{}{
				"id":          pluginID,
				"name":        "邮件时间条件",
				"description": "基于邮件时间的条件判断",
			},
			"schema": getEmailTimeUISchema(),
		})
		return

	case "builtin.email_attachment":
		RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"info": map[string]interface{}{
				"id":          pluginID,
				"name":        "邮件附件条件",
				"description": "基于邮件附件的条件判断",
			},
			"schema": getEmailAttachmentUISchema(),
		})
		return

	case "builtin.email_priority":
		RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"info": map[string]interface{}{
				"id":          pluginID,
				"name":        "邮件优先级条件",
				"description": "基于邮件优先级的条件判断",
			},
			"schema": getEmailPriorityUISchema(),
		})
		return
	}

	// 获取插件
	plugin, err := h.pluginManager.GetPlugin(pluginID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Plugin not found: "+err.Error())
		return
	}

	// 获取插件信息
	info := plugin.GetInfo()
	if !builtin.IsPluginAllowedInContext(info, pluginContext) {
		RespondWithError(w, http.StatusForbidden, "Plugin is not available in this context")
		return
	}

	// 根据插件类型检查是否实现了UI接口
	switch info.Type {
	case plugins.PluginTypeCondition:
		if uiPlugin, ok := plugin.(plugins.ConditionPluginWithUI); ok {
			RespondWithJSON(w, http.StatusOK, map[string]interface{}{
				"info":   info,
				"schema": uiPlugin.GetUISchema(),
			})
			return
		}
	case plugins.PluginTypeAction:
		if uiPlugin, ok := plugin.(plugins.ActionPluginWithUI); ok {
			RespondWithJSON(w, http.StatusOK, map[string]interface{}{
				"info":   info,
				"schema": uiPlugin.GetUISchema(),
			})
			return
		}
	}

	RespondWithError(w, http.StatusBadRequest, "Plugin does not support UI")
}

// HandlePluginCallback 处理插件回调
func (h *APIHandler) HandlePluginCallback(w http.ResponseWriter, r *http.Request) {
	// 解析路径参数
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		RespondWithError(w, http.StatusBadRequest, "Invalid callback path")
		return
	}

	pluginID := parts[3]
	callback := parts[5]

	// 获取查询参数（支持 q 和 query 两种参数名）
	query := r.URL.Query().Get("q")
	if query == "" {
		query = r.URL.Query().Get("query")
	}
	field := r.URL.Query().Get("field")

	// 特殊处理 "builtin" 插件
	if pluginID == "builtin" {
		switch callback {
		case "validate-field":
			// 解析请求体
			var req struct {
				Field string      `json:"field"`
				Value interface{} `json:"value"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				RespondWithError(w, http.StatusBadRequest, "Invalid request body")
				return
			}

			// 内置条件不需要特殊的字段验证，直接返回成功
			RespondWithJSON(w, http.StatusOK, map[string]interface{}{
				"valid": true,
			})
			return

		case "get-dynamic-options":
			// 内置条件不支持动态选项
			RespondWithJSON(w, http.StatusOK, map[string]interface{}{
				"options": []interface{}{},
			})
			return

		default:
			RespondWithError(w, http.StatusNotFound, "Callback not supported for builtin plugin")
			return
		}
	}

	// 获取插件
	plugin, err := h.pluginManager.GetPlugin(pluginID)
	if err != nil {
		RespondWithError(w, http.StatusNotFound, "Plugin not found: "+err.Error())
		return
	}

	// 获取插件信息
	info := plugin.GetInfo()

	// 根据插件类型检查是否实现了UI接口并处理回调
	switch info.Type {
	case plugins.PluginTypeCondition:
		uiPlugin, ok := plugin.(plugins.ConditionPluginWithUI)
		if !ok {
			RespondWithError(w, http.StatusBadRequest, "Plugin does not support UI callbacks")
			return
		}
		h.handleUIPluginCallback(w, r, uiPlugin, callback, field, query)

	case plugins.PluginTypeAction:
		uiPlugin, ok := plugin.(plugins.ActionPluginWithUI)
		if !ok {
			RespondWithError(w, http.StatusBadRequest, "Plugin does not support UI callbacks")
			return
		}
		h.handleUIPluginCallback(w, r, uiPlugin, callback, field, query)

	default:
		RespondWithError(w, http.StatusBadRequest, "Plugin type does not support UI callbacks")
	}
}

// UIPluginInterface 通用UI插件接口
type UIPluginInterface interface {
	GetDynamicOptions(field string, query string) ([]plugins.UIOption, error)
	ValidateFieldValue(field string, value interface{}) error
	GetFieldSuggestions(field string, prefix string) ([]string, error)
}

// handleUIPluginCallback 处理UI插件回调的通用方法
func (h *APIHandler) handleUIPluginCallback(w http.ResponseWriter, r *http.Request, uiPlugin UIPluginInterface, callback string, field string, query string) {
	switch callback {
	case "get-dynamic-options":
		options, err := uiPlugin.GetDynamicOptions(field, query)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "Failed to get options: "+err.Error())
			return
		}
		RespondWithJSON(w, http.StatusOK, options)

	case "get-email-addresses":
		// 从数据库获取邮箱地址
		// 使用 APIHandler 的 EmailAccountRepo 查询已配置的邮箱账户
		accounts, err := h.EmailAccountRepo.GetAll(0) // System-level for plugin callbacks
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "Failed to fetch email accounts: "+err.Error())
			return
		}

		// 构建地址列表
		var addresses []map[string]interface{}
		for _, account := range accounts {
			// 如果有搜索条件，进行过滤
			if query != "" {
				if !strings.Contains(strings.ToLower(account.EmailAddress), strings.ToLower(query)) {
					continue
				}
			}

			// 根据邮箱域名设置图标
			icon := "mail"
			if strings.Contains(account.EmailAddress, "@gmail") {
				icon = "mail"
			} else if strings.Contains(account.EmailAddress, "@outlook") || strings.Contains(account.EmailAddress, "@hotmail") {
				icon = "mail"
			}

			addresses = append(addresses, map[string]interface{}{
				"value": account.EmailAddress,
				"label": account.EmailAddress,
				"icon":  icon,
			})
		}

		// 限制返回数量，最多返回50个
		if len(addresses) > 50 {
			addresses = addresses[:50]
		}

		// 返回格式需要包装为 {options: [...]} 以匹配前端预期
		RespondWithJSON(w, http.StatusOK, map[string]interface{}{
			"options": addresses,
		})

	case "validate-field":
		// 解析请求体
		var req struct {
			Field string      `json:"field"`
			Value interface{} `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			RespondWithError(w, http.StatusBadRequest, "Invalid request body")
			return
		}

		err := uiPlugin.ValidateFieldValue(req.Field, req.Value)
		if err != nil {
			RespondWithJSON(w, http.StatusOK, map[string]interface{}{
				"valid": false,
				"error": err.Error(),
			})
		} else {
			RespondWithJSON(w, http.StatusOK, map[string]interface{}{
				"valid": true,
			})
		}

	case "get-suggestions":
		suggestions, err := uiPlugin.GetFieldSuggestions(field, query)
		if err != nil {
			RespondWithError(w, http.StatusInternalServerError, "Failed to get suggestions: "+err.Error())
			return
		}
		RespondWithJSON(w, http.StatusOK, suggestions)

	default:
		RespondWithError(w, http.StatusBadRequest, "Unknown callback: "+callback)
	}
}

// getBuiltinUISchema 获取内置条件的UI架构
func getBuiltinUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "field",
				Label:       "字段",
				Type:        plugins.UIFieldTypeText,
				Description: "要比较的字段路径",
				Placeholder: "例如: event.type",
				Required:    true,
				Width:       "1/3",
			},
			{
				Name:        "operator",
				Label:       "操作符",
				Type:        plugins.UIFieldTypeSelect,
				Description: "比较操作符",
				Required:    true,
				Width:       "1/3",
				Options: []plugins.UIOption{
					// 标准操作符
					{Value: "equals", Label: "等于"},
					{Value: "not_equals", Label: "不等于"},
					{Value: "contains", Label: "包含"},
					{Value: "not_contains", Label: "不包含"},
					{Value: "starts_with", Label: "开头是"},
					{Value: "ends_with", Label: "结尾是"},
					{Value: "greater_than", Label: "大于"},
					{Value: "less_than", Label: "小于"},
					{Value: "in", Label: "在列表中"},
					{Value: "not_in", Label: "不在列表中"},
					{Value: "exists", Label: "存在"},
					{Value: "not_exists", Label: "不存在"},
					// 数组专用操作符
					{Value: "array_contains", Label: "[数组] 数组包含"},
					{Value: "array_not_contains", Label: "[数组] 数组不包含"},
					{Value: "any_equals", Label: "[数组] 任意元素等于"},
					{Value: "any_contains", Label: "[数组] 任意元素包含"},
					{Value: "any_starts_with", Label: "[数组] 任意元素开头是"},
					{Value: "any_ends_with", Label: "[数组] 任意元素结尾是"},
					{Value: "any_matches", Label: "[数组] 任意元素匹配正则"},
					{Value: "any_not_matches", Label: "[数组] 任意元素不匹配正则"},
					{Value: "all_equals", Label: "[数组] 所有元素等于"},
					{Value: "all_contains", Label: "[数组] 所有元素包含"},
					{Value: "all_matches", Label: "[数组] 所有元素匹配正则"},
					{Value: "all_not_matches", Label: "[数组] 所有元素不匹配正则"},
					{Value: "array_length_equals", Label: "[数组] 数组长度等于"},
					{Value: "array_length_greater", Label: "[数组] 数组长度大于"},
					{Value: "array_length_less", Label: "[数组] 数组长度小于"},
					{Value: "array_is_empty", Label: "[数组] 数组为空"},
					{Value: "array_is_not_empty", Label: "[数组] 数组不为空"},
				},
			},
			{
				Name:        "value",
				Label:       "值",
				Type:        plugins.UIFieldTypeText,
				Description: "要比较的值",
				Placeholder: "输入值",
				Required:    false,
				Width:       "1/3",
			},
		},
		Operators: []plugins.UIOperator{
			// 标准操作符
			{Value: "equals", Label: "等于", ApplicableTo: []string{"text", "number", "select"}},
			{Value: "not_equals", Label: "不等于", ApplicableTo: []string{"text", "number", "select"}},
			{Value: "contains", Label: "包含", ApplicableTo: []string{"text"}},
			{Value: "not_contains", Label: "不包含", ApplicableTo: []string{"text"}},
			{Value: "starts_with", Label: "开头是", ApplicableTo: []string{"text"}},
			{Value: "ends_with", Label: "结尾是", ApplicableTo: []string{"text"}},
			{Value: "greater_than", Label: "大于", ApplicableTo: []string{"number"}},
			{Value: "less_than", Label: "小于", ApplicableTo: []string{"number"}},
			{Value: "in", Label: "在列表中", ApplicableTo: []string{"text", "select"}},
			{Value: "not_in", Label: "不在列表中", ApplicableTo: []string{"text", "select"}},
			{Value: "exists", Label: "存在", ApplicableTo: []string{"text"}},
			{Value: "not_exists", Label: "不存在", ApplicableTo: []string{"text"}},
			// 数组专用操作符
			{Value: "array_contains", Label: "[数组] 数组包含", ApplicableTo: []string{"array"}},
			{Value: "array_not_contains", Label: "[数组] 数组不包含", ApplicableTo: []string{"array"}},
			{Value: "any_equals", Label: "[数组] 任意元素等于", ApplicableTo: []string{"array"}},
			{Value: "any_contains", Label: "[数组] 任意元素包含", ApplicableTo: []string{"array"}},
			{Value: "any_starts_with", Label: "[数组] 任意元素开头是", ApplicableTo: []string{"array"}},
			{Value: "any_ends_with", Label: "[数组] 任意元素结尾是", ApplicableTo: []string{"array"}},
			{Value: "any_matches", Label: "[数组] 任意元素匹配正则", ApplicableTo: []string{"array"}},
			{Value: "any_not_matches", Label: "[数组] 任意元素不匹配正则", ApplicableTo: []string{"array"}},
			{Value: "all_equals", Label: "[数组] 所有元素等于", ApplicableTo: []string{"array"}},
			{Value: "all_contains", Label: "[数组] 所有元素包含", ApplicableTo: []string{"array"}},
			{Value: "all_matches", Label: "[数组] 所有元素匹配正则", ApplicableTo: []string{"array"}},
			{Value: "all_not_matches", Label: "[数组] 所有元素不匹配正则", ApplicableTo: []string{"array"}},
			{Value: "array_length_equals", Label: "[数组] 数组长度等于", ApplicableTo: []string{"array"}},
			{Value: "array_length_greater", Label: "[数组] 数组长度大于", ApplicableTo: []string{"array"}},
			{Value: "array_length_less", Label: "[数组] 数组长度小于", ApplicableTo: []string{"array"}},
			{Value: "array_is_empty", Label: "[数组] 数组为空", ApplicableTo: []string{"array"}},
			{Value: "array_is_not_empty", Label: "[数组] 数组不为空", ApplicableTo: []string{"array"}},
		},
		Layout:            "horizontal",
		AllowCustomFields: true,
		AllowNesting:      true,
		MaxNestingLevel:   5,
		HelpText:          "配置基础的条件判断规则。对于数组类型的字段（如 From, To, Flags），请使用带 [数组] 前缀的操作符。",
	}
}

// getEmailSenderUISchema 获取邮件发件人条件的UI架构
func getEmailSenderUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "operator",
				Label:       "匹配方式",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择发件人匹配方式",
				Required:    true,
				Width:       "1/2",
				Options: []plugins.UIOption{
					{Value: "equals", Label: "完全匹配"},
					{Value: "contains", Label: "包含"},
					{Value: "domain_equals", Label: "域名匹配"},
					{Value: "in_whitelist", Label: "在白名单中"},
					{Value: "in_blacklist", Label: "在黑名单中"},
				},
			},
			{
				Name:        "value",
				Label:       "发件人地址",
				Type:        plugins.UIFieldTypeText,
				Description: "输入发件人邮箱地址或域名",
				Placeholder: "例如: user@example.com 或 example.com",
				Required:    true,
				Width:       "1/2",
				Pattern:     `^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$`,
			},
		},
		Layout:            "horizontal",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "配置基于邮件发件人的条件判断规则",
	}
}

// getEmailSubjectUISchema 获取邮件主题条件的UI架构
func getEmailSubjectUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "operator",
				Label:       "匹配方式",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择主题匹配方式",
				Required:    true,
				Width:       "1/3",
				Options: []plugins.UIOption{
					{Value: "equals", Label: "完全匹配"},
					{Value: "contains", Label: "包含"},
					{Value: "starts_with", Label: "以...开头"},
					{Value: "ends_with", Label: "以...结尾"},
					{Value: "regex", Label: "正则表达式"},
					{Value: "is_empty", Label: "为空"},
					{Value: "not_empty", Label: "不为空"},
				},
			},
			{
				Name:        "value",
				Label:       "匹配值",
				Type:        plugins.UIFieldTypeText,
				Description: "输入要匹配的主题内容",
				Placeholder: "例如: 重要通知",
				Required:    false,
				Width:       "1/3",
				ShowIf: map[string]interface{}{
					"field":  "operator",
					"values": []string{"equals", "contains", "starts_with", "ends_with", "regex"},
				},
			},
			{
				Name:         "case_sensitive",
				Label:        "区分大小写",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否区分大小写",
				Required:     false,
				Width:        "1/3",
				DefaultValue: false,
			},
		},
		Layout:            "horizontal",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "配置基于邮件主题的条件判断规则",
	}
}

// getEmailContentUISchema 获取邮件内容条件的UI架构
func getEmailContentUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "search_in",
				Label:       "搜索范围",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择搜索内容的范围",
				Required:    true,
				Width:       "1/3",
				Options: []plugins.UIOption{
					{Value: "text", Label: "纯文本内容"},
					{Value: "html", Label: "HTML内容"},
					{Value: "both", Label: "文本和HTML"},
				},
			},
			{
				Name:        "operator",
				Label:       "匹配方式",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择内容匹配方式",
				Required:    true,
				Width:       "1/3",
				Options: []plugins.UIOption{
					{Value: "contains", Label: "包含"},
					{Value: "not_contains", Label: "不包含"},
					{Value: "contains_all", Label: "包含所有关键词"},
					{Value: "contains_any", Label: "包含任意关键词"},
					{Value: "regex", Label: "正则表达式"},
					{Value: "word_count_gt", Label: "字数大于"},
					{Value: "word_count_lt", Label: "字数小于"},
				},
			},
			{
				Name:        "value",
				Label:       "匹配值",
				Type:        plugins.UIFieldTypeText,
				Description: "输入要匹配的内容或关键词（多个关键词用逗号分隔）",
				Placeholder: "例如: 重要通知, 紧急事件",
				Required:    true,
				Width:       "1/3",
			},
			{
				Name:         "case_sensitive",
				Label:        "区分大小写",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否区分大小写",
				Required:     false,
				Width:        "1/2",
				DefaultValue: false,
			},
			{
				Name:         "whole_word",
				Label:        "完整单词匹配",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "只匹配完整的单词",
				Required:     false,
				Width:        "1/2",
				DefaultValue: false,
			},
		},
		Layout:            "vertical",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "配置基于邮件内容的条件判断规则",
	}
}

// getEmailTimeUISchema 获取邮件时间条件的UI架构
func getEmailTimeUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "time_field",
				Label:       "时间字段",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择要比较的时间字段",
				Required:    true,
				Width:       "1/3",
				Options: []plugins.UIOption{
					{Value: "received_at", Label: "接收时间"},
					{Value: "sent_at", Label: "发送时间"},
					{Value: "created_at", Label: "创建时间"},
				},
			},
			{
				Name:        "operator",
				Label:       "时间比较",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择时间比较方式",
				Required:    true,
				Width:       "1/3",
				Options: []plugins.UIOption{
					{Value: "after", Label: "在...之后"},
					{Value: "before", Label: "在...之前"},
					{Value: "between", Label: "在...之间"},
					{Value: "last_hours", Label: "最近N小时"},
					{Value: "last_days", Label: "最近N天"},
					{Value: "last_weeks", Label: "最近N周"},
					{Value: "this_week", Label: "本周"},
					{Value: "this_month", Label: "本月"},
					{Value: "today", Label: "今天"},
					{Value: "yesterday", Label: "昨天"},
				},
			},
			{
				Name:        "value",
				Label:       "时间值",
				Type:        plugins.UIFieldTypeDate,
				Description: "选择具体的时间或输入数值",
				Required:    false,
				Width:       "1/3",
				ShowIf: map[string]interface{}{
					"field":  "operator",
					"values": []string{"after", "before", "between"},
				},
			},
			{
				Name:        "number_value",
				Label:       "数值",
				Type:        plugins.UIFieldTypeNumber,
				Description: "输入小时数/天数/周数",
				Required:    false,
				Width:       "1/3",
				ShowIf: map[string]interface{}{
					"field":  "operator",
					"values": []string{"last_hours", "last_days", "last_weeks"},
				},
				Min: 1,
				Max: 365,
			},
			{
				Name:        "end_time",
				Label:       "结束时间",
				Type:        plugins.UIFieldTypeDate,
				Description: "选择结束时间",
				Required:    false,
				Width:       "1/3",
				ShowIf: map[string]interface{}{
					"field":  "operator",
					"values": []string{"between"},
				},
			},
		},
		Layout:            "horizontal",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "配置基于邮件时间的条件判断规则",
	}
}

// getEmailAttachmentUISchema 获取邮件附件条件的UI架构
func getEmailAttachmentUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "check_type",
				Label:       "检查类型",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择附件检查类型",
				Required:    true,
				Width:       "1/3",
				Options: []plugins.UIOption{
					{Value: "has_attachment", Label: "有附件"},
					{Value: "no_attachment", Label: "无附件"},
					{Value: "attachment_count", Label: "附件数量"},
					{Value: "attachment_size", Label: "附件大小"},
					{Value: "attachment_type", Label: "附件类型"},
					{Value: "attachment_name", Label: "附件名称"},
				},
			},
			{
				Name:        "operator",
				Label:       "比较方式",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择比较方式",
				Required:    false,
				Width:       "1/3",
				Options: []plugins.UIOption{
					{Value: "equals", Label: "等于"},
					{Value: "greater_than", Label: "大于"},
					{Value: "less_than", Label: "小于"},
					{Value: "contains", Label: "包含"},
					{Value: "matches", Label: "匹配"},
				},
				ShowIf: map[string]interface{}{
					"field":  "check_type",
					"values": []string{"attachment_count", "attachment_size", "attachment_type", "attachment_name"},
				},
			},
			{
				Name:        "value",
				Label:       "比较值",
				Type:        plugins.UIFieldTypeText,
				Description: "输入比较值",
				Placeholder: "例如: 5 (数量), 10MB (大小), pdf (类型), 报告 (名称)",
				Required:    false,
				Width:       "1/3",
				ShowIf: map[string]interface{}{
					"field":  "check_type",
					"values": []string{"attachment_count", "attachment_size", "attachment_type", "attachment_name"},
				},
			},
			{
				Name:        "file_extensions",
				Label:       "文件扩展名",
				Type:        plugins.UIFieldTypeMultiSelect,
				Description: "选择文件扩展名",
				Required:    false,
				Width:       "full",
				Options: []plugins.UIOption{
					{Value: "pdf", Label: "PDF文档"},
					{Value: "doc", Label: "Word文档"},
					{Value: "docx", Label: "Word文档(新版)"},
					{Value: "xls", Label: "Excel表格"},
					{Value: "xlsx", Label: "Excel表格(新版)"},
					{Value: "jpg", Label: "JPEG图片"},
					{Value: "png", Label: "PNG图片"},
					{Value: "gif", Label: "GIF图片"},
					{Value: "zip", Label: "ZIP压缩包"},
					{Value: "rar", Label: "RAR压缩包"},
					{Value: "txt", Label: "文本文件"},
				},
				ShowIf: map[string]interface{}{
					"field":  "check_type",
					"values": []string{"attachment_type"},
				},
			},
		},
		Layout:            "horizontal",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "配置基于邮件附件的条件判断规则",
	}
}

// getEmailPriorityUISchema 获取邮件优先级条件的UI架构
func getEmailPriorityUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "priority",
				Label:       "优先级",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择邮件优先级",
				Required:    true,
				Width:       "1/2",
				Options: []plugins.UIOption{
					{Value: "high", Label: "高优先级", Icon: "arrow-up"},
					{Value: "normal", Label: "普通优先级", Icon: "minus"},
					{Value: "low", Label: "低优先级", Icon: "arrow-down"},
				},
			},
			{
				Name:        "operator",
				Label:       "匹配方式",
				Type:        plugins.UIFieldTypeSelect,
				Description: "选择优先级匹配方式",
				Required:    true,
				Width:       "1/2",
				Options: []plugins.UIOption{
					{Value: "equals", Label: "等于"},
					{Value: "not_equals", Label: "不等于"},
					{Value: "in", Label: "在列表中"},
					{Value: "not_in", Label: "不在列表中"},
				},
			},
			{
				Name:        "multiple_priorities",
				Label:       "多个优先级",
				Type:        plugins.UIFieldTypeMultiSelect,
				Description: "选择多个优先级",
				Required:    false,
				Width:       "full",
				Options: []plugins.UIOption{
					{Value: "high", Label: "高优先级", Icon: "arrow-up"},
					{Value: "normal", Label: "普通优先级", Icon: "minus"},
					{Value: "low", Label: "低优先级", Icon: "arrow-down"},
				},
				ShowIf: map[string]interface{}{
					"operator": []string{"in", "not_in"},
				},
			},
			{
				Name:         "include_unset",
				Label:        "包含未设置优先级",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "是否包含未设置优先级的邮件",
				Required:     false,
				Width:        "full",
				DefaultValue: false,
			},
		},
		Layout:            "horizontal",
		AllowCustomFields: false,
		AllowNesting:      true,
		MaxNestingLevel:   3,
		HelpText:          "配置基于邮件优先级的条件判断规则",
	}
}
