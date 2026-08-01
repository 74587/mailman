package services

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

func (s *FetcherService) getImapFolders(account models.EmailAccount) ([]string, error) {
	return s.getImapFoldersWithContext(context.Background(), account)
}

func (s *FetcherService) getImapFoldersWithContext(ctx context.Context, account models.EmailAccount) ([]string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.logger.Debug("Getting IMAP folders for %s using real IMAP connection", account.EmailAddress)

	// 使用真正的IMAP连接获取文件夹列表
	c, err := s.connectAndAuthenticateIMAPWithContext(ctx, account)
	if err != nil {
		s.logger.Error("Failed to connect to IMAP server: %v", err)
		return nil, fmt.Errorf("failed to connect to IMAP server: %w", err)
	}
	defer c.Logout()
	stopCancellation := context.AfterFunc(ctx, func() { _ = c.Terminate() })
	defer stopCancellation()

	// 使用LIST命令获取所有文件夹
	mailboxes := make(chan *imap.MailboxInfo, 10)
	done := make(chan error, 1)

	go func() {
		done <- c.List("", "*", mailboxes)
	}()

	var folders []string
	for m := range mailboxes {
		folders = append(folders, m.Name)
	}

	if err := <-done; err != nil {
		s.logger.Error("IMAP LIST command failed: %v", err)
		return nil, fmt.Errorf("IMAP LIST command failed: %w", err)
	}

	s.logger.Info("Retrieved %d folders from IMAP server for %s: %v", len(folders), account.EmailAddress, folders)
	return folders, nil
}

// connectAndAuthenticateIMAP connects to IMAP server and authenticates

func (s *FetcherService) connectAndAuthenticateIMAP(account models.EmailAccount) (*client.Client, error) {
	return s.connectAndAuthenticateIMAPWithContext(context.Background(), account)
}

func (s *FetcherService) connectAndAuthenticateIMAPWithContext(ctx context.Context, account models.EmailAccount) (*client.Client, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
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
			proxyConn, err := dialProxyWithContext(ctx, dialer, "tcp", serverAddr)
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
			if err := tlsConn.HandshakeContext(ctx); err != nil {
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
			proxyConn, dialErr := dialProxyWithContext(ctx, dialer, "tcp", serverAddr)
			if dialErr != nil {
				err = dialErr
			} else {
				c, err = client.New(proxyConn)
				if err != nil {
					_ = proxyConn.Close()
				}
			}
			if err != nil {
				s.logger.Error("Failed to dial via proxy: %v", err)
				return nil, fmt.Errorf("failed to dial via proxy: %w", err)
			}
		}
	} else {
		// Use TLS connection for secure IMAP (port 993)
		netDialer := &net.Dialer{Timeout: fetcherContextTimeout(ctx, 30*time.Second)}
		rawConn, dialErr := netDialer.DialContext(ctx, "tcp", serverAddr)
		if dialErr != nil {
			return nil, fmt.Errorf("failed to dial: %w", dialErr)
		}
		applyConnectionDeadline(ctx, rawConn)
		if account.MailProvider.IMAPPort == 993 {
			s.logger.Debug("Using TLS connection for port 993")
			tlsConn := tls.Client(rawConn, &tls.Config{ServerName: account.MailProvider.IMAPServer})
			if err := tlsConn.HandshakeContext(ctx); err != nil {
				_ = rawConn.Close()
				return nil, fmt.Errorf("failed to establish IMAP TLS: %w", err)
			}
			c, err = client.New(tlsConn)
		} else {
			s.logger.Debug("Using plain connection for port %d", account.MailProvider.IMAPPort)
			c, err = client.New(rawConn)
		}
		if err != nil {
			_ = rawConn.Close()
			return nil, fmt.Errorf("failed to create IMAP client: %w", err)
		}
	}
	c.Timeout = fetcherContextTimeout(ctx, 30*time.Second)
	stopCancellation := context.AfterFunc(ctx, func() { _ = c.Terminate() })
	defer stopCancellation()

	// Login based on auth type
	s.logger.Debug("Authenticating with auth type: %s", account.AuthType)
	switch account.AuthType {
	case models.AuthTypePassword:
		// Standard password authentication
		if err := c.Login(account.EmailAddress, account.Password); err != nil {
			s.logger.Error("Password authentication failed for %s: %v", account.EmailAddress, err)
			c.Logout()
			return nil, fmt.Errorf("login failed: %w", err)
		}
	case models.AuthTypeOAuth2:
		// OAuth2 authentication
		s.logger.Debug("Using OAuth2 authentication")
		// Get client_id from CustomSettings, with fallback to global config
		clientID := strings.TrimSpace(account.CustomSettings["client_id"])
		if clientID == "" {
			s.logger.Warn("client_id not found in custom settings, trying to get from global config")

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
					c.Logout()
					return nil, fmt.Errorf("client_id not found in custom settings and failed to get from global config: %w", err)
				}
			}

			if tempConfig == nil {
				c.Logout()
				return nil, fmt.Errorf("client_id not found in custom settings and no global config available for provider %s", account.MailProvider.Type)
			}

			clientID = tempConfig.ClientID
			s.logger.Info("Using client_id from global config (ID: %d, Name: %s) for connectAndAuthenticateIMAP", tempConfig.ID, tempConfig.Name)
		}

		refreshToken := strings.TrimSpace(account.CustomSettings["refresh_token"])
		if refreshToken == "" {
			s.logger.Error("refresh_token not found in custom settings")
			c.Logout()
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
		s.logger.Debug("Refreshing OAuth2 access token for IMAP folder listing with cache")
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
			c.Logout()
			return nil, fmt.Errorf("failed to refresh access token: %w", err)
		}

		// Authenticate with OAuth2
		saslClient := NewOAuth2SASLClient(account.EmailAddress, accessToken)
		if err := c.Authenticate(saslClient); err != nil {
			s.logger.Error("OAuth2 authentication failed: %v", err)
			c.Logout()
			return nil, fmt.Errorf("OAuth2 authentication failed: %w", err)
		}

		// Check connection state after authentication
		if c.State() != imap.AuthenticatedState && c.State() != imap.SelectedState {
			s.logger.Error("IMAP connection is in unexpected state after OAuth2 authentication: %v", c.State())
			c.Logout()
			return nil, fmt.Errorf("IMAP connection is in unexpected state after OAuth2 authentication: %v", c.State())
		}

		s.logger.Debug("IMAP connection state after OAuth2 authentication: %v", c.State())

		// For Microsoft Outlook, sometimes we need to send a NOOP command to refresh the connection
		if account.MailProvider.Type == models.ProviderTypeOutlook {
			s.logger.Debug("Sending NOOP command to refresh Outlook connection state")
			if err := c.Noop(); err != nil {
				s.logger.Warn("NOOP command failed, but continuing: %v", err)
			} else {
				s.logger.Debug("NOOP command successful, connection state: %v", c.State())
			}
		}
	default:
		s.logger.Error("Unsupported auth type: %s", account.AuthType)
		c.Logout()
		return nil, fmt.Errorf("unsupported auth type: %s", account.AuthType)
	}
	if err := initializeAuthenticatedIMAPClient(c, account); err != nil {
		s.logger.Error("Failed to initialize authenticated IMAP client for %s: %v", account.EmailAddress, err)
		c.Logout()
		return nil, err
	}

	s.logger.Info("Successfully connected and logged in for %s using %s auth", account.EmailAddress, account.AuthType)
	return c, nil
}

