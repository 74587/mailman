package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRunAccountExclusiveDoesNotBlockSyncerMap(t *testing.T) {
	manager := &PerAccountSyncManager{
		accountSyncers: map[uint]*AccountSyncer{1: {}},
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)

	go func() {
		done <- manager.RunAccountExclusive(1, func() error {
			close(entered)
			<-release
			return nil
		})
	}()

	<-entered
	if !manager.mu.TryLock() {
		t.Fatal("account repair blocked the global syncer map")
	}
	manager.mu.Unlock()

	close(release)
	if err := <-done; err != nil {
		t.Fatalf("RunAccountExclusive failed: %v", err)
	}
	if !manager.mu.TryLock() {
		t.Fatal("syncer map lock was not released after account repair")
	}
	manager.mu.Unlock()
}

func TestRunAccountExclusiveStopsWaitingWhenContextIsCanceled(t *testing.T) {
	manager := &PerAccountSyncManager{
		accountSyncers: map[uint]*AccountSyncer{1: {}},
	}
	operationLock := manager.accountOperationLock(1)
	operationLock.Lock()
	defer operationLock.Unlock()
	ctx, cancel := context.WithCancel(context.Background())
	operationCalled := false
	done := make(chan error, 1)
	go func() {
		done <- manager.RunAccountExclusiveWithContext(ctx, 1, func() error {
			operationCalled = true
			return nil
		})
	}()
	time.Sleep(30 * time.Millisecond)
	cancel()
	err := <-done
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if operationCalled {
		t.Fatal("repair operation ran after its request context was canceled")
	}
}

func TestRunAccountExclusiveReloadsCachedCheckpoints(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.EmailAccount{},
		&models.EmailAccountSyncConfig{},
		&models.SyncCursor{},
		&models.IncrementalSyncRecord{},
	); err != nil {
		t.Fatalf("migrate repair test db: %v", err)
	}

	account := models.EmailAccount{OrgID: 1, EmailAddress: "repair-outlook@example.com", AuthType: models.AuthTypeOAuth2}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	staleTime := time.Now().Add(24 * time.Hour).UTC().Truncate(time.Second)
	config := models.EmailAccountSyncConfig{
		AccountID:         account.ID,
		EnableAutoSync:    true,
		SyncInterval:      60,
		LastSyncTime:      &staleTime,
		LastSyncEndTime:   &staleTime,
		LastHistoryID:     "stale-history",
		LastSyncMessageID: "stale-message",
		LastSyncError:     "stale-error",
		SyncStatus:        models.SyncStatusError,
	}
	if err := db.Create(&config).Error; err != nil {
		t.Fatalf("create sync config: %v", err)
	}

	repo := repository.NewSyncConfigRepository(db)
	if err := repo.UpsertAccountSyncCursorTimes(account.ID, models.SyncCursorProviderGeneric, &staleTime, &staleTime); err != nil {
		t.Fatalf("create stale cursor: %v", err)
	}
	syncer := &AccountSyncer{AccountID: account.ID, Config: config, LastSyncTime: staleTime}
	manager := &PerAccountSyncManager{
		accountSyncers: map[uint]*AccountSyncer{account.ID: syncer},
		syncConfigRepo: repo,
	}
	repairCheckpoint := staleTime.Add(-48 * time.Hour)

	err = manager.RunAccountExclusive(account.ID, func() error {
		if err := repo.ResetAccountSyncState(account.ID); err != nil {
			return err
		}
		return repo.CommitAccountSyncRepair(account.ID, repairCheckpoint)
	})
	if err != nil {
		t.Fatalf("RunAccountExclusive failed: %v", err)
	}
	if syncer.LastSyncTime != repairCheckpoint || syncer.Config.LastSyncTime == nil || !syncer.Config.LastSyncTime.Equal(repairCheckpoint) ||
		syncer.Config.LastSyncEndTime == nil || !syncer.Config.LastSyncEndTime.Equal(repairCheckpoint) {
		t.Fatalf("cached repair checkpoint was not refreshed: last=%v config=%+v", syncer.LastSyncTime, syncer.Config)
	}
	if syncer.Config.LastHistoryID != "" || syncer.Config.LastSyncMessageID != "" || syncer.Config.LastSyncError != "" || syncer.Config.SyncStatus != models.SyncStatusIdle {
		t.Fatalf("stale cached sync state remains after repair: %+v", syncer.Config)
	}
}
