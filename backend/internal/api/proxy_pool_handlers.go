package api

import (
	"context"
	"encoding/json"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

type ProxyPoolHandlers struct {
	repo    *repository.ProxyPoolRepository
	service *services.ProxyPoolService
}

func NewProxyPoolHandlers(repo *repository.ProxyPoolRepository, service *services.ProxyPoolService) *ProxyPoolHandlers {
	return &ProxyPoolHandlers{repo: repo, service: service}
}

type proxyListResponse struct {
	Items []models.ProxyPoolItem `json:"items"`
	Total int64                  `json:"total"`
	Page  int                    `json:"page"`
	Limit int                    `json:"limit"`
}

type proxyCreateRequest struct {
	Type       models.ProxyType `json:"type"`
	Host       string           `json:"host"`
	Port       int              `json:"port"`
	Username   string           `json:"username"`
	Password   string           `json:"password"`
	RefreshURL string           `json:"refreshUrl"`
	Remark     string           `json:"remark"`
	GroupID    *uint            `json:"groupId"`
	TagIDs     []uint           `json:"tagIds"`
	UsageScope string           `json:"usageScope"`
}

type proxyBulkImportRequest struct {
	DefaultType     models.ProxyType `json:"defaultType"`
	GroupID         *uint            `json:"groupId"`
	TagIDs          []uint           `json:"tagIds"`
	CheckProxy      bool             `json:"checkProxy"`
	Channel         string           `json:"channel"`
	Content         string           `json:"content"`
	DuplicatePolicy string           `json:"duplicatePolicy"` // allow, skip, update
}

type proxyBulkImportResponse struct {
	Created []models.ProxyPoolItem      `json:"created"`
	Errors  []services.ProxyParseError  `json:"errors"`
	Checks  []services.ProxyCheckResult `json:"checks,omitempty"`
	Summary map[string]interface{}      `json:"summary"`
}

type proxyBatchTestRequest struct {
	IDs            []uint                     `json:"ids"`
	Filter         repository.ProxyPoolFilter `json:"filter"`
	Channel        string                     `json:"channel"`
	TimeoutSeconds int                        `json:"timeoutSeconds"`
}

type proxyBatchDeleteRequest struct {
	IDs         []uint                            `json:"ids"`
	Filter      repository.ProxyPoolFilter        `json:"filter"`
	Replacement repository.ProxyDeleteReplacement `json:"replacement"`
}

type proxySelectRequest struct {
	GroupIDs   []uint `json:"groupIds"`
	TagIDs     []uint `json:"tagIds"`
	TagMode    string `json:"tagMode"`
	ExcludeIDs []uint `json:"excludeIds"`
}

func (h *ProxyPoolHandlers) ListProxies(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	filter := proxyFilterFromRequest(r)
	items, total, err := h.repo.List(orgID, filter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, proxyListResponse{Items: items, Total: total, Page: filter.Page, Limit: filter.Limit})
}

func (h *ProxyPoolHandlers) GetProxy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid proxy ID", http.StatusBadRequest)
		return
	}
	item, err := h.repo.GetByID(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeJSON(w, item)
}

func (h *ProxyPoolHandlers) CreateProxy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item := models.ProxyPoolItem{
		OrgID:      orgID,
		Type:       models.NormalizeProxyType(req.Type),
		Host:       req.Host,
		Port:       req.Port,
		Username:   req.Username,
		Password:   req.Password,
		RefreshURL: req.RefreshURL,
		Remark:     req.Remark,
		GroupID:    req.GroupID,
		Status:     models.ProxyStatusUnknown,
		UsageScope: req.UsageScope,
	}
	if item.UsageScope == "" {
		item.UsageScope = "shared"
	}
	if err := h.repo.Create(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.repo.SetProxyTags(item.ID, req.TagIDs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	itemWithRelations, _ := h.repo.GetByID(orgID, item.ID)
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, itemWithRelations)
}