// shouldUseGmailAPI determines if should use Gmail API instead of IMAP

func (s *FetcherService) SyncIMAPEmailAttachments(account models.EmailAccount, messageID string) ([]models.Attachment, error) {
	s.logger.Debug("Syncing IMAP attachments for message %s", messageID)

	// Connect to IMAP server
	c, err := s.connectToIMAP(account)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to IMAP: %w", err)
	}
	defer c.Logout()

	// Select INBOX (or try to find the message in other folders)
	_, err = c.Select("INBOX", false)
	if err != nil {
		return nil, fmt.Errorf("failed to select INBOX: %w", err)
	}

	// Search for the message by Message-ID header
	criteria := imap.NewSearchCriteria()
	criteria.Header.Add("Message-Id", messageID)

	seqNums, err := c.Search(criteria)
	if err != nil {
		return nil, fmt.Errorf("failed to search for message: %w", err)
	}

	if len(seqNums) == 0 {
		return nil, fmt.Errorf("message not found on server")
	}

	// Fetch the full message
	seqSet := new(imap.SeqSet)
	seqSet.AddNum(seqNums[0])

	messages := make(chan *imap.Message, 1)
	section := &imap.BodySectionName{}

	go func() {
		c.Fetch(seqSet, []imap.FetchItem{section.FetchItem()}, messages)
	}()

	msg := <-messages
	if msg == nil {
		return nil, fmt.Errorf("failed to fetch message")
	}

	// Get the raw message body
	r := msg.GetBody(section)
	if r == nil {
		return nil, fmt.Errorf("failed to get message body")
	}

	rawEmail, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("failed to read message body: %w", err)
	}

	// Parse the email to extract attachments
	parsedEmail, err := s.parserService.ParseEmail(rawEmail)
	if err != nil {
		return nil, fmt.Errorf("failed to parse email: %w", err)
	}

	s.logger.Debug("Synced %d attachments for message %s", len(parsedEmail.Attachments), messageID)
	return parsedEmail.Attachments, nil
}

