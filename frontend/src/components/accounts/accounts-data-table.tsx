'use client'

import * as React from 'react'
import * as HoverCard from '@radix-ui/react-hover-card'
import { ColumnDef, RowSelectionState, SortingState } from '@tanstack/react-table'
import {
    RefreshCw,
    Edit2,
    Trash2,
    ShieldCheck,
    AlertCircle,
    CheckCircle,
    XCircle,
    Clock,
    Download,
    Link2,
    Key,
    Eye,
    Wifi,
    WifiOff,
    Code2,
    ExternalLink,
    FileText,
    Maximize2,
    Minimize2,
    Save,
    StickyNote,
    Forward,
    Globe2,
    Network,
    SlidersHorizontal,
    ArrowUp,
    ArrowDown,
    RotateCcw,
} from 'lucide-react'
import { DataTable, createSelectColumn } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import {
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalTitle,
} from '@/components/ui/modal'
import { AdaptiveActions, ActionItem } from '@/components/ui/adaptive-actions'
import { InlineTagSelector } from '@/components/tags/tag-selector'
import { GmailIcon, OutlookIcon } from '@/components/ui/brand-icons'
import { AccountNoteFormat, EmailAccount } from '@/types'
import { AccountSyncStatus } from '@/services/sync-config.service'
import { AccountProxyConfigRequest, emailAccountService } from '@/services/email-account.service'
import { ProxyConfigSection, ProxyConfigValue, defaultProxyConfigValue } from '@/components/proxy/proxy-config-section'
import { cn } from '@/lib/utils'
import { AccountNoteEditor } from './account-note-editor'
import {
    AccountNotePreview,
    getAccountNotePlainText,
    normalizeAccountNoteFormat,
    openAccountNoteStandalonePreview,
} from './account-note-preview'

interface AccountsDataTableProps {
    accounts: EmailAccount[]
    // 选择
    selectedIds: number[]
    onSelectionChange: (ids: number[]) => void
    // 操作回调
    onViewEmails: (account: EmailAccount) => void
    onPickupMail: (account: EmailAccount) => void
    onSync: (account: EmailAccount) => void
    onVerify: (account: EmailAccount) => void
    onEdit: (account: EmailAccount) => void
    onDelete: (id: number) => void
    onOAuth2Config?: (account: EmailAccount) => void
    onTagsChange?: () => void
    onAccountChange?: () => void
    // 状态
    syncingId?: number
    verifyingId?: number
    syncStatuses?: Map<number, AccountSyncStatus>
    // 排序
    sorting?: SortingState
    onSortingChange?: (sorting: SortingState) => void
}

// 提供商颜色映射
const getProviderColor = (provider?: string) => {
    switch (provider?.toLowerCase()) {
        case 'gmail':
            return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
        case 'outlook':
        case 'hotmail':
            return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
        case 'yahoo':
            return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
        default:
            return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
    }
}

