package models

import (
	"time"

	"golang.org/x/crypto/bcrypt"
)

type ProxyGatewayProtocol string

const (
	ProxyGatewayProtocolHTTP   ProxyGatewayProtocol = "http"
	ProxyGatewayProtocolSocks5 ProxyGatewayProtocol = "socks5"
	ProxyGatewayProtocolMixed  ProxyGatewayProtocol = "mixed"
)

type ProxyGatewaySelectionMode string

const (
	ProxyGatewaySelectionAll      ProxyGatewaySelectionMode = "all"
	ProxyGatewaySelectionFiltered ProxyGatewaySelectionMode = "filtered"
	ProxyGatewaySelectionExplicit ProxyGatewaySelectionMode = "explicit"
)

type ProxyGatewaySelectionSource string

const (
	// Account mode preserves the original account-level proxy pool, scheduling,
	// and fallback behavior for existing clients.
	ProxyGatewaySelectionSourceAccount ProxyGatewaySelectionSource = "account"
	// Gateway mode requires the gateway route table (or an explicitly requested
	// username route strategy) to choose the proxy policy.
	ProxyGatewaySelectionSourceGateway ProxyGatewaySelectionSource = "gateway"
)

func (source ProxyGatewaySelectionSource) IsValid() bool {
	return source == ProxyGatewaySelectionSourceAccount || source == ProxyGatewaySelectionSourceGateway
}

type ProxyGatewayUsernameRoutingMode string

const (
	// Strategy keeps the original behavior: username#N selects the route
	// strategy whose flag number is N.
	ProxyGatewayUsernameRoutingStrategy ProxyGatewayUsernameRoutingMode = "strategy"
	// ProxyIndex defers username#N until the target route has selected a pool,
	// then selects the Nth proxy from that pool.
	ProxyGatewayUsernameRoutingProxyIndex ProxyGatewayUsernameRoutingMode = "proxy_index"
)

func (mode ProxyGatewayUsernameRoutingMode) IsValid() bool {
	return mode == ProxyGatewayUsernameRoutingStrategy || mode == ProxyGatewayUsernameRoutingProxyIndex
}

func EffectiveProxyGatewayUsernameRoutingMode(mode ProxyGatewayUsernameRoutingMode) ProxyGatewayUsernameRoutingMode {
	if mode == ProxyGatewayUsernameRoutingProxyIndex {
		return mode
	}
	return ProxyGatewayUsernameRoutingStrategy
}

type ProxyGatewayIndexOverflowMode string

const (
	ProxyGatewayIndexOverflowReject ProxyGatewayIndexOverflowMode = "reject"
	ProxyGatewayIndexOverflowModulo ProxyGatewayIndexOverflowMode = "modulo"
)

func (mode ProxyGatewayIndexOverflowMode) IsValid() bool {
	return mode == ProxyGatewayIndexOverflowReject || mode == ProxyGatewayIndexOverflowModulo
}

func EffectiveProxyGatewayIndexOverflowMode(mode ProxyGatewayIndexOverflowMode) ProxyGatewayIndexOverflowMode {
	if mode == ProxyGatewayIndexOverflowModulo {
		return mode
	}
	return ProxyGatewayIndexOverflowReject
}

type ProxyGatewaySelectionAlgorithm string

const (
	ProxyGatewayAlgorithmRandom         ProxyGatewaySelectionAlgorithm = "random"
	ProxyGatewayAlgorithmRoundRobin     ProxyGatewaySelectionAlgorithm = "round_robin"
	ProxyGatewayAlgorithmWeighted       ProxyGatewaySelectionAlgorithm = "weighted"
	ProxyGatewayAlgorithmLowestLatency  ProxyGatewaySelectionAlgorithm = "lowest_latency"
	ProxyGatewayAlgorithmPreferLastGood ProxyGatewaySelectionAlgorithm = "prefer_last_success"
)

type ProxyGatewayFallbackMode string

