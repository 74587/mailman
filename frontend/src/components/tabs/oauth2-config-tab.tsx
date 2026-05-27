'use client'

import { useState, useEffect } from 'react'
import { Settings, Plus, Edit, Trash2, Power, Check, X, AlertCircle, Link, Search, MoreVertical, HelpCircle, Users } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { oauth2Service } from '@/services/oauth2.service'
import { emailAccountService } from '@/services/email-account.service'
import { OAuth2GlobalConfig, OAuth2ProviderType, EmailAccount } from '@/types'
import OAuth2ConfigModal from '@/components/modals/oauth2-config-modal'
import OAuth2HelpModal from '@/components/modals/oauth2-help-modal'

// OAuth2配置卡片组件
function OAuth2ConfigCard({
    config,
    onEdit,
    onDelete,
    onToggleEnabled,
    onTestConnection
}: {
    config: OAuth2GlobalConfig
    onEdit: (config: OAuth2GlobalConfig) => void
    onDelete: (config: OAuth2GlobalConfig) => void
    onToggleEnabled: (config: OAuth2GlobalConfig) => void
    onTestConnection: (config: OAuth2GlobalConfig) => void
}) {
    const [isToggling, setIsToggling] = useState(false)
    const [isTesting, setIsTesting] = useState(false)
    const [accountCount, setAccountCount] = useState<number>(0)
    const [loadingAccounts, setLoadingAccounts] = useState(false)

    // 加载关联的账户数量
    const loadAccountCount = async () => {
        try {
            setLoadingAccounts(true)
            const accounts = await emailAccountService.getAccounts()

            // 根据provider_type筛选相关账户
            const relatedAccounts = (accounts || []).filter(account => {
                // 检查账户是否使用OAuth2认证且provider类型匹配
                return account && account.authType === 'oauth2' &&
                    account.mailProvider?.type === config.provider_type
            })

            setAccountCount(relatedAccounts.length)
        } catch (error) {
            console.error('Failed to load account count:', error)
            setAccountCount(0)
        } finally {
            setLoadingAccounts(false)
        }
    }

    // 跳转到邮箱账户管理页面并筛选
    const handleViewAccounts = () => {
        // 触发自定义事件，通知Tab管理器切换到邮箱账户管理页面
        const event = new CustomEvent('switchToAccountsTab', {
            detail: {
                filterByProvider: config.provider_type
            }
        })
        window.dispatchEvent(event)
    }

    // 组件加载时获取账户数量
    useEffect(() => {
        if (config?.id) {
            loadAccountCount()
        }
    }, [config?.id])

    // 添加安全检查，确保config对象完整
    if (!config || !config.provider_type) {
        console.warn('Invalid config object:', config)
        return (
            <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
                <p className="text-red-600 dark:text-red-400">配置数据无效</p>
            </div>
        )
    }

    // 检查配置是否完整
    const isConfigComplete = config.client_id && config.client_secret && config.redirect_uri
    const handleToggleEnabled = async () => {
        setIsToggling(true)
        try {
            if (config.is_enabled) {
                await oauth2Service.disableProvider(config.provider_type)
            } else {
                await oauth2Service.enableProvider(config.provider_type)
            }
            onToggleEnabled(config)
        } catch (error) {
            console.error('Failed to toggle provider:', error)
        } finally {
            setIsToggling(false)
        }
    }

    const handleTestConnection = async () => {
        setIsTesting(true)
        try {
            await onTestConnection(config)
        } finally {
            setIsTesting(false)
        }
    }

    const getProviderIcon = (provider: OAuth2ProviderType) => {
        switch (provider) {
            case 'gmail':
                return '📧'
            case 'outlook':
                return '📮'
            default:
                return '🔗'
        }
    }

    const getProviderColor = (provider: OAuth2ProviderType) => {
        switch (provider) {
            case 'gmail':
                return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
            case 'outlook':
                return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400'
            default:
                return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
        }
    }

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
            {/* 第一行：标题和开关 */}
            <div className="flex items-center justify-between mb-4">
                {/* 左侧：图标 + 标题 + Badge */}
                <div className="flex items-center space-x-3">
                    <div className="text-2xl">
                        {getProviderIcon(config.provider_type)}
                    </div>
                    <div className="flex items-center space-x-2">
                        <h3 className="font-semibold text-gray-900 dark:text-white">
                            {oauth2Service.getProviderDisplayName(config.provider_type)}
                        </h3>
                        <Badge className={cn(getProviderColor(config.provider_type))}>
                            {config.provider_type.toUpperCase()}
                        </Badge>
                    </div>
                </div>

                {/* 右侧：开关 */}
                <div className="flex items-center space-x-2">
                    <Switch
                        checked={config.is_enabled}
                        onCheckedChange={handleToggleEnabled}
                        disabled={isToggling}
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                        {config.is_enabled ? '已启用' : '已禁用'}
                    </span>
                </div>
            </div>

            {/* 创建时间 */}
            <div className="mb-4">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                    创建于 {new Date(config.created_at).toLocaleDateString()}
                </span>
            </div>

            {/* 第二行：操作按钮 */}
            <div className="mb-4">
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTestConnection}
                        disabled={isTesting || !config.is_enabled}
                        className="flex-1"
                    >
                        {isTesting ? (
                            <>
                                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                                测试中...
                            </>
                        ) : (
                            <>
                                <Link className="mr-2 h-4 w-4" />
                                测试连接
                            </>
                        )}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(config)}
                        className="flex-1"
                    >
                        <Edit className="mr-2 h-4 w-4" />
                        编辑
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onDelete(config)}
                        className="text-red-600 hover:text-red-700 hover:border-red-300 flex-1"
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        删除
                    </Button>
                </div>

                {/* 账户数量显示 */}
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <button
                        onClick={handleViewAccounts}
                        disabled={loadingAccounts}
                        className="w-full flex items-center justify-start p-2 text-sm text-gray-600 hover:text-primary-600 hover:bg-gray-50 rounded-lg transition-colors dark:text-gray-400 dark:hover:text-primary-400 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loadingAccounts ? (
                            <>
                                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                                <span>加载中...</span>
                            </>
                        ) : (
                            <>
                                <Users className="mr-2 h-4 w-4" />
                                <span>关联账户: </span>
                                <span className="font-semibold text-primary-600 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-primary-400 mx-1">
                                    {accountCount}
                                </span>
                                <span>个</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* 配置完整性状态提示 */}
            {!isConfigComplete && (
                <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
                    <div className="flex items-center">
                        <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-2" />
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            配置不完整，请点击编辑按钮完善配置信息
                        </p>
                    </div>
                </div>
            )}

            {/* 配置信息区域 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        客户端 ID
                    </label>
                    <div
                        className={cn(
                            "rounded-md px-3 py-2 text-sm cursor-pointer group",
                            config.client_id
                                ? "bg-gray-50 dark:bg-gray-700"
                                : "bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800"
                        )}
                        title={config.client_id || "未配置"}
                    >
                        <span className={cn(
                            "block truncate group-hover:text-primary-600",
                            !config.client_id && "text-red-600 dark:text-red-400 italic"
                        )}>
                            {config.client_id
                                ? (config.client_id.length > 30 ? `${config.client_id.substring(0, 30)}...` : config.client_id)
                                : "未配置"
                            }
                        </span>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        客户端密钥
                    </label>
                    <div
                        className={cn(
                            "rounded-md px-3 py-2 text-sm cursor-pointer group",
                            config.client_secret
                                ? "bg-gray-50 dark:bg-gray-700"
                                : "bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800"
                        )}
                        title={config.client_secret ? "已配置" : "未配置"}
                    >
                        <span className={cn(
                            "block truncate group-hover:text-primary-600",
                            !config.client_secret && "text-red-600 dark:text-red-400 italic"
                        )}>
                            {config.client_secret
                                ? (config.client_secret.length > 10 ? `${"*".repeat(10)}...` : "*".repeat(config.client_secret.length))
                                : "未配置"
                            }
                        </span>
                    </div>
                </div>
                <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        重定向 URI
                    </label>
                    <div
                        className={cn(
                            "rounded-md px-3 py-2 text-sm cursor-pointer group",
                            config.redirect_uri
                                ? "bg-gray-50 dark:bg-gray-700"
                                : "bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800"
                        )}
                        title={config.redirect_uri || "未配置"}
                    >
                        <span className={cn(
                            "block truncate group-hover:text-primary-600",
                            !config.redirect_uri && "text-red-600 dark:text-red-400 italic"
                        )}>
                            {config.redirect_uri || "未配置"}
                        </span>
                    </div>
                </div>
                <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        权限范围
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {(config.scopes || []).map((scope, index) => (
                            <Badge
                                key={index}
                                variant="secondary"
                                className="text-xs"
                            >
                                {scope}
                            </Badge>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

// 主组件
export default function OAuth2ConfigTab() {
    const { confirm } = useConfirmDialog()
    const [configs, setConfigs] = useState<OAuth2GlobalConfig[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showModal, setShowModal] = useState(false)
    const [editingConfig, setEditingConfig] = useState<OAuth2GlobalConfig | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [showHelpModal, setShowHelpModal] = useState(false)

    // 加载配置
    const loadConfigs = async () => {
        try {
            setLoading(true)
            setError(null)
            const configsData = await oauth2Service.getGlobalConfigs()
            // 确保返回的数据是数组，并且每个config都有必需的属性
            const safeConfigsData = Array.isArray(configsData)
                ? configsData.map(config => ({
                    ...config,
                    scopes: Array.isArray(config.scopes) ? config.scopes : []
                }))
                : []
            setConfigs(safeConfigsData)
        } catch (err) {
            setError('加载OAuth2配置失败')
            setConfigs([]) // 确保在错误时configs为空数组而不是null
            console.error('Failed to load OAuth2 configs:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadConfigs()
    }, [])

    // 处理编辑
    const handleEdit = (config: OAuth2GlobalConfig) => {
        setEditingConfig(config)
        setShowModal(true)
    }

    // 处理删除
    const handleDelete = async (config: OAuth2GlobalConfig) => {
        const confirmed = await confirm({
            title: '删除 OAuth2 配置',
            description: `确定要删除 ${oauth2Service.getProviderDisplayName(config.provider_type)} 的配置吗？`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return

        try {
            await oauth2Service.deleteGlobalConfig(config.id)
            setConfigs(configs.filter(c => c.id !== config.id))
            toast.success('OAuth2 配置已删除')
        } catch (err) {
            console.error('Failed to delete config:', err)
            toast.error('删除配置失败')
        }
    }

    // 处理启用/禁用切换
    const handleToggleEnabled = (config: OAuth2GlobalConfig) => {
        setConfigs((configs || []).map(c =>
            c.id === config.id ? { ...c, is_enabled: !c.is_enabled } : c
        ))
    }

    // 处理测试连接
    const handleTestConnection = async (config: OAuth2GlobalConfig) => {
        try {
            const authUrl = await oauth2Service.getAuthUrl(config.provider_type, config.id)
            window.open(authUrl.auth_url, '_blank', 'width=600,height=700')
        } catch (err) {
            console.error('Failed to test connection:', err)
            toast.error('测试连接失败')
        }
    }

    // 处理添加新配置
    const handleAddConfig = () => {
        setEditingConfig(null)
        setShowModal(true)
    }

    // 获取未配置的提供商
    const getUnconfiguredProviders = () => {
        try {
            if (!configs || !Array.isArray(configs)) {
                return oauth2Service.getSupportedProviders() || []
            }
            const configuredProviders = configs.map(c => c?.provider_type).filter(Boolean)
            const supportedProviders = oauth2Service.getSupportedProviders()
            if (!supportedProviders || !Array.isArray(supportedProviders)) {
                return []
            }
            return supportedProviders.filter(p => !configuredProviders.includes(p))
        } catch (error) {
            console.error('Error in getUnconfiguredProviders:', error)
            return []
        }
    }

    // 过滤配置 - 显示所有有效的配置，包括未完成的配置
    const filteredConfigs = (configs || []).filter(config => {
        try {
            if (!config || !config.provider_type) {
                return false
            }
            const displayName = oauth2Service.getProviderDisplayName(config.provider_type).toLowerCase()
            const clientId = (config.client_id || '').toLowerCase()
            const searchLower = searchQuery.toLowerCase()

            return displayName.includes(searchLower) || clientId.includes(searchLower)
        } catch (error) {
            console.error('Error filtering config:', error, config)
            return false
        }
    })

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"></div>
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
                    <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
                        加载失败
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">{error}</p>
                    <Button
                        onClick={loadConfigs}
                        className="mt-4"
                        variant="outline"
                    >
                        重试
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <>
            <div className="space-y-6">
                {/* 页面标题和帮助按钮 */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">OAuth2 配置</h1>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            管理邮件提供商的 OAuth2 认证配置
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowHelpModal(true)}
                        className="flex items-center space-x-2"
                    >
                        <HelpCircle className="h-4 w-4" />
                        <span>配置指南</span>
                    </Button>
                </div>

                {/* 搜索和操作栏 */}
                <div className="flex items-center justify-between">
                    <div className="relative w-96">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="搜索OAuth2配置..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                        />
                    </div>
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={handleAddConfig}
                            className="flex items-center space-x-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                        >
                            <Plus className="h-4 w-4" />
                            <span>添加配置</span>
                        </button>
                    </div>
                </div>

                {/* 配置列表 */}
                {filteredConfigs.length === 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
                        <Settings className="mx-auto h-12 w-12 text-gray-400" />
                        <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
                            {searchQuery ? '没有找到匹配的配置' : '暂无OAuth2配置'}
                        </h3>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                            {searchQuery ? '尝试使用不同的搜索词' : '开始添加第一个OAuth2提供商配置'}
                        </p>
                        {!searchQuery && (
                            <button
                                onClick={handleAddConfig}
                                className="mt-4 text-primary-600 hover:text-primary-700"
                            >
                                添加第一个配置
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {filteredConfigs.map((config) => (
                            <OAuth2ConfigCard
                                key={config.id}
                                config={config}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                onToggleEnabled={handleToggleEnabled}
                                onTestConnection={handleTestConnection}
                            />
                        ))}
                    </div>
                )}

                {/* 可用提供商提示 */}
                {getUnconfiguredProviders()?.length > 0 && (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                            可添加的提供商
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {getUnconfiguredProviders()?.map((provider) => (
                                <Badge
                                    key={provider}
                                    variant="outline"
                                    className="text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                                    onClick={handleAddConfig}
                                >
                                    <Plus className="mr-1 h-3 w-3" />
                                    {oauth2Service.getProviderDisplayName(provider)}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* OAuth2配置模态框 */}
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
            />

            {/* OAuth2帮助模态框 */}
            <OAuth2HelpModal
                isOpen={showHelpModal}
                onClose={() => setShowHelpModal(false)}
            />
        </>
    )
}
