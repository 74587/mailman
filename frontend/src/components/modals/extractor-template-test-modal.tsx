'use client'

import { useState, useEffect } from 'react'
import { X, Play, Mail, User, Calendar, FileText, AlertCircle, CheckCircle, Loader2, Code, Eye, Settings, Save, Plus, Trash2, Hash, Sparkles, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExtractorTemplate, EmailAccount, Email, ExtractorConfig } from '@/types'
import { emailAccountService } from '@/services/email-account.service'
import { emailService } from '@/services/email.service'
import { extractorTemplateService } from '@/services/extractor-template.service'
import { motion, AnimatePresence } from 'framer-motion'
import { FieldPreviewPanel } from '../field-preview-panel'
import { AIExtractorAssistantModal } from './ai-extractor-assistant-modal'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalTitle,
    ModalDescription
} from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

interface ExtractorTemplateTestModalProps {
    isOpen: boolean
    onClose: () => void
    template: ExtractorTemplate
    onSave?: (updatedTemplate: ExtractorTemplate) => void
}

interface TestResult {
    field: string
    type: string
    result: string | null
    error?: string
}

interface FieldPreview {
    field: string
    content: string
    isPinned: boolean
}

type TabType = 'email' | 'config' | 'result'

const extractorTypes = [
    { value: 'regex', label: '正则表达式', icon: Hash, color: 'text-blue-500' },
    { value: 'js', label: 'JavaScript', icon: Code, color: 'text-green-500' },
    { value: 'gotemplate', label: 'Go模板', icon: Sparkles, color: 'text-purple-500' }
] as const

const fieldOptions = [
    { value: 'ALL', label: '全部字段' },
    { value: 'from', label: '发件人' },
    { value: 'to', label: '收件人' },
    { value: 'cc', label: '抄送' },
    { value: 'subject', label: '主题' },
    { value: 'body', label: '正文' },
    { value: 'html_body', label: 'HTML正文' },
    { value: 'headers', label: '邮件头' }
] as const

