package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strconv"
	"time"

	"mailman/internal/models"
	"mailman/internal/services"

	"github.com/gorilla/mux"
)

func hashOAuth2State(state string) string {
	sum := sha256.Sum256([]byte(state))
	return hex.EncodeToString(sum[:])[:12]
}

// OAuth2Handler handles OAuth2 related API endpoints
type OAuth2Handler struct {
	configService      *services.OAuth2GlobalConfigService
	oauth2Service      *services.OAuth2Service
	authSessionService *services.OAuth2AuthSessionService
}

// NewOAuth2Handler creates a new OAuth2Handler
func NewOAuth2Handler(configService *services.OAuth2GlobalConfigService, oauth2Service *services.OAuth2Service, authSessionService *services.OAuth2AuthSessionService) *OAuth2Handler {
	return &OAuth2Handler{
		configService:      configService,
		oauth2Service:      oauth2Service,
		authSessionService: authSessionService,
	}
}

// generateRandomString generates a random string for state parameter
func generateRandomString(length int) (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, length)

	for i := range result {
		num, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "", err
		}
		result[i] = charset[num.Int64()]
	}

	return string(result), nil
}

// CreateOrUpdateGlobalConfig creates or updates OAuth2 global configuration
func (h *OAuth2Handler) CreateOrUpdateGlobalConfig(w http.ResponseWriter, r *http.Request) {
	var config models.OAuth2GlobalConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 强制Gmail使用固定scope，不允许用户编辑
	if config.ProviderType == models.ProviderTypeGmail {
		config.Scopes = models.StringSlice{"https://mail.google.com/", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"}
	}

	if err := h.configService.CreateOrUpdateConfig(&config); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// GetGlobalConfigs retrieves all OAuth2 global configurations
func (h *OAuth2Handler) GetGlobalConfigs(w http.ResponseWriter, r *http.Request) {
	configs, err := h.configService.GetAllConfigs()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(configs)
}

// GetGlobalConfigByProvider retrieves OAuth2 global configuration by provider (backward compatibility)
func (h *OAuth2Handler) GetGlobalConfigByProvider(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerType := vars["provider"]

	var mailProviderType models.MailProviderType
	switch providerType {
	case "gmail":
		mailProviderType = models.ProviderTypeGmail
	case "outlook":
		mailProviderType = models.ProviderTypeOutlook
	default:
		http.Error(w, "unsupported provider type", http.StatusBadRequest)
		return
	}

	config, err := h.configService.GetConfigByProvider(mailProviderType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// GetGlobalConfigsByProvider retrieves all OAuth2 global configurations by provider type
func (h *OAuth2Handler) GetGlobalConfigsByProvider(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerType := vars["provider"]

	var mailProviderType models.MailProviderType
	switch providerType {
	case "gmail":
		mailProviderType = models.ProviderTypeGmail
	case "outlook":
		mailProviderType = models.ProviderTypeOutlook
	default:
		http.Error(w, "unsupported provider type", http.StatusBadRequest)
		return
	}

	configs, err := h.configService.GetConfigsByProviderType(mailProviderType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(configs)
}

// GetGlobalConfigByID retrieves OAuth2 global configuration by ID
func (h *OAuth2Handler) GetGlobalConfigByID(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	idStr := vars["id"]

	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		http.Error(w, "invalid ID format", http.StatusBadRequest)
		return
	}

	config, err := h.configService.GetConfigByID(uint(id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// EnableProvider enables OAuth2 for a provider
func (h *OAuth2Handler) EnableProvider(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerType := vars["provider"]

	var mailProviderType models.MailProviderType
	switch providerType {
	case "gmail":
		mailProviderType = models.ProviderTypeGmail
	case "outlook":
		mailProviderType = models.ProviderTypeOutlook
	default:
		http.Error(w, "unsupported provider type", http.StatusBadRequest)
		return
	}

	if err := h.configService.EnableConfig(mailProviderType); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "provider enabled successfully"})
}

// DisableProvider disables OAuth2 for a provider
func (h *OAuth2Handler) DisableProvider(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerType := vars["provider"]

	var mailProviderType models.MailProviderType
	switch providerType {
	case "gmail":
		mailProviderType = models.ProviderTypeGmail
	case "outlook":
		mailProviderType = models.ProviderTypeOutlook
	default:
		http.Error(w, "unsupported provider type", http.StatusBadRequest)
		return
	}

	if err := h.configService.DisableConfig(mailProviderType); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "provider disabled successfully"})
}

// DeleteGlobalConfig deletes OAuth2 global configuration
func (h *OAuth2Handler) DeleteGlobalConfig(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	idStr := vars["id"]
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if err := h.configService.DeleteConfig(uint(id)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "configuration deleted successfully"})
}

// SetGlobalConfigDefault marks an OAuth2 configuration as the default for its provider.
func (h *OAuth2Handler) SetGlobalConfigDefault(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	idStr := vars["id"]
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	config, err := h.configService.SetDefaultConfig(uint(id))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// GetAuthURL generates OAuth2 authorization URL
func (h *OAuth2Handler) GetAuthURL(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerType := vars["provider"]

	var mailProviderType models.MailProviderType
	switch providerType {
	case "gmail":
		mailProviderType = models.ProviderTypeGmail
	case "outlook":
		mailProviderType = models.ProviderTypeOutlook
	default:
		http.Error(w, "unsupported provider type", http.StatusBadRequest)
		return
	}

	// Check for optional config_id parameter
	configIDParam := r.URL.Query().Get("config_id")

	var config *models.OAuth2GlobalConfig
	var err error

	// Priority 1: Use specific config ID if provided (new multi-config support)
	if configIDParam != "" {
		configID, err := strconv.ParseUint(configIDParam, 10, 32)
		if err != nil {
			http.Error(w, "invalid config_id parameter", http.StatusBadRequest)
			return
		}

		config, err = h.configService.GetConfigByID(uint(configID))
		if err != nil {
			http.Error(w, fmt.Sprintf("OAuth2 config not found: %v", err), http.StatusNotFound)
			return
		}

		// Verify config provider type matches
		if config.ProviderType != mailProviderType {
			http.Error(w, fmt.Sprintf("config provider type mismatch: expected %s, got %s", mailProviderType, config.ProviderType), http.StatusBadRequest)
			return
		}
	} else {
		// Priority 2: Fallback to default provider type lookup (backward compatibility)
		config, err = h.configService.GetProviderConfig(mailProviderType)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	// Generate state for security
	state, err := generateRandomString(32)
	if err != nil {
		http.Error(w, "failed to generate state", http.StatusInternalServerError)
		return
	}

	session, err := h.authSessionService.CreateSession(uint(config.ID), state, 10)
	if err != nil {
		log.Printf("[OAuth2] auth-url session creation failed provider=%s config_id=%d state_hash=%s error=%v",
			providerType, config.ID, hashOAuth2State(state), err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[OAuth2] auth-url session created provider=%s config_id=%d session_id=%d state_hash=%s redirect_uri=%s",
		providerType, config.ID, session.ID, hashOAuth2State(state), config.RedirectURI)

	authURL, err := h.oauth2Service.GenerateAuthURL(providerType, config.ClientID, config.RedirectURI, state)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"auth_url": authURL,
		"state":    state,
	})
}

// HandleCallback handles OAuth2 callback
func (h *OAuth2Handler) HandleCallback(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerType := vars["provider"]
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	stateHash := ""
	if state != "" {
		stateHash = hashOAuth2State(state)
	}

	log.Printf("[OAuth2] callback received provider=%s state_hash=%s has_code=%t remote_addr=%s x_forwarded_for=%s",
		providerType, stateHash, code != "", r.RemoteAddr, r.Header.Get("X-Forwarded-For"))

	if state == "" {
		log.Printf("[OAuth2] callback rejected provider=%s reason=missing_state remote_addr=%s", providerType, r.RemoteAddr)
		http.Error(w, "missing state parameter", http.StatusBadRequest)
		return
	}

	// 验证会话状态
	session, err := h.authSessionService.GetSessionByState(state)
	if err != nil {
		log.Printf("[OAuth2] callback session lookup failed provider=%s state_hash=%s error=%v", providerType, stateHash, err)
		h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, "invalid session")
		http.Error(w, "invalid session", http.StatusBadRequest)
		return
	}

	// 检查会话是否已过期
	if session.IsExpired() {
		log.Printf("[OAuth2] callback session expired provider=%s session_id=%d state_hash=%s expires_at=%s",
			providerType, session.ID, stateHash, session.ExpiresAt.Format(time.RFC3339))
		h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusExpired, "session expired")
		http.Error(w, "session expired", http.StatusGone)
		return
	}

	// 检查会话状态
	if session.Status != models.OAuth2AuthSessionStatusPending {
		log.Printf("[OAuth2] callback session already processed provider=%s session_id=%d state_hash=%s status=%s",
			providerType, session.ID, stateHash, session.Status)
		http.Error(w, "session already processed", http.StatusConflict)
		return
	}

	var mailProviderType models.MailProviderType
	switch providerType {
	case "gmail":
		mailProviderType = models.ProviderTypeGmail
	case "outlook":
		mailProviderType = models.ProviderTypeOutlook
	default:
		log.Printf("[OAuth2] callback unsupported provider provider=%s state_hash=%s", providerType, stateHash)
		h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, "unsupported provider type")
		http.Error(w, "unsupported provider type", http.StatusBadRequest)
		return
	}

	// Use the OAuth2 config from the session (which supports multi-config)
	config, err := h.configService.GetConfigByID(session.ProviderID)
	if err != nil {
		log.Printf("[OAuth2] callback provider config not found provider=%s session_id=%d state_hash=%s config_id=%d error=%v",
			providerType, session.ID, stateHash, session.ProviderID, err)
		h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, "provider config not found")
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Verify the config provider type matches the callback provider type
	if config.ProviderType != mailProviderType {
		log.Printf("[OAuth2] callback provider mismatch provider=%s session_id=%d state_hash=%s config_provider=%s",
			providerType, session.ID, stateHash, config.ProviderType)
		h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, "provider type mismatch")
		http.Error(w, "provider type mismatch", http.StatusBadRequest)
		return
	}

	// 交换授权码获取令牌
	accessToken, refreshToken, err := h.oauth2Service.ExchangeCodeForTokens(
		providerType,
		config.ClientID,
		config.ClientSecret,
		code,
		config.RedirectURI,
	)
	if err != nil {
		log.Printf("[OAuth2] callback token exchange failed provider=%s session_id=%d state_hash=%s error=%v",
			providerType, session.ID, stateHash, err)
		h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, fmt.Sprintf("token exchange failed: %v", err))
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 获取用户邮箱信息
	var userEmail string
	var userInfo models.JSONMap

	if providerType == "gmail" {

		userInfoResp, err := http.Get("https://www.googleapis.com/oauth2/v2/userinfo?access_token=" + accessToken)
		if err != nil {
			log.Printf("[OAuth2] Failed to get Gmail user info: %v", err)
			h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, "failed to get user info")
			http.Error(w, "failed to get user info", http.StatusInternalServerError)
			return
		}
		defer userInfoResp.Body.Close()

		if userInfoResp.StatusCode == 200 {
			var responseData map[string]interface{}
			if err := json.NewDecoder(userInfoResp.Body).Decode(&responseData); err != nil {

				h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, "failed to parse user info")
				http.Error(w, "failed to parse user info", http.StatusInternalServerError)
				return
			}

			// 提取邮箱
			if email, ok := responseData["email"]; ok && email != nil {
				userEmail = email.(string)
			}

			// 保存完整用户信息，转换为JSONMap格式
			userInfo = make(models.JSONMap)
			for k, v := range responseData {
				if v != nil {
					userInfo[k] = fmt.Sprintf("%v", v)
				}
			}
		} else {
			h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, "user info API error")
			http.Error(w, "user info API error", http.StatusInternalServerError)
			return
		}

	}

	// 更新会话状态为成功，并保存认证数据
	err = h.authSessionService.CompleteAuthFlow(
		state,
		userEmail,
		accessToken,
		refreshToken,
		"Bearer",
		time.Now().Add(time.Hour).Unix(),
		userInfo,
	)
	if err != nil {
		log.Printf("[OAuth2] callback complete auth flow failed provider=%s session_id=%d state_hash=%s error=%v",
			providerType, session.ID, stateHash, err)
		h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusFailed, "failed to save auth data")
		http.Error(w, "failed to save auth data", http.StatusInternalServerError)
		return
	}

	log.Printf("[OAuth2] callback success provider=%s session_id=%d state_hash=%s has_email=%t",
		providerType, session.ID, stateHash, userEmail != "")

	// 构建前端重定向URL
	frontendUrl := "http://localhost:3000"
	if frontendEnv := r.Header.Get("X-Frontend-URL"); frontendEnv != "" {
		frontendUrl = frontendEnv
	}

	// 重定向到成功页面，携带state参数用于前端轮询获取结果
	callbackUrl := fmt.Sprintf("%s/oauth2/success?state=%s&provider=%s", frontendUrl, state, providerType)

	http.Redirect(w, r, callbackUrl, http.StatusFound)
}

