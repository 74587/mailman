package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"mailman/internal/interceptor"
	"mailman/internal/models"
	"mailman/internal/repository"

	"github.com/gorilla/mux"
)

// InterceptorHandler 拦截器 API 处理器
type InterceptorHandler struct {
	repo    *repository.InterceptorRepository
	manager *interceptor.Manager
}

// NewInterceptorHandler 创建拦截器处理器
func NewInterceptorHandler(repo *repository.InterceptorRepository, manager *interceptor.Manager) *InterceptorHandler {
	return &InterceptorHandler{
		repo:    repo,
		manager: manager,
	}
}

// ListInterceptors 获取所有拦截器
// @Summary 获取拦截器列表
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param scope query string false "作用域过滤: global, local"
// @Success 200 {array} models.Interceptor
// @Router /interceptors [get]
func (h *InterceptorHandler) ListInterceptors(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	scope := r.URL.Query().Get("scope")

	var interceptors []models.Interceptor
	var err error

	if scope != "" {
		interceptors, err = h.repo.ListByScope(models.InterceptorScope(scope))
	} else {
		interceptors, err = h.repo.List(orgID)
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(interceptors)
}

// GetInterceptor 获取单个拦截器
// @Summary 获取拦截器详情
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param id path int true "拦截器ID"
// @Success 200 {object} models.Interceptor
// @Router /interceptors/{id} [get]
func (h *InterceptorHandler) GetInterceptor(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	interceptor, err := h.repo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Interceptor not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(interceptor)
}

// CreateInterceptor 创建拦截器
// @Summary 创建拦截器
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param body body models.CreateInterceptorRequest true "拦截器配置"
// @Success 201 {object} models.Interceptor
// @Router /interceptors [post]
func (h *InterceptorHandler) CreateInterceptor(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)


	var req models.CreateInterceptorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 检查名称是否重复
	exists, err := h.repo.ExistsByName(req.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if exists {
		http.Error(w, "Interceptor name already exists", http.StatusConflict)
		return
	}

	// 检查插件是否存在
	if _, err := h.manager.GetPlugin(req.PluginID); err != nil {
		http.Error(w, "Plugin not found: "+req.PluginID, http.StatusBadRequest)
		return
	}

	// 创建拦截器
	newInterceptor := &models.Interceptor{
		OrgID:         orgID,
		Name:          req.Name,
		Description:   req.Description,
		PluginID:      req.PluginID,
		PluginConfig:  req.PluginConfig,
		Scope:         req.Scope,
		TriggerID:     req.TriggerID,
		ExtractorID:   req.ExtractorID,
		Enabled:       req.Enabled,
		Order:         req.Order,
		Phases:        req.Phases,
		Filter:        req.Filter,
		ErrorHandling: req.ErrorHandling,
		SkipConfig:    req.SkipConfig,
		Execution:     req.Execution,
	}

	// 设置默认值
	if newInterceptor.Order == 0 {
		newInterceptor.Order = 100
	}
	if newInterceptor.Filter.Mode == "" {
		newInterceptor.Filter.Mode = models.FilterModeAll
	}
	if newInterceptor.ErrorHandling.BeforeErrorPolicy == "" {
		newInterceptor.ErrorHandling.BeforeErrorPolicy = models.ErrorPolicyAbort
	}
	if newInterceptor.ErrorHandling.AfterErrorPolicy == "" {
		newInterceptor.ErrorHandling.AfterErrorPolicy = models.ErrorPolicyContinue
	}
	if newInterceptor.SkipConfig.SkipBehavior == "" {
		newInterceptor.SkipConfig.SkipBehavior = models.SkipBehaviorContinue
	}
	if newInterceptor.Execution.AfterMode == "" {
		newInterceptor.Execution.AfterMode = models.ExecutionModeSync
	}

	// 验证
	if err := h.repo.Validate(newInterceptor); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 保存到数据库
	if err := h.repo.Create(newInterceptor); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 更新管理器配置
	h.updateManagerConfig(newInterceptor)

	log.Printf("[InterceptorHandler] Created interceptor: %s (ID: %d)", newInterceptor.Name, newInterceptor.ID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(newInterceptor)
}

// UpdateInterceptor 更新拦截器
// @Summary 更新拦截器
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param id path int true "拦截器ID"
// @Param body body models.UpdateInterceptorRequest true "更新内容"
// @Success 200 {object} models.Interceptor
// @Router /interceptors/{id} [put]
func (h *InterceptorHandler) UpdateInterceptor(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	// 获取现有拦截器
	existing, err := h.repo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Interceptor not found", http.StatusNotFound)
		return
	}

	var req models.UpdateInterceptorRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 检查名称是否重复（如果修改了名称）
	if req.Name != nil && *req.Name != existing.Name {
		exists, err := h.repo.ExistsByNameExcludeID(*req.Name, uint(id))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if exists {
			http.Error(w, "Interceptor name already exists", http.StatusConflict)
			return
		}
		existing.Name = *req.Name
	}

	// 更新字段
	if req.Description != nil {
		existing.Description = *req.Description
	}
	if req.PluginID != nil {
		// 检查插件是否存在
		if _, err := h.manager.GetPlugin(*req.PluginID); err != nil {
			http.Error(w, "Plugin not found: "+*req.PluginID, http.StatusBadRequest)
			return
		}
		existing.PluginID = *req.PluginID
	}
	if req.PluginConfig != nil {
		existing.PluginConfig = req.PluginConfig
	}
	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	if req.Order != nil {
		existing.Order = *req.Order
	}
	if req.Phases != nil {
		existing.Phases = *req.Phases
	}
	if req.Filter != nil {
		existing.Filter = *req.Filter
	}
	if req.ErrorHandling != nil {
		existing.ErrorHandling = *req.ErrorHandling
	}
	if req.SkipConfig != nil {
		existing.SkipConfig = *req.SkipConfig
	}
	if req.Execution != nil {
		existing.Execution = *req.Execution
	}

	// 验证
	if err := h.repo.Validate(existing); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 保存更新
	if err := h.repo.Update(existing); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 更新管理器配置
	h.updateManagerConfig(existing)

	log.Printf("[InterceptorHandler] Updated interceptor: %s (ID: %d)", existing.Name, existing.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(existing)
}

// DeleteInterceptor 删除拦截器
// @Summary 删除拦截器
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param id path int true "拦截器ID"
// @Success 204
// @Router /interceptors/{id} [delete]
func (h *InterceptorHandler) DeleteInterceptor(w http.ResponseWriter, r *http.Request) {

	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	// 删除
	if err := h.repo.Delete(uint(id)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 从管理器移除配置
	h.manager.RemoveConfig(uint(id))

	log.Printf("[InterceptorHandler] Deleted interceptor ID: %d", id)

	w.WriteHeader(http.StatusNoContent)
}

// EnableInterceptor 启用拦截器
// @Summary 启用拦截器
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param id path int true "拦截器ID"
// @Success 200 {object} models.Interceptor
// @Router /interceptors/{id}/enable [post]
func (h *InterceptorHandler) EnableInterceptor(w http.ResponseWriter, r *http.Request) {
	h.setEnabled(w, r, true)
}

// DisableInterceptor 禁用拦截器
// @Summary 禁用拦截器
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param id path int true "拦截器ID"
// @Success 200 {object} models.Interceptor
// @Router /interceptors/{id}/disable [post]
func (h *InterceptorHandler) DisableInterceptor(w http.ResponseWriter, r *http.Request) {
	h.setEnabled(w, r, false)
}

// setEnabled 设置启用状态
func (h *InterceptorHandler) setEnabled(w http.ResponseWriter, r *http.Request, enabled bool) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	// 更新状态
	if err := h.repo.UpdateEnabled(uint(id), enabled); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取更新后的拦截器
	interceptor, err := h.repo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "Interceptor not found", http.StatusNotFound)
		return
	}

	// 更新管理器配置
	h.updateManagerConfig(interceptor)

	log.Printf("[InterceptorHandler] Interceptor %s %s", interceptor.Name, map[bool]string{true: "enabled", false: "disabled"}[enabled])

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(interceptor)
}

