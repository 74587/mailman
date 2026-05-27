package services

import (
	"fmt"
	"strings"

	"mailman/internal/models"
	"mailman/internal/triggerv2/plugins/builtin"
)

// CheckExtractorTemplateCompatibility verifies whether a template can run safely in pickup context.
func CheckExtractorTemplateCompatibility(template *models.ExtractorTemplateV2) models.ExtractorTemplateCompatibility {
	if template == nil {
		return incompatibleTemplateCompatibility([]models.ExtractorCompatibilityIssue{
			{
				Path:     "template",
				Kind:     "template",
				Message:  "template is nil",
				Severity: "error",
			},
		})
	}

	return CheckPickupTemplateCompatibility(template.Expressions, template.Actions)
}

// CheckPickupTemplateCompatibility verifies raw pickup expressions/actions without requiring a saved template.
func CheckPickupTemplateCompatibility(expressions models.TriggerExpressions, actions models.TriggerActions) models.ExtractorTemplateCompatibility {
	var issues []models.ExtractorCompatibilityIssue

	for i, expr := range expressions {
		issues = append(issues, collectPickupExpressionIssues(expr, fmt.Sprintf("expressions[%d]", i))...)
	}
	for i, action := range actions {
		issues = append(issues, collectPickupActionIssues(action, fmt.Sprintf("actions[%d]", i))...)
	}

	if len(issues) > 0 {
		return incompatibleTemplateCompatibility(issues)
	}

	return models.ExtractorTemplateCompatibility{
		Compatible: true,
		Message:    "取件模板兼容",
	}
}

func incompatibleTemplateCompatibility(issues []models.ExtractorCompatibilityIssue) models.ExtractorTemplateCompatibility {
	message := "取件模板包含不兼容配置"
	if len(issues) > 0 {
		message = fmt.Sprintf("取件模板包含 %d 个不兼容配置：%s", len(issues), issues[0].Message)
	}

	return models.ExtractorTemplateCompatibility{
		Compatible: false,
		Message:    message,
		Issues:     issues,
	}
}

func collectPickupExpressionIssues(expr models.TriggerExpression, path string) []models.ExtractorCompatibilityIssue {
	switch expr.Type {
	case models.TriggerExpressionTypeGroup:
		var issues []models.ExtractorCompatibilityIssue
		for i, child := range expr.Conditions {
			issues = append(issues, collectPickupExpressionIssues(child, fmt.Sprintf("%s.conditions[%d]", path, i))...)
		}
		return issues
	case models.TriggerExpressionTypePlugin:
		if expr.PluginID == nil || strings.TrimSpace(*expr.PluginID) == "" {
			return []models.ExtractorCompatibilityIssue{
				{
					Path:     path,
					Kind:     "condition",
					Message:  "插件条件缺少 pluginId",
					Severity: "error",
				},
			}
		}

		pluginID := strings.TrimSpace(*expr.PluginID)
		if pluginID == "builtin" {
			return nil
		}
		if !builtin.IsPluginAllowedInContextByID(pluginID, builtin.PluginContextPickup) {
			return []models.ExtractorCompatibilityIssue{
				{
					Path:     path,
					Kind:     "condition",
					PluginID: pluginID,
					Message:  fmt.Sprintf("插件条件 %s 不适用于取件模板", pluginID),
					Severity: "error",
				},
			}
		}
	}

	return nil
}

func collectPickupActionIssues(action models.TriggerAction, path string) []models.ExtractorCompatibilityIssue {
	if !action.Enabled {
		return nil
	}

	pluginID := strings.TrimSpace(action.PluginID)
	if pluginID == "" {
		return []models.ExtractorCompatibilityIssue{
			{
				Path:       path,
				Kind:       "action",
				PluginName: action.PluginName,
				Message:    "动作缺少 pluginId",
				Severity:   "error",
			},
		}
	}

	if !isPickupActionAllowed(pluginID) {
		return []models.ExtractorCompatibilityIssue{
			{
				Path:       path,
				Kind:       "action",
				PluginID:   pluginID,
				PluginName: action.PluginName,
				Message:    fmt.Sprintf("动作插件 %s 不适用于取件模板", pluginID),
				Severity:   "error",
			},
		}
	}

	config := mapFromJSONMapInterface(action.Config)
	switch pluginID {
	case "conditional_branch_action":
		return collectPickupConditionalBranchIssues(config, path)
	case "parallel_actions":
		return collectPickupActionListIssues(config["actions"], path+".actions")
	default:
		return nil
	}
}

