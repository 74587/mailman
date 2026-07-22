'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { logger } from '@/lib/logger'
import { useAuth } from '@/context/auth-context'
import { Sidebar } from '@/components/layout/sidebar'
import { PermissionGuard } from '@/components/permission-guard'
import { Header } from '@/components/layout/header'
import { TabManager } from '@/components/layout/tab-manager'
import { Loader2, Layers, Search } from 'lucide-react'
import DashboardTab from '@/components/tabs/dashboard-tab'
import AccountsTab from '@/components/tabs/accounts-tab'
import EmailsTab from '@/components/tabs/emails-tab'
import MailPickupTab from '@/components/tabs/mail-pickup-tab'
import PickupTab from '@/components/tabs/pickup-tab'
// 根据需求隐藏设置功能
// import SettingsTab from '@/components/tabs/settings-tab'
import { AIConfigTab } from '@/components/tabs/ai-config-tab'
// 根据需求隐藏订阅管理功能
// import { SubscriptionsTab } from '@/components/tabs/subscriptions-tab'
import SyncConfigTab from '@/components/tabs/sync-config-tab'
import UserSessionsTab from '@/components/tabs/user-sessions-tab'
import { TriggersTab } from '@/components/tabs/triggers-tab'
import OAuth2ConfigTab from '@/components/tabs/oauth2-config-tab'
import PluginsTab from '@/components/tabs/plugins-tab'
import SystemConfigTab from '@/components/tabs/system-config-tab'
import { cn } from '@/lib/utils'
import { hasRefreshCallback, registerTabCallback, unregisterTabCallback } from '@/lib/tab-utils'
import type { ShortcutAction, ShortcutCategory } from '@/components/command-palette/command-palette'
import { registerPaletteCategory, updatePaletteCategory } from '@/components/command-palette/command-palette'
import { useAIRuntime } from '@/components/ai'
import { emailService } from '@/services/email.service'
import { clearAuthReturnUrl, rememberAuthReturnUrl } from '@/lib/auth-return-url'
import { toast } from 'sonner'

// Tab 名称映射表 - 格式: 中文名[英文名]
const tabNameMap: { [key: string]: string } = {
    'dashboard': '仪表板[dashboard]',
    'accounts': '邮箱账户管理[accounts]',
    'business-modules': '业务模块[business-modules]',
    'business-accounts': '业务账户[business-accounts]',
    'emails': '邮件管理[emails]',
    'classic-mailbox': '经典邮件管理器[classic-mailbox]',
    'compose-email': '发送邮件[compose-email]',
    'sync-config': '同步配置[sync-config]',
    'proxy-pool': '代理列表[proxy-pool]',
    'proxy-gateway-gateways': '代理网关[proxy-gateway-gateways]',
    'proxy-gateway-listeners': '代理网关[proxy-gateway-listeners]',
    'proxy-gateway-accounts': '网关用户[proxy-gateway-accounts]',
    'proxy-gateway-account-groups': '账号分组[proxy-gateway-account-groups]',
    'proxy-gateway-account-tags': '账号标签[proxy-gateway-account-tags]',
    'proxy-gateway-routes': '代理网关[proxy-gateway-routes]',
    'proxy-gateway-security': '代理网关[proxy-gateway-security]',
    'proxy-gateway-dns': '代理网关[proxy-gateway-dns]',
    'proxy-gateway-logs': '网关日志[proxy-gateway-logs]',
    'mail-pickup': '取件[mail-pickup]',
    'mail-pickup-v2': '取件[mail-pickup-v2]',
    'pickup': '取件模板[pickup]',
    'trigger-demo': '系统演示[trigger-demo]',
    'triggers': '触发器管理[triggers]',
    'trigger-create': '创建新规则[trigger-create]',
    'trigger-templates': '规则模板[trigger-templates]',
    'trigger-stats': '执行统计[trigger-stats]',
    'trigger-test': '测试调试[trigger-test]',
    'oauth2-config': 'OAuth2配置[oauth2-config]',
    'ai-config': 'AI配置[ai-config]',
    'user-sessions': '访问令牌[user-sessions]',
    'expression-debugger': '表达式调试器[expression-debugger]',
    'action-debugger': '动作调试器[action-debugger]',
    'filter-action-trigger': '过滤动作触发器[filter-action-trigger]',
    'filter-templates': '过滤模板[filter-templates]',
    'action-templates': '动作模板[action-templates]',
    'trigger-advanced-debug': '高级调试[trigger-advanced-debug]',
    'plugins': '插件管理[plugins]',
    'interceptors': '拦截器管理[interceptors]',
    'interceptor-logs': '拦截器日志[interceptor-logs]',
    'runtime-status': '运行状态[runtime-status]',
    'output-logs': '实时日志[output-logs]',
    'output-log-settings': '实时日志设置[output-log-settings]',
    'business-logs': '业务日志[business-logs]',
    'business-log-global-settings': '业务日志全局设置[business-log-global-settings]',
    'business-log-org-settings': '业务日志组织设置[business-log-org-settings]',
    'system-config': '系统配置[system-config]',
    'component-test': '组件测试[component-test]',
    'extractor-v2-list': '取件模板V2[extractor-v2-list]',
    'team-management': '团队管理[team-management]',
    'user-management': '用户管理[user-management]',
    'integration-guide': '接入手册[integration-guide]',
}

