import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Trash2, ToggleLeft, Play, CheckCircle2, XCircle, Loader2, List, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiClient } from '@/lib/api-client'
import { FieldSelectorWithPreview } from './field-selector-with-preview'

// 递归提取JSON对象中的所有字段路径
function extractFieldPaths(obj: any, prefix: string = '', paths: Set<string> = new Set()): string[] {
    if (obj === null || obj === undefined) return Array.from(paths)

    if (typeof obj === 'object' && !Array.isArray(obj)) {
        Object.keys(obj).forEach(key => {
            const currentPath = prefix ? `${prefix}.${key}` : key
            paths.add(currentPath)
            extractFieldPaths(obj[key], currentPath, paths)
        })
    } else if (Array.isArray(obj) && obj.length > 0) {
        // 对于数组，分析第一个元素的结构
        const firstElement = obj[0]
        if (typeof firstElement === 'object' && firstElement !== null) {
            Object.keys(firstElement).forEach(key => {
                const currentPath = prefix ? `${prefix}.${key}` : key
                paths.add(currentPath)
                extractFieldPaths(firstElement[key], currentPath, paths)
            })
        }
    }

    return Array.from(paths)
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
    { value: 'any_matches', label: '任意元素匹配正则', description: '数组中任意元素匹配正则表达式' },
    { value: 'any_not_matches', label: '任意元素不匹配正则', description: '数组中任意元素不匹配正则表达式' },
    { value: 'all_equals', label: '所有元素等于', description: '数组中所有元素都等于指定值' },
    { value: 'all_contains', label: '所有元素包含', description: '数组中所有元素都包含指定文本' },
    { value: 'all_matches', label: '所有元素匹配正则', description: '数组中所有元素都匹配正则表达式' },
    { value: 'all_not_matches', label: '所有元素不匹配正则', description: '数组中所有元素都不匹配正则表达式' },
    { value: 'array_length_equals', label: '数组长度等于', description: '数组元素个数等于' },
    { value: 'array_length_greater', label: '数组长度大于', description: '数组元素个数大于' },
    { value: 'array_length_less', label: '数组长度小于', description: '数组元素个数小于' },
    { value: 'array_is_empty', label: '数组为空', description: '数组没有任何元素' },
    { value: 'array_is_not_empty', label: '数组不为空', description: '数组至少有一个元素' }
]

// 不需要值输入的操作符
const noValueOperators = ['array_is_empty', 'array_is_not_empty', 'exists', 'not_exists']

// 列表操作符（需要多值输入）
const listOperators = ['in', 'not_in']

interface EvaluationResult {
    expressionId: string
    result: boolean
    details?: any
    error?: string
    timestamp: number
}

interface PluginConditionProps {
    condition: any
    pluginId: string
    onChange: (condition: any) => void
    onDelete: () => void
    testData?: Record<string, any>
    onSelect?: () => void
    onEvaluate?: (expressionId: string, expression: any) => Promise<void>
    evaluationResult?: EvaluationResult
    isEvaluating?: boolean
    pluginContext?: 'trigger' | 'pickup' | 'interceptor'
}

interface UIField {
    name: string
    label: string
    type: 'text' | 'number' | 'select' | 'textarea' | 'dynamic' | 'boolean' | 'multi_select'
    description?: string
    placeholder?: string
    required?: boolean
    pattern?: string
    min?: number | null
    max?: number | null
    default?: any
    width?: string
    hidden?: boolean
    disabled?: boolean
    options?: Array<{
        value: string
        label: string
        description?: string
        icon?: string
        color?: string
    }>
    options_api?: string
    show_if?: Record<string, any>
    depends_on?: string | null
}

interface UISchema {
    fields: UIField[]
    operators?: Array<{
        value: string
        label: string
        description?: string
        applicable_to?: string[]
    }>
    layout?: string
    allow_custom_fields?: boolean
    allow_nesting?: boolean
    max_nesting_level?: number
    help_text?: string
    examples?: Array<{
        title: string
        description: string
        expression: any
    }>
}

