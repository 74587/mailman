'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import {
    Settings,
    Zap,
    ArrowRight,
    Code2,
    FileText,
    Mail,
    Tag,
    Trash2,
    Forward,
    Regex,
    CheckCircle,
    XCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Action {
    id: string
    pluginId: string
    pluginName: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
}

interface ActionPreviewPanelProps {
    action: Action
    testData?: Record<string, any>
    executionResult?: {
        actionId: string
        success: boolean
        message?: string
        details?: any
    }
}

// Plugin icon mapping
const getPluginIcon = (pluginId: string) => {
    switch (pluginId) {
        case 'email_transform_action':
            return <Zap className="h-4 w-4" />
        case 'email_forward_action':
            return <Forward className="h-4 w-4" />
        case 'email_label_action':
            return <Tag className="h-4 w-4" />
        case 'email_delete_action':
            return <Trash2 className="h-4 w-4" />
        default:
            return <Settings className="h-4 w-4" />
    }
}

// Transform type display
const getTransformTypeDisplay = (type: string) => {
    switch (type) {
        case 'template':
            return { label: 'Go 模板', icon: <FileText className="h-3 w-3" />, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' }
        case 'javascript':
            return { label: 'JavaScript', icon: <Code2 className="h-3 w-3" />, color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' }
        case 'regex':
            return { label: '正则表达式', icon: <Regex className="h-3 w-3" />, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' }
        case 'prefix':
            return { label: '添加前缀', icon: <ArrowRight className="h-3 w-3" />, color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' }
        case 'suffix':
            return { label: '添加后缀', icon: <ArrowRight className="h-3 w-3 rotate-180" />, color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' }
        case 'replace':
            return { label: '替换', icon: <ArrowRight className="h-3 w-3" />, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' }
        default:
            return { label: type, icon: <Settings className="h-3 w-3" />, color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' }
    }
}

// Target field display
const getTargetFieldDisplay = (field: string) => {
    switch (field) {
        case 'subject':
            return { label: '主题', icon: '📧' }
        case 'from':
            return { label: '发件人', icon: '👤' }
        case 'to':
            return { label: '收件人', icon: '📬' }
        case 'body':
            return { label: '正文', icon: '📝' }
        case 'message_id':
            return { label: '消息ID', icon: '🔑' }
        case 'thread_id':
            return { label: '线程ID', icon: '🧵' }
        case 'labels':
            return { label: '标签', icon: '🏷️' }
        default:
            return { label: field, icon: '📋' }
    }
}

// Preview current value from testData
const getPreviewValue = (testData: Record<string, any>, field: string): string | null => {
    if (!testData) return null

    const fieldMapping: Record<string, string> = {
        'subject': 'Subject',
        'from': 'From',
        'to': 'To',
        'body': 'Body',
        'message_id': 'MessageID',
        'labels': 'Flags'
    }

    const mappedField = fieldMapping[field] || field
    const value = testData[mappedField]

    if (value === undefined || value === null) return null
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'string' && value.length > 100) return value.substring(0, 100) + '...'
    return String(value)
}

export function ActionPreviewPanel({ action, testData = {}, executionResult }: ActionPreviewPanelProps) {
    const { config, pluginId, pluginName } = action

    // 检查是否有当前动作的执行结果
    const hasResult = executionResult && executionResult.actionId === action.id
    const isSuccess = hasResult && executionResult?.success

    // Render email_transform_action preview
    const renderTransformActionPreview = () => {
        const targetField = config.target_field || 'subject'
        const transformType = config.transform_type || 'template'
        const typeDisplay = getTransformTypeDisplay(transformType)
        const fieldDisplay = getTargetFieldDisplay(targetField)
        const currentValue = getPreviewValue(testData, targetField)

        // Get the actual transform content based on type
        let transformContent = ''
        let contentLabel = ''
        switch (transformType) {
            case 'template':
                transformContent = config.template_content || ''
                contentLabel = '模板内容'
                break
            case 'javascript':
                transformContent = config.javascript_script || ''
                contentLabel = 'JavaScript 代码'
                break
            case 'regex':
                transformContent = `匹配: ${config.regex_pattern || ''}\n替换: ${config.regex_replacement || ''}`
                contentLabel = '正则表达式'
                break
            case 'prefix':
            case 'suffix':
                transformContent = config.text_content || ''
                contentLabel = '文本内容'
                break
            case 'replace':
                transformContent = `原文本: ${config.old_text || ''}\n新文本: ${config.new_text || ''}`
                contentLabel = '替换规则'
                break
        }

        return (
            <div className="space-y-4">
                {/* Transform Overview */}
                <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="flex items-center gap-1">
                        <span>{fieldDisplay.icon}</span>
                        {fieldDisplay.label}
                    </Badge>
                    <ArrowRight className="h-4 w-4 text-gray-400" />
                    <Badge className={cn("flex items-center gap-1", typeDisplay.color)}>
                        {typeDisplay.icon}
                        {typeDisplay.label}
                    </Badge>
                </div>

                {/* Current Value Preview */}
                {currentValue && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
                            <Mail className="h-3 w-3" />
                            当前字段值（来自测试数据）
                        </div>
                        <div className="text-sm font-mono text-gray-700 dark:text-gray-300 break-all">
                            {currentValue}
                        </div>
                    </div>
                )}

                {/* Transform Content */}
                {transformContent && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 mb-2">
                            {typeDisplay.icon}
                            {contentLabel}
                        </div>
                        <pre className="text-sm font-mono text-blue-700 dark:text-blue-300 whitespace-pre-wrap break-all">
                            {transformContent}
                        </pre>
                    </div>
                )}

                {/* No Content Warning */}
                {!transformContent && (
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                        <div className="text-sm text-yellow-700 dark:text-yellow-300">
                            ⚠️ 请配置{contentLabel || '转换规则'}
                        </div>
                    </div>
                )}
            </div>
        )
    }

    // Render email_forward_action preview
    const renderForwardActionPreview = () => {
        return (
            <div className="space-y-3">
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">转发到</div>
                    <div className="text-sm font-medium">
                        {config.to_address || <span className="text-gray-400">未配置</span>}
                    </div>
                </div>
                {config.subject_prefix && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">主题前缀</div>
                        <div className="text-sm font-medium">{config.subject_prefix}</div>
                    </div>
                )}
            </div>
        )
    }

    // Render email_label_action preview
    const renderLabelActionPreview = () => {
        const labels = config.labels || []
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Badge variant={config.operation === 'add' ? 'default' : 'destructive'}>
                        {config.operation === 'add' ? '添加标签' : '移除标签'}
                    </Badge>
                </div>
                {labels.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {labels.map((label: string, index: number) => (
                            <Badge key={index} variant="outline" className="flex items-center gap-1">
                                <Tag className="h-3 w-3" />
                                {label}
                            </Badge>
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-gray-500">未配置标签</div>
                )}
            </div>
        )
    }

    // Render email_delete_action preview
    const renderDeleteActionPreview = () => {
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Badge variant={config.permanent ? 'destructive' : 'secondary'}>
                        {config.permanent ? '永久删除' : '移至回收站'}
                    </Badge>
                </div>
                {config.permanent && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                        <div className="text-sm text-red-700 dark:text-red-300">
                            ⚠️ 此操作将永久删除邮件，无法恢复
                        </div>
                    </div>
                )}
            </div>
        )
    }

    // Render generic config preview
    const renderGenericPreview = () => {
        const entries = Object.entries(config || {})
        if (entries.length === 0) {
            return (
                <div className="text-sm text-gray-500 text-center py-4">
                    暂无配置
                </div>
            )
        }

        return (
            <div className="space-y-2">
                {entries.map(([key, value]) => (
                    <div key={key} className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                        <div className="text-xs text-gray-500 dark:text-gray-400">{key}</div>
                        <div className="text-sm font-mono break-all">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    // Select appropriate preview based on plugin type
    const renderPreview = () => {
        switch (pluginId) {
            case 'email_transform_action':
                return renderTransformActionPreview()
            case 'email_forward_action':
                return renderForwardActionPreview()
            case 'email_label_action':
                return renderLabelActionPreview()
            case 'email_delete_action':
                return renderDeleteActionPreview()
            default:
                return renderGenericPreview()
        }
    }

    return (
        <div>
            {/* Header */}
            <div className="flex items-center gap-2 mb-4 pb-3 border-b">
                <div className={cn(
                    "p-2 rounded-lg",
                    hasResult
                        ? (isSuccess ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400")
                        : "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                )}>
                    {hasResult ? (
                        isSuccess ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />
                    ) : (
                        getPluginIcon(pluginId)
                    )}
                </div>
                <div>
                    <h4 className="font-medium">{pluginName}</h4>
                    <p className="text-xs text-gray-500">动作配置概览</p>
                </div>
                {!action.enabled && (
                    <Badge variant="outline" className="ml-auto text-gray-500">
                        已禁用
                    </Badge>
                )}
            </div>

            {/* 执行结果展示 */}
            {hasResult && (
                <div className={cn(
                    "mb-4 p-3 rounded-lg border",
                    isSuccess
                        ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                        : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                )}>
                    <div className="flex items-center gap-2 mb-2">
                        {isSuccess ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                        )}
                        <span className={cn(
                            "font-medium text-sm",
                            isSuccess ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"
                        )}>
                            {isSuccess ? '执行成功' : '执行失败'}
                        </span>
                    </div>
                    {executionResult?.message && (
                        <p className={cn(
                            "text-xs",
                            isSuccess ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                        )}>
                            {executionResult.message}
                        </p>
                    )}
                    {executionResult?.details && (
                        <details className="mt-2">
                            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                                查看详情
                            </summary>
                            <pre className="mt-2 text-xs bg-white dark:bg-gray-800 p-2 rounded border overflow-x-auto max-h-40">
                                {JSON.stringify(executionResult.details, null, 2)}
                            </pre>
                        </details>
                    )}
                </div>
            )}

            {/* Preview Content */}
            {renderPreview()}
        </div>
    )
}

