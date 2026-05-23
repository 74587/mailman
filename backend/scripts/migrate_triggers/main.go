package main

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"mailman/internal/config"
	"mailman/internal/database"
	"mailman/internal/models"
	"mailman/internal/repository"
)

// This script migrates old trigger data to the new email trigger v2 format

func main() {
	log.Println("Starting trigger migration...")

	// Load configuration
	cfg := config.Load()

	// Initialize database
	dbConfig := database.Config{
		Driver:   cfg.Database.Driver,
		Host:     cfg.Database.Host,
		Port:     cfg.Database.Port,
		User:     cfg.Database.User,
		Password: cfg.Database.Password,
		DBName:   cfg.Database.DBName,
		SSLMode:  cfg.Database.SSLMode,
	}
	if err := database.Initialize(dbConfig); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	db := database.GetDB()

	// Create repositories
	// Note: We access DB directly for old triggers as the repo might have changed or we want raw access
	// But assuming repository.NewTriggerRepository exists and works for V1
	oldTriggerRepo := repository.NewTriggerRepository(db)
	newTriggerRepo := repository.NewEmailTriggerV2Repository(db)

	// Get all old triggers
	oldTriggers, err := oldTriggerRepo.GetAll(0)
	if err != nil {
		log.Fatalf("Failed to get old triggers: %v", err)
	}

	log.Printf("Found %d old triggers to migrate", len(oldTriggers))

	// Migrate each trigger
	for _, oldTrigger := range oldTriggers {
		log.Printf("Migrating trigger: %s (ID: %d)", oldTrigger.Name, oldTrigger.ID)

		// Check if already migrated (by name matching, optional)
		// var existing models.EmailTriggerV2
		// if err := db.Where("name = ?", oldTrigger.Name).First(&existing).Error; err == nil {
		// 	log.Printf("Trigger %s already exists in V2, skipping...", oldTrigger.Name)
		// 	continue
		// }

		// Convert old trigger to new format
		newTrigger, err := convertTrigger(&oldTrigger)
		if err != nil {
			log.Printf("Failed to convert trigger %d: %v", oldTrigger.ID, err)
			continue
		}

		// Create new trigger
		if err := newTriggerRepo.Create(newTrigger); err != nil {
			log.Printf("Failed to create new trigger %d: %v", oldTrigger.ID, err)
			continue
		}

		log.Printf("Successfully migrated trigger %d to new ID %d", oldTrigger.ID, newTrigger.ID)
	}

	log.Println("Trigger migration completed")
}

// convertTrigger converts an old trigger to the new format
func convertTrigger(oldTrigger *models.EmailTrigger) (*models.EmailTriggerV2, error) {
	// Create new trigger with basic properties
	newTrigger := &models.EmailTriggerV2{
		Name:        oldTrigger.Name,
		Description: oldTrigger.Description,
		Enabled:     oldTrigger.Status == models.TriggerStatusEnabled,
		CreatedAt:   oldTrigger.CreatedAt,
		UpdatedAt:   oldTrigger.UpdatedAt,
	}

	// Convert conditions to expressions
	expressions, err := convertConditions(oldTrigger)
	if err != nil {
		return nil, fmt.Errorf("failed to convert conditions: %w", err)
	}
	newTrigger.Expressions = expressions

	// Convert actions
	actions, err := convertActions(oldTrigger.Actions)
	if err != nil {
		return nil, fmt.Errorf("failed to convert actions: %w", err)
	}
	newTrigger.Actions = actions

	// Copy statistics
	newTrigger.TotalExecutions = oldTrigger.TotalExecutions
	newTrigger.SuccessExecutions = oldTrigger.SuccessExecutions
	newTrigger.LastExecutedAt = oldTrigger.LastExecutedAt
	newTrigger.LastError = oldTrigger.LastError

	return newTrigger, nil
}

// convertConditions converts old TriggerConditionConfig and fields to TriggerExpressions
func convertConditions(oldTrigger *models.EmailTrigger) ([]models.TriggerExpression, error) {
	var expressions []models.TriggerExpression

	// Handle specific field filters in EmailTrigger struct first
	if oldTrigger.Subject != "" {
		expressions = append(expressions, createComparisonExpression("subject", "contains", oldTrigger.Subject))
	}
	if oldTrigger.From != "" {
		expressions = append(expressions, createComparisonExpression("from", "contains", oldTrigger.From))
	}
	if oldTrigger.To != "" {
		expressions = append(expressions, createComparisonExpression("to", "contains", oldTrigger.To))
	}
	if oldTrigger.HasAttachment != nil {
		expressions = append(expressions, createComparisonExpression("has_attachments", "equals", *oldTrigger.HasAttachment))
	}

	// Handle the Condition field (JS or GoTemplate)
	// V2 mainly supports structural conditions. For JS/Template, we might need a special plugin or migration strategy.
	// For now, we note it if present.
	if oldTrigger.Condition.Script != "" {
		log.Printf("Warning: Trigger %d has script condition which cannot be fully migrated to structural format automatically.", oldTrigger.ID)
		// We could add a "script" plugin condition here if supported.
	}

	// Wrap in a Root AND Group
	if len(expressions) > 0 {
		op := models.TriggerOperatorAnd
		return []models.TriggerExpression{
			{
				ID:         "root",
				Type:       models.TriggerExpressionTypeGroup,
				Operator:   &op,
				Conditions: expressions,
			},
		}, nil
	}

	return []models.TriggerExpression{}, nil
}

func createComparisonExpression(field, operator string, value interface{}) models.TriggerExpression {
	return models.TriggerExpression{
		ID:       fmt.Sprintf("cond_%d", time.Now().UnixNano()),
		Type:     models.TriggerExpressionTypeCondition,
		Field:    &field,
		Operator: (*models.TriggerOperator)(&operator), // Cast string to TriggerOperator
		Value:    value,
	}
}

// convertActions converts old actions to new actions
func convertActions(actions models.TriggerActionsV1) ([]models.TriggerAction, error) {
	if len(actions) == 0 {
		return []models.TriggerAction{}, nil
	}

	newActions := make([]models.TriggerAction, 0, len(actions))
	for i, oldAction := range actions {
		// Map old action types to Plugin IDs
		pluginID := "unknown"
		config := make(map[string]interface{})

		// Try to parse Config string as JSON
		if oldAction.Config != "" {
			if err := json.Unmarshal([]byte(oldAction.Config), &config); err != nil {
				// If not JSON, put it as "raw_config"
				config["raw_config"] = oldAction.Config
			}
		}

		switch oldAction.Type {
		case models.TriggerActionTypeModifyContent:
			pluginID = "email_modify_plugin" // Assuming this exists or mapping to generic
		case models.TriggerActionTypeSMTP:
			pluginID = "email_forward_plugin"
		default:
			pluginID = string(oldAction.Type)
		}

		newAction := models.TriggerAction{
			ID:             fmt.Sprintf("action_%d_%d", time.Now().UnixNano(), i),
			PluginID:       pluginID,
			PluginName:     oldAction.Name,
			Config:         config,
			Enabled:        oldAction.Enabled,
			ExecutionOrder: i,
		}

		newActions = append(newActions, newAction)
	}

	return newActions, nil
}
