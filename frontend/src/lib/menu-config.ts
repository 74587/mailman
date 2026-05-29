/**
 * 菜单可见性配置管理
 * 使用 localStorage 存储，支持事件通知
 */

const STORAGE_KEY = 'mailman_menu_visibility'
const EVENT_NAME = 'menuVisibilityChanged'

// 所有可配置的菜单项定义
export interface MenuItemConfig {
    id: string
    name: string
    group: 'main' | 'admin' | 'trigger' | 'plugin' | 'developer'
    defaultVisible: boolean
    locked?: boolean  // 锁定的菜单项不允许隐藏
}

// 完整的菜单项注册表
export const menuRegistry: MenuItemConfig[] = [
    // 主导航
    { id: 'dashboard', name: '仪表板', group: 'main', defaultVisible: true, locked: true },
    { id: 'accounts', name: '邮箱账户管理', group: 'main', defaultVisible: true },
    { id: 'compose-email', name: '发送邮件', group: 'main', defaultVisible: true },
    { id: 'classic-mailbox', name: '经典邮件管理器', group: 'main', defaultVisible: true },
    { id: 'sync-config', name: '同步配置', group: 'main', defaultVisible: true },
    { id: 'proxy-pool', name: '代理池管理', group: 'main', defaultVisible: true },
    { id: 'mail-pickup-v2', name: '取件', group: 'main', defaultVisible: true },
    { id: 'extractor-v2-list', name: '取件模板', group: 'main', defaultVisible: true },
    { id: 'api-docs', name: 'API 文档', group: 'main', defaultVisible: true },

    // 系统管理
    { id: 'team-management', name: '团队管理', group: 'admin', defaultVisible: true },
    { id: 'user-management', name: '用户管理', group: 'admin', defaultVisible: true },
    { id: 'oauth2-config', name: 'OAuth2 配置', group: 'admin', defaultVisible: true },
    { id: 'ai-config', name: 'AI 配置', group: 'admin', defaultVisible: true },
    { id: 'user-sessions', name: '访问令牌', group: 'admin', defaultVisible: true },
    { id: 'system-config', name: '系统配置', group: 'admin', defaultVisible: true, locked: true },

    // 高级模组
    { id: 'triggers', name: '触发器管理', group: 'trigger', defaultVisible: true },
    { id: 'interceptors', name: '拦截器管理', group: 'trigger', defaultVisible: true },
    { id: 'filter-templates', name: '过滤器模板', group: 'trigger', defaultVisible: true },
    { id: 'action-templates', name: '动作模板', group: 'trigger', defaultVisible: true },

    // 插件
    { id: 'plugins', name: '插件列表', group: 'plugin', defaultVisible: true },

    // 开发者
    { id: 'expression-debugger', name: '表达式调试器', group: 'developer', defaultVisible: true },
    { id: 'action-debugger', name: '动作调试器', group: 'developer', defaultVisible: true },
    { id: 'filter-action-trigger', name: '过滤动作触发器', group: 'developer', defaultVisible: true },
    { id: 'component-test', name: '组件测试', group: 'developer', defaultVisible: true },
    { id: 'integration-guide', name: '接入手册', group: 'developer', defaultVisible: true },
]

// 分组显示名
export const groupNames: Record<string, string> = {
    main: '主导航',
    admin: '系统管理',
    trigger: '高级模组',
    plugin: '插件管理',
    developer: '开发者模式',
}

export type MenuVisibilityMap = Record<string, boolean>

/**
 * 获取菜单可见性配置
 */
export function getMenuVisibility(): MenuVisibilityMap {
    if (typeof window === 'undefined') return {}
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) return JSON.parse(stored)
    } catch {
        // ignore
    }
    return {}
}

/**
 * 判断某个菜单项是否可见
 */
export function isMenuVisible(menuId: string): boolean {
    const config = menuRegistry.find(m => m.id === menuId)
    if (!config) return true // 未注册的菜单默认显示
    if (config.locked) return true // 锁定的菜单始终显示

    const visibility = getMenuVisibility()
    return visibility[menuId] !== undefined ? visibility[menuId] : config.defaultVisible
}

/**
 * 设置菜单可见性
 */
export function setMenuVisibility(menuId: string, visible: boolean): void {
    const config = menuRegistry.find(m => m.id === menuId)
    if (config?.locked) return // 锁定的不允许修改

    const visibility = getMenuVisibility()
    visibility[menuId] = visible
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility))

    // 通知侧边栏刷新
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { menuId, visible } }))
}

/**
 * 批量设置菜单可见性
 */
export function setMenuVisibilityBatch(updates: MenuVisibilityMap): void {
    const visibility = getMenuVisibility()
    for (const [menuId, visible] of Object.entries(updates)) {
        const config = menuRegistry.find(m => m.id === menuId)
        if (config?.locked) continue
        visibility[menuId] = visible
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility))
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

/**
 * 重置为默认值
 */
export function resetMenuVisibility(): void {
    localStorage.removeItem(STORAGE_KEY)
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

/**
 * 订阅菜单可见性变化
 */
export function subscribeMenuVisibility(callback: () => void): () => void {
    const handler = () => callback()
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
}
