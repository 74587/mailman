import React, { useState, useMemo } from 'react'
import { Trash2, ToggleLeft, Play, CheckCircle2, XCircle, Loader2, List, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FolderTree } from 'lucide-react'
import { JsonTreeSelector } from '@/components/triggers/create/json-tree-selector'
import { FieldSelectorWithPreview } from './field-selector-with-preview'

interface EvaluationResult {
    expressionId: string
    result: boolean
    details?: any
    error?: string
    timestamp: number
}

interface ExpressionConditionProps {
    condition: any
    onChange: (condition: any) => void
    onDelete: () => void
    testData?: Record<string, any>
    onSelect?: () => void
    onEvaluate?: (expressionId: string, expression: any) => Promise<void>
    evaluationResult?: EvaluationResult
    isEvaluating?: boolean
}

// 判断字段是否为数组类型
function isArrayField(testData: Record<string, any>, fieldPath: string): boolean {
    if (!fieldPath || !testData) return false
    const value = fieldPath.split('.').reduce((acc: any, key: string) => acc?.[key], testData)
    return Array.isArray(value)
}

// 获取字段值
function getFieldValue(testData: Record<string, any>, fieldPath: string): any {
    if (!fieldPath || !testData) return undefined
    return fieldPath.split('.').reduce((acc: any, key: string) => acc?.[key], testData)
}