// ListPlugins 获取可用的拦截器插件列表
// @Summary 获取拦截器插件列表
// @Tags Interceptors
// @Accept json
// @Produce json
// @Success 200 {array} models.InterceptorPluginInfo
// @Router /interceptors/plugins [get]
func (h *InterceptorHandler) ListPlugins(w http.ResponseWriter, r *http.Request) {
	plugins, err := h.manager.ListPlugins()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(plugins)
}

// UpdateOrder 批量更新拦截器顺序
// @Summary 批量更新拦截器顺序
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param body body map[string]int true "ID到顺序的映射"
// @Success 200
// @Router /interceptors/order [put]
func (h *InterceptorHandler) UpdateOrder(w http.ResponseWriter, r *http.Request) {
	var orderMap map[string]int
	if err := json.NewDecoder(r.Body).Decode(&orderMap); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 转换为 uint 键
	orders := make(map[uint]int)
	for idStr, order := range orderMap {
		id, err := strconv.ParseUint(idStr, 10, 32)
		if err != nil {
			http.Error(w, "Invalid ID: "+idStr, http.StatusBadRequest)
			return
		}
		orders[uint(id)] = order
	}

	// 批量更新
	if err := h.repo.BatchUpdateOrder(orders); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 重新加载管理器配置
	h.reloadManagerConfigs()

	log.Printf("[InterceptorHandler] Updated order for %d interceptors", len(orders))

	w.WriteHeader(http.StatusOK)
}

