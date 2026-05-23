package expression

import (
	"fmt"

	"mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
)

// ExpressionConditionPlugin is a condition plugin that uses an expression engine
type ExpressionConditionPlugin struct {
	info       *plugins.PluginInfo
	config     map[string]interface{}
	engineType EngineType
	engine     Engine
}

// NewExpressionConditionPlugin creates a new expression-based condition plugin
func NewExpressionConditionPlugin(engineType EngineType, engine Engine) *ExpressionConditionPlugin {
	var name, description string

	switch engineType {
	case EngineTypeCEL:
		name = "CEL 表达式"
		description = "使用 CEL (Common Expression Language) 编写复杂的条件表达式"
	case EngineTypeGoTemplate:
		name = "Go 模板表达式"
		description = "使用 Go Template 语法编写条件表达式"
	case EngineTypeJavaScript:
		name = "JavaScript 表达式"
		description = "使用 JavaScript 编写灵活的条件表达式"
	case EngineTypeJSONPath:
		name = "JSONPath 表达式"
		description = "使用 JSONPath 查询和比较数据"
	default:
		name = string(engineType)
		description = "表达式条件"
	}

	return &ExpressionConditionPlugin{
		info: &plugins.PluginInfo{
			ID:          fmt.Sprintf("expr.%s", engineType),
			Name:        name,
			Description: description,
			Version:     "1.0.0",
			Author:      "Mailman",
			Type:        plugins.PluginTypeCondition,
			Status:      plugins.PluginStatusActive,
		},
		config:     make(map[string]interface{}),
		engineType: engineType,
		engine:     engine,
	}
}

// GetInfo returns plugin information
func (p *ExpressionConditionPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize initializes the plugin
func (p *ExpressionConditionPlugin) Initialize(ctx *plugins.PluginContext) error {
	return nil
}

// Cleanup cleans up the plugin
func (p *ExpressionConditionPlugin) Cleanup() error {
	return nil
}

// OnLoad is called when the plugin is loaded
func (p *ExpressionConditionPlugin) OnLoad() error {
	return nil
}

// OnUnload is called when the plugin is unloaded
func (p *ExpressionConditionPlugin) OnUnload() error {
	return nil
}

// OnActivate is called when the plugin is activated
func (p *ExpressionConditionPlugin) OnActivate() error {
	return nil
}

// OnDeactivate is called when the plugin is deactivated
func (p *ExpressionConditionPlugin) OnDeactivate() error {
	return nil
}

// GetDefaultConfig returns the default configuration
func (p *ExpressionConditionPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{
		"expression": "",
	}
}

// ValidateConfig validates the configuration
func (p *ExpressionConditionPlugin) ValidateConfig(config map[string]interface{}) error {
	expr, ok := config["expression"].(string)
	if !ok {
		return fmt.Errorf("expression must be a string")
	}
	if expr != "" {
		return p.engine.Validate(expr)
	}
	return nil
}

// ApplyConfig applies the configuration
func (p *ExpressionConditionPlugin) ApplyConfig(config map[string]interface{}) error {
	p.config = config
	return nil
}

// HealthCheck performs a health check
func (p *ExpressionConditionPlugin) HealthCheck() error {
	return nil
}

// GetMetrics returns plugin metrics
func (p *ExpressionConditionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"engine_type": string(p.engineType),
	}
}

// Evaluate evaluates the condition against the event
func (p *ExpressionConditionPlugin) Evaluate(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	// Get expression from config
	var expression string
	if ctx.Config != nil && ctx.Config.Config != nil {
		if expr, ok := ctx.Config.Config["expression"].(string); ok {
			expression = expr
		}
	}

	if expression == "" {
		return &plugins.PluginResult{
			Success: false,
			Data: map[string]interface{}{
				"error": "missing expression",
			},
		}, fmt.Errorf("missing expression in config")
	}

	// Get event data
	var eventData map[string]interface{}
	if err := event.GetData(&eventData); err != nil {
		return &plugins.PluginResult{
			Success: false,
			Data: map[string]interface{}{
				"error": fmt.Sprintf("failed to get event data: %v", err),
			},
		}, err
	}

	// Create evaluation context
	evalCtx := NewEvaluationContext(eventData)

	// Evaluate the expression
	result, err := p.engine.EvaluateBoolean(expression, evalCtx)
	if err != nil {
		return &plugins.PluginResult{
			Success: false,
			Data: map[string]interface{}{
				"error":      err.Error(),
				"expression": expression,
			},
		}, err
	}

	return &plugins.PluginResult{
		Success: result,
		Data: map[string]interface{}{
			"expression": expression,
			"result":     result,
			"engineType": string(p.engineType),
		},
	}, nil
}

