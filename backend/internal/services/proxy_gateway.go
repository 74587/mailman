package services

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/utils"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	cryptossh "golang.org/x/crypto/ssh"
	xproxy "golang.org/x/net/proxy"
)

type ProxyGatewayService struct {
	repo      *repository.ProxyGatewayRepository
	proxyRepo *repository.ProxyPoolRepository
	logger    *utils.Logger

	reloadMu      sync.Mutex
	mu            sync.RWMutex
	runtimes      map[uint]*proxyGatewayRuntime
	configured    map[uint]models.ProxyGatewayListener
	startFailures map[uint]listenerStartFailure
	roundRobin    map[string]int
	lastSuccess   map[string]uint
	sticky        map[string]stickyProxyEntry
	active        map[uint]int
	rateWindows   map[uint]rateWindow
	dnsCache      map[string]dnsCacheEntry
	targetRoutes  map[uint][]models.ProxyGatewayTargetRoute
	routeCircuits map[string]routeCircuitEntry
	rand          *rand.Rand
	now           func() time.Time
}

type proxyGatewayRuntime struct {
	listenerConfig models.ProxyGatewayListener
	listener       net.Listener
	stopOnce       sync.Once
	stopped        chan struct{}
	signature      string
	service        *ProxyGatewayService

	mu             sync.RWMutex
	activeConns    int
	totalConns     int64
	totalBytesIn   int64
	totalBytesOut  int64
	lastError      string
	lastStartedAt  time.Time
	lastReloadedAt time.Time
	running        bool
	stopping       bool
}

type listenerStartFailure struct {
	message string
	at      time.Time
}

type ProxyGatewayRuntimeStatus struct {
	ListenerID     uint      `json:"listenerId"`
	Name           string    `json:"name"`
	ListenAddress  string    `json:"listenAddress"`
	Protocol       string    `json:"protocol"`
	Enabled        bool      `json:"enabled"`
	Running        bool      `json:"running"`
	ActiveConns    int       `json:"activeConns"`
	TotalConns     int64     `json:"totalConns"`
	TotalBytesIn   int64     `json:"totalBytesIn"`
	TotalBytesOut  int64     `json:"totalBytesOut"`
	LastError      string    `json:"lastError,omitempty"`
	LastStartedAt  time.Time `json:"lastStartedAt,omitempty"`
	LastReloadedAt time.Time `json:"lastReloadedAt,omitempty"`
}

type stickyProxyEntry struct {
	ProxyID   uint
	ExpiresAt time.Time
}

type rateWindow struct {
	StartedAt time.Time
	Count     int
}

type dnsCacheEntry struct {
	IPs       []net.IP
	Error     string
	ExpiresAt time.Time
}

type routeCircuitEntry struct {
	GatewayID    uint
	FailureCount int
	WindowStart  time.Time
	BackoffLevel int
	OpenUntil    time.Time
	ActiveProbes int
	LastSeen     time.Time
	Generation   uint64
}

const (
	routeCircuitMaxEntries   = 4096
	routeCircuitPruneEntries = 3072
)

type routeCircuitDecision struct {
	SkipPrimary bool
	Probe       bool
	State       string
	CacheHit    bool
	Generation  uint64
}

type gatewaySession struct {
	listener                           models.ProxyGatewayListener
	account                            *models.ProxyGatewayAccount
	clientIP                           string
	clientPort                         string
	protocol                           string
	command                            string
	targetHost                         string
	targetPort                         int
	startedAt                          time.Time
	bytesIn                            int64
	bytesOut                           int64
	rawUsername                        string
	routeStrategyID                    *uint
	routeStrategyFlagNo                int
	proxyIndex                         int
	resolvedProxyIndex                 int
	proxyPoolSize                      int
	routeParams                        models.JSONMapInterface
	targetRouteID                      *uint
	targetRouteMatcher                 string
	targetRouteDefault                 bool
	targetRoute                        *models.ProxyGatewayTargetRoute
	primaryStrategyID                  *uint
	fallbackStrategyID                 *uint
	primaryRouteStrategy               *models.ProxyGatewayRouteStrategy
	fallbackRouteStrategy              *models.ProxyGatewayRouteStrategy
	primaryStrategyOverride            *models.ProxyGatewayAccountRouteStrategyOverride
	fallbackStrategyOverride           *models.ProxyGatewayAccountRouteStrategyOverride
	routeStrategyOverrideSourceID      *uint
	routeStrategyOverrideReplacementID *uint
	routeFailoverUsed                  bool
	routeFailoverReason                string
	routeCircuitState                  string
	routeCircuitCacheHit               bool
	routeCircuitProbe                  bool
}

type gatewayAuthResult struct {
	account               *models.ProxyGatewayAccount
	rawUsername           string
	routeStrategy         *models.ProxyGatewayRouteStrategy
	routeStrategyOverride *models.ProxyGatewayAccountRouteStrategyOverride
	proxyIndex            int
	routeParams           models.JSONMapInterface
}

func NewProxyGatewayService(repo *repository.ProxyGatewayRepository, proxyRepo *repository.ProxyPoolRepository) *ProxyGatewayService {
	return &ProxyGatewayService{
		repo:          repo,
		proxyRepo:     proxyRepo,
		logger:        utils.NewLogger("ProxyGateway"),
		runtimes:      map[uint]*proxyGatewayRuntime{},
		configured:    map[uint]models.ProxyGatewayListener{},
		startFailures: map[uint]listenerStartFailure{},
		roundRobin:    map[string]int{},
		lastSuccess:   map[string]uint{},
		sticky:        map[string]stickyProxyEntry{},
		active:        map[uint]int{},
		rateWindows:   map[uint]rateWindow{},
		dnsCache:      map[string]dnsCacheEntry{},
		targetRoutes:  map[uint][]models.ProxyGatewayTargetRoute{},
		routeCircuits: map[string]routeCircuitEntry{},
		rand:          rand.New(rand.NewSource(time.Now().UnixNano())),
		now:           time.Now,
	}
}

func (s *ProxyGatewayService) Start(ctx context.Context) error {
	return s.Reload(ctx)
}

