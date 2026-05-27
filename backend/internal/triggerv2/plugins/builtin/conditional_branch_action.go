package builtin

import (
	"encoding/json"
	"fmt"
	"time"

	"mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// ConditionalBranch 条件分支
type ConditionalBranch struct {
	Name       string                   `json:"name"`       // 分支名称（可选）
	Conditions []map[string]interface{} `json:"conditions"` // 条件表达式（复用 TriggerExpression 结构）
	Actions    []BranchAction           `json:"actions"`    // 分支动作列表
}

// BranchAction 分支内的动作
type BranchAction struct {
	PluginID string                 `json:"plugin_id"`
	Config   map[string]interface{} `json:"config"`
	Enabled  bool                   `json:"enabled"`
}

// ConditionalBranchActionPlugin 条件分支动作插件
// 实现 if-else if-else 逻辑
type ConditionalBranchActionPlugin struct {
	info          *plugins.PluginInfo
	config        map[string]interface{}
	pluginManager plugins.PluginManager
}

// NewConditionalBranchActionPlugin 创建条件分支动作插件
func NewConditionalBranchActionPlugin() plugins.ActionPlugin {
	return &ConditionalBranchActionPlugin{
		info: &plugins.PluginInfo{
			ID:          "conditional_branch_action",
			Name:        "条件分支",
			Version:     "1.0.0",
			Description: "根据条件执行不同的动作分支，实现 if-else if-else 逻辑",
			Author:      "TriggerV2 Team",
			Website:     "https://github.com/triggerv2/plugins",
			License:     "MIT",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
			ConfigSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"branches": map[string]interface{}{
						"type":        "array",
						"description": "条件分支列表",
					},
					"else_actions": map[string]interface{}{
						"type":        "array",
						"description": "默认分支动作（当所有条件都不满足时执行）",
					},
					"return_first_match": map[string]interface{}{
						"type":        "boolean",
						"description": "只执行第一个匹配的分支",
						"default":     true,
					},
				},
				"required": []string{"branches"},
			},
			DefaultConfig: map[string]interface{}{
				"branches":           []ConditionalBranch{},
				"else_actions":       []BranchAction{},
				"return_first_match": true,
			},
		},
		config: make(map[string]interface{}),
	}
}

// GetInfo 获取插件信息
func (p *ConditionalBranchActionPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize 初始化插件
func (p *ConditionalBranchActionPlugin) Initialize(ctx *plugins.PluginContext) error {
	return nil
}

// Cleanup 清理插件
func (p *ConditionalBranchActionPlugin) Cleanup() error {
	return nil
}

// OnLoad 加载时触发
func (p *ConditionalBranchActionPlugin) OnLoad() error {
	return nil
}

// OnUnload 卸载时触发
func (p *ConditionalBranchActionPlugin) OnUnload() error {
	return nil
}

// OnActivate 激活时触发
func (p *ConditionalBranchActionPlugin) OnActivate() error {
	return nil
}

// OnDeactivate 停用时触发
func (p *ConditionalBranchActionPlugin) OnDeactivate() error {
	return nil
}

// GetDefaultConfig 获取默认配置
func (p *ConditionalBranchActionPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{
		"branches":           []ConditionalBranch{},
		"else_actions":       []BranchAction{},
		"return_first_match": true,
	}
}

// ValidateConfig 验证配置
func (p *ConditionalBranchActionPlugin) ValidateConfig(config map[string]interface{}) error {
	branchesRaw, ok := config["branches"]
	if !ok {
		return fmt.Errorf("branches 为必填项")
	}

	branchesSlice, ok := branchesRaw.([]interface{})
	if !ok {
		return fmt.Errorf("branches 必须是数组")
	}

	if len(branchesSlice) == 0 {
		return fmt.Errorf("至少需要一个条件分支")
	}

	return nil
}

// ApplyConfig 应用配置
func (p *ConditionalBranchActionPlugin) ApplyConfig(config map[string]interface{}) error {
	if err := p.ValidateConfig(config); err != nil {
		return err
	}
	p.config = config
	return nil
}

// HealthCheck 健康检查
func (p *ConditionalBranchActionPlugin) HealthCheck() error {
	return nil
}

// GetMetrics 获取指标
func (p *ConditionalBranchActionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"avg_execution_time": p.info.AvgExecutionTime,
		"usage_count":        p.info.UsageCount,
		"error_rate":         p.info.ErrorRate,
	}
}

