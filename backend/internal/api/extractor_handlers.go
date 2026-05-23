package api

import (
	"encoding/json"
	"fmt"
	"mailman/internal/database"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
)

// TestExtractorTemplateHandler tests an extractor template with a specific email or custom email content
// @Summary Test extractor template
// @Description Test an extractor template with a specific email or custom email content
// @Tags extractor-templates
// @Accept json
// @Produce json
// @Param id path int true "Template ID"
// @Param request body TestExtractorTemplateRequest true "Test request"
// @Success 200 {array} TestExtractorResult "Test results"
// @Failure 400 {object} ErrorResponse "Bad request"
// @Failure 404 {object} ErrorResponse "Template not found"
// @Failure 500 {object} ErrorResponse "Internal server error"
// @Router /api/extractor-templates/{id}/test [post]
func (h *APIHandler) TestExtractorTemplateHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	var req TestExtractorTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Get the template
	templateRepo := repository.NewExtractorTemplateRepository(database.GetDB())
	template, err := templateRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}

	// Prepare extractors
	extractors := req.Extractors
	if len(extractors) == 0 {
		// Use template extractors if none provided
		for _, ext := range template.Extractors {
			extractors = append(extractors, ExtractorConfig{
				Field: ext.Field,
				Type:  ext.Type,
				Match: ext.Match,

				Extract: ext.Extract,
			})
		}
	}

	// Get email content
	var emailContent map[string]string
	if req.EmailID != nil {
		// Fetch email from database
		emailRepo := repository.NewEmailRepository(database.GetDB())
		email, err := emailRepo.GetByID(*req.EmailID)
		if err != nil {
			http.Error(w, "Email not found", http.StatusNotFound)
			return
		}
		emailContent = map[string]string{
			"from":      strings.Join(email.From, ", "),
			"to":        strings.Join(email.To, ", "),
			"cc":        strings.Join(email.Cc, ", "),
			"subject":   email.Subject,
			"body":      email.Body,
			"html_body": email.HTMLBody,
		}
	} else if req.CustomEmail != nil {
		// Use custom email content
		emailContent = map[string]string{
			"from":      req.CustomEmail.From,
			"to":        req.CustomEmail.To,
			"cc":        req.CustomEmail.Cc,
			"subject":   req.CustomEmail.Subject,
			"body":      req.CustomEmail.Body,
			"html_body": req.CustomEmail.HTMLBody,
		}
	} else {
		http.Error(w, "Either email_id or custom_email must be provided", http.StatusBadRequest)
		return
	}

	// Test each extractor
	results := []TestExtractorResult{}
	extractorService := services.NewExtractorService()

	for _, extractor := range extractors {
		result := TestExtractorResult{
			Field: extractor.Field,
			Type:  extractor.Type,
		}

		// Get the content to extract from
		var content string
		if extractor.Field == "ALL" {
			// Combine all fields
			content = fmt.Sprintf("From: %s\nTo: %s\nCc: %s\nSubject: %s\n\n%s",
				emailContent["from"],
				emailContent["to"],
				emailContent["cc"],
				emailContent["subject"],
				emailContent["body"])
		} else {
			content = emailContent[extractor.Field]
		}

		// Create a temporary email for extraction
		tempEmail := models.Email{
			From:     models.StringSlice{content},
			To:       models.StringSlice{},
			Cc:       models.StringSlice{},
			Subject:  "",
			Body:     "",
			HTMLBody: "",
		}

		// Set the appropriate field based on extractor field
		switch extractor.Field {
		case "from":
			tempEmail.From = models.StringSlice{content}
		case "to":
			tempEmail.To = models.StringSlice{content}
		case "cc":
			tempEmail.Cc = models.StringSlice{content}
		case "subject":
			tempEmail.Subject = content
		case "body":
			tempEmail.Body = content
		case "html_body":
			tempEmail.HTMLBody = content
		}

		// Extract using the service
		extractResult, err := extractorService.ExtractFromEmail(tempEmail, []services.ExtractorConfig{
			{
				Field: services.ExtractorField(extractor.Field),
				Type:  services.ExtractorType(extractor.Type),
				Match: extractor.Match,

				Extract: extractor.Extract,
			},
		})
		if err != nil {
			result.Error = err.Error()
		} else if extractResult != nil && len(extractResult.Matches) > 0 {
			result.Result = &extractResult.Matches[0]
		}

		results = append(results, result)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

// CreateExtractorTemplateHandler creates a new extractor template
// @Summary Create a new extractor template
// @Description Create a new extractor template for reusable email extraction patterns
// @Tags extractor-templates
// @Accept json
// @Produce json
// @Param request body CreateExtractorTemplateRequest true "Create extractor template request"
// @Success 201 {object} ExtractorTemplateResponse
// @Failure 400 {string} string "Invalid request body"
// @Failure 500 {string} string "Failed to create extractor template"
// @Router /api/extractor-templates [post]
func (h *APIHandler) CreateExtractorTemplateHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	var req CreateExtractorTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validate extractors
	for i, extractor := range req.Extractors {
		if extractor.Field == "" || extractor.Type == "" || extractor.Extract == "" {
			http.Error(w, fmt.Sprintf("Extractor %d is missing required fields", i), http.StatusBadRequest)
			return
		}

		// Validate field values
		validFields := map[string]bool{
			"ALL": true, "from": true, "to": true, "cc": true,
			"subject": true, "body": true, "html_body": true, "headers": true,
		}
		if !validFields[extractor.Field] {
			http.Error(w, fmt.Sprintf("Invalid field '%s' in extractor %d", extractor.Field, i), http.StatusBadRequest)
			return
		}

		// Validate type values
		validTypes := map[string]bool{"regex": true, "js": true, "gotemplate": true}
		if !validTypes[extractor.Type] {
			http.Error(w, fmt.Sprintf("Invalid type '%s' in extractor %d", extractor.Type, i), http.StatusBadRequest)
			return
		}
	}

	// Convert API extractors to model extractors
	var modelExtractors models.ExtractorTemplateConfigs
	for _, apiExtractor := range req.Extractors {
		modelExtractors = append(modelExtractors, models.ExtractorTemplateConfig{
			Field: apiExtractor.Field,
			Type:  apiExtractor.Type,
			Match: apiExtractor.Match,

			Extract: apiExtractor.Extract,
		})
	}

	// Create template
	template := &models.ExtractorTemplate{
		Name:        req.Name,
		Description: req.Description,
		Extractors:  modelExtractors,
		OrgID:       orgID,
	}

	templateRepo := repository.NewExtractorTemplateRepository(database.GetDB())
	if err := templateRepo.Create(template); err != nil {
		http.Error(w, "Failed to create extractor template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Convert to response
	response := ExtractorTemplateResponse{
		ID:          template.ID,
		Name:        template.Name,
		Description: template.Description,
		Extractors:  req.Extractors,
		CreatedAt:   template.CreatedAt,
		UpdatedAt:   template.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// GetExtractorTemplatesHandler retrieves all extractor templates
// @Summary Get all extractor templates
// @Description Get all extractor templates
// @Tags extractor-templates
// @Accept json
// @Produce json
// @Success 200 {array} ExtractorTemplateResponse
// @Failure 500 {string} string "Failed to retrieve extractor templates"
// @Router /api/extractor-templates [get]
func (h *APIHandler) GetExtractorTemplatesHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	templateRepo := repository.NewExtractorTemplateRepository(database.GetDB())
	templates, err := templateRepo.GetAll(orgID)
	if err != nil {
		http.Error(w, "Failed to retrieve extractor templates: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Convert to response
	var response []ExtractorTemplateResponse
	for _, template := range templates {
		var extractors []ExtractorConfig
		for _, extractor := range template.Extractors {
			extractors = append(extractors, ExtractorConfig{
				Field: extractor.Field,
				Type:  extractor.Type,
				Match: extractor.Match,

				Extract: extractor.Extract,
			})
		}

		response = append(response, ExtractorTemplateResponse{
			ID:          template.ID,
			Name:        template.Name,
			Description: template.Description,
			Extractors:  extractors,
			CreatedAt:   template.CreatedAt,
			UpdatedAt:   template.UpdatedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetExtractorTemplateHandler retrieves a specific extractor template
// @Summary Get an extractor template by ID
// @Description Get an extractor template by ID
// @Tags extractor-templates
// @Accept json
// @Produce json
// @Param id path int true "Extractor Template ID"
// @Success 200 {object} ExtractorTemplateResponse
// @Failure 400 {string} string "Invalid template ID"
// @Failure 404 {string} string "Extractor template not found"
// @Router /api/extractor-templates/{id} [get]
func (h *APIHandler) GetExtractorTemplateHandler(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	templateRepo := repository.NewExtractorTemplateRepository(database.GetDB())
	template, err := templateRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Convert to response
	var extractors []ExtractorConfig
	for _, extractor := range template.Extractors {
		extractors = append(extractors, ExtractorConfig{
			Field: extractor.Field,
			Type:  extractor.Type,
			Match: extractor.Match,

			Extract: extractor.Extract,
		})
	}

	response := ExtractorTemplateResponse{
		ID:          template.ID,
		Name:        template.Name,
		Description: template.Description,
		Extractors:  extractors,
		CreatedAt:   template.CreatedAt,
		UpdatedAt:   template.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// UpdateExtractorTemplateHandler updates an existing extractor template
// @Summary Update an extractor template
// @Description Update an existing extractor template
// @Tags extractor-templates
// @Accept json
// @Produce json
// @Param id path int true "Extractor Template ID"
// @Param request body UpdateExtractorTemplateRequest true "Update extractor template request"
// @Success 200 {object} ExtractorTemplateResponse
// @Failure 400 {string} string "Invalid request"
// @Failure 404 {string} string "Extractor template not found"
// @Failure 500 {string} string "Failed to update extractor template"
// @Router /api/extractor-templates/{id} [put]
func (h *APIHandler) UpdateExtractorTemplateHandler(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	var req UpdateExtractorTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	templateRepo := repository.NewExtractorTemplateRepository(database.GetDB())
	template, err := templateRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Update fields if provided
	if req.Name != "" {
		template.Name = req.Name
	}
	if req.Description != "" {
		template.Description = req.Description
	}
	if len(req.Extractors) > 0 {
		// Validate extractors
		for i, extractor := range req.Extractors {
			if extractor.Field == "" || extractor.Type == "" || extractor.Extract == "" {
				http.Error(w, fmt.Sprintf("Extractor %d is missing required fields", i), http.StatusBadRequest)
				return
			}

			// Validate field values
			validFields := map[string]bool{
				"ALL": true, "from": true, "to": true, "cc": true,
				"subject": true, "body": true, "html_body": true, "headers": true,
			}
			if !validFields[extractor.Field] {
				http.Error(w, fmt.Sprintf("Invalid field '%s' in extractor %d", extractor.Field, i), http.StatusBadRequest)
				return
			}

			// Validate type values
			validTypes := map[string]bool{"regex": true, "js": true, "gotemplate": true}
			if !validTypes[extractor.Type] {
				http.Error(w, fmt.Sprintf("Invalid type '%s' in extractor %d", extractor.Type, i), http.StatusBadRequest)
				return
			}
		}

		// Convert API extractors to model extractors
		var modelExtractors models.ExtractorTemplateConfigs
		for _, apiExtractor := range req.Extractors {
			modelExtractors = append(modelExtractors, models.ExtractorTemplateConfig{
				Field: apiExtractor.Field,
				Type:  apiExtractor.Type,
				Match: apiExtractor.Match,

				Extract: apiExtractor.Extract,
			})
		}
		template.Extractors = modelExtractors
	}

	if err := templateRepo.Update(template); err != nil {
		http.Error(w, "Failed to update extractor template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Convert to response
	var extractors []ExtractorConfig
	for _, extractor := range template.Extractors {
		extractors = append(extractors, ExtractorConfig{
			Field: extractor.Field,
			Type:  extractor.Type,
			Match: extractor.Match,

			Extract: extractor.Extract,
		})
	}

	response := ExtractorTemplateResponse{
		ID:          template.ID,
		Name:        template.Name,
		Description: template.Description,
		Extractors:  extractors,
		CreatedAt:   template.CreatedAt,
		UpdatedAt:   template.UpdatedAt,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteExtractorTemplateHandler deletes an extractor template
// @Summary Delete an extractor template
// @Description Delete an extractor template by ID
// @Tags extractor-templates
// @Accept json
// @Produce json
// @Param id path int true "Extractor Template ID"
// @Success 204 {string} string "No Content"
// @Failure 400 {string} string "Invalid template ID"
// @Failure 500 {string} string "Failed to delete extractor template"
// @Router /api/extractor-templates/{id} [delete]
func (h *APIHandler) DeleteExtractorTemplateHandler(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	templateRepo := repository.NewExtractorTemplateRepository(database.GetDB())
	if err := templateRepo.Delete(uint(id)); err != nil {
		http.Error(w, "Failed to delete extractor template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetExtractorTemplatesPaginatedHandler retrieves extractor templates with pagination and search
// @Summary Get extractor templates with pagination
// @Description Get extractor templates with pagination support and name search
// @Tags extractor-templates
// @Accept json
// @Produce json
// @Param page query int false "Page number (default: 1)"
// @Param limit query int false "Items per page (default: 10)"
// @Param sort_by query string false "Sort field (default: created_at)"
// @Param sort_order query string false "Sort order: asc or desc (default: desc)"
// @Param search query string false "Search term for template name"
// @Success 200 {object} PaginatedExtractorTemplatesResponse
// @Failure 500 {string} string "Failed to retrieve extractor templates"
// @Router /api/extractor-templates/paginated [get]
func (h *APIHandler) GetExtractorTemplatesPaginatedHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	// 解析查询参数
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

	// 获取分页数据
	templateRepo := repository.NewExtractorTemplateRepository(database.GetDB())
	templates, total, err := templateRepo.GetAllPaginated(page, limit, sortBy, sortOrder, search, orgID)
	if err != nil {
		http.Error(w, "Failed to retrieve extractor templates: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 计算总页数
	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	// 转换为响应格式
	var responseTemplates []ExtractorTemplateResponse
	for _, template := range templates {
		// 转换 ExtractorTemplateConfigs 到 []ExtractorConfig
		var extractors []ExtractorConfig
		for _, ec := range template.Extractors {
			extractors = append(extractors, ExtractorConfig{
				Field: ec.Field,
				Type:  ec.Type,
				Match: ec.Match,

				Extract: ec.Extract,
			})
		}

		responseTemplates = append(responseTemplates, ExtractorTemplateResponse{
			ID:          template.ID,
			Name:        template.Name,
			Description: template.Description,
			Extractors:  extractors,
			CreatedAt:   template.CreatedAt,
			UpdatedAt:   template.UpdatedAt,
		})
	}

	// 构建响应
	response := PaginatedExtractorTemplatesResponse{
		Data:       responseTemplates,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
