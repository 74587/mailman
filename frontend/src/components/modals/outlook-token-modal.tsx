'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect } from 'react'
import { Check, AlertCircle, Loader2, ArrowRight, CheckCircle, Clock, Settings, Eye, EyeOff } from 'lucide-react'
import { emailAccountService } from '@/services/email-account.service'
import { syncConfigService } from '@/services/sync-config.service'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { EmailAccount } from '@/types'
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

interface OutlookTokenModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
    onError?: (error: string) => void
    presetData?: {
        email?: string
        clientId?: string
        accessToken?: string
        refreshToken?: string
        fromThunderbird?: boolean
    } | null
}

interface OutlookTokenForm {
    email: string
    clientId: string
    refreshToken: string
    accessToken: string
    useProxy: boolean
    proxyUrl: string
    proxyUsername: string
    proxyPassword: string
}

// 工作流程步骤
type WorkflowStep = 'token' | 'verify' | 'sync' | 'config' | 'complete'

interface StepData {
    createdAccount?: EmailAccount
    verificationResult?: any
    syncResult?: any
    configResult?: any
}

export default function OutlookTokenModal({
    isOpen,
    onClose,
    onSuccess,
    onError,
    presetData
}: OutlookTokenModalProps) {
    const [currentStep, setCurrentStep] = useState<WorkflowStep>('token')
    const [stepData, setStepData] = useState<StepData>({})
    const [loading, setLoading] = useState(false)

    // Token表单状态
    const [tokenForm, setTokenForm] = useState<OutlookTokenForm>({
        email: '',
        clientId: '',
        refreshToken: '',
        accessToken: '',
        useProxy: false,
        proxyUrl: '',
        proxyUsername: '',
        proxyPassword: ''
    })

    // 同步表单状态
    const [syncMode, setSyncMode] = useState<'incremental' | 'full'>('incremental')
    const [maxEmails, setMaxEmails] = useState(1000)
    const [includeBody, setIncludeBody] = useState(true)

    // 配置表单状态
    const [enableAutoSync, setEnableAutoSync] = useState(true)
    const [syncInterval, setSyncInterval] = useState(300) // 5 minutes

    // 显示/隐藏密码状态
    const [showAccessToken, setShowAccessToken] = useState(false)
    const [showRefreshToken, setShowRefreshToken] = useState(false)

    // 工作流程步骤配置
    const steps = [
        { key: 'token', title: '输入Token', description: '配置Outlook OAuth2 Token信息' },
        { key: 'verify', title: '验证连接', description: '验证账户连接性' },
        { key: 'sync', title: '首次同步', description: '同步邮件到本地' },
        { key: 'config', title: '同步配置', description: '设置自动同步规则' },
        { key: 'complete', title: '完成', description: '账户设置完成' }
    ]

    const currentStepIndex = steps.findIndex(step => step.key === currentStep)

    // 监听presetData的变化，当从Thunderbird获得数据时填充表单
    useEffect(() => {
        if (presetData && isOpen) {
            logger.debug('[Outlook Token Modal] 收到presetData，数据:', presetData)
            // 预填充Token表单数据
            setTokenForm(prev => {
                const newForm = {
                    ...prev,
                    email: presetData.email || '',
                    clientId: presetData.clientId || '',
                    accessToken: presetData.accessToken || '',
                    refreshToken: presetData.refreshToken || ''
                }
                logger.debug('[Outlook Token Modal] 新的表单数据:', newForm)
                return newForm
            })
        }
    }, [presetData, isOpen])

    // 仅在modal关闭时重置表单，而非打开时
    useEffect(() => {
        logger.debug('[Outlook Token Modal] isOpen状态变化:', isOpen)
        if (!isOpen) {
            logger.debug('[Outlook Token Modal] Modal关闭，重置表单')
            // 延迟重置以避免与presetData逻辑冲突
            setTimeout(() => {
                resetForm()
            }, 0)
        }
    }, [isOpen])

    // 监听tokenForm变化
    useEffect(() => {
        logger.debug('[Outlook Token Modal] tokenForm状态更新:', tokenForm)
    }, [tokenForm])

    const resetForm = () => {
        logger.debug('[Outlook Token Modal] 重置表单所有状态')
        setCurrentStep('token')
        setStepData({})
        setTokenForm({
            email: '',
            clientId: '',
            refreshToken: '',
            accessToken: '',
            useProxy: false,
            proxyUrl: '',
            proxyUsername: '',
            proxyPassword: ''
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

    // 验证Token表单
    const validateTokenForm = () => {
        if (!tokenForm.email) {
            onError?.('请输入邮箱地址')
            return false
        }
        if (!tokenForm.clientId) {
            onError?.('请输入Client ID')
            return false
        }
        if (!tokenForm.refreshToken) {
            onError?.('请输入Refresh Token')
            return false
        }
        return true
    }

    // 步骤1: 创建或更新账户
    const handleCreateAccount = async () => {
        if (!validateTokenForm()) {
            return
        }

        try {
            setLoading(true)

            // 查找Outlook邮件提供商
            const providers = await emailAccountService.getProviders()
            const outlookProvider = providers.find(p => p.type.toLowerCase() === 'outlook')

            if (!outlookProvider) {
                onError?.('未找到Outlook邮件提供商配置')
                return
            }

            const payload: any = {
                email_address: tokenForm.email,
                mail_provider_id: outlookProvider.id,
                auth_type: 'oauth2',
                custom_settings: {
                    client_id: tokenForm.clientId,
                    refresh_token: tokenForm.refreshToken,
                    access_token: tokenForm.accessToken
                }
            }

            // 处理代理设置
            if (tokenForm.useProxy) {
                payload.proxy = tokenForm.proxyUrl
                if (tokenForm.proxyUsername && tokenForm.proxyPassword) {
                    try {
                        const url = new URL(tokenForm.proxyUrl)
                        url.username = tokenForm.proxyUsername
                        url.password = tokenForm.proxyPassword
                        payload.proxy = url.toString()
                    } catch (e) {
                        payload.proxy = tokenForm.proxyUrl
                    }
                }
            }

            // 使用upsert接口，自动处理创建或更新逻辑
            const account = await emailAccountService.upsertAccount(payload)
            logger.debug('Successfully created or updated account:', account.emailAddress)

            setStepData(prev => ({ ...prev, createdAccount: account }))
            setCurrentStep('verify')
        } catch (error: any) {
            onError?.(error.message || '账户操作失败')
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

            // 先尝试获取现有同步配置
            let configResult: any
            try {
                const existingConfig = await syncConfigService.getAccountSyncConfig(stepData.createdAccount.id)

                // 如果已存在配置，更新它
                configResult = await syncConfigService.updateAccountSyncConfig(stepData.createdAccount.id, {
                    enable_auto_sync: enableAutoSync,
                    sync_interval: syncInterval,
                    sync_folders: existingConfig.sync_folders || [] // 保留现有文件夹配置
                })
                logger.debug('Updated existing sync config')
            } catch (getConfigError: any) {
                // 如果获取配置失败（可能是配置不存在），创建新配置
                if (getConfigError.message?.includes('404') || getConfigError.message?.includes('not found')) {
                    configResult = await syncConfigService.createAccountSyncConfig(stepData.createdAccount.id, {
                        enable_auto_sync: enableAutoSync,
                        sync_interval: syncInterval,
                        sync_folders: [] // 使用默认文件夹
                    })
                    logger.debug('Created new sync config')
                } else {
                    throw getConfigError
                }
            }

            setStepData(prev => ({ ...prev, configResult }))
            setCurrentStep('complete')
        } catch (error: any) {
            onError?.(error.message || '同步配置操作失败')
        } finally {
            setLoading(false)
        }
    }

    // 完成整个流程
    const handleComplete = () => {
        onSuccess?.()
        handleClose()
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <ModalContent size="xl" className="max-h-[90vh] flex flex-col">
                <ModalHeader>
                    <ModalTitle>Outlook Token 账户设置向导</ModalTitle>
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
                        {currentStep === 'token' && (
                            <motion.div
                                key="token"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.2 }}
                            >
                                {/* Token输入表单 */}
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            邮箱地址 *
                                        </label>
                                        <input
                                            type="email"
                                            value={tokenForm.email}
                                            onChange={(e) => setTokenForm(prev => ({ ...prev, email: e.target.value }))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            placeholder="your.outlook@outlook.com"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            Client ID *
                                        </label>
                                        <input
                                            type="text"
                                            value={tokenForm.clientId}
                                            onChange={(e) => setTokenForm(prev => ({ ...prev, clientId: e.target.value }))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            placeholder="OAuth2 Client ID"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            Refresh Token *
                                        </label>
                                        <div className="relative">
                                            <textarea
                                                value={tokenForm.refreshToken}
                                                onChange={(e) => setTokenForm(prev => ({ ...prev, refreshToken: e.target.value }))}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white pr-10"
                                                placeholder="Outlook Refresh Token"
                                                rows={3}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowRefreshToken(!showRefreshToken)}
                                                className="absolute right-2 top-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                            >
                                                {showRefreshToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            Access Token (可选)
                                        </label>
                                        <div className="relative">
                                            <textarea
                                                value={tokenForm.accessToken}
                                                onChange={(e) => setTokenForm(prev => ({ ...prev, accessToken: e.target.value }))}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white pr-10"
                                                placeholder="Outlook Access Token"
                                                rows={3}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowAccessToken(!showAccessToken)}
                                                className="absolute right-2 top-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                            >
                                                {showAccessToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="border-t pt-4">
                                        <label className="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={tokenForm.useProxy}
                                                onChange={(e) => setTokenForm(prev => ({ ...prev, useProxy: e.target.checked }))}
                                                className="mr-2"
                                            />
                                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">使用代理服务器</span>
                                        </label>
                                    </div>

                                    {tokenForm.useProxy && (
                                        <div className="space-y-3 pl-6 border-l-2 border-gray-200 dark:border-gray-600">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                    代理地址
                                                </label>
                                                <input
                                                    type="text"
                                                    value={tokenForm.proxyUrl}
                                                    onChange={(e) => setTokenForm(prev => ({ ...prev, proxyUrl: e.target.value }))}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                    placeholder="socks5://proxy.example.com:1080"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                        代理用户名
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={tokenForm.proxyUsername}
                                                        onChange={(e) => setTokenForm(prev => ({ ...prev, proxyUsername: e.target.value }))}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                        placeholder="用户名"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                        代理密码
                                                    </label>
                                                    <input
                                                        type="password"
                                                        value={tokenForm.proxyPassword}
                                                        onChange={(e) => setTokenForm(prev => ({ ...prev, proxyPassword: e.target.value }))}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                        placeholder="密码"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {tokenForm.refreshToken && (
                                        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                            <div className="flex items-center">
                                                <CheckCircle className="h-4 w-4 text-green-600 mr-2" />
                                                <span className="text-sm text-green-800">Token 信息已填写完整</span>
                                            </div>
                                        </div>
                                    )}
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
                    <button
                        onClick={currentStep === 'token' ? handleClose : () => {
                            const currentIndex = steps.findIndex(step => step.key === currentStep)
                            if (currentIndex > 0) {
                                setCurrentStep(steps[currentIndex - 1].key as WorkflowStep)
                            }
                        }}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-600 dark:text-gray-300 dark:border-gray-500 dark:hover:bg-gray-500"
                        disabled={loading}
                    >
                        {currentStep === 'token' ? '取消' : '上一步'}
                    </button>

                    <div className="flex space-x-3">
                        {currentStep === 'token' && (
                            <button
                                onClick={handleCreateAccount}
                                disabled={loading || !tokenForm.email || !tokenForm.clientId || !tokenForm.refreshToken}
                                className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                <span>{loading ? '创建中...' : '创建账户'}</span>
                            </button>
                        )}

                        {currentStep === 'verify' && (
                            <button
                                onClick={handleVerifyAccount}
                                disabled={loading}
                                className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                <span>{loading ? '验证中...' : '验证连接'}</span>
                            </button>
                        )}

                        {currentStep === 'sync' && (
                            <button
                                onClick={handleInitialSync}
                                disabled={loading}
                                className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                <Clock className="h-4 w-4" />
                                <span>{loading ? '同步中...' : '开始同步'}</span>
                            </button>
                        )}

                        {currentStep === 'config' && (
                            <button
                                onClick={handleCreateSyncConfig}
                                disabled={loading}
                                className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                <Settings className="h-4 w-4" />
                                <span>{loading ? '配置中...' : '创建配置'}</span>
                            </button>
                        )}

                        {currentStep === 'complete' && (
                            <button
                                onClick={handleComplete}
                                className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-lg hover:bg-green-700"
                            >
                                <CheckCircle className="h-4 w-4" />
                                <span>完成</span>
                            </button>
                        )}
                    </div>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}