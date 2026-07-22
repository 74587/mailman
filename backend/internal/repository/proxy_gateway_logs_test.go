package repository

import (
	"testing"
	"time"

	"mailman/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestListAccessLogsFiltersAndPaginates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyGatewayAccount{}, &models.ProxyGatewayAccessLog{}); err != nil {
		t.Fatalf("migrate gateway logs: %v", err)
	}

	alice := models.ProxyGatewayAccount{OrgID: 1, Username: "alice-login", Name: "Alice Operations", PasswordHash: "hash", Enabled: true}
	bob := models.ProxyGatewayAccount{OrgID: 1, Username: "bob-login", Name: "Bob Support", PasswordHash: "hash", Enabled: true}
	if err := db.Create(&alice).Error; err != nil {
		t.Fatalf("create alice: %v", err)
	}
	if err := db.Create(&bob).Error; err != nil {
		t.Fatalf("create bob: %v", err)
	}

	base := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	logs := []models.ProxyGatewayAccessLog{
		{OrgID: 1, ListenerID: uintPointer(11), AccountID: &alice.ID, Username: alice.Username, ClientIP: "203.0.113.10", TargetHost: "api.example.com", TargetPort: 443, Protocol: "socks5", Status: "success", CreatedAt: base.Add(-time.Minute)},
		{OrgID: 1, ListenerID: uintPointer(11), AccountID: &alice.ID, Username: alice.Username, ClientIP: "203.0.113.10", TargetHost: "API.TEST.COM", TargetPort: 443, Protocol: "socks5", Status: "failed", CreatedAt: base.Add(-2 * time.Minute)},
		{OrgID: 1, ListenerID: uintPointer(12), AccountID: &bob.ID, Username: bob.Username, ClientIP: "203.0.113.11", TargetHost: "www.example.net", TargetPort: 80, Protocol: "http", Status: "denied", CreatedAt: base.Add(-3 * time.Minute)},
		{OrgID: 2, Username: alice.Username, ClientIP: "203.0.113.10", TargetHost: "api.example.com", Protocol: "socks5", Status: "success", CreatedAt: base},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatalf("create logs: %v", err)
	}

	repo := NewProxyGatewayRepository(db)
	start := base.Add(-90 * time.Second)
	end := base.Add(-30 * time.Second)
	items, total, err := repo.ListAccessLogs(1, ProxyGatewayLogFilter{
		AccountName: "operations",
		ListenerID:  uintPointer(11),
		SourceIP:    "203.0.113.10",
		Target:      "*.example.com",
		TargetMatch: "wildcard",
		Status:      "success",
		Protocol:    "socks5",
		StartTime:   &start,
		EndTime:     &end,
		Page:        1,
		Limit:       20,
	})
	if err != nil {
		t.Fatalf("filter access logs: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].TargetHost != "api.example.com" {
		t.Fatalf("filtered logs total=%d items=%+v", total, items)
	}

	items, total, err = repo.ListAccessLogs(1, ProxyGatewayLogFilter{
		Target:      `^api\.(example|test)\.com$`,
		TargetMatch: "regex",
		Page:        2,
		Limit:       1,
	})
	if err != nil {
		t.Fatalf("regex access logs: %v", err)
	}
	if total != 2 || len(items) != 1 || items[0].TargetHost != "API.TEST.COM" {
		t.Fatalf("regex page total=%d items=%+v", total, items)
	}
}

func TestGatewayLogWildcardEscapesSQLMetacharacters(t *testing.T) {
	if got := wildcardSQLLike(`api_%!*`); got != `api!_!%!!%` {
		t.Fatalf("wildcard SQL pattern=%q", got)
	}
	if got := escapeSQLLike(`50%!_`); got != `50!%!!!_` {
		t.Fatalf("escaped SQL pattern=%q", got)
	}
}

func uintPointer(value uint) *uint {
	return &value
}
