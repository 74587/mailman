import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Trash2, ChevronDown, Puzzle, Play, CheckCircle2, XCircle, Loader2, Code2, FileText, Search, TrendingUp, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { ExpressionCondition } from './expression-condition'
import { PluginCondition } from './plugin-condition'
import { ExpressionPluginCondition } from './expression-plugin-condition'
import { ReadOnlyCondition } from './readonly-condition'
import { Badge } from '@/components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuLabel,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuPortal
} from '@/components/ui/dropdown-menu'
import { apiClient } from '@/lib/api-client'
import { filterTemplateService, FilterTemplateListItem } from '@/services/filter-template.service'
import { ScrollArea } from '@/components/ui/scroll-area'

// Expression engine definitions
const EXPRESSION_ENGINES = [
    { id: 'expr.javascript', name: 'JavaScript', description: 'Full JS syntax with ES6+' },
    { id: 'expr.cel', name: 'CEL', description: 'Safe expression language by Google' },
    { id: 'expr.go-template', name: 'Go Template', description: 'Go template with functions' },
    { id: 'expr.jsonpath', name: 'JSONPath', description: 'Query JSON data' }
]

const FILTER_TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
    common: '常用',
    security: '安全治理',
    header: '邮件头',
    sender: '发件人相关',
    content: '邮件内容',
    time: '时间相关',
    attachment: '附件相关',
    account: '账号相关',
    other: '其他'
}

interface EvaluationResult {
    expressionId: string
    result: boolean
    details?: any
    error?: string
    timestamp: number
}

// 全局缓存插件列表，避免重复请求
type PluginContext = 'trigger' | 'pickup' | 'interceptor'
let pluginsCacheByContext: Record<string, any[]> = {}
let pluginsFetchingByContext: Record<string, boolean> = {}
let pluginsPromiseByContext: Record<string, Promise<any[]> | null> = {}

const fetchPluginsOnce = async (pluginContext: PluginContext = 'trigger'): Promise<any[]> => {
    if (pluginsCacheByContext[pluginContext]) {
        return pluginsCacheByContext[pluginContext]
    }
    if (pluginsFetchingByContext[pluginContext] && pluginsPromiseByContext[pluginContext]) {
        return pluginsPromiseByContext[pluginContext]!
    }

    pluginsFetchingByContext[pluginContext] = true
    pluginsPromiseByContext[pluginContext] = (async () => {
        try {
            const data = await apiClient.get('/plugins/ui/schemas', {
                params: { type: 'condition', context: pluginContext }
            })
            const plugins = Object.entries(data).map(([id, plugin]: [string, any]) => ({
                id,
                name: plugin.info.name,
                description: plugin.info.description
            }))
            pluginsCacheByContext[pluginContext] = plugins
            return plugins
        } catch (error) {
            console.error('Failed to fetch plugins:', error)
            return []
        } finally {
            pluginsFetchingByContext[pluginContext] = false
        }
    })()

    return pluginsPromiseByContext[pluginContext]!
}

// 模板缓存
let templatesCache: FilterTemplateListItem[] | null = null
let templatesFetching = false

interface ExpressionGroupProps {
    expression: any
    onChange: (expression: any) => void
    onDelete?: () => void
    testData?: Record<string, any>
    isRoot?: boolean
    readOnly?: boolean
    onExpressionSelect?: (expression: any) => void
    onEvaluate?: (expressionId: string, expression: any) => Promise<void>
    evaluationResults?: Record<string, EvaluationResult>
    isEvaluating?: string | null
    pluginContext?: PluginContext
}

