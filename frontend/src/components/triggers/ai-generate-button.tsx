'use client'
import { logger } from '@/lib/logger';

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { Sparkles, Loader2 } from 'lucide-react'
import { openAIService } from '@/services/openai.service'
import { loadAISettings, AIScenario } from './ai-settings-dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// AI 生成结果
export interface AIGenerateResult {
    name: string
    description: string
}

interface AIGenerateButtonProps {
    scenario: AIScenario
    context: Record<string, any>  // 上下文数据，用于生成提示词
    onGenerate: (result: AIGenerateResult) => void
    disabled?: boolean
    className?: string
    size?: 'sm' | 'default' | 'lg' | 'icon'
}

// 默认提示词模板
const defaultPrompts: Record<AIScenario, string> = {
    trigger: `你是一个专业的邮件自动化助手。请根据以下触发器配置信息，生成一个简洁明了的名称和描述。

触发器配置:
{{CONFIG}}

请生成:
1. 名称: 简洁的中文名称，不超过20个字符，能够清晰表达触发器的用途
2. 描述: 详细的中文描述，说明这个触发器的作用和触发条件

请以JSON格式返回:
{"name": "触发器名称", "description": "触发器描述"}`,

    filter: `你是一个专业的邮件自动化助手。请根据以下过滤条件配置，生成一个简洁明了的名称和描述。

过滤器配置:
{{CONFIG}}

请生成:
1. 名称: 简洁的中文名称，不超过15个字符，能够清晰表达过滤条件
2. 描述: 简短的中文描述，说明这个过滤器匹配什么样的邮件

请以JSON格式返回:
{"name": "过滤器名称", "description": "过滤器描述"}`,

    action: `你是一个专业的邮件自动化助手。请根据以下动作配置信息，生成一个简洁明了的名称和描述。

动作配置:
- 插件类型: {{PLUGIN_ID}}
- 插件名称: {{PLUGIN_NAME}}
- 配置参数: {{CONFIG}}

请生成:
1. 名称: 简洁的中文名称，不超过15个字符，能够清晰表达动作的作用
2. 描述: 简短的中文描述，说明这个动作会执行什么操作

请以JSON格式返回:
{"name": "动作名称", "description": "动作描述"}`,
}

// 场景标签
const scenarioLabels: Record<AIScenario, string> = {
    trigger: '触发器',
    filter: '过滤器',
    action: '动作',
}

export function AIGenerateButton({
    scenario,
    context,
    onGenerate,
    disabled = false,
    className,
    size = 'icon',
}: AIGenerateButtonProps) {
    const [isGenerating, setIsGenerating] = useState(false)

    const handleGenerate = async () => {
        const settings = loadAISettings()
        const config = settings[scenario]

        if (!config.enabled) {
            toast.error(`${scenarioLabels[scenario]} AI 生成未启用，请在设置中开启`)
            return
        }

        setIsGenerating(true)
        try {
            // 构建提示词
            let prompt = config.useTemplate
                ? defaultPrompts[scenario]
                : config.customPrompt || defaultPrompts[scenario]

            // 替换模板变量
            if (scenario === 'action') {
                prompt = prompt
                    .replace('{{PLUGIN_ID}}', context.pluginId || '')
                    .replace('{{PLUGIN_NAME}}', context.pluginName || '')
                    .replace('{{CONFIG}}', JSON.stringify(context.config || {}, null, 2))
            } else {
                prompt = prompt.replace('{{CONFIG}}', JSON.stringify(context, null, 2))
            }

            // 调用 AI 接口
            const response = await openAIService.callOpenAI({
                config_id: config.configId || 0,
                template_id: config.templateId || undefined,
                user_message: prompt,
                max_tokens: 500,
                temperature: 0.7,
                response_format: 'json',
            })

            // 解析响应
            let result: AIGenerateResult
            try {
                // 尝试从响应中提取 JSON
                const content = response.content.trim()
                logger.debug('[AI Generate] Raw content:', content)

                // 处理可能包含 markdown 代码块的情况
                const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                    content.match(/```\s*([\s\S]*?)\s*```/) ||
                    [null, content]
                const jsonStr = (jsonMatch[1] || content).trim()
                logger.debug('[AI Generate] Extracted JSON string:', jsonStr)

                result = JSON.parse(jsonStr)
                logger.debug('[AI Generate] Parsed result:', result)
            } catch (parseError) {
                console.error('解析 AI 响应失败:', parseError, response.content)
                // 尝试简单提取
                const nameMatch = response.content.match(/"name"\s*:\s*"([^"]+)"/)
                const descMatch = response.content.match(/"description"\s*:\s*"([^"]+)"/)
                if (nameMatch && descMatch) {
                    result = { name: nameMatch[1], description: descMatch[1] }
                    logger.debug('[AI Generate] Fallback result:', result)
                } else {
                    throw new Error('无法解析 AI 响应')
                }
            }

            logger.debug('[AI Generate] Calling onGenerate with:', result)
            onGenerate(result)
            toast.success(`已生成${scenarioLabels[scenario]}名称和描述`)
        } catch (error: any) {
            console.error('AI 生成失败:', error)

            // 检查是否是配置未找到的错误
            const errorMessage = error.message || error.toString() || ''
            if (errorMessage.includes('Configuration not found') ||
                errorMessage.includes('configuration not found') ||
                errorMessage.includes('config not found')) {
                toast.error(
                    '未找到 AI 服务器配置。请先在「系统设置 → AI 配置」中添加 AI 服务器，然后在「AI 设置」中选择要使用的服务器。',
                    { duration: 6000 }
                )
            } else if (errorMessage.includes('template not found') ||
                errorMessage.includes('Template not found')) {
                toast.error(
                    '未找到提示词模板。请在「系统设置 → AI 配置 → 提示词模板」中配置模板。',
                    { duration: 5000 }
                )
            } else if (errorMessage.includes('API key') ||
                errorMessage.includes('api_key') ||
                errorMessage.includes('unauthorized')) {
                toast.error(
                    'AI 服务调用失败，请检查 API Key 是否正确配置。',
                    { duration: 5000 }
                )
            } else {
                toast.error(
                    `AI 生成失败: ${errorMessage || '请检查 AI 服务器配置是否正确'}`,
                    { duration: 4000 }
                )
            }
        } finally {
            setIsGenerating(false)
        }
    }

    const settings = loadAISettings()
    const isEnabled = settings[scenario].enabled

    if (!isEnabled) {
        return null
    }

    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size={size}
                        onClick={handleGenerate}
                        disabled={disabled || isGenerating}
                        className={cn(
                            "text-purple-600 hover:text-purple-700 hover:bg-purple-50",
                            "dark:text-purple-400 dark:hover:bg-purple-900/20",
                            className
                        )}
                    >
                        {isGenerating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Sparkles className="h-4 w-4" />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>使用 AI 生成名称和描述</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export default AIGenerateButton
