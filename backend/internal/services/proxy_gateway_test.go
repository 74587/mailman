package services

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mailman/internal/models"
	"mailman/internal/repository"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProxyGatewayMixedListenerSupportsHTTPConnectAndSocks5(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	proxyRepo := repository.NewProxyPoolRepository(db)

	security := models.ProxyGatewaySecurityPolicy{
		OrgID:               1,
		Name:                "test permissive",
		NoMatchAction:       models.ProxyGatewayPolicyAllow,
		BlockPrivateIP:      false,
		BlockLoopback:       false,
		BlockLinkLocal:      false,
		BlockMulticast:      false,
		BlockMetadataIP:     false,
		TargetHostAllowlist: models.StringSlice{"*"},
	}
	if err := db.Create(&security).Error; err != nil {
		t.Fatalf("create security policy: %v", err)
	}
	if err := db.Model(&security).Updates(map[string]interface{}{
		"block_private_ip":  false,
		"block_loopback":    false,
		"block_link_local":  false,
		"block_multicast":   false,
		"block_metadata_ip": false,
	}).Error; err != nil {
		t.Fatalf("relax security policy: %v", err)
	}
	dnsPolicy := models.ProxyGatewayDNSPolicy{
		OrgID:                   1,
		Name:                    "test remote",
		Mode:                    models.ProxyGatewayDNSRemote,
		Socks5RemoteResolve:     true,
		HTTPConnectPreserveHost: true,
		PreResolveForSecurity:   false,
		ResolveFailureAction:    models.ProxyGatewayResolveFailureUseRemoteProxy,
	}
	if err := db.Create(&dnsPolicy).Error; err != nil {
		t.Fatalf("create dns policy: %v", err)
	}

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("gateway-ok"))
	}))
	defer target.Close()
	targetHostPort := strings.TrimPrefix(target.URL, "http://")

	upstream := newConnectProxyServer(t)
	defer upstream.Close()
	upstreamHost, upstreamPortText, _ := net.SplitHostPort(strings.TrimPrefix(upstream.URL, "http://"))
	upstreamPort, _ := strconv.Atoi(upstreamPortText)
	proxyItem := models.ProxyPoolItem{
		OrgID:  1,
		Type:   models.ProxyTypeHTTP,
		Host:   upstreamHost,
		Port:   upstreamPort,
		Status: models.ProxyStatusAvailable,
	}
	if err := db.Create(&proxyItem).Error; err != nil {
		t.Fatalf("create upstream proxy: %v", err)
	}

	account := models.ProxyGatewayAccount{
		OrgID:                 1,
		Username:              "gateway-user",
		Enabled:               true,
		SelectionMode:         models.ProxyGatewaySelectionExplicit,
		SelectionAlgorithm:    models.ProxyGatewayAlgorithmRoundRobin,
		ProxyIDs:              models.UintSlice{proxyItem.ID},
		ProxyMatchTagMode:     models.ProxyTagFilterOR,
		FallbackMode:          models.ProxyGatewayFallbackInterrupt,
		MaxRetries:            1,
		SecurityPolicyID:      &security.ID,
		DNSPolicyID:           &dnsPolicy.ID,
		ConnectTimeoutSeconds: 5,
		IdleTimeoutSeconds:    5,
	}
	if err := account.SetPassword("secret"); err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}

	port := freeTCPPort(t)
	listener := models.ProxyGatewayListener{
		OrgID:                   1,
		Name:                    "test mixed",
		ListenIP:                "127.0.0.1",
		Port:                    port,
		Protocol:                models.ProxyGatewayProtocolMixed,
		Enabled:                 true,
		RequireAuth:             true,
		SecurityPolicyID:        &security.ID,
		DNSPolicyID:             &dnsPolicy.ID,
		HandshakeTimeoutSeconds: 5,
		IdleTimeoutSeconds:      5,
		ConnectTimeoutSeconds:   5,
	}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}
	targetStrategy := models.ProxyGatewayRouteStrategy{
		OrgID: 1, GatewayID: listener.ID, Name: "loopback target route", FlagNo: 71, Enabled: true,
		SelectionMode: models.ProxyGatewaySelectionExplicit, ProxyIDs: models.UintSlice{proxyItem.ID},
		SelectionAlgorithm: models.ProxyGatewayAlgorithmRoundRobin,
		FallbackMode:       models.ProxyGatewayFallbackInterrupt,
	}
	if err := db.Create(&targetStrategy).Error; err != nil {
		t.Fatalf("create target route strategy: %v", err)
	}
	targetHost, _, _ := net.SplitHostPort(targetHostPort)
	targetRoute := models.ProxyGatewayTargetRoute{
		OrgID: 1, GatewayID: listener.ID, Name: "SOCKS IP route", Enabled: true, SortOrder: 10,
		Matchers: models.StringSlice{targetHost}, RouteStrategyID: targetStrategy.ID,
	}
	if err := db.Create(&targetRoute).Error; err != nil {
		t.Fatalf("create target route: %v", err)
	}

	service := NewProxyGatewayService(gatewayRepo, proxyRepo)
	if err := service.Start(context.Background()); err != nil {
		t.Fatalf("start gateway: %v", err)
	}
	defer service.Stop(context.Background())
	loadedAccount, err := gatewayRepo.GetAccount(1, account.ID)
	if err != nil {
		t.Fatalf("load account: %v", err)
	}
	testSession := gatewaySession{
		listener:   listener,
		account:    loadedAccount,
		clientIP:   "127.0.0.1",
		protocol:   "http",
		command:    "CONNECT",
		targetHost: strings.Split(targetHostPort, ":")[0],
		targetPort: 80,
		startedAt:  time.Now(),
	}
	conn, _, _, _, err := service.dialWithPolicy(context.Background(), &testSession, targetHostPort)
	if err != nil {
		t.Fatalf("direct dialWithPolicy failed: %v", err)
	}
	_ = conn.Close()

	gatewayAddr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	assertHTTPConnectTunnel(t, db, gatewayAddr, targetHostPort)
	assertHTTPForward(t, gatewayAddr, target.URL)
	assertSocks5Tunnel(t, gatewayAddr, targetHostPort)
	var targetRouteLogs []models.ProxyGatewayAccessLog
	deadline := time.Now().Add(2 * time.Second)
	for {
		if err := db.Where("target_route_id = ? AND status = ?", targetRoute.ID, "success").Find(&targetRouteLogs).Error; err != nil {
			t.Fatalf("load target route logs: %v", err)
		}
		if len(targetRouteLogs) >= 3 || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(targetRouteLogs) != 3 {
		t.Fatalf("target route success logs=%d, want HTTP CONNECT, HTTP forward, and SOCKS5 logs", len(targetRouteLogs))
	}
	for _, logEntry := range targetRouteLogs {
		if logEntry.TargetRouteMatcher != targetHost || logEntry.TargetRouteDefault {
			t.Fatalf("unexpected target route log: %+v", logEntry)
		}
		_, targetPortText, _ := net.SplitHostPort(targetHostPort)
		targetPort, _ := strconv.Atoi(targetPortText)
		if logEntry.TargetHost != targetHost || logEntry.TargetPort != targetPort {
			t.Fatalf("access log target=%s:%d, want %s:%d", logEntry.TargetHost, logEntry.TargetPort, targetHost, targetPort)
		}
		if logEntry.BytesIn <= 0 || logEntry.BytesOut <= 0 {
			t.Fatalf("access log did not record bidirectional traffic: in=%d out=%d protocol=%s", logEntry.BytesIn, logEntry.BytesOut, logEntry.Protocol)
		}
	}
	var trafficProxy models.ProxyPoolItem
	if err := db.First(&trafficProxy, proxyItem.ID).Error; err != nil {
		t.Fatalf("reload proxy traffic: %v", err)
	}
	if trafficProxy.TrafficBytesIn <= 0 || trafficProxy.TrafficBytesOut <= 0 {
		t.Fatalf("proxy traffic was not counted: in=%d out=%d", trafficProxy.TrafficBytesIn, trafficProxy.TrafficBytesOut)
	}
}

