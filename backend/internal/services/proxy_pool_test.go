package services

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProxyCheckFallsBackWhenSelectedChannelReturnsHTTPError(t *testing.T) {
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Host == "failing-channel.test" {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte("channel unavailable"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ip":"2001:db8::734","country":"Testland","region":"Test Region","city":"Test City","organization":"Test ISP"}`))
	}))
	defer proxyServer.Close()
	proxyURL, err := url.Parse(proxyServer.URL)
	if err != nil {
		t.Fatalf("parse proxy server URL: %v", err)
	}
	port, err := strconv.Atoi(proxyURL.Port())
	if err != nil {
		t.Fatalf("parse proxy server port: %v", err)
	}

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}, &models.ProxyCheckChannel{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	repo := repository.NewProxyPoolRepository(db)
	item := models.ProxyPoolItem{OrgID: 1, Type: models.ProxyTypeHTTP, Host: proxyURL.Hostname(), Port: port, Status: models.ProxyStatusUnknown}
	if err := repo.Create(&item); err != nil {
		t.Fatalf("create proxy: %v", err)
	}
	fallback := models.ProxyCheckChannel{
		OrgID: 1, Key: "ip-sb", Name: "IP.SB", Mode: "self", URLTemplate: "http://working-channel.test/me", Method: http.MethodGet,
		ResponseFormat: "json", IPField: "ip", CountryField: "country", RegionField: "region", CityField: "city", ISPField: "organization",
		Enabled: true, BuiltIn: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 2, SortOrder: 10,
	}
	if err := repo.CreateCheckChannel(&fallback); err != nil {
		t.Fatalf("create fallback channel: %v", err)
	}
	selected := models.ProxyCheckChannel{
		OrgID: 1, Key: "failing", Name: "Failing", Mode: "self", URLTemplate: "http://failing-channel.test/me", Method: http.MethodGet,
		ResponseFormat: "json", IPField: "ip", Enabled: true, SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 2, SortOrder: 1,
	}
	if err := repo.CreateCheckChannel(&selected); err != nil {
		t.Fatalf("create selected channel: %v", err)
	}

	service := NewProxyPoolService(repo, nil)
	result := service.TestProxy(context.Background(), &item, selected.Key, 3*time.Second)
	if !result.Success || result.Status != models.ProxyStatusAvailable {
		t.Fatalf("result=%+v, want successful fallback", result)
	}
	if result.UsedChannel != "ip-sb" || result.Warning == "" || result.ExitIP != "2001:db8::734" {
		t.Fatalf("result=%+v, want ip-sb fallback and warning", result)
	}
	stored, err := repo.GetByID(1, item.ID)
	if err != nil {
		t.Fatalf("reload proxy: %v", err)
	}
	if stored.Status != models.ProxyStatusAvailable {
		t.Fatalf("stored status=%s, want available", stored.Status)
	}
}

func TestParseProxyIPInfoUsesConfiguredNestedFields(t *testing.T) {
	channel := models.ProxyCheckChannel{
		Mode: "self", ResponseFormat: "json", IPField: "data.ip", CountryField: "data.location.country", ISPField: "data.network.isp",
	}
	info, err := parseProxyIPInfo(channel, []byte(`{"data":{"ip":"203.0.113.9","location":{"country":"Example"},"network":{"isp":"Example ISP"}}}`))
	if err != nil {
		t.Fatalf("parse info: %v", err)
	}
	if info.ExitIP != "203.0.113.9" || info.Country != "Example" || info.ISP != "Example ISP" {
		t.Fatalf("info=%+v", info)
	}
}

func TestParseProxyIPInfoUsesRegexCaptureMappings(t *testing.T) {
	channel := models.ProxyCheckChannel{
		Mode: "self", ResponseFormat: "regex",
		ResponseRegex: `IP=([0-9.]+); country=([^;]+); region=([^;]+); status=(\w+); message=(.*)`,
		IPField:       "$1", CountryField: "$2", RegionField: "$3", StatusField: "$4", FailureValue: "fail", MessageField: "$5",
	}
	info, trace, err := parseProxyIPInfoWithTrace(channel, []byte(`IP=203.0.113.9; country=SG; region=Singapore; status=ok; message=none`))
	if err != nil {
		t.Fatalf("parse regex response: %v", err)
	}
	if info.ExitIP != "203.0.113.9" || info.Country != "SG" || info.Region != "Singapore" {
		t.Fatalf("info=%+v, want mapped regex captures", info)
	}
	if len(trace.Captures) != 6 || trace.Captures[1] != "203.0.113.9" || trace.StatusValue != "ok" || trace.FailureMatched {
		t.Fatalf("trace=%+v, want captures and non-failure status", trace)
	}
}

func TestParseProxyIPInfoRegexFailureUsesCapturedMessage(t *testing.T) {
	channel := models.ProxyCheckChannel{
		Mode: "self", ResponseFormat: "regex",
		ResponseRegex: `IP=([0-9.]+); status=(\w+); message=(.*)`,
		IPField:       "$1", StatusField: "$2", FailureValue: "fail", MessageField: "$3",
	}
	_, trace, err := parseProxyIPInfoWithTrace(channel, []byte(`IP=203.0.113.10; status=FAIL; message=quota exceeded`))
	if err == nil || err.Error() != "quota exceeded" {
		t.Fatalf("error=%v, want captured failure message", err)
	}
	if !trace.FailureMatched || trace.StatusValue != "FAIL" || trace.MessageValue != "quota exceeded" {
		t.Fatalf("trace=%+v, want matched failure diagnostics", trace)
	}
}

func TestLookupChannelRejectsPrivateAndLoopbackTargets(t *testing.T) {
	var called atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called.Store(true)
		_, _ = w.Write([]byte(`{"ip":"203.0.113.10"}`))
	}))
	defer server.Close()

	channel := models.ProxyCheckChannel{
		Key: "private-target", Mode: "lookup", URLTemplate: server.URL + "/{{ip}}", Method: http.MethodGet,
		ResponseFormat: "json", IPField: "ip", TimeoutSeconds: 2,
	}
	service := &ProxyPoolService{}
	_, err := service.lookupChannel(context.Background(), channel, "203.0.113.10", 2*time.Second)
	if err == nil || !strings.Contains(err.Error(), "不允许访问非公网地址") {
		t.Fatalf("lookup error=%v, want private-address rejection", err)
	}
	if called.Load() {
		t.Fatal("private lookup endpoint received a request")
	}
}

func TestPublicProxyCheckIPClassification(t *testing.T) {
	tests := []struct {
		ip     string
		public bool
	}{
		{ip: "8.8.8.8", public: true},
		{ip: "2001:4860:4860::8888", public: true},
		{ip: "127.0.0.1", public: false},
		{ip: "10.0.0.1", public: false},
		{ip: "100.64.0.1", public: false},
		{ip: "169.254.1.1", public: false},
		{ip: "198.18.0.1", public: false},
		{ip: "203.0.113.1", public: false},
		{ip: "::1", public: false},
		{ip: "fc00::1", public: false},
		{ip: "2001:db8::1", public: false},
	}
	for _, test := range tests {
		t.Run(test.ip, func(t *testing.T) {
			if got := isPublicProxyCheckIP(net.ParseIP(test.ip)); got != test.public {
				t.Fatalf("isPublicProxyCheckIP(%s)=%v, want %v", test.ip, got, test.public)
			}
		})
	}
}
