package api

import (
	"context"
	"encoding/json"
	"net/http"
	"runtime"
	"time"

	"mailman/internal/database"
	"mailman/internal/services"
)

// GetRuntimeObservabilityHandler returns the in-memory runtime observability snapshot.
func (h *APIHandler) GetRuntimeObservabilityHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	snapshot := services.GetRuntimeObservabilitySnapshot()
	snapshot.Process = buildRuntimeProcessSnapshot()
	snapshot.Database = buildRuntimeDatabaseSnapshot(ctx)
	if h.perAccountSyncManager != nil {
		stats := h.perAccountSyncManager.GetStats()
		snapshot.SyncConcurrency = services.RuntimeSyncConcurrencySnapshot{
			CurrentConcurrent: stats.CurrentConcurrent,
			CurrentPickup:     stats.CurrentPickup,
			ConcurrentLimit:   stats.ConcurrentLimit,
			PickupLimit:       stats.PickupLimit,
			ActiveSyncers:     stats.ActiveSyncers,
		}
	}
	snapshot.BatchOutlookImport = outlookImportJobs.observabilitySnapshot()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    snapshot,
	})
}

func buildRuntimeProcessSnapshot() services.RuntimeProcessSnapshot {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	var lastGCAt *time.Time
	if mem.LastGC > 0 {
		value := time.Unix(0, int64(mem.LastGC))
		lastGCAt = &value
	}

	return services.RuntimeProcessSnapshot{
		Goroutines:      runtime.NumGoroutine(),
		HeapAllocBytes:  mem.HeapAlloc,
		HeapSysBytes:    mem.HeapSys,
		StackInuseBytes: mem.StackInuse,
		HeapObjects:     mem.HeapObjects,
		NumGC:           mem.NumGC,
		LastGCAt:        lastGCAt,
	}
}

func buildRuntimeDatabaseSnapshot(parentCtx context.Context) services.RuntimeDatabaseSnapshot {
	snapshot := services.RuntimeDatabaseSnapshot{
		Driver: database.GetDBDriver(),
	}

	db := database.GetDB()
	if db == nil {
		snapshot.Error = "database is not initialized"
		return snapshot
	}

	sqlDB, err := db.DB()
	if err != nil {
		snapshot.Error = err.Error()
		return snapshot
	}

	stats := sqlDB.Stats()
	snapshot.MaxOpenConnections = stats.MaxOpenConnections
	snapshot.OpenConnections = stats.OpenConnections
	snapshot.InUse = stats.InUse
	snapshot.Idle = stats.Idle
	snapshot.WaitCount = stats.WaitCount
	snapshot.WaitDurationMS = float64(stats.WaitDuration.Microseconds()) / 1000
	snapshot.MaxIdleClosed = stats.MaxIdleClosed
	snapshot.MaxIdleTimeClosed = stats.MaxIdleTimeClosed
	snapshot.MaxLifetimeClosed = stats.MaxLifetimeClosed

	if database.GetDBDriver() == "postgres" {
		ctx, cancel := context.WithTimeout(parentCtx, 750*time.Millisecond)
		defer cancel()

		var waitEvents []services.RuntimeDatabaseWaitSnapshot
		err := db.WithContext(ctx).Raw(`
			SELECT COALESCE(state, '') AS state,
			       COALESCE(wait_event_type, '') AS wait_event_type,
			       COALESCE(wait_event, '') AS wait_event,
			       COUNT(*) AS count
			FROM pg_stat_activity
			WHERE datname = current_database()
			GROUP BY state, wait_event_type, wait_event
			ORDER BY count DESC
			LIMIT 12
		`).Scan(&waitEvents).Error
		if err != nil {
			snapshot.WaitEventsError = err.Error()
		} else {
			snapshot.WaitEvents = waitEvents
		}
	}

	return snapshot
}
