'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { triggerService } from '@/services/trigger.service'
import { EmailTrigger } from '@/types'
import { TriggerLogs } from './trigger-logs'
import { TriggerStats } from './trigger-stats'
import { ExpressionGroup } from '@/components/expression-builder/expression-group'
import {
    Loader2,
    Info,
    Filter,
    Zap,
    ClipboardList,
    BarChart3,
    Calendar,
    Clock,
    CheckCircle,
    AlertCircle,
    Play,
    Pause,
    Settings,
    Eye,
    Hash
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ActionReadonlyView } from './action-readonly-view'

// 将旧格式条件转换为新格式 expressions
function convertConditionToExpressions(condition: any, existingExpressions?: any[]): any[] {
    // 如果已经有 expressions 且不为空，直接使用
    if (existingExpressions && existingExpressions.length > 0) {
        return existingExpressions
    }

    // 如果没有 condition，返回空数组
    if (!condition) {
        return []
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

    return []
}

interface TriggerViewTabProps {
    triggerId: number
}

export function TriggerViewTab({ triggerId }: TriggerViewTabProps) {
    const [trigger, setTrigger] = useState<EmailTrigger | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [leftTab, setLeftTab] = useState('info')
    const [rightTab, setRightTab] = useState('logs')

    // 加载触发器数据
    useEffect(() => {
        const loadTrigger = async () => {
            try {
                setIsLoading(true)
                setError(null)
                const triggerData = await triggerService.getTrigger(triggerId)
                setTrigger(triggerData)
            } catch (err: any) {
                console.error('加载触发器失败:', err)
                setError(err.message || '加载触发器失败')
            } finally {
                setIsLoading(false)
            }
        }
        loadTrigger()
    }, [triggerId])

    // 处理状态变更
    const handleStatusChange = async () => {
        if (!trigger) return
        try {
            if (trigger.status === 'enabled') {
                await triggerService.disableTrigger(trigger.id)
            } else {
                await triggerService.enableTrigger(trigger.id)
            }
            // 重新加载触发器数据
            const updatedTrigger = await triggerService.getTrigger(triggerId)
            setTrigger(updatedTrigger)
        } catch (error) {
            console.error('更改触发器状态失败:', error)
        }
    }

    // 打开编辑 Tab
    const handleEdit = () => {
        const tabId = `trigger-edit-${triggerId}`
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: tabId,
                data: { triggerId, triggerName: trigger?.name }
            }
        }))
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                    <p className="mt-4 text-gray-600">加载触发器详情...</p>
                </div>
            </div>
        )
    }

    if (error || !trigger) {
        return (
            <div className="flex items-center justify-center h-full">
                <Card className="p-6 max-w-md">
                    <h3 className="text-lg font-semibold text-red-600 mb-2">加载失败</h3>
                    <p className="text-gray-600 mb-4">{error || '触发器不存在'}</p>
                </Card>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* 顶部标题栏 */}
            <div className="bg-white dark:bg-gray-800 border-b px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Eye className="h-6 w-6 text-blue-600" />
                        <div>
                            <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                                {trigger.name}
                            </h1>
                            <p className="text-sm text-gray-500">
                                {trigger.description || '暂无描述'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge className={cn(
                            trigger.status === 'enabled'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        )}>
                            {trigger.status === 'enabled' ? (
                                <><CheckCircle className="h-3 w-3 mr-1" />运行中</>
                            ) : (
                                <><Clock className="h-3 w-3 mr-1" />已停用</>
                            )}
                        </Badge>
                        <Button variant="outline" size="sm" onClick={handleStatusChange}>
                            {trigger.status === 'enabled' ? (
                                <><Pause className="h-4 w-4 mr-1" />禁用</>
                            ) : (
                                <><Play className="h-4 w-4 mr-1" />启用</>
                            )}
                        </Button>
                        <Button size="sm" onClick={handleEdit}>
                            <Settings className="h-4 w-4 mr-1" />
                            编辑
                        </Button>
                    </div>
                </div>
            </div>

            {/* 主要内容区域 - 左右分栏 */}
            <div className="flex-1 flex overflow-hidden">
                {/* 左侧配置面板 */}
                <div className="w-[45%] border-r bg-white dark:bg-gray-800 overflow-hidden flex flex-col">
                    <Tabs value={leftTab} onValueChange={setLeftTab} className="flex flex-col h-full">
                        <TabsList className="grid w-full grid-cols-3 mx-4 mt-4 max-w-[calc(100%-2rem)]">
                            <TabsTrigger value="info" className="flex items-center gap-1">
                                <Info className="h-4 w-4" />
                                基本信息
                            </TabsTrigger>
                            <TabsTrigger value="filter" className="flex items-center gap-1">
                                <Filter className="h-4 w-4" />
                                过滤配置
                            </TabsTrigger>
                            <TabsTrigger value="action" className="flex items-center gap-1">
                                <Zap className="h-4 w-4" />
                                动作配置
                            </TabsTrigger>
                        </TabsList>

                        <div className="flex-1 overflow-y-auto p-4">
                            <TabsContent value="info" className="m-0 h-full">
                                <TriggerInfoPanel trigger={trigger} />
                            </TabsContent>

                            <TabsContent value="filter" className="m-0 h-full">
                                <TriggerFilterPanel trigger={trigger} />
                            </TabsContent>

                            <TabsContent value="action" className="m-0 h-full">
                                <TriggerActionPanel trigger={trigger} />
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>

                {/* 右侧运行数据面板 */}
                <div className="w-[55%] bg-white dark:bg-gray-800 overflow-hidden flex flex-col">
                    <Tabs value={rightTab} onValueChange={setRightTab} className="flex flex-col h-full">
                        <TabsList className="grid w-full grid-cols-2 mx-4 mt-4 max-w-[calc(100%-2rem)]">
                            <TabsTrigger value="logs" className="flex items-center gap-1">
                                <ClipboardList className="h-4 w-4" />
                                调用日志
                            </TabsTrigger>
                            <TabsTrigger value="stats" className="flex items-center gap-1">
                                <BarChart3 className="h-4 w-4" />
                                统计监控
                            </TabsTrigger>
                        </TabsList>

                        <div className="flex-1 overflow-y-auto p-4">
                            <TabsContent value="logs" className="m-0 h-full">
                                <TriggerLogs triggerId={triggerId} />
                            </TabsContent>

                            <TabsContent value="stats" className="m-0 h-full">
                                <TriggerStats triggerId={triggerId} />
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>
            </div>
        </div>
    )
}

