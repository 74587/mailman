package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"mailman/internal/expression"
	"mailman/internal/expression/core"
	"mailman/internal/models"
	"mailman/internal/repository"
	v2models "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
	"mailman/internal/triggerv2/plugins/builtin"

	"github.com/PaesslerAG/jsonpath"
	"gorm.io/gorm"
)

// ExtractorServiceV2 取件模板服务V2
type ExtractorServiceV2 struct {
	db           *gorm.DB
	templateRepo *repository.ExtractorTemplateV2Repository
	logRepo      *repository.ExtractionLogV2Repository
	emailRepo    *repository.EmailRepository
	// 复用触发器的核心服务
	filterEvaluator *FilterEvaluatorService
	actionExecutor  *ActionExecutorService
}

// NewExtractorServiceV2 创建新的取件模板服务V2
func NewExtractorServiceV2(db *gorm.DB) *ExtractorServiceV2 {
	return &ExtractorServiceV2{
		db:              db,
		templateRepo:    repository.NewExtractorTemplateV2Repository(db),
		logRepo:         repository.NewExtractionLogV2Repository(db),
		emailRepo:       repository.NewEmailRepository(db),
		filterEvaluator: NewFilterEvaluatorService(),
		actionExecutor:  NewActionExecutorService(db),
	}
}

// Execute 执行取件模板提取
func (s *ExtractorServiceV2) Execute(templateID uint, emailID uint) (*models.ExtractionResult, error) {
	startTime := time.Now()

	// 获取模板
	template, err := s.templateRepo.GetByID(templateID)
	if err != nil {
		return nil, fmt.Errorf("template not found: %w", err)
	}

	// 检查模板是否启用
	if !template.Enabled {
		return &models.ExtractionResult{
			Success: false,
			Status:  models.ExtractionV2StatusSkipped,
			Error:   "Template is disabled",
		}, nil
	}

	// 获取邮件
	email, err := s.emailRepo.GetByID(emailID)
	if err != nil {
		return nil, fmt.Errorf("email not found: %w", err)
	}

	// 执行提取
	result := s.executeExtraction(template, email)
	result.Duration = time.Since(startTime).Milliseconds()

	// 记录日志
	s.saveExtractionLog(template, email, result, startTime)

	// 更新统计
	s.templateRepo.IncrementTotalExtractions(templateID)
	if result.Success {
		s.templateRepo.IncrementSuccessExtractions(templateID)
	} else if result.Error != "" {
		s.templateRepo.UpdateLastError(templateID, result.Error)
	}

	return result, nil
}

// TestExtraction 测试取件模板（不记录日志）
func (s *ExtractorServiceV2) TestExtraction(template *models.ExtractorTemplateV2, email *models.Email) (*models.ExtractionResult, error) {
	startTime := time.Now()
	result := s.executeExtraction(template, email)
	result.Duration = time.Since(startTime).Milliseconds()
	return result, nil
}

