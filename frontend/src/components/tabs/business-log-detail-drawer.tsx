'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Code2, Copy, Database, FileText, GitBranch, ListChecks, Loader2, Mail, Server, Terminal, User, X, XCircle, Zap, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { BusinessLog } from '@/services/logging.service'
import { triggerService } from '@/services/trigger.service'
import { TriggerErrorDiagnosticsDialog } from '@/components/triggers/trigger-error-diagnostics-dialog'
import { TriggerLogDetailView } from '@/components/triggers/trigger-log-detail-view'
import { TriggerExecutionLog } from '@/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type DetailValue = string | number | boolean | null | undefined | Record<string, any> | any[]

interface DetailField {
    key: string
    label: string
    value: DetailValue
}

interface DetailSection {
    title: string
    fields: DetailField[]
}

const DETAIL_LABELS: Record<string, string> = {
    account_email: '邮箱账号',
    account_id: '账号 ID',
    merge_count: '合并条数',
    merge_started_at: '合并开始',
    merge_finished_at: '合并结束',
    merge_status: '连续结果',
    first_run_id: '首次运行 ID',
    latest_run_id: '最近运行 ID',
    first_trace_id: '首次 Trace',
    latest_trace_id: '最近 Trace',
    latest_request_id: '最近 Request',
    first_error_message: '首次错误',
    latest_error_message: '最近错误',
    emails_fetched: '拉取邮件数',
    new_emails: '新增邮件数',
    emails_created: '创建邮件数',
    emails_updated: '更新邮件数',
    emails_skipped: '跳过邮件数',
    sync_run_id: '同步运行 ID',
    source: '来源',
    provider: '服务商',
    mailbox: '邮箱目录',
    folder: '文件夹',
    trigger_id: '触发器 ID',
    trigger_name: '触发器名称',
    trigger_type: '触发器类型',
    trigger_execution_log_id: '执行日志 ID',
    event_type: '事件类型',
    matched: '是否命中',
    action_count: '动作数',
    actions_executed: '执行动作数',
    actions_succeeded: '成功动作数',
    success_count: '成功数',
    failed_count: '失败数',
    email_id: '邮件 ID',
    email_subject: '邮件主题',
    email_account_id: '邮箱账户 ID',
    condition_result: '条件结果',
    template_id: '模板 ID',
    template_name: '模板名称',
    extractor_id: '提取器 ID',
    extracted_count: '提取数量',
    matched_count: '匹配数量',
    scenario_key: '场景',
    business_module_id: '业务模块 ID',
    business_module_name: '业务模块',
    business_account_id: '业务账户 ID',
    site: '站点',
    username: '用户名',
    status: '状态',
    proxy_id: '代理 ID',
    proxy_name: '代理名称',
    endpoint: '端点',
    method: '方法',
    path: '路径',
    status_code: '状态码',
    latency_ms: '延迟',
    wiki_id: '知识库 ID',
    page_id: '页面 ID',
    table_id: '数据表 ID',
    row_id: '行 ID',
    formula_id: '公式 ID',
    provider_name: '服务商',
    config_key: '配置项',
    session_id: '会话 ID',
    ip: 'IP',
    request_id: '请求 ID',
}

