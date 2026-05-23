'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, Clock, Loader2 } from 'lucide-react'
import { emailAccountService } from '@/services/email-account.service'
import { formatDate } from '@/lib/utils'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalTitle,
    ModalDescription
} from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

interface SyncAccountModalProps {
    isOpen: boolean
    onClose: () => void
    accountId: number | null
    accountEmail: string
    onSuccess?: () => void
    onError?: (error: string) => void
}

interface SyncFormData {
    sync_mode: 'incremental' | 'full'
    mailboxes?: string[]
    max_emails_per_mailbox?: number
    include_body?: boolean
    default_start_date?: string
    end_date?: string
}

export default function SyncAccountModal({
    isOpen,
    onClose,
    accountId,
    accountEmail,
    onSuccess,
    onError
}: SyncAccountModalProps) {
    const [loadingLastSync, setLoadingLastSync] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [lastSyncRecord, setLastSyncRecord] = useState<any>(null)

    const getDefaultStartDate = () => {
        const date = new Date()
        date.setMonth(date.getMonth() - 1)
        return date.toISOString().split('T')[0]
    }

    const [formData, setFormData] = useState<SyncFormData>({
        sync_mode: 'incremental',
        max_emails_per_mailbox: 100,
        include_body: true,
        default_start_date: getDefaultStartDate()
    })

    useEffect(() => {
        if (isOpen && accountId) {
            loadLastSyncRecord()
        }
        if (!isOpen) {
            setFormData({
                sync_mode: 'incremental',
                max_emails_per_mailbox: 100,
                include_body: true,
                default_start_date: getDefaultStartDate()
            })
            setLastSyncRecord(null)
        }
    }, [isOpen, accountId])

    const loadLastSyncRecord = async () => {
        if (!accountId) return

        setLoadingLastSync(true)
        try {
            const response = await emailAccountService.getLastSyncRecord(accountId)
            setLastSyncRecord(response)
        } catch (error: any) {
            if (error.response?.status !== 404) {
                console.error('Failed to load last sync record:', error)
            }
        } finally {
            setLoadingLastSync(false)
        }
    }

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault()
        if (!accountId) return

        setSyncing(true)
        try {
            const syncOptions: any = {
                sync_mode: formData.sync_mode,
                max_emails_per_mailbox: formData.max_emails_per_mailbox,
                include_body: formData.include_body
            }

            if (formData.sync_mode === 'full') {
                if (formData.mailboxes && formData.mailboxes.length > 0) {
                    syncOptions.mailboxes = formData.mailboxes
                }
                if (formData.default_start_date) {
                    syncOptions.default_start_date = new Date(formData.default_start_date + 'T00:00:00Z').toISOString()
                }
                if (formData.end_date) {
                    syncOptions.end_date = new Date(formData.end_date + 'T23:59:59Z').toISOString()
                }
            }

            await emailAccountService.syncAccount(accountId, syncOptions)

            onSuccess?.()
            onClose()
        } catch (error: any) {
            console.error('Sync failed:', error)
            onError?.(error.response?.data?.error || '同步失败，请稍后重试')
        } finally {
            setSyncing(false)
        }
    }

    const handleMailboxesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value
        setFormData(prev => ({
            ...prev,
            mailboxes: value ? value.split(',').map(s => s.trim()) : undefined
        }))
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent size="xl">
                <ModalHeader>
                    <div className="flex items-center space-x-3">
                        <RefreshCw className="h-5 w-5 text-primary-600" />
                        <div>
                            <ModalTitle>同步邮箱</ModalTitle>
                            <ModalDescription>
                                正在同步账户：{accountEmail}
                            </ModalDescription>
                        </div>
                    </div>
                </ModalHeader>

                <ModalBody className="space-y-6">
                    {/* 同步模式选择 */}
                    <div>
                        <Label className="mb-3 block">选择同步模式</Label>
                        <div className="space-y-3">
                            <label className="flex cursor-pointer items-start rounded-lg border border-gray-200 p-4 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/50">
                                <input
                                    type="radio"
                                    name="sync_mode"
                                    value="incremental"
                                    checked={formData.sync_mode === 'incremental'}
                                    onChange={() => setFormData(prev => ({ ...prev, sync_mode: 'incremental' }))}
                                    className="mt-1"
                                />
                                <div className="ml-3">
                                    <div className="font-medium text-gray-900 dark:text-white">
                                        增量同步（推荐）
                                    </div>
                                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        仅同步自上次同步以来的新邮件，速度快，适合日常使用
                                    </div>
                                    {formData.sync_mode === 'incremental' && lastSyncRecord?.last_sync_time && (
                                        <div className="mt-3 flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                                            <Clock className="h-4 w-4" />
                                            <span>上次同步时间：{formatDate(lastSyncRecord.last_sync_time)}</span>
                                        </div>
                                    )}
                                    {formData.sync_mode === 'incremental' && !lastSyncRecord && !loadingLastSync && (
                                        <div className="mt-3 flex items-center space-x-2 text-sm text-amber-600 dark:text-amber-400">
                                            <AlertCircle className="h-4 w-4" />
                                            <span>从未同步过，将自动执行全量同步</span>
                                        </div>
                                    )}
                                </div>
                            </label>

                            <label className="flex cursor-pointer items-start rounded-lg border border-gray-200 p-4 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900/50">
                                <input
                                    type="radio"
                                    name="sync_mode"
                                    value="full"
                                    checked={formData.sync_mode === 'full'}
                                    onChange={() => setFormData(prev => ({ ...prev, sync_mode: 'full' }))}
                                    className="mt-1"
                                />
                                <div className="ml-3">
                                    <div className="font-medium text-gray-900 dark:text-white">
                                        全量同步
                                    </div>
                                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                        重新同步所有邮件，适用于首次同步或需要完整更新时
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* 全量同步的额外选项 */}
                    {formData.sync_mode === 'full' && (
                        <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
                            <h3 className="font-medium text-gray-900 dark:text-white">
                                全量同步选项
                            </h3>

                            <div className="space-y-2">
                                <Label>邮箱文件夹（可选）</Label>
                                <Input
                                    type="text"
                                    placeholder="例如：INBOX,Sent,Drafts（留空同步所有文件夹）"
                                    onChange={handleMailboxesChange}
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    多个文件夹用英文逗号分隔
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>每个文件夹最大邮件数</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={10000}
                                    value={formData.max_emails_per_mailbox}
                                    onChange={(e) => setFormData(prev => ({
                                        ...prev,
                                        max_emails_per_mailbox: parseInt(e.target.value) || 100
                                    }))}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>开始日期（可选）</Label>
                                    <Input
                                        type="date"
                                        value={formData.default_start_date || ''}
                                        onChange={(e) => setFormData(prev => ({
                                            ...prev,
                                            default_start_date: e.target.value || undefined
                                        }))}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>结束日期（可选）</Label>
                                    <Input
                                        type="date"
                                        value={formData.end_date || ''}
                                        onChange={(e) => setFormData(prev => ({
                                            ...prev,
                                            end_date: e.target.value || undefined
                                        }))}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    id="include_body"
                                    checked={formData.include_body}
                                    onChange={(e) => setFormData(prev => ({
                                        ...prev,
                                        include_body: e.target.checked
                                    }))}
                                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                />
                                <label htmlFor="include_body" className="text-sm text-gray-700 dark:text-gray-300">
                                    包含邮件正文内容
                                </label>
                            </div>
                        </div>
                    )}
                </ModalBody>

                <ModalFooter>
                    <Button variant="outline" onClick={onClose} disabled={syncing}>
                        取消
                    </Button>
                    <Button onClick={() => handleSubmit()} disabled={syncing || !accountId}>
                        {syncing ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                同步中...
                            </>
                        ) : (
                            <>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                开始同步
                            </>
                        )}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}