// DebugExtraction 调试取件模板（返回详细步骤信息）
func (s *ExtractorServiceV2) DebugExtraction(template *models.ExtractorTemplateV2, email *models.Email) (*models.DebugExtractionResult, error) {
	startTime := time.Now()

	debugResult := &models.DebugExtractionResult{
		StepResults: []models.StepDebugResult{},
	}

	// 步骤1: 评估过滤条件
	filterStartTime := time.Now()
	filterMatched, filterEvaluation := s.evaluateFilterWithDetails(template.Expressions, email)
	filterDuration := time.Since(filterStartTime).Milliseconds()

	debugResult.StepResults = append(debugResult.StepResults, models.StepDebugResult{
		StepIndex: 0,
		StepType:  "filter",
		StepName:  "过滤条件评估",
		Input:     s.emailToContext(email),
		Output:    filterEvaluation,
		Success:   filterMatched,
		Duration:  filterDuration,
	})

	debugResult.FilterEvaluation = filterEvaluation
	debugResult.FilterMatched = filterMatched

	// 如果过滤不匹配，提前返回
	if !filterMatched {
		debugResult.Success = false
		debugResult.Status = models.ExtractionV2StatusNoMatch
		debugResult.Duration = time.Since(startTime).Milliseconds()
		return debugResult, nil
	}

	// 步骤2-N: 执行动作链
	context := s.emailToContext(email)
	var lastOutput interface{}
	var actionResults []models.ActionExecutionResult

	for i, action := range template.Actions {
		if !action.Enabled {
			continue
		}

		actionStartTime := time.Now()

		// 准备输入（包含上一个动作的输出）
		actionInput := s.prepareActionInput(context, lastOutput, action)

		// 执行动作
		actionOutput, actionErr := s.actionExecutor.ExecuteAction(action, actionInput)
		actionDuration := time.Since(actionStartTime).Milliseconds()

		actionResult := models.ActionExecutionResult{
			ActionID:   action.ID,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			StartTime:  actionStartTime,
			EndTime:    time.Now(),
			Duration:   actionDuration,
			Input:      actionInput,
		}

		if actionErr != nil {
			actionResult.Success = false
			actionResult.Error = actionErr.Error()
		} else {
			actionResult.Success = true
			actionResult.Output = actionOutput
			lastOutput = actionOutput
		}

		actionResults = append(actionResults, actionResult)

		// 添加调试步骤
		debugResult.StepResults = append(debugResult.StepResults, models.StepDebugResult{
			StepIndex: i + 1,
			StepType:  "action",
			StepName:  action.PluginName,
			Input:     actionInput,
			Output:    actionOutput,
			Success:   actionResult.Success,
			Duration:  actionDuration,
			Error:     actionResult.Error,
		})

		// 如果动作失败，中止执行
		if !actionResult.Success {
			break
		}
	}

	debugResult.ActionResults = actionResults

	// 格式化输出
	if lastOutput != nil {
		debugResult.ExtractedValue = s.formatOutput(lastOutput, template.OutputConfig)
	}

	// 确定最终状态
	allSuccess := true
	for _, ar := range actionResults {
		if !ar.Success {
			allSuccess = false
			break
		}
	}

	if allSuccess && debugResult.ExtractedValue != nil {
		debugResult.Success = true
		debugResult.Status = models.ExtractionV2StatusSuccess
	} else if !allSuccess {
		debugResult.Success = false
		debugResult.Status = models.ExtractionV2StatusFailed
	} else {
		debugResult.Success = false
		debugResult.Status = models.ExtractionV2StatusPartial
	}

	debugResult.Duration = time.Since(startTime).Milliseconds()

	return debugResult, nil
}

// EvaluateFilter 评估过滤条件
func (s *ExtractorServiceV2) EvaluateFilter(template *models.ExtractorTemplateV2, email *models.Email) (bool, error) {
	if len(template.Expressions) == 0 {
		// 无过滤条件，默认匹配
		return true, nil
	}

	context := s.emailToContext(email)
	return s.filterEvaluator.Evaluate(template.Expressions, context)
}

// executeExtraction 执行提取逻辑
func (s *ExtractorServiceV2) executeExtraction(template *models.ExtractorTemplateV2, email *models.Email) *models.ExtractionResult {
	result := &models.ExtractionResult{
		ActionResults: []models.ActionExecutionResult{},
	}

	// 评估过滤条件
	filterMatched, _ := s.EvaluateFilter(template, email)
	result.FilterMatched = filterMatched

	if !filterMatched {
		result.Success = false
		result.Status = models.ExtractionV2StatusNoMatch
		return result
	}

	// 执行动作链
	context := s.emailToContext(email)
	var lastOutput interface{}

	for _, action := range template.Actions {
		if !action.Enabled {
			continue
		}

		actionStartTime := time.Now()

		// 准备输入
		actionInput := s.prepareActionInput(context, lastOutput, action)

		// 执行动作
		actionOutput, actionErr := s.actionExecutor.ExecuteAction(action, actionInput)

		actionResult := models.ActionExecutionResult{
			ActionID:   action.ID,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			StartTime:  actionStartTime,
			EndTime:    time.Now(),
			Duration:   time.Since(actionStartTime).Milliseconds(),
			Input:      actionInput,
		}

		if actionErr != nil {
			actionResult.Success = false
			actionResult.Error = actionErr.Error()
			result.ActionResults = append(result.ActionResults, actionResult)
			result.Success = false
			result.Status = models.ExtractionV2StatusFailed
			result.Error = actionErr.Error()
			return result
		}

		actionResult.Success = true
		actionResult.Output = actionOutput
		result.ActionResults = append(result.ActionResults, actionResult)
		lastOutput = actionOutput
	}

	// 格式化输出
	if lastOutput != nil {
		result.ExtractedValue = s.formatOutput(lastOutput, template.OutputConfig)
	}

	result.Success = true
	result.Status = models.ExtractionV2StatusSuccess

	return result
}

