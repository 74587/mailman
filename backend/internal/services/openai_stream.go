package services

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// StreamResponse represents a single chunk in a streaming response
type StreamResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Content string `json:"content,omitempty"`
			Role    string `json:"role,omitempty"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

// HandleStreamResponse processes a streaming response from the API
func HandleStreamResponse(resp *http.Response) (*ChatCompletionResponse, error) {
	reader := bufio.NewReader(resp.Body)
	var fullContent strings.Builder
	var lastResponse *StreamResponse
	var responseID string
	var model string
	var created int64

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return nil, fmt.Errorf("error reading stream: %w", err)
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// SSE format: data: {...}
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")

			// Check for end of stream
			if data == "[DONE]" {
				break
			}

			// Parse the JSON chunk
			var chunk StreamResponse
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				// Skip invalid JSON chunks
				continue
			}

			// Store metadata from first chunk
			if responseID == "" {
				responseID = chunk.ID
				model = chunk.Model
				created = chunk.Created
			}

			// Accumulate content
			for _, choice := range chunk.Choices {
				if choice.Delta.Content != "" {
					fullContent.WriteString(choice.Delta.Content)
				}

				// Update last response for finish reason
				if choice.FinishReason != nil {
					lastResponse = &chunk
				}
			}
		}
	}

	// Convert stream response to standard response format
	response := &ChatCompletionResponse{
		ID:      responseID,
		Object:  "chat.completion",
		Created: created,
		Model:   model,
		Choices: []struct {
			Index   int `json:"index"`
			Message struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		}{
			{
				Index: 0,
				Message: struct {
					Role    string `json:"role"`
					Content string `json:"content"`
				}{
					Role:    "assistant",
					Content: fullContent.String(),
				},
				FinishReason: "stop",
			},
		},
	}

	// Use lastResponse to avoid unused variable warning
	_ = lastResponse

	return response, nil
}

// IsStreamResponse checks if the response is a streaming response
func IsStreamResponse(resp *http.Response) bool {
	contentType := resp.Header.Get("Content-Type")
	return strings.Contains(contentType, "text/event-stream") ||
		strings.Contains(contentType, "application/x-ndjson")
}

// HandleAPIResponse processes both streaming and non-streaming responses
func HandleAPIResponse(resp *http.Response, body []byte) (*ChatCompletionResponse, error) {
	// Check if it's a streaming response
	if IsStreamResponse(resp) {
		// For streaming responses, we need to re-read the body
		// since it might have been consumed
		resp.Body = io.NopCloser(bytes.NewReader(body))
		return HandleStreamResponse(resp)
	}

	// Use default OpenAI parser chain for backward compatibility
	return HandleAPIResponseWithFormat(body, ResponseFormatOpenAI)
}

// HandleAPIResponseWithFormat processes response with specified preferred format
func HandleAPIResponseWithFormat(body []byte, preferredFormat ResponseFormat) (*ChatCompletionResponse, error) {
	chain := NewResponseParserChain(preferredFormat)
	return chain.Parse(body)
}
