'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect, useCallback } from 'react'
import { Plus, Edit2, Trash2, Tag, Layers, X, GripVertical, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import {
    TagGroupWithTags,
    TagSimple,
    CreateTagGroupRequest,
    UpdateTagGroupRequest,
    CreateTagRequest,
    UpdateTagRequest,
    TagUsageStats,
} from '@/types'
import { tagService } from '@/services/tag.service'
import TagBadge from './tag-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalTitle,
} from '@/components/ui/modal'
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
} from '@/components/ui/select'


interface TagManagerProps {
    isOpen: boolean
    onClose: () => void
    onTagsChanged?: () => void
}

// 颜色选项
const COLOR_OPTIONS = [
    { value: 'blue', label: '蓝色', preview: 'bg-blue-500' },
    { value: 'green', label: '绿色', preview: 'bg-green-500' },
    { value: 'purple', label: '紫色', preview: 'bg-purple-500' },
    { value: 'orange', label: '橙色', preview: 'bg-orange-500' },
    { value: 'pink', label: '粉色', preview: 'bg-pink-500' },
    { value: 'teal', label: '青色', preview: 'bg-teal-500' },
    { value: 'indigo', label: '靛蓝', preview: 'bg-indigo-500' },
    { value: 'red', label: '红色', preview: 'bg-red-500' },
    { value: 'yellow', label: '黄色', preview: 'bg-yellow-500' },
    { value: 'gray', label: '灰色', preview: 'bg-gray-500' },
]

