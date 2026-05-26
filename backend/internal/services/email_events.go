package services

import (
	"log"
	"sync"
	"time"
)

// EventType 定义事件类型
type EventType string

const (
	EventTypeNewEmail      EventType = "new_email"
	EventTypeFetchStart    EventType = "fetch_start"
	EventTypeFetchComplete EventType = "fetch_complete"
	EventTypeFetchError    EventType = "fetch_error"
	EventTypeSubscribed    EventType = "subscribed"
	EventTypeUnsubscribed  EventType = "unsubscribed"
)

// EmailEvent 定义邮件事件
type EmailEvent struct {
	Type           EventType
	SubscriptionID string
	Timestamp      time.Time
	Data           interface{}
	Error          error
	Source         string
	Metadata       map[string]interface{}
}

// EventChannel 定义事件通道类型
type EventChannel chan EmailEvent

// EventSubscriber 事件订阅者
type EventSubscriber struct {
	ID      string
	Channel EventChannel
	Filter  func(event EmailEvent) bool
}

// EmailSubscription 是 Subscription 的别名，用于外部接口
type EmailSubscription = Subscription

// EventBus 事件总线
type EventBus struct {
	subscribers map[EventType][]EventHandler
	mu          sync.RWMutex
}

// EventHandler 事件处理函数
type EventHandler func(event EmailEvent)

// NewEventBus 创建新的事件总线
func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[EventType][]EventHandler),
	}
}

// Subscribe 订阅事件
func (b *EventBus) Subscribe(eventType EventType, handler EventHandler) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.subscribers[eventType] = append(b.subscribers[eventType], handler)
	log.Printf("[EventBus] Subscribed to event type: %s", eventType)
}

// Unsubscribe 取消订阅事件
func (b *EventBus) Unsubscribe(eventType EventType, handler EventHandler) {
	b.mu.Lock()
	defer b.mu.Unlock()

	handlers := b.subscribers[eventType]
	for i, h := range handlers {
		if &h == &handler {
			b.subscribers[eventType] = append(handlers[:i], handlers[i+1:]...)
			log.Printf("[EventBus] Unsubscribed from event type: %s", eventType)
			break
		}
	}
}

// Publish 发布事件
func (b *EventBus) Publish(event EmailEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	handlers := b.subscribers[event.Type]
	log.Printf("[EventBus] Publishing event type: %s to %d handlers", event.Type, len(handlers))

	for _, handler := range handlers {
		go func(h EventHandler) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[EventBus] Panic in event handler: %v", r)
				}
			}()
			h(event)
		}(handler)
	}
}
