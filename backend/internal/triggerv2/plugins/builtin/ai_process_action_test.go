package builtin

import (
	"encoding/json"
	"strings"
	"testing"

	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

func TestAIProcessActionExecuteHandlesMissingConfig(t *testing.T) {
	plugin := NewAIProcessActionPlugin()
	eventData := triggerModels.EmailEventData{
		EmailID:   1,
		AccountID: 2,
		Subject:   "Your Code",
		From:      "sender@example.com",
		To:        "receiver@example.com",
		MessageID: "message-1",
	}
	data, err := json.Marshal(eventData)
	if err != nil {
		t.Fatalf("failed to marshal event data: %v", err)
	}

	result, err := plugin.Execute(&plugins.PluginContext{}, &triggerModels.Event{
		Data: data,
	})
	if err != nil {
		t.Fatalf("Execute returned unexpected error: %v", err)
	}
	if result == nil {
		t.Fatal("Execute returned nil result")
	}
	if result.Success {
		t.Fatalf("Execute should fail without AI config: %+v", result)
	}
	if !strings.Contains(result.Error, "API Key") {
		t.Fatalf("error = %q, want missing API Key", result.Error)
	}
}

func TestAIProcessActionExecuteHandlesNilEvent(t *testing.T) {
	plugin := NewAIProcessActionPlugin()

	result, err := plugin.Execute(&plugins.PluginContext{}, nil)
	if err != nil {
		t.Fatalf("Execute returned unexpected error: %v", err)
	}
	if result == nil {
		t.Fatal("Execute returned nil result")
	}
	if result.Success {
		t.Fatalf("Execute should fail for nil event: %+v", result)
	}
	if !strings.Contains(result.Error, "事件为空") {
		t.Fatalf("error = %q, want nil event error", result.Error)
	}
}
