package services

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"mailman/internal/models"
)

const outlookGraphProtocolProbeURL = "https://graph.microsoft.com/v1.0/me/messages?$top=1&$select=id"

// OutlookProtocolDetectionResult records a capability-based protocol choice.
type OutlookProtocolDetectionResult struct {
	Protocol         string
	PreviousProtocol string
	Changed          bool
	Method           string
}

// OutlookProtocolDetectionError distinguishes temporary provider failures from
// definitive capability failures. Temporary failures must not change protocol.
type OutlookProtocolDetectionError struct {
	Temporary bool
	Err       error
}

// SetOutlookIMAPProtocolProbe overrides the IMAP capability probe. It is useful
// for embedding environments and deterministic API tests; nil restores the
// real context-aware IMAP probe.
func (s *FetcherService) SetOutlookIMAPProtocolProbe(probe func(context.Context, models.EmailAccount) error) {
	s.outlookIMAPProtocolProbe = probe
}

func (e *OutlookProtocolDetectionError) Error() string {
	if e == nil || e.Err == nil {
		return "Outlook protocol detection failed"
	}
	return e.Err.Error()
}

func (e *OutlookProtocolDetectionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// DetectOutlookProtocol performs a one-time, read-only capability check and
// persists the result. Token shape is used only for the unambiguous EwA/Exchange
// case; all other tokens must prove Graph or IMAP mailbox access.
func (s *FetcherService) DetectOutlookProtocol(ctx context.Context, account models.EmailAccount) (OutlookProtocolDetectionResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if account.AuthType != models.AuthTypeOAuth2 ||
		account.MailProvider == nil ||
		account.MailProvider.Type != models.ProviderTypeOutlook {
		return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{
			Err: fmt.Errorf("protocol detection supports Outlook OAuth2 accounts only"),
		}
	}
	if account.CustomSettings == nil {
		return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{
			Err: fmt.Errorf("Outlook OAuth2 settings are missing"),
		}
	}
	if err := s.prepareAccountProxy(&account); err != nil {
		return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{Err: err}
	}

	previousProtocol := strings.ToLower(strings.TrimSpace(account.CustomSettings["connection_protocol"]))
	accessToken, err := s.getOutlookAccessTokenWithSource(account, EmailIngestSourceManualSync)
	if err != nil {
		return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{
			Temporary: isTemporaryOutlookProtocolError(err),
			Err:       fmt.Errorf("failed to obtain an Outlook access token: %w", err),
		}
	}
	if isOutlookExchangeResourceToken(accessToken) {
		if err := s.probeOutlookIMAPProtocol(ctx, account); err != nil {
			return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{
				Temporary: isTemporaryOutlookProtocolError(err),
				Err:       fmt.Errorf("Exchange token was detected but IMAP capability verification failed: %w", err),
			}
		}
		return s.persistOutlookProtocolDetection(account.ID, previousProtocol, "imap", "imap_xoauth2_probe")
	}

	graphResult, graphErr := s.doOutlookGraphGET(
		ctx,
		account,
		EmailIngestSourceManualSync,
		"protocolDetection",
		outlookGraphProtocolProbeURL,
		accessToken,
		nil,
	)
	if graphErr != nil {
		return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{
			Temporary: isTemporaryOutlookProtocolError(graphErr),
			Err:       fmt.Errorf("Microsoft Graph capability check failed: %w", graphErr),
		}
	}

	switch {
	case graphResult.StatusCode == http.StatusOK:
		return s.persistOutlookProtocolDetection(account.ID, previousProtocol, "graph", "graph_mail_probe")
	case graphResult.StatusCode == http.StatusTooManyRequests || graphResult.StatusCode >= 500:
		return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{
			Temporary: true,
			Err:       fmt.Errorf("Microsoft Graph capability check is temporarily unavailable (status %d)", graphResult.StatusCode),
		}
	case graphResult.StatusCode != http.StatusUnauthorized && graphResult.StatusCode != http.StatusForbidden:
		return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{
			Err: fmt.Errorf("Microsoft Graph capability check returned unexpected status %d", graphResult.StatusCode),
		}
	}

	if err := s.probeOutlookIMAPProtocol(ctx, account); err != nil {
		return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{
			Temporary: isTemporaryOutlookProtocolError(err),
			Err:       fmt.Errorf("token has no usable Graph mail access and IMAP capability verification failed: %w", err),
		}
	}
	return s.persistOutlookProtocolDetection(account.ID, previousProtocol, "imap", "imap_xoauth2_probe")
}

func isOutlookExchangeResourceToken(accessToken string) bool {
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(accessToken)), "EWA")
}

func (s *FetcherService) probeOutlookIMAPProtocol(ctx context.Context, account models.EmailAccount) error {
	if s.outlookIMAPProtocolProbe != nil {
		return s.outlookIMAPProtocolProbe(ctx, account)
	}
	_, err := s.getImapFoldersWithContext(ctx, account)
	return err
}

func (s *FetcherService) persistOutlookProtocolDetection(accountID uint, previousProtocol, protocol, method string) (OutlookProtocolDetectionResult, error) {
	if err := s.oauth2Service.mergeAccountCustomSettings(string(models.ProviderTypeOutlook), accountID, map[string]string{
		"connection_protocol":       protocol,
		"protocol_detection_method": method,
		"protocol_detected_at":      strconv.FormatInt(time.Now().Unix(), 10),
	}); err != nil {
		return OutlookProtocolDetectionResult{}, &OutlookProtocolDetectionError{
			Err: fmt.Errorf("failed to persist detected Outlook protocol: %w", err),
		}
	}
	return OutlookProtocolDetectionResult{
		Protocol:         protocol,
		PreviousProtocol: previousProtocol,
		Changed:          previousProtocol != protocol,
		Method:           method,
	}, nil
}

func isTemporaryOutlookProtocolError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "timeout") ||
		strings.Contains(message, "deadline exceeded") ||
		strings.Contains(message, "temporarily_unavailable") ||
		strings.Contains(message, "aadsts90055") ||
		strings.Contains(message, "too many requests") ||
		strings.Contains(message, "rate limit") ||
		strings.Contains(message, "throttl") ||
		strings.Contains(message, "connection reset") ||
		strings.Contains(message, "connection refused") ||
		strings.Contains(message, "no route to host") ||
		strings.Contains(message, "unexpected eof") ||
		strings.Contains(message, "network")
}
