'use client'

import React, { useState } from 'react'
import {
    AlertTriangle,
    RefreshCw,
    Settings,
    Eye,
    EyeOff,
    Clock,
    Shield,
    Wifi,
    WifiOff
} from 'lucide-react'
import { cn } from '@/lib/utils'

// 账户错误状态类型
interface AccountError {
    errorStatus: string
    errorMessage: string
    errorTimestamp: string
    errorCount: number
    autoDisabledAt: string
}

// 账户信息接口
interface AccountWithError {
    id: number
    emailAddress: string
    isVerified: boolean
    errorStatus: string
    errorMessage: string
    errorTimestamp?: string
    errorCount: number
    autoDisabledAt?: string
}

// 账户错误状态组件属性
interface AccountErrorStatusProps {
    account: AccountWithError
    onReauthorize?: (accountId: number) => void
    onViewDetails?: (accountId: number) => void
    className?: string
}

// 获取错误状态的显示信息
function getErrorStatusInfo(status: string) {
    switch (status) {
        case 'oauth_expired':
            return {
                label: 'OAuth已过期',
                description: '需要重新授权访问邮箱',
                color: 'text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-900/30',
                icon: <Clock className="w-4 h-4" />,
                severity: 'warning',
                actionText: '重新授权'
            }
        case 'auth_revoked':
            return {
                label: '授权已撤销',
                description: '邮箱提供商撤销了访问权限',
                color: 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30',
                icon: <Shield className="w-4 h-4" />,
                severity: 'error',
                actionText: '重新授权'
            }
        case 'api_disabled':
            return {
                label: 'API已禁用',
                description: '邮箱API服务已被禁用',
                color: 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30',
                icon: <WifiOff className="w-4 h-4" />,
                severity: 'error',
                actionText: '检查配置'
            }
        case 'permission_denied':
            return {
                label: '邮件权限不足',
                description: '当前授权不包含读取邮件所需权限',
                color: 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30',
                icon: <Shield className="w-4 h-4" />,
                severity: 'error',
                actionText: '重新授权'
            }
        case 'quota_exceeded':
            return {
                label: '配额超限',
                description: 'API调用配额已超过限制',
                color: 'text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/30',
                icon: <AlertTriangle className="w-4 h-4" />,
                severity: 'warning',
                actionText: '检查配额'
            }
        case 'network_error':
            return {
                label: '网络错误',
                description: '网络连接异常',
                color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30',
                icon: <Wifi className="w-4 h-4" />,
                severity: 'info',
                actionText: '检查网络'
            }
        case 'server_error':
            return {
                label: '服务器错误',
                description: '邮件服务器响应异常',
                color: 'text-purple-600 bg-purple-100 dark:text-purple-400 dark:bg-purple-900/30',
                icon: <Settings className="w-4 h-4" />,
                severity: 'info',
                actionText: '稍后重试'
            }
        default:
            return {
                label: '正常',
                description: '账户状态正常',
                color: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30',
                icon: <RefreshCw className="w-4 h-4" />,
                severity: 'success',
                actionText: ''
            }
    }
}

