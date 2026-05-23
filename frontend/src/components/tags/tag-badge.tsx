'use client'

import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { TagSimple, TagWithGroup } from '@/types'

interface TagBadgeProps {
    tag: TagSimple | TagWithGroup
    size?: 'sm' | 'md' | 'lg'
    showRemove?: boolean
    onRemove?: () => void
    onClick?: () => void
    className?: string
}

// 默认颜色映射
const DEFAULT_COLORS = [
    { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
    { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
    { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
    { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
    { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-300' },
    { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300' },
    { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-300' },
    { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300' },
]

// 根据颜色字符串获取样式
function getColorStyles(color?: string, tagId?: number) {
    if (color) {
        // 如果有自定义颜色，使用自定义样式
        if (color.startsWith('#')) {
            return {
                style: { backgroundColor: color + '20', color: color },
            }
        }
        // 预定义颜色名称
        const colorMap: Record<string, { bg: string; text: string }> = {
            red: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
            blue: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
            green: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
            purple: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
            orange: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
            pink: { bg: 'bg-pink-100 dark:bg-pink-900/30', text: 'text-pink-700 dark:text-pink-300' },
            teal: { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-700 dark:text-teal-300' },
            indigo: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-300' },
            yellow: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300' },
            gray: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300' },
        }
        const preset = colorMap[color.toLowerCase()]
        if (preset) {
            return { className: `${preset.bg} ${preset.text}` }
        }
    }

    // 根据标签ID轮询默认颜色
    const colorIndex = (tagId || 0) % DEFAULT_COLORS.length
    const defaultColor = DEFAULT_COLORS[colorIndex]
    return { className: `${defaultColor.bg} ${defaultColor.text}` }
}

function getGroupName(tag: TagSimple | TagWithGroup): string | undefined {
    if ('groupName' in tag) {
        return tag.groupName
    }
    return undefined
}

export default function TagBadge({
    tag,
    size = 'md',
    showRemove = false,
    onRemove,
    onClick,
    className,
}: TagBadgeProps) {
    const sizeClasses = {
        sm: 'px-1.5 py-0.5 text-xs',
        md: 'px-2 py-0.5 text-xs',
        lg: 'px-2.5 py-1 text-sm',
    }

    const colorStyles = getColorStyles(tag.color, tag.id)
    const groupName = getGroupName(tag)

    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full font-medium transition-colors',
                sizeClasses[size],
                colorStyles.className,
                onClick && 'cursor-pointer hover:opacity-80',
                className
            )}
            style={colorStyles.style}
            onClick={onClick}
            title={groupName ? `${groupName}: ${tag.name}` : tag.name}
        >
            {tag.name}
            {showRemove && onRemove && (
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        onRemove()
                    }}
                    className="ml-1 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </span>
    )
}

// 多标签显示组件
interface TagBadgeListProps {
    tags: (TagSimple | TagWithGroup)[]
    size?: 'sm' | 'md' | 'lg'
    maxDisplay?: number
    showRemove?: boolean
    onRemove?: (tag: TagSimple | TagWithGroup) => void
    className?: string
}

export function TagBadgeList({
    tags,
    size = 'md',
    maxDisplay = 3,
    showRemove = false,
    onRemove,
    className,
}: TagBadgeListProps) {
    const displayTags = tags.slice(0, maxDisplay)
    const remainingCount = tags.length - maxDisplay

    return (
        <div className={cn('flex flex-wrap items-center gap-1', className)}>
            {displayTags.map((tag) => (
                <TagBadge
                    key={tag.id}
                    tag={tag}
                    size={size}
                    showRemove={showRemove}
                    onRemove={onRemove ? () => onRemove(tag) : undefined}
                />
            ))}
            {remainingCount > 0 && (
                <span className={cn(
                    'inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-medium',
                    size === 'sm' ? 'px-1.5 py-0.5 text-xs' : size === 'md' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
                )}>
                    +{remainingCount}
                </span>
            )}
        </div>
    )
}

// 按分组显示标签组件
interface GroupedTagBadgeListProps {
    tags: TagWithGroup[]
    size?: 'sm' | 'md' | 'lg'
    className?: string
}

export function GroupedTagBadgeList({
    tags,
    size = 'sm',
    className,
}: GroupedTagBadgeListProps) {
    // 按分组组织标签
    const groupedTags = tags.reduce((acc, tag) => {
        const groupName = tag.groupName || '未分组'
        if (!acc[groupName]) {
            acc[groupName] = []
        }
        acc[groupName].push(tag)
        return acc
    }, {} as Record<string, TagWithGroup[]>)

    if (tags.length === 0) {
        return null
    }

    return (
        <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
            {Object.entries(groupedTags).map(([groupName, groupTags]) => (
                <div key={groupName} className="inline-flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">
                        {groupName}:
                    </span>
                    <div className="flex items-center gap-0.5">
                        {groupTags.map((tag, index) => (
                            <TagBadge key={tag.id} tag={tag} size={size} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

