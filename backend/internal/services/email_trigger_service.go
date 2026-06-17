package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"mailman/internal/interceptor"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/triggerv2/plugins"
	"mailman/internal/utils"
)

// EmailTriggerService handles email trigger operations and event processing
type EmailTriggerService struct {
	triggerRepo         *repository.EmailTriggerV2Repository
	logRepo             *repository.TriggerExecutionLogV2Repository
	subscriptionManager *SubscriptionManager
	eventBus            *EventBus
	conditionEngine     *ConditionEngine
	pluginManager       plugins.PluginManager
	actionExecutor      *ActionExecutorV2
	resultCache         *ResultCache // 结果缓存
	businessLog         *BusinessLogPipeline
	logger              *utils.Logger

	// For managing active subscriptions
	activeSubscriptions map[uint]string // Map of triggerID to subscriptionID
	mu                  sync.RWMutex
}

func (s *EmailTriggerService) SetBusinessLogPipeline(pipeline *BusinessLogPipeline) {
	s.businessLog = pipeline
}

// NewEmailTriggerService creates a new EmailTriggerService
func NewEmailTriggerService(
	triggerRepo *repository.EmailTriggerV2Repository,
	logRepo *repository.TriggerExecutionLogV2Repository,
	subscriptionManager *SubscriptionManager,
	eventBus *EventBus,
	conditionEngine *ConditionEngine,
	pluginManager plugins.PluginManager,
	interceptorManager *interceptor.Manager,
) *EmailTriggerService {
	actionExecutor := NewActionExecutorV2(pluginManager, interceptorManager)

	// 创建结果缓存，默认过期时间5分钟，每10分钟清理一次过期项
	resultCache := NewResultCache(5*time.Minute, 10*time.Minute)

	return &EmailTriggerService{
		triggerRepo:         triggerRepo,
		logRepo:             logRepo,
		subscriptionManager: subscriptionManager,
		eventBus:            eventBus,
		conditionEngine:     conditionEngine,
		pluginManager:       pluginManager,
		actionExecutor:      actionExecutor,
		resultCache:         resultCache,
		logger:              utils.NewLogger("EmailTriggerService"),
		activeSubscriptions: make(map[uint]string),
	}
}

// Initialize initializes the email trigger service and sets up event subscriptions
func (s *EmailTriggerService) Initialize() error {
	s.logger.Info("Initializing email trigger service")

	// Register event handlers
	s.eventBus.Subscribe(EventTypeNewEmail, s.handleNewEmailEvent)

	// Set up subscriptions for all enabled triggers
	return s.setupAllTriggerSubscriptions()
}

// setupAllTriggerSubscriptions sets up subscriptions for all enabled triggers
func (s *EmailTriggerService) setupAllTriggerSubscriptions() error {
	// Get all enabled triggers
	triggers, err := s.triggerRepo.GetByStatus(true, 0)
	if err != nil {
		return fmt.Errorf("failed to get enabled triggers: %w", err)
	}

	s.logger.Info("Setting up subscriptions for %d enabled triggers", len(triggers))

	// Set up subscription for each trigger
	for _, trigger := range triggers {
		if err := s.setupTriggerSubscription(&trigger); err != nil {
			s.logger.Error("Failed to set up subscription for trigger %d: %v", trigger.ID, err)
			// Continue with other triggers even if one fails
			continue
		}
	}

	return nil
}

// setupTriggerSubscription sets up a subscription for a single trigger
func (s *EmailTriggerService) setupTriggerSubscription(trigger *models.EmailTriggerV2) error {
	s.logger.Info("Setting up subscription for trigger: %s (ID: %d)", trigger.Name, trigger.ID)

	// Create a subscription request
	req := SubscribeRequest{
		Type:     SubscriptionTypeRealtime,
		Priority: PriorityNormal,
		Filter:   EmailFilter{}, // We'll use a generic filter and do detailed filtering in our callback
		Context:  context.Background(),
		Callback: func(email models.Email) error {
			return s.processEmailForTrigger(trigger, email)
		},
		Metadata: map[string]interface{}{
			"triggerID":   trigger.ID,
			"triggerName": trigger.Name,
		},
	}

	// Subscribe to email events
	subscription, err := s.subscriptionManager.Subscribe(req)
	if err != nil {
		return fmt.Errorf("failed to subscribe to email events: %w", err)
	}

	// Store the subscription ID
	s.mu.Lock()
	s.activeSubscriptions[trigger.ID] = subscription.ID
	s.mu.Unlock()

	s.logger.Info("Successfully set up subscription for trigger %d with subscription ID: %s",
		trigger.ID, subscription.ID)

	return nil
}

