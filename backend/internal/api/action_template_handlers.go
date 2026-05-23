package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"mailman/internal/database"
	"mailman/internal/models"

	"github.com/gorilla/mux"
)

// ActionTemplateRequest 动作模板请求
type ActionTemplateRequest struct {
	Name        string                   `json:"name"`
	Description string                   `json:"description,omitempty"`
	Category    string                   `json:"category,omitempty"`
	Tags        []string                 `json:"tags,omitempty"`
	Actions     []map[string]interface{} `json:"actions"`
}

// ActionTemplateResponse 动作模板响应
type ActionTemplateResponse struct {
	ID          uint                     `json:"id"`
	Name        string                   `json:"name"`
	Description string                   `json:"description,omitempty"`
	Category    string                   `json:"category,omitempty"`
	Tags        []string                 `json:"tags,omitempty"`
	Actions     []map[string]interface{} `json:"actions"`
	UsageCount  int64                    `json:"usageCount"`
	IsBuiltin   bool                     `json:"isBuiltin"`
	CreatedAt   string                   `json:"createdAt"`
	UpdatedAt   string                   `json:"updatedAt"`
}

// ListActionTemplatesHandler 获取动作模板列表
func (h *APIHandler) ListActionTemplatesHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)

	// 解析查询参数
	query := r.URL.Query()
	page, _ := strconv.Atoi(query.Get("page"))
	pageSize, _ := strconv.Atoi(query.Get("pageSize"))
	category := query.Get("category")
	search := query.Get("search")

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	offset := (page - 1) * pageSize

	// 构建查询
	dbQuery := db.Model(&models.ActionTemplate{})
	if orgID > 0 {
		dbQuery = dbQuery.Where("org_id = ?", orgID)
	}

	if category != "" {
		dbQuery = dbQuery.Where("category = ?", category)
	}

	if search != "" {
		searchPattern := "%" + search + "%"
		dbQuery = dbQuery.Where("name LIKE ? OR description LIKE ?", searchPattern, searchPattern)
	}

	// 获取总数
	var total int64
	if err := dbQuery.Count(&total).Error; err != nil {
		http.Error(w, "获取动作模板总数失败", http.StatusInternalServerError)
		return
	}

	// 获取列表
	var templates []models.ActionTemplate
	if err := dbQuery.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&templates).Error; err != nil {
		http.Error(w, "获取动作模板列表失败", http.StatusInternalServerError)
		return
	}

	// 转换为列表项
	items := make([]models.ActionTemplateListItem, len(templates))
	for i, t := range templates {
		items[i] = t.ToListItem()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"items":    items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

// GetActionTemplateHandler 获取单个动作模板
func (h *APIHandler) GetActionTemplateHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "无效的模板ID", http.StatusBadRequest)
		return
	}

	var template models.ActionTemplate
	q := db.Where("id = ?", id)
	if orgID > 0 {
		q = q.Where("org_id = ?", orgID)
	}
	if err := q.First(&template).Error; err != nil {
		http.Error(w, "动作模板不存在", http.StatusNotFound)
		return
	}

	response := ActionTemplateResponse{
		ID:          template.ID,
		Name:        template.Name,
		Description: template.Description,
		Category:    template.Category,
		Tags:        template.Tags,
		Actions:     template.Actions,
		UsageCount:  template.UsageCount,
		IsBuiltin:   template.IsBuiltin,
		CreatedAt:   template.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   template.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CreateActionTemplateHandler 创建动作模板
func (h *APIHandler) CreateActionTemplateHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	var req ActionTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求数据", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "模板名称不能为空", http.StatusBadRequest)
		return
	}

	if len(req.Actions) == 0 {
		http.Error(w, "动作配置不能为空", http.StatusBadRequest)
		return
	}

	template := models.ActionTemplate{
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		Tags:        req.Tags,
		Actions:     req.Actions,
		IsBuiltin:   false,
		OrgID:       orgID,
	}

	if err := db.Create(&template).Error; err != nil {
		http.Error(w, fmt.Sprintf("创建动作模板失败: %v", err), http.StatusInternalServerError)
		return
	}

	response := ActionTemplateResponse{
		ID:          template.ID,
		Name:        template.Name,
		Description: template.Description,
		Category:    template.Category,
		Tags:        template.Tags,
		Actions:     template.Actions,
		UsageCount:  template.UsageCount,
		IsBuiltin:   template.IsBuiltin,
		CreatedAt:   template.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   template.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// UpdateActionTemplateHandler 更新动作模板
func (h *APIHandler) UpdateActionTemplateHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "无效的模板ID", http.StatusBadRequest)
		return
	}

	var template models.ActionTemplate
	q := db.Where("id = ?", id)
	if orgID > 0 {
		q = q.Where("org_id = ?", orgID)
	}
	if err := q.First(&template).Error; err != nil {
		http.Error(w, "动作模板不存在", http.StatusNotFound)
		return
	}

	// 内置模板不允许修改
	if template.IsBuiltin {
		http.Error(w, "内置模板不允许修改", http.StatusForbidden)
		return
	}

	var req ActionTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求数据", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "模板名称不能为空", http.StatusBadRequest)
		return
	}

	// 更新字段
	template.Name = req.Name
	template.Description = req.Description
	template.Category = req.Category
	template.Tags = req.Tags
	if len(req.Actions) > 0 {
		template.Actions = req.Actions
	}

	if err := db.Save(&template).Error; err != nil {
		http.Error(w, fmt.Sprintf("更新动作模板失败: %v", err), http.StatusInternalServerError)
		return
	}

	response := ActionTemplateResponse{
		ID:          template.ID,
		Name:        template.Name,
		Description: template.Description,
		Category:    template.Category,
		Tags:        template.Tags,
		Actions:     template.Actions,
		UsageCount:  template.UsageCount,
		IsBuiltin:   template.IsBuiltin,
		CreatedAt:   template.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   template.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteActionTemplateHandler 删除动作模板
func (h *APIHandler) DeleteActionTemplateHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "无效的模板ID", http.StatusBadRequest)
		return
	}

	var template models.ActionTemplate
	q := db.Where("id = ?", id)
	if orgID > 0 {
		q = q.Where("org_id = ?", orgID)
	}
	if err := q.First(&template).Error; err != nil {
		http.Error(w, "动作模板不存在", http.StatusNotFound)
		return
	}

	// 内置模板不允许删除
	if template.IsBuiltin {
		http.Error(w, "内置模板不允许删除", http.StatusForbidden)
		return
	}

	if err := db.Delete(&template).Error; err != nil {
		http.Error(w, fmt.Sprintf("删除动作模板失败: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "动作模板已删除",
	})
}

