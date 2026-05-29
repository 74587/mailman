'use client'

import * as React from 'react'
import { ColumnDef, RowSelectionState, SortingState } from '@tanstack/react-table'
import {
    Mail,
    RefreshCw,
    Edit2,
    Trash2,
    Shield,
    ShieldCheck,
    Settings,
    Inbox,
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
import { emailAccountService } from '@/services/email-account.service'
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
    const columns = React.useMemo<ColumnDef<EmailAccount, unknown>[]>(
        () => [
            // 选择列
            createSelectColumn<EmailAccount>(),

            // 邮箱地址
            {
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
        [syncingId, verifyingId, syncStatuses, openNoteDialog, onViewEmails, onPickupMail, onSync, onVerify, onEdit, onDelete, onOAuth2Config, onTagsChange]
    )

    return (
        <>
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
