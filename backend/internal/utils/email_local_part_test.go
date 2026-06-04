package utils

import (
	"strings"
	"testing"
	"time"
)

func TestGenerateEmailLocalPartTemplate(t *testing.T) {
	got, err := GenerateEmailLocalPart(EmailLocalPartStrategy{
		PrefixStrategy: "template",
		PrefixTemplate: "{module}-{date}-{accountId}",
	}, EmailLocalPartContext{
		ModuleName: "Git Hub",
		AccountID:  42,
		Now:        time.Date(2026, 6, 4, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("GenerateEmailLocalPart() error = %v", err)
	}
	if got != "git-hub-20260604-42" {
		t.Fatalf("GenerateEmailLocalPart() = %q", got)
	}
}

func TestGenerateEmailLocalPartBuiltin(t *testing.T) {
	got, err := GenerateEmailLocalPart(EmailLocalPartStrategy{
		PrefixStrategy: "builtin",
		BuiltinPrefix:  "module",
	}, EmailLocalPartContext{ModuleName: "GitHub"})
	if err != nil {
		t.Fatalf("GenerateEmailLocalPart() error = %v", err)
	}
	if !strings.HasPrefix(got, "github-") || len(got) != len("github-0000") {
		t.Fatalf("GenerateEmailLocalPart() = %q", got)
	}
}

func TestGenerateEmailLocalPartLiteralSanitizes(t *testing.T) {
	got, err := GenerateEmailLocalPart(EmailLocalPartStrategy{
		PrefixStrategy: "literal",
		Prefix:         " Verify Code! ",
	}, EmailLocalPartContext{})
	if err != nil {
		t.Fatalf("GenerateEmailLocalPart() error = %v", err)
	}
	if got != "verify-code" {
		t.Fatalf("GenerateEmailLocalPart() = %q", got)
	}
}

func TestGenerateEmailLocalPartRandomLength(t *testing.T) {
	got, err := GenerateEmailLocalPart(EmailLocalPartStrategy{
		PrefixStrategy: "random",
		RandomLength:   12,
	}, EmailLocalPartContext{})
	if err != nil {
		t.Fatalf("GenerateEmailLocalPart() error = %v", err)
	}
	if len(got) != 12 {
		t.Fatalf("GenerateEmailLocalPart() length = %d, got %q", len(got), got)
	}
}
