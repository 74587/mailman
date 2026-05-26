package services

import (
	"fmt"
	"runtime/debug"
	"sort"
	"sync"
	"time"

	"mailman/internal/models"
	"mailman/internal/utils"
)

// ParallelActionExecutor handles the execution of trigger actions in parallel
type ParallelActionExecutor struct {
	pluginManager actionPluginProvider
	maxWorkers    int
	logger        *utils.Logger
}

// NewParallelActionExecutor creates a new ParallelActionExecutor
func NewParallelActionExecutor(pluginManager actionPluginProvider, maxWorkers int) *ParallelActionExecutor {
	// 如果未指定最大工作线程数，则使用默认值
	if maxWorkers <= 0 {
		maxWorkers = 5
	}

	return &ParallelActionExecutor{
		pluginManager: pluginManager,
		maxWorkers:    maxWorkers,
		logger:        utils.NewLogger("ParallelActionExecutor"),
	}
}

// ExecuteActions executes a list of actions with parallelism
func (e *ParallelActionExecutor) ExecuteActions(actions []models.TriggerAction, email models.Email) (models.ActionExecutionResults, error) {
	e.logger.Info("Executing %d actions", len(actions))

	if len(actions) == 0 {
		e.logger.Info("No actions to execute")
		return models.ActionExecutionResults{}, nil
	}

	// 按执行顺序对动作进行分组
	executionGroups := e.groupActionsByExecutionOrder(actions)

	results := make(models.ActionExecutionResults, 0, len(actions))
	var firstError error

	// 创建插件上下文
	context := &PluginContext{
		Email: email,
	}

	// 按顺序执行每个组，但组内的动作并行执行
	for _, group := range executionGroups {
		groupResults, err := e.executeActionGroup(group, context)
		results = append(results, groupResults...)

		if err != nil && firstError == nil {
			firstError = err
		}
	}

	e.logger.Info("Completed execution of %d actions. Success: %d, Failed: %d",
		len(results), countSuccessfulActions(results), len(results)-countSuccessfulActions(results))

	return results, firstError
}

// groupActionsByExecutionOrder 按执行顺序对动作进行分组
func (e *ParallelActionExecutor) groupActionsByExecutionOrder(actions []models.TriggerAction) [][]models.TriggerAction {
	if len(actions) == 0 {
		return [][]models.TriggerAction{}
	}

	// 首先按执行顺序排序
	sortedActions := make([]models.TriggerAction, len(actions))
	copy(sortedActions, actions)
	sort.Slice(sortedActions, func(i, j int) bool {
		return sortedActions[i].ExecutionOrder < sortedActions[j].ExecutionOrder
	})

	// 按执行顺序分组
	groups := [][]models.TriggerAction{}
	currentGroup := []models.TriggerAction{sortedActions[0]}
	currentOrder := sortedActions[0].ExecutionOrder

	for i := 1; i < len(sortedActions); i++ {
		if sortedActions[i].ExecutionOrder == currentOrder {
			// 相同执行顺序，添加到当前组
			currentGroup = append(currentGroup, sortedActions[i])
		} else {
			// 不同执行顺序，创建新组
			groups = append(groups, currentGroup)
			currentGroup = []models.TriggerAction{sortedActions[i]}
			currentOrder = sortedActions[i].ExecutionOrder
		}
	}

	// 添加最后一个组
	if len(currentGroup) > 0 {
		groups = append(groups, currentGroup)
	}

	return groups
}

// executeActionGroup 并行执行一组动作
func (e *ParallelActionExecutor) executeActionGroup(actions []models.TriggerAction, context *PluginContext) (models.ActionExecutionResults, error) {
	e.logger.Info("Executing action group with %d actions", len(actions))

	results := make(models.ActionExecutionResults, len(actions))
	var wg sync.WaitGroup
	var mu sync.Mutex
	var firstError error

	// 创建工作线程池
	semaphore := make(chan struct{}, e.maxWorkers)

	for i, action := range actions {
		wg.Add(1)

		// 获取信号量
		semaphore <- struct{}{}

		go func(index int, action models.TriggerAction) {
			defer wg.Done()
			defer func() { <-semaphore }() // 释放信号量

			// 执行动作
			result, err := e.executeAction(action, context)

			// 保存结果
			mu.Lock()
			results[index] = *result
			if err != nil && firstError == nil {
				firstError = err
			}
			mu.Unlock()
		}(i, action)
	}

	// 等待所有动作完成
	wg.Wait()

	return results, firstError
}

