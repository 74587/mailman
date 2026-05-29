'use client'

import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'
import {
    LayoutDashboard,
    Mail,
    UserCog,
    Settings,
    ChevronLeft,
    ChevronRight,
    LogOut,
    Moon,
    Sun,
    FileText,
    Bot,
    Inbox,
    Bell,
    RefreshCw,
    Zap,
    Key,
    Sparkles,
    PlusCircle,
    BarChart3,
    TestTube,
    ChevronDown,
    ChevronUp,
    PlayCircle,
    Puzzle,
    Code2,
    Bug,
    FlaskConical,
    Send,
    Shield,
    Package,
    BookOpen,
    Building2,
    Users,
    Crown,
    Network,
    type LucideIcon,
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '@/components/theme-provider'
import { useAuth } from '@/context/auth-context'
import { isMenuVisible, subscribeMenuVisibility } from '@/lib/menu-config'

// 菜单项接口定义
interface MenuItem {
    name: string
    id: string
    icon: LucideIcon
    description?: string
    hidden?: boolean  // 隐藏但不删除
    permission?: { resource: string; action: string }
}

interface MenuGroup {
    title: string
    icon: LucideIcon
    items: MenuItem[]
    expanded: boolean
    setExpanded: (expanded: boolean) => void
}

const navigation: MenuItem[] = [
    { name: '仪表板', id: 'dashboard', icon: LayoutDashboard },
    { name: '邮箱账户管理', id: 'accounts', icon: UserCog, permission: { resource: 'email_account', action: 'read' } },
    { name: '邮件管理', id: 'emails', icon: Mail, hidden: true },  // 隐藏
    { name: '发送邮件', id: 'compose-email', icon: Send, permission: { resource: 'email', action: 'read' } },
    { name: '经典邮件管理器', id: 'classic-mailbox', icon: Inbox, permission: { resource: 'email', action: 'read' } },
    { name: '同步配置', id: 'sync-config', icon: RefreshCw, permission: { resource: 'sync_config', action: 'read' } },
    { name: '代理池管理', id: 'proxy-pool', icon: Network, description: '代理分组 · 标签 · 检测', permission: { resource: 'email_account', action: 'read' } },
    { name: '取件', id: 'mail-pickup', icon: Inbox, hidden: true },
    { name: '取件', id: 'mail-pickup-v2', icon: Package, description: '邮件监听 · 自动提取', permission: { resource: 'trigger', action: 'read' } },
    { name: '取件模板', id: 'pickup', icon: FileText, hidden: true },
    { name: '取件模板', id: 'extractor-v2-list', icon: FileText, description: '管理提取模板', permission: { resource: 'template', action: 'read' } },
    { name: 'API 文档', id: 'api-docs', icon: BookOpen, description: 'Swagger 接口文档' },

]

// 系统管理菜单组
const adminNavigation: MenuItem[] = [
    { name: '团队管理', id: 'team-management', icon: Building2, description: '组织 · 成员 · 角色', permission: { resource: 'organization', action: 'read' } },
    { name: '用户管理', id: 'user-management', icon: Users, description: '创建和管理系统用户' },
    { name: 'OAuth2 配置', id: 'oauth2-config', icon: Key, permission: { resource: 'system_config', action: 'read' } },
    { name: 'AI 配置', id: 'ai-config', icon: Bot, permission: { resource: 'ai_config', action: 'read' } },
    { name: '访问令牌', id: 'user-sessions', icon: Settings },
    { name: '系统配置', id: 'system-config', icon: Settings, permission: { resource: 'system_config', action: 'read' } },
]

// 高级模组菜单组
const triggerNavigation: MenuItem[] = [
    { name: '触发器管理', id: 'triggers', icon: Zap, description: '管理所有触发器规则', permission: { resource: 'trigger', action: 'read' } },
    { name: '拦截器管理', id: 'interceptors', icon: Shield, description: '配置全局动作拦截器', permission: { resource: 'trigger', action: 'read' } },
    { name: '创建触发器', id: 'trigger-create', icon: PlusCircle, description: '多步骤触发器创建向导', hidden: true },  // 隐藏
    { name: '过滤器模板', id: 'filter-templates', icon: FileText, description: '管理复用过滤条件', permission: { resource: 'template', action: 'read' } },
    { name: '动作模板', id: 'action-templates', icon: Zap, description: '管理复用执行动作', permission: { resource: 'template', action: 'read' } },
    { name: '高级调试器', id: 'trigger-advanced-debug', icon: TestTube, description: '过滤动作触发器调试工具', hidden: true },  // 隐藏
]

// 插件管理菜单组
const pluginNavigation: MenuItem[] = [
    { name: '插件列表', id: 'plugins', icon: Puzzle, description: '管理所有插件' },
]

// 开发者模式菜单组
const developerNavigation: MenuItem[] = [
    { name: '接入手册', id: 'integration-guide', icon: FileText, description: 'OAuth · 邮件 API · 部署指南' },
    { name: '表达式调试器', id: 'expression-debugger', icon: Bug, description: '调试条件表达式' },
    { name: '动作调试器', id: 'action-debugger', icon: PlayCircle, description: '调试动作插件' },
    { name: '过滤动作触发器', id: 'filter-action-trigger', icon: Zap, description: '完整触发器调试' },
    { name: '组件测试', id: 'component-test', icon: FlaskConical, description: '测试UI组件' },
]

interface SidebarProps {
    activeTab: string
    onTabChange: (tab: string) => void
}

// 统一的菜单项组件
function MenuItemComponent({
    item,
    isActive,
    collapsed,
    onClick,
    isSubItem = false
}: {
    item: MenuItem
    isActive: boolean
    collapsed: boolean
    onClick: () => void
    isSubItem?: boolean
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                'group relative flex w-full items-center rounded-lg text-sm font-medium transition-all duration-200',
                // 适中的高度和内边距
                isSubItem ? 'py-2 px-3 ml-2' : 'py-2.5 px-3',
                // 激活状态
                isActive
                    ? 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 text-blue-600 dark:from-blue-500/15 dark:to-indigo-500/15 dark:text-blue-400'
                    : 'text-gray-600 hover:bg-gray-100/80 dark:text-gray-400 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-200',
                collapsed && 'justify-center px-2'
            )}
            title={collapsed ? item.name : undefined}
        >
            {/* 激活指示条 */}
            {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-r-full" />
            )}

            {/* 图标 */}
            <item.icon
                className={cn(
                    'h-[18px] w-[18px] shrink-0 transition-all duration-200',
                    isActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300'
                )}
            />

            {!collapsed && (
                <div className="ml-2.5 flex-1 text-left overflow-hidden">
                    <div className="truncate">{item.name}</div>
                    {item.description && (
                        <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate leading-tight">
                            {item.description}
                        </div>
                    )}
                </div>
            )}
        </button>
    )
}

