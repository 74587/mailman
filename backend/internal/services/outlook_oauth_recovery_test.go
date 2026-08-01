package services

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type outlookRoundTripFunc func(*http.Request) (*http.Response, error)

func (f outlookRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func jsonHTTPResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestOutlookProtocolSelectionDefaultsLegacyTokensToIMAP(t *testing.T) {
	provider := &models.MailProvider{Type: models.ProviderTypeOutlook}
	fetcher := NewFetcherService(nil, nil, nil)

	tests := []struct {
		name     string
		settings models.JSONMap
		want     bool
	}{
		{name: "unset protocol", settings: models.JSONMap{"access_token": "opaque-token"}, want: false},
		{name: "explicit imap", settings: models.JSONMap{"connection_protocol": "imap", "access_token": "opaque-token"}, want: false},
		{name: "misclassified EwA token", settings: models.JSONMap{"connection_protocol": "graph", "access_token": "EwA-legacy-token"}, want: false},
		{name: "explicit graph", settings: models.JSONMap{"connection_protocol": "graph", "access_token": "opaque-graph-token"}, want: true},
		{name: "legacy Graph audience", settings: models.JSONMap{"access_token": unsignedOutlookJWT("00000003-0000-0000-c000-000000000000")}, want: true},
		{name: "legacy Exchange audience", settings: models.JSONMap{"access_token": unsignedOutlookJWT("https://outlook.office.com")}, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			account := models.EmailAccount{
				AuthType:       models.AuthTypeOAuth2,
				MailProvider:   provider,
				CustomSettings: tt.settings,
			}
			if got := fetcher.shouldUseOutlookGraphAPI(account); got != tt.want {
				t.Fatalf("shouldUseOutlookGraphAPI() = %t, want %t", got, tt.want)
			}
		})
	}
}

