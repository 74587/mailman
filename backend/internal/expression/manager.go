package expression

import (
	"fmt"
	"log"
	"sync"
)

// Manager manages all expression engines
type Manager struct {
	engines map[EngineType]Engine
	mu      sync.RWMutex
}

// NewManager creates a new expression manager
func NewManager() *Manager {
	return &Manager{
		engines: make(map[EngineType]Engine),
	}
}

// Register registers an expression engine
func (m *Manager) Register(engine Engine) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	engineType := engine.GetType()
	if _, exists := m.engines[engineType]; exists {
		return fmt.Errorf("engine %s is already registered", engineType)
	}

	m.engines[engineType] = engine
	return nil
}

// Get returns an engine by type
func (m *Manager) Get(engineType EngineType) (Engine, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	engine, exists := m.engines[engineType]
	if !exists {
		return nil, fmt.Errorf("engine %s not found", engineType)
	}

	return engine, nil
}

// GetAll returns all registered engines
func (m *Manager) GetAll() map[EngineType]Engine {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make(map[EngineType]Engine)
	for k, v := range m.engines {
		result[k] = v
	}
	return result
}

// List returns information about all registered engines
func (m *Manager) List() []EngineInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []EngineInfo
	for _, engine := range m.engines {
		result = append(result, EngineInfo{
			Type:        engine.GetType(),
			Name:        engine.GetName(),
			Description: engine.GetDescription(),
			SyntaxHelp:  engine.GetSyntaxHelp(),
			Examples:    engine.GetExamples(),
		})
	}
	return result
}

// EngineInfo provides information about an engine
type EngineInfo struct {
	Type        EngineType  `json:"type"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	SyntaxHelp  *SyntaxHelp `json:"syntaxHelp"`
	Examples    []Example   `json:"examples"`
}

// Evaluate evaluates an expression using the specified engine
func (m *Manager) Evaluate(engineType EngineType, expression string, ctx *EvaluationContext, opts *EvaluationOptions) (*EvaluationResult, error) {
	engine, err := m.Get(engineType)
	if err != nil {
		return nil, err
	}

	if opts == nil {
		opts = DefaultEvaluationOptions()
	}

	return engine.Evaluate(expression, ctx, opts)
}

// EvaluateBoolean evaluates an expression as boolean
func (m *Manager) EvaluateBoolean(engineType EngineType, expression string, ctx *EvaluationContext) (bool, error) {
	log.Printf("[ExpressionManager] EvaluateBoolean: engine=%s, expr=%s", engineType, expression)

	engine, err := m.Get(engineType)
	if err != nil {
		log.Printf("[ExpressionManager] EvaluateBoolean error: engine not found: %v", err)
		return false, err
	}

	result, err := engine.EvaluateBoolean(expression, ctx)
	log.Printf("[ExpressionManager] EvaluateBoolean result: %v, err=%v", result, err)
	return result, err
}

// EvaluateString evaluates an expression as string
func (m *Manager) EvaluateString(engineType EngineType, expression string, ctx *EvaluationContext) (string, error) {
	engine, err := m.Get(engineType)
	if err != nil {
		return "", err
	}

	return engine.EvaluateString(expression, ctx)
}

// Validate validates an expression
func (m *Manager) Validate(engineType EngineType, expression string) error {
	engine, err := m.Get(engineType)
	if err != nil {
		return err
	}

	return engine.Validate(expression)
}

// Global default manager
var defaultManager *Manager
var defaultManagerOnce sync.Once

// DefaultManager returns the default expression manager
func DefaultManager() *Manager {
	defaultManagerOnce.Do(func() {
		defaultManager = NewManager()
	})
	return defaultManager
}

// InitDefaultEngines initializes all default engines in the manager
func InitDefaultEngines(m *Manager) error {
	// Import and register all engines here
	// This will be called from the main package
	return nil
}

// RegisterEngine is a convenience method for registering engines by type
func (m *Manager) RegisterEngine(engine Engine) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.engines[engine.GetType()] = engine
}
