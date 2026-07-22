package repository

import (
	"testing"
	"time"

	"mailman/internal/models"
)

func TestNormalizeProxyPoolFilterKeepsUnlimitedPageSizeWithoutOffsetOverflow(t *testing.T) {
	maxInt := int(^uint(0) >> 1)
	filter := NormalizeProxyPoolFilter(ProxyPoolFilter{Page: maxInt, Limit: maxInt})
	if filter.Limit != maxInt {
		t.Fatalf("limit=%d, want requested unlimited size %d", filter.Limit, maxInt)
	}
	if filter.Page != 2 {
		t.Fatalf("page=%d, want largest page with a representable offset", filter.Page)
	}
	if offset := (filter.Page - 1) * filter.Limit; offset < 0 {
		t.Fatalf("normalized offset overflowed: %d", offset)
	}
}

func TestProxyPoolListOrderIsStableWhenCreatedAtTies(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.ProxyPoolItem{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}
	createdAt := time.Date(2026, 7, 22, 8, 0, 0, 0, time.UTC)
	for i := 1; i <= 3; i++ {
		item := models.ProxyPoolItem{OrgID: 1, Type: models.ProxyTypeSocks5, Host: "same.example", Port: 1000 + i, Status: models.ProxyStatusUnknown, CreatedAt: createdAt, UpdatedAt: createdAt}
		if err := db.Create(&item).Error; err != nil {
			t.Fatalf("create proxy %d: %v", i, err)
		}
	}
	repo := NewProxyPoolRepository(db)
	assertOrder := func(label string) {
		items, _, err := repo.List(1, ProxyPoolFilter{Page: 1, Limit: 10})
		if err != nil {
			t.Fatalf("%s list: %v", label, err)
		}
		ids := make([]uint, len(items))
		for index := range items {
			ids[index] = items[index].ID
		}
		if len(items) != 3 || items[0].ID != 3 || items[1].ID != 2 || items[2].ID != 1 {
			t.Fatalf("%s IDs=%v, want [3 2 1]", label, ids)
		}
	}
	assertOrder("before check")
	if err := repo.UpdateCheckResult(2, map[string]interface{}{"status": models.ProxyStatusAvailable, "last_check_at": time.Now()}); err != nil {
		t.Fatalf("update check result: %v", err)
	}
	assertOrder("after check")
}

