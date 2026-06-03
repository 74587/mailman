package api

import (
	"errors"
	"reflect"
	"time"

	"mailman/internal/models"

	"gorm.io/gorm"
)

func ensureBuiltinFilterTemplates(db *gorm.DB, orgID uint) error {
	now := time.Now()
	for _, tmpl := range builtinFilterTemplates(orgID, now) {
		var existing models.FilterTemplate
		err := db.Where("org_id = ? AND is_builtin = ? AND name = ?", orgID, true, tmpl.Name).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := db.Create(&tmpl).Error; err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}

		if builtinFilterTemplateChanged(existing, tmpl) {
			existing.Description = tmpl.Description
			existing.Category = tmpl.Category
			existing.Tags = tmpl.Tags
			existing.Expressions = tmpl.Expressions
			existing.IsBuiltin = true
			if err := db.Save(&existing).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func builtinFilterTemplateChanged(existing, next models.FilterTemplate) bool {
	return existing.Description != next.Description ||
		existing.Category != next.Category ||
		!reflect.DeepEqual(existing.Tags, next.Tags) ||
		!reflect.DeepEqual(existing.Expressions, next.Expressions) ||
		!existing.IsBuiltin
}

func builtinFilterTemplates(orgID uint, now time.Time) []models.FilterTemplate {
	operatorAnd := models.TriggerOperatorAnd
	operatorOr := models.TriggerOperatorOr
	not := false

	return []models.FilterTemplate{
		{
			OrgID:       orgID,
			Name:        "安全高风险邮件",
			Description: "基于认证失败、高危附件、可疑链接和紧急话术识别高风险邮件。",
			Category:    "security",
			Tags:        models.StringArray{"安全", "风控", "钓鱼"},
			Expressions: models.TriggerExpressions{
				pluginExpression("builtin-security-risk", "email_security_filter", map[string]interface{}{
					"risk_threshold":               50,
					"check_authentication":         true,
					"check_executable_attachments": true,
					"check_suspicious_links":       true,
					"check_urgent_language":        true,
				}, &not),
			},
			IsBuiltin: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			OrgID:       orgID,
			Name:        "认证失败邮件头",
			Description: "匹配 Authentication-Results 或 Received-SPF 中的 SPF/DKIM/DMARC 失败信号。",
			Category:    "header",
			Tags:        models.StringArray{"邮件头", "DMARC", "SPF", "DKIM"},
			Expressions: models.TriggerExpressions{
				groupExpression("builtin-auth-fail-root", &operatorOr, []models.TriggerExpression{
					pluginExpression("builtin-auth-dmarc", "email_header_filter", map[string]interface{}{
						"match_mode":     "any",
						"case_sensitive": false,
						"rules": []map[string]interface{}{
							{"name": "Authentication-Results", "operator": "contains", "value": "dmarc=fail"},
							{"name": "Authentication-Results", "operator": "contains", "value": "spf=fail"},
							{"name": "Authentication-Results", "operator": "contains", "value": "dkim=fail"},
							{"name": "Received-SPF", "operator": "contains", "value": "fail"},
						},
					}, &not),
				}),
			},
			IsBuiltin: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			OrgID:       orgID,
			Name:        "高危附件拦截",
			Description: "识别 exe、js、vbs、ps1、jar、宏文档等常见高风险附件类型。",
			Category:    "attachment",
			Tags:        models.StringArray{"附件", "安全", "阻断"},
			Expressions: models.TriggerExpressions{
				pluginExpression("builtin-dangerous-attachments", "email_attachment_filter", map[string]interface{}{
					"min_count":          1,
					"max_count":          0,
					"allowed_extensions": []string{},
					"blocked_extensions": []string{"exe", "scr", "bat", "cmd", "js", "vbs", "ps1", "jar", "docm", "xlsm", "pptm"},
					"filename_contains":  "",
					"min_total_size":     "",
					"max_total_size":     "",
				}, &not),
			},
			IsBuiltin: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			OrgID:       orgID,
			Name:        "发票与报价附件",
			Description: "匹配带有 PDF、Office 表格/文档附件的发票、报价、对账类邮件。",
			Category:    "attachment",
			Tags:        models.StringArray{"财务", "附件", "发票", "报价"},
			Expressions: models.TriggerExpressions{
				groupExpression("builtin-invoice-root", &operatorAnd, []models.TriggerExpression{
					pluginExpression("builtin-invoice-attachment", "email_attachment_filter", map[string]interface{}{
						"min_count":          1,
						"max_count":          0,
						"allowed_extensions": []string{"pdf", "doc", "docx", "xls", "xlsx", "csv"},
						"blocked_extensions": []string{},
						"filename_contains":  "",
						"min_total_size":     "",
						"max_total_size":     "25MB",
					}, &not),
					expressionCondition("builtin-invoice-subject", "email.subject", "matches", "(?i)(invoice|receipt|quote|quotation|发票|收据|报价|对账)"),
				}),
			},
			IsBuiltin: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			OrgID:       orgID,
			Name:        "系统通知邮件",
			Description: "匹配 noreply、no-reply、notification、support 等常见系统通知发件人。",
			Category:    "sender",
			Tags:        models.StringArray{"通知", "系统邮件", "发件人"},
			Expressions: models.TriggerExpressions{
				pluginExpression("builtin-system-prefixes", "email_prefix", map[string]interface{}{
					"prefixes":       []string{"noreply", "no-reply", "notification", "notify", "support"},
					"match_type":     "from",
					"case_sensitive": false,
					"match_mode":     "any",
				}, &not),
			},
			IsBuiltin: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			OrgID:       orgID,
			Name:        "企业域名白名单",
			Description: "用于快速筛选公司或合作伙伴域名，应用后把 example.com 替换成真实域名。",
			Category:    "sender",
			Tags:        models.StringArray{"域名", "白名单", "企业"},
			Expressions: models.TriggerExpressions{
				pluginExpression("builtin-company-domains", "email_suffix", map[string]interface{}{
					"suffixes":       []string{"example.com", "partner.example"},
					"match_type":     "from",
					"case_sensitive": false,
					"match_mode":     "any",
					"exact_match":    false,
				}, &not),
			},
			IsBuiltin: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
}

func groupExpression(id string, operator *models.TriggerOperator, conditions []models.TriggerExpression) models.TriggerExpression {
	return models.TriggerExpression{
		ID:         id,
		Type:       models.TriggerExpressionTypeGroup,
		Operator:   operator,
		Conditions: conditions,
	}
}

func pluginExpression(id, pluginID string, fields map[string]interface{}, not *bool) models.TriggerExpression {
	return models.TriggerExpression{
		ID:       id,
		Type:     models.TriggerExpressionTypePlugin,
		PluginID: stringPtr(pluginID),
		Fields:   models.JSONMapInterface(fields),
		Not:      not,
	}
}

func expressionCondition(id, field, operator string, value interface{}) models.TriggerExpression {
	return models.TriggerExpression{
		ID:       id,
		Type:     models.TriggerExpressionTypeCondition,
		Field:    stringPtr(field),
		Operator: operatorPtr(operator),
		Value:    value,
	}
}

func stringPtr(value string) *string {
	return &value
}

func operatorPtr(value string) *models.TriggerOperator {
	operator := models.TriggerOperator(value)
	return &operator
}
