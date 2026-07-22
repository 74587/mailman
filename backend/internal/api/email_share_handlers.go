package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mailman/internal/models"
	"mailman/internal/repository"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

const (
	defaultEmailShareDays = 7
	maxEmailShareDays     = 30
)

type createEmailShareLinkRequest struct {
	ExpiresInDays int `json:"expiresInDays"`
}

type emailShareLinkResponse struct {
	Token     string    `json:"token,omitempty"`
	EmailID   uint      `json:"emailId"`
	AccountID uint      `json:"accountId"`
	Direction string    `json:"direction"`
	ExpiresAt time.Time `json:"expiresAt"`
}

func emailShareTokenHash(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func newEmailShareToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (h *APIHandler) CreateEmailShareLinkHandler(w http.ResponseWriter, r *http.Request) {
	emailID64, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 32)
	if err != nil || emailID64 == 0 {
		http.Error(w, "Invalid email ID", http.StatusBadRequest)
		return
	}

	request := createEmailShareLinkRequest{ExpiresInDays: defaultEmailShareDays}
	if r.Body != nil {
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}
	if request.ExpiresInDays == 0 {
		request.ExpiresInDays = defaultEmailShareDays
	}
	if request.ExpiresInDays < 1 || request.ExpiresInDays > maxEmailShareDays {
		http.Error(w, "expiresInDays must be between 1 and 30", http.StatusBadRequest)
		return
	}

	orgID := GetCurrentOrgID(r)
	email, err := h.EmailRepo.GetByIDForOrg(orgID, uint(emailID64))
	if err != nil {
		http.Error(w, "email not found", http.StatusNotFound)
		return
	}
	token, err := newEmailShareToken()
	if err != nil {
		http.Error(w, "failed to create share link", http.StatusInternalServerError)
		return
	}

	expiresAt := time.Now().UTC().Add(time.Duration(request.ExpiresInDays) * 24 * time.Hour)
	link := &models.EmailShareLink{
		OrgID:           orgID,
		EmailID:         email.ID,
		CreatedByUserID: getUserIDFromContext(r),
		TokenHash:       emailShareTokenHash(token),
		ExpiresAt:       expiresAt,
	}
	if err := h.EmailRepo.CreateShareLink(link); err != nil {
		http.Error(w, "failed to create share link", http.StatusInternalServerError)
		return
	}

	direction := string(email.Direction)
	if direction == "" {
		direction = string(models.EmailDirectionReceived)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	writeJSON(w, emailShareLinkResponse{
		Token:     token,
		EmailID:   email.ID,
		AccountID: email.AccountID,
		Direction: direction,
		ExpiresAt: expiresAt,
	})
}

func (h *APIHandler) ResolveEmailShareLinkHandler(w http.ResponseWriter, r *http.Request) {
	token := mux.Vars(r)["token"]
	if len(token) < 32 || len(token) > 128 {
		http.Error(w, repository.ErrEmailShareLinkUnavailable.Error(), http.StatusNotFound)
		return
	}

	link, email, err := h.EmailRepo.ResolveShareLink(GetCurrentOrgID(r), emailShareTokenHash(token), time.Now().UTC())
	if err != nil {
		if errors.Is(err, repository.ErrEmailShareLinkUnavailable) {
			http.Error(w, repository.ErrEmailShareLinkUnavailable.Error(), http.StatusNotFound)
			return
		}
		http.Error(w, "failed to resolve share link", http.StatusInternalServerError)
		return
	}

	direction := string(email.Direction)
	if direction == "" {
		direction = string(models.EmailDirectionReceived)
	}
	writeJSON(w, emailShareLinkResponse{
		EmailID:   email.ID,
		AccountID: email.AccountID,
		Direction: direction,
		ExpiresAt: link.ExpiresAt,
	})
}
