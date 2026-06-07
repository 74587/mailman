'use client'

import React, { useState, useEffect, useRef } from 'react'
import { X, Mail, Check, CheckCheck, Trash2, Bell, BellOff, ChevronDown, ExternalLink, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
    getNotifications,
    getUnreadCount,
    getNotificationMuteUntil,
    markAsRead,
    markAllAsRead,
    muteNotifications,
    removeNotification,
    clearAll,
    subscribeToNotifications,
    StoredNotification,
    unmuteNotifications
} from '@/lib/notification-store'
import EmailQuickPreview from '@/components/notifications/email-quick-preview'
import { emailService } from '@/services/email.service'
import { Email } from '@/types'
import { toast } from 'sonner'

interface NotificationDrawerProps {
    isOpen: boolean
    onClose: () => void
}

export function NotificationDrawer({ isOpen, onClose }: NotificationDrawerProps) {
    const { confirm } = useConfirmDialog()
    const [notifications, setNotifications] = useState<StoredNotification[]>([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [muteUntil, setMuteUntil] = useState<number | null>(null)
    const [muteMinutes, setMuteMinutes] = useState('30')
    const [showMuteMenu, setShowMuteMenu] = useState(false)
    const [previewNotification, setPreviewNotification] = useState<StoredNotification | null>(null)
    const [previewEmail, setPreviewEmail] = useState<Email | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [, setMuteTick] = useState(0)
    const previewRequestRef = useRef(0)
    const muteMenuRef = useRef<HTMLDivElement>(null)

    // 加载通知
    const loadNotifications = () => {
        setNotifications(getNotifications())
        setUnreadCount(getUnreadCount())
        setMuteUntil(getNotificationMuteUntil())
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

    useEffect(() => {
        if (!muteUntil) return

        const interval = setInterval(() => {
            setMuteUntil(getNotificationMuteUntil())
            setMuteTick(tick => tick + 1)
        }, 1000)

        return () => clearInterval(interval)
    }, [muteUntil])

    useEffect(() => {
        if (!showMuteMenu) return

        const handlePointerDown = (event: MouseEvent) => {
            if (!muteMenuRef.current?.contains(event.target as Node)) {
                setShowMuteMenu(false)
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        return () => document.removeEventListener('mousedown', handlePointerDown)
    }, [showMuteMenu])

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

    const handleMuteNotifications = (minutes: string | number = muteMinutes) => {
        const parsedMinutes = typeof minutes === 'number' ? minutes : Number(minutes)
        const normalizedMinutes = Math.min(1440, Math.max(1, Math.round(Number.isFinite(parsedMinutes) ? parsedMinutes : 30)))
        const until = muteNotifications(normalizedMinutes)
        setMuteMinutes(String(normalizedMinutes))
        setShowMuteMenu(false)
        setMuteUntil(until)
        toast.success(`已暂停弹窗通知 ${normalizedMinutes} 分钟`)
    }

    const handleUnmuteNotifications = () => {
        unmuteNotifications()
        setMuteUntil(null)
        toast.success('通知弹窗已恢复')
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

    const handlePreviewEmail = async (notification: StoredNotification) => {
        if (!notification.email_id) return

        markAsRead(notification.id)
        setPreviewNotification(notification)
        setPreviewEmail(null)
        setPreviewError(null)
        setPreviewLoading(true)
        const requestId = previewRequestRef.current + 1
        previewRequestRef.current = requestId

        try {
            const email = await emailService.getEmail(notification.email_id)
            if (previewRequestRef.current !== requestId) return
            setPreviewEmail(email)
        } catch (error) {
            if (previewRequestRef.current !== requestId) return
            console.error('[NotificationDrawer] Failed to load email preview:', error)
            setPreviewError('无法加载邮件详情，可以打开完整邮件页面查看。')
        } finally {
            if (previewRequestRef.current === requestId) {
                setPreviewLoading(false)
            }
        }
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

    const formatMuteRemaining = (value: number) => {
        const remainingMs = Math.max(0, value - Date.now())
        const totalMinutes = Math.ceil(remainingMs / 60000)
        if (totalMinutes >= 60) {
            const hours = Math.floor(totalMinutes / 60)
            const minutes = totalMinutes % 60
            return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`
        }
        return `${Math.max(1, totalMinutes)} 分钟`
    }

    const unreadNotifications = notifications.filter(n => !n.read)
    const readNotifications = notifications.filter(n => n.read)
    const muted = Boolean(muteUntil && muteUntil > Date.now())

    const notificationList = (
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
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
                            onPreviewEmail={() => handlePreviewEmail(notification)}
                            formatTime={formatTime}
                        />
                    ))}
                </div>
            )}

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
                            onPreviewEmail={() => handlePreviewEmail(notification)}
                            formatTime={formatTime}
                        />
                    ))}
                </div>
            )}
        </div>
    )

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
                    "fixed right-0 top-0 h-full z-50 flex flex-col bg-white dark:bg-gray-800 shadow-2xl",
                    previewNotification ? "w-full sm:w-[min(980px,calc(100vw-2rem))]" : "w-full sm:w-96",
                    "transform transition-transform duration-300 ease-out",
                    isOpen ? "translate-x-0" : "translate-x-full"
                )}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <Bell className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                            通知
                        </h2>
                        {unreadCount > 0 && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded-full">
                                {unreadCount} 未读
                            </span>
                        )}
                        <div className="flex items-center gap-2">
                            {muted && muteUntil ? (
                                <div className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300">
                                    <BellOff className="h-3.5 w-3.5 text-amber-500" />
                                    <span className="max-w-[132px] truncate text-xs font-medium">
                                        暂停 {formatMuteRemaining(muteUntil)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleUnmuteNotifications}
                                        className="rounded-full bg-amber-600 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
                                    >
                                        恢复
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div ref={muteMenuRef} className="relative">
                                        <div className="flex h-8 items-center overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-colors focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-900">
                                            <label className="flex h-full items-center gap-1 px-2.5">
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    value={muteMinutes}
                                                    onChange={(event) => {
                                                        const nextValue = event.target.value.replace(/[^\d]/g, '').slice(0, 4)
                                                        setMuteMinutes(nextValue)
                                                    }}
                                                    onBlur={() => {
                                                        const parsedMinutes = Number(muteMinutes)
                                                        if (!muteMinutes || !Number.isFinite(parsedMinutes) || parsedMinutes < 1) {
                                                            setMuteMinutes('30')
                                                        } else {
                                                            setMuteMinutes(String(Math.min(1440, Math.round(parsedMinutes))))
                                                        }
                                                    }}
                                                    aria-label="暂停弹窗通知分钟数"
                                                    className="h-full w-14 appearance-none border-0 bg-transparent text-center text-xs font-semibold tabular-nums text-gray-900 outline-none ring-0 transition-colors focus:bg-blue-50/60 focus:ring-0 dark:text-gray-100 dark:focus:bg-blue-950/30"
                                                />
                                                <span className="text-xs text-gray-400">分钟</span>
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => setShowMuteMenu(open => !open)}
                                                className="flex h-full w-7 items-center justify-center border-l border-gray-100 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                                                title="选择暂停时长"
                                            >
                                                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showMuteMenu && "rotate-180")} />
                                            </button>
                                        </div>
                                        {showMuteMenu && (
                                            <div className="absolute right-0 top-[calc(100%+6px)] z-[70] w-28 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                                                {[15, 30, 60].map(minutes => (
                                                    <button
                                                        key={minutes}
                                                        type="button"
                                                        onClick={() => {
                                                            setMuteMinutes(String(minutes))
                                                            setShowMuteMenu(false)
                                                        }}
                                                        className={cn(
                                                            "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800",
                                                            muteMinutes === String(minutes) && "font-medium text-blue-600 dark:text-blue-300"
                                                        )}
                                                    >
                                                        <span>{minutes} 分钟</span>
                                                        {muteMinutes === String(minutes) && <Check className="h-3.5 w-3.5" />}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleMuteNotifications(muteMinutes)}
                                        className="h-8 rounded-lg bg-gray-900 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
                                    >
                                        暂停
                                    </button>
                                </>
                            )}
                        </div>
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
                <div className="min-h-0 flex-1 overflow-hidden">
                    {notifications.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center text-gray-500 dark:text-gray-400">
                            <Bell className="h-12 w-12 mb-3 opacity-30" />
                            <p>暂无通知</p>
                        </div>
                    ) : (
                        <div className="flex h-full min-h-0">
                            <div
                                className={cn(
                                    "min-h-0 overflow-y-auto",
                                    previewNotification ? "w-full sm:w-96 sm:shrink-0 sm:border-r sm:border-gray-200 sm:dark:border-gray-700" : "w-full"
                                )}
                            >
                                {notificationList}
                            </div>
                            {previewNotification && (
                                <>
                                    <div className="hidden min-w-0 flex-1 sm:block">
                                        <EmailQuickPreview
                                            email={previewEmail}
                                            loading={previewLoading}
                                            error={previewError}
                                            accountId={previewNotification.account_id}
                                            accountEmail={previewNotification.account_email}
                                            onClose={() => {
                                                setPreviewNotification(null)
                                                setPreviewEmail(null)
                                                setPreviewError(null)
                                            }}
                                            onOpenFull={() => handleViewEmail(previewNotification)}
                                            floating={false}
                                            className="h-full w-full min-w-0 rounded-none border-0 shadow-none"
                                        />
                                    </div>
                                    <div className="fixed inset-x-3 bottom-3 top-20 z-[60] sm:hidden">
                                        <EmailQuickPreview
                                            email={previewEmail}
                                            loading={previewLoading}
                                            error={previewError}
                                            accountId={previewNotification.account_id}
                                            accountEmail={previewNotification.account_email}
                                            onClose={() => {
                                                setPreviewNotification(null)
                                                setPreviewEmail(null)
                                                setPreviewError(null)
                                            }}
                                            onOpenFull={() => handleViewEmail(previewNotification)}
                                            floating={false}
                                            className="h-full w-full min-w-0"
                                        />
                                    </div>
                                </>
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
    onPreviewEmail: () => void
    formatTime: (timestamp: string) => string
}

function NotificationItem({ notification, onMarkAsRead, onRemove, onViewEmail, onPreviewEmail, formatTime }: NotificationItemProps) {
    return (
        <div
            onClick={() => {
                if (notification.email_id) {
                    onPreviewEmail()
                }
            }}
            className={cn(
                "px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors",
                notification.email_id && "cursor-pointer",
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

                    {/* 邮件操作按钮 */}
                    {notification.email_id && (
                        <div className="mt-2 flex items-center gap-3">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onPreviewEmail()
                                }}
                                className="flex items-center gap-1 text-xs text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                                <Eye className="h-3 w-3" />
                                预览
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onViewEmail()
                                }}
                                className="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-300"
                            >
                                <ExternalLink className="h-3 w-3" />
                                打开
                            </button>
                        </div>
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
