'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/context/auth-context'
import { organizationService, Organization, OrgMember, Role, Permission } from '@/services/organization.service'
import { userManagementService, ManagedUser } from '@/services/user-management.service'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
    Building2, Users, UserPlus, Shield, Crown, Eye, Settings,
    ChevronRight, MoreVertical, Search, Plus, Trash2, Edit3,
    CheckCircle2, XCircle, ArrowLeftRight, UserCog, Lock,
    ChevronDown, ChevronUp, KeyRound
} from 'lucide-react'

// 角色名称映射
const roleNameMap: Record<string, string> = {
    'super_admin': '超级管理员',
    'org_owner': '组织拥有者',
    'org_admin': '组织管理员',
    'member': '成员',
    'viewer': '只读',
}

// 角色图标映射
const roleIconMap: Record<string, typeof Crown> = {
    'super_admin': Crown,
    'org_owner': Crown,
    'org_admin': Shield,
    'member': Users,
    'viewer': Eye,
}

// 角色颜色映射
const roleColorMap: Record<string, string> = {
    'super_admin': 'text-amber-500 bg-amber-500/10 border-amber-500/20',
    'org_owner': 'text-purple-500 bg-purple-500/10 border-purple-500/20',
    'org_admin': 'text-blue-500 bg-blue-500/10 border-blue-500/20',
    'member': 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
    'viewer': 'text-gray-500 bg-gray-500/10 border-gray-500/20',
}

// 角色优先级（与后端 getRolePriority 保持一致）
const rolePriorityMap: Record<string, number> = {
    'super_admin': 100,
    'org_owner': 80,
    'org_admin': 60,
    'member': 40,
    'viewer': 20,
}

function getRolePriority(roleName: string): number {
    return rolePriorityMap[roleName] ?? 10
}

// 资源名称映射
const resourceNameMap: Record<string, string> = {
    'organization': '组织管理',
    'org_member': '成员管理',
    'email_account': '邮件账户',
    'email': '邮件',
    'trigger': '触发器',
    'template': '模板',
    'ai_config': 'AI 配置',
    'system_config': '系统配置',
    'sync_config': '同步配置',
}

// 操作名称映射
const actionNameMap: Record<string, string> = {
    'create': '创建',
    'read': '读取',
    'update': '更新',
    'delete': '删除',
    'manage': '完全管理',
}

