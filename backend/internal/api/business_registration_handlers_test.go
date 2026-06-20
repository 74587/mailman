package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"

	"github.com/gorilla/mux"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newBusinessRegistrationTestHandler(t *testing.T) (*APIHandler, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(
		&models.EmailAccount{},
		&models.BusinessModule{},
		&models.BusinessScenario{},
		&models.BusinessAccount{},
		&models.BusinessEmailExclusion{},
		&models.TagGroup{},
		&models.Tag{},
		&models.EmailAccountTag{},
	); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}
	return &APIHandler{EmailAccountRepo: repository.NewEmailAccountRepository(db)}, db
}

func TestClaimBusinessModuleEmailAccountCreatesPendingClaim(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub", Website: "https://github.com"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "user@example.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create email account: %v", err)
	}

	body := `{"accountId":1,"ttlSeconds":120,"claimedBy":"worker-a"}`
	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(body))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.BusinessAccountID == 0 || response.ClaimToken == "" {
		t.Fatalf("missing claim fields: %+v", response)
	}
	if response.EmailAccount.ID != account.ID || response.Recipient.EmailAddress != "user@example.com" {
		t.Fatalf("unexpected claim response: %+v", response)
	}
	if response.Pickup.AccountID != account.ID || response.Pickup.ToQuery != "user@example.com" {
		t.Fatalf("unexpected pickup params: %+v", response.Pickup)
	}

	var businessAccount models.BusinessAccount
	if err := db.First(&businessAccount, response.BusinessAccountID).Error; err != nil {
		t.Fatalf("failed to load business account: %v", err)
	}
	if businessAccount.Status != models.BusinessAccountStatusPending || businessAccount.RegistrationEmail == nil || *businessAccount.RegistrationEmail != "user@example.com" {
		t.Fatalf("unexpected stored business account: %+v", businessAccount)
	}

	req2 := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(body))
	req2 = mux.SetURLVars(req2, map[string]string{"id": "1"})
	rec2 := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec2, req2)
	if rec2.Code != http.StatusNotFound {
		t.Fatalf("second claim status = %d, want 404, body = %s", rec2.Code, rec2.Body.String())
	}
}

func TestClaimBusinessModuleEmailAccountSupportsDomainAlias(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "catchall@example.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
		IsDomainMail: true,
		Domain:       "example.com",
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create domain account: %v", err)
	}

	body := `{"emailMode":"domain","domain":"example.com","aliasLocalPart":"github-a1b2","ttlSeconds":60}`
	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(body))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.EmailAccount.ID != account.ID {
		t.Fatalf("email account id = %d, want %d", response.EmailAccount.ID, account.ID)
	}
	if response.Recipient.EmailAddress != "github-a1b2@example.com" || response.Recipient.Kind != "domain_alias" {
		t.Fatalf("unexpected recipient: %+v", response.Recipient)
	}
}

func TestClaimBusinessModuleEmailAccountSupportsPrefixTemplate(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "user@gmail.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create gmail account: %v", err)
	}

	body := `{"accountId":1,"emailMode":"alias","aliasType":"gmail_plus","prefixStrategy":"template","prefixTemplate":"{module}-{date}","ttlSeconds":60}`
	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(body))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !strings.HasPrefix(response.Recipient.EmailAddress, "user+github-") || !strings.HasSuffix(response.Recipient.EmailAddress, "@gmail.com") {
		t.Fatalf("unexpected generated recipient: %+v", response.Recipient)
	}
}

func TestClaimBusinessModuleEmailAccountSupportsAliasBaseAccountAndSuffix(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	other := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "user@example.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
	}
	target := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "base@gmail.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatalf("failed to create other account: %v", err)
	}
	if err := db.Create(&target).Error; err != nil {
		t.Fatalf("failed to create target account: %v", err)
	}

	body := fmt.Sprintf(`{"aliasBaseAccountId":%d,"emailSuffix":"gmail.com","emailMode":"alias","aliasType":"gmail_plus","aliasLocalPart":"github","ttlSeconds":60}`, target.ID)
	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(body))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.EmailAccount.ID != target.ID || response.Recipient.EmailAddress != "base+github@gmail.com" {
		t.Fatalf("unexpected claim response: %+v", response)
	}
}

