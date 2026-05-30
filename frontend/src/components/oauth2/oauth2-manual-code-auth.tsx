'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Copy, ExternalLink, Loader2, ShieldCheck, X } from 'lucide-react'
import { oauth2Service, ManualOAuth2SessionStartResponse } from '@/services/oauth2.service'
import { Button } from '@/components/ui/button'
import {
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalTitle,
    ModalDescription,
} from '@/components/ui/modal'
import { ProviderLogo } from '@/components/ui/provider-logo'
import { getProviderMetadata } from '@/lib/provider-metadata'

interface OAuth2ManualCodeAuthProps {
    provider: string
    configId?: number
    onSuccess: (result: { emailAddress: string; customSettings: any }) => void
    onCancel: () => void
    onError: (error: string) => void
}

function parseCodeInput(input: string): { code: string; state?: string; isUrl: boolean } {
    const value = input.trim()
    if (!value) {
        return { code: '', isUrl: false }
    }

    try {
        const url = new URL(value)
        return {
            code: url.searchParams.get('code') || '',
            state: url.searchParams.get('state') || undefined,
            isUrl: true,
        }
    } catch {
        if (value.includes('code=')) {
            const queryText = value.includes('?') ? value.slice(value.indexOf('?') + 1) : value
            const params = new URLSearchParams(queryText.split('#')[0])
            return {
                code: params.get('code') || '',
                state: params.get('state') || undefined,
                isUrl: true,
            }
        }
        return { code: value, isUrl: false }
    }
}

export default function OAuth2ManualCodeAuth({
    provider,
    configId,
    onSuccess,
    onCancel,
    onError,
}: OAuth2ManualCodeAuthProps) {
    const metadata = getProviderMetadata(provider)
    const [session, setSession] = useState<ManualOAuth2SessionStartResponse | null>(null)
    const [callbackInput, setCallbackInput] = useState('')
    const [loading, setLoading] = useState(true)
    const [exchanging, setExchanging] = useState(false)
    const [copied, setCopied] = useState(false)
    const parsedInput = useMemo(() => parseCodeInput(callbackInput), [callbackInput])

    useEffect(() => {
        let cancelled = false

        const start = async () => {
            try {
                setLoading(true)
                const nextSession = await oauth2Service.startManualAuthSession(provider, configId)
                if (!cancelled) {
                    setSession(nextSession)
                }
            } catch (error: any) {
                if (!cancelled) {
                    onError(error.message || '创建手动授权会话失败')
                    onCancel()
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        start()
        return () => {
            cancelled = true
        }
    }, [configId, onCancel, onError, provider])

    const copyAuthUrl = async () => {
        if (!session?.authUrl) return
        try {
            await navigator.clipboard.writeText(session.authUrl)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1000)
        } catch {
            onError('复制授权链接失败')
        }
    }

    const openAuthUrl = () => {
        if (!session?.authUrl) return
        window.open(session.authUrl, '_blank', 'noopener,noreferrer')
    }

    const handleCancel = async () => {
        if (session?.state) {
            try {
                await oauth2Service.cancelAuthSession(session.state)
            } catch {
                // The session may already be expired or completed.
            }
        }
        onCancel()
    }

    const exchangeCode = async () => {
        if (!session) return
        if (!parsedInput.code) {
            onError('请粘贴完整回调 URL 或授权码')
            return
        }
        if (parsedInput.state && parsedInput.state !== session.state) {
            onError('回调 URL 中的 state 与当前授权会话不匹配')
            return
        }

        try {
            setExchanging(true)
            const response = await oauth2Service.exchangeManualAuthCode(session.state, {
                code: parsedInput.isUrl ? undefined : parsedInput.code,
                callbackUrl: parsedInput.isUrl ? callbackInput : undefined,
                redirectUri: session.redirectUri,
            })
            if (!response.customSettings) {
                throw new Error(response.errorMsg || '授权成功但没有返回 OAuth2 数据')
            }
            onSuccess({
                emailAddress: response.emailAddress || '',
                customSettings: response.customSettings,
            })
        } catch (error: any) {
            onError(error.message || '授权码换取 Token 失败')
        } finally {
            setExchanging(false)
        }
    }

    return (
        <Modal open onOpenChange={(open) => !open && handleCancel()}>
            <ModalContent size="lg" className="max-w-2xl">
                <ModalHeader>
                    <div className="flex items-center gap-3">
                        <ProviderLogo provider={provider} size="md" />
                        <div>
                            <ModalTitle>{metadata.displayName} 手动授权</ModalTitle>
                            <ModalDescription>复制授权链接，在浏览器完成登录后粘贴回调 URL 或 code。</ModalDescription>
                        </div>
                    </div>
                </ModalHeader>
                <ModalBody className="space-y-5">
                    {loading ? (
                        <div className="flex items-center justify-center rounded-lg border border-gray-200 py-10 text-sm text-gray-500 dark:border-gray-700">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            正在创建授权会话
                        </div>
                    ) : session ? (
                        <>
                            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-100">
                                <div className="flex items-start gap-2">
                                    <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" />
                                    <div>
                                        <div className="font-medium">回调地址：{session.redirectUri}</div>
                                        <div className="mt-1 text-xs opacity-80">
                                            授权完成后浏览器会停在这个地址，把地址栏里的完整 URL 粘贴回来即可。
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">授权链接</label>
                                <textarea
                                    readOnly
                                    value={session.authUrl}
                                    rows={4}
                                    className="w-full resize-none rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                                />
                                <div className="flex flex-wrap gap-2">
                                    <Button type="button" variant="outline" onClick={copyAuthUrl}>
                                        {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                                        {copied ? '已复制' : '复制链接'}
                                    </Button>
                                    <Button type="button" onClick={openAuthUrl}>
                                        <ExternalLink className="mr-2 h-4 w-4" />
                                        打开授权页面
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-200">回调 URL 或授权码</label>
                                <textarea
                                    value={callbackInput}
                                    onChange={(event) => setCallbackInput(event.target.value)}
                                    rows={5}
                                    placeholder={`${session.redirectUri}?code=...&state=...`}
                                    className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                                />
                                {callbackInput && !parsedInput.code && (
                                    <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                                        <AlertCircle className="h-3.5 w-3.5" />
                                        没有识别到 code 参数
                                    </div>
                                )}
                            </div>
                        </>
                    ) : null}
                </ModalBody>
                <ModalFooter>
                    <Button type="button" variant="outline" onClick={handleCancel} disabled={exchanging}>
                        <X className="mr-2 h-4 w-4" />
                        取消
                    </Button>
                    <Button type="button" onClick={exchangeCode} disabled={!session || exchanging || !parsedInput.code}>
                        {exchanging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {exchanging ? '换取 Token...' : '完成授权'}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}
