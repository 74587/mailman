package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mailman/internal/repository"
	"strings"
)

type encodedKeysetCursor struct {
	SortBy    string `json:"sort_by"`
	SortOrder string `json:"sort_order,omitempty"`
	Value     string `json:"value"`
	ID        uint   `json:"id"`
}

func encodeKeysetCursor(sortBy, sortOrder, value string, id uint) (string, error) {
	payload, err := json.Marshal(encodedKeysetCursor{
		SortBy:    sortBy,
		SortOrder: sortOrder,
		Value:     value,
		ID:        id,
	})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeKeysetCursor(raw, sortBy, sortOrder string) (*repository.KeysetCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}

	payload, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid cursor encoding")
	}

	var cursor encodedKeysetCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return nil, fmt.Errorf("invalid cursor payload")
	}
	if cursor.ID == 0 {
		return nil, fmt.Errorf("invalid cursor id")
	}
	if cursor.SortBy != sortBy || !strings.EqualFold(cursor.SortOrder, sortOrder) {
		return nil, fmt.Errorf("cursor does not match current sort")
	}

	return &repository.KeysetCursor{
		Value: cursor.Value,
		ID:    cursor.ID,
	}, nil
}
