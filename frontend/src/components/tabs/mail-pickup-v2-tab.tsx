'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
    Mail,
    RefreshCw,
    Settings,
    Play,
    Square,
    Copy,
    Check,
    Plus,
    Loader2,
    AlertCircle,
    Clock,
    Inbox,
    Trash2,
    ChevronRight,
    ChevronDown,
    Eye,
    EyeOff,
    Code,
    FileText,
    X,
    ArrowLeft,
    GripVertical,
    Shuffle,
    AtSign,
    Globe,
    Search,
    Calendar,
    Package,
    Filter,
    Zap,
    CheckCircle,
    XCircle,
    ExternalLink,
    Radio,
    Timer,
    Sparkles,
    MailPlus,
    Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { emailAccountService } from '@/services/email-account.service'
import { extractorTemplateV2Service } from '@/services/extractor-template-v2.service'
import { EmailAccount, Email, ExtractorTemplateV2 } from '@/types'
import { formatDate } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { syncConfigService } from '@/services/sync-config.service'
import { pickupService } from '@/services/pickup.service'
import CreateSyncConfigModal from '@/components/modals/create-sync-config-modal'
import { toast } from 'sonner'
import { useTabManager } from '@/components/layout/tab-manager'

// ============ Types ============
interface ListenConfig {
    timeout: number
    interval: number
    startTime?: string
}

type ExecutionStatus = 'pending' | 'success' | 'failed' | 'no_match'
type ExtractMode = 'template' | 'regex' | 'js' | 'gotemplate' | 'none'
type MatchMode = 'all' | 'first' | 'last' | 'index'

const EXTRACT_MODE_OPTIONS: { value: ExtractMode; label: string; desc: string }[] = [
    { value: 'template', label: '模板', desc: 'V2 取件模板' },
    { value: 'regex', label: '正则', desc: '正则表达式提取' },
    { value: 'js', label: 'JS', desc: 'JavaScript 脚本' },
    { value: 'gotemplate', label: 'Go', desc: 'Go Template' },
    { value: 'none', label: '仅搜索', desc: '只搜索不提取' },
]

const EXTRACT_FIELD_OPTIONS = [
    { value: 'body', label: '正文 (body)' },
    { value: 'html_body', label: 'HTML (html_body)' },
    { value: 'subject', label: '主题 (subject)' },
    { value: 'from', label: '发件人 (from)' },
]

interface SimpleExtractState {
    field: string
    pattern: string
    matchMode: MatchMode
    matchIndex: number
}

interface EmailExecutionResult {
    emailId: number
    templateId: number
    status: ExecutionStatus
    extractedValue?: any
    error?: string
    duration?: number
}

interface MonitoredEmailV2 {
    id: string
    email: string
    config: ListenConfig
    isListening: boolean
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
    checksPerformed: number
    elapsedTime: number
    receivedEmails: Email[]
    executionResults: Map<number, EmailExecutionResult>
    showConfig?: boolean
    startTime?: Date
    selectedTemplateId?: number
    extractMode: ExtractMode
    simpleExtract: SimpleExtractState
}

