'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TriggerExpression } from '@/types'
import { AlertCircle, CheckCircle2, RefreshCw, Code, Mail } from 'lucide-react'
import { expressionsToText, expressionsToJson } from './condition-utils'

interface ConditionTestProps {
  expressions: TriggerExpression[]
  onTest: (expressions: TriggerExpression[], testData: any) => Promise<any>
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

export function ConditionTest({ expressions, onTest }: ConditionTestProps) {
  const [testData, setTestData] = useState<string>(JSON.stringify(DEFAULT_TEST_DATA, null, 2))
  const [testResult, setTestResult] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('editor')

  // 执行测试
  const handleTest = async () => {
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

      // 执行测试
      const result = await onTest(expressions, parsedData)

      // 设置测试结果
      setTestResult(result)
    } catch (err) {
      console.error('测试条件失败:', err)
      setError(err instanceof Error ? err.message : '测试条件失败')
      setTestResult(null)
    } finally {
      setIsLoading(false)
    }
  }

  // 重置测试数据
  const resetTestData = () => {
    setTestData(JSON.stringify(DEFAULT_TEST_DATA, null, 2))
    setTestResult(null)
    setError(null)
  }

  // 渲染测试结果
  const renderTestResult = () => {
    if (!testResult) return null

    const { result, details } = testResult

    return (
      <div className="mt-4 space-y-4">
        <div className={`p-4 rounded-md ${result ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className="flex items-center">
            {result ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 mr-2" />
            ) : (
              <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
            )}
            <span className={result ? 'text-green-700' : 'text-red-700'}>
              条件评估结果: <strong>{result ? '满足' : '不满足'}</strong>
            </span>
          </div>
        </div>

        <Tabs defaultValue="tree" className="w-full">
          <TabsList>
            <TabsTrigger value="tree">树形视图</TabsTrigger>
            <TabsTrigger value="json">JSON视图</TabsTrigger>
          </TabsList>
          <TabsContent value="tree" className="p-0">
            <div className="border rounded-md p-4 bg-gray-50">
              <div className="font-medium mb-2">评估详情:</div>
              {renderEvaluationTree(details)}
            </div>
          </TabsContent>
          <TabsContent value="json" className="p-0">
            <pre className="p-4 bg-gray-50 border rounded-md overflow-auto text-sm">
              {JSON.stringify(details, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      </div>
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

  // 渲染条件表达式预览
  const renderExpressionPreview = () => {
    return (
      <div className="mb-4 p-4 bg-gray-50 border rounded-md">
        <div className="font-medium mb-2">当前条件表达式:</div>
        <div className="text-sm">{expressionsToText(expressions)}</div>
      </div>
    )
  }

  // 渲染测试数据编辑器
  const renderTestDataEditor = () => {
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label htmlFor="test-data">测试数据 (JSON格式)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={resetTestData}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            重置数据
          </Button>
        </div>
        <Textarea
          id="test-data"
          value={testData}
          onChange={(e) => setTestData(e.target.value)}
          rows={12}
          className="font-mono"
        />
        <p className="text-sm text-gray-500">
          输入JSON格式的邮件数据，用于测试条件表达式
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>测试条件</CardTitle>
        <CardDescription>
          创建测试数据并验证条件表达式的评估结果
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {renderExpressionPreview()}

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

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-md">
              {error}
            </div>
          )}

          <Button
            type="button"
            onClick={handleTest}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? '测试中...' : '测试条件'}
          </Button>

          {testResult && renderTestResult()}
        </div>
      </CardContent>
    </Card>
  )
}