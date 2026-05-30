package services

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mailman/internal/models"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/emersion/go-sasl"
	"golang.org/x/net/proxy"
	"gorm.io/gorm"
)

// OAuth2Config represents OAuth2 configuration
type OAuth2Config struct {
	ClientID     string
	ClientSecret string
	RefreshToken string
	AccessToken  string
	TokenURL     string
}

// TokenCacheEntry represents a cached token entry
type TokenCacheEntry struct {
	AccessToken string
	ExpiresAt   time.Time
	RefreshTime time.Time
}

// OAuth2Service handles OAuth2 authentication
type OAuth2Service struct {
	httpClient   *http.Client
	tokenCache   map[string]*TokenCacheEntry
	cacheMutex   sync.RWMutex
	accountLocks map[string]*sync.Mutex // 基于账户ID的锁
	locksMutex   sync.RWMutex           // 保护 accountLocks map 的锁
	db           *gorm.DB               // 数据库连接
}

// NewOAuth2Service creates a new OAuth2Service
func NewOAuth2Service(db *gorm.DB) *OAuth2Service {
	return &OAuth2Service{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		tokenCache:   make(map[string]*TokenCacheEntry),
		accountLocks: make(map[string]*sync.Mutex),
		db:           db,
	}
}

// createHTTPClientWithProxy creates an HTTP client with proxy support
func (s *OAuth2Service) createHTTPClientWithProxy(proxyStr string) (*http.Client, error) {
	if proxyStr == "" {
		return &http.Client{Timeout: 30 * time.Second}, nil
	}

	proxyURL, err := url.Parse(proxyStr)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL: %w", err)
	}

	// Create transport with proxy
	transport := &http.Transport{
		Proxy: http.ProxyURL(proxyURL),
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	// Handle SOCKS5 proxy
	if proxyURL.Scheme == "socks5" || proxyURL.Scheme == "socks5h" {
		dialer, err := proxy.FromURL(proxyURL, proxy.Direct)
		if err != nil {
			return nil, fmt.Errorf("failed to create SOCKS5 proxy dialer: %w", err)
		}
		transport.Dial = dialer.Dial
		transport.Proxy = nil // Don't use HTTP proxy for SOCKS5
	}

	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}, nil
}

// getAccountLock 获取账户特定的锁，避免不同账户互相阻塞
func (s *OAuth2Service) getAccountLock(accountKey string) *sync.Mutex {
	s.locksMutex.RLock()
	lock, exists := s.accountLocks[accountKey]
	s.locksMutex.RUnlock()

	if exists {
		return lock
	}

	// 如果锁不存在，需要创建新锁
	s.locksMutex.Lock()
	defer s.locksMutex.Unlock()

	// 双重检查，防止并发创建
	if lock, exists := s.accountLocks[accountKey]; exists {
		return lock
	}

	// 创建新锁
	lock = &sync.Mutex{}
	s.accountLocks[accountKey] = lock
	return lock
}

// getCacheKey 生成缓存键
func (s *OAuth2Service) getCacheKey(providerType, clientID, refreshToken string) string {
	// 使用SHA1 hash生成唯一缓存键，避免冲突
	// 组合所有关键信息确保唯一性
	data := fmt.Sprintf("%s_%s_%s", providerType, clientID, refreshToken)
	hash := sha1.Sum([]byte(data))
	// 使用base64编码hash，生成安全的缓存键
	cacheKey := base64.URLEncoding.EncodeToString(hash[:])

	// 添加provider前缀便于调试
	return fmt.Sprintf("%s_%s", providerType, cacheKey[:16])
}

// cleanupOldCacheEntries 清理可能存在的旧缓存条目
func (s *OAuth2Service) cleanupOldCacheEntries(providerType, clientID, newRefreshToken string) {
	s.cacheMutex.Lock()
	defer s.cacheMutex.Unlock()

	// 查找所有相关的缓存条目
	var keysToDelete []string
	for key, entry := range s.tokenCache {
		// 如果是同一个provider和clientID但refresh token不同，则删除
		if strings.HasPrefix(key, providerType+"_") {
			// 这是一个同provider的缓存条目，需要检查是否是旧的
			// 由于我们无法从缓存key中反推出原始信息，我们使用启发式方法：
			// 如果这个条目的refresh时间超过1小时，可能是旧的
			if time.Since(entry.RefreshTime) > time.Hour {
				keysToDelete = append(keysToDelete, key)
			}
		}
	}

	// 删除过期的缓存条目
	for _, key := range keysToDelete {
		delete(s.tokenCache, key)
		debugPrintf("OAuth2: Cleaned up old cache entry: %s\n", key)
	}

	if len(keysToDelete) > 0 {
		debugPrintf("OAuth2: Cleaned up %d old cache entries for provider %s\n", len(keysToDelete), providerType)
	}
}

