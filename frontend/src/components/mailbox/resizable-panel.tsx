'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { GripVertical } from 'lucide-react'

interface ResizablePanelProps {
    children: React.ReactNode
    minWidth?: number
    maxWidth?: number
    defaultWidth?: number
    side: 'left' | 'right'
    onResize?: (width: number) => void
    className?: string
}

export function ResizablePanel({
    children,
    minWidth = 200,
    maxWidth = 600,
    defaultWidth = 320,
    side,
    onResize,
    className
}: ResizablePanelProps) {
    const [width, setWidth] = useState(defaultWidth)
    const [isResizing, setIsResizing] = useState(false)
    const panelRef = useRef<HTMLDivElement>(null)
    const startXRef = useRef(0)
    const startWidthRef = useRef(0)

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizing(true)
        startXRef.current = e.clientX
        startWidthRef.current = width
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [width])

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing) return

        const diff = side === 'left'
            ? e.clientX - startXRef.current
            : startXRef.current - e.clientX

        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + diff))
        setWidth(newWidth)
        onResize?.(newWidth)
    }, [isResizing, minWidth, maxWidth, side, onResize])

    const handleMouseUp = useCallback(() => {
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
    }, [])

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove)
            window.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isResizing, handleMouseMove, handleMouseUp])

    return (
        <div
            ref={panelRef}
            className={cn("relative flex-shrink-0", className)}
            style={{ width: `${width}px` }}
        >
            {children}

            {/* 拖拽手柄 */}
            <div
                className={cn(
                    "absolute top-0 bottom-0 w-1 cursor-col-resize z-10 group transition-all duration-200",
                    side === 'left' ? 'right-0' : 'left-0',
                    isResizing ? 'bg-blue-500' : 'hover:bg-blue-400'
                )}
                onMouseDown={handleMouseDown}
            >
                {/* 拖拽指示器 */}
                <div
                    className={cn(
                        "absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-12 rounded-full transition-all duration-200",
                        side === 'left' ? '-right-1.5' : '-left-1.5',
                        isResizing
                            ? 'bg-blue-500 opacity-100 scale-110'
                            : 'bg-gray-300 dark:bg-gray-600 opacity-0 group-hover:opacity-100 hover:bg-blue-400'
                    )}
                >
                    <GripVertical className="h-4 w-4 text-white" />
                </div>
            </div>
        </div>
    )
}

// 可拖拽分隔线组件 - 优化版本，更丝滑的拖拽体验
interface ResizableDividerProps {
    onResize: (delta: number) => void
    className?: string
}

export function ResizableDivider({ onResize, className }: ResizableDividerProps) {
    const [isResizing, setIsResizing] = useState(false)
    const [isHovering, setIsHovering] = useState(false)
    const startXRef = useRef(0)
    const rafRef = useRef<number | null>(null)
    const pendingDeltaRef = useRef(0)

    // 使用 requestAnimationFrame 批量处理拖拽更新，提升性能
    const flushResize = useCallback(() => {
        if (pendingDeltaRef.current !== 0) {
            onResize(pendingDeltaRef.current)
            pendingDeltaRef.current = 0
        }
        rafRef.current = null
    }, [onResize])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsResizing(true)
        startXRef.current = e.clientX
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        // 防止拖拽时文本选择
        document.body.style.webkitUserSelect = 'none'
    }, [])

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing) return

        const delta = e.clientX - startXRef.current
        startXRef.current = e.clientX

        // 累积 delta，使用 RAF 批量更新
        pendingDeltaRef.current += delta

        if (rafRef.current === null) {
            rafRef.current = requestAnimationFrame(flushResize)
        }
    }, [isResizing, flushResize])

    const handleMouseUp = useCallback(() => {
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.body.style.webkitUserSelect = ''

        // 清理未完成的 RAF
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current)
            flushResize()
        }
    }, [flushResize])

    useEffect(() => {
        if (isResizing) {
            // 使用 passive: false 以确保能正确处理
            window.addEventListener('mousemove', handleMouseMove, { passive: true })
            window.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current)
            }
        }
    }, [isResizing, handleMouseMove, handleMouseUp])

    return (
        <div
            className={cn(
                "relative flex-shrink-0 cursor-col-resize select-none touch-none",
                className
            )}
            style={{
                width: isResizing || isHovering ? '6px' : '4px',
                willChange: isResizing ? 'width' : 'auto',
                transition: isResizing ? 'none' : 'width 0.15s ease-out',
            }}
            onMouseDown={handleMouseDown}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => !isResizing && setIsHovering(false)}
        >
            {/* 背景色 - 使用渐变让过渡更平滑 */}
            <div
                className={cn(
                    "absolute inset-0 rounded-full",
                    isResizing
                        ? 'bg-blue-500'
                        : isHovering
                            ? 'bg-blue-400'
                            : 'bg-gray-200 dark:bg-gray-700'
                )}
                style={{
                    transition: isResizing ? 'none' : 'background-color 0.15s ease-out',
                }}
            />

            {/* 拖拽指示器 - 居中显示的手柄 */}
            <div
                className={cn(
                    "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
                    "flex items-center justify-center w-3 h-8 rounded-full",
                    "pointer-events-none"
                )}
                style={{
                    backgroundColor: isResizing
                        ? 'rgb(59 130 246)'
                        : isHovering
                            ? 'rgb(96 165 250)'
                            : 'transparent',
                    opacity: isResizing || isHovering ? 1 : 0,
                    transform: `translate(-50%, -50%) scale(${isResizing ? 1.1 : 1})`,
                    transition: isResizing ? 'none' : 'all 0.15s ease-out',
                }}
            >
                <GripVertical className="h-3 w-3 text-white" style={{ opacity: isResizing || isHovering ? 0.9 : 0 }} />
            </div>
        </div>
    )
}
