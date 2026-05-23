'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { EmailTrigger, TriggerConditionConfig, TriggerActionConfig, TriggerStatus, TriggerExpression } from '@/types'
import { optimizedTriggerService as triggerService } from '@/services/optimized-trigger.service'
import { useRouter } from 'next/navigation'
import { ConditionBuilder } from './condition-builder'
import { ActionConfig } from './action-config'
import { ActionList } from './action-list'
import { ActionConfigDialog } from './action-config-dialog'

interface TriggerFormProps {
  triggerId?: number
  onSave?: (trigger: EmailTrigger) => void
  onCancel?: () => void
}

export function TriggerForm({ triggerId, onSave, onCancel }: TriggerFormProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 表单状态
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [checkInterval, setCheckInterval] = useState(300) // 默认5分钟
  const [expressions, setExpressions] = useState<TriggerExpression[]>([])
  // 保留 legacy condition 状态以防万一，但主要使用 expressions
  const [condition, setCondition] = useState<TriggerConditionConfig>({
    type: 'structural',
    script: ''
  })
  const [actions, setActions] = useState<TriggerActionConfig[]>([])
  const [enableLogging, setEnableLogging] = useState(true)

  // 动作编辑状态
  const [editingActionIndex, setEditingActionIndex] = useState<number | null>(null)
  const [isActionDialogOpen, setIsActionDialogOpen] = useState(false)

  // 加载触发器数据
  useEffect(() => {
    if (triggerId) {
      loadTrigger(triggerId)
    }
  }, [triggerId])

  const loadTrigger = async (id: number) => {
    try {
      setIsLoading(true)
      setError(null)

      const trigger = await triggerService.getTrigger(id)

      // 填充表单数据
      setName(trigger.name)
      setDescription(trigger.description || '')
      setEnabled(trigger.status === 'enabled')
      setCheckInterval(trigger.check_interval)
      // 如果触发器有 expressions，使用它们；否则保留为空（可以通过后续逻辑从 legacy condition 转换，但这里暂略）
      if (trigger.expressions) {
        setExpressions(trigger.expressions)
      } else {
        // 尝试解析 legacy condition 或者保持为空
      }
      setCondition(trigger.condition)
      setActions(trigger.actions)
      setEnableLogging(trigger.enable_logging)
    } catch (err) {
      console.error('加载触发器失败:', err)
      setError('加载触发器数据失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }

  // 保存触发器
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setIsSaving(true)
      setError(null)

      // 构建触发器数据
      const status: TriggerStatus = enabled ? 'enabled' : 'disabled'

      let savedTrigger: EmailTrigger

      if (triggerId) {
        // 更新现有触发器
        savedTrigger = await triggerService.updateTrigger(triggerId, {
          id: triggerId,
          name,
          description,
          status,
          check_interval: checkInterval,
          condition,
          expressions, // V2 support
          actions,
          enable_logging: enableLogging
        })
      } else {
        // 创建新触发器
        savedTrigger = await triggerService.createTrigger({
          name,
          description,
          status,
          check_interval: checkInterval,
          condition,
          expressions, // V2 support
          actions,
          enable_logging: enableLogging
        })
      }

      // 调用保存回调
      if (onSave) {
        onSave(savedTrigger)
      } else {
        // 默认导航到触发器列表
        router.push('/triggers')
      }
    } catch (err) {
      console.error('保存触发器失败:', err)
      setError('保存触发器失败，请检查表单数据并重试')
    } finally {
      setIsSaving(false)
    }
  }

  // 添加新动作
  const addAction = () => {
    const newAction: TriggerActionConfig = {
      type: 'modify_content',
      name: `动作 ${actions.length + 1}`,
      description: '',
      config: '{}',
      enabled: true,
      order: actions.length
    }

    setActions([...actions, newAction])
  }

  // 更新动作
  const updateAction = (index: number, updatedAction: TriggerActionConfig) => {
    const newActions = [...actions]
    newActions[index] = updatedAction
    setActions(newActions)
  }

  // 删除动作
  const removeAction = (index: number) => {
    const newActions = actions.filter((_, i) => i !== index)
    setActions(newActions)
  }

  // 处理取消
  const handleCancel = () => {
    if (onCancel) {
      onCancel()
    } else {
      router.push('/triggers')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* 基本信息 */}
      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">触发器名称</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入触发器名称"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="输入触发器描述（可选）"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="enabled">启用状态</Label>
              <Switch
                id="enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="checkInterval">检查间隔（秒）</Label>
              <Input
                id="checkInterval"
                type="number"
                min={60}
                value={checkInterval}
                onChange={(e) => setCheckInterval(parseInt(e.target.value))}
                required
              />
              <p className="text-sm text-gray-500">
                触发器检查新邮件的时间间隔，最小60秒
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 触发条件 */}
      <Card>
        <CardHeader>
          <CardTitle>触发条件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 mb-4">
            <Label>条件构建器 (V2)</Label>
          </div>

          <ConditionBuilder
            initialExpressions={expressions}
            onChange={(newExpressions) => {
              setExpressions(newExpressions)
              // Sync for legacy compatibility if needed
              setCondition({ ...condition, script: JSON.stringify(newExpressions) })
            }}
          />
        </CardContent>
      </Card>

      {/* 触发动作 */}
      <Card>
        <CardHeader>
          <CardTitle>触发动作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionList
            actions={actions}
            onChange={setActions}
            onEditAction={(index) => {
              setEditingActionIndex(index)
              setIsActionDialogOpen(true)
            }}
          />

          {/* 动作配置对话框 */}
          {editingActionIndex !== null && (
            <ActionConfigDialog
              action={actions[editingActionIndex]}
              isOpen={isActionDialogOpen}
              onClose={() => {
                setIsActionDialogOpen(false)
                setEditingActionIndex(null)
              }}
              onSave={(updatedAction) => {
                const newActions = [...actions]
                newActions[editingActionIndex] = updatedAction
                setActions(newActions)
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* 日志设置 */}
      <Card>
        <CardHeader>
          <CardTitle>日志设置</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label htmlFor="enableLogging">启用执行日志</Label>
            <Switch
              id="enableLogging"
              checked={enableLogging}
              onCheckedChange={setEnableLogging}
            />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            启用后将记录触发器的执行情况，包括条件匹配和动作执行结果
          </p>
        </CardContent>
      </Card>

      {/* 表单操作 */}
      <div className="flex justify-end gap-4">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={isSaving}>
          取消
        </Button>
        <Button type="submit" disabled={isSaving || isLoading}>
          {isSaving ? '保存中...' : (triggerId ? '更新触发器' : '创建触发器')}
        </Button>
      </div>
    </form>
  )
}