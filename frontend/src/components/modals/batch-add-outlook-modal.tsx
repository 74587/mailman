'use client'

import { useState, useEffect } from 'react'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AlertCircle, Check, Settings2, Layout, Maximize2, Minimize2, RotateCcw, Loader2, CheckCircle, XCircle, Edit3, RotateCw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { emailAccountService, type BatchOutlookImportAccountResult, type BatchOutlookImportJob } from '@/services/email-account.service'
import { syncConfigService } from '@/services/sync-config.service'

interface BatchAddOutlookModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
    onError?: (error: string) => void
}

interface BatchAccountData {
    lineNumber: number
    email: string
    password: string
    clientId: string
    accessToken: string
    refreshToken: string
    recoveryEmail?: string
    recoveryPassword?: string
    isValid: boolean
    error?: string
}

// Account status during creation/verification
interface AccountStatus {
    lineNumber: number
    email: string
    password?: string
    clientId?: string
    refreshToken?: string
    createStatus: 'pending' | 'creating' | 'success' | 'error'
    createError?: string
    accountId?: number
    verifyStatus: 'pending' | 'verifying' | 'success' | 'error' | 'skipped'
    verifyError?: string
    syncStatus?: 'pending' | 'syncing' | 'success' | 'error' | 'skipped'
    syncError?: string
}

// Available template variables
const TEMPLATE_VARS = [
    { label: '邮箱', value: '${email}', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
    { label: '密码', value: '${password}', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
    { label: 'Client ID', value: '${client_id}', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
    { label: 'Refresh Token', value: '${refresh_token}', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
    { label: '辅助邮箱', value: '${recovery_email}', color: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300' },
]

const LARGE_BATCH_VERIFY_THRESHOLD = 200
const DEFAULT_CREATE_CONCURRENCY = 10
const DEFAULT_VERIFY_CONCURRENCY = 4
const DEFAULT_SYNC_CONCURRENCY = 2
const MAX_CREATE_CONCURRENCY = 30
const MAX_VERIFY_CONCURRENCY = 12
const MAX_SYNC_CONCURRENCY = 6

const clampConcurrency = (value: number, max: number) => {
    if (!Number.isFinite(value)) return 1
    return Math.min(Math.max(Math.floor(value), 1), max)
}

const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    return '未知错误'
}

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>
) {
    if (items.length === 0) return

    let cursor = 0
    const workerCount = Math.min(clampConcurrency(limit, items.length), items.length)
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (true) {
            const currentIndex = cursor
            cursor += 1
            if (currentIndex >= items.length) return
            await worker(items[currentIndex], currentIndex)
        }
    }))
}

