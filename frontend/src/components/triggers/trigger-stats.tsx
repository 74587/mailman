'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { triggerService } from '@/services/trigger.service'
import { TriggerStatistics } from '@/types'

interface TriggerStatsProps {
  triggerId: number
  startDate?: string
  endDate?: string
  onRefresh?: () => void
}

export function TriggerStats({ triggerId, startDate, endDate, onRefresh }: TriggerStatsProps) {
  const [stats, setStats] = useState<TriggerStatistics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 加载统计数据
  useEffect(() => {
    loadStats()
  }, [triggerId, startDate, endDate])

  const loadStats = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const statistics = await triggerService.getTriggerStatistics(triggerId, startDate, endDate)
      setStats(statistics)

      if (onRefresh) {
        onRefresh()
      }
    } catch (err) {
      console.error('加载触发器统计数据失败:', err)
      setError('加载统计数据失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }

  // 格式化百分比 - API返回的是百分比值 (0-100)
  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`
  }

  // 格式化执行时间
  const formatExecutionTime = (ms: number) => {
    if (ms < 1000) {
      return `${ms.toFixed(0)}ms`
    } else {
      return `${(ms / 1000).toFixed(2)}s`
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </CardContent>
        </Card>
      ) : stats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 总执行次数 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">总执行次数</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total_executions}</div>
            </CardContent>
          </Card>

          {/* 成功率 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">成功率</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatPercentage(stats.success_rate)}
              </div>
              <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-600"
                  style={{ width: `${stats.success_rate}%` }}
                ></div>
              </div>
            </CardContent>
          </Card>

          {/* 平均执行时间 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">平均执行时间</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {formatExecutionTime(stats.avg_execution_time)}
              </div>
            </CardContent>
          </Card>

          {/* 执行结果分布 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">执行结果分布</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-green-600">成功</span>
                  <span className="text-sm font-medium">{stats.success_executions}</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-600"
                    style={{ width: `${stats.total_executions > 0 ? (stats.success_executions / stats.total_executions) * 100 : 0}%` }}
                  ></div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-red-600">失败</span>
                  <span className="text-sm font-medium">{stats.failed_executions}</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-600"
                    style={{ width: `${stats.total_executions > 0 ? (stats.failed_executions / stats.total_executions) * 100 : 0}%` }}
                  ></div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-yellow-600">部分成功</span>
                  <span className="text-sm font-medium">{stats.partial_executions}</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-600"
                    style={{ width: `${stats.total_executions > 0 ? (stats.partial_executions / stats.total_executions) * 100 : 0}%` }}
                  ></div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-gray-600">暂无统计数据</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}