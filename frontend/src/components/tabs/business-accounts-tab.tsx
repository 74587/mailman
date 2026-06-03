'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
    Briefcase,
    CalendarClock,
    ChevronDown,
    Copy,
    ExternalLink,
    Eye,
    EyeOff,
    Globe2,
    KeyRound,
    Loader2,
    Mail,
    Pencil,
    Phone,
    Plus,
    RefreshCw,
    Save,
    Search,
    ShieldCheck,
    StickyNote,
    Tag,
    Trash2,
    UserRound,
    X,
    type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { emailAccountService } from '@/services/email-account.service'
import {
    businessAccountService,
    BusinessAccount,
    BusinessAccountPayload,
    BusinessAccountStatus,
    BusinessCustomFieldType,
    BusinessStatusOption,
    BusinessModule,
} from '@/services/business-account.service'
import type { AccountNoteFormat, EmailAccount } from '@/types'
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
import { AccountNoteEditor } from '@/components/accounts/account-note-editor'
import {
    AccountNotePreview,
    normalizeAccountNoteFormat,
    openAccountNoteStandalonePreview,
} from '@/components/accounts/account-note-preview'

type AccountDraft = {
    emailAccountId: string
    moduleId: string
    moduleName: string
    displayName: string
    website: string
    loginUrl: string
    username: string
    password: string
    totpSecret: string
    phoneNumber: string
    recoveryEmail: string
    recoveryCodes: string
    status: BusinessAccountStatus
    description: string
    note: string
    noteFormat: AccountNoteFormat
    tags: string
    customFields: Array<{ key: string; type: BusinessCustomFieldType; value: string }>
}

const moduleColors = ['#2563eb', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b']
const customFieldTypes: Array<{ value: BusinessCustomFieldType; label: string }> = [
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

const allowedCustomFieldTypes = new Set(customFieldTypes.map(item => item.value))
const builtinStatusOptions: BusinessStatusOption[] = [
    { value: 'active', label: '正常', color: '#10b981' },
    { value: 'pending', label: '待配置', color: '#f59e0b' },
    { value: 'disabled', label: '停用', color: '#64748b' },
    { value: 'archived', label: '归档', color: '#94a3b8' },
]

function emptyAccountDraft(): AccountDraft {
    return {
        emailAccountId: '',
        moduleId: '',
        moduleName: '',
        displayName: '',
        website: '',
        loginUrl: '',
        username: '',
        password: '',
        totpSecret: '',
        phoneNumber: '',
        recoveryEmail: '',
        recoveryCodes: '',
        status: 'active',
        description: '',
        note: '',
        noteFormat: 'markdown',
        tags: '',
        customFields: [{ key: '', type: 'text', value: '' }],
    }
}

function accountToDraft(account: BusinessAccount): AccountDraft {
    const customFields = normalizeCustomFields(account.customFields || {})
    return {
        emailAccountId: account.emailAccountId ? String(account.emailAccountId) : '',
        moduleId: account.moduleId ? String(account.moduleId) : '',
        moduleName: account.moduleName || '',
        displayName: account.displayName || '',
        website: account.website || '',
        loginUrl: account.loginUrl || '',
        username: account.username || '',
        password: account.password || '',
        totpSecret: account.totpSecret || '',
        phoneNumber: account.phoneNumber || '',
        recoveryEmail: account.recoveryEmail || '',
        recoveryCodes: (account.recoveryCodes || []).join('\n'),
        status: account.status || 'active',
        description: account.description || '',
        note: account.note || '',
        noteFormat: normalizeAccountNoteFormat(account.noteFormat),
        tags: (account.tags || []).join(', '),
        customFields: customFields.length ? customFields : [{ key: '', type: 'text', value: '' }],
    }
}

function splitValues(value: string, separator: RegExp) {
    return value.split(separator).map(item => item.trim()).filter(Boolean)
}

function normalizeCustomFields(fields: Record<string, any>) {
    return Object.entries(fields).map(([key, raw]) => {
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const fieldType = String(raw.type || 'text') as BusinessCustomFieldType
            return {
                key,
                type: allowedCustomFieldTypes.has(fieldType) ? fieldType : 'text',
                value: String(raw.value ?? ''),
            }
        }
        return {
            key,
            type: 'text' as BusinessCustomFieldType,
            value: String(raw ?? ''),
        }
    })
}

function getAccountCustomFields(account: BusinessAccount) {
    return normalizeCustomFields(account.customFields || {})
}

function getModuleStatusOptions(module?: BusinessModule | null): BusinessStatusOption[] {
    const rawItems = module?.statusOptions?.items
    if (Array.isArray(rawItems)) {
        const custom = rawItems
            .map((item: any) => ({
                value: String(item.value || item.label || '').trim(),
                label: String(item.label || item.value || '').trim(),
                color: item.color ? String(item.color) : undefined,
            }))
            .filter(item => item.value && item.label)
        if (custom.length) return custom
    }
    return builtinStatusOptions
}

function getStatusMeta(status: string | undefined, module?: BusinessModule | null) {
    const options = getModuleStatusOptions(module)
    const option = options.find(item => item.value === status) || builtinStatusOptions.find(item => item.value === status)
    if (option) return option
    return { value: status || 'active', label: status || '正常', color: '#64748b' }
}

function getModuleFieldTemplate(module?: BusinessModule | null) {
    const rawFields = module?.fieldSchema?.fields
    if (!Array.isArray(rawFields)) return []
    return rawFields
        .map((field: any) => {
            const fieldType = String(field.type || 'text') as BusinessCustomFieldType
            return {
                key: String(field.key || field.name || '').trim(),
                type: allowedCustomFieldTypes.has(fieldType) ? fieldType : 'text',
                value: String(field.value ?? field.defaultValue ?? ''),
            }
        })
        .filter(field => field.key)
}

function mergeCustomFieldTemplate(current: AccountDraft['customFields'], template: AccountDraft['customFields']) {
    const existing = new Set(current.map(field => field.key.trim()).filter(Boolean))
    const additions = template.filter(field => !existing.has(field.key))
    return additions.length ? [...current.filter(field => field.key || field.value), ...additions] : current
}

function draftToPayload(draft: AccountDraft): BusinessAccountPayload {
    const customFields = draft.customFields.reduce<Record<string, { type: BusinessCustomFieldType; value: string }>>((acc, field) => {
        const key = field.key.trim()
        if (key) acc[key] = { type: field.type, value: field.value }
        return acc
    }, {})

    const payload: BusinessAccountPayload = {
        emailAccountId: draft.emailAccountId ? Number(draft.emailAccountId) : undefined,
        moduleId: draft.moduleId ? Number(draft.moduleId) : undefined,
        moduleName: draft.moduleId ? undefined : draft.moduleName.trim(),
        displayName: draft.displayName.trim(),
        website: draft.website.trim(),
        loginUrl: draft.loginUrl.trim(),
        username: draft.username.trim(),
        password: draft.password,
        totpSecret: draft.totpSecret,
        phoneNumber: draft.phoneNumber.trim(),
        recoveryEmail: draft.recoveryEmail.trim(),
        recoveryCodes: splitValues(draft.recoveryCodes, /\n/),
        status: draft.status,
        description: draft.description.trim(),
        note: draft.note,
        noteFormat: draft.noteFormat,
        tags: splitValues(draft.tags, /[,，]/),
        customFields,
    }

    Object.keys(payload).forEach(key => {
        const value = payload[key as keyof BusinessAccountPayload]
        if (value === undefined || value === '') delete payload[key as keyof BusinessAccountPayload]
    })
    return payload
}

function safeDate(value?: string) {
    if (!value) return '-'
    return new Date(value).toLocaleString()
}

function getModuleName(account: BusinessAccount) {
    return account.module?.name || account.moduleName || '未命名业务'
}

function getAccountEmail(account: BusinessAccount) {
    return account.emailAccount?.emailAddress || (account.emailAccountId ? `邮箱 #${account.emailAccountId}` : '未绑定邮箱')
}

function maskValue(value?: string) {
    if (!value) return '-'
    if (value.length <= 4) return '••••'
    return `${value.slice(0, 2)}••••${value.slice(-2)}`
}

function base32ToBytes(secret: string) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const clean = secret.toUpperCase().replace(/[\s=-]/g, '')
    let bits = ''
    for (const char of clean) {
        const value = alphabet.indexOf(char)
        if (value < 0) throw new Error('Invalid base32 secret')
        bits += value.toString(2).padStart(5, '0')
    }
    const bytes: number[] = []
    for (let index = 0; index + 8 <= bits.length; index += 8) {
        bytes.push(parseInt(bits.slice(index, index + 8), 2))
    }
    return new Uint8Array(bytes)
}

