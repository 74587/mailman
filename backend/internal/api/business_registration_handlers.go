package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mailman/internal/models"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"gorm.io/gorm"
)

const (
	defaultBusinessClaimTTLSeconds = 600
	minBusinessClaimTTLSeconds     = 60
	maxBusinessClaimTTLSeconds     = 3600

	businessEmailModeAuto      = "auto"
	businessEmailModePrimary   = "primary"
	businessEmailModeDomain    = "domain"
	businessEmailModeAlias     = "alias"
	businessEmailModeForwarded = "forwarded"

	businessAliasTypeGmailPlus  = "gmail_plus"
	businessAliasTypeDomainPart = "domain_local_part"
	businessAliasTypeForwarded  = "forwarded"
)

type BusinessEmailClaimRequest struct {
	TTLSeconds int    `json:"ttlSeconds,omitempty"`
	ClaimedBy  string `json:"claimedBy,omitempty"`

	AccountID    *uint  `json:"accountId,omitempty"`
	EmailAddress string `json:"emailAddress,omitempty"`

	EmailMode      string `json:"emailMode,omitempty"`
	UseDomainMail  *bool  `json:"useDomainMail,omitempty"`
	Domain         string `json:"domain,omitempty"`
	UseAlias       bool   `json:"useAlias,omitempty"`
	AliasType      string `json:"aliasType,omitempty"`
	AliasLocalPart string `json:"aliasLocalPart,omitempty"`

	TagIDs        []uint   `json:"tagIds,omitempty"`
	TagFilterMode string   `json:"tagFilterMode,omitempty"`
	ProviderID    *uint    `json:"providerId,omitempty"`
	AuthTypes     []string `json:"authTypes,omitempty"`
	ProxyMode     string   `json:"proxyMode,omitempty"`

	BusinessAccount BusinessAccountClaimSeed `json:"businessAccount,omitempty"`
}

type BusinessAccountClaimSeed struct {
	DisplayName  string                   `json:"displayName,omitempty"`
	Username     string                   `json:"username,omitempty"`
	Description  string                   `json:"description,omitempty"`
	Note         string                   `json:"note,omitempty"`
	NoteFormat   models.AccountNoteFormat `json:"noteFormat,omitempty"`
	Tags         models.StringSlice       `json:"tags,omitempty"`
	CustomFields models.JSONMapInterface  `json:"customFields,omitempty"`
	ExtraData    models.JSONMapInterface  `json:"extraData,omitempty"`
}

type BusinessEmailClaimResponse struct {
	BusinessAccountID uint                        `json:"businessAccountId"`
	ClaimToken        string                      `json:"claimToken"`
	ClaimExpiresAt    time.Time                   `json:"claimExpiresAt"`
	TTLSeconds        int                         `json:"ttlSeconds"`
	Module            BusinessClaimModuleSummary  `json:"module"`
	EmailAccount      BusinessClaimEmailSummary   `json:"emailAccount"`
	Recipient         BusinessClaimRecipient      `json:"recipient"`
	Pickup            BusinessClaimPickupParams   `json:"pickup"`
	BusinessAccount   BusinessClaimAccountSummary `json:"businessAccount"`
}

type BusinessClaimModuleSummary struct {
	ID   uint   `json:"id"`
	Name string `json:"name"`
}

type BusinessClaimEmailSummary struct {
	ID             uint                    `json:"id"`
	EmailAddress   string                  `json:"emailAddress"`
	AuthType       models.AuthType         `json:"authType"`
	IsDomainMail   bool                    `json:"isDomainMail"`
	Domain         string                  `json:"domain,omitempty"`
	MailProviderID *uint                   `json:"mailProviderId,omitempty"`
	ProxyMode      models.ProxyAccountMode `json:"proxyMode"`
	ProxyID        *uint                   `json:"proxyId,omitempty"`
	IsVerified     bool                    `json:"isVerified"`
	ErrorStatus    string                  `json:"errorStatus"`
}

type BusinessClaimRecipient struct {
	EmailAddress string `json:"emailAddress"`
	Kind         string `json:"kind"`
	ToQuery      string `json:"toQuery"`
	ResolvedBy   string `json:"resolvedBy"`
	Domain       string `json:"domain,omitempty"`
	LocalPart    string `json:"localPart,omitempty"`
}

type BusinessClaimPickupParams struct {
	AccountID uint   `json:"account_id"`
	ToQuery   string `json:"to_query"`
}

type BusinessClaimAccountSummary struct {
	ID                uint                         `json:"id"`
	Status            models.BusinessAccountStatus `json:"status"`
	EmailAccountID    *uint                        `json:"emailAccountId,omitempty"`
	ModuleID          *uint                        `json:"moduleId,omitempty"`
	RegistrationEmail *string                      `json:"registrationEmail,omitempty"`
}