interface PluginData {
    info: {
        id: string
        name: string
        description: string
    }
    schema: UISchema
}

export function PluginCondition({
    condition,
    pluginId,
    onChange,
    onDelete,
    testData = {},
    onSelect,
    onEvaluate,
    evaluationResult,
    isEvaluating = false,
    pluginContext = 'trigger'
}: PluginConditionProps) {
    const [pluginData, setPluginData] = useState<PluginData | null>(null)
    const [loading, setLoading] = useState(true)
    const [dynamicOptions, setDynamicOptions] = useState<Record<string, any[]>>({})
    const [isListInputOpen, setIsListInputOpen] = useState(false)
    const [dynamicSearchQuery, setDynamicSearchQuery] = useState<Record<string, string>>({})
    const [isLoadingOptions, setIsLoadingOptions] = useState<Record<string, boolean>>({})
    const [activeOptionIndex, setActiveOptionIndex] = useState<Record<string, number>>({})
    const [isDropdownOpen, setIsDropdownOpen] = useState<Record<string, boolean>>({})
    const debounceTimerRef = useRef<Record<string, NodeJS.Timeout>>({})


    // 获取当前选择的字段路径
    const currentFieldPath = condition.fields?.field || ''

    // 检测当前字段是否为数组类型
    const currentFieldIsArray = useMemo(() => {
        return isArrayField(testData, currentFieldPath)
    }, [testData, currentFieldPath])

    // 获取当前字段的值
    const currentFieldValue = useMemo(() => {
        return getFieldValue(testData, currentFieldPath)
    }, [testData, currentFieldPath])

    // 获取当前操作符
    const currentOperator = condition.fields?.operator || 'equals'

    // 判断是否为列表操作符
    const isListOperator = listOperators.includes(currentOperator)

    // 判断是否需要隐藏值输入
    const hideValueInput = noValueOperators.includes(currentOperator)

    // 处理点击选中
    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (onSelect) {
            onSelect()
        }
    }

    // 获取插件UI架构
    useEffect(() => {
        fetchPluginSchemas()
    }, [pluginId, pluginContext])

    const fetchPluginSchemas = async () => {
        try {
            setLoading(true)
            const data = await apiClient.get('/plugins/ui/schemas', {
                params: { type: 'condition', context: pluginContext }
            })

            // 查找对应的插件数据
            const plugin = data[pluginId]
            if (plugin) {
                setPluginData(plugin)
            }
        } catch (error) {
            console.error('Error fetching plugin schemas:', error)
        } finally {
            setLoading(false)
        }
    }

    // 获取动态选项（带防抖）
    const fetchDynamicOptions = useCallback(async (field: UIField, query: string = '') => {
        if (field.type !== 'dynamic' || !field.options_api) return

        // 设置加载状态
        setIsLoadingOptions(prev => ({
            ...prev,
            [field.name]: true
        }))

        try {
            const data = await apiClient.get(field.options_api, {
                params: { query }
            })
            setDynamicOptions(prev => ({
                ...prev,
                [field.name]: data.options || []
            }))
        } catch (error) {
            console.error('Error fetching dynamic options:', error)
            setDynamicOptions(prev => ({
                ...prev,
                [field.name]: []
            }))
        } finally {
            setIsLoadingOptions(prev => ({
                ...prev,
                [field.name]: false
            }))
        }
    }, [])

    // 带防抖的搜索处理
    const handleDynamicSearch = useCallback((field: UIField, query: string) => {
        // 更新本地搜索状态
        setDynamicSearchQuery(prev => ({
            ...prev,
            [field.name]: query
        }))

        // 清除之前的定时器
        if (debounceTimerRef.current[field.name]) {
            clearTimeout(debounceTimerRef.current[field.name])
        }

        // 设置新的防抖定时器（300ms延迟）
        debounceTimerRef.current[field.name] = setTimeout(() => {
            fetchDynamicOptions(field, query)
        }, 300)
    }, [fetchDynamicOptions])

    // 清理定时器
    useEffect(() => {
        return () => {
            Object.values(debounceTimerRef.current).forEach(timer => clearTimeout(timer))
        }
    }, [])


    // 验证字段值
    const validateField = async (field: UIField, value: any) => {
        try {
            await apiClient.post(
                `/plugins/${pluginId}/callbacks/validate-field`,
                { field: field.name, value }
            )
            return null
        } catch (error: any) {
            console.error('Error validating field:', error)
            return error.message || 'Validation failed'
        }
    }

    const handleFieldChange = async (fieldName: string, value: any) => {
        const newCondition = {
            ...condition,
            pluginId,
            fields: {
                ...condition.fields,
                [fieldName]: value
            }
        }
        onChange(newCondition)

        // 触发验证
        const field = pluginData?.schema.fields.find(f => f.name === fieldName)
        if (field) {
            await validateField(field, value)
        }
    }

    // 选择选项并关闭下拉框
    const selectOption = (field: UIField, option: any) => {
        handleFieldChange(field.name, option.value)
        setDynamicSearchQuery(prev => ({
            ...prev,
            [field.name]: ''
        }))
        setDynamicOptions(prev => ({
            ...prev,
            [field.name]: []
        }))
        setIsDropdownOpen(prev => ({
            ...prev,
            [field.name]: false
        }))
        setActiveOptionIndex(prev => ({
            ...prev,
            [field.name]: 0
        }))
    }

    // 关闭下拉框
    const closeDropdown = useCallback((fieldName: string) => {
        setIsDropdownOpen(prev => ({
            ...prev,
            [fieldName]: false
        }))
        setActiveOptionIndex(prev => ({
            ...prev,
            [fieldName]: 0
        }))
    }, [])

    // 处理键盘事件
    const handleKeyDown = (e: React.KeyboardEvent, field: UIField) => {
        const options = dynamicOptions[field.name] || []
        const currentIndex = activeOptionIndex[field.name] || 0
        const isOpen = isDropdownOpen[field.name] || false

        if (!isOpen || options.length === 0) {
            // 如果下拉框未打开且按下回车，打开下拉框
            if (e.key === 'Enter') {
                e.preventDefault()
                setIsDropdownOpen(prev => ({
                    ...prev,
                    [field.name]: true
                }))
                fetchDynamicOptions(field, dynamicSearchQuery[field.name] || '')
            }
            return
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setActiveOptionIndex(prev => ({
                    ...prev,
                    [field.name]: Math.min(currentIndex + 1, options.length - 1)
                }))
                break
            case 'ArrowUp':
                e.preventDefault()
                setActiveOptionIndex(prev => ({
                    ...prev,
                    [field.name]: Math.max(currentIndex - 1, 0)
                }))
                break
            case 'Enter':
                e.preventDefault()
                if (options[currentIndex]) {
                    selectOption(field, options[currentIndex])
                }
                break
            case 'Escape':
                e.preventDefault()
                closeDropdown(field.name)
                break
        }
    }


    // 处理操作符变化 - 当切换到/从列表操作符时转换值格式
    const handleOperatorChange = (operator: string) => {
        let newValue = condition.fields?.value

        // 如果切换到列表操作符，确保值是数组格式
        if (listOperators.includes(operator)) {
            if (typeof newValue === 'string' && newValue) {
                newValue = newValue.split(',').map((v: string) => v.trim()).filter(Boolean)
            } else if (!Array.isArray(newValue)) {
                newValue = []
            }
        } else {
            // 如果从列表操作符切换到其他操作符，转换回字符串
            if (Array.isArray(newValue)) {
                newValue = newValue.join(', ')
            }
        }

        onChange({
            ...condition,
            pluginId,
            fields: {
                ...condition.fields,
                operator,
                value: newValue
            }
        })
    }

    // 处理列表值输入（多行文本）
    const handleListValueChange = (text: string) => {
        const values = text
            .split(/[\n,]/)
            .map(v => v.trim())
            .filter(Boolean)
        onChange({
            ...condition,
            pluginId,
            fields: {
                ...condition.fields,
                value: values
            }
        })
    }

    // 获取列表值的显示文本
    const getListValueDisplayText = () => {
        const value = condition.fields?.value
        if (Array.isArray(value)) {
            if (value.length === 0) return '点击添加值...'
            return value.join(', ')
        }
        return value || '点击添加值...'
    }

    // 获取列表值用于编辑
    const getListValueForEdit = () => {
        const value = condition.fields?.value
        if (Array.isArray(value)) {
            return value.join('\n')
        }
        return value || ''
    }

    const toggleNot = () => {
        onChange({
            ...condition,
            not: !condition.not
        })
    }

    // 检查字段是否应该显示
    const shouldShowField = (field: UIField): boolean => {
        if (field.hidden) return false
        if (!field.show_if) return true

        // 检查show_if条件
        for (const [fieldName, expectedValue] of Object.entries(field.show_if)) {
            const currentValue = condition.fields?.[fieldName]
            if (currentValue !== expectedValue) {
                return false
            }
        }
        return true
    }

    // 根据当前字段类型构建操作符列表
    const getOperatorsForField = () => {
        if (currentFieldIsArray) {
            // 数组字段：只显示数组专用操作符
            return arrayOperators
        }
        return standardOperators
    }

    const renderField = (field: UIField) => {
        const value = condition.fields?.[field.name] ?? field.default ?? ''

        // 特殊处理操作符字段 - 根据选择的字段类型动态调整操作符列表
        if (field.name === 'operator') {
            const operators = getOperatorsForField()
            return (
                <Select
                    value={currentOperator}
                    onValueChange={handleOperatorChange}
                    disabled={field.disabled}
                >
                    <SelectTrigger className={`h-8 text-sm ${currentFieldIsArray ? 'border-amber-300 bg-amber-50' : ''}`}>
                        <SelectValue placeholder={field.placeholder || `选择${field.label}`} />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                        {operators.map((op: any) => (
                            <SelectItem key={op.value} value={op.value}>
                                <span className="flex items-center gap-1">
                                    {currentFieldIsArray && (
                                        <List className="h-3 w-3 text-amber-500" />
                                    )}
                                    {op.label}
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )
        }

        // 特殊处理值字段 - 根据操作符类型使用不同的输入方式
        if (field.name === 'value') {
            // 如果不需要值输入，显示占位符
            if (hideValueInput) {
                return (
                    <div className="h-8 px-3 flex items-center text-sm text-gray-400 bg-gray-50 border rounded-md">
                        无需输入值
                    </div>
                )
            }

            // 列表操作符：使用可展开的多值输入
            if (isListOperator) {
                return (
                    <>
                        <button
                            type="button"
                            className="w-full h-8 px-3 text-sm text-left bg-white border rounded-md hover:bg-gray-50 flex items-center justify-between"
                            onClick={(e) => {
                                e.stopPropagation()
                                setIsListInputOpen(true)
                            }}
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
                                            当前 {Array.isArray(condition.fields?.value) ? condition.fields.value.length : 0} 个值
                                        </span>
                                        <Button size="sm" onClick={() => setIsListInputOpen(false)}>
                                            完成
                                        </Button>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </>
                )
            }

            // 普通值输入
            return (
                <Input
                    value={typeof value === 'string' ? value : (Array.isArray(value) ? value.join(', ') : '')}
                    onChange={(e) => handleFieldChange(field.name, e.target.value)}
                    placeholder={field.placeholder || '输入值'}
                    className="h-8 text-sm"
                    pattern={field.pattern || undefined}
                    disabled={field.disabled}
                />
            )
        }

        switch (field.type) {
            case 'boolean':
                return (
                    <div className="flex items-center space-x-2">
                        <Switch
                            checked={!!value}
                            onCheckedChange={(checked) => handleFieldChange(field.name, checked)}
                            disabled={field.disabled}
                        />
                        <span className="text-sm text-gray-600">
                            {value ? '是' : '否'}
                        </span>
                    </div>
                )

            case 'select':
                return (
                    <Select
                        value={value}
                        onValueChange={(v) => handleFieldChange(field.name, v)}
                        disabled={field.disabled}
                    >
                        <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder={field.placeholder || `选择${field.label}`} />
                        </SelectTrigger>
                        <SelectContent>
                            {field.options?.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                    <div className="flex items-center gap-2">
                                        {option.icon && <span className="text-sm">{option.icon}</span>}
                                        <span style={{ color: option.color }}>{option.label}</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )

            case 'dynamic':
                const searchQuery = dynamicSearchQuery[field.name] || ''
                const options = dynamicOptions[field.name] || []
                const isLoading = isLoadingOptions[field.name] || false
                const isOpen = isDropdownOpen[field.name] || false
                const activeIndex = activeOptionIndex[field.name] || 0

                return (
                    <div className="relative">
                        <Input
                            value={searchQuery || value}
                            onChange={(e) => {
                                handleDynamicSearch(field, e.target.value)
                                // 打开下拉框
                                setIsDropdownOpen(prev => ({
                                    ...prev,
                                    [field.name]: true
                                }))
                                // 重置选中索引
                                setActiveOptionIndex(prev => ({
                                    ...prev,
                                    [field.name]: 0
                                }))
                                // 如果用户清空了输入，也清空选中的值
                                if (!e.target.value) {
                                    handleFieldChange(field.name, '')
                                }
                            }}
                            onFocus={() => {
                                // 打开时立即加载选项并显示下拉框
                                setIsDropdownOpen(prev => ({
                                    ...prev,
                                    [field.name]: true
                                }))
                                fetchDynamicOptions(field, searchQuery)
                            }}
                            onBlur={() => {
                                // 延迟关闭，以便点击选项时能触发 onClick
                                setTimeout(() => {
                                    closeDropdown(field.name)
                                }, 200)
                            }}
                            onKeyDown={(e) => handleKeyDown(e, field)}
                            placeholder={field.placeholder || `搜索${field.label}...`}
                            className="h-8 text-sm pr-8"
                            disabled={field.disabled}
                        />
                        {isLoading && (
                            <Loader2 className="h-4 w-4 absolute right-2 top-2 animate-spin text-gray-400" />
                        )}
                        {!isLoading && options.length > 0 && isOpen && (
                            <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-auto">
                                {options.map((option: any, index: number) => (
                                    <div
                                        key={option.value}
                                        className={`px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${index === activeIndex
                                            ? 'bg-blue-100 text-blue-800'
                                            : 'hover:bg-gray-100'
                                            }`}
                                        onClick={() => selectOption(field, option)}
                                        onMouseEnter={() => {
                                            setActiveOptionIndex(prev => ({
                                                ...prev,
                                                [field.name]: index
                                            }))
                                        }}
                                    >
                                        {option.icon && <span className="text-gray-400">{option.icon}</span>}
                                        <span>{option.label}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* 显示当前选中的值 */}
                        {value && !searchQuery && (
                            <Badge
                                variant="secondary"
                                className="absolute left-2 top-1 text-xs cursor-pointer"
                                onClick={() => {
                                    handleFieldChange(field.name, '')
                                }}
                            >
                                {value} ×
                            </Badge>
                        )}
                    </div>
                )

            case 'multi_select':
                // 用于输入多个值，如邮箱后缀/前缀列表
                const multiValues = Array.isArray(value) ? value : (typeof value === 'string' && value ? value.split(/[,;\n]/).map(v => v.trim()).filter(Boolean) : [])
                const multiSearchQuery = dynamicSearchQuery[field.name] || ''
                const multiOptions = field.options || dynamicOptions[field.name] || []
                const isMultiLoading = isLoadingOptions[field.name] || false
                const isMultiOpen = isDropdownOpen[field.name] || false
                const multiActiveIndex = activeOptionIndex[field.name] || 0

                return (
                    <div className="space-y-2">
                        {/* 已选择的值列表 */}
                        {multiValues.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {multiValues.map((v: string, index: number) => (
                                    <Badge
                                        key={`${v}-${index}`}
                                        variant="secondary"
                                        className="text-xs pl-2 pr-1 py-0.5 flex items-center gap-1 hover:bg-gray-200"
                                    >
                                        <span>{v}</span>
                                        <button
                                            type="button"
                                            className="ml-1 hover:text-red-500 focus:outline-none"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                const newValues = [...multiValues]
                                                newValues.splice(index, 1)
                                                handleFieldChange(field.name, newValues.length > 0 ? newValues : '')
                                            }}
                                        >
                                            ×
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                        )}

                        {/* 输入框 */}
                        <div className="relative">
                            <Input
                                value={multiSearchQuery}
                                onChange={(e) => {
                                    setDynamicSearchQuery(prev => ({
                                        ...prev,
                                        [field.name]: e.target.value
                                    }))
                                    // 如果有动态选项 API，触发搜索
                                    if (field.options_api) {
                                        setIsDropdownOpen(prev => ({
                                            ...prev,
                                            [field.name]: true
                                        }))
                                        handleDynamicSearch(field, e.target.value)
                                    }
                                }}
                                onFocus={() => {
                                    if (field.options_api || (field.options && field.options.length > 0)) {
                                        setIsDropdownOpen(prev => ({
                                            ...prev,
                                            [field.name]: true
                                        }))
                                        if (field.options_api) {
                                            fetchDynamicOptions(field, multiSearchQuery)
                                        }
                                    }
                                }}
                                onBlur={(e) => {
                                    // 获取当前输入框的值
                                    const inputValue = e.target.value?.trim() || ''

                                    // 延迟处理以便点击选项时能触发 onClick
                                    setTimeout(() => {
                                        // 在关闭下拉框之前，检查是否有未提交的输入值
                                        if (inputValue) {
                                            // 自动添加输入的值
                                            const currentValues = Array.isArray(value) ? value : (typeof value === 'string' && value ? value.split(/[,;\n]/).map(v => v.trim()).filter(Boolean) : [])
                                            if (!currentValues.includes(inputValue)) {
                                                handleFieldChange(field.name, [...currentValues, inputValue])
                                            }
                                            setDynamicSearchQuery(prev => ({
                                                ...prev,
                                                [field.name]: ''
                                            }))
                                        }
                                        closeDropdown(field.name)
                                    }, 200)
                                }}
                                onKeyDown={(e) => {
                                    // 支持按 Enter 键添加自定义值
                                    if (e.key === 'Enter' && multiSearchQuery.trim()) {
                                        e.preventDefault()
                                        // 检查是否有从下拉选项中选择
                                        if (isMultiOpen && multiOptions.length > 0 && multiActiveIndex < multiOptions.length) {
                                            // 选择当前高亮的选项
                                            const selectedOption = multiOptions[multiActiveIndex]
                                            const newValue = typeof selectedOption === 'object' ? selectedOption.value : selectedOption
                                            if (!multiValues.includes(newValue)) {
                                                handleFieldChange(field.name, [...multiValues, newValue])
                                            }
                                        } else {
                                            // 添加自定义输入的值
                                            const newValue = multiSearchQuery.trim()
                                            if (!multiValues.includes(newValue)) {
                                                handleFieldChange(field.name, [...multiValues, newValue])
                                            }
                                        }
                                        setDynamicSearchQuery(prev => ({
                                            ...prev,
                                            [field.name]: ''
                                        }))
                                        closeDropdown(field.name)
                                    } else if (e.key === 'Backspace' && !multiSearchQuery && multiValues.length > 0) {
                                        // 按 Backspace 删除最后一个值
                                        e.preventDefault()
                                        const newValues = [...multiValues]
                                        newValues.pop()
                                        handleFieldChange(field.name, newValues.length > 0 ? newValues : '')
                                    } else if (e.key === 'ArrowDown' && isMultiOpen) {
                                        e.preventDefault()
                                        setActiveOptionIndex(prev => ({
                                            ...prev,
                                            [field.name]: Math.min((prev[field.name] || 0) + 1, multiOptions.length - 1)
                                        }))
                                    } else if (e.key === 'ArrowUp' && isMultiOpen) {
                                        e.preventDefault()
                                        setActiveOptionIndex(prev => ({
                                            ...prev,
                                            [field.name]: Math.max((prev[field.name] || 0) - 1, 0)
                                        }))
                                    } else if (e.key === 'Escape') {
                                        closeDropdown(field.name)
                                    }
                                }}
                                placeholder={field.placeholder || `添加${field.label}，按 Enter 确认`}
                                className="h-8 text-sm pr-8"
                                disabled={field.disabled}
                            />
                            {isMultiLoading && (
                                <Loader2 className="h-4 w-4 absolute right-2 top-2 animate-spin text-gray-400" />
                            )}

                            {/* 下拉选项 */}
                            {!isMultiLoading && isMultiOpen && multiOptions.length > 0 && (
                                <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-auto">
                                    {multiOptions.map((option: any, index: number) => {
                                        const optionValue = typeof option === 'object' ? option.value : option
                                        const optionLabel = typeof option === 'object' ? option.label : option
                                        const isSelected = multiValues.includes(optionValue)
                                        return (
                                            <div
                                                key={optionValue}
                                                className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${index === multiActiveIndex
                                                    ? 'bg-blue-100 text-blue-800'
                                                    : isSelected
                                                        ? 'bg-gray-100 text-gray-500'
                                                        : 'hover:bg-gray-100'
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    if (!isSelected) {
                                                        handleFieldChange(field.name, [...multiValues, optionValue])
                                                    } else {
                                                        handleFieldChange(field.name, multiValues.filter(v => v !== optionValue))
                                                    }
                                                    setDynamicSearchQuery(prev => ({
                                                        ...prev,
                                                        [field.name]: ''
                                                    }))
                                                }}
                                                onMouseEnter={() => {
                                                    setActiveOptionIndex(prev => ({
                                                        ...prev,
                                                        [field.name]: index
                                                    }))
                                                }}
                                            >
                                                <span>{optionLabel}</span>
                                                {isSelected && (
                                                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* 提示文本 */}
                        <p className="text-xs text-gray-400">
                            可输入多个值，按 Enter 添加。也可输入逗号/分号分隔的多个值。
                        </p>
                    </div>
                )

            case 'textarea':
                return (
                    <Textarea
                        value={value}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        placeholder={field.placeholder}
                        className="min-h-[60px] text-sm resize-none"
                        rows={2}
                        disabled={field.disabled}
                    />
                )

            case 'number':
                return (
                    <Input
                        type="number"
                        value={value}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        placeholder={field.placeholder}
                        className="h-8 text-sm"
                        min={field.min || undefined}
                        max={field.max || undefined}
                        disabled={field.disabled}
                    />
                )

            default:
                // 只对字段名称包含 field、path、key 等关键词的字段提供智能提示
                // 这些通常是用于输入字段路径的字段，而不是用于输入值的字段
                const isFieldPathInput = field.name.toLowerCase().includes('field') ||
                    field.name.toLowerCase().includes('path') ||
                    field.name.toLowerCase().includes('key') ||
                    field.label.toLowerCase().includes('字段') ||
                    field.label.toLowerCase().includes('路径')

                if (isFieldPathInput) {
                    // 使用带有悬浮预览的字段选择器
                    return (
                        <FieldSelectorWithPreview
                            value={value}
                            onChange={(newValue) => handleFieldChange(field.name, newValue)}
                            placeholder={field.placeholder || `例如: event.type`}
                            testData={testData}
                            disabled={field.disabled}
                        />
                    )
                } else {
                    // 普通文本输入框，不提供智能提示
                    return (
                        <Input
                            value={value}
                            onChange={(e) => handleFieldChange(field.name, e.target.value)}
                            placeholder={field.placeholder}
                            className="h-8 text-sm"
                            pattern={field.pattern || undefined}
                            disabled={field.disabled}
                        />
                    )
                }
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-4 bg-gray-50 rounded-md">
                <span className="text-sm text-gray-500">加载插件配置...</span>
            </div>
        )
    }

    if (!pluginData) {
        return (
            <div className="flex items-center justify-center p-4 bg-red-50 rounded-md">
                <span className="text-sm text-red-500">无法加载插件配置: {pluginId}</span>
            </div>
        )
    }

    // 根据字段宽度计算网格类
    const getFieldClass = (width?: string) => {
        switch (width) {
            case '1/4': return 'col-span-3'
            case '1/3': return 'col-span-4'
            case '1/2':
            case 'half': return 'col-span-6'
            case '2/3': return 'col-span-8'
            case '3/4': return 'col-span-9'
            case 'full': return 'col-span-12'
            default: return 'col-span-4'
        }
    }

    // 过滤要显示的字段
    const visibleFields = pluginData.schema.fields.filter(shouldShowField)

    return (
        <div
            className={`p-3 rounded-md bg-white border transition-all cursor-pointer hover:shadow-sm ${condition.not ? 'border-red-300 bg-red-50' : 'border-gray-200'
                }`}
            onClick={handleClick}
        >
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                        {pluginData.info.name}
                    </Badge>
                    {condition.not && (
                        <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-1.5 py-0">
                            NOT
                        </Badge>
                    )}
                    {/* 评估结果显示 */}
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
                </div>
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

            {/* 字段网格布局 */}
            <div className="grid grid-cols-12 gap-2">
                {visibleFields.map(field => (
                    <div key={field.name} className={getFieldClass(field.width)}>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            {field.label}
                            {field.required && <span className="text-red-500">*</span>}
                        </label>
                        {renderField(field)}
                        {field.description && (
                            <p className="text-xs text-gray-500 mt-1">{field.description}</p>
                        )}
                    </div>
                ))}
            </div>

            {/* 当前字段值预览 */}
            {currentFieldPath && currentFieldValue !== undefined && (
                <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
                    <span>字段当前值:</span>
                    {currentFieldIsArray ? (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 font-normal bg-amber-50 border-amber-200 text-amber-700">
                            <List className="h-3 w-3 mr-1" />
                            数组 [{Array.isArray(currentFieldValue) ? currentFieldValue.length : 0}项]
                            {Array.isArray(currentFieldValue) && currentFieldValue.length > 0 && (
                                <span className="ml-1 text-gray-500">
                                    ({currentFieldValue.slice(0, 2).map(v => typeof v === 'string' && v.length > 20 ? v.substring(0, 20) + '...' : v).join(', ')}
                                    {currentFieldValue.length > 2 ? ', ...' : ''})
                                </span>
                            )}
                        </Badge>
                    ) : (
                        <span className="truncate max-w-xs font-mono bg-gray-100 px-1 py-0.5 rounded">
                            {typeof currentFieldValue === 'string' && currentFieldValue.length > 50
                                ? currentFieldValue.substring(0, 50) + '...'
                                : JSON.stringify(currentFieldValue)}
                        </span>
                    )}
                </div>
            )}

            {/* 帮助文本 */}
            {pluginData.schema.help_text && (
                <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-600">
                    {pluginData.schema.help_text}
                </div>
            )}
        </div>
    )
}
