'use client'

import { Bell, User, LogOut, ChevronDown, Upload, Camera, UserCircle, Building2, Check } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/context/auth-context'
import { authService } from '@/services/auth.service'
import { organizationService, Organization } from '@/services/organization.service'
import GlobalEmailSearch from './global-email-search'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { getUnreadCount, subscribeToNotifications } from '@/lib/notification-store'
import { NotificationDrawer } from '@/components/notifications/notification-drawer'

// 添加全局样式
if (typeof document !== 'undefined') {
    const style = document.createElement('style')
    style.innerHTML = `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    @keyframes slideUp {
      from { transform: translateY(30px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `
    document.head.appendChild(style)
}

export function Header() {
    const [showUserProfileModal, setShowUserProfileModal] = useState(false)
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        old_password: '',
        new_password: '',
    })
    const fileInputRef = useRef<HTMLInputElement>(null)
    const { user, logout, refreshUser, currentOrganization, switchOrganization } = useAuth()

    // 组织切换相关
    const [organizations, setOrganizations] = useState<Organization[]>([])
    const [orgLoading, setOrgLoading] = useState(false)

    // 通知相关状态
    const [showNotificationDrawer, setShowNotificationDrawer] = useState(false)
    const [unreadCount, setUnreadCount] = useState(0)

    // 订阅通知变化
    useEffect(() => {
        // 初始加载未读数量
        setUnreadCount(getUnreadCount())

        // 订阅变化
        const unsubscribe = subscribeToNotifications(() => {
            setUnreadCount(getUnreadCount())
        })

        return unsubscribe
    }, [])

    useEffect(() => {
        const openNotificationDrawer = () => setShowNotificationDrawer(true)
        window.addEventListener('openNotificationDrawer', openNotificationDrawer)
        return () => window.removeEventListener('openNotificationDrawer', openNotificationDrawer)
    }, [])

    // 加载组织列表
    useEffect(() => {
        const loadOrgs = async () => {
            try {
                const orgs = await organizationService.getOrganizations()
                setOrganizations(orgs)
            } catch {
                // 忽略，可能组织功能尚未部署
            }
        }
        if (user) loadOrgs()
    }, [user])

    // 切换组织
    const handleSwitchOrg = async (orgId: number) => {
        if (orgId === currentOrganization?.id) return
        setOrgLoading(true)
        try {
            await switchOrganization(orgId)
        } finally {
            setOrgLoading(false)
        }
    }

    // 处理头像变更
    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        // 检查文件类型是否为图片
        if (!file.type.startsWith('image/')) {
            toast.warning('请上传图片文件')
            return
        }

        // 检查文件大小，限制为2MB
        if (file.size > 2 * 1024 * 1024) {
            toast.warning('图片大小不能超过2MB')
            return
        }

        const reader = new FileReader()
        reader.onload = (event) => {
            if (event.target?.result) {
                setAvatarPreview(event.target.result as string)
            }
        }
        reader.readAsDataURL(file)
    }

    // 处理表单字段变更
    const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
    }

    // 处理表单提交
    const handleSubmit = async () => {
        try {
            setIsSubmitting(true)

            // 构建请求数据
            const updateData: any = {}

            // 仅包含已修改的字段
            if (formData.username && formData.username !== user?.username) {
                updateData.username = formData.username
            }

            if (formData.email && formData.email !== user?.email) {
                updateData.email = formData.email
            }

            // 仅在同时提供旧密码和新密码时更新密码
            if (formData.old_password && formData.new_password) {
                updateData.old_password = formData.old_password
                updateData.new_password = formData.new_password
            }

            // 如果有新头像预览，添加到请求数据中
            if (avatarPreview) {
                updateData.avatar = avatarPreview
            }

            // 如果没有任何字段被修改，直接关闭模态框
            if (Object.keys(updateData).length === 0) {
                setShowUserProfileModal(false)
                return
            }

            // 发送更新请求
            await authService.updateUser(updateData)

            // 刷新用户信息
            await refreshUser()

            // 关闭模态框
            setShowUserProfileModal(false)

            // 重置表单数据
            setFormData({
                username: '',
                email: '',
                old_password: '',
                new_password: '',
            })
            setAvatarPreview(null)

        } catch (error) {
            console.error('更新用户信息失败:', error)
            toast.error('更新用户信息失败，请重试')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <header className="flex h-16 items-center border-b border-gray-200 bg-white px-6 dark:border-gray-700 dark:bg-card">
            <div className="flex flex-1 items-center justify-between">
                {/* 搜索栏 */}
                <GlobalEmailSearch />

                {/* 组织切换器 */}
                <div className="flex items-center space-x-4 ml-6">
                    {organizations.length > 1 && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm">
                                    <Building2 className="h-3.5 w-3.5 text-blue-500" />
                                    <span className="text-gray-700 dark:text-gray-300 max-w-[120px] truncate">
                                        {currentOrganization?.name || '选择组织'}
                                    </span>
                                    <ChevronDown className="h-3 w-3 text-gray-400" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="start"
                                className="w-56 p-0 rounded-md bg-white shadow-md border border-gray-100 dark:bg-gray-800 dark:border-gray-700"
                                sideOffset={8}
                            >
                                <DropdownMenuLabel className="px-3 py-2 text-xs text-gray-400 font-medium">
                                    切换组织
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {organizations.map(org => (
                                    <DropdownMenuItem
                                        key={org.id}
                                        onClick={() => handleSwitchOrg(org.id)}
                                        className="flex items-center justify-between px-3 py-2 text-sm cursor-pointer"
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs font-bold">
                                                {org.name.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="text-gray-700 dark:text-gray-300">{org.name}</span>
                                        </div>
                                        {currentOrganization?.id === org.id && (
                                            <Check className="h-4 w-4 text-blue-500" />
                                        )}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}

                    {/* 单个组织时显示名称 */}
                    {organizations.length === 1 && currentOrganization && (
                        <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                            <Building2 className="h-3.5 w-3.5 text-blue-500" />
                            <span>{currentOrganization.name}</span>
                        </div>
                    )}
                    {/* 通知按钮 */}
                    <button
                        onClick={() => setShowNotificationDrawer(true)}
                        className="relative rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                    >
                        <Bell className="h-5 w-5" />
                        {unreadCount > 0 && (
                            <span className="absolute -right-1 -top-1 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-medium bg-red-500 text-white rounded-full">
                                {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                        )}
                    </button>

                    {/* 用户菜单 */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="flex items-center space-x-1">
                                {user?.avatar ? (
                                    <div className="h-8 w-8 rounded-full overflow-hidden">
                                        <img
                                            src={user.avatar}
                                            alt={user.username}
                                            className="h-full w-full object-cover"
                                        />
                                    </div>
                                ) : (
                                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
                                        <User className="h-5 w-5 text-white" />
                                    </div>
                                )}
                                <ChevronDown className="h-3 w-3 text-gray-500" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className="w-60 p-0 rounded-md bg-white shadow-md border border-gray-100 dark:bg-gray-800 dark:border-gray-700 dark:shadow-gray-900/30"
                            sideOffset={8}
                        >
                            <div className="p-3 border-b border-gray-100 dark:border-gray-700">
                                <div className="font-medium text-gray-800 dark:text-white">{user?.username}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">{user?.email}</div>
                                {/* 添加账号按钮已隐藏 */}
                            </div>
                            <div className="py-1">
                                <DropdownMenuItem
                                    onClick={() => setShowUserProfileModal(true)}
                                    className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                >
                                    <UserCircle className="mr-2 h-4 w-4 text-gray-500 dark:text-gray-400" />
                                    <span>个人资料</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => logout()}
                                    className="flex items-center px-3 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                                >
                                    <LogOut className="mr-2 h-4 w-4" />
                                    <span>退出登录</span>
                                </DropdownMenuItem>
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* 用户资料编辑模态框 */}
            {showUserProfileModal && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 transition-opacity duration-300 ease-in-out"
                    style={{ animation: "fadeIn 0.3s ease-in-out" }}
                >
                    <div
                        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
                        style={{ animation: "slideUp 0.3s ease-out" }}
                    >
                        <h2 className="mb-4 text-xl font-bold text-center">编辑个人资料</h2>

                        {/* 头像上传 */}
                        <div className="mb-6 flex flex-col items-center">
                            <div className="relative mb-2 h-24 w-24">
                                <div className="h-full w-full overflow-hidden rounded-full">
                                    {avatarPreview || user?.avatar ? (
                                        <img
                                            src={avatarPreview || user?.avatar}
                                            alt={user?.username}
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary-400 to-primary-600">
                                            <User className="h-12 w-12 text-white" />
                                        </div>
                                    )}
                                </div>
                                <div className="absolute -right-2 -bottom-2">
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 shadow-md z-10"
                                    >
                                        <Camera className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleAvatarChange}
                            />
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                                点击更换头像
                            </span>
                        </div>

                        {/* 表单字段 */}
                        <div className="mb-4">
                            <label className="mb-1 block text-sm font-medium">用户名</label>
                            <input
                                type="text"
                                name="username"
                                defaultValue={user?.username || ''}
                                onChange={handleFormChange}
                                className="w-full rounded-md border border-gray-300 p-2 dark:border-gray-600 dark:bg-gray-700"
                            />
                        </div>

                        <div className="mb-4">
                            <label className="mb-1 block text-sm font-medium">邮箱</label>
                            <input
                                type="email"
                                name="email"
                                defaultValue={user?.email || ''}
                                onChange={handleFormChange}
                                className="w-full rounded-md border border-gray-300 p-2 dark:border-gray-600 dark:bg-gray-700"
                            />
                        </div>

                        <div className="mb-4">
                            <label className="mb-1 block text-sm font-medium">旧密码</label>
                            <input
                                type="password"
                                name="old_password"
                                onChange={handleFormChange}
                                className="w-full rounded-md border border-gray-300 p-2 dark:border-gray-600 dark:bg-gray-700"
                            />
                        </div>

                        <div className="mb-6">
                            <label className="mb-1 block text-sm font-medium">新密码</label>
                            <input
                                type="password"
                                name="new_password"
                                onChange={handleFormChange}
                                className="w-full rounded-md border border-gray-300 p-2 dark:border-gray-600 dark:bg-gray-700"
                            />
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex justify-end space-x-3">
                            <Button
                                onClick={() => setShowUserProfileModal(false)}
                                variant="outline"
                                disabled={isSubmitting}
                                className="rounded-full px-6 py-2 transition-all duration-200 hover:bg-gray-100"
                            >
                                取消
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                                className="rounded-full px-6 py-2 bg-primary-500 hover:bg-primary-600 text-white transition-all duration-200"
                            >
                                {isSubmitting ? '保存中...' : '保存'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* 通知抽屉 */}
            <NotificationDrawer
                isOpen={showNotificationDrawer}
                onClose={() => setShowNotificationDrawer(false)}
            />
        </header>
    )
}
