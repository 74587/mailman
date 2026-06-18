package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"mailman/internal/models"
	"mailman/internal/services"
	"mailman/internal/utils"
)

var businessLogMiddlewareLogger = utils.NewLogger("BusinessLogAudit")

const businessLogBodyCaptureLimit = 64 * 1024
const businessLogAuditTimeout = 2 * time.Second

func BusinessLogAuditMiddleware(pipeline *services.BusinessLogPipeline) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if pipeline == nil || !shouldAuditHTTPMethod(r.Method) {
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			requestBodyCapture := startBusinessLogRequestBodyCapture(r)
			wrapped := &loggingResponseWriter{
				ResponseWriter: w,
				statusCode:     http.StatusOK,
				bodyLimit:      businessLogBodyCaptureLimit,
			}
			next.ServeHTTP(wrapped, r)

			module, action, entityType, entityID := classifyBusinessHTTPRequest(r)
			user := GetCurrentUser(r)
			var userID *uint
			actorName := ""
			if user != nil {
				userID = &user.ID
				actorName = user.Username
				if actorName == "" {
					actorName = user.Email
				}
			}
			finishedAt := time.Now()
			status := models.BusinessLogStatusSuccess
			if wrapped.statusCode >= 500 {
				status = models.BusinessLogStatusFailed
			} else if wrapped.statusCode >= 400 {
				status = models.BusinessLogStatusPartial
			}

			durationMS := finishedAt.Sub(start).Milliseconds()
			requestContentType := r.Header.Get("Content-Type")
			responseContentType := wrapped.Header().Get("Content-Type")
			requestBody := requestBodyCapture.Snapshot(requestContentType)
			details := map[string]interface{}{
				"method":       r.Method,
				"path":         r.URL.Path,
				"query":        r.URL.RawQuery,
				"status_code":  wrapped.statusCode,
				"content_type": requestContentType,
				"latency_ms":   durationMS,
				"ip":           clientIP(r),
				"http": map[string]interface{}{
					"request":  buildBusinessLogHTTPRequestDetails(r, requestBody),
					"response": buildBusinessLogHTTPResponseDetails(wrapped, responseContentType),
				},
			}

			event := services.BusinessLogEvent{
				OrgID:         GetCurrentOrgID(r),
				UserID:        userID,
				OperationType: models.BusinessLogOperationAPI,
				ActorType:     models.BusinessLogActorUser,
				ActorName:     actorName,
				Module:        module,
				Action:        action,
				EntityType:    entityType,
				EntityID:      entityID,
				Title:         fmt.Sprintf("%s %s", r.Method, r.URL.Path),
				Summary:       fmt.Sprintf("HTTP %s %s -> %d", r.Method, r.URL.Path, wrapped.statusCode),
				Status:        status,
				Result:        http.StatusText(wrapped.statusCode),
				StartedAt:     start,
				FinishedAt:    &finishedAt,
				DurationMS:    durationMS,
				TraceID:       r.Header.Get("X-Trace-ID"),
				RequestID:     r.Header.Get("X-Request-ID"),
				Details:       details,
				SourceIP:      clientIP(r),
				UserAgent:     r.UserAgent(),
			}
			processBusinessLogAuditAsync(pipeline, event)
		})
	}
}

func processBusinessLogAuditAsync(pipeline *services.BusinessLogPipeline, event services.BusinessLogEvent) {
	if pipeline == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), businessLogAuditTimeout)
		defer cancel()
		result := pipeline.Process(ctx, event)
		if !result.Allowed {
			// Generic HTTP audit is post-action; explicit business call sites should
			// use the returned decision before mutating state when they need gating.
			businessLogMiddlewareLogger.Warn("Business log pipeline returned %s after HTTP action: %s", result.Decision, result.Reason)
		}
		if len(result.Warnings) > 0 {
			businessLogMiddlewareLogger.Warn("Business log audit completed with warnings: %s", strings.Join(result.Warnings, "; "))
		}
	}()
}

type businessLogBodySnapshot struct {
	Body          interface{}
	Truncated     bool
	Captured      bool
	OmittedReason string
	ContentLength int64
}

