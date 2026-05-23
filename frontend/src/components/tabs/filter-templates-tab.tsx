'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@/components/ui/tabs'
import {
    Filter,
    Plus,
    Search,
    Edit,
    Trash2,
    Copy,
    Eye,
    Loader2,
    FolderOpen,
    Tag,
    Clock,
    TrendingUp,
    AlertCircle,
    CheckCircle,
    X,
    Code,
    Layers,
} from 'lucide-react'
import {
    filterTemplateService,
    FilterTemplate,
    FilterTemplateListItem,
    FilterTemplateRequest,
} from '@/services/filter-template.service'
import { FilterSection } from '@/components/filter-action-trigger/filter-section'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'

// 预定义分类
const PRESET_CATEGORIES = [
    { value: 'common', label: '常用' },
    { value: 'sender', label: '发件人相关' },
    { value: 'content', label: '邮件内容' },
    { value: 'time', label: '时间相关' },
    { value: 'attachment', label: '附件相关' },
    { value: 'other', label: '其他' },
]

export default function FilterTemplatesTab() {
    // 状态
    const [templates, setTemplates] = useState<FilterTemplateListItem[]>([])
    const [categories, setCategories] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [selectedCategory, setSelectedCategory] = useState<string>('')
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const pageSize = 12

    // 编辑/创建对话框
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [editingTemplate, setEditingTemplate] = useState<FilterTemplate | null>(null)
    const [formData, setFormData] = useState<FilterTemplateRequest>({
        name: '',
        description: '',
        category: '',
        tags: [],
        expressions: [],
    })
    const [saving, setSaving] = useState(false)
    const [formError, setFormError] = useState('')
    const [editViewMode, setEditViewMode] = useState<'visual' | 'json'>('visual')

    // 预览对话框
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false)
    const [previewTemplate, setPreviewTemplate] = useState<FilterTemplate | null>(null)
    const [loadingPreview, setLoadingPreview] = useState(false)
    const [previewViewMode, setPreviewViewMode] = useState<'visual' | 'json'>('visual')

    // 删除确认
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deletingId, setDeletingId] = useState<number | null>(null)
    const [deleting, setDeleting] = useState(false)

    // 标签输入
    const [tagInput, setTagInput] = useState('')

    // 加载模板列表
    const loadTemplates = useCallback(async () => {
        setLoading(true)
        try {
            const response = await filterTemplateService.list({
                page,
                pageSize,
                category: selectedCategory || undefined,
                search: searchQuery || undefined,
            })
            setTemplates(response.items || [])
            setTotal(response.total)
        } catch (error) {
            console.error('加载过滤器模板失败:', error)
        } finally {
            setLoading(false)
        }
    }, [page, pageSize, selectedCategory, searchQuery])

    // 加载分类
    const loadCategories = useCallback(async () => {
        try {
            const cats = await filterTemplateService.getCategories()
            setCategories(cats)
        } catch (error) {
            console.error('加载分类失败:', error)
        }
    }, [])

    useEffect(() => {
        loadTemplates()
    }, [loadTemplates])

    useEffect(() => {
        loadCategories()
    }, [loadCategories])

    // 打开创建对话框
    const handleCreate = () => {
        setEditingTemplate(null)
        setFormData({
            name: '',
            description: '',
            category: '',
            tags: [],
            expressions: [],
        })
        setFormError('')
        setEditViewMode('visual')
        setEditDialogOpen(true)
    }

    // 打开编辑对话框
    const handleEdit = async (id: number) => {
        setLoadingPreview(true)
        try {
            const template = await filterTemplateService.get(id)
            setEditingTemplate(template)
            setFormData({
                name: template.name,
                description: template.description || '',
                category: template.category || '',
                tags: template.tags || [],
                expressions: template.expressions || [],
            })
            setFormError('')
            setEditViewMode('visual')
            setEditDialogOpen(true)
        } catch (error) {
            console.error('加载模板详情失败:', error)
        } finally {
            setLoadingPreview(false)
        }
    }

    // 打开预览对话框
    const handlePreview = async (id: number) => {
        setLoadingPreview(true)
        try {
            const template = await filterTemplateService.get(id)
            setPreviewTemplate(template)
            setPreviewViewMode('visual')
            setPreviewDialogOpen(true)
        } catch (error) {
            console.error('加载模板详情失败:', error)
        } finally {
            setLoadingPreview(false)
        }
    }

    // 保存模板
    const handleSave = async () => {
        if (!formData.name.trim()) {
            setFormError('请输入模板名称')
            return
        }

        if (formData.expressions.length === 0) {
            setFormError('请配置过滤表达式')
            return
        }

        setSaving(true)
        setFormError('')

        try {
            if (editingTemplate) {
                await filterTemplateService.update(editingTemplate.id, formData)
            } else {
                await filterTemplateService.create(formData)
            }
            setEditDialogOpen(false)
            loadTemplates()
            loadCategories()
        } catch (error: any) {
            setFormError(error.message || '保存失败')
        } finally {
            setSaving(false)
        }
    }

    // 删除模板
    const handleDelete = async () => {
        if (!deletingId) return

        setDeleting(true)
        try {
            await filterTemplateService.delete(deletingId)
            setDeleteDialogOpen(false)
            setDeletingId(null)
            loadTemplates()
            loadCategories()
        } catch (error) {
            console.error('删除失败:', error)
        } finally {
            setDeleting(false)
        }
    }

    // 复制模板
    const handleDuplicate = async (id: number) => {
        try {
            const template = await filterTemplateService.get(id)
            setEditingTemplate(null)
            setFormData({
                name: `${template.name} (副本)`,
                description: template.description || '',
                category: template.category || '',
                tags: template.tags || [],
                expressions: template.expressions || [],
            })
            setFormError('')
            setEditViewMode('visual')
            setEditDialogOpen(true)
        } catch (error) {
            console.error('复制模板失败:', error)
        }
    }

    // 添加标签
    const handleAddTag = () => {
        if (tagInput.trim() && !formData.tags?.includes(tagInput.trim())) {
            setFormData(prev => ({
                ...prev,
                tags: [...(prev.tags || []), tagInput.trim()],
            }))
            setTagInput('')
        }
    }

    // 移除标签
    const handleRemoveTag = (tag: string) => {
        setFormData(prev => ({
            ...prev,
            tags: prev.tags?.filter(t => t !== tag) || [],
        }))
    }

    // 获取分类标签
    const getCategoryLabel = (value: string) => {
        const preset = PRESET_CATEGORIES.find(c => c.value === value)
        return preset?.label || value
    }

    // 计算总页数
    const totalPages = Math.ceil(total / pageSize)

    return (
        <div className="space-y-6">
            {/* 页面标题 */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Filter className="h-6 w-6 text-blue-500" />
                        过滤器模板
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        管理和复用常用的过滤条件模板
                    </p>
                </div>
                <Button onClick={handleCreate} className="gap-2">
                    <Plus className="h-4 w-4" />
                    创建模板
                </Button>
            </div>

            {/* 搜索和筛选 */}
            <Card>
                <CardContent className="py-4">
                    <div className="flex gap-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                                placeholder="搜索模板名称或描述..."
                                value={searchQuery}
                                onChange={e => {
                                    setSearchQuery(e.target.value)
                                    setPage(1)
                                }}
                                className="pl-10"
                            />
                        </div>
                        <Select
                            value={selectedCategory}
                            onValueChange={value => {
                                setSelectedCategory(value === 'all' ? '' : value)
                                setPage(1)
                            }}
                        >
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="全部分类" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部分类</SelectItem>
                                {PRESET_CATEGORIES.map(cat => (
                                    <SelectItem key={cat.value} value={cat.value}>
                                        {cat.label}
                                    </SelectItem>
                                ))}
                                {categories
                                    .filter(c => !PRESET_CATEGORIES.find(p => p.value === c))
                                    .map(cat => (
                                        <SelectItem key={cat} value={cat}>
                                            {cat}
                                        </SelectItem>
                                    ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* 模板列表 */}
            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
            ) : templates.length === 0 ? (
                <Card>
                    <CardContent className="py-12">
                        <div className="text-center">
                            <FolderOpen className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                            <p className="text-gray-500">
                                {searchQuery || selectedCategory
                                    ? '未找到匹配的模板'
                                    : '暂无过滤器模板，点击上方按钮创建'}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {templates.map(template => (
                        <Card
                            key={template.id}
                            className={cn(
                                'group hover:shadow-md transition-shadow cursor-pointer',
                                template.isBuiltin && 'border-blue-200 dark:border-blue-800'
                            )}
                            onClick={() => handlePreview(template.id)}
                        >
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-medium truncate flex items-center gap-2">
                                            {template.name}
                                            {template.isBuiltin && (
                                                <Badge variant="secondary" className="text-xs">
                                                    内置
                                                </Badge>
                                            )}
                                        </h3>
                                        {template.description && (
                                            <p className="text-sm text-gray-500 truncate mt-1">
                                                {template.description}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 mb-3">
                                    {template.category && (
                                        <Badge variant="outline" className="text-xs">
                                            {getCategoryLabel(template.category)}
                                        </Badge>
                                    )}
                                    {template.tags?.slice(0, 2).map(tag => (
                                        <Badge
                                            key={tag}
                                            variant="secondary"
                                            className="text-xs"
                                        >
                                            {tag}
                                        </Badge>
                                    ))}
                                    {template.tags && template.tags.length > 2 && (
                                        <span className="text-xs text-gray-400">
                                            +{template.tags.length - 2}
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center justify-between text-xs text-gray-400">
                                    <div className="flex items-center gap-3">
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

                                {/* 操作按钮 */}
                                <div
                                    className="flex items-center gap-1 mt-3 pt-3 border-t opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={e => e.stopPropagation()}
                                >
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handlePreview(template.id)}
                                    >
                                        <Eye className="h-4 w-4" />
                                    </Button>
                                    {!template.isBuiltin && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleEdit(template.id)}
                                        >
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleDuplicate(template.id)}
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                    {!template.isBuiltin && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-red-500 hover:text-red-600"
                                            onClick={() => {
                                                setDeletingId(template.id)
                                                setDeleteDialogOpen(true)
                                            }}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* 分页 */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 1}
                        onClick={() => setPage(p => p - 1)}
                    >
                        上一页
                    </Button>
                    <span className="text-sm text-gray-500">
                        {page} / {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={page === totalPages}
                        onClick={() => setPage(p => p + 1)}
                    >
                        下一页
                    </Button>
                </div>
            )}

            {/* 创建/编辑对话框 */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>
                            {editingTemplate ? '编辑过滤器模板' : '创建过滤器模板'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto space-y-4 py-4">
                        {formError && (
                            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
                                <AlertCircle className="h-4 w-4" />
                                {formError}
                            </div>
                        )}

                        {/* 基本信息 */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">模板名称 *</label>
                                <Input
                                    value={formData.name}
                                    onChange={e =>
                                        setFormData(prev => ({ ...prev, name: e.target.value }))
                                    }
                                    placeholder="例如：Gmail验证码邮件"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">分类</label>
                                <Select
                                    value={formData.category}
                                    onValueChange={value =>
                                        setFormData(prev => ({ ...prev, category: value }))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="选择分类" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PRESET_CATEGORIES.map(cat => (
                                            <SelectItem key={cat.value} value={cat.value}>
                                                {cat.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">描述</label>
                            <Input
                                value={formData.description}
                                onChange={e =>
                                    setFormData(prev => ({ ...prev, description: e.target.value }))
                                }
                                placeholder="简要描述这个模板的用途..."
                            />
                        </div>

                        {/* 标签 */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium">标签</label>
                            <div className="flex gap-2">
                                <Input
                                    value={tagInput}
                                    onChange={e => setTagInput(e.target.value)}
                                    placeholder="输入标签，按回车添加"
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault()
                                            handleAddTag()
                                        }
                                    }}
                                />
                                <Button type="button" variant="outline" onClick={handleAddTag}>
                                    添加
                                </Button>
                            </div>
                            {formData.tags && formData.tags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {formData.tags.map(tag => (
                                        <Badge
                                            key={tag}
                                            variant="secondary"
                                            className="flex items-center gap-1"
                                        >
                                            {tag}
                                            <X
                                                className="h-3 w-3 cursor-pointer hover:text-red-500"
                                                onClick={() => handleRemoveTag(tag)}
                                            />
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* 过滤表达式 - 带视图切换 */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium">过滤表达式 *</label>
                                <Tabs value={editViewMode} onValueChange={(v) => setEditViewMode(v as 'visual' | 'json')}>
                                    <TabsList className="h-8">
                                        <TabsTrigger value="visual" className="text-xs px-3 h-6 gap-1">
                                            <Layers className="h-3 w-3" />
                                            可视化
                                        </TabsTrigger>
                                        <TabsTrigger value="json" className="text-xs px-3 h-6 gap-1">
                                            <Code className="h-3 w-3" />
                                            JSON
                                        </TabsTrigger>
                                    </TabsList>
                                </Tabs>
                            </div>
                            <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
                                {editViewMode === 'visual' ? (
                                    <FilterSection
                                        filters={formData.expressions}
                                        onChange={expressions =>
                                            setFormData(prev => ({ ...prev, expressions }))
                                        }
                                        testData={{}}
                                        hideHeader={true}
                                    />
                                ) : (
                                    <ScrollArea className="h-[300px]">
                                        <pre className="text-xs font-mono whitespace-pre-wrap">
                                            {JSON.stringify(formData.expressions, null, 2)}
                                        </pre>
                                    </ScrollArea>
                                )}
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                            取消
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            {editingTemplate ? '保存修改' : '创建模板'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 预览对话框 */}
            <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <div className="flex items-center justify-between pr-8">
                            <DialogTitle className="flex items-center gap-2">
                                {previewTemplate?.name}
                                {previewTemplate?.isBuiltin && (
                                    <Badge variant="secondary">内置</Badge>
                                )}
                            </DialogTitle>
                            <Tabs value={previewViewMode} onValueChange={(v) => setPreviewViewMode(v as 'visual' | 'json')}>
                                <TabsList className="h-8">
                                    <TabsTrigger value="visual" className="text-xs px-3 h-6 gap-1">
                                        <Layers className="h-3 w-3" />
                                        可视化
                                    </TabsTrigger>
                                    <TabsTrigger value="json" className="text-xs px-3 h-6 gap-1">
                                        <Code className="h-3 w-3" />
                                        JSON
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </div>
                    </DialogHeader>

                    {previewTemplate && (
                        <div className="flex-1 overflow-y-auto space-y-4 py-4">
                            {previewTemplate.description && (
                                <p className="text-sm text-gray-500">
                                    {previewTemplate.description}
                                </p>
                            )}

                            <div className="flex items-center gap-2 flex-wrap">
                                {previewTemplate.category && (
                                    <Badge variant="outline">
                                        {getCategoryLabel(previewTemplate.category)}
                                    </Badge>
                                )}
                                {previewTemplate.tags?.map(tag => (
                                    <Badge key={tag} variant="secondary">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>

                            <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
                                {previewViewMode === 'visual' ? (
                                    <FilterSection
                                        filters={previewTemplate.expressions || []}
                                        onChange={() => { }}
                                        testData={{}}
                                        readOnly={true}
                                        hideHeader={true}
                                    />
                                ) : (
                                    <ScrollArea className="h-[350px]">
                                        <pre className="text-xs font-mono whitespace-pre-wrap">
                                            {JSON.stringify(previewTemplate.expressions, null, 2)}
                                        </pre>
                                    </ScrollArea>
                                )}
                            </div>

                            <div className="text-xs text-gray-400 flex items-center gap-4">
                                <span className="flex items-center gap-1">
                                    <TrendingUp className="h-3 w-3" />
                                    使用次数: {previewTemplate.usageCount}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    创建时间: {new Date(previewTemplate.createdAt).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPreviewDialogOpen(false)}>
                            关闭
                        </Button>
                        {previewTemplate && !previewTemplate.isBuiltin && (
                            <Button onClick={() => {
                                setPreviewDialogOpen(false)
                                handleEdit(previewTemplate.id)
                            }}>
                                编辑
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 删除确认对话框 */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>确认删除</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-gray-500">
                        确定要删除这个过滤器模板吗？此操作无法撤销。
                    </p>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setDeleteDialogOpen(false)
                                setDeletingId(null)
                            }}
                        >
                            取消
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={deleting}
                        >
                            {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            确认删除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
