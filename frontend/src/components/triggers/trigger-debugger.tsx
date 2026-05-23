'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, CheckCircle2, AlertCircle, Code, Mail, Play } from 'lucide-react'
import { ConditionTest } from './condition-test'
import { ActionTest } from './action-test'
import { TriggerExpression as Expression } from '@/types'
import { TriggerActionConfig, EmailTrigger } from '@/types'
import { triggerService } from '@/services/trigger.service'
import { expressionsToText } from './condition-utils'
import { apiClient } from '@/lib/api-client'

interface TriggerDebuggerProps {
  trigger: EmailTrigger
  onSave?: (trigger: EmailTrigger) => void
}

// 默认测试数据模板
const DEFAULT_TEST_DATA = {
  subject: "测试邮件主题",
  from: ["sender@example.com"],
  to: ["recipient@example.com"],
  cc: [],
  bcc: [],
  body: "这是一封测试邮件的内容",
  htmlBody: "<div>这是一封测试邮件的HTML内容</div>",
  textBody: "这是一封测试邮件的纯文本内容",
  hasAttachments: false,
  date: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  messageId: "<test-message-id@example.com>",
  headers: {
    "X-Custom-Header": "测试自定义头部"
  }
}

export function TriggerDebugger({ trigger, onSave }: TriggerDebuggerProps) {
  const [testData, setTestData] = useState<string>(JSON.stringify(DEFAULT_TEST_DATA, null, 2))
  const [activeTab, setActiveTab] = useState('editor')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<any>(null)
  const [conditionResult, setConditionResult] = useState<any>(null)
  const [actionResults, setActionResults] = useState<any[]>([])

  // 测试条件
  const handleTestCondition = async () => {
    try {
      setIsLoading(true)
      setError(null)
      setConditionResult(null)

      // 解析测试数据
      let parsedData
      try {
        parsedData = JSON.parse(testData)
      } catch (err) {
        setError('测试数据JSON格式无效，请检查格式')
        return
      }

      // 执行条件测试
      // V2 API 期望 'expressions' 和 'testData'
      const result = await apiClient.post('/v2/triggers/test-condition', {
        expressions: trigger.expressions || [],
        testData: parsedData
      })

      // 设置测试结果
      setConditionResult(result)
    } catch (err: any) {
      console.error('测试条件失败:', err)
      setError(err.message || '测试条件失败')
    } finally {
      setIsLoading(false)
    }
  }

  // 测试动作
  const handleTestAction = async (action: TriggerActionConfig) => {
    try {
      setIsLoading(true)
      setError(null)

      // 解析测试数据
      let parsedData
      try {
        parsedData = JSON.parse(testData)
      } catch (err) {
        setError('测试数据JSON格式无效，请检查格式')
        return
      }

      // 执行动作测试
      // V2 API 期望 'action' (含 pluginId, config 等) 和 'testData'
      const v2Action = {
        id: (action as any).id || 'test-action',
        pluginId: (action as any).pluginId || (action.type === 'modify_content' ? 'email_modify_plugin' : 'email_forward_plugin'),
        pluginName: action.name,
        config: typeof action.config === 'string' ? JSON.parse(action.config) : action.config,
        enabled: action.enabled,
        executionOrder: action.order
      }

      const result = await apiClient.post('/v2/triggers/test-action', {
        action: v2Action,
        testData: parsedData
      })

      // 更新动作结果
      return result
    } catch (err: any) {
      console.error('测试动作失败:', err)
      setError(err.message || '测试动作失败')
      return { error: err.message || '测试动作失败' }
    } finally {
      setIsLoading(false)
    }
  }

  // 测试完整触发器
  const handleTestCompleteTrigger = async () => {
    try {
      setIsLoading(true)
      setError(null)
      setTestResult(null)
      setConditionResult(null)
      setActionResults([])

      // 解析测试数据
      let parsedData
      try {
        parsedData = JSON.parse(testData)
      } catch (err) {
        setError('测试数据JSON格式无效，请检查格式')
        return
      }

      // 创建测试请求 - 适配 V2 模型
      const testRequest = {
        trigger: {
          id: trigger.id,
          name: trigger.name,
          description: trigger.description,
          enabled: trigger.status === 'enabled',
          expressions: trigger.expressions || [],
          actions: trigger.actions.map((a, index) => ({
            id: (a as any).id || `action_${Date.now()}_${index}`,
            pluginId: (a as any).pluginId || (a.type === 'modify_content' ? 'email_modify_plugin' : 'email_forward_plugin'),
            pluginName: a.name,
            config: typeof a.config === 'string' ? JSON.parse(a.config) : a.config,
            enabled: a.enabled,
            executionOrder: a.order
          }))
        },
        testData: parsedData
      }

      // 执行完整触发器测试
      const result = await apiClient.post('/v2/triggers/test-complete', testRequest)

      // 设置测试结果
      setTestResult(result)
      setConditionResult({
        result: result.conditionResult,
        details: result.conditionEvaluation
      })
      setActionResults(result.actionResults || [])
    } catch (err: any) {
      console.error('测试触发器失败:', err)
      setError(err.message || '测试触发器失败')
    } finally {
      setIsLoading(false)
    }
  }

  // 重置测试数据
  const resetTestData = () => {
    setTestData(JSON.stringify(DEFAULT_TEST_DATA, null, 2))
    setTestResult(null)
    setConditionResult(null)
    setActionResults([])
    setError(null)
  }

  // 渲染测试数据编辑器
  const renderTestDataEditor = () => {
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-sm font-medium">测试数据 (JSON格式)</label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetTestData}
          >
            重置数据
          </Button>
        </div>
        <Textarea
          value={testData}
          onChange={(e) => setTestData(e.target.value)}
          rows={12}
          className="font-mono"
        />
        <p className="text-sm text-gray-500">
          输入JSON格式的邮件数据，用于测试触发器
        </p>
      </div>
    )
  }

  // 渲染邮件预览
  const renderEmailPreview = () => {
    let emailData
    try {
      emailData = JSON.parse(testData)
    } catch (err) {
      return (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-md">
          JSON格式无效，无法预览邮件
        </div>
      )
    }

    return (
      <div className="border rounded-md p-4">
        <div className="border-b pb-2 mb-2">
          <div><strong>主题:</strong> {emailData.subject}</div>
          <div><strong>发件人:</strong> {Array.isArray(emailData.from) ? emailData.from.join(', ') : emailData.from}</div>
          <div><strong>收件人:</strong> {Array.isArray(emailData.to) ? emailData.to.join(', ') : emailData.to}</div>
          {emailData.cc && emailData.cc.length > 0 && (
            <div><strong>抄送:</strong> {Array.isArray(emailData.cc) ? emailData.cc.join(', ') : emailData.cc}</div>
          )}
          <div><strong>日期:</strong> {new Date(emailData.date).toLocaleString()}</div>
        </div>
        <div>
          <div className="font-medium mb-2">邮件内容:</div>
          <div className="whitespace-pre-wrap bg-gray-50 p-2 rounded">
            {emailData.textBody || emailData.body || '(无内容)'}
          </div>
        </div>
        {emailData.hasAttachments && (
          <div className="mt-2">
            <div className="font-medium">附件:</div>
            <div className="text-sm text-gray-500">邮件包含附件</div>
          </div>
        )}
      </div>
    )
  }

  // 渲染条件表达式预览
  const renderExpressionPreview = () => {
    return (
      <div className="mb-4 p-4 bg-gray-50 border rounded-md">
        <div className="font-medium mb-2">当前条件配置:</div>
        <div className="text-sm">
          <div><strong>类型:</strong> {trigger.condition?.type || 'N/A'}</div>
          <div><strong>脚本:</strong> {trigger.condition?.script ? '已配置' : '未配置'}</div>
          {trigger.condition?.timeout && <div><strong>超时:</strong> {trigger.condition.timeout}秒</div>}
        </div>
      </div>
    )
  }

  // 渲染动作列表预览
  const renderActionsPreview = () => {
    return (
      <div className="mb-4 p-4 bg-gray-50 border rounded-md">
        <div className="font-medium mb-2">当前动作列表:</div>
        <div className="text-sm">
          <ol className="list-decimal list-inside">
            {trigger.actions.map((action, index) => (
              <li key={index} className="mb-1">
                {action.name || action.type} {!action.enabled && <span className="text-gray-400">(已禁用)</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
  }

  // 渲染测试结果
  const renderTestResult = () => {
    if (!testResult) return null

    const { conditionResult, actionsExecuted, actionsSucceeded, duration, error } = testResult

    return (
      <div className="mt-4 space-y-4">
        <div className={`p-4 rounded-md ${error ? 'bg-red-50 border border-red-200' : conditionResult ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <div className="flex items-center">
            {error ? (
              <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
            ) : conditionResult ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 mr-2" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-500 mr-2" />
            )}
            <span className={error ? 'text-red-700' : conditionResult ? 'text-green-700' : 'text-yellow-700'}>
              {error ? (
                <span>测试失败: {error}</span>
              ) : conditionResult ? (
                <span>条件满足，执行了 {actionsExecuted} 个动作，成功 {actionsSucceeded} 个</span>
              ) : (
                <span>条件不满足，未执行动作</span>
              )}
            </span>
          </div>
          <div className="mt-2 text-sm text-gray-500">
            执行时间: {duration}ms
          </div>
        </div>

        {/* 条件评估结果 */}
        {conditionResult !== null && (
          <div className="mt-4">
            <h3 className="text-lg font-medium mb-2">条件评估结果</h3>
            {renderConditionResult()}
          </div>
        )}

        {/* 动作执行结果 */}
        {actionResults.length > 0 && (
          <div className="mt-4">
            <h3 className="text-lg font-medium mb-2">动作执行结果</h3>
            {renderActionResults()}
          </div>
        )}
      </div>
    )
  }

  // 渲染条件评估结果
  const renderConditionResult = () => {
    if (!conditionResult) return null

    return (
      <Tabs defaultValue="tree" className="w-full">
        <TabsList>
          <TabsTrigger value="tree">树形视图</TabsTrigger>
          <TabsTrigger value="json">JSON视图</TabsTrigger>
        </TabsList>
        <TabsContent value="tree" className="p-0">
          <div className="border rounded-md p-4 bg-gray-50">
            <div className="font-medium mb-2">评估详情:</div>
            {renderEvaluationTree(conditionResult.details)}
          </div>
        </TabsContent>
        <TabsContent value="json" className="p-0">
          <pre className="p-4 bg-gray-50 border rounded-md overflow-auto text-sm">
            {JSON.stringify(conditionResult.details, null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
    )
  }

  // 递归渲染评估树
  const renderEvaluationTree = (details: any, level = 0) => {
    if (!details) return null

    const paddingLeft = `${level * 16}px`

    if (details.type === 'group') {
      return (
        <div style={{ paddingLeft }}>
          <div className="flex items-center">
            <span className={`font-medium ${details.result ? 'text-green-600' : 'text-red-600'}`}>
              {details.operator?.toUpperCase()} 组
              {details.not && ' (取反)'} -
              {details.result ? ' 满足' : ' 不满足'}
            </span>
          </div>
          <div className="pl-4 border-l-2 border-gray-200 mt-1">
            {details.details?.map((item: any, index: number) => (
              <div key={index} className="mt-1">
                {renderEvaluationTree(item, level + 1)}
              </div>
            ))}
          </div>
        </div>
      )
    } else {
      return (
        <div style={{ paddingLeft }} className="mb-2">
          <div className={`p-2 rounded ${details.result ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className="flex items-center">
              {details.result ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 mr-1" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-500 mr-1" />
              )}
              <span className={`${details.result ? 'text-green-600' : 'text-red-600'}`}>
                {details.field} {details.operator} "{details.value}"
                {details.not && ' (取反)'}
              </span>
            </div>
            <div className="text-sm text-gray-500 mt-1">
              字段值: {JSON.stringify(details.fieldValue)}
            </div>
          </div>
        </div>
      )
    }
  }

  // 渲染动作执行结果
  const renderActionResults = () => {
    if (!actionResults || actionResults.length === 0) return null

    return (
      <div className="space-y-3">
        {actionResults.map((result, index) => (
          <div key={index} className={`border rounded-md p-3 ${result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 mr-2" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-500 mr-2" />
                )}
                <span className="font-medium">
                  {index + 1}. {result.pluginName || result.pluginId}
                </span>
              </div>
              <span className="text-sm text-gray-500">
                执行时间: {result.duration}ms
              </span>
            </div>

            {result.error && (
              <div className="mt-2 text-sm text-red-600">
                错误: {result.error}
              </div>
            )}

            {result.result && (
              <div className="mt-2">
                <div className="text-sm font-medium">结果:</div>
                <pre className="text-xs bg-white p-2 rounded mt-1 overflow-auto max-h-32">
                  {typeof result.result === 'object'
                    ? JSON.stringify(result.result, null, 2)
                    : String(result.result)}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>触发器调试器</CardTitle>
        <CardDescription>
          测试触发器的条件评估和动作执行
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* 触发器预览 */}
          <div className="space-y-4">
            {renderExpressionPreview()}
            {renderActionsPreview()}
          </div>

          {/* 测试数据编辑 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">测试数据</h3>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="editor">
                  <Code className="h-4 w-4 mr-2" />
                  JSON编辑器
                </TabsTrigger>
                <TabsTrigger value="preview">
                  <Mail className="h-4 w-4 mr-2" />
                  邮件预览
                </TabsTrigger>
              </TabsList>
              <TabsContent value="editor" className="p-0 pt-4">
                {renderTestDataEditor()}
              </TabsContent>
              <TabsContent value="preview" className="p-0 pt-4">
                {renderEmailPreview()}
              </TabsContent>
            </Tabs>
          </div>

          {/* 测试按钮 */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={handleTestCondition}
                disabled={isLoading}
                variant="outline"
                className="flex-1"
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <span>测试条件</span>
                )}
              </Button>

              <Button
                onClick={handleTestCompleteTrigger}
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    测试完整触发器
                  </>
                )}
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>测试失败</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* 测试结果 */}
          {testResult && renderTestResult()}
          {!testResult && conditionResult && renderConditionResult()}
        </div>
      </CardContent>
    </Card>
  )
}