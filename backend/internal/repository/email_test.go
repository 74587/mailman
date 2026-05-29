package repository

import (
	"mailman/internal/models"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEmailRepositoryTextLikeExprQuotesReservedColumns(t *testing.T) {
	tests := []struct {
		name     string
		db       *gorm.DB
		expected string
	}{
		{
			name: "postgres",
			db: mustOpenTestDB(t, postgres.Open(
				"host=localhost user=test password=test dbname=test port=5432 sslmode=disable",
			)),
			expected: `"to"::text LIKE ?`,
		},
		{
			name:     "sqlite",
			db:       mustOpenTestDB(t, sqlite.Open(":memory:")),
			expected: "`to` LIKE ?",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := textLikeExpr(tt.db, "to"); got != tt.expected {
				t.Fatalf("textLikeExpr() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestBuildOrderClauseAllowsOnlyMappedColumns(t *testing.T) {
	db := mustOpenTestDB(t, postgres.Open(
		"host=localhost user=test password=test dbname=test port=5432 sslmode=disable",
	))
	allowed := map[string]string{
		"emailAddress": "email_accounts.email_address",
		"created_at":   "created_at",
	}

	tests := []struct {
		name      string
		sortBy    string
		sortOrder string
		expected  string
	}{
		{
			name:      "mapped dotted column",
			sortBy:    "emailAddress",
			sortOrder: "asc",
			expected:  `"email_accounts"."email_address" ASC`,
		},
		{
			name:      "invalid column falls back to default",
			sortBy:    "created_at; DROP TABLE emails",
			sortOrder: "asc",
			expected:  `"created_at" ASC`,
		},
		{
			name:      "invalid direction falls back to desc",
			sortBy:    "created_at",
			sortOrder: "sideways",
			expected:  `"created_at" DESC`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildOrderClause(db, tt.sortBy, tt.sortOrder, allowed, "created_at")
			if got != tt.expected {
				t.Fatalf("buildOrderClause() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestBuildEmailOrderClauseQuotesReservedColumns(t *testing.T) {
	db := mustOpenTestDB(t, postgres.Open(
		"host=localhost user=test password=test dbname=test port=5432 sslmode=disable",
	))

	tests := []struct {
		name      string
		sortBy    string
		includeID bool
		expected  string
	}{
		{
			name:      "reserved recipient column",
			sortBy:    "to DESC",
			includeID: true,
			expected:  `"to" DESC, "id" DESC`,
		},
		{
			name:     "api style sort token",
			sortBy:   "date_asc",
			expected: `"date" ASC`,
		},
		{
			name:     "camel case alias",
			sortBy:   "receivedAt asc",
			expected: `"received_at" ASC`,
		},
		{
			name:     "invalid column falls back to date",
			sortBy:   "to; DROP TABLE emails DESC",
			expected: `"date" DESC`,
		},
		{
			name:      "existing id sort is not duplicated",
			sortBy:    "received_at DESC, id ASC",
			includeID: true,
			expected:  `"received_at" DESC, "id" ASC`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildEmailOrderClause(db, tt.sortBy, tt.includeID)
			if got != tt.expected {
				t.Fatalf("buildEmailOrderClause() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestEmailSearchQueryPostgresQuotesRecipientFields(t *testing.T) {
	db := mustOpenTestDB(t, postgres.Open(
		"host=localhost user=test password=test dbname=test port=5432 sslmode=disable",
	))
	repo := NewEmailRepository(db)

	var emails []models.Email
	stmt := repo.buildEmailSearchQuery(EmailSearchOptions{
		AccountID: 1,
		ToQuery:   "target@example.com",
	}).
		Order(buildEmailOrderClause(db, "to DESC", false)).
		Limit(10).
		Find(&emails).Statement
	sql := stmt.SQL.String()

	for _, fragment := range []string{
		`"to_addresses"::text LIKE`,
		`"to"::text LIKE`,
		`ORDER BY "to" DESC`,
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("generated SQL %q does not contain %q", sql, fragment)
		}
	}

	for _, unsafeFragment := range []string{
		` to LIKE`,
		`ORDER BY to `,
		` to_addresses LIKE`,
	} {
		if strings.Contains(sql, unsafeFragment) {
			t.Fatalf("generated SQL %q contains unsafe fragment %q", sql, unsafeFragment)
		}
	}
}

func TestEmailSearchQueryExpandsGmailAliasRecipient(t *testing.T) {
	db := mustOpenTestDB(t, postgres.Open(
		"host=localhost user=test password=test dbname=test port=5432 sslmode=disable",
	))
	repo := NewEmailRepository(db)

	var emails []models.Email
	stmt := repo.buildEmailSearchQuery(EmailSearchOptions{
		AccountID: 1,
		ToQuery:   "target@gmail.com",
	}).Find(&emails).Statement

	if !statementHasVar(stmt.Vars, "%target+%@gmail.com%") {
		t.Fatalf("generated vars %#v do not include Gmail plus alias pattern", stmt.Vars)
	}
}

func TestEmailSearchQueryExpandsDomainWildcardRecipient(t *testing.T) {
	db := mustOpenTestDB(t, postgres.Open(
		"host=localhost user=test password=test dbname=test port=5432 sslmode=disable",
	))
	repo := NewEmailRepository(db)

	var emails []models.Email
	stmt := repo.buildEmailSearchQuery(EmailSearchOptions{
		AccountID: 1,
		ToQuery:   "*@example.com",
	}).Find(&emails).Statement

	if !statementHasVar(stmt.Vars, "%@example.com%") {
		t.Fatalf("generated vars %#v do not include domain wildcard pattern", stmt.Vars)
	}
}

func statementHasVar(vars []interface{}, expected string) bool {
	for _, value := range vars {
		if value == expected {
			return true
		}
	}
	return false
}

func mustOpenTestDB(t *testing.T, dialector gorm.Dialector) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(dialector, &gorm.Config{
		DisableAutomaticPing: true,
		DryRun:               true,
	})
	if err != nil {
		t.Fatalf("failed to open dry-run db: %v", err)
	}

	return db
}
