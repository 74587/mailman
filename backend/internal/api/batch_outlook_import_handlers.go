package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mailman/internal/models"
	"mailman/internal/services"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

const (
	batchOutlookImportMaxAccounts        = 5000
	batchOutlookImportDefaultCreateLimit = 10
	batchOutlookImportDefaultVerifyLimit = 4
	batchOutlookImportDefaultSyncLimit   = 2
	batchOutlookImportMaxCreateLimit     = 30
	batchOutlookImportMaxVerifyLimit     = 12
	batchOutlookImportMaxSyncLimit       = 6

	batchOutlookStatusQueued   = "queued"
	batchOutlookStatusRunning  = "running"
	batchOutlookStatusComplete = "complete"
	batchOutlookStatusFailed   = "failed"

	batchOutlookStepPending     = "pending"
	batchOutlookStepRunning     = "running"
	batchOutlookStepSuccess     = "success"
	batchOutlookStepError       = "error"
	batchOutlookStepSkipped     = "skipped"
	batchOutlookStepCreating    = "creating"
	batchOutlookStepVerifying   = "verifying"
	batchOutlookStepSyncing     = "syncing"
	batchOutlookStepConfiguring = "configuring"
)

var outlookImportJobs = newBatchOutlookImportJobStore()

type BatchOutlookImportAccountRequest struct {
	LineNumber       int    `json:"line_number"`
	Email            string `json:"email"`
	Password         string `json:"password,omitempty"`
	ClientID         string `json:"client_id"`
	AccessToken      string `json:"access_token,omitempty"`
	RefreshToken     string `json:"refresh_token"`
	RecoveryEmail    string `json:"recovery_email,omitempty"`
	RecoveryPassword string `json:"recovery_password,omitempty"`
}

type BatchOutlookImportOptions struct {
	Verify            *bool                            `json:"verify,omitempty"`
	RunInitialSync    *bool                            `json:"run_initial_sync,omitempty"`
	CreateSyncConfig  *bool                            `json:"create_sync_config,omitempty"`
	UpdateExisting    *bool                            `json:"update_existing,omitempty"`
	CreateConcurrency int                              `json:"create_concurrency,omitempty"`
	VerifyConcurrency int                              `json:"verify_concurrency,omitempty"`
	SyncConcurrency   int                              `json:"sync_concurrency,omitempty"`
	ConfigConcurrency int                              `json:"config_concurrency,omitempty"`
	InitialSync       *FetchAndStoreRequest            `json:"initial_sync,omitempty"`
	SyncConfig        *AccountOnboardSyncConfigRequest `json:"sync_config,omitempty"`
}

type BatchOutlookImportRequest struct {
	Accounts []BatchOutlookImportAccountRequest `json:"accounts"`
	Options  BatchOutlookImportOptions          `json:"options"`
}

type BatchOutlookImportAccountResult struct {
	LineNumber    int    `json:"line_number"`
	Email         string `json:"email"`
	AccountID     uint   `json:"account_id,omitempty"`
	Created       bool   `json:"created,omitempty"`
	Updated       bool   `json:"updated,omitempty"`
	CreateStatus  string `json:"create_status"`
	CreateError   string `json:"create_error,omitempty"`
	VerifyStatus  string `json:"verify_status"`
	VerifyError   string `json:"verify_error,omitempty"`
	SyncStatus    string `json:"sync_status"`
	SyncError     string `json:"sync_error,omitempty"`
	SyncNewEmails int    `json:"sync_new_emails,omitempty"`
	ConfigStatus  string `json:"config_status"`
	ConfigError   string `json:"config_error,omitempty"`
}

