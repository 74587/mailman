'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Check, AlertCircle, Loader2, ArrowRight, CheckCircle, Clock, Settings, Globe2, StickyNote, Network, Mail, Forward } from 'lucide-react'
import { emailAccountService } from '@/services/email-account.service'
import { oauth2Service } from '@/services/oauth2.service'
import { syncConfigService } from '@/services/sync-config.service'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { AccountNoteFormat, EmailAccount, OAuth2GlobalConfig, ProxyAccountMode, ProxyFallbackMode, ProxyTagFilterMode, ProxyType } from '@/types'
import OAuth2PopupAuth from '@/components/oauth2/oauth2-popup-auth'
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
    forwardedAddresses: string
    note: string
    noteFormat: AccountNoteFormat
    oauth2ProviderConfigId?: number
}

// 工作流程步骤
type WorkflowStep = 'account' | 'advanced' | 'verify' | 'sync' | 'config' | 'complete'
type AddAccountSection = 'identity' | 'domain' | 'forwarding' | 'note' | 'proxy'

interface AddSectionItem {
    key: AddAccountSection
    title: string
    description: string
    meta: string
    icon: typeof Mail
}

interface StepData {
    createdAccount?: EmailAccount
    verificationResult?: any
    syncResult?: any
    configResult?: any
}

