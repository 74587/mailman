package utils

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"os"
	"runtime"
	"strings"
	"time"
)

// LogLevel represents the severity of a log message
type LogLevel int

const (
	DEBUG LogLevel = iota
	INFO
	WARN
	ERROR
)

// Logger provides structured logging with different levels
type Logger struct {
	level   LogLevel
	prefix  string
	quieted bool // 是否被静默（仅输出 WARN 及以上）
}

// quietPrefixes 存储需要静默的前缀列表
var quietPrefixes []string

// initQuietPrefixes 初始化静默前缀列表
func initQuietPrefixes() {
	if quietPrefixes != nil {
		return
	}
	quietPrefixes = []string{}

	// 从环境变量读取静默前缀列表
	// 格式: LOG_QUIET_PREFIXES="FetcherService,AccountSyncer"
	if envQuiet := os.Getenv("LOG_QUIET_PREFIXES"); envQuiet != "" {
		for _, prefix := range strings.Split(envQuiet, ",") {
			prefix = strings.TrimSpace(prefix)
			if prefix != "" {
				quietPrefixes = append(quietPrefixes, prefix)
			}
		}
	}
}

// isQuietedPrefix 检查前缀是否应该被静默
func isQuietedPrefix(prefix string) bool {
	initQuietPrefixes()
	for _, qp := range quietPrefixes {
		// 支持前缀匹配（例如 "AccountSyncer" 匹配 "AccountSyncer-36"）
		if strings.HasPrefix(prefix, qp) {
			return true
		}
	}
	return false
}

// NewLogger creates a new logger instance
func NewLogger(prefix string) *Logger {
	level := INFO // Default level

	// Check environment variable for log level
	if envLevel := os.Getenv("LOG_LEVEL"); envLevel != "" {
		switch strings.ToUpper(envLevel) {
		case "DEBUG":
			level = DEBUG
		case "INFO":
			level = INFO
		case "WARN":
			level = WARN
		case "ERROR":
			level = ERROR
		}
	}

	// 检查是否需要静默此前缀的日志
	quieted := isQuietedPrefix(prefix)

	return &Logger{
		level:   level,
		prefix:  prefix,
		quieted: quieted,
	}
}

// Debug logs a debug message
func (l *Logger) Debug(format string, args ...interface{}) {
	// 如果被静默，跳过 DEBUG 级别日志
	if l.quieted {
		return
	}
	if l.level <= DEBUG {
		l.log("DEBUG", format, args...)
	}
}

// Info logs an info message
func (l *Logger) Info(format string, args ...interface{}) {
	// 如果被静默，跳过 INFO 级别日志
	if l.quieted {
		return
	}
	if l.level <= INFO {
		l.log("INFO", format, args...)
	}
}

// Warn logs a warning message
func (l *Logger) Warn(format string, args ...interface{}) {
	if l.level <= WARN {
		l.log("WARN", format, args...)
	}
}

// Error logs an error message
func (l *Logger) Error(format string, args ...interface{}) {
	if l.level <= ERROR {
		l.log("ERROR", format, args...)
	}
}

// ErrorWithStack logs an error with stack trace
func (l *Logger) ErrorWithStack(err error, format string, args ...interface{}) {
	if l.level <= ERROR {
		message := fmt.Sprintf(format, args...)
		stack := l.getStackTrace()
		l.log("ERROR", "%s: %v\nStack trace:\n%s", message, err, stack)
	}
}

// log formats and outputs the log message
func (l *Logger) log(level, format string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	message := fmt.Sprintf(format, args...)

	// Get caller information
	_, file, line, _ := runtime.Caller(3)
	// Extract just the filename
	parts := strings.Split(file, "/")
	filename := parts[len(parts)-1]

	log.Printf("[%s] [%s] [%s] %s:%d - %s", timestamp, level, l.prefix, filename, line, message)
}

