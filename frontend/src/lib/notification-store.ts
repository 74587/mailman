import { logger } from '@/lib/logger';
/**
 * 通知存储管理
 * 使用 localStorage 持久化通知和已读状态
 */

const STORAGE_KEY = 'mailman-notifications'
const MAX_NOTIFICATIONS = 50

// 通知类型定义
export interface StoredNotification {
    id: string              // 唯一标识 (使用 timestamp + account_id + subject hash)
    type: string
    account_id: number
    account_email: string
    email_id?: number       // 邮件ID (用于导航到具体邮件)
    email_count: number
    subject?: string
    from?: string
    timestamp: string
    read: boolean           // 是否已读
    createdAt: number       // 创建时间戳（用于排序）
}

interface NotificationStore {
    notifications: StoredNotification[]
    mutedUntil?: number | null
}

function createEmptyStore(): NotificationStore {
    return { notifications: [], mutedUntil: null }
}

// 生成通知 ID
function generateNotificationId(notification: Omit<StoredNotification, 'id' | 'read' | 'createdAt'>): string {
    // 使用 timestamp + account_id 作为唯一标识
    return `${notification.timestamp}_${notification.account_id}_${notification.subject || ''}`
}

// 获取存储数据
function getStore(): NotificationStore {
    if (typeof window === 'undefined') {
        return createEmptyStore()
    }

    try {
        const data = localStorage.getItem(STORAGE_KEY)
        if (data) {
            const parsed = JSON.parse(data)
            return {
                notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
                mutedUntil: typeof parsed.mutedUntil === 'number' ? parsed.mutedUntil : null,
            }
        }
    } catch (error) {
        console.error('[NotificationStore] Failed to parse storage:', error)
    }

    return createEmptyStore()
}

// 保存存储数据
function saveStore(store: NotificationStore): void {
    if (typeof window === 'undefined') return

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    } catch (error) {
        console.error('[NotificationStore] Failed to save storage:', error)
    }
}

// 获取所有通知
export function getNotifications(): StoredNotification[] {
    const store = getStore()
    return store.notifications.sort((a, b) => b.createdAt - a.createdAt)
}

// 获取未读通知
export function getUnreadNotifications(): StoredNotification[] {
    return getNotifications().filter(n => !n.read)
}

// 获取未读数量
export function getUnreadCount(): number {
    return getUnreadNotifications().length
}

export function getNotificationMuteUntil(): number | null {
    const mutedUntil = getStore().mutedUntil
    if (!mutedUntil || mutedUntil <= Date.now()) {
        return null
    }
    return mutedUntil
}

export function isNotificationMuted(): boolean {
    return getNotificationMuteUntil() !== null
}

export function muteNotifications(minutes: number): number {
    const normalizedMinutes = Math.min(1440, Math.max(1, Math.round(minutes)))
    const store = getStore()
    const mutedUntil = Date.now() + normalizedMinutes * 60 * 1000
    store.mutedUntil = mutedUntil
    saveStore(store)

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('notification-updated'))
    }

    return mutedUntil
}

export function unmuteNotifications(): void {
    const store = getStore()
    store.mutedUntil = null
    saveStore(store)

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('notification-updated'))
    }
}

// 检查通知是否已处理过（去重）
export function isProcessed(timestamp: string, accountId: number, subject?: string): boolean {
    const store = getStore()
    const id = generateNotificationId({
        type: 'new_email',
        account_id: accountId,
        account_email: '',
        email_count: 1,
        subject,
        timestamp
    })

    return store.notifications.some(n => n.id === id)
}

// 添加通知（自动去重）
export function addNotification(notification: Omit<StoredNotification, 'id' | 'read' | 'createdAt'>): StoredNotification | null {
    const store = getStore()
    const id = generateNotificationId(notification)

    // 检查是否已存在
    if (store.notifications.some(n => n.id === id)) {
        logger.debug('[NotificationStore] Notification already exists, skipping:', id)
        return null
    }

    const newNotification: StoredNotification = {
        ...notification,
        id,
        read: false,
        createdAt: Date.now()
    }

    // 添加到开头
    store.notifications.unshift(newNotification)

    // 限制数量
    if (store.notifications.length > MAX_NOTIFICATIONS) {
        store.notifications = store.notifications.slice(0, MAX_NOTIFICATIONS)
    }

    saveStore(store)

    // 触发自定义事件，用于通知其他组件
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('notification-updated'))
    }

    return newNotification
}

// 标记单条为已读
export function markAsRead(id: string): void {
    const store = getStore()
    const notification = store.notifications.find(n => n.id === id)

    if (notification) {
        notification.read = true
        saveStore(store)

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('notification-updated'))
        }
    }
}

// 标记全部为已读
export function markAllAsRead(): void {
    const store = getStore()

    store.notifications.forEach(n => {
        n.read = true
    })

    saveStore(store)

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('notification-updated'))
    }
}

// 删除单条通知
export function removeNotification(id: string): void {
    const store = getStore()
    store.notifications = store.notifications.filter(n => n.id !== id)
    saveStore(store)

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('notification-updated'))
    }
}

// 清除所有通知
export function clearAll(): void {
    const store = getStore()
    store.notifications = []
    saveStore(store)

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('notification-updated'))
    }
}

// 订阅通知变化
export function subscribeToNotifications(callback: () => void): () => void {
    if (typeof window === 'undefined') {
        return () => { }
    }

    const handler = () => callback()
    window.addEventListener('notification-updated', handler)

    return () => {
        window.removeEventListener('notification-updated', handler)
    }
}
