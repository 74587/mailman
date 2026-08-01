package services

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
)

const outlookPickupRESTMaxAttempts = 3

func recordOutlookHTTPRequest(source EmailIngestSource, operation string, start time.Time, resp *http.Response, err error) {
	statusCode := 0
	if resp != nil {
		statusCode = resp.StatusCode
	}
	RuntimeMetrics().RecordOutlookRequest(source, operation, statusCode, time.Since(start), err)
}

func shouldRetryOutlookRESTPickupError(source EmailIngestSource, err error, attempt int) bool {
	if source != EmailIngestSourcePickup || err == nil || attempt >= outlookPickupRESTMaxAttempts {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "connection reset") ||
		strings.Contains(message, "connection reset by peer") ||
		strings.Contains(message, "unexpected eof") ||
		strings.Contains(message, "eof") ||
		strings.Contains(message, "broken pipe")
}

func outlookRESTPickupRetryDelay(attempt int) time.Duration {
	return time.Duration(attempt) * 200 * time.Millisecond
}

func (s *FetcherService) shouldUseOutlookGraphAPI(account models.EmailAccount) bool {
	return s.shouldUseOutlookGraphAPIWithSource(account, EmailIngestSourceManualSync)
}

func (s *FetcherService) shouldUseOutlookGraphAPIWithSource(account models.EmailAccount, source EmailIngestSource) bool {
	// Must be Outlook OAuth2 account
	if account.AuthType != models.AuthTypeOAuth2 ||
		account.MailProvider == nil ||
		account.MailProvider.Type != models.ProviderTypeOutlook {
		return false
	}

	protocol := strings.ToLower(strings.TrimSpace(account.CustomSettings["connection_protocol"]))
	if protocol == "" {
		protocol = inferOutlookProtocolFromAccessToken(account.CustomSettings["access_token"])
		if protocol == "" && strings.TrimSpace(account.CustomSettings["refresh_token"]) != "" {
			if refreshed, err := s.refreshOutlookAccessTokenWithSource(account, source, false); err == nil {
				protocol = inferOutlookProtocolFromAccessToken(refreshed.AccessToken)
			} else {
				s.logger.Warn("Unable to migrate Outlook protocol for account %d from its refresh token: %v", account.ID, err)
			}
		}
		if protocol != "" && account.ID != 0 && s.oauth2Service != nil {
			if err := s.oauth2Service.mergeAccountCustomSettings(string(models.ProviderTypeOutlook), account.ID, map[string]string{
				"connection_protocol":       protocol,
				"protocol_detection_method": "token_audience_migration",
				"protocol_detected_at":      strconv.FormatInt(time.Now().Unix(), 10),
			}); err != nil {
				s.logger.Warn("Unable to persist migrated Outlook protocol for account %d: %v", account.ID, err)
			}
		}
	}
	if protocol != "graph" {
		// The built-in Outlook OAuth flow grants IMAP/POP/SMTP scopes. Legacy
		// accounts are migrated above only when their token audience proves Graph;
		// unknown tokens remain on the safe IMAP path.
		return false
	}

	accessToken := strings.TrimSpace(account.CustomSettings["access_token"])
	if strings.HasPrefix(strings.ToUpper(accessToken), "EWA") {
		// Repair accounts that were incorrectly marked as Graph by the old
		// token-shape heuristic. EwA tokens are Exchange/IMAP resource tokens.
		s.logger.Warn("Outlook account %d is marked graph but has an IMAP-scoped token; using IMAP", account.ID)
		return false
	}

	s.logger.Debug("Outlook account %d explicitly uses Microsoft Graph", account.ID)
	return true
}

// inferOutlookProtocolFromAccessToken uses the token resource audience, not
// JWT shape alone. This keeps legacy Graph accounts working without routing an
// Exchange/IMAP token to Graph.
func inferOutlookProtocolFromAccessToken(accessToken string) string {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return ""
	}
	if isOutlookExchangeResourceToken(accessToken) {
		return "imap"
	}
	parts := strings.Split(accessToken, ".")
	if len(parts) < 2 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return ""
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	var audiences []string
	switch value := claims["aud"].(type) {
	case string:
		audiences = append(audiences, value)
	case []interface{}:
		for _, item := range value {
			if audience, ok := item.(string); ok {
				audiences = append(audiences, audience)
			}
		}
	}
	for _, audience := range audiences {
		normalized := strings.ToLower(strings.TrimSpace(audience))
		switch {
		case normalized == "00000003-0000-0000-c000-000000000000",
			normalized == "https://graph.microsoft.com",
			strings.HasPrefix(normalized, "https://graph.microsoft.com/"):
			return "graph"
		case normalized == "00000002-0000-0ff1-ce00-000000000000",
			strings.Contains(normalized, "outlook.office.com"),
			strings.Contains(normalized, "outlook.office365.com"):
			return "imap"
		}
	}
	return ""
}

// verifyOutlookGraphConnection verifies Outlook OAuth2 connection using Graph API or Outlook REST API v2.0

func (s *FetcherService) verifyOutlookGraphConnection(account models.EmailAccount) error {
	return s.verifyOutlookGraphConnectionWithSource(account, EmailIngestSourceManualSync)
}

