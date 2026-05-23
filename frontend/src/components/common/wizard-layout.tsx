'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
    Check,
    GripVertical,
    LayoutDashboard,
    Code,
    Eye,
    Loader2,
    Play
} from 'lucide-react'

// 步骤定义接口
export interface WizardStep {
    id: string
    title: string
    description: string
    icon: React.ComponentType<{ className?: string }>
    color: string
    bgColor: string
}

// 全局概览项接口
export interface OverviewItem {
    label: string
    value: React.ReactNode
    status?: 'ready' | 'pending' | 'error'
}

// 右侧面板配置接口
export interface RightPanelConfig {
    // 上半部分 - 全局概览
    globalOverview?: {
        title?: string
        icon?: React.ComponentType<{ className?: string }>
        items?: OverviewItem[]
        // 自定义内容渲染
        customContent?: React.ReactNode
        // 操作按钮
        actions?: React.ReactNode
    }
    // 下半部分 - 详情面板
    detailPanel?: {
        title?: string
        icon?: React.ComponentType<{ className?: string }>
        content?: React.ReactNode
        // 操作按钮
        actions?: React.ReactNode
    }
}

// WizardLayout Props
export interface WizardLayoutProps {
    // 步骤配置
    steps: WizardStep[]
    currentStep: number
    onStepChange: (step: number) => void

    // 步骤内容
    children: React.ReactNode

    // 导航配置
    canProceed: boolean
    onNext: () => void
    onPrevious: () => void
    nextLabel?: string
    previousLabel?: string
    isSubmitting?: boolean

    // 右侧面板配置
    rightPanelConfig?: RightPanelConfig

    // 右侧面板显示条件（默认显示）
    showRightPanel?: boolean

    // 隐藏底部导航
    hideBottomNav?: boolean

    // 自定义类名
    className?: string

    // 禁用的步骤索引
    disabledSteps?: number[]
}

