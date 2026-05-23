'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Pin, PinOff, Move } from 'lucide-react'
import { motion, useDragControls, useMotionValue } from 'framer-motion'
import { cn } from '@/lib/utils'

interface FieldPreviewPanelProps {
    field: string
    content: string
    onClose: () => void
    isPinned: boolean
    onPinToggle: () => void
}

export function FieldPreviewPanel({
    field,
    content,
    onClose,
    isPinned,
    onPinToggle
}: FieldPreviewPanelProps) {
    const dragControls = useDragControls()
    const constraintsRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)

    // 使用 motion values 来管理位置
    const x = useMotionValue(0)
    const y = useMotionValue(0)

    // 存储拖拽约束
    const [dragBounds, setDragBounds] = useState({
        left: 0,
        right: 0,
        top: 0,
        bottom: 0
    })

    // 获取字段标签
    const getFieldLabel = (fieldValue: string) => {
        const fieldMap: Record<string, string> = {
            'ALL': '全部字段',
            'from': '发件人',
            'to': '收件人',
            'cc': '抄送',
            'subject': '主题',
            'body': '正文',
            'html_body': 'HTML正文',
            'headers': '邮件头'
        }
        return fieldMap[fieldValue] || fieldValue
    }

    // 计算拖拽边界
    const calculateDragBounds = () => {
        if (constraintsRef.current && panelRef.current) {
            const containerRect = constraintsRef.current.getBoundingClientRect()
            const panelRect = panelRef.current.getBoundingClientRect()

            // 计算可拖拽的边界
            const bounds = {
                left: 0,
                right: containerRect.width - panelRect.width,
                top: 0,
                bottom: containerRect.height - panelRect.height
            }

            setDragBounds(bounds)

            // 如果当前位置超出边界，调整到边界内
            const currentX = x.get()
            const currentY = y.get()

            if (currentX > bounds.right) {
                x.set(bounds.right)
            }
            if (currentY > bounds.bottom) {
                y.set(bounds.bottom)
            }
        }
    }

    // 设置初始位置和计算边界
    useEffect(() => {
        if (constraintsRef.current && panelRef.current) {
            const containerRect = constraintsRef.current.getBoundingClientRect()
            const panelWidth = 384 // w-96 = 24rem = 384px

            // 设置初始位置在右上角
            const initialX = Math.max(0, containerRect.width - panelWidth - 20)
            const initialY = 20

            x.set(initialX)
            y.set(initialY)

            // 计算拖拽边界
            calculateDragBounds()
        }
    }, [])

    // 监听窗口大小变化
    useEffect(() => {
        const handleResize = () => {
            calculateDragBounds()
        }

        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    return (
        <div
            ref={constraintsRef}
            className="fixed inset-0 pointer-events-none z-[65]"
        >
            <motion.div
                ref={panelRef}
                drag
                dragControls={dragControls}
                dragMomentum={false}
                dragElastic={0}
                dragConstraints={dragBounds}
                style={{ x, y }}
                className="pointer-events-auto absolute w-96"
                onDragEnd={() => {
                    // 确保拖拽结束后位置在边界内
                    calculateDragBounds()
                }}
            >
                <div className="rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    {/* 头部 */}
                    <div
                        className="flex items-center justify-between border-b border-gray-200 p-3 dark:border-gray-700"
                        onPointerDown={(e) => dragControls.start(e)}
                        style={{ cursor: 'move' }}
                    >
                        <div className="flex items-center gap-2">
                            <Move className="h-4 w-4 text-gray-400" />
                            <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                                字段预览 - {getFieldLabel(field)}
                            </h3>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={onPinToggle}
                                className={cn(
                                    "rounded p-1.5 transition-colors",
                                    isPinned
                                        ? "bg-primary-100 text-primary-600 hover:bg-primary-200 dark:bg-primary-900 dark:text-primary-400"
                                        : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                                )}
                                title={isPinned ? "取消固定" : "固定窗口"}
                            >
                                {isPinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
                            </button>
                            <button
                                onClick={onClose}
                                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* 内容区域 */}
                    <div className="max-h-[60vh] overflow-y-auto p-4">
                        {content ? (
                            <pre className="whitespace-pre-wrap break-words font-mono text-sm text-gray-700 dark:text-gray-300">
                                {content}
                            </pre>
                        ) : (
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                该字段暂无内容
                            </p>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    )
}
