'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect } from 'react'
import { Copy, Check, AlertCircle, Loader2, ArrowRight, ArrowLeft, Shield, Eye, EyeOff, Info, ExternalLink, Mail, Settings } from 'lucide-react'
import { oauth2Service } from '@/services/oauth2.service'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
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

interface OutlookThunderbirdModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess?: () => void
    onError?: (error: string) => void
}

interface AuthData {
    code: string
    fullUrl: string
    accessToken: string
    refreshToken: string
    email: string
}

// 工作流程步骤
type WorkflowStep = 'url' | 'code' | 'tokens' | 'email' | 'complete'

interface StepData {
    authData: AuthData
    tokenData?: any
}

// Thunderbird固定配置
const THUNDERBIRD_CONFIG = {
    clientId: '9e5f94bc-e8a4-4e73-b8be-63364c29d753',
    redirectUri: 'https://localhost',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=9e5f94bc-e8a4-4e73-b8be-63364c29d753&response_type=code&redirect_uri=https%3A%2F%2Flocalhost&response_mode=query&scope=offline_access%20https%3A%2F%2Foutlook.office.com%2FIMAP.AccessAsUser.All%20https%3A%2F%2Foutlook.office.com%2FPOP.AccessAsUser.All%20https%3A%2F%2Foutlook.office.com%2FEWS.AccessAsUser.All%20https%3A%2F%2Foutlook.office.com%2FSMTP.Send'
}

