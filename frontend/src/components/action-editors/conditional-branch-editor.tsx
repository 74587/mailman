'use client'

import React, { useState, useCallback, useEffect, createContext, useContext } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
    ChevronDown,
    ChevronRight,
    Plus,
    Trash2,
    GitBranch,
    Copy,
    Filter,
    Zap,
    ChevronsUp,
    ChevronsDown,
    Layers,
    MessageSquare,
    Sparkles
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'

// 复用现有的完整过滤器组件 (支持模板、多种条件类型)
import { FilterSection } from '@/components/filter-action-trigger/filter-section'
// 复用现有的动作组件
import { ActionSection } from '@/components/filter-action-trigger/action-section'
// 描述输入组件和面包屑
import { DescriptionInput, useStickyBreadcrumb, useAncestors, AncestorProvider, BreadcrumbItem } from '@/components/ui/sticky-breadcrumb'
// AI 描述服务
import { aiDescriptionService } from '@/services/ai-description.service'
import { toast } from 'sonner'

// 嵌套层级上下文
const NestingContext = createContext<{ level: number; maxLevel: number }>({ level: 0, maxLevel: 3 })

// 分支内的动作配置 (与 ActionSection 兼容)
interface BranchAction {
    id: string
    pluginId: string
    pluginName: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
    description?: string // 通用描述字段
}

// 条件分支
interface ConditionalBranch {
    id: string
    name: string
    description?: string // 通用描述字段
    conditions: any[] // 使用 any[] 以兼容 FilterSection 的格式
    actions: BranchAction[]
    collapsed: boolean
}

// 条件分支配置
interface ConditionalBranchConfig {
    branches: ConditionalBranch[]
    else_actions: BranchAction[]
    else_name?: string // ELSE 分支名称
    else_description?: string // ELSE 分支描述
    return_first_match: boolean
    description?: string // 整体描述
}

interface ConditionalBranchEditorProps {
    config: Partial<ConditionalBranchConfig> | Record<string, any>
    onChange: (config: ConditionalBranchConfig | Record<string, any>) => void
    availablePlugins?: Array<{
        id: string
        name: string
        description: string
    }>
    testData?: Record<string, any>
    // 嵌套层级（用于样式调整）
    nestingLevel?: number
    // 动作选择回调
    onActionSelect?: (action: any) => void
    // 父动作 ID，用于生成 ELSE 分支的 ID
    actionId?: string
}

// 层级颜色配置
const levelColors = [
    { border: 'border-l-blue-500', bg: 'bg-blue-50/30 dark:bg-blue-900/10', badge: 'bg-blue-100 text-blue-700' },
    { border: 'border-l-purple-500', bg: 'bg-purple-50/30 dark:bg-purple-900/10', badge: 'bg-purple-100 text-purple-700' },
    { border: 'border-l-emerald-500', bg: 'bg-emerald-50/30 dark:bg-emerald-900/10', badge: 'bg-emerald-100 text-emerald-700' },
    { border: 'border-l-orange-500', bg: 'bg-orange-50/30 dark:bg-orange-900/10', badge: 'bg-orange-100 text-orange-700' },
    { border: 'border-l-pink-500', bg: 'bg-pink-50/30 dark:bg-pink-900/10', badge: 'bg-pink-100 text-pink-700' },
]

