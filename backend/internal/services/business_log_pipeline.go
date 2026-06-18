package services

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"strconv"
	"strings"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
)

const BusinessLogSettingsKey = "business-log-settings"

type BusinessLogDecision string

const (
	BusinessLogDecisionAllow          BusinessLogDecision = "allow"
	BusinessLogDecisionBlock          BusinessLogDecision = "block"
	BusinessLogDecisionReviewRequired BusinessLogDecision = "review_required"
	BusinessLogDecisionSkipRecord     BusinessLogDecision = "skip_record"
)

type BusinessLogEvent struct {
	OrgID  uint
	UserID *uint

	// Enforceable marks preflight calls where policy/review middlewares may stop
	// the caller from continuing. Post-action audit events leave this false.
	Enforceable bool

	OperationType models.BusinessLogOperationType
	ActorType     models.BusinessLogActorType
	ActorID       string
	ActorName     string

	Module     string
	Action     string
	EntityType string
	EntityID   string
	EntityName string

	Title   string
	Summary string
	Result  string
	Status  models.BusinessLogStatus

	StartedAt  time.Time
	FinishedAt *time.Time
	DurationMS int64

	TraceID   string
	RunID     string
	RequestID string

	ErrorCode    string
	ErrorMessage string
	Details      map[string]interface{}
	SourceIP     string
	UserAgent    string

	skipRecord bool
	config     BusinessLogConfig
}

type BusinessLogPipelineResult struct {
	Decision          BusinessLogDecision          `json:"decision"`
	Allowed           bool                         `json:"allowed"`
	Code              string                       `json:"code,omitempty"`
	Reason            string                       `json:"reason,omitempty"`
	Details           map[string]interface{}       `json:"details,omitempty"`
	LogID             *uint                        `json:"logId,omitempty"`
	Warnings          []string                     `json:"warnings,omitempty"`
	MiddlewareResults []BusinessLogMiddlewareTrace `json:"middlewareResults,omitempty"`
}

type BusinessLogMiddlewareTrace struct {
	Name     string `json:"name"`
	Decision string `json:"decision"`
	Reason   string `json:"reason,omitempty"`
}

type BusinessLogMiddleware interface {
	Name() string
	Handle(ctx context.Context, event *BusinessLogEvent, next BusinessLogNext) BusinessLogPipelineResult
}

type BusinessLogMiddlewareFunc struct {
	name string
	fn   func(context.Context, *BusinessLogEvent, BusinessLogNext) BusinessLogPipelineResult
}

func (m BusinessLogMiddlewareFunc) Name() string {
	return m.name
}

func (m BusinessLogMiddlewareFunc) Handle(ctx context.Context, event *BusinessLogEvent, next BusinessLogNext) BusinessLogPipelineResult {
	return m.fn(ctx, event, next)
}

type BusinessLogNext func(context.Context, *BusinessLogEvent) BusinessLogPipelineResult

type BusinessLogPipeline struct {
	recorder    *BusinessLogRecorder
	configRepo  *repository.SystemConfigRepository
	middlewares []BusinessLogMiddleware
}

type BusinessLogRecorder struct {
	repo *repository.BusinessLogRepository
}

type BusinessLogConfig struct {
	Enabled              bool                               `json:"enabled"`
	RedactSensitive      bool                               `json:"redactSensitive"`
	DetailLevel          string                             `json:"detailLevel"`
	ForceRecordFailures  bool                               `json:"forceRecordFailures"`
	SuccessSampleRate    float64                            `json:"successSampleRate"`
	RetentionDays        int                                `json:"retentionDays"`
	GlobalLimit          int                                `json:"globalLimit"`
	ModuleLimits         map[string]int                     `json:"moduleLimits"`
	Modules              map[string]BusinessLogModuleConfig `json:"modules"`
	OrganizationConfigs  map[string]BusinessLogScopeConfig  `json:"organizationConfigs"`
	SensitiveFields      []string                           `json:"sensitiveFields"`
	ReviewMiddlewareMode string                             `json:"reviewMiddlewareMode"`
}

