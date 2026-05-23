import React, { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, List, Braces, FileText, Hash, ToggleLeft, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

interface JsonTreeSelectorProps {
    data: any
    onSelect?: (path: string, value: any) => void
    highlightPath?: string
    isSelecting?: boolean
    allowArraySelection?: boolean // 新增：是否允许选择数组节点
}

// Helper to escape path keys if needed (simple dot notation favored)
const buildPath = (parentPath: string, key: string) => {
    return parentPath ? `${parentPath}.${key}` : key
}

// 获取值类型图标
const getTypeIcon = (value: any) => {
    if (value === null) return <Circle className="h-3 w-3 text-gray-400" />
    if (Array.isArray(value)) return <List className="h-3 w-3 text-amber-500" />
    if (typeof value === 'object') return <Braces className="h-3 w-3 text-cyan-500" />
    if (typeof value === 'string') return <FileText className="h-3 w-3 text-green-500" />
    if (typeof value === 'number') return <Hash className="h-3 w-3 text-blue-500" />
    if (typeof value === 'boolean') return <ToggleLeft className="h-3 w-3 text-purple-500" />
    return null
}

// 获取值类型标签
const getTypeLabel = (value: any): string => {
    if (value === null) return 'null'
    if (Array.isArray(value)) return `array[${value.length}]`
    if (typeof value === 'object') return `object{${Object.keys(value).length}}`
    if (typeof value === 'string') return 'string'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    return typeof value
}

const JsonTreeNode = ({
    name,
    value,
    path,
    level = 0,
    onSelect,
    highlightPath,
    isSelecting,
    allowArraySelection = false
}: {
    name: string
    value: any
    path: string
    level?: number
    onSelect?: (path: string, value: any) => void
    highlightPath?: string
    isSelecting?: boolean
    allowArraySelection?: boolean
}) => {
    const [isExpanded, setIsExpanded] = useState(false)

    // Auto-expand if this node is part of the highlighted path
    useEffect(() => {
        if (highlightPath && highlightPath.startsWith(path)) {
            setIsExpanded(true)
        }
    }, [highlightPath, path])

    // Expand root items by default
    useEffect(() => {
        if (level === 0) setIsExpanded(true)
    }, [level])

    const isObject = value !== null && typeof value === 'object'
    const isArray = Array.isArray(value)

    // Exact match for highlighting
    const isHighlighted = highlightPath === path

    // 判断是否可选择
    const isSelectable = isSelecting && (
        !isObject || // 非对象类型始终可选
        (isArray && allowArraySelection) // 数组节点在启用 allowArraySelection 时可选
    )

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsExpanded(!isExpanded)
    }

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (isSelectable && onSelect) {
            onSelect(path, value)
        } else if (isObject) {
            handleToggle(e)
        }
    }

    // 预览数组内容
    const getArrayPreview = (arr: any[]) => {
        if (arr.length === 0) return '[]'
        if (arr.length <= 3) {
            return '[' + arr.map(v =>
                typeof v === 'string' ? `"${v.length > 15 ? v.substring(0, 15) + '...' : v}"` : String(v)
            ).join(', ') + ']'
        }
        const first = typeof arr[0] === 'string' ? `"${arr[0].substring(0, 10)}..."` : String(arr[0])
        return `[${first}, ... +${arr.length - 1}]`
    }

    return (
        <div className="font-mono text-sm select-none">
            <div
                className={cn(
                    "flex items-start py-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 transition-colors min-h-[28px]",
                    isHighlighted && "bg-yellow-100 dark:bg-yellow-900/50 ring-1 ring-yellow-400 dark:ring-yellow-600 font-medium",
                    isSelectable && "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30"
                )}
                style={{ paddingLeft: `${level * 16}px` }}
                onClick={handleClick}
            >
                <div className="flex-shrink-0 mt-0.5 w-4 mr-1">
                    {isObject ? (
                        <span onClick={handleToggle} className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center h-4 w-4 cursor-pointer">
                            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </span>
                    ) : null}
                </div>

                <div className="flex flex-1 items-center gap-1.5 min-w-0">
                    {/* 类型图标 */}
                    <span className="flex-shrink-0">{getTypeIcon(value)}</span>

                    {/* 字段名 */}
                    <span className={cn(
                        "text-purple-600 dark:text-purple-400 font-medium flex-shrink-0",
                        isHighlighted && "text-purple-700 dark:text-purple-300"
                    )}>
                        {name}
                    </span>

                    <span className="text-gray-400 flex-shrink-0">:</span>

                    {/* 值预览 */}
                    {!isObject ? (
                        <span className={cn(
                            "text-green-600 dark:text-green-400 font-medium truncate",
                            isHighlighted && "text-green-700 dark:text-green-300"
                        )}>
                            {typeof value === 'string'
                                ? (value.length > 50 ? `"${value.substring(0, 50)}..."` : `"${value}"`)
                                : JSON.stringify(value)
                            }
                        </span>
                    ) : isArray ? (
                        <span className="text-amber-600 dark:text-amber-400 text-xs truncate">
                            {getArrayPreview(value)}
                        </span>
                    ) : (
                        <span className="text-gray-400 text-xs">
                            {`{${Object.keys(value).length} 个属性}`}
                        </span>
                    )}

                    {/* 可选择标记 */}
                    {isArray && allowArraySelection && isSelecting && (
                        <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0 ml-auto flex-shrink-0 bg-amber-50 text-amber-700 border-amber-200"
                        >
                            可选择
                        </Badge>
                    )}
                </div>
            </div>

            {isObject && isExpanded && (
                <div>
                    {Object.entries(value).map(([key, val]) => (
                        <JsonTreeNode
                            key={key}
                            name={key}
                            value={val}
                            path={buildPath(path, key)}
                            level={level + 1}
                            onSelect={onSelect}
                            highlightPath={highlightPath}
                            isSelecting={isSelecting}
                            allowArraySelection={allowArraySelection}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

export function JsonTreeSelector({
    data,
    onSelect,
    highlightPath,
    isSelecting = false,
    allowArraySelection = false
}: JsonTreeSelectorProps) {
    if (!data || Object.keys(data).length === 0) {
        return (
            <div className="text-gray-500 text-sm p-8 text-center border-2 border-dashed rounded-lg bg-gray-50 dark:bg-gray-800/50">
                暂无数据预览
            </div>
        )
    }

    return (
        <div className="w-full h-full overflow-auto p-2 bg-white dark:bg-gray-950 rounded border border-gray-100 dark:border-gray-800">
            {/* 提示信息 */}
            {isSelecting && allowArraySelection && (
                <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 mb-2 flex items-center gap-2">
                    <List className="h-3 w-3" />
                    <span>数组字段也可以选择，支持使用数组操作符进行过滤</span>
                </div>
            )}

            {Object.entries(data).map(([key, value]) => (
                <JsonTreeNode
                    key={key}
                    name={key}
                    value={value}
                    path={key}
                    onSelect={onSelect}
                    highlightPath={highlightPath}
                    isSelecting={isSelecting}
                    allowArraySelection={allowArraySelection}
                />
            ))}
        </div>
    )
}