type CompleteRegistrationRequest struct {
	ClaimToken      string                       `json:"claimToken"`
	Username        *string                      `json:"username,omitempty"`
	Password        *string                      `json:"password,omitempty"`
	TOTPSecret      *string                      `json:"totpSecret,omitempty"`
	PhoneNumber     *string                      `json:"phoneNumber,omitempty"`
	RecoveryEmail   *string                      `json:"recoveryEmail,omitempty"`
	RecoveryCodes   models.StringSlice           `json:"recoveryCodes,omitempty"`
	Status          models.BusinessAccountStatus `json:"status,omitempty"`
	Description     *string                      `json:"description,omitempty"`
	Note            *string                      `json:"note,omitempty"`
	NoteFormat      models.AccountNoteFormat     `json:"noteFormat,omitempty"`
	Tags            models.StringSlice           `json:"tags,omitempty"`
	CustomFields    models.JSONMapInterface      `json:"customFields,omitempty"`
	ExtraData       models.JSONMapInterface      `json:"extraData,omitempty"`
	RemoteCreatedAt *time.Time                   `json:"remoteCreatedAt,omitempty"`
	LastLoginAt     *time.Time                   `json:"lastLoginAt,omitempty"`
}

type ReleaseRegistrationClaimRequest struct {
	ClaimToken           string `json:"claimToken"`
	Reason               string `json:"reason,omitempty"`
	Message              string `json:"message,omitempty"`
	DeletePendingAccount bool   `json:"deletePendingAccount,omitempty"`
}

type RenewRegistrationClaimRequest struct {
	ClaimToken string `json:"claimToken"`
	TTLSeconds int    `json:"ttlSeconds,omitempty"`
	Message    string `json:"message,omitempty"`
}

type RenewRegistrationClaimResponse struct {
	BusinessAccountID uint                         `json:"businessAccountId"`
	ClaimExpiresAt    time.Time                    `json:"claimExpiresAt"`
	TTLSeconds        int                          `json:"ttlSeconds"`
	Status            models.BusinessAccountStatus `json:"status"`
}

type businessClaimPlan struct {
	account           models.EmailAccount
	registrationEmail string
	recipient         BusinessClaimRecipient
}

// ClaimBusinessModuleEmailAccountHandler atomically reserves an email address for a business module registration.
func (h *APIHandler) ClaimBusinessModuleEmailAccountHandler(w http.ResponseWriter, r *http.Request) {
	module, ok := h.getBusinessModuleForRequest(w, r)
	if !ok {
		return
	}

	var req BusinessEmailClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	response, status, err := h.claimBusinessModuleEmailAccount(r, module, req)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	writeBusinessJSON(w, http.StatusCreated, response)
}

// CompleteBusinessRegistrationHandler marks a pending claimed business account as registered.
func (h *APIHandler) CompleteBusinessRegistrationHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.getBusinessAccountForRequest(w, r)
	if !ok {
		return
	}

	var req CompleteRegistrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateBusinessClaimToken(account, req.ClaimToken); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	now := time.Now().UTC()
	if account.Status == models.BusinessAccountStatusActive {
		writeBusinessJSON(w, http.StatusOK, account)
		return
	}
	if account.RegistrationEmail == nil {
		http.Error(w, "registration claim is not active", http.StatusConflict)
		return
	}
	if account.ClaimExpiresAt != nil && account.ClaimExpiresAt.Before(now) {
		http.Error(w, "registration claim has expired", http.StatusConflict)
		return
	}

	applyBusinessCompletion(account, req, now)
	if err := h.EmailAccountRepo.GetDB().Save(account).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.EmailAccountRepo.GetDB().Preload("EmailAccount").Preload("Module").First(account, account.ID).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusOK, account)
}

// ReleaseBusinessRegistrationClaimHandler releases a pending registration claim.
func (h *APIHandler) ReleaseBusinessRegistrationClaimHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.getBusinessAccountForRequest(w, r)
	if !ok {
		return
	}

	var req ReleaseRegistrationClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateBusinessClaimToken(account, req.ClaimToken); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if account.Status == models.BusinessAccountStatusActive {
		http.Error(w, "completed registration claim cannot be released", http.StatusConflict)
		return
	}

	db := h.EmailAccountRepo.GetDB()
	if req.DeletePendingAccount {
		if err := db.Model(account).Updates(map[string]interface{}{
			"registration_email": nil,
			"claim_expires_at":   nil,
			"claimed_by":         "",
			"status":             models.BusinessAccountStatusArchived,
		}).Error; err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := db.Delete(account).Error; err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeBusinessJSON(w, http.StatusOK, map[string]interface{}{
			"businessAccountId": account.ID,
			"released":          true,
			"deleted":           true,
		})
		return
	}

	now := time.Now().UTC()
	account.Status = models.BusinessAccountStatusArchived
	account.RegistrationEmail = nil
	account.ClaimExpiresAt = nil
	account.ClaimedBy = ""
	account.ExtraData = mergeBusinessJSONMap(account.ExtraData, models.JSONMapInterface{
		"registrationState": "released",
		"releaseReason":     strings.TrimSpace(req.Reason),
		"releaseMessage":    strings.TrimSpace(req.Message),
		"releasedAt":        now.Format(time.RFC3339),
	})

	if err := db.Save(account).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := db.Preload("EmailAccount").Preload("Module").First(account, account.ID).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusOK, account)
}

