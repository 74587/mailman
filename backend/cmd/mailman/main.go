package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "mailman/docs" // This is required for swag to find your docs
	"mailman/internal/api"
	"mailman/internal/config"
	"mailman/internal/database"
	"mailman/internal/interceptor"
	interceptorPlugins "mailman/internal/interceptor/plugins"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"
	"mailman/internal/triggerv2/plugins"
	"mailman/internal/triggerv2/plugins/builtin"
	"mailman/internal/utils"
)

// @title Mailman API
// @version 1.0
// @description This is a sample server for a mailman service.
// @termsOfService http://swagger.io/terms/

// @contact.name API Support
// @contact.url http://www.swagger.io/support
// @contact.email support@swagger.io

// @license.name Apache 2.0
// @license.url http://www.apache.org/licenses/LICENSE-2.0.html

// @host localhost:8080
// @BasePath /
func main() {
	// Initialize logger with configured log level
	logLevel := os.Getenv("LOG_LEVEL")
	if logLevel == "" {
		logLevel = "INFO" // Default log level
	}

	mainLogger := utils.NewLogger("Main")
	mainLogger.Info("Starting Mailman Service with log level: %s", logLevel)

	// Load configuration
	cfg := config.Load()

	// Initialize database
	dbConfig := database.Config{
		Driver:   cfg.Database.Driver,
		Host:     cfg.Database.Host,
		Port:     cfg.Database.Port,
		User:     cfg.Database.User,
		Password: cfg.Database.Password,
		DBName:   cfg.Database.DBName,
		SSLMode:  cfg.Database.SSLMode,
	}

	if err := database.Initialize(dbConfig); err != nil {
		mainLogger.Error("Failed to initialize database: %v", err)
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer database.Close()

	db := database.GetDB()

	// Initialize repositories
	mailProviderRepo := repository.NewMailProviderRepository(db)
	emailAccountRepo := repository.NewEmailAccountRepository(db)
	emailRepo := repository.NewEmailRepository(db)
	incrementalSyncRepo := repository.NewIncrementalSyncRepository(db)
	extractorTemplateRepo := repository.NewExtractorTemplateRepository(db)
	openAIConfigRepo := repository.NewOpenAIConfigRepository(db)
	aiPromptTemplateRepo := repository.NewAIPromptTemplateRepository(db)
	userRepo := repository.NewUserRepository(db)
	userSessionRepo := repository.NewUserSessionRepository(db)
	syncConfigRepo := repository.NewSyncConfigRepository(db)
	mailboxRepo := repository.NewMailboxRepository(db)
	triggerRepo := repository.NewTriggerRepository(db)
	triggerLogRepo := repository.NewTriggerExecutionLogRepository(db)
	emailTriggerV2Repo := repository.NewEmailTriggerV2Repository(db)
	triggerExecutionLogV2Repo := repository.NewTriggerExecutionLogV2Repository(db)
	oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(db)
	oauth2AuthSessionRepo := repository.NewOAuth2AuthSessionRepository(db)
	systemConfigRepo := repository.NewSystemConfigRepository(db)
	tagRepo := repository.NewTagRepository(db)
	proxyPoolRepo := repository.NewProxyPoolRepository(db)
	proxyGatewayRepo := repository.NewProxyGatewayRepository(db)
	businessLogRepo := repository.NewBusinessLogRepository(db)

	// Organization & RBAC repositories
	orgRepo := repository.NewOrganizationRepository(db)
	orgMemberRepo := repository.NewOrgMemberRepository(db)
	roleRepo := repository.NewRoleRepository(db)

	// Seed default mail providers
	if err := mailProviderRepo.SeedDefaultProviders(); err != nil {
		mainLogger.Warn("Failed to seed default providers: %v", err)
	}

	// Seed default OAuth2 configurations
	if err := oauth2GlobalConfigRepo.SeedDefaultConfigs(); err != nil {
		mainLogger.Warn("Failed to seed default OAuth2 configs: %v", err)
	}

	// Initialize services with repositories
	outputLogService := services.GetOutputLogService()
	outputLogService.ApplyConfig(services.LoadOutputLogConfig(systemConfigRepo))
	utils.SetStructuredLogSink(outputLogService.Record)
	businessLogRecorder := services.NewBusinessLogRecorder(businessLogRepo)
	businessLogPipeline := services.NewBusinessLogPipeline(businessLogRecorder, systemConfigRepo)
	oauth2Service := services.NewOAuth2Service(db)
	fetcherService := services.NewFetcherServiceWithOAuth2Service(emailAccountRepo, emailRepo, db, oauth2Service)
	proxyPoolService := services.NewProxyPoolService(proxyPoolRepo, emailAccountRepo)
	proxyGatewayService := services.NewProxyGatewayService(proxyGatewayRepo, proxyPoolRepo)
	fetcherService.SetProxyPoolService(proxyPoolService)
	parserService := services.NewParserService()
	authService := services.NewAuthService(userRepo, userSessionRepo)
	oauth2ConfigService := services.NewOAuth2GlobalConfigService(oauth2GlobalConfigRepo)
	oauth2AuthSessionService := services.NewOAuth2AuthSessionService(oauth2AuthSessionRepo)

	// Initialize activity logger service (singleton)
	activityLogger := services.GetActivityLogger()
	mainLogger.Info("Activity logger service initialized")

	// Initialize email fetch scheduler
	schedulerConfig := services.DefaultSchedulerConfig()
	emailFetchScheduler := services.NewEmailFetchScheduler(fetcherService, emailAccountRepo, schedulerConfig)

	// Start the scheduler
	if err := emailFetchScheduler.Start(); err != nil {
		mainLogger.Error("Failed to start email fetch scheduler: %v", err)
		log.Fatalf("Failed to start email fetch scheduler: %v", err)
	}

	// 旧的队列式同步管理器已被替换为每账户独立goroutine方案
	// Initialize incremental sync manager (使用优化版实现) - 已禁用
	mainLogger.Info("正在跳过旧版队列式同步管理器（已被每账户独立goroutine方案替代）...")
	incrementalSyncManager := services.NewOptimizedIncrementalSyncManager(emailFetchScheduler, syncConfigRepo, emailRepo, mailboxRepo, fetcherService)
	// 不再启动旧系统: incrementalSyncManager.Start()
	mainLogger.Info("旧版同步管理器已禁用，新版每账户独立同步正在使用中")

	// 使用EmailFetchScheduler的SubscriptionManager，确保TriggerService和DispatchEmailEvent共享同一实例
	subscriptionManager := emailFetchScheduler.GetSubscriptionManager()

	// [DEPRECATED] V1 TriggerService 已弃用，使用 V2 EmailTriggerService
	// triggerService 变量保留用于 API handler 等兼容性需求
	mainLogger.Info("V1 触发器服务已弃用，使用V2 EmailTriggerService")
	triggerService := services.NewTriggerService(triggerRepo, triggerLogRepo, emailRepo, subscriptionManager)
	_ = triggerService // 避免 unused 警告，仅保留兼容性

	// Initialize Plugin Manager
	mainLogger.Info("Initializing plugin manager...")
	pluginManager := plugins.NewTriggerV2PluginManager(plugins.DefaultPluginManagerConfig())

	// 注册所有内置插件
	mainLogger.Info("Registering builtin plugins...")
	if err := builtin.RegisterBuiltinPlugins(pluginManager); err != nil {
		mainLogger.Error("Failed to register builtin plugins: %v", err)
	} else {
		mainLogger.Info("All builtin plugins registered successfully")
	}

	// Initialize Interceptor System
	mainLogger.Info("Initializing interceptor system...")
	interceptorRepo := repository.NewInterceptorRepository(db)

	// Auto-migrate interceptor tables
	if err := interceptorRepo.AutoMigrate(); err != nil {
		mainLogger.Error("Failed to migrate interceptor tables: %v", err)
	} else {
		mainLogger.Info("Interceptor tables migrated successfully")
	}

	// Create interceptor manager
	interceptorManager := interceptor.NewManager()
	interceptorManager.SetDiagnosticLogWriter(func(logEntry *models.InterceptorLog) error {
		return interceptorRepo.CreateLog(logEntry)
	})

	// Register logging interceptor plugin
	loggingInterceptorPlugin := interceptorPlugins.NewLoggingInterceptor()
	// 设置日志保存回调，将日志持久化到数据库
	loggingInterceptorPlugin.SetLogSaver(func(logEntry *models.InterceptorLog) error {
		return interceptorRepo.CreateLog(logEntry)
	})
	if err := interceptorManager.RegisterPlugin(loggingInterceptorPlugin); err != nil {
		mainLogger.Error("Failed to register logging interceptor: %v", err)
	} else {
		mainLogger.Info("Logging interceptor plugin registered with database persistence")
	}

	// Load enabled interceptor configs from database
	if interceptors, err := interceptorRepo.ListEnabled(); err == nil {
		configs := make([]*interceptor.InterceptorConfig, len(interceptors))
		for i, ic := range interceptors {
			configs[i] = &interceptor.InterceptorConfig{
				ID:            ic.ID,
				Name:          ic.Name,
				Description:   ic.Description,
				PluginID:      ic.PluginID,
				Enabled:       ic.Enabled,
				Order:         ic.Order,
				Phases:        ic.Phases,
				Filter:        ic.Filter,
				ErrorHandling: ic.ErrorHandling,
				SkipConfig:    ic.SkipConfig,
				Execution:     ic.Execution,
				PluginConfig:  ic.PluginConfig,
				Scope:         ic.Scope,
				TriggerID:     ic.TriggerID,
				ExtractorID:   ic.ExtractorID,
			}
		}
		if len(configs) > 0 {
			if err := interceptorManager.LoadConfigs(configs); err != nil {
				mainLogger.Error("Failed to load interceptor configs: %v", err)
			} else {
				mainLogger.Info("Loaded %d interceptor configs", len(configs))
			}
		}
	} else {
		mainLogger.Warn("Failed to load interceptor configs: %v", err)
	}

	// Create Interceptor API Handler
	interceptorHandler := api.NewInterceptorHandler(interceptorRepo, interceptorManager)

	// Initialize Interceptor Log Cleanup Service
	interceptorLogCleanupService := services.NewInterceptorLogCleanupService(db, 30) // 默认30天
	interceptorLogCleanupService.Start()

	// Initialize EventBus and ConditionEngine
	eventBus := services.NewEventBus()
	conditionEngine := services.NewConditionEngine(pluginManager)
	interceptorManager.SetAdvancedFilterEvaluator(func(filter models.InterceptorFilter, ictx *interceptor.InterceptorContext) (bool, models.JSONMap, error) {
		if len(filter.Expressions) == 0 {
			return true, nil, nil
		}

		rawExpressions, err := json.Marshal(filter.Expressions)
		if err != nil {
			return false, nil, fmt.Errorf("failed to marshal interceptor expressions: %w", err)
		}
		var expressions []models.TriggerExpression
		if err := json.Unmarshal(rawExpressions, &expressions); err != nil {
			return false, nil, fmt.Errorf("failed to parse interceptor expressions: %w", err)
		}
		if len(expressions) == 0 {
			return true, nil, nil
		}

		var email models.Email
		if ictx != nil && ictx.Email != nil {
			email = *ictx.Email
		}
		evalCtx := services.NewEvaluationContext(email)
		if ictx != nil {
			evalCtx.Data["triggerId"] = ictx.TriggerID
			evalCtx.Data["phase"] = string(ictx.Phase)
			if ictx.Action != nil {
				evalCtx.Data["action"] = ictx.Action
				evalCtx.Data["actionPluginId"] = ictx.Action.PluginID
				evalCtx.Data["actionId"] = ictx.Action.ID
			}
		}
		detailsResult, details, err := conditionEngine.EvaluateExpressions(expressions, evalCtx)
		if err != nil {
			return false, details, err
		}
		return detailsResult, details, nil
	})

	// Initialize EmailTriggerService for V2
	emailTriggerService := services.NewEmailTriggerService(
		emailTriggerV2Repo,
		triggerExecutionLogV2Repo,
		subscriptionManager,
		eventBus,
		conditionEngine,
		pluginManager,
		interceptorManager,
	)
	emailTriggerService.SetBusinessLogPipeline(businessLogPipeline)

	// Initialize V2 EmailTriggerService (set up trigger subscriptions)
	mainLogger.Info("正在初始化 V2 EmailTriggerService...")
	if err := emailTriggerService.Initialize(); err != nil {
		mainLogger.Error("Failed to initialize email trigger service: %v", err)
		log.Fatalf("Failed to initialize email trigger service: %v", err)
	}
	mainLogger.Info("V2 EmailTriggerService 初始化完成")

	// Initialize Email Notification Service
	mainLogger.Info("正在初始化邮件通知服务...")
	emailNotificationService := services.NewEmailNotificationService()

	// Initialize unified email ingest pipeline
	mainLogger.Info("正在初始化统一邮件入库管道...")
	emailIngestService := services.NewEmailIngestService(
		emailRepo,
		emailAccountRepo,
		emailNotificationService,
		eventBus,
		subscriptionManager,
	)
	fetcherService.SetEmailIngestService(emailIngestService)
	incrementalSyncManager.SetEmailIngestService(emailIngestService)

	// Initialize Per Account Sync Manager
	mainLogger.Info("正在初始化每账户同步管理器...")
	perAccountSyncManager := services.NewPerAccountSyncManager(
		syncConfigRepo,
		emailRepo,
		mailboxRepo,
		emailAccountRepo,
		fetcherService,
		emailNotificationService,
		eventBus, // 传递EventBus使触发器系统能接收新邮件事件
		subscriptionManager,
	)
	perAccountSyncManager.SetEmailIngestService(emailIngestService)
	perAccountSyncManager.SetBusinessLogPipeline(businessLogPipeline)
	if err := perAccountSyncManager.Start(); err != nil {
		mainLogger.Error("Failed to start per-account sync manager: %v", err)
		return
	}

	// Initialize Account Recovery Service
	mainLogger.Info("正在初始化账户恢复服务...")
	accountRecoveryService := services.NewAccountRecoveryService(
		syncConfigRepo,
		emailAccountRepo,
		oauth2Service,
		perAccountSyncManager,
	)
	if err := accountRecoveryService.Start(); err != nil {
		mainLogger.Error("Failed to start account recovery service: %v", err)
		return
	}

	// Initialize Email Sender Service
	mainLogger.Info("正在初始化邮件发送服务...")
	emailSenderService := services.NewEmailSenderService(
		db,
		emailAccountRepo,
		oauth2Service,
		activityLogger,
	)

	// Initialize API handler
	apiHandler := api.NewAPIHandler(fetcherService, parserService, emailAccountRepo, mailProviderRepo, emailRepo, incrementalSyncRepo, emailFetchScheduler, pluginManager, incrementalSyncManager, perAccountSyncManager, syncConfigRepo, emailIngestService)
	apiHandler.SetProxyPoolService(proxyPoolService)

	// Initialize Email Send handler
	emailSendHandler := api.NewEmailSendHandlers(emailSenderService)

	// Initialize OpenAI handler
	openAIHandler := api.NewOpenAIHandler(openAIConfigRepo, aiPromptTemplateRepo, extractorTemplateRepo)

	// Initialize Auth handler
	authHandler := api.NewAuthHandler(authService, userRepo)

	// Initialize Sync handlers（使用SyncConfigRepository和PerAccountSyncManager）
	syncHandlers := api.NewSyncHandlers(syncConfigRepo, emailAccountRepo, perAccountSyncManager, fetcherService)

	// Initialize Pickup service and handler
	extractorSvc := services.NewExtractorService()
	extractorSvcV2 := services.NewExtractorServiceV2(db)
	pickupService := services.NewPickupService(emailRepo, emailAccountRepo, extractorSvc, extractorSvcV2, perAccountSyncManager)
	pickupService.SetBusinessLogPipeline(businessLogPipeline)
	apiHandler.SetPickupService(pickupService)
	pickupHandler := api.NewPickupHandler(pickupService)
	outputLogHandler := api.NewOutputLogHandler(outputLogService, systemConfigRepo)
	businessLogHandler := api.NewBusinessLogHandler(businessLogRepo, systemConfigRepo, businessLogPipeline)

	// Initialize Session handler
	sessionHandler := api.NewSessionHandler(authService)

	// Initialize Trigger handler
	triggerHandler := api.NewTriggerAPIHandler(triggerService, triggerRepo, triggerLogRepo, pluginManager, interceptorManager)

	// Initialize OAuth2 handler
	oauth2Handler := api.NewOAuth2Handler(oauth2ConfigService, oauth2Service, oauth2AuthSessionService)

	// Initialize System Config service and handler
	systemConfigService := services.NewSystemConfigService(systemConfigRepo)
	systemConfigHandler := api.NewSystemConfigHandler(systemConfigService)

	// Initialize default system configurations
	if err := systemConfigService.InitializeDefaults(); err != nil {
		mainLogger.Warn("Failed to initialize default system configurations: %v", err)
	}

	// Initialize WebSocket handler
	mainLogger.Info("正在初始化WebSocket处理器...")
	webSocketHandler := api.NewWebSocketHandler(emailNotificationService)

	// Initialize Tag handlers
	mainLogger.Info("正在初始化标签处理器...")
	tagHandlers := api.NewTagHandlers(tagRepo, emailAccountRepo)

	// Initialize Proxy Pool handlers
	mainLogger.Info("正在初始化代理池处理器...")
	proxyPoolHandlers := api.NewProxyPoolHandlers(proxyPoolRepo, proxyPoolService)
	proxyGatewayHandlers := api.NewProxyGatewayHandlers(proxyGatewayRepo, proxyGatewayService)

	if err := proxyGatewayService.Start(context.Background()); err != nil {
		mainLogger.Warn("Proxy Gateway 启动失败: %v", err)
	}

	// Initialize default AI prompt templates
	if err := aiPromptTemplateRepo.InitializeDefaultTemplates(); err != nil {
		mainLogger.Warn("Failed to initialize default AI prompt templates: %v", err)
	}

	// Initialize Organization handler
	mainLogger.Info("正在初始化组织管理处理器...")
	orgHandler := api.NewOrganizationHandler(orgRepo, orgMemberRepo, roleRepo, userRepo)

	// Initialize User Management handler (super admin only)
	mainLogger.Info("正在初始化用户管理处理器...")
	userMgmtHandler := api.NewUserManagementHandler(userRepo, orgMemberRepo, roleRepo)

	// Create router with authentication
	router := api.NewRouterWithAuth(
		apiHandler,
		openAIHandler,
		authHandler,
		syncHandlers,
		sessionHandler,
		triggerHandler,
		oauth2Handler,
		systemConfigHandler,
		webSocketHandler,
		emailSendHandler,
		interceptorHandler,
		tagHandlers,
		proxyPoolHandlers,
		proxyGatewayHandlers,
		pickupHandler,
		outputLogHandler,
		businessLogHandler,
		businessLogPipeline,
		orgHandler,
		userMgmtHandler,
		authService,
		emailTriggerService,
		emailTriggerV2Repo,
		triggerExecutionLogV2Repo,
		emailRepo,
		pluginManager,
		interceptorManager,
		conditionEngine,
		orgRepo,
		orgMemberRepo,
		roleRepo,
	)

	// Create HTTP server
	srv := &http.Server{
		Addr:    cfg.ServerAddress(),
		Handler: router,
	}

	// Setup graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// Start server in a goroutine
	go func() {
		mainLogger.Info("Server is running on http://%s", cfg.ServerAddress())
		fmt.Printf("Server is running on http://%s\n", cfg.ServerAddress())
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			mainLogger.Error("Server failed to start: %v", err)
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	// Wait for interrupt signal
	<-stop
	mainLogger.Info("Shutting down server...")
	fmt.Println("\nShutting down server...")

	// Create a deadline to wait for
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Stop activity logger
	mainLogger.Info("Stopping activity logger...")
	activityLogger.Stop()

	// Stop interceptor log cleanup service
	interceptorLogCleanupService.Stop()

	// Stop V2 trigger service first
	mainLogger.Info("Stopping V2 EmailTriggerService...")
	emailTriggerService.Shutdown()

	// Stop per-account sync manager before shutting down shared scheduler/fetcher resources.
	mainLogger.Info("Stopping per-account sync manager...")
	perAccountSyncManager.Stop()

	// Stop incremental sync manager
	mainLogger.Info("Stopping incremental sync manager...")
	incrementalSyncManager.Stop()

	// Stop email fetch scheduler
	mainLogger.Info("Stopping email fetch scheduler...")
	emailFetchScheduler.Stop()

	// Stop long-lived log stream handlers so HTTP shutdown does not wait for SSE clients.
	mainLogger.Info("Stopping output log stream service...")
	outputLogService.Shutdown()


	// Gracefully shutdown the HTTP server
	mainLogger.Info("Shutting down HTTP server...")
	if err := srv.Shutdown(ctx); err != nil {
		mainLogger.Error("Server forced to shutdown: %v", err)
	}

	mainLogger.Info("Server shutdown complete")
}
