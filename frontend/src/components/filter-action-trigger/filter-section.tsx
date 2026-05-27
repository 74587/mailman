'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExpressionGroup } from '@/components/expression-builder/expression-group'
import { DescriptionInput, useStickyBreadcrumb, useAncestors, BreadcrumbItem } from '@/components/ui/sticky-breadcrumb'
import { aiDescriptionService } from '@/services/ai-description.service'
import { Filter, Eye, Sparkles, MessageSquare } from 'lucide-react'

interface FilterSectionProps {
    filters: any[]
    onChange: (filters: any[]) => void
    testData: Record<string, any>
    readOnly?: boolean
    hideHeader?: boolean
    onExpressionSelect?: (expression: any) => void
    onEvaluate?: (expressionId: string, expression: any) => Promise<void>
    evaluationResults?: Record<string, {
        expressionId: string
        result: boolean
        details?: any
        error?: string
        timestamp: number
    }>
    isEvaluating?: string | null
    pluginContext?: 'trigger' | 'pickup' | 'interceptor'
    // 描述相关
    description?: string
    onDescriptionChange?: (description: string) => void
}

// 创建默认的根条件组
const createDefaultRootGroup = () => ({
    id: Date.now().toString(),
    type: 'group',
    operator: 'and',
    conditions: [],
    description: '' // 添加描述字段
})

export function FilterSection({
    filters,
    onChange,
    testData,
    readOnly = false,
    hideHeader = false,
    onExpressionSelect,
    onEvaluate,
    evaluationResults,
    isEvaluating,
    pluginContext = 'trigger',
    description,
    onDescriptionChange
}: FilterSectionProps) {
    const [autoDescription, setAutoDescription] = useState<string>('')
    const { selectItem } = useStickyBreadcrumb()
    const { ancestors } = useAncestors()

    // 如果没有过滤器，自动创建一个默认的根条件组
    useEffect(() => {
        if (filters.length === 0 && !readOnly) {
            onChange([createDefaultRootGroup()])
        }
    }, []) // 仅在组件挂载时执行一次

    const handleUpdateFilter = (index: number, updatedExpression: any) => {
        const newFilters = [...filters]
        newFilters[index] = updatedExpression
        onChange(newFilters)
    }

    // 获取根条件组（只有一个）
    const rootGroup = filters[0]

    // 计算条件数量（不包括根组本身）
    const getConditionCount = (group: any): number => {
        if (!group || !group.conditions) return 0
        let count = 0
        for (const item of group.conditions) {
            if (item.type === 'group') {
                count += 1 + getConditionCount(item) // 组本身 + 组内条件
            } else {
                count += 1
            }
        }
        return count
    }

    const conditionCount = rootGroup ? getConditionCount(rootGroup) : 0

    // 自动生成描述
    const generateAutoDescription = useCallback(() => {
        if (rootGroup) {
            const desc = aiDescriptionService.forFilterGroup(rootGroup)
            setAutoDescription(desc)
        }
    }, [rootGroup])

    // 当过滤器变化时，更新自动描述
    useEffect(() => {
        generateAutoDescription()
    }, [filters, generateAutoDescription])

    // 获取显示的描述（优先用户描述，其次自动描述）
    const displayDescription = description || autoDescription

    // 创建当前过滤器区域的面包屑项
    const breadcrumbItem: BreadcrumbItem = {
        id: 'filter-section',
        type: 'condition',
        label: '过滤条件',
        description: displayDescription,
        level: ancestors.length // 基于祖先数量确定层级
    }

    // 点击时选中过滤器区域 - 传递完整的祖先链，阻止事件冒泡
    const handleSectionClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation() // 阻止事件冒泡
        selectItem(breadcrumbItem, ancestors)
    }, [selectItem, breadcrumbItem, ancestors])

    return (
        <div className="space-y-4" onClick={handleSectionClick}>
            {!hideHeader && (
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                        {readOnly ? (
                            <Eye className="h-5 w-5 text-gray-500" />
                        ) : (
                            <Filter className="h-5 w-5 text-blue-500" />
                        )}
                        <h3 className="text-lg font-semibold">
                            {readOnly ? '过滤条件预览' : '过滤条件配置'}
                        </h3>
                        <Badge variant="secondary" className="text-xs">
                            {conditionCount} 个条件
                        </Badge>
                    </div>

                    {/* 描述区域 */}
                    {!readOnly && onDescriptionChange && (
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            <DescriptionInput
                                value={description}
                                onChange={onDescriptionChange}
                                placeholder="添加描述"
                            />
                            {!description && autoDescription && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onDescriptionChange(autoDescription)}
                                    className="h-6 text-xs text-purple-600 hover:text-purple-700"
                                    title="使用 AI 生成的描述"
                                >
                                    <Sparkles className="h-3 w-3 mr-1" />
                                    AI 填充
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* 折叠状态下显示描述 */}
            {hideHeader && displayDescription && (
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                    <MessageSquare className="h-3 w-3" />
                    <span className="truncate max-w-[300px]">{displayDescription}</span>
                </div>
            )}

            {rootGroup && (
                <div onClick={e => e.stopPropagation()}>
                    <ExpressionGroup
                        expression={rootGroup}
                        onChange={(updated) => handleUpdateFilter(0, updated)}
                        onDelete={undefined} // 根条件组不可删除
                        testData={testData}
                        isRoot={true}
                        readOnly={readOnly}
                        onExpressionSelect={onExpressionSelect}
                        onEvaluate={onEvaluate}
                        evaluationResults={evaluationResults}
                        isEvaluating={isEvaluating}
                        pluginContext={pluginContext}
                    />
                </div>
            )}

            {!readOnly && (
                <div className="text-xs text-gray-500 p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
                    <p><strong>提示：</strong></p>
                    <ul className="mt-1 space-y-1">
                        <li>• 在条件组内点击"添加条件"来添加过滤规则</li>
                        <li>• 可以切换条件组类型（并且/或者/非）来构建复杂逻辑</li>
                        <li>• 支持嵌套条件组合和多种条件类型（内置条件、表达式等）</li>
                        <li>• 悬停"添加条件" → "引入模板"可以快速复用已保存的过滤条件</li>
                        <li>• 💡 点击"AI 填充"可自动生成条件描述</li>
                    </ul>
                </div>
            )}
        </div>
    )
}
