package services

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const runtimeMetricSampleLimit = 256
const runtimeRecentErrorLimit = 50

var defaultRuntimeObservability = NewRuntimeObservability()
var runtimeActiveOperationSeq uint64

type RuntimeMetricSnapshot struct {
	Count     int64      `json:"count"`
	Success   int64      `json:"success"`
	Errors    int64      `json:"errors"`
	LastMS    float64    `json:"last_ms"`
	AvgMS     float64    `json:"avg_ms"`
	P95MS     float64    `json:"p95_ms"`
	P99MS     float64    `json:"p99_ms"`
	MaxMS     float64    `json:"max_ms"`
	LastAt    *time.Time `json:"last_at,omitempty"`
	ErrorRate float64    `json:"error_rate"`
}

type RuntimeSourceSnapshot struct {
	Source       string                `json:"source"`
	SyncInFlight int64                 `json:"sync_in_flight"`
	Sync         RuntimeMetricSnapshot `json:"sync"`
	SyncSlotWait RuntimeMetricSnapshot `json:"sync_slot_wait"`
	Ingest       RuntimeIngestSnapshot `json:"ingest"`
}

type RuntimeIngestSnapshot struct {
	RuntimeMetricSnapshot
	Input      int64 `json:"input"`
	Inserted   int64 `json:"inserted"`
	Duplicates int64 `json:"duplicates"`
	Failed     int64 `json:"failed"`
}

type RuntimePickupSnapshot struct {
	InFlight int64                 `json:"in_flight"`
	Poll     RuntimeMetricSnapshot `json:"poll"`
}

type RuntimeOperationSnapshot struct {
	Operation string                           `json:"operation"`
	Total     RuntimeMetricSnapshot            `json:"total"`
	BySource  map[string]RuntimeMetricSnapshot `json:"by_source"`
}

type RuntimeOutlookOperationSnapshot = RuntimeOperationSnapshot

type RuntimeOutlookSnapshot struct {
	Limiter           OutlookPriorityLimiterSnapshot             `json:"limiter"`
	LimiterWaitByType map[string]RuntimeMetricSnapshot           `json:"limiter_wait_by_type"`
	Operations        map[string]RuntimeOutlookOperationSnapshot `json:"operations"`
}

type RuntimeIMAPSnapshot struct {
	Operations map[string]RuntimeOperationSnapshot `json:"operations"`
}

type RuntimeSyncConcurrencySnapshot struct {
	CurrentConcurrent int64 `json:"current_concurrent"`
	CurrentPickup     int64 `json:"current_pickup"`
	ConcurrentLimit   int   `json:"concurrent_limit"`
	PickupLimit       int   `json:"pickup_limit"`
	ActiveSyncers     int64 `json:"active_syncers"`
}

type RuntimeProcessSnapshot struct {
	Goroutines      int        `json:"goroutines"`
	HeapAllocBytes  uint64     `json:"heap_alloc_bytes"`
	HeapSysBytes    uint64     `json:"heap_sys_bytes"`
	StackInuseBytes uint64     `json:"stack_inuse_bytes"`
	HeapObjects     uint64     `json:"heap_objects"`
	NumGC           uint32     `json:"num_gc"`
	LastGCAt        *time.Time `json:"last_gc_at,omitempty"`
}

type RuntimeDatabaseWaitSnapshot struct {
	State         string `json:"state"`
	WaitEventType string `json:"wait_event_type"`
	WaitEvent     string `json:"wait_event"`
	Count         int64  `json:"count"`
}

type RuntimeDatabaseSnapshot struct {
	Driver             string                        `json:"driver"`
	MaxOpenConnections int                           `json:"max_open_connections"`
	OpenConnections    int                           `json:"open_connections"`
	InUse              int                           `json:"in_use"`
	Idle               int                           `json:"idle"`
	WaitCount          int64                         `json:"wait_count"`
	WaitDurationMS     float64                       `json:"wait_duration_ms"`
	MaxIdleClosed      int64                         `json:"max_idle_closed"`
	MaxIdleTimeClosed  int64                         `json:"max_idle_time_closed"`
	MaxLifetimeClosed  int64                         `json:"max_lifetime_closed"`
	WaitEvents         []RuntimeDatabaseWaitSnapshot `json:"wait_events,omitempty"`
	Error              string                        `json:"error,omitempty"`
	WaitEventsError    string                        `json:"wait_events_error,omitempty"`
}