// IncrementActionTemplateUsageHandler 增加动作模板使用次数
func (h *APIHandler) IncrementActionTemplateUsageHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "无效的模板ID", http.StatusBadRequest)
		return
	}

	q := db.Model(&models.ActionTemplate{}).Where("id = ?", id)
	if orgID > 0 {
		q = q.Where("org_id = ?", orgID)
	}
	result := q.Update("usage_count", db.Raw("usage_count + 1"))
	if result.Error != nil {
		http.Error(w, "更新使用次数失败", http.StatusInternalServerError)
		return
	}

	if result.RowsAffected == 0 {
		http.Error(w, "动作模板不存在", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "使用次数已更新",
	})
}

// GetActionTemplateCategoriesHandler 获取所有分类
func (h *APIHandler) GetActionTemplateCategoriesHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)

	var categories []string
	q := db.Model(&models.ActionTemplate{})
	if orgID > 0 {
		q = q.Where("org_id = ?", orgID)
	}
	if err := q.Distinct().Pluck("category", &categories).Error; err != nil {
		http.Error(w, "获取分类列表失败", http.StatusInternalServerError)
		return
	}

	// 过滤空值
	result := make([]string, 0)
	for _, c := range categories {
		if c != "" {
			result = append(result, c)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"categories": result,
	})
}