const (
	ProxyGatewayFallbackInterrupt ProxyGatewayFallbackMode = "interrupt"
	ProxyGatewayFallbackRetry     ProxyGatewayFallbackMode = "retry"
	ProxyGatewayFallbackBackup    ProxyGatewayFallbackMode = "backup_pool"
	ProxyGatewayFallbackDirect    ProxyGatewayFallbackMode = "direct"
)

type ProxyGatewayStickyMode string

const (
	ProxyGatewayStickyNone       ProxyGatewayStickyMode = "none"
	ProxyGatewayStickyAccount    ProxyGatewayStickyMode = "account"
	ProxyGatewayStickyClientIP   ProxyGatewayStickyMode = "client_ip"
	ProxyGatewayStickyTargetHost ProxyGatewayStickyMode = "target_host"
	ProxyGatewayStickyClientHost ProxyGatewayStickyMode = "client_ip_target_host"
)

type ProxyGatewayDNSMode string

const (
	ProxyGatewayDNSRemote ProxyGatewayDNSMode = "remote"
	ProxyGatewayDNSLocal  ProxyGatewayDNSMode = "local"
	ProxyGatewayDNSCustom ProxyGatewayDNSMode = "custom"
)

type ProxyGatewayPolicyAction string

const (
	ProxyGatewayPolicyDeny    ProxyGatewayPolicyAction = "deny"
	ProxyGatewayPolicyAllow   ProxyGatewayPolicyAction = "allow"
	ProxyGatewayPolicyLogOnly ProxyGatewayPolicyAction = "log_only"
)

type ProxyGatewayMultiIPStrategy string

const (
	ProxyGatewayMultiIPCheckAll  ProxyGatewayMultiIPStrategy = "check_all"
	ProxyGatewayMultiIPFirstOnly ProxyGatewayMultiIPStrategy = "first_only"
	ProxyGatewayMultiIPRejectAny ProxyGatewayMultiIPStrategy = "reject_private"
)

type ProxyGatewayResolveFailureAction string

const (
	ProxyGatewayResolveFailureDeny           ProxyGatewayResolveFailureAction = "deny"
	ProxyGatewayResolveFailureUseRemoteProxy ProxyGatewayResolveFailureAction = "remote_fallback"
)

type ProxyGatewayListener struct {
	ID                      uint                        `gorm:"primaryKey" json:"id"`
	OrgID                   uint                        `gorm:"not null;index;default:1" json:"orgId"`
	Name                    string                      `gorm:"not null;type:varchar(120)" json:"name"`
	ListenIP                string                      `gorm:"not null;type:varchar(128);default:'127.0.0.1'" json:"listenIp"`
	ExternalHost            string                      `gorm:"type:varchar(255)" json:"externalHost,omitempty"`
	ExternalPort            int                         `gorm:"not null;default:0" json:"externalPort,omitempty"`
	Port                    int                         `gorm:"not null;index" json:"port"`
	Protocol                ProxyGatewayProtocol        `gorm:"not null;type:varchar(16);default:'mixed'" json:"protocol"`
	Enabled                 bool                        `gorm:"not null;default:false" json:"enabled"`
	IsDefault               bool                        `gorm:"not null;default:false;index" json:"isDefault"`
	AllowPublicListen       bool                        `gorm:"not null;default:false" json:"allowPublicListen"`
	RequireAuth             bool                        `gorm:"not null;default:true" json:"requireAuth"`
	SecurityPolicyID        *uint                       `gorm:"index" json:"securityPolicyId,omitempty"`
	SecurityPolicy          *ProxyGatewaySecurityPolicy `gorm:"foreignKey:SecurityPolicyID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"securityPolicy,omitempty"`
	DNSPolicyID             *uint                       `gorm:"index" json:"dnsPolicyId,omitempty"`
	DNSPolicy               *ProxyGatewayDNSPolicy      `gorm:"foreignKey:DNSPolicyID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"dnsPolicy,omitempty"`
	HandshakeTimeoutSeconds int                         `gorm:"not null;default:10" json:"handshakeTimeoutSeconds"`
	IdleTimeoutSeconds      int                         `gorm:"not null;default:120" json:"idleTimeoutSeconds"`
	ConnectTimeoutSeconds   int                         `gorm:"not null;default:30" json:"connectTimeoutSeconds"`
	UsernameRouteSeparators StringSlice                 `gorm:"type:json" json:"usernameRouteSeparators,omitempty"`
	Metadata                JSONMapInterface            `gorm:"type:json" json:"metadata,omitempty"`
	CreatedAt               time.Time                   `json:"createdAt"`
	UpdatedAt               time.Time                   `json:"updatedAt"`
	DeletedAt               DeletedAt                   `gorm:"index" json:"deletedAt,omitempty"`
}

