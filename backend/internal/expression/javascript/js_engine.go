package javascript

import (
	"fmt"
	"log"
	"strings"
	"time"

	"mailman/internal/expression/core"

	"github.com/dop251/goja"
)

// Engine implements the JavaScript expression engine
type Engine struct {
	*core.BaseEngine
}

// NewEngine creates a new JavaScript expression engine
func NewEngine() (*Engine, error) {
	engine := &Engine{
		BaseEngine: core.NewBaseEngine(
			core.EngineTypeJavaScript,
			"JavaScript Expression",
			"JavaScript - Full-featured scripting with familiar syntax",
		),
	}
	return engine, nil
}

// createRuntime creates a new JavaScript runtime with security restrictions
func (e *Engine) createRuntime(ctx *core.EvaluationContext, opts *core.EvaluationOptions) (*goja.Runtime, error) {
	vm := goja.New()

	// Set up interrupt for timeout
	if opts.Timeout > 0 {
		time.AfterFunc(opts.Timeout, func() {
			vm.Interrupt("execution timeout")
		})
	}

	// Inject data into the runtime
	for name, value := range ctx.Data {
		if err := vm.Set(name, value); err != nil {
			return nil, fmt.Errorf("failed to set variable %s: %w", name, err)
		}
	}

	// Inject additional variables
	for name, value := range ctx.Variables {
		if err := vm.Set(name, value); err != nil {
			return nil, fmt.Errorf("failed to set variable %s: %w", name, err)
		}
	}

	// Add helper functions
	e.registerHelperFunctions(vm)

	return vm, nil
}

// registerHelperFunctions adds useful helper functions to the runtime
func (e *Engine) registerHelperFunctions(vm *goja.Runtime) {
	// String helpers
	vm.Set("lower", func(s string) string {
		return strings.ToLower(s)
	})
	vm.Set("upper", func(s string) string {
		return strings.ToUpper(s)
	})
	vm.Set("trim", func(s string) string {
		return strings.TrimSpace(s)
	})
	vm.Set("contains", func(s, substr string) bool {
		return strings.Contains(s, substr)
	})
	vm.Set("startsWith", func(s, prefix string) bool {
		return strings.HasPrefix(s, prefix)
	})
	vm.Set("endsWith", func(s, suffix string) bool {
		return strings.HasSuffix(s, suffix)
	})

	// Array helpers
	vm.Set("anyMatch", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) < 2 {
			return vm.ToValue(false)
		}
		arr := call.Argument(0).Export()
		predicate, ok := goja.AssertFunction(call.Argument(1))
		if !ok {
			return vm.ToValue(false)
		}

		switch v := arr.(type) {
		case []interface{}:
			for _, item := range v {
				result, err := predicate(goja.Undefined(), vm.ToValue(item))
				if err == nil && result.ToBoolean() {
					return vm.ToValue(true)
				}
			}
		case []string:
			for _, item := range v {
				result, err := predicate(goja.Undefined(), vm.ToValue(item))
				if err == nil && result.ToBoolean() {
					return vm.ToValue(true)
				}
			}
		}
		return vm.ToValue(false)
	})

	vm.Set("allMatch", func(call goja.FunctionCall) goja.Value {
		if len(call.Arguments) < 2 {
			return vm.ToValue(false)
		}
		arr := call.Argument(0).Export()
		predicate, ok := goja.AssertFunction(call.Argument(1))
		if !ok {
			return vm.ToValue(false)
		}

		switch v := arr.(type) {
		case []interface{}:
			if len(v) == 0 {
				return vm.ToValue(false)
			}
			for _, item := range v {
				result, err := predicate(goja.Undefined(), vm.ToValue(item))
				if err != nil || !result.ToBoolean() {
					return vm.ToValue(false)
				}
			}
			return vm.ToValue(true)
		case []string:
			if len(v) == 0 {
				return vm.ToValue(false)
			}
			for _, item := range v {
				result, err := predicate(goja.Undefined(), vm.ToValue(item))
				if err != nil || !result.ToBoolean() {
					return vm.ToValue(false)
				}
			}
			return vm.ToValue(true)
		}
		return vm.ToValue(false)
	})

	// Logging (disabled for security, but could be enabled for debugging)
	vm.Set("console", map[string]interface{}{
		"log": func(args ...interface{}) {
			// Intentionally no-op for security
		},
	})
}

