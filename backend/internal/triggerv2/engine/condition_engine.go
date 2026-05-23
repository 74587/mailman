package engine

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mailman/internal/triggerv2/models"
)

// ConditionEngine 条件引擎
type ConditionEngine struct {
	operators map[string]Operator
	functions map[string]Function
}

// NewConditionEngine 创建条件引擎
func NewConditionEngine() *ConditionEngine {
	engine := &ConditionEngine{
		operators: make(map[string]Operator),
		functions: make(map[string]Function),
	}

	// 注册默认操作符
	engine.registerDefaultOperators()

	// 注册默认函数
	engine.registerDefaultFunctions()

	return engine
}

// Operator 操作符接口
type Operator interface {
	Evaluate(left, right interface{}) (bool, error)
	GetName() string
	GetPriority() int
}

// Function 函数接口
type Function interface {
	Execute(args []interface{}) (interface{}, error)
	GetName() string
	GetArgCount() int
}

// ConditionExpression 条件表达式
type ConditionExpression struct {
	Type       ExpressionType         `json:"type"`
	Operator   string                 `json:"operator,omitempty"`
	Field      string                 `json:"field,omitempty"`
	Value      interface{}            `json:"value,omitempty"`
	Function   string                 `json:"function,omitempty"`
	Args       []interface{}          `json:"args,omitempty"`
	Left       *ConditionExpression   `json:"left,omitempty"`
	Right      *ConditionExpression   `json:"right,omitempty"`
	Conditions []*ConditionExpression `json:"conditions,omitempty"` // 支持前端格式
	Fields     map[string]interface{} `json:"fields,omitempty"`     // 插件条件字段
}

// ExpressionType 表达式类型
type ExpressionType string

const (
	ExpressionTypeComparison ExpressionType = "comparison"
	ExpressionTypeLogical    ExpressionType = "logical"
	ExpressionTypeFunction   ExpressionType = "function"
	ExpressionTypeField      ExpressionType = "field"
	ExpressionTypeValue      ExpressionType = "value"
)

// EvaluationContext 评估上下文
type EvaluationContext struct {
	Context context.Context
	Event   *models.Event
	Data    map[string]interface{}
}

// Evaluate 评估条件表达式
func (ce *ConditionEngine) Evaluate(expression *ConditionExpression, ctx *EvaluationContext) (bool, error) {
	switch expression.Type {
	case ExpressionTypeComparison:
		return ce.evaluateComparison(expression, ctx)
	case ExpressionTypeLogical:
		return ce.evaluateLogical(expression, ctx)
	case ExpressionTypeFunction:
		return ce.evaluateFunction(expression, ctx)
	case ExpressionTypeField:
		// 字段表达式直接返回字段值的布尔表示
		value, err := ce.getFieldValue(expression.Field, ctx)
		if err != nil {
			return false, err
		}
		return ce.toBool(value), nil
	case ExpressionTypeValue:
		// 值表达式直接返回值的布尔表示
		return ce.toBool(expression.Value), nil
	case "plugin":
		// 插件条件类型，处理插件字段条件
		return ce.evaluatePluginCondition(expression, ctx)
	case "and":
		// 前端发送的and类型，转换为逻辑表达式
		return ce.evaluateLogicalGroup(expression, "and", ctx)
	case "or":
		// 前端发送的or类型，转换为逻辑表达式
		return ce.evaluateLogicalGroup(expression, "or", ctx)
	case "not":
		// 前端发送的not类型，转换为逻辑表达式
		return ce.evaluateLogicalGroup(expression, "not", ctx)
	default:
		return false, fmt.Errorf("未知的表达式类型: %s", expression.Type)
	}
}

// evaluateComparison 评估比较表达式
func (ce *ConditionEngine) evaluateComparison(expression *ConditionExpression, ctx *EvaluationContext) (bool, error) {
	// 获取操作符
	operator, exists := ce.operators[expression.Operator]
	if !exists {
		return false, fmt.Errorf("未知的操作符: %s", expression.Operator)
	}

	// 评估左侧表达式
	var leftValue interface{}
	if expression.Left != nil {
		var err error
		leftValue, err = ce.evaluateValue(expression.Left, ctx)
		if err != nil {
			return false, err
		}
	} else if expression.Field != "" {
		var err error
		leftValue, err = ce.getFieldValue(expression.Field, ctx)
		if err != nil {
			return false, err
		}
	}

	// 评估右侧表达式
	var rightValue interface{}
	if expression.Right != nil {
		var err error
		rightValue, err = ce.evaluateValue(expression.Right, ctx)
		if err != nil {
			return false, err
		}
	} else {
		rightValue = expression.Value
	}

	// 执行比较
	return operator.Evaluate(leftValue, rightValue)
}