func unsignedOutlookJWT(audience string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"aud":%q}`, audience)))
	return header + "." + payload + ".signature"
}

func TestFetcherUsesSharedOAuth2Service(t *testing.T) {
	oauth2Service := NewOAuth2Service(nil)
	fetcher := NewFetcherServiceWithOAuth2Service(nil, nil, nil, oauth2Service)
	if fetcher.oauth2Service != oauth2Service {
		t.Fatal("fetcher did not retain the shared OAuth2 service")
	}
}

func TestOutlookRefreshAlwaysPreservesGrantedScopes(t *testing.T) {
	oauth2Service := NewOAuth2Service(nil)
	oauth2Service.httpClient = &http.Client{Transport: outlookRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		if err := req.ParseForm(); err != nil {
			t.Fatalf("parse refresh form: %v", err)
		}
		if scope := req.Form.Get("scope"); scope != "" {
			t.Fatalf("Outlook refresh sent scope %q, want omitted", scope)
		}
		return jsonHTTPResponse(http.StatusOK, `{"access_token":"access","refresh_token":"rotated","expires_in":3600}`), nil
	})}
	if _, err := oauth2Service.RefreshAccessTokenWithCacheAndProxyResult(
		string(models.ProviderTypeOutlook), "client", "", "refresh", 0, "", OAuth2RefreshOptions{},
	); err != nil {
		t.Fatalf("refresh Outlook token: %v", err)
	}
}

func TestAccountBoundRefreshPersistsAccountlessCachedRotation(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"client_id":     "client",
		"refresh_token": "old-refresh",
	})
	oauth2Service := NewOAuth2Service(db)
	var requests atomic.Int32
	oauth2Service.httpClient = &http.Client{Transport: outlookRoundTripFunc(func(*http.Request) (*http.Response, error) {
		requests.Add(1)
		return jsonHTTPResponse(http.StatusOK, `{"access_token":"new-access","refresh_token":"rotated-refresh","expires_in":3600}`), nil
	})}
	if _, err := oauth2Service.RefreshAccessTokenWithCacheAndProxyResult(
		string(models.ProviderTypeOutlook), "client", "", "old-refresh", 0, "", OAuth2RefreshOptions{},
	); err != nil {
		t.Fatalf("accountless refresh: %v", err)
	}
	if _, err := oauth2Service.RefreshAccessTokenWithCacheAndProxyResult(
		string(models.ProviderTypeOutlook), "client", "", "old-refresh", account.ID, "", OAuth2RefreshOptions{},
	); err != nil {
		t.Fatalf("account-bound cached refresh: %v", err)
	}
	if requests.Load() != 1 {
		t.Fatalf("token endpoint requests = %d, want 1", requests.Load())
	}
	var persisted models.EmailAccount
	if err := db.First(&persisted, account.ID).Error; err != nil {
		t.Fatalf("reload account: %v", err)
	}
	if token := persisted.CustomSettings["refresh_token"]; token != "rotated-refresh" {
		t.Fatalf("persisted refresh token = %q", token)
	}
}

func TestForcedRefreshRecoversPendingRotatedTokenBeforeCallingProvider(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"client_id":     "client",
		"refresh_token": "old-refresh",
	})
	oauth2Service := NewOAuth2Service(db)
	cacheKey := oauth2Service.getRefreshCacheKey(
		string(models.ProviderTypeOutlook), "client", "old-refresh", true,
	)
	oauth2Service.tokenCache[cacheKey] = &TokenCacheEntry{
		AccessToken:  "recovered-access",
		RefreshToken: "rotated-refresh",
		ExpiresAt:    time.Now().Add(time.Hour),
		RefreshTime:  time.Now(),
	}
	var requests atomic.Int32
	oauth2Service.httpClient = &http.Client{Transport: outlookRoundTripFunc(func(*http.Request) (*http.Response, error) {
		requests.Add(1)
		return jsonHTTPResponse(http.StatusInternalServerError, `{}`), nil
	})}

	result, err := oauth2Service.RefreshAccessTokenWithCacheAndProxyResult(
		string(models.ProviderTypeOutlook), "client", "", "old-refresh", account.ID, "", OAuth2RefreshOptions{Force: true},
	)
	if err != nil {
		t.Fatalf("recover pending rotation: %v", err)
	}
	if result.RefreshToken != "rotated-refresh" || result.AccessToken != "recovered-access" {
		t.Fatalf("recovered token result = %+v", result)
	}
	if requests.Load() != 0 {
		t.Fatalf("token endpoint requests = %d, want 0", requests.Load())
	}
	var persisted models.EmailAccount
	if err := db.First(&persisted, account.ID).Error; err != nil {
		t.Fatalf("reload account: %v", err)
	}
	if token := persisted.CustomSettings["refresh_token"]; token != "rotated-refresh" {
		t.Fatalf("persisted refresh token = %q", token)
	}
}

func TestAccountBoundRefreshDoesNotCallProviderWhenAccountReloadFails(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.EmailAccount{}); err != nil {
		t.Fatalf("migrate account: %v", err)
	}
	oauth2Service := NewOAuth2Service(db)
	var requests atomic.Int32
	oauth2Service.httpClient = &http.Client{Transport: outlookRoundTripFunc(func(*http.Request) (*http.Response, error) {
		requests.Add(1)
		return jsonHTTPResponse(http.StatusOK, `{"access_token":"unexpected"}`), nil
	})}

	_, err = oauth2Service.RefreshAccessTokenWithCacheAndProxyResult(
		string(models.ProviderTypeOutlook), "client", "", "refresh", 999, "", OAuth2RefreshOptions{},
	)
	if err == nil || !strings.Contains(err.Error(), "before token refresh") {
		t.Fatalf("account reload error = %v", err)
	}
	if requests.Load() != 0 {
		t.Fatalf("token endpoint requests = %d, want 0", requests.Load())
	}
}

func TestOutlookGraph401RefreshesPersistsAndRetriesOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.EmailAccount{}); err != nil {
		t.Fatalf("migrate account: %v", err)
	}

	provider := &models.MailProvider{Type: models.ProviderTypeOutlook}
	account := models.EmailAccount{
		OrgID:        1,
		EmailAddress: "graph-retry@example.com",
		AuthType:     models.AuthTypeOAuth2,
		MailProvider: provider,
		CustomSettings: models.JSONMap{
			"client_id":           "public-client",
			"client_secret":       "",
			"access_token":        "old-access",
			"refresh_token":       "old-refresh",
			"expires_at":          strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10),
			"connection_protocol": "graph",
		},
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	account.MailProvider = provider

	var tokenRequests atomic.Int32
	oauthService := NewOAuth2Service(db)
	oauthService.httpClient = &http.Client{Transport: outlookRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		tokenRequests.Add(1)
		if err := req.ParseForm(); err != nil {
			t.Fatalf("parse token form: %v", err)
		}
		if got := req.Form.Get("scope"); got != "" {
			t.Fatalf("Graph refresh sent scope %q, want omitted", got)
		}
		if got := req.Form.Get("client_secret"); got != "" {
			t.Fatalf("public-client refresh sent client_secret %q", got)
		}
		return jsonHTTPResponse(http.StatusOK, `{"access_token":"new-access","refresh_token":"rotated-refresh","expires_in":7200}`), nil
	})}

	var graphRequests atomic.Int32
	graphClient := &http.Client{Transport: outlookRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		attempt := graphRequests.Add(1)
		if attempt == 1 {
			if got := req.Header.Get("Authorization"); got != "Bearer old-access" {
				t.Fatalf("first authorization = %q", got)
			}
			return jsonHTTPResponse(http.StatusUnauthorized, `{"error":"expired"}`), nil
		}
		if got := req.Header.Get("Authorization"); got != "Bearer new-access" {
			t.Fatalf("retry authorization = %q", got)
		}
		return jsonHTTPResponse(http.StatusOK, `{"value":[{"id":"1","subject":"hello","internetMessageId":"message-1"}]}`), nil
	})}

	fetcher := NewFetcherService(repository.NewEmailAccountRepository(db), nil, db)
	fetcher.oauth2Service = oauthService
	fetcher.outlookHTTPClientFactory = func(string) *http.Client { return graphClient }

	emails, err := fetcher.fetchEmailsFromOutlookGraphAPI(account, FetchEmailsOptions{Limit: 10, Source: EmailIngestSourceManualSync})
	if err != nil {
		t.Fatalf("fetch Graph mail: %v", err)
	}
	if len(emails) != 1 {
		t.Fatalf("email count = %d, want 1", len(emails))
	}
	if got := graphRequests.Load(); got != 2 {
		t.Fatalf("Graph request count = %d, want 2", got)
	}
	if got := tokenRequests.Load(); got != 1 {
		t.Fatalf("token request count = %d, want 1", got)
	}

	var persisted models.EmailAccount
	if err := db.First(&persisted, account.ID).Error; err != nil {
		t.Fatalf("reload account: %v", err)
	}
	if got := persisted.CustomSettings["access_token"]; got != "new-access" {
		t.Fatalf("persisted access token = %q", got)
	}
	if got := persisted.CustomSettings["refresh_token"]; got != "rotated-refresh" {
		t.Fatalf("persisted refresh token = %q", got)
	}
	expiresAt, err := strconv.ParseInt(persisted.CustomSettings["expires_at"], 10, 64)
	if err != nil {
		t.Fatalf("parse persisted expiry: %v", err)
	}
	if remaining := time.Until(time.Unix(expiresAt, 0)); remaining < 119*time.Minute || remaining > 121*time.Minute {
		t.Fatalf("persisted expiry remaining = %v, want about 120m", remaining)
	}
}

func TestOutlookGraphFetchPaginatesWithinSelectedFolder(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"access_token":        "graph-access",
		"expires_at":          strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10),
		"connection_protocol": "graph",
	})
	var requests atomic.Int32
	graphClient := &http.Client{Transport: outlookRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		if !strings.Contains(req.URL.Path, "/me/mailFolders/inbox/messages") {
			t.Fatalf("Graph messages path = %q, want selected inbox folder", req.URL.Path)
		}
		request := requests.Add(1)
		if request == 1 {
			return jsonHTTPResponse(http.StatusOK, `{"value":[{"id":"1","internetMessageId":"message-1"},{"id":"2","internetMessageId":"message-2"}],"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?page=2"}`), nil
		}
		return jsonHTTPResponse(http.StatusOK, `{"value":[{"id":"3","internetMessageId":"message-3"}]}`), nil
	})}
	fetcher := NewFetcherService(repository.NewEmailAccountRepository(db), nil, db)
	fetcher.outlookHTTPClientFactory = func(string) *http.Client { return graphClient }

	emails, err := fetcher.fetchEmailsFromOutlookGraphAPI(account, FetchEmailsOptions{
		Folders: []string{"INBOX"},
		Source:  EmailIngestSourceAutoSync,
	})
	if err != nil {
		t.Fatalf("fetch paginated Graph mail: %v", err)
	}
	if len(emails) != 3 || requests.Load() != 2 {
		t.Fatalf("emails=%d requests=%d, want 3 emails across 2 pages", len(emails), requests.Load())
	}
	for _, email := range emails {
		if email.MailboxName != "INBOX" {
			t.Fatalf("mailbox name = %q, want INBOX", email.MailboxName)
		}
	}
}

func TestOutlookGraphFetchRejectsUntrustedPaginationURL(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"access_token":        "graph-access",
		"expires_at":          strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10),
		"connection_protocol": "graph",
	})
	var requests atomic.Int32
	graphClient := &http.Client{Transport: outlookRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests.Add(1)
		return jsonHTTPResponse(http.StatusOK, `{"value":[],"@odata.nextLink":"https://attacker.example/messages?page=2"}`), nil
	})}
	fetcher := NewFetcherService(repository.NewEmailAccountRepository(db), nil, db)
	fetcher.outlookHTTPClientFactory = func(string) *http.Client { return graphClient }

	_, err := fetcher.fetchEmailsFromOutlookGraphAPI(account, FetchEmailsOptions{Folders: []string{"INBOX"}})
	if err == nil || !strings.Contains(err.Error(), "untrusted Graph API request URL") {
		t.Fatalf("untrusted pagination error = %v", err)
	}
	if requests.Load() != 1 {
		t.Fatalf("Graph requests = %d, want no request to the untrusted host", requests.Load())
	}
}

func TestOutlookGraphFetchResolvesCustomFolder(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"access_token":        "graph-access",
		"expires_at":          strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10),
		"connection_protocol": "graph",
	})
	graphClient := &http.Client{Transport: outlookRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		switch {
		case req.URL.Path == "/v1.0/me/mailFolders":
			return jsonHTTPResponse(http.StatusOK, `{"value":[{"id":"folder-123","displayName":"Projects","childFolderCount":0}]}`), nil
		case strings.Contains(req.URL.Path, "/me/mailFolders/folder-123/messages"):
			return jsonHTTPResponse(http.StatusOK, `{"value":[{"id":"1","internetMessageId":"custom-folder-message"}]}`), nil
		default:
			t.Fatalf("unexpected Graph URL %s", req.URL.String())
			return nil, nil
		}
	})}
	fetcher := NewFetcherService(repository.NewEmailAccountRepository(db), nil, db)
	fetcher.outlookHTTPClientFactory = func(string) *http.Client { return graphClient }
	emails, err := fetcher.fetchEmailsFromOutlookGraphAPI(account, FetchEmailsOptions{Folders: []string{"Projects"}})
	if err != nil {
		t.Fatalf("fetch custom Outlook folder: %v", err)
	}
	if len(emails) != 1 || emails[0].MailboxName != "Projects" {
		t.Fatalf("custom folder emails = %+v", emails)
	}
}

func TestOutlookErrorClassificationDoesNotDisableTransientFailures(t *testing.T) {
	syncer := &AccountSyncer{}

	if got := syncer.analyzeErrorType("Graph API request failed with status 401"); got != models.ErrorStatusOAuthExpired {
		t.Fatalf("401 classification = %s, want %s", got, models.ErrorStatusOAuthExpired)
	}
	if got := syncer.analyzeErrorType("OAuth2 error: temporarily_unavailable AADSTS90055 excessive request rate"); got != models.ErrorStatusServerError {
		t.Fatalf("temporary failure classification = %s, want %s", got, models.ErrorStatusServerError)
	}
	if got := syncer.analyzeErrorType("AADSTS50173 authorization has been revoked"); got != models.ErrorStatusAuthRevoked {
		t.Fatalf("revocation classification = %s, want %s", got, models.ErrorStatusAuthRevoked)
	}
	if got := syncer.analyzeErrorType("Graph API request failed with status 403: ErrorAccessDenied insufficient privileges"); got != models.ErrorStatusPermissionDenied {
		t.Fatalf("permission classification = %s, want %s", got, models.ErrorStatusPermissionDenied)
	}
	if got := syncer.analyzeErrorType("403 API disabled"); got != models.ErrorStatusAPIDisabled {
		t.Fatalf("API-disabled classification = %s, want %s", got, models.ErrorStatusAPIDisabled)
	}
	if disabled, _ := syncer.shouldAutoDisable(models.ErrorStatusPermissionDenied, 1); !disabled {
		t.Fatal("permanent permission failure did not disable account")
	}

	if disabled, _ := syncer.shouldAutoDisable(models.ErrorStatusOAuthExpired, 1); disabled {
		t.Fatal("single OAuth/401 failure disabled account")
	}
	if disabled, _ := syncer.shouldAutoDisable(models.ErrorStatusServerError, 100); disabled {
		t.Fatal("temporary server failures disabled account")
	}
	if disabled, _ := syncer.shouldAutoDisable(models.ErrorStatusAuthRevoked, 1); !disabled {
		t.Fatal("explicit revocation did not disable account")
	}
}

func TestDetectOutlookProtocolPersistsGraphCapability(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"access_token":        "graph-access",
		"refresh_token":       "graph-refresh",
		"client_id":           "public-client",
		"expires_at":          strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10),
		"connection_protocol": "imap",
	})
	graphClient := &http.Client{Transport: outlookRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != outlookGraphProtocolProbeURL {
			t.Fatalf("probe URL = %q", req.URL.String())
		}
		return jsonHTTPResponse(http.StatusOK, `{"value":[{"id":"message-1"}]}`), nil
	})}
	fetcher := NewFetcherService(repository.NewEmailAccountRepository(db), nil, db)
	fetcher.outlookHTTPClientFactory = func(string) *http.Client { return graphClient }

	result, err := fetcher.DetectOutlookProtocol(context.Background(), account)
	if err != nil {
		t.Fatalf("detect Outlook protocol: %v", err)
	}
	if result.Protocol != "graph" || !result.Changed || result.Method != "graph_mail_probe" {
		t.Fatalf("detection result = %+v", result)
	}
	assertPersistedOutlookProtocol(t, db, account.ID, "graph", "graph_mail_probe")
}

func TestDetectOutlookProtocolFallsBackToIMAPAfterGraphPermissionFailure(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"access_token":  "opaque-access",
		"refresh_token": "imap-refresh",
		"client_id":     "public-client",
		"expires_at":    strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10),
	})
	graphClient := &http.Client{Transport: outlookRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonHTTPResponse(http.StatusForbidden, `{"error":"insufficient_scope"}`), nil
	})}
	fetcher := NewFetcherService(repository.NewEmailAccountRepository(db), nil, db)
	fetcher.outlookHTTPClientFactory = func(string) *http.Client { return graphClient }
	fetcher.outlookIMAPProtocolProbe = func(context.Context, models.EmailAccount) error { return nil }

	result, err := fetcher.DetectOutlookProtocol(context.Background(), account)
	if err != nil {
		t.Fatalf("detect Outlook protocol: %v", err)
	}
	if result.Protocol != "imap" || result.Method != "imap_xoauth2_probe" {
		t.Fatalf("detection result = %+v", result)
	}
	assertPersistedOutlookProtocol(t, db, account.ID, "imap", "imap_xoauth2_probe")
}

func TestDetectOutlookProtocolDoesNotSwitchOnGraphThrottling(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"access_token":        "opaque-access",
		"refresh_token":       "refresh-token",
		"client_id":           "public-client",
		"expires_at":          strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10),
		"connection_protocol": "imap",
	})
	graphClient := &http.Client{Transport: outlookRoundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonHTTPResponse(http.StatusTooManyRequests, `{"error":"throttled"}`), nil
	})}
	fetcher := NewFetcherService(repository.NewEmailAccountRepository(db), nil, db)
	fetcher.outlookHTTPClientFactory = func(string) *http.Client { return graphClient }
	fetcher.outlookIMAPProtocolProbe = func(context.Context, models.EmailAccount) error {
		t.Fatal("IMAP probe ran after a temporary Graph failure")
		return nil
	}

	_, err := fetcher.DetectOutlookProtocol(context.Background(), account)
	if err == nil {
		t.Fatal("detection succeeded during Graph throttling")
	}
	var detectionErr *OutlookProtocolDetectionError
	if !errors.As(err, &detectionErr) || !detectionErr.Temporary {
		t.Fatalf("detection error = %v, want temporary", err)
	}
	var persisted models.EmailAccount
	if err := db.First(&persisted, account.ID).Error; err != nil {
		t.Fatalf("reload account: %v", err)
	}
	if got := persisted.CustomSettings["connection_protocol"]; got != "imap" {
		t.Fatalf("protocol changed during throttling: %q", got)
	}
	if got := persisted.CustomSettings["protocol_detection_method"]; got != "" {
		t.Fatalf("temporary detection persisted method %q", got)
	}
}

func TestDetectOutlookProtocolValidatesExchangeTokenWithIMAPProbe(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"access_token":        "EwA-legacy-token",
		"refresh_token":       "refresh-token",
		"client_id":           "public-client",
		"expires_at":          strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10),
		"connection_protocol": "graph",
	})
	fetcher := NewFetcherService(repository.NewEmailAccountRepository(db), nil, db)
	fetcher.outlookHTTPClientFactory = func(string) *http.Client {
		t.Fatal("Graph probe ran for an Exchange resource token")
		return nil
	}
	probeCalls := 0
	fetcher.outlookIMAPProtocolProbe = func(context.Context, models.EmailAccount) error {
		probeCalls++
		return nil
	}

	result, err := fetcher.DetectOutlookProtocol(context.Background(), account)
	if err != nil {
		t.Fatalf("detect Outlook protocol: %v", err)
	}
	if result.Protocol != "imap" || !result.Changed || result.Method != "imap_xoauth2_probe" {
		t.Fatalf("detection result = %+v", result)
	}
	if probeCalls != 1 {
		t.Fatalf("IMAP probe calls = %d, want 1", probeCalls)
	}
	assertPersistedOutlookProtocol(t, db, account.ID, "imap", "imap_xoauth2_probe")
}

func TestDetectOutlookProtocolDoesNotPersistFailedExchangeProbe(t *testing.T) {
	db, account := newOutlookProtocolDetectionTestAccount(t, models.JSONMap{
		"access_token":        "EwA-valid-shape-only",
		"expires_at":          strconv.FormatInt(time.Now().Add(time.Hour).Unix(), 10),
		"connection_protocol": "graph",
	})
	fetcher := NewFetcherService(repository.NewEmailAccountRepository(db), nil, db)
	fetcher.outlookIMAPProtocolProbe = func(context.Context, models.EmailAccount) error {
		return errors.New("OAuth2 authentication failed")
	}
	if _, err := fetcher.DetectOutlookProtocol(context.Background(), account); err == nil {
		t.Fatal("Exchange-shaped token succeeded without IMAP capability")
	}
	var persisted models.EmailAccount
	if err := db.First(&persisted, account.ID).Error; err != nil {
		t.Fatalf("reload account: %v", err)
	}
	if protocol := persisted.CustomSettings["connection_protocol"]; protocol != "graph" {
		t.Fatalf("failed probe changed protocol to %q", protocol)
	}
}

func TestOutlookIMAPProbeHonorsContextDeadline(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr == nil {
			accepted <- conn
		}
	}()
	address := listener.Addr().(*net.TCPAddr)
	account := models.EmailAccount{
		EmailAddress: "timeout@example.com",
		AuthType:     models.AuthTypeOAuth2,
		MailProvider: &models.MailProvider{IMAPServer: "127.0.0.1", IMAPPort: address.Port},
	}
	fetcher := NewFetcherService(nil, nil, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, probeErr := fetcher.getImapFoldersWithContext(ctx, account)
	if probeErr == nil {
		t.Fatal("hanging IMAP server unexpectedly succeeded")
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("IMAP probe ignored context deadline; elapsed=%v", elapsed)
	}
	select {
	case conn := <-accepted:
		_ = conn.Close()
	default:
	}
}

func newOutlookProtocolDetectionTestAccount(t *testing.T, settings models.JSONMap) (*gorm.DB, models.EmailAccount) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.EmailAccount{}); err != nil {
		t.Fatalf("migrate account: %v", err)
	}
	account := models.EmailAccount{
		OrgID:          1,
		EmailAddress:   fmt.Sprintf("protocol-%d@example.com", time.Now().UnixNano()),
		AuthType:       models.AuthTypeOAuth2,
		CustomSettings: settings,
		MailProvider: &models.MailProvider{
			Type:       models.ProviderTypeOutlook,
			IMAPServer: "outlook.office365.com",
			IMAPPort:   993,
		},
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}
	return db, account
}

func assertPersistedOutlookProtocol(t *testing.T, db *gorm.DB, accountID uint, protocol, method string) {
	t.Helper()
	var persisted models.EmailAccount
	if err := db.First(&persisted, accountID).Error; err != nil {
		t.Fatalf("reload account: %v", err)
	}
	if got := persisted.CustomSettings["connection_protocol"]; got != protocol {
		t.Fatalf("persisted protocol = %q, want %q", got, protocol)
	}
	if got := persisted.CustomSettings["protocol_detection_method"]; got != method {
		t.Fatalf("persisted method = %q, want %q", got, method)
	}
	if persisted.CustomSettings["protocol_detected_at"] == "" {
		t.Fatal("protocol detection timestamp was not persisted")
	}
}