// handleNewEmailEvent handles new email events from the event bus
func (s *EmailTriggerService) handleNewEmailEvent(event EmailEvent) {
	s.logger.Debug("Received new email event: %v", event.Type)

	// The actual processing is handled by the subscription callbacks
	// This method is mainly for logging and monitoring
}

// processEmailForTrigger processes an email for a specific trigger
func (s *EmailTriggerService) processEmailForTrigger(trigger *models.EmailTriggerV2, email models.Email) error {
	s.logger.Debug("Processing email %d for trigger: %s (ID: %d)",
		email.ID, trigger.Name, trigger.ID)

	startTime := time.Now()

	// Create execution log
	executionLog := &models.TriggerExecutionLogV2{
		TriggerID:   trigger.ID,
		TriggerName: trigger.Name,
		EmailID:     email.ID,
		StartTime:   startTime,
		Status:      models.TriggerExecutionV2StatusFailed, // Default to failed, will update if successful
	}

	// Evaluate trigger conditions
	filterStart := time.Now()
	conditionResult, conditionEval, err := s.evaluateTriggerConditions(trigger, email)
	filterEnd := time.Now()
	executionLog.ConditionResult = conditionResult
	executionLog.ConditionEval = conditionEval

	if err != nil {
		executionLog.Error = fmt.Sprintf("Failed to evaluate conditions: %v", err)
		executionLog.EndTime = time.Now()
		executionLog.Duration = time.Since(startTime).Milliseconds()
		executionLog.ExecutionTraceData = s.buildExecutionTrace(trigger, email, conditionResult, conditionEval, filterStart, filterEnd, err, nil, startTime, executionLog.EndTime)
		s.logRepo.Create(executionLog)
		s.recordTriggerBusinessLog(trigger, email, executionLog)

		// Update trigger statistics
		s.updateTriggerStatistics(trigger.ID, false, executionLog.Error)

		return fmt.Errorf("failed to evaluate conditions: %w", err)
	}

	// If conditions are not met, log and return
	if !conditionResult {
		executionLog.EndTime = time.Now()
		executionLog.Duration = time.Since(startTime).Milliseconds()
		executionLog.Status = models.TriggerExecutionV2StatusSuccess // Successful evaluation, just didn't match
		executionLog.ExecutionTraceData = s.buildExecutionTrace(trigger, email, conditionResult, conditionEval, filterStart, filterEnd, nil, nil, startTime, executionLog.EndTime)
		s.logRepo.Create(executionLog)
		s.recordTriggerBusinessLog(trigger, email, executionLog)

		s.logger.Debug("Email %d did not match conditions for trigger %d",
			email.ID, trigger.ID)
		return nil
	}

	// Execute trigger actions
	actionResults, err := s.executeTriggerActions(trigger, email)
	executionLog.ActionResults = actionResults
	executionLog.ActionsExecuted = len(actionResults)

	// Count successful actions
	successfulActions := 0
	for _, result := range actionResults {
		if result.Success {
			successfulActions++
		}
	}
	executionLog.ActionsSucceeded = successfulActions

	// Determine overall status
	if err != nil {
		executionLog.Error = fmt.Sprintf("Error executing actions: %v", err)
		executionLog.Status = models.TriggerExecutionV2StatusFailed
	} else if successfulActions == 0 {
		executionLog.Status = models.TriggerExecutionV2StatusFailed
		executionLog.Error = "No actions were executed successfully"
	} else if successfulActions < len(actionResults) {
		executionLog.Status = models.TriggerExecutionV2StatusPartial
	} else {
		executionLog.Status = models.TriggerExecutionV2StatusSuccess
	}

	// Finalize execution log
	executionLog.EndTime = time.Now()
	executionLog.Duration = time.Since(startTime).Milliseconds()
	executionLog.ExecutionTraceData = s.buildExecutionTrace(trigger, email, conditionResult, conditionEval, filterStart, filterEnd, nil, actionResults, startTime, executionLog.EndTime)
	s.logRepo.Create(executionLog)
	s.recordTriggerBusinessLog(trigger, email, executionLog)

	// Update trigger statistics
	s.updateTriggerStatistics(trigger.ID, executionLog.Status == models.TriggerExecutionV2StatusSuccess, executionLog.Error)

	s.logger.Info("Completed processing email %d for trigger %d with status: %s",
		email.ID, trigger.ID, executionLog.Status)

	return nil
}

