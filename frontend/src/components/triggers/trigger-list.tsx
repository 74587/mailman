'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Search,
  Play,
  Pause,
  Settings,
  Eye,
  AlertCircle,
  CheckCircle,
  Clock,
  Trash2,
  Bug,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react'
import { triggerService } from '@/services/trigger.service'
import { EmailTrigger, PaginationParams } from '@/types'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'

export interface TriggerStats {
  total: number
  enabled: number
  totalExecutions: number
  successRate: number
}

export interface TriggerListProps {
  onDebug?: (trigger: EmailTrigger) => void
  onStatsChange?: (stats: TriggerStats) => void
}

// 自定义 hook 检测窗口宽度
function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280)

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return width
}

export function TriggerList({ onDebug, onStatsChange }: TriggerListProps) {
  const { confirm } = useConfirmDialog()
  const [triggers, setTriggers] = useState<EmailTrigger[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const windowWidth = useWindowWidth()
  const showExpandedActions = windowWidth >= 1280

  // 加载触发器列表
  useEffect(() => {
    loadTriggers()
  }, [page, limit, searchTerm, statusFilter])

  const loadTriggers = async () => {
    try {
      setIsLoading(true)
      const params: PaginationParams = {
        page,
        limit,
        search: searchTerm || undefined
      }

      const response = await triggerService.getTriggers(params)
      setTriggers(response.data)
      setTotal(response.total)

      // 计算统计数据 - 获取所有触发器来计算
      if (onStatsChange) {
        // 获取所有触发器用于统计
        const allResponse = await triggerService.getTriggers({ page: 1, limit: 1000 })
        const allTriggers = allResponse.data

        const enabledCount = allTriggers.filter(t => t.status === 'enabled').length
        const totalExecs = allTriggers.reduce((sum, t) => sum + (t.total_executions || 0), 0)
        const successExecs = allTriggers.reduce((sum, t) => sum + (t.success_executions || 0), 0)
        const successRate = totalExecs > 0 ? Math.round((successExecs / totalExecs) * 100) : 0

        onStatsChange({
          total: allResponse.total,
          enabled: enabledCount,
          totalExecutions: totalExecs,
          successRate
        })
      }
    } catch (error) {
      console.error('加载触发器列表失败:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // 处理状态变更
  const handleStatusChange = async (trigger: EmailTrigger) => {
    try {
      if (trigger.status === 'enabled') {
        await triggerService.disableTrigger(trigger.id)
      } else {
        await triggerService.enableTrigger(trigger.id)
      }
      loadTriggers()
    } catch (error) {
      console.error('更改触发器状态失败:', error)
    }
  }

  // 处理删除
  const handleDelete = async (trigger: EmailTrigger) => {
    const confirmed = await confirm({
      title: '删除触发器',
      description: `确定要删除触发器 "${trigger.name}" 吗？`,
      confirmText: '删除',
      cancelText: '取消',
      variant: 'destructive'
    })
    if (confirmed) {
      try {
        await triggerService.deleteTrigger(trigger.id)
        toast.success('触发器已删除')
        loadTriggers()
      } catch (error) {
        console.error('删除触发器失败:', error)
        toast.error('删除触发器失败')
      }
    }
  }

  // 处理查看详情 - 打开新 Tab
  const handleView = (trigger: EmailTrigger) => {
    const tabId = `trigger-view-${trigger.id}`
    window.dispatchEvent(new CustomEvent('switchTab', {
      detail: {
        tab: tabId,
        data: { triggerId: trigger.id, triggerName: trigger.name }
      }
    }))
  }

  // 处理编辑 - 打开新 Tab
  const handleEdit = (trigger: EmailTrigger) => {
    const tabId = `trigger-edit-${trigger.id}`
    window.dispatchEvent(new CustomEvent('switchTab', {
      detail: {
        tab: tabId,
        data: { triggerId: trigger.id, triggerName: trigger.name }
      }
    }))
  }

  // 获取状态 Badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'enabled':
        return (
          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle className="h-3 w-3 mr-1" />
            运行中
          </Badge>
        )
      case 'disabled':
        return (
          <Badge variant="secondary" className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            <Clock className="h-3 w-3 mr-1" />
            已停用
          </Badge>
        )
      default:
        return (
          <Badge variant="destructive">
            <AlertCircle className="h-3 w-3 mr-1" />
            错误
          </Badge>
        )
    }
  }

  // 获取条件类型显示
  const getConditionTypeText = (type: string | undefined) => {
    return type === 'js' ? 'JS' :
      type === 'gotemplate' ? 'Go' : 'V2'
  }

  // 处理搜索
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
    setPage(1)
  }

  // 处理状态过滤
  const handleStatusFilter = (value: string) => {
    setStatusFilter(value)
    setPage(1)
  }

  // 计算成功率
  const getSuccessRate = (trigger: EmailTrigger) => {
    const total = trigger.total_executions || 0
    const success = trigger.success_executions || 0
    if (total === 0) return { rate: 0, display: '-' }
    const rate = Math.round((success / total) * 100)
    return { rate, display: `${rate}%` }
  }

  const totalPages = Math.ceil(total / limit)

  // 渲染展开的操作按钮
  const renderExpandedActions = (trigger: EmailTrigger) => (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center justify-end gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
              onClick={() => handleView(trigger)}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>查看详情</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20"
              onClick={() => handleEdit(trigger)}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>编辑</TooltipContent>
        </Tooltip>

        {onDebug && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20"
                onClick={() => onDebug(trigger)}
              >
                <Bug className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>调试</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 ${trigger.status === 'enabled'
                ? 'hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-900/20'
                : 'hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20'
                }`}
              onClick={() => handleStatusChange(trigger)}
            >
              {trigger.status === 'enabled' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{trigger.status === 'enabled' ? '禁用' : '启用'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
              onClick={() => handleDelete(trigger)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>删除</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )

  // 渲染下拉菜单操作
  const renderDropdownActions = (trigger: EmailTrigger) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-gray-100 dark:hover:bg-gray-800">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => handleView(trigger)} className="cursor-pointer">
          <Eye className="h-4 w-4 mr-2 text-blue-500" />
          查看详情
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleEdit(trigger)} className="cursor-pointer">
          <Settings className="h-4 w-4 mr-2 text-amber-500" />
          编辑
        </DropdownMenuItem>
        {onDebug && (
          <DropdownMenuItem onClick={() => onDebug(trigger)} className="cursor-pointer">
            <Bug className="h-4 w-4 mr-2 text-purple-500" />
            调试
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleStatusChange(trigger)} className="cursor-pointer">
          {trigger.status === 'enabled' ? (
            <>
              <Pause className="h-4 w-4 mr-2 text-orange-500" />
              禁用
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2 text-green-500" />
              启用
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => handleDelete(trigger)}
          className="text-red-600 focus:text-red-600 cursor-pointer"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-4">
      {/* 搜索和过滤 */}
      <Card className="border-0 shadow-sm bg-gradient-to-r from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                <Input
                  placeholder="搜索触发器名称或描述..."
                  value={searchTerm}
                  onChange={handleSearch}
                  className="pl-10 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={handleStatusFilter}>
                <SelectTrigger className="w-[130px] border-gray-200 dark:border-gray-700">
                  {statusFilter === 'all' ? '所有状态' : statusFilter === 'enabled' ? '运行中' : '已停用'}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">所有状态</SelectItem>
                  <SelectItem value="enabled">运行中</SelectItem>
                  <SelectItem value="disabled">已停用</SelectItem>
                </SelectContent>
              </Select>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => loadTriggers()}
                      disabled={isLoading}
                      className="border-gray-200 dark:border-gray-700 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 dark:hover:bg-blue-900/20 dark:hover:text-blue-400 transition-colors"
                    >
                      <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>刷新列表</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 触发器列表 */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center">
              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
              <p className="mt-4 text-gray-500 dark:text-gray-400">加载中...</p>
            </div>
          ) : triggers.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {/* 表头 */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <div className="col-span-4 xl:col-span-4 flex items-center gap-2">
                  名称
                </div>
                <div className="col-span-2 xl:col-span-1 flex items-center">
                  状态
                </div>
                <div className="col-span-1 flex items-center">
                  类型
                </div>
                <div className="col-span-1 text-center">
                  动作
                </div>
                <div className="col-span-2 xl:col-span-2 flex items-center">
                  执行统计
                </div>
                <div className="hidden xl:flex col-span-1 items-center">
                  创建时间
                </div>
                <div className={`${showExpandedActions ? 'col-span-2' : 'col-span-1'} text-right`}>
                  操作
                </div>
              </div>

              {/* 数据行 */}
              {triggers.map((trigger) => {
                const successInfo = getSuccessRate(trigger)
                return (
                  <div
                    key={trigger.id}
                    className="grid grid-cols-12 gap-4 px-6 py-3 items-center hover:bg-blue-50/50 dark:hover:bg-gray-800/50 transition-colors group"
                  >
                    {/* 名称和描述 */}
                    <div className="col-span-4 xl:col-span-4">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {trigger.name}
                        </div>
                        {trigger.description && (
                          <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                            {trigger.description}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 状态 */}
                    <div className="col-span-2 xl:col-span-1">
                      {getStatusBadge(trigger.status)}
                    </div>

                    {/* 条件类型 */}
                    <div className="col-span-1">
                      <Badge variant="outline" className="text-xs">
                        {getConditionTypeText(trigger.condition?.type)}
                      </Badge>
                    </div>

                    {/* 动作数量 */}
                    <div className="col-span-1 text-center">
                      <Badge variant="secondary">
                        {trigger.actions?.length || 0}
                      </Badge>
                    </div>

                    {/* 执行统计 */}
                    <div className="col-span-2 xl:col-span-2">
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        <span className="text-green-600 dark:text-green-400 font-medium">{trigger.success_executions || 0}</span>
                        <span className="text-gray-400 mx-0.5">/</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{trigger.total_executions || 0}</span>
                        <span className="ml-1">次</span>
                      </div>
                    </div>

                    {/* 创建时间 */}
                    <div className="hidden xl:block col-span-1 text-sm text-gray-500 dark:text-gray-400">
                      {new Date(trigger.created_at).toLocaleDateString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit'
                      })}
                    </div>

                    {/* 操作列 */}
                    <div className={`${showExpandedActions ? 'col-span-2' : 'col-span-1'} flex justify-end`}>
                      {showExpandedActions
                        ? renderExpandedActions(trigger)
                        : renderDropdownActions(trigger)
                      }
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="p-16 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <Search className="h-10 w-10 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                未找到匹配的触发器
              </h3>
              <p className="text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                尝试调整搜索条件或创建新的触发器规则
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分页控制 */}
      {total > 0 && (
        <div className="flex justify-between items-center bg-white dark:bg-gray-900 rounded-lg p-4 shadow-sm border border-gray-100 dark:border-gray-800">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            共 <span className="font-semibold text-gray-900 dark:text-white">{total}</span> 条记录，
            第 <span className="font-semibold text-gray-900 dark:text-white">{page}</span> / {totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              上一页
            </Button>

            {/* 页码快捷按钮 */}
            <div className="hidden sm:flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number
                if (totalPages <= 5) {
                  pageNum = i + 1
                } else if (page <= 3) {
                  pageNum = i + 1
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i
                } else {
                  pageNum = page - 2 + i
                }
                return (
                  <Button
                    key={pageNum}
                    variant={page === pageNum ? 'default' : 'ghost'}
                    size="sm"
                    className={`w-8 h-8 p-0 ${page === pageNum ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                    onClick={() => setPage(pageNum)}
                  >
                    {pageNum}
                  </Button>
                )
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="disabled:opacity-40"
            >
              下一页
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}