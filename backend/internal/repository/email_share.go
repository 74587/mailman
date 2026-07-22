package repository

import (
	"errors"
	"mailman/internal/models"
	"time"

	"gorm.io/gorm"
)

var ErrEmailShareLinkUnavailable = errors.New("email share link is invalid or expired")

// GetByIDForOrg returns an email only when its owning account belongs to the
// active organization.
func (r *EmailRepository) GetByIDForOrg(orgID, emailID uint) (*models.Email, error) {
	var email models.Email
	err := r.db.
		Joins("JOIN email_accounts ON email_accounts.id = emails.account_id").
		Where("emails.id = ? AND email_accounts.org_id = ? AND emails.deleted_at IS NULL AND email_accounts.deleted_at IS NULL", emailID, orgID).
		Preload("Account").
		First(&email).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("email not found")
		}
		return nil, err
	}
	return &email, nil
}

func (r *EmailRepository) CreateShareLink(link *models.EmailShareLink) error {
	return r.db.Create(link).Error
}

// ResolveShareLink validates both the token record and the current ownership
// of the email. This prevents a stale link from crossing organization
// boundaries if an account is ever reassigned.
func (r *EmailRepository) ResolveShareLink(orgID uint, tokenHash string, now time.Time) (*models.EmailShareLink, *models.Email, error) {
	var link models.EmailShareLink
	err := r.db.
		Where("org_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > ?", orgID, tokenHash, now).
		First(&link).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrEmailShareLinkUnavailable
		}
		return nil, nil, err
	}

	email, err := r.GetByIDForOrg(orgID, link.EmailID)
	if err != nil {
		return nil, nil, ErrEmailShareLinkUnavailable
	}
	return &link, email, nil
}