// evaluateFilterWithDetails 评估过滤条件并返回详细信息
func (s *ExtractorServiceV2) evaluateFilterWithDetails(expressions models.TriggerExpressions, email *models.Email) (bool, map[string]interface{}) {
	details := make(map[string]interface{})

	if len(expressions) == 0 {
		details["matched"] = true
		details["reason"] = "No filter expressions defined"
		return true, details
	}

	context := s.emailToContext(email)
	matched, err := s.filterEvaluator.Evaluate(expressions, context)

	details["matched"] = matched
	if err != nil {
		details["error"] = err.Error()
	}
	details["expressionCount"] = len(expressions)
	details["context"] = context

	return matched, details
}

// emailToContext 将邮件转换为上下文对象
func (s *ExtractorServiceV2) emailToContext(email *models.Email) map[string]interface{} {
	return map[string]interface{}{
		"$email":      email,
		"id":          email.ID,
		"messageId":   email.MessageID,
		"accountId":   email.AccountID,
		"subject":     email.Subject,
		"from":        strings.Join(email.From, ", "),
		"fromList":    []string(email.From),
		"to":          strings.Join(email.To, ", "),
		"toList":      []string(email.To),
		"cc":          strings.Join(email.Cc, ", "),
		"ccList":      []string(email.Cc),
		"body":        email.Body,
		"textBody":    email.TextBody,
		"htmlBody":    email.HTMLBody,
		"date":        email.Date,
		"receivedAt":  email.ReceivedAt,
		"headers":     email.Headers,
		"mailbox":     email.MailboxName,
		"size":        email.Size,
		"fromAddress": email.FromAddress,
		"toAddresses": []string(email.ToAddresses),
	}
}

// prepareActionInput 准备动作输入
func (s *ExtractorServiceV2) prepareActionInput(context map[string]interface{}, lastOutput interface{}, action models.TriggerAction) map[string]interface{} {
	input := make(map[string]interface{})

	// 复制上下文
	for k, v := range context {
		input[k] = v
	}

	// 添加上一个动作的输出
	if lastOutput != nil {
		input["$prev"] = lastOutput
		// 如果输出是map，展开到input中
		if outputMap, ok := lastOutput.(map[string]interface{}); ok {
			for k, v := range outputMap {
				input["$"+k] = v
			}
		}
	}

	// 添加动作配置
	input["$config"] = action.Config

	return input
}

// formatOutput 格式化输出
func (s *ExtractorServiceV2) formatOutput(output interface{}, config models.ExtractorOutputConfig) interface{} {
	if output == nil {
		return nil
	}

	switch config.Format {
	case models.ExtractorOutputFormatText:
		// 如果指定了字段，从输出中提取
		if config.Field != "" {
			if outputMap, ok := output.(map[string]interface{}); ok {
				if val, exists := outputMap[config.Field]; exists {
					return fmt.Sprintf("%v", val)
				}
			}
		}
		// 直接转换为字符串
		return fmt.Sprintf("%v", output)

	case models.ExtractorOutputFormatJSON:
		// 返回JSON字符串
		jsonBytes, err := json.Marshal(output)
		if err != nil {
			return fmt.Sprintf("%v", output)
		}
		return string(jsonBytes)

	case models.ExtractorOutputFormatObject:
		// 如果指定了字段，从输出中提取
		if config.Field != "" {
			if outputMap, ok := output.(map[string]interface{}); ok {
				if val, exists := outputMap[config.Field]; exists {
					return val
				}
			}
		}
		return output

	case models.ExtractorOutputFormatArray:
		// 确保返回数组格式
		switch v := output.(type) {
		case []interface{}:
			return v
		case []string:
			result := make([]interface{}, len(v))
			for i, s := range v {
				result[i] = s
			}
			return result
		default:
			return []interface{}{output}
		}

	default:
		return output
	}
}

