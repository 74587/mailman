package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"mailman/internal/models"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"gorm.io/gorm"
)

type BusinessModuleRequest struct {
	Name             string                  `json:"name"`
	Website          string                  `json:"website,omitempty"`
	LoginURL         string                  `json:"loginUrl,omitempty"`
	Description      string                  `json:"description,omitempty"`
	Icon             string                  `json:"icon,omitempty"`
	Logo             string                  `json:"logo,omitempty"`
	Color            string                  `json:"color,omitempty"`
	FieldSchema      models.JSONMapInterface `json:"fieldSchema,omitempty" swaggertype:"object"`
	StatusOptions    models.JSONMapInterface `json:"statusOptions,omitempty" swaggertype:"object"`
	ClaimDefaults    models.JSONMapInterface `json:"claimDefaults,omitempty" swaggertype:"object"`
	EmailConstraints models.JSONMapInterface `json:"emailConstraints,omitempty" swaggertype:"object"`
	Constraints      models.JSONMapInterface `json:"constraints,omitempty" swaggertype:"object"`
	SortOrder        int                     `json:"sortOrder,omitempty"`
}

type BusinessAccountRequest struct {
	EmailAccountID  *uint                        `json:"emailAccountId,omitempty"`
	ModuleID        *uint                        `json:"moduleId,omitempty"`
	ModuleName      string                       `json:"moduleName,omitempty"`
	DisplayName     string                       `json:"displayName,omitempty"`
	Website         string                       `json:"website,omitempty"`
	LoginURL        string                       `json:"loginUrl,omitempty"`
	Username        string                       `json:"username,omitempty"`
	Password        string                       `json:"password,omitempty"`
	TOTPSecret      string                       `json:"totpSecret,omitempty"`
	PhoneNumber     string                       `json:"phoneNumber,omitempty"`
	RecoveryEmail   string                       `json:"recoveryEmail,omitempty"`
	RecoveryCodes   models.StringSlice           `json:"recoveryCodes,omitempty"`
	Status          models.BusinessAccountStatus `json:"status,omitempty"`
	Description     string                       `json:"description,omitempty"`
	Note            string                       `json:"note,omitempty"`
	NoteFormat      models.AccountNoteFormat     `json:"noteFormat,omitempty"`
	Tags            models.StringSlice           `json:"tags,omitempty"`
	CustomFields    models.JSONMapInterface      `json:"customFields,omitempty" swaggertype:"object"`
	ExtraData       models.JSONMapInterface      `json:"extraData,omitempty" swaggertype:"object"`
	RemoteCreatedAt *time.Time                   `json:"remoteCreatedAt,omitempty"`
	LastLoginAt     *time.Time                   `json:"lastLoginAt,omitempty"`
}

type BusinessAccountsListResponse struct {
	Data       []models.BusinessAccount `json:"data"`
	Total      int64                    `json:"total"`
	Page       int                      `json:"page"`
	Limit      int                      `json:"limit"`
	TotalPages int                      `json:"totalPages"`
}

type BusinessModulesListResponse struct {
	Data       []models.BusinessModule `json:"data"`
	Total      int64                   `json:"total"`
	Page       int                     `json:"page"`
	Limit      int                     `json:"limit"`
	TotalPages int                     `json:"totalPages"`
}

// ListBusinessModulesHandler lists business modules.
// @Summary List business modules
// @Tags business
// @Produce json
// @Success 200 {object} BusinessModulesListResponse
// @Router /api/business-modules [get]
func (h *APIHandler) ListBusinessModulesHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	pageQuery := strings.TrimSpace(r.URL.Query().Get("page"))
	limitQuery := strings.TrimSpace(r.URL.Query().Get("limit"))
	usePagination := pageQuery != "" || limitQuery != ""
	page := parsePositiveBusinessQueryInt(r, "page", 1)
	limit := parsePositiveBusinessQueryInt(r, "limit", 50)
	if limit > 200 {
		limit = 200
	}

	db := h.EmailAccountRepo.GetDB().Model(&models.BusinessModule{})
	if orgID > 0 {
		db = db.Where("org_id = ?", orgID)
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	if search != "" {
		like := "%" + search + "%"
		db = db.Where("name LIKE ? OR website LIKE ? OR login_url LIKE ? OR description LIKE ?", like, like, like, like)
	}

	var modules []models.BusinessModule
	if !usePagination {
		if err := db.Order("sort_order ASC, name ASC").Find(&modules).Error; err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeBusinessJSON(w, http.StatusOK, modules)
		return
	}

	var total int64
	if err := db.Count(&total).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := db.Order("sort_order ASC, name ASC").
		Offset((page - 1) * limit).
		Limit(limit).
		Find(&modules).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusOK, BusinessModulesListResponse{
		Data:       modules,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: int((total + int64(limit) - 1) / int64(limit)),
	})
}