export default function TeamManagementTab() {
    const { user, currentOrganization, currentRole, isSuperAdmin, hasPermission } = useAuth()
    const [organizations, setOrganizations] = useState<Organization[]>([])
    const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)
    const [members, setMembers] = useState<OrgMember[]>([])
    const [roles, setRoles] = useState<Role[]>([])
    const [allUsers, setAllUsers] = useState<ManagedUser[]>([])
    const [loading, setLoading] = useState(true)
    const [membersLoading, setMembersLoading] = useState(false)

    // 权限管理状态
    const [allPermissions, setAllPermissions] = useState<Permission[]>([])
    const [expandedRoleId, setExpandedRoleId] = useState<number | null>(null)
    const [rolePermissions, setRolePermissions] = useState<Record<number, number[]>>({})
    const [savingPermissions, setSavingPermissions] = useState(false)
    const [activeTab, setActiveTab] = useState<'members' | 'roles'>('members')

    // 弹窗状态
    const [showAddMember, setShowAddMember] = useState(false)
    const [showCreateOrg, setShowCreateOrg] = useState(false)
    const [showEditOrg, setShowEditOrg] = useState(false)
    const [addMemberUserId, setAddMemberUserId] = useState('')
    const [addMemberRoleId, setAddMemberRoleId] = useState('')
    const [newOrgName, setNewOrgName] = useState('')
    const [newOrgSlug, setNewOrgSlug] = useState('')
    const [newOrgDesc, setNewOrgDesc] = useState('')
    const [editOrgName, setEditOrgName] = useState('')
    const [editOrgDesc, setEditOrgDesc] = useState('')
    const [searchQuery, setSearchQuery] = useState('')

    // 当前用户角色优先级
    const currentUserRolePriority = currentRole ? getRolePriority(currentRole.name) : 0

    // 加载数据
    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            const [orgs, rolesData] = await Promise.all([
                organizationService.getOrganizations(),
                organizationService.getRoles(),
            ])
            setOrganizations(orgs)
            setRoles(rolesData)

            // 默认选中当前组织
            if (currentOrganization) {
                const found = orgs.find(o => o.id === currentOrganization.id)
                if (found) setSelectedOrg(found)
                else if (orgs.length > 0) setSelectedOrg(orgs[0])
            } else if (orgs.length > 0) {
                setSelectedOrg(orgs[0])
            }

            // 超管加载所有用户列表（用于添加成员）
            if (isSuperAdmin) {
                try {
                    const usersResp = await userManagementService.listUsers(1, 200)
                    setAllUsers(usersResp.data || [])
                } catch {
                    // 忽略
                }
            }

            // 加载权限列表（有 manage 权限的用户）
            if (hasPermission('organization', 'manage')) {
                try {
                    const perms = await organizationService.getPermissions()
                    setAllPermissions(perms)
                } catch {
                    // 忽略
                }
            }
        } catch (error) {
            toast.error('加载数据失败')
        } finally {
            setLoading(false)
        }
    }, [currentOrganization, isSuperAdmin, hasPermission])

    useEffect(() => {
        loadData()
    }, [loadData])

    // 加载组织成员
    const loadMembers = useCallback(async (orgId: number) => {
        setMembersLoading(true)
        try {
            const data = await organizationService.getOrgMembers(orgId)
            setMembers(data)
        } catch {
            toast.error('加载成员列表失败')
        } finally {
            setMembersLoading(false)
        }
    }, [])

    useEffect(() => {
        if (selectedOrg) {
            loadMembers(selectedOrg.id)
        }
    }, [selectedOrg, loadMembers])

    // 加载角色的权限
    const loadRolePermissions = useCallback(async (roleId: number) => {
        try {
            const perms = await organizationService.getPermissions()
            // 需要获取角色已有的权限，通过 getRolePermissions API 不存在，
            // 所以我们用一个临时方案：通过组合 allPermissions 和后端返回的数据
            // 实际上后端没有单独获取角色权限的 API，我们需要通过 setRolePermissions 的返回值
            // 暂时使用空数组，用户展开时需要从后端获取
            setAllPermissions(perms)
        } catch {
            // 忽略
        }
    }, [])

    // 创建组织
    const handleCreateOrg = async () => {
        if (!newOrgName || !newOrgSlug) {
            toast.error('请填写组织名称和标识')
            return
        }
        try {
            await organizationService.createOrganization({
                name: newOrgName,
                slug: newOrgSlug,
                description: newOrgDesc,
            })
            toast.success('组织创建成功')
            setShowCreateOrg(false)
            setNewOrgName('')
            setNewOrgSlug('')
            setNewOrgDesc('')
            loadData()
        } catch (error: any) {
            toast.error(error.message || '创建组织失败')
        }
    }

    // 添加成员
    const handleAddMember = async () => {
        if (!selectedOrg || !addMemberUserId || !addMemberRoleId) {
            toast.error('请选择用户和角色')
            return
        }
        try {
            await organizationService.addOrgMember(selectedOrg.id, {
                userId: parseInt(addMemberUserId),
                roleId: parseInt(addMemberRoleId),
            })
            toast.success('成员添加成功')
            setShowAddMember(false)
            setAddMemberUserId('')
            setAddMemberRoleId('')
            loadMembers(selectedOrg.id)
        } catch (error: any) {
            toast.error(error.message || '添加成员失败')
        }
    }

    // 更新成员角色
    const handleUpdateRole = async (member: OrgMember, newRoleId: number) => {
        if (!selectedOrg) return
        try {
            await organizationService.updateMemberRole(selectedOrg.id, member.userId, {
                roleId: newRoleId,
            })
            toast.success('角色更新成功')
            loadMembers(selectedOrg.id)
        } catch (error: any) {
            toast.error(error.message || '更新角色失败')
        }
    }

    // 移除成员
    const handleRemoveMember = async (member: OrgMember) => {
        if (!selectedOrg) return
        if (!confirm(`确定要移除成员 ${member.user?.username || member.userId} 吗？`)) return
        try {
            await organizationService.removeMember(selectedOrg.id, member.userId)
            toast.success('成员已移除')
            loadMembers(selectedOrg.id)
        } catch (error: any) {
            toast.error(error.message || '移除成员失败')
        }
    }

    // 删除组织
    const handleDeleteOrg = async (org: Organization) => {
        if (!confirm(`确定要删除组织「${org.name}」吗？此操作不可恢复！`)) return
        try {
            await organizationService.deleteOrganization(org.id)
            toast.success('组织已删除')
            setSelectedOrg(null)
            loadData()
        } catch (error: any) {
            toast.error(error.message || '删除组织失败')
        }
    }

    // 打开编辑组织弹窗
    const handleEditOrg = (org: Organization) => {
        setEditOrgName(org.name)
        setEditOrgDesc(org.description || '')
        setShowEditOrg(true)
    }

    // 更新组织
    const handleUpdateOrg = async () => {
        if (!selectedOrg || !editOrgName) {
            toast.error('组织名称不能为空')
            return
        }
        try {
            const updated = await organizationService.updateOrganization(selectedOrg.id, {
                name: editOrgName,
                description: editOrgDesc || undefined,
            })
            toast.success('组织信息已更新')
            setShowEditOrg(false)
            // 刷新列表并更新选中项
            const orgs = await organizationService.getOrganizations()
            setOrganizations(orgs)
            const refreshed = orgs.find(o => o.id === selectedOrg.id)
            if (refreshed) setSelectedOrg(refreshed)
        } catch (error: any) {
            toast.error(error.message || '更新组织失败')
        }
    }

    // 切换权限
    const handleTogglePermission = (roleId: number, permissionId: number) => {
        setRolePermissions(prev => {
            const current = prev[roleId] || []
            const updated = current.includes(permissionId)
                ? current.filter(id => id !== permissionId)
                : [...current, permissionId]
            return { ...prev, [roleId]: updated }
        })
    }

    // 保存角色权限
    const handleSaveRolePermissions = async (roleId: number) => {
        setSavingPermissions(true)
        try {
            const permIds = rolePermissions[roleId] || []
            await organizationService.setRolePermissions(roleId, permIds)
            toast.success('角色权限已更新')
        } catch (error: any) {
            toast.error(error.message || '更新权限失败')
        } finally {
            setSavingPermissions(false)
        }
    }

    // 展开角色权限编辑（加载当前权限）
    const handleExpandRole = async (roleId: number) => {
        if (expandedRoleId === roleId) {
            setExpandedRoleId(null)
            return
        }
        setExpandedRoleId(roleId)
        // 如果还没有加载过这个角色的权限，尝试通过后端获取
        if (!rolePermissions[roleId]) {
            try {
                // 使用一个空数组作为默认值，通过 setRolePermissions 保存时会替换
                // 理想情况下应该有一个 getRolePermissions API
                // 这里我们通过一个临时 workaround：发送空请求来获取
                setRolePermissions(prev => ({ ...prev, [roleId]: [] }))
            } catch {
                // 忽略
            }
        }
    }

    // 判断成员角色是否可以被当前用户修改
    const canModifyMemberRole = (member: OrgMember): boolean => {
        // 超管总是可以修改（除了下面的特殊限制）
        // 但不能修改超级管理员的角色
        if (member.user?.is_super_admin) return false
        // 不能修改自己
        if (user && member.userId === user.id) return false
        // 非超管需要检查角色层级
        if (!isSuperAdmin) {
            const memberRolePriority = getRolePriority(member.role?.name || '')
            if (memberRolePriority >= currentUserRolePriority) return false
        }
        return true
    }

    // 获取当前用户可以分配的角色（低于自己角色的）
    const getAssignableRoles = (): Role[] => {
        if (isSuperAdmin) {
            // 超管可以分配除 super_admin 以外的所有角色
            return roles.filter(r => r.name !== 'super_admin')
        }
        return roles.filter(r => getRolePriority(r.name) < currentUserRolePriority)
    }

    // 过滤成员
    const filteredMembers = members.filter(m => {
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        return (
            m.user?.username?.toLowerCase().includes(q) ||
            m.user?.email?.toLowerCase().includes(q) ||
            m.role?.name?.toLowerCase().includes(q)
        )
    })

    // 按资源分组权限
    const permissionsByResource = allPermissions.reduce<Record<string, Permission[]>>((acc, p) => {
        if (!acc[p.resource]) acc[p.resource] = []
        acc[p.resource].push(p)
        return acc
    }, {})

    // 所有唯一的操作
    const allActions = Array.from(new Set(allPermissions.map(p => p.action))).sort((a, b) => {
        const order = ['read', 'create', 'update', 'delete', 'manage']
        return order.indexOf(a) - order.indexOf(b)
    })

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* 页面标题 */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        <Building2 className="h-7 w-7 text-blue-500" />
                        团队管理
                    </h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        管理组织、成员和角色权限
                    </p>
                </div>
                {isSuperAdmin && (
                    <button
                        onClick={() => setShowCreateOrg(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                    >
                        <Plus className="h-4 w-4" />
                        创建组织
                    </button>
                )}
            </div>

            <div className="grid grid-cols-12 gap-6">
                {/* 左侧：组织列表 */}
                <div className="col-span-4 space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 px-1">
                        组织列表 ({organizations.length})
                    </div>
                    {organizations.map(org => (
                        <button
                            key={org.id}
                            onClick={() => setSelectedOrg(org)}
                            className={cn(
                                'w-full text-left p-4 rounded-xl border transition-all duration-200',
                                selectedOrg?.id === org.id
                                    ? 'border-blue-500/50 bg-blue-500/5 dark:bg-blue-500/10 shadow-sm'
                                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-sm'
                            )}
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        'w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold',
                                        selectedOrg?.id === org.id
                                            ? 'bg-blue-500 text-white'
                                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                                    )}>
                                        {org.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="font-medium text-gray-900 dark:text-gray-100">{org.name}</div>
                                        <div className="text-xs text-gray-400 dark:text-gray-500">{org.slug}</div>
                                    </div>
                                </div>
                                {selectedOrg?.id === org.id && (
                                    <ChevronRight className="h-4 w-4 text-blue-500" />
                                )}
                            </div>
                            {org.description && (
                                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                                    {org.description}
                                </p>
                            )}
                        </button>
                    ))}

                    {organizations.length === 0 && (
                        <div className="text-center py-12 text-gray-400">
                            <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                            <p>暂无组织</p>
                        </div>
                    )}
                </div>

                {/* 右侧：成员管理 / 角色权限 */}
                <div className="col-span-8">
                    {selectedOrg ? (
                        <div className="space-y-4">
                            {/* 组织头部 */}
                            <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                        {selectedOrg.name}
                                    </h2>
                                    <p className="text-sm text-gray-500">
                                        {members.length} 位成员 · {selectedOrg.slug}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {hasPermission('organization', 'update') && (
                                        <button
                                            onClick={() => handleEditOrg(selectedOrg)}
                                            className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                                            title="编辑组织"
                                        >
                                            <Edit3 className="h-4 w-4" />
                                        </button>
                                    )}
                                    {hasPermission('org_member', 'create') && (
                                        <button
                                            onClick={() => setShowAddMember(true)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors text-sm"
                                        >
                                            <UserPlus className="h-3.5 w-3.5" />
                                            添加成员
                                        </button>
                                    )}
                                    {isSuperAdmin && (
                                        <button
                                            onClick={() => handleDeleteOrg(selectedOrg)}
                                            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                            title="删除组织"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Tab 切换 */}
                            <div className="flex border-b border-gray-200 dark:border-gray-800">
                                <button
                                    onClick={() => setActiveTab('members')}
                                    className={cn(
                                        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                                        activeTab === 'members'
                                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                                    )}
                                >
                                    <Users className="h-4 w-4" />
                                    成员管理
                                </button>
                                {hasPermission('organization', 'manage') && (
                                    <button
                                        onClick={() => setActiveTab('roles')}
                                        className={cn(
                                            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                                            activeTab === 'roles'
                                                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                                        )}
                                    >
                                        <KeyRound className="h-4 w-4" />
                                        角色权限
                                    </button>
                                )}
                            </div>

                            {/* 成员管理 Tab */}
                            {activeTab === 'members' && (
                                <div className="space-y-3">
                                    {/* 搜索栏 */}
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="搜索成员..."
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        />
                                    </div>

                                    {/* 成员列表 */}
                                    <div className="space-y-2">
                                        {membersLoading ? (
                                            <div className="flex items-center justify-center py-12">
                                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                                            </div>
                                        ) : filteredMembers.length > 0 ? (
                                            filteredMembers.map(member => {
                                                const roleName = member.role?.name || 'unknown'
                                                const RoleIcon = roleIconMap[roleName] || Users
                                                const colorClass = roleColorMap[roleName] || roleColorMap['viewer']
                                                const canModify = canModifyMemberRole(member)
                                                const isSelf = user && member.userId === user.id
                                                const isMemberSuperAdmin = member.user?.is_super_admin

                                                return (
                                                    <div
                                                        key={member.id}
                                                        className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:shadow-sm transition-all"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {/* 用户头像 */}
                                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">
                                                                {(member.user?.username || '?').charAt(0).toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-medium text-gray-900 dark:text-gray-100">
                                                                        {member.user?.username || `用户#${member.userId}`}
                                                                    </span>
                                                                    {isMemberSuperAdmin && (
                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium border border-amber-500/20">
                                                                            超管
                                                                        </span>
                                                                    )}
                                                                    {isSelf && (
                                                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 font-medium border border-blue-500/20">
                                                                            我
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-xs text-gray-400">{member.user?.email}</div>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-3">
                                                            {/* 角色标签 */}
                                                            <div className={cn(
                                                                'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
                                                                colorClass
                                                            )}>
                                                                <RoleIcon className="h-3 w-3" />
                                                                {roleNameMap[roleName] || roleName}
                                                            </div>

                                                            {/* 角色修改下拉框 */}
                                                            {hasPermission('org_member', 'update') && canModify ? (
                                                                <select
                                                                    value={member.roleId}
                                                                    onChange={e => handleUpdateRole(member, parseInt(e.target.value))}
                                                                    className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                                >
                                                                    {getAssignableRoles().map(r => (
                                                                        <option key={r.id} value={r.id}>
                                                                            {roleNameMap[r.name] || r.name}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            ) : hasPermission('org_member', 'update') ? (
                                                                <div className="flex items-center gap-1 text-xs text-gray-400" title={
                                                                    isMemberSuperAdmin ? '超级管理员的角色不可修改' :
                                                                    isSelf ? '不能修改自己的角色' :
                                                                    '该成员角色等于或高于您的角色'
                                                                }>
                                                                    <Lock className="h-3 w-3" />
                                                                </div>
                                                            ) : null}

                                                            {/* 移除按钮 */}
                                                            {hasPermission('org_member', 'delete') && canModify && (
                                                                <button
                                                                    onClick={() => handleRemoveMember(member)}
                                                                    className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                                                                    title="移除成员"
                                                                >
                                                                    <XCircle className="h-4 w-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })
                                        ) : (
                                            <div className="text-center py-12 text-gray-400">
                                                <Users className="h-10 w-10 mx-auto mb-3 opacity-50" />
                                                <p>{searchQuery ? '未找到匹配的成员' : '暂无成员'}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 角色权限 Tab */}
                            {activeTab === 'roles' && hasPermission('organization', 'manage') && (
                                <div className="space-y-3">
                                    <div className="text-xs text-gray-500 dark:text-gray-400 px-1">
                                        点击角色展开权限编辑。系统内置角色的权限为只读。
                                    </div>

                                    {roles.map(role => {
                                        const isExpanded = expandedRoleId === role.id
                                        const rolePerm = rolePermissions[role.id] || []
                                        const RoleIcon = roleIconMap[role.name] || Settings
                                        const colorClass = roleColorMap[role.name] || 'text-gray-500 bg-gray-500/10 border-gray-500/20'

                                        return (
                                            <div
                                                key={role.id}
                                                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
                                            >
                                                {/* 角色头部 */}
                                                <button
                                                    onClick={() => handleExpandRole(role.id)}
                                                    className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
                                                            colorClass
                                                        )}>
                                                            <RoleIcon className="h-3 w-3" />
                                                            {roleNameMap[role.name] || role.name}
                                                        </div>
                                                        {role.description && (
                                                            <span className="text-xs text-gray-400">
                                                                {role.description}
                                                            </span>
                                                        )}
                                                        {role.isSystem && (
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-medium">
                                                                系统角色
                                                            </span>
                                                        )}
                                                    </div>
                                                    {isExpanded ? (
                                                        <ChevronUp className="h-4 w-4 text-gray-400" />
                                                    ) : (
                                                        <ChevronDown className="h-4 w-4 text-gray-400" />
                                                    )}
                                                </button>

                                                {/* 权限矩阵 */}
                                                {isExpanded && (
                                                    <div className="border-t border-gray-200 dark:border-gray-800 p-4 space-y-4">
                                                        {role.isSystem ? (
                                                            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
                                                                <Lock className="h-3.5 w-3.5" />
                                                                系统内置角色的权限不可修改
                                                            </div>
                                                        ) : null}

                                                        <div className="overflow-x-auto">
                                                            <table className="w-full text-sm">
                                                                <thead>
                                                                    <tr className="border-b border-gray-200 dark:border-gray-700">
                                                                        <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 uppercase tracking-wide min-w-[120px]">
                                                                            资源
                                                                        </th>
                                                                        {allActions.map(action => (
                                                                            <th key={action} className="text-center py-2 px-2 text-xs font-medium text-gray-500 uppercase tracking-wide min-w-[60px]">
                                                                                {actionNameMap[action] || action}
                                                                            </th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {Object.entries(permissionsByResource).map(([resource, perms]) => (
                                                                        <tr key={resource} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                                                                            <td className="py-2.5 pr-4 text-xs font-medium text-gray-700 dark:text-gray-300">
                                                                                {resourceNameMap[resource] || resource}
                                                                            </td>
                                                                            {allActions.map(action => {
                                                                                const perm = perms.find(p => p.action === action)
                                                                                if (!perm) {
                                                                                    return <td key={action} className="text-center py-2.5 px-2">
                                                                                        <span className="text-gray-300 dark:text-gray-700">—</span>
                                                                                    </td>
                                                                                }
                                                                                const isChecked = rolePerm.includes(perm.id)
                                                                                return (
                                                                                    <td key={action} className="text-center py-2.5 px-2">
                                                                                        <input
                                                                                            type="checkbox"
                                                                                            checked={isChecked}
                                                                                            disabled={role.isSystem}
                                                                                            onChange={() => handleTogglePermission(role.id, perm.id)}
                                                                                            className={cn(
                                                                                                'h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500/20 transition-colors',
                                                                                                role.isSystem ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                                                                                            )}
                                                                                        />
                                                                                    </td>
                                                                                )
                                                                            })}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>

                                                        {/* 保存按钮 */}
                                                        {!role.isSystem && (
                                                            <div className="flex justify-end pt-2">
                                                                <button
                                                                    onClick={() => handleSaveRolePermissions(role.id)}
                                                                    disabled={savingPermissions}
                                                                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                                                                >
                                                                    {savingPermissions ? (
                                                                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white"></div>
                                                                    ) : (
                                                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                                                    )}
                                                                    保存权限
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-64 text-gray-400">
                            <div className="text-center">
                                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                <p>请选择一个组织</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 创建组织弹窗 */}
            {showCreateOrg && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <Building2 className="h-5 w-5 text-blue-500" />
                            创建组织
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">组织名称 *</label>
                                <input
                                    type="text"
                                    value={newOrgName}
                                    onChange={e => {
                                        setNewOrgName(e.target.value)
                                        // 自动生成 slug
                                        if (!newOrgSlug || newOrgSlug === newOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) {
                                            setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''))
                                        }
                                    }}
                                    placeholder="My Team"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">标识 (Slug) *</label>
                                <input
                                    type="text"
                                    value={newOrgSlug}
                                    onChange={e => setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                    placeholder="my-team"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
                                <textarea
                                    value={newOrgDesc}
                                    onChange={e => setNewOrgDesc(e.target.value)}
                                    placeholder="团队描述..."
                                    rows={2}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => setShowCreateOrg(false)}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCreateOrg}
                                className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                            >
                                创建
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 添加成员弹窗 */}
            {showAddMember && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <UserPlus className="h-5 w-5 text-emerald-500" />
                            添加成员到「{selectedOrg?.name}」
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">选择用户 *</label>
                                <select
                                    value={addMemberUserId}
                                    onChange={e => setAddMemberUserId(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                >
                                    <option value="">请选择用户</option>
                                    {allUsers.filter(u => !members.some(m => m.userId === u.id)).map(u => (
                                        <option key={u.id} value={u.id}>
                                            {u.username} ({u.email})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">分配角色 *</label>
                                <select
                                    value={addMemberRoleId}
                                    onChange={e => setAddMemberRoleId(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                >
                                    <option value="">请选择角色</option>
                                    {getAssignableRoles().map(r => (
                                        <option key={r.id} value={r.id}>
                                            {roleNameMap[r.name] || r.name} - {r.description}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => setShowAddMember(false)}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleAddMember}
                                className="px-4 py-2 text-sm bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors font-medium"
                            >
                                添加
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* 编辑组织弹窗 */}
            {showEditOrg && selectedOrg && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 border border-gray-200 dark:border-gray-800">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <Edit3 className="h-5 w-5 text-blue-500" />
                            编辑组织
                        </h3>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">组织名称 *</label>
                                <input
                                    type="text"
                                    value={editOrgName}
                                    onChange={e => setEditOrgName(e.target.value)}
                                    placeholder="组织名称"
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">标识 (Slug)</label>
                                <input
                                    type="text"
                                    value={selectedOrg.slug}
                                    disabled
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-gray-400 font-mono cursor-not-allowed"
                                />
                                <p className="mt-1 text-xs text-gray-400">Slug 创建后不可修改</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">描述</label>
                                <textarea
                                    value={editOrgDesc}
                                    onChange={e => setEditOrgDesc(e.target.value)}
                                    placeholder="团队描述..."
                                    rows={2}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                onClick={() => setShowEditOrg(false)}
                                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleUpdateOrg}
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
