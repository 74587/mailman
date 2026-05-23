package services

import (
	"testing"
	"time"

	"mailman/internal/models"

	"github.com/stretchr/testify/assert"
)

func TestConditionEngine_Evaluate_SimpleCondition(t *testing.T) {
	// 创建条件引擎
	engine := NewConditionEngine(nil)

	// 创建测试邮件
	email := models.Email{
		ID:      123,
		Subject: "Test Email Subject",
		From:    []string{"sender@example.com"},
		To:      []string{"recipient@example.com"},
		Date:    time.Now(),
	}

	// 创建评估上下文
	context := NewEvaluationContext(email)

	// 创建简单条件表达式：检查邮件主题是否包含 "Test"
	field := "email.subject"
	operator := models.TriggerOperator("contains")
	value := "Test"
	expression := models.TriggerExpression{
		ID:       "test-expr-1",
		Type:     models.TriggerExpressionTypeCondition,
		Operator: &operator,
		Field:    &field,
		Value:    value,
	}

	// 评估条件
	result, details, err := engine.Evaluate(expression, context)

	// 断言
	assert.NoError(t, err)
	assert.True(t, result)
	assert.Equal(t, "test-expr-1", details["expressionId"])
	assert.Equal(t, field, details["field"])
	assert.Equal(t, "contains", details["operator"])
	assert.Equal(t, email.Subject, details["fieldValue"])
	assert.Equal(t, value, details["value"])
}

func TestConditionEngine_Evaluate_NotCondition(t *testing.T) {
	// 创建条件引擎
	engine := NewConditionEngine(nil)

	// 创建测试邮件
	email := models.Email{
		ID:      123,
		Subject: "Test Email Subject",
		From:    []string{"sender@example.com"},
		To:      []string{"recipient@example.com"},
		Date:    time.Now(),
	}

	// 创建评估上下文
	context := NewEvaluationContext(email)

	// 创建否定条件表达式：检查邮件主题是否不包含 "Spam"
	field := "email.subject"
	operator := models.TriggerOperator("contains")
	value := "Spam"
	not := true
	expression := models.TriggerExpression{
		ID:       "test-expr-2",
		Type:     models.TriggerExpressionTypeCondition,
		Operator: &operator,
		Field:    &field,
		Value:    value,
		Not:      &not,
	}

	// 评估条件
	result, details, err := engine.Evaluate(expression, context)

	// 断言
	assert.NoError(t, err)
	assert.True(t, result)
	assert.Equal(t, "test-expr-2", details["expressionId"])
	assert.Equal(t, field, details["field"])
	assert.Equal(t, "contains", details["operator"])
	assert.Equal(t, email.Subject, details["fieldValue"])
	assert.Equal(t, value, details["value"])
	assert.Equal(t, "true", details["not"])
}

func TestConditionEngine_Evaluate_AndGroup(t *testing.T) {
	// 创建条件引擎
	engine := NewConditionEngine(nil)

	// 创建测试邮件
	email := models.Email{
		ID:      123,
		Subject: "Test Email Subject",
		From:    []string{"sender@example.com"},
		To:      []string{"recipient@example.com"},
		Date:    time.Now(),
	}

	// 创建评估上下文
	context := NewEvaluationContext(email)

	// 创建子条件1：检查邮件主题是否包含 "Test"
	field1 := "email.subject"
	operator1 := models.TriggerOperator("contains")
	value1 := "Test"
	expr1 := models.TriggerExpression{
		ID:       "test-expr-3-1",
		Type:     models.TriggerExpressionTypeCondition,
		Operator: &operator1,
		Field:    &field1,
		Value:    value1,
	}

	// 创建子条件2：检查发件人是否包含 "example.com"
	field2 := "email.from.0"
	operator2 := models.TriggerOperator("contains")
	value2 := "example.com"
	expr2 := models.TriggerExpression{
		ID:       "test-expr-3-2",
		Type:     models.TriggerExpressionTypeCondition,
		Operator: &operator2,
		Field:    &field2,
		Value:    value2,
	}

	// 创建 AND 组条件
	andOperator := models.TriggerOperatorAnd
	groupExpr := models.TriggerExpression{
		ID:         "test-expr-3",
		Type:       models.TriggerExpressionTypeGroup,
		Operator:   &andOperator,
		Conditions: []models.TriggerExpression{expr1, expr2},
	}

	// 评估条件
	result, details, err := engine.Evaluate(groupExpr, context)

	// 断言
	assert.NoError(t, err)
	assert.True(t, result)
	assert.Equal(t, "test-expr-3", details["expressionId"])
	assert.Equal(t, "and", details["operator"])
	assert.Equal(t, "All AND conditions succeeded", details["message"])
}

