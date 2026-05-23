'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { apiClient } from '@/lib/api-client'
import { logger } from '@/lib/logger'
import { ActionPipeline } from './action-pipeline'
import { ActionConfigPanel } from './action-config-panel'
import { ActionResultsPanel } from './action-results-panel'
import { HelpTooltip } from './help-tooltip'

interface Action {
    id: string
    pluginId: string
    pluginName: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
}

interface ExecutionResult {
    results: Array<{
        success: boolean
        result?: any
        error?: string
        duration_ms: number
        plugin_info?: any
    }>
    summary: {
        total_actions: number
        successful_actions: number
        failed_actions: number
        total_duration: number
    }
}

interface ActionDebuggerEnhancedProps {
    actions: Action[]
    onChange: (actions: Action[]) => void
}

export function ActionDebuggerEnhanced({ actions, onChange }: ActionDebuggerEnhancedProps) {
    const [selectedActionId, setSelectedActionId] = useState<string>()
    const [testData, setTestData] = useState<Record<string, any>>({
        event: {
            type: 'email_received',
            id: 'test-event-123',
            timestamp: new Date().toISOString(),
            data: {
                from: 'test@example.com',
                to: 'user@example.com',
                subject: '测试邮件',
                body: '这是一封测试邮件，用于调试动作插件',
                messageId: 'test-message-123',
                size: 1024,
                attachments: []
            }
        },
        context: {
            userId: 'user-123',
            accountId: 'account-456',
            triggerId: 'trigger-789'
        }
    })
    const [testDataInput, setTestDataInput] = useState('')
    const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)
    const [isExecuting, setIsExecuting] = useState(false)
    const [availablePlugins, setAvailablePlugins] = useState<Array<{
        id: string
        name: string
        description: string
        requiredConfig: string[]
        supportedEventTypes: string[]
    }>>([])

    // 初始化测试数据输入
    useEffect(() => {
        setTestDataInput(JSON.stringify(testData, null, 2))
    }, [])

    // 解析测试数据
    const handleTestDataChange = useCallback((value: string) => {
        setTestDataInput(value)
        try {
            const parsed = JSON.parse(value)
            setTestData(parsed)
        } catch {
            // 忽略解析错误
        }
    }, [])

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

            logger.debug('获取到的动作插件:', formattedPlugins)
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
        }
    }, [actions, availablePlugins, onChange])

    // 执行动作链
    const handleExecute = async () => {
        try {
            setIsExecuting(true)
            setExecutionResult(null)

            // 过滤启用的动作并按执行顺序排序
            const enabledActions = actions
                .filter(action => action.enabled)
                .sort((a, b) => a.executionOrder - b.executionOrder)

            if (enabledActions.length === 0) {
                setExecutionResult({
                    results: [],
                    summary: {
                        total_actions: 0,
                        successful_actions: 0,
                        failed_actions: 0,
                        total_duration: 0
                    }
                })
                return
            }

            // 构建执行请求
            const executeRequest = {
                actions: enabledActions.map(action => ({
                    plugin_id: action.pluginId,
                    config: action.config
                })),
                data: testData
            }

            // 调用后端API执行动作链
            const response = await apiClient.post('/triggers/execute-actions', executeRequest)

            setExecutionResult(response)
        } catch (error: any) {
            setExecutionResult({
                results: [],
                summary: {
                    total_actions: actions.length,
                    successful_actions: 0,
                    failed_actions: actions.length,
                    total_duration: 0
                }
            })
        } finally {
            setIsExecuting(false)
        }
    }

    // 更新动作配置
    const handleActionConfigChange = useCallback((actionId: string, config: Record<string, any>) => {
        const updatedActions = actions.map(action =>
            action.id === actionId ? { ...action, config } : action
        )
        onChange(updatedActions)
    }, [actions, onChange])

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
        }
    }, [actions, selectedActionId])

    return (
        <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* 动作流水线 (上栏) */}
            <ActionPipeline
                actions={actions}
                selectedActionId={selectedActionId}
                availablePlugins={availablePlugins}
                onActionsChange={onChange}
                onActionSelect={setSelectedActionId}
                onAddAction={handleAddAction}
                onExecute={handleExecute}
                isExecuting={isExecuting}
            />

            {/* 配置编辑区 (下栏) */}
            <div className="flex-1 flex overflow-hidden">
                {/* 左侧配置面板 */}
                <div className="w-1/2 border-r bg-white overflow-y-auto">
                    <div className="p-6">
                        <Tabs defaultValue="config" className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="config" className="flex items-center gap-2">
                                    ⚙️ 动作配置
                                    <HelpTooltip content="配置当前选中动作的参数" />
                                </TabsTrigger>
                                <TabsTrigger value="data" className="flex items-center gap-2">
                                    📝 测试数据
                                    <HelpTooltip content="设置用于测试的邮件数据" />
                                </TabsTrigger>
                            </TabsList>

                            <TabsContent value="config" className="mt-6">
                                {selectedAction ? (
                                    <ActionConfigPanel
                                        action={selectedAction}
                                        availablePlugins={availablePlugins}
                                        onChange={(config) => handleActionConfigChange(selectedAction.id, config)}
                                    />
                                ) : (
                                    <div className="text-center py-12 text-gray-500">
                                        <div className="text-4xl mb-4">🎯</div>
                                        <p>请选择一个动作进行配置</p>
                                        <p className="text-sm mt-2">点击上方流水线中的动作卡片</p>
                                    </div>
                                )}
                            </TabsContent>

                            <TabsContent value="data" className="mt-6">
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <Label htmlFor="test-data">测试数据 (JSON)</Label>
                                        <HelpTooltip content="输入用于测试的邮件事件数据，支持完整的邮件对象结构" />
                                    </div>
                                    <Textarea
                                        id="test-data"
                                        value={testDataInput}
                                        onChange={(e) => handleTestDataChange(e.target.value)}
                                        placeholder='{"event": {...}, "context": {...}}'
                                        className="font-mono text-sm h-96"
                                    />
                                    <div className="text-xs text-gray-500">
                                        <p>支持的字段：event.data.subject, from, to, body, attachments 等</p>
                                        <p>动作将按顺序执行，每个动作的输出会传递给下一个动作</p>
                                    </div>
                                </div>
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>

                {/* 右侧预览面板 */}
                <div className="w-1/2 bg-white overflow-y-auto">
                    <ActionResultsPanel
                        actions={actions}
                        selectedActionId={selectedActionId}
                        executionResult={executionResult}
                        isExecuting={isExecuting}
                        testData={testData}
                    />
                </div>
            </div>
        </div>
    )
}