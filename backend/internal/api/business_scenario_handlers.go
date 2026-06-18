package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/services"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	"gorm.io/gorm"
)

type BusinessScenarioRequest struct {
	Key             string                  `json:"key,omitempty"`
	Name            string                  `json:"name"`
	Description     string                  `json:"description,omitempty"`
	Enabled         *bool                   `json:"enabled,omitempty"`
	PickupConfig    models.JSONMapInterface `json:"pickupConfig,omitempty" swaggertype:"object"`
	ExtractorConfig models.JSONMapInterface `json:"extractorConfig,omitempty" swaggertype:"object"`
	SortOrder       int                     `json:"sortOrder,omitempty"`
}

type BusinessScenarioPickupRequest struct {
	ClaimToken string `json:"claimToken,omitempty"`

	KeepAliveSeconds      int    `json:"keep_alive_seconds,omitempty"`
	KeepAliveSecondsCamel int    `json:"keepAliveSeconds,omitempty"`
	SyncInterval          int    `json:"sync_interval,omitempty"`
	SyncIntervalCamel     int    `json:"syncInterval,omitempty"`
	Limit                 int    `json:"limit,omitempty"`
	Since                 string `json:"since,omitempty"`
	ToQuery               string `json:"to_query,omitempty"`
	ToQueryCamel          string `json:"toQuery,omitempty"`

	TemplateID         *uint                         `json:"template_id,omitempty"`
	TemplateIDCamel    *uint                         `json:"templateId,omitempty"`
	InlineActions      *services.InlineActionsConfig `json:"inline_actions,omitempty"`
	InlineActionsCamel *services.InlineActionsConfig `json:"inlineActions,omitempty"`
	SimpleExtract      *services.SimpleExtractConfig `json:"simple_extract,omitempty"`
	SimpleExtractCamel *services.SimpleExtractConfig `json:"simpleExtract,omitempty"`
}

type BusinessScenarioPickupResponse struct {
	BusinessAccount BusinessClaimAccountSummary  `json:"businessAccount"`
	Scenario        models.BusinessScenario      `json:"scenario"`
	Pickup          *services.PickupPollResponse `json:"pickup"`
}

func (h *APIHandler) ListBusinessScenariosHandler(w http.ResponseWriter, r *http.Request) {
	module, ok := h.getBusinessModuleForRequest(w, r)
	if !ok {
		return
	}
	var scenarios []models.BusinessScenario
	if err := h.EmailAccountRepo.GetDB().
		Where("org_id = ? AND module_id = ?", module.OrgID, module.ID).
		Order("sort_order ASC, key ASC").
		Find(&scenarios).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusOK, scenarios)
}

func (h *APIHandler) CreateBusinessScenarioHandler(w http.ResponseWriter, r *http.Request) {
	module, ok := h.getBusinessModuleForRequest(w, r)
	if !ok {
		return
	}
	var req BusinessScenarioRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	scenario, err := buildBusinessScenario(module, req, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.EmailAccountRepo.GetDB().Create(&scenario).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusCreated, scenario)
}

func (h *APIHandler) GetBusinessScenarioHandler(w http.ResponseWriter, r *http.Request) {
	scenario, ok := h.getBusinessScenarioForRequest(w, r)
	if !ok {
		return
	}
	writeBusinessJSON(w, http.StatusOK, scenario)
}

func (h *APIHandler) UpdateBusinessScenarioHandler(w http.ResponseWriter, r *http.Request) {
	existing, ok := h.getBusinessScenarioForRequest(w, r)
	if !ok {
		return
	}
	var req BusinessScenarioRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	scenario, err := buildBusinessScenario(existing.Module, req, existing)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := h.EmailAccountRepo.GetDB().Save(&scenario).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusOK, scenario)
}

