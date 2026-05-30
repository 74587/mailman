'use client'

import { useEffect, useMemo, useState } from 'react'
import {
    closestCenter,
    DndContext,
    PointerSensor,
    type DragEndEvent,
    useSensor,
    useSensors,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
    getMenuOrder,
    getOrderedMenuRegistry,
    groupNames,
    isMenuVisible,
    loadMenuPreferencesFromServer,
    MenuItemConfig,
    resetMenuVisibility,
    saveMenuPreferencesToServer,
    setMenuOrder,
    setMenuVisibility,
    setMenuVisibilityBatch,
    subscribeMenuVisibility,
} from '@/lib/menu-config'
import { cn } from '@/lib/utils'
import {
    ChevronDown,
    Eye,
    EyeOff,
    GripVertical,
    LayoutGrid,
    Loader2,
    Lock,
    RotateCcw,
    Save,
} from 'lucide-react'
import { toast } from 'sonner'

export function MenuVisibilitySettings() {
    const [version, setVersion] = useState(0)
    const [saving, setSaving] = useState(false)
    const [loading, setLoading] = useState(true)
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        main: true,
        mail: true,
        business: true,
        admin: true,
        trigger: false,
        plugin: false,
        developer: false,
    })
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

    useEffect(() => {
        return subscribeMenuVisibility(() => setVersion(v => v + 1))
    }, [])

    useEffect(() => {
        loadMenuPreferencesFromServer()
            .catch(() => toast.warning('菜单偏好暂时从本地缓存读取'))
            .finally(() => setLoading(false))
    }, [])

    const persist = async (successText?: string) => {
        setSaving(true)
        try {
            await saveMenuPreferencesToServer()
            if (successText) toast.success(successText)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '保存菜单偏好失败')
        } finally {
            setSaving(false)
        }
    }

    const groups = useMemo(() => {
        version
        const registry = getOrderedMenuRegistry()
        return Object.entries(groupNames).map(([key, name]) => ({
            key,
            name,
            items: registry.filter(m => m.group === key),
        }))
    }, [version])

    const handleToggle = async (menuId: string, visible: boolean) => {
        setMenuVisibility(menuId, visible)
        setVersion(v => v + 1)
        await persist()
    }

    const handleToggleGroup = async (items: MenuItemConfig[], visible: boolean) => {
        const updates: Record<string, boolean> = {}
        items.forEach(item => {
            if (!item.locked) updates[item.id] = visible
        })
        setMenuVisibilityBatch(updates)
        setVersion(v => v + 1)
        await persist()
    }

    const handleDragEnd = async (event: DragEndEvent, groupItems: MenuItemConfig[]) => {
        const { active, over } = event
        if (!over || active.id === over.id) return

        const groupIds = groupItems.map(item => item.id)
        const oldIndex = groupIds.indexOf(String(active.id))
        const newIndex = groupIds.indexOf(String(over.id))
        if (oldIndex < 0 || newIndex < 0) return

        const nextGroupIds = arrayMove(groupIds, oldIndex, newIndex)
        const groupSet = new Set(groupIds)
        const currentOrder = getMenuOrder()
        const nextOrder: string[] = []
        let inserted = false

        currentOrder.forEach(id => {
            if (!groupSet.has(id)) {
                nextOrder.push(id)
                return
            }
            if (!inserted) {
                nextOrder.push(...nextGroupIds)
                inserted = true
            }
        })
        if (!inserted) nextOrder.push(...nextGroupIds)

        setMenuOrder(nextOrder)
        setVersion(v => v + 1)
        await persist('菜单顺序已保存')
    }

    const handleReset = async () => {
        resetMenuVisibility()
        setVersion(v => v + 1)
        await persist('菜单配置已重置为默认值')
    }

    return (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
                <div className="flex items-center gap-2">
                    <LayoutGrid className="h-5 w-5 text-blue-500" />
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">菜单管理</h2>
                    {(loading || saving) && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => persist('菜单偏好已保存')}
                        disabled={saving}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 disabled:opacity-60 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                        <Save className="h-3.5 w-3.5" />
                        保存
                    </button>
                    <button
                        onClick={handleReset}
                        disabled={saving}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 disabled:opacity-60 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        重置默认
                    </button>
                </div>
            </div>

            <div className="space-y-3 p-4">
                <p className="px-2 text-xs text-gray-400 dark:text-gray-500">
                    拖拽菜单项可调整侧边栏展示顺序；默认分组按工作台、邮箱运营、业务资料、自动化、系统与权限、扩展插件、文档与开发排列。带锁标记的菜单项为必要项，无法隐藏，但仍可排序。
                </p>

                {groups.map(({ key, name, items }) => {
                    if (items.length === 0) return null
                    const expanded = expandedGroups[key] ?? false
                    const toggleableItems = items.filter(m => !m.locked)
                    const visibleCount = items.filter(m => isMenuVisible(m.id)).length
                    const allToggleableVisible = toggleableItems.length > 0 && toggleableItems.every(m => isMenuVisible(m.id))
                    const hasToggleable = toggleableItems.length > 0

                    return (
                        <div key={key} className="overflow-hidden rounded-lg border border-gray-100 dark:border-gray-700/50">
                            <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5 dark:bg-gray-800/50">
                                <button
                                    onClick={() => setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }))}
                                    className="flex items-center gap-2 transition-colors hover:text-gray-900 dark:hover:text-gray-100"
                                >
                                    <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform duration-200', expanded ? 'rotate-0' : '-rotate-90')} />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{name}</span>
                                    <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                        {visibleCount}/{items.length}
                                    </span>
                                </button>

                                {hasToggleable && (
                                    <button
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            handleToggleGroup(items, !allToggleableVisible)
                                        }}
                                        className={cn('relative h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-200', allToggleableVisible ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600')}
                                        title={allToggleableVisible ? '关闭整组' : '开启整组'}
                                    >
                                        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200', allToggleableVisible ? 'left-[18px]' : 'left-0.5')} />
                                    </button>
                                )}
                            </div>

                            <div className={cn('overflow-hidden transition-all duration-200', expanded ? 'max-h-[760px]' : 'max-h-0')}>
                                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDragEnd(event, items)}>
                                    <SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
                                        <div className="divide-y divide-gray-50 dark:divide-gray-700/30">
                                            {items.map(item => (
                                                <SortableMenuItem key={item.id} item={item} onToggle={handleToggle} />
                                            ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function SortableMenuItem({
    item,
    onToggle,
}: {
    item: MenuItemConfig
    onToggle: (menuId: string, visible: boolean) => void
}) {
    const visible = isMenuVisible(item.id)
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item.id })
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'flex items-center justify-between bg-white px-4 py-2.5 transition-colors hover:bg-gray-50/70 dark:bg-gray-800 dark:hover:bg-gray-700/30',
                isDragging && 'relative z-10 shadow-lg ring-1 ring-blue-200 dark:ring-blue-900'
            )}
        >
            <div className="flex min-w-0 items-center gap-2.5">
                <button
                    className="cursor-grab rounded p-1 text-gray-300 transition hover:bg-gray-100 hover:text-gray-500 active:cursor-grabbing dark:hover:bg-gray-700"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                {item.locked ? (
                    <Lock className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
                ) : visible ? (
                    <Eye className="h-3.5 w-3.5 text-blue-400" />
                ) : (
                    <EyeOff className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
                )}
                <span className={cn('truncate text-sm', visible ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 line-through dark:text-gray-500')}>
                    {item.name}
                </span>
            </div>

            {item.locked ? (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">必要</span>
            ) : (
                <button
                    onClick={() => onToggle(item.id, !visible)}
                    className={cn('relative h-5 w-9 rounded-full transition-colors duration-200', visible ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600')}
                >
                    <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200', visible ? 'left-[18px]' : 'left-0.5')} />
                </button>
            )}
        </div>
    )
}
