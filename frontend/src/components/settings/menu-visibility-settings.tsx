'use client'

import { useState, useEffect } from 'react'
import {
    menuRegistry, groupNames, isMenuVisible,
    setMenuVisibility, setMenuVisibilityBatch,
    resetMenuVisibility, subscribeMenuVisibility,
    MenuItemConfig
} from '@/lib/menu-config'
import { cn } from '@/lib/utils'
import {
    LayoutGrid, Eye, EyeOff, RotateCcw, Lock, ChevronDown
} from 'lucide-react'
import { toast } from 'sonner'

export function MenuVisibilitySettings() {
    const [version, setVersion] = useState(0)
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
        main: true,
        admin: true,
        trigger: false,
        plugin: false,
        developer: false,
    })

    // 订阅变化（来自其他窗口等）
    useEffect(() => {
        return subscribeMenuVisibility(() => setVersion(v => v + 1))
    }, [])

    const handleToggle = (menuId: string, visible: boolean) => {
        setMenuVisibility(menuId, visible)
        setVersion(v => v + 1)
    }

    // 整组切换
    const handleToggleGroup = (items: MenuItemConfig[], visible: boolean) => {
        const updates: Record<string, boolean> = {}
        items.forEach(item => {
            if (!item.locked) updates[item.id] = visible
        })
        setMenuVisibilityBatch(updates)
        setVersion(v => v + 1)
    }

    const handleReset = () => {
        resetMenuVisibility()
        setVersion(v => v + 1)
        toast.success('菜单配置已重置为默认值')
    }

    const toggleGroup = (group: string) => {
        setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }))
    }

    // 按组分组
    const groups = Object.entries(groupNames).map(([key, name]) => ({
        key,
        name,
        items: menuRegistry.filter(m => m.group === key),
    }))

    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            {/* 标题 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                    <LayoutGrid className="h-5 w-5 text-blue-500" />
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">菜单管理</h2>
                </div>
                <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                    <RotateCcw className="h-3 w-3" />
                    重置默认
                </button>
            </div>

            <div className="p-4 space-y-3">
                <p className="text-xs text-gray-400 dark:text-gray-500 px-2">
                    控制侧边栏菜单项的显示与隐藏。带锁标记的菜单项为必要项，无法隐藏。
                </p>

                {groups.map(({ key, name, items }) => {
                    if (items.length === 0) return null
                    const expanded = expandedGroups[key] ?? false
                    const toggleableItems = items.filter(m => !m.locked)
                    const visibleCount = items.filter(m => isMenuVisible(m.id)).length
                    const allToggleableVisible = toggleableItems.length > 0 && toggleableItems.every(m => isMenuVisible(m.id))
                    const hasToggleable = toggleableItems.length > 0

                    return (
                        <div key={key} className="rounded-lg border border-gray-100 dark:border-gray-700/50 overflow-hidden">
                            {/* 组标题 */}
                            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50">
                                <button
                                    onClick={() => toggleGroup(key)}
                                    className="flex items-center gap-2 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                                >
                                    <ChevronDown className={cn(
                                        'h-3.5 w-3.5 text-gray-400 transition-transform duration-200',
                                        expanded ? 'rotate-0' : '-rotate-90'
                                    )} />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{name}</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                        {visibleCount}/{items.length}
                                    </span>
                                </button>

                                {/* 整组开关 */}
                                {hasToggleable && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleToggleGroup(items, !allToggleableVisible)
                                        }}
                                        className={cn(
                                            'relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0',
                                            allToggleableVisible
                                                ? 'bg-blue-500'
                                                : 'bg-gray-200 dark:bg-gray-600'
                                        )}
                                        title={allToggleableVisible ? '关闭整组' : '开启整组'}
                                    >
                                        <span className={cn(
                                            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                                            allToggleableVisible ? 'left-[18px]' : 'left-0.5'
                                        )} />
                                    </button>
                                )}
                            </div>

                            {/* 菜单项列表 */}
                            <div className={cn(
                                'overflow-hidden transition-all duration-200',
                                expanded ? 'max-h-[600px]' : 'max-h-0'
                            )}>
                                <div className="divide-y divide-gray-50 dark:divide-gray-700/30">
                                    {items.map(item => {
                                        const visible = isMenuVisible(item.id)
                                        return (
                                            <div
                                                key={item.id}
                                                className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors"
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    {item.locked ? (
                                                        <Lock className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
                                                    ) : visible ? (
                                                        <Eye className="h-3.5 w-3.5 text-blue-400" />
                                                    ) : (
                                                        <EyeOff className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600" />
                                                    )}
                                                    <span className={cn(
                                                        'text-sm',
                                                        visible
                                                            ? 'text-gray-700 dark:text-gray-300'
                                                            : 'text-gray-400 dark:text-gray-500 line-through'
                                                    )}>
                                                        {item.name}
                                                    </span>
                                                </div>

                                                {item.locked ? (
                                                    <span className="text-[10px] text-gray-400 dark:text-gray-500">必要</span>
                                                ) : (
                                                    <button
                                                        onClick={() => handleToggle(item.id, !visible)}
                                                        className={cn(
                                                            'relative w-9 h-5 rounded-full transition-colors duration-200',
                                                            visible
                                                                ? 'bg-blue-500'
                                                                : 'bg-gray-200 dark:bg-gray-600'
                                                        )}
                                                    >
                                                        <span className={cn(
                                                            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                                                            visible ? 'left-[18px]' : 'left-0.5'
                                                        )} />
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
