package services

import (
	"context"
	"errors"
	"testing"
)

func TestRunAccountExclusiveKeepsSyncerMapStable(t *testing.T) {
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
	if manager.mu.TryLock() {
		manager.mu.Unlock()
		t.Fatal("syncer map became writable during account repair")
	}

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
	syncer := &AccountSyncer{}
	syncer.syncMu.Lock()
	defer syncer.syncMu.Unlock()
	manager := &PerAccountSyncManager{
		accountSyncers: map[uint]*AccountSyncer{1: syncer},
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	operationCalled := false

	err := manager.RunAccountExclusiveWithContext(ctx, 1, func() error {
		operationCalled = true
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if operationCalled {
		t.Fatal("repair operation ran after its request context was canceled")
	}
}
