package core

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"mailman/internal/triggerv2/models"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 帮助函数：创建json.RawMessage
func createJSONData(data interface{}) json.RawMessage {
	bytes, _ := json.Marshal(data)
	return json.RawMessage(bytes)
}

// TestNewTriggerV2Scheduler 测试创建调度器
func TestNewTriggerV2Scheduler(t *testing.T) {
	tests := []struct {
		name   string
		config *SchedulerConfig
		want   *SchedulerConfig
	}{
		{
			name:   "使用默认配置",
			config: nil,
			want:   DefaultSchedulerConfig(),
		},
		{
			name: "使用自定义配置",
			config: &SchedulerConfig{
				MaxConcurrency:      50,
				EventBufferSize:     5000,
				ProcessingTimeout:   15 * time.Second,
				StatsInterval:       60 * time.Second,
				HealthCheckInterval: 30 * time.Second,
			},
			want: &SchedulerConfig{
				MaxConcurrency:      50,
				EventBufferSize:     5000,
				ProcessingTimeout:   15 * time.Second,
				StatsInterval:       60 * time.Second,
				HealthCheckInterval: 30 * time.Second,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scheduler := NewTriggerV2Scheduler(tt.config)
			assert.NotNil(t, scheduler)

			triggerScheduler := scheduler.(*TriggerV2Scheduler)
			if tt.config == nil {
				assert.Equal(t, tt.want.MaxConcurrency, triggerScheduler.config.MaxConcurrency)
				assert.Equal(t, tt.want.EventBufferSize, triggerScheduler.config.EventBufferSize)
			} else {
				assert.Equal(t, tt.want.MaxConcurrency, triggerScheduler.config.MaxConcurrency)
				assert.Equal(t, tt.want.EventBufferSize, triggerScheduler.config.EventBufferSize)
			}
		})
	}
}

// TestSchedulerStartStop 测试调度器启动和停止
func TestSchedulerStartStop(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0, // 禁用统计更新
		HealthCheckInterval: 0, // 禁用健康检查
		MetricsInterval:     0, // 禁用指标收集
		GCInterval:          0, // 禁用垃圾回收
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	// 测试初始状态
	assert.Equal(t, SchedulerStopped, scheduler.GetStatus())
	assert.False(t, scheduler.IsRunning())

	// 测试启动
	err := scheduler.Start(ctx)
	assert.NoError(t, err)
	assert.Equal(t, SchedulerRunning, scheduler.GetStatus())
	assert.True(t, scheduler.IsRunning())

	// 测试重复启动
	err = scheduler.Start(ctx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "已经在运行")

	// 测试停止
	stopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err = scheduler.Stop(stopCtx)
	assert.NoError(t, err)
	assert.Equal(t, SchedulerStopped, scheduler.GetStatus())
	assert.False(t, scheduler.IsRunning())

	// 测试重复停止
	err = scheduler.Stop(stopCtx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "没有在运行")
}

// TestSchedulerRestart 测试调度器重启
func TestSchedulerRestart(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	// 启动调度器
	err := scheduler.Start(ctx)
	require.NoError(t, err)
	assert.True(t, scheduler.IsRunning())

	// 重启调度器
	err = scheduler.Restart(ctx)
	assert.NoError(t, err)
	assert.True(t, scheduler.IsRunning())

	// 清理
	scheduler.Stop(ctx)
}

// TestSchedulerProcessEvent 测试事件处理
func TestSchedulerProcessEvent(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(t, err)
	defer scheduler.Stop(ctx)

	// 创建测试事件
	eventData := map[string]interface{}{
		"subject": "Test Email",
		"from":    "test@example.com",
	}
	dataBytes, _ := json.Marshal(eventData)

	event := &models.Event{
		ID:   "test-event-1",
		Type: "email.received",
		Data: json.RawMessage(dataBytes),
	}

	// 测试处理单个事件
	err = scheduler.ProcessEvent(event)
	assert.NoError(t, err)

	// 测试处理空事件
	err = scheduler.ProcessEvent(nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "事件不能为空")

	// 等待事件处理完成
	time.Sleep(100 * time.Millisecond)

	// 验证统计信息
	stats := scheduler.GetStats()
	assert.Equal(t, int64(1), stats.TotalEvents)
	assert.GreaterOrEqual(t, stats.ProcessedEvents, int64(0))
}

