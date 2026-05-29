package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"mailman/internal/models"
	"mailman/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestOrgMiddlewareSuperAdminFallsBackToFirstActiveOrg(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.Organization{}, &models.OrgMember{}, &models.Role{}, &models.Permission{}, &models.RolePermission{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	org := models.Organization{Name: "Default", Slug: "default", IsActive: true}
	if err := db.Create(&org).Error; err != nil {
		t.Fatalf("failed to create organization: %v", err)
	}

	user := &models.User{ID: 99, Username: "root", IsSuperAdmin: true}
	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		if got := GetCurrentOrgID(r); got != org.ID {
			t.Fatalf("GetCurrentOrgID = %d, want %d", got, org.ID)
		}
	})

	req := httptest.NewRequest(http.MethodGet, "/api/proxy-groups", nil)
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, user))
	rec := httptest.NewRecorder()

	middleware := OrgMiddleware(
		repository.NewOrganizationRepository(db),
		repository.NewOrgMemberRepository(db),
		repository.NewRoleRepository(db),
	)
	middleware(next).ServeHTTP(rec, req)

	if !nextCalled {
		t.Fatal("next handler was not called")
	}
}
