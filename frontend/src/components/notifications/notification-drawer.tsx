'use client'

import React, { useState, useEffect } from 'react'
import { X, Mail, Check, CheckCheck, Trash2, Bell, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
    subscribeToNotifications,
    StoredNotification
} from '@/lib/notification-store'

interface NotificationDrawerProps {
    isOpen: boolean
    onClose: () => void
}

export function NotificationDrawer({ isOpen, onClose }: NotificationDrawerProps) {
    const { confirm } = useConfirmDialog()
    const [notifications, setNotifications] = useState<StoredNotification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)

    // 加载通知
    const loadNotifications = () => {
        setNotifications(getNotifications())
        setUnreadCount(getUnreadCount())
    }

    useEffect(() => {
        loadNotifications()

        // 订阅通知变化
        const unsubscribe = subscribeToNotifications(loadNotifications)
        return unsubscribe
    }, [])

    // 重新加载当抽屉打开时
    useEffect(() => {
        if (isOpen) {
            loadNotifications()
        }
    }, [isOpen])

    const handleMarkAsRead = (id: string) => {
        markAsRead(id)
    }

    const handleMarkAllAsRead = () => {
        markAllAsRead()
    }

    const handleRemove = (id: string) => {
        removeNotification(id)
    }

    const handleClearAll = async () => {
        const confirmed = await confirm({
            title: '清除所有通知',
            description: '确定要清除所有通知吗？',
            confirmText: '清除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (confirmed) {
            clearAll()
        }
    }

    // 查看邮件 - 导航到经典邮件管理器
    const handleViewEmail = (notification: StoredNotification) => {
        if (!notification.email_id) return

        // 关闭抽屉
        onClose()

        // 使用 switchTab 事件导航到经典邮件管理器
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: 'classic-mailbox',
                data: {
                    locateEmail: {
                        accountId: notification.account_id,
                        emailId: notification.email_id
                    }
                }
            }
        }))

        // 标记为已读
        markAsRead(notification.id)
    }

    const formatTime = (timestamp: string) => {
        try {
            const date = new Date(timestamp)
            const now = new Date()
            const diff = now.getTime() - date.getTime()

            if (diff < 60000) return '刚刚'
            if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
            if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`

            return date.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
        } catch {
            return timestamp
        }
    }

    const unreadNotifications = notifications.filter(n => !n.read)
    const readNotifications = notifications.filter(n => n.read)

    return (
        <>
            {/* 遮罩层 */}
            <div
                className={cn(
                    "fixed inset-0 z-40 bg-black/30 transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
            />

            {/* 抽屉 */}
            <div
                className={cn(
                    "fixed right-0 top-0 h-full z-50 bg-white dark:bg-gray-800 shadow-2xl",
                    "w-full sm:w-96 transform transition-transform duration-300 ease-out",
                    isOpen ? "translate-x-0" : "translate-x-full"
                )}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                        <Bell className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                            通知
                        </h2>
                        {unreadCount > 0 && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded-full">
                                {unreadCount} 未读
                            </span>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* 操作栏 */}
                {notifications.length > 0 && (
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                        <button
                            onClick={handleMarkAllAsRead}
                            disabled={unreadCount === 0}
                            className={cn(
                                "flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors",
                                unreadCount > 0
                                    ? "text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                                    : "text-gray-400 cursor-not-allowed"
                            )}
                        >
                            <CheckCheck className="h-4 w-4" />
                            全部已读
                        </button>
                        <button
                            onClick={handleClearAll}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                            <Trash2 className="h-4 w-4" />
                            清除全部
                        </button>
                    </div>
                )}

                {/* 通知列表 */}
                <div className="flex-1 overflow-y-auto" style={{ height: 'calc(100vh - 120px)' }}>
                    {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400">
                            <Bell className="h-12 w-12 mb-3 opacity-30" />
                            <p>暂无通知</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-100 dark:divide-gray-700">
                            {/* 未读通知 */}
                            {unreadNotifications.length > 0 && (
                                <div>
                                    <div className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-800/50">
                                        未读
                                    </div>
                                    {unreadNotifications.map((notification) => (
                                        <NotificationItem
                                            key={notification.id}
                                            notification={notification}
                                            onMarkAsRead={() => handleMarkAsRead(notification.id)}
                                            onRemove={() => handleRemove(notification.id)}
                                            onViewEmail={() => handleViewEmail(notification)}
                                            formatTime={formatTime}
                                        />
                                    ))}
                                </div>
                            )}

                            {/* 已读通知 */}
                            {readNotifications.length > 0 && (
                                <div>
                                    <div className="px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-800/50">
                                        已读
                                    </div>
                                    {readNotifications.map((notification) => (
                                        <NotificationItem
                                            key={notification.id}
                                            notification={notification}
                                            onMarkAsRead={() => handleMarkAsRead(notification.id)}
                                            onRemove={() => handleRemove(notification.id)}
                                            onViewEmail={() => handleViewEmail(notification)}
                                            formatTime={formatTime}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

// 单条通知组件
interface NotificationItemProps {
    notification: StoredNotification
    onMarkAsRead: () => void
    onRemove: () => void
    onViewEmail: () => void
    formatTime: (timestamp: string) => string
}

function NotificationItem({ notification, onMarkAsRead, onRemove, onViewEmail, formatTime }: NotificationItemProps) {
    return (
        <div
            className={cn(
                "px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors",
                !notification.read && "bg-blue-50/50 dark:bg-blue-900/10"
            )}
        >
            <div className="flex items-start gap-3">
                {/* 邮件图标 */}
                <div className={cn(
                    "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
                    notification.read
                        ? "bg-gray-100 dark:bg-gray-700"
                        : "bg-blue-100 dark:bg-blue-900/30"
                )}>
                    <Mail className={cn(
                        "h-5 w-5",
                        notification.read
                            ? "text-gray-500 dark:text-gray-400"
                            : "text-blue-600 dark:text-blue-400"
                    )} />
                </div>

                {/* 内容 */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                        <span className={cn(
                            "text-sm font-medium truncate",
                            notification.read
                                ? "text-gray-600 dark:text-gray-400"
                                : "text-gray-900 dark:text-white"
                        )}>
                            {notification.account_email}
                        </span>
                        <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                            {formatTime(notification.timestamp)}
                        </span>
                    </div>

                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                        {notification.from ? (
                            <>来自 <span className="font-medium">{notification.from}</span></>
                        ) : (
                            <>收到 {notification.email_count} 封新邮件</>
                        )}
                    </p>

                    {notification.subject && (
                        <p className="text-sm text-gray-500 dark:text-gray-500 truncate">
                            📧 {notification.subject}
                        </p>
                    )}

                    {/* 查看邮件按钮 */}
                    {notification.email_id && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                onViewEmail()
                            }}
                            className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                        >
                            <ExternalLink className="h-3 w-3" />
                            查看邮件
                        </button>
                    )}
                </div>

                {/* 操作按钮 */}
                <div className="flex-shrink-0 flex items-center gap-1">
                    {!notification.read && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                onMarkAsRead()
                            }}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900/30 transition-colors"
                            title="标记为已读"
                        >
                            <Check className="h-4 w-4" />
                        </button>
                    )}
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemove()
                        }}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="删除"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    )
}

export default NotificationDrawer
