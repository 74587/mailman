package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/services"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
)

// CreateOAuth2AccountOnboardingHandler creates or updates an OAuth2 account and completes the normal setup flow.
// @Summary Create or update OAuth2 account with verification, initial sync, and sync settings
// @Description Create/update an OAuth2 email account after authorization, verify connectivity, run initial sync, and save automatic sync settings in one request.
// @Tags accounts
// @Accept json
// @Produce json
// @Param request body CreateOAuth2AccountOnboardingRequest true "OAuth2 account onboarding request"
// @Success 200 {object} CreateOAuth2AccountOnboardingResponse
// @Success 201 {object} CreateOAuth2AccountOnboardingResponse
// @Failure 400 {object} ErrorResponse
// @Failure 403 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/oauth2/onboard [post]
func (h *APIHandler) CreateOAuth2AccountOnboardingHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	var request CreateOAuth2AccountOnboardingRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	request.EmailAddress = strings.TrimSpace(strings.ToLower(request.EmailAddress))
	if request.EmailAddress == "" {
		http.Error(w, "emailAddress is required", http.StatusBadRequest)
		return
	}
	if request.AuthType == "" {
		request.AuthType = models.AuthTypeOAuth2
	}
	if request.AuthType != models.AuthTypeOAuth2 {
		http.Error(w, "authType must be oauth2", http.StatusBadRequest)
		return
	}
	if request.CustomSettings == nil {
		request.CustomSettings = models.JSONMap{}
	}
	if strings.TrimSpace(request.CustomSettings["access_token"]) == "" {
		http.Error(w, "customSettings.access_token is required", http.StatusBadRequest)
		return
	}

	if request.OAuth2ProviderID == nil {
		request.OAuth2ProviderID = oauth2ProviderIDFromSettings(request.CustomSettings)
	}

	if request.OAuth2ProviderID != nil {
		request.CustomSettings["oauth2_provider_config_id"] = strconv.FormatUint(uint64(*request.OAuth2ProviderID), 10)
	}

	if err := h.fillOAuth2MailProviderID(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	updateExisting := request.UpdateExisting == nil || *request.UpdateExisting
	existingAccount, err := h.EmailAccountRepo.GetByEmailWithProvider(request.EmailAddress)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if existingAccount != nil && orgID > 0 && existingAccount.OrgID != orgID {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}
	if existingAccount != nil && !updateExisting {
		http.Error(w, "email account already exists", http.StatusConflict)
		return
	}

	account := buildOAuth2OnboardingAccount(request, orgID)
	created := existingAccount == nil
	if existingAccount != nil {
		account.ID = existingAccount.ID
		account.CreatedAt = existingAccount.CreatedAt
		if orgID == 0 {
			account.OrgID = existingAccount.OrgID
		}
		account.IsVerified = existingAccount.IsVerified
		account.VerifiedAt = existingAccount.VerifiedAt
		account.LastSyncAt = existingAccount.LastSyncAt
		account.ErrorStatus = existingAccount.ErrorStatus
		account.ErrorMessage = existingAccount.ErrorMessage
		account.ErrorTimestamp = existingAccount.ErrorTimestamp
		account.ErrorCount = existingAccount.ErrorCount
		account.AutoDisabledAt = existingAccount.AutoDisabledAt
		preserveExistingOAuth2OnboardingSettings(&account, existingAccount, request)
	}

	if h.ProxyPoolService != nil {
		if err := h.ProxyPoolService.PrepareAccountProxy(&account); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	if created {
		if err := h.EmailAccountRepo.Create(&account); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else if err := h.EmailAccountRepo.Update(&account); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	userID := getUserIDFromContext(r)
	if created {
		h.activityLogger.LogAccountActivity(models.ActivityAccountAdded, &account, userID)
	} else {
		h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, &account, userID)
	}

	response := CreateOAuth2AccountOnboardingResponse{
		Account:   account,
		Created:   created,
		Updated:   !created,
		Completed: true,
		Message:   "OAuth2 account onboarding completed",
	}

	if shouldRun(request.Verify, true) {
		verification := h.verifyAccountByID(account.ID)
		response.Verification = &verification
		if !verification.Success {
			response.Completed = false
			response.FailedStage = "verify"
			response.Message = verification.Error
			writeOAuth2OnboardingResponse(w, created, response)
			return
		}
		if verifiedAccount, err := h.EmailAccountRepo.GetByID(account.ID); err == nil && verifiedAccount != nil {
			verifiedAccount.ErrorStatus = string(models.ErrorStatusNormal)
			verifiedAccount.ErrorMessage = ""
			verifiedAccount.ErrorTimestamp = nil
			verifiedAccount.ErrorCount = 0
			if err := h.EmailAccountRepo.Update(verifiedAccount); err != nil {
				response.Completed = false
				response.FailedStage = "verify"
				response.Message = fmt.Sprintf("Connection verified but failed to reset account error status: %v", err)
				writeOAuth2OnboardingResponse(w, created, response)
				return
			}
			response.Account = *verifiedAccount
			account = *verifiedAccount
		}
	}

	if shouldRun(request.RunInitialSync, true) {
		syncResponse, err := h.runFetchAndStoreForAccount(r, account, request.InitialSync)
		if err != nil {
			response.Completed = false
			response.FailedStage = "initial_sync"
			response.Message = err.Error()
			writeOAuth2OnboardingResponse(w, created, response)
			return
		}
		response.InitialSync = syncResponse
		if len(syncResponse.Messages) > 0 {
			response.Completed = false
			response.FailedStage = "initial_sync"
			response.Message = strings.Join(syncResponse.Messages, "; ")
			writeOAuth2OnboardingResponse(w, created, response)
			return
		}
	}

	if shouldRun(request.CreateSyncConfig, true) {
		syncConfig, err := h.createOAuth2OnboardingSyncConfig(account.ID, request.SyncConfig)
		if err != nil {
			response.Completed = false
			response.FailedStage = "sync_config"
			response.Message = err.Error()
			writeOAuth2OnboardingResponse(w, created, response)
			return
		}
		response.SyncConfig = syncConfig
	}

	writeOAuth2OnboardingResponse(w, created, response)
}

func writeOAuth2OnboardingResponse(w http.ResponseWriter, created bool, response CreateOAuth2AccountOnboardingResponse) {
	w.Header().Set("Content-Type", "application/json")
	if created {
		w.WriteHeader(http.StatusCreated)
	} else {
		w.WriteHeader(http.StatusOK)
	}
	json.NewEncoder(w).Encode(response)
}

func shouldRun(value *bool, defaultValue bool) bool {
	if value == nil {
		return defaultValue
	}
	return *value
}

func oauth2ProviderIDFromSettings(settings models.JSONMap) *uint {
	if settings == nil {
		return nil
	}
	raw := strings.TrimSpace(settings["oauth2_provider_config_id"])
	if raw == "" {
		raw = strings.TrimSpace(settings["oauth2ProviderConfigId"])
	}
	if raw == "" {
		return nil
	}
	parsed, err := strconv.ParseUint(raw, 10, 32)
	if err != nil || parsed == 0 {
		return nil
	}
	value := uint(parsed)
	return &value
}

func (h *APIHandler) fillOAuth2MailProviderID(request *CreateOAuth2AccountOnboardingRequest) error {
	if request.MailProviderID != nil {
		return nil
	}

	providerType := models.MailProviderType("")
	if request.OAuth2ProviderID != nil {
		var config models.OAuth2GlobalConfig
		err := h.EmailAccountRepo.GetDB().First(&config, *request.OAuth2ProviderID).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return fmt.Errorf("OAuth2 config %d not found", *request.OAuth2ProviderID)
			}
			return err
		}
		providerType = config.ProviderType
	}
	if providerType == "" {
		providerType = inferOAuth2ProviderTypeFromEmail(request.EmailAddress)
	}
	if providerType == "" || providerType == models.ProviderTypeCustom {
		return fmt.Errorf("mailProviderId is required when provider cannot be inferred from OAuth2 config or email domain")
	}

	providers, err := h.MailProviderRepo.GetByType(providerType)
	if err != nil {
		return err
	}
	if len(providers) == 0 {
		return fmt.Errorf("mail provider for type %s not found", providerType)
	}
	request.MailProviderID = &providers[0].ID
	return nil
}

