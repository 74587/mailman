package expression

import (
	"mailman/internal/expression/core"
)

// Re-export types from core package for backward compatibility
type (
	EngineType        = core.EngineType
	EvaluationMode    = core.EvaluationMode
	EvaluationOptions = core.EvaluationOptions
	EvaluationResult  = core.EvaluationResult
	EvaluationContext = core.EvaluationContext
	Engine            = core.Engine
	SyntaxHelp        = core.SyntaxHelp
	FunctionDoc       = core.FunctionDoc
	OperatorDoc       = core.OperatorDoc
	Example           = core.Example
	TypeInfo          = core.TypeInfo
	BaseEngine        = core.BaseEngine

	ErrExpressionTimeout = core.ErrExpressionTimeout
	ErrExpressionSyntax  = core.ErrExpressionSyntax
	ErrExpressionRuntime = core.ErrExpressionRuntime
)

// Re-export constants
const (
	EngineTypeCEL        = core.EngineTypeCEL
	EngineTypeGoTemplate = core.EngineTypeGoTemplate
	EngineTypeJavaScript = core.EngineTypeJavaScript
	EngineTypeJSONPath   = core.EngineTypeJSONPath

	EvalModeBoolean = core.EvalModeBoolean
	EvalModeString  = core.EvalModeString
	EvalModeAny     = core.EvalModeAny
)

// Re-export functions
var (
	DefaultEvaluationOptions = core.DefaultEvaluationOptions
	NewEvaluationContext     = core.NewEvaluationContext
	NewBaseEngine            = core.NewBaseEngine
	InferTypeInfo            = core.InferTypeInfo
	ToBool                   = core.ToBool
	ToString                 = core.ToString
)
