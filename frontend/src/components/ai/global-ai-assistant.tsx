'use client'

import { FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, useMemo, useRef, useState } from 'react'
import { Bold, Bot, CheckCircle, ChevronDown, ChevronRight, Clock, Code, Italic, List, Loader2, Maximize2, MessageSquarePlus, PanelRightClose, Send, Sparkles, XCircle } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAIRuntime, formatDuration } from './ai-runtime-provider'
import type { AISubagentTask, AITaskStatus } from './types'

function statusLabel(status: AITaskStatus) {
    switch (status) {
        case 'queued':
            return '排队中'
        case 'thinking':
            return '思考中'
        case 'running':
            return '执行中'
        case 'waiting_confirmation':
            return '待确认'
        case 'completed':
            return '完成'
        case 'failed':
            return '失败'
        case 'cancelled':
            return '已取消'
        default:
            return status
    }
}

function statusTone(status: AITaskStatus) {
    if (status === 'completed') return 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-800'
    if (status === 'failed' || status === 'cancelled') return 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/40 dark:border-red-800'
    if (status === 'waiting_confirmation') return 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800'
    return 'text-primary-700 bg-primary-50 border-primary-200 dark:text-primary-300 dark:bg-primary-950/30 dark:border-primary-800'
}

function TaskStatusIcon({ status }: { status: AITaskStatus }) {
    if (status === 'completed') return <CheckCircle className="h-3.5 w-3.5" />
    if (status === 'failed' || status === 'cancelled') return <XCircle className="h-3.5 w-3.5" />
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />
}

