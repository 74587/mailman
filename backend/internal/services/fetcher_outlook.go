package services

import (
	"crypto/tls"
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

func recordOutlookHTTPRequest(source EmailIngestSource, operation string, start time.Time, resp *http.Response, err error) {
	statusCode := 0
	if resp != nil {
		statusCode = resp.StatusCode
	}
	RuntimeMetrics().RecordOutlookRequest(source, operation, statusCode, time.Since(start), err)
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

	// Check if explicitly set to use IMAP (e.g. from verification fallback)
	if account.CustomSettings["connection_protocol"] == "imap" {
		return false
	}

	// Try to get or refresh access token to check its format
	accessToken, _ := account.CustomSettings["access_token"]
	if accessToken == "" {
		// No access token stored, try to refresh
		refreshToken, _ := account.CustomSettings["refresh_token"]
		if refreshToken == "" {
			return false
		}

		// Get client_id
		clientID, _ := account.CustomSettings["client_id"]
		if clientID == "" {
			return false
		}

		// Try to refresh token to check its format
		newAccessToken, err := s.refreshOutlookGraphTokenWithSource(clientID, refreshToken, account.Proxy, source)
		if err != nil {
			s.logger.Debug("Failed to refresh Outlook token, falling back to IMAP: %v", err)
			return false
		}
		accessToken = newAccessToken
	}

	// Check if the access token is JWT format (contains dots) or IMAP format (starts with EwA)
	// JWT format: eyJ0eXAi...eyJhdWQi...signature (3 parts separated by dots)
	// IMAP format: EwA... (no dots, starts with EwA)
	isJWT := strings.Contains(accessToken, ".")
	if !isJWT {
		s.logger.Debug("Outlook access token is IMAP/REST format (EwA), will use Outlook REST API v2.0")
		// Still return true to use the API-based fetcher (which handles fallback) instead of IMAP protocol
		return true
	}

	s.logger.Debug("Outlook access token is JWT format, will use Graph API")
	return true
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

	// Check if token is JWT (Graph API) or not (Outlook REST API)
	isJWT := strings.Contains(accessToken, ".")
	if !isJWT {
		s.logger.Info("Outlook access token is not JWT, falling back to Outlook REST API v2.0 verification")
		return s.verifyOutlookRESTConnectionWithSource(account, accessToken, source)
	}

	// Create HTTP client with proxy support
	httpClient := s.createOutlookHTTPClient(account.Proxy)

	// Test connection by getting mail folders
	req, err := http.NewRequest("GET", "https://graph.microsoft.com/v1.0/me/mailFolders", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	releaseSlot, err := s.acquireOutlookRequestSlot(source, "mailFolders verification")
	if err != nil {
		return err
	}
	requestStart := time.Now()
	resp, err := httpClient.Do(req)
	recordOutlookHTTPRequest(source, "mailFolders", requestStart, resp, err)
	if err != nil {
		releaseSlot()
		s.logger.Error("Failed to make Graph API request: %v", err)
		return fmt.Errorf("Graph API request failed: %w", err)
	}
	defer releaseSlot()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		s.logger.Error("Graph API returned status %d: %s", resp.StatusCode, string(body))
		return fmt.Errorf("Graph API verification failed with status %d: %s", resp.StatusCode, string(body))
	}

	// Parse response to verify we got folders
	var foldersResponse struct {
		Value []struct {
			Id          string `json:"id"`
			DisplayName string `json:"displayName"`
		} `json:"value"`
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	if err := json.Unmarshal(body, &foldersResponse); err != nil {
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
	// Get tokens from CustomSettings
	if account.CustomSettings == nil {
		return "", fmt.Errorf("OAuth2 tokens not found in account settings")
	}

	// Check if we have an access_token stored
	accessToken, hasAccessToken := account.CustomSettings["access_token"]
	if hasAccessToken && accessToken != "" {
		// Check if we have expiry info
		if expiresAtStr, exists := account.CustomSettings["expires_at"]; exists && expiresAtStr != "" {
			if expiresAt, err := strconv.ParseInt(expiresAtStr, 10, 64); err == nil {
				// Token has expiry info
				if time.Now().Unix() < expiresAt-300 {
					// Token is still valid (more than 5 minutes remaining)
					s.logger.Debug("Using existing Outlook access token (expires_at: %d)", expiresAt)
					return accessToken, nil
				}
				// Token expired, try to refresh
				s.logger.Debug("Outlook access token expired, will try to refresh")
			}
		} else {
			// No expiry info - this is typical for "手动输入Token" accounts
			// Just use the token directly and let the API call validate it
			s.logger.Debug("Using Outlook access token without expiry info (manual token account)")
			return accessToken, nil
		}
	}

	// If no valid access token, check if we have a refresh token
	refreshToken, hasRefreshToken := account.CustomSettings["refresh_token"]
	if !hasRefreshToken || refreshToken == "" {
		// No refresh token - if we had an access_token, use it even if it might be expired
		// Let the API call fail if it's really expired - user will need to update the token
		if hasAccessToken && accessToken != "" {
			s.logger.Debug("No refresh token available, using existing access token directly")
			return accessToken, nil
		}
		return "", fmt.Errorf("no access_token or refresh_token found in account settings")
	}

	// Get client_id - prefer from CustomSettings (for manual token accounts)
	clientID := ""
	if customClientID, ok := account.CustomSettings["client_id"]; ok && customClientID != "" {
		clientID = customClientID
		s.logger.Debug("Using client_id from account CustomSettings for Graph API")
	}

	if clientID == "" {
		// Try to get from OAuth2GlobalConfig
		oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())
		var oauth2Config *models.OAuth2GlobalConfig
		var err error

		if account.OAuth2ProviderID != nil && *account.OAuth2ProviderID > 0 {
			oauth2Config, err = oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
			if err != nil {
				s.logger.Warn("Failed to get config from OAuth2ProviderID: %v", err)
			}
		}

		if oauth2Config == nil {
			oauth2Config, err = oauth2GlobalConfigRepo.GetByProviderType(models.ProviderTypeOutlook)
			if err != nil {
				return "", fmt.Errorf("failed to get OAuth2 config: %w", err)
			}
		}

		if oauth2Config != nil {
			clientID = oauth2Config.ClientID
		}
	}

	if clientID == "" {
		return "", fmt.Errorf("client_id not found for Outlook Graph API")
	}

	// Refresh token using Graph API scope
	s.logger.Debug("Refreshing Outlook access token for Graph API")
	accessToken, err := s.refreshOutlookGraphTokenWithSource(clientID, refreshToken, account.Proxy, source)
	if err != nil {
		return "", fmt.Errorf("failed to refresh access token: %w", err)
	}

	// Update access token in database
	newCustomSettings := make(models.JSONMap)
	for k, v := range account.CustomSettings {
		newCustomSettings[k] = v
	}
	newCustomSettings["access_token"] = accessToken
	newCustomSettings["expires_at"] = fmt.Sprintf("%d", time.Now().Add(time.Hour).Unix())
	account.CustomSettings = newCustomSettings

	if err := s.accountRepo.Update(&account); err != nil {
		s.logger.Warn("Failed to update access token in database: %v", err)
	}

	return accessToken, nil
}

// refreshOutlookGraphToken refreshes Outlook token with Graph API scope

func (s *FetcherService) refreshOutlookGraphToken(clientID, refreshToken, proxyURL string) (string, error) {
	return s.refreshOutlookGraphTokenWithSource(clientID, refreshToken, proxyURL, EmailIngestSourceManualSync)
}

func (s *FetcherService) refreshOutlookGraphTokenWithSource(clientID, refreshToken, proxyURL string, source EmailIngestSource) (string, error) {
	tokenURL := "https://login.microsoftonline.com/common/oauth2/v2.0/token"
	// Note: Do NOT specify scope when refreshing - Microsoft will use the original authorization scope
	// If we specify a different scope, it will fail with "unauthorized scope" error

	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)
	// Omitting scope parameter - use original scope from authorization

	req, err := http.NewRequest("POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	// Create HTTP client with proxy support
	httpClient := s.createOutlookHTTPClient(proxyURL)

	releaseSlot, err := s.acquireOutlookRequestSlot(source, "token refresh")
	if err != nil {
		return "", err
	}
	requestStart := time.Now()
	resp, err := httpClient.Do(req)
	recordOutlookHTTPRequest(source, "token", requestStart, resp, err)
	if err != nil {
		releaseSlot()
		return "", fmt.Errorf("failed to refresh token: %w", err)
	}
	defer releaseSlot()
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		s.logger.Error("Failed to parse token response: %s", string(body))
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	if errorMsg, ok := result["error"]; ok {
		errorDesc, _ := result["error_description"].(string)
		s.logger.Error("Outlook Graph API token refresh failed: %v - %s", errorMsg, errorDesc)
		return "", fmt.Errorf("OAuth2 error: %v - %s", errorMsg, errorDesc)
	}

	accessToken, ok := result["access_token"].(string)
	if !ok {
		s.logger.Error("No access_token in response: %+v", result)
		return "", fmt.Errorf("access_token not found in response")
	}

	s.logger.Debug("Successfully refreshed Outlook Graph API token (length: %d)", len(accessToken))
	return accessToken, nil
}

// createOutlookHTTPClient creates an HTTP client with optional proxy support

func (s *FetcherService) createOutlookHTTPClient(proxyURL string) *http.Client {
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

// fetchEmailsFromOutlookGraphAPI fetches emails using Microsoft Graph API or Outlook REST API v2.0

func (s *FetcherService) fetchEmailsFromOutlookGraphAPI(account models.EmailAccount, options FetchEmailsOptions) ([]models.Email, error) {
	// Get access token
	accessToken, err := s.getOutlookAccessTokenWithSource(account, options.Source)
	if err != nil {
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	// Check if token is JWT (Graph API) or not (Outlook REST API)
	isJWT := strings.Contains(accessToken, ".")
	if !isJWT {
		s.logger.Info("Outlook access token is not JWT, falling back to Outlook REST API v2.0")
		return s.fetchEmailsFromOutlookRESTAPI(account, accessToken, options)
	}

	s.logger.Debug("Fetching emails using Outlook Graph API for account %s", account.EmailAddress)

	// Create HTTP client
	httpClient := s.createOutlookHTTPClient(account.Proxy)

	// Build the request URL with query parameters
	baseURL := "https://graph.microsoft.com/v1.0/me/messages"

	// Build OData query parameters
	queryParams := url.Values{}

	// Select fields to retrieve
	queryParams.Set("$select", "id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,hasAttachments,isRead,importance,internetMessageId")

	// Order by received date
	queryParams.Set("$orderby", "receivedDateTime desc")

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

	// Build filter for date range
	var filters []string
	if options.StartDate != nil {
		filters = append(filters, fmt.Sprintf("receivedDateTime ge %s", options.StartDate.Format(time.RFC3339)))
	}
	if options.EndDate != nil {
		filters = append(filters, fmt.Sprintf("receivedDateTime le %s", options.EndDate.Format(time.RFC3339)))
	}
	if len(filters) > 0 {
		queryParams.Set("$filter", strings.Join(filters, " and "))
	}

	// Search query
	if options.SearchQuery != "" {
		queryParams.Set("$search", fmt.Sprintf(`"%s"`, options.SearchQuery))
	}

	requestURL := baseURL + "?" + queryParams.Encode()
	s.logger.Debug("Outlook Graph API request URL: %s", requestURL)

	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "outlook.body-content-type=\"html\"")

	releaseSlot, err := s.acquireOutlookRequestSlot(options.Source, "messages fetch")
	if err != nil {
		return nil, err
	}
	requestStart := time.Now()
	resp, err := httpClient.Do(req)
	recordOutlookHTTPRequest(options.Source, "messages", requestStart, resp, err)
	if err != nil {
		releaseSlot()
		return nil, fmt.Errorf("Graph API request failed: %w", err)
	}
	defer releaseSlot()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		s.logger.Error("Graph API returned status %d: %s", resp.StatusCode, string(body))
		return nil, fmt.Errorf("Graph API request failed with status %d", resp.StatusCode)
	}

	// Parse response
	var messagesResponse struct {
		Value []OutlookMessage `json:"value"`
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
		email := s.convertOutlookMessage(msg, account.ID, options.Mailbox)
		emails = append(emails, email)
	}

	// Update last sync time
	if err := s.accountRepo.UpdateLastSync(account.ID); err != nil {
		s.logger.Warn("Failed to update last sync time: %v", err)
	}

	s.logger.Info("Successfully fetched %d emails from Outlook Graph API for %s", len(emails), account.EmailAddress)
	return emails, nil
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

	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	// REST API v2.0 specific headers
	req.Header.Set("Accept", "application/json")

	releaseSlot, err := s.acquireOutlookRequestSlot(options.Source, "REST messages fetch")
	if err != nil {
		return nil, err
	}
	requestStart := time.Now()
	resp, err := httpClient.Do(req)
	recordOutlookHTTPRequest(options.Source, "messages", requestStart, resp, err)
	if err != nil {
		releaseSlot()
		return nil, fmt.Errorf("REST API request failed: %w", err)
	}
	defer releaseSlot()
	defer resp.Body.Close()

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

// getOutlookMailboxes retrieves Outlook folders using Graph API or Outlook REST API v2.0

func (s *FetcherService) getOutlookMailboxes(account models.EmailAccount) ([]models.Mailbox, error) {
	s.logger.Debug("Getting Outlook mailboxes using Graph API for account %s", account.EmailAddress)

	// Get access token
	accessToken, err := s.getOutlookAccessToken(account)
	if err != nil {
		return nil, fmt.Errorf("failed to get access token: %w", err)
	}

	// Check if token is JWT (Graph API) or not (Outlook REST API)
	isJWT := strings.Contains(accessToken, ".")
	if !isJWT {
		s.logger.Info("Outlook access token is not JWT, falling back to Outlook REST API v2.0 for mailboxes")
		return s.getOutlookRESTMailboxes(account, accessToken)
	}

	// Create HTTP client
	httpClient := s.createOutlookHTTPClient(account.Proxy)

	// Get mail folders
	req, err := http.NewRequest("GET", "https://graph.microsoft.com/v1.0/me/mailFolders?$top=100", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	releaseSlot, err := s.acquireOutlookRequestSlot(EmailIngestSourceManualSync, "mailFolders listing")
	if err != nil {
		return nil, err
	}
	requestStart := time.Now()
	resp, err := httpClient.Do(req)
	recordOutlookHTTPRequest(EmailIngestSourceManualSync, "mailFolders", requestStart, resp, err)
	if err != nil {
		releaseSlot()
		return nil, fmt.Errorf("Graph API request failed: %w", err)
	}
	defer releaseSlot()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Graph API request failed with status %d: %s", resp.StatusCode, string(body))
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
