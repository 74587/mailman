package repository

import (
	"mailman/internal/models"
	"time"

	"gorm.io/gorm"
)

// ExtractorTemplateV2Repository 取件模板V2仓库
type ExtractorTemplateV2Repository struct {
	db *gorm.DB
}

// NewExtractorTemplateV2Repository 创建新的取件模板V2仓库
func NewExtractorTemplateV2Repository(db *gorm.DB) *ExtractorTemplateV2Repository {
	return &ExtractorTemplateV2Repository{db: db}
}

// Create 创建取件模板
func (r *ExtractorTemplateV2Repository) Create(template *models.ExtractorTemplateV2) error {
	return r.db.Create(template).Error
}

// GetByID 根据ID获取取件模板
func (r *ExtractorTemplateV2Repository) GetByID(id uint) (*models.ExtractorTemplateV2, error) {
	var template models.ExtractorTemplateV2
	if err := r.db.First(&template, id).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

// GetByName 根据名称获取取件模板
func (r *ExtractorTemplateV2Repository) GetByName(name string) (*models.ExtractorTemplateV2, error) {
	var template models.ExtractorTemplateV2
	if err := r.db.Where("name = ?", name).First(&template).Error; err != nil {
		return nil, err
	}
	return &template, nil
}

// GetAll 获取所有取件模板
func (r *ExtractorTemplateV2Repository) GetAll(orgID uint) ([]models.ExtractorTemplateV2, error) {
	var templates []models.ExtractorTemplateV2
	query := r.db.Order("created_at DESC")
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	if err := query.Find(&templates).Error; err != nil {
		return nil, err
	}
	return templates, nil
}

// GetEnabled 获取所有启用的取件模板
func (r *ExtractorTemplateV2Repository) GetEnabled(orgID uint) ([]models.ExtractorTemplateV2, error) {
	var templates []models.ExtractorTemplateV2
	query := r.db.Where("enabled = ?", true).Order("created_at DESC")
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	if err := query.Find(&templates).Error; err != nil {
		return nil, err
	}
	return templates, nil
}

// GetPaginated 分页获取取件模板
func (r *ExtractorTemplateV2Repository) GetPaginated(page, limit int, search string, category string, enabled *bool, orgID uint) ([]models.ExtractorTemplateV2, int64, error) {
	var templates []models.ExtractorTemplateV2
	var total int64

	query := r.db.Model(&models.ExtractorTemplateV2{})
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}

	// 搜索条件
	if search != "" {
		query = query.Where("name LIKE ? OR description LIKE ?", "%"+search+"%", "%"+search+"%")
	}

	// 分类过滤
	if category != "" {
		query = query.Where("category = ?", category)
	}

	// 启用状态过滤
	if enabled != nil {
		query = query.Where("enabled = ?", *enabled)
	}

	// 获取总数
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 分页
	offset := (page - 1) * limit
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&templates).Error; err != nil {
		return nil, 0, err
	}

	return templates, total, nil
}

// Update 更新取件模板
func (r *ExtractorTemplateV2Repository) Update(template *models.ExtractorTemplateV2) error {
	return r.db.Save(template).Error
}

// Delete 删除取件模板（软删除）
func (r *ExtractorTemplateV2Repository) Delete(id uint) error {
	return r.db.Delete(&models.ExtractorTemplateV2{}, id).Error
}

// IncrementTotalExtractions 增加总提取次数
func (r *ExtractorTemplateV2Repository) IncrementTotalExtractions(id uint) error {
	return r.db.Model(&models.ExtractorTemplateV2{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"total_extractions": gorm.Expr("total_extractions + 1"),
			"last_extracted_at": time.Now(),
		}).Error
}

// IncrementSuccessExtractions 增加成功提取次数
func (r *ExtractorTemplateV2Repository) IncrementSuccessExtractions(id uint) error {
	return r.db.Model(&models.ExtractorTemplateV2{}).
		Where("id = ?", id).
		Update("success_extractions", gorm.Expr("success_extractions + 1")).Error
}

// UpdateLastError 更新最后错误信息
func (r *ExtractorTemplateV2Repository) UpdateLastError(id uint, errorMsg string) error {
	return r.db.Model(&models.ExtractorTemplateV2{}).
		Where("id = ?", id).
		Update("last_error", errorMsg).Error
}

