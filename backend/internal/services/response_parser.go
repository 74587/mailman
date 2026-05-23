package services

import (
	"encoding/json"
	"fmt"
	"mailman/internal/models"
)

// ResponseFormat 定义响应格式类型
type ResponseFormat string

const (
	ResponseFormatOpenAI  ResponseFormat = "openai"
	ResponseFormatGemini  ResponseFormat = "gemini"
	ResponseFormatClaude  ResponseFormat = "claude"
	ResponseFormatUnknown ResponseFormat = "unknown"
)

// ResponseParser 定义响应解析器接口
type ResponseParser interface {
	// Name 返回解析器名称
	Name() string
	// Format 返回响应格式类型
	Format() ResponseFormat
	// CanParse 检查是否可以解析该响应
	CanParse(body []byte) bool
	// Parse 解析响应内容
	Parse(body []byte) (*ChatCompletionResponse, error)
}

// OpenAIResponseParser OpenAI 响应格式解析器
type OpenAIResponseParser struct{}

func (p *OpenAIResponseParser) Name() string {
	return "OpenAI Parser"
}

func (p *OpenAIResponseParser) Format() ResponseFormat {
	return ResponseFormatOpenAI
}

func (p *OpenAIResponseParser) CanParse(body []byte) bool {
	var resp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return false
	}
	return len(resp.Choices) > 0 && resp.Choices[0].Message.Content != ""
}

func (p *OpenAIResponseParser) Parse(body []byte) (*ChatCompletionResponse, error) {
	var completionResp ChatCompletionResponse
	if err := json.Unmarshal(body, &completionResp); err != nil {
		return nil, fmt.Errorf("OpenAI parser: failed to parse: %w", err)
	}
	if len(completionResp.Choices) == 0 || completionResp.Choices[0].Message.Content == "" {
		return nil, fmt.Errorf("OpenAI parser: empty response content")
	}
	return &completionResp, nil
}

// GeminiResponseParser Gemini 响应格式解析器
type GeminiResponseParser struct{}

func (p *GeminiResponseParser) Name() string {
	return "Gemini Parser"
}

func (p *GeminiResponseParser) Format() ResponseFormat {
	return ResponseFormatGemini
}

func (p *GeminiResponseParser) CanParse(body []byte) bool {
	// 检查直接 Gemini 格式
	var resp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return false
	}
	return len(resp.Candidates) > 0 && len(resp.Candidates[0].Content.Parts) > 0 && resp.Candidates[0].Content.Parts[0].Text != ""
}

func (p *GeminiResponseParser) Parse(body []byte) (*ChatCompletionResponse, error) {
	var geminiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		ModelVersion string `json:"modelVersion"`
	}
	if err := json.Unmarshal(body, &geminiResp); err != nil {
		return nil, fmt.Errorf("Gemini parser: failed to parse: %w", err)
	}
	if len(geminiResp.Candidates) == 0 || len(geminiResp.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("Gemini parser: empty response content")
	}

	content := geminiResp.Candidates[0].Content.Parts[0].Text
	return convertToOpenAIFormat(content, geminiResp.ModelVersion), nil
}

// GeminiWrappedResponseParser Gemini 包装响应格式解析器 (适用于某些代理服务)
type GeminiWrappedResponseParser struct{}

func (p *GeminiWrappedResponseParser) Name() string {
	return "Gemini Wrapped Parser"
}

func (p *GeminiWrappedResponseParser) Format() ResponseFormat {
	return ResponseFormatGemini
}