type BusinessLogScopeConfig struct {
	Enabled              *bool                              `json:"enabled,omitempty"`
	RedactSensitive      *bool                              `json:"redactSensitive,omitempty"`
	DetailLevel          string                             `json:"detailLevel,omitempty"`
	ForceRecordFailures  *bool                              `json:"forceRecordFailures,omitempty"`
	SuccessSampleRate    *float64                           `json:"successSampleRate,omitempty"`
	RetentionDays        *int                               `json:"retentionDays,omitempty"`
	GlobalLimit          *int                               `json:"globalLimit,omitempty"`
	ModuleLimits         map[string]int                     `json:"moduleLimits,omitempty"`
	Modules              map[string]BusinessLogModuleConfig `json:"modules,omitempty"`
	SensitiveFields      []string                           `json:"sensitiveFields,omitempty"`
	ReviewMiddlewareMode string                             `json:"reviewMiddlewareMode,omitempty"`
}

type BusinessLogModuleConfig struct {
	Enabled            *bool    `json:"enabled,omitempty"`
	DetailLevel        string   `json:"detailLevel,omitempty"`
	SuccessSampleRate  *float64 `json:"successSampleRate,omitempty"`
	RecordActions      []string `json:"recordActions,omitempty"`
	IgnoreActions      []string `json:"ignoreActions,omitempty"`
	Limit              int      `json:"limit,omitempty"`
	RedactSensitive    *bool    `json:"redactSensitive,omitempty"`
	MergeEnabled       *bool    `json:"mergeEnabled,omitempty"`
	MergeWindowSeconds int      `json:"mergeWindowSeconds,omitempty"`
}

func DefaultBusinessLogConfig() BusinessLogConfig {
	return BusinessLogConfig{
		Enabled:             true,
		RedactSensitive:     true,
		DetailLevel:         "summary",
		ForceRecordFailures: true,
		SuccessSampleRate:   1,
		RetentionDays:       0,
		GlobalLimit:         0,
		ModuleLimits:        map[string]int{},
		Modules:             map[string]BusinessLogModuleConfig{},
		OrganizationConfigs: map[string]BusinessLogScopeConfig{},
		SensitiveFields: []string{
			"authorization", "cookie", "password", "passwd", "secret", "token",
			"refresh_token", "access_token", "api_key", "apikey", "credential",
			"proxy", "private_key", "totp", "recovery_code",
		},
		ReviewMiddlewareMode: "disabled",
	}
}

func NewBusinessLogRecorder(repo *repository.BusinessLogRepository) *BusinessLogRecorder {
	return &BusinessLogRecorder{repo: repo}
}

func NewBusinessLogPipeline(recorder *BusinessLogRecorder, configRepo *repository.SystemConfigRepository) *BusinessLogPipeline {
	p := &BusinessLogPipeline{
		recorder:   recorder,
		configRepo: configRepo,
	}
	p.middlewares = []BusinessLogMiddleware{
		p.configMiddleware(),
		p.normalizeMiddleware(),
		p.redactionMiddleware(),
		p.samplingMiddleware(),
		p.reviewPlaceholderMiddleware(),
		p.recordMiddleware(),
	}
	return p
}

func (p *BusinessLogPipeline) Process(ctx context.Context, event BusinessLogEvent) BusinessLogPipelineResult {
	if event.Details == nil {
		event.Details = map[string]interface{}{}
	}

	var chain BusinessLogNext
	chain = func(context.Context, *BusinessLogEvent) BusinessLogPipelineResult {
		return BusinessLogPipelineResult{Decision: BusinessLogDecisionAllow, Allowed: true}
	}

	for i := len(p.middlewares) - 1; i >= 0; i-- {
		middleware := p.middlewares[i]
		next := chain
		chain = func(ctx context.Context, event *BusinessLogEvent) BusinessLogPipelineResult {
			result := middleware.Handle(ctx, event, next)
			result.MiddlewareResults = append([]BusinessLogMiddlewareTrace{{
				Name:     middleware.Name(),
				Decision: string(result.Decision),
				Reason:   result.Reason,
			}}, result.MiddlewareResults...)
			return normalizePipelineResult(result)
		}
	}

	return normalizePipelineResult(chain(ctx, &event))
}

func normalizePipelineResult(result BusinessLogPipelineResult) BusinessLogPipelineResult {
	if result.Decision == "" {
		result.Decision = BusinessLogDecisionAllow
	}
	if result.Decision == BusinessLogDecisionAllow || result.Decision == BusinessLogDecisionSkipRecord {
		result.Allowed = true
	}
	return result
}

