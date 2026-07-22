package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"

	"github.com/gorilla/mux"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newSyncRepairValidationHandler(t *testing.T, orgID uint) (*APIHandler, models.EmailAccount) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.MailProvider{}, &models.EmailAccount{}); err != nil {
		t.Fatalf("migrate repair test db: %v", err)
	}

	provider := models.MailProvider{Name: "Gmail", Type: models.ProviderTypeGmail}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("create provider: %v", err)
	}
	account := models.EmailAccount{
		OrgID:          orgID,
		EmailAddress:   "repair-test@gmail.com",
		AuthType:       models.AuthTypeOAuth2,
		MailProviderID: &provider.ID,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}

	return &APIHandler{EmailAccountRepo: repository.NewEmailAccountRepository(db)}, account
}

func runSyncRepairValidationRequest(t *testing.T, handler *APIHandler, accountID uint, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/accounts/%d/repair-sync", accountID), strings.NewReader(body))
	req = mux.SetURLVars(req, map[string]string{"id": fmt.Sprintf("%d", accountID)})
	rec := httptest.NewRecorder()
	handler.RepairAccountSyncHandler(rec, req)
	return rec
}

func TestRepairAccountSyncRejectsUnsafeInput(t *testing.T) {
	handler, account := newSyncRepairValidationHandler(t, defaultOrgID)
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)

	tests := []struct {
		name string
		body string
	}{
		{name: "future start date", body: fmt.Sprintf(`{"default_start_date":%q}`, future)},
		{name: "oversized message limit", body: `{"max_emails_per_mailbox":1001}`},
		{name: "unknown field", body: `{"force":true}`},
		{name: "multiple objects", body: `{} {}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := runSyncRepairValidationRequest(t, handler, account.ID, tt.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}

func TestRepairAccountSyncRejectsOtherOrganization(t *testing.T) {
	handler, account := newSyncRepairValidationHandler(t, defaultOrgID+1)
	rec := runSyncRepairValidationRequest(t, handler, account.ID, `{}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
}
