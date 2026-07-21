package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

type ProxyGatewayHandlers struct {
	repo    *repository.ProxyGatewayRepository
	service *services.ProxyGatewayService
}

func NewProxyGatewayHandlers(repo *repository.ProxyGatewayRepository, service *services.ProxyGatewayService) *ProxyGatewayHandlers {
	return &ProxyGatewayHandlers{repo: repo, service: service}
}

type proxyGatewayListResponse struct {
	Items interface{} `json:"items"`
	Total int64       `json:"total"`
	Page  int         `json:"page"`
	Limit int         `json:"limit"`
}

type proxyGatewayListenerRequest struct {
	Name                    string                      `json:"name"`
	ListenIP                string                      `json:"listenIp"`
	ExternalHost            string                      `json:"externalHost"`
	ExternalPort            int                         `json:"externalPort"`
	Port                    int                         `json:"port"`
	Protocol                models.ProxyGatewayProtocol `json:"protocol"`
	Enabled                 bool                        `json:"enabled"`
	IsDefault               bool                        `json:"isDefault"`
	AllowPublicListen       bool                        `json:"allowPublicListen"`
	RequireAuth             bool                        `json:"requireAuth"`
	SecurityPolicyID        *uint                       `json:"securityPolicyId"`
	DNSPolicyID             *uint                       `json:"dnsPolicyId"`
	HandshakeTimeoutSeconds int                         `json:"handshakeTimeoutSeconds"`
	IdleTimeoutSeconds      int                         `json:"idleTimeoutSeconds"`
	ConnectTimeoutSeconds   int                         `json:"connectTimeoutSeconds"`
	Metadata                models.JSONMapInterface     `json:"metadata"`
}

type proxyGatewayAccountRequest struct {
	Username                string                                `json:"username"`
	Password                string                                `json:"password"`
	Name                    string                                `json:"name"`
	Remark                  string                                `json:"remark"`
	Enabled                 bool                                  `json:"enabled"`
	ExpiresAt               *time.Time                            `json:"expiresAt"`
	AllowAllGateways        bool                                  `json:"allowAllGateways"`
	AllowedGatewayIDs       []uint                                `json:"allowedGatewayIds"`
	GroupID                 *uint                                 `json:"groupId"`
	TagIDs                  []uint                                `json:"tagIds"`
	SelectionMode           models.ProxyGatewaySelectionMode      `json:"selectionMode"`
	ProxyIDs                []uint                                `json:"proxyIds"`
	ProxyMatchGroupIDs      []uint                                `json:"proxyMatchGroupIds"`
	ProxyMatchTagIDs        []uint                                `json:"proxyMatchTagIds"`
	ProxyMatchTagMode       models.ProxyTagFilterMode             `json:"proxyMatchTagMode"`
	SelectionAlgorithm      models.ProxyGatewaySelectionAlgorithm `json:"selectionAlgorithm"`
	StickyMode              models.ProxyGatewayStickyMode         `json:"stickyMode"`
	StickyTTLSeconds        int                                   `json:"stickyTtlSeconds"`
	PreferLastSuccess       bool                                  `json:"preferLastSuccess"`
	FallbackMode            models.ProxyGatewayFallbackMode       `json:"fallbackMode"`
	FallbackProxyIDs        []uint                                `json:"fallbackProxyIds"`
	FallbackGroupIDs        []uint                                `json:"fallbackGroupIds"`
	FallbackTagIDs          []uint                                `json:"fallbackTagIds"`
	FallbackTagMode         models.ProxyTagFilterMode             `json:"fallbackTagMode"`
	MaxRetries              int                                   `json:"maxRetries"`
	AllowDirectFallback     bool                                  `json:"allowDirectFallback"`
	SecurityPolicyID        *uint                                 `json:"securityPolicyId"`
	DNSPolicyID             *uint                                 `json:"dnsPolicyId"`
	MaxConcurrent           int                                   `json:"maxConcurrent"`
	RateLimitPerMinute      int                                   `json:"rateLimitPerMinute"`
	BandwidthLimitKBps      int                                   `json:"bandwidthLimitKbps"`
	ConnectTimeoutSeconds   int                                   `json:"connectTimeoutSeconds"`
	IdleTimeoutSeconds      int                                   `json:"idleTimeoutSeconds"`
	MaxSessionSeconds       int                                   `json:"maxSessionSeconds"`
	EnableUsernameRouting   bool                                  `json:"enableUsernameRouting"`
	AllowAllRouteStrategies bool                                  `json:"allowAllRouteStrategies"`
	AllowedRouteStrategyIDs []uint                                `json:"allowedRouteStrategyIds"`
}

type proxyGatewayRouteStrategyRequest struct {
	GatewayID           uint                                  `json:"gatewayId"`
	Name                string                                `json:"name"`
	FlagNo              int                                   `json:"flagNo"`
	Description         string                                `json:"description"`
	Enabled             bool                                  `json:"enabled"`
	SelectionMode       models.ProxyGatewaySelectionMode      `json:"selectionMode"`
	ProxyIDs            []uint                                `json:"proxyIds"`
	ProxyMatchGroupIDs  []uint                                `json:"proxyMatchGroupIds"`
	ProxyMatchTagIDs    []uint                                `json:"proxyMatchTagIds"`
	ProxyMatchTagMode   models.ProxyTagFilterMode             `json:"proxyMatchTagMode"`
	SelectionAlgorithm  models.ProxyGatewaySelectionAlgorithm `json:"selectionAlgorithm"`
	StickyMode          models.ProxyGatewayStickyMode         `json:"stickyMode"`
	StickyTTLSeconds    int                                   `json:"stickyTtlSeconds"`
	PreferLastSuccess   bool                                  `json:"preferLastSuccess"`
	FallbackMode        models.ProxyGatewayFallbackMode       `json:"fallbackMode"`
	FallbackProxyIDs    []uint                                `json:"fallbackProxyIds"`
	FallbackGroupIDs    []uint                                `json:"fallbackGroupIds"`
	FallbackTagIDs      []uint                                `json:"fallbackTagIds"`
	FallbackTagMode     models.ProxyTagFilterMode             `json:"fallbackTagMode"`
	MaxRetries          int                                   `json:"maxRetries"`
	AllowDirectFallback bool                                  `json:"allowDirectFallback"`
	SecurityPolicyID    *uint                                 `json:"securityPolicyId"`
	DNSPolicyID         *uint                                 `json:"dnsPolicyId"`
	Metadata            models.JSONMapInterface               `json:"metadata"`
}