type RuntimeActiveOperationSnapshot struct {
	ID           string    `json:"id"`
	Kind         string    `json:"kind"`
	Source       string    `json:"source,omitempty"`
	Operation    string    `json:"operation"`
	AccountID    uint      `json:"account_id,omitempty"`
	AccountEmail string    `json:"account_email,omitempty"`
	Stage        string    `json:"stage"`
	StartedAt    time.Time `json:"started_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	AgeMS        float64   `json:"age_ms"`
	LastError    string    `json:"last_error,omitempty"`
}

type RuntimeErrorEvent struct {
	At        time.Time `json:"at"`
	Area      string    `json:"area"`
	Source    string    `json:"source,omitempty"`
	Operation string    `json:"operation,omitempty"`
	Type      string    `json:"type"`
	Message   string    `json:"message"`
}

type RuntimeErrorSummary struct {
	Area      string `json:"area"`
	Source    string `json:"source,omitempty"`
	Operation string `json:"operation,omitempty"`
	Type      string `json:"type"`
	Count     int64  `json:"count"`
}

type BatchImportJobBrief struct {
	JobID            string     `json:"job_id"`
	Status           string     `json:"status"`
	Stage            string     `json:"stage"`
	Total            int        `json:"total"`
	CompletedResults int        `json:"completed_results"`
	CreateErrors     int        `json:"create_errors"`
	VerifyErrors     int        `json:"verify_errors"`
	SyncErrors       int        `json:"sync_errors"`
	ConfigErrors     int        `json:"config_errors"`
	StartedAt        time.Time  `json:"started_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	FinishedAt       *time.Time `json:"finished_at,omitempty"`
}

type BatchImportObservabilitySnapshot struct {
	QueuedJobs       int64                 `json:"queued_jobs"`
	RunningJobs      int64                 `json:"running_jobs"`
	CompletedJobs    int64                 `json:"completed_jobs"`
	FailedJobs       int64                 `json:"failed_jobs"`
	TotalAccounts    int64                 `json:"total_accounts"`
	CompletedResults int64                 `json:"completed_results"`
	ErrorResults     int64                 `json:"error_results"`
	RecentJobs       []BatchImportJobBrief `json:"recent_jobs"`
}

type RuntimeObservabilitySnapshot struct {
	GeneratedAt        time.Time                        `json:"generated_at"`
	StartedAt          time.Time                        `json:"started_at"`
	UptimeSeconds      int64                            `json:"uptime_seconds"`
	Sources            map[string]RuntimeSourceSnapshot `json:"sources"`
	Pickup             RuntimePickupSnapshot            `json:"pickup"`
	Outlook            RuntimeOutlookSnapshot           `json:"outlook"`
	IMAP               RuntimeIMAPSnapshot              `json:"imap"`
	SyncConcurrency    RuntimeSyncConcurrencySnapshot   `json:"sync_concurrency"`
	Process            RuntimeProcessSnapshot           `json:"process"`
	Database           RuntimeDatabaseSnapshot          `json:"database"`
	ActiveOperations   []RuntimeActiveOperationSnapshot `json:"active_operations"`
	BatchOutlookImport BatchImportObservabilitySnapshot `json:"batch_outlook_import"`
	RecentErrors       []RuntimeErrorEvent              `json:"recent_errors"`
	ErrorTop           []RuntimeErrorSummary            `json:"error_top"`
}

type RuntimeObservability struct {
	mu sync.Mutex

	startedAt time.Time

	syncInFlight map[string]int64
	syncDuration map[string]*runtimeMetricAggregate
	syncSlotWait map[string]*runtimeMetricAggregate
	ingest       map[string]*runtimeIngestAggregate

	pickupInFlight int64
	pickupPoll     *runtimeMetricAggregate

	outlookLimiterWait map[string]*runtimeMetricAggregate
	outlookRequests    map[string]map[string]*runtimeMetricAggregate
	imapOperations     map[string]map[string]*runtimeMetricAggregate

	activeOperations map[string]RuntimeActiveOperationSnapshot
	recentErrors     []RuntimeErrorEvent
	errorCounts      map[string]*RuntimeErrorSummary
}

