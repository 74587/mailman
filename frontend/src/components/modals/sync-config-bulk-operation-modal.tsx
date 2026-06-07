'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    CheckCircle,
    Clock,
    Loader2,
    Minus,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Trash2,
    Users,
    XCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Modal,
    ModalBody,
    ModalContent,
    ModalDescription,
    ModalFooter,
    ModalHeader,
    ModalTitle
} from '@/components/ui/modal'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { emailAccountService } from '@/services/email-account.service'
import { syncConfigService } from '@/services/sync-config.service'
import type { AccountSyncStatus, BatchSyncConfigResponse } from '@/services/sync-config.service'
import type { EmailAccount } from '@/types'
import { cn } from '@/lib/utils'

type MatchType = 'all' | 'include' | 'exclude'
type SelectedAccountMap = Record<number, EmailAccount>

interface SyncConfigBulkOperationModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
}

const SYNC_INTERVALS = [
    { value: 30, label: '30秒' },
    { value: 60, label: '1分钟' },
    { value: 300, label: '5分钟' },
    { value: 600, label: '10分钟' },
    { value: 1800, label: '30分钟' },
    { value: 3600, label: '1小时' },
    { value: 21600, label: '6小时' }
]

const MATCH_OPTIONS: Array<{ value: MatchType; label: string; description: string }> = [
    { value: 'all', label: '全部账户', description: '更新当前组织下所有账户' },
    { value: 'exclude', label: '排除账户', description: '除所选账户外全部更新' },
    { value: 'include', label: '包含账户', description: '只更新挑选的账户' }
]

