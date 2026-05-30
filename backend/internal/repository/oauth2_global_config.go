package repository

import (
	"errors"
	"mailman/internal/models"

	"gorm.io/gorm"
)

// OAuth2GlobalConfigRepository handles database operations for OAuth2GlobalConfig
type OAuth2GlobalConfigRepository struct {
	db *gorm.DB
}

const oauth2ConfigSortOrder = "provider_type ASC, is_default DESC, name ASC, id ASC"

// NewOAuth2GlobalConfigRepository creates a new OAuth2GlobalConfigRepository
func NewOAuth2GlobalConfigRepository(db *gorm.DB) *OAuth2GlobalConfigRepository {
	return &OAuth2GlobalConfigRepository{db: db}
}

// Create creates a new OAuth2 global config
func (r *OAuth2GlobalConfigRepository) Create(config *models.OAuth2GlobalConfig) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if config.IsDefault {
			if err := tx.Model(&models.OAuth2GlobalConfig{}).
				Where("provider_type = ?", config.ProviderType).
				Update("is_default", false).Error; err != nil {
				return err
			}
		}

		if err := tx.Create(config).Error; err != nil {
			return err
		}

		return r.ensureProviderDefault(tx, config.ProviderType)
	})
}

// GetByID retrieves an OAuth2 global config by ID
func (r *OAuth2GlobalConfigRepository) GetByID(id uint) (*models.OAuth2GlobalConfig, error) {
	var config models.OAuth2GlobalConfig
	err := r.db.First(&config, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("OAuth2 global config not found")
		}
		return nil, err
	}
	return &config, nil
}

// GetByProviderType retrieves an OAuth2 global config by provider type
func (r *OAuth2GlobalConfigRepository) GetByProviderType(providerType models.MailProviderType) (*models.OAuth2GlobalConfig, error) {
	var config models.OAuth2GlobalConfig
	err := r.db.Where("provider_type = ? AND is_enabled = ?", providerType, true).
		Order("is_default DESC, id ASC").
		First(&config).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("OAuth2 global config not found")
		}
		return nil, err
	}
	return &config, nil
}

// GetCompleteConfigByProviderType retrieves a complete OAuth2 global config by provider type.
// Public OAuth2 clients such as Yahoo/Thunderbird-style clients may not have client_secret.
func (r *OAuth2GlobalConfigRepository) GetCompleteConfigByProviderType(providerType models.MailProviderType) (*models.OAuth2GlobalConfig, error) {
	var config models.OAuth2GlobalConfig

	// 首先尝试获取配置完整的记录
	query := r.db.Where("provider_type = ? AND is_enabled = ? AND client_id != '' AND redirect_uri != ''",
		providerType, true)
	if models.OAuth2ClientSecretRequired(providerType) {
		query = query.Where("client_secret != ''")
	}

	err := query.Order("is_default DESC, id ASC").First(&config).Error

	if err == nil {
		return &config, nil
	}

	// 如果没有找到完整配置，则返回任何启用的配置（包括空配置）
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = r.db.Where("provider_type = ? AND is_enabled = ?", providerType, true).
			Order("is_default DESC, id ASC").
			First(&config).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, errors.New("OAuth2 global config not found")
			}
			return nil, err
		}
		return &config, nil
	}

	return nil, err
}

// GetByName retrieves an OAuth2 global config by name
func (r *OAuth2GlobalConfigRepository) GetByName(name string) (*models.OAuth2GlobalConfig, error) {
	var config models.OAuth2GlobalConfig
	err := r.db.Where("name = ? AND is_enabled = ?", name, true).First(&config).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("OAuth2 global config not found")
		}
		return nil, err
	}
	return &config, nil
}

// GetByProviderTypeAll retrieves all OAuth2 global configs by provider type
func (r *OAuth2GlobalConfigRepository) GetByProviderTypeAll(providerType models.MailProviderType) ([]models.OAuth2GlobalConfig, error) {
	var configs []models.OAuth2GlobalConfig
	err := r.db.Where("provider_type = ? AND is_enabled = ?", providerType, true).
		Order("is_default DESC, name ASC, id ASC").
		Find(&configs).Error
	return configs, err
}

// GetAll retrieves all OAuth2 global configs
func (r *OAuth2GlobalConfigRepository) GetAll() ([]models.OAuth2GlobalConfig, error) {
	var configs []models.OAuth2GlobalConfig
	err := r.db.Order(oauth2ConfigSortOrder).Find(&configs).Error
	return configs, err
}

// GetEnabled retrieves all enabled OAuth2 global configs
func (r *OAuth2GlobalConfigRepository) GetEnabled() ([]models.OAuth2GlobalConfig, error) {
	var configs []models.OAuth2GlobalConfig
	err := r.db.Where("is_enabled = ?", true).Order(oauth2ConfigSortOrder).Find(&configs).Error
	return configs, err
}

