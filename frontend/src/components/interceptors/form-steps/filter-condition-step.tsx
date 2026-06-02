'use client'

import { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Interceptor, FilterMode } from '@/services/interceptor.service'
import { Filter, Check, X, Loader2, Puzzle, Code2, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { ExpressionGroup } from '@/components/expression-builder/expression-group'
import { FilterTestDialog } from '@/components/triggers/create/filter-test-dialog'

interface ActionPluginInfo {
    id: string
    name: string
    description?: string
}

interface FilterConditionStepProps {
    formData: Partial<Interceptor>
    onChange: (updates: Partial<Interceptor>) => void
}

// 全局缓存动作插件列表
let actionPluginsCache: ActionPluginInfo[] | null = null
let actionPluginsFetching = false

export function FilterConditionStep({ formData, onChange }: FilterConditionStepProps) {
    const filter = formData.filter || { mode: 'all' as FilterMode, action_types: [], use_advanced_filter: false, expressions: [] }
    const [actionPlugins, setActionPlugins] = useState<ActionPluginInfo[]>(actionPluginsCache || [])
    const [loadingPlugins, setLoadingPlugins] = useState(false)
    const [showFilterTestDialog, setShowFilterTestDialog] = useState(false)
    const advancedRootExpression = getAdvancedRootExpression(filter.expressions || [])
    const normalizedAdvancedExpressions = getNormalizedAdvancedExpressions(filter.expressions || [])
    const advancedConditionCount = countExpressionConditions(normalizedAdvancedExpressions)

    // 加载动作插件列表
    useEffect(() => {
        const loadActionPlugins = async () => {
            if (actionPluginsCache) {
                setActionPlugins(actionPluginsCache)
                return
            }
            if (actionPluginsFetching) return

            actionPluginsFetching = true
            setLoadingPlugins(true)

            try {
                const data = await apiClient.get('/plugins/ui/schemas', {
                    params: { type: 'action' }
                })
                const plugins = Object.entries(data).map(([id, plugin]: [string, any]) => ({
                    id,
                    name: plugin.info?.name || id,
                    description: plugin.info?.description || ''
                }))
                actionPluginsCache = plugins
                setActionPlugins(plugins)
            } catch (error) {
                console.error('Failed to fetch action plugins:', error)
            } finally {
                actionPluginsFetching = false
                setLoadingPlugins(false)
            }
        }

        loadActionPlugins()
    }, [])

    const updateFilter = (updates: Partial<typeof filter>) => {
        onChange({ filter: { ...filter, ...updates } })
    }

    const toggleActionType = (pluginId: string) => {
        const currentTypes = filter.action_types || []
        const newTypes = currentTypes.includes(pluginId)
            ? currentTypes.filter(t => t !== pluginId)
            : [...currentTypes, pluginId]
        updateFilter({ action_types: newTypes })
    }

    const handleRootExpressionChange = (expression: any) => {
        updateFilter({ expressions: [expression] })
    }

    return (
        <div className="space-y-6">
            {/* 过滤模式选择 */}
            <div className="space-y-4">
                <Label>过滤模式</Label>
                <RadioGroup
                    value={filter.mode}
                    onValueChange={(value: FilterMode) => updateFilter({ mode: value })}
                    className="space-y-3"
                >
                    {/* 全部动作 */}
                    <div
                        className={cn(
                            'flex items-start gap-3 p-4 rounded-lg border transition-all cursor-pointer',
                            filter.mode === 'all'
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:border-muted-foreground/50'
                        )}
                        onClick={() => updateFilter({ mode: 'all' })}
                    >
                        <RadioGroupItem value="all" id="filter-all" className="mt-1" />
                        <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                                <Filter className="w-4 h-4 text-primary" />
                                <Label htmlFor="filter-all" className="font-medium cursor-pointer">
                                    拦截全部动作
                                </Label>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                对所有类型的动作执行拦截，这是最常用的模式
                            </p>
                        </div>
                    </div>

                    {/* 仅包含 */}
                    <div
                        className={cn(
                            'flex items-start gap-3 p-4 rounded-lg border transition-all cursor-pointer',
                            filter.mode === 'include'
                                ? 'border-green-500 bg-green-500/5'
                                : 'border-border hover:border-muted-foreground/50'
                        )}
                        onClick={() => updateFilter({ mode: 'include' })}
                    >
                        <RadioGroupItem value="include" id="filter-include" className="mt-1" />
                        <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                                <Check className="w-4 h-4 text-green-500" />
                                <Label htmlFor="filter-include" className="font-medium cursor-pointer">
                                    仅拦截指定动作
                                </Label>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                只对指定类型的动作执行拦截，其他动作不处理
                            </p>
                        </div>
                    </div>

                    {/* 排除 */}
                    <div
                        className={cn(
                            'flex items-start gap-3 p-4 rounded-lg border transition-all cursor-pointer',
                            filter.mode === 'exclude'
                                ? 'border-red-500 bg-red-500/5'
                                : 'border-border hover:border-muted-foreground/50'
                        )}
                        onClick={() => updateFilter({ mode: 'exclude' })}
                    >
                        <RadioGroupItem value="exclude" id="filter-exclude" className="mt-1" />
                        <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                                <X className="w-4 h-4 text-red-500" />
                                <Label htmlFor="filter-exclude" className="font-medium cursor-pointer">
                                    排除指定动作
                                </Label>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                对除指定类型外的所有动作执行拦截
                            </p>
                        </div>
                    </div>
                </RadioGroup>
            </div>

            {/* 动作类型选择（仅在 include 或 exclude 模式下显示） */}
            {(filter.mode === 'include' || filter.mode === 'exclude') && (
                <div className="space-y-4 p-4 rounded-lg border">
                    <div className="flex items-center justify-between">
                        <Label>
                            {filter.mode === 'include' ? '选择要拦截的动作类型' : '选择要排除的动作类型'}
                        </Label>
                        {(filter.action_types?.length || 0) > 0 && (
                            <Badge variant="secondary">
                                已选择 {filter.action_types?.length} 个
                            </Badge>
                        )}
                    </div>

                    {loadingPlugins ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                            <span className="ml-2 text-sm text-muted-foreground">加载插件列表...</span>
                        </div>
                    ) : actionPlugins.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                            未找到可用的动作插件
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto">
                            {actionPlugins.map(plugin => (
                                <div
                                    key={plugin.id}
                                    className={cn(
                                        'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                                        filter.action_types?.includes(plugin.id)
                                            ? filter.mode === 'include'
                                                ? 'border-green-500 bg-green-50'
                                                : 'border-red-500 bg-red-50'
                                            : 'border-border hover:bg-muted/50'
                                    )}
                                    onClick={() => toggleActionType(plugin.id)}
                                >
                                    <Checkbox
                                        checked={filter.action_types?.includes(plugin.id)}
                                        onChange={() => toggleActionType(plugin.id)}
                                        className="mt-0.5"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <Puzzle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                            <span className="font-medium text-sm truncate">{plugin.name}</span>
                                        </div>
                                        {plugin.description && (
                                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                                {plugin.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 高级过滤条件 */}
            <div className="space-y-4 p-4 rounded-lg border">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Code2 className="w-4 h-4 text-purple-500" />
                        <Label className="font-medium">高级过滤条件</Label>
                    </div>
                    <Switch
                        checked={filter.use_advanced_filter || false}
                        onCheckedChange={(checked) => updateFilter({ use_advanced_filter: checked })}
                    />
                </div>
                <p className="text-sm text-muted-foreground">
                    启用后可以根据邮件内容、变量等条件动态决定是否执行拦截
                </p>

                {filter.use_advanced_filter && (
                    <div className="pt-4 border-t">
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                                <Label className="text-sm text-muted-foreground">配置过滤表达式</Label>
                                <p className="text-xs text-muted-foreground mt-1">
                                    命中高级表达式后，拦截器才会执行
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={advancedConditionCount === 0}
                                onClick={() => setShowFilterTestDialog(true)}
                            >
                                <Database className="w-4 h-4 mr-2" />
                                测试过滤条件
                            </Button>
                        </div>
                        <ExpressionGroup
                            expression={advancedRootExpression}
                            onChange={handleRootExpressionChange}
                            isRoot={true}
                            pluginContext="interceptor"
                        />
                    </div>
                )}
            </div>
            <FilterTestDialog
                open={showFilterTestDialog}
                onOpenChange={setShowFilterTestDialog}
                expressions={normalizedAdvancedExpressions}
            />
        </div>
    )
}

function getAdvancedRootExpression(expressions: any[]) {
    if (expressions.length === 1 && expressions[0]?.type === 'group') {
        return expressions[0]
    }
    return {
        id: 'interceptor-root',
        type: 'group',
        operator: 'and',
        conditions: expressions,
    }
}

function getNormalizedAdvancedExpressions(expressions: any[]) {
    if (expressions.length === 0) {
        return []
    }
    if (expressions.length === 1 && expressions[0]?.type === 'group') {
        return expressions
    }
    return [getAdvancedRootExpression(expressions)]
}

function countExpressionConditions(expressions: any[]): number {
    return expressions.reduce((count, expression) => {
        if (!expression) return count
        if (expression.type === 'group') {
            return count + countExpressionConditions(expression.conditions || [])
        }
        return count + 1
    }, 0)
}
