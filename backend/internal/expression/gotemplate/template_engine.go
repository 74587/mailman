package gotemplate

import (
	"bytes"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"text/template"
	"time"

	"mailman/internal/expression/core"
)

// Engine implements the Go template expression engine
type Engine struct {
	*core.BaseEngine
	funcMap template.FuncMap
}

// NewEngine creates a new Go template expression engine
func NewEngine() (*Engine, error) {
	engine := &Engine{
		BaseEngine: core.NewBaseEngine(
			core.EngineTypeGoTemplate,
			"Go Template",
			"Go's text/template - Powerful templating with logic control",
		),
	}

	// Initialize function map with useful functions
	engine.funcMap = engine.createFuncMap()

	return engine, nil
}

// createFuncMap creates the template function map
func (e *Engine) createFuncMap() template.FuncMap {
	return template.FuncMap{
		// String functions
		"lower":      strings.ToLower,
		"upper":      strings.ToUpper,
		"title":      strings.Title,
		"trim":       strings.TrimSpace,
		"trimPrefix": strings.TrimPrefix,
		"trimSuffix": strings.TrimSuffix,
		"contains":   strings.Contains,
		"hasPrefix":  strings.HasPrefix,
		"hasSuffix":  strings.HasSuffix,
		"replace":    strings.ReplaceAll,
		"split":      strings.Split,
		"join":       strings.Join,
		"repeat":     strings.Repeat,
		"index":      strings.Index,

		// Comparison functions
		"eq": func(a, b interface{}) bool {
			return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
		},
		"ne": func(a, b interface{}) bool {
			return fmt.Sprintf("%v", a) != fmt.Sprintf("%v", b)
		},
		"lt": func(a, b interface{}) bool {
			return toFloat(a) < toFloat(b)
		},
		"le": func(a, b interface{}) bool {
			return toFloat(a) <= toFloat(b)
		},
		"gt": func(a, b interface{}) bool {
			return toFloat(a) > toFloat(b)
		},
		"ge": func(a, b interface{}) bool {
			return toFloat(a) >= toFloat(b)
		},

		// Logic functions
		"and": func(a, b bool) bool {
			return a && b
		},
		"or": func(a, b bool) bool {
			return a || b
		},
		"not": func(a bool) bool {
			return !a
		},

		// Collection functions
		"len": func(v interface{}) int {
			switch val := v.(type) {
			case string:
				return len(val)
			case []interface{}:
				return len(val)
			case []string:
				return len(val)
			case map[string]interface{}:
				return len(val)
			default:
				return 0
			}
		},
		"first": func(v interface{}) interface{} {
			switch val := v.(type) {
			case []interface{}:
				if len(val) > 0 {
					return val[0]
				}
			case []string:
				if len(val) > 0 {
					return val[0]
				}
			}
			return nil
		},
		"last": func(v interface{}) interface{} {
			switch val := v.(type) {
			case []interface{}:
				if len(val) > 0 {
					return val[len(val)-1]
				}
			case []string:
				if len(val) > 0 {
					return val[len(val)-1]
				}
			}
			return nil
		},
		"inList": func(item interface{}, list interface{}) bool {
			itemStr := fmt.Sprintf("%v", item)
			switch val := list.(type) {
			case []interface{}:
				for _, v := range val {
					if fmt.Sprintf("%v", v) == itemStr {
						return true
					}
				}
			case []string:
				for _, v := range val {
					if v == itemStr {
						return true
					}
				}
			}
			return false
		},
		"anyContains": func(list interface{}, substr string) bool {
			switch val := list.(type) {
			case []interface{}:
				for _, v := range val {
					if strings.Contains(fmt.Sprintf("%v", v), substr) {
						return true
					}
				}
			case []string:
				for _, v := range val {
					if strings.Contains(v, substr) {
						return true
					}
				}
			}
			return false
		},
		"allContains": func(list interface{}, substr string) bool {
			switch val := list.(type) {
			case []interface{}:
				if len(val) == 0 {
					return false
				}
				for _, v := range val {
					if !strings.Contains(fmt.Sprintf("%v", v), substr) {
						return false
					}
				}
				return true
			case []string:
				if len(val) == 0 {
					return false
				}
				for _, v := range val {
					if !strings.Contains(v, substr) {
						return false
					}
				}
				return true
			}
			return false
		},

		// Type conversion
		"toString": func(v interface{}) string {
			return fmt.Sprintf("%v", v)
		},
		"toInt": func(v interface{}) int {
			return int(toFloat(v))
		},
		"toFloat": toFloat,
		"toBool": func(v interface{}) bool {
			return core.ToBool(v)
		},

		// Regex functions
		"match": func(pattern, s string) bool {
			re, err := regexp.Compile(pattern)
			if err != nil {
				return false
			}
			return re.MatchString(s)
		},
		"findAll": func(pattern, s string) []string {
			re, err := regexp.Compile(pattern)
			if err != nil {
				return nil
			}
			return re.FindAllString(s, -1)
		},
		"replaceRegex": func(pattern, repl, s string) string {
			re, err := regexp.Compile(pattern)
			if err != nil {
				return s
			}
			return re.ReplaceAllString(s, repl)
		},

		// Date/time functions
		"now": time.Now,
		"formatDate": func(format string, t time.Time) string {
			return t.Format(format)
		},
		"parseDate": func(layout, value string) (time.Time, error) {
			return time.Parse(layout, value)
		},

		// Default value
		"default": func(defaultVal, val interface{}) interface{} {
			if val == nil || fmt.Sprintf("%v", val) == "" {
				return defaultVal
			}
			return val
		},

		// Conditional
		"ternary": func(condition bool, trueVal, falseVal interface{}) interface{} {
			if condition {
				return trueVal
			}
			return falseVal
		},

		// JSON-like access
		"get": func(m interface{}, key string) interface{} {
			switch val := m.(type) {
			case map[string]interface{}:
				return val[key]
			case map[string]string:
				return val[key]
			}
			return nil
		},
		"has": func(m interface{}, key string) bool {
			switch val := m.(type) {
			case map[string]interface{}:
				_, ok := val[key]
				return ok
			case map[string]string:
				_, ok := val[key]
				return ok
			}
			return false
		},
	}
}

