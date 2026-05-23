'use client'

import { useState } from 'react'
import { openAIService } from '@/services/openai.service'
import { extractorTemplateService } from '@/services/extractor-template.service'
import type { GenerateEmailTemplateRequest } from '@/types/openai'
import type { ExtractorTemplate } from '@/types'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Loader2, Zap } from 'lucide-react'

interface AITemplateGeneratorModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: (template: ExtractorTemplate) => void
}

export function AITemplateGeneratorModal({ isOpen, onClose, onSuccess }: AITemplateGeneratorModalProps) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [formData, setFormData] = useState<GenerateEmailTemplateRequest>({
        user_input: '',
        template_name: '',
        description: '',
        scenario: 'email_template_generation'
    })
    const [generatedContent, setGeneratedContent] = useState<string | null>(null)

    const handleGenerate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setError(null)
        setGeneratedContent(null)

        try {
            setLoading(true)
            const response = await openAIService.generateEmailTemplate(formData)
            setGeneratedContent(response.generated_content)

            // 获取生成的模板详情
            const template = await extractorTemplateService.getTemplate(response.id)
            onSuccess(template)
            onClose()
        } catch (err: any) {
            setError(err.response?.data?.message || '生成模板失败，请检查 OpenAI 配置是否正确')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent size="2xl">
                <form onSubmit={handleGenerate}>
                    <ModalHeader>
                        <ModalTitle>AI 生成邮件模板</ModalTitle>
                        <ModalDescription>
                            使用 AI 自动生成邮件提取模板
                        </ModalDescription>
                    </ModalHeader>

                    <ModalBody className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="template_name">模板名称</Label>
                            <Input
                                id="template_name"
                                value={formData.template_name}
                                onChange={(e) => setFormData({ ...formData, template_name: e.target.value })}
                                placeholder="例如：订单确认邮件提取器"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">描述（可选）</Label>
                            <Input
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="用于提取订单确认邮件中的关键信息"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="user_input">需求描述</Label>
                            <Textarea
                                id="user_input"
                                value={formData.user_input}
                                onChange={(e) => setFormData({ ...formData, user_input: e.target.value })}
                                placeholder={`请详细描述您想要提取的信息，例如：
我需要从订单确认邮件中提取：
1. 订单号（格式：ORD-XXXXXX）
2. 客户姓名
3. 订单金额
4. 发货地址
5. 预计送达时间`}
                                rows={6}
                                required
                            />
                            <p className="text-sm text-gray-500">
                                请尽可能详细地描述您的需求，包括字段名称、格式示例等
                            </p>
                        </div>

                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                                {error}
                            </div>
                        )}

                        {generatedContent && (
                            <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                                <h4 className="font-medium text-green-800 mb-2">生成成功！</h4>
                                <p className="text-sm text-green-700">
                                    AI 已成功生成邮件提取模板，正在保存...
                                </p>
                            </div>
                        )}
                    </ModalBody>

                    <ModalFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={loading}
                        >
                            取消
                        </Button>
                        <Button
                            type="submit"
                            disabled={loading}
                            className="gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    生成中...
                                </>
                            ) : (
                                <>
                                    <Zap className="h-4 w-4" />
                                    AI 生成
                                </>
                            )}
                        </Button>
                    </ModalFooter>
                </form>
            </ModalContent>
        </Modal>
    )
}
