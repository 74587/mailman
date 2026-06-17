package services

import (
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"mailman/internal/repository"
	"mailman/internal/utils"
)

const defaultOutputLogLimit = 5000
const OutputLogSettingsKey = "output-log-settings"

var ErrOutputLogSubscriberLimit = errors.New("output log subscriber limit reached")
var ErrOutputLogServiceClosed = errors.New("output log service is shutting down")

type OutputLogConfig struct {
	Enabled             bool `json:"enabled"`
	BufferLimit         int  `json:"bufferLimit"`
	QueryLimitMax       int  `json:"queryLimitMax"`
	StreamBackfillLimit int  `json:"streamBackfillLimit"`
	SubscriberBuffer    int  `json:"subscriberBuffer"`
	MaxSubscribers      int  `json:"maxSubscribers"`
}

type OutputLogEntry struct {
	ID      uint64    `json:"id"`
	Time    time.Time `json:"time"`
	Level   string    `json:"level"`
	Module  string    `json:"module"`
	Message string    `json:"message"`
	File    string    `json:"file,omitempty"`
	Line    int       `json:"line,omitempty"`
	Source  string    `json:"source"`
}

type OutputLogFilter struct {
	Query   string
	Level   string
	Module  string
	Source  string
	From    *time.Time
	To      *time.Time
	SinceID uint64
	Limit   int
}

type OutputLogService struct {
	mu          sync.RWMutex
	nextID      atomic.Uint64
	limit       int
	config      OutputLogConfig
	closed      bool
	entries     []OutputLogEntry
	subscribers map[uint64]outputLogSubscriber
	nextSubID   uint64
}

type outputLogSubscriber struct {
	filter OutputLogFilter
	ch     chan OutputLogEntry
}

var defaultOutputLogService = NewOutputLogService(defaultOutputLogLimit)

func GetOutputLogService() *OutputLogService {
	return defaultOutputLogService
}

func NewOutputLogService(limit int) *OutputLogService {
	if limit <= 0 {
		limit = defaultOutputLogLimit
	}
	config := DefaultOutputLogConfig()
	config.BufferLimit = limit
	config = NormalizeOutputLogConfig(config)
	return &OutputLogService{
		limit:       limit,
		config:      config,
		entries:     make([]OutputLogEntry, 0, limit),
		subscribers: make(map[uint64]outputLogSubscriber),
	}
}

func DefaultOutputLogConfig() OutputLogConfig {
	return OutputLogConfig{
		Enabled:             true,
		BufferLimit:         defaultOutputLogLimit,
		QueryLimitMax:       2000,
		StreamBackfillLimit: 200,
		SubscriberBuffer:    256,
		MaxSubscribers:      100,
	}
}

func NormalizeOutputLogConfig(config OutputLogConfig) OutputLogConfig {
	defaults := DefaultOutputLogConfig()
	if config.BufferLimit <= 0 {
		config.BufferLimit = defaults.BufferLimit
	}
	if config.BufferLimit > 200000 {
		config.BufferLimit = 200000
	}
	if config.QueryLimitMax <= 0 {
		config.QueryLimitMax = defaults.QueryLimitMax
	}
	if config.QueryLimitMax > config.BufferLimit {
		config.QueryLimitMax = config.BufferLimit
	}
	if config.StreamBackfillLimit < 0 {
		config.StreamBackfillLimit = 0
	}
	if config.StreamBackfillLimit > config.QueryLimitMax {
		config.StreamBackfillLimit = config.QueryLimitMax
	}
	if config.SubscriberBuffer <= 0 {
		config.SubscriberBuffer = defaults.SubscriberBuffer
	}
	if config.SubscriberBuffer > 5000 {
		config.SubscriberBuffer = 5000
	}
	if config.MaxSubscribers <= 0 {
		config.MaxSubscribers = defaults.MaxSubscribers
	}
	if config.MaxSubscribers > 10000 {
		config.MaxSubscribers = 10000
	}
	return config
}

func LoadOutputLogConfig(repo *repository.SystemConfigRepository) OutputLogConfig {
	config := DefaultOutputLogConfig()
	if repo == nil {
		return config
	}
	value, err := repo.GetValueByKey(OutputLogSettingsKey)
	if err != nil || value == nil {
		return config
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return config
	}
	if err := json.Unmarshal(bytes, &config); err != nil {
		return DefaultOutputLogConfig()
	}
	return NormalizeOutputLogConfig(config)
}

func (s *OutputLogService) Config() OutputLogConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.config
}

func (s *OutputLogService) ApplyConfig(config OutputLogConfig) OutputLogConfig {
	config = NormalizeOutputLogConfig(config)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.config = config
	s.limit = config.BufferLimit
	if len(s.entries) > s.limit {
		copy(s.entries, s.entries[len(s.entries)-s.limit:])
		s.entries = s.entries[:s.limit]
	}
	return config
}

