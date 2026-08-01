package repository

import (
	"errors"
	"testing"
	"time"

	"mailman/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSyncConfigRepositoryCommitsAndResetsGmailCheckpoint(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(
		&models.EmailAccount{},
		&models.EmailAccountSyncConfig{},
		&models.SyncCursor{},
		&models.IncrementalSyncRecord{},
	); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "repair@gmail.com",
		AuthType:     models.AuthTypeOAuth2,
		IsVerified:   true,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Second)
	config := models.EmailAccountSyncConfig{
		AccountID:         account.ID,
		EnableAutoSync:    true,
		SyncInterval:      90,
		SyncFolders:       models.StringSlice{"INBOX"},
		LastSyncTime:      &now,
		LastSyncEndTime:   &now,
		LastHistoryID:     "old-history",
		LastSyncMessageID: "old-message",
		LastSyncError:     "old-error",
		SyncStatus:        models.SyncStatusError,
	}
	if err := db.Create(&config).Error; err != nil {
		t.Fatalf("failed to create sync config: %v", err)
	}

	repo := NewSyncConfigRepository(db)
	if err := repo.UpsertAccountSyncCursorHistoryID(account.ID, models.SyncCursorProviderGmail, "old-history"); err != nil {
		t.Fatalf("failed to create Gmail cursor: %v", err)
	}
	if err := repo.UpsertAccountSyncCursorTimes(account.ID, models.SyncCursorProviderGeneric, &now, &now); err != nil {
		t.Fatalf("failed to create generic cursor: %v", err)
	}
	if err := db.Create(&models.IncrementalSyncRecord{
		AccountID:         account.ID,
		MailboxName:       "INBOX",
		LastSyncStartTime: now,
		LastSyncEndTime:   now,
		EmailsProcessed:   5,
	}).Error; err != nil {
		t.Fatalf("failed to create incremental record: %v", err)
	}

	if err := repo.CommitAccountGmailHistoryID(account.ID, "new-history"); err != nil {
		t.Fatalf("CommitAccountGmailHistoryID failed: %v", err)
	}
	committedConfig, err := repo.GetByAccountID(account.ID)
	if err != nil {
		t.Fatalf("failed to reload committed config: %v", err)
	}
	if committedConfig.LastHistoryID != "new-history" {
		t.Fatalf("legacy history = %q, want new-history", committedConfig.LastHistoryID)
	}
	committedCursor, err := repo.GetAccountSyncCursor(account.ID, models.SyncCursorProviderGmail)
	if err != nil {
		t.Fatalf("failed to reload committed cursor: %v", err)
	}
	if committedCursor.LastHistoryID != "new-history" {
		t.Fatalf("cursor history = %q, want new-history", committedCursor.LastHistoryID)
	}

	if err := repo.ResetAccountSyncState(account.ID); err != nil {
		t.Fatalf("ResetAccountSyncState failed: %v", err)
	}
	resetConfig, err := repo.GetByAccountID(account.ID)
	if err != nil {
		t.Fatalf("failed to reload reset config: %v", err)
	}
	if !resetConfig.EnableAutoSync || resetConfig.SyncInterval != 90 || len(resetConfig.SyncFolders) != 1 {
		t.Fatalf("repair reset changed user settings: %+v", resetConfig)
	}
	if resetConfig.LastHistoryID != "" || resetConfig.LastSyncTime != nil || resetConfig.LastSyncEndTime != nil || resetConfig.LastSyncMessageID != "" || resetConfig.LastSyncError != "" || resetConfig.SyncStatus != models.SyncStatusIdle {
		t.Fatalf("runtime state was not cleared: %+v", resetConfig)
	}

	var cursorCount int64
	if err := db.Model(&models.SyncCursor{}).Where("account_id = ?", account.ID).Count(&cursorCount).Error; err != nil {
		t.Fatalf("failed to count cursors: %v", err)
	}
	if cursorCount != 0 {
		t.Fatalf("cursor count = %d, want 0", cursorCount)
	}
	var recordCount int64
	if err := db.Model(&models.IncrementalSyncRecord{}).Where("account_id = ?", account.ID).Count(&recordCount).Error; err != nil {
		t.Fatalf("failed to count sync records: %v", err)
	}
	if recordCount != 0 {
		t.Fatalf("sync record count = %d, want 0", recordCount)
	}

	repairCheckpoint := now.Add(2 * time.Minute)
	if err := repo.CommitAccountSyncRepair(account.ID, repairCheckpoint); err != nil {
		t.Fatalf("CommitAccountSyncRepair failed: %v", err)
	}
	repairedConfig, err := repo.GetByAccountID(account.ID)
	if err != nil {
		t.Fatalf("failed to reload repaired config: %v", err)
	}
	if repairedConfig.LastSyncTime == nil || !repairedConfig.LastSyncTime.Equal(repairCheckpoint) ||
		repairedConfig.LastSyncEndTime == nil || !repairedConfig.LastSyncEndTime.Equal(repairCheckpoint) {
		t.Fatalf("repair checkpoint was not committed to sync config: %+v", repairedConfig)
	}
	if !repairedConfig.EnableAutoSync || repairedConfig.SyncInterval != 90 || len(repairedConfig.SyncFolders) != 1 {
		t.Fatalf("repair commit changed user settings: %+v", repairedConfig)
	}
	repairedCursor, err := repo.GetAccountSyncCursor(account.ID, models.SyncCursorProviderGeneric)
	if err != nil {
		t.Fatalf("failed to reload repaired cursor: %v", err)
	}
	if repairedCursor.LastSyncTime == nil || !repairedCursor.LastSyncTime.Equal(repairCheckpoint) ||
		repairedCursor.LastSyncEndTime == nil || !repairedCursor.LastSyncEndTime.Equal(repairCheckpoint) {
		t.Fatalf("repair checkpoint was not committed to generic cursor: %+v", repairedCursor)
	}
}

