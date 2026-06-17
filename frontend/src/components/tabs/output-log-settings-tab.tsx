'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Save, ScrollText, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/context/auth-context'
import { OutputLogConfig, loggingService } from '@/services/logging.service'

function defaultConfig(): OutputLogConfig {
    return {
        enabled: true,
        bufferLimit: 5000,
        queryLimitMax: 2000,
        streamBackfillLimit: 200,
        subscriberBuffer: 256,
        maxSubscribers: 100,
    }
}

function clampInt(value: number) {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.round(value))
}

export default function OutputLogSettingsTab() {
    const { hasPermission } = useAuth()
    const canUpdate = hasPermission('system_config', 'update')
    const [config, setConfig] = useState<OutputLogConfig>(() => defaultConfig())
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const next = await loggingService.getOutputLogConfig()
            setConfig({ ...defaultConfig(), ...next })
        } catch (error) {
            console.error(error)
            toast.error('加载实时日志配置失败')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const save = async () => {
        if (!canUpdate) return
        setSaving(true)
        try {
            const saved = await loggingService.updateOutputLogConfig({
                ...config,
                bufferLimit: clampInt(config.bufferLimit),
                queryLimitMax: clampInt(config.queryLimitMax),
                streamBackfillLimit: clampInt(config.streamBackfillLimit),
                subscriberBuffer: clampInt(config.subscriberBuffer),
                maxSubscribers: clampInt(config.maxSubscribers),
            })
            setConfig({ ...defaultConfig(), ...saved })
            toast.success('实时日志配置已保存')
        } catch (error) {
            console.error(error)
            toast.error('保存实时日志配置失败')
        } finally {
            setSaving(false)
        }
    }

    const disabled = loading || saving || !canUpdate

    return (
        <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
            <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
                            <ScrollText className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                            实时日志设置
                        </h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">内存环形缓冲 · 查询上限 · SSE 订阅保护</p>
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
                        加载实时日志配置...
                    </div>
                ) : (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                        <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                            <div className="flex items-center justify-between gap-4 border-b border-gray-100 pb-4 dark:border-gray-800">
                                <div>
                                    <h3 className="text-base font-semibold text-gray-900 dark:text-white">内存与查询策略</h3>
                                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">配置保存后立即作用于当前进程</p>
                                </div>
                                <Switch disabled={disabled} checked={config.enabled} onCheckedChange={checked => setConfig(prev => ({ ...prev, enabled: checked }))} />
                            </div>
                            <div className="mt-5 grid gap-4 lg:grid-cols-2">
                                <NumberField disabled={disabled} label="内存保留条数" value={config.bufferLimit} onChange={value => setConfig(prev => ({ ...prev, bufferLimit: value }))} />
                                <NumberField disabled={disabled} label="单次查询上限" value={config.queryLimitMax} onChange={value => setConfig(prev => ({ ...prev, queryLimitMax: value }))} />
                                <NumberField disabled={disabled} label="流式回补条数" value={config.streamBackfillLimit} onChange={value => setConfig(prev => ({ ...prev, streamBackfillLimit: value }))} />
                                <NumberField disabled={disabled} label="订阅通道缓冲" value={config.subscriberBuffer} onChange={value => setConfig(prev => ({ ...prev, subscriberBuffer: value }))} />
                                <NumberField disabled={disabled} label="最大订阅数" value={config.maxSubscribers} onChange={value => setConfig(prev => ({ ...prev, maxSubscribers: value }))} />
                            </div>
                        </section>

                        <aside className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                            <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                                <ShieldAlert className="h-4 w-4 text-amber-500" />
                                运行保护
                            </h3>
                            <div className="mt-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                                <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-800/70">
                                    当前日志保存在后端进程内存中，按保留条数裁剪。
                                </div>
                                <div className="rounded-md bg-gray-50 p-3 dark:bg-gray-800/70">
                                    SSE 断开时会清理订阅，单个订阅通道有固定缓冲。
                                </div>
                                {!canUpdate && (
                                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                        当前账号没有系统配置更新权限
                                    </div>
                                )}
                            </div>
                        </aside>
                    </div>
                )}
            </div>
        </div>
    )
}

function NumberField({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</span>
            <Input
                type="number"
                min={0}
                disabled={disabled}
                value={value}
                onChange={event => onChange(clampInt(Number(event.target.value)))}
                className="h-9"
            />
        </label>
    )
}
