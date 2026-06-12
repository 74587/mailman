'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    Clock,
    Database,
    Gauge,
    Loader2,
    RefreshCw,
    Server,
    ShieldCheck,
    Wifi,
} from 'lucide-react'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'
import {
    observabilityService,
    RuntimeMetricSnapshot,
    RuntimeObservabilitySnapshot,
    RuntimeSourceSnapshot,
} from '@/services/observability.service'

const RUNTIME_REFRESH_STORAGE_KEY = 'mailman-runtime-status-refresh-settings'
const RUNTIME_REFRESH_INTERVAL_OPTIONS = [
    { value: 5, label: '5秒' },
    { value: 15, label: '15秒' },
    { value: 30, label: '30秒' },
    { value: 60, label: '1分钟' },
]

const emptyMetric: RuntimeMetricSnapshot = {
    count: 0,
    success: 0,
    errors: 0,
    last_ms: 0,
    avg_ms: 0,
    p95_ms: 0,
    p99_ms: 0,
    max_ms: 0,
    error_rate: 0,
}

function readRuntimeRefreshSettings() {
    const fallback = { enabled: true, intervalSeconds: 15 }
    if (typeof window === 'undefined') return fallback

    try {
        const raw = window.localStorage.getItem(RUNTIME_REFRESH_STORAGE_KEY)
        if (!raw) return fallback
        const parsed = JSON.parse(raw)
        const intervalSeconds = Number(parsed.intervalSeconds)
        const validInterval = RUNTIME_REFRESH_INTERVAL_OPTIONS.some(option => option.value === intervalSeconds)
        return {
            enabled: Boolean(parsed.enabled),
            intervalSeconds: validInterval ? intervalSeconds : fallback.intervalSeconds,
        }
    } catch {
        return fallback
    }
}

function metricValue(value: number | undefined, suffix = '') {
    if (!Number.isFinite(value || 0)) return `0${suffix}`
    const safeValue = value || 0
    if (Math.abs(safeValue) >= 1000) return `${Math.round(safeValue).toLocaleString()}${suffix}`
    if (Math.abs(safeValue) >= 100) return `${Math.round(safeValue)}${suffix}`
    if (Math.abs(safeValue) >= 10) return `${safeValue.toFixed(1)}${suffix}`
    return `${safeValue.toFixed(2)}${suffix}`
}

function formatMS(value: number | undefined) {
    const ms = value || 0
    if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`
    return `${metricValue(ms)}ms`
}

function formatPercent(rate: number | undefined) {
    return `${metricValue((rate || 0) * 100)}%`
}

function formatDateTime(value?: string) {
    if (!value) return '-'
    return new Date(value).toLocaleString()
}

function formatDuration(seconds: number) {
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${minutes}m`
}

function sourceLabel(source: string) {
    const labels: Record<string, string> = {
        pickup: '取件',
        background_import: '后台导入',
        manual_sync: '手动同步',
        auto_sync: '自动同步',
        unknown: '未知',
    }
    return labels[source] || source
}

function operationLabel(operation: string) {
    const labels: Record<string, string> = {
        token: 'Token',
        mailFolders: 'Folders',
        messages: 'Messages',
    }
    return labels[operation] || operation
}

function getSource(snapshot: RuntimeObservabilitySnapshot | null, source: string): RuntimeSourceSnapshot | undefined {
    return snapshot?.sources?.[source]
}

function aggregateIngest(snapshot: RuntimeObservabilitySnapshot | null) {
    const sources = Object.values(snapshot?.sources || {})
    return sources.reduce(
        (acc, source) => {
            acc.input += source.ingest.input || 0
            acc.inserted += source.ingest.inserted || 0
            acc.duplicates += source.ingest.duplicates || 0
            acc.failed += source.ingest.failed || 0
            acc.count += source.ingest.count || 0
            acc.errors += source.ingest.errors || 0
            acc.maxP95 = Math.max(acc.maxP95, source.ingest.p95_ms || 0)
            return acc
        },
        { input: 0, inserted: 0, duplicates: 0, failed: 0, count: 0, errors: 0, maxP95: 0 }
    )
}

