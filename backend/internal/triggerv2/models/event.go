package models

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

	mainModels "mailman/internal/models"
)

// EventType 事件类型
type EventType string

const (
	// 邮件相关事件
	EventTypeEmailReceived EventType = "email.received"
	EventTypeEmailUpdated  EventType = "email.updated"
	EventTypeEmailDeleted  EventType = "email.deleted"

	// 触发器相关事件
	EventTypeTriggerCreated  EventType = "trigger.created"
	EventTypeTriggerUpdated  EventType = "trigger.updated"
	EventTypeTriggerDeleted  EventType = "trigger.deleted"
	EventTypeTriggerExecuted EventType = "trigger.executed"

	// 系统相关事件
	EventTypeSystemStart EventType = "system.start"
	EventTypeSystemStop  EventType = "system.stop"
)

// EventStatus 事件状态
type EventStatus string

const (
	EventStatusPending    EventStatus = "pending"
	EventStatusProcessing EventStatus = "processing"
	EventStatusCompleted  EventStatus = "completed"
	EventStatusFailed     EventStatus = "failed"
)

// VariableMetadata 变量元数据
type VariableMetadata struct {
	Name        string      `json:"name"`                  // 变量名
	Type        string      `json:"type"`                  // 类型: string, number, boolean, object, array
	Required    bool        `json:"required"`              // 是否必定存在
	Description string      `json:"description,omitempty"` // 描述
	Example     interface{} `json:"example,omitempty"`     // 示例值
}

// StepResult 步骤执行结果（用于 $step 访问）
type StepResult struct {
	Index        int                    `json:"index"`                   // 步骤索引
	Alias        string                 `json:"alias,omitempty"`         // 步骤别名
	PluginID     string                 `json:"plugin_id"`               // 插件ID
	PluginName   string                 `json:"plugin_name"`             // 插件名称
	Input        interface{}            `json:"input,omitempty"`         // 输入数据
	Output       interface{}            `json:"output,omitempty"`        // 输出数据
	Info         map[string]interface{} `json:"info,omitempty"`          // 动作元信息
	InternalVars map[string]interface{} `json:"internal_vars,omitempty"` // 内部变量
	Success      bool                   `json:"success"`                 // 是否成功
	Error        string                 `json:"error,omitempty"`         // 错误信息
}