// saveExtractionLog 保存提取日志
func (s *ExtractorServiceV2) saveExtractionLog(template *models.ExtractorTemplateV2, email *models.Email, result *models.ExtractionResult, startTime time.Time) {
	// 序列化提取结果
	extractedResultStr := ""
	if result.ExtractedValue != nil {
		if jsonBytes, err := json.Marshal(result.ExtractedValue); err == nil {
			extractedResultStr = string(jsonBytes)
		}
	}

	// 序列化执行追踪
	traceData := ""
	if result.ExecutionTrace != nil {
		if jsonBytes, err := json.Marshal(result.ExecutionTrace); err == nil {
			traceData = string(jsonBytes)
		}
	}

	log := &models.ExtractionLogV2{
		TemplateID:         template.ID,
		TemplateName:       template.Name,
		EmailID:            email.ID,
		Status:             result.Status,
		StartTime:          startTime,
		EndTime:            time.Now(),
		Duration:           result.Duration,
		FilterMatched:      result.FilterMatched,
		ExtractedResult:    extractedResultStr,
		ActionResults:      result.ActionResults,
		Error:              result.Error,
		ExecutionTraceData: traceData,
	}

	s.logRepo.Create(log)
}

// FilterEvaluatorService 过滤器评估服务
type FilterEvaluatorService struct {
	exprManager *expression.Manager
}

// NewFilterEvaluatorService 创建过滤器评估服务
func NewFilterEvaluatorService() *FilterEvaluatorService {
	// 初始化表达式引擎管理器
	exprManager, _ := expression.CreateAndInitManager()
	return &FilterEvaluatorService{
		exprManager: exprManager,
	}
}

// Evaluate 评估表达式
func (s *FilterEvaluatorService) Evaluate(expressions models.TriggerExpressions, context map[string]interface{}) (bool, error) {
	if len(expressions) == 0 {
		return true, nil
	}

	// 默认使用 AND 逻辑连接所有顶级表达式
	for _, expr := range expressions {
		matched, err := s.evaluateExpression(expr, context)
		if err != nil {
			return false, err
		}
		if !matched {
			return false, nil
		}
	}

	return true, nil
}

// evaluateExpression 评估单个表达式
func (s *FilterEvaluatorService) evaluateExpression(expr models.TriggerExpression, context map[string]interface{}) (bool, error) {
	switch expr.Type {
	case models.TriggerExpressionTypeGroup:
		return s.evaluateGroup(expr, context)
	case models.TriggerExpressionTypeCondition:
		return s.evaluateCondition(expr, context)
	case models.TriggerExpressionTypePlugin:
		return s.evaluatePlugin(expr, context)
	case models.TriggerExpressionTypeExpression:
		return s.evaluateCustomExpression(expr, context)
	default:
		return false, fmt.Errorf("unknown expression type: %s", expr.Type)
	}
}

// evaluateGroup 评估表达式组
func (s *FilterEvaluatorService) evaluateGroup(expr models.TriggerExpression, context map[string]interface{}) (bool, error) {
	if len(expr.Conditions) == 0 {
		return true, nil
	}

	operator := models.TriggerOperatorAnd
	if expr.Operator != nil {
		operator = *expr.Operator
	}

	switch operator {
	case models.TriggerOperatorAnd:
		for _, child := range expr.Conditions {
			matched, err := s.evaluateExpression(child, context)
			if err != nil {
				return false, err
			}
			if !matched {
				return s.applyNot(false, expr.Not), nil
			}
		}
		return s.applyNot(true, expr.Not), nil

	case models.TriggerOperatorOr:
		for _, child := range expr.Conditions {
			matched, err := s.evaluateExpression(child, context)
			if err != nil {
				return false, err
			}
			if matched {
				return s.applyNot(true, expr.Not), nil
			}
		}
		return s.applyNot(false, expr.Not), nil

	default:
		return false, fmt.Errorf("unknown operator: %s", operator)
	}
}

// evaluateCondition 评估条件表达式
func (s *FilterEvaluatorService) evaluateCondition(expr models.TriggerExpression, context map[string]interface{}) (bool, error) {
	if expr.Field == nil {
		return false, fmt.Errorf("condition field is required")
	}

	fieldValue, exists := context[*expr.Field]
	if !exists {
		return s.applyNot(false, expr.Not), nil
	}

	// 获取操作符（存储在Value中作为JSON对象的operator字段）
	var operator string
	var compareValue interface{}

	if valueMap, ok := expr.Value.(map[string]interface{}); ok {
		if op, exists := valueMap["operator"]; exists {
			operator = fmt.Sprintf("%v", op)
		}
		if val, exists := valueMap["value"]; exists {
			compareValue = val
		}
	} else {
		// 简单值比较，默认等于
		operator = "equals"
		compareValue = expr.Value
	}

	result := s.compareValues(fieldValue, compareValue, operator)
	return s.applyNot(result, expr.Not), nil
}

