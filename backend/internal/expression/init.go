package expression

import (
	"fmt"
	"log"

	"mailman/internal/expression/cel"
	"mailman/internal/expression/gotemplate"
	"mailman/internal/expression/javascript"
	"mailman/internal/expression/jsonpath"
	"mailman/internal/triggerv2/plugins"
)

// InitAllEngines initializes all expression engines and registers them with the manager
func InitAllEngines(m *Manager) error {
	// Initialize CEL engine
	celEngine, err := cel.NewEngine()
	if err != nil {
		log.Printf("[ExpressionManager] Warning: Failed to initialize CEL engine: %v", err)
	} else {
		m.RegisterEngine(celEngine)
		log.Printf("[ExpressionManager] CEL engine registered")
	}

	// Initialize Go Template engine
	goTemplateEngine, err := gotemplate.NewEngine()
	if err != nil {
		log.Printf("[ExpressionManager] Warning: Failed to initialize Go Template engine: %v", err)
	} else {
		m.RegisterEngine(goTemplateEngine)
		log.Printf("[ExpressionManager] Go Template engine registered")
	}

	// Initialize JavaScript engine
	jsEngine, err := javascript.NewEngine()
	if err != nil {
		log.Printf("[ExpressionManager] Warning: Failed to initialize JavaScript engine: %v", err)
	} else {
		m.RegisterEngine(jsEngine)
		log.Printf("[ExpressionManager] JavaScript engine registered")
	}

	// Initialize JSONPath engine
	jsonpathEngine, err := jsonpath.NewEngine()
	if err != nil {
		log.Printf("[ExpressionManager] Warning: Failed to initialize JSONPath engine: %v", err)
	} else {
		m.RegisterEngine(jsonpathEngine)
		log.Printf("[ExpressionManager] JSONPath engine registered")
	}

	return nil
}

// RegisterExpressionPlugins registers all expression-based plugins with the plugin manager
func RegisterExpressionPlugins(exprManager *Manager, pluginManager plugins.PluginManager) error {
	engines := exprManager.GetAll()

	for engineType, engine := range engines {
		// Register condition plugin
		condPlugin := NewExpressionConditionPlugin(engineType, engine)
		if err := pluginManager.RegisterPlugin(condPlugin); err != nil {
			return fmt.Errorf("failed to register condition plugin for %s: %w", engineType, err)
		}
		log.Printf("[ExpressionManager] Registered condition plugin: %s", condPlugin.GetInfo().ID)

		// Register action plugin
		actionPlugin := NewExpressionActionPlugin(engineType, engine)
		if err := pluginManager.RegisterPlugin(actionPlugin); err != nil {
			return fmt.Errorf("failed to register action plugin for %s: %w", engineType, err)
		}
		log.Printf("[ExpressionManager] Registered action plugin: %s", actionPlugin.GetInfo().ID)
	}

	return nil
}

// CreateAndInitManager creates a new expression manager with all engines initialized
func CreateAndInitManager() (*Manager, error) {
	m := NewManager()
	if err := InitAllEngines(m); err != nil {
		return nil, err
	}
	return m, nil
}