// 单个分支编辑器
function BranchEditor({
    branch,
    branchIndex,
    isFirst,
    onUpdate,
    onDelete,
    onDuplicate,
    testData,
    isCompact,
    onActionSelect
}: {
    branch: ConditionalBranch
    branchIndex: number
    isFirst: boolean
    onUpdate: (branch: ConditionalBranch) => void
    onDelete: () => void
    onDuplicate: () => void
    testData?: Record<string, any>
    isCompact?: boolean
    onActionSelect?: (action: any) => void
}) {
    const { level } = useContext(NestingContext)
    const { selectItem } = useStickyBreadcrumb()
    const { ancestors } = useAncestors()
    const [collapsed, setCollapsed] = useState(branch.collapsed || false)
    const [activeTab, setActiveTab] = useState<'conditions' | 'actions'>('conditions')

    // 根据层级获取颜色
    const colorIndex = level % levelColors.length
    const levelColor = levelColors[colorIndex]

    // 面包屑项
    const breadcrumbItem: BreadcrumbItem = {
        id: branch.id,
        type: 'branch' as const,
        label: isFirst ? `IF: ${branch.name || '分支 1'}` : `ELSE IF: ${branch.name || `分支 ${branchIndex + 1}`}`,
        description: branch.description,
        level: level
    }

    // 处理分支选中 - 传递祖先信息，同时阻止事件冒泡
    const handleBranchSelect = useCallback((e: React.MouseEvent) => {
        e.stopPropagation() // 阻止事件冒泡，确保只有当前分支更新面包屑
        selectItem(breadcrumbItem, ancestors)
        // 通知外部选中了分支
        onActionSelect?.({
            id: branch.id,
            type: 'branch',
            // 避免覆盖 id，手动合并属性
            name: branch.name,
            description: branch.description,
            conditions: branch.conditions,
            actions: branch.actions,
            collapsed: branch.collapsed
        })
    }, [selectItem, breadcrumbItem, ancestors, branch, onActionSelect])

    // 获取条件数量
    const getConditionCount = useCallback((conditions: any[]): number => {
        if (!conditions || conditions.length === 0) return 0
        let count = 0
        for (const item of conditions) {
            if (item.type === 'group' && item.conditions) {
                count += getConditionCount(item.conditions)
            } else if (item.type !== 'group') {
                count += 1
            }
        }
        return count
    }, [])

    // 获取分支摘要
    const getSummary = () => {
        const condCount = getConditionCount(branch.conditions)
        const actionCount = branch.actions?.length || 0
        return `${condCount} 个条件 → ${actionCount} 个动作`
    }

    // 处理条件更新
    const handleConditionsChange = useCallback((conditions: any[]) => {
        onUpdate({ ...branch, conditions })
    }, [branch, onUpdate])

    // 处理动作更新
    const handleActionsChange = useCallback((actions: BranchAction[]) => {
        onUpdate({ ...branch, actions })
    }, [branch, onUpdate])

    // 处理描述更新
    const handleDescriptionChange = useCallback((description: string) => {
        onUpdate({ ...branch, description })
    }, [branch, onUpdate])

    // AI 自动生成描述
    const handleGenerateDescription = useCallback(() => {
        const autoDesc = aiDescriptionService.forBranch(branch)
        if (autoDesc) {
            onUpdate({ ...branch, description: autoDesc })
        }
    }, [branch, onUpdate])

    return (
        <div
            data-branch-id={branch.id}
            data-action-id={branch.id}
            onClick={handleBranchSelect}
            className="cursor-pointer transition-all"
        >
            <Card className={`border-l-4 ${isFirst ? 'border-l-blue-500' : levelColor.border} overflow-hidden ${isCompact ? 'text-sm' : ''}`}>
                {/* 分支头部 */}
                <CardHeader className={`py-2 px-3 bg-gray-50 dark:bg-gray-800/50 ${isCompact ? 'py-1.5 px-2' : ''}`}>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                setCollapsed(!collapsed);
                            }}
                            className={`p-0 ${isCompact ? 'h-6 w-6' : 'h-8 w-8'}`}
                        >
                            {collapsed ? <ChevronRight className={isCompact ? 'h-3 w-3' : 'h-4 w-4'} /> : <ChevronDown className={isCompact ? 'h-3 w-3' : 'h-4 w-4'} />}
                        </Button>

                        <Badge variant={isFirst ? 'default' : 'secondary'} className={`${isCompact ? 'text-[10px] px-1.5 py-0' : 'text-xs'}`}>
                            {isFirst ? 'IF' : 'ELSE IF'}
                        </Badge>

                        {/* 层级指示器 */}
                        {level > 0 && (
                            <Badge variant="outline" className={`${isCompact ? 'text-[10px] px-1' : 'text-xs px-1.5'} ${levelColor.badge}`}>
                                <Layers className={isCompact ? 'h-2 w-2 mr-0.5' : 'h-3 w-3 mr-1'} />
                                L{level + 1}
                            </Badge>
                        )}

                        <Input
                            value={branch.name || ''}
                            onChange={(e) => onUpdate({ ...branch, name: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            placeholder={`分支 ${branchIndex + 1}`}
                            className={`bg-white dark:bg-gray-700 flex-1 max-w-[120px] ${isCompact ? 'h-6 text-xs' : 'h-8 text-sm'}`}
                        />

                        {/* 折叠时显示描述，展开时显示摘要 */}
                        {collapsed && branch.description ? (
                            <span className={`text-gray-500 truncate max-w-[150px] hidden md:inline ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                                · {branch.description}
                            </span>
                        ) : (
                            <span className={`text-gray-500 hidden lg:inline ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                                {getSummary()}
                            </span>
                        )}

                        <div className="flex-1" />

                        {/* 描述编辑和 AI 生成按钮 */}
                        {!collapsed && (
                            <div className="flex items-center gap-1">
                                <DescriptionInput
                                    value={branch.description}
                                    onChange={handleDescriptionChange}
                                    placeholder="添加描述"
                                    compact={isCompact}
                                />
                                {!branch.description && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleGenerateDescription();
                                        }}
                                        className={`p-0 text-purple-500 hover:text-purple-700 ${isCompact ? 'h-5 w-5' : 'h-6 w-6'}`}
                                        title="AI 自动生成描述"
                                    >
                                        <Sparkles className={isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                                    </Button>
                                )}
                            </div>
                        )}

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDuplicate();
                            }}
                            className={`p-0 ${isCompact ? 'h-6 w-6' : 'h-8 w-8'}`}
                            title="复制分支"
                        >
                            <Copy className={isCompact ? 'h-3 w-3' : 'h-4 w-4'} />
                        </Button>

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                            className={`p-0 text-red-500 hover:text-red-700 ${isCompact ? 'h-6 w-6' : 'h-8 w-8'}`}
                            title="删除分支"
                        >
                            <Trash2 className={isCompact ? 'h-3 w-3' : 'h-4 w-4'} />
                        </Button>
                    </div>
                </CardHeader>

                {/* 分支内容 */}
                {!collapsed && (
                    <CardContent className="p-0">
                        {/* 标签页切换 */}
                        <div className="flex border-b">
                            <button
                                onClick={(e) => { e.stopPropagation(); setActiveTab('conditions'); }}
                                className={`flex-1 py-1.5 text-xs font-medium flex items-center justify-center gap-1.5 ${activeTab === 'conditions'
                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 border-b-2 border-blue-500'
                                    : 'text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                                    }`}
                            >
                                <Filter className="h-3 w-3" />
                                条件
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    {getConditionCount(branch.conditions)}
                                </Badge>
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setActiveTab('actions'); }}
                                className={`flex-1 py-1.5 text-xs font-medium flex items-center justify-center gap-1.5 ${activeTab === 'actions'
                                    ? 'bg-green-50 dark:bg-green-900/30 text-green-600 border-b-2 border-green-500'
                                    : 'text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
                                    }`}
                            >
                                <Zap className="h-3 w-3" />
                                动作
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    {branch.actions?.length || 0}
                                </Badge>
                            </button>
                        </div>

                        {/* 条件配置 - 使用 AncestorProvider 传递当前分支作为祖先 */}
                        {activeTab === 'conditions' && (
                            <div className={`${isCompact ? 'p-2' : 'p-3'}`}>
                                <AncestorProvider currentItem={breadcrumbItem}>
                                    <FilterSection
                                        filters={branch.conditions || []}
                                        onChange={handleConditionsChange}
                                        testData={testData || {}}
                                        hideHeader={true}
                                    />
                                </AncestorProvider>
                            </div>
                        )}

                        {/* 动作配置 - 使用 AncestorProvider 传递当前分支作为祖先 */}
                        {activeTab === 'actions' && (
                            <div className={`${isCompact ? 'p-2' : 'p-3'}`}>
                                <AncestorProvider currentItem={breadcrumbItem}>
                                    <ActionSection
                                        actions={branch.actions || []}
                                        onChange={handleActionsChange}
                                        testData={testData || {}}
                                        hideHeader={true}
                                        onActionSelect={onActionSelect}
                                    />
                                </AncestorProvider>
                            </div>
                        )}
                    </CardContent>
                )}
            </Card>
        </div>
    )
}

