'use client'
import { logger } from '@/lib/logger';

import React, { useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiClient } from '@/lib/api-client'
import {
    Zap,
    Play,
    CheckCircle,
    XCircle,
    AlertCircle,
    Eye,
    X,
    ChevronLeft,
    ChevronRight
} from 'lucide-react'
import { ActionSection, ActionExecutionResult } from '@/components/filter-action-trigger/action-section'
import { AncestorProvider, BreadcrumbItem } from '@/components/ui/sticky-breadcrumb'
import { ActionStructurePanel } from '@/components/ui/action-structure-panel'

interface ActionStepProps {
    data: any
    onDataChange: (key: string, value: any) => void
    onNext?: () => void
    onPrevious?: () => void
    onActionSelect?: (action: any, executionResult?: ActionExecutionResult) => void
    readOnly?: boolean
    stepNumber?: number  // 可选的步骤编号
}

interface TestResult {
    passed: boolean
    message: string
    details?: any
}

const STEP_NAMES = ['第一步', '第二步', '第三步', '第四步']

export default function ActionStep({ data, onDataChange, onNext, onPrevious, onActionSelect, readOnly, stepNumber }: ActionStepProps) {
    const [isTestingActions, setIsTestingActions] = useState(false)
    const [testResult, setTestResult] = useState<TestResult | null>(null)
    const [showDataPreview, setShowDataPreview] = useState(false)
    const [selectedActionId, setSelectedActionId] = useState<string | undefined>()
    const actionSectionRef = useRef<HTMLDivElement>(null)

    const actions = data.actions || []
    const emailData = data.emailData?.sampleData || {}
    const expressions = data.expressions || []

    // 更新动作
    const handleActionsChange = useCallback((newActions: any[]) => {
        onDataChange('actions', newActions)
        // 清除之前的测试结果
        setTestResult(null)
    }, [onDataChange])

    // 处理动作选择 - 同时更新本地状态和通知父组件
    const handleActionSelectInternal = useCallback((action: any, executionResult?: ActionExecutionResult) => {
        logger.debug('[ActionStep] handleActionSelectInternal called with action:', action?.id)
        setSelectedActionId(action?.id)
        onActionSelect?.(action, executionResult)
    }, [onActionSelect])

    // 滚动到指定动作元素
    const handleScrollToAction = useCallback((id: string) => {
        // 查找带有 data-action-id 属性的元素
        const actionElement = document.querySelector(`[data-action-id="${id}"]`)
        if (actionElement) {
            actionElement.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            })
            // 添加高亮动画
            actionElement.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2')
            setTimeout(() => {
                actionElement.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2')
            }, 2000)
        }
    }, [])

    // 在结构面板中选择动作
    const handleStructurePanelSelect = useCallback((id: string) => {
        // 在动作列表中递归查找对应的动作
        const findAction = (actions: any[], targetId: string): any | null => {
            for (const action of actions) {
                if (action.id === targetId) {
                    return action
                }
                // 递归查找条件分支中的动作
                if (action.pluginId === 'conditional_branch_action' && action.config?.branches) {
                    for (const branch of action.config.branches) {
                        if (branch.id === targetId) {
                            // 分支本身被选中
                            return action
                        }
                        if (branch.actions) {
                            const found = findAction(branch.actions, targetId)
                            if (found) return found
                        }
                    }
                    // 检查是否选中了 ELSE 分支本身
                    if (targetId === `${action.id}-else`) {
                        return {
                            id: targetId,
                            type: 'else',
                            name: action.config.else_name || 'ELSE',
                            description: action.config.else_description,
                            actions: action.config.else_actions
                        }
                    }
                    // 查找 else 分支内的动作
                    if (action.config.else_actions) {
                        const found = findAction(action.config.else_actions, targetId)
                        if (found) return found
                    }
                }
                // 递归查找并行动作
                if (action.pluginId === 'parallel_actions' && action.config?.actions) {
                    const found = findAction(action.config.actions, targetId)
                    if (found) return found
                }
            }
            return null
        }

        const foundAction = findAction(actions, id)
        if (foundAction) {
            setSelectedActionId(id)
            onActionSelect?.(foundAction)
        }

        // 滚动到目标元素
        handleScrollToAction(id)
    }, [actions, onActionSelect, handleScrollToAction])

    // 测试动作
    const testActions = useCallback(async () => {
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
                message: '请先在第二步配置过滤表达式'
            })
            return
        }

        if (actions.length === 0) {
            setTestResult({
                passed: false,
                message: '请先添加动作配置'
            })
            return
        }

        setIsTestingActions(true)
        setTestResult(null)

        try {
            // 使用 test-complete 接口来测试一组动作
            // 构造一个临时触发器对象
            const tempTrigger = {
                name: "temp_test",
                enabled: true,
                expressions: expressions,
                actions: actions.map((a: any) => ({
                    ...a,
                    // 确保 pluginId 和 config 格式正确
                    pluginId: a.pluginId || (a.type === 'modify_content' ? 'email_modify_plugin' : 'email_forward_plugin'),
                    config: typeof a.config === 'string' ? JSON.parse(a.config) : a.config
                }))
            }

            const result = await apiClient.post<any>('/v2/triggers/test-complete', {
                trigger: tempTrigger,
                testData: emailData
            })

            // 检查是否有任何动作执行失败
            const allSuccess = result.actionResults && result.actionResults.every((r: any) => r.success)
            // 确保至少执行了一个动作（如果配置了动作）
            const anyExecuted = result.actionsExecuted > 0

            if (allSuccess && anyExecuted) {
                setTestResult({
                    passed: true,
                    message: '动作测试通过',
                    details: result.actionResults
                })
            } else {
                setTestResult({
                    passed: false,
                    message: result.error || '动作执行失败或未执行',
                    details: result.actionResults || result
                })
            }
        } catch (error: any) {
            console.error('测试动作失败:', error)
            setTestResult({
                passed: false,
                message: error.message || '测试过程中发生错误'
            })
        } finally {
            setIsTestingActions(false)
        }
    }, [actions, emailData, expressions])

    // 检查是否可以继续下一步
    // 只需要配置了动作即可，测试通过是可选的
    const canProceed = () => {
        return actions.length > 0
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Zap className="h-5 w-5" />
                        {stepNumber !== undefined ? `${STEP_NAMES[stepNumber]}：配置动作行为` : '配置动作行为'}
                    </CardTitle>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        配置触发器执行的动作并测试执行效果
                    </p>
                </CardHeader>
                <CardContent className="relative space-y-6">
                    {/* 悬浮数据预览按钮 */}
                    <div className="fixed bottom-6 right-6 z-10">
                        <button
                            onClick={() => setShowDataPreview(true)}
                            className="bg-blue-500 hover:bg-blue-600 text-white p-3 rounded-full shadow-lg"
                            title="预览邮件数据"
                        >
                            <Eye className="h-5 w-5" />
                        </button>
                    </div>

                    {/* 前置条件检查 */}
                    <div className="space-y-2">
                        <h4 className="font-medium">前置条件检查</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div className={`p-3 rounded-lg ${emailData && Object.keys(emailData).length > 0
                                ? 'bg-green-50 dark:bg-green-900/20'
                                : 'bg-red-50 dark:bg-red-900/20'
                                }`}>
                                <div className={`flex items-center gap-2 ${emailData && Object.keys(emailData).length > 0
                                    ? 'text-green-700 dark:text-green-300'
                                    : 'text-red-700 dark:text-red-300'
                                    }`}>
                                    {emailData && Object.keys(emailData).length > 0 ? (
                                        <CheckCircle className="h-4 w-4" />
                                    ) : (
                                        <XCircle className="h-4 w-4" />
                                    )}
                                    <span className="text-sm font-medium">邮件数据</span>
                                </div>
                                <p className="text-xs mt-1 opacity-80">
                                    {emailData && Object.keys(emailData).length > 0 ? '已配置' : '未配置'}
                                </p>
                            </div>

                            <div className={`p-3 rounded-lg ${expressions.length > 0
                                ? 'bg-green-50 dark:bg-green-900/20'
                                : 'bg-red-50 dark:bg-red-900/20'
                                }`}>
                                <div className={`flex items-center gap-2 ${expressions.length > 0
                                    ? 'text-green-700 dark:text-green-300'
                                    : 'text-red-700 dark:text-red-300'
                                    }`}>
                                    {expressions.length > 0 ? (
                                        <CheckCircle className="h-4 w-4" />
                                    ) : (
                                        <XCircle className="h-4 w-4" />
                                    )}
                                    <span className="text-sm font-medium">过滤表达式</span>
                                </div>
                                <p className="text-xs mt-1 opacity-80">
                                    {expressions.length > 0 ? `${expressions.length} 个条件` : '未配置'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 动作配置 - 使用 AncestorProvider 提供步骤级别的面包屑上下文 */}
                    {/* skipFromPath=true 使"动作配置"不显示在面包屑中，只显示有意义的分支名称 */}
                    <div className="space-y-4" ref={actionSectionRef}>
                        <AncestorProvider currentItem={{
                            id: 'action-step',
                            type: 'root' as const,
                            label: '动作配置',
                            description: `${actions.length} 个动作`,
                            level: 0
                        }} skipFromPath={true}>
                            <ActionSection
                                actions={actions}
                                onChange={handleActionsChange}
                                testData={emailData}
                                expressions={expressions}
                                onActionSelect={handleActionSelectInternal}
                            />
                        </AncestorProvider>
                    </div>

                    {/* 测试按钮和结果 */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <Button
                                onClick={testActions}
                                disabled={isTestingActions || actions.length === 0}
                                variant="outline"
                                size="sm"
                            >
                                <Play className={`h-4 w-4 mr-2 ${isTestingActions ? 'animate-spin' : ''}`} />
                                {isTestingActions ? '测试中...' : '测试动作'}
                            </Button>

                            {actions.length > 0 && (
                                <Badge variant="secondary" className="text-xs">
                                    {actions.length} 个动作
                                </Badge>
                            )}
                        </div>

                        {/* 测试结果 */}
                        {testResult && (
                            <div className={`p-4 rounded-lg ${testResult.passed
                                ? 'bg-green-50 dark:bg-green-900/20'
                                : 'bg-red-50 dark:bg-red-900/20'
                                }`}>
                                <div className={`flex items-center gap-2 ${testResult.passed
                                    ? 'text-green-700 dark:text-green-300'
                                    : 'text-red-700 dark:text-red-300'
                                    }`}>
                                    {testResult.passed ? (
                                        <CheckCircle className="h-4 w-4" />
                                    ) : (
                                        <XCircle className="h-4 w-4" />
                                    )}
                                    <span className="font-medium">{testResult.message}</span>
                                </div>
                                {testResult.details && (
                                    <div className="mt-2 text-sm opacity-80">
                                        <pre className="whitespace-pre-wrap">
                                            {JSON.stringify(testResult.details, null, 2)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 提示信息 */}
                    {actions.length === 0 && (
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                                <AlertCircle className="h-4 w-4" />
                                <span className="font-medium">配置动作</span>
                            </div>
                            <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                                请配置当邮件匹配过滤条件时要执行的动作。您可以添加多个动作，它们会按顺序执行。
                            </p>
                        </div>
                    )}

                    {actions.length > 0 && !testResult && (
                        <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                            <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
                                <AlertCircle className="h-4 w-4" />
                                <span className="font-medium">请测试动作</span>
                            </div>
                            <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-1">
                                配置完成后，请点击"测试动作"验证执行效果。
                            </p>
                        </div>
                    )}

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

            {/* 数据预览模态框 */}
            {showDataPreview && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowDataPreview(false)}>
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-semibold">邮件数据预览</h3>
                            <button
                                onClick={() => setShowDataPreview(false)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            {emailData && Object.keys(emailData).length > 0 ? (
                                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                                    <h4 className="font-medium mb-2">邮件信息</h4>
                                    <div className="space-y-2 text-sm">
                                        <div><strong>主题:</strong> {emailData.subject || '无'}</div>
                                        <div><strong>发件人:</strong> {emailData.from || '无'}</div>
                                        <div><strong>收件人:</strong> {emailData.to || '无'}</div>
                                        <div><strong>日期:</strong> {emailData.date || '无'}</div>
                                        <div><strong>内容:</strong> {emailData.textContent ? emailData.textContent.substring(0, 200) + '...' : '无'}</div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-8 text-gray-500">
                                    <p>暂无邮件数据</p>
                                    <p className="text-sm mt-2">请先在第一步选择或输入邮件数据</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 动作结构导航面板 - 悬浮显示 */}
            {actions.length > 0 && (
                <ActionStructurePanel
                    actions={actions}
                    selectedActionId={selectedActionId}
                    onActionSelect={handleStructurePanelSelect}
                    onScrollToAction={handleScrollToAction}
                />
            )}
        </>
    )
}