func (p *BusinessLogPipeline) configMiddleware() BusinessLogMiddleware {
	return BusinessLogMiddlewareFunc{
		name: "config",
		fn: func(ctx context.Context, event *BusinessLogEvent, next BusinessLogNext) BusinessLogPipelineResult {
			config := applyOrganizationBusinessLogConfig(p.loadConfig(), event.OrgID)
			event.config = config
			if !config.Enabled {
				event.skipRecord = true
				result := next(ctx, event)
				if result.Decision == BusinessLogDecisionAllow {
					result.Decision = BusinessLogDecisionSkipRecord
				}
				return result
			}

			moduleConfig, ok := config.Modules[event.Module]
			if ok && moduleConfig.Enabled != nil && !*moduleConfig.Enabled {
				if config.ForceRecordFailures && event.Status == models.BusinessLogStatusFailed {
					return next(ctx, event)
				}
				event.skipRecord = true
				result := next(ctx, event)
				if result.Decision == BusinessLogDecisionAllow {
					result.Decision = BusinessLogDecisionSkipRecord
				}
				return result
			}
			if ok {
				if containsString(moduleConfig.IgnoreActions, event.Action) {
					if !(config.ForceRecordFailures && event.Status == models.BusinessLogStatusFailed) {
						event.skipRecord = true
					}
				}
				if len(moduleConfig.RecordActions) > 0 && !containsString(moduleConfig.RecordActions, event.Action) {
					if !(config.ForceRecordFailures && event.Status == models.BusinessLogStatusFailed) {
						event.skipRecord = true
					}
				}
			}
			return next(ctx, event)
		},
	}
}

func (p *BusinessLogPipeline) normalizeMiddleware() BusinessLogMiddleware {
	return BusinessLogMiddlewareFunc{
		name: "normalize",
		fn: func(ctx context.Context, event *BusinessLogEvent, next BusinessLogNext) BusinessLogPipelineResult {
			if event.OrgID == 0 {
				event.OrgID = 1
			}
			if event.OperationType == "" {
				event.OperationType = models.BusinessLogOperationManual
			}
			if event.ActorType == "" {
				event.ActorType = models.BusinessLogActorSystem
			}
			event.Module = normalizeLogToken(event.Module, "general")
			event.Action = normalizeLogToken(event.Action, "unknown")
			if event.Status == "" {
				event.Status = models.BusinessLogStatusSuccess
			}
			if event.StartedAt.IsZero() {
				event.StartedAt = time.Now()
			}
			if event.FinishedAt == nil {
				finishedAt := time.Now()
				event.FinishedAt = &finishedAt
			}
			if event.DurationMS <= 0 && event.FinishedAt != nil {
				event.DurationMS = event.FinishedAt.Sub(event.StartedAt).Milliseconds()
				if event.DurationMS < 0 {
					event.DurationMS = 0
				}
			}
			if event.Title == "" {
				event.Title = fmt.Sprintf("%s %s", event.Module, event.Action)
			}
			if event.TraceID == "" {
				event.TraceID = NewBusinessTraceID("biz")
			}
			if event.Status == models.BusinessLogStatusFailed && event.Result == "" {
				event.Result = "failed"
			}
			return next(ctx, event)
		},
	}
}

func (p *BusinessLogPipeline) redactionMiddleware() BusinessLogMiddleware {
	return BusinessLogMiddlewareFunc{
		name: "redaction",
		fn: func(ctx context.Context, event *BusinessLogEvent, next BusinessLogNext) BusinessLogPipelineResult {
			if !shouldRedact(event) {
				return next(ctx, event)
			}
			event.Details = redactMap(event.Details, event.config.SensitiveFields)
			event.UserAgent = redactStringIfSensitive("user_agent", event.UserAgent, event.config.SensitiveFields)
			return next(ctx, event)
		},
	}
}

