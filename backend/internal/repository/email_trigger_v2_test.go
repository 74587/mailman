package repository

import (
	"testing"
	"time"

	"mailman/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestTriggerExecutionLogV2GetAllPaginatedFiltersByTriggerOrg(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&models.EmailTriggerV2{}, &models.TriggerExecutionLogV2{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}

	orgOneTrigger := models.EmailTriggerV2{
		OrgID:       1,
		Name:        "org-one-trigger",
		Enabled:     true,
		Expressions: models.TriggerExpressions{},
		Actions:     models.TriggerActions{},
	}
	orgTwoTrigger := models.EmailTriggerV2{
		OrgID:       2,
		Name:        "org-two-trigger",
		Enabled:     true,
		Expressions: models.TriggerExpressions{},
		Actions:     models.TriggerActions{},
	}
	if err := db.Create(&orgOneTrigger).Error; err != nil {
		t.Fatalf("create org one trigger: %v", err)
	}
	if err := db.Create(&orgTwoTrigger).Error; err != nil {
		t.Fatalf("create org two trigger: %v", err)
	}

	now := time.Now()
	logs := []models.TriggerExecutionLogV2{
		{
			TriggerID:        orgOneTrigger.ID,
			TriggerName:      orgOneTrigger.Name,
			EmailID:          101,
			Status:           models.TriggerExecutionV2StatusSuccess,
			StartTime:        now,
			EndTime:          now.Add(time.Second),
			Duration:         1000,
			ConditionResult:  true,
			ActionsExecuted:  1,
			ActionsSucceeded: 1,
		},
		{
			TriggerID:        orgTwoTrigger.ID,
			TriggerName:      orgTwoTrigger.Name,
			EmailID:          202,
			Status:           models.TriggerExecutionV2StatusFailed,
			StartTime:        now,
			EndTime:          now.Add(2 * time.Second),
			Duration:         2000,
			ConditionResult:  true,
			ActionsExecuted:  1,
			ActionsSucceeded: 0,
		},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatalf("create logs: %v", err)
	}

	repo := NewTriggerExecutionLogV2Repository(db)
	got, total, err := repo.GetAllPaginated(1, 10, nil, nil, nil, nil, 1)
	if err != nil {
		t.Fatalf("get paginated logs: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(got) != 1 {
		t.Fatalf("logs length = %d, want 1", len(got))
	}
	if got[0].TriggerID != orgOneTrigger.ID {
		t.Fatalf("trigger id = %d, want %d", got[0].TriggerID, orgOneTrigger.ID)
	}

	otherOrgTriggerID := orgTwoTrigger.ID
	got, total, err = repo.GetAllPaginated(1, 10, &otherOrgTriggerID, nil, nil, nil, 1)
	if err != nil {
		t.Fatalf("get paginated logs for other org trigger: %v", err)
	}
	if total != 0 || len(got) != 0 {
		t.Fatalf("other org logs total = %d len = %d, want 0/0", total, len(got))
	}
}
