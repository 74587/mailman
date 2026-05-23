package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"mailman/internal/database"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"github.com/gorilla/mux"
)

// ExtractorTemplateV2Handler 取件模板V2 API处理器
type ExtractorTemplateV2Handler struct {
	templateRepo *repository.ExtractorTemplateV2Repository
	logRepo      *repository.ExtractionLogV2Repository
	emailRepo    *repository.EmailRepository
	extractorSvc *services.ExtractorServiceV2
}

// NewExtractorTemplateV2Handler 创建新的取件模板V2处理器
func NewExtractorTemplateV2Handler(db *database.Config) *ExtractorTemplateV2Handler {
	dbConn := database.GetDB()
	return &ExtractorTemplateV2Handler{
		templateRepo: repository.NewExtractorTemplateV2Repository(dbConn),
		logRepo:      repository.NewExtractionLogV2Repository(dbConn),
		emailRepo:    repository.NewEmailRepository(dbConn),
		extractorSvc: services.NewExtractorServiceV2(dbConn),
	}
}

// ========== Request/Response Types ==========

// CreateExtractorTemplateV2Request 创建取件模板请求
type CreateExtractorTemplateV2Request struct {
	Name         string                       `json:"name"`
	Description  string                       `json:"description,omitempty"`
	Enabled      bool                         `json:"enabled"`
	Expressions  models.TriggerExpressions    `json:"expressions"`
	Actions      models.TriggerActions        `json:"actions"`
	OutputConfig models.ExtractorOutputConfig `json:"outputConfig"`
	Category     string                       `json:"category,omitempty"`
	Tags         []string                     `json:"tags,omitempty"`
}

// UpdateExtractorTemplateV2Request 更新取件模板请求
type UpdateExtractorTemplateV2Request struct {
	Name         *string                       `json:"name,omitempty"`
	Description  *string                       `json:"description,omitempty"`
	Enabled      *bool                         `json:"enabled,omitempty"`
	Expressions  *models.TriggerExpressions    `json:"expressions,omitempty"`
	Actions      *models.TriggerActions        `json:"actions,omitempty"`
	OutputConfig *models.ExtractorOutputConfig `json:"outputConfig,omitempty"`
	Category     *string                       `json:"category,omitempty"`
	Tags         *[]string                     `json:"tags,omitempty"`
}

// TestExtractorV2Request 测试取件模板请求
type TestExtractorV2Request struct {
	Expressions  models.TriggerExpressions    `json:"expressions"`
	Actions      models.TriggerActions        `json:"actions"`
	OutputConfig models.ExtractorOutputConfig `json:"outputConfig"`
	EmailID      *uint                        `json:"emailId,omitempty"`
	CustomEmail  *CustomEmailContent          `json:"customEmail,omitempty"`
}

// CustomEmailContent 自定义邮件内容
type CustomEmailContent struct {
	From     string            `json:"from"`
	To       string            `json:"to"`
	Cc       string            `json:"cc,omitempty"`
	Subject  string            `json:"subject"`
	Body     string            `json:"body"`
	HTMLBody string            `json:"htmlBody,omitempty"`
	Headers  map[string]string `json:"headers,omitempty"`
}

// ExecuteExtractorV2Request 执行取件模板请求
type ExecuteExtractorV2Request struct {
	EmailID uint `json:"emailId"`
}

// DebugExtractorV2Request 调试取件模板请求
type DebugExtractorV2Request struct {
	Expressions  models.TriggerExpressions    `json:"expressions"`
	Actions      models.TriggerActions        `json:"actions"`
	OutputConfig models.ExtractorOutputConfig `json:"outputConfig"`
	EmailID      *uint                        `json:"emailId,omitempty"`
	CustomEmail  *CustomEmailContent          `json:"customEmail,omitempty"`
	StepByStep   bool                         `json:"stepByStep"`
}