function StatusCard({
    title,
    value,
    detail,
    icon: Icon,
    tone = 'blue',
}: {
    title: string
    value: string | number
    detail: string
    icon: any
    tone?: 'blue' | 'green' | 'amber' | 'rose' | 'slate'
}) {
    const toneClasses = {
        blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300',
        green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-300',
        amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300',
        rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-300',
        slate: 'bg-slate-50 text-slate-600 dark:bg-slate-900/20 dark:text-slate-300',
    }

    return (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/80">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{title}</p>
                    <p className="mt-2 truncate text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{value}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{detail}</p>
                </div>
                <div className={`rounded-xl p-2.5 ${toneClasses[tone]}`}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
        </div>
    )
}

function MetricRow({ label, metric, max }: { label: string; metric: RuntimeMetricSnapshot; max: number }) {
    const width = max > 0 ? Math.max(3, Math.min(100, ((metric.p95_ms || 0) / max) * 100)) : 3
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">
                    P95 {formatMS(metric.p95_ms)} · 错误 {formatPercent(metric.error_rate)}
                </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div className="h-full rounded-full bg-blue-500 transition-all dark:bg-blue-400" style={{ width: `${width}%` }} />
            </div>
        </div>
    )
}

function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700/50 dark:bg-gray-800/80">
            <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4 dark:border-gray-700/50">
                <div className="rounded-lg bg-gray-100 p-1.5 dark:bg-gray-700/60">
                    <Icon className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
            </div>
            <div className="p-5">{children}</div>
        </section>
    )
}

