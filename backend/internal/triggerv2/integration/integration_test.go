package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mailman/internal/triggerv2/engine"
	"mailman/internal/triggerv2/models"
)

// IntegrationTestSuite 集成测试套件（简化版）
type IntegrationTestSuite struct {
	conditionEngine *engine.ConditionEngine
	batchProcessor  *engine.BatchProcessor
	mockProcessor   *MockEventProcessor

	// 清理函数
	cleanupFuncs []func()
}

// MockEventProcessor 模拟事件处理器
type MockEventProcessor struct {
	ProcessedBatches []*engine.EventBatch
	mu               sync.Mutex
}

func (m *MockEventProcessor) ProcessBatch(ctx context.Context, batch *engine.EventBatch) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ProcessedBatches = append(m.ProcessedBatches, batch)
	return nil
}

// setupIntegrationTest 设置集成测试环境
func setupIntegrationTest(t *testing.T) *IntegrationTestSuite {
	suite := &IntegrationTestSuite{
		cleanupFuncs: make([]func(), 0),
	}

	// 创建条件引擎
	conditionEngine := engine.NewConditionEngine()
	suite.conditionEngine = conditionEngine

	// 创建批处理器的事件处理器（模拟实现）
	mockProcessor := &MockEventProcessor{}
	suite.mockProcessor = mockProcessor

	// 创建批处理处理器（使用较短的刷新间隔用于测试）
	batchConfig := &engine.BatchConfig{
		MaxBatchSize:   100,
		FlushInterval:  50 * time.Millisecond, // 较短的刷新间隔用于测试
		MaxConcurrency: 10,
		RetryConfig: &engine.RetryConfig{
			MaxRetries:    3,
			InitialDelay:  time.Second,
			MaxDelay:      time.Minute,
			BackoffFactor: 2.0,
		},
	}
	batchProcessor := engine.NewBatchProcessor(batchConfig, mockProcessor)
	suite.batchProcessor = batchProcessor

	// 启动批处理器
	ctx := context.Background()
	err := batchProcessor.Start(ctx)
	require.NoError(t, err)

	suite.cleanupFuncs = append(suite.cleanupFuncs, func() {
		batchProcessor.Stop()
	})

	return suite
}

// teardownIntegrationTest 清理集成测试环境
func (suite *IntegrationTestSuite) teardownIntegrationTest() {
	for _, cleanup := range suite.cleanupFuncs {
		cleanup()
	}
}

// TestConditionEngineIntegration 测试条件引擎集成
func TestConditionEngineIntegration(t *testing.T) {
	suite := setupIntegrationTest(t)
	defer suite.teardownIntegrationTest()

	// 创建测试条件（比较表达式）
	condition := &engine.ConditionExpression{
		Type:     engine.ExpressionTypeComparison,
		Operator: "contains",
		Field:    "subject", // 直接使用字段名，从 ctx.Data 中获取
		Value:    "Urgent",
	}

	// 创建包含 "urgent" 的测试事件
	eventData, _ := json.Marshal(map[string]interface{}{
		"subject": "Urgent: Please respond immediately",
		"from":    "boss@company.com",
	})
	testEvent := &models.Event{
		ID:      "test-1",
		Type:    models.EventTypeEmailReceived,
		Subject: "Urgent: Please respond immediately",
		Data:    json.RawMessage(eventData),
	}

	evalCtx := &engine.EvaluationContext{
		Event: testEvent,
		Data: map[string]interface{}{
			"subject": "Urgent: Please respond immediately",
			"from":    "boss@company.com",
		},
	}

	// 测试条件评估
	result, err := suite.conditionEngine.Evaluate(condition, evalCtx)
	require.NoError(t, err)
	assert.True(t, result)

	// 创建不包含 "urgent" 的测试事件
	eventData2, _ := json.Marshal(map[string]interface{}{
		"subject": "Regular meeting reminder",
		"from":    "calendar@company.com",
	})
	testEvent2 := &models.Event{
		ID:      "test-2",
		Type:    models.EventTypeEmailReceived,
		Subject: "Regular meeting reminder",
		Data:    json.RawMessage(eventData2),
	}

	evalCtx2 := &engine.EvaluationContext{
		Event: testEvent2,
		Data: map[string]interface{}{
			"subject": "Regular meeting reminder",
			"from":    "calendar@company.com",
		},
	}

	result2, err := suite.conditionEngine.Evaluate(condition, evalCtx2)
	require.NoError(t, err)
	assert.False(t, result2)
}

// TestBatchProcessorIntegration 测试批处理器集成
func TestBatchProcessorIntegration(t *testing.T) {
	suite := setupIntegrationTest(t)
	defer suite.teardownIntegrationTest()

	// 创建测试事件
	for i := 0; i < 5; i++ {
		eventData := map[string]interface{}{
			"message": "Test event",
			"number":  i,
		}
		dataBytes, _ := json.Marshal(eventData)

		event := &models.Event{
			ID:        fmt.Sprintf("event-%d", i),
			Type:      models.EventTypeEmailReceived,
			Status:    models.EventStatusPending,
			Source:    "test",
			Subject:   "Test Event",
			Data:      json.RawMessage(dataBytes),
			Priority:  1,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}

		err := suite.batchProcessor.AddEvent(event)
		require.NoError(t, err)
	}

	// 等待批处理完成（等待足够长的时间让刷新工作器至少执行一次）
	time.Sleep(150 * time.Millisecond)

	// 验证批处理器处理了事件
	metrics := suite.batchProcessor.GetMetrics()
	assert.NotNil(t, metrics)

	// 验证模拟处理器收到了批次
	suite.mockProcessor.mu.Lock()
	processedBatchCount := len(suite.mockProcessor.ProcessedBatches)
	suite.mockProcessor.mu.Unlock()

	// 应该至少有一个批次被处理
	assert.True(t, processedBatchCount > 0, "Expected at least one batch to be processed")
}

