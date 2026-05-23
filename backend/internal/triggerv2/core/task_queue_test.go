package core

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewPriorityTaskQueue 测试创建优先级任务队列
func TestNewPriorityTaskQueue(t *testing.T) {
	tests := []struct {
		name   string
		config *QueueConfig
		want   *QueueConfig
	}{
		{
			name:   "使用默认配置",
			config: nil,
			want:   DefaultQueueConfig(),
		},
		{
			name: "使用自定义配置",
			config: &QueueConfig{
				MaxSize:      500,
				MaxScheduled: 100,
				BatchSize:    50,
			},
			want: &QueueConfig{
				MaxSize:      500,
				MaxScheduled: 100,
				BatchSize:    50,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			queue := NewPriorityTaskQueue(tt.config)
			assert.NotNil(t, queue)

			priorityQueue := queue.(*PriorityTaskQueue)
			if tt.config == nil {
				assert.Equal(t, tt.want.MaxSize, priorityQueue.config.MaxSize)
				assert.Equal(t, tt.want.MaxScheduled, priorityQueue.config.MaxScheduled)
				assert.Equal(t, tt.want.BatchSize, priorityQueue.config.BatchSize)
			} else {
				assert.Equal(t, tt.want.MaxSize, priorityQueue.config.MaxSize)
				assert.Equal(t, tt.want.MaxScheduled, priorityQueue.config.MaxScheduled)
				assert.Equal(t, tt.want.BatchSize, priorityQueue.config.BatchSize)
			}
		})
	}
}

// TestTaskQueueStartStop 测试任务队列启动和停止
func TestTaskQueueStartStop(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        100,
		MaxScheduled:   50,
		StatsInterval:  0, // 禁用统计更新
		HealthInterval: 0, // 禁用健康检查
		GCInterval:     0, // 禁用垃圾回收
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	// 测试启动
	err := queue.Start(ctx)
	assert.NoError(t, err)

	// 测试重复启动
	err = queue.Start(ctx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "已经在运行")

	// 测试停止
	stopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err = queue.Stop(stopCtx)
	assert.NoError(t, err)

	// 测试重复停止
	err = queue.Stop(stopCtx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "没有在运行")
}

// TestTaskQueuePushPop 测试任务推送和弹出
func TestTaskQueuePushPop(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		MaxScheduled:   5,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 测试推送任务
	task1 := &QueuedTask{
		Task:     NewMockTask("task-1", "test"),
		Priority: NormalPriority,
	}

	err = queue.Push(task1)
	assert.NoError(t, err)
	assert.Equal(t, 1, queue.Size())
	assert.False(t, queue.IsEmpty())

	// 测试弹出任务
	poppedTask, err := queue.Pop()
	assert.NoError(t, err)
	assert.Equal(t, task1.Task.GetID(), poppedTask.Task.GetID())
	assert.Equal(t, 0, queue.Size())
	assert.True(t, queue.IsEmpty())

	// 测试空队列弹出
	_, err = queue.Pop()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "队列为空")
}

// TestTaskQueuePushNull 测试推送空任务
func TestTaskQueuePushNull(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 测试推送空任务
	err = queue.Push(nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "任务不能为空")
}

// TestTaskQueuePriority 测试任务优先级
func TestTaskQueuePriority(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 推送不同优先级的任务
	tasks := []*QueuedTask{
		{
			Task:     NewMockTask("low", "test"),
			Priority: LowPriority,
		},
		{
			Task:     NewMockTask("urgent", "test"),
			Priority: UrgentPriority,
		},
		{
			Task:     NewMockTask("normal", "test"),
			Priority: NormalPriority,
		},
		{
			Task:     NewMockTask("high", "test"),
			Priority: HighPriority,
		},
	}

	for _, task := range tasks {
		err = queue.Push(task)
		assert.NoError(t, err)
	}

	// 验证按优先级顺序弹出
	expectedOrder := []string{"urgent", "high", "normal", "low"}
	for _, expectedID := range expectedOrder {
		task, err := queue.Pop()
		assert.NoError(t, err)
		assert.Equal(t, expectedID, task.Task.GetID())
	}
}