func inferOAuth2ProviderTypeFromEmail(email string) models.MailProviderType {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(email)), "@")
	if len(parts) != 2 {
		return ""
	}
	switch parts[1] {
	case "gmail.com", "googlemail.com":
		return models.ProviderTypeGmail
	case "outlook.com", "hotmail.com", "live.com", "msn.com":
		return models.ProviderTypeOutlook
	default:
		return ""
	}
}

func buildOAuth2OnboardingAccount(request CreateOAuth2AccountOnboardingRequest, orgID uint) models.EmailAccount {
	return models.EmailAccount{
		EmailAddress:         request.EmailAddress,
		AuthType:             models.AuthTypeOAuth2,
		Password:             services.EncryptIfAvailable(request.Password),
		Token:                services.EncryptIfAvailable(request.Token),
		MailProviderID:       request.MailProviderID,
		OAuth2ProviderID:     request.OAuth2ProviderID,
		Proxy:                request.Proxy,
		ProxyMode:            models.NormalizeProxyAccountMode(request.ProxyMode),
		ProxyID:              request.ProxyID,
		ProxyFallbackMode:    models.NormalizeProxyFallbackMode(request.ProxyFallbackMode),
		ProxyFallbackProxyID: request.ProxyFallbackProxyID,
		ProxyFallbackProxy:   request.ProxyFallbackProxy,
		ProxyMatchGroupIDs:   request.ProxyMatchGroupIDs,
		ProxyMatchTagIDs:     request.ProxyMatchTagIDs,
		ProxyMatchTagMode:    models.NormalizeProxyTagFilterMode(request.ProxyMatchTagMode),
		IsDomainMail:         request.IsDomainMail,
		Domain:               request.Domain,
		ForwardedAddresses:   models.NormalizeEmailRoutingAddresses(request.ForwardedAddresses),
		Note:                 request.Note,
		NoteFormat:           models.NormalizeAccountNoteFormat(request.NoteFormat),
		CustomSettings:       request.CustomSettings,
		OrgID:                orgID,
	}
}