// evaluateLogical 评估逻辑表达式
func (ce *ConditionEngine) evaluateLogical(expression *ConditionExpression, ctx *EvaluationContext) (bool, error) {
	switch strings.ToLower(expression.Operator) {
	case "and", "&&":
		if expression.Left == nil || expression.Right == nil {
			return false, fmt.Errorf("AND操作符需要两个操作数")
		}

		leftResult, err := ce.Evaluate(expression.Left, ctx)
		if err != nil {
			return false, err
		}
		if !leftResult {
			return false, nil // 短路评估
		}

		rightResult, err := ce.Evaluate(expression.Right, ctx)
		if err != nil {
			return false, err
		}

		return rightResult, nil

	case "or", "||":
		if expression.Left == nil || expression.Right == nil {
			return false, fmt.Errorf("OR操作符需要两个操作数")
		}

		leftResult, err := ce.Evaluate(expression.Left, ctx)
		if err != nil {
			return false, err
		}
		if leftResult {
			return true, nil // 短路评估
		}

		rightResult, err := ce.Evaluate(expression.Right, ctx)
		if err != nil {
			return false, err
		}

		return rightResult, nil

	case "not", "!":
		if expression.Left == nil {
			return false, fmt.Errorf("NOT操作符需要一个操作数")
		}

		leftResult, err := ce.Evaluate(expression.Left, ctx)
		if err != nil {
			return false, err
		}

		return !leftResult, nil

	default:
		return false, fmt.Errorf("未知的逻辑操作符: %s", expression.Operator)
	}
}

// evaluateLogicalGroup 评估逻辑表达式组（处理前端发送的格式）
func (ce *ConditionEngine) evaluateLogicalGroup(expression *ConditionExpression, operator string, ctx *EvaluationContext) (bool, error) {
	// 获取条件数组
	conditions := expression.Conditions
	if conditions == nil {
		return false, fmt.Errorf("逻辑表达式缺少条件数组")
	}

	switch strings.ToLower(operator) {
	case "and":
		// 所有条件都必须为真
		for _, condition := range conditions {
			result, err := ce.Evaluate(condition, ctx)
			if err != nil {
				return false, err
			}
			if !result {
				return false, nil
			}
		}
		return true, nil

	case "or":
		// 任何一个条件为真即可
		for _, condition := range conditions {
			result, err := ce.Evaluate(condition, ctx)
			if err != nil {
				return false, err
			}
			if result {
				return true, nil
			}
		}
		return false, nil

	case "not":
		// 否定第一个条件
		if len(conditions) == 0 {
			return false, fmt.Errorf("NOT操作符需要至少一个条件")
		}
		result, err := ce.Evaluate(conditions[0], ctx)
		if err != nil {
			return false, err
		}
		return !result, nil

	default:
		return false, fmt.Errorf("未知的逻辑操作符: %s", operator)
	}
}

// evaluatePluginCondition 评估插件条件
func (ce *ConditionEngine) evaluatePluginCondition(expression *ConditionExpression, ctx *EvaluationContext) (bool, error) {
	// 从表达式中获取字段信息（前端格式）
	// 表达式应该包含一个 fields 字段，该字段包含实际的条件信息

	// 检查是否有 fields 字段
	if len(expression.Conditions) > 0 {
		// 如果有 conditions 数组，处理其中的条件
		for _, condition := range expression.Conditions {
			return ce.evaluatePluginCondition(condition, ctx)
		}
	}

	// 直接处理插件条件中的 fields
	// 由于 JSON 解析，我们需要检查 expression 是否有必要的字段
	// 或者从 Args 中获取字段信息
	var field, operator string
	var value interface{}

	// 优先从 Fields 字段中获取信息（前端格式）
	if expression.Fields != nil {
		if f, exists := expression.Fields["field"]; exists {
			field = fmt.Sprintf("%v", f)
		}
		if o, exists := expression.Fields["operator"]; exists {
			operator = fmt.Sprintf("%v", o)
		}
		if v, exists := expression.Fields["value"]; exists {
			value = v
		}
	} else if expression.Field != "" {
		field = expression.Field
		operator = expression.Operator
		value = expression.Value
	} else if len(expression.Args) > 0 {
		// 从 Args 中获取字段信息
		if fieldsMap, ok := expression.Args[0].(map[string]interface{}); ok {
			if f, exists := fieldsMap["field"]; exists {
				field = fmt.Sprintf("%v", f)
			}
			if o, exists := fieldsMap["operator"]; exists {
				operator = fmt.Sprintf("%v", o)
			}
			if v, exists := fieldsMap["value"]; exists {
				value = v
			}
		}
	}

	if field == "" || operator == "" {
		return false, fmt.Errorf("插件条件缺少必要字段: field=%s, operator=%s", field, operator)
	}

	// 获取字段值
	fieldValue, err := ce.getFieldValue(field, ctx)
	if err != nil {
		return false, fmt.Errorf("获取字段值失败: %v", err)
	}

	// 获取操作符
	op, exists := ce.operators[operator]
	if !exists {
		return false, fmt.Errorf("未知的操作符: %s", operator)
	}

	// 执行比较
	return op.Evaluate(fieldValue, value)
}

