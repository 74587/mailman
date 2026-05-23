'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface ResizablePanelGroupProps {
    children: React.ReactNode
    direction: 'horizontal' | 'vertical'
    className?: string
}

interface ResizablePanelProps {
    children: React.ReactNode
    defaultSize?: number // 百分比
    minSize?: number // 百分比
    maxSize?: number // 百分比
    className?: string
}

interface ResizableHandleProps {
    className?: string
    onDrag?: (delta: number) => void
}

// 面板组
export function ResizablePanelGroup({ children, direction, className }: ResizablePanelGroupProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [sizes, setSizes] = useState<number[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const [dragIndex, setDragIndex] = useState<number | null>(null)
    const startPos = useRef(0)
    const startSizes = useRef<number[]>([])

    // 初始化尺寸
    useEffect(() => {
        const childArray = React.Children.toArray(children)
        const panelCount = childArray.filter(child =>
            React.isValidElement(child) && child.type === ResizablePanel
        ).length

        if (sizes.length === 0 && panelCount > 0) {
            const defaultSize = 100 / panelCount
            setSizes(Array(panelCount).fill(defaultSize))
        }
    }, [children, sizes.length])

    const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
        e.preventDefault()
        setIsDragging(true)
        setDragIndex(index)
        startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
        startSizes.current = [...sizes]
    }, [direction, sizes])

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || dragIndex === null || !containerRef.current) return

        const containerRect = containerRef.current.getBoundingClientRect()
        const containerSize = direction === 'horizontal' ? containerRect.width : containerRect.height
        const currentPos = direction === 'horizontal' ? e.clientX : e.clientY
        const delta = ((currentPos - startPos.current) / containerSize) * 100

        const newSizes = [...startSizes.current]
        const minSize = 10 // 最小 10%

        // 调整相邻两个面板的大小
        const newSize1 = startSizes.current[dragIndex] + delta
        const newSize2 = startSizes.current[dragIndex + 1] - delta

        if (newSize1 >= minSize && newSize2 >= minSize) {
            newSizes[dragIndex] = newSize1
            newSizes[dragIndex + 1] = newSize2
            setSizes(newSizes)
        }
    }, [isDragging, dragIndex, direction])

    const handleMouseUp = useCallback(() => {
        setIsDragging(false)
        setDragIndex(null)
    }, [])

    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
            document.body.style.userSelect = 'none'
        } else {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }
    }, [isDragging, handleMouseMove, handleMouseUp, direction])

    // 渲染子元素
    const renderChildren = () => {
        const childArray = React.Children.toArray(children)
        let panelIndex = 0
        const result: React.ReactNode[] = []

        childArray.forEach((child, i) => {
            if (React.isValidElement(child)) {
                if (child.type === ResizablePanel) {
                    const size = sizes[panelIndex] || (100 / sizes.length)
                    result.push(
                        React.cloneElement(child as React.ReactElement<any>, {
                            key: `panel-${panelIndex}`,
                            style: {
                                [direction === 'horizontal' ? 'width' : 'height']: `${size}%`,
                                flexShrink: 0,
                                overflow: 'hidden'
                            }
                        })
                    )
                    panelIndex++
                } else if (child.type === ResizableHandle) {
                    const handleIndex = panelIndex - 1
                    result.push(
                        React.cloneElement(child as React.ReactElement<any>, {
                            key: `handle-${handleIndex}`,
                            direction,
                            onMouseDown: (e: React.MouseEvent) => handleMouseDown(handleIndex, e),
                            isDragging: isDragging && dragIndex === handleIndex
                        })
                    )
                } else {
                    result.push(child)
                }
            }
        })

        return result
    }

    return (
        <div
            ref={containerRef}
            className={cn(
                'flex',
                direction === 'horizontal' ? 'flex-row' : 'flex-col',
                className
            )}
        >
            {renderChildren()}
        </div>
    )
}

// 面板
export function ResizablePanel({ children, className, ...props }: ResizablePanelProps & { style?: React.CSSProperties }) {
    return (
        <div className={cn('overflow-auto', className)} {...props}>
            {children}
        </div>
    )
}

// 拖拽手柄
export function ResizableHandle({
    className,
    direction = 'horizontal',
    onMouseDown,
    isDragging = false
}: ResizableHandleProps & {
    direction?: 'horizontal' | 'vertical'
    onMouseDown?: (e: React.MouseEvent) => void
    isDragging?: boolean
}) {
    return (
        <div
            className={cn(
                'relative flex-shrink-0 transition-colors',
                direction === 'horizontal'
                    ? 'w-1 cursor-col-resize hover:bg-blue-400 group'
                    : 'h-1 cursor-row-resize hover:bg-blue-400 group',
                isDragging && 'bg-blue-500',
                className
            )}
            onMouseDown={onMouseDown}
        >
            {/* 可视化手柄指示器 */}
            <div className={cn(
                'absolute bg-gray-300 dark:bg-gray-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity',
                direction === 'horizontal'
                    ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8'
                    : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-1',
                isDragging && 'opacity-100 bg-blue-400'
            )} />
        </div>
    )
}