// StartOAuth2Session 创建OAuth2授权会话并返回授权URL
func (h *OAuth2Handler) StartOAuth2Session(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	providerType := vars["provider"]

	var mailProviderType models.MailProviderType
	switch providerType {
	case "gmail":
		mailProviderType = models.ProviderTypeGmail
	case "outlook":
		mailProviderType = models.ProviderTypeOutlook
	default:
		http.Error(w, "unsupported provider type", http.StatusBadRequest)
		return
	}

	// 检查是否指定了特定的配置ID
	var config *models.OAuth2GlobalConfig
	var err error

	configIDStr := r.URL.Query().Get("config_id")
	if configIDStr != "" {
		// 通过配置ID获取特定的OAuth2配置
		configID, parseErr := strconv.ParseUint(configIDStr, 10, 32)
		if parseErr != nil {
			http.Error(w, "invalid config_id format", http.StatusBadRequest)
			return
		}

		config, err = h.configService.GetConfigByID(uint(configID))
		if err != nil {
			http.Error(w, fmt.Sprintf("OAuth2 config not found: %v", err), http.StatusNotFound)
			return
		}

		// 验证配置类型是否匹配
		if config.ProviderType != mailProviderType {
			http.Error(w, fmt.Sprintf("config provider type mismatch: expected %s, got %s", mailProviderType, config.ProviderType), http.StatusBadRequest)
			return
		}
	} else {
		// 回退到默认的provider type查找
		config, err = h.configService.GetProviderConfig(mailProviderType)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	// 生成唯一的state参数
	state, err := generateRandomString(32)
	if err != nil {
		http.Error(w, "failed to generate state", http.StatusInternalServerError)
		return
	}

	// 创建授权会话
	session, err := h.authSessionService.CreateSession(uint(config.ID), state, 10) // 10分钟过期
	if err != nil {
		log.Printf("[OAuth2] session start failed provider=%s config_id=%d state_hash=%s error=%v",
			providerType, config.ID, hashOAuth2State(state), err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[OAuth2] session started provider=%s config_id=%d session_id=%d state_hash=%s redirect_uri=%s",
		providerType, config.ID, session.ID, hashOAuth2State(state), config.RedirectURI)

	// 生成授权URL
	authURL, err := h.oauth2Service.GenerateAuthURL(providerType, config.ClientID, config.RedirectURI, state)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"session_id": session.ID,
		"state":      state,
		"auth_url":   authURL,
		"expires_at": session.ExpiresAt.Unix(),
	})
}

