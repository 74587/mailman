package services

import (
	"fmt"
	"log"
	"runtime/debug"
	"sort"
	"strings"
	"time"

	"mailman/internal/interceptor"
	"mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// ActionExecutorV2 带拦截器支持的动作执行器
type ActionExecutorV2 struct {
	pluginManager      plugins.PluginManager
	interceptorManager *interceptor.Manager
}

// NewActionExecutorV2 创建带拦截器的动作执行器
func NewActionExecutorV2(pluginManager plugins.PluginManager, interceptorManager *interceptor.Manager) *ActionExecutorV2 {
	return &ActionExecutorV2{
		pluginManager:      pluginManager,
		interceptorManager: interceptorManager,
	}
}

// ExecuteActionsWithContext 执行动作列表（带拦截器和完整上下文）
func (e *ActionExecutorV2) ExecuteActionsWithContext(
	actions []models.TriggerAction,
	email models.Email,
	triggerID uint,
) (models.ActionExecutionResults, error) {
	log.Printf("[ActionExecutorV2] Executing %d actions with interceptors (TriggerID: %d)", len(actions), triggerID)

	if len(actions) == 0 {
		log.Printf("[ActionExecutorV2] No actions to execute")
		return models.ActionExecutionResults{}, nil
	}

	// Sort actions by execution order
	sortedActions := make([]models.TriggerAction, len(actions))
	copy(sortedActions, actions)
	sort.Slice(sortedActions, func(i, j int) bool {
		return sortedActions[i].ExecutionOrder < sortedActions[j].ExecutionOrder
	})

	// Create shared Event for variable passing between actions
	sharedEvent := e.createSharedEvent(email)

	results := make(models.ActionExecutionResults, 0, len(sortedActions))
	var firstError error

	// 准备 $step 对象以供模板访问
	stepResults := make([]interface{}, 0, len(sortedActions))

	// Execute each action in order with shared Event
	for i, action := range sortedActions {
		// 获取动作别名（从配置中读取）
		alias := ""
		if action.Config != nil {
			if a, ok := action.Config["alias"].(string); ok {
				alias = a
			}
		}

		// 获取上一步的输出作为当前步骤的输入
		var input interface{}
		if i > 0 {
			prevStep, _ := sharedEvent.GetStepByIndex(i - 1)
			if prevStep != nil {
				input = prevStep.Output
			}
		}

		// 执行动作（带拦截器）
		result, skipped, err := e.executeActionWithInterceptors(action, email, sharedEvent, triggerID, i)

		if skipped {
			log.Printf("[ActionExecutorV2] Action %s was skipped by interceptor", action.ID)
			// 创建跳过的结果
			result = &models.ActionExecutionResult{
				ActionID:   action.ID,
				PluginID:   action.PluginID,
				PluginName: action.PluginName,
				Success:    false,
				StartTime:  time.Now(),
				EndTime:    time.Now(),
				Duration:   0,
				Error:      "Skipped by interceptor",
			}
		}

		if err != nil && firstError == nil {
			firstError = err
		}

		if shouldRecordFailedActionError(action, result, skipped) && firstError == nil {
			firstError = fmt.Errorf("action %s failed: %s", action.ID, result.Error)
		}

		if shouldStopAfterFailedAction(action, result, skipped) {
			result.StopPipeline = true
			log.Printf("[ActionExecutorV2] Action %s failed; stopping pipeline. Set continue_on_error=true to continue after this action.", action.ID)
		}

		results = append(results, *result)

		// 创建步骤结果
		stepResult := &triggerModels.StepResult{
			Index:      i,
			Alias:      alias,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			Input:      input,
			Output:     result.Result,
			Success:    result.Success,
			Error:      result.Error,
			Info: map[string]interface{}{
				"action_id":       action.ID,
				"execution_order": action.ExecutionOrder,
				"duration_ms":     result.Duration,
				"stop_pipeline":   result.StopPipeline,
				"skipped":         skipped,
			},
		}

		// 设置步骤结果到 Event
		sharedEvent.SetStep(i, alias, stepResult)

		// 更新 $step 数组供模板访问
		stepResults = append(stepResults, map[string]interface{}{
			"index":         i,
			"alias":         alias,
			"input":         stepResult.Input,
			"output":        stepResult.Output,
			"info":          stepResult.Info,
			"success":       stepResult.Success,
			"error":         stepResult.Error,
			"stop_pipeline": result.StopPipeline,
			"skipped":       skipped,
		})
		sharedEvent.SetVariable("step", stepResults)

		// 保存上一个动作的输出到 $_ 变量
		if result.Success && result.Result != nil {
			sharedEvent.SetVariable("_", result.Result)
			log.Printf("[ActionExecutorV2] Set $_ variable from action %s output", action.ID)
		}

		// 检查是否需要中断后续流程
		if result.StopPipeline {
			log.Printf("[ActionExecutorV2] Pipeline stopped by action %s. Skipping remaining %d actions.", action.ID, len(sortedActions)-i-1)
			break
		}
	}

	log.Printf("[ActionExecutorV2] Completed execution of %d actions. Success: %d, Failed: %d, Variables: %d, Steps: %d",
		len(results), countSuccessfulActions(results), len(results)-countSuccessfulActions(results), len(sharedEvent.Variables), len(sharedEvent.Steps))

	return results, firstError
}

// executeActionWithInterceptors 执行单个动作（带拦截器）
// 返回: 执行结果, 是否被跳过, 错误
func (e *ActionExecutorV2) executeActionWithInterceptors(
	action models.TriggerAction,
	email models.Email,
	sharedEvent *triggerModels.Event,
	triggerID uint,
	actionIndex int,
) (*models.ActionExecutionResult, bool, error) {

	// Skip disabled actions
	if !action.Enabled {
		log.Printf("[ActionExecutorV2] Skipping disabled action: %s", action.ID)
		return &models.ActionExecutionResult{
			ActionID:   action.ID,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			Success:    false,
			StartTime:  time.Now(),
			EndTime:    time.Now(),
			Duration:   0,
			Error:      "Action is disabled",
		}, false, nil
	}

	// 构建动作信息（用于拦截器）
	actionInfo := &interceptor.ActionInfo{
		ID:             action.ID,
		PluginID:       action.PluginID,
		PluginName:     action.PluginName,
		Config:         action.Config,
		ExecutionOrder: action.ExecutionOrder,
		Depth:          0, // 顶级动作
		Enabled:        action.Enabled,
	}

	// 构建拦截器上下文
	interceptorCtx := &interceptor.InterceptorContext{
		Action:    actionInfo,
		Event:     sharedEvent,
		TriggerID: triggerID,
		Email:     &email,
		Metadata:  make(map[string]interface{}),
	}

	// === 前置拦截 ===
	if e.interceptorManager != nil {
		beforeResult, err := e.interceptorManager.ExecuteBefore(interceptorCtx)
		if err != nil {
			log.Printf("[ActionExecutorV2] Before interceptor error for action %s: %v", action.ID, err)
		}

		if beforeResult != nil {
			switch beforeResult.Decision {
			case interceptor.DecisionAbort:
				log.Printf("[ActionExecutorV2] Action %s aborted by before interceptor", action.ID)
				return &models.ActionExecutionResult{
					ActionID:   action.ID,
					PluginID:   action.PluginID,
					PluginName: action.PluginName,
					Success:    false,
					StartTime:  time.Now(),
					EndTime:    time.Now(),
					Duration:   0,
					Error:      fmt.Sprintf("Aborted by interceptor: %s", beforeResult.Error),
				}, false, fmt.Errorf("aborted by interceptor")

			case interceptor.DecisionSkipAction:
				log.Printf("[ActionExecutorV2] Action %s skipped by before interceptor", action.ID)
				return &models.ActionExecutionResult{
					ActionID:   action.ID,
					PluginID:   action.PluginID,
					PluginName: action.PluginName,
					Success:    false,
					StartTime:  time.Now(),
					EndTime:    time.Now(),
					Duration:   0,
					Error:      "Skipped by interceptor",
				}, true, nil
			}

			// 如果拦截器修改了事件，使用修改后的事件
			if beforeResult.ModifiedEvent != nil {
				sharedEvent = beforeResult.ModifiedEvent
			}
		}
	}

	// === 执行动作 ===
	startTime := time.Now()
	result := e.executeActionCore(action, email, sharedEvent)
	duration := time.Since(startTime)

	// === 后置拦截 ===
	if e.interceptorManager != nil {
		// 构建动作执行结果
		interceptorCtx.ActionResult = &interceptor.ActionResult{
			Success:      result.Success,
			Data:         result.Result,
			Error:        result.Error,
			Duration:     duration,
			StopPipeline: result.StopPipeline,
		}

		afterResult, err := e.interceptorManager.ExecuteAfter(interceptorCtx)
		if err != nil {
			log.Printf("[ActionExecutorV2] After interceptor error for action %s: %v", action.ID, err)
		}

		// 后置阶段的决策通常只是记录，不影响结果
		if afterResult != nil && !afterResult.Success {
			log.Printf("[ActionExecutorV2] After interceptor failed for action %s: %s", action.ID, afterResult.Error)
		}
	}

	return result, false, nil
}

// executeActionCore 执行动作核心逻辑（不含拦截器）
func (e *ActionExecutorV2) executeActionCore(action models.TriggerAction, email models.Email, sharedEvent *triggerModels.Event) (executionResult *models.ActionExecutionResult) {
	log.Printf("[ActionExecutorV2] Executing action: %s (Plugin: %s)", action.ID, action.PluginID)
	panicStart := time.Now()
	defer func() {
		if recovered := recover(); recovered != nil {
			endTime := time.Now()
			log.Printf("[ActionExecutorV2] Action execution panicked: %s - %v\n%s", action.ID, recovered, string(debug.Stack()))
			executionResult = &models.ActionExecutionResult{
				ActionID:   action.ID,
				PluginID:   action.PluginID,
				PluginName: action.PluginName,
				Success:    false,
				StartTime:  panicStart,
				EndTime:    endTime,
				Duration:   endTime.Sub(panicStart).Milliseconds(),
				Error:      fmt.Sprintf("action panic: %v", recovered),
			}
		}
	}()

	if e.pluginManager == nil {
		errMsg := fmt.Sprintf("Plugin manager is not configured; cannot execute plugin: %s", action.PluginID)
		log.Printf("[ActionExecutorV2] %s", errMsg)
		now := time.Now()
		return &models.ActionExecutionResult{
			ActionID:   action.ID,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			Success:    false,
			StartTime:  now,
			EndTime:    now,
			Duration:   0,
			Error:      errMsg,
		}
	}

	// Get the plugin from TriggerV2 PluginManager
	plugin, err := e.pluginManager.GetPlugin(action.PluginID)
	if err != nil {
		errMsg := fmt.Sprintf("Plugin not found: %s", err)
		log.Printf("[ActionExecutorV2] %s", errMsg)
		return &models.ActionExecutionResult{
			ActionID:   action.ID,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			Success:    false,
			StartTime:  time.Now(),
			EndTime:    time.Now(),
			Duration:   0,
			Error:      errMsg,
		}
	}

	// Check if it's an action plugin
	actionPlugin, ok := plugin.(plugins.ActionPlugin)
	if !ok {
		errMsg := fmt.Sprintf("Plugin %s is not an action plugin", action.PluginID)
		log.Printf("[ActionExecutorV2] %s", errMsg)
		return &models.ActionExecutionResult{
			ActionID:   action.ID,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			Success:    false,
			StartTime:  time.Now(),
			EndTime:    time.Now(),
			Duration:   0,
			Error:      errMsg,
		}
	}

	// Apply config to the plugin
	if err := actionPlugin.ApplyConfig(action.Config); err != nil {
		errMsg := fmt.Sprintf("Config error: %v", err)
		log.Printf("[ActionExecutorV2] %s", errMsg)
		return &models.ActionExecutionResult{
			ActionID:   action.ID,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			Success:    false,
			StartTime:  time.Now(),
			EndTime:    time.Now(),
			Duration:   0,
			Error:      errMsg,
		}
	}

	// Create TriggerV2 plugin context with shared Event
	v2Ctx := &plugins.PluginContext{
		Config: &plugins.PluginConfig{
			Enabled: true,
			Config:  action.Config,
		},
		Event: sharedEvent,
	}

	// Execute the action plugin
	startTime := time.Now()
	result, err := actionPlugin.Execute(v2Ctx, sharedEvent)
	endTime := time.Now()

	// Create the execution result
	executionResult = &models.ActionExecutionResult{
		ActionID:   action.ID,
		PluginID:   action.PluginID,
		PluginName: action.PluginName,
		StartTime:  startTime,
		EndTime:    endTime,
		Duration:   endTime.Sub(startTime).Milliseconds(),
	}

	if err != nil {
		executionResult.Success = false
		executionResult.Error = err.Error()
		log.Printf("[ActionExecutorV2] Action execution failed: %s - %v", action.ID, err)
	} else if result == nil {
		executionResult.Success = false
		executionResult.Error = "Plugin returned nil result"
		log.Printf("[ActionExecutorV2] Action execution failed: %s - Plugin returned nil result", action.ID)
	} else {
		executionResult.Success = result.Success
		executionResult.StopPipeline = result.StopPipeline
		executionResult.Result = result.Data
		if !result.Success {
			executionResult.Error = result.Error
			log.Printf("[ActionExecutorV2] Action execution failed: %s - %s", action.ID, result.Error)
		} else {
			log.Printf("[ActionExecutorV2] Action execution succeeded: %s (StopPipeline: %v)", action.ID, result.StopPipeline)
		}
	}

	return executionResult
}

// createSharedEvent creates a shared Event with email data for variable passing
func (e *ActionExecutorV2) createSharedEvent(email models.Email) *triggerModels.Event {
	event := &triggerModels.Event{
		Type:      triggerModels.EventTypeEmailReceived,
		Variables: make(map[string]interface{}),
	}

	// Extract first From address
	fromStr := ""
	if len(email.From) > 0 {
		fromStr = email.From[0]
	}

	// Extract first To address
	toStr := ""
	if len(email.To) > 0 {
		toStr = email.To[0]
	}

	emailData := triggerModels.EmailEventData{
		Email:         &email,
		EmailID:       email.ID,
		AccountID:     email.AccountID,
		Subject:       email.Subject,
		From:          fromStr,
		To:            toStr,
		MessageID:     email.MessageID,
		ReceivedAt:    email.ReceivedAt,
		HasAttachment: email.HasAttachments,
		IsRead:        !contains(email.Flags, "UNREAD"),
		Labels:        email.Flags,
		EventType:     "received",
	}
	event.SetData(emailData)

	return event
}

// ExecuteActions 兼容旧接口的方法（不带拦截器）
func (e *ActionExecutorV2) ExecuteActions(actions []models.TriggerAction, email models.Email) (models.ActionExecutionResults, error) {
	return e.ExecuteActionsWithContext(actions, email, 0)
}

func countSuccessfulActions(results models.ActionExecutionResults) int {
	count := 0
	for _, result := range results {
		if result.Success {
			count++
		}
	}
	return count
}

func shouldStopAfterFailedAction(action models.TriggerAction, result *models.ActionExecutionResult, skipped bool) bool {
	if result == nil || result.Success || result.StopPipeline || skipped || !action.Enabled {
		return false
	}
	return !actionContinuesOnError(action)
}

func shouldRecordFailedActionError(action models.TriggerAction, result *models.ActionExecutionResult, skipped bool) bool {
	if result == nil || result.Success || skipped || !action.Enabled {
		return false
	}
	return result.StopPipeline || !actionContinuesOnError(action)
}

func actionContinuesOnError(action models.TriggerAction) bool {
	if action.Config == nil {
		return false
	}

	for _, key := range []string{"continue_on_error", "continueOnError"} {
		if value, ok := action.Config[key]; ok {
			return configBool(value)
		}
	}

	for _, key := range []string{"on_error", "onError"} {
		if value, ok := action.Config[key]; ok {
			switch strings.ToLower(strings.TrimSpace(fmt.Sprint(value))) {
			case "continue", "ignore", "skip":
				return true
			case "stop", "fail", "halt", "abort":
				return false
			}
		}
	}

	return false
}

func configBool(value interface{}) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "true", "1", "yes", "y", "on":
			return true
		default:
			return false
		}
	default:
		return false
	}
}
