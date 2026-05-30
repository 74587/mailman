package repository

import (
	"errors"
	"fmt"
	"mailman/internal/models"
	"strings"
	"time"

	"gorm.io/gorm"
)

// EmailRepository handles database operations for Email
type EmailRepository struct {
	db *gorm.DB
}

type EmailDashboardStats struct {
	TotalEmails          int64
	UnreadEmails         int64
	TodayEmails          int64
	YesterdayEmails      int64
	EmailsUntilYesterday int64
}

// NewEmailRepository creates a new EmailRepository
func NewEmailRepository(db *gorm.DB) *EmailRepository {
	return &EmailRepository{db: db}
}

var emailSortColumns = map[string]string{
	"id":              "id",
	"message_id":      "message_id",
	"account_id":      "account_id",
	"subject":         "subject",
	"from":            "from",
	"to":              "to",
	"cc":              "cc",
	"from_address":    "from_address",
	"to_addresses":    "to_addresses",
	"cc_addresses":    "cc_addresses",
	"date":            "date",
	"received_at":     "received_at",
	"mailbox_name":    "mailbox_name",
	"size":            "size",
	"direction":       "direction",
	"created_at":      "created_at",
	"updated_at":      "updated_at",
	"has_attachments": "has_attachments",
}

func normalizeEmailSortColumn(column string) string {
	column = strings.Trim(strings.ToLower(column), "`\" ")
	column = strings.ReplaceAll(column, "-", "_")

	switch column {
	case "messageid":
		return "message_id"
	case "accountid":
		return "account_id"
	case "fromaddress":
		return "from_address"
	case "toaddresses":
		return "to_addresses"
	case "ccaddresses":
		return "cc_addresses"
	case "receivedat":
		return "received_at"
	case "mailboxname":
		return "mailbox_name"
	case "createdat":
		return "created_at"
	case "updatedat":
		return "updated_at"
	case "hasattachments":
		return "has_attachments"
	default:
		return column
	}
}

func parseEmailSortPart(part string) (column string, direction string) {
	part = strings.TrimSpace(part)
	if part == "" {
		return "", ""
	}

	normalized := strings.ReplaceAll(part, "-", "_")
	lower := strings.ToLower(normalized)
	if strings.HasSuffix(lower, "_desc") {
		return normalizeEmailSortColumn(lower[:len(lower)-len("_desc")]), "DESC"
	}
	if strings.HasSuffix(lower, "_asc") {
		return normalizeEmailSortColumn(lower[:len(lower)-len("_asc")]), "ASC"
	}

	fields := strings.Fields(part)
	if len(fields) == 0 {
		return "", ""
	}

	direction = "DESC"
	if len(fields) > 1 && strings.EqualFold(fields[1], "asc") {
		direction = "ASC"
	}

	return normalizeEmailSortColumn(fields[0]), direction
}

func buildEmailOrderClause(db *gorm.DB, sortBy string, includeID bool) string {
	clauses := make([]string, 0, 2)
	usedColumns := make(map[string]bool)

	for _, part := range strings.Split(sortBy, ",") {
		column, direction := parseEmailSortPart(part)
		if column == "" {
			continue
		}
		mappedColumn, ok := emailSortColumns[column]
		if !ok {
			continue
		}

		clauses = append(clauses, fmt.Sprintf("%s %s", quoteColumn(db, mappedColumn), direction))
		usedColumns[mappedColumn] = true
	}

	if len(clauses) == 0 {
		clauses = append(clauses, fmt.Sprintf("%s DESC", quoteColumn(db, "date")))
		usedColumns["date"] = true
	}

	if includeID && !usedColumns["id"] {
		clauses = append(clauses, fmt.Sprintf("%s DESC", quoteColumn(db, "id")))
	}

	return strings.Join(clauses, ", ")
}

func emailRecipientLikeExprs(db *gorm.DB) []string {
	return []string{
		textLikeExpr(db, "to_addresses"),
		textLikeExpr(db, "to"),
		textLikeExpr(db, "headers"),
	}
}

func emailRecipientLikeExpr(db *gorm.DB) string {
	return "(" + strings.Join(emailRecipientLikeExprs(db), " OR ") + ")"
}

func emailSearchAddressPatterns(query string) []string {
	trimmed := strings.TrimSpace(query)
	if trimmed == "" {
		return nil
	}

	patterns := make([]string, 0, 4)
	seen := make(map[string]bool)
	addPattern := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		pattern := "%" + value + "%"
		if !seen[pattern] {
			seen[pattern] = true
			patterns = append(patterns, pattern)
		}
	}

	addPattern(trimmed)

	extracted := models.ExtractEmail(trimmed)
	if extracted != trimmed {
		addPattern(extracted)
	}

	lower := strings.ToLower(extracted)
	if lower != extracted {
		addPattern(lower)
	}

	if strings.HasPrefix(lower, "*@") && len(lower) > 2 {
		addPattern("@" + lower[2:])
	}

	atIndex := strings.LastIndex(lower, "@")
	if atIndex <= 0 || atIndex >= len(lower)-1 {
		return patterns
	}

	localPart := lower[:atIndex]
	domainPart := lower[atIndex+1:]
	if domainPart == "googlemail.com" {
		domainPart = "gmail.com"
	}

	if domainPart == "gmail.com" {
		if plusIndex := strings.Index(localPart, "+"); plusIndex > 0 {
			baseAddress := localPart[:plusIndex] + "@" + domainPart
			addPattern(baseAddress)
			addPattern(localPart[:plusIndex] + "@googlemail.com")
		} else {
			pattern := "%" + localPart + "+%@gmail.com%"
			if !seen[pattern] {
				seen[pattern] = true
				patterns = append(patterns, pattern)
			}
			pattern = "%" + localPart + "+%@googlemail.com%"
			if !seen[pattern] {
				seen[pattern] = true
				patterns = append(patterns, pattern)
			}
		}
	}

	return patterns
}

