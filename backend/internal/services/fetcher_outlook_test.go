package services

import (
	"errors"
	"testing"
)

func TestShouldRetryOutlookRESTPickupError(t *testing.T) {
	tests := []struct {
		name    string
		source  EmailIngestSource
		err     error
		attempt int
		want    bool
	}{
		{
			name:    "pickup connection reset retries",
			source:  EmailIngestSourcePickup,
			err:     errors.New("read tcp 172.23.0.3:52314->52.96.191.114:443: read: connection reset by peer"),
			attempt: 1,
			want:    true,
		},
		{
			name:    "pickup unexpected EOF retries",
			source:  EmailIngestSourcePickup,
			err:     errors.New("unexpected EOF"),
			attempt: 2,
			want:    true,
		},
		{
			name:    "pickup max attempts stops",
			source:  EmailIngestSourcePickup,
			err:     errors.New("connection reset by peer"),
			attempt: outlookPickupRESTMaxAttempts,
			want:    false,
		},
		{
			name:    "background import does not retry",
			source:  EmailIngestSourceBackgroundImport,
			err:     errors.New("connection reset by peer"),
			attempt: 1,
			want:    false,
		},
		{
			name:    "auth error does not retry",
			source:  EmailIngestSourcePickup,
			err:     errors.New("REST API request failed with status 401"),
			attempt: 1,
			want:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldRetryOutlookRESTPickupError(tt.source, tt.err, tt.attempt)
			if got != tt.want {
				t.Fatalf("shouldRetryOutlookRESTPickupError() = %v, want %v", got, tt.want)
			}
		})
	}
}