// evaluatePlugin 评估插件条件
func (s *FilterEvaluatorService) evaluatePlugin(expr models.TriggerExpression, context map[string]interface{}) (bool, error) {
	if expr.PluginID == nil {
		return false, fmt.Errorf("missing plugin ID in expression")
	}

	pluginID := *expr.PluginID

	// 查找内置插件并断言为条件插件
	p := builtin.GetBuiltinPluginByID(pluginID)
	if p == nil {
		return false, fmt.Errorf("plugin not found: %s", pluginID)
	}

	condPlugin, ok := p.(plugins.ConditionPlugin)
	if !ok {
		return false, fmt.Errorf("plugin %s is not a condition plugin", pluginID)
	}

	// 构造插件上下文和事件
	config := &plugins.PluginConfig{
		Config: make(map[string]interface{}),
	}
	// 将 expression.Fields 合并到插件配置中
	if expr.Fields != nil {
		for k, v := range expr.Fields {
			config.Config[k] = v
		}
	}

	event := &v2models.Event{
		Type: v2models.EventTypeEmailReceived,
	}
	event.SetData(context)

	pluginCtx := &plugins.PluginContext{
		PluginID: pluginID,
		Event:    event,
		Config:   config,
	}

	// 执行插件评估
	result, err := condPlugin.Evaluate(pluginCtx, event)
	if err != nil {
		return false, err
	}

	return s.applyNot(result.Success, expr.Not), nil
}

// evaluateCustomExpression 评估自定义表达式（如JS、CEL等）
func (s *FilterEvaluatorService) evaluateCustomExpression(expr models.TriggerExpression, context map[string]interface{}) (bool, error) {
	if s.exprManager == nil {
		return false, fmt.Errorf("expression manager not initialized")
	}

	// 从 Value 中获取表达式内容和引擎类型
	var exprStr string
	var engineType core.EngineType

	if valueMap, ok := expr.Value.(map[string]interface{}); ok {
		if e, ok := valueMap["expression"].(string); ok {
			exprStr = e
		}
		if et, ok := valueMap["engine"].(string); ok {
			engineType = core.EngineType(et)
		}
	} else if strVal, ok := expr.Value.(string); ok {
		exprStr = strVal
	}

	if exprStr == "" {
		return false, fmt.Errorf("missing expression in custom expression")
	}

	// 默认使用 JavaScript 引擎
	if engineType == "" {
		engineType = core.EngineTypeJavaScript
	}

	// 创建评估上下文
	evalCtx := core.NewEvaluationContext(context)

	// 使用表达式管理器评估
	result, err := s.exprManager.EvaluateBoolean(engineType, exprStr, evalCtx)
	if err != nil {
		return false, fmt.Errorf("expression evaluation failed: %w", err)
	}

	return s.applyNot(result, expr.Not), nil
}

// compareValues 比较值
func (s *FilterEvaluatorService) compareValues(fieldValue, compareValue interface{}, operator string) bool {
	fieldStr := fmt.Sprintf("%v", fieldValue)
	compareStr := fmt.Sprintf("%v", compareValue)

	switch operator {
	case "equals", "eq", "==":
		return fieldStr == compareStr
	case "not_equals", "neq", "!=":
		return fieldStr != compareStr
	case "contains":
		return strings.Contains(fieldStr, compareStr)
	case "not_contains":
		return !strings.Contains(fieldStr, compareStr)
	case "starts_with":
		return strings.HasPrefix(fieldStr, compareStr)
	case "ends_with":
		return strings.HasSuffix(fieldStr, compareStr)
	case "matches", "regex":
		matched, err := regexp.MatchString(compareStr, fieldStr)
		if err != nil {
			return false // invalid regex falls back to false
		}
		return matched
	case "is_empty":
		return fieldStr == "" || fieldStr == "[]" || fieldStr == "{}"
	case "is_not_empty":
		return fieldStr != "" && fieldStr != "[]" && fieldStr != "{}"
	default:
		return fieldStr == compareStr
	}
}

// applyNot 应用NOT运算符
func (s *FilterEvaluatorService) applyNot(result bool, not *bool) bool {
	if not != nil && *not {
		return !result
	}
	return result
}

// ActionExecutorService 动作执行服务
type ActionExecutorService struct {
	db              *gorm.DB
	pluginManager   plugins.PluginManager
	pluginManagerMu sync.Mutex
	// 可以复用触发器的动作执行逻辑
}