// updateManagerConfig 更新管理器中的单个配置
func (h *InterceptorHandler) updateManagerConfig(i *models.Interceptor) {
	config := h.modelToConfig(i)
	if err := h.manager.UpdateConfig(config); err != nil {
		log.Printf("[InterceptorHandler] Failed to update manager config: %v", err)
	}
}

// reloadManagerConfigs 重新加载所有配置到管理器
func (h *InterceptorHandler) reloadManagerConfigs() {
	interceptors, err := h.repo.ListEnabled()
	if err != nil {
		log.Printf("[InterceptorHandler] Failed to reload configs: %v", err)
		return
	}

	configs := make([]*interceptor.InterceptorConfig, len(interceptors))
	for i, item := range interceptors {
		configs[i] = h.modelToConfig(&item)
	}

	if err := h.manager.LoadConfigs(configs); err != nil {
		log.Printf("[InterceptorHandler] Failed to load configs: %v", err)
	}
}

// modelToConfig 将数据库模型转换为运行时配置
func (h *InterceptorHandler) modelToConfig(i *models.Interceptor) *interceptor.InterceptorConfig {
	return &interceptor.InterceptorConfig{
		ID:            i.ID,
		Name:          i.Name,
		Description:   i.Description,
		PluginID:      i.PluginID,
		Enabled:       i.Enabled,
		Order:         i.Order,
		Phases:        i.Phases,
		Filter:        i.Filter,
		ErrorHandling: i.ErrorHandling,
		SkipConfig:    i.SkipConfig,
		Execution:     i.Execution,
		PluginConfig:  i.PluginConfig,
		Scope:         i.Scope,
		TriggerID:     i.TriggerID,
		ExtractorID:   i.ExtractorID,
	}
}

// RegisterRoutes 注册路由
func (h *InterceptorHandler) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/interceptors", h.ListInterceptors).Methods("GET")
	router.HandleFunc("/interceptors", h.CreateInterceptor).Methods("POST")
	router.HandleFunc("/interceptors/plugins", h.ListPlugins).Methods("GET")
	router.HandleFunc("/interceptors/order", h.UpdateOrder).Methods("PUT")
	router.HandleFunc("/interceptors/logs", h.ListLogs).Methods("GET")
	router.HandleFunc("/interceptors/logs/stats", h.GetLogStats).Methods("GET")
	router.HandleFunc("/interceptors/logs/{id}", h.GetLog).Methods("GET")
	router.HandleFunc("/interceptors/{id}", h.GetInterceptor).Methods("GET")
	router.HandleFunc("/interceptors/{id}", h.UpdateInterceptor).Methods("PUT")
	router.HandleFunc("/interceptors/{id}", h.DeleteInterceptor).Methods("DELETE")
	router.HandleFunc("/interceptors/{id}/enable", h.EnableInterceptor).Methods("POST")
	router.HandleFunc("/interceptors/{id}/disable", h.DisableInterceptor).Methods("POST")
}