const parseRoutingAddressLines = (value: string): string[] => {
    return value
        .split(/[\n,;]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .filter((item, index, array) => array.indexOf(item) === index)
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
    const [activeAccountSection, setActiveAccountSection] = useState<AddAccountSection>('identity')
    const [stepData, setStepData] = useState<StepData>({})
    const [loading, setLoading] = useState(false)
    const bodyShellRef = useRef<HTMLDivElement>(null)
    const bodyScrollRef = useRef<HTMLDivElement>(null)

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
        ...defaultProxyConfigValue(),
        isDomainMail: false,
        domain: '',
        forwardedAddresses: '',
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
    const [oauth2Providers, setOAuth2Providers] = useState<OAuth2GlobalConfig[]>([])
    const autoTriggeredOAuth2Ref = useRef(false)

    // 自定义IMAP服务器配置
    const [isCustomProvider, setIsCustomProvider] = useState(false)
    const [customImapServer, setCustomImapServer] = useState('')
    const [customImapPort, setCustomImapPort] = useState(993)
    const [customSmtpServer, setCustomSmtpServer] = useState('')
    const [customSmtpPort, setCustomSmtpPort] = useState(587)

    // 工作流程步骤配置
    const steps = [
        { key: 'account', title: '账户认证', description: '配置邮箱、提供商和认证信息' },
        { key: 'advanced', title: '高级设置', description: '配置域名邮箱、转发收件、备注和代理策略' },
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

    useEffect(() => {
        const timer = window.setTimeout(() => {
            bodyShellRef.current?.scrollTo({ top: 0 })
            bodyScrollRef.current?.scrollTo({ top: 0 })
        }, 0)
        return () => window.clearTimeout(timer)
    }, [currentStep])

    const selectedProviderType = selectedProvider?.type?.toLowerCase()
    const availableOAuth2Providers = useMemo(
        () => oauth2Providers
            .filter(config => config.provider_type === selectedProviderType && config.is_enabled)
            .sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default) || a.name.localeCompare(b.name)),
        [oauth2Providers, selectedProviderType]
    )

    useEffect(() => {
        if (accountForm.authType !== 'oauth2' || availableOAuth2Providers.length === 0) {
            return
        }

        const currentConfigStillAvailable = availableOAuth2Providers.some(config => config.id === accountForm.oauth2ProviderConfigId)
        if (!currentConfigStillAvailable) {
            const preferredConfig = availableOAuth2Providers.find(config => config.is_default) || availableOAuth2Providers[0]
            setAccountForm(prev => ({
                ...prev,
                oauth2ProviderConfigId: preferredConfig.id,
            }))
        }
    }, [accountForm.authType, accountForm.oauth2ProviderConfigId, availableOAuth2Providers])

    useEffect(() => {
        if (!isOpen) {
            autoTriggeredOAuth2Ref.current = false
        }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen || !autoTriggerOAuth2 || autoTriggeredOAuth2Ref.current) {
            return
        }
        if (accountForm.authType !== 'oauth2' || !selectedProviderType) {
            return
        }
        if (selectedProviderType !== 'gmail' && selectedProviderType !== 'outlook') {
            return
        }
        if (availableOAuth2Providers.length === 0 || !accountForm.oauth2ProviderConfigId) {
            return
        }

        autoTriggeredOAuth2Ref.current = true
        const timer = window.setTimeout(() => setShowOAuth2Popup(true), 200)
        return () => window.clearTimeout(timer)
    }, [
        accountForm.authType,
        accountForm.oauth2ProviderConfigId,
        autoTriggerOAuth2,
        availableOAuth2Providers.length,
        isOpen,
        selectedProviderType,
    ])

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
        setActiveAccountSection('identity')
        setStepData({})
        autoTriggeredOAuth2Ref.current = false
        setAccountForm({
            email: '',
            authType: 'password',
            password: '',
            clientId: '',
            accessToken: '',
            refreshToken: '',
            ...defaultProxyConfigValue(),
            isDomainMail: false,
            domain: '',
            forwardedAddresses: '',
            note: '',
            noteFormat: 'markdown',
            oauth2ProviderConfigId: undefined
        })
        setSyncMode('incremental')
        setMaxEmails(1000)
        setIncludeBody(true)
        setEnableAutoSync(true)
        setSyncInterval(300)
        setShowOAuth2Popup(false)
        setIsCustomProvider(false)
        setSelectedProvider(null)
        setCustomImapServer('')
        setCustomImapPort(993)
        setCustomSmtpServer('')
        setCustomSmtpPort(587)
    }

    const handleClose = () => {
        resetForm()
        onClose()
    }

    // 步骤1: 创建或更新账户
    const handleCreateAccount = async () => {
        if (!accountForm.email) {
            onError?.('请输入邮箱地址')
            return
        }
        if (accountForm.authType === 'password' && !accountForm.password) {
            onError?.('请输入密码')
            return
        }
        if (accountForm.authType === 'oauth2' && !accountForm.accessToken) {
            onError?.('请先完成 OAuth2 认证')
            return
        }
        if (accountForm.isDomainMail && !accountForm.domain.trim()) {
            onError?.('请填写域名')
            return
        }

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
                forwarded_addresses: parseRoutingAddressLines(accountForm.forwardedAddresses),
                note: accountForm.note,
                note_format: accountForm.noteFormat
            }

            if (accountForm.authType === 'password') {
                payload.password = accountForm.password
            } else if (accountForm.authType === 'oauth2') {
                payload.oauth2_provider_id = accountForm.oauth2ProviderConfigId
                payload.custom_settings = {
                    client_id: accountForm.clientId,
                    access_token: accountForm.accessToken,
                    refresh_token: accountForm.refreshToken,
                    oauth2_provider_config_id: accountForm.oauth2ProviderConfigId ? String(accountForm.oauth2ProviderConfigId) : undefined
                }
            }

            if (accountForm.useProxy) {
                payload.proxy_mode = accountForm.proxyMode
                payload.proxy_fallback_mode = accountForm.proxyFallbackMode
                payload.proxy_fallback_proxy_id = accountForm.proxyFallbackProxyId
                payload.proxy_fallback_proxy = accountForm.proxyFallbackProxy
                payload.proxy_match_group_ids = accountForm.proxyMatchGroupIds
                payload.proxy_match_tag_ids = accountForm.proxyMatchTagIds
                payload.proxy_match_tag_mode = accountForm.proxyMatchTagMode

                if (accountForm.proxyMode === 'manual') {
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
                } else if (accountForm.proxyMode === 'selected') {
                    payload.proxy_id = accountForm.proxyId
                }
            } else {
                payload.proxy = ''
                payload.proxy_mode = 'manual'
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

            const providerConfigId = Number(result.customSettings?.oauth2_provider_config_id)

            // 将OAuth2授权结果回填到表单
            setAccountForm(prev => ({
                ...prev,
                email: result.emailAddress,
                authType: 'oauth2',
                accessToken: result.customSettings?.access_token || '',
                refreshToken: result.customSettings?.refresh_token || '',
                clientId: result.customSettings?.client_id || '',
                oauth2ProviderConfigId: Number.isFinite(providerConfigId) && providerConfigId > 0
                    ? providerConfigId
                    : prev.oauth2ProviderConfigId
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

    const hasProvider = isCustomProvider
        ? Boolean(customImapServer.trim()) && customImapPort > 0
        : Boolean(selectedProvider)
    const hasCredential = accountForm.authType === 'password'
        ? Boolean(accountForm.password)
        : Boolean(accountForm.accessToken)
    const canContinueAccount = Boolean(accountForm.email) && hasProvider && hasCredential
    const canCreateAccount = canContinueAccount && (!accountForm.isDomainMail || Boolean(accountForm.domain.trim()))
    const addSections: AddSectionItem[] = [
        {
            key: 'identity',
            title: '账户认证',
            description: '邮箱、提供商和登录凭据',
            meta: accountForm.authType === 'oauth2'
                ? (accountForm.accessToken ? 'OAuth2 已授权' : 'OAuth2')
                : (accountForm.password ? '密码已填写' : '密码'),
            icon: Mail,
        },
        {
            key: 'domain',
            title: '域名邮箱',
            description: '域名收件身份配置',
            meta: accountForm.isDomainMail ? (accountForm.domain || '已启用') : '未启用',
            icon: Globe2,
        },
        {
            key: 'forwarding',
            title: '转发收件',
            description: '原始收件地址映射',
            meta: parseRoutingAddressLines(accountForm.forwardedAddresses).length > 0
                ? `${parseRoutingAddressLines(accountForm.forwardedAddresses).length} 个地址`
                : '未配置',
            icon: Forward,
        },
        {
            key: 'note',
            title: '账户备注',
            description: 'Markdown / HTML / JS 内容',
            meta: accountForm.note.trim() ? '已填写' : '未填写',
            icon: StickyNote,
        },
        {
            key: 'proxy',
            title: '代理策略',
            description: '手动、选择或自动匹配代理',
            meta: accountForm.useProxy ? '已启用' : '未启用',
            icon: Network,
        },
    ]

    const navigateWizardStep = (step: WorkflowStep, section?: AddAccountSection) => {
        setCurrentStep(step)

        if (step === 'account') {
            setActiveAccountSection('identity')
            return
        }

        if (step === 'advanced') {
            setActiveAccountSection(section || (activeAccountSection === 'identity' ? 'domain' : activeAccountSection))
        }
    }

    const handleAddSectionClick = (section: AddAccountSection) => {
        setActiveAccountSection(section)
        setCurrentStep(section === 'identity' ? 'account' : 'advanced')
    }

    const isWizardStepComplete = (stepKey: WorkflowStep) => {
        if (stepKey === 'account') {
            return canContinueAccount
        }
        if (stepKey === 'advanced') {
            return Boolean(stepData.createdAccount) || canCreateAccount
        }
        return true
    }

    return (
        <>
            <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
                <ModalContent size="full" className="h-[88vh] max-w-[1180px] overflow-hidden">
                    <ModalHeader>
                        <ModalTitle>账户设置向导</ModalTitle>
                        <ModalDescription>{steps[currentStepIndex]?.description}</ModalDescription>
                    </ModalHeader>

                    {/* 步骤指示器 */}
                    <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-700">
                        <div className="overflow-x-auto pb-1">
                            <div className="flex min-w-max items-center gap-3">
                                {steps.map((step, index) => {
                                    const isCompleted = index < currentStepIndex && isWizardStepComplete(step.key as WorkflowStep)
                                    const isActive = index === currentStepIndex

                                    return (
                                    <div key={step.key} className="flex shrink-0 items-center">
                                        <div className={cn(
                                            "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                                            isCompleted
                                                ? "bg-green-600 text-white"
                                                : isActive
                                                    ? "bg-blue-600 text-white"
                                                    : "bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-400"
                                        )}
                                        >
                                            {isCompleted ? (
                                                <Check className="h-4 w-4" />
                                            ) : (
                                                <span>{index + 1}</span>
                                            )}
                                        </div>
                                        <span className={cn(
                                            "ml-2 text-sm font-medium",
                                            isCompleted || isActive
                                                ? "text-gray-900 dark:text-white"
                                                : "text-gray-500 dark:text-gray-400"
                                        )}>
                                            {step.title}
                                        </span>
                                        {index < steps.length - 1 && (
                                            <ArrowRight className="ml-3 h-4 w-4 text-gray-400" />
                                        )}
                                    </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>

                    <ModalBody ref={bodyShellRef} className="min-h-0 overflow-hidden p-0">
                        <div
                            key={currentStep}
                            ref={bodyScrollRef}
                            className={cn(
                                'h-full overflow-y-auto',
                                currentStep === 'account' || currentStep === 'advanced' ? 'p-0' : 'p-6'
                            )}
                        >
                        <AnimatePresence mode="wait">
                            {(currentStep === 'account' || currentStep === 'advanced') && (
                                <motion.div
                                    key="account-settings"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                    className="h-full"
                                >
                                    <div className="grid h-full min-h-[560px] grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[290px_minmax(0,1fr)] lg:grid-rows-1">
                                        <aside className="border-b border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/40 lg:border-b-0 lg:border-r">
                                            <div className="mb-4 hidden rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200 lg:block">
                                                <div className="font-medium">{accountForm.email || '新建邮箱账户'}</div>
                                                <div className="mt-1 text-xs opacity-80">
                                                    {isCustomProvider ? '自定义 IMAP' : selectedProvider?.name || '待选择提供商'}
                                                </div>
                                            </div>
                                            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
                                                {addSections.map((section) => {
                                                    const Icon = section.icon
                                                    const isActive = activeAccountSection === section.key
                                                    return (
                                                        <button
                                                            key={section.key}
                                                            type="button"
                                                            onClick={() => handleAddSectionClick(section.key)}
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

                                        <div className="min-h-0 overflow-y-auto p-6">
                                            <AnimatePresence mode="wait">
                                                {activeAccountSection === 'identity' && (
                                                    <motion.div
                                                        key="identity"
                                                        initial={{ opacity: 0, x: 18 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        exit={{ opacity: 0, x: -18 }}
                                                        transition={{ duration: 0.18 }}
                                                        className="space-y-5"
                                                    >
                                                        <AddPanelHeader
                                                            icon={<Mail className="h-5 w-5" />}
                                                            title="账户认证"
                                                            description="填写登录邮箱、提供商和认证方式。域名邮箱、备注和代理可以从左侧直接配置。"
                                                        />

                                                        <div className="grid gap-4 xl:grid-cols-2">
                                                            <div className="space-y-2">
                                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">邮箱地址</label>
                                                                <input
                                                                    type="email"
                                                                    value={accountForm.email}
                                                                    onChange={(e) => setAccountForm(prev => ({ ...prev, email: e.target.value }))}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                                    placeholder="your.email@example.com"
                                                                />
                                                            </div>

                                                            <div className="space-y-2">
                                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">邮件提供商</label>
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
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                                >
                                                                    <option value="">请选择邮件提供商</option>
                                                                    {providers.map(provider => (
                                                                        <option key={provider.id} value={provider.id}>
                                                                            {provider.name}
                                                                        </option>
                                                                    ))}
                                                                    <option value="custom">自定义 IMAP 服务器</option>
                                                                </select>
                                                            </div>
                                                        </div>

                                                        {isCustomProvider && (
                                                            <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
                                                                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-200">自定义 IMAP 服务器配置</h4>
                                                                <div className="grid gap-3 md:grid-cols-2">
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

                                                        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
                                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">认证方式</label>
                                                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setAccountForm(prev => ({ ...prev, authType: 'password' }))}
                                                                    className={cn(
                                                                        'rounded-lg border px-4 py-3 text-left transition-colors',
                                                                        accountForm.authType === 'password'
                                                                            ? 'border-primary-500 bg-primary-50 text-primary-900 dark:bg-primary-950/40 dark:text-primary-100'
                                                                            : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300'
                                                                    )}
                                                                >
                                                                    <div className="text-sm font-medium">密码认证</div>
                                                                    <div className="mt-1 text-xs opacity-70">普通密码或应用专用密码</div>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setAccountForm(prev => ({ ...prev, authType: 'oauth2' }))}
                                                                    className={cn(
                                                                        'rounded-lg border px-4 py-3 text-left transition-colors',
                                                                        accountForm.authType === 'oauth2'
                                                                            ? 'border-primary-500 bg-primary-50 text-primary-900 dark:bg-primary-950/40 dark:text-primary-100'
                                                                            : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300'
                                                                    )}
                                                                >
                                                                    <div className="text-sm font-medium">OAuth2</div>
                                                                    <div className="mt-1 text-xs opacity-70">使用授权窗口完成登录</div>
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {accountForm.authType === 'password' && (
                                                            <div className="space-y-2">
                                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">密码</label>
                                                                <input
                                                                    type="password"
                                                                    value={accountForm.password}
                                                                    onChange={(e) => setAccountForm(prev => ({ ...prev, password: e.target.value }))}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                                    placeholder="请输入密码"
                                                                />
                                                            </div>
                                                        )}

                                                        {accountForm.authType === 'oauth2' && (
                                                            <div className="space-y-4">
                                                                {(selectedProviderType === 'gmail' || selectedProviderType === 'outlook') && (
                                                                    <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <label className="text-sm font-medium text-blue-950 dark:text-blue-100">OAuth2 配置</label>
                                                                            <span className="text-xs text-blue-600 dark:text-blue-300">
                                                                                {availableOAuth2Providers.length > 1 ? `共 ${availableOAuth2Providers.length} 套` : '默认配置'}
                                                                            </span>
                                                                        </div>
                                                                        {availableOAuth2Providers.length > 0 ? (
                                                                            <select
                                                                                value={accountForm.oauth2ProviderConfigId || ''}
                                                                                onChange={(event) => setAccountForm(prev => ({
                                                                                    ...prev,
                                                                                    oauth2ProviderConfigId: event.target.value ? Number(event.target.value) : undefined,
                                                                                }))}
                                                                                className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-blue-800 dark:bg-gray-900 dark:text-white"
                                                                            >
	                                                                                {availableOAuth2Providers.map(config => (
	                                                                                    <option key={config.id} value={config.id}>
	                                                                                        {config.is_default ? '默认 · ' : ''}{config.name} · {config.client_id ? `${config.client_id.slice(0, 10)}...` : '未填写 Client ID'}
	                                                                                    </option>
	                                                                                ))}
                                                                            </select>
                                                                        ) : (
                                                                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                                                                                暂无可用 OAuth2 配置，请先在 OAuth2 配置页面添加并启用配置。
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setShowOAuth2Popup(true)}
                                                                    disabled={(selectedProviderType === 'gmail' || selectedProviderType === 'outlook') && availableOAuth2Providers.length === 0}
                                                                    className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-400"
                                                                >
                                                                    启动 OAuth2 认证
                                                                </button>
                                                                {accountForm.accessToken && (
                                                                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                                                                        <div className="flex items-center">
                                                                            <CheckCircle className="mr-2 h-4 w-4 text-green-600" />
                                                                            <span className="text-sm text-green-800">OAuth2 认证成功</span>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </motion.div>
                                                )}

                                                {activeAccountSection === 'domain' && (
                                                    <motion.div
                                                        key="domain"
                                                        initial={{ opacity: 0, x: 18 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        exit={{ opacity: 0, x: -18 }}
                                                        transition={{ duration: 0.18 }}
                                                        className="space-y-5"
                                                    >
                                                        <AddPanelHeader
                                                            icon={<Globe2 className="h-5 w-5" />}
                                                            title="域名邮箱"
                                                            description="用于搜索和识别发送到域名邮箱或别名邮箱的邮件。"
                                                        />
                                                        <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/40">
                                                            <label className="flex items-start gap-3">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={accountForm.isDomainMail}
                                                                    onChange={(event) => setAccountForm(prev => ({ ...prev, isDomainMail: event.target.checked }))}
                                                                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                                />
                                                                <span>
                                                                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">启用域名邮箱</span>
                                                                    <span className="mt-1 block text-sm text-gray-500 dark:text-gray-400">开启后会保存该账户对应的域名，便于搜索、匹配和取件场景识别。</span>
                                                                </span>
                                                            </label>
                                                            <AnimatePresence>
                                                                {accountForm.isDomainMail && (
                                                                    <motion.div
                                                                        initial={{ height: 0, opacity: 0 }}
                                                                        animate={{ height: 'auto', opacity: 1 }}
                                                                        exit={{ height: 0, opacity: 0 }}
                                                                        transition={{ duration: 0.24 }}
                                                                        className="overflow-hidden"
                                                                    >
                                                                        <div className="mt-5 max-w-xl">
                                                                            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">域名</label>
                                                                            <input
                                                                                value={accountForm.domain}
                                                                                onChange={(event) => setAccountForm(prev => ({ ...prev, domain: event.target.value }))}
                                                                                placeholder="example.com"
                                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                                            />
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </section>
                                                    </motion.div>
                                                )}

                                                {activeAccountSection === 'forwarding' && (
                                                    <motion.div
                                                        key="forwarding"
                                                        initial={{ opacity: 0, x: 18 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        exit={{ opacity: 0, x: -18 }}
                                                        transition={{ duration: 0.18 }}
                                                        className="space-y-5"
                                                    >
                                                        <AddPanelHeader
                                                            icon={<Forward className="h-5 w-5" />}
                                                            title="转发收件"
                                                            description="把会转发到此账户的原始邮箱写在这里。"
                                                        />
                                                        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                                                            <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/40">
                                                                <div className="space-y-2">
                                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">原始收件地址</label>
                                                                    <textarea
                                                                        value={accountForm.forwardedAddresses}
                                                                        onChange={(event) => setAccountForm(prev => ({ ...prev, forwardedAddresses: event.target.value }))}
                                                                        rows={12}
                                                                        placeholder={"one@example.com\norders@example.net\n*@campaign.example"}
                                                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                                    />
                                                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                                                        一行一个，也支持逗号或分号分隔。取件时传入这些地址，系统会自动落到当前账户。
                                                                    </p>
                                                                </div>
                                                            </section>
                                                            <aside className="rounded-xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
                                                                <div className="font-semibold">示例</div>
                                                                <div className="mt-3 space-y-3 text-blue-800/90 dark:text-blue-100/80">
                                                                    <p>server-one@example.com 转发到账户 A，就把 server-one@example.com 填到账户 A。</p>
                                                                    <p>也可以填 *@project.example 代表同域名下的转发地址。</p>
                                                                </div>
                                                                <div className="mt-5 rounded-lg bg-white/70 p-3 font-mono text-xs text-blue-950 dark:bg-blue-950/50 dark:text-blue-50">
                                                                    to_query = server-one@example.com
                                                                </div>
                                                            </aside>
                                                        </div>
                                                    </motion.div>
                                                )}

                                                {activeAccountSection === 'note' && (
                                                    <motion.div
                                                        key="note"
                                                        initial={{ opacity: 0, x: 18 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        exit={{ opacity: 0, x: -18 }}
                                                        transition={{ duration: 0.18 }}
                                                        className="space-y-5"
                                                    >
                                                        <AddPanelHeader
                                                            icon={<StickyNote className="h-5 w-5" />}
                                                            title="账户备注"
                                                            description="记录账号用途、风控信息或可交互 HTML/JS 内容。"
                                                        />
                                                        <AccountNoteEditor
                                                            value={accountForm.note}
                                                            format={accountForm.noteFormat}
                                                            onValueChange={(note) => setAccountForm(prev => ({ ...prev, note }))}
                                                            onFormatChange={(noteFormat) => setAccountForm(prev => ({ ...prev, noteFormat }))}
                                                            className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/40"
                                                        />
                                                    </motion.div>
                                                )}

                                                {activeAccountSection === 'proxy' && (
                                                    <motion.div
                                                        key="proxy"
                                                        initial={{ opacity: 0, x: 18 }}
                                                        animate={{ opacity: 1, x: 0 }}
                                                        exit={{ opacity: 0, x: -18 }}
                                                        transition={{ duration: 0.18 }}
                                                        className="space-y-5"
                                                    >
                                                        <AddPanelHeader
                                                            icon={<Network className="h-5 w-5" />}
                                                            title="代理策略"
                                                            description="为这个邮箱账户配置固定代理、代理池匹配和不可用时的兜底策略。"
                                                        />
                                                        <ProxyConfigSection
                                                            value={accountForm}
                                                            onChange={(proxyConfig) => setAccountForm(prev => ({ ...prev, ...proxyConfig }))}
                                                        />
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
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
                        </div>
                    </ModalBody>

                    <ModalFooter className="justify-between">
                        <Button
                            variant="outline"
                            onClick={currentStep === 'account' ? handleClose : () => {
                                const currentIndex = steps.findIndex(step => step.key === currentStep)
                                if (currentIndex > 0) {
                                    navigateWizardStep(steps[currentIndex - 1].key as WorkflowStep)
                                }
                            }}
                            disabled={loading}
                        >
                            {currentStep === 'account' ? '取消' : '上一步'}
                        </Button>

                        <div className="flex space-x-3">
                            {currentStep === 'account' && (
                                <Button
                                    onClick={() => navigateWizardStep('advanced', 'domain')}
                                    disabled={loading || !canContinueAccount}
                                >
                                    下一步
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            )}

                            {currentStep === 'advanced' && (
                                <Button
                                    onClick={handleCreateAccount}
                                    disabled={loading || !canCreateAccount}
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

function AddPanelHeader({
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