// TestTaskQueuePeek 测试查看队列顶部任务
func TestTaskQueuePeek(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 测试空队列查看
	_, err = queue.Peek()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "队列为空")

	// 推送任务
	task := &QueuedTask{
		Task:     NewMockTask("peek-test", "test"),
		Priority: HighPriority,
	}

	err = queue.Push(task)
	assert.NoError(t, err)

	// 查看任务
	peekedTask, err := queue.Peek()
	assert.NoError(t, err)
	assert.Equal(t, task.Task.GetID(), peekedTask.Task.GetID())
	assert.Equal(t, 1, queue.Size()) // 大小不变

	// 弹出任务
	poppedTask, err := queue.Pop()
	assert.NoError(t, err)
	assert.Equal(t, task.Task.GetID(), poppedTask.Task.GetID())
	assert.Equal(t, 0, queue.Size())
}

// TestTaskQueueSchedule 测试任务调度
func TestTaskQueueSchedule(t *testing.T) {
	config := &QueueConfig{
		MaxSize:          10,
		MaxScheduled:     5,
		ScheduleInterval: 50 * time.Millisecond,
		MaxScheduleDelay: 1 * time.Hour, // 添加最大调度延迟设置
		StatsInterval:    0,
		HealthInterval:   0,
		GCInterval:       0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 测试延迟调度
	task := &QueuedTask{
		Task:     NewMockTask("scheduled-task", "test"),
		Priority: NormalPriority,
	}

	delay := 100 * time.Millisecond
	err = queue.Schedule(task, delay)
	assert.NoError(t, err)

	// 立即检查队列，应该为空
	assert.Equal(t, 0, queue.Size())

	// 等待调度生效
	time.Sleep(200 * time.Millisecond)

	// 现在队列应该有任务
	assert.Equal(t, 1, queue.Size())

	// 弹出任务验证
	poppedTask, err := queue.Pop()
	assert.NoError(t, err)
	assert.Equal(t, task.Task.GetID(), poppedTask.Task.GetID())
}

// TestTaskQueueScheduleAt 测试在指定时间调度
func TestTaskQueueScheduleAt(t *testing.T) {
	config := &QueueConfig{
		MaxSize:          10,
		MaxScheduled:     5,
		ScheduleInterval: 50 * time.Millisecond,
		MaxScheduleDelay: 1 * time.Hour, // 添加最大调度延迟设置
		StatsInterval:    0,
		HealthInterval:   0,
		GCInterval:       0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 测试在指定时间调度
	task := &QueuedTask{
		Task:     NewMockTask("scheduled-at-task", "test"),
		Priority: NormalPriority,
	}

	scheduledAt := time.Now().Add(100 * time.Millisecond)
	err = queue.ScheduleAt(task, scheduledAt)
	assert.NoError(t, err)

	// 立即检查队列，应该为空
	assert.Equal(t, 0, queue.Size())

	// 等待调度生效
	time.Sleep(200 * time.Millisecond)

	// 现在队列应该有任务
	assert.Equal(t, 1, queue.Size())

	// 测试过去时间调度
	pastTask := &QueuedTask{
		Task:     NewMockTask("past-task", "test"),
		Priority: NormalPriority,
	}

	pastTime := time.Now().Add(-1 * time.Hour)
	err = queue.ScheduleAt(pastTask, pastTime)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "调度时间不能在过去")
}

// TestTaskQueueBatch 测试批处理
func TestTaskQueueBatch(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        50,
		BatchSize:      10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 测试批量推送
	tasks := make([]*QueuedTask, 20)
	for i := 0; i < 20; i++ {
		tasks[i] = &QueuedTask{
			Task:     NewMockTask(fmt.Sprintf("batch-task-%d", i), "test"),
			Priority: NormalPriority,
		}
	}

	err = queue.PushBatch(tasks)
	assert.NoError(t, err)
	assert.Equal(t, 20, queue.Size())

	// 测试批量弹出
	batch1, err := queue.PopBatch(10)
	assert.NoError(t, err)
	assert.Len(t, batch1, 10)
	assert.Equal(t, 10, queue.Size())

	// 弹出剩余任务
	batch2, err := queue.PopBatch(15)
	assert.NoError(t, err)
	assert.Len(t, batch2, 10) // 只剩10个任务
	assert.Equal(t, 0, queue.Size())

	// 测试空队列批量弹出
	emptyBatch, err := queue.PopBatch(5)
	assert.NoError(t, err)
	assert.Len(t, emptyBatch, 0)
}

// TestTaskQueueGetByID 测试根据ID获取任务
func TestTaskQueueGetByID(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 推送任务
	task := &QueuedTask{
		Task:     NewMockTask("findable-task", "test"),
		Priority: NormalPriority,
	}

	err = queue.Push(task)
	assert.NoError(t, err)

	// 根据ID查找任务
	foundTask, err := queue.GetByID("findable-task")
	assert.NoError(t, err)
	assert.Equal(t, task.Task.GetID(), foundTask.Task.GetID())

	// 查找不存在的任务
	_, err = queue.GetByID("non-existent-task")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "不存在")
}

