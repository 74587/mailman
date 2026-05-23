package core

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mailman/internal/triggerv2/models"
)

// MockEventHandler 模拟事件处理器
type MockEventHandler struct {
	name            string
	priority        int
	handleFunc      func(ctx context.Context, event *models.Event) error
	canHandleFunc   func(event *models.Event) bool
	processedEvents []*models.Event
	processingDelay time.Duration
	shouldFail      bool
	mu              sync.RWMutex
}

func NewMockEventHandler(name string) *MockEventHandler {
	return &MockEventHandler{
		name:            name,
		priority:        5,
		processedEvents: make([]*models.Event, 0),
		canHandleFunc:   func(event *models.Event) bool { return true },
		handleFunc:      nil,
	}
}

func (h *MockEventHandler) Handle(ctx context.Context, event *models.Event) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.processingDelay > 0 {
		time.Sleep(h.processingDelay)
	}

	if h.shouldFail {
		return fmt.Errorf("模拟处理器错误")
	}

	h.processedEvents = append(h.processedEvents, event)

	if h.handleFunc != nil {
		return h.handleFunc(ctx, event)
	}

	return nil
}

func (h *MockEventHandler) CanHandle(event *models.Event) bool {
	return h.canHandleFunc(event)
}

func (h *MockEventHandler) GetName() string {
	return h.name
}

func (h *MockEventHandler) GetPriority() int {
	return h.priority
}

func (h *MockEventHandler) GetProcessedEvents() []*models.Event {
	h.mu.RLock()
	defer h.mu.RUnlock()

	events := make([]*models.Event, len(h.processedEvents))
	copy(events, h.processedEvents)
	return events
}

func (h *MockEventHandler) GetProcessedCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.processedEvents)
}

func (h *MockEventHandler) SetShouldFail(shouldFail bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.shouldFail = shouldFail
}

func (h *MockEventHandler) SetProcessingDelay(delay time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.processingDelay = delay
}

func (h *MockEventHandler) SetCanHandleFunc(fn func(event *models.Event) bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.canHandleFunc = fn
}

func (h *MockEventHandler) SetHandleFunc(fn func(ctx context.Context, event *models.Event) error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.handleFunc = fn
}

func (h *MockEventHandler) Reset() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.processedEvents = make([]*models.Event, 0)
	h.shouldFail = false
	h.processingDelay = 0
}

// MockEventFilter 模拟事件过滤器
type MockEventFilter struct {
	name       string
	filterFunc func(event *models.Event) bool
}

func NewMockEventFilter(name string, filterFunc func(event *models.Event) bool) *MockEventFilter {
	return &MockEventFilter{
		name:       name,
		filterFunc: filterFunc,
	}
}

func (f *MockEventFilter) Filter(event *models.Event) bool {
	if f.filterFunc != nil {
		return f.filterFunc(event)
	}
	return true
}

func (f *MockEventFilter) GetName() string {
	return f.name
}

func TestNewInMemoryEventBus(t *testing.T) {
	// 使用默认配置
	bus := NewInMemoryEventBus(nil)
	require.NotNil(t, bus)

	// 使用自定义配置
	config := &EventBusConfig{
		WorkerCount:         5,
		QueueSize:           100,
		MaxRetries:          2,
		RetryDelay:          500 * time.Millisecond,
		ProcessTimeout:      10 * time.Second,
		HealthCheckInterval: 5 * time.Second,
		EnableMetrics:       true,
	}

	bus = NewInMemoryEventBus(config)
	require.NotNil(t, bus)

	inMemoryBus := bus.(*InMemoryEventBus)
	assert.Equal(t, config.WorkerCount, inMemoryBus.config.WorkerCount)
	assert.Equal(t, config.QueueSize, inMemoryBus.config.QueueSize)
	assert.Equal(t, config.MaxRetries, inMemoryBus.config.MaxRetries)
}

func TestEventBus_StartStop(t *testing.T) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	// 启动事件总线
	err := bus.Start(ctx)
	assert.NoError(t, err)

	// 验证健康状态
	health := bus.GetHealth()
	assert.Equal(t, "running", health.Status)
	assert.True(t, health.IsRunning)
	assert.Equal(t, 10, health.ActiveWorkers) // 默认工作器数量

	// 重复启动应该失败
	err = bus.Start(ctx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "已经在运行")

	// 停止事件总线
	stopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	err = bus.Stop(stopCtx)
	assert.NoError(t, err)

	// 验证健康状态
	health = bus.GetHealth()
	assert.Equal(t, "stopped", health.Status)
	assert.False(t, health.IsRunning)
	assert.Equal(t, 0, health.ActiveWorkers)

	// 重复停止应该失败
	err = bus.Stop(stopCtx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "没有在运行")
}

