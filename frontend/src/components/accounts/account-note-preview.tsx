'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import { AccountNoteFormat } from '@/types'
import { cn } from '@/lib/utils'

interface MarkdownPreviewProps {
    source: string
    className?: string
}

const MarkdownPreview = dynamic<MarkdownPreviewProps>(
    async () => {
        const mod = await import('@uiw/react-md-editor')
        const Markdown = mod.default.Markdown
        return function MarkdownPreviewComponent({ source, className }: MarkdownPreviewProps) {
            return <Markdown source={source} className={className} />
        }
    },
    {
        ssr: false,
        loading: () => (
            <div className="flex min-h-24 items-center justify-center text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
            </div>
        ),
    }
)

export function normalizeAccountNoteFormat(format?: AccountNoteFormat | string | null): AccountNoteFormat {
    return format === 'html' ? 'html' : 'markdown'
}

export function getAccountNotePlainText(note?: string, format?: AccountNoteFormat | string | null) {
    if (!note) return ''

    if (normalizeAccountNoteFormat(format) === 'html') {
        if (typeof window === 'undefined') {
            return note.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        }

        const template = document.createElement('template')
        template.innerHTML = note
        return (template.content.textContent || '').replace(/\s+/g, ' ').trim()
    }

    return note
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#>*_\-~]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function buildSandboxedHtmlDocument(html: string) {
    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none';"
    />
    <style>
        html, body {
            box-sizing: border-box;
            min-height: 100%;
            margin: 0;
            color: #111827;
            background: #ffffff;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 14px;
            line-height: 1.6;
        }
        *, *::before, *::after { box-sizing: inherit; }
        body { padding: 16px; overflow-wrap: anywhere; }
        body > :first-child { margin-top: 0; }
        body > :last-child { margin-bottom: 0; }
        a { color: #2563eb; text-decoration: underline; }
        img, video, canvas, svg { max-width: 100%; height: auto; }
        table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; }
        th, td { border: 1px solid #d1d5db; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
        blockquote { margin: 0.75rem 0; padding-left: 0.75rem; border-left: 3px solid #d1d5db; color: #4b5563; }
        pre { overflow: auto; padding: 0.75rem; border-radius: 0.375rem; background: #f3f4f6; }
        code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
        button, input, select, textarea { font: inherit; }
    </style>
</head>
<body>${html}</body>
</html>`
}

function SandboxedHtmlPreview({ html, className }: { html: string; className?: string }) {
    return (
        <iframe
            title="账户 HTML/JS 备注预览"
            sandbox="allow-scripts"
            srcDoc={buildSandboxedHtmlDocument(html)}
            className={className}
        />
    )
}

export function AccountNotePreview({
    note,
    format,
    className,
    emptyText = '暂无备注',
}: {
    note?: string
    format?: AccountNoteFormat | string | null
    className?: string
    emptyText?: string
}) {
    const noteFormat = normalizeAccountNoteFormat(format)
    const content = note || ''

    if (!content.trim()) {
        return (
            <div className={cn('flex min-h-24 items-center justify-center text-sm text-gray-400 dark:text-gray-500', className)}>
                {emptyText}
            </div>
        )
    }

    if (noteFormat === 'html') {
        return (
            <SandboxedHtmlPreview
                html={content}
                className={cn('min-h-24 w-full rounded border border-gray-200 bg-white dark:border-gray-700', className)}
            />
        )
    }

    return (
        <div data-color-mode="light" className={cn('min-h-24 overflow-auto rounded border border-gray-200 bg-white p-4 dark:border-gray-700', className)}>
            <MarkdownPreview source={content} />
        </div>
    )
}
