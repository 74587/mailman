'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    Cpu,
    Database,
    Gauge,
    HardDrive,
    HelpCircle,
    ListChecks,
    Loader2,
    RefreshCw,
    Server,
    ShieldCheck,
    Wifi,
} from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'
import {
    observabilityService,
    RuntimeActiveOperationSnapshot,
    RuntimeMetricSnapshot,
    RuntimeObservabilitySnapshot,
    RuntimeSourceSnapshot,
} from '@/services/observability.service'

const RUNTIME_REFRESH_STORAGE_KEY = 'mailman-runtime-status-refresh-settings'
const RUNTIME_REFRESH_MIN_SECONDS = 1
const RUNTIME_REFRESH_MAX_SECONDS = 3600
const RUNTIME_REFRESH_INTERVAL_OPTIONS = [
    { value: 1, label: '1秒' },
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

function clampRuntimeRefreshInterval(value: number, fallback = 15) {
    if (!Number.isFinite(value)) return fallback
    return Math.min(RUNTIME_REFRESH_MAX_SECONDS, Math.max(RUNTIME_REFRESH_MIN_SECONDS, Math.round(value)))
}

function runtimeRefreshPresetValue(intervalSeconds: number) {
    if (RUNTIME_REFRESH_INTERVAL_OPTIONS.some(option => option.value === intervalSeconds)) {
        return String(intervalSeconds)
    }
    return 'custom'
}

function readRuntimeRefreshSettings() {
    const fallback = { enabled: true, intervalSeconds: 15 }
    if (typeof window === 'undefined') return fallback

    try {
        const raw = window.localStorage.getItem(RUNTIME_REFRESH_STORAGE_KEY)
        if (!raw) return fallback
        const parsed = JSON.parse(raw)
        const intervalSeconds = Number(parsed.intervalSeconds)
        return {
            enabled: Boolean(parsed.enabled),
            intervalSeconds: clampRuntimeRefreshInterval(intervalSeconds, fallback.intervalSeconds),
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

function formatBytes(bytes: number | undefined) {
    const value = bytes || 0
    if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)}GB`
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`
    return `${value}B`
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
        proxy_dial: '代理拨号',
        tls_dial: 'TLS 拨号',
        tcp_dial: 'TCP 拨号',
        tls_handshake: 'TLS 握手',
        oauth_refresh: 'OAuth 刷新',
        login: 'IMAP 登录',
        mailbox_select: '选择邮箱',
        search: '搜索邮件',
        fetch: '读取邮件',
        fetch_emails: '读取邮件',
        pickup_poll: '取件轮询',
        account_sync: '账户同步',
    }
    return labels[operation] || operation
}

function stageLabel(stage: string) {
    const labels: Record<string, string> = {
        resolve_account: '解析账户',
        register_pickup_override: '续期取件窗口',
        immediate_sync: '立即同步',
        search_db: '搜索数据库',
        extract: '提取内容',
        create_sync_run: '创建同步记录',
        get_account: '读取账户',
        read_sync_cursor: '读取游标',
        fetch_from_server: '服务端取信',
        process_emails: '邮件入库',
        update_sync_cursor: '更新游标',
        connect: '连接准备',
        create_proxy_dialer: '创建代理拨号器',
        proxy_dial: '代理拨号',
        tls_dial: 'TLS 拨号',
        tcp_dial: 'TCP 拨号',
        tls_handshake: 'TLS 握手',
        oauth_refresh: 'OAuth 刷新',
        login: '登录',
        mailbox_select: '选择邮箱',
        search: '搜索',
        fetch: '读取',
    }
    return labels[stage] || stage || '-'
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

function MetricHelp({ children }: { children: React.ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    aria-label="指标说明"
                >
                    <HelpCircle className="h-3.5 w-3.5" />
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs whitespace-normal p-3 text-left text-xs leading-5">
                {children}
            </TooltipContent>
        </Tooltip>
    )
}

function StatusCard({
    title,
    value,
    detail,
    icon: Icon,
    tone = 'blue',
    help,
}: {
    title: string
    value: string | number
    detail: string
    icon: any
    tone?: 'blue' | 'green' | 'amber' | 'rose' | 'slate'
    help?: React.ReactNode
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
                    <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{title}</p>
                        {help && <MetricHelp>{help}</MetricHelp>}
                    </div>
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

function MetricRow({ label, metric, max, help }: { label: string; metric: RuntimeMetricSnapshot; max: number; help?: React.ReactNode }) {
    const width = max > 0 ? Math.max(3, Math.min(100, ((metric.p95_ms || 0) / max) * 100)) : 3
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-gray-700 dark:text-gray-200">
                    <span className="truncate">{label}</span>
                    {help && <MetricHelp>{help}</MetricHelp>}
                </span>
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

function Panel({ title, icon: Icon, help, children }: { title: string; icon: any; help?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700/50 dark:bg-gray-800/80">
            <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4 dark:border-gray-700/50">
                <div className="rounded-lg bg-gray-100 p-1.5 dark:bg-gray-700/60">
                    <Icon className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
                {help && <MetricHelp>{help}</MetricHelp>}
            </div>
            <div className="p-5">{children}</div>
        </section>
    )
}

function MiniStat({ label, value, help }: { label: string; value: string | number; help?: React.ReactNode }) {
    return (
        <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-700/30">
            <div className="flex items-center gap-1.5">
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                {help && <MetricHelp>{help}</MetricHelp>}
            </div>
            <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{value}</p>
        </div>
    )
}

function ActiveOperationRow({ operation }: { operation: RuntimeActiveOperationSnapshot }) {
    const identity = operation.account_email || (operation.account_id ? `账户 ${operation.account_id}` : operation.source || operation.kind)
    return (
        <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700/50 dark:bg-gray-700/30">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                        {operationLabel(operation.operation)} · {stageLabel(operation.stage)}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                        {[sourceLabel(operation.source || ''), identity].filter(Boolean).join(' / ')}
                    </p>
                </div>
                <span className="shrink-0 text-xs font-medium tabular-nums text-amber-600 dark:text-amber-300">{formatMS(operation.age_ms)}</span>
            </div>
        </div>
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
        const imapOperations = Object.values(snapshot?.imap?.operations || {})
        const activeOperations = snapshot?.active_operations || []
        const maxOutlookP95 = Math.max(1, ...outlookOperations.map(operation => operation.total.p95_ms || 0))
        const imapMaxP95 = Math.max(0, ...imapOperations.map(operation => operation.total.p95_ms || 0))
        const maxIMAPP95 = Math.max(1, imapMaxP95)
        const maxSourceWaitP95 = Math.max(
            1,
            pickup?.sync_slot_wait.p95_ms || 0,
            background?.sync_slot_wait.p95_ms || 0,
        )
        const outlookErrorRate = outlookOperations.reduce((max, operation) => Math.max(max, operation.total.error_rate || 0), 0)
        const imapErrorRate = imapOperations.reduce((max, operation) => Math.max(max, operation.total.error_rate || 0), 0)
        const oldestOperationAgeMS = activeOperations.reduce((max, operation) => Math.max(max, operation.age_ms || 0), 0)
        return {
            pickup,
            background,
            ingest,
            outlookOperations,
            imapOperations,
            activeOperations,
            maxOutlookP95,
            maxIMAPP95,
            imapMaxP95,
            maxSourceWaitP95,
            outlookErrorRate,
            imapErrorRate,
            oldestOperationAgeMS,
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
        <TooltipProvider delayDuration={150}>
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
                            value={runtimeRefreshPresetValue(autoRefreshIntervalSeconds)}
                            onValueChange={value => {
                                if (value === 'custom') return
                                setAutoRefreshIntervalSeconds(clampRuntimeRefreshInterval(Number(value)))
                            }}
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
                                <SelectItem value="custom">自定义</SelectItem>
                            </SelectContent>
                        </Select>
                        <Input
                            type="number"
                            min={RUNTIME_REFRESH_MIN_SECONDS}
                            max={RUNTIME_REFRESH_MAX_SECONDS}
                            value={autoRefreshIntervalSeconds}
                            onChange={event => {
                                const next = Number(event.target.value)
                                if (Number.isFinite(next)) {
                                    setAutoRefreshIntervalSeconds(clampRuntimeRefreshInterval(next))
                                }
                            }}
                            disabled={!autoRefreshEnabled}
                            aria-label="自动刷新秒数"
                            className="h-8 w-20 rounded-lg border-gray-200 bg-white text-xs tabular-nums dark:border-gray-700 dark:bg-gray-900"
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400">秒</span>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                <StatusCard
                    title="取件等待 P95"
                    value={formatMS(derived.pickup?.sync_slot_wait.p95_ms)}
                    detail={`运行中 ${snapshot?.sync_concurrency.current_pickup || 0}/${snapshot?.sync_concurrency.pickup_limit || 0}`}
                    icon={ShieldCheck}
                    tone={(derived.pickup?.sync_slot_wait.p95_ms || 0) > 5000 ? 'rose' : 'green'}
                    help="取件同步等待全局 pickup 并发槽的 P95 耗时。高于几秒通常说明 pickup 槽被长时间同步占住，是排查验证码读取超时的第一指标。"
                />
                <StatusCard
                    title="活跃操作"
                    value={derived.activeOperations.length}
                    detail={`最长 ${formatMS(derived.oldestOperationAgeMS)}`}
                    icon={ListChecks}
                    tone={derived.oldestOperationAgeMS > 60000 ? 'rose' : derived.activeOperations.length > 0 ? 'amber' : 'green'}
                    help="当前还没有结束的 pickup、sync、IMAP 操作。数量不降或最长耗时持续增长，说明有请求或后台同步仍卡在某个阶段。"
                />
                <StatusCard
                    title="DB 连接池"
                    value={`${snapshot?.database?.in_use || 0}/${snapshot?.database?.open_connections || 0}`}
                    detail={`等待 ${snapshot?.database?.wait_count || 0} · ${formatMS(snapshot?.database?.wait_duration_ms)}`}
                    icon={HardDrive}
                    tone={(snapshot?.database?.wait_count || 0) > 0 ? 'amber' : 'green'}
                    help="来自 Go sql.DB Stats。in_use/open 表示正在使用和已打开连接；wait_count/wait_duration 表示请求曾等待连接池，用来判断 dashboard/stats 是否被 DB 池耗尽拖住。"
                />
                <StatusCard
                    title="Goroutines"
                    value={snapshot?.process?.goroutines || 0}
                    detail={`堆 ${formatBytes(snapshot?.process?.heap_alloc_bytes)} · 栈 ${formatBytes(snapshot?.process?.stack_inuse_bytes)}`}
                    icon={Cpu}
                    tone={(snapshot?.process?.goroutines || 0) > 1000 ? 'amber' : 'slate'}
                    help="Go 进程当前 goroutine 数和内存概览。批量任务后只涨不降，通常提示有网络/IMAP/后台任务没有退出。"
                />
                <StatusCard
                    title="IMAP 错误率"
                    value={formatPercent(derived.imapErrorRate)}
                    detail={`阶段 P95 ${formatMS(derived.imapMaxP95)}`}
                    icon={Wifi}
                    tone={derived.imapErrorRate > 0.05 ? 'rose' : 'blue'}
                    help="传统 IMAP 路径按阶段聚合的最大错误率和最慢 P95。用来区分 proxy_dial、TLS、login、search、fetch 哪一段变慢。"
                />
                <StatusCard
                    title="邮件入库 P95"
                    value={formatMS(derived.ingest.maxP95)}
                    detail={`插入 ${derived.ingest.inserted.toLocaleString()} · 重复 ${derived.ingest.duplicates.toLocaleString()}`}
                    icon={Database}
                    tone={derived.ingest.failed > 0 ? 'amber' : 'green'}
                    help="邮件写入数据库的 P95 耗时。这里变慢通常指向去重、批量插入、索引或数据库连接池压力。"
                />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <Panel
                    title="系统瓶颈"
                    icon={HardDrive}
                    help="聚合 Go 进程和数据库连接池状态。用于判断接口卡顿是应用 goroutine 积压、DB 连接池等待，还是 PostgreSQL 内部 wait_event。"
                >
                    <div className="grid gap-3 sm:grid-cols-4">
                        <MiniStat
                            label="DB 使用中"
                            value={`${snapshot?.database?.in_use || 0}/${snapshot?.database?.max_open_connections || 0}`}
                            help="当前正在使用的数据库连接数 / 最大连接数。接近上限时，新请求可能等待连接，dashboard/stats 会变慢或超时。"
                        />
                        <MiniStat
                            label="DB 等待次数"
                            value={(snapshot?.database?.wait_count || 0).toLocaleString()}
                            help="进程启动后等待数据库连接池的累计次数。批量取件后持续增加，说明 DB 池是瓶颈之一。"
                        />
                        <MiniStat
                            label="DB 等待耗时"
                            value={formatMS(snapshot?.database?.wait_duration_ms)}
                            help="进程启动后等待数据库连接池的累计耗时。和等待次数一起看，用来判断是否需要查慢 SQL 或调连接池。"
                        />
                        <MiniStat
                            label="Goroutines"
                            value={snapshot?.process?.goroutines || 0}
                            help="当前 Go goroutine 数。批量任务结束后长期不下降，通常表示网络请求、IMAP Fetch 或后台同步没有退出。"
                        />
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <div>
                            <div className="mb-2 flex items-center gap-1.5">
                                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Postgres wait_event</p>
                                <MetricHelp>来自 pg_stat_activity 的分组摘要，不暴露具体 SQL。出现 Lock、Client、IO 等等待时，用它判断数据库卡在哪类等待。</MetricHelp>
                            </div>
                            {snapshot?.database?.wait_events?.length ? (
                                <div className="space-y-2">
                                    {snapshot.database.wait_events.slice(0, 5).map((event, index) => (
                                        <div key={`${event.state}-${event.wait_event_type}-${event.wait_event}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-700/30">
                                            <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">
                                                {event.state || 'unknown'} · {event.wait_event_type || 'running'} {event.wait_event ? `· ${event.wait_event}` : ''}
                                            </span>
                                            <span className="shrink-0 font-medium tabular-nums text-gray-500 dark:text-gray-400">{event.count}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-lg bg-gray-50 px-3 py-6 text-center text-xs text-gray-500 dark:bg-gray-700/30 dark:text-gray-400">
                                    {snapshot?.database?.wait_events_error || '暂无等待事件'}
                                </div>
                            )}
                        </div>

                        <div>
                            <div className="mb-2 flex items-center gap-1.5">
                                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">活跃操作</p>
                                <MetricHelp>仍未完成的 pickup、sync、IMAP 操作。看 stage 和 age 可以判断当前请求卡在解析账户、DB 搜索、代理拨号、TLS、登录还是 Fetch。</MetricHelp>
                            </div>
                            {derived.activeOperations.length ? (
                                <div className="space-y-2">
                                    {derived.activeOperations.slice(0, 5).map(operation => (
                                        <ActiveOperationRow key={operation.id} operation={operation} />
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-lg bg-gray-50 px-3 py-6 text-center text-xs text-emerald-600 dark:bg-gray-700/30 dark:text-emerald-300">暂无卡住的活跃操作</div>
                            )}
                        </div>
                    </div>
                </Panel>

                <Panel
                    title="取件与后台让路"
                    icon={Gauge}
                    help="同步并发槽按来源拆分。pickup 用于验证码/注册取件，后台导入应避免把 pickup 槽挤满。"
                >
                    <div className="space-y-5">
                        <MetricRow
                            label="取件 slot 等待"
                            metric={derived.pickup?.sync_slot_wait || emptyMetric}
                            max={derived.maxSourceWaitP95}
                            help="pickup 同步等待专用并发槽的耗时。这个 P95 升高，说明验证码读取请求可能在等待其他同步释放槽。"
                        />
                        <MetricRow
                            label="后台导入 slot 等待"
                            metric={derived.background?.sync_slot_wait || emptyMetric}
                            max={derived.maxSourceWaitP95}
                            help="后台导入等待普通同步槽的耗时。它高而 pickup 正常，说明批量导入慢但不会直接拖垮取件。"
                        />
                        <div className="grid gap-3 sm:grid-cols-3">
                            <MiniStat label="取件同步中" value={derived.pickup?.sync_in_flight || 0} help="已经拿到并发槽、还没结束的 pickup 同步数。长期不归零说明有同步卡在 fetch/process/update 阶段。" />
                            <MiniStat label="后台同步中" value={derived.background?.sync_in_flight || 0} help="后台导入或普通同步中正在执行的同步数。它高时会消耗普通同步槽。" />
                            <MiniStat label="Pickup waiting" value={snapshot?.outlook.limiter.waiting_pickup || 0} help="Outlook Graph 限流器里等待 pickup 优先级请求的数量。只影响 Outlook Graph API 路径，不覆盖传统 IMAP。" />
                        </div>
                    </div>
                </Panel>

                <Panel
                    title="IMAP 阶段"
                    icon={Server}
                    help="传统 IMAP 取信按阶段统计。批量注册后 pickup/poll 超时，优先看这里是卡在 proxy_dial、TLS/login，还是 search/fetch。"
                >
                    <div className="space-y-5">
                        {derived.imapOperations.length > 0 ? (
                            derived.imapOperations.map(operation => (
                                <MetricRow
                                    key={operation.operation}
                                    label={operationLabel(operation.operation)}
                                    metric={operation.total}
                                    max={derived.maxIMAPP95}
                                    help={`IMAP ${operationLabel(operation.operation)} 阶段的耗时和错误率。P95 或错误率升高时，说明卡顿主要发生在这个网络/协议阶段。`}
                                />
                            ))
                        ) : (
                            <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">暂无 IMAP 阶段数据</div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-3">
                            <MiniStat label="IMAP 阶段数" value={derived.imapOperations.length} help="已记录过的 IMAP 阶段数量。没有数据通常表示当前账户走 Gmail/Outlook API，或服务刚启动还没触发 IMAP 同步。" />
                            <MiniStat label="IMAP 错误率" value={formatPercent(derived.imapErrorRate)} help="所有 IMAP 阶段中的最高错误率，用来快速发现代理、TLS、登录或读取阶段是否正在失败。" />
                            <MiniStat label="最慢 P95" value={formatMS(derived.imapMaxP95)} help="IMAP 各阶段中最大的 P95 耗时。它高时，再看上方具体是哪一个阶段拉高。" />
                        </div>
                    </div>
                </Panel>

                <Panel
                    title="Outlook API"
                    icon={Wifi}
                    help="Outlook Graph API 路径的请求耗时和限流器状态。Outlook OAuth 账户通常看这里，传统 IMAP 账户看 IMAP 阶段。"
                >
                    <div className="space-y-5">
                        {derived.outlookOperations.length > 0 ? (
                            derived.outlookOperations.map(operation => (
                                <MetricRow
                                    key={operation.operation}
                                    label={operationLabel(operation.operation)}
                                    metric={operation.total}
                                    max={derived.maxOutlookP95}
                                    help={`Outlook Graph ${operationLabel(operation.operation)} 请求的耗时和错误率。用于判断 token、目录列表或邮件读取是否被上游/代理拖慢。`}
                                />
                            ))
                        ) : (
                            <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">暂无 Outlook 请求</div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-3">
                            <MiniStat label="Pickup active" value={snapshot?.outlook.limiter.active_pickup || 0} help="Outlook Graph pickup 优先级正在执行的请求数。验证码取件对应这一层。" />
                            <MiniStat label="Normal active" value={snapshot?.outlook.limiter.active_normal || 0} help="普通 Outlook Graph 请求并发数，用于手动同步或常规读取。" />
                            <MiniStat label="Background active" value={snapshot?.outlook.limiter.active_background || 0} help="后台导入 Outlook Graph 请求并发数。它应该被限制，避免挤占 pickup。" />
                        </div>
                    </div>
                </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <Panel
                    title="入库吞吐"
                    icon={Database}
                    help="统一邮件入库管线的吞吐和耗时。用于判断取信已经完成后，是否卡在去重、写库、索引或批量插入。"
                >
                    <div className="grid gap-3 sm:grid-cols-4">
                        <MiniStat label="输入" value={derived.ingest.input.toLocaleString()} help="进入入库管线的邮件总数，包含后续发现重复或失败的邮件。" />
                        <MiniStat label="插入" value={derived.ingest.inserted.toLocaleString()} help="成功写入数据库的新邮件数量。" />
                        <MiniStat label="重复" value={derived.ingest.duplicates.toLocaleString()} help="按 Message-ID/账户等规则判断为已存在的邮件数量。重复高通常不是错误。" />
                        <MiniStat label="失败" value={derived.ingest.failed.toLocaleString()} help="入库失败的邮件数量。失败增长时要结合最近异常和数据库错误排查。" />
                    </div>
                    <div className="mt-5 space-y-3">
                        {Object.values(snapshot?.sources || {}).map(source => (
                            <MetricRow
                                key={source.source}
                                label={sourceLabel(source.source)}
                                metric={source.ingest}
                                max={Math.max(1, derived.ingest.maxP95)}
                                help={`${sourceLabel(source.source)} 来源的入库耗时和错误率。可区分是 pickup、后台导入还是自动同步导致写库压力。`}
                            />
                        ))}
                    </div>
                </Panel>

                <Panel
                    title="最近异常"
                    icon={AlertCircle}
                    help="运行时埋点捕获的最近错误，按区域、来源、阶段归类。它不会替代完整日志，但适合在 UI 上快速确认 timeout/network/auth/DB 方向。"
                >
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

            <Panel
                title="后台导入任务"
                icon={Activity}
                help="批量 Outlook 导入任务的内存态摘要。用于判断后台批量任务是否仍在跑，是否可能和取件争抢同步资源。"
            >
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
        </TooltipProvider>
    )
}
