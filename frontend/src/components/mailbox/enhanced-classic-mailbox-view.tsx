'use client'
import { logger } from '@/lib/logger';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
    Settings,
    Maximize2,
    Minimize2,
    Layout,
    Monitor,
    Smartphone,
    Tablet,
    RotateCcw,
    Save,
    ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmailAccount, Email } from '@/types'
import { emailAccountService } from '@/services/email-account.service'
import { emailService } from '@/services/email.service'
import EnhancedMailboxSidebar from './enhanced-mailbox-sidebar'
import EmailListPanel from './email-list-panel'
import EmailPreviewPanel from './email-preview-panel'
// EmailNotificationToast 已移至全局 providers.tsx
import { ResizableDivider } from './resizable-panel'
import { registerTabCallback, unregisterTabCallback } from '@/lib/tab-utils'

// 布局预设
interface LayoutPreset {
    name: string
    sidebarWidth: number
    emailListWidth: number
    sidebarCollapsed: boolean
}

const defaultPresets: LayoutPreset[] = [
    { name: '标准', sidebarWidth: 280, emailListWidth: 400, sidebarCollapsed: false },
    { name: '紧凑', sidebarWidth: 200, emailListWidth: 320, sidebarCollapsed: false },
    { name: '宽敞', sidebarWidth: 320, emailListWidth: 500, sidebarCollapsed: false },
    { name: '专注阅读', sidebarWidth: 60, emailListWidth: 350, sidebarCollapsed: true },
]

// 本地存储键
const LAYOUT_STORAGE_KEY = 'mailman-layout-config'

