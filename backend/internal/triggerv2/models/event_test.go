package models

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewEvent(t *testing.T) {
	tests := []struct {
		name      string
		eventType EventType
		source    string
		subject   string
		data      interface{}
		wantErr   bool
	}{
		{
			name:      "创建邮件接收事件",
			eventType: EventTypeEmailReceived,
			source:    "email-service",
			subject:   "新邮件接收",
			data: EmailEventData{
				EmailID:   1,
				AccountID: 1,
				Subject:   "Test Email",
				From:      "test@example.com",
			},
			wantErr: false,
		},
		{
			name:      "创建触发器执行事件",
			eventType: EventTypeTriggerExecuted,
			source:    "trigger-service",
			subject:   "触发器执行完成",
			data: TriggerEventData{
				TriggerID:   1,
				TriggerName: "测试触发器",
				EmailID:     1,
				Success:     true,
			},
			wantErr: false,
		},
		{
			name:      "创建包含无效数据的事件",
			eventType: EventTypeSystemStart,
			source:    "system",
			subject:   "系统启动",
			data:      make(chan int), // 无法序列化的数据
			wantErr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			event, err := NewEvent(tt.eventType, tt.source, tt.subject, tt.data)

			if tt.wantErr {
				assert.Error(t, err)
				assert.Nil(t, event)
				return
			}

			require.NoError(t, err)
			require.NotNil(t, event)

			// 验证事件基本属性
			assert.Equal(t, tt.eventType, event.Type)
			assert.Equal(t, tt.source, event.Source)
			assert.Equal(t, tt.subject, event.Subject)
			assert.Equal(t, EventStatusPending, event.Status)
			assert.Equal(t, 0, event.RetryCount)
			assert.Equal(t, 3, event.MaxRetries)
			assert.NotEmpty(t, event.ID)
			assert.NotNil(t, event.Metadata)
			assert.False(t, event.CreatedAt.IsZero())
			assert.False(t, event.UpdatedAt.IsZero())

			// 验证数据可以正确反序列化
			var retrievedData interface{}
			switch tt.eventType {
			case EventTypeEmailReceived:
				retrievedData = &EmailEventData{}
			case EventTypeTriggerExecuted:
				retrievedData = &TriggerEventData{}
			default:
				retrievedData = &map[string]interface{}{}
			}

			err = event.GetData(retrievedData)
			assert.NoError(t, err)
		})
	}
}

func TestEvent_GetData(t *testing.T) {
	originalData := EmailEventData{
		EmailID:       123,
		AccountID:     456,
		Subject:       "Test Subject",
		From:          "sender@example.com",
		To:            "recipient@example.com",
		MessageID:     "msg-123",
		IsRead:        false,
		HasAttachment: true,
		Labels:        []string{"inbox", "important"},
		ReceivedAt:    time.Now(),
	}

	event, err := NewEvent(EventTypeEmailReceived, "test-source", "test-subject", originalData)
	require.NoError(t, err)

	// 测试获取数据
	var retrievedData EmailEventData
	err = event.GetData(&retrievedData)
	require.NoError(t, err)

	assert.Equal(t, originalData.EmailID, retrievedData.EmailID)
	assert.Equal(t, originalData.AccountID, retrievedData.AccountID)
	assert.Equal(t, originalData.Subject, retrievedData.Subject)
	assert.Equal(t, originalData.From, retrievedData.From)
	assert.Equal(t, originalData.To, retrievedData.To)
	assert.Equal(t, originalData.MessageID, retrievedData.MessageID)
	assert.Equal(t, originalData.IsRead, retrievedData.IsRead)
	assert.Equal(t, originalData.HasAttachment, retrievedData.HasAttachment)
	assert.Equal(t, originalData.Labels, retrievedData.Labels)
}

func TestEvent_SetData(t *testing.T) {
	event, err := NewEvent(EventTypeEmailReceived, "test-source", "test-subject", map[string]string{"key": "value"})
	require.NoError(t, err)

	originalUpdateTime := event.UpdatedAt
	time.Sleep(1 * time.Millisecond) // 确保时间差异

	newData := EmailEventData{
		EmailID:   999,
		AccountID: 888,
		Subject:   "New Subject",
	}

	err = event.SetData(newData)
	require.NoError(t, err)

	// 验证更新时间已改变
	assert.True(t, event.UpdatedAt.After(originalUpdateTime))

	// 验证新数据
	var retrievedData EmailEventData
	err = event.GetData(&retrievedData)
	require.NoError(t, err)
	assert.Equal(t, newData, retrievedData)
}

func TestEvent_CanRetry(t *testing.T) {
	event, err := NewEvent(EventTypeEmailReceived, "test-source", "test-subject", "test-data")
	require.NoError(t, err)

	// 初始状态可以重试
	assert.True(t, event.CanRetry())

	// 模拟重试到达最大次数
	for i := 0; i < event.MaxRetries; i++ {
		event.IncrementRetry()
	}

	// 达到最大重试次数后不能重试
	assert.False(t, event.CanRetry())
}