function counterToBytes(counter: number) {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    const high = Math.floor(counter / 0x100000000)
    const low = counter >>> 0
    view.setUint32(0, high)
    view.setUint32(4, low)
    return buffer
}

async function generateTotp(secret: string, digits = 6, period = 30) {
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
        throw new Error('WebCrypto unavailable')
    }
    const keyData = base32ToBytes(secret)
    if (!keyData.length) throw new Error('Empty TOTP secret')
    const counter = Math.floor(Date.now() / 1000 / period)
    const key = await window.crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
    const signature = new Uint8Array(await window.crypto.subtle.sign('HMAC', key, counterToBytes(counter)))
    const offset = signature[signature.length - 1] & 0xf
    const binary = ((signature[offset] & 0x7f) << 24) |
        ((signature[offset + 1] & 0xff) << 16) |
        ((signature[offset + 2] & 0xff) << 8) |
        (signature[offset + 3] & 0xff)
    return String(binary % 10 ** digits).padStart(digits, '0')
}

export default function BusinessAccountsTab() {
    const [modules, setModules] = useState<BusinessModule[]>([])
    const [accounts, setAccounts] = useState<BusinessAccount[]>([])
    const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([])
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<BusinessAccountStatus | ''>('')
    const [moduleId, setModuleId] = useState<number | undefined>()
    const [emailLinked, setEmailLinked] = useState<'' | 'linked' | 'unlinked'>('')
    const [page, setPage] = useState(1)
    const [pageSize] = useState(30)
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [showSecrets, setShowSecrets] = useState(true)
    const [accountModalOpen, setAccountModalOpen] = useState(false)
    const [editingAccount, setEditingAccount] = useState<BusinessAccount | null>(null)
    const [accountDraft, setAccountDraft] = useState<AccountDraft>(emptyAccountDraft)
    const [selectedDraftModule, setSelectedDraftModule] = useState<BusinessModule | null>(null)
    const [notePreviewAccount, setNotePreviewAccount] = useState<BusinessAccount | null>(null)
    const [noteMode, setNoteMode] = useState<'preview' | 'edit'>('preview')
    const [noteDraft, setNoteDraft] = useState('')
    const [noteFormatDraft, setNoteFormatDraft] = useState<AccountNoteFormat>('markdown')
    const [noteSaving, setNoteSaving] = useState(false)
    const { confirm } = useConfirmDialog()

    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            const [moduleList, accountList, emailList] = await Promise.all([
                businessAccountService.listModules('', { limit: 200 }),
                businessAccountService.listAccounts({
                    page,
                    limit: pageSize,
                    search,
                    status,
                    moduleId,
                    emailLinked: emailLinked === '' ? '' : emailLinked === 'linked',
                }),
                emailAccountService.getAccounts(),
            ])
            setModules(moduleList)
            setAccounts(accountList.data)
            setTotal(accountList.total)
            setEmailAccounts(emailList)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '加载业务账户失败')
        } finally {
            setLoading(false)
        }
    }, [emailLinked, moduleId, page, pageSize, search, status])

    useEffect(() => {
        loadData()
    }, [loadData])

    useEffect(() => {
        registerRefreshCallback('business-accounts', loadData)
        return () => unregisterRefreshCallback('business-accounts')
    }, [loadData])

    const draftStatusOptions = useMemo(() => getModuleStatusOptions(selectedDraftModule), [selectedDraftModule])

    const statusFilterOptions = useMemo(() => {
        const byValue = new Map<string, BusinessStatusOption>()
        builtinStatusOptions.forEach(item => byValue.set(item.value, item))
        modules.forEach(module => getModuleStatusOptions(module).forEach(item => byValue.set(item.value, item)))
        accounts.forEach(account => {
            const meta = getStatusMeta(account.status, account.module)
            byValue.set(meta.value, meta)
        })
        return Array.from(byValue.values())
    }, [accounts, modules])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    const openCreateAccount = () => {
        setEditingAccount(null)
        setAccountDraft(emptyAccountDraft())
        setSelectedDraftModule(null)
        setAccountModalOpen(true)
    }

    const openEditAccount = (account: BusinessAccount) => {
        setEditingAccount(account)
        setAccountDraft(accountToDraft(account))
        setSelectedDraftModule(account.module || null)
        setAccountModalOpen(true)
    }

    const selectModuleForDraft = (module: BusinessModule | null) => {
        setSelectedDraftModule(module)
        setAccountDraft(prev => {
            if (!module) {
                return { ...prev, moduleId: '' }
            }
            const statusOptions = getModuleStatusOptions(module)
            return {
                ...prev,
                moduleId: String(module.id),
                moduleName: module.name,
                website: prev.website || module.website || '',
                loginUrl: prev.loginUrl || module.loginUrl || '',
                status: statusOptions.some(item => item.value === prev.status) ? prev.status : statusOptions[0]?.value || 'active',
                customFields: mergeCustomFieldTemplate(prev.customFields, getModuleFieldTemplate(module)),
            }
        })
    }

    const jumpToEmailAccount = (email?: string) => {
        if (!email) return
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: 'accounts',
                data: { search: email },
            },
        }))
    }

    const openNoteDialog = (account: BusinessAccount, mode: 'preview' | 'edit' = 'preview') => {
        setNotePreviewAccount(account)
        setNoteMode(mode)
        setNoteDraft(account.note || '')
        setNoteFormatDraft(normalizeAccountNoteFormat(account.noteFormat))
    }

    const closeNoteDialog = () => {
        setNotePreviewAccount(null)
        setNoteMode('preview')
        setNoteDraft('')
        setNoteFormatDraft('markdown')
        setNoteSaving(false)
    }

    const saveNote = async () => {
        if (!notePreviewAccount) return
        setNoteSaving(true)
        try {
            await businessAccountService.updateAccount(notePreviewAccount.id, {
                note: noteDraft,
                noteFormat: noteFormatDraft,
            })
            toast.success('备注已保存')
            closeNoteDialog()
            await loadData()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '保存备注失败')
        } finally {
            setNoteSaving(false)
        }
    }

    const openStandaloneNotePreview = () => {
        if (!notePreviewAccount) return
        openAccountNoteStandalonePreview({
            note: noteMode === 'edit' ? noteDraft : notePreviewAccount.note || '',
            format: noteMode === 'edit' ? noteFormatDraft : notePreviewAccount.noteFormat,
            title: `${notePreviewAccount.displayName || getModuleName(notePreviewAccount)} 业务备注`,
        })
    }

    const saveAccount = async () => {
        const payload = draftToPayload(accountDraft)
        if (!payload.moduleId && !payload.moduleName) {
            toast.error('请选择业务模块，或填写新的模块名称')
            return
        }
        setSaving(true)
        try {
            if (editingAccount) {
                await businessAccountService.updateAccount(editingAccount.id, payload)
                toast.success('业务账户已更新')
            } else {
                await businessAccountService.createAccount(payload)
                toast.success('业务账户已创建')
            }
            setAccountModalOpen(false)
            await loadData()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '保存业务账户失败')
        } finally {
            setSaving(false)
        }
    }

    const deleteAccount = async (account: BusinessAccount) => {
        const ok = await confirm({
            title: '删除业务账户',
            description: `确定删除 ${account.displayName || getModuleName(account)} 吗？该操作不会删除邮箱账户。`,
            confirmText: '删除',
            variant: 'destructive',
        })
        if (!ok) return
        try {
            await businessAccountService.deleteAccount(account.id)
            toast.success('业务账户已删除')
            await loadData()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '删除失败')
        }
    }

    const copyText = async (value?: string) => {
        if (!value) return
        await navigator.clipboard.writeText(value)
        toast.success('已复制')
    }

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50/70 p-5 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
            <div className="mb-4 flex shrink-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                        <Briefcase className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold">业务账户</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">围绕邮箱统一管理站点账号、密码、2FA、手机号和扩展资料</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setShowSecrets(prev => !prev)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800">
                        {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {showSecrets ? '隐藏敏感' : '显示敏感'}
                    </button>
                    <button onClick={loadData} className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800">
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                        刷新
                    </button>
                    <button onClick={openCreateAccount} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                        <Plus className="h-4 w-4" />
                        新增业务账户
                    </button>
                </div>
            </div>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="z-20 flex shrink-0 flex-col gap-2 border-b border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 lg:flex-row lg:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                            value={search}
                            onChange={event => {
                                setSearch(event.target.value)
                                setPage(1)
                            }}
                            placeholder="搜索业务、站点、邮箱、用户名、描述..."
                            className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                        />
                    </div>
                    <select
                        value={moduleId || ''}
                        onChange={event => {
                            setModuleId(event.target.value ? Number(event.target.value) : undefined)
                            setPage(1)
                        }}
                        className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                    >
                        <option value="">全部模块</option>
                        {modules.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}
                    </select>
                    <select
                        value={status}
                        onChange={event => {
                            setStatus(event.target.value as BusinessAccountStatus | '')
                            setPage(1)
                        }}
                        className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                    >
                        <option value="">全部状态</option>
                        {statusFilterOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <select
                        value={emailLinked}
                        onChange={event => {
                            setEmailLinked(event.target.value as '' | 'linked' | 'unlinked')
                            setPage(1)
                        }}
                        className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                    >
                        <option value="">全部邮箱关联</option>
                        <option value="linked">已关联邮箱</option>
                        <option value="unlinked">未关联邮箱</option>
                    </select>
                    <button onClick={openCreateAccount} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100">
                        <Plus className="h-4 w-4" />
                        新增
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-[13px] dark:divide-gray-800">
                        <thead className="sticky top-0 z-10 bg-gray-50 text-xs text-gray-500 shadow-[0_1px_0_0_rgba(229,231,235,1)] dark:bg-gray-950 dark:text-gray-400 dark:shadow-[0_1px_0_0_rgba(31,41,55,1)]">
                            <tr>
                                <th className="px-3 py-2 text-left font-medium">业务</th>
                                <th className="px-3 py-2 text-left font-medium">关联邮箱</th>
                                <th className="px-3 py-2 text-left font-medium">站点</th>
                                <th className="px-3 py-2 text-left font-medium">凭据</th>
                                <th className="px-3 py-2 text-left font-medium">扩展信息</th>
                                <th className="px-3 py-2 text-left font-medium">状态</th>
                                <th className="px-3 py-2 text-left font-medium">更新时间</th>
                                <th className="px-3 py-2 text-right font-medium">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="px-3 py-16 text-center text-gray-500">
                                        <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                                        正在加载业务账户
                                    </td>
                                </tr>
                            ) : accounts.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-3 py-16 text-center">
                                        <Briefcase className="mx-auto mb-3 h-9 w-9 text-gray-300" />
                                        <p className="text-sm font-medium">还没有业务账户</p>
                                        <p className="mt-1 text-xs text-gray-500">可以先新建业务模块，再把站点账号绑定到邮箱。</p>
                                    </td>
                                </tr>
                            ) : accounts.map((account, index) => (
                                <motion.tr
                                    key={account.id}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.02 }}
                                    className="hover:bg-gray-50/80 dark:hover:bg-gray-800/50"
                                >
                                    <td className="px-3 py-2 align-top">
                                        <div className="flex min-w-0 items-start gap-2">
                                            <ModuleAvatar module={account.module} fallback={getModuleName(account)} />
                                            <div className="min-w-0">
                                                <div className="max-w-[260px] truncate font-medium leading-5">{account.displayName || getModuleName(account)}</div>
                                                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs leading-4 text-gray-500">
                                                    <span>{getModuleName(account)}</span>
                                                    {(account.tags || []).slice(0, 2).map(tag => (
                                                        <span key={tag} className="inline-flex items-center gap-1 rounded border border-gray-200 px-1 py-0.5 dark:border-gray-700">
                                                            <Tag className="h-3 w-3" />
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 align-top">
                                        {account.emailAccount?.emailAddress ? (
                                            <button
                                                type="button"
                                                onClick={() => jumpToEmailAccount(account.emailAccount?.emailAddress)}
                                                className="max-w-[220px] truncate text-left font-medium leading-5 text-blue-600 hover:underline"
                                                title={account.emailAccount.emailAddress}
                                            >
                                                {account.emailAccount.emailAddress}
                                            </button>
                                        ) : (
                                            <div className="max-w-[220px] truncate font-medium leading-5 text-gray-400">{getAccountEmail(account)}</div>
                                        )}
                                        {account.emailAccount?.mailProvider?.name && <div className="text-xs leading-4 text-gray-500">{account.emailAccount.mailProvider.name}</div>}
                                    </td>
                                    <td className="px-3 py-2 align-top">
                                        <div className="flex flex-col gap-0.5">
                                            {account.website ? <a href={account.website} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate text-blue-600 hover:underline"><Globe2 className="h-3.5 w-3.5" />{account.website}</a> : <span className="text-gray-400">未配置</span>}
                                            {account.loginUrl && <a href={account.loginUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[220px] items-center gap-1 truncate text-xs text-gray-500 hover:text-blue-600"><ExternalLink className="h-3 w-3" />登录地址</a>}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 align-top">
                                        <div className="space-y-0.5 text-xs leading-4">
                                            <SecretLine icon={UserRound} label="账号" value={account.username} showSecrets={true} onCopy={copyText} />
                                            <SecretLine icon={KeyRound} label="密码" value={account.password} showSecrets={showSecrets} onCopy={copyText} sensitive />
                                            {account.totpSecret ? (
                                                <TotpCode secret={account.totpSecret} showSecret={showSecrets} onCopy={copyText} compact />
                                            ) : (
                                                <div className="flex items-center gap-1.5 text-gray-400"><ShieldCheck className="h-3 w-3" />2FA：-</div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 align-top">
                                        <div className="flex max-w-[380px] flex-wrap items-center gap-1 text-xs leading-4 text-gray-600 dark:text-gray-300">
                                            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                                <Phone className="h-3 w-3 shrink-0 text-gray-400" />
                                                <span className="max-w-[150px] truncate">{account.phoneNumber || '无手机号'}</span>
                                            </span>
                                            {getAccountCustomFields(account).slice(0, 3).map(field => (
                                                <CustomFieldPreview key={field.key} field={field} showSecrets={showSecrets} onCopy={copyText} />
                                            ))}
                                            {getAccountCustomFields(account).length > 3 && <span className="text-gray-400">+{getAccountCustomFields(account).length - 3} 个字段</span>}
                                            <button
                                                type="button"
                                                onClick={() => openNoteDialog(account, account.note ? 'preview' : 'edit')}
                                                className={cn(
                                                    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs transition',
                                                    account.note
                                                        ? 'border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300'
                                                        : 'border-gray-200 text-gray-400 hover:text-blue-600 dark:border-gray-700'
                                                )}
                                            >
                                                <StickyNote className="h-3 w-3" />
                                                {account.note ? '查看备注' : '添加备注'}
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 align-top">
                                        <StatusBadge status={account.status} module={account.module} />
                                    </td>
                                    <td className="px-3 py-2 align-top text-xs text-gray-500">
                                        <div className="flex items-center gap-1.5 whitespace-nowrap"><CalendarClock className="h-3.5 w-3.5" />{safeDate(account.updatedAt)}</div>
                                    </td>
                                    <td className="px-3 py-2 align-top">
                                        <div className="flex items-center justify-end gap-1">
                                            <button onClick={() => openEditAccount(account)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800"><Pencil className="h-4 w-4" /></button>
                                            <button onClick={() => deleteAccount(account)} className="rounded-lg p-1.5 text-gray-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"><Trash2 className="h-4 w-4" /></button>
                                        </div>
                                    </td>
                                </motion.tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="z-20 flex shrink-0 flex-col gap-2 border-t border-gray-100 bg-white px-3 py-2 text-sm text-gray-500 shadow-[0_-6px_16px_rgba(15,23,42,0.04)] dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
                    <span>显示第 {total === 0 ? 0 : (page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条，共 {total} 条</span>
                    <div className="flex items-center gap-2">
                        <button disabled={page <= 1} onClick={() => setPage(prev => Math.max(1, prev - 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-50 dark:border-gray-700">上一页</button>
                        <span className="text-xs">{page} / {totalPages}</span>
                        <button disabled={page >= totalPages} onClick={() => setPage(prev => Math.min(totalPages, prev + 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-50 dark:border-gray-700">下一页</button>
                    </div>
                </div>
            </section>

            <Modal open={accountModalOpen} onOpenChange={setAccountModalOpen}>
                <ModalContent size="6xl" className="max-h-[92vh]">
                    <ModalHeader>
                        <ModalTitle>{editingAccount ? '编辑业务账户' : '新增业务账户'}</ModalTitle>
                        <ModalDescription>敏感字段会按明文保存到数据库，并在列表与详情中按当前显示状态回显。</ModalDescription>
                    </ModalHeader>
                    <ModalBody className="p-0">
                        <div className="grid min-h-[520px] lg:grid-cols-[260px_minmax(0,1fr)]">
                            <div className="border-b border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-950/50 lg:border-b-0 lg:border-r">
                                <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                                    <ModuleAvatar module={selectedDraftModule} fallback={accountDraft.moduleName || accountDraft.displayName || '业务'} />
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">{accountDraft.displayName || accountDraft.moduleName || '新业务账户'}</div>
                                        <div className="mt-1 truncate text-xs opacity-80">{emailAccounts.find(item => String(item.id) === accountDraft.emailAccountId)?.emailAddress || '未绑定邮箱'}</div>
                                    </div>
                                </div>
                                <div className="mt-4 space-y-2 text-sm">
                                    {[
                                        { icon: Briefcase, label: '业务模块', active: !!(accountDraft.moduleId || accountDraft.moduleName) },
                                        { icon: Globe2, label: '站点与登录', active: !!(accountDraft.website || accountDraft.loginUrl) },
                                        { icon: KeyRound, label: '凭据', active: !!(accountDraft.username || accountDraft.password) },
                                        { icon: ShieldCheck, label: '安全资料', active: !!(accountDraft.totpSecret || accountDraft.recoveryCodes) },
                                        { icon: Tag, label: '备注与扩展', active: !!(accountDraft.note || accountDraft.customFields.some(field => field.key)) },
                                    ].map(item => (
                                        <div key={item.label} className="flex items-center gap-2 rounded-lg px-3 py-2 text-gray-600 dark:text-gray-300">
                                            <item.icon className={cn('h-4 w-4', item.active ? 'text-blue-500' : 'text-gray-400')} />
                                            <span>{item.label}</span>
                                            {item.active && <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">已配置</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="overflow-y-auto p-5">
                                <div className="grid gap-4 lg:grid-cols-2">
                                    <Field label="关联邮箱">
                                        <SearchableSelect
                                            value={accountDraft.emailAccountId}
                                            placeholder="搜索或选择邮箱账户"
                                            emptyLabel="不绑定邮箱账户"
                                            options={emailAccounts.map(account => ({
                                                value: String(account.id),
                                                label: account.emailAddress,
                                                description: account.mailProvider?.name || account.mailProvider?.type || '邮箱账户',
                                                icon: Mail,
                                            }))}
                                            onChange={value => setAccountDraft(prev => ({ ...prev, emailAccountId: value }))}
                                        />
                                    </Field>
                                    <Field label="状态">
                                        <select value={accountDraft.status} onChange={event => setAccountDraft(prev => ({ ...prev, status: event.target.value as BusinessAccountStatus }))} className={inputClass}>
                                            {draftStatusOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="业务模块">
                                        <RemoteBusinessModuleSelect
                                            value={accountDraft.moduleId}
                                            selectedModule={selectedDraftModule}
                                            placeholder="搜索或选择业务模块"
                                            emptyLabel="手动填写模块名"
                                            onChange={selectModuleForDraft}
                                        />
                                    </Field>
                                    <Field label="模块名">
                                        <input value={accountDraft.moduleName} onChange={event => setAccountDraft(prev => ({ ...prev, moduleName: event.target.value, moduleId: event.target.value ? '' : prev.moduleId }))} placeholder="例如 Shopify / GitHub / Stripe" className={inputClass} />
                                    </Field>
                                    <Field label="显示名称">
                                        <input value={accountDraft.displayName} onChange={event => setAccountDraft(prev => ({ ...prev, displayName: event.target.value }))} placeholder="业务账户在列表中的名称" className={inputClass} />
                                    </Field>
                                    <Field label="标签">
                                        <input value={accountDraft.tags} onChange={event => setAccountDraft(prev => ({ ...prev, tags: event.target.value }))} placeholder="用逗号分隔，例如 支付, 海外业务" className={inputClass} />
                                    </Field>
                                    <Field label="网站">
                                        <input value={accountDraft.website} onChange={event => setAccountDraft(prev => ({ ...prev, website: event.target.value }))} placeholder="https://example.com" className={inputClass} />
                                    </Field>
                                    <Field label="登录地址">
                                        <input value={accountDraft.loginUrl} onChange={event => setAccountDraft(prev => ({ ...prev, loginUrl: event.target.value }))} placeholder="https://example.com/login" className={inputClass} />
                                    </Field>
                                    <Field label="账号/用户名">
                                        <input value={accountDraft.username} onChange={event => setAccountDraft(prev => ({ ...prev, username: event.target.value }))} className={inputClass} />
                                    </Field>
                                    <Field label="密码">
                                        <div className="flex gap-2">
                                            <input type={showSecrets ? 'text' : 'password'} value={accountDraft.password} onChange={event => setAccountDraft(prev => ({ ...prev, password: event.target.value }))} className={inputClass} />
                                            <button type="button" onClick={() => setShowSecrets(prev => !prev)} className="rounded-lg border border-gray-200 px-3 dark:border-gray-700">{showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                                            <button type="button" onClick={() => copyText(accountDraft.password)} className="rounded-lg border border-gray-200 px-3 dark:border-gray-700"><Copy className="h-4 w-4" /></button>
                                        </div>
                                    </Field>
                                    <Field label="2FA Secret">
                                        <div className="space-y-2">
                                            <div className="flex gap-2">
                                                <input type={showSecrets ? 'text' : 'password'} value={accountDraft.totpSecret} onChange={event => setAccountDraft(prev => ({ ...prev, totpSecret: event.target.value }))} className={inputClass} />
                                                <button type="button" onClick={() => copyText(accountDraft.totpSecret)} className="rounded-lg border border-gray-200 px-3 dark:border-gray-700"><Copy className="h-4 w-4" /></button>
                                            </div>
                                            {accountDraft.totpSecret && <TotpCode secret={accountDraft.totpSecret} showSecret={showSecrets} onCopy={copyText} />}
                                        </div>
                                    </Field>
                                    <Field label="手机号">
                                        <input value={accountDraft.phoneNumber} onChange={event => setAccountDraft(prev => ({ ...prev, phoneNumber: event.target.value }))} className={inputClass} />
                                    </Field>
                                    <Field label="恢复邮箱">
                                        <input value={accountDraft.recoveryEmail} onChange={event => setAccountDraft(prev => ({ ...prev, recoveryEmail: event.target.value }))} className={inputClass} />
                                    </Field>
                                    <Field label="恢复码" className="lg:col-span-2">
                                        <textarea value={accountDraft.recoveryCodes} onChange={event => setAccountDraft(prev => ({ ...prev, recoveryCodes: event.target.value }))} placeholder="一行一个恢复码" className={textareaClass} />
                                    </Field>
                                    <Field label="描述" className="lg:col-span-2">
                                        <textarea value={accountDraft.description} onChange={event => setAccountDraft(prev => ({ ...prev, description: event.target.value }))} className={textareaClass} />
                                    </Field>
                                    <Field label="备注" className="lg:col-span-2">
                                        <AccountNoteEditor
                                            value={accountDraft.note}
                                            format={accountDraft.noteFormat}
                                            onValueChange={note => setAccountDraft(prev => ({ ...prev, note }))}
                                            onFormatChange={noteFormat => setAccountDraft(prev => ({ ...prev, noteFormat }))}
                                            className="min-h-[360px]"
                                        />
                                    </Field>
                                </div>
                                <div className="mt-5 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                                    <div className="mb-3 flex items-center justify-between">
                                        <div>
                                            <h3 className="text-sm font-semibold">自定义字段</h3>
                                            <p className="text-xs text-gray-500">用于保存创建时间、业务编号、套餐、地区等额外数据。</p>
                                        </div>
                                        <button onClick={() => setAccountDraft(prev => ({ ...prev, customFields: [...prev.customFields, { key: '', type: 'text', value: '' }] }))} className="rounded-lg border border-gray-200 px-2 py-1 text-xs dark:border-gray-700">
                                            添加字段
                                        </button>
                                    </div>
                                    <div className="space-y-2">
                                        {accountDraft.customFields.map((field, index) => (
                                            <div key={index} className="grid gap-2 lg:grid-cols-[160px_120px_minmax(0,1fr)_36px]">
                                                <input value={field.key} onChange={event => setAccountDraft(prev => ({ ...prev, customFields: prev.customFields.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) }))} placeholder="字段名" className={inputClass} />
                                                <select value={field.type} onChange={event => setAccountDraft(prev => ({ ...prev, customFields: prev.customFields.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as BusinessCustomFieldType } : item) }))} className={inputClass}>
                                                    {customFieldTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
                                                </select>
                                                <div className="space-y-1">
                                                    {field.type === 'note' ? (
                                                        <textarea value={field.value} onChange={event => setAccountDraft(prev => ({ ...prev, customFields: prev.customFields.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} placeholder="字段值" className={cn(textareaClass, 'min-h-[72px]')} />
                                                    ) : (
                                                        <input type={(field.type === 'password' || field.type === 'totp') && !showSecrets ? 'password' : field.type === 'date' ? 'date' : 'text'} value={field.value} onChange={event => setAccountDraft(prev => ({ ...prev, customFields: prev.customFields.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} placeholder={field.type === 'totp' ? 'Base32 2FA Secret' : '字段值'} className={inputClass} />
                                                    )}
                                                    {field.type === 'totp' && field.value && <TotpCode secret={field.value} showSecret={showSecrets} onCopy={copyText} />}
                                                </div>
                                                <button onClick={() => setAccountDraft(prev => ({ ...prev, customFields: prev.customFields.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-lg border border-gray-200 text-gray-500 hover:text-rose-600 dark:border-gray-700"><X className="mx-auto h-4 w-4" /></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button onClick={() => setAccountModalOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                        <button onClick={saveAccount} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-gray-900">
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            {editingAccount ? '保存更改' : '创建业务账户'}
                        </button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <Modal open={Boolean(notePreviewAccount)} onOpenChange={(open) => !open && closeNoteDialog()}>
                <ModalContent size="6xl" className="max-h-[92vh]">
                    <ModalHeader>
                        <ModalTitle className="flex items-center gap-2">
                            <StickyNote className="h-5 w-5 text-blue-500" />
                            业务账户备注
                        </ModalTitle>
                        <ModalDescription>{notePreviewAccount ? `${notePreviewAccount.displayName || getModuleName(notePreviewAccount)} · ${getModuleName(notePreviewAccount)}` : ''}</ModalDescription>
                    </ModalHeader>
                    <ModalBody>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 text-sm dark:border-gray-800 dark:bg-gray-950">
                                <button onClick={() => setNoteMode('preview')} className={cn('rounded-md px-3 py-1.5', noteMode === 'preview' && 'bg-white shadow-sm dark:bg-gray-800')}>预览</button>
                                <button onClick={() => setNoteMode('edit')} className={cn('rounded-md px-3 py-1.5', noteMode === 'edit' && 'bg-white shadow-sm dark:bg-gray-800')}>编辑</button>
                            </div>
                            <button onClick={openStandaloneNotePreview} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                <ExternalLink className="h-4 w-4" />
                                浏览器 Tab
                            </button>
                        </div>
                        {noteMode === 'edit' ? (
                            <AccountNoteEditor
                                value={noteDraft}
                                format={noteFormatDraft}
                                onValueChange={setNoteDraft}
                                onFormatChange={setNoteFormatDraft}
                                className="min-h-[560px]"
                            />
                        ) : (
                            <div className="h-[560px] resize-y overflow-auto rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
                                <AccountNotePreview
                                    note={notePreviewAccount?.note || ''}
                                    format={notePreviewAccount?.noteFormat}
                                    emptyText="暂未填写备注"
                                    className="h-full"
                                />
                            </div>
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <button onClick={closeNoteDialog} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">关闭</button>
                        {noteMode === 'edit' && (
                            <button onClick={saveNote} disabled={noteSaving} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-gray-900">
                                {noteSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                保存备注
                            </button>
                        )}
                    </ModalFooter>
                </ModalContent>
            </Modal>

        </div>
    )
}

const inputClass = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950'
const textareaClass = 'min-h-[96px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950'

function SecretLine({
    icon: Icon,
    label,
    value,
    showSecrets,
    sensitive = false,
    onCopy,
}: {
    icon: LucideIcon
    label: string
    value?: string
    showSecrets: boolean
    sensitive?: boolean
    onCopy: (value?: string) => void
}) {
    const displayValue = value ? (sensitive && !showSecrets ? maskValue(value) : value) : '-'
    return (
        <div className="group flex min-w-0 items-center gap-1.5 text-gray-700 dark:text-gray-200">
            <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <span className="shrink-0 text-gray-400">{label}：</span>
            <span className="min-w-0 max-w-[210px] truncate font-mono">{displayValue}</span>
            {value && (
                <button onClick={() => onCopy(value)} className="rounded p-0.5 text-gray-300 opacity-0 transition hover:text-blue-600 group-hover:opacity-100">
                    <Copy className="h-3 w-3" />
                </button>
            )}
        </div>
    )
}

function TotpCode({
    secret,
    showSecret,
    onCopy,
    compact = false,
}: {
    secret?: string
    showSecret: boolean
    onCopy: (value?: string) => void
    compact?: boolean
}) {
    const [code, setCode] = useState('')
    const [remaining, setRemaining] = useState(30)
    const [error, setError] = useState('')

    useEffect(() => {
        let mounted = true
        const refresh = async () => {
            if (!secret) {
                setCode('')
                setError('')
                return
            }
            setRemaining(30 - (Math.floor(Date.now() / 1000) % 30))
            try {
                const nextCode = await generateTotp(secret)
                if (!mounted) return
                setCode(nextCode)
                setError('')
            } catch {
                if (!mounted) return
                setCode('')
                setError('2FA Secret 无法解析')
            }
        }
        refresh()
        const timer = window.setInterval(refresh, 1000)
        return () => {
            mounted = false
            window.clearInterval(timer)
        }
    }, [secret])

    if (!secret) return null

    return (
        <div className={cn('rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200', compact && 'border-0 bg-transparent px-0 py-0 dark:bg-transparent')}>
            <div className="flex min-w-0 items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <span className="shrink-0 text-emerald-600 dark:text-emerald-300">2FA：</span>
                {error ? (
                    <span className="truncate text-amber-600 dark:text-amber-300">{error}</span>
                ) : (
                    <>
                        <span className={cn('font-mono font-semibold tracking-wider text-emerald-700 dark:text-emerald-200', compact ? 'text-xs' : 'text-sm')}>{code || '------'}</span>
                        <span className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">{remaining}s</span>
                        {code && (
                            <button onClick={() => onCopy(code)} className="rounded p-0.5 text-emerald-500 hover:text-emerald-700">
                                <Copy className="h-3 w-3" />
                            </button>
                        )}
                        {showSecret && compact && (
                            <span className="min-w-0 max-w-[120px] truncate font-mono text-[11px] text-emerald-700/80 dark:text-emerald-200/70" title={secret}>
                                Secret: {secret}
                            </span>
                        )}
                    </>
                )}
            </div>
            {showSecret && !compact && (
                <div className="mt-1 max-w-[260px] truncate font-mono text-[11px] text-emerald-700/80 dark:text-emerald-200/70">
                    Secret: {secret}
                </div>
            )}
            {!error && !compact && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900/60">
                    <div className="h-full rounded-full bg-emerald-500 transition-all duration-1000" style={{ width: `${(remaining / 30) * 100}%` }} />
                </div>
            )}
        </div>
    )
}

function CustomFieldPreview({
    field,
    showSecrets,
    onCopy,
}: {
    field: { key: string; type: BusinessCustomFieldType; value: string }
    showSecrets: boolean
    onCopy: (value?: string) => void
}) {
    if (!field.key) return null
    if (field.type === 'totp') {
        return (
            <div className="inline-flex min-w-0 items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 dark:bg-gray-800">
                <span className="shrink-0 text-gray-400">{field.key}：</span>
                <TotpCode secret={field.value} showSecret={showSecrets} onCopy={onCopy} compact />
            </div>
        )
    }
    if (field.type === 'url' && field.value) {
        return (
            <a href={field.value} target="_blank" rel="noreferrer" className="inline-flex min-w-0 max-w-[220px] items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-blue-600 hover:underline dark:bg-blue-950/30">
                <Globe2 className="h-3 w-3 shrink-0" />
                <span className="shrink-0 text-gray-400">{field.key}：</span>
                <span className="truncate">{field.value}</span>
            </a>
        )
    }
    const sensitive = field.type === 'password'
    const displayValue = field.value ? (sensitive && !showSecrets ? maskValue(field.value) : field.value) : '-'
    const Icon = field.type === 'phone' ? Phone : field.type === 'email' ? Mail : field.type === 'password' ? KeyRound : Tag
    return (
        <button
            type="button"
            onClick={() => field.value && onCopy(field.value)}
            className="inline-flex min-w-0 max-w-[220px] items-center gap-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-left hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700"
            title={`${field.key}: ${displayValue}`}
        >
            <Icon className="h-3 w-3 shrink-0 text-gray-400" />
            <span className="shrink-0 text-gray-400">{field.key}：</span>
            <span className="truncate font-mono">{displayValue}</span>
        </button>
    )
}

function ModuleAvatar({
    module,
    fallback,
    size = 'md',
}: {
    module?: BusinessModule | null
    fallback?: string
    size?: 'sm' | 'md'
}) {
    const sizeClass = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-8 w-8 text-sm'
    if (module?.logo) {
        return <img src={module.logo} alt="" className={cn(sizeClass, 'shrink-0 rounded object-cover ring-1 ring-gray-200 dark:ring-gray-800')} />
    }
    return (
        <span
            className={cn(sizeClass, 'flex shrink-0 items-center justify-center rounded font-semibold text-white')}
            style={{ backgroundColor: module?.color || moduleColors[0] }}
        >
            {(fallback || module?.name || '业').slice(0, 1)}
        </span>
    )
}

function StatusBadge({ status, module }: { status?: string; module?: BusinessModule | null }) {
    const meta = getStatusMeta(status, module)
    const color = meta.color || '#64748b'
    return (
        <span
            className="inline-flex rounded-full border px-2 py-1 text-xs font-medium"
            style={{
                borderColor: `${color}55`,
                backgroundColor: `${color}14`,
                color,
            }}
        >
            {meta.label}
        </span>
    )
}

type SearchableSelectOption = {
    value: string
    label: string
    description?: string
    logo?: string
    color?: string
    icon?: LucideIcon
}

function SearchableSelect({
    value,
    options,
    placeholder,
    emptyLabel,
    onChange,
}: {
    value: string
    options: SearchableSelectOption[]
    placeholder: string
    emptyLabel: string
    onChange: (value: string) => void
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const ref = useRef<HTMLDivElement>(null)
    const selected = options.find(option => option.value === value)
    const filtered = options.filter(option => {
        const q = query.trim().toLowerCase()
        if (!q) return true
        return `${option.label} ${option.description || ''}`.toLowerCase().includes(q)
    })

    useEffect(() => {
        const handleOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', handleOutside)
        return () => document.removeEventListener('mousedown', handleOutside)
    }, [])

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => {
                    setOpen(prev => !prev)
                    setQuery('')
                }}
                className={cn(inputClass, 'flex items-center justify-between text-left')}
            >
                <span className={cn('min-w-0 truncate', !selected && 'text-gray-400')}>
                    {selected?.label || emptyLabel}
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-400 transition', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="absolute left-0 top-[calc(100%+0.35rem)] z-50 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    <div className="border-b border-gray-100 p-2 dark:border-gray-800">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder={placeholder}
                                autoFocus
                                className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                            />
                        </div>
                    </div>
                    <div className="max-h-64 overflow-y-auto py-1">
                        <button
                            type="button"
                            onClick={() => {
                                onChange('')
                                setOpen(false)
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                            {emptyLabel}
                        </button>
                        {filtered.map(option => {
                            const Icon = option.icon
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                        onChange(option.value)
                                        setOpen(false)
                                    }}
                                    className={cn(
                                        'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800',
                                        value === option.value && 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                                    )}
                                >
                                    {option.logo ? (
                                        <img src={option.logo} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
                                    ) : (
                                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-800" style={{ color: option.color }}>
                                            {Icon ? <Icon className="h-4 w-4" /> : option.label.slice(0, 1)}
                                        </span>
                                    )}
                                    <span className="min-w-0">
                                        <span className="block truncate font-medium">{option.label}</span>
                                        {option.description && <span className="block truncate text-xs text-gray-400">{option.description}</span>}
                                    </span>
                                </button>
                            )
                        })}
                        {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-gray-400">没有匹配项</div>}
                    </div>
                </div>
            )}
        </div>
    )
}

function RemoteBusinessModuleSelect({
    value,
    selectedModule,
    placeholder,
    emptyLabel,
    onChange,
}: {
    value: string
    selectedModule: BusinessModule | null
    placeholder: string
    emptyLabel: string
    onChange: (module: BusinessModule | null) => void
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [loading, setLoading] = useState(false)
    const [options, setOptions] = useState<BusinessModule[]>([])
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', handleOutside)
        return () => document.removeEventListener('mousedown', handleOutside)
    }, [])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        const timer = window.setTimeout(async () => {
            setLoading(true)
            try {
                const modules = await businessAccountService.listModules(query, { limit: 30 })
                if (!cancelled) setOptions(modules)
            } catch (error) {
                if (!cancelled) toast.error(error instanceof Error ? error.message : '加载业务模块失败')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }, 180)
        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [open, query])

    const selectedLabel = selectedModule?.name || (value ? `业务模块 #${value}` : '')

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => {
                    setOpen(prev => !prev)
                    setQuery('')
                }}
                className={cn(inputClass, 'flex items-center justify-between text-left')}
            >
                <span className={cn('min-w-0 truncate', !selectedLabel && 'text-gray-400')}>
                    {selectedLabel || emptyLabel}
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-400 transition', open && 'rotate-180')} />
            </button>
            {open && (
                <div className="absolute left-0 top-[calc(100%+0.35rem)] z-50 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    <div className="border-b border-gray-100 p-2 dark:border-gray-800">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder={placeholder}
                                autoFocus
                                className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                            />
                        </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                        <button
                            type="button"
                            onClick={() => {
                                onChange(null)
                                setOpen(false)
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                            {emptyLabel}
                        </button>
                        {loading && <div className="px-3 py-4 text-center text-sm text-gray-400"><Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" />正在查询</div>}
                        {!loading && options.map(module => (
                            <button
                                key={module.id}
                                type="button"
                                onClick={() => {
                                    onChange(module)
                                    setOpen(false)
                                }}
                                className={cn(
                                    'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800',
                                    value === String(module.id) && 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                                )}
                            >
                                <ModuleAvatar module={module} fallback={module.name} />
                                <span className="min-w-0">
                                    <span className="block truncate font-medium">{module.name}</span>
                                    <span className="block truncate text-xs text-gray-400">{module.loginUrl || module.website || '业务模块'}</span>
                                </span>
                            </button>
                        ))}
                        {!loading && options.length === 0 && <div className="px-3 py-6 text-center text-sm text-gray-400">没有匹配模块</div>}
                    </div>
                </div>
            )}
        </div>
    )
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
    return (
        <label className={cn('block space-y-1.5 text-sm', className)}>
            <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
            {children}
        </label>
    )
}