type proxyGatewayTargetRouteRequest struct {
	GatewayID       uint     `json:"gatewayId"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Enabled         bool     `json:"enabled"`
	IsDefault       bool     `json:"isDefault"`
	SortOrder       int      `json:"sortOrder"`
	Matchers        []string `json:"matchers"`
	RouteStrategyID uint     `json:"routeStrategyId"`
}

type proxyGatewayMetaRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Color       string `json:"color"`
	SortOrder   int    `json:"sortOrder"`
}

type proxyGatewayUsernameValidationRequest struct {
	Username  string `json:"username"`
	ExcludeID uint   `json:"excludeId"`
}

type proxyGatewayPasswordValidationRequest struct {
	Password string `json:"password"`
}

type proxyGatewayValidationResponse struct {
	Valid     bool   `json:"valid"`
	Available bool   `json:"available,omitempty"`
	Strength  string `json:"strength,omitempty"`
	Message   string `json:"message,omitempty"`
}

func (h *ProxyGatewayHandlers) ListListeners(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	_ = h.repo.EnsureDefaults(orgID)
	items, err := h.repo.ListListeners(orgID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, items)
}

func (h *ProxyGatewayHandlers) CreateListener(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyGatewayListenerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item := models.ProxyGatewayListener{OrgID: orgID}
	applyListenerRequest(&item, req)
	if message := validateProxyGatewayListener(item); message != "" {
		http.Error(w, message, http.StatusBadRequest)
		return
	}
	if err := h.repo.SaveListener(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.ensureGatewayDefaultsAndAssign(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "create", "listener", &item.ID, item.Name)
	_ = h.service.Reload(context.Background())
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) UpdateListener(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid listener ID", http.StatusBadRequest)
		return
	}
	item, err := h.repo.GetListener(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var req proxyGatewayListenerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	applyListenerRequest(item, req)
	if message := validateProxyGatewayListener(*item); message != "" {
		http.Error(w, message, http.StatusBadRequest)
		return
	}
	if err := h.repo.SaveListener(item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.ensureGatewayDefaultsAndAssign(item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "update", "listener", &item.ID, item.Name)
	_ = h.service.Reload(context.Background())
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) DeleteListener(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid listener ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteListener(orgID, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "delete", "listener", &id, "")
	_ = h.service.Reload(context.Background())
	writeJSON(w, map[string]bool{"success": true})
}

func applyListenerRequest(item *models.ProxyGatewayListener, req proxyGatewayListenerRequest) {
	item.Name = strings.TrimSpace(req.Name)
	if item.Name == "" {
		item.Name = "Proxy Gateway"
	}
	item.ListenIP = strings.TrimSpace(req.ListenIP)
	if item.ListenIP == "" {
		item.ListenIP = "127.0.0.1"
	}
	item.ExternalHost = strings.TrimSpace(req.ExternalHost)
	item.ExternalPort = req.ExternalPort
	item.Port = req.Port
	item.Protocol = models.NormalizeProxyGatewayProtocol(req.Protocol)
	item.Enabled = req.Enabled
	item.IsDefault = req.IsDefault
	item.AllowPublicListen = req.AllowPublicListen
	item.RequireAuth = req.RequireAuth
	item.SecurityPolicyID = req.SecurityPolicyID
	item.DNSPolicyID = req.DNSPolicyID
	item.HandshakeTimeoutSeconds = nonZeroAPI(req.HandshakeTimeoutSeconds, 10)
	item.IdleTimeoutSeconds = nonZeroAPI(req.IdleTimeoutSeconds, 120)
	item.ConnectTimeoutSeconds = nonZeroAPI(req.ConnectTimeoutSeconds, 30)
	item.Metadata = req.Metadata
}

func (h *ProxyGatewayHandlers) ListAccounts(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	filter := gatewayAccountFilterFromRequest(r)
	items, total, err := h.repo.ListAccounts(orgID, filter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, proxyGatewayListResponse{Items: items, Total: total, Page: filter.Page, Limit: filter.Limit})
}

func (h *ProxyGatewayHandlers) CreateAccount(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyGatewayAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Username) == "" || req.Password == "" {
		http.Error(w, "username and password are required", http.StatusBadRequest)
		return
	}
	if message := validateGatewayUsernameShape(strings.TrimSpace(req.Username)); message != "" {
		http.Error(w, message, http.StatusBadRequest)
		return
	}
	if available, err := h.repo.IsAccountUsernameAvailable(orgID, strings.TrimSpace(req.Username), 0); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	} else if !available {
		http.Error(w, "username already exists", http.StatusBadRequest)
		return
	}
	if valid, _, message := validateGatewayPasswordShape(req.Password); !valid {
		http.Error(w, message, http.StatusBadRequest)
		return
	}
	item := models.ProxyGatewayAccount{OrgID: orgID}
	applyAccountRequest(&item, req)
	if err := item.SetPassword(req.Password); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	item.Password = req.Password
	if err := h.repo.SaveAccount(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.repo.SetAccountTags(item.ID, req.TagIDs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	itemWithRelations, _ := h.repo.GetAccount(orgID, item.ID)
	h.audit(r, "create", "account", &item.ID, item.Username)
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, itemWithRelations)
}

func (h *ProxyGatewayHandlers) UpdateAccount(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}
	item, err := h.repo.GetAccount(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var req proxyGatewayAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if message := validateGatewayUsernameShape(strings.TrimSpace(req.Username)); message != "" {
		http.Error(w, message, http.StatusBadRequest)
		return
	}
	if available, err := h.repo.IsAccountUsernameAvailable(orgID, strings.TrimSpace(req.Username), item.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	} else if !available {
		http.Error(w, "username already exists", http.StatusBadRequest)
		return
	}
	if req.Password != "" {
		if valid, _, message := validateGatewayPasswordShape(req.Password); !valid {
			http.Error(w, message, http.StatusBadRequest)
			return
		}
	}
	applyAccountRequest(item, req)
	if req.Password != "" {
		if err := item.SetPassword(req.Password); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		item.Password = req.Password
	}
	if err := h.repo.SaveAccount(item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.repo.SetAccountTags(item.ID, req.TagIDs); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	itemWithRelations, _ := h.repo.GetAccount(orgID, item.ID)
	h.audit(r, "update", "account", &item.ID, item.Username)
	writeJSON(w, itemWithRelations)
}

func (h *ProxyGatewayHandlers) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteAccount(orgID, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "delete", "account", &id, "")
	writeJSON(w, map[string]bool{"success": true})
}

func (h *ProxyGatewayHandlers) ValidateAccountUsername(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyGatewayUsernameValidationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	username := strings.TrimSpace(req.Username)
	if message := validateGatewayUsernameShape(username); message != "" {
		writeJSON(w, proxyGatewayValidationResponse{Valid: false, Available: false, Message: message})
		return
	}
	available, err := h.repo.IsAccountUsernameAvailable(orgID, username, req.ExcludeID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	message := "用户名可用"
	if !available {
		message = "用户名已存在"
	}
	writeJSON(w, proxyGatewayValidationResponse{Valid: available, Available: available, Message: message})
}

func (h *ProxyGatewayHandlers) ValidateAccountPassword(w http.ResponseWriter, r *http.Request) {
	var req proxyGatewayPasswordValidationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	valid, strength, message := validateGatewayPasswordShape(req.Password)
	writeJSON(w, proxyGatewayValidationResponse{Valid: valid, Strength: strength, Message: message})
}

func applyAccountRequest(item *models.ProxyGatewayAccount, req proxyGatewayAccountRequest) {
	item.Username = strings.TrimSpace(req.Username)
	item.Name = req.Name
	item.Remark = req.Remark
	item.Enabled = req.Enabled
	item.ExpiresAt = req.ExpiresAt
	item.AllowAllGateways = req.AllowAllGateways
	item.AllowedGatewayIDs = models.UintSlice(req.AllowedGatewayIDs)
	item.GroupID = req.GroupID
	item.SelectionMode = req.SelectionMode
	if item.SelectionMode == "" {
		item.SelectionMode = models.ProxyGatewaySelectionFiltered
	}
	item.ProxyIDs = models.UintSlice(req.ProxyIDs)
	item.ProxyMatchGroupIDs = models.UintSlice(req.ProxyMatchGroupIDs)
	item.ProxyMatchTagIDs = models.UintSlice(req.ProxyMatchTagIDs)
	item.ProxyMatchTagMode = models.NormalizeProxyTagFilterMode(req.ProxyMatchTagMode)
	item.SelectionAlgorithm = req.SelectionAlgorithm
	if item.SelectionAlgorithm == "" {
		item.SelectionAlgorithm = models.ProxyGatewayAlgorithmRandom
	}
	item.StickyMode = req.StickyMode
	if item.StickyMode == "" {
		item.StickyMode = models.ProxyGatewayStickyNone
	}
	item.StickyTTLSeconds = nonZeroAPI(req.StickyTTLSeconds, 600)
	item.PreferLastSuccess = req.PreferLastSuccess
	item.FallbackMode = req.FallbackMode
	if item.FallbackMode == "" {
		item.FallbackMode = models.ProxyGatewayFallbackInterrupt
	}
	item.FallbackProxyIDs = models.UintSlice(req.FallbackProxyIDs)
	item.FallbackGroupIDs = models.UintSlice(req.FallbackGroupIDs)
	item.FallbackTagIDs = models.UintSlice(req.FallbackTagIDs)
	item.FallbackTagMode = models.NormalizeProxyTagFilterMode(req.FallbackTagMode)
	item.MaxRetries = req.MaxRetries
	item.AllowDirectFallback = req.AllowDirectFallback
	item.SecurityPolicyID = req.SecurityPolicyID
	item.DNSPolicyID = req.DNSPolicyID
	item.MaxConcurrent = req.MaxConcurrent
	item.RateLimitPerMinute = req.RateLimitPerMinute
	item.BandwidthLimitKBps = req.BandwidthLimitKBps
	item.ConnectTimeoutSeconds = nonZeroAPI(req.ConnectTimeoutSeconds, 30)
	item.IdleTimeoutSeconds = nonZeroAPI(req.IdleTimeoutSeconds, 120)
	item.MaxSessionSeconds = req.MaxSessionSeconds
	item.EnableUsernameRouting = req.EnableUsernameRouting
	item.AllowAllRouteStrategies = req.AllowAllRouteStrategies
	item.AllowedRouteStrategyIDs = models.UintSlice(req.AllowedRouteStrategyIDs)
}

func applyRouteStrategyRequest(item *models.ProxyGatewayRouteStrategy, req proxyGatewayRouteStrategyRequest) {
	if req.GatewayID != 0 {
		item.GatewayID = req.GatewayID
	}
	item.Name = strings.TrimSpace(req.Name)
	item.FlagNo = req.FlagNo
	item.Description = req.Description
	item.Enabled = req.Enabled
	item.SelectionMode = req.SelectionMode
	if item.SelectionMode == "" {
		item.SelectionMode = models.ProxyGatewaySelectionFiltered
	}
	item.ProxyIDs = models.UintSlice(req.ProxyIDs)
	item.ProxyMatchGroupIDs = models.UintSlice(req.ProxyMatchGroupIDs)
	item.ProxyMatchTagIDs = models.UintSlice(req.ProxyMatchTagIDs)
	item.ProxyMatchTagMode = models.NormalizeProxyTagFilterMode(req.ProxyMatchTagMode)
	item.SelectionAlgorithm = req.SelectionAlgorithm
	if item.SelectionAlgorithm == "" {
		item.SelectionAlgorithm = models.ProxyGatewayAlgorithmRandom
	}
	item.StickyMode = req.StickyMode
	if item.StickyMode == "" {
		item.StickyMode = models.ProxyGatewayStickyNone
	}
	item.StickyTTLSeconds = nonZeroAPI(req.StickyTTLSeconds, 600)
	item.PreferLastSuccess = req.PreferLastSuccess
	item.FallbackMode = req.FallbackMode
	if item.FallbackMode == "" {
		item.FallbackMode = models.ProxyGatewayFallbackInterrupt
	}
	item.FallbackProxyIDs = models.UintSlice(req.FallbackProxyIDs)
	item.FallbackGroupIDs = models.UintSlice(req.FallbackGroupIDs)
	item.FallbackTagIDs = models.UintSlice(req.FallbackTagIDs)
	item.FallbackTagMode = models.NormalizeProxyTagFilterMode(req.FallbackTagMode)
	item.MaxRetries = req.MaxRetries
	item.AllowDirectFallback = req.AllowDirectFallback
	item.SecurityPolicyID = req.SecurityPolicyID
	item.DNSPolicyID = req.DNSPolicyID
	item.Metadata = req.Metadata
}

func (h *ProxyGatewayHandlers) ListRouteStrategies(w http.ResponseWriter, r *http.Request) {
	gatewayID := gatewayIDFromRequest(r)
	items, err := h.repo.ListRouteStrategies(GetCurrentOrgID(r), gatewayID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, items)
}

func (h *ProxyGatewayHandlers) CreateRouteStrategy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyGatewayRouteStrategyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.GatewayID == 0 {
		req.GatewayID = gatewayIDFromRequestValue(r)
	}
	if req.GatewayID == 0 {
		http.Error(w, "gatewayId is required", http.StatusBadRequest)
		return
	}
	item := models.ProxyGatewayRouteStrategy{OrgID: orgID, GatewayID: req.GatewayID}
	applyRouteStrategyRequest(&item, req)
	if item.Name == "" || item.FlagNo <= 0 {
		http.Error(w, "name and positive flagNo are required", http.StatusBadRequest)
		return
	}
	if err := h.repo.SaveRouteStrategy(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.service.RefreshTargetRoutesByStrategy(orgID, item.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "create", "route_strategy", &item.ID, item.Name)
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) UpdateRouteStrategy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid route strategy ID", http.StatusBadRequest)
		return
	}
	item, err := h.repo.GetRouteStrategy(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var req proxyGatewayRouteStrategyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.GatewayID != 0 && req.GatewayID != item.GatewayID {
		http.Error(w, "route strategy cannot be moved to another gateway", http.StatusBadRequest)
		return
	}
	if req.GatewayID == 0 {
		req.GatewayID = item.GatewayID
	}
	applyRouteStrategyRequest(item, req)
	if item.Name == "" || item.FlagNo <= 0 {
		http.Error(w, "name and positive flagNo are required", http.StatusBadRequest)
		return
	}
	if !item.Enabled {
		count, err := h.repo.CountEnabledTargetRoutesByStrategy(orgID, item.ID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if count > 0 {
			http.Error(w, "route strategy is used by an enabled target route", http.StatusConflict)
			return
		}
	}
	if err := h.repo.SaveRouteStrategy(item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.service.RefreshTargetRoutesByStrategy(orgID, item.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "update", "route_strategy", &item.ID, item.Name)
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) DeleteRouteStrategy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid route strategy ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteRouteStrategy(orgID, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "delete", "route_strategy", &id, "")
	writeJSON(w, map[string]bool{"success": true})
}

func (h *ProxyGatewayHandlers) ListTargetRoutes(w http.ResponseWriter, r *http.Request) {
	gatewayID := gatewayIDFromRequest(r)
	items, err := h.repo.ListTargetRoutes(GetCurrentOrgID(r), gatewayID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, items)
}

func applyTargetRouteRequest(item *models.ProxyGatewayTargetRoute, req proxyGatewayTargetRouteRequest) error {
	if req.GatewayID != 0 {
		item.GatewayID = req.GatewayID
	}
	item.Name = strings.TrimSpace(req.Name)
	item.Description = strings.TrimSpace(req.Description)
	item.Enabled = req.Enabled
	item.IsDefault = req.IsDefault
	item.SortOrder = req.SortOrder
	item.RouteStrategyID = req.RouteStrategyID
	if item.Name == "" || item.GatewayID == 0 || item.RouteStrategyID == 0 {
		return errors.New("name, gatewayId and routeStrategyId are required")
	}
	if item.SortOrder < 0 {
		return errors.New("sortOrder must not be negative")
	}
	if item.IsDefault {
		item.Matchers = models.StringSlice{}
		return nil
	}
	seen := map[string]struct{}{}
	normalized := make(models.StringSlice, 0, len(req.Matchers))
	for _, raw := range req.Matchers {
		matcher, err := models.NormalizeProxyGatewayTargetMatcher(raw)
		if err != nil {
			return fmt.Errorf("invalid target matcher %q: %w", raw, err)
		}
		if _, ok := seen[matcher]; ok {
			continue
		}
		seen[matcher] = struct{}{}
		normalized = append(normalized, matcher)
	}
	if len(normalized) == 0 {
		return errors.New("a non-default target route requires at least one domain, IP, or CIDR matcher")
	}
	item.Matchers = normalized
	return nil
}

func (h *ProxyGatewayHandlers) validateTargetRouteReferences(orgID uint, item *models.ProxyGatewayTargetRoute) error {
	if _, err := h.repo.GetListener(orgID, item.GatewayID); err != nil {
		return fmt.Errorf("gateway %d is unavailable", item.GatewayID)
	}
	strategy, err := h.repo.GetRouteStrategy(orgID, item.RouteStrategyID)
	if err != nil {
		return fmt.Errorf("route strategy %d is unavailable", item.RouteStrategyID)
	}
	if strategy.GatewayID != 0 && strategy.GatewayID != item.GatewayID {
		return errors.New("route strategy belongs to another gateway")
	}
	if item.Enabled && !strategy.Enabled {
		return errors.New("an enabled target route requires an enabled route strategy")
	}
	return nil
}

func (h *ProxyGatewayHandlers) CreateTargetRoute(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyGatewayTargetRouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.GatewayID == 0 {
		req.GatewayID = gatewayIDFromRequestValue(r)
	}
	item := models.ProxyGatewayTargetRoute{OrgID: orgID, GatewayID: req.GatewayID}
	if err := applyTargetRouteRequest(&item, req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.validateTargetRouteReferences(orgID, &item); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.repo.SaveTargetRoute(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.service.RefreshTargetRoutes(orgID, item.GatewayID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "create", "target_route", &item.ID, item.Name)
	created, err := h.repo.GetTargetRoute(orgID, item.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, created)
}

func (h *ProxyGatewayHandlers) UpdateTargetRoute(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid target route ID", http.StatusBadRequest)
		return
	}
	item, err := h.repo.GetTargetRoute(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	var req proxyGatewayTargetRouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.GatewayID != 0 && req.GatewayID != item.GatewayID {
		http.Error(w, "target route cannot be moved to another gateway", http.StatusBadRequest)
		return
	}
	if req.GatewayID == 0 {
		req.GatewayID = item.GatewayID
	}
	if err := applyTargetRouteRequest(item, req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.validateTargetRouteReferences(orgID, item); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.repo.SaveTargetRoute(item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.service.RefreshTargetRoutes(orgID, item.GatewayID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "update", "target_route", &item.ID, item.Name)
	updated, err := h.repo.GetTargetRoute(orgID, item.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, updated)
}

func (h *ProxyGatewayHandlers) DeleteTargetRoute(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid target route ID", http.StatusBadRequest)
		return
	}
	item, err := h.repo.GetTargetRoute(orgID, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if err := h.repo.DeleteTargetRoute(orgID, id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.service.RefreshTargetRoutes(orgID, item.GatewayID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "delete", "target_route", &id, item.Name)
	writeJSON(w, map[string]bool{"success": true})
}

func (h *ProxyGatewayHandlers) ListAccountGroups(w http.ResponseWriter, r *http.Request) {
	items, err := h.repo.ListAccountGroups(GetCurrentOrgID(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, items)
}

func (h *ProxyGatewayHandlers) CreateAccountGroup(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyGatewayMetaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item := models.ProxyGatewayAccountGroup{OrgID: orgID, Name: strings.TrimSpace(req.Name), Description: req.Description, Color: req.Color, SortOrder: req.SortOrder}
	if item.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if err := h.repo.SaveAccountGroup(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) UpdateAccountGroup(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}
	var req proxyGatewayMetaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item := models.ProxyGatewayAccountGroup{ID: id, OrgID: orgID, Name: strings.TrimSpace(req.Name), Description: req.Description, Color: req.Color, SortOrder: req.SortOrder}
	if err := h.repo.SaveAccountGroup(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) DeleteAccountGroup(w http.ResponseWriter, r *http.Request) {
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid group ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteAccountGroup(GetCurrentOrgID(r), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}

func (h *ProxyGatewayHandlers) ListAccountTags(w http.ResponseWriter, r *http.Request) {
	items, err := h.repo.ListAccountTags(GetCurrentOrgID(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, items)
}

func (h *ProxyGatewayHandlers) CreateAccountTag(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var req proxyGatewayMetaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item := models.ProxyGatewayAccountTag{OrgID: orgID, Name: strings.TrimSpace(req.Name), Color: req.Color, SortOrder: req.SortOrder}
	if item.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if err := h.repo.SaveAccountTag(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) UpdateAccountTag(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid tag ID", http.StatusBadRequest)
		return
	}
	var req proxyGatewayMetaRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item := models.ProxyGatewayAccountTag{ID: id, OrgID: orgID, Name: strings.TrimSpace(req.Name), Color: req.Color, SortOrder: req.SortOrder}
	if err := h.repo.SaveAccountTag(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) DeleteAccountTag(w http.ResponseWriter, r *http.Request) {
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid tag ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteAccountTag(GetCurrentOrgID(r), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}

func (h *ProxyGatewayHandlers) ListSecurityPolicies(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	_ = h.repo.EnsureDefaults(orgID)
	gatewayID := gatewayIDFromRequest(r)
	if gatewayID != nil {
		_ = h.repo.EnsureGatewayDefaults(orgID, *gatewayID)
	}
	items, err := h.repo.ListSecurityPolicies(orgID, gatewayID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, items)
}

func (h *ProxyGatewayHandlers) SaveSecurityPolicy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var item models.ProxyGatewaySecurityPolicy
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item.OrgID = orgID
	if item.GatewayID == 0 {
		item.GatewayID = gatewayIDFromRequestValue(r)
	}
	if item.GatewayID == 0 {
		http.Error(w, "gatewayId is required", http.StatusBadRequest)
		return
	}
	if id, err := parseOptionalMuxUint(r, "id"); err == nil && id != 0 {
		item.ID = id
	}
	if item.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	normalizeProxyGatewaySecurityPolicy(&item)
	if message := validateProxyGatewaySecurityPolicy(item); message != "" {
		http.Error(w, message, http.StatusBadRequest)
		return
	}
	if err := h.repo.SaveSecurityPolicy(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "save", "security_policy", &item.ID, item.Name)
	_ = h.service.Reload(context.Background())
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) DeleteSecurityPolicy(w http.ResponseWriter, r *http.Request) {
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid policy ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteSecurityPolicy(GetCurrentOrgID(r), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "delete", "security_policy", &id, "")
	_ = h.service.Reload(context.Background())
	writeJSON(w, map[string]bool{"success": true})
}

func (h *ProxyGatewayHandlers) ListDNSPolicies(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	_ = h.repo.EnsureDefaults(orgID)
	gatewayID := gatewayIDFromRequest(r)
	if gatewayID != nil {
		_ = h.repo.EnsureGatewayDefaults(orgID, *gatewayID)
	}
	items, err := h.repo.ListDNSPolicies(orgID, gatewayID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, items)
}

func (h *ProxyGatewayHandlers) SaveDNSPolicy(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var item models.ProxyGatewayDNSPolicy
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	item.OrgID = orgID
	if item.GatewayID == 0 {
		item.GatewayID = gatewayIDFromRequestValue(r)
	}
	if item.GatewayID == 0 {
		http.Error(w, "gatewayId is required", http.StatusBadRequest)
		return
	}
	if id, err := parseOptionalMuxUint(r, "id"); err == nil && id != 0 {
		item.ID = id
	}
	if item.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	normalizeProxyGatewayDNSPolicy(&item)
	if message := validateProxyGatewayDNSPolicy(item); message != "" {
		http.Error(w, message, http.StatusBadRequest)
		return
	}
	if err := h.repo.SaveDNSPolicy(&item); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "save", "dns_policy", &item.ID, item.Name)
	_ = h.service.Reload(context.Background())
	writeJSON(w, item)
}

func (h *ProxyGatewayHandlers) DeleteDNSPolicy(w http.ResponseWriter, r *http.Request) {
	id, err := parseMuxUint(r, "id")
	if err != nil {
		http.Error(w, "Invalid policy ID", http.StatusBadRequest)
		return
	}
	if err := h.repo.DeleteDNSPolicy(GetCurrentOrgID(r), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "delete", "dns_policy", &id, "")
	_ = h.service.Reload(context.Background())
	writeJSON(w, map[string]bool{"success": true})
}

func (h *ProxyGatewayHandlers) ListAccessLogs(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	filter := gatewayLogFilterFromRequest(r)
	items, total, err := h.repo.ListAccessLogs(orgID, filter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, proxyGatewayListResponse{Items: items, Total: total, Page: filter.Page, Limit: filter.Limit})
}

func (h *ProxyGatewayHandlers) ListAuditLogs(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := h.repo.ListAuditLogs(GetCurrentOrgID(r), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, items)
}

func (h *ProxyGatewayHandlers) GetStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, h.service.Status())
}

func (h *ProxyGatewayHandlers) Reload(w http.ResponseWriter, r *http.Request) {
	if err := h.service.Reload(context.Background()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.audit(r, "reload", "runtime", nil, "Proxy Gateway 热加载")
	writeJSON(w, map[string]interface{}{"success": true, "status": h.service.Status()})
}

func (h *ProxyGatewayHandlers) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/proxy-gateway/listeners", h.ListListeners).Methods("GET")
	router.HandleFunc("/proxy-gateway/listeners", h.CreateListener).Methods("POST")
	router.HandleFunc("/proxy-gateway/listeners/{id}", h.UpdateListener).Methods("PUT")
	router.HandleFunc("/proxy-gateway/listeners/{id}", h.DeleteListener).Methods("DELETE")

	router.HandleFunc("/proxy-gateway/accounts", h.ListAccounts).Methods("GET")
	router.HandleFunc("/proxy-gateway/accounts", h.CreateAccount).Methods("POST")
	router.HandleFunc("/proxy-gateway/accounts/validate-username", h.ValidateAccountUsername).Methods("POST")
	router.HandleFunc("/proxy-gateway/accounts/validate-password", h.ValidateAccountPassword).Methods("POST")
	router.HandleFunc("/proxy-gateway/accounts/{id}", h.UpdateAccount).Methods("PUT")
	router.HandleFunc("/proxy-gateway/accounts/{id}", h.DeleteAccount).Methods("DELETE")
	router.HandleFunc("/proxy-gateway/route-strategies", h.ListRouteStrategies).Methods("GET")
	router.HandleFunc("/proxy-gateway/route-strategies", h.CreateRouteStrategy).Methods("POST")
	router.HandleFunc("/proxy-gateway/route-strategies/{id}", h.UpdateRouteStrategy).Methods("PUT")
	router.HandleFunc("/proxy-gateway/route-strategies/{id}", h.DeleteRouteStrategy).Methods("DELETE")
	router.HandleFunc("/proxy-gateway/target-routes", h.ListTargetRoutes).Methods("GET")
	router.HandleFunc("/proxy-gateway/target-routes", h.CreateTargetRoute).Methods("POST")
	router.HandleFunc("/proxy-gateway/target-routes/{id}", h.UpdateTargetRoute).Methods("PUT")
	router.HandleFunc("/proxy-gateway/target-routes/{id}", h.DeleteTargetRoute).Methods("DELETE")
	router.HandleFunc("/proxy-gateway/account-groups", h.ListAccountGroups).Methods("GET")
	router.HandleFunc("/proxy-gateway/account-groups", h.CreateAccountGroup).Methods("POST")
	router.HandleFunc("/proxy-gateway/account-groups/{id}", h.UpdateAccountGroup).Methods("PUT")
	router.HandleFunc("/proxy-gateway/account-groups/{id}", h.DeleteAccountGroup).Methods("DELETE")
	router.HandleFunc("/proxy-gateway/account-tags", h.ListAccountTags).Methods("GET")
	router.HandleFunc("/proxy-gateway/account-tags", h.CreateAccountTag).Methods("POST")
	router.HandleFunc("/proxy-gateway/account-tags/{id}", h.UpdateAccountTag).Methods("PUT")
	router.HandleFunc("/proxy-gateway/account-tags/{id}", h.DeleteAccountTag).Methods("DELETE")

	router.HandleFunc("/proxy-gateway/security-policies", h.ListSecurityPolicies).Methods("GET")
	router.HandleFunc("/proxy-gateway/security-policies", h.SaveSecurityPolicy).Methods("POST")
	router.HandleFunc("/proxy-gateway/security-policies/{id}", h.SaveSecurityPolicy).Methods("PUT")
	router.HandleFunc("/proxy-gateway/security-policies/{id}", h.DeleteSecurityPolicy).Methods("DELETE")
	router.HandleFunc("/proxy-gateway/dns-policies", h.ListDNSPolicies).Methods("GET")
	router.HandleFunc("/proxy-gateway/dns-policies", h.SaveDNSPolicy).Methods("POST")
	router.HandleFunc("/proxy-gateway/dns-policies/{id}", h.SaveDNSPolicy).Methods("PUT")
	router.HandleFunc("/proxy-gateway/dns-policies/{id}", h.DeleteDNSPolicy).Methods("DELETE")

	router.HandleFunc("/proxy-gateway/logs", h.ListAccessLogs).Methods("GET")
	router.HandleFunc("/proxy-gateway/audit-logs", h.ListAuditLogs).Methods("GET")
	router.HandleFunc("/proxy-gateway/status", h.GetStatus).Methods("GET")
	router.HandleFunc("/proxy-gateway/reload", h.Reload).Methods("POST")
}

func gatewayAccountFilterFromRequest(r *http.Request) repository.ProxyGatewayAccountFilter {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	var enabled *bool
	if q.Get("enabled") != "" {
		value := q.Get("enabled") == "true"
		enabled = &value
	}
	return repository.ProxyGatewayAccountFilter{
		Search:   q.Get("search"),
		Enabled:  enabled,
		GroupIDs: parseUintList(q.Get("groupIds")),
		TagIDs:   parseUintList(q.Get("tagIds")),
		TagMode:  q.Get("tagMode"),
		Page:     page,
		Limit:    limit,
	}
}

func gatewayLogFilterFromRequest(r *http.Request) repository.ProxyGatewayLogFilter {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	filter := repository.ProxyGatewayLogFilter{
		Status:   q.Get("status"),
		Protocol: q.Get("protocol"),
		Search:   q.Get("search"),
		Page:     page,
		Limit:    limit,
	}
	if accountID, err := strconv.Atoi(q.Get("accountId")); err == nil && accountID > 0 {
		value := uint(accountID)
		filter.AccountID = &value
	}
	if listenerID, err := strconv.Atoi(q.Get("listenerId")); err == nil && listenerID > 0 {
		value := uint(listenerID)
		filter.ListenerID = &value
	}
	return filter
}

func gatewayIDFromRequest(r *http.Request) *uint {
	value := gatewayIDFromRequestValue(r)
	if value == 0 {
		return nil
	}
	return &value
}

func gatewayIDFromRequestValue(r *http.Request) uint {
	for _, key := range []string{"gatewayId", "listenerId"} {
		if parsed, err := strconv.Atoi(r.URL.Query().Get(key)); err == nil && parsed > 0 {
			return uint(parsed)
		}
	}
	return 0
}

func (h *ProxyGatewayHandlers) ensureGatewayDefaultsAndAssign(item *models.ProxyGatewayListener) error {
	if item == nil || item.ID == 0 {
		return nil
	}
	if err := h.repo.EnsureGatewayDefaults(item.OrgID, item.ID); err != nil {
		return err
	}
	changed := false
	if item.SecurityPolicyID == nil {
		if policy, err := h.repo.GetDefaultSecurityPolicy(item.OrgID, item.ID); err == nil && policy.ID != 0 {
			item.SecurityPolicyID = &policy.ID
			changed = true
		}
	}
	if item.DNSPolicyID == nil {
		if policy, err := h.repo.GetDefaultDNSPolicy(item.OrgID, item.ID); err == nil && policy.ID != 0 {
			item.DNSPolicyID = &policy.ID
			changed = true
		}
	}
	if changed {
		return h.repo.SaveListener(item)
	}
	return nil
}

func validateProxyGatewayListener(item models.ProxyGatewayListener) string {
	if item.Port <= 0 || item.Port > 65535 {
		return "监听端口必须在 1 到 65535 之间"
	}
	if item.ExternalPort < 0 || item.ExternalPort > 65535 {
		return "外部访问端口必须留空或在 1 到 65535 之间"
	}
	if item.AllowPublicListen && !isLoopbackListenIP(item.ListenIP) && !item.RequireAuth {
		return "公开监听必须启用代理账号认证，避免暴露为开放代理"
	}
	if !item.AllowPublicListen && !isLoopbackListenIP(item.ListenIP) {
		return "非本机监听需要先启用公开监听确认"
	}
	return ""
}

func isLoopbackListenIP(host string) bool {
	host = strings.TrimSpace(host)
	if host == "" || strings.EqualFold(host, "localhost") {
		return true
	}
	if strings.Contains(host, "/") {
		ip, _, err := net.ParseCIDR(host)
		return err == nil && ip.IsLoopback()
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func normalizeProxyGatewaySecurityPolicy(item *models.ProxyGatewaySecurityPolicy) {
	if item.NoMatchAction == "" {
		item.NoMatchAction = models.ProxyGatewayPolicyDeny
	}
}

func normalizeProxyGatewayDNSPolicy(item *models.ProxyGatewayDNSPolicy) {
	if item.Mode == "" {
		item.Mode = models.ProxyGatewayDNSRemote
	}
	if item.MultiIPStrategy == "" {
		item.MultiIPStrategy = models.ProxyGatewayMultiIPCheckAll
	}
	if item.ResolveFailureAction == "" {
		item.ResolveFailureAction = models.ProxyGatewayResolveFailureDeny
	}
}

func validateProxyGatewaySecurityPolicy(item models.ProxyGatewaySecurityPolicy) string {
	for _, cidr := range append([]string{}, item.SourceAllowCIDRs...) {
		if !validIPOrCIDR(cidr) {
			return "来源允许 CIDR 格式无效: " + cidr
		}
	}
	for _, cidr := range append([]string{}, item.SourceDenyCIDRs...) {
		if !validIPOrCIDR(cidr) {
			return "来源拒绝 CIDR 格式无效: " + cidr
		}
	}
	for _, pattern := range append([]string{}, item.TargetPortAllowlist...) {
		if !validPortPattern(pattern) {
			return "目标端口允许规则无效: " + pattern
		}
	}
	for _, pattern := range append([]string{}, item.TargetPortDenylist...) {
		if !validPortPattern(pattern) {
			return "目标端口拒绝规则无效: " + pattern
		}
	}
	switch item.NoMatchAction {
	case "", models.ProxyGatewayPolicyAllow, models.ProxyGatewayPolicyDeny, models.ProxyGatewayPolicyLogOnly:
	default:
		return "未匹配动作无效"
	}
	return ""
}

func validateProxyGatewayDNSPolicy(item models.ProxyGatewayDNSPolicy) string {
	switch item.Mode {
	case "", models.ProxyGatewayDNSRemote, models.ProxyGatewayDNSLocal, models.ProxyGatewayDNSCustom:
	default:
		return "DNS 解析模式无效"
	}
	if item.Mode == models.ProxyGatewayDNSCustom && len(item.Resolvers) == 0 {
		return "自定义 DNS 模式至少需要配置一个 resolver"
	}
	for _, resolver := range item.Resolvers {
		if !validResolverAddress(resolver) {
			return "DNS resolver 地址无效: " + resolver
		}
	}
	if item.CacheTTLSeconds < 0 || item.NegativeTTLSeconds < 0 {
		return "DNS TTL 不能为负数"
	}
	switch item.MultiIPStrategy {
	case "", models.ProxyGatewayMultiIPCheckAll, models.ProxyGatewayMultiIPFirstOnly, models.ProxyGatewayMultiIPRejectAny:
	default:
		return "多 IP 策略无效"
	}
	switch item.ResolveFailureAction {
	case "", models.ProxyGatewayResolveFailureDeny, models.ProxyGatewayResolveFailureUseRemoteProxy:
	default:
		return "解析失败动作无效"
	}
	return ""
}

func validIPOrCIDR(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return true
	}
	if ip := net.ParseIP(value); ip != nil {
		return true
	}
	_, _, err := net.ParseCIDR(value)
	return err == nil
}

func validPortPattern(pattern string) bool {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" || pattern == "*" {
		return true
	}
	if strings.Contains(pattern, "-") {
		parts := strings.SplitN(pattern, "-", 2)
		if len(parts) != 2 {
			return false
		}
		start, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
		end, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
		return err1 == nil && err2 == nil && start >= 1 && end <= 65535 && start <= end
	}
	port, err := strconv.Atoi(pattern)
	return err == nil && port >= 1 && port <= 65535
}

func validResolverAddress(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	host := value
	if h, port, err := net.SplitHostPort(value); err == nil {
		host = h
		parsedPort, parseErr := strconv.Atoi(port)
		if parseErr != nil || parsedPort < 1 || parsedPort > 65535 {
			return false
		}
	} else if strings.Count(value, ":") == 1 {
		parts := strings.SplitN(value, ":", 2)
		if parsedPort, parseErr := strconv.Atoi(parts[1]); parseErr == nil {
			host = parts[0]
			if parsedPort < 1 || parsedPort > 65535 {
				return false
			}
		}
	}
	if host == "" {
		return false
	}
	if strings.Contains(host, "/") {
		return false
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		return true
	}
	return strings.Contains(host, ".") || strings.EqualFold(host, "localhost")
}

func validateGatewayUsernameShape(username string) string {
	if username == "" {
		return "用户名不能为空"
	}
	if len(username) < 3 || len(username) > 64 {
		return "用户名长度需要在 3 到 64 个字符之间"
	}
	for _, r := range username {
		if r <= 32 || r == ':' || r == '#' || r == '?' || r == '/' || r == '\\' || r == '@' {
			return "用户名不能包含空白、冒号、#、?、/、\\ 或 @"
		}
	}
	return ""
}

func validateGatewayPasswordShape(password string) (bool, string, string) {
	if len(password) < 8 {
		return false, "weak", "密码至少需要 8 个字符"
	}
	score := 0
	checks := []func(rune) bool{
		func(r rune) bool { return r >= 'a' && r <= 'z' },
		func(r rune) bool { return r >= 'A' && r <= 'Z' },
		func(r rune) bool { return r >= '0' && r <= '9' },
		func(r rune) bool { return strings.ContainsRune("!@#$%^&*()-_=+[]{};:,.<>/?", r) },
	}
	for _, check := range checks {
		for _, r := range password {
			if check(r) {
				score++
				break
			}
		}
	}
	if score < 2 {
		return false, "weak", "密码需要至少包含两类字符"
	}
	if len(password) >= 12 && score >= 3 {
		return true, "strong", "密码强度良好"
	}
	return true, "medium", "密码可用"
}

func parseOptionalMuxUint(r *http.Request, key string) (uint, error) {
	value := mux.Vars(r)[key]
	if value == "" {
		return 0, nil
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	return uint(parsed), err
}

func (h *ProxyGatewayHandlers) audit(r *http.Request, action, resource string, resourceID *uint, summary string) {
	orgID := GetCurrentOrgID(r)
	var userID *uint
	if user := GetCurrentUser(r); user != nil {
		id := user.ID
		userID = &id
	}
	_ = h.repo.CreateAuditLog(&models.ProxyGatewayAuditLog{
		OrgID:       orgID,
		ActorUserID: userID,
		Action:      action,
		Resource:    resource,
		ResourceID:  resourceID,
		Summary:     summary,
	})
}

func nonZeroAPI(value, fallback int) int {
	if value != 0 {
		return value
	}
	return fallback
}
