'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import { Bold, Italic, Strikethrough, Underline as UnderlineIcon, List, ListOrdered, Link as LinkIcon, Image as ImageIcon, Undo, Redo, Quote, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useRef, useState, ChangeEvent } from 'react'
import { toast } from 'sonner'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'

interface RichTextEditorProps {
    initialContent?: string
    onContentChange?: (html: string) => void
    editable?: boolean
    onAddAttachment?: (file: File) => void
}

const MenuBar = ({ editor, onAddAttachment }: { editor: any, onAddAttachment?: (file: File) => void }) => {
    if (!editor) {
        return null
    }

    const fileInputRef = useRef<HTMLInputElement>(null)
    const [showLinkDialog, setShowLinkDialog] = useState(false)
    const [linkUrl, setLinkUrl] = useState('')

    const openLinkDialog = () => {
        const previousUrl = editor.getAttributes('link').href
        setLinkUrl(previousUrl || '')
        setShowLinkDialog(true)
    }

    const saveLink = () => {
        // empty
        if (linkUrl === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
        } else {
            // update
            editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
        }
        setShowLinkDialog(false)
    }

    const removeLink = () => {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
        setShowLinkDialog(false)
    }

    const handleImageClick = () => {
        fileInputRef.current?.click()
    }

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        // 2MB limitation
        if (file.size > 2 * 1024 * 1024) {
            toast.error('图片大小不能超过 2MB')
            return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
            const base64 = e.target?.result as string
            if (base64) {
                editor.chain().focus().setImage({ src: base64 }).run()
            }
        }
        reader.readAsDataURL(file)

        // Reset input value to allow selecting the same file again
        event.target.value = ''
    }

    return (
        <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 p-2 bg-gray-50/50 dark:bg-gray-800/50 flex-wrap">
            <button
                onClick={() => editor.chain().focus().toggleBold().run()}
                disabled={!editor.can().chain().focus().toggleBold().run()}
                className={cn(
                    "p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                    editor.isActive('bold') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'
                )}
                title="加粗 (Cmd+B)"
            >
                <Bold className="h-4 w-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleItalic().run()}
                disabled={!editor.can().chain().focus().toggleItalic().run()}
                className={cn(
                    "p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                    editor.isActive('italic') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'
                )}
                title="斜体 (Cmd+I)"
            >
                <Italic className="h-4 w-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                className={cn(
                    "p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                    editor.isActive('underline') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'
                )}
                title="下划线 (Cmd+U)"
            >
                <UnderlineIcon className="h-4 w-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleStrike().run()}
                disabled={!editor.can().chain().focus().toggleStrike().run()}
                className={cn(
                    "p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                    editor.isActive('strike') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'
                )}
                title="删除线"
            >
                <Strikethrough className="h-4 w-4" />
            </button>

            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

            <button
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                className={cn(
                    "p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                    editor.isActive('bulletList') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'
                )}
                title="无序列表"
            >
                <List className="h-4 w-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                className={cn(
                    "p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                    editor.isActive('orderedList') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'
                )}
                title="有序列表"
            >
                <ListOrdered className="h-4 w-4" />
            </button>
            <button
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                className={cn(
                    "p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                    editor.isActive('blockquote') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'
                )}
                title="引用"
            >
                <Quote className="h-4 w-4" />
            </button>

            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

            <button
                onClick={openLinkDialog}
                className={cn(
                    "p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors",
                    editor.isActive('link') ? 'bg-gray-200 dark:bg-gray-700 text-black dark:text-white' : 'text-gray-500 dark:text-gray-400'
                )}
                title="插入链接"
            >
                <LinkIcon className="h-4 w-4" />
            </button>
            <button
                onClick={handleImageClick}
                className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
                title="插入图片 (本地上传)"
            >
                <ImageIcon className="h-4 w-4" />
            </button>
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleFileChange}
            />

            <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>插入链接 / 上传附件</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-4 py-4">
                        <div className="grid gap-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                网络链接
                            </label>
                            <input
                                placeholder="https://example.com"
                                value={linkUrl}
                                onChange={(e) => setLinkUrl(e.target.value)}
                                className="flex h-10 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-50"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault()
                                        saveLink()
                                    }
                                }}
                            />
                        </div>

                        <div className="relative flex items-center py-2">
                            <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
                            <span className="flex-shrink-0 mx-4 text-gray-400 text-xs">或者</span>
                            <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
                        </div>

                        <div className="grid gap-2">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                上传附件
                            </label>
                            <button
                                type="button"
                                onClick={() => {
                                    // Trigger a separate file input for attachments
                                    const input = document.createElement('input')
                                    input.type = 'file'
                                    input.onchange = (e) => {
                                        const file = (e.target as HTMLInputElement).files?.[0]
                                        if (file && onAddAttachment) {
                                            onAddAttachment(file)
                                            setShowLinkDialog(false)
                                            // Optionally insert text? 
                                            // For now just close, the parent handles the attachment list UI.
                                        }
                                    }
                                    input.click()
                                }}
                                className="flex items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 p-8 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800 transition-colors"
                            >
                                <Paperclip className="h-5 w-5 text-gray-400" />
                                <span className="text-sm text-gray-500">点击选择文件作为附件上传</span>
                            </button>
                        </div>
                    </div>
                    <DialogFooter className="sm:justify-between">
                        <div className="flex-1 flex justify-start">
                            {linkUrl && (
                                <button
                                    type="button"
                                    onClick={removeLink}
                                    className="text-sm text-red-500 hover:underline"
                                >
                                    移除链接
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowLinkDialog(false)}
                                className="rounded-md px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={saveLink}
                                disabled={!linkUrl}
                                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                确认链接
                            </button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

export default function RichTextEditor({ initialContent, onContentChange, editable = true, onAddAttachment }: RichTextEditorProps) {
    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit,
            Underline,
            Link.configure({
                openOnClick: false,
                HTMLAttributes: {
                    class: 'text-blue-500 hover:text-blue-700 underline cursor-pointer',
                },
            }),
            Image.configure({
                HTMLAttributes: {
                    class: 'max-w-full rounded-lg my-4',
                },
            }),
            Placeholder.configure({
                placeholder: '在此输入邮件内容...',
            }),
        ],
        content: initialContent,
        editable,
        onUpdate: ({ editor }) => {
            const html = editor.getHTML()
            onContentChange?.(html)
        },
        editorProps: {
            attributes: {
                class: 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[300px] px-4 py-3',
            },
        },
    })

    // 当 external initialContent 变化时更新编辑器内容
    // 注意：这里需要谨慎，避免循环更新。我们假设 initialContent 主要在初始化或重置时变化
    useEffect(() => {
        if (editor && initialContent && editor.getHTML() !== initialContent) {
            // 只有当内容差异较大且编辑器未聚焦时才更新？或者完全信任 initialContent
            // 对于回复场景，initialContent 只在挂载时传入一次，所以可以安全更新
            // 但是如果用户正在输入，onContentChange 会触发，这里也会重渲染？
            // ComposeEmailTab 中的 visualHtml 是状态，onContentChange 更新它。
            // 所以这里会形成循环。
            // 解决方案：只在初始化时设置 content，或者仅当内容为空时设置。
            // 但是 Tiptap useEditor 的 content 属性仅用于初始化。
            // 下面的 useEffect 用于处理重置（如清空表单后）
        }
    }, [initialContent, editor])

    // 处理重置逻辑：如果 initialContent 变为空字符串（例如发送成功后清空），则清空编辑器
    useEffect(() => {
        if (editor && initialContent === '' && editor.getHTML() !== '<p></p>') {
            editor.commands.setContent('')
        }
    }, [initialContent, editor])

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
            <MenuBar editor={editor} onAddAttachment={onAddAttachment} />
            <div className="flex-1 overflow-y-auto cursor-text" onClick={() => editor?.commands.focus()}>
                <EditorContent editor={editor} className="h-full" />
            </div>
            <style jsx global>{`
                /* Tiptap Placeholder */
                .ProseMirror p.is-editor-empty:first-child::before {
                    color: #9ca3af;
                    content: attr(data-placeholder);
                    float: left;
                    height: 0;
                    pointer-events: none;
                }
                
                /* 引用块样式 */
                .ProseMirror blockquote {
                    border-left: 3px solid #e5e7eb;
                    padding-left: 1rem;
                    margin-left: 0;
                    margin-right: 0;
                    color: #4b5563;
                }
                .dark .ProseMirror blockquote {
                    border-left-color: #4b5563;
                    color: #9ca3af;
                }
            `}</style>
        </div>
    )
}