// TestSchedulerProcessEvents 测试批量事件处理
func TestSchedulerProcessEvents(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(t, err)
	defer scheduler.Stop(ctx)

	// 创建测试事件
	events := []*models.Event{
		{
			ID:   "test-event-1",
			Type: "email.received",
			Data: createJSONData(map[string]interface{}{"subject": "Test Email 1"}),
		},
		{
			ID:   "test-event-2",
			Type: "email.received",
			Data: createJSONData(map[string]interface{}{"subject": "Test Email 2"}),
		},
		{
			ID:   "test-event-3",
			Type: "email.received",
			Data: createJSONData(map[string]interface{}{"subject": "Test Email 3"}),
		},
	}

	// 测试批量处理事件
	err = scheduler.ProcessEvents(events)
	assert.NoError(t, err)

	// 等待事件处理完成
	time.Sleep(200 * time.Millisecond)

	// 验证统计信息
	stats := scheduler.GetStats()
	assert.Equal(t, int64(3), stats.TotalEvents)
}

// TestSchedulerTriggerManagement 测试触发器管理
func TestSchedulerTriggerManagement(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(t, err)
	defer scheduler.Stop(ctx)

	// 创建测试触发器
	trigger := &models.TriggerV2{
		ID:          1,
		Name:        "Test Trigger",
		Description: "Test trigger description",
		Status:      models.TriggerV2StatusActive,
		Priority:    models.TriggerV2PriorityNormal,
		Condition: models.ConditionConfig{
			Type:   models.ConditionTypePlugin,
			Plugin: "email_filter",
		},
		Actions: []models.ActionConfig{
			{
				Type:   models.ActionTypePlugin,
				Name:   "Send Notification",
				Plugin: "notification",
				Config: map[string]interface{}{
					"message": "New email received",
				},
				Enabled: true,
			},
		},
	}

	// 测试注册触发器
	err = scheduler.RegisterTrigger(trigger)
	assert.NoError(t, err)

	// 测试获取触发器
	retrievedTrigger, err := scheduler.GetTrigger(1)
	assert.NoError(t, err)
	assert.Equal(t, trigger.ID, retrievedTrigger.ID)
	assert.Equal(t, trigger.Name, retrievedTrigger.Name)

	// 测试列出触发器
	triggers, err := scheduler.ListTriggers()
	assert.NoError(t, err)
	assert.Len(t, triggers, 1)
	assert.Equal(t, trigger.ID, triggers[0].ID)

	// 测试更新触发器
	trigger.Description = "Updated description"
	err = scheduler.UpdateTrigger(trigger)
	assert.NoError(t, err)

	retrievedTrigger, err = scheduler.GetTrigger(1)
	assert.NoError(t, err)
	assert.Equal(t, "Updated description", retrievedTrigger.Description)

	// 测试注销触发器
	err = scheduler.UnregisterTrigger(1)
	assert.NoError(t, err)

	_, err = scheduler.GetTrigger(1)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "不存在")

	// 测试注册空触发器
	err = scheduler.RegisterTrigger(nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "触发器不能为空")
}

// TestSchedulerSubmitTask 测试任务提交
func TestSchedulerSubmitTask(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(t, err)
	defer scheduler.Stop(ctx)

	// 创建测试任务
	task := &TriggerTask{
		TriggerID: 1,
		Event: &models.Event{
			ID:   "test-event",
			Type: "email.received",
		},
		Actions: []models.ActionConfig{
			{
				Type:   models.ActionTypePlugin,
				Name:   "Test Action",
				Plugin: "test",
				Config: map[string]interface{}{
					"message": "Test message",
				},
				Enabled: true,
			},
		},
	}

	// 测试提交任务
	err = scheduler.SubmitTask(task)
	assert.NoError(t, err)

	// 等待任务执行
	time.Sleep(200 * time.Millisecond)

	// 验证统计信息
	stats := scheduler.GetStats()
	assert.Equal(t, int64(1), stats.TotalTasks)
	assert.GreaterOrEqual(t, stats.CompletedTasks, int64(0))

	// 测试提交空任务
	err = scheduler.SubmitTask(nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "任务不能为空")
}

// TestSchedulerStats 测试统计信息
func TestSchedulerStats(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(t, err)
	defer scheduler.Stop(ctx)

	// 注册一些触发器
	for i := 1; i <= 3; i++ {
		trigger := &models.TriggerV2{
			ID:     uint(i),
			Name:   fmt.Sprintf("Test Trigger %d", i),
			Status: models.TriggerV2StatusActive,
		}
		err = scheduler.RegisterTrigger(trigger)
		assert.NoError(t, err)
	}

	// 处理一些事件
	for i := 1; i <= 5; i++ {
		event := &models.Event{
			ID:   fmt.Sprintf("test-event-%d", i),
			Type: "email.received",
		}
		err = scheduler.ProcessEvent(event)
		assert.NoError(t, err)
	}

	// 等待处理完成
	time.Sleep(100 * time.Millisecond)

	// 获取统计信息
	stats := scheduler.GetStats()
	assert.NotNil(t, stats)
	assert.Equal(t, SchedulerRunning, stats.Status)
	assert.Equal(t, int64(5), stats.TotalEvents)
	assert.Equal(t, 3, stats.RegisteredTriggers)
	assert.Equal(t, 3, stats.ActiveTriggers)
	assert.True(t, stats.Uptime > 0)
	assert.NotNil(t, stats.StartTime)
	assert.NotNil(t, stats.LastUpdated)
}