func TestConditionEngine_Evaluate_OrGroup(t *testing.T) {
	// 创建条件引擎
	engine := NewConditionEngine(nil)

	// 创建测试邮件
	email := models.Email{
		ID:      123,
		Subject: "Test Email Subject",
		From:    []string{"sender@example.com"},
		To:      []string{"recipient@example.com"},
		Date:    time.Now(),
	}

	// 创建评估上下文
	context := NewEvaluationContext(email)

	// 创建子条件1：检查邮件主题是否包含 "NonExistent"（将失败）
	field1 := "email.subject"
	operator1 := models.TriggerOperator("contains")
	value1 := "NonExistent"
	expr1 := models.TriggerExpression{
		ID:       "test-expr-4-1",
		Type:     models.TriggerExpressionTypeCondition,
		Operator: &operator1,
		Field:    &field1,
		Value:    value1,
	}

	// 创建子条件2：检查发件人是否包含 "example.com"（将成功）
	field2 := "email.from.0"
	operator2 := models.TriggerOperator("contains")
	value2 := "example.com"
	expr2 := models.TriggerExpression{
		ID:       "test-expr-4-2",
		Type:     models.TriggerExpressionTypeCondition,
		Operator: &operator2,
		Field:    &field2,
		Value:    value2,
	}

	// 创建 OR 组条件
	orOperator := models.TriggerOperatorOr
	groupExpr := models.TriggerExpression{
		ID:         "test-expr-4",
		Type:       models.TriggerExpressionTypeGroup,
		Operator:   &orOperator,
		Conditions: []models.TriggerExpression{expr1, expr2},
	}

	// 评估条件
	result, details, err := engine.Evaluate(groupExpr, context)

	// 断言
	assert.NoError(t, err)
	assert.True(t, result)
	assert.Equal(t, "test-expr-4", details["expressionId"])
	assert.Equal(t, "or", details["operator"])
	assert.Equal(t, "OR condition succeeded", details["message"])
}

func TestConditionEngine_EvaluateExpressions(t *testing.T) {
	// 创建条件引擎
	engine := NewConditionEngine(nil)

	// 创建测试邮件
	email := models.Email{
		ID:      123,
		Subject: "Test Email Subject",
		From:    []string{"sender@example.com"},
		To:      []string{"recipient@example.com"},
		Date:    time.Now(),
	}

	// 创建评估上下文
	context := NewEvaluationContext(email)

	// 创建条件表达式列表
	field1 := "email.subject"
	operator1 := models.TriggerOperator("contains")
	value1 := "Test"
	expr1 := models.TriggerExpression{
		ID:       "test-expr-5-1",
		Type:     models.TriggerExpressionTypeCondition,
		Operator: &operator1,
		Field:    &field1,
		Value:    value1,
	}

	field2 := "email.from.0"
	operator2 := models.TriggerOperator("contains")
	value2 := "example.com"
	expr2 := models.TriggerExpression{
		ID:       "test-expr-5-2",
		Type:     models.TriggerExpressionTypeCondition,
		Operator: &operator2,
		Field:    &field2,
		Value:    value2,
	}

	expressions := []models.TriggerExpression{expr1, expr2}

	// 评估条件表达式列表
	result, details, err := engine.EvaluateExpressions(expressions, context)

	// 断言
	assert.NoError(t, err)
	assert.True(t, result)
	assert.Equal(t, "root", details["expressionId"])
	assert.Equal(t, "and", details["operator"])
	assert.Equal(t, "All AND conditions succeeded", details["message"])
}

