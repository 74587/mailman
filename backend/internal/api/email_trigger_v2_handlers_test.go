package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mailman/internal/models"
	"mailman/internal/services"
	"mailman/internal/triggerv2/plugins"
	"mailman/internal/triggerv2/plugins/builtin"
)

func TestEmailTriggerV2ControllerUsesV2PluginsForActionTests(t *testing.T) {
	pluginManager := plugins.NewTriggerV2PluginManager(plugins.DefaultPluginManagerConfig())
	if err := builtin.RegisterBuiltinPlugins(pluginManager); err != nil {
		t.Fatalf("failed to register builtin plugins: %v", err)
	}

	controller := NewEmailTriggerV2Controller(
		nil,
		nil,
		nil,
		nil,
		pluginManager,
		nil,
		services.NewConditionEngine(pluginManager),
	)

	results, err := controller.actionExecutor.ExecuteActionsWithContext([]models.TriggerAction{{
		ID:         "extract-code",
		PluginID:   "variable_extract_action",
		PluginName: "变量提取",
		Config: models.JSONMapInterface{
			"source":          "email",
			"source_field":    "body",
			"expression_type": "javascript",
			"expression":      `value.match(/(\d{6})/)[0]`,
			"output_name":     "code",
			"return_type":     "string",
		},
		Enabled:        true,
		ExecutionOrder: 1,
	}}, models.Email{
		Subject: "Your Dia Code",
		Body:    "652015 Use this code to continue in Dia.",
	}, 0)

	if err != nil {
		t.Fatalf("unexpected action test error: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("result length = %d, want 1", len(results))
	}
	result := results[0]
	if !result.Success {
		t.Fatalf("expected action success, got %+v", result)
	}

	data, ok := result.Result.(map[string]interface{})
	if !ok {
		t.Fatalf("result data = %#v, want map", result.Result)
	}
	if data["extracted_value"] != "652015" {
		t.Fatalf("extracted_value = %#v, want 652015", data["extracted_value"])
	}
}

func TestCompleteTriggerHandlerExecutesV2ActionPlugins(t *testing.T) {
	pluginManager := plugins.NewTriggerV2PluginManager(plugins.DefaultPluginManagerConfig())
	if err := builtin.RegisterBuiltinPlugins(pluginManager); err != nil {
		t.Fatalf("failed to register builtin plugins: %v", err)
	}

	controller := NewEmailTriggerV2Controller(
		nil,
		nil,
		nil,
		nil,
		pluginManager,
		nil,
		services.NewConditionEngine(pluginManager),
	)
	controller.activityLogger = nil

	operator := models.TriggerOperatorAnd
	pluginID := "always_pass"
	not := false
	requestBody := TestCompleteTriggerRequest{
		Trigger: models.EmailTriggerV2{
			Name:    "temp_test",
			Enabled: true,
			Expressions: models.TriggerExpressions{
				{
					ID:       "root",
					Type:     models.TriggerExpressionTypeGroup,
					Operator: &operator,
					Conditions: []models.TriggerExpression{
						{
							ID:       "always",
							Type:     models.TriggerExpressionTypePlugin,
							PluginID: &pluginID,
							Not:      &not,
						},
					},
				},
			},
			Actions: models.TriggerActions{
				{
					ID:         "extract-code",
					PluginID:   "variable_extract_action",
					PluginName: "变量提取",
					Config: models.JSONMapInterface{
						"source":          "email",
						"source_field":    "body",
						"expression_type": "javascript",
						"expression":      `value.match(/(\d{6})/)[0]`,
						"output_name":     "code",
						"return_type":     "string",
					},
					Enabled:        true,
					ExecutionOrder: 1,
				},
			},
		},
		TestData: map[string]interface{}{
			"Subject": "Your Dia Code",
			"Body":    "652015 Use this code to continue in Dia.",
		},
	}

	body, err := json.Marshal(requestBody)
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v2/triggers/test-complete", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	controller.TestCompleteTriggerHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response TestCompleteTriggerResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !response.ConditionResult {
		t.Fatalf("expected condition to pass: %+v", response.ConditionEval)
	}
	if response.ActionsExecuted != 1 || response.ActionsSucceeded != 1 {
		t.Fatalf("unexpected action counts: executed=%d succeeded=%d error=%q results=%+v", response.ActionsExecuted, response.ActionsSucceeded, response.Error, response.ActionResults)
	}
	if len(response.ActionResults) != 1 || !response.ActionResults[0].Success {
		t.Fatalf("expected successful action result: %+v", response.ActionResults)
	}
}

func TestCompleteTriggerHandlerInvalidVariableExtractDoesNotPanic(t *testing.T) {
	pluginManager := plugins.NewTriggerV2PluginManager(plugins.DefaultPluginManagerConfig())
	if err := builtin.RegisterBuiltinPlugins(pluginManager); err != nil {
		t.Fatalf("failed to register builtin plugins: %v", err)
	}

	controller := NewEmailTriggerV2Controller(
		nil,
		nil,
		nil,
		nil,
		pluginManager,
		nil,
		services.NewConditionEngine(pluginManager),
	)
	controller.activityLogger = nil

	operator := models.TriggerOperatorAnd
	pluginID := "always_pass"
	not := false
	requestBody := TestCompleteTriggerRequest{
		Trigger: models.EmailTriggerV2{
			Name:    "temp_test",
			Enabled: true,
			Expressions: models.TriggerExpressions{
				{
					ID:       "root",
					Type:     models.TriggerExpressionTypeGroup,
					Operator: &operator,
					Conditions: []models.TriggerExpression{
						{
							ID:       "always",
							Type:     models.TriggerExpressionTypePlugin,
							PluginID: &pluginID,
							Not:      &not,
						},
					},
				},
			},
			Actions: models.TriggerActions{
				{
					ID:         "extract-code",
					PluginID:   "variable_extract_action",
					PluginName: "变量提取",
					Config: models.JSONMapInterface{
						"source":          "email",
						"source_field":    "body",
						"expression_type": "javascript",
						"expression":      `value.match(/(\d+{6})/)[0]`,
						"output_name":     "code",
						"return_type":     "string",
					},
					Enabled:        true,
					ExecutionOrder: 1,
				},
			},
		},
		TestData: map[string]interface{}{
			"Subject": "Your Dia Code",
			"Body":    "652015 Use this code to continue in Dia.",
		},
	}

	body, err := json.Marshal(requestBody)
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v2/triggers/test-complete", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	controller.TestCompleteTriggerHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response TestCompleteTriggerResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.ActionsSucceeded != 0 {
		t.Fatalf("expected action failure, got succeeded=%d", response.ActionsSucceeded)
	}
	if len(response.ActionResults) != 1 || response.ActionResults[0].Success {
		t.Fatalf("expected failed action result: %+v", response.ActionResults)
	}
	if strings.Contains(response.ActionResults[0].Error, "panic") {
		t.Fatalf("expected validation failure, not panic: %+v", response.ActionResults[0])
	}
}
