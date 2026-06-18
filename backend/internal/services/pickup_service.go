package services

import (
	"context"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
	"strings"
	"sync"
	"time"
)

const (
	pickupImmediateSyncTimeout  = 12 * time.Second
	pickupEmailSearchTimeout    = 5 * time.Second
	pickupPollRequestTimeout    = 25 * time.Second
	pickupAccountResolveTimeout = 3 * time.Second
	pickupOverrideSetupTimeout  = 2 * time.Second
	businessLogHotPathTimeout   = 2 * time.Second
)

// PickupPollRequest 取件轮询请求
type PickupPollRequest struct {
	Context          context.Context `json:"-"`
	AccountID        uint            `json:"account_id"`         // 可选但推荐传；to_query 能解析到账户时以后端解析结果为准
	KeepAliveSeconds int             `json:"keep_alive_seconds"` // 临时同步覆盖有效期(秒)，建议 30-120
	SyncInterval     int             `json:"sync_interval"`      // 后端拉取邮件间隔(秒)，默认 5
	Since            string          `json:"since"`              // ISO8601 搜索起始时间
	ToQuery          string          `json:"to_query,omitempty"` // 收件人过滤
	Limit            int             `json:"limit,omitempty"`    // 返回数量限制，默认 10

	// 提取模式（三选一，可都不传表示只搜索不提取）
	TemplateID    *uint                `json:"template_id,omitempty"`    // 方式1: 引用已有V2模板
	InlineActions *InlineActionsConfig `json:"inline_actions,omitempty"` // 方式2: 内联V2动作
	SimpleExtract *SimpleExtractConfig `json:"simple_extract,omitempty"` // 方式3: 简单提取（V1风格）
}

// InlineActionsConfig 内联V2动作配置
type InlineActionsConfig struct {
	Expressions  models.TriggerExpressions    `json:"expressions,omitempty"`
	Actions      models.TriggerActions        `json:"actions"`
	OutputConfig models.ExtractorOutputConfig `json:"output_config"`
}

// SimpleExtractConfig 简单提取配置（兼容V1风格）
type SimpleExtractConfig struct {
	Field      string `json:"field"`                 // body, subject, from, html_body
	Type       string `json:"type"`                  // regex, js, gotemplate
	Pattern    string `json:"pattern"`               // 正则表达式或脚本
	MatchMode  string `json:"match_mode,omitempty"`  // all, first, last, index
	MatchIndex *int   `json:"match_index,omitempty"` // 0-based index; negative indexes count from the end
}

// PickupPollResponse 取件轮询响应
type PickupPollResponse struct {
	Success            bool                   `json:"success"`
	AccountID          uint                   `json:"account_id"`
	RequestedAccountID uint                   `json:"requested_account_id,omitempty"`
	ResolvedBy         string                 `json:"resolved_by,omitempty"`
	Emails             []models.Email         `json:"emails"`
	NewCount           int                    `json:"new_count"`
	Extractions        []ExtractionResultItem `json:"extractions,omitempty"`
	SyncActive         bool                   `json:"sync_active"`
	SyncExpiresAt      string                 `json:"sync_expires_at"`
}

// ExtractionResultItem 单封邮件的提取结果
type ExtractionResultItem struct {
	EmailID        uint        `json:"email_id"`
	Success        bool        `json:"success"`
	Status         string      `json:"status"` // success, failed, no_match, skipped
	ExtractedValue interface{} `json:"extracted_value,omitempty"`
	Error          string      `json:"error,omitempty"`
}

// PickupService 取件轮询服务
type PickupService struct {
	emailRepo      *repository.EmailRepository
	accountRepo    *repository.EmailAccountRepository
	extractorSvc   *ExtractorService   // V1
	extractorSvcV2 *ExtractorServiceV2 // V2
	syncManager    *PerAccountSyncManager
	businessLog    *BusinessLogPipeline
	logger         *utils.Logger

	immediateSyncMu       sync.Mutex
	immediateSyncInFlight map[uint]struct{}
}

