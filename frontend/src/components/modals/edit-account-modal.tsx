'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { Save, AlertCircle, Eye, EyeOff, Loader2, Mail, Globe2, StickyNote, Network } from 'lucide-react'
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

type EditAccountSection = 'identity' | 'domain' | 'note' | 'proxy'

interface EditSectionItem {
    key: EditAccountSection
    title: string
    description: string
    meta: string
    icon: typeof Mail
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
    const [activeSection, setActiveSection] = useState<EditAccountSection>('identity')
    const bodyRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)

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
            setActiveSection('identity')
            loadFullAccount()
        }
    }, [isOpen, accountId, loadFullAccount])

    useEffect(() => {
        const timer = window.setTimeout(() => {
            bodyRef.current?.scrollTo({ top: 0 })
            panelRef.current?.scrollTo({ top: 0 })
        }, 0)
        return () => window.clearTimeout(timer)
    }, [activeSection])

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
        setActiveSection('identity')
        onClose()
    }

    const isOAuth2Provider = () => {
        if (fullAccount?.mailProvider?.type === 'outlook') return true
        if (fullAccount?.mailProvider?.type === 'gmail') return gmailOAuth2Available
        return false
    }

    const sections: EditSectionItem[] = [
        {
            key: 'identity',
            title: '账户认证',
            description: '提供商、邮箱和登录凭据',
            meta: form.authType === 'oauth2' ? 'OAuth2' : '密码',
            icon: Mail,
        },
        {
            key: 'domain',
            title: '域名邮箱',
            description: '域名收件身份配置',
            meta: form.isDomainMail ? (form.domain || '已启用') : '未启用',
            icon: Globe2,
        },
        {
            key: 'note',
            title: '账户备注',
            description: 'Markdown / HTML / JS 内容',
            meta: form.note.trim() ? '已填写' : '未填写',
            icon: StickyNote,
        },
        {
            key: 'proxy',
            title: '代理策略',
            description: '手动、选择或自动匹配代理',
            meta: form.useProxy ? '已启用' : '未启用',
            icon: Network,
        },
    ]

    return (
        <Modal open={isOpen && !!accountId} onOpenChange={(open) => !open && handleClose()}>
            <ModalContent size="full" className="h-[88vh] max-w-[1180px] overflow-hidden">
                <ModalHeader>
                    <ModalTitle>编辑邮箱账户</ModalTitle>
                    <ModalDescription>
                        修改账户认证信息、备注和代理设置
                    </ModalDescription>
                </ModalHeader>

                <ModalBody ref={bodyRef} className="min-h-0 overflow-hidden p-0">
                    {loadingAccount ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="text-center">
                                <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary-600" />
                                <p className="text-gray-500 dark:text-gray-400">加载账户信息...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[290px_minmax(0,1fr)] lg:grid-rows-1">
                            <aside className="border-b border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/40 lg:border-b-0 lg:border-r">
                                <div className="mb-4 hidden rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200 lg:block">
                                    <div className="font-medium">{form.email || '邮箱账户'}</div>
                                    <div className="mt-1 text-xs opacity-80">{fullAccount?.mailProvider?.name || '未知提供商'}</div>
                                </div>
                                <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
                                    {sections.map((section) => {
                                        const Icon = section.icon
                                        const isActive = activeSection === section.key
                                        return (
                                            <button
                                                key={section.key}
                                                type="button"
                                                onClick={() => setActiveSection(section.key)}
                                                className={cn(
                                                    'min-w-[210px] rounded-xl border p-3 text-left transition-all duration-200 lg:min-w-0',
                                                    isActive
                                                        ? 'border-primary-200 bg-white shadow-sm ring-2 ring-primary-100 dark:border-primary-800 dark:bg-gray-800 dark:ring-primary-950'
                                                        : 'border-transparent text-gray-600 hover:border-gray-200 hover:bg-white dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-800/70'
                                                )}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <span className={cn(
                                                        'rounded-lg p-2 transition-colors',
                                                        isActive
                                                            ? 'bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300'
                                                            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                                    )}>
                                                        <Icon className="h-4 w-4" />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-sm font-semibold text-gray-900 dark:text-white">{section.title}</span>
                                                        <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{section.description}</span>
                                                        <span className="mt-2 inline-flex max-w-full rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                                            <span className="truncate">{section.meta}</span>
                                                        </span>
                                                    </span>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </aside>

                            <div key={activeSection} ref={panelRef} className="min-h-0 overflow-y-auto p-6">
                                <AnimatePresence mode="wait">
                                    {activeSection === 'identity' && (
                                        <motion.div
                                            key="identity"
                                            initial={{ opacity: 0, x: 18 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -18 }}
                                            transition={{ duration: 0.18 }}
                                            className="space-y-5"
                                        >
                                            <PanelHeader
                                                icon={<Mail className="h-5 w-5" />}
                                                title="账户认证"
                                                description="维护邮箱地址、提供商和登录凭据。"
                                            />
                                            <div className="grid gap-4 xl:grid-cols-2">
                                                <div className="space-y-2">
                                                    <Label>邮件提供商</Label>
                                                    <Input
                                                        value={fullAccount?.mailProvider?.name || '未知'}
                                                        disabled
                                                        className="bg-gray-50 dark:bg-gray-700"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>邮箱地址</Label>
                                                    <Input
                                                        type="email"
                                                        value={form.email}
                                                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
                                                <Label>验证方式</Label>
                                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setForm({ ...form, authType: 'password' })}
                                                        className={cn(
                                                            'rounded-lg border px-4 py-3 text-left transition-colors',
                                                            form.authType === 'password'
                                                                ? 'border-primary-500 bg-primary-50 text-primary-900 dark:bg-primary-950/40 dark:text-primary-100'
                                                                : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300'
                                                        )}
                                                    >
                                                        <div className="text-sm font-medium">密码</div>
                                                        <div className="mt-1 text-xs opacity-70">普通密码或应用专用密码</div>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => isOAuth2Provider() && setForm({ ...form, authType: 'oauth2' })}
                                                        disabled={!isOAuth2Provider()}
                                                        className={cn(
                                                            'rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                                            form.authType === 'oauth2'
                                                                ? 'border-primary-500 bg-primary-50 text-primary-900 dark:bg-primary-950/40 dark:text-primary-100'
                                                                : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300'
                                                        )}
                                                    >
                                                        <div className="text-sm font-medium">OAuth2</div>
                                                        <div className="mt-1 text-xs opacity-70">使用已授权的 OAuth2 Token</div>
                                                    </button>
                                                </div>
                                            </div>

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
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                                                        >
                                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            {form.authType === 'oauth2' && (
                                                <div className="space-y-4">
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
                                                    <div className="grid gap-4 xl:grid-cols-2">
                                                        <div className="space-y-2">
                                                            <Label>Access Token</Label>
                                                            <Textarea
                                                                value={form.accessToken}
                                                                onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                                                                rows={6}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>Refresh Token</Label>
                                                            <Textarea
                                                                value={form.refreshToken}
                                                                onChange={(e) => setForm({ ...form, refreshToken: e.target.value })}
                                                                rows={6}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </motion.div>
                                    )}

                                    {activeSection === 'domain' && (
                                        <motion.div
                                            key="domain"
                                            initial={{ opacity: 0, x: 18 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -18 }}
                                            transition={{ duration: 0.18 }}
                                            className="space-y-5"
                                        >
                                            <PanelHeader
                                                icon={<Globe2 className="h-5 w-5" />}
                                                title="域名邮箱"
                                                description="用于处理发送到域名邮箱或别名邮箱的收件身份。"
                                            />
                                            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/40">
                                                <label className="flex items-start gap-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={form.isDomainMail}
                                                        onChange={(e) => setForm({ ...form, isDomainMail: e.target.checked })}
                                                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                    />
                                                    <span>
                                                        <span className="block text-sm font-semibold text-gray-900 dark:text-white">启用域名邮箱</span>
                                                        <span className="mt-1 block text-sm text-gray-500 dark:text-gray-400">
                                                            开启后会保存该账户对应的域名，便于搜索、匹配和取件场景识别。
                                                        </span>
                                                    </span>
                                                </label>

                                                <AnimatePresence>
                                                    {form.isDomainMail && (
                                                        <motion.div
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: "auto", opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            transition={{ duration: 0.25 }}
                                                            className="overflow-hidden"
                                                        >
                                                            <div className="mt-5 max-w-xl space-y-2">
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
                                        </motion.div>
                                    )}

                                    {activeSection === 'note' && (
                                        <motion.div
                                            key="note"
                                            initial={{ opacity: 0, x: 18 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -18 }}
                                            transition={{ duration: 0.18 }}
                                            className="space-y-5"
                                        >
                                            <PanelHeader
                                                icon={<StickyNote className="h-5 w-5" />}
                                                title="账户备注"
                                                description="记录账号用途、风控信息或可交互 HTML/JS 内容。"
                                            />
                                            <AccountNoteEditor
                                                value={form.note}
                                                format={form.noteFormat}
                                                onValueChange={(note) => setForm({ ...form, note })}
                                                onFormatChange={(noteFormat) => setForm({ ...form, noteFormat })}
                                                className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/40"
                                            />
                                        </motion.div>
                                    )}

                                    {activeSection === 'proxy' && (
                                        <motion.div
                                            key="proxy"
                                            initial={{ opacity: 0, x: 18 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -18 }}
                                            transition={{ duration: 0.18 }}
                                            className="space-y-5"
                                        >
                                            <PanelHeader
                                                icon={<Network className="h-5 w-5" />}
                                                title="代理策略"
                                                description="为这个邮箱账户配置固定代理、代理池匹配和不可用时的兜底策略。"
                                            />
                                            <ProxyConfigSection
                                                value={form}
                                                onChange={(proxyConfig) => setForm({ ...form, ...proxyConfig })}
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
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

function PanelHeader({
    icon,
    title,
    description,
}: {
    icon: ReactNode
    title: string
    description: string
}) {
    return (
        <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary-50 p-2 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
                {icon}
            </span>
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
            </div>
        </div>
    )
}