// 获取 Tab 显示名称
function getTabDisplayName(tabId: string): string {
    if (tabNameMap[tabId]) return tabNameMap[tabId]
    if (tabId.startsWith('trigger-edit-')) {
        const id = tabId.replace('trigger-edit-', '')
        return `编辑触发器[trigger-edit-${id}]`
    }
    if (tabId.startsWith('trigger-view-')) {
        const id = tabId.replace('trigger-view-', '')
        return `查看触发器[trigger-view-${id}]`
    }
    // 回复邮件 Tab
    if (tabId.startsWith('compose-reply-all-')) {
        return `全部回复[${tabId}]`
    }
    if (tabId.startsWith('compose-reply-')) {
        return `回复[${tabId}]`
    }
    if (tabId.startsWith('compose-forward-')) {
        return `转发[${tabId}]`
    }
    if (tabId.startsWith('account-note-')) {
        const id = tabId.replace('account-note-', '')
        return `账户备注[${id}]`
    }
    // 取件模板V2相关Tab
    if (tabId.startsWith('extractor-v2-create-')) {
        return `新建取件模板[${tabId}]`
    }
    if (tabId.startsWith('extractor-v2-edit-')) {
        const id = tabId.replace('extractor-v2-edit-', '')
        return `编辑取件模板[${id}]`
    }
    if (tabId.startsWith('extractor-v2-view-')) {
        const id = tabId.replace('extractor-v2-view-', '')
        return `查看取件模板[${id}]`
    }
    if (tabId.startsWith('extractor-v2-logs-')) {
        const id = tabId.replace('extractor-v2-logs-', '')
        return `取件日志[${id}]`
    }
    // 拦截器日志Tab
    if (tabId.startsWith('interceptor-logs-')) {
        const id = tabId.replace('interceptor-logs-', '')
        return `拦截器日志[${id}]`
    }
    return tabId
}

interface TabContent {
    [key: string]: React.ReactNode
}