type runtimeMetricAggregate struct {
	count   int64
	success int64
	errors  int64
	totalMS float64
	lastMS  float64
	maxMS   float64
	lastAt  time.Time
	samples []float64
}

type runtimeIngestAggregate struct {
	metric     runtimeMetricAggregate
	input      int64
	inserted   int64
	duplicates int64
	failed     int64
}

func NewRuntimeObservability() *RuntimeObservability {
	return &RuntimeObservability{
		startedAt:          time.Now(),
		syncInFlight:       make(map[string]int64),
		syncDuration:       make(map[string]*runtimeMetricAggregate),
		syncSlotWait:       make(map[string]*runtimeMetricAggregate),
		ingest:             make(map[string]*runtimeIngestAggregate),
		pickupPoll:         &runtimeMetricAggregate{},
		outlookLimiterWait: make(map[string]*runtimeMetricAggregate),
		outlookRequests:    make(map[string]map[string]*runtimeMetricAggregate),
		imapOperations:     make(map[string]map[string]*runtimeMetricAggregate),
		activeOperations:   make(map[string]RuntimeActiveOperationSnapshot),
		errorCounts:        make(map[string]*RuntimeErrorSummary),
	}
}

func RuntimeMetrics() *RuntimeObservability {
	return defaultRuntimeObservability
}

func GetRuntimeObservabilitySnapshot() RuntimeObservabilitySnapshot {
	return defaultRuntimeObservability.Snapshot()
}

func (o *RuntimeObservability) BeginSync(source EmailIngestSource) func(emailsFetched int, newEmails int, syncErr error) {
	start := time.Now()
	sourceKey := runtimeSourceKey(source)

	o.mu.Lock()
	o.syncInFlight[sourceKey]++
	o.mu.Unlock()

	return func(emailsFetched int, newEmails int, syncErr error) {
		o.mu.Lock()
		if o.syncInFlight[sourceKey] > 0 {
			o.syncInFlight[sourceKey]--
		}
		o.metricFor(o.syncDuration, sourceKey).record(time.Since(start), syncErr == nil)
		if syncErr != nil {
			o.recordErrorLocked("sync", sourceKey, "", syncErr, 0)
		}
		o.mu.Unlock()
	}
}

func (o *RuntimeObservability) RecordSyncSlotWait(source EmailIngestSource, wait time.Duration, waitErr error) {
	sourceKey := runtimeSourceKey(source)
	o.mu.Lock()
	o.metricFor(o.syncSlotWait, sourceKey).record(wait, waitErr == nil)
	if waitErr != nil {
		o.recordErrorLocked("sync_slot", sourceKey, "", waitErr, 0)
	}
	o.mu.Unlock()
}

func (o *RuntimeObservability) BeginPickupPoll() func(error) {
	start := time.Now()
	o.mu.Lock()
	o.pickupInFlight++
	o.mu.Unlock()

	return func(pollErr error) {
		o.mu.Lock()
		if o.pickupInFlight > 0 {
			o.pickupInFlight--
		}
		o.pickupPoll.record(time.Since(start), pollErr == nil)
		if pollErr != nil {
			o.recordErrorLocked("pickup_poll", string(EmailIngestSourcePickup), "", pollErr, 0)
		}
		o.mu.Unlock()
	}
}

func (o *RuntimeObservability) BeginEmailIngest(source EmailIngestSource, input int) func(inserted int, duplicates int, failed int, ingestErr error) {
	start := time.Now()
	sourceKey := runtimeSourceKey(source)
	return func(inserted int, duplicates int, failed int, ingestErr error) {
		o.mu.Lock()
		aggregate := o.ingestFor(sourceKey)
		aggregate.input += int64(input)
		aggregate.inserted += int64(inserted)
		aggregate.duplicates += int64(duplicates)
		aggregate.failed += int64(failed)
		aggregate.metric.record(time.Since(start), ingestErr == nil)
		if ingestErr != nil {
			o.recordErrorLocked("email_ingest", sourceKey, "", ingestErr, 0)
		}
		o.mu.Unlock()
	}
}

