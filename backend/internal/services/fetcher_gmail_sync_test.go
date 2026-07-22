package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"mailman/internal/utils"

	"google.golang.org/api/gmail/v1"
	"google.golang.org/api/option"
)

func TestShouldUseGmailHistoryHonorsFullSync(t *testing.T) {
	tests := []struct {
		name      string
		syncMode  string
		historyID string
		want      bool
	}{
		{name: "incremental with cursor", syncMode: "incremental", historyID: "6023", want: true},
		{name: "legacy empty mode with cursor", syncMode: "", historyID: "6023", want: true},
		{name: "full with cursor", syncMode: "full", historyID: "6023", want: false},
		{name: "case insensitive full", syncMode: " FULL ", historyID: "6023", want: false},
		{name: "incremental without cursor", syncMode: "incremental", historyID: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := shouldUseGmailHistory(tt.syncMode, tt.historyID); got != tt.want {
				t.Fatalf("shouldUseGmailHistory(%q, %q) = %v, want %v", tt.syncMode, tt.historyID, got, tt.want)
			}
		})
	}
}

func TestShouldAdvanceGmailCheckpointRejectsBoundedFullBackfill(t *testing.T) {
	end := time.Now()
	if shouldAdvanceGmailCheckpoint("full", &end) {
		t.Fatal("bounded full backfill must not advance the live Gmail checkpoint")
	}
	if !shouldAdvanceGmailCheckpoint("full", nil) {
		t.Fatal("current full scan without an upper bound should advance the Gmail checkpoint")
	}
	if !shouldAdvanceGmailCheckpoint("incremental", &end) {
		t.Fatal("incremental History API sync should advance the Gmail checkpoint")
	}
}

func TestCommitFetchCheckpointRejectsIncompleteScan(t *testing.T) {
	fetcher := &FetcherService{}
	err := fetcher.CommitFetchCheckpoint(1, &FetchSyncCheckpoint{
		Incomplete:       true,
		IncompleteReason: "Gmail full scan exceeded the configured limit",
	})
	if err == nil || !strings.Contains(err.Error(), "was not advanced") {
		t.Fatalf("expected incomplete checkpoint error, got %v", err)
	}
}

func TestConvertGmailMessagesRejectsMissingPayload(t *testing.T) {
	fetcher := &FetcherService{}
	_, err := fetcher.convertGmailMessages([]*gmail.Message{{Id: "missing-payload"}}, 1)
	if err == nil || !strings.Contains(err.Error(), "has no payload") {
		t.Fatalf("expected missing payload error, got %v", err)
	}
}

func TestBuildGmailQueryUnifiedUsesExactUnixBoundaries(t *testing.T) {
	start := time.Date(2026, time.July, 22, 17, 5, 27, 0, time.FixedZone("SGT", 8*60*60))
	end := start.Add(45 * time.Minute)
	fetcher := &FetcherService{}

	query := fetcher.buildGmailQueryUnified(FetchEmailsOptions{
		StartDate: &start,
		EndDate:   &end,
	})

	if !strings.Contains(query, "after:"+formatUnixForTest(start)) {
		t.Fatalf("query %q does not contain exact start boundary", query)
	}
	if !strings.Contains(query, "before:"+formatUnixForTest(end)) {
		t.Fatalf("query %q does not contain exact end boundary", query)
	}
	if strings.Contains(query, "2026/07/22") {
		t.Fatalf("query %q truncated the timestamp to a calendar date", query)
	}
}

func TestFetchGmailMessagesUnifiedDoesNotHideDetailFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/messages"):
			_, _ = w.Write([]byte(`{"messages":[{"id":"m1"}]}`))
		case strings.HasSuffix(r.URL.Path, "/messages/m1"):
			http.Error(w, `{"error":{"code":500,"message":"temporary failure"}}`, http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	service, err := gmail.NewService(
		context.Background(),
		option.WithEndpoint(server.URL+"/"),
		option.WithoutAuthentication(),
	)
	if err != nil {
		t.Fatalf("create Gmail test service: %v", err)
	}

	fetcher := &FetcherService{logger: utils.NewLogger("GmailSyncTest")}
	_, _, err = fetcher.fetchGmailMessagesUnified(service, FetchEmailsOptions{Limit: 10})
	if err == nil || !strings.Contains(err.Error(), "failed to get Gmail message m1") {
		t.Fatalf("expected message detail failure, got %v", err)
	}
}

func TestFetchGmailMessagesUnifiedMarksLimitedScanIncomplete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/messages"):
			_, _ = w.Write([]byte(`{"messages":[{"id":"m1"}],"nextPageToken":"more"}`))
		case strings.HasSuffix(r.URL.Path, "/messages/m1"):
			_, _ = w.Write([]byte(`{"id":"m1","payload":{"headers":[]}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	service, err := gmail.NewService(
		context.Background(),
		option.WithEndpoint(server.URL+"/"),
		option.WithoutAuthentication(),
	)
	if err != nil {
		t.Fatalf("create Gmail test service: %v", err)
	}

	fetcher := &FetcherService{logger: utils.NewLogger("GmailSyncTest")}
	messages, complete, err := fetcher.fetchGmailMessagesUnified(service, FetchEmailsOptions{Limit: 1})
	if err != nil {
		t.Fatalf("limited scan failed: %v", err)
	}
	if complete {
		t.Fatal("limited Gmail scan was incorrectly marked complete")
	}
	if len(messages) != 1 || messages[0].Id != "m1" {
		t.Fatalf("limited scan messages = %+v, want m1", messages)
	}
}

func formatUnixForTest(value time.Time) string {
	return strconv.FormatInt(value.Unix(), 10)
}
