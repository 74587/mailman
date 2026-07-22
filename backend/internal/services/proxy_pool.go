package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mailman/internal/models"
	"mailman/internal/repository"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

type ProxyPoolService struct {
	proxyRepo   *repository.ProxyPoolRepository
	accountRepo *repository.EmailAccountRepository
}

type ProxyParseError struct {
	Line    int    `json:"line"`
	Content string `json:"content"`
	Error   string `json:"error"`
}

type BulkProxyParseResult struct {
	Proxies []models.ProxyPoolItem `json:"proxies"`
	Errors  []ProxyParseError      `json:"errors"`
}

type ProxyCheckResult struct {
	ProxyID      uint               `json:"proxyId"`
	Success      bool               `json:"success"`
	Inconclusive bool               `json:"inconclusive,omitempty"`
	Status       models.ProxyStatus `json:"status"`
	LatencyMs    int64              `json:"latencyMs"`
	ExitIP       string             `json:"exitIp,omitempty"`
	Country      string             `json:"country,omitempty"`
	Region       string             `json:"region,omitempty"`
	City         string             `json:"city,omitempty"`
	ISP          string             `json:"isp,omitempty"`
	Error        string             `json:"error,omitempty"`
	Warning      string             `json:"warning,omitempty"`
	CheckChannel string             `json:"checkChannel"`
	UsedChannel  string             `json:"usedChannel,omitempty"`
}

// ProxyCheckChannelTestResult exposes enough of a channel response to tune its
// parser without mutating the proxy used for the trial request.
type ProxyCheckChannelTestResult struct {
	Success        bool     `json:"success"`
	HTTPStatus     int      `json:"httpStatus,omitempty"`
	LatencyMs      int64    `json:"latencyMs"`
	ContentType    string   `json:"contentType,omitempty"`
	RawBody        string   `json:"rawBody,omitempty"`
	BodyTruncated  bool     `json:"bodyTruncated,omitempty"`
	ExitIP         string   `json:"exitIp,omitempty"`
	Country        string   `json:"country,omitempty"`
	Region         string   `json:"region,omitempty"`
	City           string   `json:"city,omitempty"`
	ISP            string   `json:"isp,omitempty"`
	Captures       []string `json:"captures,omitempty"`
	StatusValue    string   `json:"statusValue,omitempty"`
	FailureValue   string   `json:"failureValue,omitempty"`
	FailureMatched bool     `json:"failureMatched"`
	MessageValue   string   `json:"messageValue,omitempty"`
	UsedProxyID    uint     `json:"usedProxyId,omitempty"`
	Decision       string   `json:"decision"`
	Error          string   `json:"error,omitempty"`
}

func NewProxyPoolService(proxyRepo *repository.ProxyPoolRepository, accountRepo *repository.EmailAccountRepository) *ProxyPoolService {
	return &ProxyPoolService{proxyRepo: proxyRepo, accountRepo: accountRepo}
}