func (s *ProxyGatewayService) Stop(ctx context.Context) error {
	s.reloadMu.Lock()
	defer s.reloadMu.Unlock()
	s.mu.Lock()
	runtimes := s.runtimes
	s.runtimes = map[uint]*proxyGatewayRuntime{}
	s.mu.Unlock()

	for _, runtime := range runtimes {
		runtime.stop()
	}
	for _, runtime := range runtimes {
		select {
		case <-runtime.stopped:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func (s *ProxyGatewayService) Reload(ctx context.Context) error {
	s.reloadMu.Lock()
	defer s.reloadMu.Unlock()
	listeners, err := s.repo.ListEnabledListeners()
	if err != nil {
		return err
	}

	nextByID := map[uint]models.ProxyGatewayListener{}
	nextTargetRoutes := map[uint][]models.ProxyGatewayTargetRoute{}
	for _, listener := range listeners {
		nextByID[listener.ID] = listener
		routes, err := s.repo.ListEnabledTargetRoutes(listener.OrgID, listener.ID)
		if err != nil {
			return fmt.Errorf("load target routes for gateway %d: %w", listener.ID, err)
		}
		nextTargetRoutes[listener.ID] = routes
	}

	s.mu.Lock()
	current := s.runtimes
	next := make(map[uint]*proxyGatewayRuntime, len(nextByID))
	nextFailures := make(map[uint]listenerStartFailure, len(nextByID))
	for id := range nextByID {
		if failure, ok := s.startFailures[id]; ok {
			nextFailures[id] = failure
		}
	}
	var toStop []*proxyGatewayRuntime
	var toStart []models.ProxyGatewayListener

	for id, runtime := range current {
		listener, ok := nextByID[id]
		if !ok {
			toStop = append(toStop, runtime)
			continue
		}
		signature := listenerSignature(listener)
		runtime.mu.Lock()
		running := runtime.running
		if runtime.signature == signature && running {
			runtime.listenerConfig = listener
			runtime.lastReloadedAt = time.Now()
			runtime.mu.Unlock()
			next[id] = runtime
			delete(nextFailures, id)
			continue
		}
		runtime.mu.Unlock()
		toStop = append(toStop, runtime)
		toStart = append(toStart, listener)
	}
	for id, listener := range nextByID {
		if _, ok := current[id]; !ok {
			toStart = append(toStart, listener)
		}
	}
	s.runtimes = next
	s.configured = nextByID
	s.startFailures = nextFailures
	s.targetRoutes = nextTargetRoutes
	s.routeCircuits = map[string]routeCircuitEntry{}
	s.mu.Unlock()

	for _, runtime := range toStop {
		runtime.stop()
	}
	var startErrors []error
	for _, listener := range toStart {
		if err := s.startListener(listener); err != nil {
			wrapped := fmt.Errorf("start listener %q (%s): %w", listener.Name, net.JoinHostPort(listener.ListenIP, strconv.Itoa(listener.Port)), err)
			startErrors = append(startErrors, wrapped)
			s.mu.Lock()
			s.startFailures[listener.ID] = listenerStartFailure{message: wrapped.Error(), at: time.Now()}
			s.mu.Unlock()
			s.logger.Error("failed to start proxy gateway listener %d: %v", listener.ID, err)
			_ = s.repo.CreateAuditLog(&models.ProxyGatewayAuditLog{
				OrgID:      listener.OrgID,
				Action:     "listener_start_failed",
				Resource:   "listener",
				ResourceID: &listener.ID,
				Summary:    err.Error(),
			})
		}
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return errors.Join(startErrors...)
	}
}

// RefreshTargetRoutes updates the in-memory ordered route table without
// restarting the listener. API handlers call this after route or strategy
// changes so new connections observe the configuration immediately.
func (s *ProxyGatewayService) RefreshTargetRoutes(orgID, gatewayID uint) error {
	routes, err := s.repo.ListEnabledTargetRoutes(orgID, gatewayID)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.targetRoutes[gatewayID] = routes
	for key, entry := range s.routeCircuits {
		if entry.GatewayID == gatewayID {
			delete(s.routeCircuits, key)
		}
	}
	s.mu.Unlock()
	return nil
}

// RefreshTargetRoutesByStrategy refreshes every gateway whose enabled target
// routes reference a strategy. This matters for reusable global strategies,
// whose own GatewayID is zero rather than the ID of any listener cache.
func (s *ProxyGatewayService) RefreshTargetRoutesByStrategy(orgID, strategyID uint) error {
	gatewayIDs, err := s.repo.ListEnabledTargetRouteGatewayIDsByStrategy(orgID, strategyID)
	if err != nil {
		return err
	}
	for _, gatewayID := range gatewayIDs {
		if err := s.RefreshTargetRoutes(orgID, gatewayID); err != nil {
			return err
		}
	}
	return nil
}

func (s *ProxyGatewayService) Status() []ProxyGatewayRuntimeStatus {
	s.mu.RLock()
	configured := make(map[uint]models.ProxyGatewayListener, len(s.configured))
	for id, listener := range s.configured {
		configured[id] = listener
	}
	runtimes := make(map[uint]*proxyGatewayRuntime, len(s.runtimes))
	for id, runtime := range s.runtimes {
		runtimes[id] = runtime
	}
	failures := make(map[uint]listenerStartFailure, len(s.startFailures))
	for id, failure := range s.startFailures {
		failures[id] = failure
	}
	s.mu.RUnlock()

	statuses := make([]ProxyGatewayRuntimeStatus, 0, len(configured))
	for id, listener := range configured {
		runtime := runtimes[id]
		if runtime == nil {
			failure := failures[id]
			statuses = append(statuses, ProxyGatewayRuntimeStatus{
				ListenerID:     listener.ID,
				Name:           listener.Name,
				ListenAddress:  net.JoinHostPort(listener.ListenIP, strconv.Itoa(listener.Port)),
				Protocol:       string(listener.Protocol),
				Enabled:        listener.Enabled,
				Running:        false,
				LastError:      failure.message,
				LastReloadedAt: failure.at,
			})
			continue
		}
		runtime.mu.RLock()
		listener = runtime.listenerConfig
		statuses = append(statuses, ProxyGatewayRuntimeStatus{
			ListenerID:     listener.ID,
			Name:           listener.Name,
			ListenAddress:  net.JoinHostPort(listener.ListenIP, strconv.Itoa(listener.Port)),
			Protocol:       string(listener.Protocol),
			Enabled:        listener.Enabled,
			Running:        runtime.running,
			ActiveConns:    runtime.activeConns,
			TotalConns:     runtime.totalConns,
			TotalBytesIn:   runtime.totalBytesIn,
			TotalBytesOut:  runtime.totalBytesOut,
			LastError:      runtime.lastError,
			LastStartedAt:  runtime.lastStartedAt,
			LastReloadedAt: runtime.lastReloadedAt,
		})
		runtime.mu.RUnlock()
	}
	sort.Slice(statuses, func(i, j int) bool { return statuses[i].ListenerID < statuses[j].ListenerID })
	return statuses
}

func (s *ProxyGatewayService) startListener(listener models.ProxyGatewayListener) error {
	if strings.TrimSpace(listener.ListenIP) == "" {
		listener.ListenIP = "127.0.0.1"
	}
	listener.Protocol = models.NormalizeProxyGatewayProtocol(listener.Protocol)
	if listener.Port <= 0 || listener.Port > 65535 {
		return fmt.Errorf("invalid proxy gateway port: %d", listener.Port)
	}
	if !listener.AllowPublicListen && !isLoopbackHost(listener.ListenIP) {
		return fmt.Errorf("listener %s:%d is not loopback and public listen is disabled", listener.ListenIP, listener.Port)
	}
	if listener.AllowPublicListen && !isLoopbackHost(listener.ListenIP) && !listener.RequireAuth {
		return fmt.Errorf("listener %s:%d cannot be exposed without authentication", listener.ListenIP, listener.Port)
	}

	addr := net.JoinHostPort(listener.ListenIP, strconv.Itoa(listener.Port))
	netListener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	runtime := &proxyGatewayRuntime{
		listenerConfig: listener,
		listener:       netListener,
		stopped:        make(chan struct{}),
		signature:      listenerSignature(listener),
		service:        s,
		lastStartedAt:  time.Now(),
		lastReloadedAt: time.Now(),
		running:        true,
	}

	s.mu.Lock()
	if existing := s.runtimes[listener.ID]; existing != nil {
		existing.stop()
	}
	s.runtimes[listener.ID] = runtime
	delete(s.startFailures, listener.ID)
	s.mu.Unlock()

	go runtime.serve()
	_ = s.repo.CreateAuditLog(&models.ProxyGatewayAuditLog{
		OrgID:      listener.OrgID,
		Action:     "listener_started",
		Resource:   "listener",
		ResourceID: &listener.ID,
		Summary:    addr,
	})
	return nil
}

func (r *proxyGatewayRuntime) serve() {
	defer func() {
		r.mu.Lock()
		r.running = false
		r.mu.Unlock()
		close(r.stopped)
	}()
	for {
		conn, err := r.listener.Accept()
		if err != nil {
			r.mu.Lock()
			if !r.stopping {
				r.lastError = err.Error()
			}
			r.mu.Unlock()
			return
		}
		r.mu.Lock()
		r.activeConns++
		r.totalConns++
		r.mu.Unlock()
		go r.handleConn(conn)
	}
}

func (r *proxyGatewayRuntime) stop() {
	r.stopOnce.Do(func() {
		r.mu.Lock()
		r.stopping = true
		r.mu.Unlock()
		if r.listener != nil {
			_ = r.listener.Close()
		}
	})
}

func (r *proxyGatewayRuntime) handleConn(conn net.Conn) {
	counted := &countingConn{Conn: conn}
	defer func() {
		r.mu.Lock()
		r.activeConns--
		r.totalBytesIn += counted.bytesIn
		r.totalBytesOut += counted.bytesOut
		r.mu.Unlock()
		_ = counted.Close()
	}()

	r.mu.RLock()
	listener := r.listenerConfig
	r.mu.RUnlock()
	timeout := time.Duration(nonZero(listener.HandshakeTimeoutSeconds, 10)) * time.Second
	_ = counted.SetReadDeadline(time.Now().Add(timeout))
	reader := bufio.NewReader(counted)
	first, err := reader.Peek(1)
	if err != nil {
		return
	}
	_ = counted.SetReadDeadline(time.Time{})

	switch listener.Protocol {
	case models.ProxyGatewayProtocolSocks5:
		r.service.handleSocks5(counted, reader, listener)
	case models.ProxyGatewayProtocolHTTP:
		r.service.handleHTTPProxy(counted, reader, listener)
	default:
		if first[0] == 0x05 {
			r.service.handleSocks5(counted, reader, listener)
		} else {
			r.service.handleHTTPProxy(counted, reader, listener)
		}
	}
}

type countingConn struct {
	net.Conn
	bytesIn  int64
	bytesOut int64
}

func (c *countingConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.bytesIn += int64(n)
	return n, err
}

func (c *countingConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	c.bytesOut += int64(n)
	return n, err
}

func (s *ProxyGatewayService) handleHTTPProxy(conn net.Conn, reader *bufio.Reader, listener models.ProxyGatewayListener) {
	for {
		req, err := http.ReadRequest(reader)
		if err != nil {
			return
		}
		session := s.newSession(listener, conn.RemoteAddr(), "http", req.Method)
		auth, authErr := s.authenticateHTTP(listener, req)
		account := auth.account
		if authErr != nil {
			session.targetHost, session.targetPort = targetFromHTTPRequest(req)
			s.writeHTTPError(conn, http.StatusProxyAuthRequired, "proxy authentication required", true)
			s.finishSession(session, account, nil, "denied", "authentication failed", authErr)
			return
		}
		session.account = account
		s.applyAuthResultToSession(&session, auth)
		session.targetHost, session.targetPort = targetFromHTTPRequest(req)
		if session.targetHost == "" || session.targetPort == 0 {
			s.writeHTTPError(conn, http.StatusBadRequest, "invalid proxy target", false)
			s.finishSession(session, account, nil, "failed", "", errors.New("invalid target"))
			return
		}

		if !s.enterAccount(account) {
			s.writeHTTPError(conn, http.StatusTooManyRequests, "proxy account limit exceeded", false)
			s.finishSession(session, account, nil, "denied", "account limit exceeded", nil)
			return
		}

		err = func() error {
			defer s.leaveAccount(account)
			if req.Method == http.MethodConnect {
				return s.handleHTTPConnect(conn, req, session)
			}
			return s.handleHTTPForward(conn, req, session)
		}()
		if err != nil || req.Close {
			return
		}
	}
}

func (s *ProxyGatewayService) handleHTTPConnect(client net.Conn, req *http.Request, session gatewaySession) error {
	targetAddr := net.JoinHostPort(session.targetHost, strconv.Itoa(session.targetPort))
	upstreamConn, proxyItem, policy, dnsPolicy, err := s.dialWithPolicy(context.Background(), &session, targetAddr)
	if err != nil {
		s.writeHTTPError(client, http.StatusBadGateway, "proxy gateway connect failed", false)
		s.finishSession(session, session.account, proxyItem, "failed", "", err)
		return err
	}
	defer upstreamConn.Close()

	_, _ = client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))
	bytesIn, bytesOut := proxyPipe(client, upstreamConn, session)
	session.bytesIn += bytesIn
	session.bytesOut += bytesOut
	s.finishSessionWithPolicies(session, session.account, proxyItem, "success", "", nil, policy, dnsPolicy)
	return nil
}

func (s *ProxyGatewayService) handleHTTPForward(client net.Conn, req *http.Request, session gatewaySession) error {
	if req.URL == nil || req.URL.Scheme == "" || req.URL.Host == "" {
		s.writeHTTPError(client, http.StatusBadRequest, "HTTP proxy requests must use absolute URLs", false)
		s.finishSession(session, session.account, nil, "failed", "", errors.New("request URL is not absolute"))
		return errors.New("request URL is not absolute")
	}
	if req.URL.Scheme != "http" {
		s.writeHTTPError(client, http.StatusBadRequest, "use CONNECT for HTTPS targets", false)
		s.finishSession(session, session.account, nil, "failed", "", errors.New("unsupported HTTP forward scheme"))
		return errors.New("unsupported HTTP forward scheme")
	}
	targetAddr := net.JoinHostPort(session.targetHost, strconv.Itoa(session.targetPort))
	upstreamConn, proxyItem, policy, dnsPolicy, err := s.dialWithPolicy(context.Background(), &session, targetAddr)
	if err != nil {
		s.writeHTTPError(client, http.StatusBadGateway, "proxy gateway request failed", false)
		s.finishSession(session, session.account, proxyItem, "failed", "", err)
		return err
	}
	countedUpstream := &countingConn{Conn: upstreamConn}
	defer countedUpstream.Close()
	captureTraffic := func() {
		// countingConn names fields from the connection's perspective. Writes
		// travel from the gateway client toward the target (gateway bytes-in),
		// while reads return toward the client (gateway bytes-out).
		session.bytesIn = countedUpstream.bytesOut
		session.bytesOut = countedUpstream.bytesIn
	}

	outReq := req.Clone(req.Context())
	outReq.RequestURI = ""
	outReq.URL.Scheme = ""
	outReq.URL.Host = ""
	outReq.Header.Del("Proxy-Authorization")
	outReq.Header.Del("Proxy-Connection")
	outReq.Host = req.URL.Host
	if err := outReq.Write(countedUpstream); err != nil {
		captureTraffic()
		s.finishSessionWithPolicies(session, session.account, proxyItem, "failed", "", err, policy, dnsPolicy)
		return err
	}
	respReader := bufio.NewReader(countedUpstream)
	resp, err := http.ReadResponse(respReader, outReq)
	if err != nil {
		captureTraffic()
		s.finishSessionWithPolicies(session, session.account, proxyItem, "failed", "", err, policy, dnsPolicy)
		return err
	}
	defer resp.Body.Close()
	err = resp.Write(client)
	if err != nil {
		captureTraffic()
		s.finishSessionWithPolicies(session, session.account, proxyItem, "failed", "", err, policy, dnsPolicy)
		return err
	}
	captureTraffic()
	s.finishSessionWithPolicies(session, session.account, proxyItem, "success", "", nil, policy, dnsPolicy)
	return nil
}

func (s *ProxyGatewayService) writeHTTPError(conn net.Conn, status int, body string, auth bool) {
	resp := &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Proto:      "HTTP/1.1",
		ProtoMajor: 1,
		ProtoMinor: 1,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
	resp.Header.Set("Content-Type", "text/plain; charset=utf-8")
	if auth {
		resp.Header.Set("Proxy-Authenticate", `Basic realm="mailman-proxy-gateway"`)
	}
	_ = resp.Write(conn)
}

func (s *ProxyGatewayService) handleSocks5(conn net.Conn, reader *bufio.Reader, listener models.ProxyGatewayListener) {
	session := s.newSession(listener, conn.RemoteAddr(), "socks5", "CONNECT")
	auth, err := s.performSocks5Handshake(conn, reader, listener)
	account := auth.account
	if err != nil {
		s.finishSession(session, account, nil, "denied", "authentication failed", err)
		return
	}
	session.account = account
	s.applyAuthResultToSession(&session, auth)

	host, port, err := readSocks5ConnectRequest(reader)
	session.targetHost = host
	session.targetPort = port
	if err != nil {
		_ = writeSocks5Reply(conn, 0x01)
		s.finishSession(session, account, nil, "failed", "", err)
		return
	}
	if !s.enterAccount(account) {
		_ = writeSocks5Reply(conn, 0x02)
		s.finishSession(session, account, nil, "denied", "account limit exceeded", nil)
		return
	}
	defer s.leaveAccount(account)

	targetAddr := net.JoinHostPort(host, strconv.Itoa(port))
	upstreamConn, proxyItem, policy, dnsPolicy, err := s.dialWithPolicy(context.Background(), &session, targetAddr)
	if err != nil {
		err = annotateSocks5FakeIPError(host, err)
		replyCode := byte(0x05)
		if isLikelyDNSFakeIP(host) {
			replyCode = 0x04
		}
		_ = writeSocks5Reply(conn, replyCode)
		s.finishSession(session, session.account, proxyItem, "failed", "", err)
		return
	}
	defer upstreamConn.Close()

	if err := writeSocks5Reply(conn, 0x00); err != nil {
		s.finishSessionWithPolicies(session, session.account, proxyItem, "failed", "", err, policy, dnsPolicy)
		return
	}
	bytesIn, bytesOut := proxyPipe(conn, upstreamConn, session)
	session.bytesIn += bytesIn
	session.bytesOut += bytesOut
	s.finishSessionWithPolicies(session, session.account, proxyItem, "success", "", nil, policy, dnsPolicy)
}

func (s *ProxyGatewayService) performSocks5Handshake(conn net.Conn, reader *bufio.Reader, listener models.ProxyGatewayListener) (gatewayAuthResult, error) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil {
		return gatewayAuthResult{}, err
	}
	if header[0] != 0x05 {
		return gatewayAuthResult{}, errors.New("invalid SOCKS5 version")
	}
	methods := make([]byte, int(header[1]))
	if _, err := io.ReadFull(reader, methods); err != nil {
		return gatewayAuthResult{}, err
	}
	if listener.RequireAuth {
		if !byteSliceContains(methods, 0x02) {
			_, _ = conn.Write([]byte{0x05, 0xff})
			return gatewayAuthResult{}, errors.New("SOCKS5 username/password auth is required")
		}
		_, _ = conn.Write([]byte{0x05, 0x02})
		username, password, err := readSocks5UsernamePassword(reader)
		if err != nil {
			return gatewayAuthResult{}, err
		}
		auth, err := s.authenticateAccount(listener, username, password)
		if err != nil {
			_, _ = conn.Write([]byte{0x01, 0x01})
			return auth, err
		}
		_, _ = conn.Write([]byte{0x01, 0x00})
		return auth, nil
	}
	_, _ = conn.Write([]byte{0x05, 0x00})
	return gatewayAuthResult{account: s.anonymousAccount(listener), rawUsername: "anonymous"}, nil
}

func readSocks5UsernamePassword(reader *bufio.Reader) (string, string, error) {
	version, err := reader.ReadByte()
	if err != nil {
		return "", "", err
	}
	if version != 0x01 {
		return "", "", errors.New("invalid SOCKS5 auth version")
	}
	ulen, err := reader.ReadByte()
	if err != nil {
		return "", "", err
	}
	user := make([]byte, int(ulen))
	if _, err := io.ReadFull(reader, user); err != nil {
		return "", "", err
	}
	plen, err := reader.ReadByte()
	if err != nil {
		return "", "", err
	}
	pass := make([]byte, int(plen))
	if _, err := io.ReadFull(reader, pass); err != nil {
		return "", "", err
	}
	return string(user), string(pass), nil
}