type ProxyGatewayAccount struct {
	ID                      uint                                       `gorm:"primaryKey" json:"id"`
	OrgID                   uint                                       `gorm:"not null;index;default:1;uniqueIndex:idx_proxy_gateway_account_username" json:"orgId"`
	Username                string                                     `gorm:"not null;type:varchar(160);uniqueIndex:idx_proxy_gateway_account_username" json:"username"`
	PasswordHash            string                                     `gorm:"not null" json:"-"`
	Password                string                                     `gorm:"type:text" json:"password,omitempty"`
	Name                    string                                     `gorm:"type:varchar(160)" json:"name,omitempty"`
	Remark                  string                                     `gorm:"type:text" json:"remark,omitempty"`
	Enabled                 bool                                       `gorm:"not null;default:true" json:"enabled"`
	ExpiresAt               *time.Time                                 `json:"expiresAt,omitempty"`
	AllowAllGateways        bool                                       `gorm:"not null;default:false" json:"allowAllGateways"`
	AllowedGatewayIDs       UintSlice                                  `gorm:"type:json" json:"allowedGatewayIds,omitempty"`
	GroupID                 *uint                                      `gorm:"index" json:"groupId,omitempty"`
	Group                   *ProxyGatewayAccountGroup                  `gorm:"foreignKey:GroupID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"group,omitempty"`
	Tags                    []ProxyGatewayAccountTag                   `gorm:"many2many:proxy_gateway_account_tag_links;foreignKey:ID;joinForeignKey:AccountID;References:ID;joinReferences:TagID" json:"tags,omitempty"`
	ProxySelectionSource    ProxyGatewaySelectionSource                `gorm:"type:varchar(16);not null;default:'account'" json:"proxySelectionSource"`
	SelectionMode           ProxyGatewaySelectionMode                  `gorm:"type:varchar(24);not null;default:'filtered'" json:"selectionMode"`
	ProxyIDs                UintSlice                                  `gorm:"type:json" json:"proxyIds,omitempty"`
	ProxyMatchGroupIDs      UintSlice                                  `gorm:"type:json" json:"proxyMatchGroupIds,omitempty"`
	ProxyMatchTagIDs        UintSlice                                  `gorm:"type:json" json:"proxyMatchTagIds,omitempty"`
	ProxyMatchTagMode       ProxyTagFilterMode                         `gorm:"type:varchar(8);not null;default:'or'" json:"proxyMatchTagMode"`
	SelectionAlgorithm      ProxyGatewaySelectionAlgorithm             `gorm:"type:varchar(32);not null;default:'random'" json:"selectionAlgorithm"`
	StickyMode              ProxyGatewayStickyMode                     `gorm:"type:varchar(32);not null;default:'none'" json:"stickyMode"`
	StickyTTLSeconds        int                                        `gorm:"not null;default:600" json:"stickyTtlSeconds"`
	PreferLastSuccess       bool                                       `gorm:"not null;default:false" json:"preferLastSuccess"`
	FallbackMode            ProxyGatewayFallbackMode                   `gorm:"type:varchar(24);not null;default:'interrupt'" json:"fallbackMode"`
	FallbackProxyIDs        UintSlice                                  `gorm:"type:json" json:"fallbackProxyIds,omitempty"`
	FallbackGroupIDs        UintSlice                                  `gorm:"type:json" json:"fallbackGroupIds,omitempty"`
	FallbackTagIDs          UintSlice                                  `gorm:"type:json" json:"fallbackTagIds,omitempty"`
	FallbackTagMode         ProxyTagFilterMode                         `gorm:"type:varchar(8);not null;default:'or'" json:"fallbackTagMode"`
	MaxRetries              int                                        `gorm:"not null;default:2" json:"maxRetries"`
	AllowDirectFallback     bool                                       `gorm:"not null;default:false" json:"allowDirectFallback"`
	SecurityPolicyID        *uint                                      `gorm:"index" json:"securityPolicyId,omitempty"`
	SecurityPolicy          *ProxyGatewaySecurityPolicy                `gorm:"foreignKey:SecurityPolicyID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"securityPolicy,omitempty"`
	DNSPolicyID             *uint                                      `gorm:"index" json:"dnsPolicyId,omitempty"`
	DNSPolicy               *ProxyGatewayDNSPolicy                     `gorm:"foreignKey:DNSPolicyID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"dnsPolicy,omitempty"`
	MaxConcurrent           int                                        `gorm:"not null;default:0" json:"maxConcurrent"`
	RateLimitPerMinute      int                                        `gorm:"not null;default:0" json:"rateLimitPerMinute"`
	BandwidthLimitKBps      int                                        `gorm:"not null;default:0" json:"bandwidthLimitKbps"`
	ConnectTimeoutSeconds   int                                        `gorm:"not null;default:30" json:"connectTimeoutSeconds"`
	IdleTimeoutSeconds      int                                        `gorm:"not null;default:120" json:"idleTimeoutSeconds"`
	MaxSessionSeconds       int                                        `gorm:"not null;default:0" json:"maxSessionSeconds"`
	EnableUsernameRouting   bool                                       `gorm:"not null;default:false" json:"enableUsernameRouting"`
	UsernameRoutingMode     ProxyGatewayUsernameRoutingMode            `gorm:"type:varchar(24);not null;default:'strategy'" json:"usernameRoutingMode"`
	ProxyIndexOverflowMode  ProxyGatewayIndexOverflowMode              `gorm:"type:varchar(16);not null;default:'reject'" json:"proxyIndexOverflowMode"`
	AllowAllRouteStrategies bool                                       `gorm:"not null;default:false" json:"allowAllRouteStrategies"`
	AllowedRouteStrategyIDs UintSlice                                  `gorm:"type:json" json:"allowedRouteStrategyIds,omitempty"`
	RouteStrategyOverrides  []ProxyGatewayAccountRouteStrategyOverride `gorm:"foreignKey:AccountID" json:"routeStrategyOverrides,omitempty"`
	LastUsedAt              *time.Time                                 `json:"lastUsedAt,omitempty"`
	CreatedAt               time.Time                                  `json:"createdAt"`
	UpdatedAt               time.Time                                  `json:"updatedAt"`
	DeletedAt               DeletedAt                                  `gorm:"index" json:"deletedAt,omitempty"`
}

