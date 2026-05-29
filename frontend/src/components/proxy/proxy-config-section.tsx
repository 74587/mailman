'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Dice5, Network, RefreshCw, ShieldCheck } from 'lucide-react'
import { proxyPoolService, proxyToUrl } from '@/services/proxy-pool.service'
import {
    ProxyAccountMode,
    ProxyFallbackMode,
    ProxyGroup,
    ProxyPoolItem,
    ProxyTag,
    ProxyTagFilterMode,
    ProxyType,
} from '@/types'
import { cn } from '@/lib/utils'

export interface ProxyConfigValue {
    useProxy: boolean
    proxyMode: ProxyAccountMode
    proxyUrl: string
    proxyUsername: string
    proxyPassword: string
    proxyType: ProxyType
    proxyId?: number
    proxyFallbackMode: ProxyFallbackMode
    proxyFallbackProxyId?: number
    proxyFallbackProxy: string
    proxyMatchGroupIds: number[]
    proxyMatchTagIds: number[]
    proxyMatchTagMode: ProxyTagFilterMode
}

interface ProxyConfigSectionProps {
    value: ProxyConfigValue
    onChange: (value: ProxyConfigValue) => void
    compact?: boolean
}

const modeOptions: Array<{ value: ProxyAccountMode; label: string; desc: string }> = [
    { value: 'manual', label: '手动输入', desc: '直接填写代理 URL，完全兼容旧配置' },
    { value: 'selected', label: '手动选择', desc: '从代理池里绑定一个固定代理' },
    { value: 'auto', label: '自动匹配', desc: '按分组和标签随机选择一个可用代理' },
]

const fallbackOptions: Array<{ value: ProxyFallbackMode; label: string; desc: string }> = [
    { value: 'interrupt', label: '中断请求', desc: '代理不可用时停止验证/取件' },
    { value: 'manual_backup', label: '使用备选代理', desc: '使用指定备用代理或手动备用 URL' },
    { value: 'auto_select', label: '自动换可用代理', desc: '按当前分组/标签重新随机选择' },
]

export function defaultProxyConfigValue(): ProxyConfigValue {
    return {
        useProxy: false,
        proxyMode: 'manual',
        proxyUrl: '',
        proxyUsername: '',
        proxyPassword: '',
        proxyType: 'socks5',
        proxyFallbackMode: 'interrupt',
        proxyFallbackProxy: '',
        proxyMatchGroupIds: [],
        proxyMatchTagIds: [],
        proxyMatchTagMode: 'or',
    }
}

