'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    horizontalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { Trash2, GripVertical, Plus, Settings, Play, Loader2, CheckCircle, XCircle, Sparkles, Zap, Search, TrendingUp, FileText } from 'lucide-react'
import { actionTemplateService, ActionTemplateListItem, ActionConfig } from '@/services/action-template.service'
import { useStickyBreadcrumb, useAncestors, BreadcrumbItem } from '@/components/ui/sticky-breadcrumb'

// 模板缓存
let actionTemplatesCache: ActionTemplateListItem[] | null = null
let actionTemplatesFetching = false

interface AddActionDropdownProps {
    availablePlugins: Array<{
        id: string
        name: string
        description: string
    }>
    onAddAction: (pluginId: string) => void
    onAddActionsFromTemplate?: (actions: ActionConfig[], insertAtIndex?: number) => void
    insertAtIndex?: number
}

function AddActionDropdown({ availablePlugins, onAddAction, onAddActionsFromTemplate, insertAtIndex }: AddActionDropdownProps) {
    const [templates, setTemplates] = useState<ActionTemplateListItem[]>(actionTemplatesCache || [])
    const [filteredTemplates, setFilteredTemplates] = useState<ActionTemplateListItem[]>([])
    const [templateSearch, setTemplateSearch] = useState('')
    const [loadingTemplates, setLoadingTemplates] = useState(false)
    const [applyingTemplate, setApplyingTemplate] = useState<number | null>(null)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const isMounted = useRef(true)

    useEffect(() => {
        isMounted.current = true
        return () => { isMounted.current = false }
    }, [])

    // 加载模板列表
    const loadTemplates = useCallback(async () => {
        if (actionTemplatesCache) {
            setTemplates(actionTemplatesCache)
            setFilteredTemplates(actionTemplatesCache)
            return
        }

        if (actionTemplatesFetching) return

        actionTemplatesFetching = true
        setLoadingTemplates(true)

        try {
            const response = await actionTemplateService.list({
                page: 1,
                pageSize: 100,
            })
            const items = response.items || []
            actionTemplatesCache = items
            if (isMounted.current) {
                setTemplates(items)
                setFilteredTemplates(items)
            }
        } catch (error) {
            console.error('加载动作模板失败:', error)
        } finally {
            actionTemplatesFetching = false
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
    const handleApplyTemplate = async (template: ActionTemplateListItem) => {
        if (!onAddActionsFromTemplate) return

        setApplyingTemplate(template.id)

        try {
            // 获取完整的模板数据
            const fullTemplate = await actionTemplateService.get(template.id)

            // 增加使用次数（后台执行，不等待）
            actionTemplateService.incrementUsage(template.id).catch(() => { })

            // 调用回调添加动作
            onAddActionsFromTemplate(fullTemplate.actions, insertAtIndex)
        } catch (error) {
            console.error('应用动作模板失败:', error)
        } finally {
            setApplyingTemplate(null)
        }
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    className="min-w-[120px] h-[80px] border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50"
                >
                    <div className="flex flex-col items-center gap-1">
                        <Plus className="h-5 w-5" />
                        <span className="text-xs">添加动作</span>
                    </div>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                {/* 引入模板 - 子菜单形式，放在第一个位置 */}
                {onAddActionsFromTemplate && (
                    <>
                        <DropdownMenuLabel className="text-xs text-amber-600">模板</DropdownMenuLabel>
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
                                <Sparkles className="h-3 w-3 mt-0.5 text-amber-500" />
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
                                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
                                                            ) : (
                                                                <Zap className="h-3.5 w-3.5 text-amber-500" />
                                                            )}
                                                            <span className="font-medium text-sm truncate flex-1">
                                                                {template.name}
                                                            </span>
                                                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                                                                {template.actionCount} 个动作
                                                            </Badge>
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
                                                                    {template.category}
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
                    </>
                )}

                {/* 动作插件列表 */}
                <DropdownMenuLabel className="text-xs">动作插件</DropdownMenuLabel>
                {availablePlugins.length === 0 ? (
                    <div className="text-sm text-gray-500 p-2">
                        暂无可用的动作插件
                    </div>
                ) : (
                    availablePlugins.map((plugin) => (
                        <DropdownMenuItem
                            key={plugin.id}
                            onClick={() => onAddAction(plugin.id)}
                            className="flex items-start gap-2"
                        >
                            <Zap className="h-3 w-3 mt-0.5 text-green-500" />
                            <div className="flex-1">
                                <div className="font-medium text-sm">{plugin.name}</div>
                                {plugin.description && (
                                    <div className="text-xs text-gray-500">{plugin.description}</div>
                                )}
                            </div>
                        </DropdownMenuItem>
                    ))
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}


interface SortableActionCardProps {
    action: Action
    index: number
    isSelected: boolean
    isLast: boolean
    onSelect: (actionId: string) => void
    onToggleEnabled: (actionId: string, enabled: boolean) => void
    onDelete: (actionId: string) => void
    onExecute: (actionId: string) => void
    getActionSummary: (action: Action) => string
    executingActionId?: string
    executionResult?: { actionId: string; success: boolean; message?: string }
    readOnly?: boolean
}

function SortableActionCard({
    action,
    index,
    isSelected,
    isLast,
    onSelect,
    onToggleEnabled,
    onDelete,
    onExecute,
    getActionSummary,
    executingActionId,
    executionResult,
    readOnly = false
}: SortableActionCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: action.id })

    // 获取 sticky breadcrumb hooks
    const { selectItem } = useStickyBreadcrumb()
    const { ancestors } = useAncestors()

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    const isExecuting = executingActionId === action.id
    const hasResult = executionResult?.actionId === action.id
    const isSuccess = hasResult && executionResult?.success

    // 生成更有意义的面包屑标签
    const getActionLabel = (): string => {
        // 优先使用描述或别名
        if (action.description) return action.description
        if (action.alias) return action.alias
        // 使用插件名称，最后是执行顺序
        return action.pluginName || `动作 ${index + 1}`
    }

    // 判断是否是容器类动作（如条件分支），容器类动作不需要显示在面包屑中
    // 因为其内部的分支名称已经足够表达层级
    const isContainerAction = action.pluginId === 'conditional_branch_action' || action.pluginId === 'parallel_actions'

    // 创建当前动作的面包屑项
    const breadcrumbItem: BreadcrumbItem = {
        id: action.id,
        type: 'action' as const,
        label: getActionLabel(),
        description: action.pluginName, // 在描述中显示插件类型
        level: ancestors.length // 基于祖先数量确定层级
    }

    // 处理动作选中 - 同时更新面包屑路径，阻止事件冒泡
    const handleActionSelect = (e: React.MouseEvent) => {
        e.stopPropagation() // 阻止事件冒泡，确保只有当前动作更新面包屑

        // 容器类动作（如条件分支）不添加到面包屑，因为分支名称已经足够表达层级
        // 非容器动作才更新面包屑
        if (!isContainerAction) {
            selectItem(breadcrumbItem, ancestors)
        }

        // 调用原有的选中逻辑
        onSelect(action.id)
    }

    return (
        <div className="flex items-center gap-2">
            <Card
                ref={setNodeRef}
                style={style}
                data-action-id={action.id}
                className={`
                    min-w-[200px] p-3 cursor-pointer transition-all
                    ${isSelected
                        ? 'ring-2 ring-blue-500 bg-blue-50'
                        : 'hover:shadow-md'
                    }
                    ${!action.enabled ? 'opacity-60' : ''}
                    ${isDragging ? 'shadow-lg rotate-2' : ''}
                    ${hasResult && isSuccess ? 'ring-2 ring-green-500' : ''}
                    ${hasResult && !isSuccess ? 'ring-2 ring-red-500' : ''}
                `}
                onClick={handleActionSelect}
            >
                <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                        {/* 拖拽手柄 - 只读模式下隐藏 */}
                        {!readOnly && (
                            <div
                                {...attributes}
                                {...listeners}
                                className="cursor-grab hover:cursor-grabbing"
                            >
                                <GripVertical className="h-4 w-4 text-gray-400" />
                            </div>
                        )}
                        <Badge variant="outline" className="text-xs">
                            #{action.executionOrder}
                        </Badge>
                    </div>
                    {/* 操作按钮 - 只读模式下隐藏 */}
                    {!readOnly && (
                        <div className="flex items-center gap-1">
                            {/* 执行按钮 */}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelect(action.id);
                                    onExecute(action.id);
                                }}
                                disabled={isExecuting || !action.enabled}
                                className={`h-6 w-6 p-0 ${isExecuting ? 'animate-pulse' : ''}`}
                                title="执行此动作"
                            >
                                {isExecuting ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                                ) : hasResult ? (
                                    isSuccess ? (
                                        <CheckCircle className="h-3 w-3 text-green-500" />
                                    ) : (
                                        <XCircle className="h-3 w-3 text-red-500" />
                                    )
                                ) : (
                                    <Play className="h-3 w-3 text-green-600" />
                                )}
                            </Button>
                            <Switch
                                checked={action.enabled}
                                onCheckedChange={(enabled) => {
                                    onToggleEnabled(action.id, enabled)
                                    // 切换开关时也选中该动作，确保结构面板同步
                                    onSelect(action.id)
                                }}
                                className="scale-50 data-[state=checked]:bg-blue-500"
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onDelete(action.id)
                                }}
                                className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                            >
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    )}
                </div>
                <div>
                    <h4 className="font-medium text-sm mb-1">
                        {action.pluginName}
                    </h4>
                    {/* 描述信息 - 如果有的话优先显示 */}
                    {action.description ? (
                        <p className="text-xs text-gray-600" title={action.description}>
                            {action.description}
                        </p>
                    ) : (
                        <p className="text-xs text-gray-500">
                            {getActionSummary(action)}
                        </p>
                    )}
                    {/* 执行结果提示 */}
                    {hasResult && (
                        <p className={`text-xs mt-1 ${isSuccess ? 'text-green-600' : 'text-red-600'}`}>
                            {executionResult?.message || (isSuccess ? '执行成功' : '执行失败')}
                        </p>
                    )}
                </div>
            </Card>
            {!isLast && (
                <div className="text-gray-400">→</div>
            )}
        </div>
    )
}