// ListLogs 获取拦截器日志列表
// @Summary 获取拦截器执行日志列表
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param interceptor_id query int false "拦截器ID"
// @Param trigger_id query int false "触发器ID"
// @Param success query bool false "成功状态"
// @Param phase query string false "执行阶段: before, after, around"
// @Param start_date query string false "开始日期 (RFC3339)"
// @Param end_date query string false "结束日期 (RFC3339)"
// @Param page query int false "页码，默认1"
// @Param limit query int false "每页数量，默认20"
// @Success 200 {object} map[string]interface{}
// @Router /interceptors/logs [get]
func (h *InterceptorHandler) ListLogs(w http.ResponseWriter, r *http.Request) {
	// 解析过滤参数
	filter := repository.InterceptorLogFilter{}

	if interceptorIDStr := r.URL.Query().Get("interceptor_id"); interceptorIDStr != "" {
		if id, err := strconv.ParseUint(interceptorIDStr, 10, 32); err == nil {
			interceptorID := uint(id)
			filter.InterceptorID = &interceptorID
		}
	}

	if triggerIDStr := r.URL.Query().Get("trigger_id"); triggerIDStr != "" {
		if id, err := strconv.ParseUint(triggerIDStr, 10, 32); err == nil {
			triggerID := uint(id)
			filter.TriggerID = &triggerID
		}
	}

	if successStr := r.URL.Query().Get("success"); successStr != "" {
		success := successStr == "true"
		filter.Success = &success
	}

	filter.Phase = r.URL.Query().Get("phase")

	if startDateStr := r.URL.Query().Get("start_date"); startDateStr != "" {
		if t, err := time.Parse(time.RFC3339, startDateStr); err == nil {
			filter.StartDate = &t
		}
	}

	if endDateStr := r.URL.Query().Get("end_date"); endDateStr != "" {
		if t, err := time.Parse(time.RFC3339, endDateStr); err == nil {
			filter.EndDate = &t
		}
	}

	// 解析分页参数
	page := 1
	if pageStr := r.URL.Query().Get("page"); pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
			page = p
		}
	}

	limit := 20
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	// 查询日志
	logs, err := h.repo.ListLogsWithPagination(filter, page, limit)
	if err != nil {
		log.Printf("[InterceptorHandler] Failed to list logs: %v", err)
		http.Error(w, "Failed to list logs", http.StatusInternalServerError)
		return
	}

	// 统计总数
	total, err := h.repo.CountLogs(filter)
	if err != nil {
		log.Printf("[InterceptorHandler] Failed to count logs: %v", err)
		http.Error(w, "Failed to count logs", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data":  logs,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// GetLog 获取单条日志详情
// @Summary 获取拦截器执行日志详情
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param id path int true "日志ID"
// @Success 200 {object} models.InterceptorLog
// @Router /interceptors/logs/{id} [get]
func (h *InterceptorHandler) GetLog(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	logEntry, err := h.repo.GetLogByID(uint(id))
	if err != nil {
		http.Error(w, "Log not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logEntry)
}

// GetLogStats 获取日志统计信息
// @Summary 获取拦截器执行日志统计
// @Tags Interceptors
// @Accept json
// @Produce json
// @Param interceptor_id query int false "拦截器ID"
// @Param trigger_id query int false "触发器ID"
// @Param start_date query string false "开始日期 (RFC3339)"
// @Param end_date query string false "结束日期 (RFC3339)"
// @Success 200 {object} map[string]interface{}
// @Router /interceptors/logs/stats [get]
func (h *InterceptorHandler) GetLogStats(w http.ResponseWriter, r *http.Request) {
	// 解析过滤参数
	filter := repository.InterceptorLogFilter{}

	if interceptorIDStr := r.URL.Query().Get("interceptor_id"); interceptorIDStr != "" {
		if id, err := strconv.ParseUint(interceptorIDStr, 10, 32); err == nil {
			interceptorID := uint(id)
			filter.InterceptorID = &interceptorID
		}
	}

	if triggerIDStr := r.URL.Query().Get("trigger_id"); triggerIDStr != "" {
		if id, err := strconv.ParseUint(triggerIDStr, 10, 32); err == nil {
			triggerID := uint(id)
			filter.TriggerID = &triggerID
		}
	}

	if startDateStr := r.URL.Query().Get("start_date"); startDateStr != "" {
		if t, err := time.Parse(time.RFC3339, startDateStr); err == nil {
			filter.StartDate = &t
		}
	}

	if endDateStr := r.URL.Query().Get("end_date"); endDateStr != "" {
		if t, err := time.Parse(time.RFC3339, endDateStr); err == nil {
			filter.EndDate = &t
		}
	}

	total, success, failed, avgDuration, err := h.repo.GetLogStats(filter)
	if err != nil {
		log.Printf("[InterceptorHandler] Failed to get log stats: %v", err)
		http.Error(w, "Failed to get log stats", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"total":               total,
		"success":             success,
		"failed":              failed,
		"average_duration_ms": avgDuration,
	})
}
