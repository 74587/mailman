'use client'

import { useState, useMemo } from 'react'
import { ExternalLink, Copy, Check, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiClient } from '@/lib/api-client'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalTitle,
    ModalDescription
} from '@/components/ui/modal'

interface OAuth2HelpModalProps {
    isOpen: boolean
    onClose: () => void
}

export default function OAuth2HelpModal({ isOpen, onClose }: OAuth2HelpModalProps) {
    const [copiedText, setCopiedText] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState('gmail')

    const callbackUrls = useMemo(() => {
        return {
            gmail: apiClient.getFullUrl('/oauth2/callback/gmail'),
            outlook: apiClient.getFullUrl('/oauth2/callback/outlook')
        }
    }, [])

    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedText(label)
            setTimeout(() => setCopiedText(null), 2000)
        })
    }

    const gmailScopes = [
        'https://mail.google.com/',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
    ]

    const outlookScopes = [
        'https://graph.microsoft.com/mail.read',
        'https://graph.microsoft.com/mail.send',
        'https://graph.microsoft.com/mail.readwrite'
    ]

    const tabs = [
        { id: 'gmail', name: 'Gmail 配置', icon: '📧' },
        { id: 'outlook', name: 'Outlook 配置', icon: '📮' },
        { id: 'faq', name: '常见问题', icon: '❓' }
    ]

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent size="2xl" className="max-h-[90vh] flex flex-col">
                <ModalHeader>
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900/20">
                            <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <ModalTitle>OAuth2 配置指南</ModalTitle>
                            <ModalDescription>
                                详细的 Gmail 和 Outlook OAuth2 配置步骤
                            </ModalDescription>
                        </div>
                    </div>
                </ModalHeader>

                {/* Tab Navigation */}
                <div className="border-b border-gray-200 dark:border-gray-700 px-6 flex-shrink-0">
                    <nav className="flex space-x-8" aria-label="Tabs">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`${activeTab === tab.id
                                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                                    } flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
                            >
                                <span className="text-base">{tab.icon}</span>
                                <span>{tab.name}</span>
                            </button>
                        ))}
                    </nav>
                </div>

                <ModalBody className="flex-1 overflow-y-auto">
                    {activeTab === 'gmail' && (
                        <div className="space-y-6">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/20 dark:border-blue-800">
                                <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                                    📧 Gmail OAuth2 配置
                                </h3>
                                <p className="text-blue-800 dark:text-blue-200 text-sm">
                                    按照以下步骤在 Google Cloud Platform 上创建 OAuth2 应用程序
                                </p>
                            </div>

                            <div className="space-y-4">
                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
                                        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full mr-2 dark:bg-blue-900 dark:text-blue-200">
                                            步骤 1
                                        </span>
                                        创建 Google Cloud Platform 项目
                                    </h4>
                                    <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span>访问 Google Cloud Console</span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => window.open('https://console.cloud.google.com/', '_blank')}
                                                className="h-6 px-2 text-xs"
                                            >
                                                <ExternalLink className="h-3 w-3 mr-1" />
                                                打开
                                            </Button>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span>创建新项目并启用 Gmail API</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
                                        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full mr-2 dark:bg-blue-900 dark:text-blue-200">
                                            步骤 2
                                        </span>
                                        配置 OAuth2 同意屏幕
                                    </h4>
                                    <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span>选择"外部"用户类型（推荐用于测试）</span>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span>填写应用信息（应用名称、用户支持邮箱等）</span>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span>添加授权域（如果是本地测试，可以添加 localhost）</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
                                        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full mr-2 dark:bg-blue-900 dark:text-blue-200">
                                            步骤 3
                                        </span>
                                        创建 OAuth2 凭据
                                    </h4>
                                    <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span>选择"Web 应用程序"类型</span>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span>配置重定向 URI：</span>
                                        </div>
                                        <div className="bg-gray-50 p-3 rounded-md dark:bg-gray-700">
                                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                                                您当前的回调地址（根据访问域名自动生成）：
                                            </p>
                                            <div className="flex items-center space-x-2">
                                                <code className="text-xs bg-gray-100 px-2 py-1 rounded dark:bg-gray-600">
                                                    {callbackUrls.gmail}
                                                </code>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => copyToClipboard(callbackUrls.gmail, 'gmail-callback')}
                                                    className="h-6 w-6 p-0"
                                                >
                                                    {copiedText === 'gmail-callback' ? (
                                                        <Check className="h-3 w-3 text-green-500" />
                                                    ) : (
                                                        <Copy className="h-3 w-3" />
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="border border-red-200 rounded-lg p-4 dark:border-red-700 bg-red-50 dark:bg-red-900/20">
                                    <h4 className="font-medium text-red-900 dark:text-red-100 mb-3 flex items-center">
                                        <span className="bg-red-100 text-red-800 text-xs font-medium px-2.5 py-0.5 rounded-full mr-2 dark:bg-red-900 dark:text-red-200">
                                            重要步骤
                                        </span>
                                        添加测试用户（必需）
                                    </h4>
                                    <div className="space-y-3 text-sm text-red-800 dark:text-red-200">
                                        <p className="font-medium">
                                            ⚠️ 应用无需发布，也无需提交审核，但每个待使用的邮箱都必须添加为测试用户
                                        </p>
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                                            <span>访问测试用户配置页面</span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => window.open('https://console.cloud.google.com/auth/audience', '_blank')}
                                                className="h-6 px-2 text-xs"
                                            >
                                                <ExternalLink className="h-3 w-3 mr-1" />
                                                打开
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
                                        <span className="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded-full mr-2 dark:bg-green-900 dark:text-green-200">
                                            权限范围
                                        </span>
                                        Gmail 必需权限（自动配置）
                                    </h4>
                                    <div className="space-y-2">
                                        {gmailScopes.map((scope, index) => (
                                            <div key={index} className="flex items-center space-x-2">
                                                <Badge variant="secondary" className="text-xs">
                                                    {scope}
                                                </Badge>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => copyToClipboard(scope, `gmail-scope-${index}`)}
                                                    className="h-6 w-6 p-0"
                                                >
                                                    {copiedText === `gmail-scope-${index}` ? (
                                                        <Check className="h-3 w-3 text-green-500" />
                                                    ) : (
                                                        <Copy className="h-3 w-3" />
                                                    )}
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'outlook' && (
                        <div className="space-y-6">
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/20 dark:border-blue-800">
                                <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                                    📮 Outlook OAuth2 配置
                                </h3>
                                <p className="text-blue-800 dark:text-blue-200 text-sm">
                                    按照以下步骤在 Microsoft Azure 上创建 OAuth2 应用程序
                                </p>
                            </div>

                            <div className="space-y-4">
                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
                                        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full mr-2 dark:bg-blue-900 dark:text-blue-200">
                                            步骤 1
                                        </span>
                                        创建 Azure AD 应用程序
                                    </h4>
                                    <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span>访问 Azure Portal</span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => window.open('https://portal.azure.com/', '_blank')}
                                                className="h-6 px-2 text-xs"
                                            >
                                                <ExternalLink className="h-3 w-3 mr-1" />
                                                打开
                                            </Button>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                            <span>搜索"Azure Active Directory"并进入应用注册</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
                                        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full mr-2 dark:bg-blue-900 dark:text-blue-200">
                                            步骤 2
                                        </span>
                                        配置重定向 URI
                                    </h4>
                                    <div className="bg-gray-50 p-3 rounded-md dark:bg-gray-700">
                                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                                            您当前的回调地址：
                                        </p>
                                        <div className="flex items-center space-x-2">
                                            <code className="text-xs bg-gray-100 px-2 py-1 rounded dark:bg-gray-600">
                                                {callbackUrls.outlook}
                                            </code>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => copyToClipboard(callbackUrls.outlook, 'outlook-callback')}
                                                className="h-6 w-6 p-0"
                                            >
                                                {copiedText === 'outlook-callback' ? (
                                                    <Check className="h-3 w-3 text-green-500" />
                                                ) : (
                                                    <Copy className="h-3 w-3" />
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center">
                                        <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full mr-2 dark:bg-blue-900 dark:text-blue-200">
                                            步骤 3
                                        </span>
                                        配置 API 权限
                                    </h4>
                                    <div className="space-y-2 ml-4">
                                        {outlookScopes.map((scope, index) => (
                                            <div key={index} className="flex items-center space-x-2">
                                                <Badge variant="secondary" className="text-xs">
                                                    {scope}
                                                </Badge>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'faq' && (
                        <div className="space-y-6">
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 dark:bg-yellow-900/20 dark:border-yellow-800">
                                <h3 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-2">
                                    ❓ 常见问题解答
                                </h3>
                                <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                                    解答 OAuth2 配置过程中的常见问题
                                </p>
                            </div>

                            <div className="space-y-4">
                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-2">
                                        Q1: 为什么需要配置 OAuth2？
                                    </h4>
                                    <p className="text-sm text-gray-700 dark:text-gray-300">
                                        OAuth2 是一种安全的授权协议，允许第三方应用程序访问用户的邮件账户，而无需存储用户的密码。
                                    </p>
                                </div>

                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-2">
                                        Q2: 重定向 URI 应该设置为什么？
                                    </h4>
                                    <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                                        <li>• Gmail：<code className="bg-gray-100 px-1 rounded dark:bg-gray-600">{callbackUrls.gmail}</code></li>
                                        <li>• Outlook：<code className="bg-gray-100 px-1 rounded dark:bg-gray-600">{callbackUrls.outlook}</code></li>
                                    </ul>
                                </div>

                                <div className="border border-gray-200 rounded-lg p-4 dark:border-gray-700">
                                    <h4 className="font-medium text-gray-900 dark:text-white mb-2">
                                        Q3: 如何处理 OAuth2 token 过期？
                                    </h4>
                                    <p className="text-sm text-gray-700 dark:text-gray-300">
                                        系统会自动使用 refresh token 刷新 access token，无需手动干预。
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </ModalBody>

                <ModalFooter className="flex-shrink-0">
                    <div className="flex items-center justify-between w-full">
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                            💡 需要更多帮助？参考官方文档
                        </div>
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => window.open('https://developers.google.com/identity/protocols/oauth2', '_blank')}
                            >
                                <ExternalLink className="h-4 w-4 mr-1" />
                                Google 文档
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => window.open('https://docs.microsoft.com/en-us/graph/', '_blank')}
                            >
                                <ExternalLink className="h-4 w-4 mr-1" />
                                Microsoft 文档
                            </Button>
                        </div>
                    </div>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}