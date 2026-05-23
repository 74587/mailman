'use client'

import { useState, useEffect } from 'react'
import { openAIService } from '@/services/openai.service'
import type { OpenAIConfig, OpenAIConfigRequest, AIChannelType } from '@/types/openai'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'

export function OpenAIConfigTab() {
    const { confirm } = useConfirmDialog()
    const [configs, setConfigs] = useState<OpenAIConfig[]>([])
    const [loading, setLoading] = useState(true)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingConfig, setEditingConfig] = useState<OpenAIConfig | null>(null)
    const [showApiKey, setShowApiKey] = useState<Record<number, boolean>>({})
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [testingConfigId, setTestingConfigId] = useState<number | null>(null)
    const [testingInDialog, setTestingInDialog] = useState(false)
    const [dialogError, setDialogError] = useState<string | null>(null)
    const [dialogSuccess, setDialogSuccess] = useState<string | null>(null)

    const [formData, setFormData] = useState<OpenAIConfigRequest>({
        name: '',
        channel_type: 'openai',
        base_url: 'https://api.openai.com/v1',
        api_key: '',
        model: 'gpt-3.5-turbo',
        headers: {},
        is_active: false
    })

    const [headersText, setHeadersText] = useState('')

    useEffect(() => {
        loadConfigs()
    }, [])

    const loadConfigs = async () => {
        try {
            setLoading(true)
            const data = await openAIService.getOpenAIConfigs()
            setConfigs(data || [])
        } catch (error) {
            setError('加载配置失败')
            setConfigs([])
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()

        try {
            // Parse headers from text
            const headers: Record<string, string> = {}
            if (headersText.trim()) {
                const lines = headersText.trim().split('\n')
                for (const line of lines) {
                    const [key, ...valueParts] = line.split(':')
                    if (key && valueParts.length > 0) {
                        headers[key.trim()] = valueParts.join(':').trim()
                    }
                }
            }

            const configData = { ...formData, headers }

            if (editingConfig) {
                await openAIService.updateOpenAIConfig(editingConfig.id, configData)
                setSuccess('配置已更新')
            } else {
                await openAIService.createOpenAIConfig(configData)
                setSuccess('配置已创建')
            }

            setIsDialogOpen(false)
            resetForm()
            loadConfigs()
        } catch (error) {
            setError(editingConfig ? '更新配置失败' : '创建配置失败')
        }
    }

    const handleEdit = (config: OpenAIConfig) => {
        setEditingConfig(config)
        setFormData({
            name: config.name,
            channel_type: config.channel_type,
            base_url: config.base_url,
            api_key: config.api_key, // 现在可以直接使用API密钥，因为不再脱敏
            model: config.model,
            headers: config.headers || {},
            is_active: config.is_active
        })

        // Convert headers to text format
        if (config.headers) {
            const headerLines = Object.entries(config.headers)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\n')
            setHeadersText(headerLines)
        } else {
            setHeadersText('')
        }

        setIsDialogOpen(true)
    }

    const handleDelete = async (id: number) => {
        const confirmed = await confirm({
            title: '删除配置',
            description: '确定要删除这个配置吗？',
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return

        try {
            await openAIService.deleteOpenAIConfig(id)
            setSuccess('配置已删除')
            loadConfigs()
        } catch (error) {
            setError('删除配置失败')
        }
    }

    const handleTest = async (config: OpenAIConfig) => {
        try {
            setError(null)
            setSuccess(null)
            setTestingConfigId(config.id)

            // 准备测试请求
            const testRequest = {
                name: config.name,
                channel_type: config.channel_type,
                base_url: config.base_url,
                api_key: config.api_key,
                model: config.model,
                headers: config.headers || {},
                is_active: config.is_active
            }

            // 调用测试API
            const result = await openAIService.testOpenAIConfig(testRequest)

            if (result.success) {
                setSuccess(`测试成功！响应时间: ${result.response_time_ms}ms`)
            } else {
                setError(`测试失败: ${result.message}`)
            }
        } catch (error) {
            setError('测试配置时发生错误')
        } finally {
            setTestingConfigId(null)
        }
    }

    const resetForm = () => {
        setEditingConfig(null)
        setFormData({
            name: '',
            channel_type: 'openai',
            base_url: 'https://api.openai.com/v1',
            api_key: '',
            model: 'gpt-3.5-turbo',
            headers: {},
            is_active: false
        })
        setHeadersText('')
    }

    // 根据渠道类型更新默认值
    const handleChannelTypeChange = (channelType: AIChannelType) => {
        setFormData(prev => {
            const newData = { ...prev, channel_type: channelType }

            // 设置默认值
            switch (channelType) {
                case 'openai':
                    newData.base_url = 'https://api.openai.com/v1'
                    newData.model = 'gpt-3.5-turbo'
                    break
                case 'gemini':
                    newData.base_url = 'https://generativelanguage.googleapis.com/v1beta'
                    newData.model = 'gemini-pro'
                    break
                case 'claude':
                    newData.base_url = 'https://api.anthropic.com/v1'
                    newData.model = 'claude-3-sonnet-20240229'
                    break
            }

            return newData
        })
    }

    const toggleApiKeyVisibility = (id: number) => {
        setShowApiKey(prev => ({ ...prev, [id]: !prev[id] }))
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
                    <h2 className="text-2xl font-bold dark:text-white">OpenAI 配置</h2>
                    <p className="text-gray-600 dark:text-gray-400">管理 OpenAI API 配置</p>
                </div>
                <button
                    onClick={() => { resetForm(); setIsDialogOpen(true) }}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded inline-flex items-center dark:bg-blue-600 dark:hover:bg-blue-800"
                >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    添加配置
                </button>
            </div>

            {/* 配置列表 */}
            <div className="grid gap-4">
                {configs.length === 0 ? (
                    <div className="bg-white shadow rounded-lg p-8 text-center dark:bg-gray-800 dark:text-gray-300">
                        <p className="text-gray-500 mb-4 dark:text-gray-400">暂无配置</p>
                        <button
                            onClick={() => { resetForm(); setIsDialogOpen(true) }}
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded dark:bg-blue-600 dark:hover:bg-blue-800"
                        >
                            添加第一个配置
                        </button>
                    </div>
                ) : (
                    configs.map((config) => (
                        <div key={config.id} className={`bg-white shadow rounded-lg p-6 dark:bg-gray-800 ${config.is_active ? 'border-2 border-blue-500 dark:border-blue-600' : ''}`}>
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-lg font-semibold flex items-center gap-2 dark:text-white">
                                        {config.name}
                                        {config.is_active && (
                                            <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded dark:bg-blue-600">
                                                活跃
                                            </span>
                                        )}
                                        <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded dark:bg-gray-700 dark:text-gray-300">
                                            {config.channel_type === 'openai' && 'OpenAI'}
                                            {config.channel_type === 'gemini' && 'Gemini'}
                                            {config.channel_type === 'claude' && 'Claude'}
                                        </span>
                                    </h3>
                                    <p className="text-gray-600 dark:text-gray-400">{config.base_url}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleTest(config)}
                                        disabled={testingConfigId === config.id}
                                        className={`${testingConfigId === config.id
                                            ? 'text-gray-400 cursor-not-allowed'
                                            : 'text-green-600 hover:text-green-800 dark:text-green-500 dark:hover:text-green-400'
                                            } flex items-center gap-1`}
                                    >
                                        {testingConfigId === config.id && (
                                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                        )}
                                        {testingConfigId === config.id ? '测试中...' : '测试'}
                                    </button>
                                    <button
                                        onClick={() => handleEdit(config)}
                                        disabled={testingConfigId === config.id}
                                        className={`${testingConfigId === config.id
                                            ? 'text-gray-400 cursor-not-allowed'
                                            : 'text-blue-600 hover:text-blue-800 dark:text-blue-500 dark:hover:text-blue-400'
                                            }`}
                                    >
                                        编辑
                                    </button>
                                    <button
                                        onClick={() => handleDelete(config.id)}
                                        disabled={testingConfigId === config.id}
                                        className={`${testingConfigId === config.id
                                            ? 'text-gray-400 cursor-not-allowed'
                                            : 'text-red-600 hover:text-red-800 dark:text-red-500 dark:hover:text-red-400'
                                            }`}
                                    >
                                        删除
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-2 text-sm dark:text-gray-300">
                                <div className="flex justify-between">
                                    <span className="text-gray-600 dark:text-gray-400">模型：</span>
                                    <span>{config.model}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600 dark:text-gray-400">API 密钥：</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono">
                                            {showApiKey[config.id] ? config.api_key : '••••••••'}
                                        </span>
                                        <button
                                            onClick={() => toggleApiKeyVisibility(config.id)}
                                            className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-300"
                                        >
                                            {showApiKey[config.id] ? '隐藏' : '显示'}
                                        </button>
                                    </div>
                                </div>
                                {config.headers && Object.keys(config.headers).length > 0 && (
                                    <div>
                                        <span className="text-gray-600 dark:text-gray-400">自定义请求头：</span>
                                        <div className="mt-1 space-y-1">
                                            {Object.entries(config.headers).map(([key, value]) => (
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
                    <div className="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white dark:bg-gray-800 dark:border-gray-700">
                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <h3 className="text-lg font-bold dark:text-white">{editingConfig ? '编辑配置' : '添加配置'}</h3>
                                <p className="text-gray-600 dark:text-gray-400">配置 OpenAI API 连接信息</p>
                            </div>

                            {/* 对话框内的消息显示 */}
                            {dialogError && (
                                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative mb-4 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                                    <span className="block sm:inline">{dialogError}</span>
                                    <button
                                        type="button"
                                        className="absolute top-0 bottom-0 right-0 px-4 py-3"
                                        onClick={() => setDialogError(null)}
                                    >
                                        <span className="text-2xl">&times;</span>
                                    </button>
                                </div>
                            )}
                            {dialogSuccess && (
                                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded relative mb-4 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                                    <span className="block sm:inline">{dialogSuccess}</span>
                                    <button
                                        type="button"
                                        className="absolute top-0 bottom-0 right-0 px-4 py-3"
                                        onClick={() => setDialogSuccess(null)}
                                    >
                                        <span className="text-2xl">&times;</span>
                                    </button>
                                </div>
                            )}

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        配置名称
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="例如：生产环境"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        AI 渠道类型
                                    </label>
                                    <select
                                        value={formData.channel_type}
                                        onChange={(e) => handleChannelTypeChange(e.target.value as AIChannelType)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        required
                                    >
                                        <option value="openai">OpenAI</option>
                                        <option value="gemini">Google Gemini</option>
                                        <option value="claude">Anthropic Claude</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        API 地址
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.base_url}
                                        onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="https://api.openai.com/v1"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        API 密钥
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.api_key}
                                        onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="sk-..."
                                        required={!editingConfig}
                                    />
                                    {editingConfig && (
                                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                            留空则保持原密钥不变
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        默认模型
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.model}
                                        onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="gpt-3.5-turbo"
                                        required
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        自定义请求头（可选）
                                    </label>
                                    <textarea
                                        value={headersText}
                                        onChange={(e) => setHeadersText(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                        placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
                                        rows={3}
                                    />
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                        每行一个请求头，格式：Header-Name: Header-Value
                                    </p>
                                </div>

                                <div className="flex items-center">
                                    <input
                                        type="checkbox"
                                        id="is_active"
                                        checked={formData.is_active}
                                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded dark:border-gray-600 dark:bg-gray-700"
                                    />
                                    <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900 dark:text-gray-300">
                                        设为活跃配置
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
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            setTestingInDialog(true)
                                            setDialogError(null)
                                            setDialogSuccess(null)

                                            const testConfig = {
                                                ...formData,
                                                headers: {} as Record<string, string>
                                            }
                                            // Parse headers from text
                                            if (headersText.trim()) {
                                                const lines = headersText.trim().split('\n')
                                                for (const line of lines) {
                                                    const [key, ...valueParts] = line.split(':')
                                                    if (key && valueParts.length > 0) {
                                                        testConfig.headers[key.trim()] = valueParts.join(':').trim()
                                                    }
                                                }
                                            }
                                            const result = await openAIService.testOpenAIConfig(testConfig)
                                            if (result.success) {
                                                setDialogSuccess(`测试成功！响应时间: ${result.response_time_ms}ms`)
                                            } else {
                                                setDialogError(`测试失败: ${result.message}`)
                                            }
                                        } catch (error) {
                                            setDialogError('测试配置时发生错误')
                                        } finally {
                                            setTestingInDialog(false)
                                        }
                                    }}
                                    disabled={testingInDialog}
                                    className={`px-4 py-2 rounded-md flex items-center gap-2 ${testingInDialog
                                        ? 'bg-gray-400 cursor-not-allowed dark:bg-gray-600'
                                        : 'bg-green-500 hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-700'
                                        } text-white`}
                                >
                                    {testingInDialog && (
                                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    )}
                                    {testingInDialog ? '测试中...' : '测试配置'}
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
                                >
                                    {editingConfig ? '更新' : '创建'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
