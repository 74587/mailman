package services

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"mailman/internal/models"
	"mime"
	"mime/multipart"
	"strings"

	"github.com/emersion/go-message"
	"github.com/emersion/go-message/mail"
)

// ParserService is responsible for parsing raw email content.
type ParserService struct{}

// NewParserService creates a new ParserService.
func NewParserService() *ParserService {
	return &ParserService{}
}

// ParseEmail parses a raw email and returns an Email struct.
func (s *ParserService) ParseEmail(rawEmail []byte) (*models.Email, error) {
	r := bytes.NewReader(rawEmail)
	m, err := mail.CreateReader(r)
	if err != nil {
		return nil, fmt.Errorf("failed to create mail reader: %w", err)
	}
	defer m.Close()

	header := m.Header

	email := &models.Email{}

	// 保存原始邮件报文
	email.RawMessage = string(rawEmail)

	// Parse basic headers
	if subject, err := header.Subject(); err == nil {
		email.Subject = subject
	}

	if date, err := header.Date(); err == nil {
		email.Date = date
	}

	if messageID, err := header.MessageID(); err == nil {
		email.MessageID = messageID
	}

	// Parse addresses
	if from, err := header.AddressList("From"); err == nil {
		email.From = convertMailAddresses(from)
	}

	if to, err := header.AddressList("To"); err == nil {
		email.To = convertMailAddresses(to)
	}

	if cc, err := header.AddressList("Cc"); err == nil {
		email.Cc = convertMailAddresses(cc)
	}

	if bcc, err := header.AddressList("Bcc"); err == nil {
		email.Bcc = convertMailAddresses(bcc)
	}

	// Parse body and attachments
	var textBody, htmlBody strings.Builder
	var attachments []models.Attachment

	for {
		p, err := m.NextPart()
		if err == io.EOF {
			break
		} else if err != nil {
			return nil, fmt.Errorf("failed to read part: %w", err)
		}

		switch h := p.Header.(type) {
		case *mail.InlineHeader:
			// This is the message body
			contentType, _, _ := h.ContentType()
			b, err := io.ReadAll(p.Body)
			if err != nil {
				continue
			}

			switch contentType {
			case "text/plain":
				textBody.Write(b)
			case "text/html":
				htmlBody.Write(b)
			}

		case *mail.AttachmentHeader:
			// This is an attachment
			filename, _ := h.Filename()
			contentType, _, _ := h.ContentType()

			b, err := io.ReadAll(p.Body)
			if err != nil {
				continue
			}

			attachment := models.Attachment{
				Filename: filename,
				Content:  b,
				MIMEType: contentType,
				Size:     int64(len(b)),
			}
			attachments = append(attachments, attachment)
		}
	}

	email.Body = textBody.String()
	email.HTMLBody = htmlBody.String()
	email.Attachments = attachments
	email.HasAttachments = len(attachments) > 0

	return email, nil
}

// ParseMultipartEmail parses a multipart email
func (s *ParserService) ParseMultipartEmail(header message.Header, body io.Reader) (*models.Email, error) {
	email := &models.Email{}

	// Get content type and boundary
	contentType := header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, fmt.Errorf("failed to parse media type: %w", err)
	}

	if !strings.HasPrefix(mediaType, "multipart/") {
		// Not a multipart message
		b, err := io.ReadAll(body)
		if err != nil {
			return nil, err
		}

		if mediaType == "text/plain" {
			email.Body = string(b)
		} else if mediaType == "text/html" {
			email.HTMLBody = string(b)
		}
		return email, nil
	}

	// Parse multipart
	mr := multipart.NewReader(body, params["boundary"])
	var textBody, htmlBody strings.Builder
	var attachments []models.Attachment

	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		} else if err != nil {
			return nil, fmt.Errorf("failed to read multipart: %w", err)
		}

		contentType := part.Header.Get("Content-Type")
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil {
			mediaType = "application/octet-stream"
		}

		// Check if it's an attachment
		disposition := part.Header.Get("Content-Disposition")
		if strings.HasPrefix(disposition, "attachment") {
			filename := part.FileName()
			b, err := io.ReadAll(part)
			if err != nil {
				continue
			}

			// Decode if base64 encoded
			if part.Header.Get("Content-Transfer-Encoding") == "base64" {
				decoded, err := base64.StdEncoding.DecodeString(string(b))
				if err == nil {
					b = decoded
				}
			}

			attachment := models.Attachment{
				Filename: filename,
				Content:  b,
				MIMEType: mediaType,
				Size:     int64(len(b)),
			}
			attachments = append(attachments, attachment)
		} else {
			// It's part of the body
			b, err := io.ReadAll(part)
			if err != nil {
				continue
			}

			// Decode if base64 encoded
			if part.Header.Get("Content-Transfer-Encoding") == "base64" {
				decoded, err := base64.StdEncoding.DecodeString(string(b))
				if err == nil {
					b = decoded
				}
			}

			switch mediaType {
			case "text/plain":
				textBody.Write(b)
			case "text/html":
				htmlBody.Write(b)
			}
		}
	}

	email.Body = textBody.String()
	email.HTMLBody = htmlBody.String()
	email.Attachments = attachments
	email.HasAttachments = len(attachments) > 0

	return email, nil
}

// ExtractTextFromHTML extracts plain text from HTML content
func (s *ParserService) ExtractTextFromHTML(html string) string {
	// This is a simple implementation. In production, you might want to use
	// a proper HTML parser like golang.org/x/net/html
	// For now, we'll just strip HTML tags
	var result strings.Builder
	inTag := false

	for _, ch := range html {
		if ch == '<' {
			inTag = true
		} else if ch == '>' {
			inTag = false
			result.WriteRune(' ')
		} else if !inTag {
			result.WriteRune(ch)
		}
	}

	// Clean up extra whitespace
	text := result.String()
	text = strings.ReplaceAll(text, "\n\n\n", "\n\n")
	text = strings.ReplaceAll(text, "  ", " ")
	text = strings.TrimSpace(text)

	return text
}

// convertMailAddresses converts mail.Address to string slice
func convertMailAddresses(addresses []*mail.Address) models.StringSlice {
	var result models.StringSlice
	for _, addr := range addresses {
		if addr != nil {
			result = append(result, addr.String())
		}
	}
	return result
}
