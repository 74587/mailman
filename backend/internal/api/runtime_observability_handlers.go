package api

import (
	"encoding/json"
	"net/http"

	"mailman/internal/services"
)

// GetRuntimeObservabilityHandler returns the in-memory runtime observability snapshot.
func (h *APIHandler) GetRuntimeObservabilityHandler(w http.ResponseWriter, r *http.Request) {
	snapshot := services.GetRuntimeObservabilitySnapshot()
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
