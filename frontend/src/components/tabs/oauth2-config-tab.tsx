'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    AlertCircle,
    Check,
    Edit,
    HelpCircle,
    Link,
    Mail,
    Plus,
    RefreshCw,
    Search,
    ShieldCheck,
    Star,
    Trash2,
    Users,
    X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { oauth2Service } from '@/services/oauth2.service'
import { emailAccountService } from '@/services/email-account.service'
import { CreateOAuth2ConfigRequest, EmailAccount, OAuth2GlobalConfig, OAuth2ProviderType } from '@/types'
import OAuth2ConfigModal from '@/components/modals/oauth2-config-modal'
import OAuth2HelpModal from '@/components/modals/oauth2-help-modal'
import { getProviderMetadata } from '@/lib/provider-metadata'
import { ProviderLogo } from '@/components/ui/provider-logo'

type ProviderFilter = 'all' | OAuth2ProviderType
type StatusFilter = 'all' | 'enabled' | 'disabled' | 'default' | 'incomplete'

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: '全部状态' },
    { value: 'enabled', label: '已启用' },
    { value: 'disabled', label: '已停用' },
    { value: 'default', label: '默认凭证' },
    { value: 'incomplete', label: '配置不完整' },
]

function getProviderStyle(provider: OAuth2ProviderType) {
    const metadata = getProviderMetadata(provider)
    return {
        iconClass: metadata.colorClass,
        badgeClass: metadata.badgeClass,
    }
}

function isCompleteConfig(config: OAuth2GlobalConfig) {
    return Boolean(
        config.client_id &&
        config.redirect_uri &&
        (!getProviderMetadata(config.provider_type).clientSecretRequired || config.client_secret)
    )
}

function truncateMiddle(value: string, start = 18, end = 10) {
    if (!value) return '未配置'
    if (value.length <= start + end + 3) return value
    return `${value.slice(0, start)}...${value.slice(-end)}`
}

function formatDate(value?: string) {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleString()
}

function normalizeConfig(config: OAuth2GlobalConfig): OAuth2GlobalConfig {
    return {
        ...config,
        scopes: Array.isArray(config.scopes) ? config.scopes : [],
        is_default: !!config.is_default,
    }
}