// NewPickupService 创建取件轮询服务
func NewPickupService(
	emailRepo *repository.EmailRepository,
	accountRepo *repository.EmailAccountRepository,
	extractorSvc *ExtractorService,
	extractorSvcV2 *ExtractorServiceV2,
	syncManager *PerAccountSyncManager,
) *PickupService {
	return &PickupService{
		emailRepo:      emailRepo,
		accountRepo:    accountRepo,
		extractorSvc:   extractorSvc,
		extractorSvcV2: extractorSvcV2,
		syncManager:    syncManager,
		logger:         utils.NewLogger("PickupService"),

		immediateSyncInFlight: make(map[uint]struct{}),
	}
}

func (s *PickupService) SetBusinessLogPipeline(pipeline *BusinessLogPipeline) {
	s.businessLog = pipeline
}

// Poll 执行一次取件轮询
func (s *PickupService) Poll(req PickupPollRequest) (*PickupPollResponse, error) {
	startTime := time.Now()
	ctx := req.Context
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, pickupPollRequestTimeout)
	defer cancel()
	recordPoll := RuntimeMetrics().BeginPickupPoll()
	activePoll := RuntimeMetrics().BeginActiveOperation("http", EmailIngestSourcePickup, "pickup_poll", req.AccountID, "", "resolve_account")
	var pollErr error
	currentStage := "resolve_account"
	setStage := func(stage string) {
		currentStage = stage
		activePoll.Stage(stage)
	}
	requestedAccountID := req.AccountID
	resolvedBy := ""
	finalAccountID := req.AccountID
	emailCount := 0
	extractionCount := 0
	defer func() {
		recordPoll(pollErr)
		activePoll.Finish(pollErr)
		duration := time.Since(startTime)
		if pollErr != nil || duration > 5*time.Second {
			s.logger.Warn("Pickup poll finished: requested=%d final=%d resolved_by=%s stage=%s duration=%s emails=%d extractions=%d err=%v",
				requestedAccountID, finalAccountID, resolvedBy, currentStage, duration, emailCount, extractionCount, pollErr)
		} else {
			s.logger.Debug("Pickup poll finished: requested=%d final=%d resolved_by=%s stage=%s duration=%s emails=%d extractions=%d",
				requestedAccountID, finalAccountID, resolvedBy, currentStage, duration, emailCount, extractionCount)
		}
		s.recordPickupBusinessLog(startTime, requestedAccountID, finalAccountID, resolvedBy, req, emailCount, extractionCount, pollErr)
	}()

	// 1. 设置默认值
	if req.SyncInterval <= 0 {
		req.SyncInterval = 5
	}
	if req.KeepAliveSeconds <= 0 {
		req.KeepAliveSeconds = 30
	}
	if req.Limit <= 0 {
		req.Limit = 10
	}

	resolvedAccountID, resolvedByValue, err := s.resolvePickupAccountID(ctx, req.AccountID, req.ToQuery)
	if err != nil {
		pollErr = err
		return nil, err
	}
	resolvedBy = resolvedByValue
	req.AccountID = resolvedAccountID
	finalAccountID = resolvedAccountID

	// 2. 注册/续期取件轮询覆盖（纯内存，零DB写入）
	setStage("register_pickup_override")
	if s.syncManager != nil {
		overrideCtx, overrideCancel := context.WithTimeout(ctx, pickupOverrideSetupTimeout)
		if err := s.syncManager.RegisterPickupOverrideWithContext(overrideCtx, req.AccountID, req.SyncInterval, req.KeepAliveSeconds); err != nil {
			s.logger.Warn("Pickup override setup skipped/failed for account %d (requested=%d, resolved_by=%s): %v",
				req.AccountID, requestedAccountID, resolvedBy, err)
		}
		overrideCancel()
	}

	// pickup 需要尽量返回刚到达的邮件；注册临时覆盖后立即同步一次，再查数据库。
	setStage("immediate_sync")
	syncCtx, syncCancel := context.WithTimeout(ctx, pickupImmediateSyncTimeout)
	defer syncCancel()
	s.runImmediatePickupSync(syncCtx, req, requestedAccountID, resolvedBy)

	// 3. 解析搜索起始时间
	var startDate *time.Time
	if req.Since != "" {
		parsed, err := time.Parse(time.RFC3339, req.Since)
		if err != nil {
			pollErr = fmt.Errorf("invalid since time format (expected RFC3339): %w", err)
			return nil, pollErr
		}
		startDate = &parsed
	}

	// 4. 搜索邮件
	setStage("search_db")
	searchCtx, searchCancel := context.WithTimeout(ctx, pickupEmailSearchTimeout)
	defer searchCancel()
	searchOpts := repository.EmailSearchOptions{
		Context:        searchCtx,
		AccountID:      req.AccountID,
		Limit:          req.Limit,
		StartDate:      startDate,
		ToQuery:        req.ToQuery,
		SortBy:         "date DESC",
		SkipTotalCount: true,
	}

	emails, _, err := s.emailRepo.SearchEmails(searchOpts)
	if err != nil {
		pollErr = fmt.Errorf("failed to search emails: %w", err)
		return nil, pollErr
	}
	emailCount = len(emails)

	s.logger.Debug("Pickup poll for account %d: found %d emails", req.AccountID, len(emails))

	// 5. 获取覆盖状态
	var override *PickupOverride
	if s.syncManager != nil {
		override = s.syncManager.GetPickupOverride(req.AccountID)
	}
	syncActive := override != nil
	syncExpiresAt := ""
	if override != nil {
		syncExpiresAt = override.ExpiresAt.Format(time.RFC3339)
	}

	// 6. 执行提取（如果配置了）
	var extractions []ExtractionResultItem
	if len(emails) > 0 {
		setStage("extract")
		if req.TemplateID != nil {
			extractions = s.extractWithTemplate(emails, *req.TemplateID)
		} else if req.InlineActions != nil {
			extractions = s.extractWithInlineActions(emails, req.InlineActions)
		} else if req.SimpleExtract != nil {
			extractions = s.extractWithSimple(emails, req.SimpleExtract)
		}
		extractionCount = len(extractions)
	}

	return &PickupPollResponse{
		Success:            true,
		AccountID:          req.AccountID,
		RequestedAccountID: requestedAccountID,
		ResolvedBy:         resolvedBy,
		Emails:             emails,
		NewCount:           len(emails),
		Extractions:        extractions,
		SyncActive:         syncActive,
		SyncExpiresAt:      syncExpiresAt,
	}, nil
}

