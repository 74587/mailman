'use client'
import { logger } from '@/lib/logger';

import React, { useState, useMemo, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
    ChevronLeft,
    ChevronRight,
    Mail,
    Inbox,
    RefreshCw,
    Search,
    X,
    Star,
    Clock,
    AlertCircle,
    CheckCircle2,
    Filter,
    SortAsc,
    SortDesc,
    Locate,
    Loader2,
    AlertTriangle,
    Wifi,
    WifiOff,
    MoreHorizontal,
    Settings,
    RefreshCcw,
    Trash2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmailAccount } from '@/types'
import { syncConfigService, AccountSyncStatus } from '@/services/sync-config.service'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import SyncConfigModal from '@/components/modals/sync-config-modal'
import SyncAccountModal from '@/components/modals/sync-account-modal'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'

interface EnhancedMailboxSidebarProps {
    accounts: EmailAccount[]
    selectedAccount: EmailAccount | null
    onSelectAccount: (account: EmailAccount) => void
    collapsed: boolean
    onToggleCollapse: () => void
    loading: boolean
    accountsTotal?: number
    hasMoreAccounts?: boolean
    loadingMoreAccounts?: boolean
    onLoadMoreAccounts?: () => void
    accountSearchQuery?: string
    onAccountSearchQueryChange?: (query: string) => void
    accountSortBy?: MailboxAccountSortBy
    accountSortOrder?: MailboxAccountSortOrder
    onAccountSortChange?: (sortBy: MailboxAccountSortBy, sortOrder: MailboxAccountSortOrder) => void
    accountVerifiedFilter?: MailboxAccountVerifiedFilter
    onAccountVerifiedFilterChange?: (filter: MailboxAccountVerifiedFilter) => void
    accountScrollRequest?: { accountId: number; requestId: number } | null
}

export type MailboxAccountSortBy = 'name' | 'provider' | 'recent'
export type MailboxAccountSortOrder = 'asc' | 'desc'
export type MailboxAccountVerifiedFilter = 'all' | 'verified' | 'unverified'

const ACCOUNT_ROW_HEIGHT = 96
const ACCOUNT_LIST_OVERSCAN_ROWS = 8

const formatSyncInterval = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '未设置'
    if (seconds < 60) return `${seconds}秒`
    if (seconds % 3600 === 0) return `${seconds / 3600}小时`
    if (seconds % 60 === 0) return `${seconds / 60}分钟`
    return `${seconds}秒`
}

const normalizeGmailAddress = (value: string) => {
    const email = value.trim().toLowerCase()
    const atIndex = email.lastIndexOf('@')
    if (atIndex <= 0 || atIndex >= email.length - 1) return email

    let localPart = email.slice(0, atIndex)
    let domainPart = email.slice(atIndex + 1)
    if (domainPart !== 'gmail.com' && domainPart !== 'googlemail.com') {
        return email
    }

    const plusIndex = localPart.indexOf('+')
    if (plusIndex > -1) {
        localPart = localPart.slice(0, plusIndex)
    }
    localPart = localPart.replace(/\./g, '')
    domainPart = 'gmail.com'

    return `${localPart}@${domainPart}`
}

const accountMatchesSearch = (account: EmailAccount, rawQuery: string) => {
    const query = rawQuery.trim().toLowerCase()
    if (!query) return true

    const providerName = account.mailProvider?.name || ''
    const providerType = account.mailProvider?.type || ''
    const domain = account.domain?.trim().toLowerCase() || ''
    const customSettings = account.customSettings
        ? Object.values(account.customSettings).join(' ').toLowerCase()
        : ''
    const tokens = [
        account.emailAddress,
        providerName,
        providerType,
        domain,
        domain ? `*@${domain}` : '',
        normalizeGmailAddress(account.emailAddress),
        customSettings
    ].map(token => token.toLowerCase()).filter(Boolean)

    if (tokens.some(token => token.includes(query))) {
        return true
    }

    const queryEmail = query.startsWith('*@') ? query.slice(2) : query
    const atIndex = queryEmail.lastIndexOf('@')
    if (atIndex > 0 && atIndex < queryEmail.length - 1) {
        const queryDomain = queryEmail.slice(atIndex + 1)
        if (account.isDomainMail && domain && queryDomain === domain) {
            return true
        }

        return normalizeGmailAddress(queryEmail) === normalizeGmailAddress(account.emailAddress)
    }

    return false
}