func DefaultProxyCheckChannels(orgID uint) []models.ProxyCheckChannel {
	defaults := []models.ProxyCheckChannel{
		{Key: "ip-sb", Name: "IP.SB", Provider: "api.ip.sb", Description: "双栈出口 IP、GeoIP 与运营商信息", Mode: "self", URLTemplate: "https://api.ip.sb/geoip", Method: http.MethodGet, ResponseFormat: "json", IPField: "ip", CountryField: "country", RegionField: "region", CityField: "city", ISPField: "organization", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 10},
		{Key: "ipinfo", Name: "IPinfo", Provider: "ipinfo.io", Description: "双栈出口 IP 与地理信息，可选 Token", Mode: "self", URLTemplate: "https://ipinfo.io/json", Method: http.MethodGet, ResponseFormat: "json", IPField: "ip", CountryField: "country", RegionField: "region", CityField: "city", ISPField: "org", AuthType: "query", AuthName: "token", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 20},
		{Key: "ipgeolocation", Name: "IPGeolocation", Provider: "ipgeolocation.io", Description: "双栈出口 IP；配置 API Key 后可自定义完整 GeoIP 端点", Mode: "self", URLTemplate: "https://api.ipgeolocation.io/v3/getip", Method: http.MethodGet, ResponseFormat: "json", IPField: "ip", AuthType: "query", AuthName: "apiKey", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 30},
		{Key: "lumtest", Name: "Lumtest", Provider: "lumtest.com", Description: "出口 IP、ASN 与地理信息；Bright Data 官方示例使用 HTTP", Mode: "self", URLTemplate: "http://lumtest.com/myip.json", Method: http.MethodGet, ResponseFormat: "json", IPField: "ip", CountryField: "country", RegionField: "geo.region_name", CityField: "geo.city", ISPField: "asn.org_name", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 40},
		{Key: "ipapi-is", Name: "ipapi.is", Provider: "api.ipapi.is", Description: "出口 IP 的 ASN、代理、VPN 与机房属性查询", Mode: "lookup", URLTemplate: "https://api.ipapi.is/?q={{ip}}", Method: http.MethodGet, ResponseFormat: "json", IPField: "ip", CountryField: "location.country", RegionField: "location.state", CityField: "location.city", ISPField: "company.name", AuthType: "query", AuthName: "key", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 50},
		{Key: "ipqualityscore", Name: "IPQualityScore", Provider: "ipqualityscore.com", Description: "出口 IP 的代理、VPN 与欺诈风险查询，需要 API Key", Mode: "lookup", URLTemplate: "https://ipqualityscore.com/api/json/ip/{{credential}}/{{ip}}", Method: http.MethodGet, ResponseFormat: "json", CountryField: "country_code", RegionField: "region", CityField: "city", ISPField: "ISP", StatusField: "success", FailureValue: "false", MessageField: "message", AuthType: "path", Enabled: false, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 60},
		{Key: "db-ip", Name: "DB-IP", Provider: "db-ip.com", Description: "出口 IP 与地理信息；免费接口仅支持 HTTP", Mode: "self", URLTemplate: "http://api.db-ip.com/v2/free/self", Method: http.MethodGet, ResponseFormat: "json", IPField: "ipAddress", CountryField: "countryName", RegionField: "stateProv", CityField: "city", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 70},
		{Key: "ip-api", Name: "ip-api", Provider: "ip-api.com", Description: "IPv4 GeoIP；免费接口不支持 HTTPS，不建议作为默认渠道", Mode: "self", URLTemplate: "http://ip-api.com/json/?fields=status,message,query,country,regionName,city,isp", Method: http.MethodGet, ResponseFormat: "json", IPField: "query", CountryField: "country", RegionField: "regionName", CityField: "city", ISPField: "isp", StatusField: "status", FailureValue: "fail", MessageField: "message", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: false, TimeoutSeconds: 12, SortOrder: 80},
		{Key: "ipify", Name: "ipify", Provider: "api.ipify.org", Description: "轻量双栈出口 IP 查询", Mode: "self", URLTemplate: "https://api.ipify.org?format=json", Method: http.MethodGet, ResponseFormat: "json", IPField: "ip", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 90},
		{Key: "httpbin", Name: "httpbin", Provider: "httpbin.org", Description: "HTTPBin origin IP", Mode: "self", URLTemplate: "https://httpbin.org/ip", Method: http.MethodGet, ResponseFormat: "json", IPField: "origin", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 100},
		{Key: "icanhazip", Name: "icanhazip", Provider: "icanhazip.com", Description: "纯文本双栈出口 IP", Mode: "self", URLTemplate: "https://icanhazip.com", Method: http.MethodGet, ResponseFormat: "text", Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12, SortOrder: 110},
	}
	for i := range defaults {
		defaults[i].OrgID = orgID
		if defaults[i].AuthType == "" {
			defaults[i].AuthType = "none"
		}
	}
	return defaults
}

func (s *ProxyPoolService) ParseBulk(input string, defaultType models.ProxyType, groupID *uint, tagIDs []uint, orgID uint) BulkProxyParseResult {
	result := BulkProxyParseResult{Proxies: []models.ProxyPoolItem{}, Errors: []ProxyParseError{}}
	lines := strings.Split(input, "\n")
	defaultType = models.NormalizeProxyType(defaultType)

	for i, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		item, err := ParseProxyLine(line, defaultType)
		if err != nil {
			result.Errors = append(result.Errors, ProxyParseError{Line: i + 1, Content: line, Error: err.Error()})
			continue
		}
		item.OrgID = orgID
		item.GroupID = groupID
		item.Status = models.ProxyStatusUnknown
		item.UsageScope = "shared"
		item.Source = "bulk_import"
		for _, tagID := range tagIDs {
			item.Tags = append(item.Tags, models.ProxyTag{ID: tagID})
		}
		result.Proxies = append(result.Proxies, item)
	}
	return result
}

