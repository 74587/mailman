package api

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestValidateProxyGatewayListenerAllowsOptionalExternalPort(t *testing.T) {
	item := models.ProxyGatewayListener{
		ListenIP:     "127.0.0.1",
		Port:         18080,
		ExternalPort: 0,
		RequireAuth:  true,
	}
	if message := validateProxyGatewayListener(item); message != "" {
		t.Fatalf("expected empty external port to be valid, got %q", message)
	}

	item.ExternalPort = 32027
	if message := validateProxyGatewayListener(item); message != "" {
		t.Fatalf("expected mapped external port to be valid, got %q", message)
	}
}

func TestValidateProxyGatewayListenerRejectsInvalidExternalPort(t *testing.T) {
	item := models.ProxyGatewayListener{
		ListenIP:     "127.0.0.1",
		Port:         18080,
		ExternalPort: 70000,
		RequireAuth:  true,
	}
	if message := validateProxyGatewayListener(item); message == "" {
		t.Fatal("expected invalid external port to be rejected")
	}
}

func TestApplyProxyGatewayListenerRequestKeepsUsernameSeparatorCompatibility(t *testing.T) {
	createdByOldClient := models.ProxyGatewayListener{}
	applyListenerRequest(&createdByOldClient, proxyGatewayListenerRequest{ListenIP: "127.0.0.1", Port: 18080})
	if len(createdByOldClient.UsernameRouteSeparators) != 1 || createdByOldClient.UsernameRouteSeparators[0] != "#" {
		t.Fatalf("old client default separators=%v want=[#]", createdByOldClient.UsernameRouteSeparators)
	}

	existing := models.ProxyGatewayListener{UsernameRouteSeparators: models.StringSlice{"~", "--"}}
	applyListenerRequest(&existing, proxyGatewayListenerRequest{ListenIP: "127.0.0.1", Port: 18080})
	if len(existing.UsernameRouteSeparators) != 2 || existing.UsernameRouteSeparators[0] != "~" {
		t.Fatalf("omitted update changed separators: %v", existing.UsernameRouteSeparators)
	}

	requested := []string{" # ", "~", "#"}
	applyListenerRequest(&existing, proxyGatewayListenerRequest{
		ListenIP: "127.0.0.1", Port: 18080, UsernameRouteSeparators: &requested,
	})
	if len(existing.UsernameRouteSeparators) != 2 || existing.UsernameRouteSeparators[0] != "#" || existing.UsernameRouteSeparators[1] != "~" {
		t.Fatalf("custom separators were not normalized: %v", existing.UsernameRouteSeparators)
	}

	existing.UsernameRouteSeparators = models.StringSlice{"route"}
	if message := validateProxyGatewayListener(existing); message == "" {
		t.Fatal("expected an alphanumeric smart username separator to be rejected")
	}
}

func TestApplyProxyGatewayAccountRequestKeepsLegacyCompatibility(t *testing.T) {
	legacy := models.ProxyGatewaySelectionSourceAccount
	gateway := models.ProxyGatewaySelectionSourceGateway
	strategyMode := models.ProxyGatewayUsernameRoutingStrategy
	indexMode := models.ProxyGatewayUsernameRoutingProxyIndex
	modulo := models.ProxyGatewayIndexOverflowModulo

	createdByOldClient := models.ProxyGatewayAccount{}
	applyAccountRequest(&createdByOldClient, proxyGatewayAccountRequest{Username: "old-client"})
	if createdByOldClient.ProxySelectionSource != legacy {
		t.Fatalf("old client create source=%q want=%q", createdByOldClient.ProxySelectionSource, legacy)
	}
	if createdByOldClient.UsernameRoutingMode != strategyMode || createdByOldClient.ProxyIndexOverflowMode != models.ProxyGatewayIndexOverflowReject {
		t.Fatalf("old client username settings mode=%q overflow=%q", createdByOldClient.UsernameRoutingMode, createdByOldClient.ProxyIndexOverflowMode)
	}

	existingGatewayUser := models.ProxyGatewayAccount{ProxySelectionSource: gateway}
	applyAccountRequest(&existingGatewayUser, proxyGatewayAccountRequest{Username: "unchanged"})
	if existingGatewayUser.ProxySelectionSource != gateway {
		t.Fatalf("omitted update source=%q want=%q", existingGatewayUser.ProxySelectionSource, gateway)
	}

	explicitGatewayUser := models.ProxyGatewayAccount{}
	applyAccountRequest(&explicitGatewayUser, proxyGatewayAccountRequest{Username: "new-ui", ProxySelectionSource: &gateway})
	if explicitGatewayUser.ProxySelectionSource != gateway {
		t.Fatalf("explicit source=%q want=%q", explicitGatewayUser.ProxySelectionSource, gateway)
	}

	applyAccountRequest(&explicitGatewayUser, proxyGatewayAccountRequest{
		Username: "new-index-ui", UsernameRoutingMode: &indexMode, ProxyIndexOverflowMode: &modulo,
	})
	if explicitGatewayUser.UsernameRoutingMode != indexMode || explicitGatewayUser.ProxyIndexOverflowMode != modulo {
		t.Fatalf("explicit username settings mode=%q overflow=%q", explicitGatewayUser.UsernameRoutingMode, explicitGatewayUser.ProxyIndexOverflowMode)
	}
}

