package api

import (
	"mailman/internal/models"
	"time"
)

// FetchEmailsRequest represents the request body for the /fetch-emails endpoint
// @Description Request body for fetching emails with enhanced filtering capabilities and smart email matching. Supports Gmail aliases (dots, plus signs, googlemail.com) and domain mail forwarding.
type FetchEmailsRequest struct {
	// Email address of the account. Supports Gmail aliases (john.doe+work@gmail.com will match johndoe@gmail.com) and domain mail (any@company.com will match domain mail account for company.com)
	EmailAddress string `json:"email_address,omitempty" example:"john.doe+work@gmail.com"`
	// ID of the account
	AccountID uint `json:"account_id,omitempty" example:"1"`
	// Mailbox name to fetch emails from (default: "INBOX")
	Mailbox string `json:"mailbox,omitempty" example:"INBOX"`
	// Maximum number of emails to fetch (default: 10, max: 100)
	Limit int `json:"limit,omitempty" example:"10"`
	// Number of emails to skip (for pagination)
	Offset int `json:"offset,omitempty" example:"0"`
	// Start date for date range filtering (RFC3339 format)
	StartDate string `json:"start_date,omitempty" example:"2024-01-01T00:00:00Z"`
	// End date for date range filtering (RFC3339 format)
	EndDate string `json:"end_date,omitempty" example:"2024-12-31T23:59:59Z"`
	// Search query for subject or sender (legacy parameter)
	SearchQuery string `json:"search_query,omitempty" example:"important"`
	// Whether to fetch from IMAP server or local database (default: false - from database)
	FetchFromServer bool `json:"fetch_from_server,omitempty" example:"false"`
	// Include email body content (default: false for performance)
	IncludeBody bool `json:"include_body,omitempty" example:"false"`
	// Sort order: "date_desc", "date_asc", "subject_asc", "subject_desc" (default: "date_desc")
	SortBy string `json:"sort_by,omitempty" example:"date_desc"`

	// Enhanced filtering parameters (inspired by Outlook Graph API and IMAP)
	// Filter by sender email address or name
	FromFilter string `json:"from_filter,omitempty" example:"john@example.com"`
	// Filter by recipient email address or name
	ToFilter string `json:"to_filter,omitempty" example:"jane@example.com"`
	// Filter by CC recipient email address or name
	CcFilter string `json:"cc_filter,omitempty" example:"manager@example.com"`
	// Filter by subject content
	SubjectFilter string `json:"subject_filter,omitempty" example:"meeting"`
	// Filter by email body content
	BodyFilter string `json:"body_filter,omitempty" example:"project update"`
	// Global keyword search across all text fields
	Keyword string `json:"keyword,omitempty" example:"urgent"`

	// Message flags filtering (IMAP flags)
	HasAttachments *bool `json:"has_attachments,omitempty" example:"true"`
	IsRead         *bool `json:"is_read,omitempty" example:"false"`
	IsFlagged      *bool `json:"is_flagged,omitempty" example:"true"`
	IsImportant    *bool `json:"is_important,omitempty" example:"true"`
	IsDraft        *bool `json:"is_draft,omitempty" example:"false"`

	// Size filtering
	MinSize *int64 `json:"min_size,omitempty" example:"1024"`
	MaxSize *int64 `json:"max_size,omitempty" example:"10485760"`

	// Advanced IMAP search criteria
	MessageID string `json:"message_id,omitempty" example:"<message-id@example.com>"`
	ThreadID  string `json:"thread_id,omitempty" example:"thread-123"`

	// Outlook-specific filters
	Categories  []string `json:"categories,omitempty" example:"[\"Work\", \"Important\"]"`
	Sensitivity string   `json:"sensitivity,omitempty" example:"normal"` // normal, personal, private, confidential

	// Date-based filters (more granular than start/end date)
	ReceivedAfter  string `json:"received_after,omitempty" example:"2024-01-01T00:00:00Z"`
	ReceivedBefore string `json:"received_before,omitempty" example:"2024-12-31T23:59:59Z"`
	SentAfter      string `json:"sent_after,omitempty" example:"2024-01-01T00:00:00Z"`
	SentBefore     string `json:"sent_before,omitempty" example:"2024-12-31T23:59:59Z"`

	// Response format options
	IncludeAttachments bool     `json:"include_attachments,omitempty" example:"false"`
	IncludeHeaders     bool     `json:"include_headers,omitempty" example:"false"`
	FieldsToInclude    []string `json:"fields_to_include,omitempty" example:"[\"id\", \"subject\", \"from\", \"date\"]"`

	// Pagination and performance
	PageToken  string `json:"page_token,omitempty" example:"eyJvZmZzZXQiOjEwfQ=="`
	MaxResults int    `json:"max_results,omitempty" example:"50"` // Alternative to limit

	// IMAP-specific options
	UseUID    bool   `json:"use_uid,omitempty" example:"true"`              // Use UID instead of sequence numbers
	SyncState string `json:"sync_state,omitempty" example:"sync-token-123"` // For incremental sync
}

