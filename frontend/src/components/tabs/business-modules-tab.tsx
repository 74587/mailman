'use client'

import { useCallback, useEffect, useState, type ComponentProps, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { closestCenter, DndContext, DragOverlay, PointerSensor, type DragEndEvent, type DragStartEvent, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { BookOpen, Briefcase, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, GripVertical, ImagePlus, Loader2, MailCheck, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, Tag, Trash2, Workflow, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { businessAccountService, BusinessClaimDefaults, BusinessCustomFieldType, BusinessEmailClaimPayload, BusinessEmailConstraints, BusinessModule, BusinessModulePayload, BusinessScenario, BusinessScenarioPayload, BusinessStatusOption } from '@/services/business-account.service'
import { extractorTemplateV2Service } from '@/services/extractor-template-v2.service'
import { Modal, ModalBody, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal'
import { Switch } from '@/components/ui/switch'
import ExtractorCreationWizard from '@/components/extractor-v2/extractor-creation-wizard'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'
import { getApiBaseUrl } from '@/lib/runtime-url'
import type { ExtractorTemplateV2 } from '@/types'

type ModuleFieldDraft = {
    key: string
    type: BusinessCustomFieldType
    value: string
}

type BusinessEmailMode = Exclude<NonNullable<BusinessClaimDefaults['emailMode']>, 'auto'>

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
    claimDefaultsExtra: Record<string, any>
    emailConstraintsExtra: Record<string, any>
    claimEmailMode: BusinessEmailMode
    emailModePriorityEnabled: boolean
    emailModePriority: BusinessEmailMode[]
    claimTTL: string
    allowedSuffixes: string[]
    allowedSuffixPriorityEnabled: boolean
    blockedSuffixes: string[]
    allowAliases: boolean
    allowDomainMail: boolean
    allowForwarded: boolean
    prefixStrategy: NonNullable<BusinessClaimDefaults['prefixStrategy']>
    prefixTemplate: string
    builtinPrefix: string
    randomLength: string
    scenarios: ScenarioDraft[]
}

type ScenarioExtractorMode = 'none' | 'template' | 'simple' | 'inline'

type ScenarioDraft = {
    id?: number
    originalKey?: string
    key: string
    name: string
    description: string
    enabled: boolean
    sortOrder: string
    keepAliveSeconds: string
    syncInterval: string
    limit: string
    extractorMode: ScenarioExtractorMode
    templateId: string
    simpleField: string
    simpleType: string
    simplePattern: string
    simpleMatchMode: string
    pickupExtra: Record<string, any>
    extractorExtra: Record<string, any>
}

type ModuleEditorScene = 'profile' | 'email-policy' | 'scenarios'
type GuideEndpointKey = 'claim' | 'pickup' | 'complete' | 'release' | 'renew'
type GuideLanguage = 'curl' | 'node' | 'python' | 'go'

const moduleColors = ['#2563eb', '#10b981', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b']
const statusColors = ['#10b981', '#f59e0b', '#64748b', '#94a3b8', '#ef4444', '#8b5cf6', '#06b6d4']
const suffixSuggestions = ['@gmail.com', '@outlook.com', '@hotmail.com', '@icloud.com', '@yahoo.com', '@proton.me', '@qq.com', '@163.com']
const emailModes: Array<{
    value: BusinessEmailMode
    label: string
    description: string
}> = [
    { value: 'primary', label: '主邮箱', description: '直接使用邮箱账号地址' },
    { value: 'alias', label: '别名', description: 'Gmail plus 或域名前缀' },
    { value: 'domain', label: '域名邮箱', description: '使用域名收件规则' },
    { value: 'forwarded', label: '转发地址', description: '使用已配置转发地址' }
]
const prefixStrategies: Array<{
    value: NonNullable<BusinessClaimDefaults['prefixStrategy']>
    label: string
}> = [
    { value: 'builtin', label: '内置' },
    { value: 'template', label: '模板' },
    { value: 'random', label: '随机' },
    { value: 'literal', label: '固定' }
]
const guideLanguages: Array<{ value: GuideLanguage; label: string }> = [
    { value: 'curl', label: 'curl' },
    { value: 'node', label: 'Node.js' },
    { value: 'python', label: 'Python' },
    { value: 'go', label: 'Go' }
]
const scenarioPresets: Array<Pick<ScenarioDraft, 'key' | 'name' | 'description'>> = [
    {
        key: 'register',
        name: '注册验证码',
        description: '注册或开户时触发的验证码/确认链接'
    },
    { key: 'login', name: '登录验证码', description: '登录、风控或二次验证邮件' },
    { key: 'recovery', name: '找回密码', description: '密码重置或账号恢复邮件' }
]
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
    { value: 'note', label: '长文本' }
]

const builtinStatuses: BusinessStatusOption[] = [
    { value: 'active', label: '正常', color: '#10b981' },
    { value: 'pending', label: '待配置', color: '#f59e0b' },
    { value: 'disabled', label: '停用', color: '#64748b' },
    { value: 'archived', label: '归档', color: '#94a3b8' }
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
        claimDefaultsExtra: {},
        emailConstraintsExtra: {},
        claimEmailMode: 'primary',
        emailModePriorityEnabled: false,
        emailModePriority: emailModes.map(mode => mode.value),
        claimTTL: '600',
        allowedSuffixes: [],
        allowedSuffixPriorityEnabled: false,
        blockedSuffixes: [],
        allowAliases: true,
        allowDomainMail: true,
        allowForwarded: true,
        prefixStrategy: 'builtin',
        prefixTemplate: '{module}-{hex4}',
        builtinPrefix: 'module',
        randomLength: '8',
        scenarios: []
    }
}

function readModuleFields(module: BusinessModule): ModuleFieldDraft[] {
    const raw = module.fieldSchema?.fields
    if (!Array.isArray(raw)) return [{ key: '', type: 'text', value: '' }]
    const fields = raw
        .map((field: any) => ({
            key: String(field.key || field.name || ''),
            type: fieldTypes.some(item => item.value === field.type) ? (field.type as BusinessCustomFieldType) : 'text',
            value: String(field.value ?? field.defaultValue ?? '')
        }))
        .filter(field => field.key || field.value)
    return fields.length ? fields : [{ key: '', type: 'text', value: '' }]
}

function readModuleStatuses(module: BusinessModule): BusinessStatusOption[] {
    const raw = module.statusOptions?.items
    if (!Array.isArray(raw)) return builtinStatuses
    const statuses = raw
        .map((item: any) => ({
            value: String(item.value || item.label || '').trim(),
            label: String(item.label || item.value || '').trim(),
            color: item.color ? String(item.color) : statusColors[0]
        }))
        .filter(item => item.value && item.label)
    return statuses.length ? statuses : builtinStatuses
}

function moduleToDraft(module: BusinessModule): ModuleDraft {
    const claimDefaults = module.claimDefaults || {}
    const constraints = module.emailConstraints || {}
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
        claimDefaultsExtra: omitKeys(claimDefaults, ['emailMode', 'emailModePriorityEnabled', 'emailModePriority', 'emailModeOrder', 'ttlSeconds', 'emailSuffix', 'emailSuffixes', 'blockedEmailSuffixes', 'prefixStrategy', 'prefixTemplate', 'builtinPrefix', 'randomLength']),
        emailConstraintsExtra: omitKeys(constraints, ['allowedSuffixes', 'blockedSuffixes', 'allowedDomains', 'blockedDomains', 'allowedSuffixPriorityEnabled', 'emailSuffixPriorityEnabled', 'suffixPriorityEnabled', 'allowAliases', 'allowDomainMail', 'allowForwarded']),
        claimEmailMode: normalizeDraftEmailMode(claimDefaults.emailMode),
        emailModePriorityEnabled: readBoolean(claimDefaults.emailModePriorityEnabled ?? claimDefaults.emailModeSortEnabled ?? claimDefaults.enableEmailModePriority, false),
        emailModePriority: normalizeEmailModeOrder(claimDefaults.emailModePriority || claimDefaults.emailModeOrder),
        claimTTL: String(claimDefaults.ttlSeconds || 600),
        allowedSuffixes: normalizeSuffixList(constraints.allowedSuffixes || claimDefaults.emailSuffixes || (claimDefaults.emailSuffix ? [claimDefaults.emailSuffix] : [])),
        allowedSuffixPriorityEnabled: readBoolean(constraints.allowedSuffixPriorityEnabled ?? constraints.emailSuffixPriorityEnabled ?? constraints.suffixPriorityEnabled, false),
        blockedSuffixes: normalizeSuffixList(constraints.blockedSuffixes || claimDefaults.blockedEmailSuffixes || []),
        allowAliases: constraints.allowAliases !== false,
        allowDomainMail: constraints.allowDomainMail !== false,
        allowForwarded: constraints.allowForwarded !== false,
        prefixStrategy: normalizeDraftPrefixStrategy(claimDefaults.prefixStrategy),
        prefixTemplate: String(claimDefaults.prefixTemplate || '{module}-{hex4}'),
        builtinPrefix: String(claimDefaults.builtinPrefix || 'module'),
        randomLength: String(claimDefaults.randomLength || 8),
        scenarios: []
    }
}

function draftToPayload(draft: ModuleDraft): BusinessModulePayload {
    const claimDefaults: BusinessClaimDefaults = {
        ...draft.claimDefaultsExtra,
        ttlSeconds: Number(draft.claimTTL || 600),
        emailMode: draft.claimEmailMode,
        emailModePriorityEnabled: draft.emailModePriorityEnabled,
        emailModePriority: normalizeEmailModeOrder(draft.emailModePriority),
        prefixStrategy: draft.prefixStrategy
    }
    if (draft.allowedSuffixes.length) claimDefaults.emailSuffixes = normalizeSuffixList(draft.allowedSuffixes)
    if (draft.blockedSuffixes.length) claimDefaults.blockedEmailSuffixes = normalizeSuffixList(draft.blockedSuffixes)
    if (draft.prefixStrategy === 'template') claimDefaults.prefixTemplate = draft.prefixTemplate.trim()
    if (draft.prefixStrategy === 'builtin') claimDefaults.builtinPrefix = draft.builtinPrefix.trim()
    if (draft.prefixStrategy === 'random') claimDefaults.randomLength = Number(draft.randomLength || 8)

    const emailConstraints: BusinessEmailConstraints = {
        ...draft.emailConstraintsExtra,
        allowedSuffixes: normalizeSuffixList(draft.allowedSuffixes),
        allowedSuffixPriorityEnabled: draft.allowedSuffixPriorityEnabled,
        blockedSuffixes: normalizeSuffixList(draft.blockedSuffixes),
        allowAliases: draft.allowAliases,
        allowDomainMail: draft.allowDomainMail,
        allowForwarded: draft.allowForwarded
    }

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
                .map(field => ({
                    key: field.key.trim(),
                    type: field.type,
                    value: field.value
                }))
                .filter(field => field.key)
        },
        statusOptions: {
            items: draft.statuses
                .map(status => ({
                    value: status.value.trim(),
                    label: status.label.trim(),
                    color: status.color || statusColors[0]
                }))
                .filter(status => status.value && status.label)
        },
        claimDefaults,
        emailConstraints
    }
}

function scenarioToDraft(scenario: BusinessScenario): ScenarioDraft {
    const pickupConfig = scenario.pickupConfig || {}
    const extractorConfig = scenario.extractorConfig || {}
    const simpleExtract = extractorConfig.simple_extract || extractorConfig.simpleExtract || {}
    const templateId = extractorConfig.template_id ?? extractorConfig.templateId
    const hasInline = Boolean(extractorConfig.inline_actions || extractorConfig.inlineActions)
    const hasSimple = Boolean(simpleExtract && Object.keys(simpleExtract).length)
    return {
        id: scenario.id,
        originalKey: scenario.key,
        key: scenario.key || '',
        name: scenario.name || '',
        description: scenario.description || '',
        enabled: scenario.enabled !== false,
        sortOrder: String(scenario.sortOrder || 0),
        keepAliveSeconds: String(pickupConfig.keep_alive_seconds || pickupConfig.keepAliveSeconds || 60),
        syncInterval: String(pickupConfig.sync_interval || pickupConfig.syncInterval || 5),
        limit: String(pickupConfig.limit || 10),
        extractorMode: templateId ? 'template' : hasSimple ? 'simple' : hasInline ? 'inline' : 'none',
        templateId: templateId ? String(templateId) : '',
        simpleField: String(simpleExtract.field || 'body'),
        simpleType: String(simpleExtract.type || 'regex'),
        simplePattern: String(simpleExtract.pattern || ''),
        simpleMatchMode: String(simpleExtract.match_mode || simpleExtract.matchMode || 'first'),
        pickupExtra: omitKeys(pickupConfig, ['keep_alive_seconds', 'keepAliveSeconds', 'sync_interval', 'syncInterval', 'limit']),
        extractorExtra: omitKeys(extractorConfig, ['template_id', 'templateId', 'simple_extract', 'simpleExtract'])
    }
}