// Evaluate evaluates a JavaScript expression
func (e *Engine) Evaluate(expr string, ctx *core.EvaluationContext, opts *core.EvaluationOptions) (*core.EvaluationResult, error) {
	startTime := time.Now()
	result := &core.EvaluationResult{}

	if opts == nil {
		opts = core.DefaultEvaluationOptions()
	}

	// Create runtime
	vm, err := e.createRuntime(ctx, opts)
	if err != nil {
		result.Error = err
		return result, err
	}

	// Wrap expression in an IIFE if it's not a simple expression
	script := expr
	if !strings.HasPrefix(strings.TrimSpace(expr), "(") && strings.Contains(expr, ";") {
		// Multi-statement expression, wrap in IIFE
		script = fmt.Sprintf("(function() { %s })();", expr)
	}

	// Run the expression
	value, err := vm.RunString(script)
	if err != nil {
		// Check if it's a timeout interrupt
		if strings.Contains(err.Error(), "timeout") {
			result.Error = &core.ErrExpressionTimeout{Timeout: opts.Timeout}
		} else {
			result.Error = &core.ErrExpressionRuntime{Message: "JavaScript execution failed", Cause: err}
		}
		return result, result.Error
	}

	// Convert result
	result.Duration = time.Since(startTime)
	if value != nil && !goja.IsUndefined(value) && !goja.IsNull(value) {
		result.Value = value.Export()
		result.Type = fmt.Sprintf("%T", result.Value)
		result.StringValue = value.String()
		result.BoolValue = value.ToBoolean()
	} else {
		result.Value = nil
		result.Type = "undefined"
		result.StringValue = ""
		result.BoolValue = false
	}

	return result, nil
}

