package models

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

const ProxyGatewayDefaultUsernameRouteSeparator = "#"

// NormalizeProxyGatewayUsernameRouteSeparators validates the gateway-level
// smart-username separators while keeping old rows compatible with '#'.
func NormalizeProxyGatewayUsernameRouteSeparators(values []string) (StringSlice, error) {
	const maxSeparators = 8
	const maxSeparatorRunes = 8

	result := make(StringSlice, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		separator := strings.TrimSpace(value)
		if separator == "" {
			continue
		}
		if utf8.RuneCountInString(separator) > maxSeparatorRunes {
			return nil, fmt.Errorf("smart username separator %q must not exceed %d characters", separator, maxSeparatorRunes)
		}
		for _, char := range separator {
			if unicode.IsSpace(char) || unicode.IsControl(char) {
				return nil, fmt.Errorf("smart username separator %q cannot contain whitespace or control characters", separator)
			}
			if char == ':' {
				return nil, fmt.Errorf("smart username separator %q cannot contain ':' because HTTP Basic usernames cannot contain colons", separator)
			}
			if unicode.IsLetter(char) || unicode.IsDigit(char) {
				return nil, fmt.Errorf("smart username separator %q must contain symbols only", separator)
			}
			if strings.ContainsRune("?;&,", char) {
				return nil, fmt.Errorf("smart username separator %q conflicts with route query or parameter syntax", separator)
			}
		}
		if _, ok := seen[separator]; ok {
			continue
		}
		seen[separator] = struct{}{}
		result = append(result, separator)
		if len(result) > maxSeparators {
			return nil, fmt.Errorf("at most %d smart username separators are allowed", maxSeparators)
		}
	}
	if len(result) == 0 {
		return StringSlice{ProxyGatewayDefaultUsernameRouteSeparator}, nil
	}
	return result, nil
}

func EffectiveProxyGatewayUsernameRouteSeparators(values []string) StringSlice {
	normalized, err := NormalizeProxyGatewayUsernameRouteSeparators(values)
	if err != nil {
		return StringSlice{ProxyGatewayDefaultUsernameRouteSeparator}
	}
	return normalized
}
