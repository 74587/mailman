package api

import (
	"encoding/json"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"mailman/internal/triggerv2/plugins"
	"mailman/internal/utils"
	"net/http"
)

// getUserIDFromContext extracts user ID from request context
func getUserIDFromContext(r *http.Request) *uint {
	user, ok := r.Context().Value(UserContextKey).(*models.User)
	if !ok || user == nil {
		return nil
	}
	return &user.ID
}

// HealthCheck godoc
// @Summary Show the status of server.
// @Description get the status of server.
// @Tags root
// @Accept */*
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/health [get]
func HealthCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

type APIHandler struct {
	Fetcher             *services.FetcherService
	Parser              *services.ParserService
	EmailAccountRepo    *repository.EmailAccountRepository
	MailProviderRepo    *repository.MailProviderRepository
	EmailRepo           *repository.EmailRepository
	EmailIngestService  *services.EmailIngestService
	PickupService       *services.PickupService
	ProxyPoolService    *services.ProxyPoolService
	SyncConfigRepo      *repository.SyncConfigRepository
	IncrementalSyncRepo *repository.IncrementalSyncRepository
	EmailScheduler      *services.EmailFetchScheduler
	activityLogger      *services.ActivityLogger
	pluginManager       plugins.PluginManager
	logger              *utils.Logger

	// 新增的同步管理器
	optimizedSyncManager  *services.OptimizedIncrementalSyncManager
	perAccountSyncManager *services.PerAccountSyncManager
}

func (h *APIHandler) SetPickupService(pickupService *services.PickupService) {
	h.PickupService = pickupService
}

func (h *APIHandler) SetProxyPoolService(proxyPoolService *services.ProxyPoolService) {
	h.ProxyPoolService = proxyPoolService
	if h.Fetcher != nil {
		h.Fetcher.SetProxyPoolService(proxyPoolService)
	}
}

func NewAPIHandler(
	fetcher *services.FetcherService,
	parser *services.ParserService,
	emailAccountRepo *repository.EmailAccountRepository,
	mailProviderRepo *repository.MailProviderRepository,
	emailRepo *repository.EmailRepository,
	incrementalSyncRepo *repository.IncrementalSyncRepository,
	emailScheduler *services.EmailFetchScheduler,
	pluginManager plugins.PluginManager,
	optimizedSyncManager *services.OptimizedIncrementalSyncManager,
	perAccountSyncManager *services.PerAccountSyncManager,
	syncConfigRepo *repository.SyncConfigRepository,
	emailIngestService *services.EmailIngestService,
) *APIHandler {
	return &APIHandler{
		Fetcher:               fetcher,
		Parser:                parser,
		EmailAccountRepo:      emailAccountRepo,
		MailProviderRepo:      mailProviderRepo,
		EmailRepo:             emailRepo,
		EmailIngestService:    emailIngestService,
		SyncConfigRepo:        syncConfigRepo,
		IncrementalSyncRepo:   incrementalSyncRepo,
		EmailScheduler:        emailScheduler,
		activityLogger:        services.GetActivityLogger(),
		pluginManager:         pluginManager,
		logger:                utils.NewLogger("APIHandler"),
		optimizedSyncManager:  optimizedSyncManager,
		perAccountSyncManager: perAccountSyncManager,
	}
}