// TestSchedulerHealth 测试健康检查
func TestSchedulerHealth(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	// 测试停止状态的健康检查
	health := scheduler.GetHealth()
	assert.NotNil(t, health)
	assert.Equal(t, "stopped", health.Status)
	assert.False(t, health.IsHealthy)

	// 启动调度器
	err := scheduler.Start(ctx)
	require.NoError(t, err)
	defer scheduler.Stop(ctx)

	// 测试运行状态的健康检查
	health = scheduler.GetHealth()
	assert.NotNil(t, health)
	assert.Equal(t, "healthy", health.Status)
	assert.True(t, health.IsHealthy)
	assert.NotNil(t, health.ComponentHealth)
	assert.NotNil(t, health.LastCheck)
	assert.Len(t, health.Issues, 0)
}

// TestSchedulerMetrics 测试指标收集
func TestSchedulerMetrics(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(t, err)
	defer scheduler.Stop(ctx)

	// 处理一些事件
	for i := 1; i <= 3; i++ {
		event := &models.Event{
			ID:   fmt.Sprintf("metric-event-%d", i),
			Type: "email.received",
		}
		err = scheduler.ProcessEvent(event)
		assert.NoError(t, err)
	}

	// 等待处理完成
	time.Sleep(100 * time.Millisecond)

	// 获取指标
	metrics := scheduler.GetMetrics()
	assert.NotNil(t, metrics)
	assert.Equal(t, int64(3), metrics.EventsReceived)
	assert.GreaterOrEqual(t, metrics.EventsProcessed, int64(0))
	assert.NotNil(t, metrics.ErrorsByType)
	assert.NotNil(t, metrics.ErrorsByComponent)
	assert.NotNil(t, metrics.CollectedAt)
}

// TestSchedulerConcurrency 测试并发处理
func TestSchedulerConcurrency(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      20,
		EventBufferSize:     1000,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(t, err)
	defer scheduler.Stop(ctx)

	// 并发处理事件
	numGoroutines := 5
	eventsPerGoroutine := 20
	var wg sync.WaitGroup

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()

			for j := 0; j < eventsPerGoroutine; j++ {
				event := &models.Event{
					ID:   fmt.Sprintf("concurrent-event-%d-%d", goroutineID, j),
					Type: "email.received",
					Data: createJSONData(map[string]interface{}{
						"goroutine": goroutineID,
						"sequence":  j,
					}),
				}

				err := scheduler.ProcessEvent(event)
				assert.NoError(t, err)
			}
		}(i)
	}

	wg.Wait()

	// 等待所有事件处理完成
	time.Sleep(500 * time.Millisecond)

	// 验证统计信息
	stats := scheduler.GetStats()
	expectedEvents := int64(numGoroutines * eventsPerGoroutine)
	assert.Equal(t, expectedEvents, stats.TotalEvents)

	// 验证健康状态
	health := scheduler.GetHealth()
	assert.True(t, health.IsHealthy)
}

// TestSchedulerStoppedOperations 测试停止后的操作
func TestSchedulerStoppedOperations(t *testing.T) {
	config := &SchedulerConfig{
		MaxConcurrency:      10,
		EventBufferSize:     100,
		ProcessingTimeout:   5 * time.Second,
		ShutdownTimeout:     10 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(t, err)

	// 停止调度器
	err = scheduler.Stop(ctx)
	assert.NoError(t, err)

	// 尝试在停止后进行操作
	event := &models.Event{
		ID:   "test-event",
		Type: "email.received",
	}

	err = scheduler.ProcessEvent(event)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "调度器没有运行")

	task := &TriggerTask{
		TriggerID: 1,
		Event:     event,
	}

	err = scheduler.SubmitTask(task)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "调度器没有运行")

	err = scheduler.CancelTask("test-task")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "调度器没有运行")
}

