package models

import (
	"fmt"
	"net"
	"strings"
	"time"

	"golang.org/x/net/idna"
)

// ProxyGatewayTargetRoute binds an ordered target matcher to a reusable route
// strategy. Non-default routes require at least one matcher; the default route
// is selected only when no ordered matcher wins.
type ProxyGatewayTargetRoute struct {
	ID                       uint                       `gorm:"primaryKey" json:"id"`
	OrgID                    uint                       `gorm:"not null;index;default:1" json:"orgId"`
	GatewayID                uint                       `gorm:"not null;index;default:0" json:"gatewayId"`
	Name                     string                     `gorm:"not null;type:varchar(160);index" json:"name"`
	Description              string                     `gorm:"type:text" json:"description,omitempty"`
	Enabled                  bool                       `gorm:"not null;default:true;index" json:"enabled"`
	IsDefault                bool                       `gorm:"not null;default:false;index" json:"isDefault"`
	SortOrder                int                        `gorm:"not null;default:100;index" json:"sortOrder"`
	Matchers                 StringSlice                `gorm:"type:json" json:"matchers,omitempty"`
	RouteStrategyID          uint                       `gorm:"not null;index" json:"routeStrategyId"`
	RouteStrategy            *ProxyGatewayRouteStrategy `gorm:"foreignKey:RouteStrategyID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT;" json:"routeStrategy,omitempty"`
	FailoverEnabled          bool                       `gorm:"not null;default:false;index" json:"failoverEnabled"`
	FallbackRouteStrategyID  *uint                      `gorm:"index" json:"fallbackRouteStrategyId,omitempty"`
	FallbackRouteStrategy    *ProxyGatewayRouteStrategy `gorm:"foreignKey:FallbackRouteStrategyID;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT;" json:"fallbackRouteStrategy,omitempty"`
	FailureThreshold         int                        `gorm:"not null;default:2" json:"failureThreshold"`
	FailureWindowSeconds     int                        `gorm:"not null;default:30" json:"failureWindowSeconds"`
	CircuitBaseSeconds       int                        `gorm:"not null;default:60" json:"circuitBaseSeconds"`
	CircuitMaxSeconds        int                        `gorm:"not null;default:300" json:"circuitMaxSeconds"`
	CircuitBackoffMultiplier int                        `gorm:"not null;default:2" json:"circuitBackoffMultiplier"`
	CircuitJitterPercent     int                        `gorm:"not null;default:10" json:"circuitJitterPercent"`
	CircuitHalfOpenProbes    int                        `gorm:"not null;default:1" json:"circuitHalfOpenProbes"`
	CreatedAt                time.Time                  `json:"createdAt"`
	UpdatedAt                time.Time                  `json:"updatedAt"`
	DeletedAt                DeletedAt                  `gorm:"index" json:"deletedAt,omitempty"`
}

func (ProxyGatewayTargetRoute) TableName() string { return "proxy_gateway_target_routes" }

// NormalizeProxyGatewayTargetMatcher validates and canonicalizes an exact
// domain, leading-wildcard domain, IP address, or CIDR matcher.
func NormalizeProxyGatewayTargetMatcher(raw string) (string, error) {
	matcher := strings.TrimSpace(raw)
	if matcher == "" {
		return "", fmt.Errorf("target matcher is empty")
	}
	if matcher == "*" {
		return "", fmt.Errorf("use the default route instead of a catch-all matcher")
	}
	if _, network, err := net.ParseCIDR(matcher); err == nil {
		return network.String(), nil
	}
	if ip := net.ParseIP(strings.Trim(matcher, "[]")); ip != nil {
		return ip.String(), nil
	}

	wildcard := strings.HasPrefix(matcher, "*.")
	if wildcard {
		matcher = strings.TrimPrefix(matcher, "*.")
	}
	if strings.Contains(matcher, "*") {
		return "", fmt.Errorf("wildcard is only supported as a leading *.")
	}
	if strings.ContainsAny(matcher, "/:@?#[]") {
		return "", fmt.Errorf("domain matcher must not include a scheme, port, path, or query")
	}

	host, err := normalizeProxyGatewayDomain(matcher)
	if err != nil {
		return "", err
	}
	if wildcard {
		return "*." + host, nil
	}
	return host, nil
}

// ProxyGatewayTargetMatches uses the normalized request target. Domain rules
// do not reverse-resolve an IP target; clients that send an IP must use an IP
// or CIDR rule.
func ProxyGatewayTargetMatches(target, matcher string) bool {
	normalizedMatcher, err := NormalizeProxyGatewayTargetMatcher(matcher)
	if err != nil {
		return false
	}
	target = strings.TrimSpace(target)
	targetIP := net.ParseIP(strings.Trim(target, "[]"))
	if _, network, err := net.ParseCIDR(normalizedMatcher); err == nil {
		return targetIP != nil && network.Contains(targetIP)
	}
	if matcherIP := net.ParseIP(normalizedMatcher); matcherIP != nil {
		return targetIP != nil && matcherIP.Equal(targetIP)
	}
	if targetIP != nil {
		return false
	}
	host, err := normalizeProxyGatewayDomain(target)
	if err != nil {
		return false
	}
	if strings.HasPrefix(normalizedMatcher, "*.") {
		suffix := strings.TrimPrefix(normalizedMatcher, "*")
		return strings.HasSuffix(host, suffix) && host != strings.TrimPrefix(suffix, ".")
	}
	return host == normalizedMatcher
}

func normalizeProxyGatewayDomain(raw string) (string, error) {
	host := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(raw), "."))
	if host == "" {
		return "", fmt.Errorf("domain matcher is empty")
	}
	ascii, err := idna.Lookup.ToASCII(host)
	if err != nil {
		return "", fmt.Errorf("invalid domain matcher %q: %w", raw, err)
	}
	if len(ascii) > 253 || !strings.Contains(ascii, ".") && len(ascii) > 63 {
		return "", fmt.Errorf("domain matcher %q is too long", raw)
	}
	for _, label := range strings.Split(ascii, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return "", fmt.Errorf("invalid domain matcher %q", raw)
		}
	}
	return strings.ToLower(ascii), nil
}
