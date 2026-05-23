'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    CheckCircle,
    XCircle,
    Clock,
    Filter,
    Zap,
    ChevronDown,
    ChevronUp,
    Code
} from 'lucide-react'
import { ExecutionTrace, ExecutionStep } from '@/types'

interface ExecutionTimelineProps {
    traceData?: string // Base64 encoded JSON
    className?: string
}

// Decode base64 execution trace data (with proper UTF-8 support)
function decodeExecutionTrace(traceData: string): ExecutionTrace | null {
    try {
        // atob() returns a binary string, we need to convert it to UTF-8
        const binaryString = atob(traceData)
        // Convert binary string to Uint8Array
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }
        // Use TextDecoder to convert bytes to UTF-8 string
        const jsonStr = new TextDecoder('utf-8').decode(bytes)
        return JSON.parse(jsonStr) as ExecutionTrace
    } catch (error) {
        console.error('Failed to decode execution trace:', error)
        return null
    }
}

// Format duration for display
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`
    }
    return `${(ms / 1000).toFixed(2)}s`
}

// Format time for display
function formatTime(timeStr: string): string {
    try {
        const date = new Date(timeStr)
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        })
    } catch {
        return timeStr
    }
}

export function ExecutionTimeline({ traceData, className = '' }: ExecutionTimelineProps) {
    const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({})

    const trace = useMemo(() => {
        if (!traceData) return null
        return decodeExecutionTrace(traceData)
    }, [traceData])

    if (!trace || !trace.steps || trace.steps.length === 0) {
        return (
            <Card className={className}>
                <CardContent className="p-6 text-center text-gray-500">
                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>暂无执行追踪数据</p>
                </CardContent>
            </Card>
        )
    }

    const toggleStep = (stepId: string) => {
        setExpandedSteps(prev => ({
            ...prev,
            [stepId]: !prev[stepId]
        }))
    }

    const getStepIcon = (step: ExecutionStep) => {
        if (step.type === 'filter') {
            return <Filter className="h-4 w-4" />
        }
        return <Zap className="h-4 w-4" />
    }

    const getStepColor = (step: ExecutionStep) => {
        if (step.type === 'filter') {
            return step.success
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-red-500 bg-red-50 dark:bg-red-900/20'
        }
        return step.success
            ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
            : 'border-red-500 bg-red-50 dark:bg-red-900/20'
    }

    const getTypeLabel = (type: 'filter' | 'action') => {
        return type === 'filter' ? '过滤器' : '动作'
    }

    const getTypeBadgeColor = (type: 'filter' | 'action') => {
        return type === 'filter'
            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400'
            : 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400'
    }

    // Calculate duration bar width (relative to total time)
    const calcDurationWidth = (stepDuration: number) => {
        const maxDuration = Math.max(...trace.steps.map(s => s.duration), 1)
        return Math.max((stepDuration / maxDuration) * 100, 5) // Min 5%
    }

    return (
        <Card className={className}>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-lg">
                    <div className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        执行追踪时间轴
                    </div>
                    <Badge variant="secondary">
                        {trace.totalSteps} 步骤 · 总耗时 {formatDuration(trace.totalMs)}
                    </Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
                {/* Timeline */}
                <div className="relative">
                    {/* Vertical line */}
                    <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-200 dark:bg-gray-700" />

                    {/* Steps */}
                    <div className="space-y-4">
                        {trace.steps.map((step, index) => (
                            <div key={step.id || index} className="relative pl-10">
                                {/* Timeline dot */}
                                <div className={`absolute left-2 top-3 w-4 h-4 rounded-full border-2 flex items-center justify-center ${step.success
                                    ? 'border-green-500 bg-green-100 dark:bg-green-900/50'
                                    : 'border-red-500 bg-red-100 dark:bg-red-900/50'
                                    }`}>
                                    {step.success
                                        ? <CheckCircle className="h-3 w-3 text-green-600" />
                                        : <XCircle className="h-3 w-3 text-red-600" />
                                    }
                                </div>

                                {/* Step card */}
                                <div className={`border rounded-lg p-3 ${getStepColor(step)}`}>
                                    {/* Header */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className={`p-1 rounded ${step.type === 'filter' ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-purple-100 dark:bg-purple-900/40'}`}>
                                                {getStepIcon(step)}
                                            </span>
                                            <span className="font-medium">{step.name || step.pluginId}</span>
                                            <Badge className={getTypeBadgeColor(step.type)} variant="secondary">
                                                {getTypeLabel(step.type)}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-gray-600 dark:text-gray-400">
                                                {formatDuration(step.duration)}
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0"
                                                onClick={() => toggleStep(step.id)}
                                            >
                                                {expandedSteps[step.id]
                                                    ? <ChevronUp className="h-4 w-4" />
                                                    : <ChevronDown className="h-4 w-4" />
                                                }
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Duration bar */}
                                    <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all ${step.success ? 'bg-green-500' : 'bg-red-500'
                                                }`}
                                            style={{ width: `${calcDurationWidth(step.duration)}%` }}
                                        />
                                    </div>

                                    {/* Error message */}
                                    {step.error && (
                                        <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/30 rounded text-sm text-red-800 dark:text-red-200">
                                            <strong>错误:</strong> {step.error}
                                        </div>
                                    )}

                                    {/* Expanded details */}
                                    {expandedSteps[step.id] && (
                                        <div className="mt-3 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                                            {/* Time info */}
                                            <div className="grid grid-cols-3 gap-2 text-sm">
                                                <div>
                                                    <span className="text-gray-500">开始时间:</span>
                                                    <span className="ml-1 font-mono">{formatTime(step.startTime)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">结束时间:</span>
                                                    <span className="ml-1 font-mono">{formatTime(step.endTime)}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-500">Plugin ID:</span>
                                                    <span className="ml-1 font-mono text-xs">{step.pluginId}</span>
                                                </div>
                                            </div>

                                            {/* Input */}
                                            {step.input && Object.keys(step.input).length > 0 && (
                                                <div>
                                                    <div className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                        <Code className="h-3.5 w-3.5" />
                                                        输入参数
                                                    </div>
                                                    <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                                                        {JSON.stringify(step.input, null, 2)}
                                                    </pre>
                                                </div>
                                            )}

                                            {/* Output */}
                                            {step.output && Object.keys(step.output).length > 0 && (
                                                <div>
                                                    <div className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                        <Code className="h-3.5 w-3.5" />
                                                        输出结果
                                                    </div>
                                                    <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
                                                        {JSON.stringify(step.output, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Summary */}
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                        <span>
                            总开始时间: {formatTime(trace.startTime)}
                        </span>
                        <span>
                            总结束时间: {formatTime(trace.endTime)}
                        </span>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
