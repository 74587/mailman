package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"mailman/internal/models"
	"mailman/internal/repository"
	"sort"
	"strings"
	"sync"
	"text/template"
	"time"

	"github.com/robertkrimen/otto"
)

// TriggerService 触发器服务 - 事件驱动模式
type TriggerService struct {
	triggerRepo         *repository.TriggerRepository
	logRepo             *repository.TriggerExecutionLogRepository
	emailRepo           *repository.EmailRepository
	extractorService    *ExtractorService
	subscriptionManager *SubscriptionManager

	// 事件订阅管理
	eventSubscriptions map[uint]func() // key: triggerID, value: unsubscribe function
	mu                 sync.RWMutex
	shutdownCh         chan struct{}
}

// NewTriggerService 创建触发器服务
func NewTriggerService(
	triggerRepo *repository.TriggerRepository,
	logRepo *repository.TriggerExecutionLogRepository,
	emailRepo *repository.EmailRepository,
	subscriptionManager *SubscriptionManager,
) *TriggerService {
	return &TriggerService{
		triggerRepo:         triggerRepo,
		logRepo:             logRepo,
		emailRepo:           emailRepo,
		extractorService:    NewExtractorService(),
		subscriptionManager: subscriptionManager,
		eventSubscriptions:  make(map[uint]func()),
		shutdownCh:          make(chan struct{}),
	}
}

// Start 启动触发器服务 - 事件驱动模式
func (s *TriggerService) Start() error {
	log.Printf("[TriggerService] Starting trigger service (event-driven mode)...")

	// 加载所有启用的触发器
	triggers, err := s.triggerRepo.GetByStatus(models.TriggerStatusEnabled, 0)
	if err != nil {
		return fmt.Errorf("failed to load enabled triggers: %w", err)
	}

	// 为每个启用的触发器订阅邮件事件
	for _, trigger := range triggers {
		if err := s.subscribeToEmailEvents(&trigger); err != nil {
			log.Printf("[TriggerService] Failed to subscribe to email events for trigger %d: %v", trigger.ID, err)
		}
	}

	log.Printf("[TriggerService] Started %d trigger event subscriptions", len(s.eventSubscriptions))
	return nil
}

// Stop 停止触发器服务
func (s *TriggerService) Stop() {
	log.Printf("[TriggerService] Stopping trigger service...")

	close(s.shutdownCh)

	// 取消所有事件订阅
	s.mu.Lock()
	for triggerID, unsubscribe := range s.eventSubscriptions {
		unsubscribe()
		log.Printf("[TriggerService] Unsubscribed trigger %d from email events", triggerID)
	}
	s.eventSubscriptions = make(map[uint]func())
	s.mu.Unlock()

	log.Printf("[TriggerService] Trigger service stopped")
}

// CreateTrigger 创建触发器
func (s *TriggerService) CreateTrigger(trigger *models.EmailTrigger) error {
	if err := s.triggerRepo.Create(trigger); err != nil {
		return err
	}

	// 如果触发器是启用状态，立即订阅邮件事件
	if trigger.Status == models.TriggerStatusEnabled {
		if err := s.subscribeToEmailEvents(trigger); err != nil {
			log.Printf("[TriggerService] Failed to subscribe to email events for new trigger %d: %v", trigger.ID, err)
		}
	}

	return nil
}

// UpdateTrigger 更新触发器
func (s *TriggerService) UpdateTrigger(trigger *models.EmailTrigger) error {
	// 更新数据库
	if err := s.triggerRepo.Update(trigger); err != nil {
		return err
	}

	// 处理事件订阅状态变化
	s.mu.Lock()
	_, exists := s.eventSubscriptions[trigger.ID]
	s.mu.Unlock()

	if trigger.Status == models.TriggerStatusEnabled {
		if exists {
			// 如果订阅已存在，先取消再重新订阅（处理配置变化）
			log.Printf("[TriggerService] Updating event subscription for trigger %d", trigger.ID)
			s.unsubscribeFromEmailEvents(trigger.ID)
			if err := s.subscribeToEmailEvents(trigger); err != nil {
				log.Printf("[TriggerService] Failed to update event subscription for trigger %d: %v", trigger.ID, err)
			}
		} else {
			// 启动新的事件订阅
			if err := s.subscribeToEmailEvents(trigger); err != nil {
				log.Printf("[TriggerService] Failed to subscribe to email events for updated trigger %d: %v", trigger.ID, err)
			}
		}
	} else {
		// 触发器被禁用，取消事件订阅
		if exists {
			s.unsubscribeFromEmailEvents(trigger.ID)
		}
	}

	return nil
}

