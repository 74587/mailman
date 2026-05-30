'use client'
import { logger } from '@/lib/logger';

import React, { useState, useEffect, useRef } from 'react'
import { X, Mail, Inbox, ChevronLeft, ChevronRight } from 'lucide-react'
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

function NotificationCarousel({
    notifications,
    currentIndex,
    onIndexChange,
    onDismiss,
    onClick,
    onOpenCenter,
    onCollapseAll,
}: {
    notifications: ToastNotification[]
    currentIndex: number
    onIndexChange: (index: number) => void
    onDismiss: (notification: ToastNotification) => void
    onClick: (notification: ToastNotification) => void
    onOpenCenter: () => void
    onCollapseAll: () => void
}) {
    const total = notifications.length
    if (total === 0) return null

    const canGoNewer = currentIndex > 0
    const canGoOlder = currentIndex < total - 1

    return (
        <div className="pointer-events-auto w-[min(360px,calc(100vw-7rem))] overflow-hidden rounded-2xl border border-gray-200/90 bg-white/95 shadow-2xl shadow-gray-900/10 backdrop-blur dark:border-gray-700/80 dark:bg-gray-800/95 max-[640px]:w-[calc(100vw-2rem)]">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700/70">
                <button
                    onClick={onOpenCenter}
                    className="flex min-w-0 items-center gap-2 rounded-xl pr-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
                    title="打开通知中心"
                >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                        <Inbox className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">新邮件消息盒子</div>
                        <div className="text-xs text-gray-400">
                            {currentIndex + 1}/{total} · 默认展示最新
                        </div>
                    </div>
                </button>
                <button
                    onClick={onCollapseAll}
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    title="收起消息盒子"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="relative overflow-hidden">
                <div
                    className="flex transition-transform duration-300 ease-out"
                    style={{ transform: `translateX(-${currentIndex * 100}%)` }}
                >
                    {notifications.map((notification) => (
                        <div key={`${notification.timestamp}-${notification.account_id}-${notification.email_id || notification.subject || ''}`} className="w-full flex-shrink-0 p-3">
                            <button
                                onClick={() => onClick(notification)}
                                className="flex w-full items-start gap-3 rounded-xl px-1 py-1 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
                            >
                                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
                                    <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div className="min-w-0 flex-1">
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
                                        <div className="mt-1 truncate text-xs font-medium text-gray-500 dark:text-gray-400">
                                            {notification.subject}
                                        </div>
                                    )}
                                    <div className="mt-1 text-xs text-gray-400">
                                        {new Date(notification.timestamp).toLocaleTimeString()}
                                    </div>
                                </div>
                            </button>
                        </div>
                    ))}
                </div>

                {total > 1 && (
                    <>
                        <button
                            onClick={() => onIndexChange(Math.max(0, currentIndex - 1))}
                            disabled={!canGoNewer}
                            className={cn(
                                'absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-white/35 text-gray-700 opacity-70 shadow-sm backdrop-blur transition hover:bg-white/85 hover:opacity-100 disabled:pointer-events-none disabled:opacity-20 dark:border-gray-700/50 dark:bg-gray-950/25 dark:text-gray-100 dark:hover:bg-gray-800/90'
                            )}
                            title="查看更新通知"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => onIndexChange(Math.min(total - 1, currentIndex + 1))}
                            disabled={!canGoOlder}
                            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-white/35 text-gray-700 opacity-70 shadow-sm backdrop-blur transition hover:bg-white/85 hover:opacity-100 disabled:pointer-events-none disabled:opacity-20 dark:border-gray-700/50 dark:bg-gray-950/25 dark:text-gray-100 dark:hover:bg-gray-800/90"
                            title="查看更早通知"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </>
                )}
            </div>

            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 dark:border-gray-700/70">
                <div className="flex min-w-0 items-center gap-1.5">
                    {notifications.slice(0, 8).map((notification, index) => (
                        <button
                            key={`${notification.timestamp}-${notification.account_id}-${index}`}
                            onClick={() => onIndexChange(index)}
                            className={cn(
                                'h-1.5 rounded-full transition-all',
                                index === currentIndex
                                    ? 'w-5 bg-blue-500'
                                    : 'w-1.5 bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500'
                            )}
                            title={`第 ${index + 1} 条通知`}
                        />
                    ))}
                    {total > 8 && <span className="text-[10px] text-gray-400">+{total - 8}</span>}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onDismiss(notifications[currentIndex])}
                        className="rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        忽略
                    </button>
                    <button
                        onClick={() => onClick(notifications[currentIndex])}
                        className="rounded-md bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700"
                    >
                        点击查看
                    </button>
                </div>
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
    const [currentIndex, setCurrentIndex] = useState(0)
    const wsRef = useRef<WebSocket | null>(null)
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')

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
                            setCurrentIndex(0)
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

    useEffect(() => {
        setCurrentIndex(prev => Math.min(prev, Math.max(0, notifications.length - 1)))
    }, [notifications.length])

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
            <div className="pointer-events-none fixed right-28 top-14 z-50 max-[640px]:right-4 max-[640px]:top-16">
                {notifications.length > 0 && (
                    <NotificationCarousel
                        notifications={notifications}
                        currentIndex={currentIndex}
                        onIndexChange={setCurrentIndex}
                        onDismiss={(notification) => handleDismissNotification(notification.timestamp)}
                        onClick={handleNotificationClick}
                        onOpenCenter={handleOpenNotificationCenter}
                        onCollapseAll={() => setNotifications([])}
                    />
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
