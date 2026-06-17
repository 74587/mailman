package services

import (
	"fmt"
	"testing"
	"time"

	appModels "mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

func TestActionExecutorV2StopsPipelineOnActionFailure(t *testing.T) {
	manager := plugins.NewTriggerV2PluginManager(plugins.DefaultPluginManagerConfig())
	failPlugin := newExecutorTestActionPlugin("fail_action", false)
	nextPlugin := newExecutorTestActionPlugin("next_action", true)

	if err := manager.RegisterPlugin(failPlugin); err != nil {
		t.Fatalf("RegisterPlugin(fail) error = %v", err)
	}
	if err := manager.RegisterPlugin(nextPlugin); err != nil {
		t.Fatalf("RegisterPlugin(next) error = %v", err)
	}

	executor := NewActionExecutorV2(manager, nil)
	results, err := executor.ExecuteActionsWithContext([]appModels.TriggerAction{
		{
			ID:             "action-1",
			PluginID:       "fail_action",
			PluginName:     "Fail Action",
			Config:         appModels.JSONMapInterface{},
			Enabled:        true,
			ExecutionOrder: 1,
		},
		{
			ID:             "action-2",
			PluginID:       "next_action",
			PluginName:     "Next Action",
			Config:         appModels.JSONMapInterface{},
			Enabled:        true,
			ExecutionOrder: 2,
		},
	}, executorTestEmail(), 42)

	if err == nil {
		t.Fatal("expected failed action to return a pipeline error")
	}
	if len(results) != 1 {
		t.Fatalf("expected only the failed action result, got %d", len(results))
	}
	if !results[0].StopPipeline {
		t.Fatal("expected failed action to stop pipeline")
	}
	if nextPlugin.executions != 0 {
		t.Fatalf("expected next action not to execute, got %d executions", nextPlugin.executions)
	}
}

func TestActionExecutorV2ContinueOnErrorAllowsNextAction(t *testing.T) {
	manager := plugins.NewTriggerV2PluginManager(plugins.DefaultPluginManagerConfig())
	failPlugin := newExecutorTestActionPlugin("fail_action", false)
	nextPlugin := newExecutorTestActionPlugin("next_action", true)

	if err := manager.RegisterPlugin(failPlugin); err != nil {
		t.Fatalf("RegisterPlugin(fail) error = %v", err)
	}
	if err := manager.RegisterPlugin(nextPlugin); err != nil {
		t.Fatalf("RegisterPlugin(next) error = %v", err)
	}

	executor := NewActionExecutorV2(manager, nil)
	results, err := executor.ExecuteActionsWithContext([]appModels.TriggerAction{
		{
			ID:         "action-1",
			PluginID:   "fail_action",
			PluginName: "Fail Action",
			Config: appModels.JSONMapInterface{
				"continue_on_error": true,
			},
			Enabled:        true,
			ExecutionOrder: 1,
		},
		{
			ID:             "action-2",
			PluginID:       "next_action",
			PluginName:     "Next Action",
			Config:         appModels.JSONMapInterface{},
			Enabled:        true,
			ExecutionOrder: 2,
		},
	}, executorTestEmail(), 42)

	if err != nil {
		t.Fatalf("expected continue_on_error to suppress pipeline error, got %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected both action results, got %d", len(results))
	}
	if results[0].StopPipeline {
		t.Fatal("expected failed action not to stop pipeline when continue_on_error=true")
	}
	if nextPlugin.executions != 1 {
		t.Fatalf("expected next action to execute once, got %d executions", nextPlugin.executions)
	}
}

type executorTestActionPlugin struct {
	info       *plugins.PluginInfo
	success    bool
	executions int
}

func newExecutorTestActionPlugin(id string, success bool) *executorTestActionPlugin {
	return &executorTestActionPlugin{
		info: &plugins.PluginInfo{
			ID:          id,
			Name:        id,
			Version:     "1.0.0",
			Description: "test action",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusLoaded,
			LoadedAt:    time.Now(),
		},
		success: success,
	}
}

func (p *executorTestActionPlugin) GetInfo() *plugins.PluginInfo { return p.info }
func (p *executorTestActionPlugin) Initialize(ctx *plugins.PluginContext) error {
	return nil
}
func (p *executorTestActionPlugin) Cleanup() error      { return nil }
func (p *executorTestActionPlugin) OnLoad() error       { return nil }
func (p *executorTestActionPlugin) OnUnload() error     { return nil }
func (p *executorTestActionPlugin) OnActivate() error   { return nil }
func (p *executorTestActionPlugin) OnDeactivate() error { return nil }
func (p *executorTestActionPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{}
}
func (p *executorTestActionPlugin) ValidateConfig(config map[string]interface{}) error {
	return nil
}
func (p *executorTestActionPlugin) ApplyConfig(config map[string]interface{}) error {
	return nil
}
func (p *executorTestActionPlugin) HealthCheck() error { return nil }
func (p *executorTestActionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{}
}
func (p *executorTestActionPlugin) Execute(ctx *plugins.PluginContext, event *triggerModels.Event) (*plugins.PluginResult, error) {
	p.executions++
	if !p.success {
		return &plugins.PluginResult{
			Success: false,
			Error:   fmt.Sprintf("%s failed", p.info.ID),
		}, nil
	}
	return &plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"plugin_id": p.info.ID,
		},
	}, nil
}
func (p *executorTestActionPlugin) GetDescription() string { return p.info.Description }
func (p *executorTestActionPlugin) GetSupportedEventTypes() []string {
	return []string{string(triggerModels.EventTypeEmailReceived)}
}
func (p *executorTestActionPlugin) GetRequiredConfig() []string { return nil }
func (p *executorTestActionPlugin) CanExecute(ctx *plugins.PluginContext, event *triggerModels.Event) bool {
	return true
}
func (p *executorTestActionPlugin) GetExecutionOrder() int { return 0 }

func executorTestEmail() appModels.Email {
	return appModels.Email{
		ID:         1,
		AccountID:  2,
		Subject:    "test",
		From:       []string{"sender@example.com"},
		To:         []string{"receiver@example.com"},
		ReceivedAt: time.Now(),
	}
}
