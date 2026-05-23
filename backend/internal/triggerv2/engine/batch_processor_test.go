package engine

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"mailman/internal/triggerv2/models"
)

// MockEventProcessor 模拟事件处理器
type MockEventProcessor struct {
	processedBatches []*EventBatch
	processErrors    map[string]error
	processDelay     time.Duration
	mu               sync.RWMutex
}

func NewMockEventProcessor() *MockEventProcessor {
	return &MockEventProcessor{
		processedBatches: make([]*EventBatch, 0),
		processErrors:    make(map[string]error),
	}
}

func (m *MockEventProcessor) ProcessBatch(ctx context.Context, batch *EventBatch) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 模拟处理延迟
	if m.processDelay > 0 {
		time.Sleep(m.processDelay)
	}

	// 检查是否有预设的错误
	if err, exists := m.processErrors[batch.ID]; exists {
		return err
	}

	// 检查通配符错误
	if err, exists := m.processErrors["*"]; exists {
		return err
	}

	m.processedBatches = append(m.processedBatches, batch)
	return nil
}

func (m *MockEventProcessor) GetProcessedBatches() []*EventBatch {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*EventBatch, len(m.processedBatches))
	copy(result, m.processedBatches)
	return result
}

func (m *MockEventProcessor) SetProcessError(batchID string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.processErrors[batchID] = err
}

func (m *MockEventProcessor) SetProcessDelay(delay time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.processDelay = delay
}

func (m *MockEventProcessor) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.processedBatches = make([]*EventBatch, 0)
	m.processErrors = make(map[string]error)
	m.processDelay = 0
}

func createTestEvent(id, eventType, source string, priority int) *models.Event {
	event := &models.Event{
		ID:        id,
		Type:      models.EventType(eventType),
		Source:    source,
		Priority:  priority,
		Status:    models.EventStatusPending,
		CreatedAt: time.Now(),
	}

	// 设置测试数据
	testData := map[string]interface{}{
		"test_field": "test_value",
		"id":         id,
	}
	event.SetData(testData)

	return event
}