export default function BatchAddOutlookModal({
    isOpen,
    onClose,
    onSuccess,
    onError
}: BatchAddOutlookModalProps) {
    // Stage: input -> preview -> creating -> verifying -> verified -> syncSettings -> syncing -> autoSyncConfig -> complete
    const [stage, setStage] = useState<'input' | 'preview' | 'creating' | 'verifying' | 'verified' | 'syncSettings' | 'syncing' | 'autoSyncConfig' | 'background' | 'complete'>('input')
    const [template, setTemplate] = useState('${email}----${password}----${client_id}----${refresh_token}')
    const DEFAULT_TEMPLATE = '${email}----${password}----${client_id}----${refresh_token}'
    const [separator, setSeparator] = useState('----')
    const [isSeparatorSync, setIsSeparatorSync] = useState(true)
    const [inputText, setInputText] = useState('')
    const [parsedAccounts, setParsedAccounts] = useState<BatchAccountData[]>([])
    const [showTemplateSettings, setShowTemplateSettings] = useState(true)
    const [hideInvalid, setHideInvalid] = useState(false)
    const [verifyAfterCreate, setVerifyAfterCreate] = useState(true)
    const [createConcurrency, setCreateConcurrency] = useState(DEFAULT_CREATE_CONCURRENCY)
    const [verifyConcurrency, setVerifyConcurrency] = useState(DEFAULT_VERIFY_CONCURRENCY)
    const [syncConcurrency, setSyncConcurrency] = useState(DEFAULT_SYNC_CONCURRENCY)

    // Status tracking for creation/verification
    const [accountStatuses, setAccountStatuses] = useState<AccountStatus[]>([])
    const [isProcessing, setIsProcessing] = useState(false)
    const [backgroundJob, setBackgroundJob] = useState<BatchOutlookImportJob | null>(null)
    const [backgroundSuccessNotified, setBackgroundSuccessNotified] = useState(false)

    // Outlook provider ID cache
    const [outlookProviderId, setOutlookProviderId] = useState<number | null>(null)

    // Sync configuration (for initial sync in syncSettings stage)
    const [defaultSyncConfig, setDefaultSyncConfig] = useState({
        enableAutoSync: true,
        syncInterval: 300,
        syncMode: 'incremental' as 'incremental' | 'full',
        maxEmails: 1000
    })

    // Global sync config (loaded from backend, editable in memory for autoSyncConfig stage)
    const [globalSyncConfig, setGlobalSyncConfig] = useState({
        enableAutoSync: true,
        syncInterval: 300,
        syncFolders: [] as string[]
    })

    // Per-account sync configs (for autoSyncConfig stage)
    const [perAccountConfigs, setPerAccountConfigs] = useState<{
        [accountId: number]: {
            enableAutoSync: boolean
            syncInterval: number
            syncFolders: string[]
        }
    }>({})

    // Edit account state
    const [editingIdx, setEditingIdx] = useState<number | null>(null)
    const [editingData, setEditingData] = useState<{
        email: string
        password: string
        clientId: string
        refreshToken: string
    } | null>(null)

    // Reset state when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setStage('input')
            setAccountStatuses([])
            setVerifyAfterCreate(true)
            setBackgroundJob(null)
            setBackgroundSuccessNotified(false)
        }
    }, [isOpen])

    const handleClose = () => {
        if (isProcessing) return // Don't close while processing
        onClose()
        setTimeout(() => {
            setStage('input')
            setInputText('')
            setParsedAccounts([])
            setAccountStatuses([])
            setVerifyAfterCreate(true)
            setBackgroundJob(null)
            setBackgroundSuccessNotified(false)
        }, 300)
    }

    // Handle batch account creation and verification
    const handleConfirmAdd = async () => {
        const validAccounts = parsedAccounts.filter(a => a.isValid)
        if (validAccounts.length === 0) return

        setIsProcessing(true)
        setStage('creating')

        // Initialize statuses
        const initialStatuses: AccountStatus[] = validAccounts.map(acc => ({
            lineNumber: acc.lineNumber,
            email: acc.email,
            password: acc.password,
            clientId: acc.clientId,
            refreshToken: acc.refreshToken,
            createStatus: 'pending',
            verifyStatus: 'pending'
        }))
        setAccountStatuses(initialStatuses)
        const statusDrafts: AccountStatus[] = initialStatuses.map(status => ({ ...status }))
        const patchStatus = (idx: number, patch: Partial<AccountStatus>) => {
            statusDrafts[idx] = { ...statusDrafts[idx], ...patch }
            setAccountStatuses(prev => prev.map((status, statusIdx) =>
                statusIdx === idx ? { ...status, ...patch } : status
            ))
        }

        // Get Outlook provider
        let providerId = outlookProviderId
        if (!providerId) {
            try {
                const providers = await emailAccountService.getProviders()
                const outlookProvider = providers.find(p => p.type?.toLowerCase() === 'outlook')
                if (outlookProvider) {
                    providerId = outlookProvider.id
                    setOutlookProviderId(providerId)
                } else {
                    onError?.('未找到 Outlook 邮件提供商配置')
                    setIsProcessing(false)
                    setStage('preview')
                    return
                }
            } catch (err: any) {
                onError?.(`获取邮件提供商失败: ${err.message}`)
                setIsProcessing(false)
                setStage('preview')
                return
            }
        }

        await runWithConcurrency(validAccounts, createConcurrency, async (acc, idx) => {
            patchStatus(idx, { createStatus: 'creating' })
            try {
                const payload = {
                    email_address: acc.email,
                    mail_provider_id: providerId!,
                    auth_type: 'oauth2' as const,
                    password: acc.password || undefined,
                    custom_settings: {
                        client_id: acc.clientId,
                        refresh_token: acc.refreshToken,
                        access_token: acc.accessToken || undefined
                    }
                }

                const created = await emailAccountService.upsertAccount(payload)

                patchStatus(idx, { createStatus: 'success', accountId: created.id })
            } catch (err: unknown) {
                patchStatus(idx, {
                    createStatus: 'error',
                    createError: getErrorMessage(err),
                    verifyStatus: 'skipped'
                })
            }
        })

        if (!verifyAfterCreate) {
            statusDrafts.forEach((status, idx) => {
                if (status.createStatus === 'success') {
                    statusDrafts[idx] = { ...status, verifyStatus: 'skipped' }
                }
            })
            setAccountStatuses(statusDrafts.map(status => ({ ...status })))
            setStage('verified')
            setIsProcessing(false)
            return
        }

        setStage('verifying')

        const accountsToVerify = statusDrafts
            .map((status, idx) => ({ status, idx }))
            .filter(({ status }) => status.createStatus === 'success' && status.accountId)

        await runWithConcurrency(accountsToVerify, verifyConcurrency, async ({ status, idx }) => {
            patchStatus(idx, { verifyStatus: 'verifying', verifyError: undefined })
            try {
                const result = await emailAccountService.verifyAccount({ account_id: status.accountId })
                patchStatus(idx, {
                    verifyStatus: result.success ? 'success' : 'error',
                    verifyError: result.error
                })
            } catch (err: unknown) {
                patchStatus(idx, { verifyStatus: 'error', verifyError: getErrorMessage(err) })
            }
        })

        setStage('verified')
        setIsProcessing(false)
    }

    const refreshBackgroundJob = async (jobId?: string) => {
        const targetJobId = jobId || backgroundJob?.job_id
        if (!targetJobId) return
        const nextJob = await emailAccountService.getBatchOutlookImportJob(targetJobId)
        setBackgroundJob(nextJob)
    }

    const handleStartBackgroundImport = async () => {
        const validAccounts = parsedAccounts.filter(a => a.isValid)
        if (validAccounts.length === 0) return

        setIsProcessing(true)
        setBackgroundSuccessNotified(false)
        try {
            const job = await emailAccountService.startBatchOutlookImport({
                accounts: validAccounts.map(account => ({
                    line_number: account.lineNumber,
                    email: account.email,
                    password: account.password || undefined,
                    client_id: account.clientId,
                    access_token: account.accessToken || undefined,
                    refresh_token: account.refreshToken,
                    recovery_email: account.recoveryEmail || undefined,
                    recovery_password: account.recoveryPassword || undefined
                })),
                options: {
                    verify: true,
                    run_initial_sync: true,
                    create_sync_config: true,
                    update_existing: true,
                    create_concurrency: createConcurrency,
                    verify_concurrency: verifyConcurrency,
                    sync_concurrency: syncConcurrency,
                    config_concurrency: createConcurrency,
                    initial_sync: {
                        sync_mode: defaultSyncConfig.syncMode,
                        mailboxes: ['INBOX'],
                        max_emails_per_mailbox: defaultSyncConfig.maxEmails,
                        include_body: true
                    },
                    sync_config: {
                        enable_auto_sync: defaultSyncConfig.enableAutoSync,
                        sync_interval: defaultSyncConfig.syncInterval,
                        sync_folders: ['INBOX']
                    }
                }
            })
            setBackgroundJob(job)
            setStage('background')
        } catch (err: unknown) {
            onError?.(`启动后台导入失败: ${getErrorMessage(err)}`)
        } finally {
            setIsProcessing(false)
        }
    }

    useEffect(() => {
        if (!isOpen || stage !== 'background' || !backgroundJob?.job_id) return
        if (backgroundJob.status === 'complete' || backgroundJob.status === 'failed') return

        const timer = window.setInterval(() => {
            refreshBackgroundJob(backgroundJob.job_id).catch((err: unknown) => {
                onError?.(`刷新后台导入进度失败: ${getErrorMessage(err)}`)
            })
        }, 2000)

        return () => window.clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, stage, backgroundJob?.job_id, backgroundJob?.status])

    useEffect(() => {
        if (stage !== 'background' || backgroundJob?.status !== 'complete' || backgroundSuccessNotified) return
        setBackgroundSuccessNotified(true)
        onSuccess?.()
    }, [backgroundJob?.status, backgroundSuccessNotified, onSuccess, stage])

    // Retry verification for a single account
    const handleRetryVerify = async (idx: number) => {
        const status = accountStatuses[idx]
        if (!status.accountId) return

        setAccountStatuses(prev => prev.map((s, i) =>
            i === idx ? { ...s, verifyStatus: 'verifying', verifyError: undefined } : s
        ))

        try {
            const result = await emailAccountService.verifyAccount({ account_id: status.accountId })
            setAccountStatuses(prev => prev.map((s, i) =>
                i === idx ? { ...s, verifyStatus: result.success ? 'success' : 'error', verifyError: result.error } : s
            ))
        } catch (err: any) {
            setAccountStatuses(prev => prev.map((s, i) =>
                i === idx ? { ...s, verifyStatus: 'error', verifyError: err.message } : s
            ))
        }
    }

    // Remove account from table
    const handleRemoveAccount = (idx: number) => {
        setAccountStatuses(prev => prev.filter((_, i) => i !== idx))
    }

    // Start editing an account
    const handleEditAccount = (idx: number) => {
        const account = accountStatuses[idx]
        setEditingIdx(idx)
        setEditingData({
            email: account.email,
            password: account.password || '',
            clientId: account.clientId || '',
            refreshToken: account.refreshToken || ''
        })
    }

    // Save edited account
    const handleSaveEdit = async () => {
        if (editingIdx === null || !editingData) return

        const account = accountStatuses[editingIdx]
        if (!account.accountId) {
            // Just update local state if account not created yet
            setAccountStatuses(prev => prev.map((s, i) =>
                i === editingIdx ? {
                    ...s,
                    email: editingData.email,
                    password: editingData.password,
                    clientId: editingData.clientId,
                    refreshToken: editingData.refreshToken
                } : s
            ))
        } else {
            // Update in backend
            try {
                await emailAccountService.updateAccount(account.accountId, {
                    id: account.accountId,
                    email_address: editingData.email,
                    password: editingData.password,
                    custom_settings: {
                        client_id: editingData.clientId,
                        refresh_token: editingData.refreshToken
                    }
                })
                setAccountStatuses(prev => prev.map((s, i) =>
                    i === editingIdx ? {
                        ...s,
                        email: editingData.email,
                        password: editingData.password,
                        clientId: editingData.clientId,
                        refreshToken: editingData.refreshToken
                    } : s
                ))
            } catch (err: any) {
                console.error('Failed to update account:', err)
            }
        }

        setEditingIdx(null)
        setEditingData(null)
    }

    // Cancel editing
    const handleCancelEdit = () => {
        setEditingIdx(null)
        setEditingData(null)
    }

    // Go to sync settings configuration
    const handleGoToSyncSettings = () => {
        setStage('syncSettings')
    }

    // Start sync process
    const handleStartSync = async () => {
        setIsProcessing(true)
        setStage('syncing')

        const syncDrafts: AccountStatus[] = accountStatuses.map(status => ({ ...status }))
        const patchStatus = (idx: number, patch: Partial<AccountStatus>) => {
            syncDrafts[idx] = { ...syncDrafts[idx], ...patch }
            setAccountStatuses(prev => prev.map((status, statusIdx) =>
                statusIdx === idx ? { ...status, ...patch } : status
            ))
        }

        const accountsToSync = syncDrafts
            .map((status, idx) => ({ status, idx }))
            .filter(({ status }) => status.verifyStatus === 'success' && status.accountId)

        await runWithConcurrency(accountsToSync, syncConcurrency, async ({ status, idx }) => {
            patchStatus(idx, { syncStatus: 'syncing', syncError: undefined })
            try {
                await emailAccountService.syncAccount(status.accountId!, {
                    sync_mode: defaultSyncConfig.syncMode,
                    max_emails_per_mailbox: defaultSyncConfig.maxEmails
                })
                patchStatus(idx, { syncStatus: 'success' })
            } catch (err: unknown) {
                patchStatus(idx, { syncStatus: 'error', syncError: getErrorMessage(err) })
            }
        })
        // Load global sync config and initialize per-account configs
        try {
            const globalConfig = await syncConfigService.getGlobalSyncConfig()
            setGlobalSyncConfig({
                enableAutoSync: globalConfig.default_enable_sync,
                syncInterval: globalConfig.default_sync_interval,
                syncFolders: globalConfig.default_sync_folders || []
            })

            // Initialize per-account configs based on global config
            const syncedAccounts = syncDrafts.filter(s => s.syncStatus === 'success' && s.accountId)
            const initialConfigs: typeof perAccountConfigs = {}
            syncedAccounts.forEach(status => {
                if (status.accountId) {
                    initialConfigs[status.accountId] = {
                        enableAutoSync: globalConfig.default_enable_sync,
                        syncInterval: globalConfig.default_sync_interval,
                        syncFolders: globalConfig.default_sync_folders || []
                    }
                }
            })
            setPerAccountConfigs(initialConfigs)
        } catch (err) {
            console.error('Failed to load global sync config:', err)
            // Fallback to default values
            const syncedAccounts = syncDrafts.filter(s => s.syncStatus === 'success' && s.accountId)
            const initialConfigs: typeof perAccountConfigs = {}
            syncedAccounts.forEach(status => {
                if (status.accountId) {
                    initialConfigs[status.accountId] = {
                        enableAutoSync: true,
                        syncInterval: 300,
                        syncFolders: []
                    }
                }
            })
            setPerAccountConfigs(initialConfigs)
        }

        setStage('autoSyncConfig')
        setIsProcessing(false)
    }

    // Save per-account sync configs
    const handleSaveAutoSyncConfigs = async () => {
        setIsProcessing(true)

        const accountsToConfig = accountStatuses.filter(s => s.syncStatus === 'success' && s.accountId)

        await runWithConcurrency(accountsToConfig, createConcurrency, async (status) => {
            const accountId = status.accountId
            if (!accountId) return
            const config = perAccountConfigs[accountId]
            if (!config) return

            try {
                // Try to create new config first (since accounts are new)
                await syncConfigService.createAccountSyncConfig(accountId, {
                    enable_auto_sync: config.enableAutoSync,
                    sync_interval: config.syncInterval,
                    sync_folders: config.syncFolders
                })
            } catch (err: any) {
                // If create fails, try update (in case config already exists)
                try {
                    await syncConfigService.updateAccountSyncConfig(accountId, {
                        enable_auto_sync: config.enableAutoSync,
                        sync_interval: config.syncInterval,
                        sync_folders: config.syncFolders
                    })
                } catch (updateErr) {
                    console.error(`Failed to save sync config for account ${accountId}:`, updateErr)
                }
            }
        })

        setIsProcessing(false)
        setStage('complete')
    }

    // Apply global config to all accounts
    const handleApplyGlobalToAll = () => {
        const newConfigs: typeof perAccountConfigs = {}
        Object.keys(perAccountConfigs).forEach(accountId => {
            newConfigs[Number(accountId)] = {
                enableAutoSync: globalSyncConfig.enableAutoSync,
                syncInterval: globalSyncConfig.syncInterval,
                syncFolders: globalSyncConfig.syncFolders
            }
        })
        setPerAccountConfigs(newConfigs)
    }

    // Final complete - close modal
    const handleFinalComplete = () => {
        onSuccess?.()
        handleClose()
    }

    const insertVariable = (variable: string) => {
        setTemplate(prev => {
            if (!prev) return variable
            // If prev already ends with separator, just append variable
            if (prev.endsWith(separator)) return prev + variable
            // Otherwise add separator and variable
            return prev + separator + variable
        })
    }

    const parseAccounts = () => {
        if (!inputText.trim()) {
            // Empty input
            return
        }

        // Generate Regex from template
        // Sanitize template: remove newlines which break single-line matching
        const sanitizedTemplate = template.replace(/[\r\n]+/g, '').trim()

        // Escape special regex characters in the template except for our variables
        let regexPattern = sanitizedTemplate
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape regex chars
            .replace(/\\\$\\\{email\\\}/g, '(?<email>.*?)')
            .replace(/\\\$\\\{password\\\}/g, '(?<password>.*?)')
            .replace(/\\\$\\\{client_id\\\}/g, '(?<client_id>.*?)')
            .replace(/\\\$\\\{refresh_token\\\}/g, '(?<refresh_token>.*?)')
            .replace(/\\\$\\\{recovery_email\\\}/g, '(?<recovery_email>.*?)')

        // Handle the separator specifically if it was escaped
        const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

        // If the regex pattern ends with the separator, make it optional to be lenient
        if (regexPattern.endsWith(escapedSeparator)) {
            regexPattern = regexPattern.substring(0, regexPattern.length - escapedSeparator.length) + '(?:' + escapedSeparator + ')?'
        }

        // If the template relies on the separator, ensure we don't match the separator inside the capture groups effectively
        // This is a simple non-greedy match. For more robustness, we might want `((?:(?!SEPARATOR).)*)` logic if needed.
        // For now, let's use the simple non-greedy approach which works for structured data usually.

        // To make it more robust against the separator:
        // Replace (.*?) with something that doesn't consume the next expected literal if possible.
        // However, standard non-greedy is usually fine if the structure is consistent.

        const lines = inputText.trim().split('\n').filter(line => line.trim())
        const results: BatchAccountData[] = []

        try {
            const regex = new RegExp(`^${regexPattern}$`)

            lines.forEach((line, index) => {
                const match = line.trim().match(regex)

                if (match && match.groups) {
                    const { email, password, client_id, refresh_token, recovery_email } = match.groups

                    // Basic validation
                    const isValid = !!(email && client_id && refresh_token)

                    results.push({
                        lineNumber: index + 1,
                        email: email?.trim() || '',
                        password: password?.trim() || '',
                        clientId: client_id?.trim() || '',
                        accessToken: '', // Usually not provided in this format, assume generated/fetched later
                        refreshToken: refresh_token?.trim() || '',
                        recoveryEmail: recovery_email?.trim() || '',
                        isValid,
                        error: isValid ? undefined : '缺少必要字段 (Email, Client ID, Refresh Token)'
                    })
                } else {
                    // Fallback: Try simple split if regex fails (legacy support behavior)
                    // Or mark as error
                    results.push({
                        lineNumber: index + 1,
                        email: '',
                        password: '',
                        clientId: '',
                        accessToken: '',
                        refreshToken: '',
                        isValid: false,
                        error: '无法匹配模板格式'
                    })
                }
            })

            setParsedAccounts(results)
            if (results.filter(account => account.isValid).length > LARGE_BATCH_VERIFY_THRESHOLD) {
                setVerifyAfterCreate(false)
            }
            setStage('preview')
        } catch (e) {
            console.error('Regex generation failed', e)
            onError?.('模板解析错误，请检查特殊字符')
        }
    }

    const validCount = parsedAccounts.filter(a => a.isValid).length
    const invalidCount = parsedAccounts.length - validCount
    const verificationSuccessCount = accountStatuses.filter(s => s.verifyStatus === 'success').length
    const verificationSkippedCount = accountStatuses.filter(s => s.verifyStatus === 'skipped').length
    const backgroundFinished = backgroundJob?.status === 'complete' || backgroundJob?.status === 'failed'
    const backgroundProgress = backgroundJob?.summary.total
        ? Math.round((backgroundJob.summary.completed_results / backgroundJob.summary.total) * 100)
        : 0

    const getBackgroundStageLabel = (job?: BatchOutlookImportJob | null) => {
        if (!job) return '等待启动'
        if (job.status === 'queued') return '已排队'
        if (job.status === 'complete') return '已完成'
        if (job.status === 'failed') return '失败'
        if (job.stage === 'creating') return '正在导入'
        if (job.stage === 'verifying') return '正在验证'
        if (job.stage === 'syncing') return '正在首次同步'
        if (job.stage === 'configuring') return '正在配置同步'
        return '运行中'
    }

    const renderBackgroundStep = (
        status: BatchOutlookImportAccountResult['create_status'],
        error?: string,
        successText?: string
    ) => {
        if (status === 'pending') return <span className="text-gray-400">-</span>
        if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 mx-auto" />
        if (status === 'success') {
            return (
                <span className="inline-flex items-center justify-center gap-1 text-green-600">
                    <CheckCircle className="h-3.5 w-3.5" />
                    {successText && <span>{successText}</span>}
                </span>
            )
        }
        if (status === 'skipped') return <span className="text-gray-400">跳过</span>
        return (
            <Tooltip>
                <TooltipTrigger>
                    <XCircle className="h-3.5 w-3.5 text-red-600 mx-auto cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs break-words">
                    {error || '失败'}
                </TooltipContent>
            </Tooltip>
        )
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            {/* Dynamic width based on stage */}
            <ModalContent
                className={cn(
                    "transition-all duration-500 ease-in-out flex flex-col max-h-[90vh]",
                    stage === 'preview' ? "max-w-5xl" :
                        (stage === 'verified' || stage === 'syncSettings' || stage === 'syncing' || stage === 'autoSyncConfig' || stage === 'background' || stage === 'complete') ? "max-w-3xl" : "max-w-xl"
                )}
            >
                <ModalHeader>
                    <ModalTitle>批量添加 Outlook 账户信息</ModalTitle>
                </ModalHeader>

                <ModalBody className="flex-1 overflow-hidden p-0 relative">
                    <div className="flex h-full flex-col">

                        {/* Settings & Input Section - Hidden during processing stages */}
                        {(stage === 'input' || stage === 'preview') && (
                            <div className={cn(
                                "flex flex-1 transition-all duration-500",
                                stage === 'preview' ? "flex-row gap-6 p-6 h-[500px]" : "flex-col p-6 h-auto"
                            )}>

                                {/* Left Column: Input & Settings */}
                                <div className={cn(
                                    "flex flex-col gap-4 transition-all duration-500 h-full overflow-hidden",
                                    stage === 'preview' ? "w-1/2" : "w-full"
                                )}>
                                    {/* Template Settings */}
                                    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
                                        <div className="flex items-center justify-between">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                                <Settings2 className="h-4 w-4" />
                                                账号解析方式
                                            </label>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0"
                                                onClick={() => setShowTemplateSettings(!showTemplateSettings)}
                                            >
                                                {showTemplateSettings ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                                            </Button>
                                        </div>

                                        {showTemplateSettings && (
                                            <div className="space-y-3 overflow-hidden mt-2">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <label className="text-xs text-gray-500 dark:text-gray-400">分隔符</label>
                                                            <div className="flex items-center gap-1.5">
                                                                <label className="text-[10px] text-gray-500 cursor-pointer select-none" htmlFor="sync-separator">
                                                                    {isSeparatorSync ? '同步修改模板' : '仅修改分隔符'}
                                                                </label>
                                                                <Switch
                                                                    id="sync-separator"
                                                                    checked={isSeparatorSync}
                                                                    onCheckedChange={setIsSeparatorSync}
                                                                    className="scale-75"
                                                                />
                                                            </div>
                                                        </div>
                                                        <input
                                                            type="text"
                                                            value={separator}
                                                            onChange={(e) => {
                                                                const newVal = e.target.value
                                                                // Only sync if we have a valid previous value and new value isn't empty
                                                                // This prevents breaking the template when clearing the input
                                                                if (isSeparatorSync && separator && newVal) {
                                                                    // Simple replaceAll-like behavior for the specific separator string
                                                                    // We use split/join which replaces ALL occurrences
                                                                    setTemplate(prev => prev.split(separator).join(newVal))
                                                                }
                                                                setSeparator(newVal)
                                                            }}
                                                            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700"
                                                            placeholder="例如: ----"
                                                        />
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="text-xs text-gray-500 dark:text-gray-400">解析模板</label>
                                                    <div className="mt-1 flex flex-wrap gap-2 mb-2">
                                                        {TEMPLATE_VARS.map(v => (
                                                            <button
                                                                key={v.value}
                                                                onClick={() => insertVariable(v.value)}
                                                                className={cn(
                                                                    "px-2 py-0.5 text-xs rounded-full border border-transparent hover:border-current transition-colors",
                                                                    v.color
                                                                )}
                                                                title={`插入 ${v.label}`}
                                                            >
                                                                {v.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <textarea
                                                        value={template}
                                                        onChange={(e) => setTemplate(e.target.value)}
                                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-primary-500 focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 min-h-[80px] resize-y"
                                                    />
                                                    <p className="mt-1 text-xs text-gray-500 flex justify-between items-center">
                                                        <span>点击上方标签插入变量，可直接编辑模板以调整位置或添加固定字符。</span>
                                                        <button
                                                            onClick={() => setTemplate(DEFAULT_TEMPLATE)}
                                                            className="text-primary-600 hover:text-primary-700 flex items-center gap-1"
                                                            title="重置为默认模板"
                                                        >
                                                            <RotateCcw className="h-3 w-3" />
                                                            恢复默认
                                                        </button>
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {stage === 'preview' && (
                                        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                                            <div className="flex items-center justify-between">
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                                    <Settings2 className="h-4 w-4" />
                                                    后台完整流程参数
                                                </label>
                                                <span className="text-xs text-gray-500 dark:text-gray-400">验证 / 首次同步 / 自动同步</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3 text-xs">
                                                <label className="space-y-1">
                                                    <span className="text-gray-500 dark:text-gray-400">同步模式</span>
                                                    <select
                                                        value={defaultSyncConfig.syncMode}
                                                        onChange={(e) => setDefaultSyncConfig(prev => ({ ...prev, syncMode: e.target.value as 'incremental' | 'full' }))}
                                                        className="h-8 w-full rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-700"
                                                    >
                                                        <option value="incremental">增量</option>
                                                        <option value="full">全量</option>
                                                    </select>
                                                </label>
                                                <label className="space-y-1">
                                                    <span className="text-gray-500 dark:text-gray-400">每箱上限</span>
                                                    <input
                                                        type="number"
                                                        min={100}
                                                        max={10000}
                                                        step={100}
                                                        value={defaultSyncConfig.maxEmails}
                                                        onChange={(e) => setDefaultSyncConfig(prev => ({ ...prev, maxEmails: parseInt(e.target.value) || 1000 }))}
                                                        className="h-8 w-full rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-700"
                                                    />
                                                </label>
                                                <label className="space-y-1">
                                                    <span className="text-gray-500 dark:text-gray-400">同步并发</span>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        max={MAX_SYNC_CONCURRENCY}
                                                        value={syncConcurrency}
                                                        onChange={(e) => setSyncConcurrency(clampConcurrency(Number(e.target.value), MAX_SYNC_CONCURRENCY))}
                                                        className="h-8 w-full rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-700"
                                                    />
                                                </label>
                                                <label className="space-y-1">
                                                    <span className="text-gray-500 dark:text-gray-400">同步间隔</span>
                                                    <select
                                                        value={defaultSyncConfig.syncInterval}
                                                        disabled={!defaultSyncConfig.enableAutoSync}
                                                        onChange={(e) => setDefaultSyncConfig(prev => ({ ...prev, syncInterval: parseInt(e.target.value) }))}
                                                        className="h-8 w-full rounded border border-gray-300 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700"
                                                    >
                                                        <option value={60}>1分钟</option>
                                                        <option value={300}>5分钟</option>
                                                        <option value={600}>10分钟</option>
                                                        <option value={900}>15分钟</option>
                                                        <option value={1800}>30分钟</option>
                                                        <option value={3600}>1小时</option>
                                                    </select>
                                                </label>
                                            </div>
                                            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                                <Switch
                                                    checked={defaultSyncConfig.enableAutoSync}
                                                    onCheckedChange={(checked) => setDefaultSyncConfig(prev => ({ ...prev, enableAutoSync: checked }))}
                                                    className="scale-75"
                                                />
                                                <span>创建账户同步配置</span>
                                            </label>
                                        </div>
                                    )}

                                    <div className="flex-1 flex flex-col min-h-0">
                                        <label className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                            批量数据 {inputText && <span className="text-xs font-normal text-gray-500">({inputText.split('\n').filter(l => l.trim()).length} 行)</span>}
                                        </label>
                                        <textarea
                                            value={inputText}
                                            onChange={(e) => setInputText(e.target.value)}
                                            className="w-full flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 resize-none min-h-[100px]"
                                            placeholder={`粘贴您的账户数据，例如：\nexample@outlook.com----password123----client-id-here----refresh-token-here`}
                                        />
                                    </div>

                                    {/* Parse button only in input stage */}
                                    {stage === 'input' && (
                                        <Button onClick={parseAccounts} className="w-full shrink-0">
                                            <Layout className="mr-2 h-4 w-4" />
                                            解析并预览
                                        </Button>
                                    )}
                                </div>

                                {/* Right Column: Preview (Only in preview stage) */}
                                {stage === 'preview' && (
                                    <div className="w-1/2 flex flex-col border-l border-gray-200 pl-6 dark:border-gray-700 h-full overflow-hidden">
                                        <div className="mb-4 flex items-center justify-between shrink-0">
                                            <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                                解析结果
                                                <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                                    共 {parsedAccounts.length} 条
                                                </span>
                                            </h3>
                                            <div className="flex gap-2 text-xs items-center">
                                                <span className="flex items-center text-green-600 dark:text-green-400">
                                                    <Check className="mr-1 h-3 w-3" />
                                                    {validCount} 有效
                                                </span>
                                                {invalidCount > 0 && (
                                                    <>
                                                        <span className="flex items-center text-red-600 dark:text-red-400">
                                                            <AlertCircle className="mr-1 h-3 w-3" />
                                                            {invalidCount} 无效
                                                        </span>
                                                        <button
                                                            onClick={() => setHideInvalid(!hideInvalid)}
                                                            className={cn(
                                                                "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                                                                hideInvalid
                                                                    ? "bg-gray-100 border-gray-300 text-gray-600 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300"
                                                                    : "border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                                                            )}
                                                        >
                                                            {hideInvalid ? '显示无效' : '隐藏无效'}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        <div className="max-h-[400px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                                            {parsedAccounts
                                                .filter(account => !hideInvalid || account.isValid)
                                                .map((account, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={cn(
                                                            "p-3 border-b last:border-0 border-gray-100 dark:border-gray-800 text-xs",
                                                            !account.isValid && "bg-red-50 dark:bg-red-900/10"
                                                        )}
                                                    >
                                                        <div className="flex items-start justify-between">
                                                            <div className="space-y-1 w-full overflow-hidden">
                                                                <div className="flex items-center font-medium truncate">
                                                                    <span className="text-gray-400 mr-2 shrink-0 w-6 text-right">#{account.lineNumber}</span>
                                                                    <div className={cn("w-1.5 h-1.5 rounded-full mr-2 shrink-0", account.isValid ? "bg-green-500" : "bg-red-500")} />
                                                                    {account.email || <span className="text-gray-400 italic">无邮箱</span>}
                                                                </div>
                                                                {account.error ? (
                                                                    <p className="text-red-600 dark:text-red-400 pl-3.5">{account.error}</p>
                                                                ) : (
                                                                    <div className="pl-3.5 opacity-70 grid grid-cols-2 gap-x-2 gap-y-1">
                                                                        <span className="truncate" title={account.password}>PWD: {account.password ? '******' : '-'}</span>
                                                                        <span className="truncate" title={account.clientId}>CID: {account.clientId ? '...' + account.clientId.slice(-4) : '-'}</span>
                                                                        <span className="truncate col-span-2" title={account.refreshToken}>RT: {account.refreshToken ? account.refreshToken.slice(0, 10) + '...' : '-'}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            {parsedAccounts.length === 0 && (
                                                <div className="flex h-full items-center justify-center text-gray-500">
                                                    暂无解析数据
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Sync Settings Configuration */}
                        {stage === 'syncSettings' && (
                            <div className="p-6 space-y-6">
                                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                                    首次同步配置
                                </h3>

                                {/* Sync Mode */}
                                <div className="space-y-3">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        同步模式
                                    </label>
                                    <div className="space-y-2">
                                        <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                            <input
                                                type="radio"
                                                value="incremental"
                                                checked={defaultSyncConfig.syncMode === 'incremental'}
                                                onChange={() => setDefaultSyncConfig(prev => ({ ...prev, syncMode: 'incremental' }))}
                                                className="mt-1"
                                            />
                                            <div>
                                                <div className="font-medium">增量同步（推荐）</div>
                                                <div className="text-sm text-gray-500 dark:text-gray-400">仅同步新邮件，速度快，适合日常使用</div>
                                            </div>
                                        </label>
                                        <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                            <input
                                                type="radio"
                                                value="full"
                                                checked={defaultSyncConfig.syncMode === 'full'}
                                                onChange={() => setDefaultSyncConfig(prev => ({ ...prev, syncMode: 'full' }))}
                                                className="mt-1"
                                            />
                                            <div>
                                                <div className="font-medium">全量同步</div>
                                                <div className="text-sm text-gray-500 dark:text-gray-400">同步所有邮件，适用于首次同步</div>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                {/* Max Emails */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        每个文件夹最大邮件数量
                                    </label>
                                    <input
                                        type="number"
                                        value={defaultSyncConfig.maxEmails}
                                        onChange={(e) => setDefaultSyncConfig(prev => ({ ...prev, maxEmails: parseInt(e.target.value) || 1000 }))}
                                        min="100"
                                        max="10000"
                                        step="100"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        首次同步并发
                                    </label>
                                    <input
                                        type="number"
                                        value={syncConcurrency}
                                        onChange={(e) => setSyncConcurrency(clampConcurrency(Number(e.target.value), MAX_SYNC_CONCURRENCY))}
                                        min="1"
                                        max={MAX_SYNC_CONCURRENCY}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    />
                                </div>

                                {/* Auto Sync Config */}
                                <div className="space-y-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={defaultSyncConfig.enableAutoSync}
                                            onChange={(e) => setDefaultSyncConfig(prev => ({ ...prev, enableAutoSync: e.target.checked }))}
                                            className="w-4 h-4 rounded border-gray-300"
                                        />
                                        <div>
                                            <div className="font-medium text-gray-900 dark:text-white">启用自动同步</div>
                                            <div className="text-sm text-gray-500 dark:text-gray-400">开启后将按照设定间隔自动同步邮件</div>
                                        </div>
                                    </label>

                                    {defaultSyncConfig.enableAutoSync && (
                                        <div className="ml-7 space-y-2">
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                同步间隔
                                            </label>
                                            <select
                                                value={defaultSyncConfig.syncInterval}
                                                onChange={(e) => setDefaultSyncConfig(prev => ({ ...prev, syncInterval: parseInt(e.target.value) }))}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            >
                                                <option value={60}>1分钟</option>
                                                <option value={300}>5分钟</option>
                                                <option value={600}>10分钟</option>
                                                <option value={900}>15分钟</option>
                                                <option value={1800}>30分钟</option>
                                                <option value={3600}>1小时</option>
                                            </select>
                                        </div>
                                    )}
                                </div>

                                {/* Account summary */}
                                <div className="p-4 rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800">
                                    <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                                        <CheckCircle className="h-5 w-5" />
                                        <span className="font-medium">
                                            将同步 {accountStatuses.filter(s => s.verifyStatus === 'success').length} 个已验证账户
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Auto Sync Config - Split Layout: Global Config on top, Per-Account Table below */}
                        {stage === 'autoSyncConfig' && (
                            <div className="p-6 space-y-6 overflow-y-auto max-h-[500px]">
                                {/* Global Config Section */}
                                <div className="p-4 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                            <Settings2 className="h-4 w-4 text-blue-600" />
                                            全局同步配置
                                        </h3>
                                        <Button size="sm" variant="outline" onClick={handleApplyGlobalToAll}>
                                            应用到全部账户
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={globalSyncConfig.enableAutoSync}
                                                onChange={(e) => setGlobalSyncConfig(prev => ({ ...prev, enableAutoSync: e.target.checked }))}
                                                className="w-4 h-4 rounded border-gray-300"
                                            />
                                            <span className="text-sm text-gray-700 dark:text-gray-300">启用自动同步</span>
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">同步间隔:</span>
                                            <select
                                                value={globalSyncConfig.syncInterval}
                                                onChange={(e) => setGlobalSyncConfig(prev => ({ ...prev, syncInterval: parseInt(e.target.value) }))}
                                                className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            >
                                                <option value={60}>1分钟</option>
                                                <option value={300}>5分钟</option>
                                                <option value={600}>10分钟</option>
                                                <option value={900}>15分钟</option>
                                                <option value={1800}>30分钟</option>
                                                <option value={3600}>1小时</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {/* Per-Account Config Table */}
                                <div>
                                    <h3 className="font-medium text-gray-900 dark:text-white mb-3">账户同步配置</h3>
                                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">邮箱</th>
                                                    <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-28">自动同步</th>
                                                    <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-32">同步间隔</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                                {accountStatuses
                                                    .filter(s => s.syncStatus === 'success' && s.accountId)
                                                    .map((status) => (
                                                        <tr key={status.accountId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                                                            <td className="px-3 py-2 text-gray-900 dark:text-gray-100 truncate max-w-[200px]">
                                                                {status.email}
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={perAccountConfigs[status.accountId!]?.enableAutoSync ?? true}
                                                                    onChange={(e) => setPerAccountConfigs(prev => ({
                                                                        ...prev,
                                                                        [status.accountId!]: {
                                                                            ...prev[status.accountId!],
                                                                            enableAutoSync: e.target.checked
                                                                        }
                                                                    }))}
                                                                    className="w-4 h-4 rounded border-gray-300"
                                                                />
                                                            </td>
                                                            <td className="px-3 py-2 text-center">
                                                                <select
                                                                    value={perAccountConfigs[status.accountId!]?.syncInterval ?? 300}
                                                                    onChange={(e) => setPerAccountConfigs(prev => ({
                                                                        ...prev,
                                                                        [status.accountId!]: {
                                                                            ...prev[status.accountId!],
                                                                            syncInterval: parseInt(e.target.value)
                                                                        }
                                                                    }))}
                                                                    className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                                >
                                                                    <option value={60}>1分钟</option>
                                                                    <option value={300}>5分钟</option>
                                                                    <option value={600}>10分钟</option>
                                                                    <option value={900}>15分钟</option>
                                                                    <option value={1800}>30分钟</option>
                                                                    <option value={3600}>1小时</option>
                                                                </select>
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}

                        {stage === 'background' && (
                            <TooltipProvider>
                                <div className="w-full p-6 space-y-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                                {!backgroundFinished && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
                                                {backgroundJob?.status === 'complete' && <CheckCircle className="h-4 w-4 text-green-600" />}
                                                {backgroundJob?.status === 'failed' && <XCircle className="h-4 w-4 text-red-600" />}
                                                后台 Outlook 导入：{getBackgroundStageLabel(backgroundJob)}
                                            </h3>
                                            {backgroundJob?.message && (
                                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{backgroundJob.message}</p>
                                            )}
                                        </div>
                                        <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                                            <div>{backgroundJob?.summary.completed_results ?? 0} / {backgroundJob?.summary.total ?? validCount}</div>
                                            <div>{backgroundProgress}%</div>
                                        </div>
                                    </div>

                                    <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                                        <div
                                            className={cn(
                                                "h-full transition-all duration-500",
                                                backgroundJob?.status === 'failed' ? "bg-red-500" : "bg-blue-600"
                                            )}
                                            style={{ width: `${Math.min(Math.max(backgroundProgress, 0), 100)}%` }}
                                        />
                                    </div>

                                    <div className="grid grid-cols-4 gap-3 text-xs">
                                        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                                            <div className="text-gray-500 dark:text-gray-400">导入成功</div>
                                            <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{backgroundJob?.summary.create_success ?? 0}</div>
                                        </div>
                                        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                                            <div className="text-gray-500 dark:text-gray-400">验证成功</div>
                                            <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{backgroundJob?.summary.verify_success ?? 0}</div>
                                        </div>
                                        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                                            <div className="text-gray-500 dark:text-gray-400">同步成功</div>
                                            <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{backgroundJob?.summary.sync_success ?? 0}</div>
                                        </div>
                                        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                                            <div className="text-gray-500 dark:text-gray-400">新邮件</div>
                                            <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{backgroundJob?.summary.total_new_emails ?? 0}</div>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[360px] overflow-y-auto">
                                        <table className="w-full text-xs">
                                            <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 w-12">#</th>
                                                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">邮箱</th>
                                                    <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-20">导入</th>
                                                    <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-20">验证</th>
                                                    <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-20">同步</th>
                                                    <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-20">配置</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                                {(backgroundJob?.results ?? []).map((result) => (
                                                    <tr key={`${result.line_number}-${result.email}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                        <td className="px-3 py-2 text-gray-500">{result.line_number}</td>
                                                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white truncate max-w-[200px]" title={result.email}>
                                                            {result.email}
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            {renderBackgroundStep(result.create_status, result.create_error)}
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            {renderBackgroundStep(result.verify_status, result.verify_error)}
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            {renderBackgroundStep(result.sync_status, result.sync_error, result.sync_new_emails ? `+${result.sync_new_emails}` : undefined)}
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            {renderBackgroundStep(result.config_status, result.config_error)}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {!backgroundJob?.results.length && (
                                                    <tr>
                                                        <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                                                            暂无任务明细
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </TooltipProvider>
                        )}

                        {/* Status Table for creating/verifying/verified/syncing/complete stages (excluded autoSyncConfig) */}
                        {(stage === 'creating' || stage === 'verifying' || stage === 'verified' || stage === 'syncing' || stage === 'complete') && (
                            <TooltipProvider>
                                <div className="w-full p-6">
                                    <div className="mb-4 flex items-center justify-between">
                                        <h3 className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                            {stage === 'creating' && (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                                    正在创建账户...
                                                </>
                                            )}
                                            {stage === 'verifying' && (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                                    正在验证连接...
                                                </>
                                            )}
                                            {stage === 'verified' && (
                                                <>
                                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                                    {verificationSkippedCount > 0 ? '导入完成' : '验证完成'}
                                                </>
                                            )}
                                            {stage === 'syncing' && (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                                    正在同步邮件...
                                                </>
                                            )}
                                            {stage === 'complete' && (
                                                <>
                                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                                    全部完成
                                                </>
                                            )}
                                        </h3>
                                        <div className="flex gap-3 text-xs">
                                            <span className="text-green-600">
                                                {verificationSuccessCount} 验证成功
                                            </span>
                                            {verificationSkippedCount > 0 && (
                                                <span className="text-amber-600">
                                                    {verificationSkippedCount} 未验证
                                                </span>
                                            )}
                                            {accountStatuses.filter(s => s.createStatus === 'error' || s.verifyStatus === 'error').length > 0 && (
                                                <span className="text-red-600">
                                                    {accountStatuses.filter(s => s.createStatus === 'error' || s.verifyStatus === 'error').length} 失败
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Status Table */}
                                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[400px] overflow-y-auto">
                                        <table className="w-full text-xs">
                                            <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400 w-12">#</th>
                                                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">邮箱</th>
                                                    <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-20">创建</th>
                                                    <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-20">验证</th>
                                                    {(stage === 'syncing' || stage === 'complete') && (
                                                        <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-20">同步</th>
                                                    )}
                                                    {stage === 'verified' && (
                                                        <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400 w-24">操作</th>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                                {accountStatuses.map((status, idx) => (
                                                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                        <td className="px-3 py-2 text-gray-500">{status.lineNumber}</td>
                                                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white truncate max-w-[180px]" title={status.email}>
                                                            {status.email}
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            {status.createStatus === 'pending' && <span className="text-gray-400">-</span>}
                                                            {status.createStatus === 'creating' && (
                                                                <Loader2 className="h-3 w-3 animate-spin text-blue-600 mx-auto" />
                                                            )}
                                                            {status.createStatus === 'success' && (
                                                                <CheckCircle className="h-3.5 w-3.5 text-green-600 mx-auto" />
                                                            )}
                                                            {status.createStatus === 'error' && (
                                                                <Tooltip>
                                                                    <TooltipTrigger>
                                                                        <XCircle className="h-3.5 w-3.5 text-red-600 mx-auto cursor-help" />
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top" className="max-w-xs text-xs">
                                                                        {status.createError || '创建失败'}
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            {status.verifyStatus === 'pending' && <span className="text-gray-400">-</span>}
                                                            {status.verifyStatus === 'verifying' && (
                                                                <Loader2 className="h-3 w-3 animate-spin text-blue-600 mx-auto" />
                                                            )}
                                                            {status.verifyStatus === 'success' && (
                                                                <CheckCircle className="h-3.5 w-3.5 text-green-600 mx-auto" />
                                                            )}
                                                            {status.verifyStatus === 'error' && (
                                                                <Tooltip>
                                                                    <TooltipTrigger>
                                                                        <XCircle className="h-3.5 w-3.5 text-red-600 mx-auto cursor-help" />
                                                                    </TooltipTrigger>
                                                                    <TooltipContent side="top" className="max-w-xs text-xs break-words">
                                                                        {status.verifyError || '验证失败'}
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            )}
                                                            {status.verifyStatus === 'skipped' && <span className="text-gray-400">-</span>}
                                                        </td>
                                                        {(stage === 'syncing' || stage === 'complete') && (
                                                            <td className="px-3 py-2 text-center">
                                                                {(!status.syncStatus || status.syncStatus === 'pending') && <span className="text-gray-400">-</span>}
                                                                {status.syncStatus === 'syncing' && (
                                                                    <Loader2 className="h-3 w-3 animate-spin text-blue-600 mx-auto" />
                                                                )}
                                                                {status.syncStatus === 'success' && (
                                                                    <CheckCircle className="h-3.5 w-3.5 text-green-600 mx-auto" />
                                                                )}
                                                                {status.syncStatus === 'error' && (
                                                                    <Tooltip>
                                                                        <TooltipTrigger>
                                                                            <XCircle className="h-3.5 w-3.5 text-red-600 mx-auto cursor-help" />
                                                                        </TooltipTrigger>
                                                                        <TooltipContent side="top" className="max-w-xs text-xs">
                                                                            {status.syncError || '同步失败'}
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                )}
                                                                {status.syncStatus === 'skipped' && <span className="text-gray-400">-</span>}
                                                            </td>
                                                        )}
                                                        {stage === 'verified' && (
                                                            <td className="px-3 py-2 text-center">
                                                                <div className="flex items-center justify-center gap-1">
                                                                    {status.verifyStatus === 'error' && (
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <button
                                                                                    onClick={() => handleRetryVerify(idx)}
                                                                                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-600"
                                                                                >
                                                                                    <RotateCw className="h-3.5 w-3.5" />
                                                                                </button>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent side="top">重新验证</TooltipContent>
                                                                        </Tooltip>
                                                                    )}
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <button
                                                                                onClick={() => handleEditAccount(idx)}
                                                                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-blue-600"
                                                                            >
                                                                                <Edit3 className="h-3.5 w-3.5" />
                                                                            </button>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent side="top">编辑</TooltipContent>
                                                                    </Tooltip>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <button
                                                                                onClick={() => handleRemoveAccount(idx)}
                                                                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-red-600"
                                                                            >
                                                                                <Trash2 className="h-3.5 w-3.5" />
                                                                            </button>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent side="top">移除</TooltipContent>
                                                                    </Tooltip>
                                                                </div>
                                                            </td>
                                                        )}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </TooltipProvider>
                        )}
                    </div>

                    {/* Edit Account Form Overlay */}
                    {editingIdx !== null && editingData && (
                        <div className="absolute inset-0 bg-white/95 dark:bg-gray-900/95 z-10 p-6 overflow-y-auto">
                            <div className="max-w-lg mx-auto space-y-4">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                                        编辑账户信息
                                    </h3>
                                    <button
                                        onClick={handleCancelEdit}
                                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                    >
                                        <XCircle className="h-5 w-5" />
                                    </button>
                                </div>

                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            邮箱地址
                                        </label>
                                        <input
                                            type="email"
                                            value={editingData.email}
                                            onChange={(e) => setEditingData(prev => prev ? { ...prev, email: e.target.value } : null)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            密码
                                        </label>
                                        <input
                                            type="password"
                                            value={editingData.password}
                                            onChange={(e) => setEditingData(prev => prev ? { ...prev, password: e.target.value } : null)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            placeholder="保持原密码则留空"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            Client ID
                                        </label>
                                        <input
                                            type="text"
                                            value={editingData.clientId}
                                            onChange={(e) => setEditingData(prev => prev ? { ...prev, clientId: e.target.value } : null)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                            Refresh Token
                                        </label>
                                        <textarea
                                            value={editingData.refreshToken}
                                            onChange={(e) => setEditingData(prev => prev ? { ...prev, refreshToken: e.target.value } : null)}
                                            rows={3}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white font-mono text-xs"
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-2 pt-4">
                                    <Button variant="outline" onClick={handleCancelEdit}>
                                        取消
                                    </Button>
                                    <Button onClick={handleSaveEdit}>
                                        保存
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </ModalBody>

                <ModalFooter className={cn((stage === 'preview' || stage === 'verified' || stage === 'syncSettings' || stage === 'autoSyncConfig' || stage === 'background' || stage === 'complete') && "border-t border-gray-200 dark:border-gray-700 pt-4")}>
                    {stage !== 'creating' && stage !== 'verifying' && stage !== 'syncing' && stage !== 'background' && !isProcessing && (
                        <Button variant="outline" onClick={handleClose}>
                            {stage === 'complete' ? '关闭' : '取消'}
                        </Button>
                    )}

                    {stage === 'preview' && (
                        <>
                            <div className="mr-auto flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
                                <label className="flex items-center gap-2">
                                    <Switch
                                        checked={verifyAfterCreate}
                                        onCheckedChange={setVerifyAfterCreate}
                                        className="scale-90"
                                    />
                                    <span>导入后立即验证</span>
                                    {validCount > LARGE_BATCH_VERIFY_THRESHOLD && (
                                        <span className="text-xs text-amber-600 dark:text-amber-400">大批量建议关闭</span>
                                    )}
                                </label>
                                <label className="flex items-center gap-1 text-xs">
                                    <span>导入并发</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={MAX_CREATE_CONCURRENCY}
                                        value={createConcurrency}
                                        onChange={(event) => setCreateConcurrency(clampConcurrency(Number(event.target.value), MAX_CREATE_CONCURRENCY))}
                                        className="h-7 w-14 rounded border border-gray-300 px-2 text-xs dark:border-gray-600 dark:bg-gray-700"
                                    />
                                </label>
                                <label className={cn("flex items-center gap-1 text-xs", !verifyAfterCreate && "opacity-50")}>
                                    <span>验证并发</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={MAX_VERIFY_CONCURRENCY}
                                        value={verifyConcurrency}
                                        disabled={!verifyAfterCreate}
                                        onChange={(event) => setVerifyConcurrency(clampConcurrency(Number(event.target.value), MAX_VERIFY_CONCURRENCY))}
                                        className="h-7 w-14 rounded border border-gray-300 px-2 text-xs disabled:cursor-not-allowed dark:border-gray-600 dark:bg-gray-700"
                                    />
                                </label>
                            </div>
                            <Button variant="secondary" onClick={parseAccounts}>
                                <Layout className="mr-2 h-4 w-4" />
                                重新解析
                            </Button>
                            <Button disabled={validCount === 0 || isProcessing} onClick={handleStartBackgroundImport}>
                                {isProcessing ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Settings2 className="mr-2 h-4 w-4" />
                                )}
                                后台执行完整流程 ({validCount})
                            </Button>
                            <Button variant="outline" disabled={validCount === 0 || isProcessing} onClick={handleConfirmAdd}>
                                {verifyAfterCreate ? `确认添加并验证 (${validCount})` : `仅导入 (${validCount})`}
                            </Button>
                        </>
                    )}

                    {(stage === 'creating' || stage === 'verifying' || stage === 'syncing' || isProcessing) && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {stage === 'creating' && '正在创建账户...'}
                            {stage === 'verifying' && '正在验证连接...'}
                            {stage === 'syncing' && '正在同步邮件...'}
                            {isProcessing && stage === 'autoSyncConfig' && '正在保存配置...'}
                            {isProcessing && stage === 'preview' && '正在启动后台任务...'}
                        </div>
                    )}

                    {stage === 'background' && (
                        <>
                            <div className="mr-auto flex items-center gap-2 text-sm text-gray-500">
                                {!backgroundFinished && <Loader2 className="h-4 w-4 animate-spin" />}
                                {backgroundFinished ? getBackgroundStageLabel(backgroundJob) : '后台任务运行中，可关闭窗口'}
                            </div>
                            <Button
                                variant="outline"
                                onClick={() => refreshBackgroundJob().catch((err: unknown) => onError?.(`刷新后台导入进度失败: ${getErrorMessage(err)}`))}
                            >
                                <RotateCw className="mr-2 h-4 w-4" />
                                刷新
                            </Button>
                            <Button onClick={handleClose}>
                                {backgroundFinished ? '完成' : '关闭窗口'}
                            </Button>
                        </>
                    )}

                    {stage === 'verified' && (
                        <Button onClick={handleGoToSyncSettings} disabled={verificationSuccessCount === 0}>
                            <Settings2 className="mr-2 h-4 w-4" />
                            配置同步 ({verificationSuccessCount})
                        </Button>
                    )}

                    {stage === 'syncSettings' && (
                        <Button onClick={handleStartSync}>
                            开始同步
                        </Button>
                    )}

                    {stage === 'autoSyncConfig' && !isProcessing && (
                        <Button onClick={handleSaveAutoSyncConfigs}>
                            保存配置
                        </Button>
                    )}

                    {stage === 'complete' && (
                        <Button onClick={handleFinalComplete}>
                            完成
                        </Button>
                    )}
                </ModalFooter>
            </ModalContent>
        </Modal >
    )
}
