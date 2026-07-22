package api

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"github.com/gorilla/mux"
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

func TestGatewayLogFilterFromRequestParsesStructuredFilters(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/proxy-gateway/logs?"+
		"page=2&limit=25&listenerId=11&accountId=21&accountName=operations&"+
		"sourceIp=203.0.113.10&target=%5Eapi%5C.example%5C.com%24&targetMatch=regex&"+
		"status=failed&protocol=socks5&startTime=2026-07-22T08%3A00%3A00Z&endTime=2026-07-22T09%3A00%3A00Z", nil)
	filter, err := gatewayLogFilterFromRequest(request)
	if err != nil {
		t.Fatalf("parse gateway log filters: %v", err)
	}
	if filter.Page != 2 || filter.Limit != 25 || filter.ListenerID == nil || *filter.ListenerID != 11 || filter.AccountID == nil || *filter.AccountID != 21 {
		t.Fatalf("pagination or IDs not parsed: %+v", filter)
	}
	if filter.AccountName != "operations" || filter.SourceIP != "203.0.113.10" || filter.TargetMatch != "regex" || filter.Status != "failed" || filter.Protocol != "socks5" {
		t.Fatalf("structured filters not parsed: %+v", filter)
	}
	if filter.StartTime == nil || filter.EndTime == nil || !filter.EndTime.Equal(filter.StartTime.Add(time.Hour)) {
		t.Fatalf("time range not parsed: start=%v end=%v", filter.StartTime, filter.EndTime)
	}
}

