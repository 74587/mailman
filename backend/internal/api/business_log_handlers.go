package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"mailman/internal/repository"
	"mailman/internal/services"

	"github.com/gorilla/mux"
)

type BusinessLogHandler struct {
	repo       *repository.BusinessLogRepository
	configRepo *repository.SystemConfigRepository
	pipeline   *services.BusinessLogPipeline
}

func NewBusinessLogHandler(
	repo *repository.BusinessLogRepository,
	configRepo *repository.SystemConfigRepository,
	pipeline *services.BusinessLogPipeline,
) *BusinessLogHandler {
	return &BusinessLogHandler{
		repo:       repo,
		configRepo: configRepo,
		pipeline:   pipeline,
	}
}

func (h *BusinessLogHandler) ListLogs(w http.ResponseWriter, r *http.Request) {
	query := h.parseQuery(r)
	result, err := h.repo.List(query)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}
	RespondWithJSON(w, http.StatusOK, result)
}

func (h *BusinessLogHandler) GetLog(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(mux.Vars(r)["id"])
	if err != nil || id <= 0 {
		RespondWithError(w, http.StatusBadRequest, "invalid log id")
		return
	}
	item, err := h.repo.GetByID(GetCurrentOrgID(r), uint(id))
	if err != nil {
		RespondWithError(w, http.StatusNotFound, err.Error())
		return
	}
	RespondWithJSON(w, http.StatusOK, item)
}

func (h *BusinessLogHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	query := h.parseQuery(r)
	stats, err := h.repo.Stats(query)
	if err != nil {
		RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}
	RespondWithJSON(w, http.StatusOK, stats)
}

func (h *BusinessLogHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	RespondWithJSON(w, http.StatusOK, h.loadConfig())
}

func (h *BusinessLogHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var requested services.BusinessLogConfig
	if err := json.NewDecoder(r.Body).Decode(&requested); err != nil {
		RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if h.configRepo == nil {
		RespondWithError(w, http.StatusInternalServerError, "config repository is not configured")
		return
	}

	config := sanitizeBusinessLogConfig(requested)
	if user := GetCurrentUser(r); user == nil || !user.IsSuperAdmin {
		current := h.loadConfig()
		orgKey := strconv.FormatUint(uint64(GetCurrentOrgID(r)), 10)
		if current.OrganizationConfigs == nil {
			current.OrganizationConfigs = map[string]services.BusinessLogScopeConfig{}
		}
		if config.OrganizationConfigs != nil {
			current.OrganizationConfigs[orgKey] = config.OrganizationConfigs[orgKey]
		} else {
			current.OrganizationConfigs[orgKey] = services.BusinessLogScopeConfig{}
		}
		config = current
	}

	if err := h.configRepo.UpdateValue(services.BusinessLogSettingsKey, config); err != nil {
		RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}
	RespondWithJSON(w, http.StatusOK, config)
}

func (h *BusinessLogHandler) loadConfig() services.BusinessLogConfig {
	config := services.DefaultBusinessLogConfig()
	if h.configRepo != nil {
		if value, err := h.configRepo.GetValueByKey(services.BusinessLogSettingsKey); err == nil && value != nil {
			bytes, _ := json.Marshal(value)
			_ = json.Unmarshal(bytes, &config)
		}
	}
	return sanitizeBusinessLogConfig(config)
}

func sanitizeBusinessLogConfig(config services.BusinessLogConfig) services.BusinessLogConfig {
	defaults := services.DefaultBusinessLogConfig()
	if config.SensitiveFields == nil {
		config.SensitiveFields = defaults.SensitiveFields
	}
	if config.ModuleLimits == nil {
		config.ModuleLimits = map[string]int{}
	}
	if config.Modules == nil {
		config.Modules = map[string]services.BusinessLogModuleConfig{}
	}
	if config.OrganizationConfigs == nil {
		config.OrganizationConfigs = map[string]services.BusinessLogScopeConfig{}
	}
	if config.DetailLevel == "" {
		config.DetailLevel = defaults.DetailLevel
	}
	if config.ReviewMiddlewareMode == "" {
		config.ReviewMiddlewareMode = defaults.ReviewMiddlewareMode
	}
	return config
}

func (h *BusinessLogHandler) TestPipeline(w http.ResponseWriter, r *http.Request) {
	var event services.BusinessLogEvent
	if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
		RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if event.OrgID == 0 {
		event.OrgID = GetCurrentOrgID(r)
	}
	if event.UserID == nil {
		event.UserID = getUserIDFromContext(r)
	}
	event.Enforceable = true
	result := h.pipeline.Process(r.Context(), event)
	RespondWithJSON(w, http.StatusOK, result)
}

func (h *BusinessLogHandler) parseQuery(r *http.Request) repository.BusinessLogQuery {
	q := r.URL.Query()
	query := repository.BusinessLogQuery{
		OrgID:         GetCurrentOrgID(r),
		Query:         q.Get("q"),
		Module:        q.Get("module"),
		Action:        q.Get("action"),
		Status:        q.Get("status"),
		OperationType: q.Get("operation_type"),
		ActorType:     q.Get("actor_type"),
		EntityType:    q.Get("entity_type"),
		EntityID:      q.Get("entity_id"),
		TraceID:       q.Get("trace_id"),
		RunID:         q.Get("run_id"),
		Limit:         parseIntDefault(q.Get("limit"), 50),
		Offset:        parseIntDefault(q.Get("offset"), 0),
	}
	if beforeID := parseIntDefault(q.Get("before_id"), 0); beforeID > 0 {
		query.BeforeID = uint(beforeID)
	}
	if afterID := parseIntDefault(q.Get("after_id"), 0); afterID > 0 {
		query.AfterID = uint(afterID)
	}
	if userID := q.Get("user_id"); userID != "" {
		if id, err := strconv.Atoi(userID); err == nil && id > 0 {
			uid := uint(id)
			query.UserID = &uid
		}
	}
	if from := parseQueryTime(q.Get("from")); from != nil {
		query.From = from
	}
	if to := parseQueryTime(q.Get("to")); to != nil {
		query.To = to
	}
	if query.Status == "" && q.Get("result") != "" {
		query.Status = q.Get("result")
	}
	return query
}
