'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { triggerService } from '@/services/trigger.service'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalTitle,
    ModalDescription
} from '@/components/ui/modal'

interface CreateTriggerModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    trigger?: any
}

export default function CreateTriggerModal({ isOpen, onClose, onSuccess, trigger }: CreateTriggerModalProps) {
    const [triggerName, setTriggerName] = useState('')
    const [description, setDescription] = useState('')
    const [enabled, setEnabled] = useState(true)
    const [executionOrder, setExecutionOrder] = useState(1)

    const [senderEmail, setSenderEmail] = useState('')
    const [subject, setSubject] = useState('')
    const [senderName, setSenderName] = useState('')
    const [recipientName, setRecipientName] = useState('')
    const [hasAttachment, setHasAttachment] = useState(false)
    const [noAttachment, setNoAttachment] = useState(false)
    const [folderTypes, setFolderTypes] = useState<string[]>(['INBOX'])

    const [conditionType, setConditionType] = useState('JavaScript')
    const [conditionScript, setConditionScript] = useState(`// 触发条件示例
// 返回 true 表示满足触发条件
function shouldTrigger(email) {
    if (email.subject && email.subject.includes('重要')) {
        return true;
    }
    return false;
}`)

    const [actions, setActions] = useState([{
        name: '',
        type: '内容修改',
        config: `// 动作配置示例
function executeAction(email) {
    logger.debug('处理邮件:', email.subject);
    return { success: true };
}`,
        enabled: true
    }])

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        if (trigger) {
            setTriggerName(trigger.name || '')
            setDescription(trigger.description || '')
            setEnabled(trigger.enabled !== false)
            setExecutionOrder(trigger.execution_order || 1)

            const filters = trigger.email_filters || {}
            setSenderEmail(filters.sender_email || '')
            setSubject(filters.subject || '')
            setSenderName(filters.sender_name || '')
            setRecipientName(filters.recipient_name || '')
            setHasAttachment(filters.has_attachment || false)
            setNoAttachment(filters.no_attachment || false)
            setFolderTypes(filters.folder_types || ['INBOX'])

            setConditionType(trigger.condition_type || 'JavaScript')
            setConditionScript(trigger.condition_script || '')

            if (trigger.actions && trigger.actions.length > 0) {
                setActions(trigger.actions)
            }
        } else {
            resetForm()
        }
        setError('')
    }, [trigger, isOpen])

    const resetForm = () => {
        setTriggerName('')
        setDescription('')
        setEnabled(true)
        setExecutionOrder(1)
        setSenderEmail('')
        setSubject('')
        setSenderName('')
        setRecipientName('')
        setHasAttachment(false)
        setNoAttachment(false)
        setFolderTypes(['INBOX'])
        setConditionType('JavaScript')
        setConditionScript(`// 触发条件示例
function shouldTrigger(email) {
    if (email.subject && email.subject.includes('重要')) {
        return true;
    }
    return false;
}`)
        setActions([{
            name: '',
            type: '内容修改',
            config: `// 动作配置示例
function executeAction(email) {
    logger.debug('处理邮件:', email.subject);
    return { success: true };
}`,
            enabled: true
        }])
    }

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault()
        setLoading(true)
        setError('')

        try {
            const payload = {
                name: triggerName,
                description,
                status: enabled ? 'enabled' as const : 'disabled' as const,
                check_interval: 60,
                email_address: senderEmail,
                subject,
                from: senderName,
                to: recipientName,
                has_attachment: hasAttachment,
                folders: folderTypes,
                condition: {
                    type: conditionType.toLowerCase(),
                    script: conditionScript,
                    timeout: 30
                },
                actions: actions.map((action, index) => ({
                    type: action.type === '内容修改' ? 'modify_content' as const : 'smtp' as const,
                    name: action.name || `动作${index + 1}`,
                    description: action.name,
                    config: action.config,
                    enabled: action.enabled,
                    order: index + 1
                })),
                enable_logging: true
            }

            if (trigger) {
                await triggerService.updateTrigger(trigger.id, { id: trigger.id, ...payload })
            } else {
                await triggerService.createTrigger(payload)
            }

            onSuccess()
            onClose()
        } catch (err: any) {
            setError(err.message || '操作失败，请重试')
        } finally {
            setLoading(false)
        }
    }

    const addAction = () => {
        setActions([...actions, {
            name: '',
            type: '内容修改',
            config: `// 动作配置
function executeAction(email) {
    return { success: true };
}`,
            enabled: true
        }])
    }

    const removeAction = (index: number) => {
        setActions(actions.filter((_, i) => i !== index))
    }

    const handleActionChange = (index: number, field: string, value: any) => {
        const newActions = [...actions]
        newActions[index] = { ...newActions[index], [field]: value }
        setActions(newActions)
    }

    const handleFolderTypeChange = (type: string, checked: boolean) => {
        if (checked) {
            setFolderTypes([...folderTypes, type])
        } else {
            setFolderTypes(folderTypes.filter(t => t !== type))
        }
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent size="2xl" className="max-h-[90vh] flex flex-col">
                <ModalHeader>
                    <ModalTitle>{trigger ? '编辑触发器' : '创建触发器'}</ModalTitle>
                    <ModalDescription>
                        配置邮件触发规则和执行动作
                    </ModalDescription>
                </ModalHeader>

                <ModalBody className="flex-1 overflow-y-auto space-y-6">
                    {error && (
                        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                            {error}
                        </div>
                    )}

                    {/* 基本信息 */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">基本信息</h3>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="triggerName">触发器名称 *</Label>
                                <Input
                                    id="triggerName"
                                    value={triggerName}
                                    onChange={(e) => setTriggerName(e.target.value)}
                                    placeholder="输入触发器名称"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="executionOrder">执行顺序</Label>
                                <Input
                                    id="executionOrder"
                                    type="number"
                                    value={executionOrder}
                                    onChange={(e) => setExecutionOrder(parseInt(e.target.value) || 1)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">描述</Label>
                            <Textarea
                                id="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={2}
                                placeholder="输入触发器描述（可选）"
                            />
                        </div>

                        <div className="flex items-center space-x-2">
                            <Switch checked={enabled} onCheckedChange={setEnabled} />
                            <Label>启用触发器</Label>
                        </div>
                    </div>

                    {/* 邮件过滤条件 */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">邮件过滤条件</h3>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>发件地址</Label>
                                <Input
                                    value={senderEmail}
                                    onChange={(e) => setSenderEmail(e.target.value)}
                                    placeholder="example@domain.com"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>主题</Label>
                                <Input
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    placeholder="邮件主题关键词"
                                />
                            </div>
                        </div>

                        <div className="flex items-center space-x-6">
                            <div className="flex items-center space-x-2">
                                <Switch checked={hasAttachment} onCheckedChange={setHasAttachment} />
                                <Label>有附件</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch checked={noAttachment} onCheckedChange={setNoAttachment} />
                                <Label>无附件</Label>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>文件夹类型</Label>
                            <div className="flex flex-wrap gap-4">
                                {['INBOX', 'Sent', 'Drafts', 'Trash', 'Spam'].map((type) => (
                                    <div key={type} className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            id={type}
                                            checked={folderTypes.includes(type)}
                                            onChange={(e) => handleFolderTypeChange(type, e.target.checked)}
                                            className="rounded border-gray-300 text-primary-600"
                                        />
                                        <Label htmlFor={type}>{type}</Label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* 触发条件 */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white">触发条件</h3>

                        <div className="space-y-2">
                            <Label>条件类型</Label>
                            <Select value={conditionType} onValueChange={setConditionType}>
                                <SelectTrigger className="w-48">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="JavaScript">JavaScript</SelectItem>
                                    <SelectItem value="Python">Python</SelectItem>
                                    <SelectItem value="Lua">Lua</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>条件脚本 *</Label>
                            <Textarea
                                value={conditionScript}
                                onChange={(e) => setConditionScript(e.target.value)}
                                className="font-mono text-sm h-32"
                                placeholder="输入触发条件脚本"
                            />
                        </div>
                    </div>

                    {/* 触发动作 */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white">触发动作</h3>
                            <Button type="button" variant="outline" size="sm" onClick={addAction}>
                                <Plus className="h-4 w-4 mr-2" />
                                添加动作
                            </Button>
                        </div>

                        {actions.map((action, index) => (
                            <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3 dark:border-gray-600">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-medium text-gray-900 dark:text-white">动作 {index + 1}</h4>
                                    {actions.length > 1 && (
                                        <Button type="button" variant="ghost" size="sm" onClick={() => removeAction(index)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <Label>动作名称</Label>
                                        <Input
                                            value={action.name}
                                            onChange={(e) => handleActionChange(index, 'name', e.target.value)}
                                            placeholder="动作描述（可选）"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>动作类型</Label>
                                        <Select
                                            value={action.type}
                                            onValueChange={(value) => handleActionChange(index, 'type', value)}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="内容修改">内容修改</SelectItem>
                                                <SelectItem value="转发邮件">转发邮件</SelectItem>
                                                <SelectItem value="发送通知">发送通知</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>配置脚本</Label>
                                    <Textarea
                                        value={action.config}
                                        onChange={(e) => handleActionChange(index, 'config', e.target.value)}
                                        className="font-mono text-sm h-24"
                                    />
                                </div>

                                <div className="flex items-center space-x-2">
                                    <Switch
                                        checked={action.enabled}
                                        onCheckedChange={(checked) => handleActionChange(index, 'enabled', checked)}
                                    />
                                    <Label>启用此动作</Label>
                                </div>
                            </div>
                        ))}
                    </div>
                </ModalBody>

                <ModalFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        取消
                    </Button>
                    <Button onClick={() => handleSubmit()} disabled={loading}>
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                处理中...
                            </>
                        ) : (
                            trigger ? '保存' : '创建'
                        )}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}