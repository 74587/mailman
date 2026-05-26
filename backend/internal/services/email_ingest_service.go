package services

import (
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
	"strings"
	"time"
)

// EmailIngestSource identifies the workflow that discovered a new email.
type EmailIngestSource string

const (
	EmailIngestSourceAutoSync   EmailIngestSource = "auto_sync"
	EmailIngestSourceManualSync EmailIngestSource = "manual_sync"
	EmailIngestSourcePickup     EmailIngestSource = "pickup"
	EmailIngestSourceUnknown    EmailIngestSource = "unknown"
)

// EmailIngestOptions controls side effects for a batch of newly discovered emails.
type EmailIngestOptions struct {
	Source       EmailIngestSource
	AccountEmail string
	Metadata     map[string]interface{}

	SkipEvent                bool
	SkipNotification         bool
	SkipSubscriptionDispatch bool
}

// EmailIngestService is the single entry point for storing newly fetched emails.
// It keeps the side effects that advanced features depend on in one place:
// dedupe, persistence, trigger dispatch, EventBus publication, and WebSocket notification.
type EmailIngestService struct {
	emailRepo           *repository.EmailRepository
	emailAccountRepo    *repository.EmailAccountRepository
	notificationService *EmailNotificationService
	eventBus            *EventBus
	subscriptionManager *SubscriptionManager
	logger              *utils.Logger
}

// NewEmailIngestService creates a unified email ingest service.
func NewEmailIngestService(
	emailRepo *repository.EmailRepository,
	emailAccountRepo *repository.EmailAccountRepository,
	notificationService *EmailNotificationService,
	eventBus *EventBus,
	subscriptionManager *SubscriptionManager,
) *EmailIngestService {
	return &EmailIngestService{
		emailRepo:           emailRepo,
		emailAccountRepo:    emailAccountRepo,
		notificationService: notificationService,
		eventBus:            eventBus,
		subscriptionManager: subscriptionManager,
		logger:              utils.NewLogger("EmailIngestService"),
	}
}

// IngestEmails stores new emails and emits all downstream side effects once per saved email.
func (s *EmailIngestService) IngestEmails(emails []models.Email, opts EmailIngestOptions) ([]models.Email, error) {
	if s == nil {
		return nil, fmt.Errorf("email ingest service is nil")
	}
	if s.emailRepo == nil {
		return nil, fmt.Errorf("email repository is nil")
	}

	source := normalizeEmailIngestSource(opts.Source)
	newEmails := make([]models.Email, 0, len(emails))
	var firstErr error

	for _, email := range emails {
		if email.MessageID != "" {
			exists, err := s.emailRepo.CheckDuplicate(email.MessageID, email.AccountID)
			if err != nil {
				s.logger.Error("Error checking duplicate for %s: %v", email.MessageID, err)
				if firstErr == nil {
					firstErr = err
				}
				continue
			}
			if exists {
				s.logger.Debug("Email already exists: %s", email.MessageID)
				continue
			}
		}

		if err := s.emailRepo.Create(&email); err != nil {
			s.logger.Error("Failed to save email %s: %v", email.MessageID, err)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}

		accountEmail := s.resolveAccountEmail(email, opts.AccountEmail)
		s.publishSideEffects(email, accountEmail, source, opts)
		newEmails = append(newEmails, email)
	}

	if len(newEmails) == 0 && firstErr != nil {
		return newEmails, firstErr
	}
	return newEmails, nil
}

func (s *EmailIngestService) publishSideEffects(email models.Email, accountEmail string, source EmailIngestSource, opts EmailIngestOptions) {
	if !opts.SkipSubscriptionDispatch && s.subscriptionManager != nil {
		for _, mailbox := range uniqueIngestMailboxes(accountEmail, "") {
			s.subscriptionManager.DistributeEmail(mailbox, email)
		}
	}

	if !opts.SkipEvent && s.eventBus != nil {
		metadata := cloneIngestMetadata(opts.Metadata)
		metadata["source"] = string(source)
		event := EmailEvent{
			Type:      EventTypeNewEmail,
			Timestamp: time.Now(),
			Data:      email,
			Source:    string(source),
			Metadata:  metadata,
		}
		s.eventBus.Publish(event)
		s.logger.Debug("Published new_email event for email ID: %d, MessageID: %s, source: %s", email.ID, email.MessageID, source)
	}

	if !opts.SkipNotification && s.notificationService != nil {
		notification := EmailNotification{
			Type:         "new_email",
			AccountID:    email.AccountID,
			AccountEmail: accountEmail,
			EmailID:      email.ID,
			EmailCount:   1,
			Subject:      email.Subject,
			From:         email.FromAddress,
			Source:       string(source),
			Timestamp:    time.Now(),
		}
		s.notificationService.BroadcastNotification(notification)
	}
}

func (s *EmailIngestService) resolveAccountEmail(email models.Email, fallback string) string {
	if fallback != "" {
		return fallback
	}
	if email.Account.EmailAddress != "" {
		return email.Account.EmailAddress
	}
	if s.emailAccountRepo == nil || email.AccountID == 0 {
		return ""
	}
	account, err := s.emailAccountRepo.GetByID(email.AccountID)
	if err != nil || account == nil {
		return ""
	}
	return account.EmailAddress
}

func normalizeEmailIngestSource(source EmailIngestSource) EmailIngestSource {
	if source == "" {
		return EmailIngestSourceUnknown
	}
	return source
}

func cloneIngestMetadata(metadata map[string]interface{}) map[string]interface{} {
	cloned := make(map[string]interface{}, len(metadata)+1)
	for key, value := range metadata {
		cloned[key] = value
	}
	return cloned
}

func uniqueIngestMailboxes(values ...string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(strings.ToLower(value))
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, value)
	}
	return result
}