func TestEvent_IncrementRetry(t *testing.T) {
	event, err := NewEvent(EventTypeEmailReceived, "test-source", "test-subject", "test-data")
	require.NoError(t, err)

	originalRetryCount := event.RetryCount
	originalUpdateTime := event.UpdatedAt
	time.Sleep(1 * time.Millisecond)

	event.IncrementRetry()

	assert.Equal(t, originalRetryCount+1, event.RetryCount)
	assert.True(t, event.UpdatedAt.After(originalUpdateTime))
}

func TestEvent_MarkProcessing(t *testing.T) {
	event, err := NewEvent(EventTypeEmailReceived, "test-source", "test-subject", "test-data")
	require.NoError(t, err)

	originalUpdateTime := event.UpdatedAt
	time.Sleep(1 * time.Millisecond)

	event.MarkProcessing()

	assert.Equal(t, EventStatusProcessing, event.Status)
	assert.True(t, event.UpdatedAt.After(originalUpdateTime))
}

func TestEvent_MarkCompleted(t *testing.T) {
	event, err := NewEvent(EventTypeEmailReceived, "test-source", "test-subject", "test-data")
	require.NoError(t, err)

	originalUpdateTime := event.UpdatedAt
	time.Sleep(1 * time.Millisecond)

	event.MarkCompleted()

	assert.Equal(t, EventStatusCompleted, event.Status)
	assert.True(t, event.UpdatedAt.After(originalUpdateTime))
	assert.NotNil(t, event.ProcessedAt)
	assert.False(t, event.ProcessedAt.IsZero())
}

func TestEvent_MarkFailed(t *testing.T) {
	event, err := NewEvent(EventTypeEmailReceived, "test-source", "test-subject", "test-data")
	require.NoError(t, err)

	originalUpdateTime := event.UpdatedAt
	time.Sleep(1 * time.Millisecond)

	event.MarkFailed()

	assert.Equal(t, EventStatusFailed, event.Status)
	assert.True(t, event.UpdatedAt.After(originalUpdateTime))
	assert.NotNil(t, event.ProcessedAt)
	assert.False(t, event.ProcessedAt.IsZero())
}

func TestGenerateEventID(t *testing.T) {
	// 测试生成的ID是否唯一
	ids := make(map[string]bool)
	testData := EmailEventData{
		EmailID:   123,
		AccountID: 456,
		Subject:   "Test Subject",
	}
	
	for i := 0; i < 1000; i++ {
		event, err := NewEvent(EventTypeEmailReceived, "test-source", "test-subject", testData)
		assert.NoError(t, err)
		assert.NotEmpty(t, event.ID)
		assert.False(t, ids[event.ID], "生成了重复的ID: %s", event.ID)
		ids[event.ID] = true
	}
}

func TestEventSerialization(t *testing.T) {
	originalData := EmailEventData{
		EmailID:       123,
		AccountID:     456,
		Subject:       "Test Subject",
		From:          "sender@example.com",
		To:            "recipient@example.com",
		MessageID:     "msg-123",
		IsRead:        false,
		HasAttachment: true,
		Labels:        []string{"inbox", "important"},
		ReceivedAt:    time.Now().Round(time.Second), // 舍入到秒，避免精度问题
	}

	event, err := NewEvent(EventTypeEmailReceived, "test-source", "test-subject", originalData)
	require.NoError(t, err)

	// 序列化事件
	eventBytes, err := json.Marshal(event)
	require.NoError(t, err)

	// 反序列化事件
	var deserializedEvent Event
	err = json.Unmarshal(eventBytes, &deserializedEvent)
	require.NoError(t, err)

	// 验证基本属性
	assert.Equal(t, event.ID, deserializedEvent.ID)
	assert.Equal(t, event.Type, deserializedEvent.Type)
	assert.Equal(t, event.Status, deserializedEvent.Status)
	assert.Equal(t, event.Source, deserializedEvent.Source)
	assert.Equal(t, event.Subject, deserializedEvent.Subject)

	// 验证数据内容
	var retrievedData EmailEventData
	err = deserializedEvent.GetData(&retrievedData)
	require.NoError(t, err)
	assert.Equal(t, originalData, retrievedData)
}

// 基准测试
func BenchmarkNewEvent(b *testing.B) {
	data := EmailEventData{
		EmailID:       123,
		AccountID:     456,
		Subject:       "Benchmark Subject",
		From:          "benchmark@example.com",
		To:            "recipient@example.com",
		MessageID:     "msg-benchmark",
		IsRead:        false,
		HasAttachment: false,
		Labels:        []string{"inbox"},
		ReceivedAt:    time.Now(),
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := NewEvent(EventTypeEmailReceived, "benchmark-source", "benchmark-subject", data)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkEvent_GetData(b *testing.B) {
	data := EmailEventData{
		EmailID:       123,
		AccountID:     456,
		Subject:       "Benchmark Subject",
		From:          "benchmark@example.com",
		To:            "recipient@example.com",
		MessageID:     "msg-benchmark",
		IsRead:        false,
		HasAttachment: false,
		Labels:        []string{"inbox"},
		ReceivedAt:    time.Now(),
	}

	event, err := NewEvent(EventTypeEmailReceived, "benchmark-source", "benchmark-subject", data)
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var retrievedData EmailEventData
		err := event.GetData(&retrievedData)
		if err != nil {
			b.Fatal(err)
		}
	}
}
