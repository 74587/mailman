package builtin

import (
	"context"

	"mailman/internal/triggerv2/plugins"
)

func childPluginContext(parent *plugins.PluginContext, pluginID string, config map[string]interface{}) *plugins.PluginContext {
	if config == nil {
		config = map[string]interface{}{}
	}

	child := &plugins.PluginContext{
		Context:  context.Background(),
		PluginID: pluginID,
		Config: &plugins.PluginConfig{
			Enabled: true,
			Config:  config,
		},
	}

	if parent == nil {
		return child
	}

	if parent.Context != nil {
		child.Context = parent.Context
	}
	child.Event = parent.Event
	child.TriggerID = parent.TriggerID
	child.Logger = parent.Logger
	child.Metrics = parent.Metrics
	child.Storage = parent.Storage
	child.EventBus = parent.EventBus
	child.Scheduler = parent.Scheduler
	child.Database = parent.Database

	return child
}