// connectToIMAP establishes a connection to the IMAP server and authenticates

func (s *FetcherService) connectToIMAP(account models.EmailAccount) (*client.Client, error) {
	// Check if MailProvider is nil
	if account.MailProvider == nil {
		return nil, fmt.Errorf("mail provider is not configured for account %s", account.EmailAddress)
	}

	var c *client.Client
	var err error

	serverAddr := fmt.Sprintf("%s:%d", account.MailProvider.IMAPServer, account.MailProvider.IMAPPort)
	s.logger.Debug("Connecting to IMAP server %s for %s", serverAddr, account.EmailAddress)

	if account.Proxy != "" {
		proxyURL, err := url.Parse(account.Proxy)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy URL: %w", err)
		}

		dialer, err := s.createProxyDialer(proxyURL)
		if err != nil {
			return nil, fmt.Errorf("failed to create proxy dialer: %w", err)
		}

		// For IMAP over proxy, we need to handle TLS after CONNECT
		if account.MailProvider.IMAPPort == 993 {
			proxyConn, err := dialer.Dial("tcp", serverAddr)
			if err != nil {
				return nil, fmt.Errorf("failed to dial via proxy: %w", err)
			}

			tlsConn := tls.Client(proxyConn, &tls.Config{
				ServerName: account.MailProvider.IMAPServer,
			})

			if err := tlsConn.Handshake(); err != nil {
				proxyConn.Close()
				return nil, fmt.Errorf("TLS handshake failed: %w", err)
			}

			c, err = client.New(tlsConn)
			if err != nil {
				tlsConn.Close()
				return nil, fmt.Errorf("failed to create IMAP client: %w", err)
			}
		} else {
			c, err = client.DialWithDialer(dialer, serverAddr)
			if err != nil {
				return nil, fmt.Errorf("failed to dial via proxy: %w", err)
			}
		}
	} else {
		if account.MailProvider.IMAPPort == 993 {
			c, err = client.DialTLS(serverAddr, &tls.Config{ServerName: account.MailProvider.IMAPServer})
			if err != nil {
				return nil, fmt.Errorf("failed to dial with TLS: %w", err)
			}
		} else {
			c, err = client.Dial(serverAddr)
			if err != nil {
				return nil, fmt.Errorf("failed to dial: %w", err)
			}
		}
	}

	// Login based on auth type
	switch account.AuthType {
	case models.AuthTypePassword:
		if err := c.Login(account.EmailAddress, account.Password); err != nil {
			c.Logout()
			return nil, fmt.Errorf("login failed: %w", err)
		}
	case models.AuthTypeOAuth2:
		// Get access_token from CustomSettings
		accessToken, ok := account.CustomSettings["access_token"]
		if !ok {
			c.Logout()
			return nil, fmt.Errorf("access_token not found in custom settings")
		}
		// Get client_id from CustomSettings or global config
		clientID := ""
		if cid, ok := account.CustomSettings["client_id"]; ok {
			clientID = cid
		} else if account.OAuth2ProviderID != nil {
			oauth2GlobalConfigRepo := repository.NewOAuth2GlobalConfigRepository(s.accountRepo.GetDB())
			config, err := oauth2GlobalConfigRepo.GetByID(*account.OAuth2ProviderID)
			if err == nil && config != nil {
				clientID = config.ClientID
			}
		}
		if clientID == "" {
			c.Logout()
			return nil, fmt.Errorf("client_id not found")
		}
		saslClient := NewOAuth2SASLClient(account.EmailAddress, accessToken)
		if err := c.Authenticate(saslClient); err != nil {
			c.Logout()
			return nil, fmt.Errorf("OAuth2 authentication failed: %w", err)
		}
	case models.AuthTypeToken:
		saslClient := NewOAuth2SASLClient(account.EmailAddress, account.Token)
		if err := c.Authenticate(saslClient); err != nil {
			c.Logout()
			return nil, fmt.Errorf("token authentication failed: %w", err)
		}
	default:
		c.Logout()
		return nil, fmt.Errorf("unsupported auth type: %s", account.AuthType)
	}
	if err := initializeAuthenticatedIMAPClient(c, account); err != nil {
		c.Logout()
		return nil, err
	}

	return c, nil
}

// ============================================================================
// Outlook Graph API Support
// ============================================================================

// shouldUseOutlookGraphAPI determines if should use Graph API instead of IMAP
// Returns true only if the account has a JWT-formatted access token (for Graph API)
// Returns false for IMAP-scoped tokens (EwA format) which should use IMAP protocol