func TestProxyGatewayFallbackModesHaveDistinctAttemptSemantics(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	service := NewProxyGatewayService(repository.NewProxyGatewayRepository(db), repository.NewProxyPoolRepository(db))

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("fallback-ok"))
	}))
	defer target.Close()
	targetAddr := strings.TrimPrefix(target.URL, "http://")

	upstream := newConnectProxyServer(t)
	defer upstream.Close()
	upstreamHost, upstreamPortText, _ := net.SplitHostPort(strings.TrimPrefix(upstream.URL, "http://"))
	upstreamPort, _ := strconv.Atoi(upstreamPortText)
	closedPort := freeTCPPort(t)
	badProxy := models.ProxyPoolItem{
		OrgID: 1, Type: models.ProxyTypeHTTP, Host: "127.0.0.1", Port: closedPort,
		Status: models.ProxyStatusAvailable, CheckLatencyMs: 1,
	}
	goodProxy := models.ProxyPoolItem{
		OrgID: 1, Type: models.ProxyTypeHTTP, Host: upstreamHost, Port: upstreamPort,
		Status: models.ProxyStatusAvailable, CheckLatencyMs: 2,
	}
	if err := db.Create(&badProxy).Error; err != nil {
		t.Fatalf("create unavailable proxy: %v", err)
	}
	if err := db.Create(&goodProxy).Error; err != nil {
		t.Fatalf("create working proxy: %v", err)
	}

	security := &models.ProxyGatewaySecurityPolicy{
		ID: 900001, OrgID: 1, Name: "fallback permissive", NoMatchAction: models.ProxyGatewayPolicyAllow,
		TargetHostAllowlist: models.StringSlice{"*"},
	}
	dns := &models.ProxyGatewayDNSPolicy{
		ID: 900002, OrgID: 1, Name: "fallback remote", Mode: models.ProxyGatewayDNSRemote,
		Socks5RemoteResolve: true, HTTPConnectPreserveHost: true,
		ResolveFailureAction: models.ProxyGatewayResolveFailureUseRemoteProxy,
	}
	securityID, dnsID := security.ID, dns.ID
	account := &models.ProxyGatewayAccount{
		ID: 900003, OrgID: 1, Username: "fallback-user", Enabled: true,
		SelectionMode: models.ProxyGatewaySelectionExplicit, SelectionAlgorithm: models.ProxyGatewayAlgorithmLowestLatency,
		ProxyIDs: models.UintSlice{badProxy.ID, goodProxy.ID}, ProxyMatchTagMode: models.ProxyTagFilterOR,
		StickyMode: models.ProxyGatewayStickyNone, SecurityPolicyID: &securityID, SecurityPolicy: security,
		DNSPolicyID: &dnsID, DNSPolicy: dns, ConnectTimeoutSeconds: 1,
	}
	listener := models.ProxyGatewayListener{ID: 900004, OrgID: 1, ListenIP: "127.0.0.1", ConnectTimeoutSeconds: 5}

	dial := func(t *testing.T) (*models.ProxyPoolItem, error) {
		t.Helper()
		session := gatewaySession{listener: listener, account: account, clientIP: "127.0.0.1", protocol: "http", command: "CONNECT"}
		conn, proxyItem, _, _, err := service.dialWithPolicy(context.Background(), &session, targetAddr)
		if conn != nil {
			_ = conn.Close()
		}
		return proxyItem, err
	}

	t.Run("interrupt tries the primary pool once", func(t *testing.T) {
		account.FallbackMode = models.ProxyGatewayFallbackInterrupt
		account.MaxRetries = 5
		if _, err := dial(t); err == nil {
			t.Fatal("interrupt unexpectedly switched to the working proxy")
		}
	})

	t.Run("retry switches within the primary pool", func(t *testing.T) {
		account.FallbackMode = models.ProxyGatewayFallbackRetry
		account.MaxRetries = 1
		proxyItem, err := dial(t)
		if err != nil {
			t.Fatalf("retry failed: %v", err)
		}
		if proxyItem == nil || proxyItem.ID != goodProxy.ID {
			t.Fatalf("retry selected proxy=%v, want %d", proxyItem, goodProxy.ID)
		}
	})

	t.Run("backup retries only in the backup pool", func(t *testing.T) {
		account.FallbackMode = models.ProxyGatewayFallbackBackup
		account.MaxRetries = 1
		account.ProxyIDs = models.UintSlice{badProxy.ID}
		account.FallbackProxyIDs = models.UintSlice{goodProxy.ID}
		proxyItem, err := dial(t)
		if err != nil {
			t.Fatalf("backup fallback failed: %v", err)
		}
		if proxyItem == nil || proxyItem.ID != goodProxy.ID {
			t.Fatalf("backup selected proxy=%v, want %d", proxyItem, goodProxy.ID)
		}
	})

	t.Run("direct requires explicit permission", func(t *testing.T) {
		account.FallbackMode = models.ProxyGatewayFallbackDirect
		account.MaxRetries = 9
		account.ProxyIDs = models.UintSlice{badProxy.ID}
		account.AllowDirectFallback = false
		if _, err := dial(t); err == nil {
			t.Fatal("direct fallback ran without permission")
		}
		account.AllowDirectFallback = true
		proxyItem, err := dial(t)
		if err != nil {
			t.Fatalf("direct fallback failed: %v", err)
		}
		if proxyItem != nil {
			t.Fatalf("direct fallback unexpectedly reported proxy %d", proxyItem.ID)
		}
	})

	t.Run("strict pool index overflow never falls through to direct", func(t *testing.T) {
		account.FallbackMode = models.ProxyGatewayFallbackDirect
		account.AllowDirectFallback = true
		account.ProxyIDs = models.UintSlice{badProxy.ID}
		account.ProxyIndexOverflowMode = models.ProxyGatewayIndexOverflowReject
		session := gatewaySession{
			listener: listener, account: account, proxyIndex: 2,
			clientIP: "127.0.0.1", protocol: "http", command: "CONNECT",
		}
		conn, proxyItem, _, _, err := service.dialWithPolicy(context.Background(), &session, targetAddr)
		if conn != nil {
			_ = conn.Close()
		}
		if err == nil || !strings.Contains(err.Error(), "exceeds pool size 1") {
			t.Fatalf("strict overflow error=%v", err)
		}
		if proxyItem != nil {
			t.Fatalf("strict overflow unexpectedly used proxy %d", proxyItem.ID)
		}
	})

	t.Run("indexed proxy failure honors configured retry", func(t *testing.T) {
		account.FallbackMode = models.ProxyGatewayFallbackRetry
		account.MaxRetries = 1
		account.AllowDirectFallback = false
		account.ProxyIDs = models.UintSlice{badProxy.ID, goodProxy.ID}
		account.ProxyIndexOverflowMode = models.ProxyGatewayIndexOverflowReject
		session := gatewaySession{
			listener: listener, account: account, proxyIndex: 1,
			clientIP: "127.0.0.1", protocol: "http", command: "CONNECT",
		}
		conn, proxyItem, _, _, err := service.dialWithPolicy(context.Background(), &session, targetAddr)
		if conn != nil {
			_ = conn.Close()
		}
		if err != nil {
			t.Fatalf("indexed retry failed: %v", err)
		}
		if proxyItem == nil || proxyItem.ID != goodProxy.ID {
			t.Fatalf("indexed retry selected proxy=%v, want %d", proxyItem, goodProxy.ID)
		}
	})
}

func TestProxyGatewayConnectTimeoutCoversUpstreamHandshakes(t *testing.T) {
	service := &ProxyGatewayService{}
	tests := []struct {
		name      string
		proxyType models.ProxyType
		username  string
		password  string
	}{
		{name: "HTTP CONNECT response", proxyType: models.ProxyTypeHTTP},
		{name: "SOCKS5 handshake", proxyType: models.ProxyTypeSocks5},
		{name: "SSH handshake", proxyType: models.ProxyTypeSSH, username: "user", password: "secret"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			stallAddr := newStallingTCPServer(t)
			host, portText, _ := net.SplitHostPort(stallAddr)
			port, _ := strconv.Atoi(portText)
			proxyItem := &models.ProxyPoolItem{Type: test.proxyType, Host: host, Port: port, Username: test.username, Password: test.password}
			startedAt := time.Now()
			conn, err := service.dialTarget(context.Background(), "example.com:443", "example.com:443", proxyItem, false, 1)
			elapsed := time.Since(startedAt)
			if conn != nil {
				_ = conn.Close()
				t.Fatal("stalling upstream unexpectedly connected")
			}
			if err == nil {
				t.Fatal("stalling upstream did not time out")
			}
			if elapsed < 700*time.Millisecond || elapsed > 3*time.Second {
				t.Fatalf("connect timeout elapsed=%s, want approximately 1s (err=%v)", elapsed, err)
			}
		})
	}
}

func TestProxyGatewayReloadReportsStartFailureAndHealthRecovers(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	service := NewProxyGatewayService(repository.NewProxyGatewayRepository(db), repository.NewProxyPoolRepository(db))
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupy listener port: %v", err)
	}
	_, portText, _ := net.SplitHostPort(occupied.Addr().String())
	port, _ := strconv.Atoi(portText)
	listener := models.ProxyGatewayListener{
		OrgID: 1, Name: "reload collision", ListenIP: "127.0.0.1", Port: port,
		Protocol: models.ProxyGatewayProtocolMixed, Enabled: true, RequireAuth: true,
	}
	if err := db.Create(&listener).Error; err != nil {
		_ = occupied.Close()
		t.Fatalf("create colliding listener: %v", err)
	}

	if err := service.Reload(context.Background()); err == nil {
		_ = occupied.Close()
		t.Fatal("reload swallowed listener start failure")
	}
	failedStatus, ok := findGatewayStatus(service.Status(), listener.ID)
	if !ok {
		_ = occupied.Close()
		t.Fatalf("failed listener %d missing from runtime status", listener.ID)
	}
	if failedStatus.Running || failedStatus.LastError == "" || failedStatus.LastReloadedAt.IsZero() {
		_ = occupied.Close()
		t.Fatalf("failed listener health is incomplete: %+v", failedStatus)
	}

	if err := occupied.Close(); err != nil {
		t.Fatalf("release listener port: %v", err)
	}
	if err := service.Reload(context.Background()); err != nil {
		t.Fatalf("reload after port recovery: %v", err)
	}
	recoveredStatus, ok := findGatewayStatus(service.Status(), listener.ID)
	if !ok || !recoveredStatus.Running || recoveredStatus.LastError != "" || recoveredStatus.LastStartedAt.IsZero() {
		t.Fatalf("listener health did not recover: %+v", recoveredStatus)
	}

	service.mu.RLock()
	runtime := service.runtimes[listener.ID]
	service.mu.RUnlock()
	if runtime == nil {
		t.Fatalf("recovered listener %d has no runtime", listener.ID)
	}
	if err := runtime.listener.Close(); err != nil {
		t.Fatalf("simulate unexpected listener failure: %v", err)
	}
	select {
	case <-runtime.stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("runtime did not stop after unexpected listener failure")
	}
	stoppedStatus, ok := findGatewayStatus(service.Status(), listener.ID)
	if !ok || stoppedStatus.Running || stoppedStatus.LastError == "" {
		t.Fatalf("unexpected runtime failure was not reflected in health: %+v", stoppedStatus)
	}
	if err := service.Reload(context.Background()); err != nil {
		t.Fatalf("reload after unexpected runtime failure: %v", err)
	}
	restartedStatus, ok := findGatewayStatus(service.Status(), listener.ID)
	if !ok || !restartedStatus.Running || restartedStatus.LastError != "" {
		t.Fatalf("unexpected runtime failure did not recover: %+v", restartedStatus)
	}
	reloadErrors := make(chan error, 8)
	var reloadWG sync.WaitGroup
	for i := 0; i < cap(reloadErrors); i++ {
		reloadWG.Add(1)
		go func() {
			defer reloadWG.Done()
			reloadErrors <- service.Reload(context.Background())
		}()
	}
	reloadWG.Wait()
	close(reloadErrors)
	for err := range reloadErrors {
		if err != nil {
			t.Fatalf("concurrent reload produced a false start failure: %v", err)
		}
	}
	stopCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := service.Stop(stopCtx); err != nil {
		t.Fatalf("stop recovered listener: %v", err)
	}
}

