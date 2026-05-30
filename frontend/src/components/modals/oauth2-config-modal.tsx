'use client'

import { useCallback, useState, useEffect } from 'react'
import { X, Plus, AlertCircle, CheckCircle, HelpCircle, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { oauth2Service } from '@/services/oauth2.service'
import { OAuth2GlobalConfig, OAuth2ProviderType, CreateOAuth2ConfigRequest } from '@/types'
import OAuth2HelpModal from './oauth2-help-modal'
import { toast } from 'sonner'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalTitle,
    ModalDescription
} from '@/components/ui/modal'

const getCorrectRedirectUri = (provider: OAuth2ProviderType): string => {
    const backendUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'
    return `${backendUrl}/api/oauth2/callback/${provider}`
}

const ConfigGuideTooltip = ({ provider, isVisible, onClose }: { provider: OAuth2ProviderType, isVisible: boolean, onClose: () => void }) => {
    const getConfigGuide = (provider: OAuth2ProviderType) => {
        const redirectUri = getCorrectRedirectUri(provider)

        if (provider === 'gmail') {
            return {
                title: 'Google Cloud Console 配置指导',
                steps: [
                    '1. 访问 Google Cloud Console',
                    '2. 创建或选择一个项目',
                    '3. 启用 Gmail API',
                    '4. 创建 OAuth 2.0 客户端 ID',
                    '5. 在"Authorized redirect URIs"中添加：',
                    redirectUri,
                ],
                redirectUri,
                docsUrl: 'https://developers.google.com/gmail/api/quickstart/nodejs'
            }
        } else if (provider === 'outlook') {
            return {
                title: 'Microsoft Azure 配置指导',
                steps: [
                    '1. 访问 Azure Portal',
                    '2. 注册新的应用程序',
                    '3. 配置 API 权限',
                    '4. 在"重定向URI"中添加：',
                    redirectUri,
                ],
                redirectUri,
                docsUrl: 'https://docs.microsoft.com/en-us/graph/auth-v2-user'
            }
        }
        return null
    }

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text)
            toast.success('回调地址已复制到剪贴板')
        } catch (err) {
            toast.error('复制失败')
        }
    }

    const guide = getConfigGuide(provider)
    if (!guide || !isVisible) return null

    return (
        <div className="absolute z-50 w-80 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
            <div className="flex items-start justify-between mb-3">
                <h4 className="font-medium text-gray-900 dark:text-gray-100">{guide.title}</h4>
                <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700">
                    <X className="h-4 w-4" />
                </button>
            </div>
            <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                {guide.steps.map((step, index) => (
                    <div key={index} className={step === guide.redirectUri ? "font-mono bg-gray-100 dark:bg-gray-700 p-2 rounded flex items-start gap-2" : ""}>
                        {step === guide.redirectUri ? (
                            <div className="flex-1 min-w-0">
                                <div className="break-all text-xs leading-relaxed">{step}</div>
                            </div>
                        ) : (
                            <span>{step}</span>
                        )}
                        {step === guide.redirectUri && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => copyToClipboard(step)} className="h-6 p-1">
                                <Copy className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                ))}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <a href={guide.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
                    查看官方文档 <ExternalLink className="h-3 w-3" />
                </a>
            </div>
        </div>
    )
}

interface OAuth2ConfigModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    config?: OAuth2GlobalConfig | null
    defaultProvider?: OAuth2ProviderType
}

