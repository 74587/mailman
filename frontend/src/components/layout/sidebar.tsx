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
    Briefcase,
    Server,
    KeyRound,
    Tags,
    ScrollText,
    type LucideIcon,
} from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '@/components/theme-provider'
import { useAuth } from '@/context/auth-context'
import { applyMenuOrderToItems, isMenuVisible, loadMenuPreferencesFromServer, subscribeMenuVisibility } from '@/lib/menu-config'

// 菜单项接口定义
interface MenuItem {
    name: string
    id: string
    icon: LucideIcon
    description?: string
    hidden?: boolean  // 隐藏但不删除
    superAdminOnly?: boolean
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
    { name: '仪表板', id: 'dashboard', icon: LayoutDashboard, description: '全局概览' },
]

// 邮箱运营菜单组
const mailNavigation: MenuItem[] = [
    { name: '邮箱账户管理', id: 'accounts', icon: UserCog, permission: { resource: 'email_account', action: 'read' } },
    { name: '邮件管理', id: 'emails', icon: Mail, hidden: true },  // 隐藏
    { name: '经典邮件管理器', id: 'classic-mailbox', icon: Inbox, permission: { resource: 'email', action: 'read' } },
    { name: '发送邮件', id: 'compose-email', icon: Send, permission: { resource: 'email', action: 'read' } },
    { name: '取件', id: 'mail-pickup', icon: Inbox, hidden: true },
    { name: '取件', id: 'mail-pickup-v2', icon: Package, description: '邮件监听 · 自动提取', permission: { resource: 'trigger', action: 'read' } },
    { name: '取件模板', id: 'pickup', icon: FileText, hidden: true },
    { name: '取件模板', id: 'extractor-v2-list', icon: FileText, description: '管理提取模板', permission: { resource: 'template', action: 'read' } },
    { name: '同步配置', id: 'sync-config', icon: RefreshCw, permission: { resource: 'sync_config', action: 'read' } },
    { name: 'OAuth2 配置', id: 'oauth2-config', icon: Key, permission: { resource: 'system_config', action: 'read' } },
]

// 代理池管理菜单组
const proxyNavigation: MenuItem[] = [
    { name: '代理列表', id: 'proxy-pool', icon: Network, description: '代理分组 · 标签 · 检测', permission: { resource: 'email_account', action: 'read' } },
    { name: '代理网关', id: 'proxy-gateway-gateways', icon: Server, description: '入口 · 路由 · 安全 · DNS', permission: { resource: 'email_account', action: 'read' } },
    { name: '网关用户', id: 'proxy-gateway-accounts', icon: KeyRound, description: '授权网关 · 策略 · 限速', permission: { resource: 'email_account', action: 'read' } },
    { name: '账号分组', id: 'proxy-gateway-account-groups', icon: Users, description: '用户分组维护', permission: { resource: 'email_account', action: 'read' } },
    { name: '账号标签', id: 'proxy-gateway-account-tags', icon: Tags, description: '用户标签维护', permission: { resource: 'email_account', action: 'read' } },
    { name: '网关日志', id: 'proxy-gateway-logs', icon: FileText, description: '访问日志 · 审计记录', permission: { resource: 'email_account', action: 'read' } },
]

// 业务资料菜单组
const businessNavigation: MenuItem[] = [
    { name: '业务账户', id: 'business-accounts', icon: Briefcase, description: '站点账号 · 2FA · 资料', permission: { resource: 'email_account', action: 'read' } },
    { name: '业务模块', id: 'business-modules', icon: Package, description: 'Logo · 状态 · 字段模板', permission: { resource: 'email_account', action: 'read' } },
]

