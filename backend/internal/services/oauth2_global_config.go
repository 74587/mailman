package services

import (
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
)

// OAuth2GlobalConfigService handles OAuth2 global configuration business logic
type OAuth2GlobalConfigService struct {
	repo *repository.OAuth2GlobalConfigRepository
}

// NewOAuth2GlobalConfigService creates a new OAuth2GlobalConfigService
func NewOAuth2GlobalConfigService(repo *repository.OAuth2GlobalConfigRepository) *OAuth2GlobalConfigService {
	return &OAuth2GlobalConfigService{
		repo: repo,
	}
}

// CreateOrUpdateConfig creates or updates OAuth2 global configuration
func (s *OAuth2GlobalConfigService) CreateOrUpdateConfig(config *models.OAuth2GlobalConfig) error {
	// Validate required fields
	if config.Name == "" {
		return fmt.Errorf("name is required")
	}
	if config.ProviderType == "" {
		return fmt.Errorf("provider type is required")
	}
	if config.ClientID == "" {
		return fmt.Errorf("client ID is required")
	}
	if config.ClientSecret == "" {
		return fmt.Errorf("client secret is required")
	}
	if config.RedirectURI == "" {
		return fmt.Errorf("redirect URI is required")
	}

	// Set default scopes if not provided
	if len(config.Scopes) == 0 {
		switch config.ProviderType {
		case models.ProviderTypeGmail:
			config.Scopes = models.StringSlice{"https://mail.google.com/", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"}
		case models.ProviderTypeOutlook:
			config.Scopes = models.StringSlice{"https://outlook.office.com/IMAP.AccessAsUser.All", "offline_access"}
		}
	}

	// 如果ID存在且大于0，执行更新操作
	if config.ID > 0 {
		return s.repo.Update(config)
	}

	// 否则执行创建操作
	return s.repo.Create(config)
}

// GetConfigByID retrieves OAuth2 configuration by ID
func (s *OAuth2GlobalConfigService) GetConfigByID(id uint) (*models.OAuth2GlobalConfig, error) {
	return s.repo.GetByID(id)
}

// GetConfigByName retrieves OAuth2 configuration by name
func (s *OAuth2GlobalConfigService) GetConfigByName(name string) (*models.OAuth2GlobalConfig, error) {
	return s.repo.GetByName(name)
}

// GetConfigByProvider retrieves OAuth2 configuration for a specific provider (backward compatibility)
func (s *OAuth2GlobalConfigService) GetConfigByProvider(providerType models.MailProviderType) (*models.OAuth2GlobalConfig, error) {
	return s.repo.GetByProviderType(providerType)
}

// GetConfigsByProviderType retrieves all OAuth2 configurations for a specific provider type
func (s *OAuth2GlobalConfigService) GetConfigsByProviderType(providerType models.MailProviderType) ([]models.OAuth2GlobalConfig, error) {
	return s.repo.GetByProviderTypeAll(providerType)
}

// UpdateConfig updates an existing OAuth2 configuration
func (s *OAuth2GlobalConfigService) UpdateConfig(config *models.OAuth2GlobalConfig) error {
	// Validate required fields
	if config.Name == "" {
		return fmt.Errorf("name is required")
	}
	if config.ProviderType == "" {
		return fmt.Errorf("provider type is required")
	}
	if config.ClientID == "" {
		return fmt.Errorf("client ID is required")
	}
	if config.ClientSecret == "" {
		return fmt.Errorf("client secret is required")
	}
	if config.RedirectURI == "" {
		return fmt.Errorf("redirect URI is required")
	}

	return s.repo.Update(config)
}

// GetAllConfigs retrieves all OAuth2 configurations
func (s *OAuth2GlobalConfigService) GetAllConfigs() ([]models.OAuth2GlobalConfig, error) {
	return s.repo.GetAll()
}

// GetEnabledConfigs retrieves all enabled OAuth2 configurations
func (s *OAuth2GlobalConfigService) GetEnabledConfigs() ([]models.OAuth2GlobalConfig, error) {
	return s.repo.GetEnabled()
}

// EnableConfig enables OAuth2 configuration for a provider
func (s *OAuth2GlobalConfigService) EnableConfig(providerType models.MailProviderType) error {
	config, err := s.repo.GetByProviderType(providerType)
	if err != nil {
		return err
	}

	config.IsEnabled = true
	return s.repo.Update(config)
}

// DisableConfig disables OAuth2 configuration for a provider
func (s *OAuth2GlobalConfigService) DisableConfig(providerType models.MailProviderType) error {
	config, err := s.repo.GetByProviderType(providerType)
	if err != nil {
		return err
	}

	config.IsEnabled = false
	return s.repo.Update(config)
}

// DeleteConfig deletes OAuth2 configuration for a provider
func (s *OAuth2GlobalConfigService) DeleteConfig(id uint) error {
	return s.repo.Delete(id)
}

// SetDefaultConfig sets one OAuth2 configuration as the default for its provider group.
func (s *OAuth2GlobalConfigService) SetDefaultConfig(id uint) (*models.OAuth2GlobalConfig, error) {
	return s.repo.SetDefault(id)
}

// IsProviderEnabled checks if OAuth2 is enabled for a provider
func (s *OAuth2GlobalConfigService) IsProviderEnabled(providerType models.MailProviderType) bool {
	config, err := s.repo.GetByProviderType(providerType)
	if err != nil {
		return false
	}
	return config.IsEnabled
}

// GetProviderConfig gets OAuth2 configuration for generating auth URLs
// 优先使用完整配置进行认证
func (s *OAuth2GlobalConfigService) GetProviderConfig(providerType models.MailProviderType) (*models.OAuth2GlobalConfig, error) {
	config, err := s.repo.GetCompleteConfigByProviderType(providerType)
	if err != nil {
		return nil, fmt.Errorf("OAuth2 configuration not found for provider %s", providerType)
	}

	if !config.IsEnabled {
		return nil, fmt.Errorf("OAuth2 is not enabled for provider %s", providerType)
	}

	return config, nil
}

// GetCompleteConfigByProviderType retrieves complete OAuth2 configuration for a specific provider type
func (s *OAuth2GlobalConfigService) GetCompleteConfigByProviderType(providerType models.MailProviderType) (*models.OAuth2GlobalConfig, error) {
	return s.repo.GetCompleteConfigByProviderType(providerType)
}