func (s *OutputLogService) Shutdown() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.closed = true
	for id, subscriber := range s.subscribers {
		close(subscriber.ch)
		delete(s.subscribers, id)
	}
}

func (s *OutputLogService) Record(raw utils.StructuredLogEntry) {
	s.mu.RLock()
	enabled := s.config.Enabled && !s.closed
	s.mu.RUnlock()
	if !enabled {
		return
	}

	entry := OutputLogEntry{
		ID:      s.nextID.Add(1),
		Time:    raw.Time,
		Level:   strings.ToUpper(strings.TrimSpace(raw.Level)),
		Module:  strings.TrimSpace(raw.Module),
		Message: raw.Message,
		File:    raw.File,
		Line:    raw.Line,
		Source:  "backend",
	}
	if entry.Time.IsZero() {
		entry.Time = time.Now()
	}
	if entry.Level == "" {
		entry.Level = "INFO"
	}
	if entry.Module == "" {
		entry.Module = "app"
	}

	s.mu.Lock()
	if s.closed || !s.config.Enabled {
		s.mu.Unlock()
		return
	}
	s.entries = append(s.entries, entry)
	if len(s.entries) > s.limit {
		copy(s.entries, s.entries[len(s.entries)-s.limit:])
		s.entries = s.entries[:s.limit]
	}

	for _, subscriber := range s.subscribers {
		if !outputLogMatches(entry, subscriber.filter) {
			continue
		}
		select {
		case subscriber.ch <- entry:
		default:
		}
	}
	s.mu.Unlock()
}

func (s *OutputLogService) Query(filter OutputLogFilter) []OutputLogEntry {
	s.mu.RLock()
	limit := s.normalizeOutputLogLimitLocked(filter.Limit)
	defer s.mu.RUnlock()

	result := make([]OutputLogEntry, 0, minInt(limit, len(s.entries)))
	for i := len(s.entries) - 1; i >= 0; i-- {
		entry := s.entries[i]
		if !outputLogMatches(entry, filter) {
			continue
		}
		result = append(result, entry)
		if len(result) >= limit {
			break
		}
	}

	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result
}

func (s *OutputLogService) Modules() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	seen := make(map[string]struct{})
	modules := make([]string, 0)
	for _, entry := range s.entries {
		if entry.Module == "" {
			continue
		}
		if _, ok := seen[entry.Module]; ok {
			continue
		}
		seen[entry.Module] = struct{}{}
		modules = append(modules, entry.Module)
	}
	return modules
}

func (s *OutputLogService) Subscribe(filter OutputLogFilter) (<-chan OutputLogEntry, func(), error) {
	filter.Limit = 0

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, nil, ErrOutputLogServiceClosed
	}
	if s.config.MaxSubscribers > 0 && len(s.subscribers) >= s.config.MaxSubscribers {
		s.mu.Unlock()
		return nil, nil, ErrOutputLogSubscriberLimit
	}
	ch := make(chan OutputLogEntry, s.config.SubscriberBuffer)
	s.nextSubID++
	id := s.nextSubID
	s.subscribers[id] = outputLogSubscriber{filter: filter, ch: ch}
	s.mu.Unlock()

	cancel := func() {
		s.mu.Lock()
		if subscriber, ok := s.subscribers[id]; ok {
			delete(s.subscribers, id)
			close(subscriber.ch)
		}
		s.mu.Unlock()
	}
	return ch, cancel, nil
}

func (s *OutputLogService) StreamBackfillLimit() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.config.StreamBackfillLimit
}

func (s *OutputLogService) normalizeOutputLogLimitLocked(limit int) int {
	if limit <= 0 {
		return 300
	}
	if limit > s.config.QueryLimitMax {
		return s.config.QueryLimitMax
	}
	return limit
}

func outputLogMatches(entry OutputLogEntry, filter OutputLogFilter) bool {
	if filter.SinceID > 0 && entry.ID <= filter.SinceID {
		return false
	}
	if filter.Level != "" && !strings.EqualFold(entry.Level, filter.Level) {
		return false
	}
	if filter.Module != "" && !strings.Contains(strings.ToLower(entry.Module), strings.ToLower(filter.Module)) {
		return false
	}
	if filter.Source != "" && !strings.EqualFold(entry.Source, filter.Source) {
		return false
	}
	if filter.From != nil && entry.Time.Before(*filter.From) {
		return false
	}
	if filter.To != nil && entry.Time.After(*filter.To) {
		return false
	}
	if filter.Query != "" {
		q := strings.ToLower(filter.Query)
		haystack := strings.ToLower(entry.Level + " " + entry.Module + " " + entry.Message + " " + entry.File)
		if !strings.Contains(haystack, q) {
			return false
		}
	}
	return true
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
