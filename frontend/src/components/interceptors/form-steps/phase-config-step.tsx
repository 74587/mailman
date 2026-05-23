'use client'

import { useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Input } from '@/components/ui/input'
import { Interceptor, InterceptorPluginInfo, ExecutionMode } from '@/services/interceptor.service'
import { Clock, Zap, AlertCircle, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PhaseConfigStepProps {
    formData: Partial<Interceptor>
    currentPlugin: InterceptorPluginInfo | undefined
    onChange: (updates: Partial<Interceptor>) => void
}

// 获取类型描述
function getTypeDescription(type: string | undefined): { title: string; description: string; color: string } {
    switch (type) {
        case 'around':
            return {
                title: '环绕拦截器',
                description: '前置和后置阶段必须同时启用，用于需要配对工作的场景（如日志记录、性能监控）',
                color: 'text-purple-500',
            }
        case 'before_only':
            return {
                title: '仅前置拦截器',
                description: '只在动作执行前工作，可独立使用（如权限验证、参数检查）',
                color: 'text-blue-500',
            }
        case 'after_only':
            return {
                title: '仅后置拦截器',
                description: '只在动作执行后工作，可独立使用（如发送通知）',
                color: 'text-green-500',
            }
        default:
            return {
                title: '未知类型',
                description: '',
                color: 'text-muted-foreground',
            }
    }
}

export function PhaseConfigStep({ formData, currentPlugin, onChange }: PhaseConfigStepProps) {
    const phases = formData.phases || { before: true, after: true }
    const execution = formData.execution || { after_mode: 'sync' as ExecutionMode }

    // 检查插件类型
    const pluginType = currentPlugin?.type
    const isAround = pluginType === 'around'
    const supportsBefore = currentPlugin?.supports_before ?? true
    const supportsAfter = currentPlugin?.supports_after ?? true

    // 环绕拦截器：同时切换两个阶段
    const toggleAroundPhases = (enabled: boolean) => {
        onChange({ phases: { before: enabled, after: enabled } })
    }

    // 环绕拦截器自动同步两个阶段
    useEffect(() => {
        if (isAround && (phases.before !== phases.after)) {
            // 如果是环绕拦截器，确保两个阶段同步
            onChange({ phases: { before: true, after: true } })
        }
    }, [isAround, phases.before, phases.after, onChange])

    const updatePhases = (updates: Partial<typeof phases>) => {
        if (isAround) {
            // 环绕拦截器不允许单独切换
            return
        }
        onChange({ phases: { ...phases, ...updates } })
    }

    const updateExecution = (updates: Partial<typeof execution>) => {
        onChange({ execution: { ...execution, ...updates } })
    }

    const typeInfo = getTypeDescription(pluginType)

    return (
        <div className="space-y-6">
            {/* 插件类型提示 */}
            {currentPlugin && (
                <div className={cn(
                    'p-4 rounded-lg flex items-start gap-3',
                    isAround ? 'bg-purple-500/10 border border-purple-500/30' : 'bg-muted/50'
                )}>
                    {isAround ? (
                        <Link2 className="w-5 h-5 text-purple-500 mt-0.5" />
                    ) : (
                        <AlertCircle className={cn('w-5 h-5 mt-0.5', typeInfo.color)} />
                    )}
                    <div>
                        <p className={cn('text-sm font-medium', typeInfo.color)}>
                            {typeInfo.title}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {typeInfo.description}
                        </p>
                        {isAround && (
                            <p className="text-sm text-purple-400 mt-1 font-medium">
                                ⚠️ 前置和后置阶段将同时启用或禁用
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* 执行阶段选择 */}
            <div className="space-y-4">
                <Label>启用执行阶段</Label>

                {/* 环绕拦截器：显示联动开关 */}
                {isAround ? (
                    <div
                        className={cn(
                            'p-4 rounded-lg border transition-all cursor-pointer',
                            phases.before && phases.after
                                ? 'border-purple-500 bg-purple-500/10'
                                : 'border-border hover:border-muted-foreground/50'
                        )}
                        onClick={() => toggleAroundPhases(!(phases.before && phases.after))}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <Link2 className="w-5 h-5 text-purple-500" />
                                <span className="font-medium">环绕拦截（前置 + 后置）</span>
                            </div>
                            <Switch
                                checked={phases.before && phases.after}
                                onCheckedChange={toggleAroundPhases}
                            />
                        </div>
                        <p className="text-sm text-muted-foreground">
                            前置阶段初始化记录，后置阶段完成记录，两者必须配合工作
                        </p>
                    </div>
                ) : (
                    /* 非环绕拦截器：独立开关 */
                    <div className="grid grid-cols-2 gap-4">
                        {/* 前置阶段 */}
                        <div
                            className={cn(
                                'p-4 rounded-lg border transition-all cursor-pointer',
                                phases.before
                                    ? 'border-blue-500 bg-blue-500/10'
                                    : 'border-border hover:border-muted-foreground/50',
                                !supportsBefore && 'opacity-50 cursor-not-allowed'
                            )}
                            onClick={() => supportsBefore && updatePhases({ before: !phases.before })}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-blue-500" />
                                    <span className="font-medium">前置阶段</span>
                                </div>
                                <Switch
                                    checked={phases.before}
                                    onCheckedChange={(checked) => updatePhases({ before: checked })}
                                    disabled={!supportsBefore}
                                />
                            </div>
                            <p className="text-sm text-muted-foreground">
                                在动作执行前调用，可阻止动作执行或修改上下文
                            </p>
                        </div>

                        {/* 后置阶段 */}
                        <div
                            className={cn(
                                'p-4 rounded-lg border transition-all cursor-pointer',
                                phases.after
                                    ? 'border-green-500 bg-green-500/10'
                                    : 'border-border hover:border-muted-foreground/50',
                                !supportsAfter && 'opacity-50 cursor-not-allowed'
                            )}
                            onClick={() => supportsAfter && updatePhases({ after: !phases.after })}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <Clock className="w-5 h-5 text-green-500" />
                                    <span className="font-medium">后置阶段</span>
                                </div>
                                <Switch
                                    checked={phases.after}
                                    onCheckedChange={(checked) => updatePhases({ after: checked })}
                                    disabled={!supportsAfter}
                                />
                            </div>
                            <p className="text-sm text-muted-foreground">
                                在动作执行后调用，用于记录日志、发送通知等
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* 后置阶段执行模式 */}
            {phases.after && (
                <div className="space-y-4 p-4 rounded-lg border">
                    <Label>后置阶段执行模式</Label>
                    <RadioGroup
                        value={execution.after_mode}
                        onValueChange={(value: ExecutionMode) => updateExecution({ after_mode: value })}
                        className="space-y-3"
                    >
                        <div className="flex items-start gap-3">
                            <RadioGroupItem value="sync" id="sync" className="mt-1" />
                            <div className="space-y-1">
                                <Label htmlFor="sync" className="font-medium cursor-pointer">
                                    同步执行
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    等待拦截器执行完成后再继续，确保日志完整记录
                                </p>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <RadioGroupItem value="async" id="async" className="mt-1" />
                            <div className="space-y-1">
                                <Label htmlFor="async" className="font-medium cursor-pointer">
                                    异步执行
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    提交到队列异步处理，不阻塞后续流程，适合耗时操作
                                </p>
                            </div>
                        </div>
                    </RadioGroup>

                    {/* 异步执行配置 */}
                    {execution.after_mode === 'async' && (
                        <div className="mt-4 pt-4 border-t space-y-4">
                            <Label className="text-muted-foreground">异步执行配置</Label>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="queue_name">队列名称</Label>
                                    <Input
                                        id="queue_name"
                                        placeholder="default"
                                        value={execution.async_config?.queue_name || ''}
                                        onChange={(e) =>
                                            updateExecution({
                                                async_config: {
                                                    ...execution.async_config,
                                                    queue_name: e.target.value,
                                                },
                                            })
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="timeout">执行超时 (秒)</Label>
                                    <Input
                                        id="timeout"
                                        type="number"
                                        placeholder="30"
                                        value={execution.async_config?.timeout_seconds || 30}
                                        onChange={(e) =>
                                            updateExecution({
                                                async_config: {
                                                    ...execution.async_config,
                                                    timeout_seconds: parseInt(e.target.value) || 30,
                                                },
                                            })
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
