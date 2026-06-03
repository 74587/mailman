package builtin

import (
	"encoding/json"
	"testing"

	mainModels "mailman/internal/models"
	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

func TestEmailHeaderFilterPlugin_Evaluate(t *testing.T) {
	plugin := NewEmailHeaderFilterPlugin().(*EmailHeaderFilterPlugin)
	config := map[string]interface{}{
		"rules": []interface{}{
			map[string]interface{}{
				"name":     "Authentication-Results",
				"operator": "contains",
				"value":    "dmarc=fail",
			},
		},
		"match_mode": "all",
	}
	if err := plugin.ApplyConfig(config); err != nil {
		t.Fatalf("ApplyConfig() error = %v", err)
	}

	event := testPluginEvent(t, models.EmailEventData{
		Email: &mainModels.Email{
			Headers: mainModels.JSONMap{
				"Authentication-Results": "mx.example; spf=pass; dkim=pass; dmarc=fail",
			},
		},
	})
	result, err := plugin.Evaluate(testPluginContext("email_header_filter", config), event)
	if err != nil {
		t.Fatalf("Evaluate() error = %v", err)
	}
	if !result.Success || result.Data["matched"] != true {
		t.Fatalf("expected header filter to match, got success=%v data=%v", result.Success, result.Data)
	}
}

func TestEmailAttachmentFilterPlugin_Evaluate(t *testing.T) {
	plugin := NewEmailAttachmentFilterPlugin().(*EmailAttachmentFilterPlugin)
	config := map[string]interface{}{
		"min_count":          1,
		"allowed_extensions": []interface{}{"pdf"},
		"blocked_extensions": []interface{}{"exe"},
		"max_total_size":     "2MB",
	}
	if err := plugin.ApplyConfig(config); err != nil {
		t.Fatalf("ApplyConfig() error = %v", err)
	}

	event := testPluginEvent(t, models.EmailEventData{
		HasAttachment: true,
		Email: &mainModels.Email{
			HasAttachments: true,
			Attachments: []mainModels.Attachment{
				{Filename: "invoice.pdf", Size: 128 * 1024},
			},
		},
	})
	result, err := plugin.Evaluate(testPluginContext("email_attachment_filter", config), event)
	if err != nil {
		t.Fatalf("Evaluate() error = %v", err)
	}
	if !result.Success || result.Data["matched"] != true {
		t.Fatalf("expected attachment filter to match, got success=%v data=%v", result.Success, result.Data)
	}
}

func TestEmailSecurityFilterPlugin_Evaluate(t *testing.T) {
	plugin := NewEmailSecurityFilterPlugin().(*EmailSecurityFilterPlugin)
	config := map[string]interface{}{"risk_threshold": 50}
	if err := plugin.ApplyConfig(config); err != nil {
		t.Fatalf("ApplyConfig() error = %v", err)
	}

	event := testPluginEvent(t, models.EmailEventData{
		Subject: "Urgent: verify your account",
		Email: &mainModels.Email{
			Subject:  "Urgent: verify your account",
			TextBody: "Open http://192.168.1.10/login immediately.",
			Headers: mainModels.JSONMap{
				"Authentication-Results": "mx.example; spf=fail; dkim=fail; dmarc=fail",
			},
			Attachments: []mainModels.Attachment{
				{Filename: "invoice.exe", Size: 1024},
			},
		},
	})
	result, err := plugin.Evaluate(testPluginContext("email_security_filter", config), event)
	if err != nil {
		t.Fatalf("Evaluate() error = %v", err)
	}
	if !result.Success || result.Data["matched"] != true {
		t.Fatalf("expected security filter to match, got success=%v data=%v", result.Success, result.Data)
	}
	if score, ok := result.Data["risk_score"].(int); !ok || score < 50 {
		t.Fatalf("expected risk score >= 50, got %v", result.Data["risk_score"])
	}
}

func testPluginEvent(t *testing.T, data models.EmailEventData) *models.Event {
	t.Helper()
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("marshal event data: %v", err)
	}
	return &models.Event{
		ID:     "test-event",
		Type:   models.EventTypeEmailReceived,
		Status: models.EventStatusPending,
		Data:   raw,
	}
}

func testPluginContext(pluginID string, config map[string]interface{}) *plugins.PluginContext {
	return &plugins.PluginContext{
		PluginID: pluginID,
		Config: &plugins.PluginConfig{
			Enabled: true,
			Config:  config,
		},
	}
}
