'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Star, Paperclip, Reply, ReplyAll, Forward, Archive, Trash2, Code, Printer, Download, AlertTriangle, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Email, EmailAttachment } from '@/types'
import { formatDate, formatFileSize } from '@/lib/utils'
import { toast } from 'sonner'
import { Eye } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'

interface EmailPreviewPanelProps {
    email: Email | null
    loading: boolean
    accountId?: number | null
}

// 发送switchTab事件，跳转到独立的 compose Tab 并传递数据
function dispatchComposeEmail(mode: 'reply' | 'reply-all' | 'forward', originalEmail: Email, accountId?: number | null) {
    // 根据模式和邮件 ID 创建唯一的 Tab ID
    let tabId: string
    if (mode === 'reply-all') {
        tabId = `compose-reply-all-${originalEmail.ID}`
    } else if (mode === 'reply') {
        tabId = `compose-reply-${originalEmail.ID}`
    } else {
        tabId = `compose-forward-${originalEmail.ID}`
    }

    const event = new CustomEvent('switchTab', {
        detail: {
            tab: tabId,
            data: {
                mode,
                originalEmail,
                accountId
            }
        }
    })
    window.dispatchEvent(event)
}

// 使用React.memo优化性能，自定义比较函数
// 只有当邮件ID变化或loading状态变化时才重新渲染
function EmailPreviewPanelInner({
    email,
    loading,
    accountId,
}: EmailPreviewPanelProps) {
    const [showRawContent, setShowRawContent] = useState(false)
    const [isStarred, setIsStarred] = useState(false)

    // 外部链接确认对话框状态
    const [pendingExternalUrl, setPendingExternalUrl] = useState<string | null>(null)
    const [showExternalLinkDialog, setShowExternalLinkDialog] = useState(false)

    // 处理外部链接确认
    const handleExternalLinkConfirm = useCallback(() => {
        if (pendingExternalUrl) {
            window.open(pendingExternalUrl, '_blank', 'noopener,noreferrer')
        }
        setShowExternalLinkDialog(false)
        setPendingExternalUrl(null)
    }, [pendingExternalUrl])

    const handleExternalLinkCancel = useCallback(() => {
        setShowExternalLinkDialog(false)
        setPendingExternalUrl(null)
    }, [])

    // 监听来自 iframe 的 postMessage 事件
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // 验证消息来源和类型
            if (event.data && event.data.type === 'external-link-click') {
                const url = event.data.url
                if (url && typeof url === 'string') {
                    setPendingExternalUrl(url)
                    setShowExternalLinkDialog(true)
                }
            }
        }

        window.addEventListener('message', handleMessage)
        return () => window.removeEventListener('message', handleMessage)
    }, [])

    // 检查邮件是否已收藏
    useEffect(() => {
        if (email) {
            const starredEmails = JSON.parse(localStorage.getItem('starredEmails') || '[]')
            setIsStarred(starredEmails.includes(email.ID))
        }
    }, [email])

    // 切换收藏状态
    const toggleStar = () => {
        if (!email) return

        const starredEmails = JSON.parse(localStorage.getItem('starredEmails') || '[]')
        let newStarredEmails

        if (isStarred) {
            newStarredEmails = starredEmails.filter((id: number) => id !== email.ID)
        } else {
            newStarredEmails = [...starredEmails, email.ID]
        }

        localStorage.setItem('starredEmails', JSON.stringify(newStarredEmails))
        setIsStarred(!isStarred)
    }

    // 格式化邮箱地址列表
    const formatEmailList = (emails: string[] | string | undefined) => {
        if (!emails) return ''
        if (typeof emails === 'string') return emails
        return emails.join(', ')
    }

    // 打印邮件
    const handlePrint = () => {
        window.print()
    }

    // 下载附件
    const handleDownloadAttachment = (attachment: EmailAttachment) => {
        const content = attachment.Content || attachment.content
        if (!content) {
            toast.error('附件内容为空，无法下载')
            return
        }

        try {
            const mimeType = attachment.MIMEType || attachment.ContentType || attachment.content_type || 'application/octet-stream'
            const filename = attachment.Filename || attachment.filename || 'download'

            // Base64 decoding
            const byteCharacters = atob(content)
            const byteNumbers = new Array(byteCharacters.length)
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i)
            }
            const byteArray = new Uint8Array(byteNumbers)

            const blob = new Blob([byteArray], { type: mimeType })
            const url = URL.createObjectURL(blob)

            const link = document.createElement('a')
            link.href = url
            link.download = filename
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)

            toast.success(`已开始下载: ${filename}`)
        } catch (error) {
            console.error('Download failed:', error)
            toast.error('下载失败，附件数据可能已损坏')
        }
    }

    // 预览附件
    const handlePreviewAttachment = (attachment: EmailAttachment) => {
        const content = attachment.Content || attachment.content
        if (!content) {
            toast.error('附件内容为空，无法预览')
            return
        }

        try {
            const mimeType = attachment.MIMEType || attachment.ContentType || attachment.content_type || ''

            // Only allow preview for safe types
            if (!mimeType.startsWith('image/') && !mimeType.startsWith('text/') && mimeType !== 'application/pdf') {
                toast.error('不支持预览此类型文件，请下载查看')
                return
            }

            const byteCharacters = atob(content)
            const byteNumbers = new Array(byteCharacters.length)
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i)
            }
            const byteArray = new Uint8Array(byteNumbers)

            const blob = new Blob([byteArray], { type: mimeType })
            const url = URL.createObjectURL(blob)

            window.open(url, '_blank')
        } catch (error) {
            console.error('Preview failed:', error)
            toast.error('预览失败')
        }
    }

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-white dark:bg-gray-800">
                <div className="text-center">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-500 dark:text-gray-400">加载中...</p>
                </div>
            </div>
        )
    }

    if (!email) {
        return (
            <div className="h-full flex flex-col bg-white dark:bg-gray-800">
                {/* 顶部占位区域 */}
                <div className="border-b border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-gray-400 dark:text-gray-500">
                            邮件预览
                        </h2>
                        <div className="flex items-center gap-2 opacity-50">
                            <button className="p-2 rounded-lg text-gray-300 dark:text-gray-600" disabled>
                                <Star className="h-4 w-4" />
                            </button>
                            <button className="p-2 rounded-lg text-gray-300 dark:text-gray-600" disabled>
                                <Printer className="h-4 w-4" />
                            </button>
                            <button className="p-2 rounded-lg text-gray-300 dark:text-gray-600" disabled>
                                <Code className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* 主内容区域 */}
                <div className="flex-1 flex flex-col">
                    {/* 中心提示区域 */}
                    <div className="flex-1 flex items-center justify-center min-h-0 p-8">
                        <div className="text-center max-w-md">
                            <div className="w-20 h-20 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-6">
                                <Reply className="h-10 w-10 text-gray-400 dark:text-gray-500" />
                            </div>
                            <h3 className="text-xl font-medium text-gray-900 dark:text-white mb-2">
                                选择邮件进行预览
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                                从左侧邮件列表中选择一封邮件，在这里查看详细内容、回复或转发邮件。
                            </p>

                            {/* 功能介绍卡片 */}
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                    <Reply className="h-5 w-5 text-blue-500 mx-auto mb-2" />
                                    <p className="text-gray-600 dark:text-gray-400">快速回复</p>
                                </div>
                                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                    <Paperclip className="h-5 w-5 text-green-500 mx-auto mb-2" />
                                    <p className="text-gray-600 dark:text-gray-400">查看附件</p>
                                </div>
                                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                    <Star className="h-5 w-5 text-yellow-500 mx-auto mb-2" />
                                    <p className="text-gray-600 dark:text-gray-400">收藏重要邮件</p>
                                </div>
                                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                    <Forward className="h-5 w-5 text-purple-500 mx-auto mb-2" />
                                    <p className="text-gray-600 dark:text-gray-400">转发分享</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 底部提示区域 */}
                    <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800">
                        <div className="text-center">
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                提示：使用键盘上下箭头键可快速切换邮件
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <>
            <div className="h-full flex flex-col bg-white dark:bg-gray-800">
                {/* 邮件头部工具栏 */}
                <div className="border-b border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate mr-4">
                            {email.Subject || '(无主题)'}
                        </h2>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={toggleStar}
                                className={cn(
                                    "p-2 rounded-lg transition-colors",
                                    isStarred
                                        ? "text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
                                        : "text-gray-400 hover:text-yellow-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                                )}
                                title={isStarred ? "取消收藏" : "收藏"}
                            >
                                <Star className={cn("h-4 w-4", isStarred && "fill-current")} />
                            </button>
                            <button
                                onClick={handlePrint}
                                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                                title="打印"
                            >
                                <Printer className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => setShowRawContent(!showRawContent)}
                                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                                title={showRawContent ? "显示格式化内容" : "显示原始内容"}
                            >
                                <Code className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* 邮件基本信息 */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-4">
                                <span className="font-medium text-gray-900 dark:text-white">
                                    发件人: {formatEmailList(email.From)}
                                </span>
                                {email.Attachments && email.Attachments.length > 0 && (
                                    <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                                        <Paperclip className="h-4 w-4" />
                                        <span>{email.Attachments.length} 个附件</span>
                                    </div>
                                )}
                            </div>
                            <span className="text-gray-500 dark:text-gray-400">
                                {formatDate(email.Date)}
                            </span>
                        </div>

                        {email.To && (
                            <div className="text-sm text-gray-600 dark:text-gray-300">
                                收件人: {formatEmailList(email.To)}
                            </div>
                        )}

                        {email.Cc && (
                            <div className="text-sm text-gray-600 dark:text-gray-300">
                                抄送: {formatEmailList(email.Cc)}
                            </div>
                        )}
                    </div>

                    {/* 邮件操作按钮 */}
                    <div className="flex items-center gap-2 mt-4">
                        <button
                            onClick={() => email && dispatchComposeEmail('reply', email, accountId)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            <Reply className="h-4 w-4" />
                            回复
                        </button>
                        <button
                            onClick={() => email && dispatchComposeEmail('reply-all', email, accountId)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                            <ReplyAll className="h-4 w-4" />
                            全部回复
                        </button>
                        <button
                            onClick={() => email && dispatchComposeEmail('forward', email, accountId)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                            <Forward className="h-4 w-4" />
                            转发
                        </button>
                        <div className="flex-1"></div>
                        <button className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                            <Archive className="h-4 w-4" />
                        </button>
                        <button className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                            <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* 邮件内容 */}
                <div className="flex-1 flex flex-col overflow-hidden p-4">
                    <div className="flex-1 min-h-0 relative">
                        {showRawContent ? (
                            <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                                <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">原始邮件内容</h4>
                                <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto">
                                    {email.RawMessage || '原始内容不可用'}
                                </pre>
                            </div>
                        ) : (
                            <div className="h-full">
                                {email.HTMLBody ? (
                                    // 使用 sandbox iframe 安全渲染 HTML 邮件，防止 XSS 和 CSS 污染
                                    <iframe
                                        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals"
                                        title="邮件内容"
                                        srcDoc={`
                                        <!DOCTYPE html>
                                        <html>
                                        <head>
                                            <meta charset="utf-8">
                                            <meta name="viewport" content="width=device-width, initial-scale=1">
                                            <style>
                                                * { box-sizing: border-box; }
                                                body {
                                                    margin: 0;
                                                    padding: 16px;
                                                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                                                    font-size: 14px;
                                                    line-height: 1.6;
                                                    color: #374151;
                                                    background: transparent;
                                                    word-wrap: break-word;
                                                    overflow-wrap: break-word;
                                                }
                                                img { max-width: 100%; height: auto; }
                                                a { color: #2563eb; cursor: pointer; }
                                                a:hover { text-decoration: underline; }
                                                table { max-width: 100%; }
                                                pre, code { 
                                                    background: #f3f4f6; 
                                                    padding: 2px 6px; 
                                                    border-radius: 4px;
                                                    overflow-x: auto;
                                                }
                                                blockquote {
                                                    border-left: 4px solid #e5e7eb;
                                                    margin: 1em 0;
                                                    padding-left: 1em;
                                                    color: #6b7280;
                                                }
                                                /* 深色模式支持 */
                                                @media (prefers-color-scheme: dark) {
                                                    body { color: #d1d5db; }
                                                    a { color: #60a5fa; }
                                                    pre, code { background: #1f2937; }
                                                    blockquote { border-left-color: #4b5563; color: #9ca3af; }
                                                }
                                            </style>
                                        </head>
                                        <body>${email.HTMLBody}</body>
                                        <script>
                                            // 拦截所有链接点击，通过 postMessage 通知父窗口
                                            document.addEventListener('click', function(e) {
                                                var target = e.target;
                                                // 向上查找最近的 <a> 标签
                                                while (target && target.tagName !== 'A') {
                                                    target = target.parentElement;
                                                }
                                                if (target && target.tagName === 'A') {
                                                    var href = target.getAttribute('href');
                                                    if (href && !href.startsWith('javascript:') && !href.startsWith('#') && !href.startsWith('mailto:')) {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        // 通过 postMessage 通知父窗口显示确认对话框
                                                        window.parent.postMessage({
                                                            type: 'external-link-click',
                                                            url: href
                                                        }, '*');
                                                    }
                                                }
                                            }, true);
                                            
                                            // 同时处理表单提交（某些邮件可能用表单模拟按钮）
                                            document.addEventListener('submit', function(e) {
                                                var form = e.target;
                                                if (form && form.action && !form.action.startsWith('javascript:')) {
                                                    e.preventDefault();
                                                    // 通过 postMessage 通知父窗口
                                                    window.parent.postMessage({
                                                        type: 'external-link-click',
                                                        url: form.action
                                                    }, '*');
                                                }
                                            }, true);
                                        </script>
                                        </html>
                                    `}
                                        className="w-full h-full border-0 rounded-lg bg-white dark:bg-gray-900"
                                        style={{ minHeight: '300px' }}
                                    />
                                ) : (
                                    <div className="h-full overflow-y-auto whitespace-pre-wrap text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
                                        {email.Body || '邮件内容为空'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 附件列表 */}
                    {email.Attachments && email.Attachments.length > 0 && (
                        <div className="shrink-0 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 max-h-[200px] overflow-y-auto">
                            <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                <Paperclip className="h-4 w-4" />
                                附件 ({email.Attachments.length})
                            </h4>
                            <div className="grid gap-2">
                                {email.Attachments.map((attachment, index) => (
                                    <div
                                        key={attachment.ID || index}
                                        onClick={() => handleDownloadAttachment(attachment)}
                                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                                                <Paperclip className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                    {attachment.Filename || attachment.filename || `附件${index + 1}`}
                                                </p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    {attachment.MIMEType || attachment.ContentType || attachment.content_type || '未知类型'} • {formatFileSize(attachment.Size || attachment.size || 0)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handlePreviewAttachment(attachment)
                                                }}
                                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                                                title="预览"
                                            >
                                                <Eye className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleDownloadAttachment(attachment)
                                                }}
                                                className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                                                title="下载"
                                            >
                                                <Download className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 外部链接确认对话框 */}
            <Dialog open={showExternalLinkDialog} onOpenChange={setShowExternalLinkDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-5 w-5" />
                            站外链接安全提示
                        </DialogTitle>
                        <DialogDescription className="text-left space-y-3 pt-2">
                            <p>您即将离开邮件系统，访问以下外部链接：</p>
                            <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg break-all text-sm font-mono text-gray-700 dark:text-gray-300 flex items-start gap-2">
                                <ExternalLink className="h-4 w-4 flex-shrink-0 mt-0.5 text-blue-500" />
                                <span>{pendingExternalUrl && pendingExternalUrl.length > 100
                                    ? pendingExternalUrl.substring(0, 100) + '...'
                                    : pendingExternalUrl}
                                </span>
                            </div>
                            <div className="text-amber-700 dark:text-amber-300 text-sm space-y-1">
                                <p className="font-medium">请注意：</p>
                                <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
                                    <li>外部网站可能存在安全风险</li>
                                    <li>请勿在不信任的网站输入敏感信息</li>
                                    <li>钓鱼邮件常利用虚假链接骗取信息</li>
                                </ul>
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex gap-2 sm:gap-2">
                        <button
                            onClick={handleExternalLinkCancel}
                            className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleExternalLinkConfirm}
                            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <ExternalLink className="h-4 w-4" />
                            继续访问
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

// 使用 React.memo 包装组件，自定义比较函数
// 只有当邮件ID变化或loading状态变化时才重新渲染
// 这确保了在邮件列表增量刷新时，预览面板不会被打断
const EmailPreviewPanel = React.memo(EmailPreviewPanelInner, (prevProps, nextProps) => {
    // 返回 true 表示跳过重新渲染，false 表示需要重新渲染

    // 如果 loading 状态变化，需要重新渲染
    if (prevProps.loading !== nextProps.loading) {
        return false
    }

    // 如果 accountId 变化，需要重新渲染
    if (prevProps.accountId !== nextProps.accountId) {
        return false
    }

    // 如果邮件ID相同，且关键内容相同，则跳过重新渲染
    const prevEmail = prevProps.email
    const nextEmail = nextProps.email

    // 两者都为null
    if (prevEmail === null && nextEmail === null) {
        return true
    }

    // 其中一个为null
    if (prevEmail === null || nextEmail === null) {
        return false
    }

    // 比较邮件ID和关键字段
    if (prevEmail.ID !== nextEmail.ID) {
        return false
    }

    // ID相同，比较关键内容是否变化
    if (
        prevEmail.Subject !== nextEmail.Subject ||
        prevEmail.Body !== nextEmail.Body ||
        prevEmail.HTMLBody !== nextEmail.HTMLBody ||
        prevEmail.Date !== nextEmail.Date ||
        JSON.stringify(prevEmail.Attachments) !== JSON.stringify(nextEmail.Attachments)
    ) {
        return false
    }

    // 所有关键字段都相同，跳过重新渲染
    return true
})

export default EmailPreviewPanel