// TestConditionWithFunctionIntegration 测试函数条件集成
func TestConditionWithFunctionIntegration(t *testing.T) {
	suite := setupIntegrationTest(t)
	defer suite.teardownIntegrationTest()

	// 创建包含函数的条件（使用函数表达式）
	condition := &engine.ConditionExpression{
		Type:     engine.ExpressionTypeComparison,
		Operator: ">",
		Left: &engine.ConditionExpression{
			Type:     engine.ExpressionTypeFunction,
			Function: "len",                     // 使用 len 函数
			Args:     []interface{}{"$subject"}, // 参数使用 $subject 引用字段
		},
		Right: &engine.ConditionExpression{
			Type:  engine.ExpressionTypeValue,
			Value: 10,
		},
	}

	// 创建长主题的测试事件
	eventData, _ := json.Marshal(map[string]interface{}{
		"subject": "This is a long subject line",
		"from":    "test@example.com",
	})
	testEvent := &models.Event{
		ID:      "test-func-1",
		Type:    models.EventTypeEmailReceived,
		Subject: "This is a long subject line",
		Data:    json.RawMessage(eventData),
	}

	evalCtx := &engine.EvaluationContext{
		Event: testEvent,
		Data: map[string]interface{}{
			"subject": "This is a long subject line",
			"from":    "test@example.com",
		},
	}

	// 测试函数条件评估
	result, err := suite.conditionEngine.Evaluate(condition, evalCtx)
	require.NoError(t, err)
	assert.True(t, result) // subject 长度 > 10

	// 创建短主题的测试事件
	eventData2, _ := json.Marshal(map[string]interface{}{
		"subject": "Short",
		"from":    "test@example.com",
	})
	testEvent2 := &models.Event{
		ID:      "test-func-2",
		Type:    models.EventTypeEmailReceived,
		Subject: "Short",
		Data:    json.RawMessage(eventData2),
	}

	evalCtx2 := &engine.EvaluationContext{
		Event: testEvent2,
		Data: map[string]interface{}{
			"subject": "Short",
			"from":    "test@example.com",
		},
	}

	result2, err := suite.conditionEngine.Evaluate(condition, evalCtx2)
	require.NoError(t, err)
	assert.False(t, result2) // subject 长度 <= 10
}

// TestComplexConditionIntegration 测试复杂条件集成（逻辑 AND）
func TestComplexConditionIntegration(t *testing.T) {
	suite := setupIntegrationTest(t)
	defer suite.teardownIntegrationTest()

	// 创建复杂的 AND 条件（使用 Left 和 Right 字段）
	condition := &engine.ConditionExpression{
		Type:     engine.ExpressionTypeLogical,
		Operator: "&&", // 使用实际的逻辑 AND 操作符
		Left: &engine.ConditionExpression{
			Type:     engine.ExpressionTypeComparison,
			Operator: "contains",
			Field:    "from",
			Value:    "important",
		},
		Right: &engine.ConditionExpression{
			Type:     engine.ExpressionTypeComparison,
			Operator: "contains",
			Field:    "subject",
			Value:    "Urgent", // 确保匹配大小写
		},
	}

	// 创建匹配所有条件的测试事件
	eventData1, _ := json.Marshal(map[string]interface{}{
		"from":    "important-sender@company.com",
		"subject": "Urgent: Action required",
	})
	testEvent1 := &models.Event{
		ID:      "test-complex-1",
		Type:    models.EventTypeEmailReceived,
		Subject: "Urgent: Action required",
		Data:    json.RawMessage(eventData1),
	}

	evalCtx1 := &engine.EvaluationContext{
		Event: testEvent1,
		Data: map[string]interface{}{
			"from":    "important-sender@company.com",
			"subject": "Urgent: Action required",
		},
	}

	result1, err := suite.conditionEngine.Evaluate(condition, evalCtx1)
	require.NoError(t, err)
	assert.True(t, result1)

	// 创建只匹配一个条件的测试事件
	eventData2, _ := json.Marshal(map[string]interface{}{
		"from":    "regular-sender@company.com",
		"subject": "Urgent: Action required",
	})
	testEvent2 := &models.Event{
		ID:      "test-complex-2",
		Type:    models.EventTypeEmailReceived,
		Subject: "Urgent: Action required",
		Data:    json.RawMessage(eventData2),
	}

	evalCtx2 := &engine.EvaluationContext{
		Event: testEvent2,
		Data: map[string]interface{}{
			"from":    "regular-sender@company.com",
			"subject": "Urgent: Action required",
		},
	}

	result2, err := suite.conditionEngine.Evaluate(condition, evalCtx2)
	require.NoError(t, err)
	assert.False(t, result2)
}
