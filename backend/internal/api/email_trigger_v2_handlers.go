package api

import (
	"encoding/json"
	"fmt"
	"log"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"mailman/internal/triggerv2/plugins"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// EmailTriggerV2Controller handles API requests for EmailTriggerV2
type EmailTriggerV2Controller struct {
	triggerService  *services.EmailTriggerService
	triggerRepo     *repository.EmailTriggerV2Repository
	logRepo         *repository.TriggerExecutionLogV2Repository
	emailRepo       *repository.EmailRepository
	actionExecutor  *services.ActionExecutor
	pluginManager   plugins.PluginManager
	conditionEngine *services.ConditionEngine
	activityLogger  *services.ActivityLogger
}

// NewEmailTriggerV2Controller creates a new EmailTriggerV2Controller
func NewEmailTriggerV2Controller(
	triggerService *services.EmailTriggerService,
	triggerRepo *repository.EmailTriggerV2Repository,
	logRepo *repository.TriggerExecutionLogV2Repository,
	emailRepo *repository.EmailRepository,
	pluginManager plugins.PluginManager,
	conditionEngine *services.ConditionEngine,
) *EmailTriggerV2Controller {
	// Note: ActionExecutor (V1) is passed nil because V2 trigger handlers
	// use the pluginManager directly via the V2 plugin system.
	// The actionExecutor field is only used for legacy TestAction/ExecuteActions
	// compatibility and will return plugin-not-found errors when called with nil.
	actionExecutor := services.NewActionExecutor(nil)

	return &EmailTriggerV2Controller{
		triggerService:  triggerService,
		triggerRepo:     triggerRepo,
		logRepo:         logRepo,
		emailRepo:       emailRepo,
		actionExecutor:  actionExecutor,
		pluginManager:   pluginManager,
		conditionEngine: conditionEngine,
		activityLogger:  services.GetActivityLogger(),
	}
}

// EmailTriggerV2Response is the response for a EmailTriggerV2
type EmailTriggerV2Response struct {
	ID                uint                       `json:"id"`
	Name              string                     `json:"name"`
	Description       string                     `json:"description"`
	Enabled           bool                       `json:"enabled"`
	Expressions       []models.TriggerExpression `json:"expressions"`
	Actions           []models.TriggerAction     `json:"actions"`
	TotalExecutions   int64                      `json:"totalExecutions"`
	SuccessExecutions int64                      `json:"successExecutions"`
	LastExecutedAt    *time.Time                 `json:"lastExecutedAt,omitempty"`
	LastError         string                     `json:"lastError,omitempty"`
	CreatedAt         time.Time                  `json:"createdAt"`
	UpdatedAt         time.Time                  `json:"updatedAt"`
}

// PaginatedEmailTriggersV2Response is the response for paginated triggers
type PaginatedEmailTriggersV2Response struct {
	Data       []EmailTriggerV2Response `json:"data"`
	Total      int64                    `json:"total"`
	Page       int                      `json:"page"`
	Limit      int                      `json:"limit"`
	TotalPages int                      `json:"totalPages"`
}

// CreateEmailTriggerV2Request is the request for creating a trigger
type CreateEmailTriggerV2Request struct {
	Name        string                     `json:"name"`
	Description string                     `json:"description,omitempty"`
	Enabled     bool                       `json:"enabled"`
	Expressions []models.TriggerExpression `json:"expressions"`
	Actions     []models.TriggerAction     `json:"actions"`
}

// UpdateEmailTriggerV2Request is the request for updating a trigger
type UpdateEmailTriggerV2Request struct {
	Name        *string                    `json:"name,omitempty"`
	Description *string                    `json:"description,omitempty"`
	Enabled     *bool                      `json:"enabled,omitempty"`
	Expressions []models.TriggerExpression `json:"expressions,omitempty"`
	Actions     []models.TriggerAction     `json:"actions,omitempty"`
}

// BatchOperationRequest is the request for batch operations
type BatchOperationRequest struct {
	TriggerIDs []uint `json:"triggerIds"`
}

// BatchOperationResponse is the response for batch operations
type BatchOperationResponse struct {
	Success    bool     `json:"success"`
	Message    string   `json:"message"`
	Successful []uint   `json:"successful"`
	Failed     []uint   `json:"failed"`
	Errors     []string `json:"errors,omitempty"`
}

// TestTriggerConditionRequest is the request for testing a trigger condition
type TestTriggerConditionRequest struct {
	Expressions []models.TriggerExpression `json:"expressions"`
	TestData    map[string]interface{}     `json:"testData"`
}

// TestTriggerActionRequest is the request for testing a trigger action
type TestTriggerActionRequest struct {
	Action   models.TriggerAction   `json:"action"`
	TestData map[string]interface{} `json:"testData"`
}

// TestTriggerConditionHandler handles requests to test a trigger condition
func (c *EmailTriggerV2Controller) TestTriggerConditionHandler(w http.ResponseWriter, r *http.Request) {
	// Parse request body
	var req TestTriggerConditionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.Expressions) == 0 {
		http.Error(w, "Expressions are required", http.StatusBadRequest)
		return
	}

	// Create an email from the test data
	email := models.Email{}
	if req.TestData != nil {
		// Use JSON marshalling to convert map back to bytes, then unmarshal into Email struct
		// This handles field mapping (case-insensitive for untagged fields) and type conversion automaticaly
		if dataBytes, err := json.Marshal(req.TestData); err == nil {
			_ = json.Unmarshal(dataBytes, &email)
		}
	}

	// Create evaluation context
	context := services.NewEvaluationContext(email)

	// Add additional context data
	for k, v := range req.TestData {
		context.Data[k] = v
	}

	// Evaluate expressions
	result, evalDetails, err := c.conditionEngine.EvaluateExpressions(req.Expressions, context)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to evaluate conditions: %v", err), http.StatusInternalServerError)
		return
	}

	// Return the result
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"result":     result,
		"evaluation": evalDetails,
	})
}