type BatchOutlookImportSummary struct {
	Total            int `json:"total"`
	CreateSuccess    int `json:"create_success"`
	CreateError      int `json:"create_error"`
	VerifySuccess    int `json:"verify_success"`
	VerifyError      int `json:"verify_error"`
	VerifySkipped    int `json:"verify_skipped"`
	SyncSuccess      int `json:"sync_success"`
	SyncError        int `json:"sync_error"`
	SyncSkipped      int `json:"sync_skipped"`
	ConfigSuccess    int `json:"config_success"`
	ConfigError      int `json:"config_error"`
	ConfigSkipped    int `json:"config_skipped"`
	TotalNewEmails   int `json:"total_new_emails"`
	CompletedResults int `json:"completed_results"`
}

type BatchOutlookImportJobResponse struct {
	JobID      string                            `json:"job_id"`
	Status     string                            `json:"status"`
	Stage      string                            `json:"stage"`
	OrgID      uint                              `json:"org_id,omitempty"`
	StartedAt  time.Time                         `json:"started_at"`
	UpdatedAt  time.Time                         `json:"updated_at"`
	FinishedAt *time.Time                        `json:"finished_at,omitempty"`
	Message    string                            `json:"message,omitempty"`
	Options    BatchOutlookImportOptions         `json:"options"`
	Summary    BatchOutlookImportSummary         `json:"summary"`
	Results    []BatchOutlookImportAccountResult `json:"results"`
}

type batchOutlookImportJob struct {
	mu         sync.Mutex
	id         string
	orgID      uint
	status     string
	stage      string
	startedAt  time.Time
	updatedAt  time.Time
	finishedAt *time.Time
	message    string
	options    BatchOutlookImportOptions
	results    []BatchOutlookImportAccountResult
	summary    BatchOutlookImportSummary
}

type batchOutlookImportJobStore struct {
	mu   sync.RWMutex
	jobs map[string]*batchOutlookImportJob
}

func newBatchOutlookImportJobStore() *batchOutlookImportJobStore {
	return &batchOutlookImportJobStore{
		jobs: make(map[string]*batchOutlookImportJob),
	}
}

func (s *batchOutlookImportJobStore) create(orgID uint, options BatchOutlookImportOptions, accounts []BatchOutlookImportAccountRequest) (*batchOutlookImportJob, error) {
	id, err := newBatchOutlookImportJobID()
	if err != nil {
		return nil, err
	}

	now := time.Now()
	results := make([]BatchOutlookImportAccountResult, len(accounts))
	for idx, account := range accounts {
		email := strings.TrimSpace(strings.ToLower(account.Email))
		results[idx] = BatchOutlookImportAccountResult{
			LineNumber:   account.LineNumber,
			Email:        email,
			CreateStatus: batchOutlookStepPending,
			VerifyStatus: batchOutlookStepPending,
			SyncStatus:   batchOutlookStepPending,
			ConfigStatus: batchOutlookStepPending,
		}
	}

	job := &batchOutlookImportJob{
		id:        id,
		orgID:     orgID,
		status:    batchOutlookStatusQueued,
		stage:     "queued",
		startedAt: now,
		updatedAt: now,
		options:   options,
		results:   results,
	}
	job.recalculateSummaryLocked()

	s.mu.Lock()
	s.jobs[id] = job
	s.mu.Unlock()

	return job, nil
}

func (s *batchOutlookImportJobStore) get(id string) (*batchOutlookImportJob, bool) {
	s.mu.RLock()
	job, ok := s.jobs[id]
	s.mu.RUnlock()
	return job, ok
}

func newBatchOutlookImportJobID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return "boi_" + hex.EncodeToString(bytes[:]), nil
}

func (j *batchOutlookImportJob) snapshot() BatchOutlookImportJobResponse {
	j.mu.Lock()
	defer j.mu.Unlock()

	results := make([]BatchOutlookImportAccountResult, len(j.results))
	copy(results, j.results)
	return BatchOutlookImportJobResponse{
		JobID:      j.id,
		Status:     j.status,
		Stage:      j.stage,
		OrgID:      j.orgID,
		StartedAt:  j.startedAt,
		UpdatedAt:  j.updatedAt,
		FinishedAt: j.finishedAt,
		Message:    j.message,
		Options:    j.options,
		Summary:    j.summary,
		Results:    results,
	}
}