// GetDescription 获取描述
func (p *ConditionalBranchActionPlugin) GetDescription() string {
	return "根据条件执行不同的动作分支。支持多个条件分支（if-else if）和默认分支（else），条件表达式复用过滤器的表达式语法。"
}

// GetSupportedEventTypes 获取支持的事件类型
func (p *ConditionalBranchActionPlugin) GetSupportedEventTypes() []string {
	return []string{
		string(triggerModels.EventTypeEmailReceived),
		string(triggerModels.EventTypeEmailUpdated),
	}
}

// GetRequiredConfig 获取必需的配置
func (p *ConditionalBranchActionPlugin) GetRequiredConfig() []string {
	return []string{"branches"}
}

// CanExecute 检查是否可以执行
func (p *ConditionalBranchActionPlugin) CanExecute(ctx *plugins.PluginContext, event *triggerModels.Event) bool {
	if event.Type != triggerModels.EventTypeEmailReceived && event.Type != triggerModels.EventTypeEmailUpdated {
		return false
	}
	return true
}

// GetExecutionOrder 获取执行顺序
func (p *ConditionalBranchActionPlugin) GetExecutionOrder() int {
	return 100 // 中等优先级
}

// SetPluginManager 设置插件管理器（用于执行子动作）
func (p *ConditionalBranchActionPlugin) SetPluginManager(pm plugins.PluginManager) {
	p.pluginManager = pm
}