// PollOAuth2SessionStatus 轮询OAuth2授权会话状态
func (h *OAuth2Handler) PollOAuth2SessionStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	state := vars["state"]

	if state == "" {
		http.Error(w, "state parameter is required", http.StatusBadRequest)
		return
	}

	session, err := h.authSessionService.GetSessionByState(state)
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	// 检查会话是否过期
	if session.IsExpired() {
		// 更新状态为expired
		h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusExpired, "session expired")

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":     "expired",
			"error_msg":  "session expired",
			"expires_at": session.ExpiresAt.Unix(),
		})
		return
	}

	response := map[string]interface{}{
		"status":     string(session.Status),
		"expires_at": session.ExpiresAt.Unix(),
	}

	// 如果授权成功，包含账户信息
	if session.Status == models.OAuth2AuthSessionStatusSuccess {
		response["emailAddress"] = session.EmailAddress
		response["customSettings"] = session.GetCustomSettings()
	}

	// 如果有错误信息，包含错误
	if session.ErrorMsg != "" {
		response["error_msg"] = session.ErrorMsg
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// CancelOAuth2Session 取消OAuth2授权会话
func (h *OAuth2Handler) CancelOAuth2Session(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	state := vars["state"]

	if state == "" {
		http.Error(w, "state parameter is required", http.StatusBadRequest)
		return
	}

	err := h.authSessionService.UpdateStatus(state, models.OAuth2AuthSessionStatusCancelled, "user cancelled")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "session cancelled successfully"})
}

