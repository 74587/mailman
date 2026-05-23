'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
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
    ArrowLeft,
    LayoutDashboard,
    Eye,
    GripVertical,
    Code,
    Loader2,
    Lock
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { triggerService } from '@/services/trigger.service'

// 导入步骤组件
import EmailDataStep from './email-data-step'
import ExpressionStep from './expression-step'
import ActionStep from './action-step'
import TriggerInfoStep from './trigger-info-step'
import { ActionPreviewPanel } from '@/components/action-debugger/action-preview-panel'
import { StickyBreadcrumbProvider, StickyBreadcrumbBar } from '@/components/ui/sticky-breadcrumb'

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

interface TriggerEditWizardProps {
    triggerId: number
    readOnly?: boolean
}

export function TriggerEditWizard({ triggerId, readOnly = false }: TriggerEditWizardProps) {
    const router = useRouter()
    const [currentStep, setCurrentStep] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
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

    // 右侧面板宽度状态
    const [rightPanelWidth, setRightPanelWidth] = useState(320)
    const [isResizingWidth, setIsResizingWidth] = useState(false)
    const [topPanelHeight, setTopPanelHeight] = useState(40)
    const [isResizingHeight, setIsResizingHeight] = useState(false)

    // 评估结果状态
    const [evaluationResults, setEvaluationResults] = useState<Record<string, EvaluationResult>>({})
    const [isEvaluating, setIsEvaluating] = useState<string | null>(null)

    // 数据预览对话框状态
    const [isDataPreviewOpen, setIsDataPreviewOpen] = useState(false)

    // 拖拽引用
    const containerRef = useRef<HTMLDivElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const startPosRef = useRef({ x: 0, y: 0 })
    const startSizeRef = useRef({ width: 320, height: 40 })

    // 加载触发器数据
    useEffect(() => {
        const loadTrigger = async () => {
            try {
                setIsLoading(true)
                setError(null)

                const trigger = await triggerService.getTrigger(triggerId)

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
            } catch (err: any) {
                console.error('加载触发器失败:', err)
                setError(err.message || '加载触发器失败')
            } finally {
                setIsLoading(false)
            }
        }

        loadTrigger()
    }, [triggerId])

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
        if (readOnly) return

        try {
            setIsSaving(true)

            await triggerService.updateTrigger(triggerId, {
                name: data.triggerInfo.name,
                description: data.triggerInfo.description,
                status: data.triggerInfo.status,
                expressions: data.expressions,
                actions: data.actions
            } as any)

            router.push('/triggers')
        } catch (err: any) {
            console.error('保存触发器失败:', err)
            setError(err.message || '保存失败')
        } finally {
            setIsSaving(false)
        }
    }

    // 处理宽度拖拽
    const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizingWidth(true)
        startPosRef.current.x = e.clientX
        startSizeRef.current.width = rightPanelWidth
    }, [rightPanelWidth])

    // 处理高度拖拽
    const handleHeightResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizingHeight(true)
        startPosRef.current.y = e.clientY
        startSizeRef.current.height = topPanelHeight
    }, [topPanelHeight])

    // 鼠标移动处理
    React.useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizingWidth) {
                const delta = startPosRef.current.x - e.clientX
                const newWidth = Math.max(280, Math.min(500, startSizeRef.current.width + delta))
                setRightPanelWidth(newWidth)
            }
            if (isResizingHeight && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect()
                const relativeY = e.clientY - rect.top
                const percentage = (relativeY / rect.height) * 100
                const newHeight = Math.max(20, Math.min(80, percentage))
                setTopPanelHeight(newHeight)
            }
        }

        const handleMouseUp = () => {
            setIsResizingWidth(false)
            setIsResizingHeight(false)
        }

        if (isResizingWidth || isResizingHeight) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = isResizingWidth ? 'col-resize' : 'row-resize'
            document.body.style.userSelect = 'none'
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }
    }, [isResizingWidth, isResizingHeight])

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
        } else {
            router.back()
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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                    <p className="mt-4 text-gray-600">加载触发器...</p>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
                <Card className="p-6 max-w-md">
                    <h3 className="text-lg font-semibold text-red-600 mb-2">加载失败</h3>
                    <p className="text-gray-600 mb-4">{error}</p>
                    <Button onClick={() => router.back()}>返回</Button>
                </Card>
            </div>
        )
    }

    return (
        <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-gray-50 dark:bg-gray-900 -m-6 p-6">
            {/* 左侧：主操作区 */}
            <div className="flex-1 flex flex-col gap-6 overflow-hidden mr-6">
                {/* 顶部标题和进度 */}
                <Card className="p-4 flex-none shadow-sm border-0 bg-white/80 backdrop-blur dark:bg-gray-800/80">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" size="sm" onClick={() => router.back()}>
                                <ArrowLeft className="h-4 w-4 mr-1" />
                                返回
                            </Button>
                            <div>
                                <h1 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    {readOnly ? (
                                        <>
                                            <Eye className="h-5 w-5 text-blue-600" />
                                            查看触发器
                                        </>
                                    ) : (
                                        <>
                                            <Settings className="h-5 w-5 text-blue-600" />
                                            编辑触发器
                                        </>
                                    )}
                                </h1>
                                <p className="text-sm text-gray-500">
                                    {data.triggerInfo.name || '未命名触发器'}
                                </p>
                            </div>
                        </div>
                        {readOnly && (
                            <Badge variant="secondary" className="flex items-center gap-1">
                                <Lock className="h-3 w-3" />
                                只读模式
                            </Badge>
                        )}
                    </div>

                    {/* 步骤指示器 */}
                    <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-1 w-full max-w-4xl mx-auto">
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
                                                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm border-2",
                                                isActive
                                                    ? cn(step.bgColor, step.color, "border-current scale-110")
                                                    : isCompleted
                                                        ? "bg-green-500 text-white border-green-500"
                                                        : "bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800 dark:border-gray-700"
                                            )}>
                                                {isCompleted ? <Check className="w-5 h-5" /> : <StepIcon className="w-5 h-5" />}
                                            </div>
                                            <div className="mt-2 text-center">
                                                <p className={cn(
                                                    "text-sm font-semibold transition-colors duration-200",
                                                    isActive ? "text-gray-900 dark:text-white" : "text-gray-500"
                                                )}>
                                                    {step.title}
                                                </p>
                                                {isActive && (
                                                    <p className="text-xs text-gray-400 hidden md:block animate-in fade-in slide-in-from-top-1">
                                                        {step.description}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        {index < STEPS.length - 1 && (
                                            <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 mx-2 relative top-[-14px]">
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
                </Card>

                {/* 步骤内容区域，带粘性面包屑 */}
                <StickyBreadcrumbProvider scrollContainerRef={scrollContainerRef}>
                    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pr-2 scrollbar-hide relative">
                        <StickyBreadcrumbBar />
                        <div className="max-w-4xl mx-auto pb-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {renderStepComponent()}
                        </div>
                    </div>
                </StickyBreadcrumbProvider>
            </div>

            {/* 右侧：概览面板 */}
            <div className="hidden lg:flex relative">
                <div
                    className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-blue-400 group"
                    onMouseDown={handleWidthResizeStart}
                >
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <GripVertical className="w-3 h-3 text-gray-400" />
                    </div>
                </div>

                <Card
                    ref={containerRef}
                    style={{ width: rightPanelWidth }}
                    className="flex-none flex flex-col bg-white/90 backdrop-blur shadow-lg border-l-4 border-l-primary/20 dark:bg-gray-800/90 ml-1 h-full"
                >
                    {/* 上半部分：全局配置概览 */}
                    <div style={{ height: `${topPanelHeight}%` }} className="flex flex-col overflow-hidden min-h-0">
                        <div className="p-3 border-b dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex-shrink-0 flex items-center justify-between">
                            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                                <LayoutDashboard className="w-4 h-4" />
                                配置概览
                            </h3>
                            {(data.emailData?.selectedEmail || data.emailData?.sampleData) && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-6 p-0"
                                    title="查看完整测试数据"
                                    onClick={() => setIsDataPreviewOpen(true)}
                                >
                                    <Eye className="h-3.5 w-3.5" />
                                </Button>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-3">
                            {/* 触发器信息 */}
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="font-medium text-gray-500">触发器名称</span>
                                </div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    {data.triggerInfo?.name || '未命名'}
                                </p>
                            </div>
                            {/* 条件概览 */}
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="font-medium text-gray-500">过滤条件</span>
                                    <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded-full">{data.expressions?.length || 0}</span>
                                </div>
                            </div>
                            {/* 动作概览 */}
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="font-medium text-gray-500">执行动作</span>
                                    <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded-full">{data.actions?.length || 0}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 高度调整手柄 */}
                    <div
                        className="h-1 cursor-row-resize hover:bg-blue-400 bg-gray-200 dark:bg-gray-700 flex-shrink-0"
                        onMouseDown={handleHeightResizeStart}
                    />

                    {/* 下半部分：详情 */}
                    <div style={{ height: `${100 - topPanelHeight}%` }} className="flex flex-col overflow-hidden min-h-0">
                        <div className="p-3 border-b dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex-shrink-0">
                            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                                <Code className="w-4 h-4" />
                                选中项详情
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3">
                            {currentStep === 2 && selectedAction ? (
                                <ActionPreviewPanel
                                    action={selectedAction}
                                    testData={data.emailData?.sampleData || {}}
                                    executionResult={actionExecutionResult}
                                />
                            ) : (
                                <div className="text-xs text-gray-400 italic text-center py-8 border-2 border-dashed border-gray-100 rounded-lg">
                                    点击左侧内容<br />
                                    查看配置详情
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 底部操作 */}
                    <div className="p-3 border-t dark:border-gray-700 bg-gray-50/50 flex-shrink-0 space-y-2">
                        {!readOnly && currentStep === STEPS.length - 1 && (
                            <Button
                                className="w-full"
                                onClick={handleSave}
                                disabled={isSaving}
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        保存中...
                                    </>
                                ) : (
                                    '保存修改'
                                )}
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            className="w-full text-xs h-7"
                            onClick={() => router.push('/triggers')}
                        >
                            {readOnly ? '返回列表' : '取消编辑'}
                        </Button>
                    </div>
                </Card>
            </div>

            {/* 数据预览对话框 */}
            <Dialog open={isDataPreviewOpen} onOpenChange={setIsDataPreviewOpen}>
                <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Eye className="w-5 h-5" />
                            完整测试数据预览
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-auto border rounded-lg bg-gray-50 dark:bg-gray-800 p-4">
                        <pre className="text-xs font-mono whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300">
                            {JSON.stringify(
                                data.emailData?.sampleData || data.emailData?.selectedEmail || {},
                                null,
                                2
                            )}
                        </pre>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default TriggerEditWizard