func TestEventBus_PublishSubscribe(t *testing.T) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	// 启动事件总线
	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	// 创建模拟处理器
	handler := NewMockEventHandler("test-handler")

	// 订阅事件
	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	assert.NoError(t, err)

	// 创建测试事件
	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"test-subject",
		models.EmailEventData{
			EmailID:   123,
			AccountID: 456,
			Subject:   "Test Email",
		},
	)
	require.NoError(t, err)

	// 发布事件
	err = bus.Publish(ctx, event)
	assert.NoError(t, err)

	// 等待事件处理
	time.Sleep(100 * time.Millisecond)

	// 验证事件被处理
	processedEvents := handler.GetProcessedEvents()
	assert.Len(t, processedEvents, 1)
	assert.Equal(t, event.ID, processedEvents[0].ID)
	assert.Equal(t, models.EventStatusCompleted, processedEvents[0].Status)

	// 验证统计信息
	stats := bus.GetStats()
	assert.Equal(t, int64(1), stats.TotalEvents)
	assert.Equal(t, int64(1), stats.ProcessedEvents)
	assert.Equal(t, int64(0), stats.FailedEvents)
	assert.Equal(t, int64(1), stats.EventsByType[models.EventTypeEmailReceived])
}

func TestEventBus_PublishAsync(t *testing.T) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("async-handler")
	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	require.NoError(t, err)

	// 创建测试事件
	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"test-subject",
		"test-data",
	)
	require.NoError(t, err)

	// 异步发布事件
	err = bus.PublishAsync(ctx, event)
	assert.NoError(t, err)

	// 等待事件处理
	time.Sleep(100 * time.Millisecond)

	// 验证事件被处理
	assert.Equal(t, 1, handler.GetProcessedCount())
}

func TestEventBus_MultipleHandlers(t *testing.T) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	// 创建多个处理器
	handler1 := NewMockEventHandler("handler-1")
	handler2 := NewMockEventHandler("handler-2")
	handler3 := NewMockEventHandler("handler-3")

	// 订阅同一事件类型
	err = bus.Subscribe(models.EventTypeEmailReceived, handler1)
	require.NoError(t, err)
	err = bus.Subscribe(models.EventTypeEmailReceived, handler2)
	require.NoError(t, err)
	err = bus.Subscribe(models.EventTypeEmailReceived, handler3)
	require.NoError(t, err)

	// 发布事件
	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"test-subject",
		"test-data",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event)
	assert.NoError(t, err)

	// 等待事件处理
	time.Sleep(100 * time.Millisecond)

	// 验证所有处理器都处理了事件
	assert.Equal(t, 1, handler1.GetProcessedCount())
	assert.Equal(t, 1, handler2.GetProcessedCount())
	assert.Equal(t, 1, handler3.GetProcessedCount())
}

func TestEventBus_EventFilter(t *testing.T) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("filtered-handler")

	// 创建过滤器，只处理特定主题的事件
	filter := NewMockEventFilter("subject-filter", func(event *models.Event) bool {
		return event.Subject == "important"
	})

	// 带过滤器订阅
	err = bus.SubscribeWithFilter(models.EventTypeEmailReceived, handler, filter)
	require.NoError(t, err)

	// 发布符合过滤器条件的事件
	event1, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"important",
		"test-data",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event1)
	assert.NoError(t, err)

	// 发布不符合过滤器条件的事件
	event2, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"normal",
		"test-data",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event2)
	assert.NoError(t, err)

	// 等待事件处理
	time.Sleep(100 * time.Millisecond)

	// 验证只有符合过滤器条件的事件被处理
	assert.Equal(t, 1, handler.GetProcessedCount())
	processedEvents := handler.GetProcessedEvents()
	assert.Equal(t, "important", processedEvents[0].Subject)
}

