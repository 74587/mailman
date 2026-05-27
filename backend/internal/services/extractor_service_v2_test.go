package services

import (
	"testing"

	"mailman/internal/models"
)

// Helper to create a string pointer
func strPtr(s string) *string { return &s }

// Helper to create a bool pointer
func boolPtr(b bool) *bool { return &b }

// Helper to create an operator pointer
func opPtr(op models.TriggerOperator) *models.TriggerOperator { return &op }

// =============================================================================
// FilterEvaluatorService Tests
// =============================================================================

func TestFilterEvaluator_EmptyExpressions(t *testing.T) {
	svc := NewFilterEvaluatorService()
	result, err := svc.Evaluate(models.TriggerExpressions{}, map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result {
		t.Error("empty expressions should return true")
	}
}

func TestFilterEvaluator_SimpleCondition_Equals(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Hello World",
		"from":    "test@example.com",
	}

	exprs := models.TriggerExpressions{
		{
			Type:  models.TriggerExpressionTypeCondition,
			Field: strPtr("subject"),
			Value: map[string]interface{}{
				"operator": "equals",
				"value":    "Hello World",
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result {
		t.Error("expected match for equal subject")
	}
}

func TestFilterEvaluator_SimpleCondition_NotEquals(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Hello World",
	}

	exprs := models.TriggerExpressions{
		{
			Type:  models.TriggerExpressionTypeCondition,
			Field: strPtr("subject"),
			Value: map[string]interface{}{
				"operator": "equals",
				"value":    "Goodbye",
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result {
		t.Error("expected no match for different subject")
	}
}

func TestFilterEvaluator_Contains(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"body": "This is a test email with important content",
	}

	exprs := models.TriggerExpressions{
		{
			Type:  models.TriggerExpressionTypeCondition,
			Field: strPtr("body"),
			Value: map[string]interface{}{
				"operator": "contains",
				"value":    "important",
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result {
		t.Error("expected match for contains")
	}
}

func TestFilterEvaluator_RegexMatch(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Order #12345 Confirmation",
	}

	exprs := models.TriggerExpressions{
		{
			Type:  models.TriggerExpressionTypeCondition,
			Field: strPtr("subject"),
			Value: map[string]interface{}{
				"operator": "regex",
				"value":    `Order #\d+ Confirmation`,
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result {
		t.Error("expected regex match")
	}
}

func TestFilterEvaluator_RegexNoMatch(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Hello World",
	}

	exprs := models.TriggerExpressions{
		{
			Type:  models.TriggerExpressionTypeCondition,
			Field: strPtr("subject"),
			Value: map[string]interface{}{
				"operator": "regex",
				"value":    `^Order #\d+`,
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result {
		t.Error("expected no regex match")
	}
}

func TestFilterEvaluator_GroupAnd(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Order Confirmation",
		"from":    "shop@example.com",
	}

	andOp := models.TriggerOperatorAnd
	exprs := models.TriggerExpressions{
		{
			Type:     models.TriggerExpressionTypeGroup,
			Operator: &andOp,
			Conditions: []models.TriggerExpression{
				{
					Type:  models.TriggerExpressionTypeCondition,
					Field: strPtr("subject"),
					Value: map[string]interface{}{
						"operator": "contains",
						"value":    "Order",
					},
				},
				{
					Type:  models.TriggerExpressionTypeCondition,
					Field: strPtr("from"),
					Value: map[string]interface{}{
						"operator": "equals",
						"value":    "shop@example.com",
					},
				},
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result {
		t.Error("expected AND group to match")
	}
}

func TestFilterEvaluator_GroupAnd_OneFails(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Order Confirmation",
		"from":    "other@example.com",
	}

	andOp := models.TriggerOperatorAnd
	exprs := models.TriggerExpressions{
		{
			Type:     models.TriggerExpressionTypeGroup,
			Operator: &andOp,
			Conditions: []models.TriggerExpression{
				{
					Type:  models.TriggerExpressionTypeCondition,
					Field: strPtr("subject"),
					Value: map[string]interface{}{
						"operator": "contains",
						"value":    "Order",
					},
				},
				{
					Type:  models.TriggerExpressionTypeCondition,
					Field: strPtr("from"),
					Value: map[string]interface{}{
						"operator": "equals",
						"value":    "shop@example.com",
					},
				},
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result {
		t.Error("expected AND group to fail when one condition doesn't match")
	}
}

func TestFilterEvaluator_GroupOr(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Something else",
		"from":    "vip@example.com",
	}

	orOp := models.TriggerOperatorOr
	exprs := models.TriggerExpressions{
		{
			Type:     models.TriggerExpressionTypeGroup,
			Operator: &orOp,
			Conditions: []models.TriggerExpression{
				{
					Type:  models.TriggerExpressionTypeCondition,
					Field: strPtr("subject"),
					Value: map[string]interface{}{
						"operator": "contains",
						"value":    "Order",
					},
				},
				{
					Type:  models.TriggerExpressionTypeCondition,
					Field: strPtr("from"),
					Value: map[string]interface{}{
						"operator": "equals",
						"value":    "vip@example.com",
					},
				},
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result {
		t.Error("expected OR group to match when one condition matches")
	}
}

func TestFilterEvaluator_NotOperator(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Hello World",
	}

	exprs := models.TriggerExpressions{
		{
			Type:  models.TriggerExpressionTypeCondition,
			Field: strPtr("subject"),
			Not:   boolPtr(true),
			Value: map[string]interface{}{
				"operator": "contains",
				"value":    "Spam",
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result {
		t.Error("expected NOT(contains 'Spam') to be true for 'Hello World'")
	}
}

func TestFilterEvaluator_NotOperator_Invert(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Spam message",
	}

	exprs := models.TriggerExpressions{
		{
			Type:  models.TriggerExpressionTypeCondition,
			Field: strPtr("subject"),
			Not:   boolPtr(true),
			Value: map[string]interface{}{
				"operator": "contains",
				"value":    "Spam",
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result {
		t.Error("expected NOT(contains 'Spam') to be false for 'Spam message'")
	}
}

func TestFilterEvaluator_FieldNotExists(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"subject": "Hello",
	}

	exprs := models.TriggerExpressions{
		{
			Type:  models.TriggerExpressionTypeCondition,
			Field: strPtr("nonexistent_field"),
			Value: map[string]interface{}{
				"operator": "equals",
				"value":    "anything",
			},
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result {
		t.Error("expected false for nonexistent field")
	}
}

func TestFilterEvaluator_StartsWithEndsWith(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"from": "admin@example.com",
	}

	tests := []struct {
		name     string
		operator string
		value    string
		expected bool
	}{
		{"starts_with match", "starts_with", "admin@", true},
		{"starts_with no match", "starts_with", "user@", false},
		{"ends_with match", "ends_with", "@example.com", true},
		{"ends_with no match", "ends_with", "@other.com", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			exprs := models.TriggerExpressions{
				{
					Type:  models.TriggerExpressionTypeCondition,
					Field: strPtr("from"),
					Value: map[string]interface{}{
						"operator": tt.operator,
						"value":    tt.value,
					},
				},
			}

			result, err := svc.Evaluate(exprs, ctx)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestFilterEvaluator_IsEmpty(t *testing.T) {
	svc := NewFilterEvaluatorService()

	tests := []struct {
		name     string
		value    interface{}
		operator string
		expected bool
	}{
		{"empty string is_empty", "", "is_empty", true},
		{"non-empty string is_empty", "hello", "is_empty", false},
		{"empty string is_not_empty", "", "is_not_empty", false},
		{"non-empty string is_not_empty", "hello", "is_not_empty", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := map[string]interface{}{
				"field": tt.value,
			}
			exprs := models.TriggerExpressions{
				{
					Type:  models.TriggerExpressionTypeCondition,
					Field: strPtr("field"),
					Value: map[string]interface{}{
						"operator": tt.operator,
						"value":    "",
					},
				},
			}

			result, err := svc.Evaluate(exprs, ctx)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestFilterEvaluator_SimpleValueComparison(t *testing.T) {
	svc := NewFilterEvaluatorService()

	ctx := map[string]interface{}{
		"status": "active",
	}

	// When value is not a map, it defaults to equals comparison
	exprs := models.TriggerExpressions{
		{
			Type:  models.TriggerExpressionTypeCondition,
			Field: strPtr("status"),
			Value: "active",
		},
	}

	result, err := svc.Evaluate(exprs, ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result {
		t.Error("expected simple value comparison to match")
	}
}

func TestFilterEvaluator_UnknownExpressionType(t *testing.T) {
	svc := NewFilterEvaluatorService()

	exprs := models.TriggerExpressions{
		{
			Type: TriggerExpressionType("unknown_type"),
		},
	}

	_, err := svc.Evaluate(exprs, map[string]interface{}{})
	if err == nil {
		t.Error("expected error for unknown expression type")
	}
}

func TestFilterEvaluator_ConditionMissingField(t *testing.T) {
	svc := NewFilterEvaluatorService()

	exprs := models.TriggerExpressions{
		{
			Type: models.TriggerExpressionTypeCondition,
			// Field is nil
		},
	}

	_, err := svc.Evaluate(exprs, map[string]interface{}{})
	if err == nil {
		t.Error("expected error for missing field")
	}
}

// =============================================================================
// ActionExecutorService Tests (no DB dependency for these action types)
// =============================================================================

func TestActionExecutor_JSONPathAction(t *testing.T) {
	svc := &ActionExecutorService{}

	action := models.TriggerAction{
		PluginID: "jsonpath",
		Config: map[string]interface{}{
			"path": "$.name",
		},
	}

	input := map[string]interface{}{
		"name":  "John Doe",
		"email": "john@example.com",
	}

	result, err := svc.ExecuteAction(action, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["value"] != "John Doe" {
		t.Errorf("expected 'John Doe', got %v", result["value"])
	}
	if result["path"] != "$.name" {
		t.Errorf("expected path '$.name', got %v", result["path"])
	}
}

func TestActionExecutor_JSONPathAction_Nested(t *testing.T) {
	svc := &ActionExecutorService{}

	action := models.TriggerAction{
		PluginID: "jsonpath",
		Config: map[string]interface{}{
			"path": "$.user.name",
		},
	}

	input := map[string]interface{}{
		"user": map[string]interface{}{
			"name":  "Jane",
			"email": "jane@example.com",
		},
	}

	result, err := svc.ExecuteAction(action, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["value"] != "Jane" {
		t.Errorf("expected 'Jane', got %v", result["value"])
	}
}

func TestActionExecutor_JSONPathAction_MissingPath(t *testing.T) {
	svc := &ActionExecutorService{}

	action := models.TriggerAction{
		PluginID: "jsonpath",
		Config:   map[string]interface{}{},
	}

	_, err := svc.ExecuteAction(action, map[string]interface{}{})
	if err == nil {
		t.Error("expected error for missing JSONPath expression")
	}
}

func TestActionExecutor_EmailTransformAction_Replace(t *testing.T) {
	svc := &ActionExecutorService{}

	action := models.TriggerAction{
		PluginID: "email_transform",
		Config: map[string]interface{}{
			"rules": []interface{}{
				map[string]interface{}{
					"field":     "subject",
					"transform": "replace",
					"search":    "OLD",
					"value":     "NEW",
				},
			},
		},
	}

	input := map[string]interface{}{
		"subject": "This is OLD content",
		"body":    "Hello",
	}

	result, err := svc.ExecuteAction(action, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["subject"] != "This is NEW content" {
		t.Errorf("expected 'This is NEW content', got %v", result["subject"])
	}
	// Body should be preserved
	if result["body"] != "Hello" {
		t.Errorf("expected body to be preserved, got %v", result["body"])
	}
}

func TestActionExecutor_EmailTransformAction_PrefixSuffix(t *testing.T) {
	svc := &ActionExecutorService{}

	action := models.TriggerAction{
		PluginID: "email_transform",
		Config: map[string]interface{}{
			"rules": []interface{}{
				map[string]interface{}{
					"field":     "subject",
					"transform": "prefix",
					"value":     "[INFO] ",
				},
				map[string]interface{}{
					"field":     "subject",
					"transform": "suffix",
					"value":     " [END]",
				},
			},
		},
	}

	input := map[string]interface{}{
		"subject": "Test",
	}

	result, err := svc.ExecuteAction(action, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Note: rules are applied sequentially, first prefix then suffix
	expected := "[INFO] Test [END]"
	if result["subject"] != expected {
		t.Errorf("expected %q, got %v", expected, result["subject"])
	}
}

func TestActionExecutor_EmailTransformAction_CaseTransforms(t *testing.T) {
	svc := &ActionExecutorService{}

	tests := []struct {
		name      string
		transform string
		input     string
		expected  string
	}{
		{"lower", "lower", "Hello World", "hello world"},
		{"upper", "upper", "Hello World", "HELLO WORLD"},
		{"trim", "trim", "  Hello World  ", "Hello World"},
		{"set", "set", "anything", "new value"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := map[string]interface{}{
				"field":     "subject",
				"transform": tt.transform,
				"value":     "new value",
			}

			action := models.TriggerAction{
				PluginID: "email_transform",
				Config: map[string]interface{}{
					"rules": []interface{}{rule},
				},
			}

			input := map[string]interface{}{
				"subject": tt.input,
			}

			result, err := svc.ExecuteAction(action, input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if result["subject"] != tt.expected {
				t.Errorf("expected %q, got %v", tt.expected, result["subject"])
			}
		})
	}
}

func TestActionExecutor_VariableExtractAction(t *testing.T) {
	svc := &ActionExecutorService{}

	action := models.TriggerAction{
		PluginID: "variable_extract_action",
		Config: map[string]interface{}{
			"source":          "email",
			"source_field":    "body",
			"expression_type": "javascript",
			"expression":      `value.match(/(\d{6})/)[0]`,
			"output_name":     "code",
			"return_type":     "string",
		},
	}

	result, err := svc.ExecuteAction(action, map[string]interface{}{
		"subject": "Your Dia Code",
		"body":    "652015 Use this code to continue in Dia.",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["value"] != "652015" {
		t.Errorf("expected value '652015', got %v", result["value"])
	}
	if result["code"] != "652015" {
		t.Errorf("expected code '652015', got %v", result["code"])
	}
	if result["extracted_value"] != "652015" {
		t.Errorf("expected extracted_value '652015', got %v", result["extracted_value"])
	}
}

func TestExtractorServiceV2_VariableExtractOutputField(t *testing.T) {
	svc := &ExtractorServiceV2{
		filterEvaluator: NewFilterEvaluatorService(),
		actionExecutor:  &ActionExecutorService{},
	}

	template := &models.ExtractorTemplateV2{
		Enabled: true,
		Actions: models.TriggerActions{
			{
				ID:       "extract-code",
				PluginID: "variable_extract_action",
				Config: map[string]interface{}{
					"source":          "email",
					"source_field":    "body",
					"expression_type": "javascript",
					"expression":      `value.match(/(\d{6})/)[0]`,
					"output_name":     "code",
					"return_type":     "string",
				},
				Enabled: true,
			},
		},
		OutputConfig: models.ExtractorOutputConfig{
			Format: models.ExtractorOutputFormatText,
			Field:  "code",
		},
	}

	result, err := svc.TestExtraction(template, &models.Email{
		Subject: "Your Dia Code",
		Body:    "652015 Use this code to continue in Dia.",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Success {
		t.Fatalf("expected successful extraction, got status=%s error=%s", result.Status, result.Error)
	}
	if result.ExtractedValue != "652015" {
		t.Errorf("expected extracted value '652015', got %v", result.ExtractedValue)
	}
}

func TestActionExecutor_ConditionalBranchRunsNestedActionConfig(t *testing.T) {
	svc := &ActionExecutorService{}

	action := models.TriggerAction{
		PluginID: "conditional_branch_action",
		Config: map[string]interface{}{
			"branches": []interface{}{
				map[string]interface{}{
					"name": "default",
					"actions": []interface{}{
						map[string]interface{}{
							"plugin_id": "variable_extract_action",
							"enabled":   true,
							"config": map[string]interface{}{
								"source":          "email",
								"source_field":    "body",
								"expression_type": "javascript",
								"expression":      `value.match(/(\d{6})/)[0]`,
								"output_name":     "code",
								"return_type":     "string",
							},
						},
					},
				},
			},
			"return_first_match": true,
		},
	}

	result, err := svc.ExecuteAction(action, map[string]interface{}{
		"subject": "Your Dia Code",
		"body":    "652015 Use this code to continue in Dia.",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	lastBranchResult, ok := result["last_branch_result"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected last_branch_result map, got %T: %v", result["last_branch_result"], result["last_branch_result"])
	}
	if lastBranchResult["extracted_value"] != "652015" {
		t.Errorf("expected nested extracted_value '652015', got %v", lastBranchResult["extracted_value"])
	}
	if result["code"] != "652015" {
		t.Errorf("expected output variable code '652015', got %v", result["code"])
	}
}

func TestExtractorServiceV2_ReturnActionStopsPipeline(t *testing.T) {
	svc := &ExtractorServiceV2{
		filterEvaluator: NewFilterEvaluatorService(),
		actionExecutor:  &ActionExecutorService{},
	}

	template := &models.ExtractorTemplateV2{
		Enabled: true,
		Actions: models.TriggerActions{
			{
				ID:       "return-now",
				PluginID: "return_action",
				Config: map[string]interface{}{
					"return_value": "manual-code",
					"return_type":  "string",
					"success":      true,
				},
				Enabled: true,
			},
			{
				ID:       "should-not-run",
				PluginID: "variable_extract_action",
				Config: map[string]interface{}{
					"source":          "email",
					"source_field":    "body",
					"expression_type": "javascript",
					"expression":      `value.match(/(\d{6})/)[0]`,
					"output_name":     "code",
					"return_type":     "string",
				},
				Enabled: true,
			},
		},
		OutputConfig: models.ExtractorOutputConfig{
			Format: models.ExtractorOutputFormatText,
			Field:  "return_value",
		},
	}

	result, err := svc.TestExtraction(template, &models.Email{
		Subject: "Your Dia Code",
		Body:    "652015 Use this code to continue in Dia.",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Success {
		t.Fatalf("expected successful extraction, got status=%s error=%s", result.Status, result.Error)
	}
	if result.ExtractedValue != "manual-code" {
		t.Errorf("expected extracted value 'manual-code', got %v", result.ExtractedValue)
	}
	if len(result.ActionResults) != 1 {
		t.Fatalf("expected only return action to execute, got %d actions", len(result.ActionResults))
	}
	if !result.ActionResults[0].StopPipeline {
		t.Fatal("expected return action to stop pipeline")
	}
}

func TestActionExecutor_UnknownPlugin(t *testing.T) {
	svc := &ActionExecutorService{}

	action := models.TriggerAction{
		PluginID: "nonexistent_plugin",
		Config:   map[string]interface{}{},
	}

	_, err := svc.ExecuteAction(action, map[string]interface{}{})
	if err == nil {
		t.Error("expected error for unknown plugin")
	}
}

// Alias for cleaner test code
type TriggerExpressionType = models.TriggerExpressionType