func TestClaimBusinessModuleEmailAccountFiltersBatchByEmailSuffix(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{OrgID: 1, EmailAddress: "first@example.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
		{OrgID: 1, EmailAddress: "second@gmail.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"primary","emailSuffix":"@gmail.com","ttlSeconds":60}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.EmailAccount.ID != accounts[1].ID || response.Recipient.EmailAddress != "second@gmail.com" {
		t.Fatalf("unexpected suffix-filtered response: %+v", response)
	}
}

func TestUpdateBusinessModulePreservesNewClaimConfigWhenOmitted(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{
		OrgID: 1,
		Name:  "GitHub",
		ClaimDefaults: models.JSONMapInterface{
			"emailSuffixes": []interface{}{"@gmail.com"},
			"ttlSeconds":    float64(900),
		},
		EmailConstraints: models.JSONMapInterface{
			"allowAliases": false,
		},
	}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "/api/business-modules/1", bytes.NewBufferString(`{"name":"GitHub Updated","description":"legacy client payload"}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.UpdateBusinessModuleHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var updated models.BusinessModule
	if err := db.First(&updated, module.ID).Error; err != nil {
		t.Fatalf("failed to load updated module: %v", err)
	}
	if updated.Name != "GitHub Updated" {
		t.Fatalf("module name was not updated: %+v", updated)
	}
	if suffixes := businessConfigStringSlice(updated.ClaimDefaults, "emailSuffixes"); len(suffixes) != 1 || suffixes[0] != "@gmail.com" {
		t.Fatalf("claimDefaults were not preserved: %+v", updated.ClaimDefaults)
	}
	allowAliases, ok := businessConfigBool(updated.EmailConstraints, "allowAliases")
	if !ok || allowAliases {
		t.Fatalf("emailConstraints were not preserved: %+v", updated.EmailConstraints)
	}
}

func TestClaimBusinessModuleEmailAccountUsesModuleDefaultSuffixes(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{
		OrgID: 1,
		Name:  "GitHub",
		ClaimDefaults: models.JSONMapInterface{
			"emailMode":     "primary",
			"emailSuffixes": []interface{}{"@gmail.com", "@outlook.com"},
		},
	}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{OrgID: 1, EmailAddress: "first@example.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
		{OrgID: 1, EmailAddress: "second@outlook.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"ttlSeconds":60}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.EmailAccount.ID != accounts[1].ID || response.Recipient.EmailAddress != "second@outlook.com" {
		t.Fatalf("unexpected default-filtered response: %+v", response)
	}
}

func TestClaimBusinessModuleEmailAccountExplicitSuffixOverridesModuleDefaultSuffixes(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{
		OrgID: 1,
		Name:  "GitHub",
		ClaimDefaults: models.JSONMapInterface{
			"emailMode":     "primary",
			"emailSuffixes": []interface{}{"@gmail.com"},
		},
	}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{OrgID: 1, EmailAddress: "first@example.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
		{OrgID: 1, EmailAddress: "second@gmail.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"primary","emailSuffix":"@example.com","ttlSeconds":60}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.EmailAccount.ID != accounts[0].ID || response.Recipient.EmailAddress != "first@example.com" {
		t.Fatalf("explicit suffix did not override module defaults: %+v", response)
	}
}

func TestClaimBusinessModuleEmailAccountUsesEmailModePriority(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{
		OrgID: 1,
		Name:  "GitHub",
		ClaimDefaults: models.JSONMapInterface{
			"emailModePriorityEnabled": true,
			"emailModePriority":        []interface{}{"alias", "primary"},
			"prefixStrategy":           "literal",
			"prefix":                   "github",
		},
	}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{OrgID: 1, EmailAddress: "first@example.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
		{OrgID: 1, EmailAddress: "base@gmail.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"ttlSeconds":60}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.EmailAccount.ID != accounts[1].ID || response.Recipient.Kind != "gmail_plus" || response.Recipient.EmailAddress != "base+github@gmail.com" {
		t.Fatalf("email mode priority did not prefer alias: %+v", response)
	}
}

func TestClaimBusinessModuleEmailAccountUsesAllowedSuffixPriority(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{
		OrgID: 1,
		Name:  "GitHub",
		ClaimDefaults: models.JSONMapInterface{
			"emailMode": "primary",
		},
		EmailConstraints: models.JSONMapInterface{
			"allowedSuffixes":              []interface{}{"@outlook.com", "@gmail.com"},
			"allowedSuffixPriorityEnabled": true,
		},
	}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{OrgID: 1, EmailAddress: "first@gmail.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
		{OrgID: 1, EmailAddress: "second@outlook.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"ttlSeconds":60}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.EmailAccount.ID != accounts[1].ID || response.Recipient.EmailAddress != "second@outlook.com" {
		t.Fatalf("allowed suffix priority did not prefer outlook: %+v", response)
	}
}

func TestClaimBusinessModuleEmailAccountUsesAllowedDomainsConstraint(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{
		OrgID: 1,
		Name:  "GitHub",
		EmailConstraints: models.JSONMapInterface{
			"allowedDomains": []interface{}{"outlook.com"},
		},
	}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{OrgID: 1, EmailAddress: "first@example.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
		{OrgID: 1, EmailAddress: "second@outlook.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"ttlSeconds":60}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.EmailAccount.ID != accounts[1].ID || response.Recipient.EmailAddress != "second@outlook.com" {
		t.Fatalf("unexpected allowed-domain response: %+v", response)
	}
}

func TestClaimBusinessModuleEmailAccountAppliesBlockedDomainsConstraint(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{
		OrgID: 1,
		Name:  "GitHub",
		EmailConstraints: models.JSONMapInterface{
			"blockedDomains": []interface{}{"example.com"},
		},
	}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{OrgID: 1, EmailAddress: "first@example.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
		{OrgID: 1, EmailAddress: "second@gmail.com", AuthType: models.AuthTypePassword, IsVerified: true, ErrorStatus: string(models.ErrorStatusNormal)},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"primary","ttlSeconds":60}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.EmailAccount.ID != accounts[1].ID || response.Recipient.EmailAddress != "second@gmail.com" {
		t.Fatalf("unexpected blocked-domain response: %+v", response)
	}
}

func TestClaimBusinessModuleEmailAccountRejectsBlockedTargetAsBadRequest(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{
		OrgID: 1,
		Name:  "GitHub",
		EmailConstraints: models.JSONMapInterface{
			"blockedDomains": []interface{}{"gmail.com"},
		},
	}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "base@gmail.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	body := fmt.Sprintf(`{"accountId":%d,"emailMode":"primary"}`, account.ID)
	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(body))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("claim status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "not allowed") {
		t.Fatalf("unexpected error body: %s", rec.Body.String())
	}
}

func TestClaimBusinessModuleEmailAccountRejectsDisallowedAlias(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{
		OrgID: 1,
		Name:  "GitHub",
		EmailConstraints: models.JSONMapInterface{
			"allowAliases": false,
		},
	}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "base@gmail.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	body := fmt.Sprintf(`{"accountId":%d,"emailMode":"alias","aliasType":"gmail_plus","aliasLocalPart":"github"}`, account.ID)
	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(body))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("claim status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}

func TestBusinessScenarioPickupRequestUsesScenarioConfig(t *testing.T) {
	accountID := uint(9)
	registrationEmail := "register@example.com"
	account := &models.BusinessAccount{
		ID:                3,
		OrgID:             1,
		EmailAccountID:    &accountID,
		RegistrationEmail: &registrationEmail,
		Status:            models.BusinessAccountStatusPending,
	}
	templateID := float64(12)
	scenario := models.BusinessScenario{
		OrgID:    1,
		ModuleID: 2,
		Key:      "register",
		Name:     "注册验证码",
		Enabled:  true,
		PickupConfig: models.JSONMapInterface{
			"keepAliveSeconds": float64(90),
			"syncInterval":     float64(3),
			"limit":            float64(5),
		},
		ExtractorConfig: models.JSONMapInterface{
			"templateId": templateID,
		},
	}

	pickupReq, err := buildBusinessScenarioPickupRequest(account, scenario, BusinessScenarioPickupRequest{})
	if err != nil {
		t.Fatalf("build pickup request failed: %v", err)
	}
	if pickupReq.AccountID != accountID || pickupReq.ToQuery != registrationEmail {
		t.Fatalf("unexpected pickup target: %+v", pickupReq)
	}
	if pickupReq.KeepAliveSeconds != 90 || pickupReq.SyncInterval != 3 || pickupReq.Limit != 5 {
		t.Fatalf("unexpected pickup config: %+v", pickupReq)
	}
	if pickupReq.TemplateID == nil || *pickupReq.TemplateID != 12 {
		t.Fatalf("unexpected template id: %+v", pickupReq.TemplateID)
	}
}

func TestRandomEmailHandlerSupportsPrefixTemplate(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "catchall@example.com",
		AuthType:     models.AuthTypePassword,
		IsDomainMail: true,
		Domain:       "example.com",
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create domain account: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/random-email?domain=true&accountId=%d&prefixStrategy=template&prefixTemplate=verify-{accountId}", account.ID), nil)
	rec := httptest.NewRecorder()
	handler.RandomEmailHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("random email status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response RandomEmailResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.Email != fmt.Sprintf("verify-%d@example.com", account.ID) || response.AccountID != account.ID {
		t.Fatalf("unexpected random email response: %+v", response)
	}
}

func TestListEmailAliasCapabilitiesHandler(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	accounts := []models.EmailAccount{
		{OrgID: 1, EmailAddress: "user@gmail.com", AuthType: models.AuthTypePassword},
		{OrgID: 1, EmailAddress: "catchall@example.com", AuthType: models.AuthTypePassword, IsDomainMail: true, Domain: "example.com"},
		{OrgID: 1, EmailAddress: "inbox@relay.com", AuthType: models.AuthTypePassword, ForwardedAddresses: models.StringSlice{"*@forwarded.test"}},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/accounts/alias-capabilities", nil)
	rec := httptest.NewRecorder()
	handler.ListEmailAliasCapabilitiesHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("capabilities status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response EmailAliasCapabilitiesResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.Total != 3 {
		t.Fatalf("total = %d, response = %+v", response.Total, response)
	}
	seen := map[string]bool{}
	for _, item := range response.Data {
		for _, capability := range item.Capabilities {
			seen[capability.Type] = true
		}
	}
	for _, capabilityType := range []string{businessAliasTypeGmailPlus, businessAliasTypeDomainPart, businessAliasTypeForwarded} {
		if !seen[capabilityType] {
			t.Fatalf("missing capability %s in %+v", capabilityType, response)
		}
	}
}

func TestClaimBusinessModuleEmailAccountContinuesAfterInsertConflict(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{
			OrgID:        1,
			EmailAddress: "a@example.com",
			AuthType:     models.AuthTypePassword,
			IsVerified:   true,
			ErrorStatus:  string(models.ErrorStatusNormal),
		},
		{
			OrgID:        1,
			EmailAddress: "b@example.com",
			AuthType:     models.AuthTypePassword,
			IsVerified:   true,
			ErrorStatus:  string(models.ErrorStatusNormal),
		},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create email accounts: %v", err)
	}

	stolen := false
	callbackName := "test:steal_first_business_registration_claim"
	if err := db.Callback().Create().Before("gorm:create").Register(callbackName, func(tx *gorm.DB) {
		account, ok := tx.Statement.Dest.(*models.BusinessAccount)
		if !ok || stolen || account.ClaimedBy != "race-worker" || account.RegistrationEmail == nil || *account.RegistrationEmail != "a@example.com" {
			return
		}
		stolen = true
		var emailAccountID interface{}
		if account.EmailAccountID != nil {
			emailAccountID = *account.EmailAccountID
		}
		var moduleID interface{}
		if account.ModuleID != nil {
			moduleID = *account.ModuleID
		}
		var expiresAt interface{}
		if account.ClaimExpiresAt != nil {
			expiresAt = *account.ClaimExpiresAt
		}
		now := time.Now().UTC()
		if err := tx.Exec(
			`INSERT INTO business_accounts (org_id, email_account_id, module_id, module_name, display_name, registration_email, claim_token, claim_expires_at, claimed_by, status, note_format, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			account.OrgID,
			emailAccountID,
			moduleID,
			account.ModuleName,
			"stolen claim",
			*account.RegistrationEmail,
			"claim_stolen",
			expiresAt,
			"other-worker",
			models.BusinessAccountStatusPending,
			models.AccountNoteFormatMarkdown,
			now,
			now,
		).Error; err != nil {
			tx.AddError(err)
		}
	}); err != nil {
		t.Fatalf("failed to register callback: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Callback().Create().Remove(callbackName)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"primary","claimedBy":"race-worker"}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.Recipient.EmailAddress != "b@example.com" {
		t.Fatalf("expected claim to continue to second account after conflict, got %+v", response.Recipient)
	}
}

func TestClaimBusinessModuleEmailAccountScansPastOccupiedCandidateBatch(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}

	candidateCount := businessClaimCandidateBatchSize + 1
	accounts := make([]models.EmailAccount, 0, candidateCount)
	for i := 1; i <= candidateCount; i++ {
		accounts = append(accounts, models.EmailAccount{
			OrgID:        1,
			EmailAddress: fmt.Sprintf("user%03d@gmail.com", i),
			AuthType:     models.AuthTypePassword,
			IsVerified:   true,
			ErrorStatus:  string(models.ErrorStatusNormal),
		})
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create email accounts: %v", err)
	}

	moduleID := module.ID
	existing := make([]models.BusinessAccount, 0, businessClaimCandidateBatchSize)
	for i := 1; i <= businessClaimCandidateBatchSize; i++ {
		registrationEmail := fmt.Sprintf("user%03d+github@gmail.com", i)
		existing = append(existing, models.BusinessAccount{
			OrgID:             1,
			ModuleID:          &moduleID,
			ModuleName:        module.Name,
			DisplayName:       fmt.Sprintf("existing claim %03d", i),
			RegistrationEmail: &registrationEmail,
			Status:            models.BusinessAccountStatusActive,
			NoteFormat:        models.AccountNoteFormatMarkdown,
		})
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("failed to create existing business accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"alias","aliasType":"gmail_plus","aliasLocalPart":"github","claimedBy":"batch-worker"}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	expectedEmail := fmt.Sprintf("user%03d+github@gmail.com", candidateCount)
	if response.Recipient.EmailAddress != expectedEmail {
		t.Fatalf("expected claim to continue past occupied batch to %s, got %+v", expectedEmail, response.Recipient)
	}
}

func TestClaimBusinessModuleEmailAccountScansFromSyncedBatchToUnsyncedCandidate(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}

	baseTime := time.Date(2026, 6, 12, 16, 0, 0, 0, time.UTC)
	candidateCount := businessClaimCandidateBatchSize + 1
	accounts := make([]models.EmailAccount, 0, candidateCount)
	for i := 1; i <= candidateCount; i++ {
		account := models.EmailAccount{
			OrgID:        1,
			EmailAddress: fmt.Sprintf("fifo%03d@example.com", i),
			AuthType:     models.AuthTypePassword,
			IsVerified:   true,
			ErrorStatus:  string(models.ErrorStatusNormal),
			CreatedAt:    baseTime.Add(time.Duration(i) * time.Minute),
			UpdatedAt:    baseTime.Add(time.Duration(i) * time.Minute),
		}
		if i <= businessClaimCandidateBatchSize {
			lastSyncAt := baseTime.Add(time.Duration(i) * time.Hour)
			account.LastSyncAt = &lastSyncAt
		}
		accounts = append(accounts, account)
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create email accounts: %v", err)
	}

	moduleID := module.ID
	existing := make([]models.BusinessAccount, 0, businessClaimCandidateBatchSize)
	for i := 1; i <= businessClaimCandidateBatchSize; i++ {
		registrationEmail := fmt.Sprintf("fifo%03d@example.com", i)
		existing = append(existing, models.BusinessAccount{
			OrgID:             1,
			ModuleID:          &moduleID,
			ModuleName:        module.Name,
			DisplayName:       fmt.Sprintf("existing claim %03d", i),
			RegistrationEmail: &registrationEmail,
			Status:            models.BusinessAccountStatusActive,
			NoteFormat:        models.AccountNoteFormatMarkdown,
		})
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("failed to create existing business accounts: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"primary","claimedBy":"batch-worker"}`))
	req = mux.SetURLVars(req, map[string]string{"id": "1"})
	rec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response BusinessEmailClaimResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	expectedEmail := fmt.Sprintf("fifo%03d@example.com", candidateCount)
	if response.Recipient.EmailAddress != expectedEmail {
		t.Fatalf("expected claim to continue to unsynced candidate %s, got %+v", expectedEmail, response.Recipient)
	}
}

func TestBusinessRegistrationClaimLifecycle(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "user@example.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create email account: %v", err)
	}

	claimReq := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"accountId":1,"ttlSeconds":60}`))
	claimReq = mux.SetURLVars(claimReq, map[string]string{"id": "1"})
	claimRec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(claimRec, claimReq)
	if claimRec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", claimRec.Code, claimRec.Body.String())
	}
	var claim BusinessEmailClaimResponse
	if err := json.NewDecoder(claimRec.Body).Decode(&claim); err != nil {
		t.Fatalf("failed to decode claim: %v", err)
	}

	renewBody := `{"claimToken":"` + claim.ClaimToken + `","ttlSeconds":300}`
	renewReq := httptest.NewRequest(http.MethodPost, "/api/business-accounts/1/renew-registration-claim", bytes.NewBufferString(renewBody))
	renewReq = mux.SetURLVars(renewReq, map[string]string{"id": fmt.Sprintf("%d", claim.BusinessAccountID)})
	renewRec := httptest.NewRecorder()
	handler.RenewBusinessRegistrationClaimHandler(renewRec, renewReq)
	if renewRec.Code != http.StatusOK {
		t.Fatalf("renew status = %d, body = %s", renewRec.Code, renewRec.Body.String())
	}

	completeBody := `{"claimToken":"` + claim.ClaimToken + `","username":"octo","customFields":{"externalUserId":"abc123"}}`
	completeReq := httptest.NewRequest(http.MethodPost, "/api/business-accounts/1/complete-registration", bytes.NewBufferString(completeBody))
	completeReq = mux.SetURLVars(completeReq, map[string]string{"id": fmt.Sprintf("%d", claim.BusinessAccountID)})
	completeRec := httptest.NewRecorder()
	handler.CompleteBusinessRegistrationHandler(completeRec, completeReq)
	if completeRec.Code != http.StatusOK {
		t.Fatalf("complete status = %d, body = %s", completeRec.Code, completeRec.Body.String())
	}

	var completed models.BusinessAccount
	if err := json.NewDecoder(completeRec.Body).Decode(&completed); err != nil {
		t.Fatalf("failed to decode completed account: %v", err)
	}
	if completed.Status != models.BusinessAccountStatusActive || completed.Username != "octo" {
		t.Fatalf("unexpected completed account: %+v", completed)
	}
	if completed.RegistrationEmail == nil || *completed.RegistrationEmail != "user@example.com" {
		t.Fatalf("registration email was not retained: %+v", completed)
	}
}

func TestReleaseBusinessRegistrationClaimFreesRegistrationEmail(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "GitHub"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "user@example.com",
		AuthType:     models.AuthTypePassword,
		IsVerified:   true,
		ErrorStatus:  string(models.ErrorStatusNormal),
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create email account: %v", err)
	}

	claimReq := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"accountId":1}`))
	claimReq = mux.SetURLVars(claimReq, map[string]string{"id": "1"})
	claimRec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(claimRec, claimReq)
	if claimRec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", claimRec.Code, claimRec.Body.String())
	}
	var claim BusinessEmailClaimResponse
	if err := json.NewDecoder(claimRec.Body).Decode(&claim); err != nil {
		t.Fatalf("failed to decode claim: %v", err)
	}

	releaseBody := `{"claimToken":"` + claim.ClaimToken + `","reason":"captcha_timeout"}`
	releaseReq := httptest.NewRequest(http.MethodPost, "/api/business-accounts/1/release-registration-claim", bytes.NewBufferString(releaseBody))
	releaseReq = mux.SetURLVars(releaseReq, map[string]string{"id": fmt.Sprintf("%d", claim.BusinessAccountID)})
	releaseRec := httptest.NewRecorder()
	handler.ReleaseBusinessRegistrationClaimHandler(releaseRec, releaseReq)
	if releaseRec.Code != http.StatusOK {
		t.Fatalf("release status = %d, body = %s", releaseRec.Code, releaseRec.Body.String())
	}

	claimReq2 := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"accountId":1}`))
	claimReq2 = mux.SetURLVars(claimReq2, map[string]string{"id": "1"})
	claimRec2 := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(claimRec2, claimReq2)
	if claimRec2.Code != http.StatusCreated {
		t.Fatalf("second claim status = %d, body = %s", claimRec2.Code, claimRec2.Body.String())
	}
	var secondClaim BusinessEmailClaimResponse
	if err := json.NewDecoder(claimRec2.Body).Decode(&secondClaim); err != nil {
		t.Fatalf("failed to decode second claim: %v", err)
	}

	deleteReleaseBody := `{"claimToken":"` + secondClaim.ClaimToken + `","reason":"cancelled","deletePendingAccount":true}`
	deleteReleaseReq := httptest.NewRequest(http.MethodPost, "/api/business-accounts/1/release-registration-claim", bytes.NewBufferString(deleteReleaseBody))
	deleteReleaseReq = mux.SetURLVars(deleteReleaseReq, map[string]string{"id": fmt.Sprintf("%d", secondClaim.BusinessAccountID)})
	deleteReleaseRec := httptest.NewRecorder()
	handler.ReleaseBusinessRegistrationClaimHandler(deleteReleaseRec, deleteReleaseReq)
	if deleteReleaseRec.Code != http.StatusOK {
		t.Fatalf("delete release status = %d, body = %s", deleteReleaseRec.Code, deleteReleaseRec.Body.String())
	}

	claimReq3 := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"accountId":1}`))
	claimReq3 = mux.SetURLVars(claimReq3, map[string]string{"id": "1"})
	claimRec3 := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(claimRec3, claimReq3)
	if claimRec3.Code != http.StatusCreated {
		t.Fatalf("third claim status = %d, body = %s", claimRec3.Code, claimRec3.Body.String())
	}
}

