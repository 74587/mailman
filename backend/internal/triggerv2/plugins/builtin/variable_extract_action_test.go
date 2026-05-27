package builtin

import (
	"strings"
	"testing"

	"mailman/internal/models"
	triggerModels "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

func TestVariableExtractActionInvalidJavaScriptReturnsFailure(t *testing.T) {
	plugin := NewVariableExtractActionPlugin()
	config := map[string]interface{}{
		"source":          "email",
		"source_field":    "body",
		"expression_type": "javascript",
		"expression":      `value.match(/(\d+{6})/)[0]`,
		"output_name":     "code",
		"return_type":     "string",
	}
	if err := plugin.ApplyConfig(config); err != nil {
		t.Fatalf("ApplyConfig failed: %v", err)
	}

	email := &models.Email{
		Subject: "Your Dia Code",
		Body:    "652015 Use this code to continue in Dia.",
	}
	event, err := triggerModels.NewEvent(triggerModels.EventTypeEmailReceived, "test", email.Subject, triggerModels.EmailEventData{
		Email: email,
	})
	if err != nil {
		t.Fatalf("NewEvent failed: %v", err)
	}

	result, err := plugin.Execute(&plugins.PluginContext{}, event)
	if err != nil {
		t.Fatalf("Execute returned unexpected error: %v", err)
	}
	if result == nil {
		t.Fatal("expected plugin result")
	}
	if result.Success {
		t.Fatalf("expected invalid JavaScript to fail, got %+v", result)
	}
	if strings.Contains(result.Error, "panic") {
		t.Fatalf("expected validation failure, not panic: %s", result.Error)
	}
	if !strings.Contains(result.Error, "JavaScript") {
		t.Fatalf("expected JavaScript error, got %q", result.Error)
	}
}

func TestVariableExtractActionNilEventReturnsFailure(t *testing.T) {
	plugin := NewVariableExtractActionPlugin()
	if err := plugin.ApplyConfig(map[string]interface{}{
		"source":       "email",
		"source_field": "body",
	}); err != nil {
		t.Fatalf("ApplyConfig failed: %v", err)
	}

	result, err := plugin.Execute(&plugins.PluginContext{}, nil)
	if err != nil {
		t.Fatalf("Execute returned unexpected error: %v", err)
	}
	if result == nil {
		t.Fatal("expected plugin result")
	}
	if result.Success {
		t.Fatalf("expected nil event to fail, got %+v", result)
	}
	if strings.Contains(result.Error, "panic") {
		t.Fatalf("expected nil event failure, not panic: %s", result.Error)
	}
}
