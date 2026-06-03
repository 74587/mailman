'use client'

import React, { useState, useCallback } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { apiClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
    Database,
    Play,
    Loader2,
    Mail,
    Check,
    ChevronRight,
    Clock,
    User,
    Users,
    Search,
    Calendar,
    FileText,
    AlertCircle,
    CheckCircle2,
    XCircle
} from 'lucide-react'

interface FilterTestDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    expressions: any[]
}

interface MatchedEmail {
    id: number
    messageId: string
    subject: string
    from: string
    to: string[]
    receivedAt: string
    bodyPreview: string
    htmlPreview: string
    evaluation: Record<string, any>
}

interface TestResult {
    totalScanned: number
    totalMatched: number
    matchedEmails: MatchedEmail[]
    executionTimeMs: number
}

type DialogStep = 'config' | 'loading' | 'results'

function normalizeEvaluationForDisplay(evaluation: Record<string, any>) {
    return Object.fromEntries(
        Object.entries(evaluation || {}).map(([key, value]) => [key, parseMaybeJson(value)])
    )
}

function parseMaybeJson(value: any): any {
    if (typeof value !== 'string') {
        return value
    }
    const trimmed = value.trim()
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        return value
    }
    try {
        return JSON.parse(trimmed)
    } catch {
        return value
    }
}