func (s *PickupService) runImmediatePickupSync(ctx context.Context, req PickupPollRequest, requestedAccountID uint, resolvedBy string) {
	if s.syncManager == nil {
		return
	}
	if !s.tryBeginImmediateSync(req.AccountID) {
		if s.logger != nil {
			s.logger.Debug("Pickup immediate sync already in flight for account %d; continuing with database search", req.AccountID)
		}
		return
	}

	type syncOutcome struct {
		result *SyncResult
		err    error
	}
	done := make(chan syncOutcome, 1)
	go func() {
		defer s.finishImmediateSync(req.AccountID)
		result, err := s.syncManager.SyncNow(req.AccountID, SyncNowOptions{
			CreateStrategy: "ensure",
			SyncInterval:   req.SyncInterval,
			Source:         EmailIngestSourcePickup,
			Context:        ctx,
		})
		done <- syncOutcome{result: result, err: err}
	}()

	timer := time.NewTimer(pickupImmediateSyncTimeout)
	defer timer.Stop()

	select {
	case outcome := <-done:
		if outcome.err != nil {
			s.logger.Warn("Pickup immediate sync failed for account %d (requested=%d, resolved_by=%s, to_query=%q): %v",
				req.AccountID, requestedAccountID, resolvedBy, req.ToQuery, outcome.err)
		} else if outcome.result != nil && outcome.result.Error != nil {
			s.logger.Warn("Pickup immediate sync completed with error for account %d (requested=%d, resolved_by=%s, to_query=%q): %v",
				req.AccountID, requestedAccountID, resolvedBy, req.ToQuery, outcome.result.Error)
		} else if outcome.result != nil {
			s.logger.Debug("Pickup immediate sync completed for account %d: synced %d emails", req.AccountID, outcome.result.EmailsSynced)
		}
	case <-ctx.Done():
		s.logger.Warn("Pickup immediate sync canceled for account %d (requested=%d, resolved_by=%s, to_query=%q): %v",
			req.AccountID, requestedAccountID, resolvedBy, req.ToQuery, ctx.Err())
	case <-timer.C:
		s.logger.Warn("Pickup immediate sync exceeded %s for account %d (requested=%d, resolved_by=%s, to_query=%q); continuing with database search",
			pickupImmediateSyncTimeout, req.AccountID, requestedAccountID, resolvedBy, req.ToQuery)
	}
}

