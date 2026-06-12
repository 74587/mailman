package api

import "testing"

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
