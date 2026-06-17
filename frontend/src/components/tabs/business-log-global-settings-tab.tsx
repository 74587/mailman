'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Save, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/context/auth-context'
import { BusinessLogConfig, BusinessLogModuleConfig, loggingService } from '@/services/logging.service'
import { BusinessLogModuleConfigPanel, BusinessLogModuleList } from './business-log-module-settings'
import {
    BUSINESS_LOG_GENERAL_KEY,
    clampInt,
    clampRate,
    cleanModuleConfig,
    defaultBusinessLogConfig,
    resolveBusinessLogModuleEffectiveConfig,
    withBusinessLogDefaults,
} from './business-log-settings-common'

export default function BusinessLogGlobalSettingsTab() {
    const { isSuperAdmin } = useAuth()
    const [config, setConfig] = useState<BusinessLogConfig>(() => defaultBusinessLogConfig())
    const [selectedModule, setSelectedModule] = useState(BUSINESS_LOG_GENERAL_KEY)
    const [sensitiveFieldsText, setSensitiveFieldsText] = useState(defaultBusinessLogConfig().sensitiveFields.join('\n'))
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const next = withBusinessLogDefaults(await loggingService.getBusinessLogConfig())
            setConfig(next)
            setSensitiveFieldsText((next.sensitiveFields || []).join('\n'))
        } catch (error) {
            console.error(error)
            toast.error('加载业务日志全局配置失败')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const save = async () => {
        if (!isSuperAdmin) return
        setSaving(true)
        try {
            const saved = await loggingService.updateBusinessLogConfig({
                ...config,
                successSampleRate: clampRate(config.successSampleRate),
                retentionDays: clampInt(config.retentionDays),
                globalLimit: clampInt(config.globalLimit),
                sensitiveFields: sensitiveFieldsText.split('\n').map(item => item.trim()).filter(Boolean),
            })
            const normalized = withBusinessLogDefaults(saved)
            setConfig(normalized)
            setSensitiveFieldsText((normalized.sensitiveFields || []).join('\n'))
            toast.success('业务日志全局配置已保存')
        } catch (error) {
            console.error(error)
            toast.error('保存业务日志全局配置失败')
        } finally {
            setSaving(false)
        }
    }

    const disabled = loading || saving || !isSuperAdmin
    const isGeneralSelected = selectedModule === BUSINESS_LOG_GENERAL_KEY
    const moduleConfig = config.modules?.[selectedModule] || {}
    const effectiveModuleConfig = resolveBusinessLogModuleEffectiveConfig(config, selectedModule)

    const updateModule = (patch: BusinessLogModuleConfig) => {
        setConfig(prev => {
            const nextModule = cleanModuleConfig({ ...(prev.modules?.[selectedModule] || {}), ...patch })
            return {
                ...prev,
                modules: {
                    ...(prev.modules || {}),
                    [selectedModule]: nextModule,
                },
            }
        })
    }

    return (
        <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
            <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
                            <ShieldCheck className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                            业务日志全局设置
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">全局默认策略 · 全局模块默认 · 敏感字段</p>
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
                        加载业务日志全局配置...
                    </div>
                ) : (
                    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                        <BusinessLogModuleList
                            title="全局配置项"
                            description="选择左侧配置项后在右侧编辑"
                            selectedModule={selectedModule}
                            moduleConfigs={config.modules}
                            generalConfigured
                            onSelectModule={setSelectedModule}
                        />
                        {isGeneralSelected ? (
                            <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                                <div className="flex items-center justify-between gap-4 border-b border-gray-100 pb-4 dark:border-gray-800">
                                    <div>
                                        <h3 className="text-base font-semibold text-gray-900 dark:text-white">通用设置</h3>
                                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">组织覆盖为空时使用这里的默认值</p>
                                    </div>
                                    <Switch disabled={disabled} checked={config.enabled} onCheckedChange={checked => setConfig(prev => ({ ...prev, enabled: checked }))} />
                                </div>

                                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                                    <ToggleField disabled={disabled} label="敏感字段脱敏" checked={config.redactSensitive} onChange={checked => setConfig(prev => ({ ...prev, redactSensitive: checked }))} />
                                    <ToggleField disabled={disabled} label="失败强制记录" checked={config.forceRecordFailures} onChange={checked => setConfig(prev => ({ ...prev, forceRecordFailures: checked }))} />
                                    <SelectField disabled={disabled} label="详情级别" value={config.detailLevel || 'summary'} onChange={value => setConfig(prev => ({ ...prev, detailLevel: value }))} options={[['summary', 'summary'], ['full', 'full'], ['minimal', 'minimal']]} />
                                    <SelectField disabled={disabled} label="审核中间件" value={config.reviewMiddlewareMode || 'disabled'} onChange={value => setConfig(prev => ({ ...prev, reviewMiddlewareMode: value }))} options={[['disabled', 'disabled'], ['block_all', 'block_all']]} />
                                    <NumberField disabled={disabled} label="成功采样率" value={config.successSampleRate} step={0.1} max={1} onChange={value => setConfig(prev => ({ ...prev, successSampleRate: clampRate(value) }))} />
                                    <NumberField disabled={disabled} label="保留天数" value={config.retentionDays} onChange={value => setConfig(prev => ({ ...prev, retentionDays: clampInt(value) }))} />
                                    <NumberField disabled={disabled} label="全局条数上限" value={config.globalLimit} onChange={value => setConfig(prev => ({ ...prev, globalLimit: clampInt(value) }))} />
                                </div>

                                <div className="mt-5">
                                    <label className="block">
                                        <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">敏感字段</span>
                                        <Textarea disabled={disabled} value={sensitiveFieldsText} onChange={event => setSensitiveFieldsText(event.target.value)} className="min-h-[150px] font-mono text-xs" />
                                    </label>
                                </div>

                                {!isSuperAdmin && (
                                    <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                        <ShieldAlert className="mr-2 inline h-4 w-4" />
                                        只有超级管理员可以修改全局业务日志配置
                                    </div>
                                )}
                            </section>
                        ) : (
                            <BusinessLogModuleConfigPanel
                                disabled={disabled}
                                selectedModule={selectedModule}
                                moduleConfig={moduleConfig}
                                effectiveConfig={effectiveModuleConfig}
                                fallbackSuccessSampleRate={config.successSampleRate}
                                onUpdateModule={updateModule}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

function ToggleField({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-10 items-center justify-between gap-3 rounded-md border border-gray-200 px-3 dark:border-gray-800">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
            <Switch disabled={disabled} checked={checked} onCheckedChange={onChange} />
        </div>
    )
}

function NumberField({ label, value, disabled, onChange, step = 1, max }: { label: string; value: number; disabled: boolean; step?: number; max?: number; onChange: (value: number) => void }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
            <Input type="number" min={0} max={max} step={step} disabled={disabled} value={value} onChange={event => onChange(Number(event.target.value))} className="h-9" />
        </label>
    )
}

function SelectField({ label, value, disabled, onChange, options }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; options: Array<[string, string]> }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
            <Select disabled={disabled} value={value} onValueChange={onChange}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                    {options.map(([optionValue, labelText]) => <SelectItem key={optionValue} value={optionValue}>{labelText}</SelectItem>)}
                </SelectContent>
            </Select>
        </label>
    )
}
