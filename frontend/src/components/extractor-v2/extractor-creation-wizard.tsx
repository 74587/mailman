'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Mail,
    Filter,
    Zap,
    Settings,
    Check,
    X,
    Package,
    AlertCircle,
    LayoutDashboard,
    Code,
    Eye,
    Loader2,
    Play,
} from 'lucide-react'
import { useTabManager } from '@/components/layout/tab-manager'
import { extractorTemplateV2Service } from '@/services/extractor-template-v2.service'
import type {
    TriggerExpression,
    TriggerActionV2,
    ExtractorOutputConfig,
    CreateExtractorTemplateV2Request,
    Email,
} from '@/types'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

// 复用触发器创建流程的组件
import EmailDataStep from '@/components/triggers/create/email-data-step'
import ExpressionStep from '@/components/triggers/create/expression-step'
import ActionStep from '@/components/triggers/create/action-step'

// 通用布局组件
import { WizardLayout, type WizardStep, type RightPanelConfig } from '@/components/common/wizard-layout'

// 变量预览面板
import { VariablesPreviewPanel } from '@/components/triggers/create/variables-preview-panel'

// 步骤定义
const STEPS: WizardStep[] = [
    {
        id: 'data',
        title: '数据源',
        description: '选择测试用的邮件数据',
        icon: Mail,
        color: 'text-blue-500',
        bgColor: 'bg-blue-100 dark:bg-blue-900/20'
    },
    {
        id: 'filter',
        title: '过滤条件',
        description: '设置邮件匹配规则',
        icon: Filter,
        color: 'text-purple-500',
        bgColor: 'bg-purple-100 dark:bg-purple-900/20'
    },
    {
        id: 'action',
        title: '取件动作',
        description: '配置数据提取规则',
        icon: Zap,
        color: 'text-amber-500',
        bgColor: 'bg-amber-100 dark:bg-amber-900/20'
    },
    {
        id: 'info',
        title: '模板信息',
        description: '设置名称并保存',
        icon: Settings,
        color: 'text-green-500',
        bgColor: 'bg-green-100 dark:bg-green-900/20'
    }
]

interface ExtractorCreationWizardProps {
    tempId?: string
    templateId?: number  // 编辑/查看时传入模板ID
    readOnly?: boolean   // 只读模式
}

interface WizardData {
    // 数据源
    selectedEmail: Email | null
    selectedAccountId: number | null

    // 过滤条件
    expressions: TriggerExpression[]

    // 提取动作
    actions: TriggerActionV2[]

    // 输出配置
    outputConfig: ExtractorOutputConfig

    // 模板信息
    name: string
    description: string
    category: string
    tags: string[]
    enabled: boolean
}

// 选中的表达式信息类型
interface SelectedExpressionInfo {
    id: string
    type: 'condition' | 'plugin' | 'group' | 'expression'
    field?: string
    operator?: string
    value?: any
    pluginId?: string
    fields?: Record<string, any>
}