func TestReleaseBusinessRegistrationClaimCanCooldownEmailAccount(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "Dia"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{
			OrgID:        1,
			EmailAddress: "slow-outlook@example.com",
			AuthType:     models.AuthTypeOAuth2,
			IsVerified:   true,
			ErrorStatus:  string(models.ErrorStatusNormal),
		},
		{
			OrgID:        1,
			EmailAddress: "next-gmail@example.com",
			AuthType:     models.AuthTypeOAuth2,
			IsVerified:   true,
			ErrorStatus:  string(models.ErrorStatusNormal),
		},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create email accounts: %v", err)
	}

	claimReq := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"primary","ttlSeconds":600}`))
	claimReq = mux.SetURLVars(claimReq, map[string]string{"id": "1"})
	claimRec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(claimRec, claimReq)
	if claimRec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", claimRec.Code, claimRec.Body.String())
	}
	var claim BusinessEmailClaimResponse
	if err := json.NewDecoder(claimRec.Body).Decode(&claim); err != nil {
		t.Fatalf("failed to decode claim: %v", err)
	}
	if claim.EmailAccount.ID != accounts[0].ID {
		t.Fatalf("first claim should use first account, got %+v", claim.EmailAccount)
	}

	releaseBody := fmt.Sprintf(`{"claimToken":%q,"reason":"verification_timeout","message":"no code","exclusion":{"type":"cooldown","target":"email_account","scope":"module","durationSeconds":600}}`, claim.ClaimToken)
	releaseReq := httptest.NewRequest(http.MethodPost, "/api/business-accounts/1/release-registration-claim", bytes.NewBufferString(releaseBody))
	releaseReq = mux.SetURLVars(releaseReq, map[string]string{"id": fmt.Sprintf("%d", claim.BusinessAccountID)})
	releaseRec := httptest.NewRecorder()
	handler.ReleaseBusinessRegistrationClaimHandler(releaseRec, releaseReq)
	if releaseRec.Code != http.StatusOK {
		t.Fatalf("release status = %d, body = %s", releaseRec.Code, releaseRec.Body.String())
	}

	var exclusion models.BusinessEmailExclusion
	if err := db.First(&exclusion).Error; err != nil {
		t.Fatalf("failed to load exclusion: %v", err)
	}
	if exclusion.EmailAccountID == nil || *exclusion.EmailAccountID != accounts[0].ID || exclusion.Type != models.BusinessEmailExclusionTypeCooldown || exclusion.ExpiresAt == nil {
		t.Fatalf("unexpected exclusion: %+v", exclusion)
	}

	nextReq := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"primary","ttlSeconds":600}`))
	nextReq = mux.SetURLVars(nextReq, map[string]string{"id": "1"})
	nextRec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(nextRec, nextReq)
	if nextRec.Code != http.StatusCreated {
		t.Fatalf("next claim status = %d, body = %s", nextRec.Code, nextRec.Body.String())
	}
	var nextClaim BusinessEmailClaimResponse
	if err := json.NewDecoder(nextRec.Body).Decode(&nextClaim); err != nil {
		t.Fatalf("failed to decode next claim: %v", err)
	}
	if nextClaim.EmailAccount.ID != accounts[1].ID {
		t.Fatalf("expected cooldown to skip first account, got %+v", nextClaim.EmailAccount)
	}
}

