package repository

import (
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
