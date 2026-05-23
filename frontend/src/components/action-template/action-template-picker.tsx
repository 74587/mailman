'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Zap,
    Search,
    Loader2,
    FolderOpen,
    Clock,
    TrendingUp,
    Import,
    CheckCircle,
    Tag,
    X,
} from 'lucide-react'
import {
    actionTemplateService,
    ActionTemplateListItem,
    ActionConfig,
} from '@/services/action-template.service'
import { cn } from '@/lib/utils'

// 预定义分类
const PRESET_CATEGORIES = [
    { value: 'common', label: '常用' },
    { value: 'forward', label: '邮件转发' },
    { value: 'notify', label: '消息通知' },
    { value: 'transform', label: '内容处理' },
    { value: 'label', label: '标签管理' },
    { value: 'other', label: '其他' },
]

interface ActionTemplatePickerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (actions: ActionConfig[]) => void
}

export function ActionTemplatePicker({
    open,
    onOpenChange,
    onSelect,
}: ActionTemplatePickerProps) {
    const [templates, setTemplates] = useState<ActionTemplateListItem[]>([])
    const [allTemplates, setAllTemplates] = useState<ActionTemplateListItem[]>([])
    const [loading, setLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string>('')
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [availableTags, setAvailableTags] = useState<string[]>([])
    const [selectedTemplate, setSelectedTemplate] = useState<ActionTemplateListItem | null>(null)
    const [loadingDetail, setLoadingDetail] = useState(false)

    // 加载模板列表
    const loadTemplates = useCallback(async () => {
        setLoading(true)
        try {
            const response = await actionTemplateService.list({
                page: 1,
                pageSize: 100,
                category: selectedCategory || undefined,
                search: searchQuery || undefined,
            })
            const items = response.items || []
            setAllTemplates(items)

            // 提取所有可用标签
            const tags = new Set<string>()
            items.forEach(t => {
                t.tags?.forEach(tag => tags.add(tag))
            })
            setAvailableTags(Array.from(tags).sort())

            // 根据标签筛选
            filterByTags(items, selectedTags)
        } catch (error) {
            console.error('加载动作模板失败:', error)
        } finally {
            setLoading(false)
        }
    }, [selectedCategory, searchQuery])

    // 根据标签筛选模板
    const filterByTags = useCallback((items: ActionTemplateListItem[], tags: string[]) => {
        if (tags.length === 0) {
            setTemplates(items)
        } else {
            const filtered = items.filter(t =>
                tags.every(tag => t.tags?.includes(tag))
            )
            setTemplates(filtered)
        }
    }, [])

    useEffect(() => {
        if (open) {
            loadTemplates()
        }
    }, [open, loadTemplates])

    // 标签变化时重新筛选
    useEffect(() => {
        filterByTags(allTemplates, selectedTags)
    }, [selectedTags, allTemplates, filterByTags])

    // 获取分类标签
    const getCategoryLabel = (value: string) => {
        const preset = PRESET_CATEGORIES.find(c => c.value === value)
        return preset?.label || value
    }

    // 切换标签选择
    const toggleTag = (tag: string) => {
        setSelectedTags(prev =>
            prev.includes(tag)
                ? prev.filter(t => t !== tag)
                : [...prev, tag]
        )
    }

    // 清除所有标签
    const clearTags = () => {
        setSelectedTags([])
    }

    // 应用模板
    const handleApply = async () => {
        if (!selectedTemplate) return

        setLoadingDetail(true)
        try {
            // 获取完整的模板数据
            const fullTemplate = await actionTemplateService.get(selectedTemplate.id)

            // 增加使用次数
            await actionTemplateService.incrementUsage(selectedTemplate.id)

            // 保存动作数据
            const actions = fullTemplate.actions

            // 重置状态
            setSelectedTemplate(null)
            setSearchQuery('')
            setSelectedCategory('')
            setSelectedTags([])
            setLoadingDetail(false)

            // 关闭 Dialog
            onOpenChange(false)

            // 使用 setTimeout 确保 Dialog 完全关闭后再更新数据
            setTimeout(() => {
                onSelect(actions)
            }, 100)
        } catch (error) {
            console.error('应用模板失败:', error)
            setLoadingDetail(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Zap className="h-5 w-5 text-amber-500" />
                        选择动作模板
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-3 py-3">
                    {/* 搜索和分类筛选 */}
                    <div className="flex gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="搜索模板..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <Select
                            value={selectedCategory}
                            onValueChange={value => setSelectedCategory(value === 'all' ? '' : value)}
                        >
                            <SelectTrigger className="w-[140px]">
                                <SelectValue placeholder="全部分类" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部分类</SelectItem>
                                {PRESET_CATEGORIES.map(cat => (
                                    <SelectItem key={cat.value} value={cat.value}>
                                        {cat.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* 标签筛选 */}
                    {availableTags.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Tag className="h-4 w-4 text-gray-400" />
                                <span className="text-sm text-gray-500">标签筛选：</span>
                                {selectedTags.length > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={clearTags}
                                        className="h-6 px-2 text-xs text-gray-500 hover:text-gray-700"
                                    >
                                        清除
                                    </Button>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {availableTags.map(tag => (
                                    <Badge
                                        key={tag}
                                        variant={selectedTags.includes(tag) ? "default" : "outline"}
                                        className={cn(
                                            "cursor-pointer text-xs transition-all",
                                            selectedTags.includes(tag)
                                                ? "bg-amber-500 hover:bg-amber-600"
                                                : "hover:bg-gray-100 dark:hover:bg-gray-800"
                                        )}
                                        onClick={() => toggleTag(tag)}
                                    >
                                        {tag}
                                        {selectedTags.includes(tag) && (
                                            <X className="h-3 w-3 ml-1" />
                                        )}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 模板列表 */}
                    <div className="flex-1 overflow-y-auto max-h-[350px] space-y-2">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                            </div>
                        ) : templates.length === 0 ? (
                            <div className="text-center py-8">
                                <FolderOpen className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                                <p className="text-sm text-gray-500">
                                    {searchQuery || selectedCategory || selectedTags.length > 0
                                        ? '未找到匹配的模板'
                                        : '暂无动作模板'}
                                </p>
                            </div>
                        ) : (
                            templates.map(template => (
                                <div
                                    key={template.id}
                                    className={cn(
                                        'p-3 rounded-lg border cursor-pointer transition-all',
                                        selectedTemplate?.id === template.id
                                            ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                    )}
                                    onClick={() => setSelectedTemplate(template)}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-medium truncate">
                                                    {template.name}
                                                </h4>
                                                {template.isBuiltin && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        内置
                                                    </Badge>
                                                )}
                                                <Badge variant="outline" className="text-xs">
                                                    {template.actionCount} 个动作
                                                </Badge>
                                                {selectedTemplate?.id === template.id && (
                                                    <CheckCircle className="h-4 w-4 text-amber-500" />
                                                )}
                                            </div>
                                            {template.description && (
                                                <p className="text-sm text-gray-500 mt-1 truncate">
                                                    {template.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 mt-2">
                                        {template.category && (
                                            <Badge variant="outline" className="text-xs">
                                                {getCategoryLabel(template.category)}
                                            </Badge>
                                        )}
                                        {template.tags?.slice(0, 3).map(tag => (
                                            <Badge
                                                key={tag}
                                                variant="secondary"
                                                className={cn(
                                                    "text-xs",
                                                    selectedTags.includes(tag) && "bg-amber-100 text-amber-700"
                                                )}
                                            >
                                                {tag}
                                            </Badge>
                                        ))}
                                        {template.tags && template.tags.length > 3 && (
                                            <span className="text-xs text-gray-400">
                                                +{template.tags.length - 3}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                                        <span className="flex items-center gap-1">
                                            <TrendingUp className="h-3 w-3" />
                                            使用 {template.usageCount} 次
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {new Date(template.createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <div className="flex items-center gap-3 w-full">
                        <p className="flex-1 text-xs text-gray-500">
                            选择模板后，动作配置将被添加到当前列表中（不保留引用关系）
                        </p>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button
                            onClick={handleApply}
                            disabled={!selectedTemplate || loadingDetail}
                            className="bg-amber-500 hover:bg-amber-600"
                        >
                            {loadingDetail && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            <Import className="h-4 w-4 mr-2" />
                            应用模板
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
