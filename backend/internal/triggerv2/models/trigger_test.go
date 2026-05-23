package models

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewTriggerV2(t *testing.T) {
	name := "测试触发器"
	description := "这是一个测试触发器"

	trigger := NewTriggerV2(name, description)

	assert.Equal(t, name, trigger.Name)
	assert.Equal(t, description, trigger.Description)
	assert.Equal(t, TriggerV2StatusInactive, trigger.Status)
	assert.Equal(t, TriggerV2PriorityNormal, trigger.Priority)
	assert.NotNil(t, trigger.Metadata)
	assert.False(t, trigger.CreatedAt.IsZero())
	assert.False(t, trigger.UpdatedAt.IsZero())
	assert.False(t, trigger.Stats.CreatedAt.IsZero())

	// 验证默认配置
	assert.Equal(t, ExecutionModeImmediate, trigger.ExecutionConfig.Mode)
	assert.Equal(t, 10, trigger.ExecutionConfig.BatchSize)
	assert.Equal(t, 5, trigger.ExecutionConfig.ConcurrentLimit)
	assert.Equal(t, 30*time.Second, trigger.ExecutionConfig.Timeout)
	assert.Equal(t, 3, trigger.ExecutionConfig.RetryPolicy.MaxAttempts)

	// 验证监控配置
	assert.True(t, trigger.MonitoringConfig.LoggingEnabled)
	assert.True(t, trigger.MonitoringConfig.MetricsEnabled)
	assert.False(t, trigger.MonitoringConfig.AlertingEnabled)
}

func TestTriggerV2_IsActive(t *testing.T) {
	trigger := NewTriggerV2("测试触发器", "描述")

	// 默认状态为inactive
	assert.False(t, trigger.IsActive())

	// 激活触发器
	trigger.Status = TriggerV2StatusActive
	assert.True(t, trigger.IsActive())

	// 错误状态
	trigger.Status = TriggerV2StatusError
	assert.False(t, trigger.IsActive())
}

func TestTriggerV2_CanExecute(t *testing.T) {
	trigger := NewTriggerV2("测试触发器", "描述")

	// 没有动作，不能执行
	assert.False(t, trigger.CanExecute())

	// 添加动作但状态为inactive
	trigger.Actions = []ActionConfig{
		{
			Type:    ActionTypePlugin,
			Name:    "测试动作",
			Plugin:  "test-plugin",
			Config:  map[string]interface{}{},
			Enabled: true,
		},
	}
	assert.False(t, trigger.CanExecute())

	// 激活触发器
	trigger.Status = TriggerV2StatusActive
	assert.True(t, trigger.CanExecute())
}

func TestTriggerV2_IncrementStats(t *testing.T) {
	trigger := NewTriggerV2("测试触发器", "描述")

	// 初始统计
	assert.Equal(t, int64(0), trigger.Stats.TotalExecutions)
	assert.Equal(t, int64(0), trigger.Stats.SuccessfulExecutions)
	assert.Equal(t, int64(0), trigger.Stats.FailedExecutions)
	assert.Nil(t, trigger.Stats.LastExecutedAt)

	// 成功执行
	trigger.IncrementStats(true, 1000)
	assert.Equal(t, int64(1), trigger.Stats.TotalExecutions)
	assert.Equal(t, int64(1), trigger.Stats.SuccessfulExecutions)
	assert.Equal(t, int64(0), trigger.Stats.FailedExecutions)
	assert.Equal(t, int64(1000), trigger.Stats.AverageExecutionTime)
	assert.NotNil(t, trigger.Stats.LastExecutedAt)

	// 失败执行
	trigger.IncrementStats(false, 2000)
	assert.Equal(t, int64(2), trigger.Stats.TotalExecutions)
	assert.Equal(t, int64(1), trigger.Stats.SuccessfulExecutions)
	assert.Equal(t, int64(1), trigger.Stats.FailedExecutions)
	assert.Equal(t, int64(1500), trigger.Stats.AverageExecutionTime) // (1000 + 2000) / 2
}

