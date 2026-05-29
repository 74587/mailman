package repository

import (
	"testing"
	"time"

	"mailman/internal/models"
)

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
