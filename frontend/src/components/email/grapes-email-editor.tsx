'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

// GrapesJS 需要在客户端加载
let grapesjs: any = null
let grapesjsPresetNewsletter: any = null

interface GrapesEmailEditorProps {
    onReady?: () => void
    onExportHtml?: (html: string) => void
    initialContent?: string
}

export default function GrapesEmailEditor({ onReady, onExportHtml, initialContent }: GrapesEmailEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null)
    const editorInstance = useRef<any>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        // 加载 GrapesJS CSS
        const loadCss = () => {
            if (!document.getElementById('grapesjs-css')) {
                const link = document.createElement('link')
                link.id = 'grapesjs-css'
                link.rel = 'stylesheet'
                link.href = 'https://unpkg.com/grapesjs@0.21.10/dist/css/grapes.min.css'
                document.head.appendChild(link)
            }
        }
        loadCss()

        const initEditor = async () => {
            try {
                // 动态导入 GrapesJS
                if (!grapesjs) {
                    grapesjs = (await import('grapesjs')).default
                    grapesjsPresetNewsletter = (await import('grapesjs-preset-newsletter')).default
                }

                if (!editorRef.current) return

                // 销毁旧实例
                if (editorInstance.current) {
                    editorInstance.current.destroy()
                }

                // 等待 CSS 加载
                await new Promise(resolve => setTimeout(resolve, 100))

                // 创建编辑器
                editorInstance.current = grapesjs.init({
                    container: editorRef.current,
                    fromElement: false,
                    height: '100%',
                    width: 'auto',
                    storageManager: false,
                    plugins: [grapesjsPresetNewsletter],
                    pluginsOpts: {
                        [grapesjsPresetNewsletter]: {
                            modalTitleImport: '导入模板',
                            modalTitleExport: '导出 HTML',
                            modalLabelImport: '粘贴您的 HTML/CSS 代码',
                            modalLabelExport: '复制以下代码',
                            importPlaceholder: '<table class="main-body">...</table>',
                        },
                    },
                    // 设备配置
                    deviceManager: {
                        devices: [
                            { name: 'Desktop', width: '' },
                            { name: 'Tablet', width: '768px', widthMedia: '992px' },
                            { name: 'Mobile', width: '320px', widthMedia: '480px' },
                        ],
                    },
                    // 画布样式
                    canvas: {
                        styles: [
                            'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
                        ],
                    },
                })

                // 设置初始内容
                if (initialContent) {
                    editorInstance.current.setComponents(initialContent)
                } else {
                    // 默认模板
                    editorInstance.current.setComponents(`
                        <table class="main-body" style="width: 100%; max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
                            <tr>
                                <td style="padding: 40px 30px; background-color: #f8f9fa;">
                                    <table style="width: 100%;">
                                        <tr>
                                            <td style="background-color: #ffffff; padding: 30px; border-radius: 8px;">
                                                <h1 style="margin: 0 0 20px; color: #1f2937; font-size: 24px;">邮件标题</h1>
                                                <p style="margin: 0 0 16px; color: #4b5563; line-height: 1.6;">
                                                    你好！
                                                </p>
                                                <p style="margin: 0 0 16px; color: #4b5563; line-height: 1.6;">
                                                    这是一封使用拖拽编辑器创建的邮件。你可以：
                                                </p>
                                                <ul style="margin: 0 0 16px; padding-left: 20px; color: #4b5563;">
                                                    <li>拖拽组件到编辑区域</li>
                                                    <li>点击编辑文本内容</li>
                                                    <li>调整样式和布局</li>
                                                </ul>
                                                <a href="#" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 500;">
                                                    点击按钮
                                                </a>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    `)
                }

                // 监听内容变化
                if (onExportHtml) {
                    editorInstance.current.on('component:update', () => {
                        const html = editorInstance.current.getHtml()
                        const css = editorInstance.current.getCss()
                        onExportHtml(`<!DOCTYPE html>
<html>
<head>
    <style>${css}</style>
</head>
<body>${html}</body>
</html>`)
                    })
                }

                setLoading(false)
                onReady?.()
            } catch (err) {
                console.error('Failed to initialize GrapesJS:', err)
                setError('编辑器加载失败')
                setLoading(false)
            }
        }

        initEditor()

        return () => {
            if (editorInstance.current) {
                editorInstance.current.destroy()
                editorInstance.current = null
            }
        }
    }, [])

    if (error) {
        return (
            <div className="flex h-full items-center justify-center bg-gray-50 dark:bg-gray-800">
                <div className="text-center text-red-500">
                    <p>{error}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="grapes-editor-wrapper">
            {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50 dark:bg-gray-800">
                    <div className="flex items-center gap-2 text-gray-500">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>加载编辑器...</span>
                    </div>
                </div>
            )}
            <div ref={editorRef} id="gjs-editor" />
            {/* GrapesJS 样式覆盖 */}
            <style jsx global>{`
                .grapes-editor-wrapper {
                    position: relative;
                    width: 100%;
                    height: 100%;
                }
                
                #gjs-editor {
                    width: 100%;
                    height: 100%;
                }
                
                /* 编辑器主容器 */
                .gjs-editor {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                
                /* 亮色主题 (默认) */
                .gjs-one-bg {
                    background-color: #ffffff !important;
                }
                
                .gjs-two-color {
                    color: #4b5563 !important;
                }
                
                .gjs-three-bg {
                    background-color: #f9fafb !important;
                }
                
                .gjs-four-color,
                .gjs-four-color-h:hover {
                    color: #3b82f6 !important;
                }
                
                /* 画布区域 */
                .gjs-cv-canvas {
                    background-color: #f3f4f6 !important;
                    width: calc(100% - 240px) !important;
                    height: calc(100% - 40px) !important;
                    top: 40px !important;
                    left: 0 !important;
                }
                
                /* 右侧面板 */
                .gjs-pn-views-container {
                    width: 240px !important;
                    height: calc(100% - 40px) !important;
                    top: 40px !important;
                    padding: 0 !important;
                    background-color: #ffffff !important;
                    border-left: 1px solid #e5e7eb !important;
                }
                
                .gjs-pn-views {
                    border-bottom: 1px solid #e5e7eb !important;
                }
                
                .gjs-pn-btn {
                    color: #6b7280 !important;
                    padding: 12px 14px !important;
                    font-size: 14px !important;
                }
                
                .gjs-pn-btn.gjs-pn-active {
                    color: #3b82f6 !important;
                    background-color: #eff6ff !important;
                }
                
                /* 组件块 */
                .gjs-blocks-c {
                    padding: 8px !important;
                    display: flex !important;
                    flex-wrap: wrap !important;
                    justify-content: flex-start !important;
                }
                
                .gjs-block {
                    width: calc(50% - 8px) !important;
                    padding: 12px 8px !important;
                    margin: 4px !important;
                    border-radius: 6px !important;
                    border: 1px solid #e5e7eb !important;
                    background-color: #ffffff !important;
                    color: #4b5563 !important;
                    min-height: 70px !important;
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: center !important;
                    justify-content: center !important;
                    transition: all 0.2s !important;
                }
                
                .gjs-block:hover {
                    border-color: #3b82f6 !important;
                    color: #3b82f6 !important;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important;
                }
                
                .gjs-block svg {
                    width: 28px !important;
                    height: 28px !important;
                    margin-bottom: 4px !important;
                }
                
                .gjs-block-label {
                    font-size: 11px !important;
                    margin-top: 6px !important;
                    line-height: 1.3 !important;
                    text-align: center !important;
                }
                
                /* 样式管理器 */
                .gjs-sm-sector-title {
                    background-color: #f9fafb !important;
                    color: #374151 !important;
                    border: none !important;
                    font-weight: 600 !important;
                    border-bottom: 1px solid #e5e7eb !important;
                }
                
                .gjs-sm-properties {
                    background-color: #ffffff !important;
                }
                
                .gjs-field {
                    background-color: #ffffff !important;
                    border-color: #d1d5db !important;
                    color: #374151 !important;
                    border-radius: 4px !important;
                }
                
                .gjs-field input,
                .gjs-field select {
                    color: #374151 !important;
                }

                .gjs-clm-tag {
                     color: #374151 !important;
                     background-color: #f3f4f6 !important;
                }
                
                /* 图层面板 */
                .gjs-layers {
                    background-color: #ffffff !important;
                }
                
                .gjs-layer {
                    background-color: #ffffff !important;
                    color: #374151 !important;
                    border-bottom: 1px solid #f3f4f6 !important;
                }
                
                .gjs-layer:hover {
                    background-color: #f9fafb !important;
                }
                
                /* 特征管理器 */
                .gjs-trt-traits {
                    background-color: #ffffff !important;
                }
                
                .gjs-trt-trait {
                    background-color: #ffffff !important;
                }

                .gjs-label {
                    color: #4b5563 !important;
                }
                
                /* 顶部工具栏 */
                .gjs-pn-panels {
                    height: 40px !important;
                    display: flex !important;
                    align-items: center !important;
                    background-color: #ffffff !important;
                    border-bottom: 1px solid #e5e7eb !important;
                    z-index: 10 !important;
                }
                
                .gjs-pn-commands,
                .gjs-pn-options,
                .gjs-pn-devices-c {
                    background-color: transparent !important;
                    height: 40px !important;
                    display: flex !important;
                    align-items: center !important;
                }
                
                .gjs-pn-panels .gjs-pn-btn {
                    padding: 8px 10px !important;
                    min-width: 36px !important;
                    height: 36px !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    border-right: 1px solid transparent !important;
                }
                
                .gjs-pn-panels .gjs-pn-btn:hover {
                    background-color: #f3f4f6 !important;
                    color: #3b82f6 !important;
                }
                
                .gjs-pn-panels .gjs-pn-btn svg {
                    width: 20px !important;
                    height: 20px !important;
                }
                
                /* 画布内 iframe */
                .gjs-frame-wrapper {
                    height: 100% !important;
                }
                
                /* 选中组件高亮 */
                .gjs-selected {
                    outline: 2px solid #3b82f6 !important;
                }
                
                /* 悬停组件高亮 */
                .gjs-hovered {
                    outline: 1px dashed #60a5fa !important;
                }

                /* ========================================= */
                /* 深色模式适配 (Dark Mode) - 仅当父级有 .dark 类时生效 */
                /* ========================================= */
                
                :global(.dark) .gjs-one-bg {
                    background-color: #1f2937 !important;
                }
                
                :global(.dark) .gjs-two-color {
                    color: #f3f4f6 !important;
                }
                
                :global(.dark) .gjs-three-bg {
                    background-color: #374151 !important;
                }
                
                :global(.dark) .gjs-cv-canvas {
                    background-color: #111827 !important;
                }
                
                :global(.dark) .gjs-pn-views-container {
                    background-color: #1f2937 !important;
                    border-left: 1px solid #374151 !important;
                }
                
                :global(.dark) .gjs-pn-views {
                    border-bottom: 1px solid #374151 !important;
                }
                
                :global(.dark) .gjs-pn-btn {
                    color: #9ca3af !important;
                }
                
                :global(.dark) .gjs-pn-btn.gjs-pn-active {
                    color: #3b82f6 !important;
                    background-color: transparent !important;
                }

                :global(.dark) .gjs-block {
                    border: 1px solid #374151 !important;
                    background-color: #1f2937 !important;
                    color: #f3f4f6 !important;
                }
                
                :global(.dark) .gjs-block:hover {
                    border-color: #3b82f6 !important;
                    box-shadow: none !important;
                }

                :global(.dark) .gjs-sm-sector-title {
                    background-color: #374151 !important;
                    color: #f3f4f6 !important;
                    border-bottom: none !important;
                }
                
                :global(.dark) .gjs-sm-properties {
                    background-color: #1f2937 !important;
                }
                
                :global(.dark) .gjs-field {
                    background-color: #374151 !important;
                    border-color: #4b5563 !important;
                    color: #f3f4f6 !important;
                }
                
                :global(.dark) .gjs-field input,
                :global(.dark) .gjs-field select {
                    color: #f3f4f6 !important;
                }

                :global(.dark) .gjs-clm-tag {
                     color: #f3f4f6 !important;
                     background-color: #374151 !important;
                }
                
                :global(.dark) .gjs-layers {
                    background-color: #1f2937 !important;
                }
                
                :global(.dark) .gjs-layer {
                    background-color: #1f2937 !important;
                    color: #f3f4f6 !important;
                    border-bottom: none !important;
                }
                
                :global(.dark) .gjs-layer:hover {
                    background-color: #374151 !important;
                }
                
                :global(.dark) .gjs-trt-traits {
                    background-color: #1f2937 !important;
                }
                
                :global(.dark) .gjs-trt-trait {
                    background-color: #1f2937 !important;
                }

                :global(.dark) .gjs-label {
                    color: #a0aec0 !important;
                }
                
                :global(.dark) .gjs-pn-panels {
                    background-color: #1f2937 !important;
                    border-bottom: 1px solid #374151 !important;
                }

                :global(.dark) .gjs-pn-panels .gjs-pn-btn:hover {
                    background-color: rgba(255, 255, 255, 0.05) !important;
                    color: #ffffff !important;
                }
            `}</style>
        </div>
    )
}

// 导出获取 HTML 的辅助函数
export const getGrapesEditorHtml = (editorInstance: any): string => {
    if (!editorInstance) return ''
    const html = editorInstance.getHtml()
    const css = editorInstance.getCss()
    return `<!DOCTYPE html>
<html>
<head>
    <style>${css}</style>
</head>
<body>${html}</body>
</html>`
}