// getMapKeys 辅助函数，用于获取map的所有键
func getMapKeys(m models.JSONMap) []string {
	if m == nil {
		return []string{}
	}

	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// RefreshAccessTokenWithCache 带缓存和并发控制的token刷新
func (s *OAuth2Service) RefreshAccessTokenWithCache(providerType, clientID, clientSecret, refreshToken string, accountID uint) (string, error) {
	return s.RefreshAccessTokenWithCacheAndProxy(providerType, clientID, clientSecret, refreshToken, accountID, "")
}

// RefreshAccessTokenWithCacheAndProxy 带缓存、并发控制和代理支持的token刷新
func (s *OAuth2Service) RefreshAccessTokenWithCacheAndProxy(providerType, clientID, clientSecret, refreshToken string, accountID uint, proxy string) (string, error) {
	cacheKey := s.getCacheKey(providerType, clientID, refreshToken)
	accountKey := fmt.Sprintf("%s_%d", providerType, accountID)

	// 先检查缓存
	s.cacheMutex.RLock()
	if entry, exists := s.tokenCache[cacheKey]; exists {
		// 检查token是否还有效（提前5分钟过期）
		if time.Now().Before(entry.ExpiresAt.Add(-5 * time.Minute)) {
			s.cacheMutex.RUnlock()
			if isDebugMode() {
				debugPrintf("OAuth2: Using cached token for account %d, expires at: %v\n", accountID, entry.ExpiresAt)
			}
			return entry.AccessToken, nil
		}
	}
	s.cacheMutex.RUnlock()

	// 获取账户特定的锁
	accountLock := s.getAccountLock(accountKey)
	accountLock.Lock()
	defer accountLock.Unlock()

	// 锁定后再次检查缓存（双重检查锁定模式）
	s.cacheMutex.RLock()
	if entry, exists := s.tokenCache[cacheKey]; exists {
		if time.Now().Before(entry.ExpiresAt.Add(-5 * time.Minute)) {
			s.cacheMutex.RUnlock()
			if isDebugMode() {
				debugPrintf("OAuth2: Using cached token after lock for account %d, expires at: %v\n", accountID, entry.ExpiresAt)
			}
			return entry.AccessToken, nil
		}
	}
	s.cacheMutex.RUnlock()

	// 防止频繁刷新：如果上次刷新时间在30秒内，等待一下
	s.cacheMutex.RLock()
	if entry, exists := s.tokenCache[cacheKey]; exists {
		if time.Since(entry.RefreshTime) < 30*time.Second {
			s.cacheMutex.RUnlock()
			debugPrintf("OAuth2: Throttling refresh for account %d, last refresh: %v\n", accountID, entry.RefreshTime)
			return "", fmt.Errorf("token refresh throttled, please wait a moment")
		}
	}
	s.cacheMutex.RUnlock()

	debugPrintf("OAuth2: Refreshing token for account %d (provider: %s) with proxy: %s\n", accountID, providerType, proxy)

	// 刷新token - 使用代理支持的方法
	newAccessToken, newRefreshToken, err := s.RefreshAccessTokenForProviderWithProxy(providerType, clientID, clientSecret, refreshToken, proxy)
	if err != nil {
		return "", err
	}

	// 如果有新的refresh token，更新到数据库
	if newRefreshToken != "" && s.db != nil {
		debugPrintf("OAuth2: Updating refresh token for account %d (new token length: %d)\n", accountID, len(newRefreshToken))

		// 正确更新CustomSettings中的refresh_token字段
		// 先获取当前的CustomSettings
		var account models.EmailAccount
		if err := s.db.Where("id = ?", accountID).First(&account).Error; err != nil {
			debugPrintf("OAuth2: Failed to fetch account for refresh token update %d: %v\n", accountID, err)
		} else {
			debugPrintf("OAuth2: Retrieved account %d, current CustomSettings keys: %v\n",
				accountID, getMapKeys(account.CustomSettings))

			// 确保CustomSettings不为nil
			if account.CustomSettings == nil {
				account.CustomSettings = make(models.JSONMap)
				debugPrintf("OAuth2: Initialized nil CustomSettings for account %d\n", accountID)
			}

			// 保存旧的refresh token用于日志
			oldRefreshToken := account.CustomSettings["refresh_token"]

			// 更新refresh_token
			account.CustomSettings["refresh_token"] = newRefreshToken

			// 保存更新后的CustomSettings
			result := s.db.Model(&models.EmailAccount{}).
				Where("id = ?", accountID).
				Update("custom_settings", account.CustomSettings)

			if result.Error != nil {
				debugPrintf("OAuth2: Failed to update refresh token in CustomSettings for account %d: %v\n", accountID, result.Error)
			} else {
				debugPrintf("OAuth2: Successfully updated refresh token in CustomSettings for account %d (old: %d chars, new: %d chars)\n",
					accountID, len(oldRefreshToken), len(newRefreshToken))
			}
		}
	}

	// 更新缓存
	s.cacheMutex.Lock()

	// 计算不同provider的缓存过期时间
	var expirationTime time.Duration
	switch providerType {
	case "gmail":
		expirationTime = 55 * time.Minute // Gmail access token 1小时过期
	case "outlook":
		expirationTime = 55 * time.Minute // Outlook access token 1小时过期
	default:
		expirationTime = 55 * time.Minute // 默认55分钟
	}

	s.tokenCache[cacheKey] = &TokenCacheEntry{
		AccessToken: newAccessToken,
		ExpiresAt:   time.Now().Add(expirationTime),
		RefreshTime: time.Now(),
	}
	s.cacheMutex.Unlock()

	// 清理可能存在的旧缓存条目（基于旧的refresh token）
	s.cleanupOldCacheEntries(providerType, clientID, refreshToken)

	debugPrintf("OAuth2: Token refreshed and cached for account %d\n", accountID)
	return newAccessToken, nil
}

// RefreshAccessToken refreshes the access token using refresh token (legacy method for Outlook)
func (s *OAuth2Service) RefreshAccessToken(clientID, refreshToken string) (string, error) {
	// Legacy method - assumes empty client_secret for backward compatibility
	return s.RefreshAccessTokenForProvider("outlook", clientID, "", refreshToken)
}

// RefreshAccessTokenForProvider refreshes the access token for a specific provider
func (s *OAuth2Service) RefreshAccessTokenForProvider(providerType string, clientID, clientSecret, refreshToken string) (string, error) {
	provider, ok := models.GetOAuth2ProviderDefinition(models.MailProviderType(providerType))
	if !ok {
		return "", fmt.Errorf("unsupported provider type: %s", providerType)
	}
	tokenURL := provider.TokenURL
	scope := strings.Join(provider.Scopes, " ")

	// Log the request for debugging (hide sensitive data)
	debugPrintf("OAuth2: Refreshing token for provider: %s, client_id: %s\n", providerType, clientID)
	debugPrintf("OAuth2: Refresh token length: %d\n", len(refreshToken))

	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)
	if scope != "" {
		data.Set("scope", scope)
	}

	// Only include client_secret for confidential clients (not public clients)
	// For Microsoft public clients, client_secret should be empty or not included
	if clientSecret != "" {
		data.Set("client_secret", clientSecret)
		debugPrintf("OAuth2: Using confidential client (with client_secret) for %s\n", providerType)
	} else {
		debugPrintf("OAuth2: Using public client (no client_secret) for %s\n", providerType)
	}

	req, err := http.NewRequest("POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to refresh token: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	// Log response status for debugging
	debugPrintf("OAuth2: Response status: %d\n", resp.StatusCode)

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		// Log raw response if JSON parsing fails
		debugPrintf("OAuth2: Failed to parse JSON. Raw response: %s\n", string(body))
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	if errorMsg, ok := result["error"]; ok {
		errorDesc, _ := result["error_description"].(string)
		errorCodes, _ := result["error_codes"].([]interface{})
		correlationId, _ := result["correlation_id"].(string)

		// Provide detailed error information
		errInfo := fmt.Sprintf("OAuth2 error: %v - %s", errorMsg, errorDesc)
		if len(errorCodes) > 0 {
			errInfo += fmt.Sprintf(" (Error codes: %v)", errorCodes)
		}
		if correlationId != "" {
			errInfo += fmt.Sprintf(" (Correlation ID: %s)", correlationId)
		}

		// Common error explanations
		if errorMsg == "invalid_grant" {
			errInfo += "\nPossible causes: 1) Refresh token expired 2) Token already used 3) Invalid client_id 4) User revoked permissions"
		}

		return "", fmt.Errorf("%s", errInfo)
	}

	accessToken, ok := result["access_token"].(string)
	if !ok {
		// Log the entire response for debugging
		debugPrintf("OAuth2: No access_token in response. Full response: %+v\n", result)
		return "", fmt.Errorf("access_token not found in response")
	}

	// 获取过期时间信息
	expiresIn, _ := result["expires_in"].(float64)
	debugPrintf("OAuth2: Successfully obtained access token (length: %d), expires in: %.0f seconds\n", len(accessToken), expiresIn)

	return accessToken, nil
}

// RefreshAccessTokenForProviderWithProxy refreshes the access token for a specific provider with proxy support
// Returns new access token and new refresh token (if provided by the provider)
func (s *OAuth2Service) RefreshAccessTokenForProviderWithProxy(providerType string, clientID, clientSecret, refreshToken, proxy string) (accessToken string, newRefreshToken string, err error) {
	provider, ok := models.GetOAuth2ProviderDefinition(models.MailProviderType(providerType))
	if !ok {
		return "", "", fmt.Errorf("unsupported provider type: %s", providerType)
	}
	tokenURL := provider.TokenURL
	scope := strings.Join(provider.Scopes, " ")

	// Log the request for debugging (hide sensitive data)
	debugPrintf("OAuth2: Refreshing token for provider: %s, client_id: %s with proxy: %s\n", providerType, clientID, proxy)
	debugPrintf("OAuth2: Refresh token length: %d\n", len(refreshToken))

	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)
	if scope != "" {
		data.Set("scope", scope)
	}

	// Only include client_secret for confidential clients (not public clients)
	// For Microsoft public clients, client_secret should be empty or not included
	if clientSecret != "" {
		data.Set("client_secret", clientSecret)
		debugPrintf("OAuth2 Proxy: Using confidential client (with client_secret) for %s\n", providerType)
	} else {
		debugPrintf("OAuth2 Proxy: Using public client (no client_secret) for %s\n", providerType)
	}

	req, err := http.NewRequest("POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return "", "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	// 创建支持代理的HTTP客户端
	client, err := s.createHTTPClientWithProxy(proxy)
	if err != nil {
		return "", "", fmt.Errorf("failed to create HTTP client with proxy: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("failed to refresh token: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("failed to read response: %w", err)
	}

	// Log response status for debugging
	debugPrintf("OAuth2: Response status: %d\n", resp.StatusCode)

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		// Log raw response if JSON parsing fails
		debugPrintf("OAuth2: Failed to parse JSON. Raw response: %s\n", string(body))
		return "", "", fmt.Errorf("failed to parse response: %w", err)
	}

	if errorMsg, ok := result["error"]; ok {
		errorDesc, _ := result["error_description"].(string)
		errorCodes, _ := result["error_codes"].([]interface{})
		correlationId, _ := result["correlation_id"].(string)

		// Provide detailed error information
		errInfo := fmt.Sprintf("OAuth2 error: %v - %s", errorMsg, errorDesc)
		if len(errorCodes) > 0 {
			errInfo += fmt.Sprintf(" (Error codes: %v)", errorCodes)
		}
		if correlationId != "" {
			errInfo += fmt.Sprintf(" (Correlation ID: %s)", correlationId)
		}

		// Common error explanations
		if errorMsg == "invalid_grant" {
			errInfo += "\nPossible causes: 1) Refresh token expired 2) Token already used 3) Invalid client_id 4) User revoked permissions"
		}

		return "", "", fmt.Errorf("%s", errInfo)
	}

	accessToken, ok = result["access_token"].(string)
	if !ok {
		// Log the entire response for debugging
		debugPrintf("OAuth2: No access_token in response. Full response: %+v\n", result)
		return "", "", fmt.Errorf("access_token not found in response")
	}

	// Check if a new refresh token was provided
	newRefreshToken = ""
	if newRefresh, ok := result["refresh_token"].(string); ok && newRefresh != "" {
		newRefreshToken = newRefresh
		debugPrintf("OAuth2: New refresh token provided (length: %d)\n", len(newRefreshToken))
	} else {
		debugPrintf("OAuth2: No new refresh token provided, keeping existing one\n")
	}

	// 获取过期时间信息
	expiresIn, _ := result["expires_in"].(float64)
	debugPrintf("OAuth2: Successfully obtained access token (length: %d), expires in: %.0f seconds\n", len(accessToken), expiresIn)

	return accessToken, newRefreshToken, nil
}

// GenerateAuthURL generates OAuth2 authorization URL for a provider
func (s *OAuth2Service) GenerateAuthURL(providerType string, clientID, redirectURI, state string) (string, error) {
	provider, ok := models.GetOAuth2ProviderDefinition(models.MailProviderType(providerType))
	if !ok {
		return "", fmt.Errorf("unsupported provider type: %s", providerType)
	}
	return s.generateAuthURL(provider.AuthURL, providerType, clientID, redirectURI, state, strings.Join(provider.Scopes, " "), "")
}

// GenerateAuthURLForConfig generates an OAuth2 authorization URL using the stored config scopes.
func (s *OAuth2Service) GenerateAuthURLForConfig(config models.OAuth2GlobalConfig, state string, codeChallenge string) (string, error) {
	return s.GenerateAuthURLForConfigWithRedirectURI(config, state, codeChallenge, config.RedirectURI)
}

// GenerateAuthURLForConfigWithRedirectURI generates an OAuth2 authorization URL with a redirect URI override.
func (s *OAuth2Service) GenerateAuthURLForConfigWithRedirectURI(config models.OAuth2GlobalConfig, state string, codeChallenge string, redirectURI string) (string, error) {
	provider, ok := models.GetOAuth2ProviderDefinition(config.ProviderType)
	if !ok {
		return "", fmt.Errorf("unsupported provider type: %s", config.ProviderType)
	}
	scopes := strings.Join([]string(config.Scopes), " ")
	if scopes == "" {
		scopes = strings.Join(provider.Scopes, " ")
	}
	if redirectURI == "" {
		redirectURI = config.RedirectURI
	}
	return s.generateAuthURL(provider.AuthURL, string(config.ProviderType), config.ClientID, redirectURI, state, scopes, codeChallenge)
}

func (s *OAuth2Service) generateAuthURL(authURL, providerType, clientID, redirectURI, state, scope, codeChallenge string) (string, error) {
	params := url.Values{}
	params.Set("client_id", clientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("response_type", "code")
	if scope != "" {
		params.Set("scope", scope)
	}
	params.Set("state", state)
	if codeChallenge != "" {
		params.Set("code_challenge", codeChallenge)
		params.Set("code_challenge_method", "S256")
	}
	switch providerType {
	case string(models.ProviderTypeGmail):
		params.Set("access_type", "offline")
		params.Set("prompt", "consent")
	case string(models.ProviderTypeOutlook):
		params.Set("prompt", "consent")
	}

	return fmt.Sprintf("%s?%s", authURL, params.Encode()), nil
}

// ExchangeCodeForTokens exchanges authorization code for tokens
func (s *OAuth2Service) ExchangeCodeForTokens(providerType, clientID, clientSecret, code, redirectURI string) (accessToken, refreshToken string, err error) {
	provider, ok := models.GetOAuth2ProviderDefinition(models.MailProviderType(providerType))
	if !ok {
		return "", "", fmt.Errorf("unsupported provider type: %s", providerType)
	}
	return s.exchangeCodeForTokens(provider.TokenURL, clientID, clientSecret, code, redirectURI, "")
}

// ExchangeCodeForTokensForConfig exchanges authorization code using provider metadata and optional PKCE.
func (s *OAuth2Service) ExchangeCodeForTokensForConfig(config models.OAuth2GlobalConfig, code, redirectURI, codeVerifier string) (accessToken, refreshToken string, err error) {
	provider, ok := models.GetOAuth2ProviderDefinition(config.ProviderType)
	if !ok {
		return "", "", fmt.Errorf("unsupported provider type: %s", config.ProviderType)
	}
	return s.exchangeCodeForTokens(provider.TokenURL, config.ClientID, config.ClientSecret, code, redirectURI, codeVerifier)
}

func (s *OAuth2Service) exchangeCodeForTokens(tokenURL, clientID, clientSecret, code, redirectURI, codeVerifier string) (accessToken, refreshToken string, err error) {
	data := url.Values{}
	data.Set("client_id", clientID)
	// Only include client_secret for confidential clients (not public clients)
	if clientSecret != "" {
		data.Set("client_secret", clientSecret)
	}
	data.Set("code", code)
	data.Set("grant_type", "authorization_code")
	data.Set("redirect_uri", redirectURI)
	if codeVerifier != "" {
		data.Set("code_verifier", codeVerifier)
	}

	req, err := http.NewRequest("POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return "", "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("failed to exchange code: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", fmt.Errorf("failed to read response: %w", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", fmt.Errorf("failed to parse response: %w", err)
	}

	if errorMsg, ok := result["error"]; ok {
		errorDesc, _ := result["error_description"].(string)
		return "", "", fmt.Errorf("OAuth2 error: %v - %s", errorMsg, errorDesc)
	}

	accessToken, ok := result["access_token"].(string)
	if !ok {
		return "", "", fmt.Errorf("access_token not found in response")
	}

	refreshToken, ok = result["refresh_token"].(string)
	if !ok {
		return "", "", fmt.Errorf("refresh_token not found in response")
	}

	return accessToken, refreshToken, nil
}

// GenerateOAuth2AuthString generates the OAuth2 authentication string for IMAP
func (s *OAuth2Service) GenerateOAuth2AuthString(email, accessToken string) string {
	authString := fmt.Sprintf("user=%s\x01auth=Bearer %s\x01\x01", email, accessToken)
	return base64.StdEncoding.EncodeToString([]byte(authString))
}

// OAuth2SASLClient implements the SASL XOAUTH2 mechanism
type OAuth2SASLClient struct {
	email       string
	accessToken string
}

// NewOAuth2SASLClient creates a new OAuth2 SASL client
func NewOAuth2SASLClient(email, accessToken string) sasl.Client {
	return &OAuth2SASLClient{
		email:       email,
		accessToken: accessToken,
	}
}

// isDebugMode 检查是否处于调试模式
func isDebugMode() bool {
	level := strings.ToUpper(os.Getenv("LOG_LEVEL"))
	return level == "DEBUG"
}

// debugPrintf 仅在 DEBUG 模式下输出日志
func debugPrintf(format string, args ...interface{}) {
	if isDebugMode() {
		fmt.Printf(format, args...)
	}
}

// Start begins the SASL authentication
func (c *OAuth2SASLClient) Start() (mech string, ir []byte, err error) {
	mech = "XOAUTH2"
	ir = []byte(fmt.Sprintf("user=%s\x01auth=Bearer %s\x01\x01", c.email, c.accessToken))
	if isDebugMode() {
		fmt.Printf("OAuth2 SASL: Starting authentication for %s\n", c.email)
		fmt.Printf("OAuth2 SASL: Access token length: %d\n", len(c.accessToken))
		fmt.Printf("OAuth2 SASL: Initial response length: %d\n", len(ir))
	}
	return
}

// Next continues the SASL authentication
func (c *OAuth2SASLClient) Next(challenge []byte) (response []byte, err error) {
	if isDebugMode() {
		fmt.Printf("OAuth2 SASL: Next called with challenge length: %d\n", len(challenge))
		if len(challenge) > 0 {
			fmt.Printf("OAuth2 SASL: Challenge content: %s\n", string(challenge))
		}
	}
	// OAuth2 doesn't require additional steps
	return nil, nil
}