// evaluateFunction 评估函数表达式
func (ce *ConditionEngine) evaluateFunction(expression *ConditionExpression, ctx *EvaluationContext) (bool, error) {
	// 获取函数
	function, exists := ce.functions[expression.Function]
	if !exists {
		return false, fmt.Errorf("未知的函数: %s", expression.Function)
	}

	// 评估参数
	args := make([]interface{}, len(expression.Args))
	for i, arg := range expression.Args {
		// 如果参数是字符串且以$开头，则作为字段引用
		if argStr, ok := arg.(string); ok && strings.HasPrefix(argStr, "$") {
			fieldName := argStr[1:] // 去掉$前缀
			value, err := ce.getFieldValue(fieldName, ctx)
			if err != nil {
				return false, err
			}
			args[i] = value
		} else {
			args[i] = arg
		}
	}

	// 执行函数
	result, err := function.Execute(args)
	if err != nil {
		return false, err
	}

	// 将结果转换为布尔值
	return ce.toBool(result), nil
}

// evaluateValue 评估表达式并返回原始值（用于比较操作）
func (ce *ConditionEngine) evaluateValue(expression *ConditionExpression, ctx *EvaluationContext) (interface{}, error) {
	switch expression.Type {
	case ExpressionTypeField:
		return ce.getFieldValue(expression.Field, ctx)
	case ExpressionTypeValue:
		return expression.Value, nil
	case ExpressionTypeFunction:
		// 获取函数
		function, exists := ce.functions[expression.Function]
		if !exists {
			return nil, fmt.Errorf("未知的函数: %s", expression.Function)
		}

		// 评估参数
		args := make([]interface{}, len(expression.Args))
		for i, arg := range expression.Args {
			// 如果参数是字符串且以$开头，则作为字段引用
			if argStr, ok := arg.(string); ok && strings.HasPrefix(argStr, "$") {
				fieldName := argStr[1:] // 去掉$前缀
				value, err := ce.getFieldValue(fieldName, ctx)
				if err != nil {
					return nil, err
				}
				args[i] = value
			} else {
				args[i] = arg
			}
		}

		// 执行函数并返回原始值
		return function.Execute(args)
	case ExpressionTypeComparison:
		// 比较表达式返回布尔值
		return ce.evaluateComparison(expression, ctx)
	case ExpressionTypeLogical:
		// 逻辑表达式返回布尔值
		return ce.evaluateLogical(expression, ctx)
	default:
		return nil, fmt.Errorf("未知的表达式类型: %s", expression.Type)
	}
}

// getFieldValue 获取字段值
func (ce *ConditionEngine) getFieldValue(fieldName string, ctx *EvaluationContext) (interface{}, error) {
	// 支持点表示法访问嵌套字段
	parts := strings.Split(fieldName, ".")

	var current interface{} = ctx.Data

	// 如果第一个部分是 "event"，则从事件数据开始
	if len(parts) > 0 && parts[0] == "event" {
		if ctx.Event == nil {
			return nil, fmt.Errorf("事件数据不可用")
		}

		// 解析事件数据
		var eventData map[string]interface{}
		if err := ctx.Event.GetData(&eventData); err != nil {
			return nil, fmt.Errorf("解析事件数据失败: %v", err)
		}

		current = eventData
		parts = parts[1:] // 跳过 "event" 部分
	}

	// 遍历字段路径
	for _, part := range parts {
		if current == nil {
			return nil, fmt.Errorf("字段路径 %s 无效", fieldName)
		}

		switch v := current.(type) {
		case map[string]interface{}:
			if value, exists := v[part]; exists {
				current = value
			} else {
				return nil, fmt.Errorf("字段 %s 不存在", part)
			}
		default:
			return nil, fmt.Errorf("无法访问字段 %s", part)
		}
	}

	return current, nil
}

// toBool 将值转换为布尔值
func (ce *ConditionEngine) toBool(value interface{}) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return v != ""
	case int, int8, int16, int32, int64:
		return v != 0
	case uint, uint8, uint16, uint32, uint64:
		return v != 0
	case float32, float64:
		return v != 0
	case nil:
		return false
	default:
		return true
	}
}

// RegisterOperator 注册操作符
func (ce *ConditionEngine) RegisterOperator(operator Operator) {
	ce.operators[operator.GetName()] = operator
}

// RegisterFunction 注册函数
func (ce *ConditionEngine) RegisterFunction(function Function) {
	ce.functions[function.GetName()] = function
}

