package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProxyMetadataHandlersUseDefaultOrgWhenContextMissing(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyGroup{}, &models.ProxyTag{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))

	createGroupReq := httptest.NewRequest(http.MethodPost, "/api/proxy-groups", bytes.NewBufferString(`{"name":"默认","color":"#64748b"}`))
	createGroupRec := httptest.NewRecorder()
	handler.CreateGroup(createGroupRec, createGroupReq)
	if createGroupRec.Code != http.StatusCreated {
		t.Fatalf("CreateGroup status = %d, body = %s", createGroupRec.Code, createGroupRec.Body.String())
	}

	var createdGroup models.ProxyGroup
	if err := json.NewDecoder(createGroupRec.Body).Decode(&createdGroup); err != nil {
		t.Fatalf("failed to decode created group: %v", err)
	}
	if createdGroup.OrgID != defaultOrgID {
		t.Fatalf("created group orgID = %d, want %d", createdGroup.OrgID, defaultOrgID)
	}

	listGroupReq := httptest.NewRequest(http.MethodGet, "/api/proxy-groups", nil)
	listGroupRec := httptest.NewRecorder()
	handler.ListGroups(listGroupRec, listGroupReq)
	if listGroupRec.Code != http.StatusOK {
		t.Fatalf("ListGroups status = %d, body = %s", listGroupRec.Code, listGroupRec.Body.String())
	}

	var groups []models.ProxyGroup
	if err := json.NewDecoder(listGroupRec.Body).Decode(&groups); err != nil {
		t.Fatalf("failed to decode groups: %v", err)
	}
	if len(groups) != 1 || groups[0].ID != createdGroup.ID {
		t.Fatalf("groups = %+v, want created group", groups)
	}

	createTagReq := httptest.NewRequest(http.MethodPost, "/api/proxy-tags", bytes.NewBufferString(`{"name":"测试","color":"#10b981"}`))
	createTagRec := httptest.NewRecorder()
	handler.CreateTag(createTagRec, createTagReq)
	if createTagRec.Code != http.StatusCreated {
		t.Fatalf("CreateTag status = %d, body = %s", createTagRec.Code, createTagRec.Body.String())
	}

	var createdTag models.ProxyTag
	if err := json.NewDecoder(createTagRec.Body).Decode(&createdTag); err != nil {
		t.Fatalf("failed to decode created tag: %v", err)
	}
	if createdTag.OrgID != defaultOrgID {
		t.Fatalf("created tag orgID = %d, want %d", createdTag.OrgID, defaultOrgID)
	}

	listTagReq := httptest.NewRequest(http.MethodGet, "/api/proxy-tags", nil)
	listTagRec := httptest.NewRecorder()
	handler.ListTags(listTagRec, listTagReq)
	if listTagRec.Code != http.StatusOK {
		t.Fatalf("ListTags status = %d, body = %s", listTagRec.Code, listTagRec.Body.String())
	}

	var tags []models.ProxyTag
	if err := json.NewDecoder(listTagRec.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode tags: %v", err)
	}
	if len(tags) != 1 || tags[0].ID != createdTag.ID {
		t.Fatalf("tags = %+v, want created tag", tags)
	}
}

func TestProxyPoolBatchDeleteUsesAllMatchingIDs(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}, &models.ProxyPoolItemTag{}, &models.EmailAccount{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	for i := 0; i < 520; i++ {
		item := models.ProxyPoolItem{
			OrgID:  1,
			Type:   models.ProxyTypeSocks5,
			Host:   fmt.Sprintf("10.10.%d.%d", i/255, i%255),
			Port:   10000 + i,
			Status: models.ProxyStatusUnknown,
		}
		if err := db.Create(&item).Error; err != nil {
			t.Fatalf("failed to create proxy %d: %v", i, err)
		}
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/proxy-pool/batch", bytes.NewBufferString(`{"filter":{"status":"unknown"},"replacement":{"mode":"clear"}}`))
	rec := httptest.NewRecorder()
	handler.BatchDelete(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("BatchDelete status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response struct {
		Deleted int `json:"deleted"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.Deleted != 520 {
		t.Fatalf("deleted = %d, want 520", response.Deleted)
	}

	var remaining int64
	if err := db.Model(&models.ProxyPoolItem{}).Count(&remaining).Error; err != nil {
		t.Fatalf("failed to count remaining proxies: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("remaining proxies = %d, want 0", remaining)
	}
}

func TestProxyPoolBulkImportCanSkipDuplicates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}, &models.ProxyPoolItemTag{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	body := `{"defaultType":"socks5","duplicatePolicy":"skip","content":"192.168.0.1:8000\n192.168.0.1:8000"}`
	req := httptest.NewRequest(http.MethodPost, "/api/proxy-pool/bulk-import", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	handler.BulkImport(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("BulkImport status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response proxyBulkImportResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(response.Created) != 1 || len(response.Errors) != 0 || response.Summary["skipped"].(float64) != 1 {
		t.Fatalf("created=%d errors=%d summary=%v, want created=1 errors=0 skipped=1", len(response.Created), len(response.Errors), response.Summary)
	}
}
