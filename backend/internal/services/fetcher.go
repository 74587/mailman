package services

import (
	"bufio"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"golang.org/x/net/proxy"
	"gorm.io/gorm"
)

// FetcherService is responsible for fetching emails from an IMAP server.
type FetcherService struct {
	accountRepo   *repository.EmailAccountRepository
	emailRepo     *repository.EmailRepository
	parserService *ParserService
	oauth2Service *OAuth2Service
	ingestService *EmailIngestService
	logger        *utils.Logger
}

// FetchEmailsOptions contains options for fetching emails
type FetchEmailsOptions struct {
	Mailbox         string
	Limit           int
	Offset          int
	StartDate       *time.Time
	EndDate         *time.Time
	SearchQuery     string
	FetchFromServer bool
	IncludeBody     bool
	SortBy          string
	Folders         []string // List of folders to fetch from
}

// SetEmailIngestService connects fetch-and-store helpers to the unified ingest pipeline.
func (s *FetcherService) SetEmailIngestService(ingestService *EmailIngestService) {
	if ingestService != nil {
		s.ingestService = ingestService
	}
}

// NewFetcherService creates a new FetcherService.
func NewFetcherService(accountRepo *repository.EmailAccountRepository, emailRepo *repository.EmailRepository, db *gorm.DB) *FetcherService {
	return &FetcherService{
		accountRepo:   accountRepo,
		emailRepo:     emailRepo,
		parserService: NewParserService(),
		oauth2Service: NewOAuth2Service(db),
		logger:        utils.NewLogger("FetcherService"),
	}
}

// FetchEmails fetches emails for a given account with default options.
func (s *FetcherService) FetchEmails(account models.EmailAccount) ([]models.Email, error) {
	DecryptAccountCredentials(&account.Password, &account.Token)
	s.logger.Debug("FetchEmails called for account %s", account.EmailAddress)
	return s.FetchEmailsWithOptions(account, FetchEmailsOptions{
		Mailbox:         "INBOX",
		Limit:           10,
		FetchFromServer: true,
		IncludeBody:     true,
		SortBy:          "date_desc",
	})
}

// FetchEmailsWithOptions fetches emails for a given account with specified options.
func (s *FetcherService) FetchEmailsWithOptions(account models.EmailAccount, options FetchEmailsOptions) ([]models.Email, error) {
	DecryptAccountCredentials(&account.Password, &account.Token)
	s.logger.Info("FetchEmailsWithOptions called for account %s, mailbox: %s, limit: %d, fetchFromServer: %v",
		account.EmailAddress, options.Mailbox, options.Limit, options.FetchFromServer)

	// If not fetching from server, use database queries
	if !options.FetchFromServer {
		s.logger.Debug("Fetching emails from database for account %d", account.ID)
		return s.fetchEmailsFromDatabase(account.ID, options)
	}

	// Fetch from IMAP server
	s.logger.Debug("Fetching emails from IMAP server for account %s", account.EmailAddress)
	return s.fetchEmailsFromServer(account, options)
}

// FetchEmailsFromMultipleMailboxes fetches emails from multiple mailboxes based on user selection
func (s *FetcherService) FetchEmailsFromMultipleMailboxes(account models.EmailAccount, options FetchEmailsOptions) ([]models.Email, error) {
	DecryptAccountCredentials(&account.Password, &account.Token)
	s.logger.Debug("Starting to fetch emails from multiple mailboxes for %s", account.EmailAddress)
	if options.StartDate != nil {
		s.logger.Debug("Filter StartDate: %s", options.StartDate.Format(time.RFC3339))
	}

	// 检查是否应该使用Gmail API
	if s.shouldUseGmailAPI(account) {
		// Gmail账户：使用统一的Gmail API同步方法
		s.logger.Debug("Detected Gmail account, using unified Gmail API sync")

		// 为Gmail账户移除日期过滤器，让Gmail History API自己处理增量同步
		gmailOptions := options
		gmailOptions.StartDate = nil

		// 直接调用Gmail API统一同步方法
		return s.fetchEmailsFromGmailAPI(account, gmailOptions)
	}

	// 检查是否应该使用Outlook Graph API
	if s.shouldUseOutlookGraphAPI(account) {
		// Outlook账户：使用统一的Graph API同步方法
		s.logger.Debug("Detected Outlook account, using unified Outlook Graph API sync")

		// 直接调用Outlook Graph API同步方法
		return s.fetchEmailsFromOutlookGraphAPI(account, options)
	}

	// 非Gmail/Outlook OAuth2账户：使用传统的按文件夹分别同步方法
	s.logger.Info("Non-OAuth2 API account, using traditional folder-by-folder sync")

	var emails []models.Email

	// Check if specific folders are provided in options
	if len(options.Folders) > 0 {
		// Fetch from user-selected folders
		s.logger.Debug("Fetching from user-selected folders: %v", options.Folders)
		for _, folder := range options.Folders {
			folderOptions := options
			folderOptions.Mailbox = folder

			s.logger.Debug("Fetching from folder: %s", folder)
			folderEmails, err := s.FetchEmailsWithOptions(account, folderOptions)
			if err != nil {
				s.logger.Error("Error fetching from folder %s: %v", folder, err)
				// Continue with other folders even if one fails
				continue
			}

			emails = append(emails, folderEmails...)
			s.logger.Info("Successfully fetched %d emails from %s", len(folderEmails), folder)
		}
	} else {
		// Fallback to fetching from the primary mailbox only
		s.logger.Debug("No specific folders provided, fetching from primary mailbox: %s", options.Mailbox)
		primaryEmails, err := s.FetchEmailsWithOptions(account, options)
		if err != nil {
			s.logger.Error("Error fetching from primary mailbox: %v", err)
			return nil, err
		}
		emails = primaryEmails
		s.logger.Info("Successfully fetched %d emails from primary mailbox", len(emails))
	}

	// Remove duplicates and apply date filter
	uniqueEmails := make(map[string]models.Email)
	filteredCount := 0

	for _, email := range emails {
		// Apply date filter if specified
		if options.StartDate != nil {
			// 确保两个时间都使用 UTC 进行比较
			emailDateUTC := email.Date.UTC()
			startDateUTC := options.StartDate.UTC()

			if emailDateUTC.Before(startDateUTC) {
				s.logger.Debug("Filtering out email - Subject: '%s', Date: %s (UTC) is before StartDate: %s (UTC)",
					email.Subject,
					emailDateUTC.Format(time.RFC3339),
					startDateUTC.Format(time.RFC3339))
				filteredCount++
				continue
			}

			// Log emails that pass the filter for debugging
			s.logger.Debug("Email passed date filter - Subject: '%s', Date: %s (UTC) >= StartDate: %s (UTC)",
				email.Subject,
				emailDateUTC.Format(time.RFC3339),
				startDateUTC.Format(time.RFC3339))
		}

		// Use MessageID as unique key, fallback to Subject+Date if MessageID is empty
		key := email.MessageID
		if key == "" {
			key = fmt.Sprintf("%s_%s", email.Subject, email.Date.Format(time.RFC3339))
		}
		uniqueEmails[key] = email
	}

	// Convert map back to slice
	result := make([]models.Email, 0, len(uniqueEmails))
	for _, email := range uniqueEmails {
		result = append(result, email)
	}

	// Sort by date (newest first)
	if len(result) > 1 {
		for i := 0; i < len(result)-1; i++ {
			for j := i + 1; j < len(result); j++ {
				if result[i].Date.Before(result[j].Date) {
					result[i], result[j] = result[j], result[i]
				}
			}
		}
	}

	s.logger.Info("Total emails fetched from all mailboxes: %d, filtered out: %d, unique emails: %d",
		len(emails), filteredCount, len(result))

	return result, nil
}