func (p *BusinessLogPipeline) samplingMiddleware() BusinessLogMiddleware {
	return BusinessLogMiddlewareFunc{
		name: "sampling",
		fn: func(ctx context.Context, event *BusinessLogEvent, next BusinessLogNext) BusinessLogPipelineResult {
			if event.skipRecord {
				return next(ctx, event)
			}
			if event.Status == models.BusinessLogStatusFailed && event.config.ForceRecordFailures {
				return next(ctx, event)
			}
			rate := event.config.SuccessSampleRate
			if moduleConfig, ok := event.config.Modules[event.Module]; ok && moduleConfig.SuccessSampleRate != nil {
				rate = *moduleConfig.SuccessSampleRate
			}
			if rate < 0 {
				rate = 0
			}
			if rate > 1 {
				rate = 1
			}
			if rate == 0 || (rate < 1 && rand.Float64() > rate) {
				event.skipRecord = true
			}
			return next(ctx, event)
		},
	}
}

func (p *BusinessLogPipeline) reviewPlaceholderMiddleware() BusinessLogMiddleware {
	return BusinessLogMiddlewareFunc{
		name: "review-policy",
		fn: func(ctx context.Context, event *BusinessLogEvent, next BusinessLogNext) BusinessLogPipelineResult {
			if strings.EqualFold(event.config.ReviewMiddlewareMode, "block_all") {
				if !event.Enforceable {
					if event.Details == nil {
						event.Details = map[string]interface{}{}
					}
					event.Details["review_policy"] = "block_all"
					event.Details["review_decision"] = "would_block"
					event.Details["review_enforced"] = false
					result := next(ctx, event)
					result.Warnings = append(result.Warnings, "review policy would block but this event is audit-only")
					return result
				}
				event.Status = models.BusinessLogStatusFailed
				event.Result = "blocked"
				event.ErrorCode = "business_review_blocked"
				event.ErrorMessage = "Business log review policy blocked this operation"
				if event.Details == nil {
					event.Details = map[string]interface{}{}
				}
				event.Details["blocked_by"] = "review-policy"
				recordResult := next(ctx, event)
				return BusinessLogPipelineResult{
					Decision: BusinessLogDecisionBlock,
					Allowed:  false,
					Code:     "business_review_blocked",
					Reason:   "Business log review policy blocked this operation",
					LogID:    recordResult.LogID,
					Warnings: recordResult.Warnings,
				}
			}
			return next(ctx, event)
		},
	}
}

func (p *BusinessLogPipeline) recordMiddleware() BusinessLogMiddleware {
	return BusinessLogMiddlewareFunc{
		name: "recorder",
		fn: func(ctx context.Context, event *BusinessLogEvent, next BusinessLogNext) BusinessLogPipelineResult {
			if event.skipRecord {
				return BusinessLogPipelineResult{Decision: BusinessLogDecisionSkipRecord, Allowed: true}
			}
			logID, err := p.recorder.Record(ctx, event)
			result := next(ctx, event)
			if err != nil {
				result.Warnings = append(result.Warnings, err.Error())
				return result
			}
			result.LogID = &logID
			p.enforceRetention(ctx, *event)
			return result
		},
	}
}

