package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"mailman/internal/models"
	"mailman/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newAccountHandlerTestHandler(t *testing.T) (*APIHandler, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.MailProvider{}, &models.EmailAccount{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}
	return &APIHandler{EmailAccountRepo: repository.NewEmailAccountRepository(db)}, db
}

func TestAccountExistsHandler(t *testing.T) {
	handler, db := newAccountHandlerTestHandler(t)
	provider := models.MailProvider{
		Name:       "Gmail",
		Type:       models.ProviderTypeGmail,
		IMAPServer: "imap.gmail.com",
		IMAPPort:   993,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}
	account := models.EmailAccount{
		OrgID:          defaultOrgID,
		EmailAddress:   "user@gmail.com",
		AuthType:       models.AuthTypeOAuth2,
		MailProviderID: &provider.ID,
		IsVerified:     true,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/accounts/exists?email=USER@gmail.com", nil)
	rec := httptest.NewRecorder()
	handler.AccountExistsHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response AccountExistsResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !response.Exists || response.AccountID != account.ID || response.Account == nil || response.EmailAddress != "user@gmail.com" {
		t.Fatalf("unexpected exists response: %+v", response)
	}
}

func TestAccountExistsHandlerMissingAccount(t *testing.T) {
	handler, _ := newAccountHandlerTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/accounts/exists?email=missing@gmail.com", nil)
	rec := httptest.NewRecorder()
	handler.AccountExistsHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response AccountExistsResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.Exists || response.AccountID != 0 || response.Account != nil || response.EmailAddress != "missing@gmail.com" {
		t.Fatalf("unexpected missing response: %+v", response)
	}
}

func TestAccountExistsHandlerRequiresEmail(t *testing.T) {
	handler, _ := newAccountHandlerTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/accounts/exists", nil)
	rec := httptest.NewRecorder()
	handler.AccountExistsHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestAccountExistsHandlerRejectsOtherOrg(t *testing.T) {
	handler, db := newAccountHandlerTestHandler(t)
	account := models.EmailAccount{
		OrgID:        defaultOrgID + 1,
		EmailAddress: "other-org@gmail.com",
		AuthType:     models.AuthTypeOAuth2,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/accounts/exists?email=other-org@gmail.com", nil)
	rec := httptest.NewRecorder()
	handler.AccountExistsHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
}
