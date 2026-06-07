'use client'

import React from 'react'
import { AlertCircle, ExternalLink, Loader2, X } from 'lucide-react'
import EmailPreviewPanel from '@/components/mailbox/email-preview-panel'
import { cn } from '@/lib/utils'
import { Email } from '@/types'

interface EmailQuickPreviewProps {
    email: Email | null
    loading: boolean
    error: string | null
    accountId?: number | null
    accountEmail?: string
    onClose: () => void
    onOpenFull: () => void
    className?: string
    floating?: boolean
}

export default function EmailQuickPreview({
    email,
    loading,
    error,
    accountId,
    accountEmail,
    onClose,
    onOpenFull,
    className,
    floating = true,
}: EmailQuickPreviewProps) {
    return (
        <div
            className={cn(
                "pointer-events-auto h-[min(680px,calc(100vh-5.5rem))] w-[min(620px,calc(100vw-31rem))] min-w-[460px] overflow-hidden rounded-2xl border border-gray-200/90 bg-white shadow-2xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-800",
                floating && "max-[980px]:fixed max-[980px]:left-4 max-[980px]:right-4 max-[980px]:top-20 max-[980px]:h-[calc(100vh-7rem)] max-[980px]:w-auto max-[980px]:min-w-0",
                className
            )}
        >
            <div className="flex h-12 items-center justify-between border-b border-gray-100 px-4 dark:border-gray-700/70">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">邮件快速预览</div>
                    {accountEmail && (
                        <div className="truncate text-xs text-gray-500 dark:text-gray-400">{accountEmail}</div>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={onOpenFull}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30"
                    >
                        <ExternalLink className="h-3.5 w-3.5" />
                        打开邮件
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        title="关闭预览"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>
            <div className="h-[calc(100%-3rem)]">
                {error ? (
                    <div className="flex h-full items-center justify-center p-6">
                        <div className="max-w-sm text-center">
                            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-300">
                                <AlertCircle className="h-6 w-6" />
                            </div>
                            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">预览加载失败</div>
                            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{error}</p>
                            <button
                                type="button"
                                onClick={onOpenFull}
                                className="mt-4 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700"
                            >
                                打开完整邮件
                            </button>
                        </div>
                    </div>
                ) : loading ? (
                    <div className="flex h-full items-center justify-center">
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                            正在加载邮件内容...
                        </div>
                    </div>
                ) : (
                    <EmailPreviewPanel email={email} loading={false} accountId={accountId} />
                )}
            </div>
        </div>
    )
}
