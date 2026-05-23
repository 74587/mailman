'use client'
import { logger } from '@/lib/logger';

import React, { useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import {
    Mail,
    Filter,
    Zap,
    Settings,
    Check,
    ChevronRight,
    ArrowLeft,
    LayoutDashboard,
    FileText,
    Eye,
    ChevronDown,
    ChevronUp,
    Play,
    CheckCircle2,
    XCircle,
    Loader2,
    GripVertical,
    Code,
    CheckCircle
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'

// 导入步骤组件
import EmailDataStep from './email-data-step'
import ExpressionStep from './expression-step'
import ActionStep from './action-step'
import TriggerInfoStep from './trigger-info-step'
import { ActionPreviewPanel } from '@/components/action-debugger/action-preview-panel'
import { VariablesPreviewPanel } from './variables-preview-panel'
import { StickyBreadcrumbProvider, StickyBreadcrumbBar } from '@/components/ui/sticky-breadcrumb'
import { EmbeddedActionStructurePanel } from '@/components/ui/action-structure-panel'

// 步骤定义
const STEPS = [
    {
        id: 'data',
        title: '数据源',
        description: '选择测试用的邮件数据',
        icon: Mail,
        color: 'text-blue-500',
        bgColor: 'bg-blue-100 dark:bg-blue-900/20'
    },
    {
        id: 'condition',
        title: '过滤条件',
        description: '定义触发的规则条件',
        icon: Filter,
        color: 'text-purple-500',
        bgColor: 'bg-purple-100 dark:bg-purple-900/20'
    },
    {
        id: 'action',
        title: '执行动作',
        description: '配置触发后的执行动作',
        icon: Zap,
        color: 'text-amber-500',
        bgColor: 'bg-amber-100 dark:bg-amber-900/20'
    },
    {
        id: 'info',
        title: '基本信息',
        description: '设置名称并保存',
        icon: Settings,
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/20'
    }
]

// 选中表达式的类型定义
interface SelectedExpressionInfo {
    id: string
    type: 'condition' | 'plugin' | 'group' | 'expression'
    field?: string
    operator?: string
    value?: any
    pluginId?: string
    fields?: Record<string, any>
    // 完整的表达式对象，用于评估
    fullExpression?: any
}

// 评估结果类型
interface EvaluationResult {
    expressionId: string
    result: boolean
    details?: any
    error?: string
    timestamp: number
}

export function TriggerCreationWizard() {
    const router = useRouter()
    const [currentStep, setCurrentStep] = useState(0)
    const [showSuccessDialog, setShowSuccessDialog] = useState(false)
    const [triggerSave, setTriggerSave] = useState(0)  // 用于触发保存
    const [data, setData] = useState<any>({
        emailData: { source: 'api', selectedEmail: null, isManualInput: false, manualEmailData: '' },
        expressions: [],
        actions: [],
        triggerInfo: { name: '', description: '', enabled: true }
    })

    // 选中的表达式信息
    const [selectedExpression, setSelectedExpression] = useState<SelectedExpressionInfo | null>(null)

    // 选中的动作信息
    const [selectedAction, setSelectedAction] = useState<any>(null)
    const [selectedActionIndex, setSelectedActionIndex] = useState<number | null>(null)

    // 动作执行结果
    const [actionExecutionResult, setActionExecutionResult] = useState<{ actionId: string; success: boolean; message?: string; details?: any } | undefined>()

    // 右侧面板宽度状态（像素）
    const [rightPanelWidth, setRightPanelWidth] = useState(320)
    const [isResizingWidth, setIsResizingWidth] = useState(false)

    // 上下面板高度比例状态
    const [topPanelHeight, setTopPanelHeight] = useState(40) // 百分比
    const [isResizingHeight, setIsResizingHeight] = useState(false)

    // 评估结果状态 - 按表达式ID存储
    const [evaluationResults, setEvaluationResults] = useState<Record<string, EvaluationResult>>({})
    const [isEvaluating, setIsEvaluating] = useState<string | null>(null)

    // 数据预览对话框状态
    const [isDataPreviewOpen, setIsDataPreviewOpen] = useState(false)

    // 评估结果展开状态
    const [isDetailsExpanded, setIsDetailsExpanded] = useState(false)

    // 拖拽引用
    const containerRef = useRef<HTMLDivElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const startPosRef = useRef({ x: 0, y: 0 })
    const startSizeRef = useRef({ width: 320, height: 40 })

    // 处理数据变更
    const handleDataChange = (key: string, value: any) => {
        logger.debug(`Wizard Data Update [${key}]:`, value)
        setData((prev: any) => ({
            ...prev,
            [key]: value
        }))
    }

    // 处理表达式选中
    const handleExpressionSelect = (expression: SelectedExpressionInfo | null) => {
        setSelectedExpression(expression)
        // 切换表达式时折叠详情
        setIsDetailsExpanded(false)
    }

    // 处理动作选中
    const handleActionSelect = useCallback((action: any, executionResult?: any, actionIndex?: number) => {
        setSelectedAction(action)
        setActionExecutionResult(executionResult)
        setSelectedActionIndex(actionIndex ?? null)
    }, [])

    // 评估单个表达式
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

    // 评估当前选中的表达式
    const handleEvaluateSelectedExpression = useCallback(() => {
        if (!selectedExpression) return

        // 从 data.expressions 中找到完整的表达式对象
        const findExpression = (expressions: any[], targetId: string): any => {
            for (const expr of expressions) {
                if (expr.id === targetId) return expr
                if (expr.type === 'group' && expr.conditions) {
                    const found = findExpression(expr.conditions, targetId)
                    if (found) return found
                }
            }
            return null
        }

        const fullExpr = findExpression(data.expressions, selectedExpression.id)
        if (fullExpr) {
            handleEvaluateExpression(selectedExpression.id, fullExpr)
        }
    }, [selectedExpression, data.expressions, handleEvaluateExpression])

    // 处理右侧面板宽度拖拽
    const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizingWidth(true)
        startPosRef.current.x = e.clientX
        startSizeRef.current.width = rightPanelWidth
    }, [rightPanelWidth])

    // 处理上下面板高度拖拽
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

    // 获取字段在测试数据中的值
    const getFieldValueFromTestData = useMemo(() => {
        if (!selectedExpression) return null

        const testData = data.emailData?.sampleData || {}
        if (Object.keys(testData).length === 0) return null

        let fieldPath: string | undefined
        if (selectedExpression.type === 'condition') {
            fieldPath = selectedExpression.field
        } else if (selectedExpression.type === 'plugin' && selectedExpression.fields) {
            fieldPath = selectedExpression.fields.field as string
        }

        if (!fieldPath) return null

        const parts = fieldPath.split('.')
        let value: any = testData
        for (const part of parts) {
            if (value === undefined || value === null) break
            value = value[part]
        }

        return {
            path: fieldPath,
            value: value,
            exists: value !== undefined
        }
    }, [selectedExpression, data.emailData?.sampleData])

    // 获取当前选中表达式的评估结果
    const currentEvaluationResult = useMemo(() => {
        if (!selectedExpression) return null
        return evaluationResults[selectedExpression.id] || null
    }, [selectedExpression, evaluationResults])

    // 检查当前步骤是否可以继续
    const canProceed = useCallback(() => {
        switch (currentStep) {
            case 0: // 数据源步骤
                const emailData = data.emailData
                if (emailData?.isManualInput) {
                    return !!emailData.manualEmailData && emailData.sampleData !== null
                }
                return !!emailData?.selectedEmail || !!emailData?.sampleData
            case 1: // 过滤条件步骤
                const expressions = data.expressions || []
                if (expressions.length === 0) return false
                const rootGroup = expressions[0]
                if (!rootGroup || !rootGroup.conditions || rootGroup.conditions.length === 0) {
                    return false
                }
                return true
            case 2: // 执行动作步骤
                return (data.actions || []).length > 0
            case 3: // 触发器信息步骤
                const triggerInfo = data.triggerInfo || {}
                return triggerInfo.name?.trim() !== '' &&
                    (data.expressions || []).length > 0 &&
                    (data.actions || []).length > 0
            default:
                return true
        }
    }, [currentStep, data])

    // 导航处理
    const handleNext = () => {
        if (!canProceed()) return

        if (currentStep < STEPS.length - 1) {
            setCurrentStep(prev => prev + 1)
            window.scrollTo({ top: 0, behavior: 'smooth' })
        } else {
            // 最后一步，触发保存
            setTriggerSave(prev => prev + 1)
        }
    }

    // 保存成功回调
    const handleSaveSuccess = () => {
        setShowSuccessDialog(true)
    }

    // 关闭当前 Tab
    const handleCloseTab = () => {
        setShowSuccessDialog(false)
        window.dispatchEvent(new CustomEvent('closeTab', {
            detail: { tabId: 'trigger-create' }
        }))
    }

    // 继续编辑
    const handleContinueEdit = () => {
        setShowSuccessDialog(false)
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
        // 不传递 onNext/onPrevious 给子组件，避免显示内部导航按钮
        // wizard 底部已有统一的导航栏
        const commonProps = {
            data,
            onDataChange: handleDataChange
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
                return <TriggerInfoStep {...commonProps} onSaveSuccess={handleSaveSuccess} triggerSave={triggerSave} />
            default:
                return null
        }
    }

    // 获取表达式类型的显示文本
    const getExpressionTypeLabel = (type: string, pluginId?: string) => {
        switch (type) {
            case 'condition': return '字段匹配'
            case 'plugin': return '插件条件'
            case 'group': return '条件组'
            case 'expression': {
                // 根据 pluginId 显示具体的表达式引擎类型
                const engineMap: Record<string, string> = {
                    'expr.javascript': 'JavaScript 表达式',
                    'expr.cel': 'CEL 表达式',
                    'expr.go-template': 'Go Template',
                    'expr.go_template': 'Go Template',
                    'expr.jsonpath': 'JSONPath 表达式'
                }
                return engineMap[pluginId || ''] || '自定义表达式'
            }
            default: return '未知类型'
        }
    }

    // 获取操作符的显示文本
    const getOperatorLabel = (operator: string) => {
        const operatorMap: Record<string, string> = {
            'equals': '等于',
            'not_equals': '不等于',
            'contains': '包含',
            'not_contains': '不包含',
            'starts_with': '开头是',
            'ends_with': '结尾是',
            'greater_than': '大于',
            'less_than': '小于',
            'in': '在列表中',
            'not_in': '不在列表中',
            'and': '并且',
            'or': '或者',
            'not': '非'
        }
        return operatorMap[operator] || operator
    }

    return (
        <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-gray-50 dark:bg-gray-900 -m-6 p-6">
            {/* 左侧：主操作区 */}
            <div className="flex-1 flex flex-col overflow-hidden mr-6">
                {/* 顶部进度条 */}
                <Card className="p-4 flex-none shadow-sm border-0 bg-white/80 backdrop-blur dark:bg-gray-800/80">
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
                                            onClick={() => index < currentStep && setCurrentStep(index)}
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

                {/* 步骤内容区域 - 可滚动，带粘性面包屑 */}
                <StickyBreadcrumbProvider scrollContainerRef={scrollContainerRef}>
                    <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto pr-2 scrollbar-hide relative">
                        {/* 粘性面包屑栏 */}
                        <StickyBreadcrumbBar />
                        <div className="max-w-4xl mx-auto pb-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {renderStepComponent()}
                        </div>
                    </div>
                </StickyBreadcrumbProvider>

                {/* 底部导航 - 固定在底部 */}
                <div className="flex-shrink-0 p-4 border-t bg-white dark:bg-gray-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                    <div className="flex items-center justify-between max-w-4xl mx-auto">
                        <Button
                            variant="outline"
                            onClick={handlePrevious}
                            disabled={currentStep === 0}
                        >
                            ← 上一步
                        </Button>
                        <div className="text-sm text-gray-500">
                            第 {currentStep + 1} / {STEPS.length} 步
                        </div>
                        <Button
                            onClick={handleNext}
                            disabled={!canProceed()}
                            className={canProceed() ? '' : 'opacity-50 cursor-not-allowed'}
                        >
                            {currentStep === STEPS.length - 1 ? '完成创建' : '下一步 →'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* 右侧：概览面板 - 可调整宽度 */}
            <div className="hidden lg:flex relative">
                {/* 宽度调整手柄 */}
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
                                全局配置概览
                            </h3>
                            <div className="flex items-center gap-1">
                                {/* 预览数据按钮 */}
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
                                {/* 全局测试按钮 */}
                                {currentStep === 1 && data.expressions?.length > 0 && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 text-xs px-2"
                                        title="测试所有表达式"
                                        onClick={async () => {
                                            // 评估所有表达式
                                            for (const expr of data.expressions) {
                                                await handleEvaluateExpression(expr.id, expr)
                                            }
                                        }}
                                        disabled={isEvaluating !== null}
                                    >
                                        {isEvaluating !== null ? (
                                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                        ) : (
                                            <Play className="h-3 w-3 mr-1" />
                                        )}
                                        全局测试
                                    </Button>
                                )}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-3">
                            {/* 数据概览 */}
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="font-medium text-gray-500">测试数据</span>
                                    {data.emailData?.selectedEmail || data.emailData?.manualEmailData ? (
                                        <span className="text-green-600 text-xs bg-green-50 px-1.5 py-0.5 rounded-full">已就绪</span>
                                    ) : (
                                        <span className="text-gray-400 text-xs">未选择</span>
                                    )}
                                </div>
                                {data.emailData?.selectedEmail && (
                                    <div className="text-xs bg-gray-50 p-2 rounded border">
                                        <div className="truncate text-gray-700">{data.emailData.selectedEmail.Subject || '(无主题)'}</div>
                                    </div>
                                )}
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
                            {/* 变量预览面板 */}
                            <VariablesPreviewPanel
                                selectedActionIndex={selectedActionIndex}
                                actions={data.actions || []}
                                currentStep={currentStep}
                            />
                        </div>
                    </div>

                    {/* 高度调整手柄 */}
                    <div
                        className="h-1 cursor-row-resize hover:bg-blue-400 bg-gray-200 dark:bg-gray-700 flex-shrink-0"
                        onMouseDown={handleHeightResizeStart}
                    />

                    {/* 下半部分：配置概览 */}
                    <div style={{ height: `${100 - topPanelHeight}%` }} className="flex flex-col overflow-hidden min-h-0">
                        <div className="p-3 border-b dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex-shrink-0 flex items-center justify-between">
                            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                                {currentStep === 2 ? (
                                    <>
                                        <Zap className="w-4 h-4" />
                                        动作配置概览
                                    </>
                                ) : currentStep === 3 ? (
                                    <>
                                        <Settings className="w-4 h-4" />
                                        详细配置概览
                                    </>
                                ) : (
                                    <>
                                        <Code className="w-4 h-4" />
                                        表达式配置概览
                                    </>
                                )}
                            </h3>
                            {/* 执行按钮 - 仅在过滤条件步骤显示 */}
                            {currentStep === 1 && selectedExpression && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs px-2"
                                    title="执行选中的表达式"
                                    onClick={handleEvaluateSelectedExpression}
                                    disabled={isEvaluating === selectedExpression.id}
                                >
                                    {isEvaluating === selectedExpression.id ? (
                                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                    ) : (
                                        <Play className="h-3 w-3 mr-1" />
                                    )}
                                    执行
                                </Button>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto p-3">
                            {currentStep === 1 && selectedExpression ? (
                                <div className="space-y-3">
                                    {/* 表达式类型 */}
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            "text-xs font-medium px-2 py-0.5 rounded-full",
                                            selectedExpression.type === 'group'
                                                ? 'bg-purple-100 text-purple-700'
                                                : selectedExpression.type === 'plugin'
                                                    ? 'bg-amber-100 text-amber-700'
                                                    : selectedExpression.type === 'expression'
                                                        ? 'bg-green-100 text-green-700'
                                                        : 'bg-blue-100 text-blue-700'
                                        )}>
                                            {getExpressionTypeLabel(selectedExpression.type, selectedExpression.pluginId)}
                                        </span>
                                    </div>

                                    {/* 字段预览 - 放在第一个位置 */}
                                    {selectedExpression.type !== 'group' && getFieldValueFromTestData && (
                                        <div className="space-y-1">
                                            <div className="text-xs font-medium text-gray-500 flex items-center gap-1">
                                                <Eye className="w-3 h-3" />
                                                字段值预览
                                            </div>
                                            <div className="text-xs bg-blue-50 p-2 rounded border border-blue-100">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-500">字段:</span>
                                                    <code className="text-blue-600 bg-white px-1 rounded">{getFieldValueFromTestData.path}</code>
                                                </div>
                                                {getFieldValueFromTestData.exists ? (
                                                    <div className="mt-2 bg-white p-2 rounded text-gray-700 max-h-24 overflow-auto border">
                                                        <pre className="text-xs whitespace-pre-wrap break-all">
                                                            {typeof getFieldValueFromTestData.value === 'object'
                                                                ? JSON.stringify(getFieldValueFromTestData.value, null, 2)
                                                                : String(getFieldValueFromTestData.value)
                                                            }
                                                        </pre>
                                                    </div>
                                                ) : (
                                                    <div className="mt-1 text-amber-600 text-xs">⚠️ 该字段在测试数据中不存在</div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* 表达式详情 */}
                                    {selectedExpression.type === 'condition' && (
                                        <div className="space-y-2 text-xs">
                                            {selectedExpression.operator && (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-500">操作符:</span>
                                                    <span className="text-purple-600 font-medium">{getOperatorLabel(selectedExpression.operator)}</span>
                                                </div>
                                            )}
                                            {selectedExpression.value !== undefined && (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-500">期望值:</span>
                                                    <code className="text-green-600 bg-green-50 px-1 rounded">{String(selectedExpression.value)}</code>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {selectedExpression.type === 'plugin' && selectedExpression.fields && (
                                        <div className="space-y-2 text-xs">
                                            {selectedExpression.fields.operator && (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-500">操作符:</span>
                                                    <span className="text-purple-600 font-medium">{getOperatorLabel(selectedExpression.fields.operator)}</span>
                                                </div>
                                            )}
                                            {selectedExpression.fields.value !== undefined && (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-500">期望值:</span>
                                                    <code className="text-green-600 bg-green-50 px-1 rounded">{String(selectedExpression.fields.value)}</code>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {selectedExpression.type === 'expression' && selectedExpression.fields && (
                                        <div className="space-y-2 text-xs">
                                            <div className="flex items-center gap-2">
                                                <span className="text-gray-500">引擎:</span>
                                                <span className="text-green-600 font-medium">{selectedExpression.pluginId}</span>
                                            </div>
                                            {selectedExpression.fields.expression && (
                                                <div className="space-y-1">
                                                    <span className="text-gray-500">表达式:</span>
                                                    <pre className="bg-gray-50 p-2 rounded border text-xs font-mono overflow-auto max-h-24">
                                                        {selectedExpression.fields.expression}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {selectedExpression.type === 'group' && (
                                        <div className="text-xs text-gray-500 italic">
                                            条件组无单一字段值，请选择组内的具体条件查看
                                        </div>
                                    )}

                                    {/* 评估结果 */}
                                    {currentEvaluationResult && (
                                        <div className="space-y-2 pt-2 border-t border-gray-100">
                                            <div className="text-xs font-medium text-gray-500">评估结果</div>
                                            <div className={cn(
                                                "p-2 rounded-lg border text-xs",
                                                currentEvaluationResult.result
                                                    ? "bg-green-50 border-green-200"
                                                    : "bg-red-50 border-red-200"
                                            )}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        {currentEvaluationResult.result ? (
                                                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                        ) : (
                                                            <XCircle className="h-4 w-4 text-red-600" />
                                                        )}
                                                        <span className={currentEvaluationResult.result ? "text-green-700 font-medium" : "text-red-700 font-medium"}>
                                                            {currentEvaluationResult.result ? "通过" : "不通过"}
                                                        </span>
                                                    </div>
                                                    {/* 展开/收起按钮 */}
                                                    {(currentEvaluationResult.details || currentEvaluationResult.error) && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-5 w-5 p-0"
                                                            onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
                                                        >
                                                            {isDetailsExpanded ? (
                                                                <ChevronUp className="h-3 w-3" />
                                                            ) : (
                                                                <ChevronDown className="h-3 w-3" />
                                                            )}
                                                        </Button>
                                                    )}
                                                </div>

                                                {currentEvaluationResult.error && (
                                                    <div className="mt-1 text-red-600">{currentEvaluationResult.error}</div>
                                                )}

                                                {/* 展开的详情 */}
                                                {isDetailsExpanded && currentEvaluationResult.details && (
                                                    <div className="mt-2 pt-2 border-t border-gray-200">
                                                        <div className="text-xs text-gray-500 mb-1">接口返回详情:</div>
                                                        <div className="bg-white p-2 rounded border max-h-40 overflow-auto">
                                                            <pre className="text-xs whitespace-pre-wrap break-all text-gray-700">
                                                                {JSON.stringify(currentEvaluationResult.details, null, 2)}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : currentStep === 1 ? (
                                <div className="text-xs text-gray-400 italic text-center py-8 border-2 border-dashed border-gray-100 rounded-lg">
                                    点击左侧的条件表达式<br />
                                    查看配置详情
                                </div>
                            ) : currentStep === 2 && selectedAction ? (
                                <ActionPreviewPanel
                                    action={selectedAction}
                                    testData={data.emailData?.sampleData || {}}
                                    executionResult={actionExecutionResult}
                                />
                            ) : currentStep === 2 ? (
                                <div className="text-xs text-gray-400 italic text-center py-8 border-2 border-dashed border-gray-100 rounded-lg">
                                    点击左侧流水线中的动作卡片<br />
                                    查看动作配置概览
                                </div>
                            ) : currentStep === 3 ? (
                                <div className="space-y-4">
                                    {/* 邮件数据摘要 */}
                                    {data.emailData?.sampleData && Object.keys(data.emailData.sampleData).length > 0 && (
                                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
                                            <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">📧 邮件数据示例</div>
                                            <div className="space-y-1 text-xs">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">主题:</span>
                                                    <span className="text-gray-700 dark:text-gray-300 truncate ml-2 max-w-[150px]">
                                                        {data.emailData.sampleData.Subject || data.emailData.sampleData.subject || '(无)'}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500">发件人:</span>
                                                    <span className="text-gray-700 dark:text-gray-300 truncate ml-2 max-w-[150px]">
                                                        {(() => {
                                                            const from = data.emailData.sampleData.From || data.emailData.sampleData.from;
                                                            if (Array.isArray(from)) return from[0] || '(无)';
                                                            return from || '(无)';
                                                        })()}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* 过滤条件摘要 */}
                                    <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-100 dark:border-purple-800">
                                        <div className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-2">🔍 过滤条件</div>
                                        <div className="text-xs text-gray-600 dark:text-gray-400">
                                            {data.expressions?.length > 0 ? (
                                                <span>已配置 {data.expressions.length} 个条件组</span>
                                            ) : (
                                                <span className="text-amber-600">未配置过滤条件</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* 动作列表 */}
                                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-100 dark:border-amber-800">
                                        <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">⚡ 执行动作</div>
                                        {data.actions?.length > 0 ? (
                                            <div className="space-y-1">
                                                {data.actions.map((action: any, index: number) => (
                                                    <div key={action.id || index} className="flex items-center gap-2 text-xs">
                                                        <span className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-500">{index + 1}</span>
                                                        <span className="text-gray-700 dark:text-gray-300">{action.pluginName || action.pluginId}</span>
                                                        {!action.enabled && (
                                                            <span className="text-red-500 text-[10px]">(已禁用)</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-amber-600">未配置执行动作</div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-xs text-gray-400 italic text-center py-8 border-2 border-dashed border-gray-100 rounded-lg">
                                    请在相关步骤<br />
                                    选择配置项查看
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="p-3 border-t dark:border-gray-700 bg-gray-50/50 flex-shrink-0">
                        <Button
                            variant="outline"
                            className="w-full text-xs h-7"
                            onClick={() => router.push('/triggers')}
                        >
                            取消创建
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

            {/* 保存成功确认弹窗 */}
            <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
                <DialogContent showCloseButton={false} className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-green-600">
                            <CheckCircle className="h-6 w-6" />
                            创建成功
                        </DialogTitle>
                        <DialogDescription className="text-base mt-2">
                            触发器 "{data.triggerInfo.name}" 已成功创建。是否关闭当前创建页面？
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex gap-2 sm:gap-0">
                        <Button variant="outline" onClick={handleContinueEdit}>
                            继续创建
                        </Button>
                        <Button onClick={handleCloseTab}>
                            关闭页面
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
