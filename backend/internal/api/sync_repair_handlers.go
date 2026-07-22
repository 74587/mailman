package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mailman/internal/models"
	"mailman/internal/services"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

// RepairAccountSyncRequest controls the bounded full sync used to repair a
// Gmail account whose stored checkpoint has moved past unpersisted messages.
type RepairAccountSyncRequest struct {
	DefaultStartDate    *string `json:"default_start_date,omitempty"`
	MaxEmailsPerMailbox int     `json:"max_emails_per_mailbox,omitempty"`
}

type RepairAccountSyncResponse struct {
	Status               string            `json:"status"`
	AccountID            uint              `json:"account_id"`
	Mailbox              string            `json:"mailbox"`
	TotalEmailsProcessed int               `json:"total_emails_processed"`
	TotalNewEmails       int               `json:"total_new_emails"`
	ProcessingTimeMs     int64             `json:"processing_time_ms"`
	MailboxResult        MailboxSyncResult `json:"mailbox_result"`
	Message              string            `json:"message,omitempty"`
}

const repairAccountSyncMaxBodyBytes int64 = 64 << 10

// RepairAccountSyncHandler clears stale Gmail checkpoints and immediately
// performs a bounded full INBOX sync. Existing emails are preserved and dedupe
// makes the operation safe to retry.
// @Summary Repair Gmail account synchronization
// @Tags accounts
// @Accept json
// @Produce json
// @Param id path int true "Account ID"
// @Param request body RepairAccountSyncRequest false "Repair options"
// @Success 200 {object} RepairAccountSyncResponse
// @Failure 400 {object} RepairAccountSyncResponse
// @Failure 403 {object} RepairAccountSyncResponse
// @Failure 404 {object} RepairAccountSyncResponse
// @Failure 500 {object} RepairAccountSyncResponse
// @Router /api/accounts/{id}/repair-sync [post]
func (h *APIHandler) RepairAccountSyncHandler(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	accountIDValue, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil {
		writeRepairSyncResponse(w, http.StatusBadRequest, RepairAccountSyncResponse{Status: "failed", Message: "Invalid account ID"})
		return
	}
	accountID := uint(accountIDValue)

	account, err := h.EmailAccountRepo.GetByID(accountID)
	if err != nil || account == nil {
		writeRepairSyncResponse(w, http.StatusNotFound, RepairAccountSyncResponse{Status: "failed", AccountID: accountID, Message: "Account not found"})
		return
	}
	orgID := GetCurrentOrgID(r)
	if orgID > 0 && account.OrgID != orgID {
		writeRepairSyncResponse(w, http.StatusForbidden, RepairAccountSyncResponse{Status: "failed", AccountID: accountID, Message: "Access denied"})
		return
	}
	if account.AuthType != models.AuthTypeOAuth2 || account.MailProvider == nil || account.MailProvider.Type != models.ProviderTypeGmail {
		writeRepairSyncResponse(w, http.StatusBadRequest, RepairAccountSyncResponse{
			Status:    "failed",
			AccountID: accountID,
			Message:   "Sync repair currently supports Gmail OAuth2 accounts only",
		})
		return
	}

	var request RepairAccountSyncRequest
	if r.Body != nil {
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, repairAccountSyncMaxBodyBytes))
		decoder.DisallowUnknownFields()
		if decodeErr := decoder.Decode(&request); decodeErr != nil && !errors.Is(decodeErr, io.EOF) {
			writeRepairSyncResponse(w, http.StatusBadRequest, RepairAccountSyncResponse{Status: "failed", AccountID: accountID, Message: "Invalid request body"})
			return
		}
		if decodeErr := decoder.Decode(&struct{}{}); !errors.Is(decodeErr, io.EOF) {
			writeRepairSyncResponse(w, http.StatusBadRequest, RepairAccountSyncResponse{Status: "failed", AccountID: accountID, Message: "Request body must contain a single JSON object"})
			return
		}
	}

	now := time.Now()
	defaultStartDate := now.AddDate(0, -1, 0)
	if request.DefaultStartDate != nil {
		parsed, parseErr := time.Parse(time.RFC3339, *request.DefaultStartDate)
		if parseErr != nil {
			writeRepairSyncResponse(w, http.StatusBadRequest, RepairAccountSyncResponse{
				Status:    "failed",
				AccountID: accountID,
				Message:   fmt.Sprintf("Invalid default_start_date: %v", parseErr),
			})
			return
		}
		if parsed.After(now) {
			writeRepairSyncResponse(w, http.StatusBadRequest, RepairAccountSyncResponse{
				Status:    "failed",
				AccountID: accountID,
				Message:   "default_start_date must not be in the future",
			})
			return
		}
		defaultStartDate = parsed
	}
	maxEmails := request.MaxEmailsPerMailbox
	if maxEmails <= 0 {
		maxEmails = 1000
	}
	if maxEmails > 1000 {
		writeRepairSyncResponse(w, http.StatusBadRequest, RepairAccountSyncResponse{
			Status:    "failed",
			AccountID: accountID,
			Message:   "max_emails_per_mailbox must not exceed 1000",
		})
		return
	}

	var mailboxResult MailboxSyncResult
	repair := func() error {
		if err := h.SyncConfigRepo.ResetAccountSyncState(accountID); err != nil {
			return fmt.Errorf("failed to reset sync checkpoints: %w", err)
		}

		mailboxResult = h.processSingleMailboxWithSourceAndContext(
			r.Context(),
			*account,
			"INBOX",
			"full",
			&defaultStartDate,
			nil,
			maxEmails,
			true,
			services.EmailIngestSourceManualSync,
		)
		if mailboxResult.Error != "" {
			// Leave the account without a forward cursor so retrying the repair
			// cannot skip messages after a partial failure.
			resetErr := h.SyncConfigRepo.ResetAccountSyncState(accountID)
			if resetErr != nil {
				return fmt.Errorf("%s; additionally failed to keep checkpoints reset: %v", mailboxResult.Error, resetErr)
			}
			return errors.New(mailboxResult.Error)
		}
		return nil
	}

	if h.perAccountSyncManager != nil {
		err = h.perAccountSyncManager.RunAccountExclusiveWithContext(r.Context(), accountID, repair)
	} else {
		err = repair()
	}
	if err != nil {
		writeRepairSyncResponse(w, http.StatusInternalServerError, RepairAccountSyncResponse{
			Status:               "failed",
			AccountID:            accountID,
			Mailbox:              "INBOX",
			TotalEmailsProcessed: mailboxResult.EmailsProcessed,
			TotalNewEmails:       mailboxResult.NewEmails,
			ProcessingTimeMs:     time.Since(startedAt).Milliseconds(),
			MailboxResult:        mailboxResult,
			Message:              err.Error(),
		})
		return
	}

	writeRepairSyncResponse(w, http.StatusOK, RepairAccountSyncResponse{
		Status:               "success",
		AccountID:            accountID,
		Mailbox:              "INBOX",
		TotalEmailsProcessed: mailboxResult.EmailsProcessed,
		TotalNewEmails:       mailboxResult.NewEmails,
		ProcessingTimeMs:     time.Since(startedAt).Milliseconds(),
		MailboxResult:        mailboxResult,
		Message:              "Sync checkpoints reset and full sync completed",
	})
}

func writeRepairSyncResponse(w http.ResponseWriter, statusCode int, response RepairAccountSyncResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(response)
}
