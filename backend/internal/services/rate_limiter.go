package services

import (
	"net/http"
	"sync"
	"time"

	gocache "github.com/patrickmn/go-cache"
)

// RateLimiter provides IP-based rate limiting using go-cache.
type RateLimiter struct {
	cache      *gocache.Cache
	mu         sync.Mutex
	maxAttempts int
	window      time.Duration
}

// NewRateLimiter creates a new rate limiter.
// maxAttempts: maximum number of requests allowed within the window.
// window: time window for rate limiting.
func NewRateLimiter(maxAttempts int, window time.Duration) *RateLimiter {
	// Cleanup expired items every 2x the window
	return &RateLimiter{
		cache:       gocache.New(window, window*2),
		maxAttempts: maxAttempts,
		window:      window,
	}
}

// Allow checks if the given key (typically an IP address) is allowed to make a request.
// Returns true if the request is allowed, false if rate limited.
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	val, found := rl.cache.Get(key)
	if !found {
		rl.cache.Set(key, 1, rl.window)
		return true
	}

	count := val.(int)
	if count >= rl.maxAttempts {
		return false
	}

	rl.cache.Set(key, count+1, rl.window)
	return true
}

// RateLimitMiddleware returns an HTTP middleware that applies rate limiting by IP address.
func (rl *RateLimiter) RateLimitMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := extractIP(r)
		if !rl.Allow(ip) {
			http.Error(w, "Too many requests. Please try again later.", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	}
}

// extractIP extracts the client IP from the request, handling X-Forwarded-For and X-Real-IP headers.
func extractIP(r *http.Request) string {
	// Check X-Forwarded-For header first (common with reverse proxies)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// X-Forwarded-For can contain multiple IPs; the first one is the client
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return xff[:i]
			}
		}
		return xff
	}

	// Check X-Real-IP header
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	// Fall back to RemoteAddr (strip port)
	addr := r.RemoteAddr
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i]
		}
	}
	return addr
}
