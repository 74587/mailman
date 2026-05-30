package localproxy

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProxyForwardsMethodPathQueryHeadersAndBody(t *testing.T) {
	var target *httptest.Server
	target = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}

		if r.Method != http.MethodPut {
			t.Fatalf("method = %s, want PUT", r.Method)
		}
		if r.URL.Path != "/api/oauth2/callback/gmail" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.URL.RawQuery != "code=abc&state=xyz" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		if string(body) != `{"ok":true}` {
			t.Fatalf("body = %s", body)
		}
		if r.Header.Get("X-Test") != "mailman" {
			t.Fatalf("X-Test header was not forwarded")
		}
		if r.Host != strings.TrimPrefix(target.URL, "http://") {
			t.Fatalf("host = %s, want target host", r.Host)
		}
		if r.Header.Get("X-Forwarded-Host") != "localhost:8080" {
			t.Fatalf("X-Forwarded-Host = %s", r.Header.Get("X-Forwarded-Host"))
		}

		w.Header().Set("X-Target", "ok")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("created"))
	}))
	defer target.Close()

	handler, err := NewHandler(Config{
		ListenIP:    "127.0.0.1",
		Port:        8080,
		Target:      target.URL,
		LogRequests: true,
		Timeout:     time.Second,
	}, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}

	req := httptest.NewRequest(http.MethodPut, "http://localhost:8080/api/oauth2/callback/gmail?code=abc&state=xyz", strings.NewReader(`{"ok":true}`))
	req.Header.Set("X-Test", "mailman")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", recorder.Code)
	}
	if recorder.Header().Get("X-Target") != "ok" {
		t.Fatalf("response header was not forwarded")
	}
	if recorder.Body.String() != "created" {
		t.Fatalf("response body = %s", recorder.Body.String())
	}
}

func TestProxyCombinesTargetBasePathAndQuery(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/base/api/oauth2/callback/gmail" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.URL.RawQuery != "from=target&code=abc" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer target.Close()

	handler, err := NewHandler(Config{
		ListenIP:    "127.0.0.1",
		Port:        8080,
		Target:      target.URL + "/base?from=target",
		LogRequests: false,
		Timeout:     time.Second,
	}, nil)
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/oauth2/callback/gmail?code=abc", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", recorder.Code)
	}
}

func TestParseTargetDefaultsBareDomainToHTTPS(t *testing.T) {
	target, err := ParseTarget("mailman.easycat.io")
	if err != nil {
		t.Fatalf("ParseTarget: %v", err)
	}
	if target.String() != "https://mailman.easycat.io" {
		t.Fatalf("target = %s", target.String())
	}
}