const MODULE_SECTIONS: Record<string, Array<{ title: string; keys: string[] }>> = {
    sync: [
        { title: '合并区间', keys: ['merge_count', 'merge_started_at', 'merge_finished_at', 'merge_status'] },
        { title: '邮箱账户', keys: ['account_email', 'account_id', 'provider', 'mailbox', 'folder'] },
        { title: '同步结果', keys: ['emails_fetched', 'new_emails', 'emails_created', 'emails_updated', 'emails_skipped'] },
        { title: '运行信息', keys: ['source', 'sync_run_id', 'first_run_id', 'latest_run_id', 'first_trace_id', 'latest_trace_id', 'latest_request_id', 'request_id'] },
    ],
    pickup: [
        { title: '取件对象', keys: ['account_email', 'account_id', 'template_name', 'template_id', 'scenario_key'] },
        { title: '提取结果', keys: ['matched_count', 'extracted_count', 'extractor_id', 'source'] },
    ],
    trigger: [
        { title: '触发器', keys: ['trigger_name', 'trigger_id', 'trigger_type', 'event_type', 'trigger_execution_log_id'] },
        { title: '关联邮件与邮箱账户', keys: ['email_subject', 'email_id', 'account_email', 'email_account_id', 'account_id', 'mailbox'] },
        { title: '执行结果', keys: ['matched', 'condition_result', 'action_count', 'actions_executed', 'actions_succeeded', 'success_count', 'failed_count'] },
    ],
    business: [
        { title: '业务对象', keys: ['business_module_name', 'business_module_id', 'business_account_id', 'scenario_key', 'site', 'username', 'status'] },
    ],
    email_account: [
        { title: '邮箱账户', keys: ['account_email', 'account_id', 'provider', 'status', 'source'] },
    ],
    proxy: [
        { title: '代理请求', keys: ['proxy_name', 'proxy_id', 'endpoint', 'method', 'status_code', 'latency_ms'] },
    ],
    wiki: [
        { title: '知识库对象', keys: ['wiki_id', 'page_id', 'table_id', 'row_id', 'formula_id'] },
    ],
    oauth2: [
        { title: 'OAuth2', keys: ['provider', 'provider_name', 'account_email', 'session_id', 'status'] },
    ],
    system_config: [
        { title: '配置变更', keys: ['config_key', 'source', 'request_id'] },
    ],
    api: [
        { title: '接口调用', keys: ['method', 'path', 'status_code', 'latency_ms', 'ip', 'request_id'] },
    ],
}

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

function isPresent(value: DetailValue) {
    if (value === undefined || value === null) return false
    if (typeof value === 'string') return value.trim() !== ''
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'object') return Object.keys(value).length > 0
    return true
}

function labelFor(key: string) {
    if (DETAIL_LABELS[key]) return DETAIL_LABELS[key]
    return key.replace(/_/g, ' ')
}

function displayValueFor(key: string, value: DetailValue): DetailValue {
    if ((key === 'merge_started_at' || key === 'merge_finished_at') && typeof value === 'string') {
        return formatDate(value)
    }
    return value
}

function buildDetailSections(log: BusinessLog) {
    const details = log.details || {}
    const used = new Set<string>()
    const sections: DetailSection[] = []
    const defs = MODULE_SECTIONS[log.module] || []

    if (log.module === 'api') {
        used.add('http')
    }
    if (log.module === 'sync') {
        used.add('merge_entries')
        used.add('merge_entries_truncated')
    }

    defs.forEach(def => {
        const fields = def.keys
            .filter(key => isPresent(details[key]))
            .map(key => {
                used.add(key)
                return { key, label: labelFor(key), value: displayValueFor(key, details[key]) }
            })
        if (fields.length > 0) {
            sections.push({ title: def.title, fields })
        }
    })

    const commonKeys = ['source', 'request_id', 'sync_run_id', 'trigger_id', 'template_id']
    const commonFields = commonKeys
        .filter(key => !used.has(key) && isPresent(details[key]))
        .map(key => {
            used.add(key)
            return { key, label: labelFor(key), value: displayValueFor(key, details[key]) }
        })
    if (commonFields.length > 0) {
        sections.push({ title: '关联线索', fields: commonFields })
    }

    const remaining = Object.fromEntries(
        Object.entries(details).filter(([key, value]) => !used.has(key) && isPresent(value as DetailValue)),
    )

    return { sections, remaining }
}

function numberFromDetail(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
        const parsed = Number(value)
        if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
    return null
}

function getAssociatedTriggerLogId(log: BusinessLog) {
    const details = log.details || {}
    const direct = numberFromDetail(details.trigger_execution_log_id || details.trigger_log_id || details.execution_log_id)
    if (direct) return direct

    const runMatch = String(log.runId || '').match(/^trigger_log_(\d+)$/)
    if (runMatch) return Number(runMatch[1])

    return null
}

function triggerLogStatusTone(status?: string) {
    switch (status) {
        case 'success':
            return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
        case 'failed':
            return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
        case 'partial':
            return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        default:
            return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    }
}

function formatAddressList(value: unknown) {
    if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '-'
    if (typeof value === 'string') return value || '-'
    return '-'
}

function accountEmailFromTriggerLog(log?: TriggerExecutionLog | null) {
    const account = log?.email?.Account
    return account?.emailAddress || account?.EmailAddress || '-'
}

function normalizeHeaderValue(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(item => String(item))
    if (value === undefined || value === null) return []
    return [String(value)]
}

