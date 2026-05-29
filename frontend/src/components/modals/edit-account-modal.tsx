'use client'

import { useState, useEffect, useCallback } from 'react'
import { Save, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { emailAccountService } from '@/services/email-account.service'
import { oauth2Service } from '@/services/oauth2.service'
import { AccountNoteFormat, EmailAccount, ProxyAccountMode, ProxyFallbackMode, ProxyTagFilterMode, ProxyType } from '@/types'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { AccountNoteEditor } from '@/components/accounts/account-note-editor'
import { ProxyConfigSection, defaultProxyConfigValue } from '@/components/proxy/proxy-config-section'
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
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'

interface EditAccountModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
    onError?: (error: string) => void
    accountId: number | null
}

interface EditAccountForm {
    email: string
    authType: 'password' | 'oauth2' | 'app_password'
    password: string
    clientId: string
    accessToken: string
    refreshToken: string
    useProxy: boolean
    proxyMode: ProxyAccountMode
    proxyType: ProxyType
    proxyUrl: string
    proxyUsername: string
    proxyPassword: string
    proxyId?: number
    proxyFallbackMode: ProxyFallbackMode
    proxyFallbackProxyId?: number
    proxyFallbackProxy: string
    proxyMatchGroupIds: number[]
    proxyMatchTagIds: number[]
    proxyMatchTagMode: ProxyTagFilterMode
    isDomainMail: boolean
    domain: string
    note: string
    noteFormat: AccountNoteFormat
}

