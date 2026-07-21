'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
    Activity,
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    Check,
    CheckCircle2,
    ChevronDown,
    ClipboardPaste,
    Clock3,
    Eye,
    FileWarning,
    Filter,
    FolderOpen,
    Globe2,
    Info,
    Layers3,
    ListFilter,
    Loader2,
    MoreHorizontal,
    Network,
    PanelRightOpen,
    Pencil,
    Plus,
    RefreshCw,
    Save,
    Search,
    Server,
    Settings2,
    ShieldCheck,
    SlidersHorizontal,
    Tag,
    Trash2,
    Upload,
    X,
    XCircle,
    Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
    Modal,
    ModalBody,
    ModalContent,
    ModalDescription,
    ModalFooter,
    ModalHeader,
    ModalTitle,
} from '@/components/ui/modal'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
    BulkDeleteProxyPayload,
    proxyPoolService,
    ProxyCheckChannel,
    ProxyCheckResult,
    ProxyPayload,
    proxyToUrl,
} from '@/services/proxy-pool.service'
import { ProxyGroup, ProxyPoolItem, ProxyStatus, ProxyTag, ProxyTagFilterMode, ProxyType } from '@/types'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'

const statusConfig: Record<ProxyStatus, { label: string; className: string; icon: any }> = {
    available: { label: '可用', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900', icon: CheckCircle2 },
    unavailable: { label: '不可用', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900', icon: XCircle },
    checking: { label: '检测中', className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900', icon: Loader2 },
    unknown: { label: '未知', className: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700', icon: AlertTriangle },
}

const proxyTypes: ProxyType[] = ['http', 'https', 'ssh', 'socks5']
const proxyMetaColors = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#06b6d4', '#64748b']

type ProxyMetaDraft = {
    name: string
    color?: string
    description?: string
    sortOrder?: number
}

type ProxyDuplicatePolicy = 'allow' | 'skip' | 'update'
type ImportWizardStep = 1 | 2 | 3
type ProxyImportPreviewStatus = 'ready' | 'duplicate' | 'error'

type ProxyImportPreviewRow = {
    line: number
    source: string
    type?: ProxyType
    host?: string
    port?: number
    username?: string
    hasPassword?: boolean
    refreshUrl?: string
    remark?: string
    duplicateKey?: string
    status: ProxyImportPreviewStatus
    error?: string
}

const emptyProxyDraft = (): ProxyPayload => ({
    type: 'socks5',
    host: '',
    port: 1080,
    username: '',
    password: '',
    refreshUrl: '',
    remark: '',
    tagIds: [],
    usageScope: 'shared',
})

function sortProxyMeta<T extends { name: string; sortOrder?: number }>(left: T, right: T) {
    const sortDiff = (left.sortOrder || 0) - (right.sortOrder || 0)
    if (sortDiff !== 0) return sortDiff
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
}

function metaColor(color: string | undefined, fallback: string) {
    return color || fallback
}

function colorWithAlpha(color: string | undefined, alpha: string) {
    const normalized = color?.trim()
    if (!normalized) return undefined
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return `${normalized}${alpha}`
    if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
        const [, r, g, b] = normalized
        return `#${r}${r}${g}${g}${b}${b}${alpha}`
    }
    return undefined
}

function metaChipStyle(color: string | undefined, fallback: string) {
    const finalColor = metaColor(color, fallback)
    return {
        backgroundColor: colorWithAlpha(finalColor, '14'),
        borderColor: colorWithAlpha(finalColor, '55'),
        color: finalColor,
    }
}

function MetaDot({ color, fallback, className }: {
    color?: string
    fallback: string
    className?: string
}) {
    return <span className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: metaColor(color, fallback) }} />
}

function formatProxyHost(host: string) {
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

function compactDateTime(value?: string) {
    if (!value) return '未检测'
    return new Date(value).toLocaleString()
}

function formatTrafficBytes(value?: number) {
    const bytes = Math.max(0, Number(value || 0))
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB', 'PB']
    let amount = bytes / 1024
    let unitIndex = 0
    while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024
        unitIndex++
    }
    const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2
    return `${amount.toFixed(digits)} ${units[unitIndex]}`
}

function safeDecode(value: string) {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

function extractTrailingBlockPreview(input: string, open: string, close: string) {
    const trimmed = input.trim()
    if (!trimmed.endsWith(close)) return { rest: input, value: '' }
    const start = trimmed.lastIndexOf(open)
    if (start < 0) return { rest: input, value: '' }
    return {
        rest: trimmed.slice(0, start).trim(),
        value: trimmed.slice(start + open.length, trimmed.length - close.length).trim(),
    }
}

function splitColonOutsideBracketsPreview(input: string) {
    const parts: string[] = []
    let current = ''
    let bracketDepth = 0
    for (const char of input) {
        if (char === '[') {
            bracketDepth += 1
            current += char
        } else if (char === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1)
            current += char
        } else if (char === ':' && bracketDepth === 0) {
            parts.push(current.trim())
            current = ''
        } else {
            current += char
        }
    }
    parts.push(current.trim())
    return parts
}

function trimIPv6BracketsPreview(host: string) {
    return host.trim().replace(/^\[/, '').replace(/\]$/, '')
}

function endsWithPortPreview(value: string) {
    const match = value.match(/:(\d+)$/)
    return !!match
}

function extractRefreshUrlPreview(input: string) {
    const trimmed = input.trim()
    if (!trimmed.endsWith(']')) return { rest: input, value: '' }
    const start = trimmed.lastIndexOf('[')
    if (start <= 0) return { rest: input, value: '' }
    const prefix = trimmed.slice(0, start).trim()
    if (!endsWithPortPreview(prefix)) return { rest: input, value: '' }
    return {
        rest: prefix,
        value: trimmed.slice(start + 1, trimmed.length - 1).trim(),
    }
}

function validatePreviewProxy(row: ProxyImportPreviewRow) {
    if (!row.host) return '代理主机不能为空'
    if (!row.port || row.port < 1 || row.port > 65535) return '代理端口必须在 1-65535 之间'
    return ''
}

function parseProxyPreviewLine(source: string, line: number, defaultType: ProxyType): ProxyImportPreviewRow {
    const withRemark = extractTrailingBlockPreview(source, '{', '}')
    const withRefresh = extractRefreshUrlPreview(withRemark.rest)
    const core = withRefresh.rest.trim()
    const base: ProxyImportPreviewRow = {
        line,
        source,
        type: defaultType,
        refreshUrl: withRefresh.value,
        remark: withRemark.value,
        status: 'ready',
    }

    if (!core) {
        return { ...base, status: 'error', error: '代理内容为空' }
    }

    if (core.includes('://')) {
        try {
            const parsed = new URL(core)
            const typeValue = proxyTypes.includes(parsed.protocol.replace(':', '') as ProxyType)
                ? parsed.protocol.replace(':', '') as ProxyType
                : defaultType
            const port = Number(parsed.port)
            const row: ProxyImportPreviewRow = {
                ...base,
                type: typeValue,
                host: trimIPv6BracketsPreview(parsed.hostname),
                port,
                username: parsed.username ? safeDecode(parsed.username) : '',
                hasPassword: !!parsed.password,
            }
            const error = validatePreviewProxy(row)
            return error ? { ...row, status: 'error', error } : row
        } catch {
            return { ...base, status: 'error', error: '代理 URL 格式错误' }
        }
    }

    const parts = splitColonOutsideBracketsPreview(core)
    if (parts.length !== 2 && parts.length !== 4) {
        return { ...base, status: 'error', error: '代理格式不支持' }
    }
    const port = Number(parts[1])
    const row: ProxyImportPreviewRow = {
        ...base,
        host: trimIPv6BracketsPreview(parts[0]),
        port,
        username: parts[2] || '',
        hasPassword: !!parts[3],
    }
    if (!Number.isFinite(port)) {
        return { ...row, status: 'error', error: '代理端口必须是数字' }
    }
    const error = validatePreviewProxy(row)
    return error ? { ...row, status: 'error', error } : row
}

function parseProxyPreviewRows(content: string, defaultType: ProxyType) {
    const seen = new Set<string>()
    return content.split('\n').map((raw, index) => {
        const source = raw.trim()
        if (!source) return null
        const row = parseProxyPreviewLine(source, index + 1, defaultType)
        if (row.status === 'error') return row
        const duplicateKey = `${row.type}|${(row.host || '').toLowerCase()}|${row.port}|${row.username || ''}`
        const duplicate = seen.has(duplicateKey)
        seen.add(duplicateKey)
        return {
            ...row,
            duplicateKey,
            status: duplicate ? 'duplicate' as const : 'ready' as const,
        }
    }).filter(Boolean) as ProxyImportPreviewRow[]
}

export default function ProxyPoolTab() {
    const { confirm } = useConfirmDialog()
    const [proxies, setProxies] = useState<ProxyPoolItem[]>([])
    const [groups, setGroups] = useState<ProxyGroup[]>([])
    const [tags, setTags] = useState<ProxyTag[]>([])
    const [channels, setChannels] = useState<ProxyCheckChannel[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedIds, setSelectedIds] = useState<number[]>([])
    const [showImportWizard, setShowImportWizard] = useState(false)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<ProxyStatus | ''>('')
    const [type, setType] = useState<ProxyType | ''>('')
    const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([])
    const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
    const [tagMode, setTagMode] = useState<ProxyTagFilterMode>('or')
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [trafficSummary, setTrafficSummary] = useState({ trafficBytesIn: 0, trafficBytesOut: 0 })
    const [bulkText, setBulkText] = useState('')
    const [bulkDefaultType, setBulkDefaultType] = useState<ProxyType>('socks5')
    const [bulkGroupId, setBulkGroupId] = useState<number | undefined>()
    const [bulkTagIds, setBulkTagIds] = useState<number[]>([])
    const [bulkCheck, setBulkCheck] = useState(false)
    const [bulkDuplicatePolicy, setBulkDuplicatePolicy] = useState<ProxyDuplicatePolicy>('skip')
    const [checkChannel, setCheckChannel] = useState('ip-api')
    const [checkResults, setCheckResults] = useState<ProxyCheckResult[]>([])
    const [showMetaManager, setShowMetaManager] = useState(false)
    const [deleteReplacement, setDeleteReplacement] = useState<BulkDeleteProxyPayload['replacement']>({ mode: 'clear' })
    const [editingProxy, setEditingProxy] = useState<ProxyPoolItem | null>(null)
    const [detailProxy, setDetailProxy] = useState<ProxyPoolItem | null>(null)
    const [editDraft, setEditDraft] = useState<ProxyPayload>(emptyProxyDraft())
    const [savingProxy, setSavingProxy] = useState(false)

    const limit = 30

    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            const [proxyData, channelData] = await Promise.all([
                proxyPoolService.list({
                    page,
                    limit,
                    search,
                    status,
                    type,
                    groupIds: selectedGroupIds,
                    tagIds: selectedTagIds,
                    tagMode,
                }),
                proxyPoolService.getCheckChannels(),
            ])
            setProxies(proxyData.items)
            setTotal(proxyData.total)
            setTrafficSummary({
                trafficBytesIn: Number(proxyData.trafficSummary?.trafficBytesIn || 0),
                trafficBytesOut: Number(proxyData.trafficSummary?.trafficBytesOut || 0),
            })
            setChannels(channelData)
        } catch (error: any) {
            toast.error(error.message || '加载代理池失败')
        } finally {
            setLoading(false)
        }
    }, [page, search, status, type, selectedGroupIds, selectedTagIds, tagMode])

    const loadMeta = useCallback(async () => {
        try {
            const [groupData, tagData] = await Promise.all([
                proxyPoolService.listGroups(),
                proxyPoolService.listTags(),
            ])
            setGroups(groupData)
            setTags(tagData)
        } catch (error: any) {
            toast.error(error.message || '加载分组标签失败')
        }
    }, [])

    useEffect(() => {
        loadData()
        loadMeta()
    }, [loadData, loadMeta])

    useEffect(() => {
        const refreshProxyPool = () => {
            loadData()
            loadMeta()
        }
        registerRefreshCallback('proxy-pool', refreshProxyPool)
        return () => unregisterRefreshCallback('proxy-pool')
    }, [loadData, loadMeta])

    const totalPages = Math.max(1, Math.ceil(total / limit))
    const proxyStats = useMemo(() => {
        const available = proxies.filter(proxy => proxy.status === 'available').length
        const unavailable = proxies.filter(proxy => proxy.status === 'unavailable').length
        const checking = proxies.filter(proxy => proxy.status === 'checking').length
        const unknown = proxies.filter(proxy => !proxy.status || proxy.status === 'unknown').length
        const averageLatency = Math.round(
            proxies
                .filter(proxy => typeof proxy.checkLatencyMs === 'number' && proxy.checkLatencyMs > 0)
                .reduce((sum, proxy) => sum + Number(proxy.checkLatencyMs || 0), 0)
            / Math.max(1, proxies.filter(proxy => typeof proxy.checkLatencyMs === 'number' && proxy.checkLatencyMs > 0).length)
        )
        return { available, unavailable, checking, unknown, averageLatency }
    }, [proxies])
    const activeFilterCount = Number(!!search.trim()) + Number(!!status) + Number(!!type) + selectedGroupIds.length + selectedTagIds.length

    const runSearch = () => {
        setPage(1)
        setTimeout(loadData, 0)
    }

    const clearFilters = () => {
        setSearch('')
        setStatus('')
        setType('')
        setSelectedGroupIds([])
        setSelectedTagIds([])
        setTagMode('or')
        setPage(1)
    }

    const toggleSelected = (id: number) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
    }

    const toggleAllVisible = () => {
        const visibleIds = proxies.map(proxy => proxy.id)
        const allSelected = visibleIds.every(id => selectedIds.includes(id))
        setSelectedIds(allSelected ? selectedIds.filter(id => !visibleIds.includes(id)) : Array.from(new Set([...selectedIds, ...visibleIds])))
    }

    const importProxies = async () => {
        if (!bulkText.trim()) {
            toast.error('请先填写代理信息')
            return
        }
        setLoading(true)
        try {
            const result = await proxyPoolService.bulkImport({
                defaultType: bulkDefaultType,
                groupId: bulkGroupId,
                tagIds: bulkTagIds,
                checkProxy: bulkCheck,
                channel: checkChannel,
                duplicatePolicy: bulkDuplicatePolicy,
                content: bulkText,
            })
            setCheckResults(result.checks || [])
            const updated = Number(result.summary?.updated || 0)
            const skipped = Number(result.summary?.skipped || 0)
            toast.success(`已处理 ${result.created.length} 个代理${updated ? `，覆盖 ${updated} 个` : ''}${skipped ? `，跳过 ${skipped} 个重复项` : ''}${result.errors.length ? `，${result.errors.length} 行失败` : ''}`)
            setBulkText('')
            setShowImportWizard(false)
            loadData()
        } catch (error: any) {
            toast.error(error.message || '批量添加失败')
        } finally {
            setLoading(false)
        }
    }

    const openProxyEditor = (proxy: ProxyPoolItem) => {
        setEditingProxy(proxy)
        setEditDraft({
            type: proxy.type,
            host: proxy.host,
            port: proxy.port,
            username: proxy.username || '',
            password: proxy.password || '',
            refreshUrl: proxy.refreshUrl || '',
            remark: proxy.remark || '',
            groupId: proxy.groupId,
            tagIds: (proxy.tags || []).map(tag => tag.id),
            usageScope: proxy.usageScope || 'shared',
        })
    }

    const saveProxyEdit = async () => {
        if (!editingProxy) return
        if (!editDraft.host.trim()) {
            toast.error('代理主机不能为空')
            return
        }
        if (!editDraft.port || editDraft.port < 1 || editDraft.port > 65535) {
            toast.error('代理端口必须在 1-65535 之间')
            return
        }
        setSavingProxy(true)
        try {
            await proxyPoolService.update(editingProxy.id, {
                ...editDraft,
                host: editDraft.host.trim(),
                username: editDraft.username?.trim(),
                refreshUrl: editDraft.refreshUrl?.trim(),
                remark: editDraft.remark?.trim(),
            })
            toast.success('代理已更新')
            setEditingProxy(null)
            await loadData()
        } catch (error: any) {
            toast.error(error.message || '更新代理失败')
        } finally {
            setSavingProxy(false)
        }
    }

    const testProxy = async (proxy: ProxyPoolItem) => {
        setProxies(prev => prev.map(item => item.id === proxy.id ? { ...item, status: 'checking' } : item))
        try {
            const result = await proxyPoolService.test(proxy.id, checkChannel)
            setCheckResults(prev => [result, ...prev].slice(0, 30))
            toast[result.success ? 'success' : 'error'](`${proxy.host}:${proxy.port} ${result.success ? '可用' : '不可用'}`)
        } catch (error: any) {
            toast.error(error.message || '代理检测失败')
        } finally {
            loadData()
        }
    }

    const batchTest = async () => {
        setLoading(true)
        try {
            const result = await proxyPoolService.batchTest({
                ids: selectedIds.length ? selectedIds : undefined,
                filter: selectedIds.length ? undefined : {
                    search,
                    status,
                    type,
                    groupIds: selectedGroupIds,
                    tagIds: selectedTagIds,
                    tagMode,
                },
                channel: checkChannel,
                timeoutSeconds: 12,
            })
            setCheckResults(result.results)
            toast.success(`已检测 ${result.total} 个代理`)
            loadData()
        } catch (error: any) {
            toast.error(error.message || '批量检测失败')
        } finally {
            setLoading(false)
        }
    }

    const batchDelete = async () => {
        if (deleteReplacement.mode === 'proxy') {
            if (!deleteReplacement.proxyId) {
                toast.error('请选择替换代理')
                return
            }
            if (selectedIds.includes(deleteReplacement.proxyId)) {
                toast.error('替换代理不能包含在待删除代理中')
                return
            }
        }
        if (deleteReplacement.mode === 'manual' && !deleteReplacement.fallbackProxy?.trim()) {
            toast.error('请填写手动替换代理 URL')
            return
        }
        const confirmed = await confirm({
            title: '确认批量删除代理',
            description: selectedIds.length
                ? `将删除已选 ${selectedIds.length} 个代理，并按当前替换方案处理已绑定账户。`
                : '将按当前筛选条件删除所有匹配代理，并按当前替换方案处理已绑定账户。',
            confirmText: '确认删除',
            cancelText: '取消',
            variant: 'destructive',
        })
        if (!confirmed) return

        setLoading(true)
        try {
            const payload: BulkDeleteProxyPayload = {
                ids: selectedIds.length ? selectedIds : undefined,
                filter: selectedIds.length ? undefined : {
                    search,
                    status,
                    type,
                    groupIds: selectedGroupIds,
                    tagIds: selectedTagIds,
                    tagMode,
                    limit: 5000,
                },
                replacement: deleteReplacement,
            }
            const result = await proxyPoolService.batchDelete(payload)
            toast.success(`已删除 ${result.deleted} 个代理，影响 ${result.affectedAccounts} 个账户`)
            setSelectedIds([])
            setShowDeleteModal(false)
            loadData()
        } catch (error: any) {
            toast.error(error.message || '批量删除失败')
        } finally {
            setLoading(false)
        }
    }

    const deleteProxy = async (proxy: ProxyPoolItem) => {
        const confirmed = await confirm({
            title: '删除代理',
            description: `确定删除 ${proxy.host}:${proxy.port} 吗？已绑定账户会被清空代理配置。`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive',
        })
        if (!confirmed) return
        try {
            await proxyPoolService.delete(proxy.id)
            toast.success('代理已删除')
            if (detailProxy?.id === proxy.id) setDetailProxy(null)
            await loadData()
        } catch (error: any) {
            toast.error(error.message || '删除代理失败')
        }
    }

    const createGroup = async (input: string | ProxyMetaDraft) => {
        const payload = typeof input === 'string' ? { name: input } : input
        const groupName = payload.name.trim()
        if (!groupName) return null
        const existing = groups.find(group => group.name.trim().toLowerCase() === groupName.toLowerCase())
        if (existing) {
            toast.info('分组已存在，已复用现有分组')
            return existing
        }
        try {
            const group = await proxyPoolService.createGroup({
                name: groupName,
                color: payload?.color,
                description: payload?.description,
                sortOrder: payload?.sortOrder,
            })
            setGroups(prev => [...prev.filter(item => item.id !== group.id), group].sort(sortProxyMeta))
            toast.success('分组已创建')
            await loadMeta()
            return group
        } catch (error: any) {
            toast.error(error.message || '创建分组失败')
            return null
        }
    }

    const createTag = async (input: string | ProxyMetaDraft) => {
        const payload = typeof input === 'string' ? { name: input } : input
        const tagName = payload.name.trim()
        if (!tagName) return null
        const existing = tags.find(tag => tag.name.trim().toLowerCase() === tagName.toLowerCase())
        if (existing) {
            toast.info('标签已存在，已复用现有标签')
            return existing
        }
        try {
            const tag = await proxyPoolService.createTag({
                name: tagName,
                color: payload?.color,
                sortOrder: payload?.sortOrder,
            })
            setTags(prev => [...prev.filter(item => item.id !== tag.id), tag].sort(sortProxyMeta))
            toast.success('标签已创建')
            await loadMeta()
            return tag
        } catch (error: any) {
            toast.error(error.message || '创建标签失败')
            return null
        }
    }

    const updateGroup = async (group: ProxyGroup, draft: ProxyMetaDraft) => {
        const groupName = draft.name.trim()
        if (!groupName) {
            toast.error('分组名称不能为空')
            return null
        }
        try {
            const updated = await proxyPoolService.updateGroup(group.id, {
                name: groupName,
                color: draft.color,
                description: draft.description,
                sortOrder: draft.sortOrder,
            })
            setGroups(prev => prev.map(item => item.id === updated.id ? updated : item).sort(sortProxyMeta))
            toast.success('分组已更新')
            await loadMeta()
            await loadData()
            return updated
        } catch (error: any) {
            toast.error(error.message || '更新分组失败')
            return null
        }
    }

    const updateTag = async (tag: ProxyTag, draft: ProxyMetaDraft) => {
        const tagName = draft.name.trim()
        if (!tagName) {
            toast.error('标签名称不能为空')
            return null
        }
        try {
            const updated = await proxyPoolService.updateTag(tag.id, {
                name: tagName,
                color: draft.color,
                sortOrder: draft.sortOrder,
            })
            setTags(prev => prev.map(item => item.id === updated.id ? updated : item).sort(sortProxyMeta))
            toast.success('标签已更新')
            await loadMeta()
            await loadData()
            return updated
        } catch (error: any) {
            toast.error(error.message || '更新标签失败')
            return null
        }
    }

    const deleteGroup = async (group: ProxyGroup) => {
        const confirmed = await confirm({
            title: '删除代理分组',
            description: `确定删除「${group.name}」吗？该分组下的代理不会被删除，会回到未分组状态。`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive',
        })
        if (!confirmed) return
        try {
            await proxyPoolService.deleteGroup(group.id)
            setSelectedGroupIds(prev => prev.filter(id => id !== group.id))
            setBulkGroupId(prev => prev === group.id ? undefined : prev)
            setDeleteReplacement(prev => ({ ...prev, groupIds: prev.groupIds?.filter(id => id !== group.id) }))
            setGroups(prev => prev.filter(item => item.id !== group.id))
            toast.success('分组已删除')
            await loadMeta()
            await loadData()
        } catch (error: any) {
            toast.error(error.message || '删除分组失败')
        }
    }

    const deleteTag = async (tag: ProxyTag) => {
        const confirmed = await confirm({
            title: '删除代理标签',
            description: `确定删除「${tag.name}」吗？代理上的该标签会被移除。`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive',
        })
        if (!confirmed) return
        try {
            await proxyPoolService.deleteTag(tag.id)
            setSelectedTagIds(prev => prev.filter(id => id !== tag.id))
            setBulkTagIds(prev => prev.filter(id => id !== tag.id))
            setDeleteReplacement(prev => ({ ...prev, tagIds: prev.tagIds?.filter(id => id !== tag.id) }))
            setTags(prev => prev.filter(item => item.id !== tag.id))
            toast.success('标签已删除')
            await loadMeta()
            await loadData()
        } catch (error: any) {
            toast.error(error.message || '删除标签失败')
        }
    }

    return (
        <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
            <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-300">
                                <Network className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">代理池管理</h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400">分组、标签、检测状态和账户替换策略</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => setShowMetaManager(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                            <Settings2 className="h-4 w-4" />
                            分组标签
                        </button>
                        <button onClick={() => setShowImportWizard(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-primary-700 hover:shadow-lg hover:shadow-primary-600/20">
                            <Plus className="h-4 w-4" />
                            批量新增
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-5 overflow-auto p-6 xl:grid-cols-[minmax(0,1fr)_330px]">
                <div className="min-w-0 space-y-4">
                    <ProxyStatsStrip
                        total={total}
                        selectedCount={selectedIds.length}
                        stats={proxyStats}
                    />

                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="relative min-w-[280px] flex-1">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    onKeyDown={(event) => event.key === 'Enter' && runSearch()}
                                    placeholder="搜索主机、备注、出口 IP、账号"
                                    className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40"
                                />
                            </div>
                            <select value={status} onChange={(event) => setStatus(event.target.value as ProxyStatus | '')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                                <option value="">全部状态</option>
                                <option value="available">可用</option>
                                <option value="unavailable">不可用</option>
                                <option value="unknown">未知</option>
                                <option value="checking">检测中</option>
                            </select>
                            <select value={type} onChange={(event) => setType(event.target.value as ProxyType | '')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                                <option value="">全部类型</option>
                                {proxyTypes.map(item => <option key={item} value={item}>{item.toUpperCase()}</option>)}
                            </select>
                            <button onClick={() => setShowAdvancedFilters(value => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                <SlidersHorizontal className="h-4 w-4" />
                                高级
                                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAdvancedFilters && 'rotate-180')} />
                            </button>
                            <button onClick={runSearch} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-gray-800 dark:bg-white dark:text-gray-900">
                                <Filter className="h-4 w-4" />
                                筛选
                            </button>
                        </div>

                        <FilterChips
                            search={search}
                            status={status}
                            type={type}
                            groups={groups}
                            tags={tags}
                            selectedGroupIds={selectedGroupIds}
                            selectedTagIds={selectedTagIds}
                            tagMode={tagMode}
                            onClearSearch={() => setSearch('')}
                            onClearStatus={() => setStatus('')}
                            onClearType={() => setType('')}
                            onRemoveGroup={(id) => setSelectedGroupIds(prev => prev.filter(item => item !== id))}
                            onRemoveTag={(id) => setSelectedTagIds(prev => prev.filter(item => item !== id))}
                            onClearAll={clearFilters}
                        />

                        <AnimatePresence initial={false}>
                            {showAdvancedFilters && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0, y: -6 }}
                                    animate={{ height: 'auto', opacity: 1, y: 0 }}
                                    exit={{ height: 0, opacity: 0, y: -6 }}
                                    transition={{ duration: 0.22 }}
                                    className="overflow-hidden"
                                >
                                    <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
                                        <CriteriaBar
                                            groups={groups}
                                            tags={tags}
                                            selectedGroupIds={selectedGroupIds}
                                            selectedTagIds={selectedTagIds}
                                            tagMode={tagMode}
                                            onGroupChange={setSelectedGroupIds}
                                            onTagChange={setSelectedTagIds}
                                            onTagModeChange={setTagMode}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                    <input type="checkbox" checked={proxies.length > 0 && proxies.every(proxy => selectedIds.includes(proxy.id))} onChange={toggleAllVisible} />
                                    已选 {selectedIds.length} / 共 {total}
                                </label>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" title="当前筛选结果经代理网关转发的累计流量，不受分页影响">
                                    <span className="font-medium text-gray-500 dark:text-gray-400">当前筛选流量</span>
                                    <span className="text-gray-600 dark:text-gray-300">流入 <strong className="font-mono font-semibold text-gray-900 dark:text-white">{formatTrafficBytes(trafficSummary.trafficBytesIn)}</strong></span>
                                    <span className="text-gray-600 dark:text-gray-300">流出 <strong className="font-mono font-semibold text-gray-900 dark:text-white">{formatTrafficBytes(trafficSummary.trafficBytesOut)}</strong></span>
                                    <span className="text-gray-600 dark:text-gray-300">合计 <strong className="font-mono font-semibold text-gray-900 dark:text-white">{formatTrafficBytes(trafficSummary.trafficBytesIn + trafficSummary.trafficBytesOut)}</strong></span>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <button onClick={() => setShowDeleteModal(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600 transition hover:-translate-y-0.5 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30">
                                    <Trash2 className="h-4 w-4" />
                                    批量删除
                                </button>
                                <button onClick={loadData} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm transition hover:-translate-y-0.5 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                                    刷新
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1040px] text-left text-sm">
                                <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                                    <tr>
                                        <th className="w-10 px-4 py-3"></th>
                                        <th className="px-4 py-3">代理资产</th>
                                        <th className="px-4 py-3">状态</th>
                                        <th className="px-4 py-3">分组 / 标签</th>
                                        <th className="px-4 py-3">出口信息</th>
                                        <th className="px-4 py-3">检测</th>
                                        <th className="px-4 py-3 text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {loading && proxies.length === 0 ? (
                                        <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />加载中...</td></tr>
                                    ) : proxies.length === 0 ? (
                                        <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">暂无代理</td></tr>
                                    ) : proxies.map((proxy, index) => (
                                        <ProxyRow
                                            key={proxy.id}
                                            proxy={proxy}
                                            index={index}
                                            selected={selectedIds.includes(proxy.id)}
                                            onToggle={() => toggleSelected(proxy.id)}
                                            onOpenDetail={() => setDetailProxy(proxy)}
                                            onEdit={() => openProxyEditor(proxy)}
                                            onTest={() => testProxy(proxy)}
                                            onDelete={() => deleteProxy(proxy)}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm dark:border-gray-800">
                            <span className="text-gray-500">第 {page} / {totalPages} 页</span>
                            <div className="flex gap-2">
                                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800">上一页</button>
                                <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 transition hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800">下一页</button>
                            </div>
                        </div>
                    </div>
                </div>

                <aside className="space-y-4">
                    <ProxyInsightPanel
                        stats={proxyStats}
                        total={total}
                        selectedCount={selectedIds.length}
                        channels={channels}
                        checkChannel={checkChannel}
                        setCheckChannel={setCheckChannel}
                        onBatchTest={batchTest}
                        loading={loading}
                        activeFilterCount={activeFilterCount}
                    />
                    <CheckResultPanel results={checkResults} />
                </aside>
            </div>
            <ImportWizardModal
                open={showImportWizard}
                onOpenChange={setShowImportWizard}
                groups={groups}
                tags={tags}
                channels={channels}
                bulkText={bulkText}
                setBulkText={setBulkText}
                defaultType={bulkDefaultType}
                setDefaultType={setBulkDefaultType}
                groupId={bulkGroupId}
                setGroupId={setBulkGroupId}
                tagIds={bulkTagIds}
                setTagIds={setBulkTagIds}
                checkProxy={bulkCheck}
                setCheckProxy={setBulkCheck}
                duplicatePolicy={bulkDuplicatePolicy}
                setDuplicatePolicy={setBulkDuplicatePolicy}
                channel={checkChannel}
                setChannel={setCheckChannel}
                onCreateGroup={createGroup}
                onCreateTag={createTag}
                onImport={importProxies}
                loading={loading}
            />
            <Modal open={showDeleteModal} onOpenChange={setShowDeleteModal}>
                <ModalContent size="xl">
                    <ModalHeader>
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
                                <Trash2 className="h-5 w-5" />
                            </div>
                            <div>
                                <ModalTitle>批量删除代理</ModalTitle>
                                <ModalDescription>{selectedIds.length ? `将删除已选 ${selectedIds.length} 个代理。` : '未选择代理时，将按当前筛选条件批量删除。'}</ModalDescription>
                            </div>
                        </div>
                    </ModalHeader>
                    <ModalBody>
                        <DeletePanel
                            selectedCount={selectedIds.length}
                            replacement={deleteReplacement}
                            setReplacement={setDeleteReplacement}
                            proxies={proxies}
                            excludedProxyIds={selectedIds}
                            groups={groups}
                            tags={tags}
                            onDelete={batchDelete}
                            loading={loading}
                        />
                    </ModalBody>
                </ModalContent>
            </Modal>
            <ProxyDetailDrawer
                proxy={detailProxy}
                onClose={() => setDetailProxy(null)}
                onEdit={(proxy) => openProxyEditor(proxy)}
                onTest={(proxy) => testProxy(proxy)}
                onDelete={(proxy) => deleteProxy(proxy)}
            />
            <ProxyMetaManagerModal
                open={showMetaManager}
                onOpenChange={setShowMetaManager}
                groups={groups}
                tags={tags}
                onCreateGroup={createGroup}
                onCreateTag={createTag}
                onUpdateGroup={updateGroup}
                onUpdateTag={updateTag}
                onDeleteGroup={deleteGroup}
                onDeleteTag={deleteTag}
            />
            <ProxyEditorModal
                open={!!editingProxy}
                proxy={editingProxy}
                draft={editDraft}
                setDraft={setEditDraft}
                groups={groups}
                tags={tags}
                saving={savingProxy}
                onOpenChange={(open) => {
                    if (!open) setEditingProxy(null)
                }}
                onSave={saveProxyEdit}
            />
        </div>
    )
}

function ProxyStatsStrip({ total, selectedCount, stats }: {
    total: number
    selectedCount: number
    stats: { available: number; unavailable: number; checking: number; unknown: number; averageLatency: number }
}) {
    const items = [
        { label: '当前筛选', value: total, sub: '全部代理', icon: Layers3, className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-200' },
        { label: '当前页可用', value: stats.available, sub: `${stats.unavailable} 不可用`, icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200' },
        { label: '平均延迟', value: stats.averageLatency ? `${stats.averageLatency}ms` : '-', sub: `${stats.checking} 检测中`, icon: Zap, className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200' },
        { label: '已选择', value: selectedCount, sub: `${stats.unknown} 未检测`, icon: Activity, className: 'bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-200' },
    ]

    return (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            {items.map((item, index) => {
                const Icon = item.icon
                return (
                    <motion.div
                        key={item.label}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.04 }}
                        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
                    >
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{item.label}</div>
                            <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', item.className)}>
                                <Icon className="h-4 w-4" />
                            </div>
                        </div>
                        <div className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">{item.value}</div>
                        <div className="mt-1 text-xs text-gray-400">{item.sub}</div>
                    </motion.div>
                )
            })}
        </div>
    )
}

function FilterChips({ search, status, type, groups, tags, selectedGroupIds, selectedTagIds, tagMode, onClearSearch, onClearStatus, onClearType, onRemoveGroup, onRemoveTag, onClearAll }: {
    search: string
    status: ProxyStatus | ''
    type: ProxyType | ''
    groups: ProxyGroup[]
    tags: ProxyTag[]
    selectedGroupIds: number[]
    selectedTagIds: number[]
    tagMode: ProxyTagFilterMode
    onClearSearch: () => void
    onClearStatus: () => void
    onClearType: () => void
    onRemoveGroup: (id: number) => void
    onRemoveTag: (id: number) => void
    onClearAll: () => void
}) {
    const selectedGroups = groups.filter(group => selectedGroupIds.includes(group.id))
    const selectedTags = tags.filter(tag => selectedTagIds.includes(tag.id))
    const hasFilters = !!search.trim() || !!status || !!type || selectedGroups.length > 0 || selectedTags.length > 0
    if (!hasFilters) {
        return (
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                <Info className="h-3.5 w-3.5" />
                当前显示全部代理，可使用搜索或高级筛选缩小范围
            </div>
        )
    }

    return (
        <div className="mt-3 flex flex-wrap items-center gap-2">
            {search.trim() && <FilterChip label={`搜索: ${search.trim()}`} onRemove={onClearSearch} />}
            {status && <FilterChip label={`状态: ${statusConfig[status].label}`} onRemove={onClearStatus} />}
            {type && <FilterChip label={`类型: ${type.toUpperCase()}`} onRemove={onClearType} />}
            {selectedGroups.map(group => (
                <FilterChip key={group.id} label={`分组: ${group.name}`} color={group.color} onRemove={() => onRemoveGroup(group.id)} />
            ))}
            {selectedTags.map(tag => (
                <FilterChip key={tag.id} label={`标签${tagMode === 'and' ? '且' : '或'}: ${tag.name}`} color={tag.color} onRemove={() => onRemoveTag(tag.id)} />
            ))}
            <button onClick={onClearAll} className="rounded-full px-2.5 py-1 text-xs text-gray-500 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">清空</button>
        </div>
    )
}

function FilterChip({ label, color, onRemove }: {
    label: string
    color?: string
    onRemove: () => void
}) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" style={color ? metaChipStyle(color, color) : undefined}>
            {color && <MetaDot color={color} fallback={color} className="h-1.5 w-1.5" />}
            {label}
            <button onClick={onRemove} className="rounded-full p-0.5 hover:bg-black/5 dark:hover:bg-white/10">
                <X className="h-3 w-3" />
            </button>
        </span>
    )
}

function ProxyInsightPanel({ stats, total, selectedCount, channels, checkChannel, setCheckChannel, onBatchTest, loading, activeFilterCount }: {
    stats: { available: number; unavailable: number; checking: number; unknown: number; averageLatency: number }
    total: number
    selectedCount: number
    channels: ProxyCheckChannel[]
    checkChannel: string
    setCheckChannel: (value: string) => void
    onBatchTest: () => void
    loading: boolean
    activeFilterCount: number
}) {
    const checkedOnPage = stats.available + stats.unavailable
    const healthPercent = checkedOnPage ? Math.round((stats.available / checkedOnPage) * 100) : 0

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">检测中心</h3>
                    <p className="text-xs text-gray-400">{activeFilterCount ? `${activeFilterCount} 个筛选条件` : '全部代理范围'}</p>
                </div>
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/60">
                <div className="flex items-end justify-between">
                    <div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">当前页健康度</div>
                        <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{checkedOnPage ? `${healthPercent}%` : '-'}</div>
                    </div>
                    <div className="text-right text-xs text-gray-400">
                        <div>{total} 总数</div>
                        <div>{selectedCount} 已选</div>
                    </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${healthPercent}%` }}
                        transition={{ duration: 0.5 }}
                        className="h-full rounded-full bg-emerald-500"
                    />
                </div>
            </div>
            <div className="mt-4 grid gap-2">
                <select
                    value={checkChannel}
                    onChange={(event) => setCheckChannel(event.target.value)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                >
                    {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                </select>
                <button onClick={onBatchTest} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-gray-900">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {selectedCount ? `检测已选 ${selectedCount}` : '检测筛选结果'}
                </button>
            </div>
        </div>
    )
}

function ProxyRow({ proxy, index, selected, onToggle, onOpenDetail, onEdit, onTest, onDelete }: {
    proxy: ProxyPoolItem
    index: number
    selected: boolean
    onToggle: () => void
    onOpenDetail: () => void
    onEdit: () => void
    onTest: () => void
    onDelete: () => void
}) {
    const config = statusConfig[proxy.status || 'unknown']
    const StatusIcon = config.icon
    const [menuOpen, setMenuOpen] = useState(false)
    const location = [proxy.country, proxy.region || proxy.city, proxy.isp].filter(Boolean).join(' · ')
    return (
        <motion.tr
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index, 8) * 0.025 }}
            onClick={onOpenDetail}
            className="group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
        >
            <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selected} onChange={onToggle} />
            </td>
            <td className="px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="rounded-md bg-gray-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-white dark:bg-gray-700">{proxy.type}</span>
                    <span className="min-w-0 truncate font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{formatProxyHost(proxy.host)}:{proxy.port}</span>
                </div>
                <div className="mt-1 flex max-w-[360px] flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                    {proxy.username && <span className="truncate">账号 {proxy.username}</span>}
                    {proxy.refreshUrl && <span className="truncate text-blue-500">刷新 URL</span>}
                    {proxy.remark && <span className="truncate">{proxy.remark}</span>}
                </div>
            </td>
            <td className="px-4 py-3">
                <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', config.className)}>
                    <StatusIcon className={cn('h-3.5 w-3.5', proxy.status === 'checking' && 'animate-spin')} />
                    {config.label}
                </span>
                {proxy.lastError && <div className="mt-1 max-w-[140px] truncate text-xs text-rose-400">{proxy.lastError}</div>}
            </td>
            <td className="px-4 py-3">
                <div className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                    {proxy.group ? <MetaDot color={proxy.group.color} fallback={proxyMetaColors[0]} /> : <span className="h-2.5 w-2.5 rounded-full border border-dashed border-gray-300 dark:border-gray-600" />}
                    <span>{proxy.group?.name || '未分组'}</span>
                </div>
                <div className="mt-1 flex max-w-[220px] flex-wrap gap-1">
                    {(proxy.tags || []).slice(0, 3).map(tag => (
                        <span key={tag.id} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] dark:bg-gray-800" style={metaChipStyle(tag.color, proxyMetaColors[7])}>
                            <MetaDot color={tag.color} fallback={proxyMetaColors[7]} className="h-1.5 w-1.5" />
                            {tag.name}
                        </span>
                    ))}
                    {(proxy.tags || []).length > 3 && <span className="rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-400 dark:border-gray-700">+{(proxy.tags || []).length - 3}</span>}
                </div>
            </td>
            <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                <div className="font-mono text-sm text-gray-900 dark:text-gray-100">{proxy.exitIp || '-'}</div>
                <div className="mt-1 max-w-[260px] truncate text-gray-400">{location || '暂无出口信息'}</div>
            </td>
            <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                <div className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    <Clock3 className="h-3 w-3" />
                    {proxy.checkLatencyMs ? `${proxy.checkLatencyMs}ms` : '-'}
                </div>
                <div className="mt-1 text-gray-400">{compactDateTime(proxy.lastCheckAt)}</div>
            </td>
            <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                <div className="inline-flex items-center gap-1.5">
                    <button onClick={onTest} title="检测" className="rounded-lg border border-gray-200 p-2 text-gray-600 transition hover:-translate-y-0.5 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                        <ShieldCheck className="h-4 w-4" />
                    </button>
                    <div className="relative">
                        <button onClick={() => setMenuOpen(value => !value)} title="更多操作" className="rounded-lg border border-gray-200 p-2 text-gray-600 transition hover:-translate-y-0.5 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                            <MoreHorizontal className="h-4 w-4" />
                        </button>
                        <AnimatePresence>
                            {menuOpen && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                                    className="absolute right-0 z-20 mt-2 w-32 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg dark:border-gray-700 dark:bg-gray-900"
                                >
                                    <button onClick={() => { setMenuOpen(false); onOpenDetail() }} className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"><Eye className="h-3.5 w-3.5" />详情</button>
                                    <button onClick={() => { setMenuOpen(false); onEdit() }} className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-800"><Pencil className="h-3.5 w-3.5" />编辑</button>
                                    <button onClick={() => { setMenuOpen(false); onDelete() }} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/30"><Trash2 className="h-3.5 w-3.5" />删除</button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </td>
        </motion.tr>
    )
}

function CriteriaBar({ groups, tags, selectedGroupIds, selectedTagIds, tagMode, onGroupChange, onTagChange, onTagModeChange }: {
    groups: ProxyGroup[]
    tags: ProxyTag[]
    selectedGroupIds: number[]
    selectedTagIds: number[]
    tagMode: ProxyTagFilterMode
    onGroupChange: (ids: number[]) => void
    onTagChange: (ids: number[]) => void
    onTagModeChange: (mode: ProxyTagFilterMode) => void
}) {
    const toggle = (ids: number[], id: number) => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]
    return (
        <div className="space-y-3">
            <div>
                <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">分组筛选（OR）</div>
                <div className="flex flex-wrap gap-2">
                    {groups.map(group => (
                        <button key={group.id} onClick={() => onGroupChange(toggle(selectedGroupIds, group.id))} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs', selectedGroupIds.includes(group.id) ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/30' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300')}>
                            <MetaDot color={group.color} fallback={proxyMetaColors[0]} />
                            {group.name}
                        </button>
                    ))}
                </div>
            </div>
            <div>
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">标签筛选</span>
                    <div className="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                        <button onClick={() => onTagModeChange('or')} className={cn('rounded-md px-2 py-1 text-[11px]', tagMode === 'or' && 'bg-white shadow-sm dark:bg-gray-700')}>任一</button>
                        <button onClick={() => onTagModeChange('and')} className={cn('rounded-md px-2 py-1 text-[11px]', tagMode === 'and' && 'bg-white shadow-sm dark:bg-gray-700')}>全部</button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {tags.map(tag => (
                        <button key={tag.id} onClick={() => onTagChange(toggle(selectedTagIds, tag.id))} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs', selectedTagIds.includes(tag.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300')}>
                            <MetaDot color={tag.color} fallback={proxyMetaColors[7]} />
                            {tag.name}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}

function ImportWizardModal(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    groups: ProxyGroup[]
    tags: ProxyTag[]
    channels: ProxyCheckChannel[]
    bulkText: string
    setBulkText: (value: string) => void
    defaultType: ProxyType
    setDefaultType: (value: ProxyType) => void
    groupId?: number
    setGroupId: (value?: number) => void
    tagIds: number[]
    setTagIds: (value: number[]) => void
    checkProxy: boolean
    setCheckProxy: (value: boolean) => void
    duplicatePolicy: ProxyDuplicatePolicy
    setDuplicatePolicy: (value: ProxyDuplicatePolicy) => void
    channel: string
    setChannel: (value: string) => void
    onCreateGroup: (input: string | ProxyMetaDraft) => Promise<ProxyGroup | null>
    onCreateTag: (input: string | ProxyMetaDraft) => Promise<ProxyTag | null>
    onImport: () => void
    loading: boolean
}) {
    const [step, setStep] = useState<ImportWizardStep>(1)
    const [quickGroupName, setQuickGroupName] = useState('')
    const [quickTagName, setQuickTagName] = useState('')
    const [creatingGroup, setCreatingGroup] = useState(false)
    const [creatingTag, setCreatingTag] = useState(false)
    const toggleTag = (id: number) => props.setTagIds(props.tagIds.includes(id) ? props.tagIds.filter(item => item !== id) : [...props.tagIds, id])
    const previewRows = useMemo(() => parseProxyPreviewRows(props.bulkText, props.defaultType), [props.bulkText, props.defaultType])
    const previewSummary = useMemo(() => {
        const errors = previewRows.filter(row => row.status === 'error').length
        const duplicates = previewRows.filter(row => row.status === 'duplicate').length
        const usable = previewRows.length - errors
        return { total: previewRows.length, errors, duplicates, usable }
    }, [previewRows])
    const createAndSelectGroup = async () => {
        if (!quickGroupName.trim() || creatingGroup) return
        setCreatingGroup(true)
        try {
            const group = await props.onCreateGroup(quickGroupName)
            if (!group) return
            props.setGroupId(group.id)
            setQuickGroupName('')
        } finally {
            setCreatingGroup(false)
        }
    }
    const createAndSelectTag = async () => {
        if (!quickTagName.trim() || creatingTag) return
        setCreatingTag(true)
        try {
            const tag = await props.onCreateTag(quickTagName)
            if (!tag) return
            props.setTagIds([...new Set([...props.tagIds, tag.id])])
            setQuickTagName('')
        } finally {
            setCreatingTag(false)
        }
    }
    const closeModal = (open: boolean) => {
        props.onOpenChange(open)
        if (!open) setStep(1)
    }
    const goNext = () => setStep(prev => Math.min(3, prev + 1) as ImportWizardStep)
    const goPrev = () => setStep(prev => Math.max(1, prev - 1) as ImportWizardStep)

    return (
        <Modal open={props.open} onOpenChange={closeModal}>
            <ModalContent size="full" className="h-[88vh] overflow-hidden">
                <ModalHeader>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
                            <Upload className="h-5 w-5" />
                        </div>
                        <div>
                            <ModalTitle>批量新增代理</ModalTitle>
                            <ModalDescription>粘贴代理、确认解析结果，再导入代理池。</ModalDescription>
                        </div>
                    </div>
                </ModalHeader>
                <ModalBody className="min-h-0 p-0">
                    <div className="grid h-full min-h-0 lg:grid-cols-[260px_minmax(0,1fr)]">
                        <div className="border-b border-gray-200 bg-gray-50 p-5 dark:border-gray-700 dark:bg-gray-900/70 lg:border-b-0 lg:border-r">
                            <div className="space-y-3">
                                {[
                                    { id: 1, title: '粘贴代理', icon: ClipboardPaste, desc: `${previewSummary.total || 0} 行待解析` },
                                    { id: 2, title: '解析预览', icon: Eye, desc: `${previewSummary.usable} 可用 / ${previewSummary.errors} 错误` },
                                    { id: 3, title: '导入检测', icon: ShieldCheck, desc: props.checkProxy ? '导入后检测' : '仅导入代理' },
                                ].map(item => {
                                    const Icon = item.icon
                                    const active = step === item.id
                                    const done = step > item.id
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => setStep(item.id as ImportWizardStep)}
                                            className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition hover:-translate-y-0.5', active ? 'border-primary-300 bg-white shadow-sm dark:border-primary-800 dark:bg-gray-800' : 'border-transparent hover:bg-white/70 dark:hover:bg-gray-800/70')}
                                        >
                                            <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', active ? 'bg-primary-600 text-white' : done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-300')}>
                                                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-sm font-medium text-gray-900 dark:text-white">{item.title}</span>
                                                <span className="block truncate text-xs text-gray-400">{item.desc}</span>
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                            <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-white p-3 text-xs leading-5 text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                                <div className="font-medium text-gray-700 dark:text-gray-200">支持格式</div>
                                <div className="mt-2 font-mono text-[11px] text-blue-500">
                                    192.168.0.1:8000{'{备注}'}<br />
                                    192.168.0.1:8000:账号:密码{'{备注}'}<br />
                                    socks5://192.168.0.1:8000[刷新URL]{'{备注}'}<br />
                                    http://[2001:db8::e13]:8000[刷新URL]{'{备注}'}<br />
                                    socks5://账号:密码@192.168.0.1:8000[刷新URL]{'{备注}'}
                                </div>
                            </div>
                        </div>
                        <div className="min-h-0 overflow-hidden">
                            <AnimatePresence mode="wait">
                                {step === 1 && (
                                    <motion.div
                                        key="paste"
                                        initial={{ opacity: 0, x: 18 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -18 }}
                                        transition={{ duration: 0.2 }}
                                        className="grid h-full min-h-0 gap-4 overflow-auto p-5 xl:grid-cols-[minmax(0,1fr)_320px]"
                                    >
                                        <div className="flex min-h-0 flex-col">
                                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                                <select value={props.defaultType} onChange={(event) => props.setDefaultType(event.target.value as ProxyType)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                                                    {proxyTypes.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}
                                                </select>
                                                <select value={props.duplicatePolicy} onChange={(event) => props.setDuplicatePolicy(event.target.value as ProxyDuplicatePolicy)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                                                    <option value="skip">重复项跳过</option>
                                                    <option value="update">重复项覆盖</option>
                                                    <option value="allow">允许重复</option>
                                                </select>
                                                <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
                                                    <input type="checkbox" checked={props.checkProxy} onChange={(event) => props.setCheckProxy(event.target.checked)} />
                                                    导入后检测
                                                </label>
                                                {props.checkProxy && (
                                                    <select value={props.channel} onChange={(event) => props.setChannel(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                                                        {props.channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                                                    </select>
                                                )}
                                            </div>
                                            <textarea
                                                value={props.bulkText}
                                                onChange={(event) => props.setBulkText(event.target.value)}
                                                placeholder="请在此填写您的代理信息，一行一个代理"
                                                className="min-h-[420px] flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 font-mono text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40"
                                            />
                                        </div>
                                        <div className="space-y-3">
                                            <ImportMetaSelector
                                                groups={props.groups}
                                                tags={props.tags}
                                                groupId={props.groupId}
                                                setGroupId={props.setGroupId}
                                                tagIds={props.tagIds}
                                                setTagIds={props.setTagIds}
                                                quickGroupName={quickGroupName}
                                                setQuickGroupName={setQuickGroupName}
                                                quickTagName={quickTagName}
                                                setQuickTagName={setQuickTagName}
                                                creatingGroup={creatingGroup}
                                                creatingTag={creatingTag}
                                                onCreateGroup={createAndSelectGroup}
                                                onCreateTag={createAndSelectTag}
                                                onToggleTag={toggleTag}
                                            />
                                        </div>
                                    </motion.div>
                                )}
                                {step === 2 && (
                                    <motion.div
                                        key="preview"
                                        initial={{ opacity: 0, x: 18 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -18 }}
                                        transition={{ duration: 0.2 }}
                                        className="flex h-full min-h-0 flex-col p-5"
                                    >
                                        <ImportPreviewSummary summary={previewSummary} duplicatePolicy={props.duplicatePolicy} />
                                        <ImportPreviewTable rows={previewRows} duplicatePolicy={props.duplicatePolicy} />
                                    </motion.div>
                                )}
                                {step === 3 && (
                                    <motion.div
                                        key="finish"
                                        initial={{ opacity: 0, x: 18 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -18 }}
                                        transition={{ duration: 0.2 }}
                                        className="grid h-full min-h-0 place-items-center overflow-auto p-5"
                                    >
                                        <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
                                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
                                                <Upload className="h-7 w-7" />
                                            </div>
                                            <h3 className="mt-4 text-xl font-semibold text-gray-900 dark:text-white">准备导入</h3>
                                            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">本次解析到 {previewSummary.usable} 行可处理代理，{previewSummary.errors} 行需要修正。</p>
                                            <div className="mt-5 grid gap-3 text-left sm:grid-cols-3">
                                                <ImportFinishCard label="可处理" value={previewSummary.usable} tone="emerald" />
                                                <ImportFinishCard label="重复行" value={previewSummary.duplicates} tone="amber" />
                                                <ImportFinishCard label="错误行" value={previewSummary.errors} tone="rose" />
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter className="justify-between">
                    <div className="text-xs text-gray-400">最多一次添加 500 个代理</div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => closeModal(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">取消</button>
                        {step > 1 && (
                            <button onClick={goPrev} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                <ArrowLeft className="h-4 w-4" />
                                上一步
                            </button>
                        )}
                        {step < 3 ? (
                            <button onClick={goNext} disabled={step === 1 && !props.bulkText.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-gray-900">
                                下一步
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        ) : (
                            <button onClick={props.onImport} disabled={props.loading || previewSummary.usable === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60">
                                {props.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                导入
                            </button>
                        )}
                    </div>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function ImportMetaSelector({ groups, tags, groupId, setGroupId, tagIds, setTagIds, quickGroupName, setQuickGroupName, quickTagName, setQuickTagName, creatingGroup, creatingTag, onCreateGroup, onCreateTag, onToggleTag }: {
    groups: ProxyGroup[]
    tags: ProxyTag[]
    groupId?: number
    setGroupId: (value?: number) => void
    tagIds: number[]
    setTagIds: (value: number[]) => void
    quickGroupName: string
    setQuickGroupName: (value: string) => void
    quickTagName: string
    setQuickTagName: (value: string) => void
    creatingGroup: boolean
    creatingTag: boolean
    onCreateGroup: () => void
    onCreateTag: () => void
    onToggleTag: (id: number) => void
}) {
    return (
        <>
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                    <FolderOpen className="h-3.5 w-3.5" />
                    导入分组
                </div>
                <select value={groupId || ''} onChange={(event) => setGroupId(event.target.value ? Number(event.target.value) : undefined)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                    <option value="">不分组</option>
                    {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                <div className="mt-2 flex gap-2">
                    <input
                        value={quickGroupName}
                        onChange={(event) => setQuickGroupName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault()
                                onCreateGroup()
                            }
                        }}
                        placeholder="创建新分组"
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                    />
                    <button onClick={onCreateGroup} disabled={!quickGroupName.trim() || creatingGroup} className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700 hover:bg-primary-50 disabled:opacity-50 dark:border-primary-900 dark:text-primary-300 dark:hover:bg-primary-950/30">
                        {creatingGroup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="mb-2 flex items-center justify-between">
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400"><Tag className="h-3.5 w-3.5" />导入标签</span>
                    {tagIds.length > 0 && <button onClick={() => setTagIds([])} className="text-[11px] text-gray-400 hover:text-gray-600">清空</button>}
                </div>
                <div className="max-h-32 overflow-auto">
                    <div className="flex flex-wrap gap-2">
                        {tags.length === 0 ? <span className="text-xs text-gray-400">暂无标签</span> : tags.map(tag => (
                            <button key={tag.id} onClick={() => onToggleTag(tag.id)} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition hover:-translate-y-0.5', tagIds.includes(tag.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300')}>
                                <MetaDot color={tag.color} fallback={proxyMetaColors[7]} className="h-2 w-2" />
                                {tag.name}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mt-2 flex gap-2">
                    <input
                        value={quickTagName}
                        onChange={(event) => setQuickTagName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault()
                                onCreateTag()
                            }
                        }}
                        placeholder="创建新标签"
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                    />
                    <button onClick={onCreateTag} disabled={!quickTagName.trim() || creatingTag} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
                        {creatingTag ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>
        </>
    )
}

function ImportPreviewSummary({ summary, duplicatePolicy }: {
    summary: { total: number; errors: number; duplicates: number; usable: number }
    duplicatePolicy: ProxyDuplicatePolicy
}) {
    return (
        <div className="mb-4 grid gap-3 md:grid-cols-4">
            <ImportFinishCard label="总行数" value={summary.total} tone="blue" />
            <ImportFinishCard label="可处理" value={summary.usable} tone="emerald" />
            <ImportFinishCard label={duplicatePolicy === 'skip' ? '将跳过' : duplicatePolicy === 'update' ? '将覆盖' : '允许重复'} value={summary.duplicates} tone="amber" />
            <ImportFinishCard label="错误行" value={summary.errors} tone="rose" />
        </div>
    )
}

function ImportPreviewTable({ rows, duplicatePolicy }: {
    rows: ProxyImportPreviewRow[]
    duplicatePolicy: ProxyDuplicatePolicy
}) {
    const duplicateLabel = duplicatePolicy === 'skip' ? '将跳过' : duplicatePolicy === 'update' ? '将覆盖' : '仍导入'

    return (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="max-h-full overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                        <tr>
                            <th className="px-4 py-3">行</th>
                            <th className="px-4 py-3">解析结果</th>
                            <th className="px-4 py-3">账号</th>
                            <th className="px-4 py-3">刷新 URL</th>
                            <th className="px-4 py-3">备注</th>
                            <th className="px-4 py-3">处理</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {rows.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">粘贴代理后会在这里显示解析预览</td></tr>
                        ) : rows.map(row => {
                            const isError = row.status === 'error'
                            const isDuplicate = row.status === 'duplicate'
                            return (
                                <tr key={`${row.line}-${row.source}`} className={cn('transition-colors', isError ? 'bg-rose-50/50 dark:bg-rose-950/10' : isDuplicate ? 'bg-amber-50/50 dark:bg-amber-950/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50')}>
                                    <td className="px-4 py-3 font-mono text-xs text-gray-400">#{row.line}</td>
                                    <td className="px-4 py-3">
                                        {isError ? (
                                            <div>
                                                <div className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200"><FileWarning className="h-3 w-3" />{row.error}</div>
                                                <div className="mt-1 max-w-[360px] truncate font-mono text-xs text-gray-400">{row.source}</div>
                                            </div>
                                        ) : (
                                            <div className="flex min-w-0 items-center gap-2">
                                                <span className="rounded bg-gray-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-white dark:bg-gray-700">{row.type}</span>
                                                <span className="truncate font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{formatProxyHost(row.host || '')}:{row.port}</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-500">{row.username || '-'}</td>
                                    <td className="max-w-[240px] truncate px-4 py-3 text-xs text-blue-500">{row.refreshUrl || '-'}</td>
                                    <td className="max-w-[220px] truncate px-4 py-3 text-xs text-gray-500">{row.remark || '-'}</td>
                                    <td className="px-4 py-3">
                                        <span className={cn('rounded-full px-2 py-1 text-xs', isError ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200' : isDuplicate ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200')}>
                                            {isError ? '需修正' : isDuplicate ? duplicateLabel : '待导入'}
                                        </span>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

function ImportFinishCard({ label, value, tone }: {
    label: string
    value: number | string
    tone: 'blue' | 'emerald' | 'amber' | 'rose'
}) {
    const toneClass = {
        blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:border-blue-900',
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900',
        amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900',
        rose: 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900',
    }[tone]
    return (
        <div className={cn('rounded-xl border p-4', toneClass)}>
            <div className="text-xs opacity-80">{label}</div>
            <div className="mt-2 text-2xl font-semibold">{value}</div>
        </div>
    )
}

function DeletePanel({ selectedCount, replacement, setReplacement, proxies, excludedProxyIds, groups, tags, onDelete, loading }: {
    selectedCount: number
    replacement: BulkDeleteProxyPayload['replacement']
    setReplacement: (value: BulkDeleteProxyPayload['replacement']) => void
    proxies: ProxyPoolItem[]
    excludedProxyIds: number[]
    groups: ProxyGroup[]
    tags: ProxyTag[]
    onDelete: () => void
    loading: boolean
}) {
    const setMode = (mode: BulkDeleteProxyPayload['replacement']['mode']) => setReplacement({ ...replacement, mode })
    const toggleGroup = (id: number) => setReplacement({ ...replacement, groupIds: (replacement.groupIds || []).includes(id) ? (replacement.groupIds || []).filter(item => item !== id) : [...(replacement.groupIds || []), id] })
    const toggleTag = (id: number) => setReplacement({ ...replacement, tagIds: (replacement.tagIds || []).includes(id) ? (replacement.tagIds || []).filter(item => item !== id) : [...(replacement.tagIds || []), id] })
    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">选择删除后已绑定账户的代理替换方案。</p>
            <div className="grid gap-2">
                {[
                    ['clear', '清空账户代理'],
                    ['proxy', '替换为指定代理'],
                    ['auto', '按条件自动匹配'],
                    ['manual', '替换为手动 URL'],
                ].map(([mode, label]) => (
                    <button key={mode} onClick={() => setMode(mode as any)} className={cn('rounded-lg border px-3 py-2 text-left text-sm transition hover:-translate-y-0.5', replacement.mode === mode ? 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/30' : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800')}>{label}</button>
                ))}
                {replacement.mode === 'proxy' && (
                    <select value={replacement.proxyId || ''} onChange={(event) => setReplacement({ ...replacement, proxyId: event.target.value ? Number(event.target.value) : undefined })} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                        <option value="">选择替换代理</option>
                        {proxies.filter(proxy => proxy.status === 'available' && !excludedProxyIds.includes(proxy.id)).map(proxy => <option key={proxy.id} value={proxy.id}>{proxyToUrl(proxy)}</option>)}
                    </select>
                )}
                {replacement.mode === 'manual' && (
                    <input value={replacement.fallbackProxy || ''} onChange={(event) => setReplacement({ ...replacement, fallbackProxy: event.target.value })} placeholder="socks5://host:port" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" />
                )}
                {replacement.mode === 'auto' && (
                    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                        <div className="text-xs text-gray-500">分组</div>
                        <div className="flex flex-wrap gap-2">{groups.map(group => (
                            <button key={group.id} onClick={() => toggleGroup(group.id)} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', replacement.groupIds?.includes(group.id) ? 'border-primary-500 bg-primary-50' : 'border-gray-200 dark:border-gray-700')}>
                                <MetaDot color={group.color} fallback={proxyMetaColors[0]} className="h-2 w-2" />
                                {group.name}
                            </button>
                        ))}</div>
                        <div className="text-xs text-gray-500">标签</div>
                        <div className="flex flex-wrap gap-2">{tags.map(tag => (
                            <button key={tag.id} onClick={() => toggleTag(tag.id)} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', replacement.tagIds?.includes(tag.id) ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 dark:border-gray-700')}>
                                <MetaDot color={tag.color} fallback={proxyMetaColors[7]} className="h-2 w-2" />
                                {tag.name}
                            </button>
                        ))}</div>
                        <select value={replacement.tagMode || 'or'} onChange={(event) => setReplacement({ ...replacement, tagMode: event.target.value as ProxyTagFilterMode })} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                            <option value="or">任一标签</option>
                            <option value="and">全部标签</option>
                        </select>
                    </div>
                )}
                <button onClick={onDelete} disabled={loading} className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-rose-700 disabled:opacity-60">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    确认删除
                </button>
            </div>
        </div>
    )
}

function ProxyDetailDrawer({ proxy, onClose, onEdit, onTest, onDelete }: {
    proxy: ProxyPoolItem | null
    onClose: () => void
    onEdit: (proxy: ProxyPoolItem) => void
    onTest: (proxy: ProxyPoolItem) => void
    onDelete: (proxy: ProxyPoolItem) => void
}) {
    return (
        <AnimatePresence>
            {proxy && (
            <div key={proxy.id} className="fixed inset-0 z-40">
                <motion.button
                    aria-label="关闭代理详情"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-black/20 backdrop-blur-[1px] dark:bg-black/40"
                />
                <ProxyDetailDrawerContent proxy={proxy} onClose={onClose} onEdit={onEdit} onTest={onTest} onDelete={onDelete} />
            </div>
            )}
        </AnimatePresence>
    )
}

function ProxyDetailDrawerContent({ proxy, onClose, onEdit, onTest, onDelete }: {
    proxy: ProxyPoolItem
    onClose: () => void
    onEdit: (proxy: ProxyPoolItem) => void
    onTest: (proxy: ProxyPoolItem) => void
    onDelete: (proxy: ProxyPoolItem) => void
}) {
    const config = statusConfig[proxy.status || 'unknown']
    const StatusIcon = config.icon
    const location = [proxy.country, proxy.region || proxy.city, proxy.isp].filter(Boolean).join(' · ')

    return (
        <motion.aside
            initial={{ x: 420, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 420, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
        >
            <div className="border-b border-gray-100 p-5 dark:border-gray-800">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <div className="mb-2 flex items-center gap-2 text-sm text-gray-400">
                            <PanelRightOpen className="h-4 w-4" />
                            代理详情
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="rounded-md bg-gray-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-white dark:bg-gray-700">{proxy.type}</span>
                            <h3 className="truncate font-mono text-lg font-semibold text-gray-900 dark:text-white">{formatProxyHost(proxy.host)}:{proxy.port}</h3>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', config.className)}>
                                <StatusIcon className={cn('h-3.5 w-3.5', proxy.status === 'checking' && 'animate-spin')} />
                                {config.label}
                            </span>
                            {proxy.usageScope && <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-300">{proxy.usageScope}</span>}
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                        <X className="h-5 w-5" />
                    </button>
                </div>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
                <div className="grid grid-cols-2 gap-3">
                    <DetailMetric icon={<Clock3 className="h-4 w-4" />} label="延迟" value={proxy.checkLatencyMs ? `${proxy.checkLatencyMs}ms` : '-'} />
                    <DetailMetric icon={<Activity className="h-4 w-4" />} label="检测次数" value={proxy.checkCount || 0} />
                    <DetailMetric icon={<CheckCircle2 className="h-4 w-4" />} label="成功" value={proxy.successCount || 0} />
                    <DetailMetric icon={<XCircle className="h-4 w-4" />} label="失败" value={proxy.failureCount || 0} />
                </div>

                <section className="space-y-3">
                    <DetailSectionTitle icon={<Activity className="h-4 w-4" />} title="累计网关流量" />
                    <div className="grid grid-cols-2 gap-3">
                        <DetailMetric icon={<ArrowRight className="h-4 w-4" />} label="流入" value={formatTrafficBytes(proxy.trafficBytesIn)} />
                        <DetailMetric icon={<ArrowLeft className="h-4 w-4" />} label="流出" value={formatTrafficBytes(proxy.trafficBytesOut)} />
                    </div>
                </section>

                <section className="space-y-3">
                    <DetailSectionTitle icon={<Server className="h-4 w-4" />} title="连接信息" />
                    <DetailLine label="代理地址" value={proxyToUrl(proxy)} mono />
                    <DetailLine label="账号" value={proxy.username || '-'} />
                    <DetailLine label="刷新 URL" value={proxy.refreshUrl || '-'} />
                </section>

                <section className="space-y-3">
                    <DetailSectionTitle icon={<Globe2 className="h-4 w-4" />} title="出口信息" />
                    <DetailLine label="出口 IP" value={proxy.exitIp || '-'} mono />
                    <DetailLine label="位置 / ISP" value={location || '-'} />
                    <DetailLine label="最近检测" value={compactDateTime(proxy.lastCheckAt)} />
                    {proxy.lastError && <DetailLine label="最近错误" value={proxy.lastError} danger />}
                </section>

                <section className="space-y-3">
                    <DetailSectionTitle icon={<ListFilter className="h-4 w-4" />} title="归类" />
                    <div className="flex flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs dark:border-gray-700">
                            {proxy.group ? <MetaDot color={proxy.group.color} fallback={proxyMetaColors[0]} /> : <span className="h-2 w-2 rounded-full border border-dashed border-gray-300" />}
                            {proxy.group?.name || '未分组'}
                        </span>
                        {(proxy.tags || []).map(tag => (
                            <span key={tag.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" style={metaChipStyle(tag.color, proxyMetaColors[7])}>
                                <MetaDot color={tag.color} fallback={proxyMetaColors[7]} className="h-2 w-2" />
                                {tag.name}
                            </span>
                        ))}
                    </div>
                    <DetailLine label="备注" value={proxy.remark || '-'} />
                </section>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 p-4 dark:border-gray-800">
                <button onClick={() => onTest(proxy)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                    <ShieldCheck className="h-4 w-4" />
                    检测
                </button>
                <button onClick={() => onEdit(proxy)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                    <Pencil className="h-4 w-4" />
                    编辑
                </button>
                <button onClick={() => onDelete(proxy)} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">
                    <Trash2 className="h-4 w-4" />
                    删除
                </button>
            </div>
        </motion.aside>
    )
}

function DetailMetric({ icon, label, value }: {
    icon: ReactNode
    label: string
    value: string | number
}) {
    return (
        <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center gap-2 text-xs text-gray-400">{icon}{label}</div>
            <div className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{value}</div>
        </div>
    )
}

function DetailSectionTitle({ icon, title }: {
    icon: ReactNode
    title: string
}) {
    return <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">{icon}{title}</div>
}

function DetailLine({ label, value, mono, danger }: {
    label: string
    value: string
    mono?: boolean
    danger?: boolean
}) {
    return (
        <div>
            <div className="text-xs text-gray-400">{label}</div>
            <div className={cn('mt-1 break-all text-sm text-gray-700 dark:text-gray-200', mono && 'font-mono text-xs', danger && 'text-rose-500 dark:text-rose-300')}>{value}</div>
        </div>
    )
}

function ProxyEditorModal({ open, proxy, draft, setDraft, groups, tags, saving, onOpenChange, onSave }: {
    open: boolean
    proxy: ProxyPoolItem | null
    draft: ProxyPayload
    setDraft: (value: ProxyPayload) => void
    groups: ProxyGroup[]
    tags: ProxyTag[]
    saving: boolean
    onOpenChange: (open: boolean) => void
    onSave: () => void
}) {
    const toggleTag = (id: number) => {
        const current = draft.tagIds || []
        setDraft({
            ...draft,
            tagIds: current.includes(id) ? current.filter(item => item !== id) : [...current, id],
        })
    }

    return (
        <Modal open={open} onOpenChange={onOpenChange}>
            <ModalContent size="2xl">
                <ModalHeader>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                            <Pencil className="h-5 w-5" />
                        </div>
                        <div>
                            <ModalTitle>编辑代理</ModalTitle>
                            <ModalDescription>{proxy ? proxyToUrl(proxy) : '调整代理连接信息、分组、标签和备注'}</ModalDescription>
                        </div>
                    </div>
                </ModalHeader>
                <ModalBody>
                    <div className="grid gap-4 md:grid-cols-[150px_minmax(0,1fr)]">
                        <label className="space-y-1">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">代理类型</span>
                            <select
                                value={draft.type}
                                onChange={(event) => setDraft({ ...draft, type: event.target.value as ProxyType })}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                            >
                                {proxyTypes.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}
                            </select>
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">代理主机</span>
                            <input
                                value={draft.host}
                                onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">端口</span>
                            <input
                                type="number"
                                min={1}
                                max={65535}
                                value={draft.port || ''}
                                onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                            />
                        </label>
                        <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">账号</span>
                                <input
                                    value={draft.username || ''}
                                    onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">密码</span>
                                <input
                                    type="password"
                                    value={draft.password || ''}
                                    onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                />
                            </label>
                        </div>
                        <label className="space-y-1 md:col-span-2">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">刷新 URL</span>
                            <input
                                value={draft.refreshUrl || ''}
                                onChange={(event) => setDraft({ ...draft, refreshUrl: event.target.value })}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">分组</span>
                            <select
                                value={draft.groupId || ''}
                                onChange={(event) => setDraft({ ...draft, groupId: event.target.value ? Number(event.target.value) : undefined })}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                            >
                                <option value="">未分组</option>
                                {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                            </select>
                        </label>
                        <label className="space-y-1">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">使用范围</span>
                            <select
                                value={draft.usageScope || 'shared'}
                                onChange={(event) => setDraft({ ...draft, usageScope: event.target.value })}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                            >
                                <option value="shared">共享</option>
                                <option value="email_account">邮箱账户</option>
                                <option value="reserved">预留</option>
                            </select>
                        </label>
                        <div className="space-y-2 md:col-span-2">
                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">标签</div>
                            <div className="flex flex-wrap gap-2">
                                {tags.length === 0 ? <span className="text-xs text-gray-400">暂无标签</span> : tags.map(tag => (
                                    <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)} className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', draft.tagIds?.includes(tag.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300')}>
                                        <MetaDot color={tag.color} fallback={proxyMetaColors[7]} className="h-2 w-2" />
                                        {tag.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <label className="space-y-1 md:col-span-2">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">备注</span>
                            <textarea
                                rows={3}
                                value={draft.remark || ''}
                                onChange={(event) => setDraft({ ...draft, remark: event.target.value })}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                            />
                        </label>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button onClick={() => onOpenChange(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">取消</button>
                    <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        保存
                    </button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function ProxyMetaManagerModal({ open, onOpenChange, groups, tags, onCreateGroup, onCreateTag, onUpdateGroup, onUpdateTag, onDeleteGroup, onDeleteTag }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    groups: ProxyGroup[]
    tags: ProxyTag[]
    onCreateGroup: (input: string | ProxyMetaDraft) => Promise<ProxyGroup | null>
    onCreateTag: (input: string | ProxyMetaDraft) => Promise<ProxyTag | null>
    onUpdateGroup: (group: ProxyGroup, draft: ProxyMetaDraft) => Promise<ProxyGroup | null>
    onUpdateTag: (tag: ProxyTag, draft: ProxyMetaDraft) => Promise<ProxyTag | null>
    onDeleteGroup: (group: ProxyGroup) => void
    onDeleteTag: (tag: ProxyTag) => void
}) {
    const [groupDraft, setGroupDraft] = useState<ProxyMetaDraft>({ name: '', color: proxyMetaColors[0] })
    const [tagDraft, setTagDraft] = useState<ProxyMetaDraft>({ name: '', color: proxyMetaColors[7] })

    const createGroupFromDraft = async () => {
        const created = await onCreateGroup(groupDraft)
        if (created) setGroupDraft({ name: '', color: groupDraft.color || proxyMetaColors[0] })
    }
    const createTagFromDraft = async () => {
        const created = await onCreateTag(tagDraft)
        if (created) setTagDraft({ name: '', color: tagDraft.color || proxyMetaColors[7] })
    }

    return (
        <Modal open={open} onOpenChange={onOpenChange}>
            <ModalContent size="6xl" className="h-[82vh] overflow-hidden">
                <ModalHeader>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
                            <Settings2 className="h-5 w-5" />
                        </div>
                        <div>
                            <ModalTitle>代理分组与标签</ModalTitle>
                            <ModalDescription>集中管理代理池的分组、标签和显示颜色，保存后会立即同步到筛选器和批量新增面板。</ModalDescription>
                        </div>
                    </div>
                </ModalHeader>
                <ModalBody className="min-h-0 p-0">
                    <div className="grid h-full min-h-0 divide-y divide-gray-200 dark:divide-gray-700 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                        <ProxyMetaColumn
                            title="代理分组"
                            description="用于按业务、地区或供应商归类代理。删除分组不会删除代理，代理会回到未分组状态。"
                            icon={<FolderOpen className="h-4 w-4" />}
                            accent="primary"
                            emptyText="暂无分组"
                            createLabel="新建分组"
                            placeholder="例如：Gmail 美国区"
                            items={groups}
                            draft={groupDraft}
                            setDraft={setGroupDraft}
                            onCreate={createGroupFromDraft}
                            onUpdate={onUpdateGroup}
                            onDelete={onDeleteGroup}
                        />
                        <ProxyMetaColumn
                            title="代理标签"
                            description="用于给代理追加多个属性，自动匹配时可选择任一标签或全部标签。删除标签会从代理上移除。"
                            icon={<Tag className="h-4 w-4" />}
                            accent="emerald"
                            emptyText="暂无标签"
                            createLabel="新建标签"
                            placeholder="例如：高信誉 / Outlook"
                            items={tags}
                            draft={tagDraft}
                            setDraft={setTagDraft}
                            onCreate={createTagFromDraft}
                            onUpdate={onUpdateTag}
                            onDelete={onDeleteTag}
                        />
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button onClick={() => onOpenChange(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">完成</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function ProxyMetaColumn<T extends ProxyGroup | ProxyTag>({ title, description, icon, accent, emptyText, createLabel, placeholder, items, draft, setDraft, onCreate, onUpdate, onDelete }: {
    title: string
    description: string
    icon: ReactNode
    accent: 'primary' | 'emerald'
    emptyText: string
    createLabel: string
    placeholder: string
    items: T[]
    draft: ProxyMetaDraft
    setDraft: (draft: ProxyMetaDraft) => void
    onCreate: () => void | Promise<void>
    onUpdate: (item: T, draft: ProxyMetaDraft) => Promise<T | null>
    onDelete: (item: T) => void | Promise<void>
}) {
    const [searchValue, setSearchValue] = useState('')
    const [editingId, setEditingId] = useState<number | null>(null)
    const [editingDraft, setEditingDraft] = useState<ProxyMetaDraft>({ name: '' })
    const [creating, setCreating] = useState(false)
    const [savingId, setSavingId] = useState<number | null>(null)
    const [deletingId, setDeletingId] = useState<number | null>(null)
    const filteredItems = useMemo(() => {
        const keyword = searchValue.trim().toLowerCase()
        if (!keyword) return items
        return items.filter(item => item.name.toLowerCase().includes(keyword))
    }, [items, searchValue])
    const accentClasses = {
        primary: {
            soft: 'bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-200',
            border: 'border-primary-200 dark:border-primary-900',
            button: 'bg-primary-600 hover:bg-primary-700 text-white',
            ghost: 'text-primary-600 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/30',
        },
        emerald: {
            soft: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200',
            border: 'border-emerald-200 dark:border-emerald-900',
            button: 'bg-emerald-600 hover:bg-emerald-700 text-white',
            ghost: 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30',
        },
    }[accent]

    const startEditing = (item: T) => {
        setEditingId(item.id)
        setEditingDraft({
            name: item.name,
            color: item.color || draft.color || proxyMetaColors[0],
            description: 'description' in item ? item.description : undefined,
            sortOrder: item.sortOrder || 0,
        })
    }
    const createItem = async () => {
        if (!draft.name.trim() || creating) return
        setCreating(true)
        try {
            await onCreate()
        } finally {
            setCreating(false)
        }
    }
    const saveEditing = async (item: T) => {
        if (savingId) return
        setSavingId(item.id)
        try {
            const updated = await onUpdate(item, editingDraft)
            if (updated) {
                setEditingId(null)
                setEditingDraft({ name: '' })
            }
        } finally {
            setSavingId(null)
        }
    }
    const deleteItem = async (item: T) => {
        if (deletingId) return
        setDeletingId(item.id)
        try {
            await onDelete(item)
        } finally {
            setDeletingId(null)
        }
    }

    return (
        <section className="flex min-h-0 flex-col">
            <div className="border-b border-gray-200 p-5 dark:border-gray-700">
                <div className="flex items-start gap-3">
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', accentClasses.soft)}>
                        {icon}
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
                            <span className={cn('rounded-full px-2 py-0.5 text-xs', accentClasses.soft)}>{items.length}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</p>
                    </div>
                </div>
                <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                            value={draft.name}
                            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    createItem()
                                }
                            }}
                            placeholder={placeholder}
                            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                        />
                        <button onClick={createItem} disabled={!draft.name.trim() || creating} className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50', accentClasses.button)}>
                            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            {createLabel}
                        </button>
                    </div>
                    <MetaColorPicker value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
                </div>
                <div className="relative mt-4">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <input
                        value={searchValue}
                        onChange={(event) => setSearchValue(event.target.value)}
                        placeholder={`搜索${title}`}
                        className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                    />
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">
                {filteredItems.length === 0 ? (
                    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-700">
                        {emptyText}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filteredItems.map(item => {
                            const isEditing = editingId === item.id
                            return (
                                <div key={item.id} className={cn('rounded-lg border bg-white p-3 transition-colors dark:bg-gray-900', isEditing ? accentClasses.border : 'border-gray-200 dark:border-gray-700')}>
                                    {isEditing ? (
                                        <div className="space-y-3">
                                            <input
                                                value={editingDraft.name}
                                                onChange={(event) => setEditingDraft({ ...editingDraft, name: event.target.value })}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault()
                                                        saveEditing(item)
                                                    }
                                                }}
                                                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                            />
                                            <MetaColorPicker value={editingDraft.color} onChange={(color) => setEditingDraft({ ...editingDraft, color })} compact />
                                            <div className="flex justify-end gap-2">
                                                <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                                    <X className="h-3.5 w-3.5" />
                                                    取消
                                                </button>
                                                <button onClick={() => saveEditing(item)} disabled={savingId === item.id} className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50', accentClasses.button)}>
                                                    {savingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                                    保存
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3">
                                            <span className="h-3 w-3 shrink-0 rounded-full border border-white shadow-sm dark:border-gray-800" style={{ backgroundColor: item.color || (accent === 'primary' ? proxyMetaColors[0] : proxyMetaColors[7]) }} />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{item.name}</div>
                                                <div className="mt-0.5 text-xs text-gray-400">#{item.id}{item.sortOrder ? ` · 排序 ${item.sortOrder}` : ''}</div>
                                            </div>
                                            <button onClick={() => startEditing(item)} title="编辑" className={cn('rounded-lg p-2', accentClasses.ghost)}>
                                                <Pencil className="h-4 w-4" />
                                            </button>
                                            <button onClick={() => deleteItem(item)} disabled={deletingId === item.id} title="删除" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/30">
                                                {deletingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </section>
    )
}

function MetaColorPicker({ value, onChange, compact = false }: {
    value?: string
    onChange: (color: string) => void
    compact?: boolean
}) {
    return (
        <div className={cn('flex flex-wrap items-center gap-2', compact ? 'gap-1.5' : '')}>
            {proxyMetaColors.map(color => (
                <button
                    key={color}
                    type="button"
                    onClick={() => onChange(color)}
                    title={color}
                    className={cn('rounded-full border-2 transition-transform hover:scale-110', compact ? 'h-5 w-5' : 'h-6 w-6', value === color ? 'border-gray-900 dark:border-white' : 'border-white dark:border-gray-800')}
                    style={{ backgroundColor: color }}
                />
            ))}
            <input
                value={value || ''}
                onChange={(event) => onChange(event.target.value)}
                placeholder="#3b82f6"
                className={cn('rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono text-xs dark:border-gray-700 dark:bg-gray-900', compact ? 'w-24' : 'w-28')}
            />
        </div>
    )
}

function CheckResultPanel({ results }: { results: ProxyCheckResult[] }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">最近检测结果</h3>
            <div className="max-h-[360px] space-y-2 overflow-auto">
                {results.length === 0 ? <div className="text-sm text-gray-400">暂无检测结果</div> : results.map((result, index) => (
                    <div key={`${result.proxyId}-${index}`} className="rounded-lg border border-gray-100 p-3 text-xs dark:border-gray-800">
                        <div className="flex items-center justify-between">
                            <span className={result.success ? 'text-emerald-600' : 'text-rose-600'}>{result.success ? '可用' : '不可用'}</span>
                            <span className="text-gray-400">{result.latencyMs}ms</span>
                        </div>
                        <div className="mt-1 text-gray-600 dark:text-gray-300">#{result.proxyId} {result.exitIp || result.error || '-'}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}