func (s *FetcherService) verifyOutlookGraphConnectionWithSource(account models.EmailAccount, source EmailIngestSource) error {
	s.logger.Info("Verifying Outlook Graph API connection for %s", account.EmailAddress)

	// Get access token
	accessToken, err := s.getOutlookAccessTokenWithSource(account, source)
	if err != nil {
		s.logger.Error("Failed to get Outlook access token: %v", err)
		return fmt.Errorf("failed to get access token: %w", err)
	}

	result, err := s.doOutlookGraphGET(
		context.Background(),
		account,
		source,
		"mailFolders",
		"https://graph.microsoft.com/v1.0/me/mailFolders",
		accessToken,
		nil,
	)
	if err != nil {
		return err
	}

	if result.StatusCode != http.StatusOK {
		s.logger.Error("Graph API returned status %d: %s", result.StatusCode, string(result.Body))
		return fmt.Errorf("Graph API verification failed with status %d: %s", result.StatusCode, string(result.Body))
	}

	// Parse response to verify we got folders
	var foldersResponse struct {
		Value []struct {
			Id          string `json:"id"`
			DisplayName string `json:"displayName"`
		} `json:"value"`
	}

	if err := json.Unmarshal(result.Body, &foldersResponse); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	s.logger.Info("Outlook Graph API connection verified successfully for %s, found %d folders",
		account.EmailAddress, len(foldersResponse.Value))
	return nil
}

// verifyOutlookRESTConnection verifies Outlook OAuth2 connection using Outlook REST API v2.0

func (s *FetcherService) verifyOutlookRESTConnection(account models.EmailAccount, accessToken string) error {
	return s.verifyOutlookRESTConnectionWithSource(account, accessToken, EmailIngestSourceManualSync)
}

func (s *FetcherService) verifyOutlookRESTConnectionWithSource(account models.EmailAccount, accessToken string, source EmailIngestSource) error {
	// Create HTTP client with proxy support
	httpClient := s.createOutlookHTTPClient(account.Proxy)

	// Test connection by getting mail folders using REST API v2.0
	// Note: REST API uses PascalCase for resource names, so /Me/MailFolders, but /me/mailFolders often works too.
	// Documentation says https://outlook.office.com/api/v2.0/me/mailfolders
	req, err := http.NewRequest("GET", "https://outlook.office.com/api/v2.0/me/mailfolders", nil)
	if err != nil {
		return fmt.Errorf("failed to create REST API request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	releaseSlot, err := s.acquireOutlookRequestSlot(source, "REST mailFolders verification")
	if err != nil {
		return err
	}
	requestStart := time.Now()
	resp, err := httpClient.Do(req)
	recordOutlookHTTPRequest(source, "mailFolders", requestStart, resp, err)
	if err != nil {
		releaseSlot()
		s.logger.Error("Failed to make REST API request: %v", err)
		return fmt.Errorf("REST API request failed: %w", err)
	}
	defer releaseSlot()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		s.logger.Error("REST API returned status %d: %s", resp.StatusCode, string(body))
		return fmt.Errorf("REST API verification failed with status %d: %s", resp.StatusCode, string(body))
	}

	// Parse response to verify we got folders (PascalCase)
	var foldersResponse struct {
		Value []struct {
			Id          string `json:"Id"`
			DisplayName string `json:"DisplayName"`
		} `json:"value"`
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	if err := json.Unmarshal(body, &foldersResponse); err != nil {
		return fmt.Errorf("failed to parse response: %w", err)
	}

	s.logger.Info("Outlook REST API connection verified successfully for %s, found %d folders",
		account.EmailAddress, len(foldersResponse.Value))
	return nil
}

// getOutlookAccessToken gets a valid access token for Outlook Graph API

func (s *FetcherService) getOutlookAccessToken(account models.EmailAccount) (string, error) {
	return s.getOutlookAccessTokenWithSource(account, EmailIngestSourceManualSync)
}

func (s *FetcherService) getOutlookAccessTokenWithSource(account models.EmailAccount, source EmailIngestSource) (string, error) {
	if account.CustomSettings == nil {
		return "", fmt.Errorf("OAuth2 tokens not found in account settings")
	}

	accessToken := strings.TrimSpace(account.CustomSettings["access_token"])
	if accessToken != "" {
		if expiresAt, err := strconv.ParseInt(account.CustomSettings["expires_at"], 10, 64); err == nil && time.Now().Unix() < expiresAt-300 {
			s.logger.Debug("Using existing Outlook access token (expires_at: %d)", expiresAt)
			return accessToken, nil
		}
	}

	if strings.TrimSpace(account.CustomSettings["refresh_token"]) == "" {
		if accessToken != "" {
			s.logger.Debug("No refresh token available; validating the stored Outlook access token")
			return accessToken, nil
		}
		return "", fmt.Errorf("no access_token or refresh_token found in account settings")
	}

	result, err := s.refreshOutlookAccessTokenWithSource(account, source, false)
	if err != nil {
		return "", fmt.Errorf("failed to refresh access token: %w", err)
	}
	return result.AccessToken, nil
}

func (s *FetcherService) refreshOutlookAccessTokenWithSource(account models.EmailAccount, source EmailIngestSource, force bool) (OAuth2TokenRefreshResult, error) {
	refreshToken := strings.TrimSpace(account.CustomSettings["refresh_token"])
	if refreshToken == "" {
		return OAuth2TokenRefreshResult{}, fmt.Errorf("refresh_token not found for Outlook account")
	}

	clientID := strings.TrimSpace(account.CustomSettings["client_id"])
	clientSecret := strings.TrimSpace(account.CustomSettings["client_secret"])
	if clientID == "" {
		repo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())
		var config *models.OAuth2GlobalConfig
		var err error
		if account.OAuth2ProviderID != nil && *account.OAuth2ProviderID > 0 {
			config, err = repo.GetByID(*account.OAuth2ProviderID)
			if err != nil {
				s.logger.Warn("Failed to get Outlook OAuth2 config %d: %v", *account.OAuth2ProviderID, err)
			}
		}
		if config == nil {
			config, err = repo.GetByProviderType(models.ProviderTypeOutlook)
			if err != nil {
				return OAuth2TokenRefreshResult{}, fmt.Errorf("failed to get Outlook OAuth2 config: %w", err)
			}
		}
		if config != nil {
			clientID = config.ClientID
			clientSecret = config.ClientSecret
		}
	}
	if clientID == "" {
		return OAuth2TokenRefreshResult{}, fmt.Errorf("client_id not found for Outlook OAuth2 account")
	}

	s.logger.Debug("Refreshing Outlook Graph token for account %d (force=%t, source=%s)", account.ID, force, source)
	return s.oauth2Service.RefreshAccessTokenWithCacheAndProxyResult(
		string(models.ProviderTypeOutlook),
		clientID,
		clientSecret,
		refreshToken,
		account.ID,
		account.Proxy,
		OAuth2RefreshOptions{Force: force, OmitScopes: true},
	)
}

// createOutlookHTTPClient creates an HTTP client with optional proxy support

func (s *FetcherService) createOutlookHTTPClient(proxyURL string) *http.Client {
	if s.outlookHTTPClientFactory != nil {
		return s.outlookHTTPClientFactory(proxyURL)
	}
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{},
	}

	if proxyURL != "" {
		if parsedURL, err := url.Parse(proxyURL); err == nil {
			transport.Proxy = http.ProxyURL(parsedURL)
			s.logger.Debug("Using proxy for Outlook Graph API: %s", proxyURL)
		}
	}

	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}
}