// registerDefaultOperators 注册默认操作符
func (ce *ConditionEngine) registerDefaultOperators() {
	ce.RegisterOperator(&EqualOperator{})
	ce.RegisterOperator(&NotEqualOperator{})
	ce.RegisterOperator(&GreaterThanOperator{})
	ce.RegisterOperator(&LessThanOperator{})
	ce.RegisterOperator(&GreaterEqualOperator{})
	ce.RegisterOperator(&LessEqualOperator{})
	ce.RegisterOperator(&ContainsOperator{})
	ce.RegisterOperator(&NotContainsOperator{})
	ce.RegisterOperator(&StartsWithOperator{})
	ce.RegisterOperator(&EndsWithOperator{})
	ce.RegisterOperator(&MatchesOperator{})
	ce.RegisterOperator(&InOperator{})
	ce.RegisterOperator(&NotInOperator{})

	// 注册数组专用操作符
	ce.RegisterOperator(&ArrayContainsOperator{})
	ce.RegisterOperator(&ArrayNotContainsOperator{})
	ce.RegisterOperator(&AnyEqualsOperator{})
	ce.RegisterOperator(&AnyContainsOperator{})
	ce.RegisterOperator(&AnyStartsWithOperator{})
	ce.RegisterOperator(&AnyEndsWithOperator{})
	ce.RegisterOperator(&AnyMatchesOperator{})
	ce.RegisterOperator(&AnyNotMatchesOperator{})
	ce.RegisterOperator(&AllEqualsOperator{})
	ce.RegisterOperator(&AllContainsOperator{})
	ce.RegisterOperator(&AllMatchesOperator{})
	ce.RegisterOperator(&AllNotMatchesOperator{})
	ce.RegisterOperator(&ArrayLengthEqualsOperator{})
	ce.RegisterOperator(&ArrayLengthGreaterOperator{})
	ce.RegisterOperator(&ArrayLengthLessOperator{})
	ce.RegisterOperator(&ArrayIsEmptyOperator{})
	ce.RegisterOperator(&ArrayIsNotEmptyOperator{})

	// 注册别名
	ce.operators["=="] = ce.operators["equals"]
	ce.operators["="] = ce.operators["equals"]
	ce.operators["!="] = ce.operators["not_equals"]
	ce.operators[">"] = ce.operators["greater_than"]
	ce.operators["<"] = ce.operators["less_than"]
	ce.operators[">="] = ce.operators["greater_equal"]
	ce.operators["<="] = ce.operators["less_equal"]
	ce.operators["startswith"] = ce.operators["starts_with"]
	ce.operators["endswith"] = ce.operators["ends_with"]
	ce.operators["notin"] = ce.operators["not_in"]
}

// registerDefaultFunctions 注册默认函数
func (ce *ConditionEngine) registerDefaultFunctions() {
	ce.RegisterFunction(&LenFunction{})
	ce.RegisterFunction(&UpperFunction{})
	ce.RegisterFunction(&LowerFunction{})
	ce.RegisterFunction(&TrimFunction{})
	ce.RegisterFunction(&NowFunction{})
	ce.RegisterFunction(&DateFunction{})
	ce.RegisterFunction(&IsEmptyFunction{})
	ce.RegisterFunction(&IsNotEmptyFunction{})
}

// 基本操作符实现

// EqualOperator 相等操作符
type EqualOperator struct{}

func (o *EqualOperator) Evaluate(left, right interface{}) (bool, error) {
	return fmt.Sprintf("%v", left) == fmt.Sprintf("%v", right), nil
}

func (o *EqualOperator) GetName() string  { return "equals" }
func (o *EqualOperator) GetPriority() int { return 3 }

// NotEqualOperator 不等操作符
type NotEqualOperator struct{}

func (o *NotEqualOperator) Evaluate(left, right interface{}) (bool, error) {
	return fmt.Sprintf("%v", left) != fmt.Sprintf("%v", right), nil
}

func (o *NotEqualOperator) GetName() string  { return "not_equals" }
func (o *NotEqualOperator) GetPriority() int { return 3 }

// GreaterThanOperator 大于操作符
type GreaterThanOperator struct{}

func (o *GreaterThanOperator) Evaluate(left, right interface{}) (bool, error) {
	leftNum, err := o.toNumber(left)
	if err != nil {
		return false, err
	}
	rightNum, err := o.toNumber(right)
	if err != nil {
		return false, err
	}
	return leftNum > rightNum, nil
}

func (o *GreaterThanOperator) toNumber(value interface{}) (float64, error) {
	switch v := value.(type) {
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case string:
		return strconv.ParseFloat(v, 64)
	default:
		return 0, fmt.Errorf("无法转换为数字: %v", value)
	}
}

func (o *GreaterThanOperator) GetName() string  { return "greater_than" }
func (o *GreaterThanOperator) GetPriority() int { return 3 }

// LessThanOperator 小于操作符
type LessThanOperator struct{}

func (o *LessThanOperator) Evaluate(left, right interface{}) (bool, error) {
	leftNum, err := o.toNumber(left)
	if err != nil {
		return false, err
	}
	rightNum, err := o.toNumber(right)
	if err != nil {
		return false, err
	}
	return leftNum < rightNum, nil
}