export default function OutlookThunderbirdModal({
    isOpen,
    onClose,
    onSuccess,
    onError
}: OutlookThunderbirdModalProps) {
    const [currentStep, setCurrentStep] = useState<WorkflowStep>('url')
    const [stepData, setStepData] = useState<StepData>({ authData: { code: '', fullUrl: '', accessToken: '', refreshToken: '', email: '' } })
    const [loading, setLoading] = useState(false)
    const [copied, setCopied] = useState(false)
    const [showAccessToken, setShowAccessToken] = useState(false)
    const [showRefreshToken, setShowRefreshToken] = useState(false)

    // 工作流程步骤配置
    const steps = [
        { key: 'url', title: '复制授权URL', description: '复制Thunderbird授权链接到其他浏览器' },
        { key: 'code', title: '解析授权码', description: '从授权回调URL中提取授权码' },
        { key: 'tokens', title: '获取Tokens', description: '使用授权码获取访问令牌' },
        { key: 'email', title: '输入邮箱地址', description: '输入您的Outlook邮箱地址' },
        { key: 'complete', title: '完成', description: '账户授权成功' }
    ]

    const currentStepIndex = steps.findIndex(step => step.key === currentStep)

    useEffect(() => {
        if (isOpen) {
            resetForm()
        }
    }, [isOpen])

    const resetForm = () => {
        setCurrentStep('url')
        setStepData({ authData: { code: '', fullUrl: '', accessToken: '', refreshToken: '', email: '' } })
        setCopied(false)
        setShowAccessToken(false)
        setShowRefreshToken(false)
    }

    const handleClose = () => {
        resetForm()
        onClose()
    }

    // 步骤1: 复制授权URL并进入下一步
    const handleCopyUrlAndNext = async () => {
        try {
            await navigator.clipboard.writeText(THUNDERBIRD_CONFIG.authUrl)
            setCopied(true)
            // 显示已复制提示后自动进入下一步
            setTimeout(() => {
                setCopied(false)
                setCurrentStep('code')
            }, 800)
        } catch (err) {
            onError?.('复制失败，请手动复制')
        }
    }

    // 步骤2: 解析授权码
    const parseAuthorizationCode = (input: string): string | null => {
        try {
            // 尝试直接作为code处理
            if (input.length < 100 && !input.includes('?')) {
                return input
            }

            // 尝试从URL中解析code
            const url = new URL(input)
            const code = url.searchParams.get('code')
            if (code) {
                return code
            }

            // 尝试从查询字符串中解析code
            if (input.includes('code=')) {
                const match = input.match(/code=([^&]+)/)
                if (match) {
                    return decodeURIComponent(match[1])
                }
            }

            return null
        } catch (err) {
            return null
        }
    }

    const handleExtractCode = async () => {
        if (!stepData.authData.fullUrl && !stepData.authData.code) {
            onError?.('请粘贴完整的回调URL或授权码')
            return
        }

        const input = stepData.authData.fullUrl || stepData.authData.code
        const code = parseAuthorizationCode(input)

        if (!code) {
            onError?.('无法从输入中提取有效的授权码，请检查输入格式')
            return
        }

        // 更新code并获取Tokens
        try {
            setLoading(true)
            const response = await oauth2Service.exchangeThunderbirdCode(code)

            setStepData(prev => ({
                ...prev,
                authData: {
                    ...prev.authData,
                    code,
                    accessToken: response.access_token,
                    refreshToken: response.refresh_token || ''
                },
                tokenData: response
            }))

            // 直接进入第4步（邮箱地址），跳过第3步（tokens展示）
            setCurrentStep('email')
        } catch (error: any) {
            onError?.(error.message || '解析授权码或获取Token失败')
        } finally {
            setLoading(false)
        }
    }

    const handleGetTokens = async () => {
        if (!stepData.authData.code) {
            onError?.('没有可用的授权码，请先完成授权步骤')
            return
        }

        try {
            setLoading(true)
            const response = await oauth2Service.exchangeThunderbirdCode(stepData.authData.code)

            setStepData(prev => ({
                ...prev,
                authData: {
                    ...prev.authData,
                    accessToken: response.access_token,
                    refreshToken: response.refresh_token || ''
                },
                tokenData: response
            }))

            // 成功获取token后，跳转到邮箱步骤
            setCurrentStep('email')
        } catch (error: any) {
            onError?.(error.message || '获取Token失败')
        } finally {
            setLoading(false)
        }
    }

    // 步骤4: 输入邮箱地址并触发Outlook已有Token模态框
    const handleCompleteAuth = () => {
        if (!stepData.authData.email) {
            onError?.('请输入邮箱地址')
            return
        }

        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(stepData.authData.email)) {
            onError?.('请输入有效的邮箱地址')
            return
        }

        // 触发Outlook已有Token模态框，预填充Thunderbird获取的数据
        const eventData = {
            email: stepData.authData.email,
            clientId: THUNDERBIRD_CONFIG.clientId,
            accessToken: stepData.authData.accessToken,
            refreshToken: stepData.authData.refreshToken,
            // 标记为Thunderbird来源，不需要输入token
            fromThunderbird: true
        }

        logger.debug('[Thunderbird Modal] 触发triggerOutlookTokenModal事件，数据:', eventData)

        const event = new CustomEvent('triggerOutlookTokenModal', {
            detail: eventData
        })
        window.dispatchEvent(event)

        // 关闭当前模态框
        handleClose()
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && handleClose()}>
            <ModalContent size="full" className="max-w-6xl max-h-[90vh] flex flex-col">
                <ModalHeader>
                    <div className="flex items-center">
                        <Shield className="h-6 w-6 text-orange-600 mr-3" />
                        <div>
                            <ModalTitle>Outlook Thunderbird 授权向导</ModalTitle>
                            <ModalDescription>{steps[currentStepIndex]?.description}</ModalDescription>
                        </div>
                    </div>
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
                                            ? "bg-orange-600 text-white"
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

                <ModalBody className="flex-1 overflow-hidden">
                    <div className="flex min-h-96 max-h-[calc(90vh-300px)]">
                        {/* 左侧 - 操作文档 */}
                        <div className="w-1/2 p-6 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                            <div className="h-full overflow-y-auto">
                                {currentStep === 'url' && (
                                    <div className="space-y-4">
                                        <h4 className="font-semibold text-gray-900 dark:text-white flex items-center">
                                            <Info className="h-4 w-4 mr-2" />
                                            操作说明
                                        </h4>
                                        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-3">
                                            <p>Thunderbird是一个开源的邮件客户端，使用它的OAuth2配置可以安全地授权访问您的Outlook账户。</p>
                                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                                <h5 className="font-medium text-blue-900 dark:text-blue-100 mb-2">注意事项：</h5>
                                                <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-200">
                                                    <li>请在其他浏览器中打开授权链接</li>
                                                    <li>确保您已经登录了Microsoft账户</li>
                                                    <li>授权完成后，浏览器会跳转到包含授权码的页面</li>
                                                    <li>复制完整的回调URL，其中包含授权码</li>
                                                </ul>
                                            </div>
                                            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                                                <h5 className="font-medium text-orange-900 dark:text-orange-100 mb-2">注册信息：</h5>
                                                <ul className="list-disc list-inside space-y-1 text-orange-800 dark:text-orange-200">
                                                    <li>Client ID: {THUNDERBIRD_CONFIG.clientId}</li>
                                                    <li>Redirect URI: {THUNDERBIRD_CONFIG.redirectUri}</li>
                                                    <li>无需Client Secret（公开客户端）</li>
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {currentStep === 'code' && (
                                    <div className="space-y-4">
                                        <h4 className="font-semibold text-gray-900 dark:text-white flex items-center">
                                            <Info className="h-4 w-4 mr-2" />
                                            授权码解析说明
                                        </h4>
                                        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-3">
                                            <p>完成授权后，您会收到一个包含授权码的URL。该URL通常格式如下：</p>
                                            <div className="bg-gray-100 dark:bg-gray-800 rounded p-3 font-mono text-xs">
                                                https://localhost/?code=CODE_VALUE&session_state=SESSION_ID
                                            </div>
                                            <p>您可以：</p>
                                            <ul className="list-disc list-inside space-y-1 ml-4">
                                                <li>粘贴完整的URL（推荐）</li>
                                                <li>或者只粘贴URL中的<code>code=</code>后面的部分</li>
                                            </ul>
                                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                                                <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                                                    <strong>提示：</strong>系统会自动解析URL并提取授权码，确保信息准确无误。
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {currentStep === 'tokens' && (
                                    <div className="space-y-4">
                                        <h4 className="font-semibold text-gray-900 dark:text-white flex items-center">
                                            <Info className="h-4 w-4 mr-2" />
                                            Token获取说明
                                        </h4>
                                        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-3">
                                            <p>系统将使用您的授权码向Microsoft服务器请求访问令牌。</p>
                                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                                <h5 className="font-medium text-blue-900 dark:text-blue-100 mb-2">获取的Token：</h5>
                                                <ul className="list-disc list-inside space-y-1 text-blue-800 dark:text-blue-200">
                                                    <li><strong>Access Token：</strong>短期有效的访问令牌</li>
                                                    <li><strong>Refresh Token：</strong>长期有效的刷新令牌</li>
                                                    <li>Refresh Token用于长期访问，Access Token用于短期API调用</li>
                                                </ul>
                                            </div>
                                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                                                <p className="text-green-800 dark:text-green-200 text-sm">
                                                    <strong>安全说明：</strong>所有Token都会安全存储在您的本地，符合OAuth2安全标准。
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {currentStep === 'email' && (
                                    <div className="space-y-4">
                                        <h4 className="font-semibold text-gray-900 dark:text-white flex items-center">
                                            <Info className="h-4 w-4 mr-2" />
                                            邮箱地址说明
                                        </h4>
                                        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-3">
                                            <p>由于Thunderbird使用公开客户端配置，我们无法自动获取您的邮箱地址。</p>
                                            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                                                <h5 className="font-medium text-orange-900 dark:text-orange-100 mb-2">请输入：</h5>
                                                <ul className="list-disc list-inside space-y-1 text-orange-800 dark:text-orange-200">
                                                    <li>您用于授权的Outlook邮箱地址</li>
                                                    <li>格式：your.email@outlook.com</li>
                                                    <li>确保邮箱地址正确，这将用于后续的邮件同步</li>
                                                </ul>
                                            </div>
                                            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3">
                                                <p className="text-purple-800 dark:text-purple-200 text-sm">
                                                    <strong>下一步：</strong>完成后将自动进入账户配置和验证流程。
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {currentStep === 'complete' && (
                                    <div className="space-y-4">
                                        <h4 className="font-semibold text-gray-900 dark:text-white flex items-center">
                                            <Check className="h-4 w-4 mr-2 text-green-600" />
                                            授权完成
                                        </h4>
                                        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-3">
                                            <p>恭喜！您的Outlook账户已成功通过Thunderbird授权。</p>
                                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                                                <h5 className="font-medium text-green-900 dark:text-green-100 mb-2">已完成的步骤：</h5>
                                                <ul className="list-disc list-inside space-y-1 text-green-800 dark:text-green-200">
                                                    <li>✓ OAuth2授权成功</li>
                                                    <li>✓ Access Token获取成功</li>
                                                    <li>✓ Refresh Token获取成功</li>
                                                    <li>✓ 邮箱地址确认</li>
                                                </ul>
                                            </div>
                                            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                                <p className="text-blue-800 dark:text-blue-200 text-sm">
                                                    <strong>即将：</strong>自动进入账户验证和配置流程。
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 右侧 - 交互区域 */}
                        <div className="w-1/2 p-6 overflow-y-auto">
                            <div className="flex items-start justify-center pt-4">
                                <AnimatePresence mode="wait">
                                    {currentStep === 'url' && (
                                        <motion.div
                                            key="url"
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            transition={{ duration: 0.2 }}
                                            className="w-full max-w-lg"
                                        >
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                        授权URL
                                                    </label>
                                                    <div className="relative">
                                                        <textarea
                                                            value={THUNDERBIRD_CONFIG.authUrl}
                                                            readOnly
                                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white text-xs leading-relaxed break-all"
                                                            rows={7}
                                                        />
                                                    </div>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                        点击下方按钮复制授权URL并进入下一步
                                                    </p>
                                                </div>

                                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                                    <h5 className="font-medium text-blue-900 dark:text-blue-100 mb-2">操作步骤：</h5>
                                                    <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
                                                        <li>1. 点击上方"复制"按钮</li>
                                                        <li>2. 在其他浏览器中打开链接</li>
                                                        <li>3. 登录您的Microsoft账户</li>
                                                        <li>4. 授权Thunderbird访问您的账户</li>
                                                        <li>5. 复制跳转后的完整URL</li>
                                                    </ol>
                                                </div>

                                                <button
                                                    onClick={handleCopyUrlAndNext}
                                                    disabled={copied}
                                                    className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-green-600 disabled:hover:bg-green-600 transition-colors"
                                                >
                                                    {copied ? (
                                                        <>
                                                            <Check className="h-4 w-4" />
                                                            <span>已复制，进入下一步...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Copy className="h-4 w-4" />
                                                            <span>复制URL并下一步</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </motion.div>
                                    )}

                                    {currentStep === 'code' && (
                                        <motion.div
                                            key="code"
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            transition={{ duration: 0.2 }}
                                            className="w-full max-w-lg"
                                        >
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                        粘贴回调URL或授权码
                                                    </label>
                                                    <textarea
                                                        value={stepData.authData.fullUrl}
                                                        onChange={(e) => setStepData(prev => ({
                                                            ...prev,
                                                            authData: { ...prev.authData, fullUrl: e.target.value, code: '' }
                                                        }))}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                        placeholder="https://localhost/?code=..."
                                                        rows={6}
                                                    />
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                        粘贴完整的回调URL，或只粘贴授权码
                                                    </p>
                                                </div>

                                                {stepData.authData.fullUrl && (
                                                    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                                                        <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">解析结果：</h5>
                                                        <div className="text-sm">
                                                            <p className="text-gray-600 dark:text-gray-400">
                                                                <span className="font-medium">输入：</span>
                                                            </p>
                                                            <p className="font-mono text-xs break-all bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                                                                {stepData.authData.fullUrl.length > 100 ?
                                                                    stepData.authData.fullUrl.substring(0, 100) + '...' :
                                                                    stepData.authData.fullUrl
                                                                }
                                                            </p>
                                                            {parseAuthorizationCode(stepData.authData.fullUrl) && (
                                                                <div className="mt-2">
                                                                    <p className="text-green-600 dark:text-green-400">
                                                                        <Check className="inline h-3 w-3 mr-1" />
                                                                        成功提取授权码
                                                                    </p>
                                                                    <p className="font-mono text-xs text-gray-600 dark:text-gray-400 mt-1">
                                                                        Code: {parseAuthorizationCode(stepData.authData.fullUrl)?.substring(0, 20)}...
                                                                    </p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="flex space-x-3">
                                                    <button
                                                        onClick={() => setCurrentStep('url')}
                                                        disabled={loading}
                                                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                                    >
                                                        <ArrowLeft className="h-4 w-4 inline mr-2" />
                                                        上一步
                                                    </button>
                                                    <button
                                                        onClick={handleExtractCode}
                                                        disabled={!stepData.authData.fullUrl || !parseAuthorizationCode(stepData.authData.fullUrl) || loading}
                                                        className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {loading ? (
                                                            <>
                                                                <Loader2 className="h-4 w-4 inline mr-2 animate-spin" />
                                                                <span>解析中...</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span>解析授权码</span>
                                                                <ArrowRight className="h-4 w-4 inline ml-2" />
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}

                                    {currentStep === 'tokens' && (
                                        <motion.div
                                            key="tokens"
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            transition={{ duration: 0.2 }}
                                            className="w-full max-w-lg"
                                        >
                                            <div className="space-y-4">
                                                <div className="text-center">
                                                    {loading ? (
                                                        <div className="space-y-4">
                                                            <Loader2 className="h-8 w-8 animate-spin mx-auto text-orange-600" />
                                                            <p className="text-sm text-gray-500 dark:text-gray-400">正在获取Tokens...</p>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-4">
                                                            {stepData.authData.accessToken && (
                                                                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                                                                    <h5 className="font-medium text-green-900 dark:text-green-100 mb-2">✓ Token获取成功</h5>
                                                                    <div className="space-y-2">
                                                                        <div>
                                                                            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Access Token</label>
                                                                            <div className="relative">
                                                                                <input
                                                                                    type={showAccessToken ? "text" : "password"}
                                                                                    value={stepData.authData.accessToken}
                                                                                    readOnly
                                                                                    className="w-full px-2 py-1 pr-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-xs font-mono h-16 resize-none"
                                                                                />
                                                                                <button
                                                                                    onClick={() => setShowAccessToken(!showAccessToken)}
                                                                                    className="absolute top-1 right-1 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                                                                >
                                                                                    {showAccessToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Refresh Token</label>
                                                                            <div className="relative">
                                                                                <input
                                                                                    type={showRefreshToken ? "text" : "password"}
                                                                                    value={stepData.authData.refreshToken}
                                                                                    readOnly
                                                                                    className="w-full px-2 py-1 pr-8 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-xs font-mono h-16 resize-none"
                                                                                />
                                                                                <button
                                                                                    onClick={() => setShowRefreshToken(!showRefreshToken)}
                                                                                    className="absolute top-1 right-1 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                                                                >
                                                                                    {showRefreshToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            <button
                                                                onClick={handleGetTokens}
                                                                disabled={loading}
                                                                className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                {loading ? (
                                                                    <>
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                        <span>获取中...</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Shield className="h-4 w-4" />
                                                                        <span>获取Tokens</span>
                                                                    </>
                                                                )}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}

                                    {currentStep === 'email' && (
                                        <motion.div
                                            key="email"
                                            initial={{ opacity: 0, x: 20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -20 }}
                                            transition={{ duration: 0.2 }}
                                            className="w-full max-w-lg"
                                        >
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                                        邮箱地址 *
                                                    </label>
                                                    <input
                                                        type="email"
                                                        value={stepData.authData.email}
                                                        onChange={(e) => setStepData(prev => ({
                                                            ...prev,
                                                            authData: { ...prev.authData, email: e.target.value }
                                                        }))}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                                        placeholder="your.email@outlook.com"
                                                    />
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                        请输入您用于授权的Outlook邮箱地址
                                                    </p>
                                                </div>

                                                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                                                    <h5 className="font-medium text-orange-900 dark:text-orange-100 mb-2">即将完成的配置：</h5>
                                                    <div className="text-sm space-y-1 text-orange-800 dark:text-orange-200">
                                                        <p><span className="font-medium">邮箱：</span> {stepData.authData.email || '待输入'}</p>
                                                        <p><span className="font-medium">Client ID：</span> {THUNDERBIRD_CONFIG.clientId}</p>
                                                        <p><span className="font-medium">Access Token：</span> {stepData.authData.accessToken ? '✓ 已获取' : '未获取'}</p>
                                                        <p><span className="font-medium">Refresh Token：</span> {stepData.authData.refreshToken ? '✓ 已获取' : '未获取'}</p>
                                                    </div>
                                                </div>

                                                <div className="flex space-x-3">
                                                    <button
                                                        onClick={() => setCurrentStep('tokens')}
                                                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                                    >
                                                        <ArrowLeft className="h-4 w-4 inline mr-2" />
                                                        上一步
                                                    </button>
                                                    <button
                                                        onClick={handleCompleteAuth}
                                                        disabled={!stepData.authData.email}
                                                        className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <Mail className="h-4 w-4 inline mr-2" />
                                                        <span>完成授权</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>
                </ModalBody>

                <ModalFooter className="justify-between">
                    <Button variant="outline" onClick={handleClose}>
                        取消
                    </Button>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                        步骤 {currentStepIndex + 1} / {steps.length}
                    </div>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}