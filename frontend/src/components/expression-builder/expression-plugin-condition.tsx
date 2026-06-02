'use client'

import React, { useState, useMemo } from 'react'
import { Trash2, ToggleLeft, Play, CheckCircle2, XCircle, Loader2, Code2, Maximize2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ExpressionEditorModal } from './expression-editor-modal'

interface EvaluationResult {
    expressionId: string
    result: boolean
    details?: any
    error?: string
    timestamp: number
}

// Expression engine types
type ExpressionEngineType = 'expr.javascript' | 'expr.cel' | 'expr.go-template' | 'expr.jsonpath'

interface ExpressionEngine {
    id: ExpressionEngineType
    name: string
    description: string
    placeholder: string
}

// Available expression engines
const EXPRESSION_ENGINES: ExpressionEngine[] = [
    {
        id: 'expr.javascript',
        name: 'JavaScript',
        description: 'JavaScript expression with full ES6+ support',
        placeholder: 'Subject.includes("urgent") && From.some(addr => addr.endsWith("@company.com"))'
    },
    {
        id: 'expr.cel',
        name: 'CEL',
        description: 'Common Expression Language - Safe and fast',
        placeholder: 'Subject.contains("urgent") && From.exists(addr, addr.endsWith("@company.com"))'
    },
    {
        id: 'expr.go-template',
        name: 'Go Template',
        description: 'Go template with rich function library',
        placeholder: '{{ if and (contains .Subject "urgent") (gt (len .Attachments) 0) }}true{{ else }}false{{ end }}'
    },
    {
        id: 'expr.jsonpath',
        name: 'JSONPath',
        description: 'Query JSON data with path expressions',
        placeholder: '$.Subject =~ "urgent"'
    }
]

function normalizeExpressionEngineId(pluginId?: string): ExpressionEngineType {
    if (pluginId === 'expr.go_template') {
        return 'expr.go-template'
    }
    return (pluginId || 'expr.javascript') as ExpressionEngineType
}

interface ExpressionPluginConditionProps {
    condition: any
    onChange: (condition: any) => void
    onDelete: () => void
    testData?: Record<string, any>
    onSelect?: () => void
    onEvaluate?: (expressionId: string, expression: any) => Promise<void>
    evaluationResult?: EvaluationResult
    isEvaluating?: boolean
    emailId?: number
}

