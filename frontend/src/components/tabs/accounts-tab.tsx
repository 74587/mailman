'use client'
import { logger } from '@/lib/logger';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, MoreVertical, Edit2, Trash2, RefreshCw, CheckCircle, XCircle, AlertCircle, Grid, List, Table, ChevronLeft, ChevronRight, Shield, ShieldCheck, Mail, Inbox, ChevronDown, X, Settings, Square, CheckSquare, Clock, Loader2, TableProperties, SlidersHorizontal, ScanSearch } from 'lucide-react'
import { toast } from 'sonner'
import { emailAccountService } from '@/services/email-account.service'
import { oauth2Service } from '@/services/oauth2.service'
import { EmailAccount, AccountFilterParams } from '@/types'
import { cn } from '@/lib/utils'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { useAuth } from '@/context/auth-context'
import AddAccountModal from '@/components/modals/add-account-modal'
import EnhancedAddAccountModal from '@/components/modals/enhanced-add-account-modal'
import EditAccountModal from '@/components/modals/edit-account-modal'
import SyncAccountModal from '@/components/modals/sync-account-modal'
import BatchSyncConfigModal from '@/components/modals/batch-sync-config-modal'
import OutlookTokenModal from '@/components/modals/outlook-token-modal'
import OutlookThunderbirdModal from '@/components/modals/outlook-thunderbird-modal'
import BatchAddOutlookModal from '@/components/modals/batch-add-outlook-modal'
import { OutlookIcon, ThunderbirdIcon, MailConfigIcon, TokenKeyIcon } from '@/components/ui/brand-icons'
import { ProviderLogo } from '@/components/ui/provider-logo'
import { getProviderDisplayName, getProviderMetadata } from '@/lib/provider-metadata'
import { TagFilter, TagManager, TagBadgeList, InlineTagSelector } from '@/components/tags'
import { TagWithGroup } from '@/types'
import { AccountsDataTable, type AccountsDataTableHandle } from '@/components/accounts/accounts-data-table'
import { AccountFilterPanel } from '@/components/accounts/account-filter-panel'
import { AccountSyncStatus, syncConfigService } from '@/services/sync-config.service'
import { registerTabCallback, unregisterTabCallback } from '@/lib/tab-utils'
import { useAISkill, type AISkill, type AISkillAction } from '@/components/ai'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"

// 视图类型
type ViewType = 'grid' | 'list' | 'table' | 'datatable'

// 分页组件
function Pagination({
    currentPage,
    totalPages,
    onPageChange
}: {
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
}) {
    const pages = []
    const maxVisiblePages = 5

    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2))
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1)

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1)
    }

    for (let i = startPage; i <= endPage; i++) {
        pages.push(i)
    }

    return (
        <div className="flex items-center justify-center space-x-2">
            <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-400 dark:hover:bg-gray-700"
            >
                <ChevronLeft className="h-5 w-5" />
            </button>

            {startPage > 1 && (
                <>
                    <button
                        onClick={() => onPageChange(1)}
                        className="rounded-lg px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        1
                    </button>
                    {startPage > 2 && <span className="text-gray-400">...</span>}
                </>
            )}

            {pages.map(page => (
                <button
                    key={page}
                    onClick={() => onPageChange(page)}
                    className={cn(
                        "rounded-lg px-3 py-1 text-sm transition-colors",
                        page === currentPage
                            ? "bg-primary-600 text-white"
                            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    )}
                >
                    {page}
                </button>
            ))}

            {endPage < totalPages && (
                <>
                    {endPage < totalPages - 1 && <span className="text-gray-400">...</span>}
                    <button
                        onClick={() => onPageChange(totalPages)}
                        className="rounded-lg px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        {totalPages}
                    </button>
                </>
            )}

            <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-400 dark:hover:bg-gray-700"
            >
                <ChevronRight className="h-5 w-5" />
            </button>
        </div>
    )
}