// 基本信息面板
function TriggerInfoPanel({ trigger }: { trigger: EmailTrigger }) {
    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('zh-CN')
    }

    const getSuccessRate = () => {
        const total = trigger.total_executions || 0
        const success = trigger.success_executions || 0
        if (total === 0) return '暂无数据'
        return `${Math.round((success / total) * 100)}%`
    }

    return (
        <div className="space-y-6">
            {/* 基本信息卡片 */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Info className="h-4 w-4 text-blue-500" />
                        触发器信息
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">ID</label>
                            <p className="text-sm font-medium flex items-center gap-1">
                                <Hash className="h-3 w-3" />
                                {trigger.id}
                            </p>
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">状态</label>
                            <Badge className={cn(
                                "mt-1",
                                trigger.status === 'enabled'
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-gray-100 text-gray-600'
                            )}>
                                {trigger.status === 'enabled' ? '运行中' : '已停用'}
                            </Badge>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wide">名称</label>
                        <p className="text-sm font-medium">{trigger.name}</p>
                    </div>

                    <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wide">描述</label>
                        <p className="text-sm text-gray-600">{trigger.description || '暂无描述'}</p>
                    </div>
                </CardContent>
            </Card>

            {/* 执行统计卡片 */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-purple-500" />
                        执行统计
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <p className="text-2xl font-bold text-blue-600">{trigger.total_executions || 0}</p>
                            <p className="text-xs text-gray-500">总执行次数</p>
                        </div>
                        <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                            <p className="text-2xl font-bold text-green-600">{trigger.success_executions || 0}</p>
                            <p className="text-xs text-gray-500">成功次数</p>
                        </div>
                        <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                            <p className="text-2xl font-bold text-purple-600">{getSuccessRate()}</p>
                            <p className="text-xs text-gray-500">成功率</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* 时间信息卡片 */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-amber-500" />
                        时间信息
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">创建时间</span>
                        <span className="text-sm font-medium">{formatDate(trigger.created_at)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">更新时间</span>
                        <span className="text-sm font-medium">{formatDate(trigger.updated_at)}</span>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

// 过滤器配置面板
function TriggerFilterPanel({ trigger }: { trigger: EmailTrigger }) {
    // 使用转换函数处理旧格式条件
    const expressions = convertConditionToExpressions(trigger.condition, trigger.expressions)

    if (expressions.length === 0) {
        return (
            <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-12">
                    <Filter className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">暂无过滤配置</p>
                    <p className="text-sm text-gray-400 mt-1">此触发器将匹配所有邮件</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                    共 {expressions.length} 个表达式条件
                </p>
                <Badge variant="outline">{trigger.condition?.type || 'v2'}</Badge>
            </div>

            {expressions.map((expr: any, index: number) => (
                <Card key={index} className="overflow-hidden">
                    <CardHeader className="py-3 bg-gray-50 dark:bg-gray-900/50">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Filter className="h-4 w-4 text-purple-500" />
                            表达式 {index + 1}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                        <ExpressionGroup
                            expression={expr}
                            onChange={() => { }}
                            onDelete={() => { }}
                            testData={{}}
                            readOnly={true}
                        />
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}

// 动作配置面板
function TriggerActionPanel({ trigger }: { trigger: EmailTrigger }) {
    const actions = trigger.actions || []

    return <ActionReadonlyView actions={actions} />
}

export default TriggerViewTab