func (s *PickupService) tryBeginImmediateSync(accountID uint) bool {
	s.immediateSyncMu.Lock()
	defer s.immediateSyncMu.Unlock()
	if s.immediateSyncInFlight == nil {
		s.immediateSyncInFlight = make(map[uint]struct{})
	}
	if _, exists := s.immediateSyncInFlight[accountID]; exists {
		return false
	}
	s.immediateSyncInFlight[accountID] = struct{}{}
	return true
}

func (s *PickupService) finishImmediateSync(accountID uint) {
	s.immediateSyncMu.Lock()
	delete(s.immediateSyncInFlight, accountID)
	s.immediateSyncMu.Unlock()
}

func (s *PickupService) recordPickupBusinessLog(startTime time.Time, requestedAccountID uint, finalAccountID uint, resolvedBy string, req PickupPollRequest, emailCount int, extractionCount int, pollErr error) {
	if s.businessLog == nil {
		return
	}
	finishedAt := time.Now()
	status := models.BusinessLogStatusSuccess
	result := "success"
	errorMessage := ""
	if pollErr != nil {
		status = models.BusinessLogStatusFailed
		result = "failed"
		errorMessage = pollErr.Error()
	}
	event := BusinessLogEvent{
		OrgID:         1,
		OperationType: models.BusinessLogOperationAPI,
		ActorType:     models.BusinessLogActorAPI,
		ActorName:     "pickup_poll",
		Module:        "pickup",
		Action:        "poll",
		EntityType:    "email_account",
		EntityID:      fmt.Sprintf("%d", finalAccountID),
		Title:         "取件轮询",
		Summary:       fmt.Sprintf("取件账号 %d 命中 %d 封邮件，提取 %d 条", finalAccountID, emailCount, extractionCount),
		Status:        status,
		Result:        result,
		StartedAt:     startTime,
		FinishedAt:    &finishedAt,
		DurationMS:    finishedAt.Sub(startTime).Milliseconds(),
		ErrorMessage:  errorMessage,
		Details: map[string]interface{}{
			"requested_account_id": requestedAccountID,
			"resolved_account_id":  finalAccountID,
			"resolved_by":          resolvedBy,
			"to_query":             req.ToQuery,
			"limit":                req.Limit,
			"since":                req.Since,
			"sync_interval":        req.SyncInterval,
			"keep_alive_seconds":   req.KeepAliveSeconds,
			"email_count":          emailCount,
			"extraction_count":     extractionCount,
			"has_template":         req.TemplateID != nil,
			"has_inline_actions":   req.InlineActions != nil,
			"has_simple_extract":   req.SimpleExtract != nil,
		},
	}
	processBusinessLogAsync(s.businessLog, s.logger, "pickup poll", event)
}

func processBusinessLogAsync(pipeline *BusinessLogPipeline, logger *utils.Logger, label string, event BusinessLogEvent) {
	if pipeline == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), businessLogHotPathTimeout)
		defer cancel()
		result := pipeline.Process(ctx, event)
		if logger != nil && len(result.Warnings) > 0 {
			logger.Warn("Async business log %s completed with warnings: %s", label, strings.Join(result.Warnings, "; "))
		}
	}()
}

func (s *PickupService) resolvePickupAccountID(ctx context.Context, requestedAccountID uint, toQuery string) (uint, string, error) {
	recipient := strings.TrimSpace(toQuery)
	if recipient != "" && s.accountRepo != nil {
		resolveCtx, cancel := context.WithTimeout(ctx, pickupAccountResolveTimeout)
		defer cancel()
		account, err := s.accountRepo.GetByEmailOrAliasWithContext(resolveCtx, recipient)
		if err == nil && account != nil {
			if s.logger != nil && requestedAccountID != 0 && requestedAccountID != account.ID {
				s.logger.Info("Pickup account resolved by to_query %q: requested=%d resolved=%d", recipient, requestedAccountID, account.ID)
			}
			return account.ID, "to_query", nil
		}
		if requestedAccountID == 0 {
			return 0, "", fmt.Errorf("failed to resolve account for to_query %q: %w", recipient, err)
		}
		if s.logger != nil {
			s.logger.Debug("Pickup to_query %q did not resolve an account, falling back to requested account %d: %v", recipient, requestedAccountID, err)
		}
	}

	if requestedAccountID == 0 {
		return 0, "", fmt.Errorf("account_id is required when to_query cannot resolve an account")
	}
	return requestedAccountID, "account_id", nil
}