// CreateBusinessModuleHandler creates a business module.
// @Summary Create business module
// @Tags business
// @Accept json
// @Produce json
// @Param request body BusinessModuleRequest true "Business module"
// @Success 201 {object} models.BusinessModule
// @Router /api/business-modules [post]
func (h *APIHandler) CreateBusinessModuleHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var request BusinessModuleRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	module := buildBusinessModule(request, orgID)
	if module.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if err := h.EmailAccountRepo.GetDB().Create(&module).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusCreated, module)
}

// GetBusinessModuleHandler returns a business module.
// @Summary Get business module
// @Tags business
// @Produce json
// @Param id path int true "Module ID"
// @Success 200 {object} models.BusinessModule
// @Router /api/business-modules/{id} [get]
func (h *APIHandler) GetBusinessModuleHandler(w http.ResponseWriter, r *http.Request) {
	module, ok := h.getBusinessModuleForRequest(w, r)
	if !ok {
		return
	}
	writeBusinessJSON(w, http.StatusOK, module)
}

// UpdateBusinessModuleHandler updates a business module.
// @Summary Update business module
// @Tags business
// @Accept json
// @Produce json
// @Param id path int true "Module ID"
// @Param request body BusinessModuleRequest true "Business module"
// @Success 200 {object} models.BusinessModule
// @Router /api/business-modules/{id} [put]
func (h *APIHandler) UpdateBusinessModuleHandler(w http.ResponseWriter, r *http.Request) {
	module, ok := h.getBusinessModuleForRequest(w, r)
	if !ok {
		return
	}
	var request BusinessModuleRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	updated := buildBusinessModule(request, module.OrgID)
	updated.ID = module.ID
	updated.CreatedAt = module.CreatedAt
	if request.ClaimDefaults == nil {
		updated.ClaimDefaults = module.ClaimDefaults
	}
	if request.EmailConstraints == nil && request.Constraints == nil {
		updated.EmailConstraints = module.EmailConstraints
	}
	if updated.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if err := h.EmailAccountRepo.GetDB().Save(&updated).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusOK, updated)
}

