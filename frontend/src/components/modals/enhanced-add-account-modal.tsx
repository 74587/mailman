'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect } from 'react'
import { Check, AlertCircle, Loader2, ArrowRight, CheckCircle, Clock, Settings } from 'lucide-react'
import { emailAccountService } from '@/services/email-account.service'
import { oauth2Service } from '@/services/oauth2.service'
import { syncConfigService } from '@/services/sync-config.service'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { AccountNoteFormat, EmailAccount } from '@/types'
import OAuth2PopupAuth from '@/components/oauth2/oauth2-popup-auth'
import { AccountNoteEditor } from '@/components/accounts/account-note-editor'
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

interface EnhancedAddAccountModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
    onError?: (error: string) => void
    presetProvider?: string
    presetAuthType?: string
    autoTriggerOAuth2?: boolean
}

interface MailProvider {
    id: number
    name: string
    type: string
    imapServer: string
    imapPort: number
    smtpServer: string
    smtpPort: number
}

interface AccountForm {
    email: string
    authType: 'password' | 'oauth2'
    password: string
    clientId: string
    accessToken: string
    refreshToken: string
    useProxy: boolean
    proxyUrl: string
    proxyUsername: string
    proxyPassword: string
    isDomainMail: boolean
    domain: string
    note: string
    noteFormat: AccountNoteFormat
    oauth2ProviderConfigId?: number
}

// 工作流程步骤
type WorkflowStep = 'account' | 'verify' | 'sync' | 'config' | 'complete'

interface StepData {
    createdAccount?: EmailAccount
    verificationResult?: any
    syncResult?: any
    configResult?: any
}