function TaskCard({
    task,
    detailsOpen,
    onToggleDetails,
    onToggleThinking,
}: {
    task: AISubagentTask
    detailsOpen: boolean
    onToggleDetails: () => void
    onToggleThinking: () => void
}) {
    const elapsed = task.durationMs ?? (Date.now() - task.startedAt)
    const hasThinking = task.thinkingSummary.length > 0

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start gap-2">
                <div className={cn('mt-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', statusTone(task.status))}>
                    <TaskStatusIcon status={task.status} />
                    {statusLabel(task.status)}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gray-900 dark:text-gray-100">{task.userMessage}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {formatDuration(elapsed)}
                        </span>
                        {task.targetSkillId && <span>{task.targetSkillId}</span>}
                        {task.targetActionName && <span>{task.targetActionName}</span>}
                    </div>
                </div>
            </div>

            {hasThinking && (
                <div className="mt-3">
                    <button
                        type="button"
                        onClick={onToggleThinking}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        <span>思考摘要</span>
                        {task.thinkingCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {!task.thinkingCollapsed && (
                        <div className="mt-1 space-y-1 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-900/60 dark:text-gray-300">
                            {task.thinkingSummary.map((item, index) => (
                                <div key={`${task.id}-thinking-${index}`} className="flex gap-2">
                                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
                                    <span>{item}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="mt-2">
                <button
                    type="button"
                    onClick={onToggleDetails}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                    <span>执行详情</span>
                    {detailsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                {detailsOpen && (
                    <div className="mt-2 space-y-2 border-l border-gray-200 pl-3 dark:border-gray-700">
                        {task.steps.length === 0 ? (
                            <p className="text-xs text-gray-500 dark:text-gray-400">等待任务开始</p>
                        ) : task.steps.map(step => (
                            <div key={step.id} className="text-xs">
                                <div className="flex items-center justify-between gap-3">
                                    <span className={cn(
                                        'font-medium',
                                        step.status === 'failed' ? 'text-red-600 dark:text-red-300' : 'text-gray-700 dark:text-gray-200'
                                    )}>
                                        {step.title}
                                    </span>
                                    <span className="shrink-0 text-gray-400">{formatDuration(step.durationMs)}</span>
                                </div>
                                {(step.summary || step.details) && (
                                    <p className="mt-0.5 text-gray-500 dark:text-gray-400">{step.summary || step.details}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

function insertTextAtSelection(text: string) {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStartAfter(node)
    range.setEndAfter(node)
    selection.removeAllRanges()
    selection.addRange(range)
}

function wrapSelection(prefix: string, suffix = prefix) {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const selectedText = selection.toString()
    insertTextAtSelection(selectedText ? `${prefix}${selectedText}${suffix}` : `${prefix}${suffix}`)
}

function ComposerButton({
    title,
    children,
    onClick,
}: {
    title: string
    children: ReactNode
    onClick: () => void
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
        >
            {children}
        </button>
    )
}

function renderInlineMarkdown(text: string) {
    const parts: ReactNode[] = []
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|\*[^*]+\*)/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index))
        }

        const token = match[0]
        const key = `${match.index}-${token}`
        if (token.startsWith('**') && token.endsWith('**')) {
            parts.push(<strong key={key}>{token.slice(2, -2)}</strong>)
        } else if (token.startsWith('`') && token.endsWith('`')) {
            parts.push(
                <code key={key} className="rounded bg-gray-200 px-1 py-0.5 text-[0.92em] text-gray-900 dark:bg-gray-700 dark:text-gray-100">
                    {token.slice(1, -1)}
                </code>
            )
        } else if (token.startsWith('[')) {
            const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
            if (link) {
                parts.push(
                    <a key={key} href={link[2]} target="_blank" rel="noreferrer" className="font-medium text-primary-600 underline underline-offset-2 dark:text-primary-300">
                        {link[1]}
                    </a>
                )
            } else {
                parts.push(token)
            }
        } else if (token.startsWith('*') && token.endsWith('*')) {
            parts.push(<em key={key}>{token.slice(1, -1)}</em>)
        } else {
            parts.push(token)
        }
        lastIndex = match.index + token.length
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex))
    }
    return parts
}

function MarkdownContent({ content, isUser }: { content: string; isUser: boolean }) {
    if (isUser) {
        return <p className="whitespace-pre-wrap break-words">{content}</p>
    }

    const blocks: ReactNode[] = []
    const lines = content.split(/\r?\n/)
    let index = 0

    while (index < lines.length) {
        const line = lines[index]
        const fence = line.match(/^```(\w*)\s*$/)
        if (fence) {
            const language = fence[1]
            const codeLines: string[] = []
            index += 1
            while (index < lines.length && !lines[index].startsWith('```')) {
                codeLines.push(lines[index])
                index += 1
            }
            index += 1
            blocks.push(
                <pre key={`code-${index}`} className="my-2 overflow-x-auto rounded-md bg-gray-900 p-3 text-xs text-gray-100">
                    {language && <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">{language}</div>}
                    <code>{codeLines.join('\n')}</code>
                </pre>
            )
            continue
        }

        if (!line.trim()) {
            index += 1
            continue
        }

        const heading = line.match(/^(#{1,3})\s+(.+)$/)
        if (heading) {
            const level = heading[1].length
            const className = level === 1
                ? 'mt-2 text-base font-semibold'
                : level === 2
                    ? 'mt-2 text-sm font-semibold'
                    : 'mt-1 text-sm font-medium'
            blocks.push(<div key={`heading-${index}`} className={className}>{renderInlineMarkdown(heading[2])}</div>)
            index += 1
            continue
        }

        if (/^[-*]\s+/.test(line)) {
            const items: string[] = []
            while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
                items.push(lines[index].replace(/^[-*]\s+/, ''))
                index += 1
            }
            blocks.push(
                <ul key={`ul-${index}`} className="my-1 list-disc space-y-1 pl-5">
                    {items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}
                </ul>
            )
            continue
        }

        if (/^\d+\.\s+/.test(line)) {
            const items: string[] = []
            while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
                items.push(lines[index].replace(/^\d+\.\s+/, ''))
                index += 1
            }
            blocks.push(
                <ol key={`ol-${index}`} className="my-1 list-decimal space-y-1 pl-5">
                    {items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}
                </ol>
            )
            continue
        }

        blocks.push(<p key={`p-${index}`} className="my-1 whitespace-pre-wrap break-words">{renderInlineMarkdown(line)}</p>)
        index += 1
    }

    return <div className="break-words leading-5">{blocks}</div>
}

interface GlobalAIAssistantProps {
    forceVisible?: boolean
    authState?: {
        isAuthenticated: boolean
        isLoading: boolean
    }
}

export function GlobalAIAssistant({ forceVisible = false, authState }: GlobalAIAssistantProps) {
    const pathname = usePathname()
    const {
        isOpen,
        messages,
        tasks,
        navigation,
        selectedText,
        openAssistant,
        closeAssistant,
        newSession,
        sendMessage,
        toggleTaskThinking,
    } = useAIRuntime()
    const [input, setInput] = useState('')
    const [composerHeight, setComposerHeight] = useState(92)
    const [sending, setSending] = useState(false)
    const [detailsOpenTaskIds, setDetailsOpenTaskIds] = useState<Set<string>>(new Set())
    const editorRef = useRef<HTMLDivElement | null>(null)

    const isLoading = authState?.isLoading ?? false
    const isAuthenticated = authState?.isAuthenticated ?? true
    const hidden = !forceVisible && (isLoading || !isAuthenticated || pathname.startsWith('/login'))
    const selectedTextLength = selectedText.trim().length
    const latestTaskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks])

    if (hidden) return null

    const handleSubmit = async (event?: FormEvent) => {
        event?.preventDefault()
        const value = input.trim()
        if (!value || sending) return
        setSending(true)
        setInput('')
        if (editorRef.current) {
            editorRef.current.innerHTML = ''
        }
        try {
            await sendMessage(value)
        } finally {
            setSending(false)
            editorRef.current?.focus()
        }
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleSubmit()
        }
    }

    const handleComposerInput = () => {
        const text = editorRef.current?.innerText || ''
        setInput(text.replace(/\u00a0/g, ' '))
    }

    const setComposerText = (value: string) => {
        setInput(value)
        if (editorRef.current) {
            editorRef.current.textContent = value
        }
    }

    const applyFormat = (formatter: () => void) => {
        editorRef.current?.focus()
        formatter()
        handleComposerInput()
    }

    const startResize = (event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault()
        const startY = event.clientY
        const startHeight = composerHeight

        const handleMove = (moveEvent: MouseEvent) => {
            const delta = startY - moveEvent.clientY
            setComposerHeight(Math.min(220, Math.max(58, startHeight + delta)))
        }

        const handleUp = () => {
            window.removeEventListener('mousemove', handleMove)
            window.removeEventListener('mouseup', handleUp)
        }

        window.addEventListener('mousemove', handleMove)
        window.addEventListener('mouseup', handleUp)
    }

    const toggleDetails = (taskId: string) => {
        setDetailsOpenTaskIds(prev => {
            const next = new Set(prev)
            if (next.has(taskId)) {
                next.delete(taskId)
            } else {
                next.add(taskId)
            }
            return next
        })
    }

    return (
        <>
            {!isOpen && (
                <button
                    type="button"
                    onClick={openAssistant}
                    className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-primary-200 bg-primary-600 text-white shadow-lg shadow-primary-900/15 transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-primary-700 dark:shadow-black/30"
                    title="AI 助手"
                >
                    <Sparkles className="h-5 w-5" />
                </button>
            )}

            {isOpen && (
                <section className="fixed bottom-4 right-4 z-40 flex h-[min(680px,calc(100vh-32px))] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl shadow-gray-900/20 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/40">
                    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
                            <Bot className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">AI 助手</h2>
                            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                                {navigation.activeTab || '未识别页面'} · {typeof window !== 'undefined' ? window.location.host : ''}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={newSession}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                            title="新建会话"
                        >
                            <MessageSquarePlus className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={closeAssistant}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                            title="收起"
                        >
                            <PanelRightClose className="h-4 w-4" />
                        </button>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                        {messages.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center text-center">
                                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-primary-600 dark:border-gray-700 dark:bg-gray-800">
                                    <Maximize2 className="h-5 w-5" />
                                </div>
                                <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">当前页面已就绪</p>
                                <p className="mt-1 max-w-[280px] text-xs leading-5 text-gray-500 dark:text-gray-400">
                                    {navigation.activeTab === 'accounts'
                                        ? '可以处理账户搜索、打开添加账户窗口和页面跳转。'
                                        : '可以识别当前 tab、域名和选中文本，并调用已注册页面能力。'}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {messages.map(message => {
                                    const task = message.taskId ? latestTaskById.get(message.taskId) : null
                                    return (
                                        <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                                            <div className={cn(
                                                'max-w-[88%] rounded-lg px-3 py-2 text-sm',
                                                message.role === 'user'
                                                    ? 'bg-primary-600 text-white'
                                                    : 'border border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
                                            )}>
                                                <MarkdownContent content={message.content} isUser={message.role === 'user'} />
                                                {task && (
                                                    <div className="mt-2">
                                                        <TaskCard
                                                            task={task}
                                                            detailsOpen={detailsOpenTaskIds.has(task.id)}
                                                            onToggleDetails={() => toggleDetails(task.id)}
                                                            onToggleThinking={() => toggleTaskThinking(task.id)}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSubmit} className="shrink-0 border-t border-gray-200 p-3 dark:border-gray-700">
                        {selectedTextLength > 0 && (
                            <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                <span className="truncate">已选中文本 {selectedTextLength} 字</span>
                                <button type="button" onClick={() => setComposerText(input || '解释我选中的内容')} className="shrink-0 rounded px-1.5 py-0.5 text-primary-600 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/40">
                                    使用
                                </button>
                            </div>
                        )}
                        <div className="rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 dark:ring-offset-gray-900">
                            <div
                                className="flex h-2 cursor-ns-resize items-center justify-center border-b border-gray-100 dark:border-gray-800"
                                onMouseDown={startResize}
                                title="拖拽调整输入区高度"
                            >
                                <span className="h-0.5 w-8 rounded-full bg-gray-300 dark:bg-gray-600" />
                            </div>
                            <div className="flex items-center gap-1 border-b border-gray-100 px-2 py-1 dark:border-gray-800">
                                <ComposerButton title="加粗" onClick={() => applyFormat(() => wrapSelection('**'))}>
                                    <Bold className="h-3.5 w-3.5" />
                                </ComposerButton>
                                <ComposerButton title="斜体" onClick={() => applyFormat(() => wrapSelection('*'))}>
                                    <Italic className="h-3.5 w-3.5" />
                                </ComposerButton>
                                <ComposerButton title="代码" onClick={() => applyFormat(() => wrapSelection('`'))}>
                                    <Code className="h-3.5 w-3.5" />
                                </ComposerButton>
                                <ComposerButton title="列表" onClick={() => applyFormat(() => insertTextAtSelection('- '))}>
                                    <List className="h-3.5 w-3.5" />
                                </ComposerButton>
                                <span className="ml-auto rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400" title="Cmd/Ctrl + Enter 发送">
                                    ⌘↵
                                </span>
                            </div>
                            <div className="relative">
                                {!input.trim() && (
                                    <div className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
                                        输入请求...
                                    </div>
                                )}
                                <div
                                    ref={editorRef}
                                    contentEditable
                                    suppressContentEditableWarning
                                    onInput={handleComposerInput}
                                    onKeyDown={handleKeyDown}
                                    className="overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-sm outline-none"
                                    style={{ height: composerHeight }}
                                    role="textbox"
                                    aria-multiline="true"
                                    aria-label="输入请求"
                                />
                            </div>
                        </div>
                        <div className="mt-2 flex justify-end">
                            <Button
                                type="submit"
                                size="icon"
                                disabled={!input.trim() || sending}
                                className="h-9 w-9 shrink-0 rounded-lg"
                                title="发送 · Cmd/Ctrl + Enter"
                            >
                                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                        </div>
                    </form>
                </section>
            )}
        </>
    )
}
