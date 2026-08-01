package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"github.com/gorilla/mux"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newOutlookProtocolDetectionHandler(t *testing.T, providerType models.MailProviderType, authType models.AuthType) (*APIHandler, *gorm.DB, models.EmailAccount) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.MailProvider{}, &models.EmailAccount{}); err != nil {
		t.Fatalf("migrate protocol detection test db: %v", err)
	}

	provider := models.MailProvider{
		Name:       fmt.Sprintf("protocol-test-%s", providerType),
		Type:       providerType,
		IMAPServer: "imap.example.com",
		IMAPPort:   993,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	account := models.EmailAccount{
		OrgID:          defaultOrgID,
		EmailAddress:   fmt.Sprintf("protocol-test-%s@example.com", providerType),
		AuthType:       authType,
		MailProviderID: &provider.ID,
		CustomSettings: models.JSONMap{
			"access_token":        "EwA-existing-exchange-token",
			"refresh_token":       "existing-refresh-token",
			"expires_at":          fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix()),
			"connection_protocol": "graph",
		},
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}

	accountRepo := repository.NewEmailAccountRepository(db)
	fetcher := services.NewFetcherService(accountRepo, nil, db)
	fetcher.SetOutlookIMAPProtocolProbe(func(context.Context, models.EmailAccount) error { return nil })
	return &APIHandler{
		Fetcher:          fetcher,
		EmailAccountRepo: accountRepo,
	}, db, account
}

func runOutlookProtocolDetectionRequest(t *testing.T, handler *APIHandler, accountID uint) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/accounts/%d/detect-outlook-protocol", accountID), nil)
	req = mux.SetURLVars(req, map[string]string{"id": fmt.Sprintf("%d", accountID)})
	rec := httptest.NewRecorder()
	handler.DetectOutlookProtocolHandler(rec, req)
	return rec
}

func TestDetectOutlookProtocolHandlerPersistsDetectedProtocol(t *testing.T) {
	handler, db, account := newOutlookProtocolDetectionHandler(t, models.ProviderTypeOutlook, models.AuthTypeOAuth2)
	rec := runOutlookProtocolDetectionRequest(t, handler, account.ID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var response DetectOutlookProtocolResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Status != "success" || response.Protocol != "imap" || !response.Changed || response.Method != "imap_xoauth2_probe" {
		t.Fatalf("unexpected response: %+v", response)
	}

	var persisted models.EmailAccount
	if err := db.First(&persisted, account.ID).Error; err != nil {
		t.Fatalf("reload account: %v", err)
	}
	if got := persisted.CustomSettings["connection_protocol"]; got != "imap" {
		t.Fatalf("persisted protocol = %q, want imap", got)
	}
	if got := persisted.CustomSettings["refresh_token"]; got != "existing-refresh-token" {
		t.Fatalf("refresh token = %q, want preserved value", got)
	}
}

func TestDetectOutlookProtocolHandlerRejectsUnsupportedAccount(t *testing.T) {
	handler, _, account := newOutlookProtocolDetectionHandler(t, models.ProviderTypeGmail, models.AuthTypeOAuth2)
	rec := runOutlookProtocolDetectionRequest(t, handler, account.ID)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}
