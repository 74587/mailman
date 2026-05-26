package services

import (
	"context"
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEmailIngestServiceStoresOnceAndPublishesSideEffects(t *testing.T) {
	db := mustOpenIngestTestDB(t)
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.Email{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "inbox@example.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	eventBus := NewEventBus()
	events := make(chan EmailEvent, 2)
	eventBus.Subscribe(EventTypeNewEmail, func(event EmailEvent) {
		events <- event
	})

	subscriptionManager := NewSubscriptionManager()
	defer subscriptionManager.Shutdown()
	delivered := make(chan models.Email, 2)
	_, err := subscriptionManager.Subscribe(SubscribeRequest{
		Type:          SubscriptionTypeRealtime,
		Priority:      PriorityNormal,
		Filter:        EmailFilter{},
		Context:       context.Background(),
		ChannelBuffer: 1,
		Callback: func(email models.Email) error {
			delivered <- email
			return nil
		},
	})
	if err != nil {
		t.Fatalf("failed to subscribe: %v", err)
	}

	ingester := NewEmailIngestService(
		repository.NewEmailRepository(db),
		repository.NewEmailAccountRepository(db),
		nil,
		eventBus,
		subscriptionManager,
	)

	email := models.Email{
		MessageID:   "<msg-1@example.com>",
		AccountID:   account.ID,
		Subject:     "Hello",
		From:        models.StringSlice{"sender@example.com"},
		To:          models.StringSlice{"inbox@example.com"},
		Date:        time.Now(),
		ReceivedAt:  time.Now(),
		MailboxName: "INBOX",
	}

	newEmails, err := ingester.IngestEmails([]models.Email{email}, EmailIngestOptions{
		Source:       EmailIngestSourcePickup,
		AccountEmail: account.EmailAddress,
	})
	if err != nil {
		t.Fatalf("unexpected ingest error: %v", err)
	}
	if len(newEmails) != 1 {
		t.Fatalf("new emails = %d, want 1", len(newEmails))
	}
	if newEmails[0].ID == 0 {
		t.Fatal("saved email ID was not populated")
	}

	select {
	case event := <-events:
		if event.Source != string(EmailIngestSourcePickup) {
			t.Fatalf("event source = %q, want %q", event.Source, EmailIngestSourcePickup)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for EventBus publication")
	}

	select {
	case received := <-delivered:
		if received.ID != newEmails[0].ID {
			t.Fatalf("delivered email ID = %d, want %d", received.ID, newEmails[0].ID)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for subscription dispatch")
	}

	duplicates, err := ingester.IngestEmails([]models.Email{email}, EmailIngestOptions{
		Source:       EmailIngestSourcePickup,
		AccountEmail: account.EmailAddress,
	})
	if err != nil {
		t.Fatalf("unexpected duplicate ingest error: %v", err)
	}
	if len(duplicates) != 0 {
		t.Fatalf("duplicate ingest saved %d emails, want 0", len(duplicates))
	}

	var count int64
	if err := db.Model(&models.Email{}).Count(&count).Error; err != nil {
		t.Fatalf("failed to count emails: %v", err)
	}
	if count != 1 {
		t.Fatalf("stored email count = %d, want 1", count)
	}
}

func mustOpenIngestTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	return db
}
