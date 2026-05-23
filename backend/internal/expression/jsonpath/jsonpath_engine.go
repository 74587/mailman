package jsonpath

import (
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mailman/internal/expression/core"

	"github.com/PaesslerAG/jsonpath"
)

// Engine implements the JSONPath expression engine
type Engine struct {
	*core.BaseEngine
}

// NewEngine creates a new JSONPath expression engine
func NewEngine() (*Engine, error) {
	engine := &Engine{
		BaseEngine: core.NewBaseEngine(
			core.EngineTypeJSONPath,
			"JSONPath Expression",
			"JSONPath - Query and extract data from JSON structures",
		),
	}
	return engine, nil
}

// ExpressionFormat represents the format of a JSONPath expression
type ExpressionFormat struct {
	Path       string      // JSONPath query
	Operator   string      // Comparison operator (optional)
	Value      interface{} // Comparison value (optional)
	ReturnType string      // Expected return type: "boolean", "string", "array", "any"
}

// parseExpression parses a JSONPath expression that may include comparison
// Supported formats:
// - "$.Subject" - just extract value
// - "$.Subject == 'test'" - extract and compare
// - "$.From[?(@.endsWith('@company.com'))]" - filter expression
func parseExpression(expr string) (*ExpressionFormat, error) {
	expr = strings.TrimSpace(expr)

	// Check for comparison operators
	operators := []string{"===", "!==", "==", "!=", ">=", "<=", ">", "<", "=~"}
	for _, op := range operators {
		if idx := strings.Index(expr, " "+op+" "); idx > 0 {
			path := strings.TrimSpace(expr[:idx])
			valueStr := strings.TrimSpace(expr[idx+len(op)+2:])

			// Parse the value
			var value interface{}
			valueStr = strings.Trim(valueStr, "'\"")

			// Try to parse as number
			if n, err := strconv.ParseFloat(valueStr, 64); err == nil {
				value = n
			} else if valueStr == "true" {
				value = true
			} else if valueStr == "false" {
				value = false
			} else if valueStr == "null" || valueStr == "nil" {
				value = nil
			} else {
				value = valueStr
			}

			return &ExpressionFormat{
				Path:       path,
				Operator:   op,
				Value:      value,
				ReturnType: "boolean",
			}, nil
		}
	}

	// No comparison operator, return as path-only
	return &ExpressionFormat{
		Path:       expr,
		ReturnType: "any",
	}, nil
}

// compareValues compares two values using the specified operator
func compareValues(left interface{}, op string, right interface{}) (bool, error) {
	leftStr := fmt.Sprintf("%v", left)
	rightStr := fmt.Sprintf("%v", right)

	switch op {
	case "==", "===":
		return leftStr == rightStr, nil
	case "!=", "!==":
		return leftStr != rightStr, nil
	case ">":
		leftNum, _ := strconv.ParseFloat(leftStr, 64)
		rightNum, _ := strconv.ParseFloat(rightStr, 64)
		return leftNum > rightNum, nil
	case ">=":
		leftNum, _ := strconv.ParseFloat(leftStr, 64)
		rightNum, _ := strconv.ParseFloat(rightStr, 64)
		return leftNum >= rightNum, nil
	case "<":
		leftNum, _ := strconv.ParseFloat(leftStr, 64)
		rightNum, _ := strconv.ParseFloat(rightStr, 64)
		return leftNum < rightNum, nil
	case "<=":
		leftNum, _ := strconv.ParseFloat(leftStr, 64)
		rightNum, _ := strconv.ParseFloat(rightStr, 64)
		return leftNum <= rightNum, nil
	case "=~":
		// Regex match
		re, err := regexp.Compile(rightStr)
		if err != nil {
			return false, fmt.Errorf("invalid regex: %w", err)
		}
		return re.MatchString(leftStr), nil
	default:
		return false, fmt.Errorf("unknown operator: %s", op)
	}
}

