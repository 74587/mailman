'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { openAIService } from '@/services/openai.service'
import { OpenAIConfig, AIPromptTemplate } from '@/types/openai'
import {
    Settings,
    Sparkles,
    Zap,
    Filter,
    FileText,
    Loader2,
    Save,
    RotateCcw,
    Info,
    AlertCircle,
    Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// AI 设置场景类型
export type AIScenario = 'trigger' | 'filter' | 'action'

// AI 设置配置
export interface AIScenarioConfig {
    configId: number | null       // AI 服务器配置 ID
    templateId: number | null     // 提示词模板 ID
    customPrompt: string          // 自定义提示词（如果不使用模板）
    useTemplate: boolean          // 是否使用模板
    enabled: boolean              // 是否启用 AI 生成
}

// 完整的 AI 设置
export interface TriggerAISettings {
    trigger: AIScenarioConfig     // 触发器名称和描述生成
    filter: AIScenarioConfig      // 过滤器名称和描述生成
    action: AIScenarioConfig      // 动作名称和描述生成
}

// 默认配置
const defaultScenarioConfig: AIScenarioConfig = {
    configId: null,
    templateId: null,
    customPrompt: '',
    useTemplate: true,
    enabled: true,
}

const defaultSettings: TriggerAISettings = {
    trigger: { ...defaultScenarioConfig },
    filter: { ...defaultScenarioConfig },
    action: { ...defaultScenarioConfig },
}

// 场景信息
const scenarioInfo: Record<AIScenario, { label: string; icon: React.ElementType; description: string }> = {
    trigger: {
        label: '触发器',
        icon: Zap,
        description: '根据触发器配置自动生成名称和描述信息',
    },
    filter: {
        label: '过滤器',
        icon: Filter,
        description: '根据过滤条件自动生成名称和描述信息',
    },
    action: {
        label: '动作',
        icon: FileText,
        description: '根据动作配置自动生成名称和描述信息',
    },
}

// 本地存储 Key
const STORAGE_KEY = 'trigger_ai_settings'

// 加载设置
export function loadAISettings(): TriggerAISettings {
    if (typeof window === 'undefined') return defaultSettings
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
            return { ...defaultSettings, ...JSON.parse(stored) }
        }
    } catch (e) {
        console.error('Failed to load AI settings:', e)
    }
    return defaultSettings
}

// 保存设置
export function saveAISettings(settings: TriggerAISettings): void {
    if (typeof window === 'undefined') return
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (e) {
        console.error('Failed to save AI settings:', e)
    }
}

interface AISettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSettingsChange?: (settings: TriggerAISettings) => void
}

