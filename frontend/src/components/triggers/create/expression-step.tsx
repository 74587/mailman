'use client'

import React, { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiClient } from '@/lib/api-client'
import {
    Filter,
    Play,
    CheckCircle,
    XCircle,
    AlertCircle,
    Eye,
    ChevronRight,
    ChevronLeft,
    Database,
    FlaskConical
} from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { FilterSection } from '@/components/filter-action-trigger/filter-section'
import { FilterTestDialog } from './filter-test-dialog'
import { AncestorProvider, BreadcrumbItem } from '@/components/ui/sticky-breadcrumb'

interface ExpressionStepProps {
    data: any
    onDataChange: (key: string, value: any) => void
    onNext?: () => void
    onPrevious?: () => void
    onExpressionSelect?: (expression: any) => void
    onEvaluate?: (expressionId: string, expression: any) => Promise<void>
    evaluationResults?: Record<string, {
        expressionId: string
        result: boolean
        details?: any
        error?: string
        timestamp: number
    }>
    isEvaluating?: string | null
    readOnly?: boolean
    stepNumber?: number  // 可选的步骤编号
    pluginContext?: 'trigger' | 'pickup' | 'interceptor'
}

interface TestResult {
    passed: boolean
    message: string
    details?: any
}

const STEP_NAMES = ['第一步', '第二步', '第三步', '第四步']

export default function ExpressionStep({
    data,
    onDataChange,
    onNext,
    onPrevious,
    onExpressionSelect,
    onEvaluate,
    evaluationResults,
    isEvaluating,
    readOnly,
    stepNumber,
    pluginContext = 'trigger'
}: ExpressionStepProps) {
    const [isTestingExpression, setIsTestingExpression] = useState(false)
    const [testResult, setTestResult] = useState<TestResult | null>(null)
    const [showDataPreview, setShowDataPreview] = useState(false)
    const [showFilterTestDialog, setShowFilterTestDialog] = useState(false)

    const expressions = data.expressions || []
    const emailData = data.emailData?.sampleData || {}

    // 更新表达式
    const handleExpressionsChange = useCallback((newExpressions: any[]) => {
        onDataChange('expressions', newExpressions)
        // 清除之前的测试结果
        setTestResult(null)
    }, [onDataChange])

    // 测试表达式
    const testExpressions = useCallback(async () => {
        if (!emailData || Object.keys(emailData).length === 0) {
            setTestResult({
                passed: false,
                message: '请先在第一步选择邮件数据'
            })
            return
        }

        if (expressions.length === 0) {
            setTestResult({
                passed: false,
                message: '请先添加过滤表达式'
            })
            return
        }

        setIsTestingExpression(true)
        setTestResult(null)

        try {
            const result = await apiClient.post<any>('/v2/triggers/test-condition', {
                expressions,
                testData: emailData
            })

            // V2 返回 { result: boolean, evaluation: object }
            if (result.result === true) {
                setTestResult({
                    passed: true,
                    message: '表达式测试通过 (匹配成功)',
                    details: result.evaluation
                })
            } else {
                setTestResult({
                    passed: false,
                    message: '条件不满足 (未匹配)',
                    details: result.evaluation
                })
            }
        } catch (error: any) {
            console.error('测试表达式失败:', error)
            setTestResult({
                passed: false,
                message: error.message || '测试过程中发生错误'
            })
        } finally {
            setIsTestingExpression(false)
        }
    }, [expressions, emailData])

    // 检查是否可以继续下一步
    const canProceed = () => {
        // 检查根条件组内是否有条件
        // 如果没有任何条件，要求用户至少添加一个
        if (expressions.length === 0) return false
        const rootGroup = expressions[0]
        if (!rootGroup || !rootGroup.conditions || rootGroup.conditions.length === 0) {
            return false
        }
        return true
    }

    return (
        <div className="relative space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Filter className="h-5 w-5" />
                        {stepNumber !== undefined ? `${STEP_NAMES[stepNumber]}：配置过滤表达式` : '配置过滤表达式'}
                    </CardTitle>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        配置邮件过滤条件并测试匹配结果
                    </p>
                </CardHeader>
                <CardContent className="space-y-6">

                    {/* 过滤器配置 - 使用 AncestorProvider 提供步骤级别的面包屑上下文 */}
                    {/* skipFromPath=true 使"过滤条件"不显示在面包屑中 */}
                    <div className="space-y-4">
                        <AncestorProvider currentItem={{
                            id: 'expression-step',
                            type: 'root' as const,
                            label: '过滤条件',
                            description: `${expressions.length} 个条件组`,
                            level: 0
                        }} skipFromPath={true}>
                            <FilterSection
                                filters={expressions}
                                onChange={handleExpressionsChange}
                                testData={emailData}
                                onExpressionSelect={onExpressionSelect}
                                onEvaluate={onEvaluate}
                                evaluationResults={evaluationResults}
                                isEvaluating={isEvaluating}
                                pluginContext={pluginContext}
                            />
                        </AncestorProvider>
                    </div>
                </CardContent>
            </Card>

            {/* 底部导航栏 - 只有当提供了 onNext/onPrevious 时才显示 */}
            {(onNext || onPrevious) && (
                <div className="flex justify-between items-center pt-4">
                    <Button
                        variant="outline"
                        onClick={onPrevious}
                        disabled={!onPrevious}
                    >
                        <ChevronLeft className="w-4 h-4 mr-2" />
                        上一步
                    </Button>

                    <div className="flex items-center gap-3">
                        {/* 测试过滤效果按钮 */}
                        <Button
                            variant="outline"
                            onClick={() => setShowFilterTestDialog(true)}
                            disabled={!canProceed()}
                            className="border-primary-200 dark:border-primary-800 hover:bg-primary-50 dark:hover:bg-primary-900/20"
                        >
                            <Database className="w-4 h-4 mr-2" />
                            测试过滤效果
                        </Button>

                        <Button
                            onClick={onNext}
                            disabled={!canProceed() || !onNext}
                            className={canProceed() ? "bg-primary-600 hover:bg-primary-700 text-white" : ""}
                        >
                            下一步
                            <ChevronRight className="w-4 h-4 ml-2" />
                        </Button>
                    </div>
                </div>
            )}



            {/* 数据预览 Dialog */}
            <Dialog open={showDataPreview} onOpenChange={setShowDataPreview}>
                <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>邮件数据预览</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded p-4 border dark:border-gray-700 mt-2">
                        <div className="flex flex-wrap gap-2 mb-4">
                            <Badge variant="outline">
                                来源: {data.emailData?.source === 'api' ? 'API搜索' : '手动输入'}
                            </Badge>
                            {emailData.ID && <Badge variant="outline">ID: {emailData.ID}</Badge>}
                        </div>
                        <pre className="text-xs font-mono whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                            {JSON.stringify(emailData, null, 2)}
                        </pre>
                    </div>
                </DialogContent>
            </Dialog>

            {/* 过滤测试对话框 */}
            <FilterTestDialog
                open={showFilterTestDialog}
                onOpenChange={setShowFilterTestDialog}
                expressions={expressions}
            />
        </div>
    )
}