type businessLogRequestBodyCapture struct {
	contentLength int64
	omittedReason string
	reader        *businessLogCaptureReadCloser
}

type businessLogCaptureReadCloser struct {
	io.ReadCloser
	body      bytes.Buffer
	limit     int
	truncated bool
}

func startBusinessLogRequestBodyCapture(r *http.Request) *businessLogRequestBodyCapture {
	capture := &businessLogRequestBodyCapture{contentLength: r.ContentLength}
	if r.Body == nil || r.Body == http.NoBody {
		return capture
	}
	contentType := r.Header.Get("Content-Type")
	if !isBusinessLogTextualHTTPBody(contentType) {
		capture.omittedReason = "non-text body"
		return capture
	}

	reader := &businessLogCaptureReadCloser{
		ReadCloser: r.Body,
		limit:      businessLogBodyCaptureLimit,
	}
	capture.reader = reader
	r.Body = reader
	return capture
}

func (c *businessLogRequestBodyCapture) Snapshot(contentType string) businessLogBodySnapshot {
	if c == nil {
		return businessLogBodySnapshot{}
	}
	snapshot := businessLogBodySnapshot{
		ContentLength: c.contentLength,
		OmittedReason: c.omittedReason,
	}
	if c.reader == nil || c.omittedReason != "" {
		return snapshot
	}
	snapshot = buildBusinessLogBodySnapshot(contentType, c.reader.body.Bytes(), c.reader.truncated)
	snapshot.ContentLength = c.contentLength
	return snapshot
}

func (r *businessLogCaptureReadCloser) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	if n <= 0 || r.limit <= 0 {
		return n, err
	}
	remaining := r.limit - r.body.Len()
	if remaining > 0 {
		if n > remaining {
			r.body.Write(p[:remaining])
			r.truncated = true
		} else {
			r.body.Write(p[:n])
		}
	} else {
		r.truncated = true
	}
	return n, err
}

func buildBusinessLogHTTPRequestDetails(r *http.Request, body businessLogBodySnapshot) map[string]interface{} {
	details := map[string]interface{}{
		"method":         r.Method,
		"url":            businessLogRequestURL(r),
		"path":           r.URL.Path,
		"query":          r.URL.RawQuery,
		"headers":        businessLogHeaderMap(r.Header),
		"content_type":   r.Header.Get("Content-Type"),
		"content_length": body.ContentLength,
		"remote_addr":    r.RemoteAddr,
	}
	addBusinessLogBodyFields(details, body)
	return details
}

func buildBusinessLogHTTPResponseDetails(wrapped *loggingResponseWriter, contentType string) map[string]interface{} {
	body := buildBusinessLogBodySnapshot(contentType, wrapped.body.Bytes(), wrapped.bodyTruncated)
	details := map[string]interface{}{
		"status_code":    wrapped.statusCode,
		"status_text":    http.StatusText(wrapped.statusCode),
		"headers":        businessLogHeaderMap(wrapped.Header()),
		"content_type":   contentType,
		"body_truncated": wrapped.bodyTruncated,
	}
	addBusinessLogBodyFields(details, body)
	return details
}

func buildBusinessLogBodySnapshot(contentType string, body []byte, truncated bool) businessLogBodySnapshot {
	snapshot := businessLogBodySnapshot{
		ContentLength: int64(len(body)),
		Truncated:     truncated,
	}
	if len(body) == 0 {
		return snapshot
	}
	if truncated && isBusinessLogJSONHTTPBody(contentType) {
		snapshot.OmittedReason = fmt.Sprintf("body exceeds %d bytes", businessLogBodyCaptureLimit)
		return snapshot
	}
	if !isBusinessLogTextualHTTPBody(contentType) && !utf8.Valid(body) {
		snapshot.OmittedReason = "non-text body"
		return snapshot
	}
	snapshot.Body = businessLogBodyValue(contentType, body)
	snapshot.Captured = true
	return snapshot
}

