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
	conn, _, _, _, err := service.dialWithPolicy(context.Background(), testSession, targetHostPort)
	if err != nil {
		t.Fatalf("direct dialWithPolicy failed: %v", err)
	}
	_ = conn.Close()

	gatewayAddr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	assertHTTPConnectTunnel(t, db, gatewayAddr, targetHostPort)
	assertSocks5Tunnel(t, gatewayAddr, targetHostPort)
}

func TestProxyGatewaySmartUsernameRoutingRequiresPermission(t *testing.T) {
	db := newProxyGatewayTestDB(t)
	gatewayRepo := repository.NewProxyGatewayRepository(db)
	proxyRepo := repository.NewProxyPoolRepository(db)
	service := NewProxyGatewayService(gatewayRepo, proxyRepo)

	listener := models.ProxyGatewayListener{
		OrgID:     1,
		Name:      "test gateway",
		ListenIP:  "127.0.0.1",
		Port:      18081,
		Protocol:  models.ProxyGatewayProtocolMixed,
		Enabled:   true,
		IsDefault: true,
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

	auth, err := service.authenticateAccount(listener, "route-user#17;purpose=test", "secret")
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

	if _, err := service.authenticateAccount(listener, "route-user#18", "secret"); err == nil {
		t.Fatal("expected unauthorized route strategy to be rejected")
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

	first, _, err := service.selectProxy(account, session, nil, false)
	if err != nil {
		t.Fatalf("first select: %v", err)
	}
	second, _, err := service.selectProxy(account, session, nil, false)
	if err != nil {
		t.Fatalf("second select: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("sticky selection was not reserved: first=%d second=%d", first.ID, second.ID)
	}

	retry, _, err := service.selectProxy(account, session, []uint{first.ID}, false)
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
	if err := db.AutoMigrate(
		&models.ProxyPoolItem{},
		&models.ProxyPoolItemTag{},
		&models.ProxyGatewayListener{},
		&models.ProxyGatewayAccount{},
		&models.ProxyGatewayRouteStrategy{},
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
