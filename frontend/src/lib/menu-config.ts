/**
 * 菜单可见性配置管理
 * 使用服务端用户偏好 + localStorage 缓存，支持事件通知
 */

import { apiClient } from '@/lib/api-client'

const STORAGE_KEY = 'mailman_menu_visibility'
const ORDER_STORAGE_KEY = 'mailman_menu_order'
const EVENT_NAME = 'menuVisibilityChanged'

// 所有可配置的菜单项定义
export interface MenuItemConfig {
    id: string
    name: string
    group: 'main' | 'mail' | 'proxy' | 'business' | 'admin' | 'trigger' | 'plugin' | 'developer'
    defaultVisible: boolean
    locked?: boolean  // 锁定的菜单项不允许隐藏
}

// 完整的菜单项注册表
export const menuRegistry: MenuItemConfig[] = [
    // 工作台
    { id: 'dashboard', name: '仪表板', group: 'main', defaultVisible: true, locked: true },

    // 邮箱运营
    { id: 'accounts', name: '邮箱账户管理', group: 'mail', defaultVisible: true },
    { id: 'classic-mailbox', name: '经典邮件管理器', group: 'mail', defaultVisible: true },
    { id: 'compose-email', name: '发送邮件', group: 'mail', defaultVisible: true },
    { id: 'mail-pickup-v2', name: '取件', group: 'mail', defaultVisible: true },
    { id: 'extractor-v2-list', name: '取件模板', group: 'mail', defaultVisible: true },
    { id: 'sync-config', name: '同步配置', group: 'mail', defaultVisible: true },
    { id: 'oauth2-config', name: 'OAuth2 配置', group: 'mail', defaultVisible: true },

    // 代理池管理
    { id: 'proxy-pool', name: '代理列表', group: 'proxy', defaultVisible: true },
    { id: 'proxy-gateway-gateways', name: '代理网关', group: 'proxy', defaultVisible: true },
    { id: 'proxy-gateway-accounts', name: '网关用户', group: 'proxy', defaultVisible: true },
    { id: 'proxy-gateway-account-groups', name: '账号分组', group: 'proxy', defaultVisible: true },
    { id: 'proxy-gateway-account-tags', name: '账号标签', group: 'proxy', defaultVisible: true },
    { id: 'proxy-gateway-logs', name: '网关日志', group: 'proxy', defaultVisible: true },

    // 业务资料
    { id: 'business-accounts', name: '业务账户', group: 'business', defaultVisible: true },
    { id: 'business-modules', name: '业务模块', group: 'business', defaultVisible: true },

    // 系统管理
    { id: 'system-config', name: '系统配置', group: 'admin', defaultVisible: true, locked: true },
    { id: 'team-management', name: '团队管理', group: 'admin', defaultVisible: true },
    { id: 'user-management', name: '用户管理', group: 'admin', defaultVisible: true },
    { id: 'ai-config', name: 'AI 配置', group: 'admin', defaultVisible: true },
    { id: 'user-sessions', name: '访问令牌', group: 'admin', defaultVisible: true },

    // 高级模组
    { id: 'triggers', name: '触发器管理', group: 'trigger', defaultVisible: true },
    { id: 'interceptors', name: '拦截器管理', group: 'trigger', defaultVisible: true },
    { id: 'filter-templates', name: '过滤器模板', group: 'trigger', defaultVisible: true },
    { id: 'action-templates', name: '动作模板', group: 'trigger', defaultVisible: true },

    // 插件
    { id: 'plugins', name: '插件列表', group: 'plugin', defaultVisible: true },

    // 开发者
    { id: 'api-docs', name: 'API 文档', group: 'developer', defaultVisible: true },
    { id: 'integration-guide', name: '接入手册', group: 'developer', defaultVisible: true },
    { id: 'expression-debugger', name: '表达式调试器', group: 'developer', defaultVisible: true },
    { id: 'action-debugger', name: '动作调试器', group: 'developer', defaultVisible: true },
    { id: 'filter-action-trigger', name: '过滤动作触发器', group: 'developer', defaultVisible: true },
    { id: 'component-test', name: '组件测试', group: 'developer', defaultVisible: true },
]