// DeleteBusinessModuleHandler deletes a business module.
// @Summary Delete business module
// @Tags business
// @Param id path int true "Module ID"
// @Success 204
// @Router /api/business-modules/{id} [delete]
func (h *APIHandler) DeleteBusinessModuleHandler(w http.ResponseWriter, r *http.Request) {
	module, ok := h.getBusinessModuleForRequest(w, r)
	if !ok {
		return
	}
	db := h.EmailAccountRepo.GetDB()
	if err := db.Model(&models.BusinessAccount{}).
		Where("module_id = ? AND org_id = ?", module.ID, module.OrgID).
		Update("module_id", nil).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := db.Delete(module).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListBusinessAccountsHandler lists business accounts.
// @Summary List business accounts
// @Tags business
// @Produce json
// @Param page query int false "Page number"
// @Param limit query int false "Page size"
// @Param search query string false "Fuzzy search keyword"
// @Param status query string false "Business account status"
// @Param moduleId query int false "Business module ID"
// @Param emailAccountId query int false "Email account ID"
// @Param emailLinked query bool false "Filter by whether the business account is linked to an email account"
// @Param registrationEmailSuffix query string false "Filter by registration email suffix"
// @Success 200 {object} BusinessAccountsListResponse
// @Router /api/business-accounts [get]
func (h *APIHandler) ListBusinessAccountsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	page := parsePositiveBusinessQueryInt(r, "page", 1)
	limit := parsePositiveBusinessQueryInt(r, "limit", 50)
	if limit > 200 {
		limit = 200
	}

	db := h.businessAccountBaseQuery(orgID)
	if search := strings.TrimSpace(r.URL.Query().Get("search")); search != "" {
		like := "%" + search + "%"
		db = db.Joins("LEFT JOIN email_accounts ON email_accounts.id = business_accounts.email_account_id").Where(
			"business_accounts.display_name LIKE ? OR business_accounts.module_name LIKE ? OR business_accounts.username LIKE ? OR business_accounts.website LIKE ? OR business_accounts.description LIKE ? OR business_accounts.note LIKE ? OR business_accounts.phone_number LIKE ? OR email_accounts.email_address LIKE ?",
			like, like, like, like, like, like, like, like,
		)
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		db = db.Where("business_accounts.status = ?", status)
	}
	if id := parseOptionalBusinessUintQuery(r, "moduleId"); id != nil {
		db = db.Where("business_accounts.module_id = ?", *id)
	}
	if id := parseOptionalBusinessUintQuery(r, "emailAccountId"); id != nil {
		db = db.Where("business_accounts.email_account_id = ?", *id)
	}
	if linked := parseOptionalBusinessBoolQuery(r, "emailLinked"); linked != nil {
		if *linked {
			db = db.Where("business_accounts.email_account_id IS NOT NULL")
		} else {
			db = db.Where("business_accounts.email_account_id IS NULL")
		}
	}
	if suffix := normalizeEmailSuffix(r.URL.Query().Get("registrationEmailSuffix")); suffix != "" {
		db = db.Where("LOWER(business_accounts.registration_email) LIKE ?", "%"+suffix)
	}

	var total int64
	if err := db.Count(&total).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var accounts []models.BusinessAccount
	if err := db.Preload("EmailAccount").Preload("Module").
		Order("business_accounts.updated_at DESC").
		Offset((page - 1) * limit).
		Limit(limit).
		Find(&accounts).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeBusinessJSON(w, http.StatusOK, BusinessAccountsListResponse{
		Data:       accounts,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: int((total + int64(limit) - 1) / int64(limit)),
	})
}

// CreateBusinessAccountHandler creates a business account.
// @Summary Create business account
// @Tags business
// @Accept json
// @Produce json
// @Param request body BusinessAccountRequest true "Business account"
// @Success 201 {object} models.BusinessAccount
// @Router /api/business-accounts [post]
func (h *APIHandler) CreateBusinessAccountHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	var request BusinessAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	account, err := h.buildBusinessAccount(request, orgID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.EmailAccountRepo.GetDB().Create(&account).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.EmailAccountRepo.GetDB().Preload("EmailAccount").Preload("Module").First(&account, account.ID).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusCreated, account)
}

// GetBusinessAccountHandler returns a business account.
// @Summary Get business account
// @Tags business
// @Produce json
// @Param id path int true "Business Account ID"
// @Success 200 {object} models.BusinessAccount
// @Router /api/business-accounts/{id} [get]
func (h *APIHandler) GetBusinessAccountHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.getBusinessAccountForRequest(w, r)
	if !ok {
		return
	}
	writeBusinessJSON(w, http.StatusOK, account)
}

// UpdateBusinessAccountHandler updates a business account.
// @Summary Update business account
// @Tags business
// @Accept json
// @Produce json
// @Param id path int true "Business Account ID"
// @Param request body BusinessAccountRequest true "Business account"
// @Success 200 {object} models.BusinessAccount
// @Router /api/business-accounts/{id} [put]
func (h *APIHandler) UpdateBusinessAccountHandler(w http.ResponseWriter, r *http.Request) {
	existing, ok := h.getBusinessAccountForRequest(w, r)
	if !ok {
		return
	}
	var request BusinessAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	account, err := h.buildBusinessAccount(request, existing.OrgID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	account.ID = existing.ID
	account.CreatedAt = existing.CreatedAt
	account.RegistrationEmail = existing.RegistrationEmail
	account.ClaimToken = existing.ClaimToken
	account.ClaimExpiresAt = existing.ClaimExpiresAt
	account.ClaimedBy = existing.ClaimedBy
	if err := h.EmailAccountRepo.GetDB().Save(&account).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.EmailAccountRepo.GetDB().Preload("EmailAccount").Preload("Module").First(&account, account.ID).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusOK, account)
}

