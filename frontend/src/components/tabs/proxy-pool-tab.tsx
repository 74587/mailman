'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    AlertTriangle,
    CheckCircle2,
    Filter,
    Loader2,
    Network,
    Plus,
    RefreshCw,
    Search,
    ShieldCheck,
    Tags,
    Trash2,
    XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
    BulkDeleteProxyPayload,
    proxyPoolService,
    ProxyCheckChannel,
    ProxyCheckResult,
    proxyToUrl,
} from '@/services/proxy-pool.service'
import { ProxyGroup, ProxyPoolItem, ProxyStatus, ProxyTag, ProxyTagFilterMode, ProxyType } from '@/types'
import { registerRefreshCallback, unregisterRefreshCallback } from '@/lib/tab-utils'

const statusConfig: Record<ProxyStatus, { label: string; className: string; icon: any }> = {
    available: { label: '可用', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900', icon: CheckCircle2 },
    unavailable: { label: '不可用', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900', icon: XCircle },
    checking: { label: '检测中', className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900', icon: Loader2 },
    unknown: { label: '未知', className: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700', icon: AlertTriangle },
}

const proxyTypes: ProxyType[] = ['http', 'https', 'ssh', 'socks5']

export default function ProxyPoolTab() {
    const [proxies, setProxies] = useState<ProxyPoolItem[]>([])
    const [groups, setGroups] = useState<ProxyGroup[]>([])
    const [tags, setTags] = useState<ProxyTag[]>([])
    const [channels, setChannels] = useState<ProxyCheckChannel[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedIds, setSelectedIds] = useState<number[]>([])
    const [activePanel, setActivePanel] = useState<'list' | 'import' | 'meta' | 'delete'>('list')
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<ProxyStatus | ''>('')
    const [type, setType] = useState<ProxyType | ''>('')
    const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([])
    const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
    const [tagMode, setTagMode] = useState<ProxyTagFilterMode>('or')
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [bulkText, setBulkText] = useState('')
    const [bulkDefaultType, setBulkDefaultType] = useState<ProxyType>('socks5')
    const [bulkGroupId, setBulkGroupId] = useState<number | undefined>()
    const [bulkTagIds, setBulkTagIds] = useState<number[]>([])
    const [bulkCheck, setBulkCheck] = useState(false)
    const [checkChannel, setCheckChannel] = useState('ip-api')
    const [checkResults, setCheckResults] = useState<ProxyCheckResult[]>([])
    const [newGroupName, setNewGroupName] = useState('')
    const [newTagName, setNewTagName] = useState('')
    const [deleteReplacement, setDeleteReplacement] = useState<BulkDeleteProxyPayload['replacement']>({ mode: 'clear' })

    const limit = 30

    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            const [proxyData, groupData, tagData, channelData] = await Promise.all([
                proxyPoolService.list({
                    page,
                    limit,
                    search,
                    status,
                    type,
                    groupIds: selectedGroupIds,
                    tagIds: selectedTagIds,
                    tagMode,
                }),
                proxyPoolService.listGroups(),
                proxyPoolService.listTags(),
                proxyPoolService.getCheckChannels(),
            ])
            setProxies(proxyData.items)
            setTotal(proxyData.total)
            setGroups(groupData)
            setTags(tagData)
            setChannels(channelData)
        } catch (error: any) {
            toast.error(error.message || '加载代理池失败')
        } finally {
            setLoading(false)
        }
    }, [page, search, status, type, selectedGroupIds, selectedTagIds, tagMode])

    useEffect(() => {
        loadData()
    }, [loadData])

    useEffect(() => {
        registerRefreshCallback('proxy-pool', loadData)
        return () => unregisterRefreshCallback('proxy-pool')
    }, [loadData])

    const totalPages = Math.max(1, Math.ceil(total / limit))
    const selectedProxies = useMemo(() => proxies.filter(proxy => selectedIds.includes(proxy.id)), [proxies, selectedIds])

    const runSearch = () => {
        setPage(1)
        setTimeout(loadData, 0)
    }

    const toggleSelected = (id: number) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
    }

    const toggleAllVisible = () => {
        const visibleIds = proxies.map(proxy => proxy.id)
        const allSelected = visibleIds.every(id => selectedIds.includes(id))
        setSelectedIds(allSelected ? selectedIds.filter(id => !visibleIds.includes(id)) : Array.from(new Set([...selectedIds, ...visibleIds])))
    }

    const importProxies = async () => {
        if (!bulkText.trim()) {
            toast.error('请先填写代理信息')
            return
        }
        setLoading(true)
        try {
            const result = await proxyPoolService.bulkImport({
                defaultType: bulkDefaultType,
                groupId: bulkGroupId,
                tagIds: bulkTagIds,
                checkProxy: bulkCheck,
                channel: checkChannel,
                content: bulkText,
            })
            setCheckResults(result.checks || [])
            toast.success(`已添加 ${result.created.length} 个代理${result.errors.length ? `，${result.errors.length} 行失败` : ''}`)
            setBulkText('')
            setActivePanel('list')
            loadData()
        } catch (error: any) {
            toast.error(error.message || '批量添加失败')
        } finally {
            setLoading(false)
        }
    }

    const testProxy = async (proxy: ProxyPoolItem) => {
        setProxies(prev => prev.map(item => item.id === proxy.id ? { ...item, status: 'checking' } : item))
        try {
            const result = await proxyPoolService.test(proxy.id, checkChannel)
            setCheckResults(prev => [result, ...prev].slice(0, 30))
            toast[result.success ? 'success' : 'error'](`${proxy.host}:${proxy.port} ${result.success ? '可用' : '不可用'}`)
        } catch (error: any) {
            toast.error(error.message || '代理检测失败')
        } finally {
            loadData()
        }
    }

    const batchTest = async () => {
        setLoading(true)
        try {
            const result = await proxyPoolService.batchTest({
                ids: selectedIds.length ? selectedIds : undefined,
                filter: selectedIds.length ? undefined : {
                    search,
                    status,
                    type,
                    groupIds: selectedGroupIds,
                    tagIds: selectedTagIds,
                    tagMode,
                },
                channel: checkChannel,
                timeoutSeconds: 12,
            })
            setCheckResults(result.results)
            toast.success(`已检测 ${result.total} 个代理`)
            loadData()
        } catch (error: any) {
            toast.error(error.message || '批量检测失败')
        } finally {
            setLoading(false)
        }
    }

    const batchDelete = async () => {
        setLoading(true)
        try {
            const payload: BulkDeleteProxyPayload = {
                ids: selectedIds.length ? selectedIds : undefined,
                filter: selectedIds.length ? undefined : {
                    search,
                    status,
                    type,
                    groupIds: selectedGroupIds,
                    tagIds: selectedTagIds,
                    tagMode,
                    limit: 5000,
                },
                replacement: deleteReplacement,
            }
            const result = await proxyPoolService.batchDelete(payload)
            toast.success(`已删除 ${result.deleted} 个代理，影响 ${result.affectedAccounts} 个账户`)
            setSelectedIds([])
            setActivePanel('list')
            loadData()
        } catch (error: any) {
            toast.error(error.message || '批量删除失败')
        } finally {
            setLoading(false)
        }
    }

    const createGroup = async (name?: string) => {
        const groupName = (name ?? newGroupName).trim()
        if (!groupName) return null
        try {
            const group = await proxyPoolService.createGroup({ name: groupName })
            if (!name || newGroupName.trim() === groupName) {
                setNewGroupName('')
            }
            toast.success('分组已创建')
            await loadData()
            return group
        } catch (error: any) {
            toast.error(error.message || '创建分组失败')
            return null
        }
    }

    const createTag = async (name?: string) => {
        const tagName = (name ?? newTagName).trim()
        if (!tagName) return null
        try {
            const tag = await proxyPoolService.createTag({ name: tagName })
            if (!name || newTagName.trim() === tagName) {
                setNewTagName('')
            }
            toast.success('标签已创建')
            await loadData()
            return tag
        } catch (error: any) {
            toast.error(error.message || '创建标签失败')
            return null
        }
    }

    const deleteGroup = async (group: ProxyGroup) => {
        if (!window.confirm(`删除分组「${group.name}」？该分组下的代理会变为未分组。`)) return
        try {
            await proxyPoolService.deleteGroup(group.id)
            setSelectedGroupIds(prev => prev.filter(id => id !== group.id))
            setBulkGroupId(prev => prev === group.id ? undefined : prev)
            setDeleteReplacement(prev => ({ ...prev, groupIds: prev.groupIds?.filter(id => id !== group.id) }))
            toast.success('分组已删除')
            await loadData()
        } catch (error: any) {
            toast.error(error.message || '删除分组失败')
        }
    }

    const deleteTag = async (tag: ProxyTag) => {
        if (!window.confirm(`删除标签「${tag.name}」？代理上的该标签会被移除。`)) return
        try {
            await proxyPoolService.deleteTag(tag.id)
            setSelectedTagIds(prev => prev.filter(id => id !== tag.id))
            setBulkTagIds(prev => prev.filter(id => id !== tag.id))
            setDeleteReplacement(prev => ({ ...prev, tagIds: prev.tagIds?.filter(id => id !== tag.id) }))
            toast.success('标签已删除')
            await loadData()
        } catch (error: any) {
            toast.error(error.message || '删除标签失败')
        }
    }

    return (
        <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
            <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-300">
                                <Network className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">代理池管理</h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400">分组、标签、检测状态和账户替换策略</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={checkChannel}
                            onChange={(event) => setCheckChannel(event.target.value)}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                        >
                            {channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                        </select>
                        <button onClick={batchTest} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800">
                            <ShieldCheck className="h-4 w-4" />
                            {selectedIds.length ? `检测已选 ${selectedIds.length}` : '检测筛选结果'}
                        </button>
                        <button onClick={() => setActivePanel('import')} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700">
                            <Plus className="h-4 w-4" />
                            批量新增
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-5 overflow-auto p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="min-w-0 space-y-4">
                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                        <div className="mb-4 flex flex-wrap items-center gap-3">
                            <div className="relative min-w-[260px] flex-1">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    onKeyDown={(event) => event.key === 'Enter' && runSearch()}
                                    placeholder="搜索主机、备注、出口 IP、账号"
                                    className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                                />
                            </div>
                            <select value={status} onChange={(event) => setStatus(event.target.value as ProxyStatus | '')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                                <option value="">全部状态</option>
                                <option value="available">可用</option>
                                <option value="unavailable">不可用</option>
                                <option value="unknown">未知</option>
                                <option value="checking">检测中</option>
                            </select>
                            <select value={type} onChange={(event) => setType(event.target.value as ProxyType | '')} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                                <option value="">全部类型</option>
                                {proxyTypes.map(item => <option key={item} value={item}>{item.toUpperCase()}</option>)}
                            </select>
                            <button onClick={runSearch} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900">
                                <Filter className="h-4 w-4" />
                                筛选
                            </button>
                        </div>

                        <CriteriaBar
                            groups={groups}
                            tags={tags}
                            selectedGroupIds={selectedGroupIds}
                            selectedTagIds={selectedTagIds}
                            tagMode={tagMode}
                            onGroupChange={setSelectedGroupIds}
                            onTagChange={setSelectedTagIds}
                            onTagModeChange={setTagMode}
                        />
                    </div>

                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                <input type="checkbox" checked={proxies.length > 0 && proxies.every(proxy => selectedIds.includes(proxy.id))} onChange={toggleAllVisible} />
                                已选 {selectedIds.length} / 共 {total}
                            </label>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setActivePanel('delete')} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30">
                                    <Trash2 className="h-4 w-4" />
                                    批量删除
                                </button>
                                <button onClick={loadData} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                    <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                                    刷新
                                </button>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1080px] text-left text-sm">
                                <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                                    <tr>
                                        <th className="w-10 px-4 py-3"></th>
                                        <th className="px-4 py-3">代理</th>
                                        <th className="px-4 py-3">状态</th>
                                        <th className="px-4 py-3">分组 / 标签</th>
                                        <th className="px-4 py-3">出口信息</th>
                                        <th className="px-4 py-3">检测</th>
                                        <th className="px-4 py-3">备注</th>
                                        <th className="px-4 py-3 text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {loading && proxies.length === 0 ? (
                                        <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />加载中...</td></tr>
                                    ) : proxies.length === 0 ? (
                                        <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">暂无代理</td></tr>
                                    ) : proxies.map(proxy => (
                                        <ProxyRow
                                            key={proxy.id}
                                            proxy={proxy}
                                            selected={selectedIds.includes(proxy.id)}
                                            onToggle={() => toggleSelected(proxy.id)}
                                            onTest={() => testProxy(proxy)}
                                            onDelete={async () => {
                                                await proxyPoolService.delete(proxy.id)
                                                toast.success('代理已删除')
                                                loadData()
                                            }}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm dark:border-gray-800">
                            <span className="text-gray-500">第 {page} / {totalPages} 页</span>
                            <div className="flex gap-2">
                                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40 dark:border-gray-700">上一页</button>
                                <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 disabled:opacity-40 dark:border-gray-700">下一页</button>
                            </div>
                        </div>
                    </div>
                </div>

                <aside className="space-y-4">
                    {activePanel === 'import' && (
                        <ImportPanel
                            groups={groups}
                            tags={tags}
                            channels={channels}
                            bulkText={bulkText}
                            setBulkText={setBulkText}
                            defaultType={bulkDefaultType}
                            setDefaultType={setBulkDefaultType}
                            groupId={bulkGroupId}
                            setGroupId={setBulkGroupId}
                            tagIds={bulkTagIds}
                            setTagIds={setBulkTagIds}
                            checkProxy={bulkCheck}
                            setCheckProxy={setBulkCheck}
                            channel={checkChannel}
                            setChannel={setCheckChannel}
                            onCreateGroup={createGroup}
                            onCreateTag={createTag}
                            onImport={importProxies}
                            loading={loading}
                        />
                    )}

                    {activePanel === 'delete' && (
                        <DeletePanel
                            selectedCount={selectedIds.length}
                            replacement={deleteReplacement}
                            setReplacement={setDeleteReplacement}
                            proxies={proxies}
                            groups={groups}
                            tags={tags}
                            onDelete={batchDelete}
                            loading={loading}
                        />
                    )}

                    {activePanel === 'meta' && (
                        <MetaPanel
                            groups={groups}
                            tags={tags}
                            newGroupName={newGroupName}
                            setNewGroupName={setNewGroupName}
                            newTagName={newTagName}
                            setNewTagName={setNewTagName}
                            onCreateGroup={createGroup}
                            onCreateTag={createTag}
                            onDeleteGroup={deleteGroup}
                            onDeleteTag={deleteTag}
                        />
                    )}

                    {activePanel === 'list' && (
                        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                            <div className="mb-3 flex items-center justify-between">
                                <h3 className="font-semibold text-gray-900 dark:text-white">快速操作</h3>
                                <Tags className="h-4 w-4 text-gray-400" />
                            </div>
                            <div className="grid gap-2">
                                <button onClick={() => setActivePanel('import')} className="rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">批量新增代理</button>
                                <button onClick={() => setActivePanel('meta')} className="rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">管理分组和标签</button>
                                <button onClick={() => setActivePanel('delete')} className="rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">按筛选条件批量删除</button>
                            </div>
                        </div>
                    )}

                    <CheckResultPanel results={checkResults} />
                </aside>
            </div>
        </div>
    )
}

function ProxyRow({ proxy, selected, onToggle, onTest, onDelete }: {
    proxy: ProxyPoolItem
    selected: boolean
    onToggle: () => void
    onTest: () => void
    onDelete: () => void
}) {
    const config = statusConfig[proxy.status || 'unknown']
    const StatusIcon = config.icon
    return (
        <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <td className="px-4 py-3"><input type="checkbox" checked={selected} onChange={onToggle} /></td>
            <td className="px-4 py-3">
                <div className="font-mono text-xs text-gray-900 dark:text-gray-100">{proxyToUrl(proxy)}</div>
                {proxy.refreshUrl && <div className="mt-1 max-w-[240px] truncate text-xs text-blue-500">{proxy.refreshUrl}</div>}
            </td>
            <td className="px-4 py-3">
                <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', config.className)}>
                    <StatusIcon className={cn('h-3.5 w-3.5', proxy.status === 'checking' && 'animate-spin')} />
                    {config.label}
                </span>
            </td>
            <td className="px-4 py-3">
                <div className="text-xs text-gray-700 dark:text-gray-300">{proxy.group?.name || '未分组'}</div>
                <div className="mt-1 flex max-w-[220px] flex-wrap gap-1">
                    {(proxy.tags || []).map(tag => <span key={tag.id} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">{tag.name}</span>)}
                </div>
            </td>
            <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                <div>{proxy.exitIp || '-'}</div>
                <div className="mt-1 text-gray-400">{[proxy.country, proxy.city, proxy.isp].filter(Boolean).join(' · ')}</div>
            </td>
            <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                <div>{proxy.checkLatencyMs ? `${proxy.checkLatencyMs}ms` : '-'}</div>
                <div className="mt-1 text-gray-400">{proxy.lastCheckAt ? new Date(proxy.lastCheckAt).toLocaleString() : '未检测'}</div>
            </td>
            <td className="max-w-[180px] truncate px-4 py-3 text-xs text-gray-500">{proxy.remark || '-'}</td>
            <td className="px-4 py-3 text-right">
                <div className="inline-flex gap-2">
                    <button onClick={onTest} className="rounded-lg border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">检测</button>
                    <button onClick={onDelete} className="rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30">删除</button>
                </div>
            </td>
        </tr>
    )
}

function CriteriaBar({ groups, tags, selectedGroupIds, selectedTagIds, tagMode, onGroupChange, onTagChange, onTagModeChange }: {
    groups: ProxyGroup[]
    tags: ProxyTag[]
    selectedGroupIds: number[]
    selectedTagIds: number[]
    tagMode: ProxyTagFilterMode
    onGroupChange: (ids: number[]) => void
    onTagChange: (ids: number[]) => void
    onTagModeChange: (mode: ProxyTagFilterMode) => void
}) {
    const toggle = (ids: number[], id: number) => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]
    return (
        <div className="space-y-3">
            <div>
                <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">分组筛选（OR）</div>
                <div className="flex flex-wrap gap-2">
                    {groups.map(group => (
                        <button key={group.id} onClick={() => onGroupChange(toggle(selectedGroupIds, group.id))} className={cn('rounded-full border px-3 py-1 text-xs', selectedGroupIds.includes(group.id) ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/30' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300')}>{group.name}</button>
                    ))}
                </div>
            </div>
            <div>
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">标签筛选</span>
                    <div className="inline-flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                        <button onClick={() => onTagModeChange('or')} className={cn('rounded-md px-2 py-1 text-[11px]', tagMode === 'or' && 'bg-white shadow-sm dark:bg-gray-700')}>任一</button>
                        <button onClick={() => onTagModeChange('and')} className={cn('rounded-md px-2 py-1 text-[11px]', tagMode === 'and' && 'bg-white shadow-sm dark:bg-gray-700')}>全部</button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {tags.map(tag => (
                        <button key={tag.id} onClick={() => onTagChange(toggle(selectedTagIds, tag.id))} className={cn('rounded-full border px-3 py-1 text-xs', selectedTagIds.includes(tag.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300')}>{tag.name}</button>
                    ))}
                </div>
            </div>
        </div>
    )
}

function ImportPanel(props: {
    groups: ProxyGroup[]
    tags: ProxyTag[]
    channels: ProxyCheckChannel[]
    bulkText: string
    setBulkText: (value: string) => void
    defaultType: ProxyType
    setDefaultType: (value: ProxyType) => void
    groupId?: number
    setGroupId: (value?: number) => void
    tagIds: number[]
    setTagIds: (value: number[]) => void
    checkProxy: boolean
    setCheckProxy: (value: boolean) => void
    channel: string
    setChannel: (value: string) => void
    onCreateGroup: (name?: string) => Promise<ProxyGroup | null>
    onCreateTag: (name?: string) => Promise<ProxyTag | null>
    onImport: () => void
    loading: boolean
}) {
    const [quickGroupName, setQuickGroupName] = useState('')
    const [quickTagName, setQuickTagName] = useState('')
    const toggleTag = (id: number) => props.setTagIds(props.tagIds.includes(id) ? props.tagIds.filter(item => item !== id) : [...props.tagIds, id])
    const createAndSelectGroup = async () => {
        const group = await props.onCreateGroup(quickGroupName)
        if (!group) return
        props.setGroupId(group.id)
        setQuickGroupName('')
    }
    const createAndSelectTag = async () => {
        const tag = await props.onCreateTag(quickTagName)
        if (!tag) return
        props.setTagIds([...new Set([...props.tagIds, tag.id])])
        setQuickTagName('')
    }
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">批量新增代理</h3>
            <div className="mb-4 rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                <div>一行一个代理，一次最多添加500个。支持 HTTP、HTTPS、SSH、Socks5；IPv6 主机请写在 [] 内。</div>
                <div className="mt-2 font-mono text-blue-500">
                    192.168.0.1:8000{'{备注}'}<br />
                    192.168.0.1:8000:代理账号:代理密码{'{备注}'}<br />
                    socks5://192.168.0.1:8000[刷新URL]{'{备注}'}<br />
                    http://[2001:db8::e13]:8000[刷新URL]{'{备注}'}<br />
                    socks5://代理账号:代理密码@192.168.0.1:8000[刷新URL]{'{备注}'}
                </div>
            </div>
            <div className="grid gap-3">
                <select value={props.defaultType} onChange={(event) => props.setDefaultType(event.target.value as ProxyType)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                    {proxyTypes.map(type => <option key={type} value={type}>{type.toUpperCase()}</option>)}
                </select>
                <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">导入分组</div>
                    <select value={props.groupId || ''} onChange={(event) => props.setGroupId(event.target.value ? Number(event.target.value) : undefined)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                        <option value="">不分组</option>
                        {props.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <div className="mt-2 flex gap-2">
                        <input
                            value={quickGroupName}
                            onChange={(event) => setQuickGroupName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    createAndSelectGroup()
                                }
                            }}
                            placeholder="创建新分组并选中"
                            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                        />
                        <button onClick={createAndSelectGroup} disabled={!quickGroupName.trim()} className="rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-700 hover:bg-primary-50 disabled:opacity-50 dark:border-primary-900 dark:text-primary-300 dark:hover:bg-primary-950/30">创建</button>
                    </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">导入标签</span>
                        <span className="text-[11px] text-gray-400">可多选</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {props.tags.length === 0 ? <span className="text-xs text-gray-400">暂无标签</span> : props.tags.map(tag => (
                            <button key={tag.id} onClick={() => toggleTag(tag.id)} className={cn('rounded-full border px-2 py-1 text-xs', props.tagIds.includes(tag.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300')}>{tag.name}</button>
                        ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                        <input
                            value={quickTagName}
                            onChange={(event) => setQuickTagName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    createAndSelectTag()
                                }
                            }}
                            placeholder="创建新标签并选中"
                            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                        />
                        <button onClick={createAndSelectTag} disabled={!quickTagName.trim()} className="rounded-lg border border-emerald-200 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/30">创建</button>
                    </div>
                </div>
                <textarea value={props.bulkText} onChange={(event) => props.setBulkText(event.target.value)} rows={12} placeholder="请在此填写您的代理信息" className="min-h-[260px] rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900" />
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <input type="checkbox" checked={props.checkProxy} onChange={(event) => props.setCheckProxy(event.target.checked)} />
                    添加后立即检查代理
                </label>
                {props.checkProxy && (
                    <select value={props.channel} onChange={(event) => props.setChannel(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                        {props.channels.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                    </select>
                )}
                <button onClick={props.onImport} disabled={props.loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60">
                    {props.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    确定添加
                </button>
            </div>
        </div>
    )
}

function DeletePanel({ selectedCount, replacement, setReplacement, proxies, groups, tags, onDelete, loading }: {
    selectedCount: number
    replacement: BulkDeleteProxyPayload['replacement']
    setReplacement: (value: BulkDeleteProxyPayload['replacement']) => void
    proxies: ProxyPoolItem[]
    groups: ProxyGroup[]
    tags: ProxyTag[]
    onDelete: () => void
    loading: boolean
}) {
    const setMode = (mode: BulkDeleteProxyPayload['replacement']['mode']) => setReplacement({ ...replacement, mode })
    const toggleGroup = (id: number) => setReplacement({ ...replacement, groupIds: (replacement.groupIds || []).includes(id) ? (replacement.groupIds || []).filter(item => item !== id) : [...(replacement.groupIds || []), id] })
    const toggleTag = (id: number) => setReplacement({ ...replacement, tagIds: (replacement.tagIds || []).includes(id) ? (replacement.tagIds || []).filter(item => item !== id) : [...(replacement.tagIds || []), id] })
    return (
        <div className="rounded-xl border border-rose-200 bg-white p-4 shadow-sm dark:border-rose-900/50 dark:bg-gray-900">
            <h3 className="mb-2 font-semibold text-gray-900 dark:text-white">批量删除代理</h3>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{selectedCount ? `将删除已选 ${selectedCount} 个代理。` : '未选择代理时，将按当前筛选条件批量删除。'} 删除后可指定已绑定账户的替换方案。</p>
            <div className="grid gap-2">
                {[
                    ['clear', '清空账户代理'],
                    ['proxy', '替换为指定代理'],
                    ['auto', '按条件自动匹配'],
                    ['manual', '替换为手动 URL'],
                ].map(([mode, label]) => (
                    <button key={mode} onClick={() => setMode(mode as any)} className={cn('rounded-lg border px-3 py-2 text-left text-sm', replacement.mode === mode ? 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/30' : 'border-gray-200 dark:border-gray-700')}>{label}</button>
                ))}
                {replacement.mode === 'proxy' && (
                    <select value={replacement.proxyId || ''} onChange={(event) => setReplacement({ ...replacement, proxyId: event.target.value ? Number(event.target.value) : undefined })} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                        <option value="">选择替换代理</option>
                        {proxies.filter(proxy => proxy.status === 'available').map(proxy => <option key={proxy.id} value={proxy.id}>{proxyToUrl(proxy)}</option>)}
                    </select>
                )}
                {replacement.mode === 'manual' && (
                    <input value={replacement.fallbackProxy || ''} onChange={(event) => setReplacement({ ...replacement, fallbackProxy: event.target.value })} placeholder="socks5://host:port" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" />
                )}
                {replacement.mode === 'auto' && (
                    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                        <div className="text-xs text-gray-500">分组</div>
                        <div className="flex flex-wrap gap-2">{groups.map(group => <button key={group.id} onClick={() => toggleGroup(group.id)} className={cn('rounded-full border px-2 py-1 text-xs', replacement.groupIds?.includes(group.id) ? 'border-primary-500 bg-primary-50' : 'border-gray-200 dark:border-gray-700')}>{group.name}</button>)}</div>
                        <div className="text-xs text-gray-500">标签</div>
                        <div className="flex flex-wrap gap-2">{tags.map(tag => <button key={tag.id} onClick={() => toggleTag(tag.id)} className={cn('rounded-full border px-2 py-1 text-xs', replacement.tagIds?.includes(tag.id) ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 dark:border-gray-700')}>{tag.name}</button>)}</div>
                        <select value={replacement.tagMode || 'or'} onChange={(event) => setReplacement({ ...replacement, tagMode: event.target.value as ProxyTagFilterMode })} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                            <option value="or">任一标签</option>
                            <option value="and">全部标签</option>
                        </select>
                    </div>
                )}
                <button onClick={onDelete} disabled={loading} className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    确认删除
                </button>
            </div>
        </div>
    )
}

function MetaPanel({ groups, tags, newGroupName, setNewGroupName, newTagName, setNewTagName, onCreateGroup, onCreateTag, onDeleteGroup, onDeleteTag }: {
    groups: ProxyGroup[]
    tags: ProxyTag[]
    newGroupName: string
    setNewGroupName: (value: string) => void
    newTagName: string
    setNewTagName: (value: string) => void
    onCreateGroup: (name?: string) => Promise<ProxyGroup | null>
    onCreateTag: (name?: string) => Promise<ProxyTag | null>
    onDeleteGroup: (group: ProxyGroup) => void
    onDeleteTag: (tag: ProxyTag) => void
}) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">分组与标签</h3>
            <div className="space-y-4">
                <div>
                    <div className="mb-1 text-sm font-medium">代理分组</div>
                    <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">删除分组不会删除代理，代理会回到未分组状态。</p>
                    <div className="mb-2 flex gap-2">
                        <input
                            value={newGroupName}
                            onChange={(event) => setNewGroupName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    onCreateGroup()
                                }
                            }}
                            placeholder="新分组名称"
                            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                        />
                        <button onClick={() => onCreateGroup()} className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-gray-900">添加</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {groups.length === 0 ? <span className="text-xs text-gray-400">暂无分组</span> : groups.map(group => (
                            <span key={group.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary-50 py-1 pl-3 pr-1 text-xs text-primary-700 dark:bg-primary-950/30 dark:text-primary-200">
                                <span className="truncate">{group.name}</span>
                                <button onClick={() => onDeleteGroup(group)} title="删除分组" className="rounded-full p-1 text-primary-500 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-900/50">
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
                <div>
                    <div className="mb-1 text-sm font-medium">代理标签</div>
                    <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">删除标签会从已绑定代理上移除该标签。</p>
                    <div className="mb-2 flex gap-2">
                        <input
                            value={newTagName}
                            onChange={(event) => setNewTagName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    onCreateTag()
                                }
                            }}
                            placeholder="新标签名称"
                            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                        />
                        <button onClick={() => onCreateTag()} className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-gray-900">添加</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {tags.length === 0 ? <span className="text-xs text-gray-400">暂无标签</span> : tags.map(tag => (
                            <span key={tag.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 py-1 pl-3 pr-1 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                                <span className="truncate">{tag.name}</span>
                                <button onClick={() => onDeleteTag(tag)} title="删除标签" className="rounded-full p-1 text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700 dark:hover:bg-emerald-900/50">
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

function CheckResultPanel({ results }: { results: ProxyCheckResult[] }) {
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">最近检测结果</h3>
            <div className="max-h-[360px] space-y-2 overflow-auto">
                {results.length === 0 ? <div className="text-sm text-gray-400">暂无检测结果</div> : results.map((result, index) => (
                    <div key={`${result.proxyId}-${index}`} className="rounded-lg border border-gray-100 p-3 text-xs dark:border-gray-800">
                        <div className="flex items-center justify-between">
                            <span className={result.success ? 'text-emerald-600' : 'text-rose-600'}>{result.success ? '可用' : '不可用'}</span>
                            <span className="text-gray-400">{result.latencyMs}ms</span>
                        </div>
                        <div className="mt-1 text-gray-600 dark:text-gray-300">#{result.proxyId} {result.exitIp || result.error || '-'}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}