export default function RuntimeStatusTab() {
    const [snapshot, setSnapshot] = useState<RuntimeObservabilitySnapshot | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => readRuntimeRefreshSettings().enabled)
    const [autoRefreshIntervalSeconds, setAutoRefreshIntervalSeconds] = useState(() => readRuntimeRefreshSettings().intervalSeconds)
    const refreshInFlightRef = useRef(false)

    const loadSnapshot = useCallback(async (options?: { silent?: boolean }) => {
        if (refreshInFlightRef.current) return
        const silent = options?.silent ?? false
        refreshInFlightRef.current = true
        try {
            if (silent) {
                setRefreshing(true)
            } else {
                setLoading(true)
            }
            const data = await observabilityService.getRuntimeSnapshot()
            setSnapshot(data)
        } catch (error) {
            console.error('加载运行状态失败:', error)
            if (!silent) toast.error('加载运行状态失败')
        } finally {
            refreshInFlightRef.current = false
            if (silent) {
                setRefreshing(false)
            } else {
                setLoading(false)
            }
        }
    }, [])

    useEffect(() => {
        loadSnapshot()
    }, [loadSnapshot])

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem(RUNTIME_REFRESH_STORAGE_KEY, JSON.stringify({
            enabled: autoRefreshEnabled,
            intervalSeconds: autoRefreshIntervalSeconds,
        }))
    }, [autoRefreshEnabled, autoRefreshIntervalSeconds])

    useEffect(() => {
        if (!autoRefreshEnabled) return
        const timer = window.setInterval(() => {
            loadSnapshot({ silent: true })
        }, autoRefreshIntervalSeconds * 1000)
        return () => window.clearInterval(timer)
    }, [autoRefreshEnabled, autoRefreshIntervalSeconds, loadSnapshot])

    useEffect(() => {
        registerRefreshCallback('runtime-status', () => {
            loadSnapshot()
        })
        return () => unregisterRefreshCallback('runtime-status')
    }, [loadSnapshot])

    const derived = useMemo(() => {
        const pickup = getSource(snapshot, 'pickup')
        const background = getSource(snapshot, 'background_import')
        const ingest = aggregateIngest(snapshot)
        const outlookOperations = Object.values(snapshot?.outlook?.operations || {})
        const maxOutlookP95 = Math.max(1, ...outlookOperations.map(operation => operation.total.p95_ms || 0))
        const maxSourceWaitP95 = Math.max(
            1,
            pickup?.sync_slot_wait.p95_ms || 0,
            background?.sync_slot_wait.p95_ms || 0,
        )
        const outlookErrorRate = outlookOperations.reduce((max, operation) => Math.max(max, operation.total.error_rate || 0), 0)
        return {
            pickup,
            background,
            ingest,
            outlookOperations,
            maxOutlookP95,
            maxSourceWaitP95,
            outlookErrorRate,
        }
    }, [snapshot])

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center">
                    <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary-600" />
                    <p className="text-sm text-gray-600 dark:text-gray-400">加载运行状态...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">运行状态</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        已运行 {formatDuration(snapshot?.uptime_seconds || 0)} · 更新于 {formatDateTime(snapshot?.generated_at)}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={() => loadSnapshot({ silent: true })}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                        <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-primary-600 dark:text-primary-400' : ''}`} />
                        刷新
                    </button>
                    <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/80">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">自动刷新</span>
                        <Switch checked={autoRefreshEnabled} onCheckedChange={setAutoRefreshEnabled} aria-label="自动刷新" className="scale-90" />
                        <Select
                            value={String(autoRefreshIntervalSeconds)}
                            onValueChange={value => setAutoRefreshIntervalSeconds(Number(value))}
                            disabled={!autoRefreshEnabled}
                        >
                            <SelectTrigger className="h-8 w-[92px] rounded-lg border-gray-200 bg-white text-xs dark:border-gray-700 dark:bg-gray-900">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {RUNTIME_REFRESH_INTERVAL_OPTIONS.map(option => (
                                    <SelectItem key={option.value} value={String(option.value)}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatusCard
                    title="取件等待 P95"
                    value={formatMS(derived.pickup?.sync_slot_wait.p95_ms)}
                    detail={`运行中 ${snapshot?.sync_concurrency.current_pickup || 0}/${snapshot?.sync_concurrency.pickup_limit || 0}`}
                    icon={ShieldCheck}
                    tone={(derived.pickup?.sync_slot_wait.p95_ms || 0) > 5000 ? 'rose' : 'green'}
                />
                <StatusCard
                    title="后台导入任务"
                    value={snapshot?.batch_outlook_import.running_jobs || 0}
                    detail={`完成 ${snapshot?.batch_outlook_import.completed_results || 0}/${snapshot?.batch_outlook_import.total_accounts || 0}`}
                    icon={Server}
                    tone={(snapshot?.batch_outlook_import.running_jobs || 0) > 0 ? 'amber' : 'slate'}
                />
                <StatusCard
                    title="Outlook 错误率"
                    value={formatPercent(derived.outlookErrorRate)}
                    detail={`后台请求 ${snapshot?.outlook.limiter.active_background || 0}/${snapshot?.outlook.limiter.background_limit || 0}`}
                    icon={Wifi}
                    tone={derived.outlookErrorRate > 0.05 ? 'rose' : 'blue'}
                />
                <StatusCard
                    title="邮件入库 P95"
                    value={formatMS(derived.ingest.maxP95)}
                    detail={`插入 ${derived.ingest.inserted.toLocaleString()} · 重复 ${derived.ingest.duplicates.toLocaleString()}`}
                    icon={Database}
                    tone={derived.ingest.failed > 0 ? 'amber' : 'green'}
                />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <Panel title="取件与后台让路" icon={Gauge}>
                    <div className="space-y-5">
                        <MetricRow label="取件 slot 等待" metric={derived.pickup?.sync_slot_wait || emptyMetric} max={derived.maxSourceWaitP95} />
                        <MetricRow label="后台导入 slot 等待" metric={derived.background?.sync_slot_wait || emptyMetric} max={derived.maxSourceWaitP95} />
                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/30">
                                <p className="text-xs text-gray-500 dark:text-gray-400">取件同步中</p>
                                <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{derived.pickup?.sync_in_flight || 0}</p>
                            </div>
                            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/30">
                                <p className="text-xs text-gray-500 dark:text-gray-400">后台同步中</p>
                                <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{derived.background?.sync_in_flight || 0}</p>
                            </div>
                            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/30">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Pickup waiting</p>
                                <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{snapshot?.outlook.limiter.waiting_pickup || 0}</p>
                            </div>
                        </div>
                    </div>
                </Panel>

                <Panel title="Outlook API" icon={Wifi}>
                    <div className="space-y-5">
                        {derived.outlookOperations.length > 0 ? (
                            derived.outlookOperations.map(operation => (
                                <MetricRow
                                    key={operation.operation}
                                    label={operationLabel(operation.operation)}
                                    metric={operation.total}
                                    max={derived.maxOutlookP95}
                                />
                            ))
                        ) : (
                            <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">暂无 Outlook 请求</div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/30">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Pickup active</p>
                                <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{snapshot?.outlook.limiter.active_pickup || 0}</p>
                            </div>
                            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/30">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Normal active</p>
                                <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{snapshot?.outlook.limiter.active_normal || 0}</p>
                            </div>
                            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/30">
                                <p className="text-xs text-gray-500 dark:text-gray-400">Background active</p>
                                <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{snapshot?.outlook.limiter.active_background || 0}</p>
                            </div>
                        </div>
                    </div>
                </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <Panel title="入库吞吐" icon={Database}>
                    <div className="grid gap-3 sm:grid-cols-4">
                        {[
                            ['输入', derived.ingest.input],
                            ['插入', derived.ingest.inserted],
                            ['重复', derived.ingest.duplicates],
                            ['失败', derived.ingest.failed],
                        ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/30">
                                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                                <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{Number(value).toLocaleString()}</p>
                            </div>
                        ))}
                    </div>
                    <div className="mt-5 space-y-3">
                        {Object.values(snapshot?.sources || {}).map(source => (
                            <MetricRow
                                key={source.source}
                                label={sourceLabel(source.source)}
                                metric={source.ingest}
                                max={Math.max(1, derived.ingest.maxP95)}
                            />
                        ))}
                    </div>
                </Panel>

                <Panel title="最近异常" icon={AlertCircle}>
                    {snapshot?.recent_errors?.length ? (
                        <div className="space-y-2">
                            {snapshot.recent_errors.slice(0, 6).map((error, index) => (
                                <div key={`${error.at}-${index}`} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700/50 dark:bg-gray-700/30">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                                                {error.area} · {error.type}
                                            </p>
                                            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                                                {[error.source && sourceLabel(error.source), error.operation && operationLabel(error.operation)].filter(Boolean).join(' / ') || 'runtime'}
                                            </p>
                                        </div>
                                        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{new Date(error.at).toLocaleTimeString()}</span>
                                    </div>
                                    <p className="mt-2 line-clamp-2 text-xs text-gray-600 dark:text-gray-300">{error.message}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-emerald-600 dark:text-emerald-300">
                            <CheckCircle2 className="h-4 w-4" />
                            暂无异常
                        </div>
                    )}
                </Panel>
            </div>

            <Panel title="后台导入任务" icon={Activity}>
                {snapshot?.batch_outlook_import.recent_jobs?.length ? (
                    <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-700/50">
                        <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr] bg-gray-50 px-4 py-2 text-xs font-medium text-gray-500 dark:bg-gray-700/40 dark:text-gray-300">
                            <span>任务</span>
                            <span>阶段</span>
                            <span>进度</span>
                            <span>更新时间</span>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                            {snapshot.batch_outlook_import.recent_jobs.map(job => (
                                <div key={job.job_id} className="grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr] items-center px-4 py-3 text-sm">
                                    <span className="truncate font-medium text-gray-900 dark:text-white">{job.job_id}</span>
                                    <span className="truncate text-gray-600 dark:text-gray-300">{job.stage}</span>
                                    <span className="tabular-nums text-gray-600 dark:text-gray-300">{job.completed_results}/{job.total}</span>
                                    <span className="truncate text-gray-500 dark:text-gray-400">{formatDateTime(job.updated_at)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">暂无后台导入任务</div>
                )}
            </Panel>
        </div>
    )
}