// RenewBusinessRegistrationClaimHandler extends an active pending claim.
func (h *APIHandler) RenewBusinessRegistrationClaimHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.getBusinessAccountForRequest(w, r)
	if !ok {
		return
	}

	var req RenewRegistrationClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateBusinessClaimToken(account, req.ClaimToken); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	if account.Status != models.BusinessAccountStatusPending || account.RegistrationEmail == nil {
		http.Error(w, "registration claim is not renewable", http.StatusConflict)
		return
	}

	now := time.Now().UTC()
	if account.ClaimExpiresAt != nil && account.ClaimExpiresAt.Before(now) {
		http.Error(w, "registration claim has expired", http.StatusConflict)
		return
	}

	ttl := normalizeBusinessClaimTTL(req.TTLSeconds)
	expiresAt := now.Add(time.Duration(ttl) * time.Second)
	account.ClaimExpiresAt = &expiresAt
	account.ExtraData = mergeBusinessJSONMap(account.ExtraData, models.JSONMapInterface{
		"registrationState": "claimed",
		"lastRenewedAt":     now.Format(time.RFC3339),
		"renewMessage":      strings.TrimSpace(req.Message),
	})
	if err := h.EmailAccountRepo.GetDB().Save(account).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeBusinessJSON(w, http.StatusOK, RenewRegistrationClaimResponse{
		BusinessAccountID: account.ID,
		ClaimExpiresAt:    expiresAt,
		TTLSeconds:        ttl,
		Status:            account.Status,
	})
}

func (h *APIHandler) claimBusinessModuleEmailAccount(r *http.Request, module *models.BusinessModule, req BusinessEmailClaimRequest) (*BusinessEmailClaimResponse, int, error) {
	orgID := GetCurrentOrgID(r)
	if orgID == 0 {
		orgID = module.OrgID
	}
	ttl := normalizeBusinessClaimTTL(req.TTLSeconds)
	now := time.Now().UTC()

	var response *BusinessEmailClaimResponse
	err := h.EmailAccountRepo.GetDB().Transaction(func(tx *gorm.DB) error {
		if err := clearExpiredBusinessRegistrationClaims(tx, orgID, module.ID, now); err != nil {
			return err
		}

		plans, err := h.buildBusinessClaimPlans(tx, orgID, module, req)
		if err != nil {
			return err
		}
		if len(plans) == 0 {
			return gorm.ErrRecordNotFound
		}

		token, err := generateBusinessClaimToken()
		if err != nil {
			return err
		}
		expiresAt := now.Add(time.Duration(ttl) * time.Second)

		for _, plan := range plans {
			available, err := businessRegistrationEmailAvailable(tx, orgID, module.ID, plan.registrationEmail)
			if err != nil {
				return err
			}
			if !available {
				continue
			}

			accountID := plan.account.ID
			moduleID := module.ID
			registrationEmail := plan.registrationEmail
			businessAccount := models.BusinessAccount{
				OrgID:             orgID,
				EmailAccountID:    &accountID,
				ModuleID:          &moduleID,
				ModuleName:        module.Name,
				DisplayName:       strings.TrimSpace(req.BusinessAccount.DisplayName),
				Website:           module.Website,
				LoginURL:          module.LoginURL,
				Username:          strings.TrimSpace(req.BusinessAccount.Username),
				Status:            models.BusinessAccountStatusPending,
				Description:       strings.TrimSpace(req.BusinessAccount.Description),
				Note:              req.BusinessAccount.Note,
				NoteFormat:        models.NormalizeAccountNoteFormat(req.BusinessAccount.NoteFormat),
				Tags:              normalizeBusinessStringSlice(req.BusinessAccount.Tags),
				CustomFields:      safeBusinessJSONMap(req.BusinessAccount.CustomFields),
				ExtraData:         safeBusinessJSONMap(req.BusinessAccount.ExtraData),
				RegistrationEmail: &registrationEmail,
				ClaimToken:        token,
				ClaimExpiresAt:    &expiresAt,
				ClaimedBy:         strings.TrimSpace(req.ClaimedBy),
			}
			if businessAccount.DisplayName == "" {
				businessAccount.DisplayName = module.Name + " registration"
			}
			businessAccount.ExtraData = mergeBusinessJSONMap(businessAccount.ExtraData, models.JSONMapInterface{
				"registrationState": "claimed",
				"registrationEmail": registrationEmail,
				"recipientKind":     plan.recipient.Kind,
				"claimedAt":         now.Format(time.RFC3339),
				"claimedBy":         businessAccount.ClaimedBy,
			})

			if err := tx.Create(&businessAccount).Error; err != nil {
				if isBusinessUniqueConstraintError(err) {
					continue
				}
				return err
			}
			if err := tx.Preload("EmailAccount").Preload("Module").First(&businessAccount, businessAccount.ID).Error; err != nil {
				return err
			}
			response = buildBusinessClaimResponse(module, &businessAccount, plan, token, expiresAt, ttl)
			return nil
		}
		return gorm.ErrRecordNotFound
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, http.StatusNotFound, fmt.Errorf("no available email account for business module")
		}
		return nil, http.StatusInternalServerError, err
	}
	return response, http.StatusCreated, nil
}