// TestTaskQueueGetByTags 测试根据标签获取任务
func TestTaskQueueGetByTags(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 推送带标签的任务
	tasks := []*QueuedTask{
		{
			Task:     NewMockTask("task-1", "test"),
			Priority: NormalPriority,
			Tags:     []string{"urgent", "email"},
		},
		{
			Task:     NewMockTask("task-2", "test"),
			Priority: NormalPriority,
			Tags:     []string{"email", "retry"},
		},
		{
			Task:     NewMockTask("task-3", "test"),
			Priority: NormalPriority,
			Tags:     []string{"urgent", "sms"},
		},
	}

	for _, task := range tasks {
		err = queue.Push(task)
		assert.NoError(t, err)
	}

	// 根据标签查找任务
	emailTasks, err := queue.GetByTags([]string{"email"})
	assert.NoError(t, err)
	assert.Len(t, emailTasks, 2)

	urgentTasks, err := queue.GetByTags([]string{"urgent"})
	assert.NoError(t, err)
	assert.Len(t, urgentTasks, 2)

	urgentEmailTasks, err := queue.GetByTags([]string{"urgent", "email"})
	assert.NoError(t, err)
	assert.Len(t, urgentEmailTasks, 1)

	// 查找不存在的标签
	nonExistentTasks, err := queue.GetByTags([]string{"non-existent"})
	assert.NoError(t, err)
	assert.Len(t, nonExistentTasks, 0)
}

// TestTaskQueueGetByPriority 测试根据优先级获取任务
func TestTaskQueueGetByPriority(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 推送不同优先级的任务
	tasks := []*QueuedTask{
		{
			Task:     NewMockTask("urgent-1", "test"),
			Priority: UrgentPriority,
		},
		{
			Task:     NewMockTask("urgent-2", "test"),
			Priority: UrgentPriority,
		},
		{
			Task:     NewMockTask("normal-1", "test"),
			Priority: NormalPriority,
		},
	}

	for _, task := range tasks {
		err = queue.Push(task)
		assert.NoError(t, err)
	}

	// 根据优先级查找任务
	urgentTasks, err := queue.GetByPriority(UrgentPriority)
	assert.NoError(t, err)
	assert.Len(t, urgentTasks, 2)

	normalTasks, err := queue.GetByPriority(NormalPriority)
	assert.NoError(t, err)
	assert.Len(t, normalTasks, 1)

	lowTasks, err := queue.GetByPriority(LowPriority)
	assert.NoError(t, err)
	assert.Len(t, lowTasks, 0)
}

