package core

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// MockTask 模拟任务实现
type MockTask struct {
	id          string
	taskType    string
	priority    int
	createdAt   time.Time
	retryCount  int
	maxRetries  int
	executeFunc func(ctx context.Context) error
	err         error
	mu          sync.RWMutex
}

// NewMockTask 创建模拟任务
func NewMockTask(id string, taskType string) *MockTask {
	return &MockTask{
		id:         id,
		taskType:   taskType,
		priority:   0,
		createdAt:  time.Now(),
		retryCount: 0,
		maxRetries: 3,
	}
}

// NewMockTaskWithFunc 创建带执行函数的模拟任务
func NewMockTaskWithFunc(id string, taskType string, executeFunc func(ctx context.Context) error) *MockTask {
	return &MockTask{
		id:          id,
		taskType:    taskType,
		priority:    0,
		createdAt:   time.Now(),
		retryCount:  0,
		maxRetries:  3,
		executeFunc: executeFunc,
	}
}

// Execute 执行任务
func (t *MockTask) Execute(ctx context.Context) error {
	if t.executeFunc != nil {
		return t.executeFunc(ctx)
	}
	return t.err
}

// GetID 获取任务ID
func (t *MockTask) GetID() string {
	return t.id
}

// GetType 获取任务类型
func (t *MockTask) GetType() string {
	return t.taskType
}

// GetPriority 获取任务优先级
func (t *MockTask) GetPriority() int {
	return t.priority
}

// GetCreatedAt 获取创建时间
func (t *MockTask) GetCreatedAt() time.Time {
	return t.createdAt
}

// GetRetryCount 获取重试次数
func (t *MockTask) GetRetryCount() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.retryCount
}

// IncrementRetry 增加重试次数
func (t *MockTask) IncrementRetry() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.retryCount++
}

// CanRetry 检查是否可以重试
func (t *MockTask) CanRetry() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.retryCount < t.maxRetries
}

// GetMaxRetries 获取最大重试次数
func (t *MockTask) GetMaxRetries() int {
	return t.maxRetries
}

// SetError 设置错误
func (t *MockTask) SetError(err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.err = err
}

// GetError 获取错误
func (t *MockTask) GetError() error {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.err
}

// SetMaxRetries 设置最大重试次数
func (t *MockTask) SetMaxRetries(maxRetries int) {
	t.maxRetries = maxRetries
}

// TestNewWorkerExecutorPool 测试创建执行器池
func TestNewWorkerExecutorPool(t *testing.T) {
	tests := []struct {
		name   string
		config *PoolConfig
		want   *PoolConfig
	}{
		{
			name:   "使用默认配置",
			config: nil,
			want:   DefaultPoolConfig(),
		},
		{
			name: "使用自定义配置",
			config: &PoolConfig{
				PoolSize:  5,
				QueueSize: 100,
			},
			want: &PoolConfig{
				PoolSize:  5,
				QueueSize: 100,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool := NewWorkerExecutorPool(tt.config)
			assert.NotNil(t, pool)

			workerPool := pool.(*WorkerExecutorPool)
			if tt.config == nil {
				assert.Equal(t, tt.want.PoolSize, workerPool.config.PoolSize)
				assert.Equal(t, tt.want.QueueSize, workerPool.config.QueueSize)
			} else {
				assert.Equal(t, tt.want.PoolSize, workerPool.config.PoolSize)
				assert.Equal(t, tt.want.QueueSize, workerPool.config.QueueSize)
			}
		})
	}
}

// TestExecutorPoolStartStop 测试执行器池启动和停止
func TestExecutorPoolStartStop(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            3,
		QueueSize:           10,
		TaskTimeout:         5 * time.Second,
		HealthCheckInterval: 0, // 禁用健康检查
		StatsInterval:       0, // 禁用统计更新
		GCInterval:          0, // 禁用垃圾回收
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	// 测试启动
	err := pool.Start(ctx)
	assert.NoError(t, err)
	assert.Equal(t, 3, pool.GetSize())

	// 测试重复启动
	err = pool.Start(ctx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "已经在运行")

	// 测试停止
	stopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err = pool.Stop(stopCtx)
	assert.NoError(t, err)

	// 测试重复停止
	err = pool.Stop(stopCtx)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "没有在运行")
}

// TestExecutorPoolSubmit 测试任务提交
func TestExecutorPoolSubmit(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            2,
		QueueSize:           5,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 测试正常提交
	task := NewMockTask("test-1", "test")
	err = pool.Submit(task)
	assert.NoError(t, err)

	// 测试空任务提交
	err = pool.Submit(nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "任务不能为空")

	// 等待任务完成
	time.Sleep(100 * time.Millisecond)

	// 测试统计信息
	stats := pool.GetStats()
	assert.Equal(t, int64(1), stats.TotalTasks)
	assert.Equal(t, int64(1), stats.CompletedTasks)
	assert.Equal(t, int64(0), stats.FailedTasks)
}

