package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestBusinessLogAuditMiddlewareCapturesHTTPExchange(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:business_log_audit?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.BusinessLog{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	pipeline := services.NewBusinessLogPipeline(
		services.NewBusinessLogRecorder(repository.NewBusinessLogRepository(db)),
		nil,
	)

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("handler failed to read body: %v", err)
		}
		if got := string(body); got != `{"token":"secret","name":"demo"}` {
			t.Fatalf("handler body = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Response-ID", "resp-1")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	req := httptest.NewRequest(http.MethodPost, "/api/widgets/42?dry_run=true", strings.NewReader(`{"token":"secret","name":"demo"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer secret")
	req.Header.Set("X-Request-ID", "req-1")
	rec := httptest.NewRecorder()

	BusinessLogAuditMiddleware(pipeline)(next).ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var saved models.BusinessLog
	waitForBusinessLog(t, db, &saved)
	if saved.Module != "api" || saved.Action != "post" || saved.RequestID != "req-1" {
		t.Fatalf("unexpected log routing fields: module=%s action=%s request_id=%s", saved.Module, saved.Action, saved.RequestID)
	}

	httpDetails, ok := saved.Details["http"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing http details: %#v", saved.Details["http"])
	}
	requestDetails, ok := httpDetails["request"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing request details: %#v", httpDetails["request"])
	}
	responseDetails, ok := httpDetails["response"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing response details: %#v", httpDetails["response"])
	}

	if got := requestDetails["url"]; got != "http://example.com/api/widgets/42?dry_run=true" {
		t.Fatalf("request url = %#v", got)
	}
	requestBody, ok := requestDetails["body"].(map[string]interface{})
	if !ok {
		t.Fatalf("request body was not stored as structured JSON: %#v", requestDetails["body"])
	}
	if got := requestBody["token"]; got != "[REDACTED]" {
		t.Fatalf("token was not redacted: %#v", got)
	}
	if got := requestBody["name"]; got != "demo" {
		t.Fatalf("name = %#v", got)
	}

	requestHeaders, ok := requestDetails["headers"].(map[string]interface{})
	if !ok {
		t.Fatalf("missing request headers: %#v", requestDetails["headers"])
	}
	if got := requestHeaders["Authorization"]; got != "[REDACTED]" {
		t.Fatalf("authorization header was not redacted: %#v", got)
	}

	if got := responseDetails["status_code"]; got != float64(http.StatusCreated) {
		t.Fatalf("response status = %#v", got)
	}
	responseBody, ok := responseDetails["body"].(map[string]interface{})
	if !ok || responseBody["ok"] != true {
		t.Fatalf("response body = %#v", responseDetails["body"])
	}
}

func waitForBusinessLog(t *testing.T, db *gorm.DB, out *models.BusinessLog) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		if err := db.First(out).Error; err != nil {
			lastErr = err
			time.Sleep(10 * time.Millisecond)
			continue
		}
		return
	}
	t.Fatalf("failed to load business log: %v", lastErr)
}
