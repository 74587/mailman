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

type legacyProxyGatewayRouteStrategy struct {
	ID        uint   `gorm:"primaryKey"`
	OrgID     uint   `gorm:"not null;default:1;uniqueIndex:idx_proxy_gateway_route_flag"`
	GatewayID uint   `gorm:"not null;default:0;uniqueIndex:idx_proxy_gateway_route_flag"`
	Name      string `gorm:"not null"`
	FlagNo    int    `gorm:"not null;uniqueIndex:idx_proxy_gateway_route_flag"`
}

func (legacyProxyGatewayRouteStrategy) TableName() string { return "proxy_gateway_route_strategies" }

type legacyProxyGatewayTargetRoute struct {
	ID              uint   `gorm:"primaryKey"`
	OrgID           uint   `gorm:"not null;default:1"`
	GatewayID       uint   `gorm:"not null"`
	Name            string `gorm:"not null"`
	Enabled         bool   `gorm:"not null;default:true"`
	RouteStrategyID uint   `gorm:"not null"`
}

func (legacyProxyGatewayTargetRoute) TableName() string { return "proxy_gateway_target_routes" }

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
	if migrated.UsernameRoutingMode != ProxyGatewayUsernameRoutingStrategy {
		t.Fatalf("username routing mode=%q want=%q", migrated.UsernameRoutingMode, ProxyGatewayUsernameRoutingStrategy)
	}
	if migrated.ProxyIndexOverflowMode != ProxyGatewayIndexOverflowReject {
		t.Fatalf("proxy index overflow=%q want=%q", migrated.ProxyIndexOverflowMode, ProxyGatewayIndexOverflowReject)
	}
}

func TestProxyGatewayRouteStrategyMigrationDefaultsExistingRowsToStrictIndexOverflow(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:proxy-index-overflow-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&legacyProxyGatewayRouteStrategy{}); err != nil {
		t.Fatalf("migrate legacy strategy: %v", err)
	}
	legacy := legacyProxyGatewayRouteStrategy{OrgID: 1, GatewayID: 2, Name: "existing pool", FlagNo: 3}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("create legacy strategy: %v", err)
	}

	if err := db.AutoMigrate(&ProxyGatewayRouteStrategy{}); err != nil {
		t.Fatalf("migrate current strategy: %v", err)
	}
	var migrated ProxyGatewayRouteStrategy
	if err := db.First(&migrated, legacy.ID).Error; err != nil {
		t.Fatalf("load migrated strategy: %v", err)
	}
	if migrated.ProxyIndexOverflowMode != ProxyGatewayIndexOverflowReject {
		t.Fatalf("proxy index overflow=%q want=%q", migrated.ProxyIndexOverflowMode, ProxyGatewayIndexOverflowReject)
	}
}

func TestProxyGatewayTargetRouteMigrationKeepsFailoverDisabled(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:proxy-route-failover-migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&legacyProxyGatewayRouteStrategy{}, &legacyProxyGatewayTargetRoute{}); err != nil {
		t.Fatalf("migrate legacy target route: %v", err)
	}
	strategy := legacyProxyGatewayRouteStrategy{OrgID: 1, GatewayID: 2, Name: "existing route pool", FlagNo: 4}
	if err := db.Create(&strategy).Error; err != nil {
		t.Fatalf("create legacy strategy: %v", err)
	}
	legacy := legacyProxyGatewayTargetRoute{OrgID: 1, GatewayID: 2, Name: "existing default", Enabled: true, RouteStrategyID: strategy.ID}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatalf("create legacy target route: %v", err)
	}

	if err := db.AutoMigrate(&ProxyGatewayRouteStrategy{}, &ProxyGatewayTargetRoute{}); err != nil {
		t.Fatalf("migrate current target route: %v", err)
	}
	var migrated ProxyGatewayTargetRoute
	if err := db.First(&migrated, legacy.ID).Error; err != nil {
		t.Fatalf("load migrated target route: %v", err)
	}
	if migrated.FailoverEnabled || migrated.FallbackRouteStrategyID != nil {
		t.Fatalf("existing target route unexpectedly enabled failover: %+v", migrated)
	}
	if migrated.FailureThreshold != 2 || migrated.FailureWindowSeconds != 30 || migrated.CircuitBaseSeconds != 60 || migrated.CircuitMaxSeconds != 300 || migrated.CircuitBackoffMultiplier != 2 || migrated.CircuitJitterPercent != 10 || migrated.CircuitHalfOpenProbes != 1 {
		t.Fatalf("unexpected migrated circuit defaults: %+v", migrated)
	}
}