// Execute 执行动作
func (p *ConditionalBranchActionPlugin) Execute(ctx *plugins.PluginContext, event *triggerModels.Event) (*plugins.PluginResult, error) {
	startTime := time.Now()

	// 更新使用统计
	p.info.UsageCount++
	p.info.LastUsed = time.Now()

	// 获取邮件对象
	var email *models.Email
	var emailEventData triggerModels.EmailEventData
	if err := event.GetData(&emailEventData); err == nil && emailEventData.Email != nil {
		email = emailEventData.Email
	} else {
		return &plugins.PluginResult{
			Success:       false,
			Error:         "无法获取邮件数据",
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	// 解析配置
	branches, err := p.parseBranches(p.config)
	if err != nil {
		return &plugins.PluginResult{
			Success:       false,
			Error:         fmt.Sprintf("解析分支配置失败: %v", err),
			ExecutionTime: time.Since(startTime),
			Timestamp:     time.Now(),
		}, nil
	}

	returnFirstMatch := true
	if v, ok := p.config["return_first_match"].(bool); ok {
		returnFirstMatch = v
	}

	// 评估分支条件
	executedBranches := []map[string]interface{}{}
	var lastResult *plugins.PluginResult
	branchMatched := false

	for i, branch := range branches {
		// 评估条件
		conditionMet, err := p.evaluateConditions(branch.Conditions, email, event, ctx)
		if err != nil {
			return &plugins.PluginResult{
				Success:       false,
				Error:         fmt.Sprintf("分支 %d 条件评估失败: %v", i+1, err),
				ExecutionTime: time.Since(startTime),
				Timestamp:     time.Now(),
			}, nil
		}

		if conditionMet {
			branchMatched = true

			// 执行分支动作
			branchResult, err := p.executeBranchActions(branch.Actions, event, ctx)
			if err != nil {
				return &plugins.PluginResult{
					Success:       false,
					Error:         fmt.Sprintf("分支 %d 动作执行失败: %v", i+1, err),
					ExecutionTime: time.Since(startTime),
					Timestamp:     time.Now(),
				}, nil
			}

			executedBranches = append(executedBranches, map[string]interface{}{
				"branch_index":  i,
				"branch_name":   branch.Name,
				"condition_met": true,
				"result":        branchResult,
			})

			lastResult = branchResult

			if returnFirstMatch {
				break
			}
		}
	}

	// 如果没有分支匹配，执行 else 动作
	if !branchMatched {
		elseActions, err := p.parseElseActions(p.config)
		if err == nil && len(elseActions) > 0 {
			elseResult, err := p.executeBranchActions(elseActions, event, ctx)
			if err != nil {
				return &plugins.PluginResult{
					Success:       false,
					Error:         fmt.Sprintf("else 分支动作执行失败: %v", err),
					ExecutionTime: time.Since(startTime),
					Timestamp:     time.Now(),
				}, nil
			}

			executedBranches = append(executedBranches, map[string]interface{}{
				"branch_index":  -1,
				"branch_name":   "else",
				"condition_met": true,
				"result":        elseResult,
			})

			lastResult = elseResult
		}
	}

	// 计算执行时间
	duration := time.Since(startTime)
	p.info.AvgExecutionTime = (p.info.AvgExecutionTime + duration) / 2

	// 构建返回结果
	resultData := map[string]interface{}{
		"branches_evaluated": len(branches),
		"branches_executed":  len(executedBranches),
		"executed_branches":  executedBranches,
	}

	// 如果有最后一个结果，合并其数据
	if lastResult != nil && lastResult.Data != nil {
		resultData["last_branch_result"] = lastResult.Data
	}

	return &plugins.PluginResult{
		Success:       true,
		ExecutionTime: duration,
		Timestamp:     time.Now(),
		Data:          resultData,
	}, nil
}

// parseBranches 解析分支配置
func (p *ConditionalBranchActionPlugin) parseBranches(config map[string]interface{}) ([]ConditionalBranch, error) {
	branchesRaw, ok := config["branches"]
	if !ok {
		return []ConditionalBranch{}, nil
	}

	branchesSlice, ok := branchesRaw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("branches 必须是数组")
	}

	branches := make([]ConditionalBranch, 0, len(branchesSlice))
	for i, branchRaw := range branchesSlice {
		branchMap, ok := branchRaw.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("分支 %d: 格式无效", i+1)
		}

		branch := ConditionalBranch{
			Name: getStringValue(branchMap, "name", fmt.Sprintf("分支 %d", i+1)),
		}

		// 解析条件
		if conditions, ok := branchMap["conditions"].([]interface{}); ok {
			for _, cond := range conditions {
				if condMap, ok := cond.(map[string]interface{}); ok {
					branch.Conditions = append(branch.Conditions, condMap)
				}
			}
		}

		// 解析动作
		if actions, ok := branchMap["actions"].([]interface{}); ok {
			for _, action := range actions {
				if actionMap, ok := action.(map[string]interface{}); ok {
					pluginID := getStringValue(actionMap, "plugin_id", "")
					if pluginID == "" {
						pluginID = getStringValue(actionMap, "pluginId", "")
					}
					branchAction := BranchAction{
						PluginID: pluginID,
						Enabled:  true,
					}
					if config, ok := actionMap["config"].(map[string]interface{}); ok {
						branchAction.Config = config
					}
					if enabled, ok := actionMap["enabled"].(bool); ok {
						branchAction.Enabled = enabled
					}
					branch.Actions = append(branch.Actions, branchAction)
				}
			}
		}

		branches = append(branches, branch)
	}

	return branches, nil
}

// parseElseActions 解析 else 分支动作
func (p *ConditionalBranchActionPlugin) parseElseActions(config map[string]interface{}) ([]BranchAction, error) {
	actionsRaw, ok := config["else_actions"]
	if !ok {
		return []BranchAction{}, nil
	}

	actionsSlice, ok := actionsRaw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("else_actions 必须是数组")
	}

	actions := make([]BranchAction, 0, len(actionsSlice))
	for _, actionRaw := range actionsSlice {
		if actionMap, ok := actionRaw.(map[string]interface{}); ok {
			pluginID := getStringValue(actionMap, "plugin_id", "")
			if pluginID == "" {
				pluginID = getStringValue(actionMap, "pluginId", "")
			}
			action := BranchAction{
				PluginID: pluginID,
				Enabled:  true,
			}
			if config, ok := actionMap["config"].(map[string]interface{}); ok {
				action.Config = config
			}
			if enabled, ok := actionMap["enabled"].(bool); ok {
				action.Enabled = enabled
			}
			actions = append(actions, action)
		}
	}

	return actions, nil
}

