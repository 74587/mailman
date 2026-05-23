'use client'
import { logger } from '@/lib/logger';

import { useEffect, useState, useCallback } from 'react'
import { Mail, Users, Activity, TrendingUp, Calendar, Clock, CheckCircle, AlertCircle, UserPlus, RefreshCw, Send, Trash2, UserCheck, UserX, Play, XCircle, Bell, BellOff, Cpu, FileText, LogIn, LogOut, Settings, Zap, ChevronRight } from 'lucide-react'
import { emailAccountService } from '@/services/email-account.service'
import { emailService, EmailStatsResponse } from '@/services/email.service'
import { activityService, ActivityLog } from '@/services/activity.service'
import { formatDate } from '@/lib/utils'
import { useAuth } from '@/context/auth-context'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'
import { toast } from 'sonner'

// 图标映射
const iconMap: Record<string, any> = {
    Mail,
    Send,
    Trash2,
    UserPlus,
    UserCheck,
    UserX,
    CheckCircle,
    RefreshCw,
    Play,
    XCircle,
    Bell,
    BellOff,
    Cpu,
    FileText,
    LogIn,
    LogOut,
    Settings,
    Activity,
    AlertCircle
}

// 统计卡片组件 - 精致现代设计
function StatCard({
    title,
    value,
    icon: Icon,
    trend,
    trendValue,
    color = 'primary'
}: {
    title: string
    value: string | number
    icon: any
    trend?: 'up' | 'down'
    trendValue?: string
    color?: 'primary' | 'success' | 'warning' | 'danger'
}) {
    const colorConfig = {
        primary: {
            gradient: 'from-blue-500 to-indigo-600',
            lightGradient: 'from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20',
            iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-600',
            ring: 'ring-blue-500/20',
            text: 'text-blue-600 dark:text-blue-400'
        },
        success: {
            gradient: 'from-emerald-500 to-green-600',
            lightGradient: 'from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20',
            iconBg: 'bg-gradient-to-br from-emerald-500 to-green-600',
            ring: 'ring-emerald-500/20',
            text: 'text-emerald-600 dark:text-emerald-400'
        },
        warning: {
            gradient: 'from-amber-500 to-orange-600',
            lightGradient: 'from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20',
            iconBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
            ring: 'ring-amber-500/20',
            text: 'text-amber-600 dark:text-amber-400'
        },
        danger: {
            gradient: 'from-rose-500 to-red-600',
            lightGradient: 'from-rose-50 to-red-50 dark:from-rose-900/20 dark:to-red-900/20',
            iconBg: 'bg-gradient-to-br from-rose-500 to-red-600',
            ring: 'ring-rose-500/20',
            text: 'text-rose-600 dark:text-rose-400'
        }
    }

    const config = colorConfig[color]

    return (
        <div className={`
            relative overflow-hidden rounded-2xl 
            bg-white dark:bg-gray-800/80
            border border-gray-100 dark:border-gray-700/50
            shadow-sm hover:shadow-lg
            transition-all duration-300 ease-out
            hover:-translate-y-1
            group
        `}>
            {/* 顶部渐变装饰条 */}
            <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${config.gradient}`} />

            {/* 背景装饰 */}
            <div className={`absolute -right-8 -top-8 w-32 h-32 rounded-full bg-gradient-to-br ${config.lightGradient} opacity-60 blur-2xl group-hover:opacity-80 transition-opacity`} />

            <div className="relative p-5">
                <div className="flex items-start justify-between">
                    <div className="space-y-3">
                        <p className="text-[13px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                            {title}
                        </p>
                        <div className="flex items-baseline gap-2">
                            <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
                                {typeof value === 'number' ? value.toLocaleString() : value}
                            </p>
                            {trend && trendValue && (
                                <span className={`
                                    flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full
                                    ${trend === 'up'
                                        ? 'text-emerald-700 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-900/30'
                                        : 'text-rose-700 bg-rose-100 dark:text-rose-400 dark:bg-rose-900/30'
                                    }
                                `}>
                                    <TrendingUp className={`h-3 w-3 ${trend === 'down' ? 'rotate-180' : ''}`} />
                                    {trendValue}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* 图标容器 - 使用渐变和阴影 */}
                    <div className={`
                        ${config.iconBg} 
                        p-3 rounded-xl 
                        shadow-lg ${config.ring} ring-4
                        group-hover:scale-110 transition-transform duration-300
                    `}>
                        <Icon className="h-5 w-5 text-white" />
                    </div>
                </div>
            </div>
        </div>
    )
}

// 最近活动项组件 - 精致设计
function ActivityItem({
    icon: Icon,
    title,
    description,
    time,
    color = 'gray'
}: {
    icon: any
    title: string
    description: string
    time: string
    color?: string
}) {
    const colorClasses: Record<string, { bg: string, icon: string, dot: string }> = {
        gray: {
            bg: 'bg-gray-50 dark:bg-gray-700/50',
            icon: 'text-gray-500 dark:text-gray-400',
            dot: 'bg-gray-400'
        },
        green: {
            bg: 'bg-emerald-50 dark:bg-emerald-900/20',
            icon: 'text-emerald-600 dark:text-emerald-400',
            dot: 'bg-emerald-500'
        },
        blue: {
            bg: 'bg-blue-50 dark:bg-blue-900/20',
            icon: 'text-blue-600 dark:text-blue-400',
            dot: 'bg-blue-500'
        },
        red: {
            bg: 'bg-rose-50 dark:bg-rose-900/20',
            icon: 'text-rose-600 dark:text-rose-400',
            dot: 'bg-rose-500'
        },
        purple: {
            bg: 'bg-violet-50 dark:bg-violet-900/20',
            icon: 'text-violet-600 dark:text-violet-400',
            dot: 'bg-violet-500'
        }
    }

    const config = colorClasses[color] || colorClasses.gray

    return (
        <div className="group flex items-start gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-default">
            {/* 图标容器 */}
            <div className={`relative ${config.bg} rounded-lg p-2 ring-1 ring-inset ring-gray-900/5 dark:ring-white/10`}>
                <Icon className={`h-4 w-4 ${config.icon}`} />
                {/* 状态指示点 */}
                <div className={`absolute -top-0.5 -right-0.5 w-2 h-2 ${config.dot} rounded-full ring-2 ring-white dark:ring-gray-800`} />
            </div>

            {/* 内容区域 */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {title}
                    </p>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                        {time}
                    </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                    {description}
                </p>
            </div>
        </div>
    )
}

export default function DashboardTab() {
    const [loading, setLoading] = useState(true)
    const [stats, setStats] = useState({
        // 账户统计
        totalAccounts: 0,
        verifiedAccounts: 0,
        syncingAccounts: 0,
        errorAccounts: 0,
        // 邮件统计
        totalEmails: 0,
        unreadEmails: 0,
        todayEmails: 0,
        totalGrowthRate: 0,
        todayGrowthRate: 0,
        // 触发器统计
        totalTriggers: 0,
        enabledTriggers: 0,
        lastSyncTime: null as string | null
    })
    const [recentActivities, setRecentActivities] = useState<any[]>([])
    const { isAuthenticated, user } = useAuth()

    const loadDashboardData = useCallback(async () => {
        try {
            setLoading(true)

            // 加载统计数据（使用真实的API）
            let emailStats: EmailStatsResponse = {
                totalAccounts: 0,
                verifiedAccounts: 0,
                syncingAccounts: 0,
                errorAccounts: 0,
                totalEmails: 0,
                unreadEmails: 0,
                todayEmails: 0,
                totalGrowthRate: 0,
                todayGrowthRate: 0,
                totalTriggers: 0,
                enabledTriggers: 0
            }

            try {
                emailStats = await emailService.getEmailStats()
                logger.debug('[DashboardTab] 统计数据:', emailStats)
            } catch (error) {
                console.warn('[DashboardTab] 获取统计数据失败，使用默认值:', error)
            }

            // 获取最后同步时间
            let lastSyncTime = null
            try {
                const accounts = await emailAccountService.getAccounts()
                if (accounts.length > 0 && accounts[0].lastSync) {
                    lastSyncTime = formatDate(accounts[0].lastSync)
                }
            } catch (error) {
                console.warn('[DashboardTab] 获取账户列表失败:', error)
            }

            setStats({
                totalAccounts: emailStats.totalAccounts,
                verifiedAccounts: emailStats.verifiedAccounts,
                syncingAccounts: emailStats.syncingAccounts,
                errorAccounts: emailStats.errorAccounts,
                totalEmails: emailStats.totalEmails,
                unreadEmails: emailStats.unreadEmails,
                todayEmails: emailStats.todayEmails,
                totalGrowthRate: emailStats.totalGrowthRate,
                todayGrowthRate: emailStats.todayGrowthRate,
                totalTriggers: emailStats.totalTriggers,
                enabledTriggers: emailStats.enabledTriggers,
                lastSyncTime: lastSyncTime
            })

            // 获取真实的活动数据
            try {
                logger.debug('[DashboardTab] 开始获取活动数据...')
                const activities = await activityService.getRecentActivities(5, false)
                logger.debug('[DashboardTab] API 返回的活动数据:', activities)

                if (activities && activities.length > 0) {
                    // 转换活动数据为显示格式
                    const formattedActivities = activities.map((activity: ActivityLog) => {
                        const typeInfo = activityService.getActivityTypeInfo(activity.type)
                        const IconComponent = iconMap[typeInfo.icon] || Activity

                        return {
                            icon: IconComponent,
                            title: typeInfo.label,
                            description: activity.description || activity.title,
                            time: activityService.formatActivityTime(activity.created_at),
                            color: typeInfo.color
                        }
                    })

                    logger.debug('[DashboardTab] 格式化后的活动数据:', formattedActivities)
                    setRecentActivities(formattedActivities)
                    logger.debug('[DashboardTab] 已设置 recentActivities 状态')
                } else {
                    // 没有活动数据时，设置为空数组
                    logger.debug('[DashboardTab] 没有活动数据，设置为空数组')
                    setRecentActivities([])
                }
            } catch (error: any) {
                console.error('获取活动数据失败:', error)

                // 如果是认证错误，显示提示
                if (error.response?.status === 401) {
                    toast.error('请先登录以查看活动记录')
                }

                // 设置为空数组，不显示模拟数据
                setRecentActivities([])
            }
        } catch (error) {
            console.error('加载仪表板数据失败:', error)
            toast.error('加载数据失败，请刷新重试')
        } finally {
            setLoading(false)
        }
    }, [isAuthenticated])

    // 初始加载数据
    useEffect(() => {
        loadDashboardData()
    }, [loadDashboardData])

    // 注册刷新回调
    useEffect(() => {
        registerRefreshCallback('dashboard', () => {
            logger.debug('[DashboardTab] 收到刷新请求，重新加载数据...')
            toast.success('正在刷新仪表板...')
            loadDashboardData()
        })

        return () => {
            unregisterRefreshCallback('dashboard')
        }
    }, [loadDashboardData])

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center">
                    <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"></div>
                    <p className="text-gray-600 dark:text-gray-400">加载中...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">仪表板</h2>
                {stats.lastSyncTime && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        最后同步: {stats.lastSyncTime}
                    </p>
                )}
            </div>

            {/* 统计卡片 - 第一行：账户统计 */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="邮箱账户"
                    value={stats.totalAccounts}
                    icon={Users}
                    color="primary"
                />
                <StatCard
                    title="已验证有效"
                    value={stats.verifiedAccounts}
                    icon={CheckCircle}
                    color="success"
                />
                <StatCard
                    title="周期同步中"
                    value={stats.syncingAccounts}
                    icon={Activity}
                    color="primary"
                />
                <StatCard
                    title="异常账户"
                    value={stats.errorAccounts}
                    icon={AlertCircle}
                    color="danger"
                />
            </div>

            {/* 统计卡片 - 第二行：邮件和触发器统计 */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="总邮件数"
                    value={stats.totalEmails}
                    icon={Mail}
                    trend={stats.totalGrowthRate >= 0 ? "up" : "down"}
                    trendValue={`${stats.totalGrowthRate >= 0 ? '+' : ''}${stats.totalGrowthRate.toFixed(1)}%`}
                    color="primary"
                />
                <StatCard
                    title="今日邮件"
                    value={stats.todayEmails}
                    icon={Calendar}
                    trend={stats.todayGrowthRate >= 0 ? "up" : "down"}
                    trendValue={`${stats.todayGrowthRate >= 0 ? '+' : ''}${stats.todayGrowthRate.toFixed(1)}%`}
                    color="success"
                />
                <StatCard
                    title="触发器规则"
                    value={stats.totalTriggers}
                    icon={Zap}
                    color="warning"
                />
                <StatCard
                    title="已启用触发器"
                    value={stats.enabledTriggers}
                    icon={Zap}
                    color="success"
                />
            </div>

            {/* 最近活动和快速操作 */}
            <div className="grid gap-6 lg:grid-cols-2">
                {/* 最近活动 */}
                <div className="rounded-2xl bg-white dark:bg-gray-800/80 border border-gray-100 dark:border-gray-700/50 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-violet-100 dark:bg-violet-900/30">
                                <Clock className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                            </div>
                            <h3 className="font-semibold text-gray-900 dark:text-white">最近活动</h3>
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500">实时更新</span>
                    </div>
                    <div className="p-3">
                        {(() => {
                            logger.debug('[DashboardTab Render] recentActivities.length:', recentActivities.length)
                            logger.debug('[DashboardTab Render] recentActivities:', recentActivities)
                            return null
                        })()}
                        {recentActivities.length > 0 ? (
                            <div className="space-y-1">
                                {recentActivities.map((activity, index) => (
                                    <ActivityItem key={index} {...activity} />
                                ))}
                            </div>
                        ) : (
                            <div className="py-10 text-center">
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700/50 mb-3">
                                    <Activity className="h-6 w-6 text-gray-400 dark:text-gray-500" />
                                </div>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    暂无活动记录
                                </p>
                                {!isAuthenticated && (
                                    <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                                        登录后可查看活动记录
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* 快速操作 */}
                <div className="rounded-2xl bg-white dark:bg-gray-800/80 border border-gray-100 dark:border-gray-700/50 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/50 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                            <Zap className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">快速操作</h3>
                    </div>
                    <div className="p-4 space-y-2">
                        <button
                            onClick={() => {
                                window.dispatchEvent(new CustomEvent('switchTab', {
                                    detail: { tab: 'accounts' }
                                }))
                            }}
                            className="w-full flex items-center justify-between p-3.5 rounded-xl border border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-700/30 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-800 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 group-hover:bg-blue-200 dark:group-hover:bg-blue-900/60 transition-colors">
                                    <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div className="text-left">
                                    <span className="font-medium text-gray-900 dark:text-white text-sm">管理邮箱账户</span>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">添加、编辑或删除邮箱账户</p>
                                </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" />
                        </button>

                        <button
                            onClick={() => {
                                window.dispatchEvent(new CustomEvent('switchTab', {
                                    detail: { tab: 'classic-mailbox' }
                                }))
                            }}
                            className="w-full flex items-center justify-between p-3.5 rounded-xl border border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-700/30 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-200 dark:hover:border-emerald-800 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/60 transition-colors">
                                    <Mail className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div className="text-left">
                                    <span className="font-medium text-gray-900 dark:text-white text-sm">经典邮件管理器</span>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">浏览和管理所有邮件</p>
                                </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all" />
                        </button>

                        <button
                            onClick={() => {
                                window.dispatchEvent(new CustomEvent('switchTab', {
                                    detail: { tab: 'system-config' }
                                }))
                            }}
                            className="w-full flex items-center justify-between p-3.5 rounded-xl border border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-700/30 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-200 dark:hover:border-amber-800 transition-all group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40 group-hover:bg-amber-200 dark:group-hover:bg-amber-900/60 transition-colors">
                                    <Settings className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                </div>
                                <div className="text-left">
                                    <span className="font-medium text-gray-900 dark:text-white text-sm">系统配置</span>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">配置系统参数和选项</p>
                                </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-amber-500 group-hover:translate-x-1 transition-all" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