// toFloat converts any value to float64
func toFloat(v interface{}) float64 {
	switch val := v.(type) {
	case int:
		return float64(val)
	case int8:
		return float64(val)
	case int16:
		return float64(val)
	case int32:
		return float64(val)
	case int64:
		return float64(val)
	case uint:
		return float64(val)
	case uint8:
		return float64(val)
	case uint16:
		return float64(val)
	case uint32:
		return float64(val)
	case uint64:
		return float64(val)
	case float32:
		return float64(val)
	case float64:
		return val
	case string:
		f, _ := strconv.ParseFloat(val, 64)
		return f
	default:
		return 0
	}
}

// Evaluate evaluates a Go template expression
func (e *Engine) Evaluate(expr string, ctx *core.EvaluationContext, opts *core.EvaluationOptions) (*core.EvaluationResult, error) {
	startTime := time.Now()
	result := &core.EvaluationResult{}

	if opts == nil {
		opts = core.DefaultEvaluationOptions()
	}

	// Parse the template
	tmpl, err := template.New("expr").Funcs(e.funcMap).Parse(expr)
	if err != nil {
		result.Error = &core.ErrExpressionSyntax{Message: err.Error()}
		return result, result.Error
	}

	// Prepare data context - merge Data and Variables
	data := make(map[string]interface{})
	for k, v := range ctx.Data {
		data[k] = v
	}
	for k, v := range ctx.Variables {
		data[k] = v
	}

	// Execute with timeout
	var buf bytes.Buffer
	done := make(chan error, 1)

	go func() {
		done <- tmpl.Execute(&buf, data)
	}()

	select {
	case err := <-done:
		if err != nil {
			result.Error = &core.ErrExpressionRuntime{Message: "template execution failed", Cause: err}
			return result, result.Error
		}
	case <-time.After(opts.Timeout):
		result.Error = &core.ErrExpressionTimeout{Timeout: opts.Timeout}
		return result, result.Error
	}

	// Process result
	result.Duration = time.Since(startTime)
	output := strings.TrimSpace(buf.String())
	result.StringValue = output
	result.Value = output

	// Determine boolean value
	result.BoolValue = parseBoolResult(output)
	result.Type = "string"

	return result, nil
}