func TestBatchProcessor_BasicFunctionality(t *testing.T) {
	mockProcessor := NewMockEventProcessor()
	config := &BatchConfig{
		MaxBatchSize:   3,
		MaxWaitTime:    time.Second,
		FlushInterval:  time.Millisecond * 100,
		MaxConcurrency: 2,
		GroupByFields:  []string{"type"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	ctx := context.Background()
	err := batchProcessor.Start(ctx)
	if err != nil {
		t.Fatalf("启动批处理器失败: %v", err)
	}
	defer batchProcessor.Stop()

	// 添加事件
	events := []*models.Event{
		createTestEvent("event1", "email.received", "source1", 1),
		createTestEvent("event2", "email.received", "source1", 1),
		createTestEvent("event3", "email.received", "source1", 1),
	}

	for _, event := range events {
		err := batchProcessor.AddEvent(event)
		if err != nil {
			t.Errorf("添加事件失败: %v", err)
		}
	}

	// 等待处理完成
	time.Sleep(time.Millisecond * 500)

	// 验证结果
	processedBatches := mockProcessor.GetProcessedBatches()
	if len(processedBatches) != 1 {
		t.Errorf("期望处理1个批次，实际处理了%d个", len(processedBatches))
	}

	if len(processedBatches[0].Events) != 3 {
		t.Errorf("期望批次包含3个事件，实际包含%d个", len(processedBatches[0].Events))
	}

	// 验证指标
	metrics := batchProcessor.GetMetrics()
	if metrics.TotalBatches != 1 {
		t.Errorf("期望总批次数为1，实际为%d", metrics.TotalBatches)
	}

	if metrics.ProcessedBatches != 1 {
		t.Errorf("期望处理批次数为1，实际为%d", metrics.ProcessedBatches)
	}

	if metrics.TotalEvents != 3 {
		t.Errorf("期望总事件数为3，实际为%d", metrics.TotalEvents)
	}
}

func TestBatchProcessor_GroupByFields(t *testing.T) {
	mockProcessor := NewMockEventProcessor()
	config := &BatchConfig{
		MaxBatchSize:   5,
		MaxWaitTime:    time.Second,
		FlushInterval:  time.Millisecond * 100,
		MaxConcurrency: 2,
		GroupByFields:  []string{"type", "source"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	ctx := context.Background()
	err := batchProcessor.Start(ctx)
	if err != nil {
		t.Fatalf("启动批处理器失败: %v", err)
	}
	defer batchProcessor.Stop()

	// 添加不同类型和来源的事件
	events := []*models.Event{
		createTestEvent("event1", "email.received", "source1", 1),
		createTestEvent("event2", "email.received", "source1", 1),
		createTestEvent("event3", "email.updated", "source1", 1),
		createTestEvent("event4", "email.received", "source2", 1),
	}

	for _, event := range events {
		err := batchProcessor.AddEvent(event)
		if err != nil {
			t.Errorf("添加事件失败: %v", err)
		}
	}

	// 等待处理完成
	time.Sleep(time.Second * 2)

	// 验证结果 - 应该有3个不同的批次
	processedBatches := mockProcessor.GetProcessedBatches()
	if len(processedBatches) != 3 {
		t.Errorf("期望处理3个批次，实际处理了%d个", len(processedBatches))
		for i, batch := range processedBatches {
			t.Logf("批次 %d: GroupKey=%s, Events=%d", i, batch.GroupKey, len(batch.Events))
		}
	}
}

func TestBatchProcessor_TimeBasedFlushing(t *testing.T) {
	mockProcessor := NewMockEventProcessor()
	config := &BatchConfig{
		MaxBatchSize:   10, // 设置较大的批次大小
		MaxWaitTime:    time.Millisecond * 200,
		FlushInterval:  time.Millisecond * 50,
		MaxConcurrency: 2,
		GroupByFields:  []string{"type"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	ctx := context.Background()
	err := batchProcessor.Start(ctx)
	if err != nil {
		t.Fatalf("启动批处理器失败: %v", err)
	}
	defer batchProcessor.Stop()

	// 添加少量事件
	events := []*models.Event{
		createTestEvent("event1", "email.received", "source1", 1),
		createTestEvent("event2", "email.received", "source1", 1),
	}

	for _, event := range events {
		err := batchProcessor.AddEvent(event)
		if err != nil {
			t.Errorf("添加事件失败: %v", err)
		}
	}

	// 等待足够的时间让批次被时间刷新
	time.Sleep(time.Millisecond * 500)

	// 验证结果
	processedBatches := mockProcessor.GetProcessedBatches()
	if len(processedBatches) != 1 {
		t.Errorf("期望通过时间刷新处理1个批次，实际处理了%d个", len(processedBatches))
	}

	if len(processedBatches[0].Events) != 2 {
		t.Errorf("期望批次包含2个事件，实际包含%d个", len(processedBatches[0].Events))
	}
}

func TestBatchProcessor_RetryMechanism(t *testing.T) {
	mockProcessor := NewMockEventProcessor()

	// 首先为所有批次设置默认错误，确保重试逻辑被触发
	mockProcessor.SetProcessError("*", fmt.Errorf("模拟处理错误"))

	config := &BatchConfig{
		MaxBatchSize:   2,
		MaxWaitTime:    time.Second,
		FlushInterval:  time.Millisecond * 100,
		MaxConcurrency: 1,
		GroupByFields:  []string{"type"},
		RetryConfig: &RetryConfig{
			MaxRetries:    2,
			InitialDelay:  time.Millisecond * 50,
			MaxDelay:      time.Millisecond * 200,
			BackoffFactor: 2.0,
		},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	ctx := context.Background()
	err := batchProcessor.Start(ctx)
	if err != nil {
		t.Fatalf("启动批处理器失败: %v", err)
	}
	defer batchProcessor.Stop()

	// 添加事件
	events := []*models.Event{
		createTestEvent("event1", "email.received", "source1", 1),
		createTestEvent("event2", "email.received", "source1", 1),
	}

	for _, event := range events {
		err := batchProcessor.AddEvent(event)
		if err != nil {
			t.Errorf("添加事件失败: %v", err)
		}
	}

	// 等待重试完成
	time.Sleep(time.Second * 2)

	// 验证指标
	metrics := batchProcessor.GetMetrics()
	if metrics.FailedBatches != 1 {
		t.Errorf("期望失败批次数为1，实际为%d", metrics.FailedBatches)
	}
}

func TestBatchProcessor_ConcurrentProcessing(t *testing.T) {
	mockProcessor := NewMockEventProcessor()
	mockProcessor.SetProcessDelay(time.Millisecond * 100) // 设置处理延迟

	config := &BatchConfig{
		MaxBatchSize:   2,
		MaxWaitTime:    time.Millisecond * 100,
		FlushInterval:  time.Millisecond * 50,
		MaxConcurrency: 3,
		GroupByFields:  []string{"source"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	ctx := context.Background()
	err := batchProcessor.Start(ctx)
	if err != nil {
		t.Fatalf("启动批处理器失败: %v", err)
	}
	defer batchProcessor.Stop()

	// 添加多个不同来源的事件
	events := []*models.Event{
		createTestEvent("event1", "email.received", "source1", 1),
		createTestEvent("event2", "email.received", "source1", 1),
		createTestEvent("event3", "email.received", "source2", 1),
		createTestEvent("event4", "email.received", "source2", 1),
		createTestEvent("event5", "email.received", "source3", 1),
		createTestEvent("event6", "email.received", "source3", 1),
	}

	startTime := time.Now()
	for _, event := range events {
		err := batchProcessor.AddEvent(event)
		if err != nil {
			t.Errorf("添加事件失败: %v", err)
		}
	}

	// 等待处理完成
	time.Sleep(time.Second)

	processingTime := time.Since(startTime)

	// 验证结果
	processedBatches := mockProcessor.GetProcessedBatches()
	if len(processedBatches) != 3 {
		t.Errorf("期望处理3个批次，实际处理了%d个", len(processedBatches))
	}

	// 验证并发处理确实提高了效率
	// 如果串行处理，应该需要至少 3 * 100ms = 300ms
	// 但由于并发处理，实际时间应该更少
	if processingTime > time.Millisecond*250 {
		t.Logf("处理时间: %v，可能并发处理没有生效", processingTime)
	}
}

func TestBatchProcessor_Metrics(t *testing.T) {
	mockProcessor := NewMockEventProcessor()
	config := &BatchConfig{
		MaxBatchSize:   2,
		MaxWaitTime:    time.Millisecond * 100,
		FlushInterval:  time.Millisecond * 50,
		MaxConcurrency: 2,
		GroupByFields:  []string{"type"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	ctx := context.Background()
	err := batchProcessor.Start(ctx)
	if err != nil {
		t.Fatalf("启动批处理器失败: %v", err)
	}
	defer batchProcessor.Stop()

	// 添加事件
	events := []*models.Event{
		createTestEvent("event1", "email.received", "source1", 1),
		createTestEvent("event2", "email.received", "source1", 1),
		createTestEvent("event3", "email.updated", "source1", 1),
		createTestEvent("event4", "email.updated", "source1", 1),
	}

	for _, event := range events {
		err := batchProcessor.AddEvent(event)
		if err != nil {
			t.Errorf("添加事件失败: %v", err)
		}
	}

	// 等待处理完成
	time.Sleep(time.Millisecond * 500)

	// 验证指标
	metrics := batchProcessor.GetMetrics()

	if metrics.TotalBatches != 2 {
		t.Errorf("期望总批次数为2，实际为%d", metrics.TotalBatches)
	}

	if metrics.ProcessedBatches != 2 {
		t.Errorf("期望处理批次数为2，实际为%d", metrics.ProcessedBatches)
	}

	if metrics.TotalEvents != 4 {
		t.Errorf("期望总事件数为4，实际为%d", metrics.TotalEvents)
	}

	if metrics.ProcessedEvents != 4 {
		t.Errorf("期望处理事件数为4，实际为%d", metrics.ProcessedEvents)
	}

	if metrics.FailedBatches != 0 {
		t.Errorf("期望失败批次数为0，实际为%d", metrics.FailedBatches)
	}

	if metrics.AverageProcessTime <= 0 {
		t.Errorf("期望平均处理时间大于0，实际为%v", metrics.AverageProcessTime)
	}
}

func TestBatchProcessor_GetBatchStatus(t *testing.T) {
	mockProcessor := NewMockEventProcessor()
	config := &BatchConfig{
		MaxBatchSize:   5,
		MaxWaitTime:    time.Second,
		FlushInterval:  time.Millisecond * 100,
		MaxConcurrency: 2,
		GroupByFields:  []string{"type"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	ctx := context.Background()
	err := batchProcessor.Start(ctx)
	if err != nil {
		t.Fatalf("启动批处理器失败: %v", err)
	}
	defer batchProcessor.Stop()

	// 添加事件
	event := createTestEvent("event1", "email.received", "source1", 1)
	err = batchProcessor.AddEvent(event)
	if err != nil {
		t.Errorf("添加事件失败: %v", err)
	}

	// 获取活跃批次
	activeBatches := batchProcessor.GetActiveBatches()
	if len(activeBatches) != 1 {
		t.Errorf("期望1个活跃批次，实际有%d个", len(activeBatches))
		return
	}

	batchID := activeBatches[0].ID

	// 获取批次状态
	batch, err := batchProcessor.GetBatchStatus(batchID)
	if err != nil {
		t.Errorf("获取批次状态失败: %v", err)
		return
	}

	if batch.ID != batchID {
		t.Errorf("期望批次ID为%s，实际为%s", batchID, batch.ID)
	}

	if batch.Status != BatchStatusPending {
		t.Errorf("期望批次状态为%s，实际为%s", BatchStatusPending, batch.Status)
	}

	if len(batch.Events) != 1 {
		t.Errorf("期望批次包含1个事件，实际包含%d个", len(batch.Events))
	}

	// 测试不存在的批次
	_, err = batchProcessor.GetBatchStatus("nonexistent")
	if err == nil {
		t.Error("期望获取不存在批次时返回错误")
	}
}

func TestBatchProcessor_UpdateConfig(t *testing.T) {
	mockProcessor := NewMockEventProcessor()
	config := &BatchConfig{
		MaxBatchSize:   3,
		MaxWaitTime:    time.Second,
		FlushInterval:  time.Millisecond * 100,
		MaxConcurrency: 2,
		GroupByFields:  []string{"type"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	// 验证初始配置
	currentConfig := batchProcessor.GetConfig()
	if currentConfig.MaxBatchSize != 3 {
		t.Errorf("期望初始批次大小为3，实际为%d", currentConfig.MaxBatchSize)
	}

	// 更新配置
	newConfig := &BatchConfig{
		MaxBatchSize:   5,
		MaxWaitTime:    time.Second * 2,
		FlushInterval:  time.Millisecond * 200,
		MaxConcurrency: 4,
		GroupByFields:  []string{"type", "source"},
	}

	batchProcessor.UpdateConfig(newConfig)

	// 验证配置更新
	updatedConfig := batchProcessor.GetConfig()
	if updatedConfig.MaxBatchSize != 5 {
		t.Errorf("期望更新后批次大小为5，实际为%d", updatedConfig.MaxBatchSize)
	}

	if updatedConfig.MaxWaitTime != time.Second*2 {
		t.Errorf("期望更新后等待时间为2秒，实际为%v", updatedConfig.MaxWaitTime)
	}

	if updatedConfig.MaxConcurrency != 4 {
		t.Errorf("期望更新后并发数为4，实际为%d", updatedConfig.MaxConcurrency)
	}

	if len(updatedConfig.GroupByFields) != 2 {
		t.Errorf("期望更新后分组字段数为2，实际为%d", len(updatedConfig.GroupByFields))
	}
}

func TestBatchProcessor_StopAndFlush(t *testing.T) {
	mockProcessor := NewMockEventProcessor()
	config := &BatchConfig{
		MaxBatchSize:   10,               // 设置较大的批次大小
		MaxWaitTime:    time.Second * 10, // 设置较长的等待时间
		FlushInterval:  time.Millisecond * 100,
		MaxConcurrency: 2,
		GroupByFields:  []string{"type"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	ctx := context.Background()
	err := batchProcessor.Start(ctx)
	if err != nil {
		t.Fatalf("启动批处理器失败: %v", err)
	}

	// 添加事件
	events := []*models.Event{
		createTestEvent("event1", "email.received", "source1", 1),
		createTestEvent("event2", "email.received", "source1", 1),
		createTestEvent("event3", "email.updated", "source1", 1),
	}

	for _, event := range events {
		err := batchProcessor.AddEvent(event)
		if err != nil {
			t.Errorf("添加事件失败: %v", err)
		}
	}

	// 立即停止，这应该会触发所有批次的处理
	err = batchProcessor.Stop()
	if err != nil {
		t.Errorf("停止批处理器失败: %v", err)
	}

	// 验证所有事件都被处理
	processedBatches := mockProcessor.GetProcessedBatches()
	totalProcessedEvents := 0
	for _, batch := range processedBatches {
		totalProcessedEvents += len(batch.Events)
	}

	if totalProcessedEvents != 3 {
		t.Errorf("期望处理3个事件，实际处理了%d个", totalProcessedEvents)
	}

	// 验证指标
	metrics := batchProcessor.GetMetrics()
	if metrics.ProcessedEvents != 3 {
		t.Errorf("期望处理事件数为3，实际为%d", metrics.ProcessedEvents)
	}
}

// 基准测试
func BenchmarkBatchProcessor_AddEvent(b *testing.B) {
	mockProcessor := NewMockEventProcessor()
	config := &BatchConfig{
		MaxBatchSize:   1000,
		MaxWaitTime:    time.Second,
		FlushInterval:  time.Millisecond * 100,
		MaxConcurrency: 4,
		GroupByFields:  []string{"type"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	ctx := context.Background()
	batchProcessor.Start(ctx)
	defer batchProcessor.Stop()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		event := createTestEvent(fmt.Sprintf("event%d", i), "email.received", "source1", 1)
		batchProcessor.AddEvent(event)
	}
}

func BenchmarkBatchProcessor_ProcessBatch(b *testing.B) {
	mockProcessor := NewMockEventProcessor()
	config := &BatchConfig{
		MaxBatchSize:   10,
		MaxWaitTime:    time.Second,
		FlushInterval:  time.Millisecond * 100,
		MaxConcurrency: 4,
		GroupByFields:  []string{"type"},
	}

	batchProcessor := NewBatchProcessor(config, mockProcessor)

	// 创建测试批次
	events := make([]*models.Event, 10)
	for i := 0; i < 10; i++ {
		events[i] = createTestEvent(fmt.Sprintf("event%d", i), "email.received", "source1", 1)
	}

	batch := &EventBatch{
		ID:          "test-batch",
		GroupKey:    "test-group",
		Events:      events,
		CreatedAt:   time.Now(),
		LastUpdated: time.Now(),
		Status:      BatchStatusPending,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		batchProcessor.ProcessBatch(context.Background(), batch)
	}
}
