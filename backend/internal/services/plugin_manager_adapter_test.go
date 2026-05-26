package services

import (
	"strings"
	"testing"
	"time"

	"mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
	v2plugins "mailman/internal/triggerv2/plugins"
)

func TestPluginV2AdapterPassesConfigAndEmailEvent(t *testing.T) {
	pm := &recordingV2PluginManager{
		plugin: &recordingV2Plugin{id: "ai_process_action"},
	}
	adapter := NewPluginManagerV2Adapter(pm)

	plugin, err := adapter.GetPlugin("ai_process_action")
	if err != nil {
		t.Fatalf("GetPlugin failed: %v", err)
	}

	receivedAt := time.Now().UTC().Truncate(time.Second)
	result, err := plugin.Execute(map[string]interface{}{
		"target_variable": "code",
	}, &PluginContext{
		Email: models.Email{
			ID:             42,
			AccountID:      7,
			Subject:        "Your Code",
			From:           models.StringSlice{"Sender <sender@example.com>"},
			To:             models.StringSlice{"receiver@example.com"},
			MessageID:      "message-42",
			ReceivedAt:     receivedAt,
			Body:           "123456",
			Flags:          models.StringSlice{"UNREAD"},
			HasAttachments: true,
			MailboxName:    "INBOX",
		},
	})
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if result == nil || !result.Success {
		t.Fatalf("Execute result = %+v, want success", result)
	}
	if pm.seenConfig == nil || pm.seenConfig.Config["target_variable"] != "code" {
		t.Fatalf("adapter did not pass action config: %+v", pm.seenConfig)
	}
	if pm.seenEvent == nil {
		t.Fatal("adapter did not pass a trigger event")
	}

	var emailData triggerModels.EmailEventData
	if err := pm.seenEvent.GetData(&emailData); err != nil {
		t.Fatalf("failed to decode event data: %v", err)
	}
	if emailData.EmailID != 42 || emailData.AccountID != 7 || emailData.Subject != "Your Code" {
		t.Fatalf("unexpected email event data: %+v", emailData)
	}
	if emailData.From != "Sender <sender@example.com>" || emailData.To != "receiver@example.com" {
		t.Fatalf("unexpected email addresses: from=%q to=%q", emailData.From, emailData.To)
	}
	if !emailData.HasAttachment || emailData.IsRead {
		t.Fatalf("unexpected read/attachment flags: %+v", emailData)
	}
}

func TestParallelActionExecutorConvertsPluginPanicToFailure(t *testing.T) {
	executor := NewParallelActionExecutor(&staticActionPluginProvider{
		plugin: panicActionPlugin{},
	}, 1)

	results, err := executor.ExecuteActions([]models.TriggerAction{
		{
			ID:       "action-panic",
			PluginID: "panic_plugin",
			Config:   models.JSONMapInterface{},
			Enabled:  true,
		},
	}, models.Email{})

	if err == nil {
		t.Fatal("expected panic to be returned as an error")
	}
	if len(results) != 1 {
		t.Fatalf("results length = %d, want 1", len(results))
	}
	if results[0].Success {
		t.Fatalf("panic result should fail: %+v", results[0])
	}
	if !strings.Contains(results[0].Error, "action panic") {
		t.Fatalf("panic error = %q, want action panic", results[0].Error)
	}
}

type recordingV2PluginManager struct {
	v2plugins.PluginManager
	plugin     v2plugins.Plugin
	seenConfig *v2plugins.PluginConfig
	seenEvent  *triggerModels.Event
}

func (m *recordingV2PluginManager) GetPlugin(pluginID string) (v2plugins.Plugin, error) {
	return m.plugin, nil
}

func (m *recordingV2PluginManager) ExecuteAction(pluginID string, ctx *v2plugins.PluginContext, event *triggerModels.Event) (*v2plugins.PluginResult, error) {
	m.seenConfig = ctx.Config
	m.seenEvent = event
	return &v2plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"ok": true,
		},
	}, nil
}

type recordingV2Plugin struct {
	v2plugins.Plugin
	id string
}

func (p *recordingV2Plugin) GetInfo() *v2plugins.PluginInfo {
	return &v2plugins.PluginInfo{
		ID:   p.id,
		Name: p.id,
	}
}

type staticActionPluginProvider struct {
	plugin Plugin
}

func (p *staticActionPluginProvider) GetPlugin(pluginID string) (Plugin, error) {
	return p.plugin, nil
}

type panicActionPlugin struct{}

func (panicActionPlugin) Execute(config map[string]interface{}, context *PluginContext) (*PluginResult, error) {
	panic("boom")
}

func (panicActionPlugin) GetName() string {
	return "panic"
}

func (panicActionPlugin) GetDescription() string {
	return "panic"
}

func (panicActionPlugin) GetConfigSchema() map[string]interface{} {
	return nil
}