// Evaluate evaluates a JSONPath expression
func (e *Engine) Evaluate(expr string, ctx *core.EvaluationContext, opts *core.EvaluationOptions) (*core.EvaluationResult, error) {
	startTime := time.Now()
	result := &core.EvaluationResult{}

	if opts == nil {
		opts = core.DefaultEvaluationOptions()
	}

	// Parse the expression
	parsed, err := parseExpression(expr)
	if err != nil {
		result.Error = &core.ErrExpressionSyntax{Message: err.Error()}
		return result, result.Error
	}

	// Prepare data as JSON-compatible map
	data := ctx.Data
	if len(ctx.Variables) > 0 {
		// Merge variables into data
		merged := make(map[string]interface{})
		for k, v := range data {
			merged[k] = v
		}
		for k, v := range ctx.Variables {
			merged[k] = v
		}
		data = merged
	}

	// Use channels for timeout
	type evalResult struct {
		value interface{}
		err   error
	}
	done := make(chan evalResult, 1)

	go func() {
		// Convert data to JSON and back to ensure proper types
		jsonBytes, err := json.Marshal(data)
		if err != nil {
			done <- evalResult{nil, fmt.Errorf("failed to marshal data: %w", err)}
			return
		}

		var jsonData interface{}
		if err := json.Unmarshal(jsonBytes, &jsonData); err != nil {
			done <- evalResult{nil, fmt.Errorf("failed to unmarshal data: %w", err)}
			return
		}

		// Execute JSONPath query
		value, err := jsonpath.Get(parsed.Path, jsonData)
		done <- evalResult{value, err}
	}()

	select {
	case res := <-done:
		if res.err != nil {
			result.Error = &core.ErrExpressionRuntime{Message: "JSONPath query failed", Cause: res.err}
			return result, result.Error
		}

		result.Value = res.value
		result.Duration = time.Since(startTime)
		result.Type = fmt.Sprintf("%T", res.value)
		result.StringValue = fmt.Sprintf("%v", res.value)

		// Handle comparison if present
		if parsed.Operator != "" {
			boolResult, err := compareValues(res.value, parsed.Operator, parsed.Value)
			if err != nil {
				result.Error = err
				return result, err
			}
			result.BoolValue = boolResult
			result.Value = boolResult
			result.StringValue = fmt.Sprintf("%v", boolResult)
		} else {
			// No comparison - convert result to boolean based on value
			result.BoolValue = resultToBool(res.value)
		}

	case <-time.After(opts.Timeout):
		result.Error = &core.ErrExpressionTimeout{Timeout: opts.Timeout}
		return result, result.Error
	}

	return result, nil
}

// resultToBool converts a JSONPath result to boolean
func resultToBool(value interface{}) bool {
	if value == nil {
		return false
	}

	switch v := value.(type) {
	case bool:
		return v
	case string:
		return v != ""
	case float64:
		return v != 0
	case int:
		return v != 0
	case []interface{}:
		return len(v) > 0
	case map[string]interface{}:
		return len(v) > 0
	default:
		return true
	}
}