func TestProxyGatewayReloadAppliesUsernameSeparatorsWithoutRestart(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	service := NewProxyGatewayService(repository.NewProxyGatewayRepository(db), repository.NewProxyPoolRepository(db))
	listener := models.ProxyGatewayListener{
		OrgID: 1, Name: "separator hot reload", ListenIP: "127.0.0.1", Port: freeTCPPort(t),
		Protocol: models.ProxyGatewayProtocolMixed, Enabled: true, RequireAuth: true,
		UsernameRouteSeparators: models.StringSlice{"#"},
	}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}
	if err := service.Reload(context.Background()); err != nil {
		t.Fatalf("initial reload: %v", err)
	}
	defer service.Stop(context.Background())

	service.mu.RLock()
	runtimeBefore := service.runtimes[listener.ID]
	service.mu.RUnlock()
	if runtimeBefore == nil {
		t.Fatal("initial runtime was not started")
	}
	if err := db.Model(&listener).Update("username_route_separators", models.StringSlice{"--"}).Error; err != nil {
		t.Fatalf("update separators: %v", err)
	}
	if err := service.Reload(context.Background()); err != nil {
		t.Fatalf("reload separators: %v", err)
	}

	service.mu.RLock()
	runtimeAfter := service.runtimes[listener.ID]
	service.mu.RUnlock()
	if runtimeAfter != runtimeBefore {
		t.Fatal("separator-only reload unexpectedly restarted the listener")
	}
	runtimeAfter.mu.RLock()
	configured := append([]string(nil), runtimeAfter.listenerConfig.UsernameRouteSeparators...)
	runtimeAfter.mu.RUnlock()
	if len(configured) != 1 || configured[0] != "--" {
		t.Fatalf("runtime separators=%v want=[--]", configured)
	}
	if _, ok := parseGatewayUsernameRoute("user#7", configured); ok {
		t.Fatal("runtime kept accepting the removed separator")
	}
	request, ok := parseGatewayUsernameRoute("user--7", configured)
	if !ok || request.baseUsername != "user" || request.flagNo != 7 {
		t.Fatalf("runtime did not accept the reloaded separator: ok=%v request=%+v", ok, request)
	}
}

func TestProxyGatewaySmartUsernameRoutingRequiresPermission(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	proxyRepo := repository.NewProxyPoolRepository(db)
	service := NewProxyGatewayService(gatewayRepo, proxyRepo)

	listener := models.ProxyGatewayListener{
		OrgID:                   1,
		Name:                    "test gateway",
		ListenIP:                "127.0.0.1",
		Port:                    18081,
		Protocol:                models.ProxyGatewayProtocolMixed,
		Enabled:                 true,
		IsDefault:               true,
		UsernameRouteSeparators: models.StringSlice{"~", "--"},
	}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}

	account := models.ProxyGatewayAccount{
		OrgID:                   1,
		Username:                "route-user",
		Enabled:                 true,
		AllowedGatewayIDs:       models.UintSlice{listener.ID},
		SelectionMode:           models.ProxyGatewaySelectionFiltered,
		SelectionAlgorithm:      models.ProxyGatewayAlgorithmRandom,
		ProxyMatchTagMode:       models.ProxyTagFilterOR,
		FallbackMode:            models.ProxyGatewayFallbackInterrupt,
		FallbackTagMode:         models.ProxyTagFilterOR,
		ConnectTimeoutSeconds:   5,
		IdleTimeoutSeconds:      5,
		EnableUsernameRouting:   true,
		AllowAllRouteStrategies: false,
	}
	if err := account.SetPassword("secret"); err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}

	allowed := models.ProxyGatewayRouteStrategy{
		OrgID:              1,
		GatewayID:          listener.ID,
		Name:               "allowed strategy",
		FlagNo:             17,
		Enabled:            true,
		SelectionMode:      models.ProxyGatewaySelectionExplicit,
		ProxyIDs:           models.UintSlice{101, 102},
		ProxyMatchTagMode:  models.ProxyTagFilterOR,
		SelectionAlgorithm: models.ProxyGatewayAlgorithmRoundRobin,
		StickyMode:         models.ProxyGatewayStickyClientIP,
		StickyTTLSeconds:   300,
		FallbackMode:       models.ProxyGatewayFallbackRetry,
		FallbackTagMode:    models.ProxyTagFilterOR,
		MaxRetries:         3,
	}
	if err := db.Create(&allowed).Error; err != nil {
		t.Fatalf("create allowed strategy: %v", err)
	}
	denied := models.ProxyGatewayRouteStrategy{
		OrgID:              1,
		GatewayID:          listener.ID,
		Name:               "denied strategy",
		FlagNo:             18,
		Enabled:            true,
		SelectionMode:      models.ProxyGatewaySelectionAll,
		ProxyMatchTagMode:  models.ProxyTagFilterOR,
		SelectionAlgorithm: models.ProxyGatewayAlgorithmWeighted,
		StickyMode:         models.ProxyGatewayStickyNone,
		FallbackMode:       models.ProxyGatewayFallbackInterrupt,
		FallbackTagMode:    models.ProxyTagFilterOR,
		MaxRetries:         1,
	}
	if err := db.Create(&denied).Error; err != nil {
		t.Fatalf("create denied strategy: %v", err)
	}
	account.AllowedRouteStrategyIDs = models.UintSlice{allowed.ID}
	if err := db.Save(&account).Error; err != nil {
		t.Fatalf("grant allowed strategy: %v", err)
	}

	auth, err := service.authenticateAccount(listener, "route-user~17;purpose=test", "secret")
	if err != nil {
		t.Fatalf("authenticate allowed route: %v", err)
	}
	if auth.account == nil || auth.account.SelectionAlgorithm != models.ProxyGatewayAlgorithmRoundRobin {
		t.Fatalf("route strategy was not applied: %+v", auth.account)
	}
	if auth.routeStrategy == nil || auth.routeStrategy.FlagNo != 17 {
		t.Fatalf("missing route strategy context: %+v", auth.routeStrategy)
	}
	if auth.routeParams["purpose"] != "test" {
		t.Fatalf("route params not parsed: %+v", auth.routeParams)
	}

	queryAuth, err := service.authenticateAccount(listener, "route-user?route=17&purpose=query", "secret")
	if err != nil || queryAuth.routeParams["purpose"] != "query" {
		t.Fatalf("query route syntax failed: auth=%+v err=%v", queryAuth, err)
	}
	if _, err := service.authenticateAccount(listener, "route-user#17", "secret"); err == nil {
		t.Fatal("expected an unconfigured separator to be rejected")
	}
	if _, err := service.authenticateAccount(listener, "route-user~18", "secret"); err == nil {
		t.Fatal("expected unauthorized route strategy to be rejected")
	}
}

func TestProxyGatewaySmartUsernameProxyIndexDefersSelectionUntilPoolIsKnown(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	service := NewProxyGatewayService(repository.NewProxyGatewayRepository(db), repository.NewProxyPoolRepository(db))
	listener := models.ProxyGatewayListener{
		OrgID: 1, Name: "index gateway", ListenIP: "127.0.0.1", Port: 18101,
		Protocol: models.ProxyGatewayProtocolMixed, Enabled: true,
		UsernameRouteSeparators: models.StringSlice{"#"},
	}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}
	account := models.ProxyGatewayAccount{
		OrgID: 1, Username: "index-user", Enabled: true,
		AllowedGatewayIDs: models.UintSlice{listener.ID}, EnableUsernameRouting: true,
		UsernameRoutingMode: models.ProxyGatewayUsernameRoutingProxyIndex,
		SelectionMode:       models.ProxyGatewaySelectionExplicit,
		ProxyIDs:            models.UintSlice{901, 902},
		SelectionAlgorithm:  models.ProxyGatewayAlgorithmRandom,
		FallbackMode:        models.ProxyGatewayFallbackInterrupt,
	}
	if err := account.SetPassword("secret"); err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("create account: %v", err)
	}

	auth, err := service.authenticateAccount(listener, "index-user#20;batch=a", "secret")
	if err != nil {
		t.Fatalf("authenticate pool index: %v", err)
	}
	if auth.proxyIndex != 20 || auth.routeStrategy != nil {
		t.Fatalf("auth proxy index=%d route=%+v", auth.proxyIndex, auth.routeStrategy)
	}
	if len(auth.account.ProxyIDs) != 2 || auth.account.ProxyIDs[0] != 901 {
		t.Fatalf("authentication changed the account pool before target routing: %v", auth.account.ProxyIDs)
	}
	if auth.routeParams["batch"] != "a" {
		t.Fatalf("proxy index params=%v", auth.routeParams)
	}

	queryAuth, err := service.authenticateAccount(listener, "index-user?index=21&batch=b", "secret")
	if err != nil || queryAuth.proxyIndex != 21 || queryAuth.routeParams["batch"] != "b" {
		t.Fatalf("query proxy index auth=%+v err=%v", queryAuth, err)
	}
}

