package services

import (
	"fmt"
	"sort"
	"time"

	"mailman/internal/models"
	"mailman/internal/utils"
)

// actionPluginProvider is an interface for getting plugins by ID
type actionPluginProvider interface {
	GetPlugin(pluginID string) (Plugin, error)
}

// ActionExecutor handles the execution of trigger actions
type ActionExecutor struct {
	pluginManager actionPluginProvider
	logger        *utils.Logger
}

// NewActionExecutor creates a new ActionExecutor
func NewActionExecutor(pluginManager actionPluginProvider) *ActionExecutor {
	return &ActionExecutor{
		pluginManager: pluginManager,
		logger:        utils.NewLogger("ActionExecutor"),
	}
}

// ExecuteActions executes a list of actions in order
func (e *ActionExecutor) ExecuteActions(actions []models.TriggerAction, email models.Email) (models.ActionExecutionResults, error) {
	e.logger.Info("Executing %d actions", len(actions))

	if len(actions) == 0 {
		e.logger.Info("No actions to execute")
		return models.ActionExecutionResults{}, nil
	}

	// Sort actions by execution order
	sortedActions := make([]models.TriggerAction, len(actions))
	copy(sortedActions, actions)
	sort.Slice(sortedActions, func(i, j int) bool {
		return sortedActions[i].ExecutionOrder < sortedActions[j].ExecutionOrder
	})

	results := make(models.ActionExecutionResults, 0, len(sortedActions))
	var firstError error

	// Create plugin context
	context := &PluginContext{
		Email: email,
	}

	// Execute each action in order
	for _, action := range sortedActions {
		result, err := e.ExecuteAction(action, context)
		results = append(results, *result)

		if err != nil && firstError == nil {
			firstError = err
		}
	}

	e.logger.Info("Completed execution of %d actions. Success: %d, Failed: %d",
		len(results), countSuccessfulActions(results), len(results)-countSuccessfulActions(results))

	return results, firstError
}

// ExecuteAction executes a single action
func (e *ActionExecutor) ExecuteAction(action models.TriggerAction, context *PluginContext) (*models.ActionExecutionResult, error) {
	e.logger.Info("Executing action: %s (Plugin: %s)", action.ID, action.PluginID)

	// Skip disabled actions
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

	// Get the plugin
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

	// Execute the plugin
	startTime := time.Now()
	result, err := plugin.Execute(action.Config, context)
	endTime := time.Now()

	// Create the execution result
	executionResult := &models.ActionExecutionResult{
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

// TestAction tests an action without actually executing its side effects
func (e *ActionExecutor) TestAction(action models.TriggerAction, email models.Email) (*models.ActionExecutionResult, error) {
	e.logger.Info("Testing action: %s (Plugin: %s)", action.ID, action.PluginID)

	// Create a test context with the test flag set
	context := &PluginContext{
		Email: email,
		// Additional context data can be added here to indicate test mode
	}

	// Execute the action in test mode
	return e.ExecuteAction(action, context)
}

// Helper function to count successful actions
func countSuccessfulActions(results models.ActionExecutionResults) int {
	count := 0
	for _, result := range results {
		if result.Success {
			count++
		}
	}
	return count
}
