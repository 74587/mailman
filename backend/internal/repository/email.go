package repository

import (
	"errors"
	"mailman/internal/models"
	"time"

	"gorm.io/gorm"
)

// EmailRepository handles database operations for Email
type EmailRepository struct {
	db *gorm.DB
}

// NewEmailRepository creates a new EmailRepository
func NewEmailRepository(db *gorm.DB) *EmailRepository {
	return &EmailRepository{db: db}
}

// Create creates a new email
func (r *EmailRepository) Create(email *models.Email) error {
	// 在保存前提取纯邮箱地址
	email.ExtractPureAddresses()
	return r.db.Create(email).Error
}

// CreateBatch creates multiple emails in a batch
func (r *EmailRepository) CreateBatch(emails []models.Email) error {
	if len(emails) == 0 {
		return nil
	}
	// 在保存前提取每封邮件的纯邮箱地址
	for i := range emails {
		emails[i].ExtractPureAddresses()
	}
	return r.db.CreateInBatches(emails, 100).Error
}

// GetByID retrieves an email by ID
func (r *EmailRepository) GetByID(id uint) (*models.Email, error) {
	var email models.Email
	err := r.db.Preload("Account").Preload("Attachments").First(&email, id).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("email not found")
		}
		return nil, err
	}
	return &email, nil
}

// GetByMessageID retrieves an email by RFC Message-ID
func (r *EmailRepository) GetByMessageID(messageID string) (*models.Email, error) {
	var email models.Email
	err := r.db.Preload("Account").Preload("Attachments").Where("message_id = ?", messageID).First(&email).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("email not found")
		}
		return nil, err
	}
	return &email, nil
}

// GetByAccount retrieves all emails for a specific account
func (r *EmailRepository) GetByAccount(accountID uint, limit, offset int) ([]models.Email, error) {
	return r.GetByAccountWithSort(accountID, limit, offset, "date DESC")
}

// GetByAccountWithSort retrieves all emails for a specific account with custom sorting
func (r *EmailRepository) GetByAccountWithSort(accountID uint, limit, offset int, sortBy string) ([]models.Email, error) {
	var emails []models.Email
	query := r.db.Where("account_id = ?", accountID).Order(sortBy)

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	err := query.Find(&emails).Error
	return emails, err
}

// GetByAccountAndMailbox retrieves emails for a specific account and mailbox
func (r *EmailRepository) GetByAccountAndMailbox(accountID uint, mailbox string, limit, offset int) ([]models.Email, error) {
	return r.GetByAccountAndMailboxWithSort(accountID, mailbox, limit, offset, "date DESC")
}

// GetByAccountAndMailboxWithSort retrieves emails for a specific account and mailbox with custom sorting
func (r *EmailRepository) GetByAccountAndMailboxWithSort(accountID uint, mailbox string, limit, offset int, sortBy string) ([]models.Email, error) {
	var emails []models.Email
	query := r.db.Where("account_id = ? AND mailbox_name = ?", accountID, mailbox).Order(sortBy)

	if limit > 0 {
		query = query.Limit(limit)
	}
	if offset > 0 {
		query = query.Offset(offset)
	}

	err := query.Find(&emails).Error
	return emails, err
}

// GetByDateRange retrieves emails within a date range
func (r *EmailRepository) GetByDateRange(accountID uint, startDate, endDate time.Time) ([]models.Email, error) {
	var emails []models.Email
	err := r.db.Where("account_id = ? AND date BETWEEN ? AND ?", accountID, startDate, endDate).
		Order("date DESC").Find(&emails).Error
	return emails, err
}

// Search searches emails by subject or sender
func (r *EmailRepository) Search(accountID uint, query string) ([]models.Email, error) {
	var emails []models.Email
	searchPattern := "%" + query + "%"
	err := r.db.Where("account_id = ? AND (subject LIKE ? OR from LIKE ?)", accountID, searchPattern, searchPattern).
		Order("date DESC").Find(&emails).Error
	return emails, err
}

// Update updates an email
func (r *EmailRepository) Update(email *models.Email) error {
	return r.db.Save(email).Error
}

// UpdateFlags updates email flags
func (r *EmailRepository) UpdateFlags(id uint, flags models.StringSlice) error {
	return r.db.Model(&models.Email{}).Where("id = ?", id).Update("flags", flags).Error
}

// Delete soft deletes an email
func (r *EmailRepository) Delete(id uint) error {
	return r.db.Delete(&models.Email{}, id).Error
}

// DeleteByAccount deletes all emails for a specific account
func (r *EmailRepository) DeleteByAccount(accountID uint) error {
	return r.db.Where("account_id = ?", accountID).Delete(&models.Email{}).Error
}

