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
    Code2,
    BookOpen,
    Copy,
    Check,
    ChevronRight,
    ChevronDown,
    Sparkles
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Code language types
type CodeLanguage = 'javascript' | 'gotemplate' | 'regex' | 'jsonpath'

interface CodeLanguageConfig {
    id: CodeLanguage
    name: string
    description: string
    monacoLanguage: string
    examples: CodeExample[]
    contextSymbol: string
    documentation: DocumentationSection[]
}

interface CodeExample {
    title: string
    description: string
    code: string
}

interface DocumentationSection {
    title: string
    content: string
    examples?: { code: string; description: string }[]
}

// Language configurations
const LANGUAGE_CONFIGS: CodeLanguageConfig[] = [
    {
        id: 'javascript',
        name: 'JavaScript',
        description: '完整的 JavaScript 语法支持，适合复杂转换逻辑',
        monacoLanguage: 'javascript',
        contextSymbol: '$',
        examples: [
            {
                title: '添加前缀',
                description: '为字段添加前缀',
                code: '"[处理] " + $.Subject'
            },
            {
                title: '提取邮箱域名',
                description: '从发件人地址提取域名',
                code: '$.From[0].split("@")[1]'
            },
            {
                title: '条件转换',
                description: '根据条件返回不同值',
                code: '$.Subject.includes("urgent") ? "[紧急] " + $.Subject : $.Subject'
            },
            {
                title: '组合多个字段',
                description: '将多个字段组合成新值',
                code: '`${$.Subject} - 来自 ${$.From[0]}`'
            },
            {
                title: '正则替换',
                description: '使用正则表达式替换内容',
                code: '$.Subject.replace(/\\[.*?\\]/g, "").trim()'
            },
            {
                title: '复杂转换函数',
                description: '使用立即执行函数进行复杂处理',
                code: `(function() {
  const words = $.Subject.split(" ");
  return words.map(w => 
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(" ");
})()`
            }
        ],
        documentation: [
            {
                title: '上下文变量',
                content: '使用 $ 符号访问邮件数据上下文。',
                examples: [
                    { code: '$.Subject', description: '邮件主题' },
                    { code: '$.From', description: '发件人数组' },
                    { code: '$.To', description: '收件人数组' },
                    { code: '$.Body', description: '邮件正文' },
                    { code: '$.Attachments', description: '附件列表' }
                ]
            },
            {
                title: '字符串方法',
                content: '可以使用所有 JavaScript 字符串方法。',
                examples: [
                    { code: '.includes("text")', description: '检查是否包含' },
                    { code: '.replace("a", "b")', description: '替换文本' },
                    { code: '.toUpperCase()', description: '转大写' },
                    { code: '.toLowerCase()', description: '转小写' },
                    { code: '.trim()', description: '去除首尾空格' },
                    { code: '.split("sep")', description: '分割为数组' }
                ]
            },
            {
                title: '数组方法',
                content: '处理发件人、收件人等数组字段。',
                examples: [
                    { code: '.join(", ")', description: '数组转字符串' },
                    { code: '.filter(x => ...)', description: '过滤元素' },
                    { code: '.map(x => ...)', description: '转换每个元素' },
                    { code: '.some(x => ...)', description: '检查是否有满足条件的' },
                    { code: '[0]', description: '获取第一个元素' }
                ]
            }
        ]
    },
    {
        id: 'gotemplate',
        name: 'Go Template',
        description: 'Go 模板语法，适合简单的文本拼接和格式化',
        monacoLanguage: 'go',
        contextSymbol: '.',
        examples: [
            {
                title: '简单替换',
                description: '直接输出字段值',
                code: '{{.Subject}}'
            },
            {
                title: '添加前缀',
                description: '为主题添加前缀',
                code: '[已处理] {{.Subject}}'
            },
            {
                title: '条件输出',
                description: '根据条件输出不同内容',
                code: '{{if .HasAttachments}}[附件] {{end}}{{.Subject}}'
            },
            {
                title: '遍历数组',
                description: '遍历发件人列表',
                code: '{{range .From}}{{.}}, {{end}}'
            },
            {
                title: '字符串函数',
                description: '使用内置字符串函数',
                code: '{{lower .Subject}}'
            },
            {
                title: '复杂模板',
                description: '组合多种模板功能',
                code: `来自: {{index .From 0}}
主题: {{.Subject}}
附件数: {{len .Attachments}}`
            }
        ],
        documentation: [
            {
                title: '基本语法',
                content: '使用 {{ }} 包裹模板表达式，用 . 访问当前上下文。',
                examples: [
                    { code: '{{.Subject}}', description: '输出主题' },
                    { code: '{{.From}}', description: '输出发件人列表' }
                ]
            },
            {
                title: '条件语句',
                content: '使用 if/else 进行条件判断。',
                examples: [
                    { code: '{{if .HasAttachments}}有附件{{else}}无附件{{end}}', description: '条件判断' },
                    { code: '{{if gt (len .Attachments) 0}}有{{end}}', description: '比较判断' }
                ]
            },
            {
                title: '内置函数',
                content: '可用的模板函数。',
                examples: [
                    { code: 'len', description: '获取长度' },
                    { code: 'index', description: '获取索引元素' },
                    { code: 'lower', description: '转小写' },
                    { code: 'upper', description: '转大写' },
                    { code: 'contains', description: '是否包含' },
                    { code: 'hasPrefix', description: '是否以...开头' },
                    { code: 'hasSuffix', description: '是否以...结尾' }
                ]
            }
        ]
    },
    {
        id: 'regex',
        name: '正则表达式',
        description: '用于文本匹配和提取的正则表达式',
        monacoLanguage: 'plaintext',
        contextSymbol: '',
        examples: [
            {
                title: '匹配邮箱',
                description: '提取邮箱地址',
                code: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}'
            },
            {
                title: '匹配工单号',
                description: '提取格式如 TICKET-123 的工单号',
                code: 'TICKET-\\d+'
            },
            {
                title: '匹配日期',
                description: '匹配 YYYY-MM-DD 格式日期',
                code: '\\d{4}-\\d{2}-\\d{2}'
            },
            {
                title: '匹配URL',
                description: '提取 HTTP/HTTPS URL',
                code: 'https?://[\\w\\-]+(\\.[\\w\\-]+)+[\\w\\-.,@?^=%&:/~+#]*'
            },
            {
                title: '提取括号内容',
                description: '提取方括号中的内容',
                code: '\\[([^\\]]+)\\]'
            }
        ],
        documentation: [
            {
                title: '基本元字符',
                content: '正则表达式的基本构建块。',
                examples: [
                    { code: '.', description: '匹配任意单个字符' },
                    { code: '\\d', description: '匹配数字' },
                    { code: '\\w', description: '匹配字母数字下划线' },
                    { code: '\\s', description: '匹配空白字符' },
                    { code: '^', description: '匹配行首' },
                    { code: '$', description: '匹配行尾' }
                ]
            },
            {
                title: '量词',
                content: '指定匹配次数。',
                examples: [
                    { code: '*', description: '0次或多次' },
                    { code: '+', description: '1次或多次' },
                    { code: '?', description: '0次或1次' },
                    { code: '{n}', description: '恰好n次' },
                    { code: '{n,m}', description: 'n到m次' }
                ]
            },
            {
                title: '分组与捕获',
                content: '使用括号进行分组和捕获。',
                examples: [
                    { code: '(pattern)', description: '捕获组' },
                    { code: '(?:pattern)', description: '非捕获组' },
                    { code: '(?<name>pattern)', description: '命名捕获组' }
                ]
            }
        ]
    }
]

