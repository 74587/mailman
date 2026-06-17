package repository

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"mailman/internal/models"

	"gorm.io/gorm"
)

type BusinessLogRepository struct {
	db *gorm.DB
}

type BusinessLogQuery struct {
	OrgID         uint
	UserID        *uint
	Query         string
	Module        string
	Action        string
	Status        string
	OperationType string
	ActorType     string
	EntityType    string
	EntityID      string
	TraceID       string
	RunID         string
	From          *time.Time
	To            *time.Time
	BeforeID      uint
	AfterID       uint
	Limit         int
	Offset        int
}

type BusinessLogListResult struct {
	Items      []models.BusinessLog `json:"items"`
	Total      int64                `json:"total"`
	Limit      int                  `json:"limit"`
	Offset     int                  `json:"offset"`
	BeforeID   uint                 `json:"beforeId,omitempty"`
	AfterID    uint                 `json:"afterId,omitempty"`
	NextCursor *uint                `json:"nextCursor,omitempty"`
	HasMore    bool                 `json:"hasMore"`
}

type BusinessLogStats struct {
	ByStatus []BusinessLogCount `json:"byStatus"`
	ByModule []BusinessLogCount `json:"byModule"`
	Total    int64              `json:"total"`
}

type BusinessLogCount struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

func NewBusinessLogRepository(db *gorm.DB) *BusinessLogRepository {
	return &BusinessLogRepository{db: db}
}

func (r *BusinessLogRepository) Create(log *models.BusinessLog) error {
	return r.db.Create(log).Error
}

func (r *BusinessLogRepository) MergeIntoRecent(next *models.BusinessLog, window time.Duration) (uint, bool, error) {
	if next == nil || window <= 0 {
		return 0, false, nil
	}

	var mergedID uint
	merged := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var candidate models.BusinessLog
		cutoff := next.StartedAt.Add(-window)
		query := tx.Where(
			"org_id = ? AND operation_type = ? AND actor_type = ? AND actor_id = ? AND module = ? AND action = ? AND entity_type = ? AND entity_id = ?",
			next.OrgID,
			next.OperationType,
			next.ActorType,
			next.ActorID,
			next.Module,
			next.Action,
			next.EntityType,
			next.EntityID,
		).
			Where("(finished_at >= ? OR (finished_at IS NULL AND started_at >= ?))", cutoff, cutoff).
			Order("id DESC")
		if next.UserID == nil {
			query = query.Where("user_id IS NULL")
		} else {
			query = query.Where("user_id = ?", *next.UserID)
		}

		if err := query.First(&candidate).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil
			}
			return err
		}
		if candidate.Status != next.Status {
			return nil
		}

		mergeBusinessLogCandidate(&candidate, next)
		if err := tx.Save(&candidate).Error; err != nil {
			return err
		}
		mergedID = candidate.ID
		merged = true
		return nil
	})
	return mergedID, merged, err
}

