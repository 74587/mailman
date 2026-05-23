'use client'

import { useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import { useSearchParams, useRouter } from 'next/navigation'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { emailAccountService } from '@/services/email-account.service'
import { oauth2Service } from '@/services/oauth2.service'

export default function OAuth2SuccessPage() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
    const [message, setMessage] = useState('')

    useEffect(() => {
        async function processOAuth2Success() {
            // 检查是否在popup窗口中（新的方式）
            const state = searchParams.get('state')
            if (state && window.opener) {
                // 这是popup授权，直接关闭窗口，让父窗口轮询处理
                setStatus('success')
                setMessage('授权成功，正在处理...')

                // 延迟关闭，给用户看到成功消息
                setTimeout(() => {
                    window.close()
                }, 1000)
                return
            }

            // 旧版本的页面重定向方式处理
            const provider = searchParams.get('provider')
            const accessToken = searchParams.get('access_token')
            const refreshToken = searchParams.get('refresh_token')
            const expiresAt = searchParams.get('expires_at')

            if (!provider || !accessToken || !refreshToken) {
                setStatus('error')
                setMessage('授权信息不完整，请重新授权')
                return
            }

            try {
                // 从URL参数获取邮箱地址（后端已获取）
                let userEmail = searchParams.get('email') || ''

                if (!userEmail) {
                    setStatus('error')
                    setMessage('后端无法获取用户邮箱地址，请检查Google Cloud Console API配置')
                    return
                }

                // 获取Gmail provider信息
                const providers = await emailAccountService.getProviders()
                const gmailProvider = providers.find(p => p.name.toLowerCase().includes('gmail'))

                if (!gmailProvider) {
                    setStatus('error')
                    setMessage('找不到Gmail服务提供商配置')
                    return
                }

                // 获取Gmail全局配置以获取client_id
                let clientId = '';
                try {
                    const gmailGlobalConfig = await oauth2Service.getGlobalConfigByProvider('gmail');
                    clientId = gmailGlobalConfig.client_id || '';
                } catch (error) {
                    console.warn('获取Gmail全局配置失败，将使用空的client_id:', error);
                }

                // 创建OAuth2配置格式（统一使用custom_settings，所有值转为字符串）
                const oauth2Config = {
                    client_id: clientId,
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    expires_at: String(parseInt(expiresAt || '0')),
                    token_type: 'Bearer'
                }

                // 创建邮箱账户（如果已存在会被后端处理）
                try {
                    await emailAccountService.createAccount({
                        email_address: userEmail,
                        auth_type: 'oauth2',
                        mail_provider_id: gmailProvider.id,
                        custom_settings: oauth2Config
                    })
                } catch (createError: any) {
                    // 如果是邮箱已存在，这是正常情况，继续处理
                    if (createError?.message?.includes('UNIQUE constraint failed') ||
                        createError?.message?.includes('已存在') ||
                        createError?.status === 409) {
                        logger.debug('邮箱账户已存在，OAuth2流程仍然成功')
                    } else {
                        // 其他错误才抛出
                        throw createError
                    }
                }

                // 存储token信息到sessionStorage（备用）
                sessionStorage.setItem('oauth2_tokens', JSON.stringify({
                    provider,
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    expires_at: parseInt(expiresAt || '0'),
                    email: userEmail
                }))

                setStatus('success')
                setMessage(`${userEmail} 账户创建成功！`)

                // 3秒后自动返回
                setTimeout(() => {
                    // 清理临时数据
                    sessionStorage.removeItem('oauth2_return_path')
                    sessionStorage.removeItem('oauth2_provider')

                    // 返回邮箱账户管理页面
                    router.push('/main?tab=accounts')
                }, 3000)

            } catch (error) {
                console.error('OAuth2 处理失败:', error)
                setStatus('error')
                setMessage(error instanceof Error ? error.message : '创建账户失败')
            }
        }

        processOAuth2Success()
    }, [searchParams, router])

    const handleReturnNow = () => {
        sessionStorage.removeItem('oauth2_return_path')
        sessionStorage.removeItem('oauth2_provider')

        if (status === 'success') {
            router.push('/main?tab=accounts')
        } else {
            const returnPath = sessionStorage.getItem('oauth2_return_path') || '/'
            router.push(returnPath)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="max-w-md w-full mx-auto p-6">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
                    {status === 'loading' && (
                        <>
                            <Loader2 className="h-16 w-16 text-blue-500 mx-auto mb-4 animate-spin" />
                            <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                                处理授权信息...
                            </h1>
                            <p className="text-gray-600 dark:text-gray-300">
                                请稍候，正在处理您的授权信息
                            </p>
                        </>
                    )}

                    {status === 'success' && (
                        <>
                            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                            <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                                授权成功！
                            </h1>
                            <p className="text-gray-600 dark:text-gray-300 mb-6">
                                {message}
                            </p>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                                3秒后自动返回，或点击下方按钮立即返回
                            </p>
                            <Button onClick={handleReturnNow} className="w-full">
                                立即返回
                            </Button>
                        </>
                    )}

                    {status === 'error' && (
                        <>
                            <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
                            <h1 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                                授权失败
                            </h1>
                            <p className="text-gray-600 dark:text-gray-300 mb-6">
                                {message}
                            </p>
                            <Button onClick={handleReturnNow} variant="outline" className="w-full">
                                返回重试
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}