// fetchEmailsFromDatabase fetches emails from the local database
func (s *FetcherService) fetchEmailsFromDatabase(accountID uint, options FetchEmailsOptions) ([]models.Email, error) {
	s.logger.Debug("Fetching emails from database with options: %+v", options)

	// Convert sort option to SQL order clause
	sortClause := s.convertSortOption(options.SortBy)

	// Handle date range filtering
	if options.StartDate != nil && options.EndDate != nil {
		s.logger.Debug("Fetching by date range: %s to %s", options.StartDate.Format(time.RFC3339), options.EndDate.Format(time.RFC3339))
		return s.emailRepo.GetByDateRange(accountID, *options.StartDate, *options.EndDate)
	}

	// Handle search query
	if options.SearchQuery != "" {
		s.logger.Debug("Searching emails with query: %s", options.SearchQuery)
		return s.emailRepo.Search(accountID, options.SearchQuery)
	}

	// Handle mailbox filtering
	if options.Mailbox != "" && options.Mailbox != "INBOX" {
		s.logger.Debug("Fetching from specific mailbox: %s", options.Mailbox)
		return s.emailRepo.GetByAccountAndMailboxWithSort(accountID, options.Mailbox, options.Limit, options.Offset, sortClause)
	}

	// Default: get by account with pagination and sorting
	s.logger.Debug("Fetching with default pagination: limit=%d, offset=%d, sort=%s", options.Limit, options.Offset, sortClause)
	return s.emailRepo.GetByAccountWithSort(accountID, options.Limit, options.Offset, sortClause)
}

// convertSortOption converts API sort option to SQL order clause
func (s *FetcherService) convertSortOption(sortBy string) string {
	switch sortBy {
	case "date_asc":
		return "date ASC"
	case "subject_asc":
		return "subject ASC"
	case "subject_desc":
		return "subject DESC"
	case "date_desc":
		fallthrough
	default:
		return "date DESC"
	}
}

