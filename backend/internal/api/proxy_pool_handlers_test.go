package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"mailman/internal/models"
	"mailman/internal/repository"
	"mailman/internal/services"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProxyMetadataHandlersUseDefaultOrgWhenContextMissing(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyGroup{}, &models.ProxyTag{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))

	createGroupReq := httptest.NewRequest(http.MethodPost, "/api/proxy-groups", bytes.NewBufferString(`{"name":"默认","color":"#64748b"}`))
	createGroupRec := httptest.NewRecorder()
	handler.CreateGroup(createGroupRec, createGroupReq)
	if createGroupRec.Code != http.StatusCreated {
		t.Fatalf("CreateGroup status = %d, body = %s", createGroupRec.Code, createGroupRec.Body.String())
	}

	var createdGroup models.ProxyGroup
	if err := json.NewDecoder(createGroupRec.Body).Decode(&createdGroup); err != nil {
		t.Fatalf("failed to decode created group: %v", err)
	}
	if createdGroup.OrgID != defaultOrgID {
		t.Fatalf("created group orgID = %d, want %d", createdGroup.OrgID, defaultOrgID)
	}

	listGroupReq := httptest.NewRequest(http.MethodGet, "/api/proxy-groups", nil)
	listGroupRec := httptest.NewRecorder()
	handler.ListGroups(listGroupRec, listGroupReq)
	if listGroupRec.Code != http.StatusOK {
		t.Fatalf("ListGroups status = %d, body = %s", listGroupRec.Code, listGroupRec.Body.String())
	}

	var groups []models.ProxyGroup
	if err := json.NewDecoder(listGroupRec.Body).Decode(&groups); err != nil {
		t.Fatalf("failed to decode groups: %v", err)
	}
	if len(groups) != 1 || groups[0].ID != createdGroup.ID {
		t.Fatalf("groups = %+v, want created group", groups)
	}

	createTagReq := httptest.NewRequest(http.MethodPost, "/api/proxy-tags", bytes.NewBufferString(`{"name":"测试","color":"#10b981"}`))
	createTagRec := httptest.NewRecorder()
	handler.CreateTag(createTagRec, createTagReq)
	if createTagRec.Code != http.StatusCreated {
		t.Fatalf("CreateTag status = %d, body = %s", createTagRec.Code, createTagRec.Body.String())
	}

	var createdTag models.ProxyTag
	if err := json.NewDecoder(createTagRec.Body).Decode(&createdTag); err != nil {
		t.Fatalf("failed to decode created tag: %v", err)
	}
	if createdTag.OrgID != defaultOrgID {
		t.Fatalf("created tag orgID = %d, want %d", createdTag.OrgID, defaultOrgID)
	}

	listTagReq := httptest.NewRequest(http.MethodGet, "/api/proxy-tags", nil)
	listTagRec := httptest.NewRecorder()
	handler.ListTags(listTagRec, listTagReq)
	if listTagRec.Code != http.StatusOK {
		t.Fatalf("ListTags status = %d, body = %s", listTagRec.Code, listTagRec.Body.String())
	}

	var tags []models.ProxyTag
	if err := json.NewDecoder(listTagRec.Body).Decode(&tags); err != nil {
		t.Fatalf("failed to decode tags: %v", err)
	}
	if len(tags) != 1 || tags[0].ID != createdTag.ID {
		t.Fatalf("tags = %+v, want created tag", tags)
	}
}

