package repository

import (
	"errors"
	"mailman/internal/models"
	"time"

	"gorm.io/gorm"
)

// TriggerRepository handles database operations for EmailTrigger
type TriggerRepository struct {
	db *gorm.DB
}

// NewTriggerRepository creates a new TriggerRepository
func NewTriggerRepository(db *gorm.DB) *TriggerRepository {
	return &TriggerRepository{db: db}
}

// Create creates a new trigger
func (r *TriggerRepository) Create(trigger *models.EmailTrigger) error {
	return r.db.Create(trigger).Error
}

// GetByID retrieves a trigger by ID
func (r *TriggerRepository) GetByID(id uint) (*models.EmailTrigger, error) {
	var trigger models.EmailTrigger
	err := r.db.First(&trigger, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("trigger not found")
		}
		return nil, err
	}
	return &trigger, nil
}

// GetAll retrieves all triggers
func (r *TriggerRepository) GetAll(orgID uint) ([]models.EmailTrigger, error) {
	var triggers []models.EmailTrigger
	query := r.db.Model(&models.EmailTrigger{})
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	err := query.Find(&triggers).Error
	return triggers, err
}

// GetAllPaginated retrieves triggers with pagination and search
func (r *TriggerRepository) GetAllPaginated(page, limit int, sortBy, sortOrder, search string, orgID uint) ([]models.EmailTrigger, int64, error) {
	var triggers []models.EmailTrigger
	var total int64

	// Build query
	query := r.db.Model(&models.EmailTrigger{})

	// Apply org filter
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}

	// Apply search filter
	if search != "" {
		searchPattern := "%" + search + "%"
		query = query.Where("name LIKE ? OR description LIKE ?", searchPattern, searchPattern)
	}

	// Get total count
	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	// Apply sorting
	orderClause := sortBy + " " + sortOrder
	query = query.Order(orderClause)

	// Apply pagination
	offset := (page - 1) * limit
	err = query.Offset(offset).Limit(limit).Find(&triggers).Error
	if err != nil {
		return nil, 0, err
	}

	return triggers, total, nil
}

// GetByStatus retrieves triggers by status
func (r *TriggerRepository) GetByStatus(status models.TriggerStatus, orgID uint) ([]models.EmailTrigger, error) {
	var triggers []models.EmailTrigger
	query := r.db.Where("status = ?", status)
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	err := query.Find(&triggers).Error
	return triggers, err
}

// Update updates a trigger
func (r *TriggerRepository) Update(trigger *models.EmailTrigger) error {
	return r.db.Save(trigger).Error
}

// UpdateStatus updates trigger status
func (r *TriggerRepository) UpdateStatus(id uint, status models.TriggerStatus) error {
	return r.db.Model(&models.EmailTrigger{}).Where("id = ?", id).Update("status", status).Error
}

// UpdateStatistics updates trigger execution statistics
func (r *TriggerRepository) UpdateStatistics(id uint, totalExecutions, successExecutions int64, lastExecutedAt *time.Time, lastError string) error {
	updates := map[string]interface{}{
		"total_executions":   totalExecutions,
		"success_executions": successExecutions,
		"last_executed_at":   lastExecutedAt,
		"last_error":         lastError,
	}
	return r.db.Model(&models.EmailTrigger{}).Where("id = ?", id).Updates(updates).Error
}

// Delete soft deletes a trigger
func (r *TriggerRepository) Delete(id uint) error {
	return r.db.Delete(&models.EmailTrigger{}, id).Error
}

// GetCount returns the total count of triggers
func (r *TriggerRepository) GetCount(orgID uint) (int64, error) {
	var count int64
	query := r.db.Model(&models.EmailTrigger{})
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	err := query.Count(&count).Error
	return count, err
}

// GetCountByStatus returns the count of triggers by status
func (r *TriggerRepository) GetCountByStatus(status models.TriggerStatus, orgID uint) (int64, error) {
	var count int64
	query := r.db.Model(&models.EmailTrigger{}).Where("status = ?", status)
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	err := query.Count(&count).Error
	return count, err
}

// TriggerExecutionLogRepository handles database operations for TriggerExecutionLog
type TriggerExecutionLogRepository struct {
	db *gorm.DB
}

// NewTriggerExecutionLogRepository creates a new TriggerExecutionLogRepository
func NewTriggerExecutionLogRepository(db *gorm.DB) *TriggerExecutionLogRepository {
	return &TriggerExecutionLogRepository{db: db}
}

