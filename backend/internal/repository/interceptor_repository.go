package repository

import (
	"fmt"
	"time"

	"mailman/internal/models"

	"gorm.io/gorm"
)

// InterceptorRepository 拦截器数据访问层
type InterceptorRepository struct {
	db *gorm.DB
}

// NewInterceptorRepository 创建拦截器仓库
func NewInterceptorRepository(db *gorm.DB) *InterceptorRepository {
	return &InterceptorRepository{db: db}
}

// Create 创建拦截器
func (r *InterceptorRepository) Create(interceptor *models.Interceptor) error {
	return r.db.Create(interceptor).Error
}

// GetByID 根据ID获取拦截器
func (r *InterceptorRepository) GetByID(id uint) (*models.Interceptor, error) {
	var interceptor models.Interceptor
	err := r.db.First(&interceptor, id).Error
	if err != nil {
		return nil, err
	}
	return &interceptor, nil
}

// Update 更新拦截器
func (r *InterceptorRepository) Update(interceptor *models.Interceptor) error {
	return r.db.Save(interceptor).Error
}

// Delete 删除拦截器（软删除）
func (r *InterceptorRepository) Delete(id uint) error {
	return r.db.Delete(&models.Interceptor{}, id).Error
}

// HardDelete 硬删除拦截器
func (r *InterceptorRepository) HardDelete(id uint) error {
	return r.db.Unscoped().Delete(&models.Interceptor{}, id).Error
}

// List 获取所有拦截器
func (r *InterceptorRepository) List(orgID uint) ([]models.Interceptor, error) {
	var interceptors []models.Interceptor
	query := r.db.Order("\"order\" ASC")
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	err := query.Find(&interceptors).Error
	return interceptors, err
}

// ListByScope 按作用域获取拦截器
func (r *InterceptorRepository) ListByScope(scope models.InterceptorScope) ([]models.Interceptor, error) {
	var interceptors []models.Interceptor
	err := r.db.Where("scope = ?", scope).Order("\"order\" ASC").Find(&interceptors).Error
	return interceptors, err
}

// ListGlobal 获取全局拦截器
func (r *InterceptorRepository) ListGlobal() ([]models.Interceptor, error) {
	return r.ListByScope(models.InterceptorScopeGlobal)
}

// ListByTriggerID 获取指定触发器的局部拦截器
func (r *InterceptorRepository) ListByTriggerID(triggerID uint) ([]models.Interceptor, error) {
	var interceptors []models.Interceptor
	err := r.db.Where("scope = ? AND trigger_id = ?", models.InterceptorScopeLocal, triggerID).
		Order("\"order\" ASC").Find(&interceptors).Error
	return interceptors, err
}

// ListByExtractorID 获取指定提取器的局部拦截器
func (r *InterceptorRepository) ListByExtractorID(extractorID uint) ([]models.Interceptor, error) {
	var interceptors []models.Interceptor
	err := r.db.Where("scope = ? AND extractor_id = ?", models.InterceptorScopeLocal, extractorID).
		Order("\"order\" ASC").Find(&interceptors).Error
	return interceptors, err
}

// ListEnabled 获取所有启用的拦截器
func (r *InterceptorRepository) ListEnabled() ([]models.Interceptor, error) {
	var interceptors []models.Interceptor
	err := r.db.Where("enabled = ?", true).Order("\"order\" ASC").Find(&interceptors).Error
	return interceptors, err
}

// ListEnabledGlobal 获取所有启用的全局拦截器
func (r *InterceptorRepository) ListEnabledGlobal() ([]models.Interceptor, error) {
	var interceptors []models.Interceptor
	err := r.db.Where("enabled = ? AND scope = ?", true, models.InterceptorScopeGlobal).
		Order("\"order\" ASC").Find(&interceptors).Error
	return interceptors, err
}

// UpdateEnabled 更新启用状态
func (r *InterceptorRepository) UpdateEnabled(id uint, enabled bool) error {
	return r.db.Model(&models.Interceptor{}).Where("id = ?", id).Update("enabled", enabled).Error
}

// UpdateOrder 更新执行顺序
func (r *InterceptorRepository) UpdateOrder(id uint, order int) error {
	return r.db.Model(&models.Interceptor{}).Where("id = ?", id).Update("order", order).Error
}