func (h *APIHandler) buildBusinessClaimPlans(tx *gorm.DB, orgID uint, module *models.BusinessModule, req BusinessEmailClaimRequest) ([]businessClaimPlan, error) {
	if req.AccountID != nil || strings.TrimSpace(req.EmailAddress) != "" {
		account, err := h.resolveBusinessClaimAccount(tx, orgID, req)
		if err != nil {
			return nil, err
		}
		if err := h.validateBusinessClaimAccount(tx, account, req); err != nil {
			return nil, err
		}
		plan, err := deriveBusinessClaimPlan(account, module, req)
		if err != nil {
			return nil, err
		}
		return []businessClaimPlan{plan}, nil
	}

	var accounts []models.EmailAccount
	query := tx.Preload("MailProvider").Preload("Tags").
		Where("org_id = ?", orgID).
		Where("is_verified = ?", true).
		Where("error_status = ? OR error_status = ''", models.ErrorStatusNormal)

	if req.ProviderID != nil {
		query = query.Where("mail_provider_id = ?", *req.ProviderID)
	}
	if len(req.AuthTypes) > 0 {
		query = query.Where("auth_type IN ?", normalizeBusinessAuthTypes(req.AuthTypes))
	}
	if strings.TrimSpace(req.ProxyMode) != "" {
		query = query.Where("proxy_mode = ?", strings.TrimSpace(req.ProxyMode))
	}
	mode := normalizeBusinessEmailMode(req.EmailMode)
	domain := strings.ToLower(strings.TrimSpace(req.Domain))
	if shouldRequireBusinessDomainMail(mode, req) {
		query = query.Where("is_domain_mail = ?", true)
		if domain != "" {
			query = query.Where("LOWER(domain) = ?", domain)
		}
	} else if req.UseDomainMail != nil && !*req.UseDomainMail {
		query = query.Where("is_domain_mail = ?", false)
	}
	if mode == businessEmailModeAlias && normalizeBusinessAliasType(req.AliasType) == businessAliasTypeGmailPlus {
		query = query.Where("LOWER(email_address) LIKE ? OR LOWER(email_address) LIKE ?", "%@gmail.com", "%@googlemail.com")
	}
	if len(req.TagIDs) > 0 {
		tagMode := normalizeBusinessTagFilterMode(req.TagFilterMode)
		if tagMode == "and" {
			for _, tagID := range req.TagIDs {
				query = query.Where("id IN (?)", tx.Table("email_account_tags").Select("email_account_id").Where("tag_id = ?", tagID))
			}
		} else {
			query = query.Where("id IN (?)", tx.Table("email_account_tags").Select("email_account_id").Where("tag_id IN ?", req.TagIDs))
		}
	}

	if err := query.Order("last_sync_at ASC, id ASC").Limit(100).Find(&accounts).Error; err != nil {
		return nil, err
	}

	plans := make([]businessClaimPlan, 0, len(accounts))
	for _, account := range accounts {
		plan, err := deriveBusinessClaimPlan(account, module, req)
		if err == nil {
			plans = append(plans, plan)
		}
	}
	return plans, nil
}

func (h *APIHandler) resolveBusinessClaimAccount(tx *gorm.DB, orgID uint, req BusinessEmailClaimRequest) (models.EmailAccount, error) {
	var account models.EmailAccount
	if req.AccountID != nil {
		if err := tx.Preload("MailProvider").Preload("Tags").Where("id = ?", *req.AccountID).First(&account).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return account, fmt.Errorf("email account not found")
			}
			return account, err
		}
	} else {
		email := normalizeBusinessEmailAddress(req.EmailAddress)
		if email == "" {
			return account, fmt.Errorf("emailAddress is required")
		}
		resolved, err := h.EmailAccountRepo.GetByEmailOrAlias(email)
		if err != nil {
			return account, fmt.Errorf("email account not found")
		}
		if err := tx.Preload("MailProvider").Preload("Tags").Where("id = ?", resolved.ID).First(&account).Error; err != nil {
			return account, err
		}
	}
	if orgID > 0 && account.OrgID != orgID {
		return account, fmt.Errorf("access denied")
	}
	if strings.TrimSpace(req.EmailAddress) != "" && req.AccountID != nil {
		email := normalizeBusinessEmailAddress(req.EmailAddress)
		resolved, err := h.EmailAccountRepo.GetByEmailOrAlias(email)
		if err != nil || resolved.ID != account.ID {
			return account, fmt.Errorf("emailAddress does not resolve to the specified account")
		}
	}
	return account, nil
}