func TestReleaseBusinessRegistrationClaimCanBlacklistRegistrationEmail(t *testing.T) {
	handler, db := newBusinessRegistrationTestHandler(t)
	module := models.BusinessModule{OrgID: 1, Name: "Dia"}
	if err := db.Create(&module).Error; err != nil {
		t.Fatalf("failed to create module: %v", err)
	}
	accounts := []models.EmailAccount{
		{
			OrgID:        1,
			EmailAddress: "registered@example.com",
			AuthType:     models.AuthTypePassword,
			IsVerified:   true,
			ErrorStatus:  string(models.ErrorStatusNormal),
		},
		{
			OrgID:        1,
			EmailAddress: "fresh@example.com",
			AuthType:     models.AuthTypePassword,
			IsVerified:   true,
			ErrorStatus:  string(models.ErrorStatusNormal),
		},
	}
	if err := db.Create(&accounts).Error; err != nil {
		t.Fatalf("failed to create email accounts: %v", err)
	}

	claimReq := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"primary"}`))
	claimReq = mux.SetURLVars(claimReq, map[string]string{"id": "1"})
	claimRec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(claimRec, claimReq)
	if claimRec.Code != http.StatusCreated {
		t.Fatalf("claim status = %d, body = %s", claimRec.Code, claimRec.Body.String())
	}
	var claim BusinessEmailClaimResponse
	if err := json.NewDecoder(claimRec.Body).Decode(&claim); err != nil {
		t.Fatalf("failed to decode claim: %v", err)
	}

	releaseBody := fmt.Sprintf(`{"claimToken":%q,"reason":"already_registered","exclusion":{"type":"blacklist","target":"registration_email","scope":"module"}}`, claim.ClaimToken)
	releaseReq := httptest.NewRequest(http.MethodPost, "/api/business-accounts/1/release-registration-claim", bytes.NewBufferString(releaseBody))
	releaseReq = mux.SetURLVars(releaseReq, map[string]string{"id": fmt.Sprintf("%d", claim.BusinessAccountID)})
	releaseRec := httptest.NewRecorder()
	handler.ReleaseBusinessRegistrationClaimHandler(releaseRec, releaseReq)
	if releaseRec.Code != http.StatusOK {
		t.Fatalf("release status = %d, body = %s", releaseRec.Code, releaseRec.Body.String())
	}

	var exclusion models.BusinessEmailExclusion
	if err := db.First(&exclusion).Error; err != nil {
		t.Fatalf("failed to load exclusion: %v", err)
	}
	if exclusion.RegistrationEmail != "registered@example.com" || exclusion.Type != models.BusinessEmailExclusionTypeBlacklist || exclusion.ExpiresAt != nil {
		t.Fatalf("unexpected exclusion: %+v", exclusion)
	}

	nextReq := httptest.NewRequest(http.MethodPost, "/api/business-modules/1/email-accounts/claim", bytes.NewBufferString(`{"emailMode":"primary"}`))
	nextReq = mux.SetURLVars(nextReq, map[string]string{"id": "1"})
	nextRec := httptest.NewRecorder()
	handler.ClaimBusinessModuleEmailAccountHandler(nextRec, nextReq)
	if nextRec.Code != http.StatusCreated {
		t.Fatalf("next claim status = %d, body = %s", nextRec.Code, nextRec.Body.String())
	}
	var nextClaim BusinessEmailClaimResponse
	if err := json.NewDecoder(nextRec.Body).Decode(&nextClaim); err != nil {
		t.Fatalf("failed to decode next claim: %v", err)
	}
	if nextClaim.Recipient.EmailAddress != "fresh@example.com" {
		t.Fatalf("expected blacklist to skip first registration email, got %+v", nextClaim.Recipient)
	}
}