func readSocks5ConnectRequest(reader *bufio.Reader) (string, int, error) {
	header := make([]byte, 4)
	if _, err := io.ReadFull(reader, header); err != nil {
		return "", 0, err
	}
	if header[0] != 0x05 {
		return "", 0, errors.New("invalid SOCKS5 request version")
	}
	if header[1] != 0x01 {
		return "", 0, errors.New("only SOCKS5 CONNECT is supported")
	}
	var host string
	switch header[3] {
	case 0x01:
		buf := make([]byte, 4)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return "", 0, err
		}
		host = net.IP(buf).String()
	case 0x03:
		l, err := reader.ReadByte()
		if err != nil {
			return "", 0, err
		}
		buf := make([]byte, int(l))
		if _, err := io.ReadFull(reader, buf); err != nil {
			return "", 0, err
		}
		host = string(buf)
	case 0x04:
		buf := make([]byte, 16)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return "", 0, err
		}
		host = net.IP(buf).String()
	default:
		return "", 0, errors.New("unsupported SOCKS5 address type")
	}
	portBytes := make([]byte, 2)
	if _, err := io.ReadFull(reader, portBytes); err != nil {
		return "", 0, err
	}
	port := int(portBytes[0])<<8 | int(portBytes[1])
	return host, port, nil
}

func writeSocks5Reply(conn net.Conn, code byte) error {
	_, err := conn.Write([]byte{0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
	return err
}

func isLikelyDNSFakeIP(host string) bool {
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip == nil {
		return false
	}
	ipv4 := ip.To4()
	return ipv4 != nil && ipv4[0] == 198 && (ipv4[1] == 18 || ipv4[1] == 19)
}

func annotateSocks5FakeIPError(host string, err error) error {
	if err == nil || !isLikelyDNSFakeIP(host) {
		return err
	}
	return fmt.Errorf("target %s is in reserved 198.18.0.0/15 and looks like a DNS Fake-IP; the gateway cannot recover the original domain from a locally resolved SOCKS5 request; use socks5h:// or disable Fake-IP DNS: %w", host, err)
}

func (s *ProxyGatewayService) authenticateHTTP(listener models.ProxyGatewayListener, req *http.Request) (gatewayAuthResult, error) {
	if !listener.RequireAuth {
		return gatewayAuthResult{account: s.anonymousAccount(listener), rawUsername: "anonymous"}, nil
	}
	header := req.Header.Get("Proxy-Authorization")
	if header == "" {
		return gatewayAuthResult{}, errors.New("missing Proxy-Authorization")
	}
	const prefix = "Basic "
	if !strings.HasPrefix(header, prefix) {
		return gatewayAuthResult{}, errors.New("unsupported proxy auth scheme")
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header[len(prefix):]))
	if err != nil {
		return gatewayAuthResult{}, err
	}
	parts := strings.SplitN(string(decoded), ":", 2)
	if len(parts) != 2 {
		return gatewayAuthResult{}, errors.New("invalid proxy credentials")
	}
	return s.authenticateAccount(listener, parts[0], parts[1])
}

func (s *ProxyGatewayService) authenticateAccount(listener models.ProxyGatewayListener, username, password string) (gatewayAuthResult, error) {
	orgID := listener.OrgID
	auth := gatewayAuthResult{rawUsername: username}
	account, err := s.repo.GetAccountByUsername(orgID, username)
	if err == nil {
		auth.account = account
		if err := validateProxyGatewayPassword(account, password); err != nil {
			return auth, err
		}
		if err := authorizeAccountGateway(account, listener); err != nil {
			return auth, err
		}
		return auth, nil
	}

	request, ok := parseGatewayUsernameRoute(username, listener.UsernameRouteSeparators)
	if !ok {
		return auth, err
	}
	account, err = s.repo.GetAccountByUsername(orgID, request.baseUsername)
	if err != nil {
		return auth, err
	}
	auth.account = account
	if err := validateProxyGatewayPassword(account, password); err != nil {
		return auth, err
	}
	if err := authorizeAccountGateway(account, listener); err != nil {
		return auth, err
	}
	auth.routeParams = request.params
	routingMode := models.EffectiveProxyGatewayUsernameRoutingMode(account.UsernameRoutingMode)
	useProxyIndex := request.kind == gatewayUsernameRouteProxyIndex ||
		(request.kind == gatewayUsernameRouteSuffix && routingMode == models.ProxyGatewayUsernameRoutingProxyIndex)
	if useProxyIndex {
		if !account.EnableUsernameRouting {
			return auth, errors.New("proxy account does not allow smart username routing")
		}
		if routingMode != models.ProxyGatewayUsernameRoutingProxyIndex {
			return auth, errors.New("proxy account does not allow pool proxy indexing")
		}
		auth.proxyIndex = request.flagNo
		return auth, nil
	}

	strategy, err := s.repo.GetRouteStrategyByFlagNo(orgID, listener.ID, request.flagNo)
	if err != nil {
		return auth, fmt.Errorf("route strategy flag %d is not available", request.flagNo)
	}
	if err := authorizeUsernameRouteStrategy(account, listener, strategy); err != nil {
		return auth, err
	}
	effectiveStrategy, override, err := s.resolveAccountRouteStrategy(listener, account, strategy)
	if err != nil {
		return auth, err
	}
	auth.account = applyRouteStrategyToAccount(account, effectiveStrategy)
	auth.routeStrategy = effectiveStrategy
	auth.routeStrategyOverride = override
	return auth, nil
}

func validateProxyGatewayPassword(account *models.ProxyGatewayAccount, password string) error {
	if !account.IsUsable(time.Now()) {
		return errors.New("proxy account is disabled or expired")
	}
	if !account.CheckPassword(password) {
		return errors.New("invalid proxy account password")
	}
	return nil
}

func authorizeAccountGateway(account *models.ProxyGatewayAccount, listener models.ProxyGatewayListener) error {
	if account == nil || account.ID == 0 || listener.ID == 0 {
		return nil
	}
	if account.AllowAllGateways || len(account.AllowedGatewayIDs) == 0 {
		return nil
	}
	for _, allowedID := range account.AllowedGatewayIDs {
		if allowedID == listener.ID {
			return nil
		}
	}
	return fmt.Errorf("proxy account is not allowed to use gateway %s", listener.Name)
}

type gatewayUsernameRouteRequest struct {
	baseUsername string
	flagNo       int
	kind         gatewayUsernameRouteKind
	params       models.JSONMapInterface
}

type gatewayUsernameRouteKind string

const (
	gatewayUsernameRouteSuffix     gatewayUsernameRouteKind = "suffix"
	gatewayUsernameRouteStrategy   gatewayUsernameRouteKind = "strategy"
	gatewayUsernameRouteProxyIndex gatewayUsernameRouteKind = "proxy_index"
)

func parseGatewayUsernameRoute(raw string, configuredSeparators []string) (gatewayUsernameRouteRequest, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return gatewayUsernameRouteRequest{}, false
	}
	if idx := strings.Index(raw, "?"); idx > 0 && idx < len(raw)-1 {
		values, err := url.ParseQuery(raw[idx+1:])
		if err == nil {
			flagText := firstNonEmpty(values.Get("route"), values.Get("router"), values.Get("rs"), values.Get("strategy"))
			kind := gatewayUsernameRouteStrategy
			if flagText == "" {
				flagText = firstNonEmpty(values.Get("index"), values.Get("proxy"), values.Get("pi"))
				kind = gatewayUsernameRouteProxyIndex
			}
			if flagText != "" {
				flagNo, err := strconv.Atoi(flagText)
				if err == nil && flagNo > 0 {
					params := models.JSONMapInterface{}
					for key, value := range values {
						if len(value) > 0 {
							params[key] = value[len(value)-1]
						}
					}
					return gatewayUsernameRouteRequest{baseUsername: raw[:idx], flagNo: flagNo, kind: kind, params: params}, true
				}
			}
		}
	}

	separators := append([]string(nil), models.EffectiveProxyGatewayUsernameRouteSeparators(configuredSeparators)...)
	sort.SliceStable(separators, func(i, j int) bool { return len(separators[i]) > len(separators[j]) })
	for _, separator := range separators {
		idx := strings.LastIndex(raw, separator)
		if idx <= 0 || idx >= len(raw)-1 {
			continue
		}
		flagAndParams := raw[idx+len(separator):]
		flagText := flagAndParams
		params := models.JSONMapInterface{}
		if paramIdx := strings.IndexAny(flagAndParams, ";&,"); paramIdx >= 0 {
			flagText = flagAndParams[:paramIdx]
			params = parseUsernameRouteParams(flagAndParams[paramIdx+1:])
		}
		flagNo, err := strconv.Atoi(flagText)
		if err == nil && flagNo > 0 {
			return gatewayUsernameRouteRequest{baseUsername: raw[:idx], flagNo: flagNo, kind: gatewayUsernameRouteSuffix, params: params}, true
		}
	}
	return gatewayUsernameRouteRequest{}, false
}

func parseUsernameRouteParams(raw string) models.JSONMapInterface {
	params := models.JSONMapInterface{}
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ';' || r == '&' || r == ',' }) {
		key, value, ok := strings.Cut(part, "=")
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if ok {
			params[key] = strings.TrimSpace(value)
		} else {
			params[key] = true
		}
	}
	return params
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func authorizeUsernameRouteStrategy(account *models.ProxyGatewayAccount, listener models.ProxyGatewayListener, strategy *models.ProxyGatewayRouteStrategy) error {
	if account == nil || strategy == nil {
		return errors.New("missing route strategy permission context")
	}
	if strategy.GatewayID != 0 && strategy.GatewayID != listener.ID {
		return fmt.Errorf("route strategy flag %d does not belong to gateway %s", strategy.FlagNo, listener.Name)
	}
	if !account.EnableUsernameRouting {
		return errors.New("proxy account does not allow smart username routing")
	}
	if account.AllowAllRouteStrategies {
		return nil
	}
	for _, allowedID := range account.AllowedRouteStrategyIDs {
		if allowedID == strategy.ID {
			return nil
		}
	}
	return fmt.Errorf("proxy account is not allowed to use route strategy flag %d", strategy.FlagNo)
}

func applyRouteStrategyToAccount(account *models.ProxyGatewayAccount, strategy *models.ProxyGatewayRouteStrategy) *models.ProxyGatewayAccount {
	if account == nil || strategy == nil {
		return account
	}
	next := *account
	next.SelectionMode = strategy.SelectionMode
	next.ProxyIDs = strategy.ProxyIDs
	next.ProxyMatchGroupIDs = strategy.ProxyMatchGroupIDs
	next.ProxyMatchTagIDs = strategy.ProxyMatchTagIDs
	next.ProxyMatchTagMode = strategy.ProxyMatchTagMode
	next.SelectionAlgorithm = strategy.SelectionAlgorithm
	next.ProxyIndexOverflowMode = strategy.ProxyIndexOverflowMode
	next.StickyMode = strategy.StickyMode
	next.StickyTTLSeconds = strategy.StickyTTLSeconds
	next.PreferLastSuccess = strategy.PreferLastSuccess
	next.FallbackMode = strategy.FallbackMode
	next.FallbackProxyIDs = strategy.FallbackProxyIDs
	next.FallbackGroupIDs = strategy.FallbackGroupIDs
	next.FallbackTagIDs = strategy.FallbackTagIDs
	next.FallbackTagMode = strategy.FallbackTagMode
	next.MaxRetries = strategy.MaxRetries
	next.AllowDirectFallback = strategy.AllowDirectFallback
	if strategy.SecurityPolicyID != nil {
		next.SecurityPolicyID = strategy.SecurityPolicyID
		next.SecurityPolicy = strategy.SecurityPolicy
	}
	if strategy.DNSPolicyID != nil {
		next.DNSPolicyID = strategy.DNSPolicyID
		next.DNSPolicy = strategy.DNSPolicy
	}
	return &next
}

// resolveAccountRouteStrategy applies a one-level account-specific egress
// override while retaining the gateway-owned target-route topology. Overrides
// are intentionally ignored for legacy account-managed proxy selection.
func (s *ProxyGatewayService) resolveAccountRouteStrategy(listener models.ProxyGatewayListener, account *models.ProxyGatewayAccount, source *models.ProxyGatewayRouteStrategy) (*models.ProxyGatewayRouteStrategy, *models.ProxyGatewayAccountRouteStrategyOverride, error) {
	if source == nil || account == nil || account.ProxySelectionSource != models.ProxyGatewaySelectionSourceGateway {
		return source, nil, nil
	}
	for index := range account.RouteStrategyOverrides {
		override := &account.RouteStrategyOverrides[index]
		if override.GatewayID != listener.ID || override.SourceRouteStrategyID != source.ID {
			continue
		}
		replacement := override.ReplacementRouteStrategy
		if replacement == nil || replacement.ID != override.ReplacementRouteStrategyID {
			item, err := s.repo.GetRouteStrategy(listener.OrgID, override.ReplacementRouteStrategyID)
			if err != nil {
				return nil, override, fmt.Errorf("route strategy override for %s references unavailable replacement strategy %d: %w", source.Name, override.ReplacementRouteStrategyID, err)
			}
			replacement = item
		}
		if replacement.OrgID != listener.OrgID {
			return nil, override, fmt.Errorf("route strategy override for %s references a replacement strategy from another organization", source.Name)
		}
		if !replacement.Enabled {
			return nil, override, fmt.Errorf("route strategy override for %s references disabled replacement strategy %s", source.Name, replacement.Name)
		}
		if replacement.GatewayID != 0 && replacement.GatewayID != listener.ID {
			return nil, override, fmt.Errorf("route strategy override for %s references a replacement strategy from another gateway", source.Name)
		}
		return replacement, override, nil
	}
	return source, nil, nil
}