func (o *LessThanOperator) toNumber(value interface{}) (float64, error) {
	switch v := value.(type) {
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case string:
		return strconv.ParseFloat(v, 64)
	default:
		return 0, fmt.Errorf("无法转换为数字: %v", value)
	}
}

func (o *LessThanOperator) GetName() string  { return "less_than" }
func (o *LessThanOperator) GetPriority() int { return 3 }

// GreaterEqualOperator 大于等于操作符
type GreaterEqualOperator struct{}

func (o *GreaterEqualOperator) Evaluate(left, right interface{}) (bool, error) {
	leftNum, err := o.toNumber(left)
	if err != nil {
		return false, err
	}
	rightNum, err := o.toNumber(right)
	if err != nil {
		return false, err
	}
	return leftNum >= rightNum, nil
}

func (o *GreaterEqualOperator) toNumber(value interface{}) (float64, error) {
	switch v := value.(type) {
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case string:
		return strconv.ParseFloat(v, 64)
	default:
		return 0, fmt.Errorf("无法转换为数字: %v", value)
	}
}

func (o *GreaterEqualOperator) GetName() string  { return "greater_equal" }
func (o *GreaterEqualOperator) GetPriority() int { return 3 }

// LessEqualOperator 小于等于操作符
type LessEqualOperator struct{}

func (o *LessEqualOperator) Evaluate(left, right interface{}) (bool, error) {
	leftNum, err := o.toNumber(left)
	if err != nil {
		return false, err
	}
	rightNum, err := o.toNumber(right)
	if err != nil {
		return false, err
	}
	return leftNum <= rightNum, nil
}

func (o *LessEqualOperator) toNumber(value interface{}) (float64, error) {
	switch v := value.(type) {
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case string:
		return strconv.ParseFloat(v, 64)
	default:
		return 0, fmt.Errorf("无法转换为数字: %v", value)
	}
}

func (o *LessEqualOperator) GetName() string  { return "less_equal" }
func (o *LessEqualOperator) GetPriority() int { return 3 }

// ContainsOperator 包含操作符
type ContainsOperator struct{}

func (o *ContainsOperator) Evaluate(left, right interface{}) (bool, error) {
	leftStr := fmt.Sprintf("%v", left)
	rightStr := fmt.Sprintf("%v", right)
	return strings.Contains(leftStr, rightStr), nil
}

func (o *ContainsOperator) GetName() string  { return "contains" }
func (o *ContainsOperator) GetPriority() int { return 3 }

// NotContainsOperator 不包含操作符
type NotContainsOperator struct{}

func (o *NotContainsOperator) Evaluate(left, right interface{}) (bool, error) {
	leftStr := fmt.Sprintf("%v", left)
	rightStr := fmt.Sprintf("%v", right)
	return !strings.Contains(leftStr, rightStr), nil
}

func (o *NotContainsOperator) GetName() string  { return "not_contains" }
func (o *NotContainsOperator) GetPriority() int { return 3 }

// StartsWithOperator 开始于操作符
type StartsWithOperator struct{}

func (o *StartsWithOperator) Evaluate(left, right interface{}) (bool, error) {
	leftStr := fmt.Sprintf("%v", left)
	rightStr := fmt.Sprintf("%v", right)
	return strings.HasPrefix(leftStr, rightStr), nil
}

func (o *StartsWithOperator) GetName() string  { return "starts_with" }
func (o *StartsWithOperator) GetPriority() int { return 3 }

// EndsWithOperator 结束于操作符
type EndsWithOperator struct{}

func (o *EndsWithOperator) Evaluate(left, right interface{}) (bool, error) {
	leftStr := fmt.Sprintf("%v", left)
	rightStr := fmt.Sprintf("%v", right)
	return strings.HasSuffix(leftStr, rightStr), nil
}

func (o *EndsWithOperator) GetName() string  { return "ends_with" }
func (o *EndsWithOperator) GetPriority() int { return 3 }

// MatchesOperator 匹配操作符（正则表达式）
type MatchesOperator struct{}

func (o *MatchesOperator) Evaluate(left, right interface{}) (bool, error) {
	leftStr := fmt.Sprintf("%v", left)
	rightStr := fmt.Sprintf("%v", right)

	regex, err := regexp.Compile(rightStr)
	if err != nil {
		return false, fmt.Errorf("无效的正则表达式: %v", err)
	}

	return regex.MatchString(leftStr), nil
}

func (o *MatchesOperator) GetName() string  { return "matches" }
func (o *MatchesOperator) GetPriority() int { return 3 }

// InOperator 在列表中操作符
type InOperator struct{}

func (o *InOperator) Evaluate(left, right interface{}) (bool, error) {
	leftStr := fmt.Sprintf("%v", left)

	// 右侧应该是一个数组
	switch rightValue := right.(type) {
	case []interface{}:
		for _, item := range rightValue {
			if fmt.Sprintf("%v", item) == leftStr {
				return true, nil
			}
		}
		return false, nil
	case []string:
		for _, item := range rightValue {
			if item == leftStr {
				return true, nil
			}
		}
		return false, nil
	default:
		return false, fmt.Errorf("in操作符的右侧必须是数组")
	}
}