function emptyScenarioDraft(preset?: Pick<ScenarioDraft, 'key' | 'name' | 'description'>): ScenarioDraft {
    return {
        key: preset?.key || '',
        name: preset?.name || '',
        description: preset?.description || '',
        enabled: true,
        sortOrder: '0',
        keepAliveSeconds: '60',
        syncInterval: '5',
        limit: '10',
        extractorMode: 'template',
        templateId: '',
        simpleField: 'body',
        simpleType: 'regex',
        simplePattern: '',
        simpleMatchMode: 'first',
        pickupExtra: {},
        extractorExtra: {}
    }
}

function draftToScenarioPayload(draft: ScenarioDraft): BusinessScenarioPayload {
    const pickupConfig = {
        ...draft.pickupExtra,
        keepAliveSeconds: Number(draft.keepAliveSeconds || 60),
        syncInterval: Number(draft.syncInterval || 5),
        limit: Number(draft.limit || 10)
    }
    const extractorConfig: Record<string, any> = { ...draft.extractorExtra }
    delete extractorConfig.template_id
    delete extractorConfig.templateId
    delete extractorConfig.simple_extract
    delete extractorConfig.simpleExtract
    if (draft.extractorMode === 'template' && draft.templateId) {
        extractorConfig.templateId = Number(draft.templateId)
    } else if (draft.extractorMode === 'simple') {
        extractorConfig.simpleExtract = {
            field: draft.simpleField,
            type: draft.simpleType,
            pattern: draft.simplePattern,
            match_mode: draft.simpleMatchMode
        }
    } else if (draft.extractorMode === 'none') {
        return {
            key: normalizeScenarioKey(draft.key),
            name: draft.name.trim(),
            description: draft.description.trim(),
            enabled: draft.enabled,
            pickupConfig,
            extractorConfig: {},
            sortOrder: Number(draft.sortOrder || 0)
        }
    }
    return {
        key: normalizeScenarioKey(draft.key),
        name: draft.name.trim(),
        description: draft.description.trim(),
        enabled: draft.enabled,
        pickupConfig,
        extractorConfig,
        sortOrder: Number(draft.sortOrder || 0)
    }
}

function normalizeDraftEmailMode(value: unknown): BusinessEmailMode {
    return emailModes.some(mode => mode.value === value) ? (value as BusinessEmailMode) : 'primary'
}

function normalizeDraftPrefixStrategy(value: unknown): NonNullable<BusinessClaimDefaults['prefixStrategy']> {
    return prefixStrategies.some(strategy => strategy.value === value) ? (value as NonNullable<BusinessClaimDefaults['prefixStrategy']>) : 'builtin'
}

function readBoolean(value: unknown, fallback: boolean) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true
        if (['false', '0', 'no', 'off'].includes(normalized)) return false
    }
    return fallback
}

function normalizeEmailModeOrder(values: unknown): BusinessEmailMode[] {
    const raw = Array.isArray(values) ? values : typeof values === 'string' ? values.split(/[,\n;]/) : []
    const seen = new Set<string>()
    const order = raw
        .map(value => String(value || '').trim())
        .filter(value => {
            if (!emailModes.some(mode => mode.value === value) || seen.has(value)) return false
            seen.add(value)
            return true
        }) as BusinessEmailMode[]
    emailModes.forEach(mode => {
        if (!seen.has(mode.value)) order.push(mode.value)
    })
    return order
}

function normalizeSuffixList(values: unknown): string[] {
    const raw = Array.isArray(values) ? values : typeof values === 'string' ? values.split(/[,\n;]/) : []
    const seen = new Set<string>()
    return raw
        .map(value => normalizeSuffix(String(value || '')))
        .filter(value => {
            if (!value || seen.has(value)) return false
            seen.add(value)
            return true
        })
}

function normalizeSuffix(value: string) {
    const trimmed = value.trim().toLowerCase().replace(/^[.]+/, '')
    if (!trimmed) return ''
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

function normalizeScenarioKey(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.:-]+/g, '-')
        .replace(/^[-_.:]+|[-_.:]+$/g, '')
}

function omitKeys<T extends Record<string, any>>(source: T, keys: string[]) {
    const result: Record<string, any> = {}
    Object.entries(source || {}).forEach(([key, value]) => {
        if (!keys.includes(key)) result[key] = value
    })
    return result
}

function formatEmailPolicySummary(draft: ModuleDraft) {
    const mode = emailModes.find(item => item.value === draft.claimEmailMode)?.label || '主邮箱'
    const suffixes = draft.allowedSuffixes.length ? draft.allowedSuffixes.slice(0, 2).join('、') + (draft.allowedSuffixes.length > 2 ? ` +${draft.allowedSuffixes.length - 2}` : '') : '不限制后缀'
    const blocked = draft.blockedSuffixes.length ? `，禁用 ${draft.blockedSuffixes.length} 个后缀` : ''
    const priority = [draft.emailModePriorityEnabled ? '类型排序' : '', draft.allowedSuffixPriorityEnabled ? '后缀排序' : ''].filter(Boolean).join(' / ')
    return `${mode} · ${suffixes}${blocked}${priority ? ` · ${priority}` : ''}`
}

function formatEmailCapabilitySummary(draft: ModuleDraft) {
    const capabilities = [draft.allowAliases ? '允许别名' : '禁用别名', draft.allowDomainMail ? '允许域名' : '禁用域名', draft.allowForwarded ? '允许转发' : '禁用转发']
    return `${draft.claimTTL || 600} 秒 · ${capabilities.join(' / ')}`
}

function formatScenarioSummary(scenarios: ScenarioDraft[]) {
    if (!scenarios.length) return '未配置业务场景'
    const names = scenarios
        .slice(0, 2)
        .map(scenario => scenario.name || scenario.key || '未命名')
        .join('、')
    return names + (scenarios.length > 2 ? ` +${scenarios.length - 2}` : '')
}

function getGuideClaimTtl(module: BusinessModule) {
    const ttl = Number(module.claimDefaults?.ttlSeconds || 600)
    if (!Number.isFinite(ttl)) return 600
    return Math.min(3600, Math.max(60, ttl))
}

function getModuleAllowedSuffixes(module: BusinessModule) {
    const constraints = module.emailConstraints || {}
    const defaults = module.claimDefaults || {}
    return normalizeSuffixList(constraints.allowedSuffixes || defaults.emailSuffixes || (defaults.emailSuffix ? [defaults.emailSuffix] : []))
}

function getModuleBlockedSuffixes(module: BusinessModule) {
    const constraints = module.emailConstraints || {}
    const defaults = module.claimDefaults || {}
    return normalizeSuffixList(constraints.blockedSuffixes || defaults.blockedEmailSuffixes || [])
}

function isModuleEmailModeSupported(module: BusinessModule, mode: BusinessEmailMode) {
    const constraints = module.emailConstraints || {}
    if (mode === 'primary') return true
    if (mode === 'alias') return constraints.allowAliases !== false
    if (mode === 'domain') return constraints.allowDomainMail !== false
    if (mode === 'forwarded') return constraints.allowForwarded !== false
    return true
}

function buildExampleCustomFields(module: BusinessModule) {
    const fields = readModuleFields(module).filter(field => field.key.trim())
    const result: Record<string, string> = {}
    fields.forEach(field => {
        const key = field.key.trim()
        const fallback = field.value.trim()
        if (fallback) {
            result[key] = fallback
            return
        }
        if (field.type === 'username') result[key] = 'registered_user_001'
        else if (field.type === 'password') result[key] = 'replace-with-real-password'
        else if (field.type === 'totp') result[key] = 'JBSWY3DPEHPK3PXP'
        else if (field.type === 'url') result[key] = module.loginUrl || module.website || 'https://example.com/login'
        else if (field.type === 'email') result[key] = 'user@example.com'
        else if (field.type === 'phone') result[key] = '+1 555 0100'
        else if (field.type === 'date') result[key] = '2026-06-20'
        else if (field.type === 'number') result[key] = '1'
        else if (field.type === 'note') result[key] = `${module.name} registration note`
        else result[key] = `${key}_value`
    })
    return result
}

function getGuideCompletionStatus(module: BusinessModule) {
    const statuses = readModuleStatuses(module)
    return statuses.find(status => status.value === 'active')?.value || statuses[0]?.value || 'active'
}

function buildGuideClaimPayload(module: BusinessModule): BusinessEmailClaimPayload {
    const defaults = module.claimDefaults || {}
    const constraints = module.emailConstraints || {}
    const allowedSuffixes = getModuleAllowedSuffixes(module)
    const blockedSuffixes = getModuleBlockedSuffixes(module)
    const suffixPriorityEnabled = readBoolean(constraints.allowedSuffixPriorityEnabled ?? constraints.emailSuffixPriorityEnabled ?? constraints.suffixPriorityEnabled, false)
    const modePriorityEnabled = readBoolean(defaults.emailModePriorityEnabled ?? defaults.emailModeSortEnabled ?? defaults.enableEmailModePriority, false)
    const orderedModes = normalizeEmailModeOrder(defaults.emailModePriority || defaults.emailModeOrder).filter(mode => isModuleEmailModeSupported(module, mode))
    const customFields = buildExampleCustomFields(module)
    const payload: BusinessEmailClaimPayload = {
        ttlSeconds: getGuideClaimTtl(module),
        claimedBy: 'business-registration-worker',
        businessAccount: {
            displayName: `${module.name} 自动注册账号`,
            username: 'pending-registration',
            description: `由 ${module.name} 接入流程创建，完成注册后会写入真实账号资料。`,
            customFields: Object.keys(customFields).length ? customFields : undefined,
            extraData: {
                source: 'integration-guide',
                moduleId: module.id
            }
        }
    }

    if (modePriorityEnabled) {
        payload.emailModePriorityEnabled = true
        payload.emailModePriority = orderedModes.length ? orderedModes : normalizeEmailModeOrder(undefined)
    } else if (defaults.emailMode && defaults.emailMode !== 'auto') {
        payload.emailMode = defaults.emailMode
    }

    if (allowedSuffixes.length) {
        payload.emailSuffixes = allowedSuffixes
        if (suffixPriorityEnabled) payload.emailSuffixPriorityEnabled = true
    }
    if (blockedSuffixes.length) payload.blockedEmailSuffixes = blockedSuffixes

    if (defaults.useDomainMail !== undefined) payload.useDomainMail = defaults.useDomainMail
    if (defaults.domain) payload.domain = defaults.domain
    if (defaults.useAlias !== undefined) payload.useAlias = defaults.useAlias
    if (defaults.aliasType) payload.aliasType = defaults.aliasType
    if (defaults.prefixStrategy) payload.prefixStrategy = defaults.prefixStrategy
    if (defaults.prefix) payload.prefix = defaults.prefix
    if (defaults.prefixTemplate) payload.prefixTemplate = defaults.prefixTemplate
    if (defaults.builtinPrefix) payload.builtinPrefix = defaults.builtinPrefix
    if (defaults.randomLength) payload.randomLength = defaults.randomLength

    return payload
}

function buildGuideCompletePayload(module: BusinessModule) {
    const customFields = buildExampleCustomFields(module)
    return {
        claimToken: '<claim.claimToken>',
        username: 'registered_user_001',
        password: 'replace-with-real-password',
        status: getGuideCompletionStatus(module),
        customFields: Object.keys(customFields).length ? customFields : undefined,
        extraData: {
            registeredBy: 'integration-worker'
        }
    }
}

function buildGuideReleasePayload() {
    return {
        claimToken: '<claim.claimToken>',
        reason: 'registration_failed',
        message: '注册失败，释放本次占用的注册邮箱',
        deletePendingAccount: true,
        exclusion: {
            type: 'cooldown',
            target: 'both',
            durationSeconds: 1800,
            reason: 'registration_failed'
        }
    }
}

function toPrettyJson(value: unknown) {
    return JSON.stringify(value, null, 2)
}

function shellSingleQuote(value: string) {
    return `'${value.replace(/'/g, "'\\''")}'`
}