// UpdateAccountRequest represents the request body for updating an email account
// @Description Request body for updating an email account (partial update supported)
type UpdateAccountRequest struct {
	EmailAddress         *string                    `json:"emailAddress,omitempty"`
	AuthType             *models.AuthType           `json:"authType,omitempty"`
	Password             *string                    `json:"password,omitempty"`
	Token                *string                    `json:"token,omitempty"`
	MailProviderID       *uint                      `json:"mailProviderId,omitempty"`
	OAuth2ProviderID     *uint                      `json:"oauth2ProviderId,omitempty"`
	Proxy                *string                    `json:"proxy,omitempty"`
	ProxyMode            *models.ProxyAccountMode   `json:"proxyMode,omitempty"`
	ProxyID              *uint                      `json:"proxyId,omitempty"`
	ProxyFallbackMode    *models.ProxyFallbackMode  `json:"proxyFallbackMode,omitempty"`
	ProxyFallbackProxyID *uint                      `json:"proxyFallbackProxyId,omitempty"`
	ProxyFallbackProxy   *string                    `json:"proxyFallbackProxy,omitempty"`
	ProxyMatchGroupIDs   *models.UintSlice          `json:"proxyMatchGroupIds,omitempty"`
	ProxyMatchTagIDs     *models.UintSlice          `json:"proxyMatchTagIds,omitempty"`
	ProxyMatchTagMode    *models.ProxyTagFilterMode `json:"proxyMatchTagMode,omitempty"`
	IsDomainMail         *bool                      `json:"isDomainMail,omitempty"`
	Domain               *string                    `json:"domain,omitempty"`
	Note                 *string                    `json:"note,omitempty"`
	NoteFormat           *models.AccountNoteFormat  `json:"noteFormat,omitempty"`
	CustomSettings       *models.JSONMap            `json:"customSettings,omitempty"`
	LastSyncAt           *time.Time                 `json:"lastSyncAt,omitempty"`
}

// CreateAccountRequest represents the request body for creating an email account
// @Description Request body for creating an email account
type CreateAccountRequest struct {
	EmailAddress         string                    `json:"emailAddress" binding:"required"`
	AuthType             models.AuthType           `json:"authType" binding:"required"`
	Password             string                    `json:"password,omitempty"`
	Token                string                    `json:"token,omitempty"`
	MailProviderID       *uint                     `json:"mailProviderId,omitempty"`   // Make optional - only required for accounts that need predefined providers
	OAuth2ProviderID     *uint                     `json:"oauth2ProviderId,omitempty"` // 关联特定的OAuth2配置
	Proxy                string                    `json:"proxy,omitempty"`
	ProxyMode            models.ProxyAccountMode   `json:"proxyMode,omitempty"`
	ProxyID              *uint                     `json:"proxyId,omitempty"`
	ProxyFallbackMode    models.ProxyFallbackMode  `json:"proxyFallbackMode,omitempty"`
	ProxyFallbackProxyID *uint                     `json:"proxyFallbackProxyId,omitempty"`
	ProxyFallbackProxy   string                    `json:"proxyFallbackProxy,omitempty"`
	ProxyMatchGroupIDs   models.UintSlice          `json:"proxyMatchGroupIds,omitempty"`
	ProxyMatchTagIDs     models.UintSlice          `json:"proxyMatchTagIds,omitempty"`
	ProxyMatchTagMode    models.ProxyTagFilterMode `json:"proxyMatchTagMode,omitempty"`
	IsDomainMail         bool                      `json:"isDomainMail"`
	Domain               string                    `json:"domain,omitempty"`
	Note                 string                    `json:"note,omitempty"`
	NoteFormat           models.AccountNoteFormat  `json:"noteFormat,omitempty"`
	CustomSettings       models.JSONMap            `json:"customSettings,omitempty"`
}