// BatchUpdateOrder 批量更新执行顺序
func (r *InterceptorRepository) BatchUpdateOrder(orders map[uint]int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for id, order := range orders {
			if err := tx.Model(&models.Interceptor{}).Where("id = ?", id).Update("order", order).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ExistsByName 检查名称是否存在
func (r *InterceptorRepository) ExistsByName(name string) (bool, error) {
	var count int64
	err := r.db.Model(&models.Interceptor{}).Where("name = ?", name).Count(&count).Error
	return count > 0, err
}

// ExistsByNameExcludeID 检查名称是否存在（排除指定ID）
func (r *InterceptorRepository) ExistsByNameExcludeID(name string, excludeID uint) (bool, error) {
	var count int64
	err := r.db.Model(&models.Interceptor{}).Where("name = ? AND id != ?", name, excludeID).Count(&count).Error
	return count > 0, err
}

// Count 获取拦截器总数
func (r *InterceptorRepository) Count() (int64, error) {
	var count int64
	err := r.db.Model(&models.Interceptor{}).Count(&count).Error
	return count, err
}

// CountByScope 按作用域统计数量
func (r *InterceptorRepository) CountByScope(scope models.InterceptorScope) (int64, error) {
	var count int64
	err := r.db.Model(&models.Interceptor{}).Where("scope = ?", scope).Count(&count).Error
	return count, err
}

// CreateLog 创建拦截器执行日志
func (r *InterceptorRepository) CreateLog(log *models.InterceptorLog) error {
	return r.db.Create(log).Error
}

// ListLogsByInterceptorID 获取拦截器的执行日志
func (r *InterceptorRepository) ListLogsByInterceptorID(interceptorID uint, limit int) ([]models.InterceptorLog, error) {
	var logs []models.InterceptorLog
	err := r.db.Where("interceptor_id = ?", interceptorID).
		Order("created_at DESC").
		Limit(limit).
		Find(&logs).Error
	return logs, err
}

// ListLogsByTriggerID 获取触发器相关的执行日志
func (r *InterceptorRepository) ListLogsByTriggerID(triggerID uint, limit int) ([]models.InterceptorLog, error) {
	var logs []models.InterceptorLog
	err := r.db.Where("trigger_id = ?", triggerID).
		Order("created_at DESC").
		Limit(limit).
		Find(&logs).Error
	return logs, err
}

// DeleteOldLogs 删除过期日志
func (r *InterceptorRepository) DeleteOldLogs(beforeDays int) (int64, error) {
	cutoffTime := time.Now().AddDate(0, 0, -beforeDays)
	result := r.db.Unscoped().Where("created_at < ?", cutoffTime).
		Delete(&models.InterceptorLog{})
	return result.RowsAffected, result.Error
}

// InterceptorLogFilter 日志过滤条件
type InterceptorLogFilter struct {
	InterceptorID *uint      // 按拦截器ID过滤
	TriggerID     *uint      // 按触发器ID过滤
	Success       *bool      // 按成功状态过滤
	Phase         string     // 按阶段过滤 (before/after/around)
	StartDate     *time.Time // 开始时间
	EndDate       *time.Time // 结束时间
}

// ListLogsWithPagination 分页查询日志
func (r *InterceptorRepository) ListLogsWithPagination(filter InterceptorLogFilter, page, pageSize int) ([]models.InterceptorLog, error) {
	var logs []models.InterceptorLog
	query := r.db.Model(&models.InterceptorLog{})

	// 应用过滤条件
	query = r.applyLogFilter(query, filter)

	// 分页
	offset := (page - 1) * pageSize
	err := query.Order("created_at DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&logs).Error

	return logs, err
}

// CountLogs 统计日志总数
func (r *InterceptorRepository) CountLogs(filter InterceptorLogFilter) (int64, error) {
	var count int64
	query := r.db.Model(&models.InterceptorLog{})

	// 应用过滤条件
	query = r.applyLogFilter(query, filter)

	err := query.Count(&count).Error
	return count, err
}

// GetLogByID 根据ID获取日志
func (r *InterceptorRepository) GetLogByID(id uint) (*models.InterceptorLog, error) {
	var log models.InterceptorLog
	err := r.db.First(&log, id).Error
	if err != nil {
		return nil, err
	}
	return &log, nil
}

// GetLogStats 获取日志统计信息
func (r *InterceptorRepository) GetLogStats(filter InterceptorLogFilter) (total int64, success int64, failed int64, avgDuration float64, err error) {
	query := r.db.Model(&models.InterceptorLog{})
	query = r.applyLogFilter(query, filter)

	// 总数
	if err = query.Count(&total).Error; err != nil {
		return
	}

	// 成功数
	successQuery := r.db.Model(&models.InterceptorLog{}).Where("success = ?", true)
	successQuery = r.applyLogFilter(successQuery, filter)
	if err = successQuery.Count(&success).Error; err != nil {
		return
	}

	// 失败数
	failed = total - success

	// 平均执行时间
	var result struct {
		AvgDuration float64
	}
	avgQuery := r.db.Model(&models.InterceptorLog{}).Select("AVG(duration) as avg_duration")
	avgQuery = r.applyLogFilter(avgQuery, filter)
	if err = avgQuery.Scan(&result).Error; err != nil {
		return
	}
	avgDuration = result.AvgDuration

	return
}

// applyLogFilter 应用日志过滤条件
func (r *InterceptorRepository) applyLogFilter(query *gorm.DB, filter InterceptorLogFilter) *gorm.DB {
	if filter.InterceptorID != nil {
		query = query.Where("interceptor_id = ?", *filter.InterceptorID)
	}
	if filter.TriggerID != nil {
		query = query.Where("trigger_id = ?", *filter.TriggerID)
	}
	if filter.Success != nil {
		query = query.Where("success = ?", *filter.Success)
	}
	if filter.Phase != "" {
		query = query.Where("phase = ?", filter.Phase)
	}
	if filter.StartDate != nil {
		query = query.Where("created_at >= ?", *filter.StartDate)
	}
	if filter.EndDate != nil {
		query = query.Where("created_at <= ?", *filter.EndDate)
	}
	return query
}

// Validate 验证拦截器配置
func (r *InterceptorRepository) Validate(interceptor *models.Interceptor) error {
	// 名称不能为空
	if interceptor.Name == "" {
		return fmt.Errorf("name is required")
	}

	// 插件ID不能为空
	if interceptor.PluginID == "" {
		return fmt.Errorf("plugin_id is required")
	}

	// 至少启用一个阶段
	if !interceptor.Phases.Before && !interceptor.Phases.After {
		return fmt.Errorf("at least one phase (before or after) must be enabled")
	}

	// 局部拦截器必须关联触发器或提取器
	if interceptor.Scope == models.InterceptorScopeLocal {
		if interceptor.TriggerID == nil && interceptor.ExtractorID == nil {
			return fmt.Errorf("local interceptor must be associated with a trigger or extractor")
		}
	}

	return nil
}

// AutoMigrate 自动迁移数据库表
func (r *InterceptorRepository) AutoMigrate() error {
	return r.db.AutoMigrate(&models.Interceptor{}, &models.InterceptorLog{})
}