export default function EnhancedClassicMailboxView() {
    // 状态管理
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [selectedAccount, setSelectedAccount] = useState<EmailAccount | null>(null)
    const [emails, setEmails] = useState<Email[]>([])
    // 使用ID跟踪选中状态，而非完整对象引用，避免增量刷新时不必要的重新渲染
    const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadingEmails, setLoadingEmails] = useState(false)

    // 邮件方向筛选
    const [directionFilter, setDirectionFilter] = useState<'received' | 'sent' | 'all'>('received')

    // 布局状态
    const [sidebarWidth, setSidebarWidth] = useState(280)
    const [emailListWidth, setEmailListWidth] = useState(400)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [showLayoutMenu, setShowLayoutMenu] = useState(false)
    const [customPresets, setCustomPresets] = useState<LayoutPreset[]>([])
    const [isResizing, setIsResizing] = useState(false)

    // 响应式断点
    const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1920)
    const [isMobileView, setIsMobileView] = useState(false)
    const [activePanel, setActivePanel] = useState<'sidebar' | 'list' | 'preview'>('list')

    // 自动同步状态
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const autoSyncTimerRef = useRef<NodeJS.Timeout | null>(null)

    // 分页状态
    const [totalCount, setTotalCount] = useState(0)
    const [currentOffset, setCurrentOffset] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const PAGE_SIZE = 50

    // refs
    const selectedAccountRef = useRef<EmailAccount | null>(null)
    const loadingEmailsRef = useRef<boolean>(false)
    const isRefreshingRef = useRef<boolean>(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const layoutMenuRef = useRef<HTMLDivElement>(null)

    // 通过useMemo从emails数组中派生selectedEmail对象
    const selectedEmail = useMemo(() => {
        if (selectedEmailId === null) return null
        return emails.find(email => email.ID === selectedEmailId) || null
    }, [emails, selectedEmailId])

    // 最小/最大宽度限制
    const minSidebarWidth = 60
    const maxSidebarWidth = 400
    const minEmailListWidth = 280
    const maxEmailListWidth = 800

    // 响应式处理
    useEffect(() => {
        const handleResize = () => {
            const width = window.innerWidth
            setWindowWidth(width)

            // 设置移动视图模式
            if (width < 768) {
                setIsMobileView(true)
            } else if (width < 1024) {
                // 平板模式 - 可以折叠侧边栏
                setIsMobileView(false)
                if (!sidebarCollapsed && sidebarWidth > 200) {
                    setSidebarWidth(200)
                }
            } else {
                setIsMobileView(false)
            }
        }

        handleResize()
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [sidebarCollapsed, sidebarWidth])

    // 加载保存的布局配置
    useEffect(() => {
        try {
            const savedConfig = localStorage.getItem(LAYOUT_STORAGE_KEY)
            if (savedConfig) {
                const config = JSON.parse(savedConfig)
                setSidebarWidth(config.sidebarWidth || 280)
                setEmailListWidth(config.emailListWidth || 400)
                setSidebarCollapsed(config.sidebarCollapsed || false)
                setCustomPresets(config.customPresets || [])
            }
        } catch (e) {
            console.error('Failed to load layout config:', e)
        }
    }, [])

    // 保存布局配置
    const saveLayoutConfig = useCallback(() => {
        try {
            const config = {
                sidebarWidth,
                emailListWidth,
                sidebarCollapsed,
                customPresets
            }
            localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(config))
        } catch (e) {
            console.error('Failed to save layout config:', e)
        }
    }, [sidebarWidth, emailListWidth, sidebarCollapsed, customPresets])

    // 自动保存布局
    useEffect(() => {
        const timer = setTimeout(saveLayoutConfig, 500)
        return () => clearTimeout(timer)
    }, [saveLayoutConfig])

    // 点击外部关闭布局菜单
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
                setShowLayoutMenu(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // 应用布局预设
    const applyPreset = (preset: LayoutPreset) => {
        setSidebarWidth(preset.sidebarWidth)
        setEmailListWidth(preset.emailListWidth)
        setSidebarCollapsed(preset.sidebarCollapsed)
        setShowLayoutMenu(false)
    }

    // 保存当前布局为预设
    const saveAsPreset = () => {
        const name = prompt('请输入预设名称:')
        if (name) {
            const newPreset: LayoutPreset = {
                name,
                sidebarWidth,
                emailListWidth,
                sidebarCollapsed
            }
            setCustomPresets(prev => [...prev, newPreset])
        }
    }

    // 重置为默认布局
    const resetLayout = () => {
        setSidebarWidth(280)
        setEmailListWidth(400)
        setSidebarCollapsed(false)
        setShowLayoutMenu(false)
    }

    // 处理侧边栏宽度调整
    const handleSidebarResize = useCallback((delta: number) => {
        setIsResizing(true)
        const effectiveSidebarWidth = sidebarCollapsed ? minSidebarWidth : sidebarWidth
        const newWidth = Math.min(maxSidebarWidth, Math.max(minSidebarWidth, effectiveSidebarWidth + delta))

        if (newWidth <= minSidebarWidth + 20) {
            setSidebarCollapsed(true)
            setSidebarWidth(minSidebarWidth)
        } else {
            setSidebarCollapsed(false)
            setSidebarWidth(newWidth)
        }

        // 延迟重置 resizing 状态，让过渡动画生效
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setIsResizing(false)
            })
        })
    }, [sidebarCollapsed, sidebarWidth, minSidebarWidth, maxSidebarWidth])

    // 处理邮件列表宽度调整
    const handleEmailListResize = useCallback((delta: number) => {
        setIsResizing(true)
        setEmailListWidth(prev =>
            Math.min(maxEmailListWidth, Math.max(minEmailListWidth, prev + delta))
        )

        // 延迟重置 resizing 状态
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setIsResizing(false)
            })
        })
    }, [minEmailListWidth, maxEmailListWidth])

    // 切换侧边栏折叠状态
    const toggleSidebar = () => {
        if (sidebarCollapsed) {
            setSidebarCollapsed(false)
            setSidebarWidth(280)
        } else {
            setSidebarCollapsed(true)
            setSidebarWidth(minSidebarWidth)
        }
    }

    // 加载所有邮箱账户
    const loadAccounts = async () => {
        try {
            setLoading(true)
            const accountsData = await emailAccountService.getAccounts()
            setAccounts(accountsData)

            if (accountsData.length > 0 && !selectedAccount) {
                setSelectedAccount(accountsData[0])
            }
        } catch (error) {
            console.error('Failed to load accounts:', error)
        } finally {
            setLoading(false)
        }
    }

    // 深度比较邮件
    const deepCompareEmails = (email1: Email, email2: Email): boolean => {
        return (
            email1.Subject === email2.Subject &&
            email1.Body === email2.Body &&
            email1.HTMLBody === email2.HTMLBody &&
            email1.Date === email2.Date &&
            email1.From === email2.From &&
            JSON.stringify(email1.Attachments) === JSON.stringify(email2.Attachments)
        )
    }

    // 增量更新邮件列表
    const updateEmailsIncremental = (newEmails: Email[]) => {
        setEmails(currentEmails => {
            const currentEmailMap = new Map(currentEmails.map(email => [email.ID, email]))
            const newEmailMap = new Map(newEmails.map(email => [email.ID, email]))

            const mergedEmails: Email[] = []
            const addedIds = new Set<number>()

            currentEmails.forEach(email => {
                if (newEmailMap.has(email.ID)) {
                    const newEmail = newEmailMap.get(email.ID)!
                    if (deepCompareEmails(email, newEmail)) {
                        mergedEmails.push(email)
                    } else {
                        mergedEmails.push(newEmail)
                    }
                    addedIds.add(email.ID)
                } else {
                    mergedEmails.push(email)
                }
            })

            newEmails.forEach(email => {
                if (!addedIds.has(email.ID)) {
                    mergedEmails.push(email)
                }
            })

            return mergedEmails.sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime())
        })
        // 不再需要手动更新 selectedEmail，因为它会通过 useMemo 自动从 emails 中获取
    }

    // 加载邮件（支持分页）
    const loadEmails = async (account: EmailAccount | null, searchQuery?: string, isAutoSync = false, appendMode = false) => {
        if (!account) {
            setEmails([])
            setTotalCount(0)
            setHasMore(false)
            return
        }

        try {
            if (!isAutoSync && !appendMode) {
                setLoadingEmails(true)
                setCurrentOffset(0)
            }
            if (appendMode) {
                setLoadingMore(true)
            }
            loadingEmailsRef.current = true

            const offset = appendMode ? currentOffset + PAGE_SIZE : 0
            const emailsData = await emailService.searchEmails({
                keyword: searchQuery,
                limit: PAGE_SIZE,
                offset: offset,
                sort_by: 'date',
                direction: directionFilter
            }, account.id)

            // 解析响应数据
            const emailList = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])
            const pagination = (emailsData as any).pagination || {}
            const total = pagination.total || emailList.length
            const moreAvailable = pagination.has_next || false

            if (isAutoSync) {
                updateEmailsIncremental(emailList)
            } else if (appendMode) {
                // 追加模式：合并新邮件
                setEmails(prev => [...prev, ...emailList])
                setCurrentOffset(offset)
            } else {
                // 首次加载：替换邮件列表
                setEmails(emailList)
                setCurrentOffset(0)
            }

            setTotalCount(total)
            setHasMore(moreAvailable)

            if (selectedEmailId !== null && selectedAccount?.id !== account.id) {
                setSelectedEmailId(null)
            }
        } catch (error) {
            console.error('Failed to load emails:', error)
            if (!isAutoSync && !appendMode) {
                setEmails([])
                setTotalCount(0)
                setHasMore(false)
            }
        } finally {
            if (!isAutoSync) {
                setLoadingEmails(false)
            }
            if (appendMode) {
                setLoadingMore(false)
            }
            loadingEmailsRef.current = false
        }
    }

    // 加载更多邮件
    const handleLoadMore = async () => {
        if (selectedAccount && hasMore && !loadingMore) {
            await loadEmails(selectedAccount, undefined, false, true)
        }
    }

    // 选择账户
    const handleSelectAccount = (account: EmailAccount) => {
        setSelectedAccount(account)
        setSelectedEmailId(null)
        loadEmails(account, undefined, false)

        // 移动端自动切换到邮件列表
        if (isMobileView) {
            setActivePanel('list')
        }
    }

    // 选择邮件
    const handleSelectEmail = useCallback(async (email: Email) => {
        // 先立即设置选中状态，实现快速响应
        setSelectedEmailId(email.ID)

        // 移动端自动切换到预览面板
        if (isMobileView) {
            setActivePanel('preview')
        }

        // 如果邮件有附件但附件列表为空，从API获取完整邮件信息
        if (email.HasAttachments && (!email.Attachments || email.Attachments.length === 0)) {
            logger.debug('[Debug] Fetching full email for attachments...', email.ID);
            try {
                const fullEmail = await emailService.getEmail(email.ID)
                logger.debug('[Debug] Full email fetched:', fullEmail);
                if (fullEmail) {
                    logger.debug('[Debug] Has Attachments?', fullEmail.Attachments?.length);
                    // 更新邮件列表中的这封邮件，让useMemo自动更新selectedEmail
                    setEmails(prevEmails =>
                        prevEmails.map(e => e.ID === email.ID ? fullEmail : e)
                    )
                }
            } catch (error) {
                console.error('Failed to fetch full email details:', error)
            }
        } else {
            logger.debug('[Debug] Email already has attachments or no need to fetch:', email.Attachments);
        }
    }, [])

    // 搜索邮件
    const handleSearchEmails = (query: string) => {
        loadEmails(selectedAccount, query)
    }

    // 手动刷新
    const handleRefreshEmails = async () => {
        if (!selectedAccount) return

        setIsRefreshing(true)
        isRefreshingRef.current = true
        try {
            await loadEmails(selectedAccount, undefined, false)
        } catch (error) {
            console.error('Manual refresh failed:', error)
        } finally {
            setIsRefreshing(false)
            isRefreshingRef.current = false
        }
    }

    // 自动同步
    const startAutoSync = () => {
        if (autoSyncTimerRef.current) {
            clearInterval(autoSyncTimerRef.current)
        }

        autoSyncTimerRef.current = setInterval(() => {
            const currentAccount = selectedAccountRef.current
            const currentLoadingEmails = loadingEmailsRef.current
            const currentIsRefreshing = isRefreshingRef.current

            if (!currentAccount || currentLoadingEmails || currentIsRefreshing) {
                return
            }

            loadEmails(currentAccount, undefined, true)
        }, 1000)
    }

    const stopAutoSync = () => {
        if (autoSyncTimerRef.current) {
            clearInterval(autoSyncTimerRef.current)
            autoSyncTimerRef.current = null
        }
    }

    const toggleAutoSync = () => {
        const newAutoSyncEnabled = !autoSyncEnabled
        setAutoSyncEnabled(newAutoSyncEnabled)

        if (newAutoSyncEnabled) {
            startAutoSync()
        } else {
            stopAutoSync()
        }
    }

    // 通知点击处理已移至全局（providers.tsx 中的 EmailNotificationToast）

    // 同步 ref
    useEffect(() => {
        selectedAccountRef.current = selectedAccount
    }, [selectedAccount])

    useEffect(() => {
        loadingEmailsRef.current = loadingEmails
    }, [loadingEmails])

    useEffect(() => {
        isRefreshingRef.current = isRefreshing
    }, [isRefreshing])

    // 初始加载
    useEffect(() => {
        loadAccounts()
    }, [])

    useEffect(() => {
        if (selectedAccount) {
            loadEmails(selectedAccount, undefined, false)
        }
    }, [selectedAccount, directionFilter])

    useEffect(() => {
        return () => {
            stopAutoSync()
        }
    }, [])

    // 处理 locateEmail 回调 - 从全局搜索定位到具体邮件
    const handleLocateEmail = useCallback(async (data: any) => {
        if (!data?.locateEmail) return

        const { accountId, emailId } = data.locateEmail
        logger.debug('[EnhancedClassicMailboxView] 收到定位邮件请求:', { accountId, emailId })

        // 找到对应的账户
        let targetAccount = accounts.find(acc => acc.id === accountId)

        // 如果账户还没加载，重新加载
        if (!targetAccount) {
            try {
                const accountsData = await emailAccountService.getAccounts()
                setAccounts(accountsData)
                targetAccount = accountsData.find((acc: EmailAccount) => acc.id === accountId)
            } catch (error) {
                console.error('加载账户失败:', error)
                return
            }
        }

        if (!targetAccount) {
            console.warn('未找到账户:', accountId)
            return
        }

        // 选中账户
        setSelectedAccount(targetAccount)

        // 如果没有提供 emailId，只选中账户即可（账户的邮件会自动加载）
        if (!emailId) {
            logger.debug('[EnhancedClassicMailboxView] 仅选中账户，不定位具体邮件')
            return
        }

        // 加载该账户的邮件并定位到目标邮件
        try {
            setLoadingEmails(true)
            const emailsData = await emailService.searchEmails({
                limit: PAGE_SIZE,
                offset: 0,
                sort_by: 'date_desc'
            }, accountId)

            const emailList = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])
            const pagination = (emailsData as any).pagination || {}
            const total = pagination.total || emailList.length
            const moreAvailable = pagination.has_next || false

            setEmails(emailList)
            setTotalCount(total)
            setHasMore(moreAvailable)
            setCurrentOffset(0)

            // 查找目标邮件
            let targetEmail = emailList.find((e: Email) => e.ID === emailId)

            // 如果在当前批次中没找到，尝试直接获取邮件详情
            if (!targetEmail) {
                try {
                    targetEmail = await emailService.getEmail(emailId)
                } catch (error) {
                    console.warn('获取邮件详情失败:', error)
                }
            }

            if (targetEmail) {
                setSelectedEmailId(targetEmail.ID)
            } else {
                console.warn('未找到邮件:', emailId)
            }

        } catch (error) {
            console.error('加载邮件失败:', error)
        } finally {
            setLoadingEmails(false)
        }
    }, [accounts])

    // 注册 Tab 回调以接收定位邮件请求
    useEffect(() => {
        registerTabCallback('classic-mailbox', 'onReady', handleLocateEmail)

        // 通知 MainPage 回调已注册
        const event = new CustomEvent('tabCallbackRegistered', {
            detail: { tabId: 'classic-mailbox', callbackName: 'onReady' }
        })
        window.dispatchEvent(event)

        return () => {
            unregisterTabCallback('classic-mailbox', 'onReady')
        }
    }, [handleLocateEmail])

    // 移动端视图
    if (isMobileView) {
        return (
            <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
                {/* 移动端顶部导航 */}
                <div className="flex-shrink-0 flex items-center justify-between bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
                    <div className="flex items-center gap-2">
                        {activePanel === 'preview' && (
                            <button
                                onClick={() => setActivePanel('list')}
                                className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                            >
                                ←
                            </button>
                        )}
                        {activePanel === 'list' && selectedAccount && (
                            <button
                                onClick={() => setActivePanel('sidebar')}
                                className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                            >
                                ←
                            </button>
                        )}
                        <span className="font-medium text-gray-900 dark:text-white">
                            {activePanel === 'sidebar' && '选择邮箱'}
                            {activePanel === 'list' && (selectedAccount?.emailAddress || '邮件列表')}
                            {activePanel === 'preview' && (selectedEmail?.Subject || '邮件详情')}
                        </span>
                    </div>
                </div>

                {/* 内容区域 */}
                <div className="flex-1 overflow-hidden">
                    {activePanel === 'sidebar' && (
                        <EnhancedMailboxSidebar
                            accounts={accounts}
                            selectedAccount={selectedAccount}
                            onSelectAccount={handleSelectAccount}
                            collapsed={false}
                            onToggleCollapse={() => { }}
                            loading={loading}
                        />
                    )}
                    {activePanel === 'list' && (
                        <EmailListPanel
                            emails={emails}
                            selectedEmailId={selectedEmailId}
                            onSelectEmail={handleSelectEmail}
                            onSearch={handleSearchEmails}
                            onRefresh={handleRefreshEmails}
                            loading={loadingEmails}
                            selectedAccount={selectedAccount}
                            autoSyncEnabled={autoSyncEnabled}
                            onToggleAutoSync={toggleAutoSync}
                            isRefreshing={isRefreshing}
                            totalCount={totalCount}
                            hasMore={hasMore}
                            onLoadMore={handleLoadMore}
                            loadingMore={loadingMore}
                            directionFilter={directionFilter}
                            onDirectionChange={setDirectionFilter}
                        />
                    )}
                    {activePanel === 'preview' && (
                        <EmailPreviewPanel
                            email={selectedEmail}
                            loading={loadingEmails}
                            accountId={selectedAccount?.id}
                        />
                    )}
                </div>

                {/* EmailNotificationToast 已移至全局 */}
            </div>
        )
    }

    // 桌面端视图
    return (
        <div className="h-full" ref={containerRef}>
            <div className="h-full flex bg-gray-50 dark:bg-gray-900">
                {/* 左侧邮箱列表 */}
                <div
                    className="border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0"
                    style={{
                        width: sidebarCollapsed ? minSidebarWidth : sidebarWidth,
                        transition: isResizing ? 'none' : 'width 0.15s ease-out',
                        willChange: isResizing ? 'width' : 'auto'
                    }}
                >
                    <EnhancedMailboxSidebar
                        accounts={accounts}
                        selectedAccount={selectedAccount}
                        onSelectAccount={handleSelectAccount}
                        collapsed={sidebarCollapsed}
                        onToggleCollapse={toggleSidebar}
                        loading={loading}
                    />
                </div>

                {/* 侧边栏分隔线 */}
                <ResizableDivider onResize={handleSidebarResize} />

                {/* 中间邮件列表 */}
                <div
                    className="flex-shrink-0 bg-white dark:bg-gray-800"
                    style={{
                        width: emailListWidth,
                        transition: isResizing ? 'none' : 'width 0.15s ease-out',
                        willChange: isResizing ? 'width' : 'auto'
                    }}
                >
                    <EmailListPanel
                        emails={emails}
                        selectedEmailId={selectedEmailId}
                        onSelectEmail={handleSelectEmail}
                        onSearch={handleSearchEmails}
                        onRefresh={handleRefreshEmails}
                        loading={loadingEmails}
                        selectedAccount={selectedAccount}
                        autoSyncEnabled={autoSyncEnabled}
                        onToggleAutoSync={toggleAutoSync}
                        isRefreshing={isRefreshing}
                        totalCount={totalCount}
                        hasMore={hasMore}
                        onLoadMore={handleLoadMore}
                        loadingMore={loadingMore}
                        directionFilter={directionFilter}
                        onDirectionChange={setDirectionFilter}
                    />
                </div>

                {/* 邮件列表分隔线 */}
                <ResizableDivider onResize={handleEmailListResize} />

                {/* 右侧邮件预览 */}
                <div className="flex-1 min-w-[300px] bg-white dark:bg-gray-800 relative">
                    <EmailPreviewPanel
                        email={selectedEmail}
                        loading={loadingEmails}
                        accountId={selectedAccount?.id}
                    />

                    {/* 布局控制按钮 */}
                    <div className="absolute top-3 right-3 z-10" ref={layoutMenuRef}>
                        <button
                            onClick={() => setShowLayoutMenu(!showLayoutMenu)}
                            className={cn(
                                "p-2 rounded-lg transition-all duration-200",
                                showLayoutMenu
                                    ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                            )}
                            title="布局设置"
                        >
                            <Layout className="h-4 w-4" />
                        </button>

                        {/* 布局菜单 */}
                        {showLayoutMenu && (
                            <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 py-2 animate-fade-in">
                                <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                                    布局预设
                                </div>
                                {defaultPresets.map((preset) => (
                                    <button
                                        key={preset.name}
                                        onClick={() => applyPreset(preset)}
                                        className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        <Layout className="h-4 w-4 text-gray-400" />
                                        {preset.name}
                                    </button>
                                ))}

                                {customPresets.length > 0 && (
                                    <>
                                        <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
                                        <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                                            自定义预设
                                        </div>
                                        {customPresets.map((preset, index) => (
                                            <button
                                                key={`custom-${index}`}
                                                onClick={() => applyPreset(preset)}
                                                className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                            >
                                                <Layout className="h-4 w-4 text-blue-400" />
                                                {preset.name}
                                            </button>
                                        ))}
                                    </>
                                )}

                                <div className="border-t border-gray-200 dark:border-gray-700 my-2" />

                                <button
                                    onClick={saveAsPreset}
                                    className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                >
                                    <Save className="h-4 w-4 text-gray-400" />
                                    保存当前布局
                                </button>
                                <button
                                    onClick={resetLayout}
                                    className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                                >
                                    <RotateCcw className="h-4 w-4 text-gray-400" />
                                    重置为默认
                                </button>

                                <div className="border-t border-gray-200 dark:border-gray-700 my-2" />

                                <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Monitor className="h-3 w-3" />
                                        当前尺寸
                                    </div>
                                    <div className="text-gray-400">
                                        侧边栏: {sidebarCollapsed ? minSidebarWidth : sidebarWidth}px |
                                        列表: {emailListWidth}px
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* EmailNotificationToast 已移至全局 */}
        </div>
    )
}