func ParseProxyLine(line string, defaultType models.ProxyType) (models.ProxyPoolItem, error) {
	item := models.ProxyPoolItem{Type: models.NormalizeProxyType(defaultType)}

	withoutRemark, remark := extractTrailingBlock(line, "{", "}")
	item.Remark = remark

	withoutRefresh, refreshURL := extractRefreshURL(withoutRemark)
	item.RefreshURL = refreshURL
	core := strings.TrimSpace(withoutRefresh)
	if core == "" {
		return item, errors.New("代理内容为空")
	}

	if strings.Contains(core, "://") {
		parsedURL, err := url.Parse(core)
		if err != nil {
			return item, fmt.Errorf("代理URL格式错误: %w", err)
		}
		item.Type = models.NormalizeProxyType(models.ProxyType(parsedURL.Scheme))
		item.Host = parsedURL.Hostname()
		port, err := strconv.Atoi(parsedURL.Port())
		if err != nil {
			return item, errors.New("代理端口必须是数字")
		}
		item.Port = port
		if parsedURL.User != nil {
			item.Username = parsedURL.User.Username()
			item.Password, _ = parsedURL.User.Password()
		}
		return validateParsedProxy(item)
	}

	parts := splitColonOutsideBrackets(core)
	switch len(parts) {
	case 2:
		item.Host = trimIPv6Brackets(parts[0])
		port, err := strconv.Atoi(parts[1])
		if err != nil {
			return item, errors.New("代理端口必须是数字")
		}
		item.Port = port
	case 4:
		item.Host = trimIPv6Brackets(parts[0])
		port, err := strconv.Atoi(parts[1])
		if err != nil {
			return item, errors.New("代理端口必须是数字")
		}
		item.Port = port
		item.Username = parts[2]
		item.Password = parts[3]
	default:
		return item, errors.New("代理格式不支持")
	}
	return validateParsedProxy(item)
}

func extractTrailingBlock(input, open, close string) (string, string) {
	trimmed := strings.TrimSpace(input)
	if !strings.HasSuffix(trimmed, close) {
		return input, ""
	}
	start := strings.LastIndex(trimmed, open)
	if start < 0 {
		return input, ""
	}
	return strings.TrimSpace(trimmed[:start]), strings.TrimSpace(trimmed[start+len(open) : len(trimmed)-len(close)])
}

func extractRefreshURL(input string) (string, string) {
	trimmed := strings.TrimSpace(input)
	if !strings.HasSuffix(trimmed, "]") {
		return input, ""
	}
	start := strings.LastIndex(trimmed, "[")
	if start <= 0 {
		return input, ""
	}
	prefix := strings.TrimSpace(trimmed[:start])
	if !endsWithPort(prefix) {
		return input, ""
	}
	return prefix, strings.TrimSpace(trimmed[start+1 : len(trimmed)-1])
}

func endsWithPort(value string) bool {
	end := len(value) - 1
	for end >= 0 && value[end] >= '0' && value[end] <= '9' {
		end--
	}
	return end >= 0 && value[end] == ':'
}

func splitColonOutsideBrackets(input string) []string {
	var parts []string
	var current strings.Builder
	bracketDepth := 0
	for _, r := range input {
		switch r {
		case '[':
			bracketDepth++
			current.WriteRune(r)
		case ']':
			if bracketDepth > 0 {
				bracketDepth--
			}
			current.WriteRune(r)
		case ':':
			if bracketDepth == 0 {
				parts = append(parts, current.String())
				current.Reset()
			} else {
				current.WriteRune(r)
			}
		default:
			current.WriteRune(r)
		}
	}
	parts = append(parts, current.String())
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}

func trimIPv6Brackets(host string) string {
	return strings.Trim(strings.TrimSpace(host), "[]")
}

func validateParsedProxy(item models.ProxyPoolItem) (models.ProxyPoolItem, error) {
	item.Type = models.NormalizeProxyType(item.Type)
	item.Host = trimIPv6Brackets(item.Host)
	if item.Host == "" {
		return item, errors.New("代理主机不能为空")
	}
	if item.Port <= 0 || item.Port > 65535 {
		return item, errors.New("代理端口必须在1-65535之间")
	}
	return item, nil
}

