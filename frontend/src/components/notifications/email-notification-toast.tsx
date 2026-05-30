'use client'
import { logger } from '@/lib/logger';

import React, { useState, useEffect, useRef } from 'react'
import { X, Mail, Inbox, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { addNotification, isProcessed, markAsRead } from '@/lib/notification-store'

// 通知类型定义
interface EmailNotification {
    type: string
    account_id: number
    account_email: string
    email_id?: number
    email_count: number
    subject?: string
    from?: string
    timestamp: string
}

interface ToastNotification extends EmailNotification {
    storeId?: string
}

// 通知项组件属性
interface NotificationItemProps {
    notification: ToastNotification
    onDismiss: () => void
    onClick: () => void
    ttl?: number
}

// 单个通知项组件
function NotificationItem({ notification, onDismiss, onClick, ttl = 10000 }: NotificationItemProps) {
    const [isVisible, setIsVisible] = useState(false)
    const [isExiting, setIsExiting] = useState(false)

    useEffect(() => {
        // 进场动画
        const timer = setTimeout(() => setIsVisible(true), 100)
        return () => clearTimeout(timer)
    }, [])

    useEffect(() => {
        const timer = setTimeout(() => {
            handleDismiss()
        }, ttl)
        return () => clearTimeout(timer)
    }, [ttl])

    const handleDismiss = () => {
        if (isExiting) return
        setIsExiting(true)
        setTimeout(onDismiss, 300) // 等待退场动画完成
    }

    const handleClick = () => {
        onClick()
        handleDismiss()
    }

    return (
        <div
            className={cn(
                "transform transition-all duration-300 ease-in-out",
                "bg-white/95 dark:bg-gray-800/95 rounded-xl shadow-xl shadow-gray-900/10 border border-gray-200/90 dark:border-gray-700/90 backdrop-blur",
                "pointer-events-auto w-[min(360px,calc(100vw-2rem))] cursor-pointer p-3 hover:-translate-y-0.5 hover:shadow-2xl",
                isVisible && !isExiting ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
            )}
            onClick={handleClick}
        >
            <div className="flex items-start justify-between">
                <div className="flex min-w-0 items-start space-x-3">
                    <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center">
                            <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </div>
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {notification.account_email}
                        </div>
                        <div className="line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
                            {notification.from ? (
                                <>收到来自 <span className="font-medium">{notification.from}</span> 的邮件</>
                            ) : (
                                <>收到 {notification.email_count} 封新邮件</>
                            )}
                        </div>
                        {notification.subject && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-1 font-medium">
                                {notification.subject}
                            </div>
                        )}
                        <div className="text-xs text-gray-400 mt-1">
                            {new Date(notification.timestamp).toLocaleTimeString()}
                        </div>
                    </div>
                </div>

                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        handleDismiss()
                    }}
                    className="ml-3 flex-shrink-0 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="mt-2 flex justify-end gap-2">
                <button
                    className="rounded-md bg-gray-100 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                    onClick={(e) => {
                        e.stopPropagation()
                        handleDismiss()
                    }}
                >
                    忽略
                </button>
                <button
                    className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700"
                    onClick={(e) => {
                        e.stopPropagation()
                        handleClick()
                    }}
                >
                    点击查看
                </button>
            </div>
        </div>
    )
}

function NotificationSummary({
    hiddenCount,
    totalCount,
    onOpenCenter,
    onCollapseAll,
}: {
    hiddenCount: number
    totalCount: number
    onOpenCenter: () => void
    onCollapseAll: () => void
}) {
    return (
        <div className="w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-blue-200/80 bg-blue-50/95 shadow-xl shadow-gray-900/10 backdrop-blur dark:border-blue-900/60 dark:bg-blue-950/80">
            <button
                onClick={onOpenCenter}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-blue-100/70 dark:hover:bg-blue-900/50"
            >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                    <Inbox className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                        还有 {hiddenCount} 条新邮件通知
                    </div>
                    <div className="text-xs text-blue-600/80 dark:text-blue-300/80">
                        已收纳到通知中心，共 {totalCount} 条待处理
                    </div>
                </div>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-blue-500" />
            </button>
            <div className="flex items-center justify-between border-t border-blue-100 px-3 py-2 dark:border-blue-900/70">
                <button
                    onClick={onOpenCenter}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                >
                    打开通知中心
                </button>
                <button
                    onClick={onCollapseAll}
                    className="rounded-md px-2 py-1 text-xs text-blue-600 transition-colors hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/60"
                >
                    全部收起
                </button>
            </div>
        </div>
    )
}

