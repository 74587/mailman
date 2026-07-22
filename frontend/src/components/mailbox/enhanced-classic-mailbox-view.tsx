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
import { emailService, EmailSearchParams } from '@/services/email.service'
import { syncConfigService, SyncConfig } from '@/services/sync-config.service'
import EnhancedMailboxSidebar, {
    type MailboxAccountSortBy,
    type MailboxAccountSortOrder,
    type MailboxAccountVerifiedFilter,
} from './enhanced-mailbox-sidebar'
import EmailListPanel from './email-list-panel'
import EmailPreviewPanel from './email-preview-panel'
import TemporarySyncPromptModal from '@/components/modals/temporary-sync-prompt-modal'
// EmailNotificationToast 已移至全局 providers.tsx
import { ResizableDivider } from './resizable-panel'
import { registerTabCallback, unregisterTabCallback } from '@/lib/tab-utils'
import { toast } from 'sonner'
import { useAISkill, type AISkill, type AISkillAction } from '@/components/ai'

// 布局预设
interface LayoutPreset {
    name: string
    sidebarWidth: number
    emailListWidth: number
    sidebarCollapsed: boolean
}

const defaultPresets: LayoutPreset[] = [
    { name: '标准', sidebarWidth: 360, emailListWidth: 480, sidebarCollapsed: false },
    { name: '紧凑', sidebarWidth: 280, emailListWidth: 400, sidebarCollapsed: false },
    { name: '宽敞', sidebarWidth: 420, emailListWidth: 560, sidebarCollapsed: false },
    { name: '专注阅读', sidebarWidth: 60, emailListWidth: 440, sidebarCollapsed: true },
]

// 本地存储键
const LAYOUT_STORAGE_KEY = 'mailman-layout-config'
const LAYOUT_CONFIG_VERSION = 2
const DESKTOP_DIVIDER_WIDTH = 12
const MIN_SIDEBAR_WIDTH = 60
const MAX_SIDEBAR_WIDTH = 520
const MIN_EMAIL_LIST_WIDTH = 360
const MAX_EMAIL_LIST_WIDTH = 760
const SYNC_WARNING_INTERVAL_SECONDS = 30
const DEFAULT_TEMP_SYNC_FOLDERS = ['INBOX']
const AI_EMAIL_CONTEXT_PREVIEW_LIMIT = 1600
const AI_EMAIL_ACTION_BODY_LIMIT = 6000
const ACCOUNT_PAGE_SIZE = 50
const ACCOUNT_SEARCH_DEBOUNCE_MS = 250

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const readPositiveInteger = (value: unknown) => {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0
}

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

const trimForAI = (value: string, limit: number) => {
    const text = normalizeWhitespace(value)
    if (text.length <= limit) return text
    return `${text.slice(0, limit)}...`
}

const emailAddressList = (value?: string[] | string | null) => {
    if (!value) return ''
    if (Array.isArray(value)) return value.filter(Boolean).join(', ')
    return value
}

const htmlToPlainText = (value?: string) => {
    if (!value) return ''
    return value
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
}

const emailBodyForAI = (email: Email, limit: number) => {
    const body = email.Body || htmlToPlainText(email.HTMLBody)
    return trimForAI(body || '', limit)
}

const summarizeEmailForAI = (email: Email, bodyLimit = AI_EMAIL_CONTEXT_PREVIEW_LIMIT) => {
    const attachments = email.Attachments || []
    return {
        id: email.ID,
        messageId: email.MessageID,
        accountId: email.AccountID,
        mailboxName: email.MailboxName,
        subject: email.Subject || '(无主题)',
        from: emailAddressList(email.From),
        to: emailAddressList(email.To),
        cc: emailAddressList(email.Cc),
        date: email.Date,
        size: email.Size,
        flags: email.Flags || [],
        hasAttachments: Boolean(email.HasAttachments || attachments.length > 0),
        attachmentCount: attachments.length,
        attachments: attachments.slice(0, 5).map(attachment => ({
            filename: attachment.Filename || attachment.filename || '附件',
            contentType: attachment.MIMEType || attachment.ContentType || attachment.content_type || '',
            size: attachment.Size || attachment.size || 0,
        })),
        bodyPreview: emailBodyForAI(email, bodyLimit),
        bodySource: email.Body ? 'text' : email.HTMLBody ? 'html' : 'empty',
    }
}

const getAdaptiveLayout = (containerWidth: number) => {
    const availableWidth = Math.max(containerWidth - DESKTOP_DIVIDER_WIDTH, 0)
    const isNarrowDesktop = containerWidth < 1180
    const previewMinWidth = isNarrowDesktop ? 320 : 380
    const sidebarMinWidth = isNarrowDesktop ? 280 : 340
    const listMinWidth = isNarrowDesktop ? 380 : 440

    let sidebarWidth = clamp(Math.round(availableWidth * 0.3), sidebarMinWidth, 420)
    let emailListWidth = clamp(Math.round(availableWidth * 0.36), listMinWidth, 560)
    const maxFixedWidth = Math.max(availableWidth - previewMinWidth, MIN_SIDEBAR_WIDTH + MIN_EMAIL_LIST_WIDTH)

    if (sidebarWidth + emailListWidth > maxFixedWidth) {
        const overflow = sidebarWidth + emailListWidth - maxFixedWidth
        const listReduction = Math.min(overflow, emailListWidth - MIN_EMAIL_LIST_WIDTH)
        emailListWidth -= listReduction

        const remainingOverflow = overflow - listReduction
        if (remainingOverflow > 0) {
            sidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, sidebarWidth - remainingOverflow)
        }
    }

    return { sidebarWidth, emailListWidth }
}

const fitLayoutToContainer = (
    containerWidth: number,
    requestedSidebarWidth: number,
    requestedEmailListWidth: number,
    sidebarCollapsed: boolean
) => {
    const availableWidth = Math.max(containerWidth - DESKTOP_DIVIDER_WIDTH, 0)
    const previewMinWidth = containerWidth < 1180 ? 320 : 380
    const maxFixedWidth = Math.max(availableWidth - previewMinWidth, MIN_SIDEBAR_WIDTH + MIN_EMAIL_LIST_WIDTH)

    let sidebarWidth = sidebarCollapsed
        ? MIN_SIDEBAR_WIDTH
        : clamp(requestedSidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
    let emailListWidth = clamp(requestedEmailListWidth, MIN_EMAIL_LIST_WIDTH, MAX_EMAIL_LIST_WIDTH)

    if (sidebarWidth + emailListWidth > maxFixedWidth) {
        const overflow = sidebarWidth + emailListWidth - maxFixedWidth
        const listReduction = Math.min(overflow, emailListWidth - MIN_EMAIL_LIST_WIDTH)
        emailListWidth -= listReduction

        const remainingOverflow = overflow - listReduction
        if (remainingOverflow > 0 && !sidebarCollapsed) {
            sidebarWidth = Math.max(MIN_SIDEBAR_WIDTH, sidebarWidth - remainingOverflow)
        }
    }

    return { sidebarWidth, emailListWidth }
}

const formatSyncInterval = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '未设置'
    if (seconds < 60) return `${seconds}秒`
    if (seconds % 3600 === 0) return `${seconds / 3600}小时`
    if (seconds % 60 === 0) return `${seconds / 60}分钟`
    return `${seconds}秒`
}

const accountSortField = (sortBy: MailboxAccountSortBy) => {
    switch (sortBy) {
        case 'recent':
            return 'created_at'
        case 'provider':
            return 'mail_provider_id'
        case 'name':
        default:
            return 'email_address'
    }
}

const accountVerifiedParam = (filter: MailboxAccountVerifiedFilter) => {
    if (filter === 'verified') return true
    if (filter === 'unverified') return false
    return undefined
}

const isRecipientLikeSearch = (query?: string) => {
    const trimmed = query?.trim()
    if (!trimmed) return false
    return trimmed.includes('@') || trimmed.startsWith('*@')
}

