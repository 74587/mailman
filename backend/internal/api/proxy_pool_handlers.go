package api

import (
	"context"
	"encoding/json"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

type ProxyPoolHandlers struct {
	repo          *repository.ProxyPoolRepository
	service       *services.ProxyPoolService
	bulkCheckOnce sync.Once
	bulkCheckJobs chan proxyBulkCheckJob
}

func NewProxyPoolHandlers(repo *repository.ProxyPoolRepository, service *services.ProxyPoolService) *ProxyPoolHandlers {
	return &ProxyPoolHandlers{
		repo:          repo,
		service:       service,
		bulkCheckJobs: make(chan proxyBulkCheckJob, 256),
	}
}

type proxyBulkCheckJob struct {
	item    models.ProxyPoolItem
	channel string
}

type proxyListResponse struct {
	Items          []models.ProxyPoolItem         `json:"items"`
	Total          int64                          `json:"total"`
	Page           int                            `json:"page"`
	Limit          int                            `json:"limit"`
	TrafficSummary repository.ProxyTrafficSummary `json:"trafficSummary"`
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

type proxyCheckChannelRequest struct {
	Key            string         `json:"key"`
	Name           string         `json:"name"`
	Provider       string         `json:"provider"`
	Description    string         `json:"description"`
	Mode           string         `json:"mode"`
	URLTemplate    string         `json:"urlTemplate"`
	Method         string         `json:"method"`
	ResponseFormat string         `json:"responseFormat"`
	IPField        string         `json:"ipField"`
	CountryField   string         `json:"countryField"`
	RegionField    string         `json:"regionField"`
	CityField      string         `json:"cityField"`
	ISPField       string         `json:"ispField"`
	StatusField    string         `json:"statusField"`
	FailureValue   string         `json:"failureValue"`
	MessageField   string         `json:"messageField"`
	Headers        models.JSONMap `json:"headers"`
	AuthType       string         `json:"authType"`
	AuthName       string         `json:"authName"`
	Credential     *string        `json:"credential"`
	Enabled        bool           `json:"enabled"`
	SupportsIPv4   bool           `json:"supportsIPv4"`
	SupportsIPv6   bool           `json:"supportsIPv6"`
	TimeoutSeconds int            `json:"timeoutSeconds"`
	SortOrder      int            `json:"sortOrder"`
}

var proxyCheckChannelKeyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

const (
	maxSynchronousBulkChecks = 20
	bulkCheckWorkerCount     = 12
)

func (h *ProxyPoolHandlers) ListProxies(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	filter := repository.NormalizeProxyPoolFilter(proxyFilterFromRequest(r))
	items, total, err := h.repo.List(orgID, filter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	trafficSummary, err := h.repo.SumTraffic(orgID, filter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, proxyListResponse{Items: items, Total: total, Page: filter.Page, Limit: filter.Limit, TrafficSummary: trafficSummary})
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
	tagIDs := uniqueProxyImportIDs(req.TagIDs)
	parsed := h.service.ParseBulk(req.Content, req.DefaultType, req.GroupID, tagIDs, orgID)
	submittedCount := len(parsed.Proxies) + len(parsed.Errors)
	created := make([]models.ProxyPoolItem, 0, len(parsed.Proxies))
	checks := []services.ProxyCheckResult{}
	duplicatePolicy := normalizeProxyDuplicatePolicy(req.DuplicatePolicy)
	updatedCount := 0
	skippedCount := 0
	newItems := make([]*models.ProxyPoolItem, 0, len(parsed.Proxies))
	type pendingExistingUpdate struct {
		item    *models.ProxyPoolItem
		count   int
		content string
	}
	if err := h.repo.Transaction(func(txRepo *repository.ProxyPoolRepository) error {
		existingByKey := map[string]*models.ProxyPoolItem{}
		if duplicatePolicy != "allow" {
			existing, err := txRepo.FindDuplicatesForImport(orgID, parsed.Proxies)
			if err != nil {
				return err
			}
			for i := range existing {
				existingByKey[proxyImportDuplicateKey(existing[i])] = &existing[i]
			}
		}
		pendingByKey := map[string]int{}
		pendingExisting := map[string]*pendingExistingUpdate{}
		pendingExistingOrder := make([]string, 0)
		for i := range parsed.Proxies {
			item := parsed.Proxies[i]
			item.Tags = nil
			key := proxyImportDuplicateKey(item)
			duplicate := existingByKey[key]
			if duplicate == nil {
				if pendingIndex, exists := pendingByKey[key]; exists {
					switch duplicatePolicy {
					case "skip":
						skippedCount++
						continue
					case "update":
						*newItems[pendingIndex] = item
						updatedCount++
						continue
					}
				}
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
					pending := pendingExisting[key]
					if pending == nil {
						pending = &pendingExistingUpdate{item: duplicate}
						pendingExisting[key] = pending
						pendingExistingOrder = append(pendingExistingOrder, key)
					}
					pending.count++
					pending.content = item.DisplayAddress()
					continue
				}
			}
			newItems = append(newItems, &item)
			if duplicatePolicy != "allow" {
				pendingByKey[key] = len(newItems) - 1
			}
		}
		for _, key := range pendingExistingOrder {
			pending := pendingExisting[key]
			err := txRepo.Transaction(func(itemRepo *repository.ProxyPoolRepository) error {
				if err := itemRepo.Update(pending.item); err != nil {
					return err
				}
				return itemRepo.SetProxyTags(pending.item.ID, tagIDs)
			})
			if err != nil {
				parsed.Errors = append(parsed.Errors, services.ProxyParseError{Line: 0, Content: pending.content, Error: err.Error()})
				continue
			}
			created = append(created, *pending.item)
			updatedCount += pending.count
		}
		return txRepo.BatchCreateWithTags(newItems, tagIDs)
	}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	for _, item := range newItems {
		created = append(created, *item)
	}
	queuedChecks := 0
	if req.CheckProxy {
		if len(created) <= maxSynchronousBulkChecks {
			for i := range created {
				checks = append(checks, h.service.TestProxy(context.Background(), &created[i], req.Channel, 12*time.Second))
			}
		} else {
			queuedChecks = len(created)
			h.queueBulkProxyChecks(created, req.Channel)
		}
	}
	processedCount := len(newItems) + updatedCount + skippedCount
	writeJSON(w, proxyBulkImportResponse{
		Created: created,
		Errors:  parsed.Errors,
		Checks:  checks,
		Summary: map[string]interface{}{
			"processed":   processedCount,
			"created":     len(newItems),
			"updated":     updatedCount,
			"skipped":     skippedCount,
			"errors":      len(parsed.Errors),
			"submitted":   submittedCount,
			"checkQueued": queuedChecks,
		},
	})
}

// queueBulkProxyChecks keeps large imports independent from upstream HTTP
// timeouts. Imports are already durable at this point; one handler-wide bounded
// worker pool updates each proxy's check state in the background.
func (h *ProxyPoolHandlers) queueBulkProxyChecks(items []models.ProxyPoolItem, channel string) {
	queued := append([]models.ProxyPoolItem(nil), items...)
	h.bulkCheckOnce.Do(func() {
		for i := 0; i < bulkCheckWorkerCount; i++ {
			go func() {
				for job := range h.bulkCheckJobs {
					h.service.TestProxy(context.Background(), &job.item, job.channel, 12*time.Second)
				}
			}()
		}
	})
	go func() {
		for _, item := range queued {
			h.bulkCheckJobs <- proxyBulkCheckJob{item: item, channel: channel}
		}
	}()
}

func proxyImportDuplicateKey(item models.ProxyPoolItem) string {
	return fmt.Sprintf("%s\x00%s\x00%d\x00%s", models.NormalizeProxyType(item.Type), strings.ToLower(item.Host), item.Port, item.Username)
}

func uniqueProxyImportIDs(ids []uint) []uint {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[uint]struct{}, len(ids))
	unique := make([]uint, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return unique
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
		ids, err := h.repo.ListIDs(orgID, req.Filter)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		for _, id := range ids {
			item, err := h.repo.GetByID(orgID, id)
			if err == nil && item != nil {
				items = append(items, *item)
			}
		}
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
	includeDisabled, _ := strconv.ParseBool(r.URL.Query().Get("includeDisabled"))
	channels, err := h.service.ListCheckChannels(GetCurrentOrgID(r), includeDisabled)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, channels)
}

func (h *ProxyPoolHandlers) CreateCheckChannel(w http.ResponseWriter, r *http.Request) {
	var req proxyCheckChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	channel := &models.ProxyCheckChannel{OrgID: GetCurrentOrgID(r)}
	if err := applyProxyCheckChannelRequest(channel, req, true); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.repo.CreateCheckChannel(channel); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	channel.HasCredential = channel.AuthValue != ""
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, channel)
}

func (h *ProxyPoolHandlers) UpdateCheckChannel(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid check channel ID", http.StatusBadRequest)
		return
	}
	channel, err := h.repo.GetCheckChannelByID(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var req proxyCheckChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := applyProxyCheckChannelRequest(channel, req, false); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.repo.UpdateCheckChannel(channel); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	channel.HasCredential = channel.AuthValue != ""
	writeJSON(w, channel)
}

func (h *ProxyPoolHandlers) DeleteCheckChannel(w http.ResponseWriter, r *http.Request) {
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid check channel ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteCheckChannel(GetCurrentOrgID(r), id); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]bool{"success": true})
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

