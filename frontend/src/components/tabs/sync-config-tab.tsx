'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import SyncConfigModal from '@/components/modals/sync-config-modal'
import BatchSyncConfigModal from '@/components/modals/batch-sync-config-modal'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
    Search,
    RefreshCw,
    Settings,
    Play,
    ChevronLeft,
    ChevronRight,
    Clock,
    Mail,
    CheckCircle,
    XCircle,
    AlertCircle,
    Plus,
    Edit,
    Trash2,
    Users,
    Activity,
    Timer,
    Pause,
    SlidersHorizontal,
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

// 紧凑型Mini统计卡片
function MiniStatCard({
    label,
    value,
    icon: Icon,
    variant = 'default'
}: {
    label: string
    value: string | number
    icon: any
    variant?: 'default' | 'success' | 'warning' | 'danger'
}) {
    const variantClasses = {
        default: 'text-gray-600 dark:text-gray-400',
        success: 'text-green-600 dark:text-green-400',
        warning: 'text-yellow-600 dark:text-yellow-400',
        danger: 'text-red-600 dark:text-red-400'
    }

    const bgClasses = {
        default: 'bg-gray-100 dark:bg-gray-700',
        success: 'bg-green-100 dark:bg-green-900/30',
        warning: 'bg-yellow-100 dark:bg-yellow-900/30',
        danger: 'bg-red-100 dark:bg-red-900/30'
    }

    return (
        <div className={cn("flex items-center gap-3 px-4 py-3 rounded-lg", bgClasses[variant])}>
            <Icon className={cn("w-4 h-4", variantClasses[variant])} />
            <div>
                <p className={cn("text-lg font-bold", variantClasses[variant])}>{value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            </div>
        </div>
    )
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
        total: number;
        active: number;
        syncing: number;
        errors: number;
        disabled: number;
    }>({ total: 0, active: 0, syncing: 0, errors: 0, disabled: 0 })

    // 模态框状态
    const [modalOpen, setModalOpen] = useState(false)
    const [modalMode, setModalMode] = useState<'create' | 'edit' | 'global'>('create')
    const [editingConfig, setEditingConfig] = useState<SyncConfigWithAccount | null>(null)

    // 批量操作状态
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [batchModalOpen, setBatchModalOpen] = useState(false)

    useEffect(() => {
        loadData()
    }, [currentPage, pageSize, searchQuery, filterStatus, filterEnabled])

    const loadData = async () => {
        try {
            setLoading(true)

            const params = new URLSearchParams({
                page: currentPage.toString(),
                limit: pageSize.toString(),
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
                    disabled: data.stats.disabled || 0,
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
            const promises = Array.from(selectedIds).map(accountId =>
                apiClient.delete(`/accounts/${accountId}/sync-config`)
            )

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
                <Badge variant="destructive" className="flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />自动禁用
                </Badge>
            )
        }

        switch (config.sync_status) {
            case 'idle':
                return (
                    <Badge variant="secondary" className="flex items-center gap-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <CheckCircle className="w-3 h-3" />正常
                    </Badge>
                )
            case 'syncing':
                return (
                    <Badge variant="default" className="flex items-center gap-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        <RefreshCw className="w-3 h-3 animate-spin" />同步中
                    </Badge>
                )
            case 'error':
                return (
                    <Badge variant="destructive" className="flex items-center gap-1">
                        <XCircle className="w-3 h-3" />错误
                    </Badge>
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

    const formatInterval = (seconds: number) => {
        if (seconds < 60) return `${seconds}秒`
        if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
        return `${Math.floor(seconds / 3600)}小时`
    }

    // 获取没有同步配置的账户
    const accountsWithoutConfig = accounts.filter(
        account => !configs.some(config => config.account_id === account.id)
    )

    // 转换选中的账户ID为账户对象 (用于批量配置)
    // 从configs中获取账户信息，并转换为EmailAccount类型
    const selectedAccounts = configs
        .filter(c => selectedIds.has(c.account_id))
        .map(c => ({
            id: c.account.id,
            emailAddress: c.account.emailAddress,
            authType: (c.account.authType || 'password') as 'password' | 'oauth2' | 'app_password',
            mailProviderId: c.account.mailProviderId || 0,
            mailProvider: c.account.mailProvider ? {
                id: c.account.mailProvider.id,
                name: c.account.mailProvider.name,
                type: c.account.mailProvider.type,
                imapServer: c.account.mailProvider.imapServer,
                imapPort: c.account.mailProvider.imapPort,
                smtpServer: '',
                smtpPort: 0,
                createdAt: '',
                updatedAt: '',
            } : undefined,
            isDomainMail: false,
            createdAt: '',
            updatedAt: '',
        }))

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
        <div className="space-y-4">
            {/* 页面标题和操作栏 - 紧凑布局 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <RefreshCw className="w-5 h-5 text-primary-600" />
                            同步配置管理
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                            管理 {totalCount} 个账户的邮件同步设置
                        </p>
                    </div>
                </div>

                {/* 右侧操作按钮组 */}
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openModal('global')}
                        className="text-gray-600"
                    >
                        <Settings className="w-4 h-4 mr-1.5" />
                        全局设置
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={loadData}
                        disabled={loading}
                    >
                        <RefreshCw className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
                        刷新
                    </Button>
                    {accountsWithoutConfig.length > 0 && (
                        <Button
                            size="sm"
                            onClick={() => openModal('create')}
                            className="bg-primary-600 hover:bg-primary-700"
                        >
                            <Plus className="w-4 h-4 mr-1.5" />
                            新增配置
                        </Button>
                    )}
                </div>
            </div>

            {/* 统计条 - 紧凑的横向排列 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniStatCard label="配置账户" value={syncStats.total} icon={Users} variant="default" />
                <MiniStatCard label="启用同步" value={syncStats.active} icon={Activity} variant="success" />
                <MiniStatCard label="同步中" value={syncStats.syncing} icon={RefreshCw} variant="default" />
                <MiniStatCard label="异常账户" value={syncStats.errors} icon={AlertCircle} variant="danger" />
            </div>



            {/* 搜索和筛选栏 - 整合到一行 */}
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                {/* 搜索框 */}
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                        placeholder="搜索邮箱地址..."
                        value={searchQuery}
                        onChange={(e) => handleSearch(e.target.value)}
                        className="pl-9 h-9 dark:bg-gray-800 dark:border-gray-700"
                    />
                </div>

                {/* 筛选器组 */}
                <div className="flex items-center gap-2">
                    <Select value={filterStatus} onValueChange={handleFilterChange}>
                        <SelectTrigger className="w-[110px] h-9">
                            <SelectValue placeholder="状态" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="idle">正常</SelectItem>
                            <SelectItem value="syncing">同步中</SelectItem>
                            <SelectItem value="error">错误</SelectItem>
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
                <div className="flex items-center gap-3 p-3 bg-primary-50 dark:bg-primary-900/20 rounded-lg border border-primary-200 dark:border-primary-800">
                    <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                        已选择 {selectedIds.size} 项
                    </span>
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
            <Card>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
                                    <th className="py-3 px-4 text-left">
                                        <Checkbox
                                            checked={selectedIds.size === configs.length && configs.length > 0}
                                            onChange={handleSelectAll}
                                        />
                                    </th>
                                    <th className="text-left py-3 px-4 font-medium text-sm text-gray-600 dark:text-gray-300">账户</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm text-gray-600 dark:text-gray-300">状态</th>
                                    <th className="text-center py-3 px-4 font-medium text-sm text-gray-600 dark:text-gray-300">自动同步</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm text-gray-600 dark:text-gray-300">间隔</th>
                                    <th className="text-left py-3 px-4 font-medium text-sm text-gray-600 dark:text-gray-300">上次同步</th>
                                    <th className="text-right py-3 px-4 font-medium text-sm text-gray-600 dark:text-gray-300">操作</th>
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
                                    configs.map((config) => (
                                        <tr
                                            key={config.account_id}
                                            className={cn(
                                                "border-b hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50 transition-colors",
                                                selectedIds.has(config.account_id) && "bg-primary-50 dark:bg-primary-900/10"
                                            )}
                                        >
                                            <td className="py-3 px-4">
                                                <Checkbox
                                                    checked={selectedIds.has(config.account_id)}
                                                    onChange={() => handleSelectOne(config.account_id)}
                                                />
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-medium">
                                                        {config.account.emailAddress.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-sm text-gray-900 dark:text-white">
                                                            {config.account.emailAddress}
                                                        </p>
                                                        {config.account.mailProvider && (
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                                {config.account.mailProvider.name}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                {formatSyncStatus(config)}
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <Switch
                                                    checked={config.enable_auto_sync && !config.auto_disabled}
                                                    onCheckedChange={() => handleToggleSync(config)}
                                                    disabled={config.auto_disabled}
                                                />
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                                                    <Timer className="w-3.5 h-3.5" />
                                                    {formatInterval(config.sync_interval)}
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                <div className="text-sm">
                                                    {formatLastSyncTime(config.last_sync_time)}
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
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-8 w-8 p-0"
                                                        onClick={() => openModal('edit', config)}
                                                        title="编辑配置"
                                                    >
                                                        <Edit className="w-4 h-4 text-gray-500" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-8 w-8 p-0"
                                                        onClick={() => handleSyncNow(config.account_id)}
                                                        disabled={syncing.get(config.account_id) || config.sync_status === 'syncing'}
                                                        title="立即同步"
                                                    >
                                                        {syncing.get(config.account_id) || config.sync_status === 'syncing' ? (
                                                            <RefreshCw className="w-4 h-4 animate-spin text-primary-600" />
                                                        ) : (
                                                            <Play className="w-4 h-4 text-green-600" />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-8 w-8 p-0"
                                                        onClick={() => handleDeleteConfig(config.account_id)}
                                                        title="删除配置"
                                                    >
                                                        <Trash2 className="w-4 h-4 text-red-500" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
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
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(currentPage - 1)}
                                    disabled={currentPage === 1}
                                    className="h-8"
                                >
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
                                        <Button
                                            key={pageNum}
                                            variant={currentPage === pageNum ? 'default' : 'outline'}
                                            size="sm"
                                            onClick={() => handlePageChange(pageNum)}
                                            className="h-8 w-8 p-0"
                                        >
                                            {pageNum}
                                        </Button>
                                    )
                                })}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(currentPage + 1)}
                                    disabled={currentPage === totalPages}
                                    className="h-8"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

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
        </div>
    )
}