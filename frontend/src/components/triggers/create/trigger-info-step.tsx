'use client'
import { logger } from '@/lib/logger';

import React, { useState, useCallback, useEffect } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
    Save,
    CheckCircle,
    XCircle,
    AlertCircle,
    Mail,
    Filter,
    Zap,
    Settings,
    Sparkles
} from 'lucide-react'
import { AIGenerateButton, AIGenerateResult } from '@/components/triggers/ai-generate-button'

interface TriggerInfoStepProps {
    data: any
    onDataChange: (key: string, value: any) => void
    onNext?: () => void
    onPrevious?: () => void
    onSaveSuccess?: () => void  // 保存成功回调
    triggerSave?: number  // 触发保存的计数器，每次增加时触发保存
    readOnly?: boolean
    stepNumber?: number  // 可选的步骤编号，用于编辑模式
}

const STEP_NAMES = ['第一步', '第二步', '第三步', '第四步']

export default function TriggerInfoStep({ data, onDataChange, onNext, onPrevious, onSaveSuccess, triggerSave, readOnly, stepNumber }: TriggerInfoStepProps) {
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    const triggerInfo = data.triggerInfo || {
        name: '',
        description: '',
        enabled: true
    }

    const emailData = data.emailData?.sampleData || {}
    const expressions = data.expressions || []
    const actions = data.actions || []

    // 更新触发器信息
    const handleInfoChange = useCallback((field: string, value: any) => {
        const newTriggerInfo = { ...triggerInfo, [field]: value }
        onDataChange('triggerInfo', newTriggerInfo)
    }, [triggerInfo, onDataChange])

    // 保存触发器
    const handleSave = useCallback(async () => {
        setSaving(true)
        setSaveError(null)

        try {
            await apiClient.post('/v2/triggers', {
                name: triggerInfo.name,
                description: triggerInfo.description,
                enabled: triggerInfo.enabled,
                expressions: expressions,
                actions: actions.map((a: any, index: number) => ({
                    id: a.id || `action_${Date.now()}_${index}`,
                    pluginId: a.pluginId || (a.type === 'modify_content' ? 'email_modify_plugin' : 'email_forward_plugin'),
                    pluginName: a.name,
                    config: typeof a.config === 'string' ? JSON.parse(a.config) : a.config,
                    enabled: a.enabled,
                    executionOrder: typeof a.order === 'number' ? a.order : index
                }))
            })

            // 触发成功回调
            if (onSaveSuccess) {
                onSaveSuccess()
            } else {
                onNext?.()
            }
        } catch (error: any) {
            console.error('保存触发器失败:', error)
            setSaveError(error.message || '保存过程中发生错误')
        } finally {
            setSaving(false)
        }
    }, [triggerInfo, expressions, actions, onNext])

    // 编辑模式下不需要保存（TriggerEditTab 有单独的保存按钮）
    // 所以这里的保存逻辑只用于创建模式
    const isCreateMode = Boolean(onNext && !readOnly)

    // 检查是否可以保存
    const canSave = () => {
        return triggerInfo.name.trim() !== '' &&
            expressions.length > 0 &&
            actions.length > 0
    }

    // 监听外部触发保存
    useEffect(() => {
        if (triggerSave && triggerSave > 0 && canSave() && !saving) {
            handleSave()
        }
    }, [triggerSave])

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    {stepNumber !== undefined ? `${STEP_NAMES[stepNumber]}：触发器信息` : '触发器信息'}
                </CardTitle>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    填写触发器的基本信息并完成创建
                </p>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* 配置摘要 */}
                <div className="space-y-4">
                    <h4 className="font-medium">配置摘要</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className={`p-4 rounded-lg ${emailData && Object.keys(emailData).length > 0
                            ? 'bg-green-50 dark:bg-green-900/20'
                            : 'bg-red-50 dark:bg-red-900/20'
                            }`}>
                            <div className={`flex items-center gap-2 ${emailData && Object.keys(emailData).length > 0
                                ? 'text-green-700 dark:text-green-300'
                                : 'text-red-700 dark:text-red-300'
                                }`}>
                                <Mail className="h-4 w-4" />
                                <span className="font-medium">邮件数据</span>
                            </div>
                            <p className="text-sm mt-1 opacity-80">
                                {emailData && Object.keys(emailData).length > 0 ? (
                                    <span>来源: {data.emailData?.source === 'api' ? 'API获取' : '手动输入'}</span>
                                ) : (
                                    <span>未配置</span>
                                )}
                            </p>
                        </div>

                        <div className={`p-4 rounded-lg ${expressions.length > 0
                            ? 'bg-green-50 dark:bg-green-900/20'
                            : 'bg-red-50 dark:bg-red-900/20'
                            }`}>
                            <div className={`flex items-center gap-2 ${expressions.length > 0
                                ? 'text-green-700 dark:text-green-300'
                                : 'text-red-700 dark:text-red-300'
                                }`}>
                                <Filter className="h-4 w-4" />
                                <span className="font-medium">过滤表达式</span>
                            </div>
                            <p className="text-sm mt-1 opacity-80">
                                {expressions.length > 0 ? `${expressions.length} 个条件` : '未配置'}
                            </p>
                        </div>

                        <div className={`p-4 rounded-lg ${actions.length > 0
                            ? 'bg-green-50 dark:bg-green-900/20'
                            : 'bg-red-50 dark:bg-red-900/20'
                            }`}>
                            <div className={`flex items-center gap-2 ${actions.length > 0
                                ? 'text-green-700 dark:text-green-300'
                                : 'text-red-700 dark:text-red-300'
                                }`}>
                                <Zap className="h-4 w-4" />
                                <span className="font-medium">执行动作</span>
                            </div>
                            <p className="text-sm mt-1 opacity-80">
                                {actions.length > 0 ? `${actions.length} 个动作` : '未配置'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* 触发器基本信息 */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h4 className="font-medium">触发器信息</h4>
                        {!readOnly && (
                            <AIGenerateButton
                                scenario="trigger"
                                context={{
                                    expressions,
                                    actions,
                                }}
                                onGenerate={(result: AIGenerateResult) => {
                                    logger.debug('[TriggerInfoStep] Received AI result:', result)
                                    logger.debug('[TriggerInfoStep] Setting name to:', result.name)
                                    logger.debug('[TriggerInfoStep] Setting description to:', result.description)
                                    // 一次性更新 name 和 description，避免状态更新竞态问题
                                    const newTriggerInfo = {
                                        ...triggerInfo,
                                        name: result.name,
                                        description: result.description,
                                    }
                                    onDataChange('triggerInfo', newTriggerInfo)
                                }}
                                size="sm"
                                className="gap-1 px-3"
                            />
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="trigger-name">触发器名称 *</Label>
                        <Input
                            id="trigger-name"
                            placeholder="输入触发器名称"
                            value={triggerInfo.name}
                            onChange={(e) => handleInfoChange('name', e.target.value)}
                            disabled={readOnly}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="trigger-description">触发器描述</Label>
                        <Textarea
                            id="trigger-description"
                            placeholder="输入触发器描述（可选）"
                            value={triggerInfo.description}
                            onChange={(e) => handleInfoChange('description', e.target.value)}
                            rows={3}
                            disabled={readOnly}
                        />
                    </div>

                    <div className="flex items-center space-x-2">
                        <Switch
                            id="trigger-enabled"
                            checked={triggerInfo.enabled}
                            onCheckedChange={(checked) => handleInfoChange('enabled', checked)}
                            disabled={readOnly}
                        />
                        <Label htmlFor="trigger-enabled">启用触发器</Label>
                    </div>
                </div>

                {/* 详细配置预览 */}
                <div className="space-y-4">
                    <h4 className="font-medium">详细配置预览</h4>

                    {/* 邮件数据详情 */}
                    {emailData && Object.keys(emailData).length > 0 && (
                        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                            <h5 className="font-medium mb-2">邮件数据示例</h5>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="font-medium">主题:</span> {emailData.Subject || emailData.subject || '(无)'}
                                </div>
                                <div>
                                    <span className="font-medium">发件人:</span> {(() => {
                                        const from = emailData.From || emailData.from;
                                        if (Array.isArray(from)) return from[0] || '(无)';
                                        return from || '(无)';
                                    })()}
                                </div>
                                <div>
                                    <span className="font-medium">收件人:</span> {(() => {
                                        const to = emailData.To || emailData.to;
                                        if (Array.isArray(to)) return to.join(', ') || '(无)';
                                        return to || '(无)';
                                    })()}
                                </div>
                                <div>
                                    <span className="font-medium">内容:</span> {(() => {
                                        const body = emailData.Body || emailData.body || emailData.TextBody || emailData.textBody;
                                        if (!body) return '(无)';
                                        return body.length > 30 ? `${body.substring(0, 30)}...` : body;
                                    })()}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 动作列表 */}
                    {actions.length > 0 && (
                        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                            <h5 className="font-medium mb-2">执行动作</h5>
                            <div className="space-y-2">
                                {actions.map((action: any, index: number) => (
                                    <div key={action.id} className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-xs">
                                            {index + 1}
                                        </Badge>
                                        <span className="text-sm">{action.pluginName}</span>
                                        <Badge variant={action.enabled ? "default" : "secondary"} className="text-xs">
                                            {action.enabled ? '启用' : '禁用'}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* 错误消息 */}
                {saveError && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                            <XCircle className="h-4 w-4" />
                            <span className="font-medium">保存失败</span>
                        </div>
                        <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                            {saveError}
                        </p>
                    </div>
                )}

                {/* 验证提示 */}
                {!canSave() && (
                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                        <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-300">
                            <AlertCircle className="h-4 w-4" />
                            <span className="font-medium">请完成必要信息</span>
                        </div>
                        <ul className="text-sm text-yellow-600 dark:text-yellow-400 mt-1 space-y-1">
                            {!triggerInfo.name.trim() && <li>• 触发器名称不能为空</li>}
                            {expressions.length === 0 && <li>• 请配置过滤表达式</li>}
                            {actions.length === 0 && <li>• 请配置执行动作</li>}
                        </ul>
                    </div>
                )}

                {/* 导航按钮 - 只有当提供了 onNext/onPrevious 且没有 onSaveSuccess 时才显示（用于非 wizard 模式） */}
                {(onNext || onPrevious) && !onSaveSuccess && (
                    <div className="flex justify-between items-center pt-4">
                        <Button
                            onClick={onPrevious}
                            variant="outline"
                            disabled={saving || !onPrevious}
                        >
                            返回上一步
                        </Button>

                        <Button
                            onClick={handleSave}
                            disabled={!canSave() || saving || !onNext}
                        >
                            <Save className="h-4 w-4 mr-2" />
                            {saving ? '保存中...' : '保存触发器'}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}