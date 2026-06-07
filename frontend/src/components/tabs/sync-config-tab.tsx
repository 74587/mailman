'use client'

import { Fragment, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import SyncConfigModal from '@/components/modals/sync-config-modal'
import BatchSyncConfigModal from '@/components/modals/batch-sync-config-modal'
import SyncConfigBulkOperationModal from '@/components/modals/sync-config-bulk-operation-modal'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
    Search,
    RefreshCw,
    Settings,
    Play,
    ChevronLeft,
    ChevronRight,
    Mail,
    AlertCircle,
    Plus,
    Edit,
    Trash2,
    Users,
    Activity,
    Timer,
    Pause,
    SlidersHorizontal,
    Eye,
    Info,
    Database,
    History,
    AlertTriangle
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface SyncConfig {
    id: number
    account_id: number
    enable_auto_sync: boolean
    sync_interval: number
    sync_folders: string[]
    last_sync_time?: string
    last_sync_error?: string
    sync_status: string
    created_at: string
    updated_at: string
    auto_disabled?: boolean
    disable_reason?: string
    consecutive_errors?: number
    last_sync_end_time?: string
    last_error_time?: string
    recovery_attempts?: number
    last_recovery_attempt?: string
}

interface Account {
    id: number
    emailAddress: string
    name?: string
    authType?: string
    mailProviderId?: number
    mailProvider?: {
        id: number
        name: string
        type: string
        imapServer: string
        imapPort: number
    }
}

interface SyncConfigWithAccount extends SyncConfig {
    account: Account
}

interface GlobalSyncConfig {
    default_enable_sync: boolean
    default_sync_interval: number
    default_sync_folders: string[]
    max_sync_workers: number
    max_emails_per_sync: number
}

interface PaginatedResponse {
    configs: SyncConfigWithAccount[]
    total_count: number
    page: number
    limit: number
    total_pages: number
    has_next: boolean
    has_previous: boolean
    stats?: {
        total: number
        active: number
        syncing: number
        errors: number
        disabled: number
    }
}

interface SyncRun {
    id: number
    source: string
    status: string
    started_at: string
    finished_at?: string
    duration_ms: number
    emails_fetched: number
    new_emails: number
    error_message?: string
}

interface SyncCursor {
    provider: string
    mailbox_name: string
    last_sync_time?: string
    last_sync_end_time?: string
    last_history_id?: string
    last_message_id?: string
}

interface SyncDiagnostics {
    account_id: number
    enable_auto_sync: boolean
    sync_interval: number
    sync_folders: string[]
    sync_status: string
    auto_disabled: boolean
    disable_reason?: string
    consecutive_errors: number
    last_sync_time?: string
    last_sync_end_time?: string
    last_sync_error?: string
    last_error_time?: string
    recovery_attempts?: number
    last_recovery_attempt?: string
    recent_runs: SyncRun[]
    cursors?: Record<string, SyncCursor>
}

function MiniStatCard({
    label,
    value,
    icon: Icon,
    variant = 'default',
    active = false,
    onClick
}: {
    label: string
    value: string | number
    icon: any
    variant?: 'default' | 'success' | 'warning' | 'danger'
    active?: boolean
    onClick?: () => void
}) {
    const variantClasses = {
        default: 'text-gray-700 dark:text-gray-300',
        success: 'text-green-600 dark:text-green-400',
        warning: 'text-yellow-600 dark:text-yellow-400',
        danger: 'text-red-600 dark:text-red-400'
    }

    const iconBgClasses = {
        default: 'bg-gray-100 dark:bg-gray-800',
        success: 'bg-green-50 dark:bg-green-900/20',
        warning: 'bg-yellow-50 dark:bg-yellow-900/20',
        danger: 'bg-red-50 dark:bg-red-900/20'
    }

    const content = (
        <>
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-md', iconBgClasses[variant])}>
                <Icon className={cn('w-4 h-4', variantClasses[variant])} />
            </span>
            <span className="min-w-0">
                <span className="block text-xs text-gray-500 dark:text-gray-400">{label}</span>
                <span className={cn('block text-xl font-semibold leading-6', variantClasses[variant])}>{value}</span>
            </span>
            {active && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary-500" />}
        </>
    )

    const className = cn(
        'relative flex min-h-[72px] items-center gap-3 rounded-lg border bg-white px-4 py-3 transition-colors dark:border-gray-800 dark:bg-gray-900',
        active ? 'border-primary-300 shadow-sm dark:border-primary-700' : 'border-gray-200',
        onClick && 'w-full text-left hover:border-gray-300 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-800/70'
    )

    if (onClick) {
        return (
            <button type="button" className={className} onClick={onClick}>
                {content}
            </button>
        )
    }

    return <div className={className}>{content}</div>
}

export default function SyncConfigTab() {
    const { confirm } = useConfirmDialog()
    const [configs, setConfigs] = useState<SyncConfigWithAccount[]>([])
    const [globalConfig, setGlobalConfig] = useState<GlobalSyncConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState<Map<number, boolean>>(new Map())
    const [accounts, setAccounts] = useState<Account[]>([])

    // 分页和搜索状态
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(10)
    const [totalPages, setTotalPages] = useState(1)
    const [totalCount, setTotalCount] = useState(0)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [filterEnabled, setFilterEnabled] = useState<string>('all')

    // 统计数据 (从API获取)
    const [syncStats, setSyncStats] = useState<{
        total: number
        active: number
        syncing: number
        errors: number
        disabled: number
    }>({ total: 0, active: 0, syncing: 0, errors: 0, disabled: 0 })

    // 模态框状态
    const [modalOpen, setModalOpen] = useState(false)
    const [modalMode, setModalMode] = useState<'create' | 'edit' | 'global'>('create')
    const [editingConfig, setEditingConfig] = useState<SyncConfigWithAccount | null>(null)

    // 批量操作状态
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [batchModalOpen, setBatchModalOpen] = useState(false)
    const [bulkOperationOpen, setBulkOperationOpen] = useState(false)
    const [expandedAccountId, setExpandedAccountId] = useState<number | null>(null)
    const [diagnosticsByAccount, setDiagnosticsByAccount] = useState<Record<number, SyncDiagnostics>>({})
    const [loadingDiagnostics, setLoadingDiagnostics] = useState<Set<number>>(new Set())

    useEffect(() => {
        loadData()
    }, [currentPage, pageSize, searchQuery, filterStatus, filterEnabled])

    const loadData = async () => {
        try {
            setLoading(true)

            const params = new URLSearchParams({
                page: currentPage.toString(),
                limit: pageSize.toString()
            })

            if (searchQuery) {
                params.append('search', searchQuery)
            }

            if (filterStatus !== 'all') {
                params.append('status', filterStatus)
            }

            if (filterEnabled !== 'all') {
                params.append('enabled', filterEnabled)
            }

            const response = await apiClient.get(`/sync/configs?${params}`)
            const data: PaginatedResponse = response.data || response

            // 所有筛选都在后端完成，直接使用返回的数据
            setConfigs(data.configs || [])
            setTotalPages(data.total_pages || 1)
            setTotalCount(data.total_count || 0)

            // 设置统计数据
            if (data.stats) {
                setSyncStats({
                    total: data.stats.total || 0,
                    active: data.stats.active || 0,
                    syncing: data.stats.syncing || 0,
                    errors: data.stats.errors || 0,
                    disabled: data.stats.disabled || 0
                })
            }

            // 加载全局配置
            const globalRes = await apiClient.get('/sync/global-config')
            const globalData = globalRes.data || globalRes
            setGlobalConfig(globalData)

            // 加载所有账户
            const accountsRes = await apiClient.get('/accounts')
            const accountsData = accountsRes.data || accountsRes
            setAccounts(accountsData.accounts || [])
        } catch (error) {
            console.error('Failed to load sync configs:', error)
            toast.error('加载同步配置失败')
        } finally {
            setLoading(false)
        }
    }

    const handleSearch = useCallback((value: string) => {
        setSearchQuery(value)
        setCurrentPage(1)
    }, [])

    const handleFilterChange = (value: string) => {
        setFilterStatus(value)
        setCurrentPage(1)
    }

    const handleEnabledFilterChange = (value: string) => {
        setFilterEnabled(value)
        setCurrentPage(1)
    }

    const applyQuickFilter = (status: string, enabled: string) => {
        setFilterStatus(status)
        setFilterEnabled(enabled)
        setCurrentPage(1)
    }

    const clearFilters = () => {
        setSearchQuery('')
        setFilterStatus('all')
        setFilterEnabled('all')
        setCurrentPage(1)
    }

    const handlePageChange = (page: number) => {
        setCurrentPage(page)
    }

    const handlePageSizeChange = (size: string) => {
        setPageSize(parseInt(size))
        setCurrentPage(1)
    }

    const handleSyncNow = async (accountId: number) => {
        try {
            setSyncing(new Map(syncing.set(accountId, true)))

            const response = await apiClient.post(`/accounts/${accountId}/sync-now`)
            const result = response.data || response

            if (result.success) {
                toast.success(`同步完成：已同步 ${result.emails_synced} 封邮件`)
            } else {
                toast.error(`同步失败：${result.error || '未知错误'}`)
            }

            await loadData()
        } catch (error) {
            console.error('Sync failed:', error)
            toast.error('同步失败')
        } finally {
            setSyncing(new Map(syncing.set(accountId, false)))
        }
    }

    const loadAccountDiagnostics = async (accountId: number, force = false) => {
        if (!force && diagnosticsByAccount[accountId]) {
            return
        }

        setLoadingDiagnostics(prev => new Set(prev).add(accountId))
        try {
            const response = await apiClient.get(`/accounts/${accountId}/sync-statistics`)
            const data: SyncDiagnostics = response.data || response
            setDiagnosticsByAccount(prev => ({ ...prev, [accountId]: data }))
        } catch (error) {
            console.error('Failed to load sync diagnostics:', error)
            toast.error('加载同步诊断失败')
        } finally {
            setLoadingDiagnostics(prev => {
                const next = new Set(prev)
                next.delete(accountId)
                return next
            })
        }
    }

    const toggleDiagnostics = async (accountId: number) => {
        if (expandedAccountId === accountId) {
            setExpandedAccountId(null)
            return
        }

        setExpandedAccountId(accountId)
        await loadAccountDiagnostics(accountId)
    }

    const handleDeleteConfig = async (accountId: number) => {
        const confirmed = await confirm({
            title: '删除同步配置',
            description: '确定要删除此同步配置吗？',
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return

        try {
            await apiClient.delete(`/accounts/${accountId}/sync-config`)
            toast.success('同步配置已删除')
            await loadData()
        } catch (error) {
            console.error('Failed to delete config:', error)
            toast.error('删除配置失败')
        }
    }

    const handleToggleSync = async (config: SyncConfigWithAccount) => {
        try {
            await apiClient.put(`/accounts/${config.account_id}/sync-config`, {
                enable_auto_sync: !config.enable_auto_sync,
                sync_interval: config.sync_interval
            })
            toast.success(config.enable_auto_sync ? '已暂停同步' : '已启用同步')
            await loadData()
        } catch (error) {
            console.error('Failed to toggle sync:', error)
            toast.error('操作失败')
        }
    }

    // 批量选择相关
    const handleSelectAll = () => {
        if (selectedIds.size === configs.length) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(configs.map(c => c.account_id)))
        }
    }

    const handleSelectOne = (accountId: number) => {
        const newSelected = new Set(selectedIds)
        if (newSelected.has(accountId)) {
            newSelected.delete(accountId)
        } else {
            newSelected.add(accountId)
        }
        setSelectedIds(newSelected)
    }

    const handleBatchToggle = async (enable: boolean) => {
        if (selectedIds.size === 0) {
            toast.error('请先选择账户')
            return
        }

        try {
            const promises = Array.from(selectedIds).map(accountId => {
                const config = configs.find(c => c.account_id === accountId)
                if (config) {
                    return apiClient.put(`/accounts/${accountId}/sync-config`, {
                        enable_auto_sync: enable,
                        sync_interval: config.sync_interval
                    })
                }
                return Promise.resolve()
            })

            await Promise.all(promises)
            toast.success(`已${enable ? '启用' : '暂停'} ${selectedIds.size} 个账户的同步`)
            setSelectedIds(new Set())
            await loadData()
        } catch (error) {
            console.error('Batch toggle failed:', error)
            toast.error('批量操作失败')
        }
    }

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) {
            toast.error('请先选择账户')
            return
        }

        const confirmed = await confirm({
            title: '批量删除同步配置',
            description: `确定要删除选中的 ${selectedIds.size} 个同步配置吗？`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return

        try {
            const promises = Array.from(selectedIds).map(accountId => apiClient.delete(`/accounts/${accountId}/sync-config`))

            await Promise.all(promises)
            toast.success(`已删除 ${selectedIds.size} 个同步配置`)
            setSelectedIds(new Set())
            await loadData()
        } catch (error) {
            console.error('Batch delete failed:', error)
            toast.error('批量删除失败')
        }
    }

    const openModal = (mode: 'create' | 'edit' | 'global', config?: SyncConfigWithAccount) => {
        setModalMode(mode)
        setEditingConfig(config || null)
        setModalOpen(true)
    }

    const closeModal = () => {
        setModalOpen(false)
        setEditingConfig(null)
    }

    const formatSyncStatus = (config: SyncConfigWithAccount) => {
        if (config.auto_disabled) {
            return (
                <span className="inline-flex min-w-[76px] items-center justify-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    自动禁用
                </span>
            )
        }

        switch (config.sync_status) {
            case 'idle':
                return (
                    <span className="inline-flex min-w-[76px] items-center justify-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        正常
                    </span>
                )
            case 'syncing':
                return (
                    <span className="inline-flex min-w-[76px] items-center justify-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        同步中
                    </span>
                )
            case 'error':
                return (
                    <span className="inline-flex min-w-[76px] items-center justify-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        错误
                    </span>
                )
            default:
                return <Badge variant="outline">{config.sync_status}</Badge>
        }
    }

    const formatLastSyncTime = (time?: string) => {
        if (!time) return <span className="text-gray-400">从未同步</span>

        const date = new Date(time)
        const now = new Date()
        const diff = now.getTime() - date.getTime()

        if (diff < 60000) return <span className="text-green-600 dark:text-green-400">刚刚</span>
        if (diff < 3600000) return <span className="text-green-600 dark:text-green-400">{Math.floor(diff / 60000)} 分钟前</span>
        if (diff < 86400000) return <span className="text-yellow-600 dark:text-yellow-400">{Math.floor(diff / 3600000)} 小时前</span>

        return <span className="text-gray-500">{date.toLocaleDateString('zh-CN')}</span>
    }

    const formatDateTime = (time?: string) => {
        if (!time) return '暂无'
        const date = new Date(time)
        if (Number.isNaN(date.getTime())) return '暂无'
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
    }

    const formatTimeOfDay = (time?: string) => {
        if (!time) return ''
        const date = new Date(time)
        if (Number.isNaN(date.getTime())) return ''
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })
    }

    const formatInterval = (seconds: number) => {
        if (seconds < 60) return `${seconds}秒`
        if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
        return `${Math.floor(seconds / 3600)}小时`
    }

    const formatDuration = (durationMs?: number) => {
        if (!durationMs || durationMs <= 0) return '-'
        if (durationMs < 1000) return `${durationMs}ms`
        return `${(durationMs / 1000).toFixed(1)}s`
    }

    const formatRunSource = (source: string) => {
        switch (source) {
            case 'auto_sync':
                return '自动'
            case 'manual_sync':
                return '手动'
            case 'pickup':
                return '取件'
            default:
                return source || '未知'
        }
    }

    const formatRunStatus = (status: string) => {
        switch (status) {
            case 'success':
                return <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">成功</Badge>
            case 'failed':
                return <Badge variant="destructive">失败</Badge>
            case 'running':
                return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">运行中</Badge>
            default:
                return <Badge variant="outline">{status || '未知'}</Badge>
        }
    }

    const getIntervalWarning = (seconds: number) => {
        if (seconds <= 5) return '高频'
        if (seconds <= 15) return '偏高'
        return ''
    }

    const hasActiveFilters = Boolean(searchQuery || filterStatus !== 'all' || filterEnabled !== 'all')

    // 获取没有同步配置的账户
    const accountsWithoutConfig = accounts.filter(account => !configs.some(config => config.account_id === account.id))

    // 转换选中的账户ID为账户对象 (用于批量配置)
    // 从configs中获取账户信息，并转换为EmailAccount类型
    const selectedAccounts = configs
        .filter(c => selectedIds.has(c.account_id))
        .map(c => ({
            id: c.account.id,
            emailAddress: c.account.emailAddress,
            authType: (c.account.authType || 'password') as 'password' | 'oauth2' | 'app_password',
            mailProviderId: c.account.mailProviderId || 0,
            mailProvider: c.account.mailProvider
                ? {
                      id: c.account.mailProvider.id,
                      name: c.account.mailProvider.name,
                      type: c.account.mailProvider.type,
                      imapServer: c.account.mailProvider.imapServer,
                      imapPort: c.account.mailProvider.imapPort,
                      smtpServer: '',
                      smtpPort: 0,
                      createdAt: '',
                      updatedAt: ''
                  }
                : undefined,
            isDomainMail: false,
            createdAt: '',
            updatedAt: ''
        }))

    const renderDiagnostics = (config: SyncConfigWithAccount) => {
        const diagnostics = diagnosticsByAccount[config.account_id]
        const isLoading = loadingDiagnostics.has(config.account_id)
        const cursors = diagnostics?.cursors ? Object.values(diagnostics.cursors) : []
        const runs = diagnostics?.recent_runs || []

        if (isLoading && !diagnostics) {
            return (
                <div className="flex items-center gap-2 px-4 py-5 text-sm text-gray-500">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    加载诊断信息...
                </div>
            )
        }

        const errorMessage = diagnostics?.disable_reason || config.disable_reason || diagnostics?.last_sync_error || config.last_sync_error

        return (
            <div className="bg-gray-50/70 px-6 py-5 dark:bg-gray-900/40">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                            <Info className="h-4 w-4 text-primary-600" />
                            诊断详情
                            <span className="text-xs font-normal text-gray-400">{config.account.emailAddress}</span>
                        </div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-8 self-start text-gray-500 sm:self-auto" onClick={() => loadAccountDiagnostics(config.account_id, true)} disabled={isLoading}>
                        <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isLoading && 'animate-spin')} />
                        更新
                    </Button>
                </div>

                {errorMessage && (
                    <div className="mb-4 flex gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                        <span className="break-words">{errorMessage}</span>
                    </div>
                )}

                <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
                    <div>
                        <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">配置状态</div>
                        <dl className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white text-sm dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
                            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                                <dt className="text-gray-500">自动同步</dt>
                                <dd className="font-medium text-gray-900 dark:text-white">{config.enable_auto_sync ? '已启用' : '已暂停'}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                                <dt className="text-gray-500">同步间隔</dt>
                                <dd className="font-medium text-gray-900 dark:text-white">
                                    {formatInterval(config.sync_interval)}
                                    {getIntervalWarning(config.sync_interval) && (
                                        <span className="ml-2 text-xs font-normal text-yellow-600 dark:text-yellow-400">{getIntervalWarning(config.sync_interval)}</span>
                                    )}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                                <dt className="text-gray-500">连续错误</dt>
                                <dd className="font-medium text-gray-900 dark:text-white">{diagnostics?.consecutive_errors ?? config.consecutive_errors ?? 0}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
                                <dt className="text-gray-500">恢复尝试</dt>
                                <dd className="font-medium text-gray-900 dark:text-white">{diagnostics?.recovery_attempts ?? config.recovery_attempts ?? 0}</dd>
                            </div>
                        </dl>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
                        <div>
                            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                                <History className="h-3.5 w-3.5" />
                                最近执行
                            </div>
                            <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                                {runs.length > 0 ? (
                                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {runs.slice(0, 4).map(run => (
                                            <div key={run.id} className="grid grid-cols-[74px_1fr_auto] items-center gap-3 px-3 py-2.5 text-xs">
                                                {formatRunStatus(run.status)}
                                                <div className="min-w-0">
                                                    <div className="truncate text-gray-900 dark:text-white">
                                                        {formatRunSource(run.source)} · {formatDateTime(run.started_at)}
                                                    </div>
                                                    {run.error_message && <div className="mt-0.5 truncate text-red-500">{run.error_message}</div>}
                                                </div>
                                                <div className="text-right text-gray-500">
                                                    <div>
                                                        {run.new_emails}/{run.emails_fetched}
                                                    </div>
                                                    <div>{formatDuration(run.duration_ms)}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="px-3 py-8 text-center text-xs text-gray-500">暂无执行记录</div>
                                )}
                            </div>
                        </div>

                        <div>
                            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                                <Database className="h-3.5 w-3.5" />
                                同步游标
                            </div>
                            <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                                {cursors.length > 0 ? (
                                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {cursors.map(cursor => (
                                            <div key={`${cursor.provider}:${cursor.mailbox_name}`} className="px-3 py-2.5 text-xs">
                                                <div className="mb-1 flex items-center justify-between gap-2">
                                                    <span className="font-medium text-gray-900 dark:text-white">{cursor.provider}</span>
                                                    <span className="text-gray-500">{cursor.mailbox_name}</span>
                                                </div>
                                                <div className="text-gray-500">结束 {formatDateTime(cursor.last_sync_end_time)}</div>
                                                {cursor.last_history_id && <div className="mt-1 truncate text-gray-400">History ID {cursor.last_history_id}</div>}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="px-3 py-8 text-center text-xs text-gray-500">暂无游标</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (loading && configs.length === 0) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"></div>
                    <p className="text-gray-500 dark:text-gray-400">加载中...</p>
                </div>
            </div>
        )
    }

    return (
        <TooltipProvider delayDuration={300}>
            <div className="space-y-5">
                {/* 页面标题和操作栏 - 紧凑布局 */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/20">
                            <RefreshCw className="h-4 w-4" />
                        </span>
                        <div>
                            <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">同步配置管理</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                                {totalCount} 个配置 · {syncStats.active} 个启用 · {syncStats.errors} 个异常
                            </p>
                        </div>
                    </div>

                    {/* 右侧操作按钮组 */}
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setBulkOperationOpen(true)} className="text-gray-600 dark:text-gray-300">
                            <SlidersHorizontal className="w-4 h-4 mr-1.5" />
                            批量操作
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openModal('global')} className="text-gray-600 dark:text-gray-300">
                            <Settings className="w-4 h-4 mr-1.5" />
                            全局设置
                        </Button>
                        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-1.5', loading && 'animate-spin')} />
                            刷新
                        </Button>
                        {accountsWithoutConfig.length > 0 && (
                            <Button size="sm" onClick={() => openModal('create')} className="bg-primary-600 hover:bg-primary-700">
                                <Plus className="w-4 h-4 mr-1.5" />
                                新增配置
                            </Button>
                        )}
                    </div>
                </div>

                {/* 统计条 - 紧凑的横向排列 */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <MiniStatCard
                        label="配置账户"
                        value={syncStats.total}
                        icon={Users}
                        variant="default"
                        active={filterStatus === 'all' && filterEnabled === 'all' && !searchQuery}
                        onClick={() => applyQuickFilter('all', 'all')}
                    />
                    <MiniStatCard label="启用同步" value={syncStats.active} icon={Activity} variant="success" active={filterEnabled === 'enabled'} onClick={() => applyQuickFilter('all', 'enabled')} />
                    <MiniStatCard label="同步中" value={syncStats.syncing} icon={RefreshCw} variant="default" active={filterStatus === 'syncing'} onClick={() => applyQuickFilter('syncing', 'all')} />
                    <MiniStatCard
                        label="异常账户"
                        value={syncStats.errors}
                        icon={AlertCircle}
                        variant="danger"
                        active={filterStatus === 'abnormal'}
                        onClick={() => applyQuickFilter('abnormal', 'all')}
                    />
                </div>

                {/* 搜索和筛选栏 - 整合到一行 */}
                <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center">
                    {/* 搜索框 */}
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <Input
                            placeholder="搜索邮箱地址..."
                            value={searchQuery}
                            onChange={e => handleSearch(e.target.value)}
                            className="h-9 border-gray-200 bg-gray-50 pl-9 dark:border-gray-700 dark:bg-gray-800"
                        />
                    </div>

                    {/* 筛选器组 */}
                    <div className="flex flex-wrap items-center gap-2">
                        <Select value={filterStatus} onValueChange={handleFilterChange}>
                            <SelectTrigger className="w-[110px] h-9">
                                <SelectValue placeholder="状态" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部状态</SelectItem>
                                <SelectItem value="idle">正常</SelectItem>
                                <SelectItem value="syncing">同步中</SelectItem>
                                <SelectItem value="error">错误</SelectItem>
                                <SelectItem value="abnormal">异常</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={filterEnabled} onValueChange={handleEnabledFilterChange}>
                            <SelectTrigger className="w-[120px] h-9">
                                <SelectValue placeholder="启停状态" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部</SelectItem>
                                <SelectItem value="enabled">已启用</SelectItem>
                                <SelectItem value="disabled">已禁用</SelectItem>
                                <SelectItem value="auto_disabled">自动禁用</SelectItem>
                            </SelectContent>
                        </Select>

                        {hasActiveFilters && (
                            <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
                                清除
                            </Button>
                        )}

                        <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                            <SelectTrigger className="w-[90px] h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="10">10条</SelectItem>
                                <SelectItem value="20">20条</SelectItem>
                                <SelectItem value="50">50条</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* 批量操作栏 */}
                {selectedIds.size > 0 && (
                    <div className="flex items-center gap-3 rounded-lg border border-primary-200 bg-white p-3 shadow-sm dark:border-primary-800 dark:bg-gray-900">
                        <span className="text-sm font-medium text-primary-700 dark:text-primary-300">已选择 {selectedIds.size} 项</span>
                        <div className="flex-1" />
                        <Button size="sm" variant="outline" onClick={() => handleBatchToggle(true)}>
                            <Play className="w-3.5 h-3.5 mr-1" />
                            批量启用
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleBatchToggle(false)}>
                            <Pause className="w-3.5 h-3.5 mr-1" />
                            批量暂停
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setBatchModalOpen(true)}>
                            <SlidersHorizontal className="w-3.5 h-3.5 mr-1" />
                            批量配置
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleBatchDelete}>
                            <Trash2 className="w-3.5 h-3.5 mr-1" />
                            批量删除
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                            取消
                        </Button>
                    </div>
                )}

                {/* 同步配置表格 */}
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[960px]">
                            <thead>
                                <tr className="border-b border-gray-200 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-900">
                                    <th className="px-4 py-3 text-left">
                                        <Checkbox checked={selectedIds.size === configs.length && configs.length > 0} onChange={handleSelectAll} />
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">账户</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">状态</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">自动同步</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">间隔</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">上次同步</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {configs.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="text-center py-16">
                                            <div className="flex flex-col items-center gap-3">
                                                <Mail className="w-12 h-12 text-gray-300 dark:text-gray-600" />
                                                <p className="text-gray-500 dark:text-gray-400">暂无同步配置</p>
                                                {accountsWithoutConfig.length > 0 && (
                                                    <Button size="sm" onClick={() => openModal('create')}>
                                                        <Plus className="w-4 h-4 mr-2" />
                                                        新增配置
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    configs.map(config => (
                                        <Fragment key={config.account_id}>
                                            <tr
                                                className={cn(
                                                    'border-b border-gray-100 transition-colors hover:bg-gray-50/80 dark:border-gray-800 dark:hover:bg-gray-800/50',
                                                    selectedIds.has(config.account_id) && 'bg-primary-50/70 dark:bg-primary-900/10',
                                                    expandedAccountId === config.account_id && 'bg-gray-50 dark:bg-gray-800/40'
                                                )}
                                            >
                                                <td className="py-3 px-4">
                                                    <Checkbox checked={selectedIds.has(config.account_id)} onChange={() => handleSelectOne(config.account_id)} />
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-50 text-sm font-semibold text-primary-700 ring-1 ring-primary-100 dark:bg-primary-900/20 dark:text-primary-300 dark:ring-primary-900/40">
                                                            {config.account.emailAddress.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{config.account.emailAddress}</p>
                                                            {config.account.mailProvider && <p className="text-xs text-gray-500 dark:text-gray-400">{config.account.mailProvider.name}</p>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="space-y-1">
                                                        {formatSyncStatus(config)}
                                                        {Boolean(config.consecutive_errors) && (
                                                            <div className="flex items-center gap-1 text-xs text-red-500/90">
                                                                <AlertTriangle className="h-3 w-3" />
                                                                {config.consecutive_errors} 次错误
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-center">
                                                    <Switch
                                                        checked={config.enable_auto_sync && !config.auto_disabled}
                                                        onCheckedChange={() => handleToggleSync(config)}
                                                        disabled={config.auto_disabled}
                                                    />
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                        <Timer className="w-3.5 h-3.5" />
                                                        {formatInterval(config.sync_interval)}
                                                        {getIntervalWarning(config.sync_interval) && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    {getIntervalWarning(config.sync_interval)}
                                                                    同步间隔
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="text-sm">
                                                        {formatLastSyncTime(config.last_sync_time)}
                                                        {config.last_sync_end_time && <div className="text-xs text-gray-400 mt-0.5">完成 {formatTimeOfDay(config.last_sync_end_time)}</div>}
                                                        {config.last_sync_error && (
                                                            <div className="flex items-center gap-1 text-red-500 text-xs mt-0.5" title={config.last_sync_error}>
                                                                <AlertCircle className="w-3 h-3" />
                                                                有错误
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex justify-end items-center gap-1">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className={cn('h-8 w-8 p-0', expandedAccountId === config.account_id && 'bg-gray-100 dark:bg-gray-700')}
                                                                    onClick={() => toggleDiagnostics(config.account_id)}
                                                                >
                                                                    <Eye className="w-4 h-4 text-gray-500" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>查看诊断</TooltipContent>
                                                        </Tooltip>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openModal('edit', config)}>
                                                                    <Edit className="w-4 h-4 text-gray-500" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>编辑配置</TooltipContent>
                                                        </Tooltip>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 p-0"
                                                                    onClick={() => handleSyncNow(config.account_id)}
                                                                    disabled={syncing.get(config.account_id) || config.sync_status === 'syncing'}
                                                                >
                                                                    {syncing.get(config.account_id) || config.sync_status === 'syncing' ? (
                                                                        <RefreshCw className="w-4 h-4 animate-spin text-primary-600" />
                                                                    ) : (
                                                                        <Play className="w-4 h-4 text-green-600" />
                                                                    )}
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>立即同步</TooltipContent>
                                                        </Tooltip>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handleDeleteConfig(config.account_id)}>
                                                                    <Trash2 className="w-4 h-4 text-red-500" />
                                                                </Button>
                                                            </TooltipTrigger>
                                                            <TooltipContent>删除配置</TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                </td>
                                            </tr>
                                            {expandedAccountId === config.account_id && (
                                                <tr className="border-b dark:border-gray-700">
                                                    <td colSpan={7} className="p-0">
                                                        {renderDiagnostics(config)}
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* 分页控件 */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t dark:border-gray-700">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                第 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, totalCount)} 条，共 {totalCount} 条
                            </p>
                            <div className="flex items-center gap-1">
                                <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="h-8">
                                    <ChevronLeft className="w-4 h-4" />
                                </Button>
                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    let pageNum: number
                                    if (totalPages <= 5) {
                                        pageNum = i + 1
                                    } else if (currentPage <= 3) {
                                        pageNum = i + 1
                                    } else if (currentPage >= totalPages - 2) {
                                        pageNum = totalPages - 4 + i
                                    } else {
                                        pageNum = currentPage - 2 + i
                                    }

                                    return (
                                        <Button key={pageNum} variant={currentPage === pageNum ? 'default' : 'outline'} size="sm" onClick={() => handlePageChange(pageNum)} className="h-8 w-8 p-0">
                                            {pageNum}
                                        </Button>
                                    )
                                })}
                                <Button variant="outline" size="sm" onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="h-8">
                                    <ChevronRight className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* 同步配置模态框 */}
                <SyncConfigModal
                    isOpen={modalOpen}
                    onClose={closeModal}
                    onSuccess={loadData}
                    config={editingConfig || undefined}
                    mode={modalMode}
                    accounts={modalMode === 'create' ? accountsWithoutConfig : accounts}
                />

                {/* 批量配置模态框 */}
                <BatchSyncConfigModal
                    isOpen={batchModalOpen}
                    onClose={() => setBatchModalOpen(false)}
                    onSuccess={() => {
                        setSelectedIds(new Set())
                        loadData()
                    }}
                    selectedAccounts={selectedAccounts}
                />

                <SyncConfigBulkOperationModal
                    isOpen={bulkOperationOpen}
                    onClose={() => setBulkOperationOpen(false)}
                    onSuccess={loadData}
                />
            </div>
        </TooltipProvider>
    )
}