// CreateProviderRequest represents the request body for creating a custom mail provider
// @Description Request body for creating a custom mail provider
type CreateProviderRequest struct {
	Name       string `json:"name" binding:"required"`
	IMAPServer string `json:"imapServer" binding:"required"`
	IMAPPort   int    `json:"imapPort" binding:"required"`
	SMTPServer string `json:"smtpServer,omitempty"`
	SMTPPort   int    `json:"smtpPort,omitempty"`
}

// EmailSearchRequest represents the request parameters for the /emails endpoint
// @Description Request parameters for searching emails with pagination and filters
type EmailSearchRequest struct {
	// Page number (starting from 1)
	Page int `json:"page,omitempty" form:"page" example:"1"`
	// Number of items per page (default: 20, max: 100)
	PageSize int `json:"page_size,omitempty" form:"page_size" example:"20"`
	// Start date for date range filtering (RFC3339 format)
	StartDate string `json:"start_date,omitempty" form:"start_date" example:"2024-01-01T00:00:00Z"`
	// End date for date range filtering (RFC3339 format)
	EndDate string `json:"end_date,omitempty" form:"end_date" example:"2024-12-31T23:59:59Z"`
	// Fuzzy search in sender field
	FromQuery string `json:"from_query,omitempty" form:"from_query" example:"john@example.com"`
	// Fuzzy search in recipient field
	ToQuery string `json:"to_query,omitempty" form:"to_query" example:"jane@example.com"`
	// Fuzzy search in CC field
	CcQuery string `json:"cc_query,omitempty" form:"cc_query" example:"manager@example.com"`
	// Fuzzy search in subject field
	SubjectQuery string `json:"subject_query,omitempty" form:"subject_query" example:"meeting"`
	// Fuzzy search in email body
	BodyQuery string `json:"body_query,omitempty" form:"body_query" example:"important"`
	// Global keyword search (searches in from, to, cc, subject, body)
	Keyword string `json:"keyword,omitempty" form:"keyword" example:"project"`
	// Sort order: "date_desc", "date_asc", "subject_asc", "subject_desc" (default: "date_desc")
	SortBy string `json:"sort_by,omitempty" form:"sort_by" example:"date_desc"`
	// Specific account ID to filter by (optional)
	AccountID uint `json:"account_id,omitempty" form:"account_id" example:"1"`
	// Mailbox name to filter by (optional)
	Mailbox string `json:"mailbox,omitempty" form:"mailbox" example:"INBOX"`
}

// EmailSearchResponse represents the response for the /emails endpoint
// @Description Response for email search with pagination
type EmailSearchResponse struct {
	// List of emails
	Emails []models.Email `json:"emails"`
	// Pagination information
	Pagination PaginationInfo `json:"pagination"`
}

// PaginationInfo contains pagination metadata
// @Description Pagination metadata
type PaginationInfo struct {
	// Current page number
	Page int `json:"page"`
	// Number of items per page
	PageSize int `json:"page_size"`
	// Total number of items
	Total int64 `json:"total"`
	// Total number of pages
	TotalPages int `json:"total_pages"`
	// Whether there is a next page
	HasNext bool `json:"has_next"`
	// Whether there is a previous page
	HasPrev bool `json:"has_prev"`
}

// ExtractorConfig defines the configuration for content extraction
// @Description Configuration for email content extraction
type ExtractorConfig struct {
	// Field to extract from: ALL, from, to, cc, subject, body, html_body, headers
	Field string `json:"field" binding:"required" example:"subject"`
	// Type of extraction: regex, js, gotemplate
	Type string `json:"type" binding:"required" example:"regex"`
	// Optional match configuration (returns {matched: boolean, reason?: string})
	Match *string `json:"match,omitempty" example:"return {matched: content.includes('invoice'), reason: 'No invoice keyword found'}"`
	// Extract configuration (returns string or null)
	Extract string `json:"extract" binding:"required" example:"Invoice #(\\d+)"`
}