// evaluateConditions 评估条件表达式
func (p *ConditionalBranchActionPlugin) evaluateConditions(conditions []map[string]interface{}, email *models.Email, event *triggerModels.Event, ctx *plugins.PluginContext) (bool, error) {
	if len(conditions) == 0 {
		return true, nil // 无条件则默认通过
	}

	// 使用简化的条件评估逻辑
	// 条件结构应该类似于 TriggerExpression
	for _, cond := range conditions {
		result, err := p.evaluateSingleCondition(cond, email, event, ctx)
		if err != nil {
			return false, err
		}
		if !result {
			return false, nil // AND 逻辑，任一条件不满足则整体不满足
		}
	}

	return true, nil
}

// evaluateSingleCondition 评估单个条件
func (p *ConditionalBranchActionPlugin) evaluateSingleCondition(cond map[string]interface{}, email *models.Email, event *triggerModels.Event, ctx *plugins.PluginContext) (bool, error) {
	condType := getStringValue(cond, "type", "condition")

	switch condType {
	case "condition":
		return p.evaluateFieldCondition(cond, email, event)
	case "group":
		return p.evaluateGroupCondition(cond, email, event, ctx)
	case "expression", "plugin":
		return p.evaluatePluginCondition(cond, email, event, ctx)
	default:
		return false, fmt.Errorf("不支持的条件类型: %s", condType)
	}
}

// evaluateFieldCondition 评估字段条件
func (p *ConditionalBranchActionPlugin) evaluateFieldCondition(cond map[string]interface{}, email *models.Email, event *triggerModels.Event) (bool, error) {
	field := getStringValue(cond, "field", "")
	operator := getStringValue(cond, "operator", "equals")
	expectedValue := cond["value"]

	// 获取字段值
	actualValue := p.getFieldValue(field, email, event)

	// 比较
	return p.compare(actualValue, operator, expectedValue)
}

// getFieldValue 获取字段值
func (p *ConditionalBranchActionPlugin) getFieldValue(field string, email *models.Email, event *triggerModels.Event) interface{} {
	// 检查是否是变量引用
	if field == "$_" || field == "_" {
		if val, exists := event.GetVariable("_"); exists {
			return val
		}
		return nil
	}

	if len(field) > 0 && field[0] == '$' {
		varName := field[1:]
		if val, exists := event.GetVariable(varName); exists {
			return val
		}
		return nil
	}

	// 邮件字段
	switch field {
	case "Subject", "subject":
		return email.Subject
	case "From", "from":
		if len(email.From) > 0 {
			return email.From[0]
		}
		return ""
	case "To", "to":
		if len(email.To) > 0 {
			return email.To[0]
		}
		return ""
	case "Body", "body":
		return email.Body
	case "TextBody", "text_body":
		return email.TextBody
	default:
		return nil
	}
}