function buildBusinessIntegrationGuide(module: BusinessModule) {
    const apiBase = getApiBaseUrl()
    const claimPath = `/business-modules/${module.id}/email-accounts/claim`
    const pickupPath = '/pickup/poll'
    const completePath = '/business-accounts/{businessAccountId}/complete-registration'
    const releasePath = '/business-accounts/{businessAccountId}/release-registration-claim'
    const renewPath = '/business-accounts/{businessAccountId}/renew-registration-claim'
    const claimPayload = buildGuideClaimPayload(module)
    const completePayload = buildGuideCompletePayload(module)
    const releasePayload = buildGuideReleasePayload()
    const renewPayload = {
        claimToken: '<claim.claimToken>',
        ttlSeconds: getGuideClaimTtl(module),
        message: '注册流程仍在进行，延长邮箱占用时间'
    }
    const pickupPayload = {
        account_id: '<claim.pickup.account_id>',
        to_query: '<claim.pickup.to_query>',
        keep_alive_seconds: 90,
        sync_interval: 5,
        since: '<ISO8601 time, for example 10 minutes ago>',
        limit: 10
    }
    const allowedSuffixes = getModuleAllowedSuffixes(module)
    const blockedSuffixes = getModuleBlockedSuffixes(module)
    const defaults = module.claimDefaults || {}
    const constraints = module.emailConstraints || {}
    const modePriorityEnabled = readBoolean(defaults.emailModePriorityEnabled ?? defaults.emailModeSortEnabled ?? defaults.enableEmailModePriority, false)
    const suffixPriorityEnabled = readBoolean(constraints.allowedSuffixPriorityEnabled ?? constraints.emailSuffixPriorityEnabled ?? constraints.suffixPriorityEnabled, false)
    const orderedModes = normalizeEmailModeOrder(defaults.emailModePriority || defaults.emailModeOrder)
        .filter(mode => isModuleEmailModeSupported(module, mode))
        .map(mode => emailModes.find(item => item.value === mode)?.label || mode)

    return {
        apiBase,
        claimPath,
        pickupPath,
        completePath,
        releasePath,
        renewPath,
        claimPayload,
        pickupPayload,
        completePayload,
        releasePayload,
        renewPayload,
        policyItems: [
            { label: '模块 ID', value: String(module.id) },
            { label: '模块名称', value: module.name },
            { label: 'API Base', value: apiBase },
            { label: 'Claim 有效期', value: `${getGuideClaimTtl(module)} 秒` },
            { label: '邮箱类型', value: modePriorityEnabled ? `按顺序尝试：${orderedModes.join(' > ') || '主邮箱'}` : emailModes.find(mode => mode.value === normalizeDraftEmailMode(defaults.emailMode))?.label || '主邮箱' },
            { label: '允许后缀', value: allowedSuffixes.length ? `${allowedSuffixes.join('、')}${suffixPriorityEnabled ? '（按顺序优先）' : ''}` : '不限制' },
            { label: '禁止后缀', value: blockedSuffixes.length ? blockedSuffixes.join('、') : '未配置' },
            { label: '别名/域名/转发', value: `${constraints.allowAliases === false ? '禁用别名' : '允许别名'} / ${constraints.allowDomainMail === false ? '禁用域名' : '允许域名'} / ${constraints.allowForwarded === false ? '禁用转发' : '允许转发'}` }
        ],
        endpoints: [
            { key: 'claim' as GuideEndpointKey, method: 'POST', path: claimPath, label: '申请并占用注册邮箱', response: '201，返回 claimToken、businessAccountId、pickup 参数' },
            { key: 'pickup' as GuideEndpointKey, method: 'POST', path: pickupPath, label: '轮询取件/提取验证码', response: '200，返回 emails 与 extractions' },
            { key: 'complete' as GuideEndpointKey, method: 'POST', path: completePath, label: '注册成功后完成 claim', response: '200，返回业务账号' },
            { key: 'release' as GuideEndpointKey, method: 'POST', path: releasePath, label: '注册失败后释放 claim', response: '200，释放或删除待注册账号' },
            { key: 'renew' as GuideEndpointKey, method: 'POST', path: renewPath, label: '注册耗时较长时续租 claim', response: '200，返回新的 claimExpiresAt' }
        ]
    }
}

type BusinessIntegrationGuide = ReturnType<typeof buildBusinessIntegrationGuide>

function getGuideEndpointSamplePayload(guide: BusinessIntegrationGuide, endpointKey: GuideEndpointKey): Record<string, any> {
    if (endpointKey === 'claim') return guide.claimPayload
    if (endpointKey === 'pickup') {
        return {
            account_id: 1,
            to_query: 'registration@example.com',
            keep_alive_seconds: 90,
            sync_interval: 5,
            since: '2026-06-20T00:00:00Z',
            limit: 10
        }
    }
    if (endpointKey === 'complete') {
        return {
            ...guide.completePayload,
            claimToken: 'replace-with-claim-token'
        }
    }
    if (endpointKey === 'release') {
        return {
            ...guide.releasePayload,
            claimToken: 'replace-with-claim-token'
        }
    }
    return {
        ...guide.renewPayload,
        claimToken: 'replace-with-claim-token'
    }
}

function getBusinessAccountEndpointPath(endpointKey: GuideEndpointKey, accountExpression: string) {
    if (endpointKey === 'complete') return `/business-accounts/${accountExpression}/complete-registration`
    if (endpointKey === 'release') return `/business-accounts/${accountExpression}/release-registration-claim`
    if (endpointKey === 'renew') return `/business-accounts/${accountExpression}/renew-registration-claim`
    return ''
}

function buildGuideEndpointCode(guide: BusinessIntegrationGuide, endpointKey: GuideEndpointKey, language: GuideLanguage) {
    if (language === 'node') return buildNodeEndpointCode(guide, endpointKey)
    if (language === 'python') return buildPythonEndpointCode(guide, endpointKey)
    if (language === 'go') return buildGoEndpointCode(guide, endpointKey)
    return buildCurlEndpointCode(guide, endpointKey)
}

function buildCurlEndpointCode(guide: BusinessIntegrationGuide, endpointKey: GuideEndpointKey) {
    const payload = getGuideEndpointSamplePayload(guide, endpointKey)
    const payloadJson = toPrettyJson(payload)
    const needsBusinessAccount = endpointKey === 'complete' || endpointKey === 'release' || endpointKey === 'renew'
    const endpointPath = endpointKey === 'claim' ? guide.claimPath : endpointKey === 'pickup' ? guide.pickupPath : getBusinessAccountEndpointPath(endpointKey, '$BUSINESS_ACCOUNT_ID')
    const businessAccountEnv = needsBusinessAccount ? '\nexport BUSINESS_ACCOUNT_ID="1" # 替换为 claim.businessAccountId' : ''
    const pickupHint = endpointKey === 'pickup' ? '\n# account_id 与 to_query 来自 claim.pickup.account_id / claim.pickup.to_query' : ''
    const tokenHint = needsBusinessAccount ? '\n# claimToken 来自 claim.claimToken' : ''
    return `export MAILMAN_API_BASE="${guide.apiBase}"
export MAILMAN_TOKEN="replace-with-your-token"${businessAccountEnv}${pickupHint}${tokenHint}

curl -sS -X POST "$MAILMAN_API_BASE${endpointPath}" \\
  -H "Authorization: Bearer $MAILMAN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d ${shellSingleQuote(payloadJson)}`
}

function buildNodeEndpointCode(guide: BusinessIntegrationGuide, endpointKey: GuideEndpointKey) {
    const payload = getGuideEndpointSamplePayload(guide, endpointKey)
    const needsBusinessAccount = endpointKey === 'complete' || endpointKey === 'release' || endpointKey === 'renew'
    const endpointPathExpression =
        endpointKey === 'claim'
            ? `"${guide.claimPath}"`
            : endpointKey === 'pickup'
              ? `"${guide.pickupPath}"`
              : endpointKey === 'complete'
                ? '"/business-accounts/" + businessAccountId + "/complete-registration"'
                : endpointKey === 'release'
                  ? '"/business-accounts/" + businessAccountId + "/release-registration-claim"'
                  : '"/business-accounts/" + businessAccountId + "/renew-registration-claim"'
    const accountSetup = needsBusinessAccount ? 'const businessAccountId = 1; // 替换为 claim.businessAccountId\n' : ''
    const payloadText =
        endpointKey === 'pickup'
            ? `{
  account_id: 1, // 替换为 claim.pickup.account_id
  to_query: "registration@example.com", // 替换为 claim.pickup.to_query
  keep_alive_seconds: 90,
  sync_interval: 5,
  since: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  limit: 10,
}`
            : toPrettyJson(payload)

    return `const API_BASE = process.env.MAILMAN_API_BASE ?? "${guide.apiBase}";
const TOKEN = process.env.MAILMAN_TOKEN;

if (!TOKEN) throw new Error("Missing MAILMAN_TOKEN");

async function post(path, body) {
  const response = await fetch(API_BASE + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(response.status + " " + await response.text());
  return response.json();
}

${accountSetup}const payload = ${payloadText};
const result = await post(${endpointPathExpression}, payload);
console.log(result);`
}

function buildPythonEndpointCode(guide: BusinessIntegrationGuide, endpointKey: GuideEndpointKey) {
    const payload = getGuideEndpointSamplePayload(guide, endpointKey)
    const needsBusinessAccount = endpointKey === 'complete' || endpointKey === 'release' || endpointKey === 'renew'
    const endpointPathExpression = endpointKey === 'claim' ? `"${guide.claimPath}"` : endpointKey === 'pickup' ? `"${guide.pickupPath}"` : `f"${getBusinessAccountEndpointPath(endpointKey, '{business_account_id}')}"`
    const accountSetup = needsBusinessAccount ? 'business_account_id = 1  # 替换为 claim["businessAccountId"]\n' : ''
    const payloadText =
        endpointKey === 'pickup'
            ? `{
    "account_id": 1,  # 替换为 claim["pickup"]["account_id"]
    "to_query": "registration@example.com",  # 替换为 claim["pickup"]["to_query"]
    "keep_alive_seconds": 90,
    "sync_interval": 5,
    "since": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
    "limit": 10,
}`
            : `json.loads(r'''${toPrettyJson(payload)}''')`

    return `import json
import os
from datetime import datetime, timedelta, timezone

import requests

API_BASE = os.getenv("MAILMAN_API_BASE", "${guide.apiBase}")
TOKEN = os.environ["MAILMAN_TOKEN"]

def post(path, payload):
    response = requests.post(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    response.raise_for_status()
    return response.json()

${accountSetup}payload = ${payloadText}
result = post(${endpointPathExpression}, payload)
print(result)`
}

function buildGoEndpointCode(guide: BusinessIntegrationGuide, endpointKey: GuideEndpointKey) {
    const payload = getGuideEndpointSamplePayload(guide, endpointKey)
    const payloadJson = toPrettyJson(payload)
    const needsBusinessAccount = endpointKey === 'complete' || endpointKey === 'release' || endpointKey === 'renew'
    const timeImport = endpointKey === 'pickup' ? '\n\t"time"' : ''
    const accountSetup = needsBusinessAccount ? '\tbusinessAccountID := 1 // 替换为 claim.businessAccountId\n' : ''
    const endpointPathExpression = endpointKey === 'claim' ? `"${guide.claimPath}"` : endpointKey === 'pickup' ? `"${guide.pickupPath}"` : `fmt.Sprintf("${getBusinessAccountEndpointPath(endpointKey, '%d')}", businessAccountID)`
    const pickupSince = endpointKey === 'pickup' ? '\tpayload["since"] = time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339)\n' : ''
    return `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"${timeImport}
)

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func postJSON(apiBase, token, path string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, apiBase+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s: %s", resp.Status, string(responseBody))
	}
	return json.Unmarshal(responseBody, out)
}

func main() {
	apiBase := getenv("MAILMAN_API_BASE", "${guide.apiBase}")
	token := os.Getenv("MAILMAN_TOKEN")
	if token == "" {
		panic("Missing MAILMAN_TOKEN")
	}

${accountSetup}	var payload map[string]any
	if err := json.Unmarshal([]byte(${JSON.stringify(payloadJson)}), &payload); err != nil {
		panic(err)
	}
${pickupSince}	var result map[string]any
	if err := postJSON(apiBase, token, ${endpointPathExpression}, payload, &result); err != nil {
		panic(err)
	}
	pretty, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(pretty))
}`
}

