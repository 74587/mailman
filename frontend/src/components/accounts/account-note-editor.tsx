'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Code2, FileText, Loader2 } from 'lucide-react'
import { AccountNoteFormat } from '@/types'
import { cn } from '@/lib/utils'
import { AccountNotePreview, normalizeAccountNoteFormat } from './account-note-preview'

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), {
    ssr: false,
    loading: () => (
        <div className="flex h-56 items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-800">
            <Loader2 className="h-4 w-4 animate-spin" />
        </div>
    ),
})

interface AccountNoteEditorProps {
    value: string
    format: AccountNoteFormat
    onValueChange: (value: string) => void
    onFormatChange: (format: AccountNoteFormat) => void
    className?: string
}

export function AccountNoteEditor({
    value,
    format,
    onValueChange,
    onFormatChange,
    className,
}: AccountNoteEditorProps) {
    const normalizedFormat = normalizeAccountNoteFormat(format)

    return (
        <div className={cn('space-y-3', className)}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    账户备注
                </label>
                <div className="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                    <button
                        type="button"
                        onClick={() => onFormatChange('markdown')}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                            normalizedFormat === 'markdown'
                                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                        )}
                    >
                        <FileText className="h-3.5 w-3.5" />
                        Markdown
                    </button>
                    <button
                        type="button"
                        onClick={() => onFormatChange('html')}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                            normalizedFormat === 'html'
                                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                        )}
                    >
                        <Code2 className="h-3.5 w-3.5" />
                        HTML/JS
                    </button>
                </div>
            </div>

            {normalizedFormat === 'markdown' ? (
                <div data-color-mode="light" className="overflow-hidden rounded border border-gray-200 dark:border-gray-700">
                    <MDEditor
                        value={value}
                        onChange={(nextValue) => onValueChange(nextValue || '')}
                        height={260}
                        preview="live"
                        hideToolbar={false}
                    />
                </div>
            ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                    <textarea
                        value={value}
                        onChange={(event) => onValueChange(event.target.value)}
                        className="min-h-[260px] w-full resize-y rounded border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                        placeholder="<section><h2>账户用途</h2><button onclick=&quot;alert('ok')&quot;>测试</button></section>"
                    />
                    <AccountNotePreview
                        note={value}
                        format="html"
                        className="min-h-[260px]"
                        emptyText="预览为空"
                    />
                </div>
            )}
        </div>
    )
}
