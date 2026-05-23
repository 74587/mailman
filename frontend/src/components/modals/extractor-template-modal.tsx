'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, GripVertical, Sparkles, Hash, Code, Bug, HelpCircle, Copy, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExtractorTemplate, ExtractorTemplateRequest, ExtractorConfig } from '@/types'
import { extractorTemplateService, TestResult } from '@/services/extractor-template.service'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { ExtractorTemplateTestModal } from './extractor-template-test-modal'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ExtractorConfigWithId extends ExtractorConfig {
    id: string
    testResult?: TestResult
}

interface ExtractorTemplateModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    template?: ExtractorTemplate | null
}

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

function ExtractorItem({
    extractor,
    index,
    onExtractorChange,
    onRemoveExtractor,
    errors
}: {
    extractor: ExtractorConfigWithId
    index: number
    onExtractorChange: (id: string, field: keyof ExtractorConfig, value: any) => void
    onRemoveExtractor: (id: string) => void
    errors: Record<string, string>
}) {
    const dragControls = useDragControls()
    const typeConfig = extractorTypes.find(t => t.value === extractor.type)
    const Icon = typeConfig?.icon || Hash
    const [showHelp, setShowHelp] = useState<Record<string, boolean>>({})
    const [isExpanded, setIsExpanded] = useState(true)

    const toggleHelp = (key: string) => {
        setShowHelp(prev => ({ ...prev, [key]: !prev[key] }))
    }

    return (
        <Reorder.Item
            value={extractor}
            id={extractor.id}
            dragListener={false}
            dragControls={dragControls}
            className="relative"
        >
            <motion.div
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                className="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
            >
                <div
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div
                        className="cursor-move text-gray-400 hover:text-gray-600"
                        onPointerDown={(e) => {
                            e.stopPropagation()
                            dragControls.start(e)
                        }}
                    >
                        <GripVertical className="h-5 w-5" />
                    </div>

                    {isExpanded ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}

                    <Icon className={cn('h-5 w-5', typeConfig?.color)} />
                    <span className="font-medium">{fieldOptions.find(f => f.value === extractor.field)?.label || extractor.field}</span>
                    <span className="text-sm text-gray-500">({typeConfig?.label})</span>

                    <motion.button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation()
                            onRemoveExtractor(extractor.id)
                        }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        className="ml-auto rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                        <Trash2 className="h-4 w-4" />
                    </motion.button>
                </div>

                {isExpanded && (
                    <div className="px-4 pb-4 space-y-4">
                        <div className="flex items-center gap-3">
                            <select
                                value={extractor.field}
                                onChange={(e) => onExtractorChange(extractor.id, 'field', e.target.value)}
                                className="rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                            >
                                {fieldOptions.map(field => (
                                    <option key={field.value} value={field.value}>{field.label}</option>
                                ))}
                            </select>

                            <select
                                value={extractor.type}
                                onChange={(e) => onExtractorChange(extractor.id, 'type', e.target.value)}
                                className="rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                            >
                                {extractorTypes.map(type => (
                                    <option key={type.value} value={type.value}>{type.label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Label>匹配条件 (可选)</Label>
                                <button type="button" onClick={() => toggleHelp(`match_${index}`)} className="text-gray-400 hover:text-gray-600">
                                    <HelpCircle className="h-4 w-4" />
                                </button>
                            </div>
                            <Textarea
                                value={extractor.match || ''}
                                onChange={(e) => onExtractorChange(extractor.id, 'match', e.target.value)}
                                className="font-mono text-sm"
                                placeholder="输入匹配条件..."
                                rows={2}
                            />
                            {showHelp[`match_${index}`] && (
                                <div className="mt-2 p-3 bg-blue-50 rounded-md text-sm dark:bg-blue-900/20">
                                    <p className="font-medium mb-1">匹配条件说明：</p>
                                    <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                                        <li>用于判断是否执行提取操作</li>
                                        <li>返回 false 时将跳过该字段的提取</li>
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Label>提取规则 <span className="text-red-500">*</span></Label>
                                <button type="button" onClick={() => toggleHelp(`extract_${index}`)} className="text-gray-400 hover:text-gray-600">
                                    <HelpCircle className="h-4 w-4" />
                                </button>
                            </div>
                            <Textarea
                                value={extractor.extract || extractor.config || ''}
                                onChange={(e) => {
                                    onExtractorChange(extractor.id, 'extract', e.target.value)
                                    onExtractorChange(extractor.id, 'config', e.target.value)
                                }}
                                className={cn('font-mono text-sm', errors[`extractor_${index}_extract`] && 'border-red-500')}
                                placeholder="输入提取规则..."
                                rows={4}
                            />
                            {errors[`extractor_${index}_extract`] && (
                                <p className="mt-1 text-xs text-red-500">{errors[`extractor_${index}_extract`]}</p>
                            )}
                        </div>

                        {extractor.type === 'regex' && (
                            <div className="bg-gray-100 p-3 rounded-md dark:bg-gray-800">
                                <p className="text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">常用示例：</p>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">提取订单号：</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onExtractorChange(extractor.id, 'extract', '订单号[：:]\\s*(\\d{10})\\n$1')
                                                onExtractorChange(extractor.id, 'config', '订单号[：:]\\s*(\\d{10})\\n$1')
                                            }}
                                            className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                                        >
                                            <Copy className="h-3 w-3" />使用
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </motion.div>
        </Reorder.Item>
    )
}

export function ExtractorTemplateModal({
    isOpen,
    onClose,
    onSuccess,
    template
}: ExtractorTemplateModalProps) {
    const [loading, setLoading] = useState(false)
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [isTestModalOpen, setIsTestModalOpen] = useState(false)
    const [tempTemplate, setTempTemplate] = useState<ExtractorTemplate | null>(null)
    const [extractorsWithId, setExtractorsWithId] = useState<ExtractorConfigWithId[]>([])

    const [form, setForm] = useState<ExtractorTemplateRequest>({
        name: '',
        description: '',
        extractors: []
    })

    const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    useEffect(() => {
        if (isOpen) {
            if (template) {
                setForm({
                    name: template.name,
                    description: template.description || '',
                    extractors: template.extractors
                })
                setExtractorsWithId(template.extractors.map(ext => ({
                    ...ext,
                    id: generateId(),
                    extract: ext.extract || ext.config || '',
                    config: ext.config || ext.extract || ''
                })))
            } else {
                setForm({ name: '', description: '', extractors: [] })
                setExtractorsWithId([])
            }
        } else {
            setErrors({})
            setIsTestModalOpen(false)
            setTempTemplate(null)
        }
    }, [isOpen, template])

    useEffect(() => {
        setForm(prev => ({
            ...prev,
            extractors: extractorsWithId.map(({ id, testResult, ...extractor }) => extractor)
        }))
    }, [extractorsWithId])

    const handleAddExtractor = () => {
        setExtractorsWithId(prev => [
            ...prev,
            { id: generateId(), field: 'ALL', type: 'regex', match: '', extract: '', config: '' }
        ])
    }

    const handleRemoveExtractor = (id: string) => {
        setExtractorsWithId(prev => prev.filter(ext => ext.id !== id))
    }

    const handleExtractorChange = (id: string, field: keyof ExtractorConfig, value: any) => {
        setExtractorsWithId(prev => prev.map(extractor =>
            extractor.id === id ? { ...extractor, [field]: value, testResult: undefined } : extractor
        ))
    }

    const handleReorderExtractors = (newOrder: ExtractorConfigWithId[]) => {
        setExtractorsWithId(newOrder)
    }

    const validateForm = () => {
        const newErrors: Record<string, string> = {}
        if (!form.name.trim()) newErrors.name = '请输入模板名称'
        if (form.extractors.length === 0) newErrors.extractors = '请至少添加一个提取器'
        form.extractors.forEach((extractor, index) => {
            if (!extractor.extract?.trim() && !extractor.config?.trim()) {
                newErrors[`extractor_${index}_extract`] = '请输入提取规则'
            }
        })
        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }

    const handleOpenDebugMode = async () => {
        if (!form.name.trim()) {
            setErrors({ name: '请先输入模板名称' })
            return
        }
        if (form.extractors.length === 0) {
            setErrors({ extractors: '请先添加至少一个提取器' })
            return
        }

        const tempTemplateData: ExtractorTemplate = {
            id: template?.id || 0,
            name: form.name,
            description: form.description || '',
            extractors: form.extractors,
            created_at: template?.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
        }
        setTempTemplate(tempTemplateData)
        setIsTestModalOpen(true)
    }

    const handleSaveFromTest = (updatedTemplate: ExtractorTemplate) => {
        setForm({
            name: updatedTemplate.name,
            description: updatedTemplate.description || '',
            extractors: updatedTemplate.extractors
        })
        setExtractorsWithId(updatedTemplate.extractors.map(ext => ({
            ...ext,
            id: generateId(),
            extract: ext.extract || ext.config || '',
            config: ext.config || ext.extract || ''
        })))
        setIsTestModalOpen(false)
        setTempTemplate(null)
    }

    const handleSubmit = async () => {
        if (!validateForm()) return

        setLoading(true)
        try {
            if (template) {
                await extractorTemplateService.updateTemplate(template.id, form)
            } else {
                await extractorTemplateService.createTemplate(form)
            }
            onSuccess()
            onClose()
        } catch (error: any) {
            setErrors({ submit: error.response?.data?.error || '操作失败' })
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <ModalContent size="2xl" className="max-h-[90vh] flex flex-col">
                    <ModalHeader>
                        <ModalTitle>{template ? '编辑取件模板' : '新建取件模板'}</ModalTitle>
                        <ModalDescription>配置邮件内容提取规则</ModalDescription>
                    </ModalHeader>

                    <ModalBody className="flex-1 overflow-y-auto space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>模板名称 <span className="text-red-500">*</span></Label>
                                <Input
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder="例如：订单信息提取"
                                    className={cn(errors.name && 'border-red-500')}
                                />
                                {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
                            </div>

                            <div className="space-y-2">
                                <Label>模板描述</Label>
                                <Textarea
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    placeholder="描述这个模板的用途..."
                                    rows={2}
                                />
                            </div>
                        </div>

                        <div>
                            <div className="mb-4 flex items-center justify-between">
                                <Label>提取器配置 <span className="text-red-500">*</span></Label>
                                <Button type="button" size="sm" onClick={handleAddExtractor}>
                                    <Plus className="h-4 w-4 mr-2" />
                                    添加提取器
                                </Button>
                            </div>

                            {errors.extractors && <p className="mb-2 text-sm text-red-500">{errors.extractors}</p>}

                            <AnimatePresence>
                                {extractorsWithId.length > 0 ? (
                                    <Reorder.Group
                                        axis="y"
                                        values={extractorsWithId}
                                        onReorder={handleReorderExtractors}
                                        className="space-y-4"
                                    >
                                        {extractorsWithId.map((extractor, index) => (
                                            <ExtractorItem
                                                key={extractor.id}
                                                extractor={extractor}
                                                index={index}
                                                onExtractorChange={handleExtractorChange}
                                                onRemoveExtractor={handleRemoveExtractor}
                                                errors={errors}
                                            />
                                        ))}
                                    </Reorder.Group>
                                ) : (
                                    <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center dark:border-gray-600">
                                        <p className="text-gray-500 dark:text-gray-400">还没有添加提取器，点击上方按钮添加</p>
                                    </div>
                                )}
                            </AnimatePresence>
                        </div>
                    </ModalBody>

                    <ModalFooter>
                        {errors.submit && <p className="text-sm text-red-500 mr-auto">{errors.submit}</p>}
                        <Button variant="outline" onClick={onClose} disabled={loading}>
                            取消
                        </Button>
                        <Button variant="secondary" onClick={handleOpenDebugMode} disabled={loading}>
                            <Bug className="h-4 w-4 mr-2" />
                            调试模式
                        </Button>
                        <Button onClick={handleSubmit} disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    保存中...
                                </>
                            ) : (
                                template ? '更新' : '创建'
                            )}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            {tempTemplate && (
                <ExtractorTemplateTestModal
                    isOpen={isTestModalOpen}
                    onClose={() => {
                        setIsTestModalOpen(false)
                        setTempTemplate(null)
                    }}
                    template={tempTemplate}
                    onSave={handleSaveFromTest}
                />
            )}
        </>
    )
}