func (j *batchOutlookImportJob) setStage(stage string) {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.status = batchOutlookStatusRunning
	j.stage = stage
	j.updatedAt = time.Now()
}

func (j *batchOutlookImportJob) setMessage(message string) {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.message = message
	j.updatedAt = time.Now()
}

func (j *batchOutlookImportJob) updateResult(idx int, update func(*BatchOutlookImportAccountResult)) {
	j.mu.Lock()
	defer j.mu.Unlock()

	if idx < 0 || idx >= len(j.results) {
		return
	}
	update(&j.results[idx])
	j.updatedAt = time.Now()
	j.recalculateSummaryLocked()
}

func (j *batchOutlookImportJob) finish(status string, message string) {
	j.mu.Lock()
	defer j.mu.Unlock()

	now := time.Now()
	j.status = status
	j.stage = status
	j.message = message
	j.updatedAt = now
	j.finishedAt = &now
	j.recalculateSummaryLocked()
}

func (j *batchOutlookImportJob) recalculateSummaryLocked() {
	summary := BatchOutlookImportSummary{Total: len(j.results)}
	for _, result := range j.results {
		if result.CreateStatus == batchOutlookStepSuccess {
			summary.CreateSuccess++
		}
		if result.CreateStatus == batchOutlookStepError {
			summary.CreateError++
		}
		if result.VerifyStatus == batchOutlookStepSuccess {
			summary.VerifySuccess++
		}
		if result.VerifyStatus == batchOutlookStepError {
			summary.VerifyError++
		}
		if result.VerifyStatus == batchOutlookStepSkipped {
			summary.VerifySkipped++
		}
		if result.SyncStatus == batchOutlookStepSuccess {
			summary.SyncSuccess++
		}
		if result.SyncStatus == batchOutlookStepError {
			summary.SyncError++
		}
		if result.SyncStatus == batchOutlookStepSkipped {
			summary.SyncSkipped++
		}
		if result.ConfigStatus == batchOutlookStepSuccess {
			summary.ConfigSuccess++
		}
		if result.ConfigStatus == batchOutlookStepError {
			summary.ConfigError++
		}
		if result.ConfigStatus == batchOutlookStepSkipped {
			summary.ConfigSkipped++
		}
		if result.CreateStatus == batchOutlookStepError ||
			result.ConfigStatus == batchOutlookStepSuccess ||
			result.ConfigStatus == batchOutlookStepError ||
			result.ConfigStatus == batchOutlookStepSkipped {
			summary.CompletedResults++
		}
		summary.TotalNewEmails += result.SyncNewEmails
	}
	j.summary = summary
}

