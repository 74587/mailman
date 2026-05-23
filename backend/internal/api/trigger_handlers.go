package api

import (
	"encoding/json"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"mailman/internal/triggerv2/engine"
	triggerv2models "mailman/internal/triggerv2/models"
	"mailman/internal/triggerv2/plugins"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// TriggerAPIHandler 触发器API处理器
type TriggerAPIHandler struct {
	triggerService *services.TriggerService
	triggerRepo    *repository.TriggerRepository
	logRepo        *repository.TriggerExecutionLogRepository
	activityLogger *services.ActivityLogger
	pluginManager  plugins.PluginManager
}

// TriggerV2 Expression结构 - 对应前端Expression接口
type TriggerExpression struct {
	ID         string                 `json:"id,omitempty"`
	Type       string                 `json:"type"`
	Operator   string                 `json:"operator,omitempty"`
	Field      string                 `json:"field,omitempty"`
	Value      interface{}            `json:"value,omitempty"`
	Conditions []TriggerExpression    `json:"conditions,omitempty"`
	PluginID   string                 `json:"pluginId,omitempty"`
	Fields     map[string]interface{} `json:"fields,omitempty"`
	Not        bool                   `json:"not,omitempty"`
}

// TriggerV2 Action结构 - 对应前端Action接口
type TriggerAction struct {
	ID             string                 `json:"id"`
	PluginID       string                 `json:"pluginId"`
	PluginName     string                 `json:"pluginName"`
	Config         map[string]interface{} `json:"config"`
	Enabled        bool                   `json:"enabled"`
	ExecutionOrder int                    `json:"executionOrder"`
}

// NewTriggerAPIHandler 创建触发器API处理器
func NewTriggerAPIHandler(
	triggerService *services.TriggerService,
	triggerRepo *repository.TriggerRepository,
	logRepo *repository.TriggerExecutionLogRepository,
	pluginManager plugins.PluginManager,
) *TriggerAPIHandler {
	return &TriggerAPIHandler{
		triggerService: triggerService,
		triggerRepo:    triggerRepo,
		logRepo:        logRepo,
		activityLogger: services.GetActivityLogger(),
		pluginManager:  pluginManager,
	}
}

// CreateTriggerV2Request 创建TriggerV2请求
type CreateTriggerV2Request struct {
	Name        string              `json:"name"`
	Description string              `json:"description,omitempty"`
	Enabled     bool                `json:"enabled"`
	Expressions []TriggerExpression `json:"expressions"`
	Actions     []TriggerAction     `json:"actions"`
}

// UpdateTriggerV2Request 更新TriggerV2请求
type UpdateTriggerV2Request struct {
	Name        *string             `json:"name,omitempty"`
	Description *string             `json:"description,omitempty"`
	Enabled     *bool               `json:"enabled,omitempty"`
	Expressions []TriggerExpression `json:"expressions,omitempty"`
	Actions     []TriggerAction     `json:"actions,omitempty"`
}

// TriggerV2Response TriggerV2响应
type TriggerV2Response struct {
	ID                 uint                   `json:"id"`
	Name               string                 `json:"name"`
	Description        string                 `json:"description"`
	Enabled            bool                   `json:"enabled"`
	Expressions        []TriggerExpression    `json:"expressions"`
	Actions            []TriggerAction        `json:"actions"`
	TotalExecutions    int64                  `json:"totalExecutions"`
	SuccessExecutions  int64                  `json:"successExecutions"`
	LastExecutedAt     *time.Time             `json:"lastExecutedAt,omitempty"`
	LastError          string                 `json:"lastError,omitempty"`
	CreatedAt          time.Time              `json:"createdAt"`
	UpdatedAt          time.Time              `json:"updatedAt"`
	SubscriptionStatus map[string]interface{} `json:"subscriptionStatus,omitempty"`
}

// 保持向后兼容的旧版本结构体
// CreateTriggerRequest 创建触发器请求 (Legacy)
type CreateTriggerRequest struct {
	Name          string                        `json:"name"`
	Description   string                        `json:"description,omitempty"`
	CheckInterval int                           `json:"check_interval"`
	EmailAddress  string                        `json:"email_address,omitempty"`
	Subject       string                        `json:"subject,omitempty"`
	From          string                        `json:"from,omitempty"`
	To            string                        `json:"to,omitempty"`
	HasAttachment *bool                         `json:"has_attachment,omitempty"`
	Unread        *bool                         `json:"unread,omitempty"`
	Labels        []string                      `json:"labels,omitempty"`
	Folders       []string                      `json:"folders,omitempty"`
	CustomFilters map[string]string             `json:"custom_filters,omitempty"`
	Condition     models.TriggerConditionConfig `json:"condition"`
	Actions       []models.TriggerActionConfig  `json:"actions"`
	EnableLogging bool                          `json:"enable_logging"`
	Status        models.TriggerStatus          `json:"status"`
}

// UpdateTriggerRequest 更新触发器请求 (Legacy)
type UpdateTriggerRequest struct {
	Name          *string                        `json:"name,omitempty"`
	Description   *string                        `json:"description,omitempty"`
	CheckInterval *int                           `json:"check_interval,omitempty"`
	EmailAddress  *string                        `json:"email_address,omitempty"`
	Subject       *string                        `json:"subject,omitempty"`
	From          *string                        `json:"from,omitempty"`
	To            *string                        `json:"to,omitempty"`
	HasAttachment *bool                          `json:"has_attachment,omitempty"`
	Unread        *bool                          `json:"unread,omitempty"`
	Labels        []string                       `json:"labels,omitempty"`
	Folders       []string                       `json:"folders,omitempty"`
	CustomFilters map[string]string              `json:"custom_filters,omitempty"`
	Condition     *models.TriggerConditionConfig `json:"condition,omitempty"`
	Actions       []models.TriggerActionConfig   `json:"actions,omitempty"`
	EnableLogging *bool                          `json:"enable_logging,omitempty"`
	Status        *models.TriggerStatus          `json:"status,omitempty"`
}

// TriggerResponse 触发器响应 (Legacy)
type TriggerResponse struct {
	*models.EmailTrigger
	WorkerStatus map[string]interface{} `json:"worker_status,omitempty"`
}

// PaginatedTriggerV2Response 分页TriggerV2响应
type PaginatedTriggerV2Response struct {
	Data       []TriggerV2Response `json:"data"`
	Total      int64               `json:"total"`
	Page       int                 `json:"page"`
	Limit      int                 `json:"limit"`
	TotalPages int                 `json:"total_pages"`
}

// PaginatedTriggersResponse 分页触发器响应 (Legacy)
type PaginatedTriggersResponse struct {
	Data       []TriggerResponse `json:"data"`
	Total      int64             `json:"total"`
	Page       int               `json:"page"`
	Limit      int               `json:"limit"`
	TotalPages int               `json:"total_pages"`
}

// CreateTriggerHandler 创建触发器
// @Summary Create a new email trigger
// @Description Create a new email trigger with conditions and actions
// @Tags triggers
// @Accept json
// @Produce json
// @Param request body CreateTriggerRequest true "Create trigger request"
// @Success 201 {object} TriggerResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers [post]
func (h *TriggerAPIHandler) CreateTriggerHandler(w http.ResponseWriter, r *http.Request) {
	var req CreateTriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 验证必填字段
	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}
	if req.CheckInterval <= 0 {
		req.CheckInterval = 30 // 默认30秒
	}
	if len(req.Actions) == 0 {
		http.Error(w, "At least one action is required", http.StatusBadRequest)
		return
	}

	// 创建触发器模型
	trigger := &models.EmailTrigger{
		Name:          req.Name,
		Description:   req.Description,
		Status:        req.Status,
		CheckInterval: req.CheckInterval,
		EmailAddress:  req.EmailAddress,
		Subject:       req.Subject,
		From:          req.From,
		To:            req.To,
		HasAttachment: req.HasAttachment,
		Unread:        req.Unread,
		Labels:        models.StringSlice(req.Labels),
		Folders:       models.StringSlice(req.Folders),
		CustomFilters: req.CustomFilters,
		Condition:     req.Condition,
		Actions:       models.TriggerActionsV1(req.Actions),
		EnableLogging: req.EnableLogging,
	}

	// 创建触发器
	if err := h.triggerService.CreateTrigger(trigger); err != nil {
		http.Error(w, "Failed to create trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityTriggerCreated,
		"创建触发器",
		fmt.Sprintf("创建了触发器 %s", trigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":     trigger.ID,
			"trigger_name":   trigger.Name,
			"check_interval": trigger.CheckInterval,
			"status":         trigger.Status,
		},
	)

	// 构建响应
	response := TriggerResponse{
		EmailTrigger: trigger,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// GetTriggersHandler 获取触发器列表
// @Summary Get triggers with pagination
// @Description Get triggers with pagination and search support
// @Tags triggers
// @Accept json
// @Produce json
// @Param page query int false "Page number (default: 1)"
// @Param limit query int false "Items per page (default: 10)"
// @Param sort_by query string false "Sort field (default: created_at)"
// @Param sort_order query string false "Sort order: asc or desc (default: desc)"
// @Param search query string false "Search term for trigger name"
// @Param status query string false "Filter by status: enabled or disabled"
// @Success 200 {object} PaginatedTriggersResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers [get]
func (h *TriggerAPIHandler) GetTriggersHandler(w http.ResponseWriter, r *http.Request) {
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
	orgID := GetCurrentOrgID(r)
	triggers, total, err := h.triggerRepo.GetAllPaginated(page, limit, sortBy, sortOrder, search, orgID)
	if err != nil {
		http.Error(w, "Failed to retrieve triggers: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取worker状态
	workerStatus := h.triggerService.GetEventSubscriptionStatus()

	// 转换为响应格式
	responseTriggers := make([]TriggerResponse, 0, len(triggers))
	for _, trigger := range triggers {
		response := TriggerResponse{
			EmailTrigger: &trigger,
		}
		if status, exists := workerStatus[trigger.ID]; exists {
			response.WorkerStatus = status
		}
		responseTriggers = append(responseTriggers, response)
	}

	// 计算总页数
	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	// 构建响应
	response := PaginatedTriggersResponse{
		Data:       responseTriggers,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetTriggerHandler 获取单个触发器
// @Summary Get a trigger by ID
// @Description Get a trigger by ID with worker status
// @Tags triggers
// @Accept json
// @Produce json
// @Param id path int true "Trigger ID"
// @Success 200 {object} TriggerResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /api/triggers/{id} [get]
func (h *TriggerAPIHandler) GetTriggerHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	trigger, err := h.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// 获取worker状态
	workerStatus := h.triggerService.GetEventSubscriptionStatus()

	response := TriggerResponse{
		EmailTrigger: trigger,
	}
	if status, exists := workerStatus[trigger.ID]; exists {
		response.WorkerStatus = status
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// UpdateTriggerHandler 更新触发器
// @Summary Update a trigger
// @Description Update a trigger (supports partial updates)
// @Tags triggers
// @Accept json
// @Produce json
// @Param id path int true "Trigger ID"
// @Param request body UpdateTriggerRequest true "Update trigger request"
// @Success 200 {object} TriggerResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers/{id} [put]
func (h *TriggerAPIHandler) UpdateTriggerHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	// 获取现有触发器
	existingTrigger, err := h.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found", http.StatusNotFound)
		return
	}

	var req UpdateTriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 应用部分更新
	if req.Name != nil {
		existingTrigger.Name = *req.Name
	}
	if req.Description != nil {
		existingTrigger.Description = *req.Description
	}
	if req.CheckInterval != nil {
		existingTrigger.CheckInterval = *req.CheckInterval
	}
	if req.EmailAddress != nil {
		existingTrigger.EmailAddress = *req.EmailAddress
	}
	if req.Subject != nil {
		existingTrigger.Subject = *req.Subject
	}
	if req.From != nil {
		existingTrigger.From = *req.From
	}
	if req.To != nil {
		existingTrigger.To = *req.To
	}
	if req.HasAttachment != nil {
		existingTrigger.HasAttachment = req.HasAttachment
	}
	if req.Unread != nil {
		existingTrigger.Unread = req.Unread
	}
	if req.Labels != nil {
		existingTrigger.Labels = models.StringSlice(req.Labels)
	}
	if req.Folders != nil {
		existingTrigger.Folders = models.StringSlice(req.Folders)
	}
	if req.CustomFilters != nil {
		existingTrigger.CustomFilters = req.CustomFilters
	}
	if req.Condition != nil {
		existingTrigger.Condition = *req.Condition
	}
	if req.Actions != nil {
		existingTrigger.Actions = models.TriggerActionsV1(req.Actions)
	}
	if req.EnableLogging != nil {
		existingTrigger.EnableLogging = *req.EnableLogging
	}
	if req.Status != nil {
		existingTrigger.Status = *req.Status
	}

	// 更新触发器
	if err := h.triggerService.UpdateTrigger(existingTrigger); err != nil {
		http.Error(w, "Failed to update trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"更新触发器",
		fmt.Sprintf("更新了触发器 %s", existingTrigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   existingTrigger.ID,
			"trigger_name": existingTrigger.Name,
		},
	)

	// 获取worker状态
	workerStatus := h.triggerService.GetEventSubscriptionStatus()

	response := TriggerResponse{
		EmailTrigger: existingTrigger,
	}
	if status, exists := workerStatus[existingTrigger.ID]; exists {
		response.WorkerStatus = status
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteTriggerHandler 删除触发器
// @Summary Delete a trigger
// @Description Delete a trigger by ID
// @Tags triggers
// @Accept json
// @Produce json
// @Param id path int true "Trigger ID"
// @Success 204 "No Content"
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers/{id} [delete]
func (h *TriggerAPIHandler) DeleteTriggerHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	// 获取触发器信息用于日志记录
	trigger, err := h.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found", http.StatusNotFound)
		return
	}

	// 删除触发器
	if err := h.triggerService.DeleteTrigger(uint(id)); err != nil {
		http.Error(w, "Failed to delete trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
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

// EnableTriggerHandler 启用触发器
// @Summary Enable a trigger
// @Description Enable a trigger by ID
// @Tags triggers
// @Accept json
// @Produce json
// @Param id path int true "Trigger ID"
// @Success 200 {object} TriggerResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers/{id}/enable [post]
func (h *TriggerAPIHandler) EnableTriggerHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	if err := h.triggerService.EnableTrigger(uint(id)); err != nil {
		http.Error(w, "Failed to enable trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取更新后的触发器
	trigger, err := h.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found", http.StatusNotFound)
		return
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"启用触发器",
		fmt.Sprintf("启用了触发器 %s", trigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   trigger.ID,
			"trigger_name": trigger.Name,
		},
	)

	// 获取worker状态
	workerStatus := h.triggerService.GetEventSubscriptionStatus()

	response := TriggerResponse{
		EmailTrigger: trigger,
	}
	if status, exists := workerStatus[trigger.ID]; exists {
		response.WorkerStatus = status
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DisableTriggerHandler 禁用触发器
// @Summary Disable a trigger
// @Description Disable a trigger by ID
// @Tags triggers
// @Accept json
// @Produce json
// @Param id path int true "Trigger ID"
// @Success 200 {object} TriggerResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers/{id}/disable [post]
func (h *TriggerAPIHandler) DisableTriggerHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	if err := h.triggerService.DisableTrigger(uint(id)); err != nil {
		http.Error(w, "Failed to disable trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取更新后的触发器
	trigger, err := h.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found", http.StatusNotFound)
		return
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"禁用触发器",
		fmt.Sprintf("禁用了触发器 %s", trigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   trigger.ID,
			"trigger_name": trigger.Name,
		},
	)

	response := TriggerResponse{
		EmailTrigger: trigger,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetTriggerExecutionLogsHandler 获取触发器执行日志
// @Summary Get trigger execution logs
// @Description Get trigger execution logs with pagination and filtering
// @Tags triggers
// @Accept json
// @Produce json
// @Param id path int false "Trigger ID (optional for global logs)"
// @Param page query int false "Page number (default: 1)"
// @Param limit query int false "Items per page (default: 10)"
// @Param status query string false "Filter by status: success, failed, partial"
// @Param start_date query string false "Start date (RFC3339 format)"
// @Param end_date query string false "End date (RFC3339 format)"
// @Success 200 {object} map[string]interface{}
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers/{id}/logs [get]
// @Router /api/trigger-logs [get]
func (h *TriggerAPIHandler) GetTriggerExecutionLogsHandler(w http.ResponseWriter, r *http.Request) {
	// 解析查询参数
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

	// 解析触发器ID（可选）
	var triggerID *uint
	vars := mux.Vars(r)
	if idStr, exists := vars["id"]; exists && idStr != "" {
		if id, err := strconv.ParseUint(idStr, 10, 32); err == nil {
			triggerIDVal := uint(id)
			triggerID = &triggerIDVal
		}
	}

	// 解析状态过滤
	var status *models.TriggerExecutionStatus
	if statusStr := r.URL.Query().Get("status"); statusStr != "" {
		statusVal := models.TriggerExecutionStatus(statusStr)
		status = &statusVal
	}

	// 解析日期过滤
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

	// 获取执行日志
	orgID := GetCurrentOrgID(r)
	logs, total, err := h.logRepo.GetAllPaginated(page, limit, triggerID, status, startDate, endDate, orgID)
	if err != nil {
		http.Error(w, "Failed to retrieve execution logs: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 计算总页数
	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

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

// GetTriggerStatsHandler 获取触发器统计信息
// @Summary Get trigger statistics
// @Description Get trigger statistics and worker status
// @Tags triggers
// @Accept json
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Failure 500 {object} ErrorResponse
// @Router /api/trigger-stats [get]
func (h *TriggerAPIHandler) GetTriggerStatsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	// 获取触发器总数
	totalCount, err := h.triggerRepo.GetCount(orgID)
	if err != nil {
		http.Error(w, "Failed to get trigger count: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取启用的触发器数量
	enabledCount, err := h.triggerRepo.GetCountByStatus(models.TriggerStatusEnabled, orgID)
	if err != nil {
		http.Error(w, "Failed to get enabled trigger count: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取禁用的触发器数量
	disabledCount, err := h.triggerRepo.GetCountByStatus(models.TriggerStatusDisabled, orgID)
	if err != nil {
		http.Error(w, "Failed to get disabled trigger count: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取worker状态
	workerStatus := h.triggerService.GetEventSubscriptionStatus()
	activeWorkers := len(workerStatus)

	response := map[string]interface{}{
		"total_triggers":    totalCount,
		"enabled_triggers":  enabledCount,
		"disabled_triggers": disabledCount,
		"active_workers":    activeWorkers,
		"worker_status":     workerStatus,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// EvaluateExpressionRequest 评估表达式请求
type EvaluateExpressionRequest struct {
	Expression *engine.ConditionExpression `json:"expression"`
	Data       map[string]interface{}      `json:"data"`
}

// EvaluateExpressionResponse 评估表达式响应
type EvaluateExpressionResponse struct {
	Result bool   `json:"result"`
	Error  string `json:"error,omitempty"`
}

// ExecuteActionRequest 执行动作请求
type ExecuteActionRequest struct {
	PluginID string                 `json:"plugin_id"`
	Config   map[string]interface{} `json:"config"`
	Data     map[string]interface{} `json:"data"`
}

// ExecuteActionResponse 执行动作响应
type ExecuteActionResponse struct {
	Success    bool                   `json:"success"`
	Result     map[string]interface{} `json:"result,omitempty"`
	Error      string                 `json:"error,omitempty"`
	Duration   int64                  `json:"duration_ms"`
	PluginInfo map[string]interface{} `json:"plugin_info,omitempty"`
}

// ExecuteActionsRequest 执行多个动作请求
type ExecuteActionsRequest struct {
	Actions []ExecuteActionRequest `json:"actions"`
	Data    map[string]interface{} `json:"data"`
}

// ExecuteActionsResponse 执行多个动作响应
type ExecuteActionsResponse struct {
	Results []ExecuteActionResponse `json:"results"`
	Summary map[string]interface{}  `json:"summary"`
}

// EvaluateExpressionHandler 评估表达式
// @Summary Evaluate a condition expression
// @Description Evaluate a condition expression with test data
// @Tags triggers
// @Accept json
// @Produce json
// @Param request body EvaluateExpressionRequest true "Expression and test data"
// @Success 200 {object} EvaluateExpressionResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers/evaluate-expression [post]
func (h *TriggerAPIHandler) EvaluateExpressionHandler(w http.ResponseWriter, r *http.Request) {
	var req EvaluateExpressionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 验证表达式
	if req.Expression == nil {
		http.Error(w, "Expression is required", http.StatusBadRequest)
		return
	}

	// 创建条件引擎
	conditionEngine := engine.NewConditionEngine()

	// 将 Data 转换为 JSON
	dataJSON, err := json.Marshal(req.Data)
	if err != nil {
		http.Error(w, "Failed to marshal test data: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 创建评估上下文
	ctx := &engine.EvaluationContext{
		Context: r.Context(),
		Data:    req.Data,
		Event: &triggerv2models.Event{
			Type: "test",
			Data: dataJSON,
		},
	}

	// 评估表达式
	result, err := conditionEngine.Evaluate(req.Expression, ctx)

	response := EvaluateExpressionResponse{
		Result: result,
	}

	if err != nil {
		response.Error = err.Error()
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"评估表达式",
		"测试条件表达式评估",
		userID,
		map[string]interface{}{
			"expression": req.Expression,
			"data":       req.Data,
			"result":     result,
			"error":      err,
		},
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// ExecuteActionHandler 执行单个动作
// @Summary Execute a single action
// @Description Execute a single action with test data
// @Tags triggers
// @Accept json
// @Produce json
// @Param request body ExecuteActionRequest true "Action configuration and test data"
// @Success 200 {object} ExecuteActionResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers/execute-action [post]
func (h *TriggerAPIHandler) ExecuteActionHandler(w http.ResponseWriter, r *http.Request) {
	var req ExecuteActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 验证必要字段
	if req.PluginID == "" {
		http.Error(w, "Plugin ID is required", http.StatusBadRequest)
		return
	}

	// 记录开始时间
	startTime := time.Now()

	// 创建插件上下文
	pluginContext := &plugins.PluginContext{
		Context:  r.Context(),
		PluginID: req.PluginID,
		Config: &plugins.PluginConfig{
			Enabled: true,
			Config:  req.Config,
		},
	}

	// 创建事件对象
	eventDataJSON, err := json.Marshal(req.Data)
	if err != nil {
		http.Error(w, "Failed to marshal event data: "+err.Error(), http.StatusBadRequest)
		return
	}

	event := &triggerv2models.Event{
		Type: "test",
		Data: eventDataJSON,
	}

	// 执行动作
	result, err := h.pluginManager.ExecuteAction(req.PluginID, pluginContext, event)

	// 计算执行时间
	duration := time.Since(startTime).Milliseconds()

	// 构建响应
	response := ExecuteActionResponse{
		Success:  err == nil,
		Duration: duration,
	}

	if err != nil {
		response.Error = err.Error()
	} else if result != nil {
		response.Result = result.Data
	}

	// 获取插件信息
	if plugins, err := h.pluginManager.ListPlugins(); err == nil {
		for _, pluginInfo := range plugins {
			if pluginInfo.ID == req.PluginID {
				response.PluginInfo = map[string]interface{}{
					"id":          pluginInfo.ID,
					"name":        pluginInfo.Name,
					"type":        pluginInfo.Type,
					"description": pluginInfo.Description,
					"version":     pluginInfo.Version,
				}
				break
			}
		}
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"执行动作",
		"测试动作执行",
		userID,
		map[string]interface{}{
			"plugin_id": req.PluginID,
			"config":    req.Config,
			"data":      req.Data,
			"success":   response.Success,
			"duration":  duration,
			"error":     response.Error,
		},
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// ExecuteActionsHandler 执行多个动作
// @Summary Execute multiple actions
// @Description Execute multiple actions sequentially with test data
// @Tags triggers
// @Accept json
// @Produce json
// @Param request body ExecuteActionsRequest true "Actions configuration and test data"
// @Success 200 {object} ExecuteActionsResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/triggers/execute-actions [post]
func (h *TriggerAPIHandler) ExecuteActionsHandler(w http.ResponseWriter, r *http.Request) {
	var req ExecuteActionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 验证动作列表
	if len(req.Actions) == 0 {
		http.Error(w, "At least one action is required", http.StatusBadRequest)
		return
	}

	// 记录开始时间
	startTime := time.Now()

	// 创建事件对象
	var eventType triggerv2models.EventType = "test" // 默认类型

	// 尝试从请求数据中提取事件信息
	if eventData, ok := req.Data["event"].(map[string]interface{}); ok {
		if eventTypeStr, ok := eventData["type"].(string); ok {
			// 转换事件类型格式：email_received -> email.received
			switch eventTypeStr {
			case "email_received":
				eventType = triggerv2models.EventTypeEmailReceived
			case "email_updated":
				eventType = triggerv2models.EventTypeEmailUpdated
			case "email_deleted":
				eventType = triggerv2models.EventTypeEmailDeleted
			default:
				eventType = triggerv2models.EventType(eventTypeStr)
			}
		}
	}

	eventDataJSON, err := json.Marshal(req.Data)
	if err != nil {
		http.Error(w, "Failed to marshal event data: "+err.Error(), http.StatusBadRequest)
		return
	}

	event := &triggerv2models.Event{
		Type: eventType,
		Data: eventDataJSON,
	}

	// 执行所有动作（链式处理）
	results := make([]ExecuteActionResponse, len(req.Actions))
	successCount := 0

	// 当前处理的事件数据（会在动作之间传递）
	currentEvent := event
	var currentEmailData map[string]interface{}

	// 尝试解析初始邮件数据
	if err := json.Unmarshal(currentEvent.Data, &currentEmailData); err == nil {
		// 成功解析
	} else {
		currentEmailData = make(map[string]interface{})
	}

	for i, action := range req.Actions {
		// 验证动作
		if action.PluginID == "" {
			results[i] = ExecuteActionResponse{
				Success:  false,
				Error:    "Plugin ID is required",
				Duration: 0,
			}
			continue
		}

		// 记录单个动作开始时间
		actionStartTime := time.Now()

		// 创建插件上下文
		pluginContext := &plugins.PluginContext{
			Context:  r.Context(),
			PluginID: action.PluginID,
			Config: &plugins.PluginConfig{
				Enabled: true,
				Config:  action.Config,
			},
		}

		// 执行单个动作
		result, err := h.pluginManager.ExecuteAction(action.PluginID, pluginContext, currentEvent)

		// 计算单个动作执行时间
		actionDuration := time.Since(actionStartTime).Milliseconds()

		// 构建单个动作响应
		actionResponse := ExecuteActionResponse{
			Success:  err == nil,
			Duration: actionDuration,
		}

		if err != nil {
			actionResponse.Error = err.Error()
		} else {
			if result != nil {
				actionResponse.Result = result.Data

				// 更新当前事件数据，传递给下一个动作
				if transformedEmail, ok := result.Data["transformed_email"].(map[string]interface{}); ok {
					// 更新邮件数据
					if eventData, ok := currentEmailData["event"].(map[string]interface{}); ok {
						if emailData, ok := eventData["data"].(map[string]interface{}); ok {
							// 更新邮件字段
							for key, value := range transformedEmail {
								emailData[key] = value
							}

							// 重新构建事件数据
							updatedEventData, _ := json.Marshal(currentEmailData)
							currentEvent = &triggerv2models.Event{
								Type: currentEvent.Type,
								Data: updatedEventData,
							}
						}
					}
				}
			}
			successCount++
		}

		// 获取插件信息
		if plugins, err := h.pluginManager.ListPlugins(); err == nil {
			for _, pluginInfo := range plugins {
				if pluginInfo.ID == action.PluginID {
					actionResponse.PluginInfo = map[string]interface{}{
						"id":          pluginInfo.ID,
						"name":        pluginInfo.Name,
						"type":        pluginInfo.Type,
						"description": pluginInfo.Description,
						"version":     pluginInfo.Version,
					}
					break
				}
			}
		}

		results[i] = actionResponse

		// 如果当前动作失败，可以选择是否继续执行后续动作
		// 这里我们选择继续执行，但可以根据需要调整
	}

	// 计算总执行时间
	totalDuration := time.Since(startTime).Milliseconds()

	// 构建总体响应
	response := ExecuteActionsResponse{
		Results: results,
		Summary: map[string]interface{}{
			"total_actions":      len(req.Actions),
			"successful_actions": successCount,
			"failed_actions":     len(req.Actions) - successCount,
			"total_duration":     totalDuration,
		},
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"执行多个动作",
		fmt.Sprintf("执行了%d个动作，成功%d个", len(req.Actions), successCount),
		userID,
		map[string]interface{}{
			"total_actions":      len(req.Actions),
			"successful_actions": successCount,
			"failed_actions":     len(req.Actions) - successCount,
			"total_duration":     totalDuration,
		},
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// ===== TriggerV2 API 处理器 =====

// convertToEmailTrigger 将 TriggerV2 请求转换为 EmailTrigger 模型
func convertToEmailTrigger(req *CreateTriggerV2Request) *models.EmailTrigger {
	status := models.TriggerStatusDisabled
	if req.Enabled {
		status = models.TriggerStatusEnabled
	}

	trigger := &models.EmailTrigger{
		Name:          req.Name,
		Description:   req.Description,
		Status:        status,
		EnableLogging: true, // 默认启用日志
	}

	// 转换表达式为旧版本的条件格式
	if len(req.Expressions) > 0 {
		scripts := make([]string, len(req.Expressions))
		for i, expr := range req.Expressions {
			scripts[i] = generateExpressionScript(&expr)
		}
		script := strings.Join(scripts, " && ")
		trigger.Condition = models.TriggerConditionConfig{
			Type:   "js", // 默认使用JavaScript引擎
			Script: script,
		}
	}

	// 转换动作为旧版本的格式
	if len(req.Actions) > 0 {
		actions := make([]models.TriggerActionConfig, len(req.Actions))
		for i, action := range req.Actions {
			configJSON, _ := json.Marshal(action.Config)
			actions[i] = models.TriggerActionConfig{
				Type:        models.TriggerActionTypeModifyContent,
				Name:        action.PluginName,
				Description: fmt.Sprintf("Plugin: %s", action.PluginName),
				Config:      string(configJSON),
				Enabled:     action.Enabled,
				Order:       action.ExecutionOrder,
			}
		}
		trigger.Actions = models.TriggerActionsV1(actions)
	}

	return trigger
}

// convertExpressionToScript 将表达式转换为脚本
func convertExpressionToScript(expr *TriggerExpression) string {
	if expr == nil {
		return "true"
	}

	script := generateExpressionScript(expr)
	if expr.Not {
		script = fmt.Sprintf("!(%s)", script)
	}

	return script
}

// generateExpressionScript 生成表达式脚本
func generateExpressionScript(expr *TriggerExpression) string {
	switch expr.Type {
	case "simple":
		return generateSimpleExpressionScript(expr)
	case "compound":
		return generateCompoundExpressionScript(expr)
	default:
		return "true"
	}
}

// generateSimpleExpressionScript 生成简单表达式脚本
func generateSimpleExpressionScript(expr *TriggerExpression) string {
	field := expr.Field
	value := expr.Value
	operator := expr.Operator

	switch operator {
	case "equals":
		return fmt.Sprintf(`email.%s === "%s"`, field, value)
	case "not_equals":
		return fmt.Sprintf(`email.%s !== "%s"`, field, value)
	case "contains":
		return fmt.Sprintf(`email.%s && email.%s.includes("%s")`, field, field, value)
	case "not_contains":
		return fmt.Sprintf(`!email.%s || !email.%s.includes("%s")`, field, field, value)
	case "starts_with":
		return fmt.Sprintf(`email.%s && email.%s.startsWith("%s")`, field, field, value)
	case "ends_with":
		return fmt.Sprintf(`email.%s && email.%s.endsWith("%s")`, field, field, value)
	case "regex":
		return fmt.Sprintf(`email.%s && new RegExp("%s").test(email.%s)`, field, value, field)
	case "exists":
		return fmt.Sprintf(`email.%s !== undefined && email.%s !== null`, field, field)
	case "not_exists":
		return fmt.Sprintf(`email.%s === undefined || email.%s === null`, field, field)
	default:
		return "true"
	}
}

// generateCompoundExpressionScript 生成复合表达式脚本
func generateCompoundExpressionScript(expr *TriggerExpression) string {
	if len(expr.Conditions) == 0 {
		return "true"
	}

	scripts := make([]string, len(expr.Conditions))
	for i, condition := range expr.Conditions {
		scripts[i] = generateExpressionScript(&condition)
	}

	switch expr.Operator {
	case "and":
		return "(" + strings.Join(scripts, " && ") + ")"
	case "or":
		return "(" + strings.Join(scripts, " || ") + ")"
	default:
		return strings.Join(scripts, " && ")
	}
}

// convertToTriggerV2Response 将 EmailTrigger 转换为 TriggerV2Response
func convertToTriggerV2Response(trigger *models.EmailTrigger) *TriggerV2Response {
	enabled := trigger.Status == models.TriggerStatusEnabled
	response := &TriggerV2Response{
		ID:                trigger.ID,
		Name:              trigger.Name,
		Description:       trigger.Description,
		Enabled:           enabled,
		TotalExecutions:   trigger.TotalExecutions,
		SuccessExecutions: trigger.SuccessExecutions,
		LastExecutedAt:    trigger.LastExecutedAt,
		LastError:         trigger.LastError,
		CreatedAt:         trigger.CreatedAt,
		UpdatedAt:         trigger.UpdatedAt,
	}

	// 转换表达式
	response.Expressions = []TriggerExpression{*convertScriptToExpression(trigger.Condition.Script)}

	// 转换动作
	response.Actions = make([]TriggerAction, len(trigger.Actions))
	for i, action := range trigger.Actions {
		var config map[string]interface{}
		json.Unmarshal([]byte(action.Config), &config)

		response.Actions[i] = TriggerAction{
			ID:             fmt.Sprintf("%d", i),
			PluginID:       extractPluginIDFromConfig(config),
			PluginName:     action.Name,
			Config:         config,
			Enabled:        action.Enabled,
			ExecutionOrder: action.Order,
		}
	}

	return response
}

// convertScriptToExpression 将脚本转换为表达式（简化版本）
func convertScriptToExpression(script string) *TriggerExpression {
	// 这是一个简化的转换，实际应用中可能需要更复杂的解析
	return &TriggerExpression{
		ID:       "1",
		Type:     "simple",
		Operator: "contains",
		Field:    "subject",
		Value:    "",
		Not:      false,
	}
}

// extractPluginIDFromConfig 从配置中提取插件ID
func extractPluginIDFromConfig(config map[string]interface{}) string {
	if pluginID, ok := config["plugin_id"].(string); ok {
		return pluginID
	}
	return "unknown"
}

// CreateTriggerV2Handler 创建TriggerV2触发器
// @Summary Create a new TriggerV2 email trigger
// @Description Create a new TriggerV2 email trigger with expression-based conditions and actions
// @Tags triggersv2
// @Accept json
// @Produce json
// @Param request body CreateTriggerV2Request true "Create TriggerV2 request"
// @Success 201 {object} TriggerV2Response
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/triggers [post]
func (h *TriggerAPIHandler) CreateTriggerV2Handler(w http.ResponseWriter, r *http.Request) {
	var req CreateTriggerV2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 验证必填字段
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

	// 转换为数据库模型
	trigger := convertToEmailTrigger(&req)

	// 创建触发器
	if err := h.triggerService.CreateTrigger(trigger); err != nil {
		http.Error(w, "Failed to create trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityTriggerCreated,
		"创建TriggerV2触发器",
		fmt.Sprintf("创建了TriggerV2触发器 %s", trigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   trigger.ID,
			"trigger_name": trigger.Name,
			"version":      "v2",
		},
	)

	// 构建响应
	response := convertToTriggerV2Response(trigger)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// GetTriggersV2Handler 获取TriggerV2触发器列表
// @Summary Get TriggerV2 triggers with pagination
// @Description Get TriggerV2 triggers with pagination and search support
// @Tags triggersv2
// @Accept json
// @Produce json
// @Param page query int false "Page number (default: 1)"
// @Param limit query int false "Items per page (default: 10)"
// @Param sort_by query string false "Sort field (default: created_at)"
// @Param sort_order query string false "Sort order: asc or desc (default: desc)"
// @Param search query string false "Search term for trigger name"
// @Param status query string false "Filter by status: enabled or disabled"
// @Success 200 {object} PaginatedTriggerV2Response
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/triggers [get]
func (h *TriggerAPIHandler) GetTriggersV2Handler(w http.ResponseWriter, r *http.Request) {
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
	orgID := GetCurrentOrgID(r)
	triggers, total, err := h.triggerRepo.GetAllPaginated(page, limit, sortBy, sortOrder, search, orgID)
	if err != nil {
		http.Error(w, "Failed to retrieve triggers: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取事件订阅状态
	subscriptionStatus := h.triggerService.GetEventSubscriptionStatus()

	// 转换为TriggerV2响应格式
	responseTriggers := make([]TriggerV2Response, 0, len(triggers))
	for _, trigger := range triggers {
		response := convertToTriggerV2Response(&trigger)
		// 事件订阅状态在 TriggerV2Response 中不需要单独字段
		// 可以通过 Enabled 字段来判断状态
		_ = subscriptionStatus // 暂时保留但不使用
		responseTriggers = append(responseTriggers, *response)
	}

	// 计算总页数
	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	// 构建响应
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

// GetTriggerV2Handler 获取单个TriggerV2触发器
// @Summary Get a TriggerV2 trigger by ID
// @Description Get a TriggerV2 trigger by ID with subscription status
// @Tags triggersv2
// @Accept json
// @Produce json
// @Param id path int true "Trigger ID"
// @Success 200 {object} TriggerV2Response
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /api/v2/triggers/{id} [get]
func (h *TriggerAPIHandler) GetTriggerV2Handler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	trigger, err := h.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// 获取事件订阅状态
	subscriptionStatus := h.triggerService.GetEventSubscriptionStatus()

	response := convertToTriggerV2Response(trigger)
	// 事件订阅状态在 TriggerV2Response 中不需要单独字段
	// 可以通过 Enabled 字段来判断状态
	_ = subscriptionStatus // 暂时保留但不使用

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// UpdateTriggerV2Handler 更新TriggerV2触发器
// @Summary Update a TriggerV2 trigger
// @Description Update a TriggerV2 trigger (supports partial updates)
// @Tags triggersv2
// @Accept json
// @Produce json
// @Param id path int true "Trigger ID"
// @Param request body UpdateTriggerV2Request true "Update TriggerV2 request"
// @Success 200 {object} TriggerV2Response
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/v2/triggers/{id} [put]
func (h *TriggerAPIHandler) UpdateTriggerV2Handler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid trigger ID", http.StatusBadRequest)
		return
	}

	// 获取现有触发器
	existingTrigger, err := h.triggerRepo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Trigger not found", http.StatusNotFound)
		return
	}

	var req UpdateTriggerV2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 应用部分更新
	if req.Name != nil {
		existingTrigger.Name = *req.Name
	}
	if req.Description != nil {
		existingTrigger.Description = *req.Description
	}
	if req.Enabled != nil {
		if *req.Enabled {
			existingTrigger.Status = models.TriggerStatusEnabled
		} else {
			existingTrigger.Status = models.TriggerStatusDisabled
		}
	}
	if len(req.Expressions) > 0 {
		scripts := make([]string, len(req.Expressions))
		for i, expr := range req.Expressions {
			scripts[i] = generateExpressionScript(&expr)
		}
		script := strings.Join(scripts, " && ")
		existingTrigger.Condition = models.TriggerConditionConfig{
			Type:   "js",
			Script: script,
		}
	}
	if req.Actions != nil {
		actions := make([]models.TriggerActionConfig, len(req.Actions))
		for i, action := range req.Actions {
			configJSON, _ := json.Marshal(action.Config)
			actions[i] = models.TriggerActionConfig{
				Type:        models.TriggerActionTypeModifyContent,
				Name:        action.PluginName,
				Description: fmt.Sprintf("Plugin: %s", action.PluginName),
				Config:      string(configJSON),
				Enabled:     action.Enabled,
				Order:       action.ExecutionOrder,
			}
		}
		existingTrigger.Actions = models.TriggerActionsV1(actions)
	}

	// 更新触发器
	if err := h.triggerService.UpdateTrigger(existingTrigger); err != nil {
		http.Error(w, "Failed to update trigger: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 记录活动日志
	userID := getUserIDFromContext(r)
	h.activityLogger.LogActivity(
		models.ActivityTypeGeneral,
		"更新TriggerV2触发器",
		fmt.Sprintf("更新了TriggerV2触发器 %s", existingTrigger.Name),
		userID,
		map[string]interface{}{
			"trigger_id":   existingTrigger.ID,
			"trigger_name": existingTrigger.Name,
			"version":      "v2",
		},
	)

	// 获取事件订阅状态
	subscriptionStatus := h.triggerService.GetEventSubscriptionStatus()

	response := convertToTriggerV2Response(existingTrigger)
	// 事件订阅状态在 TriggerV2Response 中不需要单独字段
	// 可以通过 Enabled 字段来判断状态
	_ = subscriptionStatus // 暂时保留但不使用

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