// fetchEmailsFromServer fetches emails from IMAP server with options
func (s *FetcherService) fetchEmailsFromServer(account models.EmailAccount, options FetchEmailsOptions) ([]models.Email, error) {
	// Check if should use Gmail API instead of IMAP
	if s.shouldUseGmailAPI(account) {
		s.logger.Debug("Using Gmail API for account %s", account.EmailAddress)
		return s.fetchEmailsFromGmailAPI(account, options)
	}

	// Check if should use Outlook Graph API instead of IMAP
	if s.shouldUseOutlookGraphAPI(account) {
		s.logger.Debug("Using Outlook Graph API for account %s", account.EmailAddress)
		return s.fetchEmailsFromOutlookGraphAPI(account, options)
	}

	var c *client.Client
	var err error

	// Check if MailProvider is nil
	if account.MailProvider == nil {
		return nil, fmt.Errorf("mail provider is not configured for account %s", account.EmailAddress)
	}

	serverAddr := fmt.Sprintf("%s:%d", account.MailProvider.IMAPServer, account.MailProvider.IMAPPort)
	s.logger.Info("Connecting to IMAP server %s for %s", serverAddr, account.EmailAddress)

	if account.Proxy != "" {
		proxyURL, err := url.Parse(account.Proxy)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy URL: %w", err)
		}

		dialer, err := s.createProxyDialer(proxyURL)
		if err != nil {
			s.logger.Error("Failed to create proxy dialer: %v", err)
			return nil, fmt.Errorf("failed to create proxy dialer: %w", err)
		}

		s.logger.Debug("Connecting via %s proxy: %s", proxyURL.Scheme, account.Proxy)

		// For IMAP over proxy, we need to handle TLS after CONNECT
		if account.MailProvider.IMAPPort == 993 {
			// First establish the proxy tunnel
			proxyConn, err := dialer.Dial("tcp", serverAddr)
			if err != nil {
				s.logger.Error("Failed to dial via proxy: %v", err)
				return nil, fmt.Errorf("failed to dial via proxy: %w", err)
			}

			// Then wrap with TLS
			s.logger.Debug("Establishing TLS connection through proxy tunnel")
			tlsConn := tls.Client(proxyConn, &tls.Config{
				ServerName: account.MailProvider.IMAPServer,
			})

			// Perform TLS handshake
			if err := tlsConn.Handshake(); err != nil {
				proxyConn.Close()
				s.logger.Error("TLS handshake failed: %v", err)
				return nil, fmt.Errorf("TLS handshake failed: %w", err)
			}

			// Create IMAP client with the TLS connection
			c, err = client.New(tlsConn)
			if err != nil {
				tlsConn.Close()
				s.logger.Error("Failed to create IMAP client: %v", err)
				return nil, fmt.Errorf("failed to create IMAP client: %w", err)
			}
		} else {
			// For non-TLS IMAP, use the proxy connection directly
			c, err = client.DialWithDialer(dialer, serverAddr)
			if err != nil {
				s.logger.Error("Failed to dial via proxy: %v", err)
				return nil, fmt.Errorf("failed to dial via proxy: %w", err)
			}
		}
	} else {
		// Use TLS connection for secure IMAP (port 993)
		if account.MailProvider.IMAPPort == 993 {
			s.logger.Debug("Using TLS connection for port 993")
			c, err = client.DialTLS(serverAddr, &tls.Config{ServerName: account.MailProvider.IMAPServer})
			if err != nil {
				s.logger.Error("Failed to dial with TLS: %v", err)
				return nil, fmt.Errorf("failed to dial with TLS: %w", err)
			}
		} else {
			// Use plain connection for non-secure IMAP (port 143)
			s.logger.Debug("Using plain connection for port %d", account.MailProvider.IMAPPort)
			c, err = client.Dial(serverAddr)
			if err != nil {
				s.logger.Error("Failed to dial: %v", err)
				return nil, fmt.Errorf("failed to dial: %w", err)
			}
		}
	}
	defer c.Logout()

	// Login based on auth type
	s.logger.Debug("Authenticating with auth type: %s", account.AuthType)
	switch account.AuthType {
	case models.AuthTypePassword:
		// Standard password authentication
		if err := c.Login(account.EmailAddress, account.Password); err != nil {
			s.logger.Error("Password authentication failed for %s: %v", account.EmailAddress, err)
			return nil, fmt.Errorf("login failed: %w", err)
		}
	case models.AuthTypeOAuth2:
		// OAuth2 authentication
		s.logger.Debug("Using OAuth2 authentication")
		// Get client_id from CustomSettings, with fallback to global config
		clientID, ok := account.CustomSettings["client_id"]
		if !ok {
			s.logger.Warn("client_id not found in custom settings, trying to get from global config")

			// Try to get client_id from global OAuth2 config
			oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())
			var config *models.OAuth2GlobalConfig
			var err error

			// First try by OAuth2ProviderID if available
			if account.OAuth2ProviderID != nil {
				config, err = oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
				if err != nil {
					s.logger.Warn("Failed to get config by OAuth2ProviderID %d: %v", *account.OAuth2ProviderID, err)
				}
			}

			// Fallback to provider type
			if config == nil {
				config, err = oauth2GlobalConfigRepo.GetByProviderType(account.MailProvider.Type)
				if err != nil {
					s.logger.Error("Failed to get global config for provider %s: %v", account.MailProvider.Type, err)
					return nil, fmt.Errorf("client_id not found in custom settings and failed to get from global config: %w", err)
				}
			}

			if config == nil {
				return nil, fmt.Errorf("client_id not found in custom settings and no global config available for provider %s", account.MailProvider.Type)
			}

			clientID = config.ClientID
			s.logger.Info("Using client_id from global config (ID: %d, Name: %s) for fetchEmailsFromServer", config.ID, config.Name)
		}

		refreshToken, ok := account.CustomSettings["refresh_token"]
		if !ok {
			s.logger.Error("refresh_token not found in custom settings")
			return nil, fmt.Errorf("refresh_token not found in custom settings")
		}

		// Get client_secret from global OAuth2 config (secure approach)
		clientSecret := ""
		oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())

		var config *models.OAuth2GlobalConfig
		var err error

		// Priority 1: Use OAuth2ProviderID if available (new multi-config support)
		if account.OAuth2ProviderID != nil && *account.OAuth2ProviderID > 0 {
			s.logger.Debug("Using OAuth2ProviderID %d for account %s", *account.OAuth2ProviderID, account.EmailAddress)
			config, err = oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
			if err == nil && config != nil {
				clientSecret = config.ClientSecret
				s.logger.Debug("Retrieved client_secret from OAuth2ProviderID %d for account %s", *account.OAuth2ProviderID, account.EmailAddress)
			} else {
				s.logger.Warn("Failed to get config from OAuth2ProviderID %d for account %s: %v", *account.OAuth2ProviderID, account.EmailAddress, err)
			}
		}

		// Priority 2: Fallback to provider type lookup (backward compatibility)
		if config == nil {
			s.logger.Debug("Falling back to provider type lookup for %s", account.MailProvider.Type)
			config, err = oauth2GlobalConfigRepo.GetByProviderType(account.MailProvider.Type)
			if err == nil && config != nil {
				clientSecret = config.ClientSecret
				s.logger.Debug("Retrieved client_secret from provider type %s for account %s", account.MailProvider.Type, account.EmailAddress)
			} else {
				s.logger.Warn("Failed to get client_secret from provider type %s for account %s: %v", account.MailProvider.Type, account.EmailAddress, err)
			}
		}

		// Refresh access token - use cached method with retry protection and proxy support
		s.logger.Debug("Refreshing OAuth2 access token with cache for provider: %s", account.MailProvider.Type)
		accessToken, err := s.oauth2Service.RefreshAccessTokenWithCacheAndProxy(
			string(account.MailProvider.Type),
			clientID,
			clientSecret,
			refreshToken,
			account.ID,
			account.Proxy, // Pass proxy settings if available
		)
		if err != nil {
			s.logger.Error("Failed to refresh access token: %v", err)
			return nil, fmt.Errorf("failed to refresh access token: %w", err)
		}

		// Update access token in account - 创建新的副本以避免并发写入问题
		newCustomSettings := make(models.JSONMap)
		if account.CustomSettings != nil {
			// 复制现有设置
			for k, v := range account.CustomSettings {
				newCustomSettings[k] = v
			}
		}
		newCustomSettings["access_token"] = accessToken
		account.CustomSettings = newCustomSettings

		// Update the account with new access token
		updatedAccount := account
		if err := s.accountRepo.Update(&updatedAccount); err != nil {
			s.logger.Warn("Failed to update access token in database: %v", err)
		}

		// Authenticate with OAuth2
		saslClient := NewOAuth2SASLClient(account.EmailAddress, accessToken)
		if err := c.Authenticate(saslClient); err != nil {
			s.logger.Error("OAuth2 authentication failed: %v", err)
			return nil, fmt.Errorf("OAuth2 authentication failed: %w", err)
		}
	default:
		s.logger.Error("Unsupported auth type: %s", account.AuthType)
		return nil, fmt.Errorf("unsupported auth type: %s", account.AuthType)
	}

	s.logger.Info("Successfully connected and logged in for %s using %s auth", account.EmailAddress, account.AuthType)

	// Check connection state after authentication
	if c.State() != imap.AuthenticatedState && c.State() != imap.SelectedState {
		s.logger.Error("IMAP connection is in unexpected state after authentication: %v", c.State())
		return nil, fmt.Errorf("IMAP connection is in unexpected state after authentication: %v", c.State())
	}

	s.logger.Debug("IMAP connection state after authentication: %v", c.State())

	// Select mailbox (default to INBOX if not specified)
	mailboxName := options.Mailbox
	if mailboxName == "" {
		mailboxName = "INBOX"
	}

	s.logger.Debug("Attempting to select mailbox: %s", mailboxName)
	mbox, err := c.Select(mailboxName, false)
	if err != nil {
		s.logger.Error("Failed to select mailbox %s: %v (connection state: %v)", mailboxName, err, c.State())

		// Try to check if connection is still alive
		if c.State() == imap.LogoutState || c.State() == imap.NotAuthenticatedState {
			s.logger.Error("Connection appears to be disconnected, state: %v", c.State())
			return nil, fmt.Errorf("connection lost after authentication, failed to select mailbox %s: %w", mailboxName, err)
		}

		return nil, fmt.Errorf("failed to select mailbox %s: %w", mailboxName, err)
	}

	s.logger.Info("Selected mailbox %s: %d total messages", mailboxName, mbox.Messages)

	// Calculate message range based on limit and offset
	limit := options.Limit
	if limit <= 0 || limit > 100 {
		limit = 10 // Default limit
	}

	offset := options.Offset
	if offset < 0 {
		offset = 0
	}

	// Calculate from and to based on total messages, limit, and offset
	from := uint32(1)
	to := mbox.Messages

	if mbox.Messages > 0 {
		// For IMAP, we need to calculate from the end since we want recent emails
		if int(mbox.Messages) > offset+limit {
			from = mbox.Messages - uint32(offset+limit-1)
			to = mbox.Messages - uint32(offset)
		} else if int(mbox.Messages) > offset {
			from = uint32(1)
			to = mbox.Messages - uint32(offset)
		} else {
			// No messages in the requested range
			return []models.Email{}, nil
		}
	}

	// Apply date filter using IMAP search if start date is specified
	var seqNums []uint32
	if options.StartDate != nil {
		s.logger.Debug("Searching for emails since %s in mailbox %s", options.StartDate.Format("02-Jan-2006"), mailboxName)

		criteria := imap.NewSearchCriteria()
		criteria.Since = *options.StartDate

		seqNums, err = c.Search(criteria)
		if err != nil {
			s.logger.Error("Failed to search messages: %v", err)
			return nil, fmt.Errorf("failed to search messages: %w", err)
		}

		s.logger.Info("Found %d messages matching search criteria in %s", len(seqNums), mailboxName)

		if len(seqNums) == 0 {
			return []models.Email{}, nil
		}

		// Limit the results if needed
		if len(seqNums) > limit {
			// Get the most recent messages
			seqNums = seqNums[len(seqNums)-limit:]
		}
	} else {
		// No date filter, use the original range
		for i := from; i <= to; i++ {
			seqNums = append(seqNums, i)
		}
	}

	seqset := new(imap.SeqSet)
	for _, num := range seqNums {
		seqset.AddNum(num)
	}

	// Prepare fetch items based on options
	fetchItems := []imap.FetchItem{imap.FetchEnvelope, imap.FetchFlags, imap.FetchRFC822Size}
	if options.IncludeBody {
		fetchItems = append(fetchItems, imap.FetchRFC822)
	}

	// Fetch messages
	messages := make(chan *imap.Message, limit)
	done := make(chan error, 1)
	go func() {
		done <- c.Fetch(seqset, fetchItems, messages)
	}()

	var emails []models.Email
	for msg := range messages {
		if msg.Envelope == nil {
			continue
		}

		email := models.Email{
			MessageID:   msg.Envelope.MessageId,
			AccountID:   account.ID,
			Subject:     msg.Envelope.Subject,
			Date:        msg.Envelope.Date,
			MailboxName: mailboxName,
			Size:        int64(msg.Size),
		}

		// Convert addresses
		email.From = convertAddresses(msg.Envelope.From)
		email.To = convertAddresses(msg.Envelope.To)
		email.Cc = convertAddresses(msg.Envelope.Cc)
		email.Bcc = convertAddresses(msg.Envelope.Bcc)

		// Convert flags
		for _, flag := range msg.Flags {
			email.Flags = append(email.Flags, string(flag))
		}

		// Parse email body content if available and requested
		if options.IncludeBody && msg.Body != nil && len(msg.Body) > 0 {
			for _, body := range msg.Body {
				if body != nil {
					// Read the raw email content
					rawEmail, err := io.ReadAll(body)
					if err != nil {
						s.logger.Warn("Failed to read email body for message %s: %v", email.MessageID, err)
						continue
					}

					// Parse the email content using the parser service
					parsedEmail, err := s.parserService.ParseEmail(rawEmail)
					if err != nil {
						s.logger.Warn("Failed to parse email content for message %s: %v", email.MessageID, err)
						continue
					}

					// Update email with parsed content
					if parsedEmail.Body != "" {
						email.Body = parsedEmail.Body
					}
					if parsedEmail.HTMLBody != "" {
						email.HTMLBody = parsedEmail.HTMLBody
					}
					if len(parsedEmail.Attachments) > 0 {
						email.Attachments = parsedEmail.Attachments
					}
					break // Only process the first body part
				}
			}
		}

		emails = append(emails, email)

		s.logger.Debug("Fetched email %d - Subject: '%s', From: %s, Date: %s",
			len(emails), email.Subject, email.From, email.Date.Format(time.RFC3339))
	}

	if err := <-done; err != nil {
		s.logger.Error("Failed to fetch messages: %v", err)
		return nil, fmt.Errorf("failed to fetch messages: %w", err)
	}

	// Update last sync time
	if err := s.accountRepo.UpdateLastSync(account.ID); err != nil {
		s.logger.Warn("Failed to update last sync time: %v", err)
	}

	s.logger.Info("Successfully fetched %d emails from %s", len(emails), mailboxName)
	return emails, nil
}