export function ExtractorTemplateTestModal({
    isOpen,
    onClose,
    template,
    onSave
}: ExtractorTemplateTestModalProps) {
    const [loading, setLoading] = useState(false)
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [emails, setEmails] = useState<Email[]>([])
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
    const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null)
    const [useCustomEmail, setUseCustomEmail] = useState(false)
    const [customEmail, setCustomEmail] = useState({
        from: '',
        to: '',
        cc: '',
        subject: '',
        body: '',
        html_body: ''
    })
    const [testResults, setTestResults] = useState<TestResult[]>([])
    const [testing, setTesting] = useState(false)
    const [activeTab, setActiveTab] = useState<TabType>('email')
    const [saving, setSaving] = useState(false)
    const [showHelp, setShowHelp] = useState<Record<string, boolean>>({})

    // 编辑模式下的提取器配置
    const [editableExtractors, setEditableExtractors] = useState<ExtractorConfig[]>([])
    const [hasChanges, setHasChanges] = useState(false)

    // 字段预览状态
    const [fieldPreviews, setFieldPreviews] = useState<FieldPreview[]>([])

    // AI 助手状态
    const [showAIAssistant, setShowAIAssistant] = useState(false)
    const [aiTargetIndex, setAITargetIndex] = useState<number | null>(null)

    // 处理模态框打开/关闭
    useEffect(() => {
        if (isOpen) {
            loadAccounts()
            // 初始化可编辑的提取器配置，确保有extract字段和replacement字段
            setEditableExtractors(template.extractors.map(ext => ({
                ...ext,
                extract: ext.extract || ext.config || '',
                config: ext.config || ext.extract || '',
                replacement: ext.replacement || (ext.type === 'regex' ? '$0' : undefined)
            })))
            setHasChanges(false)
        } else {
            // 重置状态
            setTestResults([])
            setSelectedAccountId(null)
            setSelectedEmailId(null)
            setUseCustomEmail(false)
            setActiveTab('email')
            setEditableExtractors([])
            setHasChanges(false)
            setFieldPreviews([])
            setShowHelp({})
        }
    }, [isOpen, template])

    const loadAccounts = async () => {
        try {
            const response = await emailAccountService.getAccounts()
            setAccounts(response || [])
        } catch (error) {
            console.error('Failed to load accounts:', error)
        }
    }

    const loadEmails = async (accountId: number) => {
        setLoading(true)
        try {
            const response = await emailService.getEmails(accountId, {
                limit: 20,
                sort_by: 'date DESC'
            })
            setEmails(response?.emails || [])
        } catch (error) {
            console.error('Failed to load emails:', error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (selectedAccountId) {
            loadEmails(selectedAccountId)
        }
    }, [selectedAccountId])

    // 监听邮件内容变化，更新预览窗口
    useEffect(() => {
        // 如果有打开的预览窗口，更新其内容
        if (fieldPreviews.length > 0) {
            const currentField = fieldPreviews[0].field
            const newContent = getFieldContent(currentField)
            setFieldPreviews(prev => prev.map((p, index) =>
                index === 0 ? { ...p, content: newContent } : p
            ))
        }
    }, [selectedEmailId, useCustomEmail, customEmail])

    // 获取字段内容
    const getFieldContent = (field: string): string => {
        let emailData: any = null

        if (useCustomEmail) {
            emailData = customEmail
        } else if (selectedEmailId) {
            const selectedEmail = emails.find(e => e.ID === selectedEmailId)
            if (selectedEmail) {
                emailData = {
                    from: selectedEmail.From?.[0] || '',
                    to: selectedEmail.To?.join(', ') || '',
                    cc: selectedEmail.Cc?.join(', ') || '',
                    subject: selectedEmail.Subject || '',
                    body: selectedEmail.Body || '',
                    html_body: selectedEmail.HTMLBody || '',
                    headers: '' // Email 类型中没有 Headers 字段
                }
            }
        }

        if (!emailData) return ''

        switch (field) {
            case 'ALL':
                return JSON.stringify(emailData, null, 2)
            case 'from':
                return emailData.from || ''
            case 'to':
                return emailData.to || ''
            case 'cc':
                return emailData.cc || ''
            case 'subject':
                return emailData.subject || ''
            case 'body':
                return emailData.body || ''
            case 'html_body':
                return emailData.html_body || ''
            case 'headers':
                return emailData.headers || ''
            default:
                return ''
        }
    }

    // 处理字段预览
    const handleFieldPreview = (field: string) => {
        const content = getFieldContent(field)

        // 如果已有预览窗口（不管是哪个字段的），就复用第一个
        if (fieldPreviews.length > 0) {
            // 更新第一个预览窗口的内容和字段
            setFieldPreviews(prev => {
                const updated = [...prev]
                updated[0] = {
                    ...updated[0],
                    field,
                    content
                }
                return updated
            })
        } else {
            // 如果没有预览窗口，创建新的
            setFieldPreviews([{
                field,
                content,
                isPinned: false
            }])
        }
    }

    // 关闭字段预览
    const handleClosePreview = (field: string) => {
        setFieldPreviews(prev => prev.filter(p => p.field !== field))
    }

    // 切换固定状态
    const handleTogglePin = (field: string) => {
        setFieldPreviews(prev => prev.map(p =>
            p.field === field ? { ...p, isPinned: !p.isPinned } : p
        ))
    }

    const toggleHelp = (key: string) => {
        setShowHelp(prev => ({ ...prev, [key]: !prev[key] }))
    }

    const handleTest = async () => {
        setTesting(true)
        setTestResults([])

        try {
            let testData: any = {}

            // 处理提取器配置，将replacement与extract组合
            const processedExtractors = editableExtractors.map(ext => {
                if (ext.type === 'regex' && ext.replacement && ext.replacement !== '$0') {
                    // 使用 ||| 作为分隔符组合正则表达式和替换模板
                    return {
                        ...ext,
                        extract: `${ext.extract}|||${ext.replacement}`,
                        config: `${ext.extract}|||${ext.replacement}`
                    }
                }
                return ext
            })

            if (useCustomEmail) {
                testData = {
                    custom_email: customEmail,
                    extractors: processedExtractors
                }
            } else if (selectedEmailId) {
                testData = {
                    email_id: selectedEmailId,
                    extractors: processedExtractors
                }
            } else {
                throw new Error('请选择一封邮件或使用自定义邮件')
            }

            const results = await (extractorTemplateService as any).testTemplate(template.id, testData)
            setTestResults(results)
            setActiveTab('result')
        } catch (error: any) {
            console.error('Test failed:', error)
            setTestResults([{
                field: 'error',
                type: 'error',
                result: null,
                error: error.message || '测试失败'
            }])
            setActiveTab('result')
        } finally {
            setTesting(false)
        }
    }

    const handleSaveChanges = async () => {
        if (!hasChanges || !onSave) return

        setSaving(true)
        try {
            await extractorTemplateService.updateTemplate(template.id, {
                name: template.name,
                description: template.description,
                extractors: editableExtractors
            })

            // 调用父组件的保存回调
            onSave({
                ...template,
                extractors: editableExtractors
            })

            setHasChanges(false)
            // 显示成功提示（这里可以添加一个 toast 通知）
        } catch (error: any) {
            console.error('Save failed:', error)
            // 显示错误提示
        } finally {
            setSaving(false)
        }
    }

    const handleExtractorChange = (index: number, field: keyof ExtractorConfig, value: any) => {
        const newExtractors = [...editableExtractors]
        // 如果更新extract字段，同时更新config字段以保持兼容性
        if (field === 'extract') {
            newExtractors[index] = {
                ...newExtractors[index],
                extract: value,
                config: value
            }
        } else {
            newExtractors[index] = { ...newExtractors[index], [field]: value }
        }
        setEditableExtractors(newExtractors)
        setHasChanges(true)
        // 清除该提取器的测试结果
        if (testResults[index]) {
            const newResults = [...testResults]
            newResults[index] = { ...newResults[index], result: null, error: '配置已更改，请重新测试' }
            setTestResults(newResults)
        }
    }

    const handleAddExtractor = () => {
        setEditableExtractors([...editableExtractors, {
            field: 'ALL',
            type: 'regex',
            match: '',
            extract: '',
            config: '',
            replacement: '$0'
        }])
        setHasChanges(true)
    }

    // 处理 AI 生成提取器
    const handleAIGenerate = (index?: number) => {
        setAITargetIndex(index ?? null)
        setShowAIAssistant(true)
    }

    // 处理 AI 生成的内容
    const handleAIGeneratedContent = (content: string) => {
        try {
            // 首先尝试从 markdown 代码块中提取 JSON
            let parsedContent = content
            const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
            if (codeBlockMatch) {
                parsedContent = codeBlockMatch[1].trim()
            }

            // 尝试解析为 JSON 数组或对象
            let extractorConfigs: ExtractorConfig[] = []
            try {
                const jsonData = JSON.parse(parsedContent)
                if (Array.isArray(jsonData)) {
                    // 如果是数组，转换每个元素
                    extractorConfigs = jsonData.map(item => ({
                        field: item.field || 'ALL',
                        type: item.type || 'regex',
                        match: item.match || '',
                        extract: item.extract || item.pattern || '',
                        config: item.config || item.extract || item.pattern || '',
                        replacement: item.replacement || (item.type === 'regex' ? '$1' : undefined)
                    }))
                } else if (typeof jsonData === 'object') {
                    // 如果是单个对象，转换为数组
                    extractorConfigs = [{
                        field: jsonData.field || 'ALL',
                        type: jsonData.type || 'regex',
                        match: jsonData.match || '',
                        extract: jsonData.extract || jsonData.pattern || '',
                        config: jsonData.config || jsonData.extract || jsonData.pattern || '',
                        replacement: jsonData.replacement || (jsonData.type === 'regex' ? '$1' : undefined)
                    }]
                }
            } catch (jsonError) {
                // 如果不是有效的 JSON，尝试作为单个提取器配置
                const extractorConfig = parseAIGeneratedExtractor(parsedContent)
                extractorConfigs = [extractorConfig]
            }

            // 应用提取器配置
            if (extractorConfigs.length > 0) {
                if (aiTargetIndex !== null) {
                    // 更新现有提取器（只使用第一个配置）
                    const newExtractors = [...editableExtractors]
                    newExtractors[aiTargetIndex] = {
                        ...newExtractors[aiTargetIndex],
                        ...extractorConfigs[0]
                    }
                    setEditableExtractors(newExtractors)
                } else {
                    // 添加所有新提取器
                    setEditableExtractors([...editableExtractors, ...extractorConfigs])
                }
                setHasChanges(true)
            }

            setShowAIAssistant(false)
        } catch (error) {
            console.error('Failed to parse AI generated content:', error)
            // 如果解析失败，至少更新提取规则
            if (aiTargetIndex !== null) {
                handleExtractorChange(aiTargetIndex, 'extract', content)
            }
            setShowAIAssistant(false)
        }
    }

    // 解析 AI 生成的提取器配置
    const parseAIGeneratedExtractor = (content: string): ExtractorConfig => {
        // 尝试解析 JSON 格式
        try {
            const parsed = JSON.parse(content)
            return {
                field: parsed.field || 'ALL',
                type: parsed.type || 'regex',
                match: parsed.match || '',
                extract: parsed.extract || parsed.pattern || content,
                config: parsed.config || parsed.extract || parsed.pattern || content,
                replacement: parsed.replacement || (parsed.type === 'regex' ? '$1' : undefined)
            }
        } catch {
            // 如果不是 JSON，尝试解析为正则表达式
            const regexMatch = content.match(/^\/(.+)\/([gimuy]*)$/)
            if (regexMatch) {
                return {
                    field: 'ALL',
                    type: 'regex',
                    match: '',
                    extract: regexMatch[1],
                    config: regexMatch[1],
                    replacement: '$1'
                }
            }

            // 默认作为正则表达式
            return {
                field: 'ALL',
                type: 'regex',
                match: '',
                extract: content,
                config: content,
                replacement: '$0'
            }
        }
    }

    const handleRemoveExtractor = (index: number) => {
        const newExtractors = editableExtractors.filter((_, i) => i !== index)
        setEditableExtractors(newExtractors)
        setHasChanges(true)
        // 同时移除对应的测试结果
        const newResults = testResults.filter((_, i) => i !== index)
        setTestResults(newResults)
    }

    const selectedEmail = emails.find(e => e.ID === selectedEmailId)

    const tabs = [
        { id: 'email' as TabType, label: '邮件内容', icon: Mail },
        { id: 'config' as TabType, label: '提取器配置', icon: Settings },
        { id: 'result' as TabType, label: '提取结果', icon: Eye }
    ]

    return (
        <>
            <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <ModalContent
                    size="6xl"
                    showCloseButton={false}
                    className="z-[60] max-h-[90vh] flex flex-col"
                    overlayClassName="z-[60]"
                >
                    {/* 头部 */}
                    <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
                        <div>
                            <ModalTitle className="text-xl font-semibold text-gray-900 dark:text-white">
                                测试取件模板
                            </ModalTitle>
                            <ModalDescription className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                {template.name}
                            </ModalDescription>
                        </div>
                        <div className="flex items-center gap-3">
                            {hasChanges && (
                                <motion.button
                                    onClick={handleSaveChanges}
                                    disabled={saving}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                                >
                                    {saving ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            保存中...
                                        </>
                                    ) : (
                                        <>
                                            <Save className="h-4 w-4" />
                                            保存更改
                                        </>
                                    )}
                                </motion.button>
                            )}
                            <motion.button
                                onClick={handleTest}
                                disabled={testing || (!useCustomEmail && !selectedEmailId)}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                            >
                                {testing ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        测试中...
                                    </>
                                ) : (
                                    <>
                                        <Play className="h-4 w-4" />
                                        开始测试
                                    </>
                                )}
                            </motion.button>
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-700"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    {/* 标签页导航 */}
                    <div className="border-b border-gray-200 dark:border-gray-700">
                        <nav className="flex space-x-8 px-6" aria-label="Tabs">
                            {tabs.map((tab) => {
                                const Icon = tab.icon
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={cn(
                                            'flex items-center gap-2 border-b-2 py-4 px-1 text-sm font-medium transition-colors',
                                            activeTab === tab.id
                                                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                                        )}
                                    >
                                        <Icon className="h-4 w-4" />
                                        {tab.label}
                                        {tab.id === 'result' && testResults.length > 0 && (
                                            <span className="ml-2 rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-600 dark:bg-primary-900 dark:text-primary-400">
                                                {testResults.length}
                                            </span>
                                        )}
                                        {tab.id === 'config' && hasChanges && (
                                            <span className="ml-2 h-2 w-2 rounded-full bg-orange-500" />
                                        )}
                                    </button>
                                )
                            })}
                        </nav>
                    </div>

                    {/* 内容区域 */}
                    <div className="h-[600px] overflow-hidden">
                        <AnimatePresence mode="wait">
                            {/* 邮件内容标签页 */}
                            {activeTab === 'email' && (
                                <motion.div
                                    key="email"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex h-full"
                                >
                                    {/* 左侧：邮件选择 */}
                                    <div className="w-1/3 border-r border-gray-200 p-6 dark:border-gray-700">
                                        <div className="mb-4">
                                            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                测试方式
                                            </label>
                                            <div className="space-y-2">
                                                <label className="flex items-center">
                                                    <input
                                                        type="radio"
                                                        checked={!useCustomEmail}
                                                        onChange={() => setUseCustomEmail(false)}
                                                        className="mr-2 dark:bg-gray-700 dark:border-gray-600"
                                                    />
                                                    <span className="text-sm">选择现有邮件</span>
                                                </label>
                                                <label className="flex items-center">
                                                    <input
                                                        type="radio"
                                                        checked={useCustomEmail}
                                                        onChange={() => setUseCustomEmail(true)}
                                                        className="mr-2 dark:bg-gray-700 dark:border-gray-600"
                                                    />
                                                    <span className="text-sm">自定义邮件内容</span>
                                                </label>
                                            </div>
                                        </div>

                                        {!useCustomEmail ? (
                                            <>
                                                {/* 账户选择 */}
                                                <div className="mb-4">
                                                    <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        选择邮箱账户
                                                    </label>
                                                    <select
                                                        value={selectedAccountId || ''}
                                                        onChange={(e) => setSelectedAccountId(Number(e.target.value))}
                                                        className="w-full rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                    >
                                                        <option value="">请选择账户</option>
                                                        {accounts.map(account => (
                                                            <option key={account.id} value={account.id}>
                                                                {account.emailAddress}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>

                                                {/* 邮件列表 */}
                                                {selectedAccountId && (
                                                    <div>
                                                        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                            选择邮件
                                                        </label>
                                                        <div className="h-[400px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                                                            {loading ? (
                                                                <div className="flex h-full items-center justify-center">
                                                                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                                                                </div>
                                                            ) : emails.length === 0 ? (
                                                                <div className="flex h-full items-center justify-center text-gray-500">
                                                                    暂无邮件
                                                                </div>
                                                            ) : (
                                                                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                                                                    {emails.map(email => (
                                                                        <div
                                                                            key={email.ID}
                                                                            onClick={() => setSelectedEmailId(email.ID)}
                                                                            className={cn(
                                                                                'cursor-pointer p-4 hover:bg-gray-50 dark:hover:bg-gray-900',
                                                                                selectedEmailId === email.ID && 'bg-primary-50 dark:bg-primary-900/20'
                                                                            )}
                                                                        >
                                                                            <div className="mb-1 flex items-center justify-between">
                                                                                <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                                                    {email.From?.[0] || 'Unknown'}
                                                                                </span>
                                                                                <span className="text-xs text-gray-500">
                                                                                    {new Date(email.Date).toLocaleDateString()}
                                                                                </span>
                                                                            </div>
                                                                            <div className="text-sm text-gray-700 dark:text-gray-300">
                                                                                {email.Subject}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            /* 自定义邮件表单 */
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        发件人
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={customEmail.from}
                                                        onChange={(e) => setCustomEmail({ ...customEmail, from: e.target.value })}
                                                        className="w-full rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                        placeholder="sender@example.com"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        收件人
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={customEmail.to}
                                                        onChange={(e) => setCustomEmail({ ...customEmail, to: e.target.value })}
                                                        className="w-full rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                        placeholder="receiver@example.com"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        主题
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={customEmail.subject}
                                                        onChange={(e) => setCustomEmail({ ...customEmail, subject: e.target.value })}
                                                        className="w-full rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                        placeholder="邮件主题"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        正文
                                                    </label>
                                                    <textarea
                                                        value={customEmail.body}
                                                        onChange={(e) => setCustomEmail({ ...customEmail, body: e.target.value })}
                                                        className="w-full rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                                        placeholder="邮件正文内容"
                                                        rows={6}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* 右侧：邮件内容预览 */}
                                    <div className="flex-1 p-6">
                                        <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
                                            邮件内容预览
                                        </h3>
                                        {!useCustomEmail && selectedEmail ? (
                                            <div className="h-[calc(100%-60px)] overflow-y-auto rounded-lg bg-gray-50 p-6 dark:bg-gray-900">
                                                <div className="space-y-4">
                                                    <div>
                                                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                                            <User className="h-4 w-4" />
                                                            <span className="font-medium">发件人：</span>
                                                        </div>
                                                        <p className="mt-1 text-gray-900 dark:text-white">
                                                            {selectedEmail.From?.[0] || 'Unknown'}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                                            <Mail className="h-4 w-4" />
                                                            <span className="font-medium">主题：</span>
                                                        </div>
                                                        <p className="mt-1 text-gray-900 dark:text-white">
                                                            {selectedEmail.Subject}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                                            <Calendar className="h-4 w-4" />
                                                            <span className="font-medium">时间：</span>
                                                        </div>
                                                        <p className="mt-1 text-gray-900 dark:text-white">
                                                            {new Date(selectedEmail.Date).toLocaleString()}
                                                        </p>
                                                    </div>
                                                    <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                                                        <div className="mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                                            <FileText className="h-4 w-4" />
                                                            <span className="font-medium">正文内容：</span>
                                                        </div>
                                                        {selectedEmail.HTMLBody ? (
                                                            <div
                                                                className="prose prose-sm max-w-none dark:prose-invert"
                                                                dangerouslySetInnerHTML={{ __html: selectedEmail.HTMLBody }}
                                                            />
                                                        ) : (
                                                            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-gray-300">
                                                                {selectedEmail.Body}
                                                            </pre>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : useCustomEmail ? (
                                            <div className="h-[calc(100%-60px)] overflow-y-auto rounded-lg bg-gray-50 p-6 dark:bg-gray-900">
                                                <div className="space-y-4">
                                                    <div>
                                                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">发件人：</span>
                                                        <p className="mt-1 text-gray-900 dark:text-white">{customEmail.from || '未填写'}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">收件人：</span>
                                                        <p className="mt-1 text-gray-900 dark:text-white">{customEmail.to || '未填写'}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">主题：</span>
                                                        <p className="mt-1 text-gray-900 dark:text-white">{customEmail.subject || '未填写'}</p>
                                                    </div>
                                                    <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                                                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">正文：</span>
                                                        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-gray-300">
                                                            {customEmail.body || '未填写'}
                                                        </pre>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex h-[calc(100%-60px)] items-center justify-center rounded-lg bg-gray-50 text-gray-500 dark:bg-gray-900">
                                                请选择邮件或填写自定义内容
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}

                            {/* 提取器配置标签页 - 可编辑 */}
                            {activeTab === 'config' && (
                                <motion.div
                                    key="config"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    transition={{ duration: 0.2 }}
                                    className="h-full p-6"
                                >
                                    <div className="mb-4 flex items-center justify-between">
                                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                                            提取器配置
                                        </h3>
                                        <div className="flex items-center gap-2">
                                            <motion.button
                                                onClick={() => handleAIGenerate()}
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 text-sm font-medium text-white hover:from-purple-700 hover:to-pink-700"
                                            >
                                                <Sparkles className="h-4 w-4" />
                                                使用 AI 生成
                                            </motion.button>
                                            <motion.button
                                                onClick={handleAddExtractor}
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                                            >
                                                <Plus className="h-4 w-4" />
                                                添加提取器
                                            </motion.button>
                                        </div>
                                    </div>
                                    <div className="h-[calc(100%-60px)] overflow-y-auto">
                                        <div className="space-y-4">
                                            {editableExtractors.map((extractor, index) => {
                                                const typeConfig = extractorTypes.find(t => t.value === extractor.type)
                                                const Icon = typeConfig?.icon || Code
                                                // 使用更稳定的key，结合字段名和索引
                                                const stableKey = `${extractor.field}-${extractor.type}-${index}`

                                                return (
                                                    <motion.div
                                                        key={stableKey}
                                                        initial={{ opacity: 0, y: 20 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: index * 0.1 }}
                                                        className="rounded-lg border border-gray-200 p-6 dark:border-gray-700"
                                                    >
                                                        <div className="mb-4 flex items-center justify-between">
                                                            <div className="flex items-center gap-3">
                                                                <div className={cn(
                                                                    "flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800",
                                                                    typeConfig?.color
                                                                )}>
                                                                    <Icon className="h-5 w-5" />
                                                                </div>
                                                                <div>
                                                                    <h4 className="font-medium text-gray-900 dark:text-white">
                                                                        提取器 {index + 1}
                                                                    </h4>
                                                                </div>
                                                            </div>
                                                            <motion.button
                                                                onClick={() => handleRemoveExtractor(index)}
                                                                whileHover={{ scale: 1.1 }}
                                                                whileTap={{ scale: 0.9 }}
                                                                className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </motion.button>
                                                        </div>

                                                        <div className="space-y-4">
                                                            <div className="flex items-end gap-4">
                                                                <div className="flex-1">
                                                                    <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                        提取字段
                                                                    </label>
                                                                    <select
                                                                        value={extractor.field}
                                                                        onChange={(e) => handleExtractorChange(index, 'field', e.target.value)}
                                                                        className="w-full rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                                                                    >
                                                                        {fieldOptions.map(field => (
                                                                            <option key={field.value} value={field.value}>
                                                                                {field.label}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <motion.button
                                                                    type="button"
                                                                    onClick={() => handleFieldPreview(extractor.field)}
                                                                    whileHover={{ scale: 1.05 }}
                                                                    whileTap={{ scale: 0.95 }}
                                                                    className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                                                                    title="预览字段内容"
                                                                >
                                                                    <Eye className="h-4 w-4" />
                                                                    预览
                                                                </motion.button>
                                                                <div className="flex-1">
                                                                    <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                        提取类型
                                                                    </label>
                                                                    <select
                                                                        value={extractor.type}
                                                                        onChange={(e) => handleExtractorChange(index, 'type', e.target.value)}
                                                                        className="w-full rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                                                                    >
                                                                        {extractorTypes.map(type => (
                                                                            <option key={type.value} value={type.value}>
                                                                                {type.label}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            </div>

                                                            {/* Match 配置 */}
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                        匹配条件 (可选)
                                                                    </label>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => toggleHelp(`match_${index}`)}
                                                                        className="text-gray-400 hover:text-gray-600"
                                                                    >
                                                                        <HelpCircle className="h-4 w-4" />
                                                                    </button>
                                                                </div>
                                                                <textarea
                                                                    value={extractor.match || ''}
                                                                    onChange={(e) => handleExtractorChange(index, 'match', e.target.value)}
                                                                    className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                                                                    placeholder={
                                                                        extractor.type === 'regex'
                                                                            ? '输入正则表达式，例如：订单号.*\\d{10}'
                                                                            : extractor.type === 'js'
                                                                                ? '输入JavaScript代码，返回布尔值'
                                                                                : '输入Go模板表达式，例如：{{ contains .Content "订单号" }}'
                                                                    }
                                                                    rows={2}
                                                                />
                                                                {showHelp[`match_${index}`] && (
                                                                    <div className="mt-2 p-3 bg-blue-50 rounded-md text-sm dark:bg-blue-900/20">
                                                                        <p className="font-medium mb-1">匹配条件说明：</p>
                                                                        <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                                                            <li>用于判断是否执行提取操作</li>
                                                                            <li>返回 false 时将跳过该字段的提取</li>
                                                                            <li>留空则默认执行提取</li>
                                                                        </ul>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Extract 配置 */}
                                                            <div>
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                            提取规则 <span className="text-red-500">*</span>
                                                                        </label>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => toggleHelp(`extract_${index}`)}
                                                                            className="text-gray-400 hover:text-gray-600"
                                                                        >
                                                                            <HelpCircle className="h-4 w-4" />
                                                                        </button>
                                                                    </div>
                                                                    <motion.button
                                                                        type="button"
                                                                        onClick={() => handleAIGenerate(index)}
                                                                        whileHover={{ scale: 1.05 }}
                                                                        whileTap={{ scale: 0.95 }}
                                                                        className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 px-3 py-1.5 text-xs font-medium text-white hover:from-purple-600 hover:to-pink-600"
                                                                    >
                                                                        <Sparkles className="h-3.5 w-3.5" />
                                                                        AI 生成
                                                                    </motion.button>
                                                                </div>
                                                                <textarea
                                                                    value={extractor.extract || extractor.config || ''}
                                                                    onChange={(e) => {
                                                                        // 只更新extract字段，避免状态冲突
                                                                        handleExtractorChange(index, 'extract', e.target.value)
                                                                    }}
                                                                    className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                                                                    placeholder={
                                                                        extractor.type === 'regex'
                                                                            ? '输入正则表达式，例如：订单号[：:]\\s*(\\d{10})'
                                                                            : extractor.type === 'js'
                                                                                ? '输入JavaScript代码，例如：\nconst match = text.match(/订单号[：:]\\s*(\\d{10})/);\nreturn match ? match[1] : null;'
                                                                                : '输入Go模板，例如：\n{{ regexFind "订单号[：:]\\s*(\\d{10})" .Content 1 }}'
                                                                    }
                                                                    rows={4}
                                                                />
                                                                {showHelp[`extract_${index}`] && (
                                                                    <div className="mt-2 p-3 bg-blue-50 rounded-md text-sm dark:bg-blue-900/20">
                                                                        <p className="font-medium mb-2">提取规则说明：</p>
                                                                        {extractor.type === 'regex' ? (
                                                                            <div className="space-y-2">
                                                                                <p className="text-gray-700 dark:text-gray-300">
                                                                                    输入正则表达式来匹配内容。使用括号创建捕获组，例如：
                                                                                </p>
                                                                                <ul className="list-disc list-inside text-gray-700 dark:text-gray-300">
                                                                                    <li><code>.*</code> - 匹配所有内容</li>
                                                                                    <li><code>{'订单号[：:]\\s*(\\d{10})'}</code> - 匹配订单号并捕获数字部分</li>
                                                                                    <li><code>{'([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})'}</code> - 匹配邮箱地址</li>
                                                                                </ul>
                                                                                <p className="text-gray-700 dark:text-gray-300">
                                                                                    使用下方的"替换模板"字段来指定返回内容。
                                                                                </p>
                                                                            </div>
                                                                        ) : (
                                                                            <p className="text-gray-700 dark:text-gray-300">
                                                                                {extractor.type === 'js'
                                                                                    ? '使用JavaScript处理文本，返回提取的值或null'
                                                                                    : '使用Go模板语法提取内容'}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* 正则表达式的替换模板字段 */}
                                                            {extractor.type === 'regex' && (
                                                                <div>
                                                                    <div className="flex items-center gap-2 mb-2">
                                                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                                                            替换模板 (可选)
                                                                        </label>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => toggleHelp(`replacement_${index}`)}
                                                                            className="text-gray-400 hover:text-gray-600"
                                                                        >
                                                                            <HelpCircle className="h-4 w-4" />
                                                                        </button>
                                                                    </div>
                                                                    <input
                                                                        type="text"
                                                                        value={extractor.replacement || '$0'}
                                                                        onChange={(e) => handleExtractorChange(index, 'replacement', e.target.value)}
                                                                        className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                                                                        placeholder="例如：$0（完整匹配）或 $1（第一个捕获组）"
                                                                    />
                                                                    {showHelp[`replacement_${index}`] && (
                                                                        <div className="mt-2 p-3 bg-blue-50 rounded-md text-sm dark:bg-blue-900/20">
                                                                            <p className="font-medium mb-1">替换模板说明：</p>
                                                                            <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                                                                <li>$0 - 返回完整匹配的内容</li>
                                                                                <li>$1, $2, ... - 返回对应的捕获组内容</li>
                                                                                <li>可以组合使用，如：$1-$2</li>
                                                                                <li>留空或使用 $0 将返回完整匹配</li>
                                                                            </ul>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {extractor.type === 'regex' && (
                                                                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                                                                    使用正则表达式匹配内容，支持捕获组和返回模板
                                                                </div>
                                                            )}
                                                            {extractor.type === 'js' && (
                                                                <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-300">
                                                                    使用JavaScript处理文本，返回提取的值
                                                                </div>
                                                            )}
                                                            {extractor.type === 'gotemplate' && (
                                                                <div className="rounded-lg bg-purple-50 p-3 text-sm text-purple-700 dark:bg-purple-900/20 dark:text-purple-300">
                                                                    使用Go模板语法处理结构化数据
                                                                </div>
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )
                                            })}

                                            {editableExtractors.length === 0 && (
                                                <div className="flex h-[400px] items-center justify-center">
                                                    <div className="text-center">
                                                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                                                            <Settings className="h-6 w-6 text-gray-400" />
                                                        </div>
                                                        <p className="text-gray-500">还没有配置提取器</p>
                                                        <p className="mt-1 text-sm text-gray-400">点击"添加提取器"开始配置</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {/* 提取结果标签页 */}
                            {activeTab === 'result' && (
                                <motion.div
                                    key="result"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    transition={{ duration: 0.2 }}
                                    className="h-full p-6"
                                >
                                    <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">
                                        提取结果
                                    </h3>
                                    <div className="h-[calc(100%-60px)] overflow-y-auto">
                                        {testResults.length === 0 ? (
                                            <div className="flex h-full items-center justify-center">
                                                <div className="text-center">
                                                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                                                        <FileText className="h-6 w-6 text-gray-400" />
                                                    </div>
                                                    <p className="text-gray-500">尚未进行测试</p>
                                                    <p className="mt-1 text-sm text-gray-400">点击"开始测试"查看提取结果</p>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                {testResults.map((result, index) => (
                                                    <motion.div
                                                        key={index}
                                                        initial={{ opacity: 0, y: 20 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: index * 0.1 }}
                                                        className="rounded-lg border border-gray-200 p-6 dark:border-gray-700"
                                                    >
                                                        <div className="mb-4 flex items-center justify-between">
                                                            <div className="flex items-center gap-3">
                                                                <div className={cn(
                                                                    "flex h-10 w-10 items-center justify-center rounded-lg",
                                                                    result.error
                                                                        ? "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400"
                                                                        : "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400"
                                                                )}>
                                                                    {result.error ? (
                                                                        <AlertCircle className="h-5 w-5" />
                                                                    ) : (
                                                                        <CheckCircle className="h-5 w-5" />
                                                                    )}
                                                                </div>
                                                                <div>
                                                                    <h4 className="font-medium text-gray-900 dark:text-white">
                                                                        {result.field}
                                                                    </h4>
                                                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                                                        类型: {result.type}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {result.error ? (
                                                            <div className="rounded-lg bg-red-50 p-4 dark:bg-red-900/20">
                                                                <p className="text-sm text-red-600 dark:text-red-400">{result.error}</p>
                                                            </div>
                                                        ) : (
                                                            <div className="rounded-lg bg-gray-100 p-4 dark:bg-gray-800">
                                                                <div className="mb-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                                                                    提取结果：
                                                                </div>
                                                                <pre className="overflow-x-auto rounded bg-white p-3 font-mono text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                                                                    {result.result || '(空)'}
                                                                </pre>
                                                            </div>
                                                        )}
                                                    </motion.div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </ModalContent>
            </Modal>

            {/* 字段预览面板 */}
            {fieldPreviews.map(preview => (
                <FieldPreviewPanel
                    key={preview.field}
                    field={preview.field}
                    content={preview.content}
                    onClose={() => handleClosePreview(preview.field)}
                    isPinned={preview.isPinned}
                    onPinToggle={() => handleTogglePin(preview.field)}
                />
            ))}

            {/* AI 助手模态框 */}
            <AIExtractorAssistantModal
                isOpen={showAIAssistant}
                onClose={() => {
                    setShowAIAssistant(false)
                    setAITargetIndex(null)
                }}
                onGenerate={(configs) => {
                    if (aiTargetIndex !== null) {
                        // 更新现有提取器（只使用第一个配置）
                        if (configs.length > 0) {
                            const newExtractors = [...editableExtractors]
                            newExtractors[aiTargetIndex] = {
                                ...newExtractors[aiTargetIndex],
                                ...configs[0]
                            }
                            setEditableExtractors(newExtractors)
                            setHasChanges(true)
                        }
                    } else {
                        // 添加所有新提取器
                        setEditableExtractors([...editableExtractors, ...configs])
                        setHasChanges(true)
                    }
                }}
                context={`当前测试内容：\n${(() => {
                    if (useCustomEmail) {
                        return JSON.stringify(customEmail, null, 2)
                    } else if (selectedEmailId) {
                        const selectedEmail = emails.find(e => e.ID === selectedEmailId)
                        if (selectedEmail) {
                            return JSON.stringify({
                                from: selectedEmail.From?.[0] || '',
                                to: selectedEmail.To?.join(', ') || '',
                                cc: selectedEmail.Cc?.join(', ') || '',
                                subject: selectedEmail.Subject || '',
                                body: selectedEmail.Body || '',
                                html_body: selectedEmail.HTMLBody || '',
                                date: selectedEmail.Date
                            }, null, 2)
                        }
                    }
                    return '暂无邮件内容'
                })()}\n\n请生成提取器配置，返回 JSON 数组格式。每个配置应包含 field（字段名）、type（类型：regex/xpath/css/json）、extract（提取规则）等字段。`}
            />
        </>
    )
}