function formatInterval(seconds: number) {
    if (seconds < 60) return `${seconds}秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
    return `${Math.floor(seconds / 3600)}小时`
}

function accountStatusLabel(account: EmailAccount) {
    if (!account.isVerified) {
        return { label: '未验证', className: 'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/50 dark:bg-yellow-900/20 dark:text-yellow-300' }
    }
    if (account.errorStatus && account.errorStatus !== 'normal') {
        return { label: '异常', className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300' }
    }
    return { label: '正常', className: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300' }
}

function syncStatusLabel(status?: AccountSyncStatus) {
    if (!status) {
        return { label: '未知', className: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300' }
    }
    if (status.auto_disabled) {
        return { label: '自动禁用', className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300' }
    }
    if (status.sync_status === 'not_configured') {
        return { label: '未配置', className: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300' }
    }
    if (status.sync_status === 'syncing' || status.is_running) {
        return { label: '同步中', className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300' }
    }
    if (status.sync_status === 'error') {
        return { label: '错误', className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300' }
    }
    if (!status.enable_auto_sync) {
        return { label: '已暂停', className: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300' }
    }
    return { label: '已启用', className: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300' }
}

export default function SyncConfigBulkOperationModal({ isOpen, onClose, onSuccess }: SyncConfigBulkOperationModalProps) {
    const [matchType, setMatchType] = useState<MatchType>('all')
    const [selectedAccounts, setSelectedAccounts] = useState<SelectedAccountMap>({})
    const [selectorOpen, setSelectorOpen] = useState(false)
    const [enableAutoSync, setEnableAutoSync] = useState(true)
    const [syncInterval, setSyncInterval] = useState(300)
    const [useCustomInterval, setUseCustomInterval] = useState(false)
    const [customInterval, setCustomInterval] = useState('')
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<BatchSyncConfigResponse | null>(null)

    const selectedList = useMemo(() => Object.values(selectedAccounts), [selectedAccounts])

    const resetForm = useCallback(() => {
        setMatchType('all')
        setSelectedAccounts({})
        setSelectorOpen(false)
        setEnableAutoSync(true)
        setSyncInterval(300)
        setUseCustomInterval(false)
        setCustomInterval('')
        setLoading(false)
        setResult(null)
    }, [])

    useEffect(() => {
        if (isOpen) resetForm()
    }, [isOpen, resetForm])

    const close = () => {
        resetForm()
        onClose()
    }

    const handleMatchTypeChange = (value: string) => {
        const next = value as MatchType
        setMatchType(next)
        if (next === 'all') {
            setSelectedAccounts({})
        } else {
            setSelectorOpen(true)
        }
    }

    const resolveInterval = () => {
        if (!useCustomInterval) return syncInterval

        const value = Number(customInterval)
        if (!Number.isFinite(value) || value < 30) {
            return null
        }
        return Math.floor(value)
    }

    const handleSubmit = async () => {
        const interval = resolveInterval()
        if (!interval) {
            toast.warning('自定义间隔必须大于等于30秒')
            return
        }
        if (matchType === 'include' && selectedList.length === 0) {
            toast.warning('请选择需要包含的账户')
            return
        }

        try {
            setLoading(true)
            const response = await syncConfigService.bulkApplyAccountSyncConfig({
                match_type: matchType,
                account_ids: matchType === 'all' ? [] : selectedList.map(account => account.id),
                enable_auto_sync: enableAutoSync,
                sync_interval: interval,
                sync_folders: ['INBOX']
            })
            setResult(response)
            if (response.error_count === 0) {
                toast.success(`已更新 ${response.success_count} 个账户的同步配置`)
                onSuccess()
            } else {
                toast.warning(`已更新 ${response.success_count} 个账户，${response.error_count} 个失败`)
            }
        } catch (error) {
            console.error('Failed to apply bulk sync config:', error)
            toast.error('批量更新同步配置失败')
        } finally {
            setLoading(false)
        }
    }

    const selectedSummary = matchType === 'all'
        ? '将更新当前组织下的全部账户'
        : matchType === 'include'
            ? `将只更新已挑选的 ${selectedList.length} 个账户`
            : `将更新全部账户，并排除已挑选的 ${selectedList.length} 个账户`
    const currentInterval = resolveInterval() || syncInterval

    return (
        <>
            <Modal open={isOpen} onOpenChange={(open) => !open && close()}>
                <ModalContent size="2xl" className="max-w-[760px]" preventClose={loading}>
                    <ModalHeader className="px-6 py-5">
                        <ModalTitle className="flex items-center gap-2 text-lg">
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-300">
                                <SlidersHorizontal className="h-4 w-4" />
                            </span>
                            批量同步设置
                        </ModalTitle>
                        <ModalDescription>按账户范围统一调整自动同步开关和同步间隔。</ModalDescription>
                    </ModalHeader>

                    <ModalBody className="space-y-5 bg-gray-50/50 p-5 dark:bg-gray-950/20">
                        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <Label className="text-sm font-semibold text-gray-900 dark:text-white">目标账户</Label>
                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{selectedSummary}</p>
                                </div>
                                {matchType !== 'all' && (
                                    <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setSelectorOpen(true)}>
                                        <Users className="mr-1.5 h-3.5 w-3.5" />
                                        编辑名单
                                    </Button>
                                )}
                            </div>

                            <div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
                                {MATCH_OPTIONS.map(option => {
                                    const active = matchType === option.value
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => handleMatchTypeChange(option.value)}
                                            className={cn(
                                                'rounded-lg px-3 py-2 text-left transition-all',
                                                active
                                                    ? 'bg-white text-primary-700 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:text-primary-300 dark:ring-gray-700'
                                                    : 'text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-900/50'
                                            )}
                                        >
                                            <span className="block text-sm font-semibold">{option.label}</span>
                                            <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-gray-400">{option.description}</span>
                                        </button>
                                    )
                                })}
                            </div>

                            {matchType !== 'all' && (
                                <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/60">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                                            已挑选 {selectedList.length} 个账户
                                        </div>
                                        <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                                            {selectedList.length > 0
                                                ? selectedList.slice(0, 3).map(account => account.emailAddress).join('，') + (selectedList.length > 3 ? ` 等 ${selectedList.length} 个` : '')
                                                : '还没有选择账户'}
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="shrink-0 rounded-md bg-white px-2 py-1 text-xs dark:bg-gray-900">
                                        {matchType === 'include' ? '只包含' : '将排除'}
                                    </Badge>
                                </div>
                            )}
                        </section>

                        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <Label className="text-sm font-semibold text-gray-900 dark:text-white">同步设置</Label>
                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                        保存后会覆盖目标账户现有的同步开关和间隔。
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 dark:bg-gray-800">
                                    <span className={cn('h-2 w-2 rounded-full', enableAutoSync ? 'bg-green-500' : 'bg-gray-400')} />
                                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                        {enableAutoSync ? '自动同步开启' : '自动同步暂停'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-3 dark:bg-gray-800/60">
                                <div>
                                    <div className="text-sm font-medium text-gray-900 dark:text-white">自动同步</div>
                                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                        {enableAutoSync ? '目标账户将按设定间隔自动拉取邮件' : '目标账户将停止自动拉取邮件'}
                                    </div>
                                </div>
                                <Switch checked={enableAutoSync} onCheckedChange={setEnableAutoSync} />
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium text-gray-900 dark:text-white">同步间隔</div>
                                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{formatInterval(currentInterval)}</div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {SYNC_INTERVALS.map(interval => {
                                        const active = !useCustomInterval && syncInterval === interval.value
                                        return (
                                            <button
                                                key={interval.value}
                                                type="button"
                                                onClick={() => {
                                                    setSyncInterval(interval.value)
                                                    setUseCustomInterval(false)
                                                }}
                                                className={cn(
                                                    'h-9 min-w-[76px] rounded-lg border px-3 text-sm font-medium transition-colors',
                                                    active
                                                        ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                                                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
                                                )}
                                            >
                                                {interval.label}
                                            </button>
                                        )
                                    })}
                                </div>
                                <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/60">
                                    <Checkbox checked={useCustomInterval} onChange={event => setUseCustomInterval(event.target.checked)} />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">自定义</span>
                                    <Input
                                        type="number"
                                        min={30}
                                        value={customInterval}
                                        onChange={event => {
                                            setCustomInterval(event.target.value)
                                            setUseCustomInterval(true)
                                        }}
                                        placeholder="300"
                                        className="h-9 w-24"
                                    />
                                    <span className="text-sm text-gray-500">秒</span>
                                </div>
                            </div>
                        </section>

                        {result && (
                            <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
                                <div className="flex items-center gap-3">
                                    {result.error_count > 0 ? (
                                        <XCircle className="h-5 w-5 text-red-500" />
                                    ) : (
                                        <CheckCircle className="h-5 w-5 text-green-500" />
                                    )}
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                                            成功 {result.success_count} 个，失败 {result.error_count} 个
                                        </p>
                                        {typeof result.target_count === 'number' && (
                                            <p className="text-xs text-gray-500">目标账户 {result.target_count} 个</p>
                                        )}
                                    </div>
                                </div>
                                {result.errors.length > 0 && (
                                    <div className="max-h-36 space-y-2 overflow-y-auto">
                                        {result.errors.map(error => (
                                            <div key={`${error.account_id}-${error.error}`} className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs dark:border-red-900/40 dark:bg-red-900/20">
                                                <div className="font-medium text-red-700 dark:text-red-300">{error.email_address || `#${error.account_id}`}</div>
                                                <div className="mt-0.5 text-red-600 dark:text-red-400">{error.error}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </ModalBody>

                    <ModalFooter>
                        <Button variant="outline" onClick={close} disabled={loading}>
                            {result ? '关闭' : '取消'}
                        </Button>
                        <Button onClick={handleSubmit} disabled={loading || (matchType === 'include' && selectedList.length === 0)}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {loading ? '保存中...' : '保存批量设置'}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <AccountSelectionModal
                isOpen={selectorOpen}
                selectedAccounts={selectedAccounts}
                mode={matchType}
                onClose={() => setSelectorOpen(false)}
                onApply={accounts => {
                    setSelectedAccounts(accounts)
                    setSelectorOpen(false)
                }}
            />
        </>
    )
}