export default function EditAccountModal({
    isOpen,
    onClose,
    onSuccess,
    onError,
    accountId
}: EditAccountModalProps) {
    const [loading, setLoading] = useState(false)
    const [loadingAccount, setLoadingAccount] = useState(false)
    const [fullAccount, setFullAccount] = useState<EmailAccount | null>(null)
    const [showPassword, setShowPassword] = useState(false)
    const [gmailOAuth2Available, setGmailOAuth2Available] = useState(false)

    const [form, setForm] = useState<EditAccountForm>({
        email: '',
        authType: 'password',
        password: '',
        clientId: '',
        accessToken: '',
        refreshToken: '',
        ...defaultProxyConfigValue(),
        isDomainMail: false,
        domain: '',
        note: '',
        noteFormat: 'markdown'
    })

    const loadFullAccount = useCallback(async () => {
        if (!accountId) return

        try {
            setLoadingAccount(true)
            const data = await emailAccountService.getAccount(accountId)
            setFullAccount(data)

            try {
                const isGmailConfigured = await oauth2Service.isProviderConfigured('gmail')
                setGmailOAuth2Available(isGmailConfigured)
            } catch (error) {
                setGmailOAuth2Available(false)
            }

            let proxyUrl = data.proxy || ''
            let proxyUsername = ''
            let proxyPassword = ''

            if (proxyUrl) {
                try {
                    const url = new URL(proxyUrl)
                    proxyUsername = url.username || ''
                    proxyPassword = url.password || ''
                    url.username = ''
                    url.password = ''
                    proxyUrl = url.toString()
                } catch (e) { }
            }

            setForm({
                email: data.emailAddress || '',
                authType: data.authType || 'password',
                password: data.password || '',
                clientId: data.customSettings?.client_id || '',
                accessToken: data.customSettings?.access_token || '',
                refreshToken: data.customSettings?.refresh_token || '',
                useProxy: !!data.proxy || data.proxyMode === 'selected' || data.proxyMode === 'auto',
                proxyMode: data.proxyMode || 'manual',
                proxyType: 'socks5',
                proxyUrl: proxyUrl,
                proxyUsername: proxyUsername,
                proxyPassword: proxyPassword,
                proxyId: data.proxyId,
                proxyFallbackMode: data.proxyFallbackMode || 'interrupt',
                proxyFallbackProxyId: data.proxyFallbackProxyId,
                proxyFallbackProxy: data.proxyFallbackProxy || '',
                proxyMatchGroupIds: data.proxyMatchGroupIds || [],
                proxyMatchTagIds: data.proxyMatchTagIds || [],
                proxyMatchTagMode: data.proxyMatchTagMode || 'or',
                isDomainMail: data.isDomainMail || false,
                domain: data.domain || '',
                note: data.note || '',
                noteFormat: data.noteFormat || 'markdown'
            })
        } catch (error) {
            console.error('Failed to load account details:', error)
            onError?.('加载账户详情失败')
        } finally {
            setLoadingAccount(false)
        }
    }, [accountId, onError])

    useEffect(() => {
        if (isOpen && accountId) {
            loadFullAccount()
        }
    }, [isOpen, accountId, loadFullAccount])

    const handleSubmit = async () => {
        if (!accountId || !fullAccount) return

        setLoading(true)
        try {
            const payload: any = {
                email_address: form.email,
                auth_type: form.authType,
                mail_provider_id: fullAccount.mailProviderId,
                is_domain_mail: form.isDomainMail,
                domain: form.isDomainMail ? form.domain : '',
                note: form.note,
                note_format: form.noteFormat
            }

            if (form.authType === 'password' || form.authType === 'app_password') {
                payload.password = form.password
            }

            if (form.authType === 'oauth2') {
                payload.custom_settings = {
                    client_id: form.clientId,
                    access_token: form.accessToken,
                    refresh_token: form.refreshToken
                }
            }

            if (form.useProxy) {
                payload.proxy_mode = form.proxyMode
                payload.proxy_fallback_mode = form.proxyFallbackMode
                payload.proxy_fallback_proxy_id = form.proxyFallbackProxyId
                payload.proxy_fallback_proxy = form.proxyFallbackProxy
                payload.proxy_match_group_ids = form.proxyMatchGroupIds
                payload.proxy_match_tag_ids = form.proxyMatchTagIds
                payload.proxy_match_tag_mode = form.proxyMatchTagMode

                if (form.proxyMode === 'manual') {
                    payload.proxy = form.proxyUrl
                    if (form.proxyUsername && form.proxyPassword) {
                        try {
                            const url = new URL(form.proxyUrl)
                            url.username = form.proxyUsername
                            url.password = form.proxyPassword
                            payload.proxy = url.toString()
                        } catch (e) {
                            payload.proxy = form.proxyUrl
                        }
                    }
                } else if (form.proxyMode === 'selected') {
                    payload.proxy_id = form.proxyId
                }
            } else {
                payload.proxy = ''
                payload.proxy_mode = 'manual'
            }

            await emailAccountService.updateAccount(accountId, payload)
            onSuccess?.()
            handleClose()
        } catch (error: any) {
            onError?.(error.message || '更新账户失败')
        } finally {
            setLoading(false)
        }
    }

    const handleClose = () => {
        setForm({
            email: '',
            authType: 'password',
            password: '',
            clientId: '',
            accessToken: '',
            refreshToken: '',
            ...defaultProxyConfigValue(),
            isDomainMail: false,
            domain: '',
            note: '',
            noteFormat: 'markdown'
        })
        setFullAccount(null)
        setShowPassword(false)
        onClose()
    }

    const isOAuth2Provider = () => {
        if (fullAccount?.mailProvider?.type === 'outlook') return true
        if (fullAccount?.mailProvider?.type === 'gmail') return gmailOAuth2Available
        return false
    }

    return (
        <Modal open={isOpen && !!accountId} onOpenChange={(open) => !open && handleClose()}>
            <ModalContent size="xl" className="max-h-[90vh] flex flex-col">
                <ModalHeader>
                    <ModalTitle>编辑邮箱账户</ModalTitle>
                    <ModalDescription>
                        修改账户认证信息、备注和代理设置
                    </ModalDescription>
                </ModalHeader>

                <ModalBody className="flex-1 overflow-y-auto">
                    {loadingAccount ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                                <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary-600" />
                                <p className="text-gray-500 dark:text-gray-400">加载账户信息...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* 提供商信息 */}
                            <div className="space-y-2">
                                <Label>邮件提供商</Label>
                                <Input
                                    value={fullAccount?.mailProvider?.name || '未知'}
                                    disabled
                                    className="bg-gray-50 dark:bg-gray-700"
                                />
                            </div>

                            {/* 邮箱地址 */}
                            <div className="space-y-2">
                                <Label>邮箱地址</Label>
                                <Input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    required
                                />
                            </div>

                            {/* 验证方式 */}
                            <div className="space-y-2">
                                <Label>验证方式</Label>
                                <div className="flex space-x-4">
                                    <label className="flex items-center">
                                        <input
                                            type="radio"
                                            value="password"
                                            checked={form.authType === 'password'}
                                            onChange={() => setForm({ ...form, authType: 'password' })}
                                            className="mr-2"
                                        />
                                        <span className="text-sm">密码</span>
                                    </label>
                                    <label className="flex items-center">
                                        <input
                                            type="radio"
                                            value="oauth2"
                                            checked={form.authType === 'oauth2'}
                                            onChange={() => setForm({ ...form, authType: 'oauth2' })}
                                            className="mr-2"
                                            disabled={!isOAuth2Provider()}
                                        />
                                        <span className={cn("text-sm", !isOAuth2Provider() && "text-gray-400")}>
                                            OAuth2
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {/* 密码输入 */}
                            {(form.authType === 'password' || form.authType === 'app_password') && (
                                <div className="space-y-2">
                                    <Label>密码</Label>
                                    <div className="relative">
                                        <Input
                                            type={showPassword ? "text" : "password"}
                                            value={form.password}
                                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                                            placeholder="输入密码"
                                            className="pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500"
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* OAuth2 输入 */}
                            {form.authType === 'oauth2' && (
                                <>
                                    <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
                                        <div className="flex items-start space-x-2">
                                            <AlertCircle className="h-5 w-5 flex-shrink-0 text-blue-600" />
                                            <p className="text-sm text-blue-700 dark:text-blue-300">
                                                OAuth2 认证信息已加载，您可以直接修改
                                            </p>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Client ID</Label>
                                        <Input
                                            value={form.clientId}
                                            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                                            placeholder="Client ID"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Access Token</Label>
                                        <Textarea
                                            value={form.accessToken}
                                            onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                                            rows={3}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Refresh Token</Label>
                                        <Textarea
                                            value={form.refreshToken}
                                            onChange={(e) => setForm({ ...form, refreshToken: e.target.value })}
                                            rows={3}
                                        />
                                    </div>
                                </>
                            )}

                            {/* 域名邮箱设置 */}
                            <div className="space-y-3">
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        id="isDomainMail"
                                        checked={form.isDomainMail}
                                        onChange={(e) => setForm({ ...form, isDomainMail: e.target.checked })}
                                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                    />
                                    <Label htmlFor="isDomainMail">启用域名邮箱</Label>
                                </div>

                                <AnimatePresence>
                                    {form.isDomainMail && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.3 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="pt-3 space-y-2">
                                                <Label>域名</Label>
                                                <Input
                                                    value={form.domain}
                                                    onChange={(e) => setForm({ ...form, domain: e.target.value })}
                                                    placeholder="example.com"
                                                />
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            <AccountNoteEditor
                                value={form.note}
                                format={form.noteFormat}
                                onValueChange={(note) => setForm({ ...form, note })}
                                onFormatChange={(noteFormat) => setForm({ ...form, noteFormat })}
                            />

                            <ProxyConfigSection
                                value={form}
                                onChange={(proxyConfig) => setForm({ ...form, ...proxyConfig })}
                            />
                        </div>
                    )}
                </ModalBody>

                <ModalFooter>
                    <Button variant="outline" onClick={handleClose} disabled={loading}>
                        取消
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={loading || loadingAccount || !form.email || (form.isDomainMail && !form.domain)}
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                保存中...
                            </>
                        ) : (
                            <>
                                <Save className="mr-2 h-4 w-4" />
                                保存更改
                            </>
                        )}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}
