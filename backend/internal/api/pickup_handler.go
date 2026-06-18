package api

import (
	"context"
	"encoding/json"
	"errors"
	"mailman/internal/services"
	"mailman/internal/utils"
	"net/http"
	"time"
)

const pickupPollHandlerTimeout = 30 * time.Second

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

	// 参数校验：account_id 可作为调用方提示；如果没有传，则必须能通过 to_query 在服务层解析到账户。
	if req.AccountID == 0 && req.ToQuery == "" {
		http.Error(w, "account_id or to_query is required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	req.Context = ctx

	// 执行轮询
	type pollOutcome struct {
		result *services.PickupPollResponse
		err    error
	}
	done := make(chan pollOutcome, 1)
	go func() {
		result, err := h.pickupService.Poll(req)
		done <- pollOutcome{result: result, err: err}
	}()

	var result *services.PickupPollResponse
	var err error
	timer := time.NewTimer(pickupPollHandlerTimeout)
	defer timer.Stop()
	select {
	case outcome := <-done:
		result = outcome.result
		err = outcome.err
	case <-ctx.Done():
		h.logger.Warn("Pickup poll request canceled for account %d: %v", req.AccountID, ctx.Err())
		return
	case <-timer.C:
		cancel()
		h.logger.Error("Pickup poll handler timed out for account %d after %s", req.AccountID, pickupPollHandlerTimeout)
		http.Error(w, "Pickup poll timed out", http.StatusServiceUnavailable)
		return
	}
	if err != nil {
		h.logger.Error("Pickup poll failed for account %d: %v", req.AccountID, err)
		status := http.StatusInternalServerError
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			status = http.StatusServiceUnavailable
		}
		http.Error(w, "Pickup poll failed: "+err.Error(), status)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
