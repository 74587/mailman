'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { extractorTemplateV2Service } from '@/services/extractor-template-v2.service'
import { ExtractorTemplateV2 } from '@/types'
import { ExpressionGroup } from '@/components/expression-builder/expression-group'
import { ActionReadonlyView } from '@/components/triggers/action-readonly-view'
import {
    Loader2,
    Info,
    Filter,
    Zap,
    ClipboardList,
    BarChart3,
    Calendar,
    Hash,
    Eye,
    CheckCircle,
    Clock,
    Play,
    Pause,
    Settings,
    Package,
    Tag,
    FileOutput,
    AlertCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface ExtractorTemplateV2ViewTabProps {
    templateId: number
}

export function ExtractorTemplateV2ViewTab({ templateId }: ExtractorTemplateV2ViewTabProps) {
    const [template, setTemplate] = useState<ExtractorTemplateV2 | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [leftTab, setLeftTab] = useState('info')
    const [rightTab, setRightTab] = useState('logs')

    // 加载模板数据
    useEffect(() => {
        loadTemplate()
    }, [templateId])

    const loadTemplate = async () => {
        try {
            setIsLoading(true)
            setError(null)
            const templateData = await extractorTemplateV2Service.getTemplate(templateId)
            setTemplate(templateData)
        } catch (err: any) {
            console.error('加载模板失败:', err)
            setError(err.message || '加载模板失败')
        } finally {
            setIsLoading(false)
        }
    }

    // 处理状态变更
    const handleStatusChange = async () => {
        if (!template) return
        try {
            await extractorTemplateV2Service.updateTemplate(templateId, {
                enabled: !template.enabled
            })
            // 重新加载模板数据
            await loadTemplate()
            toast.success(template.enabled ? '模板已禁用' : '模板已启用')
        } catch (error) {
            console.error('更改模板状态失败:', error)
            toast.error('更改模板状态失败')
        }
    }

    // 打开编辑 Tab
    const handleEdit = () => {
        const tabId = `extractor-v2-edit-${templateId}`
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: tabId,
                data: { templateId }
            }
        }))
    }

    // 打开日志 Tab
    const handleViewLogs = () => {
        const tabId = `extractor-v2-logs-${templateId}`
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: tabId,
                data: { templateId }
            }
        }))
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                    <p className="mt-4 text-gray-600">加载模板详情...</p>
                </div>
            </div>
        )
    }

    if (error || !template) {
        return (
            <div className="flex items-center justify-center h-full">
                <Card className="p-6 max-w-md">
                    <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-5 w-5 text-red-600" />
                        <h3 className="text-lg font-semibold text-red-600">加载失败</h3>
                    </div>
                    <p className="text-gray-600 mb-4">{error || '模板不存在'}</p>
                    <Button onClick={loadTemplate} variant="outline" size="sm">
                        重试
                    </Button>
                </Card>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* 顶部标题栏 */}
            <div className="bg-white dark:bg-gray-800 border-b px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Package className="h-6 w-6 text-blue-600" />
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                                    {template.name}
                                </h1>
                                {template.category && (
                                    <Badge variant="outline" className="text-xs">
                                        {template.category}
                                    </Badge>
                                )}
                            </div>
                            <p className="text-sm text-gray-500">
                                {template.description || '暂无描述'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge className={cn(
                            template.enabled
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        )}>
                            {template.enabled ? (
                                <><CheckCircle className="h-3 w-3 mr-1" />已启用</>
                            ) : (
                                <><Clock className="h-3 w-3 mr-1" />已禁用</>
                            )}
                        </Badge>
                        <Button variant="outline" size="sm" onClick={handleStatusChange}>
                            {template.enabled ? (
                                <><Pause className="h-4 w-4 mr-1" />禁用</>
                            ) : (
                                <><Play className="h-4 w-4 mr-1" />启用</>
                            )}
                        </Button>
                        <Button size="sm" onClick={handleEdit}>
                            <Settings className="h-4 w-4 mr-1" />
                            编辑
                        </Button>
                    </div>
                </div>
            </div>

            {/* 主要内容区域 - 左右分栏 */}
            <div className="flex-1 flex overflow-hidden">
                {/* 左侧配置面板 */}
                <div className="w-[45%] border-r bg-white dark:bg-gray-800 overflow-hidden flex flex-col">
                    <Tabs value={leftTab} onValueChange={setLeftTab} className="flex flex-col h-full">
                        <TabsList className="grid w-full grid-cols-4 mx-4 mt-4 max-w-[calc(100%-2rem)]">
                            <TabsTrigger value="info" className="flex items-center gap-1">
                                <Info className="h-4 w-4" />
                                基本信息
                            </TabsTrigger>
                            <TabsTrigger value="filter" className="flex items-center gap-1">
                                <Filter className="h-4 w-4" />
                                过滤配置
                            </TabsTrigger>
                            <TabsTrigger value="action" className="flex items-center gap-1">
                                <Zap className="h-4 w-4" />
                                动作配置
                            </TabsTrigger>
                            <TabsTrigger value="output" className="flex items-center gap-1">
                                <FileOutput className="h-4 w-4" />
                                输出配置
                            </TabsTrigger>
                        </TabsList>

                        <div className="flex-1 overflow-y-auto p-4">
                            <TabsContent value="info" className="m-0 h-full">
                                <ExtractorInfoPanel template={template} />
                            </TabsContent>

                            <TabsContent value="filter" className="m-0 h-full">
                                <ExtractorFilterPanel template={template} />
                            </TabsContent>

                            <TabsContent value="action" className="m-0 h-full">
                                <ExtractorActionPanel template={template} />
                            </TabsContent>

                            <TabsContent value="output" className="m-0 h-full">
                                <ExtractorOutputPanel template={template} />
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>

                {/* 右侧运行数据面板 */}
                <div className="w-[55%] bg-white dark:bg-gray-800 overflow-hidden flex flex-col">
                    <Tabs value={rightTab} onValueChange={setRightTab} className="flex flex-col h-full">
                        <TabsList className="grid w-full grid-cols-2 mx-4 mt-4 max-w-[calc(100%-2rem)]">
                            <TabsTrigger value="logs" className="flex items-center gap-1">
                                <ClipboardList className="h-4 w-4" />
                                执行日志
                            </TabsTrigger>
                            <TabsTrigger value="stats" className="flex items-center gap-1">
                                <BarChart3 className="h-4 w-4" />
                                统计数据
                            </TabsTrigger>
                        </TabsList>

                        <div className="flex-1 overflow-y-auto p-4">
                            <TabsContent value="logs" className="m-0 h-full">
                                <ExtractorLogsPanel templateId={templateId} onViewAll={handleViewLogs} />
                            </TabsContent>

                            <TabsContent value="stats" className="m-0 h-full">
                                <ExtractorStatsPanel templateId={templateId} />
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>
            </div>
        </div>
    )
}