// DeleteBusinessAccountHandler deletes a business account.
// @Summary Delete business account
// @Tags business
// @Param id path int true "Business Account ID"
// @Success 204
// @Router /api/business-accounts/{id} [delete]
func (h *APIHandler) DeleteBusinessAccountHandler(w http.ResponseWriter, r *http.Request) {
	account, ok := h.getBusinessAccountForRequest(w, r)
	if !ok {
		return
	}
	db := h.EmailAccountRepo.GetDB()
	if account.RegistrationEmail != nil || account.ClaimExpiresAt != nil || account.ClaimedBy != "" {
		if err := db.Model(account).Updates(map[string]interface{}{
			"registration_email": nil,
			"claim_expires_at":   nil,
			"claimed_by":         "",
		}).Error; err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	if err := db.Delete(account).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListEmailAccountBusinessAccountsHandler lists business accounts linked to an email account.
// @Summary List business accounts by email account
// @Tags business
// @Produce json
// @Param id path int true "Email Account ID"
// @Success 200 {array} models.BusinessAccount
// @Router /api/accounts/{id}/business-accounts [get]
func (h *APIHandler) ListEmailAccountBusinessAccountsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)
	accountID, err := uintIDFromBusinessMux(r, "id")
	if err != nil {
		http.Error(w, "Invalid account ID", http.StatusBadRequest)
		return
	}
	if err := h.ensureEmailAccountScope(accountID, orgID); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	var accounts []models.BusinessAccount
	if err := h.businessAccountBaseQuery(orgID).
		Where("business_accounts.email_account_id = ?", accountID).
		Preload("EmailAccount").Preload("Module").
		Order("business_accounts.updated_at DESC").
		Find(&accounts).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusOK, accounts)
}

func buildBusinessModule(request BusinessModuleRequest, orgID uint) models.BusinessModule {
	emailConstraints := request.EmailConstraints
	if len(emailConstraints) == 0 && len(request.Constraints) > 0 {
		emailConstraints = request.Constraints
	}
	return models.BusinessModule{
		OrgID:            orgID,
		Name:             strings.TrimSpace(request.Name),
		Website:          strings.TrimSpace(request.Website),
		LoginURL:         strings.TrimSpace(request.LoginURL),
		Description:      strings.TrimSpace(request.Description),
		Icon:             strings.TrimSpace(request.Icon),
		Logo:             strings.TrimSpace(request.Logo),
		Color:            strings.TrimSpace(request.Color),
		FieldSchema:      safeBusinessJSONMap(request.FieldSchema),
		StatusOptions:    safeBusinessJSONMap(request.StatusOptions),
		ClaimDefaults:    safeBusinessJSONMap(request.ClaimDefaults),
		EmailConstraints: safeBusinessJSONMap(emailConstraints),
		SortOrder:        request.SortOrder,
	}
}

func (h *APIHandler) buildBusinessAccount(request BusinessAccountRequest, orgID uint) (models.BusinessAccount, error) {
	if request.EmailAccountID != nil {
		if err := h.ensureEmailAccountScope(*request.EmailAccountID, orgID); err != nil {
			return models.BusinessAccount{}, err
		}
	}
	if request.ModuleID != nil {
		module := models.BusinessModule{}
		db := h.EmailAccountRepo.GetDB().Where("id = ?", *request.ModuleID)
		if orgID > 0 {
			db = db.Where("org_id = ?", orgID)
		}
		if err := db.First(&module).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return models.BusinessAccount{}, fmt.Errorf("business module not found")
			}
			return models.BusinessAccount{}, err
		}
		if request.ModuleName == "" {
			request.ModuleName = module.Name
		}
		if request.Website == "" {
			request.Website = module.Website
		}
		if request.LoginURL == "" {
			request.LoginURL = module.LoginURL
		}
	}
	if request.ModuleName == "" && request.ModuleID == nil {
		return models.BusinessAccount{}, fmt.Errorf("moduleName or moduleId is required")
	}
	if request.DisplayName == "" {
		request.DisplayName = request.ModuleName
	}
	if request.CustomFields == nil {
		request.CustomFields = models.JSONMapInterface{}
	}
	if request.ExtraData == nil {
		request.ExtraData = models.JSONMapInterface{}
	}
	return models.BusinessAccount{
		OrgID:           orgID,
		EmailAccountID:  request.EmailAccountID,
		ModuleID:        request.ModuleID,
		ModuleName:      strings.TrimSpace(request.ModuleName),
		DisplayName:     strings.TrimSpace(request.DisplayName),
		Website:         strings.TrimSpace(request.Website),
		LoginURL:        strings.TrimSpace(request.LoginURL),
		Username:        strings.TrimSpace(request.Username),
		Password:        request.Password,
		TOTPSecret:      request.TOTPSecret,
		PhoneNumber:     strings.TrimSpace(request.PhoneNumber),
		RecoveryEmail:   strings.TrimSpace(request.RecoveryEmail),
		RecoveryCodes:   normalizeBusinessStringSlice(request.RecoveryCodes),
		Status:          models.NormalizeBusinessAccountStatus(request.Status),
		Description:     strings.TrimSpace(request.Description),
		Note:            request.Note,
		NoteFormat:      models.NormalizeAccountNoteFormat(request.NoteFormat),
		Tags:            normalizeBusinessStringSlice(request.Tags),
		CustomFields:    request.CustomFields,
		ExtraData:       request.ExtraData,
		RemoteCreatedAt: request.RemoteCreatedAt,
		LastLoginAt:     request.LastLoginAt,
	}, nil
}

