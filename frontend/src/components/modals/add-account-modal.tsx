'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect, useRef } from 'react'
import { Plus, FileText, AlertCircle, Check, Clock } from 'lucide-react'
import { emailAccountService } from '@/services/email-account.service'
import { oauth2Service } from '@/services/oauth2.service'
import { syncConfigService } from '@/services/sync-config.service'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import OAuth2PopupAuth from '@/components/oauth2/oauth2-popup-auth'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalTitle
} from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

interface AddAccountModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
    onError?: (error: string) => void
    presetProvider?: string
    presetAuthType?: string
    autoTriggerOAuth2?: boolean
    presetBatchMode?: boolean
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

interface SingleAccountForm {
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
    oauth2ProviderConfigId?: number
}

interface BatchAccountData {
    email: string
    password: string
    clientId: string
    accessToken: string
    refreshToken: string
    recoveryEmail?: string
    recoveryPassword?: string
    isValid: boolean
    error?: string
}

// 批量导入格式模板
interface BatchFormatTemplate {
    id: string
    name: string
    description: string
    fieldMapping: ('email' | 'password' | 'clientId' | 'accessToken' | 'refreshToken' | 'recoveryEmail' | 'recoveryPassword')[]
    requiredFields: number
}

const BATCH_FORMAT_TEMPLATES: BatchFormatTemplate[] = [
    {
        id: 'standard',
        name: '标准格式',
        description: '邮箱----密码----Client ID----Refresh Token',
        fieldMapping: ['email', 'password', 'clientId', 'refreshToken'],
        requiredFields: 4
    },
    {
        id: 'format_with_recovery',
        name: '完整格式(含辅邮)',
        description: '邮箱----密码----Client ID----令牌----辅邮----辅邮密码',
        fieldMapping: ['email', 'password', 'clientId', 'refreshToken', 'recoveryEmail', 'recoveryPassword'],
        requiredFields: 4
    },
    {
        id: 'oauth2_format',
        name: 'OAuth2格式',
        description: '账号----密码----刷新令牌----Client ID',
        fieldMapping: ['email', 'password', 'refreshToken', 'clientId'],
        requiredFields: 4
    },
    {
        id: 'token_format',
        name: '令牌格式',
        description: '信箱----密碼----Client ID----令牌',
        fieldMapping: ['email', 'password', 'clientId', 'refreshToken'],
        requiredFields: 4
    }
]

// 同步间隔选项
const SYNC_INTERVALS = [
    { value: 30, label: '30秒' },
    { value: 60, label: '1分钟' },
    { value: 300, label: '5分钟' },
    { value: 600, label: '10分钟' },
    { value: 900, label: '15分钟' },
    { value: 1800, label: '30分钟' },
    { value: 3600, label: '1小时' },
]

