'use client'

import { useEffect, useState } from 'react'
import { logger } from '@/lib/logger'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle, CircleDotDashed, ExternalLink, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { emailAccountService } from '@/services/email-account.service'
import { oauth2Service } from '@/services/oauth2.service'

type SuccessMode = 'popup' | 'manual' | 'legacy'

const getProviderDisplayName = (provider: string) => {
    switch (provider.toLowerCase()) {
        case 'gmail':
            return 'Gmail'
        case 'outlook':
            return 'Outlook'
        default:
            return provider || '邮箱'
    }
}

export default function OAuth2SuccessPage() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
    const [message, setMessage] = useState('')
    const [mode, setMode] = useState<SuccessMode>('manual')
    const [providerName, setProviderName] = useState('邮箱')

    useEffect(() => {
        async function processOAuth2Success() {
            const state = searchParams.get('state')
            const provider = searchParams.get('provider') || ''
            setProviderName(getProviderDisplayName(provider))

            // 新版后端会在callback中处理token并通过state让原页面轮询结果。
            // 复制授权链接到另一个浏览器时没有window.opener，成功页必须停留给用户确认。
            if (state) {
                const isPopup = Boolean(window.opener)
                setMode(isPopup ? 'popup' : 'manual')
                setStatus('success')
                setMessage(isPopup ? '授权成功，窗口将自动关闭。' : '授权成功，请回到原浏览器继续完成账户创建。')

                if (isPopup) {
                    setTimeout(() => {
                        window.close()
                    }, 1200)
                }

                return
            }

            // 旧版本的页面重定向方式处理
            const accessToken = searchParams.get('access_token')
            const refreshToken = searchParams.get('refresh_token')
            const expiresAt = searchParams.get('expires_at')

            setMode('legacy')

            if (!provider || !accessToken || !refreshToken) {
                setStatus('error')
                setMessage('授权信息不完整，请重新授权。')
                return
            }

            try {
                const userEmail = searchParams.get('email') || ''

                if (!userEmail) {
                    setStatus('error')
                    setMessage('后端无法获取用户邮箱地址，请检查OAuth2配置。')
                    return
                }

                const providers = await emailAccountService.getProviders()
                const gmailProvider = providers.find(p => p.name.toLowerCase().includes('gmail'))

                if (!gmailProvider) {
                    setStatus('error')
                    setMessage('找不到Gmail服务提供商配置。')
                    return
                }

                let clientId = ''
                try {
                    const gmailGlobalConfig = await oauth2Service.getGlobalConfigByProvider('gmail')
                    clientId = gmailGlobalConfig.client_id || ''
                } catch (error) {
                    console.warn('获取Gmail全局配置失败，将使用空的client_id:', error)
                }

                const oauth2Config = {
                    client_id: clientId,
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    expires_at: String(parseInt(expiresAt || '0')),
                    token_type: 'Bearer'
                }

                try {
                    await emailAccountService.createAccount({
                        email_address: userEmail,
                        auth_type: 'oauth2',
                        mail_provider_id: gmailProvider.id,
                        custom_settings: oauth2Config
                    })
                } catch (createError: any) {
                    if (createError?.message?.includes('UNIQUE constraint failed') ||
                        createError?.message?.includes('已存在') ||
                        createError?.status === 409) {
                        logger.debug('邮箱账户已存在，OAuth2流程仍然成功')
                    } else {
                        throw createError
                    }
                }

                sessionStorage.setItem('oauth2_tokens', JSON.stringify({
                    provider,
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    expires_at: parseInt(expiresAt || '0'),
                    email: userEmail
                }))

                setStatus('success')
                setMessage(`${userEmail} 账户创建成功。`)
            } catch (error) {
                console.error('OAuth2 处理失败:', error)
                setStatus('error')
                setMessage(error instanceof Error ? error.message : '创建账户失败。')
            }
        }

        processOAuth2Success()
    }, [searchParams])

    const handleReturnNow = () => {
        sessionStorage.removeItem('oauth2_return_path')
        sessionStorage.removeItem('oauth2_provider')
        router.push('/main?tab=accounts')
    }

    const handleClose = () => {
        window.close()
    }

    return (
        <main className="min-h-screen bg-slate-950 text-white">
            <div className="absolute inset-x-0 top-0 h-1 bg-teal-400" />
            <div className="relative mx-auto flex min-h-screen w-full max-w-4xl items-center justify-center px-5 py-10">
                <section className="w-full overflow-hidden rounded-lg border border-white/10 bg-white/[0.06] shadow-2xl backdrop-blur">
                    <div className="grid gap-0 md:grid-cols-[0.9fr_1.1fr]">
                        <div className="border-b border-white/10 bg-white/[0.04] p-8 md:border-b-0 md:border-r">
                            <div className="mb-8 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-teal-400/15 text-teal-200">
                                <ShieldCheck className="h-6 w-6" />
                            </div>
                            <h1 className="text-2xl font-semibold tracking-normal text-white">
                                {status === 'error' ? '授权未完成' : `${providerName} 授权完成`}
                            </h1>
                            <p className="mt-3 text-sm leading-6 text-slate-300">
                                {status === 'loading' && '正在确认授权结果，请稍候。'}
                                {status === 'success' && mode === 'popup' && '这个窗口会自动关闭，原页面会继续完成账户创建。'}
                                {status === 'success' && mode === 'manual' && '你是在另一个浏览器或标签页完成的授权，原浏览器中的 Mailman 页面会继续轮询授权结果。'}
                                {status === 'success' && mode === 'legacy' && '账户信息已处理完成，可以返回 Mailman 查看账户列表。'}
                                {status === 'error' && '授权信息没有完整返回，请重新从 Mailman 发起授权。'}
                            </p>
                        </div>

                        <div className="p-8">
                            <div className="mb-6 flex items-start gap-4">
                                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${
                                    status === 'error' ? 'bg-red-500/15 text-red-200' :
                                        status === 'loading' ? 'bg-blue-500/15 text-blue-200' :
                                            'bg-emerald-500/15 text-emerald-200'
                                }`}>
                                    {status === 'loading' && <CircleDotDashed className="h-6 w-6 animate-spin" />}
                                    {status === 'success' && <CheckCircle className="h-6 w-6" />}
                                    {status === 'error' && <X className="h-6 w-6" />}
                                </div>
                                <div>
                                    <h2 className="text-lg font-medium text-white">
                                        {status === 'loading' && '正在处理授权'}
                                        {status === 'success' && '授权成功'}
                                        {status === 'error' && '需要重新授权'}
                                    </h2>
                                    <p className="mt-1 text-sm leading-6 text-slate-300">
                                        {message}
                                    </p>
                                </div>
                            </div>

                            {status === 'success' && mode === 'manual' && (
                                <div className="rounded-lg border border-teal-300/20 bg-teal-300/10 p-4 text-sm leading-6 text-teal-50">
                                    保持原浏览器里的添加账户窗口打开，授权结果会自动同步过去。如果原窗口已经关闭，请重新打开添加账户流程。
                                </div>
                            )}

                            {status === 'success' && mode === 'popup' && (
                                <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm leading-6 text-emerald-50">
                                    如果窗口没有自动关闭，可以手动关闭此页面。
                                </div>
                            )}

                            {status === 'error' && (
                                <div className="rounded-lg border border-red-300/20 bg-red-300/10 p-4 text-sm leading-6 text-red-50">
                                    请回到 Mailman 中重新生成授权链接。旧的 Google 授权码只能使用一次，复制失败后的链接不能重复使用。
                                </div>
                            )}

                            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                                {status === 'success' && mode === 'popup' && (
                                    <Button onClick={handleClose} className="bg-teal-500 text-slate-950 hover:bg-teal-400">
                                        <X className="mr-2 h-4 w-4" />
                                        关闭窗口
                                    </Button>
                                )}
                                {status === 'success' && mode === 'legacy' && (
                                    <Button onClick={handleReturnNow} className="bg-teal-500 text-slate-950 hover:bg-teal-400">
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        返回账户列表
                                    </Button>
                                )}
                                {status === 'success' && mode === 'manual' && (
                                    <Button onClick={handleClose} className="bg-teal-500 text-slate-950 hover:bg-teal-400">
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        我知道了
                                    </Button>
                                )}
                                {status === 'error' && (
                                    <Button onClick={handleReturnNow} variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10">
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        返回 Mailman
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </main>
    )
}
