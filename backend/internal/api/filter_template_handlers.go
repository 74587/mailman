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

// FilterTemplateRequest 过滤器模板请求
type FilterTemplateRequest struct {
	Name        string                    `json:"name"`
	Description string                    `json:"description,omitempty"`
	Category    string                    `json:"category,omitempty"`
	Tags        []string                  `json:"tags,omitempty"`
	Expressions models.TriggerExpressions `json:"expressions"`
}

// FilterTemplateResponse 过滤器模板响应
type FilterTemplateResponse struct {
	ID          uint                      `json:"id"`
	Name        string                    `json:"name"`
	Description string                    `json:"description,omitempty"`
	Category    string                    `json:"category,omitempty"`
	Tags        []string                  `json:"tags,omitempty"`
	Expressions models.TriggerExpressions `json:"expressions"`
	UsageCount  int64                     `json:"usageCount"`
	IsBuiltin   bool                      `json:"isBuiltin"`
	CreatedAt   string                    `json:"createdAt"`
	UpdatedAt   string                    `json:"updatedAt"`
}

// ListFilterTemplatesHandler 获取过滤器模板列表
func (h *APIHandler) ListFilterTemplatesHandler(w http.ResponseWriter, r *http.Request) {
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
	dbQuery := db.Model(&models.FilterTemplate{})
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
		http.Error(w, "获取过滤器模板总数失败", http.StatusInternalServerError)
		return
	}

	// 获取列表
	var templates []models.FilterTemplate
	if err := dbQuery.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&templates).Error; err != nil {
		http.Error(w, "获取过滤器模板列表失败", http.StatusInternalServerError)
		return
	}

	// 转换为列表项
	items := make([]models.FilterTemplateListItem, len(templates))
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

// GetFilterTemplateHandler 获取单个过滤器模板
func (h *APIHandler) GetFilterTemplateHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "无效的模板ID", http.StatusBadRequest)
		return
	}

	var template models.FilterTemplate
	q := db.Where("id = ?", id)
	if orgID > 0 {
		q = q.Where("org_id = ?", orgID)
	}
	if err := q.First(&template).Error; err != nil {
		http.Error(w, "过滤器模板不存在", http.StatusNotFound)
		return
	}

	response := FilterTemplateResponse{
		ID:          template.ID,
		Name:        template.Name,
		Description: template.Description,
		Category:    template.Category,
		Tags:        template.Tags,
		Expressions: template.Expressions,
		UsageCount:  template.UsageCount,
		IsBuiltin:   template.IsBuiltin,
		CreatedAt:   template.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   template.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CreateFilterTemplateHandler 创建过滤器模板
func (h *APIHandler) CreateFilterTemplateHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	var req FilterTemplateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "无效的请求数据", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "模板名称不能为空", http.StatusBadRequest)
		return
	}

	if len(req.Expressions) == 0 {
		http.Error(w, "过滤表达式不能为空", http.StatusBadRequest)
		return
	}

	template := models.FilterTemplate{
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		Tags:        req.Tags,
		Expressions: req.Expressions,
		IsBuiltin:   false,
		OrgID:       orgID,
	}

	if err := db.Create(&template).Error; err != nil {
		http.Error(w, fmt.Sprintf("创建过滤器模板失败: %v", err), http.StatusInternalServerError)
		return
	}

	response := FilterTemplateResponse{
		ID:          template.ID,
		Name:        template.Name,
		Description: template.Description,
		Category:    template.Category,
		Tags:        template.Tags,
		Expressions: template.Expressions,
		UsageCount:  template.UsageCount,
		IsBuiltin:   template.IsBuiltin,
		CreatedAt:   template.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   template.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(response)
}

// UpdateFilterTemplateHandler 更新过滤器模板
func (h *APIHandler) UpdateFilterTemplateHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "无效的模板ID", http.StatusBadRequest)
		return
	}

	var template models.FilterTemplate
	q := db.Where("id = ?", id)
	if orgID > 0 {
		q = q.Where("org_id = ?", orgID)
	}
	if err := q.First(&template).Error; err != nil {
		http.Error(w, "过滤器模板不存在", http.StatusNotFound)
		return
	}

	// 内置模板不允许修改
	if template.IsBuiltin {
		http.Error(w, "内置模板不允许修改", http.StatusForbidden)
		return
	}

	var req FilterTemplateRequest
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
	if len(req.Expressions) > 0 {
		template.Expressions = req.Expressions
	}

	if err := db.Save(&template).Error; err != nil {
		http.Error(w, fmt.Sprintf("更新过滤器模板失败: %v", err), http.StatusInternalServerError)
		return
	}

	response := FilterTemplateResponse{
		ID:          template.ID,
		Name:        template.Name,
		Description: template.Description,
		Category:    template.Category,
		Tags:        template.Tags,
		Expressions: template.Expressions,
		UsageCount:  template.UsageCount,
		IsBuiltin:   template.IsBuiltin,
		CreatedAt:   template.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   template.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// DeleteFilterTemplateHandler 删除过滤器模板
func (h *APIHandler) DeleteFilterTemplateHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "无效的模板ID", http.StatusBadRequest)
		return
	}

	var template models.FilterTemplate
	q := db.Where("id = ?", id)
	if orgID > 0 {
		q = q.Where("org_id = ?", orgID)
	}
	if err := q.First(&template).Error; err != nil {
		http.Error(w, "过滤器模板不存在", http.StatusNotFound)
		return
	}

	// 内置模板不允许删除
	if template.IsBuiltin {
		http.Error(w, "内置模板不允许删除", http.StatusForbidden)
		return
	}

	if err := db.Delete(&template).Error; err != nil {
		http.Error(w, fmt.Sprintf("删除过滤器模板失败: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "过滤器模板已删除",
	})
}

// IncrementFilterTemplateUsageHandler 增加过滤器模板使用次数
func (h *APIHandler) IncrementFilterTemplateUsageHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 64)
	if err != nil {
		http.Error(w, "无效的模板ID", http.StatusBadRequest)
		return
	}

	q := db.Model(&models.FilterTemplate{}).Where("id = ?", id)
	if orgID > 0 {
		q = q.Where("org_id = ?", orgID)
	}
	result := q.Update("usage_count", db.Raw("usage_count + 1"))
	if result.Error != nil {
		http.Error(w, "更新使用次数失败", http.StatusInternalServerError)
		return
	}

	if result.RowsAffected == 0 {
		http.Error(w, "过滤器模板不存在", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "使用次数已更新",
	})
}

// GetFilterTemplateCategoriesHandler 获取所有分类
func (h *APIHandler) GetFilterTemplateCategoriesHandler(w http.ResponseWriter, r *http.Request) {
	db := database.GetDB()
	orgID := GetCurrentOrgID(r)

	var categories []string
	q := db.Model(&models.FilterTemplate{})
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