func TestEventBus_HandlerCanHandle(t *testing.T) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("selective-handler")

	// 设置处理器只能处理特定类型的事件
	handler.SetCanHandleFunc(func(event *models.Event) bool {
		return event.Type == models.EventTypeEmailReceived
	})

	// 订阅多个事件类型
	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	require.NoError(t, err)
	err = bus.Subscribe(models.EventTypeEmailUpdated, handler)
	require.NoError(t, err)

	// 发布处理器可以处理的事件
	event1, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"test-subject",
		"test-data",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event1)
	assert.NoError(t, err)

	// 发布处理器不能处理的事件
	event2, err := models.NewEvent(
		models.EventTypeEmailUpdated,
		"test-source",
		"test-subject",
		"test-data",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event2)
	assert.NoError(t, err)

	// 等待事件处理
	time.Sleep(100 * time.Millisecond)

	// 验证只有处理器能处理的事件被处理
	assert.Equal(t, 1, handler.GetProcessedCount())
	processedEvents := handler.GetProcessedEvents()
	assert.Equal(t, models.EventTypeEmailReceived, processedEvents[0].Type)
}

func TestEventBus_RetryMechanism(t *testing.T) {
	config := &EventBusConfig{
		WorkerCount:         1,
		QueueSize:           10,
		MaxRetries:          2,
		RetryDelay:          10 * time.Millisecond,
		RetryBackoff:        1.0,
		ProcessTimeout:      1 * time.Second,
		HealthCheckInterval: 0, // 禁用健康检查
	}

	bus := NewInMemoryEventBus(config)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("retry-handler")

	// 设置处理器失败计数
	var attemptCount int32
	handler.SetHandleFunc(func(ctx context.Context, event *models.Event) error {
		count := atomic.AddInt32(&attemptCount, 1)
		if count <= 2 {
			return errors.New("模拟失败")
		}
		return nil
	})

	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	require.NoError(t, err)

	// 发布事件
	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"test-subject",
		"test-data",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event)
	assert.NoError(t, err)

	// 等待重试完成
	time.Sleep(200 * time.Millisecond)

	// 验证重试机制
	assert.Equal(t, int32(3), atomic.LoadInt32(&attemptCount)) // 原始尝试 + 2次重试
	assert.Equal(t, int32(3), int32(handler.GetProcessedCount())) // 处理器被调用3次
}

func TestEventBus_MaxRetriesExceeded(t *testing.T) {
	config := &EventBusConfig{
		WorkerCount:         1,
		QueueSize:           10,
		MaxRetries:          2,
		RetryDelay:          10 * time.Millisecond,
		RetryBackoff:        1.0,
		ProcessTimeout:      1 * time.Second,
		HealthCheckInterval: 0,
	}

	bus := NewInMemoryEventBus(config)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("failing-handler")
	handler.SetShouldFail(true) // 总是失败

	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	require.NoError(t, err)

	// 发布事件
	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"test-subject",
		"test-data",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event)
	assert.NoError(t, err)

	// 等待重试完成
	time.Sleep(200 * time.Millisecond)

	// 验证统计信息
	stats := bus.GetStats()
	assert.Equal(t, int64(1), stats.TotalEvents)
	assert.Equal(t, int64(0), stats.ProcessedEvents)
	assert.Equal(t, int64(1), stats.FailedEvents)
}

func TestEventBus_Unsubscribe(t *testing.T) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("unsubscribe-handler")

	// 订阅事件
	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	require.NoError(t, err)

	// 发布事件
	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"test-subject",
		"test-data",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event)
	assert.NoError(t, err)

	time.Sleep(50 * time.Millisecond)
	assert.Equal(t, 1, handler.GetProcessedCount())

	// 取消订阅
	err = bus.Unsubscribe(models.EventTypeEmailReceived, handler.GetName())
	assert.NoError(t, err)

	// 再次发布事件
	event2, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"test-subject",
		"test-data2",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event2)
	assert.NoError(t, err)

	time.Sleep(50 * time.Millisecond)

	// 验证取消订阅后事件不再被处理
	assert.Equal(t, 1, handler.GetProcessedCount())
}

func TestEventBus_ConcurrentPublish(t *testing.T) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("concurrent-handler")
	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	require.NoError(t, err)

	// 并发发布多个事件
	numEvents := 100
	var wg sync.WaitGroup

	for i := 0; i < numEvents; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()

			event, err := models.NewEvent(
				models.EventTypeEmailReceived,
				"test-source",
				fmt.Sprintf("test-subject-%d", index),
				fmt.Sprintf("test-data-%d", index),
			)
			if err != nil {
				t.Errorf("创建事件失败: %v", err)
				return
			}

			err = bus.Publish(ctx, event)
			if err != nil {
				t.Errorf("发布事件失败: %v", err)
			}
		}(i)
	}

	wg.Wait()

	// 等待所有事件处理完成
	time.Sleep(500 * time.Millisecond)

	// 验证所有事件都被处理
	assert.Equal(t, numEvents, handler.GetProcessedCount())

	// 验证统计信息
	stats := bus.GetStats()
	assert.Equal(t, int64(numEvents), stats.TotalEvents)
	assert.Equal(t, int64(numEvents), stats.ProcessedEvents)
	assert.Equal(t, int64(0), stats.FailedEvents)
}