func applySessionRouteStrategyOverride(session *gatewaySession, override *models.ProxyGatewayAccountRouteStrategyOverride) {
	if session == nil {
		return
	}
	session.routeStrategyOverrideSourceID = nil
	session.routeStrategyOverrideReplacementID = nil
	if override == nil {
		return
	}
	sourceID := override.SourceRouteStrategyID
	replacementID := override.ReplacementRouteStrategyID
	session.routeStrategyOverrideSourceID = &sourceID
	session.routeStrategyOverrideReplacementID = &replacementID
}

func (s *ProxyGatewayService) applyAuthResultToSession(session *gatewaySession, auth gatewayAuthResult) {
	session.rawUsername = auth.rawUsername
	if auth.routeStrategy != nil {
		id := auth.routeStrategy.ID
		session.routeStrategyID = &id
		session.routeStrategyFlagNo = auth.routeStrategy.FlagNo
	}
	applySessionRouteStrategyOverride(session, auth.routeStrategyOverride)
	if auth.proxyIndex > 0 {
		session.proxyIndex = auth.proxyIndex
	}
	if auth.routeParams != nil {
		session.routeParams = auth.routeParams
	}
}

func (s *ProxyGatewayService) anonymousAccount(listener models.ProxyGatewayListener) *models.ProxyGatewayAccount {
	return &models.ProxyGatewayAccount{
		OrgID:                 listener.OrgID,
		Username:              "anonymous",
		Enabled:               true,
		SelectionMode:         models.ProxyGatewaySelectionFiltered,
		SelectionAlgorithm:    models.ProxyGatewayAlgorithmRandom,
		ProxyMatchTagMode:     models.ProxyTagFilterOR,
		FallbackMode:          models.ProxyGatewayFallbackInterrupt,
		MaxRetries:            2,
		ConnectTimeoutSeconds: nonZero(listener.ConnectTimeoutSeconds, 30),
		IdleTimeoutSeconds:    nonZero(listener.IdleTimeoutSeconds, 120),
	}
}

func (s *ProxyGatewayService) targetRoutesForListener(listener models.ProxyGatewayListener) ([]models.ProxyGatewayTargetRoute, error) {
	s.mu.RLock()
	routes, ok := s.targetRoutes[listener.ID]
	if ok {
		routes = append([]models.ProxyGatewayTargetRoute(nil), routes...)
	}
	s.mu.RUnlock()
	if ok {
		return routes, nil
	}
	if err := s.RefreshTargetRoutes(listener.OrgID, listener.ID); err != nil {
		return nil, err
	}
	s.mu.RLock()
	routes = append([]models.ProxyGatewayTargetRoute(nil), s.targetRoutes[listener.ID]...)
	s.mu.RUnlock()
	return routes, nil
}

func (s *ProxyGatewayService) applyTargetRoute(session *gatewaySession) error {
	routes, err := s.targetRoutesForListener(session.listener)
	if err != nil {
		return fmt.Errorf("load target route table: %w", err)
	}
	defaultIndex := -1
	for i := range routes {
		route := &routes[i]
		if route.IsDefault {
			if defaultIndex == -1 {
				defaultIndex = i
			}
			continue
		}
		for _, matcher := range route.Matchers {
			if models.ProxyGatewayTargetMatches(session.targetHost, matcher) {
				return s.applyTargetRouteStrategy(session, route, matcher)
			}
		}
	}
	if defaultIndex >= 0 {
		return s.applyTargetRouteStrategy(session, &routes[defaultIndex], "")
	}
	if session.account != nil &&
		session.account.ProxySelectionSource == models.ProxyGatewaySelectionSourceGateway &&
		session.routeStrategyID == nil {
		return errors.New("gateway-managed proxy selection requires a matching target route, a default target route, or an explicit username route strategy")
	}
	return nil
}

func (s *ProxyGatewayService) applyTargetRouteStrategy(session *gatewaySession, route *models.ProxyGatewayTargetRoute, matcher string) error {
	if route == nil {
		return nil
	}
	id := route.ID
	session.targetRouteID = &id
	session.targetRouteMatcher = matcher
	session.targetRouteDefault = route.IsDefault
	routeCopy := *route
	session.targetRoute = &routeCopy
	strategy := route.RouteStrategy
	if strategy == nil || strategy.ID == 0 {
		return fmt.Errorf("target route %s references an unavailable route strategy", route.Name)
	}
	if !strategy.Enabled {
		return fmt.Errorf("target route %s references disabled route strategy %s", route.Name, strategy.Name)
	}
	if strategy.GatewayID != 0 && strategy.GatewayID != session.listener.ID {
		return fmt.Errorf("target route %s references a strategy from another gateway", route.Name)
	}
	effectiveStrategy, primaryOverride, err := s.resolveAccountRouteStrategy(session.listener, session.account, strategy)
	if err != nil {
		return err
	}
	strategyID := effectiveStrategy.ID
	session.routeStrategyID = &strategyID
	session.primaryStrategyID = &strategyID
	session.primaryRouteStrategy = effectiveStrategy
	session.primaryStrategyOverride = primaryOverride
	session.routeStrategyFlagNo = effectiveStrategy.FlagNo
	applySessionRouteStrategyOverride(session, primaryOverride)
	if route.FailoverEnabled && route.FallbackRouteStrategy != nil {
		fallbackSource := route.FallbackRouteStrategy
		if !fallbackSource.Enabled {
			return fmt.Errorf("target route %s references disabled fallback route strategy %s", route.Name, fallbackSource.Name)
		}
		if fallbackSource.GatewayID != 0 && fallbackSource.GatewayID != session.listener.ID {
			return fmt.Errorf("target route %s references a fallback strategy from another gateway", route.Name)
		}
		fallbackStrategy, fallbackOverride, err := s.resolveAccountRouteStrategy(session.listener, session.account, fallbackSource)
		if err != nil {
			return err
		}
		fallbackID := fallbackStrategy.ID
		session.fallbackStrategyID = &fallbackID
		session.fallbackRouteStrategy = fallbackStrategy
		session.fallbackStrategyOverride = fallbackOverride
	}
	session.account = applyRouteStrategyToAccount(session.account, effectiveStrategy)
	return nil
}

func (s *ProxyGatewayService) dialWithPolicy(ctx context.Context, session *gatewaySession, targetAddr string) (net.Conn, *models.ProxyPoolItem, *models.ProxyGatewaySecurityPolicy, *models.ProxyGatewayDNSPolicy, error) {
	if session == nil {
		return nil, nil, nil, nil, errors.New("missing proxy gateway session")
	}
	targetHost, targetPort, err := splitHostPortWithDefault(targetAddr, 80)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	session.targetHost = targetHost
	session.targetPort = targetPort
	baseAccount := session.account
	if err := s.applyTargetRoute(session); err != nil {
		return nil, nil, nil, nil, err
	}
	route := session.targetRoute
	if route == nil || !route.FailoverEnabled {
		return s.dialWithAccountPolicy(ctx, session, session.account, targetHost, targetPort, true)
	}
	if session.fallbackRouteStrategy == nil || session.fallbackRouteStrategy.ID == 0 {
		return nil, nil, nil, nil, fmt.Errorf("target route %s references an unavailable fallback route strategy", route.Name)
	}

	fallbackStrategy := session.fallbackRouteStrategy
	fallbackAccount := applyRouteStrategyToAccount(baseAccount, fallbackStrategy)
	circuitKey := routeCircuitKey(*session, *route, session.primaryRouteStrategy, fallbackStrategy)
	decision := s.routeCircuitDecision(circuitKey, *route)
	session.routeCircuitState = decision.State
	session.routeCircuitCacheHit = decision.CacheHit
	session.routeCircuitProbe = decision.Probe

	var primaryErr error
	if !decision.SkipPrimary {
		conn, proxyItem, securityPolicy, dnsPolicy, err := s.dialWithAccountPolicy(ctx, session, session.account, targetHost, targetPort, false)
		if err == nil {
			s.clearRouteCircuit(circuitKey)
			session.routeCircuitState = "closed"
			return conn, proxyItem, securityPolicy, dnsPolicy, nil
		}
		var authorizationErr *routeAuthorizationError
		if errors.As(err, &authorizationErr) {
			s.releaseRouteCircuitProbe(circuitKey, *route, decision.Probe, decision.Generation)
			if decision.Probe {
				session.routeCircuitState = s.currentRouteCircuitState(circuitKey)
			}
			return nil, nil, securityPolicy, dnsPolicy, err
		}
		primaryErr = err
		session.routeFailoverReason = err.Error()
	} else {
		primaryErr = errors.New("primary route strategy bypassed by open circuit")
		session.routeFailoverReason = primaryErr.Error()
	}

	session.routeFailoverUsed = true
	fallbackID := fallbackStrategy.ID
	session.routeStrategyID = &fallbackID
	session.routeStrategyFlagNo = fallbackStrategy.FlagNo
	applySessionRouteStrategyOverride(session, session.fallbackStrategyOverride)
	session.account = fallbackAccount
	session.resolvedProxyIndex = 0
	session.proxyPoolSize = 0
	conn, proxyItem, securityPolicy, dnsPolicy, fallbackErr := s.dialWithAccountPolicy(ctx, session, fallbackAccount, targetHost, targetPort, false)
	if fallbackErr == nil {
		if !decision.SkipPrimary {
			s.recordRoutePrimaryFailure(circuitKey, *route, decision.Probe, decision.Generation)
			session.routeCircuitState = s.currentRouteCircuitState(circuitKey)
		}
		return conn, proxyItem, securityPolicy, dnsPolicy, nil
	}
	if decision.Probe {
		s.releaseRouteCircuitProbe(circuitKey, *route, true, decision.Generation)
		session.routeCircuitState = s.currentRouteCircuitState(circuitKey)
	}
	directAccount := (*models.ProxyGatewayAccount)(nil)
	directStrategy := (*models.ProxyGatewayRouteStrategy)(nil)
	var fallbackIndexErr *proxyIndexSelectionError
	if errors.As(fallbackErr, &fallbackIndexErr) {
		return nil, nil, securityPolicy, dnsPolicy, fmt.Errorf("primary route strategy failed: %v; fallback route strategy failed: %w", primaryErr, fallbackErr)
	}
	if fallbackAccount.FallbackMode == models.ProxyGatewayFallbackDirect && fallbackAccount.AllowDirectFallback {
		directAccount = fallbackAccount
		directStrategy = fallbackStrategy
	} else if session.primaryStrategyID != nil && session.primaryRouteStrategy != nil && session.account != nil {
		primaryAccount := applyRouteStrategyToAccount(baseAccount, session.primaryRouteStrategy)
		if primaryAccount.FallbackMode == models.ProxyGatewayFallbackDirect && primaryAccount.AllowDirectFallback {
			directAccount = primaryAccount
			directStrategy = session.primaryRouteStrategy
		}
	}
	if directAccount != nil && directStrategy != nil {
		directID := directStrategy.ID
		session.routeStrategyID = &directID
		session.routeStrategyFlagNo = directStrategy.FlagNo
		session.account = directAccount
		if directStrategy.ID == fallbackStrategy.ID {
			applySessionRouteStrategyOverride(session, session.fallbackStrategyOverride)
		} else {
			applySessionRouteStrategyOverride(session, session.primaryStrategyOverride)
		}
		directConn, directSecurity, directDNS, directErr := s.dialDirectWithAccountPolicy(ctx, session, directAccount, targetHost, targetPort)
		if directErr == nil {
			return directConn, nil, directSecurity, directDNS, nil
		}
		fallbackErr = fmt.Errorf("%v; final direct fallback failed: %w", fallbackErr, directErr)
	}
	return nil, nil, securityPolicy, dnsPolicy, fmt.Errorf("primary route strategy failed: %v; fallback route strategy failed: %w", primaryErr, fallbackErr)
}

type routeAuthorizationError struct {
	err error
}

func (e *routeAuthorizationError) Error() string { return e.err.Error() }
func (e *routeAuthorizationError) Unwrap() error { return e.err }