func (o *InOperator) GetName() string  { return "in" }
func (o *InOperator) GetPriority() int { return 3 }

// NotInOperator 不在列表中操作符
type NotInOperator struct{}

func (o *NotInOperator) Evaluate(left, right interface{}) (bool, error) {
	inOp := &InOperator{}
	result, err := inOp.Evaluate(left, right)
	if err != nil {
		return false, err
	}
	return !result, nil
}

func (o *NotInOperator) GetName() string  { return "not_in" }
func (o *NotInOperator) GetPriority() int { return 3 }

// 基本函数实现

// LenFunction 长度函数
type LenFunction struct{}

func (f *LenFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("len函数需要1个参数")
	}

	switch v := args[0].(type) {
	case string:
		return len(v), nil
	case []interface{}:
		return len(v), nil
	case []string:
		return len(v), nil
	case []int:
		return len(v), nil
	case []float64:
		return len(v), nil
	case map[string]interface{}:
		return len(v), nil
	default:
		return 0, fmt.Errorf("无法获取长度: %v", args[0])
	}
}

func (f *LenFunction) GetName() string  { return "len" }
func (f *LenFunction) GetArgCount() int { return 1 }

// UpperFunction 大写函数
type UpperFunction struct{}

func (f *UpperFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("upper函数需要1个参数")
	}

	str := fmt.Sprintf("%v", args[0])
	return strings.ToUpper(str), nil
}

func (f *UpperFunction) GetName() string  { return "upper" }
func (f *UpperFunction) GetArgCount() int { return 1 }

// LowerFunction 小写函数
type LowerFunction struct{}

func (f *LowerFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("lower函数需要1个参数")
	}

	str := fmt.Sprintf("%v", args[0])
	return strings.ToLower(str), nil
}

func (f *LowerFunction) GetName() string  { return "lower" }
func (f *LowerFunction) GetArgCount() int { return 1 }

// TrimFunction 去除空格函数
type TrimFunction struct{}

func (f *TrimFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("trim函数需要1个参数")
	}

	str := fmt.Sprintf("%v", args[0])
	return strings.TrimSpace(str), nil
}

func (f *TrimFunction) GetName() string  { return "trim" }
func (f *TrimFunction) GetArgCount() int { return 1 }

// NowFunction 当前时间函数
type NowFunction struct{}

func (f *NowFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 0 {
		return nil, fmt.Errorf("now函数不需要参数")
	}

	return time.Now(), nil
}

func (f *NowFunction) GetName() string  { return "now" }
func (f *NowFunction) GetArgCount() int { return 0 }

// DateFunction 解析日期函数
type DateFunction struct{}

func (f *DateFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("date函数需要1个参数")
	}

	str := fmt.Sprintf("%v", args[0])

	// 尝试多种日期格式
	formats := []string{
		"2006-01-02",
		"2006-01-02 15:04:05",
		"2006/01/02",
		"2006/01/02 15:04:05",
		time.RFC3339,
	}

	for _, format := range formats {
		if t, err := time.Parse(format, str); err == nil {
			return t, nil
		}
	}

	return nil, fmt.Errorf("无法解析日期: %s", str)
}

func (f *DateFunction) GetName() string  { return "date" }
func (f *DateFunction) GetArgCount() int { return 1 }

// IsEmptyFunction 是否为空函数
type IsEmptyFunction struct{}

func (f *IsEmptyFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("isEmpty函数需要1个参数")
	}

	switch v := args[0].(type) {
	case nil:
		return true, nil
	case string:
		return v == "", nil
	case []interface{}:
		return len(v) == 0, nil
	case map[string]interface{}:
		return len(v) == 0, nil
	default:
		return false, nil
	}
}

func (f *IsEmptyFunction) GetName() string  { return "isEmpty" }
func (f *IsEmptyFunction) GetArgCount() int { return 1 }

// IsNotEmptyFunction 是否不为空函数
type IsNotEmptyFunction struct{}

func (f *IsNotEmptyFunction) Execute(args []interface{}) (interface{}, error) {
	if len(args) != 1 {
		return nil, fmt.Errorf("isNotEmpty函数需要1个参数")
	}

	emptyFunc := &IsEmptyFunction{}
	result, err := emptyFunc.Execute(args)
	if err != nil {
		return nil, err
	}

	if isEmpty, ok := result.(bool); ok {
		return !isEmpty, nil
	}

	return false, nil
}

func (f *IsNotEmptyFunction) GetName() string  { return "isNotEmpty" }
func (f *IsNotEmptyFunction) GetArgCount() int { return 1 }

// ===================== 数组专用操作符 =====================