export function WizardLayout({
    steps,
    currentStep,
    onStepChange,
    children,
    canProceed,
    onNext,
    onPrevious,
    nextLabel = '下一步 →',
    previousLabel = '← 上一步',
    isSubmitting = false,
    rightPanelConfig,
    showRightPanel = true,
    hideBottomNav = false,
    className,
    disabledSteps = []
}: WizardLayoutProps) {
    // 右侧面板宽度状态（像素）
    const [rightPanelWidth, setRightPanelWidth] = useState(320)
    const [isResizingWidth, setIsResizingWidth] = useState(false)

    // 上下面板高度比例状态
    const [topPanelHeight, setTopPanelHeight] = useState(40) // 百分比
    const [isResizingHeight, setIsResizingHeight] = useState(false)

    // 拖拽引用
    const containerRef = useRef<HTMLDivElement>(null)
    const startPosRef = useRef({ x: 0, y: 0 })
    const startSizeRef = useRef({ width: 320, height: 40 })

    // 处理右侧面板宽度拖拽
    const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizingWidth(true)
        startPosRef.current.x = e.clientX
        startSizeRef.current.width = rightPanelWidth
    }, [rightPanelWidth])

    // 处理上下面板高度拖拽
    const handleHeightResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizingHeight(true)
        startPosRef.current.y = e.clientY
        startSizeRef.current.height = topPanelHeight
    }, [topPanelHeight])

    // 鼠标移动处理
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizingWidth) {
                const delta = startPosRef.current.x - e.clientX
                const newWidth = Math.max(280, Math.min(500, startSizeRef.current.width + delta))
                setRightPanelWidth(newWidth)
            }
            if (isResizingHeight && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect()
                const relativeY = e.clientY - rect.top
                const percentage = (relativeY / rect.height) * 100
                const newHeight = Math.max(20, Math.min(80, percentage))
                setTopPanelHeight(newHeight)
            }
        }

        const handleMouseUp = () => {
            setIsResizingWidth(false)
            setIsResizingHeight(false)
        }

        if (isResizingWidth || isResizingHeight) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = isResizingWidth ? 'col-resize' : 'row-resize'
            document.body.style.userSelect = 'none'
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }
    }, [isResizingWidth, isResizingHeight])

    const GlobalIcon = rightPanelConfig?.globalOverview?.icon || LayoutDashboard
    const DetailIcon = rightPanelConfig?.detailPanel?.icon || Code

    return (
        <div className={cn(
            "flex h-[calc(100vh-4rem)] overflow-hidden bg-gray-50 dark:bg-gray-900 -m-6 p-6",
            className
        )}>
            {/* 左侧：主操作区 */}
            <div className={cn(
                "flex-1 flex flex-col overflow-hidden",
                showRightPanel && "mr-6"
            )}>
                {/* 顶部进度条 */}
                <Card className="p-4 flex-none shadow-sm border-0 bg-white/80 backdrop-blur dark:bg-gray-800/80">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-1 w-full max-w-4xl mx-auto">
                            {steps.map((step, index) => {
                                const isActive = index === currentStep
                                const isCompleted = index < currentStep
                                const isDisabled = disabledSteps.includes(index)
                                const StepIcon = step.icon

                                return (
                                    <React.Fragment key={step.id}>
                                        <div
                                            className={cn(
                                                "relative flex flex-col items-center group",
                                                isActive ? "flex-none" : "flex-1",
                                                !isDisabled && index < currentStep && "cursor-pointer"
                                            )}
                                            onClick={() => {
                                                if (!isDisabled && index < currentStep) {
                                                    onStepChange(index)
                                                }
                                            }}
                                        >
                                            <div className={cn(
                                                "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm border-2",
                                                isActive
                                                    ? cn(step.bgColor, step.color, "border-current scale-110")
                                                    : isCompleted
                                                        ? "bg-green-500 text-white border-green-500"
                                                        : "bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-800 dark:border-gray-700"
                                            )}>
                                                {isCompleted ? (
                                                    <Check className="w-5 h-5" />
                                                ) : (
                                                    <StepIcon className="w-5 h-5" />
                                                )}
                                            </div>
                                            <div className="mt-2 text-center">
                                                <p className={cn(
                                                    "text-sm font-semibold transition-colors duration-200",
                                                    isActive ? "text-gray-900 dark:text-white" : "text-gray-500"
                                                )}>
                                                    {step.title}
                                                </p>
                                                {isActive && (
                                                    <p className="text-xs text-gray-400 hidden md:block animate-in fade-in slide-in-from-top-1">
                                                        {step.description}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        {index < steps.length - 1 && (
                                            <div className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 mx-2 relative top-[-14px]">
                                                <div
                                                    className="absolute inset-0 bg-green-500 transition-all duration-500"
                                                    style={{ width: isCompleted ? '100%' : '0%' }}
                                                />
                                            </div>
                                        )}
                                    </React.Fragment>
                                )
                            })}
                        </div>
                    </div>
                </Card>

                {/* 步骤内容区域 - 可滚动 */}
                <div className="flex-1 min-h-0 overflow-y-auto pr-2 scrollbar-hide">
                    <div className="max-w-4xl mx-auto pb-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {children}
                    </div>
                </div>

                {/* 底部导航 - 固定在底部 */}
                {!hideBottomNav && (
                    <div className="flex-shrink-0 p-4 border-t bg-white dark:bg-gray-800 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                        <div className="flex items-center justify-between max-w-4xl mx-auto">
                            <Button
                                variant="outline"
                                onClick={onPrevious}
                                disabled={currentStep === 0 || isSubmitting}
                            >
                                {previousLabel}
                            </Button>
                            <div className="text-sm text-gray-500">
                                第 {currentStep + 1} / {steps.length} 步
                            </div>
                            <Button
                                onClick={onNext}
                                disabled={!canProceed || isSubmitting}
                                className={canProceed && !isSubmitting ? '' : 'opacity-50 cursor-not-allowed'}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        处理中...
                                    </>
                                ) : (
                                    currentStep === steps.length - 1
                                        ? nextLabel.includes('→') ? '完成创建' : nextLabel
                                        : nextLabel
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* 右侧：概览面板 - 可调整宽度 */}
            {showRightPanel && (
                <div className="hidden lg:flex relative">
                    {/* 宽度调整手柄 */}
                    <div
                        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-blue-400 group"
                        onMouseDown={handleWidthResizeStart}
                    >
                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <GripVertical className="w-3 h-3 text-gray-400" />
                        </div>
                    </div>

                    <Card
                        ref={containerRef}
                        style={{ width: rightPanelWidth }}
                        className="flex-none flex flex-col bg-white/90 backdrop-blur shadow-lg border-l-4 border-l-primary/20 dark:bg-gray-800/90 ml-1 h-full"
                    >
                        {/* 上半部分：全局配置概览 */}
                        <div style={{ height: `${topPanelHeight}%` }} className="flex flex-col overflow-hidden min-h-0">
                            <div className="p-3 border-b dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex-shrink-0 flex items-center justify-between">
                                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                                    <GlobalIcon className="w-4 h-4" />
                                    {rightPanelConfig?.globalOverview?.title || '全局配置概览'}
                                </h3>
                                {rightPanelConfig?.globalOverview?.actions}
                            </div>
                            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                                {/* 概览项 */}
                                {rightPanelConfig?.globalOverview?.items?.map((item, index) => (
                                    <div key={index} className="space-y-1">
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="font-medium text-gray-500">{item.label}</span>
                                            {item.status === 'ready' && (
                                                <span className="text-green-600 text-xs bg-green-50 px-1.5 py-0.5 rounded-full">已就绪</span>
                                            )}
                                            {item.status === 'pending' && (
                                                <span className="text-gray-400 text-xs">未选择</span>
                                            )}
                                            {item.status === 'error' && (
                                                <span className="text-red-600 text-xs bg-red-50 px-1.5 py-0.5 rounded-full">错误</span>
                                            )}
                                            {!item.status && typeof item.value === 'string' && (
                                                <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded-full">{item.value}</span>
                                            )}
                                        </div>
                                        {typeof item.value !== 'string' && item.value}
                                    </div>
                                ))}
                                {/* 自定义内容 */}
                                {rightPanelConfig?.globalOverview?.customContent}
                            </div>
                        </div>

                        {/* 高度调整手柄 */}
                        <div
                            className="h-1 cursor-row-resize hover:bg-blue-400 bg-gray-200 dark:bg-gray-700 flex-shrink-0"
                            onMouseDown={handleHeightResizeStart}
                        />

                        {/* 下半部分：详情面板 */}
                        <div style={{ height: `${100 - topPanelHeight}%` }} className="flex flex-col overflow-hidden min-h-0">
                            <div className="p-3 border-b dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex-shrink-0 flex items-center justify-between">
                                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                                    <DetailIcon className="w-4 h-4" />
                                    {rightPanelConfig?.detailPanel?.title || '配置详情'}
                                </h3>
                                {rightPanelConfig?.detailPanel?.actions}
                            </div>
                            <div className="flex-1 overflow-y-auto p-3">
                                {rightPanelConfig?.detailPanel?.content || (
                                    <div className="text-sm text-gray-400 italic">
                                        请选择一个项目以查看详情
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    )
}

// 导出辅助组件和类型
export { LayoutDashboard, Code, Eye, Loader2, Play }
