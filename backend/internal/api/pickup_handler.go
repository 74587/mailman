package api

import (
	"encoding/json"
	"mailman/internal/services"
	"mailman/internal/utils"
	"net/http"
)

// PickupHandler 取件轮询API处理器
type PickupHandler struct {
	pickupService *services.PickupService
	logger        *utils.Logger
}

// NewPickupHandler 创建取件轮询处理器
func NewPickupHandler(pickupService *services.PickupService) *PickupHandler {
	return &PickupHandler{
		pickupService: pickupService,
		logger:        utils.NewLogger("PickupHandler"),
	}
}

// PollHandler 处理取件轮询请求
// @Summary 统一取件轮询
// @Description 合并「续期同步」「搜索邮件」「执行提取」为一个原子操作。每次调用自动在内存中注册/续期临时同步覆盖，确保后端持续拉取该账户的邮件。
// @Tags pickup
// @Accept json
// @Produce json
// @Param request body services.PickupPollRequest true "取件轮询请求"
// @Success 200 {object} services.PickupPollResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/pickup/poll [post]
func (h *PickupHandler) PollHandler(w http.ResponseWriter, r *http.Request) {
	var req services.PickupPollRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("Failed to decode pickup poll request: %v", err)
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 参数校验
	if req.AccountID == 0 {
		http.Error(w, "account_id is required", http.StatusBadRequest)
		return
	}

	// 执行轮询
	result, err := h.pickupService.Poll(req)
	if err != nil {
		h.logger.Error("Pickup poll failed for account %d: %v", req.AccountID, err)
		http.Error(w, "Pickup poll failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