export default function OAuth2ConfigModal({ isOpen, onClose, onSuccess, config, defaultProvider = 'gmail' }: OAuth2ConfigModalProps) {
    const [name, setName] = useState('')
    const [provider, setProvider] = useState<OAuth2ProviderType>('gmail')
    const [clientId, setClientId] = useState('')
    const [clientSecret, setClientSecret] = useState('')
    const [redirectUri, setRedirectUri] = useState('')
    const [scopes, setScopes] = useState<string[]>([])
    const [customScope, setCustomScope] = useState('')
    const [enabled, setEnabled] = useState(true)
    const [isDefault, setIsDefault] = useState(false)
    const [jsonConfig, setJsonConfig] = useState('')
    const [showJsonInput, setShowJsonInput] = useState(false)
    const [showConfigGuideTooltip, setShowConfigGuideTooltip] = useState(false)
    const [showHelpModal, setShowHelpModal] = useState(false)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [validationErrors, setValidationErrors] = useState<string[]>([])

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text)
            toast.success('已复制到剪贴板')
        } catch (err) {
            toast.error('复制失败')
        }
    }

    const resetForm = useCallback((nextProvider: OAuth2ProviderType = defaultProvider) => {
        setName('')
        setProvider(nextProvider)
        setClientId('')
        setClientSecret('')
        setRedirectUri(getCorrectRedirectUri(nextProvider))
        setScopes(oauth2Service.getDefaultScopes(nextProvider))
        setCustomScope('')
        setEnabled(true)
        setIsDefault(false)
        setJsonConfig('')
        setShowJsonInput(false)
        setShowConfigGuideTooltip(false)
        setError('')
        setValidationErrors([])
    }, [defaultProvider])

    const parseGmailJson = (jsonText: string) => {
        try {
            const parsed = JSON.parse(jsonText)
            const webConfig = parsed.web || parsed
            if (webConfig.client_id) setClientId(webConfig.client_id)
            if (webConfig.client_secret) setClientSecret(webConfig.client_secret)
            if (webConfig.redirect_uris?.length > 0) setRedirectUri(webConfig.redirect_uris[0])
            setScopes(oauth2Service.getGmailProtectedScopes())
            setError('')
            setValidationErrors([])
            return true
        } catch (err) {
            setError('JSON格式错误')
            return false
        }
    }

    const handleJsonImport = () => {
        if (!jsonConfig.trim()) {
            setError('请输入JSON配置')
            return
        }
        if (parseGmailJson(jsonConfig)) {
            setShowJsonInput(false)
            setJsonConfig('')
        }
    }

    useEffect(() => {
        if (isOpen) {
            if (config) {
                setName(config.name)
                setProvider(config.provider_type)
                setClientId(config.client_id)
                setClientSecret(config.client_secret)
                setRedirectUri(config.redirect_uri)
                setScopes(config.scopes)
                setEnabled(config.is_enabled)
                setIsDefault(!!config.is_default)
            } else {
                resetForm(defaultProvider)
            }
        }
    }, [isOpen, config, defaultProvider, resetForm])

    useEffect(() => {
        if (!config) {
            setScopes(oauth2Service.getDefaultScopes(provider))
            setRedirectUri(getCorrectRedirectUri(provider))
        }
    }, [provider, config])

    useEffect(() => {
        if (provider === 'gmail') {
            setScopes(oauth2Service.getGmailProtectedScopes())
        }
    }, [provider])

    const validateForm = () => {
        const configData: CreateOAuth2ConfigRequest = {
            name, provider_type: provider, client_id: clientId, client_secret: clientSecret,
            redirect_uri: redirectUri, scopes, is_enabled: enabled, is_default: isDefault
        }
        const validation = oauth2Service.validateConfig(configData)
        setValidationErrors(validation.errors)
        return validation.valid
    }

    const addCustomScope = () => {
        if (provider === 'gmail') return
        if (customScope.trim() && !scopes.includes(customScope.trim())) {
            setScopes([...scopes, customScope.trim()])
            setCustomScope('')
        }
    }

    const removeScope = (index: number) => {
        if (provider === 'gmail') return
        setScopes(scopes.filter((_, i) => i !== index))
    }

    const handleSubmit = async () => {
        if (!validateForm()) return

        setLoading(true)
        setError('')

        try {
            const configData: CreateOAuth2ConfigRequest = {
                name, provider_type: provider, client_id: clientId, client_secret: clientSecret,
                redirect_uri: redirectUri, scopes, is_enabled: enabled, is_default: isDefault
            }
            if (config?.id) (configData as any).id = config.id
            await oauth2Service.createOrUpdateGlobalConfig(configData)
            onSuccess()
            onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : '保存配置失败')
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <ModalContent size="xl" className="max-h-[90vh] flex flex-col">
                    <ModalHeader>
                        <div className="flex items-center justify-between w-full">
                            <div>
                                <ModalTitle>{config ? '编辑OAuth2配置' : '添加OAuth2配置'}</ModalTitle>
                                <ModalDescription>配置邮箱OAuth2认证参数</ModalDescription>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setShowHelpModal(true)} className="text-blue-600">
                                <HelpCircle className="h-4 w-4 mr-1" />配置指南
                            </Button>
                        </div>
                    </ModalHeader>

                    <ModalBody className="flex-1 overflow-y-auto space-y-6">
                        {error && (
                            <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                                <div className="flex">
                                    <AlertCircle className="h-5 w-5 text-red-400" />
                                    <div className="ml-3 text-sm font-medium text-red-800 dark:text-red-200">{error}</div>
                                </div>
                            </div>
                        )}

                        {validationErrors.length > 0 && (
                            <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
                                <div className="flex">
                                    <AlertCircle className="h-5 w-5 text-red-400" />
                                    <div className="ml-3">
                                        <h3 className="text-sm font-medium text-red-800 dark:text-red-200">请修正以下错误：</h3>
                                        <ul className="mt-2 text-sm text-red-700 dark:text-red-300">
                                            {validationErrors.map((err, index) => (
                                                <li key={index} className="list-disc list-inside">{err}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>配置名称 *</Label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：Gmail生产配置" />
                        </div>

                        <div className="space-y-2">
                            <Label>邮箱提供商</Label>
                            <Select value={provider} onValueChange={(value) => setProvider(value as OAuth2ProviderType)} disabled={!!config}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {oauth2Service.getSupportedProviders().map((p) => (
                                        <SelectItem key={p} value={p}>{oauth2Service.getProviderDisplayName(p)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {provider === 'gmail' && !config && (
                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="text-sm font-medium">快速配置</h4>
                                        <p className="text-xs text-gray-500">从Gmail控制台下载的JSON导入</p>
                                    </div>
                                    <Button type="button" variant="outline" size="sm" onClick={() => setShowJsonInput(!showJsonInput)}>
                                        {showJsonInput ? '隐藏' : '导入JSON'}
                                    </Button>
                                </div>
                                {showJsonInput && (
                                    <div className="mt-4 space-y-3">
                                        <Textarea value={jsonConfig} onChange={(e) => setJsonConfig(e.target.value)} placeholder="粘贴JSON配置..." rows={4} />
                                        <div className="flex justify-end">
                                            <Button type="button" variant="outline" size="sm" onClick={handleJsonImport}>解析并导入</Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>客户端 ID *</Label>
                            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="输入客户端ID" />
                        </div>

                        <div className="space-y-2">
                            <Label>客户端密钥 *</Label>
                            <Input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="输入客户端密钥" />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Label>重定向 URI *</Label>
                                <div className="relative">
                                    <button type="button" onClick={() => setShowConfigGuideTooltip(!showConfigGuideTooltip)} className="p-1 rounded-full hover:bg-gray-100">
                                        <HelpCircle className="h-4 w-4 text-gray-500" />
                                    </button>
                                    <ConfigGuideTooltip provider={provider} isVisible={showConfigGuideTooltip} onClose={() => setShowConfigGuideTooltip(false)} />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Input value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} readOnly={!config} className={!config ? "bg-gray-50" : ""} />
                                {!config && (
                                    <Button type="button" variant="outline" size="sm" onClick={() => copyToClipboard(redirectUri)}>
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>权限范围</Label>
                                {provider === 'gmail' && (
                                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">Gmail受保护</Badge>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {scopes.map((scope, index) => (
                                    <Badge key={index} variant="secondary" className="flex items-center gap-1">
                                        {scope}
                                        {provider !== 'gmail' && (
                                            <button type="button" onClick={() => removeScope(index)} className="ml-1 p-0.5 hover:bg-gray-200 rounded-full">
                                                <X className="h-3 w-3" />
                                            </button>
                                        )}
                                    </Badge>
                                ))}
                            </div>
                            {provider !== 'gmail' && (
                                <div className="flex gap-2">
                                    <Input value={customScope} onChange={(e) => setCustomScope(e.target.value)} placeholder="添加自定义权限范围" onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomScope())} />
                                    <Button type="button" variant="outline" onClick={addCustomScope} disabled={!customScope.trim()}>
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="grid gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <Label htmlFor="enabled">启用此配置</Label>
                                    <p className="mt-1 text-xs text-gray-500">关闭后创建邮箱账户时不会被自动选择。</p>
                                </div>
                                <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <Label htmlFor="default">设为默认凭证</Label>
                                    <p className="mt-1 text-xs text-gray-500">同一邮箱提供商只保留一套默认 OAuth2 凭证。</p>
                                </div>
                                <Switch id="default" checked={isDefault} onCheckedChange={setIsDefault} />
                            </div>
                        </div>
                    </ModalBody>

                    <ModalFooter>
                        <Button variant="outline" onClick={onClose} disabled={loading}>取消</Button>
                        <Button onClick={handleSubmit} disabled={loading}>
                            {loading ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />保存中...</>
                            ) : (
                                <><CheckCircle className="mr-2 h-4 w-4" />{config ? '更新配置' : '创建配置'}</>
                            )}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <OAuth2HelpModal isOpen={showHelpModal} onClose={() => setShowHelpModal(false)} />
        </>
    )
}