func TestProxyPoolBatchDeleteUsesAllMatchingIDs(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}, &models.ProxyPoolItemTag{}, &models.EmailAccount{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	for i := 0; i < 520; i++ {
		item := models.ProxyPoolItem{
			OrgID:  1,
			Type:   models.ProxyTypeSocks5,
			Host:   fmt.Sprintf("10.10.%d.%d", i/255, i%255),
			Port:   10000 + i,
			Status: models.ProxyStatusUnknown,
		}
		if err := db.Create(&item).Error; err != nil {
			t.Fatalf("failed to create proxy %d: %v", i, err)
		}
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/proxy-pool/batch", bytes.NewBufferString(`{"filter":{"status":"unknown"},"replacement":{"mode":"clear"}}`))
	rec := httptest.NewRecorder()
	handler.BatchDelete(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("BatchDelete status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response struct {
		Deleted int `json:"deleted"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if response.Deleted != 520 {
		t.Fatalf("deleted = %d, want 520", response.Deleted)
	}

	var remaining int64
	if err := db.Model(&models.ProxyPoolItem{}).Count(&remaining).Error; err != nil {
		t.Fatalf("failed to count remaining proxies: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("remaining proxies = %d, want 0", remaining)
	}
}

func TestProxyPoolBulkImportCanSkipDuplicates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}, &models.ProxyPoolItemTag{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	body := `{"defaultType":"socks5","duplicatePolicy":"skip","content":"192.168.0.1:8000\n192.168.0.1:8000"}`
	req := httptest.NewRequest(http.MethodPost, "/api/proxy-pool/bulk-import", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	handler.BulkImport(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("BulkImport status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response proxyBulkImportResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(response.Created) != 1 || len(response.Errors) != 0 || response.Summary["skipped"].(float64) != 1 {
		t.Fatalf("created=%d errors=%d summary=%v, want created=1 errors=0 skipped=1", len(response.Created), len(response.Errors), response.Summary)
	}
}

func TestProxyPoolBulkImportCoalescesRepeatedUpdates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}, &models.ProxyPoolItemTag{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}
	existing := models.ProxyPoolItem{OrgID: defaultOrgID, Type: models.ProxyTypeSocks5, Host: "192.168.0.1", Port: 8000, Username: "user", Password: "old", Status: models.ProxyStatusUnknown}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("create existing proxy: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	body := `{"defaultType":"socks5","duplicatePolicy":"update","content":"192.168.0.1:8000:user:first\n192.168.0.1:8000:user:second"}`
	req := httptest.NewRequest(http.MethodPost, "/api/proxy-pool/bulk-import", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handler.BulkImport(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("BulkImport status=%d body=%s", rec.Code, rec.Body.String())
	}
	var response proxyBulkImportResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Created) != 1 || response.Summary["updated"].(float64) != 2 || response.Summary["processed"].(float64) != 2 {
		t.Fatalf("response=%+v, want one unique proxy and two processed updates", response)
	}
	stored, err := repo.GetByID(defaultOrgID, existing.ID)
	if err != nil {
		t.Fatalf("reload existing proxy: %v", err)
	}
	if stored.Password != "second" {
		t.Fatalf("stored password=%q, want last update", stored.Password)
	}
}

func TestProxyPoolBulkImportRollsBackUpdatesWhenBatchInsertFails(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:proxy-import-rollback?mode=memory&cache=shared&_foreign_keys=on"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyTag{}, &models.ProxyPoolItem{}, &models.ProxyPoolItemTag{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}
	existing := models.ProxyPoolItem{OrgID: defaultOrgID, Type: models.ProxyTypeSocks5, Host: "192.168.0.1", Port: 8000, Username: "user", Password: "old", Status: models.ProxyStatusUnknown}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatalf("create existing proxy: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	body := `{"defaultType":"socks5","duplicatePolicy":"update","tagIds":[999],"content":"192.168.0.1:8000:user:new\n192.168.0.2:8001:user:pass"}`
	req := httptest.NewRequest(http.MethodPost, "/api/proxy-pool/bulk-import", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handler.BulkImport(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("BulkImport status=%d body=%s, want 500", rec.Code, rec.Body.String())
	}
	stored, err := repo.GetByID(defaultOrgID, existing.ID)
	if err != nil {
		t.Fatalf("reload existing proxy: %v", err)
	}
	if stored.Password != "old" {
		t.Fatalf("existing proxy was partially updated: password=%q", stored.Password)
	}
	var count int64
	if err := db.Model(&models.ProxyPoolItem{}).Count(&count).Error; err != nil {
		t.Fatalf("count proxies: %v", err)
	}
	if count != 1 {
		t.Fatalf("proxy count=%d, want only the original row", count)
	}
}

func TestProxyPoolBulkImportAcceptsMoreThanLegacyFiveHundredLimit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}, &models.ProxyPoolItemTag{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	lines := make([]string, 0, 2000)
	for i := 0; i < 2000; i++ {
		lines = append(lines, fmt.Sprintf("10.%d.%d.%d:%d", (i/65536)%256, (i/256)%256, i%256, 10000+i))
	}
	body, err := json.Marshal(map[string]interface{}{
		"defaultType":     "socks5",
		"duplicatePolicy": "skip",
		"content":         strings.Join(lines, "\n"),
	})
	if err != nil {
		t.Fatalf("marshal import body: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	req := httptest.NewRequest(http.MethodPost, "/api/proxy-pool/bulk-import", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	handler.BulkImport(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("BulkImport status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var response proxyBulkImportResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Created) != 2000 || len(response.Errors) != 0 {
		t.Fatalf("created=%d errors=%d, want 2000 and 0", len(response.Created), len(response.Errors))
	}
	var count int64
	if err := db.Model(&models.ProxyPoolItem{}).Count(&count).Error; err != nil {
		t.Fatalf("count imported proxies: %v", err)
	}
	if count != 2000 {
		t.Fatalf("database count=%d, want 2000", count)
	}
}

func TestProxyPoolListDoesNotClampRequestedPageSize(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}
	items := make([]models.ProxyPoolItem, 0, 620)
	for i := 0; i < 620; i++ {
		items = append(items, models.ProxyPoolItem{OrgID: defaultOrgID, Type: models.ProxyTypeHTTP, Host: fmt.Sprintf("page-%d.example", i), Port: 8000 + i, Status: models.ProxyStatusUnknown})
	}
	if err := db.CreateInBatches(&items, 200).Error; err != nil {
		t.Fatalf("create proxies: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	req := httptest.NewRequest(http.MethodGet, "/api/proxy-pool?page=1&limit=620", nil)
	rec := httptest.NewRecorder()
	handler.ListProxies(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ListProxies status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response proxyListResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Items) != 620 || response.Limit != 620 || response.Page != 1 {
		t.Fatalf("items=%d page=%d limit=%d, want 620/1/620", len(response.Items), response.Page, response.Limit)
	}
}

func TestProxyCheckChannelsAreConfigurableAndCredentialsAreNotReturned(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyCheckChannel{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}
	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))

	listReq := httptest.NewRequest(http.MethodGet, "/api/proxy-pool/check-channels?includeDisabled=true", nil)
	listRec := httptest.NewRecorder()
	handler.GetCheckChannels(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("GetCheckChannels status=%d body=%s", listRec.Code, listRec.Body.String())
	}
	var defaults []models.ProxyCheckChannel
	if err := json.NewDecoder(listRec.Body).Decode(&defaults); err != nil {
		t.Fatalf("decode defaults: %v", err)
	}
	if len(defaults) < 10 || defaults[0].Key != "ip-sb" {
		t.Fatalf("unexpected default channels: %+v", defaults)
	}
	defaultsByKey := make(map[string]models.ProxyCheckChannel, len(defaults))
	for _, channel := range defaults {
		defaultsByKey[channel.Key] = channel
	}
	if defaultsByKey["ipqualityscore"].Enabled {
		t.Fatal("credentialed IPQualityScore channel must be disabled until configured")
	}
	if defaultsByKey["ip-api"].SupportsIPv6 {
		t.Fatal("ip-api self-check channel must not be offered for IPv6 egress checks")
	}
	if got := defaultsByKey["db-ip"].URLTemplate; got != "http://api.db-ip.com/v2/free/self" {
		t.Fatalf("DB-IP free endpoint=%q, want documented HTTP endpoint", got)
	}

	createBody := `{"key":"custom-dual","name":"Custom Dual","provider":"example.test","mode":"self","urlTemplate":"https://example.test/me","method":"GET","responseFormat":"json","ipField":"data.ip","authType":"header","authName":"X-API-Key","credential":"secret-value","enabled":true,"supportsIPv4":true,"supportsIPv6":true,"timeoutSeconds":8,"sortOrder":5}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/proxy-pool/check-channels", strings.NewReader(createBody))
	createRec := httptest.NewRecorder()
	handler.CreateCheckChannel(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("CreateCheckChannel status=%d body=%s", createRec.Code, createRec.Body.String())
	}
	if strings.Contains(createRec.Body.String(), "secret-value") {
		t.Fatal("channel response exposed its credential")
	}
	var created models.ProxyCheckChannel
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode created channel: %v", err)
	}
	if !created.HasCredential || created.Key != "custom-dual" {
		t.Fatalf("created channel=%+v", created)
	}

	stored, err := repo.GetCheckChannelByID(defaultOrgID, created.ID)
	if err != nil {
		t.Fatalf("load stored channel: %v", err)
	}
	if stored.AuthValue == "" {
		t.Fatal("stored channel credential is empty")
	}
}

func TestProxyCheckChannelValidationRejectsBrokenEnabledPathAuthAndExcessiveTimeout(t *testing.T) {
	base := proxyCheckChannelRequest{
		Key: "custom", Name: "Custom", Mode: "lookup", URLTemplate: "https://example.test/{{credential}}/{{ip}}",
		Method: http.MethodGet, ResponseFormat: "json", AuthType: "path", Enabled: true,
		SupportsIPv4: true, SupportsIPv6: true, TimeoutSeconds: 12,
	}
	if err := applyProxyCheckChannelRequest(&models.ProxyCheckChannel{}, base, true); err == nil || !strings.Contains(err.Error(), "require a credential") {
		t.Fatalf("path auth validation error=%v", err)
	}
	credential := "secret"
	base.Credential = &credential
	base.TimeoutSeconds = 121
	if err := applyProxyCheckChannelRequest(&models.ProxyCheckChannel{}, base, true); err == nil || !strings.Contains(err.Error(), "cannot exceed 120") {
		t.Fatalf("timeout validation error=%v", err)
	}
	base.TimeoutSeconds = 12
	base.URLTemplate = "https://user:password@example.test/{{credential}}/{{ip}}"
	if err := applyProxyCheckChannelRequest(&models.ProxyCheckChannel{}, base, true); err == nil || !strings.Contains(err.Error(), "embedded credentials") {
		t.Fatalf("embedded credential validation error=%v", err)
	}
}

func TestProxyCheckChannelTrialReturnsRawRegexDiagnosticsWithoutMutatingProxy(t *testing.T) {
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		if r.URL.Path == "/conflict" {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`channel quota exhausted`))
			return
		}
		_, _ = w.Write([]byte(`IP=203.0.113.42; country=SG; status=ok`))
	}))
	defer proxyServer.Close()
	proxyURL, err := url.Parse(proxyServer.URL)
	if err != nil {
		t.Fatalf("parse proxy URL: %v", err)
	}
	proxyPort, err := strconv.Atoi(proxyURL.Port())
	if err != nil {
		t.Fatalf("parse proxy port: %v", err)
	}

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}, &models.ProxyCheckChannel{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	proxyItem := models.ProxyPoolItem{OrgID: defaultOrgID, Type: models.ProxyTypeHTTP, Host: proxyURL.Hostname(), Port: proxyPort, Status: models.ProxyStatusUnknown}
	if err := db.Create(&proxyItem).Error; err != nil {
		t.Fatalf("create proxy: %v", err)
	}
	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	body := fmt.Sprintf(`{"proxyId":%d,"channel":{"key":"regex-preview","name":"Regex preview","mode":"self","urlTemplate":"http://public-channel.example/check","method":"GET","responseFormat":"regex","responseRegex":"IP=([0-9.]+); country=([^;]+); status=(\\w+)","ipField":"$1","countryField":"$2","statusField":"$3","failureValue":"fail","authType":"none","enabled":true,"supportsIPv4":true,"supportsIPv6":true,"timeoutSeconds":3}}`, proxyItem.ID)
	req := httptest.NewRequest(http.MethodPost, "/api/proxy-pool/check-channels/test", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handler.TestCheckChannel(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("TestCheckChannel status=%d body=%s", rec.Code, rec.Body.String())
	}
	var result services.ProxyCheckChannelTestResult
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode trial result: %v", err)
	}
	if !result.Success || result.HTTPStatus != http.StatusOK || result.ExitIP != "203.0.113.42" || result.Country != "SG" || result.StatusValue != "ok" {
		t.Fatalf("trial result=%+v", result)
	}
	if result.RawBody != `IP=203.0.113.42; country=SG; status=ok` || len(result.Captures) != 4 || result.UsedProxyID != proxyItem.ID {
		t.Fatalf("trial diagnostics=%+v", result)
	}
	stored, err := repo.GetByID(defaultOrgID, proxyItem.ID)
	if err != nil {
		t.Fatalf("reload proxy: %v", err)
	}
	if stored.Status != models.ProxyStatusUnknown || stored.CheckCount != 0 || stored.LastCheckAt != nil {
		t.Fatalf("channel trial mutated proxy: %+v", stored)
	}

	conflictReq := httptest.NewRequest(http.MethodPost, "/api/proxy-pool/check-channels/test", strings.NewReader(strings.Replace(body, "/check", "/conflict", 1)))
	conflictRec := httptest.NewRecorder()
	handler.TestCheckChannel(conflictRec, conflictReq)
	if conflictRec.Code != http.StatusOK {
		t.Fatalf("conflict trial status=%d body=%s", conflictRec.Code, conflictRec.Body.String())
	}
	var conflictResult services.ProxyCheckChannelTestResult
	if err := json.NewDecoder(conflictRec.Body).Decode(&conflictResult); err != nil {
		t.Fatalf("decode conflict result: %v", err)
	}
	if conflictResult.Success || conflictResult.HTTPStatus != http.StatusConflict || conflictResult.RawBody != "channel quota exhausted" || !strings.Contains(conflictResult.Error, "HTTP 409") {
		t.Fatalf("conflict diagnostics=%+v, want HTTP status and raw response", conflictResult)
	}
}

