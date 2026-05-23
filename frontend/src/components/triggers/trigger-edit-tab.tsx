'use client'
import { logger } from '@/lib/logger';

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/components/ui/dialog'
import {
    Mail,
    Filter,
    Zap,
    Settings,
    Check,
    Loader2,
    Save,
    CheckCircle,
    LayoutDashboard,
    Eye,
    Play,
    Code,
    GripVertical
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { triggerService } from '@/services/trigger.service'
import { EmailTrigger } from '@/types'

// 导入步骤组件
import EmailDataStep from './create/email-data-step'
import ExpressionStep from './create/expression-step'
import ActionStep from './create/action-step'
import TriggerInfoStep from './create/trigger-info-step'
import { VariablesPreviewPanel } from './create/variables-preview-panel'
import { ActionPreviewPanel } from '@/components/action-debugger/action-preview-panel'

// 编辑模式步骤定义（与创建模式不同，基本信息放在第一位）
const EDIT_STEPS = [
    {
        id: 'info',
        title: '基本信息',
        description: '名称和描述',
        icon: Settings,
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/20'
    },
    {
        id: 'data',
        title: '测试数据',
        description: '调试用邮件数据',
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

interface TriggerEditTabProps {
    triggerId: number
    readOnly?: boolean
}

// 旧的动作类型到新插件 ID 的映射
const ACTION_TYPE_TO_PLUGIN_ID: Record<string, string> = {
    'modify_content': 'email_transform_action',
    'telegram': 'telegram_bot_action',
    'telegram_bot': 'telegram_bot_action',
    'email_transform': 'email_transform_action',
    'email_delete': 'email_delete_action',
    'email_forward': 'email_forward_action',
    'email_label': 'email_label_action',
    'notification': 'notification_action',
}

// 将旧格式动作转换为新格式
function convertActionsToV2Format(actions: any[]): any[] {
    if (!actions || actions.length === 0) return []

    return actions.map((action, index) => {
        // 解析 config JSON 字符串
        let parsedConfig = {}
        if (action.config) {
            try {
                parsedConfig = typeof action.config === 'string'
                    ? JSON.parse(action.config)
                    : action.config
            } catch (e) {
                console.warn('无法解析动作配置:', action.config)
            }
        }

        // 确定 pluginId：优先使用映射表，其次尝试从 description 提取
        let actionType = action.type || 'unknown'
        let pluginId = ACTION_TYPE_TO_PLUGIN_ID[actionType] || actionType

        // 如果 description 包含插件信息，尝试从中提取
        if (action.description && action.description.startsWith('Plugin: ')) {
            const descPluginId = action.description.replace('Plugin: ', '').trim()
            if (descPluginId && descPluginId !== actionType) {
                // 检查提取的 ID 是否也需要映射
                pluginId = ACTION_TYPE_TO_PLUGIN_ID[descPluginId] || descPluginId || pluginId
            }
        }

        logger.debug(`[convertActionsToV2Format] 转换动作: type=${actionType} -> pluginId=${pluginId}`)

        return {
            id: `action-${index}-${Date.now()}`,
            pluginId: pluginId,
            pluginName: action.name || pluginId,
            config: parsedConfig,
            enabled: action.enabled ?? true,
            executionOrder: action.order ?? index
        }
    })
}

// 将旧格式条件转换为新格式 expressions
function convertConditionToExpressions(condition: any, existingExpressions?: any[]): any[] {
    // 如果已经有 expressions 且不为空，直接使用
    if (existingExpressions && existingExpressions.length > 0) {
        return existingExpressions
    }

    // 如果没有 condition，返回空的条件组
    if (!condition) {
        return [{
            id: `${Date.now()}`,
            type: 'group',
            operator: 'and',
            conditions: []
        }]
    }

    // 根据旧格式 condition 转换
    if (condition.type === 'js') {
        const script = condition.script || ''

        // 特殊情况：script 是 "true" 表示始终通过
        if (script === 'true' || script.trim() === 'return true' || script.trim() === 'return true;') {
            return [{
                id: `${Date.now()}`,
                type: 'group',
                operator: 'and',
                conditions: [{
                    id: `${Date.now()}-always-pass`,
                    type: 'plugin',
                    pluginId: 'always_pass',
                    fields: {},
                    not: false
                }]
            }]
        }

        // 其他 JavaScript 条件：转换为表达式条件
        return [{
            id: `${Date.now()}`,
            type: 'group',
            operator: 'and',
            conditions: [{
                id: `${Date.now()}-js-expr`,
                type: 'expression',
                pluginId: 'expr.javascript',
                fields: {
                    expression: script
                },
                not: false
            }]
        }]
    }

    // 如果是其他类型，返回空的条件组
    return [{
        id: `${Date.now()}`,
        type: 'group',
        operator: 'and',
        conditions: []
    }]
}

export function TriggerEditTab({ triggerId, readOnly = false }: TriggerEditTabProps) {
    const [currentStep, setCurrentStep] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [showSuccessDialog, setShowSuccessDialog] = useState(false)

    const [data, setData] = useState<any>({
        emailData: { source: 'api', selectedEmail: null, isManualInput: false, manualEmailData: '' },
        expressions: [],
        actions: [],
        triggerInfo: { name: '', description: '', status: 'enabled' }
    })

    // 选中的表达式信息
    const [selectedExpression, setSelectedExpression] = useState<SelectedExpressionInfo | null>(null)
    const [selectedAction, setSelectedAction] = useState<any>(null)
    const [actionExecutionResult, setActionExecutionResult] = useState<any>()

    // 评估结果状态
    const [evaluationResults, setEvaluationResults] = useState<Record<string, EvaluationResult>>({})
    const [isEvaluating, setIsEvaluating] = useState<string | null>(null)

    // 选中的动作索引
    const [selectedActionIndex, setSelectedActionIndex] = useState<number | null>(null)

    // 右侧面板状态
    const [rightPanelWidth, setRightPanelWidth] = useState(320)
    const [isResizingWidth, setIsResizingWidth] = useState(false)
    const [topPanelHeight, setTopPanelHeight] = useState(40)
    const [isResizingHeight, setIsResizingHeight] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const startPosRef = useRef({ x: 0, y: 0 })
    const startSizeRef = useRef({ width: 320, height: 40 })

    // 数据预览对话框
    const [isDataPreviewOpen, setIsDataPreviewOpen] = useState(false)

    // 加载触发器数据
    useEffect(() => {
        const loadTrigger = async () => {
            try {
                setIsLoading(true)
                setError(null)

                const trigger = await triggerService.getTrigger(triggerId)
                logger.debug('[TriggerEditTab] 加载触发器数据:', trigger)

                // 转换动作格式
                const convertedActions = convertActionsToV2Format(trigger.actions || [])
                logger.debug('[TriggerEditTab] 转换后的动作:', convertedActions)

                // 转换条件格式（处理旧的 condition 字段）
                const convertedExpressions = convertConditionToExpressions(
                    trigger.condition,
                    trigger.expressions
                )
                logger.debug('[TriggerEditTab] 转换后的表达式:', convertedExpressions)

                // 将触发器数据转换为向导格式
                setData({
                    emailData: {
                        source: 'api',
                        selectedEmail: null,
                        isManualInput: false,
                        manualEmailData: '',
                        sampleData: {}
                    },
                    expressions: convertedExpressions,
                    actions: convertedActions,
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
        setSaveSuccess(false)
    }, [readOnly])

    // 处理表达式选中
    const handleExpressionSelect = (expression: SelectedExpressionInfo | null) => {
        setSelectedExpression(expression)
    }

    // 处理动作选中
    const handleActionSelect = useCallback((action: any, executionResult?: any, actionIndex?: number) => {
        setSelectedAction(action)
        setActionExecutionResult(executionResult)
        setSelectedActionIndex(actionIndex ?? null)
    }, [])

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
            setError(null)

            // 将动作转换为后端期望的格式（config 需要是 JSON 字符串）
            const formattedActions = data.actions.map((action: any, index: number) => ({
                type: action.pluginId || 'modify_content',
                name: action.pluginName || '',
                description: `Plugin: ${action.pluginId || ''}`,
                config: typeof action.config === 'string'
                    ? action.config
                    : JSON.stringify(action.config || {}),
                enabled: action.enabled ?? true,
                order: action.executionOrder ?? index
            }))

            await triggerService.updateTrigger(triggerId, {
                name: data.triggerInfo.name,
                description: data.triggerInfo.description,
                status: data.triggerInfo.status,
                expressions: data.expressions,
                actions: formattedActions
            } as any)

            setSaveSuccess(true)
            // 显示成功确认弹窗
            setShowSuccessDialog(true)
        } catch (err: any) {
            console.error('保存触发器失败:', err)
            setError(err.message || '保存失败')
        } finally {
            setIsSaving(false)
        }
    }

    // 关闭当前 Tab
    const handleCloseTab = () => {
        setShowSuccessDialog(false)
        // 触发关闭 Tab 事件
        window.dispatchEvent(new CustomEvent('closeTab', {
            detail: { tabId: `trigger-edit-${triggerId}` }
        }))
    }

    // 继续编辑
    const handleContinueEdit = () => {
        setShowSuccessDialog(false)
        setSaveSuccess(false)
    }

    // 导航处理
    const handleNext = () => {
        if (currentStep < EDIT_STEPS.length - 1) {
            setCurrentStep(prev => prev + 1)
        }
    }

    const handlePrevious = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1)
        }
    }

    // 渲染当前步骤组件（编辑模式顺序：基本信息 → 数据源 → 过滤条件 → 执行动作）
    const renderStepComponent = () => {
        // 不传递 onNext/onPrevious 给子组件，避免重复导航按钮
        const commonProps = {
            data,
            onDataChange: handleDataChange,
            readOnly
        }

        switch (currentStep) {
            case 0: // 基本信息
                return <TriggerInfoStep {...commonProps} stepNumber={0} />
            case 1: // 数据源
                return <EmailDataStep {...commonProps} stepNumber={1} stepStatus={EDIT_STEPS.map((_, i) => i < currentStep)} />
            case 2: // 过滤条件
                return (
                    <ExpressionStep
                        {...commonProps}
                        stepNumber={2}
                        onExpressionSelect={handleExpressionSelect}
                        onEvaluate={handleEvaluateExpression}
                        evaluationResults={evaluationResults}
                        isEvaluating={isEvaluating}
                    />
                )
            case 3: // 执行动作
                return <ActionStep {...commonProps} stepNumber={3} onActionSelect={handleActionSelect} />
            default:
                return null
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                    <p className="mt-4 text-gray-600">加载触发器...</p>
                </div>
            </div>
        )
    }

    if (error && !data.triggerInfo.name) {
        return (
            <div className="flex items-center justify-center h-full">
                <Card className="p-6 max-w-md">
                    <h3 className="text-lg font-semibold text-red-600 mb-2">加载失败</h3>
                    <p className="text-gray-600 mb-4">{error}</p>
                </Card>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-gray-50 dark:bg-gray-900">
            {/* 顶部标题和步骤 */}
            <Card className="m-4 mb-0 p-4 flex-none shadow-sm border-0 bg-white/80 backdrop-blur dark:bg-gray-800/80">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div>
                            <h1 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                <Settings className="h-5 w-5 text-blue-600" />
                                编辑触发器
                            </h1>
                            <p className="text-sm text-gray-500">
                                {data.triggerInfo.name || '未命名触发器'}
                            </p>
                        </div>
                    </div>
                    {/* 右上角保存按钮已移除，使用底部保存按钮 */}
                </div>

                {/* 步骤指示器 */}
                <div className="flex items-center space-x-1 w-full max-w-3xl mx-auto">
                    {EDIT_STEPS.map((step, index) => {
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
                                {index < EDIT_STEPS.length - 1 && (
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
            </Card>

            {/* 主内容区域 - 双列布局 */}
            <div className="flex flex-1 overflow-hidden p-4 pt-2">
                {/* 左侧：主操作区 */}
                <div className="flex-1 flex flex-col overflow-hidden mr-4 lg:mr-6">
                    {/* 错误提示 */}
                    {error && (
                        <div className="mb-2 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm flex-shrink-0">
                            {error}
                        </div>
                    )}

                    {/* 步骤内容区域 - 可滚动区域 */}
                    <div className="flex-1 min-h-0 overflow-y-auto pr-2 scrollbar-hide">
                        <div className="max-w-3xl mx-auto">
                            {renderStepComponent()}
                        </div>
                    </div>

                    {/* 底部导航 */}
                    <div className="flex-shrink-0 pt-4 mt-2 border-t bg-white dark:bg-gray-800">
                        <div className="flex items-center justify-between max-w-3xl mx-auto">
                            <Button
                                variant="outline"
                                onClick={handlePrevious}
                                disabled={currentStep === 0}
                            >
                                ← 上一步
                            </Button>
                            <div className="text-sm text-gray-500">
                                第 {currentStep + 1} / {EDIT_STEPS.length} 步
                            </div>
                            {currentStep === EDIT_STEPS.length - 1 ? (
                                <Button onClick={handleSave} disabled={isSaving || readOnly}>
                                    {isSaving ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            保存中...
                                        </>
                                    ) : saveSuccess ? (
                                        <>
                                            <Check className="h-4 w-4 mr-2 text-green-500" />
                                            已保存
                                        </>
                                    ) : (
                                        <>
                                            <Save className="h-4 w-4 mr-2" />
                                            保存
                                        </>
                                    )}
                                </Button>
                            ) : (
                                <Button onClick={handleNext}>
                                    下一步 →
                                </Button>
                            )}
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
                                    {currentStep === 2 && data.expressions?.length > 0 && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-xs px-2"
                                            title="测试所有表达式"
                                            onClick={async () => {
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

                        {/* 下半部分：动作配置概览 */}
                        <div style={{ height: `${100 - topPanelHeight}%` }} className="flex flex-col overflow-hidden min-h-0">
                            <div className="p-3 border-b dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex-shrink-0 flex items-center justify-between">
                                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                                    {currentStep === 3 ? (
                                        <>
                                            <Zap className="w-4 h-4" />
                                            动作配置概览
                                        </>
                                    ) : currentStep === 0 ? (
                                        <>
                                            <Settings className="w-4 h-4" />
                                            基本信息概览
                                        </>
                                    ) : (
                                        <>
                                            <Code className="w-4 h-4" />
                                            表达式配置概览
                                        </>
                                    )}
                                </h3>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3">
                                {currentStep === 3 && selectedAction ? (
                                    <ActionPreviewPanel
                                        action={selectedAction}
                                        executionResult={actionExecutionResult}
                                    />
                                ) : currentStep === 0 ? (
                                    <div className="space-y-2 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-500">名称:</span>
                                            <span className="font-medium">{data.triggerInfo.name || '(未设置)'}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-500">状态:</span>
                                            <span className={cn(
                                                "px-2 py-0.5 rounded-full text-xs",
                                                data.triggerInfo.status === 'enabled'
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'bg-gray-100 text-gray-600'
                                            )}>
                                                {data.triggerInfo.status === 'enabled' ? '已启用' : '已禁用'}
                                            </span>
                                        </div>
                                        {data.triggerInfo.description && (
                                            <div className="space-y-1">
                                                <span className="text-gray-500">描述:</span>
                                                <p className="text-gray-700 text-xs">{data.triggerInfo.description}</p>
                                            </div>
                                        )}
                                    </div>
                                ) : selectedExpression ? (
                                    <div className="space-y-2 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-500">类型:</span>
                                            <span className={cn(
                                                "px-2 py-0.5 rounded-full text-xs",
                                                selectedExpression.type === 'group' ? 'bg-purple-100 text-purple-700' :
                                                    selectedExpression.type === 'plugin' ? 'bg-amber-100 text-amber-700' :
                                                        'bg-blue-100 text-blue-700'
                                            )}>
                                                {selectedExpression.type}
                                            </span>
                                        </div>
                                        {selectedExpression.field && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-gray-500">字段:</span>
                                                <code className="bg-gray-100 px-1 rounded">{selectedExpression.field}</code>
                                            </div>
                                        )}
                                        {selectedExpression.operator && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-gray-500">操作符:</span>
                                                <span className="font-medium">{selectedExpression.operator}</span>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-xs text-gray-400 italic">
                                        选择一个表达式或动作以查看详情
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>
                </div>
            </div>

            {/* 保存成功确认弹窗 */}
            <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
                <DialogContent showCloseButton={false} className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-green-600">
                            <CheckCircle className="h-6 w-6" />
                            保存成功
                        </DialogTitle>
                        <DialogDescription className="text-base mt-2">
                            触发器 "{data.triggerInfo.name}" 已成功保存。是否关闭当前编辑页面？
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex gap-2 sm:gap-0">
                        <Button variant="outline" onClick={handleContinueEdit}>
                            继续编辑
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

export default TriggerEditTab
