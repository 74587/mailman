package services

import (
	"fmt"
	"strings"

	"mailman/internal/models"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-imap/responses"
)

const imapIDCommandName = "ID"

var netEaseIMAPHosts = map[string]struct{}{
	"imap.126.com":     {},
	"imap.163.com":     {},
	"imap.188.com":     {},
	"imap.yeah.net":    {},
	"imap.vip.126.com": {},
	"imap.vip.163.com": {},
}

// requiresIMAPClientID identifies providers that require RFC 2971 ID after
// authentication and before mailbox operations. Detection includes both the
// built-in provider type and known server hosts so existing custom provider
// records for the same NetEase services keep working without changing the
// command sequence for unrelated custom servers.
func requiresIMAPClientID(account models.EmailAccount) bool {
	if account.MailProvider != nil {
		providerType := models.NormalizeMailProviderType(account.MailProvider.Type)
		if providerType == models.ProviderTypeNetEase163 || providerType == models.ProviderTypeNetEase126 {
			return true
		}
		host := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(account.MailProvider.IMAPServer), "."))
		if _, ok := netEaseIMAPHosts[host]; ok {
			return true
		}
	}
	return false
}

type imapIDResponseHandler struct{}

func (imapIDResponseHandler) Handle(resp imap.Resp) error {
	name, _, ok := imap.ParseNamedResp(resp)
	if !ok || !strings.EqualFold(name, imapIDCommandName) {
		return responses.ErrUnhandled
	}
	return nil
}

func sendIMAPClientID(c *client.Client) error {
	if c == nil {
		return fmt.Errorf("IMAP client is nil")
	}
	if state := c.State(); state != imap.AuthenticatedState && state != imap.SelectedState {
		return fmt.Errorf("IMAP ID requires an authenticated connection, current state: %v", state)
	}

	// RFC 2971 limits keys to 30 bytes, values to 1024 bytes and the pair count
	// to 30. Keep the identity deliberately small and free of account or host
	// data. A stable identity is sufficient for NetEase's client validation.
	fields := []interface{}{
		"name", "mailman",
		"version", "1.0",
		"vendor", "mailman",
	}
	status, err := c.Execute(&imap.Command{
		Name:      imapIDCommandName,
		Arguments: []interface{}{fields},
	}, imapIDResponseHandler{})
	if err != nil {
		return fmt.Errorf("IMAP ID command failed: %w", err)
	}
	if status == nil {
		return fmt.Errorf("IMAP ID command returned no status")
	}
	if err := status.Err(); err != nil {
		return fmt.Errorf("IMAP ID command was rejected: %w", err)
	}
	return nil
}

// initializeAuthenticatedIMAPClient runs provider-specific protocol setup in
// one place. It is intentionally a no-op for all other providers, preserving
// their existing command sequence and behavior.
func initializeAuthenticatedIMAPClient(c *client.Client, account models.EmailAccount) error {
	if !requiresIMAPClientID(account) {
		return nil
	}
	return sendIMAPClientID(c)
}