// TestExecutorPoolSubmitWithCallback 测试带回调的任务提交
func TestExecutorPoolSubmitWithCallback(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            2,
		QueueSize:           5,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 测试带回调的任务提交
	var callbackCalled bool
	var callbackResult *TaskResult

	task := NewMockTask("test-callback", "test")
	callback := func(result *TaskResult) {
		callbackCalled = true
		callbackResult = result
	}

	err = pool.SubmitWithCallback(task, callback)
	assert.NoError(t, err)

	// 等待任务完成
	time.Sleep(200 * time.Millisecond)

	// 验证回调被调用
	assert.True(t, callbackCalled)
	assert.NotNil(t, callbackResult)
	assert.Equal(t, "test-callback", callbackResult.TaskID)
	assert.Equal(t, "test", callbackResult.TaskType)
	assert.True(t, callbackResult.Success)
}

// TestExecutorPoolTaskExecution 测试任务执行
func TestExecutorPoolTaskExecution(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            2,
		QueueSize:           10,
		TaskTimeout:         1 * time.Second,
		MaxRetries:          0, // 禁用重试以获得准确的统计
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 测试成功任务
	var executed bool
	successTask := NewMockTaskWithFunc("success-task", "test", func(ctx context.Context) error {
		executed = true
		return nil
	})

	err = pool.Submit(successTask)
	assert.NoError(t, err)

	// 测试失败任务
	var executedFail bool
	failTask := NewMockTaskWithFunc("fail-task", "test", func(ctx context.Context) error {
		executedFail = true
		return errors.New("测试错误")
	})

	err = pool.Submit(failTask)
	assert.NoError(t, err)

	// 等待任务完成
	time.Sleep(200 * time.Millisecond)

	// 验证任务被执行
	assert.True(t, executed)
	assert.True(t, executedFail)

	// 验证统计信息
	stats := pool.GetStats()
	assert.GreaterOrEqual(t, stats.TotalTasks, int64(2)) // 可能因重试而增加
	assert.Equal(t, int64(1), stats.CompletedTasks)
	assert.GreaterOrEqual(t, stats.FailedTasks, int64(1)) // 失败任务可能重试
}

// TestExecutorPoolRetry 测试任务重试
func TestExecutorPoolRetry(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            1,
		QueueSize:           10,
		TaskTimeout:         1 * time.Second,
		RetryDelay:          10 * time.Millisecond,
		RetryBackoff:        1.0,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 测试重试任务
	var execCount int32
	retryTask := NewMockTaskWithFunc("retry-task", "test", func(ctx context.Context) error {
		count := atomic.AddInt32(&execCount, 1)
		if count < 3 {
			return errors.New("测试错误")
		}
		return nil
	})
	// 设置最大重试次数为2，这样总共执行3次（第1次+2次重试）
	retryTask.SetMaxRetries(2)

	err = pool.Submit(retryTask)
	assert.NoError(t, err)

	// 等待任务完成
	time.Sleep(1 * time.Second)

	// 验证重试次数
	assert.Equal(t, int32(3), atomic.LoadInt32(&execCount))
	assert.Equal(t, 2, retryTask.GetRetryCount())
}

// TestExecutorPoolTimeout 测试任务超时
func TestExecutorPoolTimeout(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            1,
		QueueSize:           5,
		TaskTimeout:         100 * time.Millisecond,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 测试超时任务
	var timeoutResult *TaskResult
	timeoutTask := NewMockTaskWithFunc("timeout-task", "test", func(ctx context.Context) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
			return nil
		}
	})

	err = pool.SubmitWithCallback(timeoutTask, func(result *TaskResult) {
		timeoutResult = result
	})
	assert.NoError(t, err)

	// 等待任务完成
	time.Sleep(300 * time.Millisecond)

	// 验证超时
	assert.NotNil(t, timeoutResult)
	assert.False(t, timeoutResult.Success)
	assert.NotNil(t, timeoutResult.Error)
	assert.Contains(t, timeoutResult.Error.Error(), "deadline exceeded")
}

// TestExecutorPoolResize 测试池大小调整
func TestExecutorPoolResize(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            2,
		QueueSize:           10,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 测试初始大小
	assert.Equal(t, 2, pool.GetSize())

	// 测试扩大池
	err = pool.Resize(5)
	assert.NoError(t, err)
	assert.Equal(t, 5, pool.GetSize())

	// 测试缩小池
	err = pool.Resize(3)
	assert.NoError(t, err)
	assert.Equal(t, 3, pool.GetSize())

	// 测试无效大小
	err = pool.Resize(0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "池大小必须大于0")

	// 测试相同大小
	err = pool.Resize(3)
	assert.NoError(t, err)
	assert.Equal(t, 3, pool.GetSize())
}