// 基本信息面板
function ExtractorInfoPanel({ template }: { template: ExtractorTemplateV2 }) {
    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('zh-CN')
    }

    return (
        <div className="space-y-6">
            {/* 基本信息卡片 */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Info className="h-4 w-4 text-blue-500" />
                        模板信息
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">ID</label>
                            <p className="text-sm font-medium flex items-center gap-1">
                                <Hash className="h-3 w-3" />
                                {template.id}
                            </p>
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">状态</label>
                            <Badge className={cn(
                                "mt-1",
                                template.enabled
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-gray-100 text-gray-600'
                            )}>
                                {template.enabled ? '已启用' : '已禁用'}
                            </Badge>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wide">名称</label>
                        <p className="text-sm font-medium">{template.name}</p>
                    </div>

                    <div>
                        <label className="text-xs text-gray-500 uppercase tracking-wide">描述</label>
                        <p className="text-sm text-gray-600">{template.description || '暂无描述'}</p>
                    </div>

                    {template.category && (
                        <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">分类</label>
                            <p className="text-sm font-medium">{template.category}</p>
                        </div>
                    )}

                    {template.tags && template.tags.length > 0 && (
                        <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">标签</label>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {template.tags.map((tag, index) => (
                                    <Badge key={index} variant="outline" className="text-xs">
                                        <Tag className="h-3 w-3 mr-1" />
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 时间信息卡片 */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-amber-500" />
                        时间信息
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">创建时间</span>
                        <span className="text-sm font-medium">{formatDate(template.createdAt)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">更新时间</span>
                        <span className="text-sm font-medium">{formatDate(template.updatedAt)}</span>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

// 过滤器配置面板
function ExtractorFilterPanel({ template }: { template: ExtractorTemplateV2 }) {
    const expressions = template.expressions || []

    if (expressions.length === 0) {
        return (
            <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-12">
                    <Filter className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">暂无过滤配置</p>
                    <p className="text-sm text-gray-400 mt-1">此模板将匹配所有邮件</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                    共 {expressions.length} 个表达式条件
                </p>
            </div>

            {expressions.map((expr: any, index: number) => (
                <Card key={index} className="overflow-hidden">
                    <CardHeader className="py-3 bg-gray-50 dark:bg-gray-900/50">
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Filter className="h-4 w-4 text-purple-500" />
                            表达式 {index + 1}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                        <ExpressionGroup
                            expression={expr}
                            onChange={() => { }}
                            onDelete={() => { }}
                            testData={{}}
                            readOnly={true}
                        />
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}

// 动作配置面板
function ExtractorActionPanel({ template }: { template: ExtractorTemplateV2 }) {
    const actions = template.actions || []

    if (actions.length === 0) {
        return (
            <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-12">
                    <Zap className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">暂无动作配置</p>
                    <p className="text-sm text-gray-400 mt-1">此模板没有配置任何提取动作</p>
                </CardContent>
            </Card>
        )
    }

    return <ActionReadonlyView actions={actions} />
}

// 输出配置面板
function ExtractorOutputPanel({ template }: { template: ExtractorTemplateV2 }) {
    const outputConfig = template.outputConfig || { format: 'text', field: 'value' }

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <FileOutput className="h-4 w-4 text-green-500" />
                        输出格式配置
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">输出格式</label>
                            <p className="text-sm font-medium capitalize">{outputConfig.format || 'text'}</p>
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">输出字段</label>
                            <p className="text-sm font-medium font-mono">{outputConfig.field || 'value'}</p>
                        </div>
                    </div>

                    {outputConfig.template && (
                        <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">输出模板</label>
                            <pre className="mt-1 text-sm text-gray-600 bg-gray-50 dark:bg-gray-900 p-3 rounded-lg overflow-x-auto">
                                {outputConfig.template}
                            </pre>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

// 执行日志面板
function ExtractorLogsPanel({ templateId, onViewAll }: { templateId: number, onViewAll: () => void }) {
    const [logs, setLogs] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadLogs()
    }, [templateId])

    const loadLogs = async () => {
        try {
            setLoading(true)
            const response = await extractorTemplateV2Service.getTemplateLogs(templateId, 1, 10)
            setLogs(response.logs || [])
        } catch (error) {
            console.error('加载日志失败:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
        )
    }

    if (logs.length === 0) {
        return (
            <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-12">
                    <ClipboardList className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">暂无执行日志</p>
                    <p className="text-sm text-gray-400 mt-1">模板尚未被执行</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">最近执行记录</p>
                <Button variant="outline" size="sm" onClick={onViewAll}>
                    查看全部
                </Button>
            </div>

            <div className="space-y-2">
                {logs.map((log, index) => (
                    <Card key={index} className={cn(
                        "p-3",
                        log.success ? "border-l-4 border-l-green-500" : "border-l-4 border-l-red-500"
                    )}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                {log.success ? (
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                ) : (
                                    <AlertCircle className="h-4 w-4 text-red-600" />
                                )}
                                <span className="text-sm font-medium">
                                    {log.success ? '提取成功' : '提取失败'}
                                </span>
                            </div>
                            <span className="text-xs text-gray-500">
                                {new Date(log.createdAt).toLocaleString('zh-CN')}
                            </span>
                        </div>
                        {log.extractedValue && (
                            <pre className="mt-2 text-xs text-gray-600 bg-gray-50 dark:bg-gray-900 p-2 rounded overflow-x-auto">
                                {JSON.stringify(log.extractedValue, null, 2).substring(0, 200)}...
                            </pre>
                        )}
                        {log.error && (
                            <p className="mt-1 text-xs text-red-600">{log.error}</p>
                        )}
                    </Card>
                ))}
            </div>
        </div>
    )
}

// 统计数据面板
function ExtractorStatsPanel({ templateId }: { templateId: number }) {
    const [stats, setStats] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadStats()
    }, [templateId])

    const loadStats = async () => {
        try {
            setLoading(true)
            const statsData = await extractorTemplateV2Service.getTemplateStats(templateId)
            setStats(statsData)
        } catch (error) {
            console.error('加载统计数据失败:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
        )
    }

    if (!stats) {
        return (
            <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-12">
                    <BarChart3 className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">暂无统计数据</p>
                </CardContent>
            </Card>
        )
    }

    const successRate = stats.totalExecutions > 0
        ? Math.round((stats.successExecutions / stats.totalExecutions) * 100)
        : 0

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-purple-500" />
                        执行统计
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <p className="text-2xl font-bold text-blue-600">{stats.totalExecutions || 0}</p>
                            <p className="text-xs text-gray-500">总执行次数</p>
                        </div>
                        <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                            <p className="text-2xl font-bold text-green-600">{stats.successExecutions || 0}</p>
                            <p className="text-xs text-gray-500">成功次数</p>
                        </div>
                        <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                            <p className="text-2xl font-bold text-purple-600">{successRate}%</p>
                            <p className="text-xs text-gray-500">成功率</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {stats.lastExecutedAt && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Clock className="h-4 w-4 text-amber-500" />
                            最近执行
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-gray-600">
                            {new Date(stats.lastExecutedAt).toLocaleString('zh-CN')}
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

export default ExtractorTemplateV2ViewTab