func (s *ProxyGatewayService) dialWithAccountPolicy(ctx context.Context, session *gatewaySession, account *models.ProxyGatewayAccount, targetHost string, targetPort int, allowDirect bool) (net.Conn, *models.ProxyPoolItem, *models.ProxyGatewaySecurityPolicy, *models.ProxyGatewayDNSPolicy, error) {
	securityPolicy, dnsPolicy, err := s.effectivePolicies(session.listener, account)
	if err != nil {
		return nil, nil, nil, nil, &routeAuthorizationError{err: err}
	}
	if err := s.authorizeTarget(ctx, *securityPolicy, *dnsPolicy, session.clientIP, targetHost, targetPort); err != nil {
		return nil, nil, securityPolicy, dnsPolicy, &routeAuthorizationError{err: err}
	}

	targetForDial, httpConnectHostHeader, err := s.targetForDNSMode(ctx, *dnsPolicy, *session, targetHost, targetPort)
	if err != nil {
		return nil, nil, securityPolicy, dnsPolicy, err
	}

	exclude := []uint{}
	var lastErr error
	connectTimeout := nonZero(session.listener.ConnectTimeoutSeconds, 30)
	if account != nil && account.ConnectTimeoutSeconds > 0 {
		connectTimeout = account.ConnectTimeoutSeconds
	}
	attemptPool := func(fallback bool, attempts int) (net.Conn, *models.ProxyPoolItem, bool) {
		for i := 0; i < attempts; i++ {
			proxyItem, direct, err := s.selectProxy(account, session, exclude, fallback)
			if err != nil {
				lastErr = err
				return nil, nil, false
			}
			conn, err := s.dialTarget(ctx, targetForDial, httpConnectHostHeader, proxyItem, direct, connectTimeout)
			if err == nil {
				if proxyItem != nil {
					s.rememberProxySuccess(account, *session, proxyItem.ID)
				}
				return conn, proxyItem, true
			}
			lastErr = err
			if proxyItem != nil {
				s.forgetStickySelection(account, *session, proxyItem.ID)
				exclude = append(exclude, proxyItem.ID)
			}
		}
		return nil, nil, false
	}

	mainAttempts := 1
	if account.FallbackMode == models.ProxyGatewayFallbackRetry && account.MaxRetries > 0 {
		mainAttempts += account.MaxRetries
	}
	if conn, proxyItem, ok := attemptPool(false, mainAttempts); ok {
		return conn, proxyItem, securityPolicy, dnsPolicy, nil
	}
	var indexErr *proxyIndexSelectionError
	if errors.As(lastErr, &indexErr) {
		return nil, nil, securityPolicy, dnsPolicy, lastErr
	}

	if account.FallbackMode == models.ProxyGatewayFallbackBackup && account.MaxRetries > 0 {
		if conn, proxyItem, ok := attemptPool(true, account.MaxRetries); ok {
			return conn, proxyItem, securityPolicy, dnsPolicy, nil
		}
	}

	if allowDirect && account.FallbackMode == models.ProxyGatewayFallbackDirect && account.AllowDirectFallback {
		conn, err := s.dialTarget(ctx, targetForDial, httpConnectHostHeader, nil, true, connectTimeout)
		if err == nil {
			return conn, nil, securityPolicy, dnsPolicy, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("proxy gateway did not find a usable upstream proxy")
	}
	return nil, nil, securityPolicy, dnsPolicy, lastErr
}

func (s *ProxyGatewayService) dialDirectWithAccountPolicy(ctx context.Context, session *gatewaySession, account *models.ProxyGatewayAccount, targetHost string, targetPort int) (net.Conn, *models.ProxyGatewaySecurityPolicy, *models.ProxyGatewayDNSPolicy, error) {
	securityPolicy, dnsPolicy, err := s.effectivePolicies(session.listener, account)
	if err != nil {
		return nil, nil, nil, &routeAuthorizationError{err: err}
	}
	if err := s.authorizeTarget(ctx, *securityPolicy, *dnsPolicy, session.clientIP, targetHost, targetPort); err != nil {
		return nil, securityPolicy, dnsPolicy, &routeAuthorizationError{err: err}
	}
	targetForDial, httpConnectHostHeader, err := s.targetForDNSMode(ctx, *dnsPolicy, *session, targetHost, targetPort)
	if err != nil {
		return nil, securityPolicy, dnsPolicy, err
	}
	connectTimeout := nonZero(session.listener.ConnectTimeoutSeconds, 30)
	if account != nil && account.ConnectTimeoutSeconds > 0 {
		connectTimeout = account.ConnectTimeoutSeconds
	}
	conn, err := s.dialTarget(ctx, targetForDial, httpConnectHostHeader, nil, true, connectTimeout)
	return conn, securityPolicy, dnsPolicy, err
}

func routeCircuitKey(session gatewaySession, route models.ProxyGatewayTargetRoute, primaryStrategy, fallbackStrategy *models.ProxyGatewayRouteStrategy) string {
	indexScope := "pool"
	if session.proxyIndex > 0 {
		indexScope = fmt.Sprintf("index:%d", session.proxyIndex)
	}
	host := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(session.targetHost), "."))
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		host = ip.String()
	}
	var accountSecurity *models.ProxyGatewaySecurityPolicy
	var accountDNS *models.ProxyGatewayDNSPolicy
	accountConnectTimeout := 0
	if session.account != nil {
		accountSecurity = session.account.SecurityPolicy
		accountDNS = session.account.DNSPolicy
		accountConnectTimeout = session.account.ConnectTimeoutSeconds
	}
	return fmt.Sprintf(
		"%d:%d:%d:%d:%d:%s:%s:%s:%s:%d:%d:%s:%s:%d:%s",
		session.listener.OrgID,
		session.listener.ID,
		route.ID,
		route.RouteStrategyID,
		route.UpdatedAt.UnixNano(),
		routeStrategyCircuitVersion(primaryStrategy),
		routeStrategyCircuitVersion(fallbackStrategy),
		policyCircuitVersion(session.listener.SecurityPolicy, session.listener.DNSPolicy),
		policyCircuitVersion(accountSecurity, accountDNS),
		session.listener.ConnectTimeoutSeconds,
		accountConnectTimeout,
		session.protocol,
		host,
		session.targetPort,
		indexScope,
	)
}

func routeStrategyCircuitVersion(strategy *models.ProxyGatewayRouteStrategy) string {
	if strategy == nil {
		return "0"
	}
	return fmt.Sprintf("%d.%d.%s", strategy.ID, strategy.UpdatedAt.UnixNano(), policyCircuitVersion(strategy.SecurityPolicy, strategy.DNSPolicy))
}

func policyCircuitVersion(security *models.ProxyGatewaySecurityPolicy, dns *models.ProxyGatewayDNSPolicy) string {
	securityVersion := int64(0)
	dnsVersion := int64(0)
	if security != nil {
		securityVersion = security.UpdatedAt.UnixNano()
	}
	if dns != nil {
		dnsVersion = dns.UpdatedAt.UnixNano()
	}
	return fmt.Sprintf("%d.%d", securityVersion, dnsVersion)
}

func (s *ProxyGatewayService) routeCircuitDecision(key string, route models.ProxyGatewayTargetRoute) routeCircuitDecision {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneRouteCircuitsLocked(now)
	entry, ok := s.routeCircuits[key]
	if !ok || entry.OpenUntil.IsZero() {
		if ok {
			entry.LastSeen = now
			s.routeCircuits[key] = entry
		}
		return routeCircuitDecision{State: "closed", Generation: entry.Generation}
	}
	entry.LastSeen = now
	if entry.OpenUntil.After(now) {
		s.routeCircuits[key] = entry
		return routeCircuitDecision{SkipPrimary: true, State: "open", CacheHit: true, Generation: entry.Generation}
	}
	maxProbes := nonZero(route.CircuitHalfOpenProbes, 1)
	if entry.ActiveProbes >= maxProbes {
		s.routeCircuits[key] = entry
		return routeCircuitDecision{SkipPrimary: true, State: "half_open", CacheHit: true, Generation: entry.Generation}
	}
	entry.ActiveProbes++
	s.routeCircuits[key] = entry
	return routeCircuitDecision{Probe: true, State: "half_open", Generation: entry.Generation}
}

func (s *ProxyGatewayService) clearRouteCircuit(key string) {
	now := s.now()
	s.mu.Lock()
	if entry, ok := s.routeCircuits[key]; ok {
		entry.Generation++
		entry.FailureCount = 0
		entry.WindowStart = time.Time{}
		entry.BackoffLevel = 0
		entry.OpenUntil = time.Time{}
		entry.ActiveProbes = 0
		entry.LastSeen = now
		s.routeCircuits[key] = entry
	}
	s.mu.Unlock()
}

func (s *ProxyGatewayService) currentRouteCircuitState(key string) string {
	s.mu.RLock()
	entry, ok := s.routeCircuits[key]
	s.mu.RUnlock()
	if ok && !entry.OpenUntil.IsZero() {
		return "open"
	}
	return "closed"
}

func (s *ProxyGatewayService) recordRoutePrimaryFailure(key string, route models.ProxyGatewayTargetRoute, probe bool, expectedGeneration uint64) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, exists := s.routeCircuits[key]
	if exists && entry.Generation != expectedGeneration {
		return
	}
	if !exists && expectedGeneration != 0 {
		return
	}
	entry.GatewayID = route.GatewayID
	entry.LastSeen = now
	s.pruneRouteCircuitsLocked(now)
	if !exists && len(s.routeCircuits) >= routeCircuitMaxEntries {
		return
	}
	if probe {
		if entry.ActiveProbes > 0 {
			entry.ActiveProbes--
		}
		entry.Generation++
		entry.BackoffLevel++
		entry.OpenUntil = now.Add(s.routeCircuitDurationLocked(route, entry.BackoffLevel))
		entry.FailureCount = 0
		entry.WindowStart = time.Time{}
		s.routeCircuits[key] = entry
		return
	}
	window := time.Duration(nonZero(route.FailureWindowSeconds, 30)) * time.Second
	if entry.WindowStart.IsZero() || now.Sub(entry.WindowStart) > window {
		entry.WindowStart = now
		entry.FailureCount = 0
	}
	entry.FailureCount++
	if entry.FailureCount >= nonZero(route.FailureThreshold, 2) {
		entry.Generation++
		entry.BackoffLevel = 0
		entry.OpenUntil = now.Add(s.routeCircuitDurationLocked(route, 0))
		entry.FailureCount = 0
		entry.WindowStart = time.Time{}
	}
	s.routeCircuits[key] = entry
}

func (s *ProxyGatewayService) releaseRouteCircuitProbe(key string, route models.ProxyGatewayTargetRoute, probe bool, expectedGeneration uint64) {
	if !probe {
		return
	}
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.routeCircuits[key]
	if !ok || entry.Generation != expectedGeneration {
		return
	}
	if entry.ActiveProbes > 0 {
		entry.ActiveProbes--
	}
	entry.LastSeen = now
	entry.Generation++
	// Both exits failing is not evidence that the primary is uniquely bad. Keep
	// the current backoff level, but avoid a probe stampede while the target is
	// generally unavailable.
	entry.OpenUntil = now.Add(s.routeCircuitDurationLocked(route, entry.BackoffLevel))
	s.routeCircuits[key] = entry
}

func (s *ProxyGatewayService) pruneRouteCircuitsLocked(now time.Time) {
	if len(s.routeCircuits) < routeCircuitMaxEntries {
		return
	}
	staleBefore := now.Add(-24 * time.Hour)
	for key, entry := range s.routeCircuits {
		if entry.ActiveProbes == 0 && !entry.LastSeen.IsZero() && entry.LastSeen.Before(staleBefore) {
			delete(s.routeCircuits, key)
		}
	}
	if len(s.routeCircuits) < routeCircuitMaxEntries {
		return
	}
	type circuitAge struct {
		key      string
		lastSeen time.Time
	}
	ages := make([]circuitAge, 0, len(s.routeCircuits))
	for key, entry := range s.routeCircuits {
		if entry.ActiveProbes == 0 {
			ages = append(ages, circuitAge{key: key, lastSeen: entry.LastSeen})
		}
	}
	sort.Slice(ages, func(i, j int) bool { return ages[i].lastSeen.Before(ages[j].lastSeen) })
	for _, age := range ages {
		if len(s.routeCircuits) <= routeCircuitPruneEntries {
			break
		}
		delete(s.routeCircuits, age.key)
	}
}

func (s *ProxyGatewayService) routeCircuitDurationLocked(route models.ProxyGatewayTargetRoute, level int) time.Duration {
	base := int64(nonZero(route.CircuitBaseSeconds, 60))
	maximum := int64(nonZero(route.CircuitMaxSeconds, 300))
	multiplier := int64(nonZero(route.CircuitBackoffMultiplier, 2))
	seconds := base
	for i := 0; i < level && seconds < maximum; i++ {
		if multiplier > 1 && seconds > maximum/multiplier {
			seconds = maximum
			break
		}
		seconds *= multiplier
	}
	if seconds > maximum {
		seconds = maximum
	}
	jitterPercent := route.CircuitJitterPercent
	if jitterPercent > 0 && seconds > 0 {
		span := seconds * int64(jitterPercent) / 100
		if span > 0 {
			seconds += s.rand.Int63n(span*2+1) - span
		}
	}
	if seconds > maximum {
		seconds = maximum
	}
	if seconds < 1 {
		seconds = 1
	}
	return time.Duration(seconds) * time.Second
}

func (s *ProxyGatewayService) effectivePolicies(listener models.ProxyGatewayListener, account *models.ProxyGatewayAccount) (*models.ProxyGatewaySecurityPolicy, *models.ProxyGatewayDNSPolicy, error) {
	var security *models.ProxyGatewaySecurityPolicy
	var dns *models.ProxyGatewayDNSPolicy
	if account != nil && account.SecurityPolicyID != nil && account.SecurityPolicy != nil {
		security = account.SecurityPolicy
	} else if account != nil && account.SecurityPolicyID != nil {
		item, err := s.repo.GetSecurityPolicy(listener.OrgID, *account.SecurityPolicyID)
		if err != nil {
			return nil, nil, fmt.Errorf("proxy gateway account security policy %d is unavailable: %w", *account.SecurityPolicyID, err)
		}
		security = item
	}
	if security == nil && listener.SecurityPolicyID != nil && listener.SecurityPolicy != nil {
		security = listener.SecurityPolicy
	} else if security == nil && listener.SecurityPolicyID != nil {
		item, err := s.repo.GetSecurityPolicy(listener.OrgID, *listener.SecurityPolicyID)
		if err != nil {
			return nil, nil, fmt.Errorf("proxy gateway listener security policy %d is unavailable: %w", *listener.SecurityPolicyID, err)
		}
		security = item
	}
	if security == nil {
		item, err := s.repo.GetDefaultSecurityPolicy(listener.OrgID, listener.ID)
		if err != nil {
			return nil, nil, err
		}
		security = item
	}

	if account != nil && account.DNSPolicyID != nil && account.DNSPolicy != nil {
		dns = account.DNSPolicy
	} else if account != nil && account.DNSPolicyID != nil {
		item, err := s.repo.GetDNSPolicy(listener.OrgID, *account.DNSPolicyID)
		if err != nil {
			return nil, nil, fmt.Errorf("proxy gateway account DNS policy %d is unavailable: %w", *account.DNSPolicyID, err)
		}
		dns = item
	}
	if dns == nil && listener.DNSPolicyID != nil && listener.DNSPolicy != nil {
		dns = listener.DNSPolicy
	} else if dns == nil && listener.DNSPolicyID != nil {
		item, err := s.repo.GetDNSPolicy(listener.OrgID, *listener.DNSPolicyID)
		if err != nil {
			return nil, nil, fmt.Errorf("proxy gateway listener DNS policy %d is unavailable: %w", *listener.DNSPolicyID, err)
		}
		dns = item
	}
	if dns == nil {
		item, err := s.repo.GetDefaultDNSPolicy(listener.OrgID, listener.ID)
		if err != nil {
			return nil, nil, err
		}
		dns = item
	}
	return security, dns, nil
}

