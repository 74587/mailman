package performance

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"mailman/internal/triggerv2/core"
	"mailman/internal/triggerv2/models"
)

// PerformanceTestSuite 性能测试套件
type PerformanceTestSuite struct {
	eventBus     core.EventBus
	executorPool core.ExecutorPool
	taskQueue    core.TaskQueue
	scheduler    core.Scheduler

	// 清理函数
	cleanupFuncs []func()
}

// createJSONData 创建JSON数据
func createJSONData(data map[string]interface{}) json.RawMessage {
	bytes, _ := json.Marshal(data)
	return json.RawMessage(bytes)
}

// SimpleTask 简单任务实现
type SimpleTask struct {
	ID       string
	Type     string
	ExecFunc func(ctx context.Context) error
}

func (t *SimpleTask) Execute(ctx context.Context) error {
	if t.ExecFunc != nil {
		return t.ExecFunc(ctx)
	}
	return nil
}

func (t *SimpleTask) GetID() string {
	return t.ID
}

func (t *SimpleTask) GetType() string {
	return t.Type
}

func (t *SimpleTask) GetPriority() int {
	return 1
}

func (t *SimpleTask) GetCreatedAt() time.Time {
	return time.Now()
}

func (t *SimpleTask) GetRetryCount() int {
	return 0
}

func (t *SimpleTask) IncrementRetry() {}

func (t *SimpleTask) CanRetry() bool {
	return false
}

func (t *SimpleTask) GetMaxRetries() int {
	return 0
}

func (t *SimpleTask) SetError(err error) {}

func (t *SimpleTask) GetError() error {
	return nil
}

// setupPerformanceTest 设置性能测试环境
func setupPerformanceTest(b *testing.B) *PerformanceTestSuite {
	suite := &PerformanceTestSuite{
		cleanupFuncs: make([]func(), 0),
	}

	// 创建事件总线
	eventBusConfig := &core.EventBusConfig{
		WorkerCount:    10,
		QueueSize:      10000,
		ProcessTimeout: 30 * time.Second,
	}
	eventBus := core.NewInMemoryEventBus(eventBusConfig)
	suite.eventBus = eventBus

	// 创建执行器池
	poolConfig := &core.PoolConfig{
		PoolSize:  100,
		QueueSize: 1000,
	}
	executorPool := core.NewWorkerExecutorPool(poolConfig)
	suite.executorPool = executorPool
	suite.cleanupFuncs = append(suite.cleanupFuncs, func() {
		executorPool.Stop(context.Background())
	})

	// 创建任务队列
	queueConfig := &core.QueueConfig{
		MaxSize:      1000,
		MaxScheduled: 500,
	}
	taskQueue := core.NewPriorityTaskQueue(queueConfig)
	suite.taskQueue = taskQueue

	// 创建调度器
	schedulerConfig := &core.SchedulerConfig{
		MaxConcurrency:    1000,
		ProcessingTimeout: 10 * time.Second,
	}
	scheduler := core.NewTriggerV2Scheduler(schedulerConfig)
	suite.scheduler = scheduler
	suite.cleanupFuncs = append(suite.cleanupFuncs, func() {
		scheduler.Stop(context.Background())
	})

	return suite
}

// cleanup 清理测试资源
func (s *PerformanceTestSuite) cleanup() {
	for i := len(s.cleanupFuncs) - 1; i >= 0; i-- {
		s.cleanupFuncs[i]()
	}
}

// BenchmarkEventBusPublish 测试事件总线发布性能
func BenchmarkEventBusPublish(b *testing.B) {
	suite := setupPerformanceTest(b)
	defer suite.cleanup()

	ctx := context.Background()

	// 创建测试事件
	event := &models.Event{
		ID:     "bench-event",
		Type:   "benchmark.test",
		Source: "performance-test",
		Data: createJSONData(map[string]interface{}{
			"benchmark": true,
			"value":     42,
		}),
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			event.ID = fmt.Sprintf("bench-event-%d", b.N)
			suite.eventBus.Publish(ctx, event)
		}
	})
}

// BenchmarkSchedulerProcessing 测试调度器处理性能
func BenchmarkSchedulerProcessing(b *testing.B) {
	suite := setupPerformanceTest(b)
	defer suite.cleanup()

	ctx := context.Background()

	// 启动调度器
	err := suite.scheduler.Start(ctx)
	if err != nil {
		b.Fatalf("Failed to start scheduler: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		event := &models.Event{
			ID:     fmt.Sprintf("test-event-%d", i),
			Type:   "test.event",
			Source: "benchmark",
			Data: createJSONData(map[string]interface{}{
				"iteration": i,
			}),
		}

		err := suite.scheduler.ProcessEvent(event)
		if err != nil {
			b.Fatalf("Failed to process event: %v", err)
		}
	}
}

// BenchmarkTaskQueueProcessing 测试任务队列处理性能
func BenchmarkTaskQueueProcessing(b *testing.B) {
	suite := setupPerformanceTest(b)
	defer suite.cleanup()

	ctx := context.Background()

	// 启动任务队列
	err := suite.taskQueue.Start(ctx)
	if err != nil {
		b.Fatalf("Failed to start task queue: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		task := &SimpleTask{
			ID:   fmt.Sprintf("bench-task-%d", i),
			Type: "benchmark",
			ExecFunc: func(ctx context.Context) error {
				// 模拟一些工作
				time.Sleep(time.Microsecond)
				return nil
			},
		}

		queuedTask := &core.QueuedTask{
			Task:     task,
			Priority: core.NormalPriority,
		}

		err := suite.taskQueue.Push(queuedTask)
		if err != nil {
			b.Fatalf("Failed to push task: %v", err)
		}
	}
}

// BenchmarkExecutorPoolExecution 测试执行器池执行性能
func BenchmarkExecutorPoolExecution(b *testing.B) {
	suite := setupPerformanceTest(b)
	defer suite.cleanup()

	ctx := context.Background()

	// 启动执行器池
	err := suite.executorPool.Start(ctx)
	if err != nil {
		b.Fatalf("Failed to start executor pool: %v", err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		task := &SimpleTask{
			ID:   fmt.Sprintf("bench-task-%d", i),
			Type: "benchmark",
			ExecFunc: func(ctx context.Context) error {
				// 模拟一些工作
				return nil
			},
		}

		err := suite.executorPool.Submit(task)
		if err != nil {
			b.Fatalf("Failed to submit task: %v", err)
		}
	}
}