func TestProxyGatewayTargetRoutePoolIndexUsesStableOrderAndOptionalModulo(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	service := NewProxyGatewayService(gatewayRepo, repository.NewProxyPoolRepository(db))
	listener := models.ProxyGatewayListener{OrgID: 1, Name: "indexed target gateway", ListenIP: "127.0.0.1", Port: 18102, Protocol: models.ProxyGatewayProtocolMixed}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}

	proxies := []models.ProxyPoolItem{
		{OrgID: 1, Type: models.ProxyTypeSocks5, Host: "proxy-a.test", Port: 1001, Status: models.ProxyStatusUnavailable},
		{OrgID: 1, Type: models.ProxyTypeSocks5, Host: "proxy-b.test", Port: 1002, Status: models.ProxyStatusAvailable},
		{OrgID: 1, Type: models.ProxyTypeSocks5, Host: "proxy-c.test", Port: 1003, Status: models.ProxyStatusAvailable},
	}
	for index := range proxies {
		if err := db.Create(&proxies[index]).Error; err != nil {
			t.Fatalf("create proxy %d: %v", index, err)
		}
	}
	strategy := models.ProxyGatewayRouteStrategy{
		OrgID: 1, GatewayID: listener.ID, Name: "ordered pool", FlagNo: 9, Enabled: true,
		SelectionMode:          models.ProxyGatewaySelectionExplicit,
		ProxyIDs:               models.UintSlice{proxies[2].ID, proxies[0].ID, proxies[1].ID},
		SelectionAlgorithm:     models.ProxyGatewayAlgorithmRandom,
		ProxyIndexOverflowMode: models.ProxyGatewayIndexOverflowModulo,
		FallbackMode:           models.ProxyGatewayFallbackInterrupt,
	}
	if err := db.Create(&strategy).Error; err != nil {
		t.Fatalf("create strategy: %v", err)
	}
	route := models.ProxyGatewayTargetRoute{
		OrgID: 1, GatewayID: listener.ID, Name: "default indexed pool", Enabled: true, IsDefault: true,
		RouteStrategyID: strategy.ID,
	}
	if err := db.Create(&route).Error; err != nil {
		t.Fatalf("create target route: %v", err)
	}
	if err := service.RefreshTargetRoutes(1, listener.ID); err != nil {
		t.Fatalf("refresh target routes: %v", err)
	}

	session := gatewaySession{
		listener: listener, targetHost: "example.com", targetPort: 443, proxyIndex: 5,
		protocol: "socks5", command: "CONNECT", rawUsername: "indexed#5", startedAt: time.Now(),
		account: &models.ProxyGatewayAccount{
			OrgID: 1, Username: "indexed", ProxySelectionSource: models.ProxyGatewaySelectionSourceGateway,
			UsernameRoutingMode: models.ProxyGatewayUsernameRoutingProxyIndex,
		},
	}
	if err := service.applyTargetRoute(&session); err != nil {
		t.Fatalf("apply target route: %v", err)
	}
	selected, _, err := service.selectProxy(session.account, &session, nil, false)
	if err != nil {
		t.Fatalf("select modulo proxy: %v", err)
	}
	// Configured order is [C, A, B]. Index 5 wraps to position 2, so the
	// unavailable A entry remains addressable instead of shifting the mapping.
	if selected.ID != proxies[0].ID || session.resolvedProxyIndex != 2 || session.proxyPoolSize != 3 {
		t.Fatalf("selected=%d resolved=%d size=%d want proxy=%d resolved=2 size=3", selected.ID, session.resolvedProxyIndex, session.proxyPoolSize, proxies[0].ID)
	}
	if session.routeStrategyID == nil || *session.routeStrategyID != strategy.ID || session.routeStrategyFlagNo != strategy.FlagNo {
		t.Fatalf("effective route strategy not recorded: id=%v flag=%d", session.routeStrategyID, session.routeStrategyFlagNo)
	}
	service.finishSessionWithPolicies(session, session.account, selected, "success", "", nil, nil, nil)
	var accessLog models.ProxyGatewayAccessLog
	if err := db.Order("id DESC").First(&accessLog).Error; err != nil {
		t.Fatalf("load indexed access log: %v", err)
	}
	if accessLog.ProxyIndex != 5 || accessLog.ResolvedProxyIndex != 2 || accessLog.ProxyPoolSize != 3 ||
		accessLog.RouteStrategyID == nil || *accessLog.RouteStrategyID != strategy.ID {
		t.Fatalf("indexed access log=%+v", accessLog)
	}

	strictAccount := *session.account
	strictAccount.ProxyIndexOverflowMode = models.ProxyGatewayIndexOverflowReject
	strictSession := session
	strictSession.account = &strictAccount
	strictSession.proxyIndex = 4
	strictSession.resolvedProxyIndex = 0
	strictSession.proxyPoolSize = 0
	if _, _, err := service.selectProxy(strictSession.account, &strictSession, nil, false); err == nil || !strings.Contains(err.Error(), "exceeds pool size 3") {
		t.Fatalf("strict overflow error=%v", err)
	}
}