// NewActionExecutorService 创建动作执行服务
func NewActionExecutorService(db *gorm.DB) *ActionExecutorService {
	return &ActionExecutorService{db: db}
}

// ExecuteAction 执行单个动作
func (s *ActionExecutorService) ExecuteAction(action models.TriggerAction, input map[string]interface{}) (map[string]interface{}, error) {
	// 根据插件ID调用对应的执行逻辑
	switch action.PluginID {
	case "regex_extractor", "regex":
		return s.executeRegexAction(action, input)
	case "js_extractor", "js", "javascript":
		return s.executeJSAction(action, input)
	case "gotemplate_extractor", "gotemplate":
		return s.executeGoTemplateAction(action, input)
	case "jsonpath_extractor", "jsonpath":
		return s.executeJSONPathAction(action, input)
	case "email_transform", "email_transform_action":
		// 复用触发器的邮件转换动作
		return s.executeEmailTransformAction(action, input)
	default:
		if builtin.IsBuiltinPlugin(action.PluginID) {
			return s.executeBuiltinAction(action, input)
		}
		return nil, fmt.Errorf("unknown plugin: %s", action.PluginID)
	}
}

func (s *ActionExecutorService) executeBuiltinAction(action models.TriggerAction, input map[string]interface{}) (map[string]interface{}, error) {
	plugin := builtin.GetBuiltinPluginByID(action.PluginID)
	if plugin == nil {
		return nil, fmt.Errorf("unknown plugin: %s", action.PluginID)
	}

	actionPlugin, ok := plugin.(plugins.ActionPlugin)
	if !ok {
		return nil, fmt.Errorf("plugin %s is not an action plugin", action.PluginID)
	}

	config := action.Config
	if config == nil {
		config = map[string]interface{}{}
	}
	if err := actionPlugin.ApplyConfig(config); err != nil {
		return nil, err
	}

	email := emailFromActionInput(input)
	emailData := v2models.EmailEventData{
		Email:         email,
		EmailID:       email.ID,
		AccountID:     email.AccountID,
		Subject:       email.Subject,
		From:          strings.Join(email.From, ", "),
		To:            strings.Join(email.To, ", "),
		MessageID:     email.MessageID,
		HasAttachment: email.HasAttachments,
		ReceivedAt:    email.ReceivedAt,
		MailboxName:   email.MailboxName,
	}
	event, err := v2models.NewEvent(v2models.EventTypeEmailReceived, "extractor", email.Subject, emailData)
	if err != nil {
		return nil, err
	}
	event.Variables = variablesFromActionInput(input)

	pluginCtx := &plugins.PluginContext{
		Context:  context.Background(),
		PluginID: action.PluginID,
		Event:    event,
		Config: &plugins.PluginConfig{
			Config: config,
		},
	}
	if !actionPlugin.CanExecute(pluginCtx, event) {
		return nil, fmt.Errorf("plugin %s cannot execute this action", action.PluginID)
	}

	var result *plugins.PluginResult
	if _, ok := plugin.(interface{ SetPluginManager(plugins.PluginManager) }); ok {
		pm, err := s.getBuiltinPluginManager()
		if err != nil {
			return nil, err
		}
		result, err = pm.ExecuteAction(action.PluginID, pluginCtx, event)
		if err != nil {
			return nil, err
		}
	} else {
		result, err = actionPlugin.Execute(pluginCtx, event)
	}
	if err != nil {
		return nil, err
	}

	return outputFromPluginResult(action.PluginID, result, event)
}

func (s *ActionExecutorService) getBuiltinPluginManager() (plugins.PluginManager, error) {
	s.pluginManagerMu.Lock()
	defer s.pluginManagerMu.Unlock()

	if s.pluginManager != nil {
		return s.pluginManager, nil
	}

	manager := plugins.NewTriggerV2PluginManager(plugins.DefaultPluginManagerConfig())
	if err := builtin.RegisterBuiltinPlugins(manager); err != nil {
		return nil, err
	}
	s.pluginManager = manager
	return s.pluginManager, nil
}

