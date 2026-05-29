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

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function renderInlineMarkdown(value: string) {
    return escapeHtml(value)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}

function markdownToBasicHtml(markdown: string) {
    const lines = markdown.split(/\r?\n/)
    const html: string[] = []
    let inList = false
    let inCode = false
    let codeLines: string[] = []

    const closeList = () => {
        if (inList) {
            html.push('</ul>')
            inList = false
        }
    }

    lines.forEach((line) => {
        if (line.trim().startsWith('```')) {
            if (inCode) {
                html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
                codeLines = []
                inCode = false
            } else {
                closeList()
                inCode = true
            }
            return
        }

        if (inCode) {
            codeLines.push(line)
            return
        }

        if (!line.trim()) {
            closeList()
            return
        }

        const heading = /^(#{1,4})\s+(.+)$/.exec(line)
        if (heading) {
            closeList()
            const level = heading[1].length
            html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
            return
        }

        const listItem = /^\s*[-*]\s+(.+)$/.exec(line)
        if (listItem) {
            if (!inList) {
                html.push('<ul>')
                inList = true
            }
            html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`)
            return
        }

        closeList()
        html.push(`<p>${renderInlineMarkdown(line)}</p>`)
    })

    if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    }
    closeList()

    return html.join('\n')
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

function buildSandboxedMarkdownDocument(markdown: string) {
    return buildSandboxedHtmlDocument(markdownToBasicHtml(markdown))
}

function escapeAttribute(value: string) {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export function buildAccountNoteStandaloneDocument({
    note,
    format,
    title,
}: {
    note: string
    format?: AccountNoteFormat | string | null
    title?: string
}) {
    const noteFormat = normalizeAccountNoteFormat(format)
    const previewDocument = noteFormat === 'html'
        ? buildSandboxedHtmlDocument(note)
        : buildSandboxedMarkdownDocument(note)

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; child-src data: about:; frame-src data: about:; object-src 'none'; base-uri 'none'; form-action 'none';" />
    <title>${escapeHtml(title || '账户备注预览')}</title>
    <style>
        html, body { height: 100%; margin: 0; background: #0f172a; color: #e5e7eb; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        body { display: grid; grid-template-rows: auto 1fr; }
        header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-bottom: 1px solid rgba(148,163,184,.25); background: rgba(15,23,42,.95); }
        h1 { margin: 0; font-size: 15px; font-weight: 650; }
        .badge { border-radius: 999px; padding: 3px 9px; background: rgba(59,130,246,.16); color: #bfdbfe; font-size: 12px; }
        iframe { width: 100%; height: 100%; border: 0; background: #fff; }
    </style>
</head>
<body>
    <header>
        <h1>${escapeHtml(title || '账户备注预览')}</h1>
        <span class="badge">${noteFormat === 'html' ? 'HTML/JS sandbox' : 'Markdown preview'}</span>
    </header>
    <iframe
        title="${escapeAttribute(title || '账户备注预览')}"
        sandbox="${noteFormat === 'html' ? 'allow-scripts' : ''}"
        srcdoc="${escapeAttribute(previewDocument)}"
    ></iframe>
</body>
</html>`
}

export function openAccountNoteStandalonePreview({
    note,
    format,
    title,
}: {
    note: string
    format?: AccountNoteFormat | string | null
    title?: string
}) {
    const documentHtml = buildAccountNoteStandaloneDocument({ note, format, title })
    const blob = new Blob([documentHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function SandboxedHtmlPreview({
    html,
    className,
    style,
}: {
    html: string
    className?: string
    style?: React.CSSProperties
}) {
    return (
        <iframe
            title="账户 HTML/JS 备注预览"
            sandbox="allow-scripts"
            srcDoc={buildSandboxedHtmlDocument(html)}
            className={className}
            style={style}
        />
    )
}

export function AccountNotePreview({
    note,
    format,
    className,
    style,
    emptyText = '暂无备注',
}: {
    note?: string
    format?: AccountNoteFormat | string | null
    className?: string
    style?: React.CSSProperties
    emptyText?: string
}) {
    const noteFormat = normalizeAccountNoteFormat(format)
    const content = note || ''

    if (!content.trim()) {
        return (
            <div
                className={cn('flex min-h-24 items-center justify-center text-sm text-gray-400 dark:text-gray-500', className)}
                style={style}
            >
                {emptyText}
            </div>
        )
    }

    if (noteFormat === 'html') {
        return (
            <SandboxedHtmlPreview
                html={content}
                className={cn('min-h-24 w-full rounded border border-gray-200 bg-white dark:border-gray-700', className)}
                style={style}
            />
        )
    }

    return (
        <div
            data-color-mode="light"
            className={cn('min-h-24 overflow-auto rounded border border-gray-200 bg-white p-4 dark:border-gray-700', className)}
            style={style}
        >
            <MarkdownPreview source={content} />
        </div>
    )
}
