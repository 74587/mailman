package services

import (
	"fmt"
	"log"
	"path/filepath"
	"sync"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/triggerv2/plugins"
	"mailman/internal/triggerv2/plugins/builtin"
)

// EmailTriggerIntegration handles the integration of the email trigger system
// with existing components like the email subscription system, expression engine,
// and plugin architecture.
type EmailTriggerIntegration struct {
	triggerService      *EmailTriggerService
	subscriptionManager *SubscriptionManager
	eventBus            *EventBus
	conditionEngine     *ConditionEngine
	pluginManager       plugins.PluginManager
	dynamicPluginLoader *DynamicPluginLoader
	conditionLoader     *DynamicConditionLoader
	templateManager     *TriggerTemplateManager
	resultCache         *ResultCache

	// Configuration
	pluginDirs    []string
	conditionDirs []string
	templateDirs  []string

	// State
	initialized bool
	mu          sync.RWMutex
}

// NewEmailTriggerIntegration creates a new EmailTriggerIntegration
func NewEmailTriggerIntegration(
	triggerRepo *repository.EmailTriggerV2Repository,
	logRepo *repository.TriggerExecutionLogV2Repository,
	subscriptionManager *SubscriptionManager,
	eventBus *EventBus,
	basePath string,
) *EmailTriggerIntegration {
	// Set up directory paths
	pluginDirs := []string{
		filepath.Join(basePath, "plugins"),
		filepath.Join(basePath, "plugins", "actions"),
	}

	conditionDirs := []string{
		filepath.Join(basePath, "conditions"),
		filepath.Join(basePath, "conditions", "operators"),
		filepath.Join(basePath, "conditions", "functions"),
	}

	templateDirs := []string{
		filepath.Join(basePath, "templates"),
		filepath.Join(basePath, "templates", "triggers"),
	}

	// Create TriggerV2 plugin manager and register builtin plugins
	pluginManager := plugins.NewTriggerV2PluginManager(plugins.DefaultPluginManagerConfig())
	if err := builtin.RegisterBuiltinPlugins(pluginManager); err != nil {
		log.Printf("[EmailTriggerIntegration] Error registering builtin plugins: %v", err)
	}

	// Create condition engine
	conditionEngine := NewConditionEngine(pluginManager)

	// Create result cache with 5 minute expiration
	resultCache := NewResultCache(5*time.Minute, 10*time.Minute)

	// Create legacy services.PluginManager for dynamic loading and trigger service
	legacyPluginManager := NewPluginManager()
	dynamicPluginLoader := NewDynamicPluginLoader(legacyPluginManager, pluginDirs)
	conditionLoader := NewDynamicConditionLoader(conditionEngine, conditionDirs)

	// Create template manager
	templateManager := NewTriggerTemplateManager(templateDirs)

	// Create trigger service
	triggerService := NewEmailTriggerService(
		triggerRepo,
		logRepo,
		subscriptionManager,
		eventBus,
		conditionEngine,
		legacyPluginManager,
	)

	return &EmailTriggerIntegration{
		triggerService:      triggerService,
		subscriptionManager: subscriptionManager,
		eventBus:            eventBus,
		conditionEngine:     conditionEngine,
		pluginManager:       pluginManager,
		dynamicPluginLoader: dynamicPluginLoader,
		conditionLoader:     conditionLoader,
		templateManager:     templateManager,
		resultCache:         resultCache,
		pluginDirs:          pluginDirs,
		conditionDirs:       conditionDirs,
		templateDirs:        templateDirs,
		initialized:         false,
	}
}

// Initialize initializes the email trigger integration
func (i *EmailTriggerIntegration) Initialize() error {
	i.mu.Lock()
	defer i.mu.Unlock()

	if i.initialized {
		return fmt.Errorf("email trigger integration already initialized")
	}

	log.Println("[EmailTriggerIntegration] Initializing email trigger integration")

	// Load dynamic conditions
	if err := i.conditionLoader.LoadConditions(); err != nil {
		log.Printf("[EmailTriggerIntegration] Warning: Failed to load dynamic conditions: %v", err)
		// Continue anyway, as this is not critical
	}

	// Load dynamic plugins
	if err := i.dynamicPluginLoader.LoadPlugins(); err != nil {
		log.Printf("[EmailTriggerIntegration] Warning: Failed to load dynamic plugins: %v", err)
		// Continue anyway, as this is not critical
	}

	// Start plugin watcher
	i.dynamicPluginLoader.StartWatcher()

	// Load trigger templates
	if err := i.templateManager.LoadTemplates(); err != nil {
		log.Printf("[EmailTriggerIntegration] Warning: Failed to load trigger templates: %v", err)
		// Continue anyway, as this is not critical
	}

	// Initialize trigger service
	if err := i.triggerService.Initialize(); err != nil {
		return fmt.Errorf("failed to initialize trigger service: %w", err)
	}

	i.initialized = true
	log.Println("[EmailTriggerIntegration] Email trigger integration initialized successfully")

	return nil
}

