'use client'

import { useState, useEffect } from 'react'
import { openAIService } from '@/services/openai.service'
import type { AIPromptTemplate, AIPromptTemplateRequest } from '@/types/openai'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'

export function AIPromptTemplateTab() {
    const { confirm } = useConfirmDialog()
    const [templates, setTemplates] = useState<AIPromptTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingTemplate, setEditingTemplate] = useState<AIPromptTemplate | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    const [formData, setFormData] = useState<AIPromptTemplateRequest>({
        scenario: 'email_template_generation',
        name: '',
        description: '',
        system_prompt: '',
        user_prompt: '',
        variables: {},
        max_tokens: 1000,
        temperature: 0.7,
        is_active: true
    })

    const [variablesText, setVariablesText] = useState('')

    useEffect(() => {
        loadTemplates()
        initializeDefaults()
    }, [])

    const loadTemplates = async () => {
        try {
            setLoading(true)
            const data = await openAIService.getPromptTemplates()
            setTemplates(data || [])
        } catch (error) {
            setError('加载模板失败')
            setTemplates([])
        } finally {
            setLoading(false)
        }
    }

    const initializeDefaults = async () => {
        try {
            await openAIService.initializeDefaultTemplates()
            loadTemplates()
        } catch (error) {
            // 忽略错误，可能已经初始化过了
        }
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        try {
            // Parse variables from text
            const variables: Record<string, string> = {}
            if (variablesText.trim()) {
                const lines = variablesText.trim().split('\n')
                for (const line of lines) {
                    const [key, ...valueParts] = line.split(':')
                    if (key && valueParts.length > 0) {
                        variables[key.trim()] = valueParts.join(':').trim()
                    }
                }
            }

            const templateData = { ...formData, variables }

            if (editingTemplate) {
                await openAIService.updatePromptTemplate(editingTemplate.id, templateData)
                setSuccess('模板已更新')
            } else {
                await openAIService.createPromptTemplate(templateData)
                setSuccess('模板已创建')
            }

            setIsDialogOpen(false)
            resetForm()
            loadTemplates()
        } catch (error) {
            setError(editingTemplate ? '更新模板失败' : '创建模板失败')
        }
    }

    const handleEdit = (template: AIPromptTemplate) => {
        setEditingTemplate(template)
        setFormData({
            scenario: template.scenario,
            name: template.name,
            description: template.description || '',
            system_prompt: template.system_prompt,
            user_prompt: template.user_prompt || '',
            variables: template.variables || {},
            max_tokens: template.max_tokens,
            temperature: template.temperature,
            is_active: template.is_active
        })

        // Convert variables to text format
        if (template.variables) {
            const varLines = Object.entries(template.variables)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\n')
            setVariablesText(varLines)
        } else {
            setVariablesText('')
        }

        setIsDialogOpen(true)
    }

    const handleDelete = async (id: number) => {
        const confirmed = await confirm({
            title: '删除模板',
            description: '确定要删除这个模板吗？',
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return

        try {
            await openAIService.deletePromptTemplate(id)
            setSuccess('模板已删除')
            loadTemplates()
        } catch (error) {
            setError('删除模板失败')
        }
    }

    const resetForm = () => {
        setEditingTemplate(null)
        setFormData({
            scenario: 'email_template_generation',
            name: '',
            description: '',
            system_prompt: '',
            user_prompt: '',
            variables: {},
            max_tokens: 1000,
            temperature: 0.7,
            is_active: true
        })
        setVariablesText('')
    }

    if (loading) {
        return <div className="flex items-center justify-center h-64 dark:text-gray-300">加载中...</div>
    }

    return (
        <div className="space-y-6 p-6">
            {/* 消息提示 */}
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                    <span className="block sm:inline">{error}</span>
                    <button
                        className="absolute top-0 bottom-0 right-0 px-4 py-3"
                        onClick={() => setError(null)}
                    >
                        <span className="text-2xl">&times;</span>
                    </button>
                </div>
            )}
            {success && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded relative dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                    <span className="block sm:inline">{success}</span>
                    <button
                        className="absolute top-0 bottom-0 right-0 px-4 py-3"
                        onClick={() => setSuccess(null)}
                    >
                        <span className="text-2xl">&times;</span>
                    </button>
                </div>
            )}

            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold dark:text-white">AI 提示模板</h2>
                    <p className="text-gray-600 dark:text-gray-400">管理不同场景的 AI 提示模板</p>
                </div>
                <button
                    onClick={() => { resetForm(); setIsDialogOpen(true) }}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded inline-flex items-center dark:bg-blue-600 dark:hover:bg-blue-800"
                >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    添加模板
                </button>
            </div>

            {/* 模板列表 */}
            <div className="grid gap-4">
                {templates.length === 0 ? (
                    <div className="bg-white shadow rounded-lg p-8 text-center dark:bg-gray-800 dark:text-gray-300">
                        <p className="text-gray-500 mb-4 dark:text-gray-400">暂无模板</p>
                        <button
                            onClick={() => { resetForm(); setIsDialogOpen(true) }}
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded dark:bg-blue-600 dark:hover:bg-blue-800"
                        >
                            添加第一个模板
                        </button>
                    </div>
                ) : (
                    templates.map((template) => (
                        <div key={template.id} className={`bg-white shadow rounded-lg p-6 dark:bg-gray-800 ${template.is_active ? 'border-2 border-green-500 dark:border-green-600' : ''}`}>
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-lg font-semibold flex items-center gap-2 dark:text-white">
                                        {template.name}
                                        {template.is_active && (
                                            <span className="text-xs bg-green-500 text-white px-2 py-1 rounded dark:bg-green-600">
                                                活跃
                                            </span>
                                        )}
                                    </h3>
                                    <p className="text-gray-600 dark:text-gray-400">{template.scenario}</p>
                                    {template.description && (
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{template.description}</p>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleEdit(template)}
                                        className="text-blue-600 hover:text-blue-800 dark:text-blue-500 dark:hover:text-blue-400"
                                    >
                                        编辑
                                    </button>
                                    {template.scenario !== 'email_template_generation' && (
                                        <button
                                            onClick={() => handleDelete(template.id)}
                                            className="text-red-600 hover:text-red-800 dark:text-red-500 dark:hover:text-red-400"
                                        >
                                            删除
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-2 text-sm dark:text-gray-300">
                                <div>
                                    <span className="text-gray-600 dark:text-gray-400">最大令牌数：</span>
                                    <span className="ml-2">{template.max_tokens}</span>
                                </div>
                                <div>
                                    <span className="text-gray-600 dark:text-gray-400">温度：</span>
                                    <span className="ml-2">{template.temperature}</span>
                                </div>
                                {template.variables && Object.keys(template.variables).length > 0 && (
                                    <div>
                                        <span className="text-gray-600 dark:text-gray-400">变量：</span>
                                        <div className="mt-1 space-y-1">
                                            {Object.entries(template.variables).map(([key, value]) => (
                                                <div key={key} className="font-mono text-xs dark:text-gray-300">
                                                    {key}: {value}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* 编辑对话框 */}
            {isDialogOpen && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 dark:bg-gray-900 dark:bg-opacity-70 overflow-y-auto h-full w-full z-50">
                    <div className="relative top-10 mx-auto p-5 border w-full max-w-4xl shadow-lg rounded-md bg-white dark:bg-gray-800 dark:border-gray-700">
                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <h3 className="text-lg font-bold dark:text-white">{editingTemplate ? '编辑模板' : '添加模板'}</h3>
                                <p className="text-gray-600 dark:text-gray-400">配置 AI 提示模板</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        场景标识
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.scenario}
                                        onChange={(e) => setFormData({ ...formData, scenario: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="email_template_generation"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        模板名称
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="邮件模板生成器"
                                        required
                                    />
                                </div>

                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        描述（可选）
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="用于生成邮件提取模板的 AI 提示"
                                    />
                                </div>

                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        系统提示词
                                    </label>
                                    <textarea
                                        value={formData.system_prompt}
                                        onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="你是一个专业的邮件模板生成助手..."
                                        rows={6}
                                        required
                                    />
                                </div>

                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        用户提示词模板（可选）
                                    </label>
                                    <textarea
                                        value={formData.user_prompt}
                                        onChange={(e) => setFormData({ ...formData, user_prompt: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="请根据以下需求生成邮件提取模板：{user_input}"
                                        rows={3}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        最大令牌数
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.max_tokens}
                                        onChange={(e) => setFormData({ ...formData, max_tokens: parseInt(e.target.value) || 1000 })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        min="100"
                                        max="4000"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        温度 (0-2)
                                    </label>
                                    <input
                                        type="number"
                                        value={formData.temperature}
                                        onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) || 0.7 })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        min="0"
                                        max="2"
                                        step="0.1"
                                        required
                                    />
                                </div>

                                <div className="col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        变量定义（可选）
                                    </label>
                                    <textarea
                                        value={variablesText}
                                        onChange={(e) => setVariablesText(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="user_input: 用户输入的需求描述&#10;context: 上下文信息"
                                        rows={3}
                                    />
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                        每行一个变量，格式：变量名: 变量描述
                                    </p>
                                </div>

                                <div className="col-span-2 flex items-center">
                                    <input
                                        type="checkbox"
                                        id="is_active"
                                        checked={formData.is_active}
                                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded dark:border-gray-600 dark:bg-gray-700"
                                    />
                                    <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900 dark:text-gray-300">
                                        设为活跃模板
                                    </label>
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsDialogOpen(false)}
                                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                                >
                                    取消
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
                                >
                                    {editingTemplate ? '更新' : '创建'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
