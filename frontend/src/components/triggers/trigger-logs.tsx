'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Search,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Download,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertCircle,
  GitBranch
} from 'lucide-react'
import { triggerService } from '@/services/trigger.service'
import { ExecutionTimeline } from './execution-timeline'
import { TriggerErrorDiagnosticsDialog } from './trigger-error-diagnostics-dialog'
import { TriggerExecutionLog, PaginationParams, TriggerExecutionStatus } from '@/types'
import { toast } from 'sonner'

interface TriggerLogsProps {
  triggerId?: number
  limit?: number
  showFilters?: boolean
  showPagination?: boolean
  showExport?: boolean
  onViewDetails?: (log: TriggerExecutionLog) => void
}

export function TriggerLogs({
  triggerId,
  limit = 10,
  showFilters = true,
  showPagination = true,
  showExport = true,
  onViewDetails
}: TriggerLogsProps) {
  const [logs, setLogs] = useState<TriggerExecutionLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(limit)
  const [isLoading, setIsLoading] = useState(true)
  const [expandedLogs, setExpandedLogs] = useState<Record<number, boolean>>({})
  const [diagnosticLog, setDiagnosticLog] = useState<TriggerExecutionLog | null>(null)
  const [diagnosticError, setDiagnosticError] = useState<string | undefined>()

  // 过滤条件
  const [statusFilter, setStatusFilter] = useState<TriggerExecutionStatus | 'all'>('all')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  // 加载日志
  useEffect(() => {
    loadLogs()
  }, [triggerId, page, pageSize, statusFilter, startDate, endDate])

  const loadLogs = async () => {
    try {
      setIsLoading(true)

      const params: PaginationParams & {
        status?: string
        start_date?: string
        end_date?: string
      } = {
        page,
        limit: pageSize
      }

      if (statusFilter !== 'all') {
        params.status = statusFilter
      }

      if (startDate) {
        params.start_date = startDate
      }

      if (endDate) {
        params.end_date = endDate
      }

      const response = triggerId
        ? await triggerService.getTriggerLogs(triggerId, params)
        : await triggerService.getTriggerLogs(undefined, params)

      setLogs(response.data)
      setTotal(response.total)
    } catch (error) {
      console.error('加载触发器日志失败:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // 导出日志
  const exportLogs = async () => {
    try {
      // 实现导出功能
      toast.info('导出功能待实现')
    } catch (error) {
      console.error('导出日志失败:', error)
    }
  }

  // 切换日志详情展开/折叠
  const toggleLogDetails = (logId: number) => {
    setExpandedLogs(prev => ({
      ...prev,
      [logId]: !prev[logId]
    }))
  }

  // 打开错误诊断工具
  const openDiagnostics = (log: TriggerExecutionLog, error?: string) => {
    setDiagnosticLog(log)
    setDiagnosticError(error || log.error_message || log.condition_error)
  }

  // 获取状态图标
  const getStatusIcon = (status: TriggerExecutionStatus) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'partial':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  // 获取状态文本
  const getStatusText = (status: TriggerExecutionStatus) => {
    switch (status) {
      case 'success':
        return '成功'
      case 'failed':
        return '失败'
      case 'partial':
        return '部分成功'
      default:
        return '未知'
    }
  }

  // 获取状态颜色
  const getStatusColor = (status: TriggerExecutionStatus) => {
    switch (status) {
      case 'success':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
      case 'partial':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
    }
  }

  // 格式化日期时间
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString()
  }

  // 计算执行时间（毫秒）
  const formatExecutionTime = (ms: number) => {
    if (ms < 1000) {
      return `${ms}ms`
    } else {
      return `${(ms / 1000).toFixed(2)}s`
    }
  }

  return (
    <div className="space-y-4">
      {/* 过滤器 */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="statusFilter">状态</Label>
                <select
                  id="statusFilter"
                  className="w-full p-2 border rounded mt-1"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as TriggerExecutionStatus | 'all')
                    setPage(1) // 重置页码
                  }}
                >
                  <option value="all">所有状态</option>
                  <option value="success">成功</option>
                  <option value="failed">失败</option>
                  <option value="partial">部分成功</option>
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
                    setPage(1) // 重置页码
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
                    setPage(1) // 重置页码
                  }}
                  className="mt-1"
                />
              </div>

              <div className="flex items-end">
                <Button
                  type="button"
                  onClick={() => {
                    setStatusFilter('all')
                    setStartDate('')
                    setEndDate('')
                    setPage(1)
                  }}
                  variant="outline"
                  className="mr-2"
                >
                  重置
                </Button>
                <Button type="button" onClick={() => loadLogs()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  刷新
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {/* 日志列表 */}
      {isLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </CardContent>
        </Card>
      ) : logs.length > 0 ? (
        <div className="space-y-4">
          {logs.map((log) => (
            <Card key={log.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-4">
                <div className="space-y-4">
                  {/* 日志头部 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(log.status)}
                      <span className="font-medium">执行日志 #{log.id}</span>
                      <Badge className={getStatusColor(log.status)}>
                        {getStatusText(log.status)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">
                        {formatDateTime(log.start_time)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleLogDetails(log.id)}
                      >
                        {expandedLogs[log.id] ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* 基本信息 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">触发器:</span>
                      <span className="ml-2 font-medium">
                        {log.trigger?.name || `ID: ${log.trigger_id}`}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">邮件ID:</span>
                      <span className="ml-2 font-medium">{log.email_id}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">执行时间:</span>
                      <span className="ml-2 font-medium">
                        {formatExecutionTime(log.execution_ms)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">条件结果:</span>
                      <span className={`ml-2 font-medium ${log.condition_result ? 'text-green-600' : 'text-red-600'}`}>
                        {log.condition_result ? '满足' : '不满足'}
                      </span>
                    </div>
                  </div>

                  {/* 展开的详细信息 */}
                  {expandedLogs[log.id] && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      {/* 条件执行详情 */}
                      <div className="mb-4">
                        <h4 className="text-sm font-medium mb-2">条件执行</h4>
                        <div className={`p-3 rounded-lg ${log.condition_result ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                          <p className={`text-sm ${log.condition_result ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                            {log.condition_result ? '条件满足' : '条件不满足'}
                            {log.condition_error && ` (错误: ${log.condition_error})`}
                          </p>

                          {log.condition_error && (
                            <div className="mt-2 flex justify-end">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-red-600"
                                onClick={() => openDiagnostics(log, log.condition_error)}
                              >
                                <AlertCircle className="h-4 w-4 mr-1" />
                                诊断错误
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 动作执行详情 */}
                      {log.action_results && log.action_results.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium mb-2">动作执行结果</h4>
                          <div className="space-y-2">
                            {log.action_results.map((result, index) => (
                              <div
                                key={index}
                                className={`p-3 rounded-lg ${result.success ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {result.success ? (
                                      <CheckCircle className="h-4 w-4 text-green-500" />
                                    ) : (
                                      <XCircle className="h-4 w-4 text-red-500" />
                                    )}
                                    <span className={`text-sm font-medium ${result.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                                      {result.action_name} ({result.action_type})
                                    </span>
                                  </div>
                                  <span className="text-sm text-gray-600">
                                    {formatExecutionTime(result.execution_ms)}
                                  </span>
                                </div>
                                {result.error && (
                                  <div className="mt-2">
                                    <p className="text-sm text-red-600 dark:text-red-400">
                                      错误: {result.error}
                                    </p>
                                    <div className="mt-2 flex justify-end">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="text-red-600"
                                        onClick={() => openDiagnostics(log, result.error)}
                                      >
                                        <AlertCircle className="h-4 w-4 mr-1" />
                                        诊断错误
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 执行追踪时间轴 */}
                      {log.execution_trace_data && (
                        <div className="mt-4">
                          <div className="flex items-center gap-2 mb-2">
                            <GitBranch className="h-4 w-4" />
                            <h4 className="text-sm font-medium">执行追踪时间轴</h4>
                          </div>
                          <ExecutionTimeline traceData={log.execution_trace_data} />
                        </div>
                      )}

                      {/* 错误信息 */}
                      {log.error_message && (
                        <div className="mt-4">
                          <h4 className="text-sm font-medium mb-2">错误信息</h4>
                          <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                            <p className="text-sm text-red-800 dark:text-red-200">
                              {log.error_message}
                            </p>
                            <div className="mt-2 flex justify-end">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="text-red-600"
                                onClick={() => openDiagnostics(log, log.error_message)}
                              >
                                <AlertCircle className="h-4 w-4 mr-1" />
                                诊断错误
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 查看详情按钮 */}
                      <div className="mt-4 flex justify-end gap-2">
                        {(log.status === 'failed' || log.status === 'partial') && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-red-600"
                            onClick={() => openDiagnostics(log)}
                          >
                            <AlertCircle className="h-4 w-4 mr-1" />
                            错误诊断
                          </Button>
                        )}

                        {onViewDetails && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onViewDetails(log)}
                          >
                            查看完整详情
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              未找到执行日志
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              尝试调整过滤条件或者等待触发器执行
            </p>
          </CardContent>
        </Card>
      )}

      {/* 分页和导出 */}
      {(showPagination || showExport) && total > 0 && (
        <div className="flex justify-between items-center mt-4">
          {showPagination && (
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
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
          )}

          {showExport && (
            <Button variant="outline" onClick={exportLogs}>
              <Download className="h-4 w-4 mr-2" />
              导出日志
            </Button>
          )}
        </div>
      )}

      <TriggerErrorDiagnosticsDialog
        open={Boolean(diagnosticLog)}
        onOpenChange={(open) => {
          if (!open) {
            setDiagnosticLog(null)
            setDiagnosticError(undefined)
          }
        }}
        triggerId={diagnosticLog?.trigger_id || triggerId}
        logId={diagnosticLog?.id}
        error={diagnosticError}
      />
    </div>
  )
}
