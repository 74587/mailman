'use client'

import React, { useState, useEffect } from 'react'
import { Search, RefreshCw, Mail, Paperclip, ChevronDown, Filter, Play, Pause, Locate, MoreVertical, Zap, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Email, EmailAccount } from '@/types'
import { formatDate, truncate } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

interface EmailListPanelProps {
    emails: Email[]
    // 使用ID而非对象引用，避免增量刷新时不必要的重新渲染
    selectedEmailId: number | null
    onSelectEmail: (email: Email) => void
    onSearch: (query: string) => void
    onRefresh: () => Promise<void>
    loading: boolean
    selectedAccount: EmailAccount | null
    autoSyncEnabled: boolean
    onToggleAutoSync: () => void
    isRefreshing: boolean
    // 分页相关
    totalCount: number
    hasMore: boolean
    onLoadMore: () => Promise<void>
    loadingMore: boolean
    // 方向筛选
    directionFilter?: 'received' | 'sent' | 'all'
    onDirectionChange?: (direction: 'received' | 'sent' | 'all') => void
}

export default function EmailListPanel({
    emails,
    selectedEmailId,
    onSelectEmail,
    onSearch,
    onRefresh,
    loading,
    selectedAccount,
    autoSyncEnabled,
    onToggleAutoSync,
    isRefreshing,
    totalCount,
    hasMore,
    onLoadMore,
    loadingMore,
    directionFilter = 'received',
    onDirectionChange
}: EmailListPanelProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [sortBy, setSortBy] = useState<'date' | 'from' | 'subject'>('date')
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
    const [triggeringEmailId, setTriggeringEmailId] = useState<number | null>(null)
    const [syncingAttachmentsEmailId, setSyncingAttachmentsEmailId] = useState<number | null>(null)
    const listContainerRef = React.useRef<HTMLDivElement>(null)

    // 右键菜单弹出状态
    const [dropdownOpenEmailId, setDropdownOpenEmailId] = useState<number | null>(null)

    // 手动触发邮件事件
    const handleTriggerEmail = async (email: Email, e: React.MouseEvent) => {
        e.stopPropagation() // 防止触发邮件选中

        try {
            setTriggeringEmailId(email.ID)
            await apiClient.post(`/emails/${email.ID}/trigger`)
            toast.success('邮件事件已触发', {
                description: `邮件 "${email.Subject || '(无主题)'}" 已发送到所有匹配的触发器`,
            })
        } catch (error: any) {
            toast.error('触发失败', {
                description: error?.message || '无法触发邮件事件，请稍后重试',
            })
        } finally {
            setTriggeringEmailId(null)
        }
    }

    // 同步附件
    const handleSyncAttachments = async (email: Email, e: React.MouseEvent) => {
        e.stopPropagation()

        try {
            setSyncingAttachmentsEmailId(email.ID)
            const response = await apiClient.post(`/emails/${email.ID}/sync-attachments`, {
                force_download: true
            })
            toast.success('附件同步成功', {
                description: `成功同步 ${response?.attachments_count || 0} 个附件`,
            })
        } catch (error: any) {
            toast.error('附件同步失败', {
                description: error?.message || '无法同步附件，请稍后重试',
            })
        } finally {
            setSyncingAttachmentsEmailId(null)
        }
    }

    // 计算当前选中邮件的序号
    const selectedEmailIndex = selectedEmailId !== null
        ? emails.findIndex(e => e.ID === selectedEmailId) + 1
        : 0

    // 定位到选中的邮件
    const scrollToSelectedEmail = () => {
        if (selectedEmailId === null || !listContainerRef.current) return
        const emailElement = listContainerRef.current.querySelector(
            `[data-email-id="${selectedEmailId}"]`
        )
        if (emailElement) {
            emailElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
    }

    // 处理搜索
    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        onSearch(searchQuery)
    }

    // 处理搜索输入变化
    const handleSearchInputChange = (value: string) => {
        setSearchQuery(value)
        // 实时搜索（防抖处理）
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current)
        }
        searchTimeoutRef.current = setTimeout(() => {
            onSearch(value)
        }, 500)
    }

    const searchTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)

    // 清理定时器
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current)
            }
        }
    }, [])

    // 滚动加载检测
    useEffect(() => {
        const container = listContainerRef.current
        if (!container) return

        const handleScroll = () => {
            // 检查是否滚动到底部（距离底部 100px 时触发）
            const { scrollTop, scrollHeight, clientHeight } = container
            const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100

            if (isNearBottom && hasMore && !loadingMore && !loading) {
                onLoadMore()
            }
        }

        container.addEventListener('scroll', handleScroll)
        return () => container.removeEventListener('scroll', handleScroll)
    }, [hasMore, loadingMore, loading, onLoadMore])

    // 排序邮件
    const sortedEmails = [...emails].sort((a, b) => {
        let comparison = 0

        switch (sortBy) {
            case 'date':
                comparison = new Date(a.Date).getTime() - new Date(b.Date).getTime()
                break
            case 'from':
                const fromA = Array.isArray(a.From) ? a.From[0] : a.From || ''
                const fromB = Array.isArray(b.From) ? b.From[0] : b.From || ''
                comparison = fromA.localeCompare(fromB)
                break
            case 'subject':
                comparison = (a.Subject || '').localeCompare(b.Subject || '')
                break
        }

        return sortOrder === 'desc' ? -comparison : comparison
    })

    return (
        <div className="h-full flex flex-col">
            {/* 顶部工具栏 */}
            <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                {/* 标题栏 */}
                <div className="px-4 py-3 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                        {selectedAccount
                            ? `${selectedAccount.emailAddress} 的邮件`
                            : '邮件列表'
                        }
                    </h3>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                            {emails.length} 封邮件
                        </span>

                        {/* 定位按钮 */}
                        {selectedEmailId !== null && (
                            <button
                                onClick={scrollToSelectedEmail}
                                className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                title="定位到选中邮件"
                            >
                                <Locate className="h-3.5 w-3.5" />
                            </button>
                        )}

                        {/* 自动同步切换按钮 */}
                        <button
                            onClick={onToggleAutoSync}
                            className={cn(
                                "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                                autoSyncEnabled
                                    ? "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300"
                                    : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400"
                            )}
                            title={autoSyncEnabled ? "关闭自动同步" : "开启自动同步"}
                        >
                            {autoSyncEnabled ? (
                                <Pause className="h-3 w-3" />
                            ) : (
                                <Play className="h-3 w-3" />
                            )}
                            <span className="hidden sm:inline">
                                {autoSyncEnabled ? "自动同步" : "手动模式"}
                            </span>
                        </button>

                        {/* 手动刷新按钮 */}
                        <button
                            onClick={onRefresh}
                            disabled={loading || isRefreshing}
                            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="刷新邮件"
                        >
                            <RefreshCw className={cn(
                                "h-4 w-4",
                                (loading || isRefreshing) && "animate-spin"
                            )} />
                        </button>
                    </div>
                </div>

                {/* 搜索与排序合并区域 */}
                <div className="px-3 pb-2.5">
                    {/* 紧凑搜索框 */}
                    <form onSubmit={handleSearch} className="relative mb-2">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="搜索邮件..."
                            value={searchQuery}
                            onChange={(e) => handleSearchInputChange(e.target.value)}
                            className="w-full rounded-full border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-xs focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:bg-white dark:border-gray-600 dark:bg-gray-700/50 dark:text-white dark:focus:bg-gray-700 placeholder:text-gray-400 transition-all"
                        />
                    </form>

                    {/* 紧凑排序控制 - pill 样式 */}
                    <div className="flex items-center justify-between">
                        {/* 方向筛选 */}
                        {onDirectionChange && (
                            <div className="flex items-center bg-blue-100 dark:bg-blue-900/30 rounded-full p-0.5 mr-2">
                                <button
                                    onClick={() => onDirectionChange('all')}
                                    className={cn(
                                        "px-2 py-0.5 rounded-full text-[11px] transition-all duration-200",
                                        directionFilter === 'all'
                                            ? "bg-blue-500 text-white shadow-sm"
                                            : "text-blue-600 dark:text-blue-400 hover:text-blue-700"
                                    )}
                                >
                                    全部
                                </button>
                                <button
                                    onClick={() => onDirectionChange('received')}
                                    className={cn(
                                        "px-2 py-0.5 rounded-full text-[11px] transition-all duration-200",
                                        directionFilter === 'received'
                                            ? "bg-blue-500 text-white shadow-sm"
                                            : "text-blue-600 dark:text-blue-400 hover:text-blue-700"
                                    )}
                                >
                                    收件
                                </button>
                                <button
                                    onClick={() => onDirectionChange('sent')}
                                    className={cn(
                                        "px-2 py-0.5 rounded-full text-[11px] transition-all duration-200",
                                        directionFilter === 'sent'
                                            ? "bg-blue-500 text-white shadow-sm"
                                            : "text-blue-600 dark:text-blue-400 hover:text-blue-700"
                                    )}
                                >
                                    发件
                                </button>
                            </div>
                        )}
                        <div className="flex items-center bg-gray-100 dark:bg-gray-700/50 rounded-full p-0.5">
                            <button
                                onClick={() => setSortBy('date')}
                                className={cn(
                                    "px-2 py-0.5 rounded-full text-[11px] transition-all duration-200",
                                    sortBy === 'date'
                                        ? "bg-blue-500 text-white shadow-sm"
                                        : "text-gray-500 dark:text-gray-400 hover:text-blue-600"
                                )}
                            >
                                日期
                            </button>
                            <button
                                onClick={() => setSortBy('from')}
                                className={cn(
                                    "px-2 py-0.5 rounded-full text-[11px] transition-all duration-200",
                                    sortBy === 'from'
                                        ? "bg-blue-500 text-white shadow-sm"
                                        : "text-gray-500 dark:text-gray-400 hover:text-blue-600"
                                )}
                            >
                                发件人
                            </button>
                            <button
                                onClick={() => setSortBy('subject')}
                                className={cn(
                                    "px-2 py-0.5 rounded-full text-[11px] transition-all duration-200",
                                    sortBy === 'subject'
                                        ? "bg-blue-500 text-white shadow-sm"
                                        : "text-gray-500 dark:text-gray-400 hover:text-blue-600"
                                )}
                            >
                                主题
                            </button>
                        </div>

                        {/* 升降序切换 */}
                        <button
                            onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                            className={cn(
                                "flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] transition-all duration-200",
                                "bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400",
                                "hover:bg-gray-200 dark:hover:bg-gray-600"
                            )}
                        >
                            {sortOrder === 'desc' ? (
                                <>
                                    <span className="text-blue-500">↓</span>
                                    <span>新到旧</span>
                                </>
                            ) : (
                                <>
                                    <span className="text-blue-500">↑</span>
                                    <span>旧到新</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* 邮件列表 */}
            <div ref={listContainerRef} className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                            <RefreshCw className="h-8 w-8 animate-spin text-gray-400 mx-auto mb-4" />
                            <p className="text-gray-500 dark:text-gray-400">加载邮件中...</p>
                        </div>
                    </div>
                ) : emails.length === 0 ? (
                    <div className="h-full flex flex-col">
                        {/* 空状态标题区域 */}
                        <div className="flex-1 flex items-center justify-center min-h-0">
                            <div className="text-center max-w-md px-4">
                                <Mail className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto mb-6" />
                                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                                    {selectedAccount ? '邮箱暂无邮件' : '选择邮箱账户'}
                                </h3>
                                <p className="text-gray-500 dark:text-gray-400 mb-6">
                                    {selectedAccount
                                        ? `当前 ${selectedAccount.emailAddress} 邮箱中没有邮件，或者所有邮件都已同步完成。`
                                        : '请从左侧选择一个邮箱账户来查看邮件。'
                                    }
                                </p>
                                {selectedAccount && (
                                    <div className="space-y-2">
                                        <button
                                            onClick={onRefresh}
                                            disabled={loading || isRefreshing}
                                            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {(loading || isRefreshing) && <RefreshCw className="h-4 w-4 animate-spin" />}
                                            刷新邮件
                                        </button>
                                        <button
                                            onClick={onToggleAutoSync}
                                            className={cn(
                                                "w-full px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2",
                                                autoSyncEnabled
                                                    ? "bg-green-600 text-white hover:bg-green-700"
                                                    : "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                            )}
                                        >
                                            {autoSyncEnabled ? (
                                                <>
                                                    <Pause className="h-4 w-4" />
                                                    关闭自动同步
                                                </>
                                            ) : (
                                                <>
                                                    <Play className="h-4 w-4" />
                                                    开启自动同步
                                                </>
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 底部提示区域 */}
                        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                            <div className="text-center">
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {selectedAccount ? '尝试刷新或检查网络连接' : '开始管理您的邮件'}
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                        {sortedEmails.map((email) => (
                            <div
                                key={email.ID}
                                data-email-id={email.ID}
                                onClick={() => onSelectEmail(email)}
                                onContextMenu={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    // 打开该邮件的右键菜单
                                    setDropdownOpenEmailId(email.ID)
                                }}
                                className={cn(
                                    "group p-4 cursor-pointer transition-all duration-200 relative",
                                    selectedEmailId === email.ID
                                        ? "bg-gradient-to-r from-blue-100 to-blue-50 dark:from-blue-900/50 dark:to-blue-900/20 border-l-4 border-blue-500 shadow-sm relative"
                                        : "hover:bg-gray-50 dark:hover:bg-gray-700/50 border-l-4 border-transparent"
                                )}
                            >
                                {/* 选中时的右侧指示器 */}
                                {selectedEmailId === email.ID && (
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-l-full" />
                                )}
                                <div className="flex items-start gap-3">
                                    {/* 邮件图标 */}
                                    <div className={cn(
                                        "w-2.5 h-2.5 rounded-full mt-2 shrink-0 ring-2",
                                        selectedEmailId === email.ID
                                            ? "bg-blue-500 ring-blue-200 dark:ring-blue-700"
                                            : "bg-gray-300 dark:bg-gray-600 ring-transparent"
                                    )} />

                                    {/* 邮件信息 */}
                                    <div className="flex-1 min-w-0">
                                        {/* 第一行：发件人和时间 */}
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={cn(
                                                "font-semibold text-sm truncate",
                                                selectedEmailId === email.ID
                                                    ? "text-blue-700 dark:text-blue-300"
                                                    : "text-gray-900 dark:text-gray-100"
                                            )}>
                                                {Array.isArray(email.From) ? email.From[0] : email.From || '未知发件人'}
                                            </span>
                                            <span className={cn(
                                                "text-xs ml-2 shrink-0",
                                                selectedEmailId === email.ID
                                                    ? "text-blue-600 dark:text-blue-400 font-medium"
                                                    : "text-gray-500 dark:text-gray-400"
                                            )}>
                                                {formatDate(email.Date)}
                                            </span>
                                        </div>

                                        {/* 第二行：主题和附件 */}
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={cn(
                                                "text-sm truncate font-medium",
                                                selectedEmailId === email.ID
                                                    ? "text-blue-600 dark:text-blue-400"
                                                    : "text-gray-700 dark:text-gray-300"
                                            )}>
                                                {email.Subject || '(无主题)'}
                                            </span>
                                            {email.HasAttachments && (
                                                <Paperclip className={cn(
                                                    "h-3 w-3 shrink-0",
                                                    selectedEmailId === email.ID
                                                        ? "text-blue-500"
                                                        : "text-gray-400"
                                                )} />
                                            )}
                                        </div>

                                        {/* 第三行：邮件预览 */}
                                        <p className={cn(
                                            "text-xs truncate pr-16",
                                            selectedEmailId === email.ID
                                                ? "text-blue-500/80 dark:text-blue-400/70"
                                                : "text-gray-500 dark:text-gray-400"
                                        )}>
                                            {truncate(email.Body || '', 80)}
                                        </p>

                                        {/* 右下角附件标签 */}
                                        {email.HasAttachments && (
                                            <div className={cn(
                                                "absolute bottom-3 right-3 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 shadow-sm",
                                                selectedEmailId === email.ID
                                                    ? "bg-blue-200/50 text-blue-700 dark:bg-blue-800/50 dark:text-blue-200"
                                                    : "bg-gray-100/80 text-gray-500 dark:bg-gray-700/80 dark:text-gray-400"
                                            )}>
                                                <Paperclip className="h-3 w-3" />
                                                附件
                                            </div>
                                        )}
                                    </div>

                                    {/* 操作菜单 */}
                                    <DropdownMenu
                                        open={dropdownOpenEmailId === email.ID}
                                        onOpenChange={(open) => {
                                            if (!open) {
                                                setDropdownOpenEmailId(null)
                                            }
                                        }}
                                    >
                                        <DropdownMenuTrigger asChild>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setDropdownOpenEmailId(email.ID)
                                                }}
                                                className={cn(
                                                    "p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-all",
                                                    dropdownOpenEmailId === email.ID
                                                        ? "opacity-100 bg-gray-200 dark:bg-gray-600"
                                                        : "opacity-0 group-hover:opacity-100"
                                                )}
                                                title="更多操作（右键也可触发）"
                                            >
                                                <MoreVertical className="h-4 w-4" />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48">
                                            <DropdownMenuItem
                                                onClick={(e: React.MouseEvent) => handleTriggerEmail(email, e)}
                                                disabled={triggeringEmailId === email.ID}
                                                className="flex items-center gap-2 cursor-pointer"
                                            >
                                                <Zap className={cn(
                                                    "h-4 w-4",
                                                    triggeringEmailId === email.ID && "animate-pulse"
                                                )} />
                                                <span>
                                                    {triggeringEmailId === email.ID ? '触发中...' : '使用该邮件激活触发器'}
                                                </span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={(e: React.MouseEvent) => handleSyncAttachments(email, e)}
                                                disabled={syncingAttachmentsEmailId === email.ID}
                                                className="flex items-center gap-2 cursor-pointer"
                                            >
                                                <Download className={cn(
                                                    "h-4 w-4",
                                                    syncingAttachmentsEmailId === email.ID && "animate-pulse"
                                                )} />
                                                <span>
                                                    {syncingAttachmentsEmailId === email.ID ? '同步中...' : '同步附件'}
                                                </span>
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                        ))}

                        {/* 加载更多指示器 */}
                        {loadingMore && (
                            <div className="flex items-center justify-center py-4">
                                <RefreshCw className="h-5 w-5 animate-spin text-gray-400 mr-2" />
                                <span className="text-sm text-gray-500 dark:text-gray-400">加载更多邮件...</span>
                            </div>
                        )}

                        {/* 已加载全部提示 */}
                        {!hasMore && emails.length > 0 && !loadingMore && (
                            <div className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">
                                已加载全部 {emails.length} 封邮件
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 底部状态栏 */}
            <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-2">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>
                        {selectedAccount && `当前: ${selectedAccount.emailAddress}`}
                    </span>
                    <span className="flex items-center gap-2">
                        {selectedEmailIndex > 0 && (
                            <>
                                <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
                                    第 {selectedEmailIndex} 封
                                </span>
                                <span className="text-gray-300 dark:text-gray-600">|</span>
                            </>
                        )}
                        {totalCount > 0 && (
                            <span>
                                共 {totalCount.toLocaleString()} 封
                                {emails.length < totalCount && `, 已加载 ${emails.length} 封`}
                            </span>
                        )}
                    </span>
                </div>
            </div>
        </div>
    )
}