func outputFromPluginResult(pluginID string, result *plugins.PluginResult, event *v2models.Event) (map[string]interface{}, error) {
	if result == nil {
		return map[string]interface{}{}, nil
	}
	if !result.Success {
		if result.Error != "" {
			return nil, errors.New(result.Error)
		}
		return nil, fmt.Errorf("plugin %s execution failed", pluginID)
	}

	output := make(map[string]interface{}, len(result.Data)+len(event.Variables)+3)
	for k, v := range result.Data {
		output[k] = v
	}

	if value, exists := output["extracted_value"]; exists {
		output["value"] = value
		if outputName, _ := output["output_name"].(string); outputName != "" {
			output[outputName] = value
		}
	}

	for k, v := range event.GetAllVariables() {
		if _, exists := output[k]; !exists {
			output[k] = v
		}
	}
	output["variables"] = event.GetAllVariables()

	return output, nil
}

func emailFromActionInput(input map[string]interface{}) *models.Email {
	if email, ok := input["$email"].(*models.Email); ok && email != nil {
		return email
	}
	if email, ok := input["email"].(*models.Email); ok && email != nil {
		return email
	}
	if email, ok := input["email"].(models.Email); ok {
		return &email
	}

	email := &models.Email{
		Subject:     stringFromActionInput(input, "subject"),
		Body:        stringFromActionInput(input, "body"),
		TextBody:    stringFromActionInput(input, "textBody"),
		HTMLBody:    stringFromActionInput(input, "htmlBody"),
		MessageID:   stringFromActionInput(input, "messageId"),
		MailboxName: stringFromActionInput(input, "mailbox"),
		FromAddress: stringFromActionInput(input, "fromAddress"),
	}
	email.From = stringSliceFromActionInput(input, "from", "fromList")
	email.To = stringSliceFromActionInput(input, "to", "toList")
	email.Cc = stringSliceFromActionInput(input, "cc", "ccList")
	email.ToAddresses = models.StringSlice(stringSliceFromActionInput(input, "", "toAddresses"))
	return email
}

func stringFromActionInput(input map[string]interface{}, key string) string {
	if val, exists := input[key]; exists && val != nil {
		return fmt.Sprintf("%v", val)
	}
	return ""
}

func stringSliceFromActionInput(input map[string]interface{}, scalarKey, sliceKey string) models.StringSlice {
	if sliceKey != "" {
		switch val := input[sliceKey].(type) {
		case []string:
			return models.StringSlice(val)
		case models.StringSlice:
			return val
		case []interface{}:
			result := make(models.StringSlice, 0, len(val))
			for _, item := range val {
				result = append(result, fmt.Sprintf("%v", item))
			}
			return result
		}
	}
	if scalarKey != "" {
		if val := stringFromActionInput(input, scalarKey); val != "" {
			return models.StringSlice{val}
		}
	}
	return models.StringSlice{}
}

func variablesFromActionInput(input map[string]interface{}) map[string]interface{} {
	variables := make(map[string]interface{})
	if prev, exists := input["$prev"]; exists {
		variables["_"] = prev
	}

	for key, value := range input {
		if strings.HasPrefix(key, "$") && len(key) > 1 {
			variables[strings.TrimPrefix(key, "$")] = value
		}
	}

	return variables
}

// executeRegexAction 执行正则提取动作
func (s *ActionExecutorService) executeRegexAction(action models.TriggerAction, input map[string]interface{}) (map[string]interface{}, error) {
	config := action.Config

	// 获取正则表达式
	pattern, ok := config["pattern"].(string)
	if !ok {
		pattern, _ = config["regex"].(string)
	}
	if pattern == "" {
		return nil, fmt.Errorf("regex pattern is required")
	}

	// 获取要匹配的字段
	field, _ := config["field"].(string)
	if field == "" {
		field = "body"
	}

	// 获取输入内容
	content := ""
	if val, exists := input[field]; exists {
		content = fmt.Sprintf("%v", val)
	}

	// 执行正则匹配
	extractor := NewExtractorService()
	results, err := extractor.extractWithRegex([]string{content}, pattern)
	if err != nil {
		return nil, err
	}

	result := ""
	if len(results) > 0 {
		result = results[0]
	}

	return map[string]interface{}{
		"matched": result != "",
		"value":   result,
		"values":  results,
		"field":   field,
	}, nil
}

