'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Loader2, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAuth } from '@/context/auth-context'
import { BusinessLogConfig, BusinessLogModuleConfig, BusinessLogScopeConfig, loggingService } from '@/services/logging.service'
import { BusinessLogModuleConfigPanel, BusinessLogModuleList } from './business-log-module-settings'
import {
    BUSINESS_LOG_GENERAL_KEY,
    boolToSelect,
    clampInt,
    cleanModuleConfig,
    defaultBusinessLogConfig,
    emptyBusinessLogScope,
    resolveBusinessLogModuleEffectiveConfig,
    selectToBool,
    withBusinessLogDefaults,
} from './business-log-settings-common'

export default function BusinessLogOrgSettingsTab() {
    const { currentOrganization, hasPermission } = useAuth()
    const canUpdate = hasPermission('system_config', 'update')
    const orgKey = String(currentOrganization?.id || 1)
    const [config, setConfig] = useState<BusinessLogConfig>(() => defaultBusinessLogConfig())
    const [selectedModule, setSelectedModule] = useState(BUSINESS_LOG_GENERAL_KEY)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const scope = useMemo<BusinessLogScopeConfig>(() => {
        return {
            ...emptyBusinessLogScope(),
            ...(config.organizationConfigs?.[orgKey] || {}),
            moduleLimits: config.organizationConfigs?.[orgKey]?.moduleLimits || {},
            modules: config.organizationConfigs?.[orgKey]?.modules || {},
        }
    }, [config.organizationConfigs, orgKey])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            setConfig(withBusinessLogDefaults(await loggingService.getBusinessLogConfig()))
        } catch (error) {
            console.error(error)
            toast.error('加载业务日志组织配置失败')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const setScope = (nextScope: BusinessLogScopeConfig) => {
        setConfig(prev => ({
            ...prev,
            organizationConfigs: {
                ...(prev.organizationConfigs || {}),
                [orgKey]: nextScope,
            },
        }))
    }

    const patchScope = (patch: BusinessLogScopeConfig) => {
        setScope({
            ...scope,
            ...patch,
            moduleLimits: patch.moduleLimits || scope.moduleLimits || {},
            modules: patch.modules || scope.modules || {},
        })
    }

    const save = async () => {
        if (!canUpdate) return
        setSaving(true)
        try {
            const saved = await loggingService.updateBusinessLogConfig(config)
            setConfig(withBusinessLogDefaults(saved))
            toast.success('业务日志组织配置已保存')
        } catch (error) {
            console.error(error)
            toast.error('保存业务日志组织配置失败')
        } finally {
            setSaving(false)
        }
    }

    const disabled = loading || saving || !canUpdate
    const isGeneralSelected = selectedModule === BUSINESS_LOG_GENERAL_KEY
    const moduleConfig = scope.modules?.[selectedModule] || {}
    const effectiveModuleConfig = resolveBusinessLogModuleEffectiveConfig(config, selectedModule, scope)
    const hasOrgGeneralOverride = scope.enabled !== undefined ||
        scope.redactSensitive !== undefined ||
        scope.forceRecordFailures !== undefined ||
        scope.successSampleRate !== undefined ||
        Boolean(scope.detailLevel) ||
        Boolean(scope.reviewMiddlewareMode) ||
        scope.retentionDays !== undefined ||
        scope.globalLimit !== undefined ||
        Boolean(scope.sensitiveFields?.length)

    const updateScopeBool = (field: 'enabled' | 'redactSensitive' | 'forceRecordFailures', value: string) => {
        const next: BusinessLogScopeConfig = { ...scope }
        const selected = selectToBool(value)
        if (selected === undefined) delete next[field]
        else next[field] = selected
        setScope(next)
    }

    const updateScopeNumber = (field: 'retentionDays' | 'globalLimit', value: number) => {
        const next: BusinessLogScopeConfig = { ...scope }
        const normalized = clampInt(value)
        if (normalized <= 0) delete next[field]
        else next[field] = normalized
        setScope(next)
    }

    const updateScopeSelect = (field: 'detailLevel' | 'reviewMiddlewareMode', value: string) => {
        const next: BusinessLogScopeConfig = { ...scope }
        if (value === 'inherit') delete next[field]
        else next[field] = value
        setScope(next)
    }

    const updateModule = (patch: BusinessLogModuleConfig) => {
        const nextModule = cleanModuleConfig({ ...(scope.modules?.[selectedModule] || {}), ...patch })
        patchScope({
            modules: {
                ...(scope.modules || {}),
                [selectedModule]: nextModule,
            },
        })
    }

    return (
        <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
            <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
                            <Building2 className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                            业务日志组织设置
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{currentOrganization?.name || `组织 ${orgKey}`} · 组织覆盖 · 模块覆盖</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={load} className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">
                            <RefreshCw className="h-4 w-4" />
                            刷新
                        </button>
                        <button onClick={save} disabled={disabled} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            保存
                        </button>
                    </div>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-6">
                {loading ? (
                    <div className="flex h-60 items-center justify-center text-gray-500">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        加载业务日志组织配置...
                    </div>
                ) : (
                    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                        <BusinessLogModuleList
                            title="组织配置项"
                            description="选择左侧配置项后在右侧编辑"
                            selectedModule={selectedModule}
                            moduleConfigs={scope.modules}
                            generalConfigured={hasOrgGeneralOverride}
                            onSelectModule={setSelectedModule}
                        />
                        {isGeneralSelected ? (
                            <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white">通用设置</h3>
                                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                    <SelectField disabled={disabled} label="记录开关" value={boolToSelect(scope.enabled)} effectiveValue={formatEnabled(scope.enabled ?? config.enabled)} onChange={value => updateScopeBool('enabled', value)} options={[['inherit', '继承全局'], ['enabled', '启用'], ['disabled', '停用']]} />
                                    <SelectField disabled={disabled} label="敏感字段脱敏" value={boolToSelect(scope.redactSensitive)} effectiveValue={formatEnabled(scope.redactSensitive ?? config.redactSensitive)} onChange={value => updateScopeBool('redactSensitive', value)} options={[['inherit', '继承全局'], ['enabled', '启用'], ['disabled', '停用']]} />
                                    <SelectField disabled={disabled} label="失败强制记录" value={boolToSelect(scope.forceRecordFailures)} effectiveValue={formatEnabled(scope.forceRecordFailures ?? config.forceRecordFailures)} onChange={value => updateScopeBool('forceRecordFailures', value)} options={[['inherit', '继承全局'], ['enabled', '启用'], ['disabled', '停用']]} />
                                    <SelectField disabled={disabled} label="详情级别" value={scope.detailLevel || 'inherit'} effectiveValue={scope.detailLevel || config.detailLevel || 'summary'} onChange={value => updateScopeSelect('detailLevel', value)} options={[['inherit', '继承全局'], ['summary', 'summary'], ['full', 'full'], ['minimal', 'minimal']]} />
                                    <SelectField disabled={disabled} label="审核中间件" value={scope.reviewMiddlewareMode || 'inherit'} effectiveValue={scope.reviewMiddlewareMode || config.reviewMiddlewareMode || 'disabled'} onChange={value => updateScopeSelect('reviewMiddlewareMode', value)} options={[['inherit', '继承全局'], ['disabled', 'disabled'], ['block_all', 'block_all']]} />
                                    <NumberField disabled={disabled} label="组织保留天数" value={scope.retentionDays || 0} effectiveValue={formatDays(scope.retentionDays ?? config.retentionDays)} onChange={value => updateScopeNumber('retentionDays', value)} />
                                    <NumberField disabled={disabled} label="组织条数上限" value={scope.globalLimit || 0} effectiveValue={formatLimit(scope.globalLimit ?? config.globalLimit)} onChange={value => updateScopeNumber('globalLimit', value)} />
                                </div>
                                {!canUpdate && (
                                    <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                        当前账号没有系统配置更新权限
                                    </div>
                                )}
                            </section>
                        ) : (
                            <BusinessLogModuleConfigPanel
                                disabled={disabled}
                                selectedModule={selectedModule}
                                moduleConfig={moduleConfig}
                                effectiveConfig={effectiveModuleConfig}
                                fallbackSuccessSampleRate={scope.successSampleRate ?? config.successSampleRate ?? 1}
                                onUpdateModule={updateModule}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

function NumberField({ label, value, disabled, effectiveValue, onChange, step = 1, max }: { label: string; value: number; disabled: boolean; effectiveValue?: string; step?: number; max?: number; onChange: (value: number) => void }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
            <Input type="number" min={0} max={max} step={step} disabled={disabled} value={value} onChange={event => onChange(Number(event.target.value))} className="h-9" />
            {effectiveValue && <EffectiveValue value={effectiveValue} />}
        </label>
    )
}

function SelectField({ label, value, disabled, effectiveValue, onChange, options }: { label: string; value: string; disabled: boolean; effectiveValue?: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
            <Select disabled={disabled} value={value} onValueChange={onChange}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                    {options.map(([optionValue, labelText]) => <SelectItem key={optionValue} value={optionValue}>{labelText}</SelectItem>)}
                </SelectContent>
            </Select>
            {effectiveValue && <EffectiveValue value={effectiveValue} />}
        </label>
    )
}

function EffectiveValue({ value }: { value: string }) {
    return <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">当前生效：<span className="font-medium text-gray-700 dark:text-gray-200">{value}</span></div>
}

function formatEnabled(value?: boolean) {
    return value ? '启用' : '停用'
}

function formatLimit(value?: number) {
    return value && value > 0 ? `${value} 条` : '不限制'
}

function formatDays(value?: number) {
    return value && value > 0 ? `${value} 天` : '不限制'
}
