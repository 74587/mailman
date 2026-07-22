package api

import (
	"errors"
	"io/fs"
	"mailman/internal/interceptor"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"mailman/internal/triggerv2/plugins"
	"mailman/internal/utils"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gorilla/mux"
	httpSwagger "github.com/swaggo/http-swagger"
)

// NewRouterWithAuth creates a new router with authentication middleware
func NewRouterWithAuth(
	handler *APIHandler,
	openAIHandler *OpenAIHandler,
	authHandler *AuthHandler,
	syncHandlers *SyncHandlers,
	sessionHandler *SessionHandler,
	triggerHandler *TriggerAPIHandler,
	oauth2Handler *OAuth2Handler,
	systemConfigHandler *SystemConfigHandler,
	webSocketHandler *WebSocketHandler,
	emailSendHandler *EmailSendHandlers,
	interceptorHandler *InterceptorHandler,
	tagHandlers *TagHandlers,
	proxyPoolHandlers *ProxyPoolHandlers,
	proxyGatewayHandlers *ProxyGatewayHandlers,
	pickupHandler *PickupHandler,
	outputLogHandler *OutputLogHandler,
	businessLogHandler *BusinessLogHandler,
	businessLogPipeline *services.BusinessLogPipeline,
	orgHandler *OrganizationHandler,
	userMgmtHandler *UserManagementHandler,
	authService *services.AuthService,
	emailTriggerService *services.EmailTriggerService,
	emailTriggerV2Repo *repository.EmailTriggerV2Repository,
	triggerExecutionLogV2Repo *repository.TriggerExecutionLogV2Repository,
	emailRepo *repository.EmailRepository,
	pluginManager plugins.PluginManager,
	interceptorManager *interceptor.Manager,
	conditionEngine *services.ConditionEngine,
	orgRepo *repository.OrganizationRepository,
	memberRepo *repository.OrgMemberRepository,
	roleRepo *repository.RoleRepository,
) http.Handler {
	router := mux.NewRouter()

	// Create logger for HTTP logging
	logger := utils.NewLogger("HTTP")

	// Apply logging middleware to all routes
	router.Use(LoggingMiddleware(logger))

	// Create API subrouter with /api prefix
	apiRouter := router.PathPrefix("/api").Subrouter()

	// Public endpoints (no auth required)
	// Health check
	apiRouter.HandleFunc("/health", HealthCheck).Methods("GET")

	// Authentication endpoints (public)
	apiRouter.HandleFunc("/auth/login", authHandler.LoginRateLimiter.RateLimitMiddleware(authHandler.LoginHandler)).Methods("POST")

	// OAuth2 callback endpoints (public - called by external providers)
	apiRouter.HandleFunc("/oauth2/callback/{provider}", oauth2Handler.HandleCallback).Methods("GET")
	apiRouter.HandleFunc("/oauth2/exchange-thunderbird-token", oauth2Handler.ExchangeThunderbirdToken).Methods("POST")

	// Public system config endpoints (no auth required)
	apiRouter.HandleFunc("/public/login-theme", systemConfigHandler.GetLoginTheme).Methods("GET")

	// Public WebSocket endpoints (no auth required)
	apiRouter.HandleFunc("/ws/wait-email", handler.WaitEmailWebSocketHandler).Methods("GET")
	apiRouter.HandleFunc("/ws/notifications", webSocketHandler.HandleWebSocket).Methods("GET")

	// Create authenticated subrouter
	authRouter := apiRouter.PathPrefix("").Subrouter()
	authRouter.Use(AuthMiddleware(authService))
	// 加载组织/角色/权限上下文
	authRouter.Use(OrgMiddleware(orgRepo, memberRepo, roleRepo))
	if businessLogPipeline != nil {
		authRouter.Use(BusinessLogAuditMiddleware(businessLogPipeline))
	}

	// Authentication endpoints (protected)
	authRouter.HandleFunc("/auth/logout", authHandler.LogoutHandler).Methods("POST")
	authRouter.HandleFunc("/auth/me", authHandler.CurrentUserHandler).Methods("GET")
	authRouter.HandleFunc("/auth/update", authHandler.UpdateUserHandler).Methods("PUT")
	authRouter.HandleFunc("/menu-preferences/me", handler.GetMenuPreferenceHandler).Methods("GET")
	authRouter.HandleFunc("/menu-preferences/me", handler.UpdateMenuPreferenceHandler).Methods("PUT")

	// Session management (protected)
	authRouter.HandleFunc("/sessions", sessionHandler.GetUserSessionsHandler).Methods("GET")
	authRouter.HandleFunc("/sessions", sessionHandler.CreateUserSessionHandler).Methods("POST")
	authRouter.HandleFunc("/sessions/{id}", sessionHandler.UpdateUserSessionHandler).Methods("PUT")
	authRouter.HandleFunc("/sessions/{id}", sessionHandler.DeleteUserSessionHandler).Methods("DELETE")

	// ==================== Permission-gated resource subrouters ====================

	// --- Email Account resources (accounts + account-emails + sync-records) ---
	accountRouter := authRouter.PathPrefix("").Subrouter()
	accountRouter.Use(RequirePermission(models.ResourceEmailAccount, models.ActionRead))

	accountRouter.HandleFunc("/accounts", handler.CreateAccountHandler).Methods("POST")
	accountRouter.HandleFunc("/accounts/upsert", handler.UpsertAccountHandler).Methods("POST")
	accountRouter.HandleFunc("/accounts", handler.GetAccountsHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/paginated", handler.GetAccountsPaginatedHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/exists", handler.AccountExistsHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/alias-capabilities", handler.ListEmailAliasCapabilitiesHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/forwarded-addresses", handler.ListAccountForwardedAddressesHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/forwarded-addresses", handler.SetAccountForwardedAddressesHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/forwarded-addresses", handler.AddAccountForwardedAddressHandler).Methods("POST")
	accountRouter.HandleFunc("/accounts/forwarded-addresses", handler.RemoveAccountForwardedAddressHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/by-email/{email}/forwarded-addresses", handler.ListAccountForwardedAddressesHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/by-email/{email}/forwarded-addresses", handler.SetAccountForwardedAddressesHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/by-email/{email}/forwarded-addresses", handler.AddAccountForwardedAddressHandler).Methods("POST")
	accountRouter.HandleFunc("/accounts/by-email/{email}/forwarded-addresses", handler.RemoveAccountForwardedAddressHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/{id}/forwarded-addresses", handler.ListAccountForwardedAddressesHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/{id}/forwarded-addresses", handler.SetAccountForwardedAddressesHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/{id}/forwarded-addresses", handler.AddAccountForwardedAddressHandler).Methods("POST")
	accountRouter.HandleFunc("/accounts/{id}/forwarded-addresses", handler.RemoveAccountForwardedAddressHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/domain-config", handler.GetAccountDomainConfigHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/domain-config", handler.SetAccountDomainConfigHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/domain-config", handler.DeleteAccountDomainConfigHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/by-email/{email}/domain-config", handler.GetAccountDomainConfigHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/by-email/{email}/domain-config", handler.SetAccountDomainConfigHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/by-email/{email}/domain-config", handler.DeleteAccountDomainConfigHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/{id}/domain-config", handler.GetAccountDomainConfigHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/{id}/domain-config", handler.SetAccountDomainConfigHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/{id}/domain-config", handler.DeleteAccountDomainConfigHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/proxy-config", handler.GetAccountProxyConfigHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/proxy-config", handler.SetAccountProxyConfigHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/proxy-config", handler.DeleteAccountProxyConfigHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/by-email/{email}/proxy-config", handler.GetAccountProxyConfigHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/by-email/{email}/proxy-config", handler.SetAccountProxyConfigHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/by-email/{email}/proxy-config", handler.DeleteAccountProxyConfigHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/{id}/proxy-config", handler.GetAccountProxyConfigHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/{id}/proxy-config", handler.SetAccountProxyConfigHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/{id}/proxy-config", handler.DeleteAccountProxyConfigHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/oauth2/onboard", handler.CreateOAuth2AccountOnboardingHandler).Methods("POST")
	accountRouter.HandleFunc("/accounts/batch-outlook-import", handler.StartBatchOutlookImportHandler).Methods("POST")
	accountRouter.HandleFunc("/accounts/batch-outlook-import/{jobID}", handler.GetBatchOutlookImportJobHandler).Methods("GET")
	accountRouter.HandleFunc("/business-modules", handler.ListBusinessModulesHandler).Methods("GET")
	accountRouter.HandleFunc("/business-modules", handler.CreateBusinessModuleHandler).Methods("POST")
	accountRouter.HandleFunc("/business-modules/{id}/email-accounts/claim", handler.ClaimBusinessModuleEmailAccountHandler).Methods("POST")
	accountRouter.HandleFunc("/business-modules/{id}/scenarios", handler.ListBusinessScenariosHandler).Methods("GET")
	accountRouter.HandleFunc("/business-modules/{id}/scenarios", handler.CreateBusinessScenarioHandler).Methods("POST")
	accountRouter.HandleFunc("/business-modules/{id}/scenarios/{scenarioKey}", handler.GetBusinessScenarioHandler).Methods("GET")
	accountRouter.HandleFunc("/business-modules/{id}/scenarios/{scenarioKey}", handler.UpdateBusinessScenarioHandler).Methods("PUT")
	accountRouter.HandleFunc("/business-modules/{id}/scenarios/{scenarioKey}", handler.DeleteBusinessScenarioHandler).Methods("DELETE")
	accountRouter.HandleFunc("/business-modules/{id}", handler.GetBusinessModuleHandler).Methods("GET")
	accountRouter.HandleFunc("/business-modules/{id}", handler.UpdateBusinessModuleHandler).Methods("PUT")
	accountRouter.HandleFunc("/business-modules/{id}", handler.DeleteBusinessModuleHandler).Methods("DELETE")
	accountRouter.HandleFunc("/business-accounts", handler.ListBusinessAccountsHandler).Methods("GET")
	accountRouter.HandleFunc("/business-accounts", handler.CreateBusinessAccountHandler).Methods("POST")
	accountRouter.HandleFunc("/business-accounts/{id}/complete-registration", handler.CompleteBusinessRegistrationHandler).Methods("POST")
	accountRouter.HandleFunc("/business-accounts/{id}/release-registration-claim", handler.ReleaseBusinessRegistrationClaimHandler).Methods("POST")
	accountRouter.HandleFunc("/business-accounts/{id}/renew-registration-claim", handler.RenewBusinessRegistrationClaimHandler).Methods("POST")
	accountRouter.HandleFunc("/business-accounts/{id}/scenarios/{scenarioKey}/pickup", handler.PickupBusinessAccountScenarioHandler).Methods("POST")
	accountRouter.HandleFunc("/business-accounts/{id}", handler.GetBusinessAccountHandler).Methods("GET")
	accountRouter.HandleFunc("/business-accounts/{id}", handler.UpdateBusinessAccountHandler).Methods("PUT")
	accountRouter.HandleFunc("/business-accounts/{id}", handler.DeleteBusinessAccountHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/{id}/business-accounts", handler.ListEmailAccountBusinessAccountsHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/{id}", handler.GetAccountHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/{id}", handler.UpdateAccountHandler).Methods("PUT")
	accountRouter.HandleFunc("/accounts/{id}", handler.DeleteAccountHandler).Methods("DELETE")
	accountRouter.HandleFunc("/accounts/verify", handler.VerifyAccountHandler).Methods("POST")
	accountRouter.HandleFunc("/accounts/batch-verify", handler.BatchVerifyAccountsHandler).Methods("POST")

	if proxyPoolHandlers != nil {
		proxyPoolHandlers.RegisterRoutes(accountRouter)
		utils.NewLogger("Router").Info("Proxy pool API routes registered")
	}
	if proxyGatewayHandlers != nil {
		proxyGatewayHandlers.RegisterRoutes(accountRouter)
		utils.NewLogger("Router").Info("Proxy gateway API routes registered")
	}

	accountRouter.HandleFunc("/account-emails/fetch/{id}", handler.FetchAndStoreEmailsHandler).Methods("POST")
	// 新增：获取所有邮件和文件夹的路由（必须放在参数路由之前）
	accountRouter.HandleFunc("/account-emails/list/all", handler.GetAllEmailsHandler).Methods("GET")
	accountRouter.HandleFunc("/account-emails/folders", handler.GetEmailFoldersHandler).Methods("GET")
	accountRouter.HandleFunc("/account-emails/list/{id}", handler.GetEmailsHandler).Methods("GET")
	accountRouter.HandleFunc("/account-emails/extract/{id}", handler.ExtractEmailsHandler).Methods("POST")
	accountRouter.HandleFunc("/accounts/{id}/sync-records", handler.GetIncrementalSyncRecordsHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/{id}/last-sync-record", handler.GetLastSyncRecordHandler).Methods("GET")
	accountRouter.HandleFunc("/accounts/{id}/sync-records", handler.DeleteIncrementalSyncRecordHandler).Methods("DELETE")

	// --- Email resources ---
	emailRouter := authRouter.PathPrefix("").Subrouter()
	emailRouter.Use(RequirePermission(models.ResourceEmail, models.ActionRead))

	emailRouter.HandleFunc("/emails/extract", handler.ExtractEmailsHandler).Methods("POST")
	emailRouter.HandleFunc("/emails/search", handler.SearchEmailsHandler).Methods("GET")                         // 添加搜索路由
	emailRouter.HandleFunc("/emails/{id}/trigger", handler.TriggerEmailHandler).Methods("POST")                  // Manual trigger for email event (must be before /emails/{id})
	emailRouter.HandleFunc("/emails/{id}/sync-attachments", handler.SyncEmailAttachmentsHandler).Methods("POST") // Sync email attachments
	emailRouter.HandleFunc("/emails/{id}/share-links", handler.CreateEmailShareLinkHandler).Methods("POST")
	emailRouter.HandleFunc("/email-share-links/{token}", handler.ResolveEmailShareLinkHandler).Methods("GET")
	emailRouter.HandleFunc("/emails/{id}", handler.GetEmailHandler).Methods("GET")
	emailRouter.HandleFunc("/emails/fetch-now", handler.FetchNowHandler).Methods("POST")
	emailRouter.HandleFunc("/emails/send", emailSendHandler.SendEmailHandler).Methods("POST")

	// Legacy endpoint (protected, email resource)
	emailRouter.HandleFunc("/fetch-emails", handler.FetchEmailsHandler).Methods("POST")

	// Random email endpoint (protected, email resource)
	emailRouter.HandleFunc("/random-email", handler.RandomEmailHandler).Methods("GET")

	// Wait email endpoint (protected, email resource)
	emailRouter.HandleFunc("/wait-email", handler.WaitEmailHandler).Methods("POST")

	// Check email endpoint (simplified for frontend polling) (protected, email resource)
	emailRouter.HandleFunc("/check-email", handler.CheckEmailHandler).Methods("POST")

	// HTTP polling endpoint (fallback for WebSocket) (protected, email resource)
	emailRouter.HandleFunc("/poll-email", handler.PollEmailHandler).Methods("POST")

	// Email domains endpoint (protected, email resource)
	emailRouter.HandleFunc("/email-domains", handler.GetEmailDomainsHandler).Methods("GET")

	// Mail providers (protected, email resource)
	emailRouter.HandleFunc("/providers", handler.GetProvidersHandler).Methods("GET")

	// Email subscription endpoints (protected, email resource)
	emailRouter.HandleFunc("/subscriptions", handler.CreateSubscriptionHandler).Methods("POST")
	emailRouter.HandleFunc("/subscriptions", handler.GetSubscriptionsHandler).Methods("GET")
	emailRouter.HandleFunc("/subscriptions/{id}", handler.DeleteSubscriptionHandler).Methods("DELETE")

	// WebSocket endpoints (protected, email resource)
	emailRouter.HandleFunc("/ws/wait-email", handler.WaitEmailWebSocketHandler).Methods("GET")
	emailRouter.HandleFunc("/ws/subscriptions", handler.SubscriptionWebSocketHandler).Methods("GET")

	// --- Template resources (extractor, filter, action templates) ---
	templateRouter := authRouter.PathPrefix("").Subrouter()
	templateRouter.Use(RequirePermission(models.ResourceTemplate, models.ActionRead))

	// Extractor templates (protected)
	templateRouter.HandleFunc("/extractor-templates", handler.CreateExtractorTemplateHandler).Methods("POST")
	templateRouter.HandleFunc("/extractor-templates", handler.GetExtractorTemplatesHandler).Methods("GET")
	templateRouter.HandleFunc("/extractor-templates/paginated", handler.GetExtractorTemplatesPaginatedHandler).Methods("GET")
	templateRouter.HandleFunc("/extractor-templates/{id}", handler.GetExtractorTemplateHandler).Methods("GET")
	templateRouter.HandleFunc("/extractor-templates/{id}", handler.UpdateExtractorTemplateHandler).Methods("PUT")
	templateRouter.HandleFunc("/extractor-templates/{id}", handler.DeleteExtractorTemplateHandler).Methods("DELETE")
	templateRouter.HandleFunc("/extractor-templates/{id}/test", handler.TestExtractorTemplateHandler).Methods("POST")

	// Filter templates (protected)
	templateRouter.HandleFunc("/filter-templates", handler.ListFilterTemplatesHandler).Methods("GET")
	templateRouter.HandleFunc("/filter-templates", handler.CreateFilterTemplateHandler).Methods("POST")
	templateRouter.HandleFunc("/filter-templates/categories", handler.GetFilterTemplateCategoriesHandler).Methods("GET")
	templateRouter.HandleFunc("/filter-templates/{id}", handler.GetFilterTemplateHandler).Methods("GET")
	templateRouter.HandleFunc("/filter-templates/{id}", handler.UpdateFilterTemplateHandler).Methods("PUT")
	templateRouter.HandleFunc("/filter-templates/{id}", handler.DeleteFilterTemplateHandler).Methods("DELETE")
	templateRouter.HandleFunc("/filter-templates/{id}/increment-usage", handler.IncrementFilterTemplateUsageHandler).Methods("POST")

	// Action templates (protected)
	templateRouter.HandleFunc("/action-templates", handler.ListActionTemplatesHandler).Methods("GET")
	templateRouter.HandleFunc("/action-templates", handler.CreateActionTemplateHandler).Methods("POST")
	templateRouter.HandleFunc("/action-templates/categories", handler.GetActionTemplateCategoriesHandler).Methods("GET")
	templateRouter.HandleFunc("/action-templates/{id}", handler.GetActionTemplateHandler).Methods("GET")
	templateRouter.HandleFunc("/action-templates/{id}", handler.UpdateActionTemplateHandler).Methods("PUT")
	templateRouter.HandleFunc("/action-templates/{id}", handler.DeleteActionTemplateHandler).Methods("DELETE")
	templateRouter.HandleFunc("/action-templates/{id}/increment-usage", handler.IncrementActionTemplateUsageHandler).Methods("POST")

	// Register Extractor Template V2 routes (template resource)
	// Note: RegisterExtractorTemplateV2Routes includes /v2/ prefix in route paths
	extractorV2Handler := NewExtractorTemplateV2Handler(nil)
	RegisterExtractorTemplateV2Routes(templateRouter, extractorV2Handler)

	// --- AI Config resources (OpenAI) ---
	aiConfigRouter := authRouter.PathPrefix("/openai").Subrouter()
	aiConfigRouter.Use(RequirePermission(models.ResourceAIConfig, models.ActionRead))

	// OpenAI Configuration endpoints
	aiConfigRouter.HandleFunc("/configs", openAIHandler.ListOpenAIConfigs).Methods("GET")
	aiConfigRouter.HandleFunc("/configs", openAIHandler.CreateOpenAIConfig).Methods("POST")
	aiConfigRouter.HandleFunc("/configs/{id}", openAIHandler.GetOpenAIConfig).Methods("GET")
	aiConfigRouter.HandleFunc("/configs/{id}", openAIHandler.UpdateOpenAIConfig).Methods("PUT")
	aiConfigRouter.HandleFunc("/configs/{id}", openAIHandler.DeleteOpenAIConfig).Methods("DELETE")

	// AI Prompt Template endpoints
	aiConfigRouter.HandleFunc("/prompt-templates", openAIHandler.ListAIPromptTemplates).Methods("GET")
	aiConfigRouter.HandleFunc("/prompt-templates", openAIHandler.CreateAIPromptTemplate).Methods("POST")
	aiConfigRouter.HandleFunc("/prompt-templates/{id}", openAIHandler.GetAIPromptTemplate).Methods("GET")
	aiConfigRouter.HandleFunc("/prompt-templates/{id}", openAIHandler.UpdateAIPromptTemplate).Methods("PUT")
	aiConfigRouter.HandleFunc("/prompt-templates/{id}", openAIHandler.DeleteAIPromptTemplate).Methods("DELETE")

	// AI Generation endpoints
	aiConfigRouter.HandleFunc("/generate-template", openAIHandler.GenerateEmailTemplate).Methods("POST")
	aiConfigRouter.HandleFunc("/initialize-templates", openAIHandler.InitializeDefaultPromptTemplates).Methods("POST")
	aiConfigRouter.HandleFunc("/call", openAIHandler.CallOpenAI).Methods("POST")
	aiConfigRouter.HandleFunc("/call/stream", openAIHandler.StreamOpenAI).Methods("POST")
	aiConfigRouter.HandleFunc("/test-config", openAIHandler.TestOpenAIConfig).Methods("POST")

	// --- Sync Config resources ---
	syncRouter := authRouter.PathPrefix("").Subrouter()
	syncRouter.Use(RequirePermission(models.ResourceSyncConfig, models.ActionRead))

	syncRouter.HandleFunc("/accounts/{id}/sync-config", syncHandlers.GetAccountSyncConfig).Methods("GET")
	syncRouter.HandleFunc("/accounts/{id}/sync-config", syncHandlers.CreateAccountSyncConfig).Methods("POST")
	syncRouter.HandleFunc("/accounts/{id}/sync-config", syncHandlers.UpdateAccountSyncConfig).Methods("PUT")
	syncRouter.HandleFunc("/accounts/{id}/sync-config", syncHandlers.DeleteAccountSyncConfig).Methods("DELETE")
	syncRouter.HandleFunc("/accounts/{id}/sync-config/effective", syncHandlers.GetEffectiveSyncConfig).Methods("GET")
	syncRouter.HandleFunc("/accounts/{id}/sync-config/temporary", syncHandlers.CreateTemporarySyncConfig).Methods("POST")
	syncRouter.HandleFunc("/accounts/{id}/sync-now", syncHandlers.SyncNow).Methods("POST")
	syncRouter.HandleFunc("/accounts/{id}/sync-statistics", syncHandlers.GetSyncStatistics).Methods("GET")
	syncRouter.HandleFunc("/accounts/{id}/mailboxes", syncHandlers.GetAccountMailboxes).Methods("GET")
	syncRouter.HandleFunc("/sync/configs", syncHandlers.GetAllSyncConfigs).Methods("GET")
	syncRouter.HandleFunc("/sync/global-config", syncHandlers.GetGlobalSyncConfig).Methods("GET")
	syncRouter.HandleFunc("/sync/global-config", syncHandlers.UpdateGlobalSyncConfig).Methods("PUT")
	syncRouter.HandleFunc("/sync/batch-config", syncHandlers.BatchCreateOrUpdateAccountSyncConfig).Methods("POST")
	syncRouter.HandleFunc("/sync/bulk-account-config", syncHandlers.BulkApplyAccountSyncConfig).Methods("POST")

	// 同步监控相关端点 (sync resource)
	syncRouter.HandleFunc("/sync/queue-metrics", handler.GetQueueMetricsHandler).Methods("GET")
	syncRouter.HandleFunc("/sync/account-status", handler.GetAccountSyncStatusHandler).Methods("GET")
	syncRouter.HandleFunc("/sync/account-status/batch", handler.GetAccountSyncStatusBatchHandler).Methods("POST")
	syncRouter.HandleFunc("/sync/manager-stats", handler.GetSyncManagerStatsHandler).Methods("GET")

	// --- System Config resources ---
	sysConfigRouter := authRouter.PathPrefix("").Subrouter()
	sysConfigRouter.Use(RequirePermission(models.ResourceSystemConfig, models.ActionRead))

	// System Configuration endpoints
	sysConfigRouter.HandleFunc("/system-configs", systemConfigHandler.GetAllConfigs).Methods("GET")
	sysConfigRouter.HandleFunc("/system-configs/category/{category}", systemConfigHandler.GetConfigsByCategory).Methods("GET")
	sysConfigRouter.HandleFunc("/system-config/{key}", systemConfigHandler.GetConfigByKey).Methods("GET")
	sysConfigRouter.HandleFunc("/system-config/{key}", systemConfigHandler.UpdateConfigValue).Methods("PUT")
	sysConfigRouter.HandleFunc("/system-config/{key}/reset", systemConfigHandler.ResetConfigToDefault).Methods("POST")

	// OAuth2 endpoints (system_config resource)
	sysConfigRouter.HandleFunc("/oauth2/global-config", oauth2Handler.CreateOrUpdateGlobalConfig).Methods("POST", "PUT")
	sysConfigRouter.HandleFunc("/oauth2/global-configs", oauth2Handler.GetGlobalConfigs).Methods("GET")
	sysConfigRouter.HandleFunc("/oauth2/global-config/{provider}", oauth2Handler.GetGlobalConfigByProvider).Methods("GET")
	sysConfigRouter.HandleFunc("/oauth2/global-configs/{provider}", oauth2Handler.GetGlobalConfigsByProvider).Methods("GET")
	sysConfigRouter.HandleFunc("/oauth2/global-config/by-id/{id}", oauth2Handler.GetGlobalConfigByID).Methods("GET")
	sysConfigRouter.HandleFunc("/oauth2/global-config/{id}/default", oauth2Handler.SetGlobalConfigDefault).Methods("POST")
	sysConfigRouter.HandleFunc("/oauth2/global-config/{id}", oauth2Handler.DeleteGlobalConfig).Methods("DELETE")
	sysConfigRouter.HandleFunc("/oauth2/auth-url/{provider}", oauth2Handler.GetAuthURL).Methods("GET")
	sysConfigRouter.HandleFunc("/oauth2/exchange-token", oauth2Handler.ExchangeToken).Methods("POST")
	sysConfigRouter.HandleFunc("/oauth2/refresh-token", oauth2Handler.RefreshTokenHandler).Methods("POST")
	sysConfigRouter.HandleFunc("/oauth2/provider/{provider}/enable", oauth2Handler.EnableProvider).Methods("POST")
	sysConfigRouter.HandleFunc("/oauth2/provider/{provider}/disable", oauth2Handler.DisableProvider).Methods("POST")

	// OAuth2 授权会话管理端点 (system_config resource)
	sysConfigRouter.HandleFunc("/oauth2/session/start/{provider}", oauth2Handler.StartOAuth2Session).Methods("POST")
	sysConfigRouter.HandleFunc("/oauth2/session/manual/start/{provider}", oauth2Handler.StartManualOAuth2Session).Methods("POST")
	sysConfigRouter.HandleFunc("/oauth2/session/manual/exchange/{state}", oauth2Handler.ExchangeManualOAuth2Code).Methods("POST")
	sysConfigRouter.HandleFunc("/oauth2/session/poll/{state}", oauth2Handler.PollOAuth2SessionStatus).Methods("GET")
	sysConfigRouter.HandleFunc("/oauth2/session/cancel/{state}", oauth2Handler.CancelOAuth2Session).Methods("POST")

	if outputLogHandler != nil {
		sysConfigRouter.HandleFunc("/output-logs", outputLogHandler.ListLogs).Methods("GET")
		sysConfigRouter.HandleFunc("/output-logs/modules", outputLogHandler.ListModules).Methods("GET")
		sysConfigRouter.HandleFunc("/output-logs/config", outputLogHandler.GetConfig).Methods("GET")
		sysConfigRouter.HandleFunc("/output-logs/config", outputLogHandler.UpdateConfig).Methods("PUT")
		sysConfigRouter.HandleFunc("/output-logs/stream", outputLogHandler.StreamLogs).Methods("GET")
	}

	if businessLogHandler != nil {
		sysConfigRouter.HandleFunc("/business-logs", businessLogHandler.ListLogs).Methods("GET")
		sysConfigRouter.HandleFunc("/business-logs/stats", businessLogHandler.GetStats).Methods("GET")
		sysConfigRouter.HandleFunc("/business-logs/config", businessLogHandler.GetConfig).Methods("GET")
		sysConfigRouter.HandleFunc("/business-logs/config", businessLogHandler.UpdateConfig).Methods("PUT")
		sysConfigRouter.HandleFunc("/business-logs/test-pipeline", businessLogHandler.TestPipeline).Methods("POST")
		sysConfigRouter.HandleFunc("/business-logs/{id}", businessLogHandler.GetLog).Methods("GET")
	}

	// ==================== Non-permission-gated endpoints ====================

	// Activity logs (protected, no specific resource permission)
	authRouter.HandleFunc("/activities/recent", GetRecentActivities).Methods("GET")

	// Cache statistics endpoint (protected)
	authRouter.HandleFunc("/cache/stats", handler.GetCacheStatsHandler).Methods("GET")

	// Dashboard statistics endpoint (protected)
	authRouter.HandleFunc("/dashboard/stats", handler.GetEmailStatsHandler).Methods("GET")
	authRouter.HandleFunc("/observability/runtime", handler.GetRuntimeObservabilityHandler).Methods("GET")


	// WebSocket和通知相关端点 (protected)
	authRouter.HandleFunc("/notifications/stats", webSocketHandler.HandleNotificationStats).Methods("GET")
	authRouter.HandleFunc("/notifications/recent", webSocketHandler.HandleRecentNotifications).Methods("GET")

	// Pickup poll endpoint (protected)
	authRouter.HandleFunc("/pickup/poll", pickupHandler.PollHandler).Methods("POST")

	// Plugin management (protected)
	authRouter.HandleFunc("/plugins", handler.ListPluginsHandler).Methods("GET")
	authRouter.HandleFunc("/plugins/ui/schemas", handler.GetPluginUISchemas).Methods("GET")
	authRouter.HandleFunc("/plugins/ui/schema", handler.GetPluginUISchema).Methods("GET")
	authRouter.HandleFunc("/plugins/{pluginID}/callbacks/{callback}", handler.HandlePluginCallback).Methods("GET", "POST")

	// Interceptor management (protected)
	if interceptorHandler != nil {
		interceptorHandler.RegisterRoutes(authRouter)
		// Log that interceptor API is enabled
		utils.NewLogger("Router").Info("Interceptor API routes registered")
	}

	// Tag management (protected)
	if tagHandlers != nil {
		RegisterTagRoutes(authRouter, tagHandlers)
		utils.NewLogger("Router").Info("Tag management API routes registered")
	}

	// Activity log endpoints (protected)
	authRouter.HandleFunc("/activities/stats", GetActivityStats).Methods("GET")
	authRouter.HandleFunc("/activities/type/{type}", GetActivitiesByType).Methods("GET")
	authRouter.HandleFunc("/activities/cleanup", DeleteOldActivities).Methods("DELETE")

	// ==================== Trigger resources ====================

	// Create EmailTriggerV2Controller first (needed for logs routes)
	emailTriggerV2Controller := NewEmailTriggerV2Controller(
		emailTriggerService,
		emailTriggerV2Repo,
		triggerExecutionLogV2Repo,
		emailRepo,
		pluginManager,
		interceptorManager,
		conditionEngine,
	)

	// --- Trigger resources (trigger permission) ---
	triggerRouter := authRouter.PathPrefix("").Subrouter()
	triggerRouter.Use(RequirePermission(models.ResourceTrigger, models.ActionRead))

	// ========== Trigger Routes ==========
	// 重要: 具体路径必须在通配符路径 /triggers/{id} 之前注册!
	// Gorilla Mux 按注册顺序匹配, 否则 "logs" 会被当作 {id} 解析

	// 1. 基本触发器端点 - 全部使用V2版本
	triggerRouter.HandleFunc("/triggers", emailTriggerV2Controller.CreateTriggerHandler).Methods("POST")
	triggerRouter.HandleFunc("/triggers", emailTriggerV2Controller.GetTriggersHandler).Methods("GET")

	// 2. /triggers/logs 必须在 /triggers/{id} 之前注册!
	triggerRouter.HandleFunc("/triggers/logs", emailTriggerV2Controller.GetTriggerLogsHandler).Methods("GET")
	triggerRouter.HandleFunc("/triggers/logs/stats", emailTriggerV2Controller.GetTriggerLogsStatsHandler).Methods("GET")
	triggerRouter.HandleFunc("/triggers/logs/export", emailTriggerV2Controller.ExportTriggerLogsHandler).Methods("GET")
	triggerRouter.HandleFunc("/triggers/logs/{id}", emailTriggerV2Controller.GetTriggerLogHandler).Methods("GET")

	// 3. 其他具体路径 (在 {id} 之前) - 保留V1用于表达式评估等兼容性功能
	triggerRouter.HandleFunc("/triggers/evaluate-expression", triggerHandler.EvaluateExpressionHandler).Methods("POST")
	triggerRouter.HandleFunc("/triggers/execute-action", triggerHandler.ExecuteActionHandler).Methods("POST")
	triggerRouter.HandleFunc("/triggers/execute-actions", triggerHandler.ExecuteActionsHandler).Methods("POST")

	// 4. /triggers/{id}/统计 - 必须在通配符 /triggers/{id} 之前注册!
	triggerRouter.HandleFunc("/triggers/{id}/statistics", emailTriggerV2Controller.GetTriggerStatisticsHandler).Methods("GET")

	// 5. /triggers/{id} 通配符路由放在最后 - 全部使用V2版本
	triggerRouter.HandleFunc("/triggers/{id}", emailTriggerV2Controller.GetTriggerHandler).Methods("GET")
	triggerRouter.HandleFunc("/triggers/{id}", emailTriggerV2Controller.UpdateTriggerHandler).Methods("PUT")
	triggerRouter.HandleFunc("/triggers/{id}", emailTriggerV2Controller.DeleteTriggerHandler).Methods("DELETE")
	triggerRouter.HandleFunc("/triggers/{id}/enable", emailTriggerV2Controller.EnableTriggerHandler).Methods("POST")
	triggerRouter.HandleFunc("/triggers/{id}/disable", emailTriggerV2Controller.DisableTriggerHandler).Methods("POST")

	// 5. 触发器日志和统计 (不带通配符)
	triggerRouter.HandleFunc("/trigger-logs", triggerHandler.GetTriggerExecutionLogsHandler).Methods("GET")
	triggerRouter.HandleFunc("/trigger-stats", triggerHandler.GetTriggerStatsHandler).Methods("GET")

	// TriggerV2 endpoints (protected) - 重定向到新版 EmailTriggerV2Controller
	// 注意: 这些路由曾经指向旧版 triggerHandler (写入 email_triggers 表)
	// 现已全部改为使用 emailTriggerV2Controller (写入 email_trigger_v2 表) 保持一致性
	v2TriggerRouter := triggerRouter.PathPrefix("/v2").Subrouter()

	// 工具类端点 - 表达式评估和动作执行（不涉及数据存储）
	v2TriggerRouter.HandleFunc("/triggers/evaluate-expression", triggerHandler.EvaluateExpressionHandler).Methods("POST")
	v2TriggerRouter.HandleFunc("/triggers/execute-action", triggerHandler.ExecuteActionHandler).Methods("POST")
	v2TriggerRouter.HandleFunc("/triggers/execute-actions", triggerHandler.ExecuteActionsHandler).Methods("POST")

	// Register all Email Trigger V2 routes (包含 test-condition, test-action 等)
	emailTriggerV2Controller.RegisterRoutes(v2TriggerRouter)

	// ==================== Organization management ====================

	// Organization management (protected)
	if orgHandler != nil {
		// 组织基本操作（所有认证用户可访问）
		authRouter.HandleFunc("/organizations", orgHandler.GetOrganizationsHandler).Methods("GET")
		authRouter.HandleFunc("/organizations/{id}", orgHandler.GetOrganizationHandler).Methods("GET")
		authRouter.HandleFunc("/organizations/switch", orgHandler.SwitchOrganizationHandler).Methods("POST")

		// 只读端点：角色和权限列表（所有认证用户可查看）
		authRouter.HandleFunc("/roles", orgHandler.GetRolesHandler).Methods("GET")
		authRouter.HandleFunc("/permissions", orgHandler.GetPermissionsHandler).Methods("GET")

		// 组织更新（需要 organization:update 权限）
		orgUpdateRouter := authRouter.PathPrefix("").Subrouter()
		orgUpdateRouter.Use(RequirePermission(models.ResourceOrganization, models.ActionUpdate))
		orgUpdateRouter.HandleFunc("/organizations/{id}", orgHandler.UpdateOrganizationHandler).Methods("PUT")

		// 成员管理（需要 org_member:read 权限，写操作在 handler 内部二次校验）
		orgMemberRouter := authRouter.PathPrefix("").Subrouter()
		orgMemberRouter.Use(RequirePermission(models.ResourceOrgMember, models.ActionRead))
		orgMemberRouter.HandleFunc("/organizations/{id}/members", orgHandler.GetOrgMembersHandler).Methods("GET")
		orgMemberRouter.HandleFunc("/organizations/{id}/members", orgHandler.AddOrgMemberHandler).Methods("POST")
		orgMemberRouter.HandleFunc("/organizations/{id}/members/{userId}", orgHandler.UpdateMemberRoleHandler).Methods("PUT")
		orgMemberRouter.HandleFunc("/organizations/{id}/members/{userId}", orgHandler.RemoveMemberHandler).Methods("DELETE")

		// 角色/权限管理（需要 organization:manage 权限）
		orgManageRouter := authRouter.PathPrefix("").Subrouter()
		orgManageRouter.Use(RequirePermission(models.ResourceOrganization, models.ActionManage))
		orgManageRouter.HandleFunc("/roles", orgHandler.CreateRoleHandler).Methods("POST")
		orgManageRouter.HandleFunc("/roles/{id}", orgHandler.UpdateRoleHandler).Methods("PUT")
		orgManageRouter.HandleFunc("/roles/{id}", orgHandler.DeleteRoleHandler).Methods("DELETE")
		orgManageRouter.HandleFunc("/roles/{id}/permissions", orgHandler.SetRolePermissionsHandler).Methods("PUT")

		// 仅超级管理员可操作的组织端点
		adminOrgRouter := authRouter.PathPrefix("").Subrouter()
		adminOrgRouter.Use(RequireSuperAdmin)
		adminOrgRouter.HandleFunc("/organizations", orgHandler.CreateOrganizationHandler).Methods("POST")
		adminOrgRouter.HandleFunc("/organizations/{id}", orgHandler.DeleteOrganizationHandler).Methods("DELETE")

		utils.NewLogger("Router").Info("Organization management API routes registered")
	}

	// User management - 仅超级管理员 (protected + super admin)
	if userMgmtHandler != nil {
		adminRouter := authRouter.PathPrefix("/admin").Subrouter()
		adminRouter.Use(RequireSuperAdmin)
		adminRouter.HandleFunc("/users", userMgmtHandler.ListUsersHandler).Methods("GET")
		adminRouter.HandleFunc("/users", userMgmtHandler.CreateUserHandler).Methods("POST")
		adminRouter.HandleFunc("/users/{id}", userMgmtHandler.GetUserHandler).Methods("GET")
		adminRouter.HandleFunc("/users/{id}", userMgmtHandler.UpdateUserHandler).Methods("PUT")
		adminRouter.HandleFunc("/users/{id}", userMgmtHandler.DeleteUserHandler).Methods("DELETE")

		utils.NewLogger("Router").Info("User management API routes registered (super admin only)")
	}

	// Swagger documentation (public)
	router.PathPrefix("/swagger/").Handler(httpSwagger.WrapHandler)

	// Static file server for docs directory (public)
	router.PathPrefix("/docs/").Handler(http.StripPrefix("/docs/", http.FileServer(http.Dir("./docs/"))))

	// Serve frontend static files (SPA with client-side routing fallback)
	// Look for frontend build output in ../frontend/out/ (relative to backend working directory)
	frontendDir := "../frontend/out"
	if _, err := os.Stat(frontendDir); err == nil {
		logger.Info("Serving frontend from %s", frontendDir)
		router.PathPrefix("/").Handler(spaHandler(frontendDir))
	} else {
		logger.Warn("Frontend build directory not found at %s, falling back to docs", frontendDir)
		// Fallback: Serve the modern interface as the default route (public)
		router.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, "./docs/modern-index.html")
		}).Methods("GET")
	}

	// Add CORS middleware
	return enableCORS(router)
}

// spaHandler serves static files from the given directory and falls back to
// index.html for any path that doesn't match a real file. This enables
// client-side routing in Single Page Applications.
func spaHandler(staticDir string) http.Handler {
	absDir, _ := filepath.Abs(staticDir)
	fileServer := http.FileServer(http.Dir(absDir))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Clean the path
		urlPath := r.URL.Path
		if !strings.HasPrefix(urlPath, "/") {
			urlPath = "/" + urlPath
		}

		// Check if the requested file exists
		fullPath := filepath.Join(absDir, filepath.Clean(urlPath))
		_, err := os.Stat(fullPath)

		if err != nil {
			if os.IsNotExist(err) || errors.Is(err, fs.ErrNotExist) {
				// File doesn't exist — serve index.html for SPA routing
				http.ServeFile(w, r, filepath.Join(absDir, "index.html"))
				return
			}
		}

		// File exists — serve it directly
		fileServer.ServeHTTP(w, r)
	})
}