export function ProxyConfigSection({ value, onChange, compact = false }: ProxyConfigSectionProps) {
    const [groups, setGroups] = useState<ProxyGroup[]>([])
    const [tags, setTags] = useState<ProxyTag[]>([])
    const [proxies, setProxies] = useState<ProxyPoolItem[]>([])
    const [loading, setLoading] = useState(false)
    const [previewing, setPreviewing] = useState(false)
    const [previewProxy, setPreviewProxy] = useState<ProxyPoolItem | null>(null)

    const patch = (patchValue: Partial<ProxyConfigValue>) => onChange({ ...value, ...patchValue })

    const loadOptions = async () => {
        setLoading(true)
        try {
            const [groupData, tagData, proxyData] = await Promise.all([
                proxyPoolService.listGroups(),
                proxyPoolService.listTags(),
                proxyPoolService.list({ limit: 200, status: 'available' }),
            ])
            setGroups(groupData)
            setTags(tagData)
            setProxies(proxyData.items)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadOptions()
    }, [])

    const selectedProxy = useMemo(
        () => proxies.find(proxy => proxy.id === value.proxyId),
        [proxies, value.proxyId]
    )

    const selectedFallbackProxy = useMemo(
        () => proxies.find(proxy => proxy.id === value.proxyFallbackProxyId),
        [proxies, value.proxyFallbackProxyId]
    )

    const toggleGroup = (id: number) => {
        const ids = value.proxyMatchGroupIds.includes(id)
            ? value.proxyMatchGroupIds.filter(item => item !== id)
            : [...value.proxyMatchGroupIds, id]
        patch({ proxyMatchGroupIds: ids })
    }

    const toggleTag = (id: number) => {
        const ids = value.proxyMatchTagIds.includes(id)
            ? value.proxyMatchTagIds.filter(item => item !== id)
            : [...value.proxyMatchTagIds, id]
        patch({ proxyMatchTagIds: ids })
    }

    const previewAutoMatch = async () => {
        setPreviewing(true)
        setPreviewProxy(null)
        try {
            const proxy = await proxyPoolService.selectAvailable({
                groupIds: value.proxyMatchGroupIds,
                tagIds: value.proxyMatchTagIds,
                tagMode: value.proxyMatchTagMode,
            })
            setPreviewProxy(proxy)
        } finally {
            setPreviewing(false)
        }
    }

    return (
        <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-900/50">
            <div className="mb-4 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={value.useProxy}
                        onChange={(event) => patch({ useProxy: event.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">使用代理</span>
                </label>
                <button
                    type="button"
                    onClick={loadOptions}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                    <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                    刷新代理池
                </button>
            </div>

            {value.useProxy && (
                <div className="space-y-4">
                    <div className="grid gap-2 md:grid-cols-3">
                        {modeOptions.map(option => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => patch({ proxyMode: option.value })}
                                className={cn(
                                    'rounded-lg border p-3 text-left transition-colors',
                                    value.proxyMode === option.value
                                        ? 'border-primary-500 bg-primary-50 text-primary-900 dark:bg-primary-950/40 dark:text-primary-100'
                                        : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                                )}
                            >
                                <div className="flex items-center gap-2 text-sm font-medium">
                                    <Network className="h-4 w-4" />
                                    {option.label}
                                </div>
                                {!compact && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{option.desc}</p>}
                            </button>
                        ))}
                    </div>

                    {value.proxyMode === 'manual' && (
                        <div className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)]">
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">默认类型</span>
                                <select
                                    value={value.proxyType}
                                    onChange={(event) => patch({ proxyType: event.target.value as ProxyType })}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                >
                                    <option value="http">HTTP</option>
                                    <option value="https">HTTPS</option>
                                    <option value="ssh">SSH</option>
                                    <option value="socks5">Socks5</option>
                                </select>
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">代理地址</span>
                                <input
                                    value={value.proxyUrl}
                                    onChange={(event) => patch({ proxyUrl: event.target.value })}
                                    placeholder="socks5://proxy.example.com:1080"
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">代理账号</span>
                                <input
                                    value={value.proxyUsername}
                                    onChange={(event) => patch({ proxyUsername: event.target.value })}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">代理密码</span>
                                <input
                                    type="password"
                                    value={value.proxyPassword}
                                    onChange={(event) => patch({ proxyPassword: event.target.value })}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                                />
                            </label>
                        </div>
                    )}

                    {value.proxyMode === 'selected' && (
                        <div className="space-y-2">
                            <select
                                value={value.proxyId || ''}
                                onChange={(event) => patch({ proxyId: event.target.value ? Number(event.target.value) : undefined })}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                            >
                                <option value="">选择一个可用代理</option>
                                {proxies.map(proxy => (
                                    <option key={proxy.id} value={proxy.id}>
                                        {proxyToUrl(proxy)} {proxy.group ? `· ${proxy.group.name}` : ''} {proxy.exitIp ? `· ${proxy.exitIp}` : ''}
                                    </option>
                                ))}
                            </select>
                            {selectedProxy && (
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                                    <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
                                    已选择 {proxyToUrl(selectedProxy)}
                                </div>
                            )}
                        </div>
                    )}

                    {value.proxyMode === 'auto' && (
                        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                            <ProxyCriteriaPicker
                                groups={groups}
                                tags={tags}
                                selectedGroupIds={value.proxyMatchGroupIds}
                                selectedTagIds={value.proxyMatchTagIds}
                                tagMode={value.proxyMatchTagMode}
                                onToggleGroup={toggleGroup}
                                onToggleTag={toggleTag}
                                onTagModeChange={(proxyMatchTagMode) => patch({ proxyMatchTagMode })}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={previewAutoMatch}
                                    disabled={previewing}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-gray-900"
                                >
                                    <Dice5 className={cn('h-3.5 w-3.5', previewing && 'animate-spin')} />
                                    试匹配一个
                                </button>
                                {previewProxy && (
                                    <span className="text-xs text-gray-600 dark:text-gray-300">
                                        将匹配到：{proxyToUrl(previewProxy)}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
                            <AlertTriangle className="h-4 w-4" />
                            代理不可用时
                        </div>
                        <div className="grid gap-2 md:grid-cols-3">
                            {fallbackOptions.map(option => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => patch({ proxyFallbackMode: option.value })}
                                    className={cn(
                                        'rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                                        value.proxyFallbackMode === option.value
                                            ? 'border-amber-500 bg-white text-amber-900 shadow-sm dark:bg-amber-900/30 dark:text-amber-100'
                                            : 'border-amber-200 bg-transparent text-amber-700 hover:bg-white/70 dark:border-amber-900/50 dark:text-amber-300'
                                    )}
                                >
                                    <div className="font-medium">{option.label}</div>
                                    {!compact && <div className="mt-0.5 opacity-80">{option.desc}</div>}
                                </button>
                            ))}
                        </div>
                        {value.proxyFallbackMode === 'manual_backup' && (
                            <div className="grid gap-2 md:grid-cols-2">
                                <select
                                    value={value.proxyFallbackProxyId || ''}
                                    onChange={(event) => patch({ proxyFallbackProxyId: event.target.value ? Number(event.target.value) : undefined })}
                                    className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm dark:border-amber-900/60 dark:bg-gray-900"
                                >
                                    <option value="">从代理池选择备用代理</option>
                                    {proxies.map(proxy => (
                                        <option key={proxy.id} value={proxy.id}>{proxyToUrl(proxy)}</option>
                                    ))}
                                </select>
                                <input
                                    value={value.proxyFallbackProxy}
                                    onChange={(event) => patch({ proxyFallbackProxy: event.target.value })}
                                    placeholder="或填写手动备用代理 URL"
                                    className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm dark:border-amber-900/60 dark:bg-gray-900"
                                />
                                {selectedFallbackProxy && (
                                    <span className="text-xs text-amber-700 dark:text-amber-300">备用代理：{proxyToUrl(selectedFallbackProxy)}</span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

interface ProxyCriteriaPickerProps {
    groups: ProxyGroup[]
    tags: ProxyTag[]
    selectedGroupIds: number[]
    selectedTagIds: number[]
    tagMode: ProxyTagFilterMode
    onToggleGroup: (id: number) => void
    onToggleTag: (id: number) => void
    onTagModeChange: (mode: ProxyTagFilterMode) => void
}

function ProxyCriteriaPicker({
    groups,
    tags,
    selectedGroupIds,
    selectedTagIds,
    tagMode,
    onToggleGroup,
    onToggleTag,
    onTagModeChange,
}: ProxyCriteriaPickerProps) {
    return (
        <div className="space-y-3">
            <div>
                <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">分组（默认 OR）</div>
                <div className="flex flex-wrap gap-2">
                    {groups.length === 0 && <span className="text-xs text-gray-400">暂无分组</span>}
                    {groups.map(group => (
                        <button
                            key={group.id}
                            type="button"
                            onClick={() => onToggleGroup(group.id)}
                            className={cn(
                                'rounded-full border px-3 py-1 text-xs transition-colors',
                                selectedGroupIds.includes(group.id)
                                    ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-200'
                                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300'
                            )}
                        >
                            {group.name}
                        </button>
                    ))}
                </div>
            </div>
            <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">标签</span>
                    <div className="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                        {(['or', 'and'] as ProxyTagFilterMode[]).map(mode => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => onTagModeChange(mode)}
                                className={cn(
                                    'rounded-md px-2 py-1 text-[11px]',
                                    tagMode === mode ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500'
                                )}
                            >
                                {mode === 'or' ? '任一标签' : '全部标签'}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {tags.length === 0 && <span className="text-xs text-gray-400">暂无标签</span>}
                    {tags.map(tag => (
                        <button
                            key={tag.id}
                            type="button"
                            onClick={() => onToggleTag(tag.id)}
                            className={cn(
                                'rounded-full border px-3 py-1 text-xs transition-colors',
                                selectedTagIds.includes(tag.id)
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200'
                                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300'
                            )}
                        >
                            {tag.name}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