func (h *APIHandler) validateBusinessClaimAccount(tx *gorm.DB, account models.EmailAccount, req BusinessEmailClaimRequest) error {
	if !account.IsVerified {
		return fmt.Errorf("email account is not verified")
	}
	if account.ErrorStatus != "" && account.ErrorStatus != string(models.ErrorStatusNormal) {
		return fmt.Errorf("email account error status is %s", account.ErrorStatus)
	}
	if req.ProviderID != nil {
		if account.MailProviderID == nil || *account.MailProviderID != *req.ProviderID {
			return fmt.Errorf("email account provider does not match")
		}
	}
	if len(req.AuthTypes) > 0 && !stringInSlice(string(account.AuthType), normalizeBusinessAuthTypes(req.AuthTypes)) {
		return fmt.Errorf("email account auth type does not match")
	}
	if strings.TrimSpace(req.ProxyMode) != "" && string(account.ProxyMode) != strings.TrimSpace(req.ProxyMode) {
		return fmt.Errorf("email account proxy mode does not match")
	}
	if len(req.TagIDs) > 0 {
		ok, err := businessAccountHasTags(tx, account.ID, req.TagIDs, normalizeBusinessTagFilterMode(req.TagFilterMode))
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("email account tags do not match")
		}
	}
	mode := normalizeBusinessEmailMode(req.EmailMode)
	if shouldRequireBusinessDomainMail(mode, req) {
		if !account.IsDomainMail {
			return fmt.Errorf("email account is not a domain mailbox")
		}
		if req.Domain != "" && !strings.EqualFold(account.Domain, strings.TrimSpace(req.Domain)) {
			return fmt.Errorf("email account domain does not match")
		}
	}
	if req.UseDomainMail != nil && !*req.UseDomainMail && account.IsDomainMail {
		return fmt.Errorf("domain mailbox is not allowed")
	}
	return nil
}

func deriveBusinessClaimPlan(account models.EmailAccount, module *models.BusinessModule, req BusinessEmailClaimRequest) (businessClaimPlan, error) {
	if strings.TrimSpace(req.EmailAddress) != "" {
		registrationEmail := normalizeBusinessEmailAddress(req.EmailAddress)
		if registrationEmail == "" {
			return businessClaimPlan{}, fmt.Errorf("invalid emailAddress")
		}
		recipient := describeBusinessRecipient(account, registrationEmail)
		return businessClaimPlan{account: account, registrationEmail: registrationEmail, recipient: recipient}, nil
	}

	mode := normalizeBusinessEmailMode(req.EmailMode)
	if mode == businessEmailModeAuto {
		if req.UseAlias {
			mode = businessEmailModeAlias
		} else if shouldRequireBusinessDomainMail(mode, req) {
			mode = businessEmailModeDomain
		} else {
			mode = businessEmailModePrimary
		}
	}

	localPart := strings.TrimSpace(req.AliasLocalPart)
	if localPart == "" {
		localPart = generateBusinessAliasLocalPart(module.Name)
	}

	switch mode {
	case businessEmailModePrimary:
		email := normalizeBusinessEmailAddress(account.EmailAddress)
		return businessClaimPlan{account: account, registrationEmail: email, recipient: describeBusinessRecipient(account, email)}, nil
	case businessEmailModeDomain:
		return buildBusinessDomainRecipientPlan(account, localPart, req.Domain)
	case businessEmailModeAlias:
		aliasType := normalizeBusinessAliasType(req.AliasType)
		if aliasType == "" {
			if isBusinessGmailAddress(account.EmailAddress) {
				aliasType = businessAliasTypeGmailPlus
			} else if account.IsDomainMail {
				aliasType = businessAliasTypeDomainPart
			}
		}
		switch aliasType {
		case businessAliasTypeGmailPlus:
			return buildBusinessGmailPlusPlan(account, localPart)
		case businessAliasTypeDomainPart:
			return buildBusinessDomainRecipientPlan(account, localPart, req.Domain)
		case businessAliasTypeForwarded:
			return buildBusinessForwardedRecipientPlan(account, localPart, req.Domain)
		default:
			return businessClaimPlan{}, fmt.Errorf("unsupported aliasType")
		}
	case businessEmailModeForwarded:
		return buildBusinessForwardedRecipientPlan(account, localPart, req.Domain)
	default:
		return businessClaimPlan{}, fmt.Errorf("unsupported emailMode")
	}
}