// 错误状态颜色和图标
const getErrorStatusDisplay = (status?: string) => {
    switch (status) {
        case 'normal':
            return { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-900/20', label: '正常' }
        case 'oauth_expired':
            return { icon: Clock, color: 'text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-900/20', label: '授权过期' }
        case 'auth_revoked':
            return { icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-50 dark:bg-red-900/20', label: '授权撤销' }
        case 'api_disabled':
            return { icon: AlertCircle, color: 'text-orange-500', bgColor: 'bg-orange-50 dark:bg-orange-900/20', label: 'API禁用' }
        case 'network_error':
            return { icon: AlertCircle, color: 'text-gray-500', bgColor: 'bg-gray-50 dark:bg-gray-700', label: '网络错误' }
        default:
            return { icon: CheckCircle, color: 'text-green-500', bgColor: 'bg-green-50 dark:bg-green-900/20', label: '正常' }
    }
}

const hasProxyConfig = (account: EmailAccount) => {
    return Boolean(
        account.proxy ||
        account.proxyId ||
        account.proxyMode === 'selected' ||
        account.proxyMode === 'auto' ||
        account.proxyMatchGroupIds?.length ||
        account.proxyMatchTagIds?.length
    )
}

const getProxyLabel = (account: EmailAccount) => {
    if (account.proxyMode === 'auto') return '自动'
    if (account.proxyMode === 'selected') return '代理池'
    if (account.proxy) return '手动'
    if (account.proxyId) return '代理池'
    return '未启用'
}

type AccountsDataTableColumnId =
    | 'select'
    | 'emailAddress'
    | 'provider'
    | 'tags'
    | 'routingConfig'
    | 'note'
    | 'isVerified'
    | 'errorStatus'
    | 'syncConfig'
    | 'createdAt'
    | 'lastSyncAt'
    | 'actions'

type ConfigEditorKind = 'domain' | 'forwarding' | 'proxy'

interface TableColumnSettings {
    order: AccountsDataTableColumnId[]
    visible: Record<AccountsDataTableColumnId, boolean>
}

const TABLE_COLUMN_SETTINGS_KEY = 'mailman.accounts.professionalTable.columns.v1'

const DEFAULT_TABLE_COLUMN_ORDER: AccountsDataTableColumnId[] = [
    'select',
    'emailAddress',
    'provider',
    'tags',
    'routingConfig',
    'note',
    'isVerified',
    'errorStatus',
    'syncConfig',
    'createdAt',
    'lastSyncAt',
    'actions',
]

const LOCKED_TABLE_COLUMNS = new Set<AccountsDataTableColumnId>(['select', 'actions'])

const TABLE_COLUMN_META: Record<AccountsDataTableColumnId, { label: string; description: string; fixed?: boolean }> = {
    select: { label: '选择框', description: '批量选择账户', fixed: true },
    emailAddress: { label: '邮箱地址', description: '账户主邮箱地址' },
    provider: { label: '提供商', description: '邮箱服务提供商' },
    tags: { label: '标签', description: '账户标签和快捷编辑' },
    routingConfig: { label: '配置', description: '域名、转发和代理配置入口' },
    note: { label: '备注', description: 'Markdown / HTML / JS 备注预览' },
    isVerified: { label: '验证', description: '连接验证状态' },
    errorStatus: { label: '状态', description: '账号异常或正常状态' },
    syncConfig: { label: '同步配置', description: '自动同步状态和间隔' },
    createdAt: { label: '创建时间', description: '账户创建日期' },
    lastSyncAt: { label: '最后同步', description: '最近一次同步时间' },
    actions: { label: '操作', description: '查看、取件、同步和编辑', fixed: true },
}

const createDefaultColumnSettings = (): TableColumnSettings => ({
    order: [...DEFAULT_TABLE_COLUMN_ORDER],
    visible: DEFAULT_TABLE_COLUMN_ORDER.reduce((acc, id) => {
        acc[id] = true
        return acc
    }, {} as Record<AccountsDataTableColumnId, boolean>),
})

const normalizeColumnSettings = (settings?: Partial<TableColumnSettings> | null): TableColumnSettings => {
    const defaults = createDefaultColumnSettings()
    const knownIds = new Set(DEFAULT_TABLE_COLUMN_ORDER)
    const seen = new Set<AccountsDataTableColumnId>()
    const order = (settings?.order || [])
        .filter((id): id is AccountsDataTableColumnId => knownIds.has(id as AccountsDataTableColumnId))
        .filter((id) => {
            if (seen.has(id)) return false
            seen.add(id)
            return true
        })

    DEFAULT_TABLE_COLUMN_ORDER.forEach((id) => {
        if (!seen.has(id)) order.push(id)
    })

    const visible = { ...defaults.visible }
    if (settings?.visible) {
        DEFAULT_TABLE_COLUMN_ORDER.forEach((id) => {
            visible[id] = LOCKED_TABLE_COLUMNS.has(id) ? true : settings.visible?.[id] !== false
        })
    }

    return { order, visible }
}

const readColumnSettings = (): TableColumnSettings => {
    if (typeof window === 'undefined') return createDefaultColumnSettings()

    try {
        const raw = window.localStorage.getItem(TABLE_COLUMN_SETTINGS_KEY)
        if (!raw) return createDefaultColumnSettings()
        return normalizeColumnSettings(JSON.parse(raw))
    } catch {
        return createDefaultColumnSettings()
    }
}

const parseForwardedAddressDraft = (value: string) => {
    return value
        .split(/[\n,;，；]+/)
        .map((item) => item.trim())
        .filter(Boolean)
}

const maskProxyUrl = (value?: string) => {
    if (!value) return ''
    return value.replace(/:\/\/([^:@/\s]+):([^@/\s]+)@/, '://$1:***@')
}

const proxyConfigFromAccount = (account: EmailAccount): ProxyConfigValue => {
    const config = defaultProxyConfigValue()
    let proxyUrl = account.proxy || ''
    let proxyUsername = ''
    let proxyPassword = ''

    if (proxyUrl) {
        try {
            const url = new URL(proxyUrl)
            proxyUsername = decodeURIComponent(url.username)
            proxyPassword = decodeURIComponent(url.password)
            url.username = ''
            url.password = ''
            proxyUrl = url.toString()
        } catch {
            proxyUrl = account.proxy || ''
        }
    }

    return {
        ...config,
        useProxy: hasProxyConfig(account),
        proxyMode: account.proxyMode || 'manual',
        proxyUrl,
        proxyUsername,
        proxyPassword,
        proxyId: account.proxyId,
        proxyFallbackMode: account.proxyFallbackMode || 'interrupt',
        proxyFallbackProxyId: account.proxyFallbackProxyId,
        proxyFallbackProxy: account.proxyFallbackProxy || '',
        proxyMatchGroupIds: account.proxyMatchGroupIds || [],
        proxyMatchTagIds: account.proxyMatchTagIds || [],
        proxyMatchTagMode: account.proxyMatchTagMode || 'or',
    }
}

const buildManualProxyUrl = (config: ProxyConfigValue) => {
    const rawProxy = config.proxyUrl.trim()
    if (!rawProxy) return ''

    const withScheme = rawProxy.includes('://') ? rawProxy : `${config.proxyType}://${rawProxy}`
    try {
        const url = new URL(withScheme)
        url.username = config.proxyUsername ? encodeURIComponent(config.proxyUsername) : ''
        url.password = config.proxyPassword ? encodeURIComponent(config.proxyPassword) : ''
        return url.toString()
    } catch {
        const stripped = rawProxy.replace(/^[a-z0-9+.-]+:\/\//i, '')
        const credentials = config.proxyUsername
            ? `${encodeURIComponent(config.proxyUsername)}${config.proxyPassword ? `:${encodeURIComponent(config.proxyPassword)}` : ''}@`
            : ''
        return `${config.proxyType}://${credentials}${stripped}`
    }
}

const proxyConfigRequestFromDraft = (config: ProxyConfigValue): AccountProxyConfigRequest => {
    const payload: AccountProxyConfigRequest = {
        enabled: config.useProxy,
        useProxy: config.useProxy,
        proxyMode: config.proxyMode,
        proxyFallbackMode: config.proxyFallbackMode,
        proxyFallbackProxyId: config.proxyFallbackProxyId,
        proxyFallbackProxy: config.proxyFallbackProxy,
        proxyMatchGroupIds: config.proxyMatchGroupIds,
        proxyMatchTagIds: config.proxyMatchTagIds,
        proxyMatchTagMode: config.proxyMatchTagMode,
    }

    if (config.proxyMode === 'manual') {
        payload.proxy = buildManualProxyUrl(config)
    }
    if (config.proxyMode === 'selected') {
        payload.proxyId = config.proxyId
    }
    if (config.proxyMode === 'auto') {
        payload.proxyMatchGroupIds = config.proxyMatchGroupIds
        payload.proxyMatchTagIds = config.proxyMatchTagIds
    }

    return payload
}

const extractErrorMessage = (error: unknown) => {
    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
        const anyError = error as { response?: { data?: unknown }; message?: string }
        if (typeof anyError.response?.data === 'string') return anyError.response.data
        if (anyError.response?.data && typeof anyError.response.data === 'object' && 'message' in anyError.response.data) {
            return String((anyError.response.data as { message?: unknown }).message)
        }
        if (anyError.message) return anyError.message
    }
    return '保存失败，请稍后重试'
}

export function AccountsDataTable({
    accounts,
    selectedIds,
    onSelectionChange,
    onViewEmails,
    onPickupMail,
    onSync,
    onVerify,
    onEdit,
    onDelete,
    onOAuth2Config,
    onTagsChange,
    onAccountChange,
    syncingId,
    verifyingId,
    syncStatuses,
    sorting,
    onSortingChange,
}: AccountsDataTableProps) {
    const [notePreviewAccount, setNotePreviewAccount] = React.useState<EmailAccount | null>(null)
    const [noteMode, setNoteMode] = React.useState<'preview' | 'edit'>('preview')
    const [noteDraft, setNoteDraft] = React.useState('')
    const [noteFormatDraft, setNoteFormatDraft] = React.useState<AccountNoteFormat>('markdown')
    const [noteSaving, setNoteSaving] = React.useState(false)
    const [noteViewport, setNoteViewport] = React.useState<'compact' | 'wide' | 'full'>('wide')
    const [noteHeight, setNoteHeight] = React.useState(520)
    const [columnSettingsOpen, setColumnSettingsOpen] = React.useState(false)
    const [tableColumnSettings, setTableColumnSettings] = React.useState<TableColumnSettings>(readColumnSettings)
    const [configEditor, setConfigEditor] = React.useState<{ kind: ConfigEditorKind; account: EmailAccount } | null>(null)
    const [domainEnabledDraft, setDomainEnabledDraft] = React.useState(false)
    const [domainDraft, setDomainDraft] = React.useState('')
    const [forwardingDraft, setForwardingDraft] = React.useState('')
    const [proxyDraft, setProxyDraft] = React.useState<ProxyConfigValue>(defaultProxyConfigValue)
    const [configSaving, setConfigSaving] = React.useState(false)
    const [configError, setConfigError] = React.useState<string | null>(null)

    React.useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem(TABLE_COLUMN_SETTINGS_KEY, JSON.stringify(tableColumnSettings))
    }, [tableColumnSettings])

    const updateColumnSettings = React.useCallback((updater: (settings: TableColumnSettings) => TableColumnSettings) => {
        setTableColumnSettings((current) => normalizeColumnSettings(updater(current)))
    }, [])

    const toggleColumnVisibility = React.useCallback((id: AccountsDataTableColumnId, visible: boolean) => {
        if (LOCKED_TABLE_COLUMNS.has(id)) return
        updateColumnSettings((settings) => ({
            ...settings,
            visible: {
                ...settings.visible,
                [id]: visible,
            },
        }))
    }, [updateColumnSettings])

    const moveColumn = React.useCallback((id: AccountsDataTableColumnId, direction: -1 | 1) => {
        updateColumnSettings((settings) => {
            const order = [...settings.order]
            const index = order.indexOf(id)
            const targetIndex = index + direction
            if (index < 0 || targetIndex < 0 || targetIndex >= order.length) return settings
            const [item] = order.splice(index, 1)
            order.splice(targetIndex, 0, item)
            return { ...settings, order }
        })
    }, [updateColumnSettings])

    const resetColumnSettings = React.useCallback(() => {
        setTableColumnSettings(createDefaultColumnSettings())
    }, [])

    const openConfigEditor = React.useCallback((account: EmailAccount, kind: ConfigEditorKind) => {
        setConfigEditor({ account, kind })
        setConfigError(null)
        setConfigSaving(false)

        if (kind === 'domain') {
            setDomainEnabledDraft(Boolean(account.isDomainMail && account.domain?.trim()))
            setDomainDraft(account.domain || '')
        } else if (kind === 'forwarding') {
            setForwardingDraft((account.forwardedAddresses || []).join('\n'))
        } else {
            setProxyDraft(proxyConfigFromAccount(account))
        }
    }, [])

    const closeConfigEditor = React.useCallback(() => {
        setConfigEditor(null)
        setConfigError(null)
        setConfigSaving(false)
    }, [])

    const saveConfigEditor = React.useCallback(async () => {
        if (!configEditor) return

        setConfigSaving(true)
        setConfigError(null)
        try {
            const target = { id: configEditor.account.id }

            if (configEditor.kind === 'domain') {
                await emailAccountService.setDomainConfig(target, {
                    isDomainMail: domainEnabledDraft,
                    enabled: domainEnabledDraft,
                    domain: domainEnabledDraft ? domainDraft : '',
                })
            } else if (configEditor.kind === 'forwarding') {
                await emailAccountService.setForwardedAddresses(target, parseForwardedAddressDraft(forwardingDraft))
            } else if (!proxyDraft.useProxy) {
                await emailAccountService.clearProxyConfig(target)
            } else {
                await emailAccountService.setProxyConfig(target, proxyConfigRequestFromDraft(proxyDraft))
            }

            closeConfigEditor()
            onAccountChange?.()
        } catch (error) {
            setConfigError(extractErrorMessage(error))
        } finally {
            setConfigSaving(false)
        }
    }, [
        closeConfigEditor,
        configEditor,
        domainDraft,
        domainEnabledDraft,
        forwardingDraft,
        onAccountChange,
        proxyDraft,
    ])

    const openNoteDialog = React.useCallback((account: EmailAccount, mode: 'preview' | 'edit' = 'preview') => {
        setNotePreviewAccount(account)
        setNoteMode(mode)
        setNoteDraft(account.note || '')
        setNoteFormatDraft(normalizeAccountNoteFormat(account.noteFormat))
    }, [])

    const closeNoteDialog = React.useCallback(() => {
        setNotePreviewAccount(null)
        setNoteMode('preview')
        setNoteDraft('')
        setNoteFormatDraft('markdown')
        setNoteSaving(false)
    }, [])

    const saveNote = React.useCallback(async () => {
        if (!notePreviewAccount) return

        setNoteSaving(true)
        try {
            await emailAccountService.updateAccount(notePreviewAccount.id, {
                id: notePreviewAccount.id,
                note: noteDraft,
                note_format: noteFormatDraft,
            })

            const updatedAccount = {
                ...notePreviewAccount,
                note: noteDraft,
                noteFormat: noteFormatDraft,
            }
            setNotePreviewAccount(updatedAccount)
            setNoteMode('preview')
            onAccountChange?.()
        } finally {
            setNoteSaving(false)
        }
    }, [noteDraft, noteFormatDraft, notePreviewAccount, onAccountChange])

    const openStandaloneNotePreview = React.useCallback(() => {
        if (!notePreviewAccount) return

        openAccountNoteStandalonePreview({
            note: noteMode === 'edit' ? noteDraft : notePreviewAccount.note || '',
            format: noteMode === 'edit' ? noteFormatDraft : notePreviewAccount.noteFormat,
            title: `${notePreviewAccount.emailAddress} 账户备注`,
        })
    }, [noteDraft, noteFormatDraft, noteMode, notePreviewAccount])

    const openInternalNoteTab = React.useCallback(() => {
        if (!notePreviewAccount) return

        const accountForTab = {
            ...notePreviewAccount,
            note: noteMode === 'edit' ? noteDraft : notePreviewAccount.note,
            noteFormat: noteMode === 'edit' ? noteFormatDraft : notePreviewAccount.noteFormat,
        }

        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: `account-note-${notePreviewAccount.id}`,
                data: {
                    accountId: notePreviewAccount.id,
                    account: accountForTab,
                    mode: noteMode === 'edit' ? 'split' : 'preview',
                },
            },
        }))
        closeNoteDialog()
    }, [closeNoteDialog, noteDraft, noteFormatDraft, noteMode, notePreviewAccount])

    const previewFormat = noteMode === 'edit' ? noteFormatDraft : notePreviewAccount?.noteFormat
    const previewContent = noteMode === 'edit' ? noteDraft : notePreviewAccount?.note
    const modalWidthClass = noteViewport === 'compact'
        ? '!max-w-2xl'
        : noteViewport === 'full'
            ? '!max-w-[96vw]'
            : '!max-w-5xl'

    // 将 selectedIds 转换为 RowSelectionState
    const rowSelection = React.useMemo(() => {
        const selection: RowSelectionState = {}
        selectedIds.forEach((id) => {
            selection[String(id)] = true
        })
        return selection
    }, [selectedIds])

    // 处理选择变化
    const handleRowSelectionChange = React.useCallback(
        (newSelection: RowSelectionState) => {
            const ids = Object.keys(newSelection)
                .filter((key) => newSelection[key])
                .map((key) => Number(key))
            onSelectionChange(ids)
        },
        [onSelectionChange]
    )

    // 列定义
    const allColumns = React.useMemo<ColumnDef<EmailAccount, unknown>[]>(
        () => [
            // 选择列
            createSelectColumn<EmailAccount>(),

            // 邮箱地址
            {
                id: 'emailAddress',
                accessorKey: 'emailAddress',
                header: '邮箱地址',
                size: 180,
                enableSorting: true,
                cell: ({ row }) => (
                    <span
                        className="font-medium text-gray-900 dark:text-gray-100 truncate block"
                        title={row.original.emailAddress}
                    >
                        {row.original.emailAddress}
                    </span>
                ),
            },

            // 提供商
            {
                id: 'provider',
                accessorKey: 'mailProvider.name',
                header: '提供商',
                size: 100,
                enableSorting: true,
                cell: ({ row }) => {
                    const providerName = row.original.mailProvider?.name || row.original.mailProvider?.type || ''
                    const providerLower = providerName.toLowerCase()

                    // 根据提供商名称选择图标
                    const ProviderIcon = providerLower.includes('gmail') || providerLower.includes('google')
                        ? GmailIcon
                        : providerLower.includes('outlook') || providerLower.includes('hotmail') || providerLower.includes('microsoft')
                            ? OutlookIcon
                            : null

                    return (
                        <span
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium',
                                getProviderColor(providerName)
                            )}
                        >
                            {ProviderIcon && <ProviderIcon size={14} />}
                            {providerName || 'Unknown'}
                        </span>
                    )
                },
            },

            // 标签
            {
                id: 'tags',
                header: '标签',
                size: 170,
                enableSorting: false,
                cell: ({ row }) => (
                    <div className="max-w-full overflow-hidden">
                        <InlineTagSelector
                            accountId={row.original.id}
                            currentTags={row.original.tags || []}
                            onTagsChange={onTagsChange}
                            size="sm"
                            maxDisplayTags={3}
                            className="w-full"
                        />
                    </div>
                ),
            },

            // 路由与代理配置
            {
                id: 'routingConfig',
                header: '配置',
                size: 230,
                enableSorting: false,
                cell: ({ row }) => {
                    const account = row.original
                    const domainEnabled = Boolean(account.isDomainMail && account.domain?.trim())
                    const forwardedAddresses = account.forwardedAddresses || []
                    const proxyEnabled = hasProxyConfig(account)

                    const items = [
                        {
                            key: 'domain',
                            kind: 'domain' as const,
                            icon: Globe2,
                            label: '域名',
                            active: domainEnabled,
                            text: '域名',
                            details: domainEnabled ? [account.domain || '已启用域名邮箱'] : [],
                            className: domainEnabled
                                ? 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/50 dark:bg-purple-950/40 dark:text-purple-200'
                                : 'border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-500',
                        },
                        {
                            key: 'forwarding',
                            kind: 'forwarding' as const,
                            icon: Forward,
                            label: '转发',
                            active: forwardedAddresses.length > 0,
                            text: forwardedAddresses.length > 0 ? `转发 ${forwardedAddresses.length}` : '转发',
                            details: forwardedAddresses,
                            className: forwardedAddresses.length > 0
                                ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200'
                                : 'border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-500',
                        },
                        {
                            key: 'proxy',
                            kind: 'proxy' as const,
                            icon: Network,
                            label: '代理',
                            active: proxyEnabled,
                            text: proxyEnabled ? `代理 ${getProxyLabel(account)}` : '代理',
                            details: proxyEnabled
                                ? [
                                    `策略: ${getProxyLabel(account)}`,
                                    account.proxy ? `代理: ${maskProxyUrl(account.proxy)}` : '',
                                    account.proxyId ? `代理池 ID: ${account.proxyId}` : '',
                                    account.proxyMatchGroupIds?.length ? `匹配分组: ${account.proxyMatchGroupIds.join(', ')}` : '',
                                    account.proxyMatchTagIds?.length ? `匹配标签: ${account.proxyMatchTagIds.join(', ')}` : '',
                                ].filter(Boolean)
                                : [],
                            className: proxyEnabled
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200'
                                : 'border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-800/70 dark:text-gray-500',
                        },
                    ]

                    return (
                        <div className="flex max-w-[230px] items-center gap-1 overflow-hidden whitespace-nowrap">
                            {items.map((item) => {
                                const Icon = item.icon
                                return (
                                    <HoverCard.Root key={item.key} openDelay={120} closeDelay={80}>
                                        <HoverCard.Trigger asChild>
                                            <button
                                                type="button"
                                                onClick={() => openConfigEditor(account, item.kind)}
                                                className={cn(
                                                    'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4 transition-all hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 dark:focus:ring-offset-gray-800',
                                                    item.active && 'shadow-sm',
                                                    item.className
                                                )}
                                            >
                                                <Icon className="h-3 w-3 shrink-0" />
                                                <span>{item.text}</span>
                                            </button>
                                        </HoverCard.Trigger>
                                        <HoverCard.Portal>
                                            <HoverCard.Content
                                                side="top"
                                                align="start"
                                                sideOffset={8}
                                                className="z-[80] w-72 rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 dark:border-gray-700 dark:bg-gray-900"
                                            >
                                                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                                                    <Icon className="h-4 w-4" />
                                                    {item.label}配置
                                                </div>
                                                {item.details.length > 0 ? (
                                                    <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                                                        {item.details.map((detail, index) => (
                                                            <div
                                                                key={`${item.key}-${index}`}
                                                                className="rounded-md bg-gray-50 px-2 py-1 font-mono text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                                            >
                                                                {detail}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                                        暂未配置
                                                    </div>
                                                )}
                                                <div className="mt-2 text-[11px] text-gray-400">点击可独立编辑</div>
                                            </HoverCard.Content>
                                        </HoverCard.Portal>
                                    </HoverCard.Root>
                                )
                            })}
                        </div>
                    )
                },
            },

            // 备注
            {
                id: 'note',
                header: '备注',
                size: 150,
                enableSorting: false,
                cell: ({ row }) => {
                    const note = row.original.note?.trim()
                    const noteFormat = normalizeAccountNoteFormat(row.original.noteFormat)

                    if (!note) {
                        return (
                            <button
                                type="button"
                                onClick={() => openNoteDialog(row.original, 'edit')}
                                className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                                title="添加备注"
                            >
                                <StickyNote className="h-3.5 w-3.5" />
                                添加备注
                            </button>
                        )
                    }

                    const previewText = getAccountNotePlainText(note, noteFormat) || (noteFormat === 'html' ? 'HTML/JS 备注' : 'Markdown 备注')
                    const FormatIcon = noteFormat === 'html' ? Code2 : FileText

                    return (
                        <button
                            type="button"
                            onClick={() => openNoteDialog(row.original)}
                            className="inline-flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                            title={previewText}
                        >
                            <FormatIcon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{previewText}</span>
                        </button>
                    )
                },
            },

            // 验证状态
            {
                id: 'isVerified',
                accessorKey: 'isVerified',
                header: '验证',
                size: 70,
                enableSorting: true,
                cell: ({ row }) => (
                    row.original.isVerified ? (
                        <div
                            className="flex items-center gap-1"
                            title={row.original.verifiedAt
                                ? `验证时间: ${new Date(row.original.verifiedAt).toLocaleString('zh-CN')}`
                                : '已验证'
                            }
                        >
                            <ShieldCheck className="h-4 w-4 text-green-500" />
                            <span className="text-xs text-green-600 dark:text-green-400">已验证</span>
                        </div>
                    ) : (
                        <span className="text-xs text-gray-400">未验证</span>
                    )
                ),
            },

            // 错误状态
            {
                id: 'errorStatus',
                accessorKey: 'errorStatus',
                header: '状态',
                size: 100,
                enableSorting: true,
                cell: ({ row }) => {
                    const { icon: Icon, color, bgColor, label } = getErrorStatusDisplay(row.original.errorStatus)
                    return (
                        <div
                            className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5", bgColor)}
                            title={row.original.errorMessage || label}
                        >
                            <Icon className={cn('h-3.5 w-3.5', color)} />
                            <span className={cn('text-xs font-medium', color)}>{label}</span>
                        </div>
                    )
                },
            },

            // 同步配置
            {
                id: 'syncConfig',
                header: '同步配置',
                size: 130,
                enableSorting: false,
                cell: ({ row }) => {
                    const status = syncStatuses?.get(row.original.id)

                    if (!status) {
                        return (
                            <div className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400" title="未配置自动同步">
                                <WifiOff className="h-3.5 w-3.5" />
                                未配置
                            </div>
                        )
                    }

                    const disabled = !status.enable_auto_sync || status.auto_disabled
                    const intervalText = status.sync_interval >= 60
                        ? `${Math.round(status.sync_interval / 60)} 分钟`
                        : `${status.sync_interval} 秒`
                    const tooltip = [
                        disabled ? (status.auto_disabled ? `已自动禁用: ${status.disable_reason || '错误过多'}` : '已关闭自动同步') : '已开启自动同步',
                        `同步间隔: ${intervalText}`,
                        status.last_sync_error ? `最近错误: ${status.last_sync_error}` : '',
                    ].filter(Boolean).join('\n')

                    return (
                        <div
                            className={cn(
                                "inline-flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium",
                                disabled
                                    ? "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                                    : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300"
                            )}
                            title={tooltip}
                        >
                            {disabled ? <WifiOff className="h-3.5 w-3.5 shrink-0" /> : <Wifi className="h-3.5 w-3.5 shrink-0" />}
                            <span className="truncate">
                                {disabled ? '未开启' : intervalText}
                            </span>
                        </div>
                    )
                },
            },

            // 创建时间
            {
                id: 'createdAt',
                accessorKey: 'createdAt',
                header: '创建时间',
                size: 95,
                enableSorting: true,
                cell: ({ row }) => (
                    <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                        {new Date(row.original.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                ),
            },

            // 最后同步
            {
                id: 'lastSyncAt',
                accessorKey: 'lastSyncAt',
                header: '最后同步',
                size: 105,
                enableSorting: true,
                cell: ({ row }) => {
                    const syncTime = row.original.lastSyncAt || row.original.lastSync
                    return (
                        <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                            {syncTime
                                ? new Date(syncTime).toLocaleString('zh-CN', {
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                })
                                : '-'}
                        </span>
                    )
                },
            },

            // 操作
            {
                id: 'actions',
                header: '操作',
                size: 160,
                enableSorting: false,
                enableResizing: true,
                cell: ({ row }) => {
                    const account = row.original
                    const isSyncing = syncingId === account.id
                    const isVerifying = verifyingId === account.id

                    const actions: ActionItem[] = [
                        {
                            id: 'view',
                            icon: Eye,
                            label: '查看邮件',
                            onClick: () => onViewEmails(account),
                            color: 'primary',
                        },
                        {
                            id: 'pickup',
                            icon: Download,
                            label: '取件',
                            onClick: () => onPickupMail(account),
                            color: 'success',
                        },
                        {
                            id: 'sync',
                            icon: RefreshCw,
                            label: '同步',
                            onClick: () => onSync(account),
                            disabled: isSyncing,
                            loading: isSyncing,
                        },
                        {
                            id: 'verify',
                            icon: Link2,
                            label: '验证连接',
                            onClick: () => onVerify(account),
                            disabled: isVerifying,
                            loading: isVerifying,
                        },
                        ...(account.authType === 'oauth2' && onOAuth2Config ? [{
                            id: 'oauth2',
                            icon: Key,
                            label: 'OAuth2配置',
                            onClick: () => onOAuth2Config(account),
                            color: 'info' as const,
                        }] : []),
                        {
                            id: 'edit',
                            icon: Edit2,
                            label: '编辑',
                            onClick: () => onEdit(account),
                            separator: true,
                        },
                        {
                            id: 'delete',
                            icon: Trash2,
                            label: '删除',
                            onClick: () => onDelete(account.id),
                            color: 'danger',
                        },
                    ]

                    return <AdaptiveActions actions={actions} maxVisible={5} />
                },
            },
        ],
        [syncingId, verifyingId, syncStatuses, openNoteDialog, openConfigEditor, onViewEmails, onPickupMail, onSync, onVerify, onEdit, onDelete, onOAuth2Config, onTagsChange]
    )

    const columns = React.useMemo<ColumnDef<EmailAccount, unknown>[]>(() => {
        const columnMap = new Map<AccountsDataTableColumnId, ColumnDef<EmailAccount, unknown>>()
        allColumns.forEach((column) => {
            const id = column.id as AccountsDataTableColumnId | undefined
            if (id) columnMap.set(id, column)
        })

        return tableColumnSettings.order
            .filter((id) => tableColumnSettings.visible[id] || LOCKED_TABLE_COLUMNS.has(id))
            .map((id) => columnMap.get(id))
            .filter((column): column is ColumnDef<EmailAccount, unknown> => Boolean(column))
    }, [allColumns, tableColumnSettings])

    const visibleColumnCount = tableColumnSettings.order.filter((id) => tableColumnSettings.visible[id]).length
    const forwardingPreview = React.useMemo(() => parseForwardedAddressDraft(forwardingDraft), [forwardingDraft])
    const configEditorIcon = configEditor?.kind === 'domain'
        ? Globe2
        : configEditor?.kind === 'forwarding'
            ? Forward
            : Network
    const ConfigEditorIcon = configEditorIcon
    const configEditorTitle = configEditor?.kind === 'domain'
        ? '域名邮箱配置'
        : configEditor?.kind === 'forwarding'
            ? '转发地址配置'
            : '代理策略配置'
    const configSaveDisabled = configSaving ||
        (configEditor?.kind === 'domain' && domainEnabledDraft && !domainDraft.trim()) ||
        (configEditor?.kind === 'proxy' && proxyDraft.useProxy && proxyDraft.proxyMode === 'manual' && !proxyDraft.proxyUrl.trim()) ||
        (configEditor?.kind === 'proxy' && proxyDraft.useProxy && proxyDraft.proxyMode === 'selected' && !proxyDraft.proxyId)

    return (
        <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                    专业表格已显示 {visibleColumnCount} / {DEFAULT_TABLE_COLUMN_ORDER.length} 列
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setColumnSettingsOpen(true)}
                >
                    <SlidersHorizontal className="mr-1.5 h-4 w-4" />
                    列设置
                </Button>
            </div>

            <DataTable
                columns={columns}
                data={accounts}
                sorting={sorting}
                onSortingChange={onSortingChange}
                rowSelection={rowSelection}
                onRowSelectionChange={handleRowSelectionChange}
                getRowId={(row) => String(row.id)}
                enableColumnResizing={true}
                compact={true}
            />

            <Modal open={columnSettingsOpen} onOpenChange={setColumnSettingsOpen}>
                <ModalContent size="2xl" className="max-h-[86vh]">
                    <ModalHeader>
                        <ModalTitle className="flex items-center gap-2">
                            <SlidersHorizontal className="h-5 w-5 text-primary-600" />
                            专业表格列设置
                        </ModalTitle>
                        <p className="text-sm text-gray-500 dark:text-gray-400">选择需要展示的字段，并用上下箭头调整展示顺序。</p>
                    </ModalHeader>
                    <ModalBody className="space-y-2">
                        {tableColumnSettings.order.map((id, index) => {
                            const meta = TABLE_COLUMN_META[id]
                            const locked = LOCKED_TABLE_COLUMNS.has(id)
                            return (
                                <div
                                    key={id}
                                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 transition-colors hover:border-primary-200 hover:bg-primary-50/40 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-primary-800 dark:hover:bg-primary-950/20"
                                >
                                    <input
                                        type="checkbox"
                                        checked={tableColumnSettings.visible[id]}
                                        disabled={locked}
                                        onChange={(event) => toggleColumnVisibility(id, event.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">{meta.label}</span>
                                            {meta.fixed && (
                                                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">固定</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">{meta.description}</div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => moveColumn(id, -1)}
                                            disabled={index === 0}
                                            className="rounded-md border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                                            title="上移"
                                        >
                                            <ArrowUp className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => moveColumn(id, 1)}
                                            disabled={index === tableColumnSettings.order.length - 1}
                                            className="rounded-md border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                                            title="下移"
                                        >
                                            <ArrowDown className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </ModalBody>
                    <ModalFooter>
                        <Button type="button" variant="outline" onClick={resetColumnSettings}>
                            <RotateCcw className="mr-1.5 h-4 w-4" />
                            恢复默认
                        </Button>
                        <Button type="button" onClick={() => setColumnSettingsOpen(false)}>
                            完成
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <Modal open={!!configEditor} onOpenChange={(open) => !open && closeConfigEditor()}>
                <ModalContent size="full" className="!max-w-4xl max-h-[88vh] overflow-hidden">
                    <ModalHeader>
                        <ModalTitle className="flex items-center gap-2">
                            <ConfigEditorIcon className="h-5 w-5 text-primary-600" />
                            {configEditorTitle}
                        </ModalTitle>
                        {configEditor && (
                            <p className="text-sm text-gray-500 dark:text-gray-400">{configEditor.account.emailAddress}</p>
                        )}
                    </ModalHeader>
                    <ModalBody className="space-y-5">
                        {configError && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                                {configError}
                            </div>
                        )}

                        {configEditor?.kind === 'domain' && (
                            <div className="space-y-4">
                                <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-900">
                                    <input
                                        type="checkbox"
                                        checked={domainEnabledDraft}
                                        onChange={(event) => setDomainEnabledDraft(event.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                    />
                                    <span className="text-sm font-semibold text-gray-900 dark:text-white">启用域名邮箱</span>
                                </label>
                                <label className="block space-y-1.5">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">域名</span>
                                    <input
                                        value={domainDraft}
                                        onChange={(event) => setDomainDraft(event.target.value)}
                                        disabled={!domainEnabledDraft}
                                        placeholder="example.com"
                                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:disabled:bg-gray-800"
                                    />
                                </label>
                                <div className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                    {domainEnabledDraft && domainDraft.trim() ? `当前会匹配 *@${domainDraft.trim().replace(/^@/, '')}` : '暂未配置'}
                                </div>
                            </div>
                        )}

                        {configEditor?.kind === 'forwarding' && (
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
                                <label className="block space-y-1.5">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">转发来源地址</span>
                                    <textarea
                                        value={forwardingDraft}
                                        onChange={(event) => setForwardingDraft(event.target.value)}
                                        placeholder="source@example.com&#10;*@example.org"
                                        className="h-80 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-700 dark:bg-gray-900"
                                    />
                                </label>
                                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <span className="text-sm font-semibold text-gray-900 dark:text-white">已解析 {forwardingPreview.length} 条</span>
                                        <span className="text-xs text-gray-400">支持换行、逗号和分号</span>
                                    </div>
                                    {forwardingPreview.length > 0 ? (
                                        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                                            {forwardingPreview.map((address, index) => (
                                                <div
                                                    key={`${address}-${index}`}
                                                    className="rounded-md bg-white px-2 py-1.5 font-mono text-xs text-gray-700 shadow-sm dark:bg-gray-800 dark:text-gray-200"
                                                >
                                                    {address}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="rounded-md border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-400 dark:border-gray-700">
                                            暂未配置
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {configEditor?.kind === 'proxy' && (
                            <ProxyConfigSection
                                value={proxyDraft}
                                onChange={setProxyDraft}
                                compact={false}
                            />
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button type="button" variant="outline" onClick={closeConfigEditor} disabled={configSaving}>
                            取消
                        </Button>
                        <Button
                            type="button"
                            onClick={saveConfigEditor}
                            disabled={configSaveDisabled}
                        >
                            <Save className="mr-2 h-4 w-4" />
                            {configSaving ? '保存中...' : '保存配置'}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <Modal open={!!notePreviewAccount} onOpenChange={(open) => !open && closeNoteDialog()}>
                <ModalContent
                    size="full"
                    className={cn(
                        'transition-[max-width,height] duration-200',
                        modalWidthClass,
                        noteViewport === 'full' && 'h-[92vh]'
                    )}
                >
                    <ModalHeader>
                        <div className="flex flex-wrap items-start justify-between gap-4 pr-10">
                            <div>
                                <ModalTitle className="flex items-center gap-2">
                                    <StickyNote className="h-5 w-5 text-primary-600" />
                                    {noteMode === 'edit' ? '编辑账户备注' : '账户备注'}
                                </ModalTitle>
                                {notePreviewAccount && (
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                        <span>{notePreviewAccount.emailAddress}</span>
                                        <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                            {normalizeAccountNoteFormat(previewFormat) === 'html' ? (
                                                <Code2 className="h-3.5 w-3.5" />
                                            ) : (
                                                <FileText className="h-3.5 w-3.5" />
                                            )}
                                            {normalizeAccountNoteFormat(previewFormat) === 'html' ? 'HTML/JS' : 'MARKDOWN'}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    type="button"
                                    variant={noteViewport === 'compact' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => {
                                        setNoteViewport('compact')
                                        setNoteHeight(420)
                                    }}
                                    title="紧凑窗口"
                                >
                                    <Minimize2 className="mr-1.5 h-4 w-4" />
                                    紧凑
                                </Button>
                                <Button
                                    type="button"
                                    variant={noteViewport === 'wide' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => {
                                        setNoteViewport('wide')
                                        setNoteHeight(560)
                                    }}
                                    title="宽屏窗口"
                                >
                                    <Maximize2 className="mr-1.5 h-4 w-4" />
                                    宽屏
                                </Button>
                                <Button
                                    type="button"
                                    variant={noteViewport === 'full' ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => {
                                        setNoteViewport('full')
                                        setNoteHeight(720)
                                    }}
                                    title="全屏预览"
                                >
                                    <Maximize2 className="mr-1.5 h-4 w-4" />
                                    全屏
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={openInternalNoteTab}
                                    disabled={!notePreviewAccount}
                                    title="在系统内置页签查看"
                                >
                                    <StickyNote className="mr-1.5 h-4 w-4" />
                                    内置 Tab
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={openStandaloneNotePreview}
                                    disabled={!notePreviewAccount}
                                    title="在浏览器标签页查看"
                                >
                                    <ExternalLink className="mr-1.5 h-4 w-4" />
                                    浏览器 Tab
                                </Button>
                            </div>
                        </div>
                    </ModalHeader>
                    <ModalBody className={cn('space-y-4', noteViewport === 'full' && 'min-h-0')}>
                        {noteMode === 'preview' ? (
                            <>
                                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/70">
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">预览高度</span>
                                        <input
                                            type="range"
                                            min={320}
                                            max={900}
                                            step={20}
                                            value={noteHeight}
                                            onChange={(event) => setNoteHeight(Number(event.target.value))}
                                            className="w-48 accent-primary-600"
                                        />
                                        <span className="w-12 text-xs tabular-nums text-gray-500 dark:text-gray-400">{noteHeight}px</span>
                                    </div>
                                    <span className="text-xs text-gray-400 dark:text-gray-500">右下角也可拖动调整预览区域</span>
                                </div>
                                <AccountNotePreview
                                    note={previewContent}
                                    format={previewFormat}
                                    className="resize-y overflow-auto"
                                    style={{ height: noteHeight }}
                                />
                            </>
                        ) : (
                            <AccountNoteEditor
                                value={noteDraft}
                                format={noteFormatDraft}
                                onValueChange={setNoteDraft}
                                onFormatChange={setNoteFormatDraft}
                            />
                        )}
                    </ModalBody>
                    <ModalFooter>
                        {noteMode === 'preview' ? (
                            <>
                                <Button variant="outline" onClick={closeNoteDialog}>
                                    关闭
                                </Button>
                                <Button onClick={() => setNoteMode('edit')}>
                                    <Edit2 className="mr-2 h-4 w-4" />
                                    编辑备注
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button variant="outline" onClick={() => setNoteMode('preview')} disabled={noteSaving}>
                                    取消
                                </Button>
                                <Button onClick={saveNote} disabled={noteSaving}>
                                    <Save className="mr-2 h-4 w-4" />
                                    {noteSaving ? '保存中...' : '保存备注'}
                                </Button>
                            </>
                        )}
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    )
}