func TestProxyGatewayTargetRouteFailoverOpensCircuitAndUsesFallback(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	service := NewProxyGatewayService(gatewayRepo, repository.NewProxyPoolRepository(db))
	fakeNow := time.Date(2026, 7, 22, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fakeNow }

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("route-failover-ok"))
	}))
	defer target.Close()
	targetAddr := strings.TrimPrefix(target.URL, "http://")

	var primaryAttempts atomic.Int32
	primaryUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		primaryAttempts.Add(1)
		http.Error(w, "primary unavailable", http.StatusBadGateway)
	}))
	defer primaryUpstream.Close()
	fallbackUpstream := newConnectProxyServer(t)
	defer fallbackUpstream.Close()
	proxyFromServer := func(server *httptest.Server) models.ProxyPoolItem {
		host, portText, _ := net.SplitHostPort(strings.TrimPrefix(server.URL, "http://"))
		port, _ := strconv.Atoi(portText)
		return models.ProxyPoolItem{OrgID: 1, Type: models.ProxyTypeHTTP, Host: host, Port: port, Status: models.ProxyStatusAvailable}
	}
	primaryProxy := proxyFromServer(primaryUpstream)
	fallbackProxy := proxyFromServer(fallbackUpstream)
	if err := db.Create(&primaryProxy).Error; err != nil {
		t.Fatalf("create primary proxy: %v", err)
	}
	if err := db.Create(&fallbackProxy).Error; err != nil {
		t.Fatalf("create fallback proxy: %v", err)
	}

	listener := models.ProxyGatewayListener{OrgID: 1, Name: "route failover", ListenIP: "127.0.0.1", Port: 18103, Protocol: models.ProxyGatewayProtocolMixed, ConnectTimeoutSeconds: 2}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}
	primaryStrategy := models.ProxyGatewayRouteStrategy{
		OrgID: 1, GatewayID: listener.ID, Name: "primary", FlagNo: 81, Enabled: true,
		SelectionMode: models.ProxyGatewaySelectionExplicit, ProxyIDs: models.UintSlice{primaryProxy.ID},
		SelectionAlgorithm: models.ProxyGatewayAlgorithmRandom, FallbackMode: models.ProxyGatewayFallbackInterrupt,
	}
	fallbackStrategy := models.ProxyGatewayRouteStrategy{
		OrgID: 1, GatewayID: listener.ID, Name: "fallback", FlagNo: 82, Enabled: true,
		SelectionMode: models.ProxyGatewaySelectionExplicit, ProxyIDs: models.UintSlice{fallbackProxy.ID},
		SelectionAlgorithm: models.ProxyGatewayAlgorithmRandom, ProxyIndexOverflowMode: models.ProxyGatewayIndexOverflowModulo,
		FallbackMode: models.ProxyGatewayFallbackInterrupt,
	}
	if err := db.Create(&primaryStrategy).Error; err != nil {
		t.Fatalf("create primary strategy: %v", err)
	}
	if err := db.Create(&fallbackStrategy).Error; err != nil {
		t.Fatalf("create fallback strategy: %v", err)
	}
	fallbackID := fallbackStrategy.ID
	route := models.ProxyGatewayTargetRoute{
		OrgID: 1, GatewayID: listener.ID, Name: "default with failover", Enabled: true, IsDefault: true,
		RouteStrategyID: primaryStrategy.ID, FailoverEnabled: true, FallbackRouteStrategyID: &fallbackID,
		FailureThreshold: 2, FailureWindowSeconds: 30, CircuitBaseSeconds: 60, CircuitMaxSeconds: 300,
		CircuitBackoffMultiplier: 2, CircuitJitterPercent: 0, CircuitHalfOpenProbes: 1,
	}
	if err := db.Create(&route).Error; err != nil {
		t.Fatalf("create target route: %v", err)
	}
	if err := service.RefreshTargetRoutes(1, listener.ID); err != nil {
		t.Fatalf("refresh target routes: %v", err)
	}

	security := &models.ProxyGatewaySecurityPolicy{ID: 910001, OrgID: 1, Name: "allow", NoMatchAction: models.ProxyGatewayPolicyAllow, TargetHostAllowlist: models.StringSlice{"*"}}
	dns := &models.ProxyGatewayDNSPolicy{ID: 910002, OrgID: 1, Name: "remote", Mode: models.ProxyGatewayDNSRemote, HTTPConnectPreserveHost: true, ResolveFailureAction: models.ProxyGatewayResolveFailureUseRemoteProxy}
	account := &models.ProxyGatewayAccount{
		ID: 910003, OrgID: 1, Username: "failover-user", Enabled: true,
		ProxySelectionSource: models.ProxyGatewaySelectionSourceGateway,
		SecurityPolicyID:     &security.ID, SecurityPolicy: security, DNSPolicyID: &dns.ID, DNSPolicy: dns,
		ConnectTimeoutSeconds: 2,
	}

	dial := func() gatewaySession {
		session := gatewaySession{listener: listener, account: account, clientIP: "127.0.0.1", protocol: "http", command: "CONNECT", startedAt: fakeNow}
		conn, proxyItem, _, _, err := service.dialWithPolicy(context.Background(), &session, targetAddr)
		if err != nil {
			t.Fatalf("route failover dial: %v", err)
		}
		if conn != nil {
			_ = conn.Close()
		}
		if proxyItem == nil || proxyItem.ID != fallbackProxy.ID {
			t.Fatalf("selected proxy=%v, want fallback %d", proxyItem, fallbackProxy.ID)
		}
		return session
	}

	first := dial()
	if first.routeCircuitState != "closed" || !first.routeFailoverUsed {
		t.Fatalf("first failover state=%s used=%v", first.routeCircuitState, first.routeFailoverUsed)
	}
	second := dial()
	if second.routeCircuitState != "open" {
		t.Fatalf("second failover state=%s, want open", second.routeCircuitState)
	}
	third := dial()
	if !third.routeCircuitCacheHit || third.routeCircuitState != "open" {
		t.Fatalf("cached failover hit=%v state=%s", third.routeCircuitCacheHit, third.routeCircuitState)
	}
	if got := primaryAttempts.Load(); got != 2 {
		t.Fatalf("primary attempts=%d, want 2 before cached bypass", got)
	}
	if third.routeStrategyID == nil || *third.routeStrategyID != fallbackStrategy.ID || third.primaryStrategyID == nil || *third.primaryStrategyID != primaryStrategy.ID {
		t.Fatalf("strategy log context final=%v primary=%v", third.routeStrategyID, third.primaryStrategyID)
	}
	service.finishSessionWithPolicies(third, third.account, &fallbackProxy, "success", "", nil, security, dns)
	var failoverLog models.ProxyGatewayAccessLog
	if err := db.Order("id DESC").First(&failoverLog).Error; err != nil {
		t.Fatalf("load failover access log: %v", err)
	}
	if !failoverLog.RouteFailoverUsed || !failoverLog.RouteCircuitCacheHit || failoverLog.RouteCircuitState != "open" ||
		failoverLog.PrimaryRouteStrategyID == nil || *failoverLog.PrimaryRouteStrategyID != primaryStrategy.ID ||
		failoverLog.FallbackRouteStrategyID == nil || *failoverLog.FallbackRouteStrategyID != fallbackStrategy.ID {
		t.Fatalf("failover access log=%+v", failoverLog)
	}

	// AutoMigrate gives newly inserted rows the production jitter default (10%),
	// so advance beyond the longest possible 60-second opening.
	fakeNow = fakeNow.Add(67 * time.Second)
	probe := dial()
	if !probe.routeCircuitProbe || probe.routeCircuitState != "open" {
		t.Fatalf("half-open probe=%v final state=%s", probe.routeCircuitProbe, probe.routeCircuitState)
	}
	if got := primaryAttempts.Load(); got != 3 {
		t.Fatalf("primary attempts after probe=%d, want 3", got)
	}

	workingFallbackPort := fallbackProxy.Port
	if err := db.Model(&models.ProxyPoolItem{}).Where("id = ?", fallbackProxy.ID).Update("port", freeTCPPort(t)).Error; err != nil {
		t.Fatalf("make fallback proxy unavailable: %v", err)
	}
	fakeNow = fakeNow.Add(133 * time.Second)
	failedProbeSession := gatewaySession{listener: listener, account: account, clientIP: "127.0.0.1", protocol: "http", command: "CONNECT", startedAt: fakeNow}
	failedProbeConn, _, _, _, failedProbeErr := service.dialWithPolicy(context.Background(), &failedProbeSession, targetAddr)
	if failedProbeConn != nil {
		_ = failedProbeConn.Close()
	}
	if failedProbeErr == nil {
		t.Fatal("half-open probe unexpectedly succeeded while both routes were unavailable")
	}
	if !failedProbeSession.routeCircuitProbe || failedProbeSession.routeCircuitState != "open" {
		t.Fatalf("failed half-open probe log state probe=%v state=%s", failedProbeSession.routeCircuitProbe, failedProbeSession.routeCircuitState)
	}
	if err := db.Model(&models.ProxyPoolItem{}).Where("id = ?", fallbackProxy.ID).Update("port", workingFallbackPort).Error; err != nil {
		t.Fatalf("restore fallback proxy: %v", err)
	}

	indexedSession := gatewaySession{
		listener: listener, account: account, clientIP: "127.0.0.1", protocol: "socks5", command: "CONNECT",
		proxyIndex: 2, rawUsername: "failover-user#2", startedAt: fakeNow,
	}
	conn, indexedProxy, _, _, err := service.dialWithPolicy(context.Background(), &indexedSession, targetAddr)
	if err != nil {
		t.Fatalf("indexed route failover: %v", err)
	}
	if conn != nil {
		_ = conn.Close()
	}
	if indexedProxy == nil || indexedProxy.ID != fallbackProxy.ID || indexedSession.resolvedProxyIndex != 1 || indexedSession.proxyPoolSize != 1 {
		t.Fatalf("indexed fallback proxy=%v resolved=%d size=%d", indexedProxy, indexedSession.resolvedProxyIndex, indexedSession.proxyPoolSize)
	}
	if got := primaryAttempts.Load(); got != 4 {
		t.Fatalf("strict primary index unexpectedly dialed upstream; attempts=%d", got)
	}

	if err := db.Model(&models.ProxyGatewayRouteStrategy{}).Where("id = ?", primaryStrategy.ID).Updates(map[string]interface{}{
		"fallback_mode":         models.ProxyGatewayFallbackDirect,
		"allow_direct_fallback": true,
	}).Error; err != nil {
		t.Fatalf("enable primary direct fallback: %v", err)
	}
	if err := service.RefreshTargetRoutes(1, listener.ID); err != nil {
		t.Fatalf("refresh direct fallback route: %v", err)
	}
	directOrderedSession := gatewaySession{listener: listener, account: account, clientIP: "127.0.0.1", protocol: "http", command: "CONNECT", startedAt: fakeNow}
	directOrderedConn, directOrderedProxy, _, _, err := service.dialWithPolicy(context.Background(), &directOrderedSession, targetAddr)
	if err != nil {
		t.Fatalf("route fallback before final direct: %v", err)
	}
	if directOrderedConn != nil {
		_ = directOrderedConn.Close()
	}
	if directOrderedProxy == nil || directOrderedProxy.ID != fallbackProxy.ID {
		t.Fatalf("primary direct ran before route fallback; proxy=%v", directOrderedProxy)
	}

	if err := db.Model(&models.ProxyGatewayRouteStrategy{}).Where("id = ?", fallbackStrategy.ID).Updates(map[string]interface{}{
		"proxy_index_overflow_mode": models.ProxyGatewayIndexOverflowReject,
		"fallback_mode":             models.ProxyGatewayFallbackDirect,
		"allow_direct_fallback":     true,
	}).Error; err != nil {
		t.Fatalf("enable fallback direct with strict index: %v", err)
	}
	if err := service.RefreshTargetRoutes(1, listener.ID); err != nil {
		t.Fatalf("refresh strict fallback route: %v", err)
	}
	strictDirectSession := gatewaySession{
		listener: listener, account: account, clientIP: "127.0.0.1", protocol: "socks5", command: "CONNECT",
		proxyIndex: 2, rawUsername: "failover-user#2", startedAt: fakeNow,
	}
	strictDirectConn, strictDirectProxy, _, _, strictDirectErr := service.dialWithPolicy(context.Background(), &strictDirectSession, targetAddr)
	if strictDirectConn != nil {
		_ = strictDirectConn.Close()
	}
	if strictDirectErr == nil || !strings.Contains(strictDirectErr.Error(), "exceeds pool size 1") {
		t.Fatalf("strict route indexes unexpectedly fell through to direct: proxy=%v err=%v", strictDirectProxy, strictDirectErr)
	}
}