// 单个账户错误状态组件
export default function AccountErrorStatus({
    account,
    onReauthorize,
    onViewDetails,
    className
}: AccountErrorStatusProps) {
    const [showDetails, setShowDetails] = useState(false)

    // 如果账户状态正常，不显示错误信息
    if (account.errorStatus === 'normal' || !account.errorStatus) {
        return null
    }

    const errorInfo = getErrorStatusInfo(account.errorStatus)

    const handleReauthorize = () => {
        if (onReauthorize) {
            onReauthorize(account.id)
        }
    }

    const handleViewDetails = () => {
        if (onViewDetails) {
            onViewDetails(account.id)
        }
    }

    return (
        <div className={cn(
            "border rounded-lg p-4 mb-4",
            errorInfo.color.includes('red') ? 'border-red-200 dark:border-red-800' :
                errorInfo.color.includes('orange') ? 'border-orange-200 dark:border-orange-800' :
                    errorInfo.color.includes('yellow') ? 'border-yellow-200 dark:border-yellow-800' :
                        'border-blue-200 dark:border-blue-800',
            className
        )}>
            {/* 错误状态头部 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    <div className={cn("p-2 rounded-full", errorInfo.color)}>
                        {errorInfo.icon}
                    </div>

                    <div>
                        <div className="flex items-center space-x-2">
                            <h4 className="font-medium text-gray-900 dark:text-gray-100">
                                {account.emailAddress}
                            </h4>
                            <span className={cn(
                                "px-2 py-1 text-xs font-medium rounded-full",
                                errorInfo.color
                            )}>
                                {errorInfo.label}
                            </span>
                        </div>

                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {errorInfo.description}
                        </p>

                        {account.autoDisabledAt && (
                            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                自动禁用时间: {new Date(account.autoDisabledAt).toLocaleString()}
                            </p>
                        )}
                    </div>
                </div>

                <div className="flex items-center space-x-2">
                    {errorInfo.actionText && (
                        <button
                            onClick={handleReauthorize}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors"
                        >
                            {errorInfo.actionText}
                        </button>
                    )}

                    <button
                        onClick={() => setShowDetails(!showDetails)}
                        className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                        {showDetails ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* 详细错误信息（可展开） */}
            {showDetails && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">错误次数</label>
                            <p className="text-sm text-gray-900 dark:text-gray-100">{account.errorCount} 次</p>
                        </div>

                        {account.errorTimestamp && (
                            <div>
                                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">最后错误时间</label>
                                <p className="text-sm text-gray-900 dark:text-gray-100">
                                    {new Date(account.errorTimestamp).toLocaleString()}
                                </p>
                            </div>
                        )}
                    </div>

                    {account.errorMessage && (
                        <div className="mt-3">
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">详细错误信息</label>
                            <div className="mt-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
                                <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto">
                                    {account.errorMessage}
                                </pre>
                            </div>
                        </div>
                    )}

                    <div className="mt-3 flex justify-end space-x-2">
                        <button
                            onClick={handleViewDetails}
                            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                            查看完整日志
                        </button>

                        <button
                            onClick={() => {
                                // 复制错误信息到剪贴板
                                navigator.clipboard.writeText(account.errorMessage)
                            }}
                            className="px-3 py-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
                        >
                            复制错误信息
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

// 账户错误状态列表组件
interface AccountErrorListProps {
    accounts: AccountWithError[]
    onReauthorize?: (accountId: number) => void
    onViewDetails?: (accountId: number) => void
    className?: string
}

export function AccountErrorList({
    accounts,
    onReauthorize,
    onViewDetails,
    className
}: AccountErrorListProps) {
    // 过滤出有错误的账户
    const errorAccounts = accounts.filter(account =>
        account.errorStatus && account.errorStatus !== 'normal'
    )

    if (errorAccounts.length === 0) {
        return (
            <div className={cn(
                "text-center py-8 text-gray-500 dark:text-gray-400",
                className
            )}>
                <RefreshCw className="w-8 h-8 mx-auto mb-2 text-green-500" />
                <p>所有账户状态正常</p>
            </div>
        )
    }

    return (
        <div className={className}>
            <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    账户异常状态
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    发现 {errorAccounts.length} 个账户需要处理
                </p>
            </div>

            {errorAccounts.map((account) => (
                <AccountErrorStatus
                    key={account.id}
                    account={account}
                    onReauthorize={onReauthorize}
                    onViewDetails={onViewDetails}
                />
            ))}
        </div>
    )
}

// 错误状态统计组件
interface ErrorStatusSummaryProps {
    accounts: AccountWithError[]
    className?: string
}

export function ErrorStatusSummary({ accounts, className }: ErrorStatusSummaryProps) {
    // 统计各种错误类型
    const errorStats = accounts.reduce((stats, account) => {
        if (account.errorStatus && account.errorStatus !== 'normal') {
            stats[account.errorStatus] = (stats[account.errorStatus] || 0) + 1
            stats.total++
        }
        return stats
    }, { total: 0 } as Record<string, number>)

    if (errorStats.total === 0) {
        return null
    }

    return (
        <div className={cn(
            "bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md",
            className
        )}>
            <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-3">错误状态摘要</h4>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(errorStats).map(([status, count]) => {
                    if (status === 'total') return null

                    const info = getErrorStatusInfo(status)
                    return (
                        <div key={status} className="text-center">
                            <div className={cn("p-2 rounded-full w-8 h-8 mx-auto mb-1", info.color)}>
                                {info.icon}
                            </div>
                            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{count}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">{info.label}</p>
                        </div>
                    )
                })}
            </div>

            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
                    总计 {errorStats.total} 个账户需要处理
                </p>
            </div>
        </div>
    )
}