// 主组件：条件分支编辑器
export function ConditionalBranchEditor({
    config,
    onChange,
    availablePlugins = [],
    testData,
    nestingLevel = 0,
    onActionSelect,
    actionId
}: ConditionalBranchEditorProps) {
    // 确保 config 有默认值
    const safeConfig: ConditionalBranchConfig = {
        branches: (config as any)?.branches || [],
        else_actions: (config as any)?.else_actions || [],
        else_name: (config as any)?.else_name,
        else_description: (config as any)?.else_description,
        return_first_match: (config as any)?.return_first_match ?? true,
        description: (config as any)?.description
    }

    const [allCollapsed, setAllCollapsed] = useState(false)

    // 根据嵌套层级判断是否使用紧凑模式
    const isCompact = nestingLevel >= 1
    const isDeep = nestingLevel >= 2

    // 创建默认的根条件组 (与 FilterSection 格式一致)
    const createDefaultRootGroup = useCallback(() => ({
        id: uuidv4(),
        type: 'group',
        operator: 'and',
        conditions: []
    }), [])

    // 全部折叠/展开
    const handleToggleAll = useCallback(() => {
        const newCollapsed = !allCollapsed
        setAllCollapsed(newCollapsed)
        const newBranches = safeConfig.branches.map(branch => ({
            ...branch,
            collapsed: newCollapsed
        }))
        onChange({ ...safeConfig, branches: newBranches })
    }, [allCollapsed, safeConfig, onChange])

    // 添加新分支
    const handleAddBranch = useCallback(() => {
        const newBranch: ConditionalBranch = {
            id: uuidv4(),
            name: `分支 ${safeConfig.branches.length + 1}`,
            conditions: [createDefaultRootGroup()],
            actions: [],
            collapsed: false
        }
        onChange({
            ...safeConfig,
            branches: [...safeConfig.branches, newBranch]
        })
    }, [safeConfig, onChange, createDefaultRootGroup])

    // 更新分支
    const handleUpdateBranch = useCallback((index: number, updatedBranch: ConditionalBranch) => {
        const newBranches = [...safeConfig.branches]
        newBranches[index] = updatedBranch
        onChange({ ...safeConfig, branches: newBranches })
    }, [safeConfig, onChange])

    // 删除分支
    const handleDeleteBranch = useCallback((index: number) => {
        if (safeConfig.branches.length <= 1) {
            toast.warning('至少需要保留一个分支')
            return
        }
        const newBranches = safeConfig.branches.filter((_, i) => i !== index)
        onChange({ ...safeConfig, branches: newBranches })
    }, [safeConfig, onChange])

    // 复制分支
    const handleDuplicateBranch = useCallback((index: number) => {
        const branch = safeConfig.branches[index]
        const newBranch: ConditionalBranch = {
            ...JSON.parse(JSON.stringify(branch)),
            id: uuidv4(),
            name: `${branch.name} (副本)`
        }
        const newBranches = [...safeConfig.branches]
        newBranches.splice(index + 1, 0, newBranch)
        onChange({ ...safeConfig, branches: newBranches })
    }, [safeConfig, onChange])

    // 更新默认分支动作
    const handleUpdateElseActions = useCallback((actions: BranchAction[]) => {
        onChange({ ...safeConfig, else_actions: actions })
    }, [safeConfig, onChange])

    // 更新 ELSE 分支名称
    const handleUpdateElseName = useCallback((name: string) => {
        onChange({ ...safeConfig, else_name: name })
    }, [safeConfig, onChange])

    // 更新 ELSE 分支描述
    const handleUpdateElseDescription = useCallback((description: string) => {
        onChange({ ...safeConfig, else_description: description })
    }, [safeConfig, onChange])

    // ELSE 分支的 ID
    const elseId = actionId ? `${actionId}-else` : 'else-branch'

    // 处理 ELSE 分支选中
    const handleElseSelect = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        onActionSelect?.({
            id: elseId,
            type: 'else',
            name: safeConfig.else_name || 'ELSE',
            description: safeConfig.else_description,
            actions: safeConfig.else_actions
        })
    }, [elseId, safeConfig, onActionSelect])

    // 切换只执行第一个匹配
    const handleToggleReturnFirstMatch = useCallback((checked: boolean) => {
        onChange({ ...safeConfig, return_first_match: checked })
    }, [safeConfig, onChange])

    // 更新整体描述
    const handleDescriptionChange = useCallback((description: string) => {
        onChange({ ...safeConfig, description })
    }, [safeConfig, onChange])

    // 初始化时，如果没有分支，添加一个默认分支
    useEffect(() => {
        if (safeConfig.branches.length === 0) {
            handleAddBranch()
        }
    }, [])

    return (
        <NestingContext.Provider value={{ level: nestingLevel, maxLevel: 3 }}>
            <div className={`space-y-3 ${isCompact ? 'text-sm' : ''}`}>
                {/* 头部说明 */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                        <GitBranch className={`text-purple-500 ${isCompact ? 'h-4 w-4' : 'h-5 w-5'}`} />
                        <h3 className={`font-medium ${isCompact ? 'text-sm' : ''}`}>
                            条件分支
                            {nestingLevel > 0 && (
                                <span className="text-gray-400 ml-1 text-xs">(嵌套层级 {nestingLevel + 1})</span>
                            )}
                        </h3>
                        <Badge variant="secondary" className={isCompact ? 'text-[10px]' : 'text-xs'}>
                            {safeConfig.branches.length} 个分支
                        </Badge>

                        {/* 整体描述输入 */}
                        <DescriptionInput
                            value={safeConfig.description}
                            onChange={handleDescriptionChange}
                            placeholder="添加整体描述"
                            compact={isCompact}
                            className="ml-2"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        {/* 全部折叠/展开 */}
                        {safeConfig.branches.length > 1 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleToggleAll}
                                className={`${isCompact ? 'h-6 text-[10px]' : 'h-7 text-xs'}`}
                            >
                                {allCollapsed ? (
                                    <>
                                        <ChevronsDown className={isCompact ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-1'} />
                                        展开全部
                                    </>
                                ) : (
                                    <>
                                        <ChevronsUp className={isCompact ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-1'} />
                                        折叠全部
                                    </>
                                )}
                            </Button>
                        )}

                        {/* 只执行第一个匹配 */}
                        <div className="flex items-center gap-1.5">
                            <Switch
                                id="return-first-match"
                                checked={safeConfig.return_first_match}
                                onCheckedChange={handleToggleReturnFirstMatch}
                                className={isCompact ? 'scale-75' : ''}
                            />
                            <Label htmlFor="return-first-match" className={`cursor-pointer ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                                仅首个匹配
                            </Label>
                        </div>
                    </div>
                </div>

                {/* 深层嵌套警告 */}
                {isDeep && (
                    <div className="text-xs text-orange-600 bg-orange-50 dark:bg-orange-900/20 p-2 rounded flex items-center gap-2">
                        <Layers className="h-4 w-4" />
                        <span>检测到深层嵌套（层级 {nestingLevel + 1}），建议简化逻辑结构以提高可读性</span>
                    </div>
                )}

                {/* 分支列表 */}
                <div className={`space-y-2 ${isCompact ? 'space-y-1.5' : ''}`}>
                    {safeConfig.branches.map((branch, index) => (
                        <BranchEditor
                            key={branch.id}
                            branch={branch}
                            branchIndex={index}
                            isFirst={index === 0}
                            onUpdate={(updatedBranch) => handleUpdateBranch(index, updatedBranch)}
                            onDelete={() => handleDeleteBranch(index)}
                            onDuplicate={() => handleDuplicateBranch(index)}
                            testData={testData}
                            isCompact={isCompact}
                            onActionSelect={onActionSelect}
                        />
                    ))}
                </div>

                {/* 添加分支按钮 */}
                <Button
                    variant="outline"
                    onClick={handleAddBranch}
                    className={`w-full border-dashed ${isCompact ? 'h-7 text-xs' : ''}`}
                >
                    <Plus className={isCompact ? 'h-3 w-3 mr-1' : 'h-4 w-4 mr-2'} />
                    添加分支 (ELSE IF)
                </Button>

                {/* 默认分支 (ELSE) */}
                <div
                    data-action-id={elseId}
                    onClick={handleElseSelect}
                    className="cursor-pointer transition-all"
                >
                    <Card className="border-l-4 border-l-gray-400">
                        <CardHeader className={`bg-gray-50 dark:bg-gray-800/50 ${isCompact ? 'py-1.5 px-2' : 'py-2 px-3'}`}>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className={isCompact ? 'text-[10px]' : 'text-xs'}>
                                    ELSE
                                </Badge>
                                <Input
                                    value={safeConfig.else_name || ''}
                                    onChange={(e) => handleUpdateElseName(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="默认分支"
                                    className={`bg-white dark:bg-gray-700 flex-1 max-w-[120px] ${isCompact ? 'h-6 text-xs' : 'h-8 text-sm'}`}
                                />
                                <span className={`text-gray-500 ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                                    (无匹配时执行)
                                </span>

                                {/* 描述输入 */}
                                <DescriptionInput
                                    value={safeConfig.else_description}
                                    onChange={handleUpdateElseDescription}
                                    placeholder="添加描述"
                                    compact={isCompact}
                                />

                                <Badge variant="outline" className={`ml-auto ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                                    {safeConfig.else_actions?.length || 0} 个动作
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className={isCompact ? 'py-2 px-2' : 'py-3 px-3'}>
                            <ActionSection
                                actions={safeConfig.else_actions || []}
                                onChange={handleUpdateElseActions}
                                testData={testData || {}}
                                hideHeader={true}
                                onActionSelect={onActionSelect}
                            />
                        </CardContent>
                    </Card>
                </div>

                {/* 提示信息 (仅在顶层显示) */}
                {nestingLevel === 0 && (
                    <div className="text-xs text-gray-500 p-2 bg-blue-50 dark:bg-blue-900/20 rounded flex items-start gap-2">
                        <MessageSquare className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <div>
                            <p><strong>提示：</strong>分支按顺序评估，{safeConfig.return_first_match ? '仅执行首个匹配分支' : '所有匹配分支都会执行'}。</p>
                            <p className="mt-1 text-gray-400">💡 为分支添加描述可以在折叠时快速了解业务逻辑</p>
                        </div>
                    </div>
                )}
            </div>
        </NestingContext.Provider>
    )
}

export default ConditionalBranchEditor
