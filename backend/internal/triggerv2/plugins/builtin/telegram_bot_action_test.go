package builtin

import (
	"encoding/json"
	"testing"
)

func TestTelegramDeliveryMetadataIncludesDeliveryIdentifiers(t *testing.T) {
	response := &TelegramResponse{
		OK: true,
		Result: json.RawMessage(`{
			"message_id": 456,
			"message_thread_id": 789,
			"date": 1765859337,
			"chat": {
				"id": 7958080128,
				"type": "private",
				"username": "mailman_user"
			},
			"text": "do not persist notification body here"
		}`),
	}

	metadata := telegramDeliveryMetadata(response, 0)
	if metadata["message_id"] != float64(456) {
		t.Fatalf("message_id = %v, want 456", metadata["message_id"])
	}
	if metadata["message_thread_id"] != float64(789) {
		t.Fatalf("message_thread_id = %v, want 789", metadata["message_thread_id"])
	}
	if metadata["delivered_chat_id"] != float64(7958080128) {
		t.Fatalf("delivered_chat_id = %v, want 7958080128", metadata["delivered_chat_id"])
	}
	if _, ok := metadata["telegram_sent_at"]; !ok {
		t.Fatal("expected telegram_sent_at to be present")
	}
	if _, ok := metadata["text"]; ok {
		t.Fatal("did not expect notification body text in delivery metadata")
	}

	chat, ok := metadata["telegram_chat"].(map[string]interface{})
	if !ok {
		t.Fatalf("telegram_chat type = %T, want map[string]interface{}", metadata["telegram_chat"])
	}
	if chat["username"] != "mailman_user" {
		t.Fatalf("telegram_chat.username = %v, want mailman_user", chat["username"])
	}
}

func TestTelegramDeliveryMetadataFallsBackToConfiguredThreadID(t *testing.T) {
	response := &TelegramResponse{
		OK:     true,
		Result: json.RawMessage(`{"message_id": 456, "date": 1765859337, "chat": {"id": 7958080128}}`),
	}

	metadata := telegramDeliveryMetadata(response, 123)
	if metadata["message_thread_id"] != 123 {
		t.Fatalf("message_thread_id = %v, want configured thread id 123", metadata["message_thread_id"])
	}
}
