package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mailman/internal/models"
	"net/http"
	"strings"
	"time"
)

const defaultAIProviderTimeout = 600 * time.Second

// AIProvider defines the interface for AI providers
type AIProvider interface {
	CallAI(messages []Message, maxTokens int, temperature float64) (*ChatCompletionResponse, error)
	GenerateEmailTemplate(systemPrompt, userInput string, maxTokens int, temperature float64) (*ChatCompletionResponse, error)
}

// AIStreamProvider is implemented by providers that support token streaming.
type AIStreamProvider interface {
	StreamAI(messages []Message, maxTokens int, temperature float64, onDelta func(string) error) error
}

// BaseAIService contains common functionality for AI services
type BaseAIService struct {
	Config *models.OpenAIConfig
	Client *http.Client
}

// NewAIProvider creates the appropriate AI provider based on channel type
func NewAIProvider(config *models.OpenAIConfig) AIProvider {
	base := &BaseAIService{
		Config: config,
		Client: &http.Client{
			Timeout: defaultAIProviderTimeout,
		},
	}

	switch config.ChannelType {
	case models.AIChannelGemini:
		return &GeminiService{BaseAIService: base}
	case models.AIChannelClaude:
		return &ClaudeService{BaseAIService: base}
	default:
		return &OpenAIService{BaseAIService: base}
	}
}

// GeminiService implements Gemini API
type GeminiService struct {
	*BaseAIService
}

// GeminiRequest represents the Gemini API request format
type GeminiRequest struct {
	Contents         []GeminiContent         `json:"contents"`
	GenerationConfig *GeminiGenerationConfig `json:"generationConfig,omitempty"`
}

// GeminiContent represents content in Gemini format
type GeminiContent struct {
	Role  string       `json:"role"`
	Parts []GeminiPart `json:"parts"`
}

// GeminiPart represents a part of content
type GeminiPart struct {
	Text string `json:"text"`
}

// GeminiGenerationConfig represents generation configuration
type GeminiGenerationConfig struct {
	Temperature     float64 `json:"temperature,omitempty"`
	MaxOutputTokens int     `json:"maxOutputTokens,omitempty"`
}

// GeminiResponse represents the Gemini API response
type GeminiResponse struct {
	Candidates []GeminiCandidate `json:"candidates"`
}

// GeminiCandidate represents a response candidate
type GeminiCandidate struct {
	Content GeminiContent `json:"content"`
}

// CallAI implements the Gemini API call
func (g *GeminiService) CallAI(messages []Message, maxTokens int, temperature float64) (*ChatCompletionResponse, error) {
	// Convert messages to Gemini format
	contents := make([]GeminiContent, 0, len(messages))
	for _, msg := range messages {
		role := msg.Role
		if role == "system" {
			role = "user" // Gemini doesn't have system role, convert to user
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

	// Make API call
	url := fmt.Sprintf("%s/models/%s:generateContent?key=%s",
		strings.TrimSuffix(g.Config.BaseURL, "/"),
		g.Config.Model,
		g.Config.APIKey)

	jsonData, err := json.Marshal(geminiReq)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	for k, v := range g.Config.Headers {
		req.Header.Set(k, v)
	}

	resp, err := g.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Gemini API error: %s", string(body))
	}

	var geminiResp GeminiResponse
	if err := json.Unmarshal(body, &geminiResp); err != nil {
		return nil, err
	}

	// Convert to OpenAI format
	if len(geminiResp.Candidates) == 0 {
		return nil, fmt.Errorf("no response from Gemini")
	}

	content := ""
	if len(geminiResp.Candidates[0].Content.Parts) > 0 {
		content = geminiResp.Candidates[0].Content.Parts[0].Text
	}

	return &ChatCompletionResponse{
		Model: g.Config.Model,
		Choices: []struct {
			Index   int `json:"index"`
			Message struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		}{{
			Message: struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			}{
				Role:    "assistant",
				Content: content,
			},
		}},
		Usage: struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		}{
			TotalTokens: maxTokens, // Gemini doesn't return token usage
		},
	}, nil
}

// GenerateEmailTemplate implements email template generation for Gemini
func (g *GeminiService) GenerateEmailTemplate(systemPrompt, userInput string, maxTokens int, temperature float64) (*ChatCompletionResponse, error) {
	messages := []Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userInput},
	}
	return g.CallAI(messages, maxTokens, temperature)
}

// ClaudeService implements Claude API
type ClaudeService struct {
	*BaseAIService
}

// ClaudeRequest represents the Claude API request format
type ClaudeRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	MaxTokens   int       `json:"max_tokens"`
	Temperature float64   `json:"temperature"`
	System      string    `json:"system,omitempty"`
	Stream      bool      `json:"stream,omitempty"`
}

// ClaudeResponse represents the Claude API response
type ClaudeResponse struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Role    string          `json:"role"`
	Content []ClaudeContent `json:"content"`
	Model   string          `json:"model"`
	Usage   ClaudeUsage     `json:"usage"`
}

// ClaudeContent represents content in Claude format
type ClaudeContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// ClaudeUsage represents token usage
type ClaudeUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

// CallAI implements the Claude API call
func (c *ClaudeService) CallAI(messages []Message, maxTokens int, temperature float64) (*ChatCompletionResponse, error) {
	// Extract system message if present
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
	}

	// Make API call
	url := fmt.Sprintf("%s/messages", strings.TrimSuffix(c.Config.BaseURL, "/"))

	jsonData, err := json.Marshal(claudeReq)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.Config.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	for k, v := range c.Config.Headers {
		req.Header.Set(k, v)
	}

	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Claude API error: %s", string(body))
	}

	var claudeResp ClaudeResponse
	if err := json.Unmarshal(body, &claudeResp); err != nil {
		return nil, err
	}

	// Convert to OpenAI format
	content := ""
	if len(claudeResp.Content) > 0 {
		content = claudeResp.Content[0].Text
	}

	return &ChatCompletionResponse{
		Model: c.Config.Model,
		Choices: []struct {
			Index   int `json:"index"`
			Message struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		}{{
			Message: struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			}{
				Role:    "assistant",
				Content: content,
			},
		}},
		Usage: struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		}{
			TotalTokens: claudeResp.Usage.InputTokens + claudeResp.Usage.OutputTokens,
		},
	}, nil
}

// GenerateEmailTemplate implements email template generation for Claude
func (c *ClaudeService) GenerateEmailTemplate(systemPrompt, userInput string, maxTokens int, temperature float64) (*ChatCompletionResponse, error) {
	messages := []Message{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userInput},
	}
	return c.CallAI(messages, maxTokens, temperature)
}