func TestValidateProxyGatewaySelectionSource(t *testing.T) {
	invalid := models.ProxyGatewaySelectionSource("intersection")
	if message := validateProxySelectionSource(&invalid); message == "" {
		t.Fatal("expected invalid proxy selection source to be rejected")
	}
	if message := validateProxySelectionSource(nil); message != "" {
		t.Fatalf("omitted source should remain compatible, got %q", message)
	}
}

func TestValidateProxyGatewayUsernameRoutingSettings(t *testing.T) {
	invalidRouting := models.ProxyGatewayUsernameRoutingMode("mixed")
	if message := validateUsernameRoutingSettings(&invalidRouting, nil); message == "" {
		t.Fatal("expected invalid username routing mode to be rejected")
	}
	invalidOverflow := models.ProxyGatewayIndexOverflowMode("clamp")
	if message := validateUsernameRoutingSettings(nil, &invalidOverflow); message == "" {
		t.Fatal("expected invalid proxy index overflow mode to be rejected")
	}
	validRouting := models.ProxyGatewayUsernameRoutingProxyIndex
	validOverflow := models.ProxyGatewayIndexOverflowModulo
	if message := validateUsernameRoutingSettings(&validRouting, &validOverflow); message != "" {
		t.Fatalf("valid username routing settings rejected: %s", message)
	}
}

func TestCreateProxyGatewayRouteStrategyReturnsConflictForDuplicateFlag(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyGatewayRouteStrategy{}); err != nil {
		t.Fatalf("migrate route strategy: %v", err)
	}
	existing := models.ProxyGatewayRouteStrategy{
		OrgID: defaultOrgID, GatewayID: 7, Name: "existing", FlagNo: 1, Enabled: true,
		SelectionMode: models.ProxyGatewaySelectionAll, SelectionAlgorithm: models.ProxyGatewayAlgorithmRandom,
	}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("create existing route strategy: %v", err)
	}

	repo := repository.NewProxyGatewayRepository(db)
	service := services.NewProxyGatewayService(repo, repository.NewProxyPoolRepository(db))
	handler := NewProxyGatewayHandlers(repo, service)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/proxy-gateway/route-strategies", strings.NewReader(`{
		"gatewayId":7,"name":"duplicate","flagNo":1,"enabled":true,"selectionMode":"all","selectionAlgorithm":"random"
	}`))
	handler.CreateRouteStrategy(recorder, request)
	if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "already exists") {
		t.Fatalf("duplicate route flag response status=%d body=%q", recorder.Code, recorder.Body.String())
	}

	exists, err := repo.RouteStrategyFlagExists(defaultOrgID, 7, 1, existing.ID)
	if err != nil || exists {
		t.Fatalf("excluding current strategy exists=%v err=%v", exists, err)
	}
}

func TestProxyGatewayReloadHandlerPropagatesListenerStartFailure(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("open sqlite connection pool: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
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
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("occupy listener port: %v", err)
	}
	defer occupied.Close()
	_, portText, _ := net.SplitHostPort(occupied.Addr().String())
	port, _ := strconv.Atoi(portText)
	listener := models.ProxyGatewayListener{
		OrgID: defaultOrgID, Name: "reload handler collision", ListenIP: "127.0.0.1", Port: port,
		Protocol: models.ProxyGatewayProtocolMixed, Enabled: true, RequireAuth: true,
	}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}

	repo := repository.NewProxyGatewayRepository(db)
	service := services.NewProxyGatewayService(repo, repository.NewProxyPoolRepository(db))
	handler := NewProxyGatewayHandlers(repo, service)
	recorder := httptest.NewRecorder()
	handler.Reload(recorder, httptest.NewRequest(http.MethodPost, "/api/proxy-gateway/reload", nil))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("reload status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), "start listener") {
		t.Fatalf("reload error did not propagate start failure: %s", recorder.Body.String())
	}
	statuses := service.Status()
	if len(statuses) != 1 || statuses[0].ListenerID != listener.ID || statuses[0].Running || statuses[0].LastError == "" {
		t.Fatalf("failed listener health status=%+v", statuses)
	}
}