// GetDescription returns the plugin description
func (p *ExpressionConditionPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes returns supported event types
func (p *ExpressionConditionPlugin) GetSupportedEventTypes() []string {
	return []string{"email.received", "email.updated", "*"}
}

// GetRequiredFields returns required fields
func (p *ExpressionConditionPlugin) GetRequiredFields() []string {
	return []string{"expression"}
}

// GetUISchema returns the UI schema for this plugin
func (p *ExpressionConditionPlugin) GetUISchema() *plugins.UISchema {
	syntaxHelp := p.engine.GetSyntaxHelp()
	examples := p.engine.GetExamples()

	// Convert examples to UI examples
	uiExamples := make([]plugins.UIExample, len(examples))
	for i, ex := range examples {
		uiExamples[i] = plugins.UIExample{
			Title:       ex.Title,
			Description: ex.Description,
			Expression: map[string]interface{}{
				"expression": ex.Expression,
			},
		}
	}

	placeholder := ""
	if len(examples) > 0 {
		placeholder = examples[0].Expression
	}

	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "expression",
				Label:       "表达式",
				Type:        plugins.UIFieldTypeCode,
				Description: syntaxHelp.ShortDescription,
				Placeholder: placeholder,
				Required:    true,
				Width:       "full",
			},
		},
		Layout:          "vertical",
		AllowNesting:    false,
		MaxNestingLevel: 1,
		HelpText:        syntaxHelp.ShortDescription,
		Examples:        uiExamples,
	}
}

// GetDynamicOptions returns dynamic options for a field
func (p *ExpressionConditionPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	// Expression plugins don't have dynamic options
	return nil, nil
}

// ValidateFieldValue validates a field value
func (p *ExpressionConditionPlugin) ValidateFieldValue(field string, value interface{}) error {
	if field == "expression" {
		if expr, ok := value.(string); ok {
			return p.engine.Validate(expr)
		}
		return fmt.Errorf("expression must be a string")
	}
	return nil
}

// GetFieldSuggestions returns suggestions for a field
func (p *ExpressionConditionPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	if field == "expression" {
		// Return example expressions as suggestions
		examples := p.engine.GetExamples()
		suggestions := make([]string, len(examples))
		for i, ex := range examples {
			suggestions[i] = ex.Expression
		}
		return suggestions, nil
	}
	return nil, nil
}

// ExpressionActionPlugin is an action plugin that uses an expression engine for templating
type ExpressionActionPlugin struct {
	info       *plugins.PluginInfo
	config     map[string]interface{}
	engineType EngineType
	engine     Engine
}

// NewExpressionActionPlugin creates a new expression-based action plugin
func NewExpressionActionPlugin(engineType EngineType, engine Engine) *ExpressionActionPlugin {
	var name, description string

	switch engineType {
	case EngineTypeCEL:
		name = "CEL 模板"
		description = "使用 CEL 表达式生成动态内容"
	case EngineTypeGoTemplate:
		name = "Go 模板"
		description = "使用 Go Template 生成动态内容"
	case EngineTypeJavaScript:
		name = "JavaScript 模板"
		description = "使用 JavaScript 生成动态内容"
	case EngineTypeJSONPath:
		name = "JSONPath 提取"
		description = "使用 JSONPath 提取和格式化数据"
	default:
		name = string(engineType)
		description = "表达式动作"
	}

	return &ExpressionActionPlugin{
		info: &plugins.PluginInfo{
			ID:          fmt.Sprintf("expr.action.%s", engineType),
			Name:        name,
			Description: description,
			Version:     "1.0.0",
			Author:      "Mailman",
			Type:        plugins.PluginTypeAction,
			Status:      plugins.PluginStatusActive,
		},
		config:     make(map[string]interface{}),
		engineType: engineType,
		engine:     engine,
	}
}

// GetInfo returns plugin information
func (p *ExpressionActionPlugin) GetInfo() *plugins.PluginInfo {
	return p.info
}

// Initialize initializes the plugin
func (p *ExpressionActionPlugin) Initialize(ctx *plugins.PluginContext) error {
	return nil
}

// Cleanup cleans up the plugin
func (p *ExpressionActionPlugin) Cleanup() error {
	return nil
}

// OnLoad is called when the plugin is loaded
func (p *ExpressionActionPlugin) OnLoad() error {
	return nil
}

// OnUnload is called when the plugin is unloaded
func (p *ExpressionActionPlugin) OnUnload() error {
	return nil
}

// OnActivate is called when the plugin is activated
func (p *ExpressionActionPlugin) OnActivate() error {
	return nil
}

// OnDeactivate is called when the plugin is deactivated
func (p *ExpressionActionPlugin) OnDeactivate() error {
	return nil
}

// GetDefaultConfig returns the default configuration
func (p *ExpressionActionPlugin) GetDefaultConfig() map[string]interface{} {
	return map[string]interface{}{
		"expression":  "",
		"outputField": "result",
	}
}

// ValidateConfig validates the configuration
func (p *ExpressionActionPlugin) ValidateConfig(config map[string]interface{}) error {
	expr, ok := config["expression"].(string)
	if !ok {
		return fmt.Errorf("expression must be a string")
	}
	if expr != "" {
		return p.engine.Validate(expr)
	}
	return nil
}

// ApplyConfig applies the configuration
func (p *ExpressionActionPlugin) ApplyConfig(config map[string]interface{}) error {
	p.config = config
	return nil
}

