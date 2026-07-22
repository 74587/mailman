package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"github.com/gorilla/mux"
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
	fallbackStrategy := models.ProxyGatewayRouteStrategy{
		OrgID: defaultOrgID, GatewayID: listener.ID, Name: "IPv4 fallback", FlagNo: 52, Enabled: true,
		SelectionMode: models.ProxyGatewaySelectionAll, SelectionAlgorithm: models.ProxyGatewayAlgorithmRandom,
		FallbackMode: models.ProxyGatewayFallbackInterrupt,
	}
	if err := db.Create(&fallbackStrategy).Error; err != nil {
		t.Fatalf("create fallback strategy: %v", err)
	}
	secondFallbackStrategy := models.ProxyGatewayRouteStrategy{
		OrgID: defaultOrgID, GatewayID: listener.ID, Name: "IPv4 secondary fallback", FlagNo: 53, Enabled: true,
		SelectionMode: models.ProxyGatewaySelectionAll, SelectionAlgorithm: models.ProxyGatewayAlgorithmRandom,
		FallbackMode: models.ProxyGatewayFallbackInterrupt,
	}
	if err := db.Create(&secondFallbackStrategy).Error; err != nil {
		t.Fatalf("create second fallback strategy: %v", err)
	}

	repo := repository.NewProxyGatewayRepository(db)
	service := services.NewProxyGatewayService(repo, repository.NewProxyPoolRepository(db))
	handler := NewProxyGatewayHandlers(repo, service)

	createBody := fmt.Sprintf(`{"gatewayId":%d,"name":"IPv4 services","enabled":true,"sortOrder":10,"matchers":[" API.Example.COM. ","203.0.113.9/24"],"routeStrategyId":%d,"failoverEnabled":true,"fallbackRouteStrategyId":%d,"failureThreshold":3,"failureWindowSeconds":45,"circuitBaseSeconds":60,"circuitMaxSeconds":300,"circuitBackoffMultiplier":2,"circuitJitterPercent":10,"circuitHalfOpenProbes":1}`, listener.ID, strategy.ID, fallbackStrategy.ID)
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
	if !created.FailoverEnabled || created.FallbackRouteStrategy == nil || created.FallbackRouteStrategy.ID != fallbackStrategy.ID || created.FailureThreshold != 3 {
		t.Fatalf("persisted failover config=%+v", created)
	}
	if count, err := repo.CountEnabledTargetRoutesByStrategy(defaultOrgID, fallbackStrategy.ID); err != nil || count != 1 {
		t.Fatalf("fallback route reference count=%d err=%v", count, err)
	}
	if gatewayIDs, err := repo.ListEnabledTargetRouteGatewayIDsByStrategy(defaultOrgID, fallbackStrategy.ID); err != nil || len(gatewayIDs) != 1 || gatewayIDs[0] != listener.ID {
		t.Fatalf("fallback route gateway IDs=%v err=%v", gatewayIDs, err)
	}

	updateBody := fmt.Sprintf(`{"gatewayId":%d,"name":"IPv4 services updated","enabled":true,"sortOrder":11,"matchers":["api.example.com"],"routeStrategyId":%d,"failoverEnabled":true,"fallbackRouteStrategyId":%d,"failureThreshold":2,"failureWindowSeconds":30,"circuitBaseSeconds":60,"circuitMaxSeconds":300,"circuitBackoffMultiplier":2,"circuitJitterPercent":10,"circuitHalfOpenProbes":1}`, listener.ID, fallbackStrategy.ID, secondFallbackStrategy.ID)
	updateReq := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/proxy-gateway/target-routes/%d", created.ID), bytes.NewBufferString(updateBody))
	updateReq = mux.SetURLVars(updateReq, map[string]string{"id": fmt.Sprint(created.ID)})
	updateRec := httptest.NewRecorder()
	handler.UpdateTargetRoute(updateRec, updateReq)
	if updateRec.Code != http.StatusOK {
		t.Fatalf("update target route status=%d body=%s", updateRec.Code, updateRec.Body.String())
	}
	var updated models.ProxyGatewayTargetRoute
	if err := json.NewDecoder(updateRec.Body).Decode(&updated); err != nil {
		t.Fatalf("decode updated target route: %v", err)
	}
	if updated.RouteStrategyID != fallbackStrategy.ID || updated.RouteStrategy == nil || updated.RouteStrategy.ID != fallbackStrategy.ID ||
		updated.FallbackRouteStrategyID == nil || *updated.FallbackRouteStrategyID != secondFallbackStrategy.ID || updated.FallbackRouteStrategy == nil || updated.FallbackRouteStrategy.ID != secondFallbackStrategy.ID {
		t.Fatalf("updated route associations were overwritten by stale preloads: %+v", updated)
	}

	invalidBody := fmt.Sprintf(`{"gatewayId":%d,"name":"catch all","enabled":true,"sortOrder":20,"matchers":["*"],"routeStrategyId":%d}`, listener.ID, strategy.ID)
	invalidReq := httptest.NewRequest(http.MethodPost, "/api/proxy-gateway/target-routes", bytes.NewBufferString(invalidBody))
	invalidRec := httptest.NewRecorder()
	handler.CreateTargetRoute(invalidRec, invalidReq)
	if invalidRec.Code != http.StatusBadRequest {
		t.Fatalf("catch-all status=%d body=%s", invalidRec.Code, invalidRec.Body.String())
	}

	selfFallbackBody := fmt.Sprintf(`{"gatewayId":%d,"name":"self fallback","enabled":true,"sortOrder":20,"matchers":["self.example.com"],"routeStrategyId":%d,"failoverEnabled":true,"fallbackRouteStrategyId":%d}`, listener.ID, strategy.ID, strategy.ID)
	selfFallbackReq := httptest.NewRequest(http.MethodPost, "/api/proxy-gateway/target-routes", bytes.NewBufferString(selfFallbackBody))
	selfFallbackRec := httptest.NewRecorder()
	handler.CreateTargetRoute(selfFallbackRec, selfFallbackReq)
	if selfFallbackRec.Code != http.StatusBadRequest {
		t.Fatalf("self fallback status=%d body=%s", selfFallbackRec.Code, selfFallbackRec.Body.String())
	}

	invalidBackoffBody := fmt.Sprintf(`{"gatewayId":%d,"name":"invalid backoff","enabled":true,"sortOrder":20,"matchers":["backoff.example.com"],"routeStrategyId":%d,"failoverEnabled":true,"fallbackRouteStrategyId":%d,"circuitBaseSeconds":300,"circuitMaxSeconds":60}`, listener.ID, strategy.ID, fallbackStrategy.ID)
	invalidBackoffReq := httptest.NewRequest(http.MethodPost, "/api/proxy-gateway/target-routes", bytes.NewBufferString(invalidBackoffBody))
	invalidBackoffRec := httptest.NewRecorder()
	handler.CreateTargetRoute(invalidBackoffRec, invalidBackoffReq)
	if invalidBackoffRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid backoff status=%d body=%s", invalidBackoffRec.Code, invalidBackoffRec.Body.String())
	}

	disabledFailoverBody := fmt.Sprintf(`{"gatewayId":%d,"name":"disabled failover","enabled":true,"sortOrder":30,"matchers":["disabled.example.com"],"routeStrategyId":%d,"failoverEnabled":false,"fallbackRouteStrategyId":%d}`, listener.ID, strategy.ID, secondFallbackStrategy.ID)
	disabledFailoverReq := httptest.NewRequest(http.MethodPost, "/api/proxy-gateway/target-routes", bytes.NewBufferString(disabledFailoverBody))
	disabledFailoverRec := httptest.NewRecorder()
	handler.CreateTargetRoute(disabledFailoverRec, disabledFailoverReq)
	if disabledFailoverRec.Code != http.StatusCreated {
		t.Fatalf("disabled failover status=%d body=%s", disabledFailoverRec.Code, disabledFailoverRec.Body.String())
	}
	var disabledFailover models.ProxyGatewayTargetRoute
	if err := json.NewDecoder(disabledFailoverRec.Body).Decode(&disabledFailover); err != nil {
		t.Fatalf("decode disabled failover route: %v", err)
	}
	if disabledFailover.FallbackRouteStrategyID != nil || disabledFailover.FallbackRouteStrategy != nil {
		t.Fatalf("disabled failover retained an inactive strategy reference: %+v", disabledFailover)
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

	if err := repo.ReorderTargetRoutes(defaultOrgID, listener.ID, []uint{disabledFailover.ID, created.ID, firstDefault.ID}); err != nil {
		t.Fatalf("reorder target routes: %v", err)
	}
	reordered, err := repo.ListTargetRoutes(defaultOrgID, &listener.ID)
	if err != nil {
		t.Fatalf("list reordered target routes: %v", err)
	}
	if len(reordered) != 4 || reordered[0].ID != disabledFailover.ID || reordered[0].SortOrder != 10 || reordered[1].ID != created.ID || reordered[1].SortOrder != 20 || reordered[2].ID != firstDefault.ID || reordered[2].SortOrder != 30 || !reordered[len(reordered)-1].IsDefault || reordered[len(reordered)-1].SortOrder != 40 {
		t.Fatalf("unexpected reordered routes: %+v", reordered)
	}
	if err := repo.ReorderTargetRoutes(defaultOrgID, listener.ID, []uint{created.ID, created.ID, firstDefault.ID}); !errors.Is(err, repository.ErrTargetRouteOrderConflict) {
		t.Fatalf("duplicate reorder error=%v", err)
	}
	afterConflict, err := repo.ListTargetRoutes(defaultOrgID, &listener.ID)
	if err != nil || afterConflict[0].ID != disabledFailover.ID || afterConflict[0].SortOrder != 10 {
		t.Fatalf("invalid reorder was not atomic: routes=%+v err=%v", afterConflict, err)
	}

	if err := repo.DeleteRouteStrategy(defaultOrgID, strategy.ID); err == nil {
		t.Fatal("expected referenced route strategy deletion to fail")
	}
	if err := repo.DeleteRouteStrategy(defaultOrgID, fallbackStrategy.ID); err == nil {
		t.Fatal("expected referenced fallback route strategy deletion to fail")
	}
	if err := repo.DeleteRouteStrategy(defaultOrgID, secondFallbackStrategy.ID); err == nil {
		t.Fatal("expected referenced second fallback route strategy deletion to fail")
	}
}