type outlookGraphHTTPResult struct {
	StatusCode  int
	Body        []byte
	AccessToken string
}

// doOutlookGraphGET retries exactly once after a 401. The retry forces a token
// refresh and persists any rotated refresh token before the request is replayed.
func (s *FetcherService) doOutlookGraphGET(
	ctx context.Context,
	account models.EmailAccount,
	source EmailIngestSource,
	operation string,
	requestURL string,
	accessToken string,
	headers map[string]string,
) (outlookGraphHTTPResult, error) {
	if err := validateOutlookGraphRequestURL(requestURL); err != nil {
		return outlookGraphHTTPResult{}, err
	}
	client := s.createOutlookHTTPClient(account.Proxy)
	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
		if err != nil {
			return outlookGraphHTTPResult{}, fmt.Errorf("failed to create Graph API request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json")
		for key, value := range headers {
			req.Header.Set(key, value)
		}

		releaseSlot, err := s.acquireOutlookRequestSlotWithContext(ctx, source, operation)
		if err != nil {
			return outlookGraphHTTPResult{}, err
		}
		requestStart := time.Now()
		resp, requestErr := client.Do(req)
		recordOutlookHTTPRequest(source, operation, requestStart, resp, requestErr)
		if requestErr != nil {
			releaseSlot()
			return outlookGraphHTTPResult{}, fmt.Errorf("Graph API request failed: %w", requestErr)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		releaseSlot()
		if readErr != nil {
			return outlookGraphHTTPResult{}, fmt.Errorf("failed to read Graph API response: %w", readErr)
		}

		if resp.StatusCode == http.StatusUnauthorized && attempt == 0 {
			refreshed, refreshErr := s.refreshOutlookAccessTokenWithSource(account, source, true)
			if refreshErr != nil {
				return outlookGraphHTTPResult{}, fmt.Errorf("Graph API returned 401 and token refresh failed: %w", refreshErr)
			}
			accessToken = refreshed.AccessToken
			continue
		}
		return outlookGraphHTTPResult{StatusCode: resp.StatusCode, Body: body, AccessToken: accessToken}, nil
	}
	return outlookGraphHTTPResult{}, fmt.Errorf("Graph API request retry exhausted")
}

func validateOutlookGraphRequestURL(requestURL string) error {
	parsed, err := url.Parse(requestURL)
	if err != nil {
		return fmt.Errorf("invalid Graph API request URL: %w", err)
	}
	if !strings.EqualFold(parsed.Scheme, "https") ||
		!strings.EqualFold(parsed.Hostname(), "graph.microsoft.com") ||
		(parsed.Port() != "" && parsed.Port() != "443") ||
		parsed.User != nil {
		return fmt.Errorf("refusing untrusted Graph API request URL %q", requestURL)
	}
	return nil
}

// fetchEmailsFromOutlookGraphAPI fetches emails using Microsoft Graph API.

func (s *FetcherService) fetchEmailsFromOutlookGraphAPI(account models.EmailAccount, options FetchEmailsOptions) ([]models.Email, error) {
	ctx := options.contextOrBackground()
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	// Get access token
	accessToken, err := s.getOutlookAccessTokenWithSource(account, options.Source)
	if err != nil {
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	s.logger.Debug("Fetching emails using Outlook Graph API for account %s", account.EmailAddress)
	targets, accessToken, err := s.resolveOutlookGraphFetchTargets(ctx, account, options, accessToken)
	if err != nil {
		return nil, err
	}

	var emails []models.Email
	for _, target := range targets {
		folderEmails, refreshedToken, fetchErr := s.fetchOutlookGraphTarget(ctx, account, options, target, accessToken)
		if fetchErr != nil {
			return nil, fetchErr
		}
		accessToken = refreshedToken
		emails = append(emails, folderEmails...)
	}

	// Update last sync time
	if err := s.accountRepo.UpdateLastSync(account.ID); err != nil {
		s.logger.Warn("Failed to update last sync time: %v", err)
	}

	s.logger.Info("Successfully fetched %d emails from Outlook Graph API for %s", len(emails), account.EmailAddress)
	return emails, nil
}

const outlookGraphMessagePageSize = 100

type outlookGraphFetchTarget struct {
	FolderID string
	Mailbox  string
}

func (s *FetcherService) resolveOutlookGraphFetchTargets(
	ctx context.Context,
	account models.EmailAccount,
	options FetchEmailsOptions,
	accessToken string,
) ([]outlookGraphFetchTarget, string, error) {
	folderNames := append([]string(nil), options.Folders...)
	if len(folderNames) == 0 {
		mailbox := strings.TrimSpace(options.Mailbox)
		if mailbox == "" {
			mailbox = "INBOX"
		}
		folderNames = []string{mailbox}
	}

	targets := make([]outlookGraphFetchTarget, 0, len(folderNames))
	customFolders := false
	seenNames := make(map[string]struct{}, len(folderNames))
	for _, folderName := range folderNames {
		folderName = strings.TrimSpace(folderName)
		if folderName == "" {
			continue
		}
		normalized := strings.ToLower(folderName)
		if _, exists := seenNames[normalized]; exists {
			continue
		}
		seenNames[normalized] = struct{}{}
		if folderID := outlookGraphWellKnownFolderID(folderName); folderID != "" {
			targets = append(targets, outlookGraphFetchTarget{FolderID: folderID, Mailbox: folderName})
		} else {
			customFolders = true
			targets = append(targets, outlookGraphFetchTarget{Mailbox: folderName})
		}
	}
	if len(targets) == 0 {
		return nil, accessToken, fmt.Errorf("no Outlook folders were selected")
	}
	if !customFolders {
		return targets, accessToken, nil
	}

	foldersByName, refreshedToken, err := s.loadOutlookGraphFolderIDs(ctx, account, options.Source, accessToken)
	if err != nil {
		return nil, accessToken, err
	}
	for index := range targets {
		if targets[index].FolderID != "" {
			continue
		}
		folderID := foldersByName[strings.ToLower(targets[index].Mailbox)]
		if folderID == "" {
			return nil, refreshedToken, fmt.Errorf("Outlook folder %q was not found", targets[index].Mailbox)
		}
		targets[index].FolderID = folderID
	}
	return targets, refreshedToken, nil
}

func outlookGraphWellKnownFolderID(folderName string) string {
	normalized := strings.ToLower(strings.TrimSpace(folderName))
	switch normalized {
	case "inbox":
		return "inbox"
	case "archive":
		return "archive"
	case "drafts":
		return "drafts"
	case "sent", "sent items", "sentitems":
		return "sentitems"
	case "deleted", "deleted items", "deleteditems", "trash":
		return "deleteditems"
	case "junk", "junk email", "junkemail", "spam":
		return "junkemail"
	case "outbox":
		return "outbox"
	}
	return ""
}

func (s *FetcherService) loadOutlookGraphFolderIDs(
	ctx context.Context,
	account models.EmailAccount,
	source EmailIngestSource,
	accessToken string,
) (map[string]string, string, error) {
	type graphFolder struct {
		ID               string `json:"id"`
		DisplayName      string `json:"displayName"`
		ChildFolderCount int    `json:"childFolderCount"`
	}
	type graphFolderResponse struct {
		Value    []graphFolder `json:"value"`
		NextLink string        `json:"@odata.nextLink"`
	}

	rootQuery := url.Values{}
	rootQuery.Set("$top", "100")
	rootQuery.Set("$select", "id,displayName,childFolderCount")
	rootQuery.Set("includeHiddenFolders", "true")
	queue := []string{"https://graph.microsoft.com/v1.0/me/mailFolders?" + rootQuery.Encode()}
	folders := make(map[string]string)
	seenURLs := make(map[string]struct{})
	for len(queue) > 0 {
		requestURL := queue[0]
		queue = queue[1:]
		if _, exists := seenURLs[requestURL]; exists {
			continue
		}
		seenURLs[requestURL] = struct{}{}
		result, err := s.doOutlookGraphGET(ctx, account, source, "mailFolders", requestURL, accessToken, nil)
		if err != nil {
			return nil, accessToken, err
		}
		accessToken = result.AccessToken
		if result.StatusCode != http.StatusOK {
			return nil, accessToken, fmt.Errorf("Graph folder listing failed with status %d: %s", result.StatusCode, string(result.Body))
		}
		var response graphFolderResponse
		if err := json.Unmarshal(result.Body, &response); err != nil {
			return nil, accessToken, fmt.Errorf("failed to parse Graph folder listing: %w", err)
		}
		for _, folder := range response.Value {
			name := strings.ToLower(strings.TrimSpace(folder.DisplayName))
			if name != "" {
				if _, exists := folders[name]; !exists {
					folders[name] = folder.ID
				}
			}
			if folder.ChildFolderCount > 0 && folder.ID != "" {
				childQuery := url.Values{}
				childQuery.Set("$top", "100")
				childQuery.Set("$select", "id,displayName,childFolderCount")
				childQuery.Set("includeHiddenFolders", "true")
				queue = append(queue, fmt.Sprintf("https://graph.microsoft.com/v1.0/me/mailFolders/%s/childFolders?%s", url.PathEscape(folder.ID), childQuery.Encode()))
			}
		}
		if response.NextLink != "" {
			queue = append(queue, response.NextLink)
		}
	}
	return folders, accessToken, nil
}

func (s *FetcherService) fetchOutlookGraphTarget(
	ctx context.Context,
	account models.EmailAccount,
	options FetchEmailsOptions,
	target outlookGraphFetchTarget,
	accessToken string,
) ([]models.Email, string, error) {
	queryParams := url.Values{}
	queryParams.Set("$select", "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,hasAttachments,isRead,importance,internetMessageId")
	queryParams.Set("$orderby", "receivedDateTime desc")
	pageSize := outlookGraphMessagePageSize
	if options.Limit > 0 && options.Limit < pageSize {
		pageSize = options.Limit
	}
	queryParams.Set("$top", strconv.Itoa(pageSize))
	if options.Offset > 0 {
		queryParams.Set("$skip", strconv.Itoa(options.Offset))
	}
	var filters []string
	if options.StartDate != nil {
		filters = append(filters, fmt.Sprintf("receivedDateTime ge %s", options.StartDate.UTC().Format(time.RFC3339)))
	}
	if options.EndDate != nil {
		filters = append(filters, fmt.Sprintf("receivedDateTime le %s", options.EndDate.UTC().Format(time.RFC3339)))
	}
	if len(filters) > 0 {
		queryParams.Set("$filter", strings.Join(filters, " and "))
	}
	if options.SearchQuery != "" {
		queryParams.Set("$search", fmt.Sprintf(`"%s"`, options.SearchQuery))
	}

	requestURL := fmt.Sprintf("https://graph.microsoft.com/v1.0/me/mailFolders/%s/messages?%s", url.PathEscape(target.FolderID), queryParams.Encode())
	headers := map[string]string{"Prefer": "outlook.body-content-type=\"html\""}
	if options.SearchQuery != "" {
		headers["ConsistencyLevel"] = "eventual"
	}
	seenURLs := make(map[string]struct{})
	var emails []models.Email
	for requestURL != "" {
		if _, exists := seenURLs[requestURL]; exists {
			return nil, accessToken, fmt.Errorf("Graph pagination loop detected for folder %q", target.Mailbox)
		}
		seenURLs[requestURL] = struct{}{}
		result, err := s.doOutlookGraphGET(ctx, account, options.Source, "messages", requestURL, accessToken, headers)
		if err != nil {
			return nil, accessToken, err
		}
		accessToken = result.AccessToken
		if result.StatusCode != http.StatusOK {
			return nil, accessToken, fmt.Errorf("Graph API request failed with status %d: %s", result.StatusCode, string(result.Body))
		}
		var response struct {
			Value    []OutlookMessage `json:"value"`
			NextLink string           `json:"@odata.nextLink"`
		}
		if err := json.Unmarshal(result.Body, &response); err != nil {
			return nil, accessToken, fmt.Errorf("failed to parse Graph messages response: %w", err)
		}
		for _, message := range response.Value {
			emails = append(emails, s.convertOutlookMessage(message, account.ID, target.Mailbox))
			if options.Limit > 0 && len(emails) >= options.Limit {
				return emails, accessToken, nil
			}
		}
		requestURL = response.NextLink
	}
	return emails, accessToken, nil
}

// OutlookRESTMessage represents a message from Outlook REST API v2.0 (PascalCase)

type OutlookRESTMessage struct {
	Id      string `json:"Id"`
	Subject string `json:"Subject"`
	From    *struct {
		EmailAddress struct {
			Name    string `json:"Name"`
			Address string `json:"Address"`
		} `json:"EmailAddress"`
	} `json:"From"`
	ToRecipients []struct {
		EmailAddress struct {
			Name    string `json:"Name"`
			Address string `json:"Address"`
		} `json:"EmailAddress"`
	} `json:"ToRecipients"`
	CcRecipients []struct {
		EmailAddress struct {
			Name    string `json:"Name"`
			Address string `json:"Address"`
		} `json:"EmailAddress"`
	} `json:"CcRecipients"`
	ReceivedDateTime string `json:"ReceivedDateTime"`
	BodyPreview      string `json:"BodyPreview"`
	Body             *struct {
		ContentType string `json:"ContentType"`
		Content     string `json:"Content"`
	} `json:"Body"`
	HasAttachments    bool   `json:"HasAttachments"`
	IsRead            bool   `json:"IsRead"`
	Importance        string `json:"Importance"`
	InternetMessageId string `json:"InternetMessageId"`
}

// fetchEmailsFromOutlookRESTAPI fetches emails using the legacy Outlook REST API v2.0
func (s *FetcherService) fetchEmailsFromOutlookRESTAPI(account models.EmailAccount, accessToken string, options FetchEmailsOptions) ([]models.Email, error) {
	s.logger.Debug("Fetching emails using Outlook REST API v2.0 for account %s", account.EmailAddress)
	ctx := options.contextOrBackground()
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	// Create HTTP client
	httpClient := s.createOutlookHTTPClient(account.Proxy)

	// Base URL for Outlook REST API v2.0
	// Note: Use outlook.office.com as verified in testing
	baseURL := "https://outlook.office.com/api/v2.0/me/messages"

	// Build OData query parameters
	queryParams := url.Values{}

	// Select fields to retrieve - IMPORTANT: Keys must be PascalCase matching REST API
	queryParams.Set("$select", "Id,Subject,From,ToRecipients,CcRecipients,ReceivedDateTime,BodyPreview,Body,HasAttachments,IsRead,Importance,InternetMessageId")

	// Order by received date
	queryParams.Set("$orderby", "ReceivedDateTime desc")

	// Limit results
	if options.Limit > 0 {
		queryParams.Set("$top", strconv.Itoa(options.Limit))
	} else {
		queryParams.Set("$top", "50")
	}

	// Skip for pagination
	if options.Offset > 0 {
		queryParams.Set("$skip", strconv.Itoa(options.Offset))
	}

	// Build filter for date range (Field names must be PascalCase)
	var filters []string
	if options.StartDate != nil {
		filters = append(filters, fmt.Sprintf("ReceivedDateTime ge %s", options.StartDate.Format(time.RFC3339)))
	}
	if options.EndDate != nil {
		filters = append(filters, fmt.Sprintf("ReceivedDateTime le %s", options.EndDate.Format(time.RFC3339)))
	}
	if len(filters) > 0 {
		queryParams.Set("$filter", strings.Join(filters, " and "))
	}

	// Search query
	if options.SearchQuery != "" {
		queryParams.Set("$search", fmt.Sprintf(`"%s"`, options.SearchQuery))
	}

	requestURL := baseURL + "?" + queryParams.Encode()
	s.logger.Debug("Outlook REST API request URL: %s", requestURL)

	var resp *http.Response
	for attempt := 1; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, "GET", requestURL, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json")
		// REST API v2.0 specific headers
		req.Header.Set("Accept", "application/json")

		releaseSlot, err := s.acquireOutlookRequestSlotWithContext(ctx, options.Source, "REST messages fetch")
		if err != nil {
			return nil, err
		}
		requestStart := time.Now()
		resp, err = httpClient.Do(req)
		recordOutlookHTTPRequest(options.Source, "messages", requestStart, resp, err)
		if err == nil {
			defer releaseSlot()
			defer resp.Body.Close()
			break
		}
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}
		releaseSlot()
		if !shouldRetryOutlookRESTPickupError(options.Source, err, attempt) {
			return nil, fmt.Errorf("REST API request failed: %w", err)
		}
		delay := outlookRESTPickupRetryDelay(attempt)
		s.logger.Warn("Outlook REST pickup messages request failed for account %d (attempt %d/%d): %v; retrying in %s",
			account.ID, attempt, outlookPickupRESTMaxAttempts, err, delay)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(delay):
		}
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		s.logger.Error("REST API returned status %d: %s", resp.StatusCode, string(body))
		return nil, fmt.Errorf("REST API request failed with status %d", resp.StatusCode)
	}

	// Parse response
	var messagesResponse struct {
		Value []OutlookRESTMessage `json:"value"`
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if err := json.Unmarshal(body, &messagesResponse); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Convert to internal Email model
	var emails []models.Email
	for _, msg := range messagesResponse.Value {
		// reuse convertOutlookMessage but we need to map REST message to OutlookMessage first
		// or duplicate conversion logic. Mapping seems cleaner.
		graphMsg := OutlookMessage{
			Id:                msg.Id,
			Subject:           msg.Subject,
			ReceivedDateTime:  msg.ReceivedDateTime,
			BodyPreview:       msg.BodyPreview,
			HasAttachments:    msg.HasAttachments,
			IsRead:            msg.IsRead,
			Importance:        msg.Importance,
			InternetMessageId: msg.InternetMessageId,
		}

		if msg.From != nil {
			graphMsg.From = &struct {
				EmailAddress struct {
					Name    string `json:"name"`
					Address string `json:"address"`
				} `json:"emailAddress"`
			}{
				EmailAddress: struct {
					Name    string `json:"name"`
					Address string `json:"address"`
				}{
					Name:    msg.From.EmailAddress.Name,
					Address: msg.From.EmailAddress.Address,
				},
			}
		}

		if msg.Body != nil {
			graphMsg.Body = &struct {
				ContentType string `json:"contentType"`
				Content     string `json:"content"`
			}{
				ContentType: msg.Body.ContentType, // Note: REST API might return "HTML" vs "html", conversion handles normalized check?
				Content:     msg.Body.Content,
			}
			// Normalization: Graph API returns lowercase "html", REST might return "HTML".
			// Check logic in convertOutlookMessage: it checks `if msg.Body.ContentType == "html"`.
			// Let's normalize it to lowercase here to be safe.
			graphMsg.Body.ContentType = strings.ToLower(msg.Body.ContentType)
		}

		for _, recipient := range msg.ToRecipients {
			graphMsg.ToRecipients = append(graphMsg.ToRecipients, struct {
				EmailAddress struct {
					Name    string `json:"name"`
					Address string `json:"address"`
				} `json:"emailAddress"`
			}{
				EmailAddress: struct {
					Name    string `json:"name"`
					Address string `json:"address"`
				}{
					Name:    recipient.EmailAddress.Name,
					Address: recipient.EmailAddress.Address,
				},
			})
		}

		for _, recipient := range msg.CcRecipients {
			graphMsg.CcRecipients = append(graphMsg.CcRecipients, struct {
				EmailAddress struct {
					Name    string `json:"name"`
					Address string `json:"address"`
				} `json:"emailAddress"`
			}{
				EmailAddress: struct {
					Name    string `json:"name"`
					Address string `json:"address"`
				}{
					Name:    recipient.EmailAddress.Name,
					Address: recipient.EmailAddress.Address,
				},
			})
		}

		email := s.convertOutlookMessage(graphMsg, account.ID, options.Mailbox)
		emails = append(emails, email)
	}

	// Update last sync time
	if err := s.accountRepo.UpdateLastSync(account.ID); err != nil {
		s.logger.Warn("Failed to update last sync time: %v", err)
	}

	s.logger.Info("Successfully fetched %d emails from Outlook REST API for %s", len(emails), account.EmailAddress)
	return emails, nil
}