func (p *GeminiWrappedResponseParser) CanParse(body []byte) bool {
	var resp struct {
		Response struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		} `json:"response"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return false
	}
	return len(resp.Response.Candidates) > 0 && len(resp.Response.Candidates[0].Content.Parts) > 0 && resp.Response.Candidates[0].Content.Parts[0].Text != ""
}

func (p *GeminiWrappedResponseParser) Parse(body []byte) (*ChatCompletionResponse, error) {
	var wrappedResp struct {
		Response struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
			ModelVersion string `json:"modelVersion"`
		} `json:"response"`
	}
	if err := json.Unmarshal(body, &wrappedResp); err != nil {
		return nil, fmt.Errorf("Gemini wrapped parser: failed to parse: %w", err)
	}
	if len(wrappedResp.Response.Candidates) == 0 || len(wrappedResp.Response.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("Gemini wrapped parser: empty response content")
	}

	content := wrappedResp.Response.Candidates[0].Content.Parts[0].Text
	return convertToOpenAIFormat(content, wrappedResp.Response.ModelVersion), nil
}

// ClaudeResponseParser Claude 响应格式解析器
type ClaudeResponseParser struct{}

func (p *ClaudeResponseParser) Name() string {
	return "Claude Parser"
}

func (p *ClaudeResponseParser) Format() ResponseFormat {
	return ResponseFormatClaude
}

func (p *ClaudeResponseParser) CanParse(body []byte) bool {
	var resp struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return false
	}
	return resp.Type == "message" && len(resp.Content) > 0 && resp.Content[0].Text != ""
}

func (p *ClaudeResponseParser) Parse(body []byte) (*ChatCompletionResponse, error) {
	var claudeResp struct {
		ID      string `json:"id"`
		Type    string `json:"type"`
		Role    string `json:"role"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Model string `json:"model"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &claudeResp); err != nil {
		return nil, fmt.Errorf("Claude parser: failed to parse: %w", err)
	}
	if len(claudeResp.Content) == 0 || claudeResp.Content[0].Text == "" {
		return nil, fmt.Errorf("Claude parser: empty response content")
	}

	content := claudeResp.Content[0].Text
	resp := convertToOpenAIFormat(content, claudeResp.Model)
	resp.Usage.TotalTokens = claudeResp.Usage.InputTokens + claudeResp.Usage.OutputTokens
	return resp, nil
}

// ResponseParserChain 响应解析器链
type ResponseParserChain struct {
	parsers []ResponseParser
}

// NewResponseParserChain 创建解析器链，根据指定的主格式确定解析顺序
func NewResponseParserChain(preferredFormat ResponseFormat) *ResponseParserChain {
	// 所有可用的解析器
	allParsers := []ResponseParser{
		&OpenAIResponseParser{},
		&GeminiResponseParser{},
		&GeminiWrappedResponseParser{},
		&ClaudeResponseParser{},
	}

	// 根据优先格式排序
	var orderedParsers []ResponseParser
	var othersFirst []ResponseParser
	var othersLast []ResponseParser

	for _, parser := range allParsers {
		if parser.Format() == preferredFormat {
			orderedParsers = append(orderedParsers, parser)
		} else {
			// 将同格式的变体放在前面
			if isRelatedFormat(parser.Format(), preferredFormat) {
				othersFirst = append(othersFirst, parser)
			} else {
				othersLast = append(othersLast, parser)
			}
		}
	}

	// 最终顺序: 主格式解析器 -> 相关格式解析器 -> 其他格式解析器
	orderedParsers = append(orderedParsers, othersFirst...)
	orderedParsers = append(orderedParsers, othersLast...)

	return &ResponseParserChain{parsers: orderedParsers}
}

// isRelatedFormat 检查两个格式是否相关
func isRelatedFormat(format1, format2 ResponseFormat) bool {
	// Gemini 和其包装格式是相关的
	if format1 == ResponseFormatGemini && format2 == ResponseFormatGemini {
		return true
	}
	return false
}

// Parse 尝试使用所有解析器解析响应
func (c *ResponseParserChain) Parse(body []byte) (*ChatCompletionResponse, error) {
	var lastError error

	for _, parser := range c.parsers {
		if parser.CanParse(body) {
			resp, err := parser.Parse(body)
			if err == nil {
				return resp, nil
			}
			lastError = err
		}
	}

	// 如果 CanParse 都失败了，尝试强制解析
	for _, parser := range c.parsers {
		resp, err := parser.Parse(body)
		if err == nil && resp != nil && len(resp.Choices) > 0 && resp.Choices[0].Message.Content != "" {
			return resp, nil
		}
		if lastError == nil {
			lastError = err
		}
	}

	if lastError != nil {
		return nil, fmt.Errorf("all parsers failed, last error: %w", lastError)
	}
	return nil, fmt.Errorf("no parser could handle the response")
}

// GetParserForChannelType 根据 channel type 获取对应的响应格式
func GetParserForChannelType(channelType models.AIChannelType) ResponseFormat {
	switch channelType {
	case models.AIChannelGemini:
		return ResponseFormatGemini
	case models.AIChannelClaude:
		return ResponseFormatClaude
	case models.AIChannelOpenAI:
		return ResponseFormatOpenAI
	default:
		return ResponseFormatOpenAI // 默认使用 OpenAI 格式
	}
}

// convertToOpenAIFormat 将内容转换为 OpenAI 格式的响应
func convertToOpenAIFormat(content, model string) *ChatCompletionResponse {
	return &ChatCompletionResponse{
		Model: model,
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
			FinishReason: "stop",
		}},
	}
}
