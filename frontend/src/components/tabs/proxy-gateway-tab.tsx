'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    ArrowLeft,
    Copy,
    FileText,
    GitBranch,
    HelpCircle,
    KeyRound,
    ListFilter,
    Loader2,
    Network,
    Plus,
    RefreshCw,
    Save,
    Search,
    Server,
    ShieldCheck,
    Tags,
    Trash2,
    Users,
    Wand2,
    X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Modal, ModalBody, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { proxyPoolService } from '@/services/proxy-pool.service'
import {
    proxyGatewayService,
    ProxyGatewayAccount,
    ProxyGatewayAccountGroup,
    ProxyGatewayAccountTag,
    ProxyGatewayAccessLog,
    ProxyGatewayAuditLog,
    ProxyGatewayDNSPolicy,
    ProxyGatewayListener,
    ProxyGatewayRouteStrategy,
    ProxyGatewaySecurityPolicy,
    ProxyGatewayStatus,
    ProxyGatewayValidationResult,
    toStringList,
} from '@/services/proxy-gateway.service'
import { ProxyGroup, ProxyPoolItem, ProxyTag } from '@/types'

type ProxyGatewaySection = 'gateways' | 'listeners' | 'accounts' | 'account-groups' | 'account-tags' | 'routes' | 'security' | 'dns' | 'logs' | 'status'
type NormalizedSection = 'gateways' | 'accounts' | 'account-groups' | 'account-tags' | 'logs'
type GatewayDetailSection = 'overview' | 'routes' | 'security' | 'dns' | 'logs'
type AccountStep = 'identity' | 'authorization' | 'routing' | 'proxy' | 'fallback'
type RouteStep = 'basic' | 'proxy' | 'fallback' | 'overrides'
type SecurityStep = 'basic' | 'sources' | 'targets' | 'boundaries'
type StrategySection = 'selection' | 'fallback'

interface ProxyGatewayTabProps {
    section?: ProxyGatewaySection
}

type AccountDraft = Partial<ProxyGatewayAccount> & { password?: string; tagIds?: number[] }
type MetaDraft = { id?: number; type: 'group' | 'tag'; name: string; description?: string; color?: string; sortOrder?: number }
type SearchOption = { id: number; name: string; description?: string; color?: string; meta?: string }

const sectionMeta: Record<NormalizedSection, { title: string; subtitle: string; icon: any }> = {
    gateways: { title: '代理网关', subtitle: '先创建 HTTP / SOCKS5 / Mixed 网关，再在网关下维护路由、安全和 DNS 策略', icon: Network },
    accounts: { title: '网关用户', subtitle: '独立于 Mailman 用户体系，配置账号、可用网关和代理选择策略', icon: KeyRound },
    'account-groups': { title: '账号分组', subtitle: '独立维护网关用户分组，创建账号时只选择已有项', icon: Users },
    'account-tags': { title: '账号标签', subtitle: '独立维护网关用户标签，创建账号时只选择已有项', icon: Tags },
    logs: { title: '网关日志', subtitle: '查看访问日志、策略命中、拒绝原因和配置审计', icon: FileText },
}

function normalizeSection(section: ProxyGatewaySection): NormalizedSection {
    if (section === 'accounts' || section === 'account-groups' || section === 'account-tags' || section === 'logs') return section
    return 'gateways'
}

function asArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : []
}

const defaultListener = (): Partial<ProxyGatewayListener> => ({
    name: 'Mixed Proxy Gateway',
    listenIp: '127.0.0.1',
    externalHost: '',
    externalPort: undefined,
    port: 18080,
    protocol: 'mixed',
    enabled: false,
    isDefault: false,
    allowPublicListen: false,
    requireAuth: true,
    handshakeTimeoutSeconds: 10,
    idleTimeoutSeconds: 120,
    connectTimeoutSeconds: 30,
})

const defaultAccount = (defaultGatewayId?: number): AccountDraft => ({
    username: '',
    password: '',
    name: '',
    remark: '',
    enabled: true,
    allowAllGateways: false,
    allowedGatewayIds: defaultGatewayId ? [defaultGatewayId] : [],
    selectionMode: 'filtered',
    selectionAlgorithm: 'random',
    proxyMatchTagMode: 'or',
    stickyMode: 'none',
    stickyTtlSeconds: 600,
    preferLastSuccess: false,
    fallbackMode: 'interrupt',
    fallbackTagMode: 'or',
    maxRetries: 2,
    allowDirectFallback: false,
    maxConcurrent: 0,
    rateLimitPerMinute: 0,
    bandwidthLimitKbps: 0,
    connectTimeoutSeconds: 30,
    idleTimeoutSeconds: 120,
    maxSessionSeconds: 0,
    enableUsernameRouting: false,
    allowAllRouteStrategies: false,
    allowedRouteStrategyIds: [],
    proxyIds: [],
    proxyMatchGroupIds: [],
    proxyMatchTagIds: [],
    fallbackProxyIds: [],
    fallbackGroupIds: [],
    fallbackTagIds: [],
    tagIds: [],
})

const defaultRouteStrategy = (gatewayId: number): Partial<ProxyGatewayRouteStrategy> => ({
    gatewayId,
    name: '自定义路由策略',
    flagNo: 1,
    description: '',
    enabled: true,
    selectionMode: 'filtered',
    selectionAlgorithm: 'random',
    proxyMatchTagMode: 'or',
    stickyMode: 'none',
    stickyTtlSeconds: 600,
    preferLastSuccess: false,
    fallbackMode: 'interrupt',
    fallbackTagMode: 'or',
    maxRetries: 2,
    allowDirectFallback: false,
    proxyIds: [],
    proxyMatchGroupIds: [],
    proxyMatchTagIds: [],
    fallbackProxyIds: [],
    fallbackGroupIds: [],
    fallbackTagIds: [],
})

const defaultSecurityPolicy = (gatewayId: number): Partial<ProxyGatewaySecurityPolicy> => ({
    gatewayId,
    name: '自定义安全策略',
    description: '',
    isDefault: false,
    sourceAllowCidrs: [],
    sourceDenyCidrs: [],
    targetHostAllowlist: [],
    targetHostDenylist: [],
    targetPortAllowlist: [],
    targetPortDenylist: [],
    blockPrivateIp: true,
    blockLoopback: true,
    blockLinkLocal: true,
    blockMulticast: true,
    blockMetadataIp: true,
    dnsRebindingProtection: true,
    noMatchAction: 'deny',
})

const defaultDNSPolicy = (gatewayId: number): Partial<ProxyGatewayDNSPolicy> => ({
    gatewayId,
    name: '自定义 DNS 策略',
    description: '',
    isDefault: false,
    mode: 'remote',
    resolvers: [],
    socks5RemoteResolve: true,
    httpConnectPreserveHost: true,
    preResolveForSecurity: true,
    cacheTtlSeconds: 300,
    negativeTtlSeconds: 60,
    multiIpStrategy: 'check_all',
    resolveFailureAction: 'deny',
})

const SAFE_USERNAME_CHARS = 'abcdefghijkmnopqrstuvwxyz23456789'
const SAFE_PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const SAFE_PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz'
const SAFE_PASSWORD_DIGITS = '23456789'
const SAFE_PASSWORD_CHARS = `${SAFE_PASSWORD_UPPER}${SAFE_PASSWORD_LOWER}${SAFE_PASSWORD_DIGITS}`

function randomIndex(max: number) {
    if (max <= 0) return 0
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
        const bytes = new Uint32Array(1)
        window.crypto.getRandomValues(bytes)
        return bytes[0] % max
    }
    return Math.floor(Math.random() * max)
}

function randomChar(chars: string) {
    return chars[randomIndex(chars.length)]
}

function randomString(length: number, chars: string) {
    return Array.from({ length }, () => randomChar(chars)).join('')
}

function generateGatewayUsername() {
    return `gw${randomString(10, SAFE_USERNAME_CHARS)}`
}

function generateGatewayPassword() {
    const chars = [
        randomChar(SAFE_PASSWORD_UPPER),
        randomChar(SAFE_PASSWORD_LOWER),
        randomChar(SAFE_PASSWORD_DIGITS),
        ...Array.from({ length: 13 }, () => randomChar(SAFE_PASSWORD_CHARS)),
    ]
    for (let i = chars.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1)
        const current = chars[i]
        chars[i] = chars[j]
        chars[j] = current
    }
    return chars.join('')
}

