'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
    Plus,
    Search,
    MoreVertical,
    Pencil,
    Trash2,
    Play,
    Eye,
    RefreshCw,
    CheckCircle,
    XCircle,
    Clock,
    Package,
    Filter,
    FileText,
    AlertTriangle,
} from 'lucide-react'
import { extractorTemplateV2Service } from '@/services/extractor-template-v2.service'
import type { ExtractorTemplateV2, PaginatedExtractorTemplateV2Response } from '@/types'
import { useTabManager } from '@/components/layout/tab-manager'
import { toast } from 'sonner'

interface ExtractorTemplateListProps {
    onCreateNew?: () => void
}

export function ExtractorTemplateV2List({ onCreateNew }: ExtractorTemplateListProps) {
    const { openTab } = useTabManager()

    // 状态
    const [templates, setTemplates] = useState<ExtractorTemplateV2[]>([])
    const [loading, setLoading] = useState(true)
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [limit] = useState(10)
    const [totalPages, setTotalPages] = useState(1)

    // 筛选状态
    const [search, setSearch] = useState('')
    const [categoryFilter, setCategoryFilter] = useState<string>('__all__')
    const [enabledFilter, setEnabledFilter] = useState<string>('__all__')
    const [categories, setCategories] = useState<string[]>([])

    // 删除确认状态
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [templateToDelete, setTemplateToDelete] = useState<ExtractorTemplateV2 | null>(null)

    // 加载模板列表
    const loadTemplates = useCallback(async () => {
        setLoading(true)
        try {
            const response = await extractorTemplateV2Service.getTemplatesPaginated(page, limit, {
                search: search || undefined,
                category: categoryFilter === '__all__' ? undefined : categoryFilter,
                enabled: enabledFilter === '__all__' ? undefined : enabledFilter === 'true',
            })
            setTemplates(response.templates || [])
            setTotal(response.total)
            setTotalPages(response.totalPages)
        } catch (error) {
            console.error('Failed to load templates:', error)
            toast.error('加载模板列表失败')
        } finally {
            setLoading(false)
        }
    }, [page, limit, search, categoryFilter, enabledFilter])

    // 加载分类
    const loadCategories = useCallback(async () => {
        try {
            const cats = await extractorTemplateV2Service.getCategories()
            setCategories(cats)
        } catch (error) {
            console.error('Failed to load categories:', error)
        }
    }, [])

    useEffect(() => {
        loadTemplates()
    }, [loadTemplates])

    useEffect(() => {
        loadCategories()
    }, [loadCategories])

    // 处理搜索
    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        setPage(1)
        loadTemplates()
    }

    // 创建新模板
    const handleCreateNew = () => {
        const tempId = `create-${Date.now()}`
        openTab({
            id: `extractor-v2-create-${tempId}`,
            title: '新建取件模板',
            type: 'extractor-v2-create',
            icon: 'package',
            closable: true,
            data: { tempId },
        })
    }

    // 编辑模板
    const handleEdit = (template: ExtractorTemplateV2) => {
        openTab({
            id: `extractor-v2-edit-${template.id}`,
            title: `编辑: ${template.name}`,
            type: 'extractor-v2-edit',
            icon: 'package',
            closable: true,
            data: { templateId: template.id },
        })
    }

    // 查看模板
    const handleView = (template: ExtractorTemplateV2) => {
        openTab({
            id: `extractor-v2-view-${template.id}`,
            title: template.name,
            type: 'extractor-v2-view',
            icon: 'package',
            closable: true,
            data: { templateId: template.id, readOnly: true },
        })
    }

    // 查看日志
    const handleViewLogs = (template: ExtractorTemplateV2) => {
        openTab({
            id: `extractor-v2-logs-${template.id}`,
            title: `日志: ${template.name}`,
            type: 'extractor-v2-logs',
            icon: 'file-text',
            closable: true,
            data: { templateId: template.id, templateName: template.name },
        })
    }

    // 删除模板
    const handleDelete = async () => {
        if (!templateToDelete) return

        try {
            await extractorTemplateV2Service.deleteTemplate(templateToDelete.id)
            toast.success('模板已删除')
            loadTemplates()
        } catch (error) {
            console.error('Failed to delete template:', error)
            toast.error('删除模板失败')
        } finally {
            setDeleteDialogOpen(false)
            setTemplateToDelete(null)
        }
    }

    // 切换启用状态
    const handleToggleEnabled = async (template: ExtractorTemplateV2) => {
        if (!template.enabled && template.compatibility && !template.compatibility.compatible) {
            toast.error(template.compatibility.message || '模板包含不兼容配置，修复后才能启用')
            return
        }

        try {
            await extractorTemplateV2Service.updateTemplate(template.id, {
                enabled: !template.enabled,
            })
            toast.success(template.enabled ? '模板已禁用' : '模板已启用')
            loadTemplates()
        } catch (error) {
            console.error('Failed to toggle template:', error)
            toast.error('操作失败')
        }
    }

    // 格式化时间
    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-'
        return new Date(dateStr).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    // 计算成功率
    const getSuccessRate = (template: ExtractorTemplateV2) => {
        if (template.totalExtractions === 0) return '-'
        const rate = (template.successExtractions / template.totalExtractions * 100).toFixed(1)
        return `${rate}%`
    }

    return (
        <div className="flex flex-col h-full">
            {/* 头部工具栏 */}
            <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-semibold">取件模板 V2</h2>
                    <Badge variant="secondary">{total} 个模板</Badge>
                </div>

                <div className="flex items-center gap-3">
                    {/* 搜索框 */}
                    <form onSubmit={handleSearch} className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                placeholder="搜索模板..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9 w-64"
                            />
                        </div>
                    </form>

                    {/* 分类筛选 */}
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="w-32">
                            <SelectValue placeholder="所有分类" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">所有分类</SelectItem>
                            {categories.map((cat) => (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* 状态筛选 */}
                    <Select value={enabledFilter} onValueChange={setEnabledFilter}>
                        <SelectTrigger className="w-28">
                            <SelectValue placeholder="所有状态" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all__">所有状态</SelectItem>
                            <SelectItem value="true">已启用</SelectItem>
                            <SelectItem value="false">已禁用</SelectItem>
                        </SelectContent>
                    </Select>

                    {/* 刷新按钮 */}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={loadTemplates}
                        disabled={loading}
                    >
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                    </Button>

                    {/* 新建按钮 */}
                    <Button onClick={handleCreateNew}>
                        <Plus className="w-4 h-4 mr-2" />
                        新建模板
                    </Button>
                </div>
            </div>

            {/* 表格内容 */}
            <div className="flex-1 overflow-auto p-4">
                <Card>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12">状态</TableHead>
                                <TableHead>名称</TableHead>
                                <TableHead>分类</TableHead>
                                <TableHead className="text-center">动作数</TableHead>
                                <TableHead className="text-center">执行次数</TableHead>
                                <TableHead className="text-center">成功率</TableHead>
                                <TableHead>最后执行</TableHead>
                                <TableHead>创建时间</TableHead>
                                <TableHead className="w-20">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="text-center py-8">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                                        <p className="mt-2 text-muted-foreground">加载中...</p>
                                    </TableCell>
                                </TableRow>
                            ) : templates.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="text-center py-8">
                                        <Package className="w-12 h-12 mx-auto text-muted-foreground/50" />
                                        <p className="mt-2 text-muted-foreground">暂无取件模板</p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-4"
                                            onClick={handleCreateNew}
                                        >
                                            <Plus className="w-4 h-4 mr-2" />
                                            创建第一个模板
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                templates.map((template) => (
                                    <TableRow
                                        key={template.id}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => handleView(template)}
                                    >
                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => handleToggleEnabled(template)}
                                                className="focus:outline-none"
                                            >
                                                {template.enabled ? (
                                                    <CheckCircle className="w-5 h-5 text-green-500" />
                                                ) : (
                                                    <XCircle className="w-5 h-5 text-muted-foreground" />
                                                )}
                                            </button>
                                        </TableCell>
                                        <TableCell>
                                            <div>
                                                <p className="font-medium">{template.name}</p>
                                                {template.compatibility && !template.compatibility.compatible && (
                                                    <Badge
                                                        variant="destructive"
                                                        className="mt-1 gap-1"
                                                        title={template.compatibility.issues?.map(issue => issue.message).join('\n') || template.compatibility.message}
                                                    >
                                                        <AlertTriangle className="w-3 h-3" />
                                                        不兼容
                                                    </Badge>
                                                )}
                                                {template.description && (
                                                    <p className="text-sm text-muted-foreground line-clamp-1">
                                                        {template.description}
                                                    </p>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {template.category ? (
                                                <Badge variant="secondary">{template.category}</Badge>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {template.actions?.length || 0}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {template.totalExtractions}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className={cn(
                                                template.totalExtractions > 0 &&
                                                    template.successExtractions / template.totalExtractions >= 0.9
                                                    ? 'text-green-600'
                                                    : template.totalExtractions > 0 &&
                                                        template.successExtractions / template.totalExtractions < 0.5
                                                        ? 'text-red-600'
                                                        : ''
                                            )}>
                                                {getSuccessRate(template)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm text-muted-foreground">
                                                {formatDate(template.lastExtractedAt)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm text-muted-foreground">
                                                {formatDate(template.createdAt)}
                                            </span>
                                        </TableCell>
                                        <TableCell onClick={(e) => e.stopPropagation()}>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon">
                                                        <MoreVertical className="w-4 h-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleView(template)}>
                                                        <Eye className="w-4 h-4 mr-2" />
                                                        查看
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleEdit(template)}>
                                                        <Pencil className="w-4 h-4 mr-2" />
                                                        编辑
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleViewLogs(template)}>
                                                        <FileText className="w-4 h-4 mr-2" />
                                                        查看日志
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => {
                                                            setTemplateToDelete(template)
                                                            setDeleteDialogOpen(true)
                                                        }}
                                                        className="text-destructive"
                                                    >
                                                        <Trash2 className="w-4 h-4 mr-2" />
                                                        删除
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </Card>

                {/* 分页 */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                        <p className="text-sm text-muted-foreground">
                            显示 {(page - 1) * limit + 1} - {Math.min(page * limit, total)} 条，共 {total} 条
                        </p>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page === 1}
                                onClick={() => setPage(page - 1)}
                            >
                                上一页
                            </Button>
                            <span className="text-sm">
                                {page} / {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page === totalPages}
                                onClick={() => setPage(page + 1)}
                            >
                                下一页
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* 删除确认对话框 */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>确认删除</AlertDialogTitle>
                        <AlertDialogDescription>
                            确定要删除模板 &ldquo;{templateToDelete?.name}&rdquo; 吗？此操作不可撤销。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                            删除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

export default ExtractorTemplateV2List
