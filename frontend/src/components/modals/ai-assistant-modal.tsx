'use client'

import { useState, useEffect } from 'react'
import { Sparkles, Loader2, Copy, Check, Settings, ChevronDown, ChevronUp } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { openAIService } from '@/services/openai.service'
import type { OpenAIConfig, AIPromptTemplate, CallOpenAIRequest } from '@/types/openai'
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
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface AIAssistantModalProps {
    isOpen: boolean
    onClose: () => void
    onGenerate: (content: string) => void
    title?: string
    description?: string
    defaultPrompt?: string
    placeholder?: string
    variables?: Record<string, string>
    scenario?: string
}

export function AIAssistantModal({
    isOpen,
    onClose,
    onGenerate,
    title = '使用 AI 生成',
    description = '选择 AI 配置和提示模板，输入您的需求',
    defaultPrompt = '',
    placeholder = '请描述您的需求...',
    variables = {},
    scenario = 'general'
}: AIAssistantModalProps) {
    const [loading, setLoading] = useState(false)
    const [generating, setGenerating] = useState(false)
    const [copied, setCopied] = useState(false)
    const [showAdvanced, setShowAdvanced] = useState(false)

    // AI 配置和模板
    const [configs, setConfigs] = useState<OpenAIConfig[]>([])
    const [templates, setTemplates] = useState<AIPromptTemplate[]>([])
    const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null)
    const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)

    // 输入内容
    const [userInput, setUserInput] = useState(defaultPrompt)
    const [systemPrompt, setSystemPrompt] = useState('')
    const [maxTokens, setMaxTokens] = useState(1000)
    const [temperature, setTemperature] = useState(0.7)

    // 生成结果
    const [generatedContent, setGeneratedContent] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        if (isOpen) {
            loadData()
        } else {
            // 清理状态
            setGeneratedContent('')
            setError('')
            setCopied(false)
            setShowAdvanced(false)
        }
    }, [isOpen])

    const loadData = async () => {
        setLoading(true)
        try {
            const [configsData, templatesData] = await Promise.all([
                openAIService.getOpenAIConfigs(),
                openAIService.getPromptTemplates()
            ])

            setConfigs(configsData.filter(c => c.is_active))

            const filteredTemplates = templatesData.filter(t =>
                t.is_active && (t.scenario === scenario || scenario === 'general')
            )
            setTemplates(filteredTemplates)

            if (configsData.length > 0 && !selectedConfigId) {
                const activeConfig = configsData.find(c => c.is_active)
                if (activeConfig) {
                    setSelectedConfigId(activeConfig.id)
                }
            }

            if (filteredTemplates.length > 0 && !selectedTemplateId) {
                setSelectedTemplateId(filteredTemplates[0].id)
                setSystemPrompt(filteredTemplates[0].system_prompt)
                setMaxTokens(filteredTemplates[0].max_tokens)
                setTemperature(filteredTemplates[0].temperature)
            }
        } catch (error) {
            console.error('Failed to load AI configurations:', error)
            setError('加载 AI 配置失败')
        } finally {
            setLoading(false)
        }
    }

    const handleTemplateChange = (templateId: string) => {
        const id = Number(templateId)
        setSelectedTemplateId(id)
        const template = templates.find(t => t.id === id)
        if (template) {
            setSystemPrompt(template.system_prompt)
            setMaxTokens(template.max_tokens)
            setTemperature(template.temperature)
        }
    }

    const handleGenerate = async () => {
        if (!selectedConfigId || !userInput.trim()) {
            setError('请选择 AI 配置并输入内容')
            return
        }

        setGenerating(true)
        setError('')

        try {
            let enhancedUserMessage = userInput
            if (variables.emailContent) {
                enhancedUserMessage = `邮件内容：\n${variables.emailContent}\n\n用户需求：${userInput}`
            }

            const request: CallOpenAIRequest = {
                config_id: selectedConfigId,
                template_id: selectedTemplateId || undefined,
                system_prompt: systemPrompt || undefined,
                user_message: enhancedUserMessage,
                variables: variables,
                max_tokens: maxTokens,
                temperature: temperature,
                response_format: 'text'
            }

            const response = await openAIService.callOpenAI(request)
            setGeneratedContent(response.content)
        } catch (error: any) {
            console.error('Generation failed:', error)
            setError(error.message || '生成失败，请重试')
        } finally {
            setGenerating(false)
        }
    }

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedContent)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const handleUseContent = () => {
        onGenerate(generatedContent)
        onClose()
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent size="2xl">
                <ModalHeader>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-500">
                            <Sparkles className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <ModalTitle>{title}</ModalTitle>
                            <ModalDescription>{description}</ModalDescription>
                        </div>
                    </div>
                </ModalHeader>

                <ModalBody>
                    {loading ? (
                        <div className="flex h-64 items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* AI 配置选择 */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>AI 配置</Label>
                                    <Select
                                        value={selectedConfigId?.toString() || ''}
                                        onValueChange={(value) => setSelectedConfigId(Number(value))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="选择 AI 配置" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {configs.map((config) => (
                                                <SelectItem key={config.id} value={config.id.toString()}>
                                                    {config.name} ({config.model})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>提示模板（可选）</Label>
                                    <Select
                                        value={selectedTemplateId?.toString() || ''}
                                        onValueChange={handleTemplateChange}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="不使用模板" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {templates.map((template) => (
                                                <SelectItem key={template.id} value={template.id.toString()}>
                                                    {template.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* 高级设置 */}
                            <div>
                                <button
                                    type="button"
                                    onClick={() => setShowAdvanced(!showAdvanced)}
                                    className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                                >
                                    <Settings className="h-4 w-4" />
                                    高级设置
                                    {showAdvanced ? (
                                        <ChevronUp className="h-4 w-4" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4" />
                                    )}
                                </button>

                                <AnimatePresence>
                                    {showAdvanced && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="mt-4 space-y-4 overflow-hidden"
                                        >
                                            <div className="space-y-2">
                                                <Label>系统提示（System Prompt）</Label>
                                                <Textarea
                                                    value={systemPrompt}
                                                    onChange={(e) => setSystemPrompt(e.target.value)}
                                                    rows={3}
                                                    placeholder="设置 AI 的角色和行为..."
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>最大令牌数</Label>
                                                    <Input
                                                        type="number"
                                                        value={maxTokens}
                                                        onChange={(e) => setMaxTokens(Number(e.target.value))}
                                                        min={100}
                                                        max={4000}
                                                    />
                                                </div>

                                                <div className="space-y-2">
                                                    <Label>温度（0-2）</Label>
                                                    <Input
                                                        type="number"
                                                        value={temperature}
                                                        onChange={(e) => setTemperature(Number(e.target.value))}
                                                        min={0}
                                                        max={2}
                                                        step={0.1}
                                                    />
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* 用户输入 */}
                            <div className="space-y-2">
                                <Label>您的需求</Label>
                                <Textarea
                                    value={userInput}
                                    onChange={(e) => setUserInput(e.target.value)}
                                    rows={4}
                                    placeholder={placeholder}
                                />
                            </div>

                            {/* 错误提示 */}
                            {error && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="rounded-lg bg-red-50 p-4 dark:bg-red-900/20"
                                >
                                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                                </motion.div>
                            )}

                            {/* 生成结果 */}
                            {generatedContent && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="space-y-3"
                                >
                                    <div className="flex items-center justify-between">
                                        <Label>生成结果</Label>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleCopy}
                                            className="gap-2"
                                        >
                                            {copied ? (
                                                <>
                                                    <Check className="h-4 w-4 text-green-500" />
                                                    已复制
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="h-4 w-4" />
                                                    复制
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900 max-h-60 overflow-y-auto">
                                        <pre className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                                            {generatedContent}
                                        </pre>
                                    </div>
                                </motion.div>
                            )}
                        </div>
                    )}
                </ModalBody>

                <ModalFooter>
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    {generatedContent ? (
                        <Button onClick={handleUseContent}>
                            使用此内容
                        </Button>
                    ) : (
                        <Button
                            onClick={handleGenerate}
                            disabled={generating || !selectedConfigId || !userInput.trim()}
                            className="gap-2"
                        >
                            {generating ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    生成中...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4" />
                                    生成
                                </>
                            )}
                        </Button>
                    )}
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}
