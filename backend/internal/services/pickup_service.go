package services

import (
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
	"time"
)

// PickupPollRequest 取件轮询请求
type PickupPollRequest struct {
	AccountID        uint   `json:"account_id"`
	KeepAliveSeconds int    `json:"keep_alive_seconds"` // 临时同步覆盖有效期(秒)，建议 30-120
	SyncInterval     int    `json:"sync_interval"`      // 后端拉取邮件间隔(秒)，默认 5
	Since            string `json:"since"`              // ISO8601 搜索起始时间
	ToQuery          string `json:"to_query,omitempty"` // 收件人过滤
	Limit            int    `json:"limit,omitempty"`    // 返回数量限制，默认 10

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
	Field   string `json:"field"`   // body, subject, from, html_body
	Type    string `json:"type"`    // regex, js, gotemplate
	Pattern string `json:"pattern"` // 正则表达式或脚本
}

// PickupPollResponse 取件轮询响应
type PickupPollResponse struct {
	Success       bool                   `json:"success"`
	Emails        []models.Email         `json:"emails"`
	NewCount      int                    `json:"new_count"`
	Extractions   []ExtractionResultItem `json:"extractions,omitempty"`
	SyncActive    bool                   `json:"sync_active"`
	SyncExpiresAt string                 `json:"sync_expires_at"`
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
	extractorSvc   *ExtractorService   // V1
	extractorSvcV2 *ExtractorServiceV2 // V2
	syncManager    *PerAccountSyncManager
	logger         *utils.Logger
}

// NewPickupService 创建取件轮询服务
func NewPickupService(
	emailRepo *repository.EmailRepository,
	extractorSvc *ExtractorService,
	extractorSvcV2 *ExtractorServiceV2,
	syncManager *PerAccountSyncManager,
) *PickupService {
	return &PickupService{
		emailRepo:      emailRepo,
		extractorSvc:   extractorSvc,
		extractorSvcV2: extractorSvcV2,
		syncManager:    syncManager,
		logger:         utils.NewLogger("PickupService"),
	}
}

// Poll 执行一次取件轮询
func (s *PickupService) Poll(req PickupPollRequest) (*PickupPollResponse, error) {
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

	// 2. 注册/续期取件轮询覆盖（纯内存，零DB写入）
	s.syncManager.RegisterPickupOverride(req.AccountID, req.SyncInterval, req.KeepAliveSeconds)

	// pickup 需要尽量返回刚到达的邮件；注册临时覆盖后立即同步一次，再查数据库。
	syncResult, syncErr := s.syncManager.SyncNow(req.AccountID, SyncNowOptions{
		CreateStrategy: "ensure",
		SyncInterval:   req.SyncInterval,
	})
	if syncErr != nil {
		s.logger.Warn("Pickup immediate sync failed for account %d: %v", req.AccountID, syncErr)
	} else if syncResult != nil && syncResult.Error != nil {
		s.logger.Warn("Pickup immediate sync completed with error for account %d: %v", req.AccountID, syncResult.Error)
	} else if syncResult != nil {
		s.logger.Debug("Pickup immediate sync completed for account %d: synced %d emails", req.AccountID, syncResult.EmailsSynced)
	}

	// 3. 解析搜索起始时间
	var startDate *time.Time
	if req.Since != "" {
		parsed, err := time.Parse(time.RFC3339, req.Since)
		if err != nil {
			return nil, fmt.Errorf("invalid since time format (expected RFC3339): %w", err)
		}
		startDate = &parsed
	}

	// 4. 搜索邮件
	searchOpts := repository.EmailSearchOptions{
		AccountID: req.AccountID,
		Limit:     req.Limit,
		StartDate: startDate,
		ToQuery:   req.ToQuery,
		SortBy:    "date DESC",
	}

	emails, _, err := s.emailRepo.SearchEmails(searchOpts)
	if err != nil {
		return nil, fmt.Errorf("failed to search emails: %w", err)
	}

	s.logger.Debug("Pickup poll for account %d: found %d emails", req.AccountID, len(emails))

	// 5. 获取覆盖状态
	override := s.syncManager.GetPickupOverride(req.AccountID)
	syncActive := override != nil
	syncExpiresAt := ""
	if override != nil {
		syncExpiresAt = override.ExpiresAt.Format(time.RFC3339)
	}

	// 6. 执行提取（如果配置了）
	var extractions []ExtractionResultItem
	if len(emails) > 0 {
		if req.TemplateID != nil {
			extractions = s.extractWithTemplate(emails, *req.TemplateID)
		} else if req.InlineActions != nil {
			extractions = s.extractWithInlineActions(emails, req.InlineActions)
		} else if req.SimpleExtract != nil {
			extractions = s.extractWithSimple(emails, req.SimpleExtract)
		}
	}

	return &PickupPollResponse{
		Success:       true,
		Emails:        emails,
		NewCount:      len(emails),
		Extractions:   extractions,
		SyncActive:    syncActive,
		SyncExpiresAt: syncExpiresAt,
	}, nil
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
		extractorConfig.Match = &config.Pattern
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
			item.Success = true
			item.Status = "success"
			if len(result.Matches) == 1 {
				item.ExtractedValue = result.Matches[0]
			} else {
				item.ExtractedValue = result.Matches
			}
		} else {
			item.Success = false
			item.Status = "no_match"
		}

		results = append(results, item)
	}

	return results
}