func (h *ProxyPoolHandlers) UpdateProxy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid proxy ID", http.StatusBadRequest)
		return
	}
	item, err := h.repo.GetByID(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var req proxyCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item.Type = models.NormalizeProxyType(req.Type)
	item.Host = req.Host
	item.Port = req.Port
	item.Username = req.Username
	item.Password = req.Password
	item.RefreshURL = req.RefreshURL
	item.Remark = req.Remark
	item.GroupID = req.GroupID
	item.UsageScope = req.UsageScope
	if item.UsageScope == "" {
		item.UsageScope = "shared"
	}
	if err := h.repo.Update(item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.repo.SetProxyTags(item.ID, req.TagIDs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	itemWithRelations, _ := h.repo.GetByID(orgID, item.ID)
	writeJSON(w, itemWithRelations)
}

func (h *ProxyPoolHandlers) DeleteProxy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid proxy ID", http.StatusBadRequest)
		return
	}
	affected, err := h.repo.DeleteByIDs(orgID, []uint{id}, repository.ProxyDeleteReplacement{Mode: "clear"})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]interface{}{"deleted": 1, "affectedAccounts": affected})
}

func (h *ProxyPoolHandlers) BulkImport(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyBulkImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	parsed := h.service.ParseBulk(req.Content, req.DefaultType, req.GroupID, req.TagIDs, orgID)
	created := make([]models.ProxyPoolItem, 0, len(parsed.Proxies))
	checks := []services.ProxyCheckResult{}
	duplicatePolicy := normalizeProxyDuplicatePolicy(req.DuplicatePolicy)
	updatedCount := 0
	skippedCount := 0
	for i := range parsed.Proxies {
		item := parsed.Proxies[i]
		tagIDs := make([]uint, 0, len(item.Tags))
		for _, tag := range item.Tags {
			tagIDs = append(tagIDs, tag.ID)
		}
		item.Tags = nil
		duplicate, err := h.repo.FindDuplicate(orgID, item)
		if err != nil {
			parsed.Errors = append(parsed.Errors, services.ProxyParseError{Line: 0, Content: item.DisplayAddress(), Error: err.Error()})
			continue
		}
		if duplicate != nil {
			switch duplicatePolicy {
			case "skip":
				skippedCount++
				continue
			case "update":
				duplicate.Password = item.Password
				duplicate.RefreshURL = item.RefreshURL
				duplicate.Remark = item.Remark
				duplicate.GroupID = item.GroupID
				duplicate.UsageScope = item.UsageScope
				duplicate.Source = item.Source
				if err := h.repo.Update(duplicate); err != nil {
					parsed.Errors = append(parsed.Errors, services.ProxyParseError{Line: 0, Content: item.DisplayAddress(), Error: err.Error()})
					continue
				}
				if err := h.repo.SetProxyTags(duplicate.ID, tagIDs); err != nil {
					parsed.Errors = append(parsed.Errors, services.ProxyParseError{Line: 0, Content: item.DisplayAddress(), Error: err.Error()})
					continue
				}
				itemWithRelations, _ := h.repo.GetByID(orgID, duplicate.ID)
				if itemWithRelations != nil {
					created = append(created, *itemWithRelations)
					updatedCount++
					if req.CheckProxy {
						checks = append(checks, h.service.TestProxy(context.Background(), itemWithRelations, req.Channel, 12*time.Second))
					}
				}
				continue
			}
		}
		if err := h.repo.Create(&item); err != nil {
			parsed.Errors = append(parsed.Errors, services.ProxyParseError{Line: 0, Content: item.DisplayAddress(), Error: err.Error()})
			continue
		}
		if err := h.repo.SetProxyTags(item.ID, tagIDs); err != nil {
			parsed.Errors = append(parsed.Errors, services.ProxyParseError{Line: 0, Content: item.DisplayAddress(), Error: err.Error()})
			continue
		}
		itemWithRelations, _ := h.repo.GetByID(orgID, item.ID)
		if itemWithRelations != nil {
			created = append(created, *itemWithRelations)
			if req.CheckProxy {
				checks = append(checks, h.service.TestProxy(context.Background(), itemWithRelations, req.Channel, 12*time.Second))
			}
		}
	}
	writeJSON(w, proxyBulkImportResponse{
		Created: created,
		Errors:  parsed.Errors,
		Checks:  checks,
		Summary: map[string]interface{}{
			"processed": len(created),
			"updated":   updatedCount,
			"skipped":   skippedCount,
			"errors":    len(parsed.Errors),
		},
	})
}

func (h *ProxyPoolHandlers) TestProxy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid proxy ID", http.StatusBadRequest)
		return
	}
	item, err := h.repo.GetByID(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	channel := r.URL.Query().Get("channel")
	result := h.service.TestProxy(context.Background(), item, channel, 12*time.Second)
	writeJSON(w, result)
}

