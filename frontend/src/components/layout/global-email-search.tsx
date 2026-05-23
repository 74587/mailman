'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, Loader2, Mail, User, Clock, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { emailService } from '@/services/email.service'
import { Email } from '@/types'
import { formatDate } from '@/lib/utils'

interface GlobalEmailSearchProps {
    className?: string
}

// 高亮文本组件
function HighlightText({ text, keyword }: { text: string; keyword: string }) {
    if (!keyword || !text) {
        return <>{text}</>
    }

    try {
        // 不区分大小写的正则匹配
        const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
        const parts = text.split(regex)

        return (
            <>
                {parts.map((part, index) => {
                    if (part.toLowerCase() === keyword.toLowerCase()) {
                        return (
                            <mark
                                key={index}
                                className="bg-yellow-200 dark:bg-yellow-500/30 text-inherit rounded px-0.5"
                            >
                                {part}
                            </mark>
                        )
                    }
                    return <span key={index}>{part}</span>
                })}
            </>
        )
    } catch {
        return <>{text}</>
    }
}

// 搜索结果项组件
interface SearchResultItemProps {
    email: Email
    keyword: string
    isSelected: boolean
    onClick: () => void
}

function SearchResultItem({ email, keyword, isSelected, onClick }: SearchResultItemProps) {
    const fromDisplay = Array.isArray(email.From) ? email.From[0] : email.From
    const toDisplay = Array.isArray(email.To) ? email.To.slice(0, 2).join(', ') : email.To

    return (
        <div
            onClick={onClick}
            className={cn(
                "px-4 py-3 cursor-pointer transition-colors border-b border-gray-100 dark:border-gray-700 last:border-b-0",
                isSelected
                    ? "bg-primary-50 dark:bg-primary-900/20"
                    : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
            )}
        >
            {/* 发件人和时间 */}
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white truncate flex-1 min-w-0">
                    <User className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                    <span className="truncate">
                        <HighlightText text={fromDisplay || '未知发件人'} keyword={keyword} />
                    </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
                    <Clock className="h-3 w-3" />
                    <span>{formatDate(email.Date)}</span>
                </div>
            </div>

            {/* 收件人 */}
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1.5 truncate">
                <Mail className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                    收件人: <HighlightText text={toDisplay || ''} keyword={keyword} />
                </span>
            </div>

            {/* 主题 */}
            <div className="text-sm text-gray-700 dark:text-gray-300 truncate">
                <HighlightText text={email.Subject || '(无主题)'} keyword={keyword} />
            </div>
        </div>
    )
}

