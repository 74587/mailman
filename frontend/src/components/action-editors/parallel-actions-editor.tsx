'use client'

import React, { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
    Layers,
    Clock,
    AlertTriangle,
    CheckCircle,
    Zap
} from 'lucide-react'

// 复用现有的动作组件
import { ActionSection } from '@/components/filter-action-trigger/action-section'

// 并行动作配置
interface ParallelAction {
    id: string
    pluginId: string
    pluginName: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
}

// 并行动作配置
interface ParallelActionsConfig {
    actions: ParallelAction[]
    timeout_seconds: number
    fail_fast: boolean
    ignore_errors: boolean
}

interface ParallelActionsEditorProps {
    config: Partial<ParallelActionsConfig> | Record<string, any>
    onChange: (config: ParallelActionsConfig | Record<string, any>) => void
    availablePlugins?: Array<{
        id: string
        name: string
        description: string
    }>
    onActionSelect?: (action: any) => void
    pluginContext?: 'trigger' | 'pickup'
}

// 主组件：并行动作编辑器
export function ParallelActionsEditor({
    config,
    onChange,
    availablePlugins = [],
    onActionSelect,
    pluginContext = 'trigger'
}: ParallelActionsEditorProps) {
    // 确保 config 有默认值
    const safeConfig: ParallelActionsConfig = {
        actions: (config as any)?.actions || [],
        timeout_seconds: (config as any)?.timeout_seconds ?? 30,
        fail_fast: (config as any)?.fail_fast ?? false,
        ignore_errors: (config as any)?.ignore_errors ?? true
    }

    // 处理动作更新
    const handleActionsChange = useCallback((actions: ParallelAction[]) => {
        onChange({ ...safeConfig, actions })
    }, [safeConfig, onChange])

    // 处理超时设置
    const handleTimeoutChange = useCallback((value: string) => {
        const seconds = parseInt(value) || 30
        onChange({ ...safeConfig, timeout_seconds: Math.min(Math.max(seconds, 5), 120) })
    }, [safeConfig, onChange])

    return (
        <div className="space-y-4">
            {/* 头部说明 */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <Layers className="h-5 w-5 text-blue-500" />
                    <h3 className="font-medium">并行动作配置</h3>
                    <Badge variant="secondary">
                        {safeConfig.actions.length} 个动作
                    </Badge>
                </div>
            </div>

            {/* 执行选项 */}
            <Card className="bg-gray-50 dark:bg-gray-800/50">
                <CardHeader className="py-3 px-4">
                    <Label className="text-sm font-medium">执行选项</Label>
                </CardHeader>
                <CardContent className="pt-0">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* 超时设置 */}
                        <div className="space-y-2">
                            <Label className="text-sm flex items-center gap-2">
                                <Clock className="h-4 w-4" />
                                超时时间 (秒)
                            </Label>
                            <Input
                                type="number"
                                value={safeConfig.timeout_seconds}
                                onChange={(e) => handleTimeoutChange(e.target.value)}
                                min={5}
                                max={120}
                                className="h-9"
                            />
                            <p className="text-xs text-gray-500">范围: 5-120秒</p>
                        </div>

                        {/* 快速失败 */}
                        <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg">
                            <Switch
                                id="fail-fast"
                                checked={safeConfig.fail_fast}
                                onCheckedChange={(checked) => onChange({ ...safeConfig, fail_fast: checked })}
                            />
                            <div className="flex-1">
                                <Label htmlFor="fail-fast" className="text-sm flex items-center gap-1 cursor-pointer">
                                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                                    快速失败
                                </Label>
                                <p className="text-xs text-gray-500">任一动作失败时立即停止</p>
                            </div>
                        </div>

                        {/* 忽略错误 */}
                        <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg">
                            <Switch
                                id="ignore-errors"
                                checked={safeConfig.ignore_errors}
                                onCheckedChange={(checked) => onChange({ ...safeConfig, ignore_errors: checked })}
                            />
                            <div className="flex-1">
                                <Label htmlFor="ignore-errors" className="text-sm flex items-center gap-1 cursor-pointer">
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                    忽略错误
                                </Label>
                                <p className="text-xs text-gray-500">部分失败也返回成功</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* 并行动作视觉提示 */}
            <Card>
                <CardHeader className="py-3 px-4 bg-blue-50 dark:bg-blue-900/30">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center">
                            <Zap className="h-4 w-4 text-white" />
                        </div>
                        <div>
                            <Label className="text-sm font-medium">并行执行的动作</Label>
                            <p className="text-xs text-gray-500">下列所有动作将同时开始执行</p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="py-4">
                    {/* 使用现有的 ActionSection 组件 */}
                    <ActionSection
                        actions={safeConfig.actions}
                        onChange={handleActionsChange}
                        testData={{}}
                        hideHeader={true}
                        onActionSelect={onActionSelect}
                        pluginContext={pluginContext}
                    />
                </CardContent>
            </Card>

            {/* 提示信息 */}
            <div className="text-xs text-gray-500 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p><strong>并行执行说明：</strong></p>
                <ul className="mt-1 space-y-1 list-disc list-inside">
                    <li>所有动作将同时开始执行，互不等待</li>
                    <li>适用于发送多个通知、执行多个独立操作等场景</li>
                    <li>每个动作的执行结果独立记录</li>
                    <li>可以通过"快速失败"选项控制错误时的行为</li>
                </ul>
            </div>
        </div>
    )
}

export default ParallelActionsEditor