export function AISettingsDialog({ open, onOpenChange, onSettingsChange }: AISettingsDialogProps) {
    const [settings, setSettings] = useState<TriggerAISettings>(defaultSettings)
    const [aiConfigs, setAiConfigs] = useState<OpenAIConfig[]>([])
    const [templates, setTemplates] = useState<AIPromptTemplate[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [activeTab, setActiveTab] = useState<AIScenario>('trigger')

    // 加载 AI 配置和模板
    const loadData = useCallback(async () => {
        setIsLoading(true)
        try {
            const [configsData, templatesData] = await Promise.all([
                openAIService.getOpenAIConfigs(),
                openAIService.getPromptTemplates(),
            ])
            setAiConfigs(configsData)
            setTemplates(templatesData)

            // 加载本地设置
            const savedSettings = loadAISettings()
            setSettings(savedSettings)
        } catch (error) {
            console.error('加载 AI 配置失败:', error)
            toast.error('加载 AI 配置失败')
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        if (open) {
            loadData()
        }
    }, [open, loadData])

    // 获取场景对应的模板
    const getTemplatesForScenario = (scenario: AIScenario) => {
        const scenarioMap: Record<AIScenario, string> = {
            trigger: 'trigger_name_description',
            filter: 'filter_name_description',
            action: 'action_name_description',
        }
        return templates.filter(t => t.scenario === scenarioMap[scenario])
    }

    // 更新单个场景的配置
    const updateScenarioConfig = (scenario: AIScenario, updates: Partial<AIScenarioConfig>) => {
        setSettings(prev => ({
            ...prev,
            [scenario]: { ...prev[scenario], ...updates },
        }))
    }

    // 保存设置
    const handleSave = () => {
        setIsSaving(true)
        try {
            saveAISettings(settings)
            onSettingsChange?.(settings)
            toast.success('AI 设置已保存')
            onOpenChange(false)
        } catch (error) {
            console.error('保存 AI 设置失败:', error)
            toast.error('保存设置失败')
        } finally {
            setIsSaving(false)
        }
    }

    // 重置设置
    const handleReset = () => {
        setSettings(defaultSettings)
        toast.success('设置已重置为默认值')
    }

    // 渲染单个场景的配置面板
    const renderScenarioConfig = (scenario: AIScenario) => {
        const config = settings[scenario]
        const info = scenarioInfo[scenario]
        const scenarioTemplates = getTemplatesForScenario(scenario)
        const Icon = info.icon

        return (
            <div className="space-y-6">
                {/* 场景描述 */}
                <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <Info className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div>
                        <h4 className="font-medium text-blue-800 dark:text-blue-300">
                            {info.label}名称和描述生成
                        </h4>
                        <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                            {info.description}
                        </p>
                    </div>
                </div>

                {/* 启用开关 */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5 text-gray-500" />
                        <div>
                            <Label className="font-medium">启用 AI 生成</Label>
                            <p className="text-sm text-gray-500">开启后可在编辑时使用 AI 自动生成</p>
                        </div>
                    </div>
                    <Switch
                        checked={config.enabled}
                        onCheckedChange={(enabled) => updateScenarioConfig(scenario, { enabled })}
                    />
                </div>

                {config.enabled && (
                    <>
                        {/* AI 服务器选择 */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-amber-500" />
                                AI 服务器配置
                            </Label>
                            <Select
                                value={config.configId?.toString() || ''}
                                onValueChange={(value) => updateScenarioConfig(scenario, {
                                    configId: value ? parseInt(value) : null
                                })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="选择 AI 服务器配置" />
                                </SelectTrigger>
                                <SelectContent>
                                    {aiConfigs.length === 0 ? (
                                        <div className="p-4 text-center text-gray-500 text-sm">
                                            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                                            暂无可用的 AI 配置
                                            <p className="text-xs mt-1">请先在系统设置中添加 AI 服务器配置</p>
                                        </div>
                                    ) : (
                                        aiConfigs.map((cfg) => (
                                            <SelectItem key={cfg.id} value={cfg.id.toString()}>
                                                <div className="flex items-center gap-2">
                                                    <span>{cfg.name}</span>
                                                    <Badge variant="outline" className="text-xs">
                                                        {cfg.channel_type}
                                                    </Badge>
                                                    {cfg.is_active && (
                                                        <Badge className="bg-green-100 text-green-700 text-xs">
                                                            默认
                                                        </Badge>
                                                    )}
                                                </div>
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* 提示词配置 */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-purple-500" />
                                    提示词配置
                                </Label>
                                <div className="flex items-center gap-2">
                                    <Label className="text-sm text-gray-500">使用模板</Label>
                                    <Switch
                                        checked={config.useTemplate}
                                        onCheckedChange={(useTemplate) => updateScenarioConfig(scenario, { useTemplate })}
                                    />
                                </div>
                            </div>

                            {config.useTemplate ? (
                                <Select
                                    value={config.templateId?.toString() || ''}
                                    onValueChange={(value) => updateScenarioConfig(scenario, {
                                        templateId: value ? parseInt(value) : null
                                    })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="选择提示词模板" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {scenarioTemplates.length === 0 ? (
                                            <div className="p-4 text-center text-gray-500 text-sm">
                                                <FileText className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                                                暂无可用的模板
                                                <p className="text-xs mt-1">系统将使用内置默认模板</p>
                                            </div>
                                        ) : (
                                            scenarioTemplates.map((tpl) => (
                                                <SelectItem key={tpl.id} value={tpl.id.toString()}>
                                                    <div className="flex items-center gap-2">
                                                        <span>{tpl.name}</span>
                                                        {tpl.is_active && (
                                                            <Badge className="bg-green-100 text-green-700 text-xs">
                                                                <Check className="h-3 w-3 mr-0.5" />
                                                                激活
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <div className="space-y-2">
                                    <Textarea
                                        value={config.customPrompt}
                                        onChange={(e) => updateScenarioConfig(scenario, {
                                            customPrompt: e.target.value
                                        })}
                                        placeholder={`输入用于生成${info.label}名称和描述的自定义提示词...\n\n可用变量:\n- {{.Config}} - 配置信息JSON\n- {{.Type}} - 类型标识`}
                                        className="min-h-[150px] font-mono text-sm"
                                    />
                                    <p className="text-xs text-gray-500">
                                        支持 Go Template 语法，可使用上下文变量
                                    </p>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Settings className="h-5 w-5 text-blue-600" />
                        AI 生成设置
                    </DialogTitle>
                    <DialogDescription>
                        配置触发器、过滤器和动作的 AI 名称描述生成功能
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex-1 flex items-center justify-center py-12">
                        <div className="text-center">
                            <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
                            <p className="mt-4 text-gray-500">加载配置中...</p>
                        </div>
                    </div>
                ) : (
                    <ScrollArea className="flex-1 pr-4">
                        {/* 无 AI 配置警告 */}
                        {aiConfigs.length === 0 && (
                            <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                                <div className="flex items-start gap-3">
                                    <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <h4 className="font-medium text-amber-800 dark:text-amber-300">
                                            未配置 AI 服务器
                                        </h4>
                                        <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                                            要使用 AI 生成功能，请先完成以下配置：
                                        </p>
                                        <ol className="text-sm text-amber-600 dark:text-amber-400 mt-2 list-decimal list-inside space-y-1">
                                            <li>进入「系统设置 → AI 配置」添加 AI 服务器（如 OpenAI、Gemini 等）</li>
                                            <li>返回此页面，在下方选择要使用的 AI 服务器配置</li>
                                            <li>保存设置后，即可在编辑触发器时使用 AI 自动生成功能</li>
                                        </ol>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-3 border-amber-300 text-amber-700 hover:bg-amber-100"
                                            onClick={() => {
                                                window.dispatchEvent(new CustomEvent('switchTab', {
                                                    detail: { tab: 'settings', data: { section: 'ai' } }
                                                }))
                                                onOpenChange(false)
                                            }}
                                        >
                                            前往 AI 配置
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AIScenario)}>
                            <TabsList className="grid w-full grid-cols-3 mb-6">
                                {(Object.keys(scenarioInfo) as AIScenario[]).map((scenario) => {
                                    const info = scenarioInfo[scenario]
                                    const Icon = info.icon
                                    const config = settings[scenario]
                                    return (
                                        <TabsTrigger key={scenario} value={scenario} className="gap-2">
                                            <Icon className="h-4 w-4" />
                                            {info.label}
                                            {config.enabled && (
                                                <Badge variant="secondary" className="text-xs ml-1">
                                                    <Check className="h-3 w-3" />
                                                </Badge>
                                            )}
                                        </TabsTrigger>
                                    )
                                })}
                            </TabsList>

                            {(Object.keys(scenarioInfo) as AIScenario[]).map((scenario) => (
                                <TabsContent key={scenario} value={scenario} className="mt-0">
                                    {renderScenarioConfig(scenario)}
                                </TabsContent>
                            ))}
                        </Tabs>
                    </ScrollArea>
                )}

                <DialogFooter className="flex items-center justify-between pt-4 border-t">
                    <Button variant="outline" onClick={handleReset} disabled={isSaving}>
                        <RotateCcw className="h-4 w-4 mr-2" />
                        重置
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            取消
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    保存中...
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4 mr-2" />
                                    保存设置
                                </>
                            )}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default AISettingsDialog