// HealthCheck performs a health check
func (p *ExpressionActionPlugin) HealthCheck() error {
	return nil
}

// GetMetrics returns plugin metrics
func (p *ExpressionActionPlugin) GetMetrics() map[string]interface{} {
	return map[string]interface{}{
		"engine_type": string(p.engineType),
	}
}

// Execute executes the action
func (p *ExpressionActionPlugin) Execute(ctx *plugins.PluginContext, event *models.Event) (*plugins.PluginResult, error) {
	// Get expression from config
	var expression string
	if ctx.Config != nil && ctx.Config.Config != nil {
		if expr, ok := ctx.Config.Config["expression"].(string); ok {
			expression = expr
		}
	}

	if expression == "" {
		return &plugins.PluginResult{
			Success: false,
			Data: map[string]interface{}{
				"error": "missing expression",
			},
		}, fmt.Errorf("missing expression in config")
	}

	// Get event data
	var eventData map[string]interface{}
	if err := event.GetData(&eventData); err != nil {
		return &plugins.PluginResult{
			Success: false,
			Data: map[string]interface{}{
				"error": fmt.Sprintf("failed to get event data: %v", err),
			},
		}, err
	}

	// Create evaluation context
	evalCtx := NewEvaluationContext(eventData)

	// Evaluate the expression
	result, err := p.engine.EvaluateString(expression, evalCtx)
	if err != nil {
		return &plugins.PluginResult{
			Success: false,
			Data: map[string]interface{}{
				"error":      err.Error(),
				"expression": expression,
			},
		}, err
	}

	return &plugins.PluginResult{
		Success: true,
		Data: map[string]interface{}{
			"expression": expression,
			"result":     result,
			"engineType": string(p.engineType),
		},
	}, nil
}

// GetDescription returns the plugin description
func (p *ExpressionActionPlugin) GetDescription() string {
	return p.info.Description
}

// GetSupportedEventTypes returns supported event types
func (p *ExpressionActionPlugin) GetSupportedEventTypes() []string {
	return []string{"email.received", "email.updated", "*"}
}

// GetRequiredConfig returns required config fields
func (p *ExpressionActionPlugin) GetRequiredConfig() []string {
	return []string{"expression"}
}

// CanExecute checks if the action can be executed
func (p *ExpressionActionPlugin) CanExecute(ctx *plugins.PluginContext, event *models.Event) bool {
	if ctx.Config == nil || ctx.Config.Config == nil {
		return false
	}
	expr, ok := ctx.Config.Config["expression"].(string)
	return ok && expr != ""
}

// GetExecutionOrder returns the execution order
func (p *ExpressionActionPlugin) GetExecutionOrder() int {
	return 100 // Default order
}

// GetUISchema returns the UI schema for this plugin
func (p *ExpressionActionPlugin) GetUISchema() *plugins.UISchema {
	syntaxHelp := p.engine.GetSyntaxHelp()
	examples := p.engine.GetExamples()

	// Convert examples to UI examples
	uiExamples := make([]plugins.UIExample, len(examples))
	for i, ex := range examples {
		uiExamples[i] = plugins.UIExample{
			Title:       ex.Title,
			Description: ex.Description,
			Expression: map[string]interface{}{
				"expression": ex.Expression,
			},
		}
	}

	placeholder := ""
	if len(examples) > 0 {
		placeholder = examples[0].Expression
	}

	return &plugins.UISchema{
		Fields: []plugins.UIField{
			{
				Name:        "expression",
				Label:       "模板表达式",
				Type:        plugins.UIFieldTypeCode,
				Description: syntaxHelp.ShortDescription,
				Placeholder: placeholder,
				Required:    true,
				Width:       "full",
			},
			{
				Name:        "outputField",
				Label:       "输出字段名",
				Type:        plugins.UIFieldTypeText,
				Description: "将表达式结果存储到此字段",
				Placeholder: "result",
				Required:    false,
				Width:       "half",
			},
		},
		Layout:          "vertical",
		AllowNesting:    false,
		MaxNestingLevel: 1,
		HelpText:        "使用表达式生成动态内容",
		Examples:        uiExamples,
	}
}

// GetDynamicOptions returns dynamic options for a field
func (p *ExpressionActionPlugin) GetDynamicOptions(field string, query string) ([]plugins.UIOption, error) {
	return nil, nil
}

// ValidateFieldValue validates a field value
func (p *ExpressionActionPlugin) ValidateFieldValue(field string, value interface{}) error {
	if field == "expression" {
		if expr, ok := value.(string); ok {
			return p.engine.Validate(expr)
		}
		return fmt.Errorf("expression must be a string")
	}
	return nil
}

// GetFieldSuggestions returns suggestions for a field
func (p *ExpressionActionPlugin) GetFieldSuggestions(field string, prefix string) ([]string, error) {
	if field == "expression" {
		examples := p.engine.GetExamples()
		suggestions := make([]string, len(examples))
		for i, ex := range examples {
			suggestions[i] = ex.Expression
		}
		return suggestions, nil
	}
	return nil, nil
}