const buildEmailSearchParams = (
    searchQuery: string | undefined,
    direction: 'received' | 'sent' | 'all',
    limit: number,
    offset: number,
    account?: EmailAccount | null
): EmailSearchParams => {
    const trimmedQuery = searchQuery?.trim()
    const params: EmailSearchParams = {
        limit,
        offset,
        sort_by: 'date_desc',
        direction
    }

    if (!trimmedQuery) {
        return params
    }

    const accountDomain = account?.domain?.trim().toLowerCase()
    const normalizedQuery = trimmedQuery.toLowerCase()
    if (
        isRecipientLikeSearch(trimmedQuery) ||
        (account?.isDomainMail && accountDomain && normalizedQuery === accountDomain)
    ) {
        params.to_query = account?.isDomainMail && accountDomain && normalizedQuery === accountDomain
            ? `*@${accountDomain}`
            : trimmedQuery
    } else {
        params.keyword = trimmedQuery
    }

    return params
}

const getSyncWarning = (config?: SyncConfig) => {
    if (!config) {
        return {
            reason: '未读取到同步配置，刷新可能只会显示本地缓存。',
            currentConfigText: '未配置自动同步',
        }
    }

    if (!config.enable_auto_sync || config.auto_disabled) {
        return {
            reason: '当前账户没有开启自动同步，刷新可能只会显示本地缓存。',
            currentConfigText: `自动同步关闭，间隔 ${formatSyncInterval(config.sync_interval)}`,
        }
    }

    if (config.sync_interval > SYNC_WARNING_INTERVAL_SECONDS) {
        return {
            reason: `当前账户同步间隔为 ${formatSyncInterval(config.sync_interval)}，可能需要等待较久才会拉取新邮件。`,
            currentConfigText: `自动同步开启，间隔 ${formatSyncInterval(config.sync_interval)}`,
        }
    }

    return null
}

type PendingSyncAction = {
    label: string
    run: () => Promise<void>
}