type ProxyGatewayRouteStrategy struct {
	ID                     uint                           `gorm:"primaryKey" json:"id"`
	OrgID                  uint                           `gorm:"not null;index;default:1;uniqueIndex:idx_proxy_gateway_route_flag" json:"orgId"`
	GatewayID              uint                           `gorm:"not null;index;default:0;uniqueIndex:idx_proxy_gateway_route_flag" json:"gatewayId"`
	Name                   string                         `gorm:"not null;type:varchar(160);index" json:"name"`
	FlagNo                 int                            `gorm:"not null;uniqueIndex:idx_proxy_gateway_route_flag" json:"flagNo"`
	Description            string                         `gorm:"type:text" json:"description,omitempty"`
	Enabled                bool                           `gorm:"not null;default:true" json:"enabled"`
	SelectionMode          ProxyGatewaySelectionMode      `gorm:"type:varchar(24);not null;default:'filtered'" json:"selectionMode"`
	ProxyIDs               UintSlice                      `gorm:"type:json" json:"proxyIds,omitempty"`
	ProxyMatchGroupIDs     UintSlice                      `gorm:"type:json" json:"proxyMatchGroupIds,omitempty"`
	ProxyMatchTagIDs       UintSlice                      `gorm:"type:json" json:"proxyMatchTagIds,omitempty"`
	ProxyMatchTagMode      ProxyTagFilterMode             `gorm:"type:varchar(8);not null;default:'or'" json:"proxyMatchTagMode"`
	SelectionAlgorithm     ProxyGatewaySelectionAlgorithm `gorm:"type:varchar(32);not null;default:'random'" json:"selectionAlgorithm"`
	ProxyIndexOverflowMode ProxyGatewayIndexOverflowMode  `gorm:"type:varchar(16);not null;default:'reject'" json:"proxyIndexOverflowMode"`
	StickyMode             ProxyGatewayStickyMode         `gorm:"type:varchar(32);not null;default:'none'" json:"stickyMode"`
	StickyTTLSeconds       int                            `gorm:"not null;default:600" json:"stickyTtlSeconds"`
	PreferLastSuccess      bool                           `gorm:"not null;default:false" json:"preferLastSuccess"`
	FallbackMode           ProxyGatewayFallbackMode       `gorm:"type:varchar(24);not null;default:'interrupt'" json:"fallbackMode"`
	FallbackProxyIDs       UintSlice                      `gorm:"type:json" json:"fallbackProxyIds,omitempty"`
	FallbackGroupIDs       UintSlice                      `gorm:"type:json" json:"fallbackGroupIds,omitempty"`
	FallbackTagIDs         UintSlice                      `gorm:"type:json" json:"fallbackTagIds,omitempty"`
	FallbackTagMode        ProxyTagFilterMode             `gorm:"type:varchar(8);not null;default:'or'" json:"fallbackTagMode"`
	MaxRetries             int                            `gorm:"not null;default:2" json:"maxRetries"`
	AllowDirectFallback    bool                           `gorm:"not null;default:false" json:"allowDirectFallback"`
	SecurityPolicyID       *uint                          `gorm:"index" json:"securityPolicyId,omitempty"`
	SecurityPolicy         *ProxyGatewaySecurityPolicy    `gorm:"foreignKey:SecurityPolicyID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"securityPolicy,omitempty"`
	DNSPolicyID            *uint                          `gorm:"index" json:"dnsPolicyId,omitempty"`
	DNSPolicy              *ProxyGatewayDNSPolicy         `gorm:"foreignKey:DNSPolicyID;constraint:OnUpdate:CASCADE,OnDelete:SET NULL;" json:"dnsPolicy,omitempty"`
	Metadata               JSONMapInterface               `gorm:"type:json" json:"metadata,omitempty"`
	CreatedAt              time.Time                      `json:"createdAt"`
	UpdatedAt              time.Time                      `json:"updatedAt"`
	DeletedAt              DeletedAt                      `gorm:"index" json:"deletedAt,omitempty"`
}

