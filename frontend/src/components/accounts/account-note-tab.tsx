'use client'

import * as React from 'react'
import {
    ArrowLeft,
    Code2,
    ExternalLink,
    FileText,
    Loader2,
    RefreshCw,
    Save,
    StickyNote,
} from 'lucide-react'
import { toast } from 'sonner'
import { AccountNoteFormat, EmailAccount } from '@/types'
import { emailAccountService } from '@/services/email-account.service'
import { cn } from '@/lib/utils'
import {
    registerRefreshCallback,
    registerTabCallback,
    unregisterRefreshCallback,
    unregisterTabCallback,
} from '@/lib/tab-utils'
import { AccountNoteEditor } from './account-note-editor'
import {
    AccountNotePreview,
    normalizeAccountNoteFormat,
    openAccountNoteStandalonePreview,
} from './account-note-preview'

type NoteViewMode = 'preview' | 'edit' | 'split'

interface AccountNoteTabProps {
    tabId: string
}

function getAccountIdFromTabId(tabId: string) {
    const id = Number(tabId.replace('account-note-', ''))
    return Number.isFinite(id) ? id : null
}

export default function AccountNoteTab({ tabId }: AccountNoteTabProps) {
    const initialAccountId = React.useMemo(() => getAccountIdFromTabId(tabId), [tabId])
    const [accountId, setAccountId] = React.useState<number | null>(initialAccountId)
    const [account, setAccount] = React.useState<EmailAccount | null>(null)
    const [note, setNote] = React.useState('')
    const [noteFormat, setNoteFormat] = React.useState<AccountNoteFormat>('markdown')
    const [viewMode, setViewMode] = React.useState<NoteViewMode>('preview')
    const [previewHeight, setPreviewHeight] = React.useState(680)
    const [loading, setLoading] = React.useState(false)
    const [saving, setSaving] = React.useState(false)

    const loadAccount = React.useCallback(async (id = accountId) => {
        if (!id) return

        setLoading(true)
        try {
            const data = await emailAccountService.getAccount(id)
            setAccount(data)
            setAccountId(data.id)
            setNote(data.note || '')
            setNoteFormat(normalizeAccountNoteFormat(data.noteFormat))
        } catch (error: any) {
            toast.error(error.message || '加载账户备注失败')
        } finally {
            setLoading(false)
        }
    }, [accountId])

    const handleIncomingData = React.useCallback((data: any) => {
        const incomingAccount: EmailAccount | undefined = data?.account
        const incomingAccountId = data?.accountId || incomingAccount?.id || initialAccountId

        if (incomingAccount) {
            setAccount(incomingAccount)
            setAccountId(incomingAccount.id)
            setNote(incomingAccount.note || '')
            setNoteFormat(normalizeAccountNoteFormat(incomingAccount.noteFormat))
        } else if (incomingAccountId) {
            setAccountId(incomingAccountId)
            loadAccount(incomingAccountId)
        }

        if (data?.mode === 'edit' || data?.mode === 'preview' || data?.mode === 'split') {
            setViewMode(data.mode)
        }
    }, [initialAccountId, loadAccount])

    React.useEffect(() => {
        registerTabCallback(tabId, 'onReady', handleIncomingData)
        registerRefreshCallback(tabId, () => loadAccount())
        window.dispatchEvent(new CustomEvent('tabCallbackRegistered', {
            detail: { tabId, callbackName: 'onReady' },
        }))

        return () => {
            unregisterTabCallback(tabId, 'onReady')
            unregisterRefreshCallback(tabId)
        }
    }, [handleIncomingData, loadAccount, tabId])

    React.useEffect(() => {
        if (!account && initialAccountId) {
            loadAccount(initialAccountId)
        }
    }, [account, initialAccountId, loadAccount])

    const saveNote = async () => {
        if (!accountId) return

        setSaving(true)
        try {
            const updated = await emailAccountService.updateAccount(accountId, {
                id: accountId,
                note,
                note_format: noteFormat,
            })
            setAccount(updated)
            setNote(updated.note || '')
            setNoteFormat(normalizeAccountNoteFormat(updated.noteFormat))
            setViewMode('preview')
            toast.success('备注已保存')
        } catch (error: any) {
            toast.error(error.message || '保存备注失败')
        } finally {
            setSaving(false)
        }
    }

    const openAccountsTab = () => {
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: { tab: 'accounts' },
        }))
    }

    const openBrowserPreview = () => {
        openAccountNoteStandalonePreview({
            note,
            format: noteFormat,
            title: `${account?.emailAddress || '账户'} 备注`,
        })
    }

    return (
        <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
            <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <button
                            type="button"
                            onClick={openAccountsTab}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                            title="返回邮箱账户管理"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-300">
                            <StickyNote className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-white">
                                账户备注
                            </h2>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                <span className="truncate">{account?.emailAddress || (accountId ? `账户 #${accountId}` : '未选择账户')}</span>
                                <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                    {noteFormat === 'html' ? <Code2 className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                                    {noteFormat === 'html' ? 'HTML/JS' : 'Markdown'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                            {(['preview', 'edit', 'split'] as NoteViewMode[]).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setViewMode(mode)}
                                    className={cn(
                                        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                                        viewMode === mode
                                            ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                                            : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                                    )}
                                >
                                    {mode === 'preview' ? '预览' : mode === 'edit' ? '编辑' : '分屏'}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => loadAccount()}
                            disabled={loading}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                            刷新
                        </button>
                        <button
                            type="button"
                            onClick={openBrowserPreview}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                            <ExternalLink className="h-4 w-4" />
                            浏览器 Tab
                        </button>
                        <button
                            type="button"
                            onClick={saveNote}
                            disabled={saving || !accountId}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {saving ? '保存中' : '保存'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-6">
                {loading && !account ? (
                    <div className="flex h-full items-center justify-center text-gray-400">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        加载账户备注...
                    </div>
                ) : viewMode === 'preview' ? (
                    <div className="mx-auto max-w-6xl space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">预览高度</span>
                                <input
                                    type="range"
                                    min={420}
                                    max={1200}
                                    step={20}
                                    value={previewHeight}
                                    onChange={(event) => setPreviewHeight(Number(event.target.value))}
                                    className="w-56 accent-primary-600"
                                />
                                <span className="w-14 text-xs tabular-nums text-gray-500 dark:text-gray-400">{previewHeight}px</span>
                            </div>
                            <span className="text-xs text-gray-400 dark:text-gray-500">预览区域右下角可继续拖动调整</span>
                        </div>
                        <AccountNotePreview
                            note={note}
                            format={noteFormat}
                            className="resize-y overflow-auto shadow-sm"
                            style={{ height: previewHeight }}
                        />
                    </div>
                ) : viewMode === 'edit' ? (
                    <div className="mx-auto max-w-6xl rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                        <AccountNoteEditor
                            value={note}
                            format={noteFormat}
                            onValueChange={setNote}
                            onFormatChange={setNoteFormat}
                        />
                    </div>
                ) : (
                    <div className="grid h-full min-h-[680px] gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <div className="min-h-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                            <AccountNoteEditor
                                value={note}
                                format={noteFormat}
                                onValueChange={setNote}
                                onFormatChange={setNoteFormat}
                            />
                        </div>
                        <AccountNotePreview
                            note={note}
                            format={noteFormat}
                            className="h-full min-h-[640px] shadow-sm"
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