func preserveExistingOAuth2OnboardingSettings(account *models.EmailAccount, existing *models.EmailAccount, request CreateOAuth2AccountOnboardingRequest) {
	if account == nil || existing == nil {
		return
	}

	if request.Proxy == "" &&
		request.ProxyMode == "" &&
		request.ProxyID == nil &&
		request.ProxyFallbackMode == "" &&
		request.ProxyFallbackProxyID == nil &&
		request.ProxyFallbackProxy == "" &&
		len(request.ProxyMatchGroupIDs) == 0 &&
		len(request.ProxyMatchTagIDs) == 0 &&
		request.ProxyMatchTagMode == "" {
		account.Proxy = existing.Proxy
		account.ProxyMode = existing.ProxyMode
		account.ProxyID = existing.ProxyID
		account.ProxyFallbackMode = existing.ProxyFallbackMode
		account.ProxyFallbackProxyID = existing.ProxyFallbackProxyID
		account.ProxyFallbackProxy = existing.ProxyFallbackProxy
		account.ProxyMatchGroupIDs = existing.ProxyMatchGroupIDs
		account.ProxyMatchTagIDs = existing.ProxyMatchTagIDs
		account.ProxyMatchTagMode = existing.ProxyMatchTagMode
	}

	if !request.IsDomainMail && strings.TrimSpace(request.Domain) == "" {
		account.IsDomainMail = existing.IsDomainMail
		account.Domain = existing.Domain
	}
	if len(request.ForwardedAddresses) == 0 {
		account.ForwardedAddresses = existing.ForwardedAddresses
	}
	if strings.TrimSpace(request.Note) == "" && request.NoteFormat == "" {
		account.Note = existing.Note
		account.NoteFormat = existing.NoteFormat
	}
}

