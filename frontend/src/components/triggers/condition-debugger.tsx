'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConditionBuilder } from './condition-builder'
import { ConditionTest } from './condition-test'
import { TriggerExpression } from '@/types'
import { v4 as uuidv4 } from 'uuid'
import { expressionsToJson, jsonToExpressions } from './condition-utils'

interface ConditionDebuggerProps {
  initialExpressions?: TriggerExpression[]
  onChange?: (expressions: TriggerExpression[]) => void
  onTest?: (expressions: TriggerExpression[], testData: any) => Promise<any>
}

export function ConditionDebugger({ initialExpressions, onChange, onTest }: ConditionDebuggerProps) {
  const [expressions, setExpressions] = useState<TriggerExpression[]>([])
  const [activeTab, setActiveTab] = useState('builder')

  // 初始化
  useEffect(() => {
    if (initialExpressions && initialExpressions.length > 0) {
      setExpressions(initialExpressions)
    } else {
      // 创建默认的根条件组
      const rootGroup: TriggerExpression = {
        id: uuidv4(),
        type: 'group',
        operator: 'and',
        conditions: [{
          id: uuidv4(),
          type: 'condition',
          field: 'subject',
          operator: 'contains',
          value: '',
          not: false
        }]
      }
      setExpressions([rootGroup])
    }
  }, [initialExpressions])

  // 处理表达式变更
  const handleExpressionsChange = (newExpressions: TriggerExpression[]) => {
    setExpressions(newExpressions)
    if (onChange) {
      onChange(newExpressions)
    }
  }

  // 处理测试
  const handleTest = async (expressions: TriggerExpression[], testData: any) => {
    if (onTest) {
      return await onTest(expressions, testData)
    }

    // 默认测试行为（如果没有提供onTest）
    return {
      result: true,
      details: {
        message: '测试成功（模拟结果）',
        expressions: expressions,
        testData: testData
      }
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>条件调试器</CardTitle>
        <CardDescription>
          构建、测试和调试邮件触发条件
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="builder">条件构建器</TabsTrigger>
            <TabsTrigger value="tester">条件测试</TabsTrigger>
          </TabsList>
          <TabsContent value="builder" className="p-0 pt-4">
            <ConditionBuilder
              initialExpressions={expressions}
              onChange={handleExpressionsChange}
            />
          </TabsContent>
          <TabsContent value="tester" className="p-0 pt-4">
            <ConditionTest
              expressions={expressions}
              onTest={handleTest}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}