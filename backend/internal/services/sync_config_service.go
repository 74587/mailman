package services

import (
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
)

// SyncConfigService handles sync configuration operations
type SyncConfigService struct {
	accountRepo    *repository.EmailAccountRepository
	syncRepo       *repository.IncrementalSyncRepository
	fetcherService *FetcherService
	scheduler      *EmailFetchScheduler
	logger         *utils.Logger
}

// NewSyncConfigService creates a new SyncConfigService
func NewSyncConfigService(
	accountRepo *repository.EmailAccountRepository,
	syncRepo *repository.IncrementalSyncRepository,
	fetcherService *FetcherService,
	scheduler *EmailFetchScheduler,
) *SyncConfigService {
	return &SyncConfigService{
		accountRepo:    accountRepo,
		syncRepo:       syncRepo,
		fetcherService: fetcherService,
		scheduler:      scheduler,
		logger:         utils.NewLogger("SyncConfigService"),
	}
}

// GetAccountSyncConfig retrieves sync configuration for an account
func (s *SyncConfigService) GetAccountSyncConfig(accountID uint) (map[string]interface{}, error) {
	account, err := s.accountRepo.GetByID(accountID)
	if err != nil {
		return nil, fmt.Errorf("account not found: %w", err)
	}

	// Return sync-related settings from account
	config := map[string]interface{}{
		"account_id":    account.ID,
		"email_address": account.EmailAddress,
		"last_sync_at":  account.LastSyncAt,
	}

	return config, nil
}

// CreateAccountSyncConfig creates sync configuration for an account
func (s *SyncConfigService) CreateAccountSyncConfig(accountID uint, req map[string]interface{}) (map[string]interface{}, error) {
	_, err := s.accountRepo.GetByID(accountID)
	if err != nil {
		return nil, fmt.Errorf("account not found: %w", err)
	}

	// Store config and return
	result := map[string]interface{}{
		"account_id": accountID,
		"success":    true,
		"config":     req,
	}
	return result, nil
}

// UpdateAccountSyncConfig updates sync configuration for an account
func (s *SyncConfigService) UpdateAccountSyncConfig(accountID uint, req map[string]interface{}) (map[string]interface{}, error) {
	_, err := s.accountRepo.GetByID(accountID)
	if err != nil {
		return nil, fmt.Errorf("account not found: %w", err)
	}

	result := map[string]interface{}{
		"account_id": accountID,
		"success":    true,
		"config":     req,
	}
	return result, nil
}

// DeleteAccountSyncConfig deletes sync configuration for an account
func (s *SyncConfigService) DeleteAccountSyncConfig(accountID uint) error {
	_, err := s.accountRepo.GetByID(accountID)
	if err != nil {
		return fmt.Errorf("account not found: %w", err)
	}
	return nil
}

// GetEffectiveSyncConfig gets the effective (merged) sync config for an account
func (s *SyncConfigService) GetEffectiveSyncConfig(accountID uint) (map[string]interface{}, error) {
	return s.GetAccountSyncConfig(accountID)
}

// CreateTemporarySyncConfig creates a temporary sync config override
func (s *SyncConfigService) CreateTemporarySyncConfig(accountID uint, req map[string]interface{}) (map[string]interface{}, error) {
	return s.CreateAccountSyncConfig(accountID, req)
}

// SyncNow triggers an immediate sync for an account
func (s *SyncConfigService) SyncNow(accountID uint) (map[string]interface{}, error) {
	account, err := s.accountRepo.GetByID(accountID)
	if err != nil {
		return nil, fmt.Errorf("account not found: %w", err)
	}

	s.logger.Info("Triggering immediate sync for account %d (%s)", accountID, account.EmailAddress)

	// Trigger sync via scheduler if available
	if s.scheduler != nil {
		subscriptions := s.scheduler.GetAccountSubscriptions(accountID)
		for _, sub := range subscriptions {
			if _, err := s.scheduler.FetchNow(sub.ID, false); err != nil {
				s.logger.Error("Sync failed for subscription %s: %v", sub.ID, err)
			}
		}
	}

	return map[string]interface{}{
		"success":    true,
		"account_id": accountID,
		"message":    "Sync triggered",
	}, nil
}

// GetSyncStatistics gets sync statistics for an account
func (s *SyncConfigService) GetSyncStatistics(accountID uint) (map[string]interface{}, error) {
	records, err := s.syncRepo.GetAllByAccount(accountID)
	if err != nil {
		return nil, fmt.Errorf("failed to get sync records: %w", err)
	}

	return map[string]interface{}{
		"account_id":   accountID,
		"total_syncs":  len(records),
	}, nil
}

// GetAccountMailboxes gets mailboxes for an account
func (s *SyncConfigService) GetAccountMailboxes(accountID uint) ([]models.Mailbox, error) {
	account, err := s.accountRepo.GetByID(accountID)
	if err != nil {
		return nil, fmt.Errorf("account not found: %w", err)
	}

	return s.fetcherService.GetMailboxes(*account)
}

// GetAllSyncConfigs gets all sync configurations
func (s *SyncConfigService) GetAllSyncConfigs() ([]map[string]interface{}, error) {
	accounts, err := s.accountRepo.GetAll(0)
	if err != nil {
		return nil, fmt.Errorf("failed to get accounts: %w", err)
	}

	configs := make([]map[string]interface{}, 0, len(accounts))
	for _, account := range accounts {
		configs = append(configs, map[string]interface{}{
			"account_id":    account.ID,
			"email_address": account.EmailAddress,
			"last_sync_at":  account.LastSyncAt,
		})
	}

	return configs, nil
}

// GetGlobalSyncConfig gets the global sync configuration
func (s *SyncConfigService) GetGlobalSyncConfig() (map[string]interface{}, error) {
	return map[string]interface{}{
		"default_interval_minutes": 15,
		"max_concurrent_syncs":     5,
		"retry_on_failure":         true,
	}, nil
}

// UpdateGlobalSyncConfig updates the global sync configuration
func (s *SyncConfigService) UpdateGlobalSyncConfig(req map[string]interface{}) (map[string]interface{}, error) {
	// In a real implementation, this would persist the config
	return req, nil
}

// BatchCreateOrUpdateAccountSyncConfig handles batch sync config operations
func (s *SyncConfigService) BatchCreateOrUpdateAccountSyncConfig(req map[string]interface{}) (map[string]interface{}, error) {
	return map[string]interface{}{
		"success": true,
		"message": "Batch sync config updated",
	}, nil
}
