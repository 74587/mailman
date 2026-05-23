package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"mailman/internal/models"
	"mailman/internal/repository"

	"github.com/gorilla/mux"
)

// TagHandlers handles tag-related API requests
type TagHandlers struct {
	tagRepo     *repository.TagRepository
	accountRepo *repository.EmailAccountRepository
}

// NewTagHandlers creates a new TagHandlers instance
func NewTagHandlers(tagRepo *repository.TagRepository, accountRepo *repository.EmailAccountRepository) *TagHandlers {
	return &TagHandlers{
		tagRepo:     tagRepo,
		accountRepo: accountRepo,
	}
}

// ======================== TagGroup Handlers ========================

// CreateTagGroupRequest 创建标签组请求
type CreateTagGroupRequest struct {
	Name          string                       `json:"name"`
	Description   string                       `json:"description"`
	SelectionType models.TagGroupSelectionType `json:"selectionType"`
	Color         string                       `json:"color"`
	SortOrder     int                          `json:"sortOrder"`
}

// UpdateTagGroupRequest 更新标签组请求
type UpdateTagGroupRequest struct {
	Name          string                       `json:"name"`
	Description   string                       `json:"description"`
	SelectionType models.TagGroupSelectionType `json:"selectionType"`
	Color         string                       `json:"color"`
	SortOrder     int                          `json:"sortOrder"`
}