// toSlice 将值转换为字符串切片
func toSlice(value interface{}) []string {
	switch v := value.(type) {
	case []string:
		return v
	case []interface{}:
		result := make([]string, len(v))
		for i, item := range v {
			result[i] = fmt.Sprintf("%v", item)
		}
		return result
	default:
		return []string{fmt.Sprintf("%v", value)}
	}
}

// getArrayLength 获取数组长度
func getArrayLength(value interface{}) int {
	switch v := value.(type) {
	case []string:
		return len(v)
	case []interface{}:
		return len(v)
	default:
		return 0
	}
}

// ArrayContainsOperator 数组包含操作符 - 检查数组中是否存在某个值
type ArrayContainsOperator struct{}

func (o *ArrayContainsOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	rightStr := fmt.Sprintf("%v", right)

	for _, item := range arr {
		if item == rightStr {
			return true, nil
		}
	}
	return false, nil
}

func (o *ArrayContainsOperator) GetName() string  { return "array_contains" }
func (o *ArrayContainsOperator) GetPriority() int { return 3 }

// ArrayNotContainsOperator 数组不包含操作符
type ArrayNotContainsOperator struct{}

func (o *ArrayNotContainsOperator) Evaluate(left, right interface{}) (bool, error) {
	op := &ArrayContainsOperator{}
	result, err := op.Evaluate(left, right)
	if err != nil {
		return false, err
	}
	return !result, nil
}

func (o *ArrayNotContainsOperator) GetName() string  { return "array_not_contains" }
func (o *ArrayNotContainsOperator) GetPriority() int { return 3 }

// AnyEqualsOperator 任意元素等于操作符
type AnyEqualsOperator struct{}

func (o *AnyEqualsOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	rightStr := fmt.Sprintf("%v", right)

	for _, item := range arr {
		if item == rightStr {
			return true, nil
		}
	}
	return false, nil
}

func (o *AnyEqualsOperator) GetName() string  { return "any_equals" }
func (o *AnyEqualsOperator) GetPriority() int { return 3 }

// AnyContainsOperator 任意元素包含操作符
type AnyContainsOperator struct{}

func (o *AnyContainsOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	rightStr := fmt.Sprintf("%v", right)

	for _, item := range arr {
		if strings.Contains(item, rightStr) {
			return true, nil
		}
	}
	return false, nil
}

func (o *AnyContainsOperator) GetName() string  { return "any_contains" }
func (o *AnyContainsOperator) GetPriority() int { return 3 }

// AnyStartsWithOperator 任意元素开头是操作符
type AnyStartsWithOperator struct{}

func (o *AnyStartsWithOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	rightStr := fmt.Sprintf("%v", right)

	for _, item := range arr {
		if strings.HasPrefix(item, rightStr) {
			return true, nil
		}
	}
	return false, nil
}

func (o *AnyStartsWithOperator) GetName() string  { return "any_starts_with" }
func (o *AnyStartsWithOperator) GetPriority() int { return 3 }

// AnyEndsWithOperator 任意元素结尾是操作符
type AnyEndsWithOperator struct{}

func (o *AnyEndsWithOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	rightStr := fmt.Sprintf("%v", right)

	for _, item := range arr {
		if strings.HasSuffix(item, rightStr) {
			return true, nil
		}
	}
	return false, nil
}

func (o *AnyEndsWithOperator) GetName() string  { return "any_ends_with" }
func (o *AnyEndsWithOperator) GetPriority() int { return 3 }

// AnyMatchesOperator 任意元素匹配正则操作符
type AnyMatchesOperator struct{}

func (o *AnyMatchesOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	pattern := fmt.Sprintf("%v", right)

	re, err := regexp.Compile(pattern)
	if err != nil {
		return false, fmt.Errorf("invalid regex pattern: %v", err)
	}

	for _, item := range arr {
		if re.MatchString(item) {
			return true, nil
		}
	}
	return false, nil
}

func (o *AnyMatchesOperator) GetName() string  { return "any_matches" }
func (o *AnyMatchesOperator) GetPriority() int { return 3 }

// AnyNotMatchesOperator 任意元素不匹配正则操作符
type AnyNotMatchesOperator struct{}

func (o *AnyNotMatchesOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	pattern := fmt.Sprintf("%v", right)

	re, err := regexp.Compile(pattern)
	if err != nil {
		return false, fmt.Errorf("invalid regex pattern: %v", err)
	}

	for _, item := range arr {
		if !re.MatchString(item) {
			return true, nil
		}
	}
	return false, nil
}

func (o *AnyNotMatchesOperator) GetName() string  { return "any_not_matches" }
func (o *AnyNotMatchesOperator) GetPriority() int { return 3 }

// AllEqualsOperator 所有元素等于操作符
type AllEqualsOperator struct{}

func (o *AllEqualsOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	if len(arr) == 0 {
		return false, nil
	}

	rightStr := fmt.Sprintf("%v", right)
	for _, item := range arr {
		if item != rightStr {
			return false, nil
		}
	}
	return true, nil
}