export default function AddAccountModal({
    isOpen,
    onClose,
    onSuccess,
    onError,
    presetProvider,
    presetAuthType,
    autoTriggerOAuth2,
    presetBatchMode
}: AddAccountModalProps) {
    const [activeTab, setActiveTab] = useState<'single' | 'batch'>('single')
    const [providers, setProviders] = useState<MailProvider[]>([])
    const [selectedProvider, setSelectedProvider] = useState<number | null>(null)
    const [loading, setLoading] = useState(false)
    const [loadingProviders, setLoadingProviders] = useState(true)
    const [isTabTransitioning, setIsTabTransitioning] = useState(false)
    const [gmailOAuth2Available, setGmailOAuth2Available] = useState(false)
    const [outlookOAuth2Available, setOutlookOAuth2Available] = useState(false)
    const [showOAuth2Popup, setShowOAuth2Popup] = useState(false)
    const [oauth2Configs, setOauth2Configs] = useState<any[]>([])
    const [loadingOAuth2Configs, setLoadingOAuth2Configs] = useState(false)

    // 用于动画高度过渡的ref
    const contentRef = useRef<HTMLDivElement>(null)
    const [contentHeight, setContentHeight] = useState<number | 'auto'>('auto')

    // 单独添加表单
    const [singleForm, setSingleForm] = useState<SingleAccountForm>({
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
        oauth2ProviderConfigId: undefined
    })

    // 单独添加的一键解析
    const [singleParseText, setSingleParseText] = useState('')
    const [showSingleParse, setShowSingleParse] = useState(false)
    const [gettingOAuth2Auth, setGettingOAuth2Auth] = useState(false)

    const [batchAuthType] = useState<'token'>('token')
    const [batchSeparator, setBatchSeparator] = useState('----')
    const [batchText, setBatchText] = useState('')
    const [batchAccounts, setBatchAccounts] = useState<BatchAccountData[]>([])
    const [showBatchPreview, setShowBatchPreview] = useState(false)
    const [selectedFormatTemplate, setSelectedFormatTemplate] = useState<string>('standard')

    // 批量添加后的同步配置
    const [enableSyncAfterAdd, setEnableSyncAfterAdd] = useState(true)
    const [syncInterval, setSyncInterval] = useState(300)

    // 自定义IMAP服务器配置
    const [isCustomProvider, setIsCustomProvider] = useState(false)
    const [customImapServer, setCustomImapServer] = useState('')
    const [customImapPort, setCustomImapPort] = useState(993)
    const [customSmtpServer, setCustomSmtpServer] = useState('')
    const [customSmtpPort, setCustomSmtpPort] = useState(587)

    // 处理模态框打开时加载数据
    useEffect(() => {
        if (isOpen) {
            loadProviders()
        }
    }, [isOpen])

    // 处理预设参数
    useEffect(() => {
        if (isOpen && providers.length > 0) {
            applyPresetParams()
        }
    }, [isOpen, providers, presetProvider, presetAuthType])

    // 应用预设参数
    const applyPresetParams = async () => {
        if (presetProvider) {
            const provider = providers.find(p => p.type === presetProvider)
            if (provider) {
                setSelectedProvider(provider.id)
                await loadOAuth2Configs(provider.type)

                // 设置认证类型
                if (presetAuthType) {
                    setSingleForm(prev => ({
                        ...prev,
                        authType: presetAuthType as 'password' | 'oauth2'
                    }))
                }

                // 如果需要自动触发批量模式（仅Outlook支持）
                if (presetBatchMode && provider.type === 'outlook') {
                    setActiveTab('batch')
                }

                // 如果需要自动触发OAuth2
                if (autoTriggerOAuth2 && presetAuthType === 'oauth2') {
                    // 延迟0.2秒后自动触发OAuth2授权
                    setTimeout(() => {
                        handleOAuth2Auth()
                    }, 200)
                }
            }
        }
    }

    // 监听内容高度变化
    useEffect(() => {
        if (contentRef.current) {
            const resizeObserver = new ResizeObserver((entries) => {
                for (let entry of entries) {
                    const { height } = entry.contentRect
                    setContentHeight(height)
                }
            })

            resizeObserver.observe(contentRef.current)

            return () => {
                resizeObserver.disconnect()
            }
        }
    }, [activeTab, showSingleParse, singleForm.authType, singleForm.useProxy, singleForm.isDomainMail, showBatchPreview, loadingProviders])

    const loadProviders = async () => {
        try {
            setLoadingProviders(true)
            const data = await emailAccountService.getProviders()
            setProviders(data)
            // 默认选择第一个提供商
            if (data.length > 0) {
                setSelectedProvider(data[0].id)
                // 加载第一个提供商的OAuth2配置
                await loadOAuth2Configs(data[0].type)
            }

            // 检查OAuth2配置是否已配置
            try {
                const configs = await oauth2Service.getGlobalConfigs()
                const gmailConfig = configs.find(config => config.provider_type === 'gmail')
                const outlookConfig = configs.find(config => config.provider_type === 'outlook')
                setGmailOAuth2Available(!!gmailConfig && gmailConfig.is_enabled)
                setOutlookOAuth2Available(!!outlookConfig && outlookConfig.is_enabled)
            } catch (error) {
                console.error('Failed to check OAuth2 configuration:', error)
                setGmailOAuth2Available(false)
                setOutlookOAuth2Available(false)
            }
        } catch (error) {
            console.error('Failed to load providers:', error)
            onError?.('加载邮件提供商失败')
        } finally {
            setLoadingProviders(false)
        }
    }

    // 加载OAuth2配置
    const loadOAuth2Configs = async (providerType: string) => {
        if (providerType !== 'gmail' && providerType !== 'outlook') {
            setOauth2Configs([])
            return
        }

        try {
            setLoadingOAuth2Configs(true)
            const configs = await oauth2Service.getGlobalConfigsByProvider(providerType as any)
            setOauth2Configs(configs)

            // 如果有配置，默认选择第一个
            if (configs.length > 0) {
                setSingleForm(prev => ({
                    ...prev,
                    oauth2ProviderConfigId: configs[0].id
                }))
            }
        } catch (error) {
            console.error('Failed to load OAuth2 configs:', error)
            setOauth2Configs([])
        } finally {
            setLoadingOAuth2Configs(false)
        }
    }

    // 获取选中的提供商
    const getSelectedProvider = () => {
        return providers.find(p => p.id === selectedProvider)
    }

    // 判断是否支持OAuth2
    const supportsOAuth2 = () => {
        const provider = getSelectedProvider()
        if (provider?.type === 'outlook') {
            return outlookOAuth2Available // Outlook 需要检查系统是否已配置OAuth2
        }
        if (provider?.type === 'gmail') {
            // Gmail 需要检查系统是否已配置OAuth2
            return gmailOAuth2Available
        }
        return false
    }

    // 获取OAuth2授权 - 使用popup方式，支持Gmail和Outlook
    const handleOAuth2Auth = async () => {
        if (!selectedProvider) return

        try {
            setGettingOAuth2Auth(true)

            // 检查是否为支持的提供商
            const provider = getSelectedProvider()
            if (provider?.type !== 'gmail' && provider?.type !== 'outlook') {
                setGettingOAuth2Auth(false)
                return
            }

            // 显示OAuth2 popup授权
            setShowOAuth2Popup(true)
        } catch (err) {
            console.error('OAuth2 authorization error:', err)
            onError?.('启动OAuth2授权失败')
            setGettingOAuth2Auth(false)
        }
    }

    // OAuth2授权成功回调
    const handleOAuth2Success = async (result: { emailAddress: string; customSettings: any }) => {
        try {
            setShowOAuth2Popup(false)
            setGettingOAuth2Auth(false)

            // 将OAuth2授权结果回填到表单
            const newFormData = {
                ...singleForm,
                email: result.emailAddress,
                authType: 'oauth2' as const,
                accessToken: result.customSettings.access_token || '',
                refreshToken: result.customSettings.refresh_token || '',
                clientId: result.customSettings.client_id || ''
            }

            logger.debug('OAuth2授权结果:', result)
            logger.debug('准备回填的表单数据:', newFormData)

            setSingleForm(newFormData)

            // 显示成功提示
            logger.debug('OAuth2授权成功，数据已回填到表单')
        } catch (error) {
            console.error('Failed to fill OAuth2 data:', error)
            onError?.('OAuth2数据回填失败')
        }
    }

    // OAuth2授权取消回调
    const handleOAuth2Cancel = () => {
        setShowOAuth2Popup(false)
        setGettingOAuth2Auth(false)
    }

    // OAuth2授权失败回调
    const handleOAuth2Error = (error: string) => {
        setShowOAuth2Popup(false)
        setGettingOAuth2Auth(false)
        onError?.(error)
    }

    // 解析单个账户文本
    const parseSingleAccountText = () => {
        const parts = singleParseText.trim().split(batchSeparator)
        if (parts.length >= 4) {
            setSingleForm(prev => ({
                ...prev,
                email: parts[0].trim(),
                authType: 'oauth2',
                accessToken: parts[1].trim(),
                clientId: parts[2].trim(),
                refreshToken: parts[3].trim()
            }))
            setShowSingleParse(false)
            setSingleParseText('')
        } else {
            onError?.(`格式错误：需要4个字段，但只有 ${parts.length} 个。格式应为：邮箱${batchSeparator}Access Token${batchSeparator}Client ID${batchSeparator}Refresh Token`)
        }
    }

    // 解析批量文本
    const parseBatchText = () => {
        const lines = batchText.trim().split('\n').filter(line => line.trim())
        const accounts: BatchAccountData[] = []
        const template = BATCH_FORMAT_TEMPLATES.find(t => t.id === selectedFormatTemplate) || BATCH_FORMAT_TEMPLATES[0]

        lines.forEach((line, index) => {
            const parts = line.split(batchSeparator)
            if (parts.length >= template.requiredFields) {
                const accountData: BatchAccountData = {
                    email: '',
                    password: '',
                    clientId: '',
                    accessToken: '',
                    refreshToken: '',
                    isValid: true
                }

                // 根据模板映射字段
                template.fieldMapping.forEach((fieldName, fieldIndex) => {
                    if (fieldIndex < parts.length) {
                        const value = parts[fieldIndex].trim()
                        switch (fieldName) {
                            case 'email':
                                accountData.email = value
                                break
                            case 'password':
                                accountData.password = value
                                break
                            case 'clientId':
                                accountData.clientId = value
                                break
                            case 'accessToken':
                                accountData.accessToken = value
                                break
                            case 'refreshToken':
                                accountData.refreshToken = value
                                break
                            case 'recoveryEmail':
                                accountData.recoveryEmail = value
                                break
                            case 'recoveryPassword':
                                accountData.recoveryPassword = value
                                break
                        }
                    }
                })

                accounts.push(accountData)
            } else {
                accounts.push({
                    email: line,
                    password: '',
                    clientId: '',
                    accessToken: '',
                    refreshToken: '',
                    isValid: false,
                    error: `第 ${index + 1} 行格式错误：需要${template.requiredFields}个字段，但只有 ${parts.length} 个`
                })
            }
        })

        setBatchAccounts(accounts)
        setShowBatchPreview(true)
    }

    // 提交单个账户
    const handleSingleSubmit = async () => {
        // 如果是自定义IMAP，先创建provider
        let providerId = selectedProvider

        if (isCustomProvider) {
            if (!customImapServer || customImapPort <= 0) {
                onError?.('请填写IMAP服务器和端口')
                return
            }

            setLoading(true)
            try {
                // 使用邮箱域名作为provider名称
                const emailDomain = singleForm.email.split('@')[1] || 'custom'
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
        } else if (!selectedProvider) {
            onError?.('请选择邮件提供商')
            return
        }

        setLoading(true)
        try {
            const payload: any = {
                email_address: singleForm.email,
                auth_type: singleForm.authType,
                mail_provider_id: providerId
            }

            // 如果使用OAuth2且有指定的配置ID，则添加到payload中
            if (singleForm.authType === 'oauth2' && singleForm.oauth2ProviderConfigId) {
                payload.oauth2_provider_id = singleForm.oauth2ProviderConfigId
            }

            if (singleForm.authType === 'password') {
                payload.password = singleForm.password
            } else if (singleForm.authType === 'oauth2') {
                // OAuth2 使用 customSettings
                payload.custom_settings = {
                    client_id: singleForm.clientId,
                    access_token: singleForm.accessToken,
                    refresh_token: singleForm.refreshToken
                }
            }

            if (singleForm.useProxy) {
                payload.proxy = singleForm.proxyUrl
                // 如果需要代理认证，可以构建完整的代理URL
                if (singleForm.proxyUsername && singleForm.proxyPassword) {
                    try {
                        const url = new URL(singleForm.proxyUrl)
                        url.username = singleForm.proxyUsername
                        url.password = singleForm.proxyPassword
                        payload.proxy = url.toString()
                    } catch (e) {
                        // 如果URL解析失败，使用原始值
                        payload.proxy = singleForm.proxyUrl
                    }
                }
            }

            if (singleForm.isDomainMail) {
                payload.is_domain_mail = true
                payload.domain = singleForm.domain
            }

            await emailAccountService.createAccount(payload)
            onSuccess?.()
            handleClose()
        } catch (error: any) {
            onError?.(error.message || '添加账户失败')
        } finally {
            setLoading(false)
        }
    }

    // 提交批量账户
    const handleBatchSubmit = async () => {
        if (!selectedProvider) {
            onError?.('请选择邮件提供商')
            return
        }

        const validAccounts = batchAccounts.filter(acc => acc.isValid)
        if (validAccounts.length === 0) {
            onError?.('没有有效的账户数据')
            return
        }

        setLoading(true)
        let successCount = 0
        let failCount = 0
        const successfulAccountIds: number[] = []

        try {
            for (const account of validAccounts) {
                try {
                    const customSettings: Record<string, string> = {
                        client_id: account.clientId,
                        refresh_token: account.refreshToken
                    }

                    // 如果有 accessToken 则使用，否则使用 password 作为 access_token
                    if (account.accessToken) {
                        customSettings.access_token = account.accessToken
                    } else if (account.password) {
                        customSettings.access_token = account.password
                    }

                    // 如果有辅邮信息，存储到 custom_settings
                    if (account.recoveryEmail) {
                        customSettings.recovery_email = account.recoveryEmail
                    }
                    if (account.recoveryPassword) {
                        customSettings.recovery_password = account.recoveryPassword
                    }

                    const payload: any = {
                        email_address: account.email,
                        auth_type: 'oauth2',
                        mail_provider_id: selectedProvider,
                        custom_settings: customSettings
                    }

                    const result = await emailAccountService.createAccount(payload)
                    successfulAccountIds.push(result.id)
                    successCount++
                } catch (error) {
                    failCount++
                    console.error(`Failed to add account ${account.email}:`, error)
                }
            }

            // 批量配置同步（如果启用）
            if (enableSyncAfterAdd && successfulAccountIds.length > 0) {
                try {
                    await syncConfigService.batchCreateOrUpdateAccountSyncConfig(
                        successfulAccountIds,
                        {
                            enable_auto_sync: true,
                            sync_interval: syncInterval
                        }
                    )
                    logger.debug(`成功为 ${successfulAccountIds.length} 个账户配置同步`)
                } catch (syncError) {
                    console.error('批量配置同步失败:', syncError)
                    // 同步配置失败不影响账户创建的结果
                }
            }

            if (successCount > 0) {
                onSuccess?.()
            }

            if (failCount > 0) {
                const syncMsg = enableSyncAfterAdd ? '（已配置自动同步）' : ''
                onError?.(`成功添加 ${successCount} 个账户，失败 ${failCount} 个${syncMsg}`)
            } else {
                handleClose()
            }
        } catch (error: any) {
            onError?.(error.message || '批量添加失败')
        } finally {
            setLoading(false)
        }
    }

    const handleClose = () => {
        // 重置表单
        setSingleForm({
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
            oauth2ProviderConfigId: undefined
        })
        setBatchText('')
        setBatchAccounts([])
        setShowBatchPreview(false)
        setSingleParseText('')
        setShowSingleParse(false)
        setActiveTab('single')
        onClose()
    }

    return (
        <>
            <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
                <ModalContent size="xl" className="flex flex-col max-h-[90vh]">
                    <ModalHeader>
                        <ModalTitle>添加邮箱账户</ModalTitle>
                    </ModalHeader>

                    <ModalBody>
                        <div
                            className="transition-all duration-300 ease-in-out"
                            style={{
                                height: contentHeight === 'auto' ? 'auto' : `${contentHeight}px`
                            }}
                        >
                            <div ref={contentRef} className="flex flex-col">
                                {/* Provider 选择器 */}
                                <div className="border-b border-gray-200 p-6 dark:border-gray-700">
                                    <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                        邮件提供商
                                    </label>
                                    {loadingProviders ? (
                                        <div className="flex items-center space-x-2 text-gray-500">
                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent"></div>
                                            <span>加载中...</span>
                                        </div>
                                    ) : (
                                        <select
                                            value={isCustomProvider ? 'custom' : (selectedProvider || '')}
                                            onChange={async (e) => {
                                                const value = e.target.value
                                                if (value === 'custom') {
                                                    setIsCustomProvider(true)
                                                    setSelectedProvider(null)
                                                    setSingleForm(prev => ({ ...prev, authType: 'password', oauth2ProviderConfigId: undefined }))
                                                } else {
                                                    setIsCustomProvider(false)
                                                    const id = parseInt(value)
                                                    setSelectedProvider(id)
                                                    // 根据提供商类型设置默认认证方式
                                                    const provider = providers.find(p => p.id === id)
                                                    if (provider?.type === 'outlook') {
                                                        setSingleForm(prev => ({ ...prev, authType: 'oauth2', oauth2ProviderConfigId: undefined }))
                                                    } else {
                                                        setSingleForm(prev => ({ ...prev, authType: 'password', oauth2ProviderConfigId: undefined }))
                                                    }

                                                    // 加载对应的OAuth2配置
                                                    if (provider) {
                                                        await loadOAuth2Configs(provider.type)
                                                    }
                                                }
                                            }}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                            required
                                        >
                                            <option value="">请选择提供商</option>
                                            {providers.map(provider => (
                                                <option key={provider.id} value={provider.id}>
                                                    {provider.name} ({provider.type})
                                                </option>
                                            ))}
                                            <option value="custom">🔧 自定义 IMAP 服务器</option>
                                        </select>
                                    )}

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

                                {/* Tab 切换 */}
                                <div className="flex border-b border-gray-200 dark:border-gray-700">
                                    <button
                                        onClick={() => {
                                            if (activeTab !== 'single') {
                                                setIsTabTransitioning(true)
                                                setTimeout(() => {
                                                    setActiveTab('single')
                                                    setIsTabTransitioning(false)
                                                }, 150)
                                            }
                                        }}
                                        className={cn(
                                            "flex-1 px-6 py-3 text-sm font-medium transition-colors",
                                            activeTab === 'single'
                                                ? "border-b-2 border-primary-600 text-primary-600"
                                                : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                                        )}
                                    >
                                        <div className="flex items-center justify-center space-x-2">
                                            <Plus className="h-4 w-4" />
                                            <span>单独添加</span>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (activeTab !== 'batch' && getSelectedProvider()?.type === 'outlook') {
                                                setIsTabTransitioning(true)
                                                setTimeout(() => {
                                                    setActiveTab('batch')
                                                    setIsTabTransitioning(false)
                                                }, 150)
                                            }
                                        }}
                                        className={cn(
                                            "flex-1 px-6 py-3 text-sm font-medium transition-colors",
                                            activeTab === 'batch'
                                                ? "border-b-2 border-primary-600 text-primary-600"
                                                : getSelectedProvider()?.type !== 'outlook'
                                                    ? "text-gray-400 cursor-not-allowed dark:text-gray-600"
                                                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                                        )}
                                        disabled={getSelectedProvider()?.type !== 'outlook'}
                                    >
                                        <div className="flex items-center justify-center space-x-2">
                                            <FileText className={cn(
                                                "h-4 w-4",
                                                getSelectedProvider()?.type !== 'outlook' && "opacity-50"
                                            )} />
                                            <span>批量添加</span>
                                            {getSelectedProvider()?.type !== 'outlook' && (
                                                <span className="text-xs">(仅Outlook)</span>
                                            )}
                                        </div>
                                    </button>
                                </div>

                                {/* Tab 内容区域 - 可滚动，带动画 */}
                                <div className="flex-1 overflow-y-auto">
                                    <AnimatePresence mode="wait">
                                        {activeTab === 'single' ? (
                                            <motion.div
                                                key="single-tab"
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                                transition={{ duration: 0.3 }}
                                                className="p-6"
                                            >
                                                {/* 单独添加表单 */}
                                                <div className="space-y-4">
                                                    {/* 邮箱地址 */}
                                                    <div>
                                                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                            邮箱地址
                                                        </label>
                                                        <input
                                                            type="email"
                                                            value={singleForm.email}
                                                            onChange={(e) => setSingleForm({ ...singleForm, email: e.target.value })}
                                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                            placeholder="example@outlook.com"
                                                            required
                                                        />
                                                    </div>

                                                    {/* 验证方式 */}
                                                    <div>
                                                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                            验证方式
                                                        </label>
                                                        <div className="flex space-x-4">
                                                            <label className="flex items-center">
                                                                <input
                                                                    type="radio"
                                                                    value="password"
                                                                    checked={singleForm.authType === 'password'}
                                                                    onChange={(e) => setSingleForm({ ...singleForm, authType: 'password' })}
                                                                    className="mr-2"
                                                                    disabled={!supportsOAuth2() && singleForm.authType === 'oauth2'}
                                                                />
                                                                <span className="text-sm">密码</span>
                                                            </label>
                                                            <label className="flex items-center">
                                                                <input
                                                                    type="radio"
                                                                    value="oauth2"
                                                                    checked={singleForm.authType === 'oauth2'}
                                                                    onChange={(e) => setSingleForm({ ...singleForm, authType: 'oauth2' })}
                                                                    className="mr-2"
                                                                    disabled={!supportsOAuth2()}
                                                                />
                                                                <span className={cn(
                                                                    "text-sm",
                                                                    !supportsOAuth2() && "text-gray-400"
                                                                )}>
                                                                    OAuth2 {!supportsOAuth2() && getSelectedProvider()?.type === 'gmail' && "(需要先配置Gmail OAuth2)"}
                                                                    {!supportsOAuth2() && getSelectedProvider()?.type !== 'gmail' && getSelectedProvider()?.type !== 'outlook' && "(不支持OAuth2)"}
                                                                </span>
                                                            </label>
                                                        </div>
                                                    </div>

                                                    {/* 密码输入 */}
                                                    {singleForm.authType === 'password' && (
                                                        <div>
                                                            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                密码
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={singleForm.password}
                                                                onChange={(e) => setSingleForm({ ...singleForm, password: e.target.value })}
                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                placeholder="输入密码"
                                                                required
                                                            />
                                                        </div>
                                                    )}

                                                    {/* OAuth2 输入 */}
                                                    {singleForm.authType === 'oauth2' && (
                                                        <>
                                                            {/* OAuth2 配置选择器 */}
                                                            {(getSelectedProvider()?.type === 'gmail' || getSelectedProvider()?.type === 'outlook') && oauth2Configs.length > 0 && (
                                                                <div className="mb-4">
                                                                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                        OAuth2 配置
                                                                    </label>
                                                                    {loadingOAuth2Configs ? (
                                                                        <div className="flex items-center space-x-2 text-gray-500 p-3 border border-gray-300 rounded-lg">
                                                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent"></div>
                                                                            <span>加载配置中...</span>
                                                                        </div>
                                                                    ) : (
                                                                        <select
                                                                            value={singleForm.oauth2ProviderConfigId || ''}
                                                                            onChange={(e) => setSingleForm({ ...singleForm, oauth2ProviderConfigId: e.target.value ? parseInt(e.target.value) : undefined })}
                                                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                            required
                                                                        >
                                                                            <option value="">请选择OAuth2配置</option>
                                                                            {oauth2Configs.map(config => (
                                                                                <option key={config.id} value={config.id}>
                                                                                    {config.name} ({config.client_id ? `${config.client_id.substring(0, 8)}...` : 'N/A'})
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    )}
                                                                    {oauth2Configs.length === 0 && !loadingOAuth2Configs && (
                                                                        <div className="mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                                                                            没有找到可用的OAuth2配置，请先在OAuth2配置页面添加配置
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* Gmail OAuth2 获取授权 */}
                                                            {getSelectedProvider()?.type === 'gmail' && (
                                                                <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 p-4">
                                                                    <div className="flex items-center justify-between mb-2">
                                                                        <h4 className="text-sm font-medium text-green-900 dark:text-green-200">
                                                                            Gmail OAuth2 授权
                                                                        </h4>
                                                                    </div>
                                                                    <p className="text-xs text-green-700 dark:text-green-300 mb-3">
                                                                        点击下方按钮获取Gmail OAuth2授权，完成授权后系统会自动跳转并填充Token信息
                                                                    </p>
                                                                    <button
                                                                        type="button"
                                                                        onClick={handleOAuth2Auth}
                                                                        disabled={gettingOAuth2Auth}
                                                                        className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                                                                    >
                                                                        {gettingOAuth2Auth ? '获取中...' : (getSelectedProvider()?.type === 'outlook' ? '获取Outlook授权' : '获取Gmail授权')}
                                                                    </button>
                                                                </div>
                                                            )}

                                                            {/* 一键解析功能 - 仅对 Outlook OAuth2 显示 */}
                                                            {getSelectedProvider()?.type === 'outlook' && (
                                                                <div className="mb-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 overflow-hidden">
                                                                    <div className="p-4">
                                                                        <div className="flex items-center justify-between mb-2">
                                                                            <h4 className="text-sm font-medium text-blue-900 dark:text-blue-200">
                                                                                快速导入（可选）
                                                                            </h4>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => setShowSingleParse(!showSingleParse)}
                                                                                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                                                            >
                                                                                {showSingleParse ? '收起' : '展开'}
                                                                            </button>
                                                                        </div>
                                                                        <AnimatePresence>
                                                                            {showSingleParse && (
                                                                                <motion.div
                                                                                    initial={{ height: 0, opacity: 0 }}
                                                                                    animate={{ height: "auto", opacity: 1 }}
                                                                                    exit={{ height: 0, opacity: 0 }}
                                                                                    transition={{ duration: 0.3 }}
                                                                                    className="space-y-3 overflow-hidden"
                                                                                >
                                                                                    <p className="text-xs text-blue-700 dark:text-blue-300">
                                                                                        粘贴格式：邮箱{batchSeparator}Access Token{batchSeparator}Client ID{batchSeparator}Refresh Token
                                                                                    </p>
                                                                                    <div className="flex space-x-2">
                                                                                        <input
                                                                                            type="text"
                                                                                            value={singleParseText}
                                                                                            onChange={(e) => setSingleParseText(e.target.value)}
                                                                                            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                                            placeholder={`example@outlook.com${batchSeparator}token${batchSeparator}client-id${batchSeparator}refresh-token`}
                                                                                        />
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={parseSingleAccountText}
                                                                                            disabled={!singleParseText.trim()}
                                                                                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                                                                                        >
                                                                                            解析
                                                                                        </button>
                                                                                    </div>
                                                                                </motion.div>
                                                                            )}
                                                                        </AnimatePresence>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            <div>
                                                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                    Client ID
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    value={singleForm.clientId}
                                                                    onChange={(e) => setSingleForm({ ...singleForm, clientId: e.target.value })}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                    placeholder="9e5f94bc-e8a4-4e73-b8be-63364c29d753"
                                                                    required
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                    Access Token
                                                                </label>
                                                                <textarea
                                                                    value={singleForm.accessToken}
                                                                    onChange={(e) => setSingleForm({ ...singleForm, accessToken: e.target.value })}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                    placeholder="输入 Access Token"
                                                                    rows={3}
                                                                    required
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                    Refresh Token
                                                                </label>
                                                                <textarea
                                                                    value={singleForm.refreshToken}
                                                                    onChange={(e) => setSingleForm({ ...singleForm, refreshToken: e.target.value })}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                    placeholder="输入 Refresh Token"
                                                                    rows={3}
                                                                    required
                                                                />
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* 代理设置 */}
                                                    <div className="space-y-3">
                                                        <label className="flex items-center space-x-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={singleForm.useProxy}
                                                                onChange={(e) => setSingleForm({ ...singleForm, useProxy: e.target.checked })}
                                                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                            />
                                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                使用代理
                                                            </span>
                                                        </label>

                                                        <AnimatePresence>
                                                            {singleForm.useProxy && (
                                                                <motion.div
                                                                    initial={{ height: 0, opacity: 0 }}
                                                                    animate={{ height: "auto", opacity: 1 }}
                                                                    exit={{ height: 0, opacity: 0 }}
                                                                    transition={{ duration: 0.3 }}
                                                                    className="space-y-3 overflow-hidden"
                                                                >
                                                                    <div>
                                                                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                            代理地址
                                                                        </label>
                                                                        <input
                                                                            type="text"
                                                                            value={singleForm.proxyUrl}
                                                                            onChange={(e) => setSingleForm({ ...singleForm, proxyUrl: e.target.value })}
                                                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                            placeholder="socks5://127.0.0.1:1080"
                                                                            required
                                                                        />
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-3">
                                                                        <div>
                                                                            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                                代理用户名（可选）
                                                                            </label>
                                                                            <input
                                                                                type="text"
                                                                                value={singleForm.proxyUsername}
                                                                                onChange={(e) => setSingleForm({ ...singleForm, proxyUsername: e.target.value })}
                                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                                代理密码（可选）
                                                                            </label>
                                                                            <input
                                                                                type="password"
                                                                                value={singleForm.proxyPassword}
                                                                                onChange={(e) => setSingleForm({ ...singleForm, proxyPassword: e.target.value })}
                                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </motion.div>
                                                            )}
                                                        </AnimatePresence>
                                                    </div>

                                                    {/* 域名邮箱设置 */}
                                                    <div className="space-y-3">
                                                        <label className="flex items-center space-x-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={singleForm.isDomainMail}
                                                                onChange={(e) => setSingleForm({ ...singleForm, isDomainMail: e.target.checked })}
                                                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                            />
                                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                启用域名邮箱
                                                            </span>
                                                        </label>

                                                        <AnimatePresence>
                                                            {singleForm.isDomainMail && (
                                                                <motion.div
                                                                    initial={{ height: 0, opacity: 0 }}
                                                                    animate={{ height: "auto", opacity: 1 }}
                                                                    exit={{ height: 0, opacity: 0 }}
                                                                    transition={{ duration: 0.3 }}
                                                                    className="overflow-hidden"
                                                                >
                                                                    <div className="pt-3">
                                                                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                            域名
                                                                        </label>
                                                                        <input
                                                                            type="text"
                                                                            value={singleForm.domain}
                                                                            onChange={(e) => setSingleForm({ ...singleForm, domain: e.target.value })}
                                                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                            placeholder="example.com"
                                                                            required
                                                                        />
                                                                    </div>
                                                                </motion.div>
                                                            )}
                                                        </AnimatePresence>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ) : (
                                            <motion.div
                                                key="batch-tab"
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -10 }}
                                                transition={{ duration: 0.3 }}
                                                className="p-6"
                                            >
                                                {/* 批量添加表单 */}
                                                <div className="space-y-4">
                                                    {getSelectedProvider()?.type !== 'outlook' ? (
                                                        <div className="rounded-lg bg-yellow-50 p-4 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                                                            <div className="flex items-start space-x-2">
                                                                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                                                                <div>
                                                                    <p className="font-medium">批量添加仅支持 Outlook</p>
                                                                    <p className="mt-1 text-sm">请选择 Outlook 提供商以使用批量添加功能</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {/* 格式模板选择器 */}
                                                            <div className="mb-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 p-4">
                                                                <label className="mb-2 block text-sm font-medium text-blue-900 dark:text-blue-200">
                                                                    选择数据格式
                                                                </label>
                                                                <select
                                                                    value={selectedFormatTemplate}
                                                                    onChange={(e) => setSelectedFormatTemplate(e.target.value)}
                                                                    className="w-full rounded-lg border border-blue-200 dark:border-blue-800 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:bg-gray-700"
                                                                >
                                                                    {BATCH_FORMAT_TEMPLATES.map(template => (
                                                                        <option key={template.id} value={template.id}>
                                                                            {template.name}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                                <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">
                                                                    {BATCH_FORMAT_TEMPLATES.find(t => t.id === selectedFormatTemplate)?.description}
                                                                </p>
                                                            </div>

                                                            <div className="flex items-center space-x-4">
                                                                <div className="flex-1">
                                                                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                        授权方式
                                                                    </label>
                                                                    <select
                                                                        value={batchAuthType}
                                                                        disabled
                                                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-gray-50 dark:border-gray-600 dark:bg-gray-700"
                                                                    >
                                                                        <option value="token">Token</option>
                                                                    </select>
                                                                </div>
                                                                <div className="flex-1">
                                                                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                        分隔符
                                                                    </label>
                                                                    <input
                                                                        type="text"
                                                                        value={batchSeparator}
                                                                        onChange={(e) => setBatchSeparator(e.target.value)}
                                                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                    />
                                                                </div>
                                                            </div>

                                                            <div>
                                                                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                    账户数据（每行一个账户）
                                                                </label>
                                                                <textarea
                                                                    value={batchText}
                                                                    onChange={(e) => setBatchText(e.target.value)}
                                                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 font-mono text-sm"
                                                                    placeholder={BATCH_FORMAT_TEMPLATES.find(t => t.id === selectedFormatTemplate)?.description.replace(/----/g, batchSeparator)}
                                                                    rows={8}
                                                                />
                                                                <p className="mt-1 text-xs text-gray-500">
                                                                    格式：{BATCH_FORMAT_TEMPLATES.find(t => t.id === selectedFormatTemplate)?.description.replace(/----/g, batchSeparator)}
                                                                </p>
                                                            </div>

                                                            {/* 同步配置选项 */}
                                                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                                                                <div className="flex items-center justify-between">
                                                                    <div className="flex items-center space-x-2">
                                                                        <Clock className="h-4 w-4 text-gray-500" />
                                                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                            添加后启用自动同步
                                                                        </label>
                                                                    </div>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={enableSyncAfterAdd}
                                                                        onChange={(e) => setEnableSyncAfterAdd(e.target.checked)}
                                                                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                                                    />
                                                                </div>

                                                                {enableSyncAfterAdd && (
                                                                    <div className="flex items-center space-x-3">
                                                                        <label className="text-sm text-gray-600 dark:text-gray-400">
                                                                            同步间隔：
                                                                        </label>
                                                                        <select
                                                                            value={syncInterval}
                                                                            onChange={(e) => setSyncInterval(parseInt(e.target.value))}
                                                                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                                                        >
                                                                            {SYNC_INTERVALS.map(interval => (
                                                                                <option key={interval.value} value={interval.value}>
                                                                                    {interval.label}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <button
                                                                onClick={parseBatchText}
                                                                disabled={!batchText.trim()}
                                                                className="w-full rounded-lg bg-primary-600 px-4 py-2 text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                                                            >
                                                                一键解析
                                                            </button>

                                                            {/* 解析预览 */}
                                                            <AnimatePresence>
                                                                {showBatchPreview && batchAccounts.length > 0 && (
                                                                    <motion.div
                                                                        initial={{ height: 0, opacity: 0 }}
                                                                        animate={{ height: "auto", opacity: 1 }}
                                                                        exit={{ height: 0, opacity: 0 }}
                                                                        transition={{ duration: 0.3 }}
                                                                        className="space-y-2 pt-4 overflow-hidden"
                                                                    >
                                                                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                            解析结果（{batchAccounts.filter(a => a.isValid).length} 个有效，{batchAccounts.filter(a => !a.isValid).length} 个无效）
                                                                        </h3>
                                                                        <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                                                                            {batchAccounts.map((account, index) => (
                                                                                <div
                                                                                    key={index}
                                                                                    className={cn(
                                                                                        "flex items-center justify-between p-3 text-sm",
                                                                                        index % 2 === 0 ? "bg-gray-50 dark:bg-gray-800" : "bg-white dark:bg-gray-900",
                                                                                        !account.isValid && "opacity-60"
                                                                                    )}
                                                                                >
                                                                                    <div className="flex items-center space-x-2">
                                                                                        {account.isValid ? (
                                                                                            <Check className="h-4 w-4 text-green-500" />
                                                                                        ) : (
                                                                                            <AlertCircle className="h-4 w-4 text-red-500" />
                                                                                        )}
                                                                                        <span className="font-mono">{account.email}</span>
                                                                                    </div>
                                                                                    {!account.isValid && (
                                                                                        <span className="text-xs text-red-600 dark:text-red-400">
                                                                                            {account.error}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </div>
                    </ModalBody>

                    <ModalFooter>
                        <Button
                            variant="outline"
                            onClick={handleClose}
                            disabled={loading}
                        >
                            取消
                        </Button>
                        <Button
                            onClick={activeTab === 'single' ? handleSingleSubmit : handleBatchSubmit}
                            disabled={
                                loading ||
                                !selectedProvider ||
                                (activeTab === 'single' && !singleForm.email) ||
                                (activeTab === 'batch' && (!showBatchPreview || batchAccounts.filter(a => a.isValid).length === 0))
                            }
                        >
                            {loading ? (
                                <>
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2"></div>
                                    <span>处理中...</span>
                                </>
                            ) : (
                                <>
                                    <Plus className="h-4 w-4 mr-2" />
                                    <span>{activeTab === 'single' ? '添加账户' : `批量添加 (${batchAccounts.filter(a => a.isValid).length})`}</span>
                                </>
                            )}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            {/* OAuth2 Popup 授权组件 */}
            {showOAuth2Popup && selectedProvider && (
                <OAuth2PopupAuth
                    provider={getSelectedProvider()?.type.toLowerCase() as any}
                    configId={singleForm.oauth2ProviderConfigId}
                    onSuccess={handleOAuth2Success}
                    onCancel={handleOAuth2Cancel}
                    onError={handleOAuth2Error}
                />
            )}
        </>
    )
}