func (r *BusinessLogRepository) GetByID(orgID uint, id uint) (*models.BusinessLog, error) {
	var item models.BusinessLog
	query := r.db.Preload("User").Where("id = ?", id)
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	if err := query.First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *BusinessLogRepository) List(query BusinessLogQuery) (BusinessLogListResult, error) {
	limit := normalizeBusinessLogLimit(query.Limit)
	offset := query.Offset
	if offset < 0 {
		offset = 0
	}

	var total int64
	if err := r.applyFilters(r.db.Model(&models.BusinessLog{}), query).Count(&total).Error; err != nil {
		return BusinessLogListResult{}, err
	}

	var items []models.BusinessLog
	listQuery := r.applyFilters(r.db.Model(&models.BusinessLog{}), query)
	if query.BeforeID > 0 {
		listQuery = listQuery.Where("id < ?", query.BeforeID)
	}
	if query.AfterID > 0 {
		listQuery = listQuery.Where("id > ?", query.AfterID)
	}
	if query.BeforeID == 0 && query.AfterID == 0 && offset > 0 {
		listQuery = listQuery.Offset(offset)
	}

	fetchLimit := limit + 1
	if err := listQuery.
		Preload("User").
		Order("id DESC").
		Limit(fetchLimit).
		Find(&items).Error; err != nil {
		return BusinessLogListResult{}, err
	}

	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	var nextCursor *uint
	if hasMore && len(items) > 0 {
		cursor := items[len(items)-1].ID
		nextCursor = &cursor
	}

	return BusinessLogListResult{
		Items:      items,
		Total:      total,
		Limit:      limit,
		Offset:     offset,
		BeforeID:   query.BeforeID,
		AfterID:    query.AfterID,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

func (r *BusinessLogRepository) Stats(query BusinessLogQuery) (BusinessLogStats, error) {
	dbQuery := r.applyFilters(r.db.Model(&models.BusinessLog{}), query)

	var total int64
	if err := dbQuery.Count(&total).Error; err != nil {
		return BusinessLogStats{}, err
	}

	var byStatus []BusinessLogCount
	if err := r.applyFilters(r.db.Model(&models.BusinessLog{}), query).
		Select("status AS key, COUNT(*) AS count").
		Group("status").
		Order("count DESC").
		Scan(&byStatus).Error; err != nil {
		return BusinessLogStats{}, err
	}

	var byModule []BusinessLogCount
	if err := r.applyFilters(r.db.Model(&models.BusinessLog{}), query).
		Select("module AS key, COUNT(*) AS count").
		Group("module").
		Order("count DESC").
		Limit(12).
		Scan(&byModule).Error; err != nil {
		return BusinessLogStats{}, err
	}

	return BusinessLogStats{
		ByStatus: byStatus,
		ByModule: byModule,
		Total:    total,
	}, nil
}

func (r *BusinessLogRepository) DeleteOld(orgID uint, before time.Time) error {
	query := r.db.Where("created_at < ?", before)
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	return query.Delete(&models.BusinessLog{}).Error
}

func (r *BusinessLogRepository) EnforceLimit(orgID uint, module string, limit int) error {
	if limit <= 0 {
		return nil
	}
	query := r.db.Model(&models.BusinessLog{})
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	if module != "" {
		query = query.Where("module = ?", module)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return err
	}
	excess := int(total) - limit
	if excess <= 0 {
		return nil
	}

	var ids []uint
	if err := query.
		Select("id").
		Order("started_at ASC, id ASC").
		Limit(excess).
		Pluck("id", &ids).Error; err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	return r.db.Delete(&models.BusinessLog{}, ids).Error
}

func (r *BusinessLogRepository) applyFilters(db *gorm.DB, query BusinessLogQuery) *gorm.DB {
	if query.OrgID > 0 {
		db = db.Where("org_id = ?", query.OrgID)
	}
	if query.UserID != nil {
		db = db.Where("user_id = ?", *query.UserID)
	}
	if query.Module != "" {
		db = db.Where("module = ?", query.Module)
	}
	if query.Action != "" {
		db = db.Where("action = ?", query.Action)
	}
	if query.Status != "" {
		db = db.Where("status = ?", query.Status)
	}
	if query.OperationType != "" {
		db = db.Where("operation_type = ?", query.OperationType)
	}
	if query.ActorType != "" {
		db = db.Where("actor_type = ?", query.ActorType)
	}
	if query.EntityType != "" {
		db = db.Where("entity_type = ?", query.EntityType)
	}
	if query.EntityID != "" {
		db = db.Where("entity_id = ?", query.EntityID)
	}
	if query.TraceID != "" {
		db = db.Where("trace_id = ?", query.TraceID)
	}
	if query.RunID != "" {
		db = db.Where("run_id = ?", query.RunID)
	}
	if query.From != nil {
		db = db.Where("started_at >= ?", *query.From)
	}
	if query.To != nil {
		db = db.Where("started_at <= ?", *query.To)
	}
	if strings.TrimSpace(query.Query) != "" {
		like := "%" + strings.TrimSpace(query.Query) + "%"
		db = db.Where(
			"title LIKE ? OR summary LIKE ? OR entity_name LIKE ? OR error_message LIKE ? OR trace_id LIKE ? OR run_id LIKE ?",
			like, like, like, like, like, like,
		)
	}
	return db
}

func normalizeBusinessLogLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 500 {
		return 500
	}
	return limit
}

var mergeBusinessLogNumericDetailKeys = []string{
	"emails_fetched",
	"new_emails",
	"emails_created",
	"emails_updated",
	"emails_skipped",
	"matched_count",
	"extracted_count",
	"action_count",
	"success_count",
	"failed_count",
}

const maxBusinessLogMergeEntries = 200

func mergeBusinessLogCandidate(candidate *models.BusinessLog, next *models.BusinessLog) {
	details := copyBusinessLogDetails(candidate.Details)
	nextDetails := copyBusinessLogDetails(next.Details)

	entries, truncated := mergeBusinessLogEntries(candidate, details, next, nextDetails)
	if len(entries) > 0 {
		details["merge_entries"] = entries
	}
	if truncated {
		details["merge_entries_truncated"] = true
	}

	if _, ok := details["merge_base_title"].(string); !ok || details["merge_base_title"] == "" {
		details["merge_base_title"] = candidate.Title
	}
	if _, ok := details["merge_started_at"].(string); !ok || details["merge_started_at"] == "" {
		details["merge_started_at"] = candidate.StartedAt.Format(time.RFC3339)
	}
	if candidate.RunID != "" && details["first_run_id"] == nil {
		details["first_run_id"] = candidate.RunID
	}
	if candidate.TraceID != "" && details["first_trace_id"] == nil {
		details["first_trace_id"] = candidate.TraceID
	}

	mergeCount := businessLogDetailInt(details, "merge_count")
	if mergeCount <= 0 {
		mergeCount = 1
	}
	mergeCount++
	details["merge_count"] = mergeCount
	details["merge_status"] = next.Status
	if next.FinishedAt != nil {
		details["merge_finished_at"] = next.FinishedAt.Format(time.RFC3339)
	} else {
		details["merge_finished_at"] = next.StartedAt.Format(time.RFC3339)
	}
	if next.RunID != "" {
		details["latest_run_id"] = next.RunID
	}
	if next.TraceID != "" {
		details["latest_trace_id"] = next.TraceID
	}
	if next.RequestID != "" {
		details["latest_request_id"] = next.RequestID
	}
	if next.ErrorMessage != "" {
		if details["first_error_message"] == nil && candidate.ErrorMessage != "" {
			details["first_error_message"] = candidate.ErrorMessage
		}
		details["latest_error_message"] = next.ErrorMessage
	}

	for _, key := range mergeBusinessLogNumericDetailKeys {
		currentValue, hasCurrent := businessLogDetailIntWithPresence(details, key)
		nextValue, hasNext := businessLogDetailIntWithPresence(nextDetails, key)
		if hasCurrent || hasNext {
			details[key] = currentValue + nextValue
		}
	}

	for key, value := range nextDetails {
		if strings.HasPrefix(key, "latest_") || strings.HasPrefix(key, "last_") {
			details[key] = value
		}
	}

	candidate.FinishedAt = next.FinishedAt
	if candidate.FinishedAt != nil {
		candidate.DurationMS = candidate.FinishedAt.Sub(candidate.StartedAt).Milliseconds()
		if candidate.DurationMS < 0 {
			candidate.DurationMS = 0
		}
	}
	candidate.Result = next.Result
	candidate.ErrorCode = next.ErrorCode
	candidate.ErrorMessage = next.ErrorMessage
	candidate.TraceID = next.TraceID
	candidate.RunID = next.RunID
	candidate.RequestID = next.RequestID
	candidate.Details = details

	baseTitle, _ := details["merge_base_title"].(string)
	if baseTitle == "" {
		baseTitle = next.Title
	}
	candidate.Title = fmt.Sprintf("%s（已合并 %d 条）", baseTitle, mergeCount)
	candidate.Summary = buildMergedBusinessLogSummary(candidate)
}

func mergeBusinessLogEntries(candidate *models.BusinessLog, details models.JSONMapInterface, next *models.BusinessLog, nextDetails models.JSONMapInterface) ([]interface{}, bool) {
	entries := normalizeBusinessLogMergeEntries(details["merge_entries"])
	if len(entries) == 0 {
		entries = append(entries, businessLogMergeEntry(candidate, details))
	}
	entries = append(entries, businessLogMergeEntry(next, nextDetails))
	if len(entries) <= maxBusinessLogMergeEntries {
		return entries, false
	}
	return entries[len(entries)-maxBusinessLogMergeEntries:], true
}

func normalizeBusinessLogMergeEntries(value interface{}) []interface{} {
	if value == nil {
		return nil
	}
	switch typed := value.(type) {
	case []interface{}:
		result := make([]interface{}, 0, len(typed))
		for _, item := range typed {
			if item != nil {
				result = append(result, item)
			}
		}
		return result
	case []map[string]interface{}:
		result := make([]interface{}, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	default:
		return nil
	}
}

func businessLogMergeEntry(log *models.BusinessLog, details models.JSONMapInterface) map[string]interface{} {
	entry := map[string]interface{}{
		"id":          log.ID,
		"title":       log.Title,
		"summary":     log.Summary,
		"status":      log.Status,
		"result":      log.Result,
		"started_at":  log.StartedAt.Format(time.RFC3339),
		"duration_ms": log.DurationMS,
	}
	if log.FinishedAt != nil {
		entry["finished_at"] = log.FinishedAt.Format(time.RFC3339)
	}
	if log.RunID != "" {
		entry["run_id"] = log.RunID
	}
	if log.TraceID != "" {
		entry["trace_id"] = log.TraceID
	}
	if log.RequestID != "" {
		entry["request_id"] = log.RequestID
	}
	if log.ErrorMessage != "" {
		entry["error_message"] = log.ErrorMessage
	}
	for _, key := range []string{
		"account_id",
		"account_email",
		"source",
		"emails_fetched",
		"new_emails",
		"emails_created",
		"emails_updated",
		"emails_skipped",
		"sync_run_id",
		"mailbox",
		"folder",
	} {
		if value, ok := details[key]; ok && isPresentBusinessLogDetail(value) {
			entry[key] = value
		}
	}
	return entry
}

func isPresentBusinessLogDetail(value interface{}) bool {
	if value == nil {
		return false
	}
	if str, ok := value.(string); ok {
		return strings.TrimSpace(str) != ""
	}
	return true
}

func buildMergedBusinessLogSummary(log *models.BusinessLog) string {
	details := log.Details
	mergeCount := businessLogDetailInt(details, "merge_count")
	if mergeCount <= 0 {
		mergeCount = 1
	}
	target := log.EntityName
	if target == "" {
		target = businessLogDetailString(details, "account_email")
	}
	if target == "" {
		target = log.EntityID
	}
	if target == "" {
		target = log.Module
	}

	startText := businessLogDetailString(details, "merge_started_at")
	endText := businessLogDetailString(details, "merge_finished_at")
	startText = formatBusinessLogMergeTime(startText)
	endText = formatBusinessLogMergeTime(endText)

	statusText := "执行"
	switch log.Status {
	case string(models.BusinessLogStatusSuccess):
		statusText = "成功"
	case string(models.BusinessLogStatusFailed):
		statusText = "失败"
	case string(models.BusinessLogStatusSkipped):
		statusText = "跳过"
	case string(models.BusinessLogStatusPartial):
		statusText = "部分成功"
	}

	summary := fmt.Sprintf("%s 在 %s - %s 内连续%s %d 次", target, startText, endText, statusText, mergeCount)
	if fetched, ok := businessLogDetailIntWithPresence(details, "emails_fetched"); ok {
		summary = fmt.Sprintf("%s，累计拉取 %d 封", summary, fetched)
	}
	if newEmails, ok := businessLogDetailIntWithPresence(details, "new_emails"); ok {
		summary = fmt.Sprintf("%s，新增 %d 封", summary, newEmails)
	}
	if log.Status == string(models.BusinessLogStatusFailed) && log.ErrorMessage != "" {
		summary = fmt.Sprintf("%s，最新错误：%s", summary, log.ErrorMessage)
	}
	return summary
}

func copyBusinessLogDetails(input models.JSONMapInterface) models.JSONMapInterface {
	output := models.JSONMapInterface{}
	for key, value := range input {
		output[key] = value
	}
	return output
}

func businessLogDetailString(details models.JSONMapInterface, key string) string {
	value, ok := details[key]
	if !ok || value == nil {
		return ""
	}
	if str, ok := value.(string); ok {
		return str
	}
	return fmt.Sprintf("%v", value)
}

func businessLogDetailInt(details models.JSONMapInterface, key string) int64 {
	value, _ := businessLogDetailIntWithPresence(details, key)
	return value
}

func businessLogDetailIntWithPresence(details models.JSONMapInterface, key string) (int64, bool) {
	value, ok := details[key]
	if !ok || value == nil {
		return 0, false
	}
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int8:
		return int64(typed), true
	case int16:
		return int64(typed), true
	case int32:
		return int64(typed), true
	case int64:
		return typed, true
	case uint:
		return int64(typed), true
	case uint8:
		return int64(typed), true
	case uint16:
		return int64(typed), true
	case uint32:
		return int64(typed), true
	case uint64:
		return int64(typed), true
	case float32:
		return int64(typed), true
	case float64:
		return int64(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func formatBusinessLogMergeTime(value string) string {
	if value == "" {
		return "-"
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return value
	}
	return parsed.Format("2006-01-02 15:04:05")
}