// GetCategories 获取所有分类
func (r *ExtractorTemplateV2Repository) GetCategories(orgID uint) ([]string, error) {
	var categories []string
	query := r.db.Model(&models.ExtractorTemplateV2{}).
		Distinct("category").
		Where("category IS NOT NULL AND category != ''")
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	if err := query.Pluck("category", &categories).Error; err != nil {
		return nil, err
	}
	return categories, nil
}

// ExtractionLogV2Repository 提取日志V2仓库
type ExtractionLogV2Repository struct {
	db *gorm.DB
}

// NewExtractionLogV2Repository 创建新的提取日志V2仓库
func NewExtractionLogV2Repository(db *gorm.DB) *ExtractionLogV2Repository {
	return &ExtractionLogV2Repository{db: db}
}

// Create 创建提取日志
func (r *ExtractionLogV2Repository) Create(log *models.ExtractionLogV2) error {
	return r.db.Create(log).Error
}

// GetByID 根据ID获取日志
func (r *ExtractionLogV2Repository) GetByID(id uint) (*models.ExtractionLogV2, error) {
	var log models.ExtractionLogV2
	if err := r.db.First(&log, id).Error; err != nil {
		return nil, err
	}
	return &log, nil
}

// GetByTemplateID 根据模板ID获取日志
func (r *ExtractionLogV2Repository) GetByTemplateID(templateID uint, page, limit int) ([]models.ExtractionLogV2, int64, error) {
	var logs []models.ExtractionLogV2
	var total int64

	query := r.db.Model(&models.ExtractionLogV2{}).Where("template_id = ?", templateID)

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * limit
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&logs).Error; err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}

// GetByEmailID 根据邮件ID获取日志
func (r *ExtractionLogV2Repository) GetByEmailID(emailID uint, page, limit int) ([]models.ExtractionLogV2, int64, error) {
	var logs []models.ExtractionLogV2
	var total int64

	query := r.db.Model(&models.ExtractionLogV2{}).Where("email_id = ?", emailID)

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * limit
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&logs).Error; err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}

// GetRecent 获取最近的日志
func (r *ExtractionLogV2Repository) GetRecent(limit int, orgID uint) ([]models.ExtractionLogV2, error) {
	var logs []models.ExtractionLogV2
	query := r.db.Model(&models.ExtractionLogV2{})
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	if err := query.Order("created_at DESC").Limit(limit).Find(&logs).Error; err != nil {
		return nil, err
	}
	return logs, nil
}

// DeleteByTemplateID 删除指定模板的所有日志
func (r *ExtractionLogV2Repository) DeleteByTemplateID(templateID uint) error {
	return r.db.Where("template_id = ?", templateID).Delete(&models.ExtractionLogV2{}).Error
}

// DeleteOldLogs 删除指定天数前的日志
func (r *ExtractionLogV2Repository) DeleteOldLogs(days int) error {
	cutoff := time.Now().AddDate(0, 0, -days)
	return r.db.Where("created_at < ?", cutoff).Delete(&models.ExtractionLogV2{}).Error
}

// GetStats 获取统计数据
func (r *ExtractionLogV2Repository) GetStats(templateID uint) (map[string]int64, error) {
	stats := make(map[string]int64)

	var total, success, failed, noMatch int64

	r.db.Model(&models.ExtractionLogV2{}).
		Where("template_id = ?", templateID).
		Count(&total)

	r.db.Model(&models.ExtractionLogV2{}).
		Where("template_id = ? AND status = ?", templateID, models.ExtractionV2StatusSuccess).
		Count(&success)

	r.db.Model(&models.ExtractionLogV2{}).
		Where("template_id = ? AND status = ?", templateID, models.ExtractionV2StatusFailed).
		Count(&failed)

	r.db.Model(&models.ExtractionLogV2{}).
		Where("template_id = ? AND status = ?", templateID, models.ExtractionV2StatusNoMatch).
		Count(&noMatch)

	stats["total"] = total
	stats["success"] = success
	stats["failed"] = failed
	stats["no_match"] = noMatch

	return stats, nil
}
