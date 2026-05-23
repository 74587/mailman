'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react'
import type { editor as MonacoEditor, languages } from 'monaco-editor'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    Play,
    Loader2,
    CheckCircle2,
    XCircle,
    ChevronRight,
    ChevronDown,
    Code2,
    BookOpen,
    Eye,
    Copy,
    Check,
    GripVertical,
    Info,
    Sparkles
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'

// Note: @monaco-editor/react loads Monaco from CDN (unpkg) by default
// First load may be slow (~2-3MB), but browser caches it for subsequent loads

// Expression engine types
type ExpressionEngineType = 'expr.javascript' | 'expr.cel' | 'expr.go-template' | 'expr.jsonpath'

interface ExpressionEngine {
    id: ExpressionEngineType
    name: string
    description: string
    language: string // Monaco language ID
    examples: ExpressionExample[]
    contextSymbol: string // Symbol to represent context object
}

interface ExpressionExample {
    title: string
    description: string
    code: string
}

// Expression engines configuration
const EXPRESSION_ENGINES: ExpressionEngine[] = [
    {
        id: 'expr.javascript',
        name: 'JavaScript',
        description: '完整的 JavaScript 语法支持，适合复杂逻辑。使用 $ 访问邮件上下文',
        language: 'javascript', // Use JavaScript (faster loading, we provide custom completions)
        contextSymbol: '$',
        examples: [
            {
                title: '简单关键词检查',
                description: '检查主题是否包含特定关键词',
                code: '$.Subject.includes("urgent")'
            },
            {
                title: '发件人域名过滤',
                description: '检查发件人是否来自指定域名',
                code: '$.From.some(addr => addr.endsWith("@company.com"))'
            },
            {
                title: '复合条件',
                description: '多条件组合判断',
                code: '$.Subject.includes("Report") && $.Attachments.length > 0'
            },
            {
                title: '正则匹配',
                description: '使用正则表达式匹配模式',
                code: '/TICKET-\\d+/.test($.Subject)'
            },
            {
                title: '附件过滤',
                description: '检查是否有 PDF 附件',
                code: '$.Attachments.some(a => a.filename.endsWith(".pdf"))'
            },
            {
                title: '字符串方法链',
                description: '使用字符串方法进行复杂匹配',
                code: '$.Subject.toLowerCase().trim().startsWith("re:")'
            },
            {
                title: '复杂函数逻辑',
                description: '使用函数封装复杂逻辑',
                code: `(function() {
  const domains = ["@company.com", "@partner.org"];
  return $.From.some(addr =>
    domains.some(d => addr.endsWith(d))
  );
})()`
            }
        ]
    },
    {
        id: 'expr.cel',
        name: 'CEL',
        description: 'Common Expression Language - Google 开发的安全表达式语言。使用 $ 访问邮件上下文',
        language: 'cel',
        contextSymbol: '$',
        examples: [
            {
                title: '字符串包含检查',
                description: '检查主题是否包含关键词',
                code: '$.Subject.contains("urgent")'
            },
            {
                title: '发件人检查',
                description: '检查是否有来自指定域名的发件人',
                code: '$.From.exists(addr, addr.endsWith("@company.com"))'
            },
            {
                title: '复合条件',
                description: '多条件组合',
                code: '$.Subject.contains("Report") && size($.Attachments) > 0'
            },
            {
                title: '列表过滤',
                description: '检查收件人是否包含特定地址',
                code: '$.To.exists(addr, addr.contains("support"))'
            },
            {
                title: '条件表达式',
                description: '根据条件返回不同值',
                code: '$.HasAttachments ? "有附件" : "无附件"'
            }
        ]
    },
    {
        id: 'expr.go-template',
        name: 'Go Template',
        description: 'Go 模板语言，适合文本生成和条件判断。使用 . 访问邮件上下文',
        language: 'go',
        contextSymbol: '.',
        examples: [
            {
                title: '简单条件',
                description: '检查主题包含关键词',
                code: '{{ if contains .Subject "urgent" }}true{{ else }}false{{ end }}'
            },
            {
                title: '复合条件',
                description: 'AND 逻辑组合',
                code: '{{ if and (contains .Subject "Report") (gt (len .Attachments) 0) }}true{{ else }}false{{ end }}'
            },
            {
                title: '数组检查',
                description: '检查发件人域名',
                code: '{{ if anyContains .From "@company.com" }}true{{ else }}false{{ end }}'
            },
            {
                title: '正则匹配',
                description: '匹配模式',
                code: '{{ if match "TICKET-[0-9]+" .Subject }}true{{ else }}false{{ end }}'
            }
        ]
    },
    {
        id: 'expr.jsonpath',
        name: 'JSONPath',
        description: 'JSON 查询语言，类似 XPath。使用 $ 表示根对象',
        language: 'json',
        contextSymbol: '$',
        examples: [
            {
                title: '获取字段值',
                description: '获取主题',
                code: '$.Subject'
            },
            {
                title: '数组元素',
                description: '获取第一个发件人',
                code: '$.From[0]'
            },
            {
                title: '正则匹配',
                description: '主题包含特定文本',
                code: '$.Subject =~ "urgent"'
            },
            {
                title: '数值比较',
                description: '附件数量大于0',
                code: '$.AttachmentCount > 0'
            }
        ]
    }
]