// FetchEmailsByAccountID fetches emails for a given account ID
func (s *FetcherService) FetchEmailsByAccountID(accountID uint) ([]models.Email, error) {
	s.logger.Debug("FetchEmailsByAccountID called for account ID: %d", accountID)

	account, err := s.accountRepo.GetByID(accountID)
	if err != nil {
		s.logger.Error("Failed to get account %d: %v", accountID, err)
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	return s.FetchEmails(*account)
}

// FetchAndStoreEmails fetches emails and stores them in the database
func (s *FetcherService) FetchAndStoreEmails(accountID uint) error {
	s.logger.Info("FetchAndStoreEmails called for account ID: %d", accountID)

	emails, err := s.FetchEmailsByAccountID(accountID)
	if err != nil {
		s.logger.Error("Failed to fetch emails for account %d: %v", accountID, err)
		return err
	}

	s.logger.Debug("Fetched %d emails, checking for duplicates", len(emails))

	if s.ingestService != nil {
		newEmails, err := s.ingestService.IngestEmails(emails, EmailIngestOptions{
			Source: EmailIngestSourceManualSync,
			Metadata: map[string]interface{}{
				"entrypoint": "fetcher_fetch_and_store",
				"account_id": accountID,
			},
		})
		if err != nil {
			return fmt.Errorf("failed to ingest emails: %w", err)
		}
		s.logger.Info("Stored %d new emails for account %d via ingest pipeline", len(newEmails), accountID)
		return nil
	}

	// Check for duplicates and store new emails
	var newEmails []models.Email
	duplicateCount := 0
	for _, email := range emails {
		if email.MessageID != "" {
			exists, err := s.emailRepo.CheckDuplicate(email.MessageID, accountID)
			if err != nil {
				s.logger.Warn("Error checking duplicate for message %s: %v", email.MessageID, err)
				continue
			}
			if exists {
				duplicateCount++
				continue
			}
		}
		newEmails = append(newEmails, email)
	}

	s.logger.Debug("Found %d duplicates out of %d emails", duplicateCount, len(emails))

	if len(newEmails) > 0 {
		if err := s.emailRepo.CreateBatch(newEmails); err != nil {
			s.logger.Error("Failed to store emails: %v", err)
			return fmt.Errorf("failed to store emails: %w", err)
		}
		s.logger.Info("Stored %d new emails for account %d", len(newEmails), accountID)
	} else {
		s.logger.Info("No new emails to store for account %d", accountID)
	}

	return nil
}

// GetMailboxes retrieves all mailboxes for an account
func (s *FetcherService) GetMailboxes(account models.EmailAccount) ([]models.Mailbox, error) {
	DecryptAccountCredentials(&account.Password, &account.Token)
	s.logger.Info("GetMailboxes called for account %s", account.EmailAddress)

	// Check if MailProvider is nil
	if account.MailProvider == nil {
		return nil, fmt.Errorf("mail provider is not configured for account %s", account.EmailAddress)
	}

	// For Gmail OAuth2 accounts, use Gmail API instead of IMAP
	if s.shouldUseGmailAPI(account) {
		s.logger.Debug("Using Gmail API to get mailboxes for OAuth2 account")
		return s.getGmailMailboxes(account)
	}

	// For Outlook OAuth2 accounts, use Graph API instead of IMAP
	if s.shouldUseOutlookGraphAPI(account) {
		s.logger.Debug("Using Outlook Graph API to get mailboxes for OAuth2 account")
		return s.getOutlookMailboxes(account)
	}

	// For other accounts, use IMAP
	var c *client.Client
	var err error

	serverAddr := fmt.Sprintf("%s:%d", account.MailProvider.IMAPServer, account.MailProvider.IMAPPort)

	if account.Proxy != "" {
		proxyURL, err := url.Parse(account.Proxy)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy URL: %w", err)
		}

		dialer, err := s.createProxyDialer(proxyURL)
		if err != nil {
			s.logger.Error("Failed to create proxy dialer: %v", err)
			return nil, fmt.Errorf("failed to create proxy dialer: %w", err)
		}

		s.logger.Debug("Connecting via %s proxy: %s", proxyURL.Scheme, account.Proxy)

		// For IMAP over proxy, we need to handle TLS after CONNECT
		if account.MailProvider.IMAPPort == 993 {
			// First establish the proxy tunnel
			proxyConn, err := dialer.Dial("tcp", serverAddr)
			if err != nil {
				s.logger.Error("Failed to dial via proxy: %v", err)
				return nil, fmt.Errorf("failed to dial via proxy: %w", err)
			}

			// Then wrap with TLS
			s.logger.Debug("Establishing TLS connection through proxy tunnel")
			tlsConn := tls.Client(proxyConn, &tls.Config{
				ServerName: account.MailProvider.IMAPServer,
			})

			// Perform TLS handshake
			if err := tlsConn.Handshake(); err != nil {
				proxyConn.Close()
				s.logger.Error("TLS handshake failed: %v", err)
				return nil, fmt.Errorf("TLS handshake failed: %w", err)
			}

			// Create IMAP client with the TLS connection
			c, err = client.New(tlsConn)
			if err != nil {
				tlsConn.Close()
				s.logger.Error("Failed to create IMAP client: %v", err)
				return nil, fmt.Errorf("failed to create IMAP client: %w", err)
			}
		} else {
			// For non-TLS IMAP, use the proxy connection directly
			c, err = client.DialWithDialer(dialer, serverAddr)
			if err != nil {
				s.logger.Error("Failed to dial via proxy: %v", err)
				return nil, fmt.Errorf("failed to dial via proxy: %w", err)
			}
		}
	} else {
		// Use TLS connection for secure IMAP (port 993)
		if account.MailProvider.IMAPPort == 993 {
			s.logger.Debug("Using TLS connection for port 993")
			c, err = client.DialTLS(serverAddr, &tls.Config{ServerName: account.MailProvider.IMAPServer})
			if err != nil {
				s.logger.Error("Failed to dial with TLS: %v", err)
				return nil, fmt.Errorf("failed to dial with TLS: %w", err)
			}
		} else {
			// Use plain connection for non-secure IMAP (port 143)
			s.logger.Debug("Using plain connection for port %d", account.MailProvider.IMAPPort)
			c, err = client.Dial(serverAddr)
			if err != nil {
				s.logger.Error("Failed to dial: %v", err)
				return nil, fmt.Errorf("failed to dial: %w", err)
			}
		}
	}
	defer c.Logout()

	// Login based on auth type
	s.logger.Debug("Authenticating with auth type: %s", account.AuthType)
	switch account.AuthType {
	case models.AuthTypePassword:
		// Standard password authentication
		if err := c.Login(account.EmailAddress, account.Password); err != nil {
			s.logger.Error("Password authentication failed: %v", err)
			return nil, fmt.Errorf("login failed: %w", err)
		}
	case models.AuthTypeOAuth2:
		// OAuth2 authentication
		s.logger.Debug("Using OAuth2 authentication")
		// Get client_id and refresh_token from CustomSettings
		clientID, ok := account.CustomSettings["client_id"]
		if !ok {
			s.logger.Error("client_id not found in custom settings")
			return nil, fmt.Errorf("client_id not found in custom settings")
		}

		refreshToken, ok := account.CustomSettings["refresh_token"]
		if !ok {
			s.logger.Error("refresh_token not found in custom settings")
			return nil, fmt.Errorf("refresh_token not found in custom settings")
		}

		// Get client_secret from global OAuth2 config (secure approach)
		clientSecret := ""
		oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())

		var config *models.OAuth2GlobalConfig
		var err error

		// Priority 1: Use OAuth2ProviderID if available (new multi-config support)
		if account.OAuth2ProviderID != nil && *account.OAuth2ProviderID > 0 {
			s.logger.Debug("Using OAuth2ProviderID %d for account %s", *account.OAuth2ProviderID, account.EmailAddress)
			config, err = oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
			if err == nil && config != nil {
				clientSecret = config.ClientSecret
				s.logger.Debug("Retrieved client_secret from OAuth2ProviderID %d for account %s", *account.OAuth2ProviderID, account.EmailAddress)
			} else {
				s.logger.Warn("Failed to get config from OAuth2ProviderID %d for account %s: %v", *account.OAuth2ProviderID, account.EmailAddress, err)
			}
		}

		// Priority 2: Fallback to provider type lookup (backward compatibility)
		if config == nil {
			s.logger.Debug("Falling back to provider type lookup for %s", account.MailProvider.Type)
			config, err = oauth2GlobalConfigRepo.GetByProviderType(account.MailProvider.Type)
			if err == nil && config != nil {
				clientSecret = config.ClientSecret
				s.logger.Debug("Retrieved client_secret from provider type %s for account %s", account.MailProvider.Type, account.EmailAddress)
			} else {
				s.logger.Warn("Failed to get client_secret from provider type %s for account %s: %v", account.MailProvider.Type, account.EmailAddress, err)
			}
		}

		// Refresh access token - use cached method with concurrency protection for better reliability
		s.logger.Debug("Refreshing OAuth2 access token for IMAP connection with cache")
		accessToken, err := s.oauth2Service.RefreshAccessTokenWithCacheAndProxy(
			string(account.MailProvider.Type),
			clientID,
			clientSecret,
			refreshToken,
			account.ID,
			account.Proxy, // Pass proxy settings if available
		)
		if err != nil {
			s.logger.Error("Failed to refresh access token: %v", err)
			return nil, fmt.Errorf("failed to refresh access token: %w", err)
		}

		// Update access token in account
		if account.CustomSettings == nil {
			account.CustomSettings = make(models.JSONMap)
		}
		// 并发安全的CustomSettings更新
		newCustomSettings := make(models.JSONMap)
		if account.CustomSettings != nil {
			for k, v := range account.CustomSettings {
				newCustomSettings[k] = v
			}
		}
		newCustomSettings["access_token"] = accessToken
		account.CustomSettings = newCustomSettings

		// Update the account with new access token
		updatedAccount := account
		if err := s.accountRepo.Update(&updatedAccount); err != nil {
			s.logger.Warn("Failed to update access token in database: %v", err)
		}

		// Authenticate with OAuth2
		saslClient := NewOAuth2SASLClient(account.EmailAddress, accessToken)
		if err := c.Authenticate(saslClient); err != nil {
			s.logger.Error("OAuth2 authentication failed: %v", err)
			return nil, fmt.Errorf("OAuth2 authentication failed: %w", err)
		}
	default:
		s.logger.Error("Unsupported auth type: %s", account.AuthType)
		return nil, fmt.Errorf("unsupported auth type: %s", account.AuthType)
	}

	s.logger.Debug("Successfully authenticated, listing mailboxes")

	// List mailboxes
	mailboxes := make(chan *imap.MailboxInfo, 10)
	done := make(chan error, 1)
	go func() {
		done <- c.List("", "*", mailboxes)
	}()

	var mboxes []models.Mailbox
	for mbox := range mailboxes {
		mailbox := models.Mailbox{
			Name:      mbox.Name,
			AccountID: account.ID,
			Delimiter: mbox.Delimiter,
		}

		// Convert attributes to flags
		for _, attr := range mbox.Attributes {
			mailbox.Flags = append(mailbox.Flags, string(attr))
		}

		mboxes = append(mboxes, mailbox)
	}

	if err := <-done; err != nil {
		s.logger.Error("Failed to list mailboxes: %v", err)
		return nil, fmt.Errorf("failed to list mailboxes: %w", err)
	}

	s.logger.Info("Successfully retrieved %d mailboxes for account %s", len(mboxes), account.EmailAddress)
	return mboxes, nil
}

