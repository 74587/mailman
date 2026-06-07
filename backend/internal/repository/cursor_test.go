package repository

import (
	"mailman/internal/models"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newCursorTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite db: %v", err)
	}
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.Email{}); err != nil {
		t.Fatalf("failed to migrate sqlite db: %v", err)
	}
	return db
}

func TestAccountKeysetPaginationIgnoresInsertBeforeCursor(t *testing.T) {
	db := newCursorTestDB(t)
	repo := NewEmailAccountRepository(db)

	accounts := []models.EmailAccount{
		{OrgID: 1, EmailAddress: "a@example.com", AuthType: models.AuthTypePassword},
		{OrgID: 1, EmailAddress: "b@example.com", AuthType: models.AuthTypePassword},
		{OrgID: 1, EmailAddress: "c@example.com", AuthType: models.AuthTypePassword},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create accounts: %v", err)
	}

	firstPage, _, hasMore, err := repo.GetAllPaginatedFilteredKeyset(
		1,
		2,
		"email_address",
		"asc",
		AccountFilterParams{},
		KeysetPagination{Enabled: true},
	)
	if err != nil {
		t.Fatalf("first page failed: %v", err)
	}
	if !hasMore || len(firstPage) != 2 || firstPage[1].EmailAddress != "b@example.com" {
		t.Fatalf("unexpected first page: hasMore=%v accounts=%v", hasMore, firstPage)
	}

	if err := db.Create(&models.EmailAccount{OrgID: 1, EmailAddress: "aa@example.com", AuthType: models.AuthTypePassword}).Error; err != nil {
		t.Fatalf("failed to insert account before cursor: %v", err)
	}

	secondPage, _, _, err := repo.GetAllPaginatedFilteredKeyset(
		1,
		2,
		"email_address",
		"asc",
		AccountFilterParams{},
		KeysetPagination{Enabled: true, After: &KeysetCursor{
			Value: AccountCursorValue(firstPage[1], "email_address"),
			ID:    firstPage[1].ID,
		}},
	)
	if err != nil {
		t.Fatalf("second page failed: %v", err)
	}
	if len(secondPage) != 1 || secondPage[0].EmailAddress != "c@example.com" {
		t.Fatalf("unexpected second page after insert before cursor: %v", secondPage)
	}
}

