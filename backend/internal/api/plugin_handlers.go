package api

import (
	"encoding/json"
	"net/http"

	"mailman/internal/triggerv2/plugins/builtin"
)

// ListPluginsHandler handles the request to list all available plugins.
func (h *APIHandler) ListPluginsHandler(w http.ResponseWriter, r *http.Request) {
	pluginInfos, err := h.pluginManager.ListPlugins()
	if err != nil {
		http.Error(w, "Failed to list plugins", http.StatusInternalServerError)
		return
	}

	pluginContext := r.URL.Query().Get("context")
	if pluginContext != "" {
		filtered := pluginInfos[:0]
		for _, info := range pluginInfos {
			if builtin.IsPluginAllowedInContext(info, pluginContext) {
				filtered = append(filtered, info)
			}
		}
		pluginInfos = filtered
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(pluginInfos); err != nil {
		http.Error(w, "Failed to encode plugins to JSON", http.StatusInternalServerError)
	}
}
