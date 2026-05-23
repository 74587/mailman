'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Dropdown } from '@/components/ui/dropdown'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import {
    LayoutDashboard,
    Mail,
    UserCog,
    Settings,
    X,
    FileText,
    Bot,
    Inbox,
    Bell,
    Key,
    Plus,
    RefreshCw,
    Zap,
    PlusCircle,
    Sparkles,
    BarChart3,
    TestTube,
    PlayCircle,
    Bug,
    Send,
    Puzzle,
    FlaskConical,
    ChevronLeft,
    ChevronRight,
    MoreHorizontal,
    Check,
    Shield,
    ScrollText,
    Package,
    BookOpen,
} from 'lucide-react'

interface Tab {
    id: string
    name: string
    icon: React.ComponentType<{ className?: string }>
}

const tabConfig: Tab[] = [
    { id: 'dashboard', name: '仪表板', icon: LayoutDashboard },
    { id: 'accounts', name: '邮箱账户管理', icon: UserCog },
    { id: 'emails', name: '邮件管理', icon: Mail },
    { id: 'classic-mailbox', name: '经典邮件管理器', icon: Inbox },
    { id: 'compose-email', name: '发送邮件', icon: Send },
    { id: 'sync-config', name: '同步配置', icon: RefreshCw },
    { id: 'mail-pickup', name: '取件', icon: Inbox },
    { id: 'mail-pickup-v2', name: '取件', icon: Package },
    // 根据需求隐藏订阅管理菜单项
    // { id: 'subscriptions', name: '订阅管理', icon: Bell },
    { id: 'pickup', name: '取件模板', icon: FileText },
    { id: 'extractor-v2-list', name: '取件模板', icon: FileText },
    // 高级模组菜单组
    { id: 'trigger-demo', name: '系统演示', icon: PlayCircle },
    { id: 'triggers', name: '触发器管理', icon: Zap },
    { id: 'trigger-create', name: '创建新规则', icon: PlusCircle },
    { id: 'trigger-templates', name: '规则模板', icon: Sparkles },
    { id: 'trigger-stats', name: '执行统计', icon: BarChart3 },
    { id: 'trigger-test', name: '测试调试', icon: TestTube },
    { id: 'oauth2-config', name: 'OAuth2 配置', icon: Key },
    { id: 'ai-config', name: 'AI 配置', icon: Bot },
    { id: 'user-sessions', name: '访问令牌', icon: Settings },
    // { id: 'settings', name: '设置', icon: Settings },
    // 高级模组菜单组 - 补充
    { id: 'filter-templates', name: '过滤器模板', icon: FileText },
    { id: 'action-templates', name: '动作模板', icon: Zap },
    // 拦截器管理
    { id: 'interceptors', name: '拦截器管理', icon: Shield },
    // 插件管理
    { id: 'plugins', name: '插件列表', icon: Puzzle },
    // 开发者模式菜单项
    { id: 'expression-debugger', name: '表达式调试器', icon: Bug },
    { id: 'action-debugger', name: '动作调试器', icon: PlayCircle },
    { id: 'filter-action-trigger', name: '过滤动作触发器', icon: Zap },
    { id: 'component-test', name: '组件测试', icon: FlaskConical },
    // 系统配置
    { id: 'system-config', name: '系统配置', icon: Settings },
    // API 文档
    { id: 'api-docs', name: 'API 文档', icon: BookOpen },
]

interface TabManagerProps {
    activeTab: string
    openTabs: string[]
    onTabChange: (tabId: string) => void
    onTabClose: (tabId: string) => void
    onTabOpen: (tabId: string) => void
}

// 刷新指定 Tab 的函数
const refreshTab = (tabId: string) => {
    window.dispatchEvent(new CustomEvent('refreshTab', {
        detail: { tabId }
    }))
}

