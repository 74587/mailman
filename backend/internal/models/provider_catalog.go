package models

import "strings"

const (
	ProviderTypeYahoo      MailProviderType = "yahoo"
	ProviderTypeAOL        MailProviderType = "aol"
	ProviderTypeFastmail   MailProviderType = "fastmail"
	ProviderTypeYandex     MailProviderType = "yandex"
	ProviderTypeMailRu     MailProviderType = "mailru"
	ProviderTypeComcast    MailProviderType = "comcast"
	ProviderTypeICloud     MailProviderType = "icloud"
	ProviderTypeZoho       MailProviderType = "zoho"
	ProviderTypeQQ         MailProviderType = "qq"
	ProviderTypeNetEase163 MailProviderType = "netease163"
	ProviderTypeNetEase126 MailProviderType = "netease126"
)

// OAuth2ProviderDefinition describes the provider-specific OAuth2 details
// needed to create authorization URLs and exchange/refresh tokens.
type OAuth2ProviderDefinition struct {
	Type                 MailProviderType
	Name                 string
	AuthURL              string
	TokenURL             string
	Scopes               []string
	UsePKCE              bool
	ClientSecretRequired bool
	Domains              []string
}

// MailProviderDefinition describes a built-in IMAP/SMTP preset.
type MailProviderDefinition struct {
	Name       string
	Type       MailProviderType
	IMAPServer string
	IMAPPort   int
	SMTPServer string
	SMTPPort   int
	Domains    []string
}

var defaultMailProviderDefinitions = []MailProviderDefinition{
	{
		Name: "Gmail", Type: ProviderTypeGmail,
		IMAPServer: "imap.gmail.com", IMAPPort: 993,
		SMTPServer: "smtp.gmail.com", SMTPPort: 587,
		Domains: []string{"gmail.com", "googlemail.com"},
	},
	{
		Name: "Outlook", Type: ProviderTypeOutlook,
		IMAPServer: "outlook.office365.com", IMAPPort: 993,
		SMTPServer: "smtp.office365.com", SMTPPort: 587,
		Domains: []string{"outlook.com", "hotmail.com", "live.com", "msn.com", "office365.com"},
	},
	{
		Name: "Yahoo", Type: ProviderTypeYahoo,
		IMAPServer: "imap.mail.yahoo.com", IMAPPort: 993,
		SMTPServer: "smtp.mail.yahoo.com", SMTPPort: 587,
		Domains: []string{"yahoo.com", "ymail.com", "rocketmail.com", "att.net"},
	},
	{
		Name: "AOL", Type: ProviderTypeAOL,
		IMAPServer: "imap.aol.com", IMAPPort: 993,
		SMTPServer: "smtp.aol.com", SMTPPort: 587,
		Domains: []string{"aol.com"},
	},
	{
		Name: "iCloud", Type: ProviderTypeICloud,
		IMAPServer: "imap.mail.me.com", IMAPPort: 993,
		SMTPServer: "smtp.mail.me.com", SMTPPort: 587,
		Domains: []string{"icloud.com", "me.com", "mac.com"},
	},
	{
		Name: "Fastmail", Type: ProviderTypeFastmail,
		IMAPServer: "imap.fastmail.com", IMAPPort: 993,
		SMTPServer: "smtp.fastmail.com", SMTPPort: 587,
		Domains: []string{"fastmail.com", "fastmail.fm"},
	},
	{
		Name: "Yandex", Type: ProviderTypeYandex,
		IMAPServer: "imap.yandex.com", IMAPPort: 993,
		SMTPServer: "smtp.yandex.com", SMTPPort: 587,
		Domains: []string{"yandex.com", "yandex.ru", "ya.ru"},
	},
	{
		Name: "Mail.ru", Type: ProviderTypeMailRu,
		IMAPServer: "imap.mail.ru", IMAPPort: 993,
		SMTPServer: "smtp.mail.ru", SMTPPort: 587,
		Domains: []string{"mail.ru", "inbox.ru", "list.ru", "bk.ru"},
	},
	{
		Name: "Zoho", Type: ProviderTypeZoho,
		IMAPServer: "imap.zoho.com", IMAPPort: 993,
		SMTPServer: "smtp.zoho.com", SMTPPort: 587,
		Domains: []string{"zoho.com", "zohomail.com"},
	},
	{
		Name: "QQ Mail", Type: ProviderTypeQQ,
		IMAPServer: "imap.qq.com", IMAPPort: 993,
		SMTPServer: "smtp.qq.com", SMTPPort: 587,
		Domains: []string{"qq.com", "foxmail.com"},
	},
	{
		Name: "163 Mail", Type: ProviderTypeNetEase163,
		IMAPServer: "imap.163.com", IMAPPort: 993,
		SMTPServer: "smtp.163.com", SMTPPort: 465,
		Domains: []string{"163.com"},
	},
	{
		Name: "126 Mail", Type: ProviderTypeNetEase126,
		IMAPServer: "imap.126.com", IMAPPort: 993,
		SMTPServer: "smtp.126.com", SMTPPort: 465,
		Domains: []string{"126.com"},
	},
	{
		Name: "Comcast", Type: ProviderTypeComcast,
		IMAPServer: "imap.comcast.net", IMAPPort: 993,
		SMTPServer: "smtp.comcast.net", SMTPPort: 587,
		Domains: []string{"comcast.net", "xfinity.com"},
	},
}