func (h *APIHandler) DeleteBusinessScenarioHandler(w http.ResponseWriter, r *http.Request) {
	scenario, ok := h.getBusinessScenarioForRequest(w, r)
	if !ok {
		return
	}
	if err := h.EmailAccountRepo.GetDB().Delete(scenario).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) PickupBusinessAccountScenarioHandler(w http.ResponseWriter, r *http.Request) {
	if h.PickupService == nil {
		http.Error(w, "pickup service is not available", http.StatusServiceUnavailable)
		return
	}
	account, ok := h.getBusinessAccountForRequest(w, r)
	if !ok {
		return
	}
	if account.ModuleID == nil {
		http.Error(w, "business account has no module", http.StatusConflict)
		return
	}
	scenarioKey := normalizeBusinessScenarioKey(mux.Vars(r)["scenarioKey"])
	if scenarioKey == "" {
		http.Error(w, "scenarioKey is required", http.StatusBadRequest)
		return
	}
	var scenario models.BusinessScenario
	query := h.EmailAccountRepo.GetDB().
		Where("org_id = ? AND module_id = ? AND key = ?", account.OrgID, *account.ModuleID, scenarioKey)
	if err := query.First(&scenario).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			http.Error(w, "business scenario not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if !scenario.Enabled {
		http.Error(w, "business scenario is disabled", http.StatusConflict)
		return
	}

	var req BusinessScenarioPickupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.ClaimToken) != "" {
		if err := validateBusinessClaimToken(account, req.ClaimToken); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
	}
	pickupReq, err := buildBusinessScenarioPickupRequest(account, scenario, req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	pickupReq.Context = r.Context()
	result, err := h.PickupService.Poll(pickupReq)
	if err != nil {
		http.Error(w, "Pickup poll failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeBusinessJSON(w, http.StatusOK, BusinessScenarioPickupResponse{
		BusinessAccount: BusinessClaimAccountSummary{
			ID:                account.ID,
			Status:            account.Status,
			EmailAccountID:    account.EmailAccountID,
			ModuleID:          account.ModuleID,
			RegistrationEmail: account.RegistrationEmail,
		},
		Scenario: scenario,
		Pickup:   result,
	})
}

func buildBusinessScenario(module *models.BusinessModule, req BusinessScenarioRequest, existing *models.BusinessScenario) (models.BusinessScenario, error) {
	if module == nil {
		return models.BusinessScenario{}, fmt.Errorf("business module is required")
	}
	key := normalizeBusinessScenarioKey(req.Key)
	if existing != nil && key == "" {
		key = existing.Key
	}
	if key == "" {
		return models.BusinessScenario{}, fmt.Errorf("scenario key is required")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = key
	}
	enabled := true
	if existing != nil {
		enabled = existing.Enabled
	}
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	scenario := models.BusinessScenario{
		OrgID:           module.OrgID,
		ModuleID:        module.ID,
		Module:          module,
		Key:             key,
		Name:            name,
		Description:     strings.TrimSpace(req.Description),
		Enabled:         enabled,
		PickupConfig:    safeBusinessJSONMap(req.PickupConfig),
		ExtractorConfig: safeBusinessJSONMap(req.ExtractorConfig),
		SortOrder:       req.SortOrder,
	}
	if existing != nil {
		scenario.ID = existing.ID
		scenario.CreatedAt = existing.CreatedAt
		scenario.DeletedAt = existing.DeletedAt
	}
	return scenario, nil
}

func (h *APIHandler) getBusinessScenarioForRequest(w http.ResponseWriter, r *http.Request) (*models.BusinessScenario, bool) {
	module, ok := h.getBusinessModuleForRequest(w, r)
	if !ok {
		return nil, false
	}
	key := normalizeBusinessScenarioKey(mux.Vars(r)["scenarioKey"])
	if key == "" {
		http.Error(w, "scenarioKey is required", http.StatusBadRequest)
		return nil, false
	}
	var scenario models.BusinessScenario
	if err := h.EmailAccountRepo.GetDB().
		Preload("Module").
		Where("org_id = ? AND module_id = ? AND key = ?", module.OrgID, module.ID, key).
		First(&scenario).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			http.Error(w, "business scenario not found", http.StatusNotFound)
			return nil, false
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return nil, false
	}
	if scenario.Module == nil {
		scenario.Module = module
	}
	return &scenario, true
}

