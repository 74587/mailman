'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Loader2, Settings2, Shield, RefreshCw, FileText, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
    Interceptor,
    InterceptorPluginInfo,
    getInterceptors,
    getInterceptorPlugins,
    deleteInterceptor,
    enableInterceptor,
    disableInterceptor,
    updateInterceptorOrder,
} from '@/services/interceptor.service'
import { SortableInterceptorCard } from './sortable-interceptor-card'
import { InterceptorFormModal } from './interceptor-form-modal'
import { toast } from 'sonner'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'

export function InterceptorListPage() {
    const { confirm } = useConfirmDialog()
    const [interceptors, setInterceptors] = useState<Interceptor[]>([])
    const [plugins, setPlugins] = useState<InterceptorPluginInfo[]>([])
    const [loading, setLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingInterceptor, setEditingInterceptor] = useState<Interceptor | null>(null)
    const [isSaving, setIsSaving] = useState(false)

    // 拖拽传感器配置
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // 需要移动8px才触发拖拽
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    // 加载拦截器和插件列表
    const loadData = useCallback(async () => {
        try {
            setLoading(true)
            const [interceptorList, pluginList] = await Promise.all([
                getInterceptors('global'),
                getInterceptorPlugins(),
            ])
            // 按 order 排序
            const sortedList = [...interceptorList].sort((a, b) => a.order - b.order)
            setInterceptors(sortedList)
            setPlugins(pluginList)
        } catch (error) {
            console.error('Failed to load interceptors:', error)
            toast.error('加载拦截器列表失败')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadData()
    }, [loadData])

    // 处理创建/编辑
    const handleOpenModal = (interceptor?: Interceptor) => {
        setEditingInterceptor(interceptor || null)
        setIsModalOpen(true)
    }

    const handleCloseModal = () => {
        setIsModalOpen(false)
        setEditingInterceptor(null)
    }

    const handleSaved = () => {
        handleCloseModal()
        loadData()
    }

    // 切换启用状态
    const handleToggleEnabled = async (interceptor: Interceptor) => {
        try {
            if (interceptor.enabled) {
                await disableInterceptor(interceptor.id)
                toast.success(`已禁用拦截器: ${interceptor.name}`)
            } else {
                await enableInterceptor(interceptor.id)
                toast.success(`已启用拦截器: ${interceptor.name}`)
            }
            loadData()
        } catch (error) {
            console.error('Failed to toggle interceptor:', error)
            toast.error('操作失败')
        }
    }

    // 删除拦截器
    const handleDelete = async (interceptor: Interceptor) => {
        const confirmed = await confirm({
            title: '删除拦截器',
            description: `确定要删除拦截器 "${interceptor.name}" 吗？`,
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return
        try {
            await deleteInterceptor(interceptor.id)
            toast.success(`已删除拦截器: ${interceptor.name}`)
            loadData()
        } catch (error) {
            console.error('Failed to delete interceptor:', error)
            toast.error('删除失败')
        }
    }

    // 查看拦截器日志 - 打开独立的 Tab
    const handleViewLogs = (interceptor: Interceptor) => {
        const tabId = `interceptor-logs-${interceptor.id}`
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: tabId,
                data: {
                    interceptorId: interceptor.id,
                    interceptorName: interceptor.name,
                }
            }
        }))
    }

    // 查看全部日志 - 打开独立的 Tab
    const handleViewAllLogs = () => {
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: 'interceptor-logs',
            }
        }))
    }

    // 处理拖拽结束
    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event

        if (over && active.id !== over.id) {
            const oldIndex = interceptors.findIndex((item) => item.id.toString() === active.id)
            const newIndex = interceptors.findIndex((item) => item.id.toString() === over.id)

            if (oldIndex !== -1 && newIndex !== -1) {
                const newOrder = arrayMove(interceptors, oldIndex, newIndex)

                // 乐观更新
                setInterceptors(newOrder)

                // 构建顺序映射
                const orders: Record<string, number> = {}
                newOrder.forEach((item, index) => {
                    orders[item.id.toString()] = (index + 1) * 10
                })

                try {
                    setIsSaving(true)
                    await updateInterceptorOrder(orders)
                    toast.success('排序已更新')
                } catch (error) {
                    console.error('Failed to update order:', error)
                    toast.error('排序更新失败')
                    // 回滚
                    loadData()
                } finally {
                    setIsSaving(false)
                }
            }
        }
    }

    // 获取插件名称
    const getPluginName = (pluginId: string) => {
        const plugin = plugins.find((p) => p.id === pluginId)
        return plugin?.name || pluginId
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6">
            {/* 页面标题 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20">
                        <Shield className="w-6 h-6 text-violet-500" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">拦截器管理</h1>
                        <p className="text-sm text-muted-foreground">
                            配置全局拦截器，在动作执行前后进行拦截处理
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleViewAllLogs}>
                        <ScrollText className="w-4 h-4 mr-2" />
                        执行日志
                    </Button>
                    <Button variant="outline" size="sm" onClick={loadData} disabled={isSaving}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${isSaving ? 'animate-spin' : ''}`} />
                        刷新
                    </Button>
                    <Button onClick={() => handleOpenModal()}>
                        <Plus className="w-4 h-4 mr-2" />
                        添加拦截器
                    </Button>
                </div>
            </div>

            {/* 提示信息 */}
            <div className="p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
                <div className="flex items-start gap-3">
                    <Settings2 className="w-5 h-5 text-blue-500 mt-0.5" />
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-blue-500">关于拦截器</p>
                        <p className="text-sm text-muted-foreground">
                            拦截器可在动作执行前后进行拦截处理，支持日志记录、权限验证、性能监控等功能。
                            所有拦截器按顺序执行，<strong>可通过拖拽调整执行顺序</strong>。
                        </p>
                    </div>
                </div>
            </div>

            {/* 拦截器列表 */}
            {interceptors.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-lg">
                    <Shield className="w-12 h-12 text-muted-foreground/50 mb-4" />
                    <p className="text-lg font-medium text-muted-foreground mb-2">暂无拦截器</p>
                    <p className="text-sm text-muted-foreground mb-4">点击上方按钮添加第一个拦截器</p>
                    <Button onClick={() => handleOpenModal()}>
                        <Plus className="w-4 h-4 mr-2" />
                        添加拦截器
                    </Button>
                </div>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={interceptors.map((i) => i.id.toString())}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="space-y-3">
                            {interceptors.map((interceptor, index) => (
                                <SortableInterceptorCard
                                    key={interceptor.id}
                                    interceptor={interceptor}
                                    index={index}
                                    pluginName={getPluginName(interceptor.plugin_id)}
                                    onEdit={() => handleOpenModal(interceptor)}
                                    onToggleEnabled={() => handleToggleEnabled(interceptor)}
                                    onDelete={() => handleDelete(interceptor)}
                                    onViewLogs={() => handleViewLogs(interceptor)}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            )}

            {/* 编辑弹窗 */}
            <InterceptorFormModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                interceptor={editingInterceptor}
                plugins={plugins}
                onSaved={handleSaved}
            />
        </div>
    )
}