func TestProxyGatewayRouteCircuitBackoffIsCapped(t *testing.T) {
	service := NewProxyGatewayService(nil, nil)
	now := time.Date(2026, 7, 22, 13, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	route := models.ProxyGatewayTargetRoute{
		GatewayID: 7, FailureThreshold: 1, FailureWindowSeconds: 30,
		CircuitBaseSeconds: 60, CircuitMaxSeconds: 300, CircuitBackoffMultiplier: 2,
		CircuitJitterPercent: 0, CircuitHalfOpenProbes: 1,
	}
	const key = "circuit-cap"
	service.recordRoutePrimaryFailure(key, route, false, 0)
	wantDurations := []time.Duration{60 * time.Second, 120 * time.Second, 240 * time.Second, 300 * time.Second, 300 * time.Second}
	lastDecision := routeCircuitDecision{}
	for index, want := range wantDurations {
		entry := service.routeCircuits[key]
		if got := entry.OpenUntil.Sub(now); got != want {
			t.Fatalf("backoff step %d duration=%s, want %s", index, got, want)
		}
		now = entry.OpenUntil
		decision := service.routeCircuitDecision(key, route)
		lastDecision = decision
		if !decision.Probe || decision.SkipPrimary {
			t.Fatalf("backoff step %d decision=%+v", index, decision)
		}
		if index < len(wantDurations)-1 {
			service.recordRoutePrimaryFailure(key, route, true, decision.Generation)
		}
	}
	entry := service.routeCircuits[key]
	level := entry.BackoffLevel
	service.releaseRouteCircuitProbe(key, route, true, lastDecision.Generation)
	entry = service.routeCircuits[key]
	if entry.BackoffLevel != level || entry.OpenUntil.Sub(now) != 300*time.Second {
		t.Fatalf("both-failed probe changed capped backoff: level=%d duration=%s", entry.BackoffLevel, entry.OpenUntil.Sub(now))
	}
	route.CircuitJitterPercent = 50
	for index := 0; index < 100; index++ {
		if duration := service.routeCircuitDurationLocked(route, 20); duration > 300*time.Second {
			t.Fatalf("jitter exceeded hard maximum at sample %d: %s", index, duration)
		}
	}
}

func TestProxyGatewayRouteCircuitCacheIsBounded(t *testing.T) {
	service := NewProxyGatewayService(nil, nil)
	now := time.Date(2026, 7, 22, 14, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	for index := 0; index < routeCircuitMaxEntries; index++ {
		service.routeCircuits[fmt.Sprintf("target-%d", index)] = routeCircuitEntry{GatewayID: 1, LastSeen: now.Add(-time.Duration(index) * time.Second)}
	}
	decision := service.routeCircuitDecision("new-target", models.ProxyGatewayTargetRoute{CircuitHalfOpenProbes: 1})
	if decision.State != "closed" {
		t.Fatalf("new target decision=%+v", decision)
	}
	if got := len(service.routeCircuits); got > routeCircuitPruneEntries {
		t.Fatalf("route circuit cache retained %d entries, want at most %d", got, routeCircuitPruneEntries)
	}
}

func TestProxyGatewayRouteCircuitIgnoresStaleConcurrentProbes(t *testing.T) {
	service := NewProxyGatewayService(nil, nil)
	now := time.Date(2026, 7, 22, 15, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	route := models.ProxyGatewayTargetRoute{
		GatewayID: 9, FailureThreshold: 1, FailureWindowSeconds: 30,
		CircuitBaseSeconds: 60, CircuitMaxSeconds: 300, CircuitBackoffMultiplier: 2,
		CircuitHalfOpenProbes: 2,
	}
	const key = "concurrent-probes"
	service.recordRoutePrimaryFailure(key, route, false, 0)
	entry := service.routeCircuits[key]
	now = entry.OpenUntil
	firstProbe := service.routeCircuitDecision(key, route)
	secondProbe := service.routeCircuitDecision(key, route)
	if !firstProbe.Probe || !secondProbe.Probe || firstProbe.Generation != secondProbe.Generation {
		t.Fatalf("concurrent half-open decisions first=%+v second=%+v", firstProbe, secondProbe)
	}

	service.clearRouteCircuit(key)
	service.recordRoutePrimaryFailure(key, route, true, firstProbe.Generation)
	if state := service.currentRouteCircuitState(key); state != "closed" {
		t.Fatalf("stale failed probe reopened a circuit after another probe succeeded: %s", state)
	}

	closedDecision := service.routeCircuitDecision(key, route)
	service.recordRoutePrimaryFailure(key, route, false, closedDecision.Generation)
	entry = service.routeCircuits[key]
	now = entry.OpenUntil
	firstProbe = service.routeCircuitDecision(key, route)
	secondProbe = service.routeCircuitDecision(key, route)
	service.recordRoutePrimaryFailure(key, route, true, firstProbe.Generation)
	entryAfterFirstFailure := service.routeCircuits[key]
	service.recordRoutePrimaryFailure(key, route, true, secondProbe.Generation)
	entryAfterSecondFailure := service.routeCircuits[key]
	if entryAfterSecondFailure.Generation != entryAfterFirstFailure.Generation || entryAfterSecondFailure.BackoffLevel != entryAfterFirstFailure.BackoffLevel || !entryAfterSecondFailure.OpenUntil.Equal(entryAfterFirstFailure.OpenUntil) {
		t.Fatalf("stale concurrent failure amplified backoff: first=%+v second=%+v", entryAfterFirstFailure, entryAfterSecondFailure)
	}
}

func TestProxyGatewayRouteCircuitKeyChangesWithPolicyConfiguration(t *testing.T) {
	baseTime := time.Date(2026, 7, 22, 16, 0, 0, 0, time.UTC)
	security := &models.ProxyGatewaySecurityPolicy{UpdatedAt: baseTime}
	dns := &models.ProxyGatewayDNSPolicy{UpdatedAt: baseTime}
	strategy := &models.ProxyGatewayRouteStrategy{ID: 3, UpdatedAt: baseTime, SecurityPolicy: security, DNSPolicy: dns}
	fallback := &models.ProxyGatewayRouteStrategy{ID: 4, UpdatedAt: baseTime}
	route := models.ProxyGatewayTargetRoute{ID: 2, RouteStrategyID: strategy.ID, UpdatedAt: baseTime, RouteStrategy: strategy, FallbackRouteStrategy: fallback}
	session := gatewaySession{
		listener:   models.ProxyGatewayListener{ID: 1, OrgID: 1},
		account:    &models.ProxyGatewayAccount{SecurityPolicy: security, DNSPolicy: dns},
		targetHost: "Example.COM.", targetPort: 443,
	}
	firstKey := routeCircuitKey(session, route)
	security.UpdatedAt = baseTime.Add(time.Second)
	secondKey := routeCircuitKey(session, route)
	if firstKey == secondKey {
		t.Fatal("route circuit key did not change after an effective security policy update")
	}
	if !strings.Contains(firstKey, "example.com") {
		t.Fatalf("route circuit key did not normalize target host: %s", firstKey)
	}
	protocolSession := session
	protocolSession.protocol = "socks5"
	if protocolKey := routeCircuitKey(protocolSession, route); protocolKey == secondKey {
		t.Fatal("route circuit key did not isolate protocol-specific dialing behavior")
	}
	timeoutSession := session
	timeoutSession.account.ConnectTimeoutSeconds = 45
	if timeoutKey := routeCircuitKey(timeoutSession, route); timeoutKey == secondKey {
		t.Fatal("route circuit key did not isolate account connect timeout behavior")
	}
}

func TestParseGatewayUsernameRouteSupportsConfiguredSeparators(t *testing.T) {
	tests := []struct {
		name       string
		raw        string
		separators []string
		wantBase   string
		wantFlag   int
		wantKind   gatewayUsernameRouteKind
		wantOK     bool
	}{
		{name: "legacy default", raw: "user#7", wantBase: "user", wantFlag: 7, wantKind: gatewayUsernameRouteSuffix, wantOK: true},
		{name: "custom separator", raw: "user--8", separators: []string{"--"}, wantBase: "user", wantFlag: 8, wantKind: gatewayUsernameRouteSuffix, wantOK: true},
		{name: "longest overlapping separator wins", raw: "user##9", separators: []string{"#", "##"}, wantBase: "user", wantFlag: 9, wantKind: gatewayUsernameRouteSuffix, wantOK: true},
		{name: "router query alias", raw: "user?router=10", separators: []string{"~"}, wantBase: "user", wantFlag: 10, wantKind: gatewayUsernameRouteStrategy, wantOK: true},
		{name: "query syntax remains available", raw: "user?rs=10", separators: []string{"~"}, wantBase: "user", wantFlag: 10, wantKind: gatewayUsernameRouteStrategy, wantOK: true},
		{name: "explicit proxy index query", raw: "user?index=11", separators: []string{"~"}, wantBase: "user", wantFlag: 11, wantKind: gatewayUsernameRouteProxyIndex, wantOK: true},
		{name: "unconfigured separator", raw: "user#11", separators: []string{"~"}, wantOK: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request, ok := parseGatewayUsernameRoute(test.raw, test.separators)
			if ok != test.wantOK {
				t.Fatalf("parse %q ok=%v want=%v request=%+v", test.raw, ok, test.wantOK, request)
			}
			if ok && (request.baseUsername != test.wantBase || request.flagNo != test.wantFlag || request.kind != test.wantKind) {
				t.Fatalf("parse %q=%+v want base=%q flag=%d kind=%q", test.raw, request, test.wantBase, test.wantFlag, test.wantKind)
			}
		})
	}
}

func TestProxyGatewayTargetRoutingUsesFirstMatchIPAndDefault(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	proxyRepo := repository.NewProxyPoolRepository(db)
	service := NewProxyGatewayService(gatewayRepo, proxyRepo)

	listener := models.ProxyGatewayListener{OrgID: 1, Name: "target route gateway", ListenIP: "127.0.0.1", Port: 18082, Protocol: models.ProxyGatewayProtocolMixed}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}
	account := &models.ProxyGatewayAccount{
		ID: 41, OrgID: 1, Username: "route-account", Enabled: true,
		ProxySelectionSource: models.ProxyGatewaySelectionSourceGateway,
		SelectionMode:        models.ProxyGatewaySelectionExplicit, ProxyIDs: models.UintSlice{900},
		SelectionAlgorithm: models.ProxyGatewayAlgorithmRandom,
		FallbackMode:       models.ProxyGatewayFallbackInterrupt,
	}

	createStrategy := func(name string, flag int, proxyID uint) models.ProxyGatewayRouteStrategy {
		strategy := models.ProxyGatewayRouteStrategy{
			OrgID: 1, GatewayID: listener.ID, Name: name, FlagNo: flag, Enabled: true,
			SelectionMode: models.ProxyGatewaySelectionExplicit, ProxyIDs: models.UintSlice{proxyID},
			SelectionAlgorithm: models.ProxyGatewayAlgorithmRoundRobin,
			FallbackMode:       models.ProxyGatewayFallbackInterrupt,
		}
		if err := db.Create(&strategy).Error; err != nil {
			t.Fatalf("create strategy %s: %v", name, err)
		}
		return strategy
	}
	wildcardStrategy := createStrategy("wildcard", 31, 101)
	exactStrategy := createStrategy("exact", 32, 102)
	ipStrategy := createStrategy("ip", 33, 103)
	defaultStrategy := createStrategy("default", 34, 104)

	routes := []models.ProxyGatewayTargetRoute{
		{OrgID: 1, GatewayID: listener.ID, Name: "wildcard first", Enabled: true, SortOrder: 10, Matchers: models.StringSlice{"*.example.com"}, RouteStrategyID: wildcardStrategy.ID},
		{OrgID: 1, GatewayID: listener.ID, Name: "exact later", Enabled: true, SortOrder: 20, Matchers: models.StringSlice{"api.example.com"}, RouteStrategyID: exactStrategy.ID},
		{OrgID: 1, GatewayID: listener.ID, Name: "ip range", Enabled: true, SortOrder: 5, Matchers: models.StringSlice{"203.0.113.0/24"}, RouteStrategyID: ipStrategy.ID},
		{OrgID: 1, GatewayID: listener.ID, Name: "default", Enabled: true, IsDefault: true, SortOrder: 999, RouteStrategyID: defaultStrategy.ID},
	}
	for i := range routes {
		if err := db.Create(&routes[i]).Error; err != nil {
			t.Fatalf("create target route: %v", err)
		}
	}

	tests := []struct {
		name        string
		target      string
		wantProxyID uint
		wantRouteID uint
		wantMatcher string
		wantDefault bool
	}{
		{name: "first domain match wins", target: "api.example.com", wantProxyID: 101, wantRouteID: routes[0].ID, wantMatcher: "*.example.com"},
		{name: "socks client supplied IP", target: "203.0.113.25", wantProxyID: 103, wantRouteID: routes[2].ID, wantMatcher: "203.0.113.0/24"},
		{name: "unmatched uses default", target: "other.example.net", wantProxyID: 104, wantRouteID: routes[3].ID, wantDefault: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			session := gatewaySession{listener: listener, account: account, targetHost: test.target}
			if err := service.applyTargetRoute(&session); err != nil {
				t.Fatalf("apply target route: %v", err)
			}
			if len(session.account.ProxyIDs) != 1 || session.account.ProxyIDs[0] != test.wantProxyID {
				t.Fatalf("selected proxy IDs = %v, want [%d]", session.account.ProxyIDs, test.wantProxyID)
			}
			if session.targetRouteID == nil || *session.targetRouteID != test.wantRouteID {
				t.Fatalf("target route = %v, want %d", session.targetRouteID, test.wantRouteID)
			}
			if session.targetRouteMatcher != test.wantMatcher || session.targetRouteDefault != test.wantDefault {
				t.Fatalf("route context matcher=%q default=%v", session.targetRouteMatcher, session.targetRouteDefault)
			}
		})
	}
}