// ProxyGatewayAccountRouteStrategyOverride keeps the gateway's target-route
// topology intact while replacing one egress strategy for one account. The
// gateway dimension lets a reusable global source strategy be overridden
// differently on separate listeners.
type ProxyGatewayAccountRouteStrategyOverride struct {
	ID                         uint                       `gorm:"primaryKey" json:"id"`
	OrgID                      uint                       `gorm:"not null;index;default:1" json:"orgId"`
	AccountID                  uint                       `gorm:"not null;uniqueIndex:idx_proxy_gateway_account_route_override;index" json:"accountId"`
	GatewayID                  uint                       `gorm:"not null;uniqueIndex:idx_proxy_gateway_account_route_override;index" json:"gatewayId"`
	SourceRouteStrategyID      uint                       `gorm:"not null;uniqueIndex:idx_proxy_gateway_account_route_override;index" json:"sourceRouteStrategyId"`
	ReplacementRouteStrategyID uint                       `gorm:"not null;index" json:"replacementRouteStrategyId"`
	SourceRouteStrategy        *ProxyGatewayRouteStrategy `gorm:"foreignKey:SourceRouteStrategyID" json:"sourceRouteStrategy,omitempty"`
	ReplacementRouteStrategy   *ProxyGatewayRouteStrategy `gorm:"foreignKey:ReplacementRouteStrategyID" json:"replacementRouteStrategy,omitempty"`
	CreatedAt                  time.Time                  `json:"createdAt"`
	UpdatedAt                  time.Time                  `json:"updatedAt"`
}