export function TabManager({
    activeTab,
    openTabs,
    onTabChange,
    onTabClose,
    onTabOpen,
}: TabManagerProps) {
    // 动态 Tab 名称缓存（用于编辑触发器等动态 Tab）
    const [dynamicTabNames, setDynamicTabNames] = useState<Record<string, string>>({})
    // 右键菜单状态
    const [contextMenuTabId, setContextMenuTabId] = useState<string | null>(null)
    // 刷新动画状态
    const [isRefreshing, setIsRefreshing] = useState(false)

    // 滚动相关状态
    const tabListRef = useRef<HTMLDivElement>(null)
    const [canScrollLeft, setCanScrollLeft] = useState(false)
    const [canScrollRight, setCanScrollRight] = useState(false)

    // 检测是否可以滚动
    const checkScrollability = useCallback(() => {
        const container = tabListRef.current
        if (!container) return

        const { scrollLeft, scrollWidth, clientWidth } = container
        setCanScrollLeft(scrollLeft > 0)
        setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1)
    }, [])

    // 滚动到指定方向
    const scroll = useCallback((direction: 'left' | 'right') => {
        const container = tabListRef.current
        if (!container) return

        const scrollAmount = 200 // 每次滚动的像素
        const newScrollLeft = direction === 'left'
            ? container.scrollLeft - scrollAmount
            : container.scrollLeft + scrollAmount

        container.scrollTo({
            left: newScrollLeft,
            behavior: 'smooth'
        })
    }, [])

    // 滚动到活动 tab
    const scrollToActiveTab = useCallback(() => {
        const container = tabListRef.current
        if (!container) return

        const activeTabElement = container.querySelector(`[data-tab-id="${activeTab}"]`) as HTMLElement
        if (activeTabElement) {
            const containerRect = container.getBoundingClientRect()
            const tabRect = activeTabElement.getBoundingClientRect()

            // 如果 tab 不在可视区域内，滚动到它
            if (tabRect.left < containerRect.left) {
                container.scrollTo({
                    left: container.scrollLeft - (containerRect.left - tabRect.left) - 20,
                    behavior: 'smooth'
                })
            } else if (tabRect.right > containerRect.right) {
                container.scrollTo({
                    left: container.scrollLeft + (tabRect.right - containerRect.right) + 20,
                    behavior: 'smooth'
                })
            }
        }
    }, [activeTab])

    // 监听滚动和尺寸变化
    useEffect(() => {
        const container = tabListRef.current
        if (!container) return

        checkScrollability()
        container.addEventListener('scroll', checkScrollability)

        // 使用 ResizeObserver 监听容器尺寸变化
        const resizeObserver = new ResizeObserver(checkScrollability)
        resizeObserver.observe(container)

        return () => {
            container.removeEventListener('scroll', checkScrollability)
            resizeObserver.disconnect()
        }
    }, [checkScrollability])

    // 当 openTabs 变化时重新检测
    useEffect(() => {
        // 延迟检测，等待 DOM 更新
        const timer = setTimeout(checkScrollability, 100)
        return () => clearTimeout(timer)
    }, [openTabs, checkScrollability])

    // 当 activeTab 变化时滚动到活动 tab
    useEffect(() => {
        scrollToActiveTab()
    }, [activeTab, scrollToActiveTab])

    const getTabInfo = (tabId: string): Tab | null => {
        // 先检查静态配置
        const staticTab = tabConfig.find(tab => tab.id === tabId)
        if (staticTab) return staticTab

        // 处理动态触发器编辑 tab: trigger-edit-{id}
        if (tabId.startsWith('trigger-edit-')) {
            const triggerId = tabId.replace('trigger-edit-', '')
            return {
                id: tabId,
                name: dynamicTabNames[tabId] || `编辑触发器 #${triggerId}`,
                icon: Settings
            }
        }

        // 处理动态触发器查看 tab: trigger-view-{id}
        if (tabId.startsWith('trigger-view-')) {
            const triggerId = tabId.replace('trigger-view-', '')
            return {
                id: tabId,
                name: dynamicTabNames[tabId] || `查看触发器 #${triggerId}`,
                icon: Zap
            }
        }

        // 处理回复邮件 Tab
        if (tabId.startsWith('compose-reply-all-')) {
            return {
                id: tabId,
                name: '全部回复',
                icon: Send
            }
        }
        if (tabId.startsWith('compose-reply-')) {
            return {
                id: tabId,
                name: '回复邮件',
                icon: Send
            }
        }
        if (tabId.startsWith('compose-forward-')) {
            return {
                id: tabId,
                name: '转发邮件',
                icon: Send
            }
        }

        // 处理拦截器日志 Tab
        if (tabId === 'interceptor-logs') {
            return {
                id: tabId,
                name: '拦截器日志',
                icon: ScrollText
            }
        }
        if (tabId.startsWith('interceptor-logs-')) {
            const interceptorId = tabId.replace('interceptor-logs-', '')
            return {
                id: tabId,
                name: dynamicTabNames[tabId] || `拦截器日志 #${interceptorId}`,
                icon: ScrollText
            }
        }

        return null
    }

    const availableTabs = tabConfig.filter(tab => !openTabs.includes(tab.id))

    // 刷新当前活动 Tab
    const handleRefreshActiveTab = () => {
        setIsRefreshing(true)
        refreshTab(activeTab)
        // 动画效果持续 500ms
        setTimeout(() => setIsRefreshing(false), 500)
    }

    // 右键菜单中刷新 Tab
    const handleRefreshTabFromContext = (tabId: string) => {
        refreshTab(tabId)
        setContextMenuTabId(null)
    }

    // 监听切换到邮箱账户管理页面的事件
    useEffect(() => {
        const handleSwitchToAccountsTab = (event: CustomEvent) => {
            // 如果邮箱账户管理tab未打开，则打开它
            if (!openTabs.includes('accounts')) {
                onTabOpen('accounts')
            }
            // 切换到邮箱账户管理tab
            onTabChange('accounts')

            // 通知邮箱账户管理页面进行过滤
            const filterEvent = new CustomEvent('filterAccountsByProvider', {
                detail: event.detail
            })
            window.dispatchEvent(filterEvent)
        }

        window.addEventListener('switchToAccountsTab', handleSwitchToAccountsTab as EventListener)

        return () => {
            window.removeEventListener('switchToAccountsTab', handleSwitchToAccountsTab as EventListener)
        }
    }, [openTabs, onTabOpen, onTabChange])

    return (
        <div className="flex h-14 items-center border-b border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
            {/* 左侧间距，避免与侧边栏按钮重叠 */}
            <div className="w-4 flex-shrink-0" />

            {/* 左侧滚动箭头 */}
            {canScrollLeft && (
                <TooltipProvider delayDuration={300}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => scroll('left')}
                                className="flex-shrink-0 flex h-10 w-8 items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all duration-200 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                            >
                                <ChevronLeft className="h-5 w-5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>向左滚动</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {/* Tab列表容器 - 带有渐变效果 */}
            <div className="relative flex-1 overflow-hidden">
                {/* 左侧渐变 */}
                {canScrollLeft && (
                    <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent dark:from-gray-900 z-10 pointer-events-none" />
                )}

                {/* Tab列表 */}
                <div
                    ref={tabListRef}
                    className="flex items-center overflow-x-auto scrollbar-hide scroll-smooth"
                >
                    {openTabs.map((tabId) => {
                        const tab = getTabInfo(tabId)
                        if (!tab) return null

                        const Icon = tab.icon
                        const isActive = activeTab === tabId

                        return (
                            <DropdownMenu
                                key={tabId}
                                open={contextMenuTabId === tabId}
                                onOpenChange={(open) => {
                                    if (!open) setContextMenuTabId(null)
                                }}
                            >
                                <DropdownMenuTrigger asChild>
                                    <div
                                        data-tab-id={tabId}
                                        className={cn(
                                            'group relative flex h-12 min-w-[140px] max-w-[200px] cursor-pointer items-center rounded-t-lg px-4 mx-1 transition-all duration-200',
                                            isActive
                                                ? 'bg-gradient-to-t from-gray-50 to-white text-primary-600 shadow-sm border-t border-l border-r border-gray-200 dark:from-gray-800 dark:to-gray-700 dark:text-primary-400 dark:border-gray-700'
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                                        )}
                                        onClick={() => onTabChange(tabId)}
                                        onContextMenu={(e) => {
                                            e.preventDefault()
                                            setContextMenuTabId(tabId)
                                        }}
                                    >
                                        <Icon className="mr-2 h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                                        <span className="flex-1 truncate text-sm font-medium">
                                            {tab.name}
                                        </span>
                                        {openTabs.length > 1 && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onTabClose(tabId)
                                                }}
                                                className="ml-2 rounded-full p-0.5 opacity-0 transition-all duration-200 hover:bg-gray-300 group-hover:opacity-100 dark:hover:bg-gray-600"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        )}
                                        {isActive && (
                                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 dark:bg-primary-400 animate-pulse" />
                                        )}
                                    </div>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-40">
                                    <DropdownMenuItem
                                        onClick={() => handleRefreshTabFromContext(tabId)}
                                        className="cursor-pointer"
                                    >
                                        <RefreshCw className="h-4 w-4 mr-2 text-blue-500" />
                                        刷新
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )
                    })}
                </div>

                {/* 右侧渐变 */}
                {canScrollRight && (
                    <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent dark:from-gray-900 z-10 pointer-events-none" />
                )}
            </div>

            {/* 右侧滚动箭头 */}
            {canScrollRight && (
                <TooltipProvider delayDuration={300}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => scroll('right')}
                                className="flex-shrink-0 flex h-10 w-8 items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all duration-200 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                            >
                                <ChevronRight className="h-5 w-5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>向右滚动</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {/* 分隔符 */}
            <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 mx-2 flex-shrink-0" />

            {/* 打开的标签页下拉菜单 - 显示所有打开的 tab */}
            {openTabs.length > 1 && (
                <TooltipProvider delayDuration={300}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div>
                                <Dropdown
                                    trigger={
                                        <button className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-all duration-200 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 relative">
                                            <MoreHorizontal className="h-5 w-5" />
                                            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary-500 text-[10px] font-medium text-white">
                                                {openTabs.length}
                                            </span>
                                        </button>
                                    }
                                    className="w-56"
                                >
                                    <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                                        打开的标签页 ({openTabs.length})
                                    </div>
                                    <div className="max-h-80 overflow-y-auto py-1">
                                        {openTabs.map((tabId) => {
                                            const tab = getTabInfo(tabId)
                                            if (!tab) return null
                                            const Icon = tab.icon
                                            const isActive = activeTab === tabId
                                            return (
                                                <button
                                                    key={tabId}
                                                    onClick={() => onTabChange(tabId)}
                                                    className={cn(
                                                        "flex w-full items-center px-3 py-2 text-sm transition-colors duration-150",
                                                        isActive
                                                            ? "bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400"
                                                            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                                                    )}
                                                >
                                                    <Icon className="mr-2 h-4 w-4 flex-shrink-0" />
                                                    <span className="flex-1 truncate text-left">{tab.name}</span>
                                                    {isActive && (
                                                        <Check className="h-4 w-4 ml-2 text-primary-600 dark:text-primary-400 flex-shrink-0" />
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </Dropdown>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>查看所有标签页</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}

            {/* 右侧刷新按钮 */}
            <div className="flex-shrink-0">
                <TooltipProvider delayDuration={300}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={handleRefreshActiveTab}
                                className={cn(
                                    "flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-all duration-200 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200",
                                    isRefreshing && "animate-spin text-primary-600 dark:text-primary-400"
                                )}
                            >
                                <RefreshCw className="h-4 w-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>刷新当前标签页</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            {/* 分隔符 */}
            <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 mx-2 flex-shrink-0" />

            {/* 添加新tab的下拉菜单 */}
            {availableTabs.length > 0 && (
                <Dropdown
                    trigger={
                        <button className="flex h-10 items-center justify-center rounded-lg px-3 mx-2 text-gray-600 hover:bg-gray-100 transition-colors duration-200 dark:text-gray-400 dark:hover:bg-gray-800">
                            <Plus className="h-5 w-5 transition-transform duration-200 hover:rotate-90" />
                        </button>
                    }
                    className="w-48"
                >
                    {availableTabs.map((tab) => {
                        const Icon = tab.icon
                        return (
                            <button
                                key={tab.id}
                                onClick={() => onTabOpen(tab.id)}
                                className="flex w-full items-center px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                            >
                                <Icon className="mr-2 h-4 w-4" />
                                {tab.name}
                            </button>
                        )
                    })}
                </Dropdown>
            )}
        </div>
    )
}

// 导出 useTabManager hook - 从 hooks 目录导入并重新导出
export { useTabManager } from '@/hooks/use-tab-manager'