// ExtractEmailsRequest represents the request body for the /extract-emails endpoint
// @Description Request body for extracting content from emails with advanced filtering
type ExtractEmailsRequest struct {
	// All search parameters from EmailSearchOptions
	// Time range filters
	StartDate *string `json:"start_date,omitempty" example:"2024-01-01T00:00:00Z"`
	EndDate   *string `json:"end_date,omitempty" example:"2024-12-31T23:59:59Z"`

	// Text search filters
	FromQuery    string `json:"from_query,omitempty" example:"john@example.com"`
	ToQuery      string `json:"to_query,omitempty" example:"jane@example.com"`
	CcQuery      string `json:"cc_query,omitempty" example:"manager@example.com"`
	SubjectQuery string `json:"subject_query,omitempty" example:"meeting"`
	BodyQuery    string `json:"body_query,omitempty" example:"important"`
	HTMLQuery    string `json:"html_query,omitempty" example:"<b>urgent</b>"`
	Keyword      string `json:"keyword,omitempty" example:"project"`

	// Mailbox filter
	MailboxName string `json:"mailbox,omitempty" example:"INBOX"`

	// Pagination and sorting
	Limit  int    `json:"limit,omitempty" example:"100"`
	Offset int    `json:"offset,omitempty" example:"0"`
	SortBy string `json:"sort_by,omitempty" example:"date DESC"`

	// Extraction configurations
	Extractors []ExtractorConfig `json:"extractors,omitempty"`

	// Extractor template ID (if provided, will be merged with extractors)
	ExtractorID *uint `json:"extractor_id,omitempty" example:"1"`

	// Processing options
	BatchSize int `json:"batch_size,omitempty" example:"50"`
}

// CreateExtractorTemplateRequest represents the request body for creating an extractor template
// @Description Request body for creating a new extractor template
type CreateExtractorTemplateRequest struct {
	Name        string            `json:"name" binding:"required" example:"Invoice Extractor"`
	Description string            `json:"description,omitempty" example:"Extracts invoice numbers and amounts"`
	Extractors  []ExtractorConfig `json:"extractors" binding:"required,min=1"`
}

// TestExtractorTemplateRequest represents the request body for testing an extractor template
// @Description Request body for testing an extractor template
type TestExtractorTemplateRequest struct {
	// Either EmailID or CustomEmail must be provided
	EmailID     *uint                  `json:"email_id,omitempty" example:"123"`
	CustomEmail *CustomEmailForTesting `json:"custom_email,omitempty"`
	// Optional: specific extractors to test (if not provided, uses template extractors)
	Extractors []ExtractorConfig `json:"extractors,omitempty"`
}

// CustomEmailForTesting represents custom email content for testing
// @Description Custom email content for testing extractors
type CustomEmailForTesting struct {
	From     string `json:"from" example:"sender@example.com"`
	To       string `json:"to" example:"receiver@example.com"`
	Cc       string `json:"cc,omitempty" example:"cc@example.com"`
	Subject  string `json:"subject" example:"Test Email Subject"`
	Body     string `json:"body" example:"This is the email body content"`
	HTMLBody string `json:"html_body,omitempty" example:"<p>This is the HTML body</p>"`
}

// TestExtractorResult represents the result of testing a single extractor
// @Description Result of testing a single extractor
type TestExtractorResult struct {
	Field  string  `json:"field" example:"subject"`
	Type   string  `json:"type" example:"regex"`
	Result *string `json:"result" example:"extracted value"`
	Error  string  `json:"error,omitempty" example:"extraction failed: invalid regex"`
}

// TestExtractorTemplateResponse represents the response for testing an extractor template
// @Description Response for testing an extractor template
type TestExtractorTemplateResponse struct {
	TemplateID   uint                  `json:"template_id" example:"1"`
	TemplateName string                `json:"template_name" example:"Invoice Extractor"`
	Results      []TestExtractorResult `json:"results"`
}

