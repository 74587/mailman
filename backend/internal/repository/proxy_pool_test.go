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