function buildGuideCodeSamples({
    apiBase,
    module,
    claimPath,
    pickupPath,
    claimPayload
}: {
    apiBase: string
    module: BusinessModule
    claimPath: string
    pickupPath: string
    claimPayload: BusinessEmailClaimPayload
}) {
    const claimJson = toPrettyJson(claimPayload)
    const completionStatus = getGuideCompletionStatus(module)
    const curl = `export MAILMAN_API_BASE="${apiBase}"
export MAILMAN_TOKEN="replace-with-your-token"

CLAIM_RESPONSE=$(curl -sS -X POST "$MAILMAN_API_BASE${claimPath}" \\
  -H "Authorization: Bearer $MAILMAN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d ${shellSingleQuote(claimJson)})

BUSINESS_ACCOUNT_ID=$(printf '%s' "$CLAIM_RESPONSE" | jq -r '.businessAccountId')
CLAIM_TOKEN=$(printf '%s' "$CLAIM_RESPONSE" | jq -r '.claimToken')
PICKUP_ACCOUNT_ID=$(printf '%s' "$CLAIM_RESPONSE" | jq -r '.pickup.account_id')
TO_QUERY=$(printf '%s' "$CLAIM_RESPONSE" | jq -r '.pickup.to_query')
SINCE=$(date -u -v-10M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ)

curl -sS -X POST "$MAILMAN_API_BASE${pickupPath}" \\
  -H "Authorization: Bearer $MAILMAN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "$(jq -n --argjson account_id "$PICKUP_ACCOUNT_ID" --arg to_query "$TO_QUERY" --arg since "$SINCE" '{account_id:$account_id,to_query:$to_query,keep_alive_seconds:90,sync_interval:5,since:$since,limit:10}')"

curl -sS -X POST "$MAILMAN_API_BASE/business-accounts/$BUSINESS_ACCOUNT_ID/complete-registration" \\
  -H "Authorization: Bearer $MAILMAN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "$(jq -n --arg claimToken "$CLAIM_TOKEN" '{claimToken:$claimToken,username:"registered_user_001",password:"replace-with-real-password",status:"${completionStatus}" }')"

# 注册失败时改调用释放接口，避免邮箱被一直占用：
curl -sS -X POST "$MAILMAN_API_BASE/business-accounts/$BUSINESS_ACCOUNT_ID/release-registration-claim" \\
  -H "Authorization: Bearer $MAILMAN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "$(jq -n --arg claimToken "$CLAIM_TOKEN" '{claimToken:$claimToken,reason:"registration_failed",deletePendingAccount:true,exclusion:{type:"cooldown",target:"both",durationSeconds:1800,reason:"registration_failed"}}')"`

    const node = `const API_BASE = process.env.MAILMAN_API_BASE ?? "${apiBase}";
const TOKEN = process.env.MAILMAN_TOKEN;

if (!TOKEN) throw new Error("Missing MAILMAN_TOKEN");

async function post(path, body) {
  const response = await fetch(\`\${API_BASE}\${path}\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${TOKEN}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(\`\${response.status} \${await response.text()}\`);
  return response.json();
}

const claim = await post("${claimPath}", ${claimJson});

const pickup = await post("${pickupPath}", {
  account_id: claim.pickup.account_id,
  to_query: claim.pickup.to_query,
  keep_alive_seconds: 90,
  sync_interval: 5,
  since: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  limit: 10,
});

console.log("matched emails", pickup.emails);

await post(\`/business-accounts/\${claim.businessAccountId}/complete-registration\`, {
  claimToken: claim.claimToken,
  username: "registered_user_001",
  password: "replace-with-real-password",
  status: "${completionStatus}",
});

// 注册失败时释放占用：
// await post(\`/business-accounts/\${claim.businessAccountId}/release-registration-claim\`, {
//   claimToken: claim.claimToken,
//   reason: "registration_failed",
//   deletePendingAccount: true,
//   exclusion: { type: "cooldown", target: "both", durationSeconds: 1800, reason: "registration_failed" },
// });`

    const python = `import json
import os
from datetime import datetime, timedelta, timezone

import requests

API_BASE = os.getenv("MAILMAN_API_BASE", "${apiBase}")
TOKEN = os.environ["MAILMAN_TOKEN"]

def post(path, payload):
    response = requests.post(
        f"{API_BASE}{path}",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    response.raise_for_status()
    return response.json()

claim_payload = json.loads(r'''${claimJson}''')
claim = post("${claimPath}", claim_payload)

pickup = post("${pickupPath}", {
    "account_id": claim["pickup"]["account_id"],
    "to_query": claim["pickup"]["to_query"],
    "keep_alive_seconds": 90,
    "sync_interval": 5,
    "since": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
    "limit": 10,
})
print("matched emails", pickup.get("emails", []))

post(f"/business-accounts/{claim['businessAccountId']}/complete-registration", {
    "claimToken": claim["claimToken"],
    "username": "registered_user_001",
    "password": "replace-with-real-password",
    "status": "${completionStatus}",
})

# 注册失败时释放占用：
# post(f"/business-accounts/{claim['businessAccountId']}/release-registration-claim", {
#     "claimToken": claim["claimToken"],
#     "reason": "registration_failed",
#     "deletePendingAccount": True,
#     "exclusion": {"type": "cooldown", "target": "both", "durationSeconds": 1800, "reason": "registration_failed"},
# })`

    const go = `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func postJSON(apiBase, token, path string, payload any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, apiBase+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s: %s", resp.Status, string(responseBody))
	}
	return json.Unmarshal(responseBody, out)
}

func main() {
	apiBase := getenv("MAILMAN_API_BASE", "${apiBase}")
	token := os.Getenv("MAILMAN_TOKEN")
	if token == "" {
		panic("Missing MAILMAN_TOKEN")
	}

	var claimPayload map[string]any
	if err := json.Unmarshal([]byte(${JSON.stringify(claimJson)}), &claimPayload); err != nil {
		panic(err)
	}

	var claim struct {
		BusinessAccountID int    \`json:"businessAccountId"\`
		ClaimToken        string \`json:"claimToken"\`
		Pickup            struct {
			AccountID int    \`json:"account_id"\`
			ToQuery   string \`json:"to_query"\`
		} \`json:"pickup"\`
	}
	if err := postJSON(apiBase, token, "${claimPath}", claimPayload, &claim); err != nil {
		panic(err)
	}

	var pickup map[string]any
	err := postJSON(apiBase, token, "${pickupPath}", map[string]any{
		"account_id":         claim.Pickup.AccountID,
		"to_query":           claim.Pickup.ToQuery,
		"keep_alive_seconds": 90,
		"sync_interval":      5,
		"since":              time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339),
		"limit":              10,
	}, &pickup)
	if err != nil {
		panic(err)
	}
	fmt.Printf("matched emails: %#v\\n", pickup["emails"])

	var completed map[string]any
	err = postJSON(apiBase, token, fmt.Sprintf("/business-accounts/%d/complete-registration", claim.BusinessAccountID), map[string]any{
		"claimToken": claim.ClaimToken,
		"username":   "registered_user_001",
		"password":   "replace-with-real-password",
		"status":     "${completionStatus}",
	}, &completed)
	if err != nil {
		panic(err)
	}
}`

    return [
        { label: 'curl', code: curl },
        { label: 'Node.js', code: node },
        { label: 'Python', code: python },
        { label: 'Go', code: go }
    ]
}