func (o *RuntimeObservability) RecordOutlookLimiterWait(source EmailIngestSource, priority string, operation string, wait time.Duration, waitErr error) {
	sourceKey := runtimeSourceKey(source)
	waitKey := priority
	if waitKey == "" {
		waitKey = "unknown"
	}

	o.mu.Lock()
	o.metricFor(o.outlookLimiterWait, waitKey).record(wait, waitErr == nil)
	if waitErr != nil {
		o.recordErrorLocked("outlook_limiter", sourceKey, operation, waitErr, 0)
	}
	o.mu.Unlock()
}

func (o *RuntimeObservability) RecordOutlookRequest(source EmailIngestSource, operation string, statusCode int, duration time.Duration, requestErr error) {
	sourceKey := runtimeSourceKey(source)
	operationKey := normalizeRuntimeOperation(operation)
	success := requestErr == nil && (statusCode == 0 || statusCode < 400)

	o.mu.Lock()
	o.recordOperationLocked(o.outlookRequests, sourceKey, operationKey, duration, success)
	if !success {
		o.recordErrorLocked("outlook_api", sourceKey, operationKey, requestErr, statusCode)
	}
	o.mu.Unlock()
}

func (o *RuntimeObservability) BeginIMAPOperation(source EmailIngestSource, operation string) func(error) {
	start := time.Now()
	return func(operationErr error) {
		o.RecordIMAPOperation(source, operation, time.Since(start), operationErr)
	}
}

func (o *RuntimeObservability) RecordIMAPOperation(source EmailIngestSource, operation string, duration time.Duration, operationErr error) {
	sourceKey := runtimeSourceKey(source)
	operationKey := normalizeRuntimeOperation(operation)

	o.mu.Lock()
	o.recordOperationLocked(o.imapOperations, sourceKey, operationKey, duration, operationErr == nil)
	if operationErr != nil {
		o.recordErrorLocked("imap", sourceKey, operationKey, operationErr, 0)
	}
	o.mu.Unlock()
}

type RuntimeActiveOperationHandle struct {
	observer *RuntimeObservability
	id       string
}

func (o *RuntimeObservability) BeginActiveOperation(kind string, source EmailIngestSource, operation string, accountID uint, accountEmail string, stage string) *RuntimeActiveOperationHandle {
	if o == nil {
		return nil
	}
	kind = normalizeRuntimeOperation(kind)
	operation = normalizeRuntimeOperation(operation)
	stage = strings.TrimSpace(stage)
	if stage == "" {
		stage = "started"
	}
	id := fmt.Sprintf("%d-%s-%d", time.Now().UnixNano(), kind, atomic.AddUint64(&runtimeActiveOperationSeq, 1))
	now := time.Now()
	sourceKey := runtimeSourceKey(source)
	o.mu.Lock()
	o.activeOperations[id] = RuntimeActiveOperationSnapshot{
		ID:           id,
		Kind:         kind,
		Source:       sourceKey,
		Operation:    operation,
		AccountID:    accountID,
		AccountEmail: accountEmail,
		Stage:        stage,
		StartedAt:    now,
		UpdatedAt:    now,
	}
	o.mu.Unlock()
	return &RuntimeActiveOperationHandle{observer: o, id: id}
}

func (h *RuntimeActiveOperationHandle) Stage(stage string) {
	if h == nil || h.observer == nil {
		return
	}
	stage = strings.TrimSpace(stage)
	if stage == "" {
		return
	}
	h.observer.mu.Lock()
	operation, ok := h.observer.activeOperations[h.id]
	if ok {
		operation.Stage = stage
		operation.UpdatedAt = time.Now()
		h.observer.activeOperations[h.id] = operation
	}
	h.observer.mu.Unlock()
}

