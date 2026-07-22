package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type UintSlice []uint

func (s *UintSlice) Scan(value interface{}) error {
	if value == nil {
		*s = []uint{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return nil
	}
	return json.Unmarshal(bytes, s)
}

func (s UintSlice) Value() (driver.Value, error) {
	if len(s) == 0 {
		return "[]", nil
	}
	bytes, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	return string(bytes), nil
}

type ProxyType string

const (
	ProxyTypeHTTP   ProxyType = "http"
	ProxyTypeHTTPS  ProxyType = "https"
	ProxyTypeSSH    ProxyType = "ssh"
	ProxyTypeSocks5 ProxyType = "socks5"
)

type ProxyStatus string

const (
	ProxyStatusUnknown     ProxyStatus = "unknown"
	ProxyStatusAvailable   ProxyStatus = "available"
	ProxyStatusUnavailable ProxyStatus = "unavailable"
	ProxyStatusChecking    ProxyStatus = "checking"
)

type ProxyAccountMode string

const (
	ProxyAccountModeManual   ProxyAccountMode = "manual"
	ProxyAccountModeSelected ProxyAccountMode = "selected"
	ProxyAccountModeAuto     ProxyAccountMode = "auto"
)

type ProxyFallbackMode string

const (
	ProxyFallbackInterrupt  ProxyFallbackMode = "interrupt"
	ProxyFallbackManual     ProxyFallbackMode = "manual_backup"
	ProxyFallbackAutoSelect ProxyFallbackMode = "auto_select"
)

type ProxyTagFilterMode string

const (
	ProxyTagFilterOR  ProxyTagFilterMode = "or"
	ProxyTagFilterAND ProxyTagFilterMode = "and"
)

type ProxyGroup struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	OrgID       uint      `gorm:"not null;index;default:1" json:"orgId"`
	Name        string    `gorm:"not null;type:varchar(100);index" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	Color       string    `gorm:"type:varchar(20)" json:"color,omitempty"`
	SortOrder   int       `gorm:"default:0" json:"sortOrder"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	DeletedAt   DeletedAt `gorm:"index" json:"deletedAt,omitempty"`
}