// TestTaskQueueRemoveByID 测试根据ID移除任务
func TestTaskQueueRemoveByID(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 推送任务
	task := &QueuedTask{
		Task:     NewMockTask("removable-task", "test"),
		Priority: NormalPriority,
	}

	err = queue.Push(task)
	assert.NoError(t, err)
	assert.Equal(t, 1, queue.Size())

	// 移除任务
	err = queue.RemoveByID("removable-task")
	assert.NoError(t, err)
	assert.Equal(t, 0, queue.Size())

	// 移除不存在的任务
	err = queue.RemoveByID("non-existent-task")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "不存在")
}

// TestTaskQueueUpdatePriority 测试更新任务优先级
func TestTaskQueueUpdatePriority(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 推送任务
	tasks := []*QueuedTask{
		{
			Task:     NewMockTask("task-1", "test"),
			Priority: NormalPriority,
		},
		{
			Task:     NewMockTask("task-2", "test"),
			Priority: LowPriority,
		},
	}

	for _, task := range tasks {
		err = queue.Push(task)
		assert.NoError(t, err)
	}

	// 更新优先级
	err = queue.UpdatePriority("task-2", UrgentPriority)
	assert.NoError(t, err)

	// 验证优先级更新生效
	poppedTask, err := queue.Pop()
	assert.NoError(t, err)
	assert.Equal(t, "task-2", poppedTask.Task.GetID())

	// 更新不存在的任务
	err = queue.UpdatePriority("non-existent-task", HighPriority)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "不存在")
}

// TestTaskQueueClear 测试清空队列
func TestTaskQueueClear(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 推送多个任务
	for i := 0; i < 5; i++ {
		task := &QueuedTask{
			Task:     NewMockTask(fmt.Sprintf("task-%d", i), "test"),
			Priority: NormalPriority,
		}
		err = queue.Push(task)
		assert.NoError(t, err)
	}

	assert.Equal(t, 5, queue.Size())

	// 清空队列
	err = queue.Clear()
	assert.NoError(t, err)
	assert.Equal(t, 0, queue.Size())
	assert.True(t, queue.IsEmpty())
}

// TestTaskQueueStats 测试统计信息
func TestTaskQueueStats(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 推送任务
	tasks := []*QueuedTask{
		{
			Task:     NewMockTask("task-1", "test"),
			Priority: UrgentPriority,
			Tags:     []string{"urgent", "email"},
		},
		{
			Task:     NewMockTask("task-2", "test"),
			Priority: NormalPriority,
			Tags:     []string{"email"},
		},
	}

	for _, task := range tasks {
		err = queue.Push(task)
		assert.NoError(t, err)
	}

	// 获取统计信息
	stats := queue.GetStats()
	assert.NotNil(t, stats)
	assert.Equal(t, 2, stats.PendingTasks)
	assert.Equal(t, int64(2), stats.TotalTasks)
	assert.Equal(t, int64(0), stats.ProcessedTasks)
	assert.Equal(t, int64(0), stats.FailedTasks)
	assert.Equal(t, 0, stats.ScheduledTasks)

	// 检查优先级统计
	assert.Equal(t, 1, stats.PriorityBreakdown[UrgentPriority])
	assert.Equal(t, 1, stats.PriorityBreakdown[NormalPriority])

	// 检查标签统计
	assert.Equal(t, 2, stats.TagBreakdown["email"])
	assert.Equal(t, 1, stats.TagBreakdown["urgent"])

	// 弹出任务并检查统计更新
	_, err = queue.Pop()
	assert.NoError(t, err)

	stats = queue.GetStats()
	assert.Equal(t, 1, stats.PendingTasks)
	assert.Equal(t, int64(1), stats.ProcessedTasks)
}

// TestTaskQueueHealth 测试健康检查
func TestTaskQueueHealth(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 获取健康状态
	health := queue.GetHealth()
	assert.NotNil(t, health)
	assert.Equal(t, "running", health.Status)
	assert.True(t, health.IsRunning)
	assert.Equal(t, 10, health.Capacity)
	assert.Equal(t, 0, health.QueueSize)
	assert.Equal(t, 0, health.ScheduledSize)
	assert.Equal(t, 0.0, health.Utilization)
	assert.Equal(t, 0.0, health.ProcessingRate)
	assert.Equal(t, 0.0, health.ErrorRate)
	assert.Len(t, health.Issues, 0)

	// 推送任务
	task := &QueuedTask{
		Task:     NewMockTask("health-task", "test"),
		Priority: NormalPriority,
	}

	err = queue.Push(task)
	assert.NoError(t, err)

	// 再次检查健康状态
	health = queue.GetHealth()
	assert.Equal(t, 1, health.QueueSize)
	assert.Equal(t, 10.0, health.Utilization)
}