// 日志中心菜单组
const logNavigation: MenuItem[] = [
    { name: '实时日志', id: 'output-logs', icon: ScrollText, description: '实时流 · 搜索 · 时间过滤', permission: { resource: 'system_config', action: 'read' } },
    { name: '实时日志设置', id: 'output-log-settings', icon: Settings, description: '缓冲 · 查询 · 订阅保护', permission: { resource: 'system_config', action: 'read' } },
    { name: '业务日志', id: 'business-logs', icon: Shield, description: '审计 · 流程 · 异常排查', permission: { resource: 'system_config', action: 'read' } },
    { name: '业务日志组织设置', id: 'business-log-org-settings', icon: Building2, description: '组织覆盖 · 模块覆盖', permission: { resource: 'system_config', action: 'read' } },
    { name: '业务日志全局设置', id: 'business-log-global-settings', icon: Shield, description: '全局策略 · 超级管理员', superAdminOnly: true, permission: { resource: 'system_config', action: 'read' } },
]

// 系统管理菜单组
const adminNavigation: MenuItem[] = [
    { name: '运行状态', id: 'runtime-status', icon: BarChart3, description: '取件 · 导入 · Outlook', permission: { resource: 'system_config', action: 'read' } },
    { name: '系统配置', id: 'system-config', icon: Settings, permission: { resource: 'system_config', action: 'read' } },
    { name: '团队管理', id: 'team-management', icon: Building2, description: '组织 · 成员 · 角色', permission: { resource: 'organization', action: 'read' } },
    { name: '用户管理', id: 'user-management', icon: Users, description: '创建和管理系统用户' },
    { name: 'AI 配置', id: 'ai-config', icon: Bot, permission: { resource: 'ai_config', action: 'read' } },
    { name: '访问令牌', id: 'user-sessions', icon: Settings },
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
    { name: 'API 文档', id: 'api-docs', icon: BookOpen, description: 'Swagger 接口文档' },
    { name: '接入手册', id: 'integration-guide', icon: FileText, description: 'HTML 文档库 · 场景指南' },
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
    const tooltip = item.description ? `${item.name} - ${item.description}` : item.name

    return (
        <button
            onClick={onClick}
            className={cn(
                'group relative flex h-9 w-full items-center rounded-md text-sm font-medium transition-colors duration-150',
                isSubItem && !collapsed ? 'px-2.5 pl-3' : 'px-2.5',
                isActive
                    ? 'bg-[rgb(var(--sidebar-active-bg)_/_0.82)] text-sidebar-active'
                    : 'text-sidebar-text hover:bg-[rgb(var(--sidebar-hover-bg)_/_0.68)] hover:text-sidebar-text-hover',
                collapsed && 'justify-center px-2'
            )}
            title={collapsed || item.description ? tooltip : undefined}
            aria-current={isActive ? 'page' : undefined}
        >
            {isActive && (
                <div className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full bg-sidebar-active" />
            )}

            <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                <item.icon
                    className={cn(
                        'h-4 w-4 transition-colors duration-150',
                        isActive ? 'text-sidebar-active' : 'text-sidebar-text group-hover:text-sidebar-text-hover'
                    )}
                />
            </span>

            {!collapsed && (
                <span className="ml-2 min-w-0 flex-1 truncate text-left leading-5">
                    {item.name}
                </span>
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
    const open = group.expanded || hasActiveItem || collapsed

    return (
        <div
            className={cn(
                'rounded-lg border border-[rgb(var(--sidebar-border)_/_0.72)] bg-[rgb(var(--sidebar-bg)_/_0.86)] shadow-[0_1px_2px_rgb(15_23_42_/_0.025)] transition-colors duration-150',
                hasActiveItem && 'border-[rgb(var(--sidebar-active)_/_0.24)] bg-[linear-gradient(180deg,rgb(var(--sidebar-active-bg)_/_0.62),rgb(var(--sidebar-bg)_/_0.94))] shadow-[0_4px_12px_rgb(37_99_235_/_0.055)]',
                collapsed ? 'p-1' : 'p-1.5'
            )}
        >
            <button
                onClick={() => group.setExpanded(!group.expanded)}
                className={cn(
                    'group flex h-8 w-full items-center rounded-lg px-2 text-xs font-semibold transition-colors duration-150',
                    hasActiveItem
                        ? 'text-sidebar-active'
                        : 'text-sidebar-text hover:bg-[rgb(var(--sidebar-hover-bg)_/_0.58)] hover:text-sidebar-text-hover',
                    collapsed && 'h-8 justify-center px-2'
                )}
                title={collapsed ? group.title : undefined}
                aria-expanded={open}
            >
                <group.icon className={cn(
                    'h-4 w-4 shrink-0 transition-colors duration-150',
                    hasActiveItem ? 'text-sidebar-active' : 'text-sidebar-text group-hover:text-sidebar-text-hover'
                )} />
                {!collapsed && (
                    <>
                        <span className="ml-2 flex-1 truncate text-left">{group.title}</span>
                        <ChevronDown className={cn(
                            'h-3.5 w-3.5 transition-transform duration-150',
                            open ? 'rotate-0' : '-rotate-90'
                        )} />
                    </>
                )}
            </button>

            {/* 菜单项 */}
            <div
                className={cn(
                    'overflow-hidden transition-all duration-200',
                    open ? 'max-h-[520px] opacity-100' : 'max-h-0 opacity-0',
                    open && !collapsed && 'mt-1 border-t border-[rgb(var(--sidebar-border)_/_0.56)] pt-1'
                )}
            >
                <div className="space-y-0.5">
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
    const [triggerMenuExpanded, setTriggerMenuExpanded] = useState(false)
    const [pluginMenuExpanded, setPluginMenuExpanded] = useState(false)
    const [developerMenuExpanded, setDeveloperMenuExpanded] = useState(false)
    const [adminMenuExpanded, setAdminMenuExpanded] = useState(false)
    const [businessMenuExpanded, setBusinessMenuExpanded] = useState(true)
    const [mailMenuExpanded, setMailMenuExpanded] = useState(true)
    const [proxyMenuExpanded, setProxyMenuExpanded] = useState(true)
    const [logMenuExpanded, setLogMenuExpanded] = useState(true)
    const [, setMenuVersion] = useState(0) // 用于触发菜单重新渲染
    const { theme, setTheme } = useTheme()
    const { logout, isSuperAdmin, hasPermission } = useAuth()

    // 菜单可见性过滤
    const filterByVisibility = useCallback((items: MenuItem[]) => {
        return applyMenuOrderToItems(items).filter(item => {
            if (item.hidden) return false
            if (item.superAdminOnly && !isSuperAdmin) return false
            if (!isMenuVisible(item.id)) return false
            if (item.permission && !hasPermission(item.permission.resource, item.permission.action)) return false
            return true
        })
    }, [hasPermission, isSuperAdmin])

    // 订阅菜单可见性变化
    useEffect(() => {
        return subscribeMenuVisibility(() => {
            setMenuVersion(v => v + 1)
        })
    }, [])

    useEffect(() => {
        loadMenuPreferencesFromServer().catch(error => {
            logger.warn('[Sidebar] 加载菜单偏好失败:', error)
        })
    }, [])

    // 监听主题变化
    useEffect(() => {
        logger.debug('[Sidebar] 主题变化:', theme)
        logger.debug('[Sidebar] 当前html类:', document.documentElement.className)
    }, [theme])

    // 菜单组配置 - 以菜单管理显隐配置和权限为准
    const menuGroups: MenuGroup[] = []
    const filteredMailNav = filterByVisibility(mailNavigation)
    const filteredProxyNav = filterByVisibility(proxyNavigation)
    const filteredBusinessNav = filterByVisibility(businessNavigation)
    const filteredLogNav = filterByVisibility(logNavigation)
    const filteredTriggerNav = filterByVisibility(triggerNavigation)
    const filteredPluginNav = filterByVisibility(pluginNavigation)
    const filteredDeveloperNav = filterByVisibility(developerNavigation)

    if (filteredMailNav.length > 0) {
        menuGroups.push({
            title: '邮箱运营',
            icon: Mail,
            items: filteredMailNav,
            expanded: mailMenuExpanded,
            setExpanded: setMailMenuExpanded,
        })
    }

    if (filteredProxyNav.length > 0) {
        menuGroups.push({
            title: '代理池管理',
            icon: Network,
            items: filteredProxyNav,
            expanded: proxyMenuExpanded,
            setExpanded: setProxyMenuExpanded,
        })
    }

    if (filteredBusinessNav.length > 0) {
        menuGroups.push({
            title: '业务资料',
            icon: Briefcase,
            items: filteredBusinessNav,
            expanded: businessMenuExpanded,
            setExpanded: setBusinessMenuExpanded,
        })
    }

    if (filteredTriggerNav.length > 0) {
        menuGroups.push({
            title: '自动化',
            icon: Zap,
            items: filteredTriggerNav,
            expanded: triggerMenuExpanded,
            setExpanded: setTriggerMenuExpanded,
        })
    }

    if (filteredLogNav.length > 0) {
        menuGroups.push({
            title: '日志中心',
            icon: ScrollText,
            items: filteredLogNav,
            expanded: logMenuExpanded,
            setExpanded: setLogMenuExpanded,
        })
    }

    // 系统管理菜单组（所有用户可见，但用户管理仅超管可见）
    const filteredAdminNav = isSuperAdmin
        ? adminNavigation
        : adminNavigation.filter(item => item.id !== 'user-management')

    const visibleAdminNav = filterByVisibility(filteredAdminNav)
    if (visibleAdminNav.length > 0) {
        menuGroups.push({
            title: '系统与权限',
            icon: Settings,
            items: visibleAdminNav,
            expanded: adminMenuExpanded,
            setExpanded: setAdminMenuExpanded,
        })
    }

    if (filteredPluginNav.length > 0) {
        menuGroups.push({
            title: '扩展插件',
            icon: Puzzle,
            items: filteredPluginNav,
            expanded: pluginMenuExpanded,
            setExpanded: setPluginMenuExpanded,
        })
    }

    if (filteredDeveloperNav.length > 0) {
        menuGroups.push({
            title: '文档与开发',
            icon: Code2,
            items: filteredDeveloperNav,
            expanded: developerMenuExpanded,
            setExpanded: setDeveloperMenuExpanded,
        })
    }

    return (
        <div
            className={cn(
                'relative flex h-screen flex-col transition-all duration-300',
                'bg-sidebar-bg border-r border-sidebar-border',
                collapsed ? 'w-16' : 'w-[248px]'
            )}
        >
            {/* Logo Header */}
            <div className={cn(
                'relative flex-shrink-0 flex items-center border-b border-sidebar-border',
                'h-14 px-3',
                collapsed ? 'justify-center' : 'gap-3'
            )}>
                {/* Logo 图标 */}
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-active shadow-sm">
                    <Mail className="h-[18px] w-[18px] text-white" />
                </div>

                {!collapsed && (
                    <div className="flex flex-col min-w-0">
                        <span className="truncate text-sm font-semibold text-sidebar-text-hover">
                            邮箱管理系统
                        </span>
                        <span className="text-[11px] text-sidebar-text">
                            Mailman
                        </span>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <nav className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3 scrollbar-hide">
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
                    <div className="mt-3 space-y-2">
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
            <div className="relative flex-shrink-0 space-y-1 border-t border-sidebar-border p-2">
                {/* Theme toggle */}
                <button
                    onClick={() => {
                        const newTheme = theme === 'dark' ? 'light' : 'dark'
                        logger.debug('[Sidebar] 切换主题:', theme, '->', newTheme)
                        setTheme(newTheme)
                    }}
                    className={cn(
                        'group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                        'bg-sidebar-hover-bg text-sidebar-text hover:text-sidebar-text-hover',
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
                        'text-sidebar-text hover:text-red-600 dark:hover:text-red-400',
                        collapsed && 'justify-center px-2'
                    )}
                >
                    <LogOut className="h-[18px] w-[18px] text-sidebar-text group-hover:text-red-500" />
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
                    'bg-sidebar-bg',
                    'border border-sidebar-border',
                    'text-sidebar-text hover:text-sidebar-text-hover',
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