export default function ProxyGatewayTab({ section = 'gateways' }: ProxyGatewayTabProps) {
    const normalizedSection = normalizeSection(section)
    const meta = sectionMeta[normalizedSection]
    const Icon = meta.icon
    const confirm = useConfirmDialog()

    const [loading, setLoading] = useState(true)
    const [listeners, setListeners] = useState<ProxyGatewayListener[]>([])
    const [selectedGatewayId, setSelectedGatewayId] = useState<number>(0)
    const [gatewayDetailId, setGatewayDetailId] = useState<number | null>(null)
    const [gatewayDetailSection, setGatewayDetailSection] = useState<GatewayDetailSection>(
        section === 'security' ? 'security' : section === 'dns' ? 'dns' : section === 'routes' ? 'routes' : 'overview'
    )
    const [accounts, setAccounts] = useState<ProxyGatewayAccount[]>([])
    const [accountGroups, setAccountGroups] = useState<ProxyGatewayAccountGroup[]>([])
    const [accountTags, setAccountTags] = useState<ProxyGatewayAccountTag[]>([])
    const [routeStrategies, setRouteStrategies] = useState<ProxyGatewayRouteStrategy[]>([])
    const [securityPolicies, setSecurityPolicies] = useState<ProxyGatewaySecurityPolicy[]>([])
    const [dnsPolicies, setDnsPolicies] = useState<ProxyGatewayDNSPolicy[]>([])
    const [logs, setLogs] = useState<ProxyGatewayAccessLog[]>([])
    const [auditLogs, setAuditLogs] = useState<ProxyGatewayAuditLog[]>([])
    const [statuses, setStatuses] = useState<ProxyGatewayStatus[]>([])
    const [proxyGroups, setProxyGroups] = useState<ProxyGroup[]>([])
    const [proxyTags, setProxyTags] = useState<ProxyTag[]>([])
    const [proxies, setProxies] = useState<ProxyPoolItem[]>([])

    const [listenerDraft, setListenerDraft] = useState<Partial<ProxyGatewayListener> | null>(null)
    const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null)
    const [routeDraft, setRouteDraft] = useState<Partial<ProxyGatewayRouteStrategy> | null>(null)
    const [securityDraft, setSecurityDraft] = useState<Partial<ProxyGatewaySecurityPolicy> | null>(null)
    const [dnsDraft, setDNSDraft] = useState<Partial<ProxyGatewayDNSPolicy> | null>(null)
    const [metaDraft, setMetaDraft] = useState<MetaDraft | null>(null)

    const safeListeners = useMemo(() => asArray<ProxyGatewayListener>(listeners), [listeners])
    const safeAccounts = useMemo(() => asArray<ProxyGatewayAccount>(accounts), [accounts])
    const safeAccountGroups = useMemo(() => asArray<ProxyGatewayAccountGroup>(accountGroups), [accountGroups])
    const safeAccountTags = useMemo(() => asArray<ProxyGatewayAccountTag>(accountTags), [accountTags])
    const safeRouteStrategies = useMemo(() => asArray<ProxyGatewayRouteStrategy>(routeStrategies), [routeStrategies])
    const safeSecurityPolicies = useMemo(() => asArray<ProxyGatewaySecurityPolicy>(securityPolicies), [securityPolicies])
    const safeDNSPolicies = useMemo(() => asArray<ProxyGatewayDNSPolicy>(dnsPolicies), [dnsPolicies])
    const safeLogs = useMemo(() => asArray<ProxyGatewayAccessLog>(logs), [logs])
    const safeAuditLogs = useMemo(() => asArray<ProxyGatewayAuditLog>(auditLogs), [auditLogs])
    const safeStatuses = useMemo(() => asArray<ProxyGatewayStatus>(statuses), [statuses])
    const safeProxyGroups = useMemo(() => asArray<ProxyGroup>(proxyGroups), [proxyGroups])
    const safeProxyTags = useMemo(() => asArray<ProxyTag>(proxyTags), [proxyTags])
    const safeProxies = useMemo(() => asArray<ProxyPoolItem>(proxies), [proxies])

    const selectedGateway = useMemo(() => safeListeners.find(item => item.id === selectedGatewayId) || safeListeners.find(item => item.isDefault) || safeListeners[0], [safeListeners, selectedGatewayId])
    const currentGatewayId = selectedGateway?.id || selectedGatewayId || 0
    const statusByListener = useMemo(() => new Map(safeStatuses.map(item => [item.listenerId, item])), [safeStatuses])

    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            const [
                nextListeners,
                accountResponse,
                nextAccountGroups,
                nextAccountTags,
                nextLogs,
                nextAuditLogs,
                nextStatus,
                nextProxyGroups,
                nextProxyTags,
                proxyResponse,
            ] = await Promise.all([
                proxyGatewayService.listListeners(),
                proxyGatewayService.listAccounts({ limit: 200 }),
                proxyGatewayService.listAccountGroups(),
                proxyGatewayService.listAccountTags(),
                proxyGatewayService.listLogs({ limit: 80 }),
                proxyGatewayService.listAuditLogs(80),
                proxyGatewayService.status(),
                proxyPoolService.listGroups(),
                proxyPoolService.listTags(),
                proxyPoolService.list({ limit: 500, status: 'available' }),
            ])
            const listenerItems = asArray<ProxyGatewayListener>(nextListeners)
            const accountItems = asArray<ProxyGatewayAccount>((accountResponse as any)?.items)
            const logItems = asArray<ProxyGatewayAccessLog>((nextLogs as any)?.items)
            const proxyItems = asArray<ProxyPoolItem>((proxyResponse as any)?.items)
            const nextGatewayId = selectedGatewayId && listenerItems.some(item => item.id === selectedGatewayId)
                ? selectedGatewayId
                : listenerItems.find(item => item.isDefault)?.id || listenerItems[0]?.id || 0
            const [nextRoutes, nextSecurity, nextDNS] = nextGatewayId
                ? await Promise.all([
                    proxyGatewayService.listRouteStrategies(),
                    proxyGatewayService.listSecurityPolicies({ gatewayId: nextGatewayId }),
                    proxyGatewayService.listDNSPolicies({ gatewayId: nextGatewayId }),
                ])
                : [[], [], []]

            setListeners(listenerItems)
            setSelectedGatewayId(nextGatewayId)
            setAccounts(accountItems)
            setAccountGroups(asArray<ProxyGatewayAccountGroup>(nextAccountGroups))
            setAccountTags(asArray<ProxyGatewayAccountTag>(nextAccountTags))
            setRouteStrategies(asArray<ProxyGatewayRouteStrategy>(nextRoutes))
            setSecurityPolicies(asArray<ProxyGatewaySecurityPolicy>(nextSecurity))
            setDnsPolicies(asArray<ProxyGatewayDNSPolicy>(nextDNS))
            setLogs(logItems)
            setAuditLogs(asArray<ProxyGatewayAuditLog>(nextAuditLogs))
            setStatuses(asArray<ProxyGatewayStatus>(nextStatus))
            setProxyGroups(asArray<ProxyGroup>(nextProxyGroups))
            setProxyTags(asArray<ProxyTag>(nextProxyTags))
            setProxies(proxyItems)
        } catch (error: any) {
            toast.error(error.message || '加载 Proxy Gateway 失败')
        } finally {
            setLoading(false)
        }
    }, [selectedGatewayId])

    useEffect(() => {
        loadData()
    }, [loadData])

    useEffect(() => {
        if (section === 'security' || section === 'dns' || section === 'routes') {
            setGatewayDetailSection(section)
            if (currentGatewayId) setGatewayDetailId(currentGatewayId)
        }
    }, [section, currentGatewayId])

    const reloadGateway = async () => {
        try {
            const result = await proxyGatewayService.reload()
            setStatuses(result.status)
            toast.success('Proxy Gateway 已热加载')
        } catch (error: any) {
            toast.error(error.message || '热加载失败')
        }
    }

    const saveListener = async () => {
        if (!listenerDraft) return
        try {
            const saved = listenerDraft.id
                ? await proxyGatewayService.updateListener(listenerDraft.id, listenerDraft)
                : await proxyGatewayService.createListener(listenerDraft)
            setListenerDraft(null)
            setSelectedGatewayId(saved.id)
            await loadData()
            toast.success('网关已保存')
        } catch (error: any) {
            toast.error(error.message || '保存失败')
        }
    }

    const saveAccount = async () => {
        if (!accountDraft) return
        try {
            if (accountDraft.id) {
                await proxyGatewayService.updateAccount(accountDraft.id, accountDraft)
            } else {
                await proxyGatewayService.createAccount(accountDraft)
            }
            setAccountDraft(null)
            await loadData()
            toast.success('网关用户已保存')
        } catch (error: any) {
            toast.error(error.message || '保存失败')
        }
    }

    const saveRouteStrategy = async () => {
        if (!routeDraft) return
        const payload = { ...routeDraft, gatewayId: routeDraft.gatewayId || currentGatewayId }
        try {
            if (payload.id) {
                await proxyGatewayService.updateRouteStrategy(payload.id, payload)
            } else {
                await proxyGatewayService.createRouteStrategy(payload)
            }
            setRouteDraft(null)
            await loadData()
            toast.success('路由策略已保存')
        } catch (error: any) {
            toast.error(error.message || '保存失败')
        }
    }

    const saveSecurity = async () => {
        if (!securityDraft) return
        const payload = { ...securityDraft, gatewayId: securityDraft.gatewayId || currentGatewayId }
        try {
            if (payload.id) {
                await proxyGatewayService.updateSecurityPolicy(payload.id, payload)
            } else {
                await proxyGatewayService.createSecurityPolicy(payload)
            }
            setSecurityDraft(null)
            await loadData()
            toast.success('安全策略已保存')
        } catch (error: any) {
            toast.error(error.message || '保存失败')
        }
    }

    const saveDNS = async () => {
        if (!dnsDraft) return
        const payload = { ...dnsDraft, gatewayId: dnsDraft.gatewayId || currentGatewayId }
        try {
            if (payload.id) {
                await proxyGatewayService.updateDNSPolicy(payload.id, payload)
            } else {
                await proxyGatewayService.createDNSPolicy(payload)
            }
            setDNSDraft(null)
            await loadData()
            toast.success('DNS 策略已保存')
        } catch (error: any) {
            toast.error(error.message || '保存失败')
        }
    }

    const saveMeta = async () => {
        if (!metaDraft) return
        try {
            const payload = { name: metaDraft.name, description: metaDraft.description, color: metaDraft.color, sortOrder: metaDraft.sortOrder }
            if (metaDraft.type === 'group') {
                if (metaDraft.id) await proxyGatewayService.updateAccountGroup(metaDraft.id, payload)
                else await proxyGatewayService.createAccountGroup(payload)
            } else {
                if (metaDraft.id) await proxyGatewayService.updateAccountTag(metaDraft.id, payload)
                else await proxyGatewayService.createAccountTag(payload)
            }
            setMetaDraft(null)
            await loadData()
            toast.success('分组标签已保存')
        } catch (error: any) {
            toast.error(error.message || '保存失败')
        }
    }

    const createButton = () => {
        if (normalizedSection === 'gateways') return <CreateButton onClick={() => setListenerDraft(defaultListener())} label="新增网关" />
        if (normalizedSection === 'accounts') return <CreateButton onClick={() => setAccountDraft(defaultAccount(safeListeners.find(item => item.isDefault)?.id || safeListeners[0]?.id))} label="新增网关用户" />
        if (normalizedSection === 'account-groups') return <CreateButton onClick={() => setMetaDraft({ type: 'group', name: '', color: '#2563eb', sortOrder: 0 })} label="新增分组" />
        if (normalizedSection === 'account-tags') return <CreateButton onClick={() => setMetaDraft({ type: 'tag', name: '', color: '#16a34a', sortOrder: 0 })} label="新增标签" />
        return null
    }

    return (
        <TooltipProvider delayDuration={250}>
            <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-950">
                <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-300">
                                <Icon className="h-5 w-5" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{meta.title}</h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{meta.subtitle}</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button onClick={loadData} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                                刷新
                            </button>
                            {createButton()}
                        </div>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-6">
                    {loading ? (
                        <div className="flex h-64 items-center justify-center text-sm text-gray-500">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            正在加载
                        </div>
                    ) : (
                        <>
                            {normalizedSection === 'gateways' && (
                                <GatewaysView
                                    gateways={safeListeners}
                                    selectedGatewayId={currentGatewayId}
                                    onSelect={setSelectedGatewayId}
                                    detailGatewayId={gatewayDetailId}
                                    detailSection={gatewayDetailSection}
                                    onOpenDetail={id => {
                                        setSelectedGatewayId(id)
                                        setGatewayDetailId(id)
                                        setGatewayDetailSection('overview')
                                    }}
                                    onBackToList={() => setGatewayDetailId(null)}
                                    onDetailSectionChange={setGatewayDetailSection}
                                    statusByListener={statusByListener}
                                    routeStrategies={safeRouteStrategies}
                                    securityPolicies={safeSecurityPolicies}
                                    dnsPolicies={safeDNSPolicies}
                                    logs={safeLogs}
                                    accounts={safeAccounts}
                                    onReload={reloadGateway}
                                    onEditGateway={item => setListenerDraft({ ...item })}
                                    onDeleteGateway={async item => {
                                        if (!(await confirm.confirm({ title: '删除代理网关', description: `确认删除 ${item.name}？网关下的策略将不可继续使用。` }))) return
                                        await proxyGatewayService.deleteListener(item.id)
                                        await loadData()
                                    }}
                                    onCreateRoute={() => currentGatewayId && setRouteDraft(defaultRouteStrategy(currentGatewayId))}
                                    onEditRoute={item => setRouteDraft({ ...item })}
                                    onDeleteRoute={async item => {
                                        if (!(await confirm.confirm({ title: '删除路由策略', description: `确认删除 ${item.name}？已授权账号将无法继续使用 #${item.flagNo}。` }))) return
                                        await proxyGatewayService.deleteRouteStrategy(item.id)
                                        await loadData()
                                    }}
                                    onCreateSecurity={() => currentGatewayId && setSecurityDraft(defaultSecurityPolicy(currentGatewayId))}
                                    onEditSecurity={item => setSecurityDraft({ ...item })}
                                    onCreateDNS={() => currentGatewayId && setDNSDraft(defaultDNSPolicy(currentGatewayId))}
                                    onEditDNS={item => setDNSDraft({ ...item })}
                                />
                            )}
                            {normalizedSection === 'accounts' && (
                                <AccountsView
                                    accounts={safeAccounts}
                                    gateways={safeListeners}
                                    routeStrategies={safeRouteStrategies}
                                    onEdit={item => setAccountDraft({ ...item, password: item.password || '', tagIds: item.tags?.map(tag => tag.id) || [] })}
                                    onDelete={async item => {
                                        if (!(await confirm.confirm({ title: '删除网关用户', description: `确认删除 ${item.username}？` }))) return
                                        await proxyGatewayService.deleteAccount(item.id)
                                        await loadData()
                                    }}
                                />
                            )}
                            {normalizedSection === 'account-groups' && (
                                <AccountMetaView
                                    mode="groups"
                                    groups={safeAccountGroups}
                                    tags={safeAccountTags}
                                    onEditGroup={item => setMetaDraft({ type: 'group', id: item.id, name: item.name, description: item.description, color: item.color, sortOrder: item.sortOrder })}
                                    onDeleteGroup={async item => {
                                        if (!(await confirm.confirm({ title: '删除账号分组', description: `确认删除 ${item.name}？账号会自动变为不分组。` }))) return
                                        await proxyGatewayService.deleteAccountGroup(item.id)
                                        await loadData()
                                    }}
                                    onEditTag={item => setMetaDraft({ type: 'tag', id: item.id, name: item.name, color: item.color, sortOrder: item.sortOrder })}
                                    onDeleteTag={async item => {
                                        if (!(await confirm.confirm({ title: '删除账号标签', description: `确认删除 ${item.name}？` }))) return
                                        await proxyGatewayService.deleteAccountTag(item.id)
                                        await loadData()
                                    }}
                                />
                            )}
                            {normalizedSection === 'account-tags' && (
                                <AccountMetaView
                                    mode="tags"
                                    groups={safeAccountGroups}
                                    tags={safeAccountTags}
                                    onEditGroup={item => setMetaDraft({ type: 'group', id: item.id, name: item.name, description: item.description, color: item.color, sortOrder: item.sortOrder })}
                                    onDeleteGroup={async item => {
                                        if (!(await confirm.confirm({ title: '删除账号分组', description: `确认删除 ${item.name}？账号会自动变为不分组。` }))) return
                                        await proxyGatewayService.deleteAccountGroup(item.id)
                                        await loadData()
                                    }}
                                    onEditTag={item => setMetaDraft({ type: 'tag', id: item.id, name: item.name, color: item.color, sortOrder: item.sortOrder })}
                                    onDeleteTag={async item => {
                                        if (!(await confirm.confirm({ title: '删除账号标签', description: `确认删除 ${item.name}？` }))) return
                                        await proxyGatewayService.deleteAccountTag(item.id)
                                        await loadData()
                                    }}
                                />
                            )}
                            {normalizedSection === 'logs' && <LogsView logs={safeLogs} auditLogs={safeAuditLogs} />}
                        </>
                    )}
                </div>

                <ListenerModal draft={listenerDraft} setDraft={setListenerDraft} securityPolicies={safeSecurityPolicies} dnsPolicies={safeDNSPolicies} onSave={saveListener} />
                <AccountModal
                    draft={accountDraft}
                    setDraft={setAccountDraft}
                    gateways={safeListeners}
                    accountGroups={safeAccountGroups}
                    accountTags={safeAccountTags}
                    routeStrategies={safeRouteStrategies}
                    proxyGroups={safeProxyGroups}
                    proxyTags={safeProxyTags}
                    proxies={safeProxies}
                    onSave={saveAccount}
                />
                <RouteStrategyModal draft={routeDraft} setDraft={setRouteDraft} proxyGroups={safeProxyGroups} proxyTags={safeProxyTags} proxies={safeProxies} securityPolicies={safeSecurityPolicies} dnsPolicies={safeDNSPolicies} onSave={saveRouteStrategy} />
                <SecurityModal draft={securityDraft} setDraft={setSecurityDraft} onSave={saveSecurity} />
                <DNSModal draft={dnsDraft} setDraft={setDNSDraft} onSave={saveDNS} />
                <MetaModal draft={metaDraft} setDraft={setMetaDraft} onSave={saveMeta} />
            </div>
        </TooltipProvider>
    )
}

function CreateButton({ onClick, label }: { onClick: () => void; label: string }) {
    return (
        <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-primary-700 hover:shadow-lg hover:shadow-primary-600/20">
            <Plus className="h-4 w-4" />
            {label}
        </button>
    )
}

function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'red' | 'blue' | 'amber' }) {
    const tones = {
        gray: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
        green: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
        red: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300',
        blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300',
        amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
    }
    return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
}

function Panel({ children }: { children: React.ReactNode }) {
    return <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">{children}</div>
}

function TableShell({ children }: { children: React.ReactNode }) {
    return <div className="overflow-x-auto">{children}</div>
}

function EmptyState({ label }: { label: string }) {
    return <div className="p-10 text-center text-sm text-gray-500 dark:text-gray-400">{label}</div>
}