func buildBusinessGmailPlusPlan(account models.EmailAccount, alias string) (businessClaimPlan, error) {
	email := normalizeBusinessEmailAddress(account.EmailAddress)
	if !isBusinessGmailAddress(email) {
		return businessClaimPlan{}, fmt.Errorf("gmail_plus alias requires a Gmail account")
	}
	local, domain, ok := splitBusinessEmail(email)
	if !ok {
		return businessClaimPlan{}, fmt.Errorf("invalid email account address")
	}
	registrationEmail := local + "+" + sanitizeBusinessLocalPart(alias) + "@" + domain
	recipient := BusinessClaimRecipient{
		EmailAddress: registrationEmail,
		Kind:         "gmail_plus",
		ToQuery:      registrationEmail,
		ResolvedBy:   "gmail_plus",
		Domain:       domain,
		LocalPart:    local + "+" + sanitizeBusinessLocalPart(alias),
	}
	return businessClaimPlan{account: account, registrationEmail: registrationEmail, recipient: recipient}, nil
}

func buildBusinessDomainRecipientPlan(account models.EmailAccount, localPart string, requestedDomain string) (businessClaimPlan, error) {
	if !account.IsDomainMail || strings.TrimSpace(account.Domain) == "" {
		return businessClaimPlan{}, fmt.Errorf("domain mailbox is required")
	}
	domain := strings.ToLower(strings.TrimSpace(account.Domain))
	if strings.TrimSpace(requestedDomain) != "" {
		requested := strings.ToLower(strings.TrimSpace(requestedDomain))
		if requested != domain {
			return businessClaimPlan{}, fmt.Errorf("email account domain does not match")
		}
	}
	local := sanitizeBusinessLocalPart(localPart)
	registrationEmail := local + "@" + domain
	recipient := BusinessClaimRecipient{
		EmailAddress: registrationEmail,
		Kind:         "domain_alias",
		ToQuery:      registrationEmail,
		ResolvedBy:   "domain",
		Domain:       domain,
		LocalPart:    local,
	}
	return businessClaimPlan{account: account, registrationEmail: registrationEmail, recipient: recipient}, nil
}

func buildBusinessForwardedRecipientPlan(account models.EmailAccount, localPart string, requestedDomain string) (businessClaimPlan, error) {
	for _, forwarded := range account.ForwardedAddresses {
		value := normalizeBusinessEmailAddress(forwarded)
		if value == "" {
			continue
		}
		if strings.HasPrefix(value, "*@") {
			domain := strings.TrimPrefix(value, "*@")
			if requestedDomain != "" && !strings.EqualFold(domain, strings.TrimSpace(requestedDomain)) {
				continue
			}
			local := sanitizeBusinessLocalPart(localPart)
			email := local + "@" + domain
			return businessClaimPlan{account: account, registrationEmail: email, recipient: BusinessClaimRecipient{
				EmailAddress: email,
				Kind:         "forwarded_alias",
				ToQuery:      email,
				ResolvedBy:   "forwarded",
				Domain:       domain,
				LocalPart:    local,
			}}, nil
		}
		if requestedDomain != "" {
			_, domain, ok := splitBusinessEmail(value)
			if !ok || !strings.EqualFold(domain, strings.TrimSpace(requestedDomain)) {
				continue
			}
		}
		return businessClaimPlan{account: account, registrationEmail: value, recipient: describeBusinessRecipient(account, value)}, nil
	}
	return businessClaimPlan{}, fmt.Errorf("email account has no forwarded address")
}

func describeBusinessRecipient(account models.EmailAccount, registrationEmail string) BusinessClaimRecipient {
	local, domain, _ := splitBusinessEmail(registrationEmail)
	kind := "primary"
	resolvedBy := "email"
	if !strings.EqualFold(registrationEmail, account.EmailAddress) {
		switch {
		case isBusinessGmailAddress(account.EmailAddress) && isBusinessGmailPlusAlias(account.EmailAddress, registrationEmail):
			kind = "gmail_plus"
			resolvedBy = "gmail_plus"
		case account.IsDomainMail && strings.EqualFold(domain, account.Domain):
			kind = "domain_alias"
			resolvedBy = "domain"
		case businessForwardedAddressMatches(account.ForwardedAddresses, registrationEmail):
			kind = "forwarded_alias"
			resolvedBy = "forwarded"
		default:
			kind = "alias"
			resolvedBy = "alias"
		}
	}
	return BusinessClaimRecipient{
		EmailAddress: registrationEmail,
		Kind:         kind,
		ToQuery:      registrationEmail,
		ResolvedBy:   resolvedBy,
		Domain:       domain,
		LocalPart:    local,
	}
}