func collectPickupConditionalBranchIssues(config map[string]interface{}, path string) []models.ExtractorCompatibilityIssue {
	if config == nil {
		return nil
	}

	var issues []models.ExtractorCompatibilityIssue
	issues = append(issues, collectPickupBranchesIssues(config["branches"], path+".branches")...)
	issues = append(issues, collectPickupActionListIssues(config["else_actions"], path+".else_actions")...)
	return issues
}

func collectPickupBranchesIssues(raw interface{}, path string) []models.ExtractorCompatibilityIssue {
	if raw == nil {
		return nil
	}

	var issues []models.ExtractorCompatibilityIssue
	switch branches := raw.(type) {
	case []interface{}:
		for i, branch := range branches {
			branchMap, ok := branch.(map[string]interface{})
			if !ok {
				issues = append(issues, invalidShapeIssue(fmt.Sprintf("%s[%d]", path, i), "condition_branch", "分支配置必须是对象"))
				continue
			}
			issues = append(issues, collectPickupActionListIssues(branchMap["actions"], fmt.Sprintf("%s[%d].actions", path, i))...)
		}
	case []map[string]interface{}:
		for i, branch := range branches {
			issues = append(issues, collectPickupActionListIssues(branch["actions"], fmt.Sprintf("%s[%d].actions", path, i))...)
		}
	default:
		issues = append(issues, invalidShapeIssue(path, "condition_branch", "分支列表必须是数组"))
	}

	return issues
}

func collectPickupActionListIssues(raw interface{}, path string) []models.ExtractorCompatibilityIssue {
	if raw == nil {
		return nil
	}

	var issues []models.ExtractorCompatibilityIssue
	switch actions := raw.(type) {
	case []interface{}:
		for i, action := range actions {
			actionMap, ok := action.(map[string]interface{})
			if !ok {
				issues = append(issues, invalidShapeIssue(fmt.Sprintf("%s[%d]", path, i), "action", "动作配置必须是对象"))
				continue
			}
			issues = append(issues, collectPickupActionMapIssues(actionMap, fmt.Sprintf("%s[%d]", path, i))...)
		}
	case []map[string]interface{}:
		for i, action := range actions {
			issues = append(issues, collectPickupActionMapIssues(action, fmt.Sprintf("%s[%d]", path, i))...)
		}
	case []models.TriggerAction:
		for i, action := range actions {
			issues = append(issues, collectPickupActionIssues(action, fmt.Sprintf("%s[%d]", path, i))...)
		}
	default:
		issues = append(issues, invalidShapeIssue(path, "action", "动作列表必须是数组"))
	}

	return issues
}

func collectPickupActionMapIssues(action map[string]interface{}, path string) []models.ExtractorCompatibilityIssue {
	if enabled, ok := action["enabled"].(bool); ok && !enabled {
		return nil
	}

	pluginID := strings.TrimSpace(stringFromActionMap(action, "plugin_id", "pluginId"))
	config := configFromActionMap(action)
	actionName := stringFromActionMap(action, "pluginName", "name")
	return collectPickupActionIssues(models.TriggerAction{
		PluginID:   pluginID,
		PluginName: actionName,
		Config:     models.JSONMapInterface(config),
		Enabled:    true,
	}, path)
}

func invalidShapeIssue(path string, kind string, message string) models.ExtractorCompatibilityIssue {
	return models.ExtractorCompatibilityIssue{
		Path:     path,
		Kind:     kind,
		Message:  message,
		Severity: "error",
	}
}

func mapFromJSONMapInterface(input models.JSONMapInterface) map[string]interface{} {
	if input == nil {
		return nil
	}
	return map[string]interface{}(input)
}

func configFromActionMap(action map[string]interface{}) map[string]interface{} {
	config, _ := action["config"].(map[string]interface{})
	if config == nil {
		config = map[string]interface{}{}
	}
	return config
}
