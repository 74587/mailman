package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"mailman/internal/models"
	"mailman/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newSyncHandlerTestHandler(t *testing.T) (*SyncHandlers, *gorm.DB) {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.EmailAccountSyncConfig{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	accountRepo := repository.NewEmailAccountRepository(db)
	syncRepo := repository.NewSyncConfigRepository(db)
	return NewSyncHandlers(syncRepo, accountRepo, nil, nil), db
}

func createSyncTestAccount(t *testing.T, db *gorm.DB, orgID uint, email string) models.EmailAccount {
	t.Helper()

	account := models.EmailAccount{
		OrgID:        orgID,
		EmailAddress: email,
		AuthType:     models.AuthTypeOAuth2,
		IsVerified:   true,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}
	return account
}

func postBulkSyncConfig(t *testing.T, handler *SyncHandlers, payload map[string]interface{}) *httptest.ResponseRecorder {
	t.Helper()

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/sync/bulk-account-config", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.BulkApplyAccountSyncConfig(rec, req)
	return rec
}

func TestBulkApplyAccountSyncConfigIncludeStaysInCurrentOrg(t *testing.T) {
	handler, db := newSyncHandlerTestHandler(t)
	inOrg := createSyncTestAccount(t, db, defaultOrgID, "in-org@example.com")
	otherOrg := createSyncTestAccount(t, db, defaultOrgID+1, "other-org@example.com")

	rec := postBulkSyncConfig(t, handler, map[string]interface{}{
		"match_type":       "include",
		"account_ids":      []uint{inOrg.ID, otherOrg.ID},
		"enable_auto_sync": true,
		"sync_interval":    120,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if got := int(response["success_count"].(float64)); got != 1 {
		t.Fatalf("success_count = %d, want 1", got)
	}

	var configs []models.EmailAccountSyncConfig
	if err := db.Order("account_id ASC").Find(&configs).Error; err != nil {
		t.Fatalf("failed to load configs: %v", err)
	}
	if len(configs) != 1 || configs[0].AccountID != inOrg.ID || configs[0].SyncInterval != 120 {
		t.Fatalf("unexpected configs: %+v", configs)
	}
}

func TestBulkApplyAccountSyncConfigExcludeResolvesTargetsServerSide(t *testing.T) {
	handler, db := newSyncHandlerTestHandler(t)
	first := createSyncTestAccount(t, db, defaultOrgID, "first@example.com")
	excluded := createSyncTestAccount(t, db, defaultOrgID, "excluded@example.com")
	third := createSyncTestAccount(t, db, defaultOrgID, "third@example.com")
	otherOrg := createSyncTestAccount(t, db, defaultOrgID+1, "other-org@example.com")

	rec := postBulkSyncConfig(t, handler, map[string]interface{}{
		"match_type":       "exclude",
		"account_ids":      []uint{excluded.ID, otherOrg.ID},
		"enable_auto_sync": false,
		"sync_interval":    900,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if got := int(response["target_count"].(float64)); got != 2 {
		t.Fatalf("target_count = %d, want 2", got)
	}

	var configs []models.EmailAccountSyncConfig
	if err := db.Order("account_id ASC").Find(&configs).Error; err != nil {
		t.Fatalf("failed to load configs: %v", err)
	}
	if len(configs) != 2 {
		t.Fatalf("len(configs) = %d, want 2: %+v", len(configs), configs)
	}
	if configs[0].AccountID != first.ID || configs[1].AccountID != third.ID {
		t.Fatalf("unexpected account ids: %+v", configs)
	}
	for _, config := range configs {
		if config.AccountID == excluded.ID || config.AccountID == otherOrg.ID {
			t.Fatalf("excluded or other-org account was configured: %+v", config)
		}
		if config.EnableAutoSync || config.SyncInterval != 900 {
			t.Fatalf("unexpected config values: %+v", config)
		}
	}
}
