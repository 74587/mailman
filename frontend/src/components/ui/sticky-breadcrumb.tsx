'use client'

import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { ChevronRight, ChevronDown, Layers, X, Home } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// 面包屑项接口
export interface BreadcrumbItem {
    id: string
    type: 'branch' | 'action' | 'condition' | 'group' | 'else' | 'root'
    label: string
    description?: string
    level: number
    parentId?: string  // 父级 ID，用于构建层级关系
}

// 选中路径上下文
interface SelectionBreadcrumbContextType {
    // 当前选中的面包屑路径
    selectedPath: BreadcrumbItem[]
    // 设置选中路径
    setSelectedPath: (path: BreadcrumbItem[]) => void
    // 选中一个元素（会自动构建路径）
    selectItem: (item: BreadcrumbItem, ancestors?: BreadcrumbItem[]) => void
    // 清除选中
    clearSelection: () => void
    // 导航到路径中的某个元素
    navigateToItem: (item: BreadcrumbItem) => void
    // 是否有选中
    hasSelection: boolean
}

const SelectionBreadcrumbContext = createContext<SelectionBreadcrumbContextType>({
    selectedPath: [],
    setSelectedPath: () => { },
    selectItem: () => { },
    clearSelection: () => { },
    navigateToItem: () => { },
    hasSelection: false
})

// 祖先路径上下文 - 用于在嵌套组件间传递父级信息
interface AncestorContextType {
    ancestors: BreadcrumbItem[]
}

const AncestorContext = createContext<AncestorContextType>({
    ancestors: []
})

// 使用选中面包屑上下文
export function useSelectionBreadcrumb() {
    return useContext(SelectionBreadcrumbContext)
}

// 使用祖先路径上下文
export function useAncestors() {
    return useContext(AncestorContext)
}

// 祖先路径提供者 - 用于嵌套层级
export function AncestorProvider({
    children,
    currentItem,
    skipFromPath = false // 如果为 true，则不将此项添加到面包屑路径中（用于容器类元素）
}: {
    children: React.ReactNode
    currentItem: BreadcrumbItem
    skipFromPath?: boolean
}) {
    const { ancestors } = useAncestors()

    // 如果 skipFromPath 为 true，则不添加当前项到祖先列表
    // 这用于容器类动作（如条件分支），因为分支名称已经足够表达层级
    const newAncestors = skipFromPath ? ancestors : [...ancestors, currentItem]

    return (
        <AncestorContext.Provider value={{ ancestors: newAncestors }}>
            {children}
        </AncestorContext.Provider>
    )
}

// 选中面包屑提供者
export function StickyBreadcrumbProvider({
    children,
    scrollContainerRef,
    onNavigate
}: {
    children: React.ReactNode
    scrollContainerRef?: React.RefObject<HTMLElement>
    onNavigate?: (item: BreadcrumbItem) => void
}) {
    const [selectedPath, setSelectedPath] = useState<BreadcrumbItem[]>([])

    // 选中一个元素
    const selectItem = useCallback((item: BreadcrumbItem, ancestors: BreadcrumbItem[] = []) => {
        // 构建完整路径：祖先 + 当前项
        const fullPath = [...ancestors, item].sort((a, b) => a.level - b.level)
        setSelectedPath(fullPath)
    }, [])

    // 清除选中
    const clearSelection = useCallback(() => {
        setSelectedPath([])
    }, [])

    // 导航到路径中的某个元素
    const navigateToItem = useCallback((item: BreadcrumbItem) => {
        // 截取路径到该元素
        const itemIndex = selectedPath.findIndex(p => p.id === item.id)
        if (itemIndex >= 0) {
            setSelectedPath(selectedPath.slice(0, itemIndex + 1))
        }
        // 触发外部导航回调
        onNavigate?.(item)
    }, [selectedPath, onNavigate])

    return (
        <SelectionBreadcrumbContext.Provider value={{
            selectedPath,
            setSelectedPath,
            selectItem,
            clearSelection,
            navigateToItem,
            hasSelection: selectedPath.length > 0
        }}>
            {/* 初始化祖先上下文为空 */}
            <AncestorContext.Provider value={{ ancestors: [] }}>
                {children}
            </AncestorContext.Provider>
        </SelectionBreadcrumbContext.Provider>
    )
}

// 可跟踪的包装器组件 - 简化版，仅用于传递层级信息
export function TrackableSectionRef({
    item,
    children
}: {
    item: Omit<BreadcrumbItem, 'element'>
    children: React.ReactNode
}) {
    // 这个组件现在只是一个透传包装器
    // 实际的选中逻辑由具体的编辑器组件处理
    return (
        <div data-breadcrumb-id={item.id} data-breadcrumb-level={item.level}>
            {children}
        </div>
    )
}

