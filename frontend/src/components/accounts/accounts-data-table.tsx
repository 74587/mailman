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
} from 'lucide-react'
import { DataTable, createSelectColumn } from '@/components/ui/data-table'
import { AdaptiveActions, ActionItem } from '@/components/ui/adaptive-actions'
import { InlineTagSelector } from '@/components/tags/tag-selector'
import { GmailIcon, OutlookIcon } from '@/components/ui/brand-icons'
import { EmailAccount } from '@/types'
import { cn } from '@/lib/utils'

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
    // 状态
    syncingId?: number
    verifyingId?: number
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
    syncingId,
    verifyingId,
    sorting,
    onSortingChange,
}: AccountsDataTableProps) {
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
                size: 130,
                enableSorting: false,
                cell: ({ row }) => (
                    <InlineTagSelector
                        accountId={row.original.id}
                        currentTags={row.original.tags || []}
                        onTagsChange={onTagsChange}
                        size="sm"
                    />
                ),
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
        [syncingId, verifyingId, onViewEmails, onPickupMail, onSync, onVerify, onEdit, onDelete, onOAuth2Config, onTagsChange]
    )

    return (
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
    )
}
