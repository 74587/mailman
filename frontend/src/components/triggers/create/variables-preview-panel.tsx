'use client'

import React, { useMemo, useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronRight, Copy, Check, Mail, Zap, Variable, Layers, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// 变量类型标签颜色
const TYPE_COLORS: Record<string, string> = {
    string: 'bg-green-100 text-green-700',
    number: 'bg-blue-100 text-blue-700',
    boolean: 'bg-purple-100 text-purple-700',
    object: 'bg-orange-100 text-orange-700',
    array: 'bg-pink-100 text-pink-700',
}

// 内置邮件变量定义（含类型和示例）
const BUILTIN_EMAIL_VARIABLES = [
    { name: 'Subject', path: '$.Subject', type: 'string', description: '邮件主题', example: '"会议通知"' },
    { name: 'From', path: '$.From', type: 'string', description: '发件人地址', example: '"user@example.com"' },
    { name: 'To', path: '$.To', type: 'string', description: '收件人地址', example: '"team@company.com"' },
    { name: 'Cc', path: '$.Cc', type: 'string', description: '抄送地址', example: '""' },
    { name: 'Body', path: '$.Body', type: 'string', description: '邮件正文', example: '"..."' },
    { name: 'TextBody', path: '$.TextBody', type: 'string', description: '纯文本正文', example: '"..."' },
    { name: 'HTMLBody', path: '$.HTMLBody', type: 'string', description: 'HTML 正文', example: '"<html>..."' },
    { name: 'MessageID', path: '$.MessageID', type: 'string', description: '消息 ID', example: '"<abc@mail>"' },
    { name: 'ReceivedAt', path: '$.ReceivedAt', type: 'string', description: '接收时间', example: '"2024-01-01T00:00:00Z"' },
    { name: 'HasAttachments', path: '$.HasAttachments', type: 'boolean', description: '是否有附件', example: 'false' },
]

interface VariableItem {
    name: string
    path: string
    type?: string
    description?: string
    example?: string
    sourceAction?: string
    sourceActionIndex?: number
}

interface VariablesPreviewPanelProps {
    selectedActionIndex: number | null
    actions: Array<{
        id: string
        pluginId: string
        pluginName: string
        config: Record<string, any>
        enabled: boolean
        executionOrder: number
    }>
    currentStep: number
}

// 高亮匹配文本的辅助函数
function highlightMatch(text: string, query: string): React.ReactNode {
    if (!query || !text) return text
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const index = lowerText.indexOf(lowerQuery)
    if (index === -1) return text
    return (
        <>
            {text.slice(0, index)}
            <mark className="bg-yellow-200 dark:bg-yellow-600 px-0.5 rounded">{text.slice(index, index + query.length)}</mark>
            {text.slice(index + query.length)}
        </>
    )
}

// 检查变量是否匹配搜索
function matchVariable(variable: VariableItem, query: string): boolean {
    if (!query) return true
    const lowerQuery = query.toLowerCase()
    return (
        variable.path.toLowerCase().includes(lowerQuery) ||
        variable.name.toLowerCase().includes(lowerQuery) ||
        (variable.description?.toLowerCase().includes(lowerQuery) ?? false) ||
        (variable.example?.toLowerCase().includes(lowerQuery) ?? false)
    )
}

export function VariablesPreviewPanel({
    selectedActionIndex,
    actions,
    currentStep
}: VariablesPreviewPanelProps) {
    const [isBuiltinExpanded, setIsBuiltinExpanded] = useState(false)
    const [isDynamicExpanded, setIsDynamicExpanded] = useState(true)
    const [isStepExpanded, setIsStepExpanded] = useState(true)
    const [copiedPath, setCopiedPath] = useState<string | null>(null)
    const [showSearch, setShowSearch] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const searchInputRef = useRef<HTMLInputElement>(null)

    // 当搜索框打开时自动聚焦
    useEffect(() => {
        if (showSearch && searchInputRef.current) {
            searchInputRef.current.focus()
        }
    }, [showSearch])

    // 计算全局动态变量（用户显式设置的）
    const dynamicVariables = useMemo<VariableItem[]>(() => {
        const variables: VariableItem[] = []
        if (!actions || actions.length === 0) return variables

        const maxIndex = selectedActionIndex !== null ? selectedActionIndex : actions.length

        for (let i = 0; i < maxIndex; i++) {
            const action = actions[i]
            if (!action.enabled) continue

            if (action.pluginId === 'email_transform_action_v2' && action.config?.rules) {
                const rules = action.config.rules
                if (Array.isArray(rules)) {
                    rules.forEach((rule: any) => {
                        if (rule.output_mode === 'set_variable' && rule.target_variable) {
                            variables.push({
                                name: rule.target_variable,
                                path: `$.${rule.target_variable}`,
                                type: rule.variable_type || 'string',
                                description: rule.variable_description || '转换结果',
                                example: rule.variable_example,
                                sourceAction: action.pluginName || action.pluginId,
                                sourceActionIndex: i
                            })
                        }
                    })
                }
            }

            // AI 处理动作的变量
            // 注意：output_mode 可能为空（默认为 set_variable），或者显式设置为 'set_variable'
            if (action.pluginId === 'ai_process_action' && action.config?.target_variable) {
                const outputMode = action.config.output_mode || 'set_variable'
                if (outputMode === 'set_variable') {
                    variables.push({
                        name: action.config.target_variable,
                        path: `$.${action.config.target_variable}`,
                        type: 'string',
                        description: action.config.variable_description || 'AI 处理结果',
                        sourceAction: action.pluginName || 'AI 处理',
                        sourceActionIndex: i
                    })
                }
            }
        }

        // $_ 变量
        if (maxIndex > 0) {
            const prevAction = actions[maxIndex - 1]
            if (prevAction?.enabled) {
                variables.push({
                    name: '_',
                    path: '$_',
                    type: 'object',
                    description: '上一个动作输出',
                    sourceAction: prevAction.pluginName || prevAction.pluginId,
                    sourceActionIndex: maxIndex - 1
                })
            }
        }

        return variables
    }, [actions, selectedActionIndex])

    // 计算 $step 变量（内部变量）
    const stepVariables = useMemo<VariableItem[]>(() => {
        const variables: VariableItem[] = []
        if (!actions || actions.length === 0) return variables

        const maxIndex = selectedActionIndex !== null ? selectedActionIndex : actions.length

        for (let i = 0; i < maxIndex; i++) {
            const action = actions[i]
            if (!action.enabled) continue

            const alias = action.config?.alias as string || ''

            // 每个步骤的内部变量
            variables.push({
                name: `step[${i}].output`,
                path: `$step[${i}].output`,
                type: 'object',
                description: `${action.pluginName || action.pluginId} 的输出`,
                sourceAction: action.pluginName || action.pluginId,
                sourceActionIndex: i
            })

            // 如果有别名，添加别名访问
            if (alias) {
                variables.push({
                    name: `step.${alias}.output`,
                    path: `$step.${alias}.output`,
                    type: 'object',
                    description: `${action.pluginName || action.pluginId} 的输出 (别名访问)`,
                    sourceAction: action.pluginName || action.pluginId,
                    sourceActionIndex: i
                })
            }
        }

        return variables
    }, [actions, selectedActionIndex])

    // 过滤后的变量列表
    const filteredBuiltin = useMemo(() =>
        BUILTIN_EMAIL_VARIABLES.filter(v => matchVariable(v, searchQuery)),
        [searchQuery]
    )
    const filteredDynamic = useMemo(() =>
        dynamicVariables.filter(v => matchVariable(v, searchQuery)),
        [dynamicVariables, searchQuery]
    )
    const filteredStep = useMemo(() =>
        stepVariables.filter(v => matchVariable(v, searchQuery)),
        [stepVariables, searchQuery]
    )

    const handleCopy = async (path: string) => {
        try {
            await navigator.clipboard.writeText(path)
            setCopiedPath(path)
            setTimeout(() => setCopiedPath(null), 2000)
        } catch (err) {
            console.error('复制失败:', err)
        }
    }

    const renderVariableItem = (variable: VariableItem, showSource = false, showType = false) => (
        <div
            key={variable.path}
            className="group flex items-center justify-between py-0.5 px-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                    <code className="text-[10px] font-mono text-blue-600 dark:text-blue-400 truncate">
                        {highlightMatch(variable.path, searchQuery)}
                    </code>
                    {showType && variable.type && (
                        <span className={`text-[8px] px-1 rounded ${TYPE_COLORS[variable.type] || 'bg-gray-100 text-gray-700'}`}>
                            {variable.type}
                        </span>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleCopy(variable.path)}
                    >
                        {copiedPath === variable.path ? (
                            <Check className="h-2.5 w-2.5 text-green-500" />
                        ) : (
                            <Copy className="h-2.5 w-2.5 text-gray-400" />
                        )}
                    </Button>
                </div>
                {showSource && variable.sourceAction && (
                    <div className="text-[9px] text-amber-600 truncate">
                        ← #{(variable.sourceActionIndex ?? 0) + 1} {variable.sourceAction}
                    </div>
                )}
                {variable.description && (
                    <div className="text-[9px] text-gray-500 truncate">
                        {highlightMatch(variable.description, searchQuery)}
                    </div>
                )}
                {variable.example && (
                    <div className="text-[9px] text-gray-400 truncate">
                        例: {highlightMatch(variable.example, searchQuery)}
                    </div>
                )}
            </div>
        </div>
    )

    // 在"执行动作"步骤显示变量预览
    // 创建模式：步骤 2 是执行动作
    // 编辑模式：步骤 3 是执行动作（因为基本信息在第一步）
    // 也在过滤条件步骤显示（创建模式步骤1，编辑模式步骤2）
    if (currentStep !== 1 && currentStep !== 2 && currentStep !== 3) return null

    const totalMatches = filteredBuiltin.length + filteredDynamic.length + filteredStep.length

    return (
        <div className="space-y-1.5 border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 relative">
                <Variable className="w-3 h-3" />
                可用变量
                {selectedActionIndex !== null && (
                    <span className="text-[10px] text-gray-400">(#{selectedActionIndex + 1})</span>
                )}
                {/* 搜索按钮 */}
                <button
                    onClick={() => {
                        setShowSearch(!showSearch)
                        if (showSearch) setSearchQuery('')
                    }}
                    className={`ml-auto p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors ${showSearch ? 'bg-gray-200 dark:bg-gray-600' : ''}`}
                    title="搜索变量"
                >
                    <Search className="w-3 h-3" />
                </button>
            </div>

            {/* 搜索框 */}
            {showSearch && (
                <div className="relative">
                    <Input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索变量..."
                        className="h-6 text-[10px] pl-2 pr-6"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                        >
                            <X className="w-3 h-3 text-gray-400" />
                        </button>
                    )}
                    {searchQuery && (
                        <div className="text-[9px] text-gray-400 mt-0.5">
                            找到 {totalMatches} 个匹配
                        </div>
                    )}
                </div>
            )}

            {/* 内置变量 */}
            {filteredBuiltin.length > 0 && (
                <div>
                    <button
                        onClick={() => setIsBuiltinExpanded(!isBuiltinExpanded)}
                        className="flex items-center gap-1 w-full text-[10px] font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white py-0.5"
                    >
                        {isBuiltinExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <Mail className="w-3 h-3" />
                        内置变量
                        <span className="text-[9px] text-gray-400 ml-auto">{filteredBuiltin.length}</span>
                    </button>
                    {isBuiltinExpanded && (
                        <div className="ml-3 border-l border-gray-200 dark:border-gray-700 pl-1.5 max-h-28 overflow-y-auto">
                            {filteredBuiltin.map(v => renderVariableItem(v, false, true))}
                        </div>
                    )}
                </div>
            )}

            {/* 全局动态变量 */}
            {filteredDynamic.length > 0 && (
                <div>
                    <button
                        onClick={() => setIsDynamicExpanded(!isDynamicExpanded)}
                        className="flex items-center gap-1 w-full text-[10px] font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white py-0.5"
                    >
                        {isDynamicExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <Zap className="w-3 h-3 text-amber-500" />
                        全局变量
                        <span className="text-[9px] text-gray-400 ml-auto">{filteredDynamic.length}</span>
                    </button>
                    {isDynamicExpanded && (
                        <div className="ml-3 border-l border-amber-200 dark:border-amber-700 pl-1.5 max-h-24 overflow-y-auto">
                            {filteredDynamic.map(v => renderVariableItem(v, true, true))}
                        </div>
                    )}
                </div>
            )}

            {/* $step 步骤变量 */}
            {filteredStep.length > 0 && (
                <div>
                    <button
                        onClick={() => setIsStepExpanded(!isStepExpanded)}
                        className="flex items-center gap-1 w-full text-[10px] font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white py-0.5"
                    >
                        {isStepExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <Layers className="w-3 h-3 text-purple-500" />
                        步骤变量 ($step)
                        <span className="text-[9px] text-gray-400 ml-auto">{filteredStep.length}</span>
                    </button>
                    {isStepExpanded && (
                        <div className="ml-3 border-l border-purple-200 dark:border-purple-700 pl-1.5 max-h-24 overflow-y-auto">
                            {filteredStep.map(v => renderVariableItem(v, true, true))}
                        </div>
                    )}
                </div>
            )}

            {/* 无搜索结果 */}
            {searchQuery && totalMatches === 0 && (
                <div className="text-[9px] text-gray-400 italic pl-4 py-2">
                    未找到匹配的变量
                </div>
            )}

            {!searchQuery && dynamicVariables.length === 0 && stepVariables.length === 0 && selectedActionIndex === 0 && (
                <div className="text-[9px] text-gray-400 italic pl-4">首个动作，仅可使用内置变量</div>
            )}
        </div>
    )
}