export default function OAuth2ConfigTab() {
    const { confirm } = useConfirmDialog()
    const [configs, setConfigs] = useState<OAuth2GlobalConfig[]>([])
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showModal, setShowModal] = useState(false)
    const [editingConfig, setEditingConfig] = useState<OAuth2GlobalConfig | null>(null)
    const [defaultProviderForModal, setDefaultProviderForModal] = useState<OAuth2ProviderType>('gmail')
    const [searchQuery, setSearchQuery] = useState('')
    const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all')
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [showHelpModal, setShowHelpModal] = useState(false)
    const [busyConfigId, setBusyConfigId] = useState<number | null>(null)
    const [testingConfigId, setTestingConfigId] = useState<number | null>(null)

    const supportedProviders = useMemo(() => oauth2Service.getSupportedProviders(), [])

    const loadConfigs = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const [configsData, accountsData] = await Promise.all([
                oauth2Service.getGlobalConfigs(),
                emailAccountService.getAccounts().catch(() => [] as EmailAccount[]),
            ])

            setConfigs(Array.isArray(configsData) ? configsData.map(normalizeConfig) : [])
            setAccounts(Array.isArray(accountsData) ? accountsData : [])
        } catch (err) {
            setError('加载 OAuth2 配置失败')
            setConfigs([])
            console.error('Failed to load OAuth2 configs:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadConfigs()
    }, [loadConfigs])

    const accountCountByConfig = useMemo(() => {
        const counts = new Map<number, number>()
        for (const account of accounts) {
            if (account.authType === 'oauth2' && account.oauth2ProviderId) {
                counts.set(account.oauth2ProviderId, (counts.get(account.oauth2ProviderId) || 0) + 1)
            }
        }
        return counts
    }, [accounts])

    const filteredConfigs = useMemo(() => {
        const searchLower = searchQuery.trim().toLowerCase()

        return configs
            .filter(config => providerFilter === 'all' || config.provider_type === providerFilter)
            .filter(config => {
                if (statusFilter === 'enabled') return config.is_enabled
                if (statusFilter === 'disabled') return !config.is_enabled
                if (statusFilter === 'default') return config.is_default
                if (statusFilter === 'incomplete') return !isCompleteConfig(config)
                return true
            })
            .filter(config => {
                if (!searchLower) return true
                const providerName = oauth2Service.getProviderDisplayName(config.provider_type).toLowerCase()
                return [
                    config.name,
                    providerName,
                    config.provider_type,
                    config.client_id,
                    config.redirect_uri,
                    ...(config.scopes || []),
                ].some(value => String(value || '').toLowerCase().includes(searchLower))
            })
            .sort((a, b) => {
                const providerDiff = supportedProviders.indexOf(a.provider_type) - supportedProviders.indexOf(b.provider_type)
                if (providerDiff !== 0) return providerDiff
                const defaultDiff = Number(!!b.is_default) - Number(!!a.is_default)
                if (defaultDiff !== 0) return defaultDiff
                return a.name.localeCompare(b.name)
            })
    }, [configs, providerFilter, searchQuery, statusFilter, supportedProviders])

    const groupedConfigs = useMemo(() => {
        return supportedProviders
            .map(provider => ({
                provider,
                configs: filteredConfigs.filter(config => config.provider_type === provider),
            }))
            .filter(group => group.configs.length > 0)
    }, [filteredConfigs, supportedProviders])

    const providerCounts = useMemo(() => {
        return supportedProviders.reduce<Record<string, number>>((acc, provider) => {
            acc[provider] = configs.filter(config => config.provider_type === provider).length
            return acc
        }, {})
    }, [configs, supportedProviders])

    const enabledCount = configs.filter(config => config.is_enabled).length
    const defaultCount = configs.filter(config => config.is_default).length

    const handleAddConfig = (provider: OAuth2ProviderType = 'gmail') => {
        setEditingConfig(null)
        setDefaultProviderForModal(provider)
        setShowModal(true)
    }

    const handleEdit = (config: OAuth2GlobalConfig) => {
        setEditingConfig(config)
        setDefaultProviderForModal(config.provider_type)
        setShowModal(true)
    }

    const handleDelete = async (config: OAuth2GlobalConfig) => {
        const confirmed = await confirm({
            title: '删除 OAuth2 配置',
            description: `确定要删除「${config.name || oauth2Service.getProviderDisplayName(config.provider_type)}」吗？如果它是默认凭证，系统会为该客户端自动选择新的默认项。`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive',
        })
        if (!confirmed) return

        try {
            setBusyConfigId(config.id)
            await oauth2Service.deleteGlobalConfig(config.id)
            await loadConfigs()
            toast.success('OAuth2 配置已删除')
        } catch (err) {
            console.error('Failed to delete config:', err)
            toast.error('删除配置失败')
        } finally {
            setBusyConfigId(null)
        }
    }

    const handleToggleEnabled = async (config: OAuth2GlobalConfig) => {
        const payload: CreateOAuth2ConfigRequest & { id: number } = {
            ...config,
            id: config.id,
            is_enabled: !config.is_enabled,
            is_default: config.is_default,
            scopes: config.scopes || [],
        }

        try {
            setBusyConfigId(config.id)
            const saved = await oauth2Service.createOrUpdateGlobalConfig(payload)
            setConfigs(prev => prev.map(item => item.id === config.id ? normalizeConfig(saved) : item))
            toast.success(saved.is_enabled ? 'OAuth2 配置已启用' : 'OAuth2 配置已停用')
        } catch (err) {
            console.error('Failed to toggle config:', err)
            toast.error('更新配置状态失败')
        } finally {
            setBusyConfigId(null)
        }
    }

    const handleSetDefault = async (config: OAuth2GlobalConfig) => {
        if (config.is_default) return

        try {
            setBusyConfigId(config.id)
            await oauth2Service.setDefaultGlobalConfig(config.id)
            setConfigs(prev => prev.map(item => item.provider_type === config.provider_type
                ? { ...item, is_default: item.id === config.id }
                : item
            ))
            toast.success(`${config.name} 已设为默认凭证`)
        } catch (err) {
            console.error('Failed to set default config:', err)
            toast.error('设置默认凭证失败')
        } finally {
            setBusyConfigId(null)
        }
    }

    const handleTestConnection = async (config: OAuth2GlobalConfig) => {
        try {
            setTestingConfigId(config.id)
            const authUrl = await oauth2Service.getAuthUrl(config.provider_type, config.id)
            window.open(authUrl.auth_url, '_blank', 'width=600,height=700')
        } catch (err) {
            console.error('Failed to test connection:', err)
            toast.error('测试连接失败')
        } finally {
            setTestingConfigId(null)
        }
    }

    const handleViewAccounts = (config: OAuth2GlobalConfig) => {
        window.dispatchEvent(new CustomEvent('switchToAccountsTab', {
            detail: {
                filterByProvider: config.provider_type,
            },
        }))
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    <p className="text-gray-500 dark:text-gray-400">加载中...</p>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">加载失败</h3>
                    <p className="mt-1 text-sm text-gray-500">{error}</p>
                    <Button onClick={loadConfigs} className="mt-4" variant="outline">重试</Button>
                </div>
            </div>
        )
    }

    return (
        <>
            <div className="space-y-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">OAuth2 配置</h1>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            按邮件客户端维护多套 OAuth2 凭证，并指定每个客户端的默认授权配置。
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowHelpModal(true)}>
                            <HelpCircle className="mr-2 h-4 w-4" />
                            配置指南
                        </Button>
                        <Button variant="outline" size="sm" onClick={loadConfigs}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            刷新
                        </Button>
                        <Button size="sm" onClick={() => handleAddConfig()}>
                            <Plus className="mr-2 h-4 w-4" />
                            添加配置
                        </Button>
                    </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                        <div className="text-xs text-gray-500">配置总数</div>
                        <div className="mt-2 flex items-end justify-between">
                            <span className="text-2xl font-semibold text-gray-900 dark:text-white">{configs.length}</span>
                            <SettingsSummaryIcon />
                        </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                        <div className="text-xs text-gray-500">已启用</div>
                        <div className="mt-2 flex items-end justify-between">
                            <span className="text-2xl font-semibold text-green-600">{enabledCount}</span>
                            <ShieldCheck className="h-5 w-5 text-green-500" />
                        </div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                        <div className="text-xs text-gray-500">默认凭证组</div>
                        <div className="mt-2 flex items-end justify-between">
                            <span className="text-2xl font-semibold text-amber-600">{defaultCount}</span>
                            <Star className="h-5 w-5 text-amber-500" />
                        </div>
                    </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="relative min-w-0 flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="搜索配置名称、客户端 ID、回调地址或权限范围..."
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                                <button
                                    type="button"
                                    onClick={() => setProviderFilter('all')}
                                    className={cn(
                                        'rounded-md px-3 py-1.5 text-sm transition-colors',
                                        providerFilter === 'all'
                                            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                                            : 'text-gray-600 hover:text-gray-900 dark:text-gray-300'
                                    )}
                                >
                                    全部
                                </button>
                                {supportedProviders.map(provider => (
                                    <button
                                        type="button"
                                        key={provider}
                                        onClick={() => setProviderFilter(provider)}
                                        className={cn(
                                            'rounded-md px-3 py-1.5 text-sm transition-colors',
                                            providerFilter === provider
                                                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                                                : 'text-gray-600 hover:text-gray-900 dark:text-gray-300'
                                        )}
                                    >
                                        {oauth2Service.getProviderDisplayName(provider)}
                                        <span className="ml-1 text-xs text-gray-400">{providerCounts[provider] || 0}</span>
                                    </button>
                                ))}
                            </div>
                            <select
                                value={statusFilter}
                                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                            >
                                {statusOptions.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {filteredConfigs.length === 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-900">
                        <Mail className="mx-auto h-12 w-12 text-gray-400" />
                        <h3 className="mt-3 text-sm font-medium text-gray-900 dark:text-white">
                            {searchQuery || providerFilter !== 'all' || statusFilter !== 'all' ? '没有找到匹配的配置' : '暂无 OAuth2 配置'}
                        </h3>
                        <p className="mt-1 text-sm text-gray-500">
                            {searchQuery || providerFilter !== 'all' || statusFilter !== 'all'
                                ? '可以放宽筛选条件后再试一次。'
                                : '添加第一套凭证后，邮箱账户创建流程会自动优先选择默认配置。'}
                        </p>
                        {!searchQuery && providerFilter === 'all' && statusFilter === 'all' && (
                            <Button className="mt-4" onClick={() => handleAddConfig()}>
                                <Plus className="mr-2 h-4 w-4" />
                                添加配置
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {groupedConfigs.map(group => {
                            const providerStyle = getProviderStyle(group.provider)
                            const defaultConfig = group.configs.find(config => config.is_default)

                            return (
                                <section
                                    key={group.provider}
                                    className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
                                >
                                    <div className="flex flex-col gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/60 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg ring-1', providerStyle.iconClass)}>
                                                <ProviderLogo provider={group.provider} size="lg" />
                                            </div>
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h2 className="font-semibold text-gray-900 dark:text-white">
                                                        {oauth2Service.getProviderDisplayName(group.provider)}
                                                    </h2>
                                                    <Badge variant="outline" className={providerStyle.badgeClass}>
                                                        {group.configs.length} 套配置
                                                    </Badge>
                                                </div>
                                                <p className="mt-1 text-xs text-gray-500">
                                                    默认：{defaultConfig?.name || '暂无默认凭证'}
                                                </p>
                                            </div>
                                        </div>
                                        <Button size="sm" variant="outline" onClick={() => handleAddConfig(group.provider)}>
                                            <Plus className="mr-2 h-4 w-4" />
                                            新增 {oauth2Service.getProviderDisplayName(group.provider)}
                                        </Button>
                                    </div>

                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[240px] px-4">配置名称</TableHead>
                                                <TableHead>Client ID</TableHead>
                                                <TableHead>回调地址</TableHead>
                                                <TableHead className="w-[110px]">权限</TableHead>
                                                <TableHead className="w-[110px]">关联账户</TableHead>
                                                <TableHead className="w-[120px]">状态</TableHead>
                                                <TableHead className="w-[110px]">默认</TableHead>
                                                <TableHead className="w-[150px]">更新时间</TableHead>
                                                <TableHead className="w-[180px] text-right pr-4">操作</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {group.configs.map(config => {
                                                const complete = isCompleteConfig(config)
                                                const accountCount = accountCountByConfig.get(config.id) || 0
                                                const rowBusy = busyConfigId === config.id
                                                const rowTesting = testingConfigId === config.id

                                                return (
                                                    <TableRow key={config.id}>
                                                        <TableCell className="px-4">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="truncate font-medium text-gray-900 dark:text-white" title={config.name}>
                                                                        {config.name || '未命名配置'}
                                                                    </span>
                                                                    {config.is_default && (
                                                                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                                                            默认
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                {!complete && (
                                                                    <div className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                                                                        <AlertCircle className="h-3 w-3" />
                                                                        配置不完整
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <span className="font-mono text-xs text-gray-700 dark:text-gray-300" title={config.client_id || '未配置'}>
                                                                {truncateMiddle(config.client_id)}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell>
                                                            <span className="block max-w-[280px] truncate text-xs text-gray-600 dark:text-gray-400" title={config.redirect_uri || '未配置'}>
                                                                {config.redirect_uri || '未配置'}
                                                            </span>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant="secondary" className="whitespace-nowrap">
                                                                {config.scopes?.length || 0} 项
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleViewAccounts(config)}
                                                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-primary-600 dark:text-gray-300 dark:hover:bg-gray-800"
                                                            >
                                                                <Users className="h-4 w-4" />
                                                                {accountCount}
                                                            </button>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                <Switch
                                                                    checked={config.is_enabled}
                                                                    onCheckedChange={() => handleToggleEnabled(config)}
                                                                    disabled={rowBusy}
                                                                />
                                                                <span className={cn(
                                                                    'text-xs font-medium',
                                                                    config.is_enabled ? 'text-green-600' : 'text-gray-500'
                                                                )}>
                                                                    {config.is_enabled ? '启用' : '停用'}
                                                                </span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSetDefault(config)}
                                                                disabled={config.is_default || rowBusy}
                                                                className={cn(
                                                                    'inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm transition-colors',
                                                                    config.is_default
                                                                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                                                                        : 'text-gray-500 hover:bg-gray-100 hover:text-amber-600 dark:hover:bg-gray-800',
                                                                    rowBusy && 'opacity-60'
                                                                )}
                                                            >
                                                                <Star className={cn('h-4 w-4', config.is_default && 'fill-current')} />
                                                                {config.is_default ? '默认' : '设为默认'}
                                                            </button>
                                                        </TableCell>
                                                        <TableCell>
                                                            <span className="text-xs text-gray-500">{formatDate(config.updated_at || config.created_at)}</span>
                                                        </TableCell>
                                                        <TableCell className="pr-4 text-right">
                                                            <div className="inline-flex items-center gap-1">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleTestConnection(config)}
                                                                    disabled={rowTesting || !config.is_enabled || !complete}
                                                                    title="测试连接"
                                                                >
                                                                    {rowTesting ? (
                                                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                                                    ) : (
                                                                        <Link className="h-4 w-4" />
                                                                    )}
                                                                </Button>
                                                                <Button variant="ghost" size="sm" onClick={() => handleEdit(config)} title="编辑">
                                                                    <Edit className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleDelete(config)}
                                                                    disabled={rowBusy}
                                                                    className="text-red-600 hover:text-red-700"
                                                                    title="删除"
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </section>
                            )
                        })}
                    </div>
                )}
            </div>

            <OAuth2ConfigModal
                isOpen={showModal}
                onClose={() => {
                    setShowModal(false)
                    setEditingConfig(null)
                }}
                onSuccess={() => {
                    setShowModal(false)
                    setEditingConfig(null)
                    loadConfigs()
                }}
                config={editingConfig}
                defaultProvider={defaultProviderForModal}
            />

            <OAuth2HelpModal
                isOpen={showHelpModal}
                onClose={() => setShowHelpModal(false)}
            />
        </>
    )
}

function SettingsSummaryIcon() {
    return (
        <div className="relative h-5 w-5 text-primary-500">
            <Check className="absolute left-0 top-0 h-4 w-4" />
            <X className="absolute bottom-0 right-0 h-3 w-3 text-gray-300" />
        </div>
    )
}