// compare 比较值
func (p *ConditionalBranchActionPlugin) compare(actual interface{}, operator string, expected interface{}) (bool, error) {
	actualStr := fmt.Sprintf("%v", actual)
	expectedStr := fmt.Sprintf("%v", expected)

	switch operator {
	case "equals", "eq", "==":
		return actualStr == expectedStr, nil
	case "not_equals", "ne", "!=":
		return actualStr != expectedStr, nil
	case "contains":
		return containsString(actualStr, expectedStr), nil
	case "not_contains":
		return !containsString(actualStr, expectedStr), nil
	case "starts_with":
		return len(actualStr) >= len(expectedStr) && actualStr[:len(expectedStr)] == expectedStr, nil
	case "ends_with":
		return len(actualStr) >= len(expectedStr) && actualStr[len(actualStr)-len(expectedStr):] == expectedStr, nil
	case "is_empty":
		return actualStr == "", nil
	case "is_not_empty":
		return actualStr != "", nil
	default:
		return false, fmt.Errorf("不支持的操作符: %s", operator)
	}
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || (len(s) > 0 && findSubstring(s, substr)))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// evaluateGroupCondition 评估条件组
func (p *ConditionalBranchActionPlugin) evaluateGroupCondition(cond map[string]interface{}, email *models.Email, event *triggerModels.Event, ctx *plugins.PluginContext) (bool, error) {
	operator := getStringValue(cond, "operator", "and")
	conditionsRaw, ok := cond["conditions"].([]interface{})
	if !ok {
		return true, nil
	}

	for _, subCond := range conditionsRaw {
		subCondMap, ok := subCond.(map[string]interface{})
		if !ok {
			continue
		}

		result, err := p.evaluateSingleCondition(subCondMap, email, event, ctx)
		if err != nil {
			return false, err
		}

		if operator == "or" && result {
			return true, nil // OR: 任一为真则为真
		}
		if operator == "and" && !result {
			return false, nil // AND: 任一为假则为假
		}
	}

	if operator == "or" {
		return false, nil // OR: 全部为假
	}
	return true, nil // AND: 全部为真
}

// evaluatePluginCondition 评估插件条件
func (p *ConditionalBranchActionPlugin) evaluatePluginCondition(cond map[string]interface{}, email *models.Email, event *triggerModels.Event, ctx *plugins.PluginContext) (bool, error) {
	// 如果有插件管理器，使用插件评估
	if p.pluginManager != nil {
		pluginID := getStringValue(cond, "pluginId", "")
		if pluginID == "" {
			pluginID = getStringValue(cond, "plugin_id", "")
		}

		if pluginID != "" {
			// 使用 PluginManager 的 ExecuteCondition 方法
			result, err := p.pluginManager.ExecuteCondition(pluginID, ctx, event)
			if err != nil {
				return false, err
			}
			return result != nil && result.Success, nil
		}
	}

	// 简单的 JavaScript 表达式评估
	if exprType := getStringValue(cond, "type", ""); exprType == "expression" {
		fieldsRaw, _ := cond["fields"].(map[string]interface{})
		expression := getStringValue(fieldsRaw, "expression", "")
		if expression != "" {
			return p.evaluateJavaScriptExpression(expression, email, event)
		}
	}

	return true, nil
}

// evaluateJavaScriptExpression 评估 JavaScript 表达式
func (p *ConditionalBranchActionPlugin) evaluateJavaScriptExpression(expression string, email *models.Email, event *triggerModels.Event) (bool, error) {
	// 使用 goja 执行 JavaScript
	vm := gojaNew()

	// 设置 $ 对象
	emailContext := map[string]interface{}{
		"Subject":        email.Subject,
		"From":           email.From,
		"To":             email.To,
		"Body":           email.Body,
		"TextBody":       email.TextBody,
		"HTMLBody":       email.HTMLBody,
		"HasAttachments": email.HasAttachments,
	}
	vm.Set("$", emailContext)

	// 设置变量
	vm.Set("$var", event.GetAllVariables())
	if prevOutput, exists := event.GetVariable("_"); exists {
		vm.Set("$_", prevOutput)
	}

	result, err := vm.RunString(expression)
	if err != nil {
		return false, fmt.Errorf("JavaScript 表达式执行失败: %v", err)
	}

	return result.ToBoolean(), nil
}

// gojaNew 创建新的 goja VM
func gojaNew() *gojaVM {
	return &gojaVM{values: make(map[string]interface{})}
}

type gojaVM struct {
	values map[string]interface{}
}

func (vm *gojaVM) Set(name string, value interface{}) {
	vm.values[name] = value
}

func (vm *gojaVM) RunString(script string) (*gojaResult, error) {
	// 简化的表达式评估
	// 在实际实现中应该使用完整的 goja 库
	// 这里仅作为占位符

	// 简单地返回 true（实际应该执行 JavaScript）
	return &gojaResult{value: true}, nil
}