interface EvaluationResult {
    success: boolean
    result: boolean
    value?: any
    error?: string
    duration?: number
}

interface ExpressionEditorModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    engineType: ExpressionEngineType
    expression: string
    onExpressionChange: (expression: string) => void
    onEngineTypeChange?: (engineType: ExpressionEngineType) => void
    testData?: Record<string, any>
    emailId?: number
}

// JSON Tree viewer component for displaying test data
function JsonTreeViewer({
    data,
    path = '',
    expanded = new Set<string>(),
    onToggle,
    onCopyPath
}: {
    data: any
    path?: string
    expanded?: Set<string>
    onToggle?: (path: string) => void
    onCopyPath?: (path: string) => void
}) {
    if (data === null || data === undefined) {
        return <span className="text-gray-400 italic">null</span>
    }

    if (typeof data !== 'object') {
        const valueStr = typeof data === 'string' ? `"${data}"` : String(data)
        const displayValue = valueStr.length > 50 ? valueStr.slice(0, 50) + '...' : valueStr
        return (
            <span className={cn(
                typeof data === 'string' && 'text-green-600',
                typeof data === 'number' && 'text-blue-600',
                typeof data === 'boolean' && 'text-purple-600'
            )}>
                {displayValue}
            </span>
        )
    }

    const isArray = Array.isArray(data)
    const entries = isArray ? data.map((v, i) => [i, v] as [number, any]) : Object.entries(data)
    const isExpanded = expanded.has(path)

    if (entries.length === 0) {
        return <span className="text-gray-400">{isArray ? '[]' : '{}'}</span>
    }

    return (
        <div className="ml-2">
            <span
                className="cursor-pointer hover:bg-gray-100 rounded px-1 inline-flex items-center gap-1"
                onClick={() => onToggle?.(path)}
            >
                {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-gray-400" />
                ) : (
                    <ChevronRight className="h-3 w-3 text-gray-400" />
                )}
                <span className="text-gray-500">
                    {isArray ? `Array[${entries.length}]` : `Object{${entries.length}}`}
                </span>
            </span>
            {isExpanded && (
                <div className="ml-4 border-l border-gray-200 pl-2">
                    {entries.slice(0, 50).map(([key, value]) => {
                        const currentPath = path ? `${path}.${key}` : String(key)
                        return (
                            <div key={key} className="flex items-start gap-1 py-0.5 group">
                                <span
                                    className="text-blue-600 cursor-pointer hover:underline flex-shrink-0"
                                    onClick={() => onCopyPath?.(currentPath)}
                                    title={`点击复制: ${currentPath}`}
                                >
                                    {isArray ? `[${key}]` : key}:
                                </span>
                                <JsonTreeViewer
                                    data={value}
                                    path={currentPath}
                                    expanded={expanded}
                                    onToggle={onToggle}
                                    onCopyPath={onCopyPath}
                                />
                            </div>
                        )
                    })}
                    {entries.length > 50 && (
                        <div className="text-gray-400 italic text-xs">
                            ...还有 {entries.length - 50} 项
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export function ExpressionEditorModal({
    open,
    onOpenChange,
    engineType,
    expression,
    onExpressionChange,
    onEngineTypeChange,
    testData = {},
    emailId
}: ExpressionEditorModalProps) {
    const [localExpression, setLocalExpression] = useState(expression)
    const [isEvaluating, setIsEvaluating] = useState(false)
    const [evaluationResult, setEvaluationResult] = useState<EvaluationResult | null>(null)
    const [copiedPath, setCopiedPath] = useState<string | null>(null)
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['']))
    const [leftPanelWidth, setLeftPanelWidth] = useState(60) // percentage
    const [rightTopHeight, setRightTopHeight] = useState(40) // percentage - 上方区域占40%，下方区域占60%
    const [isResultExpanded, setIsResultExpanded] = useState(false) // 评估结果展开状态
    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
    const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const isResizingHorizontal = useRef(false)
    const isResizingVertical = useRef(false)

    const currentEngine = useMemo(
        () => EXPRESSION_ENGINES.find(e => e.id === engineType) || EXPRESSION_ENGINES[0],
        [engineType]
    )

    // Sync expression when modal opens
    useEffect(() => {
        if (open) {
            setLocalExpression(expression)
            setEvaluationResult(null)
        }
    }, [open, expression])

    // Configure Monaco editor before mount
    const handleEditorWillMount: BeforeMount = useCallback((monaco) => {
        monacoRef.current = monaco

        // Register custom CEL language if not exists
        if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === 'cel')) {
            monaco.languages.register({ id: 'cel' })
            monaco.languages.setMonarchTokensProvider('cel', {
                tokenizer: {
                    root: [
                        [/\$/, 'variable'], // $ context symbol
                        [/[a-zA-Z_]\w*/, 'identifier'],
                        [/"[^"]*"/, 'string'],
                        [/'[^']*'/, 'string'],
                        [/\d+(\.\d+)?/, 'number'],
                        [/true|false/, 'keyword'],
                        [/&&|\|\||!|==|!=|<=|>=|<|>/, 'operator'],
                        [/\./, 'delimiter'],
                        [/[()[\]{}]/, 'bracket'],
                    ]
                }
            })
        }
    }, [])

    // Configure Monaco editor after mount
    const handleEditorMount: OnMount = useCallback((editor, monaco) => {
        editorRef.current = editor
        monacoRef.current = monaco

        const lang = currentEngine.language === 'cel' ? 'cel' : currentEngine.language

        // Import methods from monaco-config
        const { STRING_METHODS, ARRAY_METHODS, NUMBER_METHODS, OBJECT_METHODS, BOOLEAN_METHODS } = require('@/lib/monaco-config')

        // Helper: infer type from value
        const inferType = (value: any): string => {
            if (value === null) return 'null'
            if (value === undefined) return 'undefined'
            if (Array.isArray(value)) {
                if (value.length === 0) return 'any[]'
                return `${inferType(value[0])}[]`
            }
            return typeof value
        }

        // Helper: get methods for a type
        const getMethodsForType = (type: string) => {
            if (type === 'string') return STRING_METHODS
            if (type.endsWith('[]')) return ARRAY_METHODS
            if (type === 'number') return NUMBER_METHODS
            if (type === 'boolean') return BOOLEAN_METHODS
            if (type === 'object') return OBJECT_METHODS
            return []
        }

        // Helper: get value at path in testData
        const getValueAtPath = (obj: any, path: string): any => {
            if (!path || !obj) return obj
            const parts = path.split('.')
            let current = obj
            for (const part of parts) {
                if (current === null || current === undefined) return undefined
                // Handle array indexing like [0]
                const arrayMatch = part.match(/^(\w+)?\[(\d+)\]$/)
                if (arrayMatch) {
                    const [, key, index] = arrayMatch
                    if (key) current = current[key]
                    if (Array.isArray(current)) {
                        current = current[parseInt(index)]
                    } else {
                        return undefined
                    }
                } else {
                    current = current[part]
                }
            }
            return current
        }

        // Helper: generate field suggestions from object
        const generateFieldSuggestions = (obj: any, monaco: any, range: any): languages.CompletionItem[] => {
            if (!obj || typeof obj !== 'object') return []

            const suggestions: languages.CompletionItem[] = []
            const entries = Object.entries(obj)

            for (const [key, value] of entries) {
                const type = inferType(value)
                const isObject = typeof value === 'object' && value !== null && !Array.isArray(value)
                const isArray = Array.isArray(value)

                // Determine the kind icon
                let kind = monaco.languages.CompletionItemKind.Property
                if (type === 'function') kind = monaco.languages.CompletionItemKind.Method
                else if (isArray) kind = monaco.languages.CompletionItemKind.Field
                else if (isObject) kind = monaco.languages.CompletionItemKind.Struct

                // Generate value preview
                let valuePreview = ''
                if (typeof value === 'string') {
                    valuePreview = value.length > 50 ? `"${value.slice(0, 50)}..."` : `"${value}"`
                } else if (isArray) {
                    valuePreview = `Array[${value.length}]`
                } else if (isObject) {
                    valuePreview = `{${Object.keys(value as object).slice(0, 3).join(', ')}${Object.keys(value as object).length > 3 ? ', ...' : ''}}`
                } else {
                    valuePreview = String(value)
                }

                suggestions.push({
                    label: key,
                    kind,
                    insertText: key,
                    detail: type,
                    documentation: `当前值: ${valuePreview}`,
                    range,
                    sortText: `0_${key}` // Prioritize data fields
                })
            }

            return suggestions
        }

        // Register completion provider with dynamic suggestions based on testData
        const disposable = monaco.languages.registerCompletionItemProvider(lang, {
            triggerCharacters: ['.', '$', '['],
            provideCompletionItems: (model: MonacoEditor.ITextModel, position: { lineNumber: number; column: number }) => {
                const word = model.getWordUntilPosition(position)
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn
                }

                // Get text before cursor to determine context
                const lineContent = model.getLineContent(position.lineNumber)
                const textBeforeCursor = lineContent.substring(0, position.column - 1)

                const suggestions: languages.CompletionItem[] = []

                // Parse the path after '$.'
                const pathMatch = textBeforeCursor.match(/\$\.([a-zA-Z0-9_\[\].]*)\.$/)
                if (pathMatch) {
                    const path = pathMatch[1]
                    const valueAtPath = getValueAtPath(testData, path)
                    const valueType = inferType(valueAtPath)

                    // If it's an object, suggest its properties
                    if (typeof valueAtPath === 'object' && valueAtPath !== null && !Array.isArray(valueAtPath)) {
                        suggestions.push(...generateFieldSuggestions(valueAtPath, monaco, range))
                    }

                    // Add type-appropriate methods
                    const methods = getMethodsForType(valueType)
                    methods.forEach((method: any) => {
                        suggestions.push({
                            label: method.label,
                            kind: monaco.languages.CompletionItemKind.Method,
                            insertText: method.insertText,
                            insertTextRules: method.insertText.includes('${')
                                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                                : undefined,
                            detail: method.returnType || 'method',
                            documentation: method.doc,
                            range,
                            sortText: `1_${method.label}` // Methods come after properties
                        })
                    })

                    if (suggestions.length > 0) {
                        return { suggestions }
                    }
                }

                // Check if we're right after '$.' - suggest root level fields from testData
                if (textBeforeCursor.endsWith('$.')) {
                    suggestions.push(...generateFieldSuggestions(testData, monaco, range))

                    // If testData is empty, provide fallback email fields
                    if (suggestions.length === 0) {
                        const fallbackFields = [
                            { label: 'Subject', type: 'string', doc: '邮件主题' },
                            { label: 'From', type: 'string[]', doc: '发件人地址列表' },
                            { label: 'To', type: 'string[]', doc: '收件人地址列表' },
                            { label: 'Body', type: 'string', doc: '邮件正文' },
                            { label: 'HasAttachments', type: 'boolean', doc: '是否有附件' },
                            { label: 'Attachments', type: 'object[]', doc: '附件列表' },
                        ]
                        fallbackFields.forEach(field => {
                            suggestions.push({
                                label: field.label,
                                kind: monaco.languages.CompletionItemKind.Property,
                                insertText: field.label,
                                detail: field.type,
                                documentation: field.doc,
                                range
                            })
                        })
                    }

                    return { suggestions }
                }

                // Check if we're typing '$' - suggest '$'
                if (textBeforeCursor.endsWith('$') || word.word === '$') {
                    suggestions.push({
                        label: '$',
                        kind: monaco.languages.CompletionItemKind.Variable,
                        insertText: '$',
                        detail: 'DataContext',
                        documentation: '数据上下文对象 - 输入 $. 查看所有可用字段',
                        range
                    })
                    return { suggestions }
                }

                // Handle array element access: $.From[0].
                const arrayAccessMatch = textBeforeCursor.match(/\$\.([a-zA-Z0-9_]+)\[(\d+)\]\.$/)
                if (arrayAccessMatch) {
                    const [, arrayField, index] = arrayAccessMatch
                    const array = getValueAtPath(testData, arrayField)
                    if (Array.isArray(array) && array.length > parseInt(index)) {
                        const element = array[parseInt(index)]
                        if (typeof element === 'object' && element !== null) {
                            suggestions.push(...generateFieldSuggestions(element, monaco, range))
                        }
                        // Add methods for the element type
                        const methods = getMethodsForType(inferType(element))
                        methods.forEach((method: any) => {
                            suggestions.push({
                                label: method.label,
                                kind: monaco.languages.CompletionItemKind.Method,
                                insertText: method.insertText,
                                insertTextRules: method.insertText.includes('${')
                                    ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                                    : undefined,
                                detail: method.returnType || 'method',
                                documentation: method.doc,
                                range
                            })
                        })
                    }
                    if (suggestions.length > 0) {
                        return { suggestions }
                    }
                }

                // Default: suggest $ to start
                suggestions.push({
                    label: '$',
                    kind: monaco.languages.CompletionItemKind.Variable,
                    insertText: '$',
                    detail: 'DataContext',
                    documentation: '数据上下文对象 - 输入 $. 查看所有可用字段',
                    range
                })

                // Also suggest top-level field names directly (for convenience)
                if (testData && typeof testData === 'object') {
                    Object.keys(testData).slice(0, 10).forEach(key => {
                        suggestions.push({
                            label: key,
                            kind: monaco.languages.CompletionItemKind.Variable,
                            insertText: key,
                            detail: inferType((testData as any)[key]),
                            documentation: `直接访问 (建议使用 $.${key})`,
                            range,
                            sortText: `2_${key}`
                        })
                    })
                }

                return { suggestions }
            }
        })

        // Focus editor
        editor.focus()

        // Cleanup on unmount
        return () => disposable.dispose()
    }, [currentEngine.language, testData])

    // Handle expression evaluation
    const handleEvaluate = async () => {
        if (!localExpression.trim()) return

        setIsEvaluating(true)
        setEvaluationResult(null)

        try {
            const response = await apiClient.post<any>('/v2/triggers/test-condition', {
                emailId: emailId || 0,
                expressions: [{
                    id: 'test-expr',
                    type: 'expression',
                    pluginId: engineType,
                    fields: {
                        expression: localExpression
                    }
                }],
                testData
            })

            setEvaluationResult({
                success: true,
                result: response.result ?? false,
                value: response.details,
                duration: response.duration
            })
        } catch (error: any) {
            setEvaluationResult({
                success: false,
                result: false,
                error: error.message || '评估失败'
            })
        } finally {
            setIsEvaluating(false)
        }
    }

    // Handle save
    const handleSave = () => {
        onExpressionChange(localExpression)
        onOpenChange(false)
    }

    // Handle example click
    const handleExampleClick = (code: string) => {
        setLocalExpression(code)
        editorRef.current?.setValue(code)
    }

    // Handle copy path
    const handleCopyPath = (path: string) => {
        navigator.clipboard.writeText(path)
        setCopiedPath(path)
        setTimeout(() => setCopiedPath(null), 2000)

        // Insert path at cursor position in editor
        if (editorRef.current) {
            const selection = editorRef.current.getSelection()
            if (selection) {
                editorRef.current.executeEdits('', [{
                    range: selection,
                    text: path,
                    forceMoveMarkers: true
                }])
                editorRef.current.focus()
            }
        }
    }

    // Handle tree toggle
    const handleTreeToggle = (path: string) => {
        setExpandedPaths(prev => {
            const next = new Set(prev)
            if (next.has(path)) {
                next.delete(path)
            } else {
                next.add(path)
            }
            return next
        })
    }

    // Horizontal resize handler
    const handleHorizontalResizeStart = (e: React.MouseEvent) => {
        e.preventDefault()
        isResizingHorizontal.current = true

        const startX = e.clientX
        const startWidth = leftPanelWidth
        const containerWidth = containerRef.current?.clientWidth || 0

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingHorizontal.current) return
            const deltaX = e.clientX - startX
            const newWidth = startWidth + (deltaX / containerWidth) * 100
            setLeftPanelWidth(Math.max(30, Math.min(80, newWidth)))
        }

        const handleMouseUp = () => {
            isResizingHorizontal.current = false
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    // Vertical resize handler
    const handleVerticalResizeStart = (e: React.MouseEvent) => {
        e.preventDefault()
        isResizingVertical.current = true

        const startY = e.clientY
        const startHeight = rightTopHeight
        const rightPanel = containerRef.current?.querySelector('.right-panel') as HTMLElement
        const containerHeight = rightPanel?.clientHeight || 0

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizingVertical.current) return
            const deltaY = e.clientY - startY
            const newHeight = startHeight + (deltaY / containerHeight) * 100
            setRightTopHeight(Math.max(20, Math.min(80, newHeight)))
        }

        const handleMouseUp = () => {
            isResizingVertical.current = false
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] w-[1400px] max-h-[90vh] h-[800px] p-0 overflow-hidden">
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
                        <div className="flex items-center gap-3">
                            <Code2 className="h-5 w-5 text-blue-600" />
                            <DialogTitle className="text-lg font-semibold">
                                表达式编辑器
                            </DialogTitle>
                            {/* Engine selector */}
                            <div className="flex items-center gap-1 ml-4">
                                {EXPRESSION_ENGINES.map(engine => (
                                    <Badge
                                        key={engine.id}
                                        variant={engine.id === engineType ? 'default' : 'outline'}
                                        className={cn(
                                            'cursor-pointer transition-colors',
                                            engine.id === engineType
                                                ? 'bg-blue-600'
                                                : 'hover:bg-gray-100'
                                        )}
                                        onClick={() => onEngineTypeChange?.(engine.id)}
                                    >
                                        {engine.name}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleEvaluate}
                                disabled={isEvaluating || !localExpression.trim()}
                            >
                                {isEvaluating ? (
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                    <Play className="h-4 w-4 mr-1" />
                                )}
                                运行
                            </Button>
                            <Button size="sm" onClick={handleSave}>
                                保存
                            </Button>
                        </div>
                    </div>

                    {/* Main content */}
                    <div
                        ref={containerRef}
                        className="flex-1 overflow-hidden"
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `${leftPanelWidth}% 4px 1fr`
                        }}
                    >
                        {/* Left panel - Code editor */}
                        <div className="flex flex-col border-r bg-white min-w-0 overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Sparkles className="h-4 w-4 text-amber-500" />
                                    <span>{currentEngine.name} 表达式</span>
                                </div>
                                <div className="text-xs text-gray-400">
                                    Ctrl+Space 触发智能提示
                                </div>
                            </div>
                            <div className="flex-1 relative">
                                <Editor
                                    height="100%"
                                    language={currentEngine.language === 'cel' ? 'cel' : currentEngine.language}
                                    value={localExpression}
                                    onChange={(value: string | undefined) => setLocalExpression(value || '')}
                                    beforeMount={handleEditorWillMount}
                                    onMount={handleEditorMount}
                                    loading={
                                        <div className="flex items-center justify-center h-full bg-gray-50">
                                            <div className="flex flex-col items-center gap-2 text-gray-500">
                                                <Loader2 className="h-6 w-6 animate-spin" />
                                                <span className="text-sm">加载编辑器...</span>
                                            </div>
                                        </div>
                                    }
                                    options={{
                                        minimap: { enabled: false },
                                        fontSize: 14,
                                        lineNumbers: 'on',
                                        scrollBeyondLastLine: false,
                                        automaticLayout: true,
                                        tabSize: 2,
                                        wordWrap: 'on',
                                        suggestOnTriggerCharacters: true,
                                        quickSuggestions: {
                                            other: true,
                                            comments: false,
                                            strings: true
                                        },
                                        acceptSuggestionOnCommitCharacter: true,
                                        suggestSelection: 'first',
                                        snippetSuggestions: 'inline',
                                        padding: { top: 16, bottom: 16 }
                                    }}
                                    theme="vs"
                                />
                            </div>
                        </div>

                        {/* Horizontal resize handle */}
                        <div
                            className="bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors flex items-center justify-center"
                            onMouseDown={handleHorizontalResizeStart}
                        >
                            <GripVertical className="h-4 w-4 text-gray-400" />
                        </div>

                        {/* Right panel */}
                        <div className="right-panel flex flex-col overflow-hidden bg-gray-50 min-w-0">
                            {/* Top section - Examples */}
                            <div
                                className="flex flex-col overflow-hidden border-b"
                                style={{ height: `${rightTopHeight}%` }}
                            >
                                <Tabs defaultValue="examples" className="flex-1 flex flex-col overflow-hidden">
                                    <TabsList className="mx-4 mt-2 h-8 bg-gray-100 p-0.5">
                                        <TabsTrigger value="examples" className="h-7 text-xs gap-1">
                                            <BookOpen className="h-3 w-3" />
                                            示例代码
                                        </TabsTrigger>
                                        <TabsTrigger value="docs" className="h-7 text-xs gap-1">
                                            <Info className="h-3 w-3" />
                                            语法帮助
                                        </TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="examples" className="flex-1 overflow-auto p-4 m-0">
                                        <div className="space-y-2">
                                            {currentEngine.examples.map((example, idx) => (
                                                <div
                                                    key={idx}
                                                    className="p-3 bg-white rounded-lg border hover:border-blue-300 hover:shadow-sm cursor-pointer transition-all group"
                                                    onClick={() => handleExampleClick(example.code)}
                                                >
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="font-medium text-sm text-gray-800">
                                                            {example.title}
                                                        </span>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <Copy className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                    <p className="text-xs text-gray-500 mb-2">
                                                        {example.description}
                                                    </p>
                                                    <pre className="text-xs bg-gray-50 p-2 rounded font-mono text-gray-700 overflow-x-auto">
                                                        {example.code}
                                                    </pre>
                                                </div>
                                            ))}
                                        </div>
                                    </TabsContent>

                                    <TabsContent value="docs" className="flex-1 overflow-auto p-4 m-0">
                                        <div className="prose prose-sm max-w-none">
                                            <h4 className="text-sm font-medium mb-2">{currentEngine.name} 语法</h4>
                                            <p className="text-xs text-gray-600 mb-3">
                                                {currentEngine.description}
                                            </p>

                                            {/* Context symbol explanation */}
                                            <div className="mb-3 p-2 bg-blue-50 rounded-lg border border-blue-200">
                                                <h5 className="text-xs font-medium text-blue-800 mb-1">
                                                    上下文对象: <code className="bg-blue-100 px-1 rounded">{currentEngine.contextSymbol}</code>
                                                </h5>
                                                <p className="text-xs text-blue-700">
                                                    使用 <code className="bg-blue-100 px-1 rounded">{currentEngine.contextSymbol}</code> 访问邮件上下文。
                                                    例如: <code className="bg-blue-100 px-1 rounded">{currentEngine.contextSymbol}.Subject</code>
                                                </p>
                                            </div>

                                            <h5 className="text-xs font-medium text-gray-700 mb-1">可用字段 (点击插入)</h5>
                                            <div className="flex flex-wrap gap-1 mb-3">
                                                {['Subject', 'From', 'To', 'Cc', 'Body', 'HasAttachments', 'Attachments', 'Headers'].map(field => (
                                                    <Badge
                                                        key={field}
                                                        variant="outline"
                                                        className="text-xs cursor-pointer hover:bg-blue-50"
                                                        onClick={() => handleCopyPath(`${currentEngine.contextSymbol}.${field}`)}
                                                    >
                                                        {currentEngine.contextSymbol}.{field}
                                                    </Badge>
                                                ))}
                                            </div>

                                            {engineType === 'expr.javascript' && (
                                                <>
                                                    <h5 className="text-xs font-medium text-gray-700 mb-1">字符串方法 (输入 $.Subject. 触发提示)</h5>
                                                    <ul className="text-xs text-gray-600 space-y-1">
                                                        <li><code>.includes(str)</code> - 字符串包含检查</li>
                                                        <li><code>.startsWith(str)</code> - 字符串开头检查</li>
                                                        <li><code>.endsWith(str)</code> - 字符串结尾检查</li>
                                                        <li><code>.toLowerCase()</code> - 转换为小写</li>
                                                        <li><code>.toUpperCase()</code> - 转换为大写</li>
                                                        <li><code>.trim()</code> - 去除首尾空格</li>
                                                        <li><code>.match(regex)</code> - 正则匹配</li>
                                                    </ul>
                                                    <h5 className="text-xs font-medium text-gray-700 mb-1 mt-2">数组方法 (输入 $.From. 触发提示)</h5>
                                                    <ul className="text-xs text-gray-600 space-y-1">
                                                        <li><code>.some(fn)</code> - 任意元素匹配</li>
                                                        <li><code>.every(fn)</code> - 所有元素匹配</li>
                                                        <li><code>.filter(fn)</code> - 过滤元素</li>
                                                        <li><code>.find(fn)</code> - 查找元素</li>
                                                        <li><code>.includes(item)</code> - 包含元素</li>
                                                        <li><code>.length</code> - 数组长度</li>
                                                    </ul>
                                                </>
                                            )}
                                        </div>
                                    </TabsContent>
                                </Tabs>
                            </div>

                            {/* Vertical resize handle */}
                            <div
                                className="h-1 bg-gray-200 hover:bg-blue-400 cursor-row-resize transition-colors flex items-center justify-center"
                                onMouseDown={handleVerticalResizeStart}
                            >
                                <div className="w-8 h-0.5 bg-gray-400 rounded" />
                            </div>

                            {/* Bottom section - Expression Configuration Overview */}
                            <div
                                className="flex-1 flex flex-col overflow-hidden min-h-0"
                                style={{ height: `${100 - rightTopHeight}%` }}
                            >
                                {/* Header with title and run button */}
                                <div className="px-4 py-2 border-b bg-gray-50/50 flex-shrink-0 flex items-center justify-between">
                                    <h3 className="font-medium text-gray-900 flex items-center gap-2 text-sm">
                                        <Code2 className="w-4 h-4 text-blue-500" />
                                        表达式配置概览
                                    </h3>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs px-3"
                                        onClick={handleEvaluate}
                                        disabled={isEvaluating || !localExpression.trim()}
                                    >
                                        {isEvaluating ? (
                                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                        ) : (
                                            <Play className="h-3 w-3 mr-1" />
                                        )}
                                        执行
                                    </Button>
                                </div>

                                {/* Scrollable content area */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                    {/* Test Data Preview */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                                            <Eye className="w-3 h-3" />
                                            测试数据预览
                                        </div>
                                        <div className="bg-white rounded-lg border p-3 text-xs font-mono max-h-32 overflow-auto">
                                            {copiedPath && (
                                                <div className="mb-2 p-2 bg-green-50 text-green-700 rounded flex items-center gap-1">
                                                    <Check className="h-3 w-3" />
                                                    已复制: {copiedPath}
                                                </div>
                                            )}
                                            <JsonTreeViewer
                                                data={testData}
                                                expanded={expandedPaths}
                                                onToggle={handleTreeToggle}
                                                onCopyPath={handleCopyPath}
                                            />
                                        </div>
                                    </div>

                                    {/* Evaluation Result - Collapsible */}
                                    {evaluationResult && (
                                        <div className="space-y-2 pt-2 border-t border-gray-100">
                                            <div className="text-xs font-medium text-gray-500">评估结果</div>
                                            <div className={cn(
                                                "p-3 rounded-lg border text-sm",
                                                evaluationResult.result
                                                    ? "bg-green-50 border-green-200"
                                                    : evaluationResult.error
                                                        ? "bg-red-50 border-red-200"
                                                        : "bg-red-50 border-red-200"
                                            )}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        {evaluationResult.result ? (
                                                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                        ) : (
                                                            <XCircle className="h-4 w-4 text-red-600" />
                                                        )}
                                                        <span className={cn(
                                                            "font-medium",
                                                            evaluationResult.result ? "text-green-700" : "text-red-700"
                                                        )}>
                                                            {evaluationResult.result ? "通过" : "不通过"}
                                                        </span>
                                                        {evaluationResult.duration && (
                                                            <Badge variant="outline" className="text-xs">
                                                                {evaluationResult.duration}ms
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    {/* Expand/Collapse button */}
                                                    {(evaluationResult.value || evaluationResult.error) && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 w-6 p-0"
                                                            onClick={() => setIsResultExpanded(!isResultExpanded)}
                                                        >
                                                            {isResultExpanded ? (
                                                                <ChevronDown className="h-4 w-4" />
                                                            ) : (
                                                                <ChevronRight className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    )}
                                                </div>

                                                {/* Error message */}
                                                {evaluationResult.error && (
                                                    <div className="mt-2 text-red-600 text-xs">
                                                        错误: {evaluationResult.error}
                                                    </div>
                                                )}

                                                {/* Expanded details */}
                                                {isResultExpanded && evaluationResult.value && (
                                                    <div className="mt-3 pt-3 border-t border-gray-200">
                                                        <div className="text-xs text-gray-500 mb-2">详细信息:</div>
                                                        <div className="bg-white p-2 rounded border max-h-40 overflow-auto">
                                                            <pre className="text-xs whitespace-pre-wrap break-all text-gray-700 font-mono">
                                                                {JSON.stringify(evaluationResult.value, null, 2)}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Placeholder when no result */}
                                    {!evaluationResult && (
                                        <div className="flex flex-col items-center justify-center py-8 text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
                                            <Play className="h-6 w-6 mb-2" />
                                            <p className="text-xs">点击"执行"按钮运行表达式</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
