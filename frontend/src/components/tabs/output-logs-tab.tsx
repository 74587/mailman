'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Download, Loader2, Pause, Play, RefreshCw, Search, Settings, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'
import { cn } from '@/lib/utils'
import { loggingService, OutputLogEntry, OutputLogFilter } from '@/services/logging.service'
import { useAISkill, type AISkill, type AISkillAction } from '@/components/ai'

const LEVELS = ['', 'DEBUG', 'INFO', 'WARN', 'ERROR']

function formatTime(value: string) {
    if (!value) return '-'
    return new Date(value).toLocaleString()
}

function levelClass(level: string) {
    switch (level) {
        case 'ERROR':
            return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
        case 'WARN':
            return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        case 'DEBUG':
            return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
        default:
            return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    }
}

function summarizeOutputLogForAI(log: OutputLogEntry) {
    return {
        id: log.id,
        time: log.time,
        level: log.level,
        module: log.module,
        message: log.message,
        file: log.file,
        line: log.line,
        source: log.source,
    }
}

function normalizeOutputLevel(value: unknown) {
    const level = String(value || '').trim().toUpperCase()
    return LEVELS.includes(level) ? level : ''
}

function normalizeDateTimeValue(value: unknown) {
    if (!value) return ''
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) return ''
    const pad = (item: number) => String(item).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function readOptionalBoolean(value: unknown) {
    if (value === true || value === false) return value
    const text = String(value || '').trim().toLowerCase()
    if (['true', '1', 'yes', 'on', '开启', '打开'].includes(text)) return true
    if (['false', '0', 'no', 'off', '关闭'].includes(text)) return false
    return undefined
}

