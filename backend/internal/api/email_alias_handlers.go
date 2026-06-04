package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/utils"
	"math/big"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type EmailAliasCapability struct {
	Type    string `json:"type"`
	Domain  string `json:"domain,omitempty"`
	Pattern string `json:"pattern"`
	Example string `json:"example"`
	ToQuery string `json:"toQuery"`
}

type EmailAliasAccountCapability struct {
	AccountID          uint                   `json:"accountId"`
	EmailAddress       string                 `json:"emailAddress"`
	IsDomainMail       bool                   `json:"isDomainMail"`
	Domain             string                 `json:"domain,omitempty"`
	ForwardedAddresses []string               `json:"forwardedAddresses,omitempty"`
	Capabilities       []EmailAliasCapability `json:"capabilities"`
}

type EmailAliasCapabilitiesResponse struct {
	Data  []EmailAliasAccountCapability `json:"data"`
	Total int                           `json:"total"`
}

func (h *APIHandler) ListEmailAliasCapabilitiesHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	accounts, err := h.EmailAccountRepo.GetAll(orgID)
	if err != nil {
		http.Error(w, "Error fetching accounts", http.StatusInternalServerError)
		return
	}

	capabilityType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("type")))
	emailSuffix := normalizeEmailSuffix(r.URL.Query().Get("emailSuffix"))

	result := make([]EmailAliasAccountCapability, 0)
	for _, account := range accounts {
		capabilities := buildEmailAliasCapabilities(account)
		filtered := capabilities[:0]
		for _, capability := range capabilities {
			if capabilityType != "" && capability.Type != capabilityType {
				continue
			}
			if emailSuffix != "" && !capabilityMatchesEmailSuffix(capability, emailSuffix) {
				continue
			}
			filtered = append(filtered, capability)
		}
		if len(filtered) == 0 {
			continue
		}
		result = append(result, EmailAliasAccountCapability{
			AccountID:          account.ID,
			EmailAddress:       account.EmailAddress,
			IsDomainMail:       account.IsDomainMail,
			Domain:             account.Domain,
			ForwardedAddresses: []string(account.ForwardedAddresses),
			Capabilities:       filtered,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].AccountID < result[j].AccountID
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(EmailAliasCapabilitiesResponse{Data: result, Total: len(result)})
}

func buildEmailAliasCapabilities(account models.EmailAccount) []EmailAliasCapability {
	capabilities := make([]EmailAliasCapability, 0, 3)
	local, domain, ok := splitBusinessEmail(account.EmailAddress)
	if ok && isBusinessGmailAddress(account.EmailAddress) {
		example := local + "+pickup-a1b2@" + domain
		capabilities = append(capabilities, EmailAliasCapability{
			Type:    businessAliasTypeGmailPlus,
			Domain:  domain,
			Pattern: local + "+{localPart}@" + domain,
			Example: example,
			ToQuery: example,
		})
	}

	if account.IsDomainMail && strings.TrimSpace(account.Domain) != "" {
		domain := strings.ToLower(strings.TrimSpace(account.Domain))
		example := "pickup-a1b2@" + domain
		capabilities = append(capabilities, EmailAliasCapability{
			Type:    businessAliasTypeDomainPart,
			Domain:  domain,
			Pattern: "{localPart}@" + domain,
			Example: example,
			ToQuery: example,
		})
	}

	for _, forwarded := range account.ForwardedAddresses {
		value := normalizeBusinessEmailAddress(forwarded)
		if value == "" {
			continue
		}
		if strings.HasPrefix(value, "*@") {
			domain := strings.TrimPrefix(value, "*@")
			example := "pickup-a1b2@" + domain
			capabilities = append(capabilities, EmailAliasCapability{
				Type:    businessAliasTypeForwarded,
				Domain:  domain,
				Pattern: "{localPart}@" + domain,
				Example: example,
				ToQuery: example,
			})
			continue
		}
		_, domain, ok := splitBusinessEmail(value)
		capability := EmailAliasCapability{
			Type:    businessAliasTypeForwarded,
			Pattern: value,
			Example: value,
			ToQuery: value,
		}
		if ok {
			capability.Domain = domain
		}
		capabilities = append(capabilities, capability)
	}
	return capabilities
}

func parseEmailLocalPartStrategyFromValues(values url.Values) utils.EmailLocalPartStrategy {
	return utils.EmailLocalPartStrategy{
		PrefixStrategy: firstQueryValue(values, "prefixStrategy", "prefix_strategy"),
		Prefix:         firstQueryValue(values, "prefix"),
		PrefixTemplate: firstQueryValue(values, "prefixTemplate", "prefix_template"),
		BuiltinPrefix:  firstQueryValue(values, "builtinPrefix", "builtin_prefix"),
		RandomLength:   parseIntQueryValue(values, "randomLength", "random_length"),
	}
}

func firstQueryValue(values url.Values, names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(values.Get(name)); value != "" {
			return value
		}
	}
	return ""
}