export default function MainPage() {
    const [activeTab, setActiveTab] = useState('dashboard')
    const [openTabs, setOpenTabs] = useState<string[]>(['dashboard'])
    const [tabContents, setTabContents] = useState<TabContent>({})
    const { isAuthenticated, isLoading, hasPermission } = useAuth()
    const { setNavigationContext } = useAIRuntime()
    const router = useRouter()
    const resolvedMailShareRef = useRef<string | null>(null)

    // 存储待处理的Tab数据
    const [pendingTabData, setPendingTabData] = useState<{ [key: string]: any }>({})

    // 如果未登录，重定向到登录页
    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            rememberAuthReturnUrl()
            router.push('/login')
        }
    }, [isAuthenticated, isLoading, router])

    useEffect(() => {
        setNavigationContext({ activeTab, openTabs })
    }, [activeTab, openTabs, setNavigationContext])

    // 注册命令面板分类
    useEffect(() => {
        // 注册"切换Tab"分类
        registerPaletteCategory({
            id: 'switch-tab',
            name: '切换Tab',
            icon: Layers,
            actions: []
        })

        // 注册"快捷操作"分类
        registerPaletteCategory({
            id: 'quick-actions',
            name: '快捷操作',
            icon: Search,
            actions: [
                {
                    id: 'focus-search',
                    name: '快速查找邮件 (⌘G)',
                    onExecute: () => {
                        window.dispatchEvent(new CustomEvent('focusGlobalSearch'))
                    }
                }
            ]
        })
    }, [])

    // 当打开的Tab变化时，更新快捷操作列表
    useEffect(() => {
        const actions: ShortcutAction[] = openTabs.map(tabId => ({
            id: `switch-to-${tabId}`,
            name: getTabDisplayName(tabId),
            onExecute: () => setActiveTab(tabId)
        }))

        updatePaletteCategory('switch-tab', actions)
    }, [openTabs])

    // 初始化tab内容
    useEffect(() => {
        const initializeTab = (tabId: string) => {
            if (!tabContents[tabId]) {
                let content: React.ReactNode
                // Helper to wrap content with PermissionGuard
                const guard = (resource: string, action: string, node: React.ReactNode) => (
                    <PermissionGuard resource={resource} action={action}>{node}</PermissionGuard>
                )
                switch (tabId) {
                    case 'dashboard':
                        content = <DashboardTab key={tabId} />
                        break
                    case 'accounts':
                        content = guard('email_account', 'read', <AccountsTab key={tabId} />)
                        break
                    case 'business-modules':
                        const BusinessModulesTab = require('@/components/tabs/business-modules-tab').default
                        content = guard('email_account', 'read', <BusinessModulesTab key={tabId} />)
                        break
                    case 'business-accounts':
                        const BusinessAccountsTab = require('@/components/tabs/business-accounts-tab').default
                        content = guard('email_account', 'read', <BusinessAccountsTab key={tabId} />)
                        break
                    case 'emails':
                        content = <EmailsTab key={tabId} />
                        break
                    case 'mail-pickup':
                        content = <MailPickupTab key={tabId} />
                        break
                    case 'mail-pickup-v2':
                        const MailPickupV2Tab = require('@/components/tabs/mail-pickup-v2-tab').default
                        content = guard('trigger', 'read', <MailPickupV2Tab key={tabId} />)
                        break
                    // 根据需求隐藏订阅管理功能
                    // case 'subscriptions':
                    //     content = <SubscriptionsTab key={tabId} />
                    //     break
                    case 'sync-config':
                        content = guard('sync_config', 'read', <SyncConfigTab key={tabId} />)
                        break
                    case 'proxy-pool':
                        const ProxyPoolTab = require('@/components/tabs/proxy-pool-tab').default
                        content = guard('email_account', 'read', <ProxyPoolTab key={tabId} />)
                        break
                    case 'proxy-gateway-gateways':
                    case 'proxy-gateway-listeners':
                    case 'proxy-gateway-accounts':
                    case 'proxy-gateway-account-groups':
                    case 'proxy-gateway-account-tags':
                    case 'proxy-gateway-routes':
                    case 'proxy-gateway-security':
                    case 'proxy-gateway-dns':
                    case 'proxy-gateway-logs':
                    case 'proxy-gateway-status':
                        const ProxyGatewayTab = require('@/components/tabs/proxy-gateway-tab').default
                        const section = tabId.replace('proxy-gateway-', '') as 'gateways' | 'listeners' | 'accounts' | 'account-groups' | 'account-tags' | 'routes' | 'security' | 'dns' | 'logs' | 'status'
                        content = guard('email_account', 'read', <ProxyGatewayTab key={tabId} section={section} />)
                        break
                    case 'pickup':
                        content = <PickupTab key={tabId} />
                        break
                    case 'triggers':
                    case 'trigger-demo':
                    case 'trigger-create':
                    case 'trigger-templates':
                    case 'trigger-stats':
                    case 'trigger-test':
                        content = guard('trigger', 'read', <TriggersTab key={tabId} tabId={tabId} />)
                        break
                    case 'oauth2-config':
                        content = guard('system_config', 'read', <OAuth2ConfigTab key={tabId} />)
                        break
                    // 根据需求隐藏设置功能
                    // case 'settings':
                    //     content = <SettingsTab key={tabId} />
                    //     break
                    case 'ai-config':
                        content = guard('ai_config', 'read', <AIConfigTab key={tabId} />)
                        break
                    case 'user-sessions':
                        content = <UserSessionsTab key={tabId} />
                        break
                    case 'plugins':
                        content = <PluginsTab key={tabId} />
                        break
                    case 'runtime-status':
                        const RuntimeStatusTab = require('@/components/tabs/runtime-status-tab').default
                        content = guard('system_config', 'read', <RuntimeStatusTab key={tabId} />)
                        break
                    case 'output-logs':
                        const OutputLogsTab = require('@/components/tabs/output-logs-tab').default
                        content = guard('system_config', 'read', <OutputLogsTab key={tabId} />)
                        break
                    case 'output-log-settings':
                        const OutputLogSettingsTab = require('@/components/tabs/output-log-settings-tab').default
                        content = guard('system_config', 'read', <OutputLogSettingsTab key={tabId} />)
                        break
                    case 'business-logs':
                        const BusinessLogsTab = require('@/components/tabs/business-logs-tab').default
                        content = guard('system_config', 'read', <BusinessLogsTab key={tabId} />)
                        break
                    case 'business-log-global-settings':
                        const BusinessLogGlobalSettingsTab = require('@/components/tabs/business-log-global-settings-tab').default
                        content = guard('system_config', 'read', <BusinessLogGlobalSettingsTab key={tabId} />)
                        break
                    case 'business-log-org-settings':
                        const BusinessLogOrgSettingsTab = require('@/components/tabs/business-log-org-settings-tab').default
                        content = guard('system_config', 'read', <BusinessLogOrgSettingsTab key={tabId} />)
                        break
                    case 'system-config':
                        content = guard('system_config', 'read', <SystemConfigTab key={tabId} />)
                        break
                    case 'classic-mailbox':
                        const EnhancedClassicMailboxView = require('@/components/mailbox/enhanced-classic-mailbox-view').default
                        content = guard('email', 'read', <EnhancedClassicMailboxView key={tabId} />)
                        break
                    case 'compose-email':
                        const ComposeEmailTab = require('@/components/tabs/compose-email-tab').default
                        content = guard('email', 'read', <ComposeEmailTab key={tabId} />)
                        break
                    case 'expression-debugger':
                        const ExpressionDebuggerPage = require('@/app/dev/expression-debugger/page').default
                        content = <ExpressionDebuggerPage key={tabId} />
                        break
                    case 'action-debugger':
                        const ActionDebuggerPage = require('@/app/dev/action-debugger/page').default
                        content = <ActionDebuggerPage key={tabId} />
                        break
                    case 'filter-action-trigger':
                        const FilterActionTriggerPage = require('@/app/dev/filter-action-trigger/page').default
                        content = <FilterActionTriggerPage key={tabId} />
                        break
                    case 'filter-templates':
                        const FilterTemplatesTab = require('@/components/tabs/filter-templates-tab').default
                        content = guard('template', 'read', <FilterTemplatesTab key={tabId} />)
                        break
                    case 'action-templates':
                        const ActionTemplatesTab = require('@/components/tabs/action-templates-tab').default
                        content = guard('template', 'read', <ActionTemplatesTab key={tabId} />)
                        break
                    case 'trigger-advanced-debug':
                        const TriggerAdvancedDebugPage = require('@/app/triggers/advanced-debug/page').default
                        content = <TriggerAdvancedDebugPage key={tabId} />
                        break
                    case 'component-test':
                        const ComponentTestPage = require('@/app/dev/component-test/page').default
                        content = <ComponentTestPage key={tabId} />
                        break
                    // 拦截器管理
                    case 'interceptors':
                        const InterceptorListPage = require('@/components/interceptors/interceptor-list-page').InterceptorListPage
                        content = guard('trigger', 'read', <InterceptorListPage key={tabId} />)
                        break
                    // 取件模板V2列表
                    case 'extractor-v2-list':
                        const ExtractorTemplateV2List = require('@/components/extractor-v2/extractor-template-v2-list').default
                        content = guard('template', 'read', <ExtractorTemplateV2List key={tabId} />)
                        break
                    // API 文档
                    case 'api-docs':
                        const ApiDocsTab = require('@/components/tabs/api-docs-tab').default
                        content = <ApiDocsTab key={tabId} />
                        break
                    // 接入手册
                    case 'integration-guide':
                        const IntegrationGuideTab = require('@/components/tabs/html-integration-guide-tab').default
                        content = <IntegrationGuideTab key={tabId} />
                        break
                    case 'team-management':
                        const TeamManagementTab = require('@/components/tabs/team-management-tab').default
                        content = guard('organization', 'read', <TeamManagementTab key={tabId} />)
                        break
                    case 'user-management':
                        const UserManagementTab = require('@/components/tabs/user-management-tab').default
                        content = <UserManagementTab key={tabId} />
                        break
                    default:
                        // 处理动态触发器编辑 Tab: trigger-edit-{id}
                        if (tabId.startsWith('trigger-edit-')) {
                            const triggerId = parseInt(tabId.replace('trigger-edit-', ''))
                            const TriggerEditTab = require('@/components/triggers/trigger-edit-tab').default
                            content = <TriggerEditTab key={tabId} triggerId={triggerId} readOnly={false} />
                        }
                        // 处理动态触发器查看 Tab: trigger-view-{id}
                        else if (tabId.startsWith('trigger-view-')) {
                            const triggerId = parseInt(tabId.replace('trigger-view-', ''))
                            const TriggerViewTab = require('@/components/triggers/trigger-view-tab').default
                            content = <TriggerViewTab key={tabId} triggerId={triggerId} />
                        }
                        // 处理回复/全部回复/转发邮件 Tab
                        else if (tabId.startsWith('compose-reply-all-') || tabId.startsWith('compose-reply-') || tabId.startsWith('compose-forward-')) {
                            const ComposeReplyTab = require('@/components/tabs/compose-reply-tab').default
                            content = <ComposeReplyTab key={tabId} tabId={tabId} />
                        }
                        // 账户备注 Tab
                        else if (tabId.startsWith('account-note-')) {
                            const AccountNoteTab = require('@/components/accounts/account-note-tab').default
                            content = guard('email_account', 'read', <AccountNoteTab key={tabId} tabId={tabId} />)
                        }
                        // 取件模板V2创建 Tab
                        else if (tabId.startsWith('extractor-v2-create-')) {
                            const tempId = tabId.replace('extractor-v2-create-', '')
                            const ExtractorCreationWizard = require('@/components/extractor-v2/extractor-creation-wizard').default
                            content = <ExtractorCreationWizard key={tabId} tempId={tempId} />
                        }
                        // 取件模板V2编辑 Tab
                        else if (tabId.startsWith('extractor-v2-edit-')) {
                            const templateId = parseInt(tabId.replace('extractor-v2-edit-', ''))
                            const ExtractorCreationWizard = require('@/components/extractor-v2/extractor-creation-wizard').default
                            content = <ExtractorCreationWizard key={tabId} templateId={templateId} />
                        }
                        // 取件模板V2查看 Tab
                        else if (tabId.startsWith('extractor-v2-view-')) {
                            const templateId = parseInt(tabId.replace('extractor-v2-view-', ''))
                            const ExtractorTemplateV2ViewTab = require('@/components/extractor-v2/extractor-template-v2-view-tab').default
                            content = <ExtractorTemplateV2ViewTab key={tabId} templateId={templateId} />
                        }
                        // 取件模板V2日志 Tab
                        else if (tabId.startsWith('extractor-v2-logs-')) {
                            const templateId = parseInt(tabId.replace('extractor-v2-logs-', ''))
                            const ExtractorLogsViewer = require('@/components/extractor-v2/extractor-logs-viewer').default
                            content = <ExtractorLogsViewer key={tabId} templateId={templateId} />
                        }
                        // 拦截器日志 Tab (全部)
                        else if (tabId === 'interceptor-logs') {
                            const InterceptorLogsViewer = require('@/components/interceptors/interceptor-logs-viewer').default
                            content = <InterceptorLogsViewer key={tabId} />
                        }
                        // 拦截器日志 Tab (特定拦截器)
                        else if (tabId.startsWith('interceptor-logs-')) {
                            const interceptorId = parseInt(tabId.replace('interceptor-logs-', ''))
                            const InterceptorLogsViewer = require('@/components/interceptors/interceptor-logs-viewer').default
                            content = <InterceptorLogsViewer key={tabId} interceptorId={interceptorId} />
                        }
                        else {
                            content = <DashboardTab key={tabId} />
                        }
                }
                setTabContents(prev => ({ ...prev, [tabId]: content }))
            }
        }

        openTabs.forEach(initializeTab)
    }, [openTabs, tabContents])

    // 处理tab切换 - 使用 useCallback 避免重复创建
    // 修改: 点击侧边栏菜单时应该打开新 tab，而不是替换当前 tab
    const handleTabChange = useCallback((tabId: string) => {
        logger.debug('[MainPage] handleTabChange 被调用，切换到:', tabId);

        // 如果tab不在打开列表中，添加它
        if (!openTabs.includes(tabId)) {
            setOpenTabs(prev => [...prev, tabId])
        }

        // 然后切换到该 tab
        setActiveTab(tabId)
    }, [openTabs])

    // 监听 switchTab 事件
    useEffect(() => {
        const handleSwitchTab = (event: CustomEvent) => {
            logger.debug('[MainPage] 收到 switchTab 事件:', event.detail);
            const { tab, data } = event.detail;
            if (!tab) return;

            // 处理额外的数据
            if (data) {
                logger.debug(`[MainPage] 存储Tab ${tab}的数据:`, data);

                // 移除旧的全局变量，避免冲突 - 仅使用pendingTabData
                if ((window as any).__switchTabData) {
                    logger.debug('[MainPage] 清除旧的全局变量 __switchTabData');
                    delete (window as any).__switchTabData;
                }

                // 使用时间戳标记数据，确保能追踪调用
                const dataWithTimestamp = {
                    ...data,
                    __timestamp: new Date().getTime(),
                    __processed: false
                };

                // 存储到本地状态，以便随时可用
                setPendingTabData(prev => ({
                    ...prev,
                    [tab]: dataWithTimestamp
                }));

                // 检查Tab是否已注册回调
                if ((window as any).__tabCallbacks?.[tab]?.onReady) {
                    try {
                        logger.debug(`[MainPage] 发现Tab ${tab}已注册回调，直接调用`);
                        (window as any).__tabCallbacks[tab].onReady(dataWithTimestamp);

                        // 标记为已处理
                        setPendingTabData(prev => ({
                            ...prev,
                            [tab]: {
                                ...prev[tab],
                                __processed: true
                            }
                        }));
                    } catch (error) {
                        console.error(`[MainPage] 调用Tab ${tab}回调出错:`, error);
                    }
                } else {
                    logger.debug(`[MainPage] Tab ${tab}尚未注册回调，数据将在Tab准备好时传递`);
                }
            }

            // 切换到目标Tab
            handleTabChange(tab);
        }

        window.addEventListener('switchTab', handleSwitchTab as EventListener);
        return () => {
            window.removeEventListener('switchTab', handleSwitchTab as EventListener);
        }
    }, [handleTabChange]);

    useEffect(() => {
        if (isLoading || !isAuthenticated) return
        clearAuthReturnUrl()

        const url = new URL(window.location.href)
        const token = url.searchParams.get('mailShare')
        if (!token || resolvedMailShareRef.current === token) return
        resolvedMailShareRef.current = token

        // Remove the bearer-like token before calling the API so it is not
        // retained in history or copied into same-origin Referer headers.
        url.searchParams.delete('mailShare')
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)

        emailService.resolveShareLink(token)
            .then(target => {
                window.dispatchEvent(new CustomEvent('switchTab', {
                    detail: {
                        tab: 'classic-mailbox',
                        data: {
                            locateEmail: {
                                accountId: target.accountId,
                                emailId: target.emailId,
                                direction: target.direction,
                            },
                        },
                    },
                }))
            })
            .catch((error: any) => {
                toast.error('无法打开邮件分享链接', { description: error?.message || '链接无效、已过期，或当前账号无权访问' })
            })
    }, [isAuthenticated, isLoading])

    // 监听 closeTab 事件 - 用于程序化关闭 Tab
    useEffect(() => {
        const handleCloseTabEvent = (event: CustomEvent) => {
            const { tabId } = event.detail;
            if (!tabId) return;

            logger.debug('[MainPage] 收到 closeTab 事件:', tabId);

            // 关闭指定的 Tab
            const newOpenTabs = openTabs.filter(id => id !== tabId);
            setOpenTabs(newOpenTabs);

            // 清理关闭的 Tab 内容
            setTabContents(prev => {
                const newContents = { ...prev };
                delete newContents[tabId];
                return newContents;
            });

            // 如果关闭的是当前激活的 Tab，切换到最后一个打开的 Tab
            if (activeTab === tabId && newOpenTabs.length > 0) {
                setActiveTab(newOpenTabs[newOpenTabs.length - 1]);
            }
        };

        window.addEventListener('closeTab', handleCloseTabEvent as EventListener);
        return () => {
            window.removeEventListener('closeTab', handleCloseTabEvent as EventListener);
        };
    }, [openTabs, activeTab]);

    // 兜底刷新：未显式注册刷新回调的 Tab，重新挂载当前内容以触发自身初始化加载。
    useEffect(() => {
        const handleRefreshTabEvent = (event: CustomEvent) => {
            const tabId = event.detail?.tabId;
            if (!tabId || hasRefreshCallback(tabId)) return;

            setTabContents(prev => {
                if (!prev[tabId]) return prev;
                const newContents = { ...prev };
                delete newContents[tabId];
                return newContents;
            });
        };

        window.addEventListener('refreshTab', handleRefreshTabEvent as EventListener);
        return () => {
            window.removeEventListener('refreshTab', handleRefreshTabEvent as EventListener);
        };
    }, []);

    // 监听Tab回调注册
    useEffect(() => {
        const handleTabCallbackRegistered = (event: CustomEvent) => {
            const { tabId, callbackName } = event.detail;

            logger.debug(`[MainPage] 收到Tab ${tabId}回调注册事件:`, callbackName);

            // 如果有待处理的数据且数据未被处理过，才调用回调
            if (callbackName === 'onReady' && pendingTabData[tabId]) {
                // 检查数据是否已被处理过
                if (pendingTabData[tabId].__processed) {
                    logger.debug(`[MainPage] Tab ${tabId}的数据已被处理过，跳过重复调用`);
                    return;
                }

                try {
                    logger.debug(`[MainPage] 发现Tab ${tabId}有待处理数据，调用新注册的回调`);
                    (window as any).__tabCallbacks[tabId].onReady(pendingTabData[tabId]);

                    // 标记为已处理
                    setPendingTabData(prev => ({
                        ...prev,
                        [tabId]: {
                            ...prev[tabId],
                            __processed: true
                        }
                    }));

                    // 延迟清理数据
                    setTimeout(() => {
                        setPendingTabData(prev => {
                            if (!prev[tabId]) return prev;

                            const newData = { ...prev };
                            delete newData[tabId];
                            return newData;
                        });
                    }, 5000);
                } catch (error) {
                    console.error(`[MainPage] 调用新注册的Tab ${tabId}回调出错:`, error);
                }
            }
        };

        window.addEventListener('tabCallbackRegistered', handleTabCallbackRegistered as EventListener);
        return () => {
            window.removeEventListener('tabCallbackRegistered', handleTabCallbackRegistered as EventListener);
        };
    }, [pendingTabData]);

    // 如果正在检查认证状态，显示加载器
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    // 如果未登录，不显示内容（会被重定向）
    if (!isAuthenticated) {
        return null
    }

    // 处理tab关闭
    const handleTabClose = (tabId: string) => {
        const newOpenTabs = openTabs.filter(id => id !== tabId)
        setOpenTabs(newOpenTabs)

        // 清理关闭的tab内容
        const newTabContents = { ...tabContents }
        delete newTabContents[tabId]
        setTabContents(newTabContents)

        // 如果关闭的是当前激活的tab，切换到最后一个打开的tab
        if (activeTab === tabId && newOpenTabs.length > 0) {
            setActiveTab(newOpenTabs[newOpenTabs.length - 1])
        }
    }

    // 处理tab打开
    const handleTabOpen = (tabId: string) => {
        if (!openTabs.includes(tabId)) {
            setOpenTabs([...openTabs, tabId])
        }
        setActiveTab(tabId)
    }

    return (
        <div className="flex h-screen bg-background">
            {/* 侧边栏 */}
            <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />

            {/* 主内容区 */}
            <div className="flex flex-1 flex-col overflow-hidden">
                {/* 顶部导航栏 */}
                <Header />

                {/* Tab管理器 */}
                <TabManager
                    activeTab={activeTab}
                    openTabs={openTabs}
                    onTabChange={handleTabChange}
                    onTabClose={handleTabClose}
                    onTabOpen={handleTabOpen}
                />

                {/* Tab内容 */}
                <main className="flex-1 overflow-hidden bg-background">
                    <div className="relative h-full">
                        {openTabs.map((tabId) => {
                            // 定义需要全屏显示的 Tab（无 padding 和 container 限制）
                            // 包括需要固定header/footer布局的编辑和创建页面
                            const fullscreenTabs = ['classic-mailbox', 'trigger-create', 'compose-email', 'extractor-v2-list', 'mail-pickup-v2', 'integration-guide', 'proxy-pool', 'proxy-gateway-gateways', 'proxy-gateway-listeners', 'proxy-gateway-accounts', 'proxy-gateway-account-groups', 'proxy-gateway-account-tags', 'proxy-gateway-routes', 'proxy-gateway-security', 'proxy-gateway-dns', 'proxy-gateway-logs', 'business-modules', 'business-accounts', 'output-logs', 'output-log-settings', 'business-logs', 'business-log-global-settings', 'business-log-org-settings']
                            const isFullscreen = fullscreenTabs.includes(tabId) ||
                                tabId.startsWith('account-note-') ||
                                tabId.startsWith('trigger-edit-') ||
                                tabId.startsWith('trigger-view-') ||
                                tabId.startsWith('compose-reply-') ||
                                tabId.startsWith('compose-forward-') ||
                                tabId.startsWith('extractor-v2-') ||
                                tabId.startsWith('interceptor-logs')

                            return (
                                <div
                                    key={tabId}
                                    className={cn(
                                        'absolute inset-0 transition-all duration-300',
                                        isFullscreen ? 'overflow-hidden' : 'overflow-y-auto',
                                        activeTab === tabId
                                            ? 'opacity-100 z-10'
                                            : 'opacity-0 translate-x-4 pointer-events-none z-0'
                                    )}
                                >
                                    {isFullscreen ? (
                                        // 全屏 Tab 直接渲染内容，无 container 和 padding
                                        <div className="h-full">
                                            {tabContents[tabId]}
                                        </div>
                                    ) : (
                                        // 普通 Tab 使用容器和内边距
                                        <div className="container mx-auto px-6 py-8">
                                            {tabContents[tabId]}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </main>
            </div>
        </div>
    )
}