// TestTriggerActionHandler handles requests to test a trigger action
func (c *EmailTriggerV2Controller) TestTriggerActionHandler(w http.ResponseWriter, r *http.Request) {
	// Parse request body
	var req TestTriggerActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Action.ID == "" || req.Action.PluginID == "" {
		http.Error(w, "Action ID and Plugin ID are required", http.StatusBadRequest)
		return
	}

	// Create a test email from the test data
	email := models.Email{}
	if req.TestData != nil {
		// Use JSON marshalling to convert map back to bytes, then unmarshal into Email struct
		if dataBytes, err := json.Marshal(req.TestData); err == nil {
			_ = json.Unmarshal(dataBytes, &email)
		}
	}

	// Use the action executor to test the action
	result, err := c.actionExecutor.TestAction(req.Action, email)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to test action: %v", err), http.StatusInternalServerError)
		return
	}

	// Return the result
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// RegisterRoutes registers the routes for EmailTriggerV2Controller
func (c *EmailTriggerV2Controller) RegisterRoutes(router *mux.Router) {
	// Test API routes
	// Note: paths are relative to the /api/v2 subrouter
	router.HandleFunc("/triggers/test-condition", c.TestTriggerConditionHandler).Methods("POST")
	router.HandleFunc("/triggers/test-action", c.TestTriggerActionHandler).Methods("POST")
	router.HandleFunc("/triggers/test-complete", c.TestCompleteTriggerHandler).Methods("POST")
	router.HandleFunc("/triggers/test-with-db-emails", c.TestConditionWithDatabaseEmailsHandler).Methods("POST")

	// Trigger management API routes
	router.HandleFunc("/triggers", c.CreateTriggerHandler).Methods("POST")
	router.HandleFunc("/triggers", c.GetTriggersHandler).Methods("GET")
	// Note: /triggers/{id}/statistics must be registered before /triggers/{id}
	router.HandleFunc("/triggers/{id}/statistics", c.GetTriggerStatisticsHandler).Methods("GET")
	router.HandleFunc("/triggers/{id}", c.GetTriggerHandler).Methods("GET")
	router.HandleFunc("/triggers/{id}", c.UpdateTriggerHandler).Methods("PUT")
	router.HandleFunc("/triggers/{id}", c.DeleteTriggerHandler).Methods("DELETE")
	router.HandleFunc("/triggers/{id}/enable", c.EnableTriggerHandler).Methods("POST")
	router.HandleFunc("/triggers/{id}/disable", c.DisableTriggerHandler).Methods("POST")

	// Batch operations
	router.HandleFunc("/triggers/batch/enable", c.BatchEnableTriggersHandler).Methods("POST")
	router.HandleFunc("/triggers/batch/disable", c.BatchDisableTriggersHandler).Methods("POST")
	router.HandleFunc("/triggers/batch/delete", c.BatchDeleteTriggersHandler).Methods("POST")

	// Execution logs API routes
	router.HandleFunc("/triggers/logs", c.GetTriggerLogsHandler).Methods("GET")
	router.HandleFunc("/triggers/{id}/logs", c.GetTriggerLogsByTriggerIDHandler).Methods("GET")
	router.HandleFunc("/triggers/logs/stats", c.GetTriggerLogsStatsHandler).Methods("GET")
	router.HandleFunc("/triggers/logs/export", c.ExportTriggerLogsHandler).Methods("GET")
}