// OutlookMessage represents a message from Microsoft Graph API

type OutlookMessage struct {
	Id      string `json:"id"`
	Subject string `json:"subject"`
	From    *struct {
		EmailAddress struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		} `json:"emailAddress"`
	} `json:"from"`
	ToRecipients []struct {
		EmailAddress struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		} `json:"emailAddress"`
	} `json:"toRecipients"`
	CcRecipients []struct {
		EmailAddress struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		} `json:"emailAddress"`
	} `json:"ccRecipients"`
	ReceivedDateTime string `json:"receivedDateTime"`
	BodyPreview      string `json:"bodyPreview"`
	Body             *struct {
		ContentType string `json:"contentType"`
		Content     string `json:"content"`
	} `json:"body"`
	HasAttachments    bool   `json:"hasAttachments"`
	IsRead            bool   `json:"isRead"`
	Importance        string `json:"importance"`
	InternetMessageId string `json:"internetMessageId"`
}

// convertOutlookMessage converts an Outlook Graph API message to internal Email model
func (s *FetcherService) convertOutlookMessage(msg OutlookMessage, accountID uint, mailbox string) models.Email {
	email := models.Email{
		AccountID:   accountID,
		MessageID:   msg.InternetMessageId,
		Subject:     msg.Subject,
		MailboxName: mailbox,
	}

	// Parse received date
	if msg.ReceivedDateTime != "" {
		if t, err := time.Parse(time.RFC3339, msg.ReceivedDateTime); err == nil {
			email.Date = t
			email.ReceivedAt = t
		}
	}

	// Set From address as StringSlice
	if msg.From != nil {
		var fromAddr string
		if msg.From.EmailAddress.Name != "" {
			fromAddr = fmt.Sprintf("%s <%s>", msg.From.EmailAddress.Name, msg.From.EmailAddress.Address)
		} else {
			fromAddr = msg.From.EmailAddress.Address
		}
		email.From = models.StringSlice{fromAddr}
		email.FromAddress = msg.From.EmailAddress.Address
	}

	// Set To addresses
	var toAddrs []string
	for _, recipient := range msg.ToRecipients {
		if recipient.EmailAddress.Name != "" {
			toAddrs = append(toAddrs, fmt.Sprintf("%s <%s>", recipient.EmailAddress.Name, recipient.EmailAddress.Address))
		} else {
			toAddrs = append(toAddrs, recipient.EmailAddress.Address)
		}
	}
	email.To = models.StringSlice(toAddrs)

	// Set CC addresses
	var ccAddrs []string
	for _, recipient := range msg.CcRecipients {
		if recipient.EmailAddress.Name != "" {
			ccAddrs = append(ccAddrs, fmt.Sprintf("%s <%s>", recipient.EmailAddress.Name, recipient.EmailAddress.Address))
		} else {
			ccAddrs = append(ccAddrs, recipient.EmailAddress.Address)
		}
	}
	email.Cc = models.StringSlice(ccAddrs)

	// Set body
	if msg.Body != nil {
		if msg.Body.ContentType == "html" {
			email.HTMLBody = msg.Body.Content
			// Use body preview as text body
			email.Body = msg.BodyPreview
			email.TextBody = msg.BodyPreview
		} else {
			email.Body = msg.Body.Content
			email.TextBody = msg.Body.Content
		}
	} else {
		email.Body = msg.BodyPreview
		email.TextBody = msg.BodyPreview
	}

	// Set has attachments flag
	email.HasAttachments = msg.HasAttachments

	// Add read flag to Flags
	if msg.IsRead {
		email.Flags = models.StringSlice{"\\Seen"}
	}

	return email
}