func TestTriggerV2_SetError(t *testing.T) {
	trigger := NewTriggerV2("测试触发器", "描述")
	originalUpdateTime := trigger.UpdatedAt

	time.Sleep(1 * time.Millisecond)

	err := assert.AnError
	trigger.SetError(err)

	assert.Equal(t, TriggerV2StatusError, trigger.Status)
	assert.Equal(t, err.Error(), trigger.Stats.LastError)
	assert.True(t, trigger.UpdatedAt.After(originalUpdateTime))
}

func TestTriggerV2_ClearError(t *testing.T) {
	trigger := NewTriggerV2("测试触发器", "描述")
	trigger.Status = TriggerV2StatusError
	trigger.Stats.LastError = "测试错误"
	originalUpdateTime := trigger.UpdatedAt

	time.Sleep(1 * time.Millisecond)

	trigger.ClearError()

	assert.Equal(t, TriggerV2StatusInactive, trigger.Status)
	assert.Empty(t, trigger.Stats.LastError)
	assert.True(t, trigger.UpdatedAt.After(originalUpdateTime))
}

func TestTriggerV2_GetSuccessRate(t *testing.T) {
	trigger := NewTriggerV2("测试触发器", "描述")

	// 没有执行记录
	assert.Equal(t, 0.0, trigger.GetSuccessRate())

	// 设置统计数据
	trigger.Stats.TotalExecutions = 10
	trigger.Stats.SuccessfulExecutions = 8

	expectedRate := 80.0
	assert.Equal(t, expectedRate, trigger.GetSuccessRate())
}

func TestTriggerV2_GetFailureRate(t *testing.T) {
	trigger := NewTriggerV2("测试触发器", "描述")

	// 没有执行记录
	assert.Equal(t, 0.0, trigger.GetFailureRate())

	// 设置统计数据
	trigger.Stats.TotalExecutions = 10
	trigger.Stats.FailedExecutions = 2

	expectedRate := 20.0
	assert.Equal(t, expectedRate, trigger.GetFailureRate())
}

func TestTriggerV2_Activate(t *testing.T) {
	trigger := NewTriggerV2("测试触发器", "描述")
	originalUpdateTime := trigger.UpdatedAt

	time.Sleep(1 * time.Millisecond)

	trigger.Activate()

	assert.Equal(t, TriggerV2StatusActive, trigger.Status)
	assert.True(t, trigger.UpdatedAt.After(originalUpdateTime))
}

func TestTriggerV2_Deactivate(t *testing.T) {
	trigger := NewTriggerV2("测试触发器", "描述")
	trigger.Status = TriggerV2StatusActive
	originalUpdateTime := trigger.UpdatedAt

	time.Sleep(1 * time.Millisecond)

	trigger.Deactivate()

	assert.Equal(t, TriggerV2StatusInactive, trigger.Status)
	assert.True(t, trigger.UpdatedAt.After(originalUpdateTime))
}