// GetAllTagGroups 获取所有标签组
// @Summary 获取所有标签组
// @Description 获取所有标签组及其包含的标签
// @Tags Tags
// @Produce json
// @Success 200 {array} models.TagGroupWithTags
// @Router /api/tag-groups [get]
func (h *TagHandlers) GetAllTagGroups(w http.ResponseWriter, r *http.Request) {

	groups, err := h.tagRepo.GetAllTagGroups()
	if err != nil {
		http.Error(w, "获取标签组失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	result := make([]models.TagGroupWithTags, 0, len(groups))
	for _, g := range groups {
		result = append(result, g.ToTagGroupWithTags())
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// GetTagGroupByID 获取单个标签组
// @Summary 获取单个标签组
// @Description 根据ID获取标签组及其标签
// @Tags Tags
// @Produce json
// @Param id path int true "标签组ID"
// @Success 200 {object} models.TagGroupWithTags
// @Router /api/tag-groups/{id} [get]
func (h *TagHandlers) GetTagGroupByID(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "无效的标签组ID", http.StatusBadRequest)
		return
	}

	group, err := h.tagRepo.GetTagGroupByID(uint(id))
	if err != nil {
		http.Error(w, "标签组不存在", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(group.ToTagGroupWithTags())
}

// CreateTagGroup 创建标签组
// @Summary 创建标签组
// @Description 创建新的标签组
// @Tags Tags
// @Accept json
// @Produce json
// @Param request body CreateTagGroupRequest true "标签组信息"
// @Success 201 {object} models.TagGroupWithTags
// @Router /api/tag-groups [post]
func (h *TagHandlers) CreateTagGroup(w http.ResponseWriter, r *http.Request) {

	var req CreateTagGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "请求参数错误: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "标签组名称不能为空", http.StatusBadRequest)
		return
	}

	// 设置默认值
	if req.SelectionType == "" {
		req.SelectionType = models.TagGroupSelectionMultiple
	}

	group := &models.TagGroup{
		Name:          req.Name,
		Description:   req.Description,
		SelectionType: req.SelectionType,
		Color:         req.Color,
		SortOrder:     req.SortOrder,
	}

	if err := h.tagRepo.CreateTagGroup(group); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			http.Error(w, "标签组名称已存在", http.StatusConflict)
			return
		}
		http.Error(w, "创建标签组失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(group.ToTagGroupWithTags())
}

// UpdateTagGroup 更新标签组
// @Summary 更新标签组
// @Description 更新标签组信息
// @Tags Tags
// @Accept json
// @Produce json
// @Param id path int true "标签组ID"
// @Param request body UpdateTagGroupRequest true "标签组信息"
// @Success 200 {object} models.TagGroupWithTags
// @Router /api/tag-groups/{id} [put]
func (h *TagHandlers) UpdateTagGroup(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "无效的标签组ID", http.StatusBadRequest)
		return
	}

	group, err := h.tagRepo.GetTagGroupByID(uint(id))
	if err != nil {
		http.Error(w, "标签组不存在", http.StatusNotFound)
		return
	}

	var req UpdateTagGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "请求参数错误: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 更新字段
	if req.Name != "" {
		group.Name = req.Name
	}
	if req.Description != "" {
		group.Description = req.Description
	}
	if req.SelectionType != "" {
		group.SelectionType = req.SelectionType
	}
	if req.Color != "" {
		group.Color = req.Color
	}
	group.SortOrder = req.SortOrder

	if err := h.tagRepo.UpdateTagGroup(group); err != nil {
		http.Error(w, "更新标签组失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(group.ToTagGroupWithTags())
}

// DeleteTagGroup 删除标签组
// @Summary 删除标签组
// @Description 删除标签组及其所有标签
// @Tags Tags
// @Param id path int true "标签组ID"
// @Success 204
// @Router /api/tag-groups/{id} [delete]
func (h *TagHandlers) DeleteTagGroup(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "无效的标签组ID", http.StatusBadRequest)
		return
	}

	if err := h.tagRepo.DeleteTagGroup(uint(id)); err != nil {
		http.Error(w, "删除标签组失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ======================== Tag Handlers ========================

// CreateTagRequest 创建标签请求
type CreateTagRequest struct {
	GroupID   uint   `json:"groupId"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	SortOrder int    `json:"sortOrder"`
}

// UpdateTagRequest 更新标签请求
type UpdateTagRequest struct {
	Name      string `json:"name"`
	Color     string `json:"color"`
	SortOrder int    `json:"sortOrder"`
}

// GetAllTags 获取所有标签
// @Summary 获取所有标签
// @Description 获取所有标签
// @Tags Tags
// @Produce json
// @Success 200 {array} models.TagWithGroup
// @Router /api/tags [get]
func (h *TagHandlers) GetAllTags(w http.ResponseWriter, r *http.Request) {

	tags, err := h.tagRepo.GetAllTags()
	if err != nil {
		http.Error(w, "获取标签失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	result := make([]models.TagWithGroup, 0, len(tags))
	for _, t := range tags {
		result = append(result, t.ToTagWithGroup())
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// CreateTag 创建标签
// @Summary 创建标签
// @Description 在指定标签组中创建标签
// @Tags Tags
// @Accept json
// @Produce json
// @Param request body CreateTagRequest true "标签信息"
// @Success 201 {object} models.Tag
// @Router /api/tags [post]
func (h *TagHandlers) CreateTag(w http.ResponseWriter, r *http.Request) {
	var req CreateTagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "请求参数错误: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.GroupID == 0 {
		http.Error(w, "标签组ID不能为空", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "标签名称不能为空", http.StatusBadRequest)
		return
	}

	// 验证标签组存在
	_, err := h.tagRepo.GetTagGroupByID(req.GroupID)
	if err != nil {
		http.Error(w, "标签组不存在", http.StatusNotFound)
		return
	}

	tag := &models.Tag{
		GroupID:   req.GroupID,
		Name:      req.Name,
		Color:     req.Color,
		SortOrder: req.SortOrder,
	}

	if err := h.tagRepo.CreateTag(tag); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			http.Error(w, "该标签组中已存在同名标签", http.StatusConflict)
			return
		}
		http.Error(w, "创建标签失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(tag)
}

// UpdateTag 更新标签
// @Summary 更新标签
// @Description 更新标签信息
// @Tags Tags
// @Accept json
// @Produce json
// @Param id path int true "标签ID"
// @Param request body UpdateTagRequest true "标签信息"
// @Success 200 {object} models.Tag
// @Router /api/tags/{id} [put]
func (h *TagHandlers) UpdateTag(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "无效的标签ID", http.StatusBadRequest)
		return
	}

	tag, err := h.tagRepo.GetTagByID(uint(id))
	if err != nil {
		http.Error(w, "标签不存在", http.StatusNotFound)
		return
	}

	var req UpdateTagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "请求参数错误: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.Name != "" {
		tag.Name = req.Name
	}
	if req.Color != "" {
		tag.Color = req.Color
	}
	tag.SortOrder = req.SortOrder

	if err := h.tagRepo.UpdateTag(tag); err != nil {
		http.Error(w, "更新标签失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tag)
}

// DeleteTag 删除标签
// @Summary 删除标签
// @Description 删除标签
// @Tags Tags
// @Param id path int true "标签ID"
// @Success 204
// @Router /api/tags/{id} [delete]
func (h *TagHandlers) DeleteTag(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "无效的标签ID", http.StatusBadRequest)
		return
	}

	if err := h.tagRepo.DeleteTag(uint(id)); err != nil {
		http.Error(w, "删除标签失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ======================== Account-Tag Association Handlers ========================

// SetAccountTagsRequest 设置账户标签请求
type SetAccountTagsRequest struct {
	TagIDs []uint `json:"tagIds"`
}

// BatchAccountTagsRequest 批量标签操作请求
type BatchAccountTagsRequest struct {
	AccountIDs []uint `json:"accountIds"`
	TagIDs     []uint `json:"tagIds"`
}

// BatchAddRemoveTagRequest 批量添加/移除单个标签请求
type BatchAddRemoveTagRequest struct {
	AccountIDs []uint `json:"accountIds"`
	TagID      uint   `json:"tagId"`
}

// GetAccountTags 获取账户的标签
// @Summary 获取账户的标签
// @Description 获取指定账户的所有标签
// @Tags Tags
// @Produce json
// @Param id path int true "账户ID"
// @Success 200 {array} models.TagWithGroup
// @Router /api/accounts/{id}/tags [get]
func (h *TagHandlers) GetAccountTags(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "无效的账户ID", http.StatusBadRequest)
		return
	}

	tags, err := h.tagRepo.GetAccountTags(uint(id))
	if err != nil {
		http.Error(w, "获取账户标签失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	result := make([]models.TagWithGroup, 0, len(tags))
	for _, t := range tags {
		result = append(result, t.ToTagWithGroup())
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// SetAccountTags 设置账户的标签
// @Summary 设置账户的标签
// @Description 设置账户的标签（替换所有现有标签）
// @Tags Tags
// @Accept json
// @Produce json
// @Param id path int true "账户ID"
// @Param request body SetAccountTagsRequest true "标签ID列表"
// @Success 200 {array} models.TagWithGroup
// @Router /api/accounts/{id}/tags [put]
func (h *TagHandlers) SetAccountTags(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseUint(vars["id"], 10, 32)
	if err != nil {
		http.Error(w, "无效的账户ID", http.StatusBadRequest)
		return
	}

	var req SetAccountTagsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "请求参数错误: "+err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.tagRepo.SetAccountTags(uint(id), req.TagIDs); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 返回更新后的标签
	tags, _ := h.tagRepo.GetAccountTags(uint(id))
	result := make([]models.TagWithGroup, 0, len(tags))
	for _, t := range tags {
		result = append(result, t.ToTagWithGroup())
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// BatchSetAccountTags 批量设置账户标签
// @Summary 批量设置账户标签
// @Description 为多个账户设置相同的标签（替换现有标签）
// @Tags Tags
// @Accept json
// @Produce json
// @Param request body BatchAccountTagsRequest true "账户和标签ID列表"
// @Success 200 {object} map[string]interface{}
// @Router /api/accounts/batch-tags [post]
func (h *TagHandlers) BatchSetAccountTags(w http.ResponseWriter, r *http.Request) {
	var req BatchAccountTagsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "请求参数错误: "+err.Error(), http.StatusBadRequest)
		return
	}

	if len(req.AccountIDs) == 0 {
		http.Error(w, "账户ID列表不能为空", http.StatusBadRequest)
		return
	}

	if err := h.tagRepo.BatchSetAccountTags(req.AccountIDs, req.TagIDs); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "批量设置标签成功",
		"count":   len(req.AccountIDs),
	})
}

// BatchAddTag 批量添加标签
// @Summary 批量添加标签
// @Description 为多个账户添加一个标签
// @Tags Tags
// @Accept json
// @Produce json
// @Param request body BatchAddRemoveTagRequest true "账户ID列表和标签ID"
// @Success 200 {object} map[string]interface{}
// @Router /api/accounts/batch-add-tag [post]
func (h *TagHandlers) BatchAddTag(w http.ResponseWriter, r *http.Request) {
	var req BatchAddRemoveTagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "请求参数错误: "+err.Error(), http.StatusBadRequest)
		return
	}

	if len(req.AccountIDs) == 0 {
		http.Error(w, "账户ID列表不能为空", http.StatusBadRequest)
		return
	}
	if req.TagID == 0 {
		http.Error(w, "标签ID不能为空", http.StatusBadRequest)
		return
	}

	if err := h.tagRepo.BatchAddTagToAccounts(req.AccountIDs, req.TagID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "批量添加标签成功",
		"count":   len(req.AccountIDs),
	})
}

// BatchRemoveTag 批量移除标签
// @Summary 批量移除标签
// @Description 从多个账户移除一个标签
// @Tags Tags
// @Accept json
// @Produce json
// @Param request body BatchAddRemoveTagRequest true "账户ID列表和标签ID"
// @Success 200 {object} map[string]interface{}
// @Router /api/accounts/batch-remove-tag [post]
func (h *TagHandlers) BatchRemoveTag(w http.ResponseWriter, r *http.Request) {
	var req BatchAddRemoveTagRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "请求参数错误: "+err.Error(), http.StatusBadRequest)
		return
	}

	if len(req.AccountIDs) == 0 {
		http.Error(w, "账户ID列表不能为空", http.StatusBadRequest)
		return
	}
	if req.TagID == 0 {
		http.Error(w, "标签ID不能为空", http.StatusBadRequest)
		return
	}

	if err := h.tagRepo.BatchRemoveTagFromAccounts(req.AccountIDs, req.TagID); err != nil {
		http.Error(w, "批量移除标签失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "批量移除标签成功",
		"count":   len(req.AccountIDs),
	})
}

// GetTagUsageStats 获取标签使用统计
// @Summary 获取标签使用统计
// @Description 获取每个标签关联的账户数量
// @Tags Tags
// @Produce json
// @Success 200 {object} map[uint]int64
// @Router /api/tags/usage [get]
func (h *TagHandlers) GetTagUsageStats(w http.ResponseWriter, r *http.Request) {
	counts, err := h.tagRepo.GetTagUsageCount()
	if err != nil {
		http.Error(w, "获取标签使用统计失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(counts)
}

// RegisterTagRoutes registers all tag-related routes to the router
func RegisterTagRoutes(router *mux.Router, tagHandlers *TagHandlers) {
	// Tag groups
	router.HandleFunc("/tag-groups", tagHandlers.GetAllTagGroups).Methods("GET")
	router.HandleFunc("/tag-groups", tagHandlers.CreateTagGroup).Methods("POST")
	router.HandleFunc("/tag-groups/{id}", tagHandlers.GetTagGroupByID).Methods("GET")
	router.HandleFunc("/tag-groups/{id}", tagHandlers.UpdateTagGroup).Methods("PUT")
	router.HandleFunc("/tag-groups/{id}", tagHandlers.DeleteTagGroup).Methods("DELETE")

	// Tags
	router.HandleFunc("/tags", tagHandlers.GetAllTags).Methods("GET")
	router.HandleFunc("/tags", tagHandlers.CreateTag).Methods("POST")
	router.HandleFunc("/tags/usage", tagHandlers.GetTagUsageStats).Methods("GET")
	router.HandleFunc("/tags/{id}", tagHandlers.UpdateTag).Methods("PUT")
	router.HandleFunc("/tags/{id}", tagHandlers.DeleteTag).Methods("DELETE")

	// Account tags
	router.HandleFunc("/accounts/{id}/tags", tagHandlers.GetAccountTags).Methods("GET")
	router.HandleFunc("/accounts/{id}/tags", tagHandlers.SetAccountTags).Methods("PUT")
	router.HandleFunc("/accounts/batch-tags", tagHandlers.BatchSetAccountTags).Methods("POST")
	router.HandleFunc("/accounts/batch-add-tag", tagHandlers.BatchAddTag).Methods("POST")
	router.HandleFunc("/accounts/batch-remove-tag", tagHandlers.BatchRemoveTag).Methods("POST")
}
