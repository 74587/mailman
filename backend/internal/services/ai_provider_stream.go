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

func (s *OpenAIService) StreamAI(messages []Message, maxTokens int, temperature float64, onDelta func(string) error) error {
	return s.StreamOpenAI(messages, maxTokens, temperature, onDelta)
}

func (g *GeminiService) StreamAI(messages []Message, maxTokens int, temperature float64, onDelta func(string) error) error {
	contents := make([]GeminiContent, 0, len(messages))
	for _, msg := range messages {
		role := msg.Role
		if role == "system" {
			role = "user"
		}
		contents = append(contents, GeminiContent{
			Role:  role,
			Parts: []GeminiPart{{Text: msg.Content}},
		})
	}

	geminiReq := GeminiRequest{
		Contents: contents,
		GenerationConfig: &GeminiGenerationConfig{
			Temperature:     temperature,
			MaxOutputTokens: maxTokens,
		},
	}

	jsonData, err := json.Marshal(geminiReq)
	if err != nil {
		return fmt.Errorf("failed to marshal Gemini stream request: %w", err)
	}

	url := fmt.Sprintf("%s/models/%s:streamGenerateContent?alt=sse&key=%s",
		strings.TrimSuffix(g.Config.BaseURL, "/"),
		g.Config.Model,
		g.Config.APIKey)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create Gemini stream request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	for k, v := range g.Config.Headers {
		req.Header.Set(k, v)
	}

	resp, err := g.Client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send Gemini stream request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return fmt.Errorf("Gemini stream API error: status %d", resp.StatusCode)
		}
		return fmt.Errorf("Gemini stream API error: status %d, body: %s", resp.StatusCode, string(body))
	}

	return readSSEDataLines(resp.Body, func(data string) (bool, error) {
		var chunk GeminiResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return false, nil
		}

		for _, candidate := range chunk.Candidates {
			for _, part := range candidate.Content.Parts {
				if part.Text == "" {
					continue
				}
				if err := onDelta(part.Text); err != nil {
					return false, err
				}
			}
		}
		return false, nil
	})
}

func (c *ClaudeService) StreamAI(messages []Message, maxTokens int, temperature float64, onDelta func(string) error) error {
	var systemPrompt string
	var userMessages []Message

	for _, msg := range messages {
		if msg.Role == "system" {
			systemPrompt = msg.Content
		} else {
			userMessages = append(userMessages, msg)
		}
	}

	claudeReq := ClaudeRequest{
		Model:       c.Config.Model,
		Messages:    userMessages,
		MaxTokens:   maxTokens,
		Temperature: temperature,
		System:      systemPrompt,
		Stream:      true,
	}

	jsonData, err := json.Marshal(claudeReq)
	if err != nil {
		return fmt.Errorf("failed to marshal Claude stream request: %w", err)
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/messages", strings.TrimSuffix(c.Config.BaseURL, "/")), bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create Claude stream request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("x-api-key", c.Config.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	for k, v := range c.Config.Headers {
		req.Header.Set(k, v)
	}

	resp, err := c.Client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send Claude stream request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return fmt.Errorf("Claude stream API error: status %d", resp.StatusCode)
		}
		return fmt.Errorf("Claude stream API error: status %d, body: %s", resp.StatusCode, string(body))
	}

	type claudeStreamEvent struct {
		Type  string `json:"type"`
		Delta struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"delta"`
	}

	return readSSEDataLines(resp.Body, func(data string) (bool, error) {
		var event claudeStreamEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			return false, nil
		}

		if event.Type == "message_stop" {
			return true, nil
		}
		if event.Type == "content_block_delta" && event.Delta.Text != "" {
			if err := onDelta(event.Delta.Text); err != nil {
				return false, err
			}
		}
		return false, nil
	})
}

func readSSEDataLines(body io.Reader, onData func(string) (bool, error)) error {
	reader := bufio.NewReader(body)
	for {
		line, err := reader.ReadString('\n')
		if err != nil && err != io.EOF {
			return fmt.Errorf("error reading stream: %w", err)
		}

		line = strings.TrimSpace(line)
		if line != "" && strings.HasPrefix(line, "data:") {
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "[DONE]" {
				return nil
			}
			done, processErr := onData(data)
			if processErr != nil {
				return processErr
			}
			if done {
				return nil
			}
		}

		if err == io.EOF {
			return nil
		}
	}
}