func (s *ProxyGatewayService) authorizeTarget(ctx context.Context, policy models.ProxyGatewaySecurityPolicy, dnsPolicy models.ProxyGatewayDNSPolicy, clientIP, host string, port int) error {
	if err := checkSourceIP(clientIP, policy); err != nil {
		return err
	}
	if err := checkHostPolicy(host, policy); err != nil {
		return err
	}
	if err := checkPortPolicy(port, policy); err != nil {
		return err
	}

	ip := net.ParseIP(strings.Trim(host, "[]"))
	ips := []net.IP{}
	if ip != nil {
		ips = append(ips, ip)
	} else if policy.DNSRebindingProtection || dnsPolicy.PreResolveForSecurity || dnsPolicy.Mode == models.ProxyGatewayDNSLocal || dnsPolicy.Mode == models.ProxyGatewayDNSCustom {
		resolved, err := s.resolveHost(ctx, dnsPolicy, host)
		if err != nil {
			if !policy.DNSRebindingProtection && dnsPolicy.ResolveFailureAction == models.ProxyGatewayResolveFailureUseRemoteProxy {
				return nil
			}
			return err
		}
		if len(resolved) == 0 {
			return fmt.Errorf("DNS lookup returned no IPs for %s", host)
		}
		ips = resolved
	}
	if len(ips) == 0 {
		return nil
	}
	if dnsPolicy.MultiIPStrategy == models.ProxyGatewayMultiIPFirstOnly {
		ips = ips[:1]
	}
	for _, candidate := range ips {
		if err := checkBlockedIP(candidate, policy); err != nil {
			if dnsPolicy.MultiIPStrategy == models.ProxyGatewayMultiIPRejectAny || dnsPolicy.MultiIPStrategy == models.ProxyGatewayMultiIPCheckAll || len(ips) == 1 {
				return err
			}
		}
	}
	return nil
}

func (s *ProxyGatewayService) targetForDNSMode(ctx context.Context, policy models.ProxyGatewayDNSPolicy, session gatewaySession, host string, port int) (string, string, error) {
	originalTarget := net.JoinHostPort(host, strconv.Itoa(port))
	targetAddr := originalTarget
	resolveForDial := policy.Mode == models.ProxyGatewayDNSLocal || policy.Mode == models.ProxyGatewayDNSCustom
	if session.protocol == "socks5" && policy.Mode == models.ProxyGatewayDNSRemote && !policy.Socks5RemoteResolve {
		resolveForDial = true
	}
	if resolveForDial {
		ips, err := s.resolveHost(ctx, policy, host)
		if err != nil {
			if policy.ResolveFailureAction == models.ProxyGatewayResolveFailureUseRemoteProxy {
				return originalTarget, originalTarget, nil
			}
			return "", "", err
		}
		if len(ips) == 0 {
			return "", "", fmt.Errorf("DNS lookup returned no IPs for %s", host)
		}
		targetAddr = net.JoinHostPort(ips[0].String(), strconv.Itoa(port))
	}
	httpConnectHostHeader := targetAddr
	if policy.HTTPConnectPreserveHost {
		httpConnectHostHeader = originalTarget
	}
	return targetAddr, httpConnectHostHeader, nil
}

func (s *ProxyGatewayService) resolveHost(ctx context.Context, policy models.ProxyGatewayDNSPolicy, host string) ([]net.IP, error) {
	if net.ParseIP(strings.Trim(host, "[]")) != nil {
		return []net.IP{net.ParseIP(strings.Trim(host, "[]"))}, nil
	}
	key := fmt.Sprintf("%s:%s:%s", policy.Mode, strings.Join(policy.Resolvers, ","), host)
	now := time.Now()
	s.mu.RLock()
	if entry, ok := s.dnsCache[key]; ok && entry.ExpiresAt.After(now) {
		s.mu.RUnlock()
		if entry.Error != "" {
			return nil, errors.New(entry.Error)
		}
		return entry.IPs, nil
	}
	s.mu.RUnlock()

	resolver := net.DefaultResolver
	if policy.Mode == models.ProxyGatewayDNSCustom && len(policy.Resolvers) > 0 {
		address := ensureResolverPort(policy.Resolvers[0])
		resolver = &net.Resolver{
			PreferGo: true,
			Dial: func(ctx context.Context, network, addr string) (net.Conn, error) {
				d := net.Dialer{Timeout: 5 * time.Second}
				return d.DialContext(ctx, "udp", address)
			},
		}
	}
	ips, err := resolver.LookupIP(ctx, "ip", host)
	if err == nil && len(ips) == 0 {
		err = fmt.Errorf("DNS lookup returned no IPs for %s", host)
	}
	ttl := nonZero(policy.CacheTTLSeconds, 300)
	errText := ""
	if err != nil {
		ttl = nonZero(policy.NegativeTTLSeconds, 60)
		errText = err.Error()
	}
	s.mu.Lock()
	s.dnsCache[key] = dnsCacheEntry{IPs: ips, Error: errText, ExpiresAt: now.Add(time.Duration(ttl) * time.Second)}
	s.mu.Unlock()
	return ips, err
}

type proxyIndexSelectionError struct {
	message string
}

func (e *proxyIndexSelectionError) Error() string { return e.message }

func (s *ProxyGatewayService) selectProxy(account *models.ProxyGatewayAccount, session *gatewaySession, exclude []uint, fallback bool) (*models.ProxyPoolItem, bool, error) {
	if account == nil {
		return nil, false, errors.New("missing proxy gateway account")
	}
	if session != nil && session.proxyIndex > 0 && !fallback && len(exclude) == 0 {
		return s.selectProxyByIndex(account, session)
	}
	candidates, err := s.loadProxyCandidates(account, fallback, exclude)
	if err != nil {
		return nil, false, err
	}
	if len(candidates) == 0 {
		return nil, false, errors.New("no available proxy matched gateway account strategy")
	}

	candidatesByID := map[uint]models.ProxyPoolItem{}
	for _, candidate := range candidates {
		candidatesByID[candidate.ID] = candidate
	}

	currentSession := gatewaySession{}
	if session != nil {
		currentSession = *session
	}
	stickyKey := s.stickyKey(account, currentSession)
	if stickyKey != "" {
		s.mu.RLock()
		entry, ok := s.sticky[stickyKey]
		s.mu.RUnlock()
		if ok && entry.ExpiresAt.After(time.Now()) {
			if item, found := candidatesByID[entry.ProxyID]; found {
				return &item, false, nil
			}
		}
	}

	if account.PreferLastSuccess || account.SelectionAlgorithm == models.ProxyGatewayAlgorithmPreferLastGood {
		s.mu.RLock()
		lastID := s.lastSuccess[s.routeRuntimeKey(account, currentSession)]
		s.mu.RUnlock()
		if lastID != 0 {
			if item, found := candidatesByID[lastID]; found {
				return &item, false, nil
			}
		}
	}

	var selected models.ProxyPoolItem
	switch account.SelectionAlgorithm {
	case models.ProxyGatewayAlgorithmRoundRobin:
		runtimeKey := s.routeRuntimeKey(account, currentSession)
		s.mu.Lock()
		index := s.roundRobin[runtimeKey] % len(candidates)
		s.roundRobin[runtimeKey] = s.roundRobin[runtimeKey] + 1
		s.mu.Unlock()
		selected = candidates[index]
	case models.ProxyGatewayAlgorithmLowestLatency:
		selected = candidates[0]
		for _, candidate := range candidates[1:] {
			if candidate.CheckLatencyMs > 0 && (selected.CheckLatencyMs == 0 || candidate.CheckLatencyMs < selected.CheckLatencyMs) {
				selected = candidate
			}
		}
	case models.ProxyGatewayAlgorithmWeighted:
		selected = s.weightedCandidate(candidates)
	default:
		s.mu.Lock()
		selected = candidates[s.rand.Intn(len(candidates))]
		s.mu.Unlock()
	}
	s.rememberStickySelection(account, currentSession, selected.ID)
	return &selected, false, nil
}

func (s *ProxyGatewayService) selectProxyByIndex(account *models.ProxyGatewayAccount, session *gatewaySession) (*models.ProxyPoolItem, bool, error) {
	candidates, err := s.loadIndexedProxyCandidates(account)
	if err != nil {
		return nil, false, err
	}
	if len(candidates) == 0 {
		return nil, false, &proxyIndexSelectionError{message: "pool proxy index cannot be resolved because the selected proxy pool is empty"}
	}
	requested := session.proxyIndex
	resolved := requested
	if requested > len(candidates) {
		if models.EffectiveProxyGatewayIndexOverflowMode(account.ProxyIndexOverflowMode) != models.ProxyGatewayIndexOverflowModulo {
			return nil, false, &proxyIndexSelectionError{message: fmt.Sprintf("pool proxy index %d exceeds pool size %d", requested, len(candidates))}
		}
		resolved = (requested-1)%len(candidates) + 1
	}
	session.resolvedProxyIndex = resolved
	session.proxyPoolSize = len(candidates)
	selected := candidates[resolved-1]
	return &selected, false, nil
}

func (s *ProxyGatewayService) loadProxyCandidates(account *models.ProxyGatewayAccount, fallback bool, exclude []uint) ([]models.ProxyPoolItem, error) {
	query := s.proxyRepo.GetDB().Model(&models.ProxyPoolItem{}).
		Where("org_id = ? AND status = ?", account.OrgID, models.ProxyStatusAvailable)
	if len(exclude) > 0 {
		query = query.Where("id NOT IN ?", exclude)
	}

	var explicitIDs []uint
	groupIDs := []uint(account.ProxyMatchGroupIDs)
	tagIDs := []uint(account.ProxyMatchTagIDs)
	tagMode := string(account.ProxyMatchTagMode)
	mode := account.SelectionMode

	if fallback {
		explicitIDs = []uint(account.FallbackProxyIDs)
		groupIDs = []uint(account.FallbackGroupIDs)
		tagIDs = []uint(account.FallbackTagIDs)
		tagMode = string(account.FallbackTagMode)
		mode = models.ProxyGatewaySelectionFiltered
		if len(explicitIDs) > 0 {
			mode = models.ProxyGatewaySelectionExplicit
		}
	} else {
		explicitIDs = []uint(account.ProxyIDs)
	}

	switch mode {
	case models.ProxyGatewaySelectionExplicit:
		if len(explicitIDs) == 0 {
			return nil, errors.New("explicit proxy strategy requires proxy IDs")
		}
		query = query.Where("id IN ?", explicitIDs)
	case models.ProxyGatewaySelectionAll:
	default:
		if len(groupIDs) > 0 {
			query = query.Where("group_id IN ?", groupIDs)
		}
		if len(tagIDs) > 0 {
			sub := s.proxyRepo.GetDB().Model(&models.ProxyPoolItemTag{}).Select("proxy_id").Where("tag_id IN ?", tagIDs)
			if strings.ToLower(tagMode) == "and" {
				sub = sub.Group("proxy_id").Having("COUNT(DISTINCT tag_id) = ?", len(tagIDs))
			}
			query = query.Where("id IN (?)", sub)
		}
	}
	var candidates []models.ProxyPoolItem
	err := query.Limit(500).Find(&candidates).Error
	return candidates, err
}

func (s *ProxyGatewayService) loadIndexedProxyCandidates(account *models.ProxyGatewayAccount) ([]models.ProxyPoolItem, error) {
	query := s.proxyRepo.GetDB().Model(&models.ProxyPoolItem{}).Where("org_id = ?", account.OrgID)
	explicitIDs := []uint(account.ProxyIDs)
	switch account.SelectionMode {
	case models.ProxyGatewaySelectionExplicit:
		if len(explicitIDs) == 0 {
			return nil, &proxyIndexSelectionError{message: "explicit proxy strategy requires proxy IDs"}
		}
		query = query.Where("id IN ?", explicitIDs)
	case models.ProxyGatewaySelectionAll:
	default:
		if len(account.ProxyMatchGroupIDs) > 0 {
			query = query.Where("group_id IN ?", []uint(account.ProxyMatchGroupIDs))
		}
		if len(account.ProxyMatchTagIDs) > 0 {
			sub := s.proxyRepo.GetDB().Model(&models.ProxyPoolItemTag{}).Select("proxy_id").Where("tag_id IN ?", []uint(account.ProxyMatchTagIDs))
			if strings.ToLower(string(account.ProxyMatchTagMode)) == "and" {
				sub = sub.Group("proxy_id").Having("COUNT(DISTINCT tag_id) = ?", len(account.ProxyMatchTagIDs))
			}
			query = query.Where("id IN (?)", sub)
		}
	}

	var candidates []models.ProxyPoolItem
	if err := query.Order("id ASC").Limit(500).Find(&candidates).Error; err != nil {
		return nil, err
	}
	if account.SelectionMode != models.ProxyGatewaySelectionExplicit {
		return candidates, nil
	}
	byID := make(map[uint]models.ProxyPoolItem, len(candidates))
	for _, candidate := range candidates {
		byID[candidate.ID] = candidate
	}
	ordered := make([]models.ProxyPoolItem, 0, len(candidates))
	for _, id := range explicitIDs {
		if candidate, ok := byID[id]; ok {
			ordered = append(ordered, candidate)
		}
	}
	return ordered, nil
}