export function FilterTestDialog({ open, onOpenChange, expressions }: FilterTestDialogProps) {
    const [step, setStep] = useState<DialogStep>('config')
    const [config, setConfig] = useState({
        startTime: '',
        endTime: '',
        sender: '',
        recipient: '',
        limit: 100
    })
    const [testResult, setTestResult] = useState<TestResult | null>(null)
    const [selectedEmailIndex, setSelectedEmailIndex] = useState<number>(0)
    const [error, setError] = useState<string | null>(null)

    // 重置状态
    const resetState = useCallback(() => {
        setStep('config')
        setTestResult(null)
        setSelectedEmailIndex(0)
        setError(null)
    }, [])

    // 关闭对话框时重置状态
    const handleOpenChange = useCallback((newOpen: boolean) => {
        if (!newOpen) {
            resetState()
        }
        onOpenChange(newOpen)
    }, [onOpenChange, resetState])

    // 执行测试
    const runTest = useCallback(async () => {
        setStep('loading')
        setError(null)

        try {
            const requestBody: any = {
                expressions,
                limit: config.limit || 100
            }

            if (config.startTime) {
                requestBody.startTime = new Date(config.startTime).toISOString()
            }
            if (config.endTime) {
                requestBody.endTime = new Date(config.endTime).toISOString()
            }
            if (config.sender) {
                requestBody.sender = config.sender
            }
            if (config.recipient) {
                requestBody.recipient = config.recipient
            }

            const result = await apiClient.post<TestResult>('/v2/triggers/test-with-db-emails', requestBody)
            setTestResult(result)
            setSelectedEmailIndex(0)
            setStep('results')
        } catch (err: any) {
            setError(err.message || '测试失败')
            setStep('config')
        }
    }, [expressions, config])

    // 格式化日期
    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr)
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    // 渲染配置步骤
    const renderConfigStep = () => (
        <div className="space-y-6">
            <div className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
                <Database className="w-4 h-4" />
                配置扫描参数，从数据库中查询邮件进行过滤测试
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="startTime" className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        开始时间
                    </Label>
                    <Input
                        id="startTime"
                        type="datetime-local"
                        value={config.startTime}
                        onChange={(e) => setConfig(prev => ({ ...prev, startTime: e.target.value }))}
                        placeholder="可选"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="endTime" className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        结束时间
                    </Label>
                    <Input
                        id="endTime"
                        type="datetime-local"
                        value={config.endTime}
                        onChange={(e) => setConfig(prev => ({ ...prev, endTime: e.target.value }))}
                        placeholder="可选"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="sender" className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5" />
                        发件人
                    </Label>
                    <Input
                        id="sender"
                        type="text"
                        value={config.sender}
                        onChange={(e) => setConfig(prev => ({ ...prev, sender: e.target.value }))}
                        placeholder="可选，支持模糊匹配"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="recipient" className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        收件人
                    </Label>
                    <Input
                        id="recipient"
                        type="text"
                        value={config.recipient}
                        onChange={(e) => setConfig(prev => ({ ...prev, recipient: e.target.value }))}
                        placeholder="可选，支持模糊匹配"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor="limit" className="flex items-center gap-1">
                    <Search className="w-3.5 h-3.5" />
                    扫描条数
                </Label>
                <Input
                    id="limit"
                    type="number"
                    min={1}
                    max={500}
                    value={config.limit}
                    onChange={(e) => setConfig(prev => ({ ...prev, limit: parseInt(e.target.value) || 100 }))}
                />
                <p className="text-xs text-gray-500">最多扫描 500 封邮件</p>
            </div>

            <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                    取消
                </Button>
                <Button onClick={runTest} className="bg-primary-600 hover:bg-primary-700 text-white">
                    <Play className="w-4 h-4 mr-2" />
                    开始测试
                </Button>
            </div>
        </div>
    )

    // 渲染加载状态
    const renderLoadingStep = () => (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="relative">
                <div className="w-20 h-20 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                    <Loader2 className="w-10 h-10 animate-spin text-primary-600" />
                </div>
            </div>
            <div className="text-center space-y-2">
                <h3 className="font-medium text-lg text-gray-900 dark:text-white">正在测试过滤条件...</h3>
                <p className="text-sm text-gray-500">正在从数据库扫描邮件并应用过滤规则</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
                <Clock className="w-3 h-3" />
                这可能需要几秒钟
            </div>
        </div>
    )

    // 渲染结果步骤
    const renderResultsStep = () => {
        if (!testResult) return null

        const selectedEmail = testResult.matchedEmails[selectedEmailIndex]

        return (
            <div className="flex flex-col w-full overflow-hidden" style={{ height: 'min(65vh, 600px)' }}>
                {/* 统计栏 */}
                <div className="flex-shrink-0 flex items-center justify-between py-2 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 -mx-6 px-6 mb-3">
                    <div className="flex items-center gap-4">
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            扫描: {testResult.totalScanned} 封
                        </Badge>
                        <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            匹配: {testResult.totalMatched} 封
                        </Badge>
                        <Badge variant="outline" className="bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                            <Clock className="w-3 h-3 mr-1" />
                            耗时: {testResult.executionTimeMs}ms
                        </Badge>
                    </div>
                </div>

                {testResult.matchedEmails.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                        <XCircle className="w-16 h-16 text-gray-300 mb-4" />
                        <p className="text-lg font-medium">没有匹配的邮件</p>
                        <p className="text-sm">扫描了 {testResult.totalScanned} 封邮件，但没有符合过滤条件的邮件</p>
                        <Button
                            variant="outline"
                            className="mt-4"
                            onClick={() => setStep('config')}
                        >
                            修改条件重试
                        </Button>
                    </div>
                ) : (
                    <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">
                        {/* 左侧：邮件列表 */}
                        <div className="w-1/3 flex flex-col border-r dark:border-gray-700 pr-4 min-h-0">
                            <h4 className="flex-shrink-0 font-medium text-sm text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                                <Mail className="w-4 h-4" />
                                匹配邮件列表
                            </h4>
                            <ScrollArea className="flex-1 -mr-4 pr-4">
                                <div className="space-y-2">
                                    {testResult.matchedEmails.map((email, index) => (
                                        <Card
                                            key={email.id}
                                            className={cn(
                                                "cursor-pointer transition-all hover:shadow-md",
                                                index === selectedEmailIndex
                                                    ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
                                                    : "hover:border-gray-300"
                                            )}
                                            onClick={() => setSelectedEmailIndex(index)}
                                        >
                                            <CardContent className="p-3">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-sm truncate text-gray-900 dark:text-white">
                                                            {email.subject || '(无主题)'}
                                                        </p>
                                                        <p className="text-xs text-gray-500 truncate mt-1">
                                                            {email.from}
                                                        </p>
                                                        <p className="text-xs text-gray-400 mt-1">
                                                            {formatDate(email.receivedAt)}
                                                        </p>
                                                    </div>
                                                    {index === selectedEmailIndex && (
                                                        <ChevronRight className="w-4 h-4 text-primary-500 flex-shrink-0" />
                                                    )}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>

                        {/* 右侧：邮件预览 */}
                        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
                            {selectedEmail ? (
                                <>
                                    <div className="flex-shrink-0 mb-3">
                                        <h4 className="font-semibold text-base text-gray-900 dark:text-white mb-1 line-clamp-2">
                                            {selectedEmail.subject || '(无主题)'}
                                        </h4>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                                            <span className="flex items-center gap-1">
                                                <User className="w-3 h-3" />
                                                发件人: {selectedEmail.from}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Users className="w-3 h-3" />
                                                收件人: {selectedEmail.to?.join(', ') || '-'}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                {formatDate(selectedEmail.receivedAt)}
                                            </span>
                                        </div>
                                    </div>

                                    <Separator className="flex-shrink-0 mb-3" />

                                    <div className="flex-1 min-h-0 overflow-hidden border rounded-lg bg-white dark:bg-gray-800">
                                        {selectedEmail.htmlPreview ? (
                                            <iframe
                                                srcDoc={`
                                                    <!DOCTYPE html>
                                                    <html>
                                                    <head>
                                                        <meta charset="utf-8">
                                                        <meta name="viewport" content="width=device-width, initial-scale=1">
                                                        <style>
                                                            body {
                                                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                                                font-size: 14px;
                                                                line-height: 1.5;
                                                                color: #333;
                                                                margin: 0;
                                                                padding: 16px;
                                                                background: white;
                                                            }
                                                            img { max-width: 100%; height: auto; }
                                                            a { color: #0066cc; }
                                                        </style>
                                                    </head>
                                                    <body>${selectedEmail.htmlPreview}</body>
                                                    </html>
                                                `}
                                                sandbox="allow-same-origin"
                                                className="w-full h-full border-0"
                                                title="邮件预览"
                                            />
                                        ) : (
                                            <div className="h-full overflow-auto p-4 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                                {selectedEmail.bodyPreview || '(无内容)'}
                                            </div>
                                        )}
                                    </div>

                                    {selectedEmail.evaluation && Object.keys(selectedEmail.evaluation).length > 0 && (
                                        <div className="flex-shrink-0 mt-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                                            <div className="flex items-center gap-2 text-xs font-medium text-green-700 dark:text-green-300 mb-2">
                                                <CheckCircle2 className="w-3 h-3" />
                                                匹配详情
                                            </div>
                                            <pre className="text-xs text-green-700 dark:text-green-300 overflow-auto max-h-36 whitespace-pre-wrap">
                                                {JSON.stringify(normalizeEvaluationForDisplay(selectedEmail.evaluation), null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="flex-1 flex items-center justify-center text-gray-400">
                                    选择左侧邮件查看详情
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 底部按钮 */}
                <div className="flex-shrink-0 flex justify-between items-center pt-4 mt-4 border-t dark:border-gray-700">
                    <Button variant="outline" onClick={() => setStep('config')}>
                        修改条件
                    </Button>
                    <Button onClick={() => handleOpenChange(false)} className="bg-primary-600 hover:bg-primary-700 text-white">
                        <Check className="w-4 h-4 mr-2" />
                        完成测试
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className={cn(
                    "overflow-hidden",
                    step === 'results' ? "!max-w-[90vw] w-[1200px] max-h-[90vh]" : "!max-w-4xl"
                )}
                style={step === 'results' ? { width: 'min(1200px, 90vw)' } : undefined}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Database className="w-5 h-5 text-primary-600" />
                        测试过滤条件
                        {step === 'results' && (
                            <Badge variant="outline" className="ml-2 bg-green-50 text-green-700">
                                测试完成
                            </Badge>
                        )}
                    </DialogTitle>
                </DialogHeader>

                {step === 'config' && renderConfigStep()}
                {step === 'loading' && renderLoadingStep()}
                {step === 'results' && renderResultsStep()}
            </DialogContent>
        </Dialog>
    )
}
