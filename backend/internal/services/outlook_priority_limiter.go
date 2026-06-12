package services

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type outlookRequestPriority int

const (
	outlookRequestPriorityPickup outlookRequestPriority = iota
	outlookRequestPriorityNormal
	outlookRequestPriorityBackground

	defaultOutlookPickupLimit     = 20
	defaultOutlookNormalLimit     = 8
	defaultOutlookBackgroundLimit = 1
)

var defaultOutlookRequestLimiter = newOutlookRequestPriorityLimiter(
	defaultOutlookPickupLimit,
	defaultOutlookNormalLimit,
	defaultOutlookBackgroundLimit,
)

type outlookRequestPriorityLimiter struct {
	mu               sync.Mutex
	cond             *sync.Cond
	activePickup     int
	activeNormal     int
	activeBackground int
	waitingPickup    int
	pickupLimit      int
	normalLimit      int
	backgroundLimit  int
}

type OutlookPriorityLimiterSnapshot struct {
	ActivePickup     int `json:"active_pickup"`
	ActiveNormal     int `json:"active_normal"`
	ActiveBackground int `json:"active_background"`
	WaitingPickup    int `json:"waiting_pickup"`
	PickupLimit      int `json:"pickup_limit"`
	NormalLimit      int `json:"normal_limit"`
	BackgroundLimit  int `json:"background_limit"`
}

func newOutlookRequestPriorityLimiter(pickupLimit int, normalLimit int, backgroundLimit int) *outlookRequestPriorityLimiter {
	if pickupLimit <= 0 {
		pickupLimit = 1
	}
	if normalLimit <= 0 {
		normalLimit = 1
	}
	if backgroundLimit <= 0 {
		backgroundLimit = 1
	}

	limiter := &outlookRequestPriorityLimiter{
		pickupLimit:     pickupLimit,
		normalLimit:     normalLimit,
		backgroundLimit: backgroundLimit,
	}
	limiter.cond = sync.NewCond(&limiter.mu)
	return limiter
}

func GetOutlookRequestLimiterSnapshot() OutlookPriorityLimiterSnapshot {
	return defaultOutlookRequestLimiter.snapshot()
}

func (l *outlookRequestPriorityLimiter) snapshot() OutlookPriorityLimiterSnapshot {
	l.mu.Lock()
	defer l.mu.Unlock()

	return OutlookPriorityLimiterSnapshot{
		ActivePickup:     l.activePickup,
		ActiveNormal:     l.activeNormal,
		ActiveBackground: l.activeBackground,
		WaitingPickup:    l.waitingPickup,
		PickupLimit:      l.pickupLimit,
		NormalLimit:      l.normalLimit,
		BackgroundLimit:  l.backgroundLimit,
	}
}

func outlookPriorityForSource(source EmailIngestSource) outlookRequestPriority {
	switch normalizeEmailIngestSource(source) {
	case EmailIngestSourcePickup:
		return outlookRequestPriorityPickup
	case EmailIngestSourceBackgroundImport:
		return outlookRequestPriorityBackground
	default:
		return outlookRequestPriorityNormal
	}
}

func (p outlookRequestPriority) String() string {
	switch p {
	case outlookRequestPriorityPickup:
		return "pickup"
	case outlookRequestPriorityBackground:
		return "background"
	default:
		return "normal"
	}
}

func (l *outlookRequestPriorityLimiter) acquire(ctx context.Context, priority outlookRequestPriority) (func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}

	cancelWatch := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			l.mu.Lock()
			l.cond.Broadcast()
			l.mu.Unlock()
		case <-cancelWatch:
		}
	}()

	l.mu.Lock()
	defer l.mu.Unlock()
	defer close(cancelWatch)

	if priority == outlookRequestPriorityPickup {
		l.waitingPickup++
		defer func() {
			l.waitingPickup--
			l.cond.Broadcast()
		}()
	}

	for !l.canAcquire(priority) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		l.cond.Wait()
	}

	l.increment(priority)
	return func() {
		l.mu.Lock()
		l.decrement(priority)
		l.cond.Broadcast()
		l.mu.Unlock()
	}, nil
}

func (l *outlookRequestPriorityLimiter) canAcquire(priority outlookRequestPriority) bool {
	switch priority {
	case outlookRequestPriorityPickup:
		return l.activePickup < l.pickupLimit
	case outlookRequestPriorityBackground:
		return l.activeBackground < l.backgroundLimit &&
			l.activePickup == 0 &&
			l.waitingPickup == 0
	default:
		return l.activeNormal < l.normalLimit &&
			l.activePickup == 0 &&
			l.waitingPickup == 0
	}
}

func (l *outlookRequestPriorityLimiter) increment(priority outlookRequestPriority) {
	switch priority {
	case outlookRequestPriorityPickup:
		l.activePickup++
	case outlookRequestPriorityBackground:
		l.activeBackground++
	default:
		l.activeNormal++
	}
}

func (l *outlookRequestPriorityLimiter) decrement(priority outlookRequestPriority) {
	switch priority {
	case outlookRequestPriorityPickup:
		if l.activePickup > 0 {
			l.activePickup--
		}
	case outlookRequestPriorityBackground:
		if l.activeBackground > 0 {
			l.activeBackground--
		}
	default:
		if l.activeNormal > 0 {
			l.activeNormal--
		}
	}
}

func (s *FetcherService) acquireOutlookRequestSlot(source EmailIngestSource, operation string) (func(), error) {
	priority := outlookPriorityForSource(source)
	waitStart := time.Now()
	release, err := defaultOutlookRequestLimiter.acquire(context.Background(), priority)
	RuntimeMetrics().RecordOutlookLimiterWait(source, priority.String(), operation, time.Since(waitStart), err)
	if err != nil {
		return nil, fmt.Errorf("failed to acquire Outlook %s slot for %s priority: %w", operation, priority, err)
	}
	if s != nil && s.logger != nil {
		s.logger.Debug("Acquired Outlook %s slot with %s priority", operation, priority)
	}
	return release, nil
}