// DeleteTrigger 删除触发器
func (s *TriggerService) DeleteTrigger(id uint) error {
	// 取消事件订阅
	s.unsubscribeFromEmailEvents(id)

	// 删除触发器
	return s.triggerRepo.Delete(id)
}

// EnableTrigger 启用触发器
func (s *TriggerService) EnableTrigger(id uint) error {
	trigger, err := s.triggerRepo.GetByID(id)
	if err != nil {
		return err
	}

	if err := s.triggerRepo.UpdateStatus(id, models.TriggerStatusEnabled); err != nil {
		return err
	}

	trigger.Status = models.TriggerStatusEnabled
	return s.subscribeToEmailEvents(trigger)
}

// DisableTrigger 禁用触发器
func (s *TriggerService) DisableTrigger(id uint) error {
	if err := s.triggerRepo.UpdateStatus(id, models.TriggerStatusDisabled); err != nil {
		return err
	}

	s.unsubscribeFromEmailEvents(id)
	return nil
}

// subscribeToEmailEvents 订阅邮件事件
func (s *TriggerService) subscribeToEmailEvents(trigger *models.EmailTrigger) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// 检查是否已存在订阅
	if _, exists := s.eventSubscriptions[trigger.ID]; exists {
		return fmt.Errorf("event subscription for trigger %d already exists", trigger.ID)
	}

	// 创建邮件事件处理器
	eventHandler := func(email models.Email) error {
		// 异步处理邮件事件，避免阻塞事件流
		go func() {
			if err := s.processEmailWithTrigger(trigger, email, time.Now()); err != nil {
				log.Printf("[TriggerService] Error processing email %d with trigger %d: %v", email.ID, trigger.ID, err)
			}
		}()
		return nil
	}

	// 创建订阅请求
	subscribeRequest := SubscribeRequest{
		Type:     SubscriptionTypeRealtime,
		Priority: PriorityNormal,
		Filter: EmailFilter{
			EmailAddress:  trigger.EmailAddress,
			StartDate:     trigger.StartDate,
			EndDate:       trigger.EndDate,
			Subject:       trigger.Subject,
			From:          trigger.From,
			To:            trigger.To,
			HasAttachment: trigger.HasAttachment,
			Unread:        trigger.Unread,
			Labels:        trigger.Labels,
			Folders:       trigger.Folders,
			CustomFilters: trigger.CustomFilters,
		},
		Context:  context.Background(),
		Callback: eventHandler,
		// 不设置Timeout，让触发器订阅永久有效直到服务停止
	}

	// 使用SubscriptionManager订阅邮件事件
	subscription, err := s.subscriptionManager.Subscribe(subscribeRequest)
	if err != nil {
		return fmt.Errorf("failed to subscribe to email events: %w", err)
	}

	// 保存取消订阅的函数
	s.eventSubscriptions[trigger.ID] = func() {
		s.subscriptionManager.Unsubscribe(subscription.ID)
	}

	log.Printf("[TriggerService] Subscribed to email events for trigger %d (%s)", trigger.ID, trigger.Name)
	return nil
}

// unsubscribeFromEmailEvents 取消邮件事件订阅
func (s *TriggerService) unsubscribeFromEmailEvents(triggerID uint) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if unsubscribe, exists := s.eventSubscriptions[triggerID]; exists {
		unsubscribe()
		delete(s.eventSubscriptions, triggerID)
		log.Printf("[TriggerService] Unsubscribed from email events for trigger %d", triggerID)
	}
}

