'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, Settings, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'
import { cn } from '@/lib/utils'
import { BusinessLog, BusinessLogStats, loggingService } from '@/services/logging.service'
import { useAISkill, type AISkill, type AISkillAction } from '@/components/ai'
import { BusinessLogDetailDrawer } from './business-log-detail-drawer'

const MODULES = ['sync', 'pickup', 'trigger', 'email_account', 'business', 'proxy', 'wiki', 'oauth2', 'system_config', 'api']
const STATUSES = ['', 'success', 'failed', 'partial', 'skipped', 'cancelled']
const OPERATION_TYPES = ['', 'manual', 'automatic', 'api', 'scheduled']
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]

function formatDate(value?: string) {
    if (!value) return '-'
    return new Date(value).toLocaleString()
}

function formatDuration(ms?: number) {
    const value = ms || 0
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`
    return `${value}ms`
}

function statusTone(status: string) {
    switch (status) {
        case 'success':
            return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
        case 'failed':
            return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
        case 'partial':
            return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        case 'skipped':
            return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
        default:
            return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    }
}

function summarizeLogForAI(log: BusinessLog) {
    return {
        id: log.id,
        module: log.module,
        action: log.action,
        title: log.title,
        status: log.status,
        operationType: log.operationType,
        actorType: log.actorType,
        actorName: log.actorName,
        entityType: log.entityType,
        entityId: log.entityId,
        entityName: log.entityName,
        startedAt: log.startedAt,
        finishedAt: log.finishedAt,
        durationMs: log.durationMs,
        traceId: log.traceId,
        runId: log.runId,
        requestId: log.requestId,
        errorCode: log.errorCode,
        errorMessage: log.errorMessage,
        summary: log.summary,
        result: log.result,
        details: log.details,
        user: log.user ? {
            id: log.user.id,
            username: log.user.username,
            email: log.user.email,
        } : undefined,
    }
}

function normalizeLogStatus(value: unknown) {
    const status = String(value || '').trim().toLowerCase()
    return STATUSES.includes(status) ? status : ''
}

function normalizeLogModule(value: unknown) {
    const module = String(value || '').trim()
    return MODULES.includes(module) ? module : ''
}

function normalizeOperationType(value: unknown) {
    const operationType = String(value || '').trim().toLowerCase()
    return OPERATION_TYPES.includes(operationType) ? operationType : ''
}

function normalizeDateTimeValue(value: unknown) {
    if (!value) return ''
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) return ''
    const pad = (item: number) => String(item).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function BusinessLogsTab() {
    const [items, setItems] = useState<BusinessLog[]>([])
    const [total, setTotal] = useState(0)
    const [stats, setStats] = useState<BusinessLogStats | null>(null)
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [selectedLogOverride, setSelectedLogOverride] = useState<BusinessLog | null>(null)
    const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [query, setQuery] = useState('')
    const [module, setModule] = useState('')
    const [status, setStatus] = useState('')
    const [operationType, setOperationType] = useState('')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const [pageSize, setPageSize] = useState(100)
    const [pageIndex, setPageIndex] = useState(0)
    const [cursorStack, setCursorStack] = useState<Array<number | undefined>>([undefined])
    const [nextCursor, setNextCursor] = useState<number | null>(null)
    const [hasMore, setHasMore] = useState(false)

    const filters = useMemo(() => ({
        q: query,
        module,
        status,
        operation_type: operationType,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
    }), [from, module, operationType, query, status, to])

    const currentCursor = cursorStack[pageIndex]

    const params = useMemo(() => ({
        ...filters,
        limit: pageSize,
        before_id: currentCursor,
    }), [currentCursor, filters, pageSize])

    const selected = useMemo(
        () => selectedLogOverride?.id === selectedId
            ? selectedLogOverride
            : items.find(item => item.id === selectedId) || null,
        [items, selectedId, selectedLogOverride],
    )

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [list, nextStats] = await Promise.all([
                loggingService.listBusinessLogs(params),
                loggingService.getBusinessLogStats(params),
            ])
            setItems(list.items || [])
            setTotal(list.total || 0)
            setNextCursor(list.nextCursor ?? null)
            setHasMore(Boolean(list.hasMore))
            setStats(nextStats)
        } catch (error) {
            console.error(error)
            toast.error('加载业务日志失败')
        } finally {
            setLoading(false)
        }
    }, [params])

    useEffect(() => {
        load()
    }, [load])

    useEffect(() => {
        if (selectedId && selectedLogOverride?.id !== selectedId && !items.some(item => item.id === selectedId)) {
            setSelectedId(null)
        }
    }, [items, selectedId, selectedLogOverride])

    useEffect(() => {
        registerRefreshCallback('business-logs', load)
        return () => unregisterRefreshCallback('business-logs')
    }, [load])

    const openSettings = useCallback(() => {
        window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: 'business-log-org-settings' } }))
    }, [])

    const resetPagination = useCallback(() => {
        setPageIndex(0)
        setCursorStack([undefined])
        setNextCursor(null)
        setHasMore(false)
        setSelectedId(null)
    }, [])

    const goPrevPage = () => {
        setPageIndex(prev => Math.max(0, prev - 1))
    }

    const goNextPage = () => {
        if (!hasMore || !nextCursor) return
        setCursorStack(prev => {
            const base = prev.slice(0, pageIndex + 1)
            return [...base, nextCursor]
        })
        setPageIndex(prev => prev + 1)
    }

    const openBusinessLog = useCallback(async (item: BusinessLog) => {
        setSelectedId(item.id)
        setSelectedLogOverride(item)
        setDetailLoadingId(item.id)

        try {
            const fullLog = await loggingService.getBusinessLog(item.id)
            setSelectedId(fullLog.id)
            setSelectedLogOverride(fullLog)
        } catch (error) {
            console.error(error)
            toast.error('加载业务日志详情失败，已显示列表摘要')
        } finally {
            setDetailLoadingId(current => current === item.id ? null : current)
        }
    }, [])

    const businessLogsAISkill = useMemo<AISkill>(() => ({
        id: 'business-logs',
        title: '业务日志',
        description: '查询操作日志、流程日志、触发器/定时任务执行记录和异常详情。',
        aliases: ['业务日志', '操作日志', '审计日志', '流程日志', '最近异常', 'business logs', 'audit logs'],
        pageTabs: ['business-logs'],
        getContext: () => ({
            loading,
            isLoading: loading,
            filters: {
                query,
                module,
                status,
                operationType,
                from,
                to,
                pageSize,
                pageIndex,
                currentCursor,
                nextCursor,
                hasMore,
            },
            total,
            stats,
            selectedLog: selected ? summarizeLogForAI(selected) : null,
            visibleLogs: items.slice(0, 8).map(summarizeLogForAI),
        }),
        actions: [
            {
                name: 'searchBusinessLogs',
                title: '搜索业务日志',
                description: '按关键词、模块、状态、操作类型或时间范围筛选业务日志。',
                risk: 'read',
                parameters: {
                    query: '标题、实体、错误、trace/run/request id',
                    module: '业务模块，可选',
                    status: 'success/failed/partial/skipped/cancelled，可选',
                    operationType: 'manual/automatic/api/scheduled，可选',
                    from: '开始时间，可选',
                    to: '结束时间，可选',
                },
                run: async (params) => {
                    const nextQuery = String(params.query || params.q || '').trim()
                    const nextModule = normalizeLogModule(params.module)
                    const nextStatus = normalizeLogStatus(params.status)
                    const nextOperationType = normalizeOperationType(params.operationType || params.operation_type)
                    const nextFrom = normalizeDateTimeValue(params.from)
                    const nextTo = normalizeDateTimeValue(params.to)
                    const nextPageSize = Number(params.limit || params.pageSize || pageSize)
                    const safePageSize = PAGE_SIZE_OPTIONS.includes(nextPageSize) ? nextPageSize : pageSize
                    const requestParams = {
                        q: nextQuery,
                        module: nextModule,
                        status: nextStatus,
                        operation_type: nextOperationType,
                        from: nextFrom ? new Date(nextFrom).toISOString() : undefined,
                        to: nextTo ? new Date(nextTo).toISOString() : undefined,
                        limit: safePageSize,
                    }

                    setQuery(nextQuery)
                    setModule(nextModule)
                    setStatus(nextStatus)
                    setOperationType(nextOperationType)
                    setFrom(nextFrom)
                    setTo(nextTo)
                    setPageSize(safePageSize)
                    resetPagination()
                    setSelectedLogOverride(null)
                    setLoading(true)

                    try {
                        const [list, nextStats] = await Promise.all([
                            loggingService.listBusinessLogs(requestParams),
                            loggingService.getBusinessLogStats(requestParams),
                        ])
                        const nextItems = list.items || []
                        setItems(nextItems)
                        setTotal(list.total || 0)
                        setNextCursor(list.nextCursor ?? null)
                        setHasMore(Boolean(list.hasMore))
                        setStats(nextStats)
                        return {
                            success: true,
                            summary: `已筛选业务日志，匹配 ${list.total || nextItems.length} 条，当前显示 ${nextItems.length} 条。`,
                            data: {
                                matchedCount: list.total || nextItems.length,
                                visibleCount: nextItems.length,
                                filters: requestParams,
                                logs: nextItems.slice(0, 8).map(summarizeLogForAI),
                            },
                        }
                    } finally {
                        setLoading(false)
                    }
                },
            },
            {
                name: 'openBusinessLogDetail',
                title: '查看业务日志详情',
                description: '按日志 ID、traceId、runId 或关键词打开日志详情抽屉。',
                risk: 'read',
                parameters: { id: '日志 ID', traceId: 'Trace ID', runId: 'Run ID', query: '搜索关键词' },
                run: async (params) => {
                    const id = Number(params.id || params.logId || 0)
                    const traceId = String(params.traceId || params.trace_id || '').trim()
                    const runId = String(params.runId || params.run_id || '').trim()
                    const requestId = String(params.requestId || params.request_id || '').trim()
                    const queryText = String(params.query || params.q || traceId || runId || requestId || '').trim()
                    const nextModule = normalizeLogModule(params.module)
                    const nextStatus = normalizeLogStatus(params.status)
                    let targetLog: BusinessLog | null = null

                    if (id > 0) {
                        targetLog = await loggingService.getBusinessLog(id)
                    } else {
                        const list = await loggingService.listBusinessLogs({
                            q: queryText,
                            module: nextModule,
                            status: nextStatus,
                            limit: pageSize,
                        })
                        const candidates = list.items || []
                        targetLog = candidates.find(item => (
                            (traceId && item.traceId === traceId)
                            || (runId && item.runId === runId)
                            || (requestId && item.requestId === requestId)
                        )) || candidates[0] || null

                        setQuery(queryText)
                        setModule(nextModule)
                        setStatus(nextStatus)
                        setItems(candidates)
                        setTotal(list.total || candidates.length)
                        setNextCursor(list.nextCursor ?? null)
                        setHasMore(Boolean(list.hasMore))
                    }

                    if (!targetLog) {
                        return {
                            success: false,
                            summary: queryText ? `没有找到匹配 ${queryText} 的业务日志。` : '没有提供可定位的日志 ID、traceId、runId 或关键词。',
                            data: { query: queryText },
                        }
                    }

                    const fallbackLog = targetLog
                    const fullLog: BusinessLog = await loggingService.getBusinessLog(fallbackLog.id).catch(() => fallbackLog)
                    setSelectedId(fullLog.id)
                    setSelectedLogOverride(fullLog)
                    return {
                        success: true,
                        summary: `已打开业务日志「${fullLog.title}」，结果 ${fullLog.status}${fullLog.errorMessage ? `，错误：${fullLog.errorMessage}` : ''}。`,
                        details: fullLog.summary || fullLog.errorMessage || fullLog.result,
                        data: {
                            log: summarizeLogForAI(fullLog),
                        },
                    }
                },
            },
            {
                name: 'getSelectedBusinessLogDetails',
                title: '读取当前业务日志详情',
                description: '读取当前已打开的业务日志详情，用于排查或总结。',
                risk: 'read',
                run: async () => {
                    if (!selectedId) {
                        return { success: false, summary: '当前没有打开的业务日志详情。' }
                    }
                    const log = selected || await loggingService.getBusinessLog(selectedId)
                    setSelectedLogOverride(log)
                    return {
                        success: true,
                        summary: `当前业务日志是「${log.title}」，结果 ${log.status}${log.errorMessage ? `，错误：${log.errorMessage}` : ''}。`,
                        details: log.summary || log.errorMessage || log.result,
                        data: { log: summarizeLogForAI(log) },
                    }
                },
            },
            {
                name: 'openBusinessLogSettings',
                title: '打开业务日志设置',
                description: '切换到当前组织的业务日志设置页面。',
                risk: 'navigation',
                run: () => {
                    openSettings()
                    return {
                        success: true,
                        summary: '已打开当前组织的业务日志设置页面。',
                        data: { tabId: 'business-log-org-settings', navigationOnly: true },
                    }
                },
            },
        ] satisfies AISkillAction[],
    }), [
        currentCursor,
        from,
        hasMore,
        items,
        loading,
        module,
        nextCursor,
        openSettings,
        operationType,
        pageIndex,
        pageSize,
        query,
        resetPagination,
        selected,
        selectedId,
        stats,
        status,
        to,
        total,
    ])

    useAISkill(businessLogsAISkill)

    return (
        <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
            <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
                            <ShieldCheck className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                            业务日志
                        </h2>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span className="rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">总计 {stats?.total ?? total}</span>
                            {(stats?.byStatus || []).map(item => (
                                <span key={item.key} className={cn('rounded px-2 py-1', statusTone(item.key))}>{item.key} {item.count}</span>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={load} className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                            <RefreshCw className="h-4 w-4" />
                            刷新
                        </button>
                        <button onClick={openSettings} className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                            <Settings className="h-4 w-4" />
                            设置
                        </button>
                    </div>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-[1.4fr_150px_140px_140px_170px_170px]">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                        <Input value={query} onChange={event => { setQuery(event.target.value); resetPagination() }} placeholder="搜索标题、实体、错误、trace/run id" className="h-9 pl-9" />
                    </div>
                    <Select value={module || 'all'} onValueChange={value => { setModule(value === 'all' ? '' : value); resetPagination() }}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="模块" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部模块</SelectItem>
                            {MODULES.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={status || 'all'} onValueChange={value => { setStatus(value === 'all' ? '' : value); resetPagination() }}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="结果" /></SelectTrigger>
                        <SelectContent>
                            {STATUSES.map(item => <SelectItem key={item || 'all'} value={item || 'all'}>{item || '全部结果'}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={operationType || 'all'} onValueChange={value => { setOperationType(value === 'all' ? '' : value); resetPagination() }}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="类型" /></SelectTrigger>
                        <SelectContent>
                            {OPERATION_TYPES.map(item => <SelectItem key={item || 'all'} value={item || 'all'}>{item || '全部类型'}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Input type="datetime-local" value={from} onChange={event => { setFrom(event.target.value); resetPagination() }} className="h-9" />
                    <Input type="datetime-local" value={to} onChange={event => { setTo(event.target.value); resetPagination() }} className="h-9" />
                </div>
            </div>

            <div className="min-h-0 flex-1 p-4">
                <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    {loading ? (
                        <div className="flex h-full items-center justify-center text-gray-500">
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            加载业务日志...
                        </div>
                    ) : items.length ? (
                        <div className="min-h-0 flex-1 overflow-auto">
                            <div className="grid grid-cols-[150px_120px_96px_minmax(180px,1fr)_150px_90px] border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-800/70 dark:text-gray-300">
                                <span>时间</span>
                                <span>模块</span>
                                <span>结果</span>
                                <span>操作</span>
                                <span>实体</span>
                                <span>耗时</span>
                            </div>
                            <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                {items.map(item => (
                                    <button
                                        key={item.id}
                                        onClick={() => openBusinessLog(item)}
                                        className={cn(
                                            'grid w-full grid-cols-[150px_120px_96px_minmax(180px,1fr)_150px_90px] items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/60',
                                            selectedId === item.id && 'bg-primary-50/70 dark:bg-primary-950/20'
                                        )}
                                    >
                                        <span className="truncate text-xs text-gray-500 dark:text-gray-400">{formatDate(item.startedAt)}</span>
                                        <span className="truncate font-medium text-gray-700 dark:text-gray-200">{item.module}</span>
                                        <span><span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', statusTone(item.status))}>{item.status}</span></span>
                                        <span className="min-w-0">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                                <span className="block truncate font-medium text-gray-900 dark:text-white">{item.title}</span>
                                                {detailLoadingId === item.id && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" />}
                                            </span>
                                            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{item.action} · {item.operationType}</span>
                                        </span>
                                        <span className="truncate text-gray-600 dark:text-gray-300">{item.entityName || item.entityId || '-'}</span>
                                        <span className="tabular-nums text-gray-500 dark:text-gray-400">{formatDuration(item.durationMs)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-gray-500">
                            <AlertCircle className="h-4 w-4" />
                            暂无匹配日志
                        </div>
                    )}

                    <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300">
                        <div className="flex items-center gap-2">
                            <span className="whitespace-nowrap">每页</span>
                            <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); resetPagination() }}>
                                <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {PAGE_SIZE_OPTIONS.map(size => <SelectItem key={size} value={String(size)}>{size} 条</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <span className="whitespace-nowrap">总匹配 {total} 条</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="whitespace-nowrap">第 {pageIndex + 1} 页 · 本页 {items.length} 条{hasMore ? ' · 还有更早记录' : ''}</span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={goPrevPage}
                                    disabled={loading || pageIndex <= 0}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                                    title="上一页"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={goNextPage}
                                    disabled={loading || !hasMore || !nextCursor}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                                    title="下一页"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {selected && (
                <BusinessLogDetailDrawer
                    log={selected}
                    onClose={() => {
                        setSelectedId(null)
                        setSelectedLogOverride(null)
                    }}
                />
            )}
        </div>
    )
}
