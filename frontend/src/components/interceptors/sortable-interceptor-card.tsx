'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { InterceptorCard, InterceptorCardProps } from './interceptor-card'
import { cn } from '@/lib/utils'

interface SortableInterceptorCardProps extends InterceptorCardProps { }

export function SortableInterceptorCard(props: SortableInterceptorCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: props.interceptor.id.toString() })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'relative',
                isDragging && 'z-50'
            )}
        >
            <div
                className={cn(
                    'flex items-stretch rounded-xl border transition-all duration-200',
                    isDragging
                        ? 'shadow-2xl ring-2 ring-primary/50 bg-card scale-[1.02]'
                        : 'hover:shadow-md'
                )}
            >
                {/* 拖拽手柄 */}
                <div
                    {...attributes}
                    {...listeners}
                    className={cn(
                        'flex items-center justify-center w-10 cursor-grab active:cursor-grabbing',
                        'bg-muted/30 hover:bg-muted/50 transition-colors rounded-l-xl',
                        'border-r border-border/50'
                    )}
                >
                    <GripVertical className="w-4 h-4 text-muted-foreground" />
                </div>

                {/* 卡片内容 */}
                <div className="flex-1">
                    <InterceptorCard
                        {...props}
                        // 不显示index，因为拖拽手柄已经暗示了顺序
                        showDragHandle={false}
                    />
                </div>
            </div>
        </div>
    )
}