// parseBoolResult parses a string result as boolean
func parseBoolResult(s string) bool {
	s = strings.TrimSpace(strings.ToLower(s))
	switch s {
	case "true", "1", "yes", "on":
		return true
	case "false", "0", "no", "off", "":
		return false
	default:
		// Non-empty string is truthy
		return s != ""
	}
}

// EvaluateBoolean evaluates an expression as boolean
func (e *Engine) EvaluateBoolean(expr string, ctx *core.EvaluationContext) (bool, error) {
	log.Printf("[GoTemplateEngine] EvaluateBoolean input: expr=%s", expr)

	opts := core.DefaultEvaluationOptions()
	opts.Mode = core.EvalModeBoolean

	result, err := e.Evaluate(expr, ctx, opts)
	if err != nil {
		log.Printf("[GoTemplateEngine] EvaluateBoolean error: %v", err)
		return false, err
	}

	log.Printf("[GoTemplateEngine] EvaluateBoolean output: result=%v", result.BoolValue)
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

// Validate validates a Go template expression
func (e *Engine) Validate(expr string) error {
	_, err := template.New("validate").Funcs(e.funcMap).Parse(expr)
	if err != nil {
		return &core.ErrExpressionSyntax{Message: err.Error()}
	}
	return nil
}

// GetSyntaxHelp returns Go template syntax documentation
func (e *Engine) GetSyntaxHelp() *core.SyntaxHelp {
	return &core.SyntaxHelp{
		Language:         "go-template",
		ShortDescription: "Go Template is a powerful text templating engine with logic control.",
		FullDocumentation: `# Go Template Language

Go templates provide rich text generation with embedded logic.

## Basic Syntax
- Variables: {{ .FieldName }}
- Nested fields: {{ .Email.Subject }}
- Pipelines: {{ .Value | upper | trim }}

## Control Structures
### If/Else
` + "```" + `
{{ if .Condition }}
  true branch
{{ else }}
  false branch
{{ end }}
` + "```" + `

### Range (loops)
` + "```" + `
{{ range .Items }}
  {{ . }}
{{ end }}
` + "```" + `

### With (scoping)
` + "```" + `
{{ with .Email }}
  Subject: {{ .Subject }}
{{ end }}
` + "```" + `

## Boolean Expressions
For condition plugins, the template should output "true" or "false":
` + "```" + `
{{ if and (contains .Subject "urgent") (gt (len .Attachments) 0) }}true{{ else }}false{{ end }}
` + "```" + `

## String Expressions
For action plugins, output any string:
` + "```" + `
Subject: {{ .Subject | upper }}
From: {{ first .From }}
` + "```" + `
`,
		BuiltinFunctions: []core.FunctionDoc{
			// String functions
			{Name: "lower", Signature: "lower(string) -> string", Description: "Convert to lowercase", ReturnType: "string"},
			{Name: "upper", Signature: "upper(string) -> string", Description: "Convert to uppercase", ReturnType: "string"},
			{Name: "trim", Signature: "trim(string) -> string", Description: "Remove leading/trailing whitespace", ReturnType: "string"},
			{Name: "contains", Signature: "contains(string, substring) -> bool", Description: "Check if string contains substring", ReturnType: "bool"},
			{Name: "hasPrefix", Signature: "hasPrefix(string, prefix) -> bool", Description: "Check if string starts with prefix", ReturnType: "bool"},
			{Name: "hasSuffix", Signature: "hasSuffix(string, suffix) -> bool", Description: "Check if string ends with suffix", ReturnType: "bool"},
			{Name: "replace", Signature: "replace(string, old, new) -> string", Description: "Replace all occurrences", ReturnType: "string"},
			{Name: "split", Signature: "split(string, separator) -> []string", Description: "Split string by separator", ReturnType: "array"},
			{Name: "join", Signature: "join([]string, separator) -> string", Description: "Join array with separator", ReturnType: "string"},
			// Comparison
			{Name: "eq", Signature: "eq(a, b) -> bool", Description: "Equal comparison", ReturnType: "bool"},
			{Name: "ne", Signature: "ne(a, b) -> bool", Description: "Not equal comparison", ReturnType: "bool"},
			{Name: "lt", Signature: "lt(a, b) -> bool", Description: "Less than comparison", ReturnType: "bool"},
			{Name: "le", Signature: "le(a, b) -> bool", Description: "Less than or equal comparison", ReturnType: "bool"},
			{Name: "gt", Signature: "gt(a, b) -> bool", Description: "Greater than comparison", ReturnType: "bool"},
			{Name: "ge", Signature: "ge(a, b) -> bool", Description: "Greater than or equal comparison", ReturnType: "bool"},
			// Logic
			{Name: "and", Signature: "and(a, b) -> bool", Description: "Logical AND", ReturnType: "bool"},
			{Name: "or", Signature: "or(a, b) -> bool", Description: "Logical OR", ReturnType: "bool"},
			{Name: "not", Signature: "not(a) -> bool", Description: "Logical NOT", ReturnType: "bool"},
			// Collection
			{Name: "len", Signature: "len(value) -> int", Description: "Get length of string/array/map", ReturnType: "int"},
			{Name: "first", Signature: "first(array) -> value", Description: "Get first element", ReturnType: "any"},
			{Name: "last", Signature: "last(array) -> value", Description: "Get last element", ReturnType: "any"},
			{Name: "inList", Signature: "inList(item, list) -> bool", Description: "Check if item is in list", ReturnType: "bool"},
			{Name: "anyContains", Signature: "anyContains(list, substr) -> bool", Description: "Check if any list item contains substring", ReturnType: "bool"},
			// Regex
			{Name: "match", Signature: "match(pattern, string) -> bool", Description: "Check if string matches regex", ReturnType: "bool"},
			// Default
			{Name: "default", Signature: "default(defaultVal, val) -> value", Description: "Return default if value is empty", ReturnType: "any"},
			{Name: "ternary", Signature: "ternary(cond, trueVal, falseVal) -> value", Description: "Conditional value", ReturnType: "any"},
		},
		Operators: []core.OperatorDoc{
			{Symbol: "{{ }}", Name: "Action", Description: "Delimiters for template actions"},
			{Symbol: ".", Name: "Dot", Description: "Current context/data"},
			{Symbol: "|", Name: "Pipe", Description: "Pipeline - pass value to next function"},
			{Symbol: "if/else/end", Name: "Conditional", Description: "Conditional block"},
			{Symbol: "range/end", Name: "Loop", Description: "Iterate over collection"},
			{Symbol: "with/end", Name: "Scope", Description: "Set dot to value"},
		},
	}
}

// GetExamples returns example Go template expressions
func (e *Engine) GetExamples() []core.Example {
	return []core.Example{
		{
			Title:       "Simple condition",
			Description: "Check if subject contains keyword",
			Expression:  `{{ if contains .Subject "urgent" }}true{{ else }}false{{ end }}`,
			ExpectedFor: "Basic keyword matching",
		},
		{
			Title:       "Complex condition",
			Description: "Multiple conditions with AND",
			Expression:  `{{ if and (contains .Subject "Report") (gt (len .Attachments) 0) }}true{{ else }}false{{ end }}`,
			ExpectedFor: "Complex filtering logic",
		},
		{
			Title:       "Array check",
			Description: "Check if any sender matches domain",
			Expression:  `{{ if anyContains .From "@company.com" }}true{{ else }}false{{ end }}`,
			ExpectedFor: "Domain-based filtering",
		},
		{
			Title:       "String formatting",
			Description: "Format a response string",
			Expression:  `Email from {{ first .From | default "unknown" }}: {{ .Subject | upper }}`,
			ExpectedFor: "Generating action messages",
		},
		{
			Title:       "Iterate and format",
			Description: "List all recipients",
			Expression:  `Recipients: {{ range .To }}{{ . }}, {{ end }}`,
			ExpectedFor: "Formatting lists in actions",
		},
		{
			Title:       "Regex matching",
			Description: "Match pattern in subject",
			Expression:  `{{ if match "TICKET-[0-9]+" .Subject }}true{{ else }}false{{ end }}`,
			ExpectedFor: "Pattern-based filtering",
		},
	}
}
