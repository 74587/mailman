package models

import "time"

type BusinessLogOperationType string
type BusinessLogActorType string
type BusinessLogStatus string

const (
	BusinessLogOperationManual    BusinessLogOperationType = "manual"
	BusinessLogOperationAutomatic BusinessLogOperationType = "automatic"
	BusinessLogOperationAPI       BusinessLogOperationType = "api"
	BusinessLogOperationScheduled BusinessLogOperationType = "scheduled"

	BusinessLogActorUser      BusinessLogActorType = "user"
	BusinessLogActorTrigger   BusinessLogActorType = "trigger"
	BusinessLogActorScheduler BusinessLogActorType = "scheduler"
	BusinessLogActorSystem    BusinessLogActorType = "system"
	BusinessLogActorAPI       BusinessLogActorType = "api"

	BusinessLogStatusSuccess   BusinessLogStatus = "success"
	BusinessLogStatusFailed    BusinessLogStatus = "failed"
	BusinessLogStatusPartial   BusinessLogStatus = "partial"
	BusinessLogStatusSkipped   BusinessLogStatus = "skipped"
	BusinessLogStatusCancelled BusinessLogStatus = "cancelled"
)

type BusinessLog struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *DeletedAt `gorm:"index" json:"deletedAt,omitempty" swaggertype:"object"`

	OrgID  uint  `gorm:"not null;index;default:1" json:"orgId"`
	UserID *uint `gorm:"index" json:"userId,omitempty"`
	User   *User `gorm:"foreignKey:UserID" json:"user,omitempty"`

	OperationType BusinessLogOperationType `gorm:"type:varchar(32);not null;index" json:"operationType"`
	ActorType     BusinessLogActorType     `gorm:"type:varchar(32);not null;index" json:"actorType"`
	ActorID       string                   `gorm:"type:varchar(128);index" json:"actorId,omitempty"`
	ActorName     string                   `gorm:"type:varchar(255)" json:"actorName,omitempty"`

	Module     string `gorm:"type:varchar(80);not null;index" json:"module"`
	Action     string `gorm:"type:varchar(80);not null;index" json:"action"`
	EntityType string `gorm:"type:varchar(80);index" json:"entityType,omitempty"`
	EntityID   string `gorm:"type:varchar(128);index" json:"entityId,omitempty"`
	EntityName string `gorm:"type:varchar(255)" json:"entityName,omitempty"`

	Title   string `gorm:"type:varchar(255);not null" json:"title"`
	Summary string `gorm:"type:text" json:"summary,omitempty"`
	Result  string `gorm:"type:varchar(64)" json:"result,omitempty"`
	Status  string `gorm:"type:varchar(32);not null;index" json:"status"`

	StartedAt  time.Time  `gorm:"not null;index" json:"startedAt"`
	FinishedAt *time.Time `gorm:"index" json:"finishedAt,omitempty"`
	DurationMS int64      `gorm:"not null;default:0" json:"durationMs"`

	TraceID   string `gorm:"type:varchar(128);index" json:"traceId,omitempty"`
	RunID     string `gorm:"type:varchar(128);index" json:"runId,omitempty"`
	RequestID string `gorm:"type:varchar(128);index" json:"requestId,omitempty"`

	ErrorCode    string `gorm:"type:varchar(128)" json:"errorCode,omitempty"`
	ErrorMessage string `gorm:"type:text" json:"errorMessage,omitempty"`

	Details   JSONMapInterface `gorm:"type:json" json:"details,omitempty"`
	SourceIP  string           `gorm:"type:varchar(64)" json:"sourceIp,omitempty"`
	UserAgent string           `gorm:"type:text" json:"userAgent,omitempty"`
}

func (BusinessLog) TableName() string {
	return "business_logs"
}
