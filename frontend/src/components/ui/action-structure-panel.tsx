'use client'

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
    Map,
    ChevronRight,
    ChevronDown,
    Zap,
    GitBranch,
    Filter,
    Layers,
    X,
    Minimize2,
    Maximize2,
    GripVertical,
    Target
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// 动作结构节点
interface ActionNode {
    id: string
    type: 'action' | 'branch' | 'condition' | 'else'
    label: string
    pluginId?: string
    pluginName?: string
    description?: string
    children?: ActionNode[]
    collapsed?: boolean
    enabled?: boolean
}

// 从动作配置中提取结构
function extractActionStructure(actions: any[]): ActionNode[] {
    if (!actions || !Array.isArray(actions)) return []

    return actions.map((action, index) => {
        const node: ActionNode = {
            id: action.id || `action-${index}`,
            type: 'action',
            label: action.description || action.alias || action.pluginName || `动作 ${index + 1}`,
            pluginId: action.pluginId,
            pluginName: action.pluginName,
            enabled: action.enabled !== false
        }

        // 处理条件分支
        if (action.pluginId === 'conditional_branch_action' && action.config?.branches) {
            node.children = action.config.branches.map((branch: any, branchIndex: number) => {
                const branchNode: ActionNode = {
                    id: branch.id || `branch-${branchIndex}`,
                    type: 'branch',
                    label: branch.name || `分支 ${branchIndex + 1}`,
                    description: branch.description,
                    collapsed: branch.collapsed,
                    children: []
                }

                // 分支内的动作
                if (branch.actions && branch.actions.length > 0) {
                    branchNode.children = extractActionStructure(branch.actions)
                }

                return branchNode
            })

            // 添加 else 分支 - 始终显示，无论是否有动作
            node.children = node.children || []
            node.children.push({
                id: `${action.id}-else`,
                type: 'else',
                label: action.config.else_name || 'ELSE',
                description: action.config.else_description,
                children: action.config.else_actions && action.config.else_actions.length > 0
                    ? extractActionStructure(action.config.else_actions)
                    : []
            })
        }

        // 处理并行动作
        if (action.pluginId === 'parallel_actions' && action.config?.actions) {
            node.children = extractActionStructure(action.config.actions)
        }

        return node
    })
}

// 检查节点是否在选中路径上（包含选中节点或其祖先）
function isNodeInSelectedPath(node: ActionNode, selectedId: string | undefined): boolean {
    if (!selectedId) return false
    if (node.id === selectedId) return true
    if (node.children) {
        return node.children.some(child => isNodeInSelectedPath(child, selectedId))
    }
    return false
}

