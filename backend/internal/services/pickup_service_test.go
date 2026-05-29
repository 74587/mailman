package services

import (
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
)

func TestPickupSimpleExtractMatchSelection(t *testing.T) {
	email := models.Email{
		ID:          1,
		AccountID:   1,
		Subject:     "Your Dia Code",
		Body:        "702182 Use this code to continue in Dia. Confirm your email address. 702182 Your safety is important.",
		ReceivedAt:  mustParseTestTime(t, "2026-05-26T22:18:21Z"),
		MailboxName: "INBOX",
	}
	service := &PickupService{
		extractorSvc: NewExtractorService(),
	}

	tests := []struct {
		name          string
		config        *SimpleExtractConfig
		wantSuccess   bool
		wantStatus    string
		wantExtracted interface{}
	}{
		{
			name: "default returns all matches",
			config: &SimpleExtractConfig{
				Field:   "body",
				Type:    "regex",
				Pattern: `\d{6}`,
			},
			wantSuccess:   true,
			wantStatus:    "success",
			wantExtracted: []string{"702182", "702182"},
		},
		{
			name: "first returns first match",
			config: &SimpleExtractConfig{
				Field:     "body",
				Type:      "regex",
				Pattern:   `\d{6}`,
				MatchMode: "first",
			},
			wantSuccess:   true,
			wantStatus:    "success",
			wantExtracted: "702182",
		},
		{
			name: "last returns last match",
			config: &SimpleExtractConfig{
				Field:     "body",
				Type:      "regex",
				Pattern:   `\d{6}`,
				MatchMode: "last",
			},
			wantSuccess:   true,
			wantStatus:    "success",
			wantExtracted: "702182",
		},
		{
			name: "index returns selected match",
			config: &SimpleExtractConfig{
				Field:      "body",
				Type:       "regex",
				Pattern:    `\d{6}`,
				MatchMode:  "index",
				MatchIndex: intPtr(1),
			},
			wantSuccess:   true,
			wantStatus:    "success",
			wantExtracted: "702182",
		},
		{
			name: "out of range index is no match",
			config: &SimpleExtractConfig{
				Field:      "body",
				Type:       "regex",
				Pattern:    `\d{6}`,
				MatchMode:  "index",
				MatchIndex: intPtr(2),
			},
			wantSuccess: false,
			wantStatus:  "no_match",
		},
		{
			name: "regex replacement can narrow by context",
			config: &SimpleExtractConfig{
				Field:   "body",
				Type:    "regex",
				Pattern: `Confirm your email address\.\s+(\d{6})|||$1`,
			},
			wantSuccess:   true,
			wantStatus:    "success",
			wantExtracted: "702182",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			results := service.extractWithSimple([]models.Email{email}, tt.config)
			if len(results) != 1 {
				t.Fatalf("result count = %d, want 1", len(results))
			}
			result := results[0]
			if result.Success != tt.wantSuccess {
				t.Fatalf("success = %v, want %v", result.Success, tt.wantSuccess)
			}
			if result.Status != tt.wantStatus {
				t.Fatalf("status = %q, want %q", result.Status, tt.wantStatus)
			}
			if tt.wantExtracted != nil && !simpleExtractValuesEqual(result.ExtractedValue, tt.wantExtracted) {
				t.Fatalf("extracted = %#v, want %#v", result.ExtractedValue, tt.wantExtracted)
			}
		})
	}
}

func TestPickupResolveAccountIDUsesRecipientAddress(t *testing.T) {
	db := mustOpenIngestTestDB(t)
	if err := db.AutoMigrate(&models.MailProvider{}, &models.EmailAccount{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	gmailAccount := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "user@gmail.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
	}
	domainAccount := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "catchall@example.com",
		AuthType:     models.AuthTypePassword,
		IsDomainMail: true,
		Domain:       "example.com",
		IsVerified:   true,
	}
	fallbackAccount := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "fallback@other.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
	}
	for _, account := range []*models.EmailAccount{&gmailAccount, &domainAccount, &fallbackAccount} {
		if err := db.Create(account).Error; err != nil {
			t.Fatalf("failed to create account %s: %v", account.EmailAddress, err)
		}
	}

	service := &PickupService{
		accountRepo: repository.NewEmailAccountRepository(db),
	}

	tests := []struct {
		name        string
		requestedID uint
		toQuery     string
		wantID      uint
		wantBy      string
		wantErr     bool
	}{
		{
			name:        "gmail alias overrides wrong requested account",
			requestedID: fallbackAccount.ID,
			toQuery:     "user+code@gmail.com",
			wantID:      gmailAccount.ID,
			wantBy:      "to_query",
		},
		{
			name:        "domain address overrides wrong requested account",
			requestedID: fallbackAccount.ID,
			toQuery:     "random@example.com",
			wantID:      domainAccount.ID,
			wantBy:      "to_query",
		},
		{
			name:        "domain wildcard resolves without requested account",
			requestedID: 0,
			toQuery:     "*@example.com",
			wantID:      domainAccount.ID,
			wantBy:      "to_query",
		},
		{
			name:        "unknown recipient falls back to requested account",
			requestedID: fallbackAccount.ID,
			toQuery:     "nobody@missing.com",
			wantID:      fallbackAccount.ID,
			wantBy:      "account_id",
		},
		{
			name:    "unknown recipient without requested account fails",
			toQuery: "nobody@missing.com",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotID, gotBy, err := service.resolvePickupAccountID(tt.requestedID, tt.toQuery)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if gotID != tt.wantID {
				t.Fatalf("account id = %d, want %d", gotID, tt.wantID)
			}
			if gotBy != tt.wantBy {
				t.Fatalf("resolved by = %q, want %q", gotBy, tt.wantBy)
			}
		})
	}
}

func intPtr(v int) *int {
	return &v
}

func mustParseTestTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("failed to parse test time: %v", err)
	}
	return parsed
}

func simpleExtractValuesEqual(got interface{}, want interface{}) bool {
	switch expected := want.(type) {
	case string:
		actual, ok := got.(string)
		return ok && actual == expected
	case []string:
		actual, ok := got.([]string)
		if !ok || len(actual) != len(expected) {
			return false
		}
		for i := range actual {
			if actual[i] != expected[i] {
				return false
			}
		}
		return true
	default:
		return got == want
	}
}