// ExchangeToken manually exchanges authorization code for tokens
func (h *OAuth2Handler) ExchangeToken(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Provider    string `json:"provider"`
		Code        string `json:"code"`
		RedirectURI string `json:"redirect_uri"`
		ConfigID    *uint  `json:"config_id,omitempty"` // Optional: specific OAuth2 config to use
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if request.Provider == "" || request.Code == "" {
		http.Error(w, "provider and code are required", http.StatusBadRequest)
		return
	}

	var mailProviderType models.MailProviderType
	switch request.Provider {
	case "gmail":
		mailProviderType = models.ProviderTypeGmail
	case "outlook":
		mailProviderType = models.ProviderTypeOutlook
	default:
		http.Error(w, "unsupported provider type", http.StatusBadRequest)
		return
	}

	var config *models.OAuth2GlobalConfig
	var err error

	// Priority 1: Use specific config ID if provided (new multi-config support)
	if request.ConfigID != nil && *request.ConfigID > 0 {
		config, err = h.configService.GetConfigByID(*request.ConfigID)
		if err != nil {
			http.Error(w, fmt.Sprintf("OAuth2 config not found: %v", err), http.StatusNotFound)
			return
		}

		// Verify config provider type matches
		if config.ProviderType != mailProviderType {
			http.Error(w, fmt.Sprintf("config provider type mismatch: expected %s, got %s", mailProviderType, config.ProviderType), http.StatusBadRequest)
			return
		}
	} else {
		// Priority 2: Fallback to default provider type lookup (backward compatibility)
		config, err = h.configService.GetProviderConfig(mailProviderType)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	redirectURI := request.RedirectURI
	if redirectURI == "" {
		redirectURI = config.RedirectURI
	}

	accessToken, refreshToken, err := h.oauth2Service.ExchangeCodeForTokens(
		request.Provider,
		config.ClientID,
		config.ClientSecret,
		request.Code,
		redirectURI,
	)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"provider":      request.Provider,
		"expires_at":    time.Now().Add(time.Hour).Unix(),
	})
}