type ProxyGatewayAccountGroup struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	OrgID       uint      `gorm:"not null;index;default:1" json:"orgId"`
	Name        string    `gorm:"not null;type:varchar(120);index" json:"name"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	Color       string    `gorm:"type:varchar(20)" json:"color,omitempty"`
	SortOrder   int       `gorm:"default:0" json:"sortOrder"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	DeletedAt   DeletedAt `gorm:"index" json:"deletedAt,omitempty"`
}

type ProxyGatewayAccountTag struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	OrgID     uint      `gorm:"not null;index;default:1" json:"orgId"`
	Name      string    `gorm:"not null;type:varchar(120);index" json:"name"`
	Color     string    `gorm:"type:varchar(20)" json:"color,omitempty"`
	SortOrder int       `gorm:"default:0" json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	DeletedAt DeletedAt `gorm:"index" json:"deletedAt,omitempty"`
}

type ProxyGatewayAccountTagLink struct {
	AccountID uint                   `gorm:"primaryKey;not null" json:"accountId"`
	TagID     uint                   `gorm:"primaryKey;not null" json:"tagId"`
	Account   ProxyGatewayAccount    `gorm:"foreignKey:AccountID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
	Tag       ProxyGatewayAccountTag `gorm:"foreignKey:TagID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"tag,omitempty"`
	CreatedAt time.Time              `json:"createdAt"`
}

type ProxyGatewaySecurityPolicy struct {
	ID                     uint                     `gorm:"primaryKey" json:"id"`
	OrgID                  uint                     `gorm:"not null;index;default:1" json:"orgId"`
	GatewayID              uint                     `gorm:"not null;index;default:0" json:"gatewayId"`
	Name                   string                   `gorm:"not null;type:varchar(160);index" json:"name"`
	Description            string                   `gorm:"type:text" json:"description,omitempty"`
	IsDefault              bool                     `gorm:"not null;default:false" json:"isDefault"`
	SourceAllowCIDRs       StringSlice              `gorm:"type:json" json:"sourceAllowCidrs,omitempty"`
	SourceDenyCIDRs        StringSlice              `gorm:"type:json" json:"sourceDenyCidrs,omitempty"`
	TargetHostAllowlist    StringSlice              `gorm:"type:json" json:"targetHostAllowlist,omitempty"`
	TargetHostDenylist     StringSlice              `gorm:"type:json" json:"targetHostDenylist,omitempty"`
	TargetPortAllowlist    StringSlice              `gorm:"type:json" json:"targetPortAllowlist,omitempty"`
	TargetPortDenylist     StringSlice              `gorm:"type:json" json:"targetPortDenylist,omitempty"`
	BlockPrivateIP         bool                     `gorm:"not null;default:true" json:"blockPrivateIp"`
	BlockLoopback          bool                     `gorm:"not null;default:true" json:"blockLoopback"`
	BlockLinkLocal         bool                     `gorm:"not null;default:true" json:"blockLinkLocal"`
	BlockMulticast         bool                     `gorm:"not null;default:true" json:"blockMulticast"`
	BlockMetadataIP        bool                     `gorm:"not null;default:true" json:"blockMetadataIp"`
	DNSRebindingProtection bool                     `gorm:"not null;default:true" json:"dnsRebindingProtection"`
	NoMatchAction          ProxyGatewayPolicyAction `gorm:"type:varchar(16);not null;default:'deny'" json:"noMatchAction"`
	CreatedAt              time.Time                `json:"createdAt"`
	UpdatedAt              time.Time                `json:"updatedAt"`
	DeletedAt              DeletedAt                `gorm:"index" json:"deletedAt,omitempty"`
}

