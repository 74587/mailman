package services

import (
	"testing"
	"time"

	"mailman/internal/models"
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
