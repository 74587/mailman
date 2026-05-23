'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'
import {
    Zap,
    ChevronDown,
    ChevronRight,
    CheckCircle,
    XCircle,
    Settings,
    Hash,
    ArrowRight,
    Info,
    Code,
    FileJson,
    ChevronsUpDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// 动作类型定义
interface ActionV2 {
    id: string
    pluginId: string
    pluginName?: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
}

// 旧版动作类型（用于兼容）
interface ActionLegacy {
    type: string
    name: string
    description?: string
    config: string // JSON 字符串
    enabled: boolean
    order: number
}

// UI Schema 定义
interface UIField {
    name: string
    label: string
    type: string
    description?: string
    options?: Array<{ value: string; label: string }>
}

interface UISchema {
    fields: UIField[]
    help_text?: string
}

interface PluginInfo {
    id: string
    name: string
    description: string
    type?: string
}

interface PluginData {
    info: PluginInfo
    schema: UISchema
}

interface ActionReadonlyViewProps {
    actions: any[] // 支持 V2 和旧版动作
    className?: string
}

// 单个动作项组件
function ActionItem({
    action,
    index,
    pluginData,
    isExpanded,
    onToggle
}: {
    action: ActionV2 | ActionLegacy
    index: number
    pluginData?: PluginData
    isExpanded: boolean
    onToggle: () => void
}) {
    // 判断是否为 V2 格式
    const isV2 = 'pluginId' in action

    // 统一获取动作信息
    const actionName = isV2
        ? (action.pluginName || action.pluginId || `动作 ${index + 1}`)
        : (action as ActionLegacy).name || `动作 ${index + 1}`

    const actionType = isV2 ? action.pluginId : (action as ActionLegacy).type
    const actionEnabled = action.enabled !== false
    const actionOrder = isV2 ? action.executionOrder : (action as ActionLegacy).order

    // 解析配置
    const config = isV2
        ? action.config
        : (() => {
            try {
                return JSON.parse((action as ActionLegacy).config)
            } catch {
                return {}
            }
        })()

    // 获取动作摘要
    const getActionSummary = () => {
        switch (actionType) {
            case 'email_transform_action':
                const transformType = config.transform_type || 'template'
                const targetField = config.target_field || 'subject'
                return `转换 ${targetField} (${transformType})`
            case 'email_forward_action':
                return `转发到 ${config.to_address || '未配置'}`
            case 'telegram_bot_action':
                return `发送 Telegram 消息`
            case 'webhook_action':
                return `调用 Webhook: ${config.url || '未配置'}`
            case 'modify_content':
                const parts = []
                if (config.subject_prefix) parts.push(`添加前缀 "${config.subject_prefix}"`)
                if (config.add_tag) parts.push(`添加标签 "${config.add_tag}"`)
                if (config.mark_as_read) parts.push('标记为已读')
                if (config.move_to_folder) parts.push(`移动到 ${config.move_to_folder}`)
                return parts.length > 0 ? parts.join('，') : '修改邮件内容'
            case 'smtp':
                return `发送邮件到 ${config.to || '未配置'}`
            default:
                return pluginData?.info?.description || '自定义动作'
        }
    }

    // 获取动作类型的展示名称
    const getActionTypeName = () => {
        if (pluginData?.info?.name) return pluginData.info.name

        switch (actionType) {
            case 'email_transform_action': return '邮件转换'
            case 'email_forward_action': return '邮件转发'
            case 'telegram_bot_action': return 'Telegram 通知'
            case 'webhook_action': return 'Webhook 调用'
            case 'modify_content': return '修改内容'
            case 'smtp': return '发送邮件'
            default: return actionType || '未知类型'
        }
    }

    // 渲染配置字段值
    const renderConfigValue = (key: string, value: any): React.ReactNode => {
        if (value === null || value === undefined) {
            return <span className="text-gray-400 italic">未设置</span>
        }
        if (typeof value === 'boolean') {
            return value ? (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    是
                </Badge>
            ) : (
                <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
                    <XCircle className="h-3 w-3 mr-1" />
                    否
                </Badge>
            )
        }
        if (typeof value === 'object') {
            return (
                <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-2 rounded overflow-x-auto font-mono">
                    {JSON.stringify(value, null, 2)}
                </pre>
            )
        }
        // 长文本特殊处理
        if (typeof value === 'string' && value.length > 100) {
            return (
                <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-2 rounded overflow-x-auto whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                    {value}
                </pre>
            )
        }
        return <span className="font-medium">{String(value)}</span>
    }

    // 获取字段标签（从 schema 或使用默认映射）
    const getFieldLabel = (key: string): string => {
        const field = pluginData?.schema?.fields?.find(f => f.name === key)
        if (field?.label) return field.label

        // 默认映射
        const labelMap: Record<string, string> = {
            to_address: '收件地址',
            cc_address: '抄送地址',
            subject: '主题',
            subject_prefix: '主题前缀',
            body: '邮件内容',
            to: '收件人',
            cc: '抄送',
            bcc: '密送',
            message: '消息内容',
            chat_id: 'Chat ID',
            bot_token: 'Bot Token',
            url: 'URL 地址',
            method: '请求方法',
            headers: '请求头',
            transform_type: '转换类型',
            target_field: '目标字段',
            template: '模板',
            expression: '表达式',
            add_tag: '添加标签',
            mark_as_read: '标记为已读',
            move_to_folder: '移动到文件夹',
            include_original: '包含原始邮件',
            parse_mode: '解析模式',
            auto_escape: '自动转义',
            alias: '动作别名',
        }
        return labelMap[key] || key
    }

    // 过滤掉空值和别名字段（别名单独显示）
    const filteredConfig = Object.entries(config).filter(([key, value]) => {
        if (key === 'alias') return false
        if (value === null || value === undefined || value === '') return false
        if (Array.isArray(value) && value.length === 0) return false
        return true
    })

    return (
        <Card className={cn(
            "transition-all duration-200",
            !actionEnabled && "opacity-60",
            isExpanded && "ring-1 ring-blue-200 dark:ring-blue-800"
        )}>
            {/* 卡片头部 */}
            <CardHeader
                className={cn(
                    "py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors",
                    isExpanded ? "bg-gray-50 dark:bg-gray-800/30" : ""
                )}
                onClick={onToggle}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {/* 展开/折叠指示器 */}
                        <div className="text-gray-400">
                            {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                            ) : (
                                <ChevronRight className="h-4 w-4" />
                            )}
                        </div>

                        {/* 执行顺序 */}
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800">
                            <Hash className="h-3 w-3 mr-0.5" />
                            {actionOrder !== undefined ? actionOrder + 1 : index + 1}
                        </Badge>

                        {/* 动作图标和名称 */}
                        <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-amber-500" />
                            <span className="font-medium text-sm">{actionName}</span>
                        </div>

                        {/* 动作类型标签 */}
                        <Badge variant="secondary" className="text-xs">
                            {getActionTypeName()}
                        </Badge>

                        {/* 别名显示 */}
                        {config.alias && (
                            <Badge variant="outline" className="text-xs text-purple-600 border-purple-200 bg-purple-50 dark:bg-purple-900/20">
                                <Code className="h-3 w-3 mr-1" />
                                ${config.alias}
                            </Badge>
                        )}
                    </div>

                    {/* 状态标识 */}
                    <Badge variant={actionEnabled ? 'default' : 'secondary'} className={cn(
                        "text-xs",
                        actionEnabled
                            ? "bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-500"
                    )}>
                        {actionEnabled ? (
                            <>
                                <CheckCircle className="h-3 w-3 mr-1" />
                                已启用
                            </>
                        ) : (
                            <>
                                <XCircle className="h-3 w-3 mr-1" />
                                已禁用
                            </>
                        )}
                    </Badge>
                </div>

                {/* 动作摘要（折叠状态下显示） */}
                {!isExpanded && (
                    <p className="text-xs text-gray-500 mt-2 ml-11 line-clamp-1">
                        {getActionSummary()}
                    </p>
                )}
            </CardHeader>

            {/* 展开内容 */}
            {isExpanded && (
                <CardContent className="pt-0 pb-4">
                    {/* 动作描述 */}
                    {((action as ActionLegacy).description || pluginData?.info?.description) && (
                        <div className="flex items-start gap-2 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-blue-700 dark:text-blue-300">
                                {(action as ActionLegacy).description || pluginData?.info?.description}
                            </p>
                        </div>
                    )}

                    {/* 配置参数展示 */}
                    {filteredConfig.length > 0 ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                <Settings className="h-4 w-4" />
                                配置参数
                            </div>
                            <div className="grid gap-3 pl-6">
                                {filteredConfig.map(([key, value]) => (
                                    <div key={key} className="grid grid-cols-[140px,1fr] gap-4 items-start">
                                        <label className="text-sm text-gray-500 flex items-center gap-1">
                                            <span className="truncate">{getFieldLabel(key)}</span>
                                        </label>
                                        <div className="text-sm break-all">
                                            {renderConfigValue(key, value)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-4 text-gray-400 text-sm">
                            <FileJson className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            暂无配置参数
                        </div>
                    )}
                </CardContent>
            )}
        </Card>
    )
}

// 主组件
export function ActionReadonlyView({ actions, className }: ActionReadonlyViewProps) {
    const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())
    const [pluginSchemas, setPluginSchemas] = useState<Record<string, PluginData>>({})
    const [isLoading, setIsLoading] = useState(true)

    // 获取插件 schema
    const fetchPluginSchemas = useCallback(async () => {
        try {
            setIsLoading(true)
            const schemas = await apiClient.get('/plugins/ui/schemas', {
                params: { type: 'action' }
            })
            setPluginSchemas(schemas || {})
        } catch (error) {
            console.error('获取插件配置架构失败:', error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchPluginSchemas()
    }, [fetchPluginSchemas])

    // 切换展开状态
    const toggleItem = (index: number) => {
        const newExpanded = new Set(expandedItems)
        if (newExpanded.has(index)) {
            newExpanded.delete(index)
        } else {
            newExpanded.add(index)
        }
        setExpandedItems(newExpanded)
    }

    // 全部展开/折叠
    const expandAll = () => {
        setExpandedItems(new Set(actions.map((_, i) => i)))
    }

    const collapseAll = () => {
        setExpandedItems(new Set())
    }

    const allExpanded = expandedItems.size === actions.length && actions.length > 0

    if (actions.length === 0) {
        return (
            <Card className={cn("h-full flex items-center justify-center", className)}>
                <CardContent className="text-center py-12">
                    <Zap className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                    <p className="text-gray-500">暂无动作配置</p>
                    <p className="text-sm text-gray-400 mt-1">此触发器匹配后不会执行任何动作</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className={cn("space-y-4", className)}>
            {/* 头部信息 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-500">
                        共 <span className="font-medium text-gray-700 dark:text-gray-300">{actions.length}</span> 个执行动作
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={allExpanded ? collapseAll : expandAll}
                    className="text-xs gap-1"
                >
                    <ChevronsUpDown className="h-3 w-3" />
                    {allExpanded ? '全部折叠' : '全部展开'}
                </Button>
            </div>

            {/* 动作流程可视化 */}
            <div className="flex items-center gap-2 py-2 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg overflow-x-auto">
                {actions.map((action, index) => {
                    const isV2 = 'pluginId' in action
                    const name = isV2 ? (action.pluginName || action.pluginId) : action.name
                    const enabled = action.enabled !== false

                    return (
                        <React.Fragment key={index}>
                            <Badge
                                variant="outline"
                                className={cn(
                                    "whitespace-nowrap cursor-pointer transition-all",
                                    enabled
                                        ? "bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
                                        : "opacity-50",
                                    expandedItems.has(index) && "ring-2 ring-blue-400"
                                )}
                                onClick={() => toggleItem(index)}
                            >
                                <Hash className="h-3 w-3 mr-1" />
                                {name}
                            </Badge>
                            {index < actions.length - 1 && (
                                <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            )}
                        </React.Fragment>
                    )
                })}
            </div>

            {/* 动作列表 */}
            <div className="space-y-3">
                {actions.map((action, index) => {
                    const isV2 = 'pluginId' in action
                    const pluginId = isV2 ? action.pluginId : action.type

                    return (
                        <ActionItem
                            key={isV2 ? action.id : index}
                            action={action}
                            index={index}
                            pluginData={pluginSchemas[pluginId]}
                            isExpanded={expandedItems.has(index)}
                            onToggle={() => toggleItem(index)}
                        />
                    )
                })}
            </div>
        </div>
    )
}

export default ActionReadonlyView