// executeAction 执行单个动作
func (e *ParallelActionExecutor) executeAction(action models.TriggerAction, context *PluginContext) (executionResult *models.ActionExecutionResult, err error) {
	e.logger.Info("Executing action: %s (Plugin: %s)", action.ID, action.PluginID)
	startTime := time.Now()
	defer func() {
		if recovered := recover(); recovered != nil {
			endTime := time.Now()
			err = fmt.Errorf("action panic: %v", recovered)
			e.logger.Error("Action execution panicked: %s - %v\n%s", action.ID, recovered, string(debug.Stack()))
			executionResult = &models.ActionExecutionResult{
				ActionID:   action.ID,
				PluginID:   action.PluginID,
				PluginName: action.PluginName,
				Success:    false,
				StartTime:  startTime,
				EndTime:    endTime,
				Duration:   endTime.Sub(startTime).Milliseconds(),
				Error:      err.Error(),
			}
		}
	}()

	// 跳过禁用的动作
	if !action.Enabled {
		e.logger.Info("Skipping disabled action: %s", action.ID)
		return &models.ActionExecutionResult{
			ActionID:   action.ID,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			Success:    false,
			StartTime:  time.Now(),
			EndTime:    time.Now(),
			Duration:   0,
			Error:      "Action is disabled",
		}, nil
	}

	// 获取插件
	plugin, err := e.pluginManager.GetPlugin(action.PluginID)
	if err != nil {
		errMsg := fmt.Sprintf("Plugin not found: %s", err)
		e.logger.Error("%s", errMsg)
		return &models.ActionExecutionResult{
			ActionID:   action.ID,
			PluginID:   action.PluginID,
			PluginName: action.PluginName,
			Success:    false,
			StartTime:  time.Now(),
			EndTime:    time.Now(),
			Duration:   0,
			Error:      errMsg,
		}, err
	}

	// 执行插件
	result, err := plugin.Execute(action.Config, context)
	endTime := time.Now()

	// 创建执行结果
	executionResult = &models.ActionExecutionResult{
		ActionID:   action.ID,
		PluginID:   action.PluginID,
		PluginName: action.PluginName,
		StartTime:  startTime,
		EndTime:    endTime,
		Duration:   endTime.Sub(startTime).Milliseconds(),
	}

	if err != nil {
		executionResult.Success = false
		executionResult.Error = err.Error()
		e.logger.Error("Action execution failed: %s - %v", action.ID, err)
	} else if result == nil {
		executionResult.Success = false
		executionResult.Error = "Plugin returned nil result"
		e.logger.Error("Action execution failed: %s - Plugin returned nil result", action.ID)
	} else {
		executionResult.Success = result.Success
		executionResult.Result = result.Data
		if !result.Success {
			executionResult.Error = result.Error
			e.logger.Error("Action execution failed: %s - %s", action.ID, result.Error)
		} else {
			e.logger.Info("Action execution succeeded: %s", action.ID)
		}
	}

	return executionResult, nil
}

// TestAction 测试动作而不实际执行其副作用
func (e *ParallelActionExecutor) TestAction(action models.TriggerAction, email models.Email) (*models.ActionExecutionResult, error) {
	e.logger.Info("Testing action: %s (Plugin: %s)", action.ID, action.PluginID)

	// 创建测试上下文
	context := &PluginContext{
		Email: email,
		// 可以在这里添加额外的上下文数据来指示测试模式
	}

	// 执行动作
	return e.executeAction(action, context)
}