func (h *ProxyPoolHandlers) BatchTest(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyBatchTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	timeout := time.Duration(req.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	var items []models.ProxyPoolItem
	if len(req.IDs) > 0 {
		for _, id := range req.IDs {
			item, err := h.repo.GetByID(orgID, id)
			if err == nil && item != nil {
				items = append(items, *item)
			}
		}
	} else {
		req.Filter.Limit = 500
		list, _, err := h.repo.List(orgID, req.Filter)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		items = list
	}
	results := make([]services.ProxyCheckResult, 0, len(items))
	for i := range items {
		item := items[i]
		results = append(results, h.service.TestProxy(context.Background(), &item, req.Channel, timeout))
	}
	writeJSON(w, map[string]interface{}{"results": results, "total": len(results)})
}

func (h *ProxyPoolHandlers) BatchDelete(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyBatchDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	ids := req.IDs
	if len(ids) == 0 {
		var err error
		ids, err = h.repo.ListIDs(orgID, req.Filter)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	affected, err := h.repo.DeleteByIDs(orgID, ids, req.Replacement)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]interface{}{"deleted": len(ids), "affectedAccounts": affected})
}

func (h *ProxyPoolHandlers) SelectProxy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxySelectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item, err := h.repo.PickAvailable(orgID, req.GroupIDs, req.TagIDs, req.TagMode, req.ExcludeIDs)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeJSON(w, item)
}

func (h *ProxyPoolHandlers) GetCheckChannels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, services.DefaultProxyCheckChannels())
}

func (h *ProxyPoolHandlers) ListGroups(w http.ResponseWriter, r *http.Request) {
	groups, err := h.repo.ListGroups(GetCurrentOrgID(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, groups)
}

func (h *ProxyPoolHandlers) CreateGroup(w http.ResponseWriter, r *http.Request) {
	var group models.ProxyGroup
	if err := json.NewDecoder(r.Body).Decode(&group); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	group.Name = strings.TrimSpace(group.Name)
	if group.Name == "" {
		http.Error(w, "Group name is required", http.StatusBadRequest)
		return
	}
	orgID := GetCurrentOrgID(r)
	if exists, err := h.proxyGroupNameExists(orgID, 0, group.Name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	} else if exists {
		http.Error(w, "Group name already exists", http.StatusConflict)
		return
	}
	group.ID = 0
	group.OrgID = orgID
	if err := h.repo.CreateGroup(&group); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, group)
}

func (h *ProxyPoolHandlers) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}
	group, err := h.repo.GetGroupByID(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var req models.ProxyGroup
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		http.Error(w, "Group name is required", http.StatusBadRequest)
		return
	}
	if exists, err := h.proxyGroupNameExists(orgID, id, req.Name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	} else if exists {
		http.Error(w, "Group name already exists", http.StatusConflict)
		return
	}
	group.Name = req.Name
	group.Description = req.Description
	group.Color = req.Color
	group.SortOrder = req.SortOrder
	if err := h.repo.UpdateGroup(group); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, group)
}

func (h *ProxyPoolHandlers) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteGroup(GetCurrentOrgID(r), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}

func (h *ProxyPoolHandlers) ListTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.repo.ListTags(GetCurrentOrgID(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, tags)
}

func (h *ProxyPoolHandlers) CreateTag(w http.ResponseWriter, r *http.Request) {
	var tag models.ProxyTag
	if err := json.NewDecoder(r.Body).Decode(&tag); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	tag.Name = strings.TrimSpace(tag.Name)
	if tag.Name == "" {
		http.Error(w, "Tag name is required", http.StatusBadRequest)
		return
	}
	orgID := GetCurrentOrgID(r)
	if exists, err := h.proxyTagNameExists(orgID, 0, tag.Name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	} else if exists {
		http.Error(w, "Tag name already exists", http.StatusConflict)
		return
	}
	tag.ID = 0
	tag.OrgID = orgID
	if err := h.repo.CreateTag(&tag); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, tag)
}

func (h *ProxyPoolHandlers) UpdateTag(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid tag ID", http.StatusBadRequest)
		return
	}
	tag, err := h.repo.GetTagByID(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var req models.ProxyTag
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		http.Error(w, "Tag name is required", http.StatusBadRequest)
		return
	}
	if exists, err := h.proxyTagNameExists(orgID, id, req.Name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	} else if exists {
		http.Error(w, "Tag name already exists", http.StatusConflict)
		return
	}
	tag.Name = req.Name
	tag.Color = req.Color
	tag.SortOrder = req.SortOrder
	if err := h.repo.UpdateTag(tag); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, tag)
}