// createProxyDialer creates a dialer based on the proxy URL scheme
func (s *FetcherService) createProxyDialer(proxyURL *url.URL) (proxy.Dialer, error) {
	switch proxyURL.Scheme {
	case "socks5", "socks5h":
		// Use the existing SOCKS5 support
		return proxy.FromURL(proxyURL, proxy.Direct)
	case "http", "https":
		// Create HTTP proxy dialer
		return s.createHTTPProxyDialer(proxyURL), nil
	default:
		return nil, fmt.Errorf("unsupported proxy scheme: %s", proxyURL.Scheme)
	}
}

// createHTTPProxyDialer creates a dialer for HTTP/HTTPS proxy
func (s *FetcherService) createHTTPProxyDialer(proxyURL *url.URL) proxy.Dialer {
	return &httpProxyDialer{
		proxyURL: proxyURL,
		logger:   s.logger,
	}
}

// httpProxyDialer implements proxy.Dialer for HTTP/HTTPS proxies
type httpProxyDialer struct {
	proxyURL *url.URL
	logger   *utils.Logger
}

// createHTTPClientWithProxy creates an HTTP client with proxy support
func (s *FetcherService) createHTTPClientWithProxy(proxyStr string) (*http.Client, error) {
	if proxyStr == "" {
		return &http.Client{Timeout: 30 * time.Second}, nil
	}

	proxyURL, err := url.Parse(proxyStr)
	if err != nil {
		return nil, fmt.Errorf("invalid proxy URL: %w", err)
	}

	s.logger.Debug("Creating HTTP client with proxy: %s", proxyStr)

	// Create transport with proxy
	transport := &http.Transport{
		Proxy: http.ProxyURL(proxyURL),
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	// Handle SOCKS5 proxy
	if proxyURL.Scheme == "socks5" || proxyURL.Scheme == "socks5h" {
		dialer, err := proxy.FromURL(proxyURL, proxy.Direct)
		if err != nil {
			return nil, fmt.Errorf("failed to create SOCKS5 proxy dialer: %w", err)
		}
		transport.Dial = dialer.Dial
		transport.Proxy = nil // Don't use HTTP proxy for SOCKS5
	}

	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}, nil
}

