package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

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
		&models.BusinessAccount{},
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