// EvaluateBoolean evaluates an expression as boolean
func (e *Engine) EvaluateBoolean(expr string, ctx *core.EvaluationContext) (bool, error) {
	log.Printf("[JSONPathEngine] EvaluateBoolean input: expr=%s", expr)

	opts := core.DefaultEvaluationOptions()
	opts.Mode = core.EvalModeBoolean

	result, err := e.Evaluate(expr, ctx, opts)
	if err != nil {
		log.Printf("[JSONPathEngine] EvaluateBoolean error: %v", err)
		return false, err
	}

	log.Printf("[JSONPathEngine] EvaluateBoolean output: result=%v", result.BoolValue)
	return result.BoolValue, nil
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

// Validate validates a JSONPath expression
func (e *Engine) Validate(expr string) error {
	parsed, err := parseExpression(expr)
	if err != nil {
		return err
	}

	// Try to compile the path
	_, err = jsonpath.Get(parsed.Path, map[string]interface{}{})
	if err != nil && !strings.Contains(err.Error(), "unknown key") {
		return &core.ErrExpressionSyntax{Message: err.Error()}
	}

	return nil
}

// GetSyntaxHelp returns JSONPath syntax documentation
func (e *Engine) GetSyntaxHelp() *core.SyntaxHelp {
	return &core.SyntaxHelp{
		Language:         "jsonpath",
		ShortDescription: "JSONPath - Query language for extracting data from JSON structures.",
		FullDocumentation: `# JSONPath Expression Language

JSONPath provides a way to query JSON data similar to XPath for XML.

## Basic Syntax

| Expression | Description |
|------------|-------------|
| $ | Root object |
| . | Child operator |
| [] | Array subscript |
| * | Wildcard |
| .. | Recursive descent |
| ?() | Filter expression |
| @ | Current node in filter |

## Path Examples

| Path | Description |
|------|-------------|
| $.Subject | Get Subject field |
| $.From[0] | First element of From array |
| $.From[*] | All elements of From array |
| $.Attachments[?(@.size > 1000)] | Filter attachments by size |
| $..filename | All filename fields (recursive) |

## Comparison Operators

JSONPath expressions can include comparisons:
- $.Subject == 'test' - Equal
- $.size > 100 - Greater than
- $.Subject =~ 'urgent' - Regex match

## Filter Expressions

Use ?() for filtering:
` + "```" + `
$.From[?(@.endsWith('@company.com'))]
$.Attachments[?(@.size > 1000 && @.filename.endsWith('.pdf'))]
` + "```" + `

## Boolean Result Rules

- Empty array/null → false
- Non-empty array → true
- Empty string → false
- Non-empty string → true
- Zero → false
- Non-zero → true
`,
		BuiltinFunctions: []core.FunctionDoc{
			{Name: "$", Signature: "$", Description: "Root object reference", ReturnType: "object"},
			{Name: ".", Signature: ".field", Description: "Access child field", ReturnType: "any"},
			{Name: "[]", Signature: "[index]", Description: "Array element access", ReturnType: "any"},
			{Name: "*", Signature: ".*", Description: "Wildcard - all children", ReturnType: "array"},
			{Name: "..", Signature: "..field", Description: "Recursive descent", ReturnType: "array"},
			{Name: "?()", Signature: "[?(@.field == value)]", Description: "Filter expression", ReturnType: "array"},
			{Name: "@", Signature: "@", Description: "Current element in filter", ReturnType: "any"},
			{Name: "length", Signature: "$.array.length", Description: "Array length", ReturnType: "number"},
		},
		Operators: []core.OperatorDoc{
			{Symbol: "==", Name: "Equal", Description: "Equality comparison"},
			{Symbol: "!=", Name: "Not Equal", Description: "Inequality comparison"},
			{Symbol: ">", Name: "Greater Than", Description: "Greater than comparison"},
			{Symbol: ">=", Name: "Greater Equal", Description: "Greater than or equal"},
			{Symbol: "<", Name: "Less Than", Description: "Less than comparison"},
			{Symbol: "<=", Name: "Less Equal", Description: "Less than or equal"},
			{Symbol: "=~", Name: "Regex Match", Description: "Regular expression match"},
			{Symbol: "&&", Name: "And", Description: "Logical AND (in filters)"},
			{Symbol: "||", Name: "Or", Description: "Logical OR (in filters)"},
		},
	}
}

// GetExamples returns example JSONPath expressions
func (e *Engine) GetExamples() []core.Example {
	return []core.Example{
		{
			Title:       "Simple field access",
			Description: "Get the subject field",
			Expression:  `$.Subject`,
			ExpectedFor: "Extracting field values",
		},
		{
			Title:       "Array element",
			Description: "Get first sender address",
			Expression:  `$.From[0]`,
			ExpectedFor: "Accessing array elements",
		},
		{
			Title:       "Field comparison",
			Description: "Check if subject contains text",
			Expression:  `$.Subject =~ 'urgent'`,
			ExpectedFor: "Regex matching in conditions",
		},
		{
			Title:       "Array check",
			Description: "Check if has attachments",
			Expression:  `$.Attachments[0]`,
			ExpectedFor: "Checking if array has elements (returns truthy if exists)",
		},
		{
			Title:       "Filter expression",
			Description: "Find senders from domain",
			Expression:  `$.From[?(@.endsWith('@company.com'))]`,
			ExpectedFor: "Filtering array elements",
		},
		{
			Title:       "Numeric comparison",
			Description: "Check attachment count",
			Expression:  `$.AttachmentCount > 0`,
			ExpectedFor: "Numeric comparisons",
		},
		{
			Title:       "Wildcard access",
			Description: "Get all headers",
			Expression:  `$.Headers.*`,
			ExpectedFor: "Accessing all fields of an object",
		},
	}
}
