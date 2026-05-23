'use client'
import { logger } from '@/lib/logger';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmailAccount, Email } from '@/types'
import { emailAccountService } from '@/services/email-account.service'
import { emailService } from '@/services/email.service'
import MailboxSidebar from './mailbox-sidebar'
import EmailListPanel from './email-list-panel'
import EmailPreviewPanel from './email-preview-panel'
// EmailNotificationToast 已移至全局 providers.tsx

export default function ClassicMailboxView() {
    // 状态管理
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [selectedAccount, setSelectedAccount] = useState<EmailAccount | null>(null)
    const [emails, setEmails] = useState<Email[]>([])
    // 使用ID跟踪选中状态，而非完整对象引用，避免增量刷新时不必要的重新渲染
    const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [loading, setLoading] = useState(true)
    const [loadingEmails, setLoadingEmails] = useState(false)

    // 邮件方向筛选
    const [directionFilter, setDirectionFilter] = useState<'received' | 'sent' | 'all'>('received')

    // 自动同步功能状态
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const autoSyncTimerRef = useRef<NodeJS.Timeout | null>(null)

    // 使用ref保持对最新状态的引用，解决定时器闭包问题
    const selectedAccountRef = useRef<EmailAccount | null>(null)
    const loadingEmailsRef = useRef<boolean>(false)
    const isRefreshingRef = useRef<boolean>(false)

    // 通过useMemo从emails数组中派生selectedEmail对象
    // 这样当emails变化但选中的邮件ID不变时，selectedEmail会自动获取最新数据
    // 且不会触发不必要的重新渲染（因为ID没变）
    const selectedEmail = useMemo(() => {
        if (selectedEmailId === null) return null
        return emails.find(email => email.ID === selectedEmailId) || null
    }, [emails, selectedEmailId])

    // 加载所有邮箱账户
    const loadAccounts = async () => {
        try {
            setLoading(true)
            const accountsData = await emailAccountService.getAccounts()
            setAccounts(accountsData)

            // 默认选择第一个账户
            if (accountsData.length > 0 && !selectedAccount) {
                setSelectedAccount(accountsData[0])
            }
        } catch (error) {
            console.error('Failed to load accounts:', error)
        } finally {
            setLoading(false)
        }
    }

    // 深度比较邮件是否相同
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
    // 注意：现在我们使用 selectedEmailId 跟踪选中状态，
    // selectedEmail 通过 useMemo 自动从 emails 数组获取最新数据
    // 因此不需要在这里手动更新 selectedEmail
    const updateEmailsIncremental = useCallback((newEmails: Email[]) => {
        setEmails(currentEmails => {
            // 创建现有邮件的Map，用ID作为key
            const currentEmailMap = new Map(currentEmails.map(email => [email.ID, email]))
            const newEmailMap = new Map(newEmails.map(email => [email.ID, email]))

            // 合并邮件，保持现有邮件顺序，添加新邮件
            const mergedEmails: Email[] = []
            const addedIds = new Set<number>()

            // 保留现有邮件，只有内容变化时才更新引用
            currentEmails.forEach(email => {
                if (newEmailMap.has(email.ID)) {
                    const newEmail = newEmailMap.get(email.ID)!
                    // 深度比较邮件内容，如果相同则保留原有引用
                    if (deepCompareEmails(email, newEmail)) {
                        mergedEmails.push(email) // 保留原有引用，避免不必要的重新渲染
                    } else {
                        mergedEmails.push(newEmail) // 内容有变化，使用新数据
                        logger.debug('📧 邮件内容已更新:', email.Subject)
                    }
                    addedIds.add(email.ID)
                } else {
                    // 邮件在新数据中不存在，保留原有邮件
                    mergedEmails.push(email)
                }
            })

            // 添加新邮件（在新数据中但不在现有数据中的）
            newEmails.forEach(email => {
                if (!addedIds.has(email.ID)) {
                    mergedEmails.push(email)
                    logger.debug('📧 新邮件添加:', email.Subject)
                }
            })

            // 按日期排序
            return mergedEmails.sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime())
        })
        // 不再需要手动更新 selectedEmail，因为它会通过 useMemo 自动从 emails 中获取
    }, [])

    // 加载选中账户的邮件
    const loadEmails = async (account: EmailAccount | null, searchQuery?: string, isAutoSync = false) => {
        if (!account) {
            setEmails([])
            return
        }

        try {
            if (!isAutoSync) {
                setLoadingEmails(true)
            }
            loadingEmailsRef.current = true

            // 使用现有的邮件搜索API，传递账户ID和方向筛选
            const emailsData = await emailService.searchEmails({
                keyword: searchQuery,
                limit: 100,
                sort_by: 'date',
                direction: directionFilter
            }, account.id)

            // 根据API响应结构调整
            const emailList = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])

            if (isAutoSync) {
                // 自动同步时使用增量更新
                updateEmailsIncremental(emailList)
            } else {
                // 手动操作时直接替换
                setEmails(emailList)
            }

            // 清除当前选中的邮件（如果切换了账户）
            if (selectedEmailId !== null && selectedAccount?.id !== account.id) {
                setSelectedEmailId(null)
            }
        } catch (error) {
            console.error('Failed to load emails:', error)
            if (!isAutoSync) {
                setEmails([])
            }
        } finally {
            if (!isAutoSync) {
                setLoadingEmails(false)
            }
            loadingEmailsRef.current = false
        }
    }

    // 选择账户
    const handleSelectAccount = useCallback((account: EmailAccount) => {
        setSelectedAccount(account)
        setSelectedEmailId(null) // 清除选中的邮件
        loadEmails(account, undefined, false)
    }, [])

    // 选择邮件 - 使用 useCallback 确保引用稳定，避免不必要的子组件重新渲染
    const handleSelectEmail = useCallback((email: Email) => {
        setSelectedEmailId(email.ID)
    }, [])

    // 搜索邮件
    const handleSearchEmails = (query: string) => {
        loadEmails(selectedAccount, query)
    }

    // 手动刷新邮件
    const handleRefreshEmails = async () => {
        if (!selectedAccount) return

        setIsRefreshing(true)
        isRefreshingRef.current = true
        try {
            await loadEmails(selectedAccount, undefined, false) // 手动刷新不使用增量更新
            logger.debug('📧 手动刷新邮件完成')
        } catch (error) {
            console.error('❌ 手动刷新邮件失败:', error)
        } finally {
            setIsRefreshing(false)
            isRefreshingRef.current = false
        }
    }

    // 自动同步功能
    const startAutoSync = () => {
        if (autoSyncTimerRef.current) {
            clearInterval(autoSyncTimerRef.current)
        }

        autoSyncTimerRef.current = setInterval(() => {
            // 使用ref获取最新状态，避免闭包问题
            const currentAccount = selectedAccountRef.current
            const currentLoadingEmails = loadingEmailsRef.current
            const currentIsRefreshing = isRefreshingRef.current

            // 检查当前选中的邮箱账户
            if (!currentAccount) {
                logger.debug('⏭️ 自动同步跳过：没有选中账户')
                return
            }

            // 如果正在加载邮件，跳过本次执行
            if (currentLoadingEmails || currentIsRefreshing) {
                logger.debug('⏭️ 自动同步跳过：正在加载中')
                return
            }

            logger.debug('🔄 自动同步执行：', currentAccount.emailAddress)
            loadEmails(currentAccount, undefined, true) // 自动同步使用增量更新
        }, 1000) // 每秒执行一次

        logger.debug('✅ 自动同步已启动')
    }

    const stopAutoSync = () => {
        if (autoSyncTimerRef.current) {
            clearInterval(autoSyncTimerRef.current)
            autoSyncTimerRef.current = null
        }
        logger.debug('🛑 自动同步已停止')
    }

    // 切换自动同步状态
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

    // 切换侧边栏
    const toggleSidebar = () => {
        setSidebarCollapsed(!sidebarCollapsed)
    }

    // 同步状态到ref
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

    // 当选中账户或方向筛选变化时加载邮件
    useEffect(() => {
        if (selectedAccount) {
            loadEmails(selectedAccount, undefined, false) // 切换账户或方向时不使用增量更新
        }
    }, [selectedAccount, directionFilter])

    // 组件卸载时清理定时器
    useEffect(() => {
        return () => {
            stopAutoSync()
        }
    }, [])

    return (
        <div style={
            {
                height: '100%', // 减去外层容器的padding
            }
        }>
            <div className="h-screen flex bg-gray-50 dark:bg-gray-900">
                {/* 左侧邮箱列表 */}
                <div className={cn(
                    "transition-all duration-300 ease-in-out border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800",
                    sidebarCollapsed ? "w-16" : "w-80"
                )}>
                    <MailboxSidebar
                        accounts={accounts}
                        selectedAccount={selectedAccount}
                        onSelectAccount={handleSelectAccount}
                        collapsed={sidebarCollapsed}
                        onToggleCollapse={toggleSidebar}
                        loading={loading}
                    />
                </div>

                {/* 右侧主内容区域 */}
                <div className="flex-1 flex min-w-0">
                    {/* 中间邮件列表 */}
                    <div className="w-1/2 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
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
                            totalCount={emails.length}
                            hasMore={false}
                            onLoadMore={async () => { }}
                            loadingMore={false}
                            directionFilter={directionFilter}
                            onDirectionChange={(direction) => {
                                setDirectionFilter(direction)
                                loadEmails(selectedAccount, undefined, false)
                            }}
                        />
                    </div>

                    {/* 右侧邮件预览 */}
                    <div className="w-1/2 bg-white dark:bg-gray-800">
                        <EmailPreviewPanel
                            email={selectedEmail}
                            loading={loadingEmails}
                        />
                    </div>
                </div>
            </div>

            {/* EmailNotificationToast 已移至全局 */}
        </div>
    )
}
