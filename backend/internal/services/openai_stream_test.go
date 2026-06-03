package services

import (
	"encoding/json"
	"io"
	"mailman/internal/models"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestStreamOpenAIEmitsUpstreamDeltas(t *testing.T) {
	service := NewOpenAIService(&models.OpenAIConfig{
		BaseURL: "https://api.example.test/v1",
		APIKey:  "test-key",
		Model:   "gpt-test",
	})

	var requestErr error
	service.Client = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if req.URL.String() != "https://api.example.test/v1/chat/completions" {
				t.Fatalf("unexpected URL: %s", req.URL.String())
			}
			if req.Header.Get("Accept") != "text/event-stream" {
				t.Fatalf("expected text/event-stream accept header, got %q", req.Header.Get("Accept"))
			}

			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("failed to read request body: %v", err)
			}

			var payload ChatCompletionRequest
			if err := json.Unmarshal(body, &payload); err != nil {
				requestErr = err
			} else if !payload.Stream {
				requestErr = errExpectedStreamFlag
			}

			streamBody := strings.Join([]string{
				`data: {"choices":[{"delta":{"content":"Hello "}}]}`,
				``,
				`data: {"choices":[{"delta":{"content":"world"}}]}`,
			}, "\n")

			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(streamBody)),
			}
			resp.Header.Set("Content-Type", "text/event-stream")
			return resp, nil
		}),
	}

	var deltas []string
	err := service.StreamOpenAI([]Message{{Role: "user", Content: "Say hello"}}, 100, 0.2, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatalf("StreamOpenAI returned error: %v", err)
	}
	if requestErr != nil {
		t.Fatalf("request validation failed: %v", requestErr)
	}
	if len(deltas) != 2 {
		t.Fatalf("expected 2 deltas, got %d: %#v", len(deltas), deltas)
	}
	if got := strings.Join(deltas, ""); got != "Hello world" {
		t.Fatalf("unexpected streamed content: %q", got)
	}
}

func TestGeminiStreamAIEmitsUpstreamDeltas(t *testing.T) {
	service := &GeminiService{BaseAIService: &BaseAIService{
		Config: &models.OpenAIConfig{
			BaseURL: "https://generativelanguage.example.test/v1beta",
			APIKey:  "test-key",
			Model:   "gemini-test",
		},
		Client: &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if req.URL.Path != "/v1beta/models/gemini-test:streamGenerateContent" {
					t.Fatalf("unexpected Gemini stream path: %s", req.URL.Path)
				}
				if req.URL.Query().Get("alt") != "sse" {
					t.Fatalf("expected alt=sse, got %q", req.URL.Query().Get("alt"))
				}
				if req.URL.Query().Get("key") != "test-key" {
					t.Fatalf("expected API key query param")
				}

				streamBody := strings.Join([]string{
					`data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}`,
					``,
					`data: {"candidates":[{"content":{"parts":[{"text":"Gemini"}]}}]}`,
				}, "\n")

				resp := &http.Response{
					StatusCode: http.StatusOK,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(streamBody)),
				}
				resp.Header.Set("Content-Type", "text/event-stream")
				return resp, nil
			}),
		},
	}}

	var deltas []string
	err := service.StreamAI([]Message{{Role: "user", Content: "Say hello"}}, 100, 0.2, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatalf("StreamAI returned error: %v", err)
	}
	if len(deltas) != 2 {
		t.Fatalf("expected 2 deltas, got %d: %#v", len(deltas), deltas)
	}
	if got := strings.Join(deltas, ""); got != "Hello Gemini" {
		t.Fatalf("unexpected streamed content: %q", got)
	}
}

var errExpectedStreamFlag = expectedStreamFlagError{}

type expectedStreamFlagError struct{}

func (expectedStreamFlagError) Error() string {
	return "expected stream flag to be true"
}