export function ExpressionCondition({
    condition,
    onChange,
    onDelete,
    testData = {},
    onSelect,
    onEvaluate,
    evaluationResult,
    isEvaluating = false
}: ExpressionConditionProps) {
    const [isPickerOpen, setIsPickerOpen] = useState(false)
    const [isListInputOpen, setIsListInputOpen] = useState(false)

    // 处理点击选中
    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (onSelect) {
            onSelect()
        }
    }

    const handlePickPath = (path: string, value: any) => {
        onChange({
            ...condition,
            field: path,
        })
        setIsPickerOpen(false)
    }

    // 递归提取testData中的所有字段路径
    const extractFieldPaths = (obj: any, prefix: string = ''): string[] => {
        const paths: string[] = []

        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            for (const [key, value] of Object.entries(obj)) {
                const currentPath = prefix ? `${prefix}.${key}` : key
                paths.push(currentPath)

                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    paths.push(...extractFieldPaths(value, currentPath))
                }
            }
        }

        return paths
    }

    // 获取所有可用的字段路径
    const availableFields = useMemo(() => {
        return extractFieldPaths(testData).sort()
    }, [testData])

    // 检查当前字段是否为数组
    const currentFieldIsArray = useMemo(() => {
        return isArrayField(testData, condition.field)
    }, [testData, condition.field])

    // 获取当前字段值
    const currentFieldValue = useMemo(() => {
        return getFieldValue(testData, condition.field)
    }, [testData, condition.field])

    // 过滤字段建议
    const fieldSuggestions = useMemo(() => {
        if (!condition.field) return availableFields

        const query = condition.field.toLowerCase()
        return availableFields.filter(field =>
            field.toLowerCase().includes(query)
        )
    }, [availableFields, condition.field])

    const handleFieldChange = (field: string) => {
        onChange({
            ...condition,
            field
        })
    }

    const handleOperatorChange = (operator: string) => {
        // 如果切换到列表操作符，确保 value 是数组格式
        let newValue = condition.value
        if (operator === 'in' || operator === 'not_in') {
            // 如果当前值是字符串，转换为数组
            if (typeof condition.value === 'string' && condition.value) {
                newValue = condition.value.split(',').map((v: string) => v.trim()).filter(Boolean)
            } else if (!Array.isArray(condition.value)) {
                newValue = []
            }
        } else {
            // 如果从列表操作符切换到其他操作符，转换回字符串
            if (Array.isArray(condition.value)) {
                newValue = condition.value.join(', ')
            }
        }

        onChange({
            ...condition,
            operator,
            value: newValue
        })
    }

    const handleValueChange = (value: string) => {
        onChange({
            ...condition,
            value
        })
    }

    // 处理列表值输入（多行文本）
    const handleListValueChange = (text: string) => {
        // 将多行或逗号分隔的文本转换为数组
        const values = text
            .split(/[\n,]/)
            .map(v => v.trim())
            .filter(Boolean)
        onChange({
            ...condition,
            value: values
        })
    }

    // 获取列表值的显示文本
    const getListValueDisplayText = () => {
        if (Array.isArray(condition.value)) {
            if (condition.value.length === 0) return '点击添加值...'
            return condition.value.join(', ')
        }
        return condition.value || '点击添加值...'
    }

    // 获取列表值用于编辑
    const getListValueForEdit = () => {
        if (Array.isArray(condition.value)) {
            return condition.value.join('\n')
        }
        return condition.value || ''
    }

    const toggleNot = () => {
        onChange({
            ...condition,
            not: !condition.not
        })
    }

    // 判断当前是否为列表操作符
    const isListOperator = condition.operator === 'in' || condition.operator === 'not_in'

    // 标准操作符（用于普通字段和字符串）
    const standardOperators = [
        { value: 'equals', label: '等于' },
        { value: 'not_equals', label: '不等于' },
        { value: 'contains', label: '包含' },
        { value: 'not_contains', label: '不包含' },
        { value: 'starts_with', label: '开头是' },
        { value: 'ends_with', label: '结尾是' },
        { value: 'greater_than', label: '大于' },
        { value: 'less_than', label: '小于' },
        { value: 'in', label: '在列表中' },
        { value: 'not_in', label: '不在列表中' }
    ]

    // 数组专用操作符
    const arrayOperators = [
        { value: 'array_contains', label: '数组包含', description: '数组中存在某个值' },
        { value: 'array_not_contains', label: '数组不包含', description: '数组中不存在某个值' },
        { value: 'any_equals', label: '任意元素等于', description: '数组中任意元素等于指定值' },
        { value: 'any_contains', label: '任意元素包含', description: '数组中任意元素包含指定文本' },
        { value: 'any_starts_with', label: '任意元素开头是', description: '数组中任意元素以指定文本开头' },
        { value: 'any_ends_with', label: '任意元素结尾是', description: '数组中任意元素以指定文本结尾' },
        { value: 'all_equals', label: '所有元素等于', description: '数组中所有元素都等于指定值' },
        { value: 'all_contains', label: '所有元素包含', description: '数组中所有元素都包含指定文本' },
        { value: 'array_length_equals', label: '数组长度等于', description: '数组元素个数等于' },
        { value: 'array_length_greater', label: '数组长度大于', description: '数组元素个数大于' },
        { value: 'array_length_less', label: '数组长度小于', description: '数组元素个数小于' },
        { value: 'array_is_empty', label: '数组为空', description: '数组没有任何元素' },
        { value: 'array_is_not_empty', label: '数组不为空', description: '数组至少有一个元素' }
    ]

    // 根据字段类型决定显示哪些操作符
    const operators = currentFieldIsArray
        ? [...arrayOperators, { value: 'divider', label: '── 标准操作符 ──', disabled: true }, ...standardOperators]
        : standardOperators

    // 判断是否需要隐藏值输入（对于某些数组操作符如 array_is_empty）
    const hideValueInput = condition.operator === 'array_is_empty' || condition.operator === 'array_is_not_empty'

    return (
        <div
            className={`flex items-center gap-2 p-2 rounded-md bg-white border transition-all cursor-pointer hover:shadow-sm ${condition.not ? 'border-red-300 bg-red-50' : 'border-gray-200'
                }`}
            onClick={handleClick}
        >
            {/* NOT 标记 */}
            {condition.not && (
                <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-1.5 py-0">
                    NOT
                </Badge>
            )}

            {/* 字段选择 */}
            <div className="flex-1 min-w-0">
                <div className="flex gap-1">
                    <div className="flex-1" onClick={(e) => e.stopPropagation()}>
                        <FieldSelectorWithPreview
                            value={condition.field || ''}
                            onChange={handleFieldChange}
                            placeholder="选择字段 (开始输入以查看建议)"
                            testData={testData}
                        />
                    </div>

                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-50 flex-none"
                        title="从数据中选择"
                        onClick={(e) => {
                            e.stopPropagation()
                            setIsPickerOpen(true)
                        }}
                    >
                        <FolderTree className="h-4 w-4" />
                    </Button>

                    <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                            <DialogHeader>
                                <DialogTitle>从测试数据中选择字段</DialogTitle>
                            </DialogHeader>
                            <div className="flex-1 overflow-hidden min-h-[400px] mt-2 border rounded-md">
                                <JsonTreeSelector
                                    data={testData}
                                    onSelect={handlePickPath}
                                    isSelecting={true}
                                    highlightPath={condition.field}
                                    allowArraySelection={true}
                                />
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>

                {/* 字段值预览 */}
                {currentFieldValue !== undefined && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate flex items-center gap-1">
                        <span>当前值:</span>
                        {currentFieldIsArray ? (
                            <Badge variant="outline" className="text-xs px-1 py-0 font-normal">
                                <List className="h-3 w-3 mr-1" />
                                数组[{currentFieldValue.length}]
                            </Badge>
                        ) : (
                            <span className="truncate">{JSON.stringify(currentFieldValue)}</span>
                        )}
                    </div>
                )}
            </div>

            {/* 操作符选择 */}
            <Select value={condition.operator || 'equals'} onValueChange={handleOperatorChange}>
                <SelectTrigger className={`w-36 h-8 text-sm ${currentFieldIsArray ? 'border-amber-300 bg-amber-50' : ''}`}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                    {operators.map(op => (
                        op.value === 'divider' ? (
                            <div key="divider" className="px-2 py-1 text-xs text-gray-400 cursor-default">
                                {op.label}
                            </div>
                        ) : (
                            <SelectItem key={op.value} value={op.value}>
                                <span className="flex items-center gap-1">
                                    {op.value.startsWith('array_') || op.value.startsWith('any_') || op.value.startsWith('all_') ? (
                                        <List className="h-3 w-3 text-amber-500" />
                                    ) : null}
                                    {op.label}
                                </span>
                            </SelectItem>
                        )
                    ))}
                </SelectContent>
            </Select>

            {/* 值输入 - 根据操作符类型显示不同的输入方式 */}
            {!hideValueInput && (
                isListOperator ? (
                    // 列表操作符：使用可展开的多值输入
                    <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className="w-full h-8 px-3 text-sm text-left bg-white border rounded-md hover:bg-gray-50 flex items-center justify-between"
                            onClick={() => setIsListInputOpen(true)}
                        >
                            <span className="truncate text-gray-700">
                                {getListValueDisplayText()}
                            </span>
                            <ChevronDown className="h-3 w-3 text-gray-400 flex-shrink-0 ml-1" />
                        </button>

                        {/* 列表值输入弹窗 */}
                        <Dialog open={isListInputOpen} onOpenChange={setIsListInputOpen}>
                            <DialogContent className="max-w-md">
                                <DialogHeader>
                                    <DialogTitle>输入多个值</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-3">
                                    <p className="text-sm text-gray-500">
                                        每行输入一个值，或使用逗号分隔。字段值匹配其中任意一个即满足条件。
                                    </p>
                                    <textarea
                                        className="w-full h-40 p-3 text-sm font-mono border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        placeholder="值1&#10;值2&#10;值3"
                                        defaultValue={getListValueForEdit()}
                                        onChange={(e) => handleListValueChange(e.target.value)}
                                    />
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-gray-400">
                                            当前 {Array.isArray(condition.value) ? condition.value.length : 0} 个值
                                        </span>
                                        <Button size="sm" onClick={() => setIsListInputOpen(false)}>
                                            完成
                                        </Button>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                ) : (
                    // 普通操作符：使用单值输入
                    <Input
                        value={condition.value || ''}
                        onChange={(e) => handleValueChange(e.target.value)}
                        placeholder="输入值"
                        className="flex-1 min-w-0 h-8 text-sm"
                        onClick={(e) => e.stopPropagation()}
                    />
                )
            )}

            {/* 评估结果指示器 */}
            {evaluationResult && (
                <Badge
                    variant="outline"
                    className={`text-xs px-2 py-0.5 flex items-center gap-1 ${evaluationResult.result
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                        }`}
                >
                    {evaluationResult.result ? (
                        <><CheckCircle2 className="h-3 w-3" /></>
                    ) : (
                        <><XCircle className="h-3 w-3" /></>
                    )}
                </Badge>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center gap-1">
                {/* 运行评估按钮 */}
                {onEvaluate && (
                    <Button
                        onClick={(e) => {
                            e.stopPropagation()
                            onEvaluate(condition.id, condition)
                        }}
                        variant="ghost"
                        size="sm"
                        disabled={isEvaluating}
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

                {/* NOT 切换按钮 */}
                <Button
                    onClick={toggleNot}
                    variant="ghost"
                    size="sm"
                    className={`h-7 w-7 p-0 ${condition.not
                        ? 'text-red-600 hover:text-red-700 hover:bg-red-100'
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                        }`}
                    title={condition.not ? "取消否定" : "添加否定"}
                >
                    <ToggleLeft className="h-3.5 w-3.5" />
                </Button>

                {/* 删除按钮 */}
                <Button
                    onClick={onDelete}
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
    )
}