func TestProxyCheckChannelValidationRejectsInvalidRegexAndUnpairedFailureRule(t *testing.T) {
	base := proxyCheckChannelRequest{
		Key: "regex", Name: "Regex", Mode: "self", URLTemplate: "https://example.test/me", Method: http.MethodGet,
		ResponseFormat: "regex", ResponseRegex: "(", IPField: "$1", AuthType: "none", Enabled: true, SupportsIPv4: true, TimeoutSeconds: 12,
	}
	if err := applyProxyCheckChannelRequest(&models.ProxyCheckChannel{}, base, true); err == nil || !strings.Contains(err.Error(), "invalid response regex") {
		t.Fatalf("invalid regex error=%v", err)
	}
	base.ResponseRegex = `IP=([0-9.]+)`
	base.StatusField = "$2"
	if err := applyProxyCheckChannelRequest(&models.ProxyCheckChannel{}, base, true); err == nil || !strings.Contains(err.Error(), "configured together") {
		t.Fatalf("unpaired failure rule error=%v", err)
	}
}

func TestUniqueProxyImportIDsDropsZeroAndDuplicates(t *testing.T) {
	got := uniqueProxyImportIDs([]uint{0, 3, 3, 2, 0})
	if len(got) != 2 || got[0] != 3 || got[1] != 2 {
		t.Fatalf("unique IDs=%v, want [3 2]", got)
	}
}