type ProxyTag struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	OrgID     uint      `gorm:"not null;index;default:1" json:"orgId"`
	Name      string    `gorm:"not null;type:varchar(100);index" json:"name"`
	Color     string    `gorm:"type:varchar(20)" json:"color,omitempty"`
	SortOrder int       `gorm:"default:0" json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	DeletedAt DeletedAt `gorm:"index" json:"deletedAt,omitempty"`
}

// ProxyCheckChannel describes a server-side HTTP/API endpoint used to verify
// proxy egress or enrich a previously discovered exit IP. Credentials are
// intentionally omitted from JSON responses and are exposed only as a boolean.
type ProxyCheckChannel struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	OrgID          uint      `gorm:"not null;uniqueIndex:idx_proxy_check_channel_key;default:1" json:"orgId"`
	Key            string    `gorm:"not null;type:varchar(64);uniqueIndex:idx_proxy_check_channel_key" json:"key"`
	Name           string    `gorm:"not null;type:varchar(100)" json:"name"`
	Provider       string    `gorm:"type:varchar(64)" json:"provider,omitempty"`
	Description    string    `gorm:"type:text" json:"description,omitempty"`
	Mode           string    `gorm:"not null;type:varchar(16);default:'self'" json:"mode"`
	URLTemplate    string    `gorm:"not null;type:text" json:"urlTemplate"`
	Method         string    `gorm:"not null;type:varchar(8);default:'GET'" json:"method"`
	ResponseFormat string    `gorm:"not null;type:varchar(16);default:'json'" json:"responseFormat"`
	ResponseRegex  string    `gorm:"type:text" json:"responseRegex,omitempty"`
	IPField        string    `gorm:"type:varchar(128)" json:"ipField,omitempty"`
	CountryField   string    `gorm:"type:varchar(128)" json:"countryField,omitempty"`
	RegionField    string    `gorm:"type:varchar(128)" json:"regionField,omitempty"`
	CityField      string    `gorm:"type:varchar(128)" json:"cityField,omitempty"`
	ISPField       string    `gorm:"type:varchar(128)" json:"ispField,omitempty"`
	StatusField    string    `gorm:"type:varchar(128)" json:"statusField,omitempty"`
	FailureValue   string    `gorm:"type:varchar(64)" json:"failureValue,omitempty"`
	MessageField   string    `gorm:"type:varchar(128)" json:"messageField,omitempty"`
	Headers        JSONMap   `gorm:"type:json" json:"headers,omitempty"`
	AuthType       string    `gorm:"not null;type:varchar(16);default:'none'" json:"authType"`
	AuthName       string    `gorm:"type:varchar(100)" json:"authName,omitempty"`
	AuthValue      string    `gorm:"type:text" json:"-"`
	HasCredential  bool      `gorm:"-" json:"hasCredential"`
	Enabled        bool      `gorm:"not null;default:false;index" json:"enabled"`
	BuiltIn        bool      `gorm:"not null;default:false" json:"builtIn"`
	SupportsIPv4   bool      `gorm:"not null;default:false" json:"supportsIPv4"`
	SupportsIPv6   bool      `gorm:"not null;default:false" json:"supportsIPv6"`
	TimeoutSeconds int       `gorm:"not null;default:12" json:"timeoutSeconds"`
	SortOrder      int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
	DeletedAt      DeletedAt `gorm:"index" json:"deletedAt,omitempty"`
}

type ProxyPoolItem struct {
	ID              uint        `gorm:"primaryKey" json:"id"`
	OrgID           uint        `gorm:"not null;index;default:1" json:"orgId"`
	Type            ProxyType   `gorm:"not null;type:varchar(16);index" json:"type"`
	Host            string      `gorm:"not null;type:varchar(255);index" json:"host"`
	Port            int         `gorm:"not null;index" json:"port"`
	Username        string      `gorm:"type:varchar(255)" json:"username,omitempty"`
	Password        string      `gorm:"type:varchar(255)" json:"password,omitempty"`
	RefreshURL      string      `gorm:"type:text" json:"refreshUrl,omitempty"`
	Remark          string      `gorm:"type:text" json:"remark,omitempty"`
	GroupID         *uint       `gorm:"index" json:"groupId,omitempty"`
	Group           *ProxyGroup `gorm:"foreignKey:GroupID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"group,omitempty"`
	Tags            []ProxyTag  `gorm:"many2many:proxy_pool_item_tags;foreignKey:ID;joinForeignKey:ProxyID;References:ID;joinReferences:TagID" json:"tags,omitempty"`
	Status          ProxyStatus `gorm:"not null;default:'unknown';type:varchar(24);index" json:"status"`
	LastCheckAt     *time.Time  `json:"lastCheckAt,omitempty"`
	LastSuccessAt   *time.Time  `json:"lastSuccessAt,omitempty"`
	LastFailureAt   *time.Time  `json:"lastFailureAt,omitempty"`
	LastError       string      `gorm:"type:text" json:"lastError,omitempty"`
	CheckLatencyMs  int64       `gorm:"default:0" json:"checkLatencyMs"`
	ExitIP          string      `gorm:"type:varchar(128);index" json:"exitIp,omitempty"`
	Country         string      `gorm:"type:varchar(100)" json:"country,omitempty"`
	Region          string      `gorm:"type:varchar(100)" json:"region,omitempty"`
	City            string      `gorm:"type:varchar(100)" json:"city,omitempty"`
	ISP             string      `gorm:"type:varchar(255)" json:"isp,omitempty"`
	CheckCount      int         `gorm:"default:0" json:"checkCount"`
	SuccessCount    int         `gorm:"default:0" json:"successCount"`
	FailureCount    int         `gorm:"default:0" json:"failureCount"`
	TrafficBytesIn  int64       `gorm:"not null;default:0" json:"trafficBytesIn"`
	TrafficBytesOut int64       `gorm:"not null;default:0" json:"trafficBytesOut"`
	UsageScope      string      `gorm:"type:varchar(64);default:'shared';index" json:"usageScope"`
	Source          string      `gorm:"type:varchar(64)" json:"source,omitempty"`
	Metadata        JSONMap     `gorm:"type:json" json:"metadata,omitempty"`
	CreatedAt       time.Time   `json:"createdAt"`
	UpdatedAt       time.Time   `json:"updatedAt"`
	DeletedAt       DeletedAt   `gorm:"index" json:"deletedAt,omitempty"`
}