// 单个节点渲染
function StructureNode({
    node,
    level = 0,
    selectedId,
    onSelect,
    expandedNodes,
    onToggleExpand
}: {
    node: ActionNode
    level?: number
    selectedId?: string
    onSelect?: (id: string, path: string[]) => void
    expandedNodes: Set<string>
    onToggleExpand: (id: string) => void
}) {
    const hasChildren = node.children && node.children.length > 0
    const isExpanded = expandedNodes.has(node.id)
    const isSelected = selectedId === node.id
    const isInPath = isNodeInSelectedPath(node, selectedId)

    const getIcon = () => {
        switch (node.type) {
            case 'branch':
                return <GitBranch className="h-3 w-3 text-blue-500" />
            case 'else':
                return <GitBranch className="h-3 w-3 text-orange-500" />
            case 'condition':
                return <Filter className="h-3 w-3 text-purple-500" />
            default:
                return <Zap className="h-3 w-3 text-green-500" />
        }
    }

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (hasChildren) {
            onToggleExpand(node.id)
        }
        onSelect?.(node.id, [])
    }

    return (
        <div className="select-none">
            <div
                className={cn(
                    'flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-all duration-200',
                    'hover:bg-gray-100 dark:hover:bg-gray-800',
                    // 选中状态 - 强高亮
                    isSelected && 'bg-blue-500 text-white ring-2 ring-blue-400 ring-offset-1 shadow-md',
                    // 在选中路径上但不是选中节点 - 弱高亮
                    !isSelected && isInPath && 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-400',
                    !node.enabled && node.type === 'action' && 'opacity-50'
                )}
                style={{ paddingLeft: `${level * 12 + 8}px` }}
                onClick={handleClick}
            >
                {/* 展开/折叠按钮 */}
                {hasChildren ? (
                    <button
                        className={cn(
                            "p-0.5 rounded transition-colors",
                            isSelected ? "hover:bg-blue-400" : "hover:bg-gray-200 dark:hover:bg-gray-700"
                        )}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleExpand(node.id);
                            onSelect?.(node.id, []);
                        }}
                    >
                        {isExpanded ? (
                            <ChevronDown className={cn("h-3 w-3", isSelected ? "text-white" : "text-gray-500")} />
                        ) : (
                            <ChevronRight className={cn("h-3 w-3", isSelected ? "text-white" : "text-gray-500")} />
                        )}
                    </button>
                ) : (
                    <span className="w-4" />
                )}

                {/* 图标 */}
                <span className={isSelected ? "text-white" : ""}>
                    {getIcon()}
                </span>

                {/* 标签 */}
                <span className={cn(
                    'truncate flex-1 font-medium',
                    !isSelected && node.type === 'branch' && 'text-blue-600 dark:text-blue-400',
                    !isSelected && node.type === 'else' && 'text-orange-600 dark:text-orange-400',
                    isSelected && 'text-white'
                )}>
                    {node.type === 'branch' && 'IF: '}
                    {node.label}
                </span>

                {/* 选中指示器 */}
                {isSelected && (
                    <Target className="h-3 w-3 text-white animate-pulse" />
                )}

                {/* 子节点数量 */}
                {hasChildren && !isSelected && (
                    <Badge variant="secondary" className="h-4 text-[10px] px-1">
                        {node.children!.length}
                    </Badge>
                )}
            </div>

            {/* 子节点 */}
            {hasChildren && isExpanded && (
                <div className="relative">
                    {/* 连接线 */}
                    <div
                        className={cn(
                            "absolute left-0 top-0 bottom-0 border-l-2 transition-colors",
                            isInPath ? "border-blue-300 dark:border-blue-600" : "border-gray-200 dark:border-gray-700"
                        )}
                        style={{ marginLeft: `${level * 12 + 14}px` }}
                    />
                    {node.children!.map((child) => (
                        <StructureNode
                            key={child.id}
                            node={child}
                            level={level + 1}
                            selectedId={selectedId}
                            onSelect={onSelect}
                            expandedNodes={expandedNodes}
                            onToggleExpand={onToggleExpand}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

// 嵌入式面板组件（固定显示在页面中）
interface EmbeddedActionStructurePanelProps {
    actions: any[]
    selectedActionId?: string
    onActionSelect?: (id: string) => void
    onScrollToAction?: (id: string) => void
    className?: string
    defaultExpanded?: boolean
}

export function EmbeddedActionStructurePanel({
    actions,
    selectedActionId,
    onActionSelect,
    onScrollToAction,
    className,
    defaultExpanded = true
}: EmbeddedActionStructurePanelProps) {
    const [isMinimized, setIsMinimized] = useState(!defaultExpanded)
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

    // 提取动作结构
    const structure = useMemo(() => extractActionStructure(actions), [actions])

    // 统计节点数量
    const nodeCount = useMemo(() => {
        let count = 0
        const countNodes = (nodes: ActionNode[]) => {
            nodes.forEach(node => {
                count++
                if (node.children) {
                    countNodes(node.children)
                }
            })
        }
        countNodes(structure)
        return count
    }, [structure])

    // 自动展开所有节点
    useEffect(() => {
        const allIds = new Set<string>()
        const collectIds = (nodes: ActionNode[]) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) {
                    allIds.add(node.id)
                    collectIds(node.children)
                }
            })
        }
        collectIds(structure)
        setExpandedNodes(allIds)
    }, [structure])

    // 当选中节点变化时，确保其所有祖先节点都展开
    useEffect(() => {
        if (!selectedActionId) return

        const expandParents = (nodes: ActionNode[], targetId: string): boolean => {
            for (const node of nodes) {
                if (node.id === targetId) return true
                if (node.children) {
                    if (expandParents(node.children, targetId)) {
                        setExpandedNodes(prev => new Set([...prev, node.id]))
                        return true
                    }
                }
            }
            return false
        }

        expandParents(structure, selectedActionId)
    }, [selectedActionId, structure])

    // 切换节点展开状态
    const handleToggleExpand = useCallback((id: string) => {
        setExpandedNodes(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }, [])

    // 处理节点选择
    const handleSelect = useCallback((id: string) => {
        onActionSelect?.(id)
        // 触发滚动到目标元素
        onScrollToAction?.(id)
    }, [onActionSelect, onScrollToAction])

    // 全部展开/折叠
    const expandAll = () => {
        const allIds = new Set<string>()
        const collectIds = (nodes: ActionNode[]) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) {
                    allIds.add(node.id)
                    collectIds(node.children)
                }
            })
        }
        collectIds(structure)
        setExpandedNodes(allIds)
    }

    const collapseAll = () => {
        setExpandedNodes(new Set())
    }

    if (structure.length === 0) {
        return null
    }

    return (
        <div className={cn(
            'bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm',
            'flex flex-col overflow-hidden',
            className
        )}>
            {/* 标题栏 */}
            <div
                className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 cursor-pointer"
                onClick={() => setIsMinimized(!isMinimized)}
            >
                <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-blue-500" />
                    <span className="text-sm font-medium">动作结构</span>
                    <Badge variant="secondary" className="h-4 text-[10px] px-1">
                        {nodeCount}
                    </Badge>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                            e.stopPropagation()
                            setIsMinimized(!isMinimized)
                        }}
                    >
                        {isMinimized ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronRight className="h-3 w-3 rotate-90" />
                        )}
                    </Button>
                </div>
            </div>

            {/* 工具栏 */}
            {!isMinimized && (
                <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-100 dark:border-gray-800">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={expandAll}
                    >
                        全部展开
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={collapseAll}
                    >
                        全部折叠
                    </Button>
                </div>
            )}

            {/* 内容区域 */}
            {!isMinimized && (
                <div className="flex-1 overflow-auto p-2 max-h-[300px]">
                    {structure.map((node) => (
                        <StructureNode
                            key={node.id}
                            node={node}
                            selectedId={selectedActionId}
                            onSelect={handleSelect}
                            expandedNodes={expandedNodes}
                            onToggleExpand={handleToggleExpand}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

// 悬浮面板组件（保留原有功能）
interface ActionStructurePanelProps {
    actions: any[]
    selectedActionId?: string
    onActionSelect?: (id: string) => void
    onScrollToAction?: (id: string) => void
    className?: string
}

export function ActionStructurePanel({
    actions,
    selectedActionId,
    onActionSelect,
    onScrollToAction,
    className
}: ActionStructurePanelProps) {
    const [isVisible, setIsVisible] = useState(false)
    const [isMinimized, setIsMinimized] = useState(false)
    const [position, setPosition] = useState({ x: 20, y: 150 })
    const [size, setSize] = useState({ width: 280, height: 400 })
    const [isDragging, setIsDragging] = useState(false)
    const [isResizing, setIsResizing] = useState(false)
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

    const panelRef = useRef<HTMLDivElement>(null)

    // 提取动作结构
    const structure = useMemo(() => extractActionStructure(actions), [actions])

    // 统计节点数量
    const nodeCount = useMemo(() => {
        let count = 0
        const countNodes = (nodes: ActionNode[]) => {
            nodes.forEach(node => {
                count++
                if (node.children) {
                    countNodes(node.children)
                }
            })
        }
        countNodes(structure)
        return count
    }, [structure])


    // 自动展开所有节点
    useEffect(() => {
        const allIds = new Set<string>()
        const collectIds = (nodes: ActionNode[]) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) {
                    allIds.add(node.id)
                    collectIds(node.children)
                }
            })
        }
        collectIds(structure)
        setExpandedNodes(allIds)
    }, [structure])

    // 当选中节点变化时，确保其所有祖先节点都展开
    useEffect(() => {
        if (!selectedActionId) return

        const expandParents = (nodes: ActionNode[], targetId: string): boolean => {
            for (const node of nodes) {
                if (node.id === targetId) return true
                if (node.children) {
                    if (expandParents(node.children, targetId)) {
                        setExpandedNodes(prev => new Set([...prev, node.id]))
                        return true
                    }
                }
            }
            return false
        }

        expandParents(structure, selectedActionId)
    }, [selectedActionId, structure])

    // 切换节点展开状态
    const handleToggleExpand = useCallback((id: string) => {
        setExpandedNodes(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }, [])

    // 处理节点选择
    const handleSelect = useCallback((id: string) => {
        onActionSelect?.(id)
        onScrollToAction?.(id)
    }, [onActionSelect, onScrollToAction])

    // 处理拖拽开始
    const handleDragStart = (e: React.MouseEvent) => {
        if (isResizing) return
        setIsDragging(true)
        setDragOffset({
            x: e.clientX - position.x,
            y: e.clientY - position.y
        })
    }

    // 处理拖拽移动
    useEffect(() => {
        if (!isDragging) return

        const handleMouseMove = (e: MouseEvent) => {
            setPosition({
                x: Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragOffset.x)),
                y: Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffset.y))
            })
        }

        const handleMouseUp = () => {
            setIsDragging(false)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging, dragOffset, size.width])

    // 处理调整大小
    const handleResizeStart = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsResizing(true)

        const startX = e.clientX
        const startY = e.clientY
        const startWidth = size.width
        const startHeight = size.height

        const handleMouseMove = (e: MouseEvent) => {
            setSize({
                width: Math.max(200, startWidth + (e.clientX - startX)),
                height: Math.max(200, startHeight + (e.clientY - startY))
            })
        }

        const handleMouseUp = () => {
            setIsResizing(false)
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    // 全部展开/折叠
    const expandAll = () => {
        const allIds = new Set<string>()
        const collectIds = (nodes: ActionNode[]) => {
            nodes.forEach(node => {
                if (node.children && node.children.length > 0) {
                    allIds.add(node.id)
                    collectIds(node.children)
                }
            })
        }
        collectIds(structure)
        setExpandedNodes(allIds)
    }

    const collapseAll = () => {
        setExpandedNodes(new Set())
    }

    return (
        <>
            {/* 触发按钮 - 固定在左上角 */}
            <Button
                variant={isVisible ? "default" : "outline"}
                size="sm"
                className={cn(
                    'fixed z-50 shadow-lg transition-all',
                    'top-20 left-6',
                    isVisible && 'bg-blue-500 hover:bg-blue-600 text-white',
                    className
                )}
                onClick={() => setIsVisible(!isVisible)}
            >
                <Map className="h-4 w-4 mr-1" />
                <span className="text-xs">结构图</span>
                {nodeCount > 0 && (
                    <Badge variant="secondary" className="ml-1 h-4 text-[10px] px-1">
                        {nodeCount}
                    </Badge>
                )}
            </Button>

            {/* 悬浮面板 */}
            {isVisible && (
                <div
                    ref={panelRef}
                    className={cn(
                        'fixed z-50 bg-white dark:bg-gray-900 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700',
                        'flex flex-col overflow-hidden',
                        isDragging && 'cursor-grabbing',
                        isResizing && 'cursor-se-resize'
                    )}
                    style={{
                        left: position.x,
                        top: position.y,
                        width: isMinimized ? 200 : size.width,
                        height: isMinimized ? 'auto' : size.height,
                        transition: isDragging || isResizing ? 'none' : 'width 0.2s, height 0.2s'
                    }}
                >
                    {/* 标题栏 */}
                    <div
                        className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 cursor-grab"
                        onMouseDown={handleDragStart}
                    >
                        <div className="flex items-center gap-2">
                            <GripVertical className="h-4 w-4 text-gray-400" />
                            <Layers className="h-4 w-4 text-blue-500" />
                            <span className="text-sm font-medium">动作结构</span>
                            <Badge variant="secondary" className="h-4 text-[10px] px-1">
                                {nodeCount}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => setIsMinimized(!isMinimized)}
                            >
                                {isMinimized ? (
                                    <Maximize2 className="h-3 w-3" />
                                ) : (
                                    <Minimize2 className="h-3 w-3" />
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-red-100 hover:text-red-500"
                                onClick={() => setIsVisible(false)}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                    </div>

                    {/* 工具栏 */}
                    {!isMinimized && (
                        <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-100 dark:border-gray-800">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs px-2"
                                onClick={expandAll}
                            >
                                全部展开
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs px-2"
                                onClick={collapseAll}
                            >
                                全部折叠
                            </Button>
                        </div>
                    )}

                    {/* 内容区域 */}
                    {!isMinimized && (
                        <div className="flex-1 overflow-auto p-2">
                            {structure.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                                    暂无动作
                                </div>
                            ) : (
                                structure.map((node) => (
                                    <StructureNode
                                        key={node.id}
                                        node={node}
                                        selectedId={selectedActionId}
                                        onSelect={handleSelect}
                                        expandedNodes={expandedNodes}
                                        onToggleExpand={handleToggleExpand}
                                    />
                                ))
                            )}
                        </div>
                    )}

                    {/* 调整大小手柄 */}
                    {!isMinimized && (
                        <div
                            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                            onMouseDown={handleResizeStart}
                        >
                            <svg
                                className="w-4 h-4 text-gray-300 dark:text-gray-600"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM22 14H20V12H22V14ZM18 18H16V16H18V18ZM14 22H12V20H14V22Z" />
                            </svg>
                        </div>
                    )}
                </div>
            )}
        </>
    )
}

// 导出 hooks 用于外部控制
export function useActionStructurePanel() {
    const [isVisible, setIsVisible] = useState(false)

    const show = useCallback(() => setIsVisible(true), [])
    const hide = useCallback(() => setIsVisible(false), [])
    const toggle = useCallback(() => setIsVisible(v => !v), [])

    return { isVisible, show, hide, toggle }
}