func TestProxyPoolListReturnsFilteredTrafficSummaryAcrossPages(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open sqlite test db: %v", err)
	}
	if err := db.AutoMigrate(&models.ProxyPoolItem{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := repository.NewProxyPoolRepository(db)
	handler := NewProxyPoolHandlers(repo, services.NewProxyPoolService(repo, nil))
	items := []models.ProxyPoolItem{
		{OrgID: defaultOrgID, Type: models.ProxyTypeSocks5, Host: "summary-a.example", Port: 1080, Status: models.ProxyStatusAvailable, TrafficBytesIn: 100, TrafficBytesOut: 200},
		{OrgID: defaultOrgID, Type: models.ProxyTypeHTTP, Host: "summary-b.example", Port: 8080, Status: models.ProxyStatusAvailable, TrafficBytesIn: 300, TrafficBytesOut: 400},
		{OrgID: defaultOrgID, Type: models.ProxyTypeHTTP, Host: "summary-c.example", Port: 8081, Status: models.ProxyStatusUnavailable, TrafficBytesIn: 500, TrafficBytesOut: 600},
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatalf("create proxies: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/proxy-pool?status=available&page=1&limit=1", nil)
	rec := httptest.NewRecorder()
	handler.ListProxies(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ListProxies status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var response proxyListResponse
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatalf("decode proxy list: %v", err)
	}
	if len(response.Items) != 1 || response.Total != 2 {
		t.Fatalf("page items=%d total=%d, want 1 and 2", len(response.Items), response.Total)
	}
	if response.TrafficSummary.TrafficBytesIn != 400 || response.TrafficSummary.TrafficBytesOut != 600 {
		t.Fatalf("traffic summary = %+v, want in=400 out=600", response.TrafficSummary)
	}
}