export function ExtractorCreationWizard({ tempId, templateId, readOnly = false }: ExtractorCreationWizardProps) {
    const { closeTab } = useTabManager()

    // 当前步骤
    const [currentStep, setCurrentStep] = useState(0)

    // 加载状态
    const [loading, setLoading] = useState(!!templateId)
    const [loadError, setLoadError] = useState<string | null>(null)

    // 是否为编辑模式
    const isEditMode = !!templateId

    // 向导数据
    const [data, setData] = useState<WizardData>({
        selectedEmail: null,
        selectedAccountId: null,
        expressions: [],
        actions: [],
        outputConfig: {
            format: 'text',
            field: 'value',
        },
        name: '',
        description: '',
        category: '',
        tags: [],
        enabled: true,
    })

    // 选中的表达式/动作
    const [selectedExpression, setSelectedExpression] = useState<SelectedExpressionInfo | null>(null)
    const [selectedAction, setSelectedAction] = useState<any>(null)
    const [selectedActionIndex, setSelectedActionIndex] = useState<number | null>(null)
    const [actionExecutionResult, setActionExecutionResult] = useState<any>()

    // 保存状态
    const [saving, setSaving] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)

    // 加载模板数据
    useEffect(() => {
        if (templateId) {
            loadTemplate(templateId)
        }
    }, [templateId])

    const loadTemplate = async (id: number) => {
        setLoading(true)
        setLoadError(null)
        try {
            const template = await extractorTemplateV2Service.getTemplate(id)
            setData({
                selectedEmail: null,
                selectedAccountId: null,
                expressions: template.expressions || [],
                actions: template.actions || [],
                outputConfig: template.outputConfig || { format: 'text', field: 'value' },
                name: template.name,
                description: template.description || '',
                category: template.category || '',
                tags: template.tags || [],
                enabled: template.enabled,
            })
        } catch (error) {
            console.error('Failed to load template:', error)
            setLoadError('加载模板失败')
            toast.error('加载模板失败')
        } finally {
            setLoading(false)
        }
    }

    // 处理数据变更
    const handleDataChange = useCallback((key: keyof WizardData, value: any) => {
        if (readOnly) return // 只读模式不允许修改
        setData(prev => ({
            ...prev,
            [key]: value,
        }))
    }, [readOnly])

    // 处理表达式选中
    const handleExpressionSelect = useCallback((expression: SelectedExpressionInfo | null) => {
        setSelectedExpression(expression)
    }, [])

    // 处理动作选中
    const handleActionSelect = useCallback((action: any, executionResult?: any, actionIndex?: number) => {
        setSelectedAction(action)
        setActionExecutionResult(executionResult)
        setSelectedActionIndex(actionIndex ?? null)
    }, [])

    // 验证当前步骤
    const validateCurrentStep = useCallback((): boolean => {
        switch (STEPS[currentStep].id) {
            case 'data':
                return data.selectedEmail !== null
            case 'filter':
                return true // 过滤条件可以为空
            case 'action':
                return data.actions.length > 0
            case 'info':
                return data.name.trim() !== ''
            default:
                return true
        }
    }, [currentStep, data])

    // 获取验证消息
    const getValidationMessage = useCallback((): string => {
        switch (STEPS[currentStep].id) {
            case 'data':
                return '请选择一封测试邮件'
            case 'action':
                return '请至少添加一个提取动作'
            case 'info':
                return '请输入模板名称'
            default:
                return ''
        }
    }, [currentStep])

    // 下一步
    const handleNext = useCallback(() => {
        if (!validateCurrentStep()) {
            toast.error(getValidationMessage())
            return
        }
        if (currentStep < STEPS.length - 1) {
            setCurrentStep(currentStep + 1)
        } else {
            // 最后一步，保存
            handleSave()
        }
    }, [currentStep, validateCurrentStep, getValidationMessage])

    // 上一步
    const handlePrevious = useCallback(() => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1)
        }
    }, [currentStep])

    // 保存模板
    const handleSave = useCallback(async () => {
        if (readOnly) return // 只读模式不保存

        if (!validateCurrentStep()) {
            toast.error(getValidationMessage())
            return
        }

        setSaving(true)
        try {
            if (isEditMode && templateId) {
                // 编辑模式 - 更新
                await extractorTemplateV2Service.updateTemplate(templateId, {
                    name: data.name,
                    description: data.description,
                    enabled: data.enabled,
                    expressions: data.expressions,
                    actions: data.actions,
                    outputConfig: data.outputConfig,
                    category: data.category || undefined,
                    tags: data.tags.length > 0 ? data.tags : undefined,
                })
                setSaveSuccess(true)
                toast.success('模板更新成功')
            } else {
                // 创建模式
                const request: CreateExtractorTemplateV2Request = {
                    name: data.name,
                    description: data.description,
                    enabled: data.enabled,
                    expressions: data.expressions,
                    actions: data.actions,
                    outputConfig: data.outputConfig,
                    category: data.category || undefined,
                    tags: data.tags.length > 0 ? data.tags : undefined,
                }
                await extractorTemplateV2Service.createTemplate(request)
                setSaveSuccess(true)
                toast.success('模板创建成功')
            }
        } catch (error) {
            console.error('Failed to save template:', error)
            toast.error(isEditMode ? '更新模板失败' : '创建模板失败')
        } finally {
            setSaving(false)
        }
    }, [data, validateCurrentStep, getValidationMessage, isEditMode, templateId, readOnly])

    // 关闭Tab
    const handleCloseTab = useCallback(() => {
        if (templateId) {
            if (readOnly) {
                closeTab(`extractor-v2-view-${templateId}`)
            } else {
                closeTab(`extractor-v2-edit-${templateId}`)
            }
        } else {
            closeTab(`extractor-v2-create-${tempId}`)
        }
    }, [closeTab, tempId, templateId, readOnly])

    // 继续编辑
    const handleContinueEdit = useCallback(() => {
        setSaveSuccess(false)
        setCurrentStep(0)
        // 重置数据
        setData({
            selectedEmail: null,
            selectedAccountId: null,
            expressions: [],
            actions: [],
            outputConfig: { format: 'text', field: 'value' },
            name: '',
            description: '',
            category: '',
            tags: [],
            enabled: true,
        })
    }, [])

    // 为触发器步骤组件准备data对象
    const stepData = useMemo(() => ({
        emailData: {
            source: data.selectedEmail ? 'api' : 'manual',
            selectedEmail: data.selectedEmail,
            sampleData: data.selectedEmail || {},
            selectedAccountId: data.selectedAccountId,
            isManualInput: false,
        },
        expressions: data.expressions,
        actions: data.actions,
    }), [data.selectedEmail, data.selectedAccountId, data.expressions, data.actions])

    // 通用的onDataChange处理函数
    const handleStepDataChange = useCallback((key: string, value: any) => {
        logger.debug('[ExtractorCreationWizard] handleStepDataChange:', key, value)
        if (key === 'emailData') {
            if (value.selectedEmail) {
                handleDataChange('selectedEmail', value.selectedEmail)
            } else if (value.sampleData) {
                handleDataChange('selectedEmail', value.sampleData)
            }
            if (value.selectedAccountId !== undefined) {
                handleDataChange('selectedAccountId', value.selectedAccountId)
            }
        } else if (key === 'expressions') {
            handleDataChange('expressions', value)
        } else if (key === 'actions') {
            handleDataChange('actions', value)
        }
    }, [handleDataChange])

    // 渲染步骤内容
    const renderStepContent = () => {
        const step = STEPS[currentStep]

        switch (step.id) {
            case 'data':
                return (
                    <EmailDataStep
                        data={stepData}
                        onDataChange={handleStepDataChange}
                        stepNumber={0}
                        readOnly={readOnly}
                    />
                )
            case 'filter':
                return (
                    <ExpressionStep
                        data={stepData}
                        onDataChange={handleStepDataChange}
                        onExpressionSelect={handleExpressionSelect}
                        stepNumber={1}
                        readOnly={readOnly}
                    />
                )
            case 'action':
                return (
                    <div className="space-y-4">
                        {/* 取件动作说明 */}
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                    <Zap className="w-4 h-4 text-amber-600" />
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                                        配置取件动作
                                    </h4>
                                    <p className="text-sm text-amber-700 dark:text-amber-300">
                                        取件模板的动作链用于从邮件中提取数据。动作会按顺序执行，<strong>最后一个动作的返回值</strong>将作为提取结果。
                                    </p>
                                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                                        💡 建议：使用「JSON提取」「正则提取」「AI提取」等动作来获取邮件中的关键信息。
                                    </p>
                                </div>
                            </div>
                        </div>
                        <ActionStep
                            data={stepData}
                            onDataChange={handleStepDataChange}
                            onActionSelect={handleActionSelect}
                            stepNumber={2}
                            readOnly={readOnly}
                        />
                    </div>
                )
            case 'info':
                return (
                    <InfoStepContent
                        name={data.name}
                        description={data.description}
                        category={data.category}
                        tags={data.tags}
                        enabled={data.enabled}
                        outputConfig={data.outputConfig}
                        onNameChange={(name: string) => handleDataChange('name', name)}
                        onDescriptionChange={(desc: string) => handleDataChange('description', desc)}
                        onCategoryChange={(cat: string) => handleDataChange('category', cat)}
                        onTagsChange={(tags: string[]) => handleDataChange('tags', tags)}
                        onEnabledChange={(enabled: boolean) => handleDataChange('enabled', enabled)}
                        onOutputConfigChange={(config: ExtractorOutputConfig) => handleDataChange('outputConfig', config)}
                        readOnly={readOnly}
                    />
                )
            default:
                return null
        }
    }

    // 获取表达式/操作符的显示文本
    const getExpressionTypeLabel = (type: string, pluginId?: string) => {
        switch (type) {
            case 'condition': return '字段匹配'
            case 'plugin': return '插件条件'
            case 'group': return '条件组'
            case 'expression': {
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

    // 右侧面板配置
    const rightPanelConfig = useMemo<RightPanelConfig>(() => {
        const step = STEPS[currentStep]

        // 全局概览项
        const overviewItems = [
            {
                label: '测试数据',
                value: data.selectedEmail ? (
                    <div className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded border mt-1">
                        <div className="truncate text-gray-700 dark:text-gray-300">
                            {(data.selectedEmail as any).Subject || '(无主题)'}
                        </div>
                    </div>
                ) : null,
                status: data.selectedEmail ? 'ready' : 'pending' as 'ready' | 'pending'
            },
            {
                label: '过滤条件',
                value: String(data.expressions?.length || 0),
            },
            {
                label: '取件动作',
                value: String(data.actions?.length || 0),
            }
        ]

        // 详情面板内容
        let detailContent: React.ReactNode = (
            <div className="text-sm text-gray-400 italic">
                请选择一个项目以查看详情
            </div>
        )
        let detailTitle = '配置详情'
        let DetailIcon = Code

        if (currentStep === 1 && selectedExpression) {
            // 过滤条件详情
            detailTitle = '表达式详情'
            DetailIcon = Filter
            detailContent = (
                <div className="space-y-3">
                    {/* 表达式类型 */}
                    <div className="flex items-center gap-2">
                        <span className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full",
                            selectedExpression.type === 'group'
                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                                : selectedExpression.type === 'plugin'
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                    : selectedExpression.type === 'expression'
                                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        )}>
                            {getExpressionTypeLabel(selectedExpression.type, selectedExpression.pluginId)}
                        </span>
                    </div>

                    {/* 表达式详情 */}
                    {selectedExpression.type === 'condition' && (
                        <div className="space-y-2 text-xs">
                            {selectedExpression.field && (
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500">字段:</span>
                                    <code className="text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-1 rounded">
                                        {selectedExpression.field}
                                    </code>
                                </div>
                            )}
                            {selectedExpression.operator && (
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500">操作符:</span>
                                    <span className="text-purple-600 font-medium">
                                        {getOperatorLabel(selectedExpression.operator)}
                                    </span>
                                </div>
                            )}
                            {selectedExpression.value !== undefined && (
                                <div className="flex items-center gap-2">
                                    <span className="text-gray-500">期望值:</span>
                                    <code className="text-green-600 bg-green-50 dark:bg-green-900/20 px-1 rounded">
                                        {String(selectedExpression.value)}
                                    </code>
                                </div>
                            )}
                        </div>
                    )}

                    {selectedExpression.type === 'group' && (
                        <div className="text-xs text-gray-500 italic">
                            条件组无单一字段值，请选择组内的具体条件查看
                        </div>
                    )}
                </div>
            )
        } else if (currentStep === 2 && selectedAction) {
            // 动作详情
            detailTitle = '动作详情'
            DetailIcon = Zap
            detailContent = (
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            {selectedAction.pluginName || selectedAction.pluginId}
                        </span>
                        {selectedActionIndex !== null && (
                            <span className="text-xs text-gray-400">
                                #{selectedActionIndex + 1}
                            </span>
                        )}
                    </div>
                    {actionExecutionResult && (
                        <div className={cn(
                            "text-xs p-2 rounded border",
                            actionExecutionResult.success
                                ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
                                : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                        )}>
                            <div className="flex items-center gap-1 mb-1">
                                {actionExecutionResult.success ? (
                                    <Check className="w-3 h-3 text-green-600" />
                                ) : (
                                    <X className="w-3 h-3 text-red-600" />
                                )}
                                <span className={actionExecutionResult.success ? "text-green-700" : "text-red-700"}>
                                    {actionExecutionResult.success ? '执行成功' : '执行失败'}
                                </span>
                            </div>
                            {actionExecutionResult.message && (
                                <p className="text-gray-600 dark:text-gray-400">{actionExecutionResult.message}</p>
                            )}
                        </div>
                    )}
                    {selectedAction.config && Object.keys(selectedAction.config).length > 0 && (
                        <div className="text-xs">
                            <p className="text-gray-500 mb-1">配置:</p>
                            <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded border text-xs overflow-auto max-h-32">
                                {JSON.stringify(selectedAction.config, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            )
        }

        return {
            globalOverview: {
                title: '全局配置概览',
                icon: LayoutDashboard,
                items: overviewItems,
                customContent: (
                    <VariablesPreviewPanel
                        selectedActionIndex={selectedActionIndex}
                        actions={data.actions || []}
                        currentStep={currentStep}
                    />
                ),
                actions: data.selectedEmail ? (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        title="查看测试数据"
                    >
                        <Eye className="h-3.5 w-3.5" />
                    </Button>
                ) : undefined
            },
            detailPanel: {
                title: detailTitle,
                icon: DetailIcon,
                content: detailContent,
            }
        }
    }, [currentStep, data, selectedExpression, selectedAction, selectedActionIndex, actionExecutionResult])

    // 加载中状态
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6 animate-pulse">
                    <Package className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-semibold mb-2">加载模板中...</h2>
                <p className="text-muted-foreground">请稍候</p>
            </div>
        )
    }

    // 加载错误状态
    if (loadError) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-6">
                    <AlertCircle className="w-8 h-8 text-red-600" />
                </div>
                <h2 className="text-xl font-semibold mb-2">加载失败</h2>
                <p className="text-muted-foreground mb-6">{loadError}</p>
                <div className="flex gap-4">
                    <Button variant="outline" onClick={handleCloseTab}>
                        关闭
                    </Button>
                    <Button onClick={() => templateId && loadTemplate(templateId)}>
                        重试
                    </Button>
                </div>
            </div>
        )
    }

    // 保存成功界面
    if (saveSuccess) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8">
                <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6">
                    <Check className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-2xl font-semibold mb-2">
                    {isEditMode ? '模板更新成功' : '模板创建成功'}
                </h2>
                <p className="text-muted-foreground mb-8">
                    取件模板 &ldquo;{data.name}&rdquo; {isEditMode ? '已成功更新' : '已成功创建'}
                </p>
                <div className="flex gap-4">
                    {!isEditMode && (
                        <Button variant="outline" onClick={handleContinueEdit}>
                            创建更多
                        </Button>
                    )}
                    <Button onClick={handleCloseTab}>
                        完成
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full">
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between px-6 py-3 border-b bg-background flex-shrink-0">
                <div className="flex items-center gap-3">
                    <Package className="w-5 h-5 text-primary" />
                    <h1 className="text-lg font-semibold">
                        {readOnly ? '查看取件模板' : isEditMode ? '编辑取件模板' : '新建取件模板'}
                    </h1>
                    {readOnly && (
                        <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            只读模式
                        </Badge>
                    )}
                    {isEditMode && !readOnly && (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            编辑模式
                        </Badge>
                    )}
                </div>
                {isEditMode && (
                    <p className="text-sm text-muted-foreground">
                        模板: {data.name || `#${templateId}`}
                    </p>
                )}
            </div>

            {/* 使用通用的 WizardLayout */}
            <WizardLayout
                steps={STEPS}
                currentStep={currentStep}
                onStepChange={setCurrentStep}
                canProceed={validateCurrentStep()}
                onNext={handleNext}
                onPrevious={handlePrevious}
                nextLabel={currentStep === STEPS.length - 1 ? (isEditMode ? '更新模板' : '创建模板') : '下一步 →'}
                previousLabel="← 上一步"
                isSubmitting={saving}
                rightPanelConfig={rightPanelConfig}
                showRightPanel={currentStep > 0} // 第一步不显示右侧面板
            >
                {renderStepContent()}
            </WizardLayout>
        </div>
    )
}

