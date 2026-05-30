'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
    Briefcase,
    ExternalLink,
    ImagePlus,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Settings2,
    Tag,
    Trash2,
    X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
    businessAccountService,
    BusinessCustomFieldType,
    BusinessModule,
    BusinessModulePayload,
    BusinessStatusOption,
} from '@/services/business-account.service'
import {
    Modal,
    ModalBody,
    ModalContent,
    ModalDescription,
    ModalFooter,
    ModalHeader,
    ModalTitle,
} from '@/components/ui/modal'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'

type ModuleFieldDraft = {
    key: string
    type: BusinessCustomFieldType
    value: string
}

type ModuleDraft = {
    name: string
    website: string
    loginUrl: string
    description: string
    logo: string
    color: string
    sortOrder: string
    fields: ModuleFieldDraft[]
    statuses: BusinessStatusOption[]
}

const moduleColors = ['#2563eb', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b']
const statusColors = ['#10b981', '#f59e0b', '#64748b', '#94a3b8', '#ef4444', '#8b5cf6', '#06b6d4']
const fieldTypes: Array<{ value: BusinessCustomFieldType; label: string }> = [
    { value: 'text', label: '文本' },
    { value: 'username', label: '账号' },
    { value: 'password', label: '密码' },
    { value: 'totp', label: '2FA' },
    { value: 'url', label: '网址' },
    { value: 'email', label: '邮箱' },
    { value: 'phone', label: '手机号' },
    { value: 'date', label: '日期' },
    { value: 'number', label: '数字' },
    { value: 'note', label: '长文本' },
]

const builtinStatuses: BusinessStatusOption[] = [
    { value: 'active', label: '正常', color: '#10b981' },
    { value: 'pending', label: '待配置', color: '#f59e0b' },
    { value: 'disabled', label: '停用', color: '#64748b' },
    { value: 'archived', label: '归档', color: '#94a3b8' },
]

function emptyDraft(): ModuleDraft {
    return {
        name: '',
        website: '',
        loginUrl: '',
        description: '',
        logo: '',
        color: moduleColors[0],
        sortOrder: '0',
        fields: [{ key: '', type: 'text', value: '' }],
        statuses: builtinStatuses,
    }
}

function readModuleFields(module: BusinessModule): ModuleFieldDraft[] {
    const raw = module.fieldSchema?.fields
    if (!Array.isArray(raw)) return [{ key: '', type: 'text', value: '' }]
    const fields = raw.map((field: any) => ({
        key: String(field.key || field.name || ''),
        type: fieldTypes.some(item => item.value === field.type) ? field.type as BusinessCustomFieldType : 'text',
        value: String(field.value ?? field.defaultValue ?? ''),
    })).filter(field => field.key || field.value)
    return fields.length ? fields : [{ key: '', type: 'text', value: '' }]
}

function readModuleStatuses(module: BusinessModule): BusinessStatusOption[] {
    const raw = module.statusOptions?.items
    if (!Array.isArray(raw)) return builtinStatuses
    const statuses = raw.map((item: any) => ({
        value: String(item.value || item.label || '').trim(),
        label: String(item.label || item.value || '').trim(),
        color: item.color ? String(item.color) : statusColors[0],
    })).filter(item => item.value && item.label)
    return statuses.length ? statuses : builtinStatuses
}

function moduleToDraft(module: BusinessModule): ModuleDraft {
    return {
        name: module.name || '',
        website: module.website || '',
        loginUrl: module.loginUrl || '',
        description: module.description || '',
        logo: module.logo || '',
        color: module.color || moduleColors[0],
        sortOrder: String(module.sortOrder || 0),
        fields: readModuleFields(module),
        statuses: readModuleStatuses(module),
    }
}

function draftToPayload(draft: ModuleDraft): BusinessModulePayload {
    return {
        name: draft.name.trim(),
        website: draft.website.trim(),
        loginUrl: draft.loginUrl.trim(),
        description: draft.description.trim(),
        logo: draft.logo.trim(),
        color: draft.color,
        sortOrder: Number(draft.sortOrder || 0),
        fieldSchema: {
            fields: draft.fields
                .map(field => ({ key: field.key.trim(), type: field.type, value: field.value }))
                .filter(field => field.key),
        },
        statusOptions: {
            items: draft.statuses
                .map(status => ({ value: status.value.trim(), label: status.label.trim(), color: status.color || statusColors[0] }))
                .filter(status => status.value && status.label),
        },
    }
}

export default function BusinessModulesTab() {
    const [modules, setModules] = useState<BusinessModule[]>([])
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pageSize] = useState(12)
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [modalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState<BusinessModule | null>(null)
    const [draft, setDraft] = useState<ModuleDraft>(emptyDraft)
    const [cropSource, setCropSource] = useState('')
    const [cropScale, setCropScale] = useState(1)
    const [cropX, setCropX] = useState(0)
    const [cropY, setCropY] = useState(0)
    const [cropRadius, setCropRadius] = useState(18)
    const { confirm } = useConfirmDialog()

    const loadModules = useCallback(async () => {
        setLoading(true)
        try {
            const response = await businessAccountService.listModulesPage({ search, page, limit: pageSize })
            setModules(response.data)
            setTotal(response.total)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '加载业务模块失败')
        } finally {
            setLoading(false)
        }
    }, [page, pageSize, search])

    useEffect(() => {
        loadModules()
    }, [loadModules])

    useEffect(() => {
        registerRefreshCallback('business-modules', loadModules)
        return () => unregisterRefreshCallback('business-modules')
    }, [loadModules])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    const openCreate = () => {
        setEditing(null)
        setDraft(emptyDraft())
        setModalOpen(true)
    }

    const openEdit = (module: BusinessModule) => {
        setEditing(module)
        setDraft(moduleToDraft(module))
        setModalOpen(true)
    }

    const saveModule = async () => {
        const payload = draftToPayload(draft)
        if (!payload.name) {
            toast.error('请填写业务模块名称')
            return
        }
        setSaving(true)
        try {
            if (editing) {
                await businessAccountService.updateModule(editing.id, payload)
                toast.success('业务模块已更新')
            } else {
                await businessAccountService.createModule(payload)
                toast.success('业务模块已创建')
            }
            setModalOpen(false)
            await loadModules()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '保存业务模块失败')
        } finally {
            setSaving(false)
        }
    }

    const deleteModule = async (module: BusinessModule) => {
        const ok = await confirm({
            title: '删除业务模块',
            description: `确定删除 ${module.name} 吗？已关联的业务账户会保留，模块关联会被清空。`,
            confirmText: '删除',
            variant: 'destructive',
        })
        if (!ok) return
        try {
            await businessAccountService.deleteModule(module.id)
            toast.success('业务模块已删除')
            await loadModules()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '删除业务模块失败')
        }
    }

    const readLogoFile = (file?: File) => {
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            setCropSource(String(reader.result || ''))
            setCropScale(1)
            setCropX(0)
            setCropY(0)
            setCropRadius(18)
        }
        reader.readAsDataURL(file)
    }

    const applyLogoCrop = async () => {
        if (!cropSource) return
        try {
            const dataUrl = await cropLogoImage(cropSource, {
                scale: cropScale,
                offsetX: cropX,
                offsetY: cropY,
                radius: cropRadius,
            })
            setDraft(prev => ({ ...prev, logo: dataUrl }))
            setCropSource('')
        } catch {
            toast.error('Logo 裁剪失败，请换一张图片试试')
        }
    }

    return (
        <div className="min-h-full bg-gray-50/70 p-5 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
            <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
                        <Settings2 className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold">业务模块</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">配置业务 logo、登录地址、状态和账户扩展字段模板</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={loadModules} className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800">
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                        刷新
                    </button>
                    <button onClick={openCreate} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700">
                        <Plus className="h-4 w-4" />
                        新建模块
                    </button>
                </div>
            </div>

            <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        value={search}
                        onChange={event => {
                            setSearch(event.target.value)
                            setPage(1)
                        }}
                        placeholder="搜索模块名称、网址、描述..."
                        className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                    />
                </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                {loading ? (
                    <div className="py-16 text-center text-gray-500">
                        <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                        正在加载业务模块
                    </div>
                ) : modules.length === 0 ? (
                    <div className="py-16 text-center">
                        <Briefcase className="mx-auto mb-3 h-9 w-9 text-gray-300" />
                        <p className="text-sm font-medium">还没有业务模块</p>
                        <p className="mt-1 text-xs text-gray-500">先创建模块，再给业务账户套用模板。</p>
                    </div>
                ) : (
                    <div>
                        <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
                            <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-950/50 dark:text-gray-400">
                                <tr>
                                    <th className="px-4 py-3 text-left font-medium">模块</th>
                                    <th className="px-4 py-3 text-left font-medium">地址</th>
                                    <th className="px-4 py-3 text-left font-medium">状态</th>
                                    <th className="px-4 py-3 text-left font-medium">字段模板</th>
                                    <th className="px-4 py-3 text-left font-medium">更新时间</th>
                                    <th className="px-4 py-3 text-right font-medium">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {modules.map(module => {
                                    const statuses = readModuleStatuses(module)
                                    const fields = readModuleFields(module).filter(field => field.key)
                                    return (
                                        <tr key={module.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40">
                                            <td className="px-4 py-3">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    {module.logo ? (
                                                        <img src={module.logo} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 object-cover dark:border-gray-800" />
                                                    ) : (
                                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ backgroundColor: module.color || moduleColors[0] }}>
                                                            {module.name.slice(0, 1)}
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <div className="truncate font-semibold">{module.name}</div>
                                                        <div className="mt-0.5 max-w-[360px] truncate text-xs text-gray-500">{module.description || '暂无描述'}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="space-y-1 text-xs">
                                                    {module.website ? <a href={module.website} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 truncate text-blue-600 hover:underline"><ExternalLink className="h-3.5 w-3.5" />官网</a> : <div className="text-gray-400">未配置官网</div>}
                                                    {module.loginUrl ? <a href={module.loginUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 truncate text-gray-500 hover:text-blue-600"><ExternalLink className="h-3.5 w-3.5" />登录地址</a> : <div className="text-gray-400">未配置登录地址</div>}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex max-w-[260px] flex-wrap gap-1.5">
                                                    {statuses.slice(0, 4).map(status => (
                                                        <span key={status.value} className="rounded-full border px-2 py-0.5 text-xs" style={{ color: status.color, borderColor: `${status.color || '#64748b'}55`, backgroundColor: `${status.color || '#64748b'}14` }}>
                                                            {status.label}
                                                        </span>
                                                    ))}
                                                    {statuses.length > 4 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800">+{statuses.length - 4}</span>}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-xs text-gray-600 dark:text-gray-300">{fields.length} 个字段</div>
                                                <div className="mt-1 max-w-[220px] truncate text-xs text-gray-400">{fields.map(field => field.key).join('、') || '暂无字段模板'}</div>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-gray-500">{module.updatedAt ? new Date(module.updatedAt).toLocaleString() : '-'}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-1">
                                                    <button onClick={() => openEdit(module)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800"><Pencil className="h-4 w-4" /></button>
                                                    <button onClick={() => deleteModule(module)} className="rounded-lg p-2 text-gray-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"><Trash2 className="h-4 w-4" /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-500 dark:border-gray-800">
                            <span>显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条，共 {total} 条</span>
                            <div className="flex items-center gap-2">
                                <button disabled={page <= 1} onClick={() => setPage(prev => Math.max(1, prev - 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-50 dark:border-gray-700">上一页</button>
                                <span className="text-xs">{page} / {totalPages}</span>
                                <button disabled={page >= totalPages} onClick={() => setPage(prev => Math.min(totalPages, prev + 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-50 dark:border-gray-700">下一页</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <Modal open={modalOpen} onOpenChange={setModalOpen}>
                <ModalContent size="6xl" className="max-h-[92vh]">
                    <ModalHeader>
                        <ModalTitle>{editing ? '编辑业务模块' : '新建业务模块'}</ModalTitle>
                        <ModalDescription>模块配置会作为业务账户创建时的默认模板。</ModalDescription>
                    </ModalHeader>
                    <ModalBody>
                        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                            <div className="space-y-4">
                                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                                    <div className="mb-3 text-sm font-semibold">Logo</div>
                                    <div className="flex items-center gap-3">
                                        {draft.logo ? (
                                            <img src={draft.logo} alt="" className="h-16 w-16 rounded-lg border border-gray-200 object-cover dark:border-gray-800" />
                                        ) : (
                                            <div className="flex h-16 w-16 items-center justify-center rounded-lg text-white" style={{ backgroundColor: draft.color }}>{draft.name.slice(0, 1) || <ImagePlus className="h-5 w-5" />}</div>
                                        )}
                                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                            <ImagePlus className="h-4 w-4" />
                                            选择图片
                                            <input type="file" accept="image/*" className="hidden" onChange={event => readLogoFile(event.target.files?.[0])} />
                                        </label>
                                    </div>
                                    <input value={draft.logo} onChange={event => setDraft(prev => ({ ...prev, logo: event.target.value }))} placeholder="或粘贴 logo URL / data URL" className={cn(inputClass, 'mt-3')} />
                                </div>

                                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                                    <div className="mb-3 text-sm font-semibold">主题色</div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {moduleColors.map(color => (
                                            <button key={color} onClick={() => setDraft(prev => ({ ...prev, color }))} className={cn('h-8 w-8 rounded-lg border-2', draft.color === color ? 'border-gray-900 dark:border-white' : 'border-transparent')} style={{ backgroundColor: color }} />
                                        ))}
                                        <label className="ml-1 inline-flex h-8 items-center gap-2 rounded-lg border border-gray-200 px-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                                            自定义
                                            <input type="color" value={draft.color || moduleColors[0]} onChange={event => setDraft(prev => ({ ...prev, color: event.target.value }))} className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0" />
                                        </label>
                                    </div>
                                    <input value={draft.color} onChange={event => setDraft(prev => ({ ...prev, color: event.target.value }))} className={cn(inputClass, 'mt-3 font-mono text-xs')} />
                                </div>
                            </div>

                            <div className="space-y-5">
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <Field label="模块名称">
                                        <input value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} className={inputClass} />
                                    </Field>
                                    <Field label="排序">
                                        <input value={draft.sortOrder} onChange={event => setDraft(prev => ({ ...prev, sortOrder: event.target.value }))} className={inputClass} />
                                    </Field>
                                    <Field label="官网地址">
                                        <input value={draft.website} onChange={event => setDraft(prev => ({ ...prev, website: event.target.value }))} className={inputClass} />
                                    </Field>
                                    <Field label="登录地址">
                                        <input value={draft.loginUrl} onChange={event => setDraft(prev => ({ ...prev, loginUrl: event.target.value }))} className={inputClass} />
                                    </Field>
                                    <Field label="描述" className="lg:col-span-2">
                                        <textarea value={draft.description} onChange={event => setDraft(prev => ({ ...prev, description: event.target.value }))} className={textareaClass} />
                                    </Field>
                                </div>

                                <Panel title="自定义状态" description="业务账户选择该模块后，会使用这里配置的状态。">
                                    <div className="space-y-2">
                                        {draft.statuses.map((status, index) => (
                                            <div key={index} className="grid gap-2 md:grid-cols-[150px_150px_130px_minmax(0,1fr)_36px]">
                                                <input value={status.value} onChange={event => setDraft(prev => ({ ...prev, statuses: prev.statuses.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} placeholder="状态值" className={inputClass} />
                                                <input value={status.label} onChange={event => setDraft(prev => ({ ...prev, statuses: prev.statuses.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) }))} placeholder="展示名称" className={inputClass} />
                                                <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-2 text-xs text-gray-500 dark:border-gray-700">
                                                    <input type="color" value={status.color || statusColors[0]} onChange={event => setDraft(prev => ({ ...prev, statuses: prev.statuses.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value } : item) }))} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" />
                                                    颜色
                                                </label>
                                                <input value={status.color || statusColors[0]} onChange={event => setDraft(prev => ({ ...prev, statuses: prev.statuses.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value } : item) }))} placeholder="#10b981" className={cn(inputClass, 'font-mono text-xs')} />
                                                <button onClick={() => setDraft(prev => ({ ...prev, statuses: prev.statuses.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-lg border border-gray-200 text-gray-500 hover:text-rose-600 dark:border-gray-700"><X className="mx-auto h-4 w-4" /></button>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => setDraft(prev => ({ ...prev, statuses: [...prev.statuses, { value: '', label: '', color: statusColors[0] }] }))} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"><Plus className="h-4 w-4" />添加状态</button>
                                </Panel>

                                <Panel title="账户扩展字段模板" description="创建业务账户并选择该模块时，会自动预填充这些字段。">
                                    <div className="space-y-2">
                                        {draft.fields.map((field, index) => (
                                            <div key={index} className="grid gap-2 lg:grid-cols-[160px_120px_minmax(0,1fr)_36px]">
                                                <input value={field.key} onChange={event => setDraft(prev => ({ ...prev, fields: prev.fields.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) }))} placeholder="字段名" className={inputClass} />
                                                <select value={field.type} onChange={event => setDraft(prev => ({ ...prev, fields: prev.fields.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as BusinessCustomFieldType } : item) }))} className={inputClass}>
                                                    {fieldTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                                                </select>
                                                <input value={field.value} onChange={event => setDraft(prev => ({ ...prev, fields: prev.fields.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} placeholder={field.type === 'totp' ? 'Base32 2FA Secret 默认值' : '默认值，可为空'} className={inputClass} />
                                                <button onClick={() => setDraft(prev => ({ ...prev, fields: prev.fields.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-lg border border-gray-200 text-gray-500 hover:text-rose-600 dark:border-gray-700"><X className="mx-auto h-4 w-4" /></button>
                                            </div>
                                        ))}
                                    </div>
                                    <button onClick={() => setDraft(prev => ({ ...prev, fields: [...prev.fields, { key: '', type: 'text', value: '' }] }))} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"><Plus className="h-4 w-4" />添加字段</button>
                                </Panel>
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button onClick={() => setModalOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                        <button onClick={saveModule} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-gray-900">
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            保存模块
                        </button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <Modal open={Boolean(cropSource)} onOpenChange={(open) => !open && setCropSource('')}>
                <ModalContent size="2xl">
                    <ModalHeader>
                        <ModalTitle>裁剪 Logo</ModalTitle>
                        <ModalDescription>调整图片位置、缩放和圆角，保存后会写入模块 logo。</ModalDescription>
                    </ModalHeader>
                    <ModalBody>
                        <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
                            <div className="flex justify-center">
                                <div
                                    className="relative h-56 w-56 overflow-hidden border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-950"
                                    style={{ borderRadius: cropRadius }}
                                >
                                    {cropSource && (
                                        <img
                                            src={cropSource}
                                            alt=""
                                            className="h-full w-full object-cover"
                                            style={{
                                                transform: `translate(${cropX}px, ${cropY}px) scale(${cropScale})`,
                                                transformOrigin: 'center',
                                            }}
                                        />
                                    )}
                                </div>
                            </div>
                            <div className="space-y-4">
                                <SliderField label="缩放" value={cropScale} min={0.7} max={2.2} step={0.05} onChange={setCropScale} />
                                <SliderField label="水平偏移" value={cropX} min={-90} max={90} step={1} onChange={setCropX} />
                                <SliderField label="垂直偏移" value={cropY} min={-90} max={90} step={1} onChange={setCropY} />
                                <SliderField label="圆角" value={cropRadius} min={0} max={112} step={1} onChange={setCropRadius} />
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button onClick={() => setCropSource('')} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                        <button onClick={applyLogoCrop} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900">应用裁剪</button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    )
}

const inputClass = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950'
const textareaClass = 'min-h-[96px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950'

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
    return (
        <label className={cn('block space-y-1.5 text-sm', className)}>
            <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
            {children}
        </label>
    )
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><Tag className="h-4 w-4 text-blue-500" />{title}</h3>
                <p className="mt-1 text-xs text-gray-500">{description}</p>
            </div>
            {children}
        </div>
    )
}

function SliderField({
    label,
    value,
    min,
    max,
    step,
    onChange,
}: {
    label: string
    value: number
    min: number
    max: number
    step: number
    onChange: (value: number) => void
}) {
    return (
        <label className="block space-y-2 text-sm">
            <div className="flex items-center justify-between">
                <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
                <span className="font-mono text-xs text-gray-400">{value}</span>
            </div>
            <input
                type="range"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={event => onChange(Number(event.target.value))}
                className="w-full accent-blue-600"
            />
        </label>
    )
}

function cropLogoImage(source: string, options: { scale: number; offsetX: number; offsetY: number; radius: number }) {
    return new Promise<string>((resolve, reject) => {
        const image = new Image()
        image.onload = () => {
            const size = 320
            const canvas = document.createElement('canvas')
            canvas.width = size
            canvas.height = size
            const context = canvas.getContext('2d')
            if (!context) {
                reject(new Error('Canvas unavailable'))
                return
            }

            context.clearRect(0, 0, size, size)
            roundedRect(context, 0, 0, size, size, Math.min(size / 2, options.radius * (size / 224)))
            context.clip()

            const baseScale = Math.max(size / image.width, size / image.height)
            const drawWidth = image.width * baseScale * options.scale
            const drawHeight = image.height * baseScale * options.scale
            const drawX = (size - drawWidth) / 2 + options.offsetX * (size / 224)
            const drawY = (size - drawHeight) / 2 + options.offsetY * (size / 224)
            context.drawImage(image, drawX, drawY, drawWidth, drawHeight)
            resolve(canvas.toDataURL('image/png'))
        }
        image.onerror = () => reject(new Error('Image load failed'))
        image.src = source
    })
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    const r = Math.min(radius, width / 2, height / 2)
    context.beginPath()
    context.moveTo(x + r, y)
    context.arcTo(x + width, y, x + width, y + height, r)
    context.arcTo(x + width, y + height, x, y + height, r)
    context.arcTo(x, y + height, x, y, r)
    context.arcTo(x, y, x + width, y, r)
    context.closePath()
}