// Dial implements the proxy.Dialer interface
func (d *httpProxyDialer) Dial(network, addr string) (net.Conn, error) {
	d.logger.Debug("HTTP proxy dialer: attempting to connect to %s via proxy %s", addr, d.proxyURL.Host)

	// Connect to the proxy server
	proxyHost := d.proxyURL.Host
	if proxyHost == "" {
		return nil, fmt.Errorf("proxy URL missing host")
	}

	// Add default port if not specified
	if !strings.Contains(proxyHost, ":") {
		if d.proxyURL.Scheme == "https" {
			proxyHost += ":443"
		} else {
			proxyHost += ":80"
		}
	}

	d.logger.Debug("Connecting to proxy server at %s", proxyHost)

	// Connect to proxy with timeout
	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	var proxyConn net.Conn
	var err error

	// For HTTPS proxy, establish TLS connection
	if d.proxyURL.Scheme == "https" {
		d.logger.Debug("Using TLS connection for HTTPS proxy")
		proxyConn, err = tls.DialWithDialer(dialer, "tcp", proxyHost, &tls.Config{
			ServerName: strings.Split(proxyHost, ":")[0],
		})
	} else {
		proxyConn, err = dialer.Dial("tcp", proxyHost)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to connect to proxy at %s: %w", proxyHost, err)
	}

	// Ensure we have the target host and port
	targetHost, targetPort, err := net.SplitHostPort(addr)
	if err != nil {
		// If no port specified, assume IMAP default ports
		targetHost = addr
		targetPort = "993" // Default IMAP SSL port
		addr = net.JoinHostPort(targetHost, targetPort)
	}

	// Create CONNECT request
	connectReq := fmt.Sprintf("CONNECT %s HTTP/1.1\r\n", addr)
	connectReq += fmt.Sprintf("Host: %s\r\n", addr)
	connectReq += "User-Agent: mailman/1.0\r\n"
	connectReq += "Proxy-Connection: Keep-Alive\r\n"

	// Add proxy authentication if provided
	if d.proxyURL.User != nil {
		username := d.proxyURL.User.Username()
		password, _ := d.proxyURL.User.Password()
		auth := username + ":" + password
		encodedAuth := base64.StdEncoding.EncodeToString([]byte(auth))
		connectReq += fmt.Sprintf("Proxy-Authorization: Basic %s\r\n", encodedAuth)
		d.logger.Debug("Adding proxy authentication for user: %s", username)
	}

	connectReq += "\r\n"

	d.logger.Debug("Sending CONNECT request to proxy:\n%s", strings.ReplaceAll(connectReq, "\r\n", "\\r\\n"))

	// Send CONNECT request
	_, err = proxyConn.Write([]byte(connectReq))
	if err != nil {
		proxyConn.Close()
		return nil, fmt.Errorf("failed to send CONNECT request: %w", err)
	}

	// Read response with timeout
	proxyConn.SetReadDeadline(time.Now().Add(10 * time.Second))
	reader := bufio.NewReader(proxyConn)
	statusLine, err := reader.ReadString('\n')
	if err != nil {
		proxyConn.Close()
		if err == io.EOF {
			return nil, fmt.Errorf("proxy closed connection unexpectedly (EOF) - proxy may not support CONNECT method or requires authentication")
		}
		return nil, fmt.Errorf("failed to read proxy response: %w", err)
	}
	proxyConn.SetReadDeadline(time.Time{}) // Clear deadline

	d.logger.Debug("Proxy response: %s", strings.TrimSpace(statusLine))

	// Parse status code
	parts := strings.Fields(statusLine)
	if len(parts) < 2 {
		proxyConn.Close()
		return nil, fmt.Errorf("invalid proxy response: %s", statusLine)
	}

	statusCode := parts[1]
	if statusCode != "200" {
		// Read the rest of the response for error details
		var responseBody strings.Builder
		responseBody.WriteString(statusLine)

		// Read headers
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				break
			}
			responseBody.WriteString(line)
			if line == "\r\n" || line == "\n" {
				break
			}
		}

		proxyConn.Close()

		// Provide specific error messages for common status codes
		switch statusCode {
		case "407":
			return nil, fmt.Errorf("proxy authentication required (407) - please provide valid proxy credentials")
		case "403":
			return nil, fmt.Errorf("proxy access forbidden (403) - the proxy server rejected the connection")
		case "502":
			return nil, fmt.Errorf("bad gateway (502) - the proxy server received an invalid response from the upstream server")
		case "503":
			return nil, fmt.Errorf("service unavailable (503) - the proxy server is temporarily unable to handle the request")
		default:
			return nil, fmt.Errorf("proxy connection failed with status %s: %s", statusCode, strings.TrimSpace(responseBody.String()))
		}
	}

	// Read and discard headers
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			proxyConn.Close()
			return nil, fmt.Errorf("failed to read proxy headers: %w", err)
		}
		d.logger.Debug("Proxy header: %s", strings.TrimSpace(line))
		if line == "\r\n" || line == "\n" {
			break
		}
	}

	d.logger.Info("Successfully established connection through HTTP proxy to %s", addr)
	return proxyConn, nil
}