// 通知容器组件属性
interface EmailNotificationToastProps {
    onNotificationClick?: (accountId: number, accountEmail: string) => void
}

// 主通知容器组件
export default function EmailNotificationToast({ onNotificationClick }: EmailNotificationToastProps) {
    const [notifications, setNotifications] = useState<ToastNotification[]>([])
    const wsRef = useRef<WebSocket | null>(null)
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
    const visibleNotifications = notifications.slice(0, 2)
    const hiddenCount = Math.max(0, notifications.length - visibleNotifications.length)

    // WebSocket连接管理
    const connectWebSocket = () => {
        try {
            // 确定WebSocket URL
            // 注意：Next.js rewrites 不支持 WebSocket 代理，
            // 开发环境下需要直接连接后端端口
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
            const isDev = process.env.NODE_ENV === 'development' || window.location.port === '3000'
            const host = isDev ? `${window.location.hostname}:8080` : window.location.host
            const wsUrl = `${protocol}//${host}/api/ws/notifications`

            const ws = new WebSocket(wsUrl)
            wsRef.current = ws

            ws.onopen = () => {
                logger.debug('[EmailNotificationToast] WebSocket connected')
                setConnectionStatus('connected')

                // 清除重连定时器
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current)
                    reconnectTimeoutRef.current = null
                }
            }

            ws.onmessage = (event) => {
                try {
                    const notification: EmailNotification = JSON.parse(event.data)

                    if (notification.type === 'new_email') {
                        logger.debug('[EmailNotificationToast] Received notification:', notification)

                        // 使用 store 检查是否已处理过（去重）
                        if (isProcessed(notification.timestamp, notification.account_id, notification.subject)) {
                            logger.debug('[EmailNotificationToast] Notification already processed, skipping toast')
                            return
                        }

                        // 添加到 store（持久化）
                        const stored = addNotification({
                            type: notification.type,
                            account_id: notification.account_id,
                            account_email: notification.account_email,
                            email_id: notification.email_id,
                            email_count: notification.email_count,
                            subject: notification.subject,
                            from: notification.from,
                            timestamp: notification.timestamp
                        })

                        // 只有成功添加（非重复）才显示 toast
                        if (stored) {
                            setNotifications(prev => {
                                const newNotifications = [{ ...notification, storeId: stored.id }, ...prev.slice(0, 9)]
                                return newNotifications
                            })
                        }
                    }
                } catch (error) {
                    console.error('[EmailNotificationToast] Failed to parse notification:', error)
                }
            }

            ws.onclose = (event) => {
                logger.debug('[EmailNotificationToast] WebSocket closed:', event.code, event.reason)
                setConnectionStatus('disconnected')
                wsRef.current = null

                // 如果不是手动关闭，尝试重连
                if (event.code !== 1000) {
                    scheduleReconnect()
                }
            }

            ws.onerror = (error) => {
                console.error('[EmailNotificationToast] WebSocket error:', error)
                setConnectionStatus('disconnected')
            }

        } catch (error) {
            console.error('[EmailNotificationToast] Failed to create WebSocket:', error)
            setConnectionStatus('disconnected')
            scheduleReconnect()
        }
    }

    // 安排重连
    const scheduleReconnect = () => {
        if (reconnectTimeoutRef.current) return

        logger.debug('[EmailNotificationToast] Scheduling reconnect in 2 seconds...')
        reconnectTimeoutRef.current = setTimeout(() => {
            logger.debug('[EmailNotificationToast] Attempting to reconnect...')
            setConnectionStatus('connecting')
            connectWebSocket()
        }, 2000)
    }

    // 断开连接
    const disconnect = () => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current)
            reconnectTimeoutRef.current = null
        }

        if (wsRef.current) {
            wsRef.current.close(1000, 'User disconnect')
            wsRef.current = null
        }
    }

    // 处理通知点击 - 导航到经典邮件管理器并选中邮件
    const handleNotificationClick = (notification: EmailNotification) => {
        logger.debug('[EmailNotificationToast] Notification clicked:', notification.account_email, notification.email_id)
        const storeId = (notification as ToastNotification).storeId
        if (storeId) {
            markAsRead(storeId)
        }

        // 使用 switchTab 事件导航到经典邮件管理器
        if (notification.email_id) {
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
        } else if (onNotificationClick) {
            // 如果没有 email_id (旧通知)，使用回调
            onNotificationClick(notification.account_id, notification.account_email)
        }
    }

    // 手动移除通知
    const handleDismissNotification = (timestamp: string) => {
        setNotifications(prev => prev.filter(n => n.timestamp !== timestamp))
    }

    const handleOpenNotificationCenter = () => {
        setNotifications([])
        window.dispatchEvent(new CustomEvent('openNotificationDrawer'))
    }

    // 组件生命周期
    useEffect(() => {
        connectWebSocket()

        return () => {
            disconnect()
        }
    }, [])

    // 连接状态指示器
    const renderConnectionStatus = () => {
        switch (connectionStatus) {
            case 'connecting':
                return (
                    <div className="fixed top-4 right-4 bg-yellow-100 text-yellow-800 px-3 py-1 rounded-md text-xs z-40">
                        正在连接通知服务...
                    </div>
                )
            case 'disconnected':
                return (
                    <div className="fixed top-4 right-4 bg-red-100 text-red-800 px-3 py-1 rounded-md text-xs z-40">
                        通知服务已断开
                    </div>
                )
            case 'connected':
                return null
        }
    }

    return (
        <>
            {/* 连接状态指示器 */}
            {renderConnectionStatus()}

            {/* 通知容器 */}
            <div className="pointer-events-none fixed right-4 top-20 z-50 flex flex-col items-end gap-2">
                {notifications.length > 1 && (
                    <button
                        onClick={() => setNotifications([])}
                        className="pointer-events-auto rounded-full border border-gray-200 bg-white/90 px-3 py-1 text-xs font-medium text-gray-500 shadow-sm backdrop-blur transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        收起全部
                    </button>
                )}

                {visibleNotifications.map((notification) => (
                    <NotificationItem
                        key={`${notification.timestamp}-${notification.account_id}-${notification.email_id || notification.subject || ''}`}
                        notification={notification}
                        onDismiss={() => handleDismissNotification(notification.timestamp)}
                        onClick={() => handleNotificationClick(notification)}
                    />
                ))}

                {hiddenCount > 0 && (
                    <div className="pointer-events-auto">
                        <NotificationSummary
                            hiddenCount={hiddenCount}
                            totalCount={notifications.length}
                            onOpenCenter={handleOpenNotificationCenter}
                            onCollapseAll={() => setNotifications([])}
                        />
                    </div>
                )}
            </div>
        </>
    )
}

// WebSocket状态Hook（可选，供其他组件使用）
export function useWebSocketConnection() {
    const [isConnected, setIsConnected] = useState(false)
    const [lastMessage, setLastMessage] = useState<EmailNotification | null>(null)

    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const isDev = process.env.NODE_ENV === 'development' || window.location.port === '3000'
        const host = isDev ? `${window.location.hostname}:8080` : window.location.host
        const wsUrl = `${protocol}//${host}/api/ws/notifications`

        const ws = new WebSocket(wsUrl)

        ws.onopen = () => setIsConnected(true)
        ws.onclose = () => setIsConnected(false)
        ws.onmessage = (event) => {
            try {
                const notification: EmailNotification = JSON.parse(event.data)
                setLastMessage(notification)
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error)
            }
        }

        return () => {
            ws.close()
        }
    }, [])

    return { isConnected, lastMessage }
}