func TestEmailKeysetPaginationIgnoresNewerInsert(t *testing.T) {
	db := newCursorTestDB(t)
	repo := NewEmailRepository(db)
	base := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)

	emails := []models.Email{
		{AccountID: 1, Subject: "newest", Date: base.Add(3 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "middle", Date: base.Add(2 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "oldest", Date: base.Add(time.Minute), Direction: models.EmailDirectionReceived},
	}
	if err := db.Create(&emails).Error; err != nil {
		t.Fatalf("failed to create emails: %v", err)
	}

	firstPage, _, err := repo.SearchEmails(EmailSearchOptions{
		AccountID:  1,
		Limit:      2,
		SortBy:     "date DESC",
		Pagination: KeysetPagination{Enabled: true},
	})
	if err != nil {
		t.Fatalf("first page failed: %v", err)
	}
	if len(firstPage) != 3 || firstPage[1].Subject != "middle" {
		t.Fatalf("unexpected first page with lookahead: %v", firstPage)
	}
	firstPage = firstPage[:2]

	if err := db.Create(&models.Email{
		AccountID: 1,
		Subject:   "inserted-newer",
		Date:      base.Add(4 * time.Minute),
		Direction: models.EmailDirectionReceived,
	}).Error; err != nil {
		t.Fatalf("failed to insert newer email: %v", err)
	}

	secondPage, _, err := repo.SearchEmails(EmailSearchOptions{
		AccountID: 1,
		Limit:     2,
		SortBy:    "date DESC",
		Pagination: KeysetPagination{Enabled: true, After: &KeysetCursor{
			Value: EmailCursorValue(firstPage[1], "date DESC"),
			ID:    firstPage[1].ID,
		}},
	})
	if err != nil {
		t.Fatalf("second page failed: %v", err)
	}
	if len(secondPage) != 1 || secondPage[0].Subject != "oldest" {
		t.Fatalf("unexpected second page after newer insert: %v", secondPage)
	}
}

func TestEmailAnchorWindowReturnsNaturalPage(t *testing.T) {
	db := newCursorTestDB(t)
	repo := NewEmailRepository(db)
	base := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)

	emails := []models.Email{
		{AccountID: 1, Subject: "very-new", Date: base.Add(7 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "newer-2", Date: base.Add(6 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "newer-1", Date: base.Add(5 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "anchor", Date: base.Add(4 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "older-1", Date: base.Add(3 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "older-2", Date: base.Add(2 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "very-old", Date: base.Add(time.Minute), Direction: models.EmailDirectionReceived},
	}
	if err := db.Create(&emails).Error; err != nil {
		t.Fatalf("failed to create emails: %v", err)
	}

	window, err := repo.SearchEmailsAroundAnchor(EmailSearchOptions{
		AccountID: 1,
		AnchorID:  emails[3].ID,
		Limit:     5,
		SortBy:    "date DESC",
	})
	if err != nil {
		t.Fatalf("anchor page failed: %v", err)
	}
	page := window.Emails
	total := window.TotalCount
	if total != int64(len(emails)) {
		t.Fatalf("total = %d, want %d", total, len(emails))
	}
	if !window.HasPrev || !window.HasNext {
		t.Fatalf("hasPrev=%v hasNext=%v, want both true", window.HasPrev, window.HasNext)
	}
	if window.AnchorIndex != 4 {
		t.Fatalf("anchor index = %d, want 4", window.AnchorIndex)
	}
	if window.WindowStartIndex != 2 || window.WindowEndIndex != 6 {
		t.Fatalf("window indexes = %d..%d, want 2..6", window.WindowStartIndex, window.WindowEndIndex)
	}

	subjects := make([]string, 0, len(page))
	for _, email := range page {
		subjects = append(subjects, email.Subject)
	}
	want := []string{"newer-2", "newer-1", "anchor", "older-1", "older-2"}
	for i := range want {
		if subjects[i] != want[i] {
			t.Fatalf("subjects = %v, want %v", subjects, want)
		}
	}
}

func TestEmailAnchorWindowNextCursorIgnoresNewerInsert(t *testing.T) {
	db := newCursorTestDB(t)
	repo := NewEmailRepository(db)
	base := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)

	emails := []models.Email{
		{AccountID: 1, Subject: "very-new", Date: base.Add(7 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "newer-2", Date: base.Add(6 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "newer-1", Date: base.Add(5 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "anchor", Date: base.Add(4 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "older-1", Date: base.Add(3 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "older-2", Date: base.Add(2 * time.Minute), Direction: models.EmailDirectionReceived},
		{AccountID: 1, Subject: "very-old", Date: base.Add(time.Minute), Direction: models.EmailDirectionReceived},
	}
	if err := db.Create(&emails).Error; err != nil {
		t.Fatalf("failed to create emails: %v", err)
	}

	window, err := repo.SearchEmailsAroundAnchor(EmailSearchOptions{
		AccountID: 1,
		AnchorID:  emails[3].ID,
		Limit:     5,
		SortBy:    "date DESC",
	})
	if err != nil {
		t.Fatalf("anchor page failed: %v", err)
	}
	page := window.Emails
	last := page[len(page)-1]

	if err := db.Create(&models.Email{
		AccountID: 1,
		Subject:   "inserted-newer",
		Date:      base.Add(8 * time.Minute),
		Direction: models.EmailDirectionReceived,
	}).Error; err != nil {
		t.Fatalf("failed to insert newer email: %v", err)
	}

	nextPage, _, err := repo.SearchEmails(EmailSearchOptions{
		AccountID: 1,
		Limit:     5,
		SortBy:    "date DESC",
		Pagination: KeysetPagination{Enabled: true, After: &KeysetCursor{
			Value: EmailCursorValue(last, "date DESC"),
			ID:    last.ID,
		}},
	})
	if err != nil {
		t.Fatalf("next page failed: %v", err)
	}
	if len(nextPage) != 1 || nextPage[0].Subject != "very-old" {
		t.Fatalf("unexpected next page after newer insert: %v", nextPage)
	}
}
