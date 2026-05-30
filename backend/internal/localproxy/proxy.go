package localproxy

import (
	"bufio"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const DefaultTarget = "https://mailman.easycat.io"

// Config describes the local reverse proxy runtime settings.
type Config struct {
	ListenIP    string
	Port        int
	Target      string
	LogRequests bool
	Verbose     bool
	Timeout     time.Duration
}

// DefaultConfig returns sensible defaults for local Mailman OAuth callback forwarding.
func DefaultConfig() Config {
	return Config{
		ListenIP:    "127.0.0.1",
		Port:        8080,
		Target:      DefaultTarget,
		LogRequests: true,
		Timeout:     60 * time.Second,
	}
}

// Addr returns the listen address in host:port form.
func (c Config) Addr() string {
	return net.JoinHostPort(c.ListenIP, strconv.Itoa(c.Port))
}

// Validate checks the proxy configuration.
func (c Config) Validate() error {
	if strings.TrimSpace(c.ListenIP) == "" {
		return errors.New("listen ip cannot be empty")
	}
	if c.Port <= 0 || c.Port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535: %d", c.Port)
	}
	if c.Timeout <= 0 {
		return errors.New("timeout must be greater than 0")
	}
	_, err := ParseTarget(c.Target)
	return err
}

// ParseTarget parses a target origin. A bare domain is treated as https://domain.
func ParseTarget(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("target cannot be empty")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}

	target, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parse target: %w", err)
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, fmt.Errorf("target scheme must be http or https: %s", target.Scheme)
	}
	if target.Host == "" {
		return nil, errors.New("target host cannot be empty")
	}
	return target, nil
}

// NewHandler builds an HTTP handler that transparently forwards requests to cfg.Target.
func NewHandler(cfg Config, logger *log.Logger) (http.Handler, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	target, err := ParseTarget(cfg.Target)
	if err != nil {
		return nil, err
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(r *http.Request) {
		originalHost := r.Host
		originalProto := forwardedProto(r)

		originalDirector(r)
		r.Host = target.Host
		r.Header.Set("X-Forwarded-Host", originalHost)
		r.Header.Set("X-Forwarded-Proto", originalProto)
		r.Header.Set("X-Forwarded-Server", originalHost)
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		if logger != nil {
			logger.Printf("proxy error method=%s path=%s target=%s error=%v", r.Method, r.URL.RequestURI(), target.Redacted(), err)
		}
		http.Error(w, "mailman proxy error", http.StatusBadGateway)
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = cfg.Timeout
	proxy.Transport = transport

	handler := http.Handler(proxy)
	if cfg.LogRequests && logger != nil {
		handler = loggingMiddleware(handler, target, logger, cfg.Verbose)
	}
	return handler, nil
}

// NewServer creates a configured HTTP server for the proxy.
func NewServer(cfg Config, logger *log.Logger) (*http.Server, error) {
	handler, err := NewHandler(cfg, logger)
	if err != nil {
		return nil, err
	}
	return &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}, nil
}

func forwardedProto(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(data []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(data)
	r.bytes += int64(n)
	return n, err
}

func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

func loggingMiddleware(next http.Handler, target *url.URL, logger *log.Logger, verbose bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		requestURI := r.URL.RequestURI()
		recorder := &statusRecorder{ResponseWriter: w}

		if verbose {
			logger.Printf("forwarding method=%s from=%s path=%s query=%q target=%s", r.Method, r.RemoteAddr, r.URL.Path, r.URL.RawQuery, target.Redacted())
		}

		next.ServeHTTP(recorder, r)

		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		logger.Printf(
			"%s %s -> %s status=%d bytes=%d duration=%s",
			r.Method,
			requestURI,
			target.Redacted(),
			status,
			recorder.bytes,
			time.Since(start).Round(time.Millisecond),
		)
	})
}
