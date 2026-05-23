package engine

import (
	"context"
	"fmt"
	"testing"
	"time"

	"mailman/internal/triggerv2/models"
)

func TestConditionEngine_BasicOperators(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
	}{
		{
			name: "相等操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Field:    "name",
				Value:    "test",
			},
			data: map[string]interface{}{
				"name": "test",
			},
			expected: true,
		},
		{
			name: "不等操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "!=",
				Field:    "name",
				Value:    "test",
			},
			data: map[string]interface{}{
				"name": "other",
			},
			expected: true,
		},
		{
			name: "大于操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: ">",
				Field:    "age",
				Value:    18,
			},
			data: map[string]interface{}{
				"age": 20,
			},
			expected: true,
		},
		{
			name: "小于操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "<",
				Field:    "age",
				Value:    30,
			},
			data: map[string]interface{}{
				"age": 25,
			},
			expected: true,
		},
		{
			name: "包含操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "contains",
				Field:    "message",
				Value:    "hello",
			},
			data: map[string]interface{}{
				"message": "hello world",
			},
			expected: true,
		},
		{
			name: "开始于操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "startswith",
				Field:    "email",
				Value:    "test@",
			},
			data: map[string]interface{}{
				"email": "test@example.com",
			},
			expected: true,
		},
		{
			name: "结束于操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "endswith",
				Field:    "email",
				Value:    ".com",
			},
			data: map[string]interface{}{
				"email": "test@example.com",
			},
			expected: true,
		},
		{
			name: "正则匹配操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "matches",
				Field:    "phone",
				Value:    "^\\d{3}-\\d{3}-\\d{4}$",
			},
			data: map[string]interface{}{
				"phone": "123-456-7890",
			},
			expected: true,
		},
		{
			name: "in操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "in",
				Field:    "status",
				Value:    []string{"active", "pending", "inactive"},
			},
			data: map[string]interface{}{
				"status": "active",
			},
			expected: true,
		},
		{
			name: "notin操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "notin",
				Field:    "status",
				Value:    []string{"deleted", "archived"},
			},
			data: map[string]interface{}{
				"status": "active",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

func TestConditionEngine_LogicalOperators(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
	}{
		{
			name: "AND操作符 - 两个条件都为真",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "==",
					Field:    "name",
					Value:    "John",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Field:    "age",
					Value:    18,
				},
			},
			data: map[string]interface{}{
				"name": "John",
				"age":  25,
			},
			expected: true,
		},
		{
			name: "AND操作符 - 第一个条件为假",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "==",
					Field:    "name",
					Value:    "Jane",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Field:    "age",
					Value:    18,
				},
			},
			data: map[string]interface{}{
				"name": "John",
				"age":  25,
			},
			expected: false,
		},
		{
			name: "OR操作符 - 第一个条件为真",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "==",
					Field:    "name",
					Value:    "John",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "<",
					Field:    "age",
					Value:    18,
				},
			},
			data: map[string]interface{}{
				"name": "John",
				"age":  25,
			},
			expected: true,
		},
		{
			name: "OR操作符 - 第二个条件为真",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "==",
					Field:    "name",
					Value:    "Jane",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Field:    "age",
					Value:    18,
				},
			},
			data: map[string]interface{}{
				"name": "John",
				"age":  25,
			},
			expected: true,
		},
		{
			name: "OR操作符 - 两个条件都为假",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "==",
					Field:    "name",
					Value:    "Jane",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "<",
					Field:    "age",
					Value:    18,
				},
			},
			data: map[string]interface{}{
				"name": "John",
				"age":  25,
			},
			expected: false,
		},
		{
			name: "NOT操作符 - 条件为真",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "not",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "==",
					Field:    "name",
					Value:    "Jane",
				},
			},
			data: map[string]interface{}{
				"name": "John",
			},
			expected: true,
		},
		{
			name: "NOT操作符 - 条件为假",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "not",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "==",
					Field:    "name",
					Value:    "John",
				},
			},
			data: map[string]interface{}{
				"name": "John",
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

func TestConditionEngine_Functions(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
	}{
		{
			name: "len函数",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: ">",
				Left: &ConditionExpression{
					Type:     ExpressionTypeFunction,
					Function: "len",
					Args:     []interface{}{"$name"},
				},
				Right: &ConditionExpression{
					Type:  ExpressionTypeValue,
					Value: 3,
				},
			},
			data: map[string]interface{}{
				"name": "John",
			},
			expected: true,
		},
		{
			name: "upper函数",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Left: &ConditionExpression{
					Type:     ExpressionTypeFunction,
					Function: "upper",
					Args:     []interface{}{"$name"},
				},
				Right: &ConditionExpression{
					Type:  ExpressionTypeValue,
					Value: "JOHN",
				},
			},
			data: map[string]interface{}{
				"name": "john",
			},
			expected: true,
		},
		{
			name: "lower函数",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Left: &ConditionExpression{
					Type:     ExpressionTypeFunction,
					Function: "lower",
					Args:     []interface{}{"$name"},
				},
				Right: &ConditionExpression{
					Type:  ExpressionTypeValue,
					Value: "john",
				},
			},
			data: map[string]interface{}{
				"name": "JOHN",
			},
			expected: true,
		},
		{
			name: "trim函数",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Left: &ConditionExpression{
					Type:     ExpressionTypeFunction,
					Function: "trim",
					Args:     []interface{}{"$name"},
				},
				Right: &ConditionExpression{
					Type:  ExpressionTypeValue,
					Value: "John",
				},
			},
			data: map[string]interface{}{
				"name": "  John  ",
			},
			expected: true,
		},
		{
			name: "isEmpty函数 - 空字符串",
			expression: &ConditionExpression{
				Type:     ExpressionTypeFunction,
				Function: "isEmpty",
				Args:     []interface{}{"$name"},
			},
			data: map[string]interface{}{
				"name": "",
			},
			expected: true,
		},
		{
			name: "isEmpty函数 - 非空字符串",
			expression: &ConditionExpression{
				Type:     ExpressionTypeFunction,
				Function: "isEmpty",
				Args:     []interface{}{"$name"},
			},
			data: map[string]interface{}{
				"name": "John",
			},
			expected: false,
		},
		{
			name: "isNotEmpty函数 - 非空字符串",
			expression: &ConditionExpression{
				Type:     ExpressionTypeFunction,
				Function: "isNotEmpty",
				Args:     []interface{}{"$name"},
			},
			data: map[string]interface{}{
				"name": "John",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

func TestConditionEngine_NestedFields(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
	}{
		{
			name: "嵌套字段访问",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Field:    "user.name",
				Value:    "John",
			},
			data: map[string]interface{}{
				"user": map[string]interface{}{
					"name": "John",
					"age":  25,
				},
			},
			expected: true,
		},
		{
			name: "深层嵌套字段访问",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Field:    "user.profile.email",
				Value:    "john@example.com",
			},
			data: map[string]interface{}{
				"user": map[string]interface{}{
					"profile": map[string]interface{}{
						"email": "john@example.com",
					},
				},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

func TestConditionEngine_EventData(t *testing.T) {
	engine := NewConditionEngine()

	// 创建测试事件
	event := &models.Event{
		ID:        "test-event-1",
		Type:      "email.received",
		Source:    "email-service",
		CreatedAt: time.Now(),
	}

	// 设置事件数据
	eventData := map[string]interface{}{
		"subject": "Test Email",
		"from":    "sender@example.com",
		"to":      "recipient@example.com",
	}
	event.SetData(eventData)

	tests := []struct {
		name       string
		expression *ConditionExpression
		expected   bool
	}{
		{
			name: "事件字段访问",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Field:    "event.subject",
				Value:    "Test Email",
			},
			expected: true,
		},
		{
			name: "事件字段包含检查",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "contains",
				Field:    "event.from",
				Value:    "@example.com",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &EvaluationContext{
				Context: context.Background(),
				Event:   event,
				Data:    map[string]interface{}{},
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

func TestConditionEngine_ComplexExpression(t *testing.T) {
	engine := NewConditionEngine()

	// 复杂表达式: (name == "John" AND age > 18) OR (status == "VIP")
	expression := &ConditionExpression{
		Type:     ExpressionTypeLogical,
		Operator: "or",
		Left: &ConditionExpression{
			Type:     ExpressionTypeLogical,
			Operator: "and",
			Left: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Field:    "name",
				Value:    "John",
			},
			Right: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: ">",
				Field:    "age",
				Value:    18,
			},
		},
		Right: &ConditionExpression{
			Type:     ExpressionTypeComparison,
			Operator: "==",
			Field:    "status",
			Value:    "VIP",
		},
	}

	tests := []struct {
		name     string
		data     map[string]interface{}
		expected bool
	}{
		{
			name: "第一个条件组合为真",
			data: map[string]interface{}{
				"name":   "John",
				"age":    25,
				"status": "Normal",
			},
			expected: true,
		},
		{
			name: "第二个条件为真",
			data: map[string]interface{}{
				"name":   "Jane",
				"age":    16,
				"status": "VIP",
			},
			expected: true,
		},
		{
			name: "所有条件都为假",
			data: map[string]interface{}{
				"name":   "Jane",
				"age":    16,
				"status": "Normal",
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

func TestConditionEngine_ErrorHandling(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expectErr  bool
	}{
		{
			name: "未知操作符",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "unknown",
				Field:    "name",
				Value:    "test",
			},
			data: map[string]interface{}{
				"name": "test",
			},
			expectErr: true,
		},
		{
			name: "未知函数",
			expression: &ConditionExpression{
				Type:     ExpressionTypeFunction,
				Function: "unknown",
				Args:     []interface{}{"test"},
			},
			data:      map[string]interface{}{},
			expectErr: true,
		},
		{
			name: "不存在的字段",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Field:    "nonexistent",
				Value:    "test",
			},
			data:      map[string]interface{}{},
			expectErr: true,
		},
		{
			name: "无效的正则表达式",
			expression: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "matches",
				Field:    "text",
				Value:    "[invalid",
			},
			data: map[string]interface{}{
				"text": "test",
			},
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			_, err := engine.Evaluate(tt.expression, ctx)
			if tt.expectErr && err == nil {
				t.Error("期望出现错误，但没有错误")
			} else if !tt.expectErr && err != nil {
				t.Errorf("不期望出现错误，但得到错误: %v", err)
			}
		})
	}
}

// 自定义操作符测试
type CustomOperator struct{}

func (o *CustomOperator) Evaluate(left, right interface{}) (bool, error) {
	return true, nil
}

func (o *CustomOperator) GetName() string  { return "custom" }
func (o *CustomOperator) GetPriority() int { return 3 }

func TestConditionEngine_CustomOperator(t *testing.T) {
	engine := NewConditionEngine()

	// 注册自定义操作符
	customOp := &CustomOperator{}
	engine.RegisterOperator(customOp)

	expression := &ConditionExpression{
		Type:     ExpressionTypeComparison,
		Operator: "custom",
		Field:    "value",
		Value:    "test",
	}

	ctx := &EvaluationContext{
		Context: context.Background(),
		Data: map[string]interface{}{
			"value": "test",
		},
	}

	result, err := engine.Evaluate(expression, ctx)
	if err != nil {
		t.Errorf("评估失败: %v", err)
		return
	}

	if !result {
		t.Error("期望自定义操作符返回true")
	}
}

// 自定义函数测试
type CustomFunction struct{}

func (f *CustomFunction) Execute(args []interface{}) (interface{}, error) {
	return "custom result", nil
}

func (f *CustomFunction) GetName() string  { return "custom" }
func (f *CustomFunction) GetArgCount() int { return 1 }

func TestConditionEngine_CustomFunction(t *testing.T) {
	engine := NewConditionEngine()

	// 注册自定义函数
	customFunc := &CustomFunction{}
	engine.RegisterFunction(customFunc)

	expression := &ConditionExpression{
		Type:     ExpressionTypeComparison,
		Operator: "==",
		Left: &ConditionExpression{
			Type:     ExpressionTypeFunction,
			Function: "custom",
			Args:     []interface{}{"test"},
		},
		Right: &ConditionExpression{
			Type:  ExpressionTypeValue,
			Value: "custom result",
		},
	}

	ctx := &EvaluationContext{
		Context: context.Background(),
		Data:    map[string]interface{}{},
	}

	result, err := engine.Evaluate(expression, ctx)
	if err != nil {
		t.Errorf("评估失败: %v", err)
		return
	}

	if !result {
		t.Error("期望自定义函数返回正确结果")
	}
}

// 基准测试
func BenchmarkConditionEngine_SimpleComparison(b *testing.B) {
	engine := NewConditionEngine()

	expression := &ConditionExpression{
		Type:     ExpressionTypeComparison,
		Operator: "==",
		Field:    "name",
		Value:    "test",
	}

	ctx := &EvaluationContext{
		Context: context.Background(),
		Data: map[string]interface{}{
			"name": "test",
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := engine.Evaluate(expression, ctx)
		if err != nil {
			b.Fatalf("评估失败: %v", err)
		}
	}
}

func BenchmarkConditionEngine_ComplexLogical(b *testing.B) {
	engine := NewConditionEngine()

	expression := &ConditionExpression{
		Type:     ExpressionTypeLogical,
		Operator: "and",
		Left: &ConditionExpression{
			Type:     ExpressionTypeComparison,
			Operator: "==",
			Field:    "name",
			Value:    "John",
		},
		Right: &ConditionExpression{
			Type:     ExpressionTypeComparison,
			Operator: ">",
			Field:    "age",
			Value:    18,
		},
	}

	ctx := &EvaluationContext{
		Context: context.Background(),
		Data: map[string]interface{}{
			"name": "John",
			"age":  25,
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := engine.Evaluate(expression, ctx)
		if err != nil {
			b.Fatalf("评估失败: %v", err)
		}
	}
}

func BenchmarkConditionEngine_FunctionCall(b *testing.B) {
	engine := NewConditionEngine()

	expression := &ConditionExpression{
		Type:     ExpressionTypeComparison,
		Operator: ">",
		Left: &ConditionExpression{
			Type:     ExpressionTypeFunction,
			Function: "len",
			Args:     []interface{}{"$name"},
		},
		Right: &ConditionExpression{
			Type:  ExpressionTypeValue,
			Value: 3,
		},
	}

	ctx := &EvaluationContext{
		Context: context.Background(),
		Data: map[string]interface{}{
			"name": "John",
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := engine.Evaluate(expression, ctx)
		if err != nil {
			b.Fatalf("评估失败: %v", err)
		}
	}
}

// ========== 测试用的时间函数 ==========

// HourFunction 小时函数，用于测试
type HourFunction struct{}

func (f *HourFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("hour函数需要1个参数")
	}
	timeStr, ok := args[0].(string)
	if !ok {
		return nil, fmt.Errorf("hour函数参数必须是字符串")
	}
	t, err := time.Parse("2006-01-02 15:04:05", timeStr)
	if err != nil {
		return nil, err
	}
	return t.Hour(), nil
}

func (f *HourFunction) GetName() string  { return "hour" }
func (f *HourFunction) GetArgCount() int { return 1 }

// WeekdayFunction 星期函数，用于测试
type WeekdayFunction struct{}

func (f *WeekdayFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("weekday函数需要1个参数")
	}
	timeStr, ok := args[0].(string)
	if !ok {
		return nil, fmt.Errorf("weekday函数参数必须是字符串")
	}
	t, err := time.Parse("2006-01-02 15:04:05", timeStr)
	if err != nil {
		return nil, err
	}
	return int(t.Weekday()), nil
}

func (f *WeekdayFunction) GetName() string  { return "weekday" }
func (f *WeekdayFunction) GetArgCount() int { return 1 }

// ========== 邮件管理业务场景测试 ==========

// TestConditionEngine_EmailSpamDetection 测试邮件垃圾检测场景
func TestConditionEngine_EmailSpamDetection(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
		scenario   string
	}{
		{
			name:     "垃圾邮件-主题包含促销关键词",
			scenario: "检测主题中是否包含常见垃圾邮件关键词",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "contains",
					Field:    "subject",
					Value:    "免费",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "中奖",
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "限时优惠",
					},
				},
			},
			data: map[string]interface{}{
				"subject": "恭喜您中奖了！免费领取大奖",
				"sender":  "promotion@spam.com",
			},
			expected: true,
		},
		{
			name:     "垃圾邮件-发送者域名黑名单",
			scenario: "检测发送者是否来自已知垃圾邮件域名",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "endswith",
					Field:    "sender",
					Value:    "@spam.com",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "endswith",
					Field:    "sender",
					Value:    "@fake-bank.net",
				},
			},
			data: map[string]interface{}{
				"subject": "重要通知",
				"sender":  "fake@fake-bank.net",
			},
			expected: true,
		},
		{
			name:     "正常邮件-企业内部邮件",
			scenario: "企业内部邮件应该不被标记为垃圾邮件",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "endswith",
					Field:    "sender",
					Value:    "@company.com",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "not",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "URGENT",
					},
				},
			},
			data: map[string]interface{}{
				"subject": "项目进度更新",
				"sender":  "manager@company.com",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Logf("测试场景: %s", tt.scenario)
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

// TestConditionEngine_EmailPriorityClassification 测试邮件优先级分类
func TestConditionEngine_EmailPriorityClassification(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
		scenario   string
		priority   string
	}{
		{
			name:     "高优先级-CEO发送的邮件",
			scenario: "来自CEO的邮件应该被标记为高优先级",
			priority: "HIGH",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "==",
					Field:    "sender",
					Value:    "ceo@company.com",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "contains",
					Field:    "subject",
					Value:    "[URGENT]",
				},
			},
			data: map[string]interface{}{
				"subject": "董事会会议安排",
				"sender":  "ceo@company.com",
				"type":    "internal",
			},
			expected: true,
		},
		{
			name:     "高优先级-客户投诉邮件",
			scenario: "客户投诉邮件需要高优先级处理",
			priority: "HIGH",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "==",
					Field:    "category",
					Value:    "customer_service",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "投诉",
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "content",
						Value:    "不满意",
					},
				},
			},
			data: map[string]interface{}{
				"subject":  "对服务质量的投诉",
				"sender":   "customer@example.com",
				"category": "customer_service",
				"content":  "我对贵公司的服务非常不满意",
			},
			expected: true,
		},
		{
			name:     "中优先级-合作伙伴邮件",
			scenario: "合作伙伴邮件为中等优先级",
			priority: "MEDIUM",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "in",
					Field:    "sender_domain",
					Value:    []string{"partner1.com", "partner2.com", "vendor.com"},
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "not",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "广告",
					},
				},
			},
			data: map[string]interface{}{
				"subject":       "合作项目讨论",
				"sender":        "contact@partner1.com",
				"sender_domain": "partner1.com",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Logf("测试场景: %s (优先级: %s)", tt.scenario, tt.priority)
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

// TestConditionEngine_EmailAutoFiltering 测试邮件自动分类过滤
func TestConditionEngine_EmailAutoFiltering(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
		scenario   string
		folder     string
	}{
		{
			name:     "财务邮件-自动归档到财务文件夹",
			scenario: "包含财务关键词的邮件自动归档",
			folder:   "Finance",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "contains",
					Field:    "subject",
					Value:    "发票",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "付款",
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "endswith",
						Field:    "sender",
						Value:    "@finance.company.com",
					},
				},
			},
			data: map[string]interface{}{
				"subject": "请查收本月发票",
				"sender":  "accounting@finance.company.com",
			},
			expected: true,
		},
		{
			name:     "技术邮件-GitHub通知",
			scenario: "GitHub相关邮件自动归档到技术文件夹",
			folder:   "Development",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "endswith",
					Field:    "sender",
					Value:    "@github.com",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "Pull Request",
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "Issue",
					},
				},
			},
			data: map[string]interface{}{
				"subject": "[GitHub] New Pull Request #123",
				"sender":  "notifications@github.com",
			},
			expected: true,
		},
		{
			name:     "营销邮件-新闻订阅",
			scenario: "新闻订阅邮件自动归档到营销文件夹",
			folder:   "Marketing",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "contains",
					Field:    "subject",
					Value:    "Newsletter",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "contains",
					Field:    "content",
					Value:    "unsubscribe",
				},
			},
			data: map[string]interface{}{
				"subject": "Weekly Newsletter - Tech Updates",
				"sender":  "newsletter@techblog.com",
				"content": "Latest tech news... To unsubscribe click here",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Logf("测试场景: %s (目标文件夹: %s)", tt.scenario, tt.folder)
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

// TestConditionEngine_EmailSecurityDetection 测试邮件安全检测
func TestConditionEngine_EmailSecurityDetection(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
		scenario   string
		riskLevel  string
	}{
		{
			name:      "钓鱼邮件-伪造银行邮件",
			scenario:  "检测伪造银行钓鱼邮件",
			riskLevel: "HIGH",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "contains",
					Field:    "subject",
					Value:    "银行",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "and",
					Left: &ConditionExpression{
						Type:     ExpressionTypeLogical,
						Operator: "not",
						Left: &ConditionExpression{
							Type:     ExpressionTypeComparison,
							Operator: "in",
							Field:    "sender_domain",
							Value:    []string{"icbc.com.cn", "ccb.com", "abc.com.cn"},
						},
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "content",
						Value:    "立即验证",
					},
				},
			},
			data: map[string]interface{}{
				"subject":       "中国银行账户异常，需要验证",
				"sender":        "security@fake-icbc.com",
				"sender_domain": "fake-icbc.com",
				"content":       "您的账户存在异常，请立即验证您的身份信息",
			},
			expected: true,
		},
		{
			name:      "恶意链接-短链接检测",
			scenario:  "检测包含可疑短链接的邮件",
			riskLevel: "MEDIUM",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "contains",
					Field:    "content",
					Value:    "bit.ly/",
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "content",
						Value:    "tinyurl.com/",
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "content",
						Value:    "t.co/",
					},
				},
			},
			data: map[string]interface{}{
				"subject": "查看这个重要文档",
				"content": "请点击链接查看: https://bit.ly/suspicious123",
				"sender":  "unknown@temp-email.com",
			},
			expected: true,
		},
		{
			name:      "附件安全-可执行文件检测",
			scenario:  "检测包含可执行文件附件的邮件",
			riskLevel: "HIGH",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Left: &ConditionExpression{
						Type:     ExpressionTypeFunction,
						Function: "len",
						Args:     []interface{}{"$attachments"},
					},
					Right: &ConditionExpression{
						Type:  ExpressionTypeValue,
						Value: 0,
					},
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "attachment_types",
						Value:    ".exe",
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeLogical,
						Operator: "or",
						Left: &ConditionExpression{
							Type:     ExpressionTypeComparison,
							Operator: "contains",
							Field:    "attachment_types",
							Value:    ".scr",
						},
						Right: &ConditionExpression{
							Type:     ExpressionTypeComparison,
							Operator: "contains",
							Field:    "attachment_types",
							Value:    ".bat",
						},
					},
				},
			},
			data: map[string]interface{}{
				"subject":          "重要文件",
				"attachments":      []string{"document.exe", "readme.txt"},
				"attachment_types": ".exe,.txt",
				"sender":           "stranger@unknown.com",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Logf("测试场景: %s (风险级别: %s)", tt.scenario, tt.riskLevel)
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

// TestConditionEngine_EmailTimeBasedRules 测试基于时间的邮件规则
func TestConditionEngine_EmailTimeBasedRules(t *testing.T) {
	engine := NewConditionEngine()

	// 添加时间函数用于测试
	engine.RegisterFunction(&HourFunction{})
	engine.RegisterFunction(&WeekdayFunction{})

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
		scenario   string
	}{
		{
			name:     "工作时间外邮件-自动延迟发送",
			scenario: "工作时间外的邮件标记为延迟发送",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "or",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "<",
					Left: &ConditionExpression{
						Type:     ExpressionTypeFunction,
						Function: "hour",
						Args:     []interface{}{"$received_at"},
					},
					Right: &ConditionExpression{
						Type:  ExpressionTypeValue,
						Value: 9, // 9点之前
					},
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Left: &ConditionExpression{
						Type:     ExpressionTypeFunction,
						Function: "hour",
						Args:     []interface{}{"$received_at"},
					},
					Right: &ConditionExpression{
						Type:  ExpressionTypeValue,
						Value: 18, // 18点之后
					},
				},
			},
			data: map[string]interface{}{
				"subject":     "今晚的会议安排",
				"received_at": "2024-01-15 20:30:00",
				"sender":      "colleague@company.com",
			},
			expected: true,
		},
		{
			name:     "周末邮件-非紧急处理",
			scenario: "周末收到的邮件标记为非紧急",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "==",
						Left: &ConditionExpression{
							Type:     ExpressionTypeFunction,
							Function: "weekday",
							Args:     []interface{}{"$received_at"},
						},
						Right: &ConditionExpression{
							Type:  ExpressionTypeValue,
							Value: 0, // 周日
						},
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "==",
						Left: &ConditionExpression{
							Type:     ExpressionTypeFunction,
							Function: "weekday",
							Args:     []interface{}{"$received_at"},
						},
						Right: &ConditionExpression{
							Type:  ExpressionTypeValue,
							Value: 6, // 周六
						},
					},
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "not",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "紧急",
					},
				},
			},
			data: map[string]interface{}{
				"subject":     "下周项目计划",
				"received_at": "2024-01-14 10:00:00", // 周日
				"sender":      "manager@company.com",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Logf("测试场景: %s", tt.scenario)
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

// TestConditionEngine_EmailVolumeAnalysis 测试邮件量分析规则
func TestConditionEngine_EmailVolumeAnalysis(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
		scenario   string
	}{
		{
			name:     "大量邮件发送者-可能的垃圾邮件",
			scenario: "单个发送者在短时间内发送大量邮件",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Field:    "sender_daily_count",
					Value:    100,
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "not",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "in",
						Field:    "sender_domain",
						Value:    []string{"company.com", "trusted-partner.com"},
					},
				},
			},
			data: map[string]interface{}{
				"sender":             "bulk@marketing.com",
				"sender_domain":      "marketing.com",
				"sender_daily_count": 150,
			},
			expected: true,
		},
		{
			name:     "邮件内容重复-群发检测",
			scenario: "检测重复内容的群发邮件",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Field:    "content_similarity_score",
					Value:    0.95,
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Field:    "similar_emails_count",
					Value:    50,
				},
			},
			data: map[string]interface{}{
				"content_similarity_score": 0.98,
				"similar_emails_count":     75,
				"subject":                  "Special Offer - Limited Time",
			},
			expected: true,
		},
		{
			name:     "异常接收量-账户被攻击",
			scenario: "用户收到异常大量邮件，可能被攻击",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Field:    "recipient_hourly_count",
					Value:    200,
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Left: &ConditionExpression{
						Type:     ExpressionTypeFunction,
						Function: "len",
						Args:     []interface{}{"$unique_senders"},
					},
					Right: &ConditionExpression{
						Type:  ExpressionTypeValue,
						Value: 10,
					},
				},
			},
			data: map[string]interface{}{
				"recipient":              "victim@company.com",
				"recipient_hourly_count": 300,
				"unique_senders":         []string{"spam1@a.com", "spam2@b.com", "spam3@c.com", "spam4@d.com", "spam5@e.com", "spam6@f.com", "spam7@g.com", "spam8@h.com", "spam9@i.com", "spam10@j.com", "spam11@k.com"},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Logf("测试场景: %s", tt.scenario)
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

// TestConditionEngine_EmailComplexBusinessScenarios 测试复杂业务场景
func TestConditionEngine_EmailComplexBusinessScenarios(t *testing.T) {
	engine := NewConditionEngine()

	tests := []struct {
		name       string
		expression *ConditionExpression
		data       map[string]interface{}
		expected   bool
		scenario   string
	}{
		{
			name:     "VIP客户邮件-特殊处理流程",
			scenario: "VIP客户的重要邮件需要特殊处理流程",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: "in",
					Field:    "sender",
					Value:    []string{"vip1@bigclient.com", "vip2@enterprise.com", "ceo@partner.com"},
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "合作",
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeLogical,
						Operator: "or",
						Left: &ConditionExpression{
							Type:     ExpressionTypeComparison,
							Operator: "contains",
							Field:    "subject",
							Value:    "订单",
						},
						Right: &ConditionExpression{
							Type:     ExpressionTypeComparison,
							Operator: "contains",
							Field:    "subject",
							Value:    "项目",
						},
					},
				},
			},
			data: map[string]interface{}{
				"subject": "新项目合作洽谈",
				"sender":  "vip1@bigclient.com",
				"amount":  1000000,
			},
			expected: true,
		},
		{
			name:     "法务邮件-合规检查",
			scenario: "法务相关邮件需要合规性检查",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "合同",
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeLogical,
						Operator: "or",
						Left: &ConditionExpression{
							Type:     ExpressionTypeComparison,
							Operator: "contains",
							Field:    "subject",
							Value:    "法律",
						},
						Right: &ConditionExpression{
							Type:     ExpressionTypeComparison,
							Operator: "contains",
							Field:    "content",
							Value:    "保密协议",
						},
					},
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeComparison,
					Operator: ">",
					Left: &ConditionExpression{
						Type:     ExpressionTypeFunction,
						Function: "len",
						Args:     []interface{}{"$attachments"},
					},
					Right: &ConditionExpression{
						Type:  ExpressionTypeValue,
						Value: 0,
					},
				},
			},
			data: map[string]interface{}{
				"subject":     "合同审核文件",
				"sender":      "lawyer@lawfirm.com",
				"content":     "请审核附件中的保密协议条款",
				"attachments": []string{"contract.pdf", "nda.docx"},
			},
			expected: true,
		},
		{
			name:     "销售线索-自动分配",
			scenario: "潜在销售线索邮件自动分配给销售团队",
			expression: &ConditionExpression{
				Type:     ExpressionTypeLogical,
				Operator: "and",
				Left: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "or",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "contains",
						Field:    "subject",
						Value:    "询价",
					},
					Right: &ConditionExpression{
						Type:     ExpressionTypeLogical,
						Operator: "or",
						Left: &ConditionExpression{
							Type:     ExpressionTypeComparison,
							Operator: "contains",
							Field:    "subject",
							Value:    "报价",
						},
						Right: &ConditionExpression{
							Type:     ExpressionTypeComparison,
							Operator: "contains",
							Field:    "content",
							Value:    "产品信息",
						},
					},
				},
				Right: &ConditionExpression{
					Type:     ExpressionTypeLogical,
					Operator: "not",
					Left: &ConditionExpression{
						Type:     ExpressionTypeComparison,
						Operator: "endswith",
						Field:    "sender",
						Value:    "@company.com",
					},
				},
			},
			data: map[string]interface{}{
				"subject": "产品询价咨询",
				"sender":  "procurement@client.com",
				"content": "希望了解贵公司的产品信息和报价",
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Logf("测试场景: %s", tt.scenario)
			ctx := &EvaluationContext{
				Context: context.Background(),
				Data:    tt.data,
			}

			result, err := engine.Evaluate(tt.expression, ctx)
			if err != nil {
				t.Errorf("评估失败: %v", err)
				return
			}

			if result != tt.expected {
				t.Errorf("期望 %v，得到 %v", tt.expected, result)
			}
		})
	}
}