export function ExpressionPluginCondition({
    condition,
    onChange,
    onDelete,
    testData = {},
    onSelect,
    onEvaluate,
    evaluationResult,
    isEvaluating = false,
    emailId
}: ExpressionPluginConditionProps) {
    const [isExpanded, setIsExpanded] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)

    // Get current engine or default to JavaScript
    const engineId = normalizeExpressionEngineId(condition.pluginId)
    const currentEngine = useMemo(() =>
        EXPRESSION_ENGINES.find(e => e.id === engineId) || EXPRESSION_ENGINES[0],
        [engineId]
    )

    // Get expression from condition
    const expression = condition.fields?.expression || ''

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        onSelect?.()
    }

    const handleEngineChange = (newEngineId: string) => {
        onChange({
            ...condition,
            pluginId: newEngineId,
            fields: {
                ...condition.fields,
                expression: '' // Clear expression when changing engine
            }
        })
    }

    const handleExpressionChange = (newExpression: string) => {
        onChange({
            ...condition,
            pluginId: engineId,
            fields: {
                ...condition.fields,
                expression: newExpression
            }
        })
    }

    const handleEngineTypeChange = (newEngineId: ExpressionEngineType) => {
        onChange({
            ...condition,
            pluginId: newEngineId,
            fields: {
                ...condition.fields,
                expression: condition.fields?.expression || ''
            }
        })
    }

    const toggleNot = () => {
        onChange({
            ...condition,
            not: !condition.not
        })
    }

    const openModal = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsModalOpen(true)
    }

    return (
        <>
            <div
                className={`rounded-lg border transition-all cursor-pointer hover:shadow-sm ${
                    condition.not
                        ? 'border-red-300 bg-red-50/50'
                        : 'border-purple-200 bg-purple-50/30'
                }`}
                onClick={handleClick}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-purple-100">
                    <div className="flex items-center gap-2">
                        <Code2 className="h-4 w-4 text-purple-500" />

                        {/* Engine selector */}
                        <Select value={engineId} onValueChange={handleEngineChange}>
                            <SelectTrigger
                                className="h-7 w-auto min-w-[120px] text-sm border-0 bg-purple-100 hover:bg-purple-200"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {EXPRESSION_ENGINES.map(engine => (
                                    <SelectItem key={engine.id} value={engine.id}>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{engine.name}</span>
                                            <span className="text-xs text-gray-500">{engine.description}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* NOT badge */}
                        {condition.not && (
                            <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-1.5 py-0">
                                NOT
                            </Badge>
                        )}

                        {/* Evaluation result */}
                        {evaluationResult && (
                            <Badge
                                variant="outline"
                                className={`text-xs px-2 py-0.5 flex items-center gap-1 ${
                                    evaluationResult.result
                                        ? 'bg-green-50 text-green-700 border-green-200'
                                        : 'bg-red-50 text-red-700 border-red-200'
                                }`}
                            >
                                {evaluationResult.result ? (
                                    <CheckCircle2 className="h-3 w-3" />
                                ) : (
                                    <XCircle className="h-3 w-3" />
                                )}
                            </Badge>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        {/* Open editor modal button */}
                        <Button
                            onClick={openModal}
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-purple-500 hover:text-purple-700 hover:bg-purple-100"
                            title="打开表达式编辑器"
                        >
                            <Maximize2 className="h-3.5 w-3.5" />
                        </Button>

                        {/* Evaluate button */}
                        {onEvaluate && (
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onEvaluate(condition.id, condition)
                                }}
                                variant="ghost"
                                size="sm"
                                disabled={isEvaluating || !expression.trim()}
                                className="h-7 w-7 p-0 hover:bg-green-50 hover:text-green-600"
                                title="运行评估"
                            >
                                {isEvaluating ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Play className="h-3.5 w-3.5" />
                                )}
                            </Button>
                        )}

                        {/* NOT toggle */}
                        <Button
                            onClick={(e) => {
                                e.stopPropagation()
                                toggleNot()
                            }}
                            variant="ghost"
                            size="sm"
                            className={`h-7 w-7 p-0 ${
                                condition.not
                                    ? 'text-red-600 hover:text-red-700 hover:bg-red-100'
                                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                            }`}
                            title={condition.not ? '取消否定' : '添加否定'}
                        >
                            <ToggleLeft className="h-3.5 w-3.5" />
                        </Button>

                        {/* Expand/Collapse */}
                        <Button
                            onClick={(e) => {
                                e.stopPropagation()
                                setIsExpanded(!isExpanded)
                            }}
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600"
                        >
                            {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                            )}
                        </Button>

                        {/* Delete button */}
                        <Button
                            onClick={(e) => {
                                e.stopPropagation()
                                onDelete()
                            }}
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>

                {/* Content */}
                {isExpanded && (
                    <div className="p-3" onClick={(e) => {
                        e.stopPropagation()
                        onSelect?.()
                    }}>
                        {/* Simple textarea for quick editing */}
                        <div className="relative">
                            <Textarea
                                value={expression}
                                onChange={(e) => handleExpressionChange(e.target.value)}
                                placeholder={currentEngine.placeholder}
                                className="min-h-[60px] font-mono text-sm bg-white resize-none pr-10"
                                rows={2}
                            />
                            {/* Expand button inside textarea */}
                            <Button
                                onClick={openModal}
                                variant="ghost"
                                size="sm"
                                className="absolute top-2 right-2 h-6 w-6 p-0 text-gray-400 hover:text-purple-600 hover:bg-purple-50"
                                title="在编辑器中打开"
                            >
                                <Maximize2 className="h-3 w-3" />
                            </Button>
                        </div>

                        {/* Hint text */}
                        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                            <span>使用 {currentEngine.name} 语法</span>
                            <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs text-purple-600 hover:text-purple-700"
                                onClick={openModal}
                            >
                                打开完整编辑器 →
                            </Button>
                        </div>

                        {/* Evaluation result details */}
                        {evaluationResult?.error && (
                            <div className="mt-2 p-2 text-xs text-red-700 bg-red-50 rounded border border-red-200">
                                错误: {evaluationResult.error}
                            </div>
                        )}
                    </div>
                )}

                {/* Collapsed preview */}
                {!isExpanded && expression && (
                    <div className="px-3 py-2 text-xs font-mono text-gray-500 truncate border-t border-purple-100">
                        {expression.substring(0, 100)}{expression.length > 100 ? '...' : ''}
                    </div>
                )}
            </div>

            {/* Expression Editor Modal */}
            <ExpressionEditorModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                engineType={engineId}
                expression={expression}
                onExpressionChange={handleExpressionChange}
                onEngineTypeChange={handleEngineTypeChange}
                testData={testData}
                emailId={emailId}
            />
        </>
    )
}

export default ExpressionPluginCondition
