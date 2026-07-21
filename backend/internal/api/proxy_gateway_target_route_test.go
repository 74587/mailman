package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProxyGatewayTargetRouteHandlersValidateAndPersistRules(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:target-route-api?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.ProxyGatewayListener{},
		&models.ProxyGatewayRouteStrategy{},
		&models.ProxyGatewayTargetRoute{},
		&models.ProxyGatewaySecurityPolicy{},
		&models.ProxyGatewayDNSPolicy{},
		&models.ProxyGatewayAuditLog{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	listener := models.ProxyGatewayListener{OrgID: defaultOrgID, Name: "api gateway", ListenIP: "127.0.0.1", Port: 18100, Protocol: models.ProxyGatewayProtocolMixed}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}
	strategy := models.ProxyGatewayRouteStrategy{
		OrgID: defaultOrgID, GatewayID: listener.ID, Name: "IPv4 pool", FlagNo: 51, Enabled: true,
		SelectionMode: models.ProxyGatewaySelectionAll, SelectionAlgorithm: models.ProxyGatewayAlgorithmRandom,
		FallbackMode: models.ProxyGatewayFallbackInterrupt,
	}
	if err := db.Create(&strategy).Error; err != nil {
		t.Fatalf("create strategy: %v", err)
	}

	repo := repository.NewProxyGatewayRepository(db)
	service := services.NewProxyGatewayService(repo, repository.NewProxyPoolRepository(db))
	handler := NewProxyGatewayHandlers(repo, service)

	createBody := fmt.Sprintf(`{"gatewayId":%d,"name":"IPv4 services","enabled":true,"sortOrder":10,"matchers":[" API.Example.COM. ","203.0.113.9/24"],"routeStrategyId":%d}`, listener.ID, strategy.ID)
	createReq := httptest.NewRequest(http.MethodPost, "/api/proxy-gateway/target-routes", bytes.NewBufferString(createBody))
	createRec := httptest.NewRecorder()
	handler.CreateTargetRoute(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("create target route status=%d body=%s", createRec.Code, createRec.Body.String())
	}
	var created models.ProxyGatewayTargetRoute
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created target route: %v", err)
	}
	if got, want := []string(created.Matchers), []string{"api.example.com", "203.0.113.0/24"}; fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("normalized matchers=%v want=%v", got, want)
	}

	invalidBody := fmt.Sprintf(`{"gatewayId":%d,"name":"catch all","enabled":true,"sortOrder":20,"matchers":["*"],"routeStrategyId":%d}`, listener.ID, strategy.ID)
	invalidReq := httptest.NewRequest(http.MethodPost, "/api/proxy-gateway/target-routes", bytes.NewBufferString(invalidBody))
	invalidRec := httptest.NewRecorder()
	handler.CreateTargetRoute(invalidRec, invalidReq)
	if invalidRec.Code != http.StatusBadRequest {
		t.Fatalf("catch-all status=%d body=%s", invalidRec.Code, invalidRec.Body.String())
	}

	firstDefault := models.ProxyGatewayTargetRoute{OrgID: defaultOrgID, GatewayID: listener.ID, Name: "default one", Enabled: true, IsDefault: true, SortOrder: 100, RouteStrategyID: strategy.ID}
	secondDefault := models.ProxyGatewayTargetRoute{OrgID: defaultOrgID, GatewayID: listener.ID, Name: "default two", Enabled: true, IsDefault: true, SortOrder: 100, RouteStrategyID: strategy.ID}
	if err := repo.SaveTargetRoute(&firstDefault); err != nil {
		t.Fatalf("save first default: %v", err)
	}
	if err := repo.SaveTargetRoute(&secondDefault); err != nil {
		t.Fatalf("save second default: %v", err)
	}
	var reloadedFirst models.ProxyGatewayTargetRoute
	if err := db.First(&reloadedFirst, firstDefault.ID).Error; err != nil {
		t.Fatalf("reload first default: %v", err)
	}
	if reloadedFirst.IsDefault {
		t.Fatal("saving a second default did not clear the first default")
	}

	if err := repo.DeleteRouteStrategy(defaultOrgID, strategy.ID); err == nil {
		t.Fatal("expected referenced route strategy deletion to fail")
	}
}