type ProxyPoolItemTag struct {
	ID        uint          `gorm:"primaryKey" json:"id"`
	ProxyID   uint          `gorm:"not null;uniqueIndex:idx_proxy_tag" json:"proxyId"`
	TagID     uint          `gorm:"not null;uniqueIndex:idx_proxy_tag" json:"tagId"`
	Proxy     ProxyPoolItem `gorm:"foreignKey:ProxyID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Tag       ProxyTag      `gorm:"foreignKey:TagID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"tag,omitempty"`
	CreatedAt time.Time     `json:"createdAt"`
}

func (ProxyGroup) TableName() string {
	return "proxy_groups"
}

func (ProxyTag) TableName() string {
	return "proxy_tags"
}

func (ProxyCheckChannel) TableName() string {
	return "proxy_check_channels"
}

func (ProxyPoolItem) TableName() string {
	return "proxy_pool_items"
}

func (ProxyPoolItemTag) TableName() string {
	return "proxy_pool_item_tags"
}

func NormalizeProxyType(proxyType ProxyType) ProxyType {
	switch ProxyType(strings.ToLower(strings.TrimSpace(string(proxyType)))) {
	case ProxyTypeHTTP:
		return ProxyTypeHTTP
	case ProxyTypeHTTPS:
		return ProxyTypeHTTPS
	case ProxyTypeSSH:
		return ProxyTypeSSH
	case ProxyTypeSocks5:
		return ProxyTypeSocks5
	default:
		return ProxyTypeHTTP
	}
}

func NormalizeProxyStatus(status ProxyStatus) ProxyStatus {
	switch ProxyStatus(strings.ToLower(strings.TrimSpace(string(status)))) {
	case ProxyStatusAvailable:
		return ProxyStatusAvailable
	case ProxyStatusUnavailable:
		return ProxyStatusUnavailable
	case ProxyStatusChecking:
		return ProxyStatusChecking
	default:
		return ProxyStatusUnknown
	}
}

func NormalizeProxyAccountMode(mode ProxyAccountMode) ProxyAccountMode {
	switch ProxyAccountMode(strings.ToLower(strings.TrimSpace(string(mode)))) {
	case ProxyAccountModeSelected:
		return ProxyAccountModeSelected
	case ProxyAccountModeAuto:
		return ProxyAccountModeAuto
	default:
		return ProxyAccountModeManual
	}
}

func NormalizeProxyFallbackMode(mode ProxyFallbackMode) ProxyFallbackMode {
	switch ProxyFallbackMode(strings.ToLower(strings.TrimSpace(string(mode)))) {
	case ProxyFallbackManual:
		return ProxyFallbackManual
	case ProxyFallbackAutoSelect:
		return ProxyFallbackAutoSelect
	default:
		return ProxyFallbackInterrupt
	}
}

func NormalizeProxyTagFilterMode(mode ProxyTagFilterMode) ProxyTagFilterMode {
	if ProxyTagFilterMode(strings.ToLower(strings.TrimSpace(string(mode)))) == ProxyTagFilterAND {
		return ProxyTagFilterAND
	}
	return ProxyTagFilterOR
}

func (p ProxyPoolItem) Address() string {
	host := p.Host
	if strings.Contains(host, ":") && net.ParseIP(host) != nil {
		host = "[" + host + "]"
	}
	return net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(p.Port))
}

func (p ProxyPoolItem) ProxyURL() string {
	proxyType := string(NormalizeProxyType(p.Type))
	host := p.Host
	if strings.Contains(host, ":") && net.ParseIP(host) != nil {
		host = "[" + host + "]"
	}
	u := url.URL{
		Scheme: proxyType,
		Host:   net.JoinHostPort(strings.Trim(host, "[]"), strconv.Itoa(p.Port)),
	}
	if p.Username != "" {
		u.User = url.UserPassword(p.Username, p.Password)
	}
	return u.String()
}

func (p ProxyPoolItem) DisplayAddress() string {
	credentials := ""
	if p.Username != "" {
		credentials = fmt.Sprintf("%s:***@", p.Username)
	}
	return fmt.Sprintf("%s://%s%s", NormalizeProxyType(p.Type), credentials, p.Address())
}
