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

// StreamOpenAI calls an OpenAI-compatible chat completion endpoint with stream=true
// and invokes onDelta for every content delta received from upstream SSE.
func (s *OpenAIService) StreamOpenAI(messages []Message, maxTokens int, temperature float64, onDelta func(string) error) error {
	if s.Config == nil || s.Config.APIKey == "" {
		return fmt.Errorf("OpenAI configuration is not set or API key is missing")
	}

	reqBody := ChatCompletionRequest{
		Model:       s.Config.Model,
		Messages:    messages,
		Temperature: temperature,
		MaxTokens:   maxTokens,
		Stream:      true,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/chat/completions", strings.TrimSuffix(s.Config.BaseURL, "/")), bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.Config.APIKey))

	for key, value := range s.Config.Headers {
		req.Header.Set(key, value)
	}

	resp, err := s.Client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return fmt.Errorf("OpenAI API error: status %d", resp.StatusCode)
		}

		var errorResp map[string]interface{}
		if err := json.Unmarshal(body, &errorResp); err == nil {
			if errorMsg, ok := errorResp["error"].(map[string]interface{}); ok {
				return fmt.Errorf("OpenAI API error: %v", errorMsg["message"])
			}
		}
		return fmt.Errorf("OpenAI API error: status %d, body: %s", resp.StatusCode, string(body))
	}

	if !IsStreamResponse(resp) {
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("failed to read non-stream response: %w", err)
		}
		completionResp, err := HandleAPIResponseWithFormat(body, ResponseFormatOpenAI)
		if err != nil {
			return err
		}
		if len(completionResp.Choices) > 0 {
			return onDelta(completionResp.Choices[0].Message.Content)
		}
		return nil
	}

	processLine := func(line string) (bool, error) {
		line = strings.TrimSpace(line)
		if line == "" {
			return false, nil
		}

		data := line
		if strings.HasPrefix(data, "data:") {
			data = strings.TrimSpace(strings.TrimPrefix(data, "data:"))
		}

		if data == "[DONE]" {
			return true, nil
		}

		var chunk StreamResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return false, nil
		}

		for _, choice := range chunk.Choices {
			if choice.Delta.Content == "" {
				continue
			}
			if err := onDelta(choice.Delta.Content); err != nil {
				return false, err
			}
		}

		return false, nil
	}

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil && err != io.EOF {
			return fmt.Errorf("error reading stream: %w", err)
		}

		done, processErr := processLine(line)
		if processErr != nil {
			return processErr
		}
		if done || err == io.EOF {
			return nil
		}
	}
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