export default function EnhancedAddAccountModal({
    isOpen,
    onClose,
    onSuccess,
    onError,
    presetProvider,
    presetAuthType,
    autoTriggerOAuth2
}: EnhancedAddAccountModalProps) {
    const [currentStep, setCurrentStep] = useState<WorkflowStep>('account')
    const [stepData, setStepData] = useState<StepData>({})
    const [loading, setLoading] = useState(false)

    // Account form states
    const [providers, setProviders] = useState<MailProvider[]>([])
    const [selectedProvider, setSelectedProvider] = useState<MailProvider | null>(null)
    const [accountForm, setAccountForm] = useState<AccountForm>({
        email: '',
        authType: 'password',
        password: '',
        clientId: '',
        accessToken: '',
        refreshToken: '',
        useProxy: false,
        proxyUrl: '',
        proxyUsername: '',
        proxyPassword: '',
        isDomainMail: false,
        domain: '',
        note: '',
        noteFormat: 'markdown',
        oauth2ProviderConfigId: undefined
    })

    // Sync form states
    const [syncMode, setSyncMode] = useState<'incremental' | 'full'>('incremental')
    const [maxEmails, setMaxEmails] = useState(1000)
    const [includeBody, setIncludeBody] = useState(true)

    // Config form states  
    const [enableAutoSync, setEnableAutoSync] = useState(true)
    const [syncInterval, setSyncInterval] = useState(300) // 5 minutes

    const [showOAuth2Popup, setShowOAuth2Popup] = useState(false)
    const [oauth2Providers, setOAuth2Providers] = useState<any[]>([])

    // 自定义IMAP服务器配置
    const [isCustomProvider, setIsCustomProvider] = useState(false)
    const [customImapServer, setCustomImapServer] = useState('')
    const [customImapPort, setCustomImapPort] = useState(993)
    const [customSmtpServer, setCustomSmtpServer] = useState('')
    const [customSmtpPort, setCustomSmtpPort] = useState(587)

    // 工作流程步骤配置
    const steps = [
        { key: 'account', title: '添加账户', description: '配置邮件账户信息' },
        { key: 'verify', title: '验证连接', description: '验证账户连接性' },
        { key: 'sync', title: '首次同步', description: '同步邮件到本地' },
        { key: 'config', title: '同步配置', description: '设置自动同步规则' },
        { key: 'complete', title: '完成', description: '账户设置完成' }
    ]

    const currentStepIndex = steps.findIndex(step => step.key === currentStep)

    useEffect(() => {
        if (isOpen) {
            loadProviders()
            loadOAuth2Providers()
            resetForm()
        }
    }, [isOpen])

    useEffect(() => {
        if (presetProvider && providers.length > 0) {
            const provider = providers.find(p => p.type.toLowerCase() === presetProvider.toLowerCase())
            if (provider) {
                setSelectedProvider(provider)
            }
        }
    }, [presetProvider, providers])

    useEffect(() => {
        if (presetAuthType) {
            setAccountForm(prev => ({ ...prev, authType: presetAuthType as 'password' | 'oauth2' }))
        }
    }, [presetAuthType])

    const loadProviders = async () => {
        try {
            const data = await emailAccountService.getProviders()
            setProviders(data)
        } catch (error) {
            console.error('Failed to load providers:', error)
        }
    }

    const loadOAuth2Providers = async () => {
        try {
            const data = await oauth2Service.getConfigs()
            setOAuth2Providers(data)
        } catch (error) {
            console.error('Failed to load OAuth2 providers:', error)
        }
    }

    const resetForm = () => {
        setCurrentStep('account')
        setStepData({})
        setAccountForm({
            email: '',
            authType: 'password',
            password: '',
            clientId: '',
            accessToken: '',
            refreshToken: '',
            useProxy: false,
            proxyUrl: '',
            proxyUsername: '',
            proxyPassword: '',
            isDomainMail: false,
            domain: '',
            note: '',
            noteFormat: 'markdown',
            oauth2ProviderConfigId: undefined
        })
        setSyncMode('incremental')
        setMaxEmails(1000)
        setIncludeBody(true)
        setEnableAutoSync(true)
        setSyncInterval(300)
    }

    const handleClose = () => {
        resetForm()
        onClose()
    }

    // 步骤1: 创建或更新账户
    const handleCreateAccount = async () => {
        // 如果是自定义IMAP，先创建provider
        let providerId: number | undefined

        if (isCustomProvider) {
            if (!customImapServer || customImapPort <= 0) {
                onError?.('请填写IMAP服务器和端口')
                return
            }
            if (!accountForm.email) {
                onError?.('请输入邮箱地址')
                return
            }

            setLoading(true)
            try {
                // 使用邮箱域名作为provider名称
                const emailDomain = accountForm.email.split('@')[1] || 'custom'
                const providerName = `Custom-${emailDomain}-${Date.now()}`

                const newProvider = await emailAccountService.createProvider({
                    name: providerName,
                    imapServer: customImapServer,
                    imapPort: customImapPort,
                    smtpServer: customSmtpServer || undefined,
                    smtpPort: customSmtpPort || undefined
                })
                providerId = newProvider.id
            } catch (error: any) {
                onError?.(error.message || '创建自定义提供商失败')
                setLoading(false)
                return
            }
        } else {
            if (!selectedProvider || !accountForm.email) {
                onError?.('请完整填写账户信息')
                return
            }
            providerId = selectedProvider.id
        }

        try {
            setLoading(true)

            const payload: any = {
                email_address: accountForm.email,
                mail_provider_id: providerId,
                auth_type: accountForm.authType,
                note: accountForm.note,
                note_format: accountForm.noteFormat
            }

            if (accountForm.authType === 'password') {
                payload.password = accountForm.password
            } else if (accountForm.authType === 'oauth2') {
                payload.custom_settings = {
                    client_id: accountForm.clientId,
                    access_token: accountForm.accessToken,
                    refresh_token: accountForm.refreshToken
                }
            }

            if (accountForm.useProxy) {
                payload.proxy = accountForm.proxyUrl
                if (accountForm.proxyUsername && accountForm.proxyPassword) {
                    try {
                        const url = new URL(accountForm.proxyUrl)
                        url.username = accountForm.proxyUsername
                        url.password = accountForm.proxyPassword
                        payload.proxy = url.toString()
                    } catch (e) {
                        payload.proxy = accountForm.proxyUrl
                    }
                }
            }

            if (accountForm.isDomainMail) {
                payload.is_domain_mail = true
                payload.domain = accountForm.domain
            }

            let account: any
            try {
                // 先尝试创建账户
                account = await emailAccountService.createAccount(payload)
            } catch (createError: any) {
                // 如果创建失败（可能是账户已存在），尝试查找并更新现有账户
                if (createError.message?.includes('already exists') || createError.message?.includes('重复') || createError.message?.includes('duplicate')) {
                    logger.debug('Account exists, attempting to update...')

                    // 获取所有账户，查找匹配的邮箱
                    const existingAccounts = await emailAccountService.getAccounts()
                    const existingAccount = existingAccounts.find(acc => acc.emailAddress === accountForm.email)

                    if (existingAccount) {
                        // 更新现有账户
                        account = await emailAccountService.updateAccount(existingAccount.id, payload)
                        logger.debug('Successfully updated existing account')
                    } else {
                        throw createError
                    }
                } else {
                    throw createError
                }
            }

            setStepData(prev => ({ ...prev, createdAccount: account }))
            setCurrentStep('verify')
        } catch (error: any) {
            onError?.(error.message || '创建账户失败')
        } finally {
            setLoading(false)
        }
    }

    // 步骤2: 验证连接
    const handleVerifyAccount = async () => {
        if (!stepData.createdAccount) return

        try {
            setLoading(true)
            const response = await emailAccountService.batchVerifyAccounts([stepData.createdAccount.id])
            const result = response.results[0]

            setStepData(prev => ({ ...prev, verificationResult: result }))

            if (result.success) {
                setCurrentStep('sync')
            } else {
                onError?.(`验证失败: ${result.error}`)
            }
        } catch (error: any) {
            onError?.(error.message || '验证账户失败')
        } finally {
            setLoading(false)
        }
    }

    // 步骤3: 首次同步
    const handleInitialSync = async () => {
        if (!stepData.createdAccount) return

        try {
            setLoading(true)
            const response = await emailAccountService.syncAccount(stepData.createdAccount.id, {
                sync_mode: syncMode,
                max_emails_per_mailbox: maxEmails,
                include_body: includeBody
            })

            setStepData(prev => ({ ...prev, syncResult: response }))
            setCurrentStep('config')
        } catch (error: any) {
            onError?.(error.message || '首次同步失败')
        } finally {
            setLoading(false)
        }
    }

    // 步骤4: 创建同步配置
    const handleCreateSyncConfig = async () => {
        if (!stepData.createdAccount) return

        try {
            setLoading(true)
            const response = await syncConfigService.createAccountSyncConfig(stepData.createdAccount.id, {
                enable_auto_sync: enableAutoSync,
                sync_interval: syncInterval,
                sync_folders: [] // 使用默认文件夹
            })

            setStepData(prev => ({ ...prev, configResult: response }))
            setCurrentStep('complete')
        } catch (error: any) {
            onError?.(error.message || '创建同步配置失败')
        } finally {
            setLoading(false)
        }
    }

    // 完成整个流程
    const handleComplete = () => {
        onSuccess?.()
        handleClose()
    }

    // OAuth2授权成功回调
    const handleOAuth2Success = async (result: { emailAddress: string; customSettings: any }) => {
        try {
            setShowOAuth2Popup(false)

            // 自动选择Gmail提供商
            const emailDomain = result.emailAddress.split('@')[1].toLowerCase()
            let autoProvider = null

            if (emailDomain === 'gmail.com') {
                autoProvider = providers.find(p => p.type.toLowerCase() === 'gmail')
            } else if (emailDomain === 'outlook.com' || emailDomain === 'hotmail.com' || emailDomain === 'live.com') {
                autoProvider = providers.find(p => p.type.toLowerCase() === 'outlook')
            }

            if (autoProvider) {
                setSelectedProvider(autoProvider)
            }

            // 将OAuth2授权结果回填到表单
            setAccountForm(prev => ({
                ...prev,
                email: result.emailAddress,
                authType: 'oauth2',
                accessToken: result.customSettings?.access_token || '',
                refreshToken: result.customSettings?.refresh_token || '',
                clientId: result.customSettings?.client_id || '',
                oauth2ProviderConfigId: result.customSettings?.oauth2_provider_config_id
            }))
        } catch (error) {
            console.error('Failed to fill OAuth2 data:', error)
            onError?.('OAuth2数据回填失败')
        }
    }

    // OAuth2授权取消回调
    const handleOAuth2Cancel = () => {
        setShowOAuth2Popup(false)
    }

    // OAuth2授权失败回调
    const handleOAuth2Error = (error: string) => {
        setShowOAuth2Popup(false)
        onError?.(error)
    }

    // 获取选中的邮件提供商
    const getSelectedProvider = () => {
        return selectedProvider
    }

    return (
        <>
            <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
                <ModalContent size="xl" className="max-h-[90vh] flex flex-col">
                    <ModalHeader>
                        <ModalTitle>账户设置向导</ModalTitle>
                        <ModalDescription>{steps[currentStepIndex]?.description}</ModalDescription>
                    </ModalHeader>

                    {/* 步骤指示器 */}
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between">
                            {steps.map((step, index) => (
                                <div key={step.key} className="flex items-center">
                                    <div className={cn(
                                        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                                        index < currentStepIndex
                                            ? "bg-green-600 text-white"
                                            : index === currentStepIndex
                                                ? "bg-blue-600 text-white"
                                                : "bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-400"
                                    )}>
                                        {index < currentStepIndex ? (
                                            <Check className="h-4 w-4" />
                                        ) : (
                                            <span>{index + 1}</span>
                                        )}
                                    </div>
                                    <span className={cn(
                                        "ml-2 text-sm font-medium",
                                        index <= currentStepIndex
                                            ? "text-gray-900 dark:text-white"
                                            : "text-gray-500 dark:text-gray-400"
                                    )}>
                                        {step.title}
                                    </span>
                                    {index < steps.length - 1 && (
                                        <ArrowRight className="h-4 w-4 ml-4 text-gray-400" />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <ModalBody>
                        <AnimatePresence mode="wait">
                            {currentStep === 'account' && (
                                <motion.div
                                    key="account"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    {/* 添加账户表单 - 复用现有逻辑 */}
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                邮箱地址
                                            </label>
                                            <input
                                                type="email"
                                                value={accountForm.email}
                                                onChange={(e) => setAccountForm(prev => ({ ...prev, email: e.target.value }))}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                placeholder="your.email@example.com"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                邮件提供商
                                            </label>
                                            <select
                                                value={isCustomProvider ? 'custom' : (selectedProvider?.id || '')}
                                                onChange={(e) => {
                                                    const value = e.target.value
                                                    if (value === 'custom') {
                                                        setIsCustomProvider(true)
                                                        setSelectedProvider(null)
                                                    } else {
                                                        setIsCustomProvider(false)
                                                        const provider = providers.find(p => p.id === parseInt(value))
                                                        setSelectedProvider(provider || null)
                                                    }
                                                }}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            >
                                                <option value="">请选择邮件提供商</option>
                                                {providers.map(provider => (
                                                    <option key={provider.id} value={provider.id}>
                                                        {provider.name}
                                                    </option>
                                                ))}
                                                <option value="custom">🔧 自定义 IMAP 服务器</option>
                                            </select>

                                            {/* 自定义IMAP配置表单 */}
                                            {isCustomProvider && (
                                                <div className="mt-4 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                                                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-200">自定义 IMAP 服务器配置</h4>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div>
                                                            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">IMAP 服务器 *</label>
                                                            <input
                                                                type="text"
                                                                value={customImapServer}
                                                                onChange={(e) => setCustomImapServer(e.target.value)}
                                                                placeholder="如 imap.example.com"
                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                required
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">IMAP 端口 *</label>
                                                            <input
                                                                type="number"
                                                                value={customImapPort}
                                                                onChange={(e) => setCustomImapPort(parseInt(e.target.value) || 993)}
                                                                placeholder="993"
                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                required
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">SMTP 服务器</label>
                                                            <input
                                                                type="text"
                                                                value={customSmtpServer}
                                                                onChange={(e) => setCustomSmtpServer(e.target.value)}
                                                                placeholder="如 smtp.example.com"
                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">SMTP 端口</label>
                                                            <input
                                                                type="number"
                                                                value={customSmtpPort}
                                                                onChange={(e) => setCustomSmtpPort(parseInt(e.target.value) || 587)}
                                                                placeholder="587"
                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                            />
                                                        </div>
                                                    </div>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">提示：端口 993 通常用于 IMAP SSL，端口 587 通常用于 SMTP TLS</p>
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                认证方式
                                            </label>
                                            <div className="flex space-x-4">
                                                <label className="flex items-center">
                                                    <input
                                                        type="radio"
                                                        value="password"
                                                        checked={accountForm.authType === 'password'}
                                                        onChange={(e) => setAccountForm(prev => ({ ...prev, authType: e.target.value as 'password' | 'oauth2' }))}
                                                        className="mr-2"
                                                    />
                                                    密码认证
                                                </label>
                                                <label className="flex items-center">
                                                    <input
                                                        type="radio"
                                                        value="oauth2"
                                                        checked={accountForm.authType === 'oauth2'}
                                                        onChange={(e) => setAccountForm(prev => ({ ...prev, authType: e.target.value as 'password' | 'oauth2' }))}
                                                        className="mr-2"
                                                    />
                                                    OAuth2
                                                </label>
                                            </div>
                                        </div>

                                        {accountForm.authType === 'password' && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                    密码
                                                </label>
                                                <input
                                                    type="password"
                                                    value={accountForm.password}
                                                    onChange={(e) => setAccountForm(prev => ({ ...prev, password: e.target.value }))}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    placeholder="请输入密码"
                                                />
                                            </div>
                                        )}

                                        {accountForm.authType === 'oauth2' && (
                                            <div className="space-y-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowOAuth2Popup(true)}
                                                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                                >
                                                    启动 OAuth2 认证
                                                </button>
                                                {accountForm.accessToken && (
                                                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                                        <div className="flex items-center">
                                                            <CheckCircle className="h-4 w-4 text-green-600 mr-2" />
                                                            <span className="text-sm text-green-800">OAuth2 认证成功</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <AccountNoteEditor
                                            value={accountForm.note}
                                            format={accountForm.noteFormat}
                                            onValueChange={(note) => setAccountForm(prev => ({ ...prev, note }))}
                                            onFormatChange={(noteFormat) => setAccountForm(prev => ({ ...prev, noteFormat }))}
                                        />
                                    </div>
                                </motion.div>
                            )}

                            {currentStep === 'verify' && (
                                <motion.div
                                    key="verify"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <div className="text-center space-y-4">
                                        <div className="flex justify-center">
                                            {loading ? (
                                                <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
                                            ) : stepData.verificationResult?.success ? (
                                                <CheckCircle className="h-12 w-12 text-green-600" />
                                            ) : (
                                                <AlertCircle className="h-12 w-12 text-yellow-600" />
                                            )}
                                        </div>
                                        <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                                            {loading ? '正在验证账户连接...' : stepData.verificationResult?.success ? '连接验证成功' : '准备验证连接'}
                                        </h4>
                                        <p className="text-gray-500 dark:text-gray-400">
                                            {loading ? '请稍等，正在测试邮件服务器连接' :
                                                stepData.verificationResult?.success ? '账户连接正常，可以进行邮件同步' :
                                                    `将验证账户 ${stepData.createdAccount?.emailAddress} 的连接性`}
                                        </p>
                                        {stepData.verificationResult && !stepData.verificationResult.success && (
                                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                                                <p className="text-sm text-red-800">{stepData.verificationResult.error}</p>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}

                            {currentStep === 'sync' && (
                                <motion.div
                                    key="sync"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <div className="space-y-4">
                                        <h4 className="text-lg font-semibold text-gray-900 dark:text-white">首次邮件同步</h4>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                同步模式
                                            </label>
                                            <div className="space-y-2">
                                                <label className="flex items-center">
                                                    <input
                                                        type="radio"
                                                        value="incremental"
                                                        checked={syncMode === 'incremental'}
                                                        onChange={(e) => setSyncMode(e.target.value as 'incremental' | 'full')}
                                                        className="mr-2"
                                                    />
                                                    <div>
                                                        <div className="font-medium">增量同步（推荐）</div>
                                                        <div className="text-sm text-gray-500">仅同步自上次同步以来的新邮件，速度快，适合日常使用</div>
                                                    </div>
                                                </label>
                                                <label className="flex items-center">
                                                    <input
                                                        type="radio"
                                                        value="full"
                                                        checked={syncMode === 'full'}
                                                        onChange={(e) => setSyncMode(e.target.value as 'incremental' | 'full')}
                                                        className="mr-2"
                                                    />
                                                    <div>
                                                        <div className="font-medium">全量同步</div>
                                                        <div className="text-sm text-gray-500">重新同步所有邮件，适用于首次同步或需要完整更新时</div>
                                                    </div>
                                                </label>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                每个文件夹最大邮件数量
                                            </label>
                                            <input
                                                type="number"
                                                value={maxEmails}
                                                onChange={(e) => setMaxEmails(parseInt(e.target.value) || 1000)}
                                                min="100"
                                                max="10000"
                                                step="100"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            />
                                        </div>

                                        <div>
                                            <label className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    checked={includeBody}
                                                    onChange={(e) => setIncludeBody(e.target.checked)}
                                                    className="mr-2"
                                                />
                                                同步邮件正文内容
                                            </label>
                                        </div>

                                        {loading && (
                                            <div className="text-center py-4">
                                                <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                                                <p className="text-sm text-gray-500 mt-2">正在同步邮件，请稍等...</p>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}

                            {currentStep === 'config' && (
                                <motion.div
                                    key="config"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <div className="space-y-4">
                                        <h4 className="text-lg font-semibold text-gray-900 dark:text-white">配置自动同步</h4>

                                        <div>
                                            <label className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    checked={enableAutoSync}
                                                    onChange={(e) => setEnableAutoSync(e.target.checked)}
                                                    className="mr-2"
                                                />
                                                <div>
                                                    <div className="font-medium">启用自动同步</div>
                                                    <div className="text-sm text-gray-500">开启后将按照设定的间隔自动同步邮件</div>
                                                </div>
                                            </label>
                                        </div>

                                        {enableAutoSync && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                    同步间隔（秒）
                                                </label>
                                                <select
                                                    value={syncInterval}
                                                    onChange={(e) => setSyncInterval(parseInt(e.target.value))}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                >
                                                    <option value={1}>1秒</option>
                                                    <option value={3}>3秒</option>
                                                    <option value={5}>5秒</option>
                                                    <option value={10}>10秒</option>
                                                    <option value={15}>15秒</option>
                                                    <option value={20}>20秒</option>
                                                    <option value={30}>30秒</option>
                                                    <option value={60}>1分钟</option>
                                                    <option value={300}>5分钟</option>
                                                    <option value={600}>10分钟</option>
                                                    <option value={900}>15分钟</option>
                                                    <option value={1800}>30分钟</option>
                                                    <option value={3600}>1小时</option>
                                                </select>
                                            </div>
                                        )}

                                        {loading && (
                                            <div className="text-center py-4">
                                                <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                                                <p className="text-sm text-gray-500 mt-2">正在创建同步配置...</p>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}

                            {currentStep === 'complete' && (
                                <motion.div
                                    key="complete"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <div className="text-center space-y-4">
                                        <div className="flex justify-center">
                                            <CheckCircle className="h-16 w-16 text-green-600" />
                                        </div>
                                        <h4 className="text-xl font-semibold text-gray-900 dark:text-white">
                                            账户设置完成！
                                        </h4>
                                        <p className="text-gray-500 dark:text-gray-400">
                                            账户 {stepData.createdAccount?.emailAddress} 已成功添加并配置完成
                                        </p>
                                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                                            <div className="flex items-center justify-between text-sm">
                                                <span>账户验证：</span>
                                                <CheckCircle className="h-4 w-4 text-green-600" />
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span>邮件同步：</span>
                                                <CheckCircle className="h-4 w-4 text-green-600" />
                                            </div>
                                            <div className="flex items-center justify-between text-sm">
                                                <span>自动同步配置：</span>
                                                <CheckCircle className="h-4 w-4 text-green-600" />
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </ModalBody>

                    <ModalFooter className="justify-between">
                        <Button
                            variant="outline"
                            onClick={currentStep === 'account' ? handleClose : () => {
                                const currentIndex = steps.findIndex(step => step.key === currentStep)
                                if (currentIndex > 0) {
                                    setCurrentStep(steps[currentIndex - 1].key as WorkflowStep)
                                }
                            }}
                            disabled={loading}
                        >
                            {currentStep === 'account' ? '取消' : '上一步'}
                        </Button>

                        <div className="flex space-x-3">
                            {currentStep === 'account' && (
                                <Button
                                    onClick={handleCreateAccount}
                                    disabled={loading || !selectedProvider || !accountForm.email || (accountForm.authType === 'password' && !accountForm.password) || (accountForm.authType === 'oauth2' && !accountForm.accessToken)}
                                >
                                    {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                    {loading ? '创建中...' : '创建账户'}
                                </Button>
                            )}

                            {currentStep === 'verify' && (
                                <Button onClick={handleVerifyAccount} disabled={loading}>
                                    {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                    {loading ? '验证中...' : '验证连接'}
                                </Button>
                            )}

                            {currentStep === 'sync' && (
                                <Button onClick={handleInitialSync} disabled={loading}>
                                    {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                    <Clock className="h-4 w-4 mr-2" />
                                    {loading ? '同步中...' : '开始同步'}
                                </Button>
                            )}

                            {currentStep === 'config' && (
                                <Button onClick={handleCreateSyncConfig} disabled={loading}>
                                    {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                                    <Settings className="h-4 w-4 mr-2" />
                                    {loading ? '配置中...' : '创建配置'}
                                </Button>
                            )}

                            {currentStep === 'complete' && (
                                <Button onClick={handleComplete} className="bg-green-600 hover:bg-green-700">
                                    <CheckCircle className="h-4 w-4 mr-2" />
                                    完成
                                </Button>
                            )}
                        </div>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            {/* OAuth2 Popup 授权组件 */}
            {showOAuth2Popup && selectedProvider && (
                <OAuth2PopupAuth
                    provider={getSelectedProvider()?.type.toLowerCase() as any}
                    configId={accountForm.oauth2ProviderConfigId}
                    onSuccess={handleOAuth2Success}
                    onCancel={handleOAuth2Cancel}
                    onError={handleOAuth2Error}
                />
            )}
        </>
    )
}