export default function GlobalEmailSearch({ className }: GlobalEmailSearchProps) {
    const [searchQuery, setSearchQuery] = useState('')
    const [debouncedQuery, setDebouncedQuery] = useState('')
    const [isOpen, setIsOpen] = useState(false)
    const [results, setResults] = useState<Email[]>([])
    const [loading, setLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [selectedIndex, setSelectedIndex] = useState(-1)
    const [totalCount, setTotalCount] = useState(0)
    const [isHighlighted, setIsHighlighted] = useState(false) // 快捷键聚焦动画状态

    const containerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const offsetRef = useRef(0)

    const PAGE_SIZE = 20

    // 防抖处理
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(searchQuery)
        }, 200)

        return () => clearTimeout(timer)
    }, [searchQuery])

    // 搜索邮件
    const searchEmails = useCallback(async (query: string, append = false) => {
        if (!query.trim()) {
            setResults([])
            setTotalCount(0)
            setHasMore(false)
            offsetRef.current = 0
            return
        }

        try {
            if (append) {
                setLoadingMore(true)
            } else {
                setLoading(true)
                offsetRef.current = 0
            }

            const offset = append ? offsetRef.current + PAGE_SIZE : 0
            const response = await emailService.searchEmails({
                keyword: query,
                limit: PAGE_SIZE,
                offset: offset,
                sort_by: 'date_desc'
            })

            const emailList = Array.isArray(response) ? response : (response.emails || [])
            const pagination = (response as any).pagination || {}
            const total = pagination.total || emailList.length
            const moreAvailable = pagination.has_next || false

            if (append) {
                setResults(prev => [...prev, ...emailList])
            } else {
                setResults(emailList)
                setSelectedIndex(-1)
            }

            setTotalCount(total)
            setHasMore(moreAvailable)
            offsetRef.current = offset

        } catch (error) {
            console.error('搜索邮件失败:', error)
            if (!append) {
                setResults([])
                setTotalCount(0)
            }
        } finally {
            setLoading(false)
            setLoadingMore(false)
        }
    }, [])

    // 监听防抖后的查询变化
    useEffect(() => {
        if (debouncedQuery) {
            searchEmails(debouncedQuery)
            setIsOpen(true)
        } else {
            setResults([])
            setIsOpen(false)
        }
    }, [debouncedQuery, searchEmails])

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // 监听全局搜索聚焦事件（CMD+G 快捷键）
    useEffect(() => {
        const handleFocusSearch = () => {
            // 触发高亮动画
            setIsHighlighted(true)
            inputRef.current?.focus()

            // 动画结束后移除高亮状态
            setTimeout(() => {
                setIsHighlighted(false)
            }, 600)
        }

        window.addEventListener('focusGlobalSearch', handleFocusSearch)
        return () => window.removeEventListener('focusGlobalSearch', handleFocusSearch)
    }, [])

    // 处理滚动加载更多
    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const target = e.target as HTMLDivElement
        const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight

        if (scrollBottom < 50 && hasMore && !loadingMore && debouncedQuery) {
            searchEmails(debouncedQuery, true)
        }
    }, [hasMore, loadingMore, debouncedQuery, searchEmails])

    // 打开邮件到经典邮件管理器
    const openEmail = useCallback((email: Email) => {
        // 关闭搜索面板
        setIsOpen(false)
        setSearchQuery('')

        // 通过 switchTab 事件打开经典邮件管理器并传递定位信息
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: 'classic-mailbox',
                data: {
                    locateEmail: {
                        accountId: email.AccountID,
                        emailId: email.ID
                    }
                }
            }
        }))
    }, [])

    // 键盘导航
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!isOpen || results.length === 0) {
            // 当没有结果时，Escape 也应该关闭面板
            if (e.key === 'Escape') {
                setIsOpen(false)
                inputRef.current?.blur()
            }
            return
        }

        switch (e.key) {
            case 'ArrowDown':
            case 'Tab':
                if (!e.shiftKey) {
                    e.preventDefault()
                    setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
                    // 滚动到选中项
                    requestAnimationFrame(() => {
                        const selectedElement = listRef.current?.querySelector(`[data-index="${Math.min(selectedIndex + 1, results.length - 1)}"]`)
                        selectedElement?.scrollIntoView({ block: 'nearest' })
                    })
                } else {
                    // Shift+Tab 向上
                    e.preventDefault()
                    setSelectedIndex(prev => Math.max(prev - 1, 0))
                    requestAnimationFrame(() => {
                        const selectedElement = listRef.current?.querySelector(`[data-index="${Math.max(selectedIndex - 1, 0)}"]`)
                        selectedElement?.scrollIntoView({ block: 'nearest' })
                    })
                }
                break

            case 'ArrowUp':
                e.preventDefault()
                setSelectedIndex(prev => Math.max(prev - 1, 0))
                requestAnimationFrame(() => {
                    const selectedElement = listRef.current?.querySelector(`[data-index="${Math.max(selectedIndex - 1, 0)}"]`)
                    selectedElement?.scrollIntoView({ block: 'nearest' })
                })
                break

            case 'Enter':
                e.preventDefault()
                if (selectedIndex >= 0 && selectedIndex < results.length) {
                    openEmail(results[selectedIndex])
                }
                break

            case 'Escape':
                e.preventDefault()
                setIsOpen(false)
                inputRef.current?.blur()
                break
        }
    }, [isOpen, results, selectedIndex, openEmail])

    // 输入框聚焦时打开面板
    const handleFocus = useCallback(() => {
        if (searchQuery.trim() && results.length > 0) {
            setIsOpen(true)
        }
    }, [searchQuery, results.length])

    // 清空搜索
    const handleClear = useCallback(() => {
        setSearchQuery('')
        setResults([])
        setIsOpen(false)
        inputRef.current?.focus()
    }, [])

    return (
        <div ref={containerRef} className={cn("relative flex-1 max-w-lg", className)}>
            {/* 搜索输入框 */}
            <div className={cn(
                "relative transition-all duration-300",
                isHighlighted && "animate-pulse-once"
            )}>
                {/* 高亮发光效果 */}
                {isHighlighted && (
                    <div className="absolute -inset-1 bg-gradient-to-r from-primary-500 via-blue-500 to-primary-500 rounded-xl opacity-75 blur animate-glow" />
                )}
                <div className={cn(
                    "relative bg-background rounded-lg transition-all duration-300",
                    isHighlighted && "scale-[1.02]"
                )}>
                    <Search className={cn(
                        "absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transition-colors duration-300",
                        isHighlighted ? "text-primary-500" : "text-gray-400"
                    )} />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="搜索邮件..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={handleFocus}
                        onKeyDown={handleKeyDown}
                        className={cn(
                            "w-full rounded-lg border bg-background py-2 pl-10 pr-16 text-sm",
                            "placeholder-muted-foreground transition-all duration-300",
                            "focus:bg-background focus:outline-none",
                            "dark:text-gray-200",
                            isHighlighted
                                ? "border-primary-500 ring-4 ring-primary-500/30 shadow-lg shadow-primary-500/20"
                                : "border-input focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                        )}
                    />
                    {/* 快捷键提示 */}
                    {!searchQuery && !loading && (
                        <div className={cn(
                            "absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 text-[10px] pointer-events-none transition-all duration-300",
                            isHighlighted ? "text-primary-500 scale-110" : "text-gray-400"
                        )}>
                            <kbd className={cn(
                                "px-1 py-0.5 rounded border transition-all duration-300",
                                isHighlighted
                                    ? "bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700"
                                    : "bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                            )}>⌘</kbd>
                            <kbd className={cn(
                                "px-1 py-0.5 rounded border transition-all duration-300",
                                isHighlighted
                                    ? "bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700"
                                    : "bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                            )}>G</kbd>
                        </div>
                    )}
                    {/* 清空按钮 */}
                    {searchQuery && (
                        <button
                            onClick={handleClear}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors z-10"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                    {/* 加载指示器 */}
                    {loading && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10">
                            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                        </div>
                    )}
                </div>
            </div>

            {/* 搜索结果下拉面板 */}
            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
                    {/* 结果统计 */}
                    {totalCount > 0 && (
                        <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                            找到 {totalCount} 封邮件
                            {selectedIndex >= 0 && (
                                <span className="ml-2 text-primary-600 dark:text-primary-400">
                                    • 已选择第 {selectedIndex + 1} 项
                                </span>
                            )}
                        </div>
                    )}

                    {/* 结果列表 */}
                    <div
                        ref={listRef}
                        className="max-h-[400px] overflow-y-auto"
                        onScroll={handleScroll}
                    >
                        {results.length > 0 ? (
                            results.map((email, index) => (
                                <div key={email.ID} data-index={index}>
                                    <SearchResultItem
                                        email={email}
                                        keyword={debouncedQuery}
                                        isSelected={index === selectedIndex}
                                        onClick={() => openEmail(email)}
                                    />
                                </div>
                            ))
                        ) : !loading ? (
                            <div className="py-8 text-center text-gray-500 dark:text-gray-400">
                                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p>未找到匹配的邮件</p>
                            </div>
                        ) : null}

                        {/* 加载更多指示器 */}
                        {loadingMore && (
                            <div className="py-3 text-center">
                                <Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" />
                            </div>
                        )}
                    </div>

                    {/* 键盘提示 */}
                    {results.length > 0 && (
                        <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-3">
                            <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">↑↓</kbd> 导航</span>
                            <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">Enter</kbd> 打开</span>
                            <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px]">Esc</kbd> 关闭</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
