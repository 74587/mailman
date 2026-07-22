package repository

import (
	"errors"
	"mailman/internal/models"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEmailShareLinksAreOrganizationScopedAndExpire(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:email-share-repo?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.Email{}, &models.Attachment{}, &models.EmailShareLink{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	firstAccount := models.EmailAccount{OrgID: 1, EmailAddress: "first@example.com", AuthType: models.AuthTypePassword}
	secondAccount := models.EmailAccount{OrgID: 2, EmailAddress: "second@example.com", AuthType: models.AuthTypePassword}
	if err := db.Create(&firstAccount).Error; err != nil {
		t.Fatalf("create first account: %v", err)
	}
	if err := db.Create(&secondAccount).Error; err != nil {
		t.Fatalf("create second account: %v", err)
	}
	email := models.Email{AccountID: firstAccount.ID, Subject: "shared", Direction: models.EmailDirectionSent}
	if err := db.Create(&email).Error; err != nil {
		t.Fatalf("create email: %v", err)
	}

	repo := NewEmailRepository(db)
	now := time.Now().UTC()
	link := models.EmailShareLink{OrgID: 1, EmailID: email.ID, TokenHash: "valid-hash", ExpiresAt: now.Add(time.Hour)}
	if err := repo.CreateShareLink(&link); err != nil {
		t.Fatalf("create link: %v", err)
	}

	resolvedLink, resolvedEmail, err := repo.ResolveShareLink(1, "valid-hash", now)
	if err != nil {
		t.Fatalf("resolve link: %v", err)
	}
	if resolvedLink.ID != link.ID || resolvedEmail.ID != email.ID || resolvedEmail.Direction != models.EmailDirectionSent {
		t.Fatalf("unexpected resolved target link=%+v email=%+v", resolvedLink, resolvedEmail)
	}
	if _, _, err := repo.ResolveShareLink(2, "valid-hash", now); !errors.Is(err, ErrEmailShareLinkUnavailable) {
		t.Fatalf("cross-org resolve error=%v", err)
	}
	if _, _, err := repo.ResolveShareLink(1, "valid-hash", now.Add(2*time.Hour)); !errors.Is(err, ErrEmailShareLinkUnavailable) {
		t.Fatalf("expired resolve error=%v", err)
	}

	revokedAt := now
	if err := db.Model(&link).Update("revoked_at", revokedAt).Error; err != nil {
		t.Fatalf("revoke link: %v", err)
	}
	if _, _, err := repo.ResolveShareLink(1, "valid-hash", now); !errors.Is(err, ErrEmailShareLinkUnavailable) {
		t.Fatalf("revoked resolve error=%v", err)
	}
	if _, err := repo.GetByIDForOrg(2, email.ID); err == nil {
		t.Fatal("cross-org email lookup unexpectedly succeeded")
	}

	activeLink := models.EmailShareLink{OrgID: 1, EmailID: email.ID, TokenHash: "soft-delete-hash", ExpiresAt: now.Add(time.Hour)}
	if err := repo.CreateShareLink(&activeLink); err != nil {
		t.Fatalf("create soft-delete link: %v", err)
	}
	deletedAt := models.DeletedAt{Time: now, Valid: true}
	if err := db.Model(&firstAccount).Update("deleted_at", deletedAt).Error; err != nil {
		t.Fatalf("soft delete owning account: %v", err)
	}
	if _, _, err := repo.ResolveShareLink(1, "soft-delete-hash", now); !errors.Is(err, ErrEmailShareLinkUnavailable) {
		t.Fatalf("soft-deleted account resolve error=%v", err)
	}
}