// UpdateExtractorTemplateRequest represents the request body for updating an extractor template
// @Description Request body for updating an existing extractor template
type UpdateExtractorTemplateRequest struct {
	Name        string            `json:"name,omitempty" example:"Updated Invoice Extractor"`
	Description string            `json:"description,omitempty" example:"Updated description"`
	Extractors  []ExtractorConfig `json:"extractors,omitempty"`
}

// ExtractorTemplateResponse represents an extractor template in API responses
// @Description Extractor template information
type ExtractorTemplateResponse struct {
	ID          uint              `json:"id" example:"1"`
	Name        string            `json:"name" example:"Invoice Extractor"`
	Description string            `json:"description,omitempty" example:"Extracts invoice numbers and amounts"`
	Extractors  []ExtractorConfig `json:"extractors"`
	CreatedAt   time.Time         `json:"created_at" example:"2024-01-01T00:00:00Z"`
	UpdatedAt   time.Time         `json:"updated_at" example:"2024-01-01T00:00:00Z"`
}

// PaginatedExtractorTemplatesResponse represents a paginated response for extractor templates
// @Description Paginated response for extractor templates
type PaginatedExtractorTemplatesResponse struct {
	Data       []ExtractorTemplateResponse `json:"data"`
	Total      int64                       `json:"total"`
	Page       int                         `json:"page"`
	Limit      int                         `json:"limit"`
	TotalPages int                         `json:"total_pages"`
}

// ExtractorResult represents the result of an extraction operation
// @Description Result of email content extraction
type ExtractorResult struct {
	// The email that matched the extraction criteria
	Email models.Email `json:"email"`
	// Array of extracted content matches
	Matches []string `json:"matches"`
}

// PaginatedAccountsResponse represents a paginated response for email accounts
// @Description Paginated response for email accounts
type PaginatedAccountsResponse struct {
	Data       []models.EmailAccount `json:"data"`
	Total      int64                 `json:"total"`
	Page       int                   `json:"page"`
	Limit      int                   `json:"limit"`
	TotalPages int                   `json:"total_pages"`
}

// ExtractEmailsResponse represents the response for the /extract-emails endpoint
// @Description Response for email content extraction
type ExtractEmailsResponse struct {
	// Array of extraction results
	Results []ExtractorResult `json:"results"`
	// Total number of emails processed
	TotalProcessed int `json:"total_processed"`
	// Total number of emails that matched extraction criteria
	TotalMatched int `json:"total_matched"`
	// Processing summary
	Summary ExtractSummary `json:"summary"`
}

// ExtractSummary provides summary information about the extraction process
// @Description Summary of the extraction process
type ExtractSummary struct {
	// Time taken for the extraction process
	ProcessingTimeMs int64 `json:"processing_time_ms"`
	// Number of batches processed
	BatchesProcessed int `json:"batches_processed"`
	// Average processing time per email in milliseconds
	AvgTimePerEmail float64 `json:"avg_time_per_email_ms"`
	// Extraction statistics per extractor
	ExtractorStats []ExtractorStats `json:"extractor_stats"`
}

// ExtractorStats provides statistics for individual extractors
// @Description Statistics for individual extractors
type ExtractorStats struct {
	// Extractor configuration
	Config ExtractorConfig `json:"config"`
	// Number of emails that matched this extractor
	MatchCount int `json:"match_count"`
	// Total number of matches found by this extractor
	TotalMatches int `json:"total_matches"`
	// Average matches per email for this extractor
	AvgMatchesPerEmail float64 `json:"avg_matches_per_email"`
}

