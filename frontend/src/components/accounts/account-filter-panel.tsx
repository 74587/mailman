'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Filter, X, Search, RefreshCw, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AccountFilterParams } from '@/types'

interface MailProvider {
    id: number
    name: string
    type: string
}

interface AccountFilterPanelProps {
    filters: AccountFilterParams
    onSearch: (filters: AccountFilterParams) => void
    providers: MailProvider[]
    className?: string
}

// 错误状态选项
const ERROR_STATUS_OPTIONS = [
    { value: '', label: '全部' },
    { value: 'normal', label: '正常' },
    { value: 'oauth_expired', label: '授权过期' },
    { value: 'auth_revoked', label: '授权撤销' },
    { value: 'api_disabled', label: 'API禁用' },
    { value: 'network_error', label: '网络错误' },
]

export function AccountFilterPanel({
    filters: initialFilters,
    onSearch,
    providers,
    className,
}: AccountFilterPanelProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [localFilters, setLocalFilters] = useState<AccountFilterParams>(initialFilters)
    const panelRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    // 计算激活的过滤器数量
    const activeFilterCount = [
        localFilters.provider_id,
        localFilters.is_verified !== undefined,
        localFilters.error_status,
        localFilters.created_after,
        localFilters.created_before,
        localFilters.last_sync_after,
        localFilters.last_sync_before,
    ].filter(Boolean).length

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                panelRef.current &&
                !panelRef.current.contains(event.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const updateFilter = <K extends keyof AccountFilterParams>(key: K, value: AccountFilterParams[K]) => {
        setLocalFilters(prev => ({
            ...prev,
            [key]: value,
        }))
    }

    const handleSearch = () => {
        onSearch(localFilters)
        setIsOpen(false)
    }

    const handleReset = () => {
        const resetFilters: AccountFilterParams = {}
        setLocalFilters(resetFilters)
        onSearch(resetFilters)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch()
        }
        if (e.key === 'Escape') {
            setIsOpen(false)
        }
    }

    // 样式
    const selectClass = "w-full h-9 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
    const inputClass = "w-full h-9 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
    const labelClass = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5"

    return (
        <div className={cn('relative', className)}>
            {/* 触发按钮 */}
            <button
                ref={buttonRef}
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    'inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all',
                    isOpen || activeFilterCount > 0
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400 dark:border-primary-500'
                        : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                )}
            >
                <Filter className="h-4 w-4" />
                <span>筛选</span>
                {activeFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-xs font-bold rounded-full bg-primary-500 text-white">
                        {activeFilterCount}
                    </span>
                )}
                <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
            </button>

            {/* 浮动面板 */}
            {isOpen && (
                <div
                    ref={panelRef}
                    className="absolute right-0 top-full mt-2 z-50 w-[480px] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl"
                    onKeyDown={handleKeyDown}
                >
                    {/* 头部 */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">高级筛选</h3>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {/* 内容 */}
                    <div className="p-4 space-y-4">
                        {/* 第一行 */}
                        <div className="grid grid-cols-2 gap-4">
                            {/* 供应商 */}
                            <div>
                                <label className={labelClass}>邮件供应商</label>
                                <select
                                    value={localFilters.provider_id ?? ''}
                                    onChange={(e) => updateFilter('provider_id', e.target.value ? parseInt(e.target.value) : undefined)}
                                    className={selectClass}
                                >
                                    <option value="">全部供应商</option>
                                    {providers.map((provider) => (
                                        <option key={provider.id} value={provider.id}>
                                            {provider.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* 验证状态 */}
                            <div>
                                <label className={labelClass}>验证状态</label>
                                <select
                                    value={localFilters.is_verified === undefined ? '' : String(localFilters.is_verified)}
                                    onChange={(e) => {
                                        const val = e.target.value
                                        updateFilter('is_verified', val === '' ? undefined : val === 'true')
                                    }}
                                    className={selectClass}
                                >
                                    <option value="">全部</option>
                                    <option value="true">已验证</option>
                                    <option value="false">未验证</option>
                                </select>
                            </div>
                        </div>

                        {/* 第二行 */}
                        <div className="grid grid-cols-2 gap-4">
                            {/* 账户状态 */}
                            <div>
                                <label className={labelClass}>账户状态</label>
                                <select
                                    value={localFilters.error_status ?? ''}
                                    onChange={(e) => updateFilter('error_status', e.target.value || undefined)}
                                    className={selectClass}
                                >
                                    {ERROR_STATUS_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div></div>
                        </div>

                        {/* 分隔线 */}
                        <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">时间范围</p>

                            {/* 创建时间 */}
                            <div className="grid grid-cols-2 gap-4 mb-3">
                                <div>
                                    <label className={labelClass}>创建时间起</label>
                                    <input
                                        type="date"
                                        value={localFilters.created_after ? localFilters.created_after.split('T')[0] : ''}
                                        onChange={(e) => updateFilter('created_after', e.target.value ? `${e.target.value}T00:00:00Z` : undefined)}
                                        className={inputClass}
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>创建时间止</label>
                                    <input
                                        type="date"
                                        value={localFilters.created_before ? localFilters.created_before.split('T')[0] : ''}
                                        onChange={(e) => updateFilter('created_before', e.target.value ? `${e.target.value}T23:59:59Z` : undefined)}
                                        className={inputClass}
                                    />
                                </div>
                            </div>

                            {/* 同步时间 */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={labelClass}>最后同步起</label>
                                    <input
                                        type="date"
                                        value={localFilters.last_sync_after ? localFilters.last_sync_after.split('T')[0] : ''}
                                        onChange={(e) => updateFilter('last_sync_after', e.target.value ? `${e.target.value}T00:00:00Z` : undefined)}
                                        className={inputClass}
                                    />
                                </div>
                                <div>
                                    <label className={labelClass}>最后同步止</label>
                                    <input
                                        type="date"
                                        value={localFilters.last_sync_before ? localFilters.last_sync_before.split('T')[0] : ''}
                                        onChange={(e) => updateFilter('last_sync_before', e.target.value ? `${e.target.value}T23:59:59Z` : undefined)}
                                        className={inputClass}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 底部操作 */}
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
                        <button
                            onClick={handleReset}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                            重置
                        </button>
                        <button
                            onClick={handleSearch}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-medium transition-colors"
                        >
                            <Search className="h-4 w-4" />
                            应用筛选
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