interface Action {
    id: string
    pluginId: string
    pluginName: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
    description?: string // 通用描述字段
    alias?: string
}

interface ActionPipelineProps {
    actions: Action[]
    selectedActionId?: string
    availablePlugins: Array<{
        id: string
        name: string
        description: string
    }>
    onActionsChange: (actions: Action[]) => void
    onActionSelect: (actionId: string) => void
    onAddAction: (pluginId: string) => void
    onExecute: () => void
    onExecuteAction?: (action: Action) => Promise<{ success: boolean; message?: string }>
    isExecuting: boolean
    executingActionId?: string
    readOnly?: boolean
    onAddActionsFromTemplate?: (actions: ActionConfig[], insertAtIndex?: number) => void
}

export function ActionPipeline({
    actions,
    selectedActionId,
    availablePlugins,
    onActionsChange,
    onActionSelect,
    onAddAction,
    onExecute,
    onExecuteAction,
    isExecuting,
    executingActionId,
    readOnly = false,
    onAddActionsFromTemplate
}: ActionPipelineProps) {
    // 单个动作执行结果状态
    const [executionResult, setExecutionResult] = React.useState<{ actionId: string; success: boolean; message?: string } | undefined>()
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event

        if (over && active.id !== over.id) {
            const oldIndex = actions.findIndex(action => action.id === active.id)
            const newIndex = actions.findIndex(action => action.id === over.id)

            const updatedActions = arrayMove(actions, oldIndex, newIndex).map(
                (action, index) => ({
                    ...action,
                    executionOrder: index + 1
                })
            )

            onActionsChange(updatedActions)
        }
    }

    const handleToggleEnabled = (actionId: string, enabled: boolean) => {
        const updatedActions = actions.map(action =>
            action.id === actionId ? { ...action, enabled } : action
        )
        onActionsChange(updatedActions)
    }

    const handleDeleteAction = (actionId: string) => {
        const updatedActions = actions.filter(action => action.id !== actionId)
        onActionsChange(updatedActions)
    }

    const getDefaultConfigForPlugin = (pluginId: string): Record<string, any> => {
        switch (pluginId) {
            case 'email_transform_action':
                return {
                    target_field: 'subject',
                    transform_type: 'template'
                }
            case 'email_forward_action':
                return {
                    to_address: '',
                    subject_prefix: ''
                }
            case 'email_label_action':
                return {
                    operation: 'add',
                    labels: []
                }
            case 'email_delete_action':
                return {
                    permanent: false
                }
            default:
                return {}
        }
    }

    const handleAddActionAtStart = (pluginId: string) => {
        // 创建新动作，放在最前面
        const plugin = availablePlugins.find(p => p.id === pluginId)

        // 应用插件默认配置
        const defaultConfig = getDefaultConfigForPlugin(pluginId)

        const newAction: Action = {
            id: `action-${Date.now()}`,
            pluginId,
            pluginName: plugin?.name || pluginId,
            config: defaultConfig,
            enabled: true,
            executionOrder: 1
        }

        // 更新所有现有动作的执行顺序
        const updatedExistingActions = actions.map(action => ({
            ...action,
            executionOrder: action.executionOrder + 1
        }))

        // 合并新动作和现有动作
        const allActions = [newAction, ...updatedExistingActions]
        onActionsChange(allActions)
    }

    // 处理从模板导入动作
    const handleAddActionsFromTemplate = (templateActions: ActionConfig[], insertAtIndex?: number) => {
        // 为每个导入的动作生成新的 ID 并确保必填字段
        const newActions: Action[] = templateActions.map((action, i) => ({
            id: `${Date.now()}-${i}`,
            pluginId: action.pluginId,
            pluginName: action.pluginName || action.pluginId, // 如果没有 pluginName，使用 pluginId 作为默认值
            config: action.config || {},
            enabled: action.enabled ?? true,
            executionOrder: 0 // 将在下面重新计算
        }))

        let updatedActions: Action[]
        if (insertAtIndex !== undefined && insertAtIndex >= 0) {
            // 在指定位置插入
            const before = actions.slice(0, insertAtIndex)
            const after = actions.slice(insertAtIndex)
            updatedActions = [...before, ...newActions, ...after]
        } else {
            // 添加到末尾
            updatedActions = [...actions, ...newActions]
        }

        // 重新计算执行顺序
        updatedActions = updatedActions.map((action, i) => ({
            ...action,
            executionOrder: i + 1
        }))

        onActionsChange(updatedActions)

        // 通知父组件（如果有回调）
        onAddActionsFromTemplate?.(templateActions, insertAtIndex)
    }

    const getActionSummary = (action: Action) => {
        const { config } = action
        switch (action.pluginId) {
            case 'email_transform_action':
                const transformType = config.transform_type || 'template'
                const targetField = config.target_field || 'subject'
                return `${transformType} → ${targetField}`
            case 'email_forward_action':
                return `转发到 ${config.to_address || '未配置'}`
            default:
                return '未配置'
        }
    }

    return (
        <div className="bg-white border-b p-4">
            {/* 头部操作栏 */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Settings className="h-5 w-5 text-gray-500" />
                    <h3 className="text-lg font-semibold">动作流水线</h3>
                    <Badge variant="secondary" className="text-xs">
                        {actions.length} 个动作
                    </Badge>
                </div>
                {/* 执行按钮 - 只读模式下隐藏 */}
                {!readOnly && (
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={onExecute}
                            disabled={isExecuting || actions.length === 0}
                            className="bg-green-500 hover:bg-green-600"
                        >
                            {isExecuting ? '执行中...' : '执行动作'}
                        </Button>
                    </div>
                )}
            </div>

            {/* 动作流水线 */}
            <div className="overflow-x-auto overflow-y-visible">
                <div className="flex items-center gap-4 min-w-max py-4 px-3">
                    {actions.length === 0 ? (
                        /* 空状态 */
                        <div className="flex items-center justify-center w-full">
                            {readOnly ? (
                                <div className="text-gray-400 text-sm py-4">暂无动作</div>
                            ) : (
                                <AddActionDropdown
                                    availablePlugins={availablePlugins}
                                    onAddAction={onAddAction}
                                    onAddActionsFromTemplate={handleAddActionsFromTemplate}
                                />
                            )}
                        </div>
                    ) : (
                        /* 有动作时：显示前面和后面的按钮 */
                        <>
                            {/* 在最前面添加动作按钮 - 只读模式下隐藏 */}
                            {!readOnly && (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <AddActionDropdown
                                        availablePlugins={availablePlugins}
                                        onAddAction={handleAddActionAtStart}
                                        onAddActionsFromTemplate={(templateActions) => handleAddActionsFromTemplate(templateActions, 0)}
                                        insertAtIndex={0}
                                    />
                                    <div className="text-gray-400">→</div>
                                </div>
                            )}

                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={actions.map(action => action.id)}
                                    strategy={horizontalListSortingStrategy}
                                >
                                    <div className="flex items-center gap-4">
                                        {actions.map((action, index) => (
                                            <SortableActionCard
                                                key={action.id}
                                                action={action}
                                                index={index}
                                                isSelected={selectedActionId === action.id}
                                                isLast={index === actions.length - 1}
                                                onSelect={onActionSelect}
                                                onToggleEnabled={handleToggleEnabled}
                                                onDelete={handleDeleteAction}
                                                onExecute={async (actionId) => {
                                                    const actionToExecute = actions.find(a => a.id === actionId)
                                                    if (actionToExecute && onExecuteAction) {
                                                        const result = await onExecuteAction(actionToExecute)
                                                        setExecutionResult({ actionId, ...result })
                                                        // 3秒后清除结果
                                                        setTimeout(() => setExecutionResult(undefined), 3000)
                                                    }
                                                }}
                                                getActionSummary={getActionSummary}
                                                executingActionId={executingActionId}
                                                executionResult={executionResult}
                                                readOnly={readOnly}
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>

                            {/* 在末尾添加动作按钮 - 只读模式下隐藏 */}
                            {!readOnly && (
                                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                                    <div className="text-gray-400">→</div>
                                    <AddActionDropdown
                                        availablePlugins={availablePlugins}
                                        onAddAction={onAddAction}
                                        onAddActionsFromTemplate={handleAddActionsFromTemplate}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

