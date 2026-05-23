package core

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// EngineType represents the type of expression engine
type EngineType string

const (
	EngineTypeCEL        EngineType = "cel"
	EngineTypeGoTemplate EngineType = "go_template"
	EngineTypeJavaScript EngineType = "javascript"
	EngineTypeJSONPath   EngineType = "jsonpath"
)

// EvaluationMode defines how the expression result should be interpreted
type EvaluationMode string

const (
	// EvalModeBoolean expects the result to be a boolean (for conditions)
	EvalModeBoolean EvaluationMode = "boolean"
	// EvalModeString expects the result to be a string (for actions/templates)
	EvalModeString EvaluationMode = "string"
	// EvalModeAny allows any return type
	EvalModeAny EvaluationMode = "any"
)

// EvaluationOptions configures how expression evaluation should behave
type EvaluationOptions struct {
	// Timeout for expression evaluation
	Timeout time.Duration
	// MaxOutputSize limits the size of string output
	MaxOutputSize int
	// Mode determines how the result should be interpreted
	Mode EvaluationMode
	// StrictMode enables strict type checking
	StrictMode bool
}

// DefaultEvaluationOptions returns sensible defaults
func DefaultEvaluationOptions() *EvaluationOptions {
	return &EvaluationOptions{
		Timeout:       5 * time.Second,
		MaxOutputSize: 1024 * 1024, // 1MB
		Mode:          EvalModeAny,
		StrictMode:    false,
	}
}

// EvaluationResult contains the result of expression evaluation
type EvaluationResult struct {
	// Value is the raw result value
	Value interface{}
	// StringValue is the string representation
	StringValue string
	// BoolValue is the boolean interpretation
	BoolValue bool
	// Type is the Go type of the result
	Type string
	// Duration is how long evaluation took
	Duration time.Duration
	// Error if evaluation failed
	Error error
}

// EvaluationContext provides the data context for expression evaluation
type EvaluationContext struct {
	// Context for cancellation
	Context context.Context
	// Data is the main data object (e.g., email data)
	Data map[string]interface{}
	// Variables are additional named variables
	Variables map[string]interface{}
	// Functions are custom functions available in expressions
	Functions map[string]interface{}
}

// NewEvaluationContext creates a new evaluation context
func NewEvaluationContext(data map[string]interface{}) *EvaluationContext {
	return &EvaluationContext{
		Context:   context.Background(),
		Data:      data,
		Variables: make(map[string]interface{}),
		Functions: make(map[string]interface{}),
	}
}

// WithContext adds a context
func (ec *EvaluationContext) WithContext(ctx context.Context) *EvaluationContext {
	ec.Context = ctx
	return ec
}

// WithVariable adds a variable
func (ec *EvaluationContext) WithVariable(name string, value interface{}) *EvaluationContext {
	ec.Variables[name] = value
	return ec
}

// WithFunction adds a custom function
func (ec *EvaluationContext) WithFunction(name string, fn interface{}) *EvaluationContext {
	ec.Functions[name] = fn
	return ec
}

// Engine is the common interface for all expression engines
type Engine interface {
	// GetType returns the engine type
	GetType() EngineType

	// GetName returns a human-readable name
	GetName() string

	// GetDescription returns a description of the engine
	GetDescription() string

	// Evaluate evaluates an expression and returns the result
	Evaluate(expression string, ctx *EvaluationContext, opts *EvaluationOptions) (*EvaluationResult, error)

	// EvaluateBoolean evaluates and returns a boolean result (convenience method)
	EvaluateBoolean(expression string, ctx *EvaluationContext) (bool, error)

	// EvaluateString evaluates and returns a string result (convenience method)
	EvaluateString(expression string, ctx *EvaluationContext) (string, error)

	// Validate validates expression syntax without executing
	Validate(expression string) error

	// GetSyntaxHelp returns syntax documentation
	GetSyntaxHelp() *SyntaxHelp

	// GetExamples returns example expressions
	GetExamples() []Example
}

// SyntaxHelp provides documentation for expression syntax
type SyntaxHelp struct {
	// Language identifier for syntax highlighting
	Language string `json:"language"`
	// ShortDescription is a brief overview
	ShortDescription string `json:"shortDescription"`
	// FullDocumentation is detailed documentation (markdown)
	FullDocumentation string `json:"fullDocumentation"`
	// BuiltinFunctions lists available functions
	BuiltinFunctions []FunctionDoc `json:"builtinFunctions"`
	// Operators lists available operators
	Operators []OperatorDoc `json:"operators"`
}