interface CodeEditorModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    language: CodeLanguage
    code: string
    onCodeChange: (code: string) => void
    onLanguageChange?: (language: CodeLanguage) => void
    title?: string
    testData?: Record<string, any>
    // 自定义示例和文档（如果提供将覆盖默认配置）
    customExamples?: CodeExample[]
    customDocumentation?: DocumentationSection[]
}

// JSON Tree viewer component for displaying test data
function JsonTreeViewer({
    data,
    path = '',
    expanded = new Set<string>(),
    onToggle,
    onCopyPath,
    contextSymbol = '$'
}: {
    data: any
    path?: string
    expanded?: Set<string>
    onToggle?: (path: string) => void
    onCopyPath?: (path: string) => void
    contextSymbol?: string
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
                        const copyPath = contextSymbol ? `${contextSymbol}.${currentPath}` : currentPath
                        return (
                            <div key={key} className="flex items-start gap-1 py-0.5 group">
                                <span
                                    className="text-blue-600 cursor-pointer hover:underline flex-shrink-0"
                                    onClick={() => onCopyPath?.(copyPath)}
                                    title={`点击复制: ${copyPath}`}
                                >
                                    {isArray ? `[${key}]` : key}:
                                </span>
                                <JsonTreeViewer
                                    data={value}
                                    path={currentPath}
                                    expanded={expanded}
                                    onToggle={onToggle}
                                    onCopyPath={onCopyPath}
                                    contextSymbol={contextSymbol}
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

export function CodeEditorModal({
    open,
    onOpenChange,
    language,
    code,
    onCodeChange,
    onLanguageChange,
    title = '代码编辑器',
    testData = {},
    customExamples,
    customDocumentation
}: CodeEditorModalProps) {
    const [localCode, setLocalCode] = useState(code)
    const [copiedPath, setCopiedPath] = useState<string | null>(null)
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['']))
    const [activeTab, setActiveTab] = useState<'examples' | 'docs' | 'data'>('examples')
    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
    const monacoRef = useRef<typeof import('monaco-editor') | null>(null)

    const currentConfig = useMemo(
        () => LANGUAGE_CONFIGS.find(c => c.id === language) || LANGUAGE_CONFIGS[0],
        [language]
    )

    // 使用自定义示例/文档（如果提供）或者默认配置
    const effectiveExamples = customExamples || currentConfig.examples
    const effectiveDocumentation = customDocumentation || currentConfig.documentation

    // Sync code when modal opens
    useEffect(() => {
        if (open) {
            setLocalCode(code)
        }
    }, [open, code])

    // Configure Monaco editor before mount
    const handleEditorWillMount: BeforeMount = useCallback((monaco) => {
        monacoRef.current = monaco
    }, [])

    // Configure Monaco editor after mount
    const handleEditorMount: OnMount = useCallback((editor, monaco) => {
        editorRef.current = editor
        monacoRef.current = monaco

        // Import methods from monaco-config
        const { STRING_METHODS, ARRAY_METHODS } = require('@/lib/monaco-config')

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
            return []
        }

        // Helper: get value at path in testData
        const getValueAtPath = (obj: any, path: string): any => {
            if (!path || !obj) return obj
            const parts = path.split('.')
            let current = obj
            for (const part of parts) {
                if (current === null || current === undefined) return undefined
                current = current[part]
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
                suggestions.push({
                    label: key,
                    kind: monaco.languages.CompletionItemKind.Property,
                    insertText: key,
                    detail: type,
                    range,
                    sortText: `0_${key}`
                })
            }

            return suggestions
        }

        // Register completion provider for JavaScript
        if (currentConfig.monacoLanguage === 'javascript') {
            const disposable = monaco.languages.registerCompletionItemProvider('javascript', {
                triggerCharacters: ['.', '$'],
                provideCompletionItems: (model: MonacoEditor.ITextModel, position: { lineNumber: number; column: number }) => {
                    const word = model.getWordUntilPosition(position)
                    const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn
                    }

                    const lineContent = model.getLineContent(position.lineNumber)
                    const textBeforeCursor = lineContent.substring(0, position.column - 1)

                    const suggestions: languages.CompletionItem[] = []

                    // Check if we're right after '$.'
                    if (textBeforeCursor.endsWith('$.')) {
                        suggestions.push(...generateFieldSuggestions(testData, monaco, range))
                        return { suggestions }
                    }

                    // Parse the path after '$.
                    const pathMatch = textBeforeCursor.match(/\$\.([a-zA-Z0-9_\[\].]*)\.$/)
                    if (pathMatch) {
                        const path = pathMatch[1]
                        const valueAtPath = getValueAtPath(testData, path)
                        const valueType = inferType(valueAtPath)

                        if (typeof valueAtPath === 'object' && valueAtPath !== null && !Array.isArray(valueAtPath)) {
                            suggestions.push(...generateFieldSuggestions(valueAtPath, monaco, range))
                        }

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
                                range
                            })
                        })

                        if (suggestions.length > 0) {
                            return { suggestions }
                        }
                    }

                    // Default: suggest $
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
            })

            return () => disposable.dispose()
        }

        editor.focus()
    }, [currentConfig.monacoLanguage, testData])

    // Handle save
    const handleSave = () => {
        onCodeChange(localCode)
        onOpenChange(false)
    }

    // Handle example click
    const handleExampleClick = (exampleCode: string) => {
        setLocalCode(exampleCode)
        editorRef.current?.setValue(exampleCode)
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[90vw] w-[1200px] max-h-[85vh] h-[700px] p-0 overflow-hidden">
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
                        <div className="flex items-center gap-3">
                            <Code2 className="h-5 w-5 text-blue-600" />
                            <DialogTitle className="text-lg font-semibold">
                                {title}
                            </DialogTitle>
                            {/* Language selector */}
                            {onLanguageChange && (
                                <div className="flex items-center gap-1 ml-4">
                                    {LANGUAGE_CONFIGS.filter(c => c.id !== 'regex').map(config => (
                                        <Badge
                                            key={config.id}
                                            variant={config.id === language ? 'default' : 'outline'}
                                            className={cn(
                                                'cursor-pointer transition-colors',
                                                config.id === language
                                                    ? 'bg-blue-600'
                                                    : 'hover:bg-gray-100'
                                            )}
                                            onClick={() => onLanguageChange(config.id)}
                                        >
                                            {config.name}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onOpenChange(false)}
                            >
                                取消
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleSave}
                                className="gap-1"
                            >
                                <Check className="h-4 w-4" />
                                确认
                            </Button>
                        </div>
                    </div>

                    {/* Main content */}
                    <div className="flex flex-1 overflow-hidden">
                        {/* Left panel - Editor */}
                        <div className="flex-1 flex flex-col border-r">
                            <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary" className="text-xs">
                                        {currentConfig.name}
                                    </Badge>
                                    <span className="text-xs text-gray-500">
                                        {currentConfig.description}
                                    </span>
                                </div>
                            </div>
                            <div className="flex-1">
                                <Editor
                                    height="100%"
                                    language={currentConfig.monacoLanguage}
                                    value={localCode}
                                    onChange={(value) => setLocalCode(value || '')}
                                    beforeMount={handleEditorWillMount}
                                    onMount={handleEditorMount}
                                    options={{
                                        minimap: { enabled: false },
                                        fontSize: 14,
                                        lineNumbers: 'on',
                                        wordWrap: 'on',
                                        automaticLayout: true,
                                        scrollBeyondLastLine: false,
                                        tabSize: 2,
                                        suggest: {
                                            showWords: false
                                        }
                                    }}
                                    theme="vs-light"
                                />
                            </div>
                        </div>

                        {/* Right panel - Examples/Docs/Data */}
                        <div className="w-[400px] flex flex-col">
                            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex flex-col h-full">
                                <TabsList className="mx-3 mt-3 grid grid-cols-3">
                                    <TabsTrigger value="examples" className="gap-1">
                                        <Sparkles className="h-3 w-3" />
                                        示例
                                    </TabsTrigger>
                                    <TabsTrigger value="docs" className="gap-1">
                                        <BookOpen className="h-3 w-3" />
                                        文档
                                    </TabsTrigger>
                                    <TabsTrigger value="data" className="gap-1">
                                        <Code2 className="h-3 w-3" />
                                        数据
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="examples" className="flex-1 overflow-auto p-3 space-y-2">
                                    {effectiveExamples.map((example, index) => (
                                        <div
                                            key={index}
                                            className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                                            onClick={() => handleExampleClick(example.code)}
                                        >
                                            <h4 className="font-medium text-sm">{example.title}</h4>
                                            <p className="text-xs text-gray-500 mt-1">{example.description}</p>
                                            <pre className="text-xs bg-gray-100 p-2 rounded mt-2 overflow-x-auto whitespace-pre-wrap">
                                                {example.code}
                                            </pre>
                                        </div>
                                    ))}
                                </TabsContent>

                                <TabsContent value="docs" className="flex-1 overflow-auto p-3 space-y-4">
                                    {effectiveDocumentation.map((section, index) => (
                                        <div key={index} className="space-y-2">
                                            <h4 className="font-medium text-sm flex items-center gap-2">
                                                <BookOpen className="h-4 w-4 text-blue-600" />
                                                {section.title}
                                            </h4>
                                            <p className="text-xs text-gray-600">{section.content}</p>
                                            {section.examples && (
                                                <div className="space-y-1">
                                                    {section.examples.map((ex, i) => (
                                                        <div
                                                            key={i}
                                                            className="flex items-center gap-2 text-xs p-2 bg-gray-50 rounded hover:bg-gray-100 cursor-pointer"
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(ex.code)
                                                                setCopiedPath(ex.code)
                                                                setTimeout(() => setCopiedPath(null), 1500)
                                                            }}
                                                        >
                                                            <code className="text-blue-600 font-mono">{ex.code}</code>
                                                            <span className="text-gray-500 flex-1">{ex.description}</span>
                                                            {copiedPath === ex.code ? (
                                                                <Check className="h-3 w-3 text-green-500" />
                                                            ) : (
                                                                <Copy className="h-3 w-3 text-gray-400" />
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </TabsContent>

                                <TabsContent value="data" className="flex-1 overflow-auto p-3">
                                    <div className="text-xs text-gray-500 mb-2">
                                        点击字段名可复制到编辑器
                                    </div>
                                    {Object.keys(testData).length > 0 ? (
                                        <div className="font-mono text-xs">
                                            <JsonTreeViewer
                                                data={testData}
                                                expanded={expandedPaths}
                                                onToggle={handleTreeToggle}
                                                onCopyPath={handleCopyPath}
                                                contextSymbol={currentConfig.contextSymbol}
                                            />
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <Code2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">暂无测试数据</p>
                                            <p className="text-xs mt-1">选择一封邮件后可查看可用字段</p>
                                        </div>
                                    )}
                                </TabsContent>
                            </Tabs>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export { LANGUAGE_CONFIGS, type CodeLanguage, type CodeExample, type DocumentationSection }