export default function AccountsTab() {
    const { confirm } = useConfirmDialog()
    const { hasPermission } = useAuth()
    const canRepairAccountSync = hasPermission('email_account', 'update')
    const dataTableRef = useRef<AccountsDataTableHandle>(null)
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [submittedSearchQuery, setSubmittedSearchQuery] = useState('')
    const [syncStatuses, setSyncStatuses] = useState<Map<number, AccountSyncStatus>>(new Map())
    const [selectedAccount, setSelectedAccount] = useState<EmailAccount | null>(null)
    const [showAddModal, setShowAddModal] = useState(false)
    const [showEnhancedAddModal, setShowEnhancedAddModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [showSyncModal, setShowSyncModal] = useState(false)
    const [showBatchSyncConfigModal, setShowBatchSyncConfigModal] = useState(false)
    const [syncingAccount, setSyncingAccount] = useState<EmailAccount | null>(null)
    const [syncing, setSyncing] = useState<number | null>(null)
    const [repairing, setRepairing] = useState<number | null>(null)
    const [detectingProtocol, setDetectingProtocol] = useState<number | null>(null)
    const detectingProtocolRef = useRef<number | null>(null)
    const [verifying, setVerifying] = useState<number | null>(null)
    const [viewType, setViewType] = useState<ViewType>('datatable')
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0
    })

    // 排序状态 (后端排序)
    const [sortBy, setSortBy] = useState<string>('createdAt')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

    // 批量选择状态
    const [selectedAccounts, setSelectedAccounts] = useState<number[]>([])
    const [isSelectAll, setIsSelectAll] = useState(false)

    // 下拉菜单状态
    // const [showAddDropdown, setShowAddDropdown] = useState(false) // Replaced by DropdownMenu
    const [availableOAuth2ProviderTypes, setAvailableOAuth2ProviderTypes] = useState<string[]>([])
    const [showOutlookTokenModal, setShowOutlookTokenModal] = useState(false)
    const [showOutlookThunderbirdModal, setShowOutlookThunderbirdModal] = useState(false)
    const [showOutlookBatchModal, setShowOutlookBatchModal] = useState(false)
    const [outlookOAuth2Available, setOutlookOAuth2Available] = useState(false)

    // 模态框预设参数
    const [modalPresets, setModalPresets] = useState<{
        provider?: string
        authType?: string
        autoTriggerOAuth2?: boolean
        autoTriggerOAuth2Mode?: 'popup' | 'manual'
        presetBatchMode?: boolean
    }>({})

    // Outlook Token模态框的预填充数据（来自Thunderbird）
    const [outlookTokenPresetData, setOutlookTokenPresetData] = useState<{
        email?: string
        clientId?: string
        accessToken?: string
        refreshToken?: string
        fromThunderbird?: boolean
    } | null>(null)

    // 过滤器状态
    const [providerFilter, setProviderFilter] = useState<string | null>(null)

    // 高级过滤器状态
    const [advancedFilters, setAdvancedFilters] = useState<AccountFilterParams>({})
    const [providers, setProviders] = useState<{ id: number; name: string; type: string }[]>([])

    // 标签管理状态
    const [tagFilter, setTagFilter] = useState<number[]>([])
    const [showTagManager, setShowTagManager] = useState(false)

    useEffect(() => {
        const handleIncomingData = (data: { search?: string }) => {
            const incomingSearch = data?.search?.trim()
            if (!incomingSearch) return
            setSearchQuery(incomingSearch)
            setSubmittedSearchQuery(incomingSearch)
            setProviderFilter(null)
            setPagination(prev => ({ ...prev, page: 1 }))
        }

        registerTabCallback('accounts', 'onReady', handleIncomingData)
        return () => unregisterTabCallback('accounts', 'onReady')
    }, [])

    useEffect(() => {
        loadAccounts()
        checkOAuth2Availability()
        loadProviders()
    }, [pagination.page, pagination.limit, sortBy, sortOrder, tagFilter, submittedSearchQuery]) // advancedFilters 使用手动触发

    // 加载供应商列表
    const loadProviders = async () => {
        try {
            const data = await emailAccountService.getProviders()
            setProviders(data)
        } catch (error) {
            console.error('Failed to load providers:', error)
        }
    }

    // 监听来自OAuth2配置页面的过滤事件
    useEffect(() => {
        const handleFilterAccountsByProvider = (event: CustomEvent) => {
            const { filterByProvider } = event.detail
            setProviderFilter(filterByProvider)
            // 重置搜索查询以避免冲突
            setSearchQuery('')
            setSubmittedSearchQuery('')
            // 重置分页到第一页
            setPagination(prev => ({ ...prev, page: 1 }))
        }

        window.addEventListener('filterAccountsByProvider', handleFilterAccountsByProvider as EventListener)

        return () => {
            window.removeEventListener('filterAccountsByProvider', handleFilterAccountsByProvider as EventListener)
        }
    }, [])

    // 监听来自Thunderbird模态框的事件，打开Outlook Token模态框
    useEffect(() => {
        const handleTriggerOutlookTokenModal = (event: any) => {
            logger.debug('[Accounts Tab] 收到triggerOutlookTokenModal事件，数据:', event.detail)
            // 存储预填充数据到state而不是通过事件传递
            setOutlookTokenPresetData(event.detail)
            setShowOutlookTokenModal(true)
        }

        window.addEventListener('triggerOutlookTokenModal', handleTriggerOutlookTokenModal as EventListener)

        return () => {
            window.removeEventListener('triggerOutlookTokenModal', handleTriggerOutlookTokenModal as EventListener)
        }
    }, [])

    // 检测OAuth2配置可用性
    const checkOAuth2Availability = async () => {
        try {
            const configs = await oauth2Service.getGlobalConfigs()
            const availableProviders = oauth2Service.getSupportedProviders().filter(provider =>
                configs.some(config =>
                    config.provider_type === provider &&
                    oauth2Service.isConfigComplete(config)
                )
            )
            const outlookAvailable = availableProviders.includes('outlook')

            setAvailableOAuth2ProviderTypes(availableProviders)
            setOutlookOAuth2Available(outlookAvailable)
        } catch (error) {
            console.error('Failed to check OAuth2 availability:', error)
            setAvailableOAuth2ProviderTypes([])
            setOutlookOAuth2Available(false)
        }
    }

    const loadAccounts = async () => {
        try {
            setLoading(true)
            // 使用分页API并传递所有过滤参数
            const response = await emailAccountService.getAccountsPaginated({
                page: pagination.page,
                limit: pagination.limit,
                sort_by: sortBy,
                sort_order: sortOrder,
                search: submittedSearchQuery || undefined,
                tag_ids: tagFilter.length > 0 ? tagFilter.join(',') : undefined,
                // 高级过滤参数
                provider_id: advancedFilters.provider_id,
                is_verified: advancedFilters.is_verified,
                error_status: advancedFilters.error_status,
                created_after: advancedFilters.created_after,
                created_before: advancedFilters.created_before,
                last_sync_after: advancedFilters.last_sync_after,
                last_sync_before: advancedFilters.last_sync_before,
            })
            setAccounts(response.data || [])
            setPagination(prev => ({
                ...prev,
                total: response.total,
                totalPages: response.total_pages
            }))
        } catch (error) {
            console.error('Failed to load accounts:', error)
        } finally {
            setLoading(false)
        }
    }

    const loadSyncStatuses = async () => {
        try {
            const accountIds = accounts.map(account => account.id).filter(id => Number.isFinite(id) && id > 0)
            if (accountIds.length === 0) {
                setSyncStatuses(new Map())
                return
            }

            const statuses = await syncConfigService.getAccountSyncStatuses(accountIds)
            const statusMap = new Map<number, AccountSyncStatus>()
            statuses.forEach((status) => {
                statusMap.set(status.account_id, status)
            })
            setSyncStatuses(statusMap)
        } catch (error) {
            console.error('Failed to load sync statuses:', error)
            setSyncStatuses(new Map())
        }
    }

    const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setSubmittedSearchQuery(searchQuery.trim())
        setPagination(prev => ({ ...prev, page: 1 }))
    }

    useEffect(() => {
        loadSyncStatuses()
    }, [accounts])

    const handleDelete = async (id: number) => {
        if (detectingProtocolRef.current === id) {
            toast.warning('协议识别期间不能删除该账户')
            return
        }
        const confirmed = await confirm({
            title: '确认删除',
            description: '确定要删除这个账户吗？',
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return

        try {
            await emailAccountService.deleteAccount(id)
            await loadAccounts()
            toast.success('账户已删除')
        } catch (error) {
            console.error('Failed to delete account:', error)
            toast.error('删除账户失败')
        }
    }

    const handleSyncClick = (account: EmailAccount) => {
        if (detectingProtocolRef.current === account.id) {
            toast.warning('协议识别期间不能启动同步')
            return
        }
        setSyncingAccount(account)
        setShowSyncModal(true)
    }

    const handleSyncConfirm = async () => {
        if (!syncingAccount) return
        if (detectingProtocolRef.current === syncingAccount.id) {
            toast.warning('协议识别期间不能启动同步')
            return
        }

        setSyncing(syncingAccount.id)
        setShowSyncModal(false)

        try {
            await emailAccountService.syncAccount(syncingAccount.id)
            await loadAccounts()
            toast.success('同步成功')
        } catch (error) {
            console.error('Failed to sync account:', error)
            toast.error('同步失败')
        } finally {
            setSyncing(null)
            setSyncingAccount(null)
        }
    }

    const handleRepairSync = async (account: EmailAccount) => {
        if (detectingProtocolRef.current === account.id) {
            toast.warning('协议识别期间不能修复该账户')
            return
        }
        if (repairing !== null) {
            toast.warning('已有账户正在修复，请等待当前操作完成')
            return
        }

        const providerName = account.mailProvider?.type === 'outlook' ? 'Outlook' : 'Gmail'
        const confirmed = await confirm({
            title: `修复 ${providerName} 同步`,
            description: `将清理 ${account.emailAddress} 的失效同步游标，并重新扫描最近 30 天邮件，耗时可能数分钟。已保存的邮件不会删除，重复邮件会自动跳过；修复期间该账户的其他同步会等待。`,
            confirmText: '开始修复',
            cancelText: '取消',
            variant: 'warning',
        })
        if (!confirmed) return

        setRepairing(account.id)
        try {
            const result = await emailAccountService.repairAccountSync(account.id)
            toast.success(`同步修复完成：扫描 ${result.total_emails_processed} 封，补回 ${result.total_new_emails} 封`)
            try {
                await loadAccounts()
            } catch (reloadError) {
                console.error('Repair completed but account refresh failed:', reloadError)
                toast.warning('同步修复已完成，但账户列表刷新失败，请稍后手动刷新')
            }
        } catch (error) {
            console.error('Failed to repair account sync:', error)
            const message = error instanceof Error ? error.message : '请求失败'
            toast.error(`同步修复失败：${message}。如已有邮件完成入库，系统会保留并在重试时自动去重`)
        } finally {
            setRepairing(null)
        }
    }

    const handleEdit = (account: EmailAccount) => {
        if (detectingProtocolRef.current === account.id) {
            toast.warning('协议识别期间不能编辑该账户')
            return
        }
        setSelectedAccount(account)
        setShowEditModal(true)
    }

    const handleVerify = async (account: EmailAccount) => {
        if (detectingProtocolRef.current === account.id) {
            toast.warning('协议识别期间不能重复验证该账户')
            return
        }
        setVerifying(account.id)

        try {
            const result = await emailAccountService.verifyAccount({
                account_id: account.id
            })

            if (result.success) {
                toast.success('账户验证成功！')
            } else {
                toast.error(`账户验证失败: ${result.error || result.message}`)
            }
        } catch (error) {
            console.error('Failed to verify account:', error)
            toast.error('验证账户时发生错误')
        } finally {
            setVerifying(null)
        }
    }

    const handleDetectOutlookProtocol = async (account: EmailAccount) => {
        if (account.authType !== 'oauth2' || account.mailProvider?.type !== 'outlook') {
            toast.error('仅 Outlook OAuth2 账户支持协议识别')
            return
        }
        if (detectingProtocolRef.current !== null) {
            toast.warning('已有账户正在识别协议，请等待当前操作完成')
            return
        }
        if (syncing === account.id || verifying === account.id || repairing === account.id) {
            toast.warning('该账户正在执行其他维护操作，请稍后再识别协议')
            return
        }

        detectingProtocolRef.current = account.id
        setDetectingProtocol(account.id)
        try {
            const result = await emailAccountService.detectOutlookProtocol(account.id)
            if (result.protocol !== 'graph' && result.protocol !== 'imap') {
                throw new Error(result.message || '服务端未返回可用协议')
            }
            const protocolLabel = result.protocol === 'graph' ? 'Microsoft Graph' : 'IMAP/XOAUTH2'
            toast.success(`协议识别完成：${protocolLabel}`)
            try {
                await loadAccounts()
            } catch (reloadError) {
                console.error('Failed to reload accounts after protocol detection:', reloadError)
                toast.warning('协议已保存，但账户列表刷新失败，请手动刷新页面')
            }
        } catch (error) {
            console.error('Failed to detect Outlook protocol:', error)
            const message = error instanceof Error ? error.message : '请求失败'
            toast.error(`协议识别失败：${message}`)
        } finally {
            if (detectingProtocolRef.current === account.id) {
                detectingProtocolRef.current = null
                setDetectingProtocol(null)
            }
        }
    }

    const handlePageChange = (page: number) => {
        setPagination(prev => ({ ...prev, page }))
        // 清除当前页面的选择状态
        setSelectedAccounts([])
        setIsSelectAll(false)
    }

    // 批量选择处理函数
    const handleSelectAccount = (accountId: number, isSelected: boolean) => {
        if (isSelected) {
            setSelectedAccounts(prev => [...prev, accountId])
        } else {
            setSelectedAccounts(prev => prev.filter(id => id !== accountId))
        }
    }

    const handleSelectAll = (isSelected: boolean) => {
        setIsSelectAll(isSelected)
        if (isSelected) {
            setSelectedAccounts(paginatedAccounts.map(account => account.id))
        } else {
            setSelectedAccounts([])
        }
    }

    // 批量删除处理函数
    const handleBatchDelete = async () => {
        if (selectedAccounts.length === 0) return
        if (detectingProtocolRef.current !== null && selectedAccounts.includes(detectingProtocolRef.current)) {
            toast.warning('选中的账户正在识别协议，请等待识别完成')
            return
        }

        const confirmed = await confirm({
            title: '批量删除确认',
            description: `确定要删除选中的 ${selectedAccounts.length} 个账户吗？此操作不可撤销。`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return

        try {
            const deleteCount = selectedAccounts.length
            // 批量删除账户
            await Promise.all(
                selectedAccounts.map(accountId =>
                    emailAccountService.deleteAccount(accountId)
                )
            )

            // 清除选择状态
            setSelectedAccounts([])
            setIsSelectAll(false)

            // 重新加载账户列表
            await loadAccounts()

            toast.success(`成功删除 ${deleteCount} 个账户`)
        } catch (error) {
            console.error('Failed to batch delete accounts:', error)
            toast.error('批量删除账户失败')
        }
    }

    // 批量同步配置处理函数
    const handleBatchSyncConfig = () => {
        if (selectedAccounts.length === 0) return
        if (detectingProtocolRef.current !== null && selectedAccounts.includes(detectingProtocolRef.current)) {
            toast.warning('选中的账户正在识别协议，请等待识别完成')
            return
        }
        setShowBatchSyncConfigModal(true)
    }

    // 批量同步配置成功回调
    const handleBatchSyncConfigSuccess = () => {
        setShowBatchSyncConfigModal(false)
        // 可选：重新加载账户列表以获取最新的同步状态
        loadAccounts()
    }

    // 批量验证处理函数
    const handleBatchVerify = async () => {
        if (selectedAccounts.length === 0) return
        if (detectingProtocolRef.current !== null && selectedAccounts.includes(detectingProtocolRef.current)) {
            toast.warning('选中的账户正在识别协议，请等待识别完成')
            return
        }

        const confirmed = await confirm({
            title: '批量验证确认',
            description: `确定要验证选中的 ${selectedAccounts.length} 个账户的连接性吗？`,
            confirmText: '验证',
            cancelText: '取消'
        })
        if (!confirmed) return

        try {
            setLoading(true)
            const accountIds = selectedAccounts.map(id => id)
            const response = await emailAccountService.batchVerifyAccounts(accountIds)

            // 显示验证结果
            if (response.error_count > 0) {
                const failedEmails = response.results
                    .filter(result => !result.success)
                    .map(result => result.email_address)
                    .slice(0, 3)
                    .join(', ')
                toast.warning(`验证完成：成功 ${response.success_count} 个，失败 ${response.error_count} 个。失败账户：${failedEmails}${response.error_count > 3 ? ' 等' : ''}`)
            } else {
                toast.success(`验证完成：全部 ${response.success_count} 个账户验证成功`)
            }
            loadAccounts() // 重新加载账户列表以获取最新验证状态
        } catch (error) {
            console.error('Failed to batch verify accounts:', error)
            toast.error('批量验证失败')
        } finally {
            setLoading(false)
        }
    }

    const handleOAuth2QuickCreate = (provider: string, mode: 'popup' | 'manual' = 'popup') => {
        setModalPresets({
            provider,
            authType: 'oauth2',
            autoTriggerOAuth2: true,
            autoTriggerOAuth2Mode: mode,
        })
        setShowEnhancedAddModal(true)
    }

    // 处理Outlook OAuth2快捷创建（使用增强模态框）
    const handleOutlookOAuth2QuickCreate = () => {
        handleOAuth2QuickCreate('outlook')
    }

    const handleRegularAddAccount = () => {
        setModalPresets({})
        setShowEnhancedAddModal(true)
    }

    // 处理Outlook已有Token添加账户
    const handleOutlookTokenAddAccount = () => {
        setShowOutlookTokenModal(true)
    }

    // 处理Outlook Thunderbird授权添加账户
    const handleOutlookThunderbirdAddAccount = () => {
        setShowOutlookThunderbirdModal(true)
    }

    // 处理批量添加Outlook账户
    const handleBatchOutlookAddAccount = () => {
        setShowOutlookBatchModal(true)
    }



    // 处理OAuth2配置跳转
    const handleOAuth2Config = (account: EmailAccount) => {
        if (detectingProtocolRef.current === account.id) {
            toast.warning('协议识别期间不能修改 OAuth2 配置')
            return
        }
        logger.debug('[AccountsTab] 触发OAuth2配置跳转，账户:', account.emailAddress, 'Provider:', account.mailProvider?.type);
        // 触发切换到OAuth2配置页面，并过滤显示对应的provider
        const event = new CustomEvent('switchTab', {
            detail: {
                tab: 'oauth2-config',
                data: {
                    filterProvider: account.mailProvider?.type
                }
            }
        })
        window.dispatchEvent(event)
        logger.debug('[AccountsTab] OAuth2配置跳转事件已触发');
    }

    // 添加处理查看邮件和取件的函数
    const handleViewEmails = (account: EmailAccount) => {
        logger.debug('[AccountsTab] 触发查看邮件，账户:', account.emailAddress, 'ID:', account.id);
        // 切换到经典邮件管理器并选中对应邮箱账户
        const event = new CustomEvent('switchTab', {
            detail: {
                tab: 'classic-mailbox',
                data: {
                    locateEmail: {
                        accountId: account.id
                        // 不传 emailId，只选中账户
                    }
                }
            }
        })
        window.dispatchEvent(event)
        logger.debug('[AccountsTab] switchTab 事件已触发');
    }

    const handlePickupMail = (account: EmailAccount) => {
        if (detectingProtocolRef.current === account.id) {
            toast.warning('协议识别期间不能启动取件')
            return
        }
        // 切换到取件tab并设置默认参数
        // 从邮箱地址中提取域名
        const emailDomain = account.emailAddress.split('@')[1]
        const event = new CustomEvent('switchTab', {
            detail: {
                tab: 'mail-pickup-v2',
                data: {
                    selectedAccount: account.emailAddress,
                    customDomain: emailDomain || ''
                }
            }
        })
        window.dispatchEvent(event)
    }

    // 过滤账户 (provider过滤仍在前端进行,搜索和分页已由后端处理)
    const filteredAccounts = providerFilter
        ? accounts.filter(account =>
            account.authType === 'oauth2' && account.mailProvider?.type === providerFilter
        )
        : accounts

    // 后端已经返回分页数据，直接使用
    const paginatedAccounts = filteredAccounts

    const accountsAISkill = useMemo<AISkill>(() => ({
        id: 'accounts',
        title: '邮箱账户管理',
        description: '搜索、筛选和打开邮箱账户添加入口。',
        aliases: ['邮箱账户', '邮箱账号', '账户管理', 'mail accounts'],
        pageTabs: ['accounts'],
        getContext: () => ({
            searchQuery,
            submittedSearchQuery,
            providerFilter,
            advancedFilters,
            tagFilter,
            viewType,
            selectedAccountsCount: selectedAccounts.length,
            page: pagination.page,
            pageSize: pagination.limit,
            total: pagination.total,
            totalPages: pagination.totalPages,
            visibleAccountsCount: paginatedAccounts.length,
            availableOAuth2ProviderTypes,
            sampleVisibleAccounts: paginatedAccounts.slice(0, 5).map(account => ({
                id: account.id,
                email: account.emailAddress,
                provider: account.mailProvider?.type,
                authType: account.authType,
                isVerified: account.isVerified,
                errorStatus: account.errorStatus,
                createdAt: account.createdAt,
                updatedAt: account.updatedAt,
            })),
        }),
        actions: [
            {
                name: 'searchAccounts',
                title: '搜索邮箱账户',
                description: '更新账户页搜索词并刷新分页。',
                risk: 'read',
                parameters: { query: '搜索关键词，可以是邮箱、域名、转发地址或备注' },
                run: async (params) => {
                    const query = String(params.query || '').trim()
                    if (!query) {
                        return { success: false, summary: '没有提供搜索关键词。' }
                    }

                    setSearchQuery(query)
                    setSubmittedSearchQuery(query)
                    setProviderFilter(null)
                    setLoading(true)

                    try {
                        const response = await emailAccountService.getAccountsPaginated({
                            page: 1,
                            limit: pagination.limit,
                            sort_by: sortBy,
                            sort_order: sortOrder,
                            search: query,
                            tag_ids: tagFilter.length > 0 ? tagFilter.join(',') : undefined,
                            provider_id: advancedFilters.provider_id,
                            is_verified: advancedFilters.is_verified,
                            error_status: advancedFilters.error_status,
                            created_after: advancedFilters.created_after,
                            created_before: advancedFilters.created_before,
                            last_sync_after: advancedFilters.last_sync_after,
                            last_sync_before: advancedFilters.last_sync_before,
                        })
                        const matches = response.data || []
                        const matchedCount = response.total || matches.length

                        setAccounts(matches)
                        setPagination(prev => ({
                            ...prev,
                            page: 1,
                            total: response.total,
                            totalPages: response.total_pages,
                        }))

                        return {
                            success: true,
                            summary: matchedCount > 0
                                ? `已搜索 ${query}，找到 ${matchedCount} 个匹配账户。`
                                : `已搜索 ${query}，没有找到匹配账户。`,
                            data: {
                                query,
                                matchedCount,
                                pageSize: pagination.limit,
                                accounts: matches.slice(0, 5).map(account => ({
                                    id: account.id,
                                    email: account.emailAddress,
                                    provider: account.mailProvider?.type,
                                    authType: account.authType,
                                    isVerified: account.isVerified,
                                })),
                            },
                        }
                    } finally {
                        setLoading(false)
                    }
                },
            },
            {
                name: 'clearAccountSearch',
                title: '清空账户搜索',
                description: '清空账户页搜索和 provider 过滤。',
                risk: 'read',
                run: () => {
                    setSearchQuery('')
                    setSubmittedSearchQuery('')
                    setProviderFilter(null)
                    setPagination(prev => ({ ...prev, page: 1 }))
                    return { success: true, summary: '已清空邮箱账户搜索和过滤。' }
                },
            },
            {
                name: 'viewAccountEmails',
                title: '查看账户邮件',
                description: '按邮箱地址定位账户，并打开该账户的邮件列表。',
                risk: 'navigation',
                parameters: { email: '邮箱地址', latest: '为 true 时打开最近创建的账户' },
                run: async (params) => {
                    const email = String(params.email || params.emailAddress || '').trim().toLowerCase()
                    const query = String(params.query || params.emailPrefix || email).trim().toLowerCase()
                    const accountId = typeof params.accountId === 'number' ? params.accountId : Number(params.accountId || 0)
                    const latest = params.latest === true || String(params.latest || '').toLowerCase() === 'true'

                    let targetAccount = latest
                        ? [...paginatedAccounts].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]
                        : accountId
                        ? paginatedAccounts.find(account => account.id === accountId)
                        : email
                            ? paginatedAccounts.find(account => account.emailAddress.toLowerCase() === email)
                            : query
                                ? paginatedAccounts.find(account => account.emailAddress.toLowerCase().startsWith(query))
                                : undefined

                    if (!targetAccount && latest) {
                        const response = await emailAccountService.getAccountsPaginated({
                            page: 1,
                            limit: 1,
                            sort_by: 'created_at',
                            sort_order: 'desc',
                        })
                        targetAccount = response.data[0]
                    }

                    if (!targetAccount && query) {
                        const response = await emailAccountService.getAccountsPaginated({
                            search: query,
                            page: 1,
                            limit: 10,
                        })
                        targetAccount = email
                            ? response.data.find(account => account.emailAddress.toLowerCase() === email) || response.data[0]
                            : response.data.find(account => account.emailAddress.toLowerCase().startsWith(query)) || response.data[0]
                    }

                    if (!targetAccount) {
                        return {
                            success: false,
                            summary: latest
                                ? '没有找到任何邮箱账户。'
                                : query ? `没有找到匹配 ${query} 的邮箱账户。` : '没有提供要查看的邮箱地址或搜索前缀。',
                        }
                    }

                    setSearchQuery(targetAccount.emailAddress)
                    setSubmittedSearchQuery(targetAccount.emailAddress)
                    setProviderFilter(null)
                    setPagination(prev => ({ ...prev, page: 1 }))
                    handleViewEmails(targetAccount)

                    return {
                        success: true,
                        summary: `已切换到 ${targetAccount.emailAddress} 的邮件列表。`,
                        data: {
                            accountId: targetAccount.id,
                            email: targetAccount.emailAddress,
                            nextAction: {
                                skillId: 'classic-mailbox',
                                actionName: 'openAccountInbox',
                                params: { email: targetAccount.emailAddress },
                            },
                        },
                    }
                },
            },
            {
                name: 'openAddAccountModal',
                title: '打开添加账户窗口',
                description: '打开账户添加表单，由用户确认并提交。',
                risk: 'write',
                parameters: {
                    provider: '可选，邮箱提供商类型',
                    authType: '可选，认证方式',
                },
                run: (params) => {
                    const provider = typeof params.provider === 'string' ? params.provider : undefined
                    const authType = typeof params.authType === 'string' ? params.authType : undefined
                    setModalPresets({
                        provider,
                        authType,
                    })
                    setShowEnhancedAddModal(true)
                    return {
                        success: true,
                        summary: '已打开添加账户窗口，提交前仍需要用户手动确认。',
                        data: {
                            formOpened: true,
                            requiresUserCompletion: true,
                            presets: {
                                provider,
                                authType,
                            },
                        },
                    }
                },
            },
            {
                name: 'startOAuth2AccountOnboarding',
                title: '发起邮箱 OAuth2 授权',
                description: '打开添加账户窗口并预设 OAuth2 认证方式，由当前用户完成授权确认。',
                risk: 'write',
                parameters: {
                    provider: '可选，gmail/outlook 等邮箱提供商',
                },
                run: (params) => {
                    const provider = typeof params.provider === 'string' ? params.provider : undefined
                    setModalPresets({
                        provider,
                        authType: 'oauth2',
                    })
                    setShowEnhancedAddModal(true)
                    return {
                        success: true,
                        summary: provider
                            ? `已打开 ${provider} OAuth2 授权添加账户窗口，授权和提交仍需要用户手动确认。`
                            : '已打开 OAuth2 授权添加账户窗口，授权和提交仍需要用户手动确认。',
                        data: {
                            formOpened: true,
                            requiresUserCompletion: true,
                            presets: {
                                provider,
                                authType: 'oauth2',
                            },
                        },
                    }
                },
            },
            {
                name: 'openOAuth2Config',
                title: '打开 OAuth2 配置',
                description: '切换到 OAuth2 配置页面。',
                risk: 'navigation',
                run: () => {
                    window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: 'oauth2-config' } }))
                    return {
                        success: true,
                        summary: '已切换到 OAuth2 配置。',
                        data: {
                            tabId: 'oauth2-config',
                            navigationOnly: true,
                        },
                    }
                },
            },
        ] satisfies AISkillAction[],
    }), [
        advancedFilters,
        availableOAuth2ProviderTypes,
        paginatedAccounts,
        pagination.limit,
        pagination.page,
        pagination.total,
        pagination.totalPages,
        providerFilter,
        searchQuery,
        selectedAccounts.length,
        sortBy,
        sortOrder,
        submittedSearchQuery,
        tagFilter,
        viewType,
    ])

    useAISkill(accountsAISkill)


    const getProviderColor = (provider: string | undefined) => {
        return getProviderMetadata(provider).badgeClass
    }

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

    return (
        <>
            <div className="space-y-6">
                {/* 搜索和操作栏 */}
                <div className="flex items-center justify-between">
                    <div className="w-96">
                        <form className="relative" onSubmit={handleSearchSubmit}>
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="搜索邮箱、域名、转发地址或备注..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-20 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchQuery('')
                                        setSubmittedSearchQuery('')
                                        setPagination(prev => ({ ...prev, page: 1 }))
                                    }}
                                    className="absolute right-10 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                                    title="清空搜索"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                            <button
                                type="submit"
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
                            >
                                搜索
                            </button>
                        </form>
                        {/* 过滤器指示器 */}
                        {(providerFilter || submittedSearchQuery) && (
                            <div className="mt-2 flex items-center space-x-2">
                                {providerFilter && (
                                    <span className="inline-flex items-center rounded-full bg-primary-100 px-3 py-1 text-sm font-medium text-primary-800 dark:bg-primary-900/20 dark:text-primary-400">
                                        过滤: {providerFilter.toUpperCase()} OAuth2 账户
                                        <button
                                            onClick={() => setProviderFilter(null)}
                                            className="ml-2 rounded-full p-0.5 hover:bg-primary-200 dark:hover:bg-primary-800"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </span>
                                )}
                                {submittedSearchQuery && (
                                    <span className="inline-flex max-w-64 items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                                        <span className="truncate">搜索: {submittedSearchQuery}</span>
                                        <button
                                            onClick={() => {
                                                setSearchQuery('')
                                                setSubmittedSearchQuery('')
                                                setPagination(prev => ({ ...prev, page: 1 }))
                                            }}
                                            className="ml-2 rounded-full p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center space-x-3">
                        {/* 批量操作按钮 */}
                        {selectedAccounts.length > 0 && (
                            <div className="flex items-center space-x-2">
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                    已选择 {selectedAccounts.length} 项
                                </span>
                                <button
                                    onClick={handleBatchDelete}
                                    disabled={detectingProtocol !== null && selectedAccounts.includes(detectingProtocol)}
                                    className="flex items-center space-x-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    <span>批量删除</span>
                                </button>
                                <button
                                    onClick={handleBatchSyncConfig}
                                    disabled={detectingProtocol !== null && selectedAccounts.includes(detectingProtocol)}
                                    className="flex items-center space-x-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Clock className="h-4 w-4" />
                                    <span>批量同步配置</span>
                                </button>
                                <button
                                    onClick={handleBatchVerify}
                                    disabled={loading || (detectingProtocol !== null && selectedAccounts.includes(detectingProtocol))}
                                    className="flex items-center space-x-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {loading ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <CheckCircle className="h-4 w-4" />
                                    )}
                                    <span>{loading ? '验证中...' : '批量验证'}</span>
                                </button>
                                <button
                                    onClick={() => {
                                        setSelectedAccounts([])
                                        setIsSelectAll(false)
                                    }}
                                    className="flex items-center space-x-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                >
                                    <X className="h-4 w-4" />
                                    <span>取消选择</span>
                                </button>
                            </div>
                        )}

                        {/* 视图切换按钮 - 多选时隐藏以节省工具栏空间 */}
                        {selectedAccounts.length === 0 && (
                        <div className="flex items-center rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                            <button
                                onClick={() => setViewType('grid')}
                                className={cn(
                                    "flex items-center space-x-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                    viewType === 'grid'
                                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                                )}
                            >
                                <Grid className="h-4 w-4" />
                                <span>卡片</span>
                            </button>
                            <button
                                onClick={() => setViewType('list')}
                                className={cn(
                                    "flex items-center space-x-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                    viewType === 'list'
                                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                                )}
                            >
                                <List className="h-4 w-4" />
                                <span>列表</span>
                            </button>
                            <button
                                onClick={() => setViewType('table')}
                                className={cn(
                                    "flex items-center space-x-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                    viewType === 'table'
                                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                                )}
                            >
                                <Table className="h-4 w-4" />
                                <span>表格</span>
                            </button>
                            <button
                                onClick={() => setViewType('datatable')}
                                className={cn(
                                    "flex items-center space-x-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                    viewType === 'datatable'
                                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                                )}
                            >
                                <TableProperties className="h-4 w-4" />
                                <span>专业表格</span>
                            </button>
                        </div>
                        )}

                        {selectedAccounts.length === 0 && viewType === 'datatable' && (
                            <button
                                type="button"
                                onClick={() => dataTableRef.current?.openColumnSettings()}
                                className="flex items-center space-x-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                            >
                                <SlidersHorizontal className="h-4 w-4" />
                                <span>列设置</span>
                            </button>
                        )}

                        {/* 标签筛选 */}
                        <TagFilter
                            selectedTagIds={tagFilter}
                            onFilterChange={setTagFilter}
                        />

                        {/* 高级筛选按钮 (仅在专业表格视图显示) */}
                        {viewType === 'datatable' && (
                            <AccountFilterPanel
                                filters={advancedFilters}
                                onSearch={(newFilters) => {
                                    setAdvancedFilters(newFilters)
                                    setPagination(prev => ({ ...prev, page: 1 }))
                                    setTimeout(() => loadAccounts(), 0)
                                }}
                                providers={providers}
                            />
                        )}

                        {/* 标签管理按钮 */}
                        <button
                            onClick={() => setShowTagManager(true)}
                            className="flex items-center space-x-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                            <Settings className="h-4 w-4" />
                            <span>管理标签</span>
                        </button>

                        {/* 添加账户下拉菜单 */}
                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className="flex items-center space-x-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                                >
                                    <Plus className="h-4 w-4" />
                                    <span>添加账户</span>
                                    <ChevronDown className="h-4 w-4" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64">
                                <DropdownMenuItem onClick={handleRegularAddAccount} className="cursor-pointer py-3">
                                    <MailConfigIcon className="mr-3 h-5 w-5 flex-shrink-0 text-gray-500" />
                                    <div className="flex flex-col">
                                        <span className="font-medium">添加账户</span>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">手动配置邮箱账户</span>
                                    </div>
                                </DropdownMenuItem>

                                {availableOAuth2ProviderTypes
                                    .filter(provider => provider !== 'outlook')
                                    .map(provider => (
                                        oauth2Service.supportsManualCodeAuth(provider) ? (
                                            <DropdownMenuSub key={provider}>
                                                <DropdownMenuSubTrigger className="cursor-pointer py-3">
                                                    <ProviderLogo provider={provider} className="mr-3 flex-shrink-0" size="md" />
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{getProviderDisplayName(provider)}</span>
                                                        <span className="text-xs text-gray-500 dark:text-gray-400">选择添加方式</span>
                                                    </div>
                                                </DropdownMenuSubTrigger>
                                                <DropdownMenuSubContent className="w-72">
                                                    <DropdownMenuItem onClick={() => handleOAuth2QuickCreate(provider)} className="cursor-pointer py-3">
                                                        <ProviderLogo provider={provider} className="mr-3 flex-shrink-0" size="md" />
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">快速添加 {getProviderDisplayName(provider)}</span>
                                                            <span className="text-xs text-gray-500 dark:text-gray-400">使用 OAuth2 一键授权</span>
                                                        </div>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleOAuth2QuickCreate(provider, 'manual')} className="cursor-pointer py-3">
                                                        <ProviderLogo provider={provider} className="mr-3 flex-shrink-0" size="md" />
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">手动添加 {getProviderDisplayName(provider)}</span>
                                                            <span className="text-xs text-gray-500 dark:text-gray-400">授权后复制回调 URL 或 code</span>
                                                        </div>
                                                    </DropdownMenuItem>
                                                </DropdownMenuSubContent>
                                            </DropdownMenuSub>
                                        ) : (
                                            <DropdownMenuItem key={provider} onClick={() => handleOAuth2QuickCreate(provider)} className="cursor-pointer py-3">
                                                <ProviderLogo provider={provider} className="mr-3 flex-shrink-0" size="md" />
                                                <div className="flex flex-col">
                                                    <span className="font-medium">快速添加 {getProviderDisplayName(provider)}</span>
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">使用 OAuth2 一键授权</span>
                                                </div>
                                            </DropdownMenuItem>
                                        )
                                    ))}

                                    {availableOAuth2ProviderTypes.length > 0 && <DropdownMenuSeparator />}

                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="cursor-pointer py-3">
                                        <OutlookIcon className="mr-3 flex-shrink-0" size={20} />
                                        <div className="flex flex-col">
                                            <span className="font-medium">Outlook</span>
                                            <span className="text-xs text-gray-500 dark:text-gray-400">Outlook 账户相关选项</span>
                                        </div>
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="w-72">
	                                        {outlookOAuth2Available && (
	                                            <DropdownMenuItem onClick={handleOutlookOAuth2QuickCreate} className="cursor-pointer py-3">
	                                                <ProviderLogo provider="outlook" className="mr-3 flex-shrink-0" size="md" />
	                                                <div className="flex flex-col">
                                                    <span className="font-medium">快速添加 Outlook</span>
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">使用 OAuth2 一键授权</span>
                                                </div>
                                            </DropdownMenuItem>
                                        )}

                                        <DropdownMenuItem onClick={handleOutlookTokenAddAccount} className="cursor-pointer py-3">
                                            <TokenKeyIcon className="mr-3 h-5 w-5 flex-shrink-0 text-gray-500" />
                                            <div className="flex flex-col">
                                                <span className="font-medium">新增Outlook(已有Token)</span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400">手动输入已获取Token</span>
                                            </div>
                                        </DropdownMenuItem>

                                        <DropdownMenuItem onClick={handleOutlookThunderbirdAddAccount} className="cursor-pointer py-3">
                                            <ThunderbirdIcon className="mr-3 flex-shrink-0" size={20} />
                                            <div className="flex flex-col">
                                                <span className="font-medium">安装 Outlook (Thunderbird)</span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400">使用 Thunderbird 授权</span>
                                            </div>
                                        </DropdownMenuItem>

                                        <DropdownMenuItem onClick={handleBatchOutlookAddAccount} className="cursor-pointer py-3">
                                            <div className="mr-3 flex h-5 w-5 items-center justify-center rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                                <OutlookIcon size={14} />
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-medium">批量添加Outlook</span>
                                                <span className="text-xs text-gray-500 dark:text-gray-400">批量导入多个Outlook账户</span>
                                            </div>
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuSub>
                            </DropdownMenuContent>
                        </DropdownMenu>

                    </div >
                </div >

                {/* 账户列表 */}
                {
                    paginatedAccounts.length === 0 ? (
                        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
                            <p className="text-gray-500 dark:text-gray-400">
                                {submittedSearchQuery ? '没有找到匹配的账户' : '还没有添加任何邮箱账户'}
                            </p>
                            {!submittedSearchQuery && (
                                <button
                                    onClick={() => setShowEnhancedAddModal(true)}
                                    className="mt-4 text-primary-600 hover:text-primary-700"
                                >
                                    添加第一个账户
                                </button>
                            )}
                        </div>
                    ) : (
                        <>
                            {viewType === 'grid' ? (
                                // 卡片视图
                                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                    {paginatedAccounts.map((account) => (
                                        <div
                                            key={account.id}
                                            className="rounded-lg border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                                        >
                                            <div className="mb-4 flex items-start justify-between">
                                                <div className="flex-1">
                                                    <h3 className="font-medium text-gray-900 dark:text-white">
                                                        {account.emailAddress}
                                                    </h3>
                                                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                                        {account.emailAddress}
                                                    </p>
                                                </div>
                                                <div className="relative">
                                                    <button className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="mb-4 flex items-center justify-between">
	                                                <span className={cn(
	                                                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
	                                                    getProviderColor(account.mailProvider?.type || account.mailProvider?.name)
	                                                )}>
                                                        <ProviderLogo provider={account.mailProvider?.type} size="sm" />
	                                                    {account.mailProvider?.name || account.mailProvider?.type || 'Unknown'}
	                                                </span>
                                                <div className="flex items-center space-x-2">
                                                    {account.isVerified && (
                                                        <div className="flex items-center space-x-1" title={account.verifiedAt ? `验证时间: ${new Date(account.verifiedAt).toLocaleString('zh-CN')}` : '已验证'}>
                                                            <ShieldCheck className="h-4 w-4 text-green-500" />
                                                            <span className="text-xs text-green-600 dark:text-green-400">已验证</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* 标签编辑 */}
                                            <div className="mb-4">
                                                <InlineTagSelector
                                                    accountId={account.id}
                                                    currentTags={account.tags || []}
                                                    onTagsChange={() => loadAccounts()}
                                                    size="sm"
                                                />
                                            </div>

                                            {account.lastSync && (
                                                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                                                    最后同步: {new Date(account.lastSync).toLocaleString('zh-CN')}
                                                </p>
                                            )}

                                            <div className="flex flex-col space-y-2">
                                                <div className="flex space-x-2">
                                                    <button
                                                        onClick={() => handleViewEmails(account)}
                                                        className="flex flex-1 items-center justify-center space-x-1 rounded-lg bg-primary-600 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                                                    >
                                                        <Mail className="h-4 w-4" />
                                                        <span>查看邮件</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handlePickupMail(account)}
                                                        disabled={detectingProtocol === account.id}
                                                        className="flex flex-1 items-center justify-center space-x-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                    >
                                                        <Inbox className="h-4 w-4" />
                                                        <span>取件</span>
                                                    </button>
                                                </div>
                                                <div className="flex space-x-2">
                                                    <button
                                                        onClick={() => handleSyncClick(account)}
                                                        disabled={syncing === account.id || detectingProtocol === account.id}
                                                        className="flex flex-1 items-center justify-center space-x-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                                    >
                                                        <RefreshCw className={cn("h-4 w-4", syncing === account.id && "animate-spin")} />
                                                        <span>{syncing === account.id ? '同步中' : '同步'}</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handleVerify(account)}
                                                        disabled={verifying === account.id || detectingProtocol === account.id}
                                                        className="flex flex-1 items-center justify-center space-x-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                                    >
                                                        <Shield className={cn("h-4 w-4", verifying === account.id && "animate-pulse")} />
                                                        <span>{verifying === account.id ? '验证中' : '验证'}</span>
                                                    </button>
                                                </div>

                                                {/* OAuth2账户特殊按钮行 */}
                                                {account.authType === 'oauth2' && (
                                                    <div className="flex space-x-2">
                                                        {canRepairAccountSync && account.mailProvider?.type === 'outlook' && (
                                                            <button
                                                                onClick={() => handleDetectOutlookProtocol(account)}
                                                                disabled={detectingProtocol !== null || syncing === account.id || verifying === account.id || repairing === account.id}
                                                                className="flex flex-1 items-center justify-center space-x-1 rounded-lg border border-blue-200 bg-blue-50 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/30"
                                                            >
                                                                <ScanSearch className={cn("h-4 w-4", detectingProtocol === account.id && "animate-pulse")} />
                                                                <span>{detectingProtocol === account.id ? '识别中' : '识别协议'}</span>
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleOAuth2Config(account)}
                                                            disabled={detectingProtocol === account.id}
                                                            className="flex flex-1 items-center justify-center space-x-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                        >
                                                            <Settings className="h-4 w-4" />
                                                            <span>OAuth2 配置</span>
                                                        </button>
                                                    </div>
                                                )}

                                                <div className="flex space-x-2">
                                                    <button
                                                        onClick={() => handleEdit(account)}
                                                        disabled={detectingProtocol === account.id}
                                                        className="flex flex-1 items-center justify-center space-x-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                                    >
                                                        <Edit2 className="h-4 w-4" />
                                                        <span>编辑</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(account.id)}
                                                        disabled={detectingProtocol === account.id}
                                                        className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : viewType === 'list' ? (
                                // 列表视图
                                <div className="space-y-3">
                                    {/* 全选控件 */}
                                    {paginatedAccounts.length > 0 && (
                                        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-700">
                                            <div className="flex items-center space-x-3">
                                                <button
                                                    onClick={() => handleSelectAll(!isSelectAll)}
                                                    className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300"
                                                >
                                                    {isSelectAll || selectedAccounts.length === paginatedAccounts.length ? (
                                                        <CheckSquare className="h-5 w-5 text-primary-600" />
                                                    ) : selectedAccounts.length > 0 ? (
                                                        <div className="relative">
                                                            <Square className="h-5 w-5 text-gray-400" />
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <div className="h-2 w-2 bg-primary-600 rounded-sm"></div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <Square className="h-5 w-5 text-gray-400" />
                                                    )}
                                                    <span>
                                                        {isSelectAll || selectedAccounts.length === paginatedAccounts.length
                                                            ? '取消全选'
                                                            : selectedAccounts.length > 0
                                                                ? `已选择 ${selectedAccounts.length}/${paginatedAccounts.length}`
                                                                : '全选'}
                                                    </span>
                                                </button>
                                            </div>
                                            {selectedAccounts.length > 0 && (
                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                    点击右上角的批量删除按钮进行操作
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {paginatedAccounts.map((account) => (
                                        <div
                                            key={account.id}
                                            className={cn(
                                                "flex items-center justify-between rounded-lg border bg-white p-4 transition-all hover:shadow-md dark:bg-gray-800",
                                                selectedAccounts.includes(account.id)
                                                    ? "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20"
                                                    : "border-gray-200 dark:border-gray-700"
                                            )}
                                        >
                                            <div className="flex items-center space-x-4">
                                                {/* 复选框 */}
                                                <button
                                                    onClick={() => handleSelectAccount(account.id, !selectedAccounts.includes(account.id))}
                                                    className="flex items-center justify-center"
                                                >
                                                    {selectedAccounts.includes(account.id) ? (
                                                        <CheckSquare className="h-5 w-5 text-primary-600" />
                                                    ) : (
                                                        <Square className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                                                    )}
                                                </button>
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-white font-semibold">
                                                    {account.emailAddress.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="font-medium text-gray-900 dark:text-white">
                                                        {account.emailAddress}
                                                    </h3>
                                                    <div className="mt-1 flex items-center space-x-3 text-sm text-gray-500 dark:text-gray-400">
	                                                        <span className={cn(
	                                                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
	                                                            getProviderColor(account.mailProvider?.type || account.mailProvider?.name)
	                                                        )}>
                                                                <ProviderLogo provider={account.mailProvider?.type} size="sm" />
	                                                            {account.mailProvider?.name || account.mailProvider?.type || 'Unknown'}
	                                                        </span>
                                                        {account.isVerified && (
                                                            <div className="flex items-center space-x-1" title={account.verifiedAt ? `验证时间: ${new Date(account.verifiedAt).toLocaleString('zh-CN')}` : '已验证'}>
                                                                <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
                                                                <span className="text-xs text-green-600 dark:text-green-400">已验证</span>
                                                            </div>
                                                        )}
                                                        {account.lastSync && (
                                                            <span className="text-xs">
                                                                最后同步: {new Date(account.lastSync).toLocaleString('zh-CN')}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <button
                                                    onClick={() => handleViewEmails(account)}
                                                    className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                                                    title="查看邮件"
                                                >
                                                    <Mail className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => handlePickupMail(account)}
                                                    disabled={detectingProtocol === account.id}
                                                    className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                    title="取件"
                                                >
                                                    <Inbox className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleSyncClick(account)}
                                                    disabled={syncing === account.id || detectingProtocol === account.id}
                                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                                    title="同步"
                                                >
                                                    <RefreshCw className={cn("h-4 w-4", syncing === account.id && "animate-spin")} />
                                                </button>
                                                <button
                                                    onClick={() => handleVerify(account)}
                                                    disabled={verifying === account.id || detectingProtocol === account.id}
                                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                                    title="验证连接"
                                                >
                                                    <Shield className={cn("h-4 w-4", verifying === account.id && "animate-pulse")} />
                                                </button>
                                                {account.authType === 'oauth2' && (
                                                    <>
                                                        {canRepairAccountSync && account.mailProvider?.type === 'outlook' && (
                                                            <button
                                                                onClick={() => handleDetectOutlookProtocol(account)}
                                                                disabled={detectingProtocol !== null || syncing === account.id || verifying === account.id || repairing === account.id}
                                                                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/30"
                                                                title="自动识别 Outlook 协议"
                                                            >
                                                                <ScanSearch className={cn("h-4 w-4", detectingProtocol === account.id && "animate-pulse")} />
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleOAuth2Config(account)}
                                                            disabled={detectingProtocol === account.id}
                                                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                                            title="OAuth2 配置"
                                                        >
                                                            <Settings className="h-4 w-4" />
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    onClick={() => handleEdit(account)}
                                                    disabled={detectingProtocol === account.id}
                                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                                    title="编辑"
                                                >
                                                    <Edit2 className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(account.id)}
                                                    disabled={detectingProtocol === account.id}
                                                    className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                                                    title="删除"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : viewType === 'table' ? (
                                // 表格视图
                                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                        <thead className="bg-gray-50 dark:bg-gray-900">
                                            <tr>
                                                <th className="px-6 py-3 text-left">
                                                    <button
                                                        onClick={() => handleSelectAll(!isSelectAll)}
                                                        className="flex items-center space-x-2"
                                                    >
                                                        {isSelectAll || selectedAccounts.length === paginatedAccounts.length ? (
                                                            <CheckSquare className="h-5 w-5 text-primary-600" />
                                                        ) : selectedAccounts.length > 0 ? (
                                                            <div className="relative">
                                                                <Square className="h-5 w-5 text-gray-400" />
                                                                <div className="absolute inset-0 flex items-center justify-center">
                                                                    <div className="h-2 w-2 bg-primary-600 rounded-sm"></div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <Square className="h-5 w-5 text-gray-400" />
                                                        )}
                                                    </button>
                                                </th>
                                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                    邮箱账户
                                                </th>
                                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                    提供商
                                                </th>
                                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                    验证状态
                                                </th>
                                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                    最后同步
                                                </th>
                                                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                    操作
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                                            {paginatedAccounts.map((account) => (
                                                <tr
                                                    key={account.id}
                                                    className={cn(
                                                        "hover:bg-gray-50 dark:hover:bg-gray-700",
                                                        selectedAccounts.includes(account.id) && "bg-primary-50 dark:bg-primary-900/20"
                                                    )}
                                                >
                                                    <td className="whitespace-nowrap px-6 py-4">
                                                        <button
                                                            onClick={() => handleSelectAccount(account.id, !selectedAccounts.includes(account.id))}
                                                            className="flex items-center justify-center"
                                                        >
                                                            {selectedAccounts.includes(account.id) ? (
                                                                <CheckSquare className="h-5 w-5 text-primary-600" />
                                                            ) : (
                                                                <Square className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                                                            )}
                                                        </button>
                                                    </td>
                                                    <td className="whitespace-nowrap px-6 py-4">
                                                        <div className="flex items-center">
                                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-white font-semibold">
                                                                {account.emailAddress.charAt(0).toUpperCase()}
                                                            </div>
                                                            <div className="ml-4">
                                                                <div className="text-sm font-medium text-gray-900 dark:text-white">
                                                                    {account.emailAddress}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="whitespace-nowrap px-6 py-4">
	                                                        <span className={cn(
	                                                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
	                                                            getProviderColor(account.mailProvider?.type || account.mailProvider?.name)
	                                                        )}>
                                                                <ProviderLogo provider={account.mailProvider?.type} size="sm" />
	                                                            {account.mailProvider?.name || account.mailProvider?.type || 'Unknown'}
	                                                        </span>
                                                    </td>
                                                    <td className="whitespace-nowrap px-6 py-4">
                                                        {account.isVerified ? (
                                                            <div className="flex items-center space-x-1" title={account.verifiedAt ? `验证时间: ${new Date(account.verifiedAt).toLocaleString('zh-CN')}` : '已验证'}>
                                                                <ShieldCheck className="h-4 w-4 text-green-500" />
                                                                <span className="text-sm text-green-600 dark:text-green-400">已验证</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-sm text-gray-400 dark:text-gray-500">未验证</span>
                                                        )}
                                                    </td>
                                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                                                        {account.lastSync ? new Date(account.lastSync).toLocaleString('zh-CN') : '从未同步'}
                                                    </td>
                                                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                                                        <div className="flex items-center space-x-2">
                                                            <button
                                                                onClick={() => handleViewEmails(account)}
                                                                className="rounded-lg p-1.5 text-primary-600 transition-colors hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
                                                                title="查看邮件"
                                                            >
                                                                <Mail className="h-4 w-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => handlePickupMail(account)}
                                                                disabled={detectingProtocol === account.id}
                                                                className="rounded-lg p-1.5 text-green-600 transition-colors hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/20"
                                                                title="取件"
                                                            >
                                                                <Inbox className="h-4 w-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => handleSyncClick(account)}
                                                                disabled={syncing === account.id || detectingProtocol === account.id}
                                                                className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
                                                                title="同步"
                                                            >
                                                                <RefreshCw className={cn("h-4 w-4", syncing === account.id && "animate-spin")} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleVerify(account)}
                                                                disabled={verifying === account.id || detectingProtocol === account.id}
                                                                className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
                                                                title="验证连接"
                                                            >
                                                                <Shield className={cn("h-4 w-4", verifying === account.id && "animate-pulse")} />
                                                            </button>
                                                            {account.authType === 'oauth2' && (
                                                                <>
                                                                    {canRepairAccountSync && account.mailProvider?.type === 'outlook' && (
                                                                        <button
                                                                            onClick={() => handleDetectOutlookProtocol(account)}
                                                                            disabled={detectingProtocol !== null || syncing === account.id || verifying === account.id || repairing === account.id}
                                                                            className="rounded-lg p-1.5 text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                                                                            title="自动识别 Outlook 协议"
                                                                        >
                                                                            <ScanSearch className={cn("h-4 w-4", detectingProtocol === account.id && "animate-pulse")} />
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        onClick={() => handleOAuth2Config(account)}
                                                                        disabled={detectingProtocol === account.id}
                                                                        className="rounded-lg p-1.5 text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                                                                        title="OAuth2 配置"
                                                                    >
                                                                        <Settings className="h-4 w-4" />
                                                                    </button>
                                                                </>
                                                            )}
                                                            <button
                                                                onClick={() => handleEdit(account)}
                                                                disabled={detectingProtocol === account.id}
                                                                className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
                                                                title="编辑"
                                                            >
                                                                <Edit2 className="h-4 w-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(account.id)}
                                                                disabled={detectingProtocol === account.id}
                                                                className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                                                title="删除"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                // 专业表格视图
                                <AccountsDataTable
                                    ref={dataTableRef}
                                    accounts={paginatedAccounts}
                                    selectedIds={selectedAccounts}
                                    onSelectionChange={setSelectedAccounts}
                                    onViewEmails={handleViewEmails}
                                    onPickupMail={handlePickupMail}
                                    onSync={handleSyncClick}
                                    onRepairSync={canRepairAccountSync ? handleRepairSync : undefined}
                                    onDetectOutlookProtocol={canRepairAccountSync ? handleDetectOutlookProtocol : undefined}
                                    onVerify={handleVerify}
                                    onEdit={handleEdit}
                                    onDelete={handleDelete}
                                    onOAuth2Config={handleOAuth2Config}
                                    onTagsChange={loadAccounts}
                                    onAccountChange={loadAccounts}
                                    syncingId={syncing ?? undefined}
                                    repairingId={repairing ?? undefined}
                                    detectingProtocolId={detectingProtocol ?? undefined}
                                    verifyingId={verifying ?? undefined}
                                    syncStatuses={syncStatuses}
                                    sorting={sortBy ? [{ id: sortBy, desc: sortOrder === 'desc' }] : []}
                                    onSortingChange={(newSorting) => {
                                        if (newSorting.length > 0) {
                                            setSortBy(newSorting[0].id)
                                            setSortOrder(newSorting[0].desc ? 'desc' : 'asc')
                                        } else {
                                            setSortBy('createdAt')
                                            setSortOrder('desc')
                                        }
                                    }}
                                />
                            )}

                            {/* 分页控件 */}
                            {pagination.totalPages > 0 && (
                                <div className="mt-8">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-8">
                                            <div className="text-sm text-gray-700 dark:text-gray-300">
                                                显示第 {(pagination.page - 1) * pagination.limit + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} 条，共 {pagination.total} 条
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <label htmlFor="pageSize" className="text-sm text-gray-600 dark:text-gray-400">
                                                    每页显示：
                                                </label>
                                                <select
                                                    id="pageSize"
                                                    value={pagination.limit}
                                                    onChange={(e) => {
                                                        const newLimit = parseInt(e.target.value)
                                                        setPagination(prev => ({
                                                            ...prev,
                                                            page: 1,
                                                            limit: newLimit
                                                        }))
                                                    }}
                                                    className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                >
                                                    <option value="5">5</option>
                                                    <option value="10">10</option>
                                                    <option value="15">15</option>
                                                    <option value="20">20</option>
                                                    <option value="30">30</option>
                                                    <option value="50">50</option>
                                                </select>
                                            </div>
                                        </div>
                                        {pagination.totalPages > 1 && (
                                            <Pagination
                                                currentPage={pagination.page}
                                                totalPages={pagination.totalPages}
                                                onPageChange={handlePageChange}
                                            />
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )
                }
            </div >

            {/* 原始添加账户模态框 */}
            < AddAccountModal
                isOpen={showAddModal}
                onClose={() => {
                    setShowAddModal(false)
                    setModalPresets({})
                }
                }
                onSuccess={() => {
                    setShowAddModal(false)
                    setModalPresets({})
                    loadAccounts()
                }}
                presetProvider={modalPresets.provider}
                presetAuthType={modalPresets.authType}
                autoTriggerOAuth2={modalPresets.autoTriggerOAuth2}
                presetBatchMode={modalPresets.presetBatchMode}
            />

            {/* 增强添加账户模态框 */}
            < EnhancedAddAccountModal
                isOpen={showEnhancedAddModal}
                onClose={() => {
                    setShowEnhancedAddModal(false)
                    setModalPresets({})
                }}
                onSuccess={() => {
                    setShowEnhancedAddModal(false)
                    setModalPresets({})
                    loadAccounts()
                }}
                presetProvider={modalPresets.provider}
                presetAuthType={modalPresets.authType}
                autoTriggerOAuth2={modalPresets.autoTriggerOAuth2}
                autoTriggerOAuth2Mode={modalPresets.autoTriggerOAuth2Mode}
            />

            {/* 编辑账户模态框 */}
            < EditAccountModal
                isOpen={showEditModal}
                onClose={() => {
                    setShowEditModal(false)
                    setSelectedAccount(null)
                }}
                onSuccess={() => {
                    setShowEditModal(false)
                    setSelectedAccount(null)
                    loadAccounts()
                }}
                accountId={selectedAccount?.id || null}
            />

            {/* 同步账户模态框 */}
            {
                syncingAccount && (
                    <SyncAccountModal
                        isOpen={showSyncModal}
                        onClose={() => {
                            setShowSyncModal(false)
                            setSyncingAccount(null)
                        }}
                        accountId={syncingAccount.id}
                        accountEmail={syncingAccount.emailAddress}
                        onSuccess={handleSyncConfirm}
                    />
                )
            }

            {/* 批量同步配置模态框 */}
            <BatchSyncConfigModal
                isOpen={showBatchSyncConfigModal}
                onClose={() => setShowBatchSyncConfigModal(false)}
                onSuccess={handleBatchSyncConfigSuccess}
                selectedAccounts={selectedAccounts.map(id =>
                    accounts.find(account => account.id === id)!
                ).filter(Boolean)}
            />

            {/* Outlook Token模态框 */}
            <OutlookTokenModal
                isOpen={showOutlookTokenModal}
                onClose={() => {
                    setShowOutlookTokenModal(false)
                    setOutlookTokenPresetData(null)
                    loadAccounts()
                }}
                onSuccess={() => {
                    setShowOutlookTokenModal(false)
                    setOutlookTokenPresetData(null)
                    loadAccounts()
                }}
                onError={(error) => {
                    toast.error(error)
                }}
                presetData={outlookTokenPresetData}
            />

            {/* Outlook Thunderbird模态框 */}
            <OutlookThunderbirdModal
                isOpen={showOutlookThunderbirdModal}
                onClose={() => {
                    setShowOutlookThunderbirdModal(false)
                    loadAccounts()
                }}
                onSuccess={() => {
                    setShowOutlookThunderbirdModal(false)
                    loadAccounts()
                }}
                onError={(error) => {
                    toast.error(error)
                }}
            />

            {/* 批量添加Outlook账户模态框 */}
            <BatchAddOutlookModal
                isOpen={showOutlookBatchModal}
                onClose={() => setShowOutlookBatchModal(false)}
                onSuccess={() => {
                    setShowOutlookBatchModal(false)
                    loadAccounts()
                }}
            />

            {/* 标签管理模态框 */}
            <TagManager
                isOpen={showTagManager}
                onClose={() => {
                    setShowTagManager(false)
                    // 关闭标签管理器后，通知所有组件刷新标签数据
                    window.dispatchEvent(new CustomEvent('tagsChanged'))
                    loadAccounts()
                }}
                onTagsChanged={() => {
                    // 标签变化时，通知所有标签组件刷新
                    logger.debug('标签已更新，通知所有组件刷新')
                    window.dispatchEvent(new CustomEvent('tagsChanged'))
                    loadAccounts()
                }}
            />
        </>
    )
}
