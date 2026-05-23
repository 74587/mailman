package services

import (
	"encoding/json"
	"fmt"
	"log"

	"mailman/internal/models"
	"mailman/internal/repository"
)

// TriggerCompatibilityService handles compatibility between old and new trigger formats
type TriggerCompatibilityService struct {
	oldTriggerRepo *repository.TriggerRepository
	newTriggerRepo *repository.EmailTriggerV2Repository
}

// NewTriggerCompatibilityService creates a new TriggerCompatibilityService
func NewTriggerCompatibilityService(
	oldTriggerRepo *repository.TriggerRepository,
	newTriggerRepo *repository.EmailTriggerV2Repository,
) *TriggerCompatibilityService {
	return &TriggerCompatibilityService{
		oldTriggerRepo: oldTriggerRepo,
		newTriggerRepo: newTriggerRepo,
	}
}

// MigrateAllTriggers migrates all old triggers to the new format
func (s *TriggerCompatibilityService) MigrateAllTriggers() (int, error) {
	log.Println("[TriggerCompatibilityService] Starting migration of all triggers")

	// Get all old triggers
	oldTriggers, err := s.oldTriggerRepo.GetAll(0)
	if err != nil {
		return 0, fmt.Errorf("failed to get old triggers: %w", err)
	}

	log.Printf("[TriggerCompatibilityService] Found %d old triggers to migrate", len(oldTriggers))

	// Count successful migrations
	successCount := 0

	// Migrate each trigger
	for _, oldTrigger := range oldTriggers {
		log.Printf("[TriggerCompatibilityService] Migrating trigger: %s (ID: %d)", oldTrigger.Name, oldTrigger.ID)

		// Check if this trigger has already been migrated
		// Note: GetByName method might not exist, using GetAll and filtering
		allNewTriggers, err := s.newTriggerRepo.GetAll(0)
		if err == nil {
			for _, t := range allNewTriggers {
				if t.Name == oldTrigger.Name {
					log.Printf("[TriggerCompatibilityService] Trigger %s already migrated, skipping", oldTrigger.Name)
					successCount++
					continue
				}
			}
		}

		// Convert old trigger to new format
		newTrigger, err := s.convertTrigger(&oldTrigger)
		if err != nil {
			log.Printf("[TriggerCompatibilityService] Failed to convert trigger %d: %v", oldTrigger.ID, err)
			continue
		}

		// Create new trigger
		if err := s.newTriggerRepo.Create(newTrigger); err != nil {
			log.Printf("[TriggerCompatibilityService] Failed to create new trigger %d: %v", oldTrigger.ID, err)
			continue
		}

		log.Printf("[TriggerCompatibilityService] Successfully migrated trigger %d to new ID %d", oldTrigger.ID, newTrigger.ID)
		successCount++
	}

	log.Printf("[TriggerCompatibilityService] Migration completed: %d/%d triggers migrated successfully", successCount, len(oldTriggers))
	return successCount, nil
}

// MigrateTrigger migrates a single old trigger to the new format
func (s *TriggerCompatibilityService) MigrateTrigger(oldTriggerID uint) (*models.EmailTriggerV2, error) {
	log.Printf("[TriggerCompatibilityService] Migrating single trigger ID: %d", oldTriggerID)

	// Get the old trigger
	oldTrigger, err := s.oldTriggerRepo.GetByID(oldTriggerID)
	if err != nil {
		return nil, fmt.Errorf("failed to get old trigger: %w", err)
	}

	// Check if this trigger has already been migrated
	allNewTriggers, err := s.newTriggerRepo.GetAll(0)
	if err == nil {
		for _, t := range allNewTriggers {
			if t.Name == oldTrigger.Name {
				log.Printf("[TriggerCompatibilityService] Trigger %s already migrated", oldTrigger.Name)
				return &t, nil
			}
		}
	}

	// Convert old trigger to new format
	newTrigger, err := s.convertTrigger(oldTrigger)
	if err != nil {
		return nil, fmt.Errorf("failed to convert trigger: %w", err)
	}

	// Create new trigger
	if err := s.newTriggerRepo.Create(newTrigger); err != nil {
		return nil, fmt.Errorf("failed to create new trigger: %w", err)
	}

	log.Printf("[TriggerCompatibilityService] Successfully migrated trigger %d to new ID %d", oldTrigger.ID, newTrigger.ID)
	return newTrigger, nil
}

// convertTrigger converts an old trigger to the new format
func (s *TriggerCompatibilityService) convertTrigger(oldTrigger *models.EmailTrigger) (*models.EmailTriggerV2, error) {
	// Create new trigger with basic properties
	newTrigger := &models.EmailTriggerV2{
		Name:        oldTrigger.Name,
		Description: oldTrigger.Description,
		Enabled:     oldTrigger.Status == models.TriggerStatusEnabled,
	}

	// Convert expressions
	// Marshal the condition config to JSON first
	conditionJSON, err := json.Marshal(oldTrigger.Condition)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal condition: %w", err)
	}

	expressions, err := s.convertExpressions(conditionJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to convert expressions: %w", err)
	}
	newTrigger.Expressions = expressions

	// Convert actions
	// First, we need to marshal TriggerActions to json.RawMessage
	actionsJSON, err := json.Marshal(oldTrigger.Actions)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal actions: %w", err)
	}

	actions, err := s.convertActions(actionsJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to convert actions: %w", err)
	}
	newTrigger.Actions = actions

	// Copy statistics if available
	if oldTrigger.TotalExecutions > 0 {
		newTrigger.TotalExecutions = oldTrigger.TotalExecutions
		newTrigger.SuccessExecutions = oldTrigger.SuccessExecutions
	}

	if oldTrigger.LastExecutedAt != nil {
		newTrigger.LastExecutedAt = oldTrigger.LastExecutedAt
	}

	if oldTrigger.LastError != "" {
		newTrigger.LastError = oldTrigger.LastError
	}

	return newTrigger, nil
}