// getOutlookMailboxes retrieves Outlook folders using Microsoft Graph.

func (s *FetcherService) getOutlookMailboxes(account models.EmailAccount) ([]models.Mailbox, error) {
	s.logger.Debug("Getting Outlook mailboxes using Graph API for account %s", account.EmailAddress)

	// Get access token
	accessToken, err := s.getOutlookAccessToken(account)
	if err != nil {
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	result, err := s.doOutlookGraphGET(
		context.Background(),
		account,
		EmailIngestSourceManualSync,
		"mailFolders",
		"https://graph.microsoft.com/v1.0/me/mailFolders?$top=100",
		accessToken,
		nil,
	)
	if err != nil {
		return nil, err
	}

	if result.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Graph API request failed with status %d: %s", result.StatusCode, string(result.Body))
	}

	// Parse response
	var foldersResponse struct {
		Value []struct {
			Id               string `json:"id"`
			DisplayName      string `json:"displayName"`
			TotalItemCount   int    `json:"totalItemCount"`
			UnreadItemCount  int    `json:"unreadItemCount"`
			ChildFolderCount int    `json:"childFolderCount"`
		} `json:"value"`
	}

	if err := json.Unmarshal(result.Body, &foldersResponse); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Convert to internal Mailbox model
	var mailboxes []models.Mailbox
	for _, folder := range foldersResponse.Value {
		mailbox := models.Mailbox{
			Name:      folder.DisplayName,
			AccountID: account.ID,
			Delimiter: "/",
		}

		// Add flags based on folder name
		switch strings.ToLower(folder.DisplayName) {
		case "inbox":
			mailbox.Flags = append(mailbox.Flags, "\\Inbox")
		case "sent items", "sent":
			mailbox.Flags = append(mailbox.Flags, "\\Sent")
		case "drafts":
			mailbox.Flags = append(mailbox.Flags, "\\Drafts")
		case "deleted items", "trash":
			mailbox.Flags = append(mailbox.Flags, "\\Trash")
		case "junk email", "spam":
			mailbox.Flags = append(mailbox.Flags, "\\Junk")
		case "archive":
			mailbox.Flags = append(mailbox.Flags, "\\Archive")
		}

		mailboxes = append(mailboxes, mailbox)
	}

	s.logger.Info("Successfully retrieved %d Outlook folders for account %s", len(mailboxes), account.EmailAddress)
	return mailboxes, nil
}