func applyProxyCheckChannelRequest(channel *models.ProxyCheckChannel, req proxyCheckChannelRequest, creating bool) error {
	if creating {
		channel.Key = strings.ToLower(strings.TrimSpace(req.Key))
		if !proxyCheckChannelKeyPattern.MatchString(channel.Key) {
			return fmt.Errorf("channel key must use lowercase letters, numbers, and hyphens")
		}
	}
	channel.Name = strings.TrimSpace(req.Name)
	if channel.Name == "" {
		return fmt.Errorf("channel name is required")
	}
	channel.Provider = strings.TrimSpace(req.Provider)
	channel.Description = strings.TrimSpace(req.Description)
	channel.Mode = strings.ToLower(strings.TrimSpace(req.Mode))
	if channel.Mode != "self" && channel.Mode != "lookup" {
		return fmt.Errorf("channel mode must be self or lookup")
	}
	channel.URLTemplate = strings.TrimSpace(req.URLTemplate)
	parsedURL, err := url.Parse(strings.ReplaceAll(strings.ReplaceAll(channel.URLTemplate, "{{ip}}", "127.0.0.1"), "{{credential}}", "credential"))
	if err != nil || parsedURL.Scheme != "http" && parsedURL.Scheme != "https" || parsedURL.Host == "" {
		return fmt.Errorf("channel URL must be a valid HTTP/HTTPS URL")
	}
	if parsedURL.User != nil {
		return fmt.Errorf("channel URL cannot contain embedded credentials; use the authentication fields")
	}
	if channel.Mode == "lookup" && !strings.Contains(channel.URLTemplate, "{{ip}}") {
		return fmt.Errorf("lookup channel URL must include {{ip}}")
	}
	channel.Method = strings.ToUpper(strings.TrimSpace(req.Method))
	if channel.Method == "" {
		channel.Method = http.MethodGet
	}
	if channel.Method != http.MethodGet {
		return fmt.Errorf("only GET check channels are supported")
	}
	channel.ResponseFormat = strings.ToLower(strings.TrimSpace(req.ResponseFormat))
	if channel.ResponseFormat != "json" && channel.ResponseFormat != "text" {
		return fmt.Errorf("response format must be json or text")
	}
	channel.IPField = strings.TrimSpace(req.IPField)
	if channel.Mode == "self" && channel.ResponseFormat == "json" && channel.IPField == "" {
		return fmt.Errorf("JSON self check channels require an IP field")
	}
	channel.CountryField = strings.TrimSpace(req.CountryField)
	channel.RegionField = strings.TrimSpace(req.RegionField)
	channel.CityField = strings.TrimSpace(req.CityField)
	channel.ISPField = strings.TrimSpace(req.ISPField)
	channel.StatusField = strings.TrimSpace(req.StatusField)
	channel.FailureValue = strings.TrimSpace(req.FailureValue)
	channel.MessageField = strings.TrimSpace(req.MessageField)
	channel.Headers = req.Headers
	channel.AuthType = strings.ToLower(strings.TrimSpace(req.AuthType))
	if channel.AuthType == "" {
		channel.AuthType = "none"
	}
	switch channel.AuthType {
	case "none", "bearer", "query", "header", "path":
	default:
		return fmt.Errorf("unsupported channel authentication type")
	}
	channel.AuthName = strings.TrimSpace(req.AuthName)
	if (channel.AuthType == "query" || channel.AuthType == "header") && channel.AuthName == "" {
		return fmt.Errorf("authentication parameter/header name is required")
	}
	if channel.AuthType == "path" && !strings.Contains(channel.URLTemplate, "{{credential}}") {
		return fmt.Errorf("path authentication requires {{credential}} in the URL")
	}
	if req.Credential != nil {
		channel.AuthValue = services.EncryptIfAvailable(strings.TrimSpace(*req.Credential))
	}
	channel.Enabled = req.Enabled
	if channel.Enabled && channel.AuthType == "path" && strings.TrimSpace(channel.AuthValue) == "" {
		return fmt.Errorf("path-authenticated channels require a credential before they can be enabled")
	}
	channel.SupportsIPv4 = req.SupportsIPv4
	channel.SupportsIPv6 = req.SupportsIPv6
	if !channel.SupportsIPv4 && !channel.SupportsIPv6 {
		return fmt.Errorf("channel must support at least one IP version")
	}
	channel.TimeoutSeconds = req.TimeoutSeconds
	if channel.TimeoutSeconds <= 0 {
		channel.TimeoutSeconds = 12
	}
	if channel.TimeoutSeconds > 120 {
		return fmt.Errorf("channel timeout cannot exceed 120 seconds")
	}
	channel.SortOrder = req.SortOrder
	return nil
}

func (h *ProxyPoolHandlers) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/proxy-pool", h.ListProxies).Methods("GET")
	router.HandleFunc("/proxy-pool", h.CreateProxy).Methods("POST")
	router.HandleFunc("/proxy-pool/bulk-import", h.BulkImport).Methods("POST")
	router.HandleFunc("/proxy-pool/test-batch", h.BatchTest).Methods("POST")
	router.HandleFunc("/proxy-pool/batch", h.BatchDelete).Methods("DELETE")
	router.HandleFunc("/proxy-pool/select", h.SelectProxy).Methods("POST")
	router.HandleFunc("/proxy-pool/check-channels", h.GetCheckChannels).Methods("GET")
	router.HandleFunc("/proxy-pool/check-channels", h.CreateCheckChannel).Methods("POST")
	router.HandleFunc("/proxy-pool/check-channels/{id}", h.UpdateCheckChannel).Methods("PUT")
	router.HandleFunc("/proxy-pool/check-channels/{id}", h.DeleteCheckChannel).Methods("DELETE")
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
