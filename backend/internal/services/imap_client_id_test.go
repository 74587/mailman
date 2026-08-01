package services

import (
	"bufio"
	"fmt"
	"net"
	"strings"
	"testing"

	"mailman/internal/models"

	"github.com/emersion/go-imap/client"
)

func testIMAPAccount(providerType models.MailProviderType, server, email string) models.EmailAccount {
	return models.EmailAccount{
		EmailAddress: email,
		MailProvider: &models.MailProvider{
			Type:       providerType,
			IMAPServer: server,
		},
	}
}

func TestRequiresIMAPClientID(t *testing.T) {
	tests := []struct {
		name    string
		account models.EmailAccount
		want    bool
	}{
		{name: "built-in 163", account: testIMAPAccount(models.ProviderTypeNetEase163, "custom.example.com", "user@example.com"), want: true},
		{name: "built-in 126", account: testIMAPAccount(models.ProviderTypeNetEase126, "custom.example.com", "user@example.com"), want: true},
		{name: "custom 163 server", account: testIMAPAccount(models.ProviderTypeCustom, "IMAP.163.COM.", "user@example.com"), want: true},
		{name: "custom account domain does not alter protocol", account: testIMAPAccount(models.ProviderTypeCustom, "mail.example.com", "user@163.com"), want: false},
		{name: "gmail", account: testIMAPAccount(models.ProviderTypeGmail, "imap.gmail.com", "user@gmail.com"), want: false},
		{name: "missing provider", account: models.EmailAccount{EmailAddress: "user@example.com"}, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := requiresIMAPClientID(tt.account); got != tt.want {
				t.Fatalf("requiresIMAPClientID() = %v, want %v", got, tt.want)
			}
		})
	}
}

func startScriptedIMAPServer(t *testing.T, rejectID bool) (net.Conn, <-chan string) {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	commands := make(chan string, 8)

	go func() {
		defer serverConn.Close()
		defer close(commands)
		reader := bufio.NewReader(serverConn)
		writer := bufio.NewWriter(serverConn)
		_, _ = writer.WriteString("* OK [CAPABILITY IMAP4rev1] test server ready\r\n")
		_ = writer.Flush()

		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			fields := strings.Fields(line)
			if len(fields) < 2 {
				return
			}
			tag := fields[0]
			command := strings.ToUpper(fields[1])
			commands <- command

			switch command {
			case "LOGIN":
				_, _ = fmt.Fprintf(writer, "%s OK LOGIN completed\r\n", tag)
			case "ID":
				if rejectID {
					_, _ = fmt.Fprintf(writer, "%s NO ID rejected\r\n", tag)
				} else {
					_, _ = writer.WriteString("* ID (\"name\" \"test-server\")\r\n")
					_, _ = fmt.Fprintf(writer, "%s OK ID completed\r\n", tag)
				}
			case "SELECT":
				_, _ = writer.WriteString("* FLAGS (\\Seen \\Answered \\Deleted)\r\n")
				_, _ = writer.WriteString("* 0 EXISTS\r\n")
				_, _ = writer.WriteString("* 0 RECENT\r\n")
				_, _ = fmt.Fprintf(writer, "%s OK [READ-WRITE] SELECT completed\r\n", tag)
			case "LOGOUT":
				_, _ = writer.WriteString("* BYE logging out\r\n")
				_, _ = fmt.Fprintf(writer, "%s OK LOGOUT completed\r\n", tag)
				_ = writer.Flush()
				return
			default:
				_, _ = fmt.Fprintf(writer, "%s BAD unsupported command\r\n", tag)
			}
			if err := writer.Flush(); err != nil {
				return
			}
		}
	}()

	return clientConn, commands
}

func collectIMAPCommands(commands <-chan string) []string {
	var result []string
	for command := range commands {
		result = append(result, command)
	}
	return result
}

func TestInitializeAuthenticatedIMAPClientSendsIDBeforeSelect(t *testing.T) {
	conn, commands := startScriptedIMAPServer(t, false)
	c, err := client.New(conn)
	if err != nil {
		t.Fatalf("new IMAP client: %v", err)
	}
	if err := c.Login("user@163.com", "password"); err != nil {
		t.Fatalf("login: %v", err)
	}
	account := testIMAPAccount(models.ProviderTypeNetEase163, "imap.163.com", "user@163.com")
	if err := initializeAuthenticatedIMAPClient(c, account); err != nil {
		t.Fatalf("initialize authenticated client: %v", err)
	}
	if _, err := c.Select("INBOX", false); err != nil {
		t.Fatalf("select: %v", err)
	}
	if err := c.Logout(); err != nil {
		t.Fatalf("logout: %v", err)
	}

	got := strings.Join(collectIMAPCommands(commands), ",")
	if got != "LOGIN,ID,SELECT,LOGOUT" {
		t.Fatalf("command order = %s, want LOGIN,ID,SELECT,LOGOUT", got)
	}
}

func TestInitializeAuthenticatedIMAPClientLeavesOtherProvidersUnchanged(t *testing.T) {
	conn, commands := startScriptedIMAPServer(t, false)
	c, err := client.New(conn)
	if err != nil {
		t.Fatalf("new IMAP client: %v", err)
	}
	if err := c.Login("user@gmail.com", "password"); err != nil {
		t.Fatalf("login: %v", err)
	}
	account := testIMAPAccount(models.ProviderTypeGmail, "imap.gmail.com", "user@gmail.com")
	if err := initializeAuthenticatedIMAPClient(c, account); err != nil {
		t.Fatalf("initialize authenticated client: %v", err)
	}
	if _, err := c.Select("INBOX", false); err != nil {
		t.Fatalf("select: %v", err)
	}
	if err := c.Logout(); err != nil {
		t.Fatalf("logout: %v", err)
	}

	got := strings.Join(collectIMAPCommands(commands), ",")
	if got != "LOGIN,SELECT,LOGOUT" {
		t.Fatalf("command order = %s, want LOGIN,SELECT,LOGOUT", got)
	}
}

func TestInitializeAuthenticatedIMAPClientPropagatesIDRejection(t *testing.T) {
	conn, commands := startScriptedIMAPServer(t, true)
	c, err := client.New(conn)
	if err != nil {
		t.Fatalf("new IMAP client: %v", err)
	}
	if err := c.Login("user@163.com", "password"); err != nil {
		t.Fatalf("login: %v", err)
	}
	account := testIMAPAccount(models.ProviderTypeNetEase163, "imap.163.com", "user@163.com")
	if err := initializeAuthenticatedIMAPClient(c, account); err == nil || !strings.Contains(err.Error(), "rejected") {
		t.Fatalf("ID rejection error = %v", err)
	}
	_ = c.Logout()

	got := strings.Join(collectIMAPCommands(commands), ",")
	if !strings.HasPrefix(got, "LOGIN,ID") {
		t.Fatalf("command order = %s, want LOGIN,ID prefix", got)
	}
}