function normalizeHeaders(value: unknown): Record<string, string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .map(([key, headerValue]) => [key, normalizeHeaderValue(headerValue)])
            .filter(([, headerValue]) => headerValue.length > 0),
    )
}

function bodyText(value: unknown) {
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') {
        const trimmed = value.trim()
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                return JSON.stringify(JSON.parse(value), null, 2)
            } catch {
                return value
            }
        }
        return value
    }
    return JSON.stringify(value, null, 2)
}

function getHTTPExchange(log: BusinessLog) {
    const details = log.details || {}
    const http = (details.http && typeof details.http === 'object') ? details.http as Record<string, any> : {}
    const request = (http.request && typeof http.request === 'object') ? http.request as Record<string, any> : {}
    const response = (http.response && typeof http.response === 'object') ? http.response as Record<string, any> : {}
    const path = request.path || details.path || ''
    const query = request.query ?? details.query ?? ''
    const fallbackURL = path ? `${path}${query ? `?${query}` : ''}` : ''

    return {
        method: String(request.method || details.method || '').toUpperCase(),
        url: String(request.url || fallbackURL || ''),
        path: String(path || ''),
        query: String(query || ''),
        requestHeaders: normalizeHeaders(request.headers),
        requestBody: bodyText(request.body),
        requestBodyTruncated: Boolean(request.body_truncated),
        requestBodyOmittedReason: request.body_omitted_reason ? String(request.body_omitted_reason) : '',
        requestContentType: String(request.content_type || details.content_type || ''),
        statusCode: Number(response.status_code || details.status_code || 0),
        statusText: String(response.status_text || ''),
        responseHeaders: normalizeHeaders(response.headers),
        responseBody: bodyText(response.body),
        responseBodyTruncated: Boolean(response.body_truncated),
        responseBodyOmittedReason: response.body_omitted_reason ? String(response.body_omitted_reason) : '',
        responseContentType: String(response.content_type || ''),
    }
}

