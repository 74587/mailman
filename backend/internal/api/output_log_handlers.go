package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"mailman/internal/repository"
	"mailman/internal/services"
)

type OutputLogHandler struct {
	service    *services.OutputLogService
	configRepo *repository.SystemConfigRepository
}

func NewOutputLogHandler(service *services.OutputLogService, configRepo *repository.SystemConfigRepository) *OutputLogHandler {
	return &OutputLogHandler{service: service, configRepo: configRepo}
}

func (h *OutputLogHandler) ListLogs(w http.ResponseWriter, r *http.Request) {
	filter := parseOutputLogFilter(r)
	items := h.service.Query(filter)
	RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"items": items,
		"limit": filter.Limit,
	})
}

func (h *OutputLogHandler) ListModules(w http.ResponseWriter, r *http.Request) {
	RespondWithJSON(w, http.StatusOK, map[string]interface{}{
		"modules": h.service.Modules(),
	})
}

func (h *OutputLogHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	config := h.service.Config()
	if h.configRepo != nil {
		config = services.LoadOutputLogConfig(h.configRepo)
		config = h.service.ApplyConfig(config)
	}
	RespondWithJSON(w, http.StatusOK, config)
}

func (h *OutputLogHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var config services.OutputLogConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		RespondWithError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	config = services.NormalizeOutputLogConfig(config)
	if h.configRepo == nil {
		RespondWithError(w, http.StatusInternalServerError, "config repository is not configured")
		return
	}
	if err := h.configRepo.UpdateValue(services.OutputLogSettingsKey, config); err != nil {
		RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.service.ApplyConfig(config)
	RespondWithJSON(w, http.StatusOK, config)
}

func (h *OutputLogHandler) StreamLogs(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming is not supported", http.StatusInternalServerError)
		return
	}

	filter := parseOutputLogFilter(r)
	ch, cancel, err := h.service.Subscribe(filter)
	if err != nil {
		if err == services.ErrOutputLogSubscriberLimit {
			RespondWithError(w, http.StatusTooManyRequests, err.Error())
			return
		}
		if err == services.ErrOutputLogServiceClosed {
			RespondWithError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer cancel()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	if sinceID := filter.SinceID; sinceID > 0 && h.service.StreamBackfillLimit() > 0 {
		historyFilter := filter
		historyFilter.Limit = h.service.StreamBackfillLimit()
		for _, entry := range h.service.Query(historyFilter) {
			writeSSE(w, "log", entry)
		}
		flusher.Flush()
	}

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case entry, ok := <-ch:
			if !ok {
				return
			}
			writeSSE(w, "log", entry)
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		}
	}
}

func parseOutputLogFilter(r *http.Request) services.OutputLogFilter {
	q := r.URL.Query()
	filter := services.OutputLogFilter{
		Query:  q.Get("q"),
		Level:  q.Get("level"),
		Module: q.Get("module"),
		Source: q.Get("source"),
		Limit:  parseIntDefault(q.Get("limit"), 300),
	}
	if sinceID, err := strconv.ParseUint(q.Get("since_id"), 10, 64); err == nil {
		filter.SinceID = sinceID
	}
	if from := parseQueryTime(q.Get("from")); from != nil {
		filter.From = from
	}
	if to := parseQueryTime(q.Get("to")); to != nil {
		filter.To = to
	}
	return filter
}

func writeSSE(w http.ResponseWriter, event string, payload interface{}) {
	bytes, _ := json.Marshal(payload)
	fmt.Fprintf(w, "event: %s\n", event)
	fmt.Fprintf(w, "data: %s\n\n", string(bytes))
}

func parseQueryTime(value string) *time.Time {
	if value == "" {
		return nil
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return &parsed
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return &parsed
	}
	return nil
}

func parseIntDefault(value string, fallback int) int {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