// 统一的菜单组组件
function MenuGroupComponent({
    group,
    collapsed,
    activeTab,
    onTabChange,
    hasPermission
}: {
    group: MenuGroup
    collapsed: boolean
    activeTab: string
    onTabChange: (tab: string) => void
    hasPermission: (resource: string, action: string) => boolean
}) {
    const hasActiveItem = group.items.some(item => item.id === activeTab)

    return (
        <div className="pt-3">
            {/* 分组标题 */}
            <button
                onClick={() => group.setExpanded(!group.expanded)}
                className={cn(
                    'flex w-full items-center px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all duration-200',
                    hasActiveItem
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300',
                    collapsed && 'justify-center'
                )}
            >
                <group.icon className={cn(
                    'h-4 w-4',
                    hasActiveItem ? 'text-blue-500 dark:text-blue-400' : ''
                )} />
                {!collapsed && (
                    <>
                        <span className="flex-1 text-left ml-2">{group.title}</span>
                        <ChevronDown className={cn(
                            'h-3.5 w-3.5 transition-transform duration-200',
                            group.expanded ? 'rotate-0' : '-rotate-90'
                        )} />
                    </>
                )}
            </button>

            {/* 菜单项 */}
            <div
                className={cn(
                    'overflow-hidden transition-all duration-200',
                    (group.expanded || collapsed) ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
                )}
            >
                <div className="space-y-0.5 mt-1">
                    {group.items.filter(item => !item.hidden && isMenuVisible(item.id) && (!item.permission || hasPermission(item.permission.resource, item.permission.action))).map((item) => (
                        <MenuItemComponent
                            key={item.id}
                            item={item}
                            isActive={activeTab === item.id}
                            collapsed={collapsed}
                            onClick={() => onTabChange && onTabChange(item.id)}
                            isSubItem={true}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
    const [collapsed, setCollapsed] = useState(false)
    const [triggerMenuExpanded, setTriggerMenuExpanded] = useState(true)
    const [pluginMenuExpanded, setPluginMenuExpanded] = useState(true)
    const [developerMenuExpanded, setDeveloperMenuExpanded] = useState(true)
    const [adminMenuExpanded, setAdminMenuExpanded] = useState(true)
    const [, setMenuVersion] = useState(0) // 用于触发菜单重新渲染
    const { theme, setTheme } = useTheme()
    const { logout, isSuperAdmin, hasPermission } = useAuth()

    // 菜单可见性过滤
    const filterByVisibility = useCallback((items: MenuItem[]) => {
        return items.filter(item => {
            if (item.hidden) return false
            if (!isMenuVisible(item.id)) return false
            if (item.permission && !hasPermission(item.permission.resource, item.permission.action)) return false
            return true
        })
    }, [hasPermission])

    // 订阅菜单可见性变化
    useEffect(() => {
        return subscribeMenuVisibility(() => {
            setMenuVersion(v => v + 1)
        })
    }, [])

    // 监听主题变化
    useEffect(() => {
        logger.debug('[Sidebar] 主题变化:', theme)
        logger.debug('[Sidebar] 当前html类:', document.documentElement.className)
    }, [theme])

    // 菜单组配置 - 以菜单管理显隐配置和权限为准
    const menuGroups: MenuGroup[] = []
    const filteredTriggerNav = filterByVisibility(triggerNavigation)
    const filteredPluginNav = filterByVisibility(pluginNavigation)
    const filteredDeveloperNav = filterByVisibility(developerNavigation)

    if (filteredTriggerNav.length > 0) {
        menuGroups.push({
            title: '高级模组',
            icon: Zap,
            items: filteredTriggerNav,
            expanded: triggerMenuExpanded,
            setExpanded: setTriggerMenuExpanded,
        })
    }

    if (filteredPluginNav.length > 0) {
        menuGroups.push({
            title: '插件管理',
            icon: Puzzle,
            items: filteredPluginNav,
            expanded: pluginMenuExpanded,
            setExpanded: setPluginMenuExpanded,
        })
    }

    if (filteredDeveloperNav.length > 0) {
        menuGroups.push({
            title: '开发者模式',
            icon: Code2,
            items: filteredDeveloperNav,
            expanded: developerMenuExpanded,
            setExpanded: setDeveloperMenuExpanded,
        })
    }

    // 系统管理菜单组（所有用户可见，但用户管理仅超管可见）
    const filteredAdminNav = isSuperAdmin
        ? adminNavigation
        : adminNavigation.filter(item => item.id !== 'user-management')

    const visibleAdminNav = filterByVisibility(filteredAdminNav)
    if (visibleAdminNav.length > 0) {
        menuGroups.push({
            title: '系统管理',
            icon: Settings,
            items: visibleAdminNav,
            expanded: adminMenuExpanded,
            setExpanded: setAdminMenuExpanded,
        })
    }

    return (
        <div
            className={cn(
                'relative flex h-screen flex-col transition-all duration-300',
                // 背景 - 简洁渐变
                'bg-gradient-to-b from-white to-gray-50/80 dark:from-gray-900 dark:to-gray-950',
                'border-r border-gray-200/80 dark:border-gray-800/50',
                // 宽度
                collapsed ? 'w-16' : 'w-64'
            )}
        >
            {/* 背景装饰 */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/[0.03] rounded-full blur-3xl dark:bg-blue-500/[0.08]" />
                <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-purple-500/[0.03] rounded-full blur-3xl dark:bg-purple-500/[0.08]" />
            </div>

            {/* Logo Header */}
            <div className={cn(
                'relative flex-shrink-0 flex items-center border-b border-gray-200/80 dark:border-gray-800/50',
                'h-14 px-3',
                collapsed ? 'justify-center' : 'gap-3'
            )}>
                {/* Logo 图标 */}
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md shadow-blue-500/25">
                    <Mail className="h-[18px] w-[18px] text-white" />
                </div>

                {!collapsed && (
                    <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                            邮箱管理系统
                        </span>
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">
                            Mailman
                        </span>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <nav className="relative flex-1 min-h-0 px-2 py-3 overflow-y-auto scrollbar-hide">
                {/* 主导航 */}
                <div className="space-y-0.5">
                    {filterByVisibility(navigation).map((item) => (
                        <MenuItemComponent
                            key={item.id}
                            item={item}
                            isActive={activeTab === item.id}
                            collapsed={collapsed}
                            onClick={() => onTabChange && onTabChange(item.id)}
                        />
                    ))}
                </div>

                {/* 分组导航 */}
                {menuGroups.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200/60 dark:border-gray-800/60">
                        {menuGroups.map((group) => (
                            <MenuGroupComponent
                                key={group.title}
                                group={group}
                                collapsed={collapsed}
                                activeTab={activeTab}
                                onTabChange={onTabChange}
                                hasPermission={hasPermission}
                            />
                        ))}
                    </div>
                )}
            </nav>

            {/* Bottom section */}
            <div className="relative flex-shrink-0 border-t border-gray-200/80 dark:border-gray-800/50 p-2 space-y-1">
                {/* Theme toggle */}
                <button
                    onClick={() => {
                        const newTheme = theme === 'dark' ? 'light' : 'dark'
                        logger.debug('[Sidebar] 切换主题:', theme, '->', newTheme)
                        setTheme(newTheme)
                    }}
                    className={cn(
                        'group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                        'bg-gray-100/60 hover:bg-gray-200/80 dark:bg-white/5 dark:hover:bg-white/10',
                        'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200',
                        collapsed && 'justify-center px-2'
                    )}
                >
                    <div className={cn(
                        'flex items-center justify-center w-7 h-7 rounded-md',
                        'bg-btn-icon-bg text-btn-icon-text'
                    )}>
                        {theme === 'dark' ? (
                            <Sun className="h-4 w-4" />
                        ) : (
                            <Moon className="h-4 w-4" />
                        )}
                    </div>
                    {!collapsed && (
                        <span className="ml-2.5">
                            {theme === 'dark' ? '浅色模式' : '深色模式'}
                        </span>
                    )}
                </button>

                {/* Logout */}
                <button
                    onClick={() => logout()}
                    className={cn(
                        'group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                        'hover:bg-red-50 dark:hover:bg-red-900/20',
                        'text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400',
                        collapsed && 'justify-center px-2'
                    )}
                >
                    <LogOut className="h-[18px] w-[18px] text-gray-400 group-hover:text-red-500 dark:text-gray-500" />
                    {!collapsed && <span className="ml-2.5">退出登录</span>}
                </button>
            </div>

            {/* Collapse toggle */}
            <button
                onClick={() => setCollapsed(!collapsed)}
                className={cn(
                    'absolute -right-3 top-[72px] z-10',
                    'flex h-6 w-6 items-center justify-center',
                    'rounded-full shadow-md',
                    'bg-white dark:bg-gray-800',
                    'border border-gray-200 dark:border-gray-700',
                    'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300',
                    'hover:scale-110 active:scale-95',
                    'transition-all duration-200'
                )}
            >
                <ChevronRight className={cn(
                    'h-3.5 w-3.5 transition-transform duration-200',
                    !collapsed && 'rotate-180'
                )} />
            </button>
        </div>
    )
}
