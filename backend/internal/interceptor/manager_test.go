package interceptor

import (
	"context"
	"strings"
	"testing"

	"mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

func TestManagerLogsAdvancedFilterSkip(t *testing.T) {
	manager := NewManager()
	plugin := &testInterceptorPlugin{id: "test_interceptor"}
	if err := manager.RegisterPlugin(plugin); err != nil {
		t.Fatalf("RegisterPlugin() error = %v", err)
	}

	manager.SetAdvancedFilterEvaluator(func(filter models.InterceptorFilter, ctx *InterceptorContext) (bool, models.JSONMap, error) {
		return false, models.JSONMap{
			"result":     "false",
			"conditions": `[{"id":"guard","result":false}]`,
		}, nil
	})

	var logs []*models.InterceptorLog
	manager.SetDiagnosticLogWriter(func(logEntry *models.InterceptorLog) error {
		logs = append(logs, logEntry)
		return nil
	})

	config := &InterceptorConfig{
		ID:       42,
		Name:     "高级过滤守卫",
		PluginID: "test_interceptor",
		Enabled:  true,
		Order:    1,
		Scope:    models.InterceptorScopeGlobal,
		Phases:   models.InterceptorPhases{Before: true},
		Filter: models.InterceptorFilter{
			Mode:              models.FilterModeAll,
			UseAdvancedFilter: true,
			Expressions: []any{
				map[string]any{"id": "guard", "type": "plugin", "pluginId": "always_pass"},
			},
		},
		SkipConfig: models.InterceptorSkipConfig{LogSkipped: true},
	}
	if err := manager.LoadConfigs([]*InterceptorConfig{config}); err != nil {
		t.Fatalf("LoadConfigs() error = %v", err)
	}

	result, err := manager.ExecuteBefore(&InterceptorContext{
		Context:   context.Background(),
		Action:    &ActionInfo{ID: "action-1", PluginID: "email_forward_action", PluginName: "转发邮件"},
		Event:     &triggerModels.Event{},
		TriggerID: 7,
		Email:     &models.Email{ID: 99, Subject: "hello"},
	})
	if err != nil {
		t.Fatalf("ExecuteBefore() error = %v", err)
	}
	if result == nil || result.Decision != DecisionContinue || !result.Success {
		t.Fatalf("ExecuteBefore() result = %+v, want continue success", result)
	}
	if plugin.beforeCalls != 0 {
		t.Fatalf("plugin before calls = %d, want 0", plugin.beforeCalls)
	}
	if len(logs) != 1 {
		t.Fatalf("diagnostic logs = %d, want 1", len(logs))
	}

	logEntry := logs[0]
	if logEntry.InterceptorID != 42 || logEntry.ActionID != "action-1" || logEntry.EmailID == nil || *logEntry.EmailID != 99 {
		t.Fatalf("unexpected log entry metadata: %+v", logEntry)
	}
	if logEntry.DecisionMade != string(DecisionContinue) {
		t.Fatalf("DecisionMade = %q, want continue", logEntry.DecisionMade)
	}
	for _, want := range []string{"advanced_filter_not_matched", `"advanced_filter_matched":false`, `"conditions"`} {
		if !strings.Contains(logEntry.InputData, want) {
			t.Fatalf("InputData = %s, want to contain %s", logEntry.InputData, want)
		}
	}
}

type testInterceptorPlugin struct {
	id          string
	beforeCalls int
	afterCalls  int
}

func (p *testInterceptorPlugin) GetInfo() *plugins.PluginInfo {
	return &plugins.PluginInfo{
		ID:          p.id,
		Name:        "Test Interceptor",
		Version:     "1.0.0",
		Description: "test interceptor",
		Type:        plugins.PluginTypeFilter,
	}
}

func (p *testInterceptorPlugin) Initialize(ctx *plugins.PluginContext) error { return nil }
func (p *testInterceptorPlugin) Cleanup() error                              { return nil }
func (p *testInterceptorPlugin) OnLoad() error                               { return nil }
func (p *testInterceptorPlugin) OnUnload() error                             { return nil }
func (p *testInterceptorPlugin) OnActivate() error                           { return nil }
func (p *testInterceptorPlugin) OnDeactivate() error                         { return nil }
func (p *testInterceptorPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{}
}
func (p *testInterceptorPlugin) ValidateConfig(config map[string]interface{}) error {
	return nil
}
func (p *testInterceptorPlugin) ApplyConfig(config map[string]interface{}) error { return nil }
func (p *testInterceptorPlugin) HealthCheck() error                              { return nil }
func (p *testInterceptorPlugin) GetMetrics() map[string]interface{}              { return map[string]interface{}{} }
func (p *testInterceptorPlugin) GetType() Type                                   { return TypeBeforeOnly }
func (p *testInterceptorPlugin) GetSupportedPhases() []Phase                     { return []Phase{PhaseBefore} }
func (p *testInterceptorPlugin) BeforeAction(ctx *InterceptorContext) (*InterceptorResult, error) {
	p.beforeCalls++
	return &InterceptorResult{Decision: DecisionContinue, Success: true}, nil
}
func (p *testInterceptorPlugin) AfterAction(ctx *InterceptorContext) (*InterceptorResult, error) {
	p.afterCalls++
	return &InterceptorResult{Decision: DecisionContinue, Success: true}, nil
}
func (p *testInterceptorPlugin) CanIntercept(action *ActionInfo, phase Phase) bool { return true }
