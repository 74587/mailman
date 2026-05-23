'use client'

import { useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import { MainLayout } from '@/components/layout/main-layout'
import {
    Mail, Users, Clock, TrendingUp, AlertCircle, CheckCircle, Activity,
    Send, Trash2, UserPlus, UserCheck, UserX, RefreshCw, Play, XCircle,
    Bell, BellOff, Cpu, FileText, LogIn, LogOut
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { emailAccountService } from '@/services/email-account.service'
import { emailService, EmailStatsResponse } from '@/services/email.service'
import { EmailAccount } from '@/types'
import { activityService, ActivityLog } from '@/services/activity.service'

// 图标映射
const iconMap = {
    Mail, Send, Trash2, UserPlus, UserCheck, UserX, CheckCircle, RefreshCw,
    Play, XCircle, Bell, BellOff, Cpu, FileText, LogIn, LogOut, Activity
}

// 计算相对时间
function getRelativeTime(dateStr: string | null | undefined): string {
    if (!dateStr) return '—'
    try {
        const date = new Date(dateStr)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMin = Math.floor(diffMs / 60000)
        if (diffMin < 1) return '刚刚'
        if (diffMin < 60) return `${diffMin}分钟前`
        const diffHour = Math.floor(diffMin / 60)
        if (diffHour < 24) return `${diffHour}小时前`
        const diffDay = Math.floor(diffHour / 24)
        return `${diffDay}天前`
    } catch {
        return '—'
    }
}

// 统计卡片组件
function StatCard({
    title,
    value,
    icon: Icon,
    trend,
    color = 'primary'
}: {
    title: string
    value: string | number
    icon: any
    trend?: string
    color?: 'primary' | 'success' | 'warning' | 'danger'
}) {
    const colorClasses = {
        primary: 'bg-primary-100 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400',
        success: 'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400',
        warning: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400',
        danger: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
    }

    return (
        <div className="card-hover rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
                    <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
                    {trend && (
                        <p className="mt-2 flex items-center text-sm text-green-600 dark:text-green-400">
                            <TrendingUp className="mr-1 h-4 w-4" />
                            {trend}
                        </p>
                    )}
                </div>
                <div className={cn('rounded-lg p-3', colorClasses[color])}>
                    <Icon className="h-6 w-6" />
                </div>
            </div>
        </div>
    )
}

// 账户状态组件
function AccountStatus({ account }: { account: EmailAccount }) {
    const statusColors = {
        active: 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400',
        inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400',
        error: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400',
    }

    return (
        <div className="flex items-center justify-between rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
            <div className="flex items-center space-x-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-semibold">
                    {account.emailAddress ? account.emailAddress.charAt(0).toUpperCase() : '?'}
                </div>
                <div>
                    <p className="font-medium text-gray-900 dark:text-white">{account.emailAddress || '未知邮箱'}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{account.mailProvider?.name || 'Unknown'}</p>
                </div>
            </div>
            <span className={cn('rounded-full px-3 py-1 text-xs font-medium', statusColors[account.status || 'inactive'])}>
                {account.status === 'active' ? '活跃' : account.status === 'error' ? '错误' : '未激活'}
            </span>
        </div>
    )
}

export default function DashboardPage() {
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [activities, setActivities] = useState<ActivityLog[]>([])
    const [loading, setLoading] = useState(true)
    const [todayEmails, setTodayEmails] = useState<number>(0)
    const [todayGrowthRate, setTodayGrowthRate] = useState<number>(0)
    const [lastSyncTime, setLastSyncTime] = useState<string>('—')

    useEffect(() => {
        loadAccounts()
        loadActivities()
        loadStats()
    }, [])

    const loadAccounts = async () => {
        try {
            const data = await emailAccountService.getAccounts()
            setAccounts(data)
            // Compute last sync time from accounts
            if (data.length > 0) {
                const syncTimes = data
                    .filter((a: EmailAccount) => a.lastSync)
                    .map((a: EmailAccount) => new Date(a.lastSync!).getTime())
                if (syncTimes.length > 0) {
                    const mostRecent = new Date(Math.max(...syncTimes)).toISOString()
                    setLastSyncTime(getRelativeTime(mostRecent))
                }
            }
        } catch (error) {
            console.error('Failed to load accounts:', error)
        } finally {
            setLoading(false)
        }
    }

    const loadStats = async () => {
        try {
            const stats: EmailStatsResponse = await emailService.getEmailStats()
            setTodayEmails(stats.todayEmails)
            setTodayGrowthRate(stats.todayGrowthRate)
        } catch (error) {
            console.error('Failed to load email stats:', error)
        }
    }

    const loadActivities = async () => {
        try {
            logger.debug('Loading activities...')
            const data = await activityService.getRecentActivities(5)
            logger.debug('Activities loaded:', data)
            setActivities(data)
        } catch (error) {
            console.error('Failed to load activities:', error)
            // 设置空数组以避免显示加载状态
            setActivities([])
        }
    }

    const activeAccounts = accounts.filter(a => a.status === 'active').length
    const todayTrend = todayGrowthRate !== 0
        ? `${todayGrowthRate >= 0 ? '+' : ''}${todayGrowthRate.toFixed(1)}%`
        : undefined

    return (
        <MainLayout>
            <div className="space-y-6">
                {/* 页面标题 */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">仪表板</h1>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        欢迎回来！这是您的邮箱管理系统概览
                    </p>
                </div>

                {/* 统计卡片 */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    <StatCard
                        title="邮箱账户"
                        value={accounts.length}
                        icon={Users}
                        color="primary"
                    />
                    <StatCard
                        title="活跃账户"
                        value={activeAccounts}
                        icon={CheckCircle}
                        color="success"
                    />
                    <StatCard
                        title="今日邮件"
                        value={todayEmails}
                        icon={Mail}
                        trend={todayTrend}
                        color="warning"
                    />
                    <StatCard
                        title="最后同步"
                        value={lastSyncTime}
                        icon={Clock}
                        color="primary"
                    />
                </div>

                {/* 账户列表和快速操作 */}
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* 账户状态 */}
                    <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
                        <div className="mb-4 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">账户状态</h2>
                            <button className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400">
                                查看全部
                            </button>
                        </div>
                        <div className="space-y-3">
                            {loading ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"></div>
                                </div>
                            ) : accounts.length > 0 ? (
                                accounts.slice(0, 5).map((account) => (
                                    <AccountStatus key={account.id} account={account} />
                                ))
                            ) : (
                                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                    暂无账户，请添加邮箱账户
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 快速操作 */}
                    <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
                        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">快速操作</h2>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <button className="flex items-center justify-center space-x-2 rounded-lg bg-primary-600 px-4 py-3 text-white transition-colors hover:bg-primary-700">
                                <Users className="h-5 w-5" />
                                <span>添加账户</span>
                            </button>
                            <button className="flex items-center justify-center space-x-2 rounded-lg bg-gray-100 px-4 py-3 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">
                                <Mail className="h-5 w-5" />
                                <span>同步邮件</span>
                            </button>
                        </div>

                        {/* 系统状态 */}
                        <div className="mt-6 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-600 dark:text-gray-400">系统状态</span>
                                <span className="flex items-center text-sm text-green-600 dark:text-green-400">
                                    <CheckCircle className="mr-1 h-4 w-4" />
                                    正常运行
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-gray-600 dark:text-gray-400">API连接</span>
                                <span className="flex items-center text-sm text-green-600 dark:text-green-400">
                                    <CheckCircle className="mr-1 h-4 w-4" />
                                    已连接
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 最近活动 */}
                <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
                    <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">最近活动</h2>
                    <div className="space-y-3">
                        {activities.length > 0 ? (
                            activities.map((activity) => {
                                const typeInfo = activityService.getActivityTypeInfo(activity.type)
                                const IconComponent = iconMap[typeInfo.icon as keyof typeof iconMap] || Activity

                                return (
                                    <div key={activity.id} className="flex items-start space-x-3">
                                        <div className={cn(
                                            "flex h-8 w-8 items-center justify-center rounded-full",
                                            typeInfo.color === 'blue' && "bg-blue-100 dark:bg-blue-900/20",
                                            typeInfo.color === 'green' && "bg-green-100 dark:bg-green-900/20",
                                            typeInfo.color === 'red' && "bg-red-100 dark:bg-red-900/20",
                                            typeInfo.color === 'purple' && "bg-purple-100 dark:bg-purple-900/20",
                                            typeInfo.color === 'gray' && "bg-gray-100 dark:bg-gray-900/20"
                                        )}>
                                            <IconComponent className={cn(
                                                "h-4 w-4",
                                                typeInfo.color === 'blue' && "text-blue-600 dark:text-blue-400",
                                                typeInfo.color === 'green' && "text-green-600 dark:text-green-400",
                                                typeInfo.color === 'red' && "text-red-600 dark:text-red-400",
                                                typeInfo.color === 'purple' && "text-purple-600 dark:text-purple-400",
                                                typeInfo.color === 'gray' && "text-gray-600 dark:text-gray-400"
                                            )} />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                                                {activity.title}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {activity.description} - {activityService.formatActivityTime(activity.created_at)}
                                            </p>
                                        </div>
                                    </div>
                                )
                            })
                        ) : (
                            <p className="text-sm text-gray-500 dark:text-gray-400">暂无活动记录</p>
                        )}
                    </div>
                </div>
            </div>
        </MainLayout>
    )
}
