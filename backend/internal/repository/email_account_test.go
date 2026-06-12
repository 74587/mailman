package repository

import (
	"testing"

	"mailman/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newEmailAccountRoutingTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite db: %v", err)
	}
	if err := db.AutoMigrate(&models.MailProvider{}, &models.EmailAccount{}, &models.EmailRoutingAddress{}); err != nil {
		t.Fatalf("failed to migrate sqlite db: %v", err)
	}
	return db
}

func TestEmailAccountRepositoryForwardedRoutesUseIndexedProjection(t *testing.T) {
	db := newEmailAccountRoutingTestDB(t)
	repo := NewEmailAccountRepository(db)

	account := models.EmailAccount{
		OrgID:              1,
		EmailAddress:       "inbox@example.com",
		AuthType:           models.AuthTypePassword,
		ForwardedAddresses: models.StringSlice{"Source@External.com", "*@Forwarded.Test"},
	}
	if err := repo.Create(&account); err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	var routeCount int64
	if err := db.Model(&models.EmailRoutingAddress{}).Count(&routeCount).Error; err != nil {
		t.Fatalf("failed to count routes: %v", err)
	}
	if routeCount != 2 {
		t.Fatalf("route count = %d, want 2", routeCount)
	}

	tests := []struct {
		name  string
		query string
	}{
		{name: "exact forwarded address", query: "source@external.com"},
		{name: "wildcard forwarded domain", query: "anything@forwarded.test"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := repo.GetByForwardedAddress(tt.query)
			if err != nil {
				t.Fatalf("GetByForwardedAddress(%q) failed: %v", tt.query, err)
			}
			if got.ID != account.ID {
				t.Fatalf("account ID = %d, want %d", got.ID, account.ID)
			}
		})
	}
}

func TestEmailAccountRepositoryUpdateReplacesForwardedRoutes(t *testing.T) {
	db := newEmailAccountRoutingTestDB(t)
	repo := NewEmailAccountRepository(db)

	account := models.EmailAccount{
		OrgID:              1,
		EmailAddress:       "inbox@example.com",
		AuthType:           models.AuthTypePassword,
		ForwardedAddresses: models.StringSlice{"old@example.com"},
	}
	if err := repo.Create(&account); err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	account.ForwardedAddresses = models.StringSlice{"new@example.com"}
	if err := repo.Update(&account); err != nil {
		t.Fatalf("failed to update account: %v", err)
	}

	if _, err := repo.GetByForwardedAddress("old@example.com"); err == nil {
		t.Fatal("old forwarded address still resolved after update")
	}

	got, err := repo.GetByForwardedAddress("new@example.com")
	if err != nil {
		t.Fatalf("new forwarded address did not resolve: %v", err)
	}
	if got.ID != account.ID {
		t.Fatalf("account ID = %d, want %d", got.ID, account.ID)
	}
}

func TestEmailAccountRepositoryBackfillsForwardedRoutes(t *testing.T) {
	db := newEmailAccountRoutingTestDB(t)
	repo := NewEmailAccountRepository(db)

	account := models.EmailAccount{
		OrgID:              1,
		EmailAddress:       "legacy@example.com",
		AuthType:           models.AuthTypePassword,
		ForwardedAddresses: models.StringSlice{"legacy@external.com", "*@legacy.test"},
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create legacy account: %v", err)
	}

	if _, err := repo.GetByForwardedAddress("legacy@external.com"); err == nil {
		t.Fatal("legacy forwarded address resolved before backfill")
	}

	if err := repo.BackfillEmailRoutingAddresses(); err != nil {
		t.Fatalf("backfill failed: %v", err)
	}

	for _, query := range []string{"legacy@external.com", "anything@legacy.test"} {
		got, err := repo.GetByForwardedAddress(query)
		if err != nil {
			t.Fatalf("GetByForwardedAddress(%q) failed after backfill: %v", query, err)
		}
		if got.ID != account.ID {
			t.Fatalf("account ID = %d, want %d", got.ID, account.ID)
		}
	}
}