// convertAddresses converts IMAP addresses to string slice
func convertAddresses(addresses []*imap.Address) models.StringSlice {
	var result models.StringSlice
	for _, addr := range addresses {
		if addr != nil {
			// Format email address properly
			emailAddr := fmt.Sprintf("%s@%s", addr.MailboxName, addr.HostName)

			// If there's a personal name, format as "Name <email>"
			if addr.PersonalName != "" {
				result = append(result, fmt.Sprintf("%s <%s>", addr.PersonalName, emailAddr))
			} else {
				// Otherwise, just the email address
				result = append(result, emailAddr)
			}
		}
	}
	return result
}

// VerifyConnection verifies if an email account can connect successfully
func (s *FetcherService) VerifyConnection(account *models.EmailAccount) error {
	DecryptAccountCredentials(&account.Password, &account.Token)
	s.logger.Info("VerifyConnection called for account %s", account.EmailAddress)

	// Check if MailProvider is nil
	if account.MailProvider == nil {
		return fmt.Errorf("mail provider is not configured for account %s", account.EmailAddress)
	}

	// Initialize CustomSettings if nil
	if account.CustomSettings == nil {
		account.CustomSettings = make(models.JSONMap)
	}

	// For Gmail OAuth2 accounts, use Gmail API instead of IMAP
	if account.AuthType == models.AuthTypeOAuth2 && account.MailProvider.Type == models.ProviderTypeGmail {
		s.logger.Debug("Using Gmail API verification for OAuth2 account")
		err := s.verifyGmailOAuth2Connection(*account)
		if err == nil {
			account.CustomSettings["connection_protocol"] = "gmail_api"
		}
		return err
	}

	// For Outlook OAuth2 accounts, try Graph API/REST API first
	if account.AuthType == models.AuthTypeOAuth2 && account.MailProvider.Type == models.ProviderTypeOutlook {
		s.logger.Debug("Using Outlook Graph API verification for OAuth2 account")
		err := s.verifyOutlookGraphConnection(*account)
		if err == nil {
			s.logger.Info("Outlook verification successful via Graph/REST API")
			account.CustomSettings["connection_protocol"] = "graph"
			return nil
		}

		s.logger.Warn("Outlook Graph/REST API verification failed, falling back to IMAP: %v", err)
		// Fall through to general IMAP verification logic below
	}

	// For other accounts (or Outlook fallback), use IMAP verification
	var c *client.Client
	var err error

	serverAddr := fmt.Sprintf("%s:%d", account.MailProvider.IMAPServer, account.MailProvider.IMAPPort)
	s.logger.Debug("Connecting to IMAP server %s", serverAddr)

	// Establish connection
	if account.Proxy != "" {
		proxyURL, err := url.Parse(account.Proxy)
		if err != nil {
			return fmt.Errorf("invalid proxy URL: %w", err)
		}

		dialer, err := s.createProxyDialer(proxyURL)
		if err != nil {
			s.logger.Error("Failed to create proxy dialer: %v", err)
			return fmt.Errorf("failed to create proxy dialer: %w", err)
		}

		s.logger.Debug("Connecting via %s proxy: %s", proxyURL.Scheme, account.Proxy)

		// For IMAP over proxy, we need to handle TLS after CONNECT
		if account.MailProvider.IMAPPort == 993 {
			// First establish the proxy tunnel
			proxyConn, err := dialer.Dial("tcp", serverAddr)
			if err != nil {
				s.logger.Error("Failed to dial via proxy: %v", err)
				return fmt.Errorf("failed to dial via proxy: %w", err)
			}

			// Then wrap with TLS
			s.logger.Debug("Establishing TLS connection through proxy tunnel")
			tlsConn := tls.Client(proxyConn, &tls.Config{
				ServerName: account.MailProvider.IMAPServer,
			})

			// Perform TLS handshake
			if err := tlsConn.Handshake(); err != nil {
				proxyConn.Close()
				s.logger.Error("TLS handshake failed: %v", err)
				return fmt.Errorf("TLS handshake failed: %w", err)
			}

			// Create IMAP client with the TLS connection
			c, err = client.New(tlsConn)
			if err != nil {
				tlsConn.Close()
				s.logger.Error("Failed to create IMAP client: %v", err)
				return fmt.Errorf("failed to create IMAP client: %w", err)
			}
		} else {
			// For non-TLS IMAP, use the proxy connection directly
			c, err = client.DialWithDialer(dialer, serverAddr)
			if err != nil {
				s.logger.Error("Failed to dial via proxy: %v", err)
				return fmt.Errorf("failed to dial via proxy: %w", err)
			}
		}
	} else {
		// Use TLS connection for secure IMAP (port 993)
		if account.MailProvider.IMAPPort == 993 {
			s.logger.Debug("Using TLS connection for port 993")
			c, err = client.DialTLS(serverAddr, &tls.Config{ServerName: account.MailProvider.IMAPServer})
			if err != nil {
				s.logger.Error("Failed to dial with TLS: %v", err)
				return fmt.Errorf("failed to dial with TLS: %w", err)
			}
		} else {
			// Use plain connection for non-secure IMAP (port 143)
			s.logger.Debug("Using plain connection for port %d", account.MailProvider.IMAPPort)
			c, err = client.Dial(serverAddr)
			if err != nil {
				s.logger.Error("Failed to dial: %v", err)
				return fmt.Errorf("failed to dial: %w", err)
			}
		}
	}
	defer c.Logout()

	// Login based on auth type
	s.logger.Debug("Authenticating with auth type: %s", account.AuthType)
	switch account.AuthType {
	case models.AuthTypePassword:
		// Standard password authentication
		if err := c.Login(account.EmailAddress, account.Password); err != nil {
			s.logger.Error("Password authentication failed: %v", err)
			return fmt.Errorf("login failed: %w", err)
		}
	case models.AuthTypeOAuth2:
		// OAuth2 authentication
		s.logger.Debug("Using OAuth2 authentication")
		s.logger.Debug("CustomSettings content: %+v", account.CustomSettings)
		// Get client_id from CustomSettings, with fallback to global config
		clientID, ok := account.CustomSettings["client_id"]
		if !ok {
			s.logger.Warn("client_id not found in custom settings, trying to get from global config")
			s.logger.Debug("Available keys in CustomSettings: %v", func() []string {
				keys := make([]string, 0, len(account.CustomSettings))
				for k := range account.CustomSettings {
					keys = append(keys, k)
				}
				return keys
			}())

			// Try to get client_id from global OAuth2 config
			oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())
			var tempConfig *models.OAuth2GlobalConfig
			var err error

			// First try by OAuth2ProviderID if available
			if account.OAuth2ProviderID != nil {
				tempConfig, err = oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
				if err != nil {
					s.logger.Warn("Failed to get config by OAuth2ProviderID %d: %v", *account.OAuth2ProviderID, err)
				}
			}

			// Fallback to provider type
			if tempConfig == nil {
				tempConfig, err = oauth2GlobalConfigRepo.GetByProviderType(account.MailProvider.Type)
				if err != nil {
					s.logger.Error("Failed to get global config for provider %s: %v", account.MailProvider.Type, err)
					return fmt.Errorf("client_id not found in custom settings and failed to get from global config: %w", err)
				}
			}

			if tempConfig == nil {
				return fmt.Errorf("client_id not found in custom settings and no global config available for provider %s", account.MailProvider.Type)
			}

			clientID = tempConfig.ClientID
			s.logger.Info("Using client_id from global config (ID: %d, Name: %s) for account %s", tempConfig.ID, tempConfig.Name, account.EmailAddress)
		}

		refreshToken, ok := account.CustomSettings["refresh_token"]
		if !ok {
			s.logger.Error("refresh_token not found in custom settings")
			return fmt.Errorf("refresh_token not found in custom settings")
		}

		// Get client_secret from global OAuth2 config (secure approach)
		clientSecret := ""
		oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())

		var config *models.OAuth2GlobalConfig
		var err error

		// Priority 1: Use OAuth2ProviderID if available (new multi-config support)
		if account.OAuth2ProviderID != nil && *account.OAuth2ProviderID > 0 {
			s.logger.Debug("Using OAuth2ProviderID %d for account %s", *account.OAuth2ProviderID, account.EmailAddress)
			config, err = oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
			if err == nil && config != nil {
				clientSecret = config.ClientSecret
				s.logger.Debug("Retrieved client_secret from OAuth2ProviderID %d for account %s", *account.OAuth2ProviderID, account.EmailAddress)
			} else {
				s.logger.Warn("Failed to get config from OAuth2ProviderID %d for account %s: %v", *account.OAuth2ProviderID, account.EmailAddress, err)
			}
		}

		// Priority 2: Fallback to provider type lookup (backward compatibility)
		if config == nil {
			s.logger.Debug("Falling back to provider type lookup for %s", account.MailProvider.Type)
			config, err = oauth2GlobalConfigRepo.GetByProviderType(account.MailProvider.Type)
			if err == nil && config != nil {
				clientSecret = config.ClientSecret
				s.logger.Debug("Retrieved client_secret from provider type %s for account %s", account.MailProvider.Type, account.EmailAddress)
			} else {
				s.logger.Warn("Failed to get client_secret from provider type %s for account %s: %v", account.MailProvider.Type, account.EmailAddress, err)
			}
		}

		if config != nil {
			clientSecret = config.ClientSecret
		}

		// Refresh access token - use cached method with concurrency protection for better reliability
		s.logger.Debug("Refreshing OAuth2 access token for IMAP connection with cache")
		accessToken, err := s.oauth2Service.RefreshAccessTokenWithCacheAndProxy(
			string(account.MailProvider.Type),
			clientID,
			clientSecret,
			refreshToken,
			account.ID,
			account.Proxy, // Pass proxy settings if available
		)
		if err != nil {
			s.logger.Error("Failed to refresh access token: %v", err)
			return fmt.Errorf("failed to refresh access token: %w", err)
		}

		// Update access token in account - 并发安全更新
		// CustomSettings is already ensured to be non-nil at start of function
		account.CustomSettings["access_token"] = accessToken

		// Update the account with new access token in DB so it persists
		// Note: We use a copy to avoid side effects if the update fails, although here we want the side effect
		if err := s.accountRepo.Update(account); err != nil {
			s.logger.Warn("Failed to update access token in database: %v", err)
		}

		// Authenticate with OAuth2
		saslClient := NewOAuth2SASLClient(account.EmailAddress, accessToken)
		if err := c.Authenticate(saslClient); err != nil {
			s.logger.Error("OAuth2 authentication failed: %v", err)
			return fmt.Errorf("OAuth2 authentication failed: %w", err)
		}
	default:
		s.logger.Error("Unsupported auth type: %s", account.AuthType)
		return fmt.Errorf("unsupported auth type: %s", account.AuthType)
	}

	// If we reach here, connection and authentication were successful
	s.logger.Info("Successfully verified connection for %s using %s auth", account.EmailAddress, account.AuthType)

	// Try to select INBOX to ensure full connectivity
	_, err = c.Select("INBOX", false)
	if err != nil {
		s.logger.Error("Failed to select INBOX: %v", err)
		return fmt.Errorf("failed to select INBOX: %w", err)
	}

	// Record protocol as IMAP since we successfully used it
	account.CustomSettings["connection_protocol"] = "imap"

	s.logger.Info("Connection verification successful for %s", account.EmailAddress)
	return nil
}