func buildBusinessClaimResponse(module *models.BusinessModule, account *models.BusinessAccount, plan businessClaimPlan, token string, expiresAt time.Time, ttl int) *BusinessEmailClaimResponse {
	return &BusinessEmailClaimResponse{
		BusinessAccountID: account.ID,
		ClaimToken:        token,
		ClaimExpiresAt:    expiresAt,
		TTLSeconds:        ttl,
		Module: BusinessClaimModuleSummary{
			ID:   module.ID,
			Name: module.Name,
		},
		EmailAccount: BusinessClaimEmailSummary{
			ID:             plan.account.ID,
			EmailAddress:   plan.account.EmailAddress,
			AuthType:       plan.account.AuthType,
			IsDomainMail:   plan.account.IsDomainMail,
			Domain:         plan.account.Domain,
			MailProviderID: plan.account.MailProviderID,
			ProxyMode:      plan.account.ProxyMode,
			ProxyID:        plan.account.ProxyID,
			IsVerified:     plan.account.IsVerified,
			ErrorStatus:    plan.account.ErrorStatus,
		},
		Recipient: plan.recipient,
		Pickup: BusinessClaimPickupParams{
			AccountID: plan.account.ID,
			ToQuery:   plan.recipient.ToQuery,
		},
		BusinessAccount: BusinessClaimAccountSummary{
			ID:                account.ID,
			Status:            account.Status,
			EmailAccountID:    account.EmailAccountID,
			ModuleID:          account.ModuleID,
			RegistrationEmail: account.RegistrationEmail,
		},
	}
}

func applyBusinessCompletion(account *models.BusinessAccount, req CompleteRegistrationRequest, now time.Time) {
	if req.Username != nil {
		account.Username = strings.TrimSpace(*req.Username)
	}
	if req.Password != nil {
		account.Password = *req.Password
	}
	if req.TOTPSecret != nil {
		account.TOTPSecret = *req.TOTPSecret
	}
	if req.PhoneNumber != nil {
		account.PhoneNumber = strings.TrimSpace(*req.PhoneNumber)
	}
	if req.RecoveryEmail != nil {
		account.RecoveryEmail = strings.TrimSpace(*req.RecoveryEmail)
	}
	if req.RecoveryCodes != nil {
		account.RecoveryCodes = normalizeBusinessStringSlice(req.RecoveryCodes)
	}
	if req.Status != "" {
		account.Status = models.NormalizeBusinessAccountStatus(req.Status)
	} else {
		account.Status = models.BusinessAccountStatusActive
	}
	if req.Description != nil {
		account.Description = strings.TrimSpace(*req.Description)
	}
	if req.Note != nil {
		account.Note = *req.Note
	}
	if req.NoteFormat != "" {
		account.NoteFormat = models.NormalizeAccountNoteFormat(req.NoteFormat)
	}
	if req.Tags != nil {
		account.Tags = normalizeBusinessStringSlice(req.Tags)
	}
	if req.CustomFields != nil {
		account.CustomFields = mergeBusinessJSONMap(account.CustomFields, req.CustomFields)
	}
	if req.ExtraData != nil {
		account.ExtraData = mergeBusinessJSONMap(account.ExtraData, req.ExtraData)
	}
	if req.RemoteCreatedAt != nil {
		account.RemoteCreatedAt = req.RemoteCreatedAt
	}
	if req.LastLoginAt != nil {
		account.LastLoginAt = req.LastLoginAt
	}
	account.ClaimExpiresAt = nil
	account.ExtraData = mergeBusinessJSONMap(account.ExtraData, models.JSONMapInterface{
		"registrationState": "completed",
		"registeredAt":      now.Format(time.RFC3339),
	})
}

func clearExpiredBusinessRegistrationClaims(tx *gorm.DB, orgID uint, moduleID uint, now time.Time) error {
	query := tx.Model(&models.BusinessAccount{}).
		Where("module_id = ?", moduleID).
		Where("status = ?", models.BusinessAccountStatusPending).
		Where("claim_expires_at IS NOT NULL AND claim_expires_at < ?", now).
		Where("registration_email IS NOT NULL")
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	return query.Updates(map[string]interface{}{
		"registration_email": nil,
		"claim_expires_at":   nil,
		"claimed_by":         "",
		"status":             models.BusinessAccountStatusArchived,
	}).Error
}

func businessRegistrationEmailAvailable(tx *gorm.DB, orgID uint, moduleID uint, registrationEmail string) (bool, error) {
	var count int64
	query := tx.Model(&models.BusinessAccount{}).
		Where("module_id = ?", moduleID).
		Where("LOWER(registration_email) = ?", strings.ToLower(registrationEmail))
	if orgID > 0 {
		query = query.Where("org_id = ?", orgID)
	}
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count == 0, nil
}

func businessAccountHasTags(tx *gorm.DB, accountID uint, tagIDs []uint, mode string) (bool, error) {
	if len(tagIDs) == 0 {
		return true, nil
	}
	if mode == "and" {
		var count int64
		err := tx.Table("email_account_tags").
			Where("email_account_id = ? AND tag_id IN ?", accountID, tagIDs).
			Distinct("tag_id").
			Count(&count).Error
		return int(count) == len(tagIDs), err
	}
	var count int64
	err := tx.Table("email_account_tags").
		Where("email_account_id = ? AND tag_id IN ?", accountID, tagIDs).
		Count(&count).Error
	return count > 0, err
}