func TestGatewayLogFilterFromRequestRejectsInvalidRangesAndPatterns(t *testing.T) {
	tests := []string{
		"target=%28&targetMatch=regex",
		"target=test&targetMatch=contains",
		"accountId=zero",
		"startTime=2026-07-22T10%3A00%3A00Z&endTime=2026-07-22T09%3A00%3A00Z",
	}
	for _, query := range tests {
		request := httptest.NewRequest(http.MethodGet, "/api/proxy-gateway/logs?"+query, nil)
		if _, err := gatewayLogFilterFromRequest(request); err == nil {
			t.Fatalf("query %q should be rejected", query)
		}
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

func TestProxyGatewayAccountRouteStrategyOverridesValidateAndPersist(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:account-route-overrides?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.ProxyGatewayListener{},
		&models.ProxyGatewayAccount{},
		&models.ProxyGatewayRouteStrategy{},
		&models.ProxyGatewayAccountRouteStrategyOverride{},
		&models.ProxyGatewayTargetRoute{},
		&models.ProxyGatewayAccountGroup{},
		&models.ProxyGatewayAccountTag{},
		&models.ProxyGatewayAccountTagLink{},
		&models.ProxyGatewaySecurityPolicy{},
		&models.ProxyGatewayDNSPolicy{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	listener := models.ProxyGatewayListener{OrgID: defaultOrgID, Name: "override gateway", ListenIP: "127.0.0.1", Port: 18171, Protocol: models.ProxyGatewayProtocolMixed}
	otherListener := models.ProxyGatewayListener{OrgID: defaultOrgID, Name: "other gateway", ListenIP: "127.0.0.1", Port: 18172, Protocol: models.ProxyGatewayProtocolMixed}
	if err := db.Create(&listener).Error; err != nil {
		t.Fatalf("create listener: %v", err)
	}
	if err := db.Create(&otherListener).Error; err != nil {
		t.Fatalf("create other listener: %v", err)
	}
	source := models.ProxyGatewayRouteStrategy{OrgID: defaultOrgID, GatewayID: listener.ID, Name: "shared", FlagNo: 1, Enabled: true}
	replacement := models.ProxyGatewayRouteStrategy{OrgID: defaultOrgID, GatewayID: listener.ID, Name: "account pool", FlagNo: 2, Enabled: true}
	wrongGateway := models.ProxyGatewayRouteStrategy{OrgID: defaultOrgID, GatewayID: otherListener.ID, Name: "wrong", FlagNo: 1, Enabled: true}
	for _, strategy := range []*models.ProxyGatewayRouteStrategy{&source, &replacement, &wrongGateway} {
		if err := db.Create(strategy).Error; err != nil {
			t.Fatalf("create route strategy %s: %v", strategy.Name, err)
		}
	}
	repo := repository.NewProxyGatewayRepository(db)
	handler := NewProxyGatewayHandlers(repo, services.NewProxyGatewayService(repo, repository.NewProxyPoolRepository(db)))
	account := models.ProxyGatewayAccount{
		OrgID: defaultOrgID, Username: "override-user", Enabled: true,
		ProxySelectionSource: models.ProxyGatewaySelectionSourceGateway,
		AllowedGatewayIDs:    models.UintSlice{listener.ID},
	}
	overrides := []models.ProxyGatewayAccountRouteStrategyOverride{{
		GatewayID: listener.ID, SourceRouteStrategyID: source.ID, ReplacementRouteStrategyID: replacement.ID,
	}}
	if err := handler.validateAccountRouteStrategyOverrides(defaultOrgID, &account, overrides); err != nil {
		t.Fatalf("valid route strategy override rejected: %v", err)
	}
	duplicate := append(append([]models.ProxyGatewayAccountRouteStrategyOverride{}, overrides...), overrides[0])
	if err := handler.validateAccountRouteStrategyOverrides(defaultOrgID, &account, duplicate); err == nil || !strings.Contains(err.Error(), "duplicates") {
		t.Fatalf("duplicate override error=%v", err)
	}
	crossGateway := []models.ProxyGatewayAccountRouteStrategyOverride{{
		GatewayID: listener.ID, SourceRouteStrategyID: source.ID, ReplacementRouteStrategyID: wrongGateway.ID,
	}}
	if err := handler.validateAccountRouteStrategyOverrides(defaultOrgID, &account, crossGateway); err == nil || !strings.Contains(err.Error(), "another gateway") {
		t.Fatalf("cross-gateway replacement error=%v", err)
	}
	if err := repo.SaveAccount(&account); err != nil {
		t.Fatalf("save account: %v", err)
	}
	if err := repo.SetAccountRouteStrategyOverrides(defaultOrgID, account.ID, overrides); err != nil {
		t.Fatalf("persist route strategy override: %v", err)
	}
	loaded, err := repo.GetAccount(defaultOrgID, account.ID)
	if err != nil {
		t.Fatalf("reload account: %v", err)
	}
	if len(loaded.RouteStrategyOverrides) != 1 || loaded.RouteStrategyOverrides[0].ReplacementRouteStrategy == nil || loaded.RouteStrategyOverrides[0].ReplacementRouteStrategy.ID != replacement.ID {
		t.Fatalf("persisted override relation=%+v", loaded.RouteStrategyOverrides)
	}
	updateRequest := httptest.NewRequest(http.MethodPut, "/api/proxy-gateway/accounts/1", strings.NewReader(`{"username":"override-user","enabled":true}`))
	updateRequest = mux.SetURLVars(updateRequest, map[string]string{"id": strconv.FormatUint(uint64(account.ID), 10)})
	updateRecorder := httptest.NewRecorder()
	handler.UpdateAccount(updateRecorder, updateRequest)
	if updateRecorder.Code != http.StatusOK {
		t.Fatalf("legacy account update status=%d body=%s", updateRecorder.Code, updateRecorder.Body.String())
	}
	var overrideCount int64
	if err := db.Model(&models.ProxyGatewayAccountRouteStrategyOverride{}).Where("account_id = ?", account.ID).Count(&overrideCount).Error; err != nil || overrideCount != 1 {
		t.Fatalf("omitted override update changed stored mappings count=%d err=%v", overrideCount, err)
	}
	account.ProxySelectionSource = models.ProxyGatewaySelectionSourceAccount
	if err := repo.SaveAccount(&account); err != nil {
		t.Fatalf("switch account to legacy source: %v", err)
	}
	if err := db.Model(&models.ProxyGatewayAccountRouteStrategyOverride{}).
		Where("account_id = ?", account.ID).
		Update("replacement_route_strategy_id", wrongGateway.ID).Error; err != nil {
		t.Fatalf("seed inactive invalid override: %v", err)
	}
	gatewaySource := models.ProxyGatewaySelectionSourceGateway
	switchBody := fmt.Sprintf(`{"username":"override-user","enabled":true,"proxySelectionSource":%q}`, gatewaySource)
	switchRequest := httptest.NewRequest(http.MethodPut, "/api/proxy-gateway/accounts/1", strings.NewReader(switchBody))
	switchRequest = mux.SetURLVars(switchRequest, map[string]string{"id": strconv.FormatUint(uint64(account.ID), 10)})
	switchRecorder := httptest.NewRecorder()
	handler.UpdateAccount(switchRecorder, switchRequest)
	if switchRecorder.Code != http.StatusBadRequest || !strings.Contains(switchRecorder.Body.String(), "another gateway") {
		t.Fatalf("switching to gateway source accepted invalid preserved override status=%d body=%s", switchRecorder.Code, switchRecorder.Body.String())
	}
	if err := db.Model(&models.ProxyGatewayAccountRouteStrategyOverride{}).
		Where("account_id = ?", account.ID).
		Update("replacement_route_strategy_id", replacement.ID).Error; err != nil {
		t.Fatalf("restore valid override: %v", err)
	}
	if err := repo.DeleteRouteStrategy(defaultOrgID, replacement.ID); err == nil || !strings.Contains(err.Error(), "account override") {
		t.Fatalf("referenced replacement deletion error=%v", err)
	}
	if err := repo.DeleteListener(defaultOrgID, listener.ID); err != nil {
		t.Fatalf("delete listener: %v", err)
	}
	if err := db.Model(&models.ProxyGatewayAccountRouteStrategyOverride{}).Where("gateway_id = ?", listener.ID).Count(&overrideCount).Error; err != nil || overrideCount != 0 {
		t.Fatalf("listener deletion left stale account overrides count=%d err=%v", overrideCount, err)
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
