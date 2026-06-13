package api

import (
	"testing"

	"mailman/internal/models"
	"mailman/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNormalizeBatchOutlookImportOptionsDefaults(t *testing.T) {
	options := normalizeBatchOutlookImportOptions(BatchOutlookImportOptions{})

	if options.Verify == nil || !*options.Verify {
		t.Fatalf("expected verify to default to true")
	}
	if options.RunInitialSync == nil || !*options.RunInitialSync {
		t.Fatalf("expected run_initial_sync to default to true")
	}
	if options.CreateSyncConfig == nil || !*options.CreateSyncConfig {
		t.Fatalf("expected create_sync_config to default to true")
	}
	if options.UpdateExisting == nil || !*options.UpdateExisting {
		t.Fatalf("expected update_existing to default to true")
	}
	if options.CreateConcurrency != batchOutlookImportDefaultCreateLimit {
		t.Fatalf("expected default create concurrency %d, got %d", batchOutlookImportDefaultCreateLimit, options.CreateConcurrency)
	}
	if options.VerifyConcurrency != batchOutlookImportDefaultVerifyLimit {
		t.Fatalf("expected default verify concurrency %d, got %d", batchOutlookImportDefaultVerifyLimit, options.VerifyConcurrency)
	}
	if options.SyncConcurrency != batchOutlookImportDefaultSyncLimit {
		t.Fatalf("expected default sync concurrency %d, got %d", batchOutlookImportDefaultSyncLimit, options.SyncConcurrency)
	}
	if options.ConfigConcurrency != options.CreateConcurrency {
		t.Fatalf("expected config concurrency to default to create concurrency")
	}
}

func TestNormalizeBatchOutlookImportOptionsClampsConcurrency(t *testing.T) {
	options := normalizeBatchOutlookImportOptions(BatchOutlookImportOptions{
		CreateConcurrency: 1000,
		VerifyConcurrency: 1000,
		SyncConcurrency:   1000,
		ConfigConcurrency: 1000,
	})

	if options.CreateConcurrency != batchOutlookImportMaxCreateLimit {
		t.Fatalf("expected create concurrency to clamp to %d, got %d", batchOutlookImportMaxCreateLimit, options.CreateConcurrency)
	}
	if options.VerifyConcurrency != batchOutlookImportMaxVerifyLimit {
		t.Fatalf("expected verify concurrency to clamp to %d, got %d", batchOutlookImportMaxVerifyLimit, options.VerifyConcurrency)
	}
	if options.SyncConcurrency != batchOutlookImportMaxSyncLimit {
		t.Fatalf("expected sync concurrency to clamp to %d, got %d", batchOutlookImportMaxSyncLimit, options.SyncConcurrency)
	}
	if options.ConfigConcurrency != batchOutlookImportMaxCreateLimit {
		t.Fatalf("expected config concurrency to clamp to %d, got %d", batchOutlookImportMaxCreateLimit, options.ConfigConcurrency)
	}
}

func TestEnsureBatchOutlookDisabledSyncConfigCreatesPlaceholder(t *testing.T) {
	handler, db := newBatchOutlookImportTestHandler(t)
	account := createBatchOutlookImportTestAccount(t, db)

	request := &AccountOnboardSyncConfigRequest{
		SyncInterval: 120,
		SyncFolders:  []string{"INBOX", "Archive"},
	}
	if err := handler.ensureBatchOutlookDisabledSyncConfig(account.ID, request); err != nil {
		t.Fatalf("ensure disabled sync config failed: %v", err)
	}

	var config models.EmailAccountSyncConfig
	if err := db.Where("account_id = ?", account.ID).First(&config).Error; err != nil {
		t.Fatalf("failed to load sync config: %v", err)
	}
	if config.EnableAutoSync {
		t.Fatalf("placeholder should keep auto sync disabled")
	}
	if config.SyncInterval != 120 {
		t.Fatalf("sync interval = %d, want 120", config.SyncInterval)
	}
	if len(config.SyncFolders) != 2 || config.SyncFolders[1] != "Archive" {
		t.Fatalf("sync folders = %#v, want INBOX and Archive", config.SyncFolders)
	}
}

func TestEnsureBatchOutlookDisabledSyncConfigDoesNotOverwriteExistingConfig(t *testing.T) {
	handler, db := newBatchOutlookImportTestHandler(t)
	account := createBatchOutlookImportTestAccount(t, db)
	existing := models.EmailAccountSyncConfig{
		AccountID:      account.ID,
		EnableAutoSync: true,
		SyncInterval:   600,
		SyncFolders:    models.StringSlice{"INBOX"},
		SyncStatus:     models.SyncStatusIdle,
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("failed to create existing sync config: %v", err)
	}

	request := &AccountOnboardSyncConfigRequest{
		SyncInterval: 30,
		SyncFolders:  []string{"Archive"},
	}
	if err := handler.ensureBatchOutlookDisabledSyncConfig(account.ID, request); err != nil {
		t.Fatalf("ensure disabled sync config failed: %v", err)
	}

	var config models.EmailAccountSyncConfig
	if err := db.Where("account_id = ?", account.ID).First(&config).Error; err != nil {
		t.Fatalf("failed to load sync config: %v", err)
	}
	if !config.EnableAutoSync {
		t.Fatalf("existing auto sync config was disabled")
	}
	if config.SyncInterval != 600 {
		t.Fatalf("existing sync interval was overwritten: got %d", config.SyncInterval)
	}
	if len(config.SyncFolders) != 1 || config.SyncFolders[0] != "INBOX" {
		t.Fatalf("existing sync folders were overwritten: %#v", config.SyncFolders)
	}
}

func newBatchOutlookImportTestHandler(t *testing.T) (*APIHandler, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.EmailAccountSyncConfig{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}
	return &APIHandler{SyncConfigRepo: repository.NewSyncConfigRepository(db)}, db
}

func createBatchOutlookImportTestAccount(t *testing.T, db *gorm.DB) models.EmailAccount {
	t.Helper()
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "batch-outlook@example.com",
		AuthType:     models.AuthTypeOAuth2,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create email account: %v", err)
	}
	return account
}