export default function EnhancedClassicMailboxView() {
    // 状态管理
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [accountsTotal, setAccountsTotal] = useState(0)
    const [hasMoreAccounts, setHasMoreAccounts] = useState(false)
    const [hasPreviousAccounts, setHasPreviousAccounts] = useState(false)
    const [loadingMoreAccounts, setLoadingMoreAccounts] = useState(false)
    const [loadingPreviousAccounts, setLoadingPreviousAccounts] = useState(false)
    const [accountWindowStartIndex, setAccountWindowStartIndex] = useState(0)
    const [accountPrependAdjustment, setAccountPrependAdjustment] = useState<{ seq: number; rows: number } | null>(null)
    const [accountSearchQuery, setAccountSearchQuery] = useState('')
    const [debouncedAccountSearchQuery, setDebouncedAccountSearchQuery] = useState('')
    const [accountSortBy, setAccountSortBy] = useState<MailboxAccountSortBy>('name')
    const [accountSortOrder, setAccountSortOrder] = useState<MailboxAccountSortOrder>('asc')
    const [accountVerifiedFilter, setAccountVerifiedFilter] = useState<MailboxAccountVerifiedFilter>('all')
    const [selectedAccount, setSelectedAccount] = useState<EmailAccount | null>(null)
    const [emails, setEmails] = useState<Email[]>([])
    // 使用ID跟踪选中状态，而非完整对象引用，避免增量刷新时不必要的重新渲染
    const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadingEmails, setLoadingEmails] = useState(false)

    // 邮件方向筛选
    const [directionFilter, setDirectionFilter] = useState<'received' | 'sent' | 'all'>('received')

    // 布局状态
    const [sidebarWidth, setSidebarWidth] = useState(360)
    const [emailListWidth, setEmailListWidth] = useState(480)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [showLayoutMenu, setShowLayoutMenu] = useState(false)
    const [customPresets, setCustomPresets] = useState<LayoutPreset[]>([])
    const [isResizing, setIsResizing] = useState(false)
    const [layoutReady, setLayoutReady] = useState(false)
    const useAdaptiveLayoutRef = useRef(true)

    // 响应式断点
    const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1920)
    const [isMobileView, setIsMobileView] = useState(false)
    const [activePanel, setActivePanel] = useState<'sidebar' | 'list' | 'preview'>('list')

    // 自动同步状态
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const autoSyncTimerRef = useRef<NodeJS.Timeout | null>(null)
    const [syncPromptOpen, setSyncPromptOpen] = useState(false)
    const [syncPromptAccount, setSyncPromptAccount] = useState<EmailAccount | null>(null)
    const [syncPromptReason, setSyncPromptReason] = useState('')
    const [syncPromptConfigText, setSyncPromptConfigText] = useState('')
    const [syncPromptActionLabel, setSyncPromptActionLabel] = useState('刷新')
    const [creatingTemporarySync, setCreatingTemporarySync] = useState(false)
    const [temporarySyncFolders, setTemporarySyncFolders] = useState<string[]>(DEFAULT_TEMP_SYNC_FOLDERS)

    // 分页状态
    const [totalCount, setTotalCount] = useState(0)
    const [currentOffset, setCurrentOffset] = useState(0)
    const [emailWindowStartIndex, setEmailWindowStartIndex] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const [hasPrevious, setHasPrevious] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [loadingPrevious, setLoadingPrevious] = useState(false)
    const [emailSearchQuery, setEmailSearchQuery] = useState('')
    const [accountScrollRequest, setAccountScrollRequest] = useState<{ accountId: number; requestId: number } | null>(null)
    const PAGE_SIZE = 50

    // refs
    const selectedAccountRef = useRef<EmailAccount | null>(null)
    const loadingEmailsRef = useRef<boolean>(false)
    const isRefreshingRef = useRef<boolean>(false)
    const emailSearchQueryRef = useRef('')
    const pendingSyncActionRef = useRef<PendingSyncAction | null>(null)
    const accountsRequestSeqRef = useRef(0)
    const accountsPageRef = useRef(1)
    const accountsNextCursorRef = useRef<string | null>(null)
    const accountsPrevCursorRef = useRef<string | null>(null)
    const hasMoreAccountsRef = useRef(false)
    const hasPreviousAccountsRef = useRef(false)
    const loadingMoreAccountsRef = useRef(false)
    const loadingPreviousAccountsRef = useRef(false)
    const loadingAccountsRef = useRef(false)
    const emailLoadRequestSeqRef = useRef(0)
    const accountScrollRequestSeqRef = useRef(0)
    const accountPrependAdjustmentSeqRef = useRef(0)
    const suppressNextSelectedAccountLoadRef = useRef(false)
    const emailNextCursorRef = useRef<string | null>(null)
    const emailPrevCursorRef = useRef<string | null>(null)
    const accountsRef = useRef<EmailAccount[]>([])
    const emailsRef = useRef<Email[]>([])
    const containerRef = useRef<HTMLDivElement>(null)
    const layoutMenuRef = useRef<HTMLDivElement>(null)

    // 通过useMemo从emails数组中派生selectedEmail对象
    const selectedEmail = useMemo(() => {
        if (selectedEmailId === null) return null
        return emails.find(email => email.ID === selectedEmailId) || null
    }, [emails, selectedEmailId])

    useEffect(() => {
        accountsRef.current = accounts
    }, [accounts])

    useEffect(() => {
        emailsRef.current = emails
    }, [emails])

    // 最小/最大宽度限制
    const minSidebarWidth = MIN_SIDEBAR_WIDTH
    const maxSidebarWidth = MAX_SIDEBAR_WIDTH
    const minEmailListWidth = MIN_EMAIL_LIST_WIDTH
    const maxEmailListWidth = MAX_EMAIL_LIST_WIDTH

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
                if (!sidebarCollapsed && sidebarWidth > 280) {
                    setSidebarWidth(280)
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
                setCustomPresets(config.customPresets || [])

                if (config.version === LAYOUT_CONFIG_VERSION && !config.adaptive) {
                    useAdaptiveLayoutRef.current = false
                    setSidebarWidth(config.sidebarWidth || 360)
                    setEmailListWidth(config.emailListWidth || 480)
                    setSidebarCollapsed(config.sidebarCollapsed || false)
                } else {
                    const layout = getAdaptiveLayout(containerRef.current?.clientWidth || window.innerWidth)
                    useAdaptiveLayoutRef.current = true
                    setSidebarWidth(layout.sidebarWidth)
                    setEmailListWidth(layout.emailListWidth)
                    setSidebarCollapsed(false)
                }
            } else {
                const layout = getAdaptiveLayout(containerRef.current?.clientWidth || window.innerWidth)
                setSidebarWidth(layout.sidebarWidth)
                setEmailListWidth(layout.emailListWidth)
            }
        } catch (e) {
            console.error('Failed to load layout config:', e)
        } finally {
            setLayoutReady(true)
        }
    }, [])

    // 根据容器真实宽度调整默认布局，并约束用户自定义布局避免挤压预览面板。
    useEffect(() => {
        if (!layoutReady || !containerRef.current || isMobileView) return

        const resizeObserver = new ResizeObserver(([entry]) => {
            const containerWidth = entry.contentRect.width

            if (useAdaptiveLayoutRef.current) {
                const layout = getAdaptiveLayout(containerWidth)
                setSidebarWidth(layout.sidebarWidth)
                setEmailListWidth(layout.emailListWidth)
                return
            }

            setSidebarWidth(currentSidebarWidth => {
                const fitted = fitLayoutToContainer(
                    containerWidth,
                    currentSidebarWidth,
                    emailListWidth,
                    sidebarCollapsed
                )
                return fitted.sidebarWidth
            })
            setEmailListWidth(currentEmailListWidth => {
                const fitted = fitLayoutToContainer(
                    containerWidth,
                    sidebarWidth,
                    currentEmailListWidth,
                    sidebarCollapsed
                )
                return fitted.emailListWidth
            })
        })

        resizeObserver.observe(containerRef.current)
        return () => resizeObserver.disconnect()
    }, [layoutReady, isMobileView, sidebarCollapsed, sidebarWidth, emailListWidth])

    // 保存布局配置
    const saveLayoutConfig = useCallback(() => {
        try {
            const config = {
                version: LAYOUT_CONFIG_VERSION,
                adaptive: useAdaptiveLayoutRef.current,
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
        useAdaptiveLayoutRef.current = false
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
        const layout = getAdaptiveLayout(containerRef.current?.clientWidth || window.innerWidth)
        useAdaptiveLayoutRef.current = true
        setSidebarWidth(layout.sidebarWidth)
        setEmailListWidth(layout.emailListWidth)
        setSidebarCollapsed(false)
        setShowLayoutMenu(false)
    }

    // 处理侧边栏宽度调整
    const handleSidebarResize = useCallback((delta: number) => {
        useAdaptiveLayoutRef.current = false
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
        useAdaptiveLayoutRef.current = false
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
            useAdaptiveLayoutRef.current = false
            setSidebarCollapsed(false)
            setSidebarWidth(360)
        } else {
            useAdaptiveLayoutRef.current = false
            setSidebarCollapsed(true)
            setSidebarWidth(minSidebarWidth)
        }
    }

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedAccountSearchQuery(accountSearchQuery.trim())
        }, ACCOUNT_SEARCH_DEBOUNCE_MS)

        return () => clearTimeout(timer)
    }, [accountSearchQuery])

    const requestAccountScroll = useCallback((accountId: number) => {
        accountScrollRequestSeqRef.current += 1
        setAccountScrollRequest({
            accountId,
            requestId: accountScrollRequestSeqRef.current,
        })
    }, [])

    // 加载邮箱账户（经典管理器侧边栏使用滚动分页，避免一次性拉取全部账户）
    const loadAccounts = useCallback(async ({ reset = true }: { reset?: boolean } = {}) => {
        if (!reset && (!hasMoreAccountsRef.current || loadingMoreAccountsRef.current || loadingPreviousAccountsRef.current || loadingAccountsRef.current)) {
            return
        }
        if (!reset && !accountsNextCursorRef.current) {
            return
        }

        const requestSeq = ++accountsRequestSeqRef.current
        const pageToLoad = reset ? 1 : accountsPageRef.current + 1
        const afterCursor = reset ? undefined : accountsNextCursorRef.current || undefined

        try {
            if (reset) {
                setLoading(true)
                loadingAccountsRef.current = true
                setLoadingMoreAccounts(false)
                setLoadingPreviousAccounts(false)
                loadingMoreAccountsRef.current = false
                loadingPreviousAccountsRef.current = false
                accountsNextCursorRef.current = null
                accountsPrevCursorRef.current = null
                setHasPreviousAccounts(false)
                hasPreviousAccountsRef.current = false
                setAccountWindowStartIndex(0)
            } else {
                setLoadingMoreAccounts(true)
                loadingMoreAccountsRef.current = true
            }

            const response = await emailAccountService.getAccountsPaginated({
                page: 1,
                limit: ACCOUNT_PAGE_SIZE,
                cursor: true,
                after_cursor: afterCursor,
                sort_by: accountSortField(accountSortBy),
                sort_order: accountSortOrder,
                search: debouncedAccountSearchQuery || undefined,
                is_verified: accountVerifiedParam(accountVerifiedFilter),
            })

            if (requestSeq !== accountsRequestSeqRef.current) {
                return
            }

            const nextAccounts = response.data || []
            const responsePage = response.page || pageToLoad
            const responseTotal = response.total || 0
            const totalPages = response.total_pages || Math.ceil(responseTotal / ACCOUNT_PAGE_SIZE)
            const moreAvailable = response.has_next ?? responsePage < totalPages
            const previousAvailable = reset ? Boolean(response.has_prev) : hasPreviousAccountsRef.current
            const responseWindowStartIndex = readPositiveInteger(response.window_start_index)

            setAccounts(prev => {
                const nextLoadedAccounts = reset
                    ? nextAccounts
                    : [
                        ...prev,
                        ...nextAccounts.filter(account => !prev.some(existing => existing.id === account.id)),
                    ]
                accountsRef.current = nextLoadedAccounts
                return nextLoadedAccounts
            })
            setAccountsTotal(responseTotal)
            setHasMoreAccounts(moreAvailable)
            setHasPreviousAccounts(previousAvailable)
            if (reset) {
                setAccountWindowStartIndex(nextAccounts.length > 0 ? responseWindowStartIndex || 1 : 0)
            }
            accountsNextCursorRef.current = response.next_cursor || null
            if (reset) {
                accountsPrevCursorRef.current = response.prev_cursor || null
            }
            accountsPageRef.current = reset ? 1 : accountsPageRef.current + 1
            hasMoreAccountsRef.current = moreAvailable
            hasPreviousAccountsRef.current = previousAvailable

            if (reset) {
                const normalizedSearch = debouncedAccountSearchQuery.trim().toLowerCase()
                const exactSearchMatch = normalizedSearch
                    ? nextAccounts.find(account => account.emailAddress.toLowerCase() === normalizedSearch)
                    : undefined
                const searchTarget = exactSearchMatch || (normalizedSearch && nextAccounts.length === 1 ? nextAccounts[0] : undefined)

                if (searchTarget) {
                    selectedAccountRef.current = searchTarget
                    setSelectedEmailId(null)
                    setSelectedAccount(searchTarget)
                    requestAccountScroll(searchTarget.id)
                } else {
                    setSelectedAccount(current => {
                        const nextSelectedAccount = current || selectedAccountRef.current || nextAccounts[0] || null
                        selectedAccountRef.current = nextSelectedAccount
                        return nextSelectedAccount
                    })
                }
            }
        } catch (error) {
            console.error('Failed to load accounts:', error)
        } finally {
            if (requestSeq === accountsRequestSeqRef.current) {
                if (reset) {
                    setLoading(false)
                    loadingAccountsRef.current = false
                } else {
                    setLoadingMoreAccounts(false)
                    loadingMoreAccountsRef.current = false
                }
            }
        }
    }, [accountSortBy, accountSortOrder, accountVerifiedFilter, debouncedAccountSearchQuery, requestAccountScroll])

    const loadMoreAccounts = useCallback(() => {
        loadAccounts({ reset: false })
    }, [loadAccounts])

    const loadPreviousAccounts = useCallback(async () => {
        if (!hasPreviousAccountsRef.current || loadingPreviousAccountsRef.current || loadingMoreAccountsRef.current || loadingAccountsRef.current) {
            return
        }
        if (!accountsPrevCursorRef.current) {
            return
        }

        const requestSeq = ++accountsRequestSeqRef.current
        const beforeCursor = accountsPrevCursorRef.current

        try {
            setLoadingPreviousAccounts(true)
            loadingPreviousAccountsRef.current = true

            const response = await emailAccountService.getAccountsPaginated({
                page: 1,
                limit: ACCOUNT_PAGE_SIZE,
                cursor: true,
                before_cursor: beforeCursor,
                sort_by: accountSortField(accountSortBy),
                sort_order: accountSortOrder,
                search: debouncedAccountSearchQuery || undefined,
                is_verified: accountVerifiedParam(accountVerifiedFilter),
            })

            if (requestSeq !== accountsRequestSeqRef.current) {
                return
            }

            const previousPageAccounts = response.data || []
            const responseTotal = response.total || accountsTotal
            const previousAvailable = Boolean(response.has_prev)
            const currentAccounts = accountsRef.current
            const seen = new Set(currentAccounts.map(account => account.id))
            const accountsToPrepend = previousPageAccounts.filter(account => !seen.has(account.id))

            if (accountsToPrepend.length > 0) {
                const nextAccounts = [
                    ...accountsToPrepend,
                    ...currentAccounts,
                ]
                accountsRef.current = nextAccounts
                setAccounts(nextAccounts)
                setAccountWindowStartIndex(current => (
                    current > 0 ? Math.max(1, current - accountsToPrepend.length) : 1
                ))
                accountPrependAdjustmentSeqRef.current += 1
                setAccountPrependAdjustment({
                    seq: accountPrependAdjustmentSeqRef.current,
                    rows: accountsToPrepend.length,
                })
            }

            setAccountsTotal(responseTotal)
            setHasPreviousAccounts(previousAvailable)
            accountsPrevCursorRef.current = response.prev_cursor || null
            hasPreviousAccountsRef.current = previousAvailable
        } catch (error) {
            console.error('加载上一页账户失败:', error)
        } finally {
            if (requestSeq === accountsRequestSeqRef.current) {
                setLoadingPreviousAccounts(false)
                loadingPreviousAccountsRef.current = false
            }
        }
    }, [accountSortBy, accountSortOrder, accountVerifiedFilter, accountsTotal, debouncedAccountSearchQuery])

    const loadAccountAnchorWindow = useCallback(async (accountId: number) => {
        const requestSeq = ++accountsRequestSeqRef.current

        try {
            setLoading(true)
            loadingAccountsRef.current = true
            setLoadingMoreAccounts(false)
            setLoadingPreviousAccounts(false)
            loadingMoreAccountsRef.current = false
            loadingPreviousAccountsRef.current = false

            const response = await emailAccountService.getAccountsPaginated({
                page: 1,
                limit: ACCOUNT_PAGE_SIZE,
                cursor: true,
                anchor_account_id: accountId,
                sort_by: accountSortField(accountSortBy),
                sort_order: accountSortOrder,
                search: debouncedAccountSearchQuery || undefined,
                is_verified: accountVerifiedParam(accountVerifiedFilter),
            })

            if (requestSeq !== accountsRequestSeqRef.current) {
                return null
            }

            const nextAccounts = response.data || []
            const targetAccount = nextAccounts.find(account => account.id === accountId) || null
            if (!targetAccount) {
                console.warn('账户锚点窗口中未找到目标账户:', accountId)
                return null
            }

            const responseTotal = response.total || nextAccounts.length
            const windowStartIndex = readPositiveInteger(response.window_start_index)
            const moreAvailable = Boolean(response.has_next)
            const previousAvailable = Boolean(response.has_prev)

            setAccounts(nextAccounts)
            accountsRef.current = nextAccounts
            setAccountsTotal(responseTotal)
            setHasMoreAccounts(moreAvailable)
            setHasPreviousAccounts(previousAvailable)
            setAccountWindowStartIndex(nextAccounts.length > 0 ? windowStartIndex || 1 : 0)
            accountsNextCursorRef.current = response.next_cursor || null
            accountsPrevCursorRef.current = response.prev_cursor || null
            accountsPageRef.current = response.page || (windowStartIndex > 0 ? Math.ceil(windowStartIndex / ACCOUNT_PAGE_SIZE) : 1)
            hasMoreAccountsRef.current = moreAvailable
            hasPreviousAccountsRef.current = previousAvailable

            return targetAccount
        } catch (error) {
            console.error('加载账户锚点窗口失败:', error)
            return null
        } finally {
            if (requestSeq === accountsRequestSeqRef.current) {
                setLoading(false)
                loadingAccountsRef.current = false
                setLoadingMoreAccounts(false)
                setLoadingPreviousAccounts(false)
                loadingMoreAccountsRef.current = false
                loadingPreviousAccountsRef.current = false
            }
        }
    }, [accountSortBy, accountSortOrder, accountVerifiedFilter, debouncedAccountSearchQuery])

    const handleAccountSortChange = useCallback((sortBy: MailboxAccountSortBy, sortOrder: MailboxAccountSortOrder) => {
        setAccountSortBy(sortBy)
        setAccountSortOrder(sortOrder)
    }, [])

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
        const requestSeq = isAutoSync ? emailLoadRequestSeqRef.current : emailLoadRequestSeqRef.current + 1
        if (!isAutoSync) {
            emailLoadRequestSeqRef.current = requestSeq
        }
        const isCurrentRequest = () => requestSeq === emailLoadRequestSeqRef.current

        if (!account) {
            setEmails([])
            setTotalCount(0)
            setEmailWindowStartIndex(0)
            setHasMore(false)
            setHasPrevious(false)
            emailNextCursorRef.current = null
            emailPrevCursorRef.current = null
            return
        }
        if (appendMode && !emailNextCursorRef.current) {
            return
        }

        try {
            if (!isAutoSync && !appendMode) {
                setLoadingEmails(true)
                setLoadingMore(false)
                setLoadingPrevious(false)
                setCurrentOffset(0)
                emailNextCursorRef.current = null
                emailPrevCursorRef.current = null
            }
            if (appendMode) {
                setLoadingMore(true)
            }
            loadingEmailsRef.current = true

            const offset = appendMode ? currentOffset + PAGE_SIZE : 0
            const searchParams = {
                ...buildEmailSearchParams(searchQuery, directionFilter, PAGE_SIZE, offset, account),
                cursor: true,
                after_cursor: appendMode ? emailNextCursorRef.current || undefined : undefined,
            }
            const emailsData = await emailService.searchEmails(searchParams, account.id)
            if (!isCurrentRequest()) return

            // 解析响应数据
            const emailList: Email[] = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])
            const pagination = (emailsData as any).pagination || {}
            const total = pagination.total || emailList.length
            const moreAvailable = pagination.has_next || false
            const previousAvailable = pagination.has_prev || false
            const nextCursor = pagination.next_cursor || null
            const prevCursor = pagination.prev_cursor || null
            const responseWindowStartIndex = readPositiveInteger(pagination.window_start_index)

            if (isAutoSync) {
                updateEmailsIncremental(emailList)
            } else if (appendMode) {
                // 追加模式：合并新邮件
                setEmails(prev => {
                    const seen = new Set(prev.map(email => email.ID))
                    return [
                        ...prev,
                        ...emailList.filter(email => !seen.has(email.ID)),
                    ]
                })
                setCurrentOffset(current => current + emailList.length)
                emailNextCursorRef.current = nextCursor
            } else {
                // 首次加载：替换邮件列表
                setEmails(emailList)
                setCurrentOffset(0)
                setEmailWindowStartIndex(emailList.length > 0 ? responseWindowStartIndex || offset + 1 : 0)
                emailNextCursorRef.current = nextCursor
                emailPrevCursorRef.current = prevCursor
            }

            setTotalCount(total)
            if (!isAutoSync) {
                setHasMore(moreAvailable)
                if (!appendMode) {
                    setHasPrevious(previousAvailable)
                }
            }

            if (selectedEmailId !== null && selectedAccount?.id !== account.id) {
                setSelectedEmailId(null)
            }
        } catch (error) {
            if (!isCurrentRequest()) return
            console.error('Failed to load emails:', error)
            if (!isAutoSync && !appendMode) {
                setEmails([])
                setTotalCount(0)
                setEmailWindowStartIndex(0)
                setHasMore(false)
                setHasPrevious(false)
            }
        } finally {
            if (!isCurrentRequest()) return
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
        if (selectedAccount && hasMore && !loadingMore && !loadingPrevious) {
            await loadEmails(selectedAccount, emailSearchQueryRef.current, false, true)
        }
    }

    const handleLoadPrevious = async () => {
        if (!selectedAccount || !hasPrevious || loadingPrevious || loadingMore || loadingEmails || !emailPrevCursorRef.current) {
            return
        }

        const requestSeq = emailLoadRequestSeqRef.current
        const isCurrentRequest = () => requestSeq === emailLoadRequestSeqRef.current

        try {
            setLoadingPrevious(true)
            loadingEmailsRef.current = true

            const emailsData = await emailService.searchEmails({
                ...buildEmailSearchParams(emailSearchQueryRef.current, directionFilter, PAGE_SIZE, 0, selectedAccount),
                cursor: true,
                before_cursor: emailPrevCursorRef.current || undefined,
            }, selectedAccount.id)
            if (!isCurrentRequest()) return

            const emailList: Email[] = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])
            const pagination = (emailsData as any).pagination || {}
            const prevCursor = pagination.prev_cursor || null
            const seen = new Set(emailsRef.current.map(email => email.ID))
            const previousEmails = emailList.filter(email => !seen.has(email.ID))

            setEmails(prev => [...previousEmails, ...prev])
            setCurrentOffset(current => current + emailList.length)
            setEmailWindowStartIndex(current => current > 0 ? Math.max(1, current - previousEmails.length) : current)
            setHasPrevious(Boolean(pagination.has_prev))
            emailPrevCursorRef.current = prevCursor
        } catch (error) {
            if (!isCurrentRequest()) return
            console.error('Failed to load previous emails:', error)
        } finally {
            if (isCurrentRequest()) {
                setLoadingPrevious(false)
                loadingEmailsRef.current = false
            }
        }
    }

    // 选择账户
    const handleSelectAccount = (account: EmailAccount) => {
        selectedAccountRef.current = account
        setSelectedAccount(account)
        setSelectedEmailId(null)
        loadEmails(account, emailSearchQueryRef.current, false)

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
        setEmailSearchQuery(query)
        emailSearchQueryRef.current = query
        loadEmails(selectedAccount, query)
    }

    const closeSyncPrompt = () => {
        if (creatingTemporarySync) return
        setSyncPromptOpen(false)
        setSyncPromptAccount(null)
        pendingSyncActionRef.current = null
    }

    const continuePendingSyncAction = async () => {
        const pendingAction = pendingSyncActionRef.current
        pendingSyncActionRef.current = null
        setSyncPromptOpen(false)
        setSyncPromptAccount(null)

        if (pendingAction) {
            await pendingAction.run()
        }
    }

    const confirmTemporarySync = async (syncInterval: number, durationMinutes: number) => {
        const account = syncPromptAccount
        const pendingAction = pendingSyncActionRef.current
        if (!account || !pendingAction) {
            closeSyncPrompt()
            return
        }

        setCreatingTemporarySync(true)
        try {
            await syncConfigService.createTemporarySyncConfig(account.id, {
                sync_interval: syncInterval,
                sync_folders: temporarySyncFolders.length > 0 ? temporarySyncFolders : DEFAULT_TEMP_SYNC_FOLDERS,
                duration_minutes: durationMinutes
            })

            toast.success('临时同步已开启', {
                description: `${account.emailAddress} 将在 ${durationMinutes} 分钟内按 ${syncInterval} 秒间隔同步`
            })

            try {
                await syncConfigService.syncNow(account.id)
            } catch (error: any) {
                toast.warning('临时配置已创建，但立即同步触发失败', {
                    description: error?.message || '后台同步器会在下一次轮询时接管'
                })
            }

            pendingSyncActionRef.current = null
            setSyncPromptOpen(false)
            setSyncPromptAccount(null)
            await pendingAction.run()
        } catch (error: any) {
            toast.error('创建临时同步配置失败', {
                description: error?.message || '请稍后重试'
            })
        } finally {
            setCreatingTemporarySync(false)
        }
    }

    const runWithSyncPrompt = async (action: PendingSyncAction) => {
        if (!selectedAccount) return

        try {
            const effectiveConfig = await syncConfigService.getEffectiveSyncConfig(selectedAccount.id)
            const warning = getSyncWarning(effectiveConfig.config)
            if (effectiveConfig.config?.sync_folders?.length) {
                setTemporarySyncFolders(effectiveConfig.config.sync_folders)
            } else {
                setTemporarySyncFolders(DEFAULT_TEMP_SYNC_FOLDERS)
            }

            if (warning) {
                pendingSyncActionRef.current = action
                setSyncPromptAccount(selectedAccount)
                setSyncPromptReason(warning.reason)
                setSyncPromptConfigText(
                    effectiveConfig.is_temporary
                        ? `${warning.currentConfigText}，当前为临时配置`
                        : warning.currentConfigText
                )
                setSyncPromptActionLabel(action.label)
                setSyncPromptOpen(true)
                return
            }
        } catch (error) {
            pendingSyncActionRef.current = action
            setTemporarySyncFolders(DEFAULT_TEMP_SYNC_FOLDERS)
            setSyncPromptAccount(selectedAccount)
            setSyncPromptReason('无法读取当前同步配置，刷新可能只会显示本地缓存。')
            setSyncPromptConfigText('同步配置读取失败')
            setSyncPromptActionLabel(action.label)
            setSyncPromptOpen(true)
            return
        }

        await action.run()
    }

    const refreshEmailsNow = async () => {
        if (!selectedAccount) return

        setIsRefreshing(true)
        isRefreshingRef.current = true
        try {
            await loadEmails(selectedAccount, emailSearchQueryRef.current, false)
        } catch (error) {
            console.error('Manual refresh failed:', error)
        } finally {
            setIsRefreshing(false)
            isRefreshingRef.current = false
        }
    }

    // 手动刷新
    const handleRefreshEmails = async () => {
        await runWithSyncPrompt({
            label: '刷新',
            run: refreshEmailsNow
        })
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

            loadEmails(currentAccount, emailSearchQueryRef.current, true)
        }, 1000)
    }

    const stopAutoSync = () => {
        if (autoSyncTimerRef.current) {
            clearInterval(autoSyncTimerRef.current)
            autoSyncTimerRef.current = null
        }
    }

    const enableAutoSync = async () => {
        setAutoSyncEnabled(true)
        startAutoSync()
    }

    const disableAutoSync = () => {
        setAutoSyncEnabled(false)
        stopAutoSync()
    }

    const toggleAutoSync = () => {
        const newAutoSyncEnabled = !autoSyncEnabled
        if (newAutoSyncEnabled) {
            runWithSyncPrompt({
                label: '开启自动刷新',
                run: enableAutoSync
            })
        } else {
            disableAutoSync()
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

    useEffect(() => {
        emailSearchQueryRef.current = emailSearchQuery
    }, [emailSearchQuery])

    // 初始加载
    useEffect(() => {
        loadAccounts({ reset: true })
    }, [loadAccounts])

    useEffect(() => {
        if (selectedAccount) {
            if (suppressNextSelectedAccountLoadRef.current) {
                suppressNextSelectedAccountLoadRef.current = false
                return
            }
            loadEmails(selectedAccount, emailSearchQueryRef.current, false)
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
        const targetDirection: 'received' | 'sent' = data.locateEmail.direction === 'sent' ? 'sent' : 'received'
        const targetAccountId = Number(accountId)
        const targetEmailId = emailId === undefined || emailId === null ? null : Number(emailId)
        if (!Number.isFinite(targetAccountId) || targetAccountId <= 0) return

        logger.debug('[EnhancedClassicMailboxView] 收到定位邮件请求:', { accountId: targetAccountId, emailId: targetEmailId })

        const targetAccount = await loadAccountAnchorWindow(targetAccountId)
            || accounts.find(acc => acc.id === targetAccountId)

        if (!targetAccount) {
            console.warn('未找到账户:', targetAccountId)
            return
        }
        const targetAccountForSelection = targetAccount

        // 选中账户
        const isAlreadySelectedAccount = selectedAccountRef.current?.id === targetAccountForSelection.id
        selectedAccountRef.current = targetAccountForSelection
        const shouldResetDirectionForNotification = targetEmailId && directionFilter !== targetDirection
        if (targetEmailId && (!isAlreadySelectedAccount || shouldResetDirectionForNotification)) {
            suppressNextSelectedAccountLoadRef.current = true
        }
        setSelectedAccount(current => current?.id === targetAccountForSelection.id ? current : targetAccountForSelection)
        if (shouldResetDirectionForNotification) {
            setDirectionFilter(targetDirection)
        }
        requestAccountScroll(targetAccountForSelection.id)

        // 如果没有提供 emailId，只选中账户即可（账户的邮件会自动加载）
        if (!targetEmailId) {
            logger.debug('[EnhancedClassicMailboxView] 仅选中账户，不定位具体邮件')
            return
        }

        // 加载该账户的邮件并定位到目标邮件
        const locateRequestSeq = emailLoadRequestSeqRef.current + 1
        emailLoadRequestSeqRef.current = locateRequestSeq
        const isCurrentLocateRequest = () => locateRequestSeq === emailLoadRequestSeqRef.current

        try {
            setLoadingEmails(true)
            setLoadingMore(false)
            setLoadingPrevious(false)
            loadingEmailsRef.current = true
            const emailsData = await emailService.searchEmails({
                limit: PAGE_SIZE,
                offset: 0,
                sort_by: 'date_desc',
                cursor: true,
                anchor_email_id: targetEmailId,
                direction: targetDirection,
            }, targetAccountId)
            if (!isCurrentLocateRequest()) return

            const emailList = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])
            const pagination = (emailsData as any).pagination || {}
            const total = pagination.total || emailList.length
            const moreAvailable = pagination.has_next || false
            const previousAvailable = pagination.has_prev || false
            const nextCursor = pagination.next_cursor || null
            const prevCursor = pagination.prev_cursor || null
            const targetEmail = emailList.find((e: Email) => e.ID === targetEmailId)
            const targetEmailIndex = emailList.findIndex((e: Email) => e.ID === targetEmailId)
            const anchorIndex = readPositiveInteger(pagination.anchor_index)
            const responseWindowStartIndex = readPositiveInteger(pagination.window_start_index)
            const fallbackWindowStartIndex = targetEmailIndex >= 0 && anchorIndex > 0
                ? Math.max(1, anchorIndex - targetEmailIndex)
                : emailList.length > 0 ? 1 : 0

            setEmails(emailList)
            setTotalCount(total)
            setEmailWindowStartIndex(responseWindowStartIndex || fallbackWindowStartIndex)
            setHasMore(moreAvailable)
            setHasPrevious(previousAvailable)
            setCurrentOffset(0)
            emailNextCursorRef.current = nextCursor
            emailPrevCursorRef.current = prevCursor

            if (targetEmail) {
                setSelectedEmailId(targetEmail.ID)
                if (isMobileView) {
                    setActivePanel('preview')
                }
            } else {
                console.warn('未找到邮件:', targetEmailId)
            }

        } catch (error) {
            if (!isCurrentLocateRequest()) return
            console.error('加载邮件失败:', error)
        } finally {
            if (isCurrentLocateRequest()) {
                setLoadingEmails(false)
                loadingEmailsRef.current = false
            }
        }
    }, [accounts, directionFilter, isMobileView, loadAccountAnchorWindow, requestAccountScroll])

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

    const mailboxAISkill = useMemo<AISkill>(() => ({
        id: 'classic-mailbox',
        title: '经典邮件管理器',
        description: '查看指定邮箱账户的邮件列表、收件箱和邮件详情。',
        aliases: ['收件箱', '邮件列表', '邮箱邮件', 'mailbox', 'inbox'],
        pageTabs: ['classic-mailbox'],
        getContext: () => ({
            selectedAccount: selectedAccount ? {
                id: selectedAccount.id,
                email: selectedAccount.emailAddress,
                provider: selectedAccount.mailProvider?.type,
                isVerified: selectedAccount.isVerified,
            } : null,
            selectedEmail: selectedEmail ? summarizeEmailForAI(selectedEmail) : null,
            selectedEmailId,
            hasSelectedEmail: Boolean(selectedEmail),
            activePanel,
            loading: loading || loadingEmails || loadingMore || loadingPrevious || isRefreshing,
            isLoading: loading || loadingEmails || loadingMore || loadingPrevious || isRefreshing,
            loadingAccounts: loading,
            isLoadingAccounts: loading,
            loadingEmails,
            isLoadingEmails: loadingEmails,
            loadingMore,
            isLoadingMore: loadingMore,
            loadingPrevious,
            isLoadingPrevious: loadingPrevious,
            isRefreshing,
            isDataSettled: !loading && !loadingEmails && !loadingMore && !loadingPrevious && !isRefreshing,
            accountsCount: accountsTotal,
            loadedAccountsCount: accounts.length,
            loadedEmailsCount: emails.length,
            totalCount,
            hasMore,
            currentOffset,
            pageSize: PAGE_SIZE,
            directionFilter,
            searchQuery: emailSearchQuery,
            sampleVisibleEmails: emails.slice(0, 8).map(email => ({
                id: email.ID,
                subject: email.Subject || '(无主题)',
                from: emailAddressList(email.From),
                date: email.Date,
                isSelected: email.ID === selectedEmailId,
                hasAttachments: Boolean(email.HasAttachments || email.Attachments?.length),
            })),
            sampleAccounts: accounts.slice(0, 5).map(account => ({
                id: account.id,
                email: account.emailAddress,
                provider: account.mailProvider?.type,
                isVerified: account.isVerified,
            })),
        }),
        actions: [
            {
                name: 'openAccountInbox',
                title: '打开账户收件箱',
                description: '按邮箱地址定位账户并加载该账户最新邮件。',
                risk: 'navigation',
                parameters: { email: '邮箱地址' },
                run: async (params) => {
                    const email = String(params.email || params.emailAddress || '').trim().toLowerCase()
                    const query = String(params.query || params.emailPrefix || email).trim().toLowerCase()
                    const accountId = typeof params.accountId === 'number' ? params.accountId : Number(params.accountId || 0)

                    let targetAccount = accountId
                        ? accounts.find(account => account.id === accountId)
                        : email
                            ? accounts.find(account => account.emailAddress.toLowerCase() === email)
                            : query
                                ? accounts.find(account => account.emailAddress.toLowerCase().startsWith(query))
                                : undefined

                    if (!targetAccount && accountId) {
                        try {
                            targetAccount = await emailAccountService.getAccount(accountId)
                            setAccounts(prev => prev.some(account => account.id === targetAccount?.id) || !targetAccount
                                ? prev
                                : [targetAccount, ...prev]
                            )
                        } catch (error) {
                            console.warn('Failed to fetch account by id:', error)
                        }
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
                            summary: query ? `没有找到匹配 ${query} 的邮箱账户。` : '没有提供要查看的邮箱地址或搜索前缀。',
                        }
                    }

                    setSelectedAccount(targetAccount)
                    setSelectedEmailId(null)
                    setEmailSearchQuery('')

                    try {
                        setLoadingEmails(true)
                        const emailsData = await emailService.searchEmails({
                            limit: PAGE_SIZE,
                            offset: 0,
                            sort_by: 'date_desc',
                        }, targetAccount.id)
                        const emailList = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])
                        const pagination = (emailsData as any).pagination || {}
                        const responseWindowStartIndex = readPositiveInteger(pagination.window_start_index)

                        setEmails(emailList)
                        setTotalCount(pagination.total || emailList.length)
                        setEmailWindowStartIndex(emailList.length > 0 ? responseWindowStartIndex || 1 : 0)
                        setHasMore(pagination.has_next || false)
                        setCurrentOffset(0)
                        if (isMobileView) {
                            setActivePanel('list')
                        }

                        return {
                            success: true,
                            summary: `已打开 ${targetAccount.emailAddress} 的邮件列表，当前加载 ${emailList.length} 封。`,
                            data: {
                                accountId: targetAccount.id,
                                email: targetAccount.emailAddress,
                                loadedEmailsCount: emailList.length,
                                totalCount: pagination.total || emailList.length,
                            },
                        }
                    } finally {
                        setLoadingEmails(false)
                    }
                },
            },
            {
                name: 'openLatestAccountLatestEmail',
                title: '打开最新账户最新邮件',
                description: '定位最近创建的邮箱账户，加载其最新邮件，并打开最新一封邮件详情。',
                risk: 'navigation',
                run: async () => {
                    const accountsResponse = await emailAccountService.getAccountsPaginated({
                        page: 1,
                        limit: 1,
                        sort_by: 'created_at',
                        sort_order: 'desc',
                    })
                    const targetAccount = accountsResponse.data[0]

                    if (!targetAccount) {
                        return {
                            success: false,
                            summary: '没有找到任何邮箱账户。',
                            data: { accountFound: false },
                        }
                    }

                    setSelectedAccount(targetAccount)
                    setSelectedEmailId(null)
                    setEmailSearchQuery('')

                    try {
                        setLoadingEmails(true)
                        const emailsData = await emailService.searchEmails({
                            limit: PAGE_SIZE,
                            offset: 0,
                            sort_by: 'date_desc',
                        }, targetAccount.id)
                        const emailList: Email[] = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])
                        const pagination = (emailsData as any).pagination || {}
                        const responseWindowStartIndex = readPositiveInteger(pagination.window_start_index)
                        const latestEmail = emailList[0]

                        let selectedLatestEmail: Email | undefined = latestEmail
                        if (latestEmail) {
                            try {
                                selectedLatestEmail = await emailService.getEmail(latestEmail.ID) || latestEmail
                            } catch (error) {
                                console.warn('Failed to fetch latest email details:', error)
                            }
                        }

                        let nextEmails = emailList
                        if (selectedLatestEmail) {
                            const selectedEmailValue = selectedLatestEmail
                            nextEmails = emailList.map(email => email.ID === selectedEmailValue.ID ? selectedEmailValue : email)
                        }

                        setEmails(nextEmails)
                        setTotalCount(pagination.total || emailList.length)
                        setEmailWindowStartIndex(nextEmails.length > 0 ? responseWindowStartIndex || 1 : 0)
                        setHasMore(pagination.has_next || false)
                        setCurrentOffset(0)
                        if (selectedLatestEmail) {
                            setSelectedEmailId(selectedLatestEmail.ID)
                            setActivePanel('preview')
                        } else if (isMobileView) {
                            setActivePanel('list')
                        }

                        const selectedEmailSummary = selectedLatestEmail
                            ? summarizeEmailForAI(selectedLatestEmail, AI_EMAIL_ACTION_BODY_LIMIT)
                            : null

                        return {
                            success: true,
                            summary: selectedEmailSummary
                                ? `已打开最新账户 ${targetAccount.emailAddress} 的最新邮件「${selectedEmailSummary.subject}」，发件人 ${selectedEmailSummary.from || '未知'}。`
                                : `最新账户 ${targetAccount.emailAddress} 当前没有邮件。`,
                            details: selectedEmailSummary?.bodyPreview,
                            data: {
                                accountFound: true,
                                accountId: targetAccount.id,
                                email: targetAccount.emailAddress,
                                accountCreatedAt: targetAccount.createdAt,
                                loadedEmailsCount: emailList.length,
                                totalCount: pagination.total || emailList.length,
                                emailFound: Boolean(selectedEmailSummary),
                                selectedEmail: selectedEmailSummary,
                            },
                        }
                    } finally {
                        setLoadingEmails(false)
                    }
                },
            },
            {
                name: 'searchEmails',
                title: '搜索当前账户邮件',
                description: '在当前选中邮箱账户内按关键词、主题、发件人或收件人搜索邮件。',
                risk: 'read',
                parameters: { query: '邮件搜索关键词', openFirst: '为 true 时打开第一封匹配邮件' },
                run: async (params) => {
                    const query = String(params.query || params.q || params.keyword || '').trim()
                    if (!selectedAccount) {
                        return {
                            success: false,
                            summary: '当前还没有选中邮箱账户，请先打开某个账户的收件箱。',
                        }
                    }
                    if (!query) {
                        return {
                            success: false,
                            summary: '没有提供邮件搜索关键词。',
                        }
                    }

                    setEmailSearchQuery(query)
                    emailSearchQueryRef.current = query
                    setSelectedEmailId(null)
                    setLoadingEmails(true)

                    try {
                        const emailsData = await emailService.searchEmails({
                            ...buildEmailSearchParams(query, directionFilter, PAGE_SIZE, 0, selectedAccount),
                            cursor: true,
                        }, selectedAccount.id)
                        const emailList: Email[] = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])
                        const pagination = (emailsData as any).pagination || {}
                        const responseWindowStartIndex = readPositiveInteger(pagination.window_start_index)
                        const shouldOpenFirst = params.openFirst === true || String(params.openFirst || '').toLowerCase() === 'true'
                        let selectedSummary: ReturnType<typeof summarizeEmailForAI> | null = null

                        setEmails(emailList)
                        setTotalCount(pagination.total || emailList.length)
                        setEmailWindowStartIndex(emailList.length > 0 ? responseWindowStartIndex || 1 : 0)
                        setHasMore(Boolean(pagination.has_next))
                        setHasPrevious(Boolean(pagination.has_prev))
                        setCurrentOffset(0)
                        emailNextCursorRef.current = pagination.next_cursor || null
                        emailPrevCursorRef.current = pagination.prev_cursor || null

                        if (shouldOpenFirst && emailList[0]) {
                            let firstEmail = emailList[0]
                            try {
                                firstEmail = await emailService.getEmail(firstEmail.ID) || firstEmail
                            } catch (error) {
                                console.warn('Failed to fetch first matched email details:', error)
                            }
                            setEmails(prev => prev.map(email => email.ID === firstEmail.ID ? firstEmail : email))
                            setSelectedEmailId(firstEmail.ID)
                            setActivePanel('preview')
                            selectedSummary = summarizeEmailForAI(firstEmail, AI_EMAIL_ACTION_BODY_LIMIT)
                        } else if (isMobileView) {
                            setActivePanel('list')
                        }

                        return {
                            success: true,
                            summary: selectedSummary
                                ? `已搜索 ${query}，并打开第一封匹配邮件「${selectedSummary.subject}」。`
                                : `已搜索 ${query}，找到 ${pagination.total || emailList.length} 封匹配邮件，当前加载 ${emailList.length} 封。`,
                            details: selectedSummary?.bodyPreview,
                            data: {
                                query,
                                accountId: selectedAccount.id,
                                email: selectedAccount.emailAddress,
                                matchedCount: pagination.total || emailList.length,
                                loadedEmailsCount: emailList.length,
                                selectedEmail: selectedSummary,
                                emails: emailList.slice(0, 8).map(email => summarizeEmailForAI(email)),
                            },
                        }
                    } finally {
                        setLoadingEmails(false)
                    }
                },
            },
            {
                name: 'openEmailById',
                title: '打开指定邮件',
                description: '按邮件 ID 打开详情，必要时切换到对应账户。',
                risk: 'read',
                parameters: { emailId: '邮件 ID', accountId: '可选，账户 ID' },
                run: async (params) => {
                    const emailId = Number(params.emailId || params.id || 0)
                    if (!emailId) {
                        return {
                            success: false,
                            summary: '没有提供有效的邮件 ID。',
                        }
                    }

                    const fullEmail = await emailService.getEmail(emailId) as Email | null
                    if (!fullEmail) {
                        return {
                            success: false,
                            summary: `没有找到邮件 ID ${emailId}。`,
                            data: { emailId },
                        }
                    }

                    const targetAccountId = Number(params.accountId || fullEmail.AccountID || 0)
                    let targetAccount = targetAccountId
                        ? accounts.find(account => account.id === targetAccountId) || selectedAccount
                        : selectedAccount
                    if (targetAccountId && (!targetAccount || targetAccount.id !== targetAccountId)) {
                        try {
                            targetAccount = await emailAccountService.getAccount(targetAccountId)
                            setAccounts(prev => prev.some(account => account.id === targetAccount?.id) || !targetAccount
                                ? prev
                                : [targetAccount, ...prev]
                            )
                        } catch (error) {
                            console.warn('Failed to fetch account for email:', error)
                        }
                    }

                    if (targetAccount) {
                        selectedAccountRef.current = targetAccount
                        setSelectedAccount(targetAccount)
                    }

                    try {
                        setLoadingEmails(true)
                        if (targetAccountId) {
                            const emailsData = await emailService.searchEmails({
                                limit: PAGE_SIZE,
                                offset: 0,
                                sort_by: 'date_desc',
                                cursor: true,
                                anchor_email_id: emailId,
                                direction: directionFilter,
                            }, targetAccountId)
                            const emailList: Email[] = Array.isArray(emailsData) ? emailsData : (emailsData.emails || [])
                            const pagination = (emailsData as any).pagination || {}
                            const responseWindowStartIndex = readPositiveInteger(pagination.window_start_index)
                            const nextEmails = emailList.some(email => email.ID === fullEmail.ID)
                                ? emailList.map(email => email.ID === fullEmail.ID ? fullEmail : email)
                                : [fullEmail, ...emailList]

                            setEmails(nextEmails)
                            setTotalCount(pagination.total || nextEmails.length)
                            setEmailWindowStartIndex(nextEmails.length > 0 ? responseWindowStartIndex || 1 : 0)
                            setHasMore(Boolean(pagination.has_next))
                            setHasPrevious(Boolean(pagination.has_prev))
                            setCurrentOffset(0)
                            emailNextCursorRef.current = pagination.next_cursor || null
                            emailPrevCursorRef.current = pagination.prev_cursor || null
                        } else {
                            setEmails([fullEmail])
                            setTotalCount(1)
                            setEmailWindowStartIndex(1)
                            setHasMore(false)
                            setHasPrevious(false)
                            setCurrentOffset(0)
                            emailNextCursorRef.current = null
                            emailPrevCursorRef.current = null
                        }
                        setSelectedEmailId(fullEmail.ID)
                        setActivePanel('preview')
                    } finally {
                        setLoadingEmails(false)
                    }

                    const emailSummary = summarizeEmailForAI(fullEmail, AI_EMAIL_ACTION_BODY_LIMIT)
                    return {
                        success: true,
                        summary: `已打开邮件「${emailSummary.subject}」，发件人 ${emailSummary.from || '未知'}。`,
                        details: emailSummary.bodyPreview,
                        data: {
                            selectedEmail: emailSummary,
                            selectedAccount: targetAccount ? {
                                id: targetAccount.id,
                                email: targetAccount.emailAddress,
                                provider: targetAccount.mailProvider?.type,
                            } : null,
                        },
                    }
                },
            },
            {
                name: 'getSelectedEmailDetails',
                title: '读取当前选中邮件',
                description: '读取当前已选中邮件的主题、发件人、收件人、正文摘要和附件信息。',
                risk: 'read',
                run: () => {
                    if (!selectedEmail) {
                        return {
                            success: false,
                            summary: '当前没有选中的邮件。请先在邮件列表中选择一封邮件。',
                            data: {
                                selectedEmailId,
                                activePanel,
                                selectedAccount: selectedAccount ? {
                                    id: selectedAccount.id,
                                    email: selectedAccount.emailAddress,
                                } : null,
                            },
                        }
                    }

                    const emailSummary = summarizeEmailForAI(selectedEmail, AI_EMAIL_ACTION_BODY_LIMIT)
                    const bodySummary = emailSummary.bodyPreview
                        ? `内容摘要：${trimForAI(emailSummary.bodyPreview, 280)}`
                        : '邮件正文为空。'
                    return {
                        success: true,
                        summary: `当前选中邮件是「${emailSummary.subject}」，发件人 ${emailSummary.from || '未知'}。${bodySummary}`,
                        details: emailSummary.bodyPreview || '邮件正文为空。',
                        data: {
                            selectedEmail: emailSummary,
                            activePanel,
                            selectedAccount: selectedAccount ? {
                                id: selectedAccount.id,
                                email: selectedAccount.emailAddress,
                                provider: selectedAccount.mailProvider?.type,
                            } : null,
                        },
                    }
                },
            },
        ] satisfies AISkillAction[],
    }), [
        activePanel,
        accounts,
        accountsTotal,
        currentOffset,
        directionFilter,
        emailSearchQuery,
        emails,
        hasMore,
        isMobileView,
        isRefreshing,
        loading,
        loadingEmails,
        loadingMore,
        loadingPrevious,
        selectedAccount,
        selectedEmail,
        selectedEmailId,
        totalCount,
    ])

    useAISkill(mailboxAISkill)

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
                            accountsTotal={accountsTotal}
                            loadedStartIndex={accountWindowStartIndex}
                            hasMoreAccounts={hasMoreAccounts}
                            hasPreviousAccounts={hasPreviousAccounts}
                            loadingMoreAccounts={loadingMoreAccounts}
                            loadingPreviousAccounts={loadingPreviousAccounts}
                            onLoadMoreAccounts={loadMoreAccounts}
                            onLoadPreviousAccounts={loadPreviousAccounts}
                            prependAdjustment={accountPrependAdjustment}
                            accountSearchQuery={accountSearchQuery}
                            onAccountSearchQueryChange={setAccountSearchQuery}
                            accountSortBy={accountSortBy}
                            accountSortOrder={accountSortOrder}
                            onAccountSortChange={handleAccountSortChange}
                            accountVerifiedFilter={accountVerifiedFilter}
                            onAccountVerifiedFilterChange={setAccountVerifiedFilter}
                            accountScrollRequest={accountScrollRequest}
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
                            loadedStartIndex={emailWindowStartIndex}
                            hasPrevious={hasPrevious}
                            onLoadPrevious={handleLoadPrevious}
                            loadingPrevious={loadingPrevious}
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

                <TemporarySyncPromptModal
                    isOpen={syncPromptOpen}
                    accountEmail={syncPromptAccount?.emailAddress}
                    reason={syncPromptReason}
                    currentConfigText={syncPromptConfigText}
                    actionLabel={syncPromptActionLabel}
                    loading={creatingTemporarySync}
                    onClose={closeSyncPrompt}
                    onContinue={continuePendingSyncAction}
                    onConfirm={confirmTemporarySync}
                />

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
                        accountsTotal={accountsTotal}
                        loadedStartIndex={accountWindowStartIndex}
                        hasMoreAccounts={hasMoreAccounts}
                        hasPreviousAccounts={hasPreviousAccounts}
                        loadingMoreAccounts={loadingMoreAccounts}
                        loadingPreviousAccounts={loadingPreviousAccounts}
                        onLoadMoreAccounts={loadMoreAccounts}
                        onLoadPreviousAccounts={loadPreviousAccounts}
                        prependAdjustment={accountPrependAdjustment}
                        accountSearchQuery={accountSearchQuery}
                        onAccountSearchQueryChange={setAccountSearchQuery}
                        accountSortBy={accountSortBy}
                        accountSortOrder={accountSortOrder}
                        onAccountSortChange={handleAccountSortChange}
                        accountVerifiedFilter={accountVerifiedFilter}
                        onAccountVerifiedFilterChange={setAccountVerifiedFilter}
                        accountScrollRequest={accountScrollRequest}
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
                        loadedStartIndex={emailWindowStartIndex}
                        hasPrevious={hasPrevious}
                        onLoadPrevious={handleLoadPrevious}
                        loadingPrevious={loadingPrevious}
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
                <div className="flex-1 min-w-[280px] lg:min-w-[360px] bg-white dark:bg-gray-800 relative">
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
            <TemporarySyncPromptModal
                isOpen={syncPromptOpen}
                accountEmail={syncPromptAccount?.emailAddress}
                reason={syncPromptReason}
                currentConfigText={syncPromptConfigText}
                actionLabel={syncPromptActionLabel}
                loading={creatingTemporarySync}
                onClose={closeSyncPrompt}
                onContinue={continuePendingSyncAction}
                onConfirm={confirmTemporarySync}
            />
        </div>
    )
}