// verifyGmailOAuth2Connection verifies Gmail OAuth2 connection using Gmail API

func (s *FetcherService) GetAllFolders(account models.EmailAccount) ([]string, error) {
	s.logger.Debug("Getting all folders for account %s", account.EmailAddress)

	// For Gmail OAuth2 accounts, use Gmail API to get labels
	if account.AuthType == models.AuthTypeOAuth2 && account.MailProvider.Type == models.ProviderTypeGmail {
		return s.getGmailFolders(account)
	}

	// For Outlook OAuth2 accounts, use Graph API to get folders
	if account.AuthType == models.AuthTypeOAuth2 && account.MailProvider.Type == models.ProviderTypeOutlook {
		return s.getOutlookFolders(account)
	}

	// For IMAP accounts, use IMAP LIST command
	return s.getImapFolders(account)
}

// getGmailFolders retrieves Gmail folders (labels) using Gmail API

func (s *FetcherService) GetAccountByEmail(emailAddress string) (*models.EmailAccount, error) {
	s.logger.Debug("Getting account by email: %s", emailAddress)

	// Use the repository to find the account
	accounts, err := s.accountRepo.GetAll(0)
	if err != nil {
		return nil, fmt.Errorf("failed to get accounts: %w", err)
	}

	for _, account := range accounts {
		if account.EmailAddress == emailAddress {
			s.logger.Debug("Found account for email: %s", emailAddress)
			return &account, nil
		}
	}

	return nil, fmt.Errorf("account not found for email: %s", emailAddress)
}

// SyncGmailEmailAttachments fetches and downloads attachments for a specific Gmail email