// FetchAndStoreRequest represents the request body for the /accounts/{id}/fetch endpoint
// @Description Request body for fetching and storing emails with sync options
type FetchAndStoreRequest struct {
	// Sync mode: "full" for full sync, "incremental" for incremental sync (default: "incremental")
	SyncMode string `json:"sync_mode,omitempty" example:"incremental"`
	// Mailbox names to sync (default: ["INBOX"])
	Mailboxes []string `json:"mailboxes,omitempty" example:"[\"INBOX\", \"Sent\"]"`
	// Start date for sync range when no previous sync record exists (RFC3339 format, default: 1 month ago)
	DefaultStartDate *string `json:"default_start_date,omitempty" example:"2024-01-01T00:00:00Z"`
	// End date for sync range (RFC3339 format, default: now)
	EndDate *string `json:"end_date,omitempty" example:"2024-12-31T23:59:59Z"`
	// Maximum number of emails to process per mailbox (default: 1000)
	MaxEmailsPerMailbox int `json:"max_emails_per_mailbox,omitempty" example:"1000"`
	// Whether to include email body content (default: true)
	IncludeBody bool `json:"include_body,omitempty" example:"true"`
}

// FetchAndStoreResponse represents the response for the /accounts/{id}/fetch endpoint
// @Description Response for fetch and store operation
type FetchAndStoreResponse struct {
	// Operation status
	Status string `json:"status" example:"success"`
	// Sync mode used
	SyncMode string `json:"sync_mode" example:"incremental"`
	// Results per mailbox
	MailboxResults []MailboxSyncResult `json:"mailbox_results"`
	// Total emails processed across all mailboxes
	TotalEmailsProcessed int `json:"total_emails_processed"`
	// Total new emails stored
	TotalNewEmails int `json:"total_new_emails"`
	// Processing time in milliseconds
	ProcessingTimeMs int64 `json:"processing_time_ms"`
	// Any warnings or messages
	Messages []string `json:"messages,omitempty"`
}

// MailboxSyncResult represents the sync result for a single mailbox
// @Description Sync result for a single mailbox
type MailboxSyncResult struct {
	// Mailbox name
	MailboxName string `json:"mailbox_name" example:"INBOX"`
	// Number of emails processed
	EmailsProcessed int `json:"emails_processed" example:"150"`
	// Number of new emails stored
	NewEmails int `json:"new_emails" example:"25"`
	// Sync start time
	SyncStartTime time.Time `json:"sync_start_time"`
	// Sync end time
	SyncEndTime time.Time `json:"sync_end_time"`
	// Previous sync end time (for incremental sync)
	PreviousSyncEndTime *time.Time `json:"previous_sync_end_time,omitempty"`
	// Any errors encountered
	Error string `json:"error,omitempty"`
}

// RandomEmailRequest represents the request parameters for the /random-email endpoint
// @Description Request parameters for getting a random email account
type RandomEmailRequest struct {
	// Whether to allow random alias emails (Gmail aliases)
	Alias bool `json:"alias,omitempty" form:"alias" example:"true"`
	// Whether to allow domain emails
	Domain bool `json:"domain,omitempty" form:"domain" example:"true"`
}

// RandomEmailResponse represents the response for the /random-email endpoint
// @Description Response containing a random email address
type RandomEmailResponse struct {
	// Status of the operation
	Status string `json:"status" example:"success"`
	// The generated or selected email address
	RawEmail string `json:"raw_email" example:"john.doe+random123@gmail.com"`
	// The generated email address (for alias/domain cases)
	Email string `json:"email,omitempty" example:"john.doe+random123@gmail.com"`
	// Type of email returned: "regular", "alias", "domain"
	EmailType string `json:"email_type" example:"alias"`
	// Message explaining the selection
	Message string `json:"message,omitempty" example:"Generated random Gmail alias"`
}

// WaitEmailRequest represents the request parameters for the /wait-email endpoint
// @Description Request parameters for waiting for emails to arrive
type WaitEmailRequest struct {
	// Account ID (mutually exclusive with Email)
	AccountID *uint `json:"account_id,omitempty" form:"account_id" example:"1"`
	// Email address (mutually exclusive with AccountID)
	Email *string `json:"email,omitempty" form:"email" example:"user@example.com"`
	// Timeout in seconds (default: 30)
	Timeout int `json:"timeout,omitempty" form:"timeout" example:"30"`
	// Interval for checking emails in seconds (default: 5)
	Interval int `json:"interval,omitempty" form:"interval" example:"5"`
	// Start time for filtering emails (default: current time)
	StartTime *string `json:"start_time,omitempty" form:"start_time" example:"2024-01-01T00:00:00Z"`
	// Extraction configurations (same as extract-emails endpoint)
	Extract []ExtractorConfig `json:"extract,omitempty"`
	// Strategy for ensuring sync is active: "none" (default), "ensure", "force"
	CreateStrategy string `json:"create_strategy,omitempty" example:"ensure"`
	// Interval for temporary sync in seconds (default: 30)
	SyncInterval int `json:"sync_interval,omitempty" example:"30"`
}

