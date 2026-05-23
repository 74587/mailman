package api

import (
	"encoding/json"
	"net/http"

	"mailman/internal/models"
	"mailman/internal/services"

	"github.com/gorilla/mux"
)

// SystemConfigHandler 系统配置API处理器
type SystemConfigHandler struct {
	service *services.SystemConfigService
}

// NewSystemConfigHandler 创建系统配置处理器
func NewSystemConfigHandler(service *services.SystemConfigService) *SystemConfigHandler {
	return &SystemConfigHandler{
		service: service,
	}
}

// GetConfigByKey 根据键获取配置
// @Summary 获取系统配置
// @Description 根据配置键获取系统配置信息
// @Tags system-config
// @Accept json
// @Produce json
// @Param key path string true "配置键"
// @Success 200 {object} models.SystemConfigResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/system-config/{key} [get]
func (h *SystemConfigHandler) GetConfigByKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	key := vars["key"]

	if key == "" {
		http.Error(w, "configuration key is required", http.StatusBadRequest)
		return
	}

	config, err := h.service.GetConfigByKey(key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// UpdateConfigValue 更新配置值
// @Summary 更新系统配置值
// @Description 根据配置键更新系统配置的值
// @Tags system-config
// @Accept json
// @Produce json
// @Param key path string true "配置键"
// @Param request body models.SystemConfigRequest true "配置值"
// @Success 200 {object} models.SystemConfigResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/system-config/{key} [put]
func (h *SystemConfigHandler) UpdateConfigValue(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	key := vars["key"]

	if key == "" {
		http.Error(w, "configuration key is required", http.StatusBadRequest)
		return
	}

	var request models.SystemConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// 验证配置值
	if err := h.service.ValidateConfigValue(key, request.Value); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 更新配置值
	if err := h.service.UpdateConfigValue(key, request.Value); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 返回更新后的配置
	config, err := h.service.GetConfigByKey(key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// GetAllConfigs 获取所有配置
// @Summary 获取所有系统配置
// @Description 获取所有可见的系统配置
// @Tags system-config
// @Accept json
// @Produce json
// @Success 200 {array} models.SystemConfigResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/system-configs [get]
func (h *SystemConfigHandler) GetAllConfigs(w http.ResponseWriter, r *http.Request) {
	configs, err := h.service.GetAllConfigs()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(configs)
}

// GetConfigsByCategory 根据分类获取配置
// @Summary 根据分类获取系统配置
// @Description 根据配置分类获取相关的系统配置
// @Tags system-config
// @Accept json
// @Produce json
// @Param category path string true "配置分类"
// @Success 200 {array} models.SystemConfigResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/system-configs/category/{category} [get]
func (h *SystemConfigHandler) GetConfigsByCategory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	category := vars["category"]

	if category == "" {
		http.Error(w, "category is required", http.StatusBadRequest)
		return
	}

	configs, err := h.service.GetConfigsByCategory(category)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(configs)
}

// ResetConfigToDefault 重置配置为默认值
// @Summary 重置系统配置为默认值
// @Description 将指定的系统配置重置为默认值
// @Tags system-config
// @Accept json
// @Produce json
// @Param key path string true "配置键"
// @Success 200 {object} models.SystemConfigResponse
// @Failure 400 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/system-config/{key}/reset [post]
func (h *SystemConfigHandler) ResetConfigToDefault(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	key := vars["key"]

	if key == "" {
		http.Error(w, "configuration key is required", http.StatusBadRequest)
		return
	}

	if err := h.service.ResetConfigToDefault(key); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 返回重置后的配置
	config, err := h.service.GetConfigByKey(key)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// GetLoginTheme 获取登录页主题（公开端点，无需认证）
// @Summary 获取登录页主题
// @Description 获取当前登录页面的视觉主题配置（公开端点）
// @Tags system-config
// @Produce json
// @Success 200 {object} map[string]string
// @Failure 500 {object} ErrorResponse
// @Router /api/public/login-theme [get]
func (h *SystemConfigHandler) GetLoginTheme(w http.ResponseWriter, r *http.Request) {
	theme, err := h.service.GetStringConfig("login-theme")
	if err != nil {
		// 如果获取失败，返回默认值
		theme = "classic"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"theme": theme,
	})
}
