'use client'

import React, { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiClient } from '@/lib/api-client'
import { HelpTooltip } from './help-tooltip'
import { CodeEditorModal, CodeLanguage, CodeExample, DocumentationSection } from './code-editor-modal'
import { Maximize2, Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { AIGenerateButton, AIGenerateResult } from '@/components/triggers/ai-generate-button'
// 自定义动作编辑器
import { ConditionalBranchEditor } from '@/components/action-editors/conditional-branch-editor'
import { ParallelActionsEditor } from '@/components/action-editors/parallel-actions-editor'
import { VariableExtractEditor } from '@/components/action-editors/variable-extract-editor'
import { AncestorProvider, useAncestors, BreadcrumbItem } from '@/components/ui/sticky-breadcrumb'

interface Action {
    id: string
    pluginId: string
    pluginName: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
}

interface UIValidation {
    pattern?: string
    message?: string
    min_length?: number
    max_length?: number
}

interface UIField {
    name: string
    label: string
    type: 'text' | 'number' | 'select' | 'multi_select' | 'textarea' | 'dynamic' | 'boolean' | 'date' | 'time' | 'json' | 'code' | 'javascript' | 'gotemplate' | 'regex' | 'array'
    description?: string
    placeholder?: string
    tooltip?: string      // 详细帮助信息，鼠标悬停时显示
    help_url?: string     // 帮助文档链接
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
    // 代码编辑器专用：自定义示例和文档
    examples?: CodeExample[]
    documentation?: DocumentationSection[]
    // 数组类型专用
    item_schema?: UISchema
    // 验证规则
    validation?: UIValidation
}

interface UISchema {
    fields: UIField[]
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

interface ActionConfigPanelProps {
    action: Action
    availablePlugins: Array<{
        id: string
        name: string
        description: string
    }>
    onChange: (config: Record<string, any>) => void
    testData?: Record<string, any>
    readOnly?: boolean
    nestingLevel?: number // 嵌套层级，用于条件分支等需要嵌套感知的组件
    onActionSelect?: (action: any) => void
}

// 数组字段编辑器组件
interface ArrayFieldEditorProps {
    field: UIField
    value: any[]
    onChange: (value: any[]) => void
    readOnly?: boolean
    parentConfig?: Record<string, any>
}

function ArrayFieldEditor({ field, value, onChange, readOnly = false, parentConfig = {} }: ArrayFieldEditorProps) {
    const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())

    const toggleItem = (index: number) => {
        const newExpanded = new Set(expandedItems)
        if (newExpanded.has(index)) {
            newExpanded.delete(index)
        } else {
            newExpanded.add(index)
        }
        setExpandedItems(newExpanded)
    }

    const addItem = () => {
        const newItem: Record<string, any> = {}
        // 使用 item_schema 的默认值初始化新项
        if (field.item_schema?.fields) {
            field.item_schema.fields.forEach(f => {
                if (f.default !== undefined) {
                    newItem[f.name] = f.default
                }
            })
        }
        const newValue = [...value, newItem]
        onChange(newValue)
        // 自动展开新添加的项
        setExpandedItems(new Set([...expandedItems, newValue.length - 1]))
    }

    const removeItem = (index: number) => {
        const newValue = value.filter((_, i) => i !== index)
        onChange(newValue)
        // 更新展开状态
        const newExpanded = new Set<number>()
        expandedItems.forEach(i => {
            if (i < index) newExpanded.add(i)
            else if (i > index) newExpanded.add(i - 1)
        })
        setExpandedItems(newExpanded)
    }

    const updateItem = (index: number, itemValue: Record<string, any>) => {
        const newValue = [...value]
        newValue[index] = { ...newValue[index], ...itemValue }
        onChange(newValue)
    }

    // 检查子字段是否应该显示（基于当前项的配置）
    const shouldShowItemField = (itemField: UIField, itemConfig: Record<string, any>): boolean => {
        if (itemField.hidden) return false
        if (!itemField.show_if) return true

        for (const [fieldName, expectedValues] of Object.entries(itemField.show_if)) {
            const currentValue = itemConfig?.[fieldName]
            if (Array.isArray(expectedValues)) {
                if (!expectedValues.includes(currentValue)) {
                    return false
                }
            } else {
                if (currentValue !== expectedValues) {
                    return false
                }
            }
        }
        return true
    }

    // 渲染单个项的字段
    const renderItemField = (itemField: UIField, itemIndex: number, itemConfig: Record<string, any>) => {
        const fieldValue = itemConfig?.[itemField.name] ?? itemField.default ?? ''

        const handleChange = (newValue: any) => {
            updateItem(itemIndex, { [itemField.name]: newValue })
        }

        switch (itemField.type) {
            case 'select':
                return (
                    <Select
                        value={String(fieldValue)}
                        onValueChange={handleChange}
                        disabled={readOnly || itemField.disabled}
                    >
                        <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder={itemField.placeholder || `选择${itemField.label}`} />
                        </SelectTrigger>
                        <SelectContent>
                            {itemField.options?.map(option => (
                                <SelectItem key={option.value} value={String(option.value)}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )

            case 'boolean':
                return (
                    <div className="flex items-center space-x-2">
                        <Switch
                            checked={!!fieldValue}
                            onCheckedChange={handleChange}
                            disabled={readOnly || itemField.disabled}
                        />
                        <span className="text-sm text-gray-600">
                            {fieldValue ? '是' : '否'}
                        </span>
                    </div>
                )

            case 'textarea':
            case 'javascript':
            case 'gotemplate':
            case 'regex':
                return (
                    <Textarea
                        value={String(fieldValue)}
                        onChange={(e) => handleChange(e.target.value)}
                        placeholder={itemField.placeholder}
                        className="min-h-[60px] text-sm resize-none font-mono"
                        rows={2}
                        disabled={readOnly || itemField.disabled}
                    />
                )

            default:
                return (
                    <Input
                        value={String(fieldValue)}
                        onChange={(e) => handleChange(e.target.value)}
                        placeholder={itemField.placeholder}
                        className="h-8 text-sm"
                        disabled={readOnly || itemField.disabled}
                    />
                )
        }
    }

    // 获取项的摘要信息
    const getItemSummary = (item: Record<string, any>, index: number): string => {
        const parts: string[] = [`规则 ${index + 1}`]
        if (item.source_type === 'field' && item.source_field) {
            parts.push(`来源:${item.source_field}`)
        } else if (item.source_type === 'variable' && item.source_variable) {
            parts.push(`变量:${item.source_variable}`)
        }
        if (item.transform_type) {
            parts.push(`转换:${item.transform_type}`)
        }
        if (item.output_mode === 'set_variable' && item.target_variable) {
            parts.push(`→ $${item.target_variable}`)
        }
        return parts.join(' | ')
    }

    return (
        <div className="space-y-3">
            {value.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm border border-dashed rounded-md">
                    暂无规则，点击下方按钮添加
                </div>
            ) : (
                <div className="space-y-2">
                    {value.map((item, index) => (
                        <div key={index} className="border rounded-md overflow-hidden">
                            {/* 项头部 */}
                            <div
                                className="flex items-center gap-2 p-2 bg-gray-50 cursor-pointer hover:bg-gray-100"
                                onClick={() => toggleItem(index)}
                            >
                                <GripVertical className="h-4 w-4 text-gray-400" />
                                <span className="flex-1 text-sm font-medium truncate">
                                    {getItemSummary(item, index)}
                                </span>
                                {!readOnly && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            removeItem(index)
                                        }}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                )}
                                {expandedItems.has(index) ? (
                                    <ChevronUp className="h-4 w-4 text-gray-500" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 text-gray-500" />
                                )}
                            </div>

                            {/* 项内容 */}
                            {expandedItems.has(index) && field.item_schema?.fields && (
                                <div className="p-3 space-y-3 bg-white">
                                    <div className="grid grid-cols-2 gap-3">
                                        {field.item_schema.fields
                                            .filter(f => shouldShowItemField(f, item))
                                            .map(itemField => (
                                                <div
                                                    key={itemField.name}
                                                    className={itemField.width === 'full' ? 'col-span-2' : 'col-span-1'}
                                                >
                                                    <div className="space-y-1">
                                                        <Label className="text-xs font-medium text-gray-600">
                                                            {itemField.label}
                                                            {itemField.required && <span className="text-red-500">*</span>}
                                                        </Label>
                                                        {renderItemField(itemField, index, item)}
                                                        {itemField.description && (
                                                            <p className="text-xs text-gray-400">{itemField.description}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {!readOnly && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={addItem}
                >
                    <Plus className="h-4 w-4 mr-1" />
                    添加规则
                </Button>
            )}
        </div>
    )
}

export function ActionConfigPanel({ action, availablePlugins, onChange, testData = {}, readOnly = false, nestingLevel = 0, onActionSelect }: ActionConfigPanelProps) {
    const [pluginData, setPluginData] = useState<PluginData | null>(null)
    const [loading, setLoading] = useState(true)
    const [dynamicOptions, setDynamicOptions] = useState<Record<string, any[]>>({})
    // Code editor modal state
    const [codeEditorOpen, setCodeEditorOpen] = useState(false)
    const [codeEditorField, setCodeEditorField] = useState<UIField | null>(null)
    const [codeEditorLanguage, setCodeEditorLanguage] = useState<CodeLanguage>('javascript')

    // 获取祖先信息
    const { ancestors } = useAncestors()

    // 为动作生成更有意义的面包屑标签
    const getActionBreadcrumbLabel = (): string => {
        // 优先使用描述或别名
        const actionWithMeta = action as any
        if (actionWithMeta.description) return actionWithMeta.description
        if (actionWithMeta.alias) return actionWithMeta.alias

        // 对于条件分支动作，尝试从配置中提取更有意义的信息
        if (action.pluginId === 'conditional_branch_action') {
            const config = action.config as any
            if (config?.description) return config.description
            const branchCount = config?.branches?.length || 0
            return `条件分支 (${branchCount} 个分支)`
        }

        // 对于其他动作，使用插件名称
        return action.pluginName || action.pluginId
    }

    // 创建当前动作的面包屑项
    const currentActionBreadcrumb: BreadcrumbItem = {
        id: action.id,
        type: 'action' as const,
        label: getActionBreadcrumbLabel(),
        description: action.pluginName, // 在描述中显示插件类型
        level: ancestors.length
    }

    // 获取插件UI架构
    useEffect(() => {
        if (action.pluginId) {
            fetchPluginSchema()
        }
    }, [action.pluginId])

    const fetchPluginSchema = async () => {
        try {
            setLoading(true)
            const data = await apiClient.get('/plugins/ui/schemas', {
                params: { type: 'action' }
            })

            // 查找对应的插件数据
            const plugin = data[action.pluginId]
            if (plugin) {
                setPluginData(plugin)
            }
        } catch (error) {
            console.error('获取插件配置架构失败:', error)
        } finally {
            setLoading(false)
        }
    }

    // 获取动态选项
    const fetchDynamicOptions = async (field: UIField, query: string = '') => {
        if (field.type !== 'dynamic' || !field.options_api) return

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
        }
    }

    const handleFieldChange = (fieldName: string, value: any) => {
        const newConfig = {
            ...action.config,
            [fieldName]: value
        }
        onChange(newConfig)
    }

    // 检查字段是否应该显示
    const shouldShowField = (field: UIField): boolean => {
        if (field.hidden) return false
        if (!field.show_if) return true

        // 检查show_if条件
        for (const [fieldName, expectedValues] of Object.entries(field.show_if)) {
            const currentValue = action.config?.[fieldName]
            if (Array.isArray(expectedValues)) {
                if (!expectedValues.includes(currentValue)) {
                    return false
                }
            } else {
                if (currentValue !== expectedValues) {
                    return false
                }
            }
        }
        return true
    }

    const renderField = (field: UIField) => {
        const value = action.config?.[field.name] ?? field.default ?? ''

        const fieldComponent = (() => {
            switch (field.type) {
                case 'boolean':
                    return (
                        <div className="flex items-center space-x-2">
                            <Switch
                                checked={!!value}
                                onCheckedChange={(checked) => handleFieldChange(field.name, checked)}
                                disabled={readOnly || field.disabled}
                            />
                            <span className="text-sm text-gray-600">
                                {value ? '是' : '否'}
                            </span>
                        </div>
                    )

                case 'select':
                    return (
                        <Select
                            value={String(value)}
                            onValueChange={(v) => handleFieldChange(field.name, v)}
                            disabled={readOnly || field.disabled}
                        >
                            <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder={field.placeholder || `选择${field.label}`} />
                            </SelectTrigger>
                            <SelectContent>
                                {field.options?.map(option => (
                                    <SelectItem key={option.value} value={String(option.value)}>
                                        <div className="flex items-center gap-2">
                                            {option.icon && <span className="text-sm">{option.icon}</span>}
                                            <span style={{ color: option.color }}>{option.label}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )

                case 'multi_select':
                    return (
                        <div className="space-y-2">
                            {field.options?.map((option: any) => (
                                <div key={option.value} className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        id={`${field.name}-${option.value}`}
                                        checked={Array.isArray(value) && value.includes(option.value)}
                                        onChange={(e) => {
                                            const currentArray = Array.isArray(value) ? value : []
                                            if (e.target.checked) {
                                                handleFieldChange(field.name, [...currentArray, option.value])
                                            } else {
                                                handleFieldChange(field.name, currentArray.filter(v => v !== option.value))
                                            }
                                        }}
                                        className="rounded border-gray-300"
                                        disabled={readOnly || field.disabled}
                                    />
                                    <label htmlFor={`${field.name}-${option.value}`} className="text-sm">
                                        {option.label}
                                    </label>
                                </div>
                            ))}
                        </div>
                    )

                case 'dynamic':
                    return (
                        <Select
                            value={String(value)}
                            onValueChange={(v) => handleFieldChange(field.name, v)}
                            onOpenChange={(open) => {
                                if (open) fetchDynamicOptions(field)
                            }}
                            disabled={readOnly || field.disabled}
                        >
                            <SelectTrigger className="h-8 text-sm">
                                <SelectValue placeholder={field.placeholder || `选择${field.label}`} />
                            </SelectTrigger>
                            <SelectContent>
                                {(dynamicOptions[field.name] || []).map((option: any) => (
                                    <SelectItem
                                        key={option.value}
                                        value={String(option.value)}
                                    >
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )

                case 'textarea':
                    return (
                        <Textarea
                            value={String(value)}
                            onChange={(e) => handleFieldChange(field.name, e.target.value)}
                            placeholder={field.placeholder}
                            className="min-h-[80px] text-sm resize-none"
                            rows={3}
                            disabled={readOnly || field.disabled}
                        />
                    )

                case 'code':
                case 'javascript':
                case 'gotemplate':
                case 'regex':
                    const codeLanguage: CodeLanguage = field.type === 'gotemplate' ? 'gotemplate'
                        : field.type === 'regex' ? 'regex'
                            : 'javascript'
                    return (
                        <div className="space-y-2">
                            <div className="relative">
                                <Textarea
                                    value={String(value)}
                                    onChange={(e) => handleFieldChange(field.name, e.target.value)}
                                    placeholder={field.placeholder}
                                    className="min-h-[80px] text-sm resize-none font-mono pr-10"
                                    rows={4}
                                    disabled={readOnly || field.disabled}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-1 top-1 h-8 w-8 hover:bg-blue-100"
                                    onClick={() => {
                                        setCodeEditorField(field)
                                        setCodeEditorLanguage(codeLanguage)
                                        setCodeEditorOpen(true)
                                    }}
                                    title="在编辑器中打开"
                                >
                                    <Maximize2 className="h-4 w-4 text-blue-600" />
                                </Button>
                            </div>
                            <p className="text-xs text-gray-500">
                                点击右上角按钮可打开高级编辑器，获得代码提示和示例
                            </p>
                        </div>
                    )

                case 'number':
                    return (
                        <Input
                            type="number"
                            value={String(value)}
                            onChange={(e) => handleFieldChange(field.name, e.target.value ? parseFloat(e.target.value) : '')}
                            placeholder={field.placeholder}
                            className="h-8 text-sm"
                            min={field.min || undefined}
                            max={field.max || undefined}
                            disabled={readOnly || field.disabled}
                        />
                    )

                case 'date':
                    return (
                        <Input
                            type="date"
                            value={String(value)}
                            onChange={(e) => handleFieldChange(field.name, e.target.value)}
                            className="h-8 text-sm"
                            disabled={readOnly || field.disabled}
                        />
                    )

                case 'time':
                    return (
                        <Input
                            type="time"
                            value={String(value)}
                            onChange={(e) => handleFieldChange(field.name, e.target.value)}
                            className="h-8 text-sm"
                            disabled={readOnly || field.disabled}
                        />
                    )

                case 'json':
                    return (
                        <Textarea
                            value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                            onChange={(e) => {
                                try {
                                    const parsed = JSON.parse(e.target.value)
                                    handleFieldChange(field.name, parsed)
                                } catch {
                                    handleFieldChange(field.name, e.target.value)
                                }
                            }}
                            placeholder={field.placeholder || '输入JSON格式数据'}
                            className="min-h-[100px] font-mono text-sm"
                            disabled={readOnly || field.disabled}
                        />
                    )

                case 'array':
                    return (
                        <ArrayFieldEditor
                            field={field}
                            value={Array.isArray(value) ? value : []}
                            onChange={(newValue) => handleFieldChange(field.name, newValue)}
                            readOnly={readOnly}
                            parentConfig={action.config}
                        />
                    )

                default:
                    // 默认使用文本输入
                    return (
                        <Input
                            value={String(value)}
                            onChange={(e) => handleFieldChange(field.name, e.target.value)}
                            placeholder={field.placeholder}
                            className="h-8 text-sm"
                            pattern={field.pattern || undefined}
                            disabled={readOnly || field.disabled}
                        />
                    )
            }
        })()

        return (
            <div key={field.name} className="space-y-2">
                <div className="flex items-center gap-2">
                    <Label htmlFor={`field-${field.name}`} className="text-sm font-medium">
                        {field.label}
                        {field.required && <span className="text-red-500">*</span>}
                    </Label>
                    {field.tooltip && (
                        <HelpTooltip content={field.tooltip} />
                    )}
                </div>
                {fieldComponent}
                {field.description && (
                    <p className="text-xs text-gray-500">{field.description}</p>
                )}
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
            default: return 'col-span-12'
        }
    }

    if (loading) {
        return (
            <Card className="p-6">
                <div className="flex items-center justify-center p-8 bg-gray-50 rounded-md">
                    <span className="text-sm text-gray-500">加载插件配置...</span>
                </div>
            </Card>
        )
    }

    // 检查是否需要使用自定义编辑器
    const renderCustomEditor = () => {
        switch (action.pluginId) {
            case 'conditional_branch_action':
                return (
                    <div className="space-y-4">
                        {/* 插件信息 */}
                        <Card className="p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex-1">
                                    <h3 className="font-semibold text-lg">{pluginData?.info.name || '条件分支'}</h3>
                                    <p className="text-sm text-gray-600 mt-1">{pluginData?.info.description || '实现 if-else if-else 逻辑'}</p>
                                    <Badge variant="secondary" className="mt-2 text-xs">
                                        {action.pluginId}
                                    </Badge>
                                </div>
                            </div>
                        </Card>
                        {/* 直接渲染，不需要 AncestorProvider，因为 ActionSection 已经提供了祖先上下文 */}
                        <ConditionalBranchEditor
                            config={action.config || {}}
                            onChange={onChange}
                            availablePlugins={availablePlugins}
                            testData={testData}
                            nestingLevel={nestingLevel}
                            onActionSelect={onActionSelect}
                            actionId={action.id}
                        />
                    </div>
                )
            case 'parallel_actions':
                return (
                    <div className="space-y-4">
                        {/* 插件信息 */}
                        <Card className="p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex-1">
                                    <h3 className="font-semibold text-lg">{pluginData?.info.name || '并行动作'}</h3>
                                    <p className="text-sm text-gray-600 mt-1">{pluginData?.info.description || '并行执行多个动作'}</p>
                                    <Badge variant="secondary" className="mt-2 text-xs">
                                        {action.pluginId}
                                    </Badge>
                                </div>
                            </div>
                        </Card>
                        {/* 直接渲染，不需要 AncestorProvider */}
                        <ParallelActionsEditor
                            config={action.config || {}}
                            onChange={onChange}
                            availablePlugins={availablePlugins}
                            onActionSelect={onActionSelect}
                        />
                    </div>
                )
            case 'variable_extract_action':
                return (
                    <div className="space-y-4">
                        {/* 插件信息 */}
                        <Card className="p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex-1">
                                    <h3 className="font-semibold text-lg">{pluginData?.info.name || '变量提取'}</h3>
                                    <p className="text-sm text-gray-600 mt-1">{pluginData?.info.description || '从邮件数据中提取变量'}</p>
                                    <Badge variant="secondary" className="mt-2 text-xs">
                                        {action.pluginId}
                                    </Badge>
                                </div>
                            </div>
                        </Card>
                        {/* 直接渲染，不需要 AncestorProvider */}
                        <VariableExtractEditor
                            config={action.config || {}}
                            onChange={onChange}
                        />
                    </div>
                )
            default:
                return null
        }
    }

    // 如果有自定义编辑器，使用自定义编辑器
    const customEditor = renderCustomEditor()
    if (customEditor) {
        return customEditor
    }

    // 如果没有插件数据，显示错误
    if (!pluginData) {
        return (
            <Card className="p-6">
                <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-4">⚠️</div>
                    <p>无法加载插件配置</p>
                    <p className="text-sm mt-2">插件ID: {action.pluginId}</p>
                </div>
            </Card>
        )
    }

    return (
        <div className="space-y-6">
            {/* 插件信息 */}
            <Card className="p-4">
                <div className="flex items-start gap-3">
                    <div className="flex-1">
                        <h3 className="font-semibold text-lg">{pluginData.info.name}</h3>
                        <p className="text-sm text-gray-600 mt-1">{pluginData.info.description}</p>
                        <Badge variant="secondary" className="mt-2 text-xs">
                            {action.pluginId}
                        </Badge>
                    </div>
                </div>
            </Card>

            {/* 配置字段 */}
            <Card className="p-4">
                <h4 className="font-medium mb-4 flex items-center gap-2">
                    ⚙️ 配置参数
                    {pluginData.schema.help_text && (
                        <HelpTooltip content={pluginData.schema.help_text} />
                    )}
                </h4>

                {/* 通用动作别名字段 */}
                <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-medium flex items-center gap-1.5">
                            动作别名
                            <HelpTooltip content="设置一个别名后，可通过 $step.别名 访问此动作的输出" />
                        </Label>
                        {!readOnly && (
                            <AIGenerateButton
                                scenario="action"
                                context={{
                                    pluginId: action.pluginId,
                                    pluginName: pluginData?.info?.name || action.pluginName,
                                    config: action.config,
                                }}
                                onGenerate={(result: AIGenerateResult) => {
                                    // 使用生成的名称作为别名（转换为英文样式）
                                    const alias = result.name
                                        .replace(/[\u4e00-\u9fa5]/g, '')  // 移除中文
                                        .replace(/\s+/g, '_')  // 空格转下划线
                                        .toLowerCase()
                                        .substring(0, 20) || 'action'
                                    handleFieldChange('alias', alias)
                                }}
                                size="sm"
                            />
                        )}
                    </div>
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-6">
                            <Input
                                value={action.config?.alias || ''}
                                onChange={(e) => handleFieldChange('alias', e.target.value)}
                                placeholder="例如: transform, notify"
                                className="h-8 text-sm"
                                disabled={readOnly}
                            />
                            <p className="text-xs text-gray-500 mt-1">可选，用于 $step.别名 访问</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-12 gap-4">
                    {pluginData.schema.fields.filter(shouldShowField).map(field => (
                        <div key={field.name} className={getFieldClass(field.width)}>
                            {renderField(field)}
                        </div>
                    ))}
                </div>
            </Card>


            {/* Code Editor Modal */}
            {codeEditorField && (
                <CodeEditorModal
                    open={codeEditorOpen}
                    onOpenChange={setCodeEditorOpen}
                    language={codeEditorLanguage}
                    code={action.config[codeEditorField.name] || ''}
                    onCodeChange={(code) => handleFieldChange(codeEditorField.name, code)}
                    title={`编辑 ${codeEditorField.label}`}
                    testData={testData}
                    customExamples={codeEditorField.examples}
                    customDocumentation={codeEditorField.documentation}
                />
            )}
        </div>
    )
}