package models

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type legacyProxyGatewayAccount struct {
	ID           uint   `gorm:"primaryKey"`
	OrgID        uint   `gorm:"not null;index;default:1;uniqueIndex:idx_proxy_gateway_account_username"`
	Username     string `gorm:"not null;type:varchar(160);uniqueIndex:idx_proxy_gateway_account_username"`
	PasswordHash string `gorm:"not null"`
}

func (legacyProxyGatewayAccount) TableName() string { return "proxy_gateway_accounts" }

func TestProxyGatewayAccountMigrationDefaultsExistingRowsToAccountSelection(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:proxy-selection-source-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&legacyProxyGatewayAccount{}); err != nil {
		t.Fatalf("migrate legacy account: %v", err)
	}
	legacy := legacyProxyGatewayAccount{OrgID: 1, Username: "existing-client", PasswordHash: "hash"}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("create legacy account: %v", err)
	}

	if err := db.AutoMigrate(&ProxyGatewayAccount{}); err != nil {
		t.Fatalf("migrate current account: %v", err)
	}
	var migrated ProxyGatewayAccount
	if err := db.First(&migrated, legacy.ID).Error; err != nil {
		t.Fatalf("load migrated account: %v", err)
	}
	if migrated.ProxySelectionSource != ProxyGatewaySelectionSourceAccount {
		t.Fatalf("selection source=%q want=%q", migrated.ProxySelectionSource, ProxyGatewaySelectionSourceAccount)
	}
}