func businessLogBodyValue(contentType string, body []byte) interface{} {
	if isBusinessLogJSONHTTPBody(contentType) {
		var parsed interface{}
		if err := json.Unmarshal(body, &parsed); err == nil {
			return parsed
		}
	}
	return string(body)
}

func addBusinessLogBodyFields(details map[string]interface{}, body businessLogBodySnapshot) {
	details["body_truncated"] = body.Truncated
	if body.Captured {
		details["body"] = body.Body
	}
	if body.OmittedReason != "" {
		details["body_omitted_reason"] = body.OmittedReason
	}
}

func businessLogHeaderMap(header http.Header) map[string]interface{} {
	result := make(map[string]interface{}, len(header))
	for key, values := range header {
		copied := append([]string(nil), values...)
		result[key] = copied
	}
	return result
}

func businessLogRequestURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if forwardedProto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); forwardedProto != "" {
		if comma := strings.Index(forwardedProto, ","); comma >= 0 {
			forwardedProto = strings.TrimSpace(forwardedProto[:comma])
		}
		scheme = forwardedProto
	}
	host := r.Host
	if forwardedHost := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwardedHost != "" {
		if comma := strings.Index(forwardedHost, ","); comma >= 0 {
			forwardedHost = strings.TrimSpace(forwardedHost[:comma])
		}
		host = forwardedHost
	}
	if host == "" {
		host = r.URL.Host
	}
	if host == "" {
		return r.URL.RequestURI()
	}
	return scheme + "://" + host + r.URL.RequestURI()
}

func isBusinessLogTextualHTTPBody(contentType string) bool {
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	if mediaType == "" {
		return true
	}
	if strings.HasPrefix(mediaType, "text/") {
		return true
	}
	switch mediaType {
	case "application/json",
		"application/x-json-stream",
		"application/x-ndjson",
		"application/xml",
		"application/graphql",
		"application/javascript",
		"application/x-www-form-urlencoded",
		"image/svg+xml":
		return true
	default:
		return strings.HasSuffix(mediaType, "+json") || strings.HasSuffix(mediaType, "+xml")
	}
}

func isBusinessLogJSONHTTPBody(contentType string) bool {
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	return mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
}

func shouldAuditHTTPMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func classifyBusinessHTTPRequest(r *http.Request) (module string, action string, entityType string, entityID string) {
	path := strings.Trim(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	if len(parts) > 0 && parts[0] == "api" {
		parts = parts[1:]
	}
	first := ""
	if len(parts) > 0 {
		first = parts[0]
	}
	module = "api"
	entityType = first
	if len(parts) > 1 {
		entityID = parts[1]
	}

	switch first {
	case "accounts", "account-emails":
		module = "email_account"
	case "business-modules", "business-accounts":
		module = "business"
	case "emails", "fetch-emails", "random-email", "wait-email", "check-email", "poll-email":
		module = "email"
	case "sync":
		module = "sync"
	case "triggers", "trigger-logs", "trigger-stats", "v2":
		module = "trigger"
	case "proxy-pool", "proxy-gateway":
		module = "proxy"
	case "wiki":
		module = "wiki"
	case "oauth2":
		module = "oauth2"
	case "system-config", "system-configs":
		module = "system_config"
	case "business-logs":
		module = "business_log"
	case "output-logs":
		module = "output_log"
	case "pickup":
		module = "pickup"
	}
	action = strings.ToLower(r.Method)
	if len(parts) > 2 {
		action = action + "_" + normalizePathToken(parts[len(parts)-1])
	}
	return module, action, entityType, entityID
}

func normalizePathToken(value string) string {
	value = strings.Trim(value, "{}")
	value = strings.ReplaceAll(value, "-", "_")
	return strings.ToLower(value)
}

func clientIP(r *http.Request) string {
	for _, header := range []string{"X-Forwarded-For", "X-Real-IP"} {
		value := strings.TrimSpace(r.Header.Get(header))
		if value == "" {
			continue
		}
		if comma := strings.Index(value, ","); comma >= 0 {
			value = strings.TrimSpace(value[:comma])
		}
		return value
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