var oauth2ProviderDefinitions = []OAuth2ProviderDefinition{
	{
		Type: ProviderTypeGmail, Name: "Gmail",
		AuthURL:  "https://accounts.google.com/o/oauth2/auth",
		TokenURL: "https://oauth2.googleapis.com/token",
		Scopes: []string{
			"https://mail.google.com/",
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile",
		},
		UsePKCE: true,
		Domains: []string{"gmail.com", "googlemail.com"},
	},
	{
		Type: ProviderTypeOutlook, Name: "Outlook",
		AuthURL:  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
		TokenURL: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
		Scopes: []string{
			"https://outlook.office.com/IMAP.AccessAsUser.All",
			"https://outlook.office.com/POP.AccessAsUser.All",
			"https://outlook.office.com/SMTP.Send",
			"offline_access",
		},
		Domains: []string{"outlook.com", "hotmail.com", "live.com", "msn.com", "office365.com"},
	},
	{
		Type: ProviderTypeYahoo, Name: "Yahoo",
		AuthURL:  "https://api.login.yahoo.com/oauth2/request_auth",
		TokenURL: "https://api.login.yahoo.com/oauth2/get_token",
		Scopes:   []string{"mail-w", "ycal-w", "sdct-w"},
		UsePKCE:  true,
		Domains:  []string{"yahoo.com", "ymail.com", "rocketmail.com", "att.net"},
	},
	{
		Type: ProviderTypeAOL, Name: "AOL",
		AuthURL:  "https://api.login.aol.com/oauth2/request_auth",
		TokenURL: "https://api.login.aol.com/oauth2/get_token",
		Scopes:   []string{"mail-w", "ycal-w", "sdct-w"},
		UsePKCE:  true,
		Domains:  []string{"aol.com"},
	},
	{
		Type: ProviderTypeFastmail, Name: "Fastmail",
		AuthURL:  "https://api.fastmail.com/oauth/authorize",
		TokenURL: "https://api.fastmail.com/oauth/refresh",
		Scopes: []string{
			"https://www.fastmail.com/dev/protocol-imap",
			"https://www.fastmail.com/dev/protocol-smtp",
		},
		UsePKCE: true,
		Domains: []string{"fastmail.com", "fastmail.fm"},
	},
	{
		Type: ProviderTypeYandex, Name: "Yandex",
		AuthURL:  "https://oauth.yandex.com/authorize",
		TokenURL: "https://oauth.yandex.com/token",
		Scopes:   []string{"mail:imap_full", "mail:smtp"},
		Domains:  []string{"yandex.com", "yandex.ru", "ya.ru"},
	},
	{
		Type: ProviderTypeMailRu, Name: "Mail.ru",
		AuthURL:  "https://o2.mail.ru/login",
		TokenURL: "https://o2.mail.ru/token",
		Scopes:   []string{"mail.imap"},
		Domains:  []string{"mail.ru", "inbox.ru", "list.ru", "bk.ru"},
	},
	{
		Type: ProviderTypeComcast, Name: "Comcast",
		AuthURL:  "https://oauth.xfinity.com/oauth/authorize",
		TokenURL: "https://oauth.xfinity.com/oauth/token",
		Scopes:   []string{"https://email.comcast.net/", "profile", "openid"},
		UsePKCE:  true,
		Domains:  []string{"comcast.net", "xfinity.com"},
	},
}

func DefaultMailProviderDefinitions() []MailProviderDefinition {
	return append([]MailProviderDefinition(nil), defaultMailProviderDefinitions...)
}

func OAuth2ProviderDefinitions() []OAuth2ProviderDefinition {
	return append([]OAuth2ProviderDefinition(nil), oauth2ProviderDefinitions...)
}

func GetOAuth2ProviderDefinition(providerType MailProviderType) (OAuth2ProviderDefinition, bool) {
	normalized := NormalizeMailProviderType(providerType)
	for _, provider := range oauth2ProviderDefinitions {
		if provider.Type == normalized {
			return provider, true
		}
	}
	return OAuth2ProviderDefinition{}, false
}

func DefaultOAuth2Scopes(providerType MailProviderType) StringSlice {
	if provider, ok := GetOAuth2ProviderDefinition(providerType); ok {
		return StringSlice(append([]string(nil), provider.Scopes...))
	}
	return StringSlice{}
}

func OAuth2ClientSecretRequired(providerType MailProviderType) bool {
	if provider, ok := GetOAuth2ProviderDefinition(providerType); ok {
		return provider.ClientSecretRequired
	}
	return false
}

func NormalizeMailProviderType(providerType MailProviderType) MailProviderType {
	return MailProviderType(strings.ToLower(strings.TrimSpace(string(providerType))))
}

func InferMailProviderTypeFromEmail(email string) MailProviderType {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(email)), "@")
	if len(parts) != 2 {
		return ""
	}
	domain := parts[1]
	for _, provider := range defaultMailProviderDefinitions {
		for _, candidate := range provider.Domains {
			if domain == candidate {
				return provider.Type
			}
		}
	}
	return ""
}