func (s *ProxyPoolService) TestProxy(ctx context.Context, proxyItem *models.ProxyPoolItem, channelID string, timeout time.Duration) ProxyCheckResult {
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	if channelID == "" {
		channelID = "ip-sb"
	}
	result := ProxyCheckResult{
		ProxyID:      proxyItem.ID,
		Status:       proxyItem.Status,
		CheckChannel: channelID,
	}
	channels, err := s.ListCheckChannels(proxyItem.OrgID, false)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	channel := findConfiguredCheckChannel(channels, channelID)
	if channel == nil {
		result.Error = fmt.Sprintf("检测渠道不存在或已停用: %s", channelID)
		result.Inconclusive = true
		return result
	}

	now := time.Now()
	_ = s.proxyRepo.UpdateCheckResult(proxyItem.ID, map[string]interface{}{
		"status":        models.ProxyStatusChecking,
		"last_check_at": now,
	})

	start := time.Now()
	ipInfo, usedChannel, warning, inconclusive, err := s.checkProxyThroughChannels(ctx, *proxyItem, *channel, channels, timeout)
	result.LatencyMs = time.Since(start).Milliseconds()
	result.UsedChannel = usedChannel
	result.Warning = warning
	if err != nil {
		result.Error = err.Error()
		result.Inconclusive = inconclusive
		if inconclusive {
			result.Status = proxyItem.Status
			_ = s.proxyRepo.UpdateCheckResult(proxyItem.ID, map[string]interface{}{
				"status":           proxyItem.Status,
				"last_check_at":    now,
				"last_error":       result.Error,
				"check_latency_ms": result.LatencyMs,
				"check_count":      proxyItem.CheckCount + 1,
			})
			return result
		}
		result.Status = models.ProxyStatusUnavailable
		_ = s.proxyRepo.UpdateCheckResult(proxyItem.ID, map[string]interface{}{
			"status":           models.ProxyStatusUnavailable,
			"last_check_at":    now,
			"last_failure_at":  now,
			"last_error":       result.Error,
			"check_latency_ms": result.LatencyMs,
			"check_count":      proxyItem.CheckCount + 1,
			"failure_count":    proxyItem.FailureCount + 1,
		})
		return result
	}

	result.Success = true
	result.Status = models.ProxyStatusAvailable
	result.ExitIP = ipInfo.ExitIP
	result.Country = ipInfo.Country
	result.Region = ipInfo.Region
	result.City = ipInfo.City
	result.ISP = ipInfo.ISP
	_ = s.proxyRepo.UpdateCheckResult(proxyItem.ID, map[string]interface{}{
		"status":           models.ProxyStatusAvailable,
		"last_check_at":    now,
		"last_success_at":  now,
		"last_error":       "",
		"check_latency_ms": result.LatencyMs,
		"exit_ip":          result.ExitIP,
		"country":          result.Country,
		"region":           result.Region,
		"city":             result.City,
		"isp":              result.ISP,
		"check_count":      proxyItem.CheckCount + 1,
		"success_count":    proxyItem.SuccessCount + 1,
	})
	return result
}

type proxyIPInfo struct {
	ExitIP  string
	Country string
	Region  string
	City    string
	ISP     string
}

type proxyCheckParseTrace struct {
	Captures       []string
	StatusValue    string
	FailureMatched bool
	MessageValue   string
}

type proxyCheckHTTPResponse struct {
	StatusCode    int
	ContentType   string
	Body          []byte
	BodyTruncated bool
}

type proxyChannelError struct {
	Channel    string
	StatusCode int
	Err        error
}

func (e *proxyChannelError) Error() string {
	if e.StatusCode > 0 {
		return fmt.Sprintf("检测渠道 %s 返回 HTTP %d: %v", e.Channel, e.StatusCode, e.Err)
	}
	return fmt.Sprintf("检测渠道 %s 失败: %v", e.Channel, e.Err)
}

func (s *ProxyPoolService) ListCheckChannels(orgID uint, includeDisabled bool) ([]models.ProxyCheckChannel, error) {
	if err := s.proxyRepo.EnsureCheckChannels(DefaultProxyCheckChannels(orgID)); err != nil {
		return nil, err
	}
	return s.proxyRepo.ListCheckChannels(orgID, includeDisabled)
}

func findConfiguredCheckChannel(channels []models.ProxyCheckChannel, key string) *models.ProxyCheckChannel {
	for i := range channels {
		if channels[i].Key == key {
			return &channels[i]
		}
	}
	return nil
}

func (s *ProxyPoolService) checkProxyThroughChannels(ctx context.Context, proxyItem models.ProxyPoolItem, selected models.ProxyCheckChannel, channels []models.ProxyCheckChannel, timeout time.Duration) (proxyIPInfo, string, string, bool, error) {
	if strings.EqualFold(selected.Mode, "lookup") {
		base, used, warning, inconclusive, err := s.probeWithFallback(ctx, proxyItem, nil, channels, timeout)
		if err != nil {
			return proxyIPInfo{}, used, warning, inconclusive, err
		}
		enriched, err := s.lookupChannel(ctx, selected, base.ExitIP, timeout)
		if err != nil {
			warning = joinProxyCheckWarnings(warning, err.Error())
			return base, used, warning, false, nil
		}
		enriched.ExitIP = base.ExitIP
		return enriched, selected.Key, warning, false, nil
	}
	return s.probeWithFallback(ctx, proxyItem, &selected, channels, timeout)
}