func (h *RuntimeActiveOperationHandle) Finish(operationErr error) {
	if h == nil || h.observer == nil {
		return
	}
	h.observer.mu.Lock()
	if operation, ok := h.observer.activeOperations[h.id]; ok && operationErr != nil {
		operation.LastError = runtimeErrorMessage(operationErr, 0)
		operation.UpdatedAt = time.Now()
		h.observer.activeOperations[h.id] = operation
	}
	delete(h.observer.activeOperations, h.id)
	h.observer.mu.Unlock()
}

func (o *RuntimeObservability) Snapshot() RuntimeObservabilitySnapshot {
	limiterSnapshot := GetOutlookRequestLimiterSnapshot()

	o.mu.Lock()
	defer o.mu.Unlock()

	now := time.Now()
	sourceKeys := make(map[string]struct{})
	for source := range o.syncInFlight {
		sourceKeys[source] = struct{}{}
	}
	for source := range o.syncDuration {
		sourceKeys[source] = struct{}{}
	}
	for source := range o.syncSlotWait {
		sourceKeys[source] = struct{}{}
	}
	for source := range o.ingest {
		sourceKeys[source] = struct{}{}
	}

	sources := make(map[string]RuntimeSourceSnapshot, len(sourceKeys))
	for source := range sourceKeys {
		sources[source] = RuntimeSourceSnapshot{
			Source:       source,
			SyncInFlight: o.syncInFlight[source],
			Sync:         snapshotMetric(o.syncDuration[source]),
			SyncSlotWait: snapshotMetric(o.syncSlotWait[source]),
			Ingest:       o.snapshotIngest(source),
		}
	}

	operations := o.snapshotOperationsLocked(o.outlookRequests)
	imapOperations := o.snapshotOperationsLocked(o.imapOperations)

	waitSnapshots := make(map[string]RuntimeMetricSnapshot, len(o.outlookLimiterWait))
	for priority, metric := range o.outlookLimiterWait {
		waitSnapshots[priority] = metric.snapshot()
	}

	activeOperations := make([]RuntimeActiveOperationSnapshot, 0, len(o.activeOperations))
	for _, operation := range o.activeOperations {
		operation.AgeMS = float64(now.Sub(operation.StartedAt).Microseconds()) / 1000
		activeOperations = append(activeOperations, operation)
	}
	sort.Slice(activeOperations, func(i, j int) bool {
		return activeOperations[i].StartedAt.Before(activeOperations[j].StartedAt)
	})

	recentErrors := make([]RuntimeErrorEvent, len(o.recentErrors))
	copy(recentErrors, o.recentErrors)

	errorTop := make([]RuntimeErrorSummary, 0, len(o.errorCounts))
	for _, summary := range o.errorCounts {
		errorTop = append(errorTop, *summary)
	}
	sort.Slice(errorTop, func(i, j int) bool {
		return errorTop[i].Count > errorTop[j].Count
	})
	if len(errorTop) > 10 {
		errorTop = errorTop[:10]
	}

	return RuntimeObservabilitySnapshot{
		GeneratedAt:   now,
		StartedAt:     o.startedAt,
		UptimeSeconds: int64(now.Sub(o.startedAt).Seconds()),
		Sources:       sources,
		Pickup: RuntimePickupSnapshot{
			InFlight: o.pickupInFlight,
			Poll:     o.pickupPoll.snapshot(),
		},
		Outlook: RuntimeOutlookSnapshot{
			Limiter:           limiterSnapshot,
			LimiterWaitByType: waitSnapshots,
			Operations:        operations,
		},
		IMAP: RuntimeIMAPSnapshot{
			Operations: imapOperations,
		},
		ActiveOperations: activeOperations,
		RecentErrors:     recentErrors,
		ErrorTop:         errorTop,
	}
}

func (o *RuntimeObservability) ApplySyncConcurrency(stats PerAccountSyncStats) RuntimeObservabilitySnapshot {
	snapshot := o.Snapshot()
	snapshot.SyncConcurrency = RuntimeSyncConcurrencySnapshot{
		CurrentConcurrent: stats.CurrentConcurrent,
		CurrentPickup:     stats.CurrentPickup,
		ConcurrentLimit:   stats.ConcurrentLimit,
		PickupLimit:       stats.PickupLimit,
		ActiveSyncers:     stats.ActiveSyncers,
	}
	return snapshot
}