// FunctionDoc documents a function
type FunctionDoc struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Signature   string   `json:"signature"`
	Examples    []string `json:"examples"`
	ReturnType  string   `json:"returnType"`
}

// OperatorDoc documents an operator
type OperatorDoc struct {
	Symbol      string `json:"symbol"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Example     string `json:"example"`
}

// Example provides an example expression
type Example struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Expression  string `json:"expression"`
	ExpectedFor string `json:"expectedFor"` // What scenario this is good for
}

// TypeInfo provides type information for autocomplete
type TypeInfo struct {
	Name       string              `json:"name"`
	Type       string              `json:"type"` // "object", "array", "string", "number", "boolean"
	Properties map[string]TypeInfo `json:"properties,omitempty"`
	ArrayType  *TypeInfo           `json:"arrayType,omitempty"`
}

// InferTypeInfo infers type information from a value
func InferTypeInfo(name string, value interface{}) TypeInfo {
	info := TypeInfo{Name: name}

	switch v := value.(type) {
	case nil:
		info.Type = "null"
	case bool:
		info.Type = "boolean"
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		info.Type = "number"
	case string:
		info.Type = "string"
	case []interface{}:
		info.Type = "array"
		if len(v) > 0 {
			elemInfo := InferTypeInfo("element", v[0])
			info.ArrayType = &elemInfo
		}
	case []string:
		info.Type = "array"
		elemInfo := TypeInfo{Name: "element", Type: "string"}
		info.ArrayType = &elemInfo
	case map[string]interface{}:
		info.Type = "object"
		info.Properties = make(map[string]TypeInfo)
		for k, val := range v {
			info.Properties[k] = InferTypeInfo(k, val)
		}
	default:
		info.Type = "object"
	}

	return info
}

// BaseEngine provides common functionality for all engines
type BaseEngine struct {
	EngineType  EngineType
	Name        string
	Description string
	Mu          sync.RWMutex
}

// NewBaseEngine creates a new base engine
func NewBaseEngine(engineType EngineType, name, description string) *BaseEngine {
	return &BaseEngine{
		EngineType:  engineType,
		Name:        name,
		Description: description,
	}
}

// GetType returns the engine type
func (e *BaseEngine) GetType() EngineType {
	return e.EngineType
}

// GetName returns the name
func (e *BaseEngine) GetName() string {
	return e.Name
}

// GetDescription returns the description
func (e *BaseEngine) GetDescription() string {
	return e.Description
}

// ToBool converts a value to boolean
func ToBool(value interface{}) bool {
	if value == nil {
		return false
	}

	switch v := value.(type) {
	case bool:
		return v
	case string:
		return v != "" && v != "false" && v != "0"
	case int, int8, int16, int32, int64:
		return v != 0
	case uint, uint8, uint16, uint32, uint64:
		return v != 0
	case float32:
		return v != 0
	case float64:
		return v != 0
	default:
		return true
	}
}

// ToString converts a value to string
func ToString(value interface{}) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%v", value)
}

// ErrExpressionTimeout is returned when expression evaluation times out
type ErrExpressionTimeout struct {
	Timeout time.Duration
}

func (e *ErrExpressionTimeout) Error() string {
	return fmt.Sprintf("expression evaluation timed out after %v", e.Timeout)
}

// ErrExpressionSyntax is returned for syntax errors
type ErrExpressionSyntax struct {
	Message string
	Line    int
	Column  int
}

func (e *ErrExpressionSyntax) Error() string {
	if e.Line > 0 {
		return fmt.Sprintf("syntax error at line %d, column %d: %s", e.Line, e.Column, e.Message)
	}
	return fmt.Sprintf("syntax error: %s", e.Message)
}

// ErrExpressionRuntime is returned for runtime errors
type ErrExpressionRuntime struct {
	Message string
	Cause   error
}

func (e *ErrExpressionRuntime) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("runtime error: %s: %v", e.Message, e.Cause)
	}
	return fmt.Sprintf("runtime error: %s", e.Message)
}

func (e *ErrExpressionRuntime) Unwrap() error {
	return e.Cause
}
