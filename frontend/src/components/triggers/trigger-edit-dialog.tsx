'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
    Mail,
    Filter,
    Zap,
    Settings,
    Check,
    LayoutDashboard,
    Eye,
    GripVertical,
    Code,
    Loader2,
    Lock,
    X
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { triggerService } from '@/services/trigger.service'
import { EmailTrigger } from '@/types'

// 导入步骤组件
import EmailDataStep from './create/email-data-step'
import ExpressionStep from './create/expression-step'
import ActionStep from './create/action-step'
import TriggerInfoStep from './create/trigger-info-step'
import { ActionPreviewPanel } from '@/components/action-debugger/action-preview-panel'

// 步骤定义
const STEPS = [
    {
        id: 'data',
        title: '数据源',
        description: '测试用的邮件数据',
        icon: Mail,
        color: 'text-blue-500',
        bgColor: 'bg-blue-100 dark:bg-blue-900/20'
    },
    {
        id: 'condition',
        title: '过滤条件',
        description: '触发的规则条件',
        icon: Filter,
        color: 'text-purple-500',
        bgColor: 'bg-purple-100 dark:bg-purple-900/20'
    },
    {
        id: 'action',
        title: '执行动作',
        description: '触发后的执行动作',
        icon: Zap,
        color: 'text-amber-500',
        bgColor: 'bg-amber-100 dark:bg-amber-900/20'
    },
    {
        id: 'info',
        title: '基本信息',
        description: '名称和描述',
        icon: Settings,
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/20'
    }
]

interface SelectedExpressionInfo {
    id: string
    type: 'condition' | 'plugin' | 'group' | 'expression'
    field?: string
    operator?: string
    value?: any
    pluginId?: string
    fields?: Record<string, any>
    fullExpression?: any
}

interface EvaluationResult {
    expressionId: string
    result: boolean
    details?: any
    error?: string
    timestamp: number
}

interface TriggerEditDialogProps {
    trigger: EmailTrigger | null
    open: boolean
    onOpenChange: (open: boolean) => void
    readOnly?: boolean
    onSaved?: () => void
}