// ExtractorTemplateV2Response 取件模板响应
type ExtractorTemplateV2Response struct {
	ID                 uint                         `json:"id"`
	Name               string                       `json:"name"`
	Description        string                       `json:"description,omitempty"`
	Enabled            bool                         `json:"enabled"`
	Expressions        models.TriggerExpressions    `json:"expressions"`
	Actions            models.TriggerActions        `json:"actions"`
	OutputConfig       models.ExtractorOutputConfig `json:"outputConfig"`
	Category           string                       `json:"category,omitempty"`
	Tags               []string                     `json:"tags,omitempty"`
	TotalExtractions   int64                        `json:"totalExtractions"`
	SuccessExtractions int64                        `json:"successExtractions"`
	LastExtractedAt    *time.Time                   `json:"lastExtractedAt,omitempty"`
	LastError          string                       `json:"lastError,omitempty"`
	CreatedAt          time.Time                    `json:"createdAt"`
	UpdatedAt          time.Time                    `json:"updatedAt"`
}

// PaginatedExtractorTemplateV2Response 分页响应
type PaginatedExtractorTemplateV2Response struct {
	Templates  []ExtractorTemplateV2Response `json:"templates"`
	Total      int64                         `json:"total"`
	Page       int                           `json:"page"`
	Limit      int                           `json:"limit"`
	TotalPages int                           `json:"totalPages"`
}

// toResponse 转换为响应对象
func toExtractorTemplateV2Response(t *models.ExtractorTemplateV2) ExtractorTemplateV2Response {
	return ExtractorTemplateV2Response{
		ID:                 t.ID,
		Name:               t.Name,
		Description:        t.Description,
		Enabled:            t.Enabled,
		Expressions:        t.Expressions,
		Actions:            t.Actions,
		OutputConfig:       t.OutputConfig,
		Category:           t.Category,
		Tags:               t.Tags,
		TotalExtractions:   t.TotalExtractions,
		SuccessExtractions: t.SuccessExtractions,
		LastExtractedAt:    t.LastExtractedAt,
		LastError:          t.LastError,
		CreatedAt:          t.CreatedAt,
		UpdatedAt:          t.UpdatedAt,
	}
}

// ========== Handler Methods ==========