// TestConditionEngine_EmailPerformanceScenarios 测试性能相关场景
func TestConditionEngine_EmailPerformanceScenarios(t *testing.T) {
	engine := NewConditionEngine()

	// 创建复杂的嵌套条件表达式
	complexExpression := &ConditionExpression{
		Type:     ExpressionTypeLogical,
		Operator: "and",
		Left: &ConditionExpression{
			Type:     ExpressionTypeLogical,
			Operator: "or",
			Left: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "contains",
				Field:    "subject",
				Value:    "重要",
			},
			Right: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Field:    "priority",
				Value:    "high",
			},
		},
		Right: &ConditionExpression{
			Type:     ExpressionTypeLogical,
			Operator: "and",
			Left: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: ">",
				Left: &ConditionExpression{
					Type:     ExpressionTypeFunction,
					Function: "len",
					Args:     []interface{}{"$content"},
				},
				Right: &ConditionExpression{
					Type:  ExpressionTypeValue,
					Value: 100,
				},
			},
			Right: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "in",
				Field:    "category",
				Value:    []string{"business", "urgent", "vip"},
			},
		},
	}

	// 测试数据
	testData := map[string]interface{}{
		"subject":  "重要项目更新通知",
		"priority": "high",
		"content":  "这是一个非常重要的项目更新通知，包含了详细的进度信息和下一步的行动计划。请各位同事仔细阅读并及时反馈。",
		"category": "business",
	}

	ctx := &EvaluationContext{
		Context: context.Background(),
		Data:    testData,
	}

	// 性能测试
	start := time.Now()
	for i := 0; i < 1000; i++ {
		result, err := engine.Evaluate(complexExpression, ctx)
		if err != nil {
			t.Errorf("评估失败: %v", err)
			return
		}
		if !result {
			t.Errorf("期望 true，得到 false")
			return
		}
	}
	duration := time.Since(start)

	t.Logf("复杂表达式性能测试: 1000次评估耗时 %v (平均 %v/次)", duration, duration/1000)

	// 期望每次评估在1ms以内
	if duration/1000 > time.Millisecond {
		t.Logf("警告: 平均评估时间超过1ms，可能需要优化性能")
	}
}