// Update updates an OAuth2 global config
func (r *OAuth2GlobalConfigRepository) Update(config *models.OAuth2GlobalConfig) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing models.OAuth2GlobalConfig
		if err := tx.First(&existing, config.ID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("OAuth2 global config not found")
			}
			return err
		}

		if config.IsDefault {
			if err := tx.Model(&models.OAuth2GlobalConfig{}).
				Where("provider_type = ? AND id <> ?", config.ProviderType, config.ID).
				Update("is_default", false).Error; err != nil {
				return err
			}
		}

		result := tx.Model(&models.OAuth2GlobalConfig{}).
			Where("id = ?", config.ID).
			Updates(map[string]interface{}{
				"name":          config.Name,
				"provider_type": config.ProviderType,
				"client_id":     config.ClientID,
				"client_secret": config.ClientSecret,
				"redirect_uri":  config.RedirectURI,
				"scopes":        config.Scopes,
				"is_enabled":    config.IsEnabled,
				"is_default":    config.IsDefault,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("no rows affected, record not found")
		}

		if existing.ProviderType != config.ProviderType {
			if err := r.ensureProviderDefault(tx, existing.ProviderType); err != nil {
				return err
			}
		}

		return r.ensureProviderDefault(tx, config.ProviderType)
	})
}

// Delete soft deletes an OAuth2 global config
func (r *OAuth2GlobalConfigRepository) Delete(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing models.OAuth2GlobalConfig
		if err := tx.First(&existing, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("OAuth2 global config not found")
			}
			return err
		}

		if err := tx.Delete(&models.OAuth2GlobalConfig{}, id).Error; err != nil {
			return err
		}

		return r.ensureProviderDefault(tx, existing.ProviderType)
	})
}

// SetDefault marks one OAuth2 config as the provider group's default.
func (r *OAuth2GlobalConfigRepository) SetDefault(id uint) (*models.OAuth2GlobalConfig, error) {
	var config models.OAuth2GlobalConfig
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&config, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("OAuth2 global config not found")
			}
			return err
		}

		if err := tx.Model(&models.OAuth2GlobalConfig{}).
			Where("provider_type = ?", config.ProviderType).
			Update("is_default", false).Error; err != nil {
			return err
		}

		if err := tx.Model(&models.OAuth2GlobalConfig{}).
			Where("id = ?", config.ID).
			Update("is_default", true).Error; err != nil {
			return err
		}

		config.IsDefault = true
		return nil
	})
	if err != nil {
		return nil, err
	}

	return &config, nil
}

// CreateOrUpdate creates or updates an OAuth2 global config for a provider
func (r *OAuth2GlobalConfigRepository) CreateOrUpdate(config *models.OAuth2GlobalConfig) error {
	var existing models.OAuth2GlobalConfig
	err := r.db.Where("provider_type = ?", config.ProviderType).Order("is_default DESC, id ASC").First(&existing).Error

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Create new
			return r.Create(config)
		}
		return err
	}

	// Update existing
	config.ID = existing.ID
	config.CreatedAt = existing.CreatedAt
	return r.Update(config)
}

// SeedDefaultConfigs seeds the database with default OAuth2 configs
func (r *OAuth2GlobalConfigRepository) SeedDefaultConfigs() error {
	// Check and create Gmail config
	hasGmailConfig, err := r.providerHasConfigs(models.ProviderTypeGmail)
	if err != nil {
		return err
	}
	if !hasGmailConfig {
		// Create default Gmail config (disabled by default)
		gmailConfig := &models.OAuth2GlobalConfig{
			Name:         "Gmail 默认配置",
			ProviderType: models.ProviderTypeGmail,
			ClientID:     "",
			ClientSecret: "",
			RedirectURI:  "",
			Scopes:       models.DefaultOAuth2Scopes(models.ProviderTypeGmail),
			IsEnabled:    false,
			IsDefault:    true,
		}
		if err := r.Create(gmailConfig); err != nil {
			return err
		}
	}

	// Check and create Outlook config
	hasOutlookConfig, err := r.providerHasConfigs(models.ProviderTypeOutlook)
	if err != nil {
		return err
	}
	if !hasOutlookConfig {
		// Create default Outlook config (disabled by default)
		outlookConfig := &models.OAuth2GlobalConfig{
			Name:         "Outlook 默认配置",
			ProviderType: models.ProviderTypeOutlook,
			ClientID:     "",
			ClientSecret: "",
			RedirectURI:  "",
			Scopes:       models.DefaultOAuth2Scopes(models.ProviderTypeOutlook),
			IsEnabled:    false,
			IsDefault:    true,
		}
		if err := r.Create(outlookConfig); err != nil {
			return err
		}
	}

	return nil
}

func (r *OAuth2GlobalConfigRepository) providerHasConfigs(providerType models.MailProviderType) (bool, error) {
	var count int64
	if err := r.db.Model(&models.OAuth2GlobalConfig{}).Where("provider_type = ?", providerType).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *OAuth2GlobalConfigRepository) ensureProviderDefault(tx *gorm.DB, providerType models.MailProviderType) error {
	var defaults []models.OAuth2GlobalConfig
	if err := tx.Where("provider_type = ? AND is_default = ?", providerType, true).
		Order("id ASC").
		Find(&defaults).Error; err != nil {
		return err
	}

	if len(defaults) > 1 {
		for _, config := range defaults[1:] {
			if err := tx.Model(&models.OAuth2GlobalConfig{}).
				Where("id = ?", config.ID).
				Update("is_default", false).Error; err != nil {
				return err
			}
		}
		return nil
	}

	if len(defaults) == 1 {
		return nil
	}

	var fallback models.OAuth2GlobalConfig
	err := tx.Where("provider_type = ?", providerType).
		Order("is_enabled DESC, id ASC").
		First(&fallback).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	return tx.Model(&models.OAuth2GlobalConfig{}).
		Where("id = ?", fallback.ID).
		Update("is_default", true).Error
}
