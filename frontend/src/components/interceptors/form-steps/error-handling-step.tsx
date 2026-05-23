'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Interceptor, ErrorHandlingPolicy, SkipBehavior } from '@/services/interceptor.service'
import { AlertTriangle, FastForward, RotateCcw } from 'lucide-react'

interface ErrorHandlingStepProps {
    formData: Partial<Interceptor>
    onChange: (updates: Partial<Interceptor>) => void
}

const ERROR_POLICIES: { value: ErrorHandlingPolicy; label: string; description: string }[] = [
    { value: 'abort', label: '中断执行', description: '立即停止整个动作管道' },
    { value: 'continue', label: '继续执行', description: '忽略错误继续后续流程' },
    { value: 'skip_action', label: '跳过当前动作', description: '跳过当前动作继续下一个' },
]

const SKIP_BEHAVIORS: { value: SkipBehavior; label: string; description: string }[] = [
    { value: 'continue', label: '继续下一个', description: '跳过当前动作继续执行后续动作' },
    { value: 'abort', label: '中断管道', description: '跳过动作并停止整个执行管道' },
]

export function ErrorHandlingStep({ formData, onChange }: ErrorHandlingStepProps) {
    const errorHandling = formData.error_handling || {
        before_error_policy: 'abort' as ErrorHandlingPolicy,
        after_error_policy: 'continue' as ErrorHandlingPolicy,
        max_retries: 0,
        retry_delay_seconds: 0,
    }

    const skipConfig = formData.skip_config || {
        skip_behavior: 'continue' as SkipBehavior,
        execute_after_on_skip: true,
        log_skipped: true,
    }

    const updateErrorHandling = (updates: Partial<typeof errorHandling>) => {
        onChange({ error_handling: { ...errorHandling, ...updates } })
    }

    const updateSkipConfig = (updates: Partial<typeof skipConfig>) => {
        onChange({ skip_config: { ...skipConfig, ...updates } })
    }

    return (
        <div className="space-y-6">
            {/* 前置阶段错误策略 */}
            <div className="space-y-4 p-4 rounded-lg border">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                    <Label className="text-base font-medium">前置阶段错误处理</Label>
                </div>
                <p className="text-sm text-muted-foreground">
                    当前置拦截器执行出错时的处理策略
                </p>
                <Select
                    value={errorHandling.before_error_policy}
                    onValueChange={(value: ErrorHandlingPolicy) =>
                        updateErrorHandling({ before_error_policy: value })
                    }
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ERROR_POLICIES.map((policy) => (
                            <SelectItem key={policy.value} value={policy.value}>
                                <div className="flex flex-col">
                                    <span>{policy.label}</span>
                                    <span className="text-xs text-muted-foreground">{policy.description}</span>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* 后置阶段错误策略 */}
            <div className="space-y-4 p-4 rounded-lg border">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-yellow-500" />
                    <Label className="text-base font-medium">后置阶段错误处理</Label>
                </div>
                <p className="text-sm text-muted-foreground">
                    当后置拦截器执行出错时的处理策略（通常不影响已完成的动作）
                </p>
                <Select
                    value={errorHandling.after_error_policy}
                    onValueChange={(value: ErrorHandlingPolicy) =>
                        updateErrorHandling({ after_error_policy: value })
                    }
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ERROR_POLICIES.map((policy) => (
                            <SelectItem key={policy.value} value={policy.value}>
                                <div className="flex flex-col">
                                    <span>{policy.label}</span>
                                    <span className="text-xs text-muted-foreground">{policy.description}</span>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* 重试配置 */}
            <div className="space-y-4 p-4 rounded-lg border">
                <div className="flex items-center gap-2">
                    <RotateCcw className="w-5 h-5 text-blue-500" />
                    <Label className="text-base font-medium">重试配置</Label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="max_retries">最大重试次数</Label>
                        <Input
                            id="max_retries"
                            type="number"
                            min={0}
                            max={10}
                            value={errorHandling.max_retries || 0}
                            onChange={(e) =>
                                updateErrorHandling({ max_retries: parseInt(e.target.value) || 0 })
                            }
                        />
                        <p className="text-xs text-muted-foreground">0 表示不重试</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="retry_delay">重试间隔 (秒)</Label>
                        <Input
                            id="retry_delay"
                            type="number"
                            min={0}
                            max={60}
                            value={errorHandling.retry_delay_seconds || 0}
                            onChange={(e) =>
                                updateErrorHandling({ retry_delay_seconds: parseInt(e.target.value) || 0 })
                            }
                        />
                        <p className="text-xs text-muted-foreground">每次重试前的等待时间</p>
                    </div>
                </div>
            </div>

            {/* 跳过配置 */}
            <div className="space-y-4 p-4 rounded-lg border">
                <div className="flex items-center gap-2">
                    <FastForward className="w-5 h-5 text-purple-500" />
                    <Label className="text-base font-medium">跳过行为配置</Label>
                </div>
                <p className="text-sm text-muted-foreground">
                    当拦截器决定跳过某个动作时的行为配置
                </p>

                {/* 跳过后的行为 */}
                <div className="space-y-2">
                    <Label>跳过后的行为</Label>
                    <Select
                        value={skipConfig.skip_behavior}
                        onValueChange={(value: SkipBehavior) =>
                            updateSkipConfig({ skip_behavior: value })
                        }
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SKIP_BEHAVIORS.map((behavior) => (
                                <SelectItem key={behavior.value} value={behavior.value}>
                                    <div className="flex flex-col">
                                        <span>{behavior.label}</span>
                                        <span className="text-xs text-muted-foreground">{behavior.description}</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* 其他跳过选项 */}
                <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label>跳过时执行后置拦截</Label>
                            <p className="text-xs text-muted-foreground">
                                即使动作被跳过，是否仍执行后置阶段拦截器
                            </p>
                        </div>
                        <Switch
                            checked={skipConfig.execute_after_on_skip}
                            onCheckedChange={(checked) =>
                                updateSkipConfig({ execute_after_on_skip: checked })
                            }
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label>记录跳过日志</Label>
                            <p className="text-xs text-muted-foreground">
                                是否在日志中记录被跳过的动作
                            </p>
                        </div>
                        <Switch
                            checked={skipConfig.log_skipped}
                            onCheckedChange={(checked) => updateSkipConfig({ log_skipped: checked })}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