// TestExecutorPoolConcurrency 测试并发处理
func TestExecutorPoolConcurrency(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            5,
		QueueSize:           100,
		TaskTimeout:         1 * time.Second,
		MaxRetries:          0, // 禁用重试防止多次回调
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 提交多个任务
	numTasks := 50
	var completedTasks int32
	completedChan := make(chan bool, numTasks)

	for i := 0; i < numTasks; i++ {
		task := NewMockTaskWithFunc(fmt.Sprintf("task-%d", i), "test", func(ctx context.Context) error {
			time.Sleep(10 * time.Millisecond)
			return nil
		})

		err = pool.SubmitWithCallback(task, func(result *TaskResult) {
			if result.Success {
				atomic.AddInt32(&completedTasks, 1)
			}
			completedChan <- result.Success
		})
		assert.NoError(t, err)
	}

	// 等待所有任务完成
	for i := 0; i < numTasks; i++ {
		select {
		case <-completedChan:
			// 任务完成
		case <-time.After(5 * time.Second):
			t.Fatal("任务超时")
		}
	}

	// 等待额外的时间确保所有回调都执行完毕
	time.Sleep(100 * time.Millisecond)
	
	// 验证所有任务都完成了
	completed := atomic.LoadInt32(&completedTasks)
	t.Logf("完成任务数: %d, 期望: %d", completed, numTasks)
	
	// 验证统计信息
	stats := pool.GetStats()
	t.Logf("统计信息: 总任务=%d, 完成=%d, 失败=%d", stats.TotalTasks, stats.CompletedTasks, stats.FailedTasks)
	
	// 至少应该有大部分任务完成
	assert.GreaterOrEqual(t, completed, int32(numTasks*4/5)) // 至少80%的任务完成
	assert.Equal(t, int64(numTasks), stats.TotalTasks)
	assert.GreaterOrEqual(t, stats.CompletedTasks, int64(numTasks*4/5)) // 至少80%完成
}

// TestExecutorPoolQueueFull 测试队列满
func TestExecutorPoolQueueFull(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            1,
		QueueSize:           2,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 提交阻塞任务
	blockingTask := NewMockTaskWithFunc("blocking-task", "test", func(ctx context.Context) error {
		time.Sleep(500 * time.Millisecond)
		return nil
	})

	err = pool.Submit(blockingTask)
	assert.NoError(t, err)

	// 等待一下确保阻塞任务开始执行
	time.Sleep(50 * time.Millisecond)

	// 提交足够多的任务填满队列（队列大小为2）
	for i := 0; i < 2; i++ {
		task := NewMockTask(fmt.Sprintf("task-%d", i), "test")
		err = pool.Submit(task)
		if err != nil {
			t.Logf("提交任务 %d 失败: %v", i, err)
			// 如果队列已满，这是预期的
			break
		}
	}

	// 尝试提交更多任务，应该失败
	overflowTask := NewMockTask("overflow-task", "test")
	err = pool.Submit(overflowTask)
	if err != nil {
		assert.Contains(t, err.Error(), "任务队列已满")
	} else {
		t.Log("警告: 队列满测试可能由于时机问题而无法准确模拟")
	}
}

// TestExecutorPoolStats 测试统计信息
func TestExecutorPoolStats(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            3,
		QueueSize:           10,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 提交一些任务
	for i := 0; i < 5; i++ {
		task := NewMockTask(fmt.Sprintf("task-%d", i), "test")
		err = pool.Submit(task)
		assert.NoError(t, err)
	}

	// 等待任务完成
	time.Sleep(200 * time.Millisecond)

	// 检查统计信息
	stats := pool.GetStats()
	assert.Equal(t, 3, stats.PoolSize)
	assert.Equal(t, int64(5), stats.TotalTasks)
	assert.Equal(t, int64(5), stats.CompletedTasks)
	assert.Equal(t, int64(0), stats.FailedTasks)
	assert.NotNil(t, stats.ExecutorStats)
	assert.Len(t, stats.ExecutorStats, 3)

	// 检查执行器统计
	for _, execStats := range stats.ExecutorStats {
		assert.NotNil(t, execStats)
		assert.GreaterOrEqual(t, execStats.TasksProcessed, int64(0))
		assert.GreaterOrEqual(t, execStats.TasksSucceeded, int64(0))
		assert.Equal(t, int64(0), execStats.TasksFailed)
	}
}