func TestConditionEngine_GetEmailFieldValue(t *testing.T) {
	// 创建条件引擎
	engine := NewConditionEngine(nil)

	// 创建测试邮件
	now := time.Now()
	email := models.Email{
		ID:      123,
		Subject: "Test Email Subject",
		From:    []string{"sender@example.com", "another@example.com"},
		To:      []string{"recipient@example.com"},
		Cc:      []string{"cc@example.com"},
		Bcc:     []string{"bcc@example.com"},
		Date:    now,
		Headers: map[string]string{
			"X-Custom": "CustomValue",
		},
	}

	// 创建评估上下文
	context := NewEvaluationContext(email)

	// 测试各种字段访问
	tests := []struct {
		fieldName    string
		expectedType string
		expectedVal  interface{}
	}{
		{"email.id", "uint", email.ID},
		{"email.subject", "string", email.Subject},
		{"email.from.0", "string", email.From[0]},
		{"email.from.1", "string", email.From[1]},
		{"email.to.0", "string", email.To[0]},
		{"email.cc.0", "string", email.Cc[0]},
		{"email.bcc.0", "string", email.Bcc[0]},
		{"email.date", "time.Time", email.Date},
		{"email.headers.X-Custom", "string", email.Headers["X-Custom"]},
	}

	for _, test := range tests {
		t.Run(test.fieldName, func(t *testing.T) {
			// 获取字段值
			value, err := engine.getFieldValue(test.fieldName, context)

			// 断言
			assert.NoError(t, err)
			assert.NotNil(t, value)

			// 检查类型和值
			switch test.expectedType {
			case "int":
				assert.Equal(t, test.expectedVal.(uint), value.(uint))
			case "string":
				assert.Equal(t, test.expectedVal.(string), value.(string))
			case "time.Time":
				assert.Equal(t, test.expectedVal.(time.Time), value.(time.Time))
			}
		})
	}
}

func TestConditionEngine_Operators(t *testing.T) {
	// 创建条件引擎
	engine := NewConditionEngine(nil)

	// 测试各种操作符
	tests := []struct {
		name     string
		operator string
		left     interface{}
		right    interface{}
		expected bool
	}{
		{"equals_string", "equals", "test", "test", true},
		{"equals_number", "equals", 123, 123, true},
		{"not_equals", "not_equals", "test", "other", true},
		{"greater_than", "greater_than", 10, 5, true},
		{"less_than", "less_than", 5, 10, true},
		{"greater_equal", "greater_equal", 10, 10, true},
		{"less_equal", "less_equal", 5, 5, true},
		{"contains", "contains", "test string", "string", true},
		{"not_contains", "not_contains", "test string", "other", true},
		{"starts_with", "starts_with", "test string", "test", true},
		{"ends_with", "ends_with", "test string", "string", true},
		{"matches", "matches", "test123", "^test\\d+$", true},
		{"in_array", "in", "test", []string{"test", "other"}, true},
		{"not_in_array", "not_in", "test", []string{"other", "another"}, true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			// 获取操作符
			op, exists := engine.operators[test.operator]
			assert.True(t, exists)

			// 评估操作符
			result, err := op.Evaluate(test.left, test.right)

			// 断言
			assert.NoError(t, err)
			assert.Equal(t, test.expected, result)
		})
	}
}

func TestConditionEngine_Functions(t *testing.T) {
	// 创建条件引擎
	engine := NewConditionEngine(nil)

	// 测试各种函数
	tests := []struct {
		name     string
		function string
		args     []interface{}
		expected interface{}
	}{
		{"len_string", "len", []interface{}{"test"}, 4},
		{"upper", "upper", []interface{}{"test"}, "TEST"},
		{"lower", "lower", []interface{}{"TEST"}, "test"},
		{"trim", "trim", []interface{}{" test "}, "test"},
		{"isEmpty_empty", "isEmpty", []interface{}{""}, true},
		{"isEmpty_not_empty", "isEmpty", []interface{}{"test"}, false},
		{"isNotEmpty", "isNotEmpty", []interface{}{"test"}, true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			// 获取函数
			fn, exists := engine.functions[test.function]
			assert.True(t, exists)

			// 执行函数
			result, err := fn.Execute(test.args)

			// 断言
			assert.NoError(t, err)
			assert.Equal(t, test.expected, result)
		})
	}
}
