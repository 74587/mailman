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
    FileText,
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
    filterTemplateService,
    FilterTemplateListItem,
} from '@/services/filter-template.service'
import { cn } from '@/lib/utils'

// 预定义分类
const PRESET_CATEGORIES = [
    { value: 'common', label: '常用' },
    { value: 'sender', label: '发件人相关' },
    { value: 'content', label: '邮件内容' },
    { value: 'time', label: '时间相关' },
    { value: 'attachment', label: '附件相关' },
    { value: 'other', label: '其他' },
]

interface FilterTemplatePickerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (expressions: any[]) => void
}

export function FilterTemplatePicker({
    open,
    onOpenChange,
    onSelect,
}: FilterTemplatePickerProps) {
    const [templates, setTemplates] = useState<FilterTemplateListItem[]>([])
    const [allTemplates, setAllTemplates] = useState<FilterTemplateListItem[]>([])
    const [loading, setLoading] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string>('')
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [availableTags, setAvailableTags] = useState<string[]>([])
    const [selectedTemplate, setSelectedTemplate] = useState<FilterTemplateListItem | null>(null)
    const [loadingDetail, setLoadingDetail] = useState(false)

    // 加载模板列表
    const loadTemplates = useCallback(async () => {
        setLoading(true)
        try {
            const response = await filterTemplateService.list({
                page: 1,
                pageSize: 100, // 获取更多以便本地筛选标签
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
            console.error('加载过滤器模板失败:', error)
        } finally {
            setLoading(false)
        }
    }, [selectedCategory, searchQuery])

    // 根据标签筛选模板
    const filterByTags = useCallback((items: FilterTemplateListItem[], tags: string[]) => {
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
            const fullTemplate = await filterTemplateService.get(selectedTemplate.id)

            // 增加使用次数
            await filterTemplateService.incrementUsage(selectedTemplate.id)

            // 保存表达式数据
            const expressions = fullTemplate.expressions

            // 先重置状态和关闭 Dialog
            setSelectedTemplate(null)
            setSearchQuery('')
            setSelectedCategory('')
            setSelectedTags([])
            setLoadingDetail(false)

            // 关闭 Dialog
            onOpenChange(false)

            // 使用 setTimeout 确保 Dialog 完全关闭后再更新数据
            setTimeout(() => {
                onSelect(expressions)
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
                        <FileText className="h-5 w-5 text-blue-500" />
                        选择过滤器模板
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
                                                ? "bg-blue-500 hover:bg-blue-600"
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
                                        : '暂无过滤器模板'}
                                </p>
                            </div>
                        ) : (
                            templates.map(template => (
                                <div
                                    key={template.id}
                                    className={cn(
                                        'p-3 rounded-lg border cursor-pointer transition-all',
                                        selectedTemplate?.id === template.id
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
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
                                                {selectedTemplate?.id === template.id && (
                                                    <CheckCircle className="h-4 w-4 text-blue-500" />
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
                                                    selectedTags.includes(tag) && "bg-blue-100 text-blue-700"
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
                            选择模板后，过滤条件将被直接应用到当前配置中（不保留引用关系）
                        </p>
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button
                            onClick={handleApply}
                            disabled={!selectedTemplate || loadingDetail}
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
