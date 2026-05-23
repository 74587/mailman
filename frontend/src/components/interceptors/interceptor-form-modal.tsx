'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription } from '@/components/ui/modal'
import {
    Interceptor,
    InterceptorPluginInfo,
    CreateInterceptorRequest,
    UpdateInterceptorRequest,
    createInterceptor,
    updateInterceptor,
    defaultInterceptorConfig,
} from '@/services/interceptor.service'
import { BasicInfoStep } from './form-steps/basic-info-step'
import { PhaseConfigStep } from './form-steps/phase-config-step'
import { FilterConditionStep } from './form-steps/filter-condition-step'
import { ErrorHandlingStep } from './form-steps/error-handling-step'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface InterceptorFormModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    interceptor: Interceptor | null
    plugins: InterceptorPluginInfo[]
    onSaved: () => void
}

const STEPS = [
    { key: 'basic', label: '基本信息' },
    { key: 'phase', label: '执行阶段' },
    { key: 'filter', label: '过滤条件' },
    { key: 'error', label: '错误处理' },
]

export function InterceptorFormModal({
    open,
    onOpenChange,
    interceptor,
    plugins,
    onSaved,
}: InterceptorFormModalProps) {
    const isEdit = !!interceptor
    const [currentStep, setCurrentStep] = useState(0)
    const [saving, setSaving] = useState(false)
    const [formData, setFormData] = useState<Partial<Interceptor>>(defaultInterceptorConfig)

    // 初始化表单数据
    useEffect(() => {
        if (open) {
            if (interceptor) {
                setFormData({ ...interceptor })
            } else {
                setFormData({ ...defaultInterceptorConfig })
            }
            setCurrentStep(0)
        }
    }, [open, interceptor])

    // 更新表单数据
    const updateFormData = (updates: Partial<Interceptor>) => {
        setFormData((prev) => ({ ...prev, ...updates }))
    }

    // 获取当前插件
    const currentPlugin = plugins.find((p) => p.id === formData.plugin_id)

    // 验证当前步骤
    const validateCurrentStep = (): boolean => {
        switch (currentStep) {
            case 0: // 基本信息
                if (!formData.name?.trim()) {
                    toast.error('请输入拦截器名称')
                    return false
                }
                if (!formData.plugin_id) {
                    toast.error('请选择拦截器插件')
                    return false
                }
                return true
            case 1: // 执行阶段
                if (!formData.phases?.before && !formData.phases?.after) {
                    toast.error('请至少启用一个执行阶段')
                    return false
                }
                return true
            case 2: // 过滤条件
                return true
            case 3: // 错误处理
                return true
            default:
                return true
        }
    }

    // 下一步
    const handleNext = () => {
        if (validateCurrentStep()) {
            setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1))
        }
    }

    // 上一步
    const handlePrev = () => {
        setCurrentStep((prev) => Math.max(prev - 1, 0))
    }

    // 保存
    const handleSave = async () => {
        if (!validateCurrentStep()) {
            return
        }

        try {
            setSaving(true)

            if (isEdit && interceptor) {
                const updateData: UpdateInterceptorRequest = {
                    name: formData.name,
                    description: formData.description,
                    plugin_id: formData.plugin_id,
                    plugin_config: formData.plugin_config,
                    enabled: formData.enabled,
                    order: formData.order,
                    phases: formData.phases,
                    filter: formData.filter,
                    error_handling: formData.error_handling,
                    skip_config: formData.skip_config,
                    execution: formData.execution,
                }
                await updateInterceptor(interceptor.id, updateData)
                toast.success('拦截器已更新')
            } else {
                const createData: CreateInterceptorRequest = {
                    name: formData.name!,
                    description: formData.description,
                    plugin_id: formData.plugin_id!,
                    plugin_config: formData.plugin_config,
                    scope: formData.scope || 'global',
                    trigger_id: formData.trigger_id,
                    extractor_id: formData.extractor_id,
                    enabled: formData.enabled ?? true,
                    order: formData.order ?? 100,
                    phases: formData.phases!,
                    filter: formData.filter!,
                    error_handling: formData.error_handling!,
                    skip_config: formData.skip_config!,
                    execution: formData.execution!,
                }
                await createInterceptor(createData)
                toast.success('拦截器已创建')
            }

            onSaved()
        } catch (error) {
            console.error('Failed to save interceptor:', error)
            toast.error('保存失败')
        } finally {
            setSaving(false)
        }
    }

    // 渲染当前步骤内容
    const renderStepContent = () => {
        switch (currentStep) {
            case 0:
                return (
                    <BasicInfoStep
                        formData={formData}
                        plugins={plugins}
                        currentPlugin={currentPlugin}
                        onChange={updateFormData}
                    />
                )
            case 1:
                return (
                    <PhaseConfigStep
                        formData={formData}
                        currentPlugin={currentPlugin}
                        onChange={updateFormData}
                    />
                )
            case 2:
                return <FilterConditionStep formData={formData} onChange={updateFormData} />
            case 3:
                return <ErrorHandlingStep formData={formData} onChange={updateFormData} />
            default:
                return null
        }
    }

    return (
        <Modal open={open} onOpenChange={onOpenChange}>
            <ModalContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                <ModalHeader>
                    <ModalTitle>{isEdit ? '编辑拦截器' : '添加拦截器'}</ModalTitle>
                    <ModalDescription>
                        {isEdit ? '修改拦截器配置' : '创建新的全局拦截器'}
                    </ModalDescription>
                </ModalHeader>

                {/* 步骤指示器 */}
                <div className="px-6 py-4 border-b">
                    <div className="flex items-center justify-between">
                        {STEPS.map((step, index) => (
                            <div
                                key={step.key}
                                className={cn(
                                    'flex items-center gap-2 cursor-pointer transition-colors',
                                    index === currentStep
                                        ? 'text-primary'
                                        : index < currentStep
                                            ? 'text-green-500'
                                            : 'text-muted-foreground'
                                )}
                                onClick={() => {
                                    if (index < currentStep || validateCurrentStep()) {
                                        setCurrentStep(index)
                                    }
                                }}
                            >
                                <div
                                    className={cn(
                                        'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors',
                                        index === currentStep
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : index < currentStep
                                                ? 'border-green-500 bg-green-500 text-white'
                                                : 'border-muted-foreground/30'
                                    )}
                                >
                                    {index < currentStep ? '✓' : index + 1}
                                </div>
                                <span className="text-sm font-medium hidden sm:inline">{step.label}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 步骤内容 */}
                <div className="flex-1 overflow-y-auto px-6 py-4">{renderStepContent()}</div>

                {/* 底部按钮 */}
                <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/30">
                    <Button
                        variant="outline"
                        onClick={handlePrev}
                        disabled={currentStep === 0 || saving}
                    >
                        上一步
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                            取消
                        </Button>
                        {currentStep < STEPS.length - 1 ? (
                            <Button onClick={handleNext} disabled={saving}>
                                下一步
                            </Button>
                        ) : (
                            <Button onClick={handleSave} disabled={saving}>
                                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {isEdit ? '保存更改' : '创建拦截器'}
                            </Button>
                        )}
                    </div>
                </div>
            </ModalContent>
        </Modal>
    )
}