func buildBusinessScenarioPickupRequest(account *models.BusinessAccount, scenario models.BusinessScenario, req BusinessScenarioPickupRequest) (services.PickupPollRequest, error) {
	if account.EmailAccountID == nil {
		return services.PickupPollRequest{}, fmt.Errorf("business account has no linked email account")
	}
	toQuery := strings.TrimSpace(req.ToQuery)
	if toQuery == "" {
		toQuery = strings.TrimSpace(req.ToQueryCamel)
	}
	if toQuery == "" && account.RegistrationEmail != nil {
		toQuery = strings.TrimSpace(*account.RegistrationEmail)
	}
	if toQuery == "" && account.EmailAccount != nil {
		toQuery = strings.TrimSpace(account.EmailAccount.EmailAddress)
	}
	if toQuery == "" {
		return services.PickupPollRequest{}, fmt.Errorf("business account has no recipient email")
	}

	pickupConfig := safeBusinessJSONMap(scenario.PickupConfig)
	extractorConfig := safeBusinessJSONMap(scenario.ExtractorConfig)
	pickupReq := services.PickupPollRequest{
		AccountID: *account.EmailAccountID,
		ToQuery:   toQuery,
	}
	if value, ok := businessConfigInt(pickupConfig, "keep_alive_seconds", "keepAliveSeconds"); ok {
		pickupReq.KeepAliveSeconds = value
	}
	if value, ok := businessConfigInt(pickupConfig, "sync_interval", "syncInterval"); ok {
		pickupReq.SyncInterval = value
	}
	if value, ok := businessConfigInt(pickupConfig, "limit"); ok {
		pickupReq.Limit = value
	}
	if value, ok := businessConfigString(pickupConfig, "since"); ok {
		pickupReq.Since = value
	}
	if value, ok := businessConfigString(pickupConfig, "to_query", "toQuery"); ok && strings.TrimSpace(value) != "" {
		pickupReq.ToQuery = strings.TrimSpace(value)
	}

	if req.KeepAliveSeconds > 0 {
		pickupReq.KeepAliveSeconds = req.KeepAliveSeconds
	}
	if req.KeepAliveSecondsCamel > 0 {
		pickupReq.KeepAliveSeconds = req.KeepAliveSecondsCamel
	}
	if req.SyncInterval > 0 {
		pickupReq.SyncInterval = req.SyncInterval
	}
	if req.SyncIntervalCamel > 0 {
		pickupReq.SyncInterval = req.SyncIntervalCamel
	}
	if req.Limit > 0 {
		pickupReq.Limit = req.Limit
	}
	if strings.TrimSpace(req.Since) != "" {
		pickupReq.Since = strings.TrimSpace(req.Since)
	}
	if strings.TrimSpace(req.ToQuery) != "" {
		pickupReq.ToQuery = strings.TrimSpace(req.ToQuery)
	}
	if strings.TrimSpace(req.ToQueryCamel) != "" {
		pickupReq.ToQuery = strings.TrimSpace(req.ToQueryCamel)
	}

	if templateID, ok := businessConfigUint(extractorConfig, "template_id", "templateId"); ok {
		pickupReq.TemplateID = &templateID
	}
	decodeBusinessConfig(extractorConfig, &pickupReq.InlineActions, "inline_actions", "inlineActions")
	decodeBusinessConfig(extractorConfig, &pickupReq.SimpleExtract, "simple_extract", "simpleExtract")
	if req.TemplateID != nil {
		pickupReq.TemplateID = req.TemplateID
	}
	if req.TemplateIDCamel != nil {
		pickupReq.TemplateID = req.TemplateIDCamel
	}
	if req.InlineActions != nil {
		pickupReq.InlineActions = req.InlineActions
		pickupReq.TemplateID = nil
	}
	if req.InlineActionsCamel != nil {
		pickupReq.InlineActions = req.InlineActionsCamel
		pickupReq.TemplateID = nil
	}
	if req.SimpleExtract != nil {
		pickupReq.SimpleExtract = req.SimpleExtract
		pickupReq.TemplateID = nil
		pickupReq.InlineActions = nil
	}
	if req.SimpleExtractCamel != nil {
		pickupReq.SimpleExtract = req.SimpleExtractCamel
		pickupReq.TemplateID = nil
		pickupReq.InlineActions = nil
	}
	return pickupReq, nil
}

func decodeBusinessConfig[T any](config models.JSONMapInterface, target **T, names ...string) bool {
	value, ok := businessConfigValue(config, names...)
	if !ok || value == nil {
		return false
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return false
	}
	var decoded T
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		return false
	}
	*target = &decoded
	return true
}

func normalizeBusinessScenarioKey(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == ':' || r == '.' {
			b.WriteRune(r)
		}
	}
	return strings.Trim(b.String(), "-_:.")
}