func (s *ProxyGatewayService) weightedCandidate(candidates []models.ProxyPoolItem) models.ProxyPoolItem {
	total := 0
	weights := make([]int, len(candidates))
	for i, candidate := range candidates {
		weight := 1 + candidate.SuccessCount
		if candidate.CheckLatencyMs > 0 && candidate.CheckLatencyMs < 1000 {
			weight += int((1000 - candidate.CheckLatencyMs) / 100)
		}
		if candidate.FailureCount > 0 && weight > candidate.FailureCount {
			weight -= candidate.FailureCount
		}
		if weight < 1 {
			weight = 1
		}
		weights[i] = weight
		total += weight
	}
	s.mu.Lock()
	pick := s.rand.Intn(total)
	s.mu.Unlock()
	for i, weight := range weights {
		if pick < weight {
			return candidates[i]
		}
		pick -= weight
	}
	return candidates[len(candidates)-1]
}

func (s *ProxyGatewayService) stickyKey(account *models.ProxyGatewayAccount, session gatewaySession) string {
	if account == nil || account.StickyMode == models.ProxyGatewayStickyNone || account.ID == 0 {
		return ""
	}
	scope := s.routeRuntimeKey(account, session)
	switch account.StickyMode {
	case models.ProxyGatewayStickyAccount:
		return fmt.Sprintf("%s:account", scope)
	case models.ProxyGatewayStickyClientIP:
		return fmt.Sprintf("%s:client:%s", scope, session.clientIP)
	case models.ProxyGatewayStickyTargetHost:
		return fmt.Sprintf("%s:target:%s", scope, strings.ToLower(session.targetHost))
	case models.ProxyGatewayStickyClientHost:
		return fmt.Sprintf("%s:client:%s:target:%s", scope, session.clientIP, strings.ToLower(session.targetHost))
	default:
		return ""
	}
}

func (s *ProxyGatewayService) rememberProxySuccess(account *models.ProxyGatewayAccount, session gatewaySession, proxyID uint) {
	if account == nil || account.ID == 0 || proxyID == 0 {
		return
	}
	s.mu.Lock()
	s.lastSuccess[s.routeRuntimeKey(account, session)] = proxyID
	if key := s.stickyKey(account, session); key != "" {
		ttl := nonZero(account.StickyTTLSeconds, 600)
		s.sticky[key] = stickyProxyEntry{ProxyID: proxyID, ExpiresAt: time.Now().Add(time.Duration(ttl) * time.Second)}
	}
	s.mu.Unlock()
	_ = s.repo.GetDB().Model(&models.ProxyGatewayAccount{}).Where("id = ?", account.ID).Update("last_used_at", time.Now()).Error
}

func (s *ProxyGatewayService) rememberStickySelection(account *models.ProxyGatewayAccount, session gatewaySession, proxyID uint) {
	if account == nil || account.ID == 0 || proxyID == 0 {
		return
	}
	key := s.stickyKey(account, session)
	if key == "" {
		return
	}
	ttl := nonZero(account.StickyTTLSeconds, 600)
	s.mu.Lock()
	s.sticky[key] = stickyProxyEntry{ProxyID: proxyID, ExpiresAt: time.Now().Add(time.Duration(ttl) * time.Second)}
	s.mu.Unlock()
}

func (s *ProxyGatewayService) forgetStickySelection(account *models.ProxyGatewayAccount, session gatewaySession, proxyID uint) {
	if account == nil || account.ID == 0 || proxyID == 0 {
		return
	}
	key := s.stickyKey(account, session)
	if key == "" {
		return
	}
	s.mu.Lock()
	if entry, ok := s.sticky[key]; ok && entry.ProxyID == proxyID {
		delete(s.sticky, key)
	}
	s.mu.Unlock()
}

func (s *ProxyGatewayService) routeRuntimeKey(account *models.ProxyGatewayAccount, session gatewaySession) string {
	if account == nil {
		return "account:0"
	}
	if session.targetRouteID != nil {
		return fmt.Sprintf("account:%d:target-route:%d", account.ID, *session.targetRouteID)
	}
	if session.routeStrategyID != nil {
		return fmt.Sprintf("account:%d:route:%d", account.ID, *session.routeStrategyID)
	}
	return fmt.Sprintf("account:%d", account.ID)
}

func (s *ProxyGatewayService) dialTarget(ctx context.Context, targetAddr, httpConnectHostHeader string, proxyItem *models.ProxyPoolItem, direct bool, timeout int) (net.Conn, error) {
	if timeout <= 0 {
		timeout = 30
	}
	attemptCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()
	dialer := &net.Dialer{Timeout: time.Duration(timeout) * time.Second, KeepAlive: 30 * time.Second}
	if direct || proxyItem == nil {
		return dialer.DialContext(attemptCtx, "tcp", targetAddr)
	}
	proxyURL, err := url.Parse(proxyItem.ProxyURL())
	if err != nil {
		return nil, err
	}
	switch models.NormalizeProxyType(proxyItem.Type) {
	case models.ProxyTypeHTTP, models.ProxyTypeHTTPS:
		return dialViaHTTPProxy(attemptCtx, dialer, proxyURL, targetAddr, httpConnectHostHeader)
	case models.ProxyTypeSocks5:
		xDialer, err := xproxy.FromURL(proxyURL, xproxy.Direct)
		if err != nil {
			return nil, err
		}
		return dialWithProxyDialer(attemptCtx, xDialer, targetAddr)
	case models.ProxyTypeSSH:
		return dialViaSSHProxy(attemptCtx, dialer, proxyURL, targetAddr)
	default:
		return nil, fmt.Errorf("unsupported upstream proxy type: %s", proxyItem.Type)
	}
}

func dialViaHTTPProxy(ctx context.Context, dialer *net.Dialer, proxyURL *url.URL, targetAddr, connectHostHeader string) (net.Conn, error) {
	proxyHost := proxyURL.Host
	if !strings.Contains(proxyHost, ":") {
		if proxyURL.Scheme == "https" {
			proxyHost += ":443"
		} else {
			proxyHost += ":80"
		}
	}
	conn, err := dialer.DialContext(ctx, "tcp", proxyHost)
	if err != nil {
		return nil, err
	}
	if proxyURL.Scheme == "https" {
		host, _, _ := net.SplitHostPort(proxyHost)
		tlsConn := tls.Client(conn, &tls.Config{ServerName: host})
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			return nil, err
		}
		conn = tlsConn
	}
	if deadline, ok := ctx.Deadline(); ok {
		if err := conn.SetDeadline(deadline); err != nil {
			_ = conn.Close()
			return nil, err
		}
	}
	if strings.TrimSpace(connectHostHeader) == "" {
		connectHostHeader = targetAddr
	}
	connectReq := "CONNECT " + targetAddr + " HTTP/1.1\r\nHost: " + connectHostHeader + "\r\nProxy-Connection: Keep-Alive\r\n"
	if proxyURL.User != nil {
		username := proxyURL.User.Username()
		password, _ := proxyURL.User.Password()
		encoded := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
		connectReq += "Proxy-Authorization: Basic " + encoded + "\r\n"
	}
	connectReq += "\r\n"
	if _, err := conn.Write([]byte(connectReq)); err != nil {
		_ = conn.Close()
		return nil, err
	}
	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_ = conn.Close()
		return nil, fmt.Errorf("upstream HTTP proxy CONNECT failed: %s", resp.Status)
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		_ = conn.Close()
		return nil, err
	}
	if reader.Buffered() > 0 {
		return &bufferedConn{Conn: conn, reader: reader}, nil
	}
	return conn, nil
}

func dialWithProxyDialer(ctx context.Context, dialer xproxy.Dialer, targetAddr string) (net.Conn, error) {
	if contextDialer, ok := dialer.(xproxy.ContextDialer); ok {
		return contextDialer.DialContext(ctx, "tcp", targetAddr)
	}
	type result struct {
		conn net.Conn
		err  error
	}
	ch := make(chan result)
	go func() {
		conn, err := dialer.Dial("tcp", targetAddr)
		select {
		case ch <- result{conn: conn, err: err}:
		case <-ctx.Done():
			if conn != nil {
				_ = conn.Close()
			}
		}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-ch:
		return result.conn, result.err
	}
}

func dialViaSSHProxy(ctx context.Context, dialer *net.Dialer, proxyURL *url.URL, targetAddr string) (net.Conn, error) {
	if proxyURL.User == nil {
		return nil, errors.New("ssh proxy requires username and password")
	}
	username := proxyURL.User.Username()
	password, _ := proxyURL.User.Password()
	if username == "" || password == "" {
		return nil, errors.New("ssh proxy requires username and password")
	}
	cfg := &cryptossh.ClientConfig{
		User:            username,
		Auth:            []cryptossh.AuthMethod{cryptossh.Password(password)},
		HostKeyCallback: cryptossh.InsecureIgnoreHostKey(),
	}
	proxyHost := proxyURL.Host
	if !strings.Contains(proxyHost, ":") {
		proxyHost += ":22"
	}
	rawConn, err := dialer.DialContext(ctx, "tcp", proxyHost)
	if err != nil {
		return nil, err
	}
	cancelClose := context.AfterFunc(ctx, func() { _ = rawConn.Close() })
	defer cancelClose()
	if deadline, ok := ctx.Deadline(); ok {
		if err := rawConn.SetDeadline(deadline); err != nil {
			_ = rawConn.Close()
			return nil, err
		}
	}
	clientConn, channels, requests, err := cryptossh.NewClientConn(rawConn, proxyHost, cfg)
	if err != nil {
		_ = rawConn.Close()
		return nil, err
	}
	client := cryptossh.NewClient(clientConn, channels, requests)
	conn, err := client.Dial("tcp", targetAddr)
	if err != nil {
		_ = client.Close()
		return nil, err
	}
	if !cancelClose() && ctx.Err() != nil {
		_ = conn.Close()
		_ = client.Close()
		return nil, ctx.Err()
	}
	if err := rawConn.SetDeadline(time.Time{}); err != nil {
		_ = conn.Close()
		_ = client.Close()
		return nil, err
	}
	return &sshProxyConn{Conn: conn, client: client}, nil
}

type sshProxyConn struct {
	net.Conn
	client    *cryptossh.Client
	closeOnce sync.Once
	closeErr  error
}

func (c *sshProxyConn) Close() error {
	c.closeOnce.Do(func() {
		c.closeErr = errors.Join(c.Conn.Close(), c.client.Close())
	})
	return c.closeErr
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) {
	if c.reader != nil && c.reader.Buffered() > 0 {
		return c.reader.Read(p)
	}
	return c.Conn.Read(p)
}

type bandwidthLimiter struct {
	rateBytesPerSecond int64
	mu                 sync.Mutex
	allowance          float64
	last               time.Time
}

func newBandwidthLimiter(kbps int) *bandwidthLimiter {
	if kbps <= 0 {
		return nil
	}
	rate := int64(kbps) * 1024
	return &bandwidthLimiter{
		rateBytesPerSecond: rate,
		allowance:          float64(rate),
		last:               time.Now(),
	}
}

func (l *bandwidthLimiter) wait(n int) {
	if l == nil || n <= 0 || l.rateBytesPerSecond <= 0 {
		return
	}
	remaining := n
	for remaining > 0 {
		l.mu.Lock()
		now := time.Now()
		elapsed := now.Sub(l.last).Seconds()
		if elapsed > 0 {
			l.allowance += elapsed * float64(l.rateBytesPerSecond)
			if l.allowance > float64(l.rateBytesPerSecond) {
				l.allowance = float64(l.rateBytesPerSecond)
			}
			l.last = now
		}
		if l.allowance >= 1 {
			take := int(l.allowance)
			if take > remaining {
				take = remaining
			}
			l.allowance -= float64(take)
			remaining -= take
			l.mu.Unlock()
			continue
		}
		waitFor := time.Duration((1 - l.allowance) / float64(l.rateBytesPerSecond) * float64(time.Second))
		l.mu.Unlock()
		if waitFor <= 0 {
			waitFor = time.Millisecond
		}
		time.Sleep(waitFor)
	}
}

func proxyPipe(a, b net.Conn, session gatewaySession) (int64, int64) {
	idleTimeout := time.Duration(nonZero(session.listener.IdleTimeoutSeconds, 120)) * time.Second
	maxSessionSeconds := 0
	bandwidthLimitKBps := 0
	if session.account != nil {
		if session.account.IdleTimeoutSeconds > 0 {
			idleTimeout = time.Duration(session.account.IdleTimeoutSeconds) * time.Second
		}
		maxSessionSeconds = session.account.MaxSessionSeconds
		bandwidthLimitKBps = session.account.BandwidthLimitKBps
	}
	if maxSessionSeconds > 0 {
		deadline := time.Now().Add(time.Duration(maxSessionSeconds) * time.Second)
		_ = a.SetDeadline(deadline)
		_ = b.SetDeadline(deadline)
		defer func() {
			_ = a.SetDeadline(time.Time{})
			_ = b.SetDeadline(time.Time{})
		}()
	}
	limiter := newBandwidthLimiter(bandwidthLimitKBps)
	var wg sync.WaitGroup
	var aToB int64
	var bToA int64
	wg.Add(2)
	go func() {
		defer wg.Done()
		n := copyWithGatewayLimits(b, a, idleTimeout, limiter)
		aToB = n
		_ = b.SetDeadline(time.Now())
	}()
	go func() {
		defer wg.Done()
		n := copyWithGatewayLimits(a, b, idleTimeout, limiter)
		bToA = n
		_ = a.SetDeadline(time.Now())
	}()
	wg.Wait()
	return aToB, bToA
}