func (s *ProxyPoolService) probeWithFallback(ctx context.Context, proxyItem models.ProxyPoolItem, primary *models.ProxyCheckChannel, channels []models.ProxyCheckChannel, timeout time.Duration) (proxyIPInfo, string, string, bool, error) {
	candidates := make([]models.ProxyCheckChannel, 0, 4)
	if primary != nil {
		candidates = append(candidates, *primary)
	}
	for _, channel := range channels {
		if strings.EqualFold(channel.Mode, "lookup") || primary != nil && channel.Key == primary.Key {
			continue
		}
		candidates = append(candidates, channel)
		if len(candidates) >= 4 {
			break
		}
	}
	if len(candidates) == 0 {
		return proxyIPInfo{}, "", "", true, errors.New("没有已启用的出口探测渠道")
	}

	errorsSeen := make([]string, 0, len(candidates))
	hasChannelError := false
	for index, channel := range candidates {
		info, err := s.probeProxy(ctx, proxyItem, channel, timeout)
		if err == nil {
			warning := ""
			if index > 0 && len(errorsSeen) > 0 {
				warning = fmt.Sprintf("首选渠道失败，已通过 %s 完成检测：%s", channel.Name, errorsSeen[0])
			}
			return info, channel.Key, warning, false, nil
		}
		errorsSeen = append(errorsSeen, err.Error())
		var channelErr *proxyChannelError
		if errors.As(err, &channelErr) {
			hasChannelError = true
		}
	}
	return proxyIPInfo{}, "", "", hasChannelError, errors.New(strings.Join(errorsSeen, "; "))
}

func (s *ProxyPoolService) probeProxy(ctx context.Context, proxyItem models.ProxyPoolItem, channel models.ProxyCheckChannel, timeout time.Duration) (proxyIPInfo, error) {
	client, err := s.createHTTPClient(proxyItem, timeout)
	if err != nil {
		return proxyIPInfo{}, err
	}
	return s.requestCheckChannel(ctx, client, channel, "", timeout)
}

func (s *ProxyPoolService) lookupChannel(ctx context.Context, channel models.ProxyCheckChannel, exitIP string, timeout time.Duration) (proxyIPInfo, error) {
	client := newDirectProxyCheckClient(timeout)
	return s.requestCheckChannel(ctx, client, channel, exitIP, timeout)
}

// TestCheckChannel performs one diagnostic request with the current draft
// configuration. A nil proxy makes self-check channels use a protected direct
// client; lookup channels are always direct and substitute lookupIP.
func (s *ProxyPoolService) TestCheckChannel(ctx context.Context, channel models.ProxyCheckChannel, proxyItem *models.ProxyPoolItem, lookupIP string) ProxyCheckChannelTestResult {
	timeout := time.Duration(channel.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	result := ProxyCheckChannelTestResult{FailureValue: channel.FailureValue}
	var client *http.Client
	if strings.EqualFold(channel.Mode, "lookup") {
		lookupIP = strings.TrimSpace(lookupIP)
		if net.ParseIP(lookupIP) == nil {
			result.Decision = "未发送请求"
			result.Error = "查询型渠道试运行需要有效的 IPv4 或 IPv6 地址"
			return result
		}
		client = newDirectProxyCheckClient(timeout)
	} else if proxyItem != nil {
		var err error
		client, err = s.createHTTPClient(*proxyItem, timeout)
		if err != nil {
			result.Decision = "未发送请求"
			result.Error = err.Error()
			return result
		}
		result.UsedProxyID = proxyItem.ID
	} else {
		client = newDirectProxyCheckClient(timeout)
	}

	startedAt := time.Now()
	response, err := performCheckChannelRequest(ctx, client, channel, lookupIP, timeout)
	result.LatencyMs = time.Since(startedAt).Milliseconds()
	result.HTTPStatus = response.StatusCode
	result.ContentType = response.ContentType
	result.BodyTruncated = response.BodyTruncated
	const diagnosticBodyLimit = 64 << 10
	diagnosticBody := response.Body
	if len(diagnosticBody) > diagnosticBodyLimit {
		diagnosticBody = diagnosticBody[:diagnosticBodyLimit]
		result.BodyTruncated = true
	}
	result.RawBody = strings.ToValidUTF8(string(diagnosticBody), "�")
	if err != nil {
		result.Decision = "请求失败"
		result.Error = err.Error()
		return result
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		result.Decision = fmt.Sprintf("HTTP %d 判定为失败", response.StatusCode)
		result.Error = channelHTTPStatusError(channel, response).Error()
		return result
	}

	info, trace, err := parseProxyIPInfoWithTrace(channel, response.Body)
	result.ExitIP = info.ExitIP
	result.Country = info.Country
	result.Region = info.Region
	result.City = info.City
	result.ISP = info.ISP
	result.Captures = trace.Captures
	result.StatusValue = trace.StatusValue
	result.FailureMatched = trace.FailureMatched
	result.MessageValue = trace.MessageValue
	if err != nil {
		result.Decision = "响应成功，但字段解析或失败判定未通过"
		result.Error = err.Error()
		return result
	}
	result.Success = true
	result.Decision = "响应成功，字段映射与失败判定通过"
	return result
}

func newDirectProxyCheckClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: timeout}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, fmt.Errorf("检测渠道地址无效: %w", err)
			}
			resolved, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, fmt.Errorf("解析检测渠道地址失败: %w", err)
			}
			var lastErr error
			for _, candidate := range resolved {
				if !isPublicProxyCheckIP(candidate.IP) {
					continue
				}
				conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(candidate.IP.String(), port))
				if dialErr == nil {
					return conn, nil
				}
				lastErr = dialErr
			}
			if lastErr != nil {
				return nil, lastErr
			}
			return nil, fmt.Errorf("检测渠道目标 %s 不允许访问非公网地址", host)
		},
		ForceAttemptHTTP2: true,
	}
	return &http.Client{Transport: transport, Timeout: timeout}
}

var blockedProxyCheckPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001:10::/28"),
	netip.MustParsePrefix("2001:20::/28"),
	netip.MustParsePrefix("2001:db8::/32"),
}

func isPublicProxyCheckIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	address = address.Unmap()
	for _, prefix := range blockedProxyCheckPrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

func (s *ProxyPoolService) requestCheckChannel(ctx context.Context, client *http.Client, channel models.ProxyCheckChannel, exitIP string, timeout time.Duration) (proxyIPInfo, error) {
	response, err := performCheckChannelRequest(ctx, client, channel, exitIP, timeout)
	if err != nil {
		return proxyIPInfo{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return proxyIPInfo{}, channelHTTPStatusError(channel, response)
	}
	info, err := parseProxyIPInfo(channel, response.Body)
	if err != nil {
		return proxyIPInfo{}, &proxyChannelError{Channel: channel.Key, Err: err}
	}
	return info, nil
}

const maxProxyCheckResponseBytes = 1 << 20

func performCheckChannelRequest(ctx context.Context, client *http.Client, channel models.ProxyCheckChannel, exitIP string, timeout time.Duration) (proxyCheckHTTPResponse, error) {
	response := proxyCheckHTTPResponse{}
	if channel.TimeoutSeconds > 0 && time.Duration(channel.TimeoutSeconds)*time.Second < timeout {
		timeout = time.Duration(channel.TimeoutSeconds) * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	credential := DecryptIfAvailable(channel.AuthValue)
	requestURL := strings.ReplaceAll(channel.URLTemplate, "{{ip}}", url.QueryEscape(exitIP))
	requestURL = strings.ReplaceAll(requestURL, "{{credential}}", url.PathEscape(credential))
	parsedURL, err := url.Parse(requestURL)
	if err != nil || parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return response, &proxyChannelError{Channel: channel.Key, Err: errors.New("渠道 URL 必须是有效的 HTTP/HTTPS 地址")}
	}
	if strings.EqualFold(channel.Mode, "lookup") && !strings.Contains(channel.URLTemplate, "{{ip}}") {
		return response, &proxyChannelError{Channel: channel.Key, Err: errors.New("查询型渠道 URL 缺少 {{ip}} 占位符")}
	}
	if strings.EqualFold(channel.AuthType, "path") && credential == "" {
		return response, &proxyChannelError{Channel: channel.Key, Err: errors.New("渠道尚未配置凭据")}
	}
	if credential != "" && strings.EqualFold(channel.AuthType, "query") {
		query := parsedURL.Query()
		query.Set(channel.AuthName, credential)
		parsedURL.RawQuery = query.Encode()
	}
	method := strings.ToUpper(strings.TrimSpace(channel.Method))
	if method == "" {
		method = http.MethodGet
	}
	req, err := http.NewRequestWithContext(reqCtx, method, parsedURL.String(), nil)
	if err != nil {
		return response, &proxyChannelError{Channel: channel.Key, Err: err}
	}
	for name, value := range channel.Headers {
		req.Header.Set(name, fmt.Sprint(value))
	}
	if credential != "" {
		switch strings.ToLower(channel.AuthType) {
		case "bearer":
			req.Header.Set("Authorization", "Bearer "+credential)
		case "header":
			req.Header.Set(channel.AuthName, credential)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		return response, err
	}
	defer resp.Body.Close()
	response.StatusCode = resp.StatusCode
	response.ContentType = resp.Header.Get("Content-Type")
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxProxyCheckResponseBytes+1))
	if readErr != nil {
		return response, &proxyChannelError{Channel: channel.Key, Err: readErr}
	}
	if len(body) > maxProxyCheckResponseBytes {
		body = body[:maxProxyCheckResponseBytes]
		response.BodyTruncated = true
	}
	response.Body = body
	return response, nil
}

