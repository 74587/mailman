package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/repository"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEmailShareHandlersCreateAndResolveDeepLink(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:email-share-api?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.EmailAccount{}, &models.Email{}, &models.Attachment{}, &models.EmailShareLink{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	account := models.EmailAccount{OrgID: 7, EmailAddress: "share@example.com", AuthType: models.AuthTypePassword}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	email := models.Email{AccountID: account.ID, Subject: "share me", Direction: models.EmailDirectionSent}
	if err := db.Create(&email).Error; err != nil {
		t.Fatalf("create email: %v", err)
	}

	handler := &APIHandler{EmailRepo: repository.NewEmailRepository(db)}
	withIdentity := func(request *http.Request, orgID, userID uint) *http.Request {
		ctx := context.WithValue(request.Context(), OrgContextKey, &models.Organization{ID: orgID})
		ctx = context.WithValue(ctx, UserContextKey, &models.User{ID: userID})
		return request.WithContext(ctx)
	}

	createReq := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/emails/%d/share-links", email.ID), bytes.NewBufferString(`{"expiresInDays":7}`))
	createReq = mux.SetURLVars(createReq, map[string]string{"id": fmt.Sprint(email.ID)})
	createReq = withIdentity(createReq, 7, 99)
	createRec := httptest.NewRecorder()
	handler.CreateEmailShareLinkHandler(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", createRec.Code, createRec.Body.String())
	}
	var created emailShareLinkResponse
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Token == "" || created.AccountID != account.ID || created.EmailID != email.ID || created.Direction != "sent" {
		t.Fatalf("unexpected create response: %+v", created)
	}
	var persisted models.EmailShareLink
	if err := db.First(&persisted).Error; err != nil {
		t.Fatalf("load persisted link: %v", err)
	}
	if persisted.TokenHash == created.Token || persisted.CreatedByUserID == nil || *persisted.CreatedByUserID != 99 {
		t.Fatalf("token was not hashed or creator missing: %+v", persisted)
	}

	resolveReq := httptest.NewRequest(http.MethodGet, "/api/email-share-links/"+created.Token, nil)
	resolveReq = mux.SetURLVars(resolveReq, map[string]string{"token": created.Token})
	resolveReq = withIdentity(resolveReq, 7, 100)
	resolveRec := httptest.NewRecorder()
	handler.ResolveEmailShareLinkHandler(resolveRec, resolveReq)
	if resolveRec.Code != http.StatusOK {
		t.Fatalf("resolve status=%d body=%s", resolveRec.Code, resolveRec.Body.String())
	}

	crossOrgReq := httptest.NewRequest(http.MethodGet, "/api/email-share-links/"+created.Token, nil)
	crossOrgReq = mux.SetURLVars(crossOrgReq, map[string]string{"token": created.Token})
	crossOrgReq = withIdentity(crossOrgReq, 8, 100)
	crossOrgRec := httptest.NewRecorder()
	handler.ResolveEmailShareLinkHandler(crossOrgRec, crossOrgReq)
	if crossOrgRec.Code != http.StatusNotFound {
		t.Fatalf("cross-org status=%d body=%s", crossOrgRec.Code, crossOrgRec.Body.String())
	}
}