// executeTrigger 执行触发器
func (s *TriggerService) executeTrigger(trigger *models.EmailTrigger, lastCheckTime time.Time) error {
	startTime := time.Now()

	// 构建邮件搜索选项
	searchOptions := repository.EmailSearchOptions{
		StartDate:    &lastCheckTime,
		EndDate:      &startTime,
		FromQuery:    trigger.From,
		ToQuery:      trigger.To,
		SubjectQuery: trigger.Subject,
		MailboxName:  "",
		Limit:        100, // 限制每次检查的邮件数量
		Offset:       0,
		SortBy:       "date DESC",
	}

	// 如果指定了邮箱地址，需要找到对应的账户
	if trigger.EmailAddress != "" {
		searchOptions.ToQuery = trigger.EmailAddress
	}

	// 搜索符合条件的邮件
	emails, _, err := s.emailRepo.SearchEmails(searchOptions)
	if err != nil {
		return fmt.Errorf("failed to search emails: %w", err)
	}

	log.Printf("[TriggerService] Trigger %d found %d emails to process", trigger.ID, len(emails))

	// 处理每封邮件
	for _, email := range emails {
		if err := s.processEmailWithTrigger(trigger, email, startTime); err != nil {
			log.Printf("[TriggerService] Error processing email %d with trigger %d: %v", email.ID, trigger.ID, err)
		}
	}

	return nil
}

// processEmailWithTrigger 使用触发器处理邮件
func (s *TriggerService) processEmailWithTrigger(trigger *models.EmailTrigger, email models.Email, startTime time.Time) error {
	executionStartTime := time.Now()

	// 创建执行日志
	executionLog := &models.TriggerExecutionLog{
		TriggerID:       trigger.ID,
		EmailID:         email.ID,
		Status:          models.TriggerExecutionStatusFailed,
		StartTime:       executionStartTime,
		InputParams:     make(models.JSONMap),
		ConditionResult: false,
		ActionResults:   make(models.TriggerActionResults, 0),
	}

	// 设置输入参数
	executionLog.InputParams["email_id"] = fmt.Sprintf("%d", email.ID)
	executionLog.InputParams["trigger_id"] = fmt.Sprintf("%d", trigger.ID)
	executionLog.InputParams["check_time"] = startTime.Format(time.RFC3339)

	defer func() {
		executionLog.EndTime = time.Now()
		executionLog.ExecutionMs = executionLog.EndTime.Sub(executionLog.StartTime).Milliseconds()

		// 始终保存执行日志，便于调试和监控
		if err := s.logRepo.Create(executionLog); err != nil {
			log.Printf("[TriggerService] Failed to save execution log: %v", err)
		}

		// 更新触发器统计信息
		s.updateTriggerStatistics(trigger, executionLog.Status == models.TriggerExecutionStatusSuccess, executionLog.ErrorMessage)
	}()

	// 1. 评估触发条件
	conditionResult, err := s.evaluateCondition(trigger.Condition, email)
	if err != nil {
		executionLog.ConditionError = err.Error()
		executionLog.ErrorMessage = fmt.Sprintf("Condition evaluation failed: %v", err)
		return err
	}

	executionLog.ConditionResult = conditionResult

	// 如果条件不满足，直接返回
	if !conditionResult {
		executionLog.Status = models.TriggerExecutionStatusSuccess
		return nil
	}

	// 2. 执行触发动作
	modifiedEmail := email
	allActionsSucceeded := true
	var actionResults []models.TriggerActionResult

	// 按顺序执行动作
	actions := trigger.Actions
	sort.Slice(actions, func(i, j int) bool {
		return actions[i].Order < actions[j].Order
	})

	for _, action := range actions {
		if !action.Enabled {
			continue
		}

		actionStartTime := time.Now()
		result := models.TriggerActionResult{
			ActionName: action.Name,
			ActionType: string(action.Type),
			Success:    false,
		}

		// 将新的 TriggerAction 转换为旧的 TriggerActionConfig 格式
		actionConfig := models.TriggerActionConfig{
			Type:        action.Type,
			Name:        action.Name,
			Description: "",
			Config:      "",
			Enabled:     action.Enabled,
			Order:       action.Order,
		}

		// 如果 Config 是 map，尝试转换为 JSON 字符串
		if action.Config != "" {
			configBytes, err := json.Marshal(action.Config)
			if err == nil {
				actionConfig.Config = string(configBytes)
			}
		}

		// 执行动作
		outputEmail, err := s.executeAction(actionConfig, modifiedEmail)
		actionEndTime := time.Now()
		result.ExecutionMs = actionEndTime.Sub(actionStartTime).Milliseconds()

		if err != nil {
			result.Error = err.Error()
			allActionsSucceeded = false
			log.Printf("[TriggerService] Action %s failed for email %d: %v", action.Name, email.ID, err)
		} else {
			result.Success = true
			result.OutputData = map[string]interface{}{
				"modified": outputEmail.ID != modifiedEmail.ID ||
					outputEmail.Subject != modifiedEmail.Subject ||
					outputEmail.Body != modifiedEmail.Body ||
					outputEmail.HTMLBody != modifiedEmail.HTMLBody,
			}
			modifiedEmail = *outputEmail
		}

		actionResults = append(actionResults, result)
	}

	executionLog.ActionResults = actionResults

	// 设置最终状态
	if allActionsSucceeded {
		executionLog.Status = models.TriggerExecutionStatusSuccess
	} else if len(actionResults) > 0 {
		// 检查是否有部分成功
		hasSuccess := false
		for _, result := range actionResults {
			if result.Success {
				hasSuccess = true
				break
			}
		}
		if hasSuccess {
			executionLog.Status = models.TriggerExecutionStatusPartial
		}
	}

	return nil
}

