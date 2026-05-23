'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TriggerLogs } from '@/components/triggers/trigger-logs'
import { TriggerStats } from '@/components/triggers/trigger-stats'
import { triggerService } from '@/services/trigger.service'
import { EmailTrigger } from '@/types'
import { 
  ArrowLeft, 
  Settings, 
  Play, 
  Pause, 
  Trash2, 
  Calendar,
  BarChart3,
  ClipboardList,
  Bug,
  Cpu
} from 'lucide-react'
import { TriggerPerformance } from '@/components/triggers/trigger-performance'

export default function TriggerDetailsClient() {
  const params = useParams()
  const router = useRouter()
  const triggerId = parseInt(params.id as string)
  
  const [trigger, setTrigger] = useState<EmailTrigger | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('logs')
  
  // 日期过滤
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  
  // 加载触发器数据
  useEffect(() => {
    loadTrigger()
  }, [triggerId])
  
  const loadTrigger = async () => {
    try {
      setIsLoading(true)
      setError(null)
      
      const triggerData = await triggerService.getTrigger(triggerId)
      setTrigger(triggerData)
    } catch (err) {
      console.error('加载触发器失败:', err)
      setError('加载触发器数据失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }
  
  // 处理状态变更
  const handleStatusChange = async () => {
    if (!trigger) return
    
    try {
      if (trigger.status === 'enabled') {
        await triggerService.disableTrigger(trigger.id)
      } else {
        await triggerService.enableTrigger(trigger.id)
      }
      
      // 重新加载触发器数据
      loadTrigger()
    } catch (error) {
      console.error('更改触发器状态失败:', error)
    }
  }
  
  // 处理删除
  const handleDelete = async () => {
    if (!trigger) return
    
    if (window.confirm(`确定要删除触发器 "${trigger.name}" 吗？`)) {
      try {
        await triggerService.deleteTrigger(trigger.id)
        router.push('/triggers')
      } catch (error) {
        console.error('删除触发器失败:', error)
      }
    }
  }
  
  // 获取状态文本
  const getStatusText = (status: string) => {
    switch (status) {
      case 'enabled':
        return '运行中'
      case 'disabled':
        return '已停用'
      default:
        return '未知'
    }
  }
  
  // 获取状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'enabled':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
      case 'disabled':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
    }
  }
  
  return (
    <div className="space-y-6 p-6">
      {/* 返回按钮和标题 */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push('/triggers')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回列表
        </Button>
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
      ) : trigger ? (
        <>
          {/* 触发器信息 */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-xl">{trigger.name}</CardTitle>
                    <Badge className={getStatusColor(trigger.status)}>
                      {getStatusText(trigger.status)}
                    </Badge>
                  </div>
                  {trigger.description && (
                    <p className="mt-2 text-gray-600 dark:text-gray-400">
                      {trigger.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/triggers/edit/${trigger.id}`)}
                  >
                    <Settings className="h-4 w-4 mr-1" />
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/triggers/debug?id=${trigger.id}`)}
                  >
                    <Bug className="h-4 w-4 mr-1" />
                    调试
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className={trigger.status === 'enabled' ? 'text-red-600' : 'text-green-600'}
                    onClick={handleStatusChange}
                  >
                    {trigger.status === 'enabled' ? (
                      <>
                        <Pause className="h-4 w-4 mr-1" />
                        禁用
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-1" />
                        启用
                      </>
                    )}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="text-red-600"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    删除
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">检查间隔:</span>
                  <span className="ml-2 font-medium">
                    {trigger.check_interval} 秒
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">总执行次数:</span>
                  <span className="ml-2 font-medium">
                    {trigger.total_executions || 0}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">成功次数:</span>
                  <span className="ml-2 font-medium">
                    {trigger.success_executions || 0}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">最后执行:</span>
                  <span className="ml-2 font-medium">
                    {trigger.last_executed_at 
                      ? new Date(trigger.last_executed_at).toLocaleString() 
                      : '从未执行'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>    
      {/* 标签页 */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-4 mb-4">
              <TabsTrigger value="logs">
                <ClipboardList className="h-4 w-4 mr-2" />
                执行日志
              </TabsTrigger>
              <TabsTrigger value="stats">
                <BarChart3 className="h-4 w-4 mr-2" />
                统计分析
              </TabsTrigger>
              <TabsTrigger value="performance">
                <Cpu className="h-4 w-4 mr-2" />
                性能分析
              </TabsTrigger>
              <TabsTrigger value="details">
                <Settings className="h-4 w-4 mr-2" />
                详细配置
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="logs" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>执行日志</CardTitle>
                </CardHeader>
                <CardContent>
                  <TriggerLogs 
                    triggerId={trigger.id} 
                    limit={10}
                    showFilters={true}
                    showPagination={true}
                    showExport={true}
                  />
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="stats" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>统计分析</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="statsStartDate" className="block text-sm font-medium text-gray-700 mb-1">
                          开始日期
                        </label>
                        <input
                          id="statsStartDate"
                          type="date"
                          className="w-full p-2 border rounded"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                        />
                      </div>
                      <div>
                        <label htmlFor="statsEndDate" className="block text-sm font-medium text-gray-700 mb-1">
                          结束日期
                        </label>
                        <input
                          id="statsEndDate"
                          type="date"
                          className="w-full p-2 border rounded"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <TriggerStats 
                    triggerId={trigger.id}
                    startDate={startDate}
                    endDate={endDate}
                  />
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="performance" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>性能分析</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="perfStartDate" className="block text-sm font-medium text-gray-700 mb-1">
                          开始日期
                        </label>
                        <input
                          id="perfStartDate"
                          type="date"
                          className="w-full p-2 border rounded"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                        />
                      </div>
                      <div>
                        <label htmlFor="perfEndDate" className="block text-sm font-medium text-gray-700 mb-1">
                          结束日期
                        </label>
                        <input
                          id="perfEndDate"
                          type="date"
                          className="w-full p-2 border rounded"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <TriggerPerformance 
                    triggerId={trigger.id}
                    startDate={startDate}
                    endDate={endDate}
                  />
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="details" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>触发条件</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">条件类型</h4>
                      <p className="text-sm">{trigger.condition.type === 'js' ? 'JavaScript' : 'Go Template'}</p>
                    </div>
                    
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">条件脚本</h4>
                      <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg overflow-x-auto text-sm font-mono">
                        {trigger.condition.script}
                      </pre>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>触发动作 ({trigger.actions?.length || 0})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {trigger.actions?.map((action, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium">{action.name}</h4>
                          <Badge className={action.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                            {action.enabled ? '已启用' : '已禁用'}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                          <div>
                            <span className="text-gray-500">类型:</span>
                            <span className="ml-2">{action.type}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">执行顺序:</span>
                            <span className="ml-2">{action.order}</span>
                          </div>
                        </div>
                        
                        <div>
                          <h5 className="text-sm font-medium text-gray-700 mb-2">配置</h5>
                          <pre className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg overflow-x-auto text-sm font-mono">
                            {action.config}
                          </pre>
                        </div>
                      </div>
                    ))}
                    
                    {(!trigger.actions || trigger.actions.length === 0) && (
                      <p className="text-gray-500 text-center py-4">没有配置任何动作</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-gray-600">触发器不存在或已被删除</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
