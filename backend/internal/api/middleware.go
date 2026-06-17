package api

import (
	"bufio"
	"bytes"
	"context"
	"mailman/internal/services"
	"mailman/internal/utils"
	"net"
	"net/http"
	"strings"
	"time"
)

// ContextKey is a custom type for context keys
type ContextKey string

const (
	// UserContextKey is the key for storing user in context
	UserContextKey ContextKey = "user"
)

// AuthMiddleware creates an authentication middleware
func AuthMiddleware(authService *services.AuthService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract token from Authorization header
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "Authorization header required", http.StatusUnauthorized)
				return
			}

			// Check for Bearer token
			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || parts[0] != "Bearer" {
				http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
				return
			}

			token := parts[1]

			// 使用请求上下文验证会话，确保请求取消时验证也会取消
			// 这避免了在请求已终止的情况下验证会话继续执行
			user, err := authService.ValidateSessionWithContext(r.Context(), token)
			if err != nil {
				http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
				return
			}

			// Add user to context
			ctx := context.WithValue(r.Context(), UserContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// PublicEndpoint is a middleware that marks an endpoint as public (no auth required)
func PublicEndpoint(next http.Handler) http.Handler {
	return next
}

// LoggingMiddleware creates a logging middleware for HTTP requests
func LoggingMiddleware(logger *utils.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Create a custom response writer to capture status code
			lrw := &loggingResponseWriter{
				ResponseWriter: w,
				statusCode:     http.StatusOK,
			}

			// Log request with verbose flag set to false for normal logging
			logger.LogHTTPRequest(r, false)

			// Call the next handler
			next.ServeHTTP(lrw, r)

			// Log response
			duration := time.Since(start)

			// Create a minimal response object for logging
			resp := &http.Response{
				StatusCode: lrw.statusCode,
				Request:    r,
			}
			logger.LogHTTPResponse(resp, duration, false)
		})
	}
}

// loggingResponseWriter wraps http.ResponseWriter to capture status code
type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode    int
	body          bytes.Buffer
	bodyLimit     int
	bodyTruncated bool
}

// WriteHeader captures the status code
func (lrw *loggingResponseWriter) WriteHeader(code int) {
	lrw.statusCode = code
	lrw.ResponseWriter.WriteHeader(code)
}

// Write ensures we capture the status code even if WriteHeader isn't called
func (lrw *loggingResponseWriter) Write(b []byte) (int, error) {
	if lrw.statusCode == 0 {
		lrw.statusCode = http.StatusOK
	}
	if lrw.bodyLimit > 0 && len(b) > 0 {
		remaining := lrw.bodyLimit - lrw.body.Len()
		if remaining > 0 {
			if len(b) > remaining {
				lrw.body.Write(b[:remaining])
				lrw.bodyTruncated = true
			} else {
				lrw.body.Write(b)
			}
		} else {
			lrw.bodyTruncated = true
		}
	}
	return lrw.ResponseWriter.Write(b)
}

// Hijack implements http.Hijacker interface for WebSocket support
// WebSocket upgrades require the ability to hijack the underlying TCP connection
func (lrw *loggingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hijacker, ok := lrw.ResponseWriter.(http.Hijacker); ok {
		return hijacker.Hijack()
	}
	return nil, nil, http.ErrNotSupported
}

// Flush implements http.Flusher interface
func (lrw *loggingResponseWriter) Flush() {
	if flusher, ok := lrw.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}