func (h *APIHandler) businessAccountBaseQuery(orgID uint) *gorm.DB {
	db := h.EmailAccountRepo.GetDB().Model(&models.BusinessAccount{})
	if orgID > 0 {
		db = db.Where("business_accounts.org_id = ?", orgID)
	}
	return db
}

func (h *APIHandler) getBusinessModuleForRequest(w http.ResponseWriter, r *http.Request) (*models.BusinessModule, bool) {
	orgID := GetCurrentOrgID(r)
	id, err := uintIDFromBusinessMux(r, "id")
	if err != nil {
		http.Error(w, "Invalid module ID", http.StatusBadRequest)
		return nil, false
	}
	var module models.BusinessModule
	db := h.EmailAccountRepo.GetDB().Where("id = ?", id)
	if orgID > 0 {
		db = db.Where("org_id = ?", orgID)
	}
	if err := db.First(&module).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			http.Error(w, "Business module not found", http.StatusNotFound)
			return nil, false
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil, false
	}
	return &module, true
}

func (h *APIHandler) getBusinessAccountForRequest(w http.ResponseWriter, r *http.Request) (*models.BusinessAccount, bool) {
	orgID := GetCurrentOrgID(r)
	id, err := uintIDFromBusinessMux(r, "id")
	if err != nil {
		http.Error(w, "Invalid business account ID", http.StatusBadRequest)
		return nil, false
	}
	var account models.BusinessAccount
	db := h.EmailAccountRepo.GetDB().Preload("EmailAccount").Preload("Module").Where("business_accounts.id = ?", id)
	if orgID > 0 {
		db = db.Where("business_accounts.org_id = ?", orgID)
	}
	if err := db.First(&account).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			http.Error(w, "Business account not found", http.StatusNotFound)
			return nil, false
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil, false
	}
	return &account, true
}

func (h *APIHandler) ensureEmailAccountScope(accountID uint, orgID uint) error {
	account, err := h.EmailAccountRepo.GetByID(accountID)
	if err != nil {
		return fmt.Errorf("email account not found")
	}
	if orgID > 0 && account.OrgID != orgID {
		return fmt.Errorf("access denied")
	}
	return nil
}

func uintIDFromBusinessMux(r *http.Request, key string) (uint, error) {
	value, err := strconv.ParseUint(mux.Vars(r)[key], 10, 32)
	return uint(value), err
}

func parsePositiveBusinessQueryInt(r *http.Request, key string, fallback int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func parseOptionalBusinessUintQuery(r *http.Request, key string) *uint {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseUint(raw, 10, 32)
	if err != nil || value == 0 {
		return nil
	}
	id := uint(value)
	return &id
}

func parseOptionalBusinessBoolQuery(r *http.Request, key string) *bool {
	raw := strings.ToLower(strings.TrimSpace(r.URL.Query().Get(key)))
	if raw == "" {
		return nil
	}

	value := false
	switch raw {
	case "1", "true", "yes", "y", "linked", "with", "bound":
		value = true
	case "0", "false", "no", "n", "unlinked", "without", "unbound":
		value = false
	default:
		return nil
	}
	return &value
}

func normalizeBusinessStringSlice(values []string) models.StringSlice {
	seen := map[string]bool{}
	result := models.StringSlice{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		result = append(result, trimmed)
	}
	return result
}

func writeBusinessJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}