export default function TagManager({ isOpen, onClose, onTagsChanged }: TagManagerProps) {
    const { confirm } = useConfirmDialog()
    const [tagGroups, setTagGroups] = useState<TagGroupWithTags[]>([])
    const [usageStats, setUsageStats] = useState<TagUsageStats>({})
    const [loading, setLoading] = useState(true)
    const [selectedGroup, setSelectedGroup] = useState<TagGroupWithTags | null>(null)

    // 表单状态
    const [showGroupForm, setShowGroupForm] = useState(false)
    const [showTagForm, setShowTagForm] = useState(false)
    const [editingGroup, setEditingGroup] = useState<TagGroupWithTags | null>(null)
    const [editingTag, setEditingTag] = useState<TagSimple | null>(null)
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        selectionType: 'multiple' as 'single' | 'multiple',
        color: 'blue',
        groupId: 0,
    })
    const [saving, setSaving] = useState(false)

    // Note: toast notifications not available, using console.log

    useEffect(() => {
        if (isOpen) {
            loadData()
        }
    }, [isOpen])

    const loadData = async () => {
        try {
            setLoading(true)
            const [groups, stats] = await Promise.all([
                tagService.getTagGroups(),
                tagService.getTagUsageStats(),
            ])
            setTagGroups(groups)
            setUsageStats(stats)

            // 更新选中的标签组数据
            if (selectedGroup) {
                // 找到更新后的标签组数据
                const updatedGroup = groups.find(g => g.id === selectedGroup.id)
                if (updatedGroup) {
                    setSelectedGroup(updatedGroup)
                } else if (groups.length > 0) {
                    setSelectedGroup(groups[0])
                } else {
                    setSelectedGroup(null)
                }
            } else if (groups.length > 0) {
                setSelectedGroup(groups[0])
            }
        } catch (error) {
            console.error('Failed to load tags:', error)
            console.error('加载失败: 无法加载标签数据')
        } finally {
            setLoading(false)
        }
    }

    // 打开标签组表单
    const openGroupForm = (group?: TagGroupWithTags) => {
        if (group) {
            setEditingGroup(group)
            setFormData({
                name: group.name,
                description: group.description || '',
                selectionType: group.selectionType,
                color: group.color || 'blue',
                groupId: 0,
            })
        } else {
            setEditingGroup(null)
            setFormData({
                name: '',
                description: '',
                selectionType: 'multiple',
                color: 'blue',
                groupId: 0,
            })
        }
        setShowGroupForm(true)
    }

    // 保存标签组
    const saveGroup = async () => {
        if (!formData.name.trim()) {
            toast.warning('请输入标签组名称')
            return
        }

        try {
            setSaving(true)
            if (editingGroup) {
                await tagService.updateTagGroup(editingGroup.id, {
                    name: formData.name,
                    description: formData.description,
                    selectionType: formData.selectionType,
                    color: formData.color,
                })
                logger.debug('标签组更新成功')
            } else {
                await tagService.createTagGroup({
                    name: formData.name,
                    description: formData.description,
                    selectionType: formData.selectionType,
                    color: formData.color,
                })
                logger.debug('标签组创建成功')
            }
            setShowGroupForm(false)
            loadData()
            onTagsChanged?.()
        } catch (error: any) {
            console.error('保存失败:', error.message || '操作失败')
        } finally {
            setSaving(false)
        }
    }

    // 删除标签组
    const deleteGroup = async (group: TagGroupWithTags) => {
        const confirmed = await confirm({
            title: '删除标签组',
            description: `确定要删除标签组"${group.name}"及其所有标签吗？`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return

        try {
            await tagService.deleteTagGroup(group.id)
            toast.success('标签组已删除')
            if (selectedGroup?.id === group.id) {
                setSelectedGroup(null)
            }
            loadData()
            onTagsChanged?.()
        } catch (error: any) {
            toast.error('删除失败: ' + (error.message || '操作失败'))
        }
    }

    // 打开标签表单
    const openTagForm = (tag?: TagSimple) => {
        if (!selectedGroup) return

        if (tag) {
            setEditingTag(tag)
            setFormData({
                ...formData,
                name: tag.name,
                color: tag.color || selectedGroup.color || 'blue',
                groupId: tag.groupId,
            })
        } else {
            setEditingTag(null)
            setFormData({
                ...formData,
                name: '',
                color: selectedGroup.color || 'blue',
                groupId: selectedGroup.id,
            })
        }
        setShowTagForm(true)
    }

    // 保存标签
    const saveTag = async () => {
        if (!formData.name.trim()) {
            toast.warning('请输入标签名称')
            return
        }

        try {
            setSaving(true)
            if (editingTag) {
                await tagService.updateTag(editingTag.id, {
                    name: formData.name,
                    color: formData.color,
                })
                logger.debug('标签更新成功')
            } else {
                await tagService.createTag({
                    groupId: formData.groupId || selectedGroup!.id,
                    name: formData.name,
                    color: formData.color,
                })
                logger.debug('标签创建成功')
            }
            setShowTagForm(false)
            loadData()
            onTagsChanged?.()
        } catch (error: any) {
            console.error('保存失败:', error.message || '操作失败')
        } finally {
            setSaving(false)
        }
    }

    // 删除标签
    const deleteTag = async (tag: TagSimple) => {
        const count = usageStats[tag.id] || 0
        const description = count > 0
            ? `标签"${tag.name}"正在被 ${count} 个账户使用，确定要删除吗？`
            : `确定要删除标签"${tag.name}"吗？`

        const confirmed = await confirm({
            title: '删除标签',
            description,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return

        try {
            await tagService.deleteTag(tag.id)
            toast.success('标签已删除')
            loadData()
            onTagsChanged?.()
        } catch (error: any) {
            toast.error('删除失败: ' + (error.message || '操作失败'))
        }
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent size="lg">
                <ModalHeader>
                    <ModalTitle>标签管理</ModalTitle>
                </ModalHeader>
                <ModalBody className="p-0">
                    <div className="flex h-[400px]">
                        {/* 左侧：标签组列表 */}
                        <div className="w-48 border-r bg-muted/30 p-3">
                            <div className="mb-3 flex items-center justify-between">
                                <h4 className="text-sm font-medium text-muted-foreground">标签组</h4>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => openGroupForm()}
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="space-y-1">
                                {loading ? (
                                    <div className="py-4 text-center text-sm text-muted-foreground">
                                        加载中...
                                    </div>
                                ) : tagGroups.length === 0 ? (
                                    <div className="py-4 text-center text-sm text-muted-foreground">
                                        暂无标签组
                                    </div>
                                ) : (
                                    tagGroups.map((group) => (
                                        <button
                                            key={group.id}
                                            onClick={() => setSelectedGroup(group)}
                                            className={cn(
                                                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                                                selectedGroup?.id === group.id
                                                    ? 'bg-primary/10 text-primary'
                                                    : 'hover:bg-muted'
                                            )}
                                        >
                                            <Layers className="h-4 w-4 shrink-0" />
                                            <span className="flex-1 truncate">{group.name}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {group.tags.length}
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* 右侧：标签列表 */}
                        <div className="flex-1 p-4">
                            {selectedGroup ? (
                                <>
                                    <div className="mb-4 flex items-center justify-between">
                                        <div>
                                            <h3 className="font-medium">{selectedGroup.name}</h3>
                                            <p className="text-xs text-muted-foreground">
                                                {selectedGroup.selectionType === 'single' ? '单选' : '多选'}
                                                {selectedGroup.description && ` · ${selectedGroup.description}`}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => openGroupForm(selectedGroup)}
                                            >
                                                <Edit2 className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-destructive hover:text-destructive"
                                                onClick={() => deleteGroup(selectedGroup)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* 标签列表 */}
                                    <div className="mb-3">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1"
                                            onClick={() => openTagForm()}
                                        >
                                            <Plus className="h-3 w-3" />
                                            添加标签
                                        </Button>
                                    </div>

                                    <div className="space-y-1">
                                        {selectedGroup.tags.length === 0 ? (
                                            <div className="py-8 text-center text-sm text-muted-foreground">
                                                暂无标签，点击上方按钮添加
                                            </div>
                                        ) : (
                                            selectedGroup.tags.map((tag) => (
                                                <div
                                                    key={tag.id}
                                                    className="flex items-center justify-between rounded-md border p-2"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <TagBadge tag={tag} size="md" />
                                                        <span className="text-xs text-muted-foreground">
                                                            {usageStats[tag.id] || 0} 个账户
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            onClick={() => openTagForm(tag)}
                                                        >
                                                            <Edit2 className="h-3 w-3" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 text-destructive hover:text-destructive"
                                                            onClick={() => deleteTag(tag)}
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                    选择或创建一个标签组
                                </div>
                            )}
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="outline" onClick={onClose}>
                        关闭
                    </Button>
                </ModalFooter>
            </ModalContent>

            {/* 标签组表单弹窗 */}
            <Modal open={showGroupForm} onOpenChange={setShowGroupForm}>
                <ModalContent size="sm">
                    <ModalHeader>
                        <ModalTitle>{editingGroup ? '编辑标签组' : '新建标签组'}</ModalTitle>
                    </ModalHeader>
                    <ModalBody className="space-y-4">
                        <div className="space-y-2">
                            <Label>名称</Label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="输入标签组名称"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>描述（可选）</Label>
                            <Input
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="输入描述"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>选择类型</Label>
                            <Select
                                value={formData.selectionType}
                                onValueChange={(value: 'single' | 'multiple') =>
                                    setFormData({ ...formData, selectionType: value })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="multiple">多选 - 可以选择多个标签</SelectItem>
                                    <SelectItem value="single">单选 - 只能选择一个标签（互斥）</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>默认颜色</Label>
                            <div className="flex flex-wrap gap-2">
                                {COLOR_OPTIONS.map((color) => (
                                    <button
                                        key={color.value}
                                        onClick={() => setFormData({ ...formData, color: color.value })}
                                        className={cn(
                                            'h-6 w-6 rounded-full transition-all',
                                            color.preview,
                                            formData.color === color.value && 'ring-2 ring-primary ring-offset-2'
                                        )}
                                        title={color.label}
                                    />
                                ))}
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="outline" onClick={() => setShowGroupForm(false)}>
                            取消
                        </Button>
                        <Button onClick={saveGroup} disabled={saving}>
                            {saving ? '保存中...' : '保存'}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            {/* 标签表单弹窗 */}
            <Modal open={showTagForm} onOpenChange={setShowTagForm}>
                <ModalContent size="sm">
                    <ModalHeader>
                        <ModalTitle>{editingTag ? '编辑标签' : '新建标签'}</ModalTitle>
                    </ModalHeader>
                    <ModalBody className="space-y-4">
                        <div className="space-y-2">
                            <Label>名称</Label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="输入标签名称"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>颜色</Label>
                            <div className="flex flex-wrap gap-2">
                                {COLOR_OPTIONS.map((color) => (
                                    <button
                                        key={color.value}
                                        onClick={() => setFormData({ ...formData, color: color.value })}
                                        className={cn(
                                            'h-6 w-6 rounded-full transition-all',
                                            color.preview,
                                            formData.color === color.value && 'ring-2 ring-primary ring-offset-2'
                                        )}
                                        title={color.label}
                                    />
                                ))}
                            </div>
                        </div>
                        <div className="rounded-md bg-muted p-3">
                            <p className="text-sm text-muted-foreground">预览：</p>
                            <TagBadge
                                tag={{
                                    id: 0,
                                    groupId: selectedGroup?.id || 0,
                                    name: formData.name || '示例标签',
                                    color: formData.color,
                                    sortOrder: 0,
                                }}
                                size="md"
                            />
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="outline" onClick={() => setShowTagForm(false)}>
                            取消
                        </Button>
                        <Button onClick={saveTag} disabled={saving}>
                            {saving ? '保存中...' : '保存'}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </Modal>
    )
}
