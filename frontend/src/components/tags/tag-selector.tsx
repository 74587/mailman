'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TagGroupWithTags, TagSimple, TagWithGroup } from '@/types'
import { tagService } from '@/services/tag.service'
import TagBadge, { TagBadgeList, GroupedTagBadgeList } from './tag-badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface TagSelectorProps {
    selectedTagIds: number[]
    onSelectionChange: (tagIds: number[]) => void
    tagGroups?: TagGroupWithTags[]
    placeholder?: string
    disabled?: boolean
    showSelectedTags?: boolean
    maxDisplayTags?: number
    className?: string
}

export default function TagSelector({
    selectedTagIds,
    onSelectionChange,
    tagGroups: externalTagGroups,
    placeholder = '选择标签',
    disabled = false,
    showSelectedTags = true,
    maxDisplayTags = 3,
    className,
}: TagSelectorProps) {
    const [tagGroups, setTagGroups] = useState<TagGroupWithTags[]>(externalTagGroups || [])
    const [loading, setLoading] = useState(!externalTagGroups)
    const [searchQuery, setSearchQuery] = useState('')
    const [open, setOpen] = useState(false)

    // 加载标签组
    useEffect(() => {
        if (!externalTagGroups) {
            loadTagGroups()
        }
    }, [externalTagGroups])

    // 同步外部标签组
    useEffect(() => {
        if (externalTagGroups) {
            setTagGroups(externalTagGroups)
        }
    }, [externalTagGroups])

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

    // 获取所有标签的扁平列表
    const allTags = useMemo(() => {
        return tagGroups.flatMap((group) =>
            group.tags.map((tag) => ({
                ...tag,
                groupName: group.name,
                selectionType: group.selectionType,
            }))
        )
    }, [tagGroups])

    // 筛选标签
    const filteredTagGroups = useMemo(() => {
        if (!searchQuery) return tagGroups

        return tagGroups
            .map((group) => ({
                ...group,
                tags: group.tags.filter((tag) =>
                    tag.name.toLowerCase().includes(searchQuery.toLowerCase())
                ),
            }))
            .filter((group) => group.tags.length > 0)
    }, [tagGroups, searchQuery])

    // 获取选中的标签
    const selectedTags = useMemo(() => {
        return allTags.filter((tag) => selectedTagIds.includes(tag.id))
    }, [allTags, selectedTagIds])

    // 处理标签选择/取消选择
    const handleTagToggle = useCallback(
        (tag: TagSimple, group: TagGroupWithTags) => {
            const isSelected = selectedTagIds.includes(tag.id)

            if (isSelected) {
                // 取消选择
                onSelectionChange(selectedTagIds.filter((id) => id !== tag.id))
            } else {
                // 选择标签
                if (group.selectionType === 'single') {
                    // 单选组：移除该组的其他标签
                    const otherGroupTagIds = group.tags.map((t) => t.id)
                    const newSelection = selectedTagIds.filter((id) => !otherGroupTagIds.includes(id))
                    onSelectionChange([...newSelection, tag.id])
                } else {
                    // 多选组：直接添加
                    onSelectionChange([...selectedTagIds, tag.id])
                }
            }
        },
        [selectedTagIds, onSelectionChange]
    )

    // 移除标签
    const handleRemoveTag = useCallback(
        (tagId: number) => {
            onSelectionChange(selectedTagIds.filter((id) => id !== tagId))
        },
        [selectedTagIds, onSelectionChange]
    )

    return (
        <div className={cn('flex flex-col gap-2', className)}>
            <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild disabled={disabled}>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className={cn(
                            'w-full justify-between',
                            disabled && 'opacity-50 cursor-not-allowed'
                        )}
                    >
                        <span className="truncate">
                            {selectedTagIds.length > 0
                                ? `已选择 ${selectedTagIds.length} 个标签`
                                : placeholder}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72 p-0" align="start">
                    {/* 搜索框 */}
                    <div className="flex items-center border-b px-3 py-2">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <Input
                            placeholder="搜索标签..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-8 border-0 focus-visible:ring-0"
                        />
                    </div>

                    {/* 标签列表 */}
                    <div className="max-h-64 overflow-y-auto p-2">
                        {loading ? (
                            <div className="py-4 text-center text-sm text-muted-foreground">
                                加载中...
                            </div>
                        ) : filteredTagGroups.length === 0 ? (
                            <div className="py-4 text-center text-sm text-muted-foreground">
                                {searchQuery ? '未找到匹配的标签' : '暂无标签'}
                            </div>
                        ) : (
                            filteredTagGroups.map((group) => (
                                <div key={group.id} className="mb-3 last:mb-0">
                                    <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
                                        <span>{group.name}</span>
                                        <span className="text-xs opacity-50">
                                            ({group.selectionType === 'single' ? '单选' : '多选'})
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap gap-1 px-2">
                                        {group.tags.map((tag) => {
                                            const isSelected = selectedTagIds.includes(tag.id)
                                            return (
                                                <button
                                                    key={tag.id}
                                                    onClick={() => handleTagToggle(tag, group)}
                                                    className={cn(
                                                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-all',
                                                        isSelected
                                                            ? 'ring-2 ring-primary ring-offset-1'
                                                            : 'hover:opacity-80'
                                                    )}
                                                >
                                                    <TagBadge tag={tag} size="sm" />
                                                    {isSelected && (
                                                        <Check className="h-3 w-3 text-primary" />
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* 底部操作 */}
                    {selectedTagIds.length > 0 && (
                        <div className="border-t p-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full text-destructive hover:text-destructive"
                                onClick={() => onSelectionChange([])}
                            >
                                清除所有
                            </Button>
                        </div>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* 显示选中的标签 */}
            {showSelectedTags && selectedTags.length > 0 && (
                <TagBadgeList
                    tags={selectedTags}
                    size="sm"
                    maxDisplay={maxDisplayTags}
                    showRemove
                    onRemove={(tag) => handleRemoveTag(tag.id)}
                />
            )}
        </div>
    )
}

// 简化版标签选择器（用于表格/列表内联编辑）
interface InlineTagSelectorProps {
    accountId: number
    currentTags: { id: number; groupId: number; name: string; color?: string; group?: { name: string } }[]  // 接受后端返回的Tag结构
    onTagsChange?: () => void  // 简化为无参数回调，由父组件刷新
    size?: 'sm' | 'md'
}

export function InlineTagSelector({
    accountId,
    currentTags,
    onTagsChange,
    size = 'sm',
}: InlineTagSelectorProps) {
    const [tagGroups, setTagGroups] = useState<TagGroupWithTags[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [showDropdown, setShowDropdown] = useState(false)

    // 将后端Tag转换为TagWithGroup用于显示
    const displayTags: TagWithGroup[] = currentTags.map(t => ({
        id: t.id,
        groupId: t.groupId,
        groupName: t.group?.name || '',
        name: t.name,
        color: t.color
    }))

    useEffect(() => {
        loadTagGroups()
    }, [])

    // 监听标签变化事件，刷新标签组列表
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
            const groups = await tagService.getTagGroups()
            setTagGroups(groups)
        } catch (error) {
            console.error('Failed to load tag groups:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleTagToggle = async (tag: TagSimple, group: TagGroupWithTags) => {
        const currentTagIds = currentTags.map((t) => t.id)
        const isSelected = currentTagIds.includes(tag.id)
        let newTagIds: number[]

        if (isSelected) {
            newTagIds = currentTagIds.filter((id) => id !== tag.id)
        } else {
            if (group.selectionType === 'single') {
                const otherGroupTagIds = group.tags.map((t) => t.id)
                newTagIds = [...currentTagIds.filter((id) => !otherGroupTagIds.includes(id)), tag.id]
            } else {
                newTagIds = [...currentTagIds, tag.id]
            }
        }

        try {
            setSaving(true)
            const updatedTags = await tagService.setAccountTags(accountId, newTagIds)
            onTagsChange?.()
        } catch (error) {
            console.error('Failed to update account tags:', error)
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return <span className="text-xs text-muted-foreground">...</span>
    }

    return (
        <DropdownMenu open={showDropdown} onOpenChange={setShowDropdown}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-1 text-left cursor-pointer"
                    disabled={saving}
                    onClick={(e) => {
                        e.stopPropagation()
                        setShowDropdown(true)
                    }}
                >
                    {displayTags.length > 0 ? (
                        <GroupedTagBadgeList tags={displayTags} size={size} />
                    ) : (
                        <span className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                            + 添加标签
                        </span>
                    )}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 p-2 z-[100]" align="start">
                {tagGroups.length === 0 ? (
                    <div className="py-2 text-center text-xs text-muted-foreground">
                        暂无标签
                    </div>
                ) : (
                    tagGroups.map((group) => (
                        <div key={group.id} className="mb-2 last:mb-0">
                            <div className="px-1 py-1 text-xs font-medium text-muted-foreground">
                                {group.name}
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {group.tags.map((tag) => {
                                    const isSelected = currentTags.some((t) => t.id === tag.id)
                                    return (
                                        <button
                                            key={tag.id}
                                            onClick={() => handleTagToggle(tag, group)}
                                            disabled={saving}
                                            className={cn(
                                                'rounded-full transition-all',
                                                isSelected && 'ring-2 ring-primary ring-offset-1'
                                            )}
                                        >
                                            <TagBadge tag={tag} size="sm" />
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    ))
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
