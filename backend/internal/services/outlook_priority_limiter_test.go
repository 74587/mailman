package services

import (
	"context"
	"testing"
	"time"
)

func TestOutlookPriorityLimiterAllowsPickupDuringBackground(t *testing.T) {
	limiter := newOutlookRequestPriorityLimiter(1, 1, 1)

	releaseBackground, err := limiter.acquire(context.Background(), outlookRequestPriorityBackground)
	if err != nil {
		t.Fatalf("background acquire failed: %v", err)
	}
	defer releaseBackground()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	releasePickup, err := limiter.acquire(ctx, outlookRequestPriorityPickup)
	if err != nil {
		t.Fatalf("pickup should not wait behind background: %v", err)
	}
	releasePickup()
}

func TestOutlookPriorityLimiterBlocksBackgroundWhilePickupActive(t *testing.T) {
	limiter := newOutlookRequestPriorityLimiter(1, 1, 1)

	releasePickup, err := limiter.acquire(context.Background(), outlookRequestPriorityPickup)
	if err != nil {
		t.Fatalf("pickup acquire failed: %v", err)
	}
	defer releasePickup()

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()

	if releaseBackground, err := limiter.acquire(ctx, outlookRequestPriorityBackground); err == nil {
		releaseBackground()
		t.Fatal("background acquired while pickup was active")
	}
}

func TestOutlookPriorityLimiterSerializesBackground(t *testing.T) {
	limiter := newOutlookRequestPriorityLimiter(2, 2, 1)

	releaseBackground, err := limiter.acquire(context.Background(), outlookRequestPriorityBackground)
	if err != nil {
		t.Fatalf("first background acquire failed: %v", err)
	}
	defer releaseBackground()

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()

	if releaseSecond, err := limiter.acquire(ctx, outlookRequestPriorityBackground); err == nil {
		releaseSecond()
		t.Fatal("second background acquire should wait for the first background request")
	}
}