function shellQuote(value: string) {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

function buildCurlCommand(log: BusinessLog) {
    const exchange = getHTTPExchange(log)
    const method = exchange.method || 'GET'
    const url = exchange.url || exchange.path || '/'
    const lines = [`curl ${shellQuote(url)}`, `  -X ${method}`]
    Object.entries(exchange.requestHeaders)
        .filter(([key]) => !['content-length', 'host'].includes(key.toLowerCase()))
        .forEach(([key, values]) => {
            values.forEach(value => {
                lines.push(`  -H ${shellQuote(`${key}: ${value}`)}`)
            })
        })
    if (exchange.requestBody) {
        lines.push(`  --data-raw ${shellQuote(exchange.requestBody)}`)
    }
    return lines.join(' \\\n')
}

async function copyToClipboard(text: string, successMessage: string) {
    try {
        await navigator.clipboard.writeText(text)
        toast.success(successMessage)
    } catch {
        toast.error('复制失败')
    }
}

function syncMergeEntries(log: BusinessLog) {
    const details = log.details || {}
    const rawEntries = Array.isArray(details.merge_entries) ? details.merge_entries : []
    if (rawEntries.length > 0) {
        return rawEntries
            .filter(item => item && typeof item === 'object')
            .map((item, index) => normalizeSyncMergeEntry(item as Record<string, any>, index, log))
    }
    const mergeCount = numberFromDetail(details.merge_count)
    if (!mergeCount || mergeCount <= 1) return []
    return [normalizeSyncMergeEntry({
        title: log.title,
        summary: log.summary,
        status: log.status,
        result: log.result,
        started_at: details.merge_started_at || log.startedAt,
        finished_at: details.merge_finished_at || log.finishedAt,
        duration_ms: log.durationMs,
        run_id: log.runId,
        trace_id: log.traceId,
        request_id: log.requestId,
        error_message: log.errorMessage,
        emails_fetched: details.emails_fetched,
        new_emails: details.new_emails,
        emails_created: details.emails_created,
        emails_updated: details.emails_updated,
        emails_skipped: details.emails_skipped,
        source: details.source,
        account_email: details.account_email || log.entityName,
    }, 0, log)]
}

function normalizeSyncMergeEntry(entry: Record<string, any>, index: number, log: BusinessLog) {
    return {
        key: `${entry.id || log.id}-${entry.started_at || index}`,
        title: String(entry.title || log.title || `同步记录 ${index + 1}`),
        summary: String(entry.summary || ''),
        status: String(entry.status || log.status || ''),
        result: String(entry.result || ''),
        startedAt: String(entry.started_at || entry.startedAt || ''),
        finishedAt: String(entry.finished_at || entry.finishedAt || ''),
        durationMs: Number(entry.duration_ms || entry.durationMs || 0),
        runId: String(entry.run_id || entry.runId || ''),
        traceId: String(entry.trace_id || entry.traceId || ''),
        requestId: String(entry.request_id || entry.requestId || ''),
        errorMessage: String(entry.error_message || entry.errorMessage || ''),
        source: String(entry.source || ''),
        accountEmail: String(entry.account_email || entry.accountEmail || log.entityName || ''),
        emailsFetched: numberFromDetail(entry.emails_fetched),
        newEmails: numberFromDetail(entry.new_emails),
        emailsCreated: numberFromDetail(entry.emails_created),
        emailsUpdated: numberFromDetail(entry.emails_updated),
        emailsSkipped: numberFromDetail(entry.emails_skipped),
    }
}

function hasSyncMergeDetails(log: BusinessLog) {
    return log.module === 'sync' && syncMergeEntries(log).length > 0
}

export function BusinessLogDetailDrawer({ log, onClose }: { log: BusinessLog; onClose: () => void }) {
    const { sections, remaining } = useMemo(() => buildDetailSections(log), [log])
    const hasRemaining = Object.keys(remaining).length > 0
    const associatedTriggerLogId = useMemo(() => getAssociatedTriggerLogId(log), [log])
    const isAPILog = log.module === 'api'
    const hasSyncMerge = useMemo(() => hasSyncMergeDetails(log), [log])
    const [apiDetailOpen, setApiDetailOpen] = useState(isAPILog)
    const [syncMergeOpen, setSyncMergeOpen] = useState(hasSyncMerge)
    const [triggerLog, setTriggerLog] = useState<TriggerExecutionLog | null>(null)
    const [triggerLogLoading, setTriggerLogLoading] = useState(false)
    const [triggerLogError, setTriggerLogError] = useState<string | null>(null)
    const [triggerDetailOpen, setTriggerDetailOpen] = useState(false)
    const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
    const [diagnosticError, setDiagnosticError] = useState<string | undefined>()

    useEffect(() => {
        setTriggerLog(null)
        setTriggerLogError(null)
        setTriggerDetailOpen(false)
        setDiagnosticsOpen(false)
        setDiagnosticError(undefined)
        setApiDetailOpen(isAPILog)
        setSyncMergeOpen(hasSyncMerge)

        if (log.module !== 'trigger' || !associatedTriggerLogId) {
            setTriggerLogLoading(false)
            return
        }

        let cancelled = false
        setTriggerLogLoading(true)
        triggerService.getTriggerLog(associatedTriggerLogId)
            .then(nextLog => {
                if (!cancelled) {
                    setTriggerLog(nextLog)
                    setTriggerLogError(null)
                }
            })
            .catch(error => {
                if (!cancelled) {
                    console.error('加载关联触发器执行日志失败:', error)
                    setTriggerLogError(error?.message || '加载关联触发器执行日志失败')
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setTriggerLogLoading(false)
                }
            })

        return () => {
            cancelled = true
        }
    }, [associatedTriggerLogId, hasSyncMerge, isAPILog, log.id, log.module])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            if (diagnosticsOpen) return
            if (triggerDetailOpen) {
                setTriggerDetailOpen(false)
                return
            }
            if (apiDetailOpen) {
                setApiDetailOpen(false)
                return
            }
            if (syncMergeOpen) {
                setSyncMergeOpen(false)
                return
            }
            onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [apiDetailOpen, diagnosticsOpen, onClose, syncMergeOpen, triggerDetailOpen])

    return (
        <div className="fixed inset-0 z-50 flex justify-end overflow-hidden">
            <button aria-label="关闭业务日志详情" className="absolute inset-0 bg-gray-950/25 backdrop-blur-[1px]" onClick={onClose} />

            {apiDetailOpen && isAPILog && (
                <HTTPExchangeDrawer log={log} onClose={() => setApiDetailOpen(false)} />
            )}

            {syncMergeOpen && hasSyncMerge && (
                <SyncMergeDrawer log={log} onClose={() => setSyncMergeOpen(false)} />
            )}

            {triggerDetailOpen && triggerLog && (
                <aside className="relative z-10 flex h-full w-full max-w-[840px] flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950" role="dialog" aria-modal="false" aria-label="触发器执行日志详情">
                    <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">触发器执行日志 #{triggerLog.id}</h3>
                                    <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', triggerLogStatusTone(triggerLog.status))}>{triggerLog.status}</span>
                                </div>
                                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                    {triggerLog.trigger?.name || `触发器 ID ${triggerLog.trigger_id}`} · 邮件 ID {triggerLog.email_id}
                                </div>
                            </div>
                            <button onClick={() => setTriggerDetailOpen(false)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white" aria-label="关闭触发器日志详情">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </header>
                    <main className="min-h-0 flex-1 overflow-auto px-5 py-4">
                        <TriggerLogDetailView
                            log={triggerLog}
                            onDiagnostics={(nextLog, error) => {
                                setDiagnosticError(error || nextLog.error_message || nextLog.condition_error)
                                setDiagnosticsOpen(true)
                            }}
                        />
                    </main>
                </aside>
            )}

            <aside className="relative z-10 flex h-full w-full max-w-[760px] flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950" role="dialog" aria-modal="true" aria-label="业务日志详情">
                <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">{log.title}</h3>
                                <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', statusTone(log.status))}>{log.status}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                                <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatDate(log.startedAt)}</span>
                                <span>{formatDuration(log.durationMs)}</span>
                                <span>{log.module} / {log.action}</span>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            {isAPILog && !apiDetailOpen && (
                                <button onClick={() => setApiDetailOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white" aria-label="打开请求响应详情" title="请求响应">
                                    <Server className="h-4 w-4" />
                                    HTTP
                                </button>
                            )}
                            {hasSyncMerge && !syncMergeOpen && (
                                <button onClick={() => setSyncMergeOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white" aria-label="打开合并日志列表" title="合并日志列表">
                                    <ListChecks className="h-4 w-4" />
                                    合并
                                </button>
                            )}
                            <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white" aria-label="关闭">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </header>

                <main className="min-h-0 flex-1 overflow-auto px-5 py-4">
                    <section className="grid gap-3 md:grid-cols-2">
                        <SummaryItem icon={Zap} label="操作" value={`${log.operationType} · ${log.action}`} />
                        <SummaryItem icon={User} label="触发者" value={`${log.actorType}${log.actorName ? ` · ${log.actorName}` : ''}`} />
                        <SummaryItem icon={Mail} label="实体" value={[log.entityType, log.entityName || log.entityId].filter(Boolean).join(' · ') || '-'} />
                        <SummaryItem icon={Database} label="组织 / 用户" value={`${log.orgId}${log.user?.username ? ` · ${log.user.username}` : log.userId ? ` · ${log.userId}` : ''}`} />
                    </section>

                    <section className="mt-4 grid gap-3 md:grid-cols-2">
                        <TraceItem label="Trace" value={log.traceId || '-'} />
                        <TraceItem label="Run" value={log.runId || '-'} />
                        {log.requestId && <TraceItem label="Request" value={log.requestId} />}
                        {log.errorCode && <TraceItem label="错误码" value={log.errorCode} />}
                    </section>

                    {log.module === 'trigger' && associatedTriggerLogId && (
                        <section className="mt-4 rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                                    <GitBranch className="h-4 w-4" />
                                    关联触发器执行日志
                                </div>
                                <span className="font-mono text-xs text-gray-500 dark:text-gray-400">#{associatedTriggerLogId}</span>
                            </div>

                            {triggerLogLoading ? (
                                <div className="flex items-center gap-2 px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    加载关联执行日志...
                                </div>
                            ) : triggerLogError ? (
                                <div className="flex items-start gap-2 px-3 py-4 text-sm text-rose-600 dark:text-rose-300">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>{triggerLogError}</span>
                                </div>
                            ) : triggerLog ? (
                                <button
                                    type="button"
                                    onClick={() => setTriggerDetailOpen(true)}
                                    className="block w-full px-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', triggerLogStatusTone(triggerLog.status))}>{triggerLog.status}</span>
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">{triggerLog.trigger?.name || `触发器 ID ${triggerLog.trigger_id}`}</span>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{formatDuration(triggerLog.execution_ms)}</span>
                                    </div>
                                    <div className="mt-2 grid gap-2 text-xs text-gray-600 dark:text-gray-300 md:grid-cols-2">
                                        <span className="inline-flex min-w-0 items-center gap-1">
                                            <Mail className="h-3.5 w-3.5 shrink-0" />
                                            <span className="truncate">{triggerLog.email?.Subject || `邮件 ID ${triggerLog.email_id}`}</span>
                                        </span>
                                        <span className="truncate">邮箱账户: {accountEmailFromTriggerLog(triggerLog)}</span>
                                        <span className="truncate">发件人: {formatAddressList(triggerLog.email?.From)}</span>
                                        <span className="truncate">收件人: {formatAddressList(triggerLog.email?.To)}</span>
                                    </div>
                                    <div className="mt-2 text-xs font-medium text-primary-600 dark:text-primary-400">打开触发器日志详情</div>
                                </button>
                            ) : (
                                <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">未找到关联执行日志</div>
                            )}
                        </section>
                    )}

                    {log.errorMessage && (
                        <section className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                            <div className="mb-2 flex items-center gap-2 font-medium">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                错误信息
                            </div>
                            <div className="max-h-44 overflow-auto whitespace-pre-wrap break-all leading-6">{log.errorMessage}</div>
                        </section>
                    )}

                    <div className="mt-5 space-y-4">
                        {sections.map(section => (
                            <DetailSectionView key={section.title} section={section} />
                        ))}
                    </div>

                    {hasRemaining && (
                        <details className="mt-5 rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" open={sections.length === 0}>
                            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white">原始详情</summary>
                            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all border-t border-gray-200 bg-gray-950 p-3 text-xs leading-5 text-gray-100 dark:border-gray-800">{JSON.stringify(remaining, null, 2)}</pre>
                        </details>
                    )}

                    {!sections.length && !hasRemaining && (
                        <div className="mt-5 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                            这条日志没有额外详情
                        </div>
                    )}
                </main>
            </aside>

            <TriggerErrorDiagnosticsDialog
                open={diagnosticsOpen}
                onOpenChange={(open) => {
                    setDiagnosticsOpen(open)
                    if (!open) setDiagnosticError(undefined)
                }}
                triggerId={triggerLog?.trigger_id}
                logId={triggerLog?.id}
                error={diagnosticError}
            />
        </div>
    )
}

function HTTPExchangeDrawer({ log, onClose }: { log: BusinessLog; onClose: () => void }) {
    const exchange = useMemo(() => getHTTPExchange(log), [log])
    const curl = useMemo(() => buildCurlCommand(log), [log])
    const statusLabel = exchange.statusCode ? `${exchange.statusCode} ${exchange.statusText || ''}`.trim() : '-'

    return (
        <aside className="relative z-10 flex h-full w-full max-w-[900px] flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950" role="dialog" aria-modal="false" aria-label="API 请求响应详情">
            <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">API 请求 / 响应</h3>
                            {exchange.method && <span className="rounded bg-sky-50 px-2 py-0.5 font-mono text-xs font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">{exchange.method}</span>}
                            <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', statusCodeTone(exchange.statusCode))}>{statusLabel}</span>
                        </div>
                        <div className="mt-2 truncate font-mono text-xs text-gray-500 dark:text-gray-400">{exchange.url || exchange.path || '-'}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => copyToClipboard(curl, 'cURL 已复制')} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white" title="复制 cURL">
                            <Copy className="h-4 w-4" />
                            cURL
                        </button>
                        <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white" aria-label="关闭 API 请求响应详情">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </header>
            <main className="min-h-0 flex-1 px-5 py-4">
                <Tabs defaultValue="overview" className="flex h-full min-h-0 flex-col">
                    <TabsList className="h-9 w-fit">
                        <TabsTrigger value="overview" className="gap-1.5"><FileText className="h-3.5 w-3.5" />概览</TabsTrigger>
                        <TabsTrigger value="request" className="gap-1.5"><Terminal className="h-3.5 w-3.5" />请求</TabsTrigger>
                        <TabsTrigger value="response" className="gap-1.5"><Server className="h-3.5 w-3.5" />响应</TabsTrigger>
                        <TabsTrigger value="curl" className="gap-1.5"><Code2 className="h-3.5 w-3.5" />cURL</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="mt-4 min-h-0 flex-1 overflow-auto">
                        <div className="grid gap-3 md:grid-cols-2">
                            <SummaryItem icon={Terminal} label="请求" value={`${exchange.method || '-'} ${exchange.path || exchange.url || '-'}`} />
                            <SummaryItem icon={Server} label="响应" value={statusLabel} />
                            <SummaryItem icon={Clock} label="耗时" value={formatDuration(log.durationMs)} />
                            <SummaryItem icon={Database} label="来源" value={[log.sourceIp, log.userAgent].filter(Boolean).join(' · ') || '-'} />
                        </div>
                        <section className="mt-4 rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                            <div className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">请求地址</div>
                            <div className="break-all px-3 py-3 font-mono text-xs leading-5 text-gray-800 dark:text-gray-100">{exchange.url || '-'}</div>
                        </section>
                    </TabsContent>

                    <TabsContent value="request" className="mt-4 min-h-0 flex-1 overflow-auto">
                        <div className="space-y-4">
                            <HeaderTable title="请求头" headers={exchange.requestHeaders} />
                            <BodyBlock
                                title="请求体"
                                body={exchange.requestBody}
                                truncated={exchange.requestBodyTruncated}
                                omittedReason={exchange.requestBodyOmittedReason}
                                onCopy={() => copyToClipboard(exchange.requestBody, '请求体已复制')}
                            />
                        </div>
                    </TabsContent>

                    <TabsContent value="response" className="mt-4 min-h-0 flex-1 overflow-auto">
                        <div className="space-y-4">
                            <HeaderTable title="响应头" headers={exchange.responseHeaders} />
                            <BodyBlock
                                title="响应体"
                                body={exchange.responseBody}
                                truncated={exchange.responseBodyTruncated}
                                omittedReason={exchange.responseBodyOmittedReason}
                                onCopy={() => copyToClipboard(exchange.responseBody, '响应体已复制')}
                            />
                        </div>
                    </TabsContent>

                    <TabsContent value="curl" className="mt-4 min-h-0 flex-1 overflow-auto">
                        <BodyBlock title="cURL" body={curl} onCopy={() => copyToClipboard(curl, 'cURL 已复制')} codeClassName="max-h-[calc(100vh-220px)]" />
                    </TabsContent>
                </Tabs>
            </main>
        </aside>
    )
}

function SyncMergeDrawer({ log, onClose }: { log: BusinessLog; onClose: () => void }) {
    const entries = useMemo(() => syncMergeEntries(log), [log])
    const truncated = Boolean(log.details?.merge_entries_truncated)

    return (
        <aside className="relative z-10 flex h-full w-full max-w-[860px] flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950" role="dialog" aria-modal="false" aria-label="同步合并日志列表">
            <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">合并日志列表</h3>
                            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300">{entries.length} 条</span>
                        </div>
                        <div className="mt-2 truncate text-xs text-gray-500 dark:text-gray-400">{log.entityName || log.details?.account_email || log.entityId || '邮件同步'}</div>
                    </div>
                    <button onClick={onClose} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white" aria-label="关闭合并日志列表">
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </header>
            <main className="min-h-0 flex-1 overflow-auto px-5 py-4">
                {truncated && (
                    <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                        合并明细超过保存上限，仅显示最近的明细记录
                    </div>
                )}
                <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <div className="grid grid-cols-[180px_96px_150px_minmax(220px,1fr)] gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-800/70 dark:text-gray-300">
                        <span>原始时间</span>
                        <span>同步结果</span>
                        <span>邮件</span>
                        <span>线索</span>
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {entries.map(entry => (
                            <div key={entry.key} className="grid grid-cols-[180px_96px_150px_minmax(220px,1fr)] gap-3 px-3 py-3 text-sm">
                                <div className="min-w-0">
                                    <div className="text-xs font-medium text-gray-900 dark:text-gray-100">{formatDate(entry.startedAt)}</div>
                                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{entry.finishedAt ? `结束 ${formatDate(entry.finishedAt)}` : formatDuration(entry.durationMs)}</div>
                                </div>
                                <div>
                                    <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', statusTone(entry.status))}>{entry.status || '-'}</span>
                                    {entry.source && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{entry.source}</div>}
                                </div>
                                <div className="min-w-0 text-xs text-gray-700 dark:text-gray-200">
                                    <div>拉取 {entry.emailsFetched ?? '-'}</div>
                                    <div className="mt-1">新增 {entry.newEmails ?? '-'}</div>
                                    {(entry.emailsCreated !== null || entry.emailsUpdated !== null || entry.emailsSkipped !== null) && (
                                        <div className="mt-1 text-gray-500 dark:text-gray-400">入库 {entry.emailsCreated ?? '-'} / 更新 {entry.emailsUpdated ?? '-'} / 跳过 {entry.emailsSkipped ?? '-'}</div>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{entry.accountEmail || entry.title}</div>
                                    <div className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{entry.errorMessage || entry.summary || entry.result || '-'}</div>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {entry.runId && <TraceChip label="Run" value={entry.runId} />}
                                        {entry.traceId && <TraceChip label="Trace" value={entry.traceId} />}
                                        {entry.requestId && <TraceChip label="Req" value={entry.requestId} />}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </main>
        </aside>
    )
}

function HeaderTable({ title, headers }: { title: string; headers: Record<string, string[]> }) {
    const rows = Object.entries(headers).flatMap(([key, values]) => values.map(value => ({ key, value })))
    return (
        <section className="rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">{title}</div>
            {rows.length ? (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {rows.map((row, index) => (
                        <div key={`${row.key}-${index}`} className="grid grid-cols-[180px_minmax(0,1fr)] gap-3 px-3 py-2 text-xs">
                            <div className="break-all font-mono font-semibold text-gray-600 dark:text-gray-300">{row.key}</div>
                            <div className="break-all font-mono text-gray-900 dark:text-gray-100">{row.value}</div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">没有捕获到 header</div>
            )}
        </section>
    )
}

function BodyBlock({ title, body, truncated, omittedReason, onCopy, codeClassName }: { title: string; body: string; truncated?: boolean; omittedReason?: string; onCopy?: () => void; codeClassName?: string }) {
    return (
        <section className="rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{title}</div>
                {body && onCopy && (
                    <button onClick={onCopy} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white">
                        <Copy className="h-3.5 w-3.5" />
                        复制
                    </button>
                )}
            </div>
            {omittedReason ? (
                <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">未记录 body：{omittedReason}</div>
            ) : body ? (
                <pre className={cn('max-h-96 overflow-auto whitespace-pre-wrap break-all bg-gray-950 p-3 text-xs leading-5 text-gray-100', codeClassName)}>{body}{truncated ? '\n\n[TRUNCATED]' : ''}</pre>
            ) : (
                <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">没有 body</div>
            )}
        </section>
    )
}

function TraceChip({ label, value }: { label: string; value: string }) {
    return (
        <span className="max-w-full truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300" title={value}>
            {label}: {value}
        </span>
    )
}

function statusCodeTone(statusCode: number) {
    if (statusCode >= 200 && statusCode < 300) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    if (statusCode >= 500) return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
    if (statusCode >= 400) return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    if (statusCode >= 300) return 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
    return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

function SummaryItem({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                <Icon className="h-3.5 w-3.5" />
                {label}
            </div>
            <div className="break-words text-sm font-medium text-gray-900 dark:text-gray-100">{value}</div>
        </div>
    )
}

function TraceItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-900">
            <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
            <div className="mt-1 break-all font-mono text-xs text-gray-900 dark:text-gray-100">{value}</div>
        </div>
    )
}

function DetailSectionView({ section }: { section: DetailSection }) {
    return (
        <section className="rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">{section.title}</div>
            <div className="grid gap-0 md:grid-cols-2">
                {section.fields.map(field => (
                    <div key={field.key} className="min-w-0 border-b border-gray-100 px-3 py-3 last:border-b-0 dark:border-gray-800">
                        <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">{field.label}</div>
                        <ValueView value={field.value} />
                    </div>
                ))}
            </div>
        </section>
    )
}

function ValueView({ value }: { value: DetailValue }) {
    if (typeof value === 'boolean') {
        return (
            <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold', value ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300')}>
                {value ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {value ? '是' : '否'}
            </span>
        )
    }
    if (typeof value === 'number') {
        return <span className="tabular-nums text-sm font-medium text-gray-900 dark:text-gray-100">{value}</span>
    }
    if (typeof value === 'string') {
        return <span className="block break-all text-sm font-medium leading-6 text-gray-900 dark:text-gray-100">{value}</span>
    }
    if (Array.isArray(value) || (value && typeof value === 'object')) {
        return <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-950 p-2 text-xs leading-5 text-gray-100">{JSON.stringify(value, null, 2)}</pre>
    }
    return <span className="text-sm text-gray-400">-</span>
}
