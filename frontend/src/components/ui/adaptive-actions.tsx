'use client'

import * as React from 'react'
import { LucideIcon, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'

export interface ActionItem {
    id: string
    icon: LucideIcon
    label: string
    onClick: () => void
    disabled?: boolean
    loading?: boolean
    color?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
    separator?: boolean  // 在此项前添加分隔线
}

interface AdaptiveActionsProps {
    actions: ActionItem[]
    maxVisible?: number  // 最多显示的按钮数(不含更多按钮)
}

const colorClasses = {
    default: 'text-gray-500 dark:text-gray-400',
    primary: 'text-primary-600 dark:text-primary-400',
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
}

const menuColorClasses = {
    default: '',
    primary: 'text-primary-600 dark:text-primary-400',
    success: 'text-green-600 dark:text-green-500',
    warning: 'text-amber-600 dark:text-amber-500',
    danger: 'text-red-600 dark:text-red-400 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/20',
    info: 'text-blue-600 dark:text-blue-400',
}

export function AdaptiveActions({ actions, maxVisible = 4 }: AdaptiveActionsProps) {
    const containerRef = React.useRef<HTMLDivElement>(null)
    const [visibleCount, setVisibleCount] = React.useState(maxVisible)

    // 每个按钮的预估宽度(包含padding和gap)
    const BUTTON_WIDTH = 32  // p-1.5 = 6px*2, icon = 16px, gap = 约4px

    React.useEffect(() => {
        const updateVisibleCount = () => {
            if (!containerRef.current) return

            const containerWidth = containerRef.current.offsetWidth
            // 预留更多按钮的空间
            const availableWidth = containerWidth - BUTTON_WIDTH
            const maxButtons = Math.floor(availableWidth / BUTTON_WIDTH)

            // 如果能放下所有按钮，就全部显示
            if (maxButtons >= actions.length) {
                setVisibleCount(actions.length)
            } else {
                // 否则留一个位置给更多按钮
                setVisibleCount(Math.max(1, Math.min(maxButtons, maxVisible)))
            }
        }

        updateVisibleCount()

        const resizeObserver = new ResizeObserver(updateVisibleCount)
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current)
        }

        return () => resizeObserver.disconnect()
    }, [actions.length, maxVisible])

    const visibleActions = actions.slice(0, visibleCount)
    const overflowActions = actions.slice(visibleCount)

    return (
        <TooltipProvider delayDuration={100}>
            <div ref={containerRef} className="flex items-center gap-0.5 w-full">
                {visibleActions.map((action) => {
                    const Icon = action.icon
                    return (
                        <Tooltip key={action.id}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={action.onClick}
                                    disabled={action.disabled}
                                    aria-label={action.label}
                                    aria-busy={action.loading || undefined}
                                    className={cn(
                                        'p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50',
                                        colorClasses[action.color || 'default'],
                                        action.loading && 'animate-pulse'
                                    )}
                                >
                                    <Icon aria-hidden="true" className={cn('h-4 w-4', action.loading && 'animate-spin')} />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent className="px-2 py-1 text-xs bg-gray-900 text-white rounded shadow-sm">
                                {action.label}
                            </TooltipContent>
                        </Tooltip>
                    )
                })}

                {overflowActions.length > 0 && (
                    <DropdownMenu>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label={`更多操作，还有 ${overflowActions.length} 项`}
                                        className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors"
                                    >
                                        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                                    </button>
                                </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent className="px-2 py-1 text-xs bg-gray-900 text-white rounded shadow-sm">
                                还有 {overflowActions.length} 个操作
                            </TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end" className="w-36">
                            {overflowActions.map((action, index) => {
                                const Icon = action.icon
                                return (
                                    <React.Fragment key={action.id}>
                                        {action.separator && index > 0 && <DropdownMenuSeparator />}
                                        <DropdownMenuItem
                                            onClick={action.onClick}
                                            disabled={action.disabled}
                                            aria-busy={action.loading || undefined}
                                            className={menuColorClasses[action.color || 'default']}
                                        >
                                            <Icon aria-hidden="true" className={cn('h-4 w-4 mr-2', action.loading && 'animate-spin')} />
                                            {action.label}
                                        </DropdownMenuItem>
                                    </React.Fragment>
                                )
                            })}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </TooltipProvider>
    )
}