func TestGetRecoverableAutoDisabledConfigsIncludesLegacyRowsAndHonorsCooldown(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.EmailAccountSyncConfig{}); err != nil {
		t.Fatalf("failed to migrate recovery test db: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Second)
	type recoveryCase struct {
		email        string
		lastError    time.Time
		attempts     int
		lastRecovery *time.Time
	}
	dueRetry := now.Add(-25 * time.Hour)
	coolingRetry := now.Add(-time.Hour)
	cases := []recoveryCase{
		{email: "legacy@example.com", lastError: now.Add(-7 * 24 * time.Hour)},
		{email: "due-retry@example.com", lastError: now.Add(-7 * 24 * time.Hour), attempts: 3, lastRecovery: &dueRetry},
		{email: "cooling@example.com", lastError: now.Add(-7 * 24 * time.Hour), attempts: 3, lastRecovery: &coolingRetry},
		{email: "recent-error@example.com", lastError: now.Add(-10 * time.Minute)},
	}

	for _, tc := range cases {
		account := models.EmailAccount{OrgID: 1, EmailAddress: tc.email, AuthType: models.AuthTypeOAuth2}
		if err := db.Create(&account).Error; err != nil {
			t.Fatalf("create %s: %v", tc.email, err)
		}
		config := models.EmailAccountSyncConfig{
			AccountID:           account.ID,
			EnableAutoSync:      false,
			AutoDisabled:        true,
			LastErrorTime:       &tc.lastError,
			RecoveryAttempts:    tc.attempts,
			LastRecoveryAttempt: tc.lastRecovery,
		}
		if err := db.Create(&config).Error; err != nil {
			t.Fatalf("create config for %s: %v", tc.email, err)
		}
	}

	repo := NewSyncConfigRepository(db)
	configs, err := repo.GetRecoverableAutoDisabledConfigs(now, 3, 10)
	if err != nil {
		t.Fatalf("query recoverable configs: %v", err)
	}
	if len(configs) != 2 {
		t.Fatalf("recoverable config count = %d, want 2", len(configs))
	}
	if configs[0].Account.EmailAddress != "legacy@example.com" {
		t.Fatalf("first recovery candidate = %q, want never-attempted legacy account", configs[0].Account.EmailAddress)
	}
	if configs[1].Account.EmailAddress != "due-retry@example.com" {
		t.Fatalf("second recovery candidate = %q, want cooldown-expired account", configs[1].Account.EmailAddress)
	}
}

func TestSyncConfigRepositoryRecordsSyncRun(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.SyncRun{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "sync@example.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	repo := NewSyncConfigRepository(db)
	run := &models.SyncRun{
		AccountID: account.ID,
		Source:    "pickup",
		StartedAt: time.Now().Add(-25 * time.Millisecond),
		Metadata:  models.JSONMap{"request_id": "test"},
	}
	if err := repo.CreateSyncRun(run); err != nil {
		t.Fatalf("CreateSyncRun failed: %v", err)
	}
	if run.ID == 0 {
		t.Fatal("CreateSyncRun did not populate run ID")
	}
	if run.Status != models.SyncRunStatusRunning {
		t.Fatalf("run status = %q, want %q", run.Status, models.SyncRunStatusRunning)
	}

	if err := repo.FinishSyncRun(run.ID, models.SyncRunStatusFailed, 3, 1, errors.New("boom")); err != nil {
		t.Fatalf("FinishSyncRun failed: %v", err)
	}

	var saved models.SyncRun
	if err := db.First(&saved, run.ID).Error; err != nil {
		t.Fatalf("failed to reload sync run: %v", err)
	}
	if saved.Status != models.SyncRunStatusFailed {
		t.Fatalf("saved status = %q, want %q", saved.Status, models.SyncRunStatusFailed)
	}
	if saved.EmailsFetched != 3 || saved.NewEmails != 1 {
		t.Fatalf("saved counts = fetched %d new %d, want fetched 3 new 1", saved.EmailsFetched, saved.NewEmails)
	}
	if saved.ErrorMessage != "boom" {
		t.Fatalf("saved error = %q, want boom", saved.ErrorMessage)
	}
	if saved.FinishedAt == nil {
		t.Fatal("finished_at was not set")
	}
}

func TestSyncConfigRepositoryUpsertsSyncCursorIndependently(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.SyncCursor{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "cursor@example.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	repo := NewSyncConfigRepository(db)
	start := time.Now().Add(-time.Minute).UTC().Truncate(time.Second)
	end := time.Now().UTC().Truncate(time.Second)

	if err := repo.UpsertAccountSyncCursorTimes(account.ID, models.SyncCursorProviderGeneric, &start, &end); err != nil {
		t.Fatalf("UpsertAccountSyncCursorTimes failed: %v", err)
	}

	cursor, err := repo.GetAccountSyncCursor(account.ID, models.SyncCursorProviderGeneric)
	if err != nil {
		t.Fatalf("GetAccountSyncCursor failed: %v", err)
	}
	if cursor.LastSyncTime == nil || !cursor.LastSyncTime.Equal(start) {
		t.Fatalf("last_sync_time = %v, want %v", cursor.LastSyncTime, start)
	}
	if cursor.LastSyncEndTime == nil || !cursor.LastSyncEndTime.Equal(end) {
		t.Fatalf("last_sync_end_time = %v, want %v", cursor.LastSyncEndTime, end)
	}

	if err := repo.UpsertAccountSyncCursorHistoryID(account.ID, models.SyncCursorProviderGeneric, "history-1"); err != nil {
		t.Fatalf("UpsertAccountSyncCursorHistoryID failed: %v", err)
	}
	cursor, err = repo.GetAccountSyncCursor(account.ID, models.SyncCursorProviderGeneric)
	if err != nil {
		t.Fatalf("GetAccountSyncCursor after history update failed: %v", err)
	}
	if cursor.LastHistoryID != "history-1" {
		t.Fatalf("last_history_id = %q, want history-1", cursor.LastHistoryID)
	}
	if cursor.LastSyncEndTime == nil || !cursor.LastSyncEndTime.Equal(end) {
		t.Fatalf("history update changed last_sync_end_time: %v", cursor.LastSyncEndTime)
	}

	if err := repo.UpsertAccountSyncCursorHistoryID(account.ID, models.SyncCursorProviderGeneric, ""); err != nil {
		t.Fatalf("clearing sync cursor history failed: %v", err)
	}
	cursor, err = repo.GetAccountSyncCursor(account.ID, models.SyncCursorProviderGeneric)
	if err != nil {
		t.Fatalf("GetAccountSyncCursor after history clear failed: %v", err)
	}
	if cursor.LastHistoryID != "" {
		t.Fatalf("last_history_id = %q, want empty", cursor.LastHistoryID)
	}
}

func TestSyncConfigRepositorySettingsUpdatePreservesRuntimeFields(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.EmailAccountSyncConfig{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "settings@example.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	start := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)
	end := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	existing := models.EmailAccountSyncConfig{
		AccountID:           account.ID,
		EnableAutoSync:      false,
		SyncInterval:        60,
		SyncFolders:         models.StringSlice{"INBOX"},
		LastSyncTime:        &start,
		LastSyncEndTime:     &end,
		LastHistoryID:       "legacy-history",
		LastSyncMessageID:   "message-1",
		LastSyncError:       "token expired",
		SyncStatus:          models.SyncStatusError,
		AutoDisabled:        true,
		DisableReason:       "oauth_error",
		ConsecutiveErrors:   3,
		LastErrorTime:       &end,
		RecoveryAttempts:    2,
		LastRecoveryAttempt: &end,
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("failed to create sync config: %v", err)
	}

	repo := NewSyncConfigRepository(db)
	settings := &models.EmailAccountSyncConfig{
		AccountID:      account.ID,
		EnableAutoSync: true,
		SyncInterval:   120,
		SyncFolders:    models.StringSlice{"INBOX", "SENT"},
		SyncStatus:     models.SyncStatusIdle,
	}
	if err := repo.CreateOrUpdateSettings(settings); err != nil {
		t.Fatalf("CreateOrUpdateSettings failed: %v", err)
	}

	updated, err := repo.GetByAccountID(account.ID)
	if err != nil {
		t.Fatalf("failed to reload sync config: %v", err)
	}
	if !updated.EnableAutoSync || updated.SyncInterval != 120 {
		t.Fatalf("settings not updated: enabled=%v interval=%d", updated.EnableAutoSync, updated.SyncInterval)
	}
	if len(updated.SyncFolders) != 2 || updated.SyncFolders[1] != "SENT" {
		t.Fatalf("sync folders = %v, want INBOX,SENT", updated.SyncFolders)
	}
	if updated.LastSyncTime == nil || !updated.LastSyncTime.Equal(start) {
		t.Fatalf("last_sync_time = %v, want %v", updated.LastSyncTime, start)
	}
	if updated.LastSyncEndTime == nil || !updated.LastSyncEndTime.Equal(end) {
		t.Fatalf("last_sync_end_time = %v, want %v", updated.LastSyncEndTime, end)
	}
	if updated.LastHistoryID != "legacy-history" || updated.LastSyncMessageID != "message-1" {
		t.Fatalf("runtime checkpoint fields changed: history=%q message=%q", updated.LastHistoryID, updated.LastSyncMessageID)
	}
	if updated.AutoDisabled || updated.DisableReason != "" || updated.ConsecutiveErrors != 0 || updated.LastErrorTime != nil || updated.LastSyncError != "" {
		t.Fatalf("manual enable did not clear disabled/error state: %+v", updated)
	}
	if updated.RecoveryAttempts != 2 || updated.LastRecoveryAttempt == nil || !updated.LastRecoveryAttempt.Equal(end) {
		t.Fatalf("recovery state should be preserved, got attempts=%d last=%v", updated.RecoveryAttempts, updated.LastRecoveryAttempt)
	}
}

func mustOpenRealSyncConfigTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	return db
}
