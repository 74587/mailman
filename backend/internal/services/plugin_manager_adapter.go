package services

import (
	stdctx "context"
	"fmt"

	"mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
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

func (a *pluginV2Adapter) Execute(config map[string]interface{}, ctx *PluginContext) (*PluginResult, error) {
	if config == nil {
		config = make(map[string]interface{})
	}
	if ctx == nil {
		ctx = &PluginContext{}
	}

	event, err := buildTriggerV2EmailEvent(ctx.Email)
	if err != nil {
		return &PluginResult{
			Success: false,
			Error:   err.Error(),
		}, err
	}

	// Use the plugin manager's ExecuteAction which handles the full execution pipeline
	// including type assertion to ActionPlugin
	pluginCtx := &plugins.PluginContext{
		Context:  stdctx.Background(),
		PluginID: a.pluginID,
		Config: &plugins.PluginConfig{
			Enabled: true,
			Config:  config,
		},
		Event: event,
	}

	result, err := a.pm.ExecuteAction(a.pluginID, pluginCtx, event)
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

func buildTriggerV2EmailEvent(email models.Email) (*triggerModels.Event, error) {
	from := ""
	if len(email.From) > 0 {
		from = email.From[0]
	}
	if from == "" {
		from = email.FromAddress
	}

	to := ""
	if len(email.To) > 0 {
		to = email.To[0]
	}
	if to == "" && len(email.ToAddresses) > 0 {
		to = email.ToAddresses[0]
	}

	receivedAt := email.ReceivedAt
	if receivedAt.IsZero() {
		receivedAt = email.Date
	}

	emailData := triggerModels.EmailEventData{
		Email:         &email,
		EmailID:       email.ID,
		AccountID:     email.AccountID,
		Subject:       email.Subject,
		From:          from,
		To:            to,
		MessageID:     email.MessageID,
		ReceivedAt:    receivedAt,
		HasAttachment: email.HasAttachments,
		IsRead:        !contains(email.Flags, "UNREAD"),
		Labels:        email.Flags,
		EventType:     "received",
		MailboxName:   email.MailboxName,
	}

	event, err := triggerModels.NewEvent(triggerModels.EventTypeEmailReceived, "mailman", email.Subject, emailData)
	if err != nil {
		return nil, fmt.Errorf("failed to build trigger event: %w", err)
	}
	event.Variables = make(map[string]interface{})
	return event, nil
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
