package repository

import (
	"mailman/internal/models"
	"sync"

	"gorm.io/gorm"
)

// OrganizationRepository 组织数据库操作
type OrganizationRepository struct {
	db *gorm.DB
	mu sync.RWMutex
}

// NewOrganizationRepository creates a new organization repository
func NewOrganizationRepository(db *gorm.DB) *OrganizationRepository {
	return &OrganizationRepository{db: db}
}

// Create 创建组织
func (r *OrganizationRepository) Create(org *models.Organization) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.db.Create(org).Error
}

// GetByID 根据ID获取组织
func (r *OrganizationRepository) GetByID(id uint) (*models.Organization, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var org models.Organization
	if err := r.db.First(&org, id).Error; err != nil {
		return nil, err
	}
	return &org, nil
}

// GetBySlug 根据 slug 获取组织
func (r *OrganizationRepository) GetBySlug(slug string) (*models.Organization, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var org models.Organization
	if err := r.db.Where("slug = ?", slug).First(&org).Error; err != nil {
		return nil, err
	}
	return &org, nil
}

// GetAll 获取所有组织
func (r *OrganizationRepository) GetAll() ([]models.Organization, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var orgs []models.Organization
	if err := r.db.Where("is_active = ?", true).Order("id ASC").Find(&orgs).Error; err != nil {
		return nil, err
	}
	return orgs, nil
}

// Update 更新组织
func (r *OrganizationRepository) Update(org *models.Organization) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.db.Save(org).Error
}

// Delete 软删除组织
func (r *OrganizationRepository) Delete(id uint) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.db.Delete(&models.Organization{}, id).Error
}

// Count 获取组织总数
func (r *OrganizationRepository) Count() (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var count int64
	err := r.db.Model(&models.Organization{}).Count(&count).Error
	return count, err
}

// GetUserOrganizations 获取用户所属的所有组织
func (r *OrganizationRepository) GetUserOrganizations(userID uint) ([]models.Organization, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var orgs []models.Organization
	err := r.db.Where("id IN (SELECT org_id FROM org_members WHERE user_id = ?)", userID).
		Where("is_active = ?", true).
		Order("id ASC").
		Find(&orgs).Error
	return orgs, err
}
