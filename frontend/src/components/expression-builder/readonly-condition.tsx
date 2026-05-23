'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Code2, Puzzle, List } from 'lucide-react'

// 操作符标签映射
const operatorLabels: Record<string, string> = {
    equals: '等于',
    not_equals: '不等于',
    contains: '包含',
    not_contains: '不包含',
    starts_with: '开头是',
    ends_with: '结尾是',
    greater_than: '大于',
    less_than: '小于',
    in: '在列表中',
    not_in: '不在列表中',
    array_contains: '数组包含',
    array_not_contains: '数组不包含',
    any_equals: '任意元素等于',
    any_contains: '任意元素包含',
    any_starts_with: '任意元素开头是',
    any_ends_with: '任意元素结尾是',
    all_equals: '所有元素等于',
    all_contains: '所有元素包含',
    array_length_equals: '数组长度等于',
    array_length_greater: '数组长度大于',
    array_length_less: '数组长度小于',
    array_is_empty: '数组为空',
    array_is_not_empty: '数组不为空',
    exists: '存在',
    not_exists: '不存在',
    matches: '匹配正则',
    not_matches: '不匹配正则',
}

// 表达式引擎名称映射
const engineNames: Record<string, string> = {
    'expr.javascript': 'JavaScript',
    'expr.cel': 'CEL',
    'expr.go_template': 'Go Template',
    'expr.jsonpath': 'JSONPath',
}

interface ReadOnlyConditionProps {
    condition: any
}

export function ReadOnlyCondition({ condition }: ReadOnlyConditionProps) {
    // 表达式类型（expr.javascript 等）
    if (condition.type === 'expression') {
        const engineName = engineNames[condition.pluginId] || condition.pluginId
        const expression = condition.fields?.expression || ''

        return (
            <div className={`flex items-center gap-2 p-2 rounded-md bg-white border ${condition.not ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                {condition.not && (
                    <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-1.5 py-0">
                        NOT
                    </Badge>
                )}
                <Badge variant="outline" className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 border-purple-200">
                    <Code2 className="h-3 w-3 mr-1" />
                    {engineName}
                </Badge>
                <code className="flex-1 text-xs font-mono bg-gray-100 px-2 py-1 rounded truncate">
                    {expression || '(空表达式)'}
                </code>
            </div>
        )
    }

    // 插件条件
    if (condition.type === 'plugin') {
        const pluginId = condition.pluginId || 'unknown'
        const fields = condition.fields || {}

        // 插件名称映射
        const pluginNames: Record<string, string> = {
            'always_pass': '始终通过',
            'builtin': '内置条件',
        }

        const displayName = pluginNames[pluginId] || pluginId

        // 特殊样式：always_pass 使用绿色
        const isAlwaysPass = pluginId === 'always_pass'
        const badgeClass = isAlwaysPass
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-blue-50 text-blue-700 border-blue-200'

        return (
            <div className={`flex items-center gap-2 p-2 rounded-md bg-white border ${condition.not ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                {condition.not && (
                    <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-1.5 py-0">
                        NOT
                    </Badge>
                )}
                <Badge variant="outline" className={`text-xs px-2 py-0.5 ${badgeClass}`}>
                    <Puzzle className="h-3 w-3 mr-1" />
                    {displayName}
                </Badge>
                {!isAlwaysPass && Object.keys(fields).length > 0 && (
                    <span className="flex-1 text-sm text-gray-600 truncate">
                        {Object.entries(fields).map(([key, value]) => (
                            <span key={key} className="mr-2">
                                <span className="text-gray-400">{key}:</span> {String(value)}
                            </span>
                        ))}
                    </span>
                )}
                {isAlwaysPass && (
                    <span className="text-sm text-green-600">✓ 所有邮件都会匹配</span>
                )}
            </div>
        )
    }

    // 字段匹配条件（默认）
    const field = condition.field || ''
    const operator = condition.operator || 'equals'
    const value = condition.value
    const operatorLabel = operatorLabels[operator] || operator

    // 格式化值显示
    const formatValue = (val: any) => {
        if (val === undefined || val === null || val === '') return '(空)'
        if (Array.isArray(val)) {
            if (val.length === 0) return '(空列表)'
            return val.join(', ')
        }
        return String(val)
    }

    // 判断是否需要隐藏值
    const hideValue = operator === 'array_is_empty' || operator === 'array_is_not_empty' ||
        operator === 'exists' || operator === 'not_exists'

    return (
        <div className={`flex items-center gap-2 p-2 rounded-md bg-white border ${condition.not ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
            {condition.not && (
                <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-1.5 py-0">
                    NOT
                </Badge>
            )}

            {/* 字段 */}
            <code className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                {field || '(未选择字段)'}
            </code>

            {/* 操作符 */}
            <Badge variant="secondary" className="text-xs px-2 py-0.5">
                {operator.startsWith('array_') || operator.startsWith('any_') || operator.startsWith('all_') ? (
                    <List className="h-3 w-3 mr-1 text-amber-500" />
                ) : null}
                {operatorLabel}
            </Badge>

            {/* 值 */}
            {!hideValue && (
                <span className="flex-1 text-sm text-gray-700 truncate">
                    {formatValue(value)}
                </span>
            )}
        </div>
    )
}