function AccountSelectionModal({
    isOpen,
    selectedAccounts,
    mode,
    onClose,
    onApply
}: {
    isOpen: boolean
    selectedAccounts: SelectedAccountMap
    mode: MatchType
    onClose: () => void
    onApply: (accounts: SelectedAccountMap) => void
}) {
    const [draftSelected, setDraftSelected] = useState<SelectedAccountMap>({})
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [statuses, setStatuses] = useState<Record<number, AccountSyncStatus>>({})
    const [loading, setLoading] = useState(false)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [total, setTotal] = useState(0)
    const [search, setSearch] = useState('')
    const [verifiedFilter, setVerifiedFilter] = useState('all')

    const selectedList = useMemo(() => Object.values(draftSelected), [draftSelected])

    const loadAccounts = useCallback(async () => {
        if (!isOpen) return

        setLoading(true)
        try {
            const response = await emailAccountService.getAccountsPaginated({
                page,
                limit: 20,
                sort_by: 'emailAddress',
                sort_order: 'asc',
                search: search.trim() || undefined,
                is_verified: verifiedFilter === 'all' ? undefined : verifiedFilter === 'verified'
            })

            const pageAccounts = response.data || []
            setAccounts(pageAccounts)
            setTotal(response.total || 0)
            setTotalPages(response.total_pages || 1)

            const ids = pageAccounts.map(account => account.id)
            if (ids.length > 0) {
                try {
                    const statusRows = await syncConfigService.getAccountSyncStatuses(ids)
                    const nextStatuses: Record<number, AccountSyncStatus> = {}
                    statusRows.forEach(status => {
                        nextStatuses[status.account_id] = status
                    })
                    setStatuses(nextStatuses)
                } catch (error) {
                    console.warn('Failed to load account sync statuses:', error)
                    setStatuses({})
                }
            } else {
                setStatuses({})
            }
        } catch (error) {
            console.error('Failed to load accounts:', error)
            toast.error('加载账户列表失败')
        } finally {
            setLoading(false)
        }
    }, [isOpen, page, search, verifiedFilter])

    useEffect(() => {
        if (isOpen) {
            setDraftSelected(selectedAccounts)
            setPage(1)
        }
    }, [isOpen, selectedAccounts])

    useEffect(() => {
        loadAccounts()
    }, [loadAccounts])

    const toggleAccount = (account: EmailAccount) => {
        setDraftSelected(prev => {
            const next = { ...prev }
            if (next[account.id]) {
                delete next[account.id]
            } else {
                next[account.id] = account
            }
            return next
        })
    }

    const allPageSelected = accounts.length > 0 && accounts.every(account => draftSelected[account.id])

    const togglePage = () => {
        setDraftSelected(prev => {
            const next = { ...prev }
            if (allPageSelected) {
                accounts.forEach(account => {
                    delete next[account.id]
                })
            } else {
                accounts.forEach(account => {
                    next[account.id] = account
                })
            }
            return next
        })
    }

    const modeLabel = mode === 'exclude' ? '排除账户' : '包含账户'

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent
                size="full"
                className="z-[70] h-[86vh] max-w-[1180px]"
                overlayClassName="z-[60]"
            >
                <ModalHeader className="py-4">
                    <ModalTitle>{modeLabel}</ModalTitle>
                    <ModalDescription>左侧筛选账户，右侧确认已挑选列表。</ModalDescription>
                </ModalHeader>

                <ModalBody className="min-h-0 p-0">
                    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] divide-x divide-gray-200 dark:divide-gray-700">
                        <div className="flex min-h-0 flex-col">
                            <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3 dark:border-gray-700">
                                <div className="relative min-w-[260px] flex-1">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                    <Input
                                        value={search}
                                        onChange={event => {
                                            setSearch(event.target.value)
                                            setPage(1)
                                        }}
                                        placeholder="搜索邮箱地址..."
                                        className="h-9 pl-9"
                                    />
                                </div>
                                <Select
                                    value={verifiedFilter}
                                    onValueChange={value => {
                                        setVerifiedFilter(value)
                                        setPage(1)
                                    }}
                                >
                                    <SelectTrigger className="h-9 w-[120px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">全部验证</SelectItem>
                                        <SelectItem value="verified">已验证</SelectItem>
                                        <SelectItem value="unverified">未验证</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button variant="outline" size="sm" className="h-9" onClick={loadAccounts} disabled={loading}>
                                    <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
                                    刷新
                                </Button>
                            </div>

                            <div className="min-h-0 flex-1 overflow-auto">
                                <table className="w-full min-w-[760px]">
                                    <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                                        <tr className="border-b border-gray-200 dark:border-gray-700">
                                            <th className="w-10 px-3 py-3 text-left">
                                                <Checkbox checked={allPageSelected} onChange={togglePage} />
                                            </th>
                                            <th className="px-3 py-3 text-left font-medium">邮箱地址</th>
                                            <th className="px-3 py-3 text-left font-medium">标签</th>
                                            <th className="px-3 py-3 text-left font-medium">验证状态</th>
                                            <th className="px-3 py-3 text-left font-medium">状态</th>
                                            <th className="px-3 py-3 text-left font-medium">同步配置状态</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading && accounts.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-16 text-center text-sm text-gray-500">
                                                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                                                    加载账户...
                                                </td>
                                            </tr>
                                        ) : accounts.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-16 text-center text-sm text-gray-500">暂无账户</td>
                                            </tr>
                                        ) : (
                                            accounts.map(account => {
                                                const selected = Boolean(draftSelected[account.id])
                                                const accountStatus = accountStatusLabel(account)
                                                const syncStatus = syncStatusLabel(statuses[account.id])
                                                return (
                                                    <tr
                                                        key={account.id}
                                                        className={cn(
                                                            'border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50',
                                                            selected && 'bg-primary-50/70 dark:bg-primary-900/10'
                                                        )}
                                                    >
                                                        <td className="px-3 py-3">
                                                            <Checkbox checked={selected} onChange={() => toggleAccount(account)} />
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <div className="min-w-0">
                                                                <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{account.emailAddress}</div>
                                                                <div className="text-xs text-gray-500">{account.mailProvider?.name || account.authType}</div>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <div className="flex max-w-[190px] flex-wrap gap-1">
                                                                {(account.tags || []).slice(0, 3).map(tag => (
                                                                    <span
                                                                        key={tag.id}
                                                                        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset"
                                                                        style={{
                                                                            color: tag.color || undefined,
                                                                            borderColor: tag.color || undefined,
                                                                            backgroundColor: tag.color ? `${tag.color}14` : undefined
                                                                        }}
                                                                    >
                                                                        {tag.name}
                                                                    </span>
                                                                ))}
                                                                {(account.tags || []).length > 3 && <span className="text-xs text-gray-400">+{(account.tags || []).length - 3}</span>}
                                                                {(!account.tags || account.tags.length === 0) && <span className="text-xs text-gray-400">无</span>}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <Badge variant="outline" className={cn('rounded-full', account.isVerified ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-300' : 'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900/50 dark:bg-yellow-900/20 dark:text-yellow-300')}>
                                                                {account.isVerified ? '已验证' : '未验证'}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <Badge variant="outline" className={cn('rounded-full', accountStatus.className)}>
                                                                {accountStatus.label}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-3 py-3">
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="outline" className={cn('rounded-full', syncStatus.className)}>
                                                                    {syncStatus.label}
                                                                </Badge>
                                                                {statuses[account.id]?.sync_interval > 0 && (
                                                                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                                                                        <Clock className="h-3 w-3" />
                                                                        {formatInterval(statuses[account.id].sync_interval)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex items-center justify-between border-t border-gray-200 p-3 text-sm dark:border-gray-700">
                                <span className="text-gray-500">
                                    第 {page} / {totalPages} 页，共 {total} 个账户
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(value => Math.max(1, value - 1))}>
                                        上一页
                                    </Button>
                                    <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>
                                        下一页
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="flex min-h-0 flex-col bg-gray-50/70 dark:bg-gray-900/40">
                            <div className="flex items-center justify-between border-b border-gray-200 p-3 dark:border-gray-700">
                                <div>
                                    <div className="text-sm font-medium text-gray-900 dark:text-white">已挑选账户</div>
                                    <div className="text-xs text-gray-500">{selectedList.length} 个</div>
                                </div>
                                {selectedList.length > 0 && (
                                    <Button size="sm" variant="ghost" className="h-8 text-gray-500" onClick={() => setDraftSelected({})}>
                                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                        清空
                                    </Button>
                                )}
                            </div>
                            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                                {selectedList.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700">
                                        从左侧表格选择账户
                                    </div>
                                ) : (
                                    selectedList.map(account => (
                                        <div key={account.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{account.emailAddress}</div>
                                                <div className="text-xs text-gray-500">{account.mailProvider?.name || account.authType}</div>
                                            </div>
                                            <button
                                                type="button"
                                                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                                                onClick={() => {
                                                    setDraftSelected(prev => {
                                                        const next = { ...prev }
                                                        delete next[account.id]
                                                        return next
                                                    })
                                                }}
                                            >
                                                <Minus className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </ModalBody>

                <ModalFooter className="py-4">
                    <Button variant="outline" onClick={onClose}>取消</Button>
                    <Button onClick={() => onApply(draftSelected)}>
                        <Plus className="mr-1.5 h-4 w-4" />
                        应用选择
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}