// extractWithTemplate 使用已有V2模板提取
func (s *PickupService) extractWithTemplate(emails []models.Email, templateID uint) []ExtractionResultItem {
	results := make([]ExtractionResultItem, 0, len(emails))

	for _, email := range emails {
		item := ExtractionResultItem{
			EmailID: email.ID,
		}

		result, err := s.extractorSvcV2.Execute(templateID, email.ID)
		if err != nil {
			item.Success = false
			item.Status = "failed"
			item.Error = err.Error()
		} else if result != nil {
			item.Success = result.Success
			if result.Success {
				item.Status = "success"
				item.ExtractedValue = result.ExtractedValue
			} else {
				item.Status = "no_match"
				item.Error = result.Error
			}
		}

		results = append(results, item)
	}

	return results
}

// extractWithInlineActions 使用内联V2动作提取
func (s *PickupService) extractWithInlineActions(emails []models.Email, config *InlineActionsConfig) []ExtractionResultItem {
	results := make([]ExtractionResultItem, 0, len(emails))

	// 构建临时模板
	template := &models.ExtractorTemplateV2{
		Expressions:  config.Expressions,
		Actions:      config.Actions,
		OutputConfig: config.OutputConfig,
	}

	for _, email := range emails {
		item := ExtractionResultItem{
			EmailID: email.ID,
		}

		result, err := s.extractorSvcV2.TestExtraction(template, &email)
		if err != nil {
			item.Success = false
			item.Status = "failed"
			item.Error = err.Error()
		} else if result != nil {
			item.Success = result.Success
			if result.Success {
				item.Status = "success"
				item.ExtractedValue = result.ExtractedValue
			} else {
				item.Status = "no_match"
				item.Error = result.Error
			}
		}

		results = append(results, item)
	}

	return results
}

// extractWithSimple 使用简单提取（V1风格）
func (s *PickupService) extractWithSimple(emails []models.Email, config *SimpleExtractConfig) []ExtractionResultItem {
	results := make([]ExtractionResultItem, 0, len(emails))

	// 构建V1提取配置
	extractorConfig := ExtractorConfig{
		Field:   ExtractorField(config.Field),
		Type:    ExtractorType(config.Type),
		Extract: config.Pattern,
	}
	// 对于 regex 类型，pattern 同时作为 match 和 extract
	if config.Type == "regex" {
		matchPattern := strings.SplitN(config.Pattern, "|||", 2)[0]
		extractorConfig.Match = &matchPattern
	}

	for _, email := range emails {
		item := ExtractionResultItem{
			EmailID: email.ID,
		}

		result, err := s.extractorSvc.ExtractFromEmail(email, []ExtractorConfig{extractorConfig})
		if err != nil {
			item.Success = false
			item.Status = "failed"
			item.Error = err.Error()
		} else if result != nil && len(result.Matches) > 0 {
			value, ok := selectSimpleExtractValue(result.Matches, config)
			if ok {
				item.Success = true
				item.Status = "success"
				item.ExtractedValue = value
			} else {
				item.Success = false
				item.Status = "no_match"
			}
		} else {
			item.Success = false
			item.Status = "no_match"
		}

		results = append(results, item)
	}

	return results
}

func selectSimpleExtractValue(matches []string, config *SimpleExtractConfig) (interface{}, bool) {
	if len(matches) == 0 {
		return nil, false
	}

	mode := ""
	if config != nil {
		mode = strings.ToLower(strings.TrimSpace(config.MatchMode))
		if mode == "" && config.MatchIndex != nil {
			mode = "index"
		}
	}

	switch mode {
	case "", "all":
		if len(matches) == 1 {
			return matches[0], true
		}
		return matches, true
	case "first":
		return matches[0], true
	case "last":
		return matches[len(matches)-1], true
	case "index":
		index := 0
		if config != nil && config.MatchIndex != nil {
			index = *config.MatchIndex
		}
		if index < 0 {
			index = len(matches) + index
		}
		if index < 0 || index >= len(matches) {
			return nil, false
		}
		return matches[index], true
	default:
		if len(matches) == 1 {
			return matches[0], true
		}
		return matches, true
	}
}