// StartBatchOutlookImportHandler starts a backend-only Outlook account import job.
// @Summary Start backend Outlook batch import
// @Description Creates/updates Outlook OAuth2 accounts and optionally verifies, runs initial sync, and saves sync config in a background job.
// @Tags accounts
// @Accept json
// @Produce json
// @Param request body BatchOutlookImportRequest true "Batch Outlook import request"
// @Success 202 {object} BatchOutlookImportJobResponse
// @Failure 400 {object} ErrorResponse
// @Failure 500 {object} ErrorResponse
// @Router /api/accounts/batch-outlook-import [post]
func (h *APIHandler) StartBatchOutlookImportHandler(w http.ResponseWriter, r *http.Request) {
	orgID := GetCurrentOrgID(r)

	var request BatchOutlookImportRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if len(request.Accounts) == 0 {
		http.Error(w, "accounts is required", http.StatusBadRequest)
		return
	}
	if len(request.Accounts) > batchOutlookImportMaxAccounts {
		http.Error(w, fmt.Sprintf("accounts cannot exceed %d", batchOutlookImportMaxAccounts), http.StatusBadRequest)
		return
	}

	options := normalizeBatchOutlookImportOptions(request.Options)
	job, err := outlookImportJobs.create(orgID, options, request.Accounts)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	userID := getUserIDFromContext(r)
	jobContext := context.Background()
	if user, ok := r.Context().Value(UserContextKey).(*models.User); ok && user != nil {
		jobContext = context.WithValue(jobContext, UserContextKey, user)
	}
	jobRequest := r.Clone(jobContext)
	go h.runBatchOutlookImportJob(job, request.Accounts, jobRequest, userID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(job.snapshot())
}

// GetBatchOutlookImportJobHandler returns a backend Outlook batch import job snapshot.
// @Summary Get backend Outlook batch import job
// @Description Returns current status and per-account progress for an Outlook batch import job.
// @Tags accounts
// @Produce json
// @Param jobID path string true "Batch Outlook import job ID"
// @Success 200 {object} BatchOutlookImportJobResponse
// @Failure 403 {object} ErrorResponse
// @Failure 404 {object} ErrorResponse
// @Router /api/accounts/batch-outlook-import/{jobID} [get]
func (h *APIHandler) GetBatchOutlookImportJobHandler(w http.ResponseWriter, r *http.Request) {
	jobID := mux.Vars(r)["jobID"]
	job, ok := outlookImportJobs.get(jobID)
	if !ok {
		http.Error(w, "job not found", http.StatusNotFound)
		return
	}

	orgID := GetCurrentOrgID(r)
	if orgID > 0 && job.orgID > 0 && job.orgID != orgID {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job.snapshot())
}

func normalizeBatchOutlookImportOptions(options BatchOutlookImportOptions) BatchOutlookImportOptions {
	if options.Verify == nil {
		value := true
		options.Verify = &value
	}
	if options.RunInitialSync == nil {
		value := true
		options.RunInitialSync = &value
	}
	if options.CreateSyncConfig == nil {
		value := true
		options.CreateSyncConfig = &value
	}
	if options.UpdateExisting == nil {
		value := true
		options.UpdateExisting = &value
	}

	options.CreateConcurrency = clampBatchOutlookImportConcurrency(
		options.CreateConcurrency,
		batchOutlookImportDefaultCreateLimit,
		batchOutlookImportMaxCreateLimit,
	)
	options.VerifyConcurrency = clampBatchOutlookImportConcurrency(
		options.VerifyConcurrency,
		batchOutlookImportDefaultVerifyLimit,
		batchOutlookImportMaxVerifyLimit,
	)
	options.SyncConcurrency = clampBatchOutlookImportConcurrency(
		options.SyncConcurrency,
		batchOutlookImportDefaultSyncLimit,
		batchOutlookImportMaxSyncLimit,
	)
	options.ConfigConcurrency = clampBatchOutlookImportConcurrency(
		options.ConfigConcurrency,
		options.CreateConcurrency,
		batchOutlookImportMaxCreateLimit,
	)
	return options
}

func clampBatchOutlookImportConcurrency(value int, defaultValue int, maxValue int) int {
	if value <= 0 {
		value = defaultValue
	}
	if value < 1 {
		return 1
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func (h *APIHandler) runBatchOutlookImportJob(job *batchOutlookImportJob, accounts []BatchOutlookImportAccountRequest, r *http.Request, userID *uint) {
	defer func() {
		if recovered := recover(); recovered != nil {
			job.finish(batchOutlookStatusFailed, fmt.Sprintf("batch import panicked: %v", recovered))
		}
	}()

	providerID, err := h.getOutlookMailProviderID()
	if err != nil {
		for idx := range accounts {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				result.CreateStatus = batchOutlookStepError
				result.CreateError = err.Error()
				result.VerifyStatus = batchOutlookStepSkipped
				result.SyncStatus = batchOutlookStepSkipped
				result.ConfigStatus = batchOutlookStepSkipped
			})
		}
		job.finish(batchOutlookStatusFailed, err.Error())
		return
	}

	job.setStage(batchOutlookStepCreating)
	runBatchOutlookImportWorkers(len(accounts), job.options.CreateConcurrency, func(idx int) {
		job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
			result.CreateStatus = batchOutlookStepRunning
		})
		accountID, created, err := h.createOrUpdateBatchOutlookAccount(accounts[idx], providerID, job.orgID, shouldRun(job.options.UpdateExisting, true), userID)
		if err != nil {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				result.CreateStatus = batchOutlookStepError
				result.CreateError = err.Error()
				result.VerifyStatus = batchOutlookStepSkipped
				result.SyncStatus = batchOutlookStepSkipped
				result.ConfigStatus = batchOutlookStepSkipped
			})
			return
		}
		job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
			result.AccountID = accountID
			result.Created = created
			result.Updated = !created
			result.CreateStatus = batchOutlookStepSuccess
		})
	})

	if !shouldRun(job.options.Verify, true) {
		job.setMessage("accounts imported; verification was skipped")
		for idx := range accounts {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				if result.CreateStatus == batchOutlookStepSuccess {
					result.VerifyStatus = batchOutlookStepSkipped
					result.SyncStatus = batchOutlookStepSkipped
					result.ConfigStatus = batchOutlookStepSkipped
				}
			})
		}
		job.finish(batchOutlookStatusComplete, "accounts imported; verification was skipped")
		return
	}

	job.setStage(batchOutlookStepVerifying)
	runBatchOutlookImportWorkers(len(accounts), job.options.VerifyConcurrency, func(idx int) {
		snapshot := job.snapshot().Results[idx]
		if snapshot.CreateStatus != batchOutlookStepSuccess || snapshot.AccountID == 0 {
			return
		}
		job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
			result.VerifyStatus = batchOutlookStepRunning
		})
		verification := h.verifyAccountByID(snapshot.AccountID)
		if !verification.Success {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				result.VerifyStatus = batchOutlookStepError
				result.VerifyError = verification.Error
				if result.VerifyError == "" {
					result.VerifyError = verification.Message
				}
				result.SyncStatus = batchOutlookStepSkipped
				result.ConfigStatus = batchOutlookStepSkipped
			})
			return
		}
		if err := h.resetBatchOutlookAccountErrorStatus(snapshot.AccountID); err != nil {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				result.VerifyStatus = batchOutlookStepError
				result.VerifyError = fmt.Sprintf("Connection verified but failed to reset error status: %v", err)
				result.SyncStatus = batchOutlookStepSkipped
				result.ConfigStatus = batchOutlookStepSkipped
			})
			return
		}
		job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
			result.VerifyStatus = batchOutlookStepSuccess
		})
	})

	if !shouldRun(job.options.RunInitialSync, true) {
		job.setMessage("accounts imported and verified; initial sync was skipped")
		for idx := range accounts {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				if result.VerifyStatus == batchOutlookStepSuccess {
					result.SyncStatus = batchOutlookStepSkipped
					result.ConfigStatus = batchOutlookStepSkipped
				}
			})
		}
		job.finish(batchOutlookStatusComplete, "accounts imported and verified; initial sync was skipped")
		return
	}

	job.setStage(batchOutlookStepSyncing)
	runBatchOutlookImportWorkers(len(accounts), job.options.SyncConcurrency, func(idx int) {
		snapshot := job.snapshot().Results[idx]
		if snapshot.VerifyStatus != batchOutlookStepSuccess || snapshot.AccountID == 0 {
			return
		}
		job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
			result.SyncStatus = batchOutlookStepRunning
		})
		account, err := h.EmailAccountRepo.GetByID(snapshot.AccountID)
		if err != nil {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				result.SyncStatus = batchOutlookStepError
				result.SyncError = err.Error()
				result.ConfigStatus = batchOutlookStepSkipped
			})
			return
		}
		syncResponse, err := h.runFetchAndStoreForAccount(r, *account, job.options.InitialSync)
		if err != nil {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				result.SyncStatus = batchOutlookStepError
				result.SyncError = err.Error()
				result.ConfigStatus = batchOutlookStepSkipped
			})
			return
		}
		if len(syncResponse.Messages) > 0 {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				result.SyncStatus = batchOutlookStepError
				result.SyncError = strings.Join(syncResponse.Messages, "; ")
				result.SyncNewEmails = syncResponse.TotalNewEmails
				result.ConfigStatus = batchOutlookStepSkipped
			})
			return
		}
		job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
			result.SyncStatus = batchOutlookStepSuccess
			result.SyncNewEmails = syncResponse.TotalNewEmails
		})
	})

	if !shouldRun(job.options.CreateSyncConfig, true) {
		job.setMessage("accounts imported, verified, and synced; sync config was skipped")
		for idx := range accounts {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				if result.SyncStatus == batchOutlookStepSuccess {
					result.ConfigStatus = batchOutlookStepSkipped
				}
			})
		}
		job.finish(batchOutlookStatusComplete, "accounts imported, verified, and synced; sync config was skipped")
		return
	}

	job.setStage(batchOutlookStepConfiguring)
	runBatchOutlookImportWorkers(len(accounts), job.options.ConfigConcurrency, func(idx int) {
		snapshot := job.snapshot().Results[idx]
		if snapshot.SyncStatus != batchOutlookStepSuccess || snapshot.AccountID == 0 {
			return
		}
		job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
			result.ConfigStatus = batchOutlookStepRunning
		})
		if _, err := h.createOAuth2OnboardingSyncConfig(snapshot.AccountID, job.options.SyncConfig); err != nil {
			job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
				result.ConfigStatus = batchOutlookStepError
				result.ConfigError = err.Error()
			})
			return
		}
		job.updateResult(idx, func(result *BatchOutlookImportAccountResult) {
			result.ConfigStatus = batchOutlookStepSuccess
		})
	})

	job.finish(batchOutlookStatusComplete, "batch Outlook import completed")
}