func TestProxyPoolRepositoryListsCreatedGroupsAndTags(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.ProxyGroup{}, &models.ProxyTag{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := NewProxyPoolRepository(db)
	group := &models.ProxyGroup{OrgID: 1, Name: "默认", Color: "#64748b"}
	tag := &models.ProxyTag{OrgID: 1, Name: "测试", Color: "#10b981"}
	if err := repo.CreateGroup(group); err != nil {
		t.Fatalf("CreateGroup failed: %v", err)
	}
	if err := repo.CreateTag(tag); err != nil {
		t.Fatalf("CreateTag failed: %v", err)
	}

	groups, err := repo.ListGroups(1)
	if err != nil {
		t.Fatalf("ListGroups failed: %v", err)
	}
	if len(groups) != 1 || groups[0].ID != group.ID || groups[0].Name != "默认" {
		t.Fatalf("groups = %+v, want created group", groups)
	}

	tags, err := repo.ListTags(1)
	if err != nil {
		t.Fatalf("ListTags failed: %v", err)
	}
	if len(tags) != 1 || tags[0].ID != tag.ID || tags[0].Name != "测试" {
		t.Fatalf("tags = %+v, want created tag", tags)
	}
}

func TestProxyPoolRepositoryListMetaSkipsDeletedRows(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.ProxyGroup{}, &models.ProxyTag{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := NewProxyPoolRepository(db)
	deletedAt := models.DeletedAt{Time: time.Now(), Valid: true}
	rows := []interface{}{
		&models.ProxyGroup{OrgID: 1, Name: "active"},
		&models.ProxyGroup{OrgID: 1, Name: "deleted", DeletedAt: deletedAt},
		&models.ProxyTag{OrgID: 1, Name: "active"},
		&models.ProxyTag{OrgID: 1, Name: "deleted", DeletedAt: deletedAt},
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatalf("failed to create %T: %v", row, err)
		}
	}

	groups, err := repo.ListGroups(1)
	if err != nil {
		t.Fatalf("ListGroups failed: %v", err)
	}
	if len(groups) != 1 || groups[0].Name != "active" {
		t.Fatalf("groups = %+v, want only active group", groups)
	}

	tags, err := repo.ListTags(1)
	if err != nil {
		t.Fatalf("ListTags failed: %v", err)
	}
	if len(tags) != 1 || tags[0].Name != "active" {
		t.Fatalf("tags = %+v, want only active tag", tags)
	}
}

func TestProxyPoolRepositoryDeleteMetaCleansAccountAutoMatchCriteria(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.ProxyGroup{}, &models.ProxyTag{}, &models.ProxyPoolItem{}, &models.ProxyPoolItemTag{}, &models.EmailAccount{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := NewProxyPoolRepository(db)
	group := models.ProxyGroup{OrgID: 1, Name: "group"}
	tag := models.ProxyTag{OrgID: 1, Name: "tag"}
	if err := db.Create(&group).Error; err != nil {
		t.Fatalf("failed to create group: %v", err)
	}
	if err := db.Create(&tag).Error; err != nil {
		t.Fatalf("failed to create tag: %v", err)
	}
	account := models.EmailAccount{
		OrgID:              1,
		EmailAddress:       "proxy-auto@example.com",
		AuthType:           models.AuthTypePassword,
		ProxyMode:          models.ProxyAccountModeAuto,
		ProxyMatchGroupIDs: models.UintSlice{group.ID, 999},
		ProxyMatchTagIDs:   models.UintSlice{tag.ID, 888},
		ProxyMatchTagMode:  models.ProxyTagFilterOR,
	}
	if err := db.Create(&account).Error; err != nil {
		t.Fatalf("failed to create account: %v", err)
	}

	if err := repo.DeleteGroup(1, group.ID); err != nil {
		t.Fatalf("DeleteGroup failed: %v", err)
	}
	if err := repo.DeleteTag(1, tag.ID); err != nil {
		t.Fatalf("DeleteTag failed: %v", err)
	}

	var saved models.EmailAccount
	if err := db.First(&saved, account.ID).Error; err != nil {
		t.Fatalf("failed to reload account: %v", err)
	}
	if len(saved.ProxyMatchGroupIDs) != 1 || saved.ProxyMatchGroupIDs[0] != 999 {
		t.Fatalf("proxy match groups = %v, want only 999", saved.ProxyMatchGroupIDs)
	}
	if len(saved.ProxyMatchTagIDs) != 1 || saved.ProxyMatchTagIDs[0] != 888 {
		t.Fatalf("proxy match tags = %v, want only 888", saved.ProxyMatchTagIDs)
	}
}

func TestProxyPoolRepositoryDeleteByIDsValidatesAndAppliesReplacement(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.ProxyPoolItem{}, &models.ProxyPoolItemTag{}, &models.EmailAccount{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := NewProxyPoolRepository(db)
	victim := models.ProxyPoolItem{OrgID: 1, Type: models.ProxyTypeSocks5, Host: "10.0.0.1", Port: 1080, Status: models.ProxyStatusAvailable}
	replacement := models.ProxyPoolItem{OrgID: 1, Type: models.ProxyTypeSocks5, Host: "10.0.0.2", Port: 1080, Status: models.ProxyStatusAvailable}
	if err := db.Create(&victim).Error; err != nil {
		t.Fatalf("failed to create victim proxy: %v", err)
	}
	if err := db.Create(&replacement).Error; err != nil {
		t.Fatalf("failed to create replacement proxy: %v", err)
	}
	primaryAccount := models.EmailAccount{OrgID: 1, EmailAddress: "primary@example.com", AuthType: models.AuthTypePassword, ProxyMode: models.ProxyAccountModeSelected, ProxyID: &victim.ID, Proxy: victim.ProxyURL()}
	fallbackAccount := models.EmailAccount{OrgID: 1, EmailAddress: "fallback@example.com", AuthType: models.AuthTypePassword, ProxyMode: models.ProxyAccountModeManual, ProxyFallbackMode: models.ProxyFallbackManual, ProxyFallbackProxyID: &victim.ID}
	if err := db.Create(&primaryAccount).Error; err != nil {
		t.Fatalf("failed to create primary account: %v", err)
	}
	if err := db.Create(&fallbackAccount).Error; err != nil {
		t.Fatalf("failed to create fallback account: %v", err)
	}

	if _, err := repo.DeleteByIDs(1, []uint{victim.ID}, ProxyDeleteReplacement{Mode: "proxy", ProxyID: &victim.ID}); err == nil {
		t.Fatal("DeleteByIDs should reject replacement proxy scheduled for deletion")
	}

	affected, err := repo.DeleteByIDs(1, []uint{victim.ID}, ProxyDeleteReplacement{Mode: "proxy", ProxyID: &replacement.ID})
	if err != nil {
		t.Fatalf("DeleteByIDs failed: %v", err)
	}
	if affected != 2 {
		t.Fatalf("affected accounts = %d, want 2", affected)
	}

	var savedPrimary models.EmailAccount
	if err := db.First(&savedPrimary, primaryAccount.ID).Error; err != nil {
		t.Fatalf("failed to reload primary account: %v", err)
	}
	if savedPrimary.ProxyID == nil || *savedPrimary.ProxyID != replacement.ID || savedPrimary.Proxy != replacement.ProxyURL() {
		t.Fatalf("primary replacement = id %v proxy %q, want replacement", savedPrimary.ProxyID, savedPrimary.Proxy)
	}

	var savedFallback models.EmailAccount
	if err := db.First(&savedFallback, fallbackAccount.ID).Error; err != nil {
		t.Fatalf("failed to reload fallback account: %v", err)
	}
	if savedFallback.ProxyFallbackProxyID == nil || *savedFallback.ProxyFallbackProxyID != replacement.ID {
		t.Fatalf("fallback replacement id = %v, want %d", savedFallback.ProxyFallbackProxyID, replacement.ID)
	}
}

func TestProxyPoolRepositoryTrafficCountersAndFilteredSummary(t *testing.T) {
	db := mustOpenRealSyncConfigTestDB(t)
	if err := db.AutoMigrate(&models.ProxyPoolItem{}); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}

	repo := NewProxyPoolRepository(db)
	available := models.ProxyPoolItem{OrgID: 1, Type: models.ProxyTypeSocks5, Host: "traffic-a.example", Port: 1080, Status: models.ProxyStatusAvailable}
	unavailable := models.ProxyPoolItem{OrgID: 1, Type: models.ProxyTypeHTTP, Host: "traffic-b.example", Port: 8080, Status: models.ProxyStatusUnavailable, TrafficBytesIn: 1000, TrafficBytesOut: 2000}
	otherOrg := models.ProxyPoolItem{OrgID: 2, Type: models.ProxyTypeHTTP, Host: "traffic-other.example", Port: 8081, Status: models.ProxyStatusAvailable, TrafficBytesIn: 9000, TrafficBytesOut: 9000}
	for _, item := range []*models.ProxyPoolItem{&available, &unavailable, &otherOrg} {
		if err := db.Create(item).Error; err != nil {
			t.Fatalf("create proxy: %v", err)
		}
	}

	if err := repo.AddTraffic(1, available.ID, 100, 200); err != nil {
		t.Fatalf("add first traffic sample: %v", err)
	}
	if err := repo.AddTraffic(1, available.ID, 50, 25); err != nil {
		t.Fatalf("add second traffic sample: %v", err)
	}
	if err := repo.AddTraffic(1, available.ID, -1, 0); err == nil {
		t.Fatal("negative traffic sample should be rejected")
	}

	filtered, err := repo.SumTraffic(1, ProxyPoolFilter{Status: string(models.ProxyStatusAvailable), Page: 9, Limit: 1})
	if err != nil {
		t.Fatalf("sum filtered traffic: %v", err)
	}
	if filtered.TrafficBytesIn != 150 || filtered.TrafficBytesOut != 225 {
		t.Fatalf("filtered traffic = %+v, want in=150 out=225", filtered)
	}
	all, err := repo.SumTraffic(1, ProxyPoolFilter{})
	if err != nil {
		t.Fatalf("sum all traffic: %v", err)
	}
	if all.TrafficBytesIn != 1150 || all.TrafficBytesOut != 2225 {
		t.Fatalf("all traffic = %+v, want in=1150 out=2225", all)
	}
}