// ExchangeThunderbirdToken exchanges authorization code for tokens using Thunderbird configuration
func (h *OAuth2Handler) ExchangeThunderbirdToken(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Code string `json:"code"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if request.Code == "" {
		http.Error(w, "authorization code is required", http.StatusBadRequest)
		return
	}

	// Thunderbird固定配置（使用Outlook提供商配置，因为Thunderbird使用相同的Microsoft OAuth2端点）
	clientId := "9e5f94bc-e8a4-4e73-b8be-63364c29d753"
	redirectUri := "https://localhost"
	scope := "offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/POP.AccessAsUser.All https://outlook.office.com/EWS.AccessAsUser.All https://outlook.office.com/SMTP.Send"

	// 使用OAuth2服务来交换授权码获取token
	accessToken, refreshToken, err := h.oauth2Service.ExchangeCodeForTokens(
		"outlook", // Thunderbird使用与Outlook相同的Microsoft OAuth2端点
		clientId,
		"", // Thunderbird是公开客户端，无需secret
		request.Code,
		redirectUri,
	)

	if err != nil {
		log.Printf("[OAuth2] Thunderbird token exchange failed: %v", err)
		http.Error(w, fmt.Sprintf("failed to exchange authorization code: %v", err), http.StatusInternalServerError)
		return
	}

	// 返回获取的tokens
	response := map[string]interface{}{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"token_type":    "Bearer",
		"expires_in":    3600, // 1小时
		"scope":         scope,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// RefreshTokenHandler refreshes access token using refresh token
func (h *OAuth2Handler) RefreshTokenHandler(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Provider     string `json:"provider"`
		RefreshToken string `json:"refresh_token"`
		ConfigID     *uint  `json:"config_id,omitempty"`  // Optional: specific OAuth2 config to use
		AccountID    *uint  `json:"account_id,omitempty"` // Optional: account ID for better caching
		Proxy        string `json:"proxy,omitempty"`      // Optional: proxy settings
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if request.Provider == "" || request.RefreshToken == "" {
		http.Error(w, "provider and refresh_token are required", http.StatusBadRequest)
		return
	}

	var mailProviderType models.MailProviderType
	switch request.Provider {
	case "gmail":
		mailProviderType = models.ProviderTypeGmail
	case "outlook":
		mailProviderType = models.ProviderTypeOutlook
	default:
		http.Error(w, "unsupported provider type", http.StatusBadRequest)
		return
	}

	var config *models.OAuth2GlobalConfig
	var err error

	// Priority 1: Use specific config ID if provided (new multi-config support)
	if request.ConfigID != nil && *request.ConfigID > 0 {
		config, err = h.configService.GetConfigByID(*request.ConfigID)
		if err != nil {
			http.Error(w, fmt.Sprintf("OAuth2 config not found: %v", err), http.StatusNotFound)
			return
		}

		// Verify config provider type matches
		if config.ProviderType != mailProviderType {
			http.Error(w, fmt.Sprintf("config provider type mismatch: expected %s, got %s", mailProviderType, config.ProviderType), http.StatusBadRequest)
			return
		}
	} else {
		// Priority 2: Fallback to default provider type lookup (backward compatibility)
		config, err = h.configService.GetProviderConfig(mailProviderType)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	// Use cached method with concurrency protection to avoid "invalid_grant" errors
	// when multiple processes try to refresh tokens simultaneously
	accountID := uint(0)
	if request.AccountID != nil {
		accountID = *request.AccountID
	}

	newAccessToken, err := h.oauth2Service.RefreshAccessTokenWithCacheAndProxy(
		request.Provider,
		config.ClientID,
		config.ClientSecret,
		request.RefreshToken,
		accountID,
		request.Proxy,
	)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to refresh access token: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"access_token":  newAccessToken,
		"refresh_token": request.RefreshToken, // 重用原始刷新令牌
		"provider":      request.Provider,
		"expires_at":    time.Now().Add(time.Hour).Unix(),
	})
}