func runBatchOutlookImportWorkers(total int, limit int, worker func(idx int)) {
	if total <= 0 {
		return
	}
	if limit <= 0 {
		limit = 1
	}
	if limit > total {
		limit = total
	}

	indices := make(chan int)
	var wg sync.WaitGroup
	wg.Add(limit)
	for workerIdx := 0; workerIdx < limit; workerIdx++ {
		go func() {
			defer wg.Done()
			for idx := range indices {
				worker(idx)
			}
		}()
	}
	for idx := 0; idx < total; idx++ {
		indices <- idx
	}
	close(indices)
	wg.Wait()
}

func (h *APIHandler) getOutlookMailProviderID() (uint, error) {
	providers, err := h.MailProviderRepo.GetByType(models.ProviderTypeOutlook)
	if err != nil {
		return 0, err
	}
	if len(providers) == 0 {
		return 0, fmt.Errorf("Outlook mail provider not found")
	}
	return providers[0].ID, nil
}

func (h *APIHandler) createOrUpdateBatchOutlookAccount(input BatchOutlookImportAccountRequest, providerID uint, orgID uint, updateExisting bool, userID *uint) (uint, bool, error) {
	email := strings.TrimSpace(strings.ToLower(input.Email))
	clientID := strings.TrimSpace(input.ClientID)
	refreshToken := strings.TrimSpace(input.RefreshToken)
	if email == "" {
		return 0, false, fmt.Errorf("email is required")
	}
	if clientID == "" {
		return 0, false, fmt.Errorf("client_id is required")
	}
	if refreshToken == "" {
		return 0, false, fmt.Errorf("refresh_token is required")
	}

	settings := models.JSONMap{}
	existingAccount, err := h.EmailAccountRepo.GetByEmailWithProvider(email)
	if err != nil {
		return 0, false, err
	}
	if existingAccount != nil && orgID > 0 && existingAccount.OrgID != orgID {
		return 0, false, fmt.Errorf("Access denied")
	}
	if existingAccount != nil && !updateExisting {
		return 0, false, fmt.Errorf("email account already exists")
	}
	if existingAccount != nil && existingAccount.CustomSettings != nil {
		for key, value := range existingAccount.CustomSettings {
			settings[key] = value
		}
	}
	settings["client_id"] = clientID
	settings["refresh_token"] = refreshToken
	if accessToken := strings.TrimSpace(input.AccessToken); accessToken != "" {
		settings["access_token"] = accessToken
	}
	if recoveryEmail := strings.TrimSpace(input.RecoveryEmail); recoveryEmail != "" {
		settings["recovery_email"] = recoveryEmail
	}
	if recoveryPassword := strings.TrimSpace(input.RecoveryPassword); recoveryPassword != "" {
		settings["recovery_password"] = recoveryPassword
	}

	account := models.EmailAccount{
		EmailAddress:   email,
		AuthType:       models.AuthTypeOAuth2,
		MailProviderID: &providerID,
		CustomSettings: settings,
		OrgID:          orgID,
	}
	if strings.TrimSpace(input.Password) != "" {
		account.Password = services.EncryptIfAvailable(input.Password)
	}

	created := existingAccount == nil
	if existingAccount != nil {
		account.ID = existingAccount.ID
		account.CreatedAt = existingAccount.CreatedAt
		if orgID == 0 {
			account.OrgID = existingAccount.OrgID
		}
		if strings.TrimSpace(input.Password) == "" {
			account.Password = existingAccount.Password
		}
		account.Token = existingAccount.Token
		account.OAuth2ProviderID = existingAccount.OAuth2ProviderID
		account.IsVerified = existingAccount.IsVerified
		account.VerifiedAt = existingAccount.VerifiedAt
		account.LastSyncAt = existingAccount.LastSyncAt
		account.ErrorStatus = existingAccount.ErrorStatus
		account.ErrorMessage = existingAccount.ErrorMessage
		account.ErrorTimestamp = existingAccount.ErrorTimestamp
		account.ErrorCount = existingAccount.ErrorCount
		account.AutoDisabledAt = existingAccount.AutoDisabledAt
		preserveBatchOutlookAccountSettings(&account, existingAccount)
	}

	if h.ProxyPoolService != nil {
		if err := h.ProxyPoolService.PrepareAccountProxy(&account); err != nil {
			return 0, false, err
		}
	}

	if created {
		if err := h.EmailAccountRepo.Create(&account); err != nil {
			return 0, false, err
		}
		h.activityLogger.LogAccountActivity(models.ActivityAccountAdded, &account, userID)
		return account.ID, true, nil
	}
	if err := h.EmailAccountRepo.Update(&account); err != nil {
		return 0, false, err
	}
	h.activityLogger.LogAccountActivity(models.ActivityAccountUpdated, &account, userID)
	return account.ID, false, nil
}