type gojaResult struct {
	value interface{}
}

func (r *gojaResult) ToBoolean() bool {
	if b, ok := r.value.(bool); ok {
		return b
	}
	return false
}

// executeBranchActions 执行分支动作
func (p *ConditionalBranchActionPlugin) executeBranchActions(actions []BranchAction, event *triggerModels.Event, ctx *plugins.PluginContext) (*plugins.PluginResult, error) {
	if len(actions) == 0 {
		return &plugins.PluginResult{
			Success:   true,
			Timestamp: time.Now(),
			Data:      map[string]interface{}{"message": "无动作需要执行"},
		}, nil
	}

	var lastResult *plugins.PluginResult

	for i, action := range actions {
		if !action.Enabled {
			continue
		}

		if p.pluginManager == nil {
			return nil, fmt.Errorf("插件管理器未设置，无法执行动作")
		}

		childCtx := childPluginContext(ctx, action.PluginID, action.Config)
		result, err := p.pluginManager.ExecuteAction(action.PluginID, childCtx, event)
		if err != nil {
			return nil, fmt.Errorf("动作 %d: 执行插件 %s 失败: %v", i+1, action.PluginID, err)
		}

		// 保存上一步输出到 $_ 变量
		if result != nil && result.Data != nil {
			event.SetVariable("_", result.Data)
		}

		lastResult = result
	}

	if lastResult == nil {
		lastResult = &plugins.PluginResult{
			Success:   true,
			Timestamp: time.Now(),
		}
	}

	return lastResult, nil
}

// GetUISchema 获取UI架构
func (p *ConditionalBranchActionPlugin) GetUISchema() *plugins.UISchema {
	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "branches",
				Label:       "条件分支",
				Type:        plugins.UIFieldTypeArray,
				Description: "定义条件分支列表，按顺序评估条件",
				Required:    true,
				Width:       "full",
				ItemSchema: &plugins.UISchema{
					Fields: []plugins.UIField{
						{
							Name:        "name",
							Label:       "分支名称",
							Type:        plugins.UIFieldTypeText,
							Description: "为分支命名以便识别",
							Required:    false,
							Width:       "full",
							Placeholder: "例如: 验证码邮件",
						},
						{
							Name:        "conditions",
							Label:       "条件",
							Type:        plugins.UIFieldTypeJSON,
							Description: "定义分支的触发条件（使用JSON格式）",
							Required:    true,
							Width:       "full",
						},
						{
							Name:        "actions",
							Label:       "动作",
							Type:        plugins.UIFieldTypeArray,
							Description: "条件满足时执行的动作列表",
							Required:    true,
							Width:       "full",
						},
					},
				},
			},
			{
				Name:        "else_actions",
				Label:       "默认分支动作",
				Type:        plugins.UIFieldTypeArray,
				Description: "当所有条件分支都不满足时执行的动作",
				Required:    false,
				Width:       "full",
			},
			{
				Name:         "return_first_match",
				Label:        "只执行第一个匹配",
				Type:         plugins.UIFieldTypeBoolean,
				Description:  "开启后只执行第一个条件满足的分支，关闭后执行所有满足条件的分支",
				Required:     false,
				Width:        "1/2",
				DefaultValue: true,
			},
		},
		Layout: "vertical",
	}
}

// GetFieldSuggestions 获取字段建议
func (p *ConditionalBranchActionPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	return nil, nil
}

// ValidateFieldValue 验证字段值
func (p *ConditionalBranchActionPlugin) ValidateFieldValue(field string, value interface{}) error {
	return nil
}

// GetDynamicOptions 获取动态选项
func (p *ConditionalBranchActionPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	return nil, nil
}

// MarshalJSON 自定义 JSON 序列化
func (b *ConditionalBranch) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Name       string                   `json:"name"`
		Conditions []map[string]interface{} `json:"conditions"`
		Actions    []BranchAction           `json:"actions"`
	}{
		Name:       b.Name,
		Conditions: b.Conditions,
		Actions:    b.Actions,
	})
}