type ProxyGatewayDNSPolicy struct {
	ID                      uint                             `gorm:"primaryKey" json:"id"`
	OrgID                   uint                             `gorm:"not null;index;default:1" json:"orgId"`
	GatewayID               uint                             `gorm:"not null;index;default:0" json:"gatewayId"`
	Name                    string                           `gorm:"not null;type:varchar(160);index" json:"name"`
	Description             string                           `gorm:"type:text" json:"description,omitempty"`
	IsDefault               bool                             `gorm:"not null;default:false" json:"isDefault"`
	Mode                    ProxyGatewayDNSMode              `gorm:"type:varchar(16);not null;default:'remote'" json:"mode"`
	Resolvers               StringSlice                      `gorm:"type:json" json:"resolvers,omitempty"`
	Socks5RemoteResolve     bool                             `gorm:"not null;default:true" json:"socks5RemoteResolve"`
	HTTPConnectPreserveHost bool                             `gorm:"not null;default:true" json:"httpConnectPreserveHost"`
	PreResolveForSecurity   bool                             `gorm:"not null;default:true" json:"preResolveForSecurity"`
	CacheTTLSeconds         int                              `gorm:"not null;default:300" json:"cacheTtlSeconds"`
	NegativeTTLSeconds      int                              `gorm:"not null;default:60" json:"negativeTtlSeconds"`
	MultiIPStrategy         ProxyGatewayMultiIPStrategy      `gorm:"type:varchar(24);not null;default:'check_all'" json:"multiIpStrategy"`
	ResolveFailureAction    ProxyGatewayResolveFailureAction `gorm:"type:varchar(24);not null;default:'deny'" json:"resolveFailureAction"`
	CreatedAt               time.Time                        `json:"createdAt"`
	UpdatedAt               time.Time                        `json:"updatedAt"`
	DeletedAt               DeletedAt                        `gorm:"index" json:"deletedAt,omitempty"`
}

type ProxyGatewayAccessLog struct {
	ID                                 uint             `gorm:"primaryKey" json:"id"`
	OrgID                              uint             `gorm:"not null;index;default:1" json:"orgId"`
	ListenerID                         *uint            `gorm:"index" json:"listenerId,omitempty"`
	AccountID                          *uint            `gorm:"index" json:"accountId,omitempty"`
	Username                           string           `gorm:"type:varchar(160);index" json:"username,omitempty"`
	RequestedUsername                  string           `gorm:"type:varchar(240);index" json:"requestedUsername,omitempty"`
	ClientIP                           string           `gorm:"type:varchar(128);index" json:"clientIp,omitempty"`
	ClientPort                         string           `gorm:"type:varchar(16)" json:"clientPort,omitempty"`
	Protocol                           string           `gorm:"type:varchar(16);index" json:"protocol"`
	Command                            string           `gorm:"type:varchar(24)" json:"command,omitempty"`
	TargetHost                         string           `gorm:"type:varchar(255);index" json:"targetHost,omitempty"`
	TargetPort                         int              `gorm:"index" json:"targetPort,omitempty"`
	UpstreamProxyID                    *uint            `gorm:"index" json:"upstreamProxyId,omitempty"`
	Status                             string           `gorm:"type:varchar(32);index" json:"status"`
	DenyReason                         string           `gorm:"type:text" json:"denyReason,omitempty"`
	Error                              string           `gorm:"type:text" json:"error,omitempty"`
	BytesIn                            int64            `json:"bytesIn"`
	BytesOut                           int64            `json:"bytesOut"`
	DurationMs                         int64            `json:"durationMs"`
	DNSMode                            string           `gorm:"type:varchar(16)" json:"dnsMode,omitempty"`
	SecurityPolicyID                   *uint            `gorm:"index" json:"securityPolicyId,omitempty"`
	DNSPolicyID                        *uint            `gorm:"index" json:"dnsPolicyId,omitempty"`
	RouteStrategyID                    *uint            `gorm:"index" json:"routeStrategyId,omitempty"`
	RouteStrategyFlagNo                int              `gorm:"index" json:"routeStrategyFlagNo,omitempty"`
	PrimaryRouteStrategyID             *uint            `gorm:"index" json:"primaryRouteStrategyId,omitempty"`
	FallbackRouteStrategyID            *uint            `gorm:"index" json:"fallbackRouteStrategyId,omitempty"`
	RouteStrategyOverrideSourceID      *uint            `gorm:"index" json:"routeStrategyOverrideSourceId,omitempty"`
	RouteStrategyOverrideReplacementID *uint            `gorm:"index" json:"routeStrategyOverrideReplacementId,omitempty"`
	RouteFailoverUsed                  bool             `gorm:"not null;default:false;index" json:"routeFailoverUsed"`
	RouteFailoverReason                string           `gorm:"type:text" json:"routeFailoverReason,omitempty"`
	RouteCircuitState                  string           `gorm:"type:varchar(24);index" json:"routeCircuitState,omitempty"`
	RouteCircuitCacheHit               bool             `gorm:"not null;default:false;index" json:"routeCircuitCacheHit"`
	RouteCircuitProbe                  bool             `gorm:"not null;default:false;index" json:"routeCircuitProbe"`
	ProxyIndex                         int              `gorm:"index" json:"proxyIndex,omitempty"`
	ResolvedProxyIndex                 int              `gorm:"index" json:"resolvedProxyIndex,omitempty"`
	ProxyPoolSize                      int              `json:"proxyPoolSize,omitempty"`
	RouteParams                        JSONMapInterface `gorm:"type:json" json:"routeParams,omitempty"`
	TargetRouteID                      *uint            `gorm:"index" json:"targetRouteId,omitempty"`
	TargetRouteMatcher                 string           `gorm:"type:varchar(255);index" json:"targetRouteMatcher,omitempty"`
	TargetRouteDefault                 bool             `gorm:"not null;default:false" json:"targetRouteDefault"`
	CreatedAt                          time.Time        `gorm:"index" json:"createdAt"`
}

