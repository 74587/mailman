package cel

import (
	"fmt"
	"log"
	"reflect"
	"time"

	"mailman/internal/expression/core"

	"github.com/google/cel-go/cel"
	"github.com/google/cel-go/common/types"
	"github.com/google/cel-go/common/types/ref"
)

// Engine implements the CEL expression engine
type Engine struct {
	*core.BaseEngine
}

// NewEngine creates a new CEL expression engine
func NewEngine() (*Engine, error) {
	engine := &Engine{
		BaseEngine: core.NewBaseEngine(
			core.EngineTypeCEL,
			"CEL Expression",
			"Common Expression Language - A fast, safe, and portable expression language by Google",
		),
	}
	return engine, nil
}

// createEnvWithData creates a CEL environment with data-specific type declarations
func (e *Engine) createEnvWithData(data map[string]interface{}) (*cel.Env, error) {
	// Build variable declarations from data
	var opts []cel.EnvOption

	for name, value := range data {
		opts = append(opts, cel.Variable(name, inferCELType(value)))
	}

	// Add standard extensions
	opts = append(opts, cel.StdLib())

	return cel.NewEnv(opts...)
}

// inferCELType infers the CEL type from a Go value
func inferCELType(value interface{}) *cel.Type {
	if value == nil {
		return cel.AnyType
	}

	switch v := value.(type) {
	case bool:
		return cel.BoolType
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return cel.IntType
	case float32, float64:
		return cel.DoubleType
	case string:
		return cel.StringType
	case []byte:
		return cel.BytesType
	case []string:
		return cel.ListType(cel.StringType)
	case []interface{}:
		if len(v) > 0 {
			elemType := inferCELType(v[0])
			return cel.ListType(elemType)
		}
		return cel.ListType(cel.AnyType)
	case map[string]interface{}:
		return cel.MapType(cel.StringType, cel.AnyType)
	case map[string]string:
		return cel.MapType(cel.StringType, cel.StringType)
	default:
		// For complex types, use reflection
		rt := reflect.TypeOf(value)
		if rt == nil {
			return cel.AnyType
		}
		switch rt.Kind() {
		case reflect.Slice:
			return cel.ListType(cel.AnyType)
		case reflect.Map:
			return cel.MapType(cel.StringType, cel.AnyType)
		case reflect.Struct:
			return cel.AnyType
		default:
			return cel.AnyType
		}
	}
}

// Evaluate evaluates a CEL expression
func (e *Engine) Evaluate(expr string, ctx *core.EvaluationContext, opts *core.EvaluationOptions) (*core.EvaluationResult, error) {
	startTime := time.Now()
	result := &core.EvaluationResult{}

	if opts == nil {
		opts = core.DefaultEvaluationOptions()
	}

	// Create environment with data
	env, err := e.createEnvWithData(ctx.Data)
	if err != nil {
		result.Error = err
		return result, err
	}

	// Parse and check the expression
	ast, issues := env.Compile(expr)
	if issues != nil && issues.Err() != nil {
		err := &core.ErrExpressionSyntax{Message: issues.Err().Error()}
		result.Error = err
		return result, err
	}

	// Create the program
	prg, err := env.Program(ast)
	if err != nil {
		result.Error = err
		return result, err
	}

	// Prepare activation (variables)
	activation := make(map[string]interface{})
	for k, v := range ctx.Data {
		activation[k] = v
	}
	for k, v := range ctx.Variables {
		activation[k] = v
	}

	// Evaluate with timeout
	var evalResult ref.Val
	done := make(chan struct{})
	var evalErr error

	go func() {
		defer close(done)
		evalResult, _, evalErr = prg.Eval(activation)
	}()

	select {
	case <-done:
		if evalErr != nil {
			err := &core.ErrExpressionRuntime{Message: "evaluation failed", Cause: evalErr}
			result.Error = err
			return result, err
		}
	case <-time.After(opts.Timeout):
		err := &core.ErrExpressionTimeout{Timeout: opts.Timeout}
		result.Error = err
		return result, err
	}

	// Convert result
	result.Duration = time.Since(startTime)
	if evalResult != nil {
		result.Value = evalResult.Value()
		result.Type = fmt.Sprintf("%T", result.Value)
		result.StringValue = fmt.Sprintf("%v", result.Value)

		// Handle CEL types
		switch v := evalResult.(type) {
		case types.Bool:
			result.BoolValue = bool(v)
		default:
			result.BoolValue = core.ToBool(result.Value)
		}
	}

	return result, nil
}

// EvaluateBoolean evaluates an expression as boolean
func (e *Engine) EvaluateBoolean(expr string, ctx *core.EvaluationContext) (bool, error) {
	log.Printf("[CELEngine] EvaluateBoolean input: expr=%s", expr)

	opts := core.DefaultEvaluationOptions()
	opts.Mode = core.EvalModeBoolean

	result, err := e.Evaluate(expr, ctx, opts)
	if err != nil {
		log.Printf("[CELEngine] EvaluateBoolean error: %v", err)
		return false, err
	}

	// CEL should return a boolean directly
	var boolResult bool
	if b, ok := result.Value.(bool); ok {
		boolResult = b
	} else {
		boolResult = result.BoolValue
	}

	log.Printf("[CELEngine] EvaluateBoolean output: result=%v", boolResult)
	return boolResult, nil
}

// EvaluateString evaluates an expression as string
func (e *Engine) EvaluateString(expr string, ctx *core.EvaluationContext) (string, error) {
	opts := core.DefaultEvaluationOptions()
	opts.Mode = core.EvalModeString

	result, err := e.Evaluate(expr, ctx, opts)
	if err != nil {
		return "", err
	}

	return result.StringValue, nil
}

