'use client'

import { useState, useEffect } from 'react'
import { UserSession, UserSessionService, CreateSessionRequest, UpdateSessionRequest } from '@/services/user-session.service'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Edit, Trash2, Copy, RefreshCw, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

// 创建会话模态框
const CreateSessionModal = ({ isOpen, onClose, onSubmit }: {
    isOpen: boolean
    onClose: () => void
    onSubmit: (data: CreateSessionRequest) => Promise<void>
}) => {
    const [expiresInDays, setExpiresInDays] = useState(30)
    const [isSubmitting, setIsSubmitting] = useState(false)

    if (!isOpen) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        try {
            await onSubmit({ expires_in_days: expiresInDays })
            onClose()
        } catch (error) {
            console.error('创建会话失败:', error)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
                <h2 className="text-xl font-semibold mb-4">创建新会话</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <Label htmlFor="expiresInDays">过期时间（天）</Label>
                        <Input
                            id="expiresInDays"
                            type="number"
                            min={1}
                            max={365}
                            value={expiresInDays}
                            onChange={(e) => setExpiresInDays(parseInt(e.target.value))}
                            className="mt-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-primary-500 dark:focus:border-primary-500"
                            required
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            onClick={onClose}
                            variant="outline"
                            disabled={isSubmitting}
                        >
                            取消
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                    处理中...
                                </>
                            ) : '创建'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}

// 编辑会话模态框
const EditSessionModal = ({ isOpen, onClose, session, onSubmit }: {
    isOpen: boolean
    onClose: () => void
    session: UserSession | null
    onSubmit: (id: number, data: UpdateSessionRequest) => Promise<void>
}) => {
    const [expiresInDays, setExpiresInDays] = useState(30)
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        if (session) {
            // 默认延长30天
            setExpiresInDays(30)
        }
    }, [session])

    if (!isOpen || !session) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        try {
            await onSubmit(session.id, { expires_in_days: expiresInDays })
            onClose()
        } catch (error) {
            console.error('更新会话失败:', error)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
                <h2 className="text-xl font-semibold mb-4">延长会话有效期</h2>
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
                    当前会话令牌: <span className="font-mono break-all">{session.token.substring(0, 16)}...</span>
                </p>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <Label htmlFor="expiresInDays">延长有效期（天）</Label>
                        <Input
                            id="expiresInDays"
                            type="number"
                            min={1}
                            max={365}
                            value={expiresInDays}
                            onChange={(e) => setExpiresInDays(parseInt(e.target.value))}
                            className="mt-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-primary-500 dark:focus:border-primary-500"
                            required
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            onClick={onClose}
                            variant="outline"
                            disabled={isSubmitting}
                        >
                            取消
                        </Button>
                        <Button
                            type="submit"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <>
                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                    处理中...
                                </>
                            ) : '更新'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}

// 确认删除模态框
const ConfirmDeleteModal = ({ isOpen, onClose, session, onConfirm }: {
    isOpen: boolean
    onClose: () => void
    session: UserSession | null
    onConfirm: () => Promise<void>
}) => {
    const [isSubmitting, setIsSubmitting] = useState(false)

    if (!isOpen || !session) return null

    const handleConfirm = async () => {
        setIsSubmitting(true)
        try {
            await onConfirm()
            onClose()
        } catch (error) {
            console.error('删除会话失败:', error)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
                <div className="flex items-center text-red-500 mb-4">
                    <AlertCircle className="h-6 w-6 mr-2" />
                    <h2 className="text-xl font-semibold">确认删除</h2>
                </div>
                <p className="mb-4">
                    您确定要删除此会话令牌吗？此操作不可撤销，任何使用此令牌的API调用将立即失效。
                </p>
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        onClick={onClose}
                        variant="outline"
                        disabled={isSubmitting}
                    >
                        取消
                    </Button>
                    <Button
                        type="button"
                        onClick={handleConfirm}
                        variant="destructive"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <>
                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                处理中...
                            </>
                        ) : '删除'}
                    </Button>
                </div>
            </div>
        </div>
    )
}