// ============ Component ============
export default function MailPickupV2Tab() {
    const { openTab } = useTabManager()

    // State
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [accountDomains, setAccountDomains] = useState<string[]>([])
    const [templates, setTemplates] = useState<ExtractorTemplateV2[]>([])
    const [templatesLoading, setTemplatesLoading] = useState(false)
    const [monitoredEmails, setMonitoredEmails] = useState<MonitoredEmailV2[]>([])
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)
    const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)
    const [customPrefix, setCustomPrefix] = useState<string>('')
    const [selectedDomain, setSelectedDomain] = useState<string>('')
    const [useAlias, setUseAlias] = useState(false)
    const [useDomain, setUseDomain] = useState(true)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<'html' | 'text' | 'raw'>('html')
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [accountSearchTerm, setAccountSearchTerm] = useState('')
    const [showAccountDropdown, setShowAccountDropdown] = useState(false)
    const [templateSearchTerm, setTemplateSearchTerm] = useState('')
    const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)
    const [showSyncConfigModal, setShowSyncConfigModal] = useState(false)
    const [syncConfigAccountId, setSyncConfigAccountId] = useState<number>(0)
    const [syncConfigAccountEmail, setSyncConfigAccountEmail] = useState<string>('')
    const [showAddSection, setShowAddSection] = useState(false)
    const [dragOverId, setDragOverId] = useState<string | null>(null)
    const dragOverPositionRef = useRef<'above' | 'below'>('below')
    const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below'>('below')

    // Refs
    const accountDropdownRef = useRef<HTMLDivElement>(null)
    const templateDropdownRef = useRef<HTMLDivElement>(null)
    const listeningStateRef = useRef<{ [email: string]: any }>({})
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const dragItemRef = useRef<string | null>(null)

    // ============ Helpers ============
    const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`
        const minutes = Math.floor(seconds / 60)
        const remainingSeconds = seconds % 60
        if (minutes < 60) {
            return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
        }
        const hours = Math.floor(minutes / 60)
        const remainingMinutes = minutes % 60
        return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
    }

    const getStatusConfig = (status: ExecutionStatus) => {
        switch (status) {
            case 'success': return { icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: '提取成功' }
            case 'failed': return { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20', label: '提取失败' }
            case 'no_match': return { icon: Filter, color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: '不匹配' }
            default: return { icon: Clock, color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/20', label: '待处理' }
        }
    }

    // ============ Effects ============
    // Timer for elapsed time
    useEffect(() => {
        const interval = setInterval(() => {
            setMonitoredEmails(prev => prev.map(email => {
                if (email.isListening && email.startTime) {
                    const elapsed = Math.floor((new Date().getTime() - email.startTime.getTime()) / 1000)
                    return { ...email, elapsedTime: elapsed }
                }
                return email
            }))
        }, 1000)
        return () => clearInterval(interval)
    }, [])

    // Load data
    useEffect(() => { fetchAccountsAndData() }, [])

    // Close dropdowns on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
                setShowAccountDropdown(false)
            }
            if (templateDropdownRef.current && !templateDropdownRef.current.contains(event.target as Node)) {
                setShowTemplateDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Render HTML content
    useEffect(() => {
        if (selectedEmail?.HTMLBody && viewMode === 'html' && iframeRef.current) {
            const doc = iframeRef.current.contentDocument
            if (doc) {
                doc.open()
                doc.write(selectedEmail.HTMLBody)
                doc.close()
            }
        }
    }, [selectedEmail, viewMode])

    // ============ Data ============
    const fetchAccountsAndData = async () => {
        try {
            setLoading(true)
            const [accountsData, domainsData, templatesData] = await Promise.all([
                emailAccountService.getAccounts(),
                apiClient.get<{ domains: string[] }>('/email-domains'),
                extractorTemplateV2Service.getTemplates()
            ])
            setAccounts(accountsData)
            const domains = domainsData.domains || []
            setAccountDomains(domains)
            if (domains.length > 0 && !selectedDomain) setSelectedDomain(domains[0])
            setTemplates(templatesData || [])
        } catch (err) {
            console.error('Error fetching data:', err)
            setError('获取数据失败')
        } finally {
            setLoading(false)
        }
    }

    const filteredAccounts = accounts.filter(account =>
        account.emailAddress.toLowerCase().includes(accountSearchTerm.toLowerCase())
    )

    const filteredTemplates = templates.filter(template =>
        template.name.toLowerCase().includes(templateSearchTerm.toLowerCase()) ||
        template.description?.toLowerCase().includes(templateSearchTerm.toLowerCase())
    )

    // ============ Email Management ============
    const addMonitoredEmail = (email: string): string => {
        const existingEmail = monitoredEmails.find(m => m.email === email)
        if (existingEmail) return existingEmail.id

        const id = Date.now().toString()
        const newEmail: MonitoredEmailV2 = {
            id,
            email,
            config: { timeout: 300, interval: 5, startTime: new Date().toISOString() },
            isListening: false,
            connectionStatus: 'disconnected',
            checksPerformed: 0,
            elapsedTime: 0,
            receivedEmails: [],
            extractMode: 'template',
            simpleExtract: { field: 'body', pattern: '', matchMode: 'first', matchIndex: 0 },
            executionResults: new Map(),
            showConfig: true,
        }
        setMonitoredEmails(prev => [...prev, newEmail])
        setSelectedEmailId(id)
        return id
    }

    const addFromAccount = (accountEmail: string) => {
        addMonitoredEmail(accountEmail)
        setAccountSearchTerm('')
        setShowAccountDropdown(false)
        setShowAddSection(false)
    }

    const removeMonitoredEmail = (id: string) => {
        const email = monitoredEmails.find(m => m.id === id)
        if (email?.isListening) stopListening(id)
        setMonitoredEmails(prev => prev.filter(m => m.id !== id))
        if (selectedEmailId === id) { setSelectedEmailId(null); setSelectedEmail(null) }
    }

    const copyEmail = (email: string, id: string) => {
        navigator.clipboard.writeText(email)
        setCopiedId(id)
        toast.success('邮箱已复制')
        setTimeout(() => setCopiedId(null), 2000)
    }

    const updateConfig = (id: string, config: Partial<ListenConfig>) => {
        setMonitoredEmails(prev => prev.map(m =>
            m.id === id ? { ...m, config: { ...m.config, ...config } } : m
        ))
    }

    const toggleConfig = (id: string) => {
        setMonitoredEmails(prev => prev.map(m =>
            m.id === id ? { ...m, showConfig: !m.showConfig } : m
        ))
    }

    const selectTemplate = (emailId: string, templateId: number) => {
        setMonitoredEmails(prev => prev.map(m =>
            m.id === emailId ? { ...m, selectedTemplateId: templateId } : m
        ))
        setTemplateSearchTerm('')
        setShowTemplateDropdown(false)
    }

    const updateExtractMode = (id: string, mode: ExtractMode) => {
        setMonitoredEmails(prev => prev.map(m =>
            m.id === id ? { ...m, extractMode: mode } : m
        ))
    }

    const updateSimpleExtract = (id: string, updates: Partial<SimpleExtractState>) => {
        setMonitoredEmails(prev => prev.map(m =>
            m.id === id ? { ...m, simpleExtract: { ...m.simpleExtract, ...updates } } : m
        ))
    }

    // ============ Drag & Drop ============
    const handleDragStart = (e: React.DragEvent, id: string) => {
        dragItemRef.current = id
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', id)
        const el = e.currentTarget as HTMLElement
        requestAnimationFrame(() => { el.style.opacity = '0.4' })
    }

    const handleDragEnd = (e: React.DragEvent) => {
        const el = e.currentTarget as HTMLElement
        el.style.opacity = '1'
        dragItemRef.current = null
        setDragOverId(null)
    }

    const handleDragOver = (e: React.DragEvent, id: string) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (dragItemRef.current === id) return

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        const position = e.clientY < midY ? 'above' : 'below'

        dragOverPositionRef.current = position
        setDragOverId(id)
        setDragOverPosition(position)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        const relatedTarget = e.relatedTarget as HTMLElement
        if (!e.currentTarget.contains(relatedTarget)) {
            setDragOverId(null)
        }
    }

    const handleDrop = (e: React.DragEvent, targetId: string) => {
        e.preventDefault()
        const sourceId = dragItemRef.current
        const position = dragOverPositionRef.current
        if (!sourceId || sourceId === targetId) { setDragOverId(null); return }

        setMonitoredEmails(prev => {
            const sourceIdx = prev.findIndex(m => m.id === sourceId)
            const targetIdx = prev.findIndex(m => m.id === targetId)
            if (sourceIdx === -1 || targetIdx === -1) return prev

            const newList = [...prev]
            const [moved] = newList.splice(sourceIdx, 1)
            // After removing the source, recalculate the target position
            const newTargetIdx = newList.findIndex(m => m.id === targetId)
            const insertIdx = position === 'above' ? newTargetIdx : newTargetIdx + 1
            newList.splice(insertIdx, 0, moved)
            return newList
        })
        setDragOverId(null)
        dragItemRef.current = null
    }

    const getRandomEmail = async () => {
        try {
            const params = new URLSearchParams()
            if (useAlias) params.append('alias', 'true')
            if (useDomain) params.append('domain', 'true')
            const data = await apiClient.get<{ status: string; email: string; message?: string }>(`/random-email?${params}`)
            if (data.status === 'success') {
                addMonitoredEmail(data.email)
                setShowAddSection(false)
            } else {
                setError(data.message || '获取随机邮箱失败')
            }
        } catch (err) {
            console.error('Error getting random email:', err)
            setError('获取随机邮箱失败')
        }
    }

    const generateRandomPrefix = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
        let result = ''
        for (let i = 0; i < 8; i++) result += chars.charAt(Math.floor(Math.random() * chars.length))
        setCustomPrefix(result)
    }

    const generateCustomEmail = () => {
        if (customPrefix && selectedDomain) {
            addMonitoredEmail(`${customPrefix}@${selectedDomain}`)
            setCustomPrefix('')
            setShowAddSection(false)
        }
    }

    // ============ Listening Logic ============
    const startListening = useCallback(async (id: string) => {
        const emailToListen = monitoredEmails.find(m => m.id === id)
        if (!emailToListen) { setError('无法找到要监听的邮箱'); return }

        // Validate extraction config based on mode
        if (emailToListen.extractMode === 'template' && !emailToListen.selectedTemplateId) {
            toast.error('请先选择取件模板'); return
        }
        if (['regex', 'js', 'gotemplate'].includes(emailToListen.extractMode) && !emailToListen.simpleExtract.pattern.trim()) {
            toast.error('请输入提取表达式'); return
        }

        let accountId: number | null = null
        let baseEmail = emailToListen.email.toLowerCase()
        const plusIndex = baseEmail.indexOf('+')
        const atIndex = baseEmail.indexOf('@')
        if (plusIndex > 0 && atIndex > plusIndex) {
            baseEmail = baseEmail.substring(0, plusIndex) + baseEmail.substring(atIndex)
        }

        const account = accounts.find(acc => {
            const accountEmail = acc.emailAddress.toLowerCase()
            return accountEmail === emailToListen.email.toLowerCase() || accountEmail === baseEmail
        })

        accountId = account?.id ?? (accounts.length > 0 ? accounts[0].id : 0)

        const listeningStartTime = new Date()
        setMonitoredEmails(prev => prev.map(m =>
            m.id === id ? { ...m, isListening: true, connectionStatus: 'connected', checksPerformed: 0, elapsedTime: 0, startTime: listeningStartTime, showConfig: false } : m
        ))

        listeningStateRef.current[emailToListen.email] = {
            monitorId: id, email: emailToListen.email, startTime: listeningStartTime, config: emailToListen.config,
            isListening: true, checksPerformed: 0, accountId, templateId: emailToListen.selectedTemplateId,
            extractMode: emailToListen.extractMode, simpleExtract: emailToListen.simpleExtract,
            processedEmailIds: new Set<number>(),
        }

        setTimeout(() => { if (accountId !== null) checkEmailsAndExecute(emailToListen.email, accountId) }, 100)
        const intervalSeconds = emailToListen.config.interval || 5
        const pollInterval = setInterval(() => {
            const state = listeningStateRef.current[emailToListen.email]
            if (!state?.isListening) { clearInterval(pollInterval); return }
            if (accountId !== null) checkEmailsAndExecute(emailToListen.email, accountId)
        }, intervalSeconds * 1000)

        toast.success(`开始监听 ${emailToListen.email}`)
    }, [accounts, monitoredEmails])

    const stopListening = (idOrEmail: string) => {
        const email = monitoredEmails.find(m => m.id === idOrEmail || m.email === idOrEmail)
        if (!email) return
        if (listeningStateRef.current[email.email]) {
            listeningStateRef.current[email.email].isListening = false
            delete listeningStateRef.current[email.email]
        }
        setMonitoredEmails(prev => prev.map(m =>
            m.id === email.id ? { ...m, isListening: false, connectionStatus: 'disconnected' } : m
        ))
        toast.info(`已停止监听 ${email.email}`)
    }

    const checkEmailsAndExecute = async (email: string, accountId: number) => {
        try {
            const listeningState = listeningStateRef.current[email]
            if (!listeningState?.isListening) return
            listeningState.checksPerformed++

            setMonitoredEmails(prev => prev.map(m =>
                m.email === email ? { ...m, checksPerformed: listeningState.checksPerformed, elapsedTime: Math.round((new Date().getTime() - listeningState.startTime.getTime()) / 1000) } : m
            ))

            const intervalSeconds = listeningState.config.interval || 5
            const pollRequest: any = {
                account_id: accountId,
                keep_alive_seconds: Math.max(intervalSeconds * 6, 30),
                sync_interval: intervalSeconds,
                since: listeningState.startTime.toISOString(),
                to_query: email,
                limit: 10,
            }

            // Set extraction params based on mode
            if (listeningState.extractMode === 'template' && listeningState.templateId) {
                pollRequest.template_id = listeningState.templateId
            } else if (['regex', 'js', 'gotemplate'].includes(listeningState.extractMode)) {
                pollRequest.simple_extract = {
                    field: listeningState.simpleExtract.field,
                    type: listeningState.extractMode,
                    pattern: listeningState.simpleExtract.pattern,
                    match_mode: listeningState.simpleExtract.matchMode,
                }
                if (listeningState.simpleExtract.matchMode === 'index') {
                    pollRequest.simple_extract.match_index = listeningState.simpleExtract.matchIndex
                }
            }
            // mode === 'none': no extraction params

            const pollResult = await pickupService.poll(pollRequest)

            if (pollResult?.emails?.length > 0) {
                const processedEmailIds: Set<number> = listeningState.processedEmailIds ?? new Set<number>()
                const newEmailsFromResponse = pollResult.emails.filter((emailItem: Email) => !processedEmailIds.has(emailItem.ID))
                pollResult.emails.forEach((emailItem: Email) => processedEmailIds.add(emailItem.ID))
                listeningState.processedEmailIds = processedEmailIds

                setMonitoredEmails(prev => prev.map(m => {
                    if (m.email !== email) return m
                    const existingIds = new Set(m.receivedEmails.map(e => e.ID))
                    const newEmails = newEmailsFromResponse.filter((e: Email) => !existingIds.has(e.ID))
                    const newResults = new Map(m.executionResults)
                    if (pollResult.extractions) {
                        for (const extraction of pollResult.extractions) {
                            newResults.set(extraction.email_id, {
                                emailId: extraction.email_id,
                                templateId: listeningState.templateId || 0,
                                status: extraction.status === 'success' ? 'success' : extraction.status === 'no_match' ? 'no_match' : 'failed',
                                extractedValue: extraction.extracted_value,
                                error: extraction.error,
                            })
                        }
                    }
                    if (newEmails.length > 0) {
                        toast.success(`收到 ${newEmails.length} 封新邮件`)
                    }
                    return { ...m, receivedEmails: [...newEmails, ...m.receivedEmails], executionResults: newResults }
                }))
                if (newEmailsFromResponse.length > 0 && listeningState.monitorId) {
                    const latestEmail = newEmailsFromResponse[0]
                    setSelectedEmailId(listeningState.monitorId)
                    setSelectedEmail(latestEmail)
                    setViewMode(latestEmail.HTMLBody ? 'html' : 'text')
                }
            }

            const elapsedSeconds = Math.round((new Date().getTime() - listeningState.startTime.getTime()) / 1000)
            if (listeningState.config.timeout > 0 && elapsedSeconds >= listeningState.config.timeout) {
                stopListening(email)
                toast.warning('监听超时，已自动停止')
            }
        } catch (error: any) {
            console.error('检查邮件时出错:', error)
        }
    }

    const executeTemplateForEmail = async (monitoredEmail: string, emailItem: Email, templateId: number) => {
        try {
            const result = await extractorTemplateV2Service.executeTemplate(templateId, emailItem.ID)
            const executionResult: EmailExecutionResult = {
                emailId: emailItem.ID, templateId,
                status: result.success ? 'success' : (result.filterMatched ? 'failed' : 'no_match'),
                extractedValue: result.extractedValue, error: result.error, duration: result.duration
            }
            setMonitoredEmails(prev => prev.map(m => {
                if (m.email !== monitoredEmail) return m
                const newResults = new Map(m.executionResults)
                newResults.set(emailItem.ID, executionResult)
                return { ...m, executionResults: newResults }
            }))
            if (result.success) toast.success(`提取成功: ${JSON.stringify(result.extractedValue).substring(0, 50)}...`)
        } catch (error: any) {
            console.error('执行模板失败:', error)
            setMonitoredEmails(prev => prev.map(m => {
                if (m.email !== monitoredEmail) return m
                const newResults = new Map(m.executionResults)
                newResults.set(emailItem.ID, { emailId: emailItem.ID, templateId, status: 'failed', error: error.message })
                return { ...m, executionResults: newResults }
            }))
        }
    }

    const goToTemplate = (templateId: number) => {
        openTab({ id: `extractor-v2-view-${templateId}`, title: '查看取件模板', type: 'extractor-v2-view', data: { templateId } })
    }

    // ============ Derived State ============
    const selectedMonitoredEmail = monitoredEmails.find(m => m.id === selectedEmailId)
    const activeListeners = monitoredEmails.filter(m => m.isListening).length
    const totalReceived = monitoredEmails.reduce((sum, m) => sum + m.receivedEmails.length, 0)

    // ============ Render ============
    return (
        <div className="flex h-full bg-gray-50 dark:bg-gray-950">
            {/* ==================== LEFT PANEL ==================== */}
            <div className="w-[420px] min-w-[360px] flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                {/* Header */}
                <div className="flex-shrink-0 px-5 pt-5 pb-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
                                <Package className="h-4.5 w-4.5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
                                    取件监控
                                </h2>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    实时监听 · 自动提取
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowAddSection(!showAddSection)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
                                showAddSection
                                    ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/25 hover:shadow-lg hover:shadow-blue-600/30"
                            )}
                        >
                            {showAddSection ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                            {showAddSection ? '取消' : '添加'}
                        </button>
                    </div>

                    {/* Stats Bar */}
                    {monitoredEmails.length > 0 && (
                        <div className="flex items-center gap-3 text-xs">
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                                <Mail className="h-3 w-3" />
                                <span>{monitoredEmails.length} 个邮箱</span>
                            </div>
                            {activeListeners > 0 && (
                                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    <span>{activeListeners} 监听中</span>
                                </div>
                            )}
                            {totalReceived > 0 && (
                                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                                    <Inbox className="h-3 w-3" />
                                    <span>{totalReceived} 封</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Add Email Section */}
                {showAddSection && (
                    <div className="flex-shrink-0 mx-4 mb-4 animate-fade-in">
                        <div className="rounded-xl border border-blue-200 dark:border-blue-800/50 bg-gradient-to-b from-blue-50/80 to-white dark:from-blue-950/30 dark:to-gray-900 p-4 space-y-3">
                            {/* From existing accounts */}
                            <div>
                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                                    从已有账户选择
                                </label>
                                <div className="relative" ref={accountDropdownRef}>
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                                        <input
                                            type="text"
                                            value={accountSearchTerm}
                                            onChange={(e) => { setAccountSearchTerm(e.target.value); setShowAccountDropdown(true) }}
                                            onFocus={() => setShowAccountDropdown(true)}
                                            placeholder="搜索账户..."
                                            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-8 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                                        />
                                    </div>
                                    {showAccountDropdown && filteredAccounts.length > 0 && (
                                        <div className="absolute z-50 mt-1.5 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl shadow-black/10 max-h-48 overflow-y-auto">
                                            {filteredAccounts.map((account) => (
                                                <button
                                                    key={account.id}
                                                    onClick={() => addFromAccount(account.emailAddress)}
                                                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex items-center gap-2 group"
                                                >
                                                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center flex-shrink-0">
                                                        <Mail className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                                                    </div>
                                                    <span className="truncate text-gray-700 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-300">
                                                        {account.emailAddress}
                                                    </span>
                                                    <Plus className="h-3.5 w-3.5 text-gray-400 opacity-0 group-hover:opacity-100 ml-auto flex-shrink-0" />
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Divider */}
                            <div className="flex items-center gap-3">
                                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                                <span className="text-xs text-gray-400 dark:text-gray-500">或</span>
                                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                            </div>

                            {/* Custom domain email */}
                            {accountDomains.length > 0 && (
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                                        自定义域名邮箱
                                    </label>
                                    <div className="flex gap-1.5 items-center">
                                        <input
                                            type="text"
                                            value={customPrefix}
                                            onChange={(e) => setCustomPrefix(e.target.value)}
                                            placeholder="前缀"
                                            className="flex-1 min-w-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
                                            onKeyDown={(e) => e.key === 'Enter' && generateCustomEmail()}
                                        />
                                        <button
                                            onClick={generateRandomPrefix}
                                            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                                            title="随机前缀"
                                        >
                                            <Shuffle className="h-4 w-4" />
                                        </button>
                                        <span className="text-gray-400 text-sm font-mono">@</span>
                                        <select
                                            value={selectedDomain}
                                            onChange={(e) => setSelectedDomain(e.target.value)}
                                            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
                                        >
                                            {accountDomains.map((domain) => (
                                                <option key={domain} value={domain}>{domain}</option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={generateCustomEmail}
                                            disabled={!customPrefix || !selectedDomain}
                                            className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Random email */}
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-600 dark:text-gray-400">
                                    <input
                                        type="checkbox"
                                        checked={useAlias}
                                        onChange={(e) => setUseAlias(e.target.checked)}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                                    />
                                    <AtSign className="h-3 w-3" /> 别名
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-600 dark:text-gray-400">
                                    <input
                                        type="checkbox"
                                        checked={useDomain}
                                        onChange={(e) => setUseDomain(e.target.checked)}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                                    />
                                    <Globe className="h-3 w-3" /> 域名
                                </label>
                                <button
                                    onClick={getRandomEmail}
                                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 border border-blue-200 dark:border-blue-800 transition-all"
                                >
                                    <Sparkles className="h-3 w-3" />
                                    随机邮箱
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Loading */}
                {loading && (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                    </div>
                )}

                {/* Email List */}
                <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2 mailbox-scrollbar">
                    {!loading && monitoredEmails.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center mb-4">
                                <MailPlus className="h-7 w-7 text-blue-500/60" />
                            </div>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">暂无监控邮箱</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500">点击上方「添加」按钮开始</p>
                        </div>
                    )}

                    {monitoredEmails.map((email) => {
                        const isSelected = selectedEmailId === email.id
                        const templateName = templates.find(t => t.id === email.selectedTemplateId)?.name
                        const successCount = Array.from(email.executionResults.values()).filter(r => r.status === 'success').length

                        return (
                            <div
                                key={email.id}
                                draggable={!email.isListening}
                                onDragStart={(e) => handleDragStart(e, email.id)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, email.id)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, email.id)}
                                className={cn(
                                    "rounded-xl border-2 transition-all duration-200 overflow-hidden",
                                    isSelected
                                        ? "border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20 shadow-md shadow-blue-500/10 ring-1 ring-blue-500/20"
                                        : "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm bg-white dark:bg-gray-900",
                                    dragOverId === email.id && dragOverPosition === 'above' && "border-t-blue-500 border-t-2",
                                    dragOverId === email.id && dragOverPosition === 'below' && "border-b-blue-500 border-b-2",
                                )}
                            >
                                {/* Main Row */}
                                <div
                                    className="px-4 py-3 cursor-pointer flex items-center"
                                    onClick={() => { setSelectedEmailId(email.id); setSelectedEmail(null) }}
                                >
                                    {/* Drag handle */}
                                    {!email.isListening && (
                                        <div
                                            className="flex-shrink-0 mr-2 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 transition-colors"
                                            onMouseDown={(e) => e.stopPropagation()}
                                        >
                                            <GripVertical className="h-4 w-4" />
                                        </div>
                                    )}
                                    <div className="flex items-center gap-3">
                                        {/* Status Indicator */}
                                        <div className={cn(
                                            "relative flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all",
                                            email.isListening
                                                ? "bg-gradient-to-br from-emerald-500/15 to-teal-500/15"
                                                : email.receivedEmails.length > 0
                                                    ? "bg-gradient-to-br from-blue-500/10 to-indigo-500/10"
                                                    : "bg-gray-100 dark:bg-gray-800"
                                        )}>
                                            {email.isListening ? (
                                                <>
                                                    <Radio className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                                    </span>
                                                </>
                                            ) : (
                                                <Mail className={cn(
                                                    "h-4 w-4",
                                                    email.receivedEmails.length > 0 ? "text-blue-600 dark:text-blue-400" : "text-gray-400 dark:text-gray-500"
                                                )} />
                                            )}
                                        </div>

                                        {/* Email Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className="font-mono text-sm font-medium text-gray-900 dark:text-white truncate leading-tight">
                                                {email.email}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {email.isListening ? (
                                                    <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                        <Activity className="h-3 w-3" />
                                                        {formatDuration(email.elapsedTime)} · 第{email.checksPerformed}次
                                                    </span>
                                                ) : email.extractMode === 'template' && templateName ? (
                                                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
                                                        <Package className="h-3 w-3" />
                                                        {templateName}
                                                    </span>
                                                ) : email.extractMode === 'template' && !templateName ? (
                                                    <span className="text-xs text-amber-500 flex items-center gap-1">
                                                        <AlertCircle className="h-3 w-3" />
                                                        未选模板
                                                    </span>
                                                ) : email.extractMode === 'none' ? (
                                                    <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                                                        <Search className="h-3 w-3" />
                                                        仅搜索
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
                                                        <Code className="h-3 w-3" />
                                                        {email.extractMode === 'regex' ? '正则提取' : email.extractMode === 'js' ? 'JS 提取' : 'Go Template'}
                                                        {!email.simpleExtract.pattern.trim() && (
                                                            <span className="text-amber-500 ml-1">· 未配置</span>
                                                        )}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Right side badges */}
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            {email.receivedEmails.length > 0 && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                                    <Inbox className="h-3 w-3" />
                                                    {email.receivedEmails.length}
                                                </span>
                                            )}
                                            {successCount > 0 && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                                                    <CheckCircle className="h-3 w-3" />
                                                    {successCount}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Action Bar (visible when selected) */}
                                {isSelected && (
                                    <div className="px-3 pb-3 flex items-center gap-1.5 animate-fade-in">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); copyEmail(email.email, email.id) }}
                                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all"
                                            title="复制邮箱"
                                        >
                                            {copiedId === email.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); toggleConfig(email.id) }}
                                            className={cn(
                                                "p-1.5 rounded-lg transition-all",
                                                email.showConfig ? "text-blue-600 bg-blue-50 dark:bg-blue-900/20" : "text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                            )}
                                            title="配置"
                                        >
                                            <Settings className="h-3.5 w-3.5" />
                                        </button>

                                        <div className="flex-1" />

                                        <button
                                            onClick={(e) => { e.stopPropagation(); email.isListening ? stopListening(email.id) : startListening(email.id) }}
                                            className={cn(
                                                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                                                email.isListening
                                                    ? "bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400 border border-red-200 dark:border-red-800/50"
                                                    : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/25"
                                            )}
                                        >
                                            {email.isListening ? (
                                                <><Square className="h-3 w-3" /> 停止</>
                                            ) : (
                                                <><Play className="h-3 w-3" /> 开始监听</>
                                            )}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeMonitoredEmail(email.id) }}
                                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                            title="删除"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                )}

                                {/* Config Panel */}
                                {isSelected && email.showConfig && (
                                    <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 bg-gray-50/50 dark:bg-gray-800/30 space-y-3 animate-fade-in">
                                        {/* Extraction Mode Selector */}
                                        <div>
                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                                                <Zap className="h-3 w-3" />
                                                提取方式
                                            </label>
                                            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
                                                {EXTRACT_MODE_OPTIONS.map(({ value, label }) => (
                                                    <button
                                                        key={value}
                                                        onClick={() => updateExtractMode(email.id, value)}
                                                        className={cn(
                                                            "flex-1 px-2 py-1.5 text-xs font-medium transition-all",
                                                            email.extractMode === value
                                                                ? "bg-blue-600 text-white shadow-sm"
                                                                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700"
                                                        )}
                                                        title={EXTRACT_MODE_OPTIONS.find(o => o.value === value)?.desc}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Template Mode */}
                                        {email.extractMode === 'template' && (
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                                                    <Package className="h-3 w-3" />
                                                    V2 模板 <span className="text-red-400">*</span>
                                                </label>
                                                <div className="relative" ref={templateDropdownRef}>
                                                    <div className="relative">
                                                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                                                        <input
                                                            type="text"
                                                            value={templateSearchTerm}
                                                            onChange={(e) => { setTemplateSearchTerm(e.target.value); setShowTemplateDropdown(true) }}
                                                            onFocus={() => setShowTemplateDropdown(true)}
                                                            placeholder={templateName || "搜索模板..."}
                                                            className={cn(
                                                                "w-full rounded-lg border bg-white dark:bg-gray-800 pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all",
                                                                templateName ? "border-emerald-300 dark:border-emerald-800 focus:border-emerald-500" : "border-gray-200 dark:border-gray-700 focus:border-blue-500"
                                                            )}
                                                        />
                                                    </div>
                                                    {showTemplateDropdown && filteredTemplates.length > 0 && (
                                                        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl shadow-black/10 max-h-48 overflow-y-auto">
                                                            {filteredTemplates.map((template) => (
                                                                <button
                                                                    key={template.id}
                                                                    onClick={() => selectTemplate(email.id, template.id)}
                                                                    className={cn(
                                                                        "w-full px-3 py-2 text-left text-xs hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors",
                                                                        email.selectedTemplateId === template.id && "bg-emerald-50 dark:bg-emerald-900/20"
                                                                    )}
                                                                >
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="min-w-0">
                                                                            <div className="font-medium text-gray-800 dark:text-gray-200 truncate">{template.name}</div>
                                                                            {template.description && (
                                                                                <div className="text-gray-400 dark:text-gray-500 truncate mt-0.5">{template.description}</div>
                                                                            )}
                                                                        </div>
                                                                        {email.selectedTemplateId === template.id && (
                                                                            <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0 ml-2" />
                                                                        )}
                                                                    </div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                {email.selectedTemplateId && (
                                                    <button
                                                        onClick={() => goToTemplate(email.selectedTemplateId!)}
                                                        className="mt-1 text-xs text-blue-500 hover:text-blue-600 flex items-center gap-0.5 transition-colors"
                                                    >
                                                        查看模板 <ExternalLink className="h-3 w-3" />
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        {/* Simple Extract Mode (regex / js / gotemplate) */}
                                        {['regex', 'js', 'gotemplate'].includes(email.extractMode) && (
                                            <div className="space-y-2">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                                                        <Filter className="h-3 w-3" />
                                                        提取字段
                                                    </label>
                                                    <select
                                                        value={email.simpleExtract.field}
                                                        onChange={(e) => updateSimpleExtract(email.id, { field: e.target.value })}
                                                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                                                    >
                                                        {EXTRACT_FIELD_OPTIONS.map(({ value, label }) => (
                                                            <option key={value} value={value}>{label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                                                        <Code className="h-3 w-3" />
                                                        {email.extractMode === 'regex' ? '正则表达式' : email.extractMode === 'js' ? 'JavaScript 脚本' : 'Go Template'}
                                                        <span className="text-red-400">*</span>
                                                    </label>
                                                    <textarea
                                                        value={email.simpleExtract.pattern}
                                                        onChange={(e) => updateSimpleExtract(email.id, { pattern: e.target.value })}
                                                        placeholder={
                                                            email.extractMode === 'regex' ? '例: 验证码[：:](\\d{6})' :
                                                            email.extractMode === 'js' ? '// input 为邮件内容字符串\nconst match = input.match(/\\d{6}/);\nreturn match ? match[0] : null;' :
                                                            '{{/* Go Template */}}'
                                                        }
                                                        rows={email.extractMode === 'regex' ? 2 : 4}
                                                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all resize-none"
	                                                    />
	                                                </div>
	                                                <div className="grid grid-cols-2 gap-2">
	                                                    <div>
	                                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
	                                                            匹配结果
	                                                        </label>
	                                                        <select
	                                                            value={email.simpleExtract.matchMode}
	                                                            onChange={(e) => updateSimpleExtract(email.id, { matchMode: e.target.value as MatchMode })}
	                                                            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
	                                                        >
	                                                            <option value="all">全部</option>
	                                                            <option value="first">第一个</option>
	                                                            <option value="last">最后一个</option>
	                                                            <option value="index">指定序号</option>
	                                                        </select>
	                                                    </div>
	                                                    {email.simpleExtract.matchMode === 'index' && (
	                                                        <div>
	                                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
	                                                                序号
	                                                            </label>
	                                                            <input
	                                                                type="number"
	                                                                min={0}
	                                                                value={email.simpleExtract.matchIndex}
	                                                                onChange={(e) => updateSimpleExtract(email.id, { matchIndex: Math.max(0, parseInt(e.target.value, 10) || 0) })}
	                                                                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
	                                                            />
	                                                        </div>
	                                                    )}
	                                                </div>
	                                            </div>
	                                        )}

                                        {/* None mode hint */}
                                        {email.extractMode === 'none' && (
                                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30">
                                                <Search className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                                                <span className="text-xs text-blue-600 dark:text-blue-400">仅搜索模式：只搜索并显示邮件，不执行任何提取操作</span>
                                            </div>
                                        )}

                                        {/* Timing Config */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                                                    <Timer className="h-3 w-3" /> 超时
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type="number"
                                                        value={email.config.timeout}
                                                        onChange={(e) => updateConfig(email.id, { timeout: parseInt(e.target.value) || 300 })}
                                                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 pr-8 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                                                    />
                                                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">秒</span>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                                                    <RefreshCw className="h-3 w-3" /> 间隔
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type="number"
                                                        value={email.config.interval}
                                                        onChange={(e) => updateConfig(email.id, { interval: parseInt(e.target.value) || 5 })}
                                                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 pr-8 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                                                    />
                                                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">秒</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* Error Toast */}
                {error && (
                    <div className="flex-shrink-0 mx-4 mb-4">
                        <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-2">
                            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                            <p className="text-xs text-red-600 dark:text-red-400 flex-1">{error}</p>
                            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-500">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ==================== RIGHT PANEL ==================== */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {selectedMonitoredEmail ? (
                    selectedEmail ? (
                        /* ===== Email Detail View ===== */
                        <div className="h-full flex flex-col overflow-hidden">
                            {/* Back nav */}
                            <div className="flex-shrink-0 px-6 pt-4 pb-2">
                                <button
                                    onClick={() => setSelectedEmail(null)}
                                    className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 transition-colors group"
                                >
                                    <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
                                    返回邮件列表
                                </button>
                            </div>

                            <div className="flex-1 mx-6 mb-6 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col bg-white dark:bg-gray-900 shadow-sm">
                                {/* Email Header */}
                                <div className="flex-shrink-0 px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <h3 className="text-base font-semibold text-gray-900 dark:text-white leading-snug">
                                                {selectedEmail.Subject || '(无主题)'}
                                            </h3>
                                            <div className="mt-1.5 space-y-0.5">
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    <span className="text-gray-400 dark:text-gray-500">发件人</span>{' '}
                                                    {Array.isArray(selectedEmail.From) ? selectedEmail.From.join(', ') : selectedEmail.From}
                                                </p>
                                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                                    {formatDate(selectedEmail.Date)}
                                                </p>
                                            </div>
                                        </div>
                                        {/* View mode toggle */}
                                        <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex-shrink-0">
                                            {[
                                                { mode: 'html' as const, icon: Eye, label: 'HTML' },
                                                { mode: 'text' as const, icon: FileText, label: '文本' },
                                                { mode: 'raw' as const, icon: Code, label: '源码' },
                                            ].map(({ mode, icon: Icon, label }) => (
                                                <button
                                                    key={mode}
                                                    onClick={() => setViewMode(mode)}
                                                    className={cn(
                                                        "px-2.5 py-1.5 text-xs flex items-center gap-1 transition-all",
                                                        viewMode === mode
                                                            ? "bg-blue-600 text-white"
                                                            : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                                                    )}
                                                >
                                                    <Icon className="h-3 w-3" />
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Email Body */}
                                <div className="flex-1 bg-white dark:bg-gray-950 overflow-auto">
                                    {viewMode === 'html' && selectedEmail.HTMLBody ? (
                                        <iframe
                                            srcDoc={selectedEmail.HTMLBody}
                                            title="邮件内容"
                                            className="w-full h-full border-0 bg-white"
                                            sandbox="allow-same-origin allow-popups"
                                        />
                                    ) : viewMode === 'text' ? (
                                        <pre className="p-5 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200 font-sans">
                                            {selectedEmail.Body || '(无文本内容)'}
                                        </pre>
                                    ) : (
                                        <pre className="p-5 whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-400 font-mono">
                                            {JSON.stringify(selectedEmail, null, 2)}
                                        </pre>
                                    )}
                                </div>

                                {/* Extraction Result */}
                                {(() => {
                                    const result = selectedMonitoredEmail.executionResults.get(selectedEmail.ID)
                                    if (!result) return null
                                    const config = getStatusConfig(result.status)
                                    const StatusIcon = config.icon
                                    return (
                                        <div className={cn("flex-shrink-0 border-t border-gray-100 dark:border-gray-800 px-5 py-3", config.bg)}>
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <StatusIcon className={cn("h-4 w-4", config.color)} />
                                                <span className={cn("text-sm font-medium", config.color)}>
                                                    {config.label}
                                                </span>
                                                {result.duration && <span className="text-xs text-gray-400 ml-1">({result.duration}ms)</span>}
                                            </div>
                                            {result.extractedValue && (
                                                <div className="mt-1.5 rounded-lg bg-white/60 dark:bg-gray-900/40 border border-gray-200/50 dark:border-gray-700/50 p-3">
                                                    <pre className={cn("text-xs overflow-auto max-h-32", config.color)}>
                                                        {JSON.stringify(result.extractedValue, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                            {result.error && (
                                                <p className="text-xs text-red-500 mt-1">{result.error}</p>
                                            )}
                                        </div>
                                    )
                                })()}
                            </div>
                        </div>
                    ) : (
                        /* ===== Email List View ===== */
                        <div className="h-full flex flex-col overflow-hidden">
                            {/* List Header */}
                            <div className="flex-shrink-0 px-6 pt-5 pb-4">
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "w-10 h-10 rounded-xl flex items-center justify-center",
                                        selectedMonitoredEmail.isListening
                                            ? "bg-gradient-to-br from-emerald-500/15 to-teal-500/15"
                                            : "bg-gradient-to-br from-blue-500/10 to-indigo-500/10"
                                    )}>
                                        {selectedMonitoredEmail.isListening ? (
                                            <Radio className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                        ) : (
                                            <Inbox className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                                            {selectedMonitoredEmail.email}
                                        </h2>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {selectedMonitoredEmail.receivedEmails.length} 封邮件
                                            {selectedMonitoredEmail.isListening && ` · 已运行 ${formatDuration(selectedMonitoredEmail.elapsedTime)}`}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Email Items */}
                            <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-2 mailbox-scrollbar">
                                {selectedMonitoredEmail.receivedEmails.length > 0 ? (
                                    selectedMonitoredEmail.receivedEmails.map((emailItem) => {
                                        const result = selectedMonitoredEmail.executionResults.get(emailItem.ID)
                                        const statusConfig = result ? getStatusConfig(result.status) : null
                                        const StatusIcon = statusConfig?.icon

                                        return (
                                            <div
                                                key={emailItem.ID}
                                                onClick={() => setSelectedEmail(emailItem)}
                                                className="group px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-gray-900 hover:shadow-md hover:shadow-blue-500/5 cursor-pointer transition-all duration-200"
                                            >
                                                <div className="flex items-start gap-3">
                                                    {/* Status dot */}
                                                    <div className={cn(
                                                        "mt-1 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors",
                                                        statusConfig ? statusConfig.bg : "bg-gray-100 dark:bg-gray-800"
                                                    )}>
                                                        {StatusIcon ? (
                                                            <StatusIcon className={cn("h-4 w-4", statusConfig!.color)} />
                                                        ) : (
                                                            <Mail className="h-4 w-4 text-gray-400" />
                                                        )}
                                                    </div>

                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                            {emailItem.Subject || '(无主题)'}
                                                        </p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                                                            {Array.isArray(emailItem.From) ? emailItem.From.join(', ') : emailItem.From}
                                                        </p>
                                                        {/* Extracted value preview */}
                                                        {result?.status === 'success' && result.extractedValue && (
                                                            <div className="mt-1.5 flex items-center gap-1.5">
                                                                <Zap className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                                                                <code className="text-xs text-emerald-600 dark:text-emerald-400 font-mono truncate bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">
                                                                    {typeof result.extractedValue === 'string'
                                                                        ? result.extractedValue.substring(0, 60)
                                                                        : JSON.stringify(result.extractedValue).substring(0, 60)}
                                                                </code>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex-shrink-0 text-right">
                                                        <p className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                                            {formatDate(emailItem.Date)}
                                                        </p>
                                                        {statusConfig && (
                                                            <span className={cn(
                                                                "inline-block mt-1 text-xs font-medium",
                                                                statusConfig.color
                                                            )}>
                                                                {statusConfig.label}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600 flex-shrink-0 mt-1 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" />
                                                </div>
                                            </div>
                                        )
                                    })
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-20 text-center">
                                        <div className="relative mb-6">
                                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center">
                                                <Inbox className="h-9 w-9 text-blue-400/60" />
                                            </div>
                                            {selectedMonitoredEmail.isListening && (
                                                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                                                </div>
                                            )}
                                        </div>
                                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                                            {selectedMonitoredEmail.isListening ? '等待新邮件...' : '暂无邮件'}
                                        </p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
                                            {selectedMonitoredEmail.isListening
                                                ? `正在以 ${selectedMonitoredEmail.config.interval}s 间隔检查新邮件`
                                                : (selectedMonitoredEmail.extractMode === 'template' && !selectedMonitoredEmail.selectedTemplateId)
                                                    || (['regex', 'js', 'gotemplate'].includes(selectedMonitoredEmail.extractMode) && !selectedMonitoredEmail.simpleExtract.pattern.trim())
                                                    ? '请先在左侧配置提取方式，然后点击「开始监听」'
                                                    : '点击左侧「开始监听」按钮开始接收邮件'
                                            }
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                ) : (
                    /* ===== Empty State ===== */
                    <div className="h-full flex items-center justify-center">
                        <div className="text-center">
                            <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-blue-500/5 to-indigo-500/10 flex items-center justify-center mb-5">
                                <Mail className="h-10 w-10 text-blue-400/40" />
                            </div>
                            <p className="text-base font-medium text-gray-400 dark:text-gray-500 mb-1">
                                选择邮箱查看详情
                            </p>
                            <p className="text-xs text-gray-400/70 dark:text-gray-600">
                                从左侧列表选择一个邮箱开始
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Sync Config Modal (kept for fallback) */}
            {showSyncConfigModal && (
                <CreateSyncConfigModal
                    isOpen={showSyncConfigModal}
                    onClose={() => setShowSyncConfigModal(false)}
                    accountId={syncConfigAccountId}
                    accountEmail={syncConfigAccountEmail}
                    onSuccess={(config) => {
                        setShowSyncConfigModal(false)
                        const monitoredEmail = monitoredEmails.find(m => m.email === syncConfigAccountEmail)
                        if (monitoredEmail) startListening(monitoredEmail.id)
                    }}
                />
            )}
        </div>
    )
}
