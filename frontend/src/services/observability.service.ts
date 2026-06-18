import { apiClient } from '@/lib/api-client'

export interface RuntimeMetricSnapshot {
    count: number
    success: number
    errors: number
    last_ms: number
    avg_ms: number
    p95_ms: number
    p99_ms: number
    max_ms: number
    last_at?: string
    error_rate: number
}

export interface RuntimeIngestSnapshot extends RuntimeMetricSnapshot {
    input: number
    inserted: number
    duplicates: number
    failed: number
}

export interface RuntimeSourceSnapshot {
    source: string
    sync_in_flight: number
    sync: RuntimeMetricSnapshot
    sync_slot_wait: RuntimeMetricSnapshot
    ingest: RuntimeIngestSnapshot
}

export interface RuntimePickupSnapshot {
    in_flight: number
    poll: RuntimeMetricSnapshot
}

export interface RuntimeOutlookLimiterSnapshot {
    active_pickup: number
    active_normal: number
    active_background: number
    waiting_pickup: number
    pickup_limit: number
    normal_limit: number
    background_limit: number
}

export interface RuntimeOutlookOperationSnapshot {
    operation: string
    total: RuntimeMetricSnapshot
    by_source: Record<string, RuntimeMetricSnapshot>
}

export interface RuntimeIMAPSnapshot {
    operations: Record<string, RuntimeOutlookOperationSnapshot>
}

export interface RuntimeOutlookSnapshot {
    limiter: RuntimeOutlookLimiterSnapshot
    limiter_wait_by_type: Record<string, RuntimeMetricSnapshot>
    operations: Record<string, RuntimeOutlookOperationSnapshot>
}

export interface RuntimeSyncConcurrencySnapshot {
    current_concurrent: number
    current_pickup: number
    concurrent_limit: number
    pickup_limit: number
    active_syncers: number
}

export interface RuntimeProcessSnapshot {
    goroutines: number
    heap_alloc_bytes: number
    heap_sys_bytes: number
    stack_inuse_bytes: number
    heap_objects: number
    num_gc: number
    last_gc_at?: string
}

export interface RuntimeDatabaseWaitSnapshot {
    state: string
    wait_event_type: string
    wait_event: string
    count: number
}

export interface RuntimeDatabaseSnapshot {
    driver: string
    max_open_connections: number
    open_connections: number
    in_use: number
    idle: number
    wait_count: number
    wait_duration_ms: number
    max_idle_closed: number
    max_idle_time_closed: number
    max_lifetime_closed: number
    wait_events?: RuntimeDatabaseWaitSnapshot[]
    error?: string
    wait_events_error?: string
}

export interface RuntimeActiveOperationSnapshot {
    id: string
    kind: string
    source?: string
    operation: string
    account_id?: number
    account_email?: string
    stage: string
    started_at: string
    updated_at: string
    age_ms: number
    last_error?: string
}

export interface RuntimeErrorEvent {
    at: string
    area: string
    source?: string
    operation?: string
    type: string
    message: string
}

export interface RuntimeErrorSummary {
    area: string
    source?: string
    operation?: string
    type: string
    count: number
}

export interface BatchImportJobBrief {
    job_id: string
    status: string
    stage: string
    total: number
    completed_results: number
    create_errors: number
    verify_errors: number
    sync_errors: number
    config_errors: number
    started_at: string
    updated_at: string
    finished_at?: string
}

export interface BatchImportObservabilitySnapshot {
    queued_jobs: number
    running_jobs: number
    completed_jobs: number
    failed_jobs: number
    total_accounts: number
    completed_results: number
    error_results: number
    recent_jobs: BatchImportJobBrief[]
}

export interface RuntimeObservabilitySnapshot {
    generated_at: string
    started_at: string
    uptime_seconds: number
    sources: Record<string, RuntimeSourceSnapshot>
    pickup: RuntimePickupSnapshot
    outlook: RuntimeOutlookSnapshot
    imap: RuntimeIMAPSnapshot
    sync_concurrency: RuntimeSyncConcurrencySnapshot
    process: RuntimeProcessSnapshot
    database: RuntimeDatabaseSnapshot
    active_operations: RuntimeActiveOperationSnapshot[]
    batch_outlook_import: BatchImportObservabilitySnapshot
    recent_errors: RuntimeErrorEvent[]
    error_top: RuntimeErrorSummary[]
}

function unwrapRuntimeSnapshot(response: any): RuntimeObservabilitySnapshot {
    if (response?.data) return response.data as RuntimeObservabilitySnapshot
    return response as RuntimeObservabilitySnapshot
}

export const observabilityService = {
    async getRuntimeSnapshot(): Promise<RuntimeObservabilitySnapshot> {
        const response = await apiClient.get('/observability/runtime')
        return unwrapRuntimeSnapshot(response)
    }
}