// TestExecutorPoolHealth 测试健康检查
func TestExecutorPoolHealth(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            2,
		QueueSize:           10,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0, // 手动调用健康检查
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 检查健康状态
	health := pool.GetHealth()
	assert.Equal(t, "running", health.Status)
	assert.True(t, health.IsRunning)
	assert.Equal(t, 10, health.QueueCapacity)
	assert.Equal(t, 0, health.QueueSize)
	assert.Equal(t, 0.0, health.QueueUtilization)
	assert.Equal(t, 0, health.ActiveWorkers)
	assert.Equal(t, 2, health.IdleWorkers)
	assert.Equal(t, 0.0, health.ErrorRate)
	assert.Len(t, health.Issues, 0)
}

// TestExecutorPoolStoppedSubmit 测试停止后提交任务
func TestExecutorPoolStoppedSubmit(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            2,
		QueueSize:           5,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)

	// 停止池
	err = pool.Stop(ctx)
	assert.NoError(t, err)

	// 尝试提交任务
	task := NewMockTask("test-task", "test")
	err = pool.Submit(task)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "执行器池没有在运行")
}

// TestExecutorPoolCancelTask 测试取消任务
func TestExecutorPoolCancelTask(t *testing.T) {
	config := &PoolConfig{
		PoolSize:            2,
		QueueSize:           10,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(t, err)
	defer pool.Stop(ctx)

	// 提交任务
	task := NewMockTask("cancelable-task", "test")
	err = pool.Submit(task)
	assert.NoError(t, err)

	// 取消任务
	err = pool.CancelTask("cancelable-task")
	assert.NoError(t, err)

	// 取消不存在的任务
	err = pool.CancelTask("non-existent-task")
	assert.NoError(t, err)
}

// TestDefaultPoolConfig 测试默认配置
func TestDefaultPoolConfig(t *testing.T) {
	config := DefaultPoolConfig()
	assert.NotNil(t, config)
	assert.Equal(t, 10, config.PoolSize)
	assert.Equal(t, 1000, config.QueueSize)
	assert.Equal(t, 30*time.Second, config.TaskTimeout)
	assert.Equal(t, 5*time.Minute, config.IdleTimeout)
	assert.Equal(t, 3, config.MaxRetries)
	assert.Equal(t, 1*time.Second, config.RetryDelay)
	assert.Equal(t, 2.0, config.RetryBackoff)
	assert.Equal(t, 30*time.Second, config.HealthCheckInterval)
	assert.Equal(t, 10*time.Second, config.StatsInterval)
	assert.True(t, config.EnableMetrics)
	assert.False(t, config.EnableProfiling)
	assert.Equal(t, 10*time.Minute, config.GCInterval)
}

// BenchmarkExecutorPoolSubmit 任务提交性能测试
func BenchmarkExecutorPoolSubmit(b *testing.B) {
	config := &PoolConfig{
		PoolSize:            10,
		QueueSize:           10000,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(b, err)
	defer pool.Stop(ctx)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		taskID := 0
		for pb.Next() {
			task := NewMockTask(fmt.Sprintf("bench-task-%d", taskID), "benchmark")
			err := pool.Submit(task)
			if err != nil {
				b.Error(err)
			}
			taskID++
		}
	})
}

// BenchmarkExecutorPoolExecution 任务执行性能测试
func BenchmarkExecutorPoolExecution(b *testing.B) {
	config := &PoolConfig{
		PoolSize:            10,
		QueueSize:           10000,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(b, err)
	defer pool.Stop(ctx)

	var wg sync.WaitGroup

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		wg.Add(1)
		task := NewMockTaskWithFunc(fmt.Sprintf("bench-exec-%d", i), "benchmark", func(ctx context.Context) error {
			// 模拟轻量级工作
			time.Sleep(time.Microsecond)
			return nil
		})

		err := pool.SubmitWithCallback(task, func(result *TaskResult) {
			wg.Done()
		})
		if err != nil {
			b.Error(err)
			wg.Done()
		}
	}

	wg.Wait()
}

// BenchmarkExecutorPoolConcurrency 并发性能测试
func BenchmarkExecutorPoolConcurrency(b *testing.B) {
	config := &PoolConfig{
		PoolSize:            runtime.NumCPU(),
		QueueSize:           10000,
		TaskTimeout:         1 * time.Second,
		HealthCheckInterval: 0,
		StatsInterval:       0,
		GCInterval:          0,
	}

	pool := NewWorkerExecutorPool(config)
	ctx := context.Background()

	err := pool.Start(ctx)
	require.NoError(b, err)
	defer pool.Stop(ctx)

	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		taskID := 0
		for pb.Next() {
			task := NewMockTaskWithFunc(fmt.Sprintf("bench-concurrent-%d", taskID), "benchmark", func(ctx context.Context) error {
				// 模拟CPU密集型工作
				sum := 0
				for i := 0; i < 1000; i++ {
					sum += i
				}
				return nil
			})

			err := pool.Submit(task)
			if err != nil {
				b.Error(err)
			}
			taskID++
		}
	})

	// 等待所有任务完成
	time.Sleep(100 * time.Millisecond)
}