export function ExpressionGroup({
    expression,
    onChange,
    onDelete,
    testData = {},
    isRoot = false,
    readOnly = false,
    onExpressionSelect,
    onEvaluate,
    evaluationResults = {},
    isEvaluating,
    pluginContext = 'trigger'
}: ExpressionGroupProps) {
    const [availablePlugins, setAvailablePlugins] = useState<any[]>(pluginsCacheByContext[pluginContext] || [])
    const [templates, setTemplates] = useState<FilterTemplateListItem[]>(templatesCache || [])
    const [filteredTemplates, setFilteredTemplates] = useState<FilterTemplateListItem[]>([])
    const [templateSearch, setTemplateSearch] = useState('')
    const [loadingTemplates, setLoadingTemplates] = useState(false)
    const [applyingTemplate, setApplyingTemplate] = useState<number | null>(null)
    const isMounted = useRef(true)
    const searchInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        isMounted.current = true

        fetchPluginsOnce(pluginContext).then(plugins => {
            if (isMounted.current) {
                setAvailablePlugins(plugins)
            }
        })

        return () => {
            isMounted.current = false
        }
    }, [pluginContext])

    // 加载模板列表
    const loadTemplates = useCallback(async () => {
        if (templatesCache) {
            setTemplates(templatesCache)
            setFilteredTemplates(templatesCache)
            return
        }

        if (templatesFetching) return

        templatesFetching = true
        setLoadingTemplates(true)

        try {
            const response = await filterTemplateService.list({
                page: 1,
                pageSize: 100,
            })
            const items = response.items || []
            templatesCache = items
            if (isMounted.current) {
                setTemplates(items)
                setFilteredTemplates(items)
            }
        } catch (error) {
            console.error('加载模板失败:', error)
        } finally {
            templatesFetching = false
            if (isMounted.current) {
                setLoadingTemplates(false)
            }
        }
    }, [])

    // 搜索过滤模板
    useEffect(() => {
        if (!templateSearch.trim()) {
            setFilteredTemplates(templates)
            return
        }

        const query = templateSearch.toLowerCase()
        const filtered = templates.filter(t =>
            t.name.toLowerCase().includes(query) ||
            (t.description && t.description.toLowerCase().includes(query)) ||
            (t.category && t.category.toLowerCase().includes(query)) ||
            (t.tags && t.tags.some(tag => tag.toLowerCase().includes(query)))
        )
        setFilteredTemplates(filtered)
    }, [templateSearch, templates])

    // 应用模板
    const handleApplyTemplate = async (template: FilterTemplateListItem) => {
        setApplyingTemplate(template.id)

        try {
            // 获取完整的模板数据
            const fullTemplate = await filterTemplateService.get(template.id)

            // 增加使用次数（后台执行，不等待）
            filterTemplateService.incrementUsage(template.id).catch(() => { })

            // 获取模板中的条件
            let conditionsToAdd: any[] = []
            const templateExpressions = fullTemplate.expressions || []

            for (const expr of templateExpressions) {
                if (expr.type === 'group' && expr.conditions) {
                    conditionsToAdd = [...conditionsToAdd, ...expr.conditions]
                } else {
                    conditionsToAdd.push(expr)
                }
            }

            // 为每个条件生成新的ID
            const regenIds = (items: any[]): any[] => {
                return items.map(item => {
                    const newItem = {
                        ...item,
                        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                    }
                    if (newItem.conditions) {
                        newItem.conditions = regenIds(newItem.conditions)
                    }
                    return newItem
                })
            }

            const newConditions = regenIds(conditionsToAdd)

            // 合并到当前组的 conditions
            onChange({
                ...expression,
                conditions: [...(expression.conditions || []), ...newConditions]
            })
        } catch (error) {
            console.error('应用模板失败:', error)
        } finally {
            setApplyingTemplate(null)
        }
    }

    const handleOperatorChange = (operator: string) => {
        onChange({
            ...expression,
            operator
        })
    }

    const handleAddCondition = (pluginId?: string) => {
        const newCondition = pluginId ? {
            id: Date.now().toString(),
            type: 'plugin',
            pluginId,
            fields: {},
            not: false
        } : {
            id: Date.now().toString(),
            type: 'condition',
            field: '',
            operator: 'equals',
            value: ''
        }

        onChange({
            ...expression,
            conditions: [...(expression.conditions || []), newCondition]
        })
    }

    const handleAddExpressionCondition = (engineId: string) => {
        const newCondition = {
            id: Date.now().toString(),
            type: 'expression',
            pluginId: engineId,
            fields: {
                expression: ''
            },
            not: false
        }

        onChange({
            ...expression,
            conditions: [...(expression.conditions || []), newCondition]
        })
    }

    const handleAddGroup = () => {
        const newGroup = {
            id: Date.now().toString(),
            type: 'group',
            operator: 'and',
            conditions: []
        }

        onChange({
            ...expression,
            conditions: [...(expression.conditions || []), newGroup]
        })
    }

    const handleUpdateCondition = (index: number, updatedCondition: any) => {
        const newConditions = [...(expression.conditions || [])]
        newConditions[index] = updatedCondition
        onChange({
            ...expression,
            conditions: newConditions
        })
    }

    const handleDeleteCondition = (index: number) => {
        const newConditions = (expression.conditions || []).filter((_: any, i: number) => i !== index)
        onChange({
            ...expression,
            conditions: newConditions
        })
    }

    const operatorStyles = {
        and: {
            border: 'border-blue-200',
            bg: 'bg-blue-50/50',
            hover: 'hover:bg-blue-50',
            badge: 'bg-blue-100 text-blue-700 border-blue-200',
            connector: 'bg-blue-400'
        },
        or: {
            border: 'border-purple-200',
            bg: 'bg-purple-50/50',
            hover: 'hover:bg-purple-50',
            badge: 'bg-purple-100 text-purple-700 border-purple-200',
            connector: 'bg-purple-400'
        },
        not: {
            border: 'border-red-200',
            bg: 'bg-red-50/50',
            hover: 'hover:bg-red-50',
            badge: 'bg-red-100 text-red-700 border-red-200',
            connector: 'bg-red-400'
        }
    }

    const currentStyle = operatorStyles[expression.operator as keyof typeof operatorStyles] || operatorStyles.and

    // 处理组被点击
    const handleGroupClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (onExpressionSelect) {
            onExpressionSelect({
                id: expression.id,
                type: 'group',
                operator: expression.operator
            })
        }
    }

    return (
        <div
            className={`rounded-lg border ${currentStyle.border} ${currentStyle.bg} p-3 transition-all cursor-pointer hover:shadow-sm`}
            onClick={handleGroupClick}
        >
            {/* 组头部 - 更紧凑的设计 */}
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                    {readOnly ? (
                        <Badge variant="outline" className={`h-8 px-3 text-sm font-medium ${currentStyle.badge}`}>
                            {expression.operator === 'and' ? '并且' : expression.operator === 'or' ? '或者' : '非'}
                        </Badge>
                    ) : (
                        <Select value={expression.operator} onValueChange={handleOperatorChange}>
                            <SelectTrigger className="h-8 w-24 bg-white border-gray-200 text-sm font-medium">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="and">
                                    <span className="font-medium">并且</span>
                                </SelectItem>
                                <SelectItem value="or">
                                    <span className="font-medium">或者</span>
                                </SelectItem>
                                <SelectItem value="not">
                                    <span className="font-medium">非</span>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                    {(expression.conditions || []).length > 0 && (
                        <Badge variant="outline" className={`text-xs px-2 py-0.5 ${currentStyle.badge}`}>
                            {(expression.conditions || []).length} 个条件
                        </Badge>
                    )}
                    {/* 评估结果显示 */}
                    {evaluationResults[expression.id] && (
                        <Badge
                            variant="outline"
                            className={`text-xs px-2 py-0.5 ${evaluationResults[expression.id].result
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : 'bg-red-50 text-red-700 border-red-200'
                                }`}
                        >
                            {evaluationResults[expression.id].result ? (
                                <><CheckCircle2 className="h-3 w-3 mr-1" /> 通过</>
                            ) : (
                                <><XCircle className="h-3 w-3 mr-1" /> 不通过</>
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
                                onEvaluate(expression.id, expression)
                            }}
                            variant="ghost"
                            size="sm"
                            disabled={isEvaluating === expression.id}
                            className="h-7 w-7 p-0 hover:bg-green-50 hover:text-green-600"
                            title="运行评估"
                        >
                            {isEvaluating === expression.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Play className="h-3.5 w-3.5" />
                            )}
                        </Button>
                    )}
                    {!isRoot && !readOnly && (
                        <Button
                            onClick={onDelete}
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 hover:bg-red-50 hover:text-red-600"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </div>
            </div>

            {/* 条件列表 - 更紧凑的间距 */}
            {(expression.conditions || []).length > 0 && (
                <div className="space-y-2 ml-6 relative">
                    {/* 连接线 */}
                    <div className={`absolute left-[-16px] top-2 bottom-2 w-0.5 ${currentStyle.connector}`} />

                    {(expression.conditions || []).map((condition: any, index: number) => (
                        <div key={condition.id || index} className="relative">
                            {/* 连接点 */}
                            <div className={`absolute left-[-20px] top-4 w-2 h-2 rounded-full ${currentStyle.connector}`} />

                            {condition.type === 'group' ? (
                                <ExpressionGroup
                                    expression={condition}
                                    onChange={(updated) => handleUpdateCondition(index, updated)}
                                    onDelete={() => handleDeleteCondition(index)}
                                    testData={testData}
                                    readOnly={readOnly}
                                    onExpressionSelect={onExpressionSelect}
                                    onEvaluate={onEvaluate}
                                    evaluationResults={evaluationResults}
                                    isEvaluating={isEvaluating}
                                    pluginContext={pluginContext}
                                />
                            ) : readOnly ? (
                                // 只读模式下使用简化的只读组件
                                <ReadOnlyCondition condition={condition} />
                            ) : condition.type === 'expression' ? (
                                <ExpressionPluginCondition
                                    condition={condition}
                                    onChange={(updated) => handleUpdateCondition(index, updated)}
                                    onDelete={() => handleDeleteCondition(index)}
                                    testData={testData}
                                    onSelect={() => {
                                        if (onExpressionSelect) {
                                            onExpressionSelect({
                                                id: condition.id,
                                                type: 'expression',
                                                pluginId: condition.pluginId,
                                                fields: condition.fields
                                            })
                                        }
                                    }}
                                    onEvaluate={onEvaluate}
                                    evaluationResult={evaluationResults[condition.id]}
                                    isEvaluating={isEvaluating === condition.id}
                                />
                            ) : condition.type === 'plugin' ? (
                                <PluginCondition
                                    condition={condition}
                                    pluginId={condition.pluginId}
                                    onChange={(updated) => handleUpdateCondition(index, updated)}
                                    onDelete={() => handleDeleteCondition(index)}
                                    testData={testData}
                                    onSelect={() => {
                                        if (onExpressionSelect) {
                                            onExpressionSelect({
                                                id: condition.id,
                                                type: 'plugin',
                                                pluginId: condition.pluginId,
                                                fields: condition.fields
                                            })
                                        }
                                    }}
                                    onEvaluate={onEvaluate}
                                    evaluationResult={evaluationResults[condition.id]}
                                    isEvaluating={isEvaluating === condition.id}
                                    pluginContext={pluginContext}
                                />
                            ) : (
                                <ExpressionCondition
                                    condition={condition}
                                    onChange={(updated: any) => handleUpdateCondition(index, updated)}
                                    onDelete={() => handleDeleteCondition(index)}
                                    testData={testData}
                                    onSelect={() => {
                                        if (onExpressionSelect) {
                                            onExpressionSelect({
                                                id: condition.id,
                                                type: 'condition',
                                                field: condition.field,
                                                operator: condition.operator,
                                                value: condition.value
                                            })
                                        }
                                    }}
                                    onEvaluate={onEvaluate}
                                    evaluationResult={evaluationResults[condition.id]}
                                    isEvaluating={isEvaluating === condition.id}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* 添加按钮 - 更紧凑的设计 (只读模式下隐藏) */}
            {!readOnly && (
                <div className="flex gap-1.5 mt-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs bg-white hover:bg-gray-50 border border-gray-200"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <Plus className="h-3 w-3 mr-1" />
                                添加条件
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                            {/* 引入模板 - 子菜单形式，放在第一个位置 */}
                            <DropdownMenuLabel className="text-xs text-blue-600">模板</DropdownMenuLabel>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger
                                    className="flex items-start gap-2"
                                    onPointerEnter={() => {
                                        // 悬停时加载模板
                                        if (templates.length === 0 && !loadingTemplates) {
                                            loadTemplates()
                                        }
                                    }}
                                >
                                    <Sparkles className="h-3 w-3 mt-0.5 text-blue-500" />
                                    <div className="flex-1">
                                        <div className="font-medium text-sm">引入模板</div>
                                    </div>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent
                                        className="w-72 p-0"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {/* 搜索框 */}
                                        <div className="p-2 border-b">
                                            <div className="relative">
                                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                                                <Input
                                                    ref={searchInputRef}
                                                    placeholder="搜索模板..."
                                                    value={templateSearch}
                                                    onChange={(e) => setTemplateSearch(e.target.value)}
                                                    className="h-8 pl-8 text-sm"
                                                    onClick={(e) => e.stopPropagation()}
                                                    onKeyDown={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                        </div>

                                        {/* 模板列表 */}
                                        <ScrollArea className="h-[280px]">
                                            {loadingTemplates ? (
                                                <div className="flex items-center justify-center py-8">
                                                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                                                </div>
                                            ) : filteredTemplates.length === 0 ? (
                                                <div className="text-center py-8 text-sm text-gray-500">
                                                    {templateSearch ? '未找到匹配的模板' : '暂无模板'}
                                                </div>
                                            ) : (
                                                <div className="py-1">
                                                    {filteredTemplates.map(template => (
                                                        <DropdownMenuItem
                                                            key={template.id}
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleApplyTemplate(template)
                                                            }}
                                                            disabled={applyingTemplate === template.id}
                                                            className="flex flex-col items-start gap-0.5 py-2 px-3 cursor-pointer"
                                                        >
                                                            <div className="flex items-center gap-2 w-full">
                                                                {applyingTemplate === template.id ? (
                                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                                                ) : (
                                                                    <FileText className="h-3.5 w-3.5 text-blue-500" />
                                                                )}
                                                                <span className="font-medium text-sm truncate flex-1">
                                                                    {template.name}
                                                                </span>
                                                                {template.isBuiltin && (
                                                                    <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                                                        内置
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            {template.description && (
                                                                <div className="text-xs text-gray-500 truncate w-full pl-5">
                                                                    {template.description}
                                                                </div>
                                                            )}
                                                            <div className="flex items-center gap-1.5 pl-5 mt-0.5">
                                                                {template.category && (
                                                                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                                                                        {FILTER_TEMPLATE_CATEGORY_LABELS[template.category] || template.category}
                                                                    </Badge>
                                                                )}
                                                                {template.tags?.slice(0, 2).map(tag => (
                                                                    <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">
                                                                        {tag}
                                                                    </Badge>
                                                                ))}
                                                                <span className="text-[10px] text-gray-400 flex items-center gap-0.5 ml-auto">
                                                                    <TrendingUp className="h-2.5 w-2.5" />
                                                                    {template.usageCount}
                                                                </span>
                                                            </div>
                                                        </DropdownMenuItem>
                                                    ))}
                                                </div>
                                            )}
                                        </ScrollArea>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>

                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-xs">字段匹配器</DropdownMenuLabel>
                            <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation()
                                handleAddCondition()
                            }}>
                                <span className="font-medium">添加字段匹配条件</span>
                            </DropdownMenuItem>

                            {/* Expression Engines */}
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-xs text-purple-600">表达式引擎</DropdownMenuLabel>
                            {EXPRESSION_ENGINES.map(engine => (
                                <DropdownMenuItem
                                    key={engine.id}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleAddExpressionCondition(engine.id)
                                    }}
                                    className="flex items-start gap-2"
                                >
                                    <Code2 className="h-3 w-3 mt-0.5 text-purple-500" />
                                    <div className="flex-1">
                                        <div className="font-medium text-sm">{engine.name}</div>
                                        <div className="text-xs text-gray-500">{engine.description}</div>
                                    </div>
                                </DropdownMenuItem>
                            ))}

                            {availablePlugins.length > 0 && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuLabel className="text-xs">插件条件</DropdownMenuLabel>
                                    {availablePlugins.map(plugin => (
                                        <DropdownMenuItem
                                            key={plugin.id}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                handleAddCondition(plugin.id)
                                            }}
                                            className="flex items-start gap-2"
                                        >
                                            <Puzzle className="h-3 w-3 mt-0.5 text-gray-500" />
                                            <div className="flex-1">
                                                <div className="font-medium text-sm">{plugin.name}</div>
                                                {plugin.description && (
                                                    <div className="text-xs text-gray-500">{plugin.description}</div>
                                                )}
                                            </div>
                                        </DropdownMenuItem>
                                    ))}
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        onClick={(e) => {
                            e.stopPropagation()
                            handleAddGroup()
                        }}
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs bg-white hover:bg-gray-50 border border-gray-200"
                    >
                        <Plus className="h-3 w-3 mr-1" />
                        添加条件组
                    </Button>
                </div>
            )}
        </div>
    )
}
