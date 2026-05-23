'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    RefreshCw,
    CheckCircle,
    XCircle,
    AlertCircle,
    Clock,
    Eye,
    ChevronLeft,
    ChevronRight,
    FileText,
} from 'lucide-react'
import { extractorTemplateV2Service } from '@/services/extractor-template-v2.service'
import type { ExtractionLogV2, ActionExecutionResult } from '@/types'
import { toast } from 'sonner'

interface ExtractorLogsViewerProps {
    templateId: number
    templateName?: string
}

export function ExtractorLogsViewer({ templateId, templateName }: ExtractorLogsViewerProps) {
    const [logs, setLogs] = useState<ExtractionLogV2[]>([])
    const [loading, setLoading] = useState(true)
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [limit] = useState(20)
    const [totalPages, setTotalPages] = useState(1)

    // 详情对话框
    const [selectedLog, setSelectedLog] = useState<ExtractionLogV2 | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)

    // 加载日志
    const loadLogs = useCallback(async () => {
        setLoading(true)
        try {
            const response = await extractorTemplateV2Service.getTemplateLogs(templateId, page, limit)
            setLogs(response.logs || [])
            setTotal(response.total)
            setTotalPages(response.totalPages)
        } catch (error) {
            console.error('Failed to load logs:', error)
            toast.error('加载日志失败')
        } finally {
            setLoading(false)
        }
    }, [templateId, page, limit])

    useEffect(() => {
        loadLogs()
    }, [loadLogs])

    // 查看详情
    const handleViewDetail = (log: ExtractionLogV2) => {
        setSelectedLog(log)
        setDetailOpen(true)
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
            second: '2-digit',
        })
    }

    // 格式化耗时
    const formatDuration = (ms?: number) => {
        if (ms === undefined) return '-'
        if (ms < 1000) return `${ms}ms`
        return `${(ms / 1000).toFixed(2)}s`
    }

    // 获取状态显示
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'success':
                return (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        成功
                    </Badge>
                )
            case 'failed':
                return (
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                        <XCircle className="w-3 h-3 mr-1" />
                        失败
                    </Badge>
                )
            case 'no_match':
                return (
                    <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        未匹配
                    </Badge>
                )
            case 'partial':
                return (
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        部分成功
                    </Badge>
                )
            case 'skipped':
                return (
                    <Badge variant="secondary">
                        已跳过
                    </Badge>
                )
            default:
                return (
                    <Badge variant="secondary">{status}</Badge>
                )
        }
    }

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="w-5 h-5" />
                            执行日志
                            {templateName && (
                                <span className="text-muted-foreground font-normal">
                                    - {templateName}
                                </span>
                            )}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                            共 {total} 条记录
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={loadLogs}
                        disabled={loading}
                    >
                        <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
                        刷新
                    </Button>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-20">状态</TableHead>
                                <TableHead>邮件ID</TableHead>
                                <TableHead>过滤匹配</TableHead>
                                <TableHead>动作数</TableHead>
                                <TableHead>耗时</TableHead>
                                <TableHead>执行时间</TableHead>
                                <TableHead className="w-20">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                                        <p className="mt-2 text-muted-foreground">加载中...</p>
                                    </TableCell>
                                </TableRow>
                            ) : logs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8">
                                        <FileText className="w-12 h-12 mx-auto text-muted-foreground/50" />
                                        <p className="mt-2 text-muted-foreground">暂无执行日志</p>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                logs.map((log) => (
                                    <TableRow key={log.id}>
                                        <TableCell>
                                            {getStatusBadge(log.status)}
                                        </TableCell>
                                        <TableCell>
                                            <span className="font-mono text-sm">
                                                #{log.emailId}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            {log.filterMatched ? (
                                                <CheckCircle className="w-4 h-4 text-green-500" />
                                            ) : (
                                                <XCircle className="w-4 h-4 text-muted-foreground" />
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {log.actionResults?.length || 0}
                                        </TableCell>
                                        <TableCell>
                                            <span className="flex items-center gap-1 text-muted-foreground">
                                                <Clock className="w-3 h-3" />
                                                {formatDuration(log.duration)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm text-muted-foreground">
                                                {formatDate(log.createdAt)}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleViewDetail(log)}
                                            >
                                                <Eye className="w-4 h-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>

                    {/* 分页 */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between mt-4">
                            <p className="text-sm text-muted-foreground">
                                显示 {(page - 1) * limit + 1} - {Math.min(page * limit, total)} 条
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={page === 1}
                                    onClick={() => setPage(page - 1)}
                                >
                                    <ChevronLeft className="w-4 h-4" />
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
                                    <ChevronRight className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 详情对话框 */}
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            执行详情
                            {selectedLog && getStatusBadge(selectedLog.status)}
                        </DialogTitle>
                    </DialogHeader>
                    {selectedLog && (
                        <div className="space-y-4">
                            {/* 基本信息 */}
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-muted-foreground">日志ID:</span>
                                    <span className="ml-2 font-mono">#{selectedLog.id}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">邮件ID:</span>
                                    <span className="ml-2 font-mono">#{selectedLog.emailId}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">执行时间:</span>
                                    <span className="ml-2">{formatDate(selectedLog.startTime)}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">耗时:</span>
                                    <span className="ml-2">{formatDuration(selectedLog.duration)}</span>
                                </div>
                            </div>

                            {/* 过滤匹配结果 */}
                            <div className="border rounded-lg p-4">
                                <h4 className="font-medium mb-2">过滤匹配</h4>
                                <div className="flex items-center gap-2">
                                    {selectedLog.filterMatched ? (
                                        <>
                                            <CheckCircle className="w-5 h-5 text-green-500" />
                                            <span className="text-green-600">匹配成功</span>
                                        </>
                                    ) : (
                                        <>
                                            <XCircle className="w-5 h-5 text-red-500" />
                                            <span className="text-red-600">未匹配</span>
                                        </>
                                    )}
                                </div>
                                {selectedLog.filterEvaluation && (
                                    <pre className="mt-2 p-2 bg-muted rounded text-xs font-mono overflow-auto max-h-32">
                                        {selectedLog.filterEvaluation}
                                    </pre>
                                )}
                            </div>

                            {/* 动作执行结果 */}
                            {selectedLog.actionResults && selectedLog.actionResults.length > 0 && (
                                <div className="border rounded-lg p-4">
                                    <h4 className="font-medium mb-2">动作执行</h4>
                                    <div className="space-y-2">
                                        {selectedLog.actionResults.map((result, index) => (
                                            <div
                                                key={index}
                                                className={cn(
                                                    "flex items-center justify-between p-2 rounded border",
                                                    result.success
                                                        ? "bg-green-50 border-green-200 dark:bg-green-900/10 dark:border-green-800"
                                                        : "bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800"
                                                )}
                                            >
                                                <div className="flex items-center gap-2">
                                                    {result.success ? (
                                                        <CheckCircle className="w-4 h-4 text-green-500" />
                                                    ) : (
                                                        <XCircle className="w-4 h-4 text-red-500" />
                                                    )}
                                                    <span className="font-medium">
                                                        {result.pluginName || result.pluginId}
                                                    </span>
                                                </div>
                                                <span className="text-sm text-muted-foreground">
                                                    {formatDuration(result.duration)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 提取结果 */}
                            {selectedLog.extractedResult && (
                                <div className="border rounded-lg p-4">
                                    <h4 className="font-medium mb-2">提取结果</h4>
                                    <pre className="p-2 bg-muted rounded text-xs font-mono overflow-auto max-h-48">
                                        {selectedLog.extractedResult}
                                    </pre>
                                </div>
                            )}

                            {/* 错误信息 */}
                            {selectedLog.error && (
                                <div className="border border-red-200 rounded-lg p-4 bg-red-50 dark:bg-red-900/10">
                                    <h4 className="font-medium text-red-600 mb-2">错误信息</h4>
                                    <p className="text-sm text-red-600">{selectedLog.error}</p>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default ExtractorLogsViewer