// GetCount returns the total count of emails for an account
func (r *EmailRepository) GetCount(accountID uint) (int64, error) {
	var count int64
	err := r.db.Model(&models.Email{}).Where("account_id = ?", accountID).Count(&count).Error
	return count, err
}

// GetCountByMailbox returns the count of emails for a specific mailbox
func (r *EmailRepository) GetCountByMailbox(accountID uint, mailbox string) (int64, error) {
	var count int64
	err := r.db.Model(&models.Email{}).Where("account_id = ? AND mailbox_name = ?", accountID, mailbox).Count(&count).Error
	return count, err
}

// GetTotalCount returns the total count of all emails across all accounts
func (r *EmailRepository) GetTotalCount(orgID uint) (int64, error) {
	var count int64
	query := r.db.Model(&models.Email{})
	if orgID > 0 {
		query = query.Where("account_id IN (?)", r.db.Model(&models.EmailAccount{}).Select("id").Where("org_id = ?", orgID))
	}
	err := query.Count(&count).Error
	return count, err
}

// GetUnreadCount returns the count of unread emails for an account
func (r *EmailRepository) GetUnreadCount(accountID uint) (int64, error) {
	var count int64
	err := r.db.Model(&models.Email{}).
		Where("account_id = ? AND flags NOT LIKE ?", accountID, "%\"\\\\Seen\"%").
		Count(&count).Error
	return count, err
}

// GetTotalUnreadCount returns the total count of unread emails across all accounts
func (r *EmailRepository) GetTotalUnreadCount(orgID uint) (int64, error) {
	var count int64
	query := r.db.Model(&models.Email{}).
		Where("flags NOT LIKE ?", "%\"\\\\Seen\"%")
	if orgID > 0 {
		query = query.Where("account_id IN (?)", r.db.Model(&models.EmailAccount{}).Select("id").Where("org_id = ?", orgID))
	}
	err := query.Count(&count).Error
	return count, err
}

// GetTodayEmailCount returns the count of emails received today
func (r *EmailRepository) GetTodayEmailCount(orgID uint) (int64, error) {
	today := time.Now().Truncate(24 * time.Hour)
	tomorrow := today.Add(24 * time.Hour)

	var count int64
	query := r.db.Model(&models.Email{}).
		Where("date >= ? AND date < ?", today, tomorrow)
	if orgID > 0 {
		query = query.Where("account_id IN (?)", r.db.Model(&models.EmailAccount{}).Select("id").Where("org_id = ?", orgID))
	}
	err := query.Count(&count).Error
	return count, err
}

// GetYesterdayEmailCount returns the count of emails received yesterday
func (r *EmailRepository) GetYesterdayEmailCount(orgID uint) (int64, error) {
	today := time.Now().Truncate(24 * time.Hour)
	yesterday := today.Add(-24 * time.Hour)

	var count int64
	query := r.db.Model(&models.Email{}).
		Where("date >= ? AND date < ?", yesterday, today)
	if orgID > 0 {
		query = query.Where("account_id IN (?)", r.db.Model(&models.EmailAccount{}).Select("id").Where("org_id = ?", orgID))
	}
	err := query.Count(&count).Error
	return count, err
}

// GetEmailCountUntilYesterday returns the total count of emails until yesterday 24:00
func (r *EmailRepository) GetEmailCountUntilYesterday(orgID uint) (int64, error) {
	today := time.Now().Truncate(24 * time.Hour)

	var count int64
	query := r.db.Model(&models.Email{}).
		Where("date < ?", today)
	if orgID > 0 {
		query = query.Where("account_id IN (?)", r.db.Model(&models.EmailAccount{}).Select("id").Where("org_id = ?", orgID))
	}
	err := query.Count(&count).Error
	return count, err
}

// GetEmailCountUntilNow returns the total count of emails until now
func (r *EmailRepository) GetEmailCountUntilNow(orgID uint) (int64, error) {
	return r.GetTotalCount(orgID)
}

// CheckDuplicate checks if an email with the same message ID already exists
func (r *EmailRepository) CheckDuplicate(messageID string, accountID uint) (bool, error) {
	var count int64
	err := r.db.Model(&models.Email{}).Where("message_id = ? AND account_id = ?", messageID, accountID).Count(&count).Error
	return count > 0, err
}

// EmailSearchOptions represents search criteria for emails
type EmailSearchOptions struct {
	AccountID          uint
	OrgID              uint   // Filter emails by organization (via account)
	Limit              int
	Offset             int
	SortBy             string
	StartDate          *time.Time
	EndDate            *time.Time
	FromQuery          string
	ToQuery            string
	CcQuery            string
	SubjectQuery       string
	BodyQuery          string
	HTMLQuery          string
	Keyword            string // Global search across all text fields
	MailboxName        string
	Direction          string // "received", "sent", or "" for all
	PreloadAttachments bool   // Whether to preload attachments (default false for performance)
}