func preserveBatchOutlookAccountSettings(account *models.EmailAccount, existing *models.EmailAccount) {
	account.Proxy = existing.Proxy
	account.ProxyMode = existing.ProxyMode
	account.ProxyID = existing.ProxyID
	account.ProxyFallbackMode = existing.ProxyFallbackMode
	account.ProxyFallbackProxyID = existing.ProxyFallbackProxyID
	account.ProxyFallbackProxy = existing.ProxyFallbackProxy
	account.ProxyMatchGroupIDs = existing.ProxyMatchGroupIDs
	account.ProxyMatchTagIDs = existing.ProxyMatchTagIDs
	account.ProxyMatchTagMode = existing.ProxyMatchTagMode
	account.IsDomainMail = existing.IsDomainMail
	account.Domain = existing.Domain
	account.ForwardedAddresses = existing.ForwardedAddresses
	account.Note = existing.Note
	account.NoteFormat = existing.NoteFormat
}

func (h *APIHandler) resetBatchOutlookAccountErrorStatus(accountID uint) error {
	account, err := h.EmailAccountRepo.GetByID(accountID)
	if err != nil {
		return err
	}
	account.ErrorStatus = string(models.ErrorStatusNormal)
	account.ErrorMessage = ""
	account.ErrorTimestamp = nil
	account.ErrorCount = 0
	return h.EmailAccountRepo.Update(account)
}
