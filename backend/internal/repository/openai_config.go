package repository

import (
	"mailman/internal/models"

	"gorm.io/gorm"
)

// OpenAIConfigRepository handles database operations for OpenAI configurations
type OpenAIConfigRepository struct {
	db *gorm.DB
}

// NewOpenAIConfigRepository creates a new OpenAI config repository
func NewOpenAIConfigRepository(db *gorm.DB) *OpenAIConfigRepository {
	return &OpenAIConfigRepository{db: db}
}

// GetActive returns the active OpenAI configuration
func (r *OpenAIConfigRepository) GetActive(orgID uint) (*models.OpenAIConfig, error) {
	var config models.OpenAIConfig
	query := r.db.Where("is_active = ?", true)
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	err := query.First(&config).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// GetByID returns an OpenAI configuration by ID
func (r *OpenAIConfigRepository) GetByID(id uint) (*models.OpenAIConfig, error) {
	var config models.OpenAIConfig
	err := r.db.First(&config, id).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// GetByName returns an OpenAI configuration by name
func (r *OpenAIConfigRepository) GetByName(name string) (*models.OpenAIConfig, error) {
	var config models.OpenAIConfig
	err := r.db.Where("name = ?", name).First(&config).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// List returns all OpenAI configurations
func (r *OpenAIConfigRepository) List(orgID uint) ([]models.OpenAIConfig, error) {
	var configs []models.OpenAIConfig
	query := r.db
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	err := query.Find(&configs).Error
	return configs, err
}

// Create creates a new OpenAI configuration
func (r *OpenAIConfigRepository) Create(config *models.OpenAIConfig) error {
	// If this is set as active, deactivate all others
	if config.IsActive {
		if err := r.db.Model(&models.OpenAIConfig{}).Where("is_active = ?", true).Update("is_active", false).Error; err != nil {
			return err
		}
	}
	return r.db.Create(config).Error
}

// Update updates an existing OpenAI configuration
func (r *OpenAIConfigRepository) Update(config *models.OpenAIConfig) error {
	// If this is set as active, deactivate all others
	if config.IsActive {
		if err := r.db.Model(&models.OpenAIConfig{}).Where("id != ? AND is_active = ?", config.ID, true).Update("is_active", false).Error; err != nil {
			return err
		}
	}
	return r.db.Save(config).Error
}

// Delete deletes an OpenAI configuration
func (r *OpenAIConfigRepository) Delete(id uint) error {
	return r.db.Delete(&models.OpenAIConfig{}, id).Error
}

// SetActive sets a configuration as active and deactivates all others
func (r *OpenAIConfigRepository) SetActive(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// Deactivate all configurations
		if err := tx.Model(&models.OpenAIConfig{}).Where("is_active = ?", true).Update("is_active", false).Error; err != nil {
			return err
		}
		// Activate the specified configuration
		return tx.Model(&models.OpenAIConfig{}).Where("id = ?", id).Update("is_active", true).Error
	})
}
