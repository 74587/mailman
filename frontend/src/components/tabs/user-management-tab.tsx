'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/context/auth-context'
import { userManagementService, ManagedUser, CreateUserRequest } from '@/services/user-management.service'
import { organizationService, Organization, Role } from '@/services/organization.service'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
    Users, UserPlus, Shield, Crown, Eye, Search, Plus, Edit3,
    CheckCircle2, XCircle, UserCog, Lock, Mail, AlertTriangle,
    MoreVertical, ChevronLeft, ChevronRight, RefreshCw
} from 'lucide-react'

export default function UserManagementTab() {
    const { user: currentUser, isSuperAdmin } = useAuth()
    const [users, setUsers] = useState<ManagedUser[]>([])
    const [organizations, setOrganizations] = useState<Organization[]>([])
    const [roles, setRoles] = useState<Role[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [limit] = useState(20)
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')

    // 弹窗状态
    const [showCreateUser, setShowCreateUser] = useState(false)
    const [showEditUser, setShowEditUser] = useState(false)
    const [editingUser, setEditingUser] = useState<ManagedUser | null>(null)

    // 创建用户表单
    const [newUsername, setNewUsername] = useState('')
    const [newEmail, setNewEmail] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [newOrgId, setNewOrgId] = useState('')
    const [newRoleId, setNewRoleId] = useState('')

    // 编辑用户表单
    const [editUsername, setEditUsername] = useState('')
    const [editEmail, setEditEmail] = useState('')
    const [editPassword, setEditPassword] = useState('')
    const [editIsActive, setEditIsActive] = useState(true)
    const [editIsSuperAdmin, setEditIsSuperAdmin] = useState(false)

    // 加载用户列表
    const loadUsers = useCallback(async () => {
        if (!isSuperAdmin) return
        setLoading(true)
        try {
            const resp = await userManagementService.listUsers(page, limit)
            setUsers(resp.data || [])
            setTotal(resp.total || 0)
        } catch {
            toast.error('加载用户列表失败')
        } finally {
            setLoading(false)
        }
    }, [page, limit, isSuperAdmin])

    // 加载组织和角色
    const loadMeta = useCallback(async () => {
        if (!isSuperAdmin) return
        try {
            const [orgs, rolesData] = await Promise.all([
                organizationService.getOrganizations(),
                organizationService.getRoles(),
            ])
            setOrganizations(orgs)
            setRoles(rolesData)
        } catch {
            // 忽略
        }
    }, [isSuperAdmin])

    useEffect(() => {
        loadUsers()
        loadMeta()
    }, [loadUsers, loadMeta])

    // 创建用户
    const handleCreateUser = async () => {
        if (!newUsername || !newEmail || !newPassword) {
            toast.error('请填写完整信息')
            return
        }
        if (newPassword.length < 8) {
            toast.error('密码长度至少 8 位')
            return
        }
        try {
            const data: CreateUserRequest = {
                username: newUsername,
                email: newEmail,
                password: newPassword,
            }
            if (newOrgId) data.orgId = parseInt(newOrgId)
            if (newRoleId) data.roleId = parseInt(newRoleId)

            await userManagementService.createUser(data)
            toast.success('用户创建成功')
            setShowCreateUser(false)
            resetCreateForm()
            loadUsers()
        } catch (error: any) {
            toast.error(error.message || '创建用户失败')
        }
    }

    // 更新用户
    const handleUpdateUser = async () => {
        if (!editingUser) return
        try {
            const data: any = {}
            if (editUsername && editUsername !== editingUser.username) data.username = editUsername
            if (editEmail && editEmail !== editingUser.email) data.email = editEmail
            if (editPassword) data.password = editPassword
            if (editIsActive !== editingUser.is_active) data.isActive = editIsActive
            if (editIsSuperAdmin !== editingUser.is_super_admin) data.isSuperAdmin = editIsSuperAdmin

            await userManagementService.updateUser(editingUser.id, data)
            toast.success('用户更新成功')
            setShowEditUser(false)
            setEditingUser(null)
            loadUsers()
        } catch (error: any) {
            toast.error(error.message || '更新用户失败')
        }
    }

    // 禁用用户
    const handleDisableUser = async (u: ManagedUser) => {
        if (u.id === currentUser?.id) {
            toast.error('不能禁用自己')
            return
        }
        if (!confirm(`确定要禁用用户「${u.username}」吗？`)) return
        try {
            await userManagementService.deleteUser(u.id)
            toast.success('用户已禁用')
            loadUsers()
        } catch (error: any) {
            toast.error(error.message || '操作失败')
        }
    }

    // 开始编辑用户
    const startEditUser = (u: ManagedUser) => {
        setEditingUser(u)
        setEditUsername(u.username)
        setEditEmail(u.email)
        setEditPassword('')
        setEditIsActive(u.is_active)
        setEditIsSuperAdmin(u.is_super_admin)
        setShowEditUser(true)
    }

    const resetCreateForm = () => {
        setNewUsername('')
        setNewEmail('')
        setNewPassword('')
        setNewOrgId('')
        setNewRoleId('')
    }

    // 过滤用户
    const filteredUsers = users.filter(u => {
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        return u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    })

    const totalPages = Math.ceil(total / limit)

    // 权限检查（放在所有 hooks 之后）
    if (!isSuperAdmin) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <Shield className="h-12 w-12 mx-auto mb-3 text-red-400 opacity-50" />
                    <p className="text-gray-500 dark:text-gray-400">需要超级管理员权限</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* 页面标题 */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        <UserCog className="h-7 w-7 text-purple-500" />
                        用户管理
                    </h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        管理系统用户 · 仅超级管理员可访问
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => loadUsers()}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        title="刷新"
                    >
                        <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => setShowCreateUser(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm font-medium"
                    >
                        <UserPlus className="h-4 w-4" />
                        创建用户
                    </button>
                </div>
            </div>

            {/* 搜索 */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                    type="text"
                    placeholder="搜索用户名或邮箱..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                />
            </div>

            {/* 统计卡片 */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: '总用户数', value: total, icon: Users, color: 'text-blue-500 bg-blue-500/10' },
                    { label: '活跃用户', value: users.filter(u => u.is_active).length, icon: CheckCircle2, color: 'text-emerald-500 bg-emerald-500/10' },
                    { label: '超级管理员', value: users.filter(u => u.is_super_admin).length, icon: Crown, color: 'text-amber-500 bg-amber-500/10' },
                    { label: '已禁用', value: users.filter(u => !u.is_active).length, icon: XCircle, color: 'text-red-500 bg-red-500/10' },
                ].map(stat => (
                    <div key={stat.label} className="p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                        <div className="flex items-center gap-3">
                            <div className={cn('p-2 rounded-lg', stat.color)}>
                                <stat.icon className="h-4 w-4" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stat.value}</div>
                                <div className="text-xs text-gray-400">{stat.label}</div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* 用户表格 */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-800">
                            <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">用户</th>
                            <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">邮箱</th>
                            <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">状态</th>
                            <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">权限</th>
                            <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">创建时间</th>
                            <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="text-center py-12">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500 mx-auto"></div>
                                </td>
                            </tr>
                        ) : filteredUsers.length > 0 ? (
                            filteredUsers.map(u => (
                                <tr key={u.id} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center text-white font-bold text-xs">
                                                {u.username.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                                                {u.username}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{u.email}</td>
                                    <td className="px-4 py-3 text-center">
                                        {u.is_active ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                                <CheckCircle2 className="h-3 w-3" /> 活跃
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-500 border border-red-500/20">
                                                <XCircle className="h-3 w-3" /> 已禁用
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        {u.is_super_admin ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-600 border border-amber-500/20">
                                                <Crown className="h-3 w-3" /> 超管
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-400">普通用户</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-400">
                                        {new Date(u.created_at).toLocaleDateString('zh-CN')}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => startEditUser(u)}
                                                className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                                title="编辑"
                                            >
                                                <Edit3 className="h-3.5 w-3.5" />
                                            </button>
                                            {u.id !== currentUser?.id && (
                                                <button
                                                    onClick={() => handleDisableUser(u)}
                                                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                    title="禁用"
                                                >
                                                    <XCircle className="h-3.5 w-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={6} className="text-center py-12 text-gray-400">
                                    <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
                                    <p>{searchQuery ? '未找到匹配的用户' : '暂无用户'}</p>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>

                {/* 分页 */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                        <span className="text-xs text-gray-400">
                            共 {total} 条记录，第 {page}/{totalPages} 页
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="p-1 rounded text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* 创建用户弹窗 */}
            {showCreateUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <UserPlus className="h-5 w-5 text-purple-500" />
                            创建用户
                        </h3>
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            系统不允许自注册，只能由超级管理员创建用户
                        </p>
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">用户名 *</label>
                                    <input
                                        type="text"
                                        value={newUsername}
                                        onChange={e => setNewUsername(e.target.value)}
                                        placeholder="username"
                                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">邮箱 *</label>
                                    <input
                                        type="email"
                                        value={newEmail}
                                        onChange={e => setNewEmail(e.target.value)}
                                        placeholder="user@example.com"
                                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">密码 * <span className="text-gray-400 font-normal">(至少8位)</span></label>
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">加入组织</label>
                                    <select
                                        value={newOrgId}
                                        onChange={e => setNewOrgId(e.target.value)}
                                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                    >
                                        <option value="">不加入</option>
                                        {organizations.map(o => (
                                            <option key={o.id} value={o.id}>{o.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">分配角色</label>
                                    <select
                                        value={newRoleId}
                                        onChange={e => setNewRoleId(e.target.value)}
                                        disabled={!newOrgId}
                                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 disabled:opacity-50"
                                    >
                                        <option value="">默认 (成员)</option>
                                        {roles.filter(r => r.name !== 'super_admin').map(r => (
                                            <option key={r.id} value={r.id}>
                                                {r.name === 'org_owner' ? '组织拥有者' :
                                                 r.name === 'org_admin' ? '组织管理员' :
                                                 r.name === 'member' ? '成员' :
                                                 r.name === 'viewer' ? '只读' : r.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => { setShowCreateUser(false); resetCreateForm(); }}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCreateUser}
                                className="px-4 py-2 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors font-medium"
                            >
                                创建用户
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 编辑用户弹窗 */}
            {showEditUser && editingUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <Edit3 className="h-5 w-5 text-blue-500" />
                            编辑用户 · {editingUser.username}
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">用户名</label>
                                <input
                                    type="text"
                                    value={editUsername}
                                    onChange={e => setEditUsername(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">邮箱</label>
                                <input
                                    type="email"
                                    value={editEmail}
                                    onChange={e => setEditEmail(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    重置密码 <span className="text-gray-400 font-normal">(留空不修改)</span>
                                </label>
                                <input
                                    type="password"
                                    value={editPassword}
                                    onChange={e => setEditPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                />
                            </div>
                            <div className="flex items-center gap-6 pt-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={editIsActive}
                                        onChange={e => setEditIsActive(e.target.checked)}
                                        className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300">启用</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={editIsSuperAdmin}
                                        onChange={e => setEditIsSuperAdmin(e.target.checked)}
                                        className="rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                                    />
                                    <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1">
                                        <Crown className="h-3 w-3 text-amber-500" />
                                        超级管理员
                                    </span>
                                </label>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => { setShowEditUser(false); setEditingUser(null); }}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleUpdateUser}
                                className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