// WaitEmailResponse represents the response for the /wait-email endpoint
// @Description Response for waiting for emails
type WaitEmailResponse struct {
	// Status of the operation
	Status string `json:"status" example:"success"`
	// Whether an email was found
	Found bool `json:"found" example:"true"`
	// The found email (if any)
	Email *models.Email `json:"email,omitempty"`
	// Extracted content (if extractors were provided)
	Matches []string `json:"matches,omitempty"`
	// Time taken to find the email in seconds
	ElapsedTime float64 `json:"elapsed_time" example:"12.5"`
	// Number of checks performed
	ChecksPerformed int `json:"checks_performed" example:"3"`
	// Message explaining the result
	Message string `json:"message,omitempty" example:"Email found matching criteria"`
}

// ErrorResponse represents a standard error response
// @Description Standard error response format
type ErrorResponse struct {
	// Error message
	Error string `json:"error" example:"Invalid request"`
	// HTTP status code
	Code int `json:"code" example:"400"`
	// Additional details about the error (optional)
	Details string `json:"details,omitempty" example:"The email address format is invalid"`
}

// EmailDomainsResponse represents the response for email domains
type EmailDomainsResponse struct {
	Status  string   `json:"status"`
	Domains []string `json:"domains"`
	Count   int      `json:"count"`
}

// CheckEmailRequest represents the request for checking emails (for frontend polling)
// @Description Simple request for checking if new emails have arrived
type CheckEmailRequest struct {
	// Email address to check
	Email string `json:"email" example:"user@example.com"`
	// Start time for filtering emails (default: current time)
	StartTime *string `json:"start_time,omitempty" example:"2024-01-01T00:00:00Z"`
	// Extraction configurations (same as extract-emails endpoint)
	Extract []ExtractorConfig `json:"extract,omitempty"`
}

// CheckEmailResponse represents the response for checking emails
// @Description Response for checking emails (simplified for frontend polling)
type CheckEmailResponse struct {
	// Status of the operation
	Status string `json:"status" example:"success"`
	// Whether an email was found
	Found bool `json:"found" example:"true"`
	// The found email (if any)
	Email *models.Email `json:"email,omitempty"`
	// Extracted content (if extractors were provided)
	Matches []string `json:"matches,omitempty"`
	// Message describing the result
	Message string `json:"message" example:"Email found"`
	// Error details (if any)
	Error string `json:"error,omitempty"`
	// Resolved account information
	ResolvedAccount *AccountInfo `json:"resolved_account,omitempty"`
}

// AccountInfo represents basic account information
// @Description Basic account information for resolved email
type AccountInfo struct {
	// Account ID
	ID uint `json:"id" example:"1"`
	// Account email address
	EmailAddress string `json:"email_address" example:"user@example.com"`
	// Whether this is a domain email account
	IsDomainMail bool `json:"is_domain_mail" example:"false"`
	// Domain (if domain email)
	Domain string `json:"domain,omitempty" example:"example.com"`
}

// CreateSubscriptionRequest represents the request body for creating a subscription
// @Description Request body for creating an email subscription
type CreateSubscriptionRequest struct {
	// Email account ID to subscribe to
	AccountID uint `json:"account_id" binding:"required" example:"1"`
	// Mailbox to monitor (default: "INBOX")
	Mailbox string `json:"mailbox,omitempty" example:"INBOX"`
	// Polling interval in seconds (default: 60, min: 30)
	PollingInterval int `json:"polling_interval,omitempty" example:"60"`
	// Whether to include email body in notifications (default: false)
	IncludeBody bool `json:"include_body,omitempty" example:"false"`
	// Optional filters for the subscription
	Filters *SubscriptionFilters `json:"filters,omitempty"`
}

