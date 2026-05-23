'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    CheckCircle,
    XCircle,
    Clock,
    ChevronDown,
    ChevronRight,
    RefreshCw,
    Shield,
    Filter,
    Activity,
    Zap,
    Mail,
    X,
} from 'lucide-react'
import {
    InterceptorLog,
    InterceptorLogFilter,
    getInterceptorLogs,
    getInterceptorLogStats,
    InterceptorLogStats,
    getInterceptors,
    Interceptor,
} from '@/services/interceptor.service'
import { LogDetailViewer } from './log-detail-viewer'
import { toast } from 'sonner'

interface InterceptorLogsViewerProps {
    interceptorId?: number
    interceptorName?: string
}

// 按执行分组的日志结构
interface ExecutionGroup {
    key: string
    triggerId?: number
    emailId?: number
    timestamp: string
    logs: InterceptorLog[]
    success: boolean
}

export default function InterceptorLogsViewer({
    interceptorId,
    interceptorName,
}: InterceptorLogsViewerProps) {
    const [logs, setLogs] = useState<InterceptorLog[]>([])
    const [interceptors, setInterceptors] = useState<Interceptor[]>([])
    const [stats, setStats] = useState<InterceptorLogStats | null>(null)
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [pageSize] = useState(50)
    const [isLoading, setIsLoading] = useState(true)
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

    // 过滤条件
    const [selectedInterceptorId, setSelectedInterceptorId] = useState<number | undefined>(interceptorId)
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all')
    const [startDate, setStartDate] = useState<string>('')
    const [endDate, setEndDate] = useState<string>('')

    // 加载拦截器列表
    const loadInterceptors = useCallback(async () => {
        try {
            const list = await getInterceptors()
            setInterceptors(list)
        } catch (error) {
            console.error('Failed to load interceptors:', error)
        }
    }, [])

    // 加载日志
    const loadLogs = useCallback(async () => {
        try {
            setIsLoading(true)

            const filter: InterceptorLogFilter = {
                page,
                limit: pageSize,
            }

            if (selectedInterceptorId !== undefined) {
                filter.interceptor_id = selectedInterceptorId
            }

            if (statusFilter !== 'all') {
                filter.success = statusFilter === 'success'
            }

            if (startDate) {
                filter.start_date = new Date(startDate).toISOString()
            }

            if (endDate) {
                filter.end_date = new Date(endDate + 'T23:59:59').toISOString()
            }

            const [logsResponse, statsData] = await Promise.all([
                getInterceptorLogs(filter),
                getInterceptorLogStats({
                    interceptor_id: selectedInterceptorId,
                    start_date: startDate ? new Date(startDate).toISOString() : undefined,
                    end_date: endDate ? new Date(endDate + 'T23:59:59').toISOString() : undefined,
                }),
            ])

            setLogs(logsResponse.data || [])
            setTotal(logsResponse.total)
            setStats(statsData)
        } catch (error) {
            console.error('Failed to load logs:', error)
            toast.error('加载日志失败')
        } finally {
            setIsLoading(false)
        }
    }, [page, pageSize, selectedInterceptorId, statusFilter, startDate, endDate])

    useEffect(() => {
        loadInterceptors()
    }, [loadInterceptors])

    useEffect(() => {
        loadLogs()
    }, [loadLogs])

    // 将日志按执行分组
    const groupLogsByExecution = (logs: InterceptorLog[]): ExecutionGroup[] => {
        const groups = new Map<string, ExecutionGroup>()

        logs.forEach((log) => {
            // 使用 trigger_id + email_id + 时间(精确到分钟)作为分组key
            const timestamp = new Date(log.created_at)
            const timeKey = `${timestamp.getFullYear()}-${timestamp.getMonth()}-${timestamp.getDate()}-${timestamp.getHours()}-${timestamp.getMinutes()}`
            const key = `${log.trigger_id || 'none'}-${log.email_id || 'none'}-${timeKey}`

            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    triggerId: log.trigger_id,
                    emailId: log.email_id,
                    timestamp: log.created_at,
                    logs: [],
                    success: true,
                })
            }

            const group = groups.get(key)!
            group.logs.push(log)
            if (!log.success) {
                group.success = false
            }
        })

        // 按时间倒序排序
        return Array.from(groups.values()).sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )
    }

    // 切换分组展开/折叠
    const toggleGroup = (key: string) => {
        setExpandedGroups((prev) => ({
            ...prev,
            [key]: !prev[key],
        }))
    }

    // 格式化日期时间
    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString)
        return date.toLocaleString('zh-CN')
    }

    // 格式化执行时间（毫秒）
    const formatDuration = (ms: number) => {
        if (ms < 1000) {
            return `${ms}ms`
        }
        return `${(ms / 1000).toFixed(2)}s`
    }

    // 获取阶段颜色
    const getPhaseColor = (phase: string) => {
        switch (phase) {
            case 'before':
                return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400'
            case 'after':
                return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
            case 'around':
                return 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400'
            default:
                return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
        }
    }

    // 获取阶段文本
    const getPhaseText = (phase: string) => {
        switch (phase) {
            case 'before':
                return '前置'
            case 'after':
                return '后置'
            case 'around':
                return '环绕'
            default:
                return phase
        }
    }

    // 重置过滤器
    const resetFilters = () => {
        setSelectedInterceptorId(interceptorId)
        setStatusFilter('all')
        setStartDate('')
        setEndDate('')
        setPage(1)
    }

    // 关闭当前 Tab
    const handleClose = () => {
        const tabId = interceptorId ? `interceptor-logs-${interceptorId}` : 'interceptor-logs'
        window.dispatchEvent(new CustomEvent('closeTab', { detail: { tabId } }))
    }

    const executionGroups = groupLogsByExecution(logs)

    return (
        <div className="h-full flex flex-col">
            {/* 固定头部 */}
            <div className="flex-shrink-0 p-6 pb-0 space-y-6">
                {/* 页面标题 */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                            <Shield className="w-6 h-6 text-violet-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">
                                {interceptorName ? `${interceptorName} - 执行日志` : '拦截器执行日志'}
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                查看拦截器的执行记录和详细信息
                            </p>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={handleClose}>
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* 统计卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-500/10">
                                    <Activity className="w-5 h-5 text-blue-500" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm text-muted-foreground">总执行次数</span>
                                    <span className="text-2xl font-bold">
                                        {isLoading ? '-' : stats?.total ?? 0}
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-green-500/10">
                                    <CheckCircle className="w-5 h-5 text-green-500" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm text-muted-foreground">成功次数</span>
                                    <span className="text-2xl font-bold text-green-600">
                                        {isLoading ? '-' : stats?.success ?? 0}
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-red-500/10">
                                    <XCircle className="w-5 h-5 text-red-500" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm text-muted-foreground">失败次数</span>
                                    <span className="text-2xl font-bold text-red-600">
                                        {isLoading ? '-' : stats?.failed ?? 0}
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-purple-500/10">
                                    <Clock className="w-5 h-5 text-purple-500" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm text-muted-foreground">平均执行时间</span>
                                    <span className="text-2xl font-bold text-purple-600">
                                        {isLoading ? '-' : formatDuration(stats?.average_duration_ms ?? 0)}
                                    </span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* 过滤器 */}
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-4">
                            <Filter className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium">过滤条件</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {!interceptorId && (
                                <div>
                                    <Label htmlFor="interceptorFilter">拦截器</Label>
                                    <select
                                        id="interceptorFilter"
                                        className="w-full p-2 border rounded mt-1 bg-background"
                                        value={selectedInterceptorId ?? ''}
                                        onChange={(e) => {
                                            setSelectedInterceptorId(e.target.value ? parseInt(e.target.value) : undefined)
                                            setPage(1)
                                        }}
                                    >
                                        <option value="">全部拦截器</option>
                                        {interceptors.map((i) => (
                                            <option key={i.id} value={i.id}>
                                                {i.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <Label htmlFor="statusFilter">状态</Label>
                                <select
                                    id="statusFilter"
                                    className="w-full p-2 border rounded mt-1 bg-background"
                                    value={statusFilter}
                                    onChange={(e) => {
                                        setStatusFilter(e.target.value as 'all' | 'success' | 'failed')
                                        setPage(1)
                                    }}
                                >
                                    <option value="all">所有状态</option>
                                    <option value="success">成功</option>
                                    <option value="failed">失败</option>
                                </select>
                            </div>

                            <div>
                                <Label htmlFor="startDate">开始日期</Label>
                                <Input
                                    id="startDate"
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => {
                                        setStartDate(e.target.value)
                                        setPage(1)
                                    }}
                                    className="mt-1"
                                />
                            </div>

                            <div>
                                <Label htmlFor="endDate">结束日期</Label>
                                <Input
                                    id="endDate"
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => {
                                        setEndDate(e.target.value)
                                        setPage(1)
                                    }}
                                    className="mt-1"
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-2 mt-4">
                            <Button type="button" onClick={resetFilters} variant="outline" size="sm">
                                重置
                            </Button>
                            <Button type="button" onClick={() => loadLogs()} size="sm">
                                <RefreshCw className="h-4 w-4 mr-2" />
                                刷新
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* 可滚动的日志列表区域 */}
            <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-3">
                {isLoading ? (
                    <Card>
                        <CardContent className="p-12 text-center">
                            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto"></div>
                            <p className="mt-4 text-muted-foreground">加载中...</p>
                        </CardContent>
                    </Card>
                ) : executionGroups.length > 0 ? (
                    <>
                        {executionGroups.map((group) => (
                            <Card key={group.key} className="overflow-hidden">
                                {/* 分组头部 */}
                                <div
                                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                                    onClick={() => toggleGroup(group.key)}
                                >
                                    <div className="flex items-center gap-3">
                                        {expandedGroups[group.key] ? (
                                            <ChevronDown className="w-5 h-5 text-muted-foreground" />
                                        ) : (
                                            <ChevronRight className="w-5 h-5 text-muted-foreground" />
                                        )}

                                        {group.success ? (
                                            <CheckCircle className="w-5 h-5 text-green-500" />
                                        ) : (
                                            <XCircle className="w-5 h-5 text-red-500" />
                                        )}

                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">
                                                执行记录 - {formatDateTime(group.timestamp)}
                                            </span>
                                            <Badge variant="outline" className="text-xs">
                                                {group.logs.length} 条日志
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                        {group.triggerId && (
                                            <div className="flex items-center gap-1">
                                                <Zap className="w-4 h-4" />
                                                <span>触发器 #{group.triggerId}</span>
                                            </div>
                                        )}
                                        {group.emailId && (
                                            <div className="flex items-center gap-1">
                                                <Mail className="w-4 h-4" />
                                                <span>邮件 #{group.emailId}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* 展开的日志详情 */}
                                {expandedGroups[group.key] && (
                                    <div className="border-t">
                                        <div className="p-4 space-y-3">
                                            {group.logs.map((log, index) => (
                                                <div
                                                    key={log.id}
                                                    className={`flex items-start gap-4 p-3 rounded-lg ${log.success
                                                            ? 'bg-green-50 dark:bg-green-900/10'
                                                            : 'bg-red-50 dark:bg-red-900/10'
                                                        }`}
                                                >
                                                    {/* 连接线和序号 */}
                                                    <div className="flex flex-col items-center">
                                                        <div className="w-8 h-8 rounded-full bg-background border-2 flex items-center justify-center text-xs font-medium">
                                                            {index + 1}
                                                        </div>
                                                        {index < group.logs.length - 1 && (
                                                            <div className="w-0.5 h-8 bg-border mt-1" />
                                                        )}
                                                    </div>

                                                    {/* 日志内容 */}
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            {log.success ? (
                                                                <CheckCircle className="w-4 h-4 text-green-500" />
                                                            ) : (
                                                                <XCircle className="w-4 h-4 text-red-500" />
                                                            )}
                                                            <span className="font-medium">
                                                                {log.interceptor_name}
                                                            </span>
                                                            <Badge className={getPhaseColor(log.phase)}>
                                                                {getPhaseText(log.phase)}
                                                            </Badge>
                                                            <span className="text-xs text-muted-foreground">
                                                                {formatDuration(log.duration)}
                                                            </span>
                                                        </div>

                                                        {/* 使用日志详情查看器 */}
                                                        <LogDetailViewer log={log} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </Card>
                        ))}

                        {/* 分页 */}
                        {total > 0 && (
                            <div className="flex justify-between items-center pt-4">
                                <div className="flex items-center gap-4">
                                    <div className="text-sm text-muted-foreground">
                                        共 {total} 条记录，当前第 {page} / {Math.ceil(total / pageSize)} 页
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={page <= 1}
                                            onClick={() => setPage(page - 1)}
                                        >
                                            上一页
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={page >= Math.ceil(total / pageSize)}
                                            onClick={() => setPage(page + 1)}
                                        >
                                            下一页
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <Card>
                        <CardContent className="p-12 text-center">
                            <Shield className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
                            <h3 className="text-lg font-medium mb-2">未找到执行日志</h3>
                            <p className="text-muted-foreground mb-4">
                                尝试调整过滤条件或等待拦截器执行
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    )
}
