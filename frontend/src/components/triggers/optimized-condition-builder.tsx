'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Code } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { ConditionGroup } from './condition-group'
import { TriggerExpression } from '@/types'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { toast } from 'sonner'

// 条件类型
type ConditionType = 'simple' | 'advanced'

interface ConditionBuilderProps {
  initialExpressions?: TriggerExpression[]
  onChange: (expressions: TriggerExpression[]) => void
  onTest?: (expressions: TriggerExpression[], testData?: any) => Promise<any>
}

export function OptimizedConditionBuilder({ initialExpressions, onChange, onTest }: ConditionBuilderProps) {
  const { confirm } = useConfirmDialog()
  const [conditionType, setConditionType] = useState<ConditionType>('simple')
  const [expressions, setExpressions] = useState<TriggerExpression[]>([])
  const [advancedScript, setAdvancedScript] = useState('')

  // 创建默认条件 - 使用useMemo缓存
  const createDefaultCondition = useCallback((): TriggerExpression => {
    return {
      id: uuidv4(),
      type: 'condition',
      field: 'subject',
      operator: 'contains',
      value: '',
      not: false
    } as TriggerExpression
  }, [])

  // 创建默认条件组 - 使用useMemo缓存
  const createDefaultGroup = useCallback((): TriggerExpression => {
    return {
      id: uuidv4(),
      type: 'group',
      operator: 'and',
      conditions: [createDefaultCondition()],
      not: false
    }
  }, [createDefaultCondition])

  // 初始化 - 使用useEffect减少不必要的重新渲染
  useEffect(() => {
    if (initialExpressions && initialExpressions.length > 0) {
      setExpressions(initialExpressions)
    } else if (expressions.length === 0) {
      // 只在没有表达式时创建默认的根条件组
      const rootGroup: TriggerExpression = {
        id: uuidv4(),
        type: 'group',
        operator: 'and',
        conditions: [createDefaultCondition()]
      }
      setExpressions([rootGroup])
    }
  }, [initialExpressions, createDefaultCondition, expressions.length])

  // 更新表达式 - 使用useCallback优化
  const updateExpression = useCallback((updatedExpression: TriggerExpression) => {
    const findAndUpdate = (expressions: TriggerExpression[]): TriggerExpression[] => {
      return expressions.map(expr => {
        if (expr.id === updatedExpression.id) {
          return updatedExpression
        } else if (expr.conditions && expr.conditions.length > 0) {
          return {
            ...expr,
            conditions: findAndUpdate(expr.conditions)
          }
        }
        return expr
      })
    }

    const newExpressions = findAndUpdate(expressions)
    setExpressions(newExpressions)
    onChange(newExpressions)
  }, [expressions, onChange])

  // 添加条件到组 - 使用useCallback优化
  const addConditionToGroup = useCallback((groupId: string) => {
    const findAndAddCondition = (expressions: TriggerExpression[]): TriggerExpression[] => {
      return expressions.map(expr => {
        if (expr.id === groupId && expr.type === 'group') {
          return {
            ...expr,
            conditions: [...(expr.conditions || []), createDefaultCondition()]
          }
        } else if (expr.conditions && expr.conditions.length > 0) {
          return {
            ...expr,
            conditions: findAndAddCondition(expr.conditions)
          }
        }
        return expr
      })
    }

    const newExpressions = findAndAddCondition(expressions)
    setExpressions(newExpressions)
    onChange(newExpressions)
  }, [expressions, onChange, createDefaultCondition])

  // 添加条件组到组 - 使用useCallback优化
  const addGroupToGroup = useCallback((groupId: string) => {
    const findAndAddGroup = (expressions: TriggerExpression[]): TriggerExpression[] => {
      return expressions.map(expr => {
        if (expr.id === groupId && expr.type === 'group') {
          return {
            ...expr,
            conditions: [...(expr.conditions || []), createDefaultGroup()]
          }
        } else if (expr.conditions && expr.conditions.length > 0) {
          return {
            ...expr,
            conditions: findAndAddGroup(expr.conditions)
          }
        }
        return expr
      })
    }

    const newExpressions = findAndAddGroup(expressions)
    setExpressions(newExpressions)
    onChange(newExpressions)
  }, [expressions, onChange, createDefaultGroup])

  // 从组中删除表达式 - 使用useCallback优化
  const removeExpressionFromGroup = useCallback((expressionId: string, groupId: string) => {
    const findAndRemove = (expressions: TriggerExpression[]): TriggerExpression[] => {
      return expressions.map(expr => {
        if (expr.id === groupId && expr.type === 'group') {
          // 确保组中至少保留一个条件
          if ((expr.conditions || []).length <= 1) {
            return expr
          }
          return {
            ...expr,
            conditions: (expr.conditions || []).filter(c => c.id !== expressionId)
          }
        } else if (expr.conditions && expr.conditions.length > 0) {
          return {
            ...expr,
            conditions: findAndRemove(expr.conditions)
          }
        }
        return expr
      })
    }

    const newExpressions = findAndRemove(expressions)
    setExpressions(newExpressions)
    onChange(newExpressions)
  }, [expressions, onChange])

  // 切换条件类型
  const toggleConditionType = useCallback(async () => {
    if (conditionType === 'simple') {
      // 从简单模式切换到高级模式
      setConditionType('advanced')
      // 将表达式转换为JSON字符串
      setAdvancedScript(JSON.stringify(expressions, null, 2))
    } else {
      // 从高级模式切换到简单模式
      const confirmed = await confirm({
        title: '切换模式',
        description: '切换到简单模式将丢失高级编辑内容，确定继续吗？',
        confirmText: '确定',
        cancelText: '取消',
        variant: 'destructive'
      })
      if (confirmed) {
        setConditionType('simple')
        // 重置为默认表达式
        const rootGroup: TriggerExpression = {
          id: uuidv4(),
          type: 'group',
          operator: 'and',
          conditions: [createDefaultCondition()]
        }
        setExpressions([rootGroup])
        onChange([rootGroup])
      }
    }
  }, [conditionType, expressions, onChange, createDefaultCondition, confirm])

  // 测试条件 - 使用useCallback优化
  const handleTestCondition = useCallback(async () => {
    if (onTest) {
      try {
        // 创建默认测试数据
        const defaultTestData = {
          subject: "测试邮件主题",
          from: ["sender@example.com"],
          to: ["recipient@example.com"],
          body: "这是一封测试邮件"
        }

        const result = await onTest(expressions, defaultTestData)
        // 处理测试结果
        logger.debug('测试结果:', result)

        // 显示测试结果
        if (result.result) {
          toast.success('条件满足！')
        } else {
          toast.info('条件不满足！')
        }
      } catch (error) {
        console.error('测试条件失败:', error)
        toast.error('测试失败: ' + (error instanceof Error ? error.message : '未知错误'))
      }
    }
  }, [expressions, onTest])

  // 处理高级脚本变更 - 使用useCallback优化
  const handleAdvancedScriptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const script = e.target.value
    setAdvancedScript(script)

    // 使用防抖处理JSON解析，避免频繁解析
    const debounceTimer = setTimeout(() => {
      // 尝试解析JSON
      try {
        const parsedExpressions = JSON.parse(script)
        if (Array.isArray(parsedExpressions)) {
          onChange(parsedExpressions)
        }
      } catch (error) {
        // 解析失败，不更新表达式
        console.error('解析JSON失败:', error)
      }
    }, 500); // 500ms防抖

    return () => clearTimeout(debounceTimer);
  }, [onChange]);

  // 使用useMemo优化渲染
  const renderConditionGroups = useMemo(() => {
    return expressions.map(expr => (
      <ConditionGroup
        key={expr.id}
        group={expr}
        onUpdate={updateExpression}
        onAddCondition={addConditionToGroup}
        onAddGroup={addGroupToGroup}
        onRemoveExpression={removeExpressionFromGroup}
      />
    ));
  }, [expressions, updateExpression, addConditionToGroup, addGroupToGroup, removeExpressionFromGroup]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">触发条件</h3>
        <div className="flex gap-2">
          {onTest && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestCondition}
            >
              测试条件
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleConditionType}
          >
            <Code className="h-4 w-4 mr-2" />
            {conditionType === 'simple' ? '切换到高级模式' : '切换到简单模式'}
          </Button>
        </div>
      </div>

      {conditionType === 'simple' ? (
        <div className="space-y-4">
          {renderConditionGroups}
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="advanced-script">脚本代码</Label>
          <Textarea
            id="advanced-script"
            value={advancedScript}
            onChange={handleAdvancedScriptChange}
            rows={10}
            className="font-mono"
          />
          <p className="text-sm text-gray-500">
            使用JSON格式编写条件表达式，或使用JavaScript编写自定义条件逻辑。
          </p>
        </div>
      )}
    </div>
  )
}