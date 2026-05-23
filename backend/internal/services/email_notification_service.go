package services

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// EmailNotification 邮件通知结构
type EmailNotification struct {
	Type         string    `json:"type"`
	AccountID    uint      `json:"account_id"`
	AccountEmail string    `json:"account_email"`
	EmailID      uint      `json:"email_id,omitempty"`
	EmailCount   int       `json:"email_count"`
	Subject      string    `json:"subject,omitempty"`
	From         string    `json:"from,omitempty"`
	Timestamp    time.Time `json:"timestamp"`
}

// WebSocketClient WebSocket客户端
type WebSocketClient struct {
	ID     string
	Conn   *websocket.Conn
	Send   chan []byte
	mu     sync.Mutex
	closed bool
}

// EmailNotificationService 邮件通知服务
type EmailNotificationService struct {
	// WebSocket客户端管理
	clients   map[string]*WebSocketClient
	clientsMu sync.RWMutex

	// 通知历史（最近100条）
	history    []EmailNotification
	historyMu  sync.RWMutex
	maxHistory int

	// 统计
	totalNotifications int64
	connectedClients   int64
}

// NewEmailNotificationService 创建通知服务
func NewEmailNotificationService() *EmailNotificationService {
	return &EmailNotificationService{
		clients:    make(map[string]*WebSocketClient),
		history:    make([]EmailNotification, 0),
		maxHistory: 100,
	}
}

// RegisterClient 注册WebSocket客户端
func (s *EmailNotificationService) RegisterClient(clientID string, conn *websocket.Conn) {
	client := &WebSocketClient{
		ID:   clientID,
		Conn: conn,
		Send: make(chan []byte, 256),
	}

	s.clientsMu.Lock()
	s.clients[clientID] = client
	s.connectedClients++
	s.clientsMu.Unlock()

	log.Printf("[EmailNotificationService] Client %s connected", clientID)

	// 启动客户端处理goroutine
	go s.handleClient(client)

	// 发送最近的通知历史（前端有去重机制，不会重复显示）
	s.sendRecentHistory(client)
}

// UnregisterClient 注销WebSocket客户端
func (s *EmailNotificationService) UnregisterClient(clientID string) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()

	if client, exists := s.clients[clientID]; exists {
		client.mu.Lock()
		if !client.closed {
			close(client.Send)
			client.closed = true
		}
		client.mu.Unlock()

		delete(s.clients, clientID)
		s.connectedClients--
		log.Printf("[EmailNotificationService] Client %s disconnected", clientID)
	}
}

// BroadcastNotification 广播通知
func (s *EmailNotificationService) BroadcastNotification(notification EmailNotification) {
	// 序列化通知
	data, err := json.Marshal(notification)
	if err != nil {
		log.Printf("[EmailNotificationService] Failed to serialize notification: %v", err)
		return
	}

	// 添加到历史记录
	s.addToHistory(notification)

	// 广播给所有客户端
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()

	for clientID, client := range s.clients {
		select {
		case client.Send <- data:
			// 发送成功
		default:
			// 发送失败，可能客户端断开
			log.Printf("[EmailNotificationService] Failed to send to client %s, removing", clientID)
			go s.UnregisterClient(clientID)
		}
	}

	s.totalNotifications++
	log.Printf("[EmailNotificationService] Broadcasted notification to %d clients: %s",
		len(s.clients), notification.Type)
}

// handleClient 处理单个客户端
func (s *EmailNotificationService) handleClient(client *WebSocketClient) {
	defer func() {
		s.UnregisterClient(client.ID)
		client.Conn.Close()
	}()

	// 设置 Pong Handler - 当收到 Pong 时重置读取超时
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})

	// 设置初始读取超时（心跳间隔 54秒 + 缓冲时间）
	client.Conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

	// 启动写入goroutine
	go s.writeToClient(client)

	// 处理来自客户端的消息（心跳等）
	for {
		_, _, err := client.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[EmailNotificationService] Client %s websocket error: %v", client.ID, err)
			}
			break
		}

		// 收到任何消息都重置读取超时
		client.Conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	}
}

// writeToClient 向客户端写入数据
func (s *EmailNotificationService) writeToClient(client *WebSocketClient) {
	ticker := time.NewTicker(54 * time.Second) // 心跳间隔
	defer ticker.Stop()

	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := client.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("[EmailNotificationService] Write error for client %s: %v", client.ID, err)
				return
			}

		case <-ticker.C:
			// 发送心跳
			client.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// addToHistory 添加到历史记录
func (s *EmailNotificationService) addToHistory(notification EmailNotification) {
	s.historyMu.Lock()
	defer s.historyMu.Unlock()

	s.history = append(s.history, notification)

	// 保持最大历史数量
	if len(s.history) > s.maxHistory {
		s.history = s.history[1:] // 删除最老的记录
	}
}

// sendRecentHistory 发送最近的通知历史
func (s *EmailNotificationService) sendRecentHistory(client *WebSocketClient) {
	s.historyMu.RLock()
	defer s.historyMu.RUnlock()

	// 发送最近10条通知
	start := len(s.history) - 10
	if start < 0 {
		start = 0
	}

	for i := start; i < len(s.history); i++ {
		data, err := json.Marshal(s.history[i])
		if err != nil {
			continue
		}

		select {
		case client.Send <- data:
		default:
			// 客户端通道满了，跳过历史消息
			break
		}
	}
}

// GetStats 获取服务统计
func (s *EmailNotificationService) GetStats() map[string]interface{} {
	s.clientsMu.RLock()
	connectedClients := len(s.clients)
	s.clientsMu.RUnlock()

	s.historyMu.RLock()
	historyCount := len(s.history)
	s.historyMu.RUnlock()

	return map[string]interface{}{
		"connected_clients":   connectedClients,
		"total_notifications": s.totalNotifications,
		"history_count":       historyCount,
		"max_history":         s.maxHistory,
	}
}

// GetRecentNotifications 获取最近的通知
func (s *EmailNotificationService) GetRecentNotifications(limit int) []EmailNotification {
	s.historyMu.RLock()
	defer s.historyMu.RUnlock()

	if limit <= 0 || limit > len(s.history) {
		limit = len(s.history)
	}

	start := len(s.history) - limit
	if start < 0 {
		start = 0
	}

	result := make([]EmailNotification, limit)
	copy(result, s.history[start:])

	return result
}