// executeJSAction 执行JavaScript提取动作
func (s *ActionExecutorService) executeJSAction(action models.TriggerAction, input map[string]interface{}) (map[string]interface{}, error) {
	config := action.Config

	script, ok := config["script"].(string)
	if !ok {
		return nil, fmt.Errorf("JS script is required")
	}

	// 创建临时邮件对象用于脚本执行
	tempEmail := models.Email{
		Subject:  fmt.Sprintf("%v", input["subject"]),
		Body:     fmt.Sprintf("%v", input["body"]),
		HTMLBody: fmt.Sprintf("%v", input["htmlBody"]),
	}
	if fromVal, ok := input["from"].(string); ok {
		tempEmail.From = models.StringSlice{fromVal}
	}
	if toVal, ok := input["to"].(string); ok {
		tempEmail.To = models.StringSlice{toVal}
	}

	// 使用现有的JS执行服务
	extractor := NewExtractorService()
	results, err := extractor.extractWithJS(tempEmail, []string{tempEmail.Body}, script)
	if err != nil {
		return nil, err
	}

	result := ""
	if len(results) > 0 {
		result = results[0]
	}

	return map[string]interface{}{
		"value":  result,
		"values": results,
	}, nil
}

// executeGoTemplateAction 执行Go模板提取动作
func (s *ActionExecutorService) executeGoTemplateAction(action models.TriggerAction, input map[string]interface{}) (map[string]interface{}, error) {
	config := action.Config

	templateStr, ok := config["template"].(string)
	if !ok {
		return nil, fmt.Errorf("Go template is required")
	}

	// 创建临时邮件对象用于模板执行
	tempEmail := models.Email{
		Subject:  fmt.Sprintf("%v", input["subject"]),
		Body:     fmt.Sprintf("%v", input["body"]),
		HTMLBody: fmt.Sprintf("%v", input["htmlBody"]),
	}
	if fromVal, ok := input["from"].(string); ok {
		tempEmail.From = models.StringSlice{fromVal}
	}
	if toVal, ok := input["to"].(string); ok {
		tempEmail.To = models.StringSlice{toVal}
	}

	// 使用现有的模板执行服务
	extractor := NewExtractorService()
	results, err := extractor.extractWithGoTemplate(tempEmail, templateStr)
	if err != nil {
		return nil, err
	}

	result := ""
	if len(results) > 0 {
		result = results[0]
	}

	return map[string]interface{}{
		"value":  result,
		"values": results,
	}, nil
}

// executeJSONPathAction 执行JSONPath提取动作
func (s *ActionExecutorService) executeJSONPathAction(action models.TriggerAction, input map[string]interface{}) (map[string]interface{}, error) {
	config := action.Config

	// 获取JSONPath表达式
	path, ok := config["path"].(string)
	if !ok {
		path, _ = config["expression"].(string)
	}
	if path == "" {
		return nil, fmt.Errorf("JSONPath expression is required")
	}

	// 将输入转换为 JSON 兼容格式
	jsonBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	var jsonData interface{}
	if err := json.Unmarshal(jsonBytes, &jsonData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	// 执行JSONPath查询
	value, err := jsonpath.Get(path, jsonData)
	if err != nil {
		return nil, fmt.Errorf("JSONPath query failed: %w", err)
	}

	return map[string]interface{}{
		"value":  value,
		"path":   path,
		"values": []interface{}{value},
	}, nil
}

// executeEmailTransformAction 执行邮件转换动作
func (s *ActionExecutorService) executeEmailTransformAction(action models.TriggerAction, input map[string]interface{}) (map[string]interface{}, error) {
	config := action.Config
	result := make(map[string]interface{})

	// 复制输入到结果
	for k, v := range input {
		result[k] = v
	}

	// 应用转换规则
	if rules, ok := config["rules"].([]interface{}); ok {
		for _, rule := range rules {
			ruleMap, ok := rule.(map[string]interface{})
			if !ok {
				continue
			}
			field, _ := ruleMap["field"].(string)
			transform, _ := ruleMap["transform"].(string)
			value, _ := ruleMap["value"].(string)

			if field == "" || transform == "" {
				continue
			}

			fieldVal := fmt.Sprintf("%v", result[field])
			switch transform {
			case "replace":
				search, _ := ruleMap["search"].(string)
				result[field] = strings.ReplaceAll(fieldVal, search, value)
			case "prefix":
				result[field] = value + fieldVal
			case "suffix":
				result[field] = fieldVal + value
			case "set":
				result[field] = value
			case "lower":
				result[field] = strings.ToLower(fieldVal)
			case "upper":
				result[field] = strings.ToUpper(fieldVal)
			case "trim":
				result[field] = strings.TrimSpace(fieldVal)
			}
		}
	}

	return result, nil
}