// Create creates a new execution log
func (r *TriggerExecutionLogRepository) Create(log *models.TriggerExecutionLog) error {
	return r.db.Create(log).Error
}

// GetByID retrieves an execution log by ID
func (r *TriggerExecutionLogRepository) GetByID(id uint) (*models.TriggerExecutionLog, error) {
	var log models.TriggerExecutionLog
	err := r.db.Preload("Trigger").First(&log, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("execution log not found")
		}
		return nil, err
	}
	return &log, nil
}

// GetByTriggerID retrieves execution logs by trigger ID with pagination
func (r *TriggerExecutionLogRepository) GetByTriggerID(triggerID uint, page, limit int) ([]models.TriggerExecutionLog, int64, error) {
	var logs []models.TriggerExecutionLog
	var total int64

	// Build query
	query := r.db.Model(&models.TriggerExecutionLog{}).Where("trigger_id = ?", triggerID)

	// Get total count
	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	// Apply pagination and ordering
	offset := (page - 1) * limit
	err = query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}

// GetAllPaginated retrieves execution logs with pagination and filtering
func (r *TriggerExecutionLogRepository) GetAllPaginated(page, limit int, triggerID *uint, status *models.TriggerExecutionStatus, startDate, endDate *time.Time, orgID uint) ([]models.TriggerExecutionLog, int64, error) {
	var logs []models.TriggerExecutionLog
	var total int64

	// Build query
	query := r.db.Model(&models.TriggerExecutionLog{})

	// Apply org filter
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}

	// Apply filters
	if triggerID != nil {
		query = query.Where("trigger_id = ?", *triggerID)
	}
	if status != nil {
		query = query.Where("status = ?", *status)
	}
	if startDate != nil {
		query = query.Where("created_at >= ?", *startDate)
	}
	if endDate != nil {
		query = query.Where("created_at <= ?", *endDate)
	}

	// Get total count
	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	// Apply pagination and ordering
	offset := (page - 1) * limit
	err = query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}

// GetLatestByTriggerID retrieves the latest execution log for a trigger
func (r *TriggerExecutionLogRepository) GetLatestByTriggerID(triggerID uint) (*models.TriggerExecutionLog, error) {
	var log models.TriggerExecutionLog
	err := r.db.Where("trigger_id = ?", triggerID).Order("created_at DESC").First(&log).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil // No logs found, not an error
		}
		return nil, err
	}
	return &log, nil
}

// DeleteOldLogs deletes execution logs older than the specified date
func (r *TriggerExecutionLogRepository) DeleteOldLogs(beforeDate time.Time) (int64, error) {
	result := r.db.Where("created_at < ?", beforeDate).Delete(&models.TriggerExecutionLog{})
	return result.RowsAffected, result.Error
}

// GetStatistics retrieves execution statistics for a trigger
func (r *TriggerExecutionLogRepository) GetStatistics(triggerID uint, startDate, endDate *time.Time) (map[string]interface{}, error) {
	query := r.db.Model(&models.TriggerExecutionLog{}).Where("trigger_id = ?", triggerID)

	if startDate != nil {
		query = query.Where("created_at >= ?", *startDate)
	}
	if endDate != nil {
		query = query.Where("created_at <= ?", *endDate)
	}

	// Get total count
	var totalCount int64
	err := query.Count(&totalCount).Error
	if err != nil {
		return nil, err
	}

	// Get success count
	var successCount int64
	err = query.Where("status = ?", models.TriggerExecutionStatusSuccess).Count(&successCount).Error
	if err != nil {
		return nil, err
	}

	// Get failed count
	var failedCount int64
	err = query.Where("status = ?", models.TriggerExecutionStatusFailed).Count(&failedCount).Error
	if err != nil {
		return nil, err
	}

	// Get partial count
	var partialCount int64
	err = query.Where("status = ?", models.TriggerExecutionStatusPartial).Count(&partialCount).Error
	if err != nil {
		return nil, err
	}

	// Calculate average execution time
	var avgExecutionTime float64
	err = query.Select("AVG(execution_ms)").Scan(&avgExecutionTime).Error
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"total_executions":   totalCount,
		"success_executions": successCount,
		"failed_executions":  failedCount,
		"partial_executions": partialCount,
		"avg_execution_time": avgExecutionTime,
		"success_rate":       float64(successCount) / float64(totalCount) * 100,
	}, nil
}