function GatewaysView({
    gateways,
    selectedGatewayId,
    onSelect,
    detailGatewayId,
    detailSection,
    onOpenDetail,
    onBackToList,
    onDetailSectionChange,
    statusByListener,
    routeStrategies,
    securityPolicies,
    dnsPolicies,
    logs,
    accounts,
    onReload,
    onEditGateway,
    onDeleteGateway,
    onCreateRoute,
    onEditRoute,
    onDeleteRoute,
    onCreateSecurity,
    onEditSecurity,
    onCreateDNS,
    onEditDNS,
}: {
    gateways: ProxyGatewayListener[]
    selectedGatewayId: number
    onSelect: (id: number) => void
    detailGatewayId: number | null
    detailSection: GatewayDetailSection
    onOpenDetail: (id: number) => void
    onBackToList: () => void
    onDetailSectionChange: (section: GatewayDetailSection) => void
    statusByListener: Map<number, ProxyGatewayStatus>
    routeStrategies: ProxyGatewayRouteStrategy[]
    securityPolicies: ProxyGatewaySecurityPolicy[]
    dnsPolicies: ProxyGatewayDNSPolicy[]
    logs: ProxyGatewayAccessLog[]
    accounts: ProxyGatewayAccount[]
    onReload: () => void
    onEditGateway: (item: ProxyGatewayListener) => void
    onDeleteGateway: (item: ProxyGatewayListener) => void
    onCreateRoute: () => void
    onEditRoute: (item: ProxyGatewayRouteStrategy) => void
    onDeleteRoute: (item: ProxyGatewayRouteStrategy) => void
    onCreateSecurity: () => void
    onEditSecurity: (item: ProxyGatewaySecurityPolicy) => void
    onCreateDNS: () => void
    onEditDNS: (item: ProxyGatewayDNSPolicy) => void
}) {
    if (!gateways.length) return <EmptyState label="还没有代理网关" />
    const selected = gateways.find(item => item.id === selectedGatewayId) || gateways[0]
    const detailGateway = detailGatewayId ? gateways.find(item => item.id === detailGatewayId) : null

    if (detailGateway) {
        const gatewayRoutes = routeStrategies.filter(item => item.gatewayId === detailGateway.id || item.gatewayId === 0)
        const gatewaySecurity = securityPolicies.filter(item => item.gatewayId === detailGateway.id || item.gatewayId === 0)
        const gatewayDNS = dnsPolicies.filter(item => item.gatewayId === detailGateway.id || item.gatewayId === 0)
        const gatewayLogs = logs.filter(item => !item.listenerId || item.listenerId === detailGateway.id)
        const gatewayStatus = statusByListener.get(detailGateway.id)
        const allowedAccounts = accounts.filter(account => account.allowAllGateways || !account.allowedGatewayIds?.length || account.allowedGatewayIds.includes(detailGateway.id))
        const detailMenuItems: Array<{ id: GatewayDetailSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
            { id: 'overview', label: '概览', icon: Server },
            { id: 'routes', label: '用户名路由', icon: GitBranch },
            { id: 'security', label: '安全策略', icon: ShieldCheck },
            { id: 'dns', label: 'DNS 策略', icon: Network },
            { id: 'logs', label: '网关日志', icon: FileText },
        ]

        return (
            <div className="grid min-h-[640px] gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
                <Panel>
                    <div className="border-b border-gray-100 p-4 dark:border-gray-800">
                        <button onClick={onBackToList} className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">
                            <ArrowLeft className="h-4 w-4" />
                            返回网关列表
                        </button>
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
                                <Network className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <h3 className="truncate font-semibold text-gray-900 dark:text-white">{detailGateway.name}</h3>
                                <p className="mt-1 text-xs text-gray-500">{gatewayHostPort(detailGateway)} · {detailGateway.protocol.toUpperCase()}</p>
                            </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {detailGateway.isDefault && <Badge tone="blue">默认网关</Badge>}
                            <Badge tone={detailGateway.enabled ? 'green' : 'gray'}>{detailGateway.enabled ? '已启用' : '已停用'}</Badge>
                            <Badge tone={gatewayStatus?.running ? 'green' : 'red'}>{gatewayStatus?.running ? '运行中' : '未运行'}</Badge>
                        </div>
                    </div>
                    <div className="p-2">
                        {detailMenuItems.map(({ id, label, icon: MenuIcon }) => (
                            <button
                                key={id}
                                onClick={() => onDetailSectionChange(id)}
                                className={cn(
                                    'mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition',
                                    detailSection === id
                                        ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300'
                                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                                )}
                            >
                                <MenuIcon className="h-4 w-4" />
                                {label}
                            </button>
                        ))}
                    </div>
                </Panel>

                <div className="min-w-0">
                    {detailSection === 'overview' && (
                        <GatewayOverview
                            gateway={detailGateway}
                            status={gatewayStatus}
                            allowedAccounts={allowedAccounts}
                            routeCount={gatewayRoutes.length}
                            securityCount={gatewaySecurity.length}
                            dnsCount={gatewayDNS.length}
                            onEdit={() => onEditGateway(detailGateway)}
                            onReload={onReload}
                        />
                    )}
                    {detailSection === 'routes' && (
                        <Panel>
                            <div className="p-4">
                                <RouteStrategiesView strategies={gatewayRoutes} accounts={allowedAccounts} onCreate={onCreateRoute} onEdit={onEditRoute} onDelete={onDeleteRoute} />
                            </div>
                        </Panel>
                    )}
                    {detailSection === 'security' && (
                        <Panel>
                            <div className="p-4">
                                <SecurityView policies={gatewaySecurity} onCreate={onCreateSecurity} onEdit={onEditSecurity} />
                            </div>
                        </Panel>
                    )}
                    {detailSection === 'dns' && (
                        <Panel>
                            <div className="p-4">
                                <DNSView policies={gatewayDNS} onCreate={onCreateDNS} onEdit={onEditDNS} />
                            </div>
                        </Panel>
                    )}
                    {detailSection === 'logs' && <LogsView logs={gatewayLogs} auditLogs={[]} />}
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <Panel>
                <TableShell>
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                            <tr>
                                <th className="px-4 py-3 text-left">网关</th>
                                <th className="px-4 py-3 text-left">监听地址</th>
                                <th className="px-4 py-3 text-left">协议</th>
                                <th className="px-4 py-3 text-left">授权用户</th>
                                <th className="px-4 py-3 text-left">运行</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {gateways.map(item => {
                                const status = statusByListener.get(item.id)
                                const isSelected = item.id === selected.id
                                const gatewayAccounts = accounts.filter(account => account.allowAllGateways || !account.allowedGatewayIds?.length || account.allowedGatewayIds.includes(item.id)).length
                                return (
                                    <tr key={item.id} className={cn('hover:bg-gray-50/80 dark:hover:bg-gray-800/40', isSelected && 'bg-primary-50/60 dark:bg-primary-950/20')}>
                                        <td className="px-4 py-3">
                                            <button onClick={() => onSelect(item.id)} className="text-left font-medium text-gray-900 hover:text-primary-600 dark:text-white">
                                                {item.name}
                                            </button>
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {item.isDefault && <Badge tone="blue">默认网关</Badge>}
                                                <Badge tone={item.enabled ? 'green' : 'gray'}>{item.enabled ? '已启用' : '已停用'}</Badge>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                                            <div>{item.listenIp}:{item.port}</div>
                                            {(item.externalHost || item.externalPort) && <div className="mt-1 text-xs text-gray-500">外部 {gatewayHostPort(item)}</div>}
                                        </td>
                                        <td className="px-4 py-3"><Badge tone="blue">{item.protocol.toUpperCase()}</Badge></td>
                                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{gatewayAccounts}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Badge tone={status?.running ? 'green' : 'red'}>{status?.running ? '运行中' : '未运行'}</Badge>
                                                {status?.lastError && <Badge tone="red">{status.lastError}</Badge>}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="inline-flex items-center gap-1">
                                                <button
                                                    onClick={() => onOpenDetail(item.id)}
                                                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                                                >
                                                    配置策略
                                                </button>
                                                <RowActions onEdit={() => onEditGateway(item)} onDelete={() => onDeleteGateway(item)} />
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </TableShell>
            </Panel>
        </div>
    )
}

function GatewayOverview({ gateway, status, allowedAccounts, routeCount, securityCount, dnsCount, onEdit, onReload }: {
    gateway: ProxyGatewayListener
    status?: ProxyGatewayStatus
    allowedAccounts: ProxyGatewayAccount[]
    routeCount: number
    securityCount: number
    dnsCount: number
    onEdit: () => void
    onReload: () => void
}) {
    return (
        <div className="space-y-5">
            <Panel>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 p-4 dark:border-gray-800">
                    <div>
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white">{gateway.name}</h3>
                        <p className="mt-1 text-sm text-gray-500">{gatewayHostPort(gateway)} · {gateway.protocol.toUpperCase()} · {gateway.requireAuth ? '需要认证' : '匿名入口'}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={onReload} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                            <RefreshCw className="h-4 w-4" />
                            热加载
                        </button>
                        <button onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                            <Save className="h-4 w-4" />
                            编辑网关
                        </button>
                    </div>
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric label="授权用户" value={allowedAccounts.length} />
                    <Metric label="用户名路由" value={routeCount} />
                    <Metric label="安全策略" value={securityCount} />
                    <Metric label="DNS 策略" value={dnsCount} />
                    <Metric label="活跃连接" value={status?.activeConns || 0} />
                    <Metric label="累计连接" value={status?.totalConns || 0} />
                    <Metric label="入站流量" value={formatBytes(status?.totalBytesIn || 0)} />
                    <Metric label="出站流量" value={formatBytes(status?.totalBytesOut || 0)} />
                </div>
            </Panel>
            <Panel>
                <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">网关配置摘要</div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                    <SummaryRow label="监听地址" value={`${gateway.listenIp}:${gateway.port}`} />
                    <SummaryRow label="外部访问" value={gatewayHostPort(gateway)} />
                    <SummaryRow label="协议" value={gateway.protocol.toUpperCase()} />
                    <SummaryRow label="公网监听" value={gateway.allowPublicListen ? '允许' : '不允许'} />
                    <SummaryRow label="默认网关" value={gateway.isDefault ? '是' : '否'} />
                    <SummaryRow label="握手超时" value={`${gateway.handshakeTimeoutSeconds}s`} />
                    <SummaryRow label="连接超时" value={`${gateway.connectTimeoutSeconds}s`} />
                    <SummaryRow label="空闲超时" value={`${gateway.idleTimeoutSeconds}s`} />
                    <SummaryRow label="最近热加载" value={status?.lastReloadedAt ? formatTime(status.lastReloadedAt) : '-'} />
                </div>
                {status?.lastError && <div className="mx-4 mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{status.lastError}</div>}
            </Panel>
        </div>
    )
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950/50">
            <span className="mr-2 text-gray-500">{label}</span>
            <span className="font-medium text-gray-900 dark:text-white">{value}</span>
        </div>
    )
}

function AccountsView({ accounts, gateways, routeStrategies, onEdit, onDelete }: {
    accounts: ProxyGatewayAccount[]
    gateways: ProxyGatewayListener[]
    routeStrategies: ProxyGatewayRouteStrategy[]
    onEdit: (item: ProxyGatewayAccount) => void
    onDelete: (item: ProxyGatewayAccount) => void
}) {
    const [curlAccount, setCurlAccount] = useState<ProxyGatewayAccount | null>(null)
    if (!accounts.length) return <EmptyState label="还没有网关用户" />
    const gatewayById = new Map(gateways.map(item => [item.id, item]))
    const strategyById = new Map(routeStrategies.map(item => [item.id, item]))
    return (
        <>
            <Panel>
                <TableShell>
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                            <tr>
                                <th className="px-4 py-3 text-left">用户</th>
                                <th className="px-4 py-3 text-left">认证信息</th>
                                <th className="px-4 py-3 text-left">可用网关</th>
                                <th className="px-4 py-3 text-left">代理策略</th>
                                <th className="px-4 py-3 text-left">分组标签</th>
                                <th className="px-4 py-3 text-left">限速</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {accounts.map(item => (
                                <tr key={item.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-gray-900 dark:text-white">{item.username}</div>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            <Badge tone={item.enabled ? 'green' : 'red'}>{item.enabled ? '启用' : '停用'}</Badge>
                                            {item.enableUsernameRouting && <Badge tone="amber">智能用户名</Badge>}
                                        </div>
                                        <div className="mt-1 text-xs text-gray-500">{item.name || item.remark || '无备注'}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="space-y-1 font-mono text-xs">
                                            <div className="rounded bg-gray-100 px-2 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-200">username: {item.username}</div>
                                            <div className="rounded bg-gray-100 px-2 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-200">password: {item.password || '-'}</div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {item.allowAllGateways || !item.allowedGatewayIds?.length ? (
                                                <Badge tone="blue">全部网关</Badge>
                                            ) : item.allowedGatewayIds.map(id => <Badge key={id}>{gatewayById.get(id)?.name || `#${id}`}</Badge>)}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1.5">
                                            <Badge tone="blue">{item.selectionMode}</Badge>
                                            <Badge>{item.selectionAlgorithm}</Badge>
                                            {item.preferLastSuccess && <Badge tone="green">优先复用</Badge>}
                                            {item.stickyMode !== 'none' && <Badge tone="amber">{item.stickyMode}</Badge>}
                                        </div>
                                        {item.enableUsernameRouting && !item.allowAllRouteStrategies && (
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {(item.allowedRouteStrategyIds || []).map(id => {
                                                    const strategy = strategyById.get(id)
                                                    return <Badge key={id} tone="blue">#{strategy?.flagNo || id}</Badge>
                                                })}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {item.group && <Badge tone="blue">{item.group.name}</Badge>}
                                            {item.tags?.map(tag => <Badge key={tag.id}>{tag.name}</Badge>)}
                                            {!item.group && !item.tags?.length && <span className="text-xs text-gray-500">未设置</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                                        并发 {item.maxConcurrent || '不限'} · 每分钟 {item.rateLimitPerMinute || '不限'}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="inline-flex items-center gap-1">
                                            <button onClick={() => setCurlAccount(item)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">测试 curl</button>
                                            <RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            </Panel>
            <AccountCurlModal account={curlAccount} onClose={() => setCurlAccount(null)} />
        </>
    )
}

function AccountCurlModal({ account, onClose }: {
    account: ProxyGatewayAccount | null
    onClose: () => void
}) {
    const [gatewayId, setGatewayId] = useState<number | undefined>()
    const [liveGateways, setLiveGateways] = useState<ProxyGatewayListener[]>([])
    const [loadingGateways, setLoadingGateways] = useState(false)
    const [gatewayError, setGatewayError] = useState('')

    const loadLiveGateways = useCallback(async () => {
        if (!account) return
        setLoadingGateways(true)
        setGatewayError('')
        try {
            const items = await proxyGatewayService.listListeners()
            setLiveGateways(asArray<ProxyGatewayListener>(items))
        } catch (error: any) {
            setGatewayError(error.message || '实时获取网关失败')
            setLiveGateways([])
        } finally {
            setLoadingGateways(false)
        }
    }, [account?.id])

    useEffect(() => {
        if (!account) {
            setLiveGateways([])
            setGatewayId(undefined)
            setGatewayError('')
            return
        }
        loadLiveGateways()
    }, [account?.id, loadLiveGateways])

    const allowedGateways = useMemo(() => {
        if (!account) return []
        if (account.allowAllGateways || !account.allowedGatewayIds?.length) return liveGateways
        const allowedIds = new Set(account.allowedGatewayIds)
        return liveGateways.filter(item => allowedIds.has(item.id))
    }, [account, liveGateways])

    useEffect(() => {
        if (!account) return
        const firstGateway = allowedGateways[0]
        setGatewayId(current => current && allowedGateways.some(item => item.id === current) ? current : firstGateway?.id)
    }, [account, allowedGateways])

    if (!account) return null

    const selectedGateway = allowedGateways.find(item => item.id === gatewayId) || allowedGateways[0]
    const gatewayOptions = toSearchOptions(allowedGateways, item => `${gatewayHostPort(item)} · ${item.protocol.toUpperCase()}`)
    const commands = selectedGateway ? buildGatewayCurlCommands(account, selectedGateway) : []
    const commandText = commands.map(item => item.command).join('\n\n')

    const copyText = async (text: string, successMessage = 'curl 命令已复制') => {
        try {
            await navigator.clipboard.writeText(text)
            toast.success(successMessage)
        } catch (error: any) {
            toast.error(error.message || '复制失败')
        }
    }

    return (
        <Modal open={!!account} onOpenChange={open => !open && onClose()}>
            <ModalContent size="2xl">
                <ModalHeader>
                    <ModalTitle>生成测试 curl</ModalTitle>
                    <ModalDescription>选择该用户可用的网关，生成用于测试代理入口的 curl 命令。</ModalDescription>
                </ModalHeader>
                <ModalBody className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-950/50">
                            <div className="text-xs text-gray-500">网关用户</div>
                            <div className="mt-1 font-mono text-gray-900 dark:text-white">{account.username}</div>
                            <div className="mt-1 font-mono text-xs text-gray-600 dark:text-gray-300">{account.password || '未回显密码'}</div>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <FieldLabel label="测试网关" help="打开弹窗时实时调用接口获取网关，再按该账号授权范围过滤。" />
                                <button onClick={loadLiveGateways} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                    <RefreshCw className={cn('h-3.5 w-3.5', loadingGateways && 'animate-spin')} />
                                    重新获取
                                </button>
                            </div>
                            <SearchSelect
                                label=""
                                items={gatewayOptions}
                                value={selectedGateway?.id}
                                onChange={value => setGatewayId(value)}
                                placeholder={loadingGateways ? '正在获取网关...' : '搜索网关'}
                                emptyLabel={loadingGateways ? '正在获取网关...' : '该账号暂无可用网关'}
                            />
                            {gatewayError && <div className="text-xs text-rose-600">{gatewayError}</div>}
                        </div>
                    </div>
                    {selectedGateway ? (
                        <>
                            <div className="grid gap-3 md:grid-cols-3">
                                <Metric label="外部地址" value={gatewayHostPort(selectedGateway)} />
                                <Metric label="协议" value={selectedGateway.protocol.toUpperCase()} />
                                <Metric label="认证" value={selectedGateway.requireAuth ? '需要账号密码' : '匿名'} />
                            </div>
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <FieldLabel label="curl 命令" help="Mixed 网关同时提供 HTTP 和 SOCKS5 示例；HTTP 使用 -x，SOCKS5 使用 --socks5-hostname。" />
                                    <button disabled={!commands.length} onClick={() => copyText(commandText)} className={cn('inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700', commands.length ? 'hover:bg-gray-50 dark:hover:bg-gray-800' : 'cursor-not-allowed opacity-60')}>
                                        <Copy className="h-4 w-4" />
                                        复制全部
                                    </button>
                                </div>
                                <div className="space-y-3">
                                    {commands.map(item => (
                                        <div key={item.label} className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
                                            <div className="flex items-center justify-between gap-3 border-b border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-300">
                                                <span>{item.label}</span>
                                                <span>{item.description}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => copyText(item.command, `${item.label}命令已复制`)}
                                                    className="inline-flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-gray-200 hover:bg-gray-800"
                                                >
                                                    <Copy className="h-3.5 w-3.5" />
                                                    复制
                                                </button>
                                            </div>
                                            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-gray-950 p-3 text-xs text-gray-100">
                                                <code>{item.command}</code>
                                            </pre>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <EmptyState label={loadingGateways ? '正在实时获取网关' : '该账号暂无可用网关，无法生成测试命令'} />
                    )}
                </ModalBody>
                <ModalFooter>
                    <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">关闭</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function gatewayExternalHost(gateway: ProxyGatewayListener) {
    return (gateway.externalHost || gateway.listenIp || '127.0.0.1').trim()
}

function gatewayExternalPort(gateway: ProxyGatewayListener) {
    return gateway.externalPort && gateway.externalPort > 0 ? gateway.externalPort : gateway.port
}

function shellQuote(value: string) {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

function gatewayHostPort(gateway: ProxyGatewayListener) {
    const host = gatewayExternalHost(gateway)
    if (/:\d+$/.test(host)) return host
    return `${host}:${gatewayExternalPort(gateway)}`
}

function buildGatewayCurlCommands(account: ProxyGatewayAccount, gateway: ProxyGatewayListener) {
    const target = 'https://api.ipify.org?format=json'
    const proxyUser = shellQuote(`${account.username}:${account.password || ''}`)
    const hostPort = shellQuote(gatewayHostPort(gateway))
    const commands: Array<{ label: string; description: string; command: string }> = []
    if (gateway.protocol === 'http' || gateway.protocol === 'mixed') {
        commands.push({
            label: 'HTTP 代理',
            description: gateway.protocol === 'mixed' ? 'Mixed 网关 HTTP 示例' : 'HTTP 网关示例',
            command: `curl -x ${shellQuote(`http://${gatewayHostPort(gateway)}`)} --proxy-user ${proxyUser} ${shellQuote(target)}`,
        })
    }
    if (gateway.protocol === 'socks5' || gateway.protocol === 'mixed') {
        commands.push({
            label: 'SOCKS5 代理',
            description: gateway.protocol === 'mixed' ? 'Mixed 网关 SOCKS5 示例' : 'SOCKS5 网关示例',
            command: `curl --socks5-hostname ${hostPort} --proxy-user ${proxyUser} ${shellQuote(target)}`,
        })
    }
    return commands
}

function RouteStrategiesView({ strategies, accounts, onCreate, onEdit, onDelete }: {
    strategies: ProxyGatewayRouteStrategy[]
    accounts: ProxyGatewayAccount[]
    onCreate: () => void
    onEdit: (item: ProxyGatewayRouteStrategy) => void
    onDelete: (item: ProxyGatewayRouteStrategy) => void
}) {
    const sampleAccount = accounts.find(item => item.enableUsernameRouting)?.username || 'proxy_user'
    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <CreateButton onClick={onCreate} label="新增路由策略" />
            </div>
            {!strategies.length ? <EmptyState label="当前网关还没有用户名路由策略" /> : (
                <TableShell>
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                            <tr>
                                <th className="px-4 py-3 text-left">策略</th>
                                <th className="px-4 py-3 text-left">标志号</th>
                                <th className="px-4 py-3 text-left">用户名示例</th>
                                <th className="px-4 py-3 text-left">路由</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {strategies.map(item => (
                                <tr key={item.id}>
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-gray-900 dark:text-white">{item.name}</div>
                                        <div className="text-xs text-gray-500">{item.description || '无描述'}</div>
                                    </td>
                                    <td className="px-4 py-3"><Badge tone={item.enabled ? 'blue' : 'gray'}>#{item.flagNo}</Badge></td>
                                    <td className="px-4 py-3">
                                        <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">{sampleAccount}#{item.flagNo}</code>
                                        <div className="mt-1 text-xs text-gray-500">{sampleAccount}?route={item.flagNo}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1.5">
                                            <Badge>{item.selectionMode}</Badge>
                                            <Badge>{item.selectionAlgorithm}</Badge>
                                            {item.preferLastSuccess && <Badge tone="green">优先复用</Badge>}
                                            {item.stickyMode !== 'none' && <Badge tone="amber">{item.stickyMode}</Badge>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            )}
        </div>
    )
}

function SecurityView({ policies, onCreate, onEdit }: { policies: ProxyGatewaySecurityPolicy[]; onCreate: () => void; onEdit: (item: ProxyGatewaySecurityPolicy) => void }) {
    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <CreateButton onClick={onCreate} label="新增安全策略" />
            </div>
            {!policies.length ? <EmptyState label="当前网关还没有安全策略" /> : (
                <TableShell>
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                            <tr>
                                <th className="px-4 py-3 text-left">策略</th>
                                <th className="px-4 py-3 text-left">来源边界</th>
                                <th className="px-4 py-3 text-left">目标边界</th>
                                <th className="px-4 py-3 text-left">安全开关</th>
                                <th className="px-4 py-3 text-left">未命中</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {policies.map(item => (
                                <tr key={item.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-gray-900 dark:text-white">{item.name}</span>
                                            {item.isDefault && <Badge tone="blue">默认</Badge>}
                                        </div>
                                        <div className="mt-1 text-xs text-gray-500">{item.description || '无描述'}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            <Badge>允许 {item.sourceAllowCidrs?.length || 0}</Badge>
                                            <Badge tone={item.sourceDenyCidrs?.length ? 'red' : 'gray'}>拒绝 {item.sourceDenyCidrs?.length || 0}</Badge>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            <Badge>Host {item.targetHostAllowlist?.length || 0}/{item.targetHostDenylist?.length || 0}</Badge>
                                            <Badge>端口 {item.targetPortAllowlist?.length || 0}/{item.targetPortDenylist?.length || 0}</Badge>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            <Badge tone={item.blockPrivateIp ? 'green' : 'amber'}>内网 {item.blockPrivateIp ? '阻断' : '允许'}</Badge>
                                            <Badge tone={item.blockLoopback ? 'green' : 'amber'}>Loopback</Badge>
                                            <Badge tone={item.blockMetadataIp ? 'green' : 'amber'}>Metadata</Badge>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3"><Badge tone="blue">{item.noMatchAction}</Badge></td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => onEdit(item)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                            <Save className="h-4 w-4" />
                                            编辑
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            )}
        </div>
    )
}

function DNSView({ policies, onCreate, onEdit }: { policies: ProxyGatewayDNSPolicy[]; onCreate: () => void; onEdit: (item: ProxyGatewayDNSPolicy) => void }) {
    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <CreateButton onClick={onCreate} label="新增 DNS 策略" />
            </div>
            {!policies.length ? <EmptyState label="当前网关还没有 DNS 策略" /> : (
                <TableShell>
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                            <tr>
                                <th className="px-4 py-3 text-left">策略</th>
                                <th className="px-4 py-3 text-left">解析</th>
                                <th className="px-4 py-3 text-left">缓存</th>
                                <th className="px-4 py-3 text-left">连接行为</th>
                                <th className="px-4 py-3 text-left">解析失败</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {policies.map(item => (
                                <tr key={item.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-gray-900 dark:text-white">{item.name}</span>
                                            {item.isDefault && <Badge tone="blue">默认</Badge>}
                                        </div>
                                        <div className="mt-1 text-xs text-gray-500">{item.description || '无描述'}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            <Badge tone="blue">{item.mode}</Badge>
                                            <Badge>{item.multiIpStrategy}</Badge>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            <Badge>TTL {item.cacheTtlSeconds}s</Badge>
                                            <Badge>失败 {item.negativeTtlSeconds}s</Badge>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            <Badge tone={item.socks5RemoteResolve ? 'green' : 'amber'}>SOCKS5 远端</Badge>
                                            <Badge tone={item.httpConnectPreserveHost ? 'green' : 'amber'}>CONNECT Host</Badge>
                                            <Badge tone={item.preResolveForSecurity ? 'green' : 'gray'}>安全预解析</Badge>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3"><Badge tone={item.resolveFailureAction === 'deny' ? 'red' : 'amber'}>{item.resolveFailureAction}</Badge></td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => onEdit(item)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                                            <Save className="h-4 w-4" />
                                            编辑
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            )}
        </div>
    )
}

function AccountMetaView({ mode, groups, tags, onEditGroup, onDeleteGroup, onEditTag, onDeleteTag }: {
    mode: 'groups' | 'tags'
    groups: ProxyGatewayAccountGroup[]
    tags: ProxyGatewayAccountTag[]
    onEditGroup: (item: ProxyGatewayAccountGroup) => void
    onDeleteGroup: (item: ProxyGatewayAccountGroup) => void
    onEditTag: (item: ProxyGatewayAccountTag) => void
    onDeleteTag: (item: ProxyGatewayAccountTag) => void
}) {
    if (mode === 'groups') {
        return (
            <Panel>
                <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold dark:border-gray-800">账号分组</div>
                <MetaTable items={groups} empty="还没有账号分组" onEdit={onEditGroup} onDelete={onDeleteGroup} />
            </Panel>
        )
    }

    return (
        <Panel>
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold dark:border-gray-800">账号标签</div>
            <MetaTable items={tags} empty="还没有账号标签" onEdit={onEditTag} onDelete={onDeleteTag} />
        </Panel>
    )
}

function MetaTable<T extends { id: number; name: string; color?: string; description?: string; sortOrder?: number }>({ items, empty, onEdit, onDelete }: {
    items: T[]
    empty: string
    onEdit: (item: T) => void
    onDelete: (item: T) => void
}) {
    if (!items.length) return <EmptyState label={empty} />
    return (
        <TableShell>
            <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                    <tr>
                        <th className="px-4 py-3 text-left">名称</th>
                        <th className="px-4 py-3 text-left">排序</th>
                        <th className="px-4 py-3 text-right">操作</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {items.map(item => (
                        <tr key={item.id}>
                            <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                    {item.color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />}
                                    <span className="font-medium text-gray-900 dark:text-white">{item.name}</span>
                                </div>
                                {item.description && <div className="mt-1 text-xs text-gray-500">{item.description}</div>}
                            </td>
                            <td className="px-4 py-3 text-gray-500">{item.sortOrder || 0}</td>
                            <td className="px-4 py-3 text-right"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </TableShell>
    )
}

function LogsView({ logs, auditLogs }: { logs: ProxyGatewayAccessLog[]; auditLogs: ProxyGatewayAuditLog[] }) {
    return (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Panel>
                <TableShell>
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                            <tr>
                                <th className="px-4 py-3 text-left">时间</th>
                                <th className="px-4 py-3 text-left">账号</th>
                                <th className="px-4 py-3 text-left">目标</th>
                                <th className="px-4 py-3 text-left">上游</th>
                                <th className="px-4 py-3 text-left">状态</th>
                                <th className="px-4 py-3 text-left">耗时</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {logs.map(item => (
                                <tr key={item.id}>
                                    <td className="px-4 py-3 text-gray-500">{formatTime(item.createdAt)}</td>
                                    <td className="px-4 py-3">
                                        <div>{item.username || '-'}</div>
                                        {(item.requestedUsername || item.routeStrategyFlagNo) && (
                                            <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-500">
                                                {item.requestedUsername && <span>{item.requestedUsername}</span>}
                                                {item.routeStrategyFlagNo ? <Badge tone="blue">#{item.routeStrategyFlagNo}</Badge> : null}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">{item.targetHost}:{item.targetPort}</td>
                                    <td className="px-4 py-3">{item.upstreamProxyId ? `#${item.upstreamProxyId}` : '直连/无'}</td>
                                    <td className="px-4 py-3"><Badge tone={item.status === 'success' ? 'green' : item.status === 'denied' ? 'red' : 'amber'}>{item.status}</Badge></td>
                                    <td className="px-4 py-3">{item.durationMs}ms</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
                {!logs.length && <EmptyState label="暂无访问日志" />}
            </Panel>
            <Panel>
                <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold dark:border-gray-800">配置审计</div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {auditLogs.map(item => (
                        <div key={item.id} className="px-4 py-3 text-sm">
                            <div className="font-medium text-gray-900 dark:text-white">{item.action} · {item.resource}</div>
                            <div className="mt-1 text-xs text-gray-500">{item.summary || '-'} · {formatTime(item.createdAt)}</div>
                        </div>
                    ))}
                    {!auditLogs.length && <EmptyState label="暂无审计日志" />}
                </div>
            </Panel>
        </div>
    )
}

function StatusView({ statuses }: { statuses: ProxyGatewayStatus[] }) {
    if (!statuses.length) return <EmptyState label="没有运行中的网关" />
    return (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {statuses.map(item => (
                <Panel key={item.listenerId}>
                    <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="font-semibold text-gray-900 dark:text-white">{item.name}</h3>
                                <p className="mt-1 text-sm text-gray-500">{item.listenAddress} · {item.protocol}</p>
                            </div>
                            <Badge tone={item.running ? 'green' : 'red'}>{item.running ? '运行中' : '未运行'}</Badge>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                            <Metric label="活跃连接" value={item.activeConns} />
                            <Metric label="累计连接" value={item.totalConns} />
                            <Metric label="入站流量" value={formatBytes(item.totalBytesIn)} />
                            <Metric label="出站流量" value={formatBytes(item.totalBytesOut)} />
                        </div>
                        {item.lastError && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{item.lastError}</div>}
                    </div>
                </Panel>
            ))}
        </div>
    )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/50">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="mt-1 font-semibold text-gray-900 dark:text-white">{value}</div>
        </div>
    )
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
    return (
        <div className="inline-flex items-center gap-1">
            <button onClick={onEdit} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" title="编辑">
                <Save className="h-4 w-4" />
            </button>
            <button onClick={onDelete} className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30" title="删除">
                <Trash2 className="h-4 w-4" />
            </button>
        </div>
    )
}

function ListenerModal({ draft, setDraft, securityPolicies, dnsPolicies, onSave }: {
    draft: Partial<ProxyGatewayListener> | null
    setDraft: (draft: Partial<ProxyGatewayListener> | null) => void
    securityPolicies: ProxyGatewaySecurityPolicy[]
    dnsPolicies: ProxyGatewayDNSPolicy[]
    onSave: () => void
}) {
    if (!draft) return null
    const ipPresets = ['127.0.0.1', '0.0.0.0', '0.0.0.0/0', '::1', '::/0']
    const securityOptions = toSearchOptions(securityPolicies, item => item.description || (item.isDefault ? '默认安全策略' : undefined))
    const dnsOptions = toSearchOptions(dnsPolicies, item => item.description || `${item.mode} · TTL ${item.cacheTtlSeconds}s`)
    return (
        <Modal open={!!draft} onOpenChange={open => !open && setDraft(null)}>
            <ModalContent size="6xl">
                <ModalHeader>
                    <ModalTitle>{draft.id ? '编辑代理网关' : '新增代理网关'}</ModalTitle>
                    <ModalDescription>配置网关入口端口、协议、认证和默认策略。</ModalDescription>
                </ModalHeader>
                <ModalBody className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        <TextField label="网关名称" help="用于在网关用户授权和日志中识别该入口。" value={draft.name || ''} onChange={value => setDraft({ ...draft, name: value })} />
                        <div className="space-y-2">
                            <TextField label="监听 IP" help="127.0.0.1 仅本机可访问；0.0.0.0/0 表示快速填充公网范围，生产环境需要同时开启允许公网监听。" value={draft.listenIp || ''} onChange={value => setDraft({ ...draft, listenIp: value })} />
                            <div className="flex flex-wrap gap-1.5">
                                {ipPresets.map(value => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => setDraft({ ...draft, listenIp: value })}
                                        className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                    >
                                        {value}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <TextField label="外部访问 IP/域名" help="不参与监听和校验，只用于列表展示和一键生成测试 curl 示例。" value={draft.externalHost || ''} onChange={value => setDraft({ ...draft, externalHost: value })} />
                        <OptionalNumberField label="外部访问端口" help="可选。Docker 或负载均衡把外部端口映射到监听端口时填写；留空则使用监听端口。" value={draft.externalPort} onChange={value => setDraft({ ...draft, externalPort: value })} />
                        <NumberField label="端口" help="该端口会提供 HTTP、SOCKS5 或混合代理入口。" value={draft.port || 0} onChange={value => setDraft({ ...draft, port: value })} />
                        <SelectField label="协议" help="Mixed 会自动识别 HTTP 代理请求和 SOCKS5 握手。" value={draft.protocol || 'mixed'} onChange={value => setDraft({ ...draft, protocol: value as any })} options={[['mixed', 'Mixed'], ['http', 'HTTP'], ['socks5', 'SOCKS5']]} />
                        <SearchSelect label="默认安全策略" help="网关未被路由策略覆盖时使用的访问边界。" items={securityOptions} value={draft.securityPolicyId} onChange={value => setDraft({ ...draft, securityPolicyId: value })} noneLabel="自动默认" placeholder="搜索安全策略" />
                        <SearchSelect label="默认 DNS 策略" help="网关未被路由策略覆盖时使用的 DNS 解析行为。" items={dnsOptions} value={draft.dnsPolicyId} onChange={value => setDraft({ ...draft, dnsPolicyId: value })} noneLabel="自动默认" placeholder="搜索 DNS 策略" />
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                        <Toggle label="启用网关" help="关闭后保存并热加载会停止该监听。" checked={!!draft.enabled} onChange={value => setDraft({ ...draft, enabled: value })} />
                        <Toggle label="默认网关" help="创建网关用户时会默认授权给默认网关，同一组织只保留一个默认网关。" checked={!!draft.isDefault} onChange={value => setDraft({ ...draft, isDefault: value })} />
                        <Toggle label="需要认证" help="关闭后该网关会以匿名账号策略访问代理池，通常只用于本机测试。" checked={draft.requireAuth !== false} onChange={value => setDraft({ ...draft, requireAuth: value })} />
                        <Toggle label="允许公网监听" help="开启后才允许 0.0.0.0 或非本机 IP 监听。" checked={!!draft.allowPublicListen} onChange={value => setDraft({ ...draft, allowPublicListen: value })} />
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                        <NumberField label="握手超时秒" help="HTTP 认证或 SOCKS5 握手允许耗时。" value={draft.handshakeTimeoutSeconds || 10} onChange={value => setDraft({ ...draft, handshakeTimeoutSeconds: value })} />
                        <NumberField label="空闲超时秒" help="连接无流量达到该时间后会关闭。" value={draft.idleTimeoutSeconds || 120} onChange={value => setDraft({ ...draft, idleTimeoutSeconds: value })} />
                        <NumberField label="连接超时秒" help="网关连接上游代理或目标地址的超时时间。" value={draft.connectTimeoutSeconds || 30} onChange={value => setDraft({ ...draft, connectTimeoutSeconds: value })} />
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button onClick={() => setDraft(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                    <button onClick={onSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">保存</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function AccountModal({ draft, setDraft, gateways, accountGroups, accountTags, routeStrategies, proxyGroups, proxyTags, proxies, onSave }: {
    draft: AccountDraft | null
    setDraft: (draft: AccountDraft | null) => void
    gateways: ProxyGatewayListener[]
    accountGroups: ProxyGatewayAccountGroup[]
    accountTags: ProxyGatewayAccountTag[]
    routeStrategies: ProxyGatewayRouteStrategy[]
    proxyGroups: ProxyGroup[]
    proxyTags: ProxyTag[]
    proxies: ProxyPoolItem[]
    onSave: () => void
}) {
    const [step, setStep] = useState<AccountStep>('identity')
    const [usernameCheck, setUsernameCheck] = useState<ProxyGatewayValidationResult | null>(null)
    const [passwordCheck, setPasswordCheck] = useState<ProxyGatewayValidationResult | null>(null)
    const [checkingUsername, setCheckingUsername] = useState(false)
    const [checkingPassword, setCheckingPassword] = useState(false)

    useEffect(() => {
        if (draft) setStep('identity')
    }, [draft?.id])

    useEffect(() => {
        if (!draft) return
        const username = (draft.username || '').trim()
        if (!username) {
            setUsernameCheck(null)
            return
        }
        setCheckingUsername(true)
        const timer = setTimeout(async () => {
            try {
                setUsernameCheck(await proxyGatewayService.validateAccountUsername({ username, excludeId: draft.id }))
            } catch (error: any) {
                setUsernameCheck({ valid: false, message: error.message || '用户名校验失败' })
            } finally {
                setCheckingUsername(false)
            }
        }, 450)
        return () => clearTimeout(timer)
    }, [draft?.username, draft?.id])

    useEffect(() => {
        if (!draft) return
        const password = draft.password || ''
        if (!password) {
            setPasswordCheck(null)
            return
        }
        setCheckingPassword(true)
        const timer = setTimeout(async () => {
            try {
                setPasswordCheck(await proxyGatewayService.validateAccountPassword({ password }))
            } catch (error: any) {
                setPasswordCheck({ valid: false, message: error.message || '密码校验失败' })
            } finally {
                setCheckingPassword(false)
            }
        }, 450)
        return () => clearTimeout(timer)
    }, [draft?.password])

    if (!draft) return null
    const gatewayIds = draft.allowedGatewayIds || []
    const allowedGatewaySet = new Set(draft.allowAllGateways ? gateways.map(item => item.id) : gatewayIds)
    const routeChoices = routeStrategies.filter(item => allowedGatewaySet.has(item.gatewayId) || !item.gatewayId)
    const gatewayValid = !!draft.allowAllGateways || gatewayIds.length > 0
    const passwordValid = draft.id && !draft.password ? true : !!passwordCheck?.valid
    const usernameValid = !!usernameCheck?.valid
    const canSave = usernameValid && passwordValid && gatewayValid && !checkingUsername && !checkingPassword
    const steps: Array<{ id: AccountStep; label: string; description: string }> = [
        { id: 'identity', label: '账号信息', description: '用户名、密码、分组和标签' },
        { id: 'authorization', label: '网关授权', description: '选择账号可登录的网关' },
        { id: 'routing', label: '用户名路由', description: '授权可用的路由标志号' },
        { id: 'proxy', label: '代理选择', description: '主代理池范围和调度策略' },
        { id: 'fallback', label: 'Fallback/限速', description: '备用池、直连和速率限制' },
    ]
    const stepIndex = Math.max(0, steps.findIndex(item => item.id === step))
    const gatewayOptions = toSearchOptions(gateways, item => `${item.listenIp}:${item.port} · ${item.protocol.toUpperCase()}`)
    const groupOptions = toSearchOptions(accountGroups, item => item.description)
    const tagOptions = toSearchOptions(accountTags)
    const routeOptions = routeChoices.map(item => ({ id: item.id, name: `#${item.flagNo} ${item.name}`, description: item.description, meta: `标志号 ${item.flagNo}` }))
    const generateUsername = generateGatewayUsername
    const generatePassword = generateGatewayPassword

    return (
        <Modal open={!!draft} onOpenChange={open => !open && setDraft(null)}>
            <ModalContent size="6xl">
                <ModalHeader>
                    <ModalTitle>{draft.id ? '编辑网关用户' : '新增网关用户'}</ModalTitle>
                    <ModalDescription>配置可登录代理网关的账号、授权网关和代理选择策略。</ModalDescription>
                </ModalHeader>
                <ModalBody className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
                    <WizardRail steps={steps} current={step} onChange={setStep} />
                    <div className="min-h-[520px] space-y-5">
                        {step === 'identity' && (
                            <>
                                <SectionTitle label="账号信息" />
                                <div className="grid gap-3 md:grid-cols-3">
                                    <div>
                                        <FieldLabel label="用户名" help="基础用户名不能包含空白、冒号、# 或 ?；智能路由标志会在连接时追加。" />
                                        <div className="flex gap-2">
                                            <input value={draft.username || ''} onChange={event => setDraft({ ...draft, username: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40" />
                                            <button type="button" onClick={() => setDraft({ ...draft, username: generateUsername() })} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" title="随机生成用户名">
                                                <Wand2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <div className="mt-1"><ValidationLine result={usernameCheck} checking={checkingUsername} idle="输入用户名后自动校验" /></div>
                                    </div>
                                    <div>
                                        <FieldLabel label={draft.id ? '新密码' : '密码'} help="密码通过防抖接口做强度校验；编辑时留空表示不修改。" />
                                        <div className="flex gap-2">
                                            <input type="password" value={draft.password || ''} onChange={event => setDraft({ ...draft, password: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40" />
                                            <button type="button" onClick={() => setDraft({ ...draft, password: generatePassword() })} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" title="随机生成密码">
                                                <Wand2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <div className="mt-1"><ValidationLine result={passwordCheck} checking={checkingPassword} idle={draft.id && !draft.password ? '留空则不修改密码' : '输入密码后自动校验'} /></div>
                                    </div>
                                    <TextField label="备注名" help="内部管理用名称，不参与代理认证。" value={draft.name || ''} onChange={value => setDraft({ ...draft, name: value })} />
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <SearchSelect label="账号分组" help="分组在“账号分组”页面维护，这里只选择已有分组。" items={groupOptions} value={draft.groupId} onChange={value => setDraft({ ...draft, groupId: value })} noneLabel="不分组" placeholder="搜索分组" />
                                    <Toggle label="启用用户" help="关闭后该用户无法通过任何授权网关认证。" checked={draft.enabled !== false} onChange={value => setDraft({ ...draft, enabled: value })} />
                                </div>
                                <SearchMultiSelect label="账号标签" help="标签在“账号标签”页面维护，用于筛选账号。" items={tagOptions} selected={draft.tagIds || []} onChange={value => setDraft({ ...draft, tagIds: value })} placeholder="搜索标签" />
                                <TextareaField label="备注" help="记录使用场景、负责人或业务说明。" value={draft.remark || ''} onChange={value => setDraft({ ...draft, remark: value })} />
                            </>
                        )}

                        {step === 'authorization' && (
                            <>
                                <SectionTitle label="网关授权" />
                                <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                                    <Toggle label="允许全部网关" help="开启后该用户可登录所有网关；关闭后只允许选择的网关。" checked={!!draft.allowAllGateways} onChange={value => setDraft({ ...draft, allowAllGateways: value })} />
                                    {!draft.allowAllGateways && (
                                        <SearchMultiSelect label="可使用的网关" help="通过搜索下拉选择网关，已选网关会以标签回显，可移除。" items={gatewayOptions} selected={gatewayIds} onChange={value => setDraft({ ...draft, allowedGatewayIds: value })} placeholder="搜索网关名称、监听地址或协议" />
                                    )}
                                    {!gatewayValid && <div className="text-xs text-rose-600">请至少选择一个可用网关</div>}
                                </div>
                            </>
                        )}

                        {step === 'routing' && (
                            <>
                                <SectionTitle label="智能用户名路由授权" />
                                <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <Toggle label="允许用户名携带路由标志" help="开启后用户可使用 username#标志号 或 username?route=标志号 临时切换路由。" checked={!!draft.enableUsernameRouting} onChange={value => setDraft({ ...draft, enableUsernameRouting: value })} />
                                        <Toggle label="允许全部路由策略" help="开启后该用户可使用其授权网关下的所有用户名路由策略。" checked={!!draft.allowAllRouteStrategies} onChange={value => setDraft({ ...draft, allowAllRouteStrategies: value })} />
                                    </div>
                                    {draft.enableUsernameRouting && !draft.allowAllRouteStrategies && (
                                        <SearchMultiSelect
                                            label="允许使用的路由策略"
                                            help="只列出当前用户可用网关下的策略，标志号会展示给用户用于拼接用户名。"
                                            items={routeOptions}
                                            selected={draft.allowedRouteStrategyIds || []}
                                            onChange={value => setDraft({ ...draft, allowedRouteStrategyIds: value })}
                                            placeholder="搜索标志号或策略名称"
                                        />
                                    )}
                                    <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-950/60 dark:text-gray-300">
                                        示例：<code>{draft.username || 'proxy_user'}#标志号</code> / <code>{draft.username || 'proxy_user'}?route=标志号</code>
                                    </div>
                                </div>
                            </>
                        )}

                        {step === 'proxy' && <ProxyStrategyFields draft={draft} setDraft={setDraft} proxyGroups={proxyGroups} proxyTags={proxyTags} proxies={proxies} section="selection" />}
                        {step === 'fallback' && <ProxyStrategyFields draft={draft} setDraft={setDraft} proxyGroups={proxyGroups} proxyTags={proxyTags} proxies={proxies} section="fallback" showLimits />}
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button onClick={() => setDraft(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                    {stepIndex > 0 && <button onClick={() => setStep(steps[stepIndex - 1].id)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">上一步</button>}
                    {stepIndex < steps.length - 1 && <button onClick={() => setStep(steps[stepIndex + 1].id)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">下一步</button>}
                    <button disabled={!canSave} onClick={onSave} className={cn('rounded-lg px-4 py-2 text-sm font-medium text-white', canSave ? 'bg-primary-600' : 'cursor-not-allowed bg-gray-400')}>保存</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function ProxyStrategyFields({ draft, setDraft, proxyGroups, proxyTags, proxies, section = 'selection', showLimits = false }: {
    draft: AccountDraft | Partial<ProxyGatewayRouteStrategy>
    setDraft: (draft: any) => void
    proxyGroups: ProxyGroup[]
    proxyTags: ProxyTag[]
    proxies: ProxyPoolItem[]
    section?: StrategySection
    showLimits?: boolean
}) {
    const groupOptions = toSearchOptions(proxyGroups, item => item.description)
    const tagOptions = toSearchOptions(proxyTags)
    const selectionMode = draft.selectionMode || 'filtered'
    const fallbackMode = draft.fallbackMode || 'interrupt'

    if (section === 'fallback') {
        return (
            <>
                <SectionTitle label="Fallback 策略" />
                <div className="grid gap-3 md:grid-cols-3">
                    <SelectField label="Fallback 操作" help="上游失败后的处理方式，会决定下面表单如何渲染。" value={fallbackMode} onChange={value => setDraft({ ...draft, fallbackMode: value as any })} options={[['interrupt', '中断'], ['retry', '重试换代理'], ['backup_pool', '备用池'], ['direct', '直连']]} />
                    {(fallbackMode === 'retry' || fallbackMode === 'backup_pool') && (
                        <NumberField label="重试次数" help="Fallback 为重试或备用池时最多换代理次数。" value={draft.maxRetries || 0} onChange={value => setDraft({ ...draft, maxRetries: value })} />
                    )}
                    {fallbackMode === 'direct' && (
                        <Toggle label="允许直连 fallback" help="只有显式允许时，代理池不可用才会尝试直连目标。" checked={!!draft.allowDirectFallback} onChange={value => setDraft({ ...draft, allowDirectFallback: value })} />
                    )}
                </div>
                {fallbackMode === 'backup_pool' && (
                    <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px]">
                            <SearchMultiSelect label="备用代理分组" help="备用池可先按分组筛选代理。" items={groupOptions} selected={draft.fallbackGroupIds || []} onChange={value => setDraft({ ...draft, fallbackGroupIds: value })} placeholder="搜索分组" />
                            <SearchMultiSelect label="备用代理标签" help="备用池可按标签筛选代理。" items={tagOptions} selected={draft.fallbackTagIds || []} onChange={value => setDraft({ ...draft, fallbackTagIds: value })} placeholder="搜索标签" />
                            <SelectField label="标签匹配" help="多个备用标签之间的匹配方式。" value={draft.fallbackTagMode || 'or'} onChange={value => setDraft({ ...draft, fallbackTagMode: value as any })} options={[['or', '任一标签'], ['and', '全部标签']]} />
                        </div>
                        <ProxyPoolSelector
                            label="备用临时代理池"
                            help="备用池失败重试时优先从这些代理中选择。"
                            proxies={proxies}
                            proxyGroups={proxyGroups}
                            proxyTags={proxyTags}
                            selected={draft.fallbackProxyIds || []}
                            onChange={value => setDraft({ ...draft, fallbackProxyIds: value })}
                        />
                    </div>
                )}
                {fallbackMode === 'interrupt' && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950/50 dark:text-gray-300">
                        上游代理失败时直接中断请求，不再切换代理或尝试直连。
                    </div>
                )}
                {showLimits && (
                    <>
                        <SectionTitle label="限速与会话边界" />
                        <div className="grid gap-3 md:grid-cols-3">
                            <NumberField label="最大并发" help="该用户同时连接数上限，0 表示不限。" value={(draft as AccountDraft).maxConcurrent || 0} onChange={value => setDraft({ ...draft, maxConcurrent: value })} />
                            <NumberField label="每分钟连接" help="连接速率限制，0 表示不限。" value={(draft as AccountDraft).rateLimitPerMinute || 0} onChange={value => setDraft({ ...draft, rateLimitPerMinute: value })} />
                            <NumberField label="带宽 Kbps" help="带宽限制，0 表示不限。" value={(draft as AccountDraft).bandwidthLimitKbps || 0} onChange={value => setDraft({ ...draft, bandwidthLimitKbps: value })} />
                            <NumberField label="连接超时秒" help="连接上游代理或目标地址的超时时间。" value={(draft as AccountDraft).connectTimeoutSeconds || 30} onChange={value => setDraft({ ...draft, connectTimeoutSeconds: value })} />
                            <NumberField label="空闲超时秒" help="会话无流量达到该时间后关闭。" value={(draft as AccountDraft).idleTimeoutSeconds || 120} onChange={value => setDraft({ ...draft, idleTimeoutSeconds: value })} />
                            <NumberField label="最大会话秒" help="单个会话最长存活时间，0 表示不限。" value={(draft as AccountDraft).maxSessionSeconds || 0} onChange={value => setDraft({ ...draft, maxSessionSeconds: value })} />
                        </div>
                    </>
                )}
            </>
        )
    }

    return (
        <>
            <SectionTitle label="代理选择策略" />
            <div className="grid gap-3 md:grid-cols-4">
                <SelectField label="选择范围" help="全部可用会从所有可用代理中选择；按组/标签会根据下面条件筛选；临时代理池只使用勾选 ID。" value={draft.selectionMode || 'filtered'} onChange={value => setDraft({ ...draft, selectionMode: value as any })} options={[['all', '全部可用'], ['filtered', '按组/标签'], ['explicit', '临时代理池']]} />
                <SelectField label="调度算法" help="轮询适合均匀分摊；随机适合简单分散；优先复用会倾向最近成功的代理。" value={draft.selectionAlgorithm || 'random'} onChange={value => setDraft({ ...draft, selectionAlgorithm: value as any })} options={[['random', '随机'], ['round_robin', '轮询'], ['weighted', '权重随机'], ['lowest_latency', '最低延迟'], ['prefer_last_success', '优先复用']]} />
                <SelectField label="粘性策略" help="粘性会在 TTL 内尽量为同一范围复用同一个上游代理。" value={draft.stickyMode || 'none'} onChange={value => setDraft({ ...draft, stickyMode: value as any })} options={[['none', '不粘性'], ['account', '账号'], ['client_ip', '客户端 IP'], ['target_host', '目标域名'], ['client_ip_target_host', 'IP+域名']]} />
                <NumberField label="粘性 TTL 秒" help="粘性代理缓存的有效时间。" value={draft.stickyTtlSeconds || 600} onChange={value => setDraft({ ...draft, stickyTtlSeconds: value })} />
            </div>
            {selectionMode === 'filtered' && (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px]">
                    <SearchMultiSelect label="匹配代理分组" help="选择范围为按组/标签时才生效。" items={groupOptions} selected={draft.proxyMatchGroupIds || []} onChange={value => setDraft({ ...draft, proxyMatchGroupIds: value })} placeholder="搜索分组" />
                    <SearchMultiSelect label="匹配代理标签" help="选择范围为按组/标签时才生效。" items={tagOptions} selected={draft.proxyMatchTagIds || []} onChange={value => setDraft({ ...draft, proxyMatchTagIds: value })} placeholder="搜索标签" />
                    <SelectField label="标签匹配" help="多个代理标签之间的匹配方式。" value={draft.proxyMatchTagMode || 'or'} onChange={value => setDraft({ ...draft, proxyMatchTagMode: value as any })} options={[['or', '任一标签'], ['and', '全部标签']]} />
                </div>
            )}
            {selectionMode === 'explicit' && (
                <ProxyPoolSelector
                    label="临时代理池"
                    help="选择范围为临时代理池时，只从这些代理 ID 中调度。"
                    proxies={proxies}
                    proxyGroups={proxyGroups}
                    proxyTags={proxyTags}
                    selected={draft.proxyIds || []}
                    onChange={value => setDraft({ ...draft, proxyIds: value })}
                />
            )}
            {selectionMode === 'all' && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950/50 dark:text-gray-300">
                    当前会从所有可用代理中选择，不需要配置代理分组、标签或临时代理池。
                </div>
            )}
            <Toggle label="优先复用最近成功代理" help="开启后会在候选池中优先选择该账号或路由最近成功使用过的代理。" checked={!!draft.preferLastSuccess} onChange={value => setDraft({ ...draft, preferLastSuccess: value })} />
        </>
    )
}

function RouteStrategyModal({ draft, setDraft, proxyGroups, proxyTags, proxies, securityPolicies, dnsPolicies, onSave }: {
    draft: Partial<ProxyGatewayRouteStrategy> | null
    setDraft: (draft: Partial<ProxyGatewayRouteStrategy> | null) => void
    proxyGroups: ProxyGroup[]
    proxyTags: ProxyTag[]
    proxies: ProxyPoolItem[]
    securityPolicies: ProxyGatewaySecurityPolicy[]
    dnsPolicies: ProxyGatewayDNSPolicy[]
    onSave: () => void
}) {
    const [step, setStep] = useState<RouteStep>('basic')

    useEffect(() => {
        if (draft) setStep('basic')
    }, [draft?.id])

    if (!draft) return null
    const steps: Array<{ id: RouteStep; label: string; description: string }> = [
        { id: 'basic', label: '基础信息', description: '名称、标志号和示例' },
        { id: 'proxy', label: '代理选择', description: '主代理池范围和调度' },
        { id: 'fallback', label: 'Fallback', description: '重试、备用池或直连' },
        { id: 'overrides', label: '策略覆盖', description: '安全和 DNS 覆盖' },
    ]
    const stepIndex = Math.max(0, steps.findIndex(item => item.id === step))
    const securityOptions = toSearchOptions(securityPolicies, item => item.description || (item.isDefault ? '默认安全策略' : undefined))
    const dnsOptions = toSearchOptions(dnsPolicies, item => item.description || `${item.mode} · TTL ${item.cacheTtlSeconds}s`)

    return (
        <Modal open={!!draft} onOpenChange={open => !open && setDraft(null)}>
            <ModalContent size="6xl">
                <ModalHeader>
                    <ModalTitle>{draft.id ? '编辑路由策略' : '新增路由策略'}</ModalTitle>
                    <ModalDescription>配置当前网关下可由用户名标志号调用的路由策略。</ModalDescription>
                </ModalHeader>
                <ModalBody className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
                    <WizardRail steps={steps} current={step} onChange={setStep} />
                    <div className="min-h-[500px] space-y-5">
                        {step === 'basic' && (
                            <>
                                <SectionTitle label="基础信息" />
                                <div className="grid gap-3 md:grid-cols-3">
                                    <TextField label="策略名称" help="用于账号授权和日志识别。" value={draft.name || ''} onChange={value => setDraft({ ...draft, name: value })} />
                                    <NumberField label="标志号" help="用户连接时通过 username#标志号 或 username?route=标志号 调用。" value={draft.flagNo || 0} onChange={value => setDraft({ ...draft, flagNo: value })} />
                                    <Toggle label="启用策略" help="停用后即使账号已授权也无法使用该标志号。" checked={draft.enabled !== false} onChange={value => setDraft({ ...draft, enabled: value })} />
                                </div>
                                <TextareaField label="描述" help="记录该标志号对应业务或代理池用途。" value={draft.description || ''} onChange={value => setDraft({ ...draft, description: value })} />
                                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-950/60 dark:text-gray-300">
                                    示例：<code>proxy_user#{draft.flagNo || '标志号'}</code> / <code>proxy_user?route={draft.flagNo || '标志号'}</code>
                                </div>
                            </>
                        )}
                        {step === 'proxy' && <ProxyStrategyFields draft={draft} setDraft={setDraft} proxyGroups={proxyGroups} proxyTags={proxyTags} proxies={proxies} section="selection" />}
                        {step === 'fallback' && <ProxyStrategyFields draft={draft} setDraft={setDraft} proxyGroups={proxyGroups} proxyTags={proxyTags} proxies={proxies} section="fallback" />}
                        {step === 'overrides' && (
                            <>
                                <SectionTitle label="策略覆盖" />
                                <div className="grid gap-3 md:grid-cols-2">
                                    <SearchSelect label="安全策略覆盖" help="不覆盖时使用网关默认安全策略。" items={securityOptions} value={draft.securityPolicyId} onChange={value => setDraft({ ...draft, securityPolicyId: value })} noneLabel="不覆盖" placeholder="搜索安全策略" />
                                    <SearchSelect label="DNS 策略覆盖" help="不覆盖时使用网关默认 DNS 策略。" items={dnsOptions} value={draft.dnsPolicyId} onChange={value => setDraft({ ...draft, dnsPolicyId: value })} noneLabel="不覆盖" placeholder="搜索 DNS 策略" />
                                </div>
                            </>
                        )}
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button onClick={() => setDraft(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                    {stepIndex > 0 && <button onClick={() => setStep(steps[stepIndex - 1].id)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">上一步</button>}
                    {stepIndex < steps.length - 1 && <button onClick={() => setStep(steps[stepIndex + 1].id)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">下一步</button>}
                    <button onClick={onSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">保存</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function SecurityModal({ draft, setDraft, onSave }: {
    draft: Partial<ProxyGatewaySecurityPolicy> | null
    setDraft: (draft: Partial<ProxyGatewaySecurityPolicy> | null) => void
    onSave: () => void
}) {
    const [step, setStep] = useState<SecurityStep>('basic')

    useEffect(() => {
        if (draft) setStep('basic')
    }, [draft?.id])

    if (!draft) return null
    const steps: Array<{ id: SecurityStep; label: string; description: string }> = [
        { id: 'basic', label: '基础信息', description: '名称、默认和未命中动作' },
        { id: 'sources', label: '来源边界', description: '来源 IP allow/deny' },
        { id: 'targets', label: '目标边界', description: 'Host 和端口 allow/deny' },
        { id: 'boundaries', label: '安全开关', description: '内网、回环、metadata 和 DNS rebinding' },
    ]
    const stepIndex = Math.max(0, steps.findIndex(item => item.id === step))

    return (
        <Modal open={!!draft} onOpenChange={open => !open && setDraft(null)}>
            <ModalContent size="6xl">
                <ModalHeader>
                    <ModalTitle>安全策略</ModalTitle>
                    <ModalDescription>配置当前网关的来源、目标、端口和内网访问边界。</ModalDescription>
                </ModalHeader>
                <ModalBody className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
                    <WizardRail steps={steps} current={step} onChange={setStep} />
                    <div className="min-h-[500px] space-y-5">
                        {step === 'basic' && (
                            <>
                                <SectionTitle label="基础信息" />
                                <div className="grid gap-3 md:grid-cols-3">
                                    <TextField label="名称" help="用于网关默认策略和路由策略覆盖选择。" value={draft.name || ''} onChange={value => setDraft({ ...draft, name: value })} />
                                    <SelectField label="未命中策略" help="allow 会放行未命中 allow/deny 条件的请求；deny 会拒绝。" value={draft.noMatchAction || 'deny'} onChange={value => setDraft({ ...draft, noMatchAction: value as any })} options={[['deny', '拒绝'], ['allow', '允许'], ['log_only', '仅记录']]} />
                                    <Toggle label="设为默认" help="同一网关只保留一个默认安全策略。" checked={!!draft.isDefault} onChange={value => setDraft({ ...draft, isDefault: value })} />
                                </div>
                                <TextareaField label="描述" help="记录策略用途或适用业务。" value={draft.description || ''} onChange={value => setDraft({ ...draft, description: value })} />
                            </>
                        )}
                        {step === 'sources' && (
                            <>
                                <SectionTitle label="来源边界" />
                                <div className="grid gap-3 md:grid-cols-2">
                                    <ListField label="来源 IP allowlist/CIDR" help="非空时，仅允许匹配来源访问该网关。" value={draft.sourceAllowCidrs || []} onChange={value => setDraft({ ...draft, sourceAllowCidrs: value })} />
                                    <ListField label="来源 IP denylist/CIDR" help="匹配来源会被拒绝。" value={draft.sourceDenyCidrs || []} onChange={value => setDraft({ ...draft, sourceDenyCidrs: value })} />
                                </div>
                            </>
                        )}
                        {step === 'targets' && (
                            <>
                                <SectionTitle label="目标边界" />
                                <div className="grid gap-3 md:grid-cols-2">
                                    <ListField label="目标 Host allowlist" help="非空时，仅允许匹配目标域名。" value={draft.targetHostAllowlist || []} onChange={value => setDraft({ ...draft, targetHostAllowlist: value })} />
                                    <ListField label="目标 Host denylist" help="匹配目标域名会被拒绝。" value={draft.targetHostDenylist || []} onChange={value => setDraft({ ...draft, targetHostDenylist: value })} />
                                    <ListField label="目标端口 allowlist" help="非空时，仅允许匹配目标端口。" value={draft.targetPortAllowlist || []} onChange={value => setDraft({ ...draft, targetPortAllowlist: value })} />
                                    <ListField label="目标端口 denylist" help="匹配目标端口会被拒绝。" value={draft.targetPortDenylist || []} onChange={value => setDraft({ ...draft, targetPortDenylist: value })} />
                                </div>
                            </>
                        )}
                        {step === 'boundaries' && (
                            <>
                                <SectionTitle label="安全开关" />
                                <div className="grid gap-3 md:grid-cols-3">
                                    {[
                                        ['blockPrivateIp', '阻断内网 IP', '阻断 RFC1918 私网目标。'],
                                        ['blockLoopback', '阻断 loopback', '阻断 127.0.0.0/8 和 ::1。'],
                                        ['blockLinkLocal', '阻断 link-local', '阻断链路本地地址。'],
                                        ['blockMulticast', '阻断 multicast', '阻断多播地址。'],
                                        ['blockMetadataIp', '阻断 metadata', '阻断云厂商 metadata 地址。'],
                                        ['dnsRebindingProtection', 'DNS rebinding 防护', '域名解析到受限 IP 时拒绝。'],
                                    ].map(([key, label, help]) => (
                                        <Toggle key={key} label={label} help={help} checked={!!(draft as any)[key]} onChange={value => setDraft({ ...draft, [key]: value })} />
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button onClick={() => setDraft(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                    {stepIndex > 0 && <button onClick={() => setStep(steps[stepIndex - 1].id)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">上一步</button>}
                    {stepIndex < steps.length - 1 && <button onClick={() => setStep(steps[stepIndex + 1].id)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">下一步</button>}
                    <button onClick={onSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">保存</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function DNSModal({ draft, setDraft, onSave }: {
    draft: Partial<ProxyGatewayDNSPolicy> | null
    setDraft: (draft: Partial<ProxyGatewayDNSPolicy> | null) => void
    onSave: () => void
}) {
    if (!draft) return null
    return (
        <Modal open={!!draft} onOpenChange={open => !open && setDraft(null)}>
            <ModalContent size="2xl">
                <ModalHeader>
                    <ModalTitle>DNS 策略</ModalTitle>
                    <ModalDescription>配置当前网关的 DNS 解析模式、缓存和安全预解析行为。</ModalDescription>
                </ModalHeader>
                <ModalBody className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                        <TextField label="名称" help="用于网关默认策略和路由策略覆盖选择。" value={draft.name || ''} onChange={value => setDraft({ ...draft, name: value })} />
                        <SelectField label="解析模式" help="远端解析保留域名交给上游代理；本地/自定义会先解析出 IP。" value={draft.mode || 'remote'} onChange={value => setDraft({ ...draft, mode: value as any })} options={[['remote', '远端解析'], ['local', '本地解析'], ['custom', '自定义 Resolver']]} />
                        <Toggle label="设为默认" help="同一网关只保留一个默认 DNS 策略。" checked={!!draft.isDefault} onChange={value => setDraft({ ...draft, isDefault: value })} />
                    </div>
                    <TextareaField label="描述" help="记录策略用途或适用业务。" value={draft.description || ''} onChange={value => setDraft({ ...draft, description: value })} />
                    <ListField label="自定义 Resolver" help="解析模式为自定义时使用，每行一个 DNS 地址，可省略端口。" value={draft.resolvers || []} onChange={value => setDraft({ ...draft, resolvers: value })} />
                    <div className="grid gap-3 md:grid-cols-3">
                        <NumberField label="缓存 TTL 秒" help="成功解析结果缓存时长。" value={draft.cacheTtlSeconds || 300} onChange={value => setDraft({ ...draft, cacheTtlSeconds: value })} />
                        <NumberField label="失败 TTL 秒" help="解析失败结果缓存时长。" value={draft.negativeTtlSeconds || 60} onChange={value => setDraft({ ...draft, negativeTtlSeconds: value })} />
                        <SelectField label="多 IP 策略" help="全部检查会拒绝任何受限 IP；仅首个只检查第一个解析结果。" value={draft.multiIpStrategy || 'check_all'} onChange={value => setDraft({ ...draft, multiIpStrategy: value as any })} options={[['check_all', '全部检查'], ['first_only', '仅首个'], ['reject_private', '命中私网拒绝']]} />
                        <SelectField label="解析失败" help="拒绝会直接失败；回退远端解析会保留域名交给上游代理。" value={draft.resolveFailureAction || 'deny'} onChange={value => setDraft({ ...draft, resolveFailureAction: value as any })} options={[['deny', '拒绝'], ['remote_fallback', '回退远端解析']]} />
                        <Toggle label="SOCKS5 远端解析" help="开启时 SOCKS5 域名目标优先交给上游代理解析。" checked={draft.socks5RemoteResolve !== false} onChange={value => setDraft({ ...draft, socks5RemoteResolve: value })} />
                        <Toggle label="HTTP CONNECT 保留 Host" help="开启时 HTTP CONNECT 目标保持域名形式。" checked={draft.httpConnectPreserveHost !== false} onChange={value => setDraft({ ...draft, httpConnectPreserveHost: value })} />
                        <Toggle label="安全预解析" help="开启后会先解析目标域名用于安全边界检查。" checked={draft.preResolveForSecurity !== false} onChange={value => setDraft({ ...draft, preResolveForSecurity: value })} />
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button onClick={() => setDraft(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                    <button onClick={onSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">保存</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function MetaModal({ draft, setDraft, onSave }: {
    draft: MetaDraft | null
    setDraft: (draft: MetaDraft | null) => void
    onSave: () => void
}) {
    if (!draft) return null
    return (
        <Modal open={!!draft} onOpenChange={open => !open && setDraft(null)}>
            <ModalContent size="md">
                <ModalHeader>
                    <ModalTitle>{draft.id ? '编辑' : '新增'}{draft.type === 'group' ? '账号分组' : '账号标签'}</ModalTitle>
                    <ModalDescription>分组和标签独立维护，创建账号时只选择已有项。</ModalDescription>
                </ModalHeader>
                <ModalBody className="space-y-4">
                    <TextField label="名称" help="用于账号列表筛选和识别。" value={draft.name} onChange={value => setDraft({ ...draft, name: value })} />
                    {draft.type === 'group' && <TextareaField label="描述" help="记录该分组适用业务或负责人。" value={draft.description || ''} onChange={value => setDraft({ ...draft, description: value })} />}
                    <div className="grid gap-3 md:grid-cols-2">
                        <TextField label="颜色" help="支持十六进制颜色值。" value={draft.color || ''} onChange={value => setDraft({ ...draft, color: value })} />
                        <NumberField label="排序" help="数值越小越靠前。" value={draft.sortOrder || 0} onChange={value => setDraft({ ...draft, sortOrder: value })} />
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button onClick={() => setDraft(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                    <button onClick={onSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">保存</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function SectionTitle({ label }: { label: string }) {
    return <div className="border-b border-gray-100 pb-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">{label}</div>
}

function WizardRail<T extends string>({ steps, current, onChange }: {
    steps: Array<{ id: T; label: string; description?: string }>
    current: T
    onChange: (step: T) => void
}) {
    return (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-950/50">
            {steps.map((step, index) => {
                const active = step.id === current
                return (
                    <button
                        key={step.id}
                        type="button"
                        onClick={() => onChange(step.id)}
                        className={cn(
                            'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition',
                            active ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:bg-white/70 hover:text-gray-900 dark:hover:bg-gray-900 dark:hover:text-white'
                        )}
                    >
                        <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold', active ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300')}>{index + 1}</span>
                        <span className="min-w-0">
                            <span className="block font-medium">{step.label}</span>
                            {step.description && <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{step.description}</span>}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

function FieldLabel({ label, help, inline = false }: { label: string; help?: string; inline?: boolean }) {
    return (
        <span className={cn('flex items-center gap-1.5 font-medium text-gray-700 dark:text-gray-200', inline ? 'whitespace-nowrap' : 'mb-1')}>
            {label}
            {help && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-gray-400" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs whitespace-normal">{help}</TooltipContent>
                </Tooltip>
            )}
        </span>
    )
}

function TextField({ label, value, onChange, type = 'text', help }: { label: string; value: string; onChange: (value: string) => void; type?: string; help?: string }) {
    return (
        <label className="block text-sm">
            <FieldLabel label={label} help={help} />
            <input type={type} value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40" />
        </label>
    )
}

function NumberField({ label, value, onChange, help }: { label: string; value: number; onChange: (value: number) => void; help?: string }) {
    return (
        <label className="block text-sm">
            <FieldLabel label={label} help={help} />
            <input type="number" value={value} onChange={event => onChange(Number(event.target.value))} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40" />
        </label>
    )
}

function OptionalNumberField({ label, value, onChange, help }: { label: string; value?: number; onChange: (value: number | undefined) => void; help?: string }) {
    return (
        <label className="block text-sm">
            <FieldLabel label={label} help={help} />
            <input
                type="number"
                value={value && value > 0 ? value : ''}
                onChange={event => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40"
            />
        </label>
    )
}

function TextareaField({ label, value, onChange, help }: { label: string; value: string; onChange: (value: string) => void; help?: string }) {
    return (
        <label className="block text-sm">
            <FieldLabel label={label} help={help} />
            <textarea value={value} onChange={event => onChange(event.target.value)} rows={3} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40" />
        </label>
    )
}

function SelectField({ label, value, onChange, options, help }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>; help?: string }) {
    return (
        <label className="block text-sm">
            <FieldLabel label={label} help={help} />
            <select value={value} onChange={event => onChange(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40">
                {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
            </select>
        </label>
    )
}

function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (value: boolean) => void; help?: string }) {
    return (
        <label className="flex min-h-[42px] items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
            <FieldLabel label={label} help={help} inline />
            <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
        </label>
    )
}

function ListField({ label, value, onChange, help }: { label: string; value: string[]; onChange: (value: string[]) => void; help?: string }) {
    return <TextareaField label={label} help={help} value={value.join('\n')} onChange={next => onChange(toStringList(next))} />
}

function CheckList<T extends { id: number; name: string }>({ label, items, selected, onChange, help }: {
    label: string
    items: T[]
    selected: number[]
    onChange: (value: number[]) => void
    help?: string
}) {
    return (
        <div>
            <FieldLabel label={label} help={help} />
            <div className="flex flex-wrap gap-2">
                {items.map(item => {
                    const active = selected.includes(item.id)
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => onChange(active ? selected.filter(id => id !== item.id) : [...selected, item.id])}
                            className={cn(
                                'rounded-full border px-3 py-1 text-xs font-medium transition',
                                active
                                    ? 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-300'
                                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                            )}
                        >
                            {item.name}
                        </button>
                    )
                })}
                {!items.length && <span className="text-xs text-gray-500">暂无可选项</span>}
            </div>
        </div>
    )
}

function toSearchOptions<T extends { id: number; name: string; description?: string; color?: string }>(items: T[], meta?: (item: T) => string | undefined): SearchOption[] {
    return items.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        color: item.color,
        meta: meta?.(item),
    }))
}

function filterOptions(items: SearchOption[], query: string) {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter(item => [item.name, item.description, item.meta, String(item.id)].some(value => value?.toLowerCase().includes(keyword)))
}

function SearchSelect({ label, help, items, value, onChange, placeholder = '搜索并选择', noneLabel, emptyLabel = '暂无可选项' }: {
    label?: string
    help?: string
    items: SearchOption[]
    value?: number
    onChange: (value?: number) => void
    placeholder?: string
    noneLabel?: string
    emptyLabel?: string
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const ref = useRef<HTMLDivElement>(null)
    const selected = items.find(item => item.id === value)
    const filtered = filterOptions(items, query)

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false)
                setQuery('')
            }
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [])

    return (
        <div className="relative text-sm" ref={ref}>
            {label && <FieldLabel label={label} help={help} />}
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                    value={open ? query : selected?.name || ''}
                    onFocus={() => {
                        setOpen(true)
                        setQuery('')
                    }}
                    onChange={event => {
                        setOpen(true)
                        setQuery(event.target.value)
                    }}
                    placeholder={selected?.name || noneLabel || placeholder}
                    className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40"
                />
                {value && (
                    <button
                        type="button"
                        onClick={() => {
                            onChange(undefined)
                            setQuery('')
                        }}
                        className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            {open && (
                <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    {noneLabel && (
                        <button
                            type="button"
                            onClick={() => {
                                onChange(undefined)
                                setOpen(false)
                                setQuery('')
                            }}
                            className={cn('flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800', !value && 'text-primary-700 dark:text-primary-300')}
                        >
                            <span>{noneLabel}</span>
                            {!value && <Badge tone="blue">默认</Badge>}
                        </button>
                    )}
                    {filtered.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                                onChange(item.id)
                                setOpen(false)
                                setQuery('')
                            }}
                            className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                            {item.color && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-gray-900 dark:text-white">{item.name}</span>
                                {(item.meta || item.description) && <span className="mt-0.5 block truncate text-xs text-gray-500">{item.meta || item.description}</span>}
                            </span>
                        </button>
                    ))}
                    {!filtered.length && <div className="px-3 py-2 text-xs text-gray-500">{emptyLabel}</div>}
                </div>
            )}
        </div>
    )
}

function SearchMultiSelect({ label, help, items, selected, onChange, placeholder = '搜索后选择', emptyLabel = '暂无可选项' }: {
    label: string
    help?: string
    items: SearchOption[]
    selected: number[]
    onChange: (value: number[]) => void
    placeholder?: string
    emptyLabel?: string
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const ref = useRef<HTMLDivElement>(null)
    const selectedSet = new Set(selected)
    const selectedItems = selected.map(id => items.find(item => item.id === id) || { id, name: `#${id}` })
    const filtered = filterOptions(items.filter(item => !selectedSet.has(item.id)), query)

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false)
                setQuery('')
            }
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [])

    return (
        <div className="relative text-sm" ref={ref}>
            <FieldLabel label={label} help={help} />
            <div
                className="flex min-h-[42px] flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 transition focus-within:border-primary-400 focus-within:ring-4 focus-within:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus-within:ring-primary-950/40"
                onClick={() => setOpen(true)}
            >
                {selectedItems.map(item => (
                    <span key={item.id} className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-300">
                        {item.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />}
                        <span className="truncate">{item.name}</span>
                        <button
                            type="button"
                            onClick={event => {
                                event.stopPropagation()
                                onChange(selected.filter(id => id !== item.id))
                            }}
                            className="rounded-full p-0.5 hover:bg-primary-100 dark:hover:bg-primary-900"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
                <input
                    value={query}
                    onFocus={() => setOpen(true)}
                    onChange={event => {
                        setOpen(true)
                        setQuery(event.target.value)
                    }}
                    placeholder={selected.length ? '' : placeholder}
                    className="min-w-[160px] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
                />
            </div>
            {open && (
                <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    {filtered.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                                onChange([...selected, item.id])
                                setQuery('')
                            }}
                            className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                            {item.color && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />}
                            <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-gray-900 dark:text-white">{item.name}</span>
                                {(item.meta || item.description) && <span className="mt-0.5 block truncate text-xs text-gray-500">{item.meta || item.description}</span>}
                            </span>
                        </button>
                    ))}
                    {!filtered.length && <div className="px-3 py-2 text-xs text-gray-500">{emptyLabel}</div>}
                </div>
            )}
        </div>
    )
}

function ValidationLine({ result, checking, idle }: { result: ProxyGatewayValidationResult | null; checking: boolean; idle: string }) {
    if (checking) return <div className="text-xs text-gray-500">正在校验...</div>
    if (!result) return <div className="text-xs text-gray-500">{idle}</div>
    return <div className={cn('text-xs', result.valid ? 'text-emerald-600' : 'text-rose-600')}>{result.message || (result.valid ? '可用' : '不可用')}</div>
}

function ProxyPoolSelector({ label = '临时代理池', help = '只从表格中的代理 ID 内调度。', proxies, proxyGroups = [], proxyTags = [], selected, onChange }: {
    label?: string
    help?: string
    proxies: ProxyPoolItem[]
    proxyGroups?: ProxyGroup[]
    proxyTags?: ProxyTag[]
    selected: number[]
    onChange: (value: number[]) => void
}) {
    const [pickerOpen, setPickerOpen] = useState(false)
    const proxyById = useMemo(() => new Map(proxies.map(item => [item.id, item])), [proxies])
    const selectedRows = selected.map(id => proxyById.get(id) || ({ id, type: 'http', host: `未知代理 #${id}`, port: 0, status: 'unknown' } as ProxyPoolItem))

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <FieldLabel label={label} help={help} />
                <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                    <Plus className="h-4 w-4" />
                    添加代理
                </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                        <tr>
                            <th className="px-3 py-2 text-left">代理</th>
                            <th className="px-3 py-2 text-left">分组/标签</th>
                            <th className="px-3 py-2 text-left">状态</th>
                            <th className="px-3 py-2 text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {selectedRows.map(item => (
                            <tr key={item.id}>
                                <td className="px-3 py-2">
                                    <div className="font-medium text-gray-900 dark:text-white">#{item.id} {item.type}://{item.host}{item.port ? `:${item.port}` : ''}</div>
                                    <div className="text-xs text-gray-500">{item.remark || item.exitIp || '临时池代理'}</div>
                                </td>
                                <td className="px-3 py-2">
                                    <div className="flex flex-wrap gap-1">
                                        {item.group && <Badge tone="blue">{item.group.name}</Badge>}
                                        {item.tags?.map(tag => <Badge key={tag.id}>{tag.name}</Badge>)}
                                        {!item.group && !item.tags?.length && <span className="text-xs text-gray-500">未设置</span>}
                                    </div>
                                </td>
                                <td className="px-3 py-2"><Badge tone={item.status === 'available' ? 'green' : item.status === 'unavailable' ? 'red' : 'gray'}>{item.status}</Badge></td>
                                <td className="px-3 py-2 text-right">
                                    <button
                                        type="button"
                                        onClick={() => onChange(selected.filter(id => id !== item.id))}
                                        className="rounded-lg border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {!selectedRows.length && (
                            <tr>
                                <td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-500">暂未添加代理</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <ProxyPickerModal
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                proxies={proxies}
                proxyGroups={proxyGroups}
                proxyTags={proxyTags}
                selected={selected}
                onApply={value => {
                    onChange(value)
                    setPickerOpen(false)
                }}
            />
        </div>
    )
}

function ProxyPickerModal({ open, onClose, proxies, proxyGroups, proxyTags, selected, onApply }: {
    open: boolean
    onClose: () => void
    proxies: ProxyPoolItem[]
    proxyGroups: ProxyGroup[]
    proxyTags: ProxyTag[]
    selected: number[]
    onApply: (value: number[]) => void
}) {
    const [draftSelected, setDraftSelected] = useState<number[]>(selected)
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [type, setType] = useState('')
    const [groupIds, setGroupIds] = useState<number[]>([])
    const [tagIds, setTagIds] = useState<number[]>([])
    const [tagMode, setTagMode] = useState<'and' | 'or'>('or')
    const selectedKey = selected.join(',')

    useEffect(() => {
        if (open) setDraftSelected(selected)
    }, [open, selectedKey])

    const statuses = useMemo(() => Array.from(new Set(proxies.map(item => item.status))).filter(Boolean), [proxies])
    const types = useMemo(() => Array.from(new Set(proxies.map(item => item.type))).filter(Boolean), [proxies])
    const filtered = useMemo(() => {
        const keyword = search.trim().toLowerCase()
        return proxies.filter(item => {
            if (status && item.status !== status) return false
            if (type && item.type !== type) return false
            if (groupIds.length && !groupIds.includes(item.groupId || item.group?.id || 0)) return false
            if (tagIds.length) {
                const itemTagIds = new Set((item.tags || []).map(tag => tag.id))
                const matched = tagMode === 'and'
                    ? tagIds.every(id => itemTagIds.has(id))
                    : tagIds.some(id => itemTagIds.has(id))
                if (!matched) return false
            }
            if (!keyword) return true
            return [
                item.id,
                item.type,
                item.host,
                item.port,
                item.username,
                item.remark,
                item.exitIp,
                item.country,
                item.region,
                item.city,
                item.isp,
                item.group?.name,
                ...(item.tags || []).map(tag => tag.name),
            ].some(value => String(value || '').toLowerCase().includes(keyword))
        })
    }, [proxies, search, status, type, groupIds, tagIds, tagMode])

    const toggleProxy = (id: number) => {
        setDraftSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
    }
    const selectFiltered = () => {
        setDraftSelected(current => Array.from(new Set([...current, ...filtered.map(item => item.id)])))
    }
    const clearFiltered = () => {
        const filteredIds = new Set(filtered.map(item => item.id))
        setDraftSelected(current => current.filter(id => !filteredIds.has(id)))
    }

    if (!open) return null

    return (
        <Modal open={open} onOpenChange={next => !next && onClose()}>
            <ModalContent size="6xl" className="z-[70] max-h-[88vh]" overlayClassName="z-[60]">
                <ModalHeader>
                    <ModalTitle>添加代理到临时池</ModalTitle>
                    <ModalDescription>按代理列表的筛选方式选择要加入本次策略的代理。</ModalDescription>
                </ModalHeader>
                <ModalBody className="space-y-4">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_160px_160px]">
                        <label className="block text-sm">
                            <FieldLabel label="搜索代理" help="支持 ID、Host、备注、出口 IP、地区、ISP、分组和标签搜索。" />
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                <input
                                    value={search}
                                    onChange={event => setSearch(event.target.value)}
                                    placeholder="搜索 Host / 备注 / 出口 IP"
                                    className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40"
                                />
                            </div>
                        </label>
                        <SelectField label="状态" help="按代理健康状态过滤。" value={status} onChange={setStatus} options={[['', '全部状态'], ...statuses.map(item => [item, item] as [string, string])]} />
                        <SelectField label="类型" help="按 HTTP/SOCKS5 等代理类型过滤。" value={type} onChange={setType} options={[['', '全部类型'], ...types.map(item => [item, item.toUpperCase()] as [string, string])]} />
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]">
                        <SearchMultiSelect label="代理分组" help="只显示选中分组下的代理。" items={toSearchOptions(proxyGroups)} selected={groupIds} onChange={setGroupIds} placeholder="搜索分组" />
                        <SearchMultiSelect label="代理标签" help="只显示命中标签的代理。" items={toSearchOptions(proxyTags)} selected={tagIds} onChange={setTagIds} placeholder="搜索标签" />
                        <SelectField label="标签匹配" help="多个标签之间的匹配关系。" value={tagMode} onChange={value => setTagMode(value as 'and' | 'or')} options={[['or', '任一标签'], ['and', '全部标签']]} />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-950/50">
                        <div className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-300">
                            <ListFilter className="h-4 w-4" />
                            已筛选 {filtered.length} 个代理，已选择 {draftSelected.length} 个
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={selectFiltered} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">选择当前结果</button>
                            <button type="button" onClick={clearFiltered} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">取消当前结果</button>
                            <button type="button" onClick={() => setDraftSelected([])} className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">清空选择</button>
                        </div>
                    </div>
                    <div className="max-h-[420px] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
                        <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-800">
                            <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900">
                                <tr>
                                    <th className="w-12 px-3 py-2"></th>
                                    <th className="px-3 py-2 text-left">代理</th>
                                    <th className="px-3 py-2 text-left">分组/标签</th>
                                    <th className="px-3 py-2 text-left">状态</th>
                                    <th className="px-3 py-2 text-left">出口</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {filtered.map(item => {
                                    const active = draftSelected.includes(item.id)
                                    return (
                                        <tr key={item.id} className={cn(active && 'bg-primary-50/60 dark:bg-primary-950/20')}>
                                            <td className="px-3 py-2">
                                                <input type="checkbox" checked={active} onChange={() => toggleProxy(item.id)} className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="font-medium text-gray-900 dark:text-white">#{item.id} {item.type}://{item.host}:{item.port}</div>
                                                <div className="text-xs text-gray-500">{item.remark || item.username || '-'}</div>
                                            </td>
                                            <td className="px-3 py-2">
                                                <div className="flex flex-wrap gap-1">
                                                    {item.group && <Badge tone="blue">{item.group.name}</Badge>}
                                                    {item.tags?.map(tag => <Badge key={tag.id}>{tag.name}</Badge>)}
                                                    {!item.group && !item.tags?.length && <span className="text-xs text-gray-500">未设置</span>}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2"><Badge tone={item.status === 'available' ? 'green' : item.status === 'unavailable' ? 'red' : 'gray'}>{item.status}</Badge></td>
                                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{[item.exitIp, item.country, item.region, item.city].filter(Boolean).join(' · ') || '-'}</td>
                                        </tr>
                                    )
                                })}
                                {!filtered.length && (
                                    <tr>
                                        <td colSpan={5} className="px-3 py-10 text-center text-sm text-gray-500">没有符合筛选条件的代理</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                    <button onClick={() => onApply(draftSelected)} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">确认添加</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function formatBytes(value: number) {
    if (!value) return '0 B'
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(value?: string) {
    if (!value) return '-'
    return new Date(value).toLocaleString()
}