func (h *APIHandler) runFetchAndStoreForAccount(r *http.Request, account models.EmailAccount, request *FetchAndStoreRequest) (*FetchAndStoreResponse, error) {
	startTime := time.Now()

	syncRequest := FetchAndStoreRequest{}
	if request != nil {
		syncRequest = *request
	}
	if syncRequest.SyncMode == "" {
		syncRequest.SyncMode = "incremental"
	}
	if len(syncRequest.Mailboxes) == 0 {
		syncRequest.Mailboxes = []string{"INBOX"}
	}
	if syncRequest.MaxEmailsPerMailbox <= 0 {
		syncRequest.MaxEmailsPerMailbox = 1000
	}
	if !syncRequest.IncludeBody {
		syncRequest.IncludeBody = true
	}

	var defaultStartDate *time.Time
	var endDate *time.Time
	if syncRequest.DefaultStartDate != nil {
		parsed, err := time.Parse(time.RFC3339, *syncRequest.DefaultStartDate)
		if err != nil {
			return nil, fmt.Errorf("Invalid default_start_date format: %v", err)
		}
		defaultStartDate = &parsed
	} else {
		oneMonthAgo := time.Now().AddDate(0, -1, 0)
		defaultStartDate = &oneMonthAgo
	}

	if syncRequest.EndDate != nil {
		parsed, err := time.Parse(time.RFC3339, *syncRequest.EndDate)
		if err != nil {
			return nil, fmt.Errorf("Invalid end_date format: %v", err)
		}
		endDate = &parsed
	} else {
		now := time.Now()
		endDate = &now
	}

	var mailboxResults []MailboxSyncResult
	var totalEmailsProcessed int
	var totalNewEmails int
	var messages []string

	for _, mailboxName := range syncRequest.Mailboxes {
		result := h.processSingleMailbox(
			account,
			mailboxName,
			syncRequest.SyncMode,
			defaultStartDate,
			endDate,
			syncRequest.MaxEmailsPerMailbox,
			syncRequest.IncludeBody,
		)

		mailboxResults = append(mailboxResults, result)
		totalEmailsProcessed += result.EmailsProcessed
		totalNewEmails += result.NewEmails
		if result.Error != "" {
			messages = append(messages, fmt.Sprintf("Error in mailbox %s: %s", mailboxName, result.Error))
		}
	}

	processingTime := time.Since(startTime)
	if totalNewEmails > 0 {
		h.activityLogger.LogActivity(
			models.ActivityEmailReceived,
			fmt.Sprintf("收到 %d 封新邮件", totalNewEmails),
			fmt.Sprintf("账户 %s 同步了 %d 封新邮件", account.EmailAddress, totalNewEmails),
			getUserIDFromContext(r),
			map[string]interface{}{
				"sync_mode":       syncRequest.SyncMode,
				"mailboxes":       syncRequest.Mailboxes,
				"total_processed": totalEmailsProcessed,
				"new_emails":      totalNewEmails,
				"processing_ms":   processingTime.Nanoseconds() / 1000000,
			},
		)
	}

	return &FetchAndStoreResponse{
		Status:               "success",
		SyncMode:             syncRequest.SyncMode,
		MailboxResults:       mailboxResults,
		TotalEmailsProcessed: totalEmailsProcessed,
		TotalNewEmails:       totalNewEmails,
		ProcessingTimeMs:     processingTime.Nanoseconds() / 1000000,
		Messages:             messages,
	}, nil
}

func (h *APIHandler) createOAuth2OnboardingSyncConfig(accountID uint, request *AccountOnboardSyncConfigRequest) (*models.EmailAccountSyncConfig, error) {
	if h.SyncConfigRepo == nil {
		return nil, fmt.Errorf("sync config repository is not available")
	}

	enableAutoSync := true
	syncInterval := 300
	syncFolders := models.StringSlice{"INBOX"}
	if request != nil {
		if request.EnableAutoSync != nil {
			enableAutoSync = *request.EnableAutoSync
		}
		if request.SyncInterval > 0 {
			syncInterval = request.SyncInterval
		}
		if len(request.SyncFolders) > 0 {
			syncFolders = models.StringSlice(request.SyncFolders)
		}
	}

	config := &models.EmailAccountSyncConfig{
		AccountID:         accountID,
		EnableAutoSync:    enableAutoSync,
		SyncInterval:      syncInterval,
		SyncFolders:       syncFolders,
		SyncStatus:        models.SyncStatusIdle,
		LastSyncMessageID: "",
	}
	if err := h.SyncConfigRepo.CreateOrUpdateSettings(config); err != nil {
		return nil, err
	}

	savedConfig, err := h.SyncConfigRepo.GetByAccountID(accountID)
	if err != nil {
		savedConfig = config
	}
	if h.perAccountSyncManager != nil {
		if err := h.perAccountSyncManager.UpdateSubscription(accountID, savedConfig); err != nil {
			return nil, err
		}
	}
	return savedConfig, nil
}
