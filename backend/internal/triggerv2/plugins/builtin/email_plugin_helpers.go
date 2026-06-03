package builtin

import (
	"fmt"
	"strings"

	mainModels "mailman/internal/models"
	"mailman/internal/triggerv2/models"
)

type emailAttachmentSummary struct {
	Filename    string
	MIMEType    string
	ContentType string
	Size        int64
}

func eventEmailData(event *models.Event) models.EmailEventData {
	var data models.EmailEventData
	if event != nil {
		_ = event.GetData(&data)
	}
	return data
}

func eventEmailHeaders(event *models.Event) map[string]string {
	headers := make(map[string]string)
	data := eventEmailData(event)

	if data.Subject != "" {
		headers["subject"] = data.Subject
	}
	if data.From != "" {
		headers["from"] = data.From
	}
	if data.To != "" {
		headers["to"] = data.To
	}
	if data.MessageID != "" {
		headers["message-id"] = data.MessageID
	}

	if data.Email != nil {
		addStandardEmailHeaders(headers, data.Email)
		for key, value := range data.Email.Headers {
			headers[strings.ToLower(key)] = value
		}
	}

	var raw map[string]interface{}
	if event != nil && event.GetData(&raw) == nil {
		mergeHeaderObject(headers, raw["Headers"])
		mergeHeaderObject(headers, raw["headers"])
		if emailObj, ok := raw["Email"].(map[string]interface{}); ok {
			mergeHeaderObject(headers, emailObj["Headers"])
			mergeHeaderObject(headers, emailObj["headers"])
		}
		if emailObj, ok := raw["email"].(map[string]interface{}); ok {
			mergeHeaderObject(headers, emailObj["Headers"])
			mergeHeaderObject(headers, emailObj["headers"])
		}
	}

	return headers
}

func addStandardEmailHeaders(headers map[string]string, email *mainModels.Email) {
	if email.Subject != "" {
		headers["subject"] = email.Subject
	}
	if len(email.From) > 0 {
		headers["from"] = email.From[0]
	}
	if len(email.To) > 0 {
		headers["to"] = strings.Join(email.To, ", ")
	}
	if len(email.Cc) > 0 {
		headers["cc"] = strings.Join(email.Cc, ", ")
	}
	if email.MessageID != "" {
		headers["message-id"] = email.MessageID
	}
	if email.InReplyTo != "" {
		headers["in-reply-to"] = email.InReplyTo
	}
	if len(email.References) > 0 {
		headers["references"] = strings.Join(email.References, " ")
	}
}

func mergeHeaderObject(headers map[string]string, value interface{}) {
	switch h := value.(type) {
	case map[string]string:
		for key, item := range h {
			headers[strings.ToLower(key)] = item
		}
	case map[string]interface{}:
		for key, item := range h {
			headers[strings.ToLower(key)] = fmt.Sprintf("%v", item)
		}
	}
}

func eventEmailText(event *models.Event) (subject string, body string) {
	data := eventEmailData(event)
	subject = data.Subject
	if data.Email != nil {
		if subject == "" {
			subject = data.Email.Subject
		}
		body = data.Email.TextBody
		if body == "" {
			body = data.Email.Body
		}
		if body == "" {
			body = data.Email.HTMLBody
		}
	}

	var raw map[string]interface{}
	if event != nil && event.GetData(&raw) == nil {
		if subject == "" {
			subject = firstString(raw, "Subject", "subject")
		}
		body = firstNonEmpty(body, firstString(raw, "TextBody", "textBody", "Body", "body", "HTMLBody", "htmlBody"))
		if emailObj, ok := raw["Email"].(map[string]interface{}); ok {
			if subject == "" {
				subject = firstString(emailObj, "Subject", "subject")
			}
			body = firstNonEmpty(body, firstString(emailObj, "TextBody", "textBody", "Body", "body", "HTMLBody", "htmlBody"))
		}
		if emailObj, ok := raw["email"].(map[string]interface{}); ok {
			if subject == "" {
				subject = firstString(emailObj, "Subject", "subject")
			}
			body = firstNonEmpty(body, firstString(emailObj, "TextBody", "textBody", "Body", "body", "HTMLBody", "htmlBody"))
		}
	}

	return subject, body
}

func eventEmailAttachments(event *models.Event) []emailAttachmentSummary {
	data := eventEmailData(event)
	if data.Email != nil && len(data.Email.Attachments) > 0 {
		result := make([]emailAttachmentSummary, 0, len(data.Email.Attachments))
		for _, attachment := range data.Email.Attachments {
			result = append(result, emailAttachmentSummary{
				Filename:    attachment.Filename,
				MIMEType:    attachment.MIMEType,
				ContentType: attachment.ContentType,
				Size:        attachment.Size,
			})
		}
		return result
	}

	var raw map[string]interface{}
	if event != nil && event.GetData(&raw) == nil {
		if result := attachmentsFromRaw(raw["Attachments"]); len(result) > 0 {
			return result
		}
		if emailObj, ok := raw["Email"].(map[string]interface{}); ok {
			if result := attachmentsFromRaw(emailObj["Attachments"]); len(result) > 0 {
				return result
			}
		}
		if emailObj, ok := raw["email"].(map[string]interface{}); ok {
			if result := attachmentsFromRaw(emailObj["Attachments"]); len(result) > 0 {
				return result
			}
		}
	}

	if data.HasAttachment {
		return []emailAttachmentSummary{{Filename: "unknown", Size: 0}}
	}
	return nil
}

func attachmentsFromRaw(value interface{}) []emailAttachmentSummary {
	items, ok := value.([]interface{})
	if !ok {
		return nil
	}
	result := make([]emailAttachmentSummary, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		result = append(result, emailAttachmentSummary{
			Filename:    firstString(m, "Filename", "filename", "Name", "name"),
			MIMEType:    firstString(m, "MIMEType", "mimeType", "mime_type"),
			ContentType: firstString(m, "ContentType", "contentType", "content_type"),
			Size:        int64FromAny(m["Size"]),
		})
	}
	return result
}

func firstString(m map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key]; ok {
			if s, ok := value.(string); ok {
				return s
			}
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func int64FromAny(value interface{}) int64 {
	switch v := value.(type) {
	case int:
		return int64(v)
	case int64:
		return v
	case float64:
		return int64(v)
	case float32:
		return int64(v)
	case string:
		var parsed int64
		_, _ = fmt.Sscanf(v, "%d", &parsed)
		return parsed
	default:
		return 0
	}
}

func stringListFromConfig(value interface{}) []string {
	switch v := value.(type) {
	case []string:
		return compactStrings(v)
	case []interface{}:
		result := make([]string, 0, len(v))
		for _, item := range v {
			if str, ok := item.(string); ok {
				result = append(result, str)
			}
		}
		return compactStrings(result)
	case string:
		parts := strings.FieldsFunc(v, func(r rune) bool {
			return r == ',' || r == ';' || r == '\n'
		})
		return compactStrings(parts)
	default:
		return nil
	}
}

func compactStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