export default function EnhancedMailboxSidebar({
    accounts,
    selectedAccount,
    onSelectAccount,
    collapsed,
    onToggleCollapse,
    loading,
    accountsTotal = accounts.length,
    hasMoreAccounts = false,
    loadingMoreAccounts = false,
    onLoadMoreAccounts,
    accountSearchQuery,
    onAccountSearchQueryChange,
    accountSortBy,
    accountSortOrder,
    onAccountSortChange,
    accountVerifiedFilter,
    onAccountVerifiedFilterChange,
    accountScrollRequest
}: EnhancedMailboxSidebarProps) {
    // 滚动容器引用
    const listContainerRef = React.useRef<HTMLDivElement>(null)
    // 搜索框引用
    const searchInputRef = React.useRef<HTMLInputElement>(null)
    const statusViewportFrameRef = React.useRef<number | null>(null)
    const accountScrollFrameRef = React.useRef<number | null>(null)
    const accountScrollRetryTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const handledAccountScrollRequestRef = React.useRef<number | null>(null)
    const manualAccountScrollRequestSeqRef = React.useRef(0)
    const accountListResetKeyRef = React.useRef<string | null>(null)

    // 同步状态
    const [syncStatuses, setSyncStatuses] = useState<Map<number, AccountSyncStatus>>(new Map())
    const [statusAccountIds, setStatusAccountIds] = useState<number[]>([])
    // 右键菜单和同步配置模态框状态
    const [contextMenuAccount, setContextMenuAccount] = useState<EmailAccount | null>(null)
    const [showSyncConfigModal, setShowSyncConfigModal] = useState(false)
    const [syncConfigForEdit, setSyncConfigForEdit] = useState<any>(null)
    const [loadingSyncConfig, setLoadingSyncConfig] = useState(false)
    const [loadingSyncStatus, setLoadingSyncStatus] = useState(false)

    // 右键菜单弹出状态
    const [dropdownOpenAccountId, setDropdownOpenAccountId] = useState<number | null>(null)

    // 立即同步模态框状态
    const [showSyncModal, setShowSyncModal] = useState(false)
    const [syncModalAccount, setSyncModalAccount] = useState<EmailAccount | null>(null)

    // 获取同步状态（使用服务层获取数据库配置）
    const fetchSyncStatuses = React.useCallback(async () => {
        try {
            if (statusAccountIds.length === 0) {
                setSyncStatuses(new Map())
                return
            }

            setLoadingSyncStatus(true)
            const statuses = await syncConfigService.getAccountSyncStatuses(statusAccountIds)
            logger.debug('[EnhancedMailboxSidebar] Fetched sync statuses:', statuses.length, 'accounts')
            const statusMap = new Map<number, AccountSyncStatus>()
            statuses.forEach((status: AccountSyncStatus) => {
                statusMap.set(status.account_id, status)
            })
            setSyncStatuses(statusMap)
        } catch (error) {
            console.error('Failed to fetch sync statuses:', error)
        } finally {
            setLoadingSyncStatus(false)
        }
    }, [statusAccountIds])

    // 初始化加载和定时刷新同步状态
    useEffect(() => {
        fetchSyncStatuses()
        const interval = setInterval(fetchSyncStatuses, 10000)
        return () => clearInterval(interval)
    }, [fetchSyncStatuses])

    React.useEffect(() => {
        return () => {
            if (statusViewportFrameRef.current !== null) {
                cancelAnimationFrame(statusViewportFrameRef.current)
            }
            if (accountScrollFrameRef.current !== null) {
                cancelAnimationFrame(accountScrollFrameRef.current)
            }
            if (accountScrollRetryTimeoutRef.current !== null) {
                clearTimeout(accountScrollRetryTimeoutRef.current)
            }
        }
    }, [])

    // 获取同步状态显示信息（简化为：正常/禁用/异常 + 最后同步时间）
    const getSyncStatusInfo = (accountId: number) => {
        const status = syncStatuses.get(accountId)

        // 计算距离上次同步的时间
        const getTimeAgo = (timeStr?: string) => {
            if (!timeStr) return ''
            const lastSyncTime = new Date(timeStr)
            const now = new Date()
            const diffMinutes = Math.floor((now.getTime() - lastSyncTime.getTime()) / 60000)
            if (diffMinutes < 1) return '刚刚'
            if (diffMinutes < 60) return `${diffMinutes}分钟前`
            const diffHours = Math.floor(diffMinutes / 60)
            if (diffHours < 24) return `${diffHours}小时前`
            const diffDays = Math.floor(diffHours / 24)
            return `${diffDays}天前`
        }

        if (!status) {
            return {
                status: 'unknown',
                statusIcon: <WifiOff className="w-3 h-3" />,
                statusColor: 'text-gray-400',
                statusText: '未配置',
                configText: '同步未配置',
                intervalText: '未设置',
                timeText: '',
                tooltip: '此账户未配置自动同步'
            }
        }

        const intervalText = formatSyncInterval(status.sync_interval)
        const configText = `${status.enable_auto_sync && !status.auto_disabled ? '同步开启' : '同步关闭'} · ${intervalText}`
        const timeAgo = getTimeAgo(status.last_sync_time)
        const lastSyncDisplay = status.last_sync_time
            ? new Date(status.last_sync_time).toLocaleString()
            : '从未同步'

        // 禁用状态（手动禁用或自动禁用）
        if (!status.enable_auto_sync || status.auto_disabled) {
            const reason = status.auto_disabled
                ? (status.disable_reason || '错误过多')
                : '手动禁用'
            return {
                status: 'disabled',
                statusIcon: <WifiOff className="w-3 h-3" />,
                statusColor: 'text-gray-400',
                statusText: '禁用',
                configText,
                intervalText,
                timeText: timeAgo,
                tooltip: `${reason}\n同步间隔: ${intervalText}\n上次同步: ${lastSyncDisplay}`
            }
        }

        // 确认中状态（刚刚保存配置，等待下一次轮询）
        if (status.sync_status === 'confirming') {
            return {
                status: 'confirming',
                statusIcon: <Loader2 className="w-3 h-3 animate-spin" />,
                statusColor: 'text-blue-500',
                statusText: '确认中',
                configText,
                intervalText,
                timeText: '',
                tooltip: `正在确认同步配置...\n同步间隔: ${intervalText}`
            }
        }

        // 异常状态（有错误或sync_status为error）
        if (status.sync_status === 'error' || (status.consecutive_errors && status.consecutive_errors > 0)) {
            return {
                status: 'error',
                statusIcon: <AlertTriangle className="w-3 h-3" />,
                statusColor: 'text-red-500',
                statusText: '异常',
                configText,
                intervalText,
                timeText: timeAgo,
                tooltip: `错误 ${status.consecutive_errors || status.error_count || 0} 次\n${status.last_sync_error || ''}\n同步间隔: ${intervalText}\n上次同步: ${lastSyncDisplay}`
            }
        }

        // 正常状态
        return {
            status: 'normal',
            statusIcon: status.is_running
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Wifi className="w-3 h-3" />,
            statusColor: 'text-green-500',
            statusText: '正常',
            configText,
            intervalText,
            timeText: timeAgo,
            tooltip: `已同步 ${status.sync_count || 0} 次\n同步间隔: ${intervalText}\n上次同步: ${lastSyncDisplay}`
        }
    }

    // 打开同步配置模态框
    const openSyncConfigModal = async (account: EmailAccount) => {
        setContextMenuAccount(account)
        setLoadingSyncConfig(true)
        try {
            // 获取账户的同步配置
            const config = await apiClient.get(`/accounts/${account.id}/sync-config`)
            setSyncConfigForEdit({
                ...config,
                account_id: account.id,
                account: {
                    id: account.id,
                    emailAddress: account.emailAddress,
                    authType: account.authType,
                    mailProviderId: account.mailProviderId,
                    mailProvider: account.mailProvider,
                    isVerified: account.isVerified
                }
            })
        } catch (error: any) {
            // 如果没有配置，创建默认配置对象
            logger.debug('No existing sync config, using defaults')
            setSyncConfigForEdit({
                account_id: account.id,
                enable_auto_sync: true,
                sync_interval: 300,
                sync_folders: ['INBOX'],
                account: {
                    id: account.id,
                    emailAddress: account.emailAddress,
                    authType: account.authType,
                    mailProviderId: account.mailProviderId,
                    mailProvider: account.mailProvider,
                    isVerified: account.isVerified
                }
            })
        } finally {
            setLoadingSyncConfig(false)
            setShowSyncConfigModal(true)
        }
    }

    // 处理同步配置保存成功
    const handleSyncConfigSuccess = () => {
        // 立即设置该账户的状态为"确认中"，等待下一次定时刷新获取真正状态
        if (contextMenuAccount) {
            const currentStatus = syncStatuses.get(contextMenuAccount.id)
            if (currentStatus) {
                const updatedStatus = {
                    ...currentStatus,
                    sync_status: 'confirming' as string,
                    // 假设用户启用了自动同步
                    enable_auto_sync: true,
                    auto_disabled: false
                }
                const newStatusMap = new Map(syncStatuses)
                newStatusMap.set(contextMenuAccount.id, updatedStatus)
                setSyncStatuses(newStatusMap)
            }
        }

        setShowSyncConfigModal(false)
        setSyncConfigForEdit(null)
        setContextMenuAccount(null)
        logger.debug('[EnhancedMailboxSidebar] Sync config saved, status set to confirming, waiting for next poll...')
    }
    // 搜索状态
    const [localSearchQuery, setLocalSearchQuery] = useState('')
    const [showSearch, setShowSearch] = useState(false)
    const searchQuery = accountSearchQuery ?? localSearchQuery
    const setSearchQuery = onAccountSearchQueryChange ?? setLocalSearchQuery

    // 当显示搜索框时自动获取焦点
    React.useEffect(() => {
        if (showSearch && searchInputRef.current) {
            // 给一点延迟等待动画开始
            setTimeout(() => {
                searchInputRef.current?.focus()
            }, 50)
        }
    }, [showSearch])

    // 排序状态
    const [localSortBy, setLocalSortBy] = useState<MailboxAccountSortBy>('name')
    const [localSortOrder, setLocalSortOrder] = useState<MailboxAccountSortOrder>('asc')
    const sortBy = accountSortBy ?? localSortBy
    const sortOrder = accountSortOrder ?? localSortOrder

    // 过滤状态
    const [localFilterVerified, setLocalFilterVerified] = useState<MailboxAccountVerifiedFilter>('all')
    const filterVerified = accountVerifiedFilter ?? localFilterVerified
    const setFilterVerified = onAccountVerifiedFilterChange ?? setLocalFilterVerified
    const remoteSearchEnabled = Boolean(onAccountSearchQueryChange)
    const remoteFilterEnabled = Boolean(onAccountVerifiedFilterChange)
    const hasActiveAccountFilter = Boolean(searchQuery.trim()) || filterVerified !== 'all'
    const accountListResetKey = useMemo(() => (
        [searchQuery, filterVerified, sortBy, sortOrder].join('\u0000')
    ), [searchQuery, filterVerified, sortBy, sortOrder])

    // 过滤和排序账户
    const filteredAndSortedAccounts = useMemo(() => {
        let result = [...accounts]

        // 搜索过滤
        if (!remoteSearchEnabled && searchQuery.trim()) {
            result = result.filter(account => accountMatchesSearch(account, searchQuery))
        }

        // 验证状态过滤
        if (!remoteFilterEnabled && filterVerified === 'verified') {
            result = result.filter(account => account.isVerified)
        } else if (!remoteFilterEnabled && filterVerified === 'unverified') {
            result = result.filter(account => !account.isVerified)
        }

        // 排序
        result.sort((a, b) => {
            let comparison = 0

            switch (sortBy) {
                case 'name':
                    comparison = a.emailAddress.localeCompare(b.emailAddress)
                    break
                case 'provider':
                    comparison = (a.mailProvider?.type || '').localeCompare(b.mailProvider?.type || '')
                    break
                case 'recent':
                    comparison = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
                    if (comparison === 0) {
                        comparison = (a.id || 0) - (b.id || 0)
                    }
                    break
            }

            return sortOrder === 'asc' ? comparison : -comparison
        })

        return result
    }, [accounts, searchQuery, sortBy, sortOrder, filterVerified, remoteSearchEnabled, remoteFilterEnabled])

    const accountVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: filteredAndSortedAccounts.length,
        getScrollElement: () => listContainerRef.current,
        estimateSize: () => ACCOUNT_ROW_HEIGHT,
        overscan: ACCOUNT_LIST_OVERSCAN_ROWS,
        getItemKey: index => filteredAndSortedAccounts[index]?.id ?? index,
    })
    const virtualAccountItems = accountVirtualizer.getVirtualItems()

    const updateStatusAccountIdsForViewport = React.useCallback(() => {
        const nextIds: number[] = []
        const seen = new Set<number>()

        virtualAccountItems.forEach((item) => {
            const id = filteredAndSortedAccounts[item.index]?.id
            if (!Number.isFinite(id) || id <= 0 || seen.has(id)) return
            seen.add(id)
            nextIds.push(id)
        })

        if (selectedAccount && !seen.has(selectedAccount.id)) {
            nextIds.push(selectedAccount.id)
        }

        const fallbackIds = nextIds.length > 0
            ? nextIds
            : filteredAndSortedAccounts.slice(0, 50).map(account => account.id)

        setStatusAccountIds(current => {
            if (current.length === fallbackIds.length && current.every((id, index) => id === fallbackIds[index])) {
                return current
            }
            return fallbackIds
        })
    }, [filteredAndSortedAccounts, selectedAccount, virtualAccountItems])

    const scheduleStatusViewportUpdate = React.useCallback(() => {
        if (statusViewportFrameRef.current !== null) {
            cancelAnimationFrame(statusViewportFrameRef.current)
        }
        statusViewportFrameRef.current = requestAnimationFrame(() => {
            statusViewportFrameRef.current = null
            updateStatusAccountIdsForViewport()
        })
    }, [updateStatusAccountIdsForViewport])

    React.useEffect(() => {
        scheduleStatusViewportUpdate()
    }, [scheduleStatusViewportUpdate, virtualAccountItems])

    React.useEffect(() => {
        const container = listContainerRef.current
        if (!container) return

        const previousResetKey = accountListResetKeyRef.current
        accountListResetKeyRef.current = accountListResetKey

        if (previousResetKey === null) {
            scheduleStatusViewportUpdate()
            return
        }

        if (previousResetKey !== accountListResetKey) {
            accountVirtualizer.scrollToOffset(0, { behavior: 'auto' })
            scheduleStatusViewportUpdate()
        }
    }, [accountListResetKey, accountVirtualizer, scheduleStatusViewportUpdate])

    // 定位到指定账户。由 TanStack Virtual 维护窗口和偏移，避免手写 range 与 DOM 滚动互相打架。
    const scrollToAccountId = React.useCallback((accountId: number) => {
        const container = listContainerRef.current
        if (!container || container.clientHeight <= 0) return false

        const selectedIndex = filteredAndSortedAccounts.findIndex(account => account.id === accountId)
        if (selectedIndex < 0) return false

        accountVirtualizer.measure()
        accountVirtualizer.scrollToIndex(selectedIndex, { align: 'center', behavior: 'auto' })
        scheduleStatusViewportUpdate()

        return true
    }, [accountVirtualizer, filteredAndSortedAccounts, scheduleStatusViewportUpdate])

    const isAccountRowFullyVisible = React.useCallback((accountId: number) => {
        const container = listContainerRef.current
        if (!container || container.clientHeight <= 0) return false

        const accountElement = container.querySelector<HTMLElement>(`[data-account-id="${accountId}"]`)
        if (!accountElement) return false

        const containerRect = container.getBoundingClientRect()
        const accountRect = accountElement.getBoundingClientRect()
        return accountRect.top >= containerRect.top && accountRect.bottom <= containerRect.bottom
    }, [])

    const scheduleAccountScrollAttempt = React.useCallback((
        request: { accountId: number; requestId: number },
        attempt = 0
    ) => {
        if (handledAccountScrollRequestRef.current === request.requestId) return

        if (accountScrollRetryTimeoutRef.current !== null) {
            clearTimeout(accountScrollRetryTimeoutRef.current)
            accountScrollRetryTimeoutRef.current = null
        }
        if (accountScrollFrameRef.current !== null) {
            cancelAnimationFrame(accountScrollFrameRef.current)
            accountScrollFrameRef.current = null
        }

        scrollToAccountId(request.accountId)

        accountScrollFrameRef.current = requestAnimationFrame(() => {
            accountScrollFrameRef.current = null

            const isFullyVisible = isAccountRowFullyVisible(request.accountId)
            if (isFullyVisible && attempt >= 2) {
                handledAccountScrollRequestRef.current = request.requestId
                scheduleStatusViewportUpdate()
                return
            }

            if (attempt >= 12) {
                if (isFullyVisible) {
                    handledAccountScrollRequestRef.current = request.requestId
                    scheduleStatusViewportUpdate()
                }
                return
            }

            accountScrollRetryTimeoutRef.current = setTimeout(() => {
                accountScrollRetryTimeoutRef.current = null
                scheduleAccountScrollAttempt(request, attempt + 1)
            }, isFullyVisible ? 80 : attempt < 3 ? 50 : 120)
        })
    }, [isAccountRowFullyVisible, scheduleStatusViewportUpdate, scrollToAccountId])

    // 外部打开邮件时，父组件会发一次明确的账户滚动请求；目标账户稍后插入、tab 切换动画、虚拟列表测量都可能需要重试。
    React.useEffect(() => {
        if (!accountScrollRequest) return
        if (handledAccountScrollRequestRef.current === accountScrollRequest.requestId) return

        scheduleAccountScrollAttempt(accountScrollRequest)
    }, [accountScrollRequest, filteredAndSortedAccounts.length, scheduleAccountScrollAttempt])

    const scrollToSelectedAccount = () => {
        if (!selectedAccount) return
        manualAccountScrollRequestSeqRef.current -= 1
        scheduleAccountScrollAttempt({
            accountId: selectedAccount.id,
            requestId: manualAccountScrollRequestSeqRef.current,
        })
    }

    // 获取邮箱提供商图标和颜色
    const getProviderInfo = (provider: string) => {
        switch (provider?.toLowerCase()) {
            case 'gmail':
                return {
                    icon: '📧',
                    color: 'text-red-600 dark:text-red-400',
                    bgColor: 'bg-red-50 dark:bg-red-900/20',
                    borderColor: 'border-red-200 dark:border-red-700'
                }
            case 'outlook':
                return {
                    icon: '📮',
                    color: 'text-blue-600 dark:text-blue-400',
                    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
                    borderColor: 'border-blue-200 dark:border-blue-700'
                }
            case 'yahoo':
                return {
                    icon: '📬',
                    color: 'text-purple-600 dark:text-purple-400',
                    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
                    borderColor: 'border-purple-200 dark:border-purple-700'
                }
            default:
                return {
                    icon: '📭',
                    color: 'text-gray-600 dark:text-gray-400',
                    bgColor: 'bg-gray-50 dark:bg-gray-900/20',
                    borderColor: 'border-gray-200 dark:border-gray-700'
                }
        }
    }

    // 切换排序
    const updateSort = (nextSortBy: MailboxAccountSortBy, nextSortOrder: MailboxAccountSortOrder) => {
        if (onAccountSortChange) {
            onAccountSortChange(nextSortBy, nextSortOrder)
        } else {
            setLocalSortBy(nextSortBy)
            setLocalSortOrder(nextSortOrder)
        }
    }

    const toggleSort = (field: MailboxAccountSortBy) => {
        if (sortBy === field) {
            updateSort(field, sortOrder === 'asc' ? 'desc' : 'asc')
        } else {
            updateSort(field, field === 'recent' ? 'desc' : 'asc')
        }
    }

    // 键盘快捷键支持
    const handleKeyDown = (e: React.KeyboardEvent, account: EmailAccount) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelectAccount(account)
        }
    }

    const handleAccountListScroll = (event: React.UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget
        scheduleStatusViewportUpdate()
        if (!onLoadMoreAccounts || !hasMoreAccounts || loadingMoreAccounts || loading) return
        const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
        if (distanceToBottom < 240) {
            onLoadMoreAccounts()
        }
    }

    return (
        <>
            <div className="h-full flex flex-col bg-white dark:bg-gray-800 overflow-hidden">
                {/* 顶部标题栏 */}
                <div className="flex-shrink-0 flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    {!collapsed && (
                        <div className="flex items-center gap-2">
                            <Mail className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            <h2 className="font-semibold text-gray-900 dark:text-white">邮箱账户</h2>
                        </div>
                    )}
                    <div className="flex items-center gap-1">
                        {!collapsed && selectedAccount && (
                            <button
                                onClick={scrollToSelectedAccount}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                title="定位到选中账户"
                            >
                                <Locate className="h-4 w-4" />
                            </button>
                        )}
                        {!collapsed && (
                            <button
                                onClick={() => setShowSearch(!showSearch)}
                                className={cn(
                                    "p-1.5 rounded-lg transition-colors",
                                    showSearch
                                        ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                                        : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400"
                                )}
                                title="搜索邮箱账户"
                            >
                                <Search className="h-4 w-4" />
                            </button>
                        )}
                        <button
                            onClick={onToggleCollapse}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
                            title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                        >
                            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                        </button>
                    </div>
                </div>

                {/* 搜索栏 - 带动画 */}
                {!collapsed && (
                    <div
                        className={cn(
                            "flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out",
                            showSearch ? "max-h-32 opacity-100" : "max-h-0 opacity-0"
                        )}
                    >
                        <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                            {/* 搜索输入框 - 与邮件列表搜索框样式一致 */}
                            <div className="relative mb-2">
                                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder="搜索邮箱..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full rounded-full border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700/50 dark:text-white dark:focus:bg-gray-700 placeholder:text-gray-400 transition-all"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </div>

                            {/* 过滤和排序选项 - 紧凑设计 */}
                            <div className="flex items-center gap-1.5 text-[11px]">
                                {/* 验证状态过滤 - pill 按钮组 */}
                                <div className="flex items-center bg-gray-100 dark:bg-gray-700/50 rounded-full p-0.5">
                                    <button
                                        onClick={() => setFilterVerified('all')}
                                        className={cn(
                                            "px-2 py-0.5 rounded-full transition-all duration-200",
                                            filterVerified === 'all'
                                                ? "bg-white dark:bg-gray-600 text-gray-700 dark:text-white shadow-sm"
                                                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                                        )}
                                    >
                                        全部
                                    </button>
                                    <button
                                        onClick={() => setFilterVerified('verified')}
                                        className={cn(
                                            "px-2 py-0.5 rounded-full transition-all duration-200 flex items-center gap-0.5",
                                            filterVerified === 'verified'
                                                ? "bg-green-500 text-white shadow-sm"
                                                : "text-gray-500 dark:text-gray-400 hover:text-green-600"
                                        )}
                                    >
                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                        验证
                                    </button>
                                    <button
                                        onClick={() => setFilterVerified('unverified')}
                                        className={cn(
                                            "px-2 py-0.5 rounded-full transition-all duration-200 flex items-center gap-0.5",
                                            filterVerified === 'unverified'
                                                ? "bg-amber-500 text-white shadow-sm"
                                                : "text-gray-500 dark:text-gray-400 hover:text-amber-600"
                                        )}
                                    >
                                        <AlertCircle className="w-2.5 h-2.5" />
                                        未验
                                    </button>
                                </div>

                                {/* 分隔符 */}
                                <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />

                                {/* 排序选项 - 更紧凑 */}
                                <div className="flex items-center bg-gray-100 dark:bg-gray-700/50 rounded-full p-0.5">
                                    <button
                                        onClick={() => toggleSort('name')}
                                        className={cn(
                                            "px-2 py-0.5 rounded-full transition-all duration-200",
                                            sortBy === 'name'
                                                ? "bg-blue-500 text-white shadow-sm"
                                                : "text-gray-500 dark:text-gray-400 hover:text-blue-600"
                                        )}
                                    >
                                        名称
                                    </button>
                                    <button
                                        onClick={() => toggleSort('provider')}
                                        className={cn(
                                            "px-2 py-0.5 rounded-full transition-all duration-200",
                                            sortBy === 'provider'
                                                ? "bg-blue-500 text-white shadow-sm"
                                                : "text-gray-500 dark:text-gray-400 hover:text-blue-600"
                                        )}
                                    >
                                        供应
                                    </button>
                                    <button
                                        onClick={() => updateSort(sortBy, sortOrder === 'asc' ? 'desc' : 'asc')}
                                        className={cn(
                                            "p-0.5 rounded-full transition-all duration-200",
                                            "text-gray-500 dark:text-gray-400 hover:text-blue-600 hover:bg-white dark:hover:bg-gray-600"
                                        )}
                                        title={sortOrder === 'asc' ? '升序' : '降序'}
                                    >
                                        {sortOrder === 'asc' ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 邮箱列表 */}
                <div ref={listContainerRef} onScroll={handleAccountListScroll} className="flex-1 overflow-y-auto min-h-0">
                    {loading ? (
                        <div className="p-4 text-center">
                            <div className="inline-flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                {!collapsed && <span className="text-sm">加载中...</span>}
                            </div>
                        </div>
                    ) : accounts.length === 0 && !hasActiveAccountFilter ? (
                        <div className="p-4 text-center">
                            <div className="text-gray-500 dark:text-gray-400">
                                <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                {!collapsed && (
                                    <p className="text-sm">暂无邮箱账户</p>
                                )}
                            </div>
                        </div>
                    ) : filteredAndSortedAccounts.length === 0 ? (
                        <div className="p-4 text-center">
                            <div className="text-gray-500 dark:text-gray-400">
                                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                {!collapsed && (
                                    <>
                                        <p className="text-sm font-medium">未找到匹配的邮箱</p>
                                        <p className="text-xs mt-1">尝试使用其他关键词搜索</p>
                                        <button
                                            onClick={() => {
                                                setSearchQuery('')
                                                setFilterVerified('all')
                                            }}
                                            className="mt-3 text-xs text-blue-600 hover:underline dark:text-blue-400"
                                        >
                                            清除筛选条件
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="p-2">
                            {/* 搜索结果提示 */}
                            {(searchQuery || filterVerified !== 'all') && !collapsed && (
                                <div className="mb-2 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between">
                                    <span>
                                        找到 {remoteSearchEnabled || remoteFilterEnabled ? accountsTotal : filteredAndSortedAccounts.length} 个结果
                                    </span>
                                    <button
                                        onClick={() => {
                                            setSearchQuery('')
                                            setFilterVerified('all')
                                        }}
                                        className="text-blue-600 hover:underline dark:text-blue-400"
                                    >
                                        清除
                                    </button>
                                </div>
                            )}

                            <div
                                className="relative"
                                style={{ height: accountVirtualizer.getTotalSize() }}
                            >
                                {virtualAccountItems.map((virtualItem) => {
                                    const account = filteredAndSortedAccounts[virtualItem.index]
                                    if (!account) return null

                                    return (
                                        <div
                                            key={virtualItem.key}
                                            className="absolute left-0 top-0 w-full pb-2"
                                            style={{
                                                height: virtualItem.size,
                                                transform: `translateY(${virtualItem.start}px)`,
                                            }}
                                        >
                                            {(() => {
                                        const providerInfo = getProviderInfo(account.mailProvider?.type || 'custom')
                                        const isSelected = selectedAccount?.id === account.id

                                        return (
                                                <div
                                                    data-account-id={account.id}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => onSelectAccount(account)}
                                                    onKeyDown={(e) => handleKeyDown(e, account)}
                                                    onContextMenu={(e) => {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                        // 打开该账户的右键菜单
                                                        setDropdownOpenAccountId(account.id)
                                                    }}
                                                    className={cn(
                                                        "group h-full rounded-xl p-3 cursor-pointer transition-all duration-200",
                                                        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800",
                                                        "hover:shadow-md hover:-translate-y-0.5",
                                                        isSelected
                                                            ? cn("border-2 shadow-md", providerInfo.bgColor, providerInfo.borderColor)
                                                            : "border border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                                    )}
                                                    style={{
                                                        animationDelay: `${Math.min(virtualItem.index, 12) * 20}ms`,
                                                    }}
                                                >
                                                    <div className="flex h-full items-center gap-3">
                                                        {/* 提供商图标 */}
                                                        <div className={cn(
                                                            "w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0 transition-transform duration-200",
                                                            isSelected ? "scale-110" : "scale-100",
                                                            providerInfo.bgColor
                                                        )}>
                                                            {providerInfo.icon}
                                                        </div>

                                                        {!collapsed && (
                                                            <div className="flex-1 min-w-0">
                                                                {/* 邮箱地址 */}
                                                                <p className={cn(
                                                                    "font-medium text-sm truncate transition-colors",
                                                                    isSelected
                                                                        ? "text-gray-900 dark:text-white"
                                                                        : "text-gray-700 dark:text-gray-200"
                                                                )}>
                                                                    {account.emailAddress}
                                                                </p>

                                                                {/* 提供商和状态 */}
                                                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                                                    <span className={cn(
                                                                        "text-xs font-medium px-1.5 py-0.5 rounded",
                                                                        providerInfo.bgColor,
                                                                        providerInfo.color
                                                                    )}>
                                                                        {account.mailProvider?.type?.toUpperCase() || 'CUSTOM'}
                                                                    </span>

                                                                    {/* 验证状态 */}
                                                                    <div className="flex items-center gap-1">
                                                                        {account.isVerified ? (
                                                                            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                                                        ) : (
                                                                            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                                                                        )}
                                                                    </div>

                                                                    {/* 同步状态指示器 */}
                                                                    {(() => {
                                                                        const syncInfo = getSyncStatusInfo(account.id)
                                                                        // 根据状态选择背景色
                                                                        const bgColor = syncInfo.status === 'normal'
                                                                            ? 'bg-green-100 dark:bg-green-900/30'
                                                                            : syncInfo.status === 'error'
                                                                                ? 'bg-red-100 dark:bg-red-900/30'
                                                                                : syncInfo.status === 'confirming'
                                                                                    ? 'bg-blue-100 dark:bg-blue-900/30'
                                                                                    : 'bg-gray-100 dark:bg-gray-700'
                                                                        return (
                                                                            <div
                                                                                className={cn(
                                                                                    "flex items-center gap-1 px-1.5 py-0.5 rounded-full",
                                                                                    bgColor
                                                                                )}
                                                                                title={syncInfo.tooltip}
                                                                            >
                                                                                <span className={syncInfo.statusColor}>
                                                                                    {syncInfo.statusIcon}
                                                                                </span>
                                                                                <span className={cn("text-[10px] whitespace-nowrap", syncInfo.statusColor)}>
                                                                                    {syncInfo.configText}
                                                                                </span>
                                                                                {syncInfo.timeText && (
                                                                                    <span className="text-[10px] whitespace-nowrap text-gray-500 dark:text-gray-400">
                                                                                        · {syncInfo.timeText}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        )
                                                                    })()}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* 右键菜单按钮 */}
                                                        {!collapsed && (
                                                            <DropdownMenu
                                                                open={dropdownOpenAccountId === account.id}
                                                                onOpenChange={(open) => {
                                                                    if (!open) {
                                                                        setDropdownOpenAccountId(null)
                                                                    }
                                                                }}
                                                            >
                                                                <DropdownMenuTrigger asChild>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            setDropdownOpenAccountId(account.id)
                                                                        }}
                                                                        className={cn(
                                                                            "p-1.5 rounded-md transition-colors shrink-0",
                                                                            dropdownOpenAccountId === account.id
                                                                                ? "opacity-100 bg-gray-200 dark:bg-gray-600"
                                                                                : "opacity-0 group-hover:opacity-100 focus:opacity-100",
                                                                            "hover:bg-gray-200 dark:hover:bg-gray-600",
                                                                            "focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                        )}
                                                                        title="更多操作（右键也可触发）"
                                                                    >
                                                                        <MoreHorizontal className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                                                                    </button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end" className="w-48">
                                                                    <DropdownMenuItem
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            openSyncConfigModal(account)
                                                                        }}
                                                                        className="cursor-pointer"
                                                                    >
                                                                        <Settings className="w-4 h-4 mr-2" />
                                                                        同步配置
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuSeparator />
                                                                    <DropdownMenuItem
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            setDropdownOpenAccountId(null)
                                                                            setSyncModalAccount(account)
                                                                            setShowSyncModal(true)
                                                                        }}
                                                                        className="cursor-pointer"
                                                                    >
                                                                        <RefreshCcw className="w-4 h-4 mr-2" />
                                                                        立即同步
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        )}

                                                        {/* 选中指示器 */}
                                                        {!collapsed && isSelected && (
                                                            <div className="shrink-0">
                                                                <div className="w-2 h-8 bg-blue-500 rounded-full" />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                        )
                                            })()}
                                        </div>
                                    )
                                })}
                            </div>

                            {!collapsed && (hasMoreAccounts || loadingMoreAccounts) && (
                                <div className="py-3 text-center">
                                    {loadingMoreAccounts ? (
                                        <div className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                            <span>加载更多账户...</span>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={onLoadMoreAccounts}
                                            className="rounded-md px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                                        >
                                            加载更多
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 底部操作区域 */}
                {!collapsed && (
                    <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                        <div className="flex items-center justify-between text-xs">
                            <div className="text-gray-500 dark:text-gray-400">
                                已加载 {accounts.length} / 共 {accountsTotal} 个邮箱
                                {!remoteSearchEnabled && !remoteFilterEnabled && filteredAndSortedAccounts.length !== accounts.length && (
                                    <span className="ml-1 text-blue-600 dark:text-blue-400">
                                        (显示 {filteredAndSortedAccounts.length})
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                    <CheckCircle2 className="w-3 h-3" />
                                    {accounts.filter(a => a.isVerified).length}
                                </span>
                                <span className="text-gray-300 dark:text-gray-600">/</span>
                                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                    <AlertCircle className="w-3 h-3" />
                                    {accounts.filter(a => !a.isVerified).length}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 同步配置模态框 */}
            <SyncConfigModal
                isOpen={showSyncConfigModal}
                onClose={() => {
                    setShowSyncConfigModal(false)
                    setSyncConfigForEdit(null)
                    setContextMenuAccount(null)
                }}
                onSuccess={handleSyncConfigSuccess}
                config={syncConfigForEdit}
                mode={syncConfigForEdit?.id ? "edit" : "create"}
            />

            {/* 立即同步模态框 */}
            <SyncAccountModal
                isOpen={showSyncModal}
                onClose={() => {
                    setShowSyncModal(false)
                    setSyncModalAccount(null)
                }}
                accountId={syncModalAccount?.id || null}
                accountEmail={syncModalAccount?.emailAddress || ''}
                onSuccess={() => {
                    toast.success('同步已开始', {
                        description: `邮箱 ${syncModalAccount?.emailAddress} 正在后台同步`
                    })
                    // 刷新同步状态
                    fetchSyncStatuses()
                }}
                onError={(error) => {
                    toast.error('同步失败', {
                        description: error
                    })
                }}
            />
        </>
    )
}
