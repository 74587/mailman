'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiClient } from '@/lib/api-client'
import { logger } from '@/lib/logger'
import { ActionPipeline } from '@/components/action-debugger/action-pipeline'
import { ActionConfigPanel } from '@/components/action-debugger/action-config-panel'
import { Zap } from 'lucide-react'
import { AncestorProvider, useAncestors, BreadcrumbItem } from '@/components/ui/sticky-breadcrumb'

interface Action {
    id: string
    pluginId: string
    pluginName: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
}

// 执行结果类型
export interface ActionExecutionResult {
    actionId: string
    success: boolean
    message?: string
    details?: any
    timestamp: number
}

interface ActionSectionProps {
    actions: Action[]
    onChange: (actions: Action[]) => void
    testData: Record<string, any>
    expressions?: any[] // 用于执行动作时传递表达式
    onActionSelect?: (action: Action | null, executionResult?: ActionExecutionResult, actionIndex?: number) => void
    hideHeader?: boolean // 隐藏标题
    readOnly?: boolean // 只读模式
}

export function ActionSection({ actions, onChange, testData, expressions = [], onActionSelect, hideHeader = false, readOnly = false }: ActionSectionProps) {
    const [selectedActionId, setSelectedActionId] = useState<string>()
    const [executingActionId, setExecutingActionId] = useState<string | undefined>()
    const [executionResults, setExecutionResults] = useState<Record<string, ActionExecutionResult>>({})
    const [availablePlugins, setAvailablePlugins] = useState<Array<{
        id: string
        name: string
        description: string
        requiredConfig: string[]
        supportedEventTypes: string[]
    }>>([])

    // 获取祖先信息
    const { ancestors } = useAncestors()

    // 获取可用的动作插件
    const fetchAvailablePlugins = useCallback(async () => {
        try {
            const response = await apiClient.get('/plugins/ui/schemas', {
                params: { type: 'action' }
            })
            // 转换UI schemas为插件列表，过滤出动作插件
            const formattedPlugins = Object.keys(response)
                .filter(pluginId => {
                    const plugin = response[pluginId]
                    // 过滤出动作插件（排除条件插件如builtin）
                    return plugin.info.type === 'action' ||
                        (plugin.info.type !== 'condition' && pluginId !== 'builtin')
                })
                .map((pluginId) => ({
                    id: pluginId,
                    name: response[pluginId].info.name || pluginId,
                    description: response[pluginId].info.description || '',
                    requiredConfig: response[pluginId].schema?.fields?.map((field: any) => field.name) || [],
                    supportedEventTypes: ['email_received'] // 默认支持邮件接收事件
                }))

            setAvailablePlugins(formattedPlugins)
        } catch (error) {
            console.error('获取动作插件失败:', error)
        }
    }, [])

    // 获取插件默认配置
    const getDefaultConfigForPlugin = (pluginId: string): Record<string, any> => {
        switch (pluginId) {
            case 'email_transform_action':
                return {
                    target_field: 'subject',
                    transform_type: 'template'
                }
            case 'email_forward_action':
                return {
                    to_address: '',
                    subject_prefix: ''
                }
            case 'email_label_action':
                return {
                    operation: 'add',
                    labels: []
                }
            case 'email_delete_action':
                return {
                    permanent: false
                }
            default:
                return {}
        }
    }

    // 添加新动作
    const handleAddAction = useCallback((pluginId: string) => {
        const plugin = availablePlugins.find(p => p.id === pluginId)
        if (plugin) {
            // 应用插件默认配置
            const defaultConfig = getDefaultConfigForPlugin(pluginId)

            const newAction: Action = {
                id: Date.now().toString(),
                pluginId,
                pluginName: plugin.name,
                config: defaultConfig,
                enabled: true,
                executionOrder: actions.length + 1
            }
            const newActions = [...actions, newAction]
            onChange(newActions)
            setSelectedActionId(newAction.id)
            // 通知父组件选中了新动作
            onActionSelect?.(newAction, undefined, newActions.length - 1)
        }
    }, [actions, availablePlugins, onChange, onActionSelect])

    // 更新动作配置
    const handleActionConfigChange = useCallback((actionId: string, config: Record<string, any>) => {
        const updatedActions = actions.map(action =>
            action.id === actionId ? { ...action, config } : action
        )
        onChange(updatedActions)
    }, [actions, onChange])

    // 选择动作
    const handleActionSelect = useCallback((actionId: string) => {
        logger.debug('[ActionSection] handleActionSelect called with actionId:', actionId)
        setSelectedActionId(actionId)
        const actionIndex = actions.findIndex(a => a.id === actionId)
        const action = actionIndex >= 0 ? actions[actionIndex] : null
        const result = executionResults[actionId]
        logger.debug('[ActionSection] calling onActionSelect with action:', action?.id)
        onActionSelect?.(action, result, actionIndex >= 0 ? actionIndex : undefined)
    }, [actions, onActionSelect, executionResults])

    // 获取选中的动作
    const selectedAction = selectedActionId ? actions.find(a => a.id === selectedActionId) : null

    // 初始化时获取可用插件
    useEffect(() => {
        fetchAvailablePlugins()
    }, [fetchAvailablePlugins])

    // 自动选中第一个动作
    useEffect(() => {
        if (actions.length > 0 && !selectedActionId) {
            setSelectedActionId(actions[0].id)
            onActionSelect?.(actions[0], undefined, 0)
        }
    }, [actions, selectedActionId, onActionSelect])

    // 当 actions 更新时（例如切换 enabled 状态），同步更新父组件的选中动作状态
    useEffect(() => {
        if (selectedActionId) {
            const actionIndex = actions.findIndex(a => a.id === selectedActionId)
            if (actionIndex >= 0) {
                const updatedAction = actions[actionIndex]
                const result = executionResults[selectedActionId]
                onActionSelect?.(updatedAction, result, actionIndex)
            }
        }
    }, [actions, selectedActionId, executionResults, onActionSelect])

    // 执行单个动作
    const handleExecuteAction = useCallback(async (action: Action): Promise<{ success: boolean; message?: string }> => {
        setExecutingActionId(action.id)
        try {
            // 构建临时触发器对象，仅包含当前动作
            const tempTrigger = {
                name: "temp_action_test",
                enabled: true,
                expressions: expressions,
                actions: [{
                    ...action,
                    pluginId: action.pluginId,
                    config: typeof action.config === 'string' ? JSON.parse(action.config) : action.config
                }]
            }

            const result = await apiClient.post<any>('/v2/triggers/test-complete', {
                trigger: tempTrigger,
                testData: testData
            })

            // 检查执行结果
            const actionResult = result.actionResults?.[0]
            const executionResult: ActionExecutionResult = {
                actionId: action.id,
                success: !!actionResult?.success,
                message: actionResult?.success ? '执行成功' : (actionResult?.error || result.error || '执行失败'),
                details: actionResult,
                timestamp: Date.now()
            }

            // 保存执行结果
            setExecutionResults(prev => ({
                ...prev,
                [action.id]: executionResult
            }))

            // 如果是当前选中的动作，立即通知父组件
            if (selectedActionId === action.id) {
                const actionIndex = actions.findIndex(a => a.id === action.id)
                onActionSelect?.(action, executionResult, actionIndex >= 0 ? actionIndex : undefined)
            }

            if (actionResult?.success) {
                return { success: true, message: '执行成功' }
            } else {
                return { success: false, message: actionResult?.error || result.error || '执行失败' }
            }
        } catch (error: any) {
            console.error('执行动作失败:', error)
            const executionResult: ActionExecutionResult = {
                actionId: action.id,
                success: false,
                message: error.message || '执行过程中发生错误',
                timestamp: Date.now()
            }
            setExecutionResults(prev => ({
                ...prev,
                [action.id]: executionResult
            }))
            if (selectedActionId === action.id) {
                const actionIndex = actions.findIndex(a => a.id === action.id)
                onActionSelect?.(action, executionResult, actionIndex >= 0 ? actionIndex : undefined)
            }
            return { success: false, message: error.message || '执行过程中发生错误' }
        } finally {
            setExecutingActionId(undefined)
        }
    }, [testData, expressions, selectedActionId, onActionSelect])

    return (
        <div className="space-y-4">
            {!hideHeader && (
                <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-green-500" />
                    <h3 className="text-lg font-semibold">动作配置</h3>
                    <Badge variant="secondary" className="text-xs">
                        {actions.length} 个动作
                    </Badge>
                </div>
            )}

            {/* 动作流水线 */}
            <Card className="overflow-hidden">
                <ActionPipeline
                    actions={actions}
                    selectedActionId={selectedActionId}
                    availablePlugins={availablePlugins}
                    onActionsChange={readOnly ? () => { } : onChange}
                    onActionSelect={handleActionSelect}
                    onAddAction={readOnly ? () => { } : handleAddAction}
                    onExecute={() => { }} // 在父组件中统一执行
                    onExecuteAction={handleExecuteAction}
                    isExecuting={false}
                    executingActionId={executingActionId}
                    readOnly={readOnly}
                />
            </Card>

            {/* 动作配置面板 - 选中动作的面包屑已通过 SortableActionCard 的点击处理更新 */}
            {selectedAction ? (
                <Card className="p-4">
                    <h4 className="font-medium mb-4">动作详细配置</h4>
                    <ActionConfigPanel
                        action={selectedAction}
                        availablePlugins={availablePlugins}
                        onChange={(config) => handleActionConfigChange(selectedAction.id, config)}
                        testData={testData}
                        readOnly={readOnly}
                        onActionSelect={onActionSelect}
                    />
                </Card>
            ) : actions.length > 0 && !readOnly ? (
                <Card className="p-8 text-center border-dashed">
                    <div className="text-gray-500">
                        <Zap className="h-8 w-8 mx-auto mb-3 opacity-50" />
                        <p className="text-sm mb-2">选择一个动作进行配置</p>
                        <p className="text-xs">点击上方流水线中的动作卡片</p>
                    </div>
                </Card>
            ) : actions.length === 0 && !readOnly ? (
                <Card className="p-8 text-center border-dashed">
                    <div className="text-gray-500">
                        <Zap className="h-8 w-8 mx-auto mb-3 opacity-50" />
                        <p className="text-sm mb-2">暂无动作</p>
                        <p className="text-xs">添加动作来处理通过过滤器的邮件</p>
                    </div>
                </Card>
            ) : null}

            {/* 提示信息 - 只读模式下隐藏 */}
            {!readOnly && (
                <div className="text-xs text-gray-500 p-3 bg-green-50 dark:bg-green-900/20 rounded">
                    <p><strong>提示：</strong></p>
                    <ul className="mt-1 space-y-1">
                        <li>• 动作只有在过滤器通过后才会执行</li>
                        <li>• 动作按照执行顺序依次运行</li>
                        <li>• 每个动作的输出会传递给下一个动作</li>
                    </ul>
                </div>
            )}
        </div>
    )
}