// buildExecutionTrace 重建执行追踪并以 base64(JSON) 形式返回，供前端时间线展示。
// 出错时返回空字符串（trace 仅为可观测信息，不应影响主流程）。
func (s *EmailTriggerService) buildExecutionTrace(
	trigger *models.EmailTriggerV2,
	email models.Email,
	conditionResult bool,
	conditionEval models.JSONMap,
	filterStart, filterEnd time.Time,
	filterErr error,
	actionResults models.ActionExecutionResults,
	startTime, endTime time.Time,
) string {
	steps := make([]models.ExecutionStep, 0, len(actionResults)+1)

	// Filter step（条件表达式评估）— 始终产出，失败时标记为 Success=false
	filterInput := map[string]interface{}{
		"accountId":       email.AccountID,
		"emailId":         email.ID,
		"messageId":       email.MessageID,
		"subject":         email.Subject,
		"from":            []string(email.From),
		"to":              []string(email.To),
		"cc":              []string(email.Cc),
		"date":            email.Date,
		"receivedAt":      email.ReceivedAt,
		"mailboxName":     email.MailboxName,
		"flags":           []string(email.Flags),
		"hasAttachments":  email.HasAttachments,
		"expressionCount": len(trigger.Expressions),
		"expressions":     trigger.Expressions,
	}
	filterOutput := map[string]interface{}{
		"result": conditionResult,
	}
	if conditionEval != nil {
		filterOutput["evaluated"] = conditionEval
	}
	filterStep := models.ExecutionStep{
		ID:        "filter-evaluation",
		Type:      models.ExecutionStepTypeFilter,
		Name:      "条件表达式评估",
		PluginID:  "builtin",
		StartTime: filterStart,
		EndTime:   filterEnd,
		Duration:  filterEnd.Sub(filterStart).Milliseconds(),
		Success:   filterErr == nil,
		Input:     filterInput,
		Output:    filterOutput,
	}
	if filterErr != nil {
		filterStep.Error = filterErr.Error()
	}
	steps = append(steps, filterStep)

	// Action steps
	for _, result := range actionResults {
		name := result.PluginName
		if name == "" {
			name = result.PluginID
		}
		stepID := result.ActionID
		if stepID == "" {
			stepID = result.PluginID
		}
		steps = append(steps, models.ExecutionStep{
			ID:        stepID,
			Type:      models.ExecutionStepTypeAction,
			Name:      name,
			PluginID:  result.PluginID,
			StartTime: result.StartTime,
			EndTime:   result.EndTime,
			Duration:  result.Duration,
			Success:   result.Success,
			Input:     result.Input,
			Output:    result.Output,
			Error:     result.Error,
		})
	}

	trace := models.ExecutionTrace{
		Steps:      steps,
		TotalSteps: len(steps),
		StartTime:  startTime,
		EndTime:    endTime,
		TotalMs:    endTime.Sub(startTime).Milliseconds(),
	}

	jsonBytes, err := json.Marshal(trace)
	if err != nil {
		s.logger.Error("Failed to marshal execution trace for trigger %d email %d: %v", trigger.ID, email.ID, err)
		return ""
	}
	return base64.StdEncoding.EncodeToString(jsonBytes)
}