// TestTaskQueueConcurrency 测试并发操作
func TestTaskQueueConcurrency(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        1000,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 并发推送任务
	numGoroutines := 10
	tasksPerGoroutine := 50
	var wg sync.WaitGroup
	var pushErrors int32

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()

			for j := 0; j < tasksPerGoroutine; j++ {
				task := &QueuedTask{
					Task:     NewMockTask(fmt.Sprintf("task-%d-%d", goroutineID, j), "test"),
					Priority: NormalPriority,
				}

				if err := queue.Push(task); err != nil {
					atomic.AddInt32(&pushErrors, 1)
				}
			}
		}(i)
	}

	wg.Wait()

	// 验证结果
	assert.Equal(t, int32(0), atomic.LoadInt32(&pushErrors))
	assert.Equal(t, numGoroutines*tasksPerGoroutine, queue.Size())

	// 并发弹出任务
	var popErrors int32
	var poppedTasks int32

	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			for j := 0; j < tasksPerGoroutine; j++ {
				if _, err := queue.Pop(); err != nil {
					atomic.AddInt32(&popErrors, 1)
				} else {
					atomic.AddInt32(&poppedTasks, 1)
				}
			}
		}()
	}

	wg.Wait()

	// 验证结果
	assert.Equal(t, int32(0), atomic.LoadInt32(&popErrors))
	assert.Equal(t, int32(numGoroutines*tasksPerGoroutine), atomic.LoadInt32(&poppedTasks))
	assert.Equal(t, 0, queue.Size())
}

// TestTaskQueueFullCapacity 测试队列满容量
func TestTaskQueueFullCapacity(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        3,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 填满队列
	for i := 0; i < 3; i++ {
		task := &QueuedTask{
			Task:     NewMockTask(fmt.Sprintf("task-%d", i), "test"),
			Priority: NormalPriority,
		}
		err = queue.Push(task)
		assert.NoError(t, err)
	}

	// 尝试推送更多任务
	overflowTask := &QueuedTask{
		Task:     NewMockTask("overflow-task", "test"),
		Priority: NormalPriority,
	}

	err = queue.Push(overflowTask)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "任务队列已满")
}

// TestTaskQueueStoppedOperations 测试停止后的操作
func TestTaskQueueStoppedOperations(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)

	// 停止队列
	err = queue.Stop(ctx)
	assert.NoError(t, err)

	// 尝试操作停止的队列
	task := &QueuedTask{
		Task:     NewMockTask("test-task", "test"),
		Priority: NormalPriority,
	}

	err = queue.Push(task)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "任务队列没有在运行")

	_, err = queue.Pop()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "任务队列没有在运行")

	err = queue.Schedule(task, time.Second)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "任务队列没有在运行")
}

// TestDefaultQueueConfig 测试默认配置
func TestDefaultQueueConfig(t *testing.T) {
	config := DefaultQueueConfig()
	assert.NotNil(t, config)
	assert.Equal(t, 10000, config.MaxSize)
	assert.Equal(t, 1000, config.MaxScheduled)
	assert.Equal(t, NormalPriority, config.DefaultPriority)
	assert.Equal(t, 100*time.Millisecond, config.ScheduleInterval)
	assert.Equal(t, 24*time.Hour, config.MaxScheduleDelay)
	assert.Equal(t, 100, config.BatchSize)
	assert.Equal(t, 1*time.Second, config.BatchTimeout)
	assert.Equal(t, 10*time.Second, config.StatsInterval)
	assert.Equal(t, 30*time.Second, config.HealthInterval)
	assert.True(t, config.EnableMetrics)
	assert.False(t, config.EnableProfiling)
	assert.Equal(t, 10*time.Minute, config.GCInterval)
}

