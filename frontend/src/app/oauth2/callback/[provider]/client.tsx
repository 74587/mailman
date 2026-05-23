'use client'

import { useSearchParams, useRouter, useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, XCircle, Loader2, ArrowLeft } from "lucide-react"
import { oauth2Service } from '@/services/oauth2.service'
import { OAuth2ProviderType } from '@/types'

export default function OAuth2CallbackClient() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const params = useParams()
    const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
    const [error, setError] = useState<string | null>(null)
    const [tokenData, setTokenData] = useState<any>(null)

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const errorParam = searchParams.get('error')

    // 从路由参数中获取provider
    const provider = params.provider as OAuth2ProviderType

    useEffect(() => {
        handleCallback()
    }, [code, state, errorParam, provider])

    const handleCallback = async () => {
        try {
            // 检查是否有错误参数
            if (errorParam) {
                setError(`OAuth2授权失败: ${errorParam}`)
                setStatus('error')
                return
            }

            // 检查必需参数
            if (!code || !state) {
                setError('缺少必需的OAuth2回调参数 (code 或 state)')
                setStatus('error')
                return
            }

            if (!provider) {
                setError('缺少 provider 参数，请检查回调URL路径')
                setStatus('error')
                return
            }

            // 验证状态参数
            const savedState = localStorage.getItem('oauth2_state')
            if (state !== savedState) {
                setError('无效的状态参数，可能存在CSRF攻击')
                setStatus('error')
                return
            }

            // 清除状态参数
            localStorage.removeItem('oauth2_state')

            // 处理OAuth2回调
            const tokenResponse = await oauth2Service.handleCallback(provider, code, state)

            setTokenData(tokenResponse)
            setStatus('success')

            // 将令牌信息存储到sessionStorage供后续使用
            sessionStorage.setItem('oauth2_tokens', JSON.stringify({
                provider,
                access_token: tokenResponse.access_token,
                refresh_token: tokenResponse.refresh_token,
                expires_in: tokenResponse.expires_in,
                token_type: tokenResponse.token_type
            }))

            // 3秒后自动跳转到邮箱账户创建页面
            setTimeout(() => {
                router.push('/main?tab=emails&action=create&auth_type=oauth2')
            }, 3000)

        } catch (err) {
            console.error('OAuth2 callback error:', err)
            setError(err instanceof Error ? err.message : 'OAuth2回调处理失败')
            setStatus('error')
        }
    }

    const handleRetry = () => {
        router.push('/main?tab=oauth2-config')
    }

    const handleContinue = () => {
        router.push('/main?tab=emails&action=create&auth_type=oauth2')
    }

    const getProviderDisplayName = (provider: OAuth2ProviderType) => {
        switch (provider) {
            case 'gmail':
                return 'Gmail'
            case 'outlook':
                return 'Outlook'
            default:
                return provider
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        {status === 'processing' && <Loader2 className="h-5 w-5 animate-spin" />}
                        {status === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
                        {status === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
                        OAuth2 授权回调
                    </CardTitle>
                    <CardDescription>
                        {status === 'processing' && '正在处理OAuth2授权回调...'}
                        {status === 'success' && `${getProviderDisplayName(provider || 'gmail')} 授权成功`}
                        {status === 'error' && 'OAuth2授权失败'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {status === 'processing' && (
                        <div className="flex items-center justify-center py-8">
                            <div className="text-center">
                                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
                                <p className="text-gray-600">正在处理授权信息...</p>
                            </div>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="space-y-4">
                            <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                                <p className="text-green-700 font-medium">授权成功！</p>
                                <p className="text-green-600 text-sm mt-1">
                                    已成功获取 {getProviderDisplayName(provider || 'gmail')} 的访问令牌
                                </p>
                            </div>

                            {tokenData && (
                                <div className="text-sm text-gray-600 space-y-1">
                                    <p><strong>令牌类型:</strong> {tokenData.token_type}</p>
                                    <p><strong>作用域:</strong> {tokenData.scope || '默认作用域'}</p>
                                    <p><strong>过期时间:</strong> {tokenData.expires_in} 秒</p>
                                </div>
                            )}

                            <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
                                <p className="text-blue-700 text-sm">
                                    系统将在3秒后自动跳转到邮箱账户创建页面，或者您可以点击下方按钮立即继续。
                                </p>
                            </div>

                            <Button onClick={handleContinue} className="w-full">
                                立即创建邮箱账户
                            </Button>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="space-y-4">
                            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                                <p className="text-red-700 font-medium">授权失败</p>
                                <p className="text-red-600 text-sm mt-1">{error}</p>
                            </div>

                            <div className="text-sm text-gray-600">
                                <p>可能的解决方案：</p>
                                <ul className="list-disc list-inside mt-2 space-y-1">
                                    <li>检查OAuth2配置是否正确</li>
                                    <li>确认回调URL配置正确</li>
                                    <li>检查客户端ID和密钥</li>
                                    <li>重新尝试授权流程</li>
                                </ul>
                            </div>

                            <div className="flex gap-2">
                                <Button onClick={handleRetry} className="flex-1">
                                    重新配置
                                </Button>
                                <Button onClick={() => router.push('/main')} variant="outline" className="flex-1">
                                    <ArrowLeft className="h-4 w-4 mr-2" />
                                    返回主页
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
