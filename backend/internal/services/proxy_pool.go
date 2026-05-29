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
	"net/url"
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

type ProxyCheckChannel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description"`
}

type ProxyCheckResult struct {
	ProxyID      uint               `json:"proxyId"`
	Success      bool               `json:"success"`
	Status       models.ProxyStatus `json:"status"`
	LatencyMs    int64              `json:"latencyMs"`
	ExitIP       string             `json:"exitIp,omitempty"`
	Country      string             `json:"country,omitempty"`
	Region       string             `json:"region,omitempty"`
	City         string             `json:"city,omitempty"`
	ISP          string             `json:"isp,omitempty"`
	Error        string             `json:"error,omitempty"`
	CheckChannel string             `json:"checkChannel"`
}

func NewProxyPoolService(proxyRepo *repository.ProxyPoolRepository, accountRepo *repository.EmailAccountRepository) *ProxyPoolService {
	return &ProxyPoolService{proxyRepo: proxyRepo, accountRepo: accountRepo}
}

func DefaultProxyCheckChannels() []ProxyCheckChannel {
	return []ProxyCheckChannel{
		{ID: "ip-api", Name: "ip-api", URL: "http://ip-api.com/json/?fields=status,message,query,country,regionName,city,isp", Description: "返回出口 IP、国家、地区、城市与 ISP"},
		{ID: "ipify", Name: "ipify", URL: "https://api.ipify.org?format=json", Description: "轻量出口 IP 查询"},
		{ID: "httpbin", Name: "httpbin", URL: "https://httpbin.org/ip", Description: "HTTPBin origin IP"},
		{ID: "ipinfo", Name: "ipinfo", URL: "https://ipinfo.io/json", Description: "出口 IP 与地理信息"},
		{ID: "icanhazip", Name: "icanhazip", URL: "https://icanhazip.com", Description: "纯文本出口 IP"},
	}
}

func (s *ProxyPoolService) ParseBulk(input string, defaultType models.ProxyType, groupID *uint, tagIDs []uint, orgID uint) BulkProxyParseResult {
	result := BulkProxyParseResult{Proxies: []models.ProxyPoolItem{}, Errors: []ProxyParseError{}}
	lines := strings.Split(input, "\n")
	defaultType = models.NormalizeProxyType(defaultType)

	added := 0
	for i, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if added >= 500 {
			result.Errors = append(result.Errors, ProxyParseError{Line: i + 1, Content: line, Error: "一次最多添加500个代理"})
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
		added++
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
		channelID = "ip-api"
	}
	channel := findProxyCheckChannel(channelID)
	result := ProxyCheckResult{
		ProxyID:      proxyItem.ID,
		Status:       models.ProxyStatusUnavailable,
		CheckChannel: channel.ID,
	}

	now := time.Now()
	_ = s.proxyRepo.UpdateCheckResult(proxyItem.ID, map[string]interface{}{
		"status":        models.ProxyStatusChecking,
		"last_check_at": now,
	})

	start := time.Now()
	ipInfo, err := s.probeProxy(ctx, *proxyItem, channel, timeout)
	result.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		result.Error = err.Error()
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

func findProxyCheckChannel(channelID string) ProxyCheckChannel {
	channels := DefaultProxyCheckChannels()
	for _, channel := range channels {
		if channel.ID == channelID {
			return channel
		}
	}
	return channels[0]
}

func (s *ProxyPoolService) probeProxy(ctx context.Context, proxyItem models.ProxyPoolItem, channel ProxyCheckChannel, timeout time.Duration) (proxyIPInfo, error) {
	client, err := s.createHTTPClient(proxyItem, timeout)
	if err != nil {
		return proxyIPInfo{}, err
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, channel.URL, nil)
	if err != nil {
		return proxyIPInfo{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return proxyIPInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return proxyIPInfo{}, fmt.Errorf("查询出口IP失败: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return proxyIPInfo{}, err
	}
	return parseProxyIPInfo(channel.ID, body)
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

func parseProxyIPInfo(channelID string, body []byte) (proxyIPInfo, error) {
	text := strings.TrimSpace(string(body))
	info := proxyIPInfo{}
	switch channelID {
	case "icanhazip":
		info.ExitIP = text
		return info, nil
	default:
		var raw map[string]interface{}
		if err := json.Unmarshal(body, &raw); err != nil {
			return info, err
		}
		if status, _ := raw["status"].(string); status == "fail" {
			if msg, _ := raw["message"].(string); msg != "" {
				return info, errors.New(msg)
			}
			return info, errors.New("IP查询渠道返回失败")
		}
		info.ExitIP = firstString(raw, "query", "ip", "origin")
		info.Country = firstString(raw, "country")
		info.Region = firstString(raw, "regionName", "region")
		info.City = firstString(raw, "city")
		info.ISP = firstString(raw, "isp", "org")
		if strings.Contains(info.ExitIP, ",") {
			info.ExitIP = strings.TrimSpace(strings.Split(info.ExitIP, ",")[0])
		}
		if info.ExitIP == "" {
			return info, errors.New("IP查询渠道未返回出口IP")
		}
		return info, nil
	}
}

func firstString(raw map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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