// 选中路径面包屑显示组件
export function StickyBreadcrumbBar({
    className = ''
}: {
    className?: string
}) {
    const { selectedPath, navigateToItem, clearSelection, hasSelection } = useSelectionBreadcrumb()

    if (!hasSelection) {
        return null
    }

    // 类型对应的样式
    const typeStyles: Record<string, { bg: string; text: string; icon: string }> = {
        root: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-300', icon: '🏠' },
        branch: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', icon: '🔀' },
        action: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', icon: '⚡' },
        condition: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', icon: '🔍' },
        group: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300', icon: '📁' },
        else: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', icon: '↪️' }
    }

    return (
        <div className={`sticky top-0 z-20 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 px-3 py-1.5 flex items-center gap-1 overflow-x-auto shadow-sm ${className}`}>
            <Layers className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 mr-1" />
            <span className="text-xs text-gray-500 mr-1">选中路径:</span>

            {selectedPath.map((item, index) => {
                const style = typeStyles[item.type] || typeStyles.group
                const isLast = index === selectedPath.length - 1
                return (
                    <React.Fragment key={item.id}>
                        {index > 0 && (
                            <ChevronRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
                        )}
                        <button
                            onClick={() => navigateToItem(item)}
                            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${style.bg} ${style.text} ${isLast ? 'ring-2 ring-offset-1 ring-blue-400' : 'hover:opacity-80'}`}
                            title={item.description || item.label}
                        >
                            <span className="text-[10px]">{style.icon}</span>
                            <span className="max-w-[120px] truncate">{item.label}</span>
                            {item.description && (
                                <span className="opacity-60 max-w-[80px] truncate hidden sm:inline">
                                    · {item.description}
                                </span>
                            )}
                        </button>
                    </React.Fragment>
                )
            })}

            {/* 清除选中按钮 */}
            <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                className="h-5 w-5 p-0 ml-2 flex-shrink-0"
                title="清除选中"
            >
                <X className="h-3 w-3 text-gray-400 hover:text-gray-600" />
            </Button>
        </div>
    )
}

// 描述输入组件 - 用于编辑描述信息
export function DescriptionInput({
    value,
    onChange,
    placeholder = '添加描述...',
    className = '',
    compact = false
}: {
    value?: string
    onChange: (value: string) => void
    placeholder?: string
    className?: string
    compact?: boolean
}) {
    const [isEditing, setIsEditing] = useState(false)
    const [localValue, setLocalValue] = useState(value || '')
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        setLocalValue(value || '')
    }, [value])

    const handleBlur = () => {
        setIsEditing(false)
        if (localValue !== value) {
            onChange(localValue)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            inputRef.current?.blur()
        } else if (e.key === 'Escape') {
            setLocalValue(value || '')
            setIsEditing(false)
        }
    }

    if (!isEditing && !value) {
        return (
            <button
                onClick={() => {
                    setIsEditing(true)
                    setTimeout(() => inputRef.current?.focus(), 0)
                }}
                className={`text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${compact ? 'text-[10px]' : 'text-xs'} ${className}`}
            >
                + {placeholder}
            </button>
        )
    }

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="text"
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className={`bg-transparent border-b border-gray-300 dark:border-gray-600 focus:border-blue-500 outline-none px-1 ${compact ? 'text-[10px]' : 'text-xs'} ${className}`}
                autoFocus
            />
        )
    }

    return (
        <button
            onClick={() => {
                setIsEditing(true)
                setTimeout(() => inputRef.current?.focus(), 0)
            }}
            className={`text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors truncate max-w-[200px] ${compact ? 'text-[10px]' : 'text-xs'} ${className}`}
            title={value}
        >
            {value}
        </button>
    )
}

// 折叠区域标题组件 - 带描述信息
export function CollapsibleHeader({
    title,
    description,
    onDescriptionChange,
    badge,
    collapsed,
    onCollapsedChange,
    icon,
    actions,
    className = '',
    compact = false
}: {
    title: string
    description?: string
    onDescriptionChange?: (description: string) => void
    badge?: React.ReactNode
    collapsed: boolean
    onCollapsedChange: (collapsed: boolean) => void
    icon?: React.ReactNode
    actions?: React.ReactNode
    className?: string
    compact?: boolean
}) {
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => onCollapsedChange(!collapsed)}
                className={`p-0 ${compact ? 'h-5 w-5' : 'h-7 w-7'}`}
            >
                {collapsed ? (
                    <ChevronRight className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                ) : (
                    <ChevronDown className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                )}
            </Button>

            {icon}

            <span className={`font-medium ${compact ? 'text-xs' : 'text-sm'}`}>
                {title}
            </span>

            {badge}

            {/* 描述信息 - 折叠时显示在标题旁边 */}
            {collapsed && description && (
                <span className={`text-gray-500 truncate max-w-[200px] ${compact ? 'text-[10px]' : 'text-xs'}`}>
                    · {description}
                </span>
            )}

            {/* 可编辑的描述 */}
            {!collapsed && onDescriptionChange && (
                <DescriptionInput
                    value={description}
                    onChange={onDescriptionChange}
                    compact={compact}
                    className="ml-2"
                />
            )}

            <div className="flex-1" />

            {actions}
        </div>
    )
}

// 辅助函数：创建面包屑项
export function createBreadcrumbItem(
    id: string,
    type: BreadcrumbItem['type'],
    label: string,
    level: number,
    options?: {
        description?: string
        parentId?: string
    }
): BreadcrumbItem {
    return {
        id,
        type,
        label,
        level,
        ...options
    }
}

// 兼容旧 API
export const useStickyBreadcrumb = useSelectionBreadcrumb