export default function UserSessionsTab() {
    const [sessions, setSessions] = useState<UserSession[]>([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [limit] = useState(10)
    const [total, setTotal] = useState(0)
    const [refreshKey, setRefreshKey] = useState(0)

    // 模态框状态
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [selectedSession, setSelectedSession] = useState<UserSession | null>(null)

    // 加载会话数据
    useEffect(() => {
        const fetchSessions = async () => {
            setLoading(true)
            try {
                const response = await UserSessionService.getUserSessions(page, limit)
                setSessions(response.sessions)
                setTotal(response.total)
            } catch (error) {
                console.error('获取会话列表失败:', error)
            } finally {
                setLoading(false)
            }
        }

        fetchSessions()
    }, [page, limit, refreshKey])

    // 复制令牌到剪贴板
    const handleCopyToken = (token: string) => {
        navigator.clipboard.writeText(token)
            .then(() => {
                // 可以添加一个提示
                toast.success('令牌已复制到剪贴板')
            })
            .catch(err => {
                console.error('复制失败:', err)
                toast.error('复制失败')
            })
    }

    // 创建新会话
    const handleCreateSession = async (data: CreateSessionRequest) => {
        try {
            await UserSessionService.createSession(data)
            // 刷新会话列表
            setRefreshKey(prev => prev + 1)
        } catch (error) {
            console.error('创建会话失败:', error)
            throw error
        }
    }

    // 更新会话
    const handleUpdateSession = async (id: number, data: UpdateSessionRequest) => {
        try {
            await UserSessionService.updateSession(id, data)
            // 刷新会话列表
            setRefreshKey(prev => prev + 1)
        } catch (error) {
            console.error('更新会话失败:', error)
            throw error
        }
    }

    // 删除会话
    const handleDeleteSession = async () => {
        if (!selectedSession) return

        try {
            await UserSessionService.deleteSession(selectedSession.id)
            // 刷新会话列表
            setRefreshKey(prev => prev + 1)
        } catch (error) {
            console.error('删除会话失败:', error)
            throw error
        }
    }

    // 计算总页数
    const totalPages = Math.ceil(total / limit)

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold">API访问令牌管理</h1>
                <Button onClick={() => setIsCreateModalOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    创建新令牌
                </Button>
            </div>

            <Card className="mb-6 p-6">
                <h2 className="text-lg font-medium mb-4">关于API访问令牌</h2>
                <p className="text-gray-600 dark:text-gray-400 mb-2">
                    API访问令牌允许您从外部应用程序访问邮件管理系统的API。每个令牌都有一个过期时间，过期后将无法使用。
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                    <strong>注意：</strong> 创建令牌后请立即复制并安全保存，令牌只会完整显示一次。
                </p>
            </Card>

            {loading ? (
                <div className="flex justify-center items-center h-40">
                    <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : (
                <>
                    {sessions.length === 0 ? (
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 text-center">
                            <p className="text-gray-600 dark:text-gray-400">
                                您还没有创建任何API访问令牌。点击"创建新令牌"按钮开始使用。
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-lg shadow">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-700">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            令牌ID
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            令牌值
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            创建时间
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            过期时间
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            状态
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                                            操作
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {sessions.map((session) => {
                                        const isExpired = UserSessionService.isExpired(session.expires_at)
                                        const remainingDays = UserSessionService.getRemainingDays(session.expires_at)

                                        return (
                                            <tr key={session.id}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">
                                                    {session.id}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-gray-300">
                                                    <div className="flex items-center">
                                                        <span className="truncate w-40">
                                                            {session.token.substring(0, 16)}...
                                                        </span>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleCopyToken(session.token)}
                                                            className="ml-2"
                                                        >
                                                            <Copy className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">
                                                    {UserSessionService.formatExpiresAt(session.created_at)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">
                                                    {UserSessionService.formatExpiresAt(session.expires_at)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    {isExpired ? (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                                                            已过期
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                                            有效（剩余{remainingDays}天）
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-300">
                                                    <div className="flex space-x-2">
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => {
                                                                setSelectedSession(session)
                                                                setIsEditModalOpen(true)
                                                            }}
                                                            disabled={isExpired}
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            onClick={() => {
                                                                setSelectedSession(session)
                                                                setIsDeleteModalOpen(true)
                                                            }}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* 分页控件 */}
                    {totalPages > 1 && (
                        <div className="flex justify-between items-center mt-4">
                            <div className="text-sm text-gray-700 dark:text-gray-300">
                                显示 {sessions.length} 个会话中的 {(page - 1) * limit + 1}-{Math.min(page * limit, total)}，
                                共 {total} 个
                            </div>
                            <div className="flex space-x-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                >
                                    上一页
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages}
                                >
                                    下一页
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* 模态框组件 */}
            <CreateSessionModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSubmit={handleCreateSession}
            />

            <EditSessionModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                session={selectedSession}
                onSubmit={handleUpdateSession}
            />

            <ConfirmDeleteModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                session={selectedSession}
                onConfirm={handleDeleteSession}
            />
        </div>
    )
}