package utils

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
)

const maxGeneratedEmailLocalPartLength = 48

type EmailLocalPartStrategy struct {
	PrefixStrategy string `json:"prefixStrategy,omitempty"`
	Prefix         string `json:"prefix,omitempty"`
	PrefixTemplate string `json:"prefixTemplate,omitempty"`
	BuiltinPrefix  string `json:"builtinPrefix,omitempty"`
	RandomLength   int    `json:"randomLength,omitempty"`
}

type EmailLocalPartContext struct {
	ModuleName string
	ClaimedBy  string
	AccountID  uint
	Now        time.Time
}

func (s EmailLocalPartStrategy) IsSet() bool {
	return strings.TrimSpace(s.PrefixStrategy) != "" ||
		strings.TrimSpace(s.Prefix) != "" ||
		strings.TrimSpace(s.PrefixTemplate) != "" ||
		strings.TrimSpace(s.BuiltinPrefix) != "" ||
		s.RandomLength > 0
}

func GenerateEmailLocalPart(strategy EmailLocalPartStrategy, ctx EmailLocalPartContext) (string, error) {
	if !strategy.IsSet() {
		return "", fmt.Errorf("email local-part strategy is empty")
	}
	if ctx.Now.IsZero() {
		ctx.Now = time.Now().UTC()
	}

	mode := strings.ToLower(strings.TrimSpace(strategy.PrefixStrategy))
	if mode == "" {
		switch {
		case strings.TrimSpace(strategy.PrefixTemplate) != "":
			mode = "template"
		case strings.TrimSpace(strategy.BuiltinPrefix) != "":
			mode = "builtin"
		case strings.TrimSpace(strategy.Prefix) != "":
			mode = "literal"
		default:
			mode = "random"
		}
	}

	var value string
	var err error
	switch mode {
	case "literal", "prefix":
		value = strategy.Prefix
		if strings.TrimSpace(value) == "" {
			return "", fmt.Errorf("prefix is required for literal strategy")
		}
	case "builtin":
		value, err = builtinEmailLocalPart(strategy.BuiltinPrefix, ctx)
	case "template":
		value, err = renderEmailLocalPartTemplate(strategy.PrefixTemplate, strategy, ctx)
	case "random":
		length := strategy.RandomLength
		if length <= 0 {
			length = 8
		}
		value, err = RandomAlphaNumeric(length)
	default:
		return "", fmt.Errorf("unsupported prefixStrategy %q", strategy.PrefixStrategy)
	}
	if err != nil {
		return "", err
	}

	value = SanitizeEmailLocalPart(value)
	if value == "" {
		return "", fmt.Errorf("generated email local-part is empty")
	}
	return value, nil
}

func builtinEmailLocalPart(name string, ctx EmailLocalPartContext) (string, error) {
	builtin := strings.ToLower(strings.TrimSpace(name))
	if builtin == "" {
		builtin = "pickup"
	}

	base := builtin
	switch builtin {
	case "pickup", "signup", "verify", "register", "business", "test":
	case "module":
		base = ctx.ModuleName
		if strings.TrimSpace(base) == "" {
			base = "module"
		}
	case "claimed-by":
		base = ctx.ClaimedBy
		if strings.TrimSpace(base) == "" {
			base = "claim"
		}
	default:
		return "", fmt.Errorf("unsupported builtinPrefix %q", name)
	}

	tail, err := RandomHexString(2)
	if err != nil {
		return "", err
	}
	return SanitizeEmailLocalPart(base) + "-" + tail, nil
}

func renderEmailLocalPartTemplate(template string, strategy EmailLocalPartStrategy, ctx EmailLocalPartContext) (string, error) {
	if strings.TrimSpace(template) == "" {
		return "", fmt.Errorf("prefixTemplate is required for template strategy")
	}
	hex4, err := RandomHexString(2)
	if err != nil {
		return "", err
	}
	rand6, err := RandomAlphaNumeric(6)
	if err != nil {
		return "", err
	}
	rand8, err := RandomAlphaNumeric(8)
	if err != nil {
		return "", err
	}

	value := template
	replacements := map[string]string{
		"{prefix}":    strategy.Prefix,
		"{builtin}":   strategy.BuiltinPrefix,
		"{module}":    ctx.ModuleName,
		"{claimedBy}": ctx.ClaimedBy,
		"{date}":      ctx.Now.UTC().Format("20060102"),
		"{datetime}":  ctx.Now.UTC().Format("20060102T150405Z"),
		"{timestamp}": strconv.FormatInt(ctx.Now.UTC().Unix(), 10),
		"{hex4}":      hex4,
		"{rand6}":     rand6,
		"{rand8}":     rand8,
		"{accountId}": strconv.FormatUint(uint64(ctx.AccountID), 10),
	}
	for token, replacement := range replacements {
		value = strings.ReplaceAll(value, token, replacement)
	}
	return value, nil
}

func SanitizeEmailLocalPart(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	lastWasSeparator := false
	for _, r := range value {
		allowed := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.'
		if allowed {
			if (r == '-' || r == '_' || r == '.') && lastWasSeparator {
				continue
			}
			b.WriteRune(r)
			lastWasSeparator = r == '-' || r == '_' || r == '.'
			continue
		}
		if b.Len() > 0 && !lastWasSeparator {
			b.WriteByte('-')
			lastWasSeparator = true
		}
	}

	result := strings.Trim(b.String(), ".-_")
	if len(result) > maxGeneratedEmailLocalPartLength {
		result = strings.Trim(result[:maxGeneratedEmailLocalPartLength], ".-_")
	}
	return result
}

func RandomAlphaNumeric(length int) (string, error) {
	if length <= 0 {
		length = 8
	}
	if length > 32 {
		length = 32
	}
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	out := make([]byte, length)
	for i := range out {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			return "", err
		}
		out[i] = chars[idx.Int64()]
	}
	return string(out), nil
}

func RandomHexString(byteLen int) (string, error) {
	if byteLen <= 0 {
		byteLen = 2
	}
	bytes := make([]byte, byteLen)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