type ProxyGatewayAuditLog struct {
	ID          uint             `gorm:"primaryKey" json:"id"`
	OrgID       uint             `gorm:"not null;index;default:1" json:"orgId"`
	ActorUserID *uint            `gorm:"index" json:"actorUserId,omitempty"`
	Action      string           `gorm:"type:varchar(64);index" json:"action"`
	Resource    string           `gorm:"type:varchar(64);index" json:"resource"`
	ResourceID  *uint            `gorm:"index" json:"resourceId,omitempty"`
	Summary     string           `gorm:"type:text" json:"summary,omitempty"`
	Metadata    JSONMapInterface `gorm:"type:json" json:"metadata,omitempty"`
	CreatedAt   time.Time        `gorm:"index" json:"createdAt"`
}

func (ProxyGatewayListener) TableName() string       { return "proxy_gateway_listeners" }
func (ProxyGatewayAccount) TableName() string        { return "proxy_gateway_accounts" }
func (ProxyGatewayRouteStrategy) TableName() string  { return "proxy_gateway_route_strategies" }
func (ProxyGatewayAccountGroup) TableName() string   { return "proxy_gateway_account_groups" }
func (ProxyGatewayAccountTag) TableName() string     { return "proxy_gateway_account_tags" }
func (ProxyGatewayAccountTagLink) TableName() string { return "proxy_gateway_account_tag_links" }
func (ProxyGatewaySecurityPolicy) TableName() string { return "proxy_gateway_security_policies" }
func (ProxyGatewayDNSPolicy) TableName() string      { return "proxy_gateway_dns_policies" }
func (ProxyGatewayAccessLog) TableName() string      { return "proxy_gateway_access_logs" }
func (ProxyGatewayAuditLog) TableName() string       { return "proxy_gateway_audit_logs" }

func (a *ProxyGatewayAccount) SetPassword(password string) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	a.PasswordHash = string(hashedPassword)
	return nil
}

func (a *ProxyGatewayAccount) CheckPassword(password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(a.PasswordHash), []byte(password)) == nil
}

func (a ProxyGatewayAccount) IsUsable(now time.Time) bool {
	return a.Enabled && (a.ExpiresAt == nil || a.ExpiresAt.After(now))
}

func NormalizeProxyGatewayProtocol(protocol ProxyGatewayProtocol) ProxyGatewayProtocol {
	switch protocol {
	case ProxyGatewayProtocolHTTP, ProxyGatewayProtocolSocks5, ProxyGatewayProtocolMixed:
		return protocol
	default:
		return ProxyGatewayProtocolMixed
	}
}