// evaluateCondition 评估触发条件
func (s *TriggerService) evaluateCondition(condition models.TriggerConditionConfig, email models.Email) (bool, error) {
	switch condition.Type {
	case "js":
		return s.evaluateJSCondition(condition.Script, email)
	case "gotemplate":
		return s.evaluateGoTemplateCondition(condition.Script, email)
	default:
		return false, fmt.Errorf("unsupported condition type: %s", condition.Type)
	}
}

// evaluateJSCondition 评估JavaScript条件
func (s *TriggerService) evaluateJSCondition(script string, email models.Email) (bool, error) {
	vm := otto.New()

	// 设置超时
	timeout := time.After(10 * time.Second)
	done := make(chan bool, 1)

	var result bool
	var err error

	go func() {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("JS execution panic: %v", r)
			}
			done <- true
		}()

		// 设置邮件对象
		emailJSON, jsonErr := json.Marshal(email)
		if jsonErr != nil {
			err = fmt.Errorf("failed to marshal email: %w", jsonErr)
			return
		}

		if setErr := vm.Set("email", string(emailJSON)); setErr != nil {
			err = fmt.Errorf("failed to set email variable: %w", setErr)
			return
		}

		// 解析邮件对象
		if _, runErr := vm.Run("var parsedEmail = JSON.parse(email);"); runErr != nil {
			err = fmt.Errorf("failed to parse email in JS: %w", runErr)
			return
		}

		// 包装脚本确保返回布尔值
		wrappedScript := fmt.Sprintf(`
			(function() {
				try {
					var result = (function() { %s })();
					return !!result;
				} catch (e) {
					return false;
				}
			})()
		`, script)

		// 执行脚本
		value, runErr := vm.Run(wrappedScript)
		if runErr != nil {
			err = fmt.Errorf("JS execution failed: %w", runErr)
			return
		}

		result, err = value.ToBoolean()
	}()

	select {
	case <-timeout:
		return false, fmt.Errorf("JS condition evaluation timeout")
	case <-done:
		return result, err
	}
}

// evaluateGoTemplateCondition 评估Go模板条件
func (s *TriggerService) evaluateGoTemplateCondition(templateStr string, email models.Email) (bool, error) {
	// 定义模板函数
	funcMap := template.FuncMap{
		"contains":  strings.Contains,
		"hasPrefix": strings.HasPrefix,
		"hasSuffix": strings.HasSuffix,
		"toLower":   strings.ToLower,
		"toUpper":   strings.ToUpper,
		"trim":      strings.TrimSpace,
	}

	tmpl, err := template.New("condition").Funcs(funcMap).Parse(templateStr)
	if err != nil {
		return false, fmt.Errorf("invalid template: %w", err)
	}

	// 创建数据结构
	data := struct {
		*models.Email
		AllText string
	}{
		Email:   &email,
		AllText: strings.Join([]string{email.Subject, email.Body, email.HTMLBody}, " "),
	}

	var result strings.Builder
	err = tmpl.Execute(&result, data)
	if err != nil {
		return false, fmt.Errorf("template execution failed: %w", err)
	}

	output := strings.TrimSpace(result.String())
	return output == "true" || output == "1" || output == "yes", nil
}