func (s *EmailTriggerService) recordTriggerBusinessLog(trigger *models.EmailTriggerV2, email models.Email, executionLog *models.TriggerExecutionLogV2) {
	if s.businessLog == nil || trigger == nil || executionLog == nil {
		return
	}
	status := models.BusinessLogStatusSuccess
	result := string(executionLog.Status)
	if !executionLog.ConditionResult {
		status = models.BusinessLogStatusSkipped
		result = "condition_not_matched"
	} else if executionLog.Status == models.TriggerExecutionV2StatusFailed {
		status = models.BusinessLogStatusFailed
	} else if executionLog.Status == models.TriggerExecutionV2StatusPartial {
		status = models.BusinessLogStatusPartial
	}
	finishedAt := executionLog.EndTime
	s.businessLog.Process(context.Background(), BusinessLogEvent{
		OrgID:         trigger.OrgID,
		OperationType: models.BusinessLogOperationAutomatic,
		ActorType:     models.BusinessLogActorTrigger,
		ActorID:       fmt.Sprintf("%d", trigger.ID),
		ActorName:     trigger.Name,
		Module:        "trigger",
		Action:        "execute",
		EntityType:    "email_trigger",
		EntityID:      fmt.Sprintf("%d", trigger.ID),
		EntityName:    trigger.Name,
		Title:         "触发器执行",
		Summary:       fmt.Sprintf("触发器 %s 处理邮件 %d，结果 %s", trigger.Name, email.ID, result),
		Status:        status,
		Result:        result,
		StartedAt:     executionLog.StartTime,
		FinishedAt:    &finishedAt,
		DurationMS:    executionLog.Duration,
		RunID:         fmt.Sprintf("trigger_log_%d", executionLog.ID),
		ErrorMessage:  executionLog.Error,
		Details: map[string]interface{}{
			"trigger_id":               trigger.ID,
			"trigger_name":             trigger.Name,
			"trigger_execution_log_id": executionLog.ID,
			"email_id":                 email.ID,
			"email_subject":            email.Subject,
			"email_account_id":         email.AccountID,
			"account_id":               email.AccountID,
			"account_email":            email.Account.EmailAddress,
			"mailbox":                  email.MailboxName,
			"condition_result":         executionLog.ConditionResult,
			"actions_executed":         executionLog.ActionsExecuted,
			"actions_succeeded":        executionLog.ActionsSucceeded,
			"action_results":           executionLog.ActionResults,
		},
	})
}

// evaluateTriggerConditions evaluates the conditions of a trigger against an email
func (s *EmailTriggerService) evaluateTriggerConditions(trigger *models.EmailTriggerV2, email models.Email) (bool, models.JSONMap, error) {
	s.logger.Debug("Evaluating conditions for trigger %d against email %d",
		trigger.ID, email.ID)

	// 尝试从缓存获取结果
	if cachedResult, cachedDetails, found := s.resultCache.Get(trigger.ID, email.ID); found {
		s.logger.Debug("Using cached result for trigger %d and email %d: %v",
			trigger.ID, email.ID, cachedResult)
		return cachedResult, cachedDetails, nil
	}

	// 创建评估上下文
	context := NewEvaluationContext(email)

	// 添加额外的上下文数据
	context.Data["triggerId"] = trigger.ID
	context.Data["triggerName"] = trigger.Name

	// 使用条件引擎评估表达式
	result, evalDetails, err := s.conditionEngine.EvaluateExpressions(trigger.Expressions, context)
	if err != nil {
		s.logger.Error("Error evaluating conditions for trigger %d: %v",
			trigger.ID, err)
		return false, models.JSONMap{
			"evaluated": "true",
			"result":    "false",
			"error":     err.Error(),
		}, err
	}

	s.logger.Debug("Condition evaluation result for trigger %d: %v",
		trigger.ID, result)

	// 缓存结果
	s.resultCache.Set(trigger.ID, email.ID, result, evalDetails, 5*time.Minute)

	return result, evalDetails, nil
}