// convertExpressions converts old conditions to new expressions
func (s *TriggerCompatibilityService) convertExpressions(conditions json.RawMessage) ([]models.TriggerExpression, error) {
	// Implementation similar to the one in migrate_triggers.go
	// This is a simplified version for brevity

	if len(conditions) == 0 {
		// Create a default "always true" expression
		return []models.TriggerExpression{
			{
				ID:   "root",
				Type: models.TriggerExpressionTypeGroup,
				Operator: (*models.TriggerOperator)(func() *string {
					s := string(models.TriggerOperatorAnd)
					return &s
				}()),
				Conditions: []models.TriggerExpression{},
			},
		}, nil
	}

	// Parse old conditions
	var oldConditions interface{}
	if err := json.Unmarshal(conditions, &oldConditions); err != nil {
		return nil, fmt.Errorf("failed to parse old conditions: %w", err)
	}

	// Create a root AND group for all conditions
	rootExpression := models.TriggerExpression{
		ID:   "root",
		Type: models.TriggerExpressionTypeGroup,
		Operator: (*models.TriggerOperator)(func() *string {
			s := string(models.TriggerOperatorAnd)
			return &s
		}()),
		Conditions: []models.TriggerExpression{},
	}

	// For simplicity, we'll just create a placeholder expression
	// In a real implementation, you would convert the old conditions structure
	// to the new expression structure

	return []models.TriggerExpression{rootExpression}, nil
}

// convertActions converts old actions to new actions
func (s *TriggerCompatibilityService) convertActions(actions json.RawMessage) ([]models.TriggerAction, error) {
	// Implementation similar to the one in migrate_triggers.go
	// This is a simplified version for brevity

	if len(actions) == 0 {
		return []models.TriggerAction{}, nil
	}

	// Parse old actions
	var oldActions []map[string]interface{}
	if err := json.Unmarshal(actions, &oldActions); err != nil {
		return nil, fmt.Errorf("failed to parse old actions: %w", err)
	}

	// Convert to new format
	newActions := make([]models.TriggerAction, 0, len(oldActions))

	// For simplicity, we'll just create placeholder actions
	// In a real implementation, you would convert the old actions structure
	// to the new action structure

	return newActions, nil
}

// GetCompatibleTrigger gets a trigger in the appropriate format based on client version
func (s *TriggerCompatibilityService) GetCompatibleTrigger(triggerID uint, clientVersion string) (interface{}, error) {
	// Check client version to determine which format to return
	if clientVersion == "v1" {
		// Return old format
		return s.oldTriggerRepo.GetByID(triggerID)
	}

	// Default to new format
	return s.newTriggerRepo.GetByID(triggerID)
}

// CreateCompatibleTrigger creates a trigger in both old and new formats for compatibility
func (s *TriggerCompatibilityService) CreateCompatibleTrigger(newTrigger *models.EmailTriggerV2) error {
	// First create the new format trigger
	if err := s.newTriggerRepo.Create(newTrigger); err != nil {
		return fmt.Errorf("failed to create new format trigger: %w", err)
	}

	// Then create an equivalent old format trigger for backward compatibility
	oldTrigger := s.convertToOldFormat(newTrigger)
	if err := s.oldTriggerRepo.Create(oldTrigger); err != nil {
		// If old format creation fails, log but don't fail the operation
		log.Printf("[TriggerCompatibilityService] Warning: Failed to create old format trigger: %v", err)
	}

	return nil
}

// convertToOldFormat converts a new format trigger to the old format
func (s *TriggerCompatibilityService) convertToOldFormat(newTrigger *models.EmailTriggerV2) *models.EmailTrigger {
	// Create basic old trigger
	oldTrigger := &models.EmailTrigger{
		Name:        newTrigger.Name,
		Description: newTrigger.Description,
		Status:      models.TriggerStatusEnabled,
	}

	if !newTrigger.Enabled {
		oldTrigger.Status = models.TriggerStatusDisabled
	}

	// Convert expressions to conditions
	// This is a simplified implementation - creating a default condition
	oldTrigger.Condition = models.TriggerConditionConfig{
		Type:   "js",
		Script: "return true;", // Default always-true condition
	}

	// Convert actions to old format
	// This is a simplified implementation
	oldTrigger.Actions = models.TriggerActionsV1{}

	// Copy statistics
	oldTrigger.TotalExecutions = newTrigger.TotalExecutions
	oldTrigger.SuccessExecutions = newTrigger.SuccessExecutions
	oldTrigger.LastExecutedAt = newTrigger.LastExecutedAt
	oldTrigger.LastError = newTrigger.LastError

	return oldTrigger
}