// executeAction 执行触发动作
func (s *TriggerService) executeAction(action models.TriggerActionConfig, email models.Email) (*models.Email, error) {
	switch action.Type {
	case models.TriggerActionTypeModifyContent:
		return s.executeModifyContentAction(action, email)
	case models.TriggerActionTypeSMTP:
		// 未来实现SMTP转发
		return &email, fmt.Errorf("SMTP action not implemented yet")
	default:
		return &email, fmt.Errorf("unsupported action type: %s", action.Type)
	}
}

// executeModifyContentAction 执行内容修改动作
func (s *TriggerService) executeModifyContentAction(action models.TriggerActionConfig, email models.Email) (*models.Email, error) {
	// 解析配置，支持Go模板和JS
	config := action.Config

	// 创建邮件副本
	modifiedEmail := email

	// 使用Go模板处理配置
	funcMap := template.FuncMap{
		"replace":  strings.ReplaceAll,
		"toLower":  strings.ToLower,
		"toUpper":  strings.ToUpper,
		"trim":     strings.TrimSpace,
		"contains": strings.Contains,
	}

	tmpl, err := template.New("action").Funcs(funcMap).Parse(config)
	if err != nil {
		return &email, fmt.Errorf("invalid action template: %w", err)
	}

	// 创建数据结构
	data := struct {
		*models.Email
		AllText string
	}{
		Email:   &email,
		AllText: strings.Join([]string{email.Subject, email.Body, email.HTMLBody}, " "),
	}

	var result strings.Builder
	err = tmpl.Execute(&result, data)
	if err != nil {
		return &email, fmt.Errorf("action template execution failed: %w", err)
	}

	// 解析结果为JSON，期望包含修改后的字段
	var modifications map[string]interface{}
	if err := json.Unmarshal([]byte(result.String()), &modifications); err != nil {
		// 如果不是JSON，将结果作为body内容
		modifiedEmail.Body = result.String()
	} else {
		// 应用修改
		if subject, ok := modifications["subject"].(string); ok {
			modifiedEmail.Subject = subject
		}
		if body, ok := modifications["body"].(string); ok {
			modifiedEmail.Body = body
		}
		if htmlBody, ok := modifications["html_body"].(string); ok {
			modifiedEmail.HTMLBody = htmlBody
		}
	}

	return &modifiedEmail, nil
}

// updateTriggerStatistics 更新触发器统计信息
func (s *TriggerService) updateTriggerStatistics(trigger *models.EmailTrigger, success bool, errorMsg string) {
	now := time.Now()
	totalExecutions := trigger.TotalExecutions + 1
	successExecutions := trigger.SuccessExecutions
	if success {
		successExecutions++
	}

	lastError := ""
	if !success {
		lastError = errorMsg
	}

	if err := s.triggerRepo.UpdateStatistics(trigger.ID, totalExecutions, successExecutions, &now, lastError); err != nil {
		log.Printf("[TriggerService] Failed to update trigger statistics: %v", err)
	} else {
		// 更新内存中的触发器统计，确保后续执行使用正确的计数
		trigger.TotalExecutions = totalExecutions
		trigger.SuccessExecutions = successExecutions
		if !success {
			trigger.LastError = lastError
		}
	}
}

// GetEventSubscriptionStatus 获取事件订阅状态
func (s *TriggerService) GetEventSubscriptionStatus() map[uint]map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	status := make(map[uint]map[string]interface{})
	for triggerID := range s.eventSubscriptions {
		// 获取触发器详情
		trigger, err := s.triggerRepo.GetByID(triggerID)
		if err != nil {
			log.Printf("[TriggerService] Failed to get trigger %d details: %v", triggerID, err)
			continue
		}

		status[triggerID] = map[string]interface{}{
			"trigger_id":    triggerID,
			"trigger_name":  trigger.Name,
			"subscribed":    true,
			"status":        trigger.Status,
			"email_address": trigger.EmailAddress,
			"created_at":    trigger.CreatedAt,
			"updated_at":    trigger.UpdatedAt,
		}
	}

	return status
}