// getOutlookRESTMailboxes retrieves Outlook folders using REST API v2.0

func (s *FetcherService) getOutlookRESTMailboxes(account models.EmailAccount, accessToken string) ([]models.Mailbox, error) {
	s.logger.Debug("Getting Outlook mailboxes using REST API v2.0 for account %s", account.EmailAddress)

	// Create HTTP client
	httpClient := s.createOutlookHTTPClient(account.Proxy)

	// Get mail folders uinsg REST API
	req, err := http.NewRequest("GET", "https://outlook.office.com/api/v2.0/me/mailfolders?$top=100", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	releaseSlot, err := s.acquireOutlookRequestSlot(EmailIngestSourceManualSync, "REST mailFolders listing")
	if err != nil {
		return nil, err
	}
	requestStart := time.Now()
	resp, err := httpClient.Do(req)
	recordOutlookHTTPRequest(EmailIngestSourceManualSync, "mailFolders", requestStart, resp, err)
	if err != nil {
		releaseSlot()
		return nil, fmt.Errorf("REST API request failed: %w", err)
	}
	defer releaseSlot()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("REST API request failed with status %d: %s", resp.StatusCode, string(body))
	}

	// Parse response (PascalCase)
	var foldersResponse struct {
		Value []struct {
			Id               string `json:"Id"`
			DisplayName      string `json:"DisplayName"`
			TotalItemCount   int    `json:"TotalItemCount"`
			UnreadItemCount  int    `json:"UnreadItemCount"`
			ChildFolderCount int    `json:"ChildFolderCount"`
		} `json:"value"`
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if err := json.Unmarshal(body, &foldersResponse); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Convert to internal Mailbox model
	var mailboxes []models.Mailbox
	for _, folder := range foldersResponse.Value {
		mailbox := models.Mailbox{
			Name:      folder.DisplayName,
			AccountID: account.ID,
			Delimiter: "/",
		}

		// Add flags based on folder name
		switch strings.ToLower(folder.DisplayName) {
		case "inbox":
			mailbox.Flags = append(mailbox.Flags, "\\Inbox")
		case "sent items", "sent":
			mailbox.Flags = append(mailbox.Flags, "\\Sent")
		case "drafts":
			mailbox.Flags = append(mailbox.Flags, "\\Drafts")
		case "deleted items", "trash":
			mailbox.Flags = append(mailbox.Flags, "\\Trash")
		case "junk email", "spam":
			mailbox.Flags = append(mailbox.Flags, "\\Junk")
		case "archive":
			mailbox.Flags = append(mailbox.Flags, "\\Archive")
		}

		mailboxes = append(mailboxes, mailbox)
	}

	s.logger.Info("Successfully retrieved %d Outlook folders via REST API for account %s", len(mailboxes), account.EmailAddress)
	return mailboxes, nil
}

// getOutlookFolders retrieves Outlook folder names using Graph API (returns []string for GetAllFolders compatibility)

func (s *FetcherService) getOutlookFolders(account models.EmailAccount) ([]string, error) {
	s.logger.Debug("Getting Outlook folders using Graph API for %s", account.EmailAddress)

	// 使用Graph API获取文件夹
	mailboxes, err := s.getOutlookMailboxes(account)
	if err != nil {
		s.logger.Error("Failed to get Outlook mailboxes: %v", err)
		return nil, fmt.Errorf("failed to get Outlook mailboxes: %w", err)
	}

	// 转换为文件夹名称列表
	var folders []string
	for _, mailbox := range mailboxes {
		folders = append(folders, mailbox.Name)
	}

	s.logger.Info("Retrieved %d Outlook folders for %s: %v", len(folders), account.EmailAddress, folders)
	return folders, nil
}