// TestTriggerTask 测试触发器任务
func TestTriggerTask(t *testing.T) {
	event := &models.Event{
		ID:   "test-event",
		Type: "email.received",
		Data: createJSONData(map[string]interface{}{
			"subject": "Test Email",
		}),
	}

	actions := []models.ActionConfig{
		{
			Type:   models.ActionTypePlugin,
			Name:   "Test Action 1",
			Plugin: "test1",
			Config: map[string]interface{}{
				"message": "Action 1",
			},
			Enabled: true,
		},
		{
			Type:   models.ActionTypePlugin,
			Name:   "Test Action 2",
			Plugin: "test2",
			Config: map[string]interface{}{
				"message": "Action 2",
			},
			Enabled: true,
		},
	}

	task := &TriggerTask{
		TriggerID: 123,
		Event:     event,
		Actions:   actions,
	}

	// 测试任务基本信息
	assert.Equal(t, "trigger-123-test-event", task.GetID())
	assert.Equal(t, "trigger", task.GetType())
	assert.Equal(t, 2, task.GetPriority())
	assert.Equal(t, 0, task.GetRetryCount())
	assert.Equal(t, 3, task.GetMaxRetries())
	assert.True(t, task.CanRetry())
	assert.Nil(t, task.GetError())
	assert.NotNil(t, task.GetCreatedAt())

	// 测试任务执行
	ctx := context.Background()
	err := task.Execute(ctx)
	assert.NoError(t, err)

	// 测试重试机制
	task.IncrementRetry()
	task.IncrementRetry()
	task.IncrementRetry()
	assert.False(t, task.CanRetry())
}

// TestDefaultSchedulerConfig 测试默认配置
func TestDefaultSchedulerConfig(t *testing.T) {
	config := DefaultSchedulerConfig()
	assert.NotNil(t, config)
	assert.Equal(t, 100, config.MaxConcurrency)
	assert.Equal(t, 10000, config.EventBufferSize)
	assert.Equal(t, 30*time.Second, config.ProcessingTimeout)
	assert.Equal(t, 60*time.Second, config.ShutdownTimeout)
	assert.Equal(t, 30*time.Second, config.StatsInterval)
	assert.Equal(t, 60*time.Second, config.HealthCheckInterval)
	assert.Equal(t, 10*time.Second, config.MetricsInterval)
	assert.False(t, config.EnableProfiling)
	assert.True(t, config.EnableMetrics)
	assert.False(t, config.EnableTracing)
	assert.Equal(t, 10*time.Minute, config.GCInterval)
	assert.Equal(t, 3, config.MaxRetries)
	assert.Equal(t, 1*time.Second, config.RetryDelay)
	assert.Equal(t, 2.0, config.RetryBackoff)
}

// TestSchedulerStatusString 测试状态字符串
func TestSchedulerStatusString(t *testing.T) {
	assert.Equal(t, "stopped", SchedulerStopped.String())
	assert.Equal(t, "starting", SchedulerStarting.String())
	assert.Equal(t, "running", SchedulerRunning.String())
	assert.Equal(t, "stopping", SchedulerStopping.String())
	assert.Equal(t, "unknown", SchedulerStatus(999).String())
}

// BenchmarkSchedulerProcessEvent 事件处理性能测试
func BenchmarkSchedulerProcessEvent(b *testing.B) {
	config := &SchedulerConfig{
		MaxConcurrency:      100,
		EventBufferSize:     10000,
		ProcessingTimeout:   30 * time.Second,
		ShutdownTimeout:     60 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(b, err)
	defer scheduler.Stop(ctx)

	// 创建测试事件
	event := &models.Event{
		ID:   "benchmark-event",
		Type: "email.received",
		Data: createJSONData(map[string]interface{}{
			"subject": "Benchmark Email",
		}),
	}

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			err := scheduler.ProcessEvent(event)
			if err != nil {
				b.Error(err)
			}
		}
	})
}

// BenchmarkSchedulerTriggerManagement 触发器管理性能测试
func BenchmarkSchedulerTriggerManagement(b *testing.B) {
	config := &SchedulerConfig{
		MaxConcurrency:      100,
		EventBufferSize:     10000,
		ProcessingTimeout:   30 * time.Second,
		ShutdownTimeout:     60 * time.Second,
		StatsInterval:       0,
		HealthCheckInterval: 0,
		MetricsInterval:     0,
		GCInterval:          0,
	}

	scheduler := NewTriggerV2Scheduler(config)
	ctx := context.Background()

	err := scheduler.Start(ctx)
	require.NoError(b, err)
	defer scheduler.Stop(ctx)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		trigger := &models.TriggerV2{
			ID:     uint(i),
			Name:   fmt.Sprintf("Benchmark Trigger %d", i),
			Status: models.TriggerV2StatusActive,
		}

		err := scheduler.RegisterTrigger(trigger)
		if err != nil {
			b.Error(err)
		}

		_, err = scheduler.GetTrigger(uint(i))
		if err != nil {
			b.Error(err)
		}

		err = scheduler.UnregisterTrigger(uint(i))
		if err != nil {
			b.Error(err)
		}
	}
}