// getStackTrace returns the current stack trace
func (l *Logger) getStackTrace() string {
	buf := make([]byte, 4096)
	n := runtime.Stack(buf, false)
	return string(buf[:n])
}

// LogHTTPRequest logs details of an HTTP request
func (l *Logger) LogHTTPRequest(r *http.Request, includeBody bool) {
	if l.level > DEBUG {
		return
	}

	// Basic request info
	l.Debug("HTTP Request: %s %s", r.Method, r.URL.String())

	// Headers
	headers := make(map[string]string)
	for k, v := range r.Header {
		// Skip sensitive headers in logs
		if k == "Authorization" || k == "Cookie" {
			headers[k] = "[REDACTED]"
		} else {
			headers[k] = strings.Join(v, ", ")
		}
	}

	headerJSON, _ := json.MarshalIndent(headers, "", "  ")
	l.Debug("Request Headers:\n%s", string(headerJSON))

	// Body
	if includeBody && r.Body != nil {
		body, err := io.ReadAll(r.Body)
		if err == nil {
			r.Body = io.NopCloser(bytes.NewReader(body))

			// Try to parse as JSON for pretty printing
			var jsonBody interface{}
			if err := json.Unmarshal(body, &jsonBody); err == nil {
				prettyBody, _ := json.MarshalIndent(jsonBody, "", "  ")
				l.Debug("Request Body:\n%s", string(prettyBody))
			} else {
				l.Debug("Request Body:\n%s", string(body))
			}
		}
	}
}

// LogHTTPResponse logs details of an HTTP response
func (l *Logger) LogHTTPResponse(resp *http.Response, duration time.Duration, includeBody bool) {
	if l.level > DEBUG {
		return
	}

	// Basic response info
	l.Debug("HTTP Response: %d %s (Duration: %v)", resp.StatusCode, resp.Status, duration)

	// Headers
	headers := make(map[string]string)
	for k, v := range resp.Header {
		headers[k] = strings.Join(v, ", ")
	}

	headerJSON, _ := json.MarshalIndent(headers, "", "  ")
	l.Debug("Response Headers:\n%s", string(headerJSON))

	// Body
	if includeBody && resp.Body != nil {
		body, err := io.ReadAll(resp.Body)
		if err == nil {
			resp.Body = io.NopCloser(bytes.NewReader(body))

			// Try to parse as JSON for pretty printing
			var jsonBody interface{}
			if err := json.Unmarshal(body, &jsonBody); err == nil {
				prettyBody, _ := json.MarshalIndent(jsonBody, "", "  ")
				l.Debug("Response Body:\n%s", string(prettyBody))
			} else {
				// Limit body size in logs
				bodyStr := string(body)
				if len(bodyStr) > 1000 {
					bodyStr = bodyStr[:1000] + "... (truncated)"
				}
				l.Debug("Response Body:\n%s", bodyStr)
			}
		}
	}
}

// HTTPMiddleware creates a middleware that logs HTTP requests and responses
func HTTPLoggingMiddleware(logger *Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Log request
			logger.LogHTTPRequest(r, true)

			// Create a response writer wrapper to capture status code
			wrapped := &responseWriter{
				ResponseWriter: w,
				statusCode:     http.StatusOK,
			}

			// Call the next handler
			next.ServeHTTP(wrapped, r)

			// Log response info
			duration := time.Since(start)
			logger.Info("HTTP %s %s - %d (%v)", r.Method, r.URL.Path, wrapped.statusCode, duration)
		})
	}
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

// DumpRequest returns a string representation of an HTTP request
func DumpRequest(r *http.Request) string {
	dump, err := httputil.DumpRequest(r, true)
	if err != nil {
		return fmt.Sprintf("Error dumping request: %v", err)
	}
	return string(dump)
}

// DumpResponse returns a string representation of an HTTP response
func DumpResponse(resp *http.Response) string {
	dump, err := httputil.DumpResponse(resp, true)
	if err != nil {
		return fmt.Sprintf("Error dumping response: %v", err)
	}
	return string(dump)
}