// SubscriptionFilters represents optional filters for a subscription
// @Description Optional filters for email subscription
type SubscriptionFilters struct {
	// Filter by sender
	FromFilter string `json:"from_filter,omitempty" example:"important@example.com"`
	// Filter by subject
	SubjectFilter string `json:"subject_filter,omitempty" example:"urgent"`
	// Filter by keywords in body
	KeywordFilter string `json:"keyword_filter,omitempty" example:"invoice"`
}

// SubscriptionResponse represents a subscription in API responses
// @Description Email subscription information
type SubscriptionResponse struct {
	// Subscription ID
	ID string `json:"id" example:"sub_123456"`
	// Email account ID
	AccountID uint `json:"account_id" example:"1"`
	// Email address
	EmailAddress string `json:"email_address" example:"user@example.com"`
	// Monitored mailbox
	Mailbox string `json:"mailbox" example:"INBOX"`
	// Polling interval in seconds
	PollingInterval int `json:"polling_interval" example:"60"`
	// Whether email body is included
	IncludeBody bool `json:"include_body" example:"false"`
	// Subscription filters
	Filters *SubscriptionFilters `json:"filters,omitempty"`
	// Subscription status
	Status string `json:"status" example:"active"`
	// Creation time
	CreatedAt time.Time `json:"created_at" example:"2024-01-01T00:00:00Z"`
	// Last check time
	LastCheckedAt *time.Time `json:"last_checked_at,omitempty" example:"2024-01-01T00:05:00Z"`
	// Next scheduled check
	NextCheckAt *time.Time `json:"next_check_at,omitempty" example:"2024-01-01T00:06:00Z"`
}

// SubscriptionListResponse represents a list of subscriptions
// @Description List of email subscriptions
type SubscriptionListResponse struct {
	// List of subscriptions
	Subscriptions []SubscriptionResponse `json:"subscriptions"`
	// Total count
	Total int `json:"total" example:"5"`
}

// CacheStatsResponse represents cache statistics
// @Description Email cache statistics
type CacheStatsResponse struct {
	// Total number of cached emails
	TotalEmails int `json:"total_emails" example:"1500"`
	// Total cache size in bytes
	TotalSize int64 `json:"total_size" example:"15728640"`
	// Cache size by account
	AccountStats []AccountCacheStats `json:"account_stats"`
	// Cache hit rate
	HitRate float64 `json:"hit_rate" example:"0.85"`
	// Last cleanup time
	LastCleanup *time.Time `json:"last_cleanup,omitempty"`
}

// AccountCacheStats represents cache statistics for a single account
// @Description Cache statistics for a single email account
type AccountCacheStats struct {
	// Account ID
	AccountID uint `json:"account_id" example:"1"`
	// Email address
	EmailAddress string `json:"email_address" example:"user@example.com"`
	// Number of cached emails
	EmailCount int `json:"email_count" example:"250"`
	// Cache size in bytes
	CacheSize int64 `json:"cache_size" example:"2621440"`
	// Oldest cached email date
	OldestEmail *time.Time `json:"oldest_email,omitempty"`
	// Newest cached email date
	NewestEmail *time.Time `json:"newest_email,omitempty"`
}

// FetchNowRequest represents the request to immediately fetch emails
// @Description Request to immediately fetch emails for a subscription
type FetchNowRequest struct {
	// Subscription ID (optional, will fetch for all if not provided)
	SubscriptionID string `json:"subscription_id,omitempty" example:"sub_123456"`
	// Account ID (optional, alternative to subscription_id)
	AccountID uint `json:"account_id,omitempty" example:"1"`
	// Force refresh even if recently checked
	ForceRefresh bool `json:"force_refresh,omitempty" example:"true"`
}

// FetchNowResponse represents the response for immediate fetch
// @Description Response for immediate email fetch
type FetchNowResponse struct {
	// Status of the operation
	Status string `json:"status" example:"success"`
	// Number of new emails fetched
	NewEmails int `json:"new_emails" example:"5"`
	// Total emails processed
	TotalProcessed int `json:"total_processed" example:"50"`
	// Processing time in milliseconds
	ProcessingTimeMs int64 `json:"processing_time_ms" example:"1250"`
	// Any error messages
	Errors []string `json:"errors,omitempty"`
}