func (o *RuntimeObservability) metricFor(metrics map[string]*runtimeMetricAggregate, key string) *runtimeMetricAggregate {
	metric := metrics[key]
	if metric == nil {
		metric = &runtimeMetricAggregate{}
		metrics[key] = metric
	}
	return metric
}

func (o *RuntimeObservability) ingestFor(source string) *runtimeIngestAggregate {
	aggregate := o.ingest[source]
	if aggregate == nil {
		aggregate = &runtimeIngestAggregate{}
		o.ingest[source] = aggregate
	}
	return aggregate
}

func (o *RuntimeObservability) recordOperationLocked(metrics map[string]map[string]*runtimeMetricAggregate, sourceKey string, operationKey string, duration time.Duration, success bool) {
	bySource, ok := metrics[operationKey]
	if !ok {
		bySource = make(map[string]*runtimeMetricAggregate)
		metrics[operationKey] = bySource
	}
	o.metricFor(bySource, sourceKey).record(duration, success)
}

func (o *RuntimeObservability) snapshotOperationsLocked(metrics map[string]map[string]*runtimeMetricAggregate) map[string]RuntimeOperationSnapshot {
	operations := make(map[string]RuntimeOperationSnapshot, len(metrics))
	for operation, bySource := range metrics {
		total := &runtimeMetricAggregate{}
		sourceSnapshots := make(map[string]RuntimeMetricSnapshot, len(bySource))
		for source, metric := range bySource {
			sourceSnapshots[source] = metric.snapshot()
			total.merge(metric)
		}
		operations[operation] = RuntimeOperationSnapshot{
			Operation: operation,
			Total:     total.snapshot(),
			BySource:  sourceSnapshots,
		}
	}
	return operations
}

func (o *RuntimeObservability) snapshotIngest(source string) RuntimeIngestSnapshot {
	aggregate := o.ingest[source]
	if aggregate == nil {
		return RuntimeIngestSnapshot{}
	}
	return RuntimeIngestSnapshot{
		RuntimeMetricSnapshot: aggregate.metric.snapshot(),
		Input:                 aggregate.input,
		Inserted:              aggregate.inserted,
		Duplicates:            aggregate.duplicates,
		Failed:                aggregate.failed,
	}
}

func (o *RuntimeObservability) recordErrorLocked(area string, source string, operation string, err error, statusCode int) {
	event := RuntimeErrorEvent{
		At:        time.Now(),
		Area:      area,
		Source:    source,
		Operation: operation,
		Type:      classifyRuntimeError(err, statusCode),
		Message:   runtimeErrorMessage(err, statusCode),
	}
	o.recentErrors = append([]RuntimeErrorEvent{event}, o.recentErrors...)
	if len(o.recentErrors) > runtimeRecentErrorLimit {
		o.recentErrors = o.recentErrors[:runtimeRecentErrorLimit]
	}

	key := strings.Join([]string{event.Area, event.Source, event.Operation, event.Type}, "\x00")
	summary := o.errorCounts[key]
	if summary == nil {
		summary = &RuntimeErrorSummary{
			Area:      event.Area,
			Source:    event.Source,
			Operation: event.Operation,
			Type:      event.Type,
		}
		o.errorCounts[key] = summary
	}
	summary.Count++
}

func (m *runtimeMetricAggregate) record(duration time.Duration, success bool) {
	ms := float64(duration.Microseconds()) / 1000
	if ms < 0 {
		ms = 0
	}
	m.count++
	if success {
		m.success++
	} else {
		m.errors++
	}
	m.totalMS += ms
	m.lastMS = ms
	if ms > m.maxMS {
		m.maxMS = ms
	}
	now := time.Now()
	m.lastAt = now
	m.samples = append(m.samples, ms)
	if len(m.samples) > runtimeMetricSampleLimit {
		copy(m.samples, m.samples[len(m.samples)-runtimeMetricSampleLimit:])
		m.samples = m.samples[:runtimeMetricSampleLimit]
	}
}