func channelHTTPStatusError(channel models.ProxyCheckChannel, response proxyCheckHTTPResponse) error {
	message := strings.TrimSpace(string(response.Body))
	if len(message) > 200 {
		message = message[:200]
	}
	if message == "" {
		message = http.StatusText(response.StatusCode)
	}
	return &proxyChannelError{Channel: channel.Key, StatusCode: response.StatusCode, Err: errors.New(message)}
}

func (s *ProxyPoolService) createHTTPClient(proxyItem models.ProxyPoolItem, timeout time.Duration) (*http.Client, error) {
	proxyURL, err := url.Parse(proxyItem.ProxyURL())
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{}
	switch models.NormalizeProxyType(proxyItem.Type) {
	case models.ProxyTypeHTTP, models.ProxyTypeHTTPS:
		transport.Proxy = http.ProxyURL(proxyURL)
	case models.ProxyTypeSocks5:
		dialer, err := proxy.FromURL(proxyURL, proxy.Direct)
		if err != nil {
			return nil, err
		}
		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			type dialResult struct {
				conn net.Conn
				err  error
			}
			ch := make(chan dialResult, 1)
			go func() {
				conn, err := dialer.Dial(network, addr)
				ch <- dialResult{conn: conn, err: err}
			}()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case result := <-ch:
				return result.conn, result.err
			}
		}
	case models.ProxyTypeSSH:
		dialer := &sshProxyDialer{proxyURL: proxyURL}
		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			type dialResult struct {
				conn net.Conn
				err  error
			}
			ch := make(chan dialResult, 1)
			go func() {
				conn, err := dialer.Dial(network, addr)
				ch <- dialResult{conn: conn, err: err}
			}()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case result := <-ch:
				return result.conn, result.err
			}
		}
	default:
		return nil, fmt.Errorf("不支持的代理类型: %s", proxyItem.Type)
	}
	return &http.Client{Transport: transport, Timeout: timeout}, nil
}

func parseProxyIPInfo(channel models.ProxyCheckChannel, body []byte) (proxyIPInfo, error) {
	info, _, err := parseProxyIPInfoWithTrace(channel, body)
	return info, err
}

func parseProxyIPInfoWithTrace(channel models.ProxyCheckChannel, body []byte) (proxyIPInfo, proxyCheckParseTrace, error) {
	text := strings.TrimSpace(string(body))
	info := proxyIPInfo{}
	trace := proxyCheckParseTrace{}
	if strings.EqualFold(channel.ResponseFormat, "text") {
		info.ExitIP = text
	} else if strings.EqualFold(channel.ResponseFormat, "regex") {
		expression, err := regexp.Compile(channel.ResponseRegex)
		if err != nil {
			return info, trace, fmt.Errorf("响应正则无效: %w", err)
		}
		match := expression.FindStringSubmatchIndex(text)
		if match == nil {
			return info, trace, errors.New("响应正文未匹配配置的正则表达式")
		}
		submatches := expression.FindStringSubmatch(text)
		trace.Captures = append([]string(nil), submatches...)
		expand := func(template string) string {
			if strings.TrimSpace(template) == "" {
				return ""
			}
			return strings.TrimSpace(string(expression.ExpandString(nil, template, text, match)))
		}
		info.ExitIP = expand(channel.IPField)
		info.Country = expand(channel.CountryField)
		info.Region = expand(channel.RegionField)
		info.City = expand(channel.CityField)
		info.ISP = expand(channel.ISPField)
		trace.StatusValue = expand(channel.StatusField)
		trace.MessageValue = expand(channel.MessageField)
	} else {
		var raw interface{}
		if err := json.Unmarshal(body, &raw); err != nil {
			return info, trace, err
		}
		info.ExitIP = jsonPathString(raw, channel.IPField)
		info.Country = jsonPathString(raw, channel.CountryField)
		info.Region = jsonPathString(raw, channel.RegionField)
		info.City = jsonPathString(raw, channel.CityField)
		info.ISP = jsonPathString(raw, channel.ISPField)
		trace.StatusValue = jsonPathString(raw, channel.StatusField)
		trace.MessageValue = jsonPathString(raw, channel.MessageField)
	}
	if strings.TrimSpace(channel.FailureValue) != "" && strings.EqualFold(trace.StatusValue, channel.FailureValue) {
		trace.FailureMatched = true
		message := trace.MessageValue
		if message == "" {
			message = "IP 查询渠道返回失败"
		}
		return info, trace, errors.New(message)
	}
	if strings.Contains(info.ExitIP, ",") {
		info.ExitIP = strings.TrimSpace(strings.Split(info.ExitIP, ",")[0])
	}
	if info.ExitIP == "" && !strings.EqualFold(channel.Mode, "lookup") {
		return info, trace, errors.New("IP 查询渠道未返回出口 IP")
	}
	if info.ExitIP != "" && net.ParseIP(info.ExitIP) == nil {
		return info, trace, fmt.Errorf("IP 查询渠道返回了无效出口 IP: %s", info.ExitIP)
	}
	return info, trace, nil
}