// CreateHandler 创建取件模板
// @Summary Create a new extractor template V2
// @Description Create a new extractor template with expressions, actions, and output config
// @Tags extractor-templates-v2
// @Accept json
// @Produce json
// @Param request body CreateExtractorTemplateV2Request true "Create request"
// @Success 201 {object} ExtractorTemplateV2Response
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates [post]
func (h *ExtractorTemplateV2Handler) CreateHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	var req CreateExtractorTemplateV2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 验证必填字段
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	if len(req.Actions) == 0 {
		http.Error(w, "At least one action is required", http.StatusBadRequest)
		return
	}

	// 创建模板
	template := &models.ExtractorTemplateV2{
		Name:         req.Name,
		Description:  req.Description,
		Enabled:      req.Enabled,
		Expressions:  req.Expressions,
		Actions:      req.Actions,
		OutputConfig: req.OutputConfig,
		Category:     req.Category,
		Tags:         req.Tags,
		OrgID:        orgID,
	}

	if err := h.templateRepo.Create(template); err != nil {
		http.Error(w, "Failed to create template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(toExtractorTemplateV2Response(template))
}

// GetAllHandler 获取所有取件模板
// @Summary Get all extractor templates V2
// @Description Get all extractor templates
// @Tags extractor-templates-v2
// @Produce json
// @Success 200 {array} ExtractorTemplateV2Response
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates [get]
func (h *ExtractorTemplateV2Handler) GetAllHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	templates, err := h.templateRepo.GetAll(orgID)
	if err != nil {
		http.Error(w, "Failed to get templates: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var response []ExtractorTemplateV2Response
	for _, t := range templates {
		response = append(response, toExtractorTemplateV2Response(&t))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetPaginatedHandler 分页获取取件模板
// @Summary Get paginated extractor templates V2
// @Description Get extractor templates with pagination and filtering
// @Tags extractor-templates-v2
// @Produce json
// @Param page query int false "Page number" default(1)
// @Param limit query int false "Items per page" default(10)
// @Param search query string false "Search term"
// @Param category query string false "Category filter"
// @Param enabled query bool false "Enabled filter"
// @Success 200 {object} PaginatedExtractorTemplateV2Response
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/paginated [get]
func (h *ExtractorTemplateV2Handler) GetPaginatedHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	// 解析查询参数
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 10
	}
	search := r.URL.Query().Get("search")
	category := r.URL.Query().Get("category")

	var enabled *bool
	if enabledStr := r.URL.Query().Get("enabled"); enabledStr != "" {
		e := enabledStr == "true"
		enabled = &e
	}

	templates, total, err := h.templateRepo.GetPaginated(page, limit, search, category, enabled, orgID)
	if err != nil {
		http.Error(w, "Failed to get templates: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var templateResponses []ExtractorTemplateV2Response
	for _, t := range templates {
		templateResponses = append(templateResponses, toExtractorTemplateV2Response(&t))
	}

	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	response := PaginatedExtractorTemplateV2Response{
		Templates:  templateResponses,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetByIDHandler 根据ID获取取件模板
// @Summary Get an extractor template V2 by ID
// @Description Get a specific extractor template by its ID
// @Tags extractor-templates-v2
// @Produce json
// @Param id path int true "Template ID"
// @Success 200 {object} ExtractorTemplateV2Response
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/{id} [get]
func (h *ExtractorTemplateV2Handler) GetByIDHandler(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	template, err := h.templateRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(toExtractorTemplateV2Response(template))
}

// UpdateHandler 更新取件模板
// @Summary Update an extractor template V2
// @Description Update an existing extractor template
// @Tags extractor-templates-v2
// @Accept json
// @Produce json
// @Param id path int true "Template ID"
// @Param request body UpdateExtractorTemplateV2Request true "Update request"
// @Success 200 {object} ExtractorTemplateV2Response
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/{id} [put]
func (h *ExtractorTemplateV2Handler) UpdateHandler(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	template, err := h.templateRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}

	var req UpdateExtractorTemplateV2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 更新字段
	if req.Name != nil {
		template.Name = *req.Name
	}
	if req.Description != nil {
		template.Description = *req.Description
	}
	if req.Enabled != nil {
		template.Enabled = *req.Enabled
	}
	if req.Expressions != nil {
		template.Expressions = *req.Expressions
	}
	if req.Actions != nil {
		template.Actions = *req.Actions
	}
	if req.OutputConfig != nil {
		template.OutputConfig = *req.OutputConfig
	}
	if req.Category != nil {
		template.Category = *req.Category
	}
	if req.Tags != nil {
		template.Tags = *req.Tags
	}

	if err := h.templateRepo.Update(template); err != nil {
		http.Error(w, "Failed to update template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(toExtractorTemplateV2Response(template))
}

// DeleteHandler 删除取件模板
// @Summary Delete an extractor template V2
// @Description Delete an extractor template by ID
// @Tags extractor-templates-v2
// @Param id path int true "Template ID"
// @Success 204 "No Content"
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/{id} [delete]
func (h *ExtractorTemplateV2Handler) DeleteHandler(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	// 检查是否存在
	if _, err := h.templateRepo.GetByID(uint(id)); err != nil {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}

	if err := h.templateRepo.Delete(uint(id)); err != nil {
		http.Error(w, "Failed to delete template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// TestHandler 测试取件模板
// @Summary Test an extractor template V2
// @Description Test an extractor template with expressions and actions without saving
// @Tags extractor-templates-v2
// @Accept json
// @Produce json
// @Param request body TestExtractorV2Request true "Test request"
// @Success 200 {object} models.ExtractionResult
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/test [post]
func (h *ExtractorTemplateV2Handler) TestHandler(w http.ResponseWriter, r *http.Request) {
	var req TestExtractorV2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 验证必须有邮件数据
	if req.EmailID == nil && req.CustomEmail == nil {
		http.Error(w, "Either emailId or customEmail must be provided", http.StatusBadRequest)
		return
	}

	// 获取邮件数据
	var email *models.Email
	if req.EmailID != nil {
		var err error
		email, err = h.emailRepo.GetByID(*req.EmailID)
		if err != nil {
			http.Error(w, "Email not found", http.StatusNotFound)
			return
		}
	} else {
		// 从自定义内容创建临时邮件对象
		email = &models.Email{
			From:     models.StringSlice{req.CustomEmail.From},
			To:       models.StringSlice{req.CustomEmail.To},
			Subject:  req.CustomEmail.Subject,
			Body:     req.CustomEmail.Body,
			HTMLBody: req.CustomEmail.HTMLBody,
		}
		if req.CustomEmail.Cc != "" {
			email.Cc = models.StringSlice{req.CustomEmail.Cc}
		}
		if req.CustomEmail.Headers != nil {
			email.Headers = models.JSONMap(req.CustomEmail.Headers)
		}
	}

	// 创建临时模板
	template := &models.ExtractorTemplateV2{
		Expressions:  req.Expressions,
		Actions:      req.Actions,
		OutputConfig: req.OutputConfig,
	}

	// 执行测试
	result, err := h.extractorSvc.TestExtraction(template, email)
	if err != nil {
		http.Error(w, "Test execution failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// ExecuteHandler 执行取件模板
// @Summary Execute an extractor template V2
// @Description Execute an extractor template on a specific email
// @Tags extractor-templates-v2
// @Accept json
// @Produce json
// @Param id path int true "Template ID"
// @Param request body ExecuteExtractorV2Request true "Execute request"
// @Success 200 {object} models.ExtractionResult
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/{id}/execute [post]
func (h *ExtractorTemplateV2Handler) ExecuteHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	var req ExecuteExtractorV2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.EmailID == 0 {
		http.Error(w, "Email ID is required", http.StatusBadRequest)
		return
	}

	// 执行提取
	result, err := h.extractorSvc.Execute(uint(id), req.EmailID)
	if err != nil {
		http.Error(w, "Execution failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// DebugHandler 调试取件模板
// @Summary Debug an extractor template V2
// @Description Debug an extractor template with detailed step-by-step execution
// @Tags extractor-templates-v2
// @Accept json
// @Produce json
// @Param request body DebugExtractorV2Request true "Debug request"
// @Success 200 {object} models.DebugExtractionResult
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/debug [post]
func (h *ExtractorTemplateV2Handler) DebugHandler(w http.ResponseWriter, r *http.Request) {
	var req DebugExtractorV2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 验证必须有邮件数据
	if req.EmailID == nil && req.CustomEmail == nil {
		http.Error(w, "Either emailId or customEmail must be provided", http.StatusBadRequest)
		return
	}

	// 获取邮件数据
	var email *models.Email
	if req.EmailID != nil {
		var err error
		email, err = h.emailRepo.GetByID(*req.EmailID)
		if err != nil {
			http.Error(w, "Email not found", http.StatusNotFound)
			return
		}
	} else {
		// 从自定义内容创建临时邮件对象
		email = &models.Email{
			From:     models.StringSlice{req.CustomEmail.From},
			To:       models.StringSlice{req.CustomEmail.To},
			Subject:  req.CustomEmail.Subject,
			Body:     req.CustomEmail.Body,
			HTMLBody: req.CustomEmail.HTMLBody,
		}
		if req.CustomEmail.Cc != "" {
			email.Cc = models.StringSlice{req.CustomEmail.Cc}
		}
		if req.CustomEmail.Headers != nil {
			email.Headers = models.JSONMap(req.CustomEmail.Headers)
		}
	}

	// 创建临时模板
	template := &models.ExtractorTemplateV2{
		Expressions:  req.Expressions,
		Actions:      req.Actions,
		OutputConfig: req.OutputConfig,
	}

	// 执行调试
	result, err := h.extractorSvc.DebugExtraction(template, email)
	if err != nil {
		http.Error(w, "Debug execution failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// GetLogsHandler 获取提取日志
// @Summary Get extraction logs for a template
// @Description Get extraction execution logs for a specific template
// @Tags extractor-templates-v2
// @Produce json
// @Param id path int true "Template ID"
// @Param page query int false "Page number" default(1)
// @Param limit query int false "Items per page" default(20)
// @Success 200 {object} map[string]interface{}
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/{id}/logs [get]
func (h *ExtractorTemplateV2Handler) GetLogsHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}

	logs, total, err := h.logRepo.GetByTemplateID(uint(id), page, limit)
	if err != nil {
		http.Error(w, "Failed to get logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	response := map[string]interface{}{
		"logs":       logs,
		"total":      total,
		"page":       page,
		"limit":      limit,
		"totalPages": totalPages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetStatsHandler 获取模板统计数据
// @Summary Get statistics for a template
// @Description Get extraction statistics for a specific template
// @Tags extractor-templates-v2
// @Produce json
// @Param id path int true "Template ID"
// @Success 200 {object} map[string]int64
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/{id}/stats [get]
func (h *ExtractorTemplateV2Handler) GetStatsHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid template ID", http.StatusBadRequest)
		return
	}

	stats, err := h.logRepo.GetStats(uint(id))
	if err != nil {
		http.Error(w, "Failed to get stats: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// GetCategoriesHandler 获取所有分类
// @Summary Get all categories
// @Description Get all categories used in extractor templates
// @Tags extractor-templates-v2
// @Produce json
// @Success 200 {array} string
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/categories [get]
func (h *ExtractorTemplateV2Handler) GetCategoriesHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	categories, err := h.templateRepo.GetCategories(orgID)
	if err != nil {
		http.Error(w, "Failed to get categories: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(categories)
}

// MatchEmailsHandler 查找匹配邮件的取件模板
// @Summary Find matching templates for an email
// @Description Find all extractor templates that match a specific email's filter conditions
// @Tags extractor-templates-v2
// @Produce json
// @Param emailId query int true "Email ID"
// @Success 200 {array} ExtractorTemplateV2Response
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/extractor-templates/match [get]
func (h *ExtractorTemplateV2Handler) MatchEmailsHandler(w http.ResponseWriter, r *http.Request) {
	emailIDStr := r.URL.Query().Get("emailId")
	if emailIDStr == "" {
		http.Error(w, "Email ID is required", http.StatusBadRequest)
		return
	}

	emailID, err := strconv.ParseUint(emailIDStr, 10, 32)
	if err != nil {
		http.Error(w, "Invalid email ID", http.StatusBadRequest)
		return
	}

	// 获取邮件
	email, err := h.emailRepo.GetByID(uint(emailID))
	if err != nil {
		http.Error(w, "Email not found", http.StatusNotFound)
		return
	}

	// 获取所有启用的模板
	orgID := GetCurrentOrgID(r)
	templates, err := h.templateRepo.GetEnabled(orgID)
	if err != nil {
		http.Error(w, "Failed to get templates: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 找出匹配的模板
	var matchedTemplates []ExtractorTemplateV2Response
	for _, t := range templates {
		matched, _ := h.extractorSvc.EvaluateFilter(&t, email)
		if matched {
			matchedTemplates = append(matchedTemplates, toExtractorTemplateV2Response(&t))
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(matchedTemplates)
}

// RegisterExtractorTemplateV2Routes 注册取件模板V2路由
func RegisterExtractorTemplateV2Routes(router *mux.Router, handler *ExtractorTemplateV2Handler) {
	// 基础CRUD
	router.HandleFunc("/v2/extractor-templates", handler.GetAllHandler).Methods("GET")
	router.HandleFunc("/v2/extractor-templates", handler.CreateHandler).Methods("POST")
	router.HandleFunc("/v2/extractor-templates/paginated", handler.GetPaginatedHandler).Methods("GET")
	router.HandleFunc("/v2/extractor-templates/categories", handler.GetCategoriesHandler).Methods("GET")
	router.HandleFunc("/v2/extractor-templates/test", handler.TestHandler).Methods("POST")
	router.HandleFunc("/v2/extractor-templates/debug", handler.DebugHandler).Methods("POST")
	router.HandleFunc("/v2/extractor-templates/match", handler.MatchEmailsHandler).Methods("GET")
	router.HandleFunc("/v2/extractor-templates/{id}", handler.GetByIDHandler).Methods("GET")
	router.HandleFunc("/v2/extractor-templates/{id}", handler.UpdateHandler).Methods("PUT")
	router.HandleFunc("/v2/extractor-templates/{id}", handler.DeleteHandler).Methods("DELETE")
	router.HandleFunc("/v2/extractor-templates/{id}/execute", handler.ExecuteHandler).Methods("POST")
	router.HandleFunc("/v2/extractor-templates/{id}/logs", handler.GetLogsHandler).Methods("GET")
	router.HandleFunc("/v2/extractor-templates/{id}/stats", handler.GetStatsHandler).Methods("GET")
}
