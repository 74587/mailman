package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"mailman/internal/database"
	"mailman/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestListFilterTemplatesSeedsBuiltins(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.FilterTemplate{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	previousDB := database.DB
	database.DB = db
	defer func() { database.DB = previousDB }()

	handler := &APIHandler{}
	req := httptest.NewRequest(http.MethodGet, "/api/filter-templates?pageSize=100", nil)
	rec := httptest.NewRecorder()

	handler.ListFilterTemplatesHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ListFilterTemplatesHandler status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response struct {
		Items []models.FilterTemplateListItem `json:"items"`
		Total int64                           `json:"total"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.Total < 6 || len(response.Items) < 6 {
		t.Fatalf("response contains %d/%d templates, want at least 6", len(response.Items), response.Total)
	}

	foundSecurity := false
	for _, item := range response.Items {
		if item.Name == "安全高风险邮件" {
			foundSecurity = item.IsBuiltin && item.Category == "security"
			break
		}
	}
	if !foundSecurity {
		t.Fatalf("seeded templates = %+v, want builtin security template", response.Items)
	}

	var countAfterFirstList int64
	if err := db.Model(&models.FilterTemplate{}).Where("is_builtin = ?", true).Count(&countAfterFirstList).Error; err != nil {
		t.Fatalf("failed to count builtins: %v", err)
	}

	secondReq := httptest.NewRequest(http.MethodGet, "/api/filter-templates?pageSize=100", nil)
	secondRec := httptest.NewRecorder()
	handler.ListFilterTemplatesHandler(secondRec, secondReq)
	if secondRec.Code != http.StatusOK {
		t.Fatalf("second ListFilterTemplatesHandler status = %d, body = %s", secondRec.Code, secondRec.Body.String())
	}

	var countAfterSecondList int64
	if err := db.Model(&models.FilterTemplate{}).Where("is_builtin = ?", true).Count(&countAfterSecondList).Error; err != nil {
		t.Fatalf("failed to count builtins after second list: %v", err)
	}
	if countAfterSecondList != countAfterFirstList {
		t.Fatalf("builtin count changed from %d to %d after second list", countAfterFirstList, countAfterSecondList)
	}
}