export default function OutputLogsTab() {
    const [logs, setLogs] = useState<OutputLogEntry[]>([])
    const [modules, setModules] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [streaming, setStreaming] = useState(true)
    const [autoScroll, setAutoScroll] = useState(true)
    const [reverseOrder, setReverseOrder] = useState(false)
    const [query, setQuery] = useState('')
    const [level, setLevel] = useState('')
    const [module, setModule] = useState('')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const streamAbortRef = useRef<AbortController | null>(null)
    const logScrollRef = useRef<HTMLDivElement | null>(null)

    const filter = useMemo<OutputLogFilter>(() => ({
        q: query,
        level,
        module,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        limit: 500,
    }), [from, level, module, query, to])

    const loadLogs = useCallback(async () => {
        setLoading(true)
        try {
            const [logResponse, moduleResponse] = await Promise.all([
                loggingService.listOutputLogs(filter),
                loggingService.listOutputModules(),
            ])
            setLogs(logResponse.items || [])
            setModules(moduleResponse)
        } catch (error) {
            console.error(error)
            toast.error('加载实时日志失败')
        } finally {
            setLoading(false)
        }
    }, [filter])

    useEffect(() => {
        loadLogs()
    }, [loadLogs])

    useEffect(() => {
        registerRefreshCallback('output-logs', loadLogs)
        return () => unregisterRefreshCallback('output-logs')
    }, [loadLogs])

    useEffect(() => {
        streamAbortRef.current?.abort()
        if (!streaming) return

        const controller = new AbortController()
        streamAbortRef.current = controller
            const sinceId = logs.reduce((max, item) => Math.max(max, item.id), 0) || undefined

            loggingService.streamOutputLogs({ ...filter, since_id: sinceId, limit: 0 }, entry => {
                setLogs(prev => {
                    if (prev.some(item => item.id === entry.id)) return prev
                    const next = [...prev, entry].sort((a, b) => a.id - b.id)
                    return next.slice(Math.max(0, next.length - 1000))
                })
            }, controller.signal).catch(error => {
            if (controller.signal.aborted) return
            console.error(error)
            toast.error('实时日志流已断开')
            setStreaming(false)
        })

        return () => controller.abort()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [streaming, filter])

    const orderedLogs = useMemo(() => {
        const sorted = [...logs].sort((a, b) => a.id - b.id)
        return reverseOrder ? sorted.reverse() : sorted
    }, [logs, reverseOrder])

    useEffect(() => {
        if (!autoScroll) return
        const container = logScrollRef.current
        if (!container) return
        requestAnimationFrame(() => {
            container.scrollTop = reverseOrder ? 0 : container.scrollHeight
        })
    }, [autoScroll, orderedLogs.length, reverseOrder])

    const exportLogs = () => {
        const text = orderedLogs.map(log => `[${formatTime(log.time)}] [${log.level}] [${log.module}] ${log.message}`).join('\n')
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `mailman-output-logs-${Date.now()}.log`
        link.click()
        URL.revokeObjectURL(url)
    }

    const openSettings = useCallback(() => {
        window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: 'output-log-settings' } }))
    }, [])

    const outputLogsAISkill = useMemo<AISkill>(() => ({
        id: 'output-logs',
        title: '实时日志',
        description: '查看后端输出日志流，支持搜索、级别/模块/时间过滤和实时跟随。',
        aliases: ['实时日志', '输出日志', '后端日志', '日志流', 'output logs', 'runtime logs'],
        pageTabs: ['output-logs'],
        getContext: () => ({
            loading,
            isLoading: loading,
            streaming,
            autoScroll,
            reverseOrder,
            filters: {
                query,
                level,
                module,
                from,
                to,
                limit: filter.limit,
            },
            loadedCount: logs.length,
            modules,
            visibleLogs: orderedLogs.slice(0, 20).map(summarizeOutputLogForAI),
            latestLog: orderedLogs[reverseOrder ? 0 : orderedLogs.length - 1]
                ? summarizeOutputLogForAI(orderedLogs[reverseOrder ? 0 : orderedLogs.length - 1])
                : null,
        }),
        actions: [
            {
                name: 'searchOutputLogs',
                title: '搜索实时日志',
                description: '按关键词、级别、模块或时间范围筛选实时输出日志。',
                risk: 'read',
                parameters: { query: '日志关键词', level: 'DEBUG/INFO/WARN/ERROR，可选', module: '模块，可选', from: '开始时间，可选', to: '结束时间，可选' },
                run: async (params) => {
                    const nextQuery = String(params.query || params.q || '').trim()
                    const nextLevel = normalizeOutputLevel(params.level)
                    const nextModule = String(params.module || '').trim()
                    const nextFrom = normalizeDateTimeValue(params.from)
                    const nextTo = normalizeDateTimeValue(params.to)
                    const requestFilter: OutputLogFilter = {
                        q: nextQuery,
                        level: nextLevel,
                        module: nextModule,
                        from: nextFrom ? new Date(nextFrom).toISOString() : undefined,
                        to: nextTo ? new Date(nextTo).toISOString() : undefined,
                        limit: Number(params.limit || filter.limit || 500),
                    }

                    setQuery(nextQuery)
                    setLevel(nextLevel)
                    setModule(nextModule)
                    setFrom(nextFrom)
                    setTo(nextTo)
                    setLoading(true)

                    try {
                        const [logResponse, moduleResponse] = await Promise.all([
                            loggingService.listOutputLogs(requestFilter),
                            loggingService.listOutputModules(),
                        ])
                        const nextLogs = logResponse.items || []
                        setLogs(nextLogs)
                        setModules(moduleResponse)
                        return {
                            success: true,
                            summary: `已筛选实时日志，当前加载 ${nextLogs.length} 条。`,
                            data: {
                                filters: requestFilter,
                                loadedCount: nextLogs.length,
                                logs: nextLogs.slice(0, 20).map(summarizeOutputLogForAI),
                            },
                        }
                    } finally {
                        setLoading(false)
                    }
                },
            },
            {
                name: 'getVisibleOutputLogs',
                title: '读取当前实时日志',
                description: '读取当前页面中已加载的实时输出日志样本。',
                risk: 'read',
                run: () => ({
                    success: true,
                    summary: `当前已加载 ${orderedLogs.length} 条实时日志，实时流${streaming ? '开启' : '关闭'}。`,
                    data: {
                        loadedCount: orderedLogs.length,
                        streaming,
                        autoScroll,
                        reverseOrder,
                        logs: orderedLogs.slice(0, 30).map(summarizeOutputLogForAI),
                    },
                }),
            },
            {
                name: 'toggleOutputLogStreaming',
                title: '调整实时日志流',
                description: '打开或关闭实时流、跟随最新和倒序展示。',
                risk: 'read',
                parameters: { streaming: 'true/false', autoScroll: 'true/false', reverseOrder: 'true/false' },
                run: (params) => {
                    const nextStreaming = readOptionalBoolean(params.streaming)
                    const nextAutoScroll = readOptionalBoolean(params.autoScroll)
                    const nextReverseOrder = readOptionalBoolean(params.reverseOrder)
                    if (nextStreaming !== undefined) setStreaming(nextStreaming)
                    if (nextAutoScroll !== undefined) setAutoScroll(nextAutoScroll)
                    if (nextReverseOrder !== undefined) setReverseOrder(nextReverseOrder)
                    const effectiveStreaming = nextStreaming ?? streaming
                    const effectiveAutoScroll = nextAutoScroll ?? autoScroll
                    const effectiveReverseOrder = nextReverseOrder ?? reverseOrder
                    return {
                        success: true,
                        summary: `实时日志设置已更新：实时流 ${effectiveStreaming ? '开启' : '关闭'}，跟随最新 ${effectiveAutoScroll ? '开启' : '关闭'}，倒序 ${effectiveReverseOrder ? '开启' : '关闭'}。`,
                        data: {
                            streaming: effectiveStreaming,
                            autoScroll: effectiveAutoScroll,
                            reverseOrder: effectiveReverseOrder,
                        },
                    }
                },
            },
            {
                name: 'openOutputLogSettings',
                title: '打开实时日志设置',
                description: '切换到实时日志设置页面。',
                risk: 'navigation',
                run: () => {
                    openSettings()
                    return {
                        success: true,
                        summary: '已打开实时日志设置页面。',
                        data: { tabId: 'output-log-settings', navigationOnly: true },
                    }
                },
            },
        ] satisfies AISkillAction[],
    }), [
        autoScroll,
        filter.limit,
        from,
        level,
        loading,
        logs.length,
        module,
        modules,
        openSettings,
        orderedLogs,
        query,
        reverseOrder,
        streaming,
        to,
    ])

    useAISkill(outputLogsAISkill)

    return (
        <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
            <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
                            <Terminal className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                            实时日志
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">后端输出流 · 搜索 · 级别 · 模块 · 时间过滤</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={loadLogs} className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                            <RefreshCw className="h-4 w-4" />
                            刷新
                        </button>
                        <button onClick={exportLogs} className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                            <Download className="h-4 w-4" />
                            导出
                        </button>
                        <button onClick={openSettings} className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                            <Settings className="h-4 w-4" />
                            设置
                        </button>
                        <div className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-900">
                            {streaming ? <Play className="h-4 w-4 text-emerald-600" /> : <Pause className="h-4 w-4 text-gray-500" />}
                            <span className="text-sm text-gray-700 dark:text-gray-200">实时</span>
                            <Switch checked={streaming} onCheckedChange={setStreaming} className="scale-90" />
                        </div>
                        <div className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-900">
                            <span className="text-sm text-gray-700 dark:text-gray-200">跟随最新</span>
                            <Switch checked={autoScroll} onCheckedChange={setAutoScroll} className="scale-90" />
                        </div>
                        <div className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-900">
                            <span className="text-sm text-gray-700 dark:text-gray-200">倒序</span>
                            <Switch checked={reverseOrder} onCheckedChange={setReverseOrder} className="scale-90" />
                        </div>
                    </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[1.5fr_120px_160px_170px_170px]">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                        <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索消息、文件、模块" className="h-9 pl-9" />
                    </div>
                    <Select value={level || 'all'} onValueChange={value => setLevel(value === 'all' ? '' : value)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="级别" /></SelectTrigger>
                        <SelectContent>
                            {LEVELS.map(item => <SelectItem key={item || 'all'} value={item || 'all'}>{item || '全部级别'}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Select value={module || 'all'} onValueChange={value => setModule(value === 'all' ? '' : value)}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="模块" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部模块</SelectItem>
                            {modules.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Input type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} className="h-9" />
                    <Input type="datetime-local" value={to} onChange={event => setTo(event.target.value)} className="h-9" />
                </div>
            </div>

            <div ref={logScrollRef} className="min-h-0 flex-1 overflow-auto p-4">
                {loading ? (
                    <div className="flex h-full items-center justify-center text-gray-500">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        加载日志...
                    </div>
                ) : logs.length ? (
                    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                        <div className="grid grid-cols-[190px_86px_150px_minmax(320px,1fr)_120px] border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-800/70 dark:text-gray-300">
                            <span>时间</span>
                            <span>级别</span>
                            <span>模块</span>
                            <span>消息</span>
                            <span>位置</span>
                        </div>
                        <div className="divide-y divide-gray-100 font-mono text-xs dark:divide-gray-800">
                            {orderedLogs.map(log => (
                                <div key={log.id} className="grid grid-cols-[190px_86px_150px_minmax(320px,1fr)_120px] items-start gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                                    <span className="text-gray-500 dark:text-gray-400">{formatTime(log.time)}</span>
                                    <span><span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', levelClass(log.level))}>{log.level}</span></span>
                                    <span className="truncate text-gray-700 dark:text-gray-200">{log.module}</span>
                                    <span className="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">{log.message}</span>
                                    <span className="truncate text-gray-400">{log.file}{log.line ? `:${log.line}` : ''}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-500">
                        <AlertCircle className="h-4 w-4" />
                        暂无匹配日志
                    </div>
                )}
            </div>
        </div>
    )
}