func (o *AllEqualsOperator) GetName() string  { return "all_equals" }
func (o *AllEqualsOperator) GetPriority() int { return 3 }

// AllContainsOperator 所有元素包含操作符
type AllContainsOperator struct{}

func (o *AllContainsOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	if len(arr) == 0 {
		return false, nil
	}

	rightStr := fmt.Sprintf("%v", right)
	for _, item := range arr {
		if !strings.Contains(item, rightStr) {
			return false, nil
		}
	}
	return true, nil
}

func (o *AllContainsOperator) GetName() string  { return "all_contains" }
func (o *AllContainsOperator) GetPriority() int { return 3 }

// AllMatchesOperator 所有元素匹配正则操作符
type AllMatchesOperator struct{}

func (o *AllMatchesOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	if len(arr) == 0 {
		return false, nil
	}

	pattern := fmt.Sprintf("%v", right)
	re, err := regexp.Compile(pattern)
	if err != nil {
		return false, fmt.Errorf("invalid regex pattern: %v", err)
	}

	for _, item := range arr {
		if !re.MatchString(item) {
			return false, nil
		}
	}
	return true, nil
}

func (o *AllMatchesOperator) GetName() string  { return "all_matches" }
func (o *AllMatchesOperator) GetPriority() int { return 3 }

// AllNotMatchesOperator 所有元素不匹配正则操作符
type AllNotMatchesOperator struct{}

func (o *AllNotMatchesOperator) Evaluate(left, right interface{}) (bool, error) {
	arr := toSlice(left)
	if len(arr) == 0 {
		return false, nil
	}

	pattern := fmt.Sprintf("%v", right)
	re, err := regexp.Compile(pattern)
	if err != nil {
		return false, fmt.Errorf("invalid regex pattern: %v", err)
	}

	for _, item := range arr {
		if re.MatchString(item) {
			return false, nil
		}
	}
	return true, nil
}

func (o *AllNotMatchesOperator) GetName() string  { return "all_not_matches" }
func (o *AllNotMatchesOperator) GetPriority() int { return 3 }

// ArrayLengthEqualsOperator 数组长度等于操作符
type ArrayLengthEqualsOperator struct{}

func (o *ArrayLengthEqualsOperator) Evaluate(left, right interface{}) (bool, error) {
	length := getArrayLength(left)
	rightNum, err := strconv.Atoi(fmt.Sprintf("%v", right))
	if err != nil {
		return false, fmt.Errorf("right value must be a number: %v", err)
	}
	return length == rightNum, nil
}

func (o *ArrayLengthEqualsOperator) GetName() string  { return "array_length_equals" }
func (o *ArrayLengthEqualsOperator) GetPriority() int { return 3 }

// ArrayLengthGreaterOperator 数组长度大于操作符
type ArrayLengthGreaterOperator struct{}

func (o *ArrayLengthGreaterOperator) Evaluate(left, right interface{}) (bool, error) {
	length := getArrayLength(left)
	rightNum, err := strconv.Atoi(fmt.Sprintf("%v", right))
	if err != nil {
		return false, fmt.Errorf("right value must be a number: %v", err)
	}
	return length > rightNum, nil
}

func (o *ArrayLengthGreaterOperator) GetName() string  { return "array_length_greater" }
func (o *ArrayLengthGreaterOperator) GetPriority() int { return 3 }

// ArrayLengthLessOperator 数组长度小于操作符
type ArrayLengthLessOperator struct{}

func (o *ArrayLengthLessOperator) Evaluate(left, right interface{}) (bool, error) {
	length := getArrayLength(left)
	rightNum, err := strconv.Atoi(fmt.Sprintf("%v", right))
	if err != nil {
		return false, fmt.Errorf("right value must be a number: %v", err)
	}
	return length < rightNum, nil
}

func (o *ArrayLengthLessOperator) GetName() string  { return "array_length_less" }
func (o *ArrayLengthLessOperator) GetPriority() int { return 3 }

// ArrayIsEmptyOperator 数组为空操作符
type ArrayIsEmptyOperator struct{}

func (o *ArrayIsEmptyOperator) Evaluate(left, right interface{}) (bool, error) {
	length := getArrayLength(left)
	return length == 0, nil
}

func (o *ArrayIsEmptyOperator) GetName() string  { return "array_is_empty" }
func (o *ArrayIsEmptyOperator) GetPriority() int { return 3 }

// ArrayIsNotEmptyOperator 数组不为空操作符
type ArrayIsNotEmptyOperator struct{}

func (o *ArrayIsNotEmptyOperator) Evaluate(left, right interface{}) (bool, error) {
	length := getArrayLength(left)
	return length > 0, nil
}

func (o *ArrayIsNotEmptyOperator) GetName() string  { return "array_is_not_empty" }
func (o *ArrayIsNotEmptyOperator) GetPriority() int { return 3 }