// BenchmarkConditionEngine_EmailBusinessScenarios 邮件业务场景性能基准测试
func BenchmarkConditionEngine_EmailBusinessScenarios(b *testing.B) {
	engine := NewConditionEngine()

	// 典型的邮件分类表达式
	expression := &ConditionExpression{
		Type:     ExpressionTypeLogical,
		Operator: "or",
		Left: &ConditionExpression{
			Type:     ExpressionTypeLogical,
			Operator: "and",
			Left: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "contains",
				Field:    "subject",
				Value:    "发票",
			},
			Right: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "endswith",
				Field:    "sender",
				Value:    "@finance.com",
			},
		},
		Right: &ConditionExpression{
			Type:     ExpressionTypeLogical,
			Operator: "and",
			Left: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: "==",
				Field:    "category",
				Value:    "billing",
			},
			Right: &ConditionExpression{
				Type:     ExpressionTypeComparison,
				Operator: ">",
				Field:    "amount",
				Value:    1000,
			},
		},
	}

	ctx := &EvaluationContext{
		Context: context.Background(),
		Data: map[string]interface{}{
			"subject":  "请查收本月发票",
			"sender":   "billing@finance.com",
			"category": "billing",
			"amount":   1500,
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := engine.Evaluate(expression, ctx)
		if err != nil {
			b.Fatalf("评估失败: %v", err)
		}
	}
}
