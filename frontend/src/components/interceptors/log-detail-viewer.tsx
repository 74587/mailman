'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    ChevronDown,
    ChevronRight,
    Code,
    List,
    Copy,
    Check,
    ArrowRight,
    ArrowDown,
    AlertCircle,
} from 'lucide-react'
import { InterceptorLog } from '@/services/interceptor.service'
import { toast } from 'sonner'

interface LogDetailViewerProps {
    log: InterceptorLog
}

// JSON 树形节点组件
interface JsonTreeNodeProps {
    name: string
    value: unknown
    depth?: number
    defaultExpanded?: boolean
}

function JsonTreeNode({ name, value, depth = 0, defaultExpanded = true }: JsonTreeNodeProps) {
    const [expanded, setExpanded] = useState(defaultExpanded && depth < 2)

    const isObject = value !== null && typeof value === 'object'
    const isArray = Array.isArray(value)

    const getTypeColor = (val: unknown) => {
        if (val === null) return 'text-gray-500'
        if (typeof val === 'string') return 'text-green-600 dark:text-green-400'
        if (typeof val === 'number') return 'text-blue-600 dark:text-blue-400'
        if (typeof val === 'boolean') return 'text-purple-600 dark:text-purple-400'
        return 'text-foreground'
    }

    const formatValue = (val: unknown): string => {
        if (val === null) return 'null'
        if (typeof val === 'string') return `"${val}"`
        if (typeof val === 'boolean') return val ? 'true' : 'false'
        return String(val)
    }

    if (!isObject) {
        return (
            <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 16 }}>
                <span className="text-muted-foreground">{name}:</span>
                <span className={getTypeColor(value)}>{formatValue(value)}</span>
            </div>
        )
    }

    const entries = isArray
        ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
        : Object.entries(value as object)

    return (
        <div style={{ paddingLeft: depth * 16 }}>
            <div
                className="flex items-center gap-1 py-0.5 cursor-pointer hover:bg-muted/50 rounded -ml-4 pl-4"
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? (
                    <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                ) : (
                    <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
                <span className="text-muted-foreground">{name}:</span>
                <span className="text-muted-foreground text-xs">
                    {isArray ? `[${entries.length}]` : `{${entries.length}}`}
                </span>
            </div>
            {expanded && (
                <div className="border-l border-border/50 ml-1.5">
                    {entries.map(([key, val]) => (
                        <JsonTreeNode
                            key={key}
                            name={key}
                            value={val}
                            depth={depth + 1}
                            defaultExpanded={depth < 1}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

// JSON 视图组件
interface JsonViewerProps {
    data: string | undefined
    title: string
    emptyText?: string
}

function JsonViewer({ data, title, emptyText = '无数据' }: JsonViewerProps) {
    const [viewMode, setViewMode] = useState<'tree' | 'raw'>('tree')
    const [copied, setCopied] = useState(false)

    if (!data) {
        return (
            <div className="p-3 bg-muted/30 rounded-lg text-sm text-muted-foreground">
                {emptyText}
            </div>
        )
    }

    let parsedData: unknown = null
    let parseError = false

    try {
        parsedData = JSON.parse(data)
    } catch {
        parseError = true
    }

    const handleCopy = () => {
        navigator.clipboard.writeText(data)
        setCopied(true)
        toast.success('已复制到剪贴板')
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className="border rounded-lg overflow-hidden">
            {/* 头部 */}
            <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
                <span className="text-sm font-medium">{title}</span>
                <div className="flex items-center gap-2">
                    {!parseError && (
                        <div className="flex items-center bg-background rounded border">
                            <Button
                                variant={viewMode === 'tree' ? 'secondary' : 'ghost'}
                                size="sm"
                                className="h-6 px-2 text-xs rounded-r-none"
                                onClick={() => setViewMode('tree')}
                            >
                                <List className="w-3 h-3 mr-1" />
                                树形
                            </Button>
                            <Button
                                variant={viewMode === 'raw' ? 'secondary' : 'ghost'}
                                size="sm"
                                className="h-6 px-2 text-xs rounded-l-none"
                                onClick={() => setViewMode('raw')}
                            >
                                <Code className="w-3 h-3 mr-1" />
                                文本
                            </Button>
                        </div>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={handleCopy}
                    >
                        {copied ? (
                            <Check className="w-3 h-3 text-green-500" />
                        ) : (
                            <Copy className="w-3 h-3" />
                        )}
                    </Button>
                </div>
            </div>

            {/* 内容 */}
            <div className="p-3 max-h-64 overflow-auto bg-background">
                {parseError ? (
                    <pre className="text-xs whitespace-pre-wrap break-all font-mono">{data}</pre>
                ) : viewMode === 'tree' ? (
                    <div className="text-xs font-mono">
                        <JsonTreeNode name="root" value={parsedData} />
                    </div>
                ) : (
                    <pre className="text-xs whitespace-pre-wrap break-all font-mono">
                        {JSON.stringify(parsedData, null, 2)}
                    </pre>
                )}
            </div>
        </div>
    )
}

export function LogDetailViewer({ log }: LogDetailViewerProps) {
    const [expanded, setExpanded] = useState(false)

    const hasDetails = log.input_data || log.output_data || log.action_result || log.error

    if (!hasDetails && !log.action_plugin_id) {
        return null
    }

    return (
        <div className="mt-3 space-y-3">
            {/* 动作信息横条 */}
            {log.action_plugin_id && (
                <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg text-sm">
                    <Badge variant="outline" className="text-xs shrink-0">
                        动作
                    </Badge>
                    <span className="font-medium">{log.action_plugin_id}</span>
                    {log.action_id && (
                        <>
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            <span className="text-muted-foreground">{log.action_id}</span>
                        </>
                    )}
                    {log.decision_made && (
                        <Badge
                            variant={
                                log.decision_made === 'continue'
                                    ? 'default'
                                    : log.decision_made === 'skip'
                                        ? 'secondary'
                                        : 'destructive'
                            }
                            className="ml-auto text-xs"
                        >
                            {log.decision_made === 'continue'
                                ? '继续'
                                : log.decision_made === 'skip'
                                    ? '跳过'
                                    : '中止'}
                        </Badge>
                    )}
                </div>
            )}

            {/* 错误信息 */}
            {log.error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-900/50">
                    <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <div className="text-sm font-medium text-red-700 dark:text-red-300 mb-1">
                                执行错误
                            </div>
                            <div className="text-sm text-red-600 dark:text-red-400">
                                {log.error}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 展开/折叠详情按钮 */}
            {(log.input_data || log.output_data || log.action_result) && (
                <>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-center text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setExpanded(!expanded)}
                    >
                        {expanded ? (
                            <>
                                <ChevronDown className="w-3 h-3 mr-1" />
                                收起详情
                            </>
                        ) : (
                            <>
                                <ChevronRight className="w-3 h-3 mr-1" />
                                查看入参/出参详情
                            </>
                        )}
                    </Button>

                    {/* 详细数据面板 */}
                    {expanded && (
                        <div className="space-y-3 pt-2">
                            <Tabs defaultValue="input" className="w-full">
                                <TabsList className="w-full grid grid-cols-3 h-8">
                                    <TabsTrigger value="input" className="text-xs" disabled={!log.input_data}>
                                        <ArrowDown className="w-3 h-3 mr-1 rotate-180" />
                                        入参
                                        {log.input_data && (
                                            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                                                ✓
                                            </Badge>
                                        )}
                                    </TabsTrigger>
                                    <TabsTrigger value="output" className="text-xs" disabled={!log.output_data}>
                                        <ArrowDown className="w-3 h-3 mr-1" />
                                        出参
                                        {log.output_data && (
                                            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                                                ✓
                                            </Badge>
                                        )}
                                    </TabsTrigger>
                                    <TabsTrigger value="result" className="text-xs" disabled={!log.action_result}>
                                        <Check className="w-3 h-3 mr-1" />
                                        结果
                                        {log.action_result && (
                                            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                                                ✓
                                            </Badge>
                                        )}
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="input" className="mt-3">
                                    <JsonViewer
                                        data={log.input_data}
                                        title="输入数据 (Input)"
                                        emptyText="无输入数据"
                                    />
                                </TabsContent>

                                <TabsContent value="output" className="mt-3">
                                    <JsonViewer
                                        data={log.output_data}
                                        title="输出数据 (Output)"
                                        emptyText="无输出数据"
                                    />
                                </TabsContent>

                                <TabsContent value="result" className="mt-3">
                                    <JsonViewer
                                        data={log.action_result}
                                        title="执行结果 (Action Result)"
                                        emptyText="无执行结果"
                                    />
                                </TabsContent>
                            </Tabs>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
