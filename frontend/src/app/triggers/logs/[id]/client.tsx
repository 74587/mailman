'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { triggerService } from '@/services/trigger.service'
import { TriggerExecutionLog, TriggerExecutionStatus } from '@/types'
import { 
  ArrowLeft, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Clock,
  Download,
  AlertCircle
} from 'lucide-react'

export default function LogDetailsClient() {
  const params = useParams()
  const router = useRouter()
  const logId = parseInt(params.id as string)
  
  const [log, setLog] = useState<TriggerExecutionLog | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // 加载日志数据
  useEffect(() => {
    loadLog()
  }, [logId])
  
  const loadLog = async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      // 注意：这里假设有一个获取单个日志的API
      // 实际实现可能需要调整
      const logData = await triggerService.getTriggerLog(logId)
      setLog(logData)
    } catch (err) {
      console.error('加载日志失败:', err)
      setError('加载日志数据失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }
  
  // 获取状态图标
  const getStatusIcon = (status: TriggerExecutionStatus) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />
      case 'partial':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />
      default:
        return <Clock className="h-5 w-5 text-gray-500" />
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
  
  // 导出日志
  const exportLog = () => {
    if (!log) return
    
    const logData = JSON.stringify(log, null, 2)
    const blob = new Blob([logData], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trigger-log-${log.id}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
  
  return (
    <div className="space-y-6 p-6">
      {/* 返回按钮和标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="text-xl font-bold">执行日志详情</h1>
        </div>
        
        {log && (
          <Button variant="outline" size="sm" onClick={exportLog}>
            <Download className="h-4 w-4 mr-1" />
            导出日志
          </Button>
        )}
      </div>
      
      {isLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="p-6">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          </CardContent>
        </Card>
      ) : log ? (
        <div className="space-y-6">
          {/* 日志基本信息 */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>日志 #{log.id}</CardTitle>
                <Badge className={getStatusColor(log.status)}>
                  {getStatusIcon(log.status)}
                  <span className="ml-1">{getStatusText(log.status)}</span>
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">触发器</h3>
                  <p>{log.trigger?.name || `ID: ${log.trigger_id}`}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">邮件ID</h3>
                  <p>{log.email_id}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">开始时间</h3>
                  <p>{formatDateTime(log.start_time)}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">结束时间</h3>
                  <p>{formatDateTime(log.end_time)}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">执行时间</h3>
                  <p>{formatExecutionTime(log.execution_ms)}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">条件结果</h3>
                  <p className={log.condition_result ? 'text-green-600' : 'text-red-600'}>
                    {log.condition_result ? '满足' : '不满足'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>      
    {/* 条件执行详情 */}
          <Card>
            <CardHeader>
              <CardTitle>条件执行</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`p-4 rounded-lg ${log.condition_result ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {log.condition_result ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <h3 className={`font-medium ${log.condition_result ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                    {log.condition_result ? '条件满足' : '条件不满足'}
                  </h3>
                </div>
                
                {log.condition_error && (
                  <div className="mt-2 p-3 bg-red-100 dark:bg-red-900/30 rounded">
                    <p className="text-sm text-red-800 dark:text-red-200">
                      错误: {log.condition_error}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          
          {/* 动作执行详情 */}
          {log.action_results && log.action_results.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>动作执行结果</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {log.action_results.map((result, index) => (
                    <div 
                      key={index} 
                      className={`p-4 rounded-lg ${result.success ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {result.success ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-500" />
                          )}
                          <h3 className={`font-medium ${result.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                            {result.action_name} ({result.action_type})
                          </h3>
                        </div>
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          {formatExecutionTime(result.execution_ms)}
                        </span>
                      </div>
                      
                      {result.error && (
                        <div className="mt-2 p-3 bg-red-100 dark:bg-red-900/30 rounded">
                          <p className="text-sm text-red-800 dark:text-red-200">
                            错误: {result.error}
                          </p>
                          <div className="mt-2 flex justify-end">
                            <Button 
                              type="button" 
                              variant="outline" 
                              size="sm"
                              className="text-red-600"
                              onClick={() => router.push(`/triggers/diagnostics?logId=${log.id}&triggerId=${log.trigger_id}`)}
                            >
                              <AlertCircle className="h-4 w-4 mr-1" />
                              诊断错误
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="text-sm font-medium mb-2">输入数据</h4>
                          <pre className="bg-gray-50 dark:bg-gray-900 p-3 rounded text-xs overflow-x-auto">
                            {result.input_data ? JSON.stringify(result.input_data, null, 2) : '无输入数据'}
                          </pre>
                        </div>
                        <div>
                          <h4 className="text-sm font-medium mb-2">输出数据</h4>
                          <pre className="bg-gray-50 dark:bg-gray-900 p-3 rounded text-xs overflow-x-auto">
                            {result.output_data ? JSON.stringify(result.output_data, null, 2) : '无输出数据'}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* 错误信息 */}
          {log.error_message && (
            <Card>
              <CardHeader>
                <CardTitle>错误信息</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <p className="text-red-800 dark:text-red-200">
                    {log.error_message}
                  </p>
                  <div className="mt-4 flex justify-end">
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="text-red-600"
                      onClick={() => router.push(`/triggers/diagnostics?logId=${log.id}&triggerId=${log.trigger_id}`)}
                    >
                      <AlertCircle className="h-4 w-4 mr-1" />
                      诊断错误
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* 邮件数据 */}
          {log.email && (
            <Card>
              <CardHeader>
                <CardTitle>邮件数据</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium mb-1">主题</h3>
                    <p className="p-2 bg-gray-50 dark:bg-gray-900 rounded">{log.email.Subject}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-medium mb-1">发件人</h3>
                      <p className="p-2 bg-gray-50 dark:bg-gray-900 rounded">{log.email.From}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium mb-1">收件人</h3>
                      <p className="p-2 bg-gray-50 dark:bg-gray-900 rounded">{log.email.To}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium mb-1">正文</h3>
                    <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded max-h-60 overflow-y-auto">
                      <pre className="text-xs whitespace-pre-wrap">{log.email.Body}</pre>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* 输入参数 */}
          {log.input_params && Object.keys(log.input_params).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>输入参数</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded text-xs overflow-x-auto">
                  {JSON.stringify(log.input_params, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-gray-600">日志不存在或已被删除</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}