package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"mailman/internal/models"
	"mailman/internal/services"

	"github.com/gorilla/mux"
)

type DetectOutlookProtocolResponse struct {
	Status           string `json:"status"`
	AccountID        uint   `json:"account_id"`
	EmailAddress     string `json:"email_address,omitempty"`
	Protocol         string `json:"protocol,omitempty"`
	PreviousProtocol string `json:"previous_protocol,omitempty"`
	Changed          bool   `json:"changed"`
	Method           string `json:"method,omitempty"`
	Message          string `json:"message,omitempty"`
}

// DetectOutlookProtocolHandler performs a read-only Graph/IMAP capability
// check and persists the selected protocol for one Outlook OAuth2 account.
// @Summary Automatically detect an Outlook account protocol
// @Tags accounts
// @Produce json
// @Param id path int true "Account ID"
// @Success 200 {object} DetectOutlookProtocolResponse
// @Failure 400 {object} DetectOutlookProtocolResponse
// @Failure 403 {object} DetectOutlookProtocolResponse
// @Failure 404 {object} DetectOutlookProtocolResponse
// @Failure 422 {object} DetectOutlookProtocolResponse
// @Failure 503 {object} DetectOutlookProtocolResponse
// @Router /api/accounts/{id}/detect-outlook-protocol [post]
func (h *APIHandler) DetectOutlookProtocolHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	accountIDValue, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		writeDetectOutlookProtocolResponse(w, http.StatusBadRequest, DetectOutlookProtocolResponse{Status: "failed", Message: "Invalid account ID"})
		return
	}
	accountID := uint(accountIDValue)

	account, err := h.EmailAccountRepo.GetByID(accountID)
	if err != nil || account == nil {
		writeDetectOutlookProtocolResponse(w, http.StatusNotFound, DetectOutlookProtocolResponse{Status: "failed", AccountID: accountID, Message: "Account not found"})
		return
	}
	if orgID := GetCurrentOrgID(r); orgID > 0 && account.OrgID != orgID {
		writeDetectOutlookProtocolResponse(w, http.StatusForbidden, DetectOutlookProtocolResponse{Status: "failed", AccountID: accountID, Message: "Access denied"})
		return
	}
	if account.AuthType != models.AuthTypeOAuth2 || account.MailProvider == nil || account.MailProvider.Type != models.ProviderTypeOutlook {
		writeDetectOutlookProtocolResponse(w, http.StatusBadRequest, DetectOutlookProtocolResponse{
			Status:       "failed",
			AccountID:    accountID,
			EmailAddress: account.EmailAddress,
			Message:      "Protocol detection supports Outlook OAuth2 accounts only",
		})
		return
	}

	var result services.OutlookProtocolDetectionResult
	detect := func() error {
		var detectErr error
		result, detectErr = h.Fetcher.DetectOutlookProtocol(ctx, *account)
		return detectErr
	}
	if h.perAccountSyncManager != nil {
		err = h.perAccountSyncManager.RunAccountExclusiveWithContext(ctx, accountID, detect)
	} else {
		err = detect()
	}
	if err != nil {
		statusCode := http.StatusUnprocessableEntity
		var detectionErr *services.OutlookProtocolDetectionError
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) ||
			(errors.As(err, &detectionErr) && detectionErr.Temporary) {
			statusCode = http.StatusServiceUnavailable
		}
		writeDetectOutlookProtocolResponse(w, statusCode, DetectOutlookProtocolResponse{
			Status:           "failed",
			AccountID:        accountID,
			EmailAddress:     account.EmailAddress,
			PreviousProtocol: account.CustomSettings["connection_protocol"],
			Message:          err.Error(),
		})
		return
	}

	writeDetectOutlookProtocolResponse(w, http.StatusOK, DetectOutlookProtocolResponse{
		Status:           "success",
		AccountID:        accountID,
		EmailAddress:     account.EmailAddress,
		Protocol:         result.Protocol,
		PreviousProtocol: result.PreviousProtocol,
		Changed:          result.Changed,
		Method:           result.Method,
		Message:          "Outlook protocol detected successfully",
	})
}

func writeDetectOutlookProtocolResponse(w http.ResponseWriter, statusCode int, response DetectOutlookProtocolResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(response)
}