export function TriggerEditDialog({ trigger, open, onOpenChange, readOnly = false, onSaved }: TriggerEditDialogProps) {
    const [currentStep, setCurrentStep] = useState(0)
    const [isLoading, setIsLoading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [data, setData] = useState<any>({
        emailData: { source: 'api', selectedEmail: null, isManualInput: false, manualEmailData: '' },
        expressions: [],
        actions: [],
        triggerInfo: { name: '', description: '', enabled: true }
    })

    // 选中的表达式信息
    const [selectedExpression, setSelectedExpression] = useState<SelectedExpressionInfo | null>(null)
    const [selectedAction, setSelectedAction] = useState<any>(null)
    const [actionExecutionResult, setActionExecutionResult] = useState<any>()

    // 评估结果状态
    const [evaluationResults, setEvaluationResults] = useState<Record<string, EvaluationResult>>({})
    const [isEvaluating, setIsEvaluating] = useState<string | null>(null)

    // 当 trigger 变化时加载数据
    useEffect(() => {
        if (trigger && open) {
            // 将触发器数据转换为向导格式
            setData({
                emailData: {
                    source: 'api',
                    selectedEmail: null,
                    isManualInput: false,
                    manualEmailData: '',
                    sampleData: {}
                },
                expressions: trigger.expressions || [],
                actions: trigger.actions || [],
                triggerInfo: {
                    name: trigger.name || '',
                    description: trigger.description || '',
                    status: trigger.status || 'enabled'
                }
            })
            setCurrentStep(0)
            setError(null)
        }
    }, [trigger, open])

    // 处理数据变更（只读模式下禁用）
    const handleDataChange = useCallback((key: string, value: any) => {
        if (readOnly) return
        setData((prev: any) => ({
            ...prev,
            [key]: value
        }))
    }, [readOnly])

    // 处理表达式选中
    const handleExpressionSelect = (expression: SelectedExpressionInfo | null) => {
        setSelectedExpression(expression)
    }

    // 处理动作选中
    const handleActionSelect = useCallback((action: any, executionResult?: any) => {
        setSelectedAction(action)
        setActionExecutionResult(executionResult)
    }, [])

    // 评估表达式
    const handleEvaluateExpression = useCallback(async (expressionId: string, expression: any) => {
        if (isEvaluating) return

        setIsEvaluating(expressionId)
        try {
            const testData = data.emailData?.sampleData || {}
            const response = await apiClient.post('/v2/triggers/test-condition', {
                expressions: [expression],
                testData
            })

            setEvaluationResults(prev => ({
                ...prev,
                [expressionId]: {
                    expressionId,
                    result: response.result,
                    details: response.evaluation,
                    timestamp: Date.now()
                }
            }))
        } catch (error: any) {
            setEvaluationResults(prev => ({
                ...prev,
                [expressionId]: {
                    expressionId,
                    result: false,
                    error: error.message || '评估失败',
                    timestamp: Date.now()
                }
            }))
        } finally {
            setIsEvaluating(null)
        }
    }, [data.emailData?.sampleData, isEvaluating])

    // 处理保存
    const handleSave = async () => {
        if (readOnly || !trigger) return

        try {
            setIsSaving(true)

            await triggerService.updateTrigger(trigger.id, {
                name: data.triggerInfo.name,
                description: data.triggerInfo.description,
                status: data.triggerInfo.status,
                expressions: data.expressions,
                actions: data.actions
            } as any)

            onOpenChange(false)
            onSaved?.()
        } catch (err: any) {
            console.error('保存触发器失败:', err)
            setError(err.message || '保存失败')
        } finally {
            setIsSaving(false)
        }
    }

    // 导航处理
    const handleNext = () => {
        if (currentStep < STEPS.length - 1) {
            setCurrentStep(prev => prev + 1)
        } else if (!readOnly) {
            handleSave()
        }
    }

    const handlePrevious = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1)
        }
    }

    // 渲染当前步骤组件
    const renderStepComponent = () => {
        const commonProps = {
            data,
            onDataChange: handleDataChange,
            onNext: handleNext,
            onPrevious: handlePrevious,
            readOnly
        }

        switch (currentStep) {
            case 0:
                return <EmailDataStep {...commonProps} stepStatus={STEPS.map((_, i) => i < currentStep)} />
            case 1:
                return (
                    <ExpressionStep
                        {...commonProps}
                        onExpressionSelect={handleExpressionSelect}
                        onEvaluate={handleEvaluateExpression}
                        evaluationResults={evaluationResults}
                        isEvaluating={isEvaluating}
                    />
                )
            case 2:
                return <ActionStep {...commonProps} onActionSelect={handleActionSelect} />
            case 3:
                return <TriggerInfoStep {...commonProps} />
            default:
                return null
        }
    }

    if (!trigger) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[90vw] w-[1200px] max-h-[90vh] h-[800px] p-0 flex flex-col overflow-hidden">
                {/* 头部 */}
                <DialogHeader className="p-4 border-b flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="flex items-center gap-2">
                            {readOnly ? (
                                <>
                                    <Eye className="h-5 w-5 text-blue-600" />
                                    查看触发器: {trigger.name}
                                </>
                            ) : (
                                <>
                                    <Settings className="h-5 w-5 text-blue-600" />
                                    编辑触发器: {trigger.name}
                                </>
                            )}
                            {readOnly && (
                                <Badge variant="secondary" className="ml-2 flex items-center gap-1">
                                    <Lock className="h-3 w-3" />
                                    只读
                                </Badge>
                            )}
                        </DialogTitle>
                    </div>
                </DialogHeader>

                {/* 步骤指示器 */}
                <div className="px-4 py-3 border-b bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
                    <div className="flex items-center space-x-1 w-full max-w-3xl mx-auto">
                        {STEPS.map((step, index) => {
                            const isActive = index === currentStep
                            const isCompleted = index < currentStep
                            const StepIcon = step.icon

                            return (
                                <React.Fragment key={step.id}>
                                    <div
                                        className={cn(
                                            "relative flex flex-col items-center group cursor-pointer",
                                            isActive ? "flex-none" : "flex-1"
                                        )}
                                        onClick={() => setCurrentStep(index)}
                                    >
                                        <div className={cn(
                                            "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm border-2",
                                            isActive
                                                ? cn(step.bgColor, step.color, "border-current scale-110")
                                                : isCompleted
                                                    ? "bg-green-500 text-white border-green-500"
                                                    : "bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800 dark:border-gray-700"
                                        )}>
                                            {isCompleted ? <Check className="w-4 h-4" /> : <StepIcon className="w-4 h-4" />}
                                        </div>
                                        <div className="mt-1 text-center">
                                            <p className={cn(
                                                "text-xs font-medium transition-colors duration-200",
                                                isActive ? "text-gray-900 dark:text-white" : "text-gray-500"
                                            )}>
                                                {step.title}
                                            </p>
                                        </div>
                                    </div>
                                    {index < STEPS.length - 1 && (
                                        <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 mx-1 relative top-[-10px]">
                                            <div
                                                className="absolute inset-0 bg-green-500 transition-all duration-500"
                                                style={{ width: isCompleted ? '100%' : '0%' }}
                                            />
                                        </div>
                                    )}
                                </React.Fragment>
                            )
                        })}
                    </div>
                </div>

                {/* 步骤内容区域 */}
                <div className="flex-1 overflow-y-auto p-4">
                    <div className="max-w-3xl mx-auto">
                        {renderStepComponent()}
                    </div>
                </div>

                {/* 底部操作栏 */}
                <div className="p-4 border-t bg-gray-50 dark:bg-gray-800/50 flex-shrink-0">
                    <div className="flex items-center justify-between max-w-3xl mx-auto">
                        <Button
                            variant="outline"
                            onClick={handlePrevious}
                            disabled={currentStep === 0}
                        >
                            上一步
                        </Button>

                        <div className="flex items-center gap-2">
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                {readOnly ? '关闭' : '取消'}
                            </Button>

                            {currentStep === STEPS.length - 1 ? (
                                !readOnly && (
                                    <Button onClick={handleSave} disabled={isSaving}>
                                        {isSaving ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                保存中...
                                            </>
                                        ) : (
                                            '保存修改'
                                        )}
                                    </Button>
                                )
                            ) : (
                                <Button onClick={handleNext}>
                                    下一步
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* 错误提示 */}
                {error && (
                    <div className="absolute bottom-20 left-4 right-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg">
                        {error}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

export default TriggerEditDialog
