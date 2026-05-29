'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import 'swagger-ui-react/swagger-ui.css'
import { RefreshCw, ExternalLink, Search, Copy, Check, BookOpen, Server, Code2, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'

const SWAGGER_JSON_PATH = '/swagger/doc.json'
const SWAGGER_UI_PATH = '/swagger/index.html'

function toSameOriginUrl(path: string) {
    if (typeof window === 'undefined') return path
    return new URL(path, window.location.origin).toString()
}

// Dynamic import of SwaggerUI to avoid SSR issues
const SwaggerUI = dynamic(() => import('swagger-ui-react'), { 
    ssr: false,
    loading: () => (
        <div className="flex items-center justify-center py-20">
            <div className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"></div>
                <p className="text-gray-500 dark:text-gray-400">加载 Swagger UI...</p>
            </div>
        </div>
    )
})

// Stats card for API info
function ApiInfoCard({
    label,
    value,
    icon: Icon,
    variant = 'default'
}: {
    label: string
    value: string | number
    icon: any
    variant?: 'default' | 'success' | 'primary' | 'warning'
}) {
    const variantClasses = {
        default: 'text-gray-600 dark:text-gray-400',
        success: 'text-emerald-600 dark:text-emerald-400',
        primary: 'text-blue-600 dark:text-blue-400',
        warning: 'text-amber-600 dark:text-amber-400'
    }

    const bgClasses = {
        default: 'bg-gray-50 dark:bg-gray-800/50',
        success: 'bg-emerald-50 dark:bg-emerald-900/20',
        primary: 'bg-blue-50 dark:bg-blue-900/20',
        warning: 'bg-amber-50 dark:bg-amber-900/20'
    }

    return (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 dark:border-gray-700/50 ${bgClasses[variant]}`}>
            <div className={`p-2 rounded-lg ${bgClasses[variant]}`}>
                <Icon className={`w-4 h-4 ${variantClasses[variant]}`} />
            </div>
            <div>
                <p className={`text-lg font-bold ${variantClasses[variant]}`}>{value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            </div>
        </div>
    )
}

export default function ApiDocsTab() {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [apiSpec, setApiSpec] = useState<any>(null)
    const [copied, setCopied] = useState(false)

    const swaggerJsonUrl = SWAGGER_JSON_PATH
    const swaggerUiUrl = SWAGGER_UI_PATH
    const displaySwaggerJsonUrl = toSameOriginUrl(SWAGGER_JSON_PATH)
    const displaySwaggerUiUrl = toSameOriginUrl(SWAGGER_UI_PATH)

    const loadSpec = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const response = await fetch(swaggerJsonUrl)
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }
            const spec = await response.json()
            setApiSpec(spec)
        } catch (err: any) {
            console.error('Failed to load swagger spec:', err)
            setError(err.message || '无法加载 API 文档')
        } finally {
            setLoading(false)
        }
    }, [swaggerJsonUrl])

    useEffect(() => {
        loadSpec()
    }, [loadSpec])

    // Register refresh callback
    useEffect(() => {
        registerRefreshCallback('api-docs', () => {
            toast.success('正在刷新 API 文档...')
            loadSpec()
        })
        return () => {
            unregisterRefreshCallback('api-docs')
        }
    }, [loadSpec])

    const handleCopyUrl = async () => {
        try {
            await navigator.clipboard.writeText(displaySwaggerJsonUrl)
            setCopied(true)
            toast.success('Swagger JSON URL 已复制')
            setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error('复制失败')
        }
    }

    const handleOpenExternal = () => {
        window.open(displaySwaggerUiUrl, '_blank')
    }

    // Count endpoints and tags from spec
    const endpointCount = apiSpec?.paths
        ? Object.values(apiSpec.paths).reduce((acc: number, methods: any) => acc + Object.keys(methods).length, 0)
        : 0
    const tagCount = apiSpec?.tags?.length || (apiSpec?.paths
        ? new Set(
            Object.values(apiSpec.paths)
                .flatMap((methods: any) => Object.values(methods))
                .flatMap((op: any) => op.tags || [])
        ).size
        : 0)
    const modelCount = apiSpec?.definitions ? Object.keys(apiSpec.definitions).length : 0

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"></div>
                    <p className="text-gray-500 dark:text-gray-400">加载 API 文档中...</p>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center max-w-md">
                    <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                        <Server className="h-8 w-8 text-red-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        无法加载 API 文档
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        {error}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
                        请确保后端服务正在运行，且 Swagger 文档已生成。
                        <br />
                        文档地址：<code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{displaySwaggerJsonUrl}</code>
                    </p>
                    <button
                        onClick={loadSpec}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        重试
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg">
                        <BookOpen className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                            API 接口文档
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {apiSpec?.info?.title || 'Mailman API'} v{apiSpec?.info?.version || '1.0'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Copy Swagger URL */}
                    <button
                        onClick={handleCopyUrl}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? '已复制' : '复制 JSON URL'}
                    </button>
                    {/* Open in new tab */}
                    <button
                        onClick={handleOpenExternal}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        新窗口打开
                    </button>
                    {/* Refresh */}
                    <button
                        onClick={loadSpec}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        刷新
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <ApiInfoCard label="接口数量" value={endpointCount} icon={Globe} variant="primary" />
                <ApiInfoCard label="接口分组" value={tagCount} icon={Search} variant="success" />
                <ApiInfoCard label="数据模型" value={modelCount} icon={Code2} variant="warning" />
                <ApiInfoCard label="API 版本" value={apiSpec?.info?.version || '1.0'} icon={Server} variant="default" />
            </div>

            {/* Swagger UI Container */}
            <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                <div className="swagger-ui-wrapper">
                    <SwaggerUI
                        url={swaggerJsonUrl}
                        docExpansion="list"
                        defaultModelsExpandDepth={-1}
                        filter={true}
                        tryItOutEnabled={true}
                    />
                </div>
            </div>

            {/* Custom styles for Swagger UI dark mode integration */}
            <style jsx global>{`
                .swagger-ui-wrapper .swagger-ui {
                    font-family: inherit;
                }
                .swagger-ui-wrapper .swagger-ui .topbar {
                    display: none;
                }
                .swagger-ui-wrapper .swagger-ui .info {
                    margin: 20px 0;
                }
                .swagger-ui-wrapper .swagger-ui .scheme-container {
                    background: transparent;
                    box-shadow: none;
                    padding: 15px 20px;
                }
                .swagger-ui-wrapper .swagger-ui .opblock-tag {
                    border-bottom: 1px solid #e5e7eb;
                    font-size: 16px;
                }
                .swagger-ui-wrapper .swagger-ui .opblock {
                    border-radius: 8px;
                    margin-bottom: 8px;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                }
                .swagger-ui-wrapper .swagger-ui .opblock .opblock-summary {
                    border-radius: 8px;
                }
                .swagger-ui-wrapper .swagger-ui .btn {
                    border-radius: 6px;
                }
                .swagger-ui-wrapper .swagger-ui input[type=text],
                .swagger-ui-wrapper .swagger-ui textarea {
                    border-radius: 6px;
                }
                .swagger-ui-wrapper .swagger-ui .model-box {
                    border-radius: 8px;
                }
                .swagger-ui-wrapper .swagger-ui .filter .operation-filter-input {
                    border-radius: 8px;
                    border: 1px solid #d1d5db;
                    padding: 8px 12px;
                    margin: 10px 20px;
                }

                /* Dark mode overrides */
                .dark .swagger-ui-wrapper .swagger-ui,
                .dark .swagger-ui-wrapper .swagger-ui .info .title,
                .dark .swagger-ui-wrapper .swagger-ui .info .base-url,
                .dark .swagger-ui-wrapper .swagger-ui .opblock-tag,
                .dark .swagger-ui-wrapper .swagger-ui .opblock .opblock-summary-description,
                .dark .swagger-ui-wrapper .swagger-ui .opblock .opblock-section-header h4,
                .dark .swagger-ui-wrapper .swagger-ui .response-col_status,
                .dark .swagger-ui-wrapper .swagger-ui .response-col_description,
                .dark .swagger-ui-wrapper .swagger-ui .parameters-col_description,
                .dark .swagger-ui-wrapper .swagger-ui table thead tr th,
                .dark .swagger-ui-wrapper .swagger-ui .parameter__name,
                .dark .swagger-ui-wrapper .swagger-ui .parameter__type,
                .dark .swagger-ui-wrapper .swagger-ui label,
                .dark .swagger-ui-wrapper .swagger-ui .model-title,
                .dark .swagger-ui-wrapper .swagger-ui .model {
                    color: #e5e7eb;
                }
                .dark .swagger-ui-wrapper .swagger-ui .info .description p,
                .dark .swagger-ui-wrapper .swagger-ui .opblock-description-wrapper p,
                .dark .swagger-ui-wrapper .swagger-ui .markdown p {
                    color: #9ca3af;
                }
                .dark .swagger-ui-wrapper .swagger-ui .opblock-tag {
                    border-color: #374151;
                }
                .dark .swagger-ui-wrapper .swagger-ui .opblock {
                    background: rgba(31, 41, 55, 0.5);
                    border-color: #374151;
                }
                .dark .swagger-ui-wrapper .swagger-ui .opblock .opblock-summary {
                    border-color: #374151;
                }
                .dark .swagger-ui-wrapper .swagger-ui .opblock .opblock-section-header {
                    background: rgba(55, 65, 81, 0.5);
                }
                .dark .swagger-ui-wrapper .swagger-ui .scheme-container {
                    background: transparent;
                }
                .dark .swagger-ui-wrapper .swagger-ui select {
                    background: #1f2937;
                    color: #e5e7eb;
                    border-color: #374151;
                }
                .dark .swagger-ui-wrapper .swagger-ui input[type=text],
                .dark .swagger-ui-wrapper .swagger-ui textarea {
                    background: #1f2937;
                    color: #e5e7eb;
                    border-color: #374151;
                }
                .dark .swagger-ui-wrapper .swagger-ui .filter .operation-filter-input {
                    background: #1f2937;
                    color: #e5e7eb;
                    border-color: #374151;
                }
                .dark .swagger-ui-wrapper .swagger-ui .model-box {
                    background: rgba(31, 41, 55, 0.5);
                }
                .dark .swagger-ui-wrapper .swagger-ui .responses-inner {
                    background: transparent;
                }
                .dark .swagger-ui-wrapper .swagger-ui table tbody tr td {
                    color: #d1d5db;
                }
            `}</style>
        </div>
    )
}