// RegisterBuiltinPlugins registers built-in plugins with the plugin manager
func (i *EmailTriggerIntegration) RegisterBuiltinPlugins() {
	// Register built-in plugins
	// These are plugins that are compiled into the application rather than loaded dynamically

	// Example:
	// i.pluginManager.RegisterPlugin("forward_email", NewForwardEmailPlugin())
	// i.pluginManager.RegisterPlugin("add_label", NewAddLabelPlugin())
	// i.pluginManager.RegisterPlugin("mark_as_read", NewMarkAsReadPlugin())

	log.Println("[EmailTriggerIntegration] Registered built-in plugins")
}

// RegisterBuiltinConditions registers built-in conditions with the condition engine
func (i *EmailTriggerIntegration) RegisterBuiltinConditions() {
	// The condition engine already registers basic operators and functions in its constructor
	// This method can be used to register additional custom conditions

	log.Println("[EmailTriggerIntegration] Registered built-in conditions")
}

// GetTriggerService returns the email trigger service
func (i *EmailTriggerIntegration) GetTriggerService() *EmailTriggerService {
	return i.triggerService
}

// GetPluginManager returns the plugin manager
func (i *EmailTriggerIntegration) GetPluginManager() plugins.PluginManager {
	return i.pluginManager
}

// GetConditionEngine returns the condition engine
func (i *EmailTriggerIntegration) GetConditionEngine() *ConditionEngine {
	return i.conditionEngine
}

// GetTemplateManager returns the template manager
func (i *EmailTriggerIntegration) GetTemplateManager() *TriggerTemplateManager {
	return i.templateManager
}

// GetAvailablePlugins returns a list of all available plugins
func (i *EmailTriggerIntegration) GetAvailablePlugins() []models.PluginInfo {
	i.mu.RLock()
	defer i.mu.RUnlock()

	// Get all plugins from TriggerV2 PluginManager
	pluginInfos, err := i.pluginManager.ListPlugins()
	if err != nil {
		log.Printf("[EmailTriggerIntegration] Error listing plugins: %v", err)
		return []models.PluginInfo{}
	}

	// Convert to models.PluginInfo
	result := make([]models.PluginInfo, 0, len(pluginInfos))
	for _, info := range pluginInfos {
		result = append(result, models.PluginInfo{
			ID:          info.ID,
			Name:        info.Name,
			Description: info.Description,
			Schema:      info.ConfigSchema,
		})
	}

	return result
}

// GetAvailableConditions returns a list of all available conditions
func (i *EmailTriggerIntegration) GetAvailableConditions() []models.ConditionInfo {
	i.mu.RLock()
	defer i.mu.RUnlock()

	// Get all conditions
	conditions := i.conditionLoader.GetAllConditions()

	// Create condition info list
	conditionInfos := make([]models.ConditionInfo, 0, len(conditions))

	// Add conditions
	for _, condition := range conditions {
		conditionInfos = append(conditionInfos, models.ConditionInfo{
			ID:          condition.ID,
			Name:        condition.Name,
			Description: condition.Description,
			Category:    condition.Category,
			Type:        condition.Type,
			Schema:      condition.Schema,
		})
	}

	return conditionInfos
}

// Shutdown gracefully shuts down the email trigger integration
func (i *EmailTriggerIntegration) Shutdown() {
	i.mu.Lock()
	defer i.mu.Unlock()

	if !i.initialized {
		return
	}

	log.Println("[EmailTriggerIntegration] Shutting down email trigger integration")

	// Stop plugin watcher
	i.dynamicPluginLoader.StopWatcher()

	// Shutdown trigger service
	i.triggerService.Shutdown()

	i.initialized = false
	log.Println("[EmailTriggerIntegration] Email trigger integration shutdown complete")
}
