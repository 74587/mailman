'use client'
import { logger } from '@/lib/logger';

import React, { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import {
    Send,
    ChevronDown,
    X,
    Loader2,
    AlertCircle,
    CheckCircle,
    ChevronUp,
    Search,
    User,
    Code2,
    LayoutTemplate,
    AlertTriangle,
    Paperclip,
    FileIcon,
    Trash2,
    Pencil,
} from 'lucide-react'
import { emailAccountService } from '@/services/email-account.service'
import { EmailAccount, Email } from '@/types'
import { cn, formatDate } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { registerTabCallback, unregisterTabCallback } from '@/lib/tab-utils'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

// 动态导入编辑器
const MDEditor = dynamic(() => import('@uiw/react-md-editor'), {
    ssr: false,
    loading: () => (
        <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-800">
            <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>加载 Markdown 编辑器...</span>
            </div>
        </div>
    ),
})

const GrapesEmailEditor = dynamic(() => import('@/components/email/grapes-email-editor'), {
    ssr: false,
    loading: () => (
        <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-800">
            <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>加载高级编辑器...</span>
            </div>
        </div>
    ),
})

const RichTextEditor = dynamic(() => import('@/components/email/rich-text-editor'), {
    ssr: false,
    loading: () => (
        <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-800">
            <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>加载富文本编辑器...</span>
            </div>
        </div>
    ),
})

// 编辑器模式
type EditorMode = 'markdown' | 'visual' | 'rich-text'

// 默认 Markdown 内容
const DEFAULT_MARKDOWN = `# 邮件标题

你好！

这是使用 **Markdown** 编写的邮件内容。

## 特性
- 支持**粗体**和*斜体*
- 支持列表
- 支持 \`代码\` 格式

---

祝好！
`

// 邮箱搜索建议组件
function EmailSuggestions({
    query,
    accounts,
    onSelect,
    onClose,
    isOpen,
}: {
    query: string
    accounts: EmailAccount[]
    onSelect: (email: string) => void
    onClose: () => void
    isOpen: boolean
}) {
    if (!isOpen || query.length < 1) return null

    const filteredAccounts = accounts.filter((account) =>
        account.emailAddress.toLowerCase().includes(query.toLowerCase())
    )

    if (filteredAccounts.length === 0) return null

    return (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-50 max-h-64 w-[min(420px,100%)] min-w-[280px] overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-600 dark:bg-gray-700">
            {filteredAccounts.map((account) => (
                <button
                    key={account.id}
                    type="button"
                    onClick={() => {
                        onSelect(account.emailAddress)
                        onClose()
                    }}
                    className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600"
                >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-600">
                        <User className="h-4 w-4 text-gray-400" />
                    </div>
                    <div className="min-w-0">
                        <div className="truncate font-medium text-gray-900 dark:text-white">{account.emailAddress}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                            {account.mailProvider?.name || account.mailProvider?.type}
                        </div>
                    </div>
                </button>
            ))}
        </div>
    )
}

// 收件人标签组件
function RecipientTags({
    label,
    recipients,
    setRecipients,
    placeholder,
    isExpanded = true,
    accounts,
}: {
    label: string
    recipients: string[]
    setRecipients: (recipients: string[]) => void
    placeholder: string
    isExpanded?: boolean
    accounts: EmailAccount[]
}) {
    const [inputValue, setInputValue] = useState('')
    const [showSuggestions, setShowSuggestions] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
            e.preventDefault()
            addRecipient(inputValue)
        } else if (e.key === 'Backspace' && inputValue === '' && recipients.length > 0) {
            setRecipients(recipients.slice(0, -1))
        } else if (e.key === 'Escape') {
            setShowSuggestions(false)
        }
    }

    const addRecipient = (email: string) => {
        const trimmedEmail = email.trim().replace(/,/g, '')
        if (trimmedEmail && isValidEmail(trimmedEmail) && !recipients.includes(trimmedEmail)) {
            setRecipients([...recipients, trimmedEmail])
            setInputValue('')
            setShowSuggestions(false)
        }
    }

    const removeRecipient = (index: number) => {
        setRecipients(recipients.filter((_, i) => i !== index))
    }

    const isValidEmail = (email: string) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    }

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setShowSuggestions(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    if (!isExpanded) return null

    // 当 label 为空时，渲染简化版本（用于新布局）
    if (!label) {
        return (
            <div ref={containerRef} className="relative min-h-7">
                <div className="relative z-10 flex min-h-7 flex-wrap items-center gap-1">
                    {recipients.map((recipient, index) => (
                        <span
                            key={index}
                            className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[13px] text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        >
                            {recipient}
                            <button
                                type="button"
                                onClick={() => removeRecipient(index)}
                                className="rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value)
                            setShowSuggestions(true)
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onKeyDown={handleKeyDown}
                        onBlur={() => {
                            setTimeout(() => {
                                if (inputValue.trim()) {
                                    addRecipient(inputValue)
                                }
                            }, 200)
                        }}
                        placeholder={recipients.length === 0 ? placeholder : ''}
                        className="h-7 flex-1 min-w-[160px] bg-transparent text-[13px] outline-none border-none focus:ring-0 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    />
                </div>
                <EmailSuggestions
                    query={inputValue}
                    accounts={accounts.filter((a) => !recipients.includes(a.emailAddress))}
                    onSelect={addRecipient}
                    onClose={() => setShowSuggestions(false)}
                    isOpen={showSuggestions}
                />
            </div>
        )
    }

    return (
        <div
            ref={containerRef}
            className="relative flex items-start border-b border-gray-200 dark:border-gray-700"
        >
            <label className="w-16 flex-shrink-0 py-3 text-sm font-medium text-gray-500 dark:text-gray-400">
                {label}
            </label>
            <div className="flex flex-1 flex-wrap items-center gap-1 py-2">
                {recipients.map((recipient, index) => (
                    <span
                        key={index}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-sm text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                    >
                        {recipient}
                        <button
                            type="button"
                            onClick={() => removeRecipient(index)}
                            className="rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
                <div className="relative min-w-[200px] flex-1">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value)
                            setShowSuggestions(true)
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onKeyDown={handleKeyDown}
                        onBlur={() => {
                            setTimeout(() => {
                                if (inputValue.trim()) {
                                    addRecipient(inputValue)
                                }
                            }, 200)
                        }}
                        placeholder={recipients.length === 0 ? placeholder : ''}
                        className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    />
                    <EmailSuggestions
                        query={inputValue}
                        accounts={accounts.filter((a) => !recipients.includes(a.emailAddress))}
                        onSelect={addRecipient}
                        onClose={() => setShowSuggestions(false)}
                        isOpen={showSuggestions}
                    />
                </div>
            </div>
        </div>
    )
}

// 发件人选择器
function SenderSelector({
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    loading,
}: {
    accounts: EmailAccount[]
    selectedAccountId: number | null
    setSelectedAccountId: (id: number | null) => void
    loading: boolean
}) {
    const [isOpen, setIsOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const containerRef = useRef<HTMLDivElement>(null)

    const selectedAccount = accounts.find((a) => a.id === selectedAccountId)
    const filteredAccounts = accounts.filter((account) =>
        account.emailAddress.toLowerCase().includes(searchQuery.toLowerCase())
    )

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    return (
        <div ref={containerRef} className="relative z-50 flex-1">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                disabled={loading}
                className="flex w-full items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-1.5 text-left text-[13px] hover:bg-gray-100 dark:hover:bg-gray-600/50 transition-colors"
            >
                {loading ? (
                    <span className="flex items-center gap-2 text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        加载中...
                    </span>
                ) : selectedAccount ? (
                    <span className="text-gray-900 dark:text-white">
                        {selectedAccount.emailAddress}
                    </span>
                ) : (
                    <span className="text-gray-500">选择发件账户</span>
                )}
                <ChevronDown className="h-4 w-4 text-gray-400" />
            </button>

            {isOpen && (
                <div className="absolute left-0 right-0 top-full z-[70] mt-1 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-700">
                    <div className="border-b border-gray-200 p-2 dark:border-gray-600">
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="搜索邮箱账户..."
                                className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800"
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="max-h-48 overflow-auto">
                        {filteredAccounts.length === 0 ? (
                            <div className="px-3 py-4 text-center text-sm text-gray-500">
                                没有找到匹配的账户
                            </div>
                        ) : (
                            filteredAccounts.map((account) => (
                                <button
                                    key={account.id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedAccountId(account.id)
                                        setIsOpen(false)
                                        setSearchQuery('')
                                    }}
                                    className={cn(
                                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600',
                                        selectedAccountId === account.id && 'bg-blue-50 dark:bg-blue-900/20'
                                    )}
                                >
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-600">
                                        <User className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                                    </div>
                                    <div>
                                        <div className="font-medium text-gray-900 dark:text-white">
                                            {account.emailAddress}
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                            {account.mailProvider?.name || account.mailProvider?.type}
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

// 确认切换对话框
function SwitchConfirmDialog({
    open,
    onOpenChange,
    onConfirm,
    targetMode,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
    targetMode: EditorMode
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                        <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <DialogTitle className="text-center">切换编辑器模式</DialogTitle>
                    <DialogDescription className="text-center">
                        切换到{targetMode === 'markdown' ? 'Markdown' : '可视化'}编辑器将会清空当前编辑的内容，是否继续？
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex gap-2 sm:justify-center">
                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            onConfirm()
                            onOpenChange(false)
                        }}
                        className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                    >
                        确认切换
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// Props 接口：支持从外部传入初始数据（用于回复/转发）
interface FileAttachment {
    file: File
    name: string // Allow renaming
    content: string // Base64
}

// Helper to strip HTML tags
const stripHtml = (html: string) => {
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
}

interface ComposeEmailTabProps {
    initialMode?: 'reply' | 'reply-all' | 'forward'
    initialEmail?: Email
    initialAccountId?: number
}

export default function ComposeEmailTab({
    initialMode,
    initialEmail,
    initialAccountId
}: ComposeEmailTabProps = {}) {
    // 编辑器模式和内容 - 默认使用 Markdown
    const [editorMode, setEditorMode] = useState<EditorMode>('markdown')
    const [markdownContent, setMarkdownContent] = useState<string>(DEFAULT_MARKDOWN)
    const [visualHtml, setVisualHtml] = useState<string>('')
    const [hasVisualContent, setHasVisualContent] = useState(false)
    const [attachments, setAttachments] = useState<FileAttachment[]>([])

    // 切换确认对话框
    const [showSwitchConfirm, setShowSwitchConfirm] = useState(false)
    const [pendingMode, setPendingMode] = useState<EditorMode | null>(null)
    const [isDragging, setIsDragging] = useState(false)

    // 邮箱账户
    const [allAccounts, setAllAccounts] = useState<EmailAccount[]>([])
    const [senderAccounts, setSenderAccounts] = useState<EmailAccount[]>([])
    const [loadingAccounts, setLoadingAccounts] = useState(true)

    // 表单状态
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
    const [toRecipients, setToRecipients] = useState<string[]>([])
    const [ccRecipients, setCcRecipients] = useState<string[]>([])
    const [bccRecipients, setBccRecipients] = useState<string[]>([])
    const [subject, setSubject] = useState('')
    const [showCcBcc, setShowCcBcc] = useState(false)

    // 编辑器状态
    const [editorReady, setEditorReady] = useState(false)

    // 发送状态
    const [sending, setSending] = useState(false)
    const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null)
    const [showResultDialog, setShowResultDialog] = useState(false)

    // 回复/转发模式
    const [composeMode, setComposeMode] = useState<'new' | 'reply' | 'reply-all' | 'forward'>('new')
    const [originalEmail, setOriginalEmail] = useState<Email | null>(null)

    // 引用 HTML 状态 (用于 Split View)
    const [quotedHtml, setQuotedHtml] = useState<string>('')

    // 生成回复主题
    const generateSubject = useCallback((email: Email, mode: 'reply' | 'reply-all' | 'forward'): string => {
        const originalSubject = email.Subject || ''
        if (mode === 'forward') {
            if (originalSubject.toLowerCase().startsWith('fwd:')) return originalSubject
            return `Fwd: ${originalSubject}`
        } else {
            if (originalSubject.toLowerCase().startsWith('re:')) return originalSubject
            return `Re: ${originalSubject}`
        }
    }, [])

    // 生成引用内容 (保留HTML样式)
    const generateQuotedHtml = useCallback((email: Email, mode: 'reply' | 'reply-all' | 'forward'): string => {
        const fromStr = Array.isArray(email.From) ? email.From.join(', ') : email.From
        const toStr = Array.isArray(email.To) ? email.To.join(', ') : email.To
        const dateStr = formatDate(email.Date)
        const originalContent = email.HTMLBody || `<pre style="white-space: pre-wrap;">${email.Body || ''}</pre>`

        if (mode === 'forward') {
            return `<br><br>
<div style="border-left: 2px solid #ccc; padding-left: 12px; margin-left: 0; color: #555;">
    <p><strong>---------- 转发邮件 ----------</strong></p>
    <p><strong>发件人:</strong> ${fromStr}</p>
    <p><strong>日期:</strong> ${dateStr}</p>
    <p><strong>主题:</strong> ${email.Subject || '(无主题)'}</p>
    <p><strong>收件人:</strong> ${toStr}</p>
    <br>
    ${originalContent}
</div>`
        } else {
            return `<br><br>
<div style="color: #555;">
    <p>${dateStr}, ${fromStr} 写道:</p>
    <blockquote style="border-left: 2px solid #ccc; padding-left: 12px; margin-left: 0; color: #666;">
        ${originalContent}
    </blockquote>
</div>`
        }
    }, [])

    // 获取回复收件人
    const getReplyRecipients = useCallback((email: Email, mode: 'reply' | 'reply-all' | 'forward', currentEmail?: string): { to: string[], cc: string[] } => {
        const normalizeEmail = (e: string) => e.toLowerCase().trim()
        const currentEmailNorm = currentEmail ? normalizeEmail(currentEmail) : ''

        if (mode === 'forward') return { to: [], cc: [] }

        const fromList = Array.isArray(email.From) ? email.From : [email.From].filter(Boolean)
        if (mode === 'reply') return { to: fromList, cc: [] }

        // reply-all
        const toList = Array.isArray(email.To) ? email.To : [email.To].filter(Boolean)
        const ccList = Array.isArray(email.Cc) ? email.Cc : (email.Cc ? [email.Cc] : [])

        const allTo = [...fromList, ...toList]
            .filter(e => normalizeEmail(e) !== currentEmailNorm)
            .filter((e, i, arr) => arr.findIndex(x => normalizeEmail(x) === normalizeEmail(e)) === i)

        const allCc = (ccList as string[])
            .filter(e => normalizeEmail(e) !== currentEmailNorm)
            .filter(e => !allTo.some(t => normalizeEmail(t) === normalizeEmail(e)))
            .filter((e, i, arr) => arr.findIndex(x => normalizeEmail(x) === normalizeEmail(e)) === i)

        return { to: allTo, cc: allCc }
    }, [])

    // 处理从其他Tab传递的回复/转发数据
    const handleComposeData = useCallback((data: any) => {
        logger.debug('[ComposeEmailTab] 收到撰写数据:', data)

        if (data?.mode && data?.originalEmail) {
            const mode = data.mode as 'reply' | 'reply-all' | 'forward'
            const email = data.originalEmail as Email

            setComposeMode(mode)
            setOriginalEmail(email)

            // 设置发件账户
            if (data.accountId) {
                setSelectedAccountId(data.accountId)
            }

            // 获取当前账户邮箱
            const currentAccount = senderAccounts.find(a => a.id === (data.accountId || selectedAccountId))
            const currentEmail = currentAccount?.emailAddress

            // 预填充收件人
            const { to, cc } = getReplyRecipients(email, mode, currentEmail)
            setToRecipients(to)
            setCcRecipients(cc)
            setShowCcBcc(cc.length > 0)

            // 预填充主题
            setSubject(generateSubject(email, mode))

            // 切换到富文本编辑器并设置HTML内容
            setEditorMode('rich-text')
            const quotedHtml = generateQuotedHtml(email, mode)
            setVisualHtml(quotedHtml)
            setHasVisualContent(true)
        }
    }, [senderAccounts, selectedAccountId, getReplyRecipients, generateSubject, generateQuotedHtml])

    // 注册Tab回调（仅用于普通 compose-email Tab）
    useEffect(() => {
        logger.debug('[ComposeEmailTab] 注册 onReady 回调')
        registerTabCallback('compose-email', 'onReady', handleComposeData)

        const event = new CustomEvent('tabCallbackRegistered', {
            detail: { tabId: 'compose-email', callbackName: 'onReady' }
        })
        window.dispatchEvent(event)

        return () => {
            logger.debug('[ComposeEmailTab] 注销 onReady 回调')
            unregisterTabCallback('compose-email', 'onReady')
        }
    }, [handleComposeData])

    // 初始化标记，防止重复初始化导致覆盖用户输入
    const initializedRef = useRef(false)

    // 处理从 props 传入的初始数据（用于 compose-reply-tab）
    useEffect(() => {
        if (!initializedRef.current && initialMode && initialEmail) {
            logger.debug('[ComposeEmailTab] 处理初始化数据:', initialMode, initialEmail.Subject)
            handleComposeData({
                mode: initialMode,
                originalEmail: initialEmail,
                accountId: initialAccountId
            })
            initializedRef.current = true
        }
    }, [initialMode, initialEmail, initialAccountId, handleComposeData])

    useEffect(() => {
        loadAccounts()
    }, [])

    const loadAccounts = async () => {
        try {
            setLoadingAccounts(true)
            const data = await emailAccountService.getAccounts()
            setAllAccounts(data)
            const verifiedAccounts = data.filter((account) => account.isVerified)
            setSenderAccounts(verifiedAccounts)
            if (verifiedAccounts.length > 0 && !selectedAccountId) {
                setSelectedAccountId(verifiedAccounts[0].id)
            }
        } catch (error) {
            console.error('Failed to load accounts:', error)
        } finally {
            setLoadingAccounts(false)
        }
    }

    // 检查当前编辑器是否有内容
    const hasCurrentContent = (): boolean => {
        if (editorMode === 'markdown') {
            return markdownContent.trim() !== '' && markdownContent !== DEFAULT_MARKDOWN
        } else {
            return hasVisualContent
        }
    }

    // 处理编辑器模式切换
    const handleModeSwitch = (targetMode: EditorMode) => {
        if (targetMode === editorMode) return

        // 检查当前是否有内容
        if (hasCurrentContent()) {
            setPendingMode(targetMode)
            setShowSwitchConfirm(true)
        } else {
            setEditorMode(targetMode)
        }
    }

    // 确认切换
    const confirmModeSwitch = () => {
        if (pendingMode) {
            // 清空当前内容
            if (pendingMode === 'markdown') {
                setMarkdownContent(DEFAULT_MARKDOWN)
            } else {
                setVisualHtml('')
                setHasVisualContent(false)
            }
            setEditorMode(pendingMode)
            setPendingMode(null)
        }
    }

    // 简单的 Markdown 转 HTML
    const markdownToHtml = (md: string): string => {
        if (!md) return ''
        let html = md
            .replace(/^### (.*$)/gm, '<h3 style="margin: 16px 0 8px; font-size: 16px; font-weight: 600;">$1</h3>')
            .replace(/^## (.*$)/gm, '<h2 style="margin: 20px 0 10px; font-size: 18px; font-weight: 600;">$1</h2>')
            .replace(/^# (.*$)/gm, '<h1 style="margin: 24px 0 12px; font-size: 22px; font-weight: 700;">$1</h1>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-family: monospace;">$1</code>')
            .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color: #2563eb; text-decoration: underline;">$1</a>')
            .replace(/^- (.*$)/gm, '<li style="margin-left: 20px;">$1</li>')
            .replace(/^---$/gm, '<hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">')
            .replace(/\n\n/g, '</p><p style="margin: 12px 0;">')
            .replace(/\n/g, '<br>')
        return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937;"><p style="margin: 12px 0;">${html}</p></div>`
    }

    const handleSend = async () => {
        if (!selectedAccountId) {
            setSendResult({ success: false, message: '请选择发件人账户' })
            setShowResultDialog(true)
            return
        }
        if (toRecipients.length === 0) {
            setSendResult({ success: false, message: '请至少添加一个收件人' })
            setShowResultDialog(true)
            return
        }
        if (!subject.trim()) {
            setSendResult({ success: false, message: '请输入邮件主题' })
            setShowResultDialog(true)
            return
        }

        const htmlContent = editorMode === 'markdown' ? markdownToHtml(markdownContent) : visualHtml

        if (!htmlContent || (editorMode === 'markdown' && !markdownContent.trim())) {
            setSendResult({ success: false, message: '请编辑邮件内容' })
            setShowResultDialog(true)
            return
        }

        setSending(true)
        setSendResult(null)

        try {
            // 添加人为延迟以显示加载动画，提升用户体验
            await new Promise((resolve) => setTimeout(resolve, 500))

            const result = await apiClient.post<{ success: boolean; messageId?: string; error?: string }>('/emails/send', {
                accountId: selectedAccountId,
                to: toRecipients,
                cc: ccRecipients,
                bcc: bccRecipients,
                subject,
                htmlContent,
                textContent: editorMode === 'markdown' ? markdownContent : stripHtml(htmlContent),
                attachments: attachments.map(att => ({
                    filename: att.name,
                    contentType: att.file.type || 'application/octet-stream',
                    content: att.content
                }))
            })

            if (result.success) {
                setSendResult({ success: true, message: '邮件发送成功！' })
                setShowResultDialog(true)
                // 清空表单
                setToRecipients([])
                setCcRecipients([])
                setBccRecipients([])
                setSubject('')
                setMarkdownContent(DEFAULT_MARKDOWN)
                setVisualHtml('')
                setHasVisualContent(false)
                setAttachments([]) // Clear attachments
            } else {
                setSendResult({ success: false, message: result.error || '发送失败，请稍后重试' })
                setShowResultDialog(true)
            }
        } catch (error: any) {
            console.error('Failed to send email:', error)
            setSendResult({
                success: false,
                message: `发送失败: ${error instanceof Error ? error.message : '未知错误'}`
            })
            setShowResultDialog(true)
        } finally {
            setSending(false)
        }
    }

    // 附件处理
    const fileInputRef = useRef<HTMLInputElement>(null)

    // 统一处理文件逻辑
    const processFiles = useCallback(async (incomingFiles: File[]) => {
        if (incomingFiles.length === 0) return

        const newAttachments: FileAttachment[] = []
        for (const file of incomingFiles) {
            // Limit size (e.g. 10MB)
            if (file.size > 10 * 1024 * 1024) {
                toast.error(`文件 ${file.name} 太大 (超过 10MB)，暂不支持。`)
                continue
            }

            try {
                const content = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader()
                    reader.onload = () => {
                        const result = reader.result as string
                        const base64 = result.split(',')[1]
                        resolve(base64)
                    }
                    reader.onerror = reject
                    reader.readAsDataURL(file)
                })
                newAttachments.push({ file, name: file.name, content })
            } catch (error) {
                console.error('Failed to read file:', file.name, error)
            }
        }
        setAttachments(prev => [...prev, ...newAttachments])
    }, [])

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            await processFiles(Array.from(e.target.files))
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        }
    }, [processFiles])

    // Drag & Drop Handlers
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        // Simple check to ensure we're leaving the main container
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            await processFiles(Array.from(e.dataTransfer.files))
        }
    }, [processFiles])

    const handleRemoveAttachment = useCallback((index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index))
    }, [])

    return (
        <div
            className="flex h-full flex-col bg-gray-50/50 dark:bg-gray-900 relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Drag Overlay */}
            {isDragging && (
                <div className="absolute inset-4 z-50 flex items-center justify-center rounded-xl border-4 border-dashed border-blue-500 bg-blue-50/90 dark:bg-blue-900/80 backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200 pointer-events-none">
                    <div className="flex flex-col items-center gap-4 text-blue-600 dark:text-blue-200">
                        <div className="p-4 bg-white dark:bg-gray-800 rounded-full shadow-lg">
                            <Paperclip className="w-12 h-12" />
                        </div>
                        <p className="text-2xl font-bold">释放鼠标上传文件</p>
                    </div>
                </div>
            )}
            {/* 切换确认对话框 */}
            <SwitchConfirmDialog
                open={showSwitchConfirm}
                onOpenChange={setShowSwitchConfirm}
                onConfirm={confirmModeSwitch}
                targetMode={pendingMode || 'markdown'}
            />


            {/* 发送过程动画 Dialog */}
            <Dialog open={sending} onOpenChange={() => { }}>
                <DialogContent showCloseButton={false} className="sm:max-w-md border-0 bg-transparent shadow-none p-0 flex flex-col items-center justify-center overflow-hidden">
                    {/* 卡片背景 */}
                    <div className="relative flex flex-col items-center justify-center rounded-2xl bg-white p-12 shadow-2xl dark:bg-gray-800 w-full max-w-sm">

                        {/* 这是一个全屏覆盖的视觉效果，模仿 page.tsx */}
                        {/* Logo动画 */}
                        <div className="relative mb-6 inline-flex">
                            {/* Ping effect */}
                            <div className="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-20"></div>
                            <div className="relative rounded-full bg-blue-50 p-6 shadow-sm dark:bg-gray-700">
                                <Send className="h-10 w-10 text-blue-600 dark:text-blue-400 translate-x-0.5 translate-y-0.5" />
                            </div>
                        </div>

                        {/* 标题文字 */}
                        <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">
                            正在发送
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                            请稍候...
                        </p>

                        {/* 加载进度条 */}
                        <div className="mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                            <div className="h-full animate-[loading_1s_ease-in-out_infinite] bg-gradient-to-r from-blue-400 to-blue-600"></div>
                        </div>
                    </div>
                    <style jsx>{`
                        @keyframes loading {
                            0% { transform: translateX(-100%); }
                            100% { transform: translateX(200%); }
                        }
                    `}</style>
                </DialogContent>
            </Dialog>


            {/* 发送结果确认对话框 */}
            <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle className={cn(
                            "flex items-center gap-2",
                            sendResult?.success ? "text-green-600" : "text-red-600"
                        )}>
                            {sendResult?.success ? (
                                <>
                                    <CheckCircle className="h-5 w-5" />
                                    发送成功
                                </>
                            ) : (
                                <>
                                    <AlertCircle className="h-5 w-5" />
                                    发送失败
                                </>
                            )}
                        </DialogTitle>
                        <DialogDescription>
                            {sendResult?.message}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <button
                            onClick={() => setShowResultDialog(false)}
                            className={cn(
                                "px-4 py-2 rounded-lg text-sm font-medium",
                                sendResult?.success
                                    ? "bg-green-600 text-white hover:bg-green-700"
                                    : "bg-blue-600 text-white hover:bg-blue-700"
                            )}
                        >
                            确定
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 邮件信息表单 - Apple style card */}
            <div className="flex-shrink-0 mx-4 mt-4 rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                {/* 发件人 */}
                <div className="flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-700/50 rounded-t-xl">
                    <label className="w-16 flex-shrink-0 text-[13px] font-medium text-gray-400 dark:text-gray-500">
                        发件人
                    </label>
                    <SenderSelector
                        accounts={senderAccounts}
                        selectedAccountId={selectedAccountId}
                        setSelectedAccountId={setSelectedAccountId}
                        loading={loadingAccounts}
                    />
                </div>

                {/* 收件人 */}
                <div className="flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
                    <label className="w-16 flex-shrink-0 text-[13px] font-medium text-gray-400 dark:text-gray-500">
                        收件人
                    </label>
                    <div className="relative flex-1 bg-gray-50 dark:bg-gray-700/30 rounded-lg px-3 py-1 transition-all focus-within:ring-2 focus-within:ring-blue-300 dark:focus-within:ring-blue-500">
                        <RecipientTags
                            label=""
                            recipients={toRecipients}
                            setRecipients={setToRecipients}
                            placeholder="输入收件人邮箱"
                            accounts={allAccounts}
                        />
                    </div>
                </div>

                {/* 抄送/密送切换 */}
                <div className="flex items-center px-4 border-b border-gray-100 dark:border-gray-700/50">
                    <label className="w-16 flex-shrink-0"></label>
                    <button
                        type="button"
                        onClick={() => setShowCcBcc(!showCcBcc)}
                        className="flex items-center gap-1 py-2.5 text-[13px] text-blue-500 hover:text-blue-600"
                    >
                        {showCcBcc ? (
                            <>
                                <ChevronUp className="h-3.5 w-3.5" />
                                收起抄送/密送
                            </>
                        ) : (
                            <>
                                <ChevronDown className="h-3.5 w-3.5" />
                                抄送/密送
                            </>
                        )}
                    </button>
                </div>

                {/* 抄送 */}
                {showCcBcc && (
                    <>
                        <div className="flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
                            <label className="w-16 flex-shrink-0 text-[13px] font-medium text-gray-400 dark:text-gray-500">
                                抄送
                            </label>
                            <div className="relative flex-1 bg-gray-50 dark:bg-gray-700/30 rounded-lg px-3 py-1 transition-all focus-within:ring-2 focus-within:ring-blue-300 dark:focus-within:ring-blue-500">
                                <RecipientTags
                                    label=""
                                    recipients={ccRecipients}
                                    setRecipients={setCcRecipients}
                                    placeholder="输入抄送人邮箱"
                                    accounts={allAccounts}
                                />
                            </div>
                        </div>
                        <div className="flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
                            <label className="w-16 flex-shrink-0 text-[13px] font-medium text-gray-400 dark:text-gray-500">
                                密送
                            </label>
                            <div className="relative flex-1 bg-gray-50 dark:bg-gray-700/30 rounded-lg px-3 py-1 transition-all focus-within:ring-2 focus-within:ring-blue-300 dark:focus-within:ring-blue-500">
                                <RecipientTags
                                    label=""
                                    recipients={bccRecipients}
                                    setRecipients={setBccRecipients}
                                    placeholder="输入密送人邮箱"
                                    accounts={allAccounts}
                                />
                            </div>
                        </div>
                    </>
                )}

                {/* 主题 */}
                <div className="flex items-center px-4 py-3 rounded-b-xl">
                    <label className="w-16 flex-shrink-0 text-[13px] font-medium text-gray-400 dark:text-gray-500">
                        主题
                    </label>
                    <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder="输入邮件主题"
                        className="flex-1 text-[13px] bg-gray-50 dark:bg-gray-700/30 rounded-lg px-3 py-2 shadow-sm border border-gray-100 dark:border-gray-600/30 outline-none focus:border-blue-300 dark:focus:border-blue-500 transition-colors placeholder:text-gray-300 dark:placeholder:text-gray-600"
                    />
                </div>

                {/* 附件列表 */}
                {attachments.length > 0 && (
                    <div className="px-4 pb-3 animate-in fade-in slide-in-from-top-1">
                        <div className="flex flex-wrap gap-2">
                            {attachments.map((att, index) => (
                                <div key={index} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 group">
                                    <FileIcon className="w-4 h-4 text-gray-500" />

                                    <div className="flex flex-col relative group/name">
                                        <input
                                            type="text"
                                            value={att.name}
                                            onChange={(e) => {
                                                const newAttachments = [...attachments]
                                                newAttachments[index].name = e.target.value
                                                setAttachments(newAttachments)
                                            }}
                                            className="text-xs text-gray-700 dark:text-gray-300 max-w-[150px] bg-transparent border-b border-transparent focus:border-blue-500 outline-none truncate focus:max-w-[200px] transition-all"
                                            title={att.name}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.currentTarget.blur()
                                                }
                                            }}
                                        />
                                        <Pencil className="w-3 h-3 text-gray-400 absolute -right-4 top-0.5 opacity-0 group-hover/name:opacity-100 transition-opacity pointer-events-none" />
                                    </div>

                                    <span className="text-xs text-gray-400">
                                        ({(att.file.size / 1024).toFixed(1)} KB)
                                    </span>
                                    <button
                                        onClick={() => handleRemoveAttachment(index)}
                                        className="ml-1 p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* 编辑器工具栏 - 在表单和编辑器之间 */}
            <div className="flex-shrink-0 mx-4 mt-5 flex items-center justify-between">
                {/* 左侧：编辑器切换 */}
                <div className="flex items-center rounded-full bg-gray-100/80 dark:bg-gray-700/50 p-0.5">
                    <button
                        type="button"
                        onClick={() => handleModeSwitch('markdown')}
                        className={cn(
                            'rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200',
                            editorMode === 'markdown'
                                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                        )}
                    >
                        Markdown
                    </button>
                    <button
                        type="button"
                        onClick={() => handleModeSwitch('rich-text')}
                        className={cn(
                            'rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200',
                            editorMode === 'rich-text'
                                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                        )}
                    >
                        富文本
                    </button>
                    <button
                        type="button"
                        onClick={() => handleModeSwitch('visual')}
                        className={cn(
                            'rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200',
                            editorMode === 'visual'
                                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                        )}
                    >
                        高级
                    </button>
                </div>

                {/* 附件按钮 */}
                <div className="flex items-center gap-2">
                    <input
                        type="file"
                        multiple
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                        title="添加附件"
                    >
                        <Paperclip className="w-5 h-5" />
                    </button>
                </div>

                {/* 右侧：发送按钮 */}
                <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || (editorMode === 'visual' && !editorReady)}
                    className={cn(
                        'flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-semibold transition-all duration-200',
                        sending
                            ? 'bg-blue-400 text-white cursor-wait opacity-80'
                            : 'bg-blue-500 hover:bg-blue-600 text-white shadow-sm hover:shadow',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                >
                    {sending ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            发送
                        </>
                    ) : (
                        <>
                            <Send className="h-4 w-4" />
                            发送
                        </>
                    )}
                </button>
            </div>

            {/* 编辑器区域 - Apple style card */}
            <div className="flex-1 mx-4 mt-3 mb-4 rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-200/50 dark:border-gray-700/50 overflow-hidden min-h-[300px]">
                {editorMode === 'visual' ? (
                    <GrapesEmailEditor
                        initialContent={visualHtml}
                        onReady={() => setEditorReady(true)}
                        onExportHtml={(html) => {
                            setVisualHtml(html)
                            setHasVisualContent(true)
                        }}
                    />
                ) : editorMode === 'rich-text' ? (
                    <RichTextEditor
                        initialContent={visualHtml}
                        onContentChange={(html) => {
                            setVisualHtml(html)
                            setHasVisualContent(true)
                        }}
                        onAddAttachment={(file) => processFiles([file])}
                    />
                ) : (
                    <div className="h-full" data-color-mode="light">
                        <MDEditor
                            value={markdownContent}
                            onChange={(value) => setMarkdownContent(value || '')}
                            height="100%"
                            preview="live"
                            hideToolbar={false}
                            commandsFilter={(cmd) => {
                                if (cmd.name === 'image') return false
                                return cmd
                            }}
                        />
                    </div>
                )}
            </div>


        </div>
    )
}
