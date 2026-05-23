import React, { useState, useEffect } from 'react'
import { Trash2, ChevronUp, ChevronDown, Settings, ToggleLeft, ToggleRight, Hash, HelpCircle, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { apiClient } from '@/lib/api-client'
import { CodeEditorModal, CodeLanguage, CodeExample, DocumentationSection } from './code-editor-modal'

interface Action {
    id?: string
    pluginId: string
    pluginName: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
}

interface ActionGroupProps {
    action: Action
    index: number
    totalCount: number
    availablePlugins: Array<{
        id: string
        name: string
        description: string
        requiredConfig: string[]
        supportedEventTypes: string[]
    }>
    onChange: (action: Action) => void
    onDelete: () => void
    onMove: (direction: 'up' | 'down') => void
}

interface UIField {
    name: string
    label: string
    type: 'text' | 'number' | 'select' | 'multi_select' | 'textarea' | 'dynamic' | 'boolean' | 'date' | 'time' | 'json' | 'code' | 'javascript' | 'gotemplate' | 'regex'
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
    // 代码编辑器专用
    examples?: CodeExample[]
    documentation?: DocumentationSection[]
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

export function ActionGroup({
    action,
    index,
    totalCount,
    availablePlugins,
    onChange,
    onDelete,
    onMove
}: ActionGroupProps) {
    const [pluginData, setPluginData] = useState<PluginData | null>(null)
    const [loading, setLoading] = useState(true)
    const [dynamicOptions, setDynamicOptions] = useState<Record<string, any[]>>({})

    // CodeEditorModal state
    const [codeEditorOpen, setCodeEditorOpen] = useState(false)
    const [codeEditorField, setCodeEditorField] = useState<UIField | null>(null)
    const [codeEditorLanguage, setCodeEditorLanguage] = useState<CodeLanguage>('javascript')

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

    // 验证字段值
    const validateField = async (field: UIField, value: any) => {
        try {
            await apiClient.post(
                `/plugins/${action.pluginId}/callbacks/validate-field`,
                { field: field.name, value }
            )
            return null
        } catch (error: any) {
            console.error('Error validating field:', error)
            return error.message || 'Validation failed'
        }
    }

    const handleFieldChange = async (fieldName: string, value: any) => {
        const newConfig = {
            ...action.config,
            [fieldName]: value
        }
        onChange({ ...action, config: newConfig })

        // 触发验证
        const field = pluginData?.schema.fields.find(f => f.name === fieldName)
        if (field) {
            await validateField(field, value)
        }
    }

    const handlePluginChange = (pluginId: string) => {
        const plugin = availablePlugins.find(p => p.id === pluginId)
        if (plugin) {
            onChange({
                ...action,
                pluginId,
                pluginName: plugin.name,
                config: {} // 重置配置
            })
        }
    }

    const handleToggleEnabled = (enabled: boolean) => {
        onChange({ ...action, enabled })
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
                        value={String(value)}
                        onValueChange={(v) => handleFieldChange(field.name, v)}
                        disabled={field.disabled}
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
                                    disabled={field.disabled}
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
                        disabled={field.disabled}
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
                        className="min-h-[60px] text-sm resize-none"
                        rows={2}
                        disabled={field.disabled}
                    />
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
                        disabled={field.disabled}
                    />
                )

            case 'date':
                return (
                    <Input
                        type="date"
                        value={String(value)}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        className="h-8 text-sm"
                        disabled={field.disabled}
                    />
                )

            case 'time':
                return (
                    <Input
                        type="time"
                        value={String(value)}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        className="h-8 text-sm"
                        disabled={field.disabled}
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
                        disabled={field.disabled}
                    />
                )

            case 'code':
                return (
                    <Textarea
                        value={String(value)}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        placeholder={field.placeholder || field.description}
                        className="min-h-[100px] font-mono text-sm"
                        disabled={field.disabled}
                    />
                )

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
                                disabled={field.disabled}
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

            default:
                // 默认使用文本输入
                return (
                    <Input
                        value={String(value)}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        placeholder={field.placeholder}
                        className="h-8 text-sm"
                        pattern={field.pattern || undefined}
                        disabled={field.disabled}
                    />
                )
        }
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

    const currentPlugin = availablePlugins.find(p => p.id === action.pluginId)

    if (loading) {
        return (
            <Card className="p-4">
                <div className="flex items-center justify-center p-4 bg-gray-50 rounded-md">
                    <span className="text-sm text-gray-500">加载插件配置...</span>
                </div>
            </Card>
        )
    }

    return (
        <>
            <Card className={`p-4 ${action.enabled ? 'bg-white' : 'bg-gray-50 opacity-75'}`}>
                <div className="space-y-4">
                    {/* 头部信息 */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <Hash className="h-4 w-4 text-gray-400" />
                                <span className="text-sm font-medium text-gray-500">#{action.executionOrder}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Settings className="h-4 w-4 text-blue-500" />
                                <span className="font-medium">{action.pluginName}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {action.enabled ? (
                                    <ToggleRight className="h-4 w-4 text-green-500" />
                                ) : (
                                    <ToggleLeft className="h-4 w-4 text-gray-400" />
                                )}
                                <Switch
                                    checked={action.enabled}
                                    onCheckedChange={handleToggleEnabled}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onMove('up')}
                                disabled={index === 0}
                            >
                                <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onMove('down')}
                                disabled={index === totalCount - 1}
                            >
                                <ChevronDown className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onDelete}
                                className="text-red-500 hover:text-red-700"
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* 插件选择 */}
                    <div className="space-y-2">
                        <Label htmlFor={`plugin-${action.id}`}>动作插件</Label>
                        <Select value={action.pluginId} onValueChange={handlePluginChange}>
                            <SelectTrigger id={`plugin-${action.id}`}>
                                <SelectValue placeholder="选择动作插件" />
                            </SelectTrigger>
                            <SelectContent>
                                {availablePlugins.map((plugin) => (
                                    <SelectItem key={plugin.id} value={plugin.id}>
                                        <div className="flex flex-col">
                                            <span>{plugin.name}</span>
                                            <span className="text-xs text-gray-500">{plugin.description}</span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* 插件信息 */}
                    {currentPlugin && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                                <div className="flex-1">
                                    <p className="text-sm text-gray-700 dark:text-gray-300">
                                        {currentPlugin.description}
                                    </p>
                                    <div className="flex gap-2 mt-2">
                                        {currentPlugin.supportedEventTypes.map((type) => (
                                            <Badge key={type} variant="secondary" className="text-xs">
                                                {type}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 配置区域 */}
                    {pluginData && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>插件配置</Label>
                                <Badge variant="secondary" className="text-xs">
                                    {pluginData.info.name}
                                </Badge>
                            </div>

                            {/* 字段网格布局 */}
                            <TooltipProvider delayDuration={200}>
                                <div className="grid grid-cols-12 gap-3">
                                    {pluginData.schema.fields.filter(shouldShowField).map(field => (
                                        <div key={field.name} className={getFieldClass(field.width)}>
                                            <label className="flex items-center gap-1 text-xs font-medium text-gray-700 mb-1">
                                                <span>{field.label}</span>
                                                {field.required && <span className="text-red-500">*</span>}
                                                {field.tooltip && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <button type="button" className="inline-flex items-center justify-center w-4 h-4 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                                                                <HelpCircle className="w-3.5 h-3.5" />
                                                            </button>
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" className="max-w-sm p-3 text-sm whitespace-pre-line">
                                                            <p>{field.tooltip}</p>
                                                            {field.help_url && (
                                                                <a
                                                                    href={field.help_url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="mt-2 inline-block text-blue-500 hover:text-blue-700 text-xs"
                                                                >
                                                                    查看帮助文档 →
                                                                </a>
                                                            )}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                )}
                                            </label>
                                            {renderField(field)}
                                            {field.description && (
                                                <p className="text-xs text-gray-500 mt-1">{field.description}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </TooltipProvider>

                            {/* 帮助文本 */}
                            {pluginData.schema.help_text && (
                                <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-600">
                                    {pluginData.schema.help_text}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 当前配置预览 */}
                    {Object.keys(action.config).length > 0 && (
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                            <Label className="text-xs text-gray-500 mb-2 block">当前配置</Label>
                            <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                {JSON.stringify(action.config, null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            </Card>

            {/* Code Editor Modal */}
            {
                codeEditorField && (
                    <CodeEditorModal
                        open={codeEditorOpen}
                        onOpenChange={setCodeEditorOpen}
                        language={codeEditorLanguage}
                        code={action.config[codeEditorField.name] || ''}
                        onCodeChange={(code) => handleFieldChange(codeEditorField.name, code)}
                        title={`编辑 ${codeEditorField.label}`}
                        customExamples={codeEditorField.examples}
                        customDocumentation={codeEditorField.documentation}
                    />
                )
            }
        </>
    )
}