func copyWithGatewayLimits(dst, src net.Conn, idleTimeout time.Duration, limiter *bandwidthLimiter) int64 {
	buf := make([]byte, 32*1024)
	var total int64
	for {
		if idleTimeout > 0 {
			_ = src.SetReadDeadline(time.Now().Add(idleTimeout))
		}
		n, readErr := src.Read(buf)
		if n > 0 {
			limiter.wait(n)
			written, writeErr := writeFullWithDeadline(dst, buf[:n], idleTimeout)
			total += int64(written)
			if writeErr != nil {
				return total
			}
		}
		if readErr != nil {
			return total
		}
	}
}

func writeFullWithDeadline(conn net.Conn, data []byte, idleTimeout time.Duration) (int, error) {
	total := 0
	for total < len(data) {
		if idleTimeout > 0 {
			_ = conn.SetWriteDeadline(time.Now().Add(idleTimeout))
		}
		n, err := conn.Write(data[total:])
		total += n
		if err != nil {
			return total, err
		}
	}
	return total, nil
}

func (s *ProxyGatewayService) enterAccount(account *models.ProxyGatewayAccount) bool {
	if account == nil || account.ID == 0 {
		return true
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if account.MaxConcurrent > 0 && s.active[account.ID] >= account.MaxConcurrent {
		return false
	}
	if account.RateLimitPerMinute > 0 {
		window := s.rateWindows[account.ID]
		if window.StartedAt.IsZero() || now.Sub(window.StartedAt) >= time.Minute {
			window = rateWindow{StartedAt: now}
		}
		if window.Count >= account.RateLimitPerMinute {
			s.rateWindows[account.ID] = window
			return false
		}
		window.Count++
		s.rateWindows[account.ID] = window
	}
	s.active[account.ID]++
	return true
}

func (s *ProxyGatewayService) leaveAccount(account *models.ProxyGatewayAccount) {
	if account == nil || account.ID == 0 {
		return
	}
	s.mu.Lock()
	if s.active[account.ID] > 0 {
		s.active[account.ID]--
	}
	s.mu.Unlock()
}

func (s *ProxyGatewayService) newSession(listener models.ProxyGatewayListener, remote net.Addr, protocol, command string) gatewaySession {
	host, port := splitRemoteAddr(remote)
	return gatewaySession{
		listener:   listener,
		clientIP:   host,
		clientPort: port,
		protocol:   protocol,
		command:    command,
		startedAt:  time.Now(),
	}
}

func (s *ProxyGatewayService) finishSession(session gatewaySession, account *models.ProxyGatewayAccount, proxyItem *models.ProxyPoolItem, status, denyReason string, err error) {
	security, dns, _ := s.effectivePolicies(session.listener, account)
	s.finishSessionWithPolicies(session, account, proxyItem, status, denyReason, err, security, dns)
}

func (s *ProxyGatewayService) finishSessionWithPolicies(session gatewaySession, account *models.ProxyGatewayAccount, proxyItem *models.ProxyPoolItem, status, denyReason string, err error, security *models.ProxyGatewaySecurityPolicy, dns *models.ProxyGatewayDNSPolicy) {
	var listenerID *uint
	if session.listener.ID != 0 {
		id := session.listener.ID
		listenerID = &id
	}
	var accountID *uint
	username := ""
	if account != nil {
		username = account.Username
		if account.ID != 0 {
			id := account.ID
			accountID = &id
		}
	}
	var proxyID *uint
	if proxyItem != nil {
		id := proxyItem.ID
		proxyID = &id
		if trafficErr := s.proxyRepo.AddTraffic(session.listener.OrgID, proxyItem.ID, session.bytesIn, session.bytesOut); trafficErr != nil {
			s.logger.Warn("failed to persist traffic for upstream proxy %d: %v", proxyItem.ID, trafficErr)
		}
	}
	var securityID *uint
	if security != nil && security.ID != 0 {
		id := security.ID
		securityID = &id
	}
	var dnsID *uint
	dnsMode := ""
	if dns != nil {
		dnsMode = string(dns.Mode)
		if dns.ID != 0 {
			id := dns.ID
			dnsID = &id
		}
	}
	errText := ""
	if err != nil {
		errText = err.Error()
	}
	_ = s.repo.CreateAccessLog(&models.ProxyGatewayAccessLog{
		OrgID:                              session.listener.OrgID,
		ListenerID:                         listenerID,
		AccountID:                          accountID,
		Username:                           username,
		RequestedUsername:                  session.rawUsername,
		ClientIP:                           session.clientIP,
		ClientPort:                         session.clientPort,
		Protocol:                           session.protocol,
		Command:                            session.command,
		TargetHost:                         session.targetHost,
		TargetPort:                         session.targetPort,
		UpstreamProxyID:                    proxyID,
		Status:                             status,
		DenyReason:                         denyReason,
		Error:                              errText,
		BytesIn:                            session.bytesIn,
		BytesOut:                           session.bytesOut,
		DurationMs:                         time.Since(session.startedAt).Milliseconds(),
		DNSMode:                            dnsMode,
		SecurityPolicyID:                   securityID,
		DNSPolicyID:                        dnsID,
		RouteStrategyID:                    session.routeStrategyID,
		RouteStrategyFlagNo:                session.routeStrategyFlagNo,
		PrimaryRouteStrategyID:             session.primaryStrategyID,
		FallbackRouteStrategyID:            session.fallbackStrategyID,
		RouteStrategyOverrideSourceID:      session.routeStrategyOverrideSourceID,
		RouteStrategyOverrideReplacementID: session.routeStrategyOverrideReplacementID,
		RouteFailoverUsed:                  session.routeFailoverUsed,
		RouteFailoverReason:                session.routeFailoverReason,
		RouteCircuitState:                  session.routeCircuitState,
		RouteCircuitCacheHit:               session.routeCircuitCacheHit,
		RouteCircuitProbe:                  session.routeCircuitProbe,
		ProxyIndex:                         session.proxyIndex,
		ResolvedProxyIndex:                 session.resolvedProxyIndex,
		ProxyPoolSize:                      session.proxyPoolSize,
		RouteParams:                        session.routeParams,
		TargetRouteID:                      session.targetRouteID,
		TargetRouteMatcher:                 session.targetRouteMatcher,
		TargetRouteDefault:                 session.targetRouteDefault,
	})
}

func targetFromHTTPRequest(req *http.Request) (string, int) {
	if req.Method == http.MethodConnect {
		host, port, err := splitHostPortWithDefault(req.Host, 443)
		if err != nil {
			return "", 0
		}
		return host, port
	}
	if req.URL == nil {
		return "", 0
	}
	host, port, err := splitHostPortWithDefault(req.URL.Host, 80)
	if err != nil {
		return "", 0
	}
	if req.URL.Scheme == "https" && !strings.Contains(req.URL.Host, ":") {
		port = 443
	}
	return host, port
}

func splitHostPortWithDefault(addr string, defaultPort int) (string, int, error) {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return "", 0, errors.New("empty address")
	}
	host, portText, err := net.SplitHostPort(addr)
	if err != nil {
		host = strings.Trim(addr, "[]")
		if strings.Contains(host, ":") && net.ParseIP(host) == nil {
			return "", 0, err
		}
		return host, defaultPort, nil
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		return "", 0, err
	}
	return strings.Trim(host, "[]"), port, nil
}

func checkSourceIP(clientIP string, policy models.ProxyGatewaySecurityPolicy) error {
	ip := net.ParseIP(clientIP)
	if ip == nil {
		return nil
	}
	for _, cidr := range policy.SourceDenyCIDRs {
		if cidrContainsIP(cidr, ip) {
			return fmt.Errorf("client IP %s is denied by source denylist", clientIP)
		}
	}
	if len(policy.SourceAllowCIDRs) == 0 {
		return nil
	}
	for _, cidr := range policy.SourceAllowCIDRs {
		if cidrContainsIP(cidr, ip) {
			return nil
		}
	}
	if policy.NoMatchAction == models.ProxyGatewayPolicyAllow || policy.NoMatchAction == models.ProxyGatewayPolicyLogOnly {
		return nil
	}
	return fmt.Errorf("client IP %s is not in source allowlist", clientIP)
}

func cidrContainsIP(cidr string, ip net.IP) bool {
	cidr = strings.TrimSpace(cidr)
	if cidr == "" {
		return false
	}
	if parsed := net.ParseIP(cidr); parsed != nil {
		return parsed.Equal(ip)
	}
	_, network, err := net.ParseCIDR(cidr)
	return err == nil && network.Contains(ip)
}

func checkHostPolicy(host string, policy models.ProxyGatewaySecurityPolicy) error {
	host = strings.ToLower(strings.Trim(host, "[]"))
	for _, pattern := range policy.TargetHostDenylist {
		if hostMatchesPattern(host, pattern) {
			return fmt.Errorf("target host %s is denied", host)
		}
	}
	if len(policy.TargetHostAllowlist) == 0 {
		return nil
	}
	for _, pattern := range policy.TargetHostAllowlist {
		if hostMatchesPattern(host, pattern) {
			return nil
		}
	}
	if policy.NoMatchAction == models.ProxyGatewayPolicyAllow || policy.NoMatchAction == models.ProxyGatewayPolicyLogOnly {
		return nil
	}
	return fmt.Errorf("target host %s is not allowed", host)
}

func hostMatchesPattern(host, pattern string) bool {
	pattern = strings.ToLower(strings.TrimSpace(pattern))
	if pattern == "" {
		return false
	}
	if pattern == "*" || pattern == host {
		return true
	}
	if strings.HasPrefix(pattern, "*.") {
		suffix := strings.TrimPrefix(pattern, "*")
		return strings.HasSuffix(host, suffix)
	}
	return false
}

func checkPortPolicy(port int, policy models.ProxyGatewaySecurityPolicy) error {
	for _, pattern := range policy.TargetPortDenylist {
		if portMatchesPattern(port, pattern) {
			return fmt.Errorf("target port %d is denied", port)
		}
	}
	if len(policy.TargetPortAllowlist) == 0 {
		return nil
	}
	for _, pattern := range policy.TargetPortAllowlist {
		if portMatchesPattern(port, pattern) {
			return nil
		}
	}
	if policy.NoMatchAction == models.ProxyGatewayPolicyAllow || policy.NoMatchAction == models.ProxyGatewayPolicyLogOnly {
		return nil
	}
	return fmt.Errorf("target port %d is not allowed", port)
}

func portMatchesPattern(port int, pattern string) bool {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return false
	}
	if pattern == "*" {
		return true
	}
	if strings.Contains(pattern, "-") {
		parts := strings.SplitN(pattern, "-", 2)
		start, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
		end, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
		return err1 == nil && err2 == nil && port >= start && port <= end
	}
	value, err := strconv.Atoi(pattern)
	return err == nil && value == port
}

func checkBlockedIP(ip net.IP, policy models.ProxyGatewaySecurityPolicy) error {
	if ip == nil {
		return nil
	}
	if policy.BlockMetadataIP && isMetadataIP(ip) {
		return fmt.Errorf("target IP %s is a metadata address", ip)
	}
	if policy.BlockLoopback && ip.IsLoopback() {
		return fmt.Errorf("target IP %s is loopback", ip)
	}
	if policy.BlockPrivateIP && ip.IsPrivate() {
		return fmt.Errorf("target IP %s is private", ip)
	}
	if policy.BlockLinkLocal && (ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()) {
		return fmt.Errorf("target IP %s is link-local", ip)
	}
	if policy.BlockMulticast && ip.IsMulticast() {
		return fmt.Errorf("target IP %s is multicast", ip)
	}
	return nil
}

func isMetadataIP(ip net.IP) bool {
	metadata := []string{"169.254.169.254", "169.254.170.2", "100.100.100.200"}
	for _, value := range metadata {
		if ip.Equal(net.ParseIP(value)) {
			return true
		}
	}
	return false
}

func listenerSignature(listener models.ProxyGatewayListener) string {
	return fmt.Sprintf("%d|%s|%d|%s|%t|%t|%d|%d|%d|%v|%v",
		listener.OrgID,
		listener.ListenIP,
		listener.Port,
		listener.Protocol,
		listener.AllowPublicListen,
		listener.RequireAuth,
		listener.HandshakeTimeoutSeconds,
		listener.IdleTimeoutSeconds,
		listener.ConnectTimeoutSeconds,
		listener.SecurityPolicyID,
		listener.DNSPolicyID,
	)
}

func splitRemoteAddr(addr net.Addr) (string, string) {
	if addr == nil {
		return "", ""
	}
	host, port, err := net.SplitHostPort(addr.String())
	if err != nil {
		return addr.String(), ""
	}
	return host, port
}

func isLoopbackHost(host string) bool {
	host = strings.TrimSpace(host)
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func ensureResolverPort(addr string) string {
	if _, _, err := net.SplitHostPort(addr); err == nil {
		return addr
	}
	return net.JoinHostPort(addr, "53")
}

func nonZero(value, fallback int) int {
	if value != 0 {
		return value
	}
	return fallback
}

func byteSliceContains(values []byte, target byte) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