// 分组显示名
export const groupNames: Record<string, string> = {
    main: '工作台',
    mail: '邮箱运营',
    proxy: '代理池管理',
    business: '业务资料',
    trigger: '自动化',
    admin: '系统与权限',
    plugin: '扩展插件',
    developer: '文档与开发',
}

export type MenuVisibilityMap = Record<string, boolean>

export interface MenuPreferencePayload {
    visibility: MenuVisibilityMap
    order: string[]
}

const LEGACY_DEFAULT_MENU_ORDER = [
    'dashboard',
    'accounts',
    'compose-email',
    'classic-mailbox',
    'sync-config',
    'oauth2-config',
    'proxy-pool',
    'proxy-gateway-gateways',
    'proxy-gateway-accounts',
    'proxy-gateway-account-groups',
    'proxy-gateway-account-tags',
    'proxy-gateway-logs',
    'mail-pickup-v2',
    'extractor-v2-list',
    'api-docs',
    'business-modules',
    'business-accounts',
    'team-management',
    'user-management',
    'ai-config',
    'user-sessions',
    'system-config',
    'triggers',
    'interceptors',
    'filter-templates',
    'action-templates',
    'plugins',
    'expression-debugger',
    'action-debugger',
    'filter-action-trigger',
    'component-test',
    'integration-guide',
]

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

export function getMenuOrder(): string[] {
    if (typeof window === 'undefined') return []
    try {
        const stored = localStorage.getItem(ORDER_STORAGE_KEY)
        if (stored) {
            const order = JSON.parse(stored)
            if (Array.isArray(order)) return resolveMenuOrder(order)
        }
    } catch {
        // ignore
    }
    return menuRegistry.map(item => item.id)
}

export function setMenuOrder(order: string[]): void {
    if (typeof window === 'undefined') return
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(normalizeMenuOrder(order)))
    window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function getOrderedMenuRegistry(): MenuItemConfig[] {
    return applyMenuOrderToItems(menuRegistry)
}

export function applyMenuOrderToItems<T extends { id: string }>(items: T[]): T[] {
    const order = getMenuOrder()
    if (!order.length) return items
    const indexMap = new Map(order.map((id, index) => [id, index]))
    return [...items].sort((a, b) => {
        const aIndex = indexMap.get(a.id)
        const bIndex = indexMap.get(b.id)
        if (aIndex === undefined && bIndex === undefined) return 0
        if (aIndex === undefined) return 1
        if (bIndex === undefined) return -1
        return aIndex - bIndex
    })
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
    localStorage.removeItem(ORDER_STORAGE_KEY)
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

export async function loadMenuPreferencesFromServer(): Promise<MenuPreferencePayload> {
    const preference = await apiClient.get<MenuPreferencePayload>('/menu-preferences/me')
    const order = resolveMenuOrder(preference.order || [])
    if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(preference.visibility || {}))
        localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order))
        window.dispatchEvent(new CustomEvent(EVENT_NAME))
    }
    return {
        visibility: preference.visibility || {},
        order,
    }
}

export async function saveMenuPreferencesToServer(): Promise<MenuPreferencePayload> {
    const payload = {
        visibility: getMenuVisibility(),
        order: getMenuOrder(),
    }
    const preference = await apiClient.put<MenuPreferencePayload>('/menu-preferences/me', payload)
    return {
        visibility: preference.visibility || payload.visibility,
        order: normalizeMenuOrder(preference.order || payload.order),
    }
}

function normalizeMenuOrder(order: string[]): string[] {
    const registered = new Set(menuRegistry.map(item => item.id))
    const seen = new Set<string>()
    const normalized = order.filter(id => {
        if (!registered.has(id) || seen.has(id)) return false
        seen.add(id)
        return true
    })
    menuRegistry.forEach(item => {
        if (!seen.has(item.id)) normalized.push(item.id)
    })
    return normalized
}

function resolveMenuOrder(order: string[]): string[] {
    if (isLegacyDefaultOrder(order)) return menuRegistry.map(item => item.id)
    return normalizeMenuOrder(order)
}

function isLegacyDefaultOrder(order: string[]): boolean {
    if (order.length !== LEGACY_DEFAULT_MENU_ORDER.length) return false
    return LEGACY_DEFAULT_MENU_ORDER.every((id, index) => order[index] === id)
}
