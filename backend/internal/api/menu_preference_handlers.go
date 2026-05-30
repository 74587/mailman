package api

import (
	"encoding/json"
	"errors"
	"mailman/internal/models"
	"net/http"
	"strings"

	"gorm.io/gorm"
)

type MenuPreferenceRequest struct {
	Visibility models.JSONMapInterface `json:"visibility,omitempty" swaggertype:"object"`
	Order      models.StringSlice      `json:"order,omitempty"`
}

type MenuPreferenceResponse struct {
	Visibility models.JSONMapInterface `json:"visibility" swaggertype:"object"`
	Order      models.StringSlice      `json:"order"`
}

// GetMenuPreferenceHandler returns the current user's sidebar menu preferences.
// @Summary Get menu preferences
// @Tags menu
// @Produce json
// @Success 200 {object} MenuPreferenceResponse
// @Router /api/menu-preferences/me [get]
func (h *APIHandler) GetMenuPreferenceHandler(w http.ResponseWriter, r *http.Request) {
	user, ok := r.Context().Value(UserContextKey).(*models.User)
	if !ok || user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var preference models.UserMenuPreference
	err := h.EmailAccountRepo.GetDB().Where("user_id = ?", user.ID).First(&preference).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeMenuPreferenceJSON(w, http.StatusOK, MenuPreferenceResponse{
			Visibility: models.JSONMapInterface{},
			Order:      models.StringSlice{},
		})
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeMenuPreferenceJSON(w, http.StatusOK, MenuPreferenceResponse{
		Visibility: ensureJSONMap(preference.Visibility),
		Order:      normalizeMenuOrder(preference.Order),
	})
}

// UpdateMenuPreferenceHandler upserts the current user's sidebar menu preferences.
// @Summary Update menu preferences
// @Tags menu
// @Accept json
// @Produce json
// @Param request body MenuPreferenceRequest true "Menu preferences"
// @Success 200 {object} MenuPreferenceResponse
// @Router /api/menu-preferences/me [put]
func (h *APIHandler) UpdateMenuPreferenceHandler(w http.ResponseWriter, r *http.Request) {
	user, ok := r.Context().Value(UserContextKey).(*models.User)
	if !ok || user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var request MenuPreferenceRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	visibility := ensureJSONMap(request.Visibility)
	order := normalizeMenuOrder(request.Order)
	db := h.EmailAccountRepo.GetDB()

	var preference models.UserMenuPreference
	err := db.Where("user_id = ?", user.ID).First(&preference).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		preference = models.UserMenuPreference{
			UserID:     user.ID,
			Visibility: visibility,
			Order:      order,
		}
		if err := db.Create(&preference).Error; err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeMenuPreferenceJSON(w, http.StatusOK, MenuPreferenceResponse{Visibility: visibility, Order: order})
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	preference.Visibility = visibility
	preference.Order = order
	if err := db.Save(&preference).Error; err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeMenuPreferenceJSON(w, http.StatusOK, MenuPreferenceResponse{Visibility: visibility, Order: order})
}

func ensureJSONMap(value models.JSONMapInterface) models.JSONMapInterface {
	if value == nil {
		return models.JSONMapInterface{}
	}
	return value
}

func normalizeMenuOrder(values []string) models.StringSlice {
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

func writeMenuPreferenceJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}
