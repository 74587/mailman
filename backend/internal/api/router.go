package api

import (
	"net/http"
	"os"
	"strings"

	"github.com/gorilla/mux"
	httpSwagger "github.com/swaggo/http-swagger"
)

// NewRouter creates a new router with all the necessary routes.
func NewRouter(handler *APIHandler, openAIHandler *OpenAIHandler, wsHandler *WebSocketHandler, syncHandlers *SyncHandlers, pickupHandler *PickupHandler) http.Handler {
	router := mux.NewRouter()

	// Create API subrouter with /api prefix
	apiRouter := router.PathPrefix("/api").Subrouter()

	// Plugin management
	apiRouter.HandleFunc("/plugins", handler.ListPluginsHandler).Methods("GET")
	apiRouter.HandleFunc("/plugins/ui/schemas", handler.GetPluginUISchemas).Methods("GET")
	apiRouter.HandleFunc("/plugins/ui/schema", handler.GetPluginUISchema).Methods("GET")
	apiRouter.HandleFunc("/plugins/{pluginID}/callbacks/{callback}", handler.HandlePluginCallback).Methods("POST")

	// Health check
	apiRouter.HandleFunc("/health", HealthCheck).Methods("GET")

	// Account management
	apiRouter.HandleFunc("/accounts", handler.CreateAccountHandler).Methods("POST")
	apiRouter.HandleFunc("/accounts", handler.GetAccountsHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/paginated", handler.GetAccountsPaginatedHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/exists", handler.AccountExistsHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/alias-capabilities", handler.ListEmailAliasCapabilitiesHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/forwarded-addresses", handler.ListAccountForwardedAddressesHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/forwarded-addresses", handler.SetAccountForwardedAddressesHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/forwarded-addresses", handler.AddAccountForwardedAddressHandler).Methods("POST")
	apiRouter.HandleFunc("/accounts/forwarded-addresses", handler.RemoveAccountForwardedAddressHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/by-email/{email}/forwarded-addresses", handler.ListAccountForwardedAddressesHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/by-email/{email}/forwarded-addresses", handler.SetAccountForwardedAddressesHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/by-email/{email}/forwarded-addresses", handler.AddAccountForwardedAddressHandler).Methods("POST")
	apiRouter.HandleFunc("/accounts/by-email/{email}/forwarded-addresses", handler.RemoveAccountForwardedAddressHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/{id}/forwarded-addresses", handler.ListAccountForwardedAddressesHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}/forwarded-addresses", handler.SetAccountForwardedAddressesHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/{id}/forwarded-addresses", handler.AddAccountForwardedAddressHandler).Methods("POST")
	apiRouter.HandleFunc("/accounts/{id}/forwarded-addresses", handler.RemoveAccountForwardedAddressHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/domain-config", handler.GetAccountDomainConfigHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/domain-config", handler.SetAccountDomainConfigHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/domain-config", handler.DeleteAccountDomainConfigHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/by-email/{email}/domain-config", handler.GetAccountDomainConfigHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/by-email/{email}/domain-config", handler.SetAccountDomainConfigHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/by-email/{email}/domain-config", handler.DeleteAccountDomainConfigHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/{id}/domain-config", handler.GetAccountDomainConfigHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}/domain-config", handler.SetAccountDomainConfigHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/{id}/domain-config", handler.DeleteAccountDomainConfigHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/proxy-config", handler.GetAccountProxyConfigHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/proxy-config", handler.SetAccountProxyConfigHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/proxy-config", handler.DeleteAccountProxyConfigHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/by-email/{email}/proxy-config", handler.GetAccountProxyConfigHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/by-email/{email}/proxy-config", handler.SetAccountProxyConfigHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/by-email/{email}/proxy-config", handler.DeleteAccountProxyConfigHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/{id}/proxy-config", handler.GetAccountProxyConfigHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}/proxy-config", handler.SetAccountProxyConfigHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/{id}/proxy-config", handler.DeleteAccountProxyConfigHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/oauth2/onboard", handler.CreateOAuth2AccountOnboardingHandler).Methods("POST")
	apiRouter.HandleFunc("/accounts/batch-outlook-import", handler.StartBatchOutlookImportHandler).Methods("POST")
	apiRouter.HandleFunc("/accounts/batch-outlook-import/{jobID}", handler.GetBatchOutlookImportJobHandler).Methods("GET")
	apiRouter.HandleFunc("/business-modules", handler.ListBusinessModulesHandler).Methods("GET")
	apiRouter.HandleFunc("/business-modules", handler.CreateBusinessModuleHandler).Methods("POST")
	apiRouter.HandleFunc("/business-modules/{id}/email-accounts/claim", handler.ClaimBusinessModuleEmailAccountHandler).Methods("POST")
	apiRouter.HandleFunc("/business-modules/{id}", handler.GetBusinessModuleHandler).Methods("GET")
	apiRouter.HandleFunc("/business-modules/{id}", handler.UpdateBusinessModuleHandler).Methods("PUT")
	apiRouter.HandleFunc("/business-modules/{id}", handler.DeleteBusinessModuleHandler).Methods("DELETE")
	apiRouter.HandleFunc("/business-accounts", handler.ListBusinessAccountsHandler).Methods("GET")
	apiRouter.HandleFunc("/business-accounts", handler.CreateBusinessAccountHandler).Methods("POST")
	apiRouter.HandleFunc("/business-accounts/{id}/complete-registration", handler.CompleteBusinessRegistrationHandler).Methods("POST")
	apiRouter.HandleFunc("/business-accounts/{id}/release-registration-claim", handler.ReleaseBusinessRegistrationClaimHandler).Methods("POST")
	apiRouter.HandleFunc("/business-accounts/{id}/renew-registration-claim", handler.RenewBusinessRegistrationClaimHandler).Methods("POST")
	apiRouter.HandleFunc("/business-accounts/{id}", handler.GetBusinessAccountHandler).Methods("GET")
	apiRouter.HandleFunc("/business-accounts/{id}", handler.UpdateBusinessAccountHandler).Methods("PUT")
	apiRouter.HandleFunc("/business-accounts/{id}", handler.DeleteBusinessAccountHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/{id}/business-accounts", handler.ListEmailAccountBusinessAccountsHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}", handler.GetAccountHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}", handler.UpdateAccountHandler).Methods("PUT")
	apiRouter.HandleFunc("/accounts/{id}", handler.DeleteAccountHandler).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/verify", handler.VerifyAccountHandler).Methods("POST")
	apiRouter.HandleFunc("/accounts/batch-verify", handler.BatchVerifyAccountsHandler).Methods("POST")

	// Account-specific email operations (moved to account-emails category)
	apiRouter.HandleFunc("/account-emails/fetch/{id}", handler.FetchAndStoreEmailsHandler).Methods("POST")
	// 新增：获取所有邮件的路由（必须放在参数路由之前）
	apiRouter.HandleFunc("/account-emails/list/all", handler.GetAllEmailsHandler).Methods("GET")
	apiRouter.HandleFunc("/account-emails/folders", handler.GetEmailFoldersHandler).Methods("GET")
	apiRouter.HandleFunc("/account-emails/list/{id}", handler.GetEmailsHandler).Methods("GET")
	apiRouter.HandleFunc("/account-emails/extract/{id}", handler.ExtractEmailsHandler).Methods("POST")
	apiRouter.HandleFunc("/accounts/{id}/sync-records", handler.GetIncrementalSyncRecordsHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}/last-sync-record", handler.GetLastSyncRecordHandler).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}/sync-records", handler.DeleteIncrementalSyncRecordHandler).Methods("DELETE")

	// General email operations
	apiRouter.HandleFunc("/emails/extract", handler.ExtractEmailsHandler).Methods("POST")                      // Global extract without account ID
	apiRouter.HandleFunc("/emails/search", handler.SearchEmailsHandler).Methods("GET")                         // New search endpoint with optional account ID
	apiRouter.HandleFunc("/emails/{id}/trigger", handler.TriggerEmailHandler).Methods("POST")                  // Manual trigger for email event (must be before /emails/{id})
	apiRouter.HandleFunc("/emails/{id}/sync-attachments", handler.SyncEmailAttachmentsHandler).Methods("POST") // Sync email attachments
	apiRouter.HandleFunc("/emails/{id}", handler.GetEmailHandler).Methods("GET")

	// Legacy endpoint
	apiRouter.HandleFunc("/fetch-emails", handler.FetchEmailsHandler).Methods("POST")

	// Random email endpoint
	apiRouter.HandleFunc("/random-email", handler.RandomEmailHandler).Methods("GET")

	// Wait email endpoint
	apiRouter.HandleFunc("/wait-email", handler.WaitEmailHandler).Methods("POST")

	// Check email endpoint (simplified for frontend polling)
	apiRouter.HandleFunc("/check-email", handler.CheckEmailHandler).Methods("POST")

	// WebSocket endpoint for waiting emails
	apiRouter.HandleFunc("/ws/wait-email", handler.WaitEmailWebSocketHandler).Methods("GET")

	// HTTP polling endpoint (fallback for WebSocket)
	apiRouter.HandleFunc("/poll-email", handler.PollEmailHandler).Methods("POST")

	// WebSocket endpoint for subscription-based monitoring
	apiRouter.HandleFunc("/ws/subscriptions", handler.SubscriptionWebSocketHandler).Methods("GET")

	// Email domains endpoint
	apiRouter.HandleFunc("/email-domains", handler.GetEmailDomainsHandler).Methods("GET")

	// Mail providers
	apiRouter.HandleFunc("/providers", handler.GetProvidersHandler).Methods("GET")
	apiRouter.HandleFunc("/providers", handler.CreateProviderHandler).Methods("POST")

	// Extractor templates
	apiRouter.HandleFunc("/extractor-templates", handler.CreateExtractorTemplateHandler).Methods("POST")
	apiRouter.HandleFunc("/extractor-templates", handler.GetExtractorTemplatesHandler).Methods("GET")
	apiRouter.HandleFunc("/extractor-templates/paginated", handler.GetExtractorTemplatesPaginatedHandler).Methods("GET")
	apiRouter.HandleFunc("/extractor-templates/{id}", handler.GetExtractorTemplateHandler).Methods("GET")
	apiRouter.HandleFunc("/extractor-templates/{id}", handler.UpdateExtractorTemplateHandler).Methods("PUT")
	apiRouter.HandleFunc("/extractor-templates/{id}", handler.DeleteExtractorTemplateHandler).Methods("DELETE")
	apiRouter.HandleFunc("/extractor-templates/{id}/test", handler.TestExtractorTemplateHandler).Methods("POST")

	// OpenAI Configuration endpoints
	apiRouter.HandleFunc("/openai/configs", openAIHandler.ListOpenAIConfigs).Methods("GET")
	apiRouter.HandleFunc("/openai/configs", openAIHandler.CreateOpenAIConfig).Methods("POST")
	apiRouter.HandleFunc("/openai/configs/{id}", openAIHandler.GetOpenAIConfig).Methods("GET")
	apiRouter.HandleFunc("/openai/configs/{id}", openAIHandler.UpdateOpenAIConfig).Methods("PUT")
	apiRouter.HandleFunc("/openai/configs/{id}", openAIHandler.DeleteOpenAIConfig).Methods("DELETE")

	// AI Prompt Template endpoints
	apiRouter.HandleFunc("/openai/prompt-templates", openAIHandler.ListAIPromptTemplates).Methods("GET")
	apiRouter.HandleFunc("/openai/prompt-templates", openAIHandler.CreateAIPromptTemplate).Methods("POST")
	apiRouter.HandleFunc("/openai/prompt-templates/{id}", openAIHandler.GetAIPromptTemplate).Methods("GET")
	apiRouter.HandleFunc("/openai/prompt-templates/{id}", openAIHandler.UpdateAIPromptTemplate).Methods("PUT")
	apiRouter.HandleFunc("/openai/prompt-templates/{id}", openAIHandler.DeleteAIPromptTemplate).Methods("DELETE")

	// AI Generation endpoints
	apiRouter.HandleFunc("/openai/generate-template", openAIHandler.GenerateEmailTemplate).Methods("POST")
	apiRouter.HandleFunc("/openai/initialize-templates", openAIHandler.InitializeDefaultPromptTemplates).Methods("POST")
	apiRouter.HandleFunc("/openai/call", openAIHandler.CallOpenAI).Methods("POST")
	apiRouter.HandleFunc("/openai/call/stream", openAIHandler.StreamOpenAI).Methods("POST")
	apiRouter.HandleFunc("/openai/test-config", openAIHandler.TestOpenAIConfig).Methods("POST")

	// Email subscription endpoints
	apiRouter.HandleFunc("/subscriptions", handler.CreateSubscriptionHandler).Methods("POST")
	apiRouter.HandleFunc("/subscriptions", handler.GetSubscriptionsHandler).Methods("GET")
	apiRouter.HandleFunc("/subscriptions/{id}", handler.DeleteSubscriptionHandler).Methods("DELETE")

	// Cache statistics endpoint
	apiRouter.HandleFunc("/cache/stats", handler.GetCacheStatsHandler).Methods("GET")

	// Dashboard statistics endpoint
	apiRouter.HandleFunc("/dashboard/stats", handler.GetEmailStatsHandler).Methods("GET")

	// Immediate email fetch endpoint
	apiRouter.HandleFunc("/emails/fetch-now", handler.FetchNowHandler).Methods("POST")

	// WebSocket和通知相关端点
	apiRouter.HandleFunc("/ws/notifications", wsHandler.HandleWebSocket)
	apiRouter.HandleFunc("/notifications/stats", wsHandler.HandleNotificationStats).Methods("GET")
	apiRouter.HandleFunc("/notifications/recent", wsHandler.HandleRecentNotifications).Methods("GET")

	// 同步监控相关端点
	apiRouter.HandleFunc("/sync/queue-metrics", handler.GetQueueMetricsHandler).Methods("GET")
	apiRouter.HandleFunc("/sync/account-status", handler.GetAccountSyncStatusHandler).Methods("GET")
	apiRouter.HandleFunc("/sync/account-status/batch", handler.GetAccountSyncStatusBatchHandler).Methods("POST")
	apiRouter.HandleFunc("/sync/manager-stats", handler.GetSyncManagerStatsHandler).Methods("GET")

	// Sync configuration endpoints
	apiRouter.HandleFunc("/accounts/{id}/sync-config", syncHandlers.GetAccountSyncConfig).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}/sync-config", syncHandlers.CreateAccountSyncConfig).Methods("POST")
	apiRouter.HandleFunc("/accounts/{id}/sync-config", syncHandlers.UpdateAccountSyncConfig).Methods("PUT")
	apiRouter.HandleFunc("/accounts/{id}/sync-config", syncHandlers.DeleteAccountSyncConfig).Methods("DELETE")
	apiRouter.HandleFunc("/accounts/{id}/sync-config/effective", syncHandlers.GetEffectiveSyncConfig).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}/sync-config/temporary", syncHandlers.CreateTemporarySyncConfig).Methods("POST")
	apiRouter.HandleFunc("/accounts/{id}/sync-now", syncHandlers.SyncNow).Methods("POST")
	apiRouter.HandleFunc("/accounts/{id}/sync-statistics", syncHandlers.GetSyncStatistics).Methods("GET")
	apiRouter.HandleFunc("/accounts/{id}/mailboxes", syncHandlers.GetAccountMailboxes).Methods("GET")

	// Sync global configuration
	apiRouter.HandleFunc("/sync/global-config", syncHandlers.GetGlobalSyncConfig).Methods("GET")
	apiRouter.HandleFunc("/sync/global-config", syncHandlers.UpdateGlobalSyncConfig).Methods("PUT")
	apiRouter.HandleFunc("/sync/configs", syncHandlers.GetAllSyncConfigs).Methods("GET")

	// Batch sync configuration
	apiRouter.HandleFunc("/sync/batch-config", syncHandlers.BatchCreateOrUpdateAccountSyncConfig).Methods("POST")
	apiRouter.HandleFunc("/sync/bulk-account-config", syncHandlers.BulkApplyAccountSyncConfig).Methods("POST")

	// Pickup poll endpoint
	apiRouter.HandleFunc("/pickup/poll", pickupHandler.PollHandler).Methods("POST")

	// Filter templates
	apiRouter.HandleFunc("/filter-templates", handler.ListFilterTemplatesHandler).Methods("GET")
	apiRouter.HandleFunc("/filter-templates", handler.CreateFilterTemplateHandler).Methods("POST")
	apiRouter.HandleFunc("/filter-templates/categories", handler.GetFilterTemplateCategoriesHandler).Methods("GET")
	apiRouter.HandleFunc("/filter-templates/{id}", handler.GetFilterTemplateHandler).Methods("GET")
	apiRouter.HandleFunc("/filter-templates/{id}", handler.UpdateFilterTemplateHandler).Methods("PUT")
	apiRouter.HandleFunc("/filter-templates/{id}", handler.DeleteFilterTemplateHandler).Methods("DELETE")
	apiRouter.HandleFunc("/filter-templates/{id}/increment-usage", handler.IncrementFilterTemplateUsageHandler).Methods("POST")

	// Action templates
	apiRouter.HandleFunc("/action-templates", handler.ListActionTemplatesHandler).Methods("GET")
	apiRouter.HandleFunc("/action-templates", handler.CreateActionTemplateHandler).Methods("POST")
	apiRouter.HandleFunc("/action-templates/categories", handler.GetActionTemplateCategoriesHandler).Methods("GET")
	apiRouter.HandleFunc("/action-templates/{id}", handler.GetActionTemplateHandler).Methods("GET")
	apiRouter.HandleFunc("/action-templates/{id}", handler.UpdateActionTemplateHandler).Methods("PUT")
	apiRouter.HandleFunc("/action-templates/{id}", handler.DeleteActionTemplateHandler).Methods("DELETE")
	apiRouter.HandleFunc("/action-templates/{id}/increment-usage", handler.IncrementActionTemplateUsageHandler).Methods("POST")

	// Extractor Templates V2
	extractorV2Handler := NewExtractorTemplateV2Handler(nil)
	RegisterExtractorTemplateV2Routes(apiRouter, extractorV2Handler)

	// Tag management routes (to be registered by RegisterTagRoutes)
	// Note: TagHandlers should be instantiated and routes registered in main.go
	// The routes are:
	// GET    /api/tag-groups          - GetAllTagGroups
	// GET    /api/tag-groups/{id}     - GetTagGroupByID
	// POST   /api/tag-groups          - CreateTagGroup
	// PUT    /api/tag-groups/{id}     - UpdateTagGroup
	// DELETE /api/tag-groups/{id}     - DeleteTagGroup
	// GET    /api/tags                - GetAllTags
	// POST   /api/tags                - CreateTag
	// PUT    /api/tags/{id}           - UpdateTag
	// DELETE /api/tags/{id}           - DeleteTag
	// GET    /api/tags/usage          - GetTagUsageStats
	// GET    /api/accounts/{id}/tags  - GetAccountTags
	// PUT    /api/accounts/{id}/tags  - SetAccountTags
	// POST   /api/accounts/batch-tags      - BatchSetAccountTags
	// POST   /api/accounts/batch-add-tag   - BatchAddTag
	// POST   /api/accounts/batch-remove-tag - BatchRemoveTag

	// Swagger documentation
	router.PathPrefix("/swagger/").Handler(httpSwagger.WrapHandler)

	// Static file server for docs directory
	router.PathPrefix("/docs/").Handler(http.StripPrefix("/docs/", http.FileServer(http.Dir("./docs/"))))

	// Serve the modern interface as the default route
	router.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./docs/modern-index.html")
	}).Methods("GET")

	// Add CORS middleware
	return enableCORS(router)
}

// enableCORS adds CORS headers to responses
func enableCORS(next http.Handler) http.Handler {
	// Read allowed origins from environment variable
	allowedOriginsStr := os.Getenv("CORS_ALLOWED_ORIGINS")
	var allowedOrigins []string
	allowAll := true

	if allowedOriginsStr != "" && allowedOriginsStr != "*" {
		allowAll = false
		for _, origin := range strings.Split(allowedOriginsStr, ",") {
			origin = strings.TrimSpace(origin)
			if origin != "" {
				allowedOrigins = append(allowedOrigins, origin)
			}
		}
	}

	isOriginAllowed := func(origin string) bool {
		if allowAll {
			return true
		}
		for _, allowed := range allowedOrigins {
			if strings.EqualFold(origin, allowed) {
				return true
			}
		}
		return false
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if allowAll {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else if origin != "" && isOriginAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}

		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