// TestTaskPriorityOrder 测试任务优先级顺序
func TestTaskPriorityOrder(t *testing.T) {
	config := &QueueConfig{
		MaxSize:        10,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(t, err)
	defer queue.Stop(ctx)

	// 推送相同优先级的任务（按时间顺序）
	for i := 0; i < 5; i++ {
		task := &QueuedTask{
			Task:     NewMockTask(fmt.Sprintf("task-%d", i), "test"),
			Priority: NormalPriority,
		}
		err = queue.Push(task)
		assert.NoError(t, err)

		// 确保有时间差
		time.Sleep(time.Millisecond)
	}

	// 验证按FIFO顺序弹出
	for i := 0; i < 5; i++ {
		task, err := queue.Pop()
		assert.NoError(t, err)
		assert.Equal(t, fmt.Sprintf("task-%d", i), task.Task.GetID())
	}
}

// BenchmarkTaskQueuePush 任务推送性能测试
func BenchmarkTaskQueuePush(b *testing.B) {
	config := &QueueConfig{
		MaxSize:        100000,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(b, err)
	defer queue.Stop(ctx)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		taskID := 0
		for pb.Next() {
			task := &QueuedTask{
				Task:     NewMockTask(fmt.Sprintf("bench-task-%d", taskID), "benchmark"),
				Priority: NormalPriority,
			}
			err := queue.Push(task)
			if err != nil {
				b.Error(err)
			}
			taskID++
		}
	})
}

// BenchmarkTaskQueuePop 任务弹出性能测试
func BenchmarkTaskQueuePop(b *testing.B) {
	config := &QueueConfig{
		MaxSize:        100000,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(b, err)
	defer queue.Stop(ctx)

	// 预先填充队列
	for i := 0; i < b.N; i++ {
		task := &QueuedTask{
			Task:     NewMockTask(fmt.Sprintf("bench-task-%d", i), "benchmark"),
			Priority: NormalPriority,
		}
		err := queue.Push(task)
		if err != nil {
			b.Fatal(err)
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := queue.Pop()
		if err != nil {
			b.Error(err)
		}
	}
}

// BenchmarkTaskQueueBatch 批处理性能测试
func BenchmarkTaskQueueBatch(b *testing.B) {
	config := &QueueConfig{
		MaxSize:        100000,
		BatchSize:      100,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(b, err)
	defer queue.Stop(ctx)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// 批量推送
		tasks := make([]*QueuedTask, 100)
		for j := 0; j < 100; j++ {
			tasks[j] = &QueuedTask{
				Task:     NewMockTask(fmt.Sprintf("bench-batch-%d-%d", i, j), "benchmark"),
				Priority: NormalPriority,
			}
		}

		err := queue.PushBatch(tasks)
		if err != nil {
			b.Error(err)
		}

		// 批量弹出
		_, err = queue.PopBatch(100)
		if err != nil {
			b.Error(err)
		}
	}
}

// BenchmarkTaskQueueConcurrency 并发性能测试
func BenchmarkTaskQueueConcurrency(b *testing.B) {
	config := &QueueConfig{
		MaxSize:        100000,
		StatsInterval:  0,
		HealthInterval: 0,
		GCInterval:     0,
	}

	queue := NewPriorityTaskQueue(config)
	ctx := context.Background()

	err := queue.Start(ctx)
	require.NoError(b, err)
	defer queue.Stop(ctx)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		taskID := 0
		for pb.Next() {
			// 50% 推送，50% 弹出
			if taskID%2 == 0 {
				task := &QueuedTask{
					Task:     NewMockTask(fmt.Sprintf("bench-concurrent-%d", taskID), "benchmark"),
					Priority: NormalPriority,
				}
				queue.Push(task)
			} else {
				queue.Pop()
			}
			taskID++
		}
	})
}
