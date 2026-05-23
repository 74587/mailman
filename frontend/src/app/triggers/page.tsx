'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { TriggerList, TriggerStats } from '@/components/triggers/trigger-list'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Plus, Zap, CheckCircle, Activity, TrendingUp, Settings } from 'lucide-react'
import { EmailTrigger } from '@/types'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'
import { AISettingsDialog } from '@/components/triggers/ai-settings-dialog'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

export default function TriggersPage() {
  const [stats, setStats] = useState<TriggerStats | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)

  // 处理调试触发器 - 使用内部 tab 系统
  const handleDebug = (trigger: EmailTrigger) => {
    const tabId = `trigger-debug-${trigger.id}`
    window.dispatchEvent(new CustomEvent('switchTab', {
      detail: {
        tab: tabId,
        data: { triggerId: trigger.id, triggerName: trigger.name }
      }
    }))
  }

  // 处理创建新触发器 - 使用内部 tab 系统
  const handleCreate = () => {
    window.dispatchEvent(new CustomEvent('switchTab', {
      detail: {
        tab: 'trigger-create',
        data: {}
      }
    }))
  }

  // 刷新触发器列表
  const handleRefresh = useCallback(() => {
    logger.debug('[TriggersPage] 收到刷新请求，重新加载数据...')
    toast.success('正在刷新触发器列表...')
    // 通过更改 key 强制刷新 TriggerList 组件
    setRefreshKey(prev => prev + 1)
  }, [])

  // 注册刷新回调
  useEffect(() => {
    registerRefreshCallback('triggers', handleRefresh)

    return () => {
      unregisterRefreshCallback('triggers')
    }
  }, [handleRefresh])

  return (
    <div className="space-y-6 p-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            <Zap className="inline-block mr-2 h-6 w-6 text-blue-600" />
            邮件触发器
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            智能邮件处理规则，让您的邮箱管理更高效
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setAiSettingsOpen(true)}
            className="border-gray-200 dark:border-gray-700"
          >
            <Settings className="h-4 w-4 mr-2" />
            AI 设置
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            创建新规则
          </Button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">总规则数</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {stats?.total ?? '-'}
                </p>
              </div>
              <Zap className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">运行中</p>
                <p className="text-2xl font-bold text-green-600">
                  {stats?.enabled ?? '-'}
                </p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">已处理邮件</p>
                <p className="text-2xl font-bold text-purple-600">
                  {stats?.totalExecutions ?? '-'}
                </p>
              </div>
              <Activity className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">成功率</p>
                <p className="text-2xl font-bold text-orange-600">
                  {stats ? `${stats.successRate}%` : '-'}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 触发器列表 */}
      <TriggerList key={refreshKey} onDebug={handleDebug} onStatsChange={setStats} />

      {/* AI 设置弹窗 */}
      <AISettingsDialog
        open={aiSettingsOpen}
        onOpenChange={setAiSettingsOpen}
      />
    </div>
  )
}