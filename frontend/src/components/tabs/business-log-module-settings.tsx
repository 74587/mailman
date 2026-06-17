'use client'

import { Layers3, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { BusinessLogModuleConfig } from '@/services/logging.service'
import {
    BUSINESS_LOG_GENERAL_KEY,
    BUSINESS_LOG_MODULES,
    BusinessLogModuleEffectiveConfig,
    boolToSelect,
    clampInt,
    clampRate,
    getBusinessLogModuleMeta,
    joinCsv,
    parseCsv,
    selectToBool,
} from './business-log-settings-common'

interface ModuleListProps {
    title: string
    description: string
    selectedModule: string
    moduleConfigs?: Record<string, BusinessLogModuleConfig>
    generalConfigured?: boolean
    onSelectModule: (module: string) => void
}

interface ModuleConfigPanelProps {
    disabled: boolean
    selectedModule: string
    moduleConfig: BusinessLogModuleConfig
    effectiveConfig: BusinessLogModuleEffectiveConfig
    fallbackSuccessSampleRate: number
    onUpdateModule: (patch: BusinessLogModuleConfig) => void
}

export function BusinessLogModuleList({ title, description, selectedModule, moduleConfigs, generalConfigured = false, onSelectModule }: ModuleListProps) {
    return (
        <aside className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4">
                <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                    <Layers3 className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                    {title}
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
            </div>
            <div className="space-y-2">
                <button
                    type="button"
                    onClick={() => onSelectModule(BUSINESS_LOG_GENERAL_KEY)}
                    className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                        selectedModule === BUSINESS_LOG_GENERAL_KEY
                            ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-700 dark:bg-primary-950/30 dark:text-primary-100'
                            : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800',
                    )}
                >
                    <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">通用设置</span>
                        <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">记录策略、保留策略和默认审计行为</span>
                    </span>
                    <span className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium',
                        generalConfigured ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
                    )}>
                        {generalConfigured ? '已配置' : '默认'}
                    </span>
                </button>

                <div className="my-3 border-t border-gray-100 dark:border-gray-800" />

                {BUSINESS_LOG_MODULES.map(module => {
                    const meta = getBusinessLogModuleMeta(module)
                    const config = moduleConfigs?.[module] || {}
                    const hasOverride = Object.keys(config).some(key => (config as Record<string, unknown>)[key] !== undefined)
                    const mergeEnabled = config.mergeEnabled === true
                    return (
                        <button
                            key={module}
                            type="button"
                            onClick={() => onSelectModule(module)}
                            className={cn(
                                'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                                selectedModule === module
                                    ? 'border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-700 dark:bg-primary-950/30 dark:text-primary-100'
                                    : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800',
                            )}
                        >
                            <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">{meta.name}</span>
                                <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">{meta.description}</span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                                <span className={cn(
                                    'rounded px-1.5 py-0.5 text-[11px] font-medium',
                                    hasOverride ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
                                )}>
                                    {hasOverride ? '已配置' : '默认'}
                                </span>
                                {module === 'sync' && mergeEnabled && (
                                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">合并</span>
                                )}
                            </span>
                        </button>
                    )
                })}
            </div>
        </aside>
    )
}

export function BusinessLogModuleConfigPanel({ disabled, selectedModule, moduleConfig, effectiveConfig, fallbackSuccessSampleRate, onUpdateModule }: ModuleConfigPanelProps) {
    const meta = getBusinessLogModuleMeta(selectedModule)
    const updateEnabled = (value: string) => {
        onUpdateModule({ enabled: selectToBool(value) })
    }
    const updateRedact = (value: string) => {
        onUpdateModule({ redactSensitive: selectToBool(value) })
    }
    const updateMerge = (value: string) => {
        onUpdateModule({ mergeEnabled: selectToBool(value) })
    }

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 dark:border-gray-800 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                        <SlidersHorizontal className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                        {meta.name}配置
                    </h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{meta.description}</p>
                </div>
                <span className="w-fit rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{selectedModule}</span>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <SelectField disabled={disabled} label="模块开关" value={boolToSelect(moduleConfig.enabled)} effectiveValue={formatEnabled(effectiveConfig.enabled)} onChange={updateEnabled} options={[['inherit', '继承'], ['enabled', '启用'], ['disabled', '停用']]} />
                <SelectField disabled={disabled} label="模块脱敏" value={boolToSelect(moduleConfig.redactSensitive)} effectiveValue={formatEnabled(effectiveConfig.redactSensitive)} onChange={updateRedact} options={[['inherit', '继承'], ['enabled', '启用'], ['disabled', '停用']]} />
                <SelectField disabled={disabled} label="详情级别" value={moduleConfig.detailLevel || 'inherit'} effectiveValue={effectiveConfig.detailLevel} onChange={value => onUpdateModule({ detailLevel: value === 'inherit' ? '' : value })} options={[['inherit', '继承'], ['summary', 'summary'], ['full', 'full'], ['minimal', 'minimal']]} />
                <NumberField disabled={disabled} label="模块条数上限" value={moduleConfig.limit || 0} effectiveValue={formatLimit(effectiveConfig.limit)} onChange={value => onUpdateModule({ limit: clampInt(value) })} />
                <NumberField disabled={disabled} label="成功采样率" value={moduleConfig.successSampleRate ?? fallbackSuccessSampleRate} effectiveValue={formatRate(effectiveConfig.successSampleRate)} step={0.1} max={1} onChange={value => onUpdateModule({ successSampleRate: clampRate(value) })} />
                <TextField disabled={disabled} label="只记录动作" value={joinCsv(moduleConfig.recordActions)} effectiveValue={formatActionList(effectiveConfig.recordActions, '全部动作')} onChange={value => onUpdateModule({ recordActions: parseCsv(value) })} />
                <TextField disabled={disabled} label="忽略动作" value={joinCsv(moduleConfig.ignoreActions)} effectiveValue={formatActionList(effectiveConfig.ignoreActions, '无')} onChange={value => onUpdateModule({ ignoreActions: parseCsv(value) })} />
            </div>

            {selectedModule === 'sync' && (
                <div className="mt-5 rounded-md border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
                    <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100">同步日志合并</h4>
                    <div className="mt-3 grid gap-4 lg:grid-cols-2">
                        <SelectField disabled={disabled} label="连续日志合并" value={boolToSelect(moduleConfig.mergeEnabled)} effectiveValue={formatEnabled(effectiveConfig.mergeEnabled)} onChange={updateMerge} options={[['inherit', '继承'], ['enabled', '启用'], ['disabled', '停用']]} />
                        <NumberField disabled={disabled} label="合并窗口秒数" value={moduleConfig.mergeWindowSeconds || 0} effectiveValue={`${effectiveConfig.mergeWindowSeconds} 秒`} onChange={value => onUpdateModule({ mergeWindowSeconds: clampInt(value) })} />
                    </div>
                    <p className="mt-2 text-xs text-blue-700 dark:text-blue-300">0 表示使用默认 60 秒；组织配置留空时继承全局模块配置。</p>
                </div>
            )}
        </section>
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

function TextField({ label, value, disabled, effectiveValue, onChange }: { label: string; value: string; disabled: boolean; effectiveValue?: string; onChange: (value: string) => void }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
            <Input disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className="h-9" />
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

function formatEnabled(value: boolean) {
    return value ? '启用' : '停用'
}

function formatLimit(value: number) {
    return value > 0 ? `${value} 条` : '不限制'
}

function formatRate(value: number) {
    return `${Math.round(value * 100)}%`
}

function formatActionList(value: string[], fallback: string) {
    return value.length ? value.join(', ') : fallback
}
