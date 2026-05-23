'use client'

import { GripVertical, Settings, Trash2, ToggleLeft, ToggleRight, Clock, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Interceptor } from '@/services/interceptor.service'
import { cn } from '@/lib/utils'

export interface InterceptorCardProps {
    interceptor: Interceptor
    index: number
    pluginName: string
    onEdit: () => void
    onToggleEnabled: () => void
    onDelete: () => void
    onViewLogs?: () => void
    showDragHandle?: boolean  // 是否显示内置拖拽手柄
}

export function InterceptorCard({
    interceptor,
    index,
    pluginName,
    onEdit,
    onToggleEnabled,
    onDelete,
    onViewLogs,
    showDragHandle = true,
}: InterceptorCardProps) {
    // 获取阶段标签
    const getPhaseLabels = () => {
        const labels = []
        if (interceptor.phases.before) {
            labels.push({ label: '前置', color: 'bg-blue-500/20 text-blue-400' })
        }
        if (interceptor.phases.after) {
            labels.push({ label: '后置', color: 'bg-green-500/20 text-green-400' })
        }
        return labels
    }

    // 获取过滤模式描述
    const getFilterDescription = () => {
        switch (interceptor.filter.mode) {
            case 'all':
                return '全部动作'
            case 'include':
                return `仅 ${interceptor.filter.action_types?.length || 0} 种动作`
            case 'exclude':
                return `排除 ${interceptor.filter.action_types?.length || 0} 种动作`
            default:
                return '全部动作'
        }
    }

    // 获取错误策略描述
    const getErrorPolicyDescription = () => {
        const before = interceptor.error_handling.before_error_policy
        const after = interceptor.error_handling.after_error_policy
        const policyMap: Record<string, string> = {
            abort: '中断',
            continue: '继续',
            skip_action: '跳过',
        }
        return `前置-${policyMap[before] || before} / 后置-${policyMap[after] || after}`
    }

    const phaseLabels = getPhaseLabels()

    return (
        <div
            className={cn(
                'group relative flex items-center gap-4 p-4 transition-all',
                showDragHandle && 'rounded-xl border hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5',
                !showDragHandle && 'rounded-r-xl',
                interceptor.enabled
                    ? 'bg-card'
                    : 'bg-muted/30 opacity-60'
            )}
        >
            {/* 内置拖拽手柄 - 仅在 showDragHandle 为 true 时显示 */}
            {showDragHandle && (
                <div className="flex items-center justify-center w-8 h-8 rounded cursor-grab text-muted-foreground hover:text-foreground hover:bg-muted">
                    <GripVertical className="w-5 h-5" />
                </div>
            )}

            {/* 序号 */}
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm">
                {index + 1}
            </div>

            {/* 主要内容 */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium truncate">{interceptor.name}</h3>
                    {/* 阶段标签 */}
                    {phaseLabels.map((phase, i) => (
                        <Badge key={i} variant="outline" className={cn('text-xs', phase.color)}>
                            {phase.label}
                        </Badge>
                    ))}
                    {/* 异步标签 */}
                    {interceptor.execution.after_mode === 'async' && (
                        <Badge variant="outline" className="text-xs bg-yellow-500/20 text-yellow-400">
                            <Clock className="w-3 h-3 mr-1" />
                            异步
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>插件: {pluginName}</span>
                    <span className="text-muted-foreground/50">|</span>
                    <span>过滤: {getFilterDescription()}</span>
                    <span className="text-muted-foreground/50">|</span>
                    <span>错误策略: {getErrorPolicyDescription()}</span>
                </div>
                {interceptor.description && (
                    <p className="text-sm text-muted-foreground mt-1 truncate">{interceptor.description}</p>
                )}
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* 启用/禁用 */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                        e.stopPropagation()
                        onToggleEnabled()
                    }}
                    title={interceptor.enabled ? '禁用' : '启用'}
                >
                    {interceptor.enabled ? (
                        <ToggleRight className="w-5 h-5 text-green-500" />
                    ) : (
                        <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                    )}
                </Button>

                {/* 编辑 */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                        e.stopPropagation()
                        onEdit()
                    }}
                    title="编辑"
                >
                    <Settings className="w-4 h-4" />
                </Button>

                {/* 日志 */}
                {onViewLogs && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                            e.stopPropagation()
                            onViewLogs()
                        }}
                        title="查看日志"
                    >
                        <FileText className="w-4 h-4" />
                    </Button>
                )}

                {/* 删除 */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete()
                    }}
                    title="删除"
                    className="text-destructive hover:text-destructive"
                >
                    <Trash2 className="w-4 h-4" />
                </Button>
            </div>

            {/* 启用状态指示器 */}
            {showDragHandle && (
                <div
                    className={cn(
                        'absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition-colors',
                        interceptor.enabled ? 'bg-green-500' : 'bg-muted-foreground/30'
                    )}
                />
            )}
        </div>
    )
}
