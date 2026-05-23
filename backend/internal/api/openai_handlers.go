package api

import (
	"encoding/json"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// OpenAIHandler handles OpenAI-related API endpoints
type OpenAIHandler struct {
	OpenAIConfigRepo      *repository.OpenAIConfigRepository
	AIPromptTemplateRepo  *repository.AIPromptTemplateRepository
	ExtractorTemplateRepo *repository.ExtractorTemplateRepository
}

// NewOpenAIHandler creates a new OpenAI handler
func NewOpenAIHandler(
	openAIConfigRepo *repository.OpenAIConfigRepository,
	aiPromptTemplateRepo *repository.AIPromptTemplateRepository,
	extractorTemplateRepo *repository.ExtractorTemplateRepository,
) *OpenAIHandler {
	return &OpenAIHandler{
		OpenAIConfigRepo:      openAIConfigRepo,
		AIPromptTemplateRepo:  aiPromptTemplateRepo,
		ExtractorTemplateRepo: extractorTemplateRepo,
	}
}

// OpenAI Configuration Handlers

// ListOpenAIConfigs godoc
// @Summary List all OpenAI configurations
// @Description Get a list of all OpenAI configurations
// @Tags openai
// @Accept json
// @Produce json
// @Success 200 {array} OpenAIConfigResponse
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/configs [get]
func (h *OpenAIHandler) ListOpenAIConfigs(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	configs, err := h.OpenAIConfigRepo.List(orgID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]OpenAIConfigResponse, len(configs))
	for i, config := range configs {
		// Decrypt API key for response
		config.APIKey = services.DecryptIfAvailable(config.APIKey)
		response[i] = ConvertOpenAIConfigToResponse(&config)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetOpenAIConfig godoc
// @Summary Get OpenAI configuration by ID
// @Description Get a specific OpenAI configuration by its ID
// @Tags openai
// @Accept json
// @Produce json
// @Param id path int true "Configuration ID"
// @Success 200 {object} OpenAIConfigResponse
// @Failure 404 {string} string "Configuration not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/configs/{id} [get]
func (h *OpenAIHandler) GetOpenAIConfig(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	config, err := h.OpenAIConfigRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Configuration not found", http.StatusNotFound)
		return
	}

	// Decrypt API key for response
	config.APIKey = services.DecryptIfAvailable(config.APIKey)

	response := ConvertOpenAIConfigToResponse(config)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CreateOpenAIConfig godoc
// @Summary Create a new OpenAI configuration
// @Description Create a new OpenAI configuration
// @Tags openai
// @Accept json
// @Produce json
// @Param config body OpenAIConfigRequest true "OpenAI configuration"
// @Success 201 {object} OpenAIConfigResponse
// @Failure 400 {string} string "Bad Request"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/configs [post]
func (h *OpenAIHandler) CreateOpenAIConfig(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	var req OpenAIConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	config := &models.OpenAIConfig{
		Name:        req.Name,
		ChannelType: models.AIChannelType(req.ChannelType),
		BaseURL:     req.BaseURL,
		APIKey:      services.EncryptIfAvailable(req.APIKey),
		Model:       req.Model,
		Headers:     models.JSONMap(req.Headers),
		IsActive:    req.IsActive,
		OrgID:       orgID,
	}

	if err := h.OpenAIConfigRepo.Create(config); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Decrypt for response
	config.APIKey = services.DecryptIfAvailable(config.APIKey)
	response := ConvertOpenAIConfigToResponse(config)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// UpdateOpenAIConfig godoc
// @Summary Update an OpenAI configuration
// @Description Update an existing OpenAI configuration
// @Tags openai
// @Accept json
// @Produce json
// @Param id path int true "Configuration ID"
// @Param config body OpenAIConfigRequest true "OpenAI configuration"
// @Success 200 {object} OpenAIConfigResponse
// @Failure 400 {string} string "Bad Request"
// @Failure 404 {string} string "Configuration not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/configs/{id} [put]
func (h *OpenAIHandler) UpdateOpenAIConfig(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	var req OpenAIConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	config, err := h.OpenAIConfigRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Configuration not found", http.StatusNotFound)
		return
	}

	config.Name = req.Name
	config.ChannelType = models.AIChannelType(req.ChannelType)
	config.BaseURL = req.BaseURL
	config.APIKey = services.EncryptIfAvailable(req.APIKey)
	config.Model = req.Model
	config.Headers = models.JSONMap(req.Headers)
	config.IsActive = req.IsActive

	if err := h.OpenAIConfigRepo.Update(config); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Decrypt for response
	config.APIKey = services.DecryptIfAvailable(config.APIKey)
	response := ConvertOpenAIConfigToResponse(config)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteOpenAIConfig godoc
// @Summary Delete an OpenAI configuration
// @Description Delete an OpenAI configuration
// @Tags openai
// @Accept json
// @Produce json
// @Param id path int true "Configuration ID"
// @Success 204 "No Content"
// @Failure 404 {string} string "Configuration not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/configs/{id} [delete]
func (h *OpenAIHandler) DeleteOpenAIConfig(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	if err := h.OpenAIConfigRepo.Delete(uint(id)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// AI Prompt Template Handlers

// ListAIPromptTemplates godoc
// @Summary List all AI prompt templates
// @Description Get a list of all AI prompt templates
// @Tags openai
// @Accept json
// @Produce json
// @Success 200 {array} AIPromptTemplateResponse
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/prompt-templates [get]
func (h *OpenAIHandler) ListAIPromptTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := h.AIPromptTemplateRepo.List()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]AIPromptTemplateResponse, len(templates))
	for i, template := range templates {
		response[i] = ConvertAIPromptTemplateToResponse(&template)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetAIPromptTemplate godoc
// @Summary Get AI prompt template by ID
// @Description Get a specific AI prompt template by its ID
// @Tags openai
// @Accept json
// @Produce json
// @Param id path int true "Template ID"
// @Success 200 {object} AIPromptTemplateResponse
// @Failure 404 {string} string "Template not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/prompt-templates/{id} [get]
func (h *OpenAIHandler) GetAIPromptTemplate(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	template, err := h.AIPromptTemplateRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}

	response := ConvertAIPromptTemplateToResponse(template)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CreateAIPromptTemplate godoc
// @Summary Create a new AI prompt template
// @Description Create a new AI prompt template
// @Tags openai
// @Accept json
// @Produce json
// @Param template body AIPromptTemplateRequest true "AI prompt template"
// @Success 201 {object} AIPromptTemplateResponse
// @Failure 400 {string} string "Bad Request"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/prompt-templates [post]
func (h *OpenAIHandler) CreateAIPromptTemplate(w http.ResponseWriter, r *http.Request) {

	var req AIPromptTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	template := &models.AIPromptTemplate{
		Scenario:     req.Scenario,
		Name:         req.Name,
		Description:  req.Description,
		SystemPrompt: req.SystemPrompt,
		UserPrompt:   req.UserPrompt,
		Variables:    models.JSONMap(req.Variables),
		MaxTokens:    req.MaxTokens,
		Temperature:  req.Temperature,
		IsActive:     req.IsActive,
	}

	if err := h.AIPromptTemplateRepo.Create(template); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := ConvertAIPromptTemplateToResponse(template)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// UpdateAIPromptTemplate godoc
// @Summary Update an AI prompt template
// @Description Update an existing AI prompt template
// @Tags openai
// @Accept json
// @Produce json
// @Param id path int true "Template ID"
// @Param template body AIPromptTemplateRequest true "AI prompt template"
// @Success 200 {object} AIPromptTemplateResponse
// @Failure 400 {string} string "Bad Request"
// @Failure 404 {string} string "Template not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/prompt-templates/{id} [put]
func (h *OpenAIHandler) UpdateAIPromptTemplate(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	var req AIPromptTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	template, err := h.AIPromptTemplateRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}

	template.Scenario = req.Scenario
	template.Name = req.Name
	template.Description = req.Description
	template.SystemPrompt = req.SystemPrompt
	template.UserPrompt = req.UserPrompt
	template.Variables = models.JSONMap(req.Variables)
	template.MaxTokens = req.MaxTokens
	template.Temperature = req.Temperature
	template.IsActive = req.IsActive

	if err := h.AIPromptTemplateRepo.Update(template); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := ConvertAIPromptTemplateToResponse(template)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteAIPromptTemplate godoc
// @Summary Delete an AI prompt template
// @Description Delete an AI prompt template
// @Tags openai
// @Accept json
// @Produce json
// @Param id path int true "Template ID"
// @Success 204 "No Content"
// @Failure 404 {string} string "Template not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/prompt-templates/{id} [delete]
func (h *OpenAIHandler) DeleteAIPromptTemplate(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	if err := h.AIPromptTemplateRepo.Delete(uint(id)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// AI Generation Handler

// GenerateEmailTemplate godoc
// @Summary Generate an email template using AI
// @Description Generate an email extraction template using OpenAI based on user input
// @Tags openai
// @Accept json
// @Produce json
// @Param request body GenerateEmailTemplateRequest true "Generation request"
// @Success 200 {object} GenerateEmailTemplateResponse
// @Failure 400 {string} string "Bad Request"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/generate-template [post]
func (h *OpenAIHandler) GenerateEmailTemplate(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	var req GenerateEmailTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Get active OpenAI configuration
	openAIConfig, err := h.OpenAIConfigRepo.GetActive(orgID)
	if err != nil {
		http.Error(w, "No active OpenAI configuration found", http.StatusInternalServerError)
		return
	}
	openAIConfig.APIKey = services.DecryptIfAvailable(openAIConfig.APIKey)

	// Get prompt template
	scenario := req.Scenario
	if scenario == "" {
		scenario = "email_template_generation"
	}

	promptTemplate, err := h.AIPromptTemplateRepo.GetByScenario(scenario)
	if err != nil {
		http.Error(w, fmt.Sprintf("No active prompt template found for scenario: %s", scenario), http.StatusInternalServerError)
		return
	}

	// Create AI provider based on channel type
	aiProvider := services.NewAIProvider(openAIConfig)

	// Generate the template
	response, err := aiProvider.GenerateEmailTemplate(
		promptTemplate.SystemPrompt,
		req.UserInput,
		promptTemplate.MaxTokens,
		promptTemplate.Temperature,
	)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to generate template: %v", err), http.StatusInternalServerError)
		return
	}

	// Extract the generated content
	if len(response.Choices) == 0 {
		http.Error(w, "No response generated", http.StatusInternalServerError)
		return
	}

	generatedContent := response.Choices[0].Message.Content

	// Parse the extractor configuration
	// Create a temporary OpenAI service for parsing (this is independent of the AI provider)
	openAIService := services.NewOpenAIService(openAIConfig)
	extractorConfig, err := openAIService.ParseExtractorTemplate(generatedContent)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to parse generated template: %v", err), http.StatusInternalServerError)
		return
	}

	// Create the extractor template
	extractorTemplate := &models.ExtractorTemplate{
		Name:        req.TemplateName,
		Description: req.Description,
		Extractors:  extractorConfig,
		OrgID:       orgID,
	}

	if err := h.ExtractorTemplateRepo.Create(extractorTemplate); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save template: %v", err), http.StatusInternalServerError)
		return
	}

	// Save the generation record (commented out for now - need to create repository)
	// generatedTemplate := &models.AIGeneratedTemplate{
	// 	Name:             req.TemplateName,
	// 	Description:      req.Description,
	// 	PromptTemplateID: promptTemplate.ID,
	// 	UserInput:        req.UserInput,
	// 	GeneratedContent: generatedContent,
	// 	ExtractorConfig:  extractorConfig,
	// 	Model:            response.Model,
	// 	TokensUsed:       response.Usage.TotalTokens,
	// }
	// TODO: Create a repository for AIGeneratedTemplate and save this record

	// Return the response
	genResponse := GenerateEmailTemplateResponse{
		ID:               extractorTemplate.ID,
		Name:             extractorTemplate.Name,
		Description:      extractorTemplate.Description,
		UserInput:        req.UserInput,
		GeneratedContent: generatedContent,
		ExtractorConfig:  extractorConfig,
		Model:            response.Model,
		TokensUsed:       response.Usage.TotalTokens,
		CreatedAt:        extractorTemplate.CreatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(genResponse)
}

// InitializeDefaultPromptTemplates godoc
// @Summary Initialize default prompt templates
// @Description Initialize default AI prompt templates in the database
// @Tags openai
// @Accept json
// @Produce json
// @Success 200 {string} string "Default templates initialized successfully"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/initialize-templates [post]
func (h *OpenAIHandler) InitializeDefaultPromptTemplates(w http.ResponseWriter, r *http.Request) {
	if err := h.AIPromptTemplateRepo.InitializeDefaultTemplates(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Default templates initialized successfully"})
}

// CallOpenAI godoc
// @Summary Call OpenAI API directly
// @Description Call OpenAI API with custom system prompt and user message
// @Tags openai
// @Accept json
// @Produce json
// @Param request body CallOpenAIRequest true "OpenAI call request"
// @Success 200 {object} CallOpenAIResponse
// @Failure 400 {string} string "Bad Request"
// @Failure 404 {string} string "Configuration not found"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/call [post]
func (h *OpenAIHandler) CallOpenAI(w http.ResponseWriter, r *http.Request) {
	var req CallOpenAIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Get the OpenAI configuration
	config, err := h.OpenAIConfigRepo.GetByID(req.ConfigID)
	if err != nil {
		http.Error(w, "Configuration not found", http.StatusNotFound)
		return
	}
	config.APIKey = services.DecryptIfAvailable(config.APIKey)

	if !config.IsActive {
		http.Error(w, "Configuration is not active", http.StatusBadRequest)
		return
	}

	// Initialize system prompt and user message
	systemPrompt := req.SystemPrompt
	userMessage := req.UserMessage

	// If template ID is provided, use template to enhance prompts
	if req.TemplateID > 0 {
		template, err := h.AIPromptTemplateRepo.GetByID(req.TemplateID)
		if err == nil && template.IsActive {
			// Use template prompts as base if not provided in request
			if systemPrompt == "" {
				systemPrompt = template.SystemPrompt
			}
			if template.UserPrompt != "" && userMessage == "" {
				userMessage = template.UserPrompt
			}

			// Apply variables to prompts
			if req.Variables != nil {
				for key, value := range req.Variables {
					systemPrompt = strings.ReplaceAll(systemPrompt, "{{"+key+"}}", value)
					userMessage = strings.ReplaceAll(userMessage, "{{"+key+"}}", value)
				}
			}

			// Use template settings if not provided in request
			if req.MaxTokens == 0 && template.MaxTokens > 0 {
				req.MaxTokens = template.MaxTokens
			}
			if req.Temperature == 0 && template.Temperature > 0 {
				req.Temperature = template.Temperature
			}
		}
	}

	// Set defaults if not provided
	if req.MaxTokens == 0 {
		req.MaxTokens = 1000
	}
	if req.Temperature == 0 {
		req.Temperature = 0.7
	}
	if req.ResponseFormat == "" {
		req.ResponseFormat = "text"
	}

	// Create AI provider based on channel type
	aiProvider := services.NewAIProvider(config)

	// Prepare messages
	messages := []services.Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userMessage},
	}

	// Call AI
	response, err := aiProvider.CallAI(messages, req.MaxTokens, req.Temperature)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to call OpenAI: %v", err), http.StatusInternalServerError)
		return
	}

	// Extract content from response
	content := ""
	if len(response.Choices) > 0 {
		content = response.Choices[0].Message.Content
	}

	// Return the response
	callResponse := CallOpenAIResponse{
		Content:      content,
		Model:        response.Model,
		TokensUsed:   response.Usage.TotalTokens,
		Temperature:  req.Temperature,
		ResponseType: req.ResponseFormat,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(callResponse)
}

// TestOpenAIConfig godoc
// @Summary Test an OpenAI configuration
// @Description Test an OpenAI configuration by making a simple API call
// @Tags openai
// @Accept json
// @Produce json
// @Param config body OpenAIConfigRequest true "OpenAI configuration to test"
// @Success 200 {object} TestOpenAIConfigResponse
// @Failure 400 {string} string "Bad Request"
// @Failure 500 {string} string "Internal Server Error"
// @Router /api/openai/test-config [post]
func (h *OpenAIHandler) TestOpenAIConfig(w http.ResponseWriter, r *http.Request) {
	var req OpenAIConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Create a temporary config for testing
	testConfig := &models.OpenAIConfig{
		Name:        req.Name,
		ChannelType: models.AIChannelType(req.ChannelType),
		BaseURL:     req.BaseURL,
		APIKey:      req.APIKey,
		Model:       req.Model,
		Headers:     models.JSONMap(req.Headers),
		IsActive:    true, // Temporarily set as active for testing
	}

	// Create AI provider based on channel type
	aiProvider := services.NewAIProvider(testConfig)

	// Prepare a simple test message
	testMessages := []services.Message{
		{Role: "system", Content: "You are a helpful assistant. Please respond with a simple greeting."},
		{Role: "user", Content: "Hello, this is a test message. Please respond briefly."},
	}

	// Start timing
	startTime := time.Now()

	// Call AI with minimal tokens
	response, err := aiProvider.CallAI(testMessages, 50, 0.7)
	if err != nil {
		// Return error response
		testResponse := TestOpenAIConfigResponse{
			Success:      false,
			Message:      fmt.Sprintf("Failed to connect to AI service: %v", err),
			ResponseTime: time.Since(startTime).Milliseconds(),
			ChannelType:  string(req.ChannelType),
			Model:        req.Model,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(testResponse)
		return
	}

	// Extract content from response
	content := ""
	if len(response.Choices) > 0 {
		content = response.Choices[0].Message.Content
	}

	// Return success response
	testResponse := TestOpenAIConfigResponse{
		Success:      true,
		Message:      "Configuration test successful",
		Response:     content,
		ResponseTime: time.Since(startTime).Milliseconds(),
		ChannelType:  string(req.ChannelType),
		Model:        response.Model,
		TokensUsed:   response.Usage.TotalTokens,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(testResponse)
}