// Validate validates a CEL expression
func (e *Engine) Validate(expr string) error {
	// Create a minimal environment for validation
	env, err := cel.NewEnv(cel.StdLib())
	if err != nil {
		return err
	}

	_, issues := env.Parse(expr)
	if issues != nil && issues.Err() != nil {
		return &core.ErrExpressionSyntax{Message: issues.Err().Error()}
	}
	return nil
}

// GetSyntaxHelp returns CEL syntax documentation
func (e *Engine) GetSyntaxHelp() *core.SyntaxHelp {
	return &core.SyntaxHelp{
		Language:         "cel",
		ShortDescription: "CEL (Common Expression Language) is a safe, fast expression language developed by Google.",
		FullDocumentation: `# CEL Expression Language

CEL is designed for evaluating expressions against data in a safe and efficient manner.

## Basic Operators
- Comparison: ==, !=, <, <=, >, >=
- Logical: &&, ||, !
- Arithmetic: +, -, *, /, %
- Membership: in

## String Operations
- Concatenation: "Hello" + " World"
- Contains: "hello".contains("ell")
- StartsWith: "hello".startsWith("he")
- EndsWith: "hello".endsWith("lo")
- Size: size("hello") == 5

## List Operations
- Access: list[0]
- Size: size(list)
- Membership: "item" in list
- All: list.all(x, x > 0)
- Exists: list.exists(x, x > 0)
- Filter: list.filter(x, x > 0)
- Map: list.map(x, x * 2)

## Map Operations
- Access: map["key"] or map.key
- Has: has(map.key)
- Size: size(map)

## Conditional
- Ternary: condition ? value_if_true : value_if_false
`,
		BuiltinFunctions: []core.FunctionDoc{
			{Name: "size", Signature: "size(value) -> int", Description: "Returns the length of a string, list, or map", ReturnType: "int"},
			{Name: "contains", Signature: "string.contains(substring) -> bool", Description: "Checks if string contains substring", ReturnType: "bool"},
			{Name: "startsWith", Signature: "string.startsWith(prefix) -> bool", Description: "Checks if string starts with prefix", ReturnType: "bool"},
			{Name: "endsWith", Signature: "string.endsWith(suffix) -> bool", Description: "Checks if string ends with suffix", ReturnType: "bool"},
			{Name: "matches", Signature: "string.matches(regex) -> bool", Description: "Checks if string matches regex pattern", ReturnType: "bool"},
			{Name: "all", Signature: "list.all(x, predicate) -> bool", Description: "Returns true if all elements satisfy the predicate", ReturnType: "bool"},
			{Name: "exists", Signature: "list.exists(x, predicate) -> bool", Description: "Returns true if any element satisfies the predicate", ReturnType: "bool"},
			{Name: "filter", Signature: "list.filter(x, predicate) -> list", Description: "Returns elements that satisfy the predicate", ReturnType: "list"},
			{Name: "map", Signature: "list.map(x, transform) -> list", Description: "Transforms each element", ReturnType: "list"},
			{Name: "has", Signature: "has(field) -> bool", Description: "Checks if a field exists", ReturnType: "bool"},
		},
		Operators: []core.OperatorDoc{
			{Symbol: "==", Name: "Equal", Description: "Equality comparison"},
			{Symbol: "!=", Name: "Not Equal", Description: "Inequality comparison"},
			{Symbol: "<", Name: "Less Than", Description: "Less than comparison"},
			{Symbol: "<=", Name: "Less Equal", Description: "Less than or equal comparison"},
			{Symbol: ">", Name: "Greater Than", Description: "Greater than comparison"},
			{Symbol: ">=", Name: "Greater Equal", Description: "Greater than or equal comparison"},
			{Symbol: "&&", Name: "And", Description: "Logical AND"},
			{Symbol: "||", Name: "Or", Description: "Logical OR"},
			{Symbol: "!", Name: "Not", Description: "Logical NOT"},
			{Symbol: "in", Name: "In", Description: "Membership test"},
			{Symbol: "?:", Name: "Ternary", Description: "Conditional expression"},
		},
	}
}

// GetExamples returns example CEL expressions
func (e *Engine) GetExamples() []core.Example {
	return []core.Example{
		{
			Title:       "Simple equality",
			Description: "Check if subject equals a specific value",
			Expression:  `Subject == "Important"`,
			ExpectedFor: "Matching exact subject lines",
		},
		{
			Title:       "String contains",
			Description: "Check if subject contains a keyword",
			Expression:  `Subject.contains("urgent")`,
			ExpectedFor: "Finding emails with specific keywords",
		},
		{
			Title:       "Array membership",
			Description: "Check if sender is in a list",
			Expression:  `From.exists(addr, addr.endsWith("@company.com"))`,
			ExpectedFor: "Filtering by sender domain",
		},
		{
			Title:       "Complex condition",
			Description: "Combine multiple conditions",
			Expression:  `Subject.contains("Report") && size(Attachments) > 0`,
			ExpectedFor: "Complex email filtering",
		},
		{
			Title:       "List filtering",
			Description: "Check if any recipient matches",
			Expression:  `To.exists(addr, addr.contains("support"))`,
			ExpectedFor: "Finding emails to specific recipients",
		},
		{
			Title:       "Conditional value",
			Description: "Return different values based on condition",
			Expression:  `HasAttachments ? "Has attachments" : "No attachments"`,
			ExpectedFor: "Generating dynamic values for actions",
		},
	}
}