func TestProxyGatewaySelectionSourceControlsOnlyUnmatchedFallback(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	service := NewProxyGatewayService(repository.NewProxyGatewayRepository(db), repository.NewProxyPoolRepository(db))
	listener := models.ProxyGatewayListener{OrgID: 1, Name: "selection source gateway", ListenIP: "127.0.0.1", Port: 18083, Protocol: models.ProxyGatewayProtocolMixed}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}

	legacySession := gatewaySession{
		listener:   listener,
		targetHost: "unmatched.example",
		account: &models.ProxyGatewayAccount{
			ID: 51, OrgID: 1, Username: "legacy", ProxySelectionSource: models.ProxyGatewaySelectionSourceAccount,
		},
	}
	if err := service.applyTargetRoute(&legacySession); err != nil {
		t.Fatalf("legacy account fallback changed: %v", err)
	}

	gatewaySessionWithoutDefault := gatewaySession{
		listener:   listener,
		targetHost: "unmatched.example",
		account: &models.ProxyGatewayAccount{
			ID: 52, OrgID: 1, Username: "managed", ProxySelectionSource: models.ProxyGatewaySelectionSourceGateway,
		},
	}
	if err := service.applyTargetRoute(&gatewaySessionWithoutDefault); err == nil || !strings.Contains(err.Error(), "requires a matching target route") {
		t.Fatalf("gateway-managed account error=%v, want missing gateway route error", err)
	}

	manualStrategyID := uint(701)
	gatewaySessionWithManualRoute := gatewaySessionWithoutDefault
	gatewaySessionWithManualRoute.routeStrategyID = &manualStrategyID
	if err := service.applyTargetRoute(&gatewaySessionWithManualRoute); err != nil {
		t.Fatalf("explicit username route should satisfy gateway-managed selection: %v", err)
	}
}

func TestProxyGatewayRefreshesEveryGatewayUsingGlobalRouteStrategy(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	service := NewProxyGatewayService(gatewayRepo, repository.NewProxyPoolRepository(db))

	listener := models.ProxyGatewayListener{OrgID: 1, Name: "global strategy gateway", ListenIP: "127.0.0.1", Port: 18084, Protocol: models.ProxyGatewayProtocolMixed}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}
	strategy := models.ProxyGatewayRouteStrategy{
		OrgID: 1, GatewayID: 0, Name: "global IPv4", FlagNo: 81, Enabled: true,
		SelectionMode: models.ProxyGatewaySelectionExplicit, ProxyIDs: models.UintSlice{501},
		SelectionAlgorithm: models.ProxyGatewayAlgorithmRoundRobin,
		FallbackMode:       models.ProxyGatewayFallbackInterrupt,
	}
	if err := db.Create(&strategy).Error; err != nil {
		t.Fatalf("create global strategy: %v", err)
	}
	route := models.ProxyGatewayTargetRoute{
		OrgID: 1, GatewayID: listener.ID, Name: "global strategy route", Enabled: true,
		SortOrder: 10, Matchers: models.StringSlice{"legacy.example"}, RouteStrategyID: strategy.ID,
	}
	if err := db.Create(&route).Error; err != nil {
		t.Fatalf("create target route: %v", err)
	}
	if err := service.RefreshTargetRoutes(1, listener.ID); err != nil {
		t.Fatalf("initial refresh: %v", err)
	}

	strategy.ProxyIDs = models.UintSlice{502}
	if err := gatewayRepo.SaveRouteStrategy(&strategy); err != nil {
		t.Fatalf("update global strategy: %v", err)
	}
	if err := service.RefreshTargetRoutesByStrategy(1, strategy.ID); err != nil {
		t.Fatalf("refresh by strategy: %v", err)
	}

	routes, err := service.targetRoutesForListener(listener)
	if err != nil {
		t.Fatalf("read refreshed routes: %v", err)
	}
	if len(routes) != 1 || routes[0].RouteStrategy == nil || len(routes[0].RouteStrategy.ProxyIDs) != 1 || routes[0].RouteStrategy.ProxyIDs[0] != 502 {
		t.Fatalf("global strategy cache was not refreshed: %+v", routes)
	}
}

func TestProxyGatewayStickySelectionIsReservedBeforeDialSuccess(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	proxyRepo := repository.NewProxyPoolRepository(db)
	service := NewProxyGatewayService(gatewayRepo, proxyRepo)

	proxyA := models.ProxyPoolItem{
		OrgID:  1,
		Type:   models.ProxyTypeHTTP,
		Host:   "proxy-a.test",
		Port:   18080,
		Status: models.ProxyStatusAvailable,
	}
	proxyB := models.ProxyPoolItem{
		OrgID:  1,
		Type:   models.ProxyTypeHTTP,
		Host:   "proxy-b.test",
		Port:   18081,
		Status: models.ProxyStatusAvailable,
	}
	if err := db.Create(&proxyA).Error; err != nil {
		t.Fatalf("create proxy a: %v", err)
	}
	if err := db.Create(&proxyB).Error; err != nil {
		t.Fatalf("create proxy b: %v", err)
	}

	account := &models.ProxyGatewayAccount{
		ID:                 99,
		OrgID:              1,
		Username:           "sticky-user",
		Enabled:            true,
		SelectionMode:      models.ProxyGatewaySelectionAll,
		SelectionAlgorithm: models.ProxyGatewayAlgorithmRoundRobin,
		StickyMode:         models.ProxyGatewayStickyAccount,
		StickyTTLSeconds:   300,
		ProxyMatchTagMode:  models.ProxyTagFilterOR,
		FallbackMode:       models.ProxyGatewayFallbackInterrupt,
		FallbackTagMode:    models.ProxyTagFilterOR,
	}
	session := gatewaySession{
		account:   account,
		clientIP:  "127.0.0.1",
		protocol:  "http",
		command:   "CONNECT",
		startedAt: time.Now(),
	}

	first, _, err := service.selectProxy(account, &session, nil, false)
	if err != nil {
		t.Fatalf("first select: %v", err)
	}
	second, _, err := service.selectProxy(account, &session, nil, false)
	if err != nil {
		t.Fatalf("second select: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("sticky selection was not reserved: first=%d second=%d", first.ID, second.ID)
	}

	retry, _, err := service.selectProxy(account, &session, []uint{first.ID}, false)
	if err != nil {
		t.Fatalf("retry select: %v", err)
	}
	if retry.ID == first.ID {
		t.Fatalf("retry selected excluded sticky proxy: %d", retry.ID)
	}
}

func TestProxyGatewayDNSRebindingProtectionForcesSecurityResolution(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	proxyRepo := repository.NewProxyPoolRepository(db)
	service := NewProxyGatewayService(gatewayRepo, proxyRepo)

	security := models.ProxyGatewaySecurityPolicy{
		OrgID:                  1,
		Name:                   "block loopback",
		BlockLoopback:          true,
		DNSRebindingProtection: true,
		NoMatchAction:          models.ProxyGatewayPolicyAllow,
	}
	dnsPolicy := models.ProxyGatewayDNSPolicy{
		OrgID:                 1,
		Name:                  "remote fallback",
		Mode:                  models.ProxyGatewayDNSRemote,
		PreResolveForSecurity: false,
		ResolveFailureAction:  models.ProxyGatewayResolveFailureUseRemoteProxy,
	}
	service.dnsCache["remote::internal.test"] = dnsCacheEntry{
		IPs:       []net.IP{net.ParseIP("127.0.0.1")},
		ExpiresAt: time.Now().Add(time.Minute),
	}
	if err := service.authorizeTarget(context.Background(), security, dnsPolicy, "127.0.0.1", "internal.test", 80); err == nil {
		t.Fatal("expected localhost to be denied by DNS rebinding protection")
	}
}

func TestProxyGatewayEffectivePoliciesFailClosedWhenExplicitPolicyMissing(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	proxyRepo := repository.NewProxyPoolRepository(db)
	service := NewProxyGatewayService(gatewayRepo, proxyRepo)

	missingSecurityID := uint(404)
	listener := models.ProxyGatewayListener{
		ID:               1,
		OrgID:            1,
		Name:             "missing policy gateway",
		ListenIP:         "127.0.0.1",
		Port:             18082,
		Protocol:         models.ProxyGatewayProtocolMixed,
		SecurityPolicyID: &missingSecurityID,
	}
	if _, _, err := service.effectivePolicies(listener, nil); err == nil {
		t.Fatal("expected missing explicit security policy to fail closed")
	}

	security := repository.DefaultProxyGatewaySecurityPolicy(1, listener.ID)
	if err := db.Create(security).Error; err != nil {
		t.Fatalf("create security policy: %v", err)
	}
	missingDNSID := uint(405)
	listener.SecurityPolicyID = &security.ID
	listener.DNSPolicyID = &missingDNSID
	if _, _, err := service.effectivePolicies(listener, nil); err == nil {
		t.Fatal("expected missing explicit DNS policy to fail closed")
	}
}

func TestProxyGatewayPublicListenerRequiresAuthentication(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	proxyRepo := repository.NewProxyPoolRepository(db)
	service := NewProxyGatewayService(gatewayRepo, proxyRepo)

	err := service.startListener(models.ProxyGatewayListener{
		ID:                1,
		OrgID:             1,
		Name:              "unsafe public gateway",
		ListenIP:          "0.0.0.0",
		Port:              18083,
		Protocol:          models.ProxyGatewayProtocolMixed,
		AllowPublicListen: true,
		RequireAuth:       false,
	})
	if err == nil {
		t.Fatal("expected public listener without auth to be rejected")
	}
}

func TestProxyGatewayDNSPolicyControlsDialTargetAndConnectHost(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	proxyRepo := repository.NewProxyPoolRepository(db)
	service := NewProxyGatewayService(gatewayRepo, proxyRepo)

	dnsPolicy := models.ProxyGatewayDNSPolicy{
		OrgID:                   1,
		Name:                    "local preserve",
		Mode:                    models.ProxyGatewayDNSLocal,
		Socks5RemoteResolve:     false,
		HTTPConnectPreserveHost: true,
		ResolveFailureAction:    models.ProxyGatewayResolveFailureDeny,
	}
	session := gatewaySession{protocol: "http", command: "CONNECT"}
	target, hostHeader, err := service.targetForDNSMode(context.Background(), dnsPolicy, session, "localhost", 443)
	if err != nil {
		t.Fatalf("targetForDNSMode: %v", err)
	}
	resolvedHost, resolvedPort, err := net.SplitHostPort(target)
	if err != nil {
		t.Fatalf("split resolved target: %v", err)
	}
	if net.ParseIP(resolvedHost) == nil {
		t.Fatalf("expected local DNS mode to dial an IP, got %q", target)
	}
	if resolvedPort != "443" {
		t.Fatalf("resolved target port = %s", resolvedPort)
	}
	if hostHeader != "localhost:443" {
		t.Fatalf("expected preserved CONNECT Host header, got %q", hostHeader)
	}

	dnsPolicy.Mode = models.ProxyGatewayDNSRemote
	dnsPolicy.Socks5RemoteResolve = false
	session = gatewaySession{protocol: "socks5", command: "CONNECT"}
	target, _, err = service.targetForDNSMode(context.Background(), dnsPolicy, session, "localhost", 1080)
	if err != nil {
		t.Fatalf("socks targetForDNSMode: %v", err)
	}
	resolvedHost, _, err = net.SplitHostPort(target)
	if err != nil {
		t.Fatalf("split socks resolved target: %v", err)
	}
	if net.ParseIP(resolvedHost) == nil {
		t.Fatalf("expected socks5RemoteResolve=false to dial an IP, got %q", target)
	}
}

func TestProxyGatewayRepositoryRefusesDeletingReferencedPolicies(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)

	security := models.ProxyGatewaySecurityPolicy{
		OrgID:         1,
		GatewayID:     1,
		Name:          "referenced security",
		NoMatchAction: models.ProxyGatewayPolicyAllow,
	}
	dnsPolicy := models.ProxyGatewayDNSPolicy{
		OrgID:                1,
		GatewayID:            1,
		Name:                 "referenced dns",
		Mode:                 models.ProxyGatewayDNSRemote,
		MultiIPStrategy:      models.ProxyGatewayMultiIPCheckAll,
		ResolveFailureAction: models.ProxyGatewayResolveFailureDeny,
	}
	if err := db.Create(&security).Error; err != nil {
		t.Fatalf("create security policy: %v", err)
	}
	if err := db.Create(&dnsPolicy).Error; err != nil {
		t.Fatalf("create dns policy: %v", err)
	}
	listener := models.ProxyGatewayListener{
		OrgID:            1,
		Name:             "referencing gateway",
		ListenIP:         "127.0.0.1",
		Port:             18084,
		Protocol:         models.ProxyGatewayProtocolMixed,
		SecurityPolicyID: &security.ID,
		DNSPolicyID:      &dnsPolicy.ID,
	}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}

	if err := gatewayRepo.DeleteSecurityPolicy(1, security.ID); err == nil {
		t.Fatal("expected referenced security policy deletion to be rejected")
	}
	if err := gatewayRepo.DeleteDNSPolicy(1, dnsPolicy.ID); err == nil {
		t.Fatal("expected referenced DNS policy deletion to be rejected")
	}
}

func newProxyGatewayTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open sqlite connection pool: %v", err)
	}
	// Gateway protocol tests write access logs from connection goroutines.
	// A single SQLite connection avoids table-lock errors that do not occur on
	// the production database and makes race-mode assertions deterministic.
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(
		&models.ProxyPoolItem{},
		&models.ProxyPoolItemTag{},
		&models.ProxyGatewayListener{},
		&models.ProxyGatewayAccount{},
		&models.ProxyGatewayRouteStrategy{},
		&models.ProxyGatewayTargetRoute{},
		&models.ProxyGatewayAccountGroup{},
		&models.ProxyGatewayAccountTag{},
		&models.ProxyGatewayAccountTagLink{},
		&models.ProxyGatewaySecurityPolicy{},
		&models.ProxyGatewayDNSPolicy{},
		&models.ProxyGatewayAccessLog{},
		&models.ProxyGatewayAuditLog{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func newStallingTCPServer(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("start stalling TCP server: %v", err)
	}
	accepted := make(chan net.Conn, 1)
	var acceptWG sync.WaitGroup
	acceptWG.Add(1)
	go func() {
		defer acceptWG.Done()
		conn, err := listener.Accept()
		if err == nil {
			accepted <- conn
		}
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		acceptWG.Wait()
		select {
		case conn := <-accepted:
			_ = conn.Close()
		default:
		}
	})
	return listener.Addr().String()
}

func findGatewayStatus(statuses []ProxyGatewayRuntimeStatus, listenerID uint) (ProxyGatewayRuntimeStatus, bool) {
	for _, status := range statuses {
		if status.ListenerID == listenerID {
			return status, true
		}
	}
	return ProxyGatewayRuntimeStatus{}, false
}

func newConnectProxyServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect {
			http.Error(w, "CONNECT only", http.StatusMethodNotAllowed)
			return
		}
		targetConn, err := net.DialTimeout("tcp", r.Host, 5*time.Second)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			http.Error(w, "hijack unsupported", http.StatusInternalServerError)
			_ = targetConn.Close()
			return
		}
		clientConn, _, err := hijacker.Hijack()
		if err != nil {
			_ = targetConn.Close()
			return
		}
		_, _ = clientConn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
		go func() {
			defer clientConn.Close()
			defer targetConn.Close()
			_, _ = io.Copy(targetConn, clientConn)
		}()
		go func() {
			defer clientConn.Close()
			defer targetConn.Close()
			_, _ = io.Copy(clientConn, targetConn)
		}()
	}))
	return server
}

func freeTCPPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen free port: %v", err)
	}
	defer listener.Close()
	_, portText, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portText)
	return port
}

func assertHTTPConnectTunnel(t *testing.T, db *gorm.DB, gatewayAddr, targetHostPort string) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", gatewayAddr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial gateway HTTP: %v", err)
	}
	defer conn.Close()
	auth := base64.StdEncoding.EncodeToString([]byte("gateway-user:secret"))
	_, _ = fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\nProxy-Authorization: Basic %s\r\n\r\n", targetHostPort, targetHostPort, auth)
	reader := bufio.NewReader(conn)
	status, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read CONNECT status: %v", err)
	}
	if !strings.Contains(status, "200") {
		var logs []models.ProxyGatewayAccessLog
		_ = db.Order("id DESC").Limit(3).Find(&logs).Error
		t.Fatalf("CONNECT status = %s logs=%+v", strings.TrimSpace(status), logs)
	}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read CONNECT header: %v", err)
		}
		if line == "\r\n" {
			break
		}
	}
	_, _ = fmt.Fprintf(conn, "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", targetHostPort)
	resp, err := http.ReadResponse(reader, nil)
	if err != nil {
		t.Fatalf("read tunneled HTTP response: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "gateway-ok" {
		t.Fatalf("HTTP tunnel body = %q", body)
	}
}

func assertHTTPForward(t *testing.T, gatewayAddr, targetURL string) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", gatewayAddr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial gateway HTTP forward: %v", err)
	}
	defer conn.Close()
	auth := base64.StdEncoding.EncodeToString([]byte("gateway-user:secret"))
	_, _ = fmt.Fprintf(conn, "GET %s HTTP/1.1\r\nHost: %s\r\nProxy-Authorization: Basic %s\r\nConnection: close\r\n\r\n", targetURL, strings.TrimPrefix(targetURL, "http://"), auth)
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("read forwarded HTTP response: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "gateway-ok" {
		t.Fatalf("HTTP forward body = %q", body)
	}
}

func assertSocks5Tunnel(t *testing.T, gatewayAddr, targetHostPort string) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", gatewayAddr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial gateway SOCKS5: %v", err)
	}
	defer conn.Close()
	_, _ = conn.Write([]byte{0x05, 0x01, 0x02})
	method := make([]byte, 2)
	if _, err := io.ReadFull(conn, method); err != nil {
		t.Fatalf("read method: %v", err)
	}
	if method[1] != 0x02 {
		t.Fatalf("SOCKS method = %#x", method[1])
	}
	user := []byte("gateway-user")
	pass := []byte("secret")
	authReq := append([]byte{0x01, byte(len(user))}, user...)
	authReq = append(authReq, byte(len(pass)))
	authReq = append(authReq, pass...)
	_, _ = conn.Write(authReq)
	authResp := make([]byte, 2)
	if _, err := io.ReadFull(conn, authResp); err != nil {
		t.Fatalf("read auth response: %v", err)
	}
	if authResp[1] != 0x00 {
		t.Fatalf("auth response = %#x", authResp[1])
	}
	host, portText, _ := net.SplitHostPort(targetHostPort)
	port, _ := strconv.Atoi(portText)
	req := []byte{0x05, 0x01, 0x00, 0x03, byte(len(host))}
	req = append(req, []byte(host)...)
	req = append(req, byte(port>>8), byte(port))
	_, _ = conn.Write(req)
	reply := make([]byte, 10)
	if _, err := io.ReadFull(conn, reply); err != nil {
		t.Fatalf("read socks reply: %v", err)
	}
	if reply[1] != 0x00 {
		t.Fatalf("SOCKS reply = %#x", reply[1])
	}
	_, _ = fmt.Fprintf(conn, "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", targetHostPort)
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("read SOCKS tunneled response: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "gateway-ok" {
		t.Fatalf("SOCKS tunnel body = %q", body)
	}
}