func emailRecipientSearchExpr(db *gorm.DB, query string) (string, []interface{}) {
	patterns := emailSearchAddressPatterns(query)
	if len(patterns) == 0 {
		exprs := emailRecipientLikeExprs(db)
		args := make([]interface{}, 0, len(exprs))
		for range exprs {
			args = append(args, "%%")
		}
		return emailRecipientLikeExpr(db), args
	}

	recipientExprs := emailRecipientLikeExprs(db)
	recipientExpr := "(" + strings.Join(recipientExprs, " OR ") + ")"
	conditions := make([]string, 0, len(patterns))
	args := make([]interface{}, 0, len(patterns)*len(recipientExprs))
	for _, pattern := range patterns {
		conditions = append(conditions, recipientExpr)
		for range recipientExprs {
			args = append(args, pattern)
		}
	}

	return "(" + strings.Join(conditions, " OR ") + ")", args
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
	query := r.db.Where("account_id = ?", accountID).Order(buildEmailOrderClause(r.db, sortBy, false))

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
	query := r.db.Where("account_id = ? AND mailbox_name = ?", accountID, mailbox).Order(buildEmailOrderClause(r.db, sortBy, false))

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
		Order(buildEmailOrderClause(r.db, "date DESC", false)).Find(&emails).Error
	return emails, err
}

// Search searches emails by subject or sender
func (r *EmailRepository) Search(accountID uint, query string) ([]models.Email, error) {
	var emails []models.Email
	searchPattern := "%" + query + "%"
	err := r.db.Where(
		fmt.Sprintf("account_id = ? AND (subject LIKE ? OR %s)", textLikeExpr(r.db, "from")),
		accountID,
		searchPattern,
		searchPattern,
	).
		Order(buildEmailOrderClause(r.db, "date DESC", false)).Find(&emails).Error
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

func (r *EmailRepository) GetDashboardStats(orgID uint, today, tomorrow time.Time) (EmailDashboardStats, error) {
	yesterday := today.AddDate(0, 0, -1)

	var stats EmailDashboardStats
	query := r.db.Model(&models.Email{}).Select(
		`COUNT(*) AS total_emails,
		COALESCE(SUM(CASE WHEN flags NOT LIKE ? THEN 1 ELSE 0 END), 0) AS unread_emails,
		COALESCE(SUM(CASE WHEN date >= ? AND date < ? THEN 1 ELSE 0 END), 0) AS today_emails,
		COALESCE(SUM(CASE WHEN date >= ? AND date < ? THEN 1 ELSE 0 END), 0) AS yesterday_emails,
		COALESCE(SUM(CASE WHEN date < ? THEN 1 ELSE 0 END), 0) AS emails_until_yesterday`,
		"%\"\\\\Seen\"%",
		today,
		tomorrow,
		yesterday,
		today,
		today,
	)
	if orgID > 0 {
		query = query.Where("account_id IN (?)", r.db.Model(&models.EmailAccount{}).Select("id").Where("org_id = ?", orgID))
	}

	err := query.Scan(&stats).Error
	return stats, err
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
	OrgID              uint // Filter emails by organization (via account)
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

func (r *EmailRepository) buildEmailSearchQuery(options EmailSearchOptions) *gorm.DB {
	query := r.db.Model(&models.Email{})

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
		recipientSearchExpr, recipientSearchArgs := emailRecipientSearchExpr(r.db, options.Keyword)
		queryArgs := []interface{}{keywordPattern, keywordPattern}
		queryArgs = append(queryArgs, recipientSearchArgs...)
		queryArgs = append(queryArgs, keywordPattern, keywordPattern, keywordPattern)
		query = query.Where(
			fmt.Sprintf(
				"subject LIKE ? OR %s OR %s OR %s OR body LIKE ? OR html_body LIKE ?",
				textLikeExpr(r.db, "from"),
				recipientSearchExpr,
				textLikeExpr(r.db, "cc"),
			),
			queryArgs...,
		)
	} else {
		// Individual field searches
		if options.FromQuery != "" {
			fromPattern := "%" + options.FromQuery + "%"
			query = query.Where(textLikeExpr(r.db, "from"), fromPattern)
		}
		if options.ToQuery != "" {
			recipientSearchExpr, recipientSearchArgs := emailRecipientSearchExpr(r.db, options.ToQuery)
			query = query.Where(recipientSearchExpr, recipientSearchArgs...)
		}
		if options.CcQuery != "" {
			ccPattern := "%" + options.CcQuery + "%"
			query = query.Where(textLikeExpr(r.db, "cc"), ccPattern)
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

	return query
}

// SearchEmails performs advanced search on emails with multiple criteria
func (r *EmailRepository) SearchEmails(options EmailSearchOptions) ([]models.Email, int64, error) {
	var emails []models.Email
	var totalCount int64

	query := r.buildEmailSearchQuery(options)

	// Preload attachments if requested
	if options.PreloadAttachments {
		query = query.Preload("Attachments")
	}

	// Get total count for pagination
	countQuery := query
	err := countQuery.Count(&totalCount).Error
	if err != nil {
		return nil, 0, err
	}

	// Apply sorting
	query = query.Order(buildEmailOrderClause(r.db, options.SortBy, false))

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

	query := r.buildEmailSearchQuery(options).Order(buildEmailOrderClause(r.db, options.SortBy, true))

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
		Order(buildEmailOrderClause(r.db, "date DESC", false)).
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
