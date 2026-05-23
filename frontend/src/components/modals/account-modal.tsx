'use client'

import { useState, useEffect } from 'react'
import { EmailAccount } from '@/types'
import { emailAccountService } from '@/services/email-account.service'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalTitle,
    ModalDescription
} from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-react'

interface AccountModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    account?: EmailAccount | null
}

export default function AccountModal({ isOpen, onClose, onSuccess, account }: AccountModalProps) {
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        app_password: '',
        auth_type: 'password' as 'password' | 'oauth2' | 'app_password',
        provider: 'gmail',
        use_proxy: false,
        proxy_url: '',
        proxy_username: '',
        proxy_password: ''
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        if (account) {
            setFormData({
                email: account.emailAddress,
                password: '',
                app_password: '',
                auth_type: account.authType || 'password',
                provider: account.mailProvider?.name || 'gmail',
                use_proxy: !!account.proxy,
                proxy_url: account.proxy || '',
                proxy_username: '',
                proxy_password: ''
            })
        } else {
            // 重置表单
            setFormData({
                email: '',
                password: '',
                app_password: '',
                auth_type: 'password',
                provider: 'gmail',
                use_proxy: false,
                proxy_url: '',
                proxy_username: '',
                proxy_password: ''
            })
        }
        setError('')
    }, [account, isOpen])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')

        try {
            const payload: any = {
                email_address: formData.email,
                auth_type: formData.auth_type,
                provider: formData.provider,
                use_proxy: formData.use_proxy
            }

            // 根据认证类型设置密码
            if (formData.auth_type === 'app_password') {
                payload.app_password = formData.app_password
            } else if (formData.auth_type === 'password') {
                payload.password = formData.password
            }

            // 如果使用代理，添加代理信息
            if (formData.use_proxy) {
                payload.proxy_url = formData.proxy_url
                payload.proxy_username = formData.proxy_username
                payload.proxy_password = formData.proxy_password
            }

            if (account) {
                // 更新账户
                await emailAccountService.updateAccount(account.id, payload)
            } else {
                // 创建账户
                await emailAccountService.createAccount(payload)
            }

            onSuccess()
            onClose()
        } catch (err: any) {
            setError(err.message || '操作失败，请重试')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent size="md">
                <form onSubmit={handleSubmit}>
                    <ModalHeader>
                        <ModalTitle>{account ? '编辑邮箱账户' : '添加邮箱账户'}</ModalTitle>
                        <ModalDescription>
                            {account ? '修改邮箱账户信息' : '添加新的邮箱账户'}
                        </ModalDescription>
                    </ModalHeader>

                    <ModalBody className="space-y-4">
                        {/* 错误提示 */}
                        {error && (
                            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                {error}
                            </div>
                        )}

                        {/* 邮箱地址 */}
                        <div className="space-y-2">
                            <Label>邮箱地址</Label>
                            <Input
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                required
                                disabled={!!account}
                            />
                        </div>

                        {/* 邮箱提供商 */}
                        <div className="space-y-2">
                            <Label>邮箱提供商</Label>
                            <Select
                                value={formData.provider}
                                onValueChange={(value) => setFormData({ ...formData, provider: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="gmail">Gmail</SelectItem>
                                    <SelectItem value="outlook">Outlook</SelectItem>
                                    <SelectItem value="yahoo">Yahoo</SelectItem>
                                    <SelectItem value="other">其他</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* 认证方式 */}
                        <div className="space-y-2">
                            <Label>认证方式</Label>
                            <Select
                                value={formData.auth_type}
                                onValueChange={(value) => setFormData({ ...formData, auth_type: value as any })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="password">密码</SelectItem>
                                    <SelectItem value="app_password">应用专用密码</SelectItem>
                                    <SelectItem value="oauth2">OAuth2</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* 密码输入 */}
                        {formData.auth_type === 'password' && (
                            <div className="space-y-2">
                                <Label>密码</Label>
                                <Input
                                    type="password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    required={!account}
                                    placeholder={account ? '留空表示不修改' : ''}
                                />
                            </div>
                        )}

                        {/* 应用专用密码输入 */}
                        {formData.auth_type === 'app_password' && (
                            <div className="space-y-2">
                                <Label>应用专用密码</Label>
                                <Input
                                    type="password"
                                    value={formData.app_password}
                                    onChange={(e) => setFormData({ ...formData, app_password: e.target.value })}
                                    required={!account}
                                    placeholder={account ? '留空表示不修改' : ''}
                                />
                                <p className="text-xs text-gray-500">
                                    请在邮箱设置中生成应用专用密码
                                </p>
                            </div>
                        )}

                        {/* OAuth2 提示 */}
                        {formData.auth_type === 'oauth2' && (
                            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                                OAuth2 认证将在保存后自动跳转到授权页面
                            </div>
                        )}

                        {/* 代理设置 */}
                        <div className="flex items-center justify-between">
                            <Label>使用代理</Label>
                            <Switch
                                checked={formData.use_proxy}
                                onCheckedChange={(checked) => setFormData({ ...formData, use_proxy: checked })}
                            />
                        </div>

                        {/* 代理详细设置 */}
                        {formData.use_proxy && (
                            <>
                                <div className="space-y-2">
                                    <Label>代理地址</Label>
                                    <Input
                                        value={formData.proxy_url}
                                        onChange={(e) => setFormData({ ...formData, proxy_url: e.target.value })}
                                        placeholder="socks5://127.0.0.1:1080"
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>代理用户名（可选）</Label>
                                    <Input
                                        value={formData.proxy_username}
                                        onChange={(e) => setFormData({ ...formData, proxy_username: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>代理密码（可选）</Label>
                                    <Input
                                        type="password"
                                        value={formData.proxy_password}
                                        onChange={(e) => setFormData({ ...formData, proxy_password: e.target.value })}
                                    />
                                </div>
                            </>
                        )}
                    </ModalBody>

                    <ModalFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={loading}
                        >
                            取消
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    处理中...
                                </>
                            ) : account ? '保存' : '添加'}
                        </Button>
                    </ModalFooter>
                </form>
            </ModalContent>
        </Modal>
    )
}
