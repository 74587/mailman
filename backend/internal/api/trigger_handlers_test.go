package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"mailman/internal/triggerv2/plugins"
	"mailman/internal/triggerv2/plugins/builtin"
)

func TestExecuteActionsHandlerUsesV2ExecutorWithNestedEmailData(t *testing.T) {
	pluginManager := plugins.NewTriggerV2PluginManager(plugins.DefaultPluginManagerConfig())
	if err := builtin.RegisterBuiltinPlugins(pluginManager); err != nil {
		t.Fatalf("failed to register builtin plugins: %v", err)
	}

	handler := NewTriggerAPIHandler(nil, nil, nil, pluginManager, nil)
	handler.activityLogger = nil

	body, err := json.Marshal(ExecuteActionsRequest{
		Actions: []ExecuteActionRequest{
			{
				PluginID: "variable_extract_action",
				Config: map[string]interface{}{
					"source":          "email",
					"source_field":    "body",
					"expression_type": "javascript",
					"expression":      `value.match(/(\d{6})/)[0]`,
					"output_name":     "code",
					"return_type":     "string",
				},
			},
		},
		Data: map[string]interface{}{
			"event": map[string]interface{}{
				"type": "email_received",
				"data": map[string]interface{}{
					"subject": "Your Dia Code",
					"body":    "652015 Use this code to continue in Dia.",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/triggers/execute-actions", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	handler.ExecuteActionsHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response ExecuteActionsResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("results length = %d, want 1", len(response.Results))
	}
	if !response.Results[0].Success {
		t.Fatalf("expected action success, got %+v", response.Results[0])
	}
	if response.Results[0].Result["extracted_value"] != "652015" {
		t.Fatalf("extracted_value = %#v, want 652015", response.Results[0].Result["extracted_value"])
	}
}