// SearchEmails performs advanced search on emails with multiple criteria
func (r *EmailRepository) SearchEmails(options EmailSearchOptions) ([]models.Email, int64, error) {
	var emails []models.Email
	var totalCount int64

	// Build the base query
	query := r.db.Model(&models.Email{})

	// Preload attachments if requested
	if options.PreloadAttachments {
		query = query.Preload("Attachments")
	}

	// Apply account filter only if AccountID is specified (non-zero)
	if options.AccountID > 0 {
		query = query.Where("account_id = ?", options.AccountID)
	}

	// Apply organization filter (via account subquery)
	if options.OrgID > 0 {
		query = query.Where("account_id IN (?)", r.db.Model(&models.EmailAccount{}).Select("id").Where("org_id = ?", options.OrgID))
	}

	// Apply date range filter
	if options.StartDate != nil {
		query = query.Where("date >= ?", *options.StartDate)
	}
	if options.EndDate != nil {
		query = query.Where("date <= ?", *options.EndDate)
	}

	// Apply mailbox filter
	if options.MailboxName != "" {
		query = query.Where("mailbox_name = ?", options.MailboxName)
	}

	// Apply direction filter (default to received if not specified)
	if options.Direction == "all" {
		// No filter - show all emails
	} else if options.Direction != "" {
		query = query.Where("direction = ?", options.Direction)
	} else {
		// Default: only show received emails
		query = query.Where("direction = ? OR direction IS NULL OR direction = ''", models.EmailDirectionReceived)
	}

	// Apply text search filters
	if options.Keyword != "" {
		// Global keyword search across all text fields
		keywordPattern := "%" + options.Keyword + "%"
		query = query.Where(
			"subject LIKE ? OR JSON_EXTRACT(`from`, '$[0]') LIKE ? OR `to` LIKE ? OR cc LIKE ? OR body LIKE ? OR html_body LIKE ?",
			keywordPattern, keywordPattern, keywordPattern, keywordPattern, keywordPattern, keywordPattern,
		)
	} else {
		// Individual field searches
		if options.FromQuery != "" {
			fromPattern := "%" + options.FromQuery + "%"
			query = query.Where("JSON_EXTRACT(`from`, '$[0]') LIKE ?", fromPattern)
		}
		if options.ToQuery != "" {
			// Search across the entire To field JSON array using LIKE for SQLite compatibility
			toPattern := "%" + options.ToQuery + "%"
			query = query.Where("`to` LIKE ?", toPattern)
		}
		if options.CcQuery != "" {
			// Search across the entire CC field JSON array using LIKE for SQLite compatibility
			ccPattern := "%" + options.CcQuery + "%"
			query = query.Where("cc LIKE ?", ccPattern)
		}
		if options.SubjectQuery != "" {
			subjectPattern := "%" + options.SubjectQuery + "%"
			query = query.Where("subject LIKE ?", subjectPattern)
		}
		if options.BodyQuery != "" {
			bodyPattern := "%" + options.BodyQuery + "%"
			query = query.Where("body LIKE ?", bodyPattern)
		}
		if options.HTMLQuery != "" {
			htmlPattern := "%" + options.HTMLQuery + "%"
			query = query.Where("html_body LIKE ?", htmlPattern)
		}
	}

	// Get total count for pagination
	countQuery := query
	err := countQuery.Count(&totalCount).Error
	if err != nil {
		return nil, 0, err
	}

	// Apply sorting
	sortBy := options.SortBy
	if sortBy == "" {
		sortBy = "date DESC"
	}
	query = query.Order(sortBy)

	// Apply pagination
	if options.Limit > 0 {
		query = query.Limit(options.Limit)
	}
	if options.Offset > 0 {
		query = query.Offset(options.Offset)
	}

	// Execute the query
	err = query.Find(&emails).Error
	return emails, totalCount, err
}

// EmailCursor represents a cursor for streaming email queries
type EmailCursor struct {
	db        *gorm.DB
	query     *gorm.DB
	batchSize int
	lastID    uint
}