// 模板信息步骤内容
interface InfoStepContentProps {
    name: string
    description: string
    category: string
    tags: string[]
    enabled: boolean
    outputConfig: ExtractorOutputConfig
    onNameChange: (name: string) => void
    onDescriptionChange: (desc: string) => void
    onCategoryChange: (cat: string) => void
    onTagsChange: (tags: string[]) => void
    onEnabledChange: (enabled: boolean) => void
    onOutputConfigChange: (config: ExtractorOutputConfig) => void
    readOnly?: boolean
}

function InfoStepContent({
    name,
    description,
    category,
    tags,
    enabled,
    outputConfig,
    onNameChange,
    onDescriptionChange,
    onCategoryChange,
    onTagsChange,
    onEnabledChange,
    onOutputConfigChange,
    readOnly = false,
}: InfoStepContentProps) {
    const [tagInput, setTagInput] = useState('')

    const handleAddTag = () => {
        if (tagInput.trim() && !tags.includes(tagInput.trim())) {
            onTagsChange([...tags, tagInput.trim()])
            setTagInput('')
        }
    }

    const handleRemoveTag = (tag: string) => {
        onTagsChange(tags.filter(t => t !== tag))
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="flex items-center gap-2 mb-6">
                <Package className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold">模板信息</h3>
            </div>

            {/* 模板名称 */}
            <div className="space-y-2">
                <label className="text-sm font-medium">
                    模板名称 <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="例如：快递取件码提取"
                    className="w-full px-3 py-2 rounded-md border bg-background"
                    disabled={readOnly}
                />
            </div>

            {/* 模板描述 */}
            <div className="space-y-2">
                <label className="text-sm font-medium">描述</label>
                <textarea
                    value={description}
                    onChange={(e) => onDescriptionChange(e.target.value)}
                    placeholder="描述这个模板的用途..."
                    className="w-full px-3 py-2 rounded-md border bg-background min-h-[100px] resize-none"
                    disabled={readOnly}
                />
            </div>

            {/* 分类 */}
            <div className="space-y-2">
                <label className="text-sm font-medium">分类</label>
                <input
                    type="text"
                    value={category}
                    onChange={(e) => onCategoryChange(e.target.value)}
                    placeholder="例如：快递、验证码、订单"
                    className="w-full px-3 py-2 rounded-md border bg-background"
                    disabled={readOnly}
                />
            </div>

            {/* 标签 */}
            <div className="space-y-2">
                <label className="text-sm font-medium">标签</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                        placeholder="输入标签后按回车"
                        className="flex-1 px-3 py-2 rounded-md border bg-background"
                        disabled={readOnly}
                    />
                    <Button type="button" variant="outline" onClick={handleAddTag} disabled={readOnly}>
                        添加
                    </Button>
                </div>
                {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                        {tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="gap-1">
                                {tag}
                                {!readOnly && (
                                    <button
                                        onClick={() => handleRemoveTag(tag)}
                                        className="ml-1 hover:text-destructive"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </Badge>
                        ))}
                    </div>
                )}
            </div>

            {/* 输出格式 */}
            <div className="space-y-2">
                <label className="text-sm font-medium">输出格式</label>
                <select
                    value={outputConfig.format}
                    onChange={(e) => onOutputConfigChange({ ...outputConfig, format: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-md border bg-background"
                    disabled={readOnly}
                >
                    <option value="text">纯文本</option>
                    <option value="json">JSON</option>
                    <option value="object">对象</option>
                    <option value="array">数组</option>
                </select>
            </div>

            {/* 输出字段 */}
            <div className="space-y-2">
                <label className="text-sm font-medium">输出字段</label>
                <input
                    type="text"
                    value={outputConfig.field || ''}
                    onChange={(e) => onOutputConfigChange({ ...outputConfig, field: e.target.value })}
                    placeholder="从动作输出中提取的字段名，如 value"
                    className="w-full px-3 py-2 rounded-md border bg-background"
                    disabled={readOnly}
                />
                <p className="text-xs text-muted-foreground">
                    指定从最后一个动作的输出中提取哪个字段作为最终结果
                </p>
            </div>

            {/* 启用状态 */}
            <div className="flex items-center gap-3">
                <input
                    type="checkbox"
                    id="enabled"
                    checked={enabled}
                    onChange={(e) => onEnabledChange(e.target.checked)}
                    className="w-4 h-4"
                    disabled={readOnly}
                />
                <label htmlFor="enabled" className="text-sm font-medium cursor-pointer">
                    创建后立即启用
                </label>
            </div>
        </div>
    )
}

export default ExtractorCreationWizard