func (r *BusinessLogRecorder) Record(ctx context.Context, event *BusinessLogEvent) (uint, error) {
	if r == nil || r.repo == nil {
		return 0, fmt.Errorf("business log recorder is not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	details := models.JSONMapInterface{}
	for key, value := range event.Details {
		details[key] = value
	}

	log := &models.BusinessLog{
		OrgID:         event.OrgID,
		UserID:        event.UserID,
		OperationType: event.OperationType,
		ActorType:     event.ActorType,
		ActorID:       event.ActorID,
		ActorName:     event.ActorName,
		Module:        event.Module,
		Action:        event.Action,
		EntityType:    event.EntityType,
		EntityID:      event.EntityID,
		EntityName:    event.EntityName,
		Title:         event.Title,
		Summary:       event.Summary,
		Result:        event.Result,
		Status:        string(event.Status),
		StartedAt:     event.StartedAt,
		FinishedAt:    event.FinishedAt,
		DurationMS:    event.DurationMS,
		TraceID:       event.TraceID,
		RunID:         event.RunID,
		RequestID:     event.RequestID,
		ErrorCode:     event.ErrorCode,
		ErrorMessage:  event.ErrorMessage,
		Details:       details,
		SourceIP:      event.SourceIP,
		UserAgent:     event.UserAgent,
	}
	mergeEnabled, mergeWindow := businessLogMergeConfig(event)
	if mergeEnabled {
		if id, merged, err := r.repo.MergeIntoRecentWithContext(ctx, log, mergeWindow); err != nil {
			return 0, err
		} else if merged {
			return id, nil
		}
	}
	if err := r.repo.CreateWithContext(ctx, log); err != nil {
		return 0, err
	}
	return log.ID, nil
}

func (p *BusinessLogPipeline) loadConfig() BusinessLogConfig {
	config := DefaultBusinessLogConfig()
	if p == nil || p.configRepo == nil {
		return config
	}
	value, err := p.configRepo.GetValueByKey(BusinessLogSettingsKey)
	if err != nil || value == nil {
		return config
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return config
	}
	if err := json.Unmarshal(bytes, &config); err != nil {
		return DefaultBusinessLogConfig()
	}
	if config.SensitiveFields == nil {
		config.SensitiveFields = DefaultBusinessLogConfig().SensitiveFields
	}
	if config.ModuleLimits == nil {
		config.ModuleLimits = map[string]int{}
	}
	if config.Modules == nil {
		config.Modules = map[string]BusinessLogModuleConfig{}
	}
	if config.OrganizationConfigs == nil {
		config.OrganizationConfigs = map[string]BusinessLogScopeConfig{}
	}
	if config.SuccessSampleRate == 0 && valueMapHasNoSampleRate(value) {
		config.SuccessSampleRate = 1
	}
	return config
}

func applyOrganizationBusinessLogConfig(config BusinessLogConfig, orgID uint) BusinessLogConfig {
	if orgID == 0 {
		orgID = 1
	}
	if config.OrganizationConfigs == nil {
		return config
	}
	scope, ok := config.OrganizationConfigs[strconv.FormatUint(uint64(orgID), 10)]
	if !ok {
		return config
	}

	if scope.Enabled != nil {
		config.Enabled = *scope.Enabled
	}
	if scope.RedactSensitive != nil {
		config.RedactSensitive = *scope.RedactSensitive
	}
	if scope.DetailLevel != "" {
		config.DetailLevel = scope.DetailLevel
	}
	if scope.ForceRecordFailures != nil {
		config.ForceRecordFailures = *scope.ForceRecordFailures
	}
	if scope.SuccessSampleRate != nil {
		config.SuccessSampleRate = *scope.SuccessSampleRate
	}
	if scope.RetentionDays != nil {
		config.RetentionDays = *scope.RetentionDays
	}
	if scope.GlobalLimit != nil {
		config.GlobalLimit = *scope.GlobalLimit
	}
	if len(scope.SensitiveFields) > 0 {
		config.SensitiveFields = append([]string(nil), scope.SensitiveFields...)
	}
	if scope.ReviewMiddlewareMode != "" {
		config.ReviewMiddlewareMode = scope.ReviewMiddlewareMode
	}
	if scope.ModuleLimits != nil {
		if config.ModuleLimits == nil {
			config.ModuleLimits = map[string]int{}
		}
		for module, limit := range scope.ModuleLimits {
			config.ModuleLimits[module] = limit
		}
	}
	if scope.Modules != nil {
		if config.Modules == nil {
			config.Modules = map[string]BusinessLogModuleConfig{}
		}
		for module, override := range scope.Modules {
			config.Modules[module] = mergeBusinessLogModuleConfig(config.Modules[module], override)
		}
	}

	return config
}

func mergeBusinessLogModuleConfig(base BusinessLogModuleConfig, override BusinessLogModuleConfig) BusinessLogModuleConfig {
	if override.Enabled != nil {
		base.Enabled = override.Enabled
	}
	if override.DetailLevel != "" {
		base.DetailLevel = override.DetailLevel
	}
	if override.SuccessSampleRate != nil {
		base.SuccessSampleRate = override.SuccessSampleRate
	}
	if override.RecordActions != nil {
		base.RecordActions = append([]string(nil), override.RecordActions...)
	}
	if override.IgnoreActions != nil {
		base.IgnoreActions = append([]string(nil), override.IgnoreActions...)
	}
	if override.Limit > 0 {
		base.Limit = override.Limit
	}
	if override.RedactSensitive != nil {
		base.RedactSensitive = override.RedactSensitive
	}
	if override.MergeEnabled != nil {
		base.MergeEnabled = override.MergeEnabled
	}
	if override.MergeWindowSeconds > 0 {
		base.MergeWindowSeconds = override.MergeWindowSeconds
	}
	return base
}

func businessLogMergeConfig(event *BusinessLogEvent) (bool, time.Duration) {
	if event == nil || event.config.Modules == nil {
		return false, 0
	}
	moduleConfig, ok := event.config.Modules[event.Module]
	if !ok || moduleConfig.MergeEnabled == nil || !*moduleConfig.MergeEnabled {
		return false, 0
	}
	seconds := moduleConfig.MergeWindowSeconds
	if seconds <= 0 {
		seconds = 60
	}
	if seconds > 24*60*60 {
		seconds = 24 * 60 * 60
	}
	return true, time.Duration(seconds) * time.Second
}

func (p *BusinessLogPipeline) enforceRetention(ctx context.Context, event BusinessLogEvent) {
	if p == nil || p.recorder == nil || p.recorder.repo == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return
	}
	config := event.config
	if config.RetentionDays > 0 {
		_ = p.recorder.repo.DeleteOldWithContext(ctx, event.OrgID, time.Now().AddDate(0, 0, -config.RetentionDays))
	}
	if err := ctx.Err(); err != nil {
		return
	}

	moduleLimit := 0
	if config.ModuleLimits != nil {
		moduleLimit = config.ModuleLimits[event.Module]
	}
	if moduleConfig, ok := config.Modules[event.Module]; ok && moduleConfig.Limit > 0 {
		moduleLimit = moduleConfig.Limit
	}
	if config.GlobalLimit > 0 && (moduleLimit == 0 || config.GlobalLimit < moduleLimit) {
		moduleLimit = config.GlobalLimit
	}
	_ = p.recorder.repo.EnforceLimitWithContext(ctx, event.OrgID, event.Module, moduleLimit)
	if err := ctx.Err(); err != nil {
		return
	}
	if config.GlobalLimit > 0 {
		_ = p.recorder.repo.EnforceLimitWithContext(ctx, event.OrgID, "", config.GlobalLimit)
	}
}

func shouldRedact(event *BusinessLogEvent) bool {
	redact := event.config.RedactSensitive
	if moduleConfig, ok := event.config.Modules[event.Module]; ok && moduleConfig.RedactSensitive != nil {
		redact = *moduleConfig.RedactSensitive
	}
	return redact
}

func redactMap(input map[string]interface{}, sensitiveFields []string) map[string]interface{} {
	output := make(map[string]interface{}, len(input))
	for key, value := range input {
		if isSensitiveKey(key, sensitiveFields) {
			output[key] = "[REDACTED]"
			continue
		}
		switch typed := value.(type) {
		case map[string]interface{}:
			output[key] = redactMap(typed, sensitiveFields)
		case models.JSONMapInterface:
			next := map[string]interface{}{}
			for k, v := range typed {
				next[k] = v
			}
			output[key] = redactMap(next, sensitiveFields)
		case []interface{}:
			items := make([]interface{}, len(typed))
			for i, item := range typed {
				if itemMap, ok := item.(map[string]interface{}); ok {
					items[i] = redactMap(itemMap, sensitiveFields)
				} else {
					items[i] = item
				}
			}
			output[key] = items
		default:
			output[key] = value
		}
	}
	return output
}

func redactStringIfSensitive(key string, value string, sensitiveFields []string) string {
	if value == "" || !isSensitiveKey(key, sensitiveFields) {
		return value
	}
	return "[REDACTED]"
}

func isSensitiveKey(key string, sensitiveFields []string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
	for _, field := range sensitiveFields {
		field = strings.ToLower(strings.ReplaceAll(field, "-", "_"))
		if field != "" && strings.Contains(normalized, field) {
			return true
		}
	}
	return false
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if strings.EqualFold(item, target) {
			return true
		}
	}
	return false
}

func normalizeLogToken(value string, fallback string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return fallback
	}
	value = strings.ReplaceAll(value, " ", "_")
	value = strings.ReplaceAll(value, "-", "_")
	return value
}

func valueMapHasNoSampleRate(value interface{}) bool {
	m, ok := value.(map[string]interface{})
	if !ok {
		return true
	}
	_, exists := m["successSampleRate"]
	return !exists
}

func NewBusinessTraceID(prefix string) string {
	if prefix == "" {
		prefix = "biz"
	}
	return prefix + "_" + strconv.FormatInt(time.Now().UnixNano(), 36)
}