// CreateTriggerHandler handles requests to create a new trigger
func (c *EmailTriggerV2Controller) CreateTriggerHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	// Parse request body
	var req CreateEmailTriggerV2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	if len(req.Expressions) == 0 {
		http.Error(w, "At least one expression is required", http.StatusBadRequest)
		return
	}

	if len(req.Actions) == 0 {
		http.Error(w, "At least one action is required", http.StatusBadRequest)
		return
	}

	// Create trigger model
	trigger := &models.EmailTriggerV2{
		Name:        req.Name,
		Description: req.Description,
		Enabled:     req.Enabled,
		Expressions: models.TriggerExpressions(req.Expressions),
		Actions:     models.TriggerActions(req.Actions),
		OrgID:       orgID,
	}

	// Enrich actions with plugin names from plugin registry
	c.enrichActionsWithPluginNames(trigger.Actions)

	// Debug: print expressions and actions
	log.Printf("[DEBUG] Creating trigger: %s", req.Name)
	exprJSON, _ := json.Marshal(trigger.Expressions)
	actJSON, _ := json.Marshal(trigger.Actions)
	log.Printf("[DEBUG] Expressions: %s", string(exprJSON))
	log.Printf("[DEBUG] Actions: %s", string(actJSON))

	// Create trigger in database
	if err := c.triggerRepo.Create(trigger); err != nil {
		log.Printf("[DEBUG] Create error: %v", err)
		http.Error(w, "Failed to create trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("[DEBUG] Trigger created successfully with ID: %d", trigger.ID)

	// If enabled, set up subscription
	if trigger.Enabled {
		if err := c.triggerService.EnableTrigger(trigger.ID); err != nil {
			// Log the error but don't fail the request
			log.Printf("[TriggerV2] Warning: Failed to enable trigger subscription: %v", err)
		}
	}

	// Record activity log
	userID := getUserIDFromContext(r)
	c.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"创建触发器",
		fmt.Sprintf("创建了触发器 %s", trigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   trigger.ID,
			"trigger_name": trigger.Name,
			"enabled":      trigger.Enabled,
		},
	)

	// Return response
	response := TriggerV2Response{
		ID:                trigger.ID,
		Name:              trigger.Name,
		Description:       trigger.Description,
		Enabled:           trigger.Enabled,
		Expressions:       convertModelExpressionsToAPI(trigger.Expressions),
		Actions:           convertModelActionsToAPI(trigger.Actions),
		TotalExecutions:   trigger.TotalExecutions,
		SuccessExecutions: trigger.SuccessExecutions,
		LastExecutedAt:    trigger.LastExecutedAt,
		LastError:         trigger.LastError,
		CreatedAt:         trigger.CreatedAt,
		UpdatedAt:         trigger.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// GetTriggersHandler handles requests to get all triggers with pagination
func (c *EmailTriggerV2Controller) GetTriggersHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	// Parse query parameters
	page := 1
	limit := 10
	sortBy := "created_at"
	sortOrder := "desc"
	search := ""

	if p := r.URL.Query().Get("page"); p != "" {
		if val, err := strconv.Atoi(p); err == nil && val > 0 {
			page = val
		}
	}

	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 100 {
			limit = val
		}
	}

	if s := r.URL.Query().Get("sort_by"); s != "" {
		sortBy = s
	}

	if o := r.URL.Query().Get("sort_order"); o == "asc" || o == "desc" {
		sortOrder = o
	}

	search = r.URL.Query().Get("search")

	// Get triggers with pagination
	triggers, total, err := c.triggerRepo.GetAllPaginated(page, limit, sortBy, sortOrder, search, orgID)
	if err != nil {
		http.Error(w, "Failed to retrieve triggers: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Convert to response format
	responseTriggers := make([]TriggerV2Response, 0, len(triggers))
	for _, trigger := range triggers {
		responseTriggers = append(responseTriggers, TriggerV2Response{
			ID:                trigger.ID,
			Name:              trigger.Name,
			Description:       trigger.Description,
			Enabled:           trigger.Enabled,
			Expressions:       convertModelExpressionsToAPI(trigger.Expressions),
			Actions:           convertModelActionsToAPI(trigger.Actions),
			TotalExecutions:   trigger.TotalExecutions,
			SuccessExecutions: trigger.SuccessExecutions,
			LastExecutedAt:    trigger.LastExecutedAt,
			LastError:         trigger.LastError,
			CreatedAt:         trigger.CreatedAt,
			UpdatedAt:         trigger.UpdatedAt,
		})
	}

	// Calculate total pages
	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	// Build response
	response := PaginatedTriggerV2Response{
		Data:       responseTriggers,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetTriggerHandler handles requests to get a single trigger by ID
func (c *EmailTriggerV2Controller) GetTriggerHandler(w http.ResponseWriter, r *http.Request) {

	// Get trigger ID from URL
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	// Get trigger from database
	trigger, err := c.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found: "+err.Error(), http.StatusNotFound)
		return
	}

	// Build response
	response := TriggerV2Response{
		ID:                trigger.ID,
		Name:              trigger.Name,
		Description:       trigger.Description,
		Enabled:           trigger.Enabled,
		Expressions:       convertModelExpressionsToAPI(trigger.Expressions),
		Actions:           convertModelActionsToAPI(trigger.Actions),
		TotalExecutions:   trigger.TotalExecutions,
		SuccessExecutions: trigger.SuccessExecutions,
		LastExecutedAt:    trigger.LastExecutedAt,
		LastError:         trigger.LastError,
		CreatedAt:         trigger.CreatedAt,
		UpdatedAt:         trigger.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// UpdateTriggerHandler handles requests to update a trigger
func (c *EmailTriggerV2Controller) UpdateTriggerHandler(w http.ResponseWriter, r *http.Request) {

	// Get trigger ID from URL
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	// Get existing trigger
	trigger, err := c.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found: "+err.Error(), http.StatusNotFound)
		return
	}

	// Parse request body
	var req UpdateTriggerV2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Track if enabled status is changing
	wasEnabled := trigger.Enabled

	// Apply updates
	if req.Name != nil {
		trigger.Name = *req.Name
	}

	if req.Description != nil {
		trigger.Description = *req.Description
	}

	if req.Enabled != nil {
		trigger.Enabled = *req.Enabled
	}

	if req.Expressions != nil {
		// Convert API expressions to model expressions
		modelExpressions := make(models.TriggerExpressions, len(req.Expressions))
		for i, expr := range req.Expressions {
			modelExpressions[i] = convertAPIExpressionToModel(expr)
		}
		trigger.Expressions = modelExpressions
	}

	if req.Actions != nil {
		// Convert API actions to model actions
		modelActions := make(models.TriggerActions, len(req.Actions))
		for i, action := range req.Actions {
			modelActions[i] = convertAPIActionToModel(action)
		}
		trigger.Actions = modelActions
		// Enrich actions with plugin names from plugin registry
		c.enrichActionsWithPluginNames(trigger.Actions)
	}

	// Update trigger in database
	if err := c.triggerRepo.Update(trigger); err != nil {
		http.Error(w, "Failed to update trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Handle subscription if enabled status changed
	if wasEnabled != trigger.Enabled {
		if trigger.Enabled {
			if err := c.triggerService.EnableTrigger(trigger.ID); err != nil {
				// Log the error but don't fail the request
				log.Printf("[TriggerV2] Warning: Failed to enable trigger subscription: %v", err)
			}
		} else {
			if err := c.triggerService.DisableTrigger(trigger.ID); err != nil {
				// Log the error but don't fail the request
				log.Printf("[TriggerV2] Warning: Failed to disable trigger subscription: %v", err)
			}
		}
	}

	// Record activity log
	userID := getUserIDFromContext(r)
	c.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"更新触发器",
		fmt.Sprintf("更新了触发器 %s", trigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   trigger.ID,
			"trigger_name": trigger.Name,
		},
	)

	// Build response
	response := TriggerV2Response{
		ID:                trigger.ID,
		Name:              trigger.Name,
		Description:       trigger.Description,
		Enabled:           trigger.Enabled,
		Expressions:       convertModelExpressionsToAPI(trigger.Expressions),
		Actions:           convertModelActionsToAPI(trigger.Actions),
		TotalExecutions:   trigger.TotalExecutions,
		SuccessExecutions: trigger.SuccessExecutions,
		LastExecutedAt:    trigger.LastExecutedAt,
		LastError:         trigger.LastError,
		CreatedAt:         trigger.CreatedAt,
		UpdatedAt:         trigger.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteTriggerHandler handles requests to delete a trigger
func (c *EmailTriggerV2Controller) DeleteTriggerHandler(w http.ResponseWriter, r *http.Request) {

	// Get trigger ID from URL
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	// Get trigger for logging
	trigger, err := c.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found: "+err.Error(), http.StatusNotFound)
		return
	}

	// Disable trigger first to remove subscription
	if trigger.Enabled {
		if err := c.triggerService.DisableTrigger(trigger.ID); err != nil {
			// Log the error but don't fail the request
			log.Printf("[TriggerV2] Warning: Failed to disable trigger before deletion: %v", err)
		}
	}

	// Delete trigger from database
	if err := c.triggerRepo.Delete(uint(id)); err != nil {
		http.Error(w, "Failed to delete trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Record activity log
	userID := getUserIDFromContext(r)
	c.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"删除触发器",
		fmt.Sprintf("删除了触发器 %s", trigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   trigger.ID,
			"trigger_name": trigger.Name,
		},
	)

	w.WriteHeader(http.StatusNoContent)
}

// EnableTriggerHandler handles requests to enable a trigger
func (c *EmailTriggerV2Controller) EnableTriggerHandler(w http.ResponseWriter, r *http.Request) {
	// Get trigger ID from URL
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	// Enable trigger
	if err := c.triggerService.EnableTrigger(uint(id)); err != nil {
		http.Error(w, "Failed to enable trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Get updated trigger
	trigger, err := c.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found after enabling: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Record activity log
	userID := getUserIDFromContext(r)
	c.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"启用触发器",
		fmt.Sprintf("启用了触发器 %s", trigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   trigger.ID,
			"trigger_name": trigger.Name,
		},
	)

	// Build response
	response := TriggerV2Response{
		ID:                trigger.ID,
		Name:              trigger.Name,
		Description:       trigger.Description,
		Enabled:           trigger.Enabled,
		Expressions:       convertModelExpressionsToAPI(trigger.Expressions),
		Actions:           convertModelActionsToAPI(trigger.Actions),
		TotalExecutions:   trigger.TotalExecutions,
		SuccessExecutions: trigger.SuccessExecutions,
		LastExecutedAt:    trigger.LastExecutedAt,
		LastError:         trigger.LastError,
		CreatedAt:         trigger.CreatedAt,
		UpdatedAt:         trigger.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DisableTriggerHandler handles requests to disable a trigger
func (c *EmailTriggerV2Controller) DisableTriggerHandler(w http.ResponseWriter, r *http.Request) {
	// Get trigger ID from URL
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	// Disable trigger
	if err := c.triggerService.DisableTrigger(uint(id)); err != nil {
		http.Error(w, "Failed to disable trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Get updated trigger
	trigger, err := c.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found after disabling: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Record activity log
	userID := getUserIDFromContext(r)
	c.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"禁用触发器",
		fmt.Sprintf("禁用了触发器 %s", trigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   trigger.ID,
			"trigger_name": trigger.Name,
		},
	)

	// Build response
	response := TriggerV2Response{
		ID:                trigger.ID,
		Name:              trigger.Name,
		Description:       trigger.Description,
		Enabled:           trigger.Enabled,
		Expressions:       convertModelExpressionsToAPI(trigger.Expressions),
		Actions:           convertModelActionsToAPI(trigger.Actions),
		TotalExecutions:   trigger.TotalExecutions,
		SuccessExecutions: trigger.SuccessExecutions,
		LastExecutedAt:    trigger.LastExecutedAt,
		LastError:         trigger.LastError,
		CreatedAt:         trigger.CreatedAt,
		UpdatedAt:         trigger.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// BatchEnableTriggersHandler handles requests to enable multiple triggers
func (c *EmailTriggerV2Controller) BatchEnableTriggersHandler(w http.ResponseWriter, r *http.Request) {
	// Parse request body
	var req BatchOperationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.TriggerIDs) == 0 {
		http.Error(w, "No trigger IDs provided", http.StatusBadRequest)
		return
	}

	// Process batch operation
	successful := make([]uint, 0)
	failed := make([]uint, 0)
	errors := make([]string, 0)

	for _, id := range req.TriggerIDs {
		if err := c.triggerService.EnableTrigger(id); err != nil {
			failed = append(failed, id)
			errors = append(errors, fmt.Sprintf("Failed to enable trigger %d: %v", id, err))
		} else {
			successful = append(successful, id)
		}
	}

	// Record activity log
	userID := getUserIDFromContext(r)
	c.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"批量启用触发器",
		fmt.Sprintf("批量启用了 %d 个触发器", len(successful)),
		userID,
		map[string]interface{}{
			"successful_count": len(successful),
			"failed_count":     len(failed),
			"successful_ids":   successful,
			"failed_ids":       failed,
		},
	)

	// Build response
	response := BatchOperationResponse{
		Success:    len(failed) == 0,
		Message:    fmt.Sprintf("Successfully enabled %d out of %d triggers", len(successful), len(req.TriggerIDs)),
		Successful: successful,
		Failed:     failed,
		Errors:     errors,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// BatchDisableTriggersHandler handles requests to disable multiple triggers
func (c *EmailTriggerV2Controller) BatchDisableTriggersHandler(w http.ResponseWriter, r *http.Request) {
	// Parse request body
	var req BatchOperationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.TriggerIDs) == 0 {
		http.Error(w, "No trigger IDs provided", http.StatusBadRequest)
		return
	}

	// Process batch operation
	successful := make([]uint, 0)
	failed := make([]uint, 0)
	errors := make([]string, 0)

	for _, id := range req.TriggerIDs {
		if err := c.triggerService.DisableTrigger(id); err != nil {
			failed = append(failed, id)
			errors = append(errors, fmt.Sprintf("Failed to disable trigger %d: %v", id, err))
		} else {
			successful = append(successful, id)
		}
	}

	// Record activity log
	userID := getUserIDFromContext(r)
	c.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"批量禁用触发器",
		fmt.Sprintf("批量禁用了 %d 个触发器", len(successful)),
		userID,
		map[string]interface{}{
			"successful_count": len(successful),
			"failed_count":     len(failed),
			"successful_ids":   successful,
			"failed_ids":       failed,
		},
	)

	// Build response
	response := BatchOperationResponse{
		Success:    len(failed) == 0,
		Message:    fmt.Sprintf("Successfully disabled %d out of %d triggers", len(successful), len(req.TriggerIDs)),
		Successful: successful,
		Failed:     failed,
		Errors:     errors,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// BatchDeleteTriggersHandler handles requests to delete multiple triggers
func (c *EmailTriggerV2Controller) BatchDeleteTriggersHandler(w http.ResponseWriter, r *http.Request) {
	// Parse request body
	var req BatchOperationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.TriggerIDs) == 0 {
		http.Error(w, "No trigger IDs provided", http.StatusBadRequest)
		return
	}

	// Process batch operation
	successful := make([]uint, 0)
	failed := make([]uint, 0)
	errors := make([]string, 0)

	for _, id := range req.TriggerIDs {
		// Get trigger to check if enabled
		trigger, err := c.triggerRepo.GetByID(id)
		if err != nil {
			failed = append(failed, id)
			errors = append(errors, fmt.Sprintf("Failed to find trigger %d: %v", id, err))
			continue
		}

		// Disable trigger first if enabled
		if trigger.Enabled {
			if err := c.triggerService.DisableTrigger(id); err != nil {
				// Log the error but continue with deletion
				log.Printf("[TriggerV2] Warning: Failed to disable trigger %d before deletion: %v", id, err)
			}
		}

		// Delete trigger
		if err := c.triggerRepo.Delete(id); err != nil {
			failed = append(failed, id)
			errors = append(errors, fmt.Sprintf("Failed to delete trigger %d: %v", id, err))
		} else {
			successful = append(successful, id)
		}
	}

	// Record activity log
	userID := getUserIDFromContext(r)
	c.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"批量删除触发器",
		fmt.Sprintf("批量删除了 %d 个触发器", len(successful)),
		userID,
		map[string]interface{}{
			"successful_count": len(successful),
			"failed_count":     len(failed),
			"successful_ids":   successful,
			"failed_ids":       failed,
		},
	)

	// Build response
	response := BatchOperationResponse{
		Success:    len(failed) == 0,
		Message:    fmt.Sprintf("Successfully deleted %d out of %d triggers", len(successful), len(req.TriggerIDs)),
		Successful: successful,
		Failed:     failed,
		Errors:     errors,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetTriggerLogsHandler handles requests to get trigger execution logs with pagination and filtering
func (c *EmailTriggerV2Controller) GetTriggerLogsHandler(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	page := 1
	limit := 10

	if p := r.URL.Query().Get("page"); p != "" {
		if val, err := strconv.Atoi(p); err == nil && val > 0 {
			page = val
		}
	}

	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 100 {
			limit = val
		}
	}

	// Parse filter parameters
	var triggerID *uint
	if idStr := r.URL.Query().Get("trigger_id"); idStr != "" {
		if id, err := strconv.ParseUint(idStr, 10, 32); err == nil {
			val := uint(id)
			triggerID = &val
		}
	}

	var status *models.TriggerExecutionV2Status
	if statusStr := r.URL.Query().Get("status"); statusStr != "" {
		val := models.TriggerExecutionV2Status(statusStr)
		status = &val
	}

	var startDate, endDate *time.Time
	if startDateStr := r.URL.Query().Get("start_date"); startDateStr != "" {
		if parsed, err := time.Parse(time.RFC3339, startDateStr); err == nil {
			startDate = &parsed
		}
	}

	if endDateStr := r.URL.Query().Get("end_date"); endDateStr != "" {
		if parsed, err := time.Parse(time.RFC3339, endDateStr); err == nil {
			endDate = &parsed
		}
	}

	// Get logs with pagination and filtering
	orgID := GetCurrentOrgID(r)
	logs, total, err := c.logRepo.GetAllPaginated(page, limit, triggerID, status, startDate, endDate, orgID)
	if err != nil {
		http.Error(w, "Failed to retrieve logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Calculate total pages
	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	// Build response
	response := map[string]interface{}{
		"data":        logs,
		"total":       total,
		"page":        page,
		"limit":       limit,
		"total_pages": totalPages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetTriggerLogsByTriggerIDHandler handles requests to get logs for a specific trigger
func (c *EmailTriggerV2Controller) GetTriggerLogsByTriggerIDHandler(w http.ResponseWriter, r *http.Request) {
	// Get trigger ID from URL
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	// Parse query parameters
	page := 1
	limit := 10

	if p := r.URL.Query().Get("page"); p != "" {
		if val, err := strconv.Atoi(p); err == nil && val > 0 {
			page = val
		}
	}

	if l := r.URL.Query().Get("limit"); l != "" {
		if val, err := strconv.Atoi(l); err == nil && val > 0 && val <= 100 {
			limit = val
		}
	}

	// Get logs for the trigger
	logs, total, err := c.logRepo.GetByTriggerID(uint(id), page, limit)
	if err != nil {
		http.Error(w, "Failed to retrieve logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Calculate total pages
	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	// Build response
	response := map[string]interface{}{
		"data":        logs,
		"total":       total,
		"page":        page,
		"limit":       limit,
		"total_pages": totalPages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetTriggerStatisticsHandler handles requests to get statistics for a specific trigger
// This endpoint is used by the frontend at /triggers/{id}/statistics
func (c *EmailTriggerV2Controller) GetTriggerStatisticsHandler(w http.ResponseWriter, r *http.Request) {
	// Get trigger ID from URL
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}
	triggerID := uint(id)

	// Parse date range parameters
	var startDate, endDate *time.Time
	if startDateStr := r.URL.Query().Get("start_date"); startDateStr != "" {
		if parsed, err := time.Parse(time.RFC3339, startDateStr); err == nil {
			startDate = &parsed
		}
	}

	if endDateStr := r.URL.Query().Get("end_date"); endDateStr != "" {
		if parsed, err := time.Parse(time.RFC3339, endDateStr); err == nil {
			endDate = &parsed
		}
	}

	// Get statistics from log repository
	stats, err := c.logRepo.GetStatistics(triggerID, startDate, endDate)
	if err != nil {
		http.Error(w, "Failed to retrieve statistics: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Add trigger details
	trigger, err := c.triggerRepo.GetByID(triggerID)
	if err == nil {
		stats["trigger_name"] = trigger.Name
		stats["trigger_enabled"] = trigger.Enabled
		stats["total_executions"] = trigger.TotalExecutions
		stats["success_executions"] = trigger.SuccessExecutions
	}

	// Wrap in data field for frontend API client compatibility
	response := map[string]interface{}{
		"data": stats,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetTriggerLogsStatsHandler handles requests to get statistics for trigger execution logs
func (c *EmailTriggerV2Controller) GetTriggerLogsStatsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	// Parse filter parameters
	var triggerID *uint
	if idStr := r.URL.Query().Get("trigger_id"); idStr != "" {
		if id, err := strconv.ParseUint(idStr, 10, 32); err == nil {
			val := uint(id)
			triggerID = &val
		}
	}

	var startDate, endDate *time.Time
	if startDateStr := r.URL.Query().Get("start_date"); startDateStr != "" {
		if parsed, err := time.Parse(time.RFC3339, startDateStr); err == nil {
			startDate = &parsed
		}
	}

	if endDateStr := r.URL.Query().Get("end_date"); endDateStr != "" {
		if parsed, err := time.Parse(time.RFC3339, endDateStr); err == nil {
			endDate = &parsed
		}
	}

	// Initialize response
	stats := map[string]interface{}{
		"total_executions":   0,
		"success_executions": 0,
		"failed_executions":  0,
		"partial_executions": 0,
		"avg_execution_time": 0,
		"success_rate":       0,
		"triggers_with_logs": 0,
		"period_start":       startDate,
		"period_end":         endDate,
	}

	// If a specific trigger ID is provided, get statistics for that trigger
	if triggerID != nil {
		triggerStats, err := c.logRepo.GetStatistics(*triggerID, startDate, endDate)
		if err != nil {
			http.Error(w, "Failed to retrieve statistics: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Add trigger details
		trigger, err := c.triggerRepo.GetByID(*triggerID)
		if err == nil {
			triggerStats["trigger_name"] = trigger.Name
			triggerStats["trigger_enabled"] = trigger.Enabled
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(triggerStats)
		return
	}

	// Otherwise, get aggregate statistics for all triggers
	// This would typically involve querying the database for aggregate statistics
	// For now, we'll implement a simple version that counts logs by status

	// Get all triggers
	triggers, err := c.triggerRepo.GetAll(orgID)
	if err != nil {
		http.Error(w, "Failed to retrieve triggers: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Initialize counters
	totalExecutions := int64(0)
	successExecutions := int64(0)
	failedExecutions := int64(0)
	partialExecutions := int64(0)
	totalDuration := int64(0)
	triggersWithLogs := 0

	// Collect statistics for each trigger
	for _, trigger := range triggers {
		triggerStats, err := c.logRepo.GetStatistics(trigger.ID, startDate, endDate)
		if err != nil {
			continue
		}

		// If the trigger has logs, count it
		if triggerStats["total_executions"].(int64) > 0 {
			triggersWithLogs++

			// Add to totals
			totalExecutions += triggerStats["total_executions"].(int64)
			successExecutions += triggerStats["success_executions"].(int64)
			failedExecutions += triggerStats["failed_executions"].(int64)
			partialExecutions += triggerStats["partial_executions"].(int64)

			// Add to total duration for average calculation
			totalDuration += int64(triggerStats["avg_execution_time"].(float64) * float64(triggerStats["total_executions"].(int64)))
		}
	}

	// Calculate average execution time and success rate
	avgExecutionTime := float64(0)
	if totalExecutions > 0 {
		avgExecutionTime = float64(totalDuration) / float64(totalExecutions)
	}

	successRate := float64(0)
	if totalExecutions > 0 {
		successRate = float64(successExecutions) / float64(totalExecutions) * 100
	}

	// Update stats
	stats["total_executions"] = totalExecutions
	stats["success_executions"] = successExecutions
	stats["failed_executions"] = failedExecutions
	stats["partial_executions"] = partialExecutions
	stats["avg_execution_time"] = avgExecutionTime
	stats["success_rate"] = successRate
	stats["triggers_with_logs"] = triggersWithLogs

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// ExportTriggerLogsHandler handles requests to export trigger execution logs
func (c *EmailTriggerV2Controller) ExportTriggerLogsHandler(w http.ResponseWriter, r *http.Request) {
	// Parse filter parameters
	var triggerID *uint
	if idStr := r.URL.Query().Get("trigger_id"); idStr != "" {
		if id, err := strconv.ParseUint(idStr, 10, 32); err == nil {
			val := uint(id)
			triggerID = &val
		}
	}

	var status *models.TriggerExecutionV2Status
	if statusStr := r.URL.Query().Get("status"); statusStr != "" {
		val := models.TriggerExecutionV2Status(statusStr)
		status = &val
	}

	var startDate, endDate *time.Time
	if startDateStr := r.URL.Query().Get("start_date"); startDateStr != "" {
		if parsed, err := time.Parse(time.RFC3339, startDateStr); err == nil {
			startDate = &parsed
		}
	}

	if endDateStr := r.URL.Query().Get("end_date"); endDateStr != "" {
		if parsed, err := time.Parse(time.RFC3339, endDateStr); err == nil {
			endDate = &parsed
		}
	}

	orgID := GetCurrentOrgID(r)
	logs, _, err := c.logRepo.GetAllPaginated(1, 10000, triggerID, status, startDate, endDate, orgID)
	if err != nil {
		http.Error(w, "Failed to retrieve logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Generate CSV data
	csvData := [][]string{
		{"ID", "Trigger ID", "Trigger Name", "Email ID", "Status", "Start Time", "End Time", "Duration (ms)",
			"Condition Result", "Actions Executed", "Actions Succeeded", "Error"},
	}

	for _, log := range logs {
		row := []string{
			fmt.Sprintf("%d", log.ID),
			fmt.Sprintf("%d", log.TriggerID),
			log.TriggerName,
			fmt.Sprintf("%d", log.EmailID),
			string(log.Status),
			log.StartTime.Format(time.RFC3339),
			log.EndTime.Format(time.RFC3339),
			fmt.Sprintf("%d", log.Duration),
			fmt.Sprintf("%t", log.ConditionResult),
			fmt.Sprintf("%d", log.ActionsExecuted),
			fmt.Sprintf("%d", log.ActionsSucceeded),
			log.Error,
		}
		csvData = append(csvData, row)
	}

	// Set headers for CSV download
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=trigger_logs.csv")

	// Write CSV data
	for _, row := range csvData {
		fmt.Fprintln(w, strings.Join(row, ","))
	}
}

// TestCompleteTriggerRequest is the request for testing a complete trigger
type TestCompleteTriggerRequest struct {
	Trigger  models.EmailTriggerV2  `json:"trigger"`
	TestData map[string]interface{} `json:"testData"`
}

// TestCompleteTriggerResponse is the response for testing a complete trigger
type TestCompleteTriggerResponse struct {
	ConditionResult  bool                          `json:"conditionResult"`
	ConditionEval    models.JSONMap                `json:"conditionEvaluation"`
	ActionsExecuted  int                           `json:"actionsExecuted"`
	ActionsSucceeded int                           `json:"actionsSucceeded"`
	ActionResults    models.ActionExecutionResults `json:"actionResults"`
	Duration         int64                         `json:"duration"`
	Error            string                        `json:"error,omitempty"`
}

// TestCompleteTriggerHandler handles requests to test a complete trigger
func (c *EmailTriggerV2Controller) TestCompleteTriggerHandler(w http.ResponseWriter, r *http.Request) {
	// Parse request body
	var req TestCompleteTriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.Trigger.Expressions) == 0 {
		http.Error(w, "Trigger expressions are required", http.StatusBadRequest)
		return
	}

	if len(req.Trigger.Actions) == 0 {
		http.Error(w, "Trigger actions are required", http.StatusBadRequest)
		return
	}

	// Create a test email from the test data
	email := models.Email{}
	if req.TestData != nil {
		// Try to parse as JSON and unmarshal directly to Email struct
		testDataBytes, err := json.Marshal(req.TestData)
		if err == nil {
			// Try to unmarshal directly - this handles the case where testData matches Email struct
			json.Unmarshal(testDataBytes, &email)
		}

		// Also try lowercase field names (for backwards compatibility)
		if email.Subject == "" {
			if subject, ok := req.TestData["subject"].(string); ok {
				email.Subject = subject
			}
		}
		if len(email.From) == 0 {
			// Handle both string and array formats
			if from, ok := req.TestData["from"].(string); ok {
				email.From = models.StringSlice{from}
			} else if fromArr, ok := req.TestData["from"].([]interface{}); ok {
				email.From = make(models.StringSlice, len(fromArr))
				for i, v := range fromArr {
					if s, ok := v.(string); ok {
						email.From[i] = s
					}
				}
			}
		}
		if len(email.To) == 0 {
			// Handle both string and array formats
			if to, ok := req.TestData["to"].(string); ok {
				email.To = models.StringSlice{to}
			} else if toArr, ok := req.TestData["to"].([]interface{}); ok {
				email.To = make(models.StringSlice, len(toArr))
				for i, v := range toArr {
					if s, ok := v.(string); ok {
						email.To[i] = s
					}
				}
			}
		}
		if email.Body == "" {
			if body, ok := req.TestData["body"].(string); ok {
				email.Body = body
			}
		}
		// Handle ID field
		if email.ID == 0 {
			if id, ok := req.TestData["ID"].(float64); ok {
				email.ID = uint(id)
			}
		}
	}

	startTime := time.Now()

	// Create response object
	response := TestCompleteTriggerResponse{}

	// Create evaluation context
	context := services.NewEvaluationContext(email)

	// Add additional context data
	for k, v := range req.TestData {
		context.Data[k] = v
	}

	// Evaluate expressions
	conditionResult, conditionEval, err := c.conditionEngine.EvaluateExpressions(req.Trigger.Expressions, context)
	response.ConditionResult = conditionResult
	response.ConditionEval = conditionEval

	if err != nil {
		response.Error = fmt.Sprintf("Failed to evaluate conditions: %v", err)
		response.Duration = time.Since(startTime).Milliseconds()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// If conditions are not met, return early
	if !conditionResult {
		response.Duration = time.Since(startTime).Milliseconds()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Execute actions
	actionResults, err := c.actionExecutor.ExecuteActions(req.Trigger.Actions, email)
	response.ActionResults = actionResults
	response.ActionsExecuted = len(actionResults)

	// Count successful actions
	successfulActions := 0
	for _, result := range actionResults {
		if result.Success {
			successfulActions++
		}
	}
	response.ActionsSucceeded = successfulActions

	if err != nil {
		response.Error = fmt.Sprintf("Error executing actions: %v", err)
	}

	response.Duration = time.Since(startTime).Milliseconds()

	// Record activity log
	userID := getUserIDFromContext(r)
	c.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"测试触发器",
		"测试了完整触发器流程",
		userID,
		map[string]interface{}{
			"condition_result":  conditionResult,
			"actions_executed":  response.ActionsExecuted,
			"actions_succeeded": response.ActionsSucceeded,
			"duration":          response.Duration,
		},
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Helper conversion functions
func convertModelExpressionsToAPI(expressions models.TriggerExpressions) []TriggerExpression {
	result := make([]TriggerExpression, len(expressions))
	for i, expr := range expressions {
		result[i] = TriggerExpression{
			ID:         expr.ID,
			Type:       string(expr.Type),
			Operator:   derefOperator(expr.Operator),
			Field:      derefString(expr.Field),
			Value:      expr.Value,
			Conditions: convertModelExpressionsToAPI(expr.Conditions),
			PluginID:   derefString(expr.PluginID),
			Fields:     expr.Fields,
			Not:        derefBool(expr.Not),
		}
	}
	return result
}

func convertModelActionsToAPI(actions models.TriggerActions) []TriggerAction {
	result := make([]TriggerAction, len(actions))
	for i, action := range actions {
		result[i] = TriggerAction{
			ID:             action.ID,
			PluginID:       action.PluginID,
			PluginName:     action.PluginName,
			Config:         action.Config,
			Enabled:        action.Enabled,
			ExecutionOrder: action.ExecutionOrder,
		}
	}
	return result
}

func convertAPIExpressionToModel(expr TriggerExpression) models.TriggerExpression {
	operator := models.TriggerOperator(expr.Operator)
	return models.TriggerExpression{
		ID:         expr.ID,
		Type:       models.TriggerExpressionType(expr.Type),
		Operator:   &operator,
		Field:      &expr.Field,
		Value:      expr.Value,
		Conditions: convertAPIExpressionsToModelExpressions(expr.Conditions),
		PluginID:   &expr.PluginID,
		Fields:     expr.Fields,
		Not:        &expr.Not,
	}
}

func convertAPIExpressionsToModelExpressions(expressions []TriggerExpression) []models.TriggerExpression {
	result := make([]models.TriggerExpression, len(expressions))
	for i, expr := range expressions {
		result[i] = convertAPIExpressionToModel(expr)
	}
	return result
}

func convertAPIActionToModel(action TriggerAction) models.TriggerAction {
	return models.TriggerAction{
		ID:             action.ID,
		PluginID:       action.PluginID,
		PluginName:     action.PluginName,
		Config:         action.Config,
		Enabled:        action.Enabled,
		ExecutionOrder: action.ExecutionOrder,
	}
}

func convertAPIActionsToModelActions(actions []TriggerAction) models.TriggerActions {
	result := make(models.TriggerActions, len(actions))
	for i, action := range actions {
		result[i] = convertAPIActionToModel(action)
	}
	return result
}

// convertAPIExpressionsToModel 将 API 的 Expressions 转换为模型的 Expressions
func convertAPIExpressionsToModel(apiExpressions []TriggerExpression) models.TriggerExpressions {
	if len(apiExpressions) == 0 {
		return nil
	}

	modelExpressions := make(models.TriggerExpressions, len(apiExpressions))
	for i, apiExp := range apiExpressions {
		modelExpressions[i] = convertAPIExpressionToModel(apiExp)
	}
	return modelExpressions
}

// convertAPIActionsToModel 将 API 的 Actions 转换为模型的 Actions
func convertAPIActionsToModel(apiActions []TriggerAction) models.TriggerActions {
	if len(apiActions) == 0 {
		return nil
	}

	modelActions := make(models.TriggerActions, len(apiActions))
	for i, apiAction := range apiActions {
		modelActions[i] = models.TriggerAction{
			ID:             apiAction.ID,
			PluginID:       apiAction.PluginID,
			PluginName:     apiAction.PluginName,
			Config:         apiAction.Config,
			Enabled:        apiAction.Enabled,
			ExecutionOrder: apiAction.ExecutionOrder,
		}
	}
	return modelActions
}

func derefOperator(op *models.TriggerOperator) string {
	if op == nil {
		return ""
	}
	return string(*op)
}

// Helper functions for pointer dereferencing
func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefBool(b *bool) bool {
	if b == nil {
		return false
	}
	return *b
}

// TestConditionWithDatabaseEmailsRequest 使用数据库邮件测试过滤条件的请求
type TestConditionWithDatabaseEmailsRequest struct {
	Expressions []models.TriggerExpression `json:"expressions"`
	StartTime   *time.Time                 `json:"startTime,omitempty"`
	EndTime     *time.Time                 `json:"endTime,omitempty"`
	Sender      string                     `json:"sender,omitempty"`
	Recipient   string                     `json:"recipient,omitempty"`
	Limit       int                        `json:"limit"`
}

// MatchedEmailResult 匹配邮件结果
type MatchedEmailResult struct {
	ID          uint                   `json:"id"`
	MessageID   string                 `json:"messageId"`
	Subject     string                 `json:"subject"`
	From        string                 `json:"from"`
	To          []string               `json:"to"`
	ReceivedAt  time.Time              `json:"receivedAt"`
	BodyPreview string                 `json:"bodyPreview"`
	HTMLPreview string                 `json:"htmlPreview"`
	Evaluation  map[string]interface{} `json:"evaluation"`
}

// TestConditionWithDatabaseEmailsResponse 使用数据库邮件测试过滤条件的响应
type TestConditionWithDatabaseEmailsResponse struct {
	TotalScanned    int                  `json:"totalScanned"`
	TotalMatched    int                  `json:"totalMatched"`
	MatchedEmails   []MatchedEmailResult `json:"matchedEmails"`
	ExecutionTimeMs int64                `json:"executionTimeMs"`
}

// TestConditionWithDatabaseEmailsHandler 使用数据库邮件测试过滤条件
func (c *EmailTriggerV2Controller) TestConditionWithDatabaseEmailsHandler(w http.ResponseWriter, r *http.Request) {
	startTime := time.Now()

	// Parse request body
	var req TestConditionWithDatabaseEmailsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.Expressions) == 0 {
		http.Error(w, "Expressions are required", http.StatusBadRequest)
		return
	}

	// Set default limit if not provided (0 表示不限制)
	if req.Limit <= 0 {
		req.Limit = 100 // 默认值
	}
	// 不再限制最大值，允许扫描所有邮件

	// Query emails from database
	emails, err := c.queryEmailsWithFilters(req)
	if err != nil {
		http.Error(w, "Failed to query emails: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Test each email against the expressions
	matchedEmails := make([]MatchedEmailResult, 0)

	for _, email := range emails {
		// Create evaluation context
		context := services.NewEvaluationContext(email)

		// Evaluate expressions
		result, evalDetails, err := c.conditionEngine.EvaluateExpressions(req.Expressions, context)
		if err != nil {
			// Log error but continue to next email
			log.Printf("[TriggerV2] Error evaluating email %d: %v", email.ID, err)
			continue
		}

		if result {
			// Create body preview (max 200 chars, sanitized)
			bodyPreview := email.TextBody
			if len(bodyPreview) > 200 {
				bodyPreview = bodyPreview[:200] + "..."
			}

			// Create HTML preview (sanitized - remove script tags etc for XSS protection)
			htmlPreview := c.sanitizeHTML(email.HTMLBody)
			if len(htmlPreview) > 5000 {
				htmlPreview = htmlPreview[:5000] + "..."
			}

			// Get from address
			fromAddr := ""
			if len(email.From) > 0 {
				fromAddr = email.From[0]
			}

			// Convert models.JSONMap to map[string]interface{}
			evalMap := make(map[string]interface{})
			for k, v := range evalDetails {
				evalMap[k] = v
			}

			matchedEmails = append(matchedEmails, MatchedEmailResult{
				ID:          email.ID,
				MessageID:   email.MessageID,
				Subject:     email.Subject,
				From:        fromAddr,
				To:          email.To,
				ReceivedAt:  email.ReceivedAt,
				BodyPreview: bodyPreview,
				HTMLPreview: htmlPreview,
				Evaluation:  evalMap,
			})
		}
	}

	// Build response
	response := TestConditionWithDatabaseEmailsResponse{
		TotalScanned:    len(emails),
		TotalMatched:    len(matchedEmails),
		MatchedEmails:   matchedEmails,
		ExecutionTimeMs: time.Since(startTime).Milliseconds(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// queryEmailsWithFilters 根据过滤条件查询邮件
func (c *EmailTriggerV2Controller) queryEmailsWithFilters(req TestConditionWithDatabaseEmailsRequest) ([]models.Email, error) {
	// Use the SearchEmails method with EmailSearchOptions
	options := repository.EmailSearchOptions{
		Limit:     req.Limit,
		Offset:    0,
		SortBy:    "received_at DESC",
		StartDate: req.StartTime,
		EndDate:   req.EndTime,
		FromQuery: req.Sender,
		ToQuery:   req.Recipient,
	}

	emails, _, err := c.emailRepo.SearchEmails(options)
	return emails, err
}

// sanitizeHTML 简单的 HTML sanitization 防止 XSS
func (c *EmailTriggerV2Controller) sanitizeHTML(html string) string {
	// Remove script tags
	html = strings.ReplaceAll(html, "<script", "&lt;script")
	html = strings.ReplaceAll(html, "</script>", "&lt;/script&gt;")
	html = strings.ReplaceAll(html, "javascript:", "")
	html = strings.ReplaceAll(html, "onclick", "data-onclick")
	html = strings.ReplaceAll(html, "onerror", "data-onerror")
	html = strings.ReplaceAll(html, "onload", "data-onload")
	html = strings.ReplaceAll(html, "onmouseover", "data-onmouseover")
	return html
}

// enrichActionsWithPluginNames populates pluginName for actions from the plugin registry
func (c *EmailTriggerV2Controller) enrichActionsWithPluginNames(actions models.TriggerActions) {
	// Get all available plugins
	plugins, err := c.pluginManager.ListPlugins()
	if err != nil {
		log.Printf("[enrichActionsWithPluginNames] Failed to list plugins: %v", err)
		return
	}

	// Create a map for quick lookups
	pluginMap := make(map[string]string)
	for _, plugin := range plugins {
		pluginMap[plugin.ID] = plugin.Name
	}

	// Enrich actions with plugin names
	for i := range actions {
		if actions[i].PluginName == "" && actions[i].PluginID != "" {
			if name, exists := pluginMap[actions[i].PluginID]; exists {
				actions[i].PluginName = name
			} else {
				// Use pluginID as fallback name
				actions[i].PluginName = actions[i].PluginID
			}
		}
	}
}