// executeTriggerActions executes the actions of a trigger for an email
func (s *EmailTriggerService) executeTriggerActions(trigger *models.EmailTriggerV2, email models.Email) (models.ActionExecutionResults, error) {
	s.logger.Debug("Executing actions for trigger %d on email %d",
		trigger.ID, email.ID)

	// Use the V2 action executor to execute actions with shared event variables and interceptors.
	return s.actionExecutor.ExecuteActionsWithContext(trigger.Actions, email, trigger.ID)
}

// updateTriggerStatistics updates the execution statistics for a trigger
func (s *EmailTriggerService) updateTriggerStatistics(triggerID uint, success bool, errorMsg string) {
	// Get the current trigger
	trigger, err := s.triggerRepo.GetByID(triggerID)
	if err != nil {
		s.logger.Error("Failed to get trigger %d for statistics update: %v",
			triggerID, err)
		return
	}

	// Update statistics
	trigger.TotalExecutions++
	if success {
		trigger.SuccessExecutions++
	}

	now := time.Now()
	trigger.LastExecutedAt = &now
	trigger.LastError = errorMsg

	// Save the updated trigger
	if err := s.triggerRepo.Update(trigger); err != nil {
		s.logger.Error("Failed to update trigger %d statistics: %v",
			triggerID, err)
	}
}

// EnableTrigger enables a trigger and sets up its subscription
func (s *EmailTriggerService) EnableTrigger(triggerID uint) error {
	// Get the trigger
	trigger, err := s.triggerRepo.GetByID(triggerID)
	if err != nil {
		return fmt.Errorf("failed to get trigger: %w", err)
	}

	// Update the enabled status
	trigger.Enabled = true
	if err := s.triggerRepo.Update(trigger); err != nil {
		return fmt.Errorf("failed to update trigger: %w", err)
	}

	// Set up subscription
	if err := s.setupTriggerSubscription(trigger); err != nil {
		// Revert the enabled status if subscription fails
		trigger.Enabled = false
		s.triggerRepo.Update(trigger)
		return fmt.Errorf("failed to set up subscription: %w", err)
	}

	s.logger.Info("Enabled trigger: %s (ID: %d)", trigger.Name, trigger.ID)
	return nil
}

// DisableTrigger disables a trigger and removes its subscription
func (s *EmailTriggerService) DisableTrigger(triggerID uint) error {
	// Get the trigger
	trigger, err := s.triggerRepo.GetByID(triggerID)
	if err != nil {
		return fmt.Errorf("failed to get trigger: %w", err)
	}

	// Update the enabled status
	trigger.Enabled = false
	if err := s.triggerRepo.Update(trigger); err != nil {
		return fmt.Errorf("failed to update trigger: %w", err)
	}

	// Remove subscription
	s.mu.RLock()
	subscriptionID, exists := s.activeSubscriptions[triggerID]
	s.mu.RUnlock()

	if exists {
		if err := s.subscriptionManager.Unsubscribe(subscriptionID); err != nil {
			s.logger.Warn("Failed to unsubscribe trigger %d: %v", triggerID, err)
			// Continue anyway, as the trigger is already disabled in the database
		}

		s.mu.Lock()
		delete(s.activeSubscriptions, triggerID)
		s.mu.Unlock()
	}

	s.logger.Info("Disabled trigger: %s (ID: %d)", trigger.Name, trigger.ID)
	return nil
}

// Shutdown gracefully shuts down the email trigger service
func (s *EmailTriggerService) Shutdown() {
	s.logger.Info("Shutting down email trigger service")

	// Unsubscribe from all active subscriptions
	s.mu.Lock()
	for triggerID, subscriptionID := range s.activeSubscriptions {
		if err := s.subscriptionManager.Unsubscribe(subscriptionID); err != nil {
			s.logger.Warn("Failed to unsubscribe trigger %d: %v", triggerID, err)
		}
	}
	s.activeSubscriptions = make(map[uint]string)
	s.mu.Unlock()

	s.logger.Info("Email trigger service shutdown complete")
}