func jsonPathString(raw interface{}, path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	current := raw
	for _, part := range strings.Split(path, ".") {
		object, ok := current.(map[string]interface{})
		if !ok {
			return ""
		}
		current, ok = object[part]
		if !ok {
			return ""
		}
	}
	if current == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(current))
}

func joinProxyCheckWarnings(current, next string) string {
	if current == "" {
		return next
	}
	if next == "" {
		return current
	}
	return current + "; " + next
}

func (s *ProxyPoolService) PrepareAccountProxy(account *models.EmailAccount) error {
	mode := models.NormalizeProxyAccountMode(account.ProxyMode)
	account.ProxyMode = mode
	account.ProxyFallbackMode = models.NormalizeProxyFallbackMode(account.ProxyFallbackMode)
	account.ProxyMatchTagMode = models.NormalizeProxyTagFilterMode(account.ProxyMatchTagMode)

	switch mode {
	case models.ProxyAccountModeManual:
		return nil
	case models.ProxyAccountModeSelected:
		if account.ProxyID == nil {
			return errors.New("请选择一个代理")
		}
		proxyItem, err := s.proxyRepo.GetByID(account.OrgID, *account.ProxyID)
		if err != nil {
			return err
		}
		if proxyItem.Status == models.ProxyStatusUnavailable {
			return s.applyFallbackProxy(account, []uint{proxyItem.ID})
		}
		account.Proxy = proxyItem.ProxyURL()
		return nil
	case models.ProxyAccountModeAuto:
		proxyItem, err := s.proxyRepo.PickAvailable(account.OrgID, []uint(account.ProxyMatchGroupIDs), []uint(account.ProxyMatchTagIDs), string(account.ProxyMatchTagMode), nil)
		if err != nil {
			return err
		}
		account.ProxyID = &proxyItem.ID
		account.Proxy = proxyItem.ProxyURL()
		return nil
	default:
		return nil
	}
}

func (s *ProxyPoolService) ResolveAccountProxy(account *models.EmailAccount) error {
	beforeProxyID := account.ProxyID
	beforeProxy := account.Proxy
	if err := s.PrepareAccountProxy(account); err != nil {
		return err
	}
	if account.ID != 0 && (beforeProxy != account.Proxy || uintPtrValue(beforeProxyID) != uintPtrValue(account.ProxyID)) {
		if err := s.accountRepo.GetDB().Model(&models.EmailAccount{}).
			Where("id = ? AND org_id = ?", account.ID, account.OrgID).
			Updates(map[string]interface{}{
				"proxy":      account.Proxy,
				"proxy_id":   account.ProxyID,
				"proxy_mode": account.ProxyMode,
			}).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *ProxyPoolService) applyFallbackProxy(account *models.EmailAccount, excludeIDs []uint) error {
	switch models.NormalizeProxyFallbackMode(account.ProxyFallbackMode) {
	case models.ProxyFallbackManual:
		if account.ProxyFallbackProxyID != nil {
			proxyItem, err := s.proxyRepo.GetByID(account.OrgID, *account.ProxyFallbackProxyID)
			if err != nil {
				return err
			}
			if proxyItem.Status == models.ProxyStatusUnavailable {
				return errors.New("备用代理不可用")
			}
			account.ProxyID = &proxyItem.ID
			account.Proxy = proxyItem.ProxyURL()
			return nil
		}
		if account.ProxyFallbackProxy != "" {
			account.ProxyID = nil
			account.Proxy = account.ProxyFallbackProxy
			return nil
		}
		return errors.New("未配置备用代理")
	case models.ProxyFallbackAutoSelect:
		proxyItem, err := s.proxyRepo.PickAvailable(account.OrgID, []uint(account.ProxyMatchGroupIDs), []uint(account.ProxyMatchTagIDs), string(account.ProxyMatchTagMode), excludeIDs)
		if err != nil {
			return err
		}
		account.ProxyID = &proxyItem.ID
		account.Proxy = proxyItem.ProxyURL()
		return nil
	default:
		return errors.New("代理不可用，已按策略中断请求")
	}
}

func uintPtrValue(value *uint) uint {
	if value == nil {
		return 0
	}
	return *value
}