func (m *runtimeMetricAggregate) merge(other *runtimeMetricAggregate) {
	if other == nil {
		return
	}
	m.count += other.count
	m.success += other.success
	m.errors += other.errors
	m.totalMS += other.totalMS
	m.lastMS = other.lastMS
	if other.maxMS > m.maxMS {
		m.maxMS = other.maxMS
	}
	if other.lastAt.After(m.lastAt) {
		m.lastAt = other.lastAt
	}
	m.samples = append(m.samples, other.samples...)
	if len(m.samples) > runtimeMetricSampleLimit {
		m.samples = m.samples[len(m.samples)-runtimeMetricSampleLimit:]
	}
}

func (m *runtimeMetricAggregate) snapshot() RuntimeMetricSnapshot {
	if m == nil || m.count == 0 {
		return RuntimeMetricSnapshot{}
	}
	avg := 0.0
	if m.count > 0 {
		avg = m.totalMS / float64(m.count)
	}
	errorRate := 0.0
	if m.count > 0 {
		errorRate = float64(m.errors) / float64(m.count)
	}
	lastAt := m.lastAt
	return RuntimeMetricSnapshot{
		Count:     m.count,
		Success:   m.success,
		Errors:    m.errors,
		LastMS:    m.lastMS,
		AvgMS:     avg,
		P95MS:     percentileRuntimeSamples(m.samples, 0.95),
		P99MS:     percentileRuntimeSamples(m.samples, 0.99),
		MaxMS:     m.maxMS,
		LastAt:    &lastAt,
		ErrorRate: errorRate,
	}
}

func snapshotMetric(metric *runtimeMetricAggregate) RuntimeMetricSnapshot {
	if metric == nil {
		return RuntimeMetricSnapshot{}
	}
	return metric.snapshot()
}

func percentileRuntimeSamples(samples []float64, percentile float64) float64 {
	if len(samples) == 0 {
		return 0
	}
	values := append([]float64(nil), samples...)
	sort.Float64s(values)
	index := int(float64(len(values)-1) * percentile)
	if index < 0 {
		index = 0
	}
	if index >= len(values) {
		index = len(values) - 1
	}
	return values[index]
}

func runtimeSourceKey(source EmailIngestSource) string {
	normalized := normalizeEmailIngestSource(source)
	if normalized == "" {
		return string(EmailIngestSourceUnknown)
	}
	return string(normalized)
}

func normalizeRuntimeOperation(operation string) string {
	operation = strings.TrimSpace(strings.ToLower(operation))
	if operation == "" {
		return "unknown"
	}
	if strings.Contains(operation, "token") {
		return "token"
	}
	if strings.Contains(operation, "mailfolders") || strings.Contains(operation, "mail folders") {
		return "mailFolders"
	}
	if strings.Contains(operation, "message") {
		return "messages"
	}
	return strings.ReplaceAll(operation, " ", "_")
}

func classifyRuntimeError(err error, statusCode int) string {
	if statusCode > 0 {
		switch statusCode {
		case httpStatusTooManyRequests:
			return "throttled"
		case httpStatusUnauthorized:
			return "auth"
		case httpStatusForbidden:
			return "forbidden"
		default:
			if statusCode >= 500 {
				return "upstream_5xx"
			}
			if statusCode >= 400 {
				return fmt.Sprintf("http_%d", statusCode)
			}
		}
	}
	if err == nil {
		return "unknown"
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "timeout") || strings.Contains(message, "deadline"):
		return "timeout"
	case strings.Contains(message, "oauth") || strings.Contains(message, "token"):
		return "auth"
	case strings.Contains(message, "too many") || strings.Contains(message, "429") || strings.Contains(message, "throttl"):
		return "throttled"
	case strings.Contains(message, "connection") || strings.Contains(message, "network") || strings.Contains(message, "proxy"):
		return "network"
	default:
		return "error"
	}
}

func runtimeErrorMessage(err error, statusCode int) string {
	message := ""
	if err != nil {
		message = err.Error()
	} else if statusCode > 0 {
		message = fmt.Sprintf("HTTP %d", statusCode)
	}
	message = strings.TrimSpace(message)
	if len(message) > 220 {
		message = message[:220] + "..."
	}
	return message
}

const (
	httpStatusUnauthorized    = 401
	httpStatusForbidden       = 403
	httpStatusTooManyRequests = 429
)