func TestEventBus_QueueFull(t *testing.T) {
	config := &EventBusConfig{
		WorkerCount:         0, // 没有工作器处理事件
		QueueSize:           2,
		MaxRetries:          0,
		ProcessTimeout:      1 * time.Second,
		HealthCheckInterval: 0,
	}

	bus := NewInMemoryEventBus(config)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	// 填满队列
	for i := 0; i < config.QueueSize; i++ {
		event, err := models.NewEvent(
			models.EventTypeEmailReceived,
			"test-source",
			fmt.Sprintf("test-subject-%d", i),
			fmt.Sprintf("test-data-%d", i),
		)
		require.NoError(t, err)

		err = bus.PublishAsync(ctx, event)
		assert.NoError(t, err)
	}

	// 尝试发布更多事件应该失败
	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"overflow-subject",
		"overflow-data",
	)
	require.NoError(t, err)

	err = bus.PublishAsync(ctx, event)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "队列已满")
}

func TestEventBus_HealthCheck(t *testing.T) {
	config := &EventBusConfig{
		WorkerCount:         2,
		QueueSize:           10,
		MaxRetries:          3,
		ProcessTimeout:      1 * time.Second,
		HealthCheckInterval: 50 * time.Millisecond,
	}

	bus := NewInMemoryEventBus(config)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	// 等待健康检查运行
	time.Sleep(100 * time.Millisecond)

	health := bus.GetHealth()
	assert.Equal(t, "healthy", health.Status)
	assert.True(t, health.IsRunning)
	assert.Equal(t, 2, health.ActiveWorkers)
	assert.Equal(t, 0, health.QueueSize)
	assert.Equal(t, 0.0, health.ErrorRate)
	assert.Empty(t, health.Issues)
}

func TestEventBus_ProcessTimeout(t *testing.T) {
	config := &EventBusConfig{
		WorkerCount:         1,
		QueueSize:           10,
		MaxRetries:          0,
		ProcessTimeout:      50 * time.Millisecond,
		HealthCheckInterval: 0,
	}

	bus := NewInMemoryEventBus(config)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(t, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("slow-handler")
	handler.SetProcessingDelay(100 * time.Millisecond) // 超过超时时间

	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	require.NoError(t, err)

	// 发布事件
	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"test-source",
		"test-subject",
		"test-data",
	)
	require.NoError(t, err)

	err = bus.Publish(ctx, event)
	assert.NoError(t, err)

	// 等待处理完成
	time.Sleep(200 * time.Millisecond)

	// 验证处理器仍然被调用，但可能被上下文取消
	// 这里主要验证系统不会崩溃
	stats := bus.GetStats()
	assert.Equal(t, int64(1), stats.TotalEvents)
}

// 基准测试
func BenchmarkEventBus_Publish(b *testing.B) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(b, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("benchmark-handler")
	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	require.NoError(b, err)

	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"benchmark-source",
		"benchmark-subject",
		"benchmark-data",
	)
	require.NoError(b, err)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		err = bus.Publish(ctx, event)
		if err != nil {
			b.Fatal(err)
		}
	}

	// 等待所有事件处理完成
	time.Sleep(100 * time.Millisecond)
}

func BenchmarkEventBus_PublishAsync(b *testing.B) {
	bus := NewInMemoryEventBus(nil)
	ctx := context.Background()

	err := bus.Start(ctx)
	require.NoError(b, err)
	defer bus.Stop(ctx)

	handler := NewMockEventHandler("benchmark-handler")
	err = bus.Subscribe(models.EventTypeEmailReceived, handler)
	require.NoError(b, err)

	event, err := models.NewEvent(
		models.EventTypeEmailReceived,
		"benchmark-source",
		"benchmark-subject",
		"benchmark-data",
	)
	require.NoError(b, err)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		err = bus.PublishAsync(ctx, event)
		if err != nil {
			b.Fatal(err)
		}
	}

	// 等待所有事件处理完成
	time.Sleep(100 * time.Millisecond)
}