async function copyToClipboard(text: string) {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
        } else if (typeof document !== 'undefined') {
            const textarea = document.createElement('textarea')
            textarea.value = text
            textarea.style.position = 'fixed'
            textarea.style.left = '-9999px'
            document.body.appendChild(textarea)
            textarea.select()
            document.execCommand('copy')
            document.body.removeChild(textarea)
        }
        toast.success('已复制到剪贴板')
    } catch {
        toast.error('复制失败，请手动选择代码')
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
    const [guideModule, setGuideModule] = useState<BusinessModule | null>(null)
    const [editorScene, setEditorScene] = useState<ModuleEditorScene>('profile')
    const [draft, setDraft] = useState<ModuleDraft>(emptyDraft)
    const [originalScenarios, setOriginalScenarios] = useState<BusinessScenario[]>([])
    const [scenariosLoading, setScenariosLoading] = useState(false)
    const [extractorTemplates, setExtractorTemplates] = useState<Array<{ id: number; name: string; category?: string; enabled?: boolean }>>([])
    const [extractorTemplatesLoading, setExtractorTemplatesLoading] = useState(false)
    const [templateCreateOpen, setTemplateCreateOpen] = useState(false)
    const [templateCreateScenarioIndex, setTemplateCreateScenarioIndex] = useState<number | null>(null)
    const [templateCreateInstance, setTemplateCreateInstance] = useState(0)
    const [cropSource, setCropSource] = useState('')
    const [cropScale, setCropScale] = useState(1)
    const [cropX, setCropX] = useState(0)
    const [cropY, setCropY] = useState(0)
    const [cropRadius, setCropRadius] = useState(18)
    const { confirm } = useConfirmDialog()

    const loadModules = useCallback(async () => {
        setLoading(true)
        try {
            const response = await businessAccountService.listModulesPage({
                search,
                page,
                limit: pageSize
            })
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

    const loadExtractorTemplates = useCallback(async (showSuccess = false) => {
        setExtractorTemplatesLoading(true)
        try {
            const response = await extractorTemplateV2Service.getTemplatesPaginated(1, 80, { enabled: true })
            setExtractorTemplates(
                (response.templates || []).map(template => ({
                    id: template.id,
                    name: template.name,
                    category: template.category,
                    enabled: template.enabled
                }))
            )
            if (showSuccess) toast.success('取件模板列表已刷新')
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '加载取件模板失败')
        } finally {
            setExtractorTemplatesLoading(false)
        }
    }, [])

    useEffect(() => {
        if (!modalOpen) return
        loadExtractorTemplates()
    }, [modalOpen, loadExtractorTemplates])

    const closeTemplateCreator = useCallback(() => {
        setTemplateCreateOpen(false)
        setTemplateCreateScenarioIndex(null)
    }, [])

    const openTemplateCreator = useCallback((scenarioIndex: number) => {
        setTemplateCreateScenarioIndex(scenarioIndex)
        setTemplateCreateInstance(prev => prev + 1)
        setTemplateCreateOpen(true)
    }, [])

    const handleTemplateCreated = useCallback(
        (template: ExtractorTemplateV2) => {
            const option = {
                id: template.id,
                name: template.name,
                category: template.category,
                enabled: template.enabled
            }
            setExtractorTemplates(prev => [option, ...prev.filter(item => item.id !== template.id)])
            setDraft(prev => {
                if (templateCreateScenarioIndex === null || !prev.scenarios[templateCreateScenarioIndex]) return prev
                return {
                    ...prev,
                    scenarios: prev.scenarios.map((scenario, index) =>
                        index === templateCreateScenarioIndex
                            ? {
                                  ...scenario,
                                  extractorMode: 'template',
                                  templateId: String(template.id)
                              }
                            : scenario
                    )
                }
            })
            closeTemplateCreator()
            void loadExtractorTemplates()
        },
        [closeTemplateCreator, loadExtractorTemplates, templateCreateScenarioIndex]
    )

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    const openCreate = () => {
        setEditing(null)
        setDraft(emptyDraft())
        setOriginalScenarios([])
        setEditorScene('profile')
        setModalOpen(true)
    }

    const openEdit = (module: BusinessModule) => {
        setEditing(module)
        setDraft(moduleToDraft(module))
        setOriginalScenarios([])
        setEditorScene('profile')
        setModalOpen(true)
        setScenariosLoading(true)
        businessAccountService
            .listScenarios(module.id)
            .then(scenarios => {
                setOriginalScenarios(scenarios)
                setDraft(prev => ({
                    ...prev,
                    scenarios: scenarios.map(scenarioToDraft)
                }))
            })
            .catch(error => toast.error(error instanceof Error ? error.message : '加载业务场景失败'))
            .finally(() => setScenariosLoading(false))
    }

    const saveModule = async () => {
        const payload = draftToPayload(draft)
        if (!payload.name) {
            toast.error('请填写业务模块名称')
            return
        }
        const invalidScenario = draft.scenarios.find(scenario => normalizeScenarioKey(scenario.key) && !scenario.name.trim())
        if (invalidScenario) {
            toast.error(`请填写场景 ${invalidScenario.key} 的名称`)
            return
        }
        const scenarioKeys = draft.scenarios.map(scenario => normalizeScenarioKey(scenario.key)).filter(Boolean)
        if (new Set(scenarioKeys).size !== scenarioKeys.length) {
            toast.error('业务场景别名不能重复')
            return
        }
        const missingTemplate = draft.scenarios.find(scenario => normalizeScenarioKey(scenario.key) && scenario.extractorMode === 'template' && !scenario.templateId)
        if (missingTemplate) {
            toast.error(`请选择场景 ${missingTemplate.name || missingTemplate.key} 的取件模板，或改为只取邮件/简单正则`)
            return
        }
        setSaving(true)
        try {
            let savedModule: BusinessModule
            if (editing) {
                savedModule = await businessAccountService.updateModule(editing.id, payload)
                toast.success('业务模块已更新')
            } else {
                savedModule = await businessAccountService.createModule(payload)
                toast.success('业务模块已创建')
            }
            await saveModuleScenarios(savedModule.id)
            setModalOpen(false)
            await loadModules()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '保存业务模块失败')
        } finally {
            setSaving(false)
        }
    }

    const saveModuleScenarios = async (moduleId: number) => {
        const activeDrafts = draft.scenarios
            .map(scenario => ({
                ...scenario,
                key: normalizeScenarioKey(scenario.key)
            }))
            .filter(scenario => scenario.key && scenario.name.trim())
        const keptOriginalKeys = new Set(activeDrafts.map(scenario => scenario.originalKey).filter(Boolean) as string[])
        for (const scenario of activeDrafts) {
            const payload = draftToScenarioPayload(scenario)
            if (scenario.originalKey) {
                await businessAccountService.updateScenario(moduleId, scenario.originalKey, payload)
            } else {
                await businessAccountService.createScenario(moduleId, payload)
            }
        }
        for (const scenario of originalScenarios) {
            if (!keptOriginalKeys.has(scenario.key)) {
                await businessAccountService.deleteScenario(moduleId, scenario.key)
            }
        }
    }

    const deleteModule = async (module: BusinessModule) => {
        const ok = await confirm({
            title: '删除业务模块',
            description: `确定删除 ${module.name} 吗？已关联的业务账户会保留，模块关联会被清空。`,
            confirmText: '删除',
            variant: 'destructive'
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
                radius: cropRadius
            })
            setDraft(prev => ({ ...prev, logo: dataUrl }))
            setCropSource('')
        } catch {
            toast.error('Logo 裁剪失败，请换一张图片试试')
        }
    }

    return (
        <div className="h-full min-h-0 overflow-y-auto bg-gray-50/70 p-5 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
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
                                    <th className="px-4 py-3 text-left font-medium">邮箱策略</th>
                                    <th className="px-4 py-3 text-left font-medium">字段模板</th>
                                    <th className="px-4 py-3 text-left font-medium">更新时间</th>
                                    <th className="px-4 py-3 text-right font-medium">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {modules.map(module => {
                                    const statuses = readModuleStatuses(module)
                                    const fields = readModuleFields(module).filter(field => field.key)
                                    const constraints = module.emailConstraints || {}
                                    const allowedSuffixes = normalizeSuffixList(constraints.allowedSuffixes || module.claimDefaults?.emailSuffixes || [])
                                    return (
                                        <tr key={module.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40">
                                            <td className="px-4 py-3">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    {module.logo ? (
                                                        <img src={module.logo} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 object-cover dark:border-gray-800" />
                                                    ) : (
                                                        <div
                                                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
                                                            style={{
                                                                backgroundColor: module.color || moduleColors[0]
                                                            }}
                                                        >
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
                                                    {module.website ? (
                                                        <a href={module.website} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 truncate text-blue-600 hover:underline">
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                            官网
                                                        </a>
                                                    ) : (
                                                        <div className="text-gray-400">未配置官网</div>
                                                    )}
                                                    {module.loginUrl ? (
                                                        <a href={module.loginUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-[260px] items-center gap-1 truncate text-gray-500 hover:text-blue-600">
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                            登录地址
                                                        </a>
                                                    ) : (
                                                        <div className="text-gray-400">未配置登录地址</div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex max-w-[260px] flex-wrap gap-1.5">
                                                    {statuses.slice(0, 4).map(status => (
                                                        <span
                                                            key={status.value}
                                                            className="rounded-full border px-2 py-0.5 text-xs"
                                                            style={{
                                                                color: status.color,
                                                                borderColor: `${status.color || '#64748b'}55`,
                                                                backgroundColor: `${status.color || '#64748b'}14`
                                                            }}
                                                        >
                                                            {status.label}
                                                        </span>
                                                    ))}
                                                    {statuses.length > 4 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800">+{statuses.length - 4}</span>}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex max-w-[260px] flex-wrap gap-1.5">
                                                    {(allowedSuffixes.length ? allowedSuffixes : ['全部后缀']).slice(0, 3).map(suffix => (
                                                        <span key={suffix} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
                                                            {suffix}
                                                        </span>
                                                    ))}
                                                    {allowedSuffixes.length > 3 && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800">+{allowedSuffixes.length - 3}</span>}
                                                </div>
                                                <div className="mt-1 text-xs text-gray-400">
                                                    {constraints.allowAliases === false ? '禁用别名' : '可用别名'} · {constraints.allowDomainMail === false ? '禁用域名' : '可用域名'}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="text-xs text-gray-600 dark:text-gray-300">{fields.length} 个字段</div>
                                                <div className="mt-1 max-w-[220px] truncate text-xs text-gray-400">{fields.map(field => field.key).join('、') || '暂无字段模板'}</div>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-gray-500">{module.updatedAt ? new Date(module.updatedAt).toLocaleString() : '-'}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-1">
                                                    <button type="button" onClick={() => setGuideModule(module)} title="接入手册" aria-label={`${module.name} 接入手册`} className="rounded-lg p-2 text-gray-500 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/30">
                                                        <BookOpen className="h-4 w-4" />
                                                    </button>
                                                    <button onClick={() => openEdit(module)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800">
                                                        <Pencil className="h-4 w-4" />
                                                    </button>
                                                    <button onClick={() => deleteModule(module)} className="rounded-lg p-2 text-gray-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30">
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-500 dark:border-gray-800">
                            <span>
                                显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条，共 {total} 条
                            </span>
                            <div className="flex items-center gap-2">
                                <button disabled={page <= 1} onClick={() => setPage(prev => Math.max(1, prev - 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-50 dark:border-gray-700">
                                    上一页
                                </button>
                                <span className="text-xs">
                                    {page} / {totalPages}
                                </span>
                                <button disabled={page >= totalPages} onClick={() => setPage(prev => Math.min(totalPages, prev + 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-50 dark:border-gray-700">
                                    下一页
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <BusinessIntegrationGuideModal module={guideModule} open={Boolean(guideModule)} onOpenChange={open => !open && setGuideModule(null)} />

            <Modal
                open={modalOpen}
                onOpenChange={open => {
                    setModalOpen(open)
                    if (!open) {
                        setEditorScene('profile')
                        closeTemplateCreator()
                    }
                }}
            >
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
                                            <div className="flex h-16 w-16 items-center justify-center rounded-lg text-white" style={{ backgroundColor: draft.color }}>
                                                {draft.name.slice(0, 1) || <ImagePlus className="h-5 w-5" />}
                                            </div>
                                        )}
                                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                            <ImagePlus className="h-4 w-4" />
                                            选择图片
                                            <input type="file" accept="image/*" className="hidden" onChange={event => readLogoFile(event.target.files?.[0])} />
                                        </label>
                                    </div>
                                    <input
                                        value={draft.logo}
                                        onChange={event =>
                                            setDraft(prev => ({
                                                ...prev,
                                                logo: event.target.value
                                            }))
                                        }
                                        placeholder="或粘贴 logo URL / data URL"
                                        className={cn(inputClass, 'mt-3')}
                                    />
                                </div>

                                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
                                    <div className="mb-3 text-sm font-semibold">主题色</div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {moduleColors.map(color => (
                                            <button key={color} onClick={() => setDraft(prev => ({ ...prev, color }))} className={cn('h-8 w-8 rounded-lg border-2', draft.color === color ? 'border-gray-900 dark:border-white' : 'border-transparent')} style={{ backgroundColor: color }} />
                                        ))}
                                        <label className="ml-1 inline-flex h-8 items-center gap-2 rounded-lg border border-gray-200 px-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                                            自定义
                                            <input
                                                type="color"
                                                value={draft.color || moduleColors[0]}
                                                onChange={event =>
                                                    setDraft(prev => ({
                                                        ...prev,
                                                        color: event.target.value
                                                    }))
                                                }
                                                className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0"
                                            />
                                        </label>
                                    </div>
                                    <input
                                        value={draft.color}
                                        onChange={event =>
                                            setDraft(prev => ({
                                                ...prev,
                                                color: event.target.value
                                            }))
                                        }
                                        className={cn(inputClass, 'mt-3 font-mono text-xs')}
                                    />
                                </div>
                            </div>

                            <div className="space-y-5">
                                {editorScene === 'profile' ? (
                                    <>
                                        <div className="grid gap-4 lg:grid-cols-2">
                                            <Field label="模块名称">
                                                <input
                                                    value={draft.name}
                                                    onChange={event =>
                                                        setDraft(prev => ({
                                                            ...prev,
                                                            name: event.target.value
                                                        }))
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                            <Field label="排序">
                                                <input
                                                    value={draft.sortOrder}
                                                    onChange={event =>
                                                        setDraft(prev => ({
                                                            ...prev,
                                                            sortOrder: event.target.value
                                                        }))
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                            <Field label="官网地址">
                                                <input
                                                    value={draft.website}
                                                    onChange={event =>
                                                        setDraft(prev => ({
                                                            ...prev,
                                                            website: event.target.value
                                                        }))
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                            <Field label="登录地址">
                                                <input
                                                    value={draft.loginUrl}
                                                    onChange={event =>
                                                        setDraft(prev => ({
                                                            ...prev,
                                                            loginUrl: event.target.value
                                                        }))
                                                    }
                                                    className={inputClass}
                                                />
                                            </Field>
                                            <Field label="描述" className="lg:col-span-2">
                                                <textarea
                                                    value={draft.description}
                                                    onChange={event =>
                                                        setDraft(prev => ({
                                                            ...prev,
                                                            description: event.target.value
                                                        }))
                                                    }
                                                    className={textareaClass}
                                                />
                                            </Field>
                                        </div>

                                        <div>
                                            <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">申请与取件</div>
                                            <div className="grid gap-3 md:grid-cols-2">
                                                <SecondaryConfigCard title="邮箱申请策略" description="默认邮箱模式、后缀约束和别名能力" summary={formatEmailPolicySummary(draft)} meta={formatEmailCapabilitySummary(draft)} icon={<MailCheck className="h-5 w-5" />} onClick={() => setEditorScene('email-policy')} />
                                                <SecondaryConfigCard title="业务场景" description="注册、登录、找回等取件与提取规则" summary={formatScenarioSummary(draft.scenarios)} meta={scenariosLoading ? '正在加载场景' : `${draft.scenarios.filter(scenario => scenario.enabled).length} 个启用`} icon={<Workflow className="h-5 w-5" />} onClick={() => setEditorScene('scenarios')} />
                                            </div>
                                        </div>

                                        <Panel title="自定义状态" description="业务账户选择该模块后，会使用这里配置的状态。">
                                            <div className="space-y-2">
                                                {draft.statuses.map((status, index) => (
                                                    <div key={index} className="grid gap-2 md:grid-cols-[150px_150px_130px_minmax(0,1fr)_36px]">
                                                        <input
                                                            value={status.value}
                                                            onChange={event =>
                                                                setDraft(prev => ({
                                                                    ...prev,
                                                                    statuses: prev.statuses.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item))
                                                                }))
                                                            }
                                                            placeholder="状态值"
                                                            className={inputClass}
                                                        />
                                                        <input
                                                            value={status.label}
                                                            onChange={event =>
                                                                setDraft(prev => ({
                                                                    ...prev,
                                                                    statuses: prev.statuses.map((item, itemIndex) => (itemIndex === index ? { ...item, label: event.target.value } : item))
                                                                }))
                                                            }
                                                            placeholder="展示名称"
                                                            className={inputClass}
                                                        />
                                                        <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-2 text-xs text-gray-500 dark:border-gray-700">
                                                            <input
                                                                type="color"
                                                                value={status.color || statusColors[0]}
                                                                onChange={event =>
                                                                    setDraft(prev => ({
                                                                        ...prev,
                                                                        statuses: prev.statuses.map((item, itemIndex) =>
                                                                            itemIndex === index
                                                                                ? {
                                                                                      ...item,
                                                                                      color: event.target.value
                                                                                  }
                                                                                : item
                                                                        )
                                                                    }))
                                                                }
                                                                className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0"
                                                            />
                                                            颜色
                                                        </label>
                                                        <input
                                                            value={status.color || statusColors[0]}
                                                            onChange={event =>
                                                                setDraft(prev => ({
                                                                    ...prev,
                                                                    statuses: prev.statuses.map((item, itemIndex) => (itemIndex === index ? { ...item, color: event.target.value } : item))
                                                                }))
                                                            }
                                                            placeholder="#10b981"
                                                            className={cn(inputClass, 'font-mono text-xs')}
                                                        />
                                                        <button
                                                            onClick={() =>
                                                                setDraft(prev => ({
                                                                    ...prev,
                                                                    statuses: prev.statuses.filter((_, itemIndex) => itemIndex !== index)
                                                                }))
                                                            }
                                                            className="rounded-lg border border-gray-200 text-gray-500 hover:text-rose-600 dark:border-gray-700"
                                                        >
                                                            <X className="mx-auto h-4 w-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                            <button
                                                onClick={() =>
                                                    setDraft(prev => ({
                                                        ...prev,
                                                        statuses: [...prev.statuses, { value: '', label: '', color: statusColors[0] }]
                                                    }))
                                                }
                                                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
                                            >
                                                <Plus className="h-4 w-4" />
                                                添加状态
                                            </button>
                                        </Panel>

                                        <Panel title="账户扩展字段模板" description="创建业务账户并选择该模块时，会自动预填充这些字段。">
                                            <div className="space-y-2">
                                                {draft.fields.map((field, index) => (
                                                    <div key={index} className="grid gap-2 lg:grid-cols-[160px_120px_minmax(0,1fr)_36px]">
                                                        <input
                                                            value={field.key}
                                                            onChange={event =>
                                                                setDraft(prev => ({
                                                                    ...prev,
                                                                    fields: prev.fields.map((item, itemIndex) => (itemIndex === index ? { ...item, key: event.target.value } : item))
                                                                }))
                                                            }
                                                            placeholder="字段名"
                                                            className={inputClass}
                                                        />
                                                        <select
                                                            value={field.type}
                                                            onChange={event =>
                                                                setDraft(prev => ({
                                                                    ...prev,
                                                                    fields: prev.fields.map((item, itemIndex) =>
                                                                        itemIndex === index
                                                                            ? {
                                                                                  ...item,
                                                                                  type: event.target.value as BusinessCustomFieldType
                                                                              }
                                                                            : item
                                                                    )
                                                                }))
                                                            }
                                                            className={inputClass}
                                                        >
                                                            {fieldTypes.map(type => (
                                                                <option key={type.value} value={type.value}>
                                                                    {type.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <input
                                                            value={field.value}
                                                            onChange={event =>
                                                                setDraft(prev => ({
                                                                    ...prev,
                                                                    fields: prev.fields.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item))
                                                                }))
                                                            }
                                                            placeholder={field.type === 'totp' ? 'Base32 2FA Secret 默认值' : '默认值，可为空'}
                                                            className={inputClass}
                                                        />
                                                        <button
                                                            onClick={() =>
                                                                setDraft(prev => ({
                                                                    ...prev,
                                                                    fields: prev.fields.filter((_, itemIndex) => itemIndex !== index)
                                                                }))
                                                            }
                                                            className="rounded-lg border border-gray-200 text-gray-500 hover:text-rose-600 dark:border-gray-700"
                                                        >
                                                            <X className="mx-auto h-4 w-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                            <button
                                                onClick={() =>
                                                    setDraft(prev => ({
                                                        ...prev,
                                                        fields: [...prev.fields, { key: '', type: 'text', value: '' }]
                                                    }))
                                                }
                                                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
                                            >
                                                <Plus className="h-4 w-4" />
                                                添加字段
                                            </button>
                                        </Panel>
                                    </>
                                ) : editorScene === 'email-policy' ? (
                                    <SubSceneShell title="邮箱申请策略" description="配置该业务模块默认申请邮箱时继承的模式、后缀和能力约束。" icon={<MailCheck className="h-5 w-5" />} onBack={() => setEditorScene('profile')}>
                                        <EmailPolicyEditor draft={draft} setDraft={setDraft} />
                                    </SubSceneShell>
                                ) : (
                                    <SubSceneShell title="业务场景" description="配置注册、登录、找回等场景各自的取件和提取规则。" icon={<Workflow className="h-5 w-5" />} onBack={() => setEditorScene('profile')}>
                                        <ScenariosEditor
                                            draft={draft}
                                            setDraft={setDraft}
                                            scenariosLoading={scenariosLoading}
                                            extractorTemplates={extractorTemplates}
                                            templatesLoading={extractorTemplatesLoading}
                                            onRefreshTemplates={() => loadExtractorTemplates(true)}
                                            onCreateTemplate={openTemplateCreator}
                                        />
                                    </SubSceneShell>
                                )}
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button onClick={() => setModalOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">
                            取消
                        </button>
                        <button onClick={saveModule} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-gray-900">
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            保存模块
                        </button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <Modal open={templateCreateOpen} onOpenChange={open => !open && closeTemplateCreator()}>
                <ModalContent size="full" className="z-[61] h-[94vh] max-h-[94vh] max-w-[96vw] overflow-hidden" overlayClassName="z-[60]">
                    <ModalTitle className="sr-only">新建取件模板</ModalTitle>
                    <ModalDescription className="sr-only">在业务场景中创建并选择一个 V2 取件模板。</ModalDescription>
                    <ModalBody className="overflow-hidden p-0">
                        <ExtractorCreationWizard key={`business-template-create-${templateCreateInstance}`} tempId={`business-modal-${templateCreateInstance}`} embedded onSaved={handleTemplateCreated} onCancel={closeTemplateCreator} />
                    </ModalBody>
                </ModalContent>
            </Modal>

            <Modal open={Boolean(cropSource)} onOpenChange={open => !open && setCropSource('')}>
                <ModalContent size="2xl">
                    <ModalHeader>
                        <ModalTitle>裁剪 Logo</ModalTitle>
                        <ModalDescription>调整图片位置、缩放和圆角，保存后会写入模块 logo。</ModalDescription>
                    </ModalHeader>
                    <ModalBody>
                        <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
                            <div className="flex justify-center">
                                <div className="relative h-56 w-56 overflow-hidden border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-950" style={{ borderRadius: cropRadius }}>
                                    {cropSource && (
                                        <img
                                            src={cropSource}
                                            alt=""
                                            className="h-full w-full object-cover"
                                            style={{
                                                transform: `translate(${cropX}px, ${cropY}px) scale(${cropScale})`,
                                                transformOrigin: 'center'
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
                        <button onClick={() => setCropSource('')} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">
                            取消
                        </button>
                        <button onClick={applyLogoCrop} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900">
                            应用裁剪
                        </button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    )
}

const inputClass = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950'
const textareaClass = 'min-h-[96px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950'

function BusinessIntegrationGuideModal({ module, open, onOpenChange }: { module: BusinessModule | null; open: boolean; onOpenChange: (open: boolean) => void }) {
    const [selectedEndpointKey, setSelectedEndpointKey] = useState<GuideEndpointKey>('claim')
    const [selectedLanguage, setSelectedLanguage] = useState<GuideLanguage>('curl')

    useEffect(() => {
        if (!open || !module) return
        setSelectedEndpointKey('claim')
        setSelectedLanguage('curl')
    }, [module?.id, open])

    if (!module) return null
    const guide = buildBusinessIntegrationGuide(module)
    const selectedEndpoint = guide.endpoints.find(endpoint => endpoint.key === selectedEndpointKey) || guide.endpoints[0]
    const selectedCode = buildGuideEndpointCode(guide, selectedEndpoint.key, selectedLanguage)

    return (
        <Modal open={open} onOpenChange={onOpenChange}>
            <ModalContent size="full" className="h-[92vh] max-h-[92vh] max-w-[96vw]">
                <ModalHeader>
                    <ModalTitle className="flex items-center gap-2">
                        <BookOpen className="h-5 w-5 text-blue-600" />
                        {module.name} 接入手册
                    </ModalTitle>
                    <ModalDescription>按当前业务模块和 API 配置实时生成。复制示例前请替换 `MAILMAN_TOKEN`，或把 `MAILMAN_API_BASE` 指向目标实例。</ModalDescription>
                </ModalHeader>
                <ModalBody className="space-y-5">
                    <GuideSection title="接入顺序">
                        <div className="grid gap-3 md:grid-cols-3">
                            <GuideStep index={1} title="申请邮箱" description="调用模块 claim 接口，系统会按邮箱模式和后缀策略占用一个注册邮箱。" />
                            <GuideStep index={2} title="取件验证" description="使用 claim 返回的 pickup.account_id 与 pickup.to_query 轮询验证码或确认链接。" />
                            <GuideStep index={3} title="完成或释放" description="注册成功调用 complete；失败调用 release 并可写入冷却排除，避免重复踩同一邮箱。" />
                        </div>
                    </GuideSection>

                    <div className="grid gap-4 xl:grid-cols-[minmax(560px,0.95fr)_minmax(540px,1.05fr)]">
                        <GuideSection title="接口清单">
                            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
                                <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
                                    <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-950/60 dark:text-gray-400">
                                        <tr>
                                            <th className="w-[76px] px-3 py-2 text-left font-medium">方法</th>
                                            <th className="px-3 py-2 text-left font-medium">路径</th>
                                            <th className="w-[150px] px-3 py-2 text-left font-medium">用途</th>
                                            <th className="w-[210px] px-3 py-2 text-left font-medium">返回</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {guide.endpoints.map(endpoint => {
                                            const selected = endpoint.key === selectedEndpoint.key
                                            return (
                                                <tr
                                                    key={endpoint.key}
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-selected={selected}
                                                    onClick={() => setSelectedEndpointKey(endpoint.key)}
                                                    onKeyDown={event => {
                                                        if (event.key !== 'Enter' && event.key !== ' ') return
                                                        event.preventDefault()
                                                        setSelectedEndpointKey(endpoint.key)
                                                    }}
                                                    className={cn('cursor-pointer outline-none transition focus:bg-blue-50/80 dark:focus:bg-blue-950/30', selected ? 'bg-blue-50/80 dark:bg-blue-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50')}
                                                >
                                                    <td className="px-3 py-3">
                                                        <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">{endpoint.method}</span>
                                                    </td>
                                                    <td className="px-3 py-3 font-mono text-xs text-gray-700 dark:text-gray-200">{endpoint.path}</td>
                                                    <td className="px-3 py-3 text-gray-600 dark:text-gray-300">{endpoint.label}</td>
                                                    <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">{endpoint.response}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </GuideSection>

                        <GuideSection
                            title="接口代码"
                            actions={
                                <select value={selectedLanguage} onChange={event => setSelectedLanguage(event.target.value as GuideLanguage)} className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200">
                                    {guideLanguages.map(language => (
                                        <option key={language.value} value={language.value}>
                                            {language.label}
                                        </option>
                                    ))}
                                </select>
                            }
                        >
                            <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-950/60">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">{selectedEndpoint.method}</span>
                                    <span className="font-mono text-xs text-gray-700 dark:text-gray-200">{selectedEndpoint.path}</span>
                                </div>
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{selectedEndpoint.label}，{selectedEndpoint.response}</p>
                            </div>
                            <IntegrationCodeBlock title={`${guideLanguages.find(language => language.value === selectedLanguage)?.label || 'curl'} 示例`} code={selectedCode} />
                        </GuideSection>
                    </div>

                    <GuideSection title="当前模块参数">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {guide.policyItems.map(item => (
                                <div key={item.label} className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-950/60">
                                    <div className="text-xs text-gray-400">{item.label}</div>
                                    <div className="mt-1 break-words text-sm font-medium text-gray-800 dark:text-gray-100">{item.value}</div>
                                </div>
                            ))}
                            {(module.website || module.loginUrl) && (
                                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-950/60">
                                    {module.website && (
                                        <a href={module.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300">
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            官网
                                        </a>
                                    )}
                                    {module.loginUrl && (
                                        <a href={module.loginUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:text-blue-600 dark:border-gray-700 dark:text-gray-300">
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            登录地址
                                        </a>
                                    )}
                                </div>
                            )}
                        </div>
                    </GuideSection>
                </ModalBody>
            </ModalContent>
        </Modal>
    )
}

function GuideSection({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                {actions}
            </div>
            {children}
        </section>
    )
}

function GuideStep({ index, title, description }: { index: number; title: string; description: string }) {
    return (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/60">
            <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{index}</span>
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</p>
        </div>
    )
}

function IntegrationCodeBlock({ title, code, compact = false }: { title: string; code: string; compact?: boolean }) {
    return (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="flex h-10 items-center justify-between border-b border-gray-100 bg-gray-50 px-3 dark:border-gray-800 dark:bg-gray-950/70">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{title}</span>
                <button type="button" onClick={() => void copyToClipboard(code)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-white hover:text-blue-600 dark:hover:bg-gray-800 dark:hover:text-blue-200">
                    <Copy className="h-3.5 w-3.5" />
                    复制
                </button>
            </div>
            <pre className={cn('overflow-auto bg-gray-950 p-3 text-xs leading-5 text-gray-100', compact ? 'max-h-56' : 'max-h-[420px]')}>
                <code>{code}</code>
            </pre>
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

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Tag className="h-4 w-4 text-blue-500" />
                    {title}
                </h3>
                <p className="mt-1 text-xs text-gray-500">{description}</p>
            </div>
            {children}
        </div>
    )
}

function SecondaryConfigCard({ title, description, summary, meta, icon, onClick }: { title: string; description: string; summary: string; meta: string; icon: ReactNode; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="group flex min-h-[116px] items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left transition hover:border-blue-200 hover:bg-blue-50/40 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-900/60 dark:hover:bg-blue-950/20">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition group-hover:bg-blue-100 group-hover:text-blue-600 dark:bg-gray-800 dark:text-gray-300 dark:group-hover:bg-blue-950/50 dark:group-hover:text-blue-200">{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 transition group-hover:text-blue-500" />
                </span>
                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{description}</span>
                <span className="mt-3 block truncate text-sm font-medium text-gray-800 dark:text-gray-100">{summary}</span>
                <span className="mt-1 block truncate text-xs text-gray-400">{meta}</span>
            </span>
        </button>
    )
}

function SubSceneShell({ title, description, icon, onBack, children }: { title: string; description: string; icon: ReactNode; onBack: () => void; children: ReactNode }) {
    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 border-b border-gray-100 pb-4 dark:border-gray-800">
                <button type="button" onClick={onBack} className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-100" aria-label="返回基础资料">
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-200">{icon}</div>
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
                </div>
            </div>
            {children}
        </div>
    )
}

function EmailPolicyEditor({ draft, setDraft }: { draft: ModuleDraft; setDraft: Dispatch<SetStateAction<ModuleDraft>> }) {
    return (
        <div className="space-y-4">
            <div>
                <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">邮箱模式与支持范围</div>
                        <div className="text-xs text-gray-500">每种模式只配置一次；默认模式用于调用方未显式指定邮箱类型时，支持范围是硬约束。</div>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300">
                        <span>开启排序</span>
                        <Switch checked={draft.emailModePriorityEnabled} onCheckedChange={checked => setDraft(prev => ({ ...prev, emailModePriorityEnabled: checked }))} />
                    </label>
                </div>
                <EmailModePolicyGrid draft={draft} setDraft={setDraft} />
            </div>
            <div className="grid gap-4 lg:grid-cols-[140px_minmax(0,1fr)]">
                <Field label="Claim 有效期">
                    <StepperInput value={draft.claimTTL} min={60} max={3600} step={60} suffix="秒" onChange={value => setDraft(prev => ({ ...prev, claimTTL: value }))} />
                </Field>
                <Field label="别名前缀">
                    <div className="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)]">
                        <select
                            value={draft.prefixStrategy}
                            onChange={event =>
                                setDraft(prev => ({
                                    ...prev,
                                    prefixStrategy: event.target.value as ModuleDraft['prefixStrategy']
                                }))
                            }
                            className={inputClass}
                        >
                            {prefixStrategies.map(strategy => (
                                <option key={strategy.value} value={strategy.value}>
                                    {strategy.label}
                                </option>
                            ))}
                        </select>
                        {draft.prefixStrategy === 'template' ? (
                            <input
                                value={draft.prefixTemplate}
                                onChange={event =>
                                    setDraft(prev => ({
                                        ...prev,
                                        prefixTemplate: event.target.value
                                    }))
                                }
                                placeholder="{module}-{date}-{hex4}"
                                className={inputClass}
                            />
                        ) : draft.prefixStrategy === 'random' ? (
                            <StepperInput value={draft.randomLength} min={4} max={24} step={1} suffix="位" onChange={value => setDraft(prev => ({ ...prev, randomLength: value }))} />
                        ) : (
                            <input
                                value={draft.builtinPrefix}
                                onChange={event =>
                                    setDraft(prev => ({
                                        ...prev,
                                        builtinPrefix: event.target.value
                                    }))
                                }
                                placeholder="module"
                                className={inputClass}
                            />
                        )}
                    </div>
                </Field>
            </div>
            <ChipMultiSelect
                label="允许邮箱后缀"
                description="留空表示不限制。可点选常用后缀，也可输入自定义域名。"
                values={draft.allowedSuffixes}
                suggestions={suffixSuggestions}
                sortEnabled={draft.allowedSuffixPriorityEnabled}
                emptyText="不限制后缀"
                onSortEnabledChange={checked => setDraft(prev => ({ ...prev, allowedSuffixPriorityEnabled: checked }))}
                onChange={values => setDraft(prev => ({ ...prev, allowedSuffixes: values }))}
            />
            <ChipMultiSelect label="禁止邮箱后缀" description="申请邮箱时会排除这些后缀。" values={draft.blockedSuffixes} suggestions={suffixSuggestions} tone="danger" emptyText="未禁止后缀" onChange={values => setDraft(prev => ({ ...prev, blockedSuffixes: values }))} />
        </div>
    )
}

function EmailModePolicyGrid({ draft, setDraft }: { draft: ModuleDraft; setDraft: Dispatch<SetStateAction<ModuleDraft>> }) {
    const [activeMode, setActiveMode] = useState<{ id: BusinessEmailMode; width: number } | null>(null)
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
    const setDefaultMode = (mode: ModuleDraft['claimEmailMode']) => {
        setDraft(prev => ({
            ...enableEmailMode(prev, mode),
            claimEmailMode: mode
        }))
    }
    const setSupported = (mode: ModuleDraft['claimEmailMode'], supported: boolean) => {
        setDraft(prev => {
            const next = setEmailModeSupported(prev, mode, supported)
            return !supported && next.claimEmailMode === mode ? { ...next, claimEmailMode: 'primary' } : next
        })
    }
    const handleDragStart = (event: DragStartEvent) => {
        setActiveMode({
            id: event.active.id as BusinessEmailMode,
            width: event.active.rect.current.initial?.width || 220
        })
    }
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        setActiveMode(null)
        if (!over || active.id === over.id) return
        setDraft(prev => {
            const order = normalizeEmailModeOrder(prev.emailModePriority)
            const oldIndex = order.indexOf(active.id as BusinessEmailMode)
            const newIndex = order.indexOf(over.id as BusinessEmailMode)
            if (oldIndex < 0 || newIndex < 0) return prev
            return { ...prev, emailModePriority: arrayMove(order, oldIndex, newIndex) }
        })
    }
    const orderedModeValues = draft.emailModePriorityEnabled ? normalizeEmailModeOrder(draft.emailModePriority) : emailModes.map(mode => mode.value)
    const renderedModes = orderedModeValues
        .map(value => emailModes.find(mode => mode.value === value))
        .filter(Boolean) as typeof emailModes
    const activeModeMeta = activeMode ? emailModes.find(mode => mode.value === activeMode.id) : undefined
    const activeModeIndex = activeMode ? orderedModeValues.indexOf(activeMode.id) : -1

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveMode(null)}>
            <SortableContext items={orderedModeValues} strategy={rectSortingStrategy}>
                <div className="grid gap-2 md:grid-cols-4">
                    {renderedModes.map((mode, index) => (
                        <SortableEmailModeCard
                            key={mode.value}
                            mode={mode}
                            index={index}
                            sortEnabled={draft.emailModePriorityEnabled}
                            isDefault={draft.claimEmailMode === mode.value}
                            supported={isEmailModeSupported(draft, mode.value)}
                            onSetDefault={() => setDefaultMode(mode.value)}
                            onSupportedChange={checked => setSupported(mode.value, checked)}
                        />
                    ))}
                </div>
            </SortableContext>
            <BodyDragOverlay dropAnimation={null}>
                {activeModeMeta ? (
                    <EmailModeCardPreview
                        mode={activeModeMeta}
                        index={activeModeIndex}
                        isDefault={draft.claimEmailMode === activeModeMeta.value}
                        supported={isEmailModeSupported(draft, activeModeMeta.value)}
                        width={activeMode?.width}
                    />
                ) : null}
            </BodyDragOverlay>
        </DndContext>
    )
}

function SortableEmailModeCard({
    mode,
    index,
    sortEnabled,
    isDefault,
    supported,
    onSetDefault,
    onSupportedChange
}: {
    mode: (typeof emailModes)[number]
    index: number
    sortEnabled: boolean
    isDefault: boolean
    supported: boolean
    onSetDefault: () => void
    onSupportedChange: (checked: boolean) => void
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: mode.value,
        disabled: !sortEnabled
    })
    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    }
    return (
        <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-10 opacity-35')}>
            <EmailModeCardContent
                mode={mode}
                index={index}
                sortEnabled={sortEnabled}
                isDefault={isDefault}
                supported={supported}
                onSetDefault={onSetDefault}
                onSupportedChange={onSupportedChange}
                dragHandleProps={sortEnabled ? { ...attributes, ...listeners } : undefined}
            />
        </div>
    )
}

function EmailModeCardPreview({ mode, index, isDefault, supported, width }: { mode: (typeof emailModes)[number]; index: number; isDefault: boolean; supported: boolean; width?: number }) {
    return (
        <div className="shadow-2xl" style={{ width: width ? `${width}px` : undefined }}>
            <EmailModeCardContent mode={mode} index={index} sortEnabled isDefault={isDefault} supported={supported} preview />
        </div>
    )
}

function EmailModeCardContent({
    mode,
    index,
    sortEnabled,
    isDefault,
    supported,
    preview = false,
    onSetDefault,
    onSupportedChange,
    dragHandleProps
}: {
    mode: (typeof emailModes)[number]
    index: number
    sortEnabled: boolean
    isDefault: boolean
    supported: boolean
    preview?: boolean
    onSetDefault?: () => void
    onSupportedChange?: (checked: boolean) => void
    dragHandleProps?: Record<string, any>
}) {
    const primary = mode.value === 'primary'
    return (
        <div className={cn('overflow-hidden rounded-lg border bg-white transition dark:bg-gray-950', isDefault ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30' : supported ? 'border-gray-200 dark:border-gray-700' : 'border-gray-200 opacity-70 dark:border-gray-800', preview && 'border-blue-300 bg-white dark:bg-gray-900')}>
            <div className="block min-h-[88px] w-full p-3 text-left">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        {sortEnabled && (
                            <div className="mb-2 flex items-center gap-1 text-xs font-medium text-gray-400">
                                <button type="button" disabled={preview} className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:hover:bg-transparent dark:hover:bg-gray-800" {...dragHandleProps}>
                                    <GripVertical className="h-3.5 w-3.5" />
                                </button>
                                <span>优先 {index + 1}</span>
                            </div>
                        )}
                        <button type="button" disabled={preview} onClick={onSetDefault} className={cn('block text-left text-sm font-semibold disabled:cursor-default', isDefault ? 'text-blue-700 dark:text-blue-200' : 'text-gray-900 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-200')}>
                            {mode.label}
                        </button>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{mode.description}</div>
                    </div>
                    {isDefault && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/60 dark:text-blue-200">默认</span>}
                </div>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 py-2 text-xs dark:border-gray-800">
                <span className={supported ? 'text-emerald-600 dark:text-emerald-300' : 'text-gray-400'}>{supported ? '已启用' : '已关闭'}</span>
                {primary ? (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500 dark:bg-gray-800">基础</span>
                ) : (
                    <Switch disabled={preview} checked={supported} onCheckedChange={onSupportedChange} />
                )}
            </div>
        </div>
    )
}

function isEmailModeSupported(draft: ModuleDraft, mode: ModuleDraft['claimEmailMode']) {
    if (mode === 'primary') return true
    if (mode === 'alias') return draft.allowAliases
    if (mode === 'domain') return draft.allowDomainMail
    if (mode === 'forwarded') return draft.allowForwarded
    return true
}

function enableEmailMode(draft: ModuleDraft, mode: ModuleDraft['claimEmailMode']) {
    return setEmailModeSupported(draft, mode, true)
}

function setEmailModeSupported(draft: ModuleDraft, mode: ModuleDraft['claimEmailMode'], supported: boolean): ModuleDraft {
    if (mode === 'alias') return { ...draft, allowAliases: supported }
    if (mode === 'domain') return { ...draft, allowDomainMail: supported }
    if (mode === 'forwarded') return { ...draft, allowForwarded: supported }
    return draft
}

function ScenariosEditor({
    draft,
    setDraft,
    scenariosLoading,
    extractorTemplates,
    templatesLoading,
    onRefreshTemplates,
    onCreateTemplate
}: {
    draft: ModuleDraft
    setDraft: Dispatch<SetStateAction<ModuleDraft>>
    scenariosLoading: boolean
    templatesLoading: boolean
    onRefreshTemplates: () => void
    onCreateTemplate: (scenarioIndex: number) => void
    extractorTemplates: Array<{
        id: number
        name: string
        category?: string
        enabled?: boolean
    }>
}) {
    return (
        <div>
            <div className="mb-3 flex flex-wrap gap-2">
                {scenarioPresets.map(preset => {
                    const exists = draft.scenarios.some(scenario => normalizeScenarioKey(scenario.key) === preset.key)
                    return (
                        <button
                            key={preset.key}
                            type="button"
                            disabled={exists}
                            onClick={() =>
                                setDraft(prev => ({
                                    ...prev,
                                    scenarios: [...prev.scenarios, emptyScenarioDraft(preset)]
                                }))
                            }
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                        >
                            <Plus className="h-4 w-4" />
                            {preset.name}
                        </button>
                    )
                })}
                <button
                    type="button"
                    onClick={() =>
                        setDraft(prev => ({
                            ...prev,
                            scenarios: [...prev.scenarios, emptyScenarioDraft()]
                        }))
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                    <Plus className="h-4 w-4" />
                    自定义场景
                </button>
            </div>
            {scenariosLoading ? (
                <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                    正在加载业务场景
                </div>
            ) : draft.scenarios.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
                    <Workflow className="mx-auto mb-2 h-6 w-6 text-gray-300" />
                    暂无业务场景
                </div>
            ) : (
                <div className="space-y-3">
                    {draft.scenarios.map((scenario, index) => (
                        <ScenarioEditor
                            key={scenario.originalKey || index}
                            scenario={scenario}
                            templates={extractorTemplates}
                            templatesLoading={templatesLoading}
                            onRefreshTemplates={onRefreshTemplates}
                            onCreateTemplate={() => onCreateTemplate(index)}
                            onChange={next =>
                                setDraft(prev => ({
                                    ...prev,
                                    scenarios: prev.scenarios.map((item, itemIndex) => (itemIndex === index ? next : item))
                                }))
                            }
                            onDelete={() =>
                                setDraft(prev => ({
                                    ...prev,
                                    scenarios: prev.scenarios.filter((_, itemIndex) => itemIndex !== index)
                                }))
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

function StepperInput({ value, min, max, step, suffix, onChange }: { value: string; min: number; max: number; step: number; suffix: string; onChange: (value: string) => void }) {
    const numberValue = Number(value || min)
    const update = (next: number) => onChange(String(Math.min(max, Math.max(min, next))))
    return (
        <div className="flex h-10 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-950">
            <button type="button" onClick={() => update(numberValue - step)} className="w-9 border-r border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                -
            </button>
            <input value={value} onChange={event => onChange(event.target.value.replace(/[^\d]/g, ''))} className="min-w-0 flex-1 bg-transparent px-3 text-center text-sm outline-none" />
            <span className="flex items-center px-2 text-xs text-gray-400">{suffix}</span>
            <button type="button" onClick={() => update(numberValue + step)} className="w-9 border-l border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                +
            </button>
        </div>
    )
}

function ChipMultiSelect({
    label,
    description,
    values,
    suggestions,
    tone = 'default',
    sortEnabled = false,
    emptyText = '暂无后缀',
    onSortEnabledChange,
    onChange
}: {
    label: string
    description: string
    values: string[]
    suggestions: string[]
    tone?: 'default' | 'danger'
    sortEnabled?: boolean
    emptyText?: string
    onSortEnabledChange?: (checked: boolean) => void
    onChange: (values: string[]) => void
}) {
    const [input, setInput] = useState('')
    const [activeSuffix, setActiveSuffix] = useState<{ value: string; width: number } | null>(null)
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
    const addValue = (raw: string) => {
        const next = normalizeSuffix(raw)
        if (!next) return
        onChange(normalizeSuffixList([...values, next]))
        setInput('')
    }
    const removeValue = (target: string) => onChange(values.filter(value => value !== target))
    const handleDragStart = (event: DragStartEvent) => {
        setActiveSuffix({
            value: String(event.active.id),
            width: event.active.rect.current.initial?.width || 260
        })
    }
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        setActiveSuffix(null)
        if (!over || active.id === over.id) return
        const oldIndex = values.indexOf(String(active.id))
        const newIndex = values.indexOf(String(over.id))
        if (oldIndex < 0 || newIndex < 0) return
        onChange(arrayMove(values, oldIndex, newIndex))
    }
    const activeClass = tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200' : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200'
    const neutralClass = 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900'
    return (
        <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</div>
                    <div className="text-xs text-gray-500">{description}</div>
                </div>
                {onSortEnabledChange && (
                    <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300">
                        <span>开启排序</span>
                        <Switch checked={sortEnabled} onCheckedChange={onSortEnabledChange} />
                    </label>
                )}
            </div>
            <div className="flex flex-wrap gap-1.5 border-b border-gray-100 pb-3 dark:border-gray-800">
                {suggestions.map(suggestion => {
                    const normalized = normalizeSuffix(suggestion)
                    const active = values.includes(normalized)
                    return (
                        <button key={suggestion} type="button" onClick={() => (active ? removeValue(normalized) : addValue(normalized))} className={cn('rounded-full border px-2.5 py-1 text-xs transition', active ? activeClass : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800')}>
                            {active && <Check className="mr-1 inline h-3 w-3" />}
                            {suggestion}
                        </button>
                    )
                })}
            </div>
            <div className="space-y-2">
                {values.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-sm text-gray-400 dark:border-gray-700">{emptyText}</div>
                ) : sortEnabled ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveSuffix(null)}>
                        <SortableContext items={values} strategy={verticalListSortingStrategy}>
                            <div className="space-y-1.5">
                                {values.map((value, index) => (
                                    <SortableSuffixRow key={value} value={value} index={index} activeClass={activeClass} onRemove={() => removeValue(value)} />
                                ))}
                            </div>
                        </SortableContext>
                        <BodyDragOverlay dropAnimation={null}>
                            {activeSuffix ? <SuffixRowPreview value={activeSuffix.value} index={values.indexOf(activeSuffix.value)} activeClass={activeClass} width={activeSuffix.width} /> : null}
                        </BodyDragOverlay>
                    </DndContext>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {values.map(value => (
                            <span key={value} className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs', activeClass)}>
                                {value}
                                <button type="button" onClick={() => removeValue(value)} className="rounded-full hover:bg-white/60 dark:hover:bg-gray-900/40">
                                    <X className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-2">
                <input
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault()
                            addValue(input)
                        }
                    }}
                    placeholder={values.length ? '继续添加后缀' : '输入域名后回车'}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                />
                <button type="button" onClick={() => addValue(input)} disabled={!input.trim()} className={cn('inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50', neutralClass)}>
                    <Plus className="h-4 w-4" />
                    添加
                </button>
            </div>
        </div>
    )
}

function BodyDragOverlay(props: ComponentProps<typeof DragOverlay>) {
    const [mounted, setMounted] = useState(false)
    useEffect(() => {
        setMounted(true)
    }, [])
    if (!mounted || typeof document === 'undefined') return null
    return createPortal(<DragOverlay {...props} />, document.body)
}

function SortableSuffixRow({ value, index, activeClass, onRemove }: { value: string; index: number; activeClass: string; onRemove: () => void }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: value })
    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    }
    return (
        <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-10 opacity-35')}>
            <SuffixRowContent value={value} index={index} activeClass={activeClass} onRemove={onRemove} dragHandleProps={{ ...attributes, ...listeners }} />
        </div>
    )
}

function SuffixRowPreview({ value, index, activeClass, width }: { value: string; index: number; activeClass: string; width?: number }) {
    return (
        <div className="shadow-2xl" style={{ width: width ? `${width}px` : undefined }}>
            <SuffixRowContent value={value} index={index} activeClass={activeClass} preview />
        </div>
    )
}

function SuffixRowContent({ value, index, activeClass, preview = false, onRemove, dragHandleProps }: { value: string; index: number; activeClass: string; preview?: boolean; onRemove?: () => void; dragHandleProps?: Record<string, any> }) {
    return (
        <div className={cn('flex h-9 items-center gap-2 rounded-lg border px-2 text-sm', activeClass, preview && 'bg-white dark:bg-gray-900')}>
            <button type="button" disabled={preview} className="rounded p-0.5 text-current opacity-70 hover:bg-white/50 disabled:hover:bg-transparent dark:hover:bg-gray-900/40" {...dragHandleProps}>
                <GripVertical className="h-4 w-4" />
            </button>
            <span className="w-5 shrink-0 text-center text-xs font-semibold opacity-70">{index >= 0 ? index + 1 : ''}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{value}</span>
            {!preview && (
                <button type="button" onClick={onRemove} className="rounded-full p-0.5 hover:bg-white/60 dark:hover:bg-gray-900/40">
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    )
}

function ScenarioEditor({
    scenario,
    templates,
    templatesLoading,
    onRefreshTemplates,
    onCreateTemplate,
    onChange,
    onDelete
}: {
    scenario: ScenarioDraft
    templates: Array<{
        id: number
        name: string
        category?: string
        enabled?: boolean
    }>
    templatesLoading: boolean
    onRefreshTemplates: () => void
    onCreateTemplate: () => void
    onChange: (scenario: ScenarioDraft) => void
    onDelete: () => void
}) {
    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-800 dark:bg-gray-950/40">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', scenario.enabled ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-200' : 'bg-gray-100 text-gray-400 dark:bg-gray-800')}>
                        <MailCheck className="h-4 w-4" />
                    </div>
                    <div>
                        <div className="text-sm font-semibold">{scenario.name || scenario.key || '新场景'}</div>
                        <div className="text-xs text-gray-500">{scenario.key ? `/${scenario.key}/pickup` : '设置场景别名后可调用'}</div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => onChange({ ...scenario, enabled: !scenario.enabled })} className={cn('rounded-lg px-2 py-1 text-xs', scenario.enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-800')}>
                        {scenario.enabled ? '启用' : '停用'}
                    </button>
                    <button type="button" onClick={onDelete} className="rounded-lg p-2 text-gray-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30">
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-[140px_180px_minmax(0,1fr)]">
                <Field label="场景别名">
                    <input
                        value={scenario.key}
                        onChange={event =>
                            onChange({
                                ...scenario,
                                key: normalizeScenarioKey(event.target.value)
                            })
                        }
                        placeholder="register"
                        className={inputClass}
                    />
                </Field>
                <Field label="展示名称">
                    <input value={scenario.name} onChange={event => onChange({ ...scenario, name: event.target.value })} placeholder="注册验证码" className={inputClass} />
                </Field>
                <Field label="描述">
                    <input value={scenario.description} onChange={event => onChange({ ...scenario, description: event.target.value })} placeholder="触发邮件后提取验证码或链接" className={inputClass} />
                </Field>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label="保活">
                    <StepperInput value={scenario.keepAliveSeconds} min={30} max={600} step={30} suffix="秒" onChange={value => onChange({ ...scenario, keepAliveSeconds: value })} />
                </Field>
                <Field label="同步间隔">
                    <StepperInput value={scenario.syncInterval} min={1} max={60} step={1} suffix="秒" onChange={value => onChange({ ...scenario, syncInterval: value })} />
                </Field>
                <Field label="搜索数量">
                    <StepperInput value={scenario.limit} min={1} max={50} step={1} suffix="封" onChange={value => onChange({ ...scenario, limit: value })} />
                </Field>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                <Field label="提取方式">
                    <select
                        value={scenario.extractorMode}
                        onChange={event =>
                            onChange({
                                ...scenario,
                                extractorMode: event.target.value as ScenarioExtractorMode
                            })
                        }
                        className={inputClass}
                    >
                        <option value="template">取件模板</option>
                        <option value="simple">简单正则</option>
                        <option value="inline">保留内联动作</option>
                        <option value="none">只取邮件</option>
                    </select>
                </Field>
                {scenario.extractorMode === 'template' ? (
                    <Field label="取件模板">
                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                            <select value={scenario.templateId} onChange={event => onChange({ ...scenario, templateId: event.target.value })} className={inputClass}>
                                <option value="">{templates.length ? '选择模板' : '暂无可用模板'}</option>
                                {templates.map(template => (
                                    <option key={template.id} value={template.id}>
                                        {template.name}
                                        {template.category ? ` · ${template.category}` : ''}
                                    </option>
                                ))}
                            </select>
                            <button type="button" onClick={onCreateTemplate} className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                                <Plus className="h-4 w-4" />
                                新建模板
                            </button>
                            <button type="button" onClick={onRefreshTemplates} disabled={templatesLoading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                                <RefreshCw className={cn('h-4 w-4', templatesLoading && 'animate-spin')} />
                                刷新
                            </button>
                        </div>
                    </Field>
                ) : scenario.extractorMode === 'simple' ? (
                    <div className="space-y-1.5">
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">提取规则</div>
                        <div className="grid gap-2 md:grid-cols-[120px_120px_120px_minmax(0,1fr)]">
                            <select value={scenario.simpleField} onChange={event => onChange({ ...scenario, simpleField: event.target.value })} className={inputClass}>
                                <option value="body">正文</option>
                                <option value="subject">主题</option>
                                <option value="from">发件人</option>
                                <option value="html_body">HTML</option>
                            </select>
                            <select value={scenario.simpleType} onChange={event => onChange({ ...scenario, simpleType: event.target.value })} className={inputClass}>
                                <option value="regex">正则</option>
                                <option value="js">JS</option>
                                <option value="gotemplate">模板</option>
                            </select>
                            <select value={scenario.simpleMatchMode} onChange={event => onChange({ ...scenario, simpleMatchMode: event.target.value })} className={inputClass}>
                                <option value="first">第一个</option>
                                <option value="last">最后一个</option>
                                <option value="all">全部</option>
                            </select>
                            <input value={scenario.simplePattern} onChange={event => onChange({ ...scenario, simplePattern: event.target.value })} placeholder="例如 \\b\\d{6}\\b" className={inputClass} />
                        </div>
                    </div>
                ) : scenario.extractorMode === 'inline' ? (
                    <div className="space-y-1.5">
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">提取规则</div>
                        <div className="flex h-10 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            当前内联动作会原样保留
                        </div>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">提取规则</div>
                        <div className="flex h-10 items-center rounded-lg border border-gray-200 px-3 text-sm text-gray-500 dark:border-gray-700">该场景只负责同步和搜索邮件</div>
                    </div>
                )}
            </div>
        </div>
    )
}

function SliderField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
    return (
        <label className="block space-y-2 text-sm">
            <div className="flex items-center justify-between">
                <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
                <span className="font-mono text-xs text-gray-400">{value}</span>
            </div>
            <input type="range" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} className="w-full accent-blue-600" />
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