// NewEmailCursor creates a new email cursor for streaming queries
func (r *EmailRepository) NewEmailCursor(options EmailSearchOptions, batchSize int) *EmailCursor {
	if batchSize <= 0 {
		batchSize = 100 // Default batch size
	}

	// Build the base query (same as SearchEmails)
	query := r.db.Model(&models.Email{})

	// Only filter by account ID if it's specified (non-zero)
	if options.AccountID != 0 {
		query = query.Where("account_id = ?", options.AccountID)
	}

	// Apply date range filter
	if options.StartDate != nil {
		query = query.Where("date >= ?", *options.StartDate)
	}
	if options.EndDate != nil {
		query = query.Where("date <= ?", *options.EndDate)
	}

	// Apply mailbox filter
	if options.MailboxName != "" {
		query = query.Where("mailbox_name = ?", options.MailboxName)
	}

	// Apply text search filters
	if options.Keyword != "" {
		// Global keyword search across all text fields
		keywordPattern := "%" + options.Keyword + "%"
		query = query.Where(
			"subject LIKE ? OR JSON_EXTRACT(`from`, '$[0]') LIKE ? OR JSON_EXTRACT(`to`, '$[0]') LIKE ? OR JSON_EXTRACT(cc, '$[0]') LIKE ? OR body LIKE ? OR html_body LIKE ?",
			keywordPattern, keywordPattern, keywordPattern, keywordPattern, keywordPattern, keywordPattern,
		)
	} else {
		// Individual field searches
		if options.FromQuery != "" {
			fromPattern := "%" + options.FromQuery + "%"
			query = query.Where("JSON_EXTRACT(`from`, '$[0]') LIKE ?", fromPattern)
		}
		if options.ToQuery != "" {
			toPattern := "%" + options.ToQuery + "%"
			query = query.Where("JSON_EXTRACT(`to`, '$[0]') LIKE ?", toPattern)
		}
		if options.CcQuery != "" {
			ccPattern := "%" + options.CcQuery + "%"
			query = query.Where("JSON_EXTRACT(cc, '$[0]') LIKE ?", ccPattern)
		}
		if options.SubjectQuery != "" {
			subjectPattern := "%" + options.SubjectQuery + "%"
			query = query.Where("subject LIKE ?", subjectPattern)
		}
		if options.BodyQuery != "" {
			bodyPattern := "%" + options.BodyQuery + "%"
			query = query.Where("body LIKE ?", bodyPattern)
		}
		if options.HTMLQuery != "" {
			htmlPattern := "%" + options.HTMLQuery + "%"
			query = query.Where("html_body LIKE ?", htmlPattern)
		}
	}

	// Apply sorting (always include ID for consistent cursor pagination)
	sortBy := options.SortBy
	if sortBy == "" {
		sortBy = "date DESC, id DESC"
	} else {
		sortBy += ", id DESC"
	}
	query = query.Order(sortBy)

	return &EmailCursor{
		db:        r.db,
		query:     query,
		batchSize: batchSize,
		lastID:    0,
	}
}

// Next fetches the next batch of emails from the cursor
func (c *EmailCursor) Next() ([]models.Email, error) {
	var emails []models.Email

	// Add cursor condition for pagination
	query := c.query
	if c.lastID > 0 {
		query = query.Where("id < ?", c.lastID)
	}

	err := query.Limit(c.batchSize).Find(&emails).Error
	if err != nil {
		return nil, err
	}

	// Update cursor position
	if len(emails) > 0 {
		c.lastID = emails[len(emails)-1].ID
	}

	return emails, nil
}

// HasMore checks if there are more emails to fetch
func (c *EmailCursor) HasMore() (bool, error) {
	var count int64
	query := c.query
	if c.lastID > 0 {
		query = query.Where("id < ?", c.lastID)
	}

	err := query.Limit(1).Count(&count).Error
	return count > 0, err
}

// Close closes the cursor (placeholder for future cleanup if needed)
func (c *EmailCursor) Close() error {
	// Currently no cleanup needed, but keeping for interface consistency
	return nil
}

// GetEmailsByAccountIDSince retrieves emails for an account since a specific time
func (r *EmailRepository) GetEmailsByAccountIDSince(accountID uint, since time.Time) ([]models.Email, error) {
	var emails []models.Email
	err := r.db.Where("account_id = ? AND date >= ?", accountID, since).
		Order("date DESC").
		Find(&emails).Error
	return emails, err
}

// GetAllMailboxFolders retrieves all unique mailbox folders across accounts in the org
func (r *EmailRepository) GetAllMailboxFolders(orgID uint) ([]string, error) {
	var folders []string

	query := r.db.Model(&models.Email{}).
		Select("DISTINCT mailbox_name").
		Where("mailbox_name IS NOT NULL AND mailbox_name != ''")
	if orgID > 0 {
		query = query.Where("account_id IN (?)", r.db.Model(&models.EmailAccount{}).Select("id").Where("org_id = ?", orgID))
	}
	err := query.
		Order("mailbox_name ASC").
		Pluck("mailbox_name", &folders).Error

	if err != nil {
		return nil, err
	}

	return folders, nil
}