func (h *ProxyPoolHandlers) DeleteTag(w http.ResponseWriter, r *http.Request) {
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid tag ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteTag(GetCurrentOrgID(r), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}

func (h *ProxyPoolHandlers) proxyGroupNameExists(orgID, exceptID uint, name string) (bool, error) {
	groups, err := h.repo.ListGroups(orgID)
	if err != nil {
		return false, err
	}
	for _, group := range groups {
		if group.ID != exceptID && strings.EqualFold(strings.TrimSpace(group.Name), name) {
			return true, nil
		}
	}
	return false, nil
}

func (h *ProxyPoolHandlers) proxyTagNameExists(orgID, exceptID uint, name string) (bool, error) {
	tags, err := h.repo.ListTags(orgID)
	if err != nil {
		return false, err
	}
	for _, tag := range tags {
		if tag.ID != exceptID && strings.EqualFold(strings.TrimSpace(tag.Name), name) {
			return true, nil
		}
	}
	return false, nil
}

func normalizeProxyDuplicatePolicy(policy string) string {
	switch strings.ToLower(strings.TrimSpace(policy)) {
	case "skip", "update":
		return strings.ToLower(strings.TrimSpace(policy))
	default:
		return "allow"
	}
}

func (h *ProxyPoolHandlers) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/proxy-pool", h.ListProxies).Methods("GET")
	router.HandleFunc("/proxy-pool", h.CreateProxy).Methods("POST")
	router.HandleFunc("/proxy-pool/bulk-import", h.BulkImport).Methods("POST")
	router.HandleFunc("/proxy-pool/test-batch", h.BatchTest).Methods("POST")
	router.HandleFunc("/proxy-pool/batch", h.BatchDelete).Methods("DELETE")
	router.HandleFunc("/proxy-pool/select", h.SelectProxy).Methods("POST")
	router.HandleFunc("/proxy-pool/check-channels", h.GetCheckChannels).Methods("GET")
	router.HandleFunc("/proxy-pool/{id}", h.GetProxy).Methods("GET")
	router.HandleFunc("/proxy-pool/{id}", h.UpdateProxy).Methods("PUT")
	router.HandleFunc("/proxy-pool/{id}", h.DeleteProxy).Methods("DELETE")
	router.HandleFunc("/proxy-pool/{id}/test", h.TestProxy).Methods("POST")

	router.HandleFunc("/proxy-groups", h.ListGroups).Methods("GET")
	router.HandleFunc("/proxy-groups", h.CreateGroup).Methods("POST")
	router.HandleFunc("/proxy-groups/{id}", h.UpdateGroup).Methods("PUT")
	router.HandleFunc("/proxy-groups/{id}", h.DeleteGroup).Methods("DELETE")
	router.HandleFunc("/proxy-tags", h.ListTags).Methods("GET")
	router.HandleFunc("/proxy-tags", h.CreateTag).Methods("POST")
	router.HandleFunc("/proxy-tags/{id}", h.UpdateTag).Methods("PUT")
	router.HandleFunc("/proxy-tags/{id}", h.DeleteTag).Methods("DELETE")
}

func proxyFilterFromRequest(r *http.Request) repository.ProxyPoolFilter {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	return repository.ProxyPoolFilter{
		Search:     q.Get("search"),
		Status:     q.Get("status"),
		Type:       q.Get("type"),
		GroupIDs:   parseUintList(q.Get("groupIds")),
		TagIDs:     parseUintList(q.Get("tagIds")),
		TagMode:    q.Get("tagMode"),
		UsageScope: q.Get("usageScope"),
		ExitIP:     q.Get("exitIp"),
		Page:       page,
		Limit:      limit,
		SortBy:     q.Get("sortBy"),
		SortOrder:  q.Get("sortOrder"),
	}
}

func parseMuxUint(r *http.Request, key string) (uint, error) {
	value := mux.Vars(r)[key]
	parsed, err := strconv.ParseUint(value, 10, 32)
	return uint(parsed), err
}

func parseUintList(value string) []uint {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	ids := make([]uint, 0, len(parts))
	for _, part := range parts {
		parsed, err := strconv.ParseUint(strings.TrimSpace(part), 10, 32)
		if err == nil && parsed > 0 {
			ids = append(ids, uint(parsed))
		}
	}
	return ids
}

func writeJSON(w http.ResponseWriter, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
