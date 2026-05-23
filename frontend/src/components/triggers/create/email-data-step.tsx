'use client'

import React, { useState, useCallback, useEffect, useMemo } from 'react'
import {
    Search,
    Mail,
    Edit,
    Check,
    Paperclip,
    RefreshCw,
    FileJson,
    Calendar,
    User,
    ChevronRight,
    ArrowLeft,
    Filter,
    Wand2,
    FileCode,
    Inbox
} from 'lucide-react'
import { Email } from '@/types'
import { emailService } from '@/services/email.service'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

// 随机数据生成工具函数
const randomId = () => Math.floor(Math.random() * 10000) + 1
const randomString = (prefix: string = '') => `${prefix}${Math.random().toString(36).substring(2, 10)}`
const randomEmail = () => `${randomString('user_')}@${['gmail.com', 'outlook.com', 'yahoo.com', 'example.com'][Math.floor(Math.random() * 4)]}`
const randomSubject = () => [
    'Important: Your Account Update Required',
    'Welcome to Our Service! 🎉',
    'Your Weekly Newsletter',
    'Order Confirmation #' + randomId(),
    'Meeting Reminder: Tomorrow at 3 PM',
    'Don\'t miss our special offer!',
    'Password Reset Request',
    'Thank you for your purchase!',
    'New Feature Announcement',
    'Your Invoice is Ready'
][Math.floor(Math.random() * 10)]
const randomBody = () => [
    'Thank you for using our service. Please find the details below...',
    'Hi there! We\'re excited to share some news with you...',
    'This is a reminder about your upcoming appointment...',
    'Your recent order has been processed successfully...',
    'We noticed some unusual activity on your account...',
    'Here\'s your weekly summary report...',
    'Don\'t forget to complete your profile setup...',
    'A new version of our app is now available!'
][Math.floor(Math.random() * 8)]
const randomDate = () => {
    const d = new Date()
    d.setDate(d.getDate() - Math.floor(Math.random() * 30))
    return d.toISOString()
}
const randomFlags = () => {
    const allFlags = ['UNREAD', 'CATEGORY_UPDATES', 'INBOX', 'STARRED', 'IMPORTANT', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL']
    const count = Math.floor(Math.random() * 3) + 1
    return allFlags.slice(0, count)
}

// 生成完整邮件对象
const generateFullEmailJson = () => {
    const id = randomId()
    const date = randomDate()
    const senderEmail = randomEmail()
    const senderName = randomString('Sender_')

    return {
        ID: id,
        MessageID: `<${randomString()}@mail.${['gmail', 'outlook', 'example'][Math.floor(Math.random() * 3)]}.com>`,
        AccountID: Math.floor(Math.random() * 5) + 1,
        Account: {
            id: 0,
            emailAddress: "",
            authType: "",
            isDomainMail: false,
            customSettings: null,
            isVerified: false,
            errorStatus: "",
            errorMessage: "",
            errorCount: 0,
            createdAt: "0001-01-01T00:00:00Z",
            updatedAt: "0001-01-01T00:00:00Z",
            deletedAt: {
                time: "0001-01-01T00:00:00Z",
                valid: false
            }
        },
        Subject: randomSubject(),
        From: [`${senderName} <${senderEmail}>`],
        To: [randomEmail()],
        Cc: Math.random() > 0.7 ? [randomEmail()] : null,
        Bcc: null,
        Date: date,
        ReceivedAt: date,
        Body: randomBody(),
        TextBody: "",
        HTMLBody: "",
        RawMessage: "",
        InReplyTo: "",
        References: null,
        Headers: {},
        Attachments: null,
        HasAttachments: Math.random() > 0.8,
        MailboxName: "INBOX",
        Flags: randomFlags(),
        Size: Math.floor(Math.random() * 50000) + 1000,
        CreatedAt: date,
        UpdatedAt: date,
        DeletedAt: null
    }
}

// 生成核心邮件对象（简化版）
const generateCoreEmailJson = () => {
    const senderEmail = randomEmail()
    const senderName = randomString('Sender_')

    return {
        Subject: randomSubject(),
        From: [`${senderName} <${senderEmail}>`],
        To: [randomEmail()],
        Date: randomDate(),
        Body: randomBody(),
        HasAttachments: Math.random() > 0.8,
        MailboxName: "INBOX",
        Flags: randomFlags()
    }
}

interface EmailDataStepProps {
    data: any
    onDataChange: (key: string, value: any) => void
    onNext?: () => void
    onPrevious?: () => void
    stepStatus?: boolean[]
    readOnly?: boolean
    stepNumber?: number  // 可选的步骤编号
}

const STEP_NAMES = ['第一步', '第二步', '第三步', '第四步']

export default function EmailDataStep({ data, onDataChange, onNext, onPrevious, readOnly, stepNumber }: EmailDataStepProps) {
    // 状态初始化
    const emailData = data.emailData || { source: 'api', selectedEmail: null, isManualInput: false, manualEmailData: '' }

    // UI状态
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [isJsonPreviewOpen, setIsJsonPreviewOpen] = useState(false)
    const [manualMode, setManualMode] = useState(emailData.isManualInput)

    // 搜索状态
    const [searchFilters, setSearchFilters] = useState({
        keyword: '',
        from: '',
        subject: '',
        limit: 20
    })
    const [searchResults, setSearchResults] = useState<Email[]>([])
    const [loading, setLoading] = useState(false)
    const [hasSearched, setHasSearched] = useState(false)

    // 初始化加载
    useEffect(() => {
        if (isSearchOpen && !hasSearched) {
            handleSearch()
        }
    }, [isSearchOpen])

    // 处理邮件选择
    const handleEmailSelect = useCallback((email: Email) => {
        const newEmailData = {
            ...emailData,
            source: 'api',
            selectedEmail: email,
            isManualInput: false,
            sampleData: email // 设置样本数据用于后续步骤
        }
        onDataChange('emailData', newEmailData)
        setManualMode(false)
        setIsSearchOpen(false)
    }, [emailData, onDataChange])

    // 处理手动输入
    const handleManualDataChange = useCallback((value: string) => {
        let sampleData = null;
        try {
            sampleData = JSON.parse(value);
        } catch (e) {
            // 解析失败不影响保存原始文本
        }

        const newEmailData = {
            ...emailData,
            source: 'manual',
            selectedEmail: null,
            isManualInput: true,
            manualEmailData: value,
            sampleData: sampleData
        }
        onDataChange('emailData', newEmailData)
    }, [emailData, onDataChange])

    // 执行搜索
    const handleSearch = async () => {
        setLoading(true)
        try {
            const params: any = {
                limit: searchFilters.limit
            }
            if (searchFilters.keyword) params.keyword = searchFilters.keyword
            if (searchFilters.from) params.from_query = searchFilters.from
            if (searchFilters.subject) params.subject_query = searchFilters.subject

            const response = await emailService.searchEmails(params)
            setSearchResults(response.emails || [])
        } catch (error) {
            console.error('Search failed:', error)
            setSearchResults([])
        } finally {
            setLoading(false)
            setHasSearched(true)
        }
    }

    // 验证是否可以下一步
    const canProceed = () => {
        if (manualMode) {
            return !!emailData.manualEmailData && emailData.sampleData !== null
        }
        return !!emailData.selectedEmail
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardContent className="p-6">
                    <div className="flex flex-col space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-medium">
                                {stepNumber !== undefined ? `${STEP_NAMES[stepNumber]}：` : ''}选择数据源
                            </h3>
                            <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                                <button
                                    onClick={() => setManualMode(false)}
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${!manualMode
                                        ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white'
                                        : 'text-gray-500 hover:text-gray-900'
                                        }`}
                                >
                                    从历史邮件选择
                                </button>
                                <button
                                    onClick={() => setManualMode(true)}
                                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${manualMode
                                        ? 'bg-white dark:bg-gray-700 shadow text-gray-900 dark:text-white'
                                        : 'text-gray-500 hover:text-gray-900'
                                        }`}
                                >
                                    手动输入 JSON
                                </button>
                            </div>
                        </div>

                        {!manualMode ? (
                            // 模式 A: 选择邮件
                            <div className="space-y-4">
                                <div className="p-8 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-center space-y-4 bg-gray-50/50 hover:bg-gray-50 transition-colors">
                                    <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-full">
                                        <Mail className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                                    </div>
                                    <div>
                                        <h4 className="text-base font-medium text-gray-900 dark:text-white">选择一封邮件作为测试数据</h4>
                                        <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
                                            我们将使用这封邮件的数据来测试您的过滤条件和动作配置。
                                        </p>
                                    </div>
                                    <Button onClick={() => setIsSearchOpen(true)} className="gap-2">
                                        <Search className="w-4 h-4" />
                                        打开邮件选择器
                                    </Button>
                                </div>

                                {emailData.selectedEmail && (
                                    <div className="bg-white dark:bg-gray-800 border rounded-lg overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-2">
                                        <div className="p-4 border-b bg-gray-50/50 dark:bg-gray-800/50 flex justify-between items-center">
                                            <div className="flex items-center gap-2 text-green-600 font-medium">
                                                <Check className="w-4 h-4" />
                                                已选择邮件
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 gap-2 text-gray-500"
                                                onClick={() => setIsJsonPreviewOpen(true)}
                                            >
                                                <FileJson className="w-4 h-4" />
                                                查看 JSON
                                            </Button>
                                        </div>
                                        <div className="p-4 space-y-3">
                                            <div className="grid grid-cols-[80px_1fr] gap-2 text-sm">
                                                <span className="text-gray-500 flex items-center gap-1"><User className="w-3 h-3" /> 发件人:</span>
                                                <span className="font-medium text-gray-900 dark:text-white">
                                                    {Array.isArray(emailData.selectedEmail.From) ? emailData.selectedEmail.From.join(', ') : emailData.selectedEmail.From}
                                                </span>

                                                <span className="text-gray-500 flex items-center gap-1"><Mail className="w-3 h-3" /> 主题:</span>
                                                <span className="font-medium text-gray-900 dark:text-white">
                                                    {emailData.selectedEmail.Subject || '(无主题)'}
                                                </span>

                                                <span className="text-gray-500 flex items-center gap-1"><Calendar className="w-3 h-3" /> 时间:</span>
                                                <span className="text-gray-700 dark:text-gray-300">
                                                    {formatDate(emailData.selectedEmail.Date)}
                                                </span>
                                            </div>

                                            <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-3 text-xs text-gray-600 dark:text-gray-400 line-clamp-3">
                                                {emailData.selectedEmail.Body}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            // 模式 B: 手动输入
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            输入 JSON 数据
                                        </label>
                                        {/* 快捷生成按钮组 */}
                                        <TooltipProvider delayDuration={100}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-gray-400">快速生成:</span>

                                                {/* 完整JSON对象按钮 */}
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-7 text-xs gap-1.5"
                                                            onClick={() => {
                                                                const json = generateFullEmailJson()
                                                                handleManualDataChange(JSON.stringify(json, null, 2))
                                                            }}
                                                        >
                                                            <FileCode className="w-3 h-3" />
                                                            完整对象
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="bottom" align="end" className="max-w-md p-0 overflow-hidden">
                                                        <div className="bg-gray-900 text-green-400 p-3 rounded-lg max-h-80 overflow-auto">
                                                            <div className="text-xs text-gray-400 mb-2 pb-2 border-b border-gray-700">
                                                                👁️ 完整邮件对象示例（包含所有字段）
                                                            </div>
                                                            <pre className="text-xs font-mono whitespace-pre-wrap">
                                                                {JSON.stringify(generateFullEmailJson(), null, 2)}
                                                            </pre>
                                                        </div>
                                                    </TooltipContent>
                                                </Tooltip>

                                                {/* 核心邮件对象按钮 */}
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-7 text-xs gap-1.5"
                                                            onClick={() => {
                                                                const json = generateCoreEmailJson()
                                                                handleManualDataChange(JSON.stringify(json, null, 2))
                                                            }}
                                                        >
                                                            <Inbox className="w-3 h-3" />
                                                            核心对象
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="bottom" align="end" className="max-w-md p-0 overflow-hidden">
                                                        <div className="bg-gray-900 text-green-400 p-3 rounded-lg max-h-80 overflow-auto">
                                                            <div className="text-xs text-gray-400 mb-2 pb-2 border-b border-gray-700">
                                                                👁️ 核心邮件对象示例（简化版）
                                                            </div>
                                                            <pre className="text-xs font-mono whitespace-pre-wrap">
                                                                {JSON.stringify(generateCoreEmailJson(), null, 2)}
                                                            </pre>
                                                        </div>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </div>
                                        </TooltipProvider>
                                    </div>
                                    <textarea
                                        value={emailData.manualEmailData}
                                        onChange={(e) => handleManualDataChange(e.target.value)}
                                        className="w-full h-64 p-4 font-mono text-xs bg-gray-50 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
                                        placeholder={`{
  "Subject": "Test Email",
  "From": ["sender@example.com"],
  "Body": "This is a test email content..."
}`}
                                    />
                                    <p className="text-xs text-gray-500">
                                        请输入有效的 JSON 格式。只要包含 Subject, From, Body 等字段即可用于测试。
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* 底部导航栏 - 只有当提供了 onNext/onPrevious 时才显示 */}
            {(onNext || onPrevious) && (
                <div className="flex justify-between items-center pt-4">
                    <Button
                        variant="outline"
                        onClick={onPrevious}
                        disabled={!onPrevious}
                        className={!onPrevious ? "opacity-50 cursor-not-allowed" : ""}
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        上一步
                    </Button>

                    <Button
                        onClick={onNext}
                        disabled={!canProceed() || !onNext}
                        className="bg-primary-600 hover:bg-primary-700 text-white shadow-md hover:shadow-lg transition-all"
                    >
                        下一步
                        <ChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                </div>
            )}

            {/* 邮件搜索 Dialog (Drawer-like) */}
            <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
                <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
                    <DialogHeader className="p-6 pb-2">
                        <DialogTitle>选择邮件</DialogTitle>
                        <DialogDescription>
                            搜索并选择一封历史邮件作为测试数据源。
                        </DialogDescription>
                    </DialogHeader>

                    {/* 搜索过滤栏 */}
                    <div className="px-6 py-4 bg-gray-50/50 border-y flex flex-wrap gap-3">
                        <div className="flex-1 min-w-[200px]">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder="搜索关键词..."
                                    className="pl-9"
                                    value={searchFilters.keyword}
                                    onChange={(e) => setSearchFilters(prev => ({ ...prev, keyword: e.target.value }))}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                />
                            </div>
                        </div>
                        <div className="w-[180px]">
                            <Input
                                placeholder="发件人"
                                value={searchFilters.from}
                                onChange={(e) => setSearchFilters(prev => ({ ...prev, from: e.target.value }))}
                            />
                        </div>
                        <div className="w-[180px]">
                            <Input
                                placeholder="主题"
                                value={searchFilters.subject}
                                onChange={(e) => setSearchFilters(prev => ({ ...prev, subject: e.target.value }))}
                            />
                        </div>
                        <Button onClick={handleSearch} disabled={loading}>
                            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : '搜索'}
                        </Button>
                    </div>

                    {/* 结果列表 */}
                    <div className="flex-1 overflow-y-auto p-0">
                        {searchResults.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                                {loading ? (
                                    <RefreshCw className="w-8 h-8 animate-spin mb-2" />
                                ) : (
                                    <Search className="w-12 h-12 mb-2 opacity-20" />
                                )}
                                <p>{loading ? '搜索中...' : '未找到邮件，请调整搜索条件'}</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {searchResults.map((email) => (
                                    <div
                                        key={email.ID}
                                        onClick={() => handleEmailSelect(email)}
                                        className="p-4 hover:bg-gray-50 cursor-pointer transition-colors group"
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="font-medium text-gray-900 text-sm group-hover:text-primary-600 transition-colors">
                                                {Array.isArray(email.From) ? email.From.join(', ') : email.From}
                                            </div>
                                            <div className="text-xs text-gray-400 whitespace-nowrap ml-2">
                                                {formatDate(email.Date)}
                                            </div>
                                        </div>
                                        <div className="text-sm font-medium text-gray-800 mb-1 truncate">
                                            {email.Subject || '(无主题)'}
                                        </div>
                                        <div className="text-xs text-gray-500 line-clamp-2">
                                            {email.Body}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* JSON 预览 Dialog */}
            <Dialog open={isJsonPreviewOpen} onOpenChange={setIsJsonPreviewOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>邮件数据 JSON</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto bg-gray-900 rounded-md p-4 mt-2">
                        <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                            {emailData.selectedEmail ? JSON.stringify(emailData.selectedEmail, null, 2) : '{}'}
                        </pre>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}