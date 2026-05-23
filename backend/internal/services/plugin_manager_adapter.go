package services

import (
	"fmt"

	"mailman/internal/triggerv2/plugins"
)

// PluginManagerV2Adapter wraps plugins.PluginManager to satisfy
// the actionPluginProvider interface used by ActionExecutor, ParallelActionExecutor,
// and EmailTriggerService.
//
// This bridges the gap between the triggerv2 plugin system (plugins.PluginManager)
// and the services plugin system (services.Plugin / actionPluginProvider).
type PluginManagerV2Adapter struct {
	pm plugins.PluginManager
}

// NewPluginManagerV2Adapter creates a new adapter
func NewPluginManagerV2Adapter(pm plugins.PluginManager) *PluginManagerV2Adapter {
	return &PluginManagerV2Adapter{pm: pm}
}

// GetPlugin implements actionPluginProvider by wrapping plugins.Plugin
func (a *PluginManagerV2Adapter) GetPlugin(pluginID string) (Plugin, error) {
	p, err := a.pm.GetPlugin(pluginID)
	if err != nil {
		return nil, err
	}
	return &pluginV2Adapter{p: p, pm: a.pm, pluginID: pluginID}, nil
}

// pluginV2Adapter wraps plugins.Plugin (triggerv2) to satisfy services.Plugin
type pluginV2Adapter struct {
	p        plugins.Plugin
	pm       plugins.PluginManager
	pluginID string
}

func (a *pluginV2Adapter) Execute(config map[string]interface{}, context *PluginContext) (*PluginResult, error) {
	// Use the plugin manager's ExecuteAction which handles the full execution pipeline
	// including type assertion to ActionPlugin
	pluginCtx := &plugins.PluginContext{
		PluginID: a.pluginID,
	}

	result, err := a.pm.ExecuteAction(a.pluginID, pluginCtx, nil)
	if err != nil {
		return &PluginResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	if result == nil {
		return &PluginResult{
			Success: false,
			Error:   "plugin returned nil result",
		}, fmt.Errorf("plugin returned nil result")
	}

	return &PluginResult{
		Success: result.Success,
		Data:    result.Data,
		Error:   result.Error,
	}, nil
}

func (a *pluginV2Adapter) GetName() string {
	info := a.p.GetInfo()
	if info != nil {
		return info.Name
	}
	return a.pluginID
}

func (a *pluginV2Adapter) GetDescription() string {
	info := a.p.GetInfo()
	if info != nil {
		return info.Description
	}
	return ""
}

func (a *pluginV2Adapter) GetConfigSchema() map[string]interface{} {
	return a.p.GetDefaultConfig()
}

// Compile-time interface checks
var _ actionPluginProvider = (*PluginManagerV2Adapter)(nil)
var _ Plugin = (*pluginV2Adapter)(nil)