// EvaluateBoolean evaluates an expression as boolean
func (e *Engine) EvaluateBoolean(expr string, ctx *core.EvaluationContext) (bool, error) {
	log.Printf("[JSEngine] EvaluateBoolean input: expr=%s", expr)

	opts := core.DefaultEvaluationOptions()
	opts.Mode = core.EvalModeBoolean

	result, err := e.Evaluate(expr, ctx, opts)
	if err != nil {
		log.Printf("[JSEngine] EvaluateBoolean error: %v", err)
		return false, err
	}

	log.Printf("[JSEngine] EvaluateBoolean output: result=%v", result.BoolValue)
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

// Validate validates a JavaScript expression
func (e *Engine) Validate(expr string) error {
	// Use goja.Compile to validate the expression
	_, err := goja.Compile("validate", expr, false)
	if err != nil {
		return &core.ErrExpressionSyntax{Message: err.Error()}
	}
	return nil
}

// GetSyntaxHelp returns JavaScript syntax documentation
func (e *Engine) GetSyntaxHelp() *core.SyntaxHelp {
	return &core.SyntaxHelp{
		Language:         "javascript",
		ShortDescription: "JavaScript - Full-featured scripting with familiar syntax for web developers.",
		FullDocumentation: `# JavaScript Expression Engine

Standard JavaScript (ES5+) expressions for powerful data manipulation.

## Basic Operators
- Comparison: ===, !==, ==, !=, <, <=, >, >=
- Logical: &&, ||, !
- Arithmetic: +, -, *, /, %, **
- String: + (concatenation)

## Data Access
- Direct: Subject, From, To
- Nested: email.headers["X-Custom"]
- Array: From[0], Attachments.length

## String Methods
- includes(), startsWith(), endsWith()
- toLowerCase(), toUpperCase(), trim()
- split(), slice(), substring()
- match(), replace()

## Array Methods
- some(), every(), filter(), map(), find()
- includes(), indexOf(), length
- forEach(), reduce()

## Examples

### Boolean (for conditions)
` + "```javascript" + `
// Simple check
Subject.includes("urgent")

// Multiple conditions
From.some(addr => addr.endsWith("@company.com")) && Subject.includes("Report")

// Array operations
Attachments.length > 0 && Attachments.some(a => a.filename.endsWith(".pdf"))
` + "```" + `

### String (for actions)
` + "```javascript" + `
// Format output
` + "`" + `Email from ${From[0]}: ${Subject.toUpperCase()}` + "`" + `

// Extract values
Subject.match(/TICKET-(\d+)/)?.[1] || "NO TICKET"
` + "```" + `

## Security Notes
- No access to filesystem, network, or system
- Timeout protection (default 5 seconds)
- console.log is disabled
`,
		BuiltinFunctions: []core.FunctionDoc{
			// String
			{Name: "includes", Signature: "str.includes(search) -> bool", Description: "Check if string contains substring", ReturnType: "bool"},
			{Name: "startsWith", Signature: "str.startsWith(prefix) -> bool", Description: "Check if string starts with prefix", ReturnType: "bool"},
			{Name: "endsWith", Signature: "str.endsWith(suffix) -> bool", Description: "Check if string ends with suffix", ReturnType: "bool"},
			{Name: "toLowerCase", Signature: "str.toLowerCase() -> string", Description: "Convert to lowercase", ReturnType: "string"},
			{Name: "toUpperCase", Signature: "str.toUpperCase() -> string", Description: "Convert to uppercase", ReturnType: "string"},
			{Name: "trim", Signature: "str.trim() -> string", Description: "Remove whitespace", ReturnType: "string"},
			{Name: "split", Signature: "str.split(sep) -> array", Description: "Split string", ReturnType: "array"},
			{Name: "match", Signature: "str.match(regex) -> array|null", Description: "Match regex", ReturnType: "array"},
			{Name: "replace", Signature: "str.replace(search, replacement) -> string", Description: "Replace substring", ReturnType: "string"},
			// Array
			{Name: "some", Signature: "arr.some(fn) -> bool", Description: "Test if any element matches", ReturnType: "bool"},
			{Name: "every", Signature: "arr.every(fn) -> bool", Description: "Test if all elements match", ReturnType: "bool"},
			{Name: "filter", Signature: "arr.filter(fn) -> array", Description: "Filter elements", ReturnType: "array"},
			{Name: "map", Signature: "arr.map(fn) -> array", Description: "Transform elements", ReturnType: "array"},
			{Name: "find", Signature: "arr.find(fn) -> value", Description: "Find first matching element", ReturnType: "any"},
			{Name: "includes", Signature: "arr.includes(value) -> bool", Description: "Check if array contains value", ReturnType: "bool"},
			// Custom helpers
			{Name: "lower", Signature: "lower(str) -> string", Description: "Convert to lowercase (helper)", ReturnType: "string"},
			{Name: "upper", Signature: "upper(str) -> string", Description: "Convert to uppercase (helper)", ReturnType: "string"},
			{Name: "contains", Signature: "contains(str, substr) -> bool", Description: "Check contains (helper)", ReturnType: "bool"},
			{Name: "anyMatch", Signature: "anyMatch(arr, fn) -> bool", Description: "Check if any element matches predicate", ReturnType: "bool"},
			{Name: "allMatch", Signature: "allMatch(arr, fn) -> bool", Description: "Check if all elements match predicate", ReturnType: "bool"},
		},
		Operators: []core.OperatorDoc{
			{Symbol: "===", Name: "Strict Equal", Description: "Strict equality comparison"},
			{Symbol: "!==", Name: "Strict Not Equal", Description: "Strict inequality comparison"},
			{Symbol: "==", Name: "Equal", Description: "Loose equality comparison"},
			{Symbol: "!=", Name: "Not Equal", Description: "Loose inequality comparison"},
			{Symbol: "&&", Name: "And", Description: "Logical AND"},
			{Symbol: "||", Name: "Or", Description: "Logical OR"},
			{Symbol: "!", Name: "Not", Description: "Logical NOT"},
			{Symbol: "?:", Name: "Ternary", Description: "Conditional expression (a ? b : c)"},
			{Symbol: "?.", Name: "Optional Chain", Description: "Optional chaining (a?.b)"},
			{Symbol: "??", Name: "Nullish Coalesce", Description: "Nullish coalescing (a ?? b)"},
			{Symbol: "=>", Name: "Arrow Function", Description: "Arrow function syntax"},
		},
	}
}

// GetExamples returns example JavaScript expressions
func (e *Engine) GetExamples() []core.Example {
	return []core.Example{
		{
			Title:       "Simple string check",
			Description: "Check if subject contains keyword",
			Expression:  `Subject.includes("urgent")`,
			ExpectedFor: "Basic keyword matching",
		},
		{
			Title:       "Domain check",
			Description: "Check if sender is from company domain",
			Expression:  `From.some(addr => addr.endsWith("@company.com"))`,
			ExpectedFor: "Sender domain filtering",
		},
		{
			Title:       "Multiple conditions",
			Description: "Combine multiple conditions",
			Expression:  `Subject.includes("Report") && Attachments.length > 0`,
			ExpectedFor: "Complex filtering",
		},
		{
			Title:       "Regex matching",
			Description: "Match ticket number in subject",
			Expression:  `/TICKET-\d+/.test(Subject)`,
			ExpectedFor: "Pattern-based filtering",
		},
		{
			Title:       "Array filtering",
			Description: "Check for PDF attachments",
			Expression:  `Attachments.some(a => a.filename.endsWith(".pdf"))`,
			ExpectedFor: "Attachment filtering",
		},
		{
			Title:       "Template string",
			Description: "Generate formatted output",
			Expression:  "`From: ${From[0]}, Subject: ${Subject}`",
			ExpectedFor: "Action message formatting",
		},
		{
			Title:       "Complex logic",
			Description: "Detailed condition with fallback",
			Expression:  `(HasAttachments && Subject.match(/invoice/i)) || From.some(a => a.includes("billing"))`,
			ExpectedFor: "Complex business rules",
		},
	}
}