// Event 事件模型
type Event struct {
	ID          string                 `json:"id"`
	Type        EventType              `json:"type"`
	Status      EventStatus            `json:"status"`
	Source      string                 `json:"source"`
	Subject     string                 `json:"subject"`
	Data        json.RawMessage        `json:"data"`
	Metadata    map[string]string      `json:"metadata,omitempty"`
	Variables   map[string]interface{} `json:"variables,omitempty"` // 全局变量池
	Steps       map[string]*StepResult `json:"steps,omitempty"`     // 步骤结果（key: 索引或别名）
	Priority    int                    `json:"priority"`
	RetryCount  int                    `json:"retry_count"`
	MaxRetries  int                    `json:"max_retries"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	ProcessedAt *time.Time             `json:"processed_at,omitempty"`
}

// EmailEventData 邮件事件数据
// 注意：JSON 标签使用 PascalCase 以匹配 Email 模型和前端代码示例
type EmailEventData struct {
	// 原有字段（使用大写以匹配前端 $.Subject 等语法）
	EmailID       uint      `json:"EmailID"`
	AccountID     uint      `json:"AccountID"`
	MailboxID     uint      `json:"MailboxID"`
	Subject       string    `json:"Subject"`
	From          string    `json:"From"`
	To            string    `json:"To"`
	MessageID     string    `json:"MessageID"`
	ThreadID      string    `json:"ThreadID"`
	IsRead        bool      `json:"IsRead"`
	HasAttachment bool      `json:"HasAttachment"`
	Labels        []string  `json:"Labels"`
	ReceivedAt    time.Time `json:"ReceivedAt"`

	// 新增字段 - 完整的邮件对象（可选）
	Email *mainModels.Email `json:"Email,omitempty"`

	// 事件元数据（新增）
	EventType   string                 `json:"EventType,omitempty"` // "received", "updated", "deleted"
	MailboxName string                 `json:"MailboxName,omitempty"`
	Changes     map[string]interface{} `json:"Changes,omitempty"`
	TriggerID   uint                   `json:"TriggerID,omitempty"`
	ExecutionID string                 `json:"ExecutionID,omitempty"`
}

// TriggerEventData 触发器事件数据
type TriggerEventData struct {
	TriggerID     uint      `json:"trigger_id"`
	TriggerName   string    `json:"trigger_name"`
	EmailID       uint      `json:"email_id"`
	ConditionMet  bool      `json:"condition_met"`
	ExecutionID   string    `json:"execution_id"`
	ExecutionTime time.Time `json:"execution_time"`
	Success       bool      `json:"success"`
	Error         string    `json:"error,omitempty"`
}

// NewEvent 创建新事件
func NewEvent(eventType EventType, source string, subject string, data interface{}) (*Event, error) {
	dataBytes, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	return &Event{
		ID:         generateEventID(),
		Type:       eventType,
		Status:     EventStatusPending,
		Source:     source,
		Subject:    subject,
		Data:       dataBytes,
		Metadata:   make(map[string]string),
		Priority:   0,
		RetryCount: 0,
		MaxRetries: 3,
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}

// GetData 获取事件数据
func (e *Event) GetData(target interface{}) error {
	return json.Unmarshal(e.Data, target)
}

// SetData 设置事件数据
func (e *Event) SetData(data interface{}) error {
	dataBytes, err := json.Marshal(data)
	if err != nil {
		return err
	}
	e.Data = dataBytes
	e.UpdatedAt = time.Now()
	return nil
}

// CanRetry 是否可以重试
func (e *Event) CanRetry() bool {
	return e.RetryCount < e.MaxRetries
}

// IncrementRetry 增加重试次数
func (e *Event) IncrementRetry() {
	e.RetryCount++
	e.UpdatedAt = time.Now()
}

// MarkProcessing 标记为处理中
func (e *Event) MarkProcessing() {
	e.Status = EventStatusProcessing
	e.UpdatedAt = time.Now()
}

// MarkCompleted 标记为完成
func (e *Event) MarkCompleted() {
	now := time.Now()
	e.Status = EventStatusCompleted
	e.UpdatedAt = now
	e.ProcessedAt = &now
}

// MarkFailed 标记为失败
func (e *Event) MarkFailed() {
	now := time.Now()
	e.Status = EventStatusFailed
	e.UpdatedAt = now
	e.ProcessedAt = &now
}

// SetVariable 设置变量
func (e *Event) SetVariable(name string, value interface{}) {
	if e.Variables == nil {
		e.Variables = make(map[string]interface{})
	}
	e.Variables[name] = value
	e.UpdatedAt = time.Now()
}

// GetVariable 获取变量，返回值和是否存在
func (e *Event) GetVariable(name string) (interface{}, bool) {
	if e.Variables == nil {
		return nil, false
	}
	value, exists := e.Variables[name]
	return value, exists
}

// GetVariableOrError 获取变量，不存在时返回错误
func (e *Event) GetVariableOrError(name string) (interface{}, error) {
	value, exists := e.GetVariable(name)
	if !exists {
		return nil, fmt.Errorf("variable '%s' not found", name)
	}
	return value, nil
}

// GetAllVariables 获取所有变量（只读副本）
func (e *Event) GetAllVariables() map[string]interface{} {
	if e.Variables == nil {
		return make(map[string]interface{})
	}
	// 返回副本以避免外部修改
	result := make(map[string]interface{}, len(e.Variables))
	for k, v := range e.Variables {
		result[k] = v
	}
	return result
}

// HasVariable 检查变量是否存在
func (e *Event) HasVariable(name string) bool {
	if e.Variables == nil {
		return false
	}
	_, exists := e.Variables[name]
	return exists
}

// DeleteVariable 删除变量
func (e *Event) DeleteVariable(name string) {
	if e.Variables != nil {
		delete(e.Variables, name)
		e.UpdatedAt = time.Now()
	}
}

// ClearVariables 清空所有变量
func (e *Event) ClearVariables() {
	e.Variables = make(map[string]interface{})
	e.UpdatedAt = time.Now()
}

// SetStep 设置步骤结果
func (e *Event) SetStep(index int, alias string, step *StepResult) {
	if e.Steps == nil {
		e.Steps = make(map[string]*StepResult)
	}
	// 按索引存储
	indexKey := fmt.Sprintf("%d", index)
	e.Steps[indexKey] = step
	// 如果有别名，也按别名存储
	if alias != "" {
		e.Steps[alias] = step
	}
	e.UpdatedAt = time.Now()
}

// GetStep 获取步骤结果（按索引或别名）
func (e *Event) GetStep(key string) (*StepResult, bool) {
	if e.Steps == nil {
		return nil, false
	}
	step, exists := e.Steps[key]
	return step, exists
}

// GetStepByIndex 按索引获取步骤结果
func (e *Event) GetStepByIndex(index int) (*StepResult, bool) {
	return e.GetStep(fmt.Sprintf("%d", index))
}

// GetAllSteps 获取所有步骤（只读副本）
func (e *Event) GetAllSteps() map[string]*StepResult {
	if e.Steps == nil {
		return make(map[string]*StepResult)
	}
	result := make(map[string]*StepResult, len(e.Steps))
	for k, v := range e.Steps {
		result[k] = v
	}
	return result
}

// generateEventID 生成事件ID
func generateEventID() string {
	// 使用时间戳（包含纳秒）和随机数生成唯一ID
	now := time.Now()
	timestamp := now.Format("20060102150405")
	nanos := now.UnixNano() % 1000000 // 取微秒部分
	return timestamp + fmt.Sprintf("%06d", nanos) + generateRandomString(6)
}

// generateRandomString 生成随机字符串
func generateRandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, length)

	// 使用crypto/rand生成真正的随机数
	for i := range result {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			// 如果crypto/rand失败，使用时间+索引作为后备
			result[i] = charset[(time.Now().UnixNano()+int64(i))%int64(len(charset))]
		} else {
			result[i] = charset[num.Int64()]
		}
	}
	return string(result)
}
