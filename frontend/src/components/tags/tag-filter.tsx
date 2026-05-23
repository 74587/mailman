'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Filter, X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TagGroupWithTags, TagSimple } from '@/types'
import { tagService } from '@/services/tag.service'
import TagBadge from './tag-badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface TagFilterProps {
    selectedTagIds: number[]
    onFilterChange: (tagIds: number[]) => void
    className?: string
}

export default function TagFilter({
    selectedTagIds,
    onFilterChange,
    className,
}: TagFilterProps) {
    const [tagGroups, setTagGroups] = useState<TagGroupWithTags[]>([])
    const [loading, setLoading] = useState(true)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        loadTagGroups()
    }, [])

    // 监听标签变化事件，刷新标签列表
    useEffect(() => {
        const handleTagsChanged = () => {
            tagService.clearTagGroupsCache()
            loadTagGroups()
        }
        window.addEventListener('tagsChanged', handleTagsChanged)
        return () => {
            window.removeEventListener('tagsChanged', handleTagsChanged)
        }
    }, [])

    const loadTagGroups = async () => {
        try {
            setLoading(true)
            const groups = await tagService.getTagGroups()
            setTagGroups(groups)
        } catch (error) {
            console.error('Failed to load tag groups:', error)
        } finally {
            setLoading(false)
        }
    }

    // 获取所有标签
    const allTags = useMemo(() => {
        return tagGroups.flatMap((group) =>
            group.tags.map((tag) => ({
                ...tag,
                groupName: group.name,
            }))
        )
    }, [tagGroups])

    // 获取选中的标签
    const selectedTags = useMemo(() => {
        return allTags.filter((tag) => selectedTagIds.includes(tag.id))
    }, [allTags, selectedTagIds])

    // 切换标签选择
    const handleTagToggle = useCallback(
        (tagId: number) => {
            if (selectedTagIds.includes(tagId)) {
                onFilterChange(selectedTagIds.filter((id) => id !== tagId))
            } else {
                onFilterChange([...selectedTagIds, tagId])
            }
        },
        [selectedTagIds, onFilterChange]
    )

    // 清除所有筛选
    const handleClearAll = useCallback(() => {
        onFilterChange([])
    }, [onFilterChange])

    return (
        <div className={cn('flex items-center gap-2', className)}>
            <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant={selectedTagIds.length > 0 ? 'default' : 'outline'}
                        size="sm"
                        className="gap-2"
                    >
                        <Filter className="h-4 w-4" />
                        <span>标签筛选</span>
                        {selectedTagIds.length > 0 && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-foreground text-xs text-primary">
                                {selectedTagIds.length}
                            </span>
                        )}
                        <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64 p-2" align="start">
                    {loading ? (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                            加载中...
                        </div>
                    ) : tagGroups.length === 0 ? (
                        <div className="py-4 text-center text-sm text-muted-foreground">
                            暂无标签
                        </div>
                    ) : (
                        <>
                            <div className="max-h-64 overflow-y-auto">
                                {tagGroups.map((group) => (
                                    <div key={group.id} className="mb-3 last:mb-0">
                                        <div className="px-1 py-1 text-xs font-medium text-muted-foreground">
                                            {group.name}
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {group.tags.map((tag) => {
                                                const isSelected = selectedTagIds.includes(tag.id)
                                                return (
                                                    <button
                                                        key={tag.id}
                                                        onClick={() => handleTagToggle(tag.id)}
                                                        className={cn(
                                                            'rounded-full transition-all',
                                                            isSelected
                                                                ? 'ring-2 ring-primary ring-offset-1'
                                                                : 'opacity-70 hover:opacity-100'
                                                        )}
                                                    >
                                                        <TagBadge tag={tag} size="sm" />
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {selectedTagIds.length > 0 && (
                                <div className="mt-2 border-t pt-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full text-destructive hover:text-destructive"
                                        onClick={handleClearAll}
                                    >
                                        清除筛选
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* 显示已选中的标签 */}
            {selectedTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                    {selectedTags.map((tag) => (
                        <TagBadge
                            key={tag.id}
                            tag={tag}
                            size="sm"
                            showRemove
                            onRemove={() => handleTagToggle(tag.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

// 紧凑版标签筛选（用于工具栏）
interface CompactTagFilterProps {
    selectedTagIds: number[]
    onFilterChange: (tagIds: number[]) => void
    tagGroups?: TagGroupWithTags[]
}

export function CompactTagFilter({
    selectedTagIds,
    onFilterChange,
    tagGroups: externalTagGroups,
}: CompactTagFilterProps) {
    const [tagGroups, setTagGroups] = useState<TagGroupWithTags[]>(externalTagGroups || [])
    const [loading, setLoading] = useState(!externalTagGroups)

    useEffect(() => {
        if (!externalTagGroups) {
            loadTagGroups()
        }
    }, [externalTagGroups])

    useEffect(() => {
        if (externalTagGroups) {
            setTagGroups(externalTagGroups)
        }
    }, [externalTagGroups])

    const loadTagGroups = async () => {
        try {
            const groups = await tagService.getTagGroups()
            setTagGroups(groups)
        } finally {
            setLoading(false)
        }
    }

    const allTags = useMemo(() => {
        return tagGroups.flatMap((group) => group.tags)
    }, [tagGroups])

    const handleTagToggle = (tagId: number) => {
        if (selectedTagIds.includes(tagId)) {
            onFilterChange(selectedTagIds.filter((id) => id !== tagId))
        } else {
            onFilterChange([...selectedTagIds, tagId])
        }
    }

    if (loading || allTags.length === 0) {
        return null
    }

    return (
        <div className="flex flex-wrap items-center gap-1">
            {allTags.slice(0, 8).map((tag) => {
                const isSelected = selectedTagIds.includes(tag.id)
                return (
                    <button
                        key={tag.id}
                        onClick={() => handleTagToggle(tag.id)}
                        className={cn(
                            'rounded-full transition-all',
                            isSelected
                                ? 'ring-2 ring-primary ring-offset-1'
                                : 'opacity-60 hover:opacity-100'
                        )}
                    >
                        <TagBadge tag={tag} size="sm" />
                    </button>
                )
            })}
            {allTags.length > 8 && (
                <span className="text-xs text-muted-foreground">
                    +{allTags.length - 8} 更多
                </span>
            )}
        </div>
    )
}