func TestTriggerV2_Validate(t *testing.T) {
	tests := []struct {
		name         string
		setupTrigger func() *TriggerV2
		wantErr      bool
		errorMsg     string
	}{
		{
			name: "有效的触发器配置",
			setupTrigger: func() *TriggerV2 {
				trigger := NewTriggerV2("测试触发器", "描述")
				trigger.Actions = []ActionConfig{
					{
						Type:    ActionTypePlugin,
						Name:    "测试动作",
						Plugin:  "test-plugin",
						Config:  map[string]interface{}{},
						Enabled: true,
					},
				}
				return trigger
			},
			wantErr: false,
		},
		{
			name: "空名称",
			setupTrigger: func() *TriggerV2 {
				trigger := NewTriggerV2("", "描述")
				trigger.Actions = []ActionConfig{
					{
						Type:    ActionTypePlugin,
						Name:    "测试动作",
						Plugin:  "test-plugin",
						Config:  map[string]interface{}{},
						Enabled: true,
					},
				}
				return trigger
			},
			wantErr:  true,
			errorMsg: "触发器名称不能为空",
		},
		{
			name: "没有动作",
			setupTrigger: func() *TriggerV2 {
				return NewTriggerV2("测试触发器", "描述")
			},
			wantErr:  true,
			errorMsg: "触发器至少需要一个动作",
		},
		{
			name: "动作缺少插件名称",
			setupTrigger: func() *TriggerV2 {
				trigger := NewTriggerV2("测试触发器", "描述")
				trigger.Actions = []ActionConfig{
					{
						Type:    ActionTypePlugin,
						Name:    "测试动作",
						Plugin:  "",
						Config:  map[string]interface{}{},
						Enabled: true,
					},
				}
				return trigger
			},
			wantErr:  true,
			errorMsg: "动作 0 的插件名称不能为空",
		},
		{
			name: "动作缺少名称",
			setupTrigger: func() *TriggerV2 {
				trigger := NewTriggerV2("测试触发器", "描述")
				trigger.Actions = []ActionConfig{
					{
						Type:    ActionTypePlugin,
						Name:    "",
						Plugin:  "test-plugin",
						Config:  map[string]interface{}{},
						Enabled: true,
					},
				}
				return trigger
			},
			wantErr:  true,
			errorMsg: "动作 0 的名称不能为空",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			trigger := tt.setupTrigger()
			err := trigger.Validate()

			if tt.wantErr {
				assert.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestTriggerV2_Clone(t *testing.T) {
	originalTrigger := NewTriggerV2("原始触发器", "原始描述")
	originalTrigger.ID = 123
	originalTrigger.Status = TriggerV2StatusActive
	originalTrigger.Priority = TriggerV2PriorityHigh
	originalTrigger.Stats.TotalExecutions = 100
	originalTrigger.Stats.SuccessfulExecutions = 90
	originalTrigger.Actions = []ActionConfig{
		{
			Type:    ActionTypePlugin,
			Name:    "测试动作",
			Plugin:  "test-plugin",
			Config:  map[string]interface{}{"key": "value"},
			Enabled: true,
		},
	}

	clonedTrigger := originalTrigger.Clone()

	// 验证克隆后的基本属性
	assert.Equal(t, uint(0), clonedTrigger.ID)
	assert.Equal(t, "原始触发器 (副本)", clonedTrigger.Name)
	assert.Equal(t, "原始描述", clonedTrigger.Description)
	assert.Equal(t, TriggerV2StatusInactive, clonedTrigger.Status)
	assert.Equal(t, TriggerV2PriorityHigh, clonedTrigger.Priority)

	// 验证统计信息被重置
	assert.Equal(t, int64(0), clonedTrigger.Stats.TotalExecutions)
	assert.Equal(t, int64(0), clonedTrigger.Stats.SuccessfulExecutions)
	assert.False(t, clonedTrigger.Stats.CreatedAt.IsZero())

	// 验证动作配置被正确复制
	assert.Equal(t, len(originalTrigger.Actions), len(clonedTrigger.Actions))
	assert.Equal(t, originalTrigger.Actions[0].Name, clonedTrigger.Actions[0].Name)
	assert.Equal(t, originalTrigger.Actions[0].Plugin, clonedTrigger.Actions[0].Plugin)

	// 验证时间戳
	assert.False(t, clonedTrigger.CreatedAt.IsZero())
	assert.False(t, clonedTrigger.UpdatedAt.IsZero())
}

func TestConditionConfig_ComplexLogic(t *testing.T) {
	// 测试复杂的条件逻辑配置
	condition := ConditionConfig{
		Type:     ConditionTypeLogical,
		Operator: LogicalOperatorAnd,
		Children: []ConditionConfig{
			{
				Type:   ConditionTypePlugin,
				Plugin: "regex-condition",
				Config: map[string]interface{}{
					"pattern": "urgent",
					"field":   "subject",
				},
			},
			{
				Type:     ConditionTypeLogical,
				Operator: LogicalOperatorOr,
				Children: []ConditionConfig{
					{
						Type:   ConditionTypePlugin,
						Plugin: "field-condition",
						Config: map[string]interface{}{
							"field":    "from",
							"operator": "contains",
							"value":    "@important.com",
						},
					},
					{
						Type:   ConditionTypePlugin,
						Plugin: "field-condition",
						Config: map[string]interface{}{
							"field":    "labels",
							"operator": "contains",
							"value":    "vip",
						},
					},
				},
			},
		},
	}

	// 验证条件结构
	assert.Equal(t, ConditionTypeLogical, condition.Type)
	assert.Equal(t, LogicalOperatorAnd, condition.Operator)
	assert.Len(t, condition.Children, 2)
	assert.Equal(t, ConditionTypePlugin, condition.Children[0].Type)
	assert.Equal(t, ConditionTypeLogical, condition.Children[1].Type)
	assert.Equal(t, LogicalOperatorOr, condition.Children[1].Operator)
	assert.Len(t, condition.Children[1].Children, 2)
}

func TestActionConfig_RetryConfig(t *testing.T) {
	action := ActionConfig{
		Type:   ActionTypePlugin,
		Name:   "重试动作",
		Plugin: "webhook-action",
		Config: map[string]interface{}{
			"url": "https://example.com/webhook",
		},
		Enabled: true,
		Order:   1,
		Timeout: intPtr(30),
		Retry: &ActionRetryConfig{
			MaxAttempts: 5,
			Delay:       2 * time.Second,
			Backoff:     1.5,
		},
	}

	assert.Equal(t, ActionTypePlugin, action.Type)
	assert.Equal(t, "重试动作", action.Name)
	assert.Equal(t, "webhook-action", action.Plugin)
	assert.True(t, action.Enabled)
	assert.Equal(t, 1, action.Order)
	assert.Equal(t, 30, *action.Timeout)

	require.NotNil(t, action.Retry)
	assert.Equal(t, 5, action.Retry.MaxAttempts)
	assert.Equal(t, 2*time.Second, action.Retry.Delay)
	assert.Equal(t, 1.5, action.Retry.Backoff)
}

func TestDeletedAt_ScanAndValue(t *testing.T) {
	deletedAt := DeletedAt{}

	// 测试 nil 值
	err := deletedAt.Scan(nil)
	assert.NoError(t, err)
	assert.False(t, deletedAt.Valid)

	// 测试有效时间值
	testTime := time.Now().Round(time.Second)
	err = deletedAt.Scan(testTime)
	assert.NoError(t, err)
	assert.True(t, deletedAt.Valid)
	assert.Equal(t, testTime, deletedAt.Time)

	// 测试 Value 方法
	value, err := deletedAt.Value()
	assert.NoError(t, err)
	assert.Equal(t, testTime, value)

	// 测试无效值的 Value 方法
	deletedAt.Valid = false
	value, err = deletedAt.Value()
	assert.NoError(t, err)
	assert.Nil(t, value)
}

// 辅助函数
func intPtr(i int) *int {
	return &i
}

// 基准测试
func BenchmarkNewTriggerV2(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = NewTriggerV2("基准测试触发器", "基准测试描述")
	}
}

func BenchmarkTriggerV2_IncrementStats(b *testing.B) {
	trigger := NewTriggerV2("基准测试触发器", "基准测试描述")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		trigger.IncrementStats(true, 1000)
	}
}

func BenchmarkTriggerV2_Validate(b *testing.B) {
	trigger := NewTriggerV2("基准测试触发器", "基准测试描述")
	trigger.Actions = []ActionConfig{
		{
			Type:    ActionTypePlugin,
			Name:    "测试动作",
			Plugin:  "test-plugin",
			Config:  map[string]interface{}{},
			Enabled: true,
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = trigger.Validate()
	}
}