func parseIntQueryValue(values url.Values, names ...string) int {
	value := firstQueryValue(values, names...)
	if value == "" {
		return 0
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0
	}
	return parsed
}

func parseOptionalUintQueryValue(values url.Values, names ...string) (*uint, error) {
	value := firstQueryValue(values, names...)
	if value == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil || parsed == 0 {
		return nil, fmt.Errorf("invalid %s", names[0])
	}
	result := uint(parsed)
	return &result, nil
}

func normalizeEmailSuffix(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	if at := strings.LastIndex(value, "@"); at >= 0 {
		value = value[at+1:]
	}
	value = strings.TrimPrefix(value, ".")
	if value == "" {
		return ""
	}
	return "@" + value
}

func emailAddressMatchesSuffix(email string, suffix string) bool {
	email = strings.ToLower(strings.TrimSpace(email))
	suffix = normalizeEmailSuffix(suffix)
	return suffix == "" || strings.HasSuffix(email, suffix)
}

func domainMatchesEmailSuffix(domain string, suffix string) bool {
	domain = strings.ToLower(strings.TrimSpace(domain))
	suffix = strings.TrimPrefix(normalizeEmailSuffix(suffix), "@")
	return suffix == "" || domain == suffix
}

func accountMatchesEmailSuffix(account models.EmailAccount, suffix string) bool {
	suffix = normalizeEmailSuffix(suffix)
	if suffix == "" {
		return true
	}
	if emailAddressMatchesSuffix(account.EmailAddress, suffix) {
		return true
	}
	if account.IsDomainMail && domainMatchesEmailSuffix(account.Domain, suffix) {
		return true
	}
	for _, forwarded := range account.ForwardedAddresses {
		value := normalizeBusinessEmailAddress(forwarded)
		if value == "" {
			continue
		}
		if strings.HasPrefix(value, "*@") && domainMatchesEmailSuffix(strings.TrimPrefix(value, "*@"), suffix) {
			return true
		}
		if emailAddressMatchesSuffix(value, suffix) {
			return true
		}
	}
	return false
}

func capabilityMatchesEmailSuffix(capability EmailAliasCapability, suffix string) bool {
	return domainMatchesEmailSuffix(capability.Domain, suffix) || emailAddressMatchesSuffix(capability.Example, suffix)
}

func chooseRandomEmailAccount(accounts []models.EmailAccount) (*models.EmailAccount, error) {
	if len(accounts) == 0 {
		return nil, fmt.Errorf("no email accounts found")
	}
	idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(accounts))))
	if err != nil {
		return nil, err
	}
	return &accounts[idx.Int64()], nil
}

func generateEmailLocalPartForAccount(strategy utils.EmailLocalPartStrategy, account models.EmailAccount, moduleName string, claimedBy string) (string, error) {
	return utils.GenerateEmailLocalPart(strategy, utils.EmailLocalPartContext{
		ModuleName: moduleName,
		ClaimedBy:  claimedBy,
		AccountID:  account.ID,
		Now:        time.Now().UTC(),
	})
}