func validateBusinessClaimToken(account *models.BusinessAccount, token string) error {
	if strings.TrimSpace(token) == "" {
		return fmt.Errorf("claimToken is required")
	}
	if account.ClaimToken == "" || account.ClaimToken != strings.TrimSpace(token) {
		return fmt.Errorf("invalid claimToken")
	}
	return nil
}

func normalizeBusinessClaimTTL(value int) int {
	if value <= 0 {
		return defaultBusinessClaimTTLSeconds
	}
	if value < minBusinessClaimTTLSeconds {
		return minBusinessClaimTTLSeconds
	}
	if value > maxBusinessClaimTTLSeconds {
		return maxBusinessClaimTTLSeconds
	}
	return value
}

func normalizeBusinessEmailMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case businessEmailModePrimary, businessEmailModeDomain, businessEmailModeAlias, businessEmailModeForwarded:
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return businessEmailModeAuto
	}
}

func normalizeBusinessAliasType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case businessAliasTypeGmailPlus, businessAliasTypeDomainPart, businessAliasTypeForwarded:
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func normalizeBusinessTagFilterMode(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == "and" {
		return "and"
	}
	return "or"
}

func shouldRequireBusinessDomainMail(mode string, req BusinessEmailClaimRequest) bool {
	if mode == businessEmailModeDomain {
		return true
	}
	if strings.TrimSpace(req.Domain) != "" {
		return true
	}
	return req.UseDomainMail != nil && *req.UseDomainMail
}

func normalizeBusinessAuthTypes(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.ToLower(strings.TrimSpace(value))
		if trimmed == "" {
			continue
		}
		result = append(result, trimmed)
	}
	return result
}

func normalizeBusinessEmailAddress(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	if trimmed == "" {
		return ""
	}
	if _, err := mail.ParseAddress(trimmed); err != nil {
		if !strings.Contains(trimmed, "@") {
			return ""
		}
	}
	return trimmed
}

func splitBusinessEmail(value string) (string, string, bool) {
	email := normalizeBusinessEmailAddress(value)
	at := strings.LastIndex(email, "@")
	if at <= 0 || at >= len(email)-1 {
		return "", "", false
	}
	return email[:at], email[at+1:], true
}

func isBusinessGmailAddress(value string) bool {
	_, domain, ok := splitBusinessEmail(value)
	return ok && (domain == "gmail.com" || domain == "googlemail.com")
}

func isBusinessGmailPlusAlias(base string, alias string) bool {
	baseLocal, baseDomain, ok := splitBusinessEmail(base)
	if !ok {
		return false
	}
	aliasLocal, aliasDomain, ok := splitBusinessEmail(alias)
	if !ok || aliasDomain != baseDomain {
		return false
	}
	return strings.HasPrefix(aliasLocal, baseLocal+"+")
}

func businessForwardedAddressMatches(values []string, email string) bool {
	target := normalizeBusinessEmailAddress(email)
	for _, value := range values {
		forwarded := normalizeBusinessEmailAddress(value)
		if forwarded == "" {
			continue
		}
		if forwarded == target {
			return true
		}
		if strings.HasPrefix(forwarded, "*@") {
			_, domain, ok := splitBusinessEmail(target)
			if ok && strings.TrimPrefix(forwarded, "*@") == domain {
				return true
			}
		}
	}
	return false
}

func sanitizeBusinessLocalPart(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		}
	}
	result := strings.Trim(b.String(), ".-_")
	if result == "" {
		result = randomBusinessHex(4)
	}
	if len(result) > 48 {
		result = result[:48]
	}
	return result
}

func generateBusinessAliasLocalPart(moduleName string) string {
	prefix := sanitizeBusinessLocalPart(moduleName)
	if prefix == "" {
		prefix = "register"
	}
	return prefix + "-" + randomBusinessHex(4)
}

func generateBusinessClaimToken() (string, error) {
	bytes := make([]byte, 18)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "claim_" + hex.EncodeToString(bytes), nil
}

func randomBusinessHex(size int) string {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes)
}

func safeBusinessJSONMap(value models.JSONMapInterface) models.JSONMapInterface {
	if value == nil {
		return models.JSONMapInterface{}
	}
	return value
}

func mergeBusinessJSONMap(base models.JSONMapInterface, overlay models.JSONMapInterface) models.JSONMapInterface {
	result := safeBusinessJSONMap(base)
	for key, value := range overlay {
		if strings.TrimSpace(key) == "" {
			continue
		}
		result[key] = value
	}
	return result
}

func stringInSlice(value string, values []string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func isBusinessUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "unique") || strings.Contains(text, "duplicate") || strings.Contains(text, "